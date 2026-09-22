// Product-scoped evidence: declarations, shipping verdicts and tool descriptions share one root.
import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { recordedEvidence } from "#src/claim/evidence-log.ts";
import { readVerifiedTrace } from "#src/claim/trace-read.ts";
import { readRecordedBatteryRecord } from "#src/truth/battery-record.ts";
import { bundleSnapshotIdOf } from "#src/claim/bundle-snapshot.ts";
import { verifyTree } from "#src/claim/bundle-snapshot-verify.ts";
import { batteryTallies, checkInformativenessLines } from "./digest-ledgers.mjs";
import { isBoolean, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

/** Trace location is not product identity: an adopted tree may retain older runs. */
export function measuredProductBinding(runId, roots) {
  let battery = null;
  for (const root of roots) {
    const runDir = join(root, "runs", runId);
    if (!existsSync(join(runDir, "battery.json"))) continue;
    try {
      const recorded = readRecordedBatteryRecord(runDir, runId);
      if (battery !== null && JSON.stringify(recorded) !== JSON.stringify(battery)) {
        return { root: null, gap: "conflicting battery copies" };
      }
      battery = recorded;
    } catch {
      return { root: null, gap: "battery unreadable or not manifest-verified" };
    }
  }
  const fingerprint = battery?.bundleSnapshot;
  const hash = (value) => isString(value) && /^[a-f0-9]{64}$/.test(value);
  if (
    !hash(fingerprint?.agentHash) ||
    !hash(fingerprint?.correctnessModelHash) ||
    !(fingerprint?.taskSetHash === null || hash(fingerprint?.taskSetHash))
  ) {
    return { root: null, gap: "recorded battery fingerprint is missing" };
  }
  const id = bundleSnapshotIdOf(fingerprint);
  for (const root of roots) {
    for (const candidate of [root, join(root, ".bundle-snapshots", id), join(root, ".sealed-bundles", id)]) {
      try {
        verifyTree(candidate, fingerprint, "digest measured product");
        return { root: candidate, gap: null };
      } catch {
        /* Try retained bytes; the trace root's current corpus may have changed. */
      }
    }
  }
  return { root: null, gap: `no retained product matches battery fingerprint ${id}` };
}

// An anonymous failure class: same rule, different task. Digits, quoted names and path-like
// tokens collapse so "main.c:81: missing ;" and "main.c:12: missing ;" are one class. Only the
// count of distinct classes leaves this function; the text never does.
function failureClass(message) {
  const normal = String(message)
    .toLowerCase()
    .replace(/"[^"]*"/g, '"?"')
    .replace(/[^\s]*\/[^\s]*/g, "<path>")
    .replace(/\b[\w.-]+\.(c|h|ts|js|json|py|cpp|hpp)\b(:\d+)*/g, "<file>")
    .replace(/\d+/g, "#");
  return new Bun.CryptoHasher("sha256").update(normal).digest("hex").slice(0, 12);
}

// A measured rejection follows the shared blocking-failure rule:
// `src/truth/verdict-binding.ts` (`blockingTruthFailure`) reads
// `issue.severity === "error" && issue.blocking !== false`, so an OMITTED `blocking` blocks.
// The field is optional in `CorrectnessModelIssue`. Historical Builder-authored evaluators could
// omit it: all 111 recorded issue rows of campaign w47-sol do, so the old `blocking === true`
// test counted zero shipping rejections there and called five live checks inert.
function blockingCheckIssue(issue) {
  return issue?.severity === "error" && issue.blocking !== false && isString(issue.checkId);
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function verdictJson(caseDir) {
  const runDir = dirname(dirname(caseDir));
  const name = existsSync(join(caseDir, "verifier.json")) ? "verifier.json" : "oracle.json";
  const recorded = recordedEvidence(runDir, `cases/${basename(caseDir)}/${name}`);
  if (!recorded.ok) return null;
  try {
    return JSON.parse(recorded.bytes);
  } catch {
    return null;
  }
}

function claimGroundings(claims) {
  const groundingByCheck = new Map();
  // Who supplied the external verifier the claim relies on. Two recorded shapes exist: runs before the
  // installed-tools change record a registry provenance (`solvability.registrySource`: operator,
  // admitted, slug-file or none); runs after it record the digest of the installed tools that ran
  // (`claim.statement.verifierEnvironmentHash`). The column names which shape it saw, so a reader
  // never mistakes a Builder-installed compiler for an operator-pinned one, or the reverse.
  const groundingSources = new Set();
  for (const claim of claims) {
    const statement = claim?.claim?.statement;
    for (const grounding of Array.isArray(statement?.groundings) ? statement.groundings : []) {
      groundingByCheck.set(grounding.checkId, grounding);
    }
    const registrySource = claim?.solvability?.registrySource;
    const environmentHash = statement?.verifierEnvironmentHash;
    if (registrySource !== undefined && registrySource !== null) {
      groundingSources.add(`engine-registry:${String(registrySource)}`);
    } else if (isString(environmentHash) && environmentHash.length > 0) {
      groundingSources.add(`installed-tool:${environmentHash.slice(0, 9)}`);
    } else if (environmentHash === null) groundingSources.add("in-process");
  }

  return { groundingByCheck, groundingSources };
}

function shippingEvidence(caseRows, caseRootOf) {
  const perCheck = new Map();
  let gradedOracleFiles = 0;
  const gaps = [];
  for (const row of caseRows) {
    if (row.acceptedSubmit !== true || !isBoolean(row.truthOk) || row.runtimeNonResultKind != null) continue;
    const root = caseRootOf.get(row) ?? null;
    if (root === null) {
      gaps.push(`${row.runId}/${row.taskId}: verdict root unresolved`);
      continue;
    }
    const oracle = verdictJson(join(root, "runs", row.runId, "cases", row.taskId));
    if (oracle === null || oracle.ok !== row.truthOk) {
      gaps.push(`${row.runId}/${row.taskId}: verdict missing, unverified or conflicting`);
      continue;
    }
    gradedOracleFiles += 1;
    for (const issue of Array.isArray(oracle.issues) ? oracle.issues : []) {
      if (!blockingCheckIssue(issue)) continue;
      const bucket = perCheck.get(issue.checkId) ?? { rejections: 0, classes: new Set() };
      bucket.rejections += 1;
      bucket.classes.add(failureClass(issue.message ?? ""));
      perCheck.set(issue.checkId, bucket);
    }
  }

  return { perCheck, gradedOracleFiles, gaps };
}

function contestedEvidence(campaign, caseRows, caseRootOf) {
  const contestedByCheck = new Map();
  // Contested rows (judge true / oracle false), attributed to the blocking checks of the exact
  // recorded oracle row the contest names.
  for (const name of existsSync(join(campaign, "analysis")) ? readdirSync(join(campaign, "analysis")) : []) {
    if (!name.endsWith("-judges.json")) continue;
    const judges = readJsonFileOrNull(join(campaign, "analysis", name));
    const groups = judges?.contested;
    if (groups === null || typeof groups !== "object") continue;
    for (const row of Object.values(groups).flatMap((rows) => (Array.isArray(rows) ? rows : []))) {
      if (!isString(row?.evidence)) continue;
      const caseDir = dirname(resolve(campaign, "..", "..", row.evidence));
      if (
        !caseRows.some((candidate) => {
          const root = caseRootOf.get(candidate);
          return (
            candidate.acceptedSubmit === true &&
            isBoolean(candidate.truthOk) &&
            candidate.runtimeNonResultKind == null &&
            root !== null &&
            root !== undefined &&
            caseDir === join(root, "runs", candidate.runId, "cases", candidate.taskId)
          );
        })
      ) {
        continue;
      }
      const oracle = verdictJson(caseDir);
      for (const issue of Array.isArray(oracle?.issues) ? oracle.issues : []) {
        if (!blockingCheckIssue(issue)) continue;
        contestedByCheck.set(issue.checkId, (contestedByCheck.get(issue.checkId) ?? 0) + 1);
      }
    }
  }

  return contestedByCheck;
}

function checkMatrix({
  checks,
  groundingByCheck,
  groundingSources,
  rejectRows,
  acceptRows,
  perCheck,
  gradedOracleFiles,
  contestedByCheck,
  agentText,
  caseRows,
  graderDir,
  bundleDir,
  bundleProvenance,
}) {
  const lines = [];
  // --- block 1: check x evidence matrix -------------------------------------------------------
  lines.push("## 1 declared check x evidence");
  lines.push(
    "Installed-tool receipts attest executable invocation and input binding; algorithm independence and the complete imported dependency chain remain unproved. Read assertions as declared scope, separating compilation, simulated behaviour and deployment.",
  );
  lines.push(
    "checkId                    kind               adapter            groundingSource            rejCtl mutCls shipRej shapes contested agentRef",
  );
  // Named for what the arithmetic shows: the control corpus exercises the check and no submission
  // ever tripped it. That can be a dead check or a competent solver, and the digest cannot tell
  // them apart — run truss-opus-20260907T210000000Z-6bf0e9 read "INERT" as dead checks over six
  // checks whose accepted artifacts sat hard against the published limits.
  const inert = [];
  for (const check of checks) {
    const grounding = groundingByCheck.get(check.id) ?? {
      kind: check?.grounding?.kind ?? "?",
      adapterId: null,
    };
    const isolating = rejectRows.filter((row) => row.expectedCheckId === check.id);
    const mutations = new Set(isolating.map((row) => row.mutationClass));
    const shipping = perCheck.get(check.id) ?? { rejections: 0, classes: new Set() };
    if (isolating.length > 0 && shipping.rejections === 0 && gradedOracleFiles > 0) inert.push(check.id);
    lines.push(
      pad(check.id, 27) +
        pad(grounding.kind ?? "?", 19) +
        pad(grounding.adapterId ?? "-", 19) +
        pad([...groundingSources].join(",") || "-", 27) +
        pad(isolating.length, 7) +
        pad(mutations.size, 7) +
        pad(shipping.rejections, 8) +
        pad(shipping.classes.size, 7) +
        pad(contestedByCheck.get(check.id) ?? 0, 10) +
        (agentText.includes(check.id) ? "yes" : "no"),
    );
  }
  // Checks, controls and measured rows are grouped by their recorded product identity. Before
  // that grouping, control counts came from the ADOPTED tree while shipping rejections came from whichever
  // battery root the case rows named, so a run whose measured battery was a candidate had an
  // rejCtl column describing a corpus the shipping column never measured, and the w19 review read
  // the two as one tree. The source is named on every digest so a fallback cannot pass for a
  // measured candidate.
  lines.push(`graded oracle rows: ${gradedOracleFiles} (from ${caseRows.length} terminal case rows)`);
  lines.push(
    `checks and controls read from ${graderDir === null ? "no resolved domain tree" : `${bundleProvenance} — ${basename(bundleDir)}/${basename(graderDir)}/controls.json`}` +
      (graderDir === null
        ? " — controls unresolved"
        : ` — accept ${acceptRows.length} · reject ${rejectRows.length}; a candidate battery may declare a different corpus`),
  );
  lines.push(
    graderDir === null
      ? "untripped in shipping: unobservable — no bound check corpus"
      : inert.length === 0
        ? "untripped in shipping: none — every isolatable check rejected shipping work at least once, or no graded rows exist"
        : `UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over ${gradedOracleFiles} graded rows): ${inert.join(", ")}`,
  );

  return lines;
}

function toolRosterLines(perTool, bundleDir, bundleProvenance) {
  const lines = [];
  // The roster and its descriptions belong to the bundle that graded these traces, not to
  // whatever tree is adopted now; an adopted-tree roster is labelled as the fallback it is.
  lines.push(`tool roster read from ${bundleProvenance}`);
  const specText =
    bundleDir === null ? null : readJsonFileOrNull(join(bundleDir, "agent", "tools-spec.json"));
  const descriptions = new Map();
  const specTools = Array.isArray(specText) ? specText : Array.isArray(specText?.tools) ? specText.tools : [];
  for (const tool of specTools) {
    if (isString(tool?.name)) descriptions.set(tool.name, String(tool.description ?? ""));
  }
  for (const [name, bucket] of [...perTool.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
    // Mean over the cases that call the tool at all: a per-family evaluator concentrated in
    // half the battery must not dilute below the repeat bar (w19's evaluate_power_contract
    // read 1.47/case over all 75 traces but 2.4/case over the 45 cases that used it).
    const mean = bucket.calls / bucket.cases;
    const description = descriptions.get(name) ?? "";
    // The verb may sit on either side of the noun. w46-opus's judge_pin_choice reads
    // "picked a candidate pin ... and want it judged" and the verb-first form alone missed it.
    const verbFirst =
      /(evaluat|check|test|verif|preview|appl|judg)\w*\b[^.]{0,60}\b(candidate|one |draft|answer)/i;
    const nounFirst = /\b(candidate|draft|answer)\b[^.]{0,60}\b(evaluat|check|test|verif|preview|judg)/i;
    const previewy = mean >= 1.5 && (verbFirst.test(description) || nounFirst.test(description));
    lines.push(
      `${pad(name, 27)}${pad(bucket.calls, 7)}${pad(`${bucket.cases}cs`, 7)}${pad(`${mean.toFixed(1)}/used`, 10)}${pad(bucket.errors, 4)}` +
        (previewy ? "ORACLE-PREVIEW SUSPECT: repeated per-case candidate evaluation via public tool" : ""),
    );
  }
  return lines;
}

function processCensus(caseRows, caseRootOf, bundleDir, bundleProvenance) {
  const lines = [];
  // --- block 1b: solver process census and oracle-preview suspects ----------------------------
  // From recorded case-trace/v2 files: how uniform is the solve, and does any public tool look
  // like a verdict previewer? A tool called repeatedly per case whose own description offers to
  // evaluate/check/test one candidate is the run-52/53/60 mechanism (decision procedure shipped
  // through the public interface) — w19 shipped `evaluate_power_contract`
  // this way and saturated both batteries by construction. The flag is a suspect, not a verdict:
  // angle 8 owns the disclosure judgement.
  lines.push("", "## 1b solver process (case-trace/v2)");
  const sequences = new Map();
  const perTool = new Map();
  let traced = 0;
  let traceErrors = 0;
  const turnCounts = new Set();
  for (const row of caseRows) {
    if (!Array.isArray(row.traces)) continue;
    // The same per-row root the check table used: the DIGEST-intact one, not the first root that
    // happens to carry the path. A campaign keeps archived copies of one battery under several
    // roots, so choosing by existence can read a drifted copy and drop the intact trace the
    // terminal row actually points at.
    const root = caseRootOf.get(row) ?? null;
    const trace = root === null ? null : readVerifiedTrace(row, root).trace;
    if (trace === null || !Array.isArray(trace.toolCalls)) continue;
    traced += 1;
    turnCounts.add(Array.isArray(trace.turns) ? trace.turns.length : null);
    const seq = trace.toolCalls.map((call) => call.toolName);
    sequences.set(seq.join(">"), (sequences.get(seq.join(">")) ?? 0) + 1);
    const seenInCase = new Set();
    for (const call of trace.toolCalls) {
      const bucket = perTool.get(call.toolName) ?? { calls: 0, errors: 0, cases: 0 };
      bucket.calls += 1;
      if (!seenInCase.has(call.toolName)) {
        bucket.cases += 1;
        seenInCase.add(call.toolName);
      }
      if (call.isError === true) {
        bucket.errors += 1;
        traceErrors += 1;
      }
      perTool.set(call.toolName, bucket);
    }
  }
  if (traced === 0) lines.push("no readable case traces");
  else {
    lines.push(
      `traces ${traced} · distinct tool sequences ${sequences.size} · tool errors ${traceErrors}` +
        ` · turns/case values {${[...turnCounts].join(",")}}`,
    );
    lines.push(...toolRosterLines(perTool, bundleDir, bundleProvenance));
  }

  return lines;
}

export function productEvidenceLines({
  campaign,
  caseRows,
  caseRootOf,
  bundleDir,
  bundleProvenance,
  decisions,
}) {
  const lines = [];
  const tallies = batteryTallies(caseRows);
  const bundleOf = (dir) =>
    dir === null
      ? null
      : ([join(dir, "correctness-model"), join(dir, "grader")].find((sub) => existsSync(sub)) ?? null);
  const runIds = new Set(caseRows.map((row) => row.runId));
  // --- gather recorded inputs -------------------------------------------------------------------
  // The per-case verdict file is verifier.json on current runs, oracle.json on older ones. The w34
  // review paid for reading only the old names: 0 graded rows and accept 0 / reject 0 from a tree
  // whose real corpus was 20/20.
  const graderDir = bundleOf(bundleDir);
  const brief = graderDir === null ? null : readJsonFileOrNull(join(graderDir, "brief.json"));
  const controls = graderDir === null ? null : readJsonFileOrNull(join(graderDir, "controls.json"));
  const checks = Array.isArray(brief?.truthChecks) ? brief.truthChecks : [];

  const claims = existsSync(join(campaign, "claims"))
    ? readdirSync(join(campaign, "claims"))
        .filter(
          (name) =>
            name.endsWith(".json") &&
            [...runIds].some(
              (runId) =>
                runId === name.slice(0, -5) ||
                runId.replace(/-(repair-)?(on|off)$/, "") === name.slice(0, -5),
            ),
        )
        .map((name) => readJsonFileOrNull(join(campaign, "claims", name)))
        .filter((value) => value !== null)
    : [];
  const { groundingByCheck, groundingSources } = claimGroundings(claims);

  const rejectRows = Array.isArray(controls?.reject) ? controls.reject : [];
  const acceptRows = Array.isArray(controls?.accept) ? controls.accept : [];

  // Shipping oracle rows from the terminal case ledger. A campaign may retain the same battery
  // under adopted and candidate roots (and, in campaigns measured before 2026-09-04, a contest
  // root nothing writes now), and may also carry F2 roots. The case row's first
  // digest-bound pointer chooses one physical root; directory presence alone is not membership.
  const { perCheck, gradedOracleFiles, gaps } = shippingEvidence(caseRows, caseRootOf);
  lines.push(...gaps.map((gap) => `shipping evidence gap: ${gap}`));
  const contestedByCheck = contestedEvidence(campaign, caseRows, caseRootOf);

  // Advisor reference: byte presence of the check id in top-level agent text files —
  // a weak signal. "yes" means a file contains the id; it does not establish that the text
  // reaches the solver or that a tool previews the verdict.
  const agentText =
    bundleDir === null
      ? ""
      : (existsSync(join(bundleDir, "agent")) ? readdirSync(join(bundleDir, "agent")) : [])
          .filter((name) => /\.(ts|js|json|md)$/.test(name))
          .map((name) => readFileSync(join(bundleDir, "agent", name), "utf8"))
          .join("\n");

  lines.push(
    ...checkMatrix({
      checks,
      groundingByCheck,
      groundingSources,
      rejectRows,
      acceptRows,
      perCheck,
      gradedOracleFiles,
      contestedByCheck,
      agentText,
      caseRows,
      graderDir,
      bundleDir,
      bundleProvenance,
    }),
  );

  lines.push(...processCensus(caseRows, caseRootOf, bundleDir, bundleProvenance));

  lines.push(
    ...checkInformativenessLines({ checks, rejectRows, perCheck, gradedOracleFiles, tallies, decisions }),
  );

  return lines;
}

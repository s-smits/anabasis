// Deterministic digest for the whole-run-investigation synthesis agent: compact, sanitised evidence
// joining recorded bytes the outcome CLI views do not join — the declared check set against the
// evidence that each check ever changed a decision, the Builder's submit/refusal ledger, condition
// symmetry, workshop and spend counters, and integrity probes.
//
// Reads recorded JSON only; never executes anything inside the reviewed campaign. The output is a
// committed artifact, so it carries counts and identities only: verifier issue text, remedies and
// expectations are bucketed into anonymous shape counts and never quoted.
//
// It stays JavaScript on purpose: the product blocks walk a measured bundle's raw brief, controls
// and tool spec as the battery recorded them, and the typed bundle loaders apply today's validators,
// which would refuse exactly the historical products a whole-run review has to read.

import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { classifyCaseOutcome, readCaseRecord } from "#src/claim/case-record.ts";
import { isCandidateSubmit, submitProjection } from "#src/author/builder-execution.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { campaignTraceRoots, readVerifiedTrace } from "#src/claim/trace-read.ts";
import { defaultProductDir } from "#src/meta/campaign-root.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import { recordedEvidence } from "#src/claim/evidence-log.ts";
import { readRecordedBatteryRecord } from "#src/truth/battery-record.ts";
import { bundleSnapshotIdOf } from "#src/claim/bundle-snapshot.ts";
import { verifyTree } from "#src/claim/bundle-snapshot-verify.ts";
import { CASE_TRACE_SCHEMA } from "#src/backends/trace-capture.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { TERMINAL_FILE } from "#src/run/controller-lineage.ts";
import { WORKSHOP_ACTION_FILE, foldWorkshopActions } from "#tools/outcome/builder-workshop-facts.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { terminalTraceRoot, traceCensus } from "./trace-challenge.ts";
import {
  admissionLedgerLines,
  bandPlacementLines,
  batteryTallies,
  builderMemoryLines,
  checkInformativenessLines,
  familyCoverageLines,
  judgeCensusLines,
  pad,
  readDifficultyDecisions,
  readJudgeReviews,
  repeatedConditionLines,
  roleSpendLines,
  servedModelLines,
} from "./digest-ledgers.mjs";
import { rehearsalLedgerLines, toolchainRetentionLines } from "./digest-rehearsal.mjs";

/** Trace location is not product identity: an adopted tree may retain older runs. The binding also
 *  returns the manifest-verified battery record it read, so every digest reader of `battery.json`
 *  takes these bytes rather than opening the file again unverified; it is null where none verified. */
export function measuredProductBinding(runId, roots) {
  let battery = null;
  for (const root of roots) {
    const runDir = join(root, "runs", runId);
    if (!existsSync(join(runDir, "battery.json"))) continue;
    try {
      const recorded = readRecordedBatteryRecord(runDir, runId);
      if (battery !== null && JSON.stringify(recorded) !== JSON.stringify(battery)) {
        return { root: null, gap: "conflicting battery copies", battery: null };
      }
      battery = recorded;
    } catch {
      return { root: null, gap: "battery unreadable or not manifest-verified", battery: null };
    }
  }
  const fingerprint = battery?.bundleSnapshot;
  const hash = (value) => isString(value) && /^[a-f0-9]{64}$/.test(value);
  if (
    !hash(fingerprint?.agentHash) ||
    !hash(fingerprint?.correctnessModelHash) ||
    !(fingerprint?.taskSetHash === null || hash(fingerprint?.taskSetHash))
  ) {
    return { root: null, gap: "recorded battery fingerprint is missing", battery };
  }
  const id = bundleSnapshotIdOf(fingerprint);
  for (const root of roots) {
    for (const candidate of [root, join(root, ".bundle-snapshots", id), join(root, ".sealed-bundles", id)]) {
      try {
        verifyTree(candidate, fingerprint, "digest measured product");
        return { root: candidate, gap: null, battery };
      } catch {
        /* Try retained bytes; the trace root's current corpus may have changed. */
      }
    }
  }
  return { root: null, gap: `no retained product matches battery fingerprint ${id}`, battery };
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
  return sha256(normal).slice(0, 12);
}

/** The case's recorded verdict. `verification-runner.ts` writes it as `cases/<task>/verifier.json`
 *  and under no other name. */
function verdictJson(caseDir) {
  const runDir = dirname(dirname(caseDir));
  const recorded = recordedEvidence(runDir, `cases/${basename(caseDir)}/verifier.json`);
  if (!recorded.ok) return null;
  try {
    return JSON.parse(recorded.bytes);
  } catch {
    return null;
  }
}

function claimGroundings(claims) {
  const groundingByCheck = new Map();
  // Which installed tools the claim's verifier ran, by the digest the claim records
  // (`claim.statement.verifierEnvironmentHash`, null when nothing ran outside the process).
  const groundingSources = new Set();
  for (const claim of claims) {
    const statement = claim?.claim?.statement;
    for (const grounding of Array.isArray(statement?.groundings) ? statement.groundings : []) {
      groundingByCheck.set(grounding.checkId, grounding);
    }
    const environmentHash = statement?.verifierEnvironmentHash;
    if (isString(environmentHash) && environmentHash.length > 0) {
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
    const outcome = classifyCaseOutcome(row);
    if (outcome !== "pass" && outcome !== "fail") continue;
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
    // A measured rejection follows the shared blocking-failure rule:
    // `src/truth/verdict-binding.ts` (`blockingTruthFailure`) reads
    // `issue.severity === "error" && issue.blocking !== false`, so an OMITTED `blocking` blocks.
    // The field is optional in `CorrectnessModelIssue`, so a `blocking === true` test counts no
    // rejection from an evaluator that omits it and calls its live checks inert.
    for (const issue of Array.isArray(oracle.issues) ? oracle.issues : []) {
      if (issue?.severity !== "error" || issue.blocking === false || !isString(issue.checkId)) continue;
      const bucket = perCheck.get(issue.checkId) ?? { rejections: 0, classes: new Set() };
      bucket.rejections += 1;
      bucket.classes.add(failureClass(issue.message ?? ""));
      perCheck.set(issue.checkId, bucket);
    }
  }

  return { perCheck, gradedOracleFiles, gaps };
}

/**
 * Judge/verifier contradictions per declared check, over this product's verified cases. The review
 * records `contested` as one flat `ContestedCase[]` for its `runId` (`contestedCases` in
 * `src/analyse/judge-contested.ts`), and each row already names the checks it contests in
 * `checkIds`: the verifier's failing checks under a Judge pass, the checks whose assertions a
 * Judge fail cited. This reader counts those as written rather than re-deriving them.
 */
function contestedEvidence(judgeReviews, caseRows) {
  const contestedByCheck = new Map();
  const verified = new Set(
    caseRows.flatMap((row) => {
      const outcome = classifyCaseOutcome(row);
      return outcome === "pass" || outcome === "fail" ? [`${row.runId}\u0000${row.taskId}`] : [];
    }),
  );
  const checkIds = judgeReviews.rows.flatMap((judges) =>
    judges.contested.flatMap((row) =>
      verified.has(`${judges.runId}\u0000${row?.taskId}`) && Array.isArray(row.checkIds) ? row.checkIds : [],
    ),
  );
  for (const checkId of checkIds) {
    if (isString(checkId)) contestedByCheck.set(checkId, (contestedByCheck.get(checkId) ?? 0) + 1);
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
  // them apart — a reading of "inert" as dead checks has been wrong where every accepted artifact
  // sat hard against the published limits the checks enforce.
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
  // rejCtl column describing a corpus the shipping column never measured, and a reader took the
  // two as one tree. The source is named on every digest so a fallback cannot pass for a
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

function toolRosterLines(tools, bundleDir, bundleProvenance) {
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
  for (const bucket of tools) {
    const name = bucket.name;
    // Mean over the cases that call the tool at all: a per-family evaluator concentrated in
    // half the battery must not dilute below the repeat bar: a tool used in most cases of one
    // family reads below the bar over the whole battery and above it over the cases that used it.
    const mean = bucket.calls / bucket.cases;
    const description = descriptions.get(name) ?? "";
    // The verb may sit on either side of the noun: a description reading "picked a candidate
    // ... and want it judged" is missed by the verb-first form alone.
    const verbFirst =
      /(evaluat|check|test|verif|preview|appl|judg)\w*\b[^.]{0,60}\b(candidate|one |draft|answer)/i;
    const nounFirst = /\b(candidate|draft|answer)\b[^.]{0,60}\b(evaluat|check|test|verif|preview|judg)/i;
    const previewy = mean >= 1.5 && (verbFirst.test(description) || nounFirst.test(description));
    lines.push(
      `${pad(name, 27)}${pad(bucket.calls, 7)}${pad(`${bucket.cases}cs`, 7)}${pad(`${mean.toFixed(1)}/used`, 10)}${bucket.errors}`,
    );
    // Its own line, so the overview groups it: a trigger printed after a table row never groups.
    if (previewy) {
      lines.push(
        `CHECK TOOL IN SOLVER TRACE (lane 23): ${name} repeated per-case candidate evaluation via public tool`,
      );
    }
  }
  return lines;
}

function processCensus(caseRows, caseRootOf, bundleDir, bundleProvenance) {
  // --- block 1b: solver process census and oracle-preview suspects ----------------------------
  // How uniform is the solve, and does any public tool look like a verdict previewer? A tool
  // called repeatedly per case whose own description offers to evaluate or check one candidate is
  // the mechanism of a decision procedure shipped through the public interface, which saturates a
  // battery by construction. The flag is a suspect, not a verdict: the trace-challenge lane owns
  // the disclosure judgement. Each row's trace is read from the digest-intact root the check table used, and
  // counted by the same census the trace-challenge telemetry reports.
  const lines = ["", `## 1b solver process (${CASE_TRACE_SCHEMA})`];
  const census = traceCensus(
    caseRows.map((row) => {
      const root = caseRootOf.get(row) ?? null;
      return {
        runId: row.runId,
        taskId: row.taskId,
        family: row.family,
        outcome: classifyCaseOutcome(row),
        trace: root === null ? null : readVerifiedTrace(row, root).trace,
      };
    }),
  );
  if (census.cases.recorded === 0) return [...lines, "no readable case traces"];
  const errors = census.tools.reduce((sum, tool) => sum + tool.errors, 0);
  const turns = census.turnSpread;
  lines.push(
    `traces ${census.cases.recorded} · distinct tool sequences ${census.sequences.distinct} · tool errors ${errors}` +
      (turns === null ? "" : ` · turns/case min ${turns.min} median ${turns.median} max ${turns.max}`),
  );
  lines.push(...toolRosterLines(census.tools, bundleDir, bundleProvenance));
  return lines;
}

export function productEvidenceLines({
  campaign,
  caseRows,
  caseRootOf,
  bundleDir,
  bundleProvenance,
  decisions,
  judgeReviews,
}) {
  const lines = [];
  const tallies = batteryTallies(caseRows);
  const runIds = new Set(caseRows.map((row) => row.runId));
  // --- gather recorded inputs -------------------------------------------------------------------
  const graderDir =
    bundleDir !== null && existsSync(join(bundleDir, "correctness-model"))
      ? join(bundleDir, "correctness-model")
      : null;
  const brief = graderDir === null ? null : readJsonFileOrNull(join(graderDir, "brief.json"));
  const controls = graderDir === null ? null : readJsonFileOrNull(join(graderDir, "controls.json"));
  const checks = Array.isArray(brief?.truthChecks) ? brief.truthChecks : [];

  const claims = existsSync(join(campaign, "claims"))
    ? readdirSync(join(campaign, "claims"))
        .filter((name) => name.endsWith(".json") && runIds.has(name.slice(0, -5)))
        .map((name) => readJsonFileOrNull(join(campaign, "claims", name)))
        .filter((value) => value !== null)
    : [];
  const { groundingByCheck, groundingSources } = claimGroundings(claims);

  const rejectRows = Array.isArray(controls?.reject) ? controls.reject : [];
  const acceptRows = Array.isArray(controls?.accept) ? controls.accept : [];

  // Shipping oracle rows from the terminal case ledger. A campaign may retain the same battery
  // under adopted and candidate roots, and may also carry F2 roots. The case row's first
  // digest-bound pointer chooses one physical root; directory presence alone is not membership.
  const { perCheck, gradedOracleFiles, gaps } = shippingEvidence(caseRows, caseRootOf);
  lines.push(...gaps.map((gap) => `shipping evidence gap: ${gap}`));
  const contestedByCheck = contestedEvidence(judgeReviews, caseRows);

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

// --- run-wide blocks --------------------------------------------------------------------------

function outcomeCounts(submits) {
  const counts = new Map();
  for (const submit of submits) counts.set(submit.outcome, (counts.get(submit.outcome) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => `${key}:${count}`).join(" ") || "none";
}

/** The case ledger through its strict owner reader; a damaged ledger is reported, never half-read.
 *  One case can appear more than once, because an archival copy of a recorded row is written beside
 *  the original. Counting both inflates a denominator, and a naive dedupe by (run, task, variant)
 *  would hide a real disagreement between two rows claiming to be the same case, so only
 *  byte-identical copies collapse and a divergent duplicate is reported. */
function selectedCaseRows(campaign, runIds) {
  let rows;
  try {
    rows = readCaseRecord(join(campaign, "case-record.jsonl")).map((entry) => entry.row);
  } catch (error) {
    return { rows: [], refusal: errorMessage(error), collapsed: 0, divergent: [] };
  }
  const wanted =
    runIds.length === 0
      ? rows
      : rows.filter((row) => runIds.some((id) => isControllerBatteryRunId(id, row.runId)));
  const seen = new Map();
  const kept = [];
  const divergent = [];
  let collapsed = 0;
  for (const row of wanted) {
    const key = [row.runId, row.taskId, row.condition?.variant ?? ""].join("\u0000");
    const digest = sha256(JSON.stringify(row)).slice(0, 12);
    const before = seen.get(key);
    if (before === undefined) {
      seen.set(key, digest);
      kept.push(row);
    } else if (before === digest) collapsed += 1;
    else divergent.push(`${row.runId}/${row.taskId}${row.condition ? `/${row.condition.variant}` : ""}`);
  }
  return { rows: kept, refusal: null, collapsed, divergent };
}

/** Every epoch's execution records through the strict current-schema reader, labelled by the file
 *  each session writes: the bare file is session 1. A record the reader refuses is named, never
 *  half-read. */
function readExecutions(epochDirs) {
  const records = [];
  const unavailable = [];
  for (const dir of epochDirs) {
    const read = readExecutionEvidenceDetails(dir);
    read.records.forEach((record, index) => {
      const session = read.sessions[index] ?? 1;
      const file =
        session === 1
          ? "builder-execution.json"
          : `builder-execution-${String(session).padStart(2, "0")}.json`;
      records.push({ epoch: basename(dir), file, session, record });
    });
    unavailable.push(...read.unavailable);
  }
  return { records, unavailable };
}

// Family sequence: each distinct finding-code SET gets a letter, so "A A A A A A A B A C D E F G H
// OK" is readable at a glance. A repeated letter means the code set recurred; a new letter proves a
// different code set, not progress.
function candidateSequenceLines(candidate) {
  if (candidate.length === 0) return [];
  const letterOf = new Map();
  const steps = candidate.map((submit) => {
    if (submit.outcome === "accepted") return "OK";
    const key = [...new Set(submit.findingCodes ?? [])].sort().join("|");
    if (!letterOf.has(key)) letterOf.set(key, String.fromCharCode(65 + letterOf.size));
    return letterOf.get(key);
  });
  return [
    `  candidate sequence: ${steps.join(" ")}`,
    ...[...letterOf].map(
      ([key, letter]) => `  ${letter} = {${key.split("|").filter(Boolean).join(", ") || "no finding codes"}}`,
    ),
  ];
}

// A terminal flag describes how a submit ended, not what kind of row it is: a genuine candidate can
// be terminal and stays in candidate counts. The producer's own `kind` alone moves a row to the
// controller side, through the predicate the producer uses.
function submitLedgerLines(executions) {
  const lines = ["", "## 2 submit and refusal ledger (per builder-execution record)"];
  if (executions.records.length === 0 && executions.unavailable.length === 0) {
    lines.push("no builder-execution records");
  }
  for (const { epoch, file, record } of executions.records) {
    const candidate = record.submits.filter(isCandidateSubmit);
    const controller = record.submits.filter((submit) => !isCandidateSubmit(submit));
    const digests = new Map();
    for (const submit of candidate) {
      if (isString(submit.findingsDigest)) {
        digests.set(submit.findingsDigest, (digests.get(submit.findingsDigest) ?? 0) + 1);
      }
    }
    const top = [...digests.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    // The record stores the rows alone; every count here is derived from them.
    const counts = submitProjection(record.submits);
    lines.push(
      `${epoch}/${file}: ${record.submits.length} submits (${outcomeCounts(record.submits)})` +
        ` · candidate submits ${candidate.length} (${outcomeCounts(candidate)})` +
        ` · controller terminals ${controller.length} (${outcomeCounts(controller)})` +
        ` · topFindingsDigest ${top === null ? "-" : `${top[0].slice(0, 8)} x${top[1]}`}` +
        ` · candidate trees ${counts.uniqueCandidateTrees}` +
        ` · repeatedFindings ${counts.repeatedFindingSubmits}` +
        ` · unchangedTree ${counts.unchangedTreeSubmits} · outcome ${record.outcome}`,
    );
    if (controller.length > 0) {
      const commits = [...new Set(controller.map((submit) => submit.commit).filter(isString))];
      lines.push(`  controller terminal commits: ${commits.join(", ") || "<missing>"}`);
    }
    lines.push(...candidateSequenceLines(candidate));
  }
  lines.push(...executions.unavailable.map((reason) => `EXECUTION RECORD UNAVAILABLE: ${reason}`));
  return lines;
}

function workshopSpendLines(epochDirs, executions) {
  const lines = ["", "## 4 workshop and spend"];
  for (const dir of epochDirs) {
    const path = join(dir, WORKSHOP_ACTION_FILE);
    if (!existsSync(path)) continue;
    let census;
    try {
      census = foldWorkshopActions(path);
    } catch (error) {
      lines.push(`${basename(dir)}: WORKSHOP LEDGER REFUSED — ${errorMessage(error)}`);
      continue;
    }
    const failed = census.actions - census.completed;
    if (census.actions > 0) {
      lines.push(
        `${basename(dir)}: workshop ${census.actions} actions, ${failed} not completed (${Math.round((failed / census.actions) * 100)}%)`,
      );
    }
  }
  for (const { epoch, record } of executions.records) {
    const { usage } = record;
    lines.push(
      `${epoch}: toolCalls ${record.toolCalls.total} (${record.toolCalls.failed} failed)` +
        ` · tokens in ${usage.inputTokens ?? "null"} out ${usage.outputTokens ?? "null"} · costUsd ${usage.costUsd ?? "null"}`,
    );
  }
  return lines;
}

function integrityLines(campaign, executions, caseRows) {
  const lines = ["", "## 5 integrity probes"];
  const orphans = [];
  // A raw scan on purpose: an interrupted atomic write leaves exactly the file the strict owner refuses.
  const controllerDir = join(campaign, "controller");
  for (const entry of existsSync(controllerDir) ? readdirSync(controllerDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    for (const name of readdirSync(join(controllerDir, entry.name))) {
      if (name.startsWith(`${TERMINAL_FILE}.tmp-`)) orphans.push(`${entry.name}/${name}`);
    }
  }
  lines.push(
    orphans.length === 0
      ? "orphan terminal tmp files: 0"
      : `ORPHAN terminal tmp files: ${orphans.join(", ")}`,
  );
  const primary = executions.records.filter((entry) => entry.session === 1).length;
  lines.push(
    `builder-execution records: ${primary} primary bare (first session), ${executions.records.length - primary} numbered (later sessions)`,
    "builder-execution overwrite risk: filename alone is not evidence; require a producer/source proof that two sessions wrote one path",
  );
  // The recorded row restates the battery case's solver instants as `solverStartedAt` and
  // `solverEndedAt`.
  const instants = caseRows.filter((row) => isString(row.solverStartedAt)).length;
  lines.push(`case rows with solver instants: ${instants} of ${caseRows.length}`);
  return lines;
}

/** The product root each battery measured, and the product evidence blocks for each root. */
function productLines({ campaign, caseRows, traceRoots, domainDir, decisions, judgeReviews }) {
  const lines = [];
  const caseRootOf = new Map(caseRows.map((row) => [row, terminalTraceRoot(row, traceRoots)]));
  const bindings = new Map(
    [...new Set(caseRows.map((row) => row.runId))].map((runId) => [
      runId,
      measuredProductBinding(runId, traceRoots),
    ]),
  );
  for (const [runId, binding] of bindings) {
    if (binding.gap !== null) lines.push(`product binding unresolved: ${runId} — ${binding.gap}`);
  }
  const productRows = new Map();
  for (const row of caseRows) {
    const root = bindings.get(row.runId).root;
    productRows.set(root, [...(productRows.get(root) ?? []), row]);
  }
  if (productRows.size === 0) productRows.set(null, []);
  for (const [root, rows] of productRows) {
    const bundleProvenance =
      root === null
        ? "unresolved; no measured check corpus or tool roster"
        : root === domainDir
          ? `measured adopted-tree ${basename(root)}`
          : `measured candidate ${basename(root)}`;
    lines.push(
      `product root: ${root ?? "unresolved"} · batteries: ${[...new Set(rows.map((row) => row.runId))].join(", ") || "none"}`,
      ...productEvidenceLines({
        campaign,
        caseRows: rows,
        caseRootOf,
        bundleDir: root,
        bundleProvenance,
        decisions,
        judgeReviews,
      }),
    );
  }
  // The battery behind a run id is the manifest-verified record its product binding already read,
  // so no second reader opens battery.json unverified.
  return { lines, batteryOf: (runId) => bindings.get(runId)?.battery ?? null };
}

export function buildDigest({ campaign: campaignPath, domainsRoot, runIds = [] }) {
  const campaign = resolve(campaignPath);
  const campaignName = basename(campaign);
  // Resolve the domain from the last readable epoch slug in recorded epoch order, falling back to
  // the campaign directory name. The slug, not the campaign name, keys domains/<slug>.
  const epochDirs = campaignEpochs(campaign).map((epoch) => join(campaign, epoch));
  const slug = epochDirs
    .map((dir) => readJsonFileOrNull(join(dir, "campaign.json"))?.slug)
    .reduce((last, value) => (isString(value) ? value : last), campaignName);
  const domainDir =
    [join(resolve(domainsRoot), slug), defaultProductDir(dirname(dirname(campaign)), slug)]
      .map((dir) => resolve(dir))
      .find((dir) => existsSync(dir)) ?? null;
  const selection = selectedCaseRows(campaign, runIds);
  const caseRows = selection.rows;
  const traceRoots = [
    ...new Set([campaign, ...(domainDir === null ? [] : [domainDir]), ...campaignTraceRoots(campaign)]),
  ];
  const tallies = batteryTallies(caseRows);
  const difficulty = readDifficultyDecisions(campaign);
  const decisions = difficulty.rows;
  const judgeReviews = readJudgeReviews(campaign);
  const executions = readExecutions(epochDirs);
  const lines = [`# deterministic digest — ${campaignName}`, ""];
  if (selection.refusal !== null) lines.push(`CASE RECORD REFUSED — ${selection.refusal}`);
  const products = productLines({ campaign, caseRows, traceRoots, domainDir, decisions, judgeReviews });
  const { batteryOf } = products;
  lines.push(...products.lines, ...submitLedgerLines(executions), ...judgeCensusLines({ judgeReviews }));

  lines.push("", "## 3 condition symmetry (case-record.jsonl)");
  for (const tally of tallies) {
    lines.push(
      `${tally.runId}: graded ${tally.verified} · unaccepted ${tally.unaccepted} · non-result ${tally.nonResults}`,
    );
  }
  if (selection.collapsed > 0) {
    lines.push(`collapsed ${selection.collapsed} byte-identical duplicate case rows`);
  }
  if (selection.divergent.length > 0) {
    lines.push(
      `DIVERGENT DUPLICATES (same case key, different bytes): ${[...new Set(selection.divergent)].join(", ")}`,
    );
  }
  if (caseRows.length === 0) lines.push("no terminal case rows");
  lines.push(
    ...familyCoverageLines({ tallies }),
    ...repeatedConditionLines({ caseRows, batteryOf }),
    ...workshopSpendLines(epochDirs, executions),
    ...roleSpendLines({ campaign, tallies, batteryOf, decisions, executions }),
    // One line per recorded difficulty decision: the action the controller selected and, where it
    // placed a battery, where on the band it landed and what target it was measured against. The
    // record owns the placement, so the digest reports it and never re-derives one.
    ...bandPlacementLines(difficulty),
    ...admissionLedgerLines({ campaign }),
    ...builderMemoryLines({ epochDirs }),
    ...integrityLines(campaign, executions, caseRows),
    ...servedModelLines({ campaign, tallies, batteryOf }),
    ...rehearsalLedgerLines({ executions, epochDirs }),
    ...toolchainRetentionLines({ campaign }),
    "",
    "sequence census lives in trace-challenge trace-telemetry.json, not here",
  );
  return `${lines.join("\n")}\n`;
}

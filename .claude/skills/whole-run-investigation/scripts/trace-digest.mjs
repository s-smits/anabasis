// Deterministic digest for the whole-run-investigation synthesis agent: compact, sanitised evidence
// joining recorded bytes the outcome CLI views do not join — the declared check set against the
// evidence that each check ever changed a decision, the Builder's submit/refusal ledger, condition
// symmetry with surviving pairs, workshop and spend counters, and integrity probes.
//
// Reads recorded JSON only; never executes anything inside the reviewed campaign. The output is a
// committed artifact, so it carries counts and identities only: verifier issue text, remedies and
// expectations are bucketed into anonymous shape counts and never quoted.

import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { verifyTracePointers } from "#src/claim/case-record.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { measuredProductBinding, productEvidenceLines } from "./digest-product-evidence.mjs";
import {
  admissionLedgerLines,
  batteryTallies,
  builderMemoryLines,
  familyCoverageLines,
  judgeCensusLines,
  readDifficultyDecisions,
  repeatedConditionLines,
  roleSpendLines,
  servedModelLines,
} from "./digest-ledgers.mjs";
import { isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push(null);
    }
  }
  return rows;
}

function listDirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

function pct(part, whole) {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

// A terminal flag describes how a submit ended, not what kind of row it is. A genuine candidate
// can be terminal (for example, a verifier-required refusal) and must remain in candidate counts.
// Only the producer's own kind/origin field moves a row to the controller side; a commit that
// reads like a boundary does not.
function submitKind(submit) {
  const explicit = submit?.kind ?? submit?.origin;
  return explicit === "controller-terminal" || explicit === "controller_terminal"
    ? "controller-terminal"
    : "candidate";
}

function partitionSubmits(record) {
  const submits = Array.isArray(record?.submits) ? record.submits : [];
  return {
    submits,
    candidate: submits.filter((submit) => submitKind(submit) === "candidate"),
    controller: submits.filter((submit) => submitKind(submit) === "controller-terminal"),
  };
}

function outcomeCounts(submits) {
  const counts = new Map();
  for (const submit of submits) counts.set(submit?.outcome, (counts.get(submit?.outcome) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => `${key}:${count}`).join(" ") || "none";
}

// The contract-root identity the controller recorded, and the commit for a record written before
// 2026-09-20 -- the same fallback src/author/builder-execution.ts reads, so the derivation here
// stays an independent recount of the same quantity rather than a second definition of it.
function candidateTreeKey(submit) {
  for (const key of ["treeId", "commit"]) {
    if (isString(submit?.[key]) && submit[key].length > 0) return submit[key];
  }
  return "<missing-commit>";
}

function selectedCaseRows(campaign, runIds) {
  const rows = readJsonl(join(campaign, "case-record.jsonl"))
    .map((entry) => entry?.row)
    .filter((row) => row !== null && row !== undefined);
  if (!Array.isArray(runIds) || runIds.length === 0) return rows;
  return rows.filter((row) =>
    runIds.some((runId) => row.runId === runId || row.runId.startsWith(`${runId}-`)),
  );
}

function terminalCaseRoot(row, roots) {
  const first = Array.isArray(row.traces) ? row.traces[0] : undefined;
  if (first === undefined) return null;
  for (const root of roots) {
    if (!existsSync(join(root, first.path))) continue;
    if (verifyTracePointers({ traces: [first] }, root)[0]?.state === "intact") return root;
  }
  return null;
}

export function buildDigest({ campaign: campaignPath, domainsRoot, runIds = [] }) {
  const campaign = resolve(campaignPath);
  const lines = [];
  const campaignName = basename(campaign);

  // Resolve the domain from the last readable epoch slug in directory-list order, falling back to the
  // campaign directory name. The slug, not the campaign name, keys domains/<slug>.
  let slug = campaignName;
  const epochDirs = listDirs(campaign).filter((dir) => basename(dir).startsWith("epoch-"));
  for (const dir of epochDirs) {
    const meta = readJsonFileOrNull(join(dir, "campaign.json"));
    if (meta !== null && isString(meta.slug)) slug = meta.slug;
  }
  const domainDir =
    [join(resolve(domainsRoot), slug), join(dirname(campaign), "..", "domains", slug)]
      .map((dir) => resolve(dir))
      .find((dir) => existsSync(dir)) ?? null;
  const rawCaseRows = selectedCaseRows(campaign, runIds);
  const caseRows = [];
  const seen = new Map();
  const divergent = [];
  let collapsed = 0;
  for (const row of rawCaseRows) {
    const key = [row.runId, row.taskId, row.variant ?? "", row.caseId ?? ""].join("\u0000");
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 12);
    const before = seen.get(key);
    if (before !== undefined) {
      if (before === digest) collapsed += 1;
      else divergent.push(`${row.runId}/${row.taskId}${row.variant ? `/${row.variant}` : ""}`);
      continue;
    }
    seen.set(key, digest);
    caseRows.push(row);
  }
  const traceRoots = [
    campaign,
    ...(domainDir === null ? [] : [domainDir]),
    ...campaignTraceRoots(campaign),
  ].filter((root, index, roots) => roots.indexOf(root) === index);

  const caseRootOf = new Map();
  for (const row of caseRows) {
    const root = terminalCaseRoot(row, traceRoots);
    caseRootOf.set(row, root);
  }
  // Shared inputs for the ledgers added on 2026-09-08 (digest-ledgers.mjs): per-battery tallies in
  // case-record order, the recorded difficulty decisions, and the battery record behind a run id,
  // read from the same digest-bound root that graded its rows.
  const tallies = batteryTallies(caseRows);
  const decisions = readDifficultyDecisions(campaign);
  // A fully censored battery has no trace, so no row of it resolves a root of its own; try the
  // roots its own rows name first, then every root another battery resolved, then the adopted tree.
  const batteryOf = (runId) => {
    const own = caseRows.flatMap((candidate) =>
      candidate.runId === runId ? [caseRootOf.get(candidate) ?? null] : [],
    );
    const roots = [
      ...new Set([...own, ...caseRootOf.values(), domainDir, ...traceRoots].filter((root) => isString(root))),
    ];
    for (const root of roots) {
      const path = join(root, "runs", runId, "battery.json");
      if (existsSync(path)) return readJsonFileOrNull(path);
    }
    return null;
  };
  lines.push(`# deterministic digest — ${campaignName}`, "");
  const productRows = new Map();
  const bindings = new Map(
    [...new Set(caseRows.map((row) => row.runId))].map((runId) => [
      runId,
      measuredProductBinding(runId, traceRoots),
    ]),
  );
  for (const [runId, binding] of bindings) {
    if (binding.gap !== null) lines.push(`product binding unresolved: ${runId} — ${binding.gap}`);
  }
  for (const row of caseRows) {
    const root = bindings.get(row.runId).root;
    const group = productRows.get(root) ?? [];
    group.push(row);
    productRows.set(root, group);
  }
  if (productRows.size === 0) productRows.set(null, []);
  for (const [root, rows] of productRows) {
    const bundleDir = root;
    const bundleProvenance =
      root === null
        ? "unresolved; no measured check corpus or tool roster"
        : root === domainDir
          ? `measured adopted-tree ${basename(root)}`
          : `measured candidate ${basename(root)}`;
    lines.push(
      `product root: ${root ?? "unresolved"} · batteries: ${[...new Set(rows.map((row) => row.runId))].join(", ") || "none"}`,
    );
    lines.push(
      ...productEvidenceLines({
        campaign,
        caseRows: rows,
        caseRootOf,
        bundleDir,
        bundleProvenance,
        decisions,
      }),
    );
  }

  // --- block 2: submit and refusal ledger -----------------------------------------------------
  lines.push("", "## 2 submit and refusal ledger (per builder-execution record)");
  const executionFiles = [];
  for (const dir of epochDirs) {
    for (const name of readdirSync(dir)) {
      if (/^builder-execution(-\d+)?\.json$/.test(name)) executionFiles.push(join(dir, name));
    }
  }
  const orderedExecutionFiles = [...executionFiles].sort((left, right) => {
    const epochOrder = basename(dirname(left)).localeCompare(basename(dirname(right)));
    if (epochOrder !== 0) return epochOrder;
    const sessionNumber = (file) => {
      const name = basename(file);
      if (name === "builder-execution.json") return 1;
      const match = /^builder-execution-(\d+)\.json$/.exec(name);
      return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
    };
    return sessionNumber(left) - sessionNumber(right) || basename(left).localeCompare(basename(right));
  });
  if (executionFiles.length === 0) lines.push("no builder-execution records");
  for (const file of orderedExecutionFiles) {
    const record = readJsonFileOrNull(file);
    const { submits, candidate, controller } = partitionSubmits(record);
    const digests = new Map();
    for (const submit of candidate) {
      if (isString(submit.findingsDigest)) {
        digests.set(submit.findingsDigest, (digests.get(submit.findingsDigest) ?? 0) + 1);
      }
    }
    const topDigest = [...digests.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const candidateTrees = new Set(candidate.map(candidateTreeKey));
    const candidateRepeated = candidate.filter((submit) => submit?.repeatedFindings === true).length;
    const candidateUnchanged = candidate.filter((submit) => submit?.workspaceChanged === false).length;
    const rawIntegrityMismatches = [];
    if (isNumber(record?.uniqueCandidateTrees) && record.uniqueCandidateTrees !== candidateTrees.size) {
      rawIntegrityMismatches.push(
        `uniqueCandidateTrees recorded ${record.uniqueCandidateTrees}, derived candidate trees ${candidateTrees.size}`,
      );
    }
    if (isNumber(record?.repeatedFindingSubmits) && record.repeatedFindingSubmits !== candidateRepeated) {
      rawIntegrityMismatches.push(
        `repeatedFindingSubmits recorded ${record.repeatedFindingSubmits}, derived candidate repeats ${candidateRepeated}`,
      );
    }
    if (isNumber(record?.unchangedTreeSubmits) && record.unchangedTreeSubmits !== candidateUnchanged) {
      rawIntegrityMismatches.push(
        `unchangedTreeSubmits recorded ${record.unchangedTreeSubmits}, derived candidate unchanged ${candidateUnchanged}`,
      );
    }
    lines.push(
      `${basename(dirname(file))}/${basename(file)}: ${submits.length} submits (` +
        `${outcomeCounts(submits)})` +
        ` · candidate submits ${candidate.length} (${outcomeCounts(candidate)})` +
        ` · controller terminals ${controller.length} (${outcomeCounts(controller)})` +
        ` · topFindingsDigest ${topDigest === null ? "-" : `${topDigest[0].slice(0, 8)} x${topDigest[1]}`}` +
        ` · candidate trees ${candidateTrees.size}` +
        ` · recorded trees ${record?.uniqueCandidateTrees ?? "?"}` +
        ` · repeatedFindings ${record?.repeatedFindingSubmits ?? "?"}` +
        ` · unchangedTree ${record?.unchangedTreeSubmits ?? "?"} · outcome ${record?.outcome ?? "?"}`,
    );
    if (controller.length > 0) {
      const commits = [
        ...new Set(controller.map((submit) => submit?.commit).filter((commit) => isString(commit))),
      ];
      lines.push(`  controller terminal commits: ${commits.join(", ") || "<missing>"}`);
    }
    if (rawIntegrityMismatches.length > 0) {
      lines.push(`  INTEGRITY MISMATCH (raw record preserved): ${rawIntegrityMismatches.join("; ")}`);
    }
    // Family sequence: each distinct finding-code SET gets a letter, so "A A A A A A A B A C D
    // E F G H OK" is readable at a glance. A repeated letter means the code set recurred;
    // a new letter proves a different code set, not progress. The w19 review's strictness session
    // had to hand-reconstruct exactly this from raw submit rows.
    if (candidate.length > 0) {
      const familyByKey = new Map();
      const steps = candidate.map((submit) => {
        if (submit.outcome === "accepted") return "OK";
        const key = [...new Set(Array.isArray(submit.findingCodes) ? submit.findingCodes : [])]
          .sort()
          .join("|");
        if (!familyByKey.has(key)) familyByKey.set(key, String.fromCharCode(65 + familyByKey.size));
        return familyByKey.get(key);
      });
      lines.push(`  candidate sequence: ${steps.join(" ")}`);
      for (const [key, letter] of familyByKey) {
        lines.push(`  ${letter} = {${key.split("|").filter(Boolean).join(", ") || "no finding codes"}}`);
      }
    }
  }

  lines.push(...judgeCensusLines({ campaign }));

  // --- block 3: condition symmetry ------------------------------------------------------------------
  lines.push("", "## 3 condition symmetry (case-record.jsonl)");
  // One case can appear in this ledger more than once: an archival copy of the same recorded row is
  // written beside the original. Counting both inflates a denominator, and a naive dedupe by
  // (run, task, variant) would hide a real disagreement between two rows claiming to be the same
  // case. Collapse only byte-identical copies, and report a divergent duplicate as a finding.
  const byRun = new Map();
  for (const row of caseRows) {
    const bucket = byRun.get(row.runId) ?? { graded: 0, unaccepted: 0, nonResult: 0, gradedTasks: new Set() };
    if (row.runtimeNonResultKind !== null && row.runtimeNonResultKind !== undefined) bucket.nonResult += 1;
    else if (row.acceptedSubmit === true && isBoolean(row.truthOk)) {
      bucket.graded += 1;
      bucket.gradedTasks.add(row.taskId);
    } else bucket.unaccepted += 1;
    byRun.set(row.runId, bucket);
  }
  for (const [runId, bucket] of byRun) {
    lines.push(
      `${runId}: graded ${bucket.graded} · unaccepted ${bucket.unaccepted} · non-result ${bucket.nonResult}`,
    );
  }
  if (collapsed > 0) lines.push(`collapsed ${collapsed} byte-identical duplicate case rows`);
  if (divergent.length > 0) {
    lines.push(
      `DIVERGENT DUPLICATES (same case key, different bytes): ${[...new Set(divergent)].join(", ")}`,
    );
  }
  // Two-condition run ids exist only in campaigns measured before 2026-09-04, when a round ran a paired
  // contest. A round now measures one battery under the base run id, so this loop finds no pair.
  const pairBase = new Map();
  for (const [runId, bucket] of byRun) {
    const base = runId.replace(/-(repair-)?(on|off)$/, "");
    if (base === runId) continue;
    (pairBase.get(base) ?? pairBase.set(base, []).get(base)).push(bucket);
  }
  for (const [base, conditions] of pairBase) {
    if (conditions.length !== 2) continue;
    const surviving = [...conditions[0].gradedTasks].filter((task) =>
      conditions[1].gradedTasks.has(task),
    ).length;
    lines.push(
      `pair ${base}: surviving pairs ${surviving}` +
        (surviving === 0 ? " — COMPARISON VOID: no task graded in both conditions" : ""),
    );
  }
  if (caseRows.length === 0) lines.push("no terminal case rows");
  lines.push(...familyCoverageLines({ tallies }));
  lines.push(...repeatedConditionLines({ caseRows, decisions }));

  // --- block 4: workshop and spend ------------------------------------------------------------
  lines.push("", "## 4 workshop and spend");
  for (const dir of epochDirs) {
    const actions = readJsonl(join(dir, "verifier-workshop.jsonl")).filter((row) => row !== null);
    if (actions.length > 0) {
      const failed = actions.filter((row) => row.outcome !== "completed").length;
      lines.push(
        `${basename(dir)}: workshop ${actions.length} actions, ${failed} not completed (${pct(failed, actions.length)})`,
      );
    }
  }
  for (const file of orderedExecutionFiles) {
    const record = readJsonFileOrNull(file);
    const usage = record?.usage ?? {};
    lines.push(
      `${basename(dirname(file))}: toolCalls ${record?.toolCalls?.total ?? "?"} (${record?.toolCalls?.failed ?? "?"} failed)` +
        ` · tokens in ${usage.inputTokens ?? "null"} out ${usage.outputTokens ?? "null"} · costUsd ${usage.costUsd ?? "null"}`,
    );
  }

  lines.push(...roleSpendLines({ campaign, tallies, batteryOf, decisions }));

  // --- block 4b: saturation ledger --------------------------------------------------------------
  // Preserve recorded counters from current and historical decisions. Controller records own
  // the selected action; retired thresholds cannot establish that another action was due.
  lines.push("", "## 4b saturation ledger (difficulty decisions)");
  const difficultyFiles = ["difficulty-decisions", "rung-decisions"]
    .flatMap((directory) => {
      const dir = join(campaign, directory);
      return existsSync(dir)
        ? readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => ({ directory, name }))
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // Absence proves only that no climb decision was recorded. The selector may still have run and
  // chosen build or rebuild (run47-opus-0902 round 2 did), so the digest does not say
  // "never ran"; the controller decision reasons in section 1 say what it chose.
  if (difficultyFiles.length === 0) {
    lines.push(
      "no recorded difficulty decisions: no climb decision was recorded; read the controller decision reasons for the selected move",
    );
  }
  const thresholdSets = new Set();
  for (const { directory, name } of difficultyFiles) {
    const decisionRecord = readJsonFileOrNull(join(campaign, directory, name));
    // Legacy `rung` is read only here; new evidence writes `difficulty`.
    const counters = decisionRecord?.difficulty ?? decisionRecord?.rung ?? null;
    if (counters === null) {
      lines.push(`${name}: unreadable difficulty decision`);
      continue;
    }
    const decision = counters.decision ?? {};
    const sweepAfter = counters.broadenAfterSaturatedLevels ?? counters.rebuildAfterSaturatedLevels;
    thresholdSets.add(`${sweepAfter}/${counters.rebuildAfterSaturated}/${counters.infeasibleStopStrikes}`);
    lines.push(
      `${decisionRecord.runId ?? name}: action ${decision.action ?? "?"} L${decision.currentLevel ?? "-"}→L${decision.nextLevel ?? "-"}` +
        ` · satClimbs ${counters.saturatedClimbs} satLevelled ${counters.saturatedLevelled}` +
        ` satRange ${counters.saturatedLevels}/${sweepAfter} satBroadens ${counters.saturatedBroadens ?? "-"}` +
        ` · strikes ${counters.infeasibleStrikes}/${counters.infeasibleStopStrikes}` +
        ` · admitted ${counters.admitted} excluded ${(counters.excluded ?? []).length}`,
    );
  }
  if (thresholdSets.size > 1) {
    lines.push(
      `THRESHOLD DRIFT: ${thresholdSets.size} distinct recorded threshold sets in one campaign: ${[...thresholdSets].join(" vs ")}`,
    );
  }

  lines.push(...admissionLedgerLines({ campaign }));
  lines.push(...builderMemoryLines({ epochDirs }));

  // --- block 5: integrity probes --------------------------------------------------------------
  lines.push("", "## 5 integrity probes");
  const orphans = [];
  for (const runDir of listDirs(join(campaign, "controller"))) {
    for (const name of readdirSync(runDir)) {
      if (name.startsWith("terminal.json.tmp-")) orphans.push(`${basename(runDir)}/${name}`);
    }
  }
  lines.push(
    orphans.length === 0
      ? "orphan terminal tmp files: 0"
      : `ORPHAN terminal tmp files: ${orphans.join(", ")}`,
  );
  const primary = executionFiles.filter((file) => basename(file) === "builder-execution.json");
  const numbered = executionFiles.filter((file) => basename(file) !== "builder-execution.json");
  lines.push(
    `builder-execution records: ${primary.length} primary bare (first session), ${numbered.length} numbered (later sessions)`,
  );
  lines.push(
    "builder-execution overwrite risk: filename alone is not evidence; require a producer/source proof that two sessions wrote one path",
  );
  // The recorded row restates the battery case's solver instants as `solverStartedAt` and
  // `solverEndedAt` (case-record.ts, 2026-09-01). The probe once looked for `at`, `atMs` or
  // `timestamp`, none of which the row ever carried, and reported 0 of 125 on a run whose every
  // row was recorded.
  const recorded = caseRows.filter((row) => isString(row.solverStartedAt)).length;
  lines.push(`case rows with solver instants: ${recorded} of ${caseRows.length}`);
  lines.push(...servedModelLines({ campaign, tallies, batteryOf }));
  lines.push("", "sequence census lives in trace-challenge trace-telemetry.json, not here");

  return `${lines.join("\n")}\n`;
}

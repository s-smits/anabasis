#!/usr/bin/env bun
// Scaffold the four-file WRI archive from recorded bytes plus one small primary-authored
// `verdicts.json`. Everything a script can derive (identities, digests, terminal accounting, lane
// session rows, safeguard census and firing counts, prediction hashes, pointers) is derived here;
// the primary writes only states, reasons and prose. `main_synthesis.md` is written once as a
// skeleton and never overwritten. Re-running is idempotent for the generated files.
//
//   bun archive-scaffold.mjs --review <absolute review dir>
//
// Review dir layout (as `wri.mjs` lays it out): wri-review.json, snapshot/, lanes/tasks.json,
// lanes/luna-output/{launch.json,summary.json,<name>.md}, verdicts.json, archive/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { canonical, sourceSafeguardCallers } from "./archive-shape.mjs";
import { ANGLE_COUNT } from "./catalogue-shape.mjs";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const MAIN_HEADINGS = [
  "## Identity and evidence",
  "## Recorded result",
  "## Findings",
  "## Deterministic rows",
  "## Independent reviews and limits",
  "## Climb meaning and continuity",
  "## CL-F reconciliation",
  "## Prediction ledger",
  "## Safeguards",
  "### Safeguards T0",
  "### Safeguards T1",
  "## Terminal accounting",
  "## Source proof and replacement decision",
  "## What to do next",
  "### Patch",
  "### Consolidate",
  "### Overhaul",
];
/** The three files this script writes. `validate-archive.mjs` reads the same names beside
 *  `review.json`, which the primary authors. */
const MAIN = "main_synthesis.md";
const LUNA = "luna_syntheses.md";
const DIGEST = "digest.md";

/** Anchors into `main_synthesis.md`. Each is the GitHub slug of its `MAIN_HEADINGS` row, so a
 *  pointer names the heading rather than one spelling of it. */
const ANCHOR = {
  ledger: "#prediction-ledger",
  reviews: "#independent-reviews-and-limits",
  safeguards: "#safeguards",
  safeguardsT0: "#safeguards-t0",
  safeguardsT1: "#safeguards-t1",
  terminal: "#terminal-accounting",
};

const ROW_TITLES = {
  A: "campaign identity",
  B: "claim and promotion state",
  C: "workspace and Git",
  D: "static conformance",
  E: "fingerprint and gate census",
  F: "F2 solvability",
  G: "case partition",
  H: "runtime identity and isolation",
  I: "served-model attestation",
};
const VERDICT_IDS = [
  "discrimination-inertness",
  "submit-stall-shape",
  "evidence-integrity",
  "solver-process",
  "saturation-ledger",
  "check-informativeness",
  "family-wise-coverage",
  "role-spend-and-censoring",
];
/** Effect evidence per prediction status, in the states `validate-archive.mjs` accepts. */
const EFFECT_STATES = { sufficed: "observed", refuted: "not-observed", partial: "partial" };
const LANE_STATES = { completed: "complete", failed: "failed", "not-launched": "inactive" };
const FROZEN = [
  "id",
  "claim",
  "expectedEffect",
  "trigger",
  "falsifier",
  "owner",
  "sourceRevision",
  "runId",
  "epoch",
  "bundle",
  "taskSet",
];

const ROUTE_STATES = new Set(["routed", "held", "not-routed"]);

const sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const shaFile = (path) => sha(readFileSync(path));
const readJson = (path) => (existsSync(path) ? readJsonFile(path) : null);
/** The verdicts template: every state starts inconclusive so validation fails until the primary decides. */
function verdictsTemplate(runId, laneNames) {
  const angles = {};
  for (const name of laneNames) {
    if (/^angle_\d{2}$/.test(name)) {
      angles[Number(name.slice(6))] = {
        state: "inconclusive",
        reason: "lane report not yet adjudicated",
        anchor: "#findings",
      };
    }
  }
  return {
    schema: "wri-verdicts/v1",
    runId,
    identity: { epoch: null, taskSet: null, bundle: null },
    deterministicRows: Object.fromEntries(Object.keys(ROW_TITLES).map((id) => [id, "inconclusive"])),
    digestVerdicts: Object.fromEntries(VERDICT_IDS.map((id) => [id, "inconclusive"])),
    angles,
    session30: {
      applicability: "inconclusive",
      // Trees before 2026-09-21 name climb-history.ts, readClimbBatteries and climbLedgerRows.
      sourceFile: "src/run/climb-readout.ts",
      producerSymbol: "readClimbReadout",
      consumerSymbol: "climbReadout",
      vocabulary: "unobservable",
      difficultyDecisionCount: 0,
    },
    extraSessions: [],
    predictions: [],
    safeguards: { stderrLog: null, stderrOnlyIds: [], reconciliation: null, independentReviews: {} },
    terminal: { reason: "", capabilityResult: "inconclusive" },
    terminalAccounting: { candidateSubmits: null, recordedSubmitRows: null, controllerTerminalRows: null },
    primaryReview: { assertion: "", protectedEvidenceChecked: false },
    learningHandoff: { hypotheses: [], rivalSets: [], experimentProposals: [] },
    launchIdentityReason:
      "Ordinary launcher log plus recorded opening and terminal are joined; no canonical ticket or receipt chain exists for this launch and none was invented.",
  };
}

function loadInputs(reviewDir) {
  const review = readJson(join(reviewDir, "wri-review.json"));
  if (review === null) throw new Error(`no wri-review.json under ${reviewDir}`);
  const snapshotDir = join(reviewDir, "snapshot");
  const status = readJson(join(snapshotDir, "snapshot-status.json"));
  if (status === null) throw new Error("snapshot-status.json is missing; run collect first");
  const controllerDir = dirname(status.opening.path);
  const lanesDir = join(reviewDir, "lanes");
  const outputDir = join(lanesDir, "luna-output");
  return {
    reviewDir,
    snapshotDir,
    controllerDir,
    lanesDir,
    outputDir,
    campaign: review.campaign,
    runId: review.runId,
    repo: review.repo,
    reviewCheckout: review.reviewCheckout,
    status,
    terminal: readJson(join(controllerDir, "terminal.json")),
    evolution: readJson(join(snapshotDir, "harness-evolution.json")),
    overview: readJson(join(reviewDir, "overview.json")),
    tasks: readJson(join(lanesDir, "tasks.json")) ?? [],
    launch: readJson(join(outputDir, "launch.json")),
    summary: readJson(join(outputDir, "summary.json")),
  };
}

function laneRows(inputs) {
  const results = new Map((inputs.summary?.sessions ?? []).map((row) => [row.name, row]));
  const prompts = new Map((inputs.launch?.sessions ?? []).map((row) => [row.name, row.promptSha256]));
  return inputs.tasks.map((task) => {
    const result = results.get(task.name) ?? null;
    const reportPath = join(inputs.outputDir, `${task.name}.md`);
    const angles = (/^assignedAngles:\s*(.+)$/m.exec(task.task)?.[1] ?? "").split(",").flatMap((value) => {
      const trimmed = value.trim();
      return trimmed === "" ? [] : [trimmed];
    });
    const diagnosticInputs = /^assignedDiagnosticInputs:\s*(.+)$/m.exec(task.task)?.[1]?.trim() ?? "";
    return {
      name: task.name,
      angles,
      diagnosticInputs,
      mode: task.admission?.mode ?? "targeted",
      status: result?.status ?? "not-launched",
      failureKind: result?.failureKind ?? null,
      threadId: result?.threadId ?? null,
      durationMs: result?.durationMs ?? null,
      promptSha256: prompts.get(task.name) ?? null,
      reportSha256: existsSync(reportPath) ? shaFile(reportPath) : null,
      reportPath,
    };
  });
}

function collectionTable(lanes, inputs) {
  const lines = [
    "## Collection",
    "",
    `Launch: \`${inputs.launch ? join(inputs.outputDir, "launch.json") : "absent"}\`; model ${inputs.launch?.model ?? "unknown"} at ${inputs.launch?.reasoningEffort ?? "unknown"}; tasks \`${join(inputs.lanesDir, "tasks.json")}\`.`,
    "",
    "| session | angles | status | thread | duration s | report sha256 |",
    "|---|---|---|---|---|---|",
  ];
  for (const lane of lanes) {
    lines.push(
      `| ${lane.name} | ${lane.angles.join(", ") || lane.diagnosticInputs || "-"} | ${lane.status}${lane.failureKind ? ` (${lane.failureKind})` : ""} | ${lane.threadId ?? "-"} | ${lane.durationMs === null ? "-" : Math.round(lane.durationMs / 1000)} | ${lane.reportSha256 ?? "-"} |`,
    );
  }
  return lines;
}

/** luna_syntheses.md: the collection table, then every lane report verbatim under its own heading. */
function lunaSyntheses(lanes, inputs) {
  const lines = [
    `# Luna syntheses — ${inputs.runId}`,
    "",
    ...collectionTable(lanes, inputs),
    "",
    "## Reports",
    "",
  ];
  for (const lane of lanes) {
    lines.push(`## ${lane.name}`, "");
    if (!existsSync(lane.reportPath)) {
      lines.push(`No report was written (status ${lane.status}).`, "");
      continue;
    }
    const body = readFileSync(lane.reportPath, "utf8")
      .trim()
      .replace(/^#{1,6}\s+(.*)$/gm, (line, text) =>
        line.startsWith("## ") && text.trim() === lane.name ? "" : `### ${text}`,
      );
    // Lane reports carry Markdown line-break spaces; the archive copy drops them so the documentation diff check accepts it.
    lines.push(body.trim().replace(/[ \t]+$/gm, ""), "");
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function mainSkeleton(inputs) {
  const short = String(inputs.status.source.commit).slice(0, 9);
  const lines = [
    `# Whole-run investigation — ${inputs.runId}`,
    "",
    `Measured source ${inputs.status.source.commit} (${short}). Fill every section; the archive validator reads these headings.`,
    "",
  ];
  for (const heading of MAIN_HEADINGS) lines.push(heading, "", "TODO", "");
  return lines.join("\n");
}

function firstHeadingAnchor(text) {
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1] ?? "";
  return `#${heading
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9 -]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()}`;
}

function identityOf(inputs, verdicts) {
  const source = inputs.status.source;
  const versions = Array.isArray(inputs.evolution?.versions) ? inputs.evolution.versions : [];
  const epoch = verdicts.identity?.epoch ?? versions.at(-1)?.epoch ?? inputs.terminal?.epoch ?? "unresolved";
  const bundle = verdicts.identity?.bundle ?? inputs.evolution?.current?.bundleSnapshotId ?? "unresolved";
  const taskSet = verdicts.identity?.taskSet ?? "unresolved";
  return {
    runId: inputs.runId,
    sourceRevision: source.commit,
    runGitHash: source.commit,
    sourceDigest: source.sourceDigest,
    worktree: inputs.repo,
    epoch,
    bundle,
    taskSet,
  };
}

function terminalRows(inputs, verdicts, ptr, identity) {
  const terminal = inputs.terminal ?? {};
  const facts = inputs.status.facts?.terminalAccounting ?? {};
  const d = terminal.denominator ?? {};
  const recorded = d.state === "recorded" || d.state === "sealed";
  const outcome = ["completed", "held", "aborted"].includes(terminal.outcome)
    ? terminal.outcome
    : "incomplete";
  const parent = (value) => (isString(value) ? value : identity.bundle);
  // A live review has no controller terminal, so the snapshot carries no completed-round fact;
  // the primary records the count it read from the iteration records in verdicts.json.
  const completed = facts.completedRounds ?? verdicts.terminalAccounting?.completedRounds ?? 0;
  return {
    terminal: {
      outcome,
      capabilityResult:
        verdicts.terminal?.capabilityResult ?? (recorded && d.verified > 0 ? "recorded" : "absent"),
      reason: verdicts.terminal?.reason || terminal.terminalReason || "no terminal reason recorded",
      evidencePointers: [ptr(ANCHOR.terminal), ptr("#findings")],
    },
    terminalAccounting: {
      state: recorded ? "recorded" : "incomplete",
      denominator: recorded
        ? {
            state: "recorded",
            total: d.total,
            verified: d.verified,
            unaccepted: d.unaccepted,
            nonResult: d.nonResults,
          }
        : { state: "absent" },
      reason: recorded ? undefined : "controller denominator is not recorded",
      evidencePointer: ptr(ANCHOR.terminal),
      outerCap: facts.outerCap ?? null,
      completedRounds: completed,
      authorCalls: {
        budget: facts.authorCalls?.budget ?? "uncapped",
        opening: facts.authorCalls?.opening ?? 0,
        terminal: facts.authorCalls?.terminal ?? 0,
        delta: facts.authorCalls?.delta ?? 0,
      },
      counts: {
        raw: facts.counts?.raw ?? null,
        real: facts.counts?.real ?? null,
        controller: facts.counts?.controller ?? completed,
      },
      realAuthoringIterations: facts.completedRounds ?? verdicts.terminalAccounting?.completedRounds ?? null,
      candidateSubmits: verdicts.terminalAccounting?.candidateSubmits ?? null,
      controllerTerminalRows: verdicts.terminalAccounting?.controllerTerminalRows ?? null,
      recordedSubmitRows: verdicts.terminalAccounting?.recordedSubmitRows ?? null,
      parents: {
        lastCandidate: parent(facts.parents?.lastCandidate),
        adopted: parent(facts.parents?.adopted),
        accepted: parent(facts.parents?.accepted),
      },
    },
  };
}

function angleRows(lanes, verdicts, ptr, shortIdentity) {
  const byAngle = new Map();
  for (const lane of lanes) for (const angle of lane.angles) byAngle.set(Number(angle), lane);
  return Array.from({ length: ANGLE_COUNT }, (_, index) => {
    const angle = index + 1;
    const lane = byAngle.get(angle);
    const verdict = verdicts.angles?.[String(angle)];
    const anchor = verdict?.anchor ?? "#findings";
    if (verdict) {
      return {
        angle,
        state: verdict.state,
        session: lane?.name ?? "primary-deterministic",
        mode: lane?.mode ?? "targeted",
        identity: shortIdentity,
        denominator: {
          state: verdict.denominator ?? "recorded",
          reason: verdict.reason,
          evidencePointers: [ptr(anchor)],
        },
        reason: verdict.reason,
        evidencePointers: [ptr(anchor)],
      };
    }
    if (lane) {
      return {
        angle,
        state: "inconclusive",
        session: lane.name,
        mode: lane.mode,
        identity: shortIdentity,
        denominator: {
          state: "inconclusive",
          reason: "lane report not yet adjudicated by the primary",
          evidencePointers: [ptr(`#${lane.name}`, LUNA)],
        },
        reason: `Session ${lane.name} ${lane.status}; the primary has not recorded a verdict in verdicts.json.`,
        evidencePointers: [ptr(`#${lane.name}`, LUNA)],
      };
    }
    return {
      angle,
      state: "unobservable",
      session: "not-launched",
      mode: "targeted",
      identity: shortIdentity,
      denominator: {
        state: "absent",
        reason: "No semantic session admitted for this angle; not a pass.",
        evidencePointers: [ptr(ANCHOR.reviews)],
      },
      reason: "Not independently reviewed: no session was admitted for this angle.",
      evidencePointers: [ptr(ANCHOR.reviews)],
    };
  });
}

function sessionRows(lanes, inputs, verdicts, ptr, identity) {
  const s30 = verdicts.session30;
  const witnessPath = join(inputs.repo, s30.sourceFile);
  const witnessDigest = existsSync(witnessPath) ? sha(readFileSync(witnessPath, "utf8")) : "0".repeat(64);
  const rows = [
    {
      id: "session_30",
      state: s30.applicability === "applicable" ? "complete" : "inconclusive",
      applicability: s30.applicability,
      contract: "CL-F",
      readinessWitness: {
        sourceFile: s30.sourceFile,
        producerSymbol: s30.producerSymbol,
        consumerSymbol: s30.consumerSymbol,
        sourceRevision: identity.sourceRevision,
        sourceDigest: witnessDigest,
        vocabulary: s30.vocabulary,
        difficultyDecisionCount: s30.difficultyDecisionCount,
        evidencePointers: [ptr("#cl-f-reconciliation")],
      },
      evidencePointers: [ptr("#cl-f-reconciliation")],
    },
  ];
  for (const lane of lanes) {
    rows.push({
      id: lane.name,
      state: LANE_STATES[lane.status] ?? "partial",
      evidencePointers: [ptr("#collection", LUNA), ptr(`#${lane.name}`, LUNA)],
      model: inputs.launch?.model ?? null,
      effort: inputs.launch?.reasoningEffort ?? null,
      transport: "luna-sessions",
      threadId: lane.threadId,
      reportSha256: lane.reportSha256,
      promptSha256: lane.promptSha256,
      assignedAngles: lane.angles,
      assignedDiagnosticInputs: lane.diagnosticInputs,
    });
  }
  for (const extra of verdicts.extraSessions ?? []) {
    rows.push({ ...extra, evidencePointers: [ptr(extra.anchor ?? ANCHOR.reviews)] });
  }
  return rows;
}

function predictionRows(verdicts, ptr, identity, denominator) {
  return (verdicts.predictions ?? []).map((row) => {
    const frozen = Object.fromEntries(FROZEN.map((key) => [key, row[key] ?? identity[key]]));
    const status = row.status ?? "inconclusive";
    return {
      ...frozen,
      frozenHash: sha(canonical(frozen)),
      status,
      eligible: false,
      advisoryReason:
        row.advisoryReason ??
        "The prediction was recorded in launch prose before launch; no canonical campaign receipt exists, so the row is advisory.",
      closureState: "not-campaign-closure",
      backtrackEvent: status === "refuted" ? "refutation-recorded" : "none-no-refutation",
      decidingEvidence: [ptr(ANCHOR.ledger)],
      successor: [],
      dependsOn: [],
      consumedBy: [],
      eligibility: {
        state: "ineligible",
        nextEligibleRunId: "unassigned-until-canonical-protocol-is-used",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      opportunity: {
        state: status === "untriggered" ? "absent" : "present",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      triggerEvidence: {
        state: status === "untriggered" ? "not-triggered" : "triggered",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      effectEvidence: { state: EFFECT_STATES[status] ?? "unknown", evidencePointers: [ptr(ANCHOR.ledger)] },
      denominator: { ...denominator, evidencePointers: [ptr(ANCHOR.terminal)] },
      reason: row.reason ?? "",
      // A refuted row needs the primary's walk (verdicts.predictions[].dependencyWalk); the
      // validator refuses a refutation whose walk is not closed, so the default alone cannot record one.
      dependencyWalk: {
        walked: false,
        closed: false,
        casualties: [],
        survivors: [],
        dependents: [],
        ...row.dependencyWalk,
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
    };
  });
}

/** Count only the logger's own framing. An unavailable log has no count, not an observed zero. */
function safeguardCounts(path, stderr = false) {
  const counts = new Map();
  let bytes;
  try {
    bytes = path ? readFileSync(path, "utf8") : null;
  } catch {
    bytes = null;
  }
  if (bytes === null) return { path: null, sha256: null, counts, malformed: 0 };
  let malformed = 0;
  for (const raw of bytes.split("\n")) {
    if (!raw.trim() || (stderr && !raw.startsWith("[safeguard] "))) continue;
    const line = stderr ? raw.slice("[safeguard] ".length) : raw;
    const id = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \| ([^|\r\n]+) \|/.exec(line)?.[1]?.trim();
    if (hasText(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    else malformed += 1;
  }
  return { path, sha256: sha(bytes), counts, malformed };
}

function receipt(present, digest, ptr) {
  return present && digest
    ? { state: "present", complete: true, sha256: digest, evidencePointers: [ptr(ANCHOR.safeguardsT1)] }
    : { state: "inconclusive", complete: false, evidencePointers: [ptr(ANCHOR.safeguardsT1)] };
}

/** A route is the primary's adjudication in `verdicts.safeguards.routes[<id>]`, with a state and a
 *  reason, under a complete reconciliation. A count proves a firing, not that the owner received
 *  it, so without that record the route stays inconclusive. */
function safeguardRoute(file, route, coverage, ptr) {
  const explicit =
    coverage.complete &&
    route !== null &&
    typeof route === "object" &&
    ROUTE_STATES.has(route.state) &&
    isString(route.reason) &&
    route.reason.trim() !== "";
  return explicit
    ? {
        state: route.state,
        owner: file,
        reason: route.reason,
        evidencePointers: [ptr(route.anchor ?? ANCHOR.safeguards)],
      }
    : { state: "inconclusive", owner: file };
}

/** One runtime safeguard row. The count sums every channel that was read, so a firing the logger
 *  reached only through stderr still counts for an id the primary did not list; an id the primary
 *  declared stderr-only stays unresolved until that capture is supplied. No channel read means no
 *  count, and `not-fired` also needs the primary's byte-bound reconciliation (T1). */
function runtimeSafeguardRow({
  id,
  file,
  fileSha,
  stderrOnly,
  log,
  stderr,
  coverage,
  independentReview,
  route,
  ptr,
  shortIdentity,
}) {
  const channels = [log.sha256 === null ? null : "run-log", stderr.sha256 === null ? null : "stderr"].filter(
    Boolean,
  );
  const unresolved = channels.length === 0 || (stderrOnly && stderr.sha256 === null);
  const count = unresolved ? null : (log.counts.get(id) ?? 0) + (stderr.counts.get(id) ?? 0);
  const fired = count !== null && count > 0;
  const status = fired ? "fired" : count === 0 && coverage.t1 ? "not-fired" : "inconclusive";
  const retirement = {
    retired: false,
    eligibleIterations: 0,
    backtrackPreserved: false,
    backtrackPointers: [],
  };
  if (
    coverage.complete &&
    independentReview?.reviewed === true &&
    isString(independentReview.reason) &&
    independentReview.reason.trim()
  ) {
    retirement.independentReview = {
      reviewed: true,
      reason: independentReview.reason,
      evidencePointers: [ptr(independentReview.anchor ?? ANCHOR.safeguards)],
    };
  }
  return {
    id,
    kind: "runtime-log-only",
    status,
    owner: file,
    version: "source-callers-v1",
    sensor: "src/meta/safeguard.ts:safeguardTriggered",
    definitionSha256: fileSha,
    evidencePointers: [ptr(ANCHOR.safeguards)],
    evidenceBinding: shortIdentity,
    opportunity: { state: fired ? "present" : "unknown", evidencePointers: [ptr(ANCHOR.safeguardsT0)] },
    firing: { state: status, evidencePointers: [ptr(ANCHOR.safeguardsT1)] },
    logReceipt: receipt((log.counts.get(id) ?? 0) > 0, log.sha256, ptr),
    stderrReceipt: receipt((stderr.counts.get(id) ?? 0) > 0, stderr.sha256, ptr),
    // A controller terminal does not establish a process receipt for this particular firing.
    processReceipt: receipt(false, null, ptr),
    action: { state: "diagnostic-only", owner: file, evidencePointers: [ptr(ANCHOR.safeguards)] },
    backtrack: { state: fired ? "required" : "inconclusive", evidencePointers: [ptr(ANCHOR.safeguards)] },
    coverage,
    route: safeguardRoute(file, route, coverage, ptr),
    retirement,
    count,
    countSource: unresolved ? null : channels.join("+"),
  };
}

function safeguardRows(inputs, verdicts, ptr, identity, shortIdentity) {
  const callers = sourceSafeguardCallers(inputs.repo);
  const log = safeguardCounts(join(inputs.campaign, "safeguards", inputs.runId, "SAFEGUARDS_LOG.txt"));
  const stderr = safeguardCounts(verdicts.safeguards?.stderrLog, true);
  const stderrOnly = new Set(verdicts.safeguards?.stderrOnlyIds ?? []);
  const callerFiles = [...callers.keys()].sort().map((file) => ({
    relativeFile: file,
    sha256: sha(readFileSync(join(inputs.repo, file), "utf8")),
    ids: [...callers.get(file)].sort(),
  }));
  const evidence = {
    ...shortIdentity,
    sourceDigest: identity.sourceDigest,
    callersSha256: sha(canonical(callerFiles)),
    logSha256: log.sha256,
    stderrSha256: stderr.sha256,
    stderrOnlyIds: [...stderrOnly].sort(),
  };
  // The primary records its reconciliation against these exact bytes in verdicts.json. A later
  // log, source or input-selection change invalidates that adjudication, rather than copying true.
  const reviewed = verdicts.safeguards?.reconciliation;
  const bytesVerified =
    reviewed !== null &&
    reviewed !== undefined &&
    isString(reviewed.reason) &&
    reviewed.reason.trim() !== "" &&
    canonical(reviewed.evidence) === canonical(evidence);
  const t0 = bytesVerified && reviewed.t0 === true;
  const t1 = bytesVerified && reviewed.t1 === true && log.malformed === 0 && stderr.malformed === 0;
  const coverage = { complete: t0 && t1, t0, t1 };
  // Every safeguard row is derived from a source caller and its receipts. This loop once also
  // pushed five constant "S1".."S5" rows for campaign sentinels no file has ever defined, so every
  // archive carried the same five inconclusive placeholders and no reader could learn from them.
  const rows = [];
  for (const caller of callerFiles) {
    for (const id of caller.ids) {
      rows.push(
        runtimeSafeguardRow({
          id,
          file: caller.relativeFile,
          fileSha: caller.sha256,
          stderrOnly: stderrOnly.has(id),
          log,
          stderr,
          coverage,
          independentReview: verdicts.safeguards?.independentReviews?.[id],
          route: verdicts.safeguards?.routes?.[id],
          ptr,
          shortIdentity,
        }),
      );
    }
  }
  const census = {
    complete: true,
    availability: callerFiles.length > 0 ? "observable" : "absent",
    sourceRevision: identity.sourceRevision,
    sourceDigest: identity.sourceDigest,
    definitionFile: "src/meta/safeguard.ts",
    derivation: "source-callers-v1",
    callerFiles,
    ids: [...new Set(callerFiles.flatMap((row) => row.ids))].sort(),
    evidencePointers: [ptr(ANCHOR.safeguards)],
  };
  return {
    safeguards: rows,
    safeguardCensus: census,
    safeguardLog: log.path,
    evidence,
    bytesVerified,
    coverage,
  };
}

function procedureIdentity(inputs, ptr) {
  const checkout = inputs.reviewCheckout;
  const skillPath = join(checkout, ".claude/skills/whole-run-investigation/SKILL.md");
  const digest = shaFile(skillPath);
  const revision = runTextSyncOrThrow(["git", "-C", checkout, "rev-parse", "HEAD"]).trim();
  return {
    name: "whole-run-investigation",
    version: "wri/skill-md",
    sourceRevision: revision,
    sourceDigest: digest,
    sha256: digest,
    worktree: checkout,
    sameTree: checkout === inputs.repo,
    state: "unbound",
    pointer: ptr("#identity-and-evidence"),
  };
}

function buildReview(inputs, verdicts, lanes, archiveDir) {
  const digests = Object.fromEntries(
    [MAIN, LUNA, DIGEST].map((name) => [name, shaFile(join(archiveDir, name))]),
  );
  const ptr = (anchor, path = MAIN) => ({ path, anchor, sha256: digests[path] });
  const identity = identityOf(inputs, verdicts);
  const shortIdentity = {
    runId: identity.runId,
    sourceRevision: identity.sourceRevision,
    epoch: identity.epoch,
    bundle: identity.bundle,
    taskSet: identity.taskSet,
  };
  const rows = terminalRows(inputs, verdicts, ptr, identity);
  const safeguards = safeguardRows(inputs, verdicts, ptr, identity, shortIdentity);
  const handoff = verdicts.learningHandoff ?? {};
  return {
    schema: "wri-archive/v1",
    authority: "advisory",
    status: "investigation-complete",
    identity,
    lifecycle: { stage: inputs.terminal ? "terminal" : "live" },
    procedureIdentity: procedureIdentity(inputs, ptr),
    ledgerProjection: {
      schema: "superloop-ledger-projection/v1",
      authority: "projection-only",
      mutable: false,
      sourceRevision: identity.sourceRevision,
      sha256: digests[MAIN],
      pointer: ptr(ANCHOR.ledger),
    },
    launchIdentity: { state: "incomplete", reason: verdicts.launchIdentityReason },
    digests: {
      snapshot: {
        sha256: digests[DIGEST],
        pointer: ptr(firstHeadingAnchor(readFileSync(join(archiveDir, DIGEST), "utf8")), DIGEST),
      },
      manifest: { sha256: digests[LUNA], pointer: ptr("#collection", LUNA) },
      sessions: { sha256: digests[LUNA], pointer: ptr("#collection", LUNA) },
      reports: { sha256: digests[LUNA], pointer: ptr("#reports", LUNA) },
    },
    ...rows,
    deterministicRows: Object.entries(ROW_TITLES).map(([id, title]) => ({
      id,
      title,
      state: verdicts.deterministicRows?.[id] ?? "inconclusive",
      evidencePointers: [ptr("#deterministic-rows")],
    })),
    digestVerdicts: VERDICT_IDS.map((id) => ({
      id,
      state: verdicts.digestVerdicts?.[id] ?? "inconclusive",
      evidencePointers: [
        ptr("#deterministic-rows"),
        ptr(firstHeadingAnchor(readFileSync(join(archiveDir, DIGEST), "utf8")), DIGEST),
      ],
    })),
    angleStates: angleRows(lanes, verdicts, ptr, shortIdentity),
    sessionStates: sessionRows(lanes, inputs, verdicts, ptr, identity),
    predictions: predictionRows(
      verdicts,
      ptr,
      identity,
      rows.terminalAccounting.denominator.state === "recorded"
        ? { state: "recorded", counts: { ...rows.terminalAccounting.denominator, state: undefined } }
        : { state: "absent" },
    ),
    safeguards: safeguards.safeguards,
    safeguardCensus: safeguards.safeguardCensus,
    safeguardEvidence: safeguards.evidence,
    safeguardReconciliation: {
      bytesVerified: safeguards.bytesVerified,
      t0: ptr(ANCHOR.safeguardsT0),
      t1: ptr(ANCHOR.safeguardsT1),
      t0Identity: { complete: safeguards.coverage.t0, ...identity },
      t1Identity: { complete: safeguards.coverage.t1, ...identity },
    },
    primaryReview: {
      assertion: verdicts.primaryReview?.assertion ?? "",
      protectedEvidenceChecked: verdicts.primaryReview?.protectedEvidenceChecked === true,
      evidencePointers: [ptr(ANCHOR.reviews)],
    },
    metaReview: {
      state: "not-used",
      authority: "advisory",
      reason: "No disputed horizon or campaign policy change was made; the decision rests on recorded bytes.",
      evidencePointers: [ptr("#source-proof-and-replacement-decision")],
    },
    conditionManifest: {
      state: "not-used",
      authority: "advisory",
      reason:
        "The exact opening and launch command are recorded; no separate canonical condition ticket is claimed.",
      evidencePointers: [ptr("#identity-and-evidence")],
    },
    learningHandoff: {
      authority: "advisory",
      hypotheses: handoff.hypotheses ?? [],
      rivalSets: handoff.rivalSets ?? [],
      experimentProposals: (handoff.experimentProposals ?? []).map((row) => ({
        ...row,
        disposition: row.disposition ?? "propose",
        evidencePointers: [ptr(row.anchor ?? "#what-to-do-next")],
        anchor: undefined,
      })),
      evidencePointers: [ptr("#what-to-do-next")],
    },
    sectionPointers: {
      predictionLedger: ptr(ANCHOR.ledger),
      safeguards: ptr(ANCHOR.safeguards),
      terminalAccounting: ptr(ANCHOR.terminal),
    },
  };
}

/** Write the archive files. Returns the verdicts path when the template was just created. */
export function scaffoldArchive(reviewDir) {
  const inputs = loadInputs(reviewDir);
  const lanes = laneRows(inputs);
  const archiveDir = join(reviewDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  const verdictsPath = join(reviewDir, "verdicts.json");
  const fresh = !existsSync(verdictsPath);
  if (fresh) {
    writeJsonFile(
      verdictsPath,
      verdictsTemplate(
        inputs.runId,
        lanes.map((lane) => lane.name),
      ),
    );
  }
  const verdicts = readJson(verdictsPath);
  writeFileSync(join(archiveDir, LUNA), lunaSyntheses(lanes, inputs));
  const digestPath = join(inputs.snapshotDir, DIGEST);
  // The digest prints padded tables; the archive copy drops trailing spaces so the documentation diff check accepts it.
  writeFileSync(
    join(archiveDir, DIGEST),
    existsSync(digestPath)
      ? readFileSync(digestPath, "utf8").replace(/[ \t]+$/gm, "")
      : "# deterministic digest\n\nThe snapshot carried no digest.md.\n",
  );
  const mainPath = join(archiveDir, MAIN);
  if (!existsSync(mainPath)) writeFileSync(mainPath, mainSkeleton(inputs));
  writeJsonFile(join(archiveDir, "review.json"), buildReview(inputs, verdicts, lanes, archiveDir));
  return {
    archiveDir,
    verdictsPath,
    fresh,
    lanes: lanes.length,
    mainSkeleton: readFileSync(mainPath, "utf8").includes("\nTODO\n"),
  };
}

function main() {
  const index = Bun.argv.indexOf("--review");
  const reviewDir = index === -1 ? null : Bun.argv[index + 1];
  if (!reviewDir || !isAbsolute(reviewDir)) {
    console.error("usage: archive-scaffold.mjs --review <absolute review dir>");
    runtimeProcess.exit(2);
  }
  const result = scaffoldArchive(resolve(reviewDir));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) main();
export { SCRIPT_DIR as ARCHIVE_SCAFFOLD_DIR };

#!/usr/bin/env bun
// Read-only weekly selection. Duration narrows the corpus, WRI's trace-review supplies nine fixed
// outcome views plus its digest, and main_synthesis.md supplies the adjudicated baseline.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import {
  admittedLunaPlan,
  AXES,
  buildLunaPlan,
  partitionByDuration,
  rankFinalists,
  safeName,
  weekWindow,
} from "./selection-policy.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export { admittedLunaPlan, buildLunaPlan, partitionByDuration, rankFinalists, weekWindow };

export const WEEKLY_SELECTION_SCHEMA = "weekly-best-run-selection/v1";
export const DETERMINISTIC_CLI_VIEWS = [
  "builder",
  "default",
  "scan",
  "scorecard",
  "observations-warning",
  "cases-fail",
  "cases-unaccepted",
  "cases-non-result",
  "cases-pass",
];

function positiveNumber(value, flag, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${flag} needs a ${integer ? "non-negative integer" : "non-negative number"}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    repo: runtimeProcess.cwd(),
    campaigns: [],
    week: "previous",
    timezone: "Europe/Oslo",
    now: new Date().toISOString(),
    top: 5,
    minDurationMinutes: 30,
    snapshotRoot: /** @type {string | null} */ (null),
    out: /** @type {string | null} */ (null),
    markdown: /** @type {string | null} */ (null),
    lunaManifest: /** @type {string | null} */ (null),
    lunaInstructions: /** @type {string | null} */ (null),
  };
  const flags = new Set([
    "--repo",
    "--campaign",
    "--week",
    "--timezone",
    "--now",
    "--top",
    "--min-duration-minutes",
    "--snapshot-root",
    "--out",
    "--markdown",
    "--luna-manifest",
    "--luna-instructions",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flags.has(flag)) throw new Error(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    index += 1;
    if (flag === "--repo") args.repo = value;
    else if (flag === "--campaign") args.campaigns.push(value);
    else if (flag === "--week") args.week = value;
    else if (flag === "--timezone") args.timezone = value;
    else if (flag === "--now") args.now = value;
    else if (flag === "--top") args.top = positiveNumber(value, flag, true);
    else if (flag === "--min-duration-minutes") args.minDurationMinutes = positiveNumber(value, flag);
    else if (flag === "--snapshot-root") args.snapshotRoot = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--markdown") args.markdown = value;
    else if (flag === "--luna-manifest") args.lunaManifest = value;
    else if (flag === "--luna-instructions") args.lunaInstructions = value;
  }
  if (!new Set(["current", "previous"]).has(args.week)) throw new Error("--week must be current or previous");
  if (args.top < 1) throw new Error("--top needs a positive integer");
  if ((args.lunaManifest === null) !== (args.lunaInstructions === null)) {
    throw new Error("--luna-manifest and --luna-instructions must be supplied together");
  }
  return args;
}

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .map((name) => join(path, name))
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function gitText(repo, ...args) {
  return runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();
}

function gitMaybe(repo, ...args) {
  try {
    return gitText(repo, ...args);
  } catch {
    return null;
  }
}

function linkedWorktrees(repo) {
  const rows = [];
  let current = null;
  for (const line of gitText(repo, "worktree", "list", "--porcelain").split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), head: null, branch: null };
      rows.push(current);
    } else if (current !== null && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current !== null && line.startsWith("branch ")) current.branch = line.slice(7);
  }
  return rows;
}

function owningTree(path, trees) {
  const absolute = resolve(path);
  return (
    trees
      .filter((tree) => {
        const child = relative(resolve(tree.path), absolute);
        return child === "" || (!child.startsWith("..") && !isAbsolute(child));
      })
      .sort((left, right) => right.path.length - left.path.length)[0] ?? null
  );
}

function campaignRoots(repo, explicit) {
  const trees = linkedWorktrees(repo);
  const found = new Map();
  for (const tree of trees) {
    for (const campaign of directories(join(tree.path, "campaigns"))) {
      found.set(resolve(campaign), { campaign: resolve(campaign), worktree: tree.path, head: tree.head });
    }
  }
  for (const path of explicit.map((entry) => resolve(entry))) {
    const tree = owningTree(path, trees);
    found.set(path, { campaign: path, worktree: tree?.path ?? null, head: tree?.head ?? null });
  }
  return [...found.values()].sort((left, right) => left.campaign.localeCompare(right.campaign));
}

function sha256(bytes) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function within(value, period) {
  const time = new Date(value).getTime();
  return (
    Number.isFinite(time) && time >= new Date(period.start).getTime() && time < new Date(period.end).getTime()
  );
}

function inspectOpening(path, root, period, capturedAt) {
  let opening;
  try {
    opening = readJsonFile(path);
  } catch {
    return { invalid: true, reason: "opening-unreadable", openingPath: path };
  }
  if (opening?.schema !== "campaign-opening/v2" || opening?.command?.name !== "fullrun") return null;
  const runId = opening.runId;
  const projectId = opening?.project?.id;
  if (!isString(runId) || !isString(projectId)) {
    return { invalid: true, reason: "opening-identity-invalid", openingPath: path };
  }
  const openedMs = new Date(opening.writtenAt).getTime();
  if (!Number.isFinite(openedMs)) {
    return { invalid: true, reason: "opening-timestamp-invalid", openingPath: path };
  }
  if (basename(dirname(path)) !== runId || projectId !== basename(root.campaign)) {
    return { invalid: true, reason: "opening-path-identity-mismatch", openingPath: path };
  }
  const terminalPath = join(dirname(path), "terminal.json");
  let terminal = null;
  if (existsSync(terminalPath)) {
    try {
      terminal = readJsonFile(terminalPath);
    } catch {
      return { invalid: true, reason: "terminal-unreadable", openingPath: path, terminalPath };
    }
  }
  if (terminal === null) {
    if (!within(opening.writtenAt, period)) return null;
    return {
      key: `${basename(root.campaign)}/${runId}`,
      campaignId: basename(root.campaign),
      projectId,
      runId,
      campaign: root.campaign,
      sourceWorktree: root.worktree,
      sourceHead: root.head,
      openingPath: path,
      openingDigest: hashJsonValue(opening),
      terminalDigest: null,
      lifecycle: "unfinished",
      invalid: false,
      openedAt: opening.writtenAt,
      terminalAt: null,
      durationMinutes: null,
      source: opening.source ?? null,
    };
  }
  const terminalMs = new Date(terminal.writtenAt).getTime();
  if (!Number.isFinite(terminalMs)) {
    return { invalid: true, reason: "terminal-timestamp-invalid", openingPath: path, terminalPath };
  }
  if (terminalMs > new Date(capturedAt).getTime()) {
    return { invalid: true, reason: "terminal-in-future", openingPath: path, terminalPath };
  }
  if (!within(terminal.writtenAt, period)) return null;
  const terminalValid =
    terminal.schema === "campaign-terminal/v2" &&
    terminal.openingDigest === hashJsonValue(opening) &&
    hashJsonValue(terminal.source) === hashJsonValue(opening.source) &&
    terminal.epoch === opening?.epoch?.key &&
    (terminal?.lock?.ownedAtRecord === true || terminal?.lock?.ownedAtSeal === true) &&
    new Set(["completed", "aborted"]).has(terminal.outcome) &&
    terminalMs >= openedMs;
  const durationMinutes =
    Number.isFinite(openedMs) && Number.isFinite(terminalMs) && terminalMs >= openedMs
      ? (terminalMs - openedMs) / 60_000
      : null;
  return {
    key: `${basename(root.campaign)}/${runId}`,
    campaignId: basename(root.campaign),
    projectId,
    runId,
    campaign: root.campaign,
    sourceWorktree: root.worktree,
    sourceHead: root.head,
    openingPath: path,
    terminalPath,
    openingDigest: hashJsonValue(opening),
    terminalDigest: hashJsonValue(terminal),
    lifecycle: terminalValid ? "terminal" : "damaged",
    invalid: !terminalValid,
    reason: terminalValid ? null : "terminal-identity-invalid",
    openedAt: opening.writtenAt,
    terminalAt: terminal.writtenAt,
    durationMinutes,
    source: opening.source ?? null,
    outcome: terminalValid ? (terminal.outcome ?? null) : null,
    abortClause: terminalValid ? (terminal.abortClause ?? null) : null,
  };
}

export function deduplicateRuns(copies) {
  const groups = new Map();
  for (const copy of copies.filter(Boolean)) {
    const key = copy.key ?? `invalid/${copy.openingPath}`;
    groups.set(key, [...(groups.get(key) ?? []), copy]);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => {
      const openingDigests = new Set(values.flatMap((row) => row.openingDigest || []));
      const terminalDigests = new Set(values.flatMap((row) => row.terminalDigest || []));
      const conflict = openingDigests.size > 1 || terminalDigests.size > 1;
      const expectedHead = values[0]?.source?.commit;
      const preferred = [...values].sort((left, right) => {
        const sourceOrder =
          Number(right.sourceHead === expectedHead) - Number(left.sourceHead === expectedHead);
        const terminalOrder = Number(right.lifecycle === "terminal") - Number(left.lifecycle === "terminal");
        return sourceOrder || terminalOrder || left.openingPath.localeCompare(right.openingPath);
      })[0];
      return {
        ...preferred,
        key,
        conflict,
        invalid: preferred.invalid || conflict,
        reason: conflict ? "copied-evidence-conflict" : preferred.reason,
        copies: values.map((row) => row.openingPath).sort(),
      };
    });
}

/** Published WRI archives by run id. Only a current `wri-archive/v1` packet naming its run and
 *  full source revision is indexed; any other `review.json` cannot be a finalist baseline. */
function synthesisIndex(repo) {
  const index = new Map();
  for (const dir of directories(join(repo, "notes", "runs"))) {
    const synthesisPath = join(dir, "main_synthesis.md");
    const reviewPath = join(dir, "review.json");
    if (!existsSync(synthesisPath) || !existsSync(reviewPath)) continue;
    try {
      const review = readJsonFile(reviewPath);
      const runId = review.identity?.runId;
      const sourceCommit = review.identity?.sourceRevision;
      if (
        review.schema !== "wri-archive/v1" ||
        !isString(runId) ||
        !/^[a-f0-9]{40}$/.test(sourceCommit ?? "")
      ) {
        continue;
      }
      const entry = {
        archiveDir: dir,
        synthesisPath,
        reviewPath,
        identity: { runId, sourceCommit },
        reviewDigest: sha256(readFileSync(reviewPath)),
      };
      index.set(runId, [...(index.get(runId) ?? []), entry]);
    } catch {
      /* an unreadable archive cannot be used as a finalist baseline */
    }
  }
  return index;
}

export function bindSynthesis(run, entries = []) {
  const matching = entries.filter((entry) => entry.identity.sourceCommit === run.source?.commit);
  if (matching.length === 0) {
    return { ok: false, reason: entries.length === 0 ? "synthesis-missing" : "synthesis-source-mismatch" };
  }
  if (matching.length > 1) return { ok: false, reason: "synthesis-conflict" };
  const entry = matching[0];
  const synthesisDigest =
    entry.synthesisDigest ??
    (existsSync(entry.synthesisPath) ? sha256(readFileSync(entry.synthesisPath)) : null);
  if (synthesisDigest === null) return { ok: false, reason: "synthesis-missing" };
  return { ok: true, archive: { ...entry, synthesisDigest } };
}

export function bindPublishedSyntheses(repo, selected, census = selected) {
  const archives = synthesisIndex(repo);
  return selected.map((run) => {
    // A WRI archive names no campaign: its folder is a display label, not identity. Bind it by
    // run id and full source revision, and only while that pair is unique across this census.
    const entries = archives.get(run.runId) ?? [];
    const campaigns = new Set(
      census
        .filter((row) => row.runId === run.runId && row.source?.commit === run.source?.commit)
        .map((row) => row.campaignId),
    );
    if (entries.some((entry) => entry.identity.sourceCommit === run.source?.commit) && campaigns.size > 1) {
      return { ...run, synthesisFailure: "synthesis-campaign-ambiguous" };
    }
    const binding = bindSynthesis(run, entries);
    return binding.ok ? { ...run, archive: binding.archive } : { ...run, synthesisFailure: binding.reason };
  });
}

function requiredSnapshotLabels(runId) {
  return [
    "digest",
    ...DETERMINISTIC_CLI_VIEWS.map((view) => (view === "builder" ? "builder" : `${runId}-${view}`)),
  ];
}

function tallyBattery(battery) {
  const cases = battery?.cases ?? {};
  const passRate = battery?.passRate ?? {};
  if (
    ![
      passRate.n,
      passRate.successes,
      cases.verified,
      cases.passed,
      cases.failed,
      cases.unaccepted,
      cases?.nonResults?.total,
    ].every(Number.isInteger) ||
    (passRate.rate !== null && !Number.isFinite(passRate.rate))
  ) {
    return null;
  }
  if (cases.passed + cases.failed !== cases.verified) return null;
  return {
    verified: cases.verified,
    passed: cases.passed,
    failed: cases.failed,
    unaccepted: cases.unaccepted,
    nonResults: cases.nonResults.total,
    difficultyN: passRate.n,
    difficultySuccesses: passRate.successes,
    rate: passRate.rate,
    families:
      battery?.families && typeof battery.families === "object" ? Object.keys(battery.families).length : null,
  };
}

export function deterministicFacts({ run, snapshotStatus, metrics, scan, scorecard }) {
  const labels = new Map((snapshotStatus?.views ?? []).map((row) => [row.label, row]));
  const missingViews = requiredSnapshotLabels(run.runId).filter(
    (label) => labels.get(label)?.status !== "ok",
  );
  if (snapshotStatus?.complete !== true || missingViews.length > 0) {
    return { ok: false, reason: "deterministic-check-incomplete", missingViews };
  }
  if (
    metrics?.schema !== "outcome-metrics/v4" ||
    scan?.schema !== "outcome-scan/v1" ||
    scorecard?.schema !== "campaign-scorecard/v3"
  ) {
    return { ok: false, reason: "deterministic-schema-unsupported", missingViews: [] };
  }
  const denominator = metrics?.controller?.denominator;
  if (denominator?.state !== "recorded" && denominator?.state !== "sealed") {
    return { ok: false, reason: "denominator-unrecorded", missingViews: [] };
  }
  const total = denominator.total;
  const verified = denominator.verified;
  const unaccepted = denominator.unaccepted;
  const nonResults = denominator.nonResults;
  if (
    ![total, verified, unaccepted, nonResults].every(Number.isInteger) ||
    total !== verified + unaccepted + nonResults
  ) {
    return { ok: false, reason: "denominator-invalid", missingViews: [] };
  }
  const batteries = Object.values(metrics.batteries ?? {}).map(tallyBattery);
  if (batteries.some((row) => row === null)) {
    return { ok: false, reason: "battery-denominator-unknown", missingViews: [] };
  }
  const passed = batteries.reduce((sum, row) => sum + row.passed, 0);
  const failed = batteries.reduce((sum, row) => sum + row.failed, 0);
  if (passed + failed !== verified) {
    return { ok: false, reason: "verified-denominator-mismatch", missingViews: [] };
  }
  const thresholds = scan?.thresholds;
  if (
    !Array.isArray(thresholds?.band) ||
    thresholds.band.length !== 2 ||
    !thresholds.band.every(Number.isFinite) ||
    !Number.isInteger(thresholds.minLevelN)
  ) {
    return { ok: false, reason: "difficulty-thresholds-unknown", missingViews: [] };
  }
  const [bandLow, bandHigh] = thresholds.band;
  const promotions = Array.isArray(metrics.promotions) ? metrics.promotions : [];
  const candidatePromoted = promotions.filter(
    (row) => row?.decision === "promoted" && row?.experiment !== "climb",
  ).length;
  const climbPromoted = promotions.filter(
    (row) => row?.decision === "promoted" && row?.experiment === "climb",
  ).length;
  const inBandBatteries = batteries.filter(
    (row) =>
      row.difficultyN >= thresholds.minLevelN &&
      row.rate > 0 &&
      row.rate < 1 &&
      row.rate >= bandLow &&
      row.rate <= bandHigh,
  ).length;
  const saturatedBatteries = batteries.filter((row) => row.rate === 0 || row.rate === 1).length;
  const verifiedBatteries = batteries.filter((row) => row.verified > 0).length;
  const nonSaturated = batteries.filter((row) => row.rate > 0 && row.rate < 1);
  const nonSaturatedVerified = nonSaturated.reduce((sum, row) => sum + row.verified, 0);
  const nonSaturatedFamilies = nonSaturated.reduce((sum, row) => sum + (row.families ?? 0), 0);
  const submits = scorecard?.learningYield?.submits ?? {};
  const iterations = scorecard?.learningYield?.iterations ?? {};
  const operationalValues = [
    submits.compared,
    submits.moved,
    submits.stalled,
    submits.unchangedTree,
    iterations.moved,
  ];
  if (!operationalValues.every((value) => value === undefined || Number.isInteger(value))) {
    return { ok: false, reason: "learning-yield-invalid", missingViews: [] };
  }
  return {
    ok: true,
    facts: {
      denominator: { total, verified, unaccepted, nonResults, passed, failed },
      batteries: {
        total: batteries.length,
        verified: verifiedBatteries,
        inBand: inBandBatteries,
        saturated: saturatedBatteries,
        nonSaturated: nonSaturated.length,
        nonSaturatedVerified,
        nonSaturatedFamilies,
      },
      movement: {
        candidatePromoted,
        climbPromoted,
        lastAuthoringOrdinal: Number.isInteger(scorecard?.reach?.lastAuthoring?.ordinal)
          ? scorecard.reach.lastAuthoring.ordinal
          : null,
        submits: {
          compared: submits.compared ?? null,
          moved: submits.moved ?? null,
          stalled: submits.stalled ?? null,
          unchangedTree: submits.unchangedTree ?? null,
        },
        iterationsMoved: iterations.moved ?? null,
      },
      difficultyThresholds: { band: [bandLow, bandHigh], minLevelN: thresholds.minLevelN },
      scanRuleIds: [
        ...new Set((scan.findings ?? []).map((row) => row?.rule).filter((value) => isString(value))),
      ].sort(),
    },
  };
}

function verifySnapshotBytes(snapshotStatus, snapshotDir, runId) {
  const views = new Map((snapshotStatus?.views ?? []).map((row) => [row.label, row]));
  for (const label of requiredSnapshotLabels(runId)) {
    const view = views.get(label);
    const file = view?.file;
    if (
      !isString(file) ||
      isAbsolute(file) ||
      relative(snapshotDir, resolve(snapshotDir, file)).startsWith("..")
    ) {
      return false;
    }
    const path = join(snapshotDir, file);
    if (!existsSync(path)) return false;
    const bytes = readFileSync(path);
    if (view.bytes !== bytes.byteLength || view.sha256 !== sha256(bytes)) return false;
  }
  return true;
}

function inspectSnapshot(run, snapshotDir, processOk) {
  try {
    if (!processOk) return { ok: false, reason: "deterministic-check-failed", processOk, snapshotDir };
    const snapshotStatus = readJsonFile(join(snapshotDir, "snapshot-status.json"));
    // A source tree old enough to write another snapshot schema is refused, not read.
    if (snapshotStatus.schema !== "outcome-snapshot-status/v2") {
      return { ok: false, reason: "snapshot-schema-unsupported", processOk, snapshotDir };
    }
    if (!verifySnapshotBytes(snapshotStatus, snapshotDir, run.runId)) {
      return { ok: false, reason: "snapshot-hash-drift", processOk, snapshotDir };
    }
    const metrics = readJsonFile(join(snapshotDir, `${run.runId}-default.txt`));
    const scan = readJsonFile(join(snapshotDir, `${run.runId}-scan.txt`));
    const scorecard = readJsonFile(join(snapshotDir, `${run.runId}-scorecard.txt`));
    const result = deterministicFacts({ run, snapshotStatus, metrics, scan, scorecard });
    return result.ok ? { ...result, processOk, snapshotDir } : { ...result, processOk, snapshotDir };
  } catch {
    return { ok: false, reason: "deterministic-output-unreadable", processOk, snapshotDir };
  }
}

function runDeterministicChecks(run, snapshotRoot) {
  const candidates = run.sourceCandidates ?? [];
  if (candidates.length === 0) return { ok: false, reason: "source-worktree-unresolved" };
  let lastFailure = { ok: false, reason: "source-worktree-unresolved" };
  for (const [index, sourceWorktree] of candidates.entries()) {
    const traceReview = join(
      sourceWorktree,
      ".claude",
      "skills",
      "whole-run-investigation",
      "scripts",
      "trace-review.mjs",
    );
    if (!existsSync(traceReview)) {
      lastFailure = { ok: false, reason: "trace-review-missing" };
      continue;
    }
    const snapshotDir = join(
      snapshotRoot,
      `${safeName(run.campaignId)}_${safeName(run.runId)}_${run.openingDigest.slice(0, 10)}_${index + 1}`,
    );
    mkdirSync(snapshotDir, { recursive: true });
    let processOk = true;
    try {
      runTextSyncOrThrow(
        [
          Bun.argv[0],
          "--no-env-file",
          traceReview,
          "--campaign",
          run.campaign,
          "--run",
          run.runId,
          "--repo",
          sourceWorktree,
          "--out",
          snapshotDir,
          "--cases",
          "40",
        ],
        { cwd: sourceWorktree, maxBuffer: 256 * 1024 * 1024 },
      );
    } catch {
      processOk = false;
    }
    const inspected = inspectSnapshot(run, snapshotDir, processOk);
    if (inspected.ok) return { ...inspected, sourceWorktree };
    if (processOk) return inspected;
    lastFailure = inspected;
  }
  return lastFailure;
}

function write(path, content) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), content);
}

function lunaInstructionText(report) {
  const finalists = report.shortlist
    .filter((run) => run.archive !== undefined)
    .map(
      (run) =>
        `- ${JSON.stringify({
          key: run.key,
          source: run.source,
          selectedBecause: run.selectedBecause,
          deterministic: run.deterministic,
          synthesisPath: run.archive.synthesisPath,
          synthesisDigest: run.archive.synthesisDigest,
        })}`,
    )
    .join("\n");
  return `You are one independent Luna xhigh review session. You have no delegation, coordination, editing, commit, launch, scoring, claim or promotion authority. Work read-only in ${report.repository.path} at ${report.repository.head}. Evidence outranks prose. The JSON rows below are the sanitised deterministic projection. Read only the named main_synthesis.md files; earlier WRI and Luna prose are claims until reconciled against cited deterministic evidence. Never quote protected verifier detail, task IDs, traces, issue/remedy text or model reasoning. Missing facts stay missing. Report findings first, exact denominators and safe evidence paths, then what was proved, what remains unproved and what you did not inspect.\n\nFinalists:\n${finalists}\n`;
}

function markdown(report) {
  const lines = [
    "# Weekly best-run shortlist",
    "",
    `${report.period.start} to ${report.period.end} (${report.period.timeZone})`,
    "",
    `Completed census: ${report.counts.completed}; ${report.counts.durationEligible} at least ${report.config.minDurationMinutes} minutes; ${report.counts.short} shorter; ${report.counts.durationInvalid} invalid durations; ${report.counts.unfinished} unfinished; ${report.counts.checkFailed} deterministic-check failures; ${report.counts.synthesisGaps} synthesis gaps.`,
    "",
    "The selector supplies finalists, not a capability verdict or a hidden weighted score.",
    "",
    "| seat | run | minutes | V/U/NR | in-band / saturated batteries | candidate / climb promotions | reason | synthesis |",
    "| ---: | --- | ---: | --- | --- | --- | --- | --- |",
  ];
  for (const run of report.shortlist) {
    const d = run.deterministic;
    lines.push(
      `| ${run.seat} | ${run.campaignId}/${run.runId} | ${run.durationMinutes.toFixed(1)} | ${d.denominator.verified}/${d.denominator.unaccepted}/${d.denominator.nonResults} | ${d.batteries.inBand}/${d.batteries.saturated} | ${d.movement.candidatePromoted}/${d.movement.climbPromoted} | ${run.selectedBecause.join(", ")} | ${run.archive?.synthesisPath ?? run.synthesisFailure} |`,
    );
  }
  if (report.blockers.length > 0) {
    lines.push("", "## Blockers", "", ...report.blockers.map((row) => `- ${row.key}: ${row.reason}`));
  }
  return `${lines.join("\n")}\n`;
}

export function buildReport({
  repo,
  campaigns = [],
  now,
  week,
  timezone,
  top,
  minDurationMinutes,
  snapshotRoot,
}) {
  const absoluteRepo = resolve(repo);
  const period = weekWindow({ now, timeZone: timezone, week });
  const roots = campaignRoots(absoluteRepo, campaigns);
  const trees = linkedWorktrees(absoluteRepo);
  const copies = roots
    .flatMap((root) =>
      directories(join(root.campaign, "controller"))
        .map((dir) => join(dir, "opening.json"))
        .filter(existsSync)
        .map((path) => inspectOpening(path, root, period, now)),
    )
    .filter(Boolean);
  const runs = deduplicateRuns(copies);
  const duration = partitionByDuration(runs, minDurationMinutes);
  const snapshots =
    snapshotRoot === null ? mkdtempSync(join(tmpdir(), "ana-weekly-best-runs-")) : resolve(snapshotRoot);
  mkdirSync(snapshots, { recursive: true });
  const checked = duration.admitted.map((run) => {
    const ownerFirst = [
      run.sourceWorktree,
      ...trees.filter((tree) => tree.head === run.source?.commit).map((tree) => tree.path),
    ].filter((path, index, values) => path !== null && values.indexOf(path) === index);
    const withCandidates = { ...run, sourceCandidates: ownerFirst };
    const result = runDeterministicChecks(withCandidates, snapshots);
    if (result.ok) {
      return {
        ...run,
        sourceWorktree: result.sourceWorktree,
        deterministic: result.facts,
        snapshotDir: result.snapshotDir,
      };
    }
    return { ...run, checkFailure: result.reason, missingViews: result.missingViews ?? [] };
  });
  const checkFailed = checked.filter((run) => run.checkFailure !== undefined);
  const deterministicallyRankable = checked.filter((run) => run.checkFailure === undefined);
  const ranked = rankFinalists(deterministicallyRankable, top);
  const shortlist = bindPublishedSyntheses(absoluteRepo, ranked.selected, runs);
  const synthesisGaps = shortlist.filter((run) => run.synthesisFailure !== undefined);
  const ready = shortlist.filter((run) => run.synthesisFailure === undefined);
  const lunaLaunchAllowed = ready.length === top;
  const blockers = [
    ...runs.filter((run) => run.invalid).map((run) => ({ key: run.key, reason: run.reason })),
    ...checkFailed.map((run) => ({ key: run.key, reason: run.checkFailure })),
    ...synthesisGaps.map((run) => ({ key: run.key, reason: run.synthesisFailure })),
  ].sort((left, right) => left.key.localeCompare(right.key));
  const report = {
    schema: WEEKLY_SELECTION_SCHEMA,
    authority: "diagnostic-shortlist-only",
    generatedAt: new Date(now).toISOString(),
    repository: {
      path: absoluteRepo,
      head: gitText(absoluteRepo, "rev-parse", "HEAD"),
      branch: gitMaybe(absoluteRepo, "symbolic-ref", "--short", "-q", "HEAD") ?? "detached",
    },
    period,
    config: {
      top,
      minDurationMinutes,
      deterministicCliViews: DETERMINISTIC_CLI_VIEWS,
      digestView: "digest",
      axes: AXES,
    },
    counts: {
      enumerated: runs.length,
      completed: duration.completed.length,
      durationEligible: duration.admitted.length,
      short: duration.short.length,
      durationInvalid: duration.durationInvalid.length,
      unfinished: duration.unfinished.length,
      damagedOrConflicting: runs.filter((run) => run.invalid).length,
      checkFailed: checkFailed.length,
      synthesisGaps: synthesisGaps.length,
      rankable: deterministicallyRankable.length,
      selected: shortlist.length,
    },
    shortlist,
    overflow: ranked.overflow,
    short: duration.short.map((run) => ({ key: run.key, durationMinutes: run.durationMinutes })),
    unfinished: duration.unfinished.map((run) => ({ key: run.key, openedAt: run.openedAt })),
    blockers,
    luna: {
      reasoningEffort: "xhigh",
      transport: "direct-luna-launcher",
      tasks: admittedLunaPlan(ready, top),
      plannedTaskCount: top * 2 + 6,
      launchAllowed: lunaLaunchAllowed,
      gapPolicy: "A separate full-run audit owns missing WRI syntheses; this selector never fills them.",
    },
  };
  return report;
}

if (import.meta.main) {
  try {
    const args = parseArgs(Bun.argv.slice(2));
    const report = buildReport(args);
    if (args.out !== null) write(args.out, `${JSON.stringify(report, null, 2)}\n`);
    if (args.markdown !== null) write(args.markdown, markdown(report));
    if (args.lunaManifest !== null) {
      const instructions = lunaInstructionText(report);
      write(args.lunaInstructions, instructions);
      write(
        args.lunaManifest,
        `${JSON.stringify(
          {
            workdir: report.repository.path,
            instructionsFile: resolve(args.lunaInstructions),
            sessions: report.luna.launchAllowed
              ? report.luna.tasks.map(({ name, task }) => ({ name, task }))
              : [],
          },
          null,
          2,
        )}\n`,
      );
    }
    if (args.out === null && args.markdown === null) {
      runtimeProcess.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      runtimeProcess.stdout.write(
        `${JSON.stringify({ schema: report.schema, counts: report.counts, lunaTasks: report.luna.tasks.length, launchAllowed: report.luna.launchAllowed })}\n`,
      );
    }
  } catch (error) {
    runtimeProcess.stderr.write(`${errorMessage(error)}\n`);
    runtimeProcess.exit(2);
  }
}

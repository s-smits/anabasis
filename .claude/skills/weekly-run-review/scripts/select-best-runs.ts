#!/usr/bin/env bun
/**
 * The weekly shortlist: five finalists from one calendar week's recorded runs, seated on five
 * named axes, each bound to its published WRI synthesis before any Luna question is planned.
 *
 * Every run is judged on the controller's strict evidence, through `openRecordedRun`, and a run
 * that reader refuses is named with its refusal rather than read leniently and ranked on counts the
 * controller would not stand behind. The facts a finalist is seated on come from the outcome
 * readers of the checkout the selection runs in (`outcomeReport` and the scorecard's learning
 * yield), in process. The selector supplies a review queue, not a capability verdict: there is no
 * weighted score, and duration only admits a run.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#skills/main/git.ts";
import { emitReport } from "#skills/main/output.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import { weekWindow, type WeekWindow, withinWeek } from "#skills/main/week.ts";
import { type BandZone, placeOnBand } from "#src/claim/battery-difficulty.ts";
import { writeJsonFile, readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { sha256OfFile } from "#src/meta/digest.ts";
import { existsSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { climbThresholds } from "#src/run/climb-history.ts";
import type { SourceIdentity } from "#src/run/source-identity.ts";
import { builderToolsReport } from "#tools/outcome/builder-tools.ts";
import { type OutcomeReport, outcomeReport } from "#tools/outcome/metrics.ts";
import { scorecardFromReports } from "#tools/outcome/scorecard.ts";
import { mainCheckout, openedAt, recordedRuns } from "#tools/runs/discover.ts";
import { ARCHIVE_SCHEMA } from "#skills/whole-run-investigation/scripts/archive-shape.mjs";

export const WEEKLY_SELECTION_SCHEMA = "weekly-best-run-selection/v2";

export const AXES = [
  "candidate-promotion",
  "vertical-completion",
  "informative-difficulty",
  "operational-yield",
  "non-saturated-scale",
] as const;
type Axis = (typeof AXES)[number];

/** The zones `placeOnBand` reads as in range: off the aim perhaps, but not significantly off the band. */
const IN_RANGE: ReadonlySet<BandZone> = new Set(["under-aim", "on-aim", "over-aim"]);

export interface RunFacts {
  denominator: { total: number; verified: number; passed: number; unaccepted: number; nonResults: number };
  batteries: {
    total: number;
    verified: number;
    inBand: number;
    saturated: number;
    nonSaturated: number;
    nonSaturatedVerified: number;
    nonSaturatedFamilies: number;
  };
  movement: {
    candidatePromoted: number;
    climbPromoted: number;
    lastAuthoringOrdinal: number | null;
    /** The scorecard's learning yield, which it writes whole or not at all. */
    learning: {
      submitsCompared: number;
      submitsMoved: number;
      submitsStalled: number;
      unchangedTree: number;
      iterationsMoved: number;
    } | null;
  };
}

interface CensusRow {
  key: string;
  campaign: string;
  runId: string;
  source: SourceIdentity;
  outcome: "completed" | "aborted";
  openedAt: string;
  terminalAt: string;
  durationMinutes: number;
}

interface Archive {
  synthesisPath: string;
  runId: string;
  sourceCommit: string;
}

interface Ranked extends CensusRow {
  facts: RunFacts;
}

/** What a seat is decided on: the run key and its facts, and nothing else. */
type Seatable = Pick<Ranked, "key" | "facts">;

interface Finalist extends Ranked {
  seat: number;
  selectedBecause: Axis[];
  synthesis: { path: string; digest: string } | null;
  synthesisGap: string | null;
}

type WeeklyReport = ReturnType<typeof buildReport>;

interface Blocker {
  key: string;
  reason: string;
}

/** Descending on each term of the axis key in turn; the run key breaks a tie. */
const AXIS_ORDER: Record<Axis, { signal: (facts: RunFacts) => boolean; key: (facts: RunFacts) => number[] }> =
  {
    "candidate-promotion": {
      signal: (f) => f.movement.candidatePromoted > 0,
      key: (f) => [f.movement.candidatePromoted],
    },
    "vertical-completion": {
      signal: (f) =>
        f.movement.lastAuthoringOrdinal !== null && f.batteries.verified > 0 && f.movement.learning !== null,
      key: (f) => [f.movement.lastAuthoringOrdinal ?? 0, f.batteries.verified],
    },
    "informative-difficulty": {
      signal: (f) => f.batteries.inBand > 0,
      key: (f) => [f.batteries.inBand, f.batteries.nonSaturatedVerified],
    },
    "operational-yield": {
      signal: (f) => f.movement.learning !== null,
      key: ({ movement: { learning: l } }) =>
        l === null
          ? []
          : [l.submitsMoved + l.iterationsMoved, l.submitsCompared, -l.submitsStalled, -l.unchangedTree],
    },
    "non-saturated-scale": {
      signal: (f) => f.batteries.nonSaturatedVerified > 0,
      key: (f) => [
        f.batteries.nonSaturatedVerified,
        f.batteries.nonSaturated,
        f.batteries.nonSaturatedFamilies,
      ],
    },
  };

/**
 * One recorded run's seat facts, read off its outcome report and scorecard. A run whose controller
 * recorded no case denominator has nothing to be seated on and is refused, not ranked at zero.
 */
export function seatFacts(
  outcome: OutcomeReport,
  scorecard: ReturnType<typeof scorecardFromReports>,
): RunFacts {
  const { controller } = outcome;
  if (controller.state !== "recorded" || controller.denominator.state !== "recorded") {
    throw new Error("denominator-unrecorded");
  }
  const { total, verified, unaccepted, nonResults } = controller.denominator;
  const band = climbThresholds().band;
  const batteries = Object.values(outcome.batteries).map((row) => ({
    verified: row.cases.verified,
    passes: row.passRate.successes,
    n: row.passRate.n,
    families: Object.keys(row.families).length,
    zone: placeOnBand(row.passRate.successes, row.passRate.n, band)?.zone ?? null,
  }));
  // A perfect or an all-fail battery found no limit, whatever its size.
  const saturated = batteries.filter((row) => row.n > 0 && (row.passes === 0 || row.passes === row.n));
  const open = batteries.filter((row) => row.n > 0 && !saturated.includes(row));
  const promoted = outcome.promotions.filter((row) => row.decision === "promoted");
  const yieldAxis = scorecard.learningYield;
  const sum = (rows: readonly { verified: number }[]): number =>
    rows.reduce((acc, row) => acc + row.verified, 0);
  return {
    denominator: {
      total,
      verified,
      passed: batteries.reduce((acc, row) => acc + row.passes, 0),
      unaccepted,
      nonResults,
    },
    batteries: {
      total: batteries.length,
      verified: batteries.filter((row) => row.verified > 0).length,
      inBand: batteries.filter((row) => row.zone !== null && IN_RANGE.has(row.zone)).length,
      saturated: saturated.length,
      nonSaturated: open.length,
      nonSaturatedVerified: sum(open),
      nonSaturatedFamilies: open.reduce((acc, row) => acc + row.families, 0),
    },
    movement: {
      candidatePromoted: promoted.filter((row) => row.experiment !== "climb").length,
      climbPromoted: promoted.filter((row) => row.experiment === "climb").length,
      lastAuthoringOrdinal: scorecard.reach?.lastAuthoring?.ordinal ?? null,
      learning:
        yieldAxis === undefined
          ? null
          : {
              submitsCompared: yieldAxis.submits.compared,
              submitsMoved: yieldAxis.submits.moved,
              submitsStalled: yieldAxis.submits.stalled,
              unchangedTree: yieldAxis.submits.unchangedTree,
              iterationsMoved: yieldAxis.iterations.moved,
            },
    },
  };
}

function byAxis(axis: Axis): (left: Seatable, right: Seatable) => number {
  const { key } = AXIS_ORDER[axis];
  return (left, right) => {
    const a = key(left.facts);
    const b = key(right.facts);
    const differing = a.findIndex((value, index) => value !== b[index]);
    return differing === -1 ? left.key.localeCompare(right.key) : (b[differing] ?? 0) - (a[differing] ?? 0);
  };
}

/**
 * Seats walk the axes in turn, one depth at a time, so every axis that has a signalling run seats
 * its leader before any axis seats a second. A run carries every axis that reached it before the
 * shortlist filled; the walk stops the instant it is full.
 */
export function rankFinalists<T extends Seatable>(runs: readonly T[], top: number) {
  const ordered = AXES.map(
    (axis) => [axis, runs.filter((run) => AXIS_ORDER[axis].signal(run.facts)).sort(byAxis(axis))] as const,
  );
  const seats = new Map<string, { run: T; because: Axis[] }>();
  for (let depth = 0; seats.size < top && depth < runs.length; depth += 1) {
    for (const [axis, list] of ordered) {
      const run = list[depth];
      if (run === undefined) continue;
      const seat = seats.get(run.key) ?? { run, because: [] };
      seat.because.push(axis);
      seats.set(run.key, seat);
      if (seats.size === top) break;
    }
  }
  return {
    selected: [...seats.values()].map(({ run, because }, index) => ({
      ...run,
      seat: index + 1,
      selectedBecause: because,
    })),
    overflow: runs.filter((run) => !seats.has(run.key)).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Published WRI archives under `<repo>/notes/runs`, by run id. Only an `ARCHIVE_SCHEMA` review
 *  naming its run and full source revision beside a synthesis is indexed. */
export function publishedArchives(repo: string): Map<string, Archive[]> {
  const root = join(repo, "notes", "runs");
  const index = new Map<string, Archive[]>();
  for (const folder of existsSync(root) ? readdirSync(root) : []) {
    const synthesisPath = join(root, folder, "main_synthesis.md");
    const review = asRecord(readJsonFileOrNull(join(root, folder, "review.json")));
    const identity = asRecord(review?.identity);
    const runId = identity?.runId;
    const sourceCommit = identity?.sourceRevision;
    if (review?.schema !== ARCHIVE_SCHEMA || !existsSync(synthesisPath)) continue;
    if (!isString(runId) || !isString(sourceCommit) || !/^[0-9a-f]{40}$/.test(sourceCommit)) continue;
    index.set(runId, [...(index.get(runId) ?? []), { synthesisPath, runId, sourceCommit }]);
  }
  return index;
}

/**
 * The one synthesis that answers for `run`. An archive names no campaign — its folder is a label —
 * so it binds by run id and full source revision, and only while no second campaign in the week's
 * census recorded the same pair.
 */
export function bindSynthesis(
  run: Pick<CensusRow, "runId" | "source">,
  archives: ReadonlyMap<string, readonly Archive[]>,
  census: readonly Pick<CensusRow, "runId" | "source" | "campaign">[],
): { path: string; digest: string } | string {
  const entries = archives.get(run.runId) ?? [];
  const matching = entries.filter((entry) => entry.sourceCommit === run.source.commit);
  if (matching.length === 0) return entries.length === 0 ? "synthesis-missing" : "synthesis-source-mismatch";
  const twins = census.filter((row) => row.runId === run.runId && row.source.commit === run.source.commit);
  if (new Set(twins.map((row) => row.campaign)).size > 1) return "synthesis-campaign-ambiguous";
  const [only, ...more] = matching;
  if (only === undefined || more.length > 0) return "synthesis-conflict";
  return { path: only.synthesisPath, digest: sha256OfFile(only.synthesisPath) };
}

/** Two questions of each finalist and six of the field. */
export function buildLunaPlan(
  finalists: readonly Pick<Finalist, "key" | "synthesis">[],
): Array<{ name: string; runKey: string | null; task: string }> {
  const perRun = finalists.flatMap(({ key, synthesis }) => {
    const prefix = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const read = `Read ${synthesis?.path ?? "(no synthesis)"} and the deterministic row for ${key}.`;
    return [
      {
        name: `${prefix}_mechanism`,
        runKey: key,
        task: `${read} Identify what made this run unusually good, the evidence level of each mechanism, one rival explanation and one falsifier.`,
      },
      {
        name: `${prefix}_counterfactual`,
        runKey: key,
        task: `${read} Identify what could have made it better without erasing what worked; give one bounded counterfactual condition and the evidence that would decide it.`,
      },
    ];
  });
  const cross = [
    [
      "comparability",
      "Compare the five finalists. State which are comparable and refuse any pooled ranking across different conditions.",
    ],
    [
      "vertical",
      "Identify the deepest completed build-adopt-measure-claim-climb vertical. Separate completed stages from starts and prose.",
    ],
    [
      "difficulty",
      "Identify which finalist found a useful difficulty boundary. Treat a perfect or all-fail battery as saturation, not breadth.",
    ],
    [
      "improvement",
      "Identify the strongest attributable improvement and every claim, provenance or promotion limit that remains.",
    ],
    [
      "efficiency",
      "Compare learning that changed a decision against wall duration and censored cases. Keep provider and environment non-results separate from product failures.",
    ],
    [
      "best_action",
      "Blindly challenge the proposed best overall, then define what should happen next: mechanisms to preserve, one limitation to target, and one falsifiable next condition. Prefer no unique winner when the evidence is split.",
    ],
  ].map(([name, task]) => ({ name: `cross_${name}`, runKey: null, task: task ?? "" }));
  return finalists.length === 0 ? [] : [...perRun, ...cross];
}

/**
 * The week's census: runs whose terminal the controller recorded inside the window, those still
 * open that opened inside it, and those its strict reader refused, filed by their opening. A
 * terminal written after `now` is refused too, so a census pinned to an instant stays the census
 * of that instant however much later it is rerun.
 */
function weekCensus(repo: string, period: WeekWindow, now: string) {
  const recorded: CensusRow[] = [];
  const unfinished: string[] = [];
  const refused: Blocker[] = [];
  for (const location of recordedRuns(mainCheckout(repo))) {
    const key = `${location.slug}/${location.runId}`;
    const openedInWeek = withinWeek(openedAt(location) ?? "", period);
    let run;
    try {
      run = openRecordedRun(location.campaignDir, location.runId);
    } catch (error) {
      if (openedInWeek) refused.push({ key, reason: errorMessage(error) });
      continue;
    }
    const { controller, opening } = run;
    if (controller === null) {
      if (openedInWeek) refused.push({ key, reason: run.controllerError ?? "controller evidence refused" });
    } else if (controller.state !== "recorded") {
      if (openedInWeek) unfinished.push(key);
    } else if (Date.parse(controller.writtenAt) > Date.parse(now)) {
      if (withinWeek(controller.writtenAt, period)) refused.push({ key, reason: "terminal-in-future" });
    } else if (withinWeek(controller.writtenAt, period)) {
      const started = isString(opening.writtenAt) ? opening.writtenAt : "";
      const durationMinutes = (Date.parse(controller.writtenAt) - Date.parse(started)) / 60_000;
      if (!(durationMinutes >= 0)) {
        refused.push({ key, reason: "terminal-precedes-opening" });
        continue;
      }
      recorded.push({
        key,
        campaign: run.campaign,
        runId: run.runId,
        source: run.source,
        outcome: controller.outcome,
        openedAt: started,
        terminalAt: controller.writtenAt,
        durationMinutes,
      });
    }
  }
  return { recorded, unfinished, refused };
}

export function buildReport(input: {
  repo: string;
  now: string;
  week: WeekWindow["week"];
  timeZone: string;
  top: number;
  minDurationMinutes: number;
}) {
  const { repo, top, minDurationMinutes } = input;
  const period = weekWindow(input.now, input.timeZone, input.week);
  const { recorded, unfinished, refused } = weekCensus(repo, period, input.now);
  const eligible = recorded.filter((row) => row.durationMinutes >= minDurationMinutes);
  const ranked: Ranked[] = [];
  const checkFailed: Blocker[] = [];
  for (const row of eligible) {
    try {
      const outcome = outcomeReport(row.campaign, row.runId, null);
      const scorecard = scorecardFromReports(builderToolsReport(row.campaign), outcome, row.runId);
      ranked.push({ ...row, facts: seatFacts(outcome, scorecard) });
    } catch (error) {
      checkFailed.push({ key: row.key, reason: errorMessage(error) });
    }
  }
  const { selected, overflow } = rankFinalists(ranked, top);
  const archives = publishedArchives(repo);
  const shortlist: Finalist[] = selected.map((run) => {
    const bound = bindSynthesis(run, archives, recorded);
    return isString(bound)
      ? { ...run, synthesis: null, synthesisGap: bound }
      : { ...run, synthesis: bound, synthesisGap: null };
  });
  const gaps = shortlist.flatMap((run) =>
    run.synthesisGap === null ? [] : [{ key: run.key, reason: run.synthesisGap }],
  );
  // A plan over fewer finalists than the shortlist asked for compares a different field.
  const launchAllowed = shortlist.length === top && gaps.length === 0;
  return {
    schema: WEEKLY_SELECTION_SCHEMA,
    authority: "diagnostic-shortlist-only",
    generatedAt: new Date(input.now).toISOString(),
    repository: {
      path: repo,
      head: gitText(repo, "rev-parse", "HEAD"),
      branch: gitMaybe(repo, "symbolic-ref", "--short", "-q", "HEAD") ?? "detached",
    },
    period,
    config: { top, minDurationMinutes, axes: AXES },
    counts: {
      completed: recorded.length,
      durationEligible: eligible.length,
      short: recorded.length - eligible.length,
      unfinished: unfinished.length,
      refused: refused.length,
      checkFailed: checkFailed.length,
      synthesisGaps: gaps.length,
      rankable: ranked.length,
      selected: shortlist.length,
    },
    shortlist,
    overflow,
    short: recorded
      .filter((row) => !eligible.includes(row))
      .map(({ key, durationMinutes }) => ({ key, durationMinutes })),
    unfinished,
    blockers: [...refused, ...checkFailed, ...gaps].sort((a, b) => a.key.localeCompare(b.key)),
    luna: {
      reasoningEffort: "xhigh",
      launchAllowed,
      plannedTaskCount: top * 2 + 6,
      tasks: launchAllowed ? buildLunaPlan(shortlist) : [],
    },
  };
}

function lunaInstructions(report: WeeklyReport): string {
  const rows = report.shortlist.map(
    ({ key, source, selectedBecause, facts, synthesis }) =>
      `- ${JSON.stringify({ key, source, selectedBecause, facts, synthesis })}`,
  );
  return `You are one independent Luna xhigh review session. You have no delegation, coordination, editing, commit, launch, scoring, claim or promotion authority. Work read-only in ${report.repository.path} at ${report.repository.head}. Evidence outranks prose. The JSON rows below are the sanitised deterministic projection. Read only the named main_synthesis.md files; earlier WRI and Luna prose are claims until reconciled against cited deterministic evidence. Never quote protected verifier detail, task IDs, traces, issue/remedy text or model reasoning. Missing facts stay missing. Report findings first, exact denominators and safe evidence paths, then what was proved, what remains unproved and what you did not inspect.\n\nFinalists:\n${rows.join("\n")}\n`;
}

function markdown(report: WeeklyReport): string {
  const { counts, config, period } = report;
  const lines = [
    "# Weekly best-run shortlist",
    "",
    `${period.start} to ${period.end} (${period.timeZone})`,
    "",
    `Completed: ${counts.completed}; ${counts.durationEligible} at least ${config.minDurationMinutes} minutes; ${counts.short} shorter; ${counts.unfinished} unfinished; ${counts.refused} refused by the controller reader; ${counts.checkFailed} unrankable; ${counts.synthesisGaps} synthesis gaps.`,
    "",
    "The selector supplies finalists, not a capability verdict or a hidden weighted score.",
    "",
    "| seat | run | minutes | V/U/NR | passed | in-band / saturated batteries | candidate / climb promotions | reason | synthesis |",
    "| ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |",
    ...report.shortlist.map(
      ({
        seat,
        key,
        durationMinutes,
        facts: { denominator: d, batteries: b, movement: m },
        selectedBecause,
        synthesis,
        synthesisGap,
      }) =>
        `| ${seat} | ${key} | ${durationMinutes.toFixed(1)} | ${d.verified}/${d.unaccepted}/${d.nonResults} | ${d.passed} | ${b.inBand}/${b.saturated} | ${m.candidatePromoted}/${m.climbPromoted} | ${selectedBecause.join(", ")} | ${synthesis?.path ?? synthesisGap} |`,
    ),
  ];
  if (report.blockers.length > 0) {
    lines.push("", "## Blockers", "", ...report.blockers.map((row) => `- ${row.key}: ${row.reason}`));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "select-best-runs",
      usage:
        "usage: bun select-best-runs.ts --repo <abs main checkout> [--week previous|current] [--timezone Europe/Oslo] [--now <ISO>] [--top 5] [--min-duration-minutes 30] [--luna-manifest <abs .json>] [--out <abs .json>] [--json]",
      options: {
        repo: "abs",
        week: "text",
        timezone: "text",
        now: "text",
        top: "int",
        "min-duration-minutes": "int",
        "luna-manifest": "abs",
        out: "abs",
        json: "flag",
      },
    },
    (args: CommandArgs) => {
      const week = args.value("week") ?? "previous";
      if (week !== "previous" && week !== "current") args.die("--week must be previous or current");
      const top = args.int("top") ?? 5;
      const minDurationMinutes = args.int("min-duration-minutes") ?? 30;
      if (top < 1 || minDurationMinutes < 0) {
        args.die("--top must be positive and --min-duration-minutes non-negative");
      }
      const report = buildReport({
        repo: args.value("repo") ?? resolve("."),
        now: args.value("now") ?? new Date().toISOString(),
        week,
        timeZone: args.value("timezone") ?? "Europe/Oslo",
        top,
        minDurationMinutes,
      });
      const manifest = args.value("luna-manifest");
      if (manifest !== null) {
        const instructionsFile = manifest.replace(/\.json$/, "") + ".instructions.md";
        writeFileSync(instructionsFile, lunaInstructions(report));
        const sessions = report.luna.tasks.map(({ name, task }) => ({ name, task }));
        writeJsonFile(manifest, { workdir: report.repository.path, instructionsFile, sessions });
      }
      emitReport(report, { json: args.flag("json"), out: args.value("out"), render: markdown });
    },
  );
}

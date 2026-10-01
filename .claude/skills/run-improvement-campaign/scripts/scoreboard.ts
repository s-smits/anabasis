#!/usr/bin/env bun

/**
 * The Super Loop's scoreboard: what each run's claimed batteries did for the climb, grouped by
 * source and Builder model so a pass can see whether a change moved anything. It finds runs and
 * reads their openings as `runs pulse` does (`recordedRuns`, `readRunEvidence`), and reads each
 * campaign's line and earned fails through `wri.ts climb`'s own readers (`outcomeRowsOf`, `lineOf`,
 * `lineTally`, `followUpOf`) and its solve walls through `wri.ts walls` (`buildWalls`), so a number
 * here and a `climb` or `walls` line cannot disagree. It loads no model, and task bytes only for a
 * battery that holds an earned fail.
 *
 * What it adds is the numbers the loop is judged on. Signal is how many of a run's first eight
 * batteries land between 1/n and n-1/n, and how many hours the run took to reach its first. It is
 * rare at the size we run, so two readings stand beside it. The wall share is the median share of
 * the solve wall a battery's cases used, which moves on every battery. The follow-up is the run's
 * earned fails, how many of them the next battery carried unchanged, and how many of those passed
 * there after the agent changed: a climb step answered.
 *
 * Read only and one campaign at a time: nothing but the numbers outlives a campaign's read. It
 * writes nothing and takes no lock; the one store it opens is each campaign's controller ledger,
 * through `buildWalls`, to name the product whose `agent/config.yaml` declared a battery's wall.
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import {
  followUpCounts,
  followUpOf,
  lineOf,
  lineTally,
  outcomeRowsOf,
} from "../../whole-run-investigation/scripts/climb-velocity.ts";
import { buildWalls } from "../../whole-run-investigation/scripts/walls.ts";
import { mainCheckout, recordedRuns, type RunLocation } from "#tools/runs/discover.ts";
import { readRunEvidence } from "#tools/runs/evidence.ts";

const USAGE = `usage: scoreboard.ts [--repo <abs checkout>] [--since <ISO date>] [--match <text>] [--json]

Every run opened since --since (default: all) whose campaign or run id contains --match. Per run:
batteries on its line, signal in the first 8 and in all, full passes, swing, hours from the opening
to the first signal battery, the median share of the solve wall its batteries used and the latest
battery's share, the fails of its signal batteries as the review left them (held, settled against
the check, unsettled), and its earned fails: how many the next battery carried unchanged, and how
many of those passed there after the agent changed (answered). Then one row per source and Builder
model: signal of the first 8, the median wall share over runs, and the same earned-fail counts.`;

type FollowUpCounts = ReturnType<typeof followUpCounts>;

export interface RunScore {
  runId: string;
  campaign: string;
  builder: string;
  source: string;
  openedAt: string;
  batteries: number;
  signal: number;
  first8: { signal: number; batteries: number };
  fullPasses: number;
  swing: number | null;
  hoursToSignal: number | null;
  fails: { held: number; against: number; unsettled: number };
  /** Each battery's median case share of its solve wall (`wri.ts walls`), over the run's line: the
   *  median of those, the latest battery's, and how many batteries recorded one. */
  wall: { median: number | null; latest: number | null; batteries: number };
  /** The earned fails of the run's adopted batteries, each followed into the next battery on the
   *  campaign's line (`followUpCounts`). */
  followUp: FollowUpCounts;
}

/** One source and Builder model: the unit a pass compares against the arm beside it. */
export interface GroupScore {
  source: string;
  builder: string;
  runs: number;
  measured: number;
  /** Signal batteries among the first eight of each run, over the batteries those eight held. */
  first8: { signal: number; batteries: number };
  all: { signal: number; batteries: number };
  /** The median over runs of each run's median wall share, and the runs that had one. */
  wall: { median: number | null; runs: number };
  followUp: FollowUpCounts;
  firstSignal: { reached: number; medianHours: number | null };
}

const fixed = (value: number | null) => (value === null ? "-" : value.toFixed(1));
const percent = (value: number | null) => (value === null ? "-" : `${(value * 100).toFixed(1)}%`);

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return null;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function scoreCampaign(campaignDir: string, runs: readonly RunLocation[]): RunScore[] {
  // A campaign that never adopted a version has no line yet; its runs still get a row.
  const report = existsSync(join(campaignDir, "versions"))
    ? outcomeRowsOf(campaignDir)
    : { batteries: [], unadopted: [] };
  const every = [...report.batteries, ...report.unadopted];
  const walls = new Map(buildWalls({ campaign: campaignDir }).batteries.map((row) => [row.runId, row]));
  return runs.map((location) => {
    const { runId } = location;
    // A battery belongs to the run whose id it extends: the run's own first battery, then `-iNN`.
    const owned = (battery: { runId: string }) =>
      battery.runId === runId || battery.runId.startsWith(`${runId}-i`);
    const line = lineOf({
      batteries: report.batteries.filter(owned),
      unadopted: report.unadopted.filter(owned),
    });
    const { first, fails } = lineTally(line, every);
    const shares = line.points.flatMap((point) => walls.get(point.runId)?.time.median ?? []);
    const opening = readRunEvidence(location).opening;
    const builder = opening?.slots.find((slot) => slot.role === "builder");
    const openedAt = opening?.writtenAt ?? "";
    const claimedAt = every.find((battery) => battery.runId === line.signal[0]?.runId)?.createdAt ?? null;
    return {
      runId,
      campaign: location.slug,
      builder: `${builder?.model ?? "?"}@${builder?.effort ?? "?"}`,
      source: (opening?.commit ?? "?").slice(0, 8),
      openedAt,
      batteries: line.points.length,
      signal: line.signal.length,
      first8: first,
      fullPasses: line.fullPasses,
      swing: line.swing,
      hoursToSignal:
        claimedAt === null || openedAt === ""
          ? null
          : (Date.parse(claimedAt) - Date.parse(openedAt)) / 3_600_000,
      fails,
      wall: {
        median: median(shares),
        latest: walls.get(line.points.at(-1)?.runId ?? "")?.time.median ?? null,
        batteries: shares.length,
      },
      followUp: followUpCounts(
        report.batteries.flatMap((battery, at) =>
          owned(battery) ? [followUpOf(campaignDir, battery, report.batteries[at + 1])] : [],
        ),
      ),
    };
  });
}

/** One score per source and Builder model, in the order the runs first name it. */
export function groupScores(scores: readonly RunScore[]): GroupScore[] {
  const groups = new Map<string, RunScore[]>();
  for (const score of scores) {
    const key = `${score.source}  ${score.builder}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
  return [...groups.values()].map((runs) => {
    const sum = (count: (run: RunScore) => number) => runs.reduce((total, run) => total + count(run), 0);
    const walls = runs.flatMap((run) => run.wall.median ?? []);
    const reached = runs.flatMap((run) => run.hoursToSignal ?? []);
    return {
      source: runs[0]?.source ?? "?",
      builder: runs[0]?.builder ?? "?",
      runs: runs.length,
      measured: runs.filter((run) => run.batteries > 0).length,
      first8: { signal: sum((run) => run.first8.signal), batteries: sum((run) => run.first8.batteries) },
      all: { signal: sum((run) => run.signal), batteries: sum((run) => run.batteries) },
      wall: { median: median(walls), runs: walls.length },
      followUp: {
        earned: sum((run) => run.followUp.earned),
        last: sum((run) => run.followUp.last),
        carried: sum((run) => run.followUp.carried),
        passed: sum((run) => run.followUp.passed),
        answered: sum((run) => run.followUp.answered),
      },
      firstSignal: { reached: reached.length, medianHours: median(reached) },
    };
  });
}

const followUpText = (f: FollowUpCounts) =>
  `earned fails ${f.earned}, ${f.carried} carried unchanged, ${f.answered} answered`;

function groupLine(g: GroupScore): string {
  return `${g.source}  ${g.builder}  runs ${g.runs} (${g.measured} measured)  first-8 signal ${g.first8.signal}/${g.first8.batteries}  wall ${percent(g.wall.median)} (n ${g.wall.runs} runs)  ${followUpText(g.followUp)}  signal in all ${g.all.signal}/${g.all.batteries}  first signal in ${g.firstSignal.reached} runs, median ${fixed(g.firstSignal.medianHours)} h`;
}

/** Every run the filters select, read one campaign at a time. */
export function scoreRuns(repo: string, since: string, match: string): RunScore[] {
  const byCampaign = new Map<string, RunLocation[]>();
  for (const location of recordedRuns(repo)) {
    if (match !== "" && !location.slug.includes(match) && !location.runId.includes(match)) continue;
    if ((readRunEvidence(location).opening?.writtenAt ?? "") < since) continue;
    byCampaign.set(location.campaignDir, [...(byCampaign.get(location.campaignDir) ?? []), location]);
  }
  const scores: RunScore[] = [];
  for (const [campaignDir, runs] of [...byCampaign].sort(([a], [b]) => a.localeCompare(b))) {
    scores.push(...scoreCampaign(campaignDir, runs));
  }
  return scores.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

function scoreboard(args: CommandArgs): void {
  const scores = scoreRuns(
    args.value("repo") ?? mainCheckout(import.meta.dir),
    args.value("since") ?? "",
    args.value("match") ?? "",
  );
  const groups = groupScores(scores);
  if (args.flag("json")) {
    console.log(JSON.stringify({ runs: scores, groups }, null, 2));
    return;
  }
  for (const s of scores) {
    console.log(
      `${s.openedAt.slice(0, 16)}  ${s.runId}  ${s.builder}  ${s.source}  batteries ${s.batteries}  signal ${s.first8.signal} of first 8 (${s.signal} in all)  full ${s.fullPasses}  swing ${fixed(s.swing)}  first signal ${fixed(s.hoursToSignal)} h  wall ${percent(s.wall.median)} median, ${percent(s.wall.latest)} latest (n ${s.wall.batteries})  fails held ${s.fails.held}, against ${s.fails.against}, unsettled ${s.fails.unsettled}  ${followUpText(s.followUp)}`,
    );
  }
  const batteries = scores.reduce((sum, s) => sum + s.batteries, 0);
  const signal = scores.reduce((sum, s) => sum + s.signal, 0);
  console.log(`\nby source and Builder\n${groups.map(groupLine).join("\n")}`);
  console.log(`\nall: ${scores.length} runs, signal ${signal} of ${batteries} batteries`);
}

if (import.meta.main) {
  await runCommand(
    {
      name: "scoreboard",
      usage: USAGE,
      options: { repo: "abs", since: "text", match: "text", json: "flag", help: "flag" },
    },
    scoreboard,
  );
}

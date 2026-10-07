#!/usr/bin/env bun

/**
 * The Super Loop's scoreboard: what each run's claimed batteries did for the climb, grouped by
 * source and Builder model so a pass can see whether a change moved anything. It finds runs and
 * reads their openings as `runs pulse` does (`recordedRuns`, `readRunEvidence`), and reads each
 * campaign's line and earned fails through `wri.ts climb`'s own readers (`outcomeRowsOf`, `lineOf`,
 * `followUpOf`) and its solve walls through `wri.ts walls` (`buildWalls`), so a number here and a
 * `climb` or `walls` line cannot disagree. Signal is rare at the size we run, so two readings stand
 * beside it: the wall share, which moves on every battery, and the follow-up, a climb step answered.
 * It loads no model, task bytes only for a battery holding an earned fail, and one campaign at a
 * time; it writes nothing, and the one store it opens is each campaign's controller ledger.
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { median } from "#src/meta/tally.ts";
import {
  followUpCounts,
  followUpOf,
  HORIZONS,
  lineOf,
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
the check, unsettled), and its earned fails: how many passed another solve under the same solver
(flips), how many failed every further solve the controller made of them (confirmed), how many the
next battery carried unchanged, and how many confirmed fails then passed there after the agent
changed (answered, read per confirmed fail); beside them, the verified fails the Judge contested,
counted apart as instrument-dispute candidates. Then one row per source and Builder model: signal of
the first 8, the median wall share over runs, and the same earned-fail counts.`;

type RunScore = ReturnType<typeof scoreCampaign>[number];

const fixed = (value: number | null) => (value === null ? "-" : value.toFixed(1));
const percent = (value: number | null) => (value === null ? "-" : `${(value * 100).toFixed(1)}%`);

function scoreCampaign(campaignDir: string, runs: readonly RunLocation[]) {
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
    const first = line.points.slice(0, HORIZONS[0]);
    const fails = { held: 0, against: 0, unsettled: 0 };
    for (const { runId: id, counts, settlement } of every) {
      if (!line.signal.some((point) => point.runId === id)) continue;
      const { failsHeld, failsAgainst } = settlement ?? { failsHeld: 0, failsAgainst: 0 };
      fails.held += failsHeld;
      fails.against += failsAgainst;
      fails.unsettled += Math.max(0, counts.verified - counts.passed - failsHeld - failsAgainst);
    }
    // Each battery's median case share of its solve wall, over the run's line.
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
      first8: {
        signal: first.filter((point) => line.signal.includes(point)).length,
        batteries: first.length,
      },
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
      // The earned fails of the run's adopted batteries, each followed into the next on the line.
      followUp: followUpCounts(
        report.batteries.flatMap((battery, at) =>
          owned(battery) ? [followUpOf(campaignDir, battery, report.batteries[at + 1])] : [],
        ),
      ),
    };
  });
}

/** One score per source and Builder model, the unit a pass compares against the arm beside it, in
 *  the order the runs first name it; the wall is the median over runs of each run's median. */
function groupScores(scores: readonly RunScore[]) {
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
        flips: sum((run) => run.followUp.flips),
        confirmed: sum((run) => run.followUp.confirmed),
        last: sum((run) => run.followUp.last),
        carried: sum((run) => run.followUp.carried),
        passed: sum((run) => run.followUp.passed),
        answered: sum((run) => run.followUp.answered),
        contested: sum((run) => run.followUp.contested),
      },
      firstSignal: { reached: reached.length, medianHours: median(reached) },
    };
  });
}

const followUpText = (f: RunScore["followUp"]) =>
  `earned fails ${f.earned} (${f.flips} flips, ${f.confirmed} confirmed), ${f.carried} carried unchanged, ${f.answered} of ${f.confirmed} confirmed answered  contested fails ${f.contested}`;

function scoreboard(args: CommandArgs): void {
  const [since, match] = [args.value("since") ?? "", args.value("match") ?? ""];
  const byCampaign = new Map<string, RunLocation[]>();
  for (const location of recordedRuns(args.value("repo") ?? mainCheckout(import.meta.dir))) {
    if (match !== "" && !location.slug.includes(match) && !location.runId.includes(match)) continue;
    if ((readRunEvidence(location).opening?.writtenAt ?? "") < since) continue;
    byCampaign.set(location.campaignDir, [...(byCampaign.get(location.campaignDir) ?? []), location]);
  }
  const scores: RunScore[] = [];
  for (const [campaignDir, runs] of [...byCampaign].sort(([a], [b]) => a.localeCompare(b))) {
    scores.push(...scoreCampaign(campaignDir, runs));
  }
  scores.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
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
  const groupLines = groups.map(
    (g) =>
      `${g.source}  ${g.builder}  runs ${g.runs} (${g.measured} measured)  first-8 signal ${g.first8.signal}/${g.first8.batteries}  wall ${percent(g.wall.median)} (n ${g.wall.runs} runs)  ${followUpText(g.followUp)}  signal in all ${g.all.signal}/${g.all.batteries}  first signal in ${g.firstSignal.reached} runs, median ${fixed(g.firstSignal.medianHours)} h`,
  );
  console.log(`\nby source and Builder\n${groupLines.join("\n")}`);
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

#!/usr/bin/env bun

/**
 * The Super Loop's scoreboard: what each run's claimed batteries did for the climb, grouped by
 * source and Builder model so a pass can see whether a change moved anything. It finds runs and
 * reads their openings as `runs pulse` does (`recordedRuns`, `readRunEvidence`), and reads each
 * campaign's line through `wri.ts climb`'s own readers (`outcomeRowsOf`, `lineOf`), so a number here
 * and a `climb` line cannot disagree. It reads the outcome side alone: no task bytes and no model.
 * What it adds is the two numbers the loop is judged on: how many of a run's first eight batteries
 * carry signal (between 1/n and n-1/n), and how many hours the run took to reach its first. Read
 * only; it opens no ledger and no lock.
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { lineOf, outcomeRowsOf } from "../../whole-run-investigation/scripts/climb-velocity.ts";
import { mainCheckout, recordedRuns, type RunLocation } from "#tools/runs/discover.ts";
import { readRunEvidence } from "#tools/runs/evidence.ts";

const USAGE = `usage: scoreboard.ts [--repo <abs checkout>] [--since <ISO date>] [--match <text>] [--json]

Every run opened since --since (default: all) whose campaign or run id contains --match. Per run:
batteries on its line, signal in the first 8 and in all, full passes, swing, hours from the opening
to the first signal battery, and the fails of its signal batteries as the review left them (held,
settled against the check, unsettled). Then one row per source and Builder model.`;

/** The horizon AGENTS.md "Goals and the climb" reads a climb over first. */
const HORIZON = 8;

export interface RunScore {
  runId: string;
  campaign: string;
  builder: string;
  source: string;
  openedAt: string;
  batteries: number;
  signal: number;
  signalFirst8: number;
  fullPasses: number;
  swing: number | null;
  hoursToSignal: number | null;
  fails: { held: number; against: number; unsettled: number };
}

function scoreCampaign(campaignDir: string, runs: readonly RunLocation[]): RunScore[] {
  // A campaign that never adopted a version has no line yet; its runs still get a row.
  const report = existsSync(join(campaignDir, "versions"))
    ? outcomeRowsOf(campaignDir)
    : { batteries: [], unadopted: [] };
  const every = [...report.batteries, ...report.unadopted];
  return runs.map((location) => {
    const { runId } = location;
    // A battery belongs to the run whose id it extends: the run's own first battery, then `-iNN`.
    const owned = (battery: { runId: string }) =>
      battery.runId === runId || battery.runId.startsWith(`${runId}-i`);
    const line = lineOf({
      batteries: report.batteries.filter(owned),
      unadopted: report.unadopted.filter(owned),
    });
    const fails = { held: 0, against: 0, unsettled: 0 };
    for (const point of line.signal) {
      const battery = every.find((row) => row.runId === point.runId);
      const held = battery?.settlement?.failsHeld ?? 0;
      const against = battery?.settlement?.failsAgainst ?? 0;
      fails.held += held;
      fails.against += against;
      fails.unsettled += Math.max(
        0,
        (battery?.counts.verified ?? 0) - (battery?.counts.passed ?? 0) - held - against,
      );
    }
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
      signalFirst8: line.signal.filter((point) => line.points.indexOf(point) < HORIZON).length,
      fullPasses: line.fullPasses,
      swing: line.swing,
      hoursToSignal:
        claimedAt === null || openedAt === ""
          ? null
          : (Date.parse(claimedAt) - Date.parse(openedAt)) / 3_600_000,
      fails,
    };
  });
}

const fixed = (value: number | null) => (value === null ? "-" : value.toFixed(1));

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return null;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** One row per source and Builder model: the unit a pass compares against the arm beside it. */
export function groupRows(scores: readonly RunScore[]): string[] {
  const groups = new Map<string, RunScore[]>();
  for (const score of scores) {
    const key = `${score.source}  ${score.builder}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }
  return [...groups].map(([key, runs]) => {
    const batteries = runs.reduce((sum, run) => sum + run.batteries, 0);
    const signal = runs.reduce((sum, run) => sum + run.signal, 0);
    const measured = runs.filter((run) => run.batteries > 0);
    const first8 = measured.reduce((sum, run) => sum + run.signalFirst8, 0);
    const reached = runs.flatMap((run) => (run.hoursToSignal === null ? [] : [run.hoursToSignal]));
    const mean = measured.length === 0 ? null : first8 / measured.length;
    return `${key}  runs ${runs.length} (${measured.length} measured)  signal ${signal}/${batteries}  first-8 mean ${fixed(mean)}  reached ${reached.length}, median ${fixed(median(reached))} h`;
  });
}

function scoreboard(args: CommandArgs): void {
  const since = args.value("since") ?? "";
  const match = args.value("match") ?? "";
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
  if (args.flag("json")) {
    console.log(JSON.stringify(scores, null, 2));
    return;
  }
  for (const s of scores) {
    console.log(
      `${s.openedAt.slice(0, 16)}  ${s.runId}  ${s.builder}  ${s.source}  batteries ${s.batteries}  signal ${s.signalFirst8} of first 8 (${s.signal} in all)  full ${s.fullPasses}  swing ${fixed(s.swing)}  first signal ${fixed(s.hoursToSignal)} h  fails held ${s.fails.held}, against ${s.fails.against}, unsettled ${s.fails.unsettled}`,
    );
  }
  const batteries = scores.reduce((sum, s) => sum + s.batteries, 0);
  const signal = scores.reduce((sum, s) => sum + s.signal, 0);
  console.log(`\nby source and Builder\n${groupRows(scores).join("\n")}`);
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

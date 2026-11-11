#!/usr/bin/env bun
/**
 * The campaigns on record as rows: when each reached its first comparison and its first promotion,
 * and what each promotion took in elapsed, active and unloaded hours and in dollars. It starts no
 * solve, calls no model and writes nothing.
 *
 * `--runs <dir>` reads the campaigns under one folder (an archive such as `data/runs`, one host's
 * folder of it, or a folder of worktrees) instead of every campaign the registry reaches across the
 * hosts, so it needs no env file and runs under the lane guard, which refuses one: on 9 November a
 * lane-19 session could not set a run's starter against the previous release's for that reason. A
 * campaign two folders below `<dir>` is placed on the host its first folder names.
 *
 * The default view is `recent`: every run still going, whatever it has promoted, then the latest
 * `--last` (20) finished runs that got at least one promotion. A finished run that never promoted
 * says nothing about how long a promotion takes, so it leaves this view (`--rows runs` lists it).
 * Each row gives the time to the first promotion, which is set-up, the promotions the run reached,
 * and the hours and dollars a rung after set-up, kept apart because set-up takes longer than a
 * rung and one number for both would be skewed by it; the all-in hours a promotion stand beside them.
 *
 * `--rows cost` sets each run's recorded dollars beside its turns repriced on today's meter, a
 * promotion and a confirmed promotion, since the meter moved and only the repriced dollars compare
 * across it; `trend.ts` pools them by window.
 *
 * A row is one campaign as `.claude/skills/main/runs.ts` folds it from its log and receipts; that
 * module's head comment says what places a run and what the hours, the room on validity and a
 * confirmed promotion are. `--has` and `--holds` keep the runs whose every launch ran with a
 * mechanism (`ranWith`). A run's own counts are those of `trend.ts`'s measures, and setting groups
 * of runs against each other is that script's: until 11 November this one also pooled runs by
 * release, pack and setting, a second comparison of groups with no test of the spread between runs.
 *
 * Written on 29 October, when the operator asked for one place to compare the runs of one cycle
 * with those of the last and no reader assembled them across campaigns.
 *
 * It prints counts, short digests and campaign names, and never a task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { formatOf, MISSING, money, printed } from "#skills/main/print.ts";
import { loadRuns, type Run, rungsOf } from "#skills/main/runs.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { mean } from "#src/meta/tally.ts";
import { MEASURES, valued } from "./trend.ts";

const SINCE = "2026-10-01";
const LAST = 20;
const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts
    [--since <date>] [--name <part of a campaign>]... [--rows recent|runs|promotions|cost] [--last <n>]
    [--has <text>]... [--holds <commit>]... [--format md|tsv] [--runs <dir>]

--since   campaigns whose last event is at or after this date; ${SINCE} by default
--name    these campaigns only, matched by part of the name (repeatable)
--rows    recent (default): live runs and the latest finished runs that promoted; runs: one row a
          run; promotions: one row a promotion; cost: one row a run, its dollars repriced on one meter
--last    how many finished runs recent lists, ${String(LAST)} by default
--has     only runs whose every launch ran with code that holds this text (repeatable)
--holds   only runs whose every launch holds this commit (repeatable)
--format  md (default) or tsv
--runs    the campaigns under this folder only, read without the hosts' registry or an env file`;
const OPTIONS = {
  since: "text",
  name: "list",
  rows: "text",
  last: "int",
  has: "list",
  holds: "list",
  format: "text",
  runs: "abs",
} as const;
const ACTIVE = "active h";
const UNLOADED = "unloaded h";
const FIRST_PROMOTION = "1st promotion h";
/** The measures a run's row gives as its own counts. */
const COUNTED = [
  MEASURES.perComparison,
  MEASURES.confirmed,
  MEASURES.after,
  MEASURES.room,
  MEASURES.onValidity,
  MEASURES.aa,
];
const RUN_HEAD = [
  "run",
  "host",
  "release",
  "setting",
  "cores",
  "load/core",
  "solve s",
  "elapsed h",
  ACTIVE,
  UNLOADED,
  "1st compared h",
  "1st reported h",
  "promotions",
  FIRST_PROMOTION,
  "$",
  ...COUNTED.map(({ name }) => name),
  "ending",
];
const RECENT_HEAD = [
  "run",
  "state",
  "release",
  "setting",
  "host",
  "elapsed h",
  `${FIRST_PROMOTION} (set-up)`,
  "promotions",
  "h a rung",
  `${ACTIVE} a rung`,
  `${UNLOADED} a rung`,
  "$ a rung",
  "h a promotion, set-up included",
];
const COST_HEAD = [
  "run",
  "launched",
  "setting",
  "state",
  "promotions",
  "confirmed",
  "recorded $",
  "repriced $",
  "repriced/recorded",
  "recorded $ a promotion",
  "repriced $ a promotion",
  "repriced $ a confirmed promotion",
];
const PROMOTION_HEAD = [
  "run",
  "promotion",
  "elapsed h",
  ACTIVE,
  "epoch h",
  `epoch ${ACTIVE}`,
  `epoch ${UNLOADED}`,
  "epoch $",
  "comparisons",
  "won-lost-tied",
];
/** The words that keep a reader from comparing what is not comparable. */
const CAVEAT = [
  "A rung is a promotion after set-up (the first promotion), which takes longer and is read apart; a live run is listed whatever it has promoted.",
  "Hours are on the log's own clock; active hours subtract every recorded wait (provider, network, load).",
  "Unloaded hours also take out the share of each stretch an overloaded host could not serve (1 - cores/load), as if the run were CPU-bound: an upper bound on what load cost, an estimate.",
  "One run is one draw, and the spread between runs is wide: trend.ts sets groups of runs against it, and results are never compared across settings.",
];
/** What `--rows cost` adds to the caveat. */
const REPRICED =
  "Repriced: every recorded turn at today's list prices through today's seat meter, the one measure every run shares; it leaves out a backend's excess over its turns (compactions, retries), which only runs from #563 on record, so repriced/recorded just under 1 on a newer run is that excess.";

const tenths = (value: number | null | undefined): string =>
  value === null || value === undefined ? MISSING : value.toFixed(1);

const runRows = (runs: readonly Run[]) =>
  runs.map((run) => [
    run.name,
    run.host,
    run.release,
    run.setting,
    run.cores === null ? MISSING : String(run.cores),
    run.load === null ? MISSING : run.load.toFixed(2),
    tenths(run.solveSeconds),
    tenths(run.elapsed),
    tenths(run.active),
    tenths(run.unloaded),
    tenths(run.firstCompared),
    tenths(run.firstReported),
    String(run.promotions.length),
    tenths(run.promotions[0]?.elapsed),
    money(run.dollars),
    ...COUNTED.map((measure) => measure.counts([run])),
    run.live ? "live" : run.ending,
  ]);

const recentRows = (runs: readonly Run[]) =>
  runs.map((run) => {
    const rungs = rungsOf(run);
    const final = run.promotions.at(-1);
    return [
      run.name,
      run.live ? "live" : run.ending,
      run.release,
      run.setting,
      run.host,
      tenths(run.elapsed),
      tenths(run.promotions[0]?.elapsed),
      String(run.promotions.length),
      tenths(mean(rungs.map((rung) => rung.epochElapsed))),
      tenths(mean(rungs.map((rung) => rung.epochActive))),
      tenths(mean(rungs.map((rung) => rung.epochUnloaded))),
      money(mean(rungs.map((rung) => rung.dollars))),
      tenths(final === undefined ? null : final.elapsed / final.nth),
    ];
  });

/** The medians of the finished runs a recent view lists, so a live run is read against them. */
function recentSummary(runs: readonly Run[]): string {
  const past = runs.filter((run) => !run.live);
  const medians = [MEASURES.firstPromotion, MEASURES.rung, MEASURES.rungDollars].map(
    (measure) => `${measure.name} ${valued(measure, past)}`,
  );
  return `Finished runs listed ${String(past.length)}, by their medians: ${medians.join(", ")}. Live runs: ${String(runs.length - past.length)}.`;
}

const promotionRows = (runs: readonly Run[]) =>
  runs.flatMap((run) =>
    run.promotions.map((promotion) => [
      run.name,
      promotion.nth === 1 ? "1 (set-up)" : String(promotion.nth),
      tenths(promotion.elapsed),
      tenths(promotion.active),
      tenths(promotion.epochElapsed),
      tenths(promotion.epochActive),
      tenths(promotion.epochUnloaded),
      money(promotion.dollars),
      String(promotion.comparisons),
      promotion.tally,
    ]),
  );

/** Dollars over a count, or none where nothing was priced or counted. */
const per = (dollars: number | null, count: number) =>
  money(dollars === null || count === 0 ? null : dollars / count);

const costRows = (runs: readonly Run[]) =>
  runs.map((run) => [
    run.name,
    new Date(run.launched).toISOString().slice(0, 10),
    run.setting,
    run.live ? "live" : run.ending,
    String(run.promotions.length),
    String(run.confirmed),
    money(run.dollars),
    run.repriced === null ? `? (${run.unpriced ?? ""})` : money(run.repriced),
    run.repriced === null || run.dollars === 0 ? MISSING : (run.repriced / run.dollars).toFixed(2),
    per(run.dollars, run.promotions.length),
    per(run.repriced, run.promotions.length),
    per(run.repriced, run.confirmed),
  ]);

async function main(args: CommandArgs): Promise<number> {
  const format = formatOf(args);
  const [has, holds] = [args.list("has"), args.list("holds")];
  const since = args.value("since") ?? SINCE;
  const { runs, skipped } = await loadRuns({
    home: args.value("runs"),
    since,
    names: args.list("name"),
    has,
    holds,
    repo: runtimeProcess.cwd(),
  });
  // Every live run, then the latest finished runs that promoted, newest first.
  const newest = (list: readonly Run[]) => list.toSorted((a, b) => b.last - a.last);
  const listed = [
    ...newest(runs.filter((run) => run.live)),
    ...newest(runs.filter((run) => !run.live && run.promotions.length > 0)).slice(
      0,
      args.int("last") ?? LAST,
    ),
  ];
  const tables = new Map([
    ["recent", () => printed(RECENT_HEAD, recentRows(listed), format)],
    ["runs", () => printed(RUN_HEAD, runRows(runs), format)],
    ["promotions", () => printed(PROMOTION_HEAD, promotionRows(runs), format)],
    ["cost", () => printed(COST_HEAD, costRows(runs), format)],
  ]);
  const rows = args.value("rows") ?? "recent";
  const table = tables.get(rows);
  if (table === undefined) return args.die(`--rows takes ${[...tables.keys()].join(", ")}; got ${rows}`);
  console.log(table());
  if (format === "tsv") return 0;
  if (rows === "recent") console.log(`\n${recentSummary(listed)}`);
  const only = has.length + holds.length > 0 ? `, only runs with ${[...has, ...holds].join(", ")}` : "";
  const promotions = runs.reduce((sum, run) => sum + run.promotions.length, 0);
  console.log(`\n${String(runs.length)} campaigns, ${String(promotions)} promotions, since ${since}${only}.`);
  console.log([...CAVEAT, ...(rows === "cost" ? [REPRICED] : [])].join("\n"));
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "table", usage: USAGE, options: OPTIONS }, main);

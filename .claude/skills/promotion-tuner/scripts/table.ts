#!/usr/bin/env bun
/**
 * One table over every campaign on record: when each reached its first comparison and its first
 * promotion, what each promotion took in elapsed, active and unloaded hours and in dollars, and how the
 * runs of one release, pack and setting compare with those of another. It starts no solve, calls no
 * model and writes nothing.
 *
 *   bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts
 *     [--since <date>] [--name <part of a campaign>]... [--rows recent|groups|runs|promotions]
 *     [--last <n>] [--by release,pack,setting,host,none] [--has <text>]... [--holds <commit>]...
 *     [--format md|tsv] [--runs <dir>]
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
 * A row is one campaign as `.claude/skills/main/runs.ts` folds it from its log and receipts; that
 * module's head comment says what the hours, the room on validity and a confirmed promotion are,
 * and the table is as old as the logs the registry reads, the peers' included (`campaignLogs`).
 *
 * What a group is. Runs are compared by what they ran on, never by the number of the pull request
 * that stacked their code: a stack's numbers mean nothing from one cycle to the next. A run's
 * **release** is the release tag before its first launch, `after v0.7.4` being the cycle that built
 * the next release (a campaign with no receipt is placed by its first event). Its **pack** is read
 * from its name by `packOf` (`tools/runs/registry.ts`), and its **setting** is the solver,
 * its effort and the solve limits of `campaign.setting`. Results are never compared across settings
 * (AGENTS.md section 9), so the default groups by all three; `--by release` pools them and says how
 * many settings it pooled. `--has` and `--holds` keep the runs whose every launch ran with a
 * mechanism (`ranWith`), which is how a change is read against the runs without it.
 *
 * A group is compared at equal elapsed time: "by 12 h" counts the runs promoted within 12 hours of
 * those that either did or lasted that long, so a run still young is not counted as a miss. A
 * rate stands with its denominator: the promotions over the comparisons one could come from, the
 * promotions the starter confirmed over those a starter comparison has read, and the reference's
 * won and lost tasks among those written after its promotion. `trend.ts` reads the same rows by the
 * week a run opened and says which differences exceed the spread between runs.
 *
 * Written on 29 October, when the operator asked for one place to compare the runs of one cycle
 * with those of the last and no reader assembled them across campaigns.
 *
 * It prints counts, short digests and campaign names, and never a task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { formatOf, MISSING, money, printed } from "#skills/main/print.ts";
import { loadRuns, promotedBy, type Run, rungsOf } from "#skills/main/runs.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { median } from "#src/meta/tally.ts";

const SINCE = "2026-10-01";
const LAST = 20;
const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts
    [--since <date>] [--name <part of a campaign>]... [--rows recent|groups|runs|promotions]
    [--last <n>] [--by release,pack,setting,host,none] [--has <text>]... [--holds <commit>]...
    [--format md|tsv] [--runs <dir>]

--since   campaigns whose last event is at or after this date; ${SINCE} by default
--name    these campaigns only, matched by part of the name (repeatable)
--rows    recent (default): live runs and the latest finished runs that promoted; groups: runs
          pooled by --by; runs: one row a run; promotions: one row a promotion
--last    how many finished runs recent lists, ${String(LAST)} by default
--by      what a group shares, as a comma list; release,pack,setting by default
--has     only runs whose every launch ran with code that holds this text (repeatable)
--holds   only runs whose every launch holds this commit (repeatable)
--format  md (default) or tsv
--runs    the campaigns under this folder only, read without the hosts' registry or an env file`;
const OPTIONS = {
  since: "text",
  name: "list",
  rows: "text",
  last: "int",
  by: "text",
  has: "list",
  holds: "list",
  format: "text",
  runs: "abs",
} as const;
const BY = ["release", "pack", "setting", "host", "none"] as const;
const ROWS = ["recent", "groups", "runs", "promotions"] as const;
/** The elapsed hours a group is compared at. */
const MARKS = [6, 12, 24] as const;
const ACTIVE = "active h";
const UNLOADED = "unloaded h";
const FIRST_PROMOTION = "1st promotion h";
const AA = "A/A steps/capable";
const ROOM = "room on validity";
const ON_VALIDITY = "steps won by validity";
const CONFIRMED = "confirmed/read by the starter";
const PER_COMPARISON = "promotions/comparisons";
const AFTER = "written after won-lost";
const GROUP_HEAD = [
  "group",
  "runs",
  "promoted",
  "promotions",
  "1st reported h",
  FIRST_PROMOTION,
  ACTIVE,
  ...MARKS.map((mark) => `by ${String(mark)} h`),
  "h a rung",
  `${ACTIVE} a rung`,
  `${UNLOADED} a rung`,
  "$ a rung",
  ROOM,
  ON_VALIDITY,
  PER_COMPARISON,
  CONFIRMED,
  AFTER,
  AA,
  "settings",
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
  PER_COMPARISON,
  CONFIRMED,
  AFTER,
  "$",
  ROOM,
  ON_VALIDITY,
  AA,
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
  "A group is comparable only where its settings column reads 1: results are never compared across settings.",
  "One run is one draw, and the spread between runs is wide: read a group's medians beside its run count.",
];

type By = (typeof BY)[number];
type Rows = (typeof ROWS)[number];

const tenths = (value: number | null | undefined): string =>
  value === null || value === undefined ? MISSING : value.toFixed(1);
const present = (values: readonly (number | null | undefined)[]) =>
  values.filter((value) => value !== null && value !== undefined);
const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const sumOf = (
  runs: readonly Run[],
  key: "scored" | "room" | "stepped" | "onValidity" | "confirmed" | "reads" | "compared",
) => runs.reduce((sum, run) => sum + run[key], 0);
/** The room on validity of a list of runs, as tasks and a share of the scored ones. */
function roomOf(runs: readonly Run[]): string {
  const [room, scored] = [sumOf(runs, "room"), sumOf(runs, "scored")];
  return scored === 0
    ? MISSING
    : `${String(room)}/${String(scored)} (${String(Math.round((100 * room) / scored))}%)`;
}
const onValidityOf = (runs: readonly Run[]) =>
  `${String(sumOf(runs, "onValidity"))}/${String(sumOf(runs, "stepped"))}`;

const perComparisonOf = (runs: readonly Run[]) =>
  `${String(runs.reduce((sum, run) => sum + run.promotions.length, 0))}/${String(sumOf(runs, "compared"))}`;
const confirmedOf = (runs: readonly Run[]) =>
  `${String(sumOf(runs, "confirmed"))}/${String(sumOf(runs, "reads"))}`;
const afterOf = (runs: readonly Run[]) =>
  `${String(runs.reduce((sum, run) => sum + run.after.wins, 0))}-${String(runs.reduce((sum, run) => sum + run.after.losses, 0))}`;
const aaOf = (runs: readonly Run[]) =>
  `${String(runs.reduce((sum, run) => sum + run.aaSteps, 0))}/${String(runs.reduce((sum, run) => sum + run.controls, 0))}`;

/** The rows of a table by group, in the order each group first launched: counts, and medians over
 *  its runs and its rungs. */
function groupRows(runs: readonly Run[], by: readonly By[]): string[][] {
  const pooled = by.length === 0 || by.includes("none");
  const groups = Map.groupBy(runs, (run) =>
    pooled ? "all" : by.map((key) => (key === "none" ? "" : run[key])).join(" | "),
  );
  return [...groups].map(([key, list]) => {
    const rungs = list.flatMap(rungsOf);
    const settings = new Set(list.map((run) => run.setting)).size;
    return [
      key,
      String(list.length),
      String(list.filter((run) => run.promotions.length > 0).length),
      String(list.reduce((sum, run) => sum + run.promotions.length, 0)),
      tenths(median(present(list.map((run) => run.firstReported)))),
      tenths(median(present(list.map((run) => run.promotions[0]?.elapsed)))),
      tenths(median(present(list.map((run) => run.promotions[0]?.active)))),
      // The share promoted by each mark, of the runs that either were or lasted that long.
      ...MARKS.map((mark) => {
        const { promoted, known } = promotedBy(list, mark);
        return known === 0 ? MISSING : `${String(promoted)}/${String(known)}`;
      }),
      tenths(median(rungs.map((rung) => rung.epochElapsed))),
      tenths(median(rungs.map((rung) => rung.epochActive))),
      tenths(median(rungs.map((rung) => rung.epochUnloaded))),
      money(median(rungs.map((rung) => rung.dollars))),
      roomOf(list),
      onValidityOf(list),
      perComparisonOf(list),
      confirmedOf(list),
      afterOf(list),
      aaOf(list),
      settings === 1 ? "1" : `${String(settings)} POOLED`,
    ];
  });
}

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
    perComparisonOf([run]),
    confirmedOf([run]),
    afterOf([run]),
    money(run.dollars),
    roomOf([run]),
    onValidityOf([run]),
    aaOf([run]),
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
  const rungs = past.flatMap(rungsOf);
  const middle = (values: readonly number[]) => tenths(median(values));
  return `Finished runs listed ${String(past.length)}: median first promotion ${middle(present(past.map((run) => run.promotions[0]?.elapsed)))} h, median promotions ${middle(past.map((run) => run.promotions.length))}, median ${middle(rungs.map((rung) => rung.epochElapsed))} h and $${middle(rungs.map((rung) => rung.dollars))} a rung (${String(rungs.length)} rungs). Live runs: ${String(runs.length - past.length)}.`;
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

/** The words of a comma list, each one of `allowed`, in the order `allowed` gives them. */
function parsed<T extends string>(
  args: CommandArgs,
  name: string,
  allowed: readonly T[],
  fallback: string,
): T[] {
  const words = (args.value(name) ?? fallback).split(",").filter((word) => word !== "");
  const bad = words.find((word) => !allowed.some((each) => each === word));
  return bad === undefined
    ? allowed.filter((each) => words.includes(each))
    : args.die(`--${name} takes ${allowed.join(", ")}; got ${bad}`);
}

async function main(args: CommandArgs): Promise<number> {
  const [rows = "recent"] = parsed<Rows>(args, "rows", ROWS, "recent");
  const by = parsed<By>(args, "by", BY, "release,pack,setting");
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
  const table = {
    recent: () => printed(RECENT_HEAD, recentRows(listed), format),
    groups: () => printed(GROUP_HEAD, groupRows(runs, by), format),
    runs: () => printed(RUN_HEAD, runRows(runs), format),
    promotions: () => printed(PROMOTION_HEAD, promotionRows(runs), format),
  }[rows];
  console.log(table());
  if (format === "tsv") return 0;
  if (rows === "recent") console.log(`\n${recentSummary(listed)}`);
  const only = has.length + holds.length > 0 ? `, only runs with ${[...has, ...holds].join(", ")}` : "";
  const promotions = runs.reduce((sum, run) => sum + run.promotions.length, 0);
  console.log(`\n${String(runs.length)} campaigns, ${String(promotions)} promotions, since ${since}${only}.`);
  console.log(CAVEAT.join("\n"));
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "table", usage: USAGE, options: OPTIONS }, main);

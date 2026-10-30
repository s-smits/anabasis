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
 *     [--format md|tsv]
 *
 * The default view is `recent`: every run still going, whatever it has promoted, then the latest
 * `--last` (20) finished runs that got at least one promotion. A finished run that never promoted
 * says nothing about how long a promotion takes, so it leaves this view (`--rows runs` lists it).
 * Each row gives the time to the first promotion, which is set-up, the promotions the run reached,
 * and the hours and dollars a rung after set-up, kept apart because set-up takes longer than a
 * rung and one number for both would be skewed by it; the all-in hours a promotion stand beside them.
 *
 * Every number is a fold over the campaign's log and its launch receipts (AGENTS.md section 5: no
 * second store), so a run is in the table from its first event and the table is as old as the logs
 * the registry reads, the peers' included (`campaignLogs`). The folds are the production ones:
 * `comparisonsOf` for the reading a promotion rests on, `epochsOf` for each epoch's comparisons and
 * the campaign's A/A comparisons, `billedBetween` for the dollars, and `waitsOf`
 * (`tools/wri/time.ts`) for the waits.
 *
 * What a group is. Runs are compared by what they ran on, never by the number of the pull request
 * that stacked their code: a stack's numbers mean nothing from one cycle to the next. A run's
 * **release** is the release tag before its first launch, `after v0.7.4` being the cycle that built
 * the next release (a campaign with no receipt is placed by its first event). Its **pack** is the
 * first word of its name, which `runs fresh` sets to the pack's, and its **setting** is the solver,
 * its effort and the solve limits of `campaign.setting`. Results are never compared across settings
 * (AGENTS.md section 9), so the default groups by all three; `--by release` pools them and says how
 * many settings it pooled. `--has` and `--holds` keep the runs whose every launch ran with a
 * mechanism (`ranWith`), which is how a change is read against the runs without it.
 *
 * What the hours are. All times are on the log's own clock (`at`), which is the same on macOS and
 * Linux. **Elapsed** hours run from the log's first event. **Active** hours subtract the union of
 * every recorded wait (a provider's reset, a network wait and a solve-queue wait for load), so a run
 * that sat out a limit on one host is not slower than the same run on another. The host, its cores,
 * the median one-minute load per core at a solve's start and the median solve in seconds stand
 * beside them as indicators of the machine. **Unloaded** hours take out of the active hours what
 * an overloaded host cost (`overloadOf`): each stretch after a recorded load counts the share of the
 * demand its cores could not serve, `1 - cores / load`. That treats the run as CPU-bound, while much
 * of a solve waits on the provider, so it bounds the load's cost from above and is an estimate
 * (operator, 30 October, when one host stood at a load of 91 on 12 cores). No hour is scaled by
 * the chip or the operating system, since one factor for two of each would be an invented number. A group is compared at equal
 * elapsed time: "by 12 h" counts the runs promoted within 12 hours of those that either did or lasted
 * that long, so a run still young is not counted as a miss.
 *
 * The first promotion over the Starter is set-up (epoch 0), as the closing report counts it
 * (`epochLine`); `promotions` counts it, and the climb is one fewer.
 *
 * Written on 29 October, when the operator asked for one place to compare the runs of one cycle
 * with those of the last and no reader assembled them across campaigns.
 *
 * It prints counts, short digests and campaign names, and never a task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { comparisonsOf } from "#src/campaign/ground.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { billedBetween } from "#src/kernel/trace.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { ranWith, receipts } from "#tools/runs/receipt.ts";
import { overloadOf, waitedMs, waitsOf } from "#tools/wri/time.ts";
import { campaignLogs, type Found, rehearsed } from "./tree.ts";

const SINCE = "2026-10-01";
const LAST = 20;
const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/table.ts
    [--since <date>] [--name <part of a campaign>]... [--rows recent|groups|runs|promotions]
    [--last <n>] [--by release,pack,setting,host,none] [--has <text>]... [--holds <commit>]...
    [--format md|tsv]

--since   campaigns whose last event is at or after this date; ${SINCE} by default
--name    these campaigns only, matched by part of the name (repeatable)
--rows    recent (default): live runs and the latest finished runs that promoted; groups: runs
          pooled by --by; runs: one row a run; promotions: one row a promotion
--last    how many finished runs recent lists, ${String(LAST)} by default
--by      what a group shares, as a comma list; release,pack,setting by default
--has     only runs whose every launch ran with code that holds this text (repeatable)
--holds   only runs whose every launch holds this commit (repeatable)
--format  md (default) or tsv`;
const OPTIONS = {
  since: "text",
  name: "list",
  rows: "text",
  last: "int",
  by: "text",
  has: "list",
  holds: "list",
  format: "text",
} as const;
const HOUR_MS = 3_600_000;
const BY = ["release", "pack", "setting", "host", "none"] as const;
const ROWS = ["recent", "groups", "runs", "promotions"] as const;
/** A run whose log has been quiet for longer than this, or whose last event is an ending, is not
 *  live. A run sitting out a provider's reset longer than this reads as finished with no ending. */
const LIVE_MS = 2 * HOUR_MS;
/** The elapsed hours a group is compared at. */
const MARKS = [6, 12, 24] as const;
const MISSING = "-";
const ACTIVE = "active h";
const UNLOADED = "unloaded h";
const FIRST_PROMOTION = "1st promotion h";
const AA = "A/A steps/capable";
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
  "$",
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

/** One promotion of a run, with the epoch it ended. */
interface Promotion {
  readonly nth: number;
  /** Elapsed and active hours from the log's first event to the promotion. */
  readonly elapsed: number;
  readonly active: number;
  /** The epoch's own elapsed and active hours and dollars: from the opening or the promotion
   *  before, to this one. */
  readonly epochElapsed: number;
  readonly epochActive: number;
  /** The epoch's active hours less what an overloaded host cost (`overloadOf`), an estimate. */
  readonly epochUnloaded: number;
  readonly dollars: number;
  /** The comparisons reported in the epoch. A Builder's sessions are left out: a conversation that
   *  leads its campaign spans epochs and ends in the last. */
  readonly comparisons: number;
  /** The promoting comparison's tally of tasks won, lost and tied, and its p. */
  readonly tally: string;
}

/** One campaign, folded from its log and receipts. */
interface Run {
  readonly name: string;
  readonly host: string;
  readonly release: string;
  readonly pack: string;
  readonly setting: string;
  readonly cores: number | null;
  /** The median one-minute load per core at a solve's start, and the median solve in seconds. */
  readonly load: number | null;
  readonly solveSeconds: number | null;
  /** The time of its first launch, else its first event, and of its log's last event. */
  readonly launched: number;
  readonly last: number;
  readonly elapsed: number;
  readonly active: number;
  readonly unloaded: number;
  /** Whether the log is still being written: its last event is no ending and is recent. */
  readonly live: boolean;
  /** Hours from the first event to the first comparison started and reported. */
  readonly firstCompared: number | null;
  readonly firstReported: number | null;
  readonly promotions: readonly Promotion[];
  readonly dollars: number;
  /** The A/A comparisons able to read a step, and those that did (`falsePromotion`). */
  readonly controls: number;
  readonly aaSteps: number;
  readonly ending: string;
}

const hours = (ms: number) => ms / HOUR_MS;
const tenths = (value: number | null | undefined) =>
  value === null || value === undefined ? MISSING : value.toFixed(1);
const money = (value: number | null) => (value === null ? MISSING : value.toFixed(0));
const numeral = (value: JsonValue | undefined) => (isNumber(value) ? String(value) : "?");
const present = (values: readonly (number | null | undefined)[]) =>
  values.filter((value) => value !== null && value !== undefined);
const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
/** The promotions after set-up, the rungs of the climb. */
const rungsOf = (run: Run) => run.promotions.slice(1);

/** The release tags with their dates, oldest first. */
function releasesOf(repo: string): { name: string; at: number }[] {
  const lines = gitMaybe(
    repo,
    "for-each-ref",
    "--sort=creatordate",
    "--format=%(creatordate:iso-strict) %(refname:short)",
    "refs/tags/v*",
  );
  return (lines ?? "").split("\n").flatMap((line) => {
    const [date = "", name = ""] = line.split(" ");
    return /^v\d/u.test(name) ? [{ name, at: Date.parse(date) }] : [];
  });
}

/** What a run's solver was set to: its model, effort, solve minutes and model turns. */
function settingOf(events: readonly LogEvent[]): string {
  const data = events.find(({ kind }) => kind === "campaign.setting")?.data;
  const solver = asRecord(data?.solver);
  if (data === undefined || solver === null) return "no setting";
  const model = isString(solver.model) ? solver.model.replace(/^claude\//u, "") : "?";
  return `${model}/${isString(solver.effort) ? solver.effort : "?"} ${numeral(data.minutes)}m ${numeral(data.modelTurns)}t`;
}

/** The time of a campaign's solves: the median in seconds, and the median one-minute load per core
 *  at their start. */
function machineOf(events: readonly LogEvent[]) {
  const seconds = events.flatMap(({ kind, data }) =>
    kind === "solve.finished" && isNumber(data.seconds) ? [data.seconds] : [],
  );
  const loads = events.flatMap(({ kind, data }) => {
    const first = Array.isArray(data.load) ? data.load[0] : undefined;
    return kind === "solve.started" && isNumber(first) && isNumber(data.cores) && data.cores > 0
      ? [first / data.cores]
      : [];
  });
  return { solveSeconds: median(seconds), load: median(loads) };
}

/** The tally and p of the comparison a promotion rests on: the last reading of the promoted harness
 *  against the reference it replaced that read `step`, else its last reading of any kind. */
function tallyOf(events: readonly LogEvent[], index: number): string {
  const { harness, from } = events[index]?.data ?? {};
  const readings = comparisonsOf(events.slice(0, index)).filter(
    ({ fresh, old, report }) => report !== null && fresh === harness && (from === undefined || old === from),
  );
  const scored = asRecord(
    (readings.findLast(({ report }) => report?.reading === "step") ?? readings.at(-1))?.report?.scored,
  );
  if (scored === null) return MISSING;
  const p = isNumber(scored.p) ? ` p ${scored.p.toFixed(4)}` : "";
  return `${numeral(scored.wins)}-${numeral(scored.losses)}-${numeral(scored.ties)}${p}`;
}

/** One campaign as a row, or null for a rehearsal. */
function runOf(
  found: Found,
  events: readonly LogEvent[],
  tags: readonly { name: string; at: number }[],
): Run | null {
  if (rehearsed(events)) return null;
  const stamps = events.map(({ at }) => Date.parse(at));
  const [first = 0, last = 0] = [stamps[0], stamps.at(-1)];
  const launch = receipts(found.path)[0];
  const launched = launch === undefined ? first : Date.parse(launch.at);
  const tag = tags.findLast(({ at }) => at <= launched);
  const waits = waitsOf(events);
  const overload = overloadOf(events);
  // Hours between two moments less the waits inside them, and less what an overloaded host cost.
  const activeAt = (to: number, from = first) => hours(to - from - waitedMs(waits, from, to));
  const unloadedAt = (to: number, from = first) => activeAt(to, from) - hours(overload(from, to));
  const indexes = events.flatMap(({ kind }, at) => (kind === "harness.promoted" ? [at] : []));
  const epochs = epochsOf(events);
  const promotions = indexes.map((at, nth): Promotion => {
    const start = indexes[nth - 1] ?? 0;
    const [before = first, now = first] = [stamps[start], stamps[at]];
    return {
      nth: nth + 1,
      elapsed: hours(now - first),
      active: activeAt(now),
      epochElapsed: hours(now - before),
      epochActive: activeAt(now, before),
      epochUnloaded: unloadedAt(now, before),
      dollars: billedBetween(events, start, at + 1),
      comparisons: epochs[nth]?.comparisons.length ?? 0,
      tally: tallyOf(events, at),
    };
  });
  const firstOf = (kind: string) => {
    const at = stamps[events.findIndex((event) => event.kind === kind)];
    return at === undefined ? null : hours(at - first);
  };
  const ended = events.findLast(({ kind }) => kind === "campaign.ended")?.data.ending;
  // `falsePromotion` reads the A/A comparisons of the whole campaign on every epoch.
  const noise = epochs[0]?.falsePromotion;
  return {
    name: found.name,
    host: /\/data\/runs\/([^/]+)\//u.exec(found.path)?.[1] ?? "here",
    release: tag === undefined ? `before ${tags[0]?.name ?? "the first release"}` : `after ${tag.name}`,
    pack: found.name.split("-")[0] ?? found.name,
    setting: settingOf(events),
    cores: launch?.cores ?? null,
    ...machineOf(events),
    launched,
    last,
    elapsed: hours(last - first),
    active: activeAt(last),
    unloaded: unloadedAt(last),
    live: events.at(-1)?.kind !== "campaign.ended" && Date.now() - last < LIVE_MS,
    firstCompared: firstOf("comparison.started"),
    firstReported: firstOf("comparison.reported"),
    promotions,
    dollars: billedBetween(events, 0),
    controls: noise?.controls ?? 0,
    aaSteps: noise?.errors ?? 0,
    ending: isString(ended) ? ended : "no ending",
  };
}

/** The share of a group promoted by `mark` elapsed hours, over the runs that either were or lasted
 *  that long, so a run still young counts for neither side. */
function promotedBy(runs: readonly Run[], mark: number): string {
  const by = (run: Run) => (run.promotions[0]?.elapsed ?? Infinity) <= mark;
  const known = runs.filter((run) => run.elapsed >= mark || by(run));
  return known.length === 0 ? MISSING : `${String(known.filter(by).length)}/${String(known.length)}`;
}

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
      ...MARKS.map((mark) => promotedBy(list, mark)),
      tenths(median(rungs.map((rung) => rung.epochElapsed))),
      tenths(median(rungs.map((rung) => rung.epochActive))),
      tenths(median(rungs.map((rung) => rung.epochUnloaded))),
      money(median(rungs.map((rung) => rung.dollars))),
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
    money(run.dollars),
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

/** A table as GitHub markdown, or tab-separated lines for a spreadsheet. */
function printed(head: readonly string[], rows: readonly (readonly string[])[], tsv: boolean): string {
  if (tsv) return [head, ...rows].map((row) => row.join("\t")).join("\n");
  const line = (row: readonly string[]) => `| ${row.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

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
  const format = args.value("format") ?? "md";
  if (format !== "md" && format !== "tsv") return args.die(`--format takes md or tsv; got ${format}`);
  const repo = runtimeProcess.cwd();
  const [has, holds, names] = [args.list("has"), args.list("holds"), args.list("name")];
  const since = args.value("since") ?? SINCE;
  const tags = releasesOf(repo);
  const skipped: string[] = [];
  const runs: Run[] = [];
  for (const found of await campaignLogs(null, [], since)) {
    if (names.length > 0 && !names.some((part) => found.name.includes(part))) continue;
    if (has.length + holds.length > 0 && !ranWith(found.path, repo, { has, holds })) continue;
    try {
      const run = runOf(found, read(found.path), tags);
      if (run !== null) runs.push(run);
    } catch (error) {
      skipped.push(`${found.name}: ${errorMessage(error)}`);
    }
  }
  runs.sort((a, b) => a.launched - b.launched);
  // Every live run, then the latest finished runs that promoted, newest first.
  const newest = (list: readonly Run[]) => list.toSorted((a, b) => b.last - a.last);
  const listed = [
    ...newest(runs.filter((run) => run.live)),
    ...newest(runs.filter((run) => !run.live && run.promotions.length > 0)).slice(
      0,
      args.int("last") ?? LAST,
    ),
  ];
  const tsv = format === "tsv";
  const table = {
    recent: () => printed(RECENT_HEAD, recentRows(listed), tsv),
    groups: () => printed(GROUP_HEAD, groupRows(runs, by), tsv),
    runs: () => printed(RUN_HEAD, runRows(runs), tsv),
    promotions: () => printed(PROMOTION_HEAD, promotionRows(runs), tsv),
  }[rows];
  console.log(table());
  if (tsv) return 0;
  if (rows === "recent") console.log(`\n${recentSummary(listed)}`);
  const only = has.length + holds.length > 0 ? `, only runs with ${[...has, ...holds].join(", ")}` : "";
  const promotions = runs.reduce((sum, run) => sum + run.promotions.length, 0);
  console.log(`\n${String(runs.length)} campaigns, ${String(promotions)} promotions, since ${since}${only}.`);
  console.log(CAVEAT.join("\n"));
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "table", usage: USAGE, options: OPTIONS }, main);

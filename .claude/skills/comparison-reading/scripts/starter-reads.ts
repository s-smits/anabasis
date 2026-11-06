#!/usr/bin/env bun
/**
 * Split each promotion's starter read by what its tasks had been through, from the reference's side.
 *
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name>
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>]
 *
 * A promotion is confirmed by one tally over three kinds of task: those of the comparison that chose
 * the harness, which it is read on again; those written before the promotion and not drawn then; and
 * those written after it. Only the last two can say anything about tasks that did not choose it, and
 * the tally does not tell them apart. The middle group is no neutral one: on 6 November all 19 of its
 * tasks on record had been scored in a step that chose an earlier promotion. A read also has the
 * reference on the old side, where the promoting comparison had it on the new, and on 5 November a
 * table printed with no sides was read backwards by two reviews. So each read names its sides, and
 * each origin gives its whole tally, its tasks on which validity differed, and the rest. `epochsOf`
 * gave up a split of this tally on 3 November since it decided no move; this decides none either, and
 * is read beside the climb.
 * A count over the gathered record alone misses campaigns not yet retired: on 6 November it held 13
 * reads where this holds 15.
 *
 * The tally `epochsOf` stored and read is printed as it is. The split is scored under this tree's
 * rule (`differenceOf`), so on an older log the two can differ. `--all` counts copies of one
 * comparison once, by its harnesses and tasks. Output holds session ids, harness letters and counts,
 * and nothing of a task.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { campaignLogs, rehearsed } from "#skills/promotion-tuner/scripts/tree.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { calledBy, namesOf } from "#src/campaign/names.ts";
import { differenceOf, type Paired, pointsOf, readsStep, type Tally, testOf } from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported, type Reported } from "#src/kernel/reports.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | campaign name>
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>]

--all    every campaign log the registry reads on every configured host, rehearsals left out
--since  with --all, only logs whose last event is at or after this date`;
const OPTIONS = { all: "flag", since: "text" } as const;
const ORIGINS = ["read at the promotion", "written before, not chosen on", "written after"] as const;
type Origin = (typeof ORIGINS)[number];

/** An origin's tasks: the whole tally, those on which validity differed, and the rest. */
interface Split {
  readonly whole: Tally;
  readonly validity: Tally;
  readonly rest: Tally;
}

/** One promotion's first starter comparison that tallied a task. */
interface StarterRead {
  readonly session: string;
  /** The harnesses, by digest: the reference is the old side, the starter the new. */
  readonly reference: string;
  readonly starter: string;
  /** The tally and confirmation `epochsOf` read, on the stored scores without the bill. */
  readonly stored: Tally;
  readonly confirmed: boolean;
  readonly level: number;
  readonly origins: Readonly<Record<Origin, Split>>;
  /** Whether the tasks that did not choose the harness read a step alone, under this tree's rule. */
  readonly outside: boolean;
  /** The harnesses and tasks, which a copy of the comparison shares. */
  readonly key: string;
}

/** The tally from the reference's side of `pairs`, which holds it on the old side. */
const tallyOf = (pairs: readonly Paired[]): Tally => {
  const { wins, losses, ties } = testOf(pairs.map((pair) => -differenceOf(pair)));
  return { wins, losses, ties };
};

/** The tasks the comparisons that promoted `reference` read, before the promotion at `from`. */
function chosenOn(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  reference: string,
  from: number,
) {
  const chose = reports.filter(
    ({ index, data }) => index < from && data.fresh === reference && data.reading === "step",
  );
  return new Set(chose.flatMap((report) => pairsReported(events, report).map(({ task }) => task)));
}

/** Each starter read of `events`, oldest first. */
export function starterReads(events: readonly LogEvent[]): StarterRead[] {
  const reports = lastReports(events);
  const epochs = epochsOf(events);
  return epochs.flatMap((epoch, nth) => {
    const report = reports.find(({ session }) => session === epoch.starter_read);
    const fresh = report?.data.fresh;
    if (report === undefined || epoch.starter_tally === null || !isString(fresh)) return [];
    const { level } = report.data;
    const chosen = chosenOn(events, reports, epoch.reference, epoch.from);
    const earlier = new Set(epochs.slice(0, nth).flatMap(({ tasks }) => tasks));
    const pairs = pairsReported(events, report);
    const originOf = ({ task }: Paired): Origin =>
      chosen.has(task) ? ORIGINS[0] : earlier.has(task) ? ORIGINS[1] : ORIGINS[2];
    const splitOf = (origin: Origin): Split => {
      const own = pairs.filter((pair) => originOf(pair) === origin);
      return {
        whole: tallyOf(own),
        validity: tallyOf(own.filter((pair) => pointsOf(pair).validity !== 0)),
        rest: tallyOf(own.filter((pair) => pointsOf(pair).validity === 0)),
      };
    };
    const at = isNumber(level) ? level : 0;
    return [
      {
        session: report.session,
        reference: epoch.reference,
        starter: fresh,
        stored: epoch.starter_tally,
        confirmed: epoch.confirmed === true,
        level: at,
        origins: {
          [ORIGINS[0]]: splitOf(ORIGINS[0]),
          [ORIGINS[1]]: splitOf(ORIGINS[1]),
          [ORIGINS[2]]: splitOf(ORIGINS[2]),
        },
        outside: readsStep(
          pairs.filter(({ task }) => !chosen.has(task)).map((pair) => -differenceOf(pair)),
          at,
        ),
        key: `${epoch.reference}|${fresh}|${pairs
          .map(({ task }) => task)
          .toSorted()
          .join(",")}`,
      },
    ];
  });
}

const wlt = ({ wins, losses, ties }: Tally) => `${String(wins)}-${String(losses)}-${String(ties)}`;

/** An origin's line: its whole tally, then those on which validity differed, then the rest. */
function originLine(origin: Origin, { whole, validity, rest }: Split): string {
  return `  ${origin}: ${wlt(whole)}; validity differed ${wlt(validity)}; validity tied ${wlt(rest)}`;
}

/** One read's lines, each harness `called` by its letter. */
function readLines(each: StarterRead, called: (digest: string) => string): string[] {
  return [
    `${each.session}: reference ${called(each.reference)} on the old side, starter ${called(each.starter)} on the new; tallies are the reference's wins, losses and ties`,
    `  stored ${wlt(each.stored)}, ${each.confirmed ? "a step, confirmed" : "no step"} at ${String(each.level)}; without the tasks that chose it, ${each.outside ? "a step" : "no step"}`,
    ...ORIGINS.map((origin) => originLine(origin, each.origins[origin])),
  ];
}

/** The totals over `reads`. */
function totalLines(reads: readonly StarterRead[]): string[] {
  const of = (origin: Origin, part: keyof Split): Tally => {
    const tallies = reads.map(({ origins }) => origins[origin][part]);
    return {
      wins: tallies.reduce((total, { wins }) => total + wins, 0),
      losses: tallies.reduce((total, { losses }) => total + losses, 0),
      ties: tallies.reduce((total, { ties }) => total + ties, 0),
    };
  };
  return [
    `${String(reads.length)} starter reads, ${String(reads.filter(({ confirmed }) => confirmed).length)} confirmed, ${String(reads.filter(({ outside }) => outside).length)} a step without the tasks that chose the harness`,
    ...ORIGINS.map((origin) =>
      originLine(origin, {
        whole: of(origin, "whole"),
        validity: of(origin, "validity"),
        rest: of(origin, "rest"),
      }),
    ),
  ];
}

/** Every read on record, one a comparison however many copies of it are kept. */
async function allLines(since: string): Promise<string[]> {
  const kept = new Map<string, StarterRead>();
  const lines: string[] = [];
  for (const { name, path } of await campaignLogs(null, [], since)) {
    const events = read(path);
    if (rehearsed(events)) continue;
    const called = calledBy(namesOf(events));
    for (const each of starterReads(events)) {
      if (kept.has(each.key)) continue;
      kept.set(each.key, each);
      lines.push(name, ...readLines(each, called));
    }
  }
  return [...lines, ...totalLines([...kept.values()])];
}

if (import.meta.main) {
  await runCommand(
    { name: "starter-reads", usage: USAGE, options: OPTIONS, positionals: [0, 1] },
    async (args: CommandArgs) => {
      const named = args.positionals[0];
      if (args.flag("all") === (named !== undefined)) args.die("name one campaign, or pass --all");
      if (named === undefined) {
        console.log((await allLines(args.value("since") ?? "")).join("\n"));
        return;
      }
      const events = read(await logAcross(named));
      const reads = starterReads(events);
      if (reads.length === 0 && !events.some(({ kind }) => kind === "harness.promoted")) {
        throw new CommandFailure("no promotion in this log, so no starter read");
      }
      const called = calledBy(namesOf(events));
      console.log([...reads.flatMap((each) => readLines(each, called)), ...totalLines(reads)].join("\n"));
    },
  );
}

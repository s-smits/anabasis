#!/usr/bin/env bun
/**
 * Split each promotion's starter read by what its tasks had been through, from the reference's side.
 *
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name> [--tasks]
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts --log <log> [--log <log> ...] [--tasks]
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>] [--name <part>] [--tasks]
 *
 * A promotion is confirmed by one tally over three kinds of task: those of the comparison that chose
 * the harness, which it is read on again; those written before the promotion and not drawn then; and
 * those written after it. Only the last two can say anything about tasks that did not choose it, and
 * the tally does not tell them apart. The middle group is no neutral one: on 6 November all 19 of its
 * tasks on record had been scored in a step that chose an earlier promotion. So each read also says
 * what the tasks written after read alone, the one origin no step selected. A read also has the
 * reference on the old side, where the promoting comparison had it on the new, and on 5 November a
 * table printed with no sides was read backwards by two reviews. So each read names its sides, and
 * each origin gives its whole tally, its tasks on which validity differed, and the rest. `epochsOf`
 * gave up a split of this tally on 3 November since it decided no move; this decides none either, and
 * is read beside the climb.
 * A count over the gathered record alone misses campaigns not yet retired: on 6 November it held 13
 * reads where this holds 15.
 * An origin can hold several writing sessions: on 6 November one read's 10-6-0 on the tasks read at
 * its promotion held one writer's 1-5-0, which stood nearer the 0-6-0 on the tasks written after it
 * than the rest of its own group. So each read also gives one line a writer.
 *
 * Each read also gives what lanes 30 and 31 counted by hand between 3 and 10 November (all 4 lane 30
 * sessions and all 5 of lane 31's): the summed margin of each origin and its share of the read's;
 * how many of the sign draws of the untied tasks written after, every other task as scored, read a
 * step (`stepCount`, `tools/wri/selection.ts`); and the tasks written after, slice by writing
 * session, each by majority and alone, with no test across the slices. The sums over reads
 * give the confirmations those draws expect beside those read, and where the slices went. `--tasks`
 * gives one row a task of each read (lanes 28, 19 and 22): its origin, writer, each solve's ending on
 * both sides, the reference's score against the starter and each side's ratio to the author's best.
 * A row's task is the 8-character prefix `tools/wri/pairs.ts` prints, and its writer the proposal's
 * session (`proposalsOf`), as `tools/wri/aim.ts` names it. Use this for a task's origin and ratios to
 * best, and `pairs.ts` for its A/A, flips, repeats, tie kind and the tasks set aside: there `diff` is
 * the starter's score over the reference's, the opposite sign of the margin here.
 *
 * The tally `epochsOf` stored and read is printed as it is. The split is scored under this tree's
 * rule (`differenceOf`), so on an older log the two can differ. `--all` counts copies of one
 * comparison once, by its harnesses and tasks. Output holds session ids, harness letters and counts;
 * with `--tasks` it also holds task versions and ratios read from hidden values, so it stays exam-side.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { sideGap } from "#skills/comparison-reading/scripts/gap.ts";
import { campaignLogs, rehearsed } from "#skills/main/logs.ts";
import {
  ORIGINS,
  type Origin,
  type Split,
  type StarterRead,
  starterReads,
  UNSELECTED,
  unselectedOf,
} from "#src/campaign/climb.ts";
import { calledBy, namesOf } from "#src/campaign/names.ts";
import { type Tally, testOf } from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { poolOf } from "#src/kernel/reports.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { wlt } from "#tools/wri/folds.ts";
import { type StepCount, stepCount } from "#tools/wri/selection.ts";

/** What a read is made of: its after-slices and its sign draws, null where the level is not recorded. */
interface Composition {
  readonly slices: readonly { writer: string; tally: Tally; alone: string }[];
  readonly draws: StepCount | null;
}

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | campaign name> [--tasks]
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts --log <log> [--log <log> ...] [--tasks]
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>] [--name <part>] [--tasks]

--log    a campaign's log, folder or name; several give each one's reads, then the sums over them
--all    every campaign log the registry reads on every configured host, rehearsals left out, each
         campaign's reads and sums, then the sums over them all
--since  with --all, only logs whose last event is at or after this date
--name   with --all, only campaigns whose name holds this text, such as a pack
--tasks  one row a task of each read as well`;
const OPTIONS = { all: "flag", since: "text", name: "text", log: "list", tasks: "flag" } as const;
const LEGEND = [
  "Tallies are the reference's wins, losses and ties against the starter, and margins its task scores against the starter's, in points (thousandths).",
  "Sign draws hold every task not written after the promotion as scored and give each untied task written after either sign; each counts as the read's own test would read it (the paired sign-flip test, at the level the report records).",
  "A slice is the tasks one Examiner session wrote that a read scored as written after. It went to a side by majority where that side won more of its untied tasks, and by step where it alone reads a step for that side at the read's level.",
];
const SHORT: Readonly<Record<Origin, string>> = {
  [ORIGINS[0]]: "chosen",
  [ORIGINS[1]]: "before",
  [ORIGINS[2]]: "after",
};
/** A task version as the task rows print it, enough to find it again. */
const TASK_CHARS = 8;
const signedPoints = (points: number) => `${points > 0 ? "+" : ""}${String(Math.round(points))}`;

function compositionOf(each: StarterRead): Composition {
  const after = each.rows.filter(({ origin }) => origin === ORIGINS[2]);
  const writers = [...new Set(after.map(({ writer }) => writer))];
  const slices = writers.map((writer) => {
    const margins = after.filter((row) => row.writer === writer).map(({ margin }) => margin);
    const { wins, losses, ties } = testOf(margins);
    return { writer, tally: { wins, losses, ties }, alone: unselectedOf(margins, each.level) };
  });
  const fixed = each.rows.filter(({ origin }) => origin !== ORIGINS[2]).map(({ margin }) => margin);
  const draws = each.levelled
    ? stepCount(
        fixed,
        after.map(({ margin }) => margin),
        each.level,
      )
    : null;
  return { slices, draws };
}

/** An origin's line: its whole tally, then those on which validity differed, then the rest. */
function originLine(origin: Origin, { whole, validity, rest }: Split): string {
  return `  ${origin}: ${wlt(whole)}; validity differed ${wlt(validity)}; validity tied ${wlt(rest)}`;
}

/** Each origin's summed margin, net and absolute, and its share of the read's absolute margin. */
function marginLine(each: StarterRead): string {
  const all = each.rows.reduce((sum, { margin }) => sum + Math.abs(margin), 0);
  const parts = ORIGINS.map((origin) => {
    const own = each.rows.filter((row) => row.origin === origin).map(({ margin }) => margin);
    const net = own.reduce((sum, one) => sum + one, 0);
    const absolute = own.reduce((sum, one) => sum + Math.abs(one), 0);
    const share = all === 0 ? "" : `, ${String(Math.round((100 * absolute) / all))}%`;
    return `${SHORT[origin]} net ${signedPoints(net)} abs ${String(Math.round(absolute))}${share}`;
  });
  return `  margin by origin (share of the read's absolute ${String(Math.round(all))}): ${parts.join("; ")}`;
}

/** The sign draws' line, telling a read with no task written after from one whose all tied. */
function drawLine(each: StarterRead, { draws }: Composition): string {
  if (draws === null) return "  the report records no level, so no sign draw is counted";
  const after = each.rows.filter(({ origin }) => origin === ORIGINS[2]).length;
  const others = draws.confirm > 0n ? "confirm" : "do not confirm";
  if (after === 0) return `  no task written after was scored; the other tasks alone ${others}`;
  if (draws.free === 0) {
    return `  all ${String(after)} tasks written after tied, so no sign draw; the other tasks alone ${others}`;
  }
  const fixed = each.rows.filter(({ origin }) => origin !== ORIGINS[2]).map(({ margin }) => margin);
  const tied = stepCount(fixed, [], each.level).confirm > 0n ? "confirm" : "do not confirm";
  return `  sign draws of the ${String(draws.free)} untied tasks written after: ${String(draws.confirm)} of ${String(draws.draws)} confirm at ${String(each.level)}; with every one tied, the other tasks alone ${tied}`;
}

/** The read's after-slices, each by majority and alone. No test across them: whether the slices are
 *  independent draws is lane 31's question (`tools/wri/selection.ts`). */
function sliceLines({ slices }: Composition): string[] {
  return slices.map(
    ({ writer, tally, alone }) =>
      `  written after, by ${writer}: ${wlt(tally)}; by majority ${majorityOf(tally)}; alone ${alone}`,
  );
}

function majorityOf({ wins, losses }: Tally): string {
  return wins > losses ? "the reference" : losses > wins ? "the starter" : "neither";
}

/** One read's lines, each harness `called` by its letter. */
function readLines(each: StarterRead, called: (digest: string) => string): string[] {
  const composition = compositionOf(each);
  return [
    `${each.session}: reference ${called(each.reference)} on the old side, starter ${called(each.starter)} on the new; tallies are the reference's wins, losses and ties`,
    `  stored ${wlt(each.stored)}, ${each.confirmed ? "a step, confirmed" : "no step"} at ${each.levelled ? String(each.level) : "a level not recorded"}; on the tasks written after alone, ${each.after}`,
    ...ORIGINS.map((origin) => originLine(origin, each.origins[origin])),
    ...each.authors.map(({ session, tally }) => `  written by ${session}: ${wlt(tally)}`),
    marginLine(each),
    drawLine(each, composition),
    ...sliceLines(composition),
  ];
}

/** Each solve's ending as the log records it, by solve id: its kind, or its outcome. */
function endingsOf(events: readonly LogEvent[]): Map<string, string> {
  return new Map(
    solvesIn(events).map(({ id, ending }) => {
      const kind = ending?.kind ?? ending?.outcome;
      return [id, isString(kind) ? kind : "not recorded"];
    }),
  );
}

/** One row a task of `each`: origin, writer, each side's endings, the margin, each side's ratio. */
function taskLines(
  each: StarterRead,
  endings: ReadonlyMap<string, string>,
  bests: ReadonlyMap<string, number>,
): string[] {
  const side = (ids: readonly string[] | undefined, valid: readonly boolean[]) =>
    ids === undefined
      ? "not recorded"
      : ids
          .map((id, at) => {
            const ending = endings.get(id) ?? "not recorded";
            return ending === "pass" && valid[at] === false ? "pass settled wrong" : ending;
          })
          .join(",");
  const ratio = (pair: StarterRead["rows"][number]["pair"], of: "old" | "fresh") => {
    if (pair.objective === undefined) return "-";
    const found = sideGap([pair], of, bests).ratio;
    return found === null ? "-" : found.toFixed(2);
  };
  return [
    `  ${each.session} by task: task, origin, writer, reference solves, starter solves, reference against starter, reference/best, starter/best`,
    ...each.rows.map(({ task, origin, writer, margin, pair }) =>
      [
        `   ${task.slice(0, TASK_CHARS)}`,
        SHORT[origin],
        writer,
        side(pair.solves?.old, pair.old),
        side(pair.solves?.fresh, pair.fresh),
        signedPoints(margin),
        ratio(pair, "old"),
        ratio(pair, "fresh"),
      ].join("  "),
    ),
  ];
}

/** The totals over `reads`, naming the `campaigns` they come from where they span several logs. */
function totalLines(reads: readonly StarterRead[], campaigns?: number): string[] {
  const of = (origin: Origin, part: keyof Split): Tally => {
    const tallies = reads.map(({ origins }) => origins[origin][part]);
    return {
      wins: tallies.reduce((total, { wins }) => total + wins, 0),
      losses: tallies.reduce((total, { losses }) => total + losses, 0),
      ties: tallies.reduce((total, { ties }) => total + ties, 0),
    };
  };
  const compositions = reads.map(compositionOf);
  const counted = compositions.flatMap(({ draws }) => (draws === null ? [] : [draws]));
  const expected = counted.reduce((sum, { confirm, draws }) => sum + Number(confirm) / Number(draws), 0);
  const slices = compositions.flatMap(({ slices: own }) => own);
  const majority = (side: string) => slices.filter(({ tally }) => majorityOf(tally) === side).length;
  const alone = (reading: string) => slices.filter((slice) => slice.alone === reading).length;
  const over = campaigns === undefined ? "" : ` in ${plural(campaigns, "campaign")}`;
  return [
    `${plural(reads.length, "starter read")}${over}, ${String(reads.filter(({ confirmed }) => confirmed).length)} confirmed; on the tasks written after alone, ${UNSELECTED.map((one) => `${one} ${String(reads.filter(({ after }) => after === one).length)}`).join(", ")}`,
    ...ORIGINS.map((origin) =>
      originLine(origin, {
        whole: of(origin, "whole"),
        validity: of(origin, "validity"),
        rest: of(origin, "rest"),
      }),
    ),
    `  sign draws: over the ${plural(counted.length, "read")} with a recorded level, the share of draws that confirm sums to ${expected.toFixed(2)}, against ${String(reads.filter(({ confirmed, levelled }) => confirmed && levelled).length)} of them confirmed`,
    `  ${plural(slices.length, "slice")} written after: by majority to the reference ${String(majority("the reference"))}, to the starter ${String(majority("the starter"))}, to neither ${String(majority("neither"))}; alone ${UNSELECTED.map((one) => `${one} ${String(alone(one))}`).join(", ")}`,
  ];
}

/** Each campaign's reads and sums, `tasks` with their rows, then the sums over all of them, one read a
 *  comparison however many copies of it are kept. */
function acrossLines(
  logs: readonly { name: string; events: readonly LogEvent[] }[],
  tasks: boolean,
): string[] {
  const kept = new Map<string, StarterRead>();
  const campaigns = new Set<string>();
  const lines: string[] = [];
  for (const { name, events } of logs) {
    const own = starterReads(events).filter(({ key }) => !kept.has(key));
    for (const each of own) kept.set(each.key, each);
    if (own.length === 0) continue;
    campaigns.add(name);
    lines.push(name, ...campaignLines(events, own, tasks));
  }
  return [...lines, "all of them", ...totalLines([...kept.values()], campaigns.size)];
}

/** `reads` of one log, each with its task rows where `tasks` asks, then their sums. */
function campaignLines(events: readonly LogEvent[], reads: readonly StarterRead[], tasks: boolean): string[] {
  const called = calledBy(namesOf(events));
  const endings = tasks ? endingsOf(events) : new Map<string, string>();
  const bests = tasks ? poolOf(events).bests : new Map<string, number>();
  return [
    ...reads.flatMap((each) => [
      ...readLines(each, called),
      ...(tasks ? taskLines(each, endings, bests) : []),
    ]),
    ...totalLines(reads),
  ];
}

/** Every campaign on record whose name holds `part`, rehearsals left out. */
async function registryLogs(since: string, part: string) {
  const logs = [];
  for (const { name, path } of await campaignLogs(null, [], since)) {
    if (!name.includes(part)) continue;
    const events = read(path);
    if (!rehearsed(events)) logs.push({ name, events });
  }
  return logs;
}

if (import.meta.main) {
  await runCommand(
    { name: "starter-reads", usage: USAGE, options: OPTIONS, positionals: [0, 1] },
    async (args: CommandArgs) => {
      const named = [...args.positionals, ...args.list("log")];
      const tasks = args.flag("tasks");
      if (args.flag("all") === named.length > 0) args.die("name one campaign or more, or pass --all");
      if (named.length !== 1) {
        const logs = args.flag("all")
          ? await registryLogs(args.value("since") ?? "", args.value("name") ?? "")
          : await Promise.all(
              named.map(async (one) => {
                const path = await logAcross(one);
                return { name: basename(dirname(path)), events: read(path) };
              }),
            );
        console.log([...LEGEND, ...acrossLines(logs, tasks)].join("\n"));
        return;
      }
      const events = read(await logAcross(named[0] ?? ""));
      const reads = starterReads(events);
      if (reads.length === 0 && !events.some(({ kind }) => kind === "harness.promoted")) {
        console.log("no promotion in this log, so no starter read");
        return;
      }
      console.log([...LEGEND, ...campaignLines(events, reads, tasks)].join("\n"));
    },
  );
}

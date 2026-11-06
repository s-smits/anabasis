#!/usr/bin/env bun
/**
 * Split each promotion's starter read by what its tasks had been through, from the reference's side.
 *
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | name>
 *   bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>] [--name <part>]
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
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { campaignLogs, rehearsed } from "#skills/promotion-tuner/scripts/tree.ts";
import { ORIGINS, type Origin, type Split, type StarterRead, starterReads } from "#src/campaign/climb.ts";
import { calledBy, namesOf } from "#src/campaign/names.ts";
import type { Tally } from "#src/kernel/compare.ts";
import { read } from "#src/kernel/log.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log.jsonl | campaign folder | campaign name>
  bun .claude/skills/comparison-reading/scripts/starter-reads.ts --all [--since <date>] [--name <part>]

--all    every campaign log the registry reads on every configured host, rehearsals left out, each
         campaign's reads and sums, then the sums over them all
--since  with --all, only logs whose last event is at or after this date
--name   with --all, only campaigns whose name holds this text, such as a pack`;
const OPTIONS = { all: "flag", since: "text", name: "text" } as const;
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

/** Every read on record whose campaign's name holds `part`, one a comparison however many copies of
 *  it are kept, with each campaign's sums and then those of all. */
async function allLines(since: string, part: string): Promise<string[]> {
  const kept = new Map<string, StarterRead>();
  const lines: string[] = [];
  for (const { name, path } of await campaignLogs(null, [], since)) {
    if (!name.includes(part)) continue;
    const events = read(path);
    if (rehearsed(events)) continue;
    const called = calledBy(namesOf(events));
    const own = starterReads(events).filter(({ key }) => !kept.has(key));
    for (const each of own) kept.set(each.key, each);
    if (own.length > 0) {
      lines.push(name, ...own.flatMap((each) => readLines(each, called)), ...totalLines(own));
    }
  }
  return [...lines, "all of them", ...totalLines([...kept.values()])];
}

if (import.meta.main) {
  await runCommand(
    { name: "starter-reads", usage: USAGE, options: OPTIONS, positionals: [0, 1] },
    async (args: CommandArgs) => {
      const named = args.positionals[0];
      if (args.flag("all") === (named !== undefined)) args.die("name one campaign, or pass --all");
      if (named === undefined) {
        console.log((await allLines(args.value("since") ?? "", args.value("name") ?? "")).join("\n"));
        return;
      }
      const events = read(await logAcross(named));
      const reads = starterReads(events);
      if (reads.length === 0 && !events.some(({ kind }) => kind === "harness.promoted")) {
        console.log("no promotion in this log, so no starter read");
        return;
      }
      const called = calledBy(namesOf(events));
      console.log([...reads.flatMap((each) => readLines(each, called)), ...totalLines(reads)].join("\n"));
    },
  );
}

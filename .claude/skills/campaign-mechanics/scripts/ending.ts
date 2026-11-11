#!/usr/bin/env bun
/**
 * Explain recorded campaign endings and show the current stopping conditions.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | path/to/log.jsonl> [--at <line | ISO time>]
 *
 * `--at` reads the log up to that line, or up to the last event at or before that time, as the table
 * would have read it then under this tree's code: one lane-21 session of 9 November copied ten
 * prefixes of a log by hand to ask this. `tools/wri/table-timeline.ts` asks it at every change point.
 *
 * The existing run view lists the climb and next move, but omits ending history and counts against
 * stopping thresholds. This script lists campaign.ended events with the preceding campaign.move
 * counts. It then shows the current budget,
 * improvement and supply patience, consecutive crashes, idle conversations, admission refusals,
 * pending operator instructions and next move.
 *
 * Each condition comes from its production reader under planOn, the same plan used by the run view.
 * Current counts describe a restart from the log, rather than the state at each historical ending.
 * logEvents ignores an incomplete final append. Names resolve locally or in the archive; absolute
 * paths can also read archived copies no longer listed on their source host. --host runs remotely.
 * Output contains ids, codes, counts and host reasons, but no tasks or checks; it remains exam-side.
 *
 * Written on 30 October: the archive then held 158 logs whose endings had no reader.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { refusals, stopRule, supplyOf } from "#src/campaign/admission.ts";
import { CRASHES, decide, supplyRun } from "#src/campaign/decide.ts";
import { askedOf, crashedRun } from "#src/campaign/ground.ts";
import { decidedLine } from "#src/campaign/move.ts";
import { pendingWords } from "#src/campaign/word.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { isAbsolute, resolve } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { IDLE, idleOf, MOVED } from "#tools/d2/campaign-terms.ts";
import { logEvents, readNamed } from "#tools/runs/registry.ts";
import { planOn } from "#tools/runs/view.ts";

type Ending = ReturnType<typeof campaignEnding>;

const USAGE = `usage: ending.ts <name | path/to/log.jsonl> [--at <line | ISO time>]

Each ending on record with the moves before it, and the counts the table's endings are read on.
--at  read the log up to this line (1 is the first), or up to the last event at or before this time`;

/** The `campaign.move` events of `events`: how many, and each `move·code` counted (`countBy`) in the
 *  order it first appears. A Builder's own move reads `led`, and `asked` in a log before 5 November. */
function movesOf(events: readonly LogEvent[]) {
  const moves = events.flatMap(({ kind, data }) => (kind === MOVED ? [data] : []));
  const counts = countBy(
    moves,
    ({ move, code }) => `${isString(move) ? move : "?"}·${isString(code) ? code : "?"}`,
  );
  return { total: moves.length, counts };
}

/** The counts the table's endings are read on now, each beside its bound, and the move the table
 *  names under the same plan as the view (`planOn`, `decide`). */
function standingOf(events: readonly LogEvent[]) {
  const plan = planOn(events);
  const stop = stopRule(events);
  const crashes = crashedRun(events);
  return {
    left: plan.left,
    patience: { since: stop.sinceStep, of: plan.patience, counted: stop.checkpoints, spent: stop.stop },
    supply: { count: supplyRun(events, plan), of: plan.patience },
    crashes: { count: crashes.count, of: CRASHES, last: crashes.crash },
    idle: { count: idleOf(events), of: IDLE },
    refused: refusals(supplyOf(events), askedOf(plan)).map(({ code }) => code),
    words: pendingWords(events).map(({ word, why }) => (why === "" ? word : `${word} (${why})`)),
    decided: decide(events, plan),
  };
}

/** A campaign's endings, each with the moves since the one before; what came after the last; and
 *  how the table reads the log now. */
export function campaignEnding(events: readonly LogEvent[]) {
  const ends = events.flatMap((event, at) => (event.kind === "campaign.ended" ? [{ at, event }] : []));
  const endings = ends.map(({ at, event: { data, at: when } }, index) => ({
    ending: isString(data.ending) ? data.ending : "unnamed",
    at: when,
    why: isString(data.why) ? data.why : "no reason recorded",
    moves: movesOf(events.slice((ends[index - 1]?.at ?? -1) + 1, at)),
  }));
  const after = events.slice((ends.at(-1)?.at ?? -1) + 1);
  return {
    events: events.length,
    endings,
    since: { events: after.length, moves: movesOf(after), last: after.at(-1) ?? null },
    standing: standingOf(events),
  };
}

function movesLine({ total, counts }: ReturnType<typeof movesOf>): string {
  if (total === 0) return "no move";
  const listed = Object.entries(counts)
    .map(([key, count]) => `${key} ${String(count)}`)
    .join(", ");
  return `${plural(total, "move")} (${listed})`;
}

/** The standing counts, a line each. */
function standingLines({
  left,
  patience,
  supply,
  crashes,
  idle,
  refused,
  words,
}: Ending["standing"]): string[] {
  return [
    left === null
      ? "budget: the opening names no total"
      : `budget: $${left.dollars.toFixed(2)} left, a solve held at $${String(left.reserve)}${left.dollars < left.reserve ? " (spent)" : ""}`,
    `improvement patience: ${String(patience.since)} of ${String(patience.of)} since the last step, ${plural(patience.counted, "counted move")} in all${patience.spent ? " (spent)" : ""}`,
    `supply patience: ${String(supply.count)} of ${String(supply.of)} readings in a row left nothing to gain`,
    `crashed sessions in a row: ${String(crashes.count)} of ${String(crashes.of)}${crashes.last === null ? "" : `, the last: ${crashes.last}`}`,
    `idle conversations in a row: ${String(idle.count)} of ${String(idle.of)}`,
    `comparison admission would refuse: ${refused.length === 0 ? "nothing" : refused.join(", ")}`,
    `operator words not yet heard: ${words.length === 0 ? "none" : words.join("; ")}`,
  ];
}

/** The events the table reads `--at` a line (1 is the first) or a time: those up to it. */
export function eventsAt(events: readonly LogEvent[], at: string): readonly LogEvent[] {
  if (/^\d+$/.test(at)) return events.slice(0, Number(at));
  if (Number.isNaN(Date.parse(at))) throw new Error(`--at takes a line or an ISO time; got ${at}`);
  const after = events.findIndex((event) => Date.parse(event.at) > Date.parse(at));
  return after === -1 ? events : events.slice(0, after);
}

/** What is said of a campaign's endings and standing, a line each; `reads` says where the log is
 *  read to. */
export function endingLines({ events, endings, since, standing }: Ending, reads = "now"): string[] {
  const last = since.last;
  return [
    `${plural(events, "event")}, ${plural(endings.length, "ending")} on record`,
    ...endings.flatMap(({ ending, at, why, moves }) => [
      `ended ${ending} at ${at} after ${movesLine(moves)}`,
      `  why: ${why}`,
    ]),
    last === null
      ? "the log ends on that ending"
      : `since ${endings.length === 0 ? "the opening" : "the last ending"}: ${movesLine(since.moves)}, last event ${last.kind} at ${last.at}`,
    `as the table reads the log ${reads}:`,
    ...standingLines(standing).map((line) => `  ${line}`),
    `the table's move: ${decidedLine(standing.decided)}`,
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "ending", usage: USAGE, positionals: 1, options: { at: "text" } },
    (args: CommandArgs) => {
      const [given = ""] = args.positionals;
      // A path to a log as given, relative ones included; anything else is a campaign's name.
      const path = isAbsolute(given) || existsSync(given) ? resolve(given) : readNamed(given).path;
      const at = args.value("at");
      const all = logEvents(path);
      const events = at === null ? all : eventsAt(all, at);
      const reads =
        at === null
          ? "now"
          : `up to line ${String(events.length)} of ${String(all.length)} (${events.at(-1)?.at ?? "no event"}), under this tree's code`;
      console.log([path, ...endingLines(campaignEnding(events), reads)].join("\n"));
    },
  );
}

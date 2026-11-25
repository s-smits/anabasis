#!/usr/bin/env bun
/**
 * Explains recorded campaign endings and reports current stopping-condition counts.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | path/to/log.jsonl> [--at <line | ISO time>]
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { refusals, stopRule, supplyOf } from "#src/campaign/admission.ts";
import { CRASHES_IN_A_ROW, nextAction, supplyRun } from "#src/campaign/scheduler.ts";
import { askedOf, crashedRun } from "#src/campaign/state.ts";
import { decidedLine } from "#src/campaign/move.ts";
import { pendingSignals } from "#src/campaign/signal.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { isAbsolute, resolve } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { IDLE, idleOf, MOVED } from "#tools/campaign/campaign-terms.ts";
import { logEvents, readNamed } from "#tools/runs/registry.ts";
import { planOn } from "#tools/runs/view.ts";

type Ending = ReturnType<typeof campaignEnding>;

const USAGE = `usage: ending.ts <name | path/to/log.jsonl> [--at <line | ISO time>]

Each ending on record with the moves before it, and the counts the table's endings are read on.
--at  read the log up to this line (1 is the first), or up to the last event at or before this time`;

/** Tallies `campaign.move` events by `move·code` in order of first appearance. */
function movesOf(events: readonly LogEvent[]) {
  const moves = events.flatMap(({ kind, data }) => (kind === MOVED ? [data] : []));
  const counts = countBy(
    moves,
    ({ move, code }) => `${isString(move) ? move : "?"}·${isString(code) ? code : "?"}`,
  );
  return { total: moves.length, counts };
}

/** Every stopping-rule counter against its bound, and the table's next move (`planOn`, `decide`). */
function standingOf(events: readonly LogEvent[]) {
  const plan = planOn(events);
  const stop = stopRule(events);
  const crashes = crashedRun(events);
  return {
    left: plan.left,
    patience: { since: stop.sinceStep, of: plan.patience, counted: stop.checkpoints, spent: stop.stop },
    supply: { count: supplyRun(events, plan), of: plan.patience },
    crashes: { count: crashes.count, of: CRASHES_IN_A_ROW, last: crashes.crash },
    idle: { count: idleOf(events), of: IDLE },
    refused: refusals(supplyOf(events), askedOf(plan)).map(({ code }) => code),
    words: pendingSignals(events).map(({ word, why }) => (why === "" ? word : `${word} (${why})`)),
    decided: nextAction(events, plan),
  };
}

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

/** The events up to `--at` a line (1 is the first) or a time. */
export function eventsAt(events: readonly LogEvent[], at: string): readonly LogEvent[] {
  if (/^\d+$/.test(at)) return events.slice(0, Number(at));
  if (Number.isNaN(Date.parse(at))) throw new Error(`--at takes a line or an ISO time; got ${at}`);
  const after = events.findIndex((event) => Date.parse(event.at) > Date.parse(at));
  return after === -1 ? events : events.slice(0, after);
}

export function endingLines({ events, endings, since, standing }: Ending, reads = "now"): string[] {
  const last = since.last;
  return [
    `${plural(events, "event")}, ${plural(endings.length, "recorded ending")}`,
    ...endings.flatMap(({ ending, at, why, moves }) => [
      `ended ${ending} at ${at} after ${movesLine(moves)}`,
      `  why: ${why}`,
    ]),
    last === null
      ? "the log ends on that ending"
      : `since ${endings.length === 0 ? "the opening" : "the last ending"}: ${movesLine(since.moves)}, last event ${last.kind} at ${last.at}`,
    `as the table reads the log ${reads}:`,
    ...standingLines(standing).map((line) => `  ${line}`),
    `recommended next action: ${decidedLine(standing.decided)}`,
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

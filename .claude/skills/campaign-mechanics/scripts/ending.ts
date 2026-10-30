#!/usr/bin/env bun
/**
 * Why a campaign ended, or what it is waiting for: each ending on record with the moves that led to
 * it, and the counts the table's endings are decided on, each beside its bound.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/ending.ts <name | /abs/path/to/log.jsonl>
 *
 * `bun run runs view` prints the steps, the climb and the table's next move, and says nothing of
 * how a campaign ended: its diagnosis returns no line once the log's last event is
 * `campaign.ended`, it reads no count against its bound, and a remote host's archived copy that its
 * host no longer lists is refused. This reads one log, local or archived, by name or by path, and
 * prints for each run of the command its ending, its reason and the moves before it, as
 * `campaign.move` codes counted (`asked` where the Builder chose otherwise than the table), then
 * the counts as the table reads them now, each from its production owner under the plan the view
 * asks the table with (`planOn`, `tools/runs/view.ts`): the budget left (`planOf`'s `left`),
 * improvement patience (`stopRule`), supply patience (`supplyRun`, over `roomless`), the provider's
 * crashes in a row (`crashedRun`, `CRASHES`), idle conversations (`idleOf`, `IDLE`), comparison
 * admission's refusal codes (`refusals`), the operator's words not yet heard (`pendingWords`), and
 * the table's move (`decide`). The log is read as the view reads it (`logEvents`, which leaves out
 * a last line an append is still writing), and the endings and moves are the log's own
 * `campaign.ended` and `campaign.move` events, listed and counted (`countBy`) with no state derived.
 * It prints ids, codes, counts and the host's reasons, never a task or a check. `--host <name>`
 * runs it on another host (`runCommand`).
 * Written on 30 October, when the archive held 158 logs whose endings no reader listed.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { refusals, supplyOf } from "#src/campaign/admission.ts";
import { CRASHES, decide, supplyRun } from "#src/campaign/decide.ts";
import { crashedRun } from "#src/campaign/ground.ts";
import { decidedLine } from "#src/campaign/move.ts";
import { pendingWords } from "#src/campaign/word.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { isString } from "#src/meta/json-shape.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { IDLE, idleOf, MOVED } from "#tools/d2/campaign-terms.ts";
import { logEvents, readNamed } from "#tools/runs/registry.ts";
import { planOn } from "#tools/runs/view.ts";

type Ending = ReturnType<typeof campaignEnding>;

const USAGE = `usage: ending.ts <name | /abs/path/to/log.jsonl>

Each ending on record with the moves before it, and the counts the table's endings are read on.`;

/** The `campaign.move` events of `events`: how many, how many the Builder asked against the table,
 *  and each `move·code` counted (`countBy`) in the order it first appears. */
function movesOf(events: readonly LogEvent[]) {
  const moves = events.flatMap(({ kind, data }) => (kind === MOVED ? [data] : []));
  const counts = countBy(
    moves,
    ({ move, code }) => `${isString(move) ? move : "?"}·${isString(code) ? code : "?"}`,
  );
  return { total: moves.length, asked: moves.filter(({ code }) => code === "asked").length, counts };
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
    refused: refusals(supplyOf(events), plan.wanted).map(({ code }) => code),
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

function movesLine({ total, asked, counts }: ReturnType<typeof movesOf>): string {
  if (total === 0) return "no move";
  const listed = Object.entries(counts)
    .map(([key, count]) => `${key} ${String(count)}`)
    .join(", ");
  return `${plural(total, "move")} (${listed}${asked === 0 ? "" : `; ${String(asked)} asked against the table`})`;
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

/** What is said of a campaign's endings and standing, a line each. */
export function endingLines({ events, endings, since, standing }: Ending): string[] {
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
    "as the table reads the log now:",
    ...standingLines(standing).map((line) => `  ${line}`),
    `the table's move: ${decidedLine(standing.decided)}`,
  ];
}

if (import.meta.main) {
  await runCommand({ name: "ending", usage: USAGE, positionals: 1 }, (args: CommandArgs) => {
    const [given = ""] = args.positionals;
    const path = isAbsolute(given) ? given : readNamed(given).path;
    console.log([path, ...endingLines(campaignEnding(logEvents(path)))].join("\n"));
  });
}

import { formatComparisonHistory } from "#src/builder/past.ts";
import { comparisonFloor, stopRule } from "#src/campaign/admission.ts";
import { CRASHES_IN_A_ROW } from "#src/campaign/scheduler.ts";
import { comparisonsOf, crashedRun } from "#src/campaign/state.ts";
import { campaignOf } from "#src/campaign/summary.ts";
import type { Examined } from "#src/examiner/session.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { billedParts } from "#src/kernel/meter.ts";
import { patienceOf } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { heldAtGate, taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { plural } from "#src/meta/text.ts";
import { idleOf, MOVED, type Turn } from "./campaign-terms.ts";

const EXAMINED = new Map(
  Object.entries({
    stands: "ended whole",
    finished: "ended whole",
    supplied: "ended whole",
    crashed: "crashed",
    killed: "was stopped",
    stopped: "was stopped",
    wall: "ended at its limits",
    turns: "ended at its limits",
  } satisfies Record<Examined["ended"], string>),
);

function minutesFrom(from: string | undefined, to = new Date().toISOString()): string {
  const minutes =
    from === undefined ? 0 : Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return plural(minutes, "minute");
}

function examinedLines(events: readonly LogEvent[], writing: string | undefined, now?: string): string[] {
  const begun = events.findLast(
    ({ kind, data }) => kind === MOVED && data.move === "examine" && isString(data.session),
  )?.data.session;
  if (!isString(begun)) return [];
  const ended = events.findLast(({ kind, data }) => kind === "exam.finished" && data.session === begun)?.data;
  if (begun === writing || ended === undefined) {
    const started = events.findIndex(({ kind, data }) => kind === "exam.started" && data.session === begun);
    const admitted = events.filter(
      ({ kind, data }, index) => index > started && kind === "task.gate" && heldAtGate(data.outcome),
    );
    const held = plural(started === -1 ? 0 : admitted.length, "task");
    return [
      begun === writing
        ? `Examiner session ${begun} is writing beside this conversation, ${minutesFrom(events[started]?.at, now)}, and has had ${held} admitted so far.`
        : `Examiner session ${begun} stopped with the run of the campaign that began it, and had ${held} admitted.`,
    ];
  }
  const said = EXAMINED.get(isString(ended.ended) ? ended.ended : "") ?? "ended at its limits";
  return [
    `Examiner session ${begun} ${said}, and had ${plural(Array.isArray(ended.held) ? ended.held.length : 0, "task")} admitted.`,
  ];
}

function lastSolveAt(events: readonly LogEvent[], id: string, fallbackAt: number): number {
  const own = solvesIn(events).filter(({ start }) => start.comparison === id);
  return Math.max(fallbackAt, ...own.map(({ started, finished }) => finished ?? started));
}

function spentLines({ events }: Pick<Turn, "events">): string[] {
  const last = comparisonsOf(events).at(-1);
  const { sinceStep } = stopRule(events);
  const { count } = crashedRun(events);
  return [
    ...(last === undefined
      ? []
      : [
          `Comparison ${last.id} ${last.reported === null ? "has run" : "took"} ${minutesFrom(events[last.at]?.at, events[last.reported ?? lastSolveAt(events, last.id, last.at)]?.at)} and billed ${billedParts(events, last.id).comparison.toFixed(2)} dollars.`,
        ]),
    `Moves without a gain since the last step: ${String(sinceStep)} of the patience's ${String(patienceOf(events))}. A move here is a changed harness compared with room to gain, or a conversation that leaves harness/ unchanged after a practice solve of its own failed.`,
    ...(count === 0
      ? []
      : [
          `Sessions the provider failed in a row: ${String(count)} of the ${String(CRASHES_IN_A_ROW)} that end the campaign.`,
        ]),
  ];
}

function firstFacts({ practice, wanted }: Turn["plan"], held: number, released: number): string {
  const [size = ""] = sizeLines(Math.min(wanted.target, held), wanted.level);
  if (practice === null) return `${size}.`;
  const more =
    released > 0 && released < practice
      ? `, and another only while more than ${String(comparisonFloor(wanted.level))} tasks stay held out`
      : "";
  return `Released for practice: ${String(released)} of the ${plural(practice, "task")} the campaign names${more}. ${size}.`;
}

export function formatCampaignStatus(
  turn: Pick<Turn, "events" | "plan">,
  writing: string | undefined,
  now?: string,
): string {
  const sets = taskSets(turn.events);
  const tallies = formatComparisonHistory(campaignOf(turn.events).steps);
  const idle = idleOf(turn.events) - 1;
  return [
    `Campaign facts: ${plural(sets.held.length, "held-out task")}, ${plural(sets.released.length, "practice task")}.`,
    ...(turn.plan.left == null
      ? []
      : [
          `Campaign budget: ${turn.plan.left.dollars.toFixed(2)} dollars left; ${String(turn.plan.left.reserve)} reserved for a solve.`,
        ]),
    tallies.length === 0
      ? `No comparison has a tally yet. ${firstFacts(turn.plan, sets.held.length, sets.released.length)}`
      : `${plural(tallies.length, "comparison")} with a tally; the last:\n${tallies.at(-1) ?? ""}`,
    ...examinedLines(turn.events, writing, now),
    ...spentLines(turn),
    ...(idle < 1
      ? []
      : [
          idle === 1
            ? "The conversation before this one made no campaign move."
            : `The ${String(idle)} conversations before this one made no campaign move.`,
        ]),
  ].join("\n");
}

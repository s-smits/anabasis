/**
 * The solves, the turns and the calls the detail endpoints show, and what of them each tier may
 * carry (the brief of 11 October, section 8).
 *
 * A solve is the kernel's join of its two events and its condition (`solvesIn`, `conditionsOf`),
 * with the calls it made since its last start. Its ruling is what stands of its rejection: a person's label where a settled report holds one, the
 * Referee's last finding otherwise. A ruling is withheld in both tiers where `withheld.ts` says so.
 *
 * Turns and calls are the kernel's reading of the trace events (`traceOf`, `src/kernel/trace.ts`),
 * the one the Builder's `read_trace` pages, with a call's result cut for the default tier.
 */
import { reported, UNSETTLED } from "../../../../src/builder/comparison.ts";
import type { Ending } from "../../../../src/kernel/solve.ts";
import type { Solve } from "../../../../src/kernel/solves.ts";
import { type Seat, traceOf } from "../../../../src/kernel/trace.ts";
import { isNumber, isString, type JsonObject } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import type { Ruling } from "../../../../src/review/referee.ts";
import type { SolveRow, Tier, ToolCall, Turn } from "../models.ts";
import { callsIn, conditionsIn, type Log, once, practiceIn, reportsIn } from "./folds.ts";
import { movesIn } from "./moves.ts";
import { rulingWithheld } from "./withheld.ts";

/** How much of a call's result an answer carries; the raw event is the exam tier's. */
const RESULT_CHARS = 8_000;
const FAIL_KINDS = ["rejected", "wall-ended", "turns-ended", "context-ended", "no-answer"] as const;
const NON_RESULTS = ["provider", "sandbox-crash", "killed", "moved-files", "check", "verifier"] as const;
/** The non-results whose reason names a check or what the verifier saw of an answer. */
const EXAM_REASONS: ReadonlySet<string> = new Set(["check", "verifier"]);
const RULINGS = ["earned", "check-defect", "unclear"] as const;
const WITHHELD = "withheld in the default tier: it names what the exam side's checks saw";

/** The answer is served in the exam tier. */
export const examTier = (tier: Tier): boolean => tier === "exam";

/** A logged ending as the kernel types it, or null where it holds none it can read. A reason that
 *  names a check or the verifier's view of an answer is the exam tier's. */
export function endingOf(ending: JsonObject | null, tier: Tier): Ending | null {
  if (ending === null) return null;
  const { outcome, kind, reason } = ending;
  const said = isString(reason) ? reason : "";
  if (outcome === "pass") return { outcome };
  if (outcome === "fail" && kind === "broken-harness") return { outcome, kind, reason: said };
  const failed = FAIL_KINDS.find((each) => each === kind);
  if (outcome === "fail" && failed !== undefined) return { outcome, kind: failed };
  const non = NON_RESULTS.find((each) => each === kind);
  if (outcome !== "non-result" || non === undefined) return null;
  return { outcome, kind: non, reason: EXAM_REASONS.has(non) && !examTier(tier) ? WITHHELD : said };
}

/** The two harnesses of each comparison, by its id, from its handover. */
const sidesIn = once(
  (log) =>
    new Map(movesIn(log).flatMap((move) => (move.step === "comparison" ? [[move.id, move] as const] : []))),
);

/** The labels the settled reports hold, by solve: a person's word stands over a ruling. */
const labelsIn = once(({ events }) => {
  const labels = new Map<string, Ruling>();
  for (const { session } of reportsIn({ events })) {
    const settled = reported(events, session)?.settled ?? UNSETTLED;
    for (const [solve, label] of Object.entries(settled === UNSETTLED ? {} : settled.labels)) {
      labels.set(solve, label);
    }
  }
  return labels;
});

/** What stands of a solve's rejection, who said it and why; null where nobody has ruled. */
export function rulingOf(
  log: Log,
  solve: string,
): { readonly ruling: Ruling; readonly by: "referee" | "host" | "label"; readonly reason: string } | null {
  const label = labelsIn(log).get(solve);
  if (label !== undefined) {
    return { ruling: label, by: "label", reason: "a person's label, which stands over the ruling" };
  }
  const finding = log.events.findLast(
    ({ kind, data }) => kind === "referee.finding" && data.solve === solve,
  )?.data;
  const ruling = RULINGS.find((each) => each === finding?.ruling);
  if (finding === undefined || ruling === undefined) return null;
  // The host rules what needs no reading and meters nothing; a reader's finding carries its probes'
  // rows and what it billed (`referee`, `src/review/referee.ts`).
  return {
    ruling,
    by: Object.hasOwn(finding, "probeRows") ? "referee" : "host",
    reason: isString(finding.reason) ? finding.reason : "",
  };
}

/** Where a solve stood: a side of the comparison its start names, practice, or neither. */
function sideOf(
  log: Log,
  id: string,
  { comparison, harness }: { readonly comparison: string | null; readonly harness: string },
): SolveRow["side"] {
  const sides = comparison === null ? undefined : sidesIn(log).get(comparison);
  if (sides === undefined) return practiceIn(log).has(id) ? "practice" : "other";
  if (harness === sides.fresh) return "fresh";
  return harness === sides.old ? "old" : "other";
}

/** One solve as a list row, in `tier`. */
export function solveRow(log: Log, solve: Solve, tier: Tier): SolveRow {
  const under = conditionsIn(log).get(solve.condition);
  const task = under?.task ?? "";
  const harness = under?.harness ?? "";
  const comparison = isString(solve.start.comparison) ? solve.start.comparison : null;
  const ruling =
    examTier(tier) && rulingWithheld(log, solve.id, task) === null
      ? (rulingOf(log, solve.id)?.ruling ?? null)
      : undefined;
  const { end } = solve;
  return {
    id: solve.id,
    task,
    taskId: isString(solve.start.task) ? solve.start.task : null,
    harness,
    side: sideOf(log, solve.id, { comparison, harness }),
    comparison,
    ending: endingOf(solve.ending, tier),
    turns: isNumber(end?.turns) ? end.turns : null,
    calls: callsIn(log)[solve.id] ?? 0,
    seconds: isNumber(end?.seconds) ? end.seconds : null,
    billed: isNumber(end?.billed) ? end.billed : null,
    ...keyIfDefined("ruling", ruling),
  };
}

/** The turns and the calls of seat `seat`'s solve or session `id`, as the page serves them. */
function traced(log: Log, seat: Seat, id: string): { turns: Turn[]; calls: ToolCall[] } {
  const { turns, calls } = traceOf(log.events, seat, id);
  return {
    turns: turns.map(({ index, turn, text, stopReason, error, billed }, at) => ({
      index,
      turn: turn ?? at + 1,
      text,
      stopReason,
      error,
      billed,
    })),
    calls: calls.map(({ index, turn, tool, args, isError, text, ms }, at) => ({
      index,
      seq: at + 1,
      turn: turn ?? 0,
      tool,
      args,
      isError,
      // An empty result reads as none, as the Builder's page of a call says it (`callText`).
      result: text === "" ? null : text.slice(0, RESULT_CHARS),
      truncated: text.length > RESULT_CHARS,
      ms,
    })),
  };
}

/** A solve's turns and calls: its own events, as the Builder's `read_trace` reads them. */
export const solveTrace = (log: Log, solve: string) => traced(log, "solve", solve);

/** A Builder's or an Examiner's session's own turns and calls. */
export const sessionTrace = (log: Log, session: string, seat: "build" | "exam") => traced(log, seat, session);

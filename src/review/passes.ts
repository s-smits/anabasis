/**
 * A person's reading of answers that passed: the plan's row F25 until there is a Judge.
 *
 * A pass is the checks' word alone. Every check of an exam drafted from a prompt is its author's own
 * computation, admitted by the operator and read by no engine of the field, and on 9 October the
 * second campaign from a prompt on a test host rejected no answer in 308 solves. Nothing in the
 * system reads an answer that passed, so a check that passes wrong answers reads as a harness that
 * answers. Until the Judge recomputes a sample (`docs/plan.md`, rows F24 and F25), a person reads a
 * few passes of each comparison, and the log says which and what was found.
 *
 * The draw is fixed by the comparison's id before any answer is read (`draw`, as the scored set is
 * drawn), so nobody picks the passes to read after seeing them, and the same command draws the
 * same solves again. A label is one of three words: `sound`, the answer is a valid answer to its
 * task by the rules; `wrong`, it is not, and the checks passed it; `unclear`. The labels of a
 * comparison are recorded once (`pass.labelled`), and change no tally and no reading: a wrong pass
 * is a check's fault, which is the check program's owner's to repair, and the closing report names
 * it (`tools/d2/close.ts`). `tools/d2/settle.ts --passes` is the command.
 */
import { draw } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { passed, solvesIn } from "../kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";

export const PASS_LABELS = ["sound", "wrong", "unclear"] as const;
export type PassLabel = (typeof PASS_LABELS)[number];
export const PASS_LABELLED = "pass.labelled";

/** What a person's labels of passes come to over a log: the comparisons read, the answers read,
 *  and the answers that passed in those comparisons. */
export interface PassesRead {
  readonly comparisons: number;
  readonly read: number;
  readonly of: number;
  readonly labels: Record<PassLabel, number>;
}

/** The solves of comparison `id` whose answer passed, in the order they started. */
export function passesOf(events: readonly LogEvent[], id: string): string[] {
  return solvesIn(events).flatMap((solve) =>
    solve.start.comparison === id && passed(solve) === true ? [solve.id] : [],
  );
}

/** `count` of comparison `id`'s passes, or all of them where there are fewer, drawn by the
 *  comparison's id: the same draw whenever it is asked for. */
export function toRead(events: readonly LogEvent[], id: string, count: number): string[] {
  const passes = passesOf(events, id);
  return draw(passes, Math.min(count, passes.length), `passes:${id}`);
}

/** A person's labels as their file holds them, a label a drawn solve, and the solves whose entry
 *  is empty (still to be read) or something else (mistyped, which is refused by the caller). */
export function passLabels(file: JsonValue) {
  const labels = new Map<string, PassLabel>();
  const empty: string[] = [];
  const mistyped: string[] = [];
  for (const [solve, value] of Object.entries(asRecord(file) ?? {})) {
    const label = PASS_LABELS.find((known) => known === value);
    if (label !== undefined) labels.set(solve, label);
    else if (value === "") empty.push(solve);
    else mistyped.push(solve);
  }
  return { labels, empty, mistyped };
}

/** The record of comparison `id`'s pass labels, or null where none was made. */
export function passesLabelled(events: readonly LogEvent[], id: string): LogEvent | null {
  return events.findLast(({ kind, data }) => kind === PASS_LABELLED && data.session === id) ?? null;
}

/** What every `pass.labelled` event of a log comes to. */
export function passesRead(events: readonly LogEvent[]): PassesRead {
  const labels: Record<PassLabel, number> = { sound: 0, wrong: 0, unclear: 0 };
  let comparisons = 0;
  let read = 0;
  let of = 0;
  for (const { kind, data } of events) {
    if (kind !== PASS_LABELLED) continue;
    comparisons += 1;
    of += isNumber(data.of) ? data.of : 0;
    for (const value of Object.values(asRecord(data.labels) ?? {})) {
      const label = PASS_LABELS.find((known) => known === value);
      if (label === undefined || !isString(value)) continue;
      labels[label] += 1;
      read += 1;
    }
  }
  return { comparisons, read, of, labels };
}

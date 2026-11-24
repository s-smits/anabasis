/**
 * Rejected-solve tallying and blind operator sample drawing (`rejections`, `drawn`, `labelled`).
 */
import { draw } from "../kernel/compare.ts";
import { eventsOf, type LogEvent } from "../kernel/log.ts";
import { verdictsOf } from "../kernel/solves.ts";
import { blockingOf } from "../kernel/verify.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { RULINGS } from "./agreement.ts";
import type { Ruling } from "./referee.ts";

export interface Rejections {
  /** The refused answers the log holds, by the solve each verdict names. */
  readonly fails: readonly string[];
  /** The Referee's last ruling of each, counted. */
  readonly rulings: Readonly<Record<Ruling, number>>;
  /** Fails with no ruling yet. */
  readonly unruled: readonly string[];
  /** The check defects, by the check each ruling names. */
  readonly defects: Readonly<Record<string, number>>;
}

/** Every solve whose logged verdict is an answer some check refused. An answer outside the
 *  contract's format reached no check, and is not a rejection of the checker's. */
function refused(events: readonly LogEvent[]): string[] {
  return [...verdictsOf(events).values()].flatMap((verdict) =>
    blockingOf(verdict.checker).length > 0 ? [verdict.solve] : [],
  );
}

/** The refused answers and what the Referee has ruled of them so far. */
export function rejections(events: readonly LogEvent[]): Rejections {
  const fails = refused(events);
  const findings = new Map(
    eventsOf(events, "referee.finding").flatMap(({ event: { data } }) =>
      isString(data.solve) ? [[data.solve, data] as const] : [],
    ),
  );
  const rulings: Record<Ruling, number> = { earned: 0, "check-defect": 0, unclear: 0 };
  const defects: Record<string, number> = {};
  const unruled: string[] = [];
  for (const solve of fails) {
    const found = findings.get(solve);
    const ruling = RULINGS.find((known) => known === found?.ruling);
    if (ruling === undefined) {
      unruled.push(solve);
      continue;
    }
    rulings[ruling] += 1;
    if (ruling === "check-defect" && isString(found?.check)) {
      defects[found.check] = (defects[found.check] ?? 0) + 1;
    }
  }
  return { fails, rulings, unruled, defects };
}

/** The fails a person labels before the Referee reads any: `count` of the refused answers, by `seed`. */
export function drawn(events: readonly LogEvent[], count: number, seed: string): string[] {
  if (eventsOf(events, "referee.finding").length > 0) {
    throw new Error("the log already holds a ruling, so a label drawn now would not be made blind");
  }
  const fails = refused(events);
  if (fails.length < count) {
    throw new Error(
      `${String(count)} labels need as many refused answers; the log holds ${String(fails.length)}`,
    );
  }
  return draw(fails, count, seed);
}

/** A person's labels as their file holds them, a word a drawn solve, and the solves still to be
 *  labelled: any whose entry is none of the `known` words, which are the three rulings of a
 *  rejection unless the caller reads another kind of label (a pass's, in `settle.ts`). */
export function labelled<Word extends string>(file: JsonValue, known: readonly Word[]) {
  const labels = new Map<string, Word>();
  const open: string[] = [];
  for (const [solve, value] of Object.entries(asRecord(file) ?? {})) {
    const word = known.find((each) => each === value);
    if (word === undefined) open.push(solve);
    else labels.set(solve, word);
  }
  return { labels, open };
}

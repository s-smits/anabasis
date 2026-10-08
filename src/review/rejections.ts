/**
 * A reading of the answers a checker refused: what the Referee ruled of each, and the order in which
 * a person's labels and the Referee's rulings are made.
 *
 * A checker's controls test the faults their author thought of (`src/kernel/acceptance.ts`). Whether
 * its rejections are sound shows only on answers it refused that nobody wrote to be refused, and a
 * stored sweep holds those: every rejected answer, with the checks that refused it. In v1 that share
 * was never taken for a pack before the pack was used, and when it was taken afterwards the check
 * was the stricter side on 17 of the 22 fails counted as limits (v1 `AGENTS.md`, "Open gaps").
 *
 * The labels come first. A person labels a drawn sample with the Referee's three rulings before the
 * Referee reads anything, since the log shows a ruling to whoever opens it and a label made after
 * that was not made blind. So the draw refuses a log that holds a ruling, and the caller starts no
 * reading while a drawn fail is unlabelled. The sample is drawn by a seed fixed before the fails
 * were known, as the anchor's is (`compare.ts`, `draw`).
 *
 * This counts and decides nothing. What share of check defects a checker may carry, and the bar the
 * Referee must clear against the labels (`agreement.ts`), are the operator's.
 */
import { draw } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
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
  return [
    ...new Set(
      events.flatMap(({ kind, data }) =>
        kind === "verdict" &&
        data.kind === "fail" &&
        isString(data.solve) &&
        Array.isArray(data.blocking) &&
        data.blocking.length > 0
          ? [data.solve]
          : [],
      ),
    ),
  ];
}

/** The refused answers and what the Referee has ruled of them so far. */
export function rejections(events: readonly LogEvent[]): Rejections {
  const fails = refused(events);
  const rulings: Record<Ruling, number> = { earned: 0, "check-defect": 0, unclear: 0 };
  const defects: Record<string, number> = {};
  const unruled: string[] = [];
  for (const solve of fails) {
    const found = events.findLast(
      ({ kind, data }) => kind === "referee.finding" && data.solve === solve,
    )?.data;
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
  if (events.some(({ kind }) => kind === "referee.finding")) {
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

/** A person's labels as their file holds them, a ruling a drawn solve, and the solves still to be
 *  labelled: any whose entry is not one of the three rulings. */
export function labelled(file: JsonValue) {
  const labels = new Map<string, Ruling>();
  const open: string[] = [];
  for (const [solve, value] of Object.entries(asRecord(file) ?? {})) {
    const ruling = RULINGS.find((known) => known === value);
    if (ruling === undefined) open.push(solve);
    else labels.set(solve, ruling);
  }
  return { labels, open };
}

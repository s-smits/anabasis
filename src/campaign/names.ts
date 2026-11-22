/**
 * The names people read for a campaign's harnesses: the Starter Built Harness is A, and each other
 * harness the log names gets the next letter in the order the log first names it, B to Z, then AA,
 * AB and on. A digest is the identity that saved states,
 * comparisons, repeats and recovery go by; a letter is a name beside it, and every printed name
 * keeps the digest's first eight characters, so the hash stays there to inspect.
 */
import type { EventKind, LogEvent } from "../kernel/log.ts";
import { isString } from "../meta/json-shape.ts";
import { short } from "./move.ts";

/** How a reader prints a harness it names by digest. */
export type Called = (harness: string) => string;

/** The fields of each kind that name a harness by digest, in the order a reader meets them. */
const NAMING: Readonly<Partial<Record<EventKind, readonly string[]>>> = {
  "build.started": ["parent"],
  "harness.version": ["parent", "version"],
  "build.finished": ["harness"],
  "build.checkpoint": ["harness"],
  "harness.imported": ["harness"],
  "comparison.started": ["starter", "old", "fresh"],
  "harness.promoted": ["harness"],
};

/** A whole digest, as a kept harness is named. */
export const DIGEST = /^[0-9a-f]{64}$/u;

/** The letters of the nth name, from zero: A to Z, then AA, AB and on. */
export function letters(nth: number): string {
  const rest = Math.floor(nth / 26);
  const last = String.fromCodePoint(65 + (nth % 26));
  return rest === 0 ? last : `${letters(rest - 1)}${last}`;
}

/** Each harness the log names, by digest, with its letter (the head comment). */
export function namesOf(events: readonly LogEvent[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  let next = 1;
  for (const { kind, data } of events) {
    for (const field of NAMING[kind] ?? []) {
      const digest = data[field];
      if (!isString(digest) || !DIGEST.test(digest) || names.has(digest)) continue;
      const starts = field === "starter" || (kind === "build.started" && field === "parent");
      names.set(digest, starts ? "A" : letters(next++));
    }
  }
  return names;
}

/** How a harness is printed: its letter with the digest's first eight characters beside it, or the
 *  eight alone for a digest the log has not named yet. A name that is no digest is printed as it is. */
export function calledBy(names: ReadonlyMap<string, string>): Called {
  return (harness) => {
    const letter = names.get(harness);
    if (letter !== undefined) return `${letter} (${short(harness)})`;
    return DIGEST.test(harness) ? short(harness) : harness;
  };
}

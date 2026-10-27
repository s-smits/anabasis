/**
 * The names people read for a campaign's harnesses: the Starter Built Harness is A, and each other
 * harness the log names gets the next letter in the order the log first names it, B to Z, then AA,
 * AB and on (the hardening plan's PR 8, 14 October). A digest is the identity that saved states,
 * comparisons, repeats and recovery go by; a letter is a name beside it, and every printed name
 * keeps the digest's first eight characters, so the hash stays there to inspect.
 *
 * The names are a fold over the log and nothing else: the log is append-only, so a harness keeps
 * its letter whatever is appended after it, a campaign run again reads the same names, and a
 * promotion changes which harness is the reference and not what it is called. No second store
 * holds them, and no saved state is renamed. A later letter means a harness the log named later;
 * it says nothing of how good it is.
 *
 * The Starter is A by role, as the log first names it: the digest a comparison names as its
 * starter, or the parent of a Builder session that the log has not named before, since a session
 * starts from the Starter, from a harness a session left or from one imported, and the log names
 * the last two before. A log whose host changed the Starter's files between commands names two
 * digests as the starter, and both read A.
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

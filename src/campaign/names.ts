import type { EventKind, LogEvent } from "../kernel/log.ts";
import { isString } from "../meta/json-shape.ts";
import { short } from "./move.ts";

export type Called = (harness: string) => string;

const NAMING: Readonly<Partial<Record<EventKind, readonly string[]>>> = {
  "build.started": ["parent"],
  "harness.version": ["parent", "version"],
  "build.finished": ["harness"],
  "build.checkpoint": ["harness"],
  "harness.imported": ["harness"],
  "comparison.started": ["starter", "old", "fresh"],
  "harness.promoted": ["harness"],
  "harness.reverted": ["harness", "from"],
};

export const DIGEST = /^[0-9a-f]{64}$/u;

export function letters(nth: number): string {
  const rest = Math.floor(nth / 26);
  const last = String.fromCodePoint(65 + (nth % 26));
  return rest === 0 ? last : `${letters(rest - 1)}${last}`;
}

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

export function calledBy(names: ReadonlyMap<string, string>): Called {
  return (harness) => {
    const letter = names.get(harness);
    if (letter !== undefined) return `${letter} (${short(harness)})`;
    return DIGEST.test(harness) ? short(harness) : harness;
  };
}

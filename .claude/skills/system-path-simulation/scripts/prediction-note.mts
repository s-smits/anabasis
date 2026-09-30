/**
 * How a simulation's prediction note is read: where its frozen part ends and which lines declare a
 * row. `predictions.mts` hashes and resolves the note; `run-condition.mts` and `run-segment.mts`
 * close by naming the rows still open. On 2026-09-30 they read one note two ways: the frame × model
 * note declared its rows as "P1: …", both runners listed P1–P5 as open, and `predictions.mts` read
 * no row, refused to hash the note and could resolve none of them.
 */

/** The heading resolutions are appended under. Everything above it is the frozen part. */
export const RESOLUTIONS_HEADING = /^## Resolutions\b.*$/m;

/** A declared row is a row id at the start of a line followed by " —" or ":", as in "P1 — …" or
 *  "P1: …". A resolution row starts with "- ", so it never declares one. */
const ROW_ID = /^([A-Z]\d+)(?: —|:)/gm;

export interface SplitNote {
  preRegistered: string;
  resolutions: string | null;
}

/** Everything above the `## Resolutions` heading is the frozen part; below it is appendable. */
export function splitNote(text: string): SplitNote {
  const match = RESOLUTIONS_HEADING.exec(text);
  if (match === null) return { preRegistered: text, resolutions: null };
  return { preRegistered: text.slice(0, match.index), resolutions: text.slice(match.index) };
}

/** The row ids the frozen part declares, in note order. */
export function declaredRows(preRegistered: string): string[] {
  return preRegistered
    .matchAll(ROW_ID)
    .map((row) => row[1] ?? "")
    .filter((id) => id !== "")
    .toArray();
}

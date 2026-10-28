/**
 * The simplify catchers that name a platform feature the code is spelling out by hand: a promise
 * around a timer, a key looked back up, and two walks where `flatMap` does one. A loop that is
 * `find`, a predicate that also records and the count that answers yes or no have their own
 * files.
 *
 * Each of these has a right answer, which is why they are worth catching deterministically, and
 * all of them gate as of 2026-09-20. What a test pins is the edge — the site the platform feature
 * would not actually reach, which is where a confident rewrite goes wrong, and which now refuses
 * a push rather than printing a line somebody skips.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/** Report the fixture's own `// REPORT` lines and nothing else. */
async function pins(rule: string, fixture: string, count: number): Promise<void> {
  const expected = expectedLines(fixture);
  expect(expected).toHaveLength(count);
  expect(await reportedLines("ana", rule, fixture)).toStrictEqual(expected);
}

const SLEEPS = `
export function pause(ms: number) {
  return new Promise((done) => setTimeout(done, ms)); // REPORT a fixed pause waits for nothing
}
export function settled(value: number) {
  return new Promise<number>((done) => done(value)); // ADMITTED no timer, so no sleep
}
export function scheduled(ms: number) {
  return setTimeout(() => undefined, ms); // ADMITTED a timer outside a promise is a schedule
}
export function deadline(ms: number, work: Promise<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((done) => {
    timer = setTimeout(() => done("late"), ms); // ADMITTED the handle is kept, so the wait can end early
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
export function aborted(ms: number, controller: AbortController) {
  // ADMITTED the callback does the work, so the promise settles on it rather than on the clock
  return new Promise((done) => setTimeout(() => { controller.abort(); done(null); }, ms));
}
export function deferred(value: number) {
  return new Promise<number>((done) => setTimeout(() => done(value + 1), 0)); // ADMITTED a deferral past the current task
}
`.trimStart();

const KEYS = `
declare const counts: Record<string, number>;
declare function use(key: string, value: number): void;

export function lookedUp() {
  for (const key of Object.keys(counts)) { // REPORT the key goes back for the value beside it
    use(key, counts[key] ?? 0);
  }
}
export function keysAlone() {
  for (const key of Object.keys(counts)) { // ADMITTED the keys are the answer
    use(key, 0);
  }
}
export function cleared() {
  for (const key of Object.keys(counts)) { // ADMITTED a delete reads no value
    delete counts[key];
  }
}
`.trimStart();

const WALKS = `
declare const rows: string[];
declare function parse(row: string): string | null;

export const parsed = rows.map(parse).filter(Boolean); // REPORT two walks where flatMap does one
export const kept = rows.map(parse).filter((row) => row !== null); // ADMITTED a real predicate
export const present = rows.filter(Boolean); // ADMITTED one walk already
`.trimStart();

const FOLDS = `
declare const rows: { score: number; name: string }[];
declare function addScore(total: number, row: { score: number }): number;
export function best() {
  return rows.reduce<{ score: number } | undefined>((best, row) => { // REPORT the step is a loop body
    if (best === undefined) return row;
    return row.score > best.score ? row : best;
  }, undefined);
}
export function named() {
  return rows.reduce(addScore, 0); // ADMITTED the step has a name and a doc comment of its own
}
export function summed() {
  return rows.reduce((total, row) => total + row.score, 0); // ADMITTED an expression is an operator
}
export function joined() {
  return rows.map((row) => row.name).join(", "); // ADMITTED not a fold
}
`.trimStart();

describe("the simplify platform catchers", () => {
  it("reads a promise wrapped around a timer", async () => {
    await pins("no-hand-rolled-sleep", SLEEPS, 1);
  });

  it("reads a key walk that looks the value back up", async () => {
    await pins("prefer-entries-over-keys-lookup", KEYS, 1);
  });

  it("reads a map whose result is filtered for presence", async () => {
    await pins("prefer-flatmap-over-map-filter", WALKS, 1);
  });

  it("reads a reduce whose whole step is written inline as a block", async () => {
    await pins("no-inline-block-reducer", FOLDS, 1);
  });
});

/**
 * The simplify catchers that name a platform feature the code is spelling out by hand: a loop
 * that is `find`, a predicate that also records, a promise around a timer, a count that answers
 * yes or no, a key looked back up, and two walks where `flatMap` does one.
 *
 * Each of these has a right answer, which is why they are worth catching deterministically, and
 * all of them gate as of 2026-09-20. What a test pins is the edge — the site the platform feature
 * would not actually reach, which is where a confident rewrite goes wrong, and which now refuses
 * a push rather than printing a line somebody skips.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/** Report the fixture's own `// REPORT` lines and nothing else. */
function pins(rule: string, fixture: string, count: number): void {
  const expected = expectedLines(fixture);
  expect(expected).toHaveLength(count);
  expect(reportedLines("ana", rule, fixture)).toStrictEqual(expected);
}

const LOOPS = `
declare const rows: { id: string }[];
declare const byKey: Record<string, { id: string }>;
declare function ready(row: { id: string }): Promise<boolean>;
declare const allowed: Set<string>;

export function firstMatch(id: string) {
  for (const row of rows) { // REPORT a loop that returns its first match is find
    if (row.id === id) return row;
  }
  return null;
}
export function anyMatch(id: string) {
  for (const row of rows) { // REPORT returning true from the branch is some
    if (row.id === id) return true;
  }
  return false;
}
export function reported(id: string) {
  for (const row of rows) { // ADMITTED a built return needs the method and a second statement
    if (row.id === id) return \`\${row.id} is already recorded\`;
  }
  return null;
}
export function owned(id: string) {
  const owners = new Set(["brief", "tests"]);
  for (const owner of owners) { // ADMITTED a Set declared here has no find
    if (owner === id) return owner;
  }
  return null;
}
export function asked(id: string) {
  if (!allowed.has(id)) return null;
  for (const owner of allowed) { // ADMITTED a .has two lines up says this is not an array
    if (owner === id) return owner;
  }
  return null;
}
export function counted(id: string) {
  let seen = 0;
  for (const row of rows) {
    if (row.id === id) seen += 1; // ADMITTED the branch does not return, so the loop accumulates
  }
  return seen;
}
export async function awaited(id: string) {
  for (const row of rows) {
    if (await ready(row)) return row; // ADMITTED find takes no async predicate
  }
  return null;
}
export function paired(id: string) {
  for (const [key, row] of Object.entries(byKey)) {
    if (row.id === id) return key; // ADMITTED a destructured entry is not the element find passes
  }
  return null;
}
`.trimStart();

const PREDICATES = `
declare const rows: { id: string }[];
declare const seen: Set<string>;

export function deduped() {
  return rows.filter((row) => { // REPORT the walk answers and records at the same time
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
export function asked() {
  return rows.filter((row) => !seen.has(row.id)); // ADMITTED a predicate that only answers
}
export function collected() {
  const kept: string[] = [];
  for (const row of rows) kept.push(row.id); // ADMITTED a loop may do both, and says so
  return kept;
}
`.trimStart();

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

const COUNTS = `
declare const rows: number[];
declare function large(row: number): boolean;

export const any = rows.filter(large).length > 0; // REPORT counting to answer yes or no
export const none = rows.filter(large).length === 0; // REPORT the same count read the other way
export const many = rows.filter(large).length > 2; // ADMITTED a threshold needs the count
export const filled = rows.length > 0; // ADMITTED no filter: the length is the answer
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
  it("reads a loop that returns its first match, with or without the element", () => {
    pins("prefer-find-over-loop", LOOPS, 2);
  });

  it("reads a predicate that mutates a collection outliving the walk", () => {
    pins("no-side-effect-in-predicate", PREDICATES, 1);
  });

  it("reads a promise wrapped around a timer", () => {
    pins("no-hand-rolled-sleep", SLEEPS, 1);
  });

  it("reads a filtered length compared against zero, either way round", () => {
    pins("prefer-some-over-filter-length", COUNTS, 2);
  });

  it("reads a key walk that looks the value back up", () => {
    pins("prefer-entries-over-keys-lookup", KEYS, 1);
  });

  it("reads a map whose result is filtered for presence", () => {
    pins("prefer-flatmap-over-map-filter", WALKS, 1);
  });

  it("reads a reduce whose whole step is written inline as a block", () => {
    pins("no-inline-block-reducer", FOLDS, 1);
  });
});

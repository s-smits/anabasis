/**
 * The simplify catchers that name a platform feature the code is spelling out by hand: a promise
 * around a timer, and a fold whose step is a loop body. A loop that is `find` and a predicate that
 * also records have their own files.
 *
 * Each of these has a right answer, which is why they are worth catching deterministically, and
 * all of them gate as of 2026-09-20. What a test pins is the edge — the site the platform feature
 * would not actually reach, which is where a confident rewrite goes wrong, and which now refuses
 * a push rather than printing a line somebody skips.
 */
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

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

describe("the simplify catchers platform", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [
      ["no-hand-rolled-sleep", SLEEPS, 1],
      ["no-inline-block-reducer", FOLDS, 1],
    ]);
  });
});

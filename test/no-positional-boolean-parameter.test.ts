/**
 * The rule that asks a boolean parameter to become a union of two string literals.
 *
 * A module-local function whose every visible call passes the parameter's own name keeps its
 * boolean, whether the name arrives bare, as a no-argument call of it, or as a property of that
 * name: `missTail(difficulty, "above", everyBattery)`, `completedOutcome(…, submitted(), …)` and
 * `scoredFields(outcome, solvedCase.acceptedSubmit)` already read as the declaration does. Three
 * of the five reports in `5bc9988:src/run` were that one variable threaded through one file. An
 * exported declaration never takes the exemption, because its callers are in files this rule does
 * not see.
 *
 * `close(handle, true)` names neither the parameter nor the state, and the two call sites that
 * pass it the wrong way round read exactly like the two that pass it right. Keyword arguments
 * answer this in another language; the remedy the message names is the union, which costs the
 * caller nothing, and the fixture keeps one to prove the rule is satisfied by it.
 *
 * `widen` takes what Foxglove's `no-boolean-parameters` reads beyond the default: under `flags`, a
 * flag beside `undefined` or spelled `true | false`, and a parameter defaulted to a boolean; under
 * `bindings`, a `const` arrow, a `declare` function and an abstract method. The widened fixture
 * keeps the nearest hostile cases: a callback written inline, a string union beside `undefined`,
 * a number default and a `declare` guard.
 *
 * A boolean followed by a function parameter is the condition that function runs under when
 * every read of it guards a call of that function: `keysIf(files.size > 0, () => …)` is an `if`
 * written as a call, and keeps its boolean. A flag that only precedes a callback is reported.
 *
 * There is no fixer. Which two words name the states is the change.
 */
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

const PARAMETERS = `
export function close(handle: string, failed: boolean) { // REPORT true says nothing at the call site
  return failed ? handle : "";
}
export class Store {
  write(key: string, overwrite: boolean) { // REPORT a method argument reads the same way
    return overwrite ? key : "";
  }
}
export function outcome(handle: string, state: "failed" | "clean") { // ADMITTED the union names both states
  return state === "failed" ? handle : "";
}
export function destructured(handle: string, { failed }: { failed: boolean }) { // ADMITTED a different shape at the call site
  return failed ? handle : "";
}
export const callback = (value: string, matched: boolean) => (matched ? value : ""); // ADMITTED a callback satisfies someone else's signature
export function inferred(handle: string, failed = false) { // ADMITTED a default states the ordinary case
  return failed ? handle : "";
}
export function assertOpen(open: boolean, detail: string): asserts open { // ADMITTED an assertion narrows on it
  if (!open) throw new Error(detail);
}
export function isOpen(state: string, open: boolean): open is true { // ADMITTED a guard narrows on it too
  return open && state === "open";
}
export function keysIf<T extends object>(condition: boolean, keys: () => T): Partial<T> { // ADMITTED it gates the function passed next to it
  return condition ? keys() : {};
}
export function keysAfter<T extends object>(keys: () => T, condition: boolean): Partial<T> { // REPORT the function comes first, so nothing follows to gate
  return condition ? keys() : {};
}
export function runIf(condition: boolean, action: () => void) { // ADMITTED an if statement gates the call the same way
  if (condition) action();
}
export function run(verbose: boolean, done: () => void) { // REPORT a flag before a callback it never gates
  if (verbose) console.log("run");
  done();
}
export function keysUnless<T extends object>(condition: boolean, keys: () => T): Partial<T> { // REPORT the boolean is read outside the guard too
  return condition ? keys() : { condition };
}
function tail(handle: string, everyBattery: boolean) { // ADMITTED every call passes the parameter's own name
  return everyBattery ? handle : "";
}
function head(handle: string, everyBattery: boolean) { // REPORT one call passes a literal instead
  return everyBattery ? handle : "";
}
function unreached(handle: string, settled: boolean) { // REPORT nothing calls it, so no call site answers
  return settled ? handle : "";
}
function outcomeOf(handle: string, submitted: boolean) { // ADMITTED every call passes a no-argument call of that name
  return submitted ? handle : "";
}
function reader(handle: string, submitted: boolean) { // REPORT a call that takes an argument is a different value
  return submitted ? handle : "";
}
function settle(handle: string, submitted: () => boolean, other: (at: number) => boolean) {
  return outcomeOf(handle, submitted()) + reader(handle, other(0));
}
function scored(handle: string, accepted: boolean) { // ADMITTED every call passes a property of that name
  return accepted ? handle : "";
}
function graded(handle: string, accepted: boolean) { // REPORT a property under another name says nothing
  return accepted ? handle : "";
}
function record(handle: string, solvedCase: { accepted: boolean; pass: boolean }) {
  return scored(handle, solvedCase.accepted) + graded(handle, solvedCase.pass);
}
export function sentence(handle: string, everyBattery: boolean) { // REPORT exported: its callers are elsewhere
  return tail(handle, everyBattery) + head(handle, everyBattery) + head(handle, true) + settle(handle, () => true, () => false) + record(handle, { accepted: true, pass: false });
}
`.trimStart();

const WIDENED = `
export function maybe(handle: string, failed: boolean | undefined) { // REPORT beside undefined
  return failed === true ? handle : "";
}
export function literal(handle: string, failed: true | false) { // REPORT spelled as its two literals
  return failed ? handle : "";
}
export function defaulted(handle: string, failed = false) { // REPORT a default reads as true at the call site
  return failed ? handle : "";
}
export const closeAll = (handle: string, failed: boolean) => (failed ? handle : ""); // REPORT a const arrow declares
export declare function drop(handle: string, force: boolean): void; // REPORT a declare function is a contract
export abstract class Sink {
  abstract flush(handle: string, force: boolean): void; // REPORT an abstract method is a contract
}
export function mode(handle: string, kind: "full" | "quick" | undefined) { // ADMITTED a union of states
  return kind === "full" ? handle : "";
}
export function limit(handle: string, retries = 3) { // ADMITTED a number default
  return retries > 0 ? handle : "";
}
export declare function isSet(value: unknown, strict: boolean): value is string; // ADMITTED a guard narrows on it
export const names = ["a", "b"].filter((name, index) => index > 0 && name !== ""); // ADMITTED an inline callback
`.trimStart();

describe("ana/no-positional-boolean-parameter", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [
      ["no-positional-boolean-parameter", PARAMETERS, 10, "src/example.ts"],
      ["no-positional-boolean-parameter", WIDENED, 0, "src/narrow.ts"],
      ["no-positional-boolean-parameter", WIDENED, 6, "src/wide.ts", { widen: ["flags", "bindings"] }],
    ]);
  });
});

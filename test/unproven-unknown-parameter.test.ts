/**
 * The rule that decides whether an `unknown` parameter states a real question.
 *
 * `anti-slop/no-unknown-parameters` reported every `unknown` and exempted seventeen files by
 * name, so a new unproven parameter added to any of them was reported by nobody. This rule moves
 * the exemption from the file to the evidence: a parameter is admitted when the function proves
 * it. Every way of proving is therefore a way of not being reported, and a prover the rule
 * recognises too eagerly is a hole in the gate that nothing else closes.
 *
 * Each fixture labels every declaration `// REPORT <why>` or `// ADMITTED <why>` and the expected
 * lines are read back out of that text, so one expectation catches both a rule that reports
 * nothing and one that reports everything. The declarations stay on one line each because the
 * report lands on the `unknown` token itself.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const PROVERS = `
function isString(v: unknown): v is string { return typeof v === "string"; }

export function writeIt(p: string, value: unknown): string { return JSON.stringify(value) + p; } // REPORT hands it to a sink

export function readField(value: unknown): string { return String((value as { a: string }).a); } // REPORT reads a property, never tests

export function ignored(value: unknown): number { return Number(1); } // REPORT never used at all

export function unionSink(value: unknown | undefined): string { return JSON.stringify(value); } // REPORT union still absorbs to unknown

export function parenthesizedSink(value: (unknown)): string { return JSON.stringify(value); } // REPORT parentheses carry no proof

export type UnionSink = (value: string | (unknown | null)) => void; // REPORT nested union signature proves nothing

export function wrongOne(left: unknown, right: unknown): boolean { return isString(left) && String(right) !== ""; } // REPORT right is untested

export type Sink = (value: unknown) => void; // REPORT a signature with no body proves nothing

export function movesOn(value: unknown): string { return writeIt("p", value); } // REPORT the callee is not a prover

function twoUnknowns(first: unknown, second: unknown): string { return isString(first) ? first : String(second); } // REPORT second is untested

export function wrongPosition(value: unknown): string { return twoUnknowns("x", value); } // REPORT proved at index 0, not index 1

export function proved(value: unknown): string { return isString(value) ? value : ""; } // ADMITTED guard call

export function provedTypeof(value: unknown): boolean { return typeof value === "number"; } // ADMITTED typeof

export function isThing(value: unknown): value is { k: 1 } { return Boolean(value); } // ADMITTED the return type is a predicate on it

export function delegates(value: unknown): string { return proved(value); } // ADMITTED delegates to a prover declared here

export function rightPosition(value: unknown): string { return twoUnknowns(value, "x"); } // ADMITTED index 0 is proved inside the callee

export function derived(value: unknown): string { const copy = structuredClone(value); return isString(copy) ? copy : ""; } // ADMITTED derived into a proved local

export function nullish(value: unknown): boolean { return value === null; } // ADMITTED compared against null

export function enrich(cause: unknown): Error { return new Error("x", { cause }); } // ADMITTED the upstream cause exemption survives

export function unionProver(value: unknown | undefined): boolean { return isString(value); } // ADMITTED same proving boundary

export function unionCause(cause: unknown | null): Error { return new Error("x", { cause }); } // ADMITTED cause convention survives

export function concrete(value: string | null): string { return value ?? ""; } // ADMITTED useful nullable contract

// oxlint-disable-next-line ana/unproven-unknown-parameter -- proves nothing, on purpose
export function excused(value: unknown): string { return String(value); } // ADMITTED a line disable names this rule
`.trimStart();

/** Every narrowing the rule accepts, and the names that only look like one. A prover admitted by
 *  mistake is the failure that costs most: nothing downstream reports the parameter again. */
const GUARDS = `
export function byInstanceof(value: unknown): boolean { return value instanceof Error; } // ADMITTED instanceof proves its left operand

export function byIn(value: unknown): boolean { return "k" in value; } // ADMITTED in proves its right operand

export function byStrictNotEqual(value: unknown): boolean { return value !== undefined; } // ADMITTED !== against undefined

export function byLooseEqual(value: unknown): boolean { return value == null; } // ADMITTED == against null

export function byLooseNotEqual(value: unknown): boolean { return value != null; } // ADMITTED != against null

export function literalOnTheLeft(value: unknown): boolean { return null === value; } // ADMITTED either side may hold the literal

export function byArrayIsArray(value: unknown): number { return Array.isArray(value) ? value.length : 0; } // ADMITTED a member callee is read by its property name

export function byNamedValidator(raw: unknown): string { return String(trustedJson(raw)); } // ADMITTED trustedJson throws on what it cannot admit

export function byTotalOwner(error: unknown): string { return errorMessage(error); } // ADMITTED errorMessage is total on unknown and owns the rendering

export function byTotalCodeOwner(cause: unknown): string { return errorCode(cause) ?? "none"; } // ADMITTED errorCode is the same owner for the code

export function byBareString(value: unknown): string { return String(value); } // REPORT String consumes it without owning anything

export function digitClosesThePrefix(value: unknown): boolean { return is2(value); } // ADMITTED a digit ends the prefix as a capital does

export function comparedToAValue(value: unknown): boolean { return value === "text"; } // REPORT equality with an ordinary value narrows nothing

export function lowercaseAfterPrefix(value: unknown): string { return issue(value); } // REPORT issue only starts with is

export function barePrefix(value: unknown): string { return parse(value); } // REPORT parse with nothing after it is not the pattern

export function computedCallee(value: unknown): boolean { return checks["isString"](value); } // REPORT a computed callee names nothing to resolve

export function aliasCarriesEveryOperand(first: unknown, second: unknown): string { const joined = [first, second].join(""); return isString2(joined) ? joined : ""; } // ADMITTED proving a derived local admits every operand it came from
`.trimStart();

/** Parameter shapes other than a plain identifier. The annotation hides behind a default, a rest
 *  element or a constructor property, and the name behind a pattern. */
const PARAMETER_FORMS = `
export function defaulted(value: unknown = null): string { return String(value); } // REPORT a default is not a proof

export function provedDefault(value: unknown = null): boolean { return typeof value === "string"; } // ADMITTED a defaulted parameter proves like any other

export function rest(...values: unknown[]): number { return values.length; } // ADMITTED an array of unknown is a known container

export type RestSignature = (...values: unknown[]) => void; // ADMITTED the same container rule in a signature

export function destructured({ a }: unknown): string { return String(a); } // REPORT an unnamed parameter can never be proved

export class Holder { constructor(private readonly value: unknown) {} } // REPORT a parameter property is still a parameter

export class Guarded { check(value: unknown): boolean { return typeof value === "string"; } } // ADMITTED a method proves like a function

export class Sinking { send(value: unknown): string { return String(value); } } // REPORT and is reported like one
`.trimStart();

/** The seven declaration kinds that carry parameters and no body. Nothing can prove them, so each
 *  reports exactly as the rule it replaced reported it — unless the return type is the proof, which
 *  a type predicate is. `loadExport`'s `accepts` parameter is the case that found this: written as
 *  a `TSFunctionType` it was reported, and the identical arrow with a body was admitted. */
const BODILESS = `
export interface Shapes {
  method(value: unknown): void; // REPORT a method signature
  (value: unknown): void; // REPORT a call signature
  new (value: unknown): Shapes; // REPORT a construct signature
}

export type Ctor = new (value: unknown) => Shapes; // REPORT a constructor type

export type Fn = (value: unknown) => void; // REPORT a function type

export declare function declared(value: unknown): void; // REPORT an ambient declaration

export function overloaded(value: unknown): string; // REPORT the overload signature has no body
export function overloaded(value: unknown): string { return typeof value === "string" ? value : ""; } // ADMITTED the implementation proves it

export abstract class Abstract { abstract take(value: unknown): void; } // REPORT an abstract method, which both the method and the empty-body visitor reach

export type Accepts = (value: unknown) => value is string; // ADMITTED the return type narrows the parameter it names

export type PartlyAccepts = (left: unknown, right: unknown) => left is string; // REPORT right is not the predicate's subject

export interface Checks { accepts(value: unknown): value is string; } // ADMITTED a method signature predicate

export declare function declaredGuard(value: unknown): value is string; // ADMITTED an ambient predicate
`.trimStart();

/** Where a proof stops travelling, and how far it travels when it does. */
const SCOPE = `
function leafProof(value: unknown): boolean { return typeof value === "string"; } // ADMITTED typeof, at the end of the chain

export function twoHops(value: unknown): boolean { return oneHop(value); } // ADMITTED a proof two calls away, found whichever order the three appear in

function oneHop(value: unknown): boolean { return leafProof(value); } // ADMITTED one call away

export function chainEndsNowhere(value: unknown): string { return sinkLink(value); } // REPORT the chain ends in a function that proves nothing

function sinkLink(value: unknown): string { return String(value); } // REPORT and neither does the link itself

export function shadowStop(value: unknown): string { return ((value: string) => typeof value === "string")(String(value)) ? "" : ""; } // REPORT a guard on a shadowed name inside a nested function proves nothing out here

const constSink = (value: unknown): string => String(value); // REPORT once, and the count is the point: the declarator names this arrow, the arrow visitor collects it

export function reachesConstSink(value: unknown): string { return constSink(value); } // REPORT so the chain still finds it under that name

const constProof = (value: unknown): boolean => typeof value === "string"; // ADMITTED a const arrow proves like any other function

export function reachesConstProof(value: unknown): boolean { return constProof(value); } // ADMITTED and the name still carries the proof back out
`.trimStart();

describe("ana/unproven-unknown-parameter", () => {
  const reports = (fixture: string): number[] => reportedLines("ana", "unproven-unknown-parameter", fixture);

  it("reports an unknown parameter the function never proves, and admits one it does", () => {
    const expected = expectedLines(PROVERS);
    expect(expected).toHaveLength(11);
    expect(reports(PROVERS)).toStrictEqual(expected);
  });

  it("accepts every narrowing it recognises and no name that merely resembles one", () => {
    const expected = expectedLines(GUARDS);
    expect(expected).toHaveLength(5);
    expect(reports(GUARDS)).toStrictEqual(expected);
  });

  it("finds the annotation behind a default, a rest element, a pattern and a parameter property", () => {
    const expected = expectedLines(PARAMETER_FORMS);
    expect(expected).toHaveLength(4);
    expect(reports(PARAMETER_FORMS)).toStrictEqual(expected);
  });

  it("reports each of the declaration kinds that have no body to prove with, unless the return type proves", () => {
    const expected = expectedLines(BODILESS);
    expect(expected).toHaveLength(9);
    expect(reports(BODILESS)).toStrictEqual(expected);
  });

  it("carries a proof through two calls, stops it at a nested function, and reports a const arrow once", () => {
    const expected = expectedLines(SCOPE);
    expect(expected).toHaveLength(5);
    expect(reports(SCOPE)).toStrictEqual(expected);
  });
});

/**
 * The simplify catchers that read the shape of a statement: two arms, a repeated literal, an
 * argument the callee already has, a temporary that renames, a wrapper that forwards, a `let`
 * decided on the next line, a boolean spelled over two returns, a chain that is a table, and a
 * constant table built inside a function body.
 *
 * All of them gate as of 2026-09-20, so what a test has to pin is the boundary between the shape
 * and its neighbours in both directions: a rule that reports the neighbour too now refuses a
 * push, and one that stopped reporting its own shape fails nothing at all.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/** Report the fixture's own `// REPORT` lines and nothing else. */
function pins(rule: string, fixture: string, count: number): void {
  const expected = expectedLines(fixture);
  expect(expected).toHaveLength(count);
  expect(reportedLines("ana", rule, fixture)).toStrictEqual(expected);
}

const ARMS = `
declare function spawnUnder(profile: string, command: unknown[]): string;
declare function spawnOver(profile: string, command: unknown[]): string;
declare let linuxWalls: number;
declare let darwinWalls: number;
declare const bwrapProfile: string;
declare const seatbeltProfile: string;
declare const wide: string;

export function wall(linux: boolean, command: string[]) {
  if (linux) return spawnUnder(bwrapProfile, command); // REPORT one term across eight, no else
  return spawnUnder(seatbeltProfile, command);
}
export function walled(linux: boolean, command: string[]) {
  if (linux) { // REPORT the same pair with the else written out
    return spawnUnder(bwrapProfile, command);
  } else {
    return spawnUnder(seatbeltProfile, command);
  }
}
export function picked(linux: boolean, command: string[]) {
  return linux ? spawnUnder(bwrapProfile, command) : spawnUnder(seatbeltProfile, command); // REPORT a ternary is the same finding
}
export function named(linux: boolean) {
  return linux ? bwrapProfile : seatbeltProfile; // ADMITTED one token an arm: that is what a conditional is for
}
export function labelled(linux: boolean, command: string[]) {
  return linux ? spawnUnder("bwrap", command) : spawnUnder("seatbelt", command); // ADMITTED two named outcomes, not one with a hole
}
export function two(linux: boolean, command: string[]) {
  if (linux) return spawnUnder(bwrapProfile, command);
  return spawnUnder(seatbeltProfile, [wide]); // ADMITTED two tokens differ, which is two decisions
}
export function guarded(linux: boolean, command: string[]) {
  if (linux) return spawnUnder(bwrapProfile, command);
  const profile = seatbeltProfile; // ADMITTED a guard over a body is one arm, not two
  return spawnUnder(profile, command);
}
export function called(hard: boolean, command: string[]) {
  if (hard) return spawnUnder(wide, command);
  return spawnOver(wide, command); // ADMITTED the callee is what the line does, not a value it takes
}
export function membered(hard: boolean, counts: { linux: number; darwin: number }) {
  if (hard) counts.linux += 1; // ADMITTED a property name hoists only into a computed member
  else counts.darwin += 1;
}
export function targeted(hard: boolean) {
  if (hard) linuxWalls += 1; // ADMITTED two counters, not one counter with a hole
  else darwinWalls += 1;
}
export function nested(linux: boolean) {
  return linux ? spawnUnder(wide, [bwrapProfile]) : spawnUnder(wide, [seatbeltProfile]); // REPORT a value stays a value inside a literal
}
export function compared(allow: boolean, status: number) {
  return allow ? status === 0 : status !== 0; // ADMITTED an operator is a relation, not a term
}
export function indexed(first: boolean, argv: string[]) {
  return first ? argv[0] : argv[1]; // ADMITTED two things named a side is what a conditional is for
}
export function messaged(one: boolean, path: string) {
  if (one) return \`Could not find the text in \${path}.\`;
  return \`Could not find edits[0] in \${path}.\`; // ADMITTED two messages, like two quoted outcomes
}
`.trimStart();

const OBJECTS = `
declare function expect(value: unknown): { toMatchObject(shape: object): void };
declare const one: unknown;
declare const two: unknown;
declare const three: unknown;
declare function record(row: { kind: string; verified: boolean; runId: string }): void;
declare function clear(dir: string, options: { recursive: boolean; force: boolean; keep: unknown }): void;
export function thrice() {
  record({ kind: "case", verified: true, runId: "r1" }); // REPORT a third spelling makes the literal a name
  record({ kind: "case", verified: true, runId: "r1" });
  record({ kind: "case", verified: true, runId: "r1" });
}
export function twice() {
  record({ kind: "probe", verified: false, runId: "r2" }); // ADMITTED at two, the extraction is a one-caller helper
  record({ kind: "probe", verified: false, runId: "r2" });
}
export function paired() {
  record({ kind: "one", verified: true } as { kind: string; verified: boolean; runId: string });
  record({ kind: "one", verified: true } as { kind: string; verified: boolean; runId: string });
  record({ kind: "one", verified: true } as { kind: string; verified: boolean; runId: string }); // ADMITTED a pair is held in the head
}
export function flagged(dir: string) {
  clear(dir, { recursive: true, force: true, keep: null }); // ADMITTED flags carry no shape to redefine
  clear(dir, { recursive: true, force: true, keep: null });
  clear(dir, { recursive: true, force: true, keep: null });
}
export function asserted() {
  expect(one).toMatchObject({ kind: "case", verified: false, runId: "r3" }); // ADMITTED an expectation is read where it is written
  expect(two).toMatchObject({ kind: "case", verified: false, runId: "r3" });
  expect(three).toMatchObject({ kind: "case", verified: false, runId: "r3" });
}
`.trimStart();

const TEST_OBJECTS = `
declare function record(row: { kind: string; verified: boolean; runId: string }): void;
export function thrice() {
  record({ kind: "case", verified: true, runId: "r1" }); // ADMITTED in a test the literal is the case being read
  record({ kind: "case", verified: true, runId: "r1" });
  record({ kind: "case", verified: true, runId: "r1" });
}
export function fivefold() {
  record({ kind: "probe", verified: false, runId: "r2" }); // REPORT five spellings is a fixture, not a case
  record({ kind: "probe", verified: false, runId: "r2" });
  record({ kind: "probe", verified: false, runId: "r2" });
  record({ kind: "probe", verified: false, runId: "r2" });
  record({ kind: "probe", verified: false, runId: "r2" });
}
`.trimStart();

const CARRIED = `
import { publish } from "./published.ts";
declare const bundle: { rows: string[]; id: string; kind: string; note: string | null };
function render(all: typeof bundle, rows: string[]): void {}
function index(rows: string[], at: number): string { return rows[at] ?? ""; }
function pick(all: typeof bundle, part: string): void {}
function noted(all: typeof bundle, note: string): void {}
export function passesBoth() {
  render(bundle, bundle.rows); // REPORT the callee already holds bundle.rows
}
export function passesImported() {
  publish(bundle, bundle.rows); // ADMITTED another file owns that signature, so this file cannot close it
}
export function passesComputed(at: number) {
  index(bundle.rows, at); // ADMITTED a computed part is not a fixed part of the whole
}
export function passesVarying() {
  pick(bundle, bundle.id); // ADMITTED another call passes a different part, so the parameter carries something
  pick(bundle, bundle.kind);
}
export function passesNarrowed() {
  if (bundle.note !== null) noted(bundle, bundle.note); // ADMITTED the caller narrowed it; the callee would redo that
}
`.trimStart();

const TEMPORARIES = `
declare const bundle: { rows: string[]; title?: string };
declare const host: { log: () => void };
declare function toCase(row: string): string;
declare function mutate(): void;
export function renamed() {
  const rows = bundle.rows; // REPORT a second name for one expression, read once, next line
  return rows.map(toCase);
}
export function snapshot() {
  const before = bundle.rows;
  mutate();
  return before.length; // ADMITTED the read is not adjacent, so the binding may be a snapshot
}
export function twiceRead() {
  const rows = bundle.rows;
  return rows.length === 0 ? [] : rows.map(toCase); // ADMITTED two reads: the name saves the path
}
export function computed() {
  const first = bundle.rows[0]; // ADMITTED a computed member is a decision, not a rename
  return first;
}
export function restored() {
  const original = host.log; // ADMITTED this scope replaces the value, so the name is a moment
  host.log = () => undefined;
  try { mutate(); } finally { host.log = original; }
}
export function narrowed() {
  if (bundle.title === undefined) return () => "";
  const title = bundle.title; // ADMITTED a closure below does not keep the guard's narrowing
  return () => title.trim();
}
export function spread() {
  const extra = bundle.rows; // ADMITTED a spread is a second read, so the name saves the path
  return extra.length === 0 ? [] : ["head", ...extra];
}
`.trimStart();

const WRAPPERS = `
declare function loadOpening(dir: string): string;
declare function hashOf(value: string, salt: string): string;
declare function listRoots(): string[];
declare function trim(value: string): string;
declare function isText(value: unknown): boolean;
const OPENINGS = new Set<string>();
export function readOpening(dir: string): string { // REPORT the two names are one function
  return loadOpening(dir);
}
export function saltedHash(value: string): string {
  return hashOf(value, "anabasis"); // ADMITTED a fixed argument is a decision the wrapper makes
}
export function reordered(value: string, salt: string): string {
  return hashOf(salt, value); // ADMITTED the order is the wrapper's job
}
export function openingRoots(): string[] {
  return listRoots().map(trim).sort(); // ADMITTED no parameters, so nothing is forwarded
}
export function decodeOpening(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes); // ADMITTED a construction is not a name a caller can write
}
export function known(name: string): boolean {
  return OPENINGS.has(name); // ADMITTED this file names the receiver, so the wrapper fixes it
}
export function asText(value: number): string { // REPORT a global receiver is not the file's to fix
  return String(value);
}
export function isOpening(value: unknown): value is string {
  return isText(value); // ADMITTED a return type predicate is the narrowing, written down
}
`.trimStart();

const CONDITIONALS = `
declare const options: { width?: number };
declare const DEFAULT_WIDTH: number;
declare function use(value: number): void;
export function decided() {
  let width = DEFAULT_WIDTH; // REPORT declared with a default, decided on the next line
  if (options.width !== undefined) width = options.width;
  use(width);
}
export function accumulated() {
  let total = 0;
  if (options.width !== undefined) total += options.width; // ADMITTED an accumulation, not a decision
  use(total);
}
export function cascaded() {
  let width = DEFAULT_WIDTH;
  if (options.width !== undefined) width = options.width; // ADMITTED a later line writes it again, so this is a cascade
  if (options.width === 0) width = DEFAULT_WIDTH;
  use(width);
}
export function refined() {
  let width = DEFAULT_WIDTH;
  if (options.width !== undefined) width = width + options.width; // ADMITTED the value is built from itself
  use(width);
}
export function bothArms() {
  let width = DEFAULT_WIDTH;
  if (options.width === undefined) {
    width = DEFAULT_WIDTH;
  } else {
    width = options.width; // ADMITTED a default and two arms is a dead initialiser, owned by no-useless-assignment
  }
  use(width);
}
export function noDefault() {
  let width: number; // REPORT declared with no value and decided in both arms
  if (options.width === undefined) {
    width = DEFAULT_WIDTH;
  } else {
    width = options.width;
  }
  use(width);
}
export function oneArmOnly() {
  let width: number;
  if (options.width === undefined) width = DEFAULT_WIDTH; // ADMITTED one arm leaves the name undefined on the other path
  use(width);
}
export function elseIfChain() {
  let width: number;
  if (options.width === undefined) width = DEFAULT_WIDTH;
  else if (options.width === 0) width = 1; // ADMITTED an else-if chain is three arms, not a conditional expression
  else width = options.width;
  use(width);
}
`.trimStart();

const BOOLEANS = `
declare const row: { verified: boolean; pass: boolean | null };
export function spelledOut() {
  if (row.verified && row.pass !== null) return true; // REPORT the condition over two statements
  return false;
}
export function negated() {
  if (row.verified) { // REPORT the same shape, answering the other way round
    return false;
  }
  return true;
}
export function valued() {
  if (row.verified) return row.pass; // ADMITTED the first return is not a boolean literal
  return false;
}
export function guarded() {
  if (!row.verified) return false;
  if (row.pass === null) return false; // ADMITTED the last of a run of guards is not the condition
  return true;
}
`.trimStart();

const CHAINS = `
declare const kind: string;
declare const node: { kind: string; values: string[]; title: string };
declare function exhaustive(value: string): never;
export function weight(): number | null {
  if (kind === "verified") return 1; // REPORT three branches over one name are a table
  if (kind === "unaccepted") return 0;
  if (kind === "non-result") return null;
  return exhaustive(kind);
}
export function pair(): number {
  if (kind === "verified") return 1; // ADMITTED two branches are a decision, not a set
  if (kind === "unaccepted") return 0;
  return -1;
}
export function mixed(): number {
  if (kind === "verified") return 1;
  if (kind.length === 0) return 0; // ADMITTED not one subject
  if (kind === "non-result") return -1;
  return -2;
}
export function open(): number {
  if (kind === "verified") return 1; // ADMITTED a default not naming the subject: the set is open
  if (kind === "unaccepted") return 0;
  if (kind === "non-result") return -1;
  return -2;
}
export function narrowing(): string {
  if (node.kind === "closed") return node.values.join(","); // ADMITTED an arm reading the subject splits a union
  if (node.kind === "text") return node.title;
  if (node.kind === "empty") return "";
  throw new Error(node.kind);
}
export function wrapped(): string {
  if (kind === "verified") { // ADMITTED an arm over several lines makes a record of thunks
    return ["structured", "output"].join("-");
  }
  if (kind === "unaccepted") return "u";
  if (kind === "non-result") return "n";
  throw new Error(kind);
}
export function prefix(): number {
  if (kind === "verified") return 1; // ADMITTED part of a longer dispatch stays a chain
  if (kind === "unaccepted") return 0;
  if (kind === "non-result") return -1;
  if (kind.startsWith("x")) return -2;
  return -3;
}
`.trimStart();

const INLINE_TABLES = `
declare function use(value: unknown): void;

const atModule = { a: 1, b: 2, c: 3 }; // ADMITTED module scope is where this rule wants the table

export function keys(name: string): boolean {
  const required = ["at", "sessionId", "capability"]; // REPORT three constants this file only reads through
  return required.some((key) => key === name);
}

export function owners(kind: string): string {
  const owner = { sandbox: "environment", crash: "product", protocol: "environment" }; // REPORT a lookup read by key
  return owner[kind] ?? "unknown";
}

export function pair(name: string): boolean {
  const two = { first: "a", second: "b" }; // ADMITTED two entries is one argument written out
  return two.first === name;
}

export function derived(name: string): string {
  const carried = { given: name, fixed: "b", other: "c" }; // ADMITTED an entry closes over a parameter
  return carried.fixed;
}

export function handed(): void {
  const given = { a: 1, b: 2, c: 3 }; // ADMITTED handed to a call, which may write to it
  use(given);
}

export function shorthand(): void {
  const state = { accepted: null, attempts: 0, terminal: false }; // ADMITTED escapes as a property value
  use({ state, extra: 1 });
}

export function grown(): number {
  const rows = [1, 2, 3]; // ADMITTED written to through a mutating method
  rows.push(4);
  return rows.length;
}

export function written(): number {
  const counts = { a: 1, b: 2, c: 3 }; // ADMITTED assigned through
  counts.a = 2;
  return counts.a;
}

export function nested(): number {
  const groups = { a: [1, 2], b: [3], c: [4] }; // ADMITTED an entry that can be handed out or written to
  return groups.b.length;
}

export function asserted(kind: string): boolean {
  const kinds = ["sandbox", "crash", "protocol"] as const; // REPORT the assertion is not what is declared
  return kinds.some((entry) => entry === kind);
}
`.trimStart();

const TERNARIES = `
declare const passes: number;
declare const floor: number;
declare const ceiling: number;
declare const toAim: number;
declare const admissible: boolean;
declare const move: string;
declare const left: number;
declare const right: number;
declare const signal: string | null;

export const compare = left < right ? -1 : left > right ? 1 : 0; // ADMITTED three cases along the tail is what a compare reads like
export const zone = passes < floor ? "too-hard" : passes > ceiling ? "too-easy" : toAim > 0 ? "under-aim" : "on-aim"; // REPORT four cases: the last one is what is left after three rejected conditions
export const outcome = admissible ? (move === "build" ? "adopted" : "candidate") : "build-failed"; // REPORT nested in the consequent, so the final colon belongs to the first test
export const flag = (admissible ? move === "build" : false) ? "yes" : "no"; // REPORT nested in the test, so a branch is evaluated before the reader knows what is branched on
export const ending = signal !== null ? "died" : passes === 0 ? "could not start" : "exited"; // ADMITTED the inverted form of the same three outcomes
export const guarded = admissible ? "adopted" : (move === "build" ? "candidate" : "build-failed"); // ADMITTED parenthesised, but still the tail
export const behind = admissible ? String(move === "build" ? 1 : 2) : "none"; // ADMITTED a call argument is a boundary the reader stops at
`.trimStart();

describe("the simplify shape catchers", () => {
  it("reads two arms differing in one term, with or without an else", () => {
    pins("no-arms-differing-in-one-term", ARMS, 4);
  });

  it("reads a third spelling of one object literal", () => {
    pins("no-thrice-spelled-object", OBJECTS, 1);
  });

  it("waits for a fifth spelling in a test, where the literal is usually the case being read", () => {
    const expected = expectedLines(TEST_OBJECTS);
    expect(expected).toHaveLength(1);
    expect(reportedLines("ana", "no-thrice-spelled-object", TEST_OBJECTS, "owner.test.ts")).toStrictEqual(
      expected,
    );
  });

  it("reads an argument the callee already holds inside another", () => {
    pins("no-argument-already-carried", CARRIED, 1);
  });

  it("reads a temporary that renames and is read on the next line", () => {
    pins("no-renaming-temporary", TEMPORARIES, 1);
  });

  it("reads a function whose body only forwards its parameters", () => {
    pins("no-pass-through-wrapper", WRAPPERS, 2);
  });

  it("reads a let the next if decides, with a default or with both arms", () => {
    pins("prefer-const-conditional", CONDITIONALS, 2);
  });

  it("reads a condition spelled as two boolean returns, either way round", () => {
    pins("prefer-condition-over-boolean-returns", BOOLEANS, 2);
  });

  it("reads three branches comparing one name against literals", () => {
    pins("prefer-lookup-over-equality-chain", CHAINS, 1);
  });

  it("reads a constant table inside a function, and nothing the file could write to", () => {
    pins("no-inline-schema-literal", INLINE_TABLES, 3);
  });

  it("reads a ternary tail past three cases, and one grown anywhere but the tail", () => {
    pins("no-tangled-ternary", TERNARIES, 3);
  });

  it("says nothing about a fixture in a test file", () => {
    expect(reportedLines("ana", "no-inline-schema-literal", INLINE_TABLES, "owner.test.ts")).toStrictEqual(
      [],
    );
  });
});

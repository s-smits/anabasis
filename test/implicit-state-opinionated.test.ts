/**
 * The opinionated implicit-state tier: the plugin `implicit-state-opinionated`
 * (`max-boolean-fields`, `prefer-state-union`, `no-state-in-names`) and the cross-file kind
 * `no-unowned-state-literals` of `tools/oxlint/tree-implicit-state.ts`. Every fixture is a small foreign program, and each rule's
 * nearest hostile case sits beside the shape it reports: optional settings, brands and two flags
 * beside three required ones; flags the same handlers move together beside a lifecycle, a default
 * beside a derived flag; an extension capture, a predicate with no capture and a log line beside a
 * parsed name; a declared union beside the same literals declared nowhere.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";
import { lintRules } from "./helpers/lint-rule.ts";

const FLAGS = `import { useState } from "react";
export interface Upload { // REPORT four required flags spell one state
  pending: boolean;
  sending: boolean;
  sent: true | false;
  failed: boolean | undefined;
}
export interface BuildOptions { // ADMITTED optional settings are independent choices
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
  emptyOutDir?: boolean;
}
export interface Plugin { // ADMITTED two flags and two string unions
  enforce: "pre" | "post";
  apply: "serve" | "build";
  dev: boolean;
  ssr: boolean;
}
export interface Procedure { // ADMITTED a brand typed as one literal is no flag
  procedure: true;
  query: boolean;
  mutation: boolean;
}
export class Namespace { // ADMITTED fields that never move are no flags
  declare isNamespace: true;
  readonly isCluster = false;
  readonly lazy: boolean = true;
  deoptimized = false;
}
export class Declarator { // REPORT readonly and declared flags the constructor computes still count
  readonly isUsing: boolean;
  readonly isAwaitUsing: boolean;
  declare isConst: boolean;
  constructor(kind: string) {
    this.isUsing = kind === "using";
    this.isAwaitUsing = kind === "await using";
    this.isConst = kind === "const";
  }
}
export class Dialog { // REPORT four boolean fields
  open = false;
  closing = false;
  closed = true;
  dragging: boolean = false;
}
export function Uploader() { // REPORT four boolean useState cells
  const [isLoading, setLoading] = useState(false);
  const [isError, setError] = useState(false);
  const [isSuccess, setSuccess] = useState(false);
  const [isIdle, setIdle] = useState<boolean>(true);
  return [isLoading, isError, isSuccess, isIdle, setLoading, setError, setSuccess, setIdle];
}
export interface Played { // ADMITTED each flag observed from its own source
  timedOut: boolean;
  turnsEnded: boolean;
  moved: boolean;
}
export const played = (clock: AbortSignal, turns: number[], most: number, stamp: () => string, before: string): Played => ({
  timedOut: clock.aborted,
  turnsEnded: turns.length >= most,
  moved: stamp() !== before,
});
export interface Lane { // ADMITTED tags read from one set, one key each
  standing: boolean;
  alone: boolean;
  blind: boolean;
}
export const lane = (marks: Set<string>): Lane => ({
  standing: marks.has("standing"),
  alone: marks.has("alone"),
  blind: marks.has("blind"),
});
export interface Stored { // ADMITTED the shape of a file another writer laid down
  timedOut: boolean;
  present: boolean;
  parses: boolean;
}
export const stored = (text: string) => parseJsonAs<Stored>(text);
export interface Cast { // ADMITTED the same, cast from a parse
  timedOut: boolean;
  present: boolean;
  parses: boolean;
}
export const cast = (text: string) => JSON.parse(text) as Cast;
export interface Loaded { // REPORT a generic call that parses nothing is no file's shape
  timedOut: boolean;
  present: boolean;
  parses: boolean;
}
export const loaded = () => load<Loaded>();
export interface Row { // REPORT flags projected from one state
  writer: boolean;
  keeper: boolean;
  quiet: boolean;
}
export const row = (state: { kind: string; kept?: boolean }): Row => {
  const writer = "kept" in state;
  return { writer, keeper: writer ? state.kept === true : state.kind === "kept", quiet: state.kind === "quiet" };
};
export interface Phase { // REPORT built only from constants, which shows nothing
  open: boolean;
  closing: boolean;
  closed: boolean;
}
export const opened = (): Phase => ({ open: true, closing: false, closed: false });
export interface Mixed { // REPORT one literal apart, another from one value
  ready: boolean;
  busy: boolean;
  done: boolean;
}
export const apart = (a: boolean, b: boolean, c: boolean): Mixed => ({ ready: a, busy: b, done: c });
export const together = (phase: string): Mixed => ({ ready: phase === "ready", busy: phase === "busy", done: phase === "done" });
export function draw(fill: boolean, stroke: boolean, shadow: boolean, dashed = false) { // REPORT four boolean parameters
  return [fill, stroke, shadow, dashed];
}
export function line(fill: boolean, stroke: boolean, shadow: boolean) { // ADMITTED three is the limit
  return [fill, stroke, shadow];
}
`;

const LIFECYCLES = `export class Container { // REPORT a lifecycle: two flags moved by different methods
  private started = false;
  private closed: boolean = false;
  constructor(private readonly name: string) {}
  start(): void {
    if (this.closed) throw new Error(this.name);
    this.started = true;
  }
  close = (): void => {
    this.closed = true;
  };
}
export class Keys { // ADMITTED modifier keys the same handlers move together
  shift = false;
  alt = false;
  down(event: { shiftKey: boolean; altKey: boolean }): void {
    this.shift = event.shiftKey;
    this.alt = event.altKey;
  }
  up(event: { shiftKey: boolean; altKey: boolean }): void {
    this.shift = event.shiftKey;
    this.alt = event.altKey;
  }
}
export class Environment { // ADMITTED configuration only the constructor sets, beside one moved flag
  skipFsCheck: boolean;
  watching = false;
  closing = false;
  constructor(skip: boolean) {
    this.skipFsCheck = skip;
    this.watching = !skip;
  }
  close(): void {
    this.closing = true;
  }
}
export interface Element { // ADMITTED independent properties of a record are a type, not a phase
  isDeleted: boolean;
  locked: boolean;
  frozen: boolean;
}
export const isOver = (h: boolean, v: boolean): { either: boolean; horizontal: boolean; vertical: boolean } => { // REPORT a flag derived from two others
  const either = h || v;
  return { either, horizontal: h, vertical: v };
};
export function cut(code: number, signal: string | null) {
  return { ok: code === 0, killed: signal !== null, failed: code !== 0 && signal !== null }; // ADMITTED derived from no field of the record
}
export function settle(code: number) {
  const ok = code === 0;
  const late = !ok;
  return { ok, late, done: ok || late }; // REPORT derived through consts from two flags
}
export function label(title: string, name: string) {
  return { title, name, shown: title || name }; // ADMITTED a default, not a flag
}
export function open(options: { minify: boolean; sourcemap: boolean }) {
  return { minify: options.minify, sourcemap: options.sourcemap, watch: false }; // ADMITTED independent options
}
`;

const NAMES = `import { basename } from "node:path";
const PULL = /pr(\\d+)/u;
export interface Deploy { name: string; branch: string; file: string; log: string }
export function pullOf(deploy: Deploy): number {
  return Number(PULL.exec(deploy.name)?.[1]); // REPORT a number read back out of a name
}
export function ticketOf(deploy: Deploy): string {
  return /^(?<ticket>[A-Z]+-\\d+)/u.exec(deploy.branch)?.groups?.ticket ?? ""; // REPORT through a named group
}
export function stemOf(path: string): string {
  const found = basename(path).match(/^(.+)-\\d+$/u); // REPORT a name from basename()
  return found === null ? "" : (found[1] ?? "");
}
export function kindOf(deploy: Deploy): string {
  return /\\.(png|svg)$/u.exec(deploy.file)?.[1] ?? ""; // ADMITTED the extension is the file system's field
}
export function isPreview(deploy: Deploy): boolean {
  return /^preview-(\\d+)/u.test(deploy.name); // ADMITTED a predicate reads no capture
}
export function codeOf(deploy: Deploy): string {
  return /error (\\w+)/u.exec(deploy.log)?.[1] ?? ""; // ADMITTED a log line is no name
}
export function numbers(deploy: Deploy): string[] {
  return deploy.name.match(/(\\d+)/gu) ?? []; // ADMITTED a global match captures nothing
}
export function proxied(deploy: Deploy): number {
  return Number(/\\?html-proxy&index=(\\d+)/u.exec(deploy.name)?.[1]); // ADMITTED a URL query is a protocol written to be parsed
}
export function skipped(deploy: Deploy): string {
  return /^([^/]+)\\//u.exec(deploy.file)?.[1] ?? ""; // ADMITTED a file path split is path arithmetic
}
export function whole(deploy: Deploy): string {
  return /pr(\\d+)/u.exec(deploy.name)?.[0] ?? ""; // ADMITTED the whole match is the name itself
}
export function installRoot(path: string): string {
  return /^(.*\\/)?[^/]+\\.(dist-info|libs)\\//u.exec(path)?.[1] ?? ""; // ADMITTED a path's folders beside a tool's fixed words
}
export function runRoot(path: string): string {
  return /^(.*\\/)?run-(\\d+)\\//u.exec(path)?.[1] ?? ""; // REPORT a number in the name beside the folders
}
export function stepOf(task: string): number {
  const [, name = ""] = task.split("/");
  return Number(/^task(\\d+)$/u.exec(name)?.[1]); // ADMITTED a segment of an identifier split apart
}
export function laterOf(deploy: Deploy, names: (deploy: Deploy) => string[]): number {
  const [name = ""] = names(deploy);
  return Number(/^task(\\d+)$/u.exec(name)?.[1]); // REPORT a name destructured from no split
}
`;

const BOARD = `export const done = (status: string): boolean => status === "closed" || status === "merged";\n`;
const ISSUES = `export const shut = (issue: { status: string }): boolean =>
  issue.status === "closed" || issue.status === "merged";
export function close(issue: { status: string }): void {
  issue.status = "closed";
}
`;
const DECLARED = `export type IssueStatus = "open" | "closed" | "merged";\n`;
const PLATFORM = `export const unix = (os: string): boolean => os === "linux" || os === "darwin";\n`;

const findings = (files: Record<string, string>, kind = "no-unowned-state-literals"): string[] =>
  implicitStateFindings(new Map(Object.entries(files)))
    .filter((row) => row.kind === kind)
    .map((row) => `${row.path}:${row.line} ${(row.places ?? []).map((place) => place.path).join(" ")}`);

describe("the opinionated implicit-state rules", () => {
  it("report only the marked lines", async () => {
    await lintRules("implicit-state-opinionated", [
      ["max-boolean-fields", FLAGS, 9, "src/upload.tsx"],
      ["max-boolean-fields", FLAGS, 0, "src/upload.test.tsx"],
      ["prefer-state-union", LIFECYCLES, 3, "src/lifecycle.ts"],
      ["prefer-state-union", LIFECYCLES, 0, "src/lifecycle.test.ts"],
      ["no-state-in-names", NAMES, 5, "src/deploy.ts"],
    ]);
  });
});

describe("no-unowned-state-literals", () => {
  it("is reported where two files group the same literals that nothing declares", () => {
    expect(findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES })).toEqual([
      "src/board.ts:1 src/board.ts src/issues.ts",
    ]);
  });

  it("is not reported once a type declares the states, for one file, or for a test", () => {
    expect(findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES, "src/issue.ts": DECLARED })).toEqual(
      [],
    );
    expect(findings({ "src/board.ts": BOARD, "src/platform.ts": PLATFORM })).toEqual([]);
    expect(
      findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES.replace(/export function close[^]*/u, "") }),
    ).toEqual([]);
    expect(
      findings(
        { "src/board.ts": BOARD, "src/issues.ts": ISSUES.replace(/export function close[^]*/u, "") },
        "no-scattered-enum-literals",
      ),
    ).toEqual(["src/board.ts:1 src/board.ts src/issues.ts"]);
    expect(findings({ "src/board.ts": BOARD, "test/issues.test.ts": ISSUES })).toEqual([]);
  });
});

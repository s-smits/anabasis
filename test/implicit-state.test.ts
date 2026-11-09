/**
 * The generic implicit-state tier: the plugin `implicit-state` (`excessive-bools`, `mtime-as-lock`,
 * `files-as-phase`) and the two cross-file kinds of `tools/oxlint/tree-implicit-state.ts`
 * (`state-literal-spread`, `repeated-external-read`). Every fixture is a small foreign program, a
 * React form, an Express job runner with lock files, and each rule's nearest hostile case sits
 * beside the shape it reports: optional settings beside required flags, a "newer than" beside an
 * age, one guard beside a phase, an exhaustive switch beside a hand grouping, a polling loop and a
 * memoised read beside a repeated one.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";
import { lintRules } from "./helpers/lint-rule.ts";

const BOOLS = `import { useState } from "react";
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
export interface Plugin { // ADMITTED a string union is not a flag
  enforce: "pre" | "post";
  apply: "serve" | "build";
  dev: boolean;
  ssr: boolean;
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
export function draw(fill: boolean, stroke: boolean, shadow: boolean, dashed = false) { // REPORT four boolean parameters
  return [fill, stroke, shadow, dashed];
}
export function line(fill: boolean, stroke: boolean, shadow: boolean) { // ADMITTED three is the limit
  return [fill, stroke, shadow];
}
`;

const LOCKS = `import { rmSync, statSync } from "node:fs";
const STALE_MS = 60_000;
export function clearStale(lock: string): void {
  if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock); // REPORT an age against a constant
  if (statSync(lock).mtimeMs < Date.now() - STALE_MS) rmSync(lock); // REPORT the same age turned round
}
export function newer(file: string, lastRun: number): boolean {
  return statSync(file).mtimeMs > lastRun; // ADMITTED newer than, a cache question
}
export function expired(started: number, limit: number): boolean {
  return Date.now() - started > limit; // ADMITTED an elapsed time that reads no file
}
export function old(file: string, days: number): boolean {
  return Date.now() - statSync(file).mtimeMs > days * 86_400_000; // ADMITTED a window the caller passes
}
`;

const PHASES = `import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export function phaseOf(jobDir: string): string {
  if (existsSync(join(jobDir, "done.json"))) return "done";
  return existsSync(join(jobDir, "started.json")) ? "running" : "queued"; // REPORT two files of one folder decide the phase
}
const present = (path: string): boolean => existsSync(path);
export function wrapped(jobDir: string): boolean {
  if (present(\`\${jobDir}/lock\`)) return true;
  return present(\`\${jobDir}/report.json\`); // REPORT through a wrapper that reduces to existsSync
}
export function ensure(jobDir: string): void {
  if (!existsSync(jobDir)) mkdirSync(jobDir); // ADMITTED a single guard
}
export function apart(jobDir: string, cacheDir: string): boolean {
  return existsSync(join(jobDir, "done.json")) && existsSync(join(cacheDir, "hit.json")); // ADMITTED two folders
}
`;

const OWNER = `export type JobState = "queued" | "running" | "done" | "failed";\n`;
const GROUPS = `import type { JobState } from "./job.ts";
export const ended = (state: JobState): boolean => state === "done" || state === "failed";
`;
const LISTED = `import type { JobState } from "./job.ts";
export const settled = (state: JobState): boolean => ["done", "failed"].includes(state);
`;
const WHOLE = `import type { JobState } from "./job.ts";
export const known = (state: JobState): boolean =>
  state === "queued" || state === "running" || state === "done" || state === "failed";
`;
/** A write the compiler types as \`JobState\` under another name than the readers compare. */
const RUNS = `import type { JobState } from "./job.ts";
export function finish(job: { phase: JobState }): void {
  job.phase = "done";
}
`;
/** A write of one of the literals into a place that is neither typed by the set nor so named. */
const LABELS = `export function tag(entry: { label: string }): void {
  entry.label = "done";
}
`;
const COVERS = `import type { JobState } from "./job.ts";
export function label(state: JobState): string {
  switch (state) {
    case "queued":
    case "running":
      return "open";
    case "done":
    case "failed":
      return "closed";
  }
}
`;

const PROCS = `import { execFileSync } from "node:child_process";
export function table(): string {
  return execFileSync("ps", ["-o", "pid,command"], { encoding: "utf8" });
}
export function alive(pid: number): boolean {
  return table().includes(String(pid));
}
export function holder(pid: number): string {
  return table().split("\\n").find((row) => row.includes(String(pid))) ?? "";
}
let cached: string | null = null;
export function tableOnce(): string {
  if (cached === null) cached = table();
  return cached;
}
`;
const RUNNER = `import { alive, holder, table, tableOnce } from "./procs.ts";
export function release(pid: number): void {
  if (alive(pid) && holder(pid) !== "") process.kill(pid);
}
export async function waitFor(pid: number): Promise<void> {
  while (alive(pid)) await Bun.sleep(100);
}
export function remembered(): number {
  return tableOnce().length + tableOnce().length;
}
export function either(full: boolean): string {
  if (full) return table();
  return table().slice(0, 10);
}
export function each(pids: readonly number[]): boolean[] {
  return pids.map((pid) => table().includes(String(pid)));
}
export function perItem(pids: readonly number[]): boolean[] {
  return pids.map((pid) => alive(pid));
}
`;

const findings = (kind: string, files: Record<string, string>): string[] =>
  implicitStateFindings(new Map(Object.entries(files)))
    .filter((row) => row.kind === kind)
    .map(
      (row) =>
        `${row.path}:${row.line} ${(row.places ?? []).map((place) => `${place.path}:${place.line}`).join(" ")}`,
    );

describe("the implicit-state rules", () => {
  it("report only the marked lines", async () => {
    await lintRules("implicit-state", [
      ["excessive-bools", BOOLS, 4, "src/upload.tsx"],
      ["mtime-as-lock", LOCKS, 2, "src/locks.ts"],
      ["files-as-phase", PHASES, 2, "src/phases.ts"],
      ["excessive-bools", BOOLS, 0, "src/upload.test.tsx"],
    ]);
  });
});

describe("state-literal-spread", () => {
  const jobs = { "src/job.ts": OWNER, "src/a.ts": GROUPS, "src/b.ts": LISTED };

  it("is reported at the owner of states two other files group by hand and one writes", () => {
    expect(findings("state-literal-spread", { ...jobs, "src/run.ts": RUNS })).toEqual([
      "src/job.ts:1 src/job.ts:1 src/a.ts:2 src/b.ts:2",
    ]);
  });

  it("counts a chain that spells the whole set, which a switch over it does not", () => {
    const whole = { "src/job.ts": OWNER, "src/a.ts": WHOLE, "src/b.ts": WHOLE, "src/run.ts": RUNS };
    expect(findings("state-literal-spread", whole)).toEqual([
      "src/job.ts:1 src/job.ts:1 src/a.ts:3 src/b.ts:3",
    ]);
  });

  it("reads a set no update writes, or one written into another place, as an enumeration", () => {
    const enumeration = ["src/job.ts:1 src/job.ts:1 src/a.ts:2 src/b.ts:2"];
    expect(findings("state-literal-spread", jobs)).toEqual([]);
    expect(findings("enumeration-literal-spread", jobs)).toEqual(enumeration);
    expect(findings("enumeration-literal-spread", { ...jobs, "src/tag.ts": LABELS })).toEqual(enumeration);
  });

  it("is not reported for one reader, an exhaustive switch, an unexported set or a test", () => {
    const local = OWNER.replace("export ", "");
    expect(
      findings("state-literal-spread", {
        "src/job.ts": OWNER,
        "src/a.ts": GROUPS,
        "src/c.ts": COVERS,
        "src/run.ts": RUNS,
      }),
    ).toEqual([]);
    expect(
      findings("state-literal-spread", { "src/job.ts": local, "src/a.ts": GROUPS, "src/b.ts": LISTED }),
    ).toEqual([]);
    expect(
      findings("state-literal-spread", { "src/job.ts": OWNER, "src/a.ts": GROUPS, "test/b.test.ts": LISTED }),
    ).toEqual([]);
  });
});

describe("repeated-external-read", () => {
  it("is reported where one path reads the same command twice through wrappers in another file", () => {
    const rows = findings("repeated-external-read", { "src/procs.ts": PROCS, "src/runner.ts": RUNNER });
    expect(rows).toEqual(["src/runner.ts:3 src/runner.ts:3", "src/runner.ts:16 src/runner.ts:16"]);
  });

  it("is not reported for a polling loop, a memoised read, two branches that each read once or a read of each item", () => {
    const rows = implicitStateFindings(
      new Map([
        ["src/procs.ts", PROCS],
        ["src/runner.ts", RUNNER],
      ]),
    );
    const names = rows.map((row) => row.detail.split(" ")[0]);
    expect(names).not.toContain("`waitFor`");
    expect(names).not.toContain("`remembered`");
    expect(names).not.toContain("`either`");
    expect(names).not.toContain("`perItem`");
  });
});

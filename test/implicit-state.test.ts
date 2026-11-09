/**
 * The generic implicit-state tier: the plugin `implicit-state` (`co-assigned-flags`, `mtime-as-lock`,
 * `files-as-phase`) and the two cross-file kinds of `tools/oxlint/tree-implicit-state.ts`
 * (`state-literal-spread`, `repeated-external-read`). Every fixture is a small foreign program, a
 * React form, an Express job runner with lock files, and each rule's nearest hostile case sits
 * beside the shape it reports: a "newer than" beside an age, one guard beside a phase, an
 * exhaustive switch beside a hand grouping, a polling loop and a memoised read beside a repeated
 * one.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";
import { lintRules } from "./helpers/lint-rule.ts";

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
export function recent(files: readonly string[]): string[] {
  return files.filter((file) => Date.now() - statSync(file).mtimeMs < STALE_MS); // ADMITTED an age that only selects what a report shows
}
export function lapsed(lock: string): boolean {
  return Date.now() - statSync(lock).mtimeMs > STALE_MS; // ADMITTED nothing is taken over on it
}
export function takeOver(lock: string, holder: number): void {
  const release = (): void => rmSync(lock);
  try {
    if (statSync(lock).mtimeMs < Date.now() - STALE_MS) throw new Error("stale"); // REPORT through a release of this file
  } catch {
    release();
  }
  if (Date.now() - statSync(lock).mtimeMs > STALE_MS) process.kill(holder); // REPORT a holder signalled on its age
}
`;

const MODES = `import { useState } from "react";
export function Loader() {
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  async function load() {
    setIsLoading(true); // REPORT three setters, at most one set each time
    setIsError(false);
    setIsSuccess(false);
    try {
      await fetch("/data");
      setIsLoading(false);
      setIsSuccess(true);
      setIsError(false);
    } catch {
      setIsLoading(false);
      setIsError(true);
      setIsSuccess(false);
    }
  }
  return [isLoading, isError, isSuccess, load];
}
export class Canvas {
  state = { isResizing: false, isRotating: false, editingElement: null as string | null };
  setState(next: Partial<Canvas["state"]>) {
    this.state = { ...this.state, ...next };
  }
  resize() {
    this.setState({ isResizing: true, isRotating: false, editingElement: null }); // REPORT a drawing tool's mode
  }
  rotate() {
    this.setState({ isResizing: false, isRotating: true, editingElement: null });
  }
  edit(element: string) {
    this.setState({ isResizing: false, isRotating: false, editingElement: element });
  }
  idle() {
    this.setState({ isResizing: false, isRotating: false, editingElement: null });
  }
}
export function build(run: (options: object) => void) {
  run({ minify: true, sourcemap: false }); // ADMITTED options created whole are independent choices
  run({ minify: false, sourcemap: true });
  run({ minify: true, sourcemap: false });
}
export function track(point: { x: number; y: number }, setPoint: (next: object) => void) {
  setPoint({ ...point, x: 1, y: 2 }); // ADMITTED both fields set together, no mode
  setPoint({ ...point, x: 3, y: 0 });
  setPoint({ ...point, x: 5, y: 8 });
}
export function clear(store: { open: boolean; dirty: boolean }) {
  store.open = false; // ADMITTED a reset clears every field and shows no mode
  store.dirty = false;
}
export function clearAgain(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
export function clearOnce(store: { open: boolean; dirty: boolean }) {
  store.open = false;
  store.dirty = false;
}
`;

const UNCOUNTED_MODES = `export class Tool {
  setState(next: object) {
    return next;
  }
  start(handle: string | null) {
    this.setState({ // REPORT complementary comparisons of one handle
      isResizing: handle !== null && handle !== "rotation",
      isRotating: handle === "rotation",
    });
  }
}
export function kinds(kind: string, other: string) {
  const one = { isFile: kind === "file", isDir: kind === "dir" }; // REPORT one subject equal to two literals
  const two = { isFile: kind === "file", isLink: other === "link" }; // ADMITTED two subjects
  const three = { ready: kind !== "", named: kind !== "anon" }; // ADMITTED both can hold
  return [one, two, three];
}
export function origins(digest: string) {
  return [
    { digest, imported: false, frozen: false },
    { digest, imported: true, frozen: false }, // REPORT opposite literals, never both set
    { digest, imported: false, frozen: true },
  ];
}
export function marks(digest: string) {
  return [
    { digest, open: true, dirty: false }, // ADMITTED both set in another object
    { digest, open: false, dirty: true },
    { digest, open: true, dirty: true },
  ];
}
`;

const PHASES = `import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
export function init(base: string, template: string): void {
  if (existsSync(join(base, "config.json"))) return;
  writeFileSync(join(base, "config.json"), "{}");
  if (!existsSync(join(base, "README.md"))) copyFileSync(template, resolve(base, "README.md")); // ADMITTED create if missing converges on a rerun
}
export function vet(dir: string): string | null {
  if (!existsSync(join(dir, "vetting.md"))) return "step: vet";
  return existsSync(join(dir, "marker")) ? null : "step: mark"; // REPORT a negated check that writes nothing is still a phase
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
async function settle(): Promise<void> {
  await Bun.sleep(1000);
}
export async function afterWait(pid: number): Promise<boolean> {
  const before = alive(pid);
  await settle();
  return before && alive(pid);
}
export function afterKill(pid: number): boolean {
  if (!alive(pid)) return false;
  process.kill(pid, "SIGTERM");
  return alive(pid);
}
export function afterNote(pid: number): boolean {
  const before = alive(pid);
  writeFileSync("/tmp/note", "seen");
  return before && alive(pid);
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
      ["mtime-as-lock", LOCKS, 4, "src/locks.ts"],
      ["files-as-phase", PHASES, 3, "src/phases.ts"],
      ["co-assigned-flags", MODES, 2, "src/modes.tsx"],
      ["co-assigned-flags", UNCOUNTED_MODES, 3, "src/shapes.ts"],
      ["co-assigned-flags", MODES, 0, "src/four.tsx", { fields: 4 }],
      ["co-assigned-flags", MODES, 0, "src/many.tsx", { writes: 5 }],
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
  it("is reported where one path reads the same command twice through wrappers in another file, a write of another file between", () => {
    const rows = findings("repeated-external-read", { "src/procs.ts": PROCS, "src/runner.ts": RUNNER });
    expect(rows).toEqual([
      "src/runner.ts:3 src/runner.ts:3",
      "src/runner.ts:16 src/runner.ts:16",
      "src/runner.ts:35 src/runner.ts:35 src/runner.ts:37",
    ]);
  });

  it("is not reported for a polling loop, a memoised read, two branches that each read once, a read of each item, or a re-read after a wait or a signal", () => {
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
    expect(names).not.toContain("`afterWait`");
    expect(names).not.toContain("`afterKill`");
  });
});

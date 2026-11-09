/**
 * `second-reader` (`tools/oxlint/tree-second-reader.ts`): a fact an exported function returns,
 * derived again by hand in another file. The fixture is a small foreign job runner. Beside the two
 * hand spellings it reports (one with other arguments, one negated) sit its nearest hostile cases:
 * the owner's own file, a caller of the owner, a test, a fact nobody owns, a one-field test, a
 * grouping of one subject's literals, a generic predicate read on another field and a helper
 * declared inside an exported function. The second shape, a fold spelled again, is a scan of an
 * event list for one kind that reads every field an exported fold's scan reads; beside it sit a
 * `forEach` over the same kind, a scan reading fewer fields and a `map` that rewrites events.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";

const OWNER = `import { keepersOf, writersOf } from "./procs.ts";
import { isRecord, isString } from "./guards.ts";
export function isRunning(run: Run, procs: Proc[]): boolean {
  return writersOf(run, procs).length > 0 || keepersOf(run.name).length > 0;
}
export const isBlocked = (task: Task) => task.waiting.length > 0 && !task.forced;
export const isBuild = (task: Task) => task.kind === "build";
export const isEnded = (job: Job) => job.state === "done" || job.state === "failed";
export const isNode = (value: unknown) => isRecord(value) && isString(value["type"]);
export function retry(run: Run, procs: Proc[]): void { // ADMITTED the owner's own file
  if (writersOf(run, procs).length > 0 || keepersOf(run.name).length > 0) return;
  restart(run);
}
`;
const RETIRE = `import { keepersOf, listProcs, writersOf } from "./procs.ts";
export function retire(run: Run, name: string): void {
  if (writersOf(run, listProcs()).length > 0 || keepersOf(name).length > 0) { // REPORT
    return;
  }
  archive(run);
}
`;
const QUEUE = `export function next(tasks: Task[]): Task | undefined {
  return tasks.find((task) => task.waiting.length <= 0 || task.forced); // REPORT the negation
}
`;
const CALLER = `import { isRunning, isBuild, isEnded } from "./runs.ts";
import { isRecord, isString } from "./guards.ts";
export function sweep(run: Run, procs: Proc[], task: Task, job: Job, row: unknown): boolean {
  if (isRunning(run, procs)) return false; // ADMITTED calls the owner
  const build = task.kind === "build"; // ADMITTED a one-field test
  const ended = job.state === "done" || job.state === "failed"; // ADMITTED one subject's literals
  const shaped = isRecord(row) && isString(row.cwd); // ADMITTED another field than the owner's
  const late = job.started + job.timeout < job.now && job.owner !== job.reader; // ADMITTED no owner
  return build && ended && shaped && late;
}
`;
const OTHER = `export function overdue(job: Job): string {
  return job.started + job.timeout < job.now && job.owner !== job.reader ? "late" : "on time";
}
`;
const PLUGIN = `import { isData, isExternal } from "./urls.ts";
export function htmlPlugin(): (url: string) => boolean {
  const isExcluded = (url: string) => url[0] === "#" || isExternal(url) || isData(url);
  return isExcluded;
}
`;
const CSS = `import { isData, isExternal } from "./urls.ts";
export function rewrite(url: string): string {
  return !isExternal(url) && !isData(url) && url[0] !== "#" ? "./" + url : url; // ADMITTED no exported owner
}
`;
const FOLDS = `export function rulingsOf(events: Event[]): Map<string, string> {
  return new Map(
    events.flatMap(({ kind, data }) => (kind === "finding" && isString(data.solve) ? [[data.solve, data.ruling]] : [])),
  );
}
export function relabel(events: Event[]): Event[] {
  return events.map((event) => (event.kind === "verdict" ? { ...event, data: { ...event.data, solve: "", label: "" } } : event));
}
`;
const AUDIT = `export function audit(events: Event[], solve: string): void {
  const ruling = events.findLast(({ kind, data }) => kind === "finding" && data.solve === solve)?.data.ruling; // REPORT
  const ruled = events.some(({ kind, data }) => kind === "finding" && data.solve === solve); // ADMITTED reads one field
  events.forEach((event) => {
    if (event.kind === "finding") tally(event.data.solve, event.data.ruling); // ADMITTED acts on each
  });
  const relabelled = events.filter((event) => event.kind === "verdict" && event.data.solve !== event.data.label); // ADMITTED map owns nothing
  print(ruling, ruled, relabelled);
}
`;
const TEST = `import { keepersOf, writersOf } from "../src/procs.ts";
it("retires", () => {
  expect(writersOf(run, procs).length > 0 || keepersOf(run.name).length > 0).toBe(false); // ADMITTED a test
});
`;

const rows = implicitStateFindings(
  new Map([
    ["src/runs.ts", OWNER],
    ["src/retire.ts", RETIRE],
    ["src/queue.ts", QUEUE],
    ["src/sweep.ts", CALLER],
    ["src/late.ts", OTHER],
    ["src/plugin.ts", PLUGIN],
    ["src/css.ts", CSS],
    ["src/folds.ts", FOLDS],
    ["src/audit.ts", AUDIT],
    ["test/retire.test.ts", TEST],
  ]),
).filter((row) => row.kind === "second-reader");

describe("second-reader", () => {
  it("is reported where another file spells an owner's returned fact, with other arguments, negated or as a fold's scan", () => {
    expect(rows.map((row) => `${row.path}:${String(row.line)}`)).toEqual([
      "src/retire.ts:3",
      "src/queue.ts:2",
      "src/audit.ts:2",
    ]);
  });

  it("names the owner and how many files spell its fact by hand", () => {
    expect(rows.map((row) => /`(?<owner>\w+)` in (?<path>[^\s,]+)/u.exec(row.detail)?.groups)).toEqual([
      { owner: "isRunning", path: "src/runs.ts" },
      { owner: "isBlocked", path: "src/runs.ts" },
      { owner: "rulingsOf", path: "src/folds.ts" },
    ]);
    expect(rows.map((row) => /in (\d+) files?/u.exec(row.detail)?.[1])).toEqual(["1", "1", "1"]);
  });

  it("is not reported in the owner's file, a caller, a test, or for one-field tests, literal groupings and other fields", () => {
    expect(
      rows.filter((row) => !["src/retire.ts", "src/queue.ts", "src/audit.ts"].includes(row.path)),
    ).toEqual([]);
  });
});

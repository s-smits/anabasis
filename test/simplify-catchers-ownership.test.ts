/**
 * The simplify catchers that read a file rather than an expression: an alias with one mention, a
 * second owner of process lifetime, a pyramid of conditions, and one string spelled four times.
 *
 * These are the catchers whose answer depends on where the file is. Two of them exempt a path —
 * the lifetime owners, the test tree — so a fixture that does not say where it lives would pass
 * while reporting nothing, and each test places its fixture in the tree on purpose.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/** Report the fixture's own `// REPORT` lines and nothing else, from a named place in the tree. */
function pins(rule: string, fixture: string, count: number, at = "src/run/fixture.ts"): void {
  const expected = expectedLines(fixture);
  expect(expected).toHaveLength(count);
  expect(reportedLines("ana", rule, fixture, at)).toStrictEqual(expected);
}

const ALIASES = `
declare interface Metrics { tools: { byName: string[]; calls: number }; runs: number }

type Census = Omit<Metrics["tools"], "byName">; // REPORT one mention, and the contract is already named
export function census(): Census {
  return { calls: 0 };
}

type Shared = Map<string, number>; // ADMITTED two mentions: the name is carrying the value about
export function first(): Shared {
  return new Map();
}
export function sizeOf(value: Shared): number {
  return value.size;
}

export type Published = Set<string>; // ADMITTED exported: its readers are in other files
export function when(): Published {
  return new Set();
}

type Answer = { state: "absent" } | { state: "read"; raw: string }; // ADMITTED a set of answers is what a name is for
export function answer(): Answer {
  return { state: "absent" };
}

type Label = { label: string; tone: string }; // ADMITTED an anonymous object on a return widens what a named contract carries
export function label(): Label {
  return { label: "verified", tone: "good" };
}

type Scored = Pick<Metrics, "runs"> & Partial<Record<"acceptedSubmit" | "truthOk" | "pass", boolean>>; // ADMITTED too wide for the signature
export function scored(): Scored {
  return { runs: 0 };
}
`.trimStart();

const LIFETIME = `
declare const argv: string[];

export function run() {
  const child = Bun.spawn({ cmd: argv }); // REPORT a third owner of process lifetime
  child.kill();
  return child.exitCode;
}
`.trimStart();

/** A pid read out of `ps` and then signalled: the file ends something it never launched. */
const REAPER = `
declare const process: { kill: (pid: number, signal: string) => void };
declare const LINE_BREAK: RegExp;
declare function parentOf(row: string): number;
declare function pidOf(row: string): number;

export async function reap(root: number) {
  const ps = Bun.spawn(["ps", "-axo", "pid=,ppid="], { stdout: "pipe" });
  const rows = (await new Response(ps.stdout).text()).trim().split(LINE_BREAK);
  for (const row of rows) {
    if (parentOf(row) === root) process.kill(pidOf(row), "SIGKILL");
  }
}
`.trimStart();

/** `kill(pid, 0)` sends no signal, so a file that spawns and then probes owns no lifetime. */
const PROBE = `
declare const argv: string[];
declare const process: { kill: (pid: number, signal: number) => void };

export function alive(pid: number) {
  Bun.spawnSync({ cmd: argv });
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
`.trimStart();

const SPAWN_ONLY = `
declare const argv: string[];

export function run() {
  const child = Bun.spawn({ cmd: argv });
  return child.exitCode;
}
`.trimStart();

const NESTING = `
export function pyramid(rows: string[][]) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell !== "") {
        while (cell.length > 0) break; // REPORT the first statement past the limit, once
      }
    }
  }
  rows.forEach(() => undefined);
  for (const row of rows) {
    for (const cell of row) {
      if (cell !== "") {
        while (cell.length > 0) break; // ADMITTED one report a function, callback or not
      }
    }
  }
}
export function three(rows: string[][]) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell !== "") return cell; // ADMITTED three levels is the limit, not past it
    }
  }
  return null;
}
export function chained(kind: string) {
  if (kind === "verified") return 1;
  else if (kind === "unaccepted") return 2;
  else if (kind === "non-result") return 3;
  else if (kind === "held") return 4; // ADMITTED an else if is an alternative, not a level
  return 0;
}
export function callbacks(rows: string[][]) {
  for (const row of rows) {
    row.forEach((cell) => {
      if (cell !== "") {
        for (const part of cell) {
          if (part === "x") return; // ADMITTED a callback body counts from zero, not from its site
        }
      }
    });
  }
}
export function cleaned(rows: string[][]) {
  try {
    for (const row of rows) {
      for (const cell of row) {
        if (cell !== "") return cell; // ADMITTED entering a try is unconditional, so it is no level
      }
    }
  } finally {
    rows.length = 0;
  }
  return null;
}
export function guarded(rows: string[][]) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell === "") continue;
      for (const part of cell) {
        if (part === "x") return cell; // ADMITTED an if holding one jump encloses nothing below it
      }
    }
  }
  return null;
}
export function bodied(rows: string[][]) {
  for (const row of rows) {
    for (const cell of row) {
      if (cell !== "") {
        for (const part of cell) rows.push([part]); // REPORT a body of its own is a level, jump or no jump
      }
    }
  }
  return null;
}
export function counted(rows: string[][]) {
  let skipped = 0;
  for (const row of rows) {
    for (const cell of row) {
      for (const part of cell) {
        if (part === "") {
          skipped += 1;
          continue; // ADMITTED a guard may do a little before it leaves
        }
      }
    }
  }
  return skipped;
}
export function branched(rows: string[][]) {
  for (const row of rows) {
    for (const cell of row) {
      for (const part of cell) {
        if (part === "") { // REPORT a guard that branches first is a body doing two things
          if (cell === "x") rows.push([part]);
          continue;
        }
      }
    }
  }
}
export function caught(rows: string[][]) {
  for (const row of rows) {
    try {
      return row[0];
    } catch {
      for (const cell of row) {
        if (cell !== "") { // REPORT a catch is a level: a reader is there because it threw
          rows.push([cell]);
          row.pop();
        }
      }
    }
  }
  return null;
}
`.trimStart();

const LITERALS = `
declare function record(flag: string, note: string): void;

export function repeated() {
  record("not recorded", "provider"); // REPORT four spellings of one unchecked value in one file
  record("not recorded", "sandbox");
  record("not recorded", "protocol");
  record("not recorded", "verifier");
}
export function flagged() {
  record("--ro-bind", "one"); // ADMITTED a flag is another program's spelling, read against its manual
  record("--ro-bind", "two");
  record("--ro-bind", "three");
  record("--ro-bind", "four");
}
export function stamped() {
  record("2026-09-15", "one"); // ADMITTED a leading digit still leaves one hyphenated word
  record("2026-09-15", "two");
  record("2026-09-15", "three");
  record("2026-09-15", "four");
}
export function tagged() {
  record("non-result", "one"); // ADMITTED a union member: a typo here is a build failure
  record("non-result", "two");
  record("non-result", "three");
  record("non-result", "four");
}
export function thrice() {
  record("opening.json", "one"); // ADMITTED three is how code is written
  record("opening.json", "two");
  record("opening.json", "three");
}
export const budget = {
  environment: 1,
  "spawned.json": 2, // ADMITTED a property key is the shape, not a value
};
export function keyed() {
  record("spawned.json", "one");
  record("spawned.json", "two");
  record("spawned.json", "three");
}
export function short() {
  record("a.ts", "one"); // ADMITTED four characters is a word rather than a value
  record("a.ts", "two");
  record("a.ts", "three");
  record("a.ts", "four");
}
`.trimStart();

const SUITE = `
import { record } from "./record.ts";

export function fixture() {
  record("opening.json", "one"); // REPORT ten spellings is a fixture the suite never named
  record("opening.json", "two");
  record("opening.json", "three");
  record("opening.json", "four");
  record("opening.json", "five");
  record("opening.json", "six");
  record("opening.json", "seven");
  record("opening.json", "eight");
  record("opening.json", "nine");
  record("opening.json", "ten");
}
export function cases() {
  record("battery.json", "one"); // ADMITTED nine cases each spelling their own fixture is a suite
  record("battery.json", "two");
  record("battery.json", "three");
  record("battery.json", "four");
  record("battery.json", "five");
  record("battery.json", "six");
  record("battery.json", "seven");
  record("battery.json", "eight");
  record("battery.json", "nine");
}
`.trimStart();

describe("the simplify ownership catchers", () => {
  it("reads a local alias that only restates one function's return type", () => {
    pins("no-alias-restating-return", ALIASES, 1);
  });

  it("reads a file that spawns a child and kills it", () => {
    pins("no-lifetime-outside-owner", LIFETIME, 1);
  });

  it("says nothing about a launch owner, a bare spawn, a liveness probe, or a reaper of found pids", () => {
    expect(
      reportedLines("ana", "no-lifetime-outside-owner", LIFETIME, "src/meta/subprocess.ts"),
    ).toStrictEqual([]);
    expect(reportedLines("ana", "no-lifetime-outside-owner", SPAWN_ONLY, "src/run/fixture.ts")).toStrictEqual(
      [],
    );
    expect(reportedLines("ana", "no-lifetime-outside-owner", PROBE, "src/run/fixture.ts")).toStrictEqual([]);
    expect(
      reportedLines("ana", "no-lifetime-outside-owner", REAPER, "tools/runtime/fixture.ts"),
    ).toStrictEqual([]);
  });

  it("reads one pyramid a function, counting a callback from zero", () => {
    pins("no-deep-nesting", NESTING, 4);
  });

  it("reads a meaningful string spelled four times, skipping keys, words, flags and stamps", () => {
    pins("no-repeated-string-literal", LITERALS, 1);
  });

  it("holds a suite to ten spellings, because a case naming its own fixture is a case", () => {
    pins("no-repeated-string-literal", SUITE, 1, "test/fixture.test.ts");
  });

  it("says nothing about the same suite in source, where four is already too many", () => {
    expect(reportedLines("ana", "no-repeated-string-literal", SUITE, "src/run/fixture.ts")).toHaveLength(2);
  });

  it("names a suite's fixture once, after the imports, and reads every copy back from it", () => {
    const swept = fixedSource("ana", "no-repeated-string-literal", SUITE, "test/fixture.test.ts");
    expect(swept).toContain('const OPENING_JSON = "opening.json";');
    expect(swept.match(/"opening\.json"/gu)).toHaveLength(1);
    expect(swept.match(/OPENING_JSON/gu)).toHaveLength(11);
    // The admitted nine are below the floor and stay as the suite wrote them.
    expect(swept.match(/"battery\.json"/gu)).toHaveLength(9);
  });

  it("declares after the leading imports, not after one written below the first statement", () => {
    const late = SUITE.replace(
      "export function fixture()",
      'const scratch = [];\nimport { helper } from "./helper.ts";\n\nexport function fixture()',
    );
    const swept = fixedSource("ana", "no-repeated-string-literal", late, "test/fixture.test.ts");
    expect(swept.indexOf("const OPENING_JSON")).toBeLessThan(swept.indexOf("const scratch"));
  });

  it("takes an `as const` off a copy it names, since the constant already has the literal type", () => {
    const asserted = SUITE.replace('record("opening.json", "ten")', 'record("opening.json" as const, "ten")');
    const swept = fixedSource("ana", "no-repeated-string-literal", asserted, "test/fixture.test.ts");
    expect(swept).toContain('record(OPENING_JSON, "ten")');
    expect(swept).not.toContain("as const");
  });

  it("leaves a value it cannot name plainly to its author", () => {
    const stamped = SUITE.replaceAll("opening.json", "2026-09-15T00:00:00Z");
    const swept = fixedSource("ana", "no-repeated-string-literal", stamped, "test/fixture.test.ts");
    expect(swept).toStrictEqual(stamped);
  });
});

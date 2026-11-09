/**
 * `partial-mapping` (`tools/oxlint/tree-partial-mapping.ts`): a lookup `Map`, read with a computed
 * key, that maps most of an exported set and leaves the rest out, or maps the whole set while no
 * type holds it there. The fixture is a small job runner. Beside the two reports sit their nearest
 * hostile cases: the same table held by `satisfies` or by an annotation, a table read only with
 * literal keys, a selection of fewer than half the set, a table whose keys are exactly a narrower
 * union its own file declares, an accumulator changed through `set`, and an object literal mapping
 * part of a set, which the compiler holds once its key is typed.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";

const JOB = `export interface Job {
  state: "queued" | "running" | "done" | "failed" | "cancelled" | "lost";
}
export type Level = "debug" | "info" | "warn";
`;
const LABELS = `import type { Job, Level } from "./job.ts";
const SAID = new Map([ // REPORT maps four of six
  ["queued", "waits"],
  ["running", "runs"],
  ["done", "ended whole"],
  ["failed", "failed"],
]);
const HELD = new Map(
  Object.entries({ queued: "waits", running: "runs", done: "ended", failed: "failed" } satisfies Partial<Record<Job["state"], string>>),
); // ADMITTED the table says which set it maps
const TYPED: Map<string, string> = new Map([["queued", "q"], ["running", "r"], ["done", "d"], ["failed", "f"]]); // ADMITTED annotated
const LITERAL = new Map([["queued", 1], ["running", 2], ["done", 3], ["failed", 4]]); // ADMITTED read with literal keys
const ENDED = new Map([["done", true], ["failed", true]]); // ADMITTED a selection of two of six
const LEVELS = new Map([ // REPORT maps every level, held by nothing
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
]);
const COLOURS = { debug: "grey", info: "blue" }; // ADMITTED an object, read with a typed key
export function label(job: Job, level: Level & keyof typeof COLOURS): string {
  const tally = new Map([["queued", 0], ["running", 0], ["done", 0], ["failed", 0]]); // ADMITTED an accumulator
  tally.set(job.state, (tally.get(job.state) ?? 0) + 1);
  return [SAID.get(job.state), HELD.get(job.state), TYPED.get(job.state), LITERAL.get("done"), ENDED.get(job.state), LEVELS.get(level), COLOURS[level]].join(" ");
}
`;
const PICK = `export function pick(side: "queued" | "running" | "done" | "failed"): string {
  const BY_SIDE = new Map([["queued", "a"], ["running", "b"], ["done", "c"], ["failed", "d"]]); // ADMITTED keys are its own file's union
  return BY_SIDE.get(side) ?? "";
}
`;

const rows = implicitStateFindings(
  new Map([
    ["src/job.ts", JOB],
    ["src/labels.ts", LABELS],
    ["src/pick.ts", PICK],
  ]),
).filter((row) => row.kind === "partial-mapping");

describe("partial-mapping", () => {
  it("is reported on a table that leaves part of its set out and on a Map nothing holds to its set", () => {
    expect(rows.map((row) => `${row.path}:${String(row.line)}`)).toEqual([
      "src/labels.ts:2",
      "src/labels.ts:14",
    ]);
  });

  it("names the set and how many of its values the table maps and leaves out", () => {
    expect(
      rows.map((row) =>
        /maps (?:all )?(\d+) .*values of `([\w.]+)`.*leaves out (\d+)/u.exec(row.detail)?.slice(1),
      ),
    ).toEqual([
      ["4", "Job.state", "2"],
      ["3", "Level", "0"],
    ]);
  });

  it("is not reported where a type holds the table, a literal reads it, it selects, it accumulates or the compiler holds it", () => {
    expect(
      rows.filter(
        (row) => !["src/labels.ts:2", "src/labels.ts:14"].includes(`${row.path}:${String(row.line)}`),
      ),
    ).toEqual([]);
  });
});

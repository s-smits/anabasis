/**
 * The limit margin pairs each numeric leaf of a check's hidden operand with the nearest number the
 * reference artifact holds under that check's declared artifact paths. These cases pin the three
 * readings a family row can give a leaf — within 5%, outside it, unpaired — and the refusals that
 * keep a missing or malformed reference artifact from becoming a fabricated row. The last case
 * holds the host-only wall in source: nothing but the claim writer, the measure step and the
 * operator's outcome report may reach the module that reads or writes these numbers.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "../src/meta/filesystem.ts";
import { join, relative } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../src/claim/readiness.ts";
import { limitMargin, readLimitMargin, writeLimitMargin } from "../src/run/limit-margin.ts";
import type { Brief, BriefTruthCheck } from "../src/truth/brief.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const REFERENCE = { members: [{ deflection: 10, stress: 200 }] };

afterAll(cleanupScratch);

const numericCheck = (id: string, artifactPaths: string[]): BriefTruthCheck => ({
  id,
  assertion: `${id} holds against the task's limit`,
  execution: {
    families: "all",
    artifactPaths,
    publicInputPaths: ["$.span"],
    hidden: "required",
    evidence: { kind: "authored" },
  },
});

const BRIEF: Brief = {
  ...MATCHING_BRIEF,
  truthChecks: [
    numericCheck("deflection-limit", ["$.members"]),
    numericCheck("stress-limit", ["$.members"]),
    numericCheck("mass-limit", ["$.mass"]),
  ],
};

function task(taskId: string, family: string, hidden: Record<string, JsonValue>): BuildTask {
  return {
    taskId,
    family,
    publicInput: { span: 12 },
    hidden: Object.entries(hidden).map(([checkId, expectation]) => ({ checkId, expectation })),
  };
}

function caseOf(taskId: string, artifact: JsonValue): SolvabilityCaseEvidence {
  return {
    taskId,
    fullTaskDigest: "full",
    publicTaskDigest: "public",
    artifactDigest: artifact === null ? null : "artifact",
    artifact,
    status: "passed",
    nonResultKind: null,
    failureKind: null,
    submissionPath: null,
    referenceSolve: null,
    failedCheckIds: [],
    predicateFailures: [],
    error: null,
  };
}

describe("limit margin against the reference solve", () => {
  it("counts a limit at 1.02 times the reference within 5%, one at 1.5 times outside it, and a leaf with no reference number as unpaired", () => {
    const rows = limitMargin(
      BRIEF,
      [
        task("t1", "truss", {
          "deflection-limit": { max: 10.2 },
          "stress-limit": { max: 300 },
          "mass-limit": 40,
        }),
      ],
      [caseOf("t1", REFERENCE)],
    );
    expect(rows).toEqual([
      {
        family: "truss",
        limits: "hidden",
        tasks: 1,
        paired: 2,
        within1pct: 0,
        within5pct: 1,
        medianRelativeDistance: expect.closeTo((0.02 + 0.5) / 2, 9),
        unpaired: 1,
      },
    ]);
  });

  it("gives no row for a task whose reference artifact is missing, not an object, or belongs to no recorded task", () => {
    const tasks = [
      task("absent", "truss", { "deflection-limit": 10.2 }),
      task("scalar", "truss", { "deflection-limit": 10.2 }),
    ];
    const rows = limitMargin(BRIEF, tasks, [
      caseOf("absent", null),
      caseOf("scalar", "10"),
      caseOf("unknown-task", REFERENCE),
    ]);
    expect(rows).toEqual([]);
  });

  it("reports a one-task family in the host-only file and records nothing without a witness", () => {
    const dir = scratchDir("ana-limit-margin-");
    const path = join(dir, "analysis", "r1-limit-margin.json");
    const tasks = [task("t1", "cantilever", { "deflection-limit": 10.1 })];
    writeLimitMargin(path, "r1", { brief: BRIEF, tasks, solvability: null });
    expect(readLimitMargin(path)).toBeNull();
    const witness = { cases: [caseOf("t1", REFERENCE)] };
    // SAFETY: writeLimitMargin reads `cases` alone; the other evidence fields are identities it never opens.
    const solvability = witness as SolvabilityEvidence;
    writeLimitMargin(path, "r1", { brief: BRIEF, tasks, solvability });
    const recorded = readLimitMargin(path);
    expect(recorded?.pairing).toMatch(/^heuristic pairing/);
    expect(recorded?.families).toEqual([
      {
        family: "cantilever",
        limits: "hidden",
        tasks: 1,
        paired: 1,
        within1pct: 1,
        within5pct: 1,
        medianRelativeDistance: expect.closeTo(0.01, 9),
        unpaired: 0,
      },
    ]);
  });

  // A battery whose every cap is public carries no hidden limit, so reading hidden operands alone
  // gave an empty report. The declared boundary pairs the published cap with the one artifact path it
  // bounds, so the 12-to-18 mass cap is read against the reference's reported mass of 10, not
  // against whichever number happens to sit nearest it.
  it("reads a published limit through its declared boundary, and counts an unreadable one as unpaired", () => {
    const mass: BriefTruthCheck = {
      ...numericCheck("mass-within-limit", ["$.mass", "$.members"]),
      numericBoundaries: [
        {
          publicInputPath: "$.massCap",
          constantName: "mass-cap",
          artifactPath: "$.mass",
          direction: "atMost",
        },
      ],
    };
    const brief: Brief = { ...MATCHING_BRIEF, truthChecks: [mass] };
    const tasks: BuildTask[] = [
      { taskId: "tight", family: "truss", publicInput: { span: 12, massCap: 10.2 }, hidden: [] },
      { taskId: "loose", family: "truss", publicInput: { span: 12, massCap: 18 }, hidden: [] },
      { taskId: "unstated", family: "truss", publicInput: { span: 12 }, hidden: [] },
    ];
    const artifact = { mass: 10, members: [{ stress: 18 }] };
    const rows = limitMargin(brief, tasks, [
      caseOf("tight", artifact),
      caseOf("loose", artifact),
      caseOf("unstated", artifact),
    ]);
    expect(rows).toEqual([
      {
        family: "truss",
        limits: "published",
        tasks: 3,
        paired: 2,
        within1pct: 0,
        within5pct: 1,
        medianRelativeDistance: expect.closeTo((0.02 + 0.8) / 2, 9),
        unpaired: 1,
      },
    ]);
    // A boundary declaring no bounded artifact path states no comparison, so it pairs nothing.
    const {
      artifactPath: _path,
      direction: _direction,
      ...half
    } = mass.numericBoundaries?.[0] ?? {
      publicInputPath: "",
      constantName: "",
    };
    const halfStated: Brief = { ...brief, truthChecks: [{ ...mass, numericBoundaries: [half] }] };
    expect(limitMargin(halfStated, tasks, [caseOf("tight", artifact)])).toEqual([]);
  });

  // Rule 4 in source: the margin is computed from hidden operands and reference artifacts, so only
  // the claim writer that records it, the measure step that names its path and the operator's
  // outcome report may import the module. A new importer is a new reader, and has to be argued for.
  it("is imported only by the claim writer, the measure step and the operator's outcome report", () => {
    const root = join(import.meta.dir, "..");
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "node_modules") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts") && readFileSync(path, "utf8").includes('limit-margin.ts"')) {
          importers.push(relative(root, path));
        }
      }
    };
    for (const top of ["src", "tools", "vendor", "starters", "packages", ".claude"]) walk(join(root, top));
    expect(importers.toSorted()).toEqual([
      "src/run/claim-write.ts",
      "src/run/harness-measure.ts",
      "tools/outcome/metrics.ts",
    ]);
  });
});

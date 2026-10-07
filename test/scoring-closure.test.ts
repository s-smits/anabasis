/** The scoring program's identities (src/claim/scoring-closure.ts, and the brief a battery scored
 *  under in src/correctness-bundle/public-resources.ts). The scoring hash is brief.json plus
 *  evaluator.ts and every module it reaches at runtime, so a reference solve or test rewritten for
 *  a new battery moves no scoring byte while anything the verifier executes does. A recheck reads
 *  two narrower identities of the brief the battery scored: the verdict identity, which moves only
 *  with what the host runs, and the publication identity, which moves only with what the solver
 *  reads. */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { scoringClosureHash, verdictClosureHash } from "../src/claim/scoring-closure.ts";
import type {
  ArtifactField,
  Brief,
  BriefTruthCheck,
  CheckExecution,
} from "../src/correctness-bundle/brief.ts";
import { bundleEvaluator } from "../src/correctness-bundle/evaluator-process-bundle.ts";
import { briefPublicationHash, scoredBrief } from "../src/correctness-bundle/public-resources.ts";
import { batteryCondition } from "../src/author/issue-condition.ts";
import { double, required } from "./helpers/doubles.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const EVALUATOR = {
  "evaluator.ts": 'import "./checks.ts";\nexport const checks = {};\n',
  "checks.ts": "export const shared = 1;\n",
  "reference/index.ts": "export const solve = () => 1;\n",
};

afterAll(cleanupScratch);

function model(files: Record<string, string>, parent = tmpdir()) {
  const dir = join(scratchDir("scoring-closure-", parent), "correctness-model");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  for (const [path, text] of Object.entries({ "brief.json": "{}", ...files })) write(path, text);
  return { dir, write };
}

it("moves with the evaluator, the brief and every module the evaluator executes", () => {
  const { dir, write } = model({
    "evaluator.ts":
      'import "./reference/shared.ts";\nimport "./harness.test.ts";\nexport * from "./checks.ts";\n',
    "reference/shared.ts": "export const shared = 1;\n",
    "checks.ts": "export const checks = {};\n",
    "harness.test.ts": "export const fixture = 1;\n",
  });
  const seen = new Set([scoringClosureHash(dir)]);
  for (const [path, text] of [
    [
      "evaluator.ts",
      'import "./reference/shared.ts";\nimport "./harness.test.ts";\nexport * from "./checks.ts";\n// moved\n',
    ],
    // A file name decides nothing: a test module the evaluator executes is scoring.
    ["harness.test.ts", "export const fixture = 2;\n"],
    ["reference/shared.ts", "export const shared = 2;\n"],
    ["checks.ts", "export const checks = { moved: true };\n"],
    ["brief.json", '{"moved":true}'],
  ] as const) {
    write(path, text);
    const next = scoringClosureHash(dir);
    expect(next).not.toBeNull();
    expect(seen.has(next)).toBe(false);
    seen.add(next);
  }
});

it("stays put when only a reference solve, a test or a type-only import target changes", () => {
  const { dir, write } = model({
    "evaluator.ts":
      'import type { Row } from "./types.ts";\nimport { PRIM } from "@ana/correctness-model-prims";\nexport const checks = {} as Record<string, Row>;\nvoid PRIM;\n',
    "types.ts": "export interface Row { a: number }\n",
    "reference/index.ts": "export const solve = () => 1;\n",
    "harness.test.ts": "export {};\n",
  });
  const before = scoringClosureHash(dir);
  expect(before).not.toBeNull();
  write("reference/index.ts", "export const solve = () => 2;\n");
  write("harness.test.ts", "export const changed = true;\n");
  write("types.ts", "export interface Row { b: string }\n");
  write("notes.md", "a new unimported file");
  expect(scoringClosureHash(dir)).toBe(before);
});

it("reads nothing it cannot bound: an escaping or unlisted import leaves the program unaddressed", () => {
  expect(scoringClosureHash(model({ "evaluator.ts": 'import "../agent/tools.ts";\n' }).dir)).toBeNull();
  expect(
    scoringClosureHash(model({ "evaluator.ts": 'import { readFileSync } from "node:fs";\n' }).dir),
  ).toBeNull();
  expect(scoringClosureHash(model({ "evaluator.ts": 'import "./missing.ts";\n' }).dir)).toBeNull();
});

const executed = async (dir: string) => (await bundleEvaluator(dirname(dir))).portableDigest;

it("reads a package whole once it carries configuration the bundler compiles it under", async () => {
  const files = {
    "evaluator.ts":
      'import { Box } from "./box.ts";\nexport const checks = { defined: () => Object.keys(new Box()).length === 1 };\n',
    "box.ts": "export class Box { field?: number }\n",
  };
  const plain = model(files);
  const configured = model(files);
  // No walked byte differs, yet the bundle stops defining the field and the check's answer flips.
  configured.write("tsconfig.json", '{"compilerOptions": {"useDefineForClassFields": false}}');
  expect(await executed(configured.dir)).not.toBe(await executed(plain.dir));
  expect(scoringClosureHash(plain.dir)).not.toBeNull();
  expect(scoringClosureHash(configured.dir)).toBeNull();
  for (const name of ["jsconfig.json", "reference/package.json"]) {
    const other = model(files);
    other.write(name, "{}");
    expect(scoringClosureHash(other.dir)).toBeNull();
  }
});

it("resolves a public package from the controller, so an alias above the package adds no bundle byte", async () => {
  const files = {
    "evaluator.ts":
      'import { Type } from "typebox";\nexport const checks = { schema: () => Type.String() !== undefined };\n',
    "stand-in.ts": 'export const Type = { String: () => "stand-in" };\n',
  };
  const checkout = scratchDir(".ana-scratch-scoring-closure-", import.meta.dir);
  const plain = model(files, checkout);
  const aliased = model(files, checkout);
  // The workspace root sits outside every candidate hash, and the closure skips the public name.
  writeFileSync(
    join(dirname(aliased.dir), "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { typebox: ["./correctness-model/stand-in.ts"] } } }),
  );
  expect(scoringClosureHash(aliased.dir)).toBe(scoringClosureHash(plain.dir));
  expect(await executed(aliased.dir)).toBe(await executed(plain.dir));
});

/** A package whose brief is the given one, written as the Builder's JSON. */
const packageOf = (brief: Brief, files: Record<string, string> = EVALUATOR) =>
  model({ ...files, "brief.json": JSON.stringify(brief) }).dir;

const FIRST_CHECK = required(MATCHING_BRIEF.truthChecks[0], "the fixture's first check");
const SECOND_CHECK = required(MATCHING_BRIEF.truthChecks[1], "the fixture's second check");
const firstCheck = (edit: Partial<BriefTruthCheck>): Brief => ({
  ...MATCHING_BRIEF,
  truthChecks: [{ ...FIRST_CHECK, ...edit }, SECOND_CHECK],
});
const firstExecution = (edit: Partial<CheckExecution>) =>
  firstCheck({ execution: { ...FIRST_CHECK.execution, ...edit } });
const schemaField = (edit: Partial<ArtifactField>): Brief => ({
  ...MATCHING_BRIEF,
  artifactSchema: [{ name: "assignments", "shape": "array of {part, slot} binding objects", ...edit }],
});
const ruleRows = (visibility: "public" | "private", statement: string): Brief => ({
  ...MATCHING_BRIEF,
  ruleDecisions: (MATCHING_BRIEF.ruleDecisions ?? []).map((row) =>
    row.visibility === visibility ? { ...row, statement } : row,
  ),
});
/** A brief that names a schema root its checks no longer read: the host would refuse to run it. */
const RENAMED_ROOT = schemaField({ name: "bindings" });

/** One edit to the scored brief, and whether it moves the checks and the rules the solver read. */
const BRIEF_EDITS: ReadonlyArray<readonly [string, Brief, { checks: boolean; rules: boolean }]> = [
  [
    "the coverage map",
    { ...MATCHING_BRIEF, decisions: ["placement is the writer's call"] },
    { checks: false, rules: false },
  ],
  [
    "a gate",
    { ...MATCHING_BRIEF, gates: ["submit blocks until the part list is written"] },
    { checks: false, rules: false },
  ],
  [
    "a join's wording",
    {
      ...MATCHING_BRIEF,
      joins: MATCHING_BRIEF.joins.map((row) => ({ ...row, description: "joined by exact part id" })),
    },
    { checks: false, rules: false },
  ],
  ["a private rule row", ruleRows("private", "widen first, then bind"), { checks: false, rules: false }],
  ["a check's cited decisions", firstCheck({ citedDecisionIds: [] }), { checks: false, rules: false }],
  [
    "a public rule row",
    ruleRows("public", "each part appears once, bound to its named slot"),
    { checks: false, rules: true },
  ],
  [
    "a check's assertion",
    firstCheck({ assertion: "every part binds one slot, restated" }),
    { checks: false, rules: true },
  ],
  [
    "a constant's value",
    {
      ...MATCHING_BRIEF,
      designRuleConstants: MATCHING_BRIEF.designRuleConstants.map((row) => ({ ...row, value: 2 })),
    },
    { checks: false, rules: true },
  ],
  [
    "a value set",
    {
      ...MATCHING_BRIEF,
      designRuleSets: [{ name: "slots", values: ["s1", "s2"], authority: "domain brief", citation: "s.2" }],
    },
    { checks: false, rules: true },
  ],
  [
    "a schema field's sentence",
    schemaField({ "shape": "array of {part, slot} objects" }),
    { checks: false, rules: true },
  ],
  [
    "a published margin, which no public resource carries",
    firstCheck({
      numericBoundaries: [
        {
          publicInputPath: "$.parts",
          constantName: "parts",
          artifactPath: "$.assignments",
          direction: "atMost",
        },
      ],
    }),
    { checks: false, rules: true },
  ],
  ["a check id", firstCheck({ id: "parts-bound" }), { checks: true, rules: false }],
  ["a check's hidden declaration", firstExecution({ hidden: "none" }), { checks: true, rules: false }],
  [
    "a check's public input paths",
    firstExecution({ publicInputPaths: ["$.parts"] }),
    { checks: true, rules: true },
  ],
  ["a check removed", { ...MATCHING_BRIEF, truthChecks: [FIRST_CHECK] }, { checks: true, rules: true }],
  ["a schema field's name", RENAMED_ROOT, { checks: true, rules: true }],
  [
    "a schema field's allowed values",
    schemaField({ allowedValues: ["a", "b"] }),
    { checks: true, rules: true },
  ],
  ["a file-map field", schemaField({ fileMap: true }), { checks: true, rules: true }],
  ["an open map path", schemaField({ openMapPaths: ["$"] }), { checks: true, rules: true }],
];

const identitiesOf = (brief: Brief) => {
  const dir = packageOf(brief);
  return {
    scoring: scoringClosureHash(dir),
    checks: verdictClosureHash(dir, brief),
    rules: briefPublicationHash(brief),
  };
};

it("moves the checks' identity with what the host runs and the rules' with what the solver reads, while every brief byte moves the scoring hash", () => {
  const base = identitiesOf(MATCHING_BRIEF);
  expect(base.checks).toMatch(/^[0-9a-f]{64}$/);
  for (const [edit, brief, moved] of BRIEF_EDITS) {
    const next = identitiesOf(brief);
    expect({ edit, checks: next.checks !== base.checks, rules: next.rules !== base.rules }).toEqual({
      edit,
      ...moved,
    });
    // The scoring hash reads the whole brief, which is why it cannot tell a reword from a new check.
    expect({ edit, scoring: next.scoring !== base.scoring }).toEqual({ edit, scoring: true });
  }
});

it("moves the checks' identity with the evaluator and every module it runs, not with a reference solve, and names none for an unbounded closure", () => {
  const checksOf = (files: Record<string, string>) =>
    verdictClosureHash(packageOf(MATCHING_BRIEF, files), MATCHING_BRIEF);
  const base = checksOf(EVALUATOR);
  expect(checksOf({ ...EVALUATOR, "checks.ts": "export const shared = 2;\n" })).not.toBe(base);
  expect(checksOf({ ...EVALUATOR, "evaluator.ts": `${EVALUATOR["evaluator.ts"]}// moved\n` })).not.toBe(base);
  expect(checksOf({ ...EVALUATOR, "reference/index.ts": "export const solve = () => 2;\n" })).toBe(base);
  expect(checksOf({ "evaluator.ts": 'import "./missing.ts";\n' })).toBeNull();
});

it("names the checks of the brief it is handed, which is the one the battery scored, never brief.json as it reads now", () => {
  const scored = { ...MATCHING_BRIEF, truthChecks: [FIRST_CHECK] };
  expect(verdictClosureHash(packageOf(MATCHING_BRIEF), scored)).toBe(
    verdictClosureHash(packageOf(scored), scored),
  );
});

describe("the brief a battery scored under", () => {
  const slugOf = (text: string) => {
    const dir = model({ ...EVALUATOR, "brief.json": text }).dir;
    return { slug: dirname(dir), recorded: scoringClosureHash(dir) };
  };

  it("is the tree's valid brief while the tree still scores to the recorded hash, and no brief otherwise", () => {
    const { slug, recorded } = slugOf(JSON.stringify(MATCHING_BRIEF));
    expect(scoredBrief(slug, recorded)).toEqual(MATCHING_BRIEF);
    expect(scoredBrief(slug, null)).toBeNull();
    expect(scoredBrief(slug, "9".repeat(64))).toBeNull();
    writeFileSync(
      join(slug, "correctness-model", "brief.json"),
      JSON.stringify(firstCheck({ assertion: "x" })),
    );
    expect(scoredBrief(slug, recorded)).toBeNull();
  });

  it("is no brief at the recorded bytes when the host would not run them", () => {
    for (const text of [
      JSON.stringify(RENAMED_ROOT),
      JSON.stringify({ truthChecks: [{ id: "a" }], artifactSchema: [] }),
      "[",
    ]) {
      const { slug, recorded } = slugOf(text);
      expect(recorded).not.toBeNull();
      expect(scoredBrief(slug, recorded)).toBeNull();
    }
  });
});

describe("the identities a battery's issues are compared under", () => {
  const recordedAs = (scoringHash: string | null) =>
    double<Parameters<typeof batteryCondition>[0]>({
      runId: "run-identities",
      cases: [],
      identities: {
        backendPin: "codex:test",
        isolationStrength: "physical",
        bundleSnapshot: { scoringHash },
      },
      battery: { condition: { variant: "shipping", advisorsRemoved: [] } },
    });
  const conditionOf = (brief: Brief) => {
    const dir = packageOf(brief);
    return { dir, slug: dirname(dir), recorded: recordedAs(scoringClosureHash(dir)) };
  };

  it("reads both from the brief the battery scored, and neither from a tree edited since", () => {
    const { dir, slug, recorded } = conditionOf(MATCHING_BRIEF);
    const condition = batteryCondition(recorded, slug);
    expect(condition.verdictClosureHash).toBe(verdictClosureHash(dir, MATCHING_BRIEF));
    expect(condition.verdictClosureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(condition.publicationHash).toBe(briefPublicationHash(MATCHING_BRIEF));
    expect(batteryCondition(recordedAs("9".repeat(64)), slug).verdictClosureHash).toBeNull();
    writeFileSync(
      join(dir, "brief.json"),
      JSON.stringify({ ...MATCHING_BRIEF, decisions: ["decided elsewhere"] }),
    );
    const edited = batteryCondition(recorded, slug);
    expect([edited.verdictClosureHash, edited.publicationHash]).toEqual([null, null]);
  });

  it("names neither over a brief the host would not run, even at the recorded bytes", () => {
    const { slug, recorded } = conditionOf(RENAMED_ROOT);
    const condition = batteryCondition(recorded, slug);
    expect([condition.verdictClosureHash, condition.publicationHash]).toEqual([null, null]);
  });
});

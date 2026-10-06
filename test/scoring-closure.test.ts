/** The scoring program's content address (src/claim/scoring-closure.ts): brief.json plus
 *  evaluator.ts and every module it reaches at runtime, so a reference solve or test rewritten for a
 *  new battery moves no scoring byte while anything the verifier executes does. Beside it sit the two
 *  identities a recheck is read under: the verdict closure, which ignores the brief's prose, and the
 *  publication hash, which is that prose as the solver read it. */
import { afterAll, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { scoringClosureHash, verdictClosureHash } from "../src/claim/scoring-closure.ts";
import type { Brief } from "../src/correctness-bundle/brief.ts";
import { bundleEvaluator } from "../src/correctness-bundle/evaluator-process-bundle.ts";
import { briefPublicationHash } from "../src/correctness-bundle/public-resources.ts";
import { required } from "./helpers/doubles.ts";
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

it("keeps the verdict closure where it was when only the brief's text and constants change", () => {
  const reworded: Brief = {
    ...MATCHING_BRIEF,
    decisions: ["placement is the writer's call, worded differently"],
    gates: ["submit blocks until the part list is written"],
    joins: MATCHING_BRIEF.joins.map((row) => ({ ...row, description: "joined by exact part id" })),
    ruleDecisions: (MATCHING_BRIEF.ruleDecisions ?? []).map((row) => ({
      ...row,
      statement: `${row.statement}, restated`,
    })),
    truthChecks: MATCHING_BRIEF.truthChecks.map((check) => ({
      ...check,
      assertion: `${check.assertion}, restated`,
      citedDecisionIds: [],
    })),
    // The constants are public numbers and their citations; the evaluator carries the ones it checks.
    designRuleConstants: [
      { name: "max-slots-per-part", value: 2, unit: "slots", authority: "another body", citation: "s.9" },
    ],
    designRuleSets: [{ name: "slots", values: ["s1", "s2"], authority: "domain brief", citation: "s.2" }],
    artifactSchema: [{ name: "assignments", "shape": "array of {part, slot} objects, one per part" }],
  };
  const plain = packageOf(MATCHING_BRIEF);
  expect(verdictClosureHash(plain)).not.toBeNull();
  expect(verdictClosureHash(packageOf(reworded))).toBe(verdictClosureHash(plain));
  // The scoring hash reads the whole brief, which is why it cannot tell a reword from a new check.
  expect(scoringClosureHash(packageOf(reworded))).not.toBe(scoringClosureHash(plain));
});

it("moves the verdict closure with a check id, an execution declaration, a schema field a submission is read against or the evaluator", () => {
  const withChecks = (truthChecks: Brief["truthChecks"]): Brief => ({ ...MATCHING_BRIEF, truthChecks });
  const moved: Brief[] = [
    withChecks([{ ...FIRST_CHECK, id: "parts-bound" }, SECOND_CHECK]),
    withChecks([{ ...FIRST_CHECK, execution: { ...FIRST_CHECK.execution, hidden: "none" } }, SECOND_CHECK]),
    withChecks([
      { ...FIRST_CHECK, execution: { ...FIRST_CHECK.execution, publicInputPaths: ["$.parts"] } },
      SECOND_CHECK,
    ]),
    withChecks([FIRST_CHECK]),
    {
      ...MATCHING_BRIEF,
      artifactSchema: [{ name: "bindings", "shape": "array of {part, slot} binding objects" }],
    },
    {
      ...MATCHING_BRIEF,
      artifactSchema: [{ name: "assignments", "shape": "array of {part, slot}", allowedValues: ["a", "b"] }],
    },
    { ...MATCHING_BRIEF, artifactSchema: [{ name: "assignments", "shape": "files", fileMap: true }] },
    { ...MATCHING_BRIEF, artifactSchema: [{ name: "assignments", "shape": "x", openMapPaths: ["$"] }] },
  ];
  const seen = new Set([verdictClosureHash(packageOf(MATCHING_BRIEF))]);
  const unseen = (dir: string) => {
    const next = verdictClosureHash(dir);
    expect(next).not.toBeNull();
    expect(seen.has(next)).toBe(false);
    seen.add(next);
  };
  for (const brief of moved) unseen(packageOf(brief));
  unseen(packageOf(MATCHING_BRIEF, { ...EVALUATOR, "checks.ts": "export const shared = 2;\n" }));
  unseen(
    packageOf(MATCHING_BRIEF, { ...EVALUATOR, "evaluator.ts": `${EVALUATOR["evaluator.ts"]}// moved\n` }),
  );
  // A reference solve is outside the closure, as it is outside the scoring hash.
  const reference = { ...EVALUATOR, "reference/index.ts": "export const solve = () => 2;\n" };
  expect(verdictClosureHash(packageOf(MATCHING_BRIEF, reference))).toBe(
    verdictClosureHash(packageOf(MATCHING_BRIEF)),
  );
});

it("addresses no verdict it cannot read: an unbounded closure, a missing brief or one without its checks", () => {
  expect(
    verdictClosureHash(packageOf(MATCHING_BRIEF, { "evaluator.ts": 'import "./missing.ts";\n' })),
  ).toBeNull();
  expect(verdictClosureHash(model(EVALUATOR).dir)).toBeNull();
  expect(verdictClosureHash(model({ ...EVALUATOR, "brief.json": "[" }).dir)).toBeNull();
  const noExecution = { truthChecks: [{ id: "a" }], artifactSchema: [] };
  expect(
    verdictClosureHash(model({ ...EVALUATOR, "brief.json": JSON.stringify(noExecution) }).dir),
  ).toBeNull();
});

it("moves the publication hash with the public rules, in words and in numbers, and not with what the solver is never shown", () => {
  const rows = MATCHING_BRIEF.ruleDecisions ?? [];
  const base = briefPublicationHash(MATCHING_BRIEF);
  const rule = required(rows[0], "the fixture's public rule decision");
  expect(rule.visibility).toBe("public");
  expect(
    briefPublicationHash({
      ...MATCHING_BRIEF,
      ruleDecisions: rows.map((row) =>
        row.id === rule.id ? { ...row, statement: `${row.statement}, with the slot named` } : row,
      ),
    }),
  ).not.toBe(base);
  expect(
    briefPublicationHash({
      ...MATCHING_BRIEF,
      truthChecks: MATCHING_BRIEF.truthChecks.map((check) => ({ ...check, assertion: "reworded" })),
    }),
  ).not.toBe(base);
  // A restated number and a reworded schema field are as public as a reworded rule.
  expect(
    briefPublicationHash({
      ...MATCHING_BRIEF,
      designRuleConstants: MATCHING_BRIEF.designRuleConstants.map((constant) => ({ ...constant, value: 2 })),
    }),
  ).not.toBe(base);
  expect(
    briefPublicationHash({
      ...MATCHING_BRIEF,
      artifactSchema: [{ name: "assignments", "shape": "array of {part, slot} objects" }],
    }),
  ).not.toBe(base);
  // A private row, the coverage map and the gates reach no solver, so their wording is no publication.
  expect(
    briefPublicationHash({
      ...MATCHING_BRIEF,
      decisions: ["another coverage map"],
      gates: ["another gate"],
      ruleDecisions: rows.map((row) =>
        row.visibility === "private" ? { ...row, statement: "widen first, then bind" } : row,
      ),
    }),
  ).toBe(base);
});

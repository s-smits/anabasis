/** The scoring program's content address (src/claim/scoring-closure.ts): brief.json plus
 *  evaluator.ts and every module it reaches at runtime, so a reference solve or test rewritten for a
 *  new battery moves no scoring byte while anything the verifier executes does. */
import { afterAll, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { scoringClosureHash } from "../src/claim/scoring-closure.ts";
import { bundleEvaluator } from "../src/correctness-bundle/evaluator-process-bundle.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

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

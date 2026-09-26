import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { hashBundle } from "../src/claim/bundle-hash.ts";
import { validateAgentBundle } from "../src/claim/bundle-validation.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { BRIEF_FILE } from "../src/meta/bundle-layout.ts";
const AGENT_TOOLS_TS = "agent/tools.ts";
const ONE_EXPORT = "export const a = 1;\n";
const CORRECTNESS_MODEL_EVALUATOR_TS = "correctness-model/evaluator.ts";

let dirs: string[] = [];
function slugDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-fingerprint-"));
  dirs.push(dir);
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  return dir;
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function write(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("bundle hashing", () => {
  it("is deterministic and sensitive to any byte, name, or membership change", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, "agent/data/catalog.json", "[1,2,3]\n");
    const first = hashBundle(join(dir, "agent"));
    expect(hashBundle(join(dir, "agent")).hash).toBe(first.hash);
    expect(first.files.map((f) => f.path)).toEqual(["data/catalog.json", "tools.ts"]);

    write(dir, AGENT_TOOLS_TS, "export const a = 2;\n");
    const edited = hashBundle(join(dir, "agent"));
    expect(edited.hash).not.toBe(first.hash);

    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, "agent/extra.ts", "export {};\n");
    expect(hashBundle(join(dir, "agent")).hash).not.toBe(first.hash);
  });

  it("rejects dependency installs and hashes ordinary run output instead of skipping it", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    const before = hashBundle(join(dir, "agent")).hash;
    write(dir, "agent/runs/001/case.json", "{}");
    expect(hashBundle(join(dir, "agent")).hash).not.toBe(before);
    write(dir, "agent/node_modules/dep/index.js", "x");
    expect(() => hashBundle(join(dir, "agent"))).toThrow(/unsupported entries: node_modules/);
  });
});

describe("bundle isolation checks", () => {
  it("an agent-bundle file importing correctnessModel material fails the fingerprint", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `import { EXPECTED } from "@ana/correctness-model-bundle";\nexport const t = EXPECTED;\n`,
    );
    write(dir, "correctness-model/tasks.ts", "export const hidden = 42;\n");
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.map((f) => f.code)).toContain("cross-isolation-import");
    // and there are no hashes to claim with — recorded and fingerprinted are one fact
    expect("agentHash" in result).toBe(false);
  });
  /** What the import scan finds in one agent module. The scan is a parser rather than a word search,
   *  so the loader words inside strings, arrays and comments are not specifiers, and every loader
   *  form a specifier can take is read, including the ones a regex missed. */
  it.each([
    [
      "allowed packages and a relative import inside the bundle",
      `import { DraftStore } from "@ana/agent-bundle";\nimport { Type } from "@earendil-works/pi-ai";\nimport { CATALOG } from "./catalog.ts";\nexport { DraftStore, Type, CATALOG };\n`,
      [],
    ],
    [
      "loader words inside strings, arrays and comments",
      [
        `import { DraftStore } from "@ana/agent-bundle";`,
        "// members import their section area from the catalog row",
        `const FROM_KEYS = ["from", "fromJoint", "startJoint"];`,
        `const note = 'we require "areaM2" and import nothing else';`,
        "export const pick = (row: Record<string, unknown>) => FROM_KEYS.map((k) => row[k]);",
        "export { DraftStore };",
      ].join("\n"),
      [],
    ],
    [
      "a relative import into verifier source",
      `import { makeVerifier } from "../correctness-model/verifier";\nexport const o = makeVerifier;\n`,
      ["escape-import"],
    ],
    [
      "an unvetted package through dynamic import and require",
      `const a = await import("some-random-pkg");\nconst b = require("@harness/builder");\nexport { a, b };\n`,
      ["unvetted-import", "unvetted-import"],
    ],
    [
      "a disallowed package in a re-export and an import-equals declaration",
      `export * from "bad-pkg";\nimport legacy = require("worse-pkg");\nexport { legacy };\n`,
      ["unvetted-import", "unvetted-import"],
    ],
    [
      "a Node builtin, which could read hidden data from beside the bundle",
      `import { readFileSync } from "node:fs";\nexport const leak = () => readFileSync("../correctness-model/tasks.json", "utf8");\n`,
      ["builtin-import"],
    ],
    [
      "correctness-model material named in a template string",
      "const g = require(`@ana/correctness-model-bundle`);\nexport { g };\n",
      ["cross-isolation-import"],
    ],
  ])("the import scan over %s", (_, source, codes) => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, source);
    write(dir, "agent/catalog.ts", "export const CATALOG = [];\n");
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const makeVerifier = () => null;\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect<string[]>(result.findings.map((f) => f.code)).toEqual(codes);
    expect(result.ok).toBe(codes.length === 0);
  });

  // A module name that is not a string literal cannot be vetted, so it fails closed, never skips.
  it.each([
    [
      "a computed name",
      `const name = "x";\nconst a = require(name);\nconst b = await import(name + "/y");\nexport { a, b };\n`,
      2,
    ],
    ["no argument at all", "const a = require();\nexport { a };\n", 1],
  ])("refuses an import or require with %s", (_, source, count) => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, source);
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings).toEqual(
      Array.from({ length: count }, () =>
        expect.objectContaining({
          code: "unvetted-import",
          detail: expect.stringContaining("must be a string literal"),
        }),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("answer-key material by filename trips regardless of imports", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, "agent/answers.json", "[7]");
    write(dir, "agent/hidden-expectations.ts", "export const expected = 7;\n");
    write(dir, "agent/reference-solver.ts", "export const solve = () => 7;\n");
    write(dir, "agent/expected-outputs.ts", "export const tabulate = () => [];\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(
      result.findings
        .filter((f) => f.code === "key-material-file")
        .map((f) => f.file)
        .sort(),
    ).toEqual(["answers.json", "hidden-expectations.ts"]);
  });

  it("scans every generated correctnessModel code module for capability escapes, leaving casts and the Builder's tests free", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, "export const tools = [];\n");
    write(dir, BRIEF_FILE, "{}\n");
    write(
      dir,
      CORRECTNESS_MODEL_EVALUATOR_TS,
      "export const solve = () => ({});\nexport const evaluate = () => ({ ok: true, issues: [] });\n",
    );
    write(
      dir,
      "correctness-model/helper.mts",
      'import { spawnSync } from "node:child_process";\nspawnSync("node");\nexport const relay = (value: unknown) => value as unknown as string;\n',
    );
    // Every loader form the shared module-operand reader sees still refuses.
    write(
      dir,
      "correctness-model/loaders.ts",
      'export * from "child_process";\nconst cp = require("child_process");\nexport const later = () => import("node:child_process");\n',
    );
    write(
      dir,
      "correctness-model/evaluator.test.ts",
      'import { spawnSync } from "node:child_process";\nconst runtime = {} as any;\nspawnSync("frame3dd", [String(runtime)]);\n',
    );
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.map((finding) => finding.file)).toEqual([
      "correctness-model/helper.mts",
      ...Array.from({ length: 3 }, () => "correctness-model/loaders.ts"),
    ]);
    expect(new Set(result.findings.map((finding) => finding.code))).toEqual(
      new Set(["correctness-model-capability-escape"]),
    );
  });

  it("refuses to fingerprint a slug missing either bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-fingerprint-"));
    dirs.push(dir);
    mkdirSync(join(dir, "agent"));
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings[0]?.code).toBe("missing-bundle");
  });

  it("a symlink in the agent bundle is rejected, not skipped — unhashed entries evade the record", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => true;\n");
    // The bypass: a link out of the bundle that the old walker silently omitted from
    // both the hash and the import scan, while a runtime traversal through it still works
    symlinkSync(join(dir, CORRECTNESS_MODEL_EVALUATOR_TS), join(dir, "agent/borrowed.ts"));
    const recorded = validateAgentBundle(join(dir, "agent"));
    expect(recorded.ok).toBe(false);
    expect(recorded.findings).toEqual([
      expect.objectContaining({ code: "non-regular-entry", file: "borrowed.ts" }),
    ]);
    expect(() => hashBundle(join(dir, "agent"))).toThrow(/unsupported entries: borrowed\.ts/);
  });

  it("a symlink in the CORRECTNESS_MODEL bundle rejects the fingerprint — the verifier's content address must cover what evaluates", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => true;\n");
    symlinkSync(join(dir, AGENT_TOOLS_TS), join(dir, "correctness-model/aliased.ts"));
    const result = fingerprintSlug(dir, { slug: "demo" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "non-regular-entry", file: "aliased.ts" }),
    ]);
  });

  /** The three content hashes each cover their own files, so an edit moves exactly one of them:
   *  task drift is not correctness-model drift, and neither is an agent edit. A bundle without
   *  tasks.json states its task hash as null rather than hashing an empty equivalent. */
  it("moves each content hash with its own files and no other", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => null;\n");
    const hashes = () => {
      const result = fingerprintSlug(dir, { slug: "demo" });
      if (!result.ok) throw new Error("unreachable");
      expect(result.slug).toBe("demo");
      return {
        agent: result.agentHash,
        correctnessModel: result.correctnessModelHash,
        tasks: result.taskSetHash,
        files: result.correctnessModelFiles.map((f) => f.path),
      };
    };
    const bare = hashes();
    expect(bare.tasks).toBeNull();

    write(dir, "correctness-model/tasks.json", JSON.stringify([{ taskId: "t1", hidden: [1] }]));
    const tasked = hashes();
    expect(tasked.tasks).toMatch(/^[0-9a-f]{64}$/);
    // tasks.json is not part of the verifier contract's file list.
    expect(tasked).toEqual({ ...bare, tasks: tasked.tasks, files: ["evaluator.ts"] });

    const moves = (edit: () => void, key: "agent" | "correctnessModel" | "tasks") => {
      const before = hashes();
      edit();
      const after = hashes();
      expect(after[key]).not.toBe(before[key]);
      expect({ ...after, [key]: before[key] }).toEqual(before);
    };
    moves(
      () => write(dir, "correctness-model/tasks.json", JSON.stringify([{ taskId: "t1", hidden: [2] }])),
      "tasks",
    );
    moves(
      () => write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => 1;\n"),
      "correctnessModel",
    );
    moves(() => write(dir, AGENT_TOOLS_TS, "export const a = 2;\n"), "agent");
  });
});

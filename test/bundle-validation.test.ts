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

describe("bundle isolation checks (hw23)", () => {
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

  it("refuses a relative import from the agent bundle into verifier source", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `import { makeVerifier } from "../correctness-model/verifier";\nexport const o = makeVerifier;\n`,
    );
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const makeVerifier = () => null;\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.code).toBe("escape-import");
  });

  it("an unvetted package fails closed; dynamic import and require are seen too", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `const a = await import("some-random-pkg");\nconst b = require("@harness/builder");\nexport { a, b };\n`,
    );
    const result = validateAgentBundle(join(dir, "agent"));
    const codes = result.findings.map((f) => f.code);
    expect(codes.filter((c) => c === "unvetted-import")).toHaveLength(2);
  });

  it("answer-key material by filename trips regardless of imports", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, "agent/answers.json", "[7]");
    write(dir, "agent/reference-solver.ts", "export const solve = () => 7;\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings.filter((f) => f.code === "key-material-file")).toHaveLength(2);
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

  // Two runs on 2026-09-18 shipped the verifier's own computation inside the solver's tool roster:
  // one agent module byte-identical to the reference solve's spec, one re-declaring nine of the
  // rule module's functions. Neither imports the other, so the import checks above saw nothing.
  const RULES =
    "export interface Design { span: number }\nexport const massKg = (d: Design): number => d.span * 2;\nexport function utilisation(d: Design): number { return d.span / 3; }\n";
  /** Two computations separated only by the operation each names. */
  const CM_OPERATIONS =
    "export interface Design { span: number }\nexport const lowerBound = (d: Design): number => Math.min(d.span, 9);\nexport function tally(d: Design): number { const seen = d.span; return Math.trunc(seen); }\n";
  /** Two published-limit checks as an evaluator writes them. */
  const LIMITS = `export interface Member { areaMm2: number; axialKn: number; lengthMm: number; radiusMm: number }
export interface Design { members: Member[]; spanMm: number; deflectionMm: number }
export interface Limits { yieldMpa: number; elasticGpa: number; gammaM0: number; gammaM1: number; imperfection: number; spanRatio: number }
export function capacityCovers(design: Design, limits: Limits): boolean {
  for (const member of design.members) {
    const squash = (member.areaMm2 * limits.yieldMpa) / 1000;
    let resistanceKn = squash / limits.gammaM0;
    if (member.axialKn < 0) {
      const euler = (Math.PI ** 2 * limits.elasticGpa * member.areaMm2 * member.radiusMm ** 2) / member.lengthMm ** 2;
      const slenderness = Math.sqrt(squash / euler);
      const phi = 0.5 * (1 + limits.imperfection * (slenderness - 0.2) + slenderness ** 2);
      resistanceKn = (Math.min(1, 1 / (phi + Math.sqrt(phi ** 2 - slenderness ** 2))) * squash) / limits.gammaM1;
    }
    if (!(resistanceKn >= Math.abs(member.axialKn))) return false;
  }
  return design.members.length > 0;
}
export function deflectionWithin(design: Design, limits: Limits): boolean {
  const allowedMm = design.spanMm / limits.spanRatio;
  const longest = design.members.reduce((most, member) => Math.max(most, member.lengthMm), 0);
  return Math.abs(design.deflectionMm) <= allowedMm && longest <= design.spanMm && limits.spanRatio >= 300;
}
`;

  it("refuses an agent module carrying the computations the correctness model decides with", () => {
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", RULES);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, AGENT_TOOLS_TS, "export const tools = [];\n");
    write(dir, "agent/truss.ts", RULES);
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.map((finding) => finding.code)).toEqual(["agent-carries-deciding-computation"]);
    expect(result.findings[0]?.file).toBe("agent/truss.ts");
    expect(result.findings[0]?.detail).toContain("massKg, utilisation");
  });

  it("refuses the same computations under renamed exports, which the name comparison admitted", () => {
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", RULES);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, AGENT_TOOLS_TS, "export const tools = [];\n");
    // The same two computations with every spelling changed: export names, parameter and type.
    // Renaming was the cheapest way out of this refusal while it compared names.
    write(
      dir,
      "agent/truss.ts",
      "export interface Shape { span: number }\nexport const weight = (s: Shape): number => s.span * 2;\nexport function ratio(s: Shape): number { return s.span / 3; }\n",
    );
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.map((finding) => finding.code)).toEqual(["agent-carries-deciding-computation"]);
    expect(result.findings[0]?.detail).toContain("massKg, utilisation");
  });

  it("leaves two computations apart when only the named operation differs", () => {
    // Executed repro. Every identifier used to become the order it first appeared in, so
    // `Math.min(d.span, 9)` and `Math.max(s.span, 9)` hashed to one computation, as did a pair
    // differing only in `Math.trunc` against `Math.round`. Two such collisions reach
    // SHARED_COMPUTATION_FLOOR and refused a bundle whose agent shares nothing with the verifier.
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", CM_OPERATIONS);
    write(dir, "correctness-model/evaluator.ts", "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, "agent/tools.ts", "export const tools = [];\n");
    write(
      dir,
      "agent/analysis.ts",
      "export interface Shape { span: number }\nexport const upperBound = (s: Shape): number => Math.max(s.span, 9);\nexport function count(s: Shape): number { const held = s.span; return Math.round(held); }\n",
    );
    expect(fingerprintSlug(dir).ok).toBe(true);
  });

  it("leaves two computations apart when only a literal's kind differs", () => {
    // Numeric `1` and string `"1"` both became `l:1`, so `x + 1` and `x + "1"` shared an identity,
    // as did `=== 1` and `=== "1"`: two collisions, enough to refuse an agent that shares nothing.
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(
      dir,
      "correctness-model/rules.ts",
      "export function step(x: number) { return x + 1; }\nexport function isUnit(x: unknown): boolean { return x === 1; }\n",
    );
    write(dir, "correctness-model/evaluator.ts", "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, "agent/tools.ts", "export const tools = [];\n");
    write(
      dir,
      "agent/labels.ts",
      'export function label(x: number) { return x + "1"; }\nexport function isOne(x: unknown): boolean { return x === "1"; }\n',
    );
    expect(fingerprintSlug(dir).ok).toBe(true);
  });

  it("still refuses that shape when the agent calls the operations the verifier calls", () => {
    // The hostile contrast: the same two computations, copied with every renameable spelling
    // changed. Nothing but the globals and members separates this from the case above.
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", CM_OPERATIONS);
    write(dir, "correctness-model/evaluator.ts", "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, "agent/tools.ts", "export const tools = [];\n");
    write(
      dir,
      "agent/analysis.ts",
      "export interface Shape { span: number }\nexport const floorSpan = (s: Shape): number => Math.min(s.span, 9);\nexport function whole(s: Shape): number { const held = s.span; return Math.trunc(held); }\n",
    );
    const result = fingerprintSlug(dir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.findings.map((finding) => finding.code)).toEqual(["agent-carries-deciding-computation"]);
    expect(result.findings[0]?.detail).toContain("lowerBound, tally");
  });

  it("leaves the solver its own analysis under the same natural names", () => {
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", RULES);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = (): unknown => ({ ok: true });\n");
    write(dir, AGENT_TOOLS_TS, "export const tools = [];\n");
    // A solver cannot design without analysing its own candidate, and two natural names collide
    // readily. Different computations under those names are the solver's own work.
    write(
      dir,
      "agent/analysis.ts",
      "export interface Design { span: number }\nexport const massKg = (d: Design): number => Math.round(d.span) * 7 + 1;\nexport function utilisation(d: Design): number { const limit = 9; return Math.min(1, d.span / limit); }\n",
    );
    expect(fingerprintSlug(dir).ok).toBe(true);
  });

  it("leaves the shared representation contract and a single shared helper name alone", () => {
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, "correctness-model/rules.ts", RULES);
    // Both bundles must agree on the artifact schema (rule 13), so a duplicated type and schema
    // constant is required, not a copy of the deciding computation.
    write(
      dir,
      "correctness-model/schema.ts",
      "export interface Design { span: number }\nexport const DESIGN_SCHEMA = { span: 0 };\n",
    );
    write(
      dir,
      "agent/schema.ts",
      "export interface Design { span: number }\nexport const DESIGN_SCHEMA = { span: 0 };\n",
    );
    write(dir, AGENT_TOOLS_TS, "export const massKg = (d: { span: number }): number => d.span * 2;\n");
    expect(fingerprintSlug(dir).ok).toBe(true);
  });

  it("leaves a tool that checks the solver's candidate against two published limits in the evaluator's own words", () => {
    // Rule 9 names this as legitimate solving support: a buckling-reduced capacity against the
    // member's axial force and a span-ratio deflection limit, each the evaluator's own statements,
    // run over a candidate the solver wrote. The tool's copies are its own private functions, and
    // the rule reads exported computations only, so the same two checks exported from an agent
    // module would reach the floor.
    const dir = slugDir();
    write(dir, BRIEF_FILE, "{}\n");
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, `${LIMITS}export const checks = {};\n`);
    write(
      dir,
      AGENT_TOOLS_TS,
      `${LIMITS.replaceAll("export ", "")}export const tools = [{ name: "self_check", execute: (d: Design, l: Limits) => [capacityCovers(d, l), deflectionWithin(d, l)] }];\n`,
    );
    expect(fingerprintSlug(dir).ok).toBe(true);
  });

  it("fingerprints typed generated correctness models and unmarked legacy models", () => {
    const generated = slugDir();
    write(generated, AGENT_TOOLS_TS, "export const tools = [];\n");
    write(generated, BRIEF_FILE, "{}\n");
    write(
      generated,
      CORRECTNESS_MODEL_EVALUATOR_TS,
      "export const solve = (): unknown => ({});\nexport const evaluate = (): unknown => ({ ok: true, issues: [] });\n",
    );
    expect(fingerprintSlug(generated).ok).toBe(true);

    const legacy = slugDir();
    write(legacy, AGENT_TOOLS_TS, "export const tools = [];\n");
    write(legacy, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = (value: any) => value;\n");
    expect(fingerprintSlug(legacy).ok).toBe(true);
  });

  it("accepts allowed packages and relative imports within the agent bundle", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `import { DraftStore } from "@ana/agent-bundle";\nimport { Type } from "@earendil-works/pi-ai";\nimport { CATALOG } from "./catalog.ts";\nexport { DraftStore, Type, CATALOG };\n`,
    );
    write(dir, "agent/catalog.ts", "export const CATALOG = [];\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scannedFiles).toBe(2);
  });

  it("refuses a Node builtin import in generated agent tools", () => {
    // In the hw03 audit, agent tools ran in the controller process and could use `node:fs`
    // to read hidden data. Keep this import check alongside the current worker sandbox.
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `import { readFileSync } from "node:fs";\nexport const leak = () => readFileSync("../correctness-model/tasks.json", "utf8");\n`,
    );
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("builtin-import");
  });

  it("fingerprinting a recorded slug yields both content hashes; agent edits move only agentHash", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, "correctness-model/tasks.ts", "export const hidden = 42;\n");
    const first = fingerprintSlug(dir, { slug: "demo" });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.slug).toBe("demo");

    write(dir, AGENT_TOOLS_TS, "export const a = 2;\n");
    const second = fingerprintSlug(dir, { slug: "demo" });
    if (!second.ok) throw new Error("unreachable");
    expect(second.agentHash).not.toBe(first.agentHash);
    expect(second.correctnessModelHash).toBe(first.correctnessModelHash);
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

  it("a symlink in the agent bundle is rejected, not skipped — unhashed entries evade the record (handover 2026-07-11)", () => {
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
});

describe("task identity vs verifier identity (steering-delta P1)", () => {
  it("editing tasks.json moves taskSetHash and leaves correctnessModelHash — task drift is not Correctness Model drift", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => null;\n");
    write(dir, "correctness-model/tasks.json", JSON.stringify([{ taskId: "t1", hidden: [1] }]));
    const first = fingerprintSlug(dir, { slug: "demo" });
    if (!first.ok) throw new Error("unreachable");
    expect(first.taskSetHash).toMatch(/^[0-9a-f]{64}$/);
    // tasks.json is not part of the verifier contract's file list
    expect(first.correctnessModelFiles.map((f) => f.path)).toEqual(["evaluator.ts"]);

    write(dir, "correctness-model/tasks.json", JSON.stringify([{ taskId: "t1", hidden: [2] }]));
    const second = fingerprintSlug(dir, { slug: "demo" });
    if (!second.ok) throw new Error("unreachable");
    expect(second.taskSetHash).not.toBe(first.taskSetHash);
    expect(second.correctnessModelHash).toBe(first.correctnessModelHash);
    expect(second.agentHash).toBe(first.agentHash);
  });

  it("editing the Correctness Model evaluator moves correctnessModelHash and leaves taskSetHash — the two hashes cover separate files", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => null;\n");
    write(dir, "correctness-model/tasks.json", JSON.stringify([{ taskId: "t1" }]));
    const first = fingerprintSlug(dir, { slug: "demo" });
    if (!first.ok) throw new Error("unreachable");

    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => 1;\n");
    const second = fingerprintSlug(dir, { slug: "demo" });
    if (!second.ok) throw new Error("unreachable");
    expect(second.correctnessModelHash).not.toBe(first.correctnessModelHash);
    expect(second.taskSetHash).toBe(first.taskSetHash);
  });

  it("a bundle without tasks.json states taskSetHash null — no silent equivalent", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, ONE_EXPORT);
    write(dir, CORRECTNESS_MODEL_EVALUATOR_TS, "export const evaluate = () => null;\n");
    const result = fingerprintSlug(dir, { slug: "demo" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.taskSetHash).toBeNull();
  });
});

describe("the specifier scan is a parser, not a word search (campaigns/bridge-truss 02 false positive)", () => {
  it("the bridge-truss specimen — bare from/import/require inside strings, arrays, comments — passes validation", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      [
        `import { DraftStore } from "@ana/agent-bundle";`,
        "// members import their section area from the catalog row",
        `const FROM_KEYS = ["from", "fromJoint", "startJoint"];`,
        `const note = 'we require "areaM2" and import nothing else';`,
        "export const pick = (row: Record<string, unknown>) => FROM_KEYS.map((k) => row[k]);",
        "export { DraftStore };",
      ].join("\n"),
    );
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("refuses an import or require whose module name is not a string literal", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `const name = "x";\nconst a = require(name);\nconst b = await import(name + "/y");\nexport { a, b };\n`,
    );
    const result = validateAgentBundle(join(dir, "agent"));
    const opaque = result.findings.filter((f) => f.detail.includes("must be a string literal"));
    expect(opaque).toHaveLength(2);
    expect(opaque.every((f) => f.code === "unvetted-import")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("refuses disallowed packages in re-exports and import-equals declarations", () => {
    const dir = slugDir();
    write(
      dir,
      AGENT_TOOLS_TS,
      `export * from "bad-pkg";\nimport legacy = require("worse-pkg");\nexport { legacy };\n`,
    );
    const result = validateAgentBundle(join(dir, "agent"));
    const codes = result.findings.map((f) => f.code);
    expect(codes.filter((c) => c === "unvetted-import")).toHaveLength(2);
  });

  it("checks a template-string module name that the former regex missed", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, "const g = require(`@ana/correctness-model-bundle`);\nexport { g };\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings.map((f) => f.code)).toEqual(["cross-isolation-import"]);
  });

  it("an argument-less import()/require() call fails closed, never skips", () => {
    const dir = slugDir();
    write(dir, AGENT_TOOLS_TS, "const a = require();\nexport { a };\n");
    const result = validateAgentBundle(join(dir, "agent"));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe("unvetted-import");
    expect(result.findings[0]?.detail).toContain("must be a string literal");
  });
});

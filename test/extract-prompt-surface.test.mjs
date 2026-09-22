import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One census over a throwaway repository: returns its parsed JSON output. */
function census(prefix, source, config) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/surface.ts"), source);
  writeFileSync(join(root, ".prompt-surface.json"), JSON.stringify({ dirs: ["src"], ...config }));
  const jsonPath = join(root, "census.json");
  const result = Bun.spawnSync([
    Bun.argv[0],
    join(import.meta.dir, "../.claude/skills/prompt-surface-census/scripts/extract-prompt-surface.mjs"),
    "--root",
    root,
    "--out",
    join(root, "census.md"),
    "--json",
    jsonPath,
    "--ts",
    Bun.resolveSync("typescript5", import.meta.dir),
  ]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

const names = (result) => result.surfaces.map((surface) => surface.name);
const missHolders = (result) => result.misses.map((miss) => miss.holder);

describe("prompt-surface holder names", () => {
  it("normalises a quoted property name before matching strong holders", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-surface-holder-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src/feedback.ts"),
      [
        'export const feedback = { "absence-sentinel": "The answer omitted a required spelling." };',
        `export const canonicalJson = "${"structural serializer ".repeat(9)}";`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, ".prompt-surface.json"),
      JSON.stringify({ dirs: ["src"], strong: ["absence-sentinel"], deny: ["canonicalJson"] }),
    );
    const jsonPath = join(root, "census.json");
    const result = Bun.spawnSync([
      Bun.argv[0],
      join(import.meta.dir, "../.claude/skills/prompt-surface-census/scripts/extract-prompt-surface.mjs"),
      "--root",
      root,
      "--out",
      join(root, "census.md"),
      "--json",
      jsonPath,
      "--ts",
      Bun.resolveSync("typescript5", import.meta.dir),
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    // The declaration that owns the object qualifies the quoted property name, so the row reads
    // `feedback.absence-sentinel` rather than a bare word with no owner.
    expect(parsed.surfaces).toContainEqual(
      expect.objectContaining({
        name: "feedback.absence-sentinel",
        text: expect.stringContaining("The answer omitted"),
      }),
    );
    expect(parsed.misses).toEqual([]);
  });

  it("lets a strong holder override an explicit deny", () => {
    // A strong holder is known model-visible text. Deny only classifies non-strong holders, so it
    // cannot hide this surface and the same row must not reappear as an unclaimed miss.
    const root = mkdtempSync(join(tmpdir(), "prompt-surface-deny-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "src/feedback.ts"),
      'export const ABSENCE_PROMPT = "The answer omitted a required spelling. ".repeat(3);',
    );
    writeFileSync(
      join(root, ".prompt-surface.json"),
      JSON.stringify({ dirs: ["src"], strong: ["ABSENCE_PROMPT"], deny: ["ABSENCE_PROMPT"] }),
    );
    const jsonPath = join(root, "census.json");
    const result = Bun.spawnSync([
      Bun.argv[0],
      join(import.meta.dir, "../.claude/skills/prompt-surface-census/scripts/extract-prompt-surface.mjs"),
      "--root",
      root,
      "--out",
      join(root, "census.md"),
      "--json",
      jsonPath,
      "--ts",
      Bun.resolveSync("typescript5", import.meta.dir),
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(parsed.surfaces).toEqual([
      expect.objectContaining({
        name: "ABSENCE_PROMPT",
        text: expect.stringContaining("The answer omitted"),
      }),
    ]);
    expect(parsed.misses).toEqual([]);
  });
});

describe("prompt-surface classification tiers", () => {
  it("claims a declared holder by its owner, and leaves a call argument to its callee", () => {
    // `responseContract` inside `buildPacketPrompt` is part of that prompt however it is named;
    // the text handed to `nonResult(...)` belongs to the callee, which is why the qualifier tier
    // stops at declarations. Both spellings sat in the unclaimed table before 2026-08-31.
    const result = census(
      "prompt-surface-qualifier-",
      [
        "export function buildPacketPrompt(): string {",
        '  const responseContract = "Return one JSON object with cases, hypotheses and one mechanism each.";',
        "  return responseContract;",
        "}",
        "export function recordRepairFeedback(): string {",
        "  return nonResult(",
        "    'the declared engine produced no verdict for this check, so the case grounds nothing and is recorded as a typed environment non-result',",
        "  );",
        "}",
        "function nonResult(reason: string): string {",
        "  return reason;",
        "}",
        "",
      ].join("\n"),
    );
    expect(names(result)).toContain("responseContract");
    expect(names(result)).not.toContain("nonResult()");
    expect(missHolders(result)).toContain("nonResult()");
  });

  it("denies on the head noun, so a location word in front of a text word does not hide it", () => {
    // `promptDigest` is still a digest. `fileLine`, which renders the Built agent's draft-file
    // sentence, is a line: denying it because the word `file` appears in front cost two live
    // Built-agent clauses in every census before 2026-08-31.
    const result = census(
      "prompt-surface-head-noun-",
      [
        "export function fileLine(count: number): string {",
        "  return `Draft files now: ${count}. Your own files were kept first when entries were left out.`;",
        "}",
        'export const promptDigest = "0f2a1c7d9b4e5a6f0f2a1c7d9b4e5a6f0f2a1c7d9b4e5a6f0f2a1c7d";',
        "",
      ].join("\n"),
    );
    expect(names(result)).toEqual(["fileLine"]);
  });
});

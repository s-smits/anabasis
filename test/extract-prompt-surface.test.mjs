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
    const result = census(
      "prompt-surface-holder-",
      [
        'export const feedback = { "absence-sentinel": "The answer omitted a required spelling." };',
        `export const canonicalJson = "${"structural serializer ".repeat(9)}";`,
        "",
      ].join("\n"),
      { strong: ["absence-sentinel"], deny: ["canonicalJson"] },
    );
    // The declaration that owns the object qualifies the quoted property name, so the row reads
    // `feedback.absence-sentinel` rather than a bare word with no owner.
    expect(result.surfaces).toContainEqual(
      expect.objectContaining({
        name: "feedback.absence-sentinel",
        text: expect.stringContaining("The answer omitted"),
      }),
    );
    expect(result.misses).toEqual([]);
  });

  it("lets a strong holder override an explicit deny", () => {
    // A strong holder is known model-visible text. Deny only classifies non-strong holders, so it
    // cannot hide this surface and the same row must not reappear as an unclaimed miss.
    const result = census(
      "prompt-surface-deny-",
      'export const ABSENCE_PROMPT = "The answer omitted a required spelling. ".repeat(3);',
      { strong: ["ABSENCE_PROMPT"], deny: ["ABSENCE_PROMPT"] },
    );
    expect(result.surfaces).toEqual([
      expect.objectContaining({
        name: "ABSENCE_PROMPT",
        text: expect.stringContaining("The answer omitted"),
      }),
    ]);
    expect(result.misses).toEqual([]);
  });
});

describe("prompt-surface classification tiers", () => {
  it("claims a declared holder by its owner, and leaves a call argument to its callee", () => {
    // `responseContract` inside `buildPacketPrompt` is part of that prompt however it is named;
    // the text handed to `nonResult(...)` belongs to the callee, which is why the qualifier tier
    // stops at declarations.
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
    // sentence, is a line, and denying it because the word `file` appears in front would hide a
    // live Built-agent clause.
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

describe("prompt-surface audiences", () => {
  const source = 'export const systemPrompt = "You are the reviewer; read the battery before you answer.";\n';
  const audiences = (result) => result.surfaces.map((surface) => surface.audience);

  it("claims a file by its stem, so a key needs no directory of that name", () => {
    // The Judge's files are `src/truth/judge.ts` and `judge-*.ts`; a key that only matched a
    // directory left every one of them to the wider `src/truth` label.
    const result = census("prompt-surface-stem-", source, {
      audiences: { src: "wide", "src/surface": "narrow" },
    });
    expect(audiences(result)).toEqual(["narrow"]);
  });

  it("does not claim a file whose name merely starts with the key", () => {
    const result = census("prompt-surface-partial-", source, {
      audiences: { src: "wide", "src/surf": "narrow" },
    });
    expect(audiences(result)).toEqual(["wide"]);
  });
});

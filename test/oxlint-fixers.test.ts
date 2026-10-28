import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { mapBack, verdict } from "../tools/oxlint/fix-loop.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

interface Span {
  readonly offset: number;
  readonly length: number;
  readonly line: number;
}

interface Diagnostic {
  readonly message: string;
  readonly code: string;
  readonly filename: string;
  readonly labels: readonly { readonly span: Span }[];
}

const UTF8 = "utf8";
const FIXER = resolve(import.meta.dirname, "../tools/oxlint/strict-boolean-fix.ts");
const PREDICATE = "--predicate=hasText:textOr:src/meta/text.ts";
const CODE = "typescript-eslint(strict-boolean-expressions)";
const MAIN = "src/fixture.ts";
const NAME = "row.name";
const FLAG = "row.flag";
const BOOLEAN =
  "Unexpected nullable boolean value in conditional. Please handle the nullish case explicitly.";
const STRING =
  "Unexpected nullable string value in conditional. Please handle the nullish and empty string cases explicitly.";
const NUMBER =
  "Unexpected nullable number value in conditional. Please handle the nullish and zero cases explicitly.";
/**
 * One site per wording the fixer knows, plus the shapes it refuses: `row.name || undefined`,
 * whose fallback the helper cannot return, `row.status && row.status !== 0`, where the conjunct
 * beside the guard already compares it, and the two numbers, which have no rewrite at all.
 */
const FIXTURE = `import { label } from "./label.ts";

interface Row {
  readonly flag?: boolean;
  readonly name?: string;
  readonly count?: number;
  readonly items?: readonly string[];
  readonly status?: number;
}

export function pick(row: Row): string {
  const id = row.name || "anon";
  const kept = row.name || undefined;
  return kept === undefined ? id : kept;
}

export function classify(row: Row): string {
  if (row.flag) return "on";
  if (!row.flag) return "off";
  if (row.name) return "named";
  if (row.count) return "counted";
  if (row.items?.length) return "filled";
  if (row.status && row.status !== 0) return "failed";
  return label(pick(row));
}
`;
const SWEPT = `import { label } from "./label.ts";
import { hasText, textOr } from "./meta/text.ts";

interface Row {
  readonly flag?: boolean;
  readonly name?: string;
  readonly count?: number;
  readonly items?: readonly string[];
  readonly status?: number;
}

export function pick(row: Row): string {
  const id = textOr(row.name, "anon");
  const kept = row.name || undefined;
  return kept === undefined ? id : kept;
}

export function classify(row: Row): string {
  if (row.flag === true) return "on";
  if (row.flag !== true) return "off";
  if (hasText(row.name)) return "named";
  if (row.count) return "counted";
  if (row.items?.length) return "filled";
  if (row.status && row.status !== 0) return "failed";
  return label(pick(row));
}
`;
describe("strict-boolean-fix", () => {
  /**
   * Seven edits land in one file and each one lengthens it, so every edit above the first sits
   * further along on disk than the offset the journal recorded. Putting them all back has to
   * restore the bytes the fixer was given, to the character.
   */
  it("rewrites each wording the report names, then puts the whole journal back byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-oxlint-fixer-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, MAIN), FIXTURE);
    const diagnostics = [
      [NAME, 1, STRING],
      [NAME, 2, STRING],
      [FLAG, 1, BOOLEAN],
      [FLAG, 2, BOOLEAN],
      [NAME, 3, STRING],
      ["row.count", 1, NUMBER],
      ["row.items?.length", 1, NUMBER],
      ["row.status", 1, NUMBER],
    ] as const;
    const report = join(dir, "report.json");
    writeFileSync(
      report,
      JSON.stringify({
        diagnostics: diagnostics.map(([snippet, nth, message]): Diagnostic => {
          let offset = -1;
          for (let seen = 0; seen < nth; seen += 1) offset = FIXTURE.indexOf(snippet, offset + 1);
          const line = FIXTURE.slice(0, offset).split("\n").length;
          return {
            message,
            code: CODE,
            filename: MAIN,
            labels: [{ span: { offset, length: snippet.length, line } }],
          };
        }),
      }),
    );
    expect(spawnTextSync(runtimeProcess.execPath, [FIXER, report, dir, PREDICATE], { cwd: dir }).status).toBe(
      0,
    );
    expect(readFileSync(join(dir, MAIN), UTF8)).toBe(SWEPT);
    expect(
      spawnTextSync(runtimeProcess.execPath, [FIXER, "--revert", `${report}.journal.json`, dir], { cwd: dir })
        .status,
    ).toBe(0);
    expect(readFileSync(join(dir, MAIN), UTF8)).toBe(FIXTURE);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fix-loop", () => {
  it("maps an edited line back to the line it came from", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["header", "a", "B", "c", "d"];
    expect(mapBack(before, after)).toEqual([0, 1, 1, 2, 3, 4]);
  });

  /**
   * A compiler error the fixer never caused is held on the round it appears and adds no hold on
   * the round after, so a loop asking only "were there new holds" reached a fixed point with that
   * error still in the tree and exited zero. The two claims are separate: no further automatic
   * progress, and a tree the compiler, the linter and the size policy accept.
   */
  it("accepts a fixed point only without findings and within the size policy", () => {
    for (const [round, findings, policy, held, code] of [
      [2, 1, "accepted", 1, 1],
      [4, 0, "refused", 0, 1],
      [2, 0, "accepted", 3, 0],
    ] as const) {
      const result = verdict(round, findings, policy, held);
      expect(result.code).toBe(code);
      expect(result.line.match(/\d+/gu)).toEqual([String(round), String(code === 0 ? held : findings)]);
    }
  });
});

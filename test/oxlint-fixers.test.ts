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
const TIGHT = "src/tight.ts";
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
const NARROW = `export function named(row: { readonly name?: string }): string {
  if (row.name) return row.name;
  return "";
}
`;

/** The diagnostic oxlint would write for the nth occurrence of `snippet`, in UTF-8 byte offsets. */
function diagnostic(text: string, snippet: string, nth: number, message: string): Diagnostic {
  let offset = -1;
  for (let seen = 0; seen < nth; seen += 1) offset = text.indexOf(snippet, offset + 1);
  const line = text.slice(0, offset).split("\n").length;
  return {
    message,
    code: CODE,
    filename: MAIN,
    labels: [{ span: { offset, length: snippet.length, line } }],
  };
}

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-oxlint-fixer-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, MAIN), FIXTURE);
  writeFileSync(join(dir, TIGHT), NARROW);
  return dir;
}

function runFixer(dir: string, rows: readonly Diagnostic[], extra: readonly string[]): void {
  const report = join(dir, "report.json");
  writeFileSync(report, JSON.stringify({ diagnostics: rows }));
  const done = spawnTextSync(runtimeProcess.execPath, [FIXER, report, dir, PREDICATE, ...extra], {
    cwd: dir,
  });
  expect(`${done.stdout}${done.stderr}`).toContain("sites");
  expect(done.status).toBe(0);
}

function revert(dir: string, wanted: readonly string[]): void {
  const done = spawnTextSync(
    runtimeProcess.execPath,
    [FIXER, "--revert", join(dir, "report.json.journal.json"), dir, ...wanted],
    { cwd: dir },
  );
  expect(done.status).toBe(0);
}

/** The `path:line` a reverting run names one site by. */
function siteLine(rows: readonly Diagnostic[], nth: number): string {
  return `${MAIN}:${String(rows[nth]?.labels[0]?.span.line ?? 0)}`;
}

function census(): Diagnostic[] {
  return [
    diagnostic(FIXTURE, NAME, 1, STRING),
    diagnostic(FIXTURE, NAME, 2, STRING),
    diagnostic(FIXTURE, FLAG, 1, BOOLEAN),
    diagnostic(FIXTURE, FLAG, 2, BOOLEAN),
    diagnostic(FIXTURE, NAME, 3, STRING),
    diagnostic(FIXTURE, "row.count", 1, NUMBER),
    diagnostic(FIXTURE, "row.items?.length", 1, NUMBER),
    diagnostic(FIXTURE, "row.status", 1, NUMBER),
  ];
}

describe("strict-boolean-fix", () => {
  it("rewrites each wording the report names, adds the one import, and refuses the three it cannot", () => {
    const dir = tree();
    runFixer(dir, census(), []);
    expect(readFileSync(join(dir, MAIN), UTF8)).toBe(SWEPT);
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * `(n ?? 0) !== 0` is the original test for every number but NaN, which is falsy and compares
   * unequal to zero, so the plain number was always refused. `.length` and `.size` were promoted
   * to a count and rewritten, because a count is never negative and never NaN — but the only
   * thing read was the property's spelling, and a declared `{ size?: number }` holding `-1` reads
   * as truthy where `(row.size ?? 0) > 0` reads as false. Both halves refuse now.
   */
  it("refuses every number, including the length it used to read as a count", () => {
    const dir = tree();
    const report = join(dir, "report.json");
    writeFileSync(report, JSON.stringify({ diagnostics: census() }));
    const done = spawnTextSync(runtimeProcess.execPath, [FIXER, report, dir, PREDICATE], { cwd: dir });
    expect(done.status).toBe(0);
    expect(`${done.stdout}${done.stderr}`).toContain("NaN");
    const swept = readFileSync(join(dir, MAIN), UTF8);
    expect(swept).toContain("if (row.count) return");
    expect(swept).toContain("if (row.items?.length) return");
    expect(swept).not.toContain("?? 0");
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A negative `size` is the counterexample the promotion could not see, so it is written out
   * rather than described: the fixer is handed the same diagnostic on a declared `{ size?:
   * number }` and must leave the line alone.
   */
  it("leaves a declared size alone, whose negative value no comparison against zero reproduces", () => {
    const dir = tree();
    const sized = "src/sized.ts";
    const source = `export function busy(row: { readonly size?: number }): boolean {
  if (row.size) return true;
  return false;
}
`;
    writeFileSync(join(dir, sized), source);
    const at = source.indexOf("row.size");
    const row = {
      message: NUMBER,
      code: CODE,
      filename: sized,
      labels: [{ span: { offset: at, length: "row.size".length, line: 2 } }],
    };
    runFixer(dir, [row], []);
    expect(readFileSync(join(dir, sized), UTF8)).toBe(source);
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * `textOr(a, b)` evaluates `b` whether or not `a` answers, and `a || b` does not. Only a
   * literal or a plain name may move; an awaited value, a tagged template and a member read
   * (a getter, or a throw on a missing object) stay where `||` left them.
   */
  it("moves only an inert fallback into the helper", () => {
    const dir = tree();
    const lazy = "src/lazy.ts";
    const source = `export async function names(row: { readonly name?: string; readonly alt: string }, next: Promise<string>, other: string): Promise<string[]> {
  return [row.name || await next, row.name || tag\`x\`, row.name || row.alt, row.name || other];
}
`;
    writeFileSync(join(dir, lazy), source);
    const rows = [0, 1, 2, 3].map((nth) => {
      let at = -1;
      for (let seen = 0; seen <= nth; seen += 1) at = source.indexOf(NAME, at + 1);
      const span = { offset: at, length: NAME.length, line: 2 };
      return { message: STRING, code: CODE, filename: lazy, labels: [{ span }] };
    });
    runFixer(dir, rows, []);
    const swept = readFileSync(join(dir, lazy), UTF8);
    expect(swept).toContain("row.name || await next, row.name || tag`x`, row.name || row.alt,");
    expect(swept).toContain("textOr(row.name, other)");
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the predicate out inline in a file that may not gain a line", () => {
    const dir = tree();
    const site = { offset: NARROW.indexOf(NAME), length: NAME.length, line: 2 };
    const row = { message: STRING, code: CODE, filename: TIGHT, labels: [{ span: site }] };
    runFixer(dir, [row], [`--constrained=${TIGHT}`]);
    const swept = readFileSync(join(dir, TIGHT), UTF8);
    expect(swept).toContain(`if ((row.name ?? "") !== "") return row.name;`);
    expect(swept).not.toContain("import");
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a line an earlier round could not compile exactly as it found it", () => {
    const dir = tree();
    const held = join(dir, "hold.txt");
    const rows = census();
    writeFileSync(held, `${MAIN}:${String(rows[4]?.labels[0]?.span.line ?? 0)}\n`);
    runFixer(dir, rows, [`--hold=${held}`]);
    const swept = readFileSync(join(dir, MAIN), UTF8);
    expect(swept).toContain(`if (row.name) return "named"`);
    expect(swept).toContain("if (row.flag === true) return");
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Seven edits land in one file and each one lengthens it, so every edit above the first sits
   * further along on disk than the offset the journal recorded. Putting them all back has to
   * restore the bytes the fixer was given, to the character.
   */
  it("puts a whole journal back, byte for byte, however far the file moved under it", () => {
    const dir = tree();
    runFixer(dir, census(), []);
    expect(readFileSync(join(dir, MAIN), UTF8)).toBe(SWEPT);
    revert(dir, []);
    expect(readFileSync(join(dir, MAIN), UTF8)).toBe(FIXTURE);
    rmSync(dir, { recursive: true, force: true });
  });

  /** One rejected line goes back; the rest of the sweep, including the import, stays as it landed. */
  it("hands back the one site a reader names and leaves the others alone", () => {
    const dir = tree();
    const rows = census();
    runFixer(dir, rows, []);
    revert(dir, [siteLine(rows, 2)]);
    const swept = readFileSync(join(dir, MAIN), UTF8);
    expect(swept).toContain(`if (row.flag) return "on"`);
    expect(swept).toContain("if (row.flag !== true) return");
    expect(swept).toContain("if (hasText(row.name)) return");
    expect(swept).toContain(`import { hasText, textOr } from "./meta/text.ts";`);
    rmSync(dir, { recursive: true, force: true });
  });
  /**
   * A journal is the list of edits the file on disk is carrying. After one selective revert it
   * named two that were no longer there, and the next run added their length change to the
   * running distance all the same — putting every later edit in that file back at the wrong
   * offset, refused by the text guard for a replacement and unseen for a deletion. Two reverts
   * in a row have to land where one naming both lands.
   */
  it("drops what a revert put back, so a second one reads the file the journal describes", () => {
    const rows = census();
    const once = tree();
    runFixer(once, rows, []);
    revert(once, [siteLine(rows, 2), siteLine(rows, 3)]);
    const together = readFileSync(join(once, MAIN), UTF8);

    const twice = tree();
    runFixer(twice, rows, []);
    revert(twice, [siteLine(rows, 2)]);
    revert(twice, [siteLine(rows, 3)]);
    expect(readFileSync(join(twice, MAIN), UTF8)).toBe(together);
    expect(together).toContain(`if (row.flag) return "on"`);
    expect(together).toContain(`if (!row.flag) return "off"`);
    rmSync(once, { recursive: true, force: true });
    rmSync(twice, { recursive: true, force: true });
  });
});

describe("fix-loop", () => {
  it("maps an edited line back to the line it came from", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["header", "a", "B", "c", "d"];
    expect(mapBack(before, after)).toEqual([0, 1, 1, 2, 3, 4]);
  });

  it("calls a fixed point converged only when the oracle names nothing", () => {
    expect(verdict(2, 0, "accepted", 3)).toEqual({ line: "converged after 2 round(s), 3 held", code: 0 });
  });

  /**
   * A compiler error the fixer never caused is held on the round it appears and adds no hold on
   * the round after, so a loop asking only "were there new holds" reached a fixed point with that
   * error still in the tree and exited zero. The two claims are separate: no further automatic
   * progress, and a tree the compiler, the linter and the size policy accept.
   */
  it("refuses a fixed point that still carries a finding, or an oversized file", () => {
    const left = verdict(2, 1, "accepted", 1);
    expect(left.code).toBe(1);
    expect(left.line).toBe("stopped after 2 round(s) with 1 finding(s) left: no further automatic progress");
    const fat = verdict(4, 0, "refused", 0);
    expect(fat.code).toBe(1);
    expect(fat.line).toContain("and the size policy refusing");
  });
});

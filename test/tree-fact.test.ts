/**
 * `tree/no-unowned-fact` (`tools/oxlint/tree-fact.ts`): one fact about a value written out in
 * three or more production files. The recorded case is "what the checker measured of a valid
 * answer", spelled four ways in three files until `measureOf` owned it on 5 November 2026; the
 * hostile cases are the same fact in two files, a test of one field, and a test read beside a
 * value of the code's own.
 */
import { describe, expect, it } from "bun:test";
import { factsWithoutOwner } from "../tools/oxlint/tree-fact.ts";

/** The four spellings the copies used, each with its own local names. */
const COMPARE = [
  "export function measured(verdicts: Map<string, Judged>, id: string): number | null {",
  "  const checker = verdicts.get(id)?.checker;",
  '  return checker?.kind === "pass" && checker.objective !== undefined ? checker.objective : null;',
  "}",
].join("\n");
const TOOLS = [
  "export function measures(solves: string[], verdicts: Map<string, Judged>): string[] {",
  "  return solves.flatMap((solve) => {",
  "    const found = verdicts.get(solve)?.checker;",
  '    return found?.kind === "pass" && found.objective !== undefined ? [String(found.objective)] : [];',
  "  });",
  "}",
].join("\n");
const GATE_ERA = [
  "export function row(verdict: Judged | undefined) {",
  '  const measure = verdict?.checker?.kind !== "pass" ? null : (verdict.checker.objective ?? null);',
  "  return { measure };",
  "}",
].join("\n");

const rows = (files: Record<string, string>) => factsWithoutOwner(new Map(Object.entries(files)));
const spanned = (files: Record<string, string>): string[][] =>
  rows(files).map((row) => [...new Set((row.places ?? []).map((place) => place.path))]);

describe("a fact without an owner", () => {
  it("is reported where one test and read of a value stand in three production files", () => {
    const found = rows({
      "src/kernel/compare.ts": COMPARE,
      "src/builder/tools.ts": TOOLS,
      "tools/wri/gate-era.ts": GATE_ERA,
    });
    expect(found.map((row) => [row.kind, row.path, row.line])).toStrictEqual([
      ["no-unowned-fact", "src/builder/tools.ts", 4],
    ]);
    expect(
      spanned({
        "src/kernel/compare.ts": COMPARE,
        "src/builder/tools.ts": TOOLS,
        "tools/wri/gate-era.ts": GATE_ERA,
      }),
    ).toStrictEqual([["src/builder/tools.ts", "src/kernel/compare.ts", "tools/wri/gate-era.ts"]]);
  });

  it("names a function whose whole body is the fact as the owner to call", () => {
    const owner = [
      "export function measureOf(verdict: Judged | undefined): number | null {",
      '  return verdict?.checker?.kind === "pass" ? (verdict.checker.objective ?? null) : null;',
      "}",
    ].join("\n");
    const [row] = rows({
      "src/kernel/solves.ts": owner,
      "src/builder/tools.ts": TOOLS,
      "tools/wri/gate-era.ts": GATE_ERA,
    });
    expect(row?.detail).toContain("`measureOf` in src/kernel/solves.ts");
  });

  it("is not reported at two files, nor where a test, a vendored copy or a skill makes the third", () => {
    expect(rows({ "src/kernel/compare.ts": COMPARE, "src/builder/tools.ts": TOOLS })).toStrictEqual([]);
    for (const third of ["test/compare.test.ts", "vendor/pi/compare.ts", ".claude/skills/x/scripts/y.ts"]) {
      expect(
        rows({ "src/kernel/compare.ts": COMPARE, "src/builder/tools.ts": TOOLS, [third]: GATE_ERA }),
      ).toStrictEqual([]);
    }
  });

  it("is not reported for a test of one field, however often it is written", () => {
    const one =
      'export const valid = (verdict: Verdict): boolean => verdict.kind === "pass" || verdict.kind === "skip";';
    expect(rows({ "src/a.ts": one, "src/b.ts": one, "tools/c.ts": one })).toStrictEqual([]);
  });

  it("is not reported where the second field is the value's id or is compared with a value of the code's own", () => {
    const identity = 'export const solveOf = (row: Row) => (row.seat === "solve" ? row.id : null);';
    const own = 'export const mine = (row: Row, seat: string) => row.kind === "call" && row.seat === seat;';
    expect(rows({ "src/a.ts": identity, "src/b.ts": identity, "tools/c.ts": identity })).toStrictEqual([]);
    expect(rows({ "src/a.ts": own, "src/b.ts": own, "tools/c.ts": own })).toStrictEqual([]);
  });
});

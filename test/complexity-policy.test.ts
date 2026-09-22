import { describe, expect, it } from "bun:test";
import {
  CYCLOMATIC_CEILING,
  complexityFindings,
  parseOxlintJson,
  reportLines,
  shrunkBaseline,
  type FunctionComplexity,
} from "../tools/loc/complexity-policy.ts";

const row = (path: string, name: string, complexity: number, line = 1): FunctionComplexity => ({
  path,
  line,
  name,
  complexity,
});
const checks = (measured: FunctionComplexity[], frozen = {}, roots = ["src"]) =>
  complexityFindings(measured, frozen, CYCLOMATIC_CEILING, roots).map((finding) => finding.check);

describe("complexity policy", () => {
  it("refuses a function above the ceiling and growth past a frozen count", () => {
    expect(checks([row("src/a.ts", "route", 31)])).toEqual(["above-ceiling"]);
    expect(checks([row("src/a.ts", "route", 31)], { "src/a.ts": { route: 30 } })).toEqual(["grown"]);
    expect(checks([row("src/a.ts", "route", 30)], { "src/a.ts": { route: 30 } })).toEqual([]);
  });

  it("refuses a stale baseline so the frozen set only shrinks", () => {
    const frozen = { "src/a.ts": { route: 30, "(anonymous)": 25 } };
    const measured = [row("src/a.ts", "route", 28), row("src/a.ts", "(anonymous)", 25, 40)];
    const findings = complexityFindings(measured, frozen, CYCLOMATIC_CEILING, ["src"]);
    expect(findings.map((finding) => finding.check)).toEqual(["stale-baseline"]);
    expect(findings[0]?.detail).toBe("route 28 was 30, stale: rerun with --write-baseline");
    expect(shrunkBaseline(measured, frozen, ["src"])).toEqual({
      "src/a.ts": { route: 28, "(anonymous)": 25 },
    });
    expect(shrunkBaseline([row("src/b.ts", "fresh", 40)], frozen, ["src"])).toEqual({});
  });

  it("leaves baseline entries outside the measured paths alone", () => {
    const frozen = { "src/a.ts": { route: 30 }, "src/b.ts": { other: 40 } };
    expect(checks([], frozen, ["src/a.ts"])).toEqual(["stale-baseline"]);
    expect(shrunkBaseline([], frozen, ["src/a.ts"])).toEqual({ "src/b.ts": { other: 40 } });
  });

  it("prints one capped line per file instead of a block per function", () => {
    const measured = [
      row("src/a.ts", "route", 31, 67),
      row("src/a.ts", "walk", 24, 200),
      row("src/b.ts", "read", 36, 12),
    ];
    expect(reportLines(complexityFindings(measured, {}, CYCLOMATIC_CEILING, ["src"]))).toEqual([
      "  src/a.ts — route:67 31, walk:200 24",
      "  src/b.ts — read:12 36",
    ]);
    const wide = Array.from({ length: 30 }, (_, n) => row(`src/f${n}.ts`, "f", 30));
    const lines = reportLines(complexityFindings(wide, {}, CYCLOMATIC_CEILING, ["src"]));
    expect(lines).toHaveLength(26);
    expect(lines.at(-1)).toBe("  … 5 more file(s)");
  });

  it("reads oxlint json rows, naming anonymous functions by one shared key", () => {
    const text = JSON.stringify({
      diagnostics: [
        {
          message: "async function `judgeSubject` has a complexity of 24. Maximum allowed is 21.",
          code: "eslint(complexity)",
          filename: "src/truth/judge.ts",
          labels: [{ span: { offset: 1, length: 2, line: 107, column: 8 } }],
        },
        {
          message: "function has a complexity of 30. Maximum allowed is 21.",
          code: "eslint(complexity)",
          filename: "src/solve/schema.ts",
          labels: [{ span: { offset: 1, length: 2, line: 355, column: 16 } }],
        },
        { message: "unused variable", code: "eslint(no-unused-vars)", filename: "src/x.ts", labels: [] },
      ],
    });
    expect(parseOxlintJson(text)).toEqual([
      row("src/truth/judge.ts", "judgeSubject", 24, 107),
      row("src/solve/schema.ts", "(anonymous)", 30, 355),
    ]);
    expect(() => parseOxlintJson("{}")).toThrow("no diagnostics array");
  });
});

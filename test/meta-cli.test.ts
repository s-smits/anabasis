import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "#skills/main/cli.ts";

describe("parseCliArgs", () => {
  test("reads values, repeated values, flags and positionals", () => {
    const parsed = parseCliArgs(["a.json", "--out", "/o", "--tag=x", "--tag", "y", "--json"], {
      values: ["out"],
      repeatable: ["tag"],
      flags: ["json"],
      positionals: 1,
    });
    expect(parsed.single.get("out")).toBe("/o");
    expect(parsed.repeated.get("tag")).toEqual(["x", "y"]);
    expect(parsed.flags.has("json")).toBe(true);
    expect(parsed.positionals).toEqual(["a.json"]);
  });

  test("refuses a misspelled option instead of ignoring it", () => {
    expect(() => parseCliArgs(["--rnu", "abc"], { values: ["run"] })).toThrow('unknown option "--rnu"');
  });

  test("counts positionals against the declared range, and a bare -- ends the options", () => {
    expect(() => parseCliArgs(["a", "b"], { positionals: 1 })).toThrow('unexpected positional argument "b"');
    expect(() => parseCliArgs([], { positionals: [1, 2] })).toThrow("expected at least 1 positional");
    expect(parseCliArgs(["--", "--x"], { positionals: 1 }).positionals).toEqual(["--x"]);
    expect(parseCliArgs(["-"], { positionals: 1 }).positionals).toEqual(["-"]);
  });
});

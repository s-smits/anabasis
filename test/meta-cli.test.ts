import { describe, expect, test } from "bun:test";
import { hostRoute, parseCliArgs, runCommand } from "#skills/main/cli.ts";
import { homedir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";

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

  test("refuses unknown options and positional bounds, and preserves bare positional spelling", () => {
    expect(() => parseCliArgs(["--rnu", "abc"], { values: ["run"] })).toThrow('unknown option "--rnu"');
    expect(() => parseCliArgs(["a", "b"], { positionals: 1 })).toThrow('unexpected positional argument "b"');
    expect(() => parseCliArgs([], { positionals: [1, 2] })).toThrow("expected at least 1 positional");
    expect(parseCliArgs(["--", "--x"], { positionals: 1 }).positionals).toEqual(["--x"]);
    expect(parseCliArgs(["-"], { positionals: 1 }).positionals).toEqual(["-"]);
  });
});

describe("hostRoute", () => {
  test("takes --host out before any --, and writes this home's paths as ~/", () => {
    const argv = [
      "pairs",
      "--host",
      "far",
      "/h/me/a,/h/me/b",
      "--tree=/h/me/t",
      "/h/mend",
      "--",
      "--host",
      "x",
    ];
    expect(hostRoute(argv, "/h/me")).toEqual({
      host: "far",
      args: ["pairs", "~/a,~/b", "--tree=~/t", "/h/mend", "--", "--host", "x"],
    });
    expect(hostRoute(["--host=far", "a"], "/h/me")).toEqual({ host: "far", args: ["a"] });
    expect(hostRoute(["a", "--", "--host", "far"], "/h/me")).toBeNull();
  });

  test("reads a ~/ the caller sent as this machine's home", async () => {
    let seen: string | undefined;
    await runCommand(
      { name: "t", usage: "", positionals: 1 },
      (args) => {
        seen = args.positionals[0];
      },
      ["~/sim/a"],
    );
    expect(seen).toBe(join(homedir(), "sim/a"));
  });
});

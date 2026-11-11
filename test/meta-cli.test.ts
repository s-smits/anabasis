import { describe, expect, test } from "bun:test";
import { hostRoute, parseCliArgs, runCommand } from "#skills/main/cli.ts";
import { homedir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";

describe("parseCliArgs", () => {
  test("reads values, repeated values, flags and positionals", () => {
    const parsed = parseCliArgs(["a.json", "--out", "/o", "--tag=x", "--tag", "y", "--json"], {
      options: { out: "text", tag: "list", json: "flag" },
      positionals: 1,
    });
    expect(parsed.values).toMatchObject({ out: "/o", tag: ["x", "y"], json: true });
    expect(parsed.positionals).toEqual(["a.json"]);
  });

  test("refuses what would run another condition, and preserves bare positional spelling", () => {
    const options = { run: "text", out: "text", json: "flag" } as const;
    // A misspelled option, an option taken as another's value, a flag given a value, one passed twice.
    expect(() => parseCliArgs(["--rnu", "abc"], { options })).toThrow(/--rnu/u);
    expect(() => parseCliArgs(["--out", "--json"], { options })).toThrow(/--out/u);
    expect(() => parseCliArgs(["--out"], { options })).toThrow(/--out/u);
    expect(() => parseCliArgs(["--json=1"], { options })).toThrow(/--json/u);
    expect(() => parseCliArgs(["--run", "a", "--run", "b"], { options })).toThrow(/--run.*once/u);
    expect(() => parseCliArgs(["-x"], { options })).toThrow(/-x/u);
    expect(parseCliArgs(["--run=--x"], { options }).values.run).toBe("--x");
    // The positionals are counted, except under --help, which -h spells too.
    expect(() => parseCliArgs(["a", "b"], { positionals: 1 })).toThrow(/1 positional.*got 2/u);
    expect(() => parseCliArgs([], { positionals: [1, 2] })).toThrow(/1 to 2 positional.*got 0/u);
    expect(parseCliArgs(["-h"], { positionals: 1 }).values.help).toBe(true);
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

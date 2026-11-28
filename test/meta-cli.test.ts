import { afterAll, describe, expect, test } from "bun:test";
import { hostRoute, parseCliArgs, runCommand, SKILL_REPO } from "#skills/main/cli.ts";
import { campaignName, namedLogs } from "#skills/main/logs.ts";
import { countsLine, formatTally, printed } from "#skills/main/print.ts";
import { summed } from "#skills/main/stats.ts";
import { overloadOf, spansOf, unionMs, waitedMs, waitsOf } from "#skills/main/time.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { MINUTE_MS } from "#src/meta/clock.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { repoRoot } from "#src/meta/git.ts";
import { homedir, tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";

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
    expect(() => parseCliArgs(["--rnu", "abc"], { options })).toThrow(/--rnu/u);
    expect(() => parseCliArgs(["--out", "--json"], { options })).toThrow(/--out/u);
    expect(() => parseCliArgs(["--out"], { options })).toThrow(/--out/u);
    expect(() => parseCliArgs(["--json=1"], { options })).toThrow(/--json/u);
    expect(() => parseCliArgs(["--run", "a", "--run", "b"], { options })).toThrow(/--run.*once/u);
    expect(() => parseCliArgs(["-x"], { options })).toThrow(/-x/u);
    expect(parseCliArgs(["--run=--x"], { options }).values.run).toBe("--x");
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

describe("shared skill library helpers", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-main-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("parses number and time options and refuses empty, non-decimal, non-finite, or non-ISO values", async () => {
    const spec = {
      name: "t",
      usage: "",
      options: { n: "number", at: "time", text: "text" },
    } as const;
    let got: { n: number | null; at: number | null } | undefined;
    await runCommand(
      spec,
      (args) => {
        got = { n: args.number("n"), at: args.time("at") };
      },
      ["--n=-1.5e2", "--at=2026-11-27T00:00:00Z"],
    );
    expect(got).toEqual({ n: -150, at: Date.parse("2026-11-27T00:00:00Z") });
    await runCommand(
      spec,
      (args) => {
        got = { n: args.number("n"), at: args.time("at") };
      },
      [],
    );
    expect(got).toEqual({ n: null, at: null });

    const probe = join(dir, "probe.ts");
    writeFileSync(
      probe,
      [
        `import { runCommand } from ${JSON.stringify(join(SKILL_REPO, ".claude/skills/main/cli.ts"))};`,
        `await runCommand({ name: "probe", usage: "", options: { n: "number", at: "time", bad: "flag" } }, (args) => {`,
        `  if (args.flag("bad")) args.number("at");`,
        `  args.number("n");`,
        `  args.time("at");`,
        `});`,
      ].join("\n"),
    );
    for (const bad of [
      ["--n="],
      ["--n= "],
      ["--n=0x10"],
      ["--n=NaN"],
      ["--n=Infinity"],
      ["--n=abc"],
      ["--at="],
      ["--at=5"],
      ["--at=not-a-date"],
    ]) {
      const ran = runSync([capturedExecPath, probe, ...bad]);
      expect(ran.exitCode, bad.join(" ")).toBe(2);
      expect(decodeOutput(ran.stderr)).toContain(bad[0]?.split("=")[0] ?? "");
    }
    const mismatch = runSync([capturedExecPath, probe, "--bad"]);
    expect(mismatch.exitCode).toBe(1);
    expect(decodeOutput(mismatch.stderr)).toContain("does not declare");
  });
});

describe("shared skill library formatting and folds", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-main-logs-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("resolves SKILL_REPO, git repoRoot, namedLogs, and campaignName", async () => {
    expect(repoRoot(SKILL_REPO)).toBe(realpathSync(SKILL_REPO));
    const alpha = join(dir, "alpha");
    const beta = join(dir, "beta");
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    const alphaLog = join(alpha, "log.jsonl");
    const betaLog = join(beta, "log.jsonl");
    writeFileSync(alphaLog, "");
    writeFileSync(betaLog, "");
    expect(campaignName(alphaLog)).toBe("alpha");
    expect(await namedLogs([alpha, betaLog])).toEqual([
      { name: "alpha", path: alphaLog },
      { name: "beta", path: betaLog },
    ]);
  });

  test("formats printed tables (default md and tsv), countsLine, formatTally, and summed", () => {
    expect(printed(["a", "b"], [["1", "2"]])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(printed(["a", "b"], [["1", "2"]], "tsv")).toBe("a\tb\n1\t2");
    expect(countsLine({ kept: 2, refused: 1 })).toBe("kept 2, refused 1");
    expect(countsLine({})).toBe("none");
    expect(countsLine({}, "empty")).toBe("empty");
    const total = summed([
      { wins: 3, losses: 1, ties: 2 },
      { wins: 1, losses: 2, ties: 0 },
    ]);
    expect(total).toEqual({ wins: 4, losses: 3, ties: 2 });
    expect(formatTally(total)).toBe("4-3-2");
  });

  test("folds log spans, overlapping wait unions, and host overload windows", () => {
    const at = (minutes: number) =>
      new Date(Date.parse("2026-11-27T00:00:00Z") + minutes * MINUTE_MS).toISOString();
    const events: LogEvent[] = [
      { at: at(0), kind: "build.started", data: { session: "b-1" } },
      { at: at(2), kind: "comparison.started", data: { session: "g-1" } },
      { at: at(4), kind: "solve.started", data: { cores: 4, load: [8] } },
      { at: at(6), kind: "campaign.waited", data: { for: "provider", ms: 10 * MINUTE_MS } },
      { at: at(10), kind: "campaign.ended", data: {} },
      { at: at(12), kind: "build.started", data: { session: "b-2" } },
      { at: at(16), kind: "comparison.reported", data: { session: "g-1" } },
      { at: at(18), kind: "build.finished", data: { session: "b-2" } },
    ];
    const spans = spansOf(events);
    expect(
      spans.map(({ part, id, from, until }) => ({ part, id, minutes: (until - from) / MINUTE_MS })),
    ).toEqual([
      { part: "builder", id: "b-1", minutes: 10 },
      { part: "comparisons", id: "g-1", minutes: 8 },
      { part: "comparisons", id: "g-1", minutes: 4 },
      { part: "builder", id: "b-2", minutes: 6 },
    ]);
    expect(unionMs(spans)).toBe(16 * MINUTE_MS);
    const waits = waitsOf(events);
    expect(waits).toEqual([{ from: Date.parse(at(6)), until: Date.parse(at(10)), kind: "provider" }]);
    expect(waitedMs(waits, Date.parse(at(0)), Date.parse(at(18)))).toBe(4 * MINUTE_MS);
    const lost = overloadOf(events)(Date.parse(at(4)), Date.parse(at(10)));
    expect(lost).toBeCloseTo(MINUTE_MS, 6);
  });
});

// The mutation oracle (`.claude/skills/mutation-testing/scripts/mutate.ts`) records a kill for a
// mutant its suite fails on (including Bun 1.4 `--bail` runs that print no pass/fail counts),
// refuses to mutate when a baseline suite fails unmutated, and supports both comparative (`--old`)
// and solo (`report` without `--old`) reporting.
import { afterAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { changedLinesInDiff, gitText } from "../src/meta/git.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { asRecord } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

const SCRIPT = join(import.meta.dir, "..", ".claude", "skills", "mutation-testing", "scripts", "mutate.ts");
const NIGHTLY = join(import.meta.dir, "..", ".claude", "skills", "mutation-testing", "scripts", "nightly.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-mutate-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const localPipe = () =>
  ({
    env: { ...Bun.env, ANA_CHECK_HOST: "here", ANA_HOSTS: "[]" },
    stdout: "pipe",
    stderr: "pipe",
  }) as const;

const runScript = (...argv: string[]) => Bun.spawnSync([capturedExecPath, SCRIPT, ...argv], localPipe());
const runNightly = (target: string, stateDir: string, extra: readonly string[] = []) =>
  Bun.spawnSync(
    [capturedExecPath, NIGHTLY, target, "--state", stateDir, "--timeout", "30", ...extra],
    localPipe(),
  );

interface Row {
  readonly id: string;
  readonly line: number;
  readonly label: string;
  readonly killed: Readonly<Record<string, boolean | null>>;
}
const rowsOf = (out: string): Row[] =>
  existsSync(out)
    ? readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          // SAFETY: every line is one the script appended, a mutant and its suites' verdicts.
          (line) => JSON.parse(line) as Row,
        )
    : [];

describe("the mutation oracle", () => {
  it("records bailed kills, solo and comparative reports, and survivor IDs", () => {
    // `above` is pinned at its bound and on both sides of it, so every mutant of it fails the first
    // test it reaches and the run bails; `label` is read by no test, so every mutant of it survives.
    const tree = join(root, "tree");
    mkdirSync(tree);
    writeFileSync(
      join(tree, "a.ts"),
      'export const above = (x: number) => {\n  console.log(x > 9);\n  return x > 1;\n};\nexport const label = (x: number) => (x > 5 ? "big" : "small");\n',
    );
    writeFileSync(
      join(tree, "a.test.ts"),
      [
        'import { expect, it } from "bun:test";',
        'import { above } from "./a.ts";',
        'it("is not above at its bound", () => expect(above(1)).toBe(false));',
        'it("is above past it", () => expect(above(2)).toBe(true));',
        'it("is not above below it", () => expect(above(0)).toBe(false));',
      ].join("\n"),
    );
    const suites = join(root, "suites.json");
    writeFileSync(suites, JSON.stringify({ t: ["a.test.ts"] }));
    const out = join(root, "out.jsonl");
    const run = runScript("run", tree, "a.ts", "--out", out, "--suites", suites, "--jobs", "1");
    expect(run.exitCode).toBe(0);
    const rows = rowsOf(out);
    const onLine = (line: number) => rows.filter((row) => row.line === line);
    expect(onLine(2)).toEqual([]);
    expect(onLine(3).length).toBeGreaterThan(0);
    expect(onLine(5).length).toBeGreaterThan(0);
    expect(new Set(onLine(3).map(({ killed }) => killed.t))).toStrictEqual(new Set([true]));
    expect(new Set(onLine(5).map(({ killed }) => killed.t))).toStrictEqual(new Set([false]));

    // Solo report (no `--old`) tallies killed/survived/unread and lists line-5 survivors.
    const solo = runScript("report", out);
    expect(solo.exitCode).toBe(0);
    expect(solo.stdout.toString().trim()).toBe(
      `file  killed  survived  unread\na.ts  ${String(onLine(3).length)}  ${String(onLine(5).length)}  0`,
    );
    const soloSurvivors = runScript("report", out, "--survivors");
    expect(soloSurvivors.exitCode).toBe(0);
    expect(soloSurvivors.stdout.toString().trim().split("\n")).toStrictEqual(onLine(5).map((row) => row.id));

    // Comparative report (`--old t` with no second suite) marks every line-3 kill as `O-`.
    const compared = runScript("report", out, "--old", "t");
    expect(compared.exitCode).toBe(0);
    expect(compared.stdout.toString().trim()).toBe(
      `file  ON  O-  -N  --  unread\na.ts  0  ${String(onLine(3).length)}  0  ${String(onLine(5).length)}  0`,
    );
  }, 60_000);

  it("records a mutant that hangs past --timeout as unread, never as a kill", () => {
    const tree = join(root, "hang-tree");
    mkdirSync(tree);
    writeFileSync(join(tree, "c.ts"), "export const done = (x: number) => x > 1;\n");
    writeFileSync(
      join(tree, "c.test.ts"),
      'import { expect, it } from "bun:test";\nimport { done } from "./c.ts";\nit("ends", () => {\n  while (!done(2)) {}\n  expect(done(2)).toBe(true);\n});\n',
    );
    const suites = join(root, "hang-suites.json");
    writeFileSync(suites, JSON.stringify({ old: ["c.test.ts"], new: ["c.test.ts"] }));
    const out = join(root, "hang-out.jsonl");
    const run = runScript(
      "run",
      tree,
      "c.ts",
      "--out",
      out,
      "--suites",
      suites,
      "--jobs",
      "2",
      "--timeout",
      "2",
    );
    expect(run.exitCode).toBe(0);
    const rows = rowsOf(out);
    const verdicts = Object.fromEntries(rows.map(({ label, killed }) => [label, killed]));
    expect(verdicts).toStrictEqual({
      "> -> >=": { old: false, new: false },
      "1 -> 2": { old: null, new: null },
    });
    expect(runScript("report", out, "--old", "old").stdout.toString().trim()).toBe(
      "file  ON  O-  -N  --  unread\nc.ts  0  0  0  1  1",
    );
    expect(runScript("report", out, "--old", "old", "--survivors").stdout.toString().trim()).toBe(
      rows
        .filter(({ label }) => label === "1 -> 2")
        .map(({ id }) => id)
        .join("\n"),
    );
  }, 60_000);

  it("refuses to run mutants when a baseline suite fails or gives no verdict unmutated", () => {
    const tree = join(root, "bad-tree");
    mkdirSync(tree);
    writeFileSync(join(tree, "b.ts"), "export const ok = (x: number) => x > 0;\n");
    writeFileSync(
      join(tree, "failing.test.ts"),
      'import { expect, it } from "bun:test";\nit("fails unmutated", () => expect(1).toBe(2));\n',
    );
    writeFileSync(join(tree, "broken.test.ts"), 'import { missing } from "./nope.ts";\nvoid missing;\n');
    for (const [kind, testFile, expected] of [
      ["failing", "failing.test.ts", "failed"],
      ["broken", "broken.test.ts", "failed"],
      ["missing", "does-not-exist.test.ts", "no verdict"],
    ] as const) {
      const suites = join(root, `${kind}-suites.json`);
      const out = join(root, `${kind}-out.jsonl`);
      writeFileSync(suites, JSON.stringify({ [kind]: [testFile] }));
      const run = runScript("run", tree, "b.ts", "--out", out, "--suites", suites, "--jobs", "1");
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain(
        `baseline suite "${kind}" did not pass unmutated (${expected})`,
      );
      expect(existsSync(out)).toBe(false);
    }
  }, 60_000);

  it("refuses a failing unmutated rest-wave suite, keeps subprocess suites unpruned, and marks mixed false/null rows unread", () => {
    const tree = join(root, "soundness-tree");
    mkdirSync(tree);
    writeFileSync(
      join(tree, "m.ts"),
      [
        "export const direct = (x: number) => x > 1;",
        "export const viaSub = (x: number) => x > 5;",
        "if (import.meta.main) console.log(String(viaSub(Number(process.argv[2]))));",
      ].join("\n"),
    );
    writeFileSync(
      join(tree, "hybrid.test.ts"),
      [
        'import { expect, it } from "bun:test";',
        'import { direct } from "./m.ts";',
        'it("checks direct", () => expect([direct(1), direct(2)]).toEqual([false, true]));',
        'it("checks via subprocess", () => {',
        '  const a = Bun.spawnSync([process.execPath, "m.ts", "5"], { cwd: import.meta.dir, stdout: "pipe" });',
        '  const b = Bun.spawnSync([process.execPath, "m.ts", "6"], { cwd: import.meta.dir, stdout: "pipe" });',
        '  expect([a.stdout.toString().trim(), b.stdout.toString().trim()]).toEqual(["false", "true"]);',
        "});",
      ].join("\n"),
    );
    writeFileSync(
      join(tree, "pass-first.test.ts"),
      'import { expect, it } from "bun:test";\nimport { direct } from "./m.ts";\nit("passes", () => expect(direct(2)).toBe(true));\n',
    );
    writeFileSync(
      join(tree, "fail-rest.test.ts"),
      'import { expect, it } from "bun:test";\nit("fails unmutated", () => expect(1).toBe(2));\n',
    );

    const subSuites = join(root, "sub-suites.json");
    const subOut = join(root, "sub-out.jsonl");
    writeFileSync(subSuites, JSON.stringify({ hybrid: ["hybrid.test.ts"] }));
    const subRun = runScript(
      "run",
      tree,
      "m.ts",
      "--out",
      subOut,
      "--suites",
      subSuites,
      "--prune",
      "--stop-at-kill",
      "--jobs",
      "1",
    );
    expect(subRun.exitCode).toBe(0);
    const subLine2 = rowsOf(subOut).filter((row) => row.line === 2);
    expect(subLine2.length).toBeGreaterThan(0);
    expect(subLine2.every(({ killed }) => killed.hybrid === true)).toBe(true);

    const restSuites = join(root, "rest-suites.json");
    const restOut = join(root, "rest-out.jsonl");
    writeFileSync(restSuites, JSON.stringify({ first: ["pass-first.test.ts"], rest: ["fail-rest.test.ts"] }));
    const restRun = runScript(
      "run",
      tree,
      "m.ts",
      "--out",
      restOut,
      "--suites",
      restSuites,
      "--prune",
      "--stop-at-kill",
      "--jobs",
      "1",
    );
    expect(restRun.exitCode).not.toBe(0);
    expect(restRun.stderr.toString()).toContain('baseline suite "rest" did not pass unmutated (failed)');

    const mixedOut = join(root, "mixed-out.jsonl");
    writeFileSync(
      mixedOut,
      `${JSON.stringify({ id: "m.ts:1:x", file: "m.ts", line: 1, label: "x", killed: { a: false, b: null } })}\n`,
    );
    expect(runScript("report", mixedOut).stdout.toString().trim()).toBe(
      "file  killed  survived  unread\nm.ts  0  0  1",
    );
  }, 60_000);

  it("matches isolated verdicts in schemata mode, hands watchdog timeouts to Mode 2, and detects helper subprocesses", () => {
    const tree = join(root, "schema-tree");
    mkdirSync(join(tree, "test", "helpers"), { recursive: true });
    writeFileSync(
      join(tree, "s.ts"),
      [
        "export function sumTo(n: number): number {",
        "  let acc = 0;",
        "  for (let i = 0; i < n; i = i + 1) {",
        "    acc = acc + i;",
        "  }",
        "  return acc;",
        "}",
        "export const inv = (x: unknown): unknown => !x;",
        "export const viaSub = (x: number) => x > 5;",
        "if (import.meta.main) console.log(String(viaSub(Number(process.argv[2]))));",
      ].join("\n"),
    );
    writeFileSync(
      join(tree, "test", "helpers", "sub.ts"),
      'export const callSub = (arg: string) => Bun.spawnSync([process.execPath, "s.ts", arg], { cwd: process.cwd(), stdout: "pipe" }).stdout.toString().trim();\n',
    );
    writeFileSync(
      join(tree, "test", "pure.test.ts"),
      'import { expect, it } from "bun:test";\nimport { inv, sumTo } from "../s.ts";\nit("sums", () => expect(sumTo(4)).toBe(6));\nit("preserves boolean type of !x", () => expect(typeof inv(undefined)).toBe("boolean"));\n',
    );
    writeFileSync(
      join(tree, "test", "helper-sub.test.ts"),
      'import { expect, it } from "bun:test";\nimport { callSub } from "./helpers/sub.ts";\nit("runs helper sub", () => expect([callSub("5"), callSub("6")]).toEqual(["false", "true"]));\n',
    );
    const suites = join(root, "schema-suites.json");
    writeFileSync(
      suites,
      JSON.stringify({ pure: ["test/pure.test.ts"], helperSub: ["test/helper-sub.test.ts"] }),
    );
    const outSchema = join(root, "schema-fast.jsonl");
    const outIso = join(root, "schema-iso.jsonl");
    const fast = runScript(
      "run",
      tree,
      "s.ts",
      "--out",
      outSchema,
      "--suites",
      suites,
      "--prune",
      "--stop-at-kill",
      "--jobs",
      "2",
      "--timeout",
      "2",
    );
    const iso = runScript(
      "run",
      tree,
      "s.ts",
      "--out",
      outIso,
      "--suites",
      suites,
      "--stop-at-kill",
      "--jobs",
      "2",
      "--timeout",
      "2",
    );
    expect([fast.exitCode, iso.exitCode]).toEqual([0, 0]);
    const statusOf = (killed: Readonly<Record<string, boolean | null>>) => {
      const vals = Object.values(killed);
      if (vals.includes(true)) return "killed";
      return vals.length > 0 && vals.every((v) => v === false) ? "survived" : "unread";
    };
    const byId = (rows: readonly Row[]) => Object.fromEntries(rows.map((r) => [r.id, statusOf(r.killed)]));
    expect(byId(rowsOf(outSchema))).toStrictEqual(byId(rowsOf(outIso)));
    const subRows = rowsOf(outSchema).filter((r) => r.line === 9);
    expect(subRows.length).toBeGreaterThan(0);
    expect(subRows.every((r) => r.killed.helperSub === true)).toBe(true);
    const notRow = rowsOf(outSchema).find((r) => r.line === 8 && r.label === "drop !");
    expect(notRow?.killed.pure).toBe(true);
    const hangRow = rowsOf(outSchema).find((r) => r.line === 3 && r.label === "+ -> -");
    expect(hangRow).toBeDefined();
    expect(statusOf(hangRow?.killed ?? {})).toBe("unread");

    writeFileSync(join(tree, "other.ts"), "export const flag = (n: number) => n > 0;\n");
    const onlyIds = join(root, "multi-only.txt");
    writeFileSync(onlyIds, `${notRow?.id ?? ""}\nother.ts:37:> -> >=\n`);
    const onlyRun = runScript(
      "run",
      tree,
      "s.ts",
      "other.ts",
      "--out",
      join(root, "multi-only.jsonl"),
      "--suites",
      suites,
      "--only",
      onlyIds,
      "--jobs",
      "1",
    );
    expect(onlyRun.exitCode).toBe(0);
    expect(onlyRun.stderr.toString()).not.toContain("stale --only IDs");
  }, 60_000);
});

const RUNNER = String.raw`#!/bin/sh
[ "$1" = test ] && [ -z "$ANA_RUNNER_ACTIVE" ] || exec "$ANA_REAL_BUN" "$@"
host=$ANA_CHECK_HOST
ran=$(grep -c "^$host " "$ANA_FAKE_LOG")
printf '%s %s %s %s\n' "$host" "$ANA_RUNNER_SPARE_HELD" "$ANA_RUNNER_WALL" "$PWD" >> "$ANA_FAKE_LOG"
case " $ANA_FAKE_DOWN " in *" $host "*) exit 255 ;; esac
case " $ANA_FAKE_BROKEN " in *" $host "*) printf '\n 0 pass\n 1 fail\n'; exit 1 ;; esac
[ "$host" != "$ANA_FAKE_FADES" ] || [ "$ran" -lt "$ANA_FAKE_FADE_AFTER" ] || exit 75
ANA_RUNNER_ACTIVE=1 exec "$ANA_REAL_BUN" "$@"
`;

describe.concurrent("the mutation oracle over check hosts", () => {
  const tree = join(root, "fleet-tree");
  mkdirSync(join(tree, "node_modules"), { recursive: true });
  writeFileSync(join(tree, "node_modules", "marker"), "");
  writeFileSync(
    join(tree, "a.ts"),
    'export const above = (x: number) => x > 1;\nexport const label = (x: number) => (x > 5 ? "big" : "small");\n',
  );
  writeFileSync(
    join(tree, "a.test.ts"),
    'import { expect, it } from "bun:test";\nimport { above } from "./a.ts";\nit("is above past its bound", () => expect([above(1), above(2)]).toEqual([false, true]));\n',
  );
  const suites = join(root, "fleet-suites.json");
  writeFileSync(suites, JSON.stringify({ t: ["a.test.ts"] }));
  const bin = join(root, "fleet-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), RUNNER);
  chmodSync(join(bin, "bun"), 0o755);
  const host = (name: string, checks?: number) => ({
    name,
    ssh: name,
    tree: "/srv/tree",
    bun: "bun",
    checks,
  });
  const hosts = (...list: ReturnType<typeof host>[]) => JSON.stringify(list);

  const fleet = (
    name: string,
    env: Readonly<Record<string, string | undefined>>,
    extra: readonly string[] = [],
  ) => {
    const out = join(root, `${name}.jsonl`);
    const log = join(root, `${name}.log`);
    if (!existsSync(log)) writeFileSync(log, "");
    const given = { ...Bun.env, PATH: `${bin}:${Bun.env.PATH ?? ""}`, ANA_REAL_BUN: capturedExecPath };
    const merged: Record<string, string | undefined> = { ...given, ANA_FAKE_LOG: log, ...env };
    for (const key of ["ANA_CHECK_HOST", "ANA_RUNNER_ACTIVE", "ANA_HOP"]) {
      if (!(key in env)) delete merged[key];
    }
    const run = Bun.spawnSync(
      [
        capturedExecPath,
        SCRIPT,
        "run",
        tree,
        "a.ts",
        "--out",
        out,
        "--suites",
        suites,
        "--timeout",
        "30",
        ...extra,
      ],
      {
        env: Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const rows = rowsOf(out);
    const sent = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [place = "", spare = "", wall = "", cwd = ""] = line.split(" ");
        return { place, spare, wall, cwd };
      });
    return {
      status: run.exitCode,
      stdout: run.stdout.toString(),
      stderr: run.stderr.toString(),
      out,
      rows,
      sent,
    };
  };
  const verdicts = (rows: readonly Row[]) => Object.fromEntries(rows.map(({ id, killed }) => [id, killed]));
  const here = (() => {
    const run = fleet("fleet-here", { ANA_CHECK_HOST: "here", ANA_HOSTS: hosts(host("a")) });
    expect(run.status).toBe(0);
    expect(run.sent).toEqual([]);
    expect(existsSync(join(`${run.out}.clone-0`, "node_modules", "marker"))).toBe(true);
    return verdicts(run.rows);
  })();

  it("reads every mutant over the hosts as this machine does, sparing a host that fails the suites unmutated and one that gives no verdict", () => {
    expect(Object.values(here).map(({ t }) => t)).toContain(true);
    expect(Object.values(here).map(({ t }) => t)).toContain(false);
    const run = fleet("fleet-spread", {
      ANA_HOSTS: hosts(host("a", 2), host("b", 1), host("d", 1)),
      ANA_FAKE_BROKEN: "b",
      ANA_FAKE_DOWN: "d",
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("mutants run on a (2), b (1), d (1) at once");
    expect(run.stderr).toContain(
      'baseline suite "t" did not pass unmutated (failed) on b; it takes no mutants',
    );
    expect(run.stderr).toContain(
      'baseline suite "t" did not pass unmutated (no verdict) on d; it takes no mutants',
    );
    expect(verdicts(run.rows)).toStrictEqual(here);
    expect(run.rows.length).toBe(Object.keys(here).length);
    const on = (place: string) => run.sent.filter((one) => one.place === place);
    expect([on("b").length, on("d").length]).toEqual([1, 1]);
    expect(on("a").length).toBe(1 + Object.keys(here).length);
    expect(new Set(on("a").map(({ cwd }) => cwd)).size).toBe(2);
    expect(new Set(run.sent.map(({ spare, wall }) => `${spare} ${wall}`))).toStrictEqual(new Set(["1 30"]));
    for (const { cwd } of run.sent) expect(existsSync(join(cwd, "node_modules"))).toBe(false);
  }, 60_000);

  it("spreads over the listed hosts under --fleet where ANA_CHECK_HOST keeps the run to one place", () => {
    const env = { ANA_CHECK_HOST: "all", ANA_HOSTS: hosts(host("a", 2), host("b", 1)) };
    const pinned = fleet("fleet-pinned", env);
    const spread = fleet("fleet-flag", env, ["--fleet"]);
    expect([pinned.status, spread.status]).toEqual([0, 0]);
    expect(new Set(pinned.sent.map(({ place }) => place))).toStrictEqual(new Set(["all"]));
    expect(spread.stderr).toContain("mutants run on a (2), b (1) at once");
    expect(new Set(spread.sent.map(({ place }) => place))).toStrictEqual(new Set(["a", "b"]));
    expect([verdicts(pinned.rows), verdicts(spread.rows)]).toStrictEqual([here, here]);
  }, 60_000);

  it("puts a mutant back where its host stops answering, and the host left reads it beside one down from the start", () => {
    const run = fleet("fleet-fades", {
      ANA_HOSTS: hosts(host("a", 1), host("e", 1), host("d", 1)),
      ANA_FAKE_FADES: "e",
      ANA_FAKE_FADE_AFTER: "1",
      ANA_FAKE_DOWN: "d",
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('baseline suite "t" did not pass unmutated (no verdict) on d');
    expect(run.stderr).toContain("e gave no verdict, so takes no more mutants");
    expect(verdicts(run.rows)).toStrictEqual(here);
    expect(run.rows.length).toBe(Object.keys(here).length);
  }, 60_000);

  it("leaves the mutants no host read for a rerun, which reads them and no other", () => {
    const first = fleet("fleet-rerun", {
      ANA_HOSTS: hosts(host("e", 1)),
      ANA_FAKE_FADES: "e",
      ANA_FAKE_FADE_AFTER: "3",
    });
    expect(first.status).not.toBe(0);
    expect(first.rows.length).toBe(2);
    const left = Object.keys(here).length - 2;
    expect(first.stderr).toContain(
      `${String(left)} mutants left unrun, since no place gave a verdict; run again`,
    );
    const again = fleet("fleet-rerun", { ANA_HOSTS: hosts(host("e", 1)) });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain(`${String(left)} mutants run, 2 held before`);
    expect(verdicts(again.rows)).toStrictEqual(here);
    expect(again.rows.length).toBe(Object.keys(here).length);
  }, 60_000);

  it("takes no mutant past --until, and a rerun reads them over shared copies it refreshes from the tree", () => {
    const shared = join(root, "fleet-shared");
    const past = new Date(Date.now() - 1000).toISOString();
    const stopped = fleet("fleet-until", { ANA_HOSTS: hosts(host("a", 1)) }, [
      "--until",
      past,
      "--clones",
      shared,
    ]);
    expect(stopped.status).not.toBe(0);
    expect(stopped.rows).toEqual([]);
    expect(stopped.stderr).toContain(
      `${String(Object.keys(here).length)} mutants left unrun at ${past}; run again`,
    );
    writeFileSync(join(`${shared}.clone-0`, "a.test.ts"), 'throw new Error("stale");\n');
    const again = fleet("fleet-until", { ANA_HOSTS: hosts(host("a", 1)) }, ["--clones", shared]);
    expect(again.status).toBe(0);
    expect(verdicts(again.rows)).toStrictEqual(here);
    expect(new Set(again.sent.map(({ cwd }) => cwd))).toStrictEqual(new Set([`${shared}.clone-0`]));
  }, 60_000);

  it("runs nothing where no host passes the suites unmutated", () => {
    const run = fleet("fleet-broken", { ANA_HOSTS: hosts(host("b", 2)), ANA_FAKE_BROKEN: "b" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('baseline suite "t" did not pass unmutated (failed) on b');
    expect(existsSync(run.out)).toBe(false);
    expect(run.sent.length).toBe(1);
  }, 60_000);

  it("runs at the one place an explicit ANA_CHECK_HOST names, without sparing held hosts, whatever the list holds", () => {
    const run = fleet("fleet-named", {
      ANA_CHECK_HOST: "a",
      ANA_HOSTS: hosts(host("a", 1), host("b", 1)),
      ANA_FAKE_BROKEN: "b",
    });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain("mutants run on");
    expect(verdicts(run.rows)).toStrictEqual(here);
    expect(new Set(run.sent.map(({ place, spare }) => `${place}:${spare}`))).toStrictEqual(new Set(["a:"]));
  }, 60_000);

  it("batches mutants remotely under --batch with --prune and matches single-mutant verdicts in fewer trips", () => {
    const covCache = join(root, "fleet-batch-cov");
    const batched = fleet(
      "fleet-batch",
      { ANA_HOSTS: hosts(host("a", 2), host("b", 1)), ANA_FAKE_BROKEN: "b" },
      ["--batch", "4", "--prune", "--cov-cache", covCache, "--stop-at-kill"],
    );
    expect(batched.status).toBe(0);
    expect(verdicts(batched.rows)).toStrictEqual(here);
    expect(batched.sent.length).toBeLessThan(1 + Object.keys(here).length);
    expect(existsSync(join(covCache, "t.ok"))).toBe(true);
    expect(existsSync(join(covCache, "t.lcov"))).toBe(true);
  }, 60_000);

  it("refuses a host list it cannot read, before it runs anything", () => {
    const run = fleet("fleet-unread", { ANA_HOSTS: "[{" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("ANA_HOSTS is not JSON");
    expect(run.stderr).toContain("ANA_CHECK_HOST=here without --fleet runs every suite on this machine");
    expect(run.sent).toEqual([]);
  }, 60_000);
});

describe("nightly mutation suite selection", () => {
  it("selects runtime transitive importers and literal matches fastest-first, drops type-only edges, and kills indirect mutants", () => {
    const tree = join(root, "nightly-tree");
    mkdirSync(join(tree, "src", "kernel"), { recursive: true });
    mkdirSync(join(tree, "test"), { recursive: true });
    writeFileSync(
      join(tree, "src", "kernel", "solve.ts"),
      "export type Flag = boolean;\nexport const above = (x: number): Flag => x > 1;\n",
    );
    writeFileSync(
      join(tree, "src", "cycle-a.ts"),
      'import { ping } from "./cycle-b.ts";\nimport { above } from "./kernel/solve.ts";\nexport const check = (x: number) => (ping() ? above(x) : false);\n',
    );
    writeFileSync(
      join(tree, "src", "cycle-b.ts"),
      'import { check } from "./cycle-a.ts";\nexport const ping = () => typeof check === "function";\n',
    );
    writeFileSync(
      join(tree, "test", "a-slow-indirect.test.ts"),
      'import { expect, it } from "bun:test";\nimport { check } from "../src/cycle-a.ts";\nit("passes", () => expect(check(2)).toBe(true));\n',
    );
    writeFileSync(
      join(tree, "test", "z-fast-indirect.test.ts"),
      'import { expect, it } from "bun:test";\nimport { check } from "../src/cycle-a.ts";\nit("bounds", () => expect([check(1), check(2)]).toEqual([false, true]));\n',
    );
    writeFileSync(
      join(tree, "test", "literal-mention.test.ts"),
      'import { expect, it } from "bun:test";\nit("mentions path", () => expect("src/kernel/solve.ts").toContain("solve"));\n',
    );
    writeFileSync(
      join(tree, "test", "type-only.test.ts"),
      'import { expect, it } from "bun:test";\nimport type { Flag } from "../src/kernel/solve.ts";\nconst ok: Flag = true;\nit("type only", () => expect(ok).toBe(true));\n',
    );
    writeFileSync(
      join(tree, "test", "unrelated.test.ts"),
      'import { expect, it } from "bun:test";\nit("unrelated", () => expect(1).toBe(1));\n',
    );
    writeFileSync(join(tree, "test", "unparseable.test.ts"), "export const = ;;;\n");
    gitText(tree, "init");
    gitText(tree, "config", "user.email", "test@example.com");
    gitText(tree, "config", "user.name", "Test");
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-m", "seed");
    const head = gitText(tree, "rev-parse", "HEAD");
    writeFileSync(
      join(tree, "test", ".test-timings.json"),
      JSON.stringify({
        version: 1,
        files: { "test/a-slow-indirect.test.ts": 50_000, "test/z-fast-indirect.test.ts": 100 },
      }),
    );
    const linked = join(root, "nightly-linked");
    gitText(tree, "worktree", "add", "--detach", linked, "HEAD");
    const sym = join(root, "nightly-link");
    symlinkSync(linked, sym);
    const linkedState = join(root, "nightly-linked-state");
    expect(runNightly(sym, linkedState).exitCode).toBe(0);
    const linkedChosen = asRecord(
      capturedJsonParse(readFileSync(join(linkedState, head, "src_kernel_solve.suites.json"), "utf8")),
    );
    expect(Object.keys(linkedChosen ?? {})).toEqual([
      "z-fast-indirect",
      "a-slow-indirect",
      "literal-mention",
    ]);

    const state = join(root, "nightly-state");
    expect(runNightly(tree, state).exitCode).toBe(0);
    const chosen = asRecord(
      capturedJsonParse(readFileSync(join(state, head, "src_kernel_solve.suites.json"), "utf8")),
    );
    expect(Object.keys(chosen ?? {})).toEqual(["z-fast-indirect", "a-slow-indirect", "literal-mention"]);
    const rows = rowsOf(join(state, head, "src_kernel_solve.jsonl"));
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        ({ killed }) =>
          killed["z-fast-indirect"] === true &&
          killed["a-slow-indirect"] === null &&
          killed["literal-mention"] === null,
      ),
    ).toBe(true);
    expect(capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"))).toEqual({
      commit: head,
      full: head,
    });

    const baselineReport = readFileSync(join(state, head, "report.md"), "utf8");
    const noop = runNightly(tree, state);
    expect(noop.exitCode).toBe(0);
    expect(noop.stdout.toString()).toContain("0 diff mutants");
    expect(readFileSync(join(state, head, "report.md"), "utf8")).toBe(baselineReport);

    writeFileSync(
      join(tree, "src", "kernel", "solve.ts"),
      "export type Flag = boolean;\nexport const above = (x: number): Flag => x > 1;\nexport const below = (x: number): Flag => x < 0;\n",
    );
    writeFileSync(join(tree, "src", "extra.ts"), "export const zero = (x: number) => x === 0;\n");
    writeFileSync(
      join(tree, "src", "extra-wrap.ts"),
      'import { zero } from "./extra.ts";\nexport const wrap = (x: number) => zero(x);\n',
    );
    writeFileSync(
      join(tree, "test", "extra.test.ts"),
      'import { expect, it } from "bun:test";\nimport { zero } from "../src/extra.ts";\nit("zero", () => expect([zero(0), zero(1)]).toEqual([true, false]));\n',
    );
    writeFileSync(
      join(tree, "test", "extra-indirect.test.ts"),
      'import { expect, it } from "bun:test";\nimport { wrap } from "../src/extra-wrap.ts";\nit("wrap", () => expect(wrap(0)).toBe(true));\n',
    );
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-m", "diff hunk");
    const head2 = gitText(tree, "rev-parse", "HEAD");
    expect(runNightly(tree, state).exitCode).toBe(3);
    const diffSolve = rowsOf(join(state, head2, `src_kernel_solve.diff-${head.slice(0, 9)}.jsonl`));
    expect(diffSolve.length).toBeGreaterThan(0);
    expect(diffSolve.every((row) => row.line === 3)).toBe(true);
    const diffExtra = rowsOf(join(state, head2, `src_extra.diff-${head.slice(0, 9)}.jsonl`));
    expect(diffExtra.length).toBeGreaterThan(0);
    expect(diffExtra.every(({ killed }) => killed.extra === true)).toBe(true);
    expect(
      capturedJsonParse(
        readFileSync(join(state, head2, `src_extra.diff-${head.slice(0, 9)}.suites.json`), "utf8"),
      ),
    ).toEqual({ extra: ["test/extra.test.ts"] });
    const diffReport = readFileSync(join(state, head2, "report.md"), "utf8");
    expect(diffReport).toContain("src/kernel/solve.ts:3  [2:");
    const recheckIds = readFileSync(join(state, head2, `survivors.diff-${head.slice(0, 9)}.ids.txt`), "utf8")
      .trim()
      .split("\n");
    expect(recheckIds).toEqual(diffSolve.map(({ id }) => id));
    expect(capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"))).toEqual({
      commit: head2,
      full: head,
    });

    writeFileSync(
      join(tree, "src", "kernel", "untested.ts"),
      "export const orphan = (x: number) => x > 0;\n",
    );
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-m", "untested only");
    const headUntested = gitText(tree, "rev-parse", "HEAD");
    expect(runNightly(tree, state).exitCode).toBe(3);
    expect(readFileSync(join(state, headUntested, "report.md"), "utf8")).toContain(
      "No nearby test: `src/kernel/untested.ts`",
    );

    writeFileSync(
      join(tree, "src", "extra.ts"),
      "// comment only\nexport const zero = (x: number) => x === 0;\n",
    );
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-m", "comment only");
    const head3 = gitText(tree, "rev-parse", "HEAD");
    expect(runNightly(tree, state).exitCode).toBe(0);
    expect(existsSync(join(state, head3, `src_extra.diff-${headUntested.slice(0, 9)}.jsonl`))).toBe(false);
    expect(capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"))).toEqual({
      commit: head3,
      full: head,
    });
    expect(runNightly(tree, state, ["--diff", head]).exitCode).toBe(3);
    expect(existsSync(join(state, head3, `src_extra.diff-${head.slice(0, 9)}.jsonl`))).toBe(true);
    expect(capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"))).toEqual({
      commit: head3,
      full: head,
    });
    const badRef = runNightly(tree, state, ["--diff", "nonexistent-ref"]);
    expect(badRef.exitCode).toBe(2);
    expect(badRef.stderr.toString()).toContain("not a reachable commit");
    const bothFlags = runNightly(tree, state, ["--diff", head, "--full"]);
    expect(bothFlags.exitCode).toBe(2);
    expect(bothFlags.stderr.toString()).toContain("cannot be combined");

    expect(runNightly(tree, state, ["--full"]).exitCode).toBe(3);
    expect(new Set(rowsOf(join(state, head3, "src_kernel_solve.jsonl")).map((row) => row.line))).toEqual(
      new Set([2, 3]),
    );
    expect(capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"))).toEqual({
      commit: head3,
      full: head3,
    });

    writeFileSync(join(tree, "test", ".test-timings.json"), "{broken");
    expect(runNightly(tree, join(root, "nightly-bad")).exitCode).toBe(0);

    gitText(tree, "update-ref", "refs/remotes/origin/main", head);
    gitText(tree, "checkout", "-q", "-f", "-B", "rebased", head);
    mkdirSync(join(tree, "tools", "sub"), { recursive: true });
    writeFileSync(join(tree, "tools", "sub", "run.ts"), "export const flag = (n: number) => n > 0;\n");
    writeFileSync(
      join(tree, "test", "sub.test.ts"),
      [
        'import { expect, it } from "bun:test";',
        'import { join } from "node:path";',
        'const dir = join("tools", "sub");',
        'it("reads dir", () => expect(dir).toContain("sub"));',
      ].join("\n"),
    );
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-m", "rebased stack");
    const head4 = gitText(tree, "rev-parse", "HEAD");
    expect(runNightly(tree, state).exitCode).toBe(3);
    expect(
      capturedJsonParse(
        readFileSync(join(state, head4, `tools_sub_run.diff-${head.slice(0, 9)}.suites.json`), "utf8"),
      ),
    ).toEqual({ sub: ["test/sub.test.ts"] });
    expect(readFileSync(join(state, head4, "report.md"), "utf8")).toContain(`(since ${head.slice(0, 9)})`);

    writeFileSync(join(tree, ".gitignore"), ".env\nignored/\n");
    mkdirSync(join(tree, "ignored"), { recursive: true });
    mkdirSync(join(tree, ".ana-mutate.stale"), { recursive: true });
    writeFileSync(join(tree, ".env"), "SECRET=1\n");
    writeFileSync(join(tree, "ignored", "huge.txt"), "skip-me\n");
    writeFileSync(join(tree, ".ana-mutate.stale", "old.txt"), "stale\n");
    const slashRefState = join(root, "nightly-slash-ref");
    expect(runNightly(tree, slashRefState, ["--diff", "origin/main"]).exitCode).toBe(3);
    expect(existsSync(join(slashRefState, head4, `tools_sub_run.diff-${head.slice(0, 9)}.jsonl`))).toBe(true);
    const clone0 = `${join(root, "git-clone.jsonl")}.clone-0`;
    const gitCloneSuites = join(root, "git-clone-suites.json");
    writeFileSync(gitCloneSuites, JSON.stringify({ sub: ["test/sub.test.ts"] }));
    const gitCloneRun = runScript(
      "run",
      tree,
      "tools/sub/run.ts",
      "--out",
      join(root, "git-clone.jsonl"),
      "--suites",
      gitCloneSuites,
      "--jobs",
      "1",
    );
    expect(gitCloneRun.exitCode).toBe(0);
    expect(existsSync(join(clone0, "tools", "sub", "run.ts"))).toBe(true);
    expect(existsSync(join(clone0, ".env"))).toBe(false);
    expect(existsSync(join(clone0, "ignored"))).toBe(false);
    expect(existsSync(join(clone0, ".ana-mutate.stale"))).toBe(false);
    expect(gitText(clone0, "rev-parse", "HEAD")).toBe(head4);
    expect(gitText(clone0, "rev-parse", "origin/main")).toBe(head);

    writeFileSync(
      join(tree, "test", "broken-base.test.ts"),
      'import { expect, it } from "bun:test";\nit("always fails baseline", () => expect(1).toBe(2));\n',
    );
    const mixedPlan = join(root, "mixed-plan.json");
    const okOut = join(root, "mixed-ok.jsonl");
    const badOut = join(root, "mixed-bad.jsonl");
    writeFileSync(
      mixedPlan,
      JSON.stringify([
        { file: "tools/sub/run.ts", out: okOut, suites: { sub: ["test/sub.test.ts"] } },
        {
          file: "src/kernel/solve.ts",
          out: badOut,
          suites: { broken: ["test/broken-base.test.ts"] },
        },
      ]),
    );
    const mixed = runScript("run", tree, "--plan", mixedPlan, "--jobs", "2", "--timeout", "30");
    expect(mixed.exitCode).toBe(2);
    expect(mixed.stderr.toString()).toContain('baseline suite "broken"');
    expect(rowsOf(okOut).length).toBeGreaterThan(0);
    expect(rowsOf(badOut).length).toBe(0);
  }, 60_000);

  it("parses unified=0 diff hunks across spaces, deletions, /dev/null, and --/++ content lines", () => {
    const sample = [
      "+++ b/stray.ts",
      "@@ -1 +1 @@",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,2 +5,0 @@",
      "-a",
      "-b",
      "@@ -8 +8 @@",
      "--- old",
      "+++ new",
      "@@ -10,0 +10,2 @@",
      "+x",
      "++ j",
      "@@ -12,2 +12,2 @@",
      "-first-old",
      "--- a/spoof.ts",
      "+first-new",
      "+++ b/spoof.ts",
      "@@ -20 +20 @@",
      "--- a/spoof2.ts",
      "+@@ -99 +99 @@",
      "+++ b/spoof2.ts",
      "--- a/src/direct.ts",
      "+++ b/src/direct.ts",
      "@@ -1 +4 @@",
      "-d0",
      "+d1",
      "diff --git a/src/has space.ts b/src/has space.ts",
      "--- a/src/has space.ts\t",
      "+++ b/src/has space.ts\t",
      "@@ -1 +3 @@",
      "-old",
      "+new",
      "diff --git a/src/gone.ts b/src/gone.ts",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-1",
      "-2",
      "-3",
    ].join("\n");
    const parsed = changedLinesInDiff(sample);
    expect([...parsed.keys()]).toEqual(["src/a.ts", "src/direct.ts", "src/has space.ts"]);
    expect([...(parsed.get("src/a.ts") ?? [])]).toEqual([8, 10, 11, 12, 13, 20]);
    expect([...(parsed.get("src/direct.ts") ?? [])]).toEqual([4]);
    expect([...(parsed.get("src/has space.ts") ?? [])]).toEqual([3]);
  });
});

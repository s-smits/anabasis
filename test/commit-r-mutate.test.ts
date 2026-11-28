// The mutation oracle (`.claude/skills/mutation-testing/scripts/mutate.ts`) records a kill for a
// mutant its suite fails on (including Bun 1.4 `--bail` runs that print no pass/fail counts),
// skips a suite failing unmutated at a place (refusing the place when none passes), spreads over
// check hosts, and supports both comparative (`--old`) and solo reporting; the nightly pass
// (`nightly.ts`) picks owners, suites and changed-line mutants and keeps its marks in `done.json`.
import { afterAll, describe, expect, it } from "bun:test";
import { planOf } from "../.claude/skills/mutation-testing/scripts/nightly.ts";
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
import { gitText } from "../src/meta/git.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
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

  it("reads a suite failing unmutated as null beside one that passes, runs a suite starting processes on lines it never runs in-process, reports false/null rows unread, and warns of stale --only IDs", () => {
    const tree = join(root, "skip-tree");
    mkdirSync(tree);
    writeFileSync(
      join(tree, "m.ts"),
      "export const direct = (x: number) => x > 1;\nexport function unused(x: number) {\n  return x < 0;\n}\n",
    );
    writeFileSync(
      join(tree, "spawned.test.ts"),
      'import { expect, it } from "bun:test";\nimport "./m.ts";\nconst child = \'const { unused } = await import("./m.ts"); process.exit(unused(0) ? 1 : 0);\';\nit("child", () => expect(Bun.spawnSync([process.execPath, "-e", child]).exitCode).toBe(0));\n',
    );
    writeFileSync(
      join(tree, "pass.test.ts"),
      'import { expect, it } from "bun:test";\nimport { direct } from "./m.ts";\nit("bounds", () => expect([direct(1), direct(2)]).toEqual([false, true]));\n',
    );
    writeFileSync(
      join(tree, "fail.test.ts"),
      'import { expect, it } from "bun:test";\nit("fails unmutated", () => expect(1).toBe(2));\n',
    );
    const suites = join(root, "skip-suites.json");
    writeFileSync(
      suites,
      JSON.stringify({ pass: ["pass.test.ts"], fail: ["fail.test.ts"], spawned: ["spawned.test.ts"] }),
    );
    const only = join(root, "skip-only.txt");
    writeFileSync(only, "m.ts:39:> -> >=\nm.ts:91:< -> <=\nm.ts:999:moved\n");
    const out = join(root, "skip-out.jsonl");
    const run = runScript(
      "run",
      tree,
      "m.ts",
      "--out",
      out,
      "--suites",
      suites,
      "--only",
      only,
      "--jobs",
      "1",
    );
    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString()).toContain(
      'baseline suite "fail" did not pass unmutated (failed); here skips it',
    );
    expect(run.stderr.toString()).toContain("stale --only IDs in m.ts: 1/3 matched no current mutant");
    expect(rowsOf(out).map(({ id, killed }) => [id, killed])).toStrictEqual([
      ["m.ts:39:> -> >=", { pass: true, fail: null, spawned: false }],
      ["m.ts:91:< -> <=", { pass: false, fail: null, spawned: true }],
    ]);
    const mixed = join(root, "mixed-out.jsonl");
    writeFileSync(
      mixed,
      `${JSON.stringify({ id: "m.ts:1:x", file: "m.ts", line: 1, label: "x", killed: { a: false, b: null } })}\n`,
    );
    expect(runScript("report", mixed).stdout.toString().trim()).toBe(
      "file  killed  survived  unread\nm.ts  0  0  1",
    );
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
    for (const key of ["ANA_CHECK_HOST", "ANA_RUNNER_ACTIVE", "ANA_RUNNER_SPARE_HELD", "ANA_HOP"]) {
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

  it("refuses a host list it cannot read, before it runs anything", () => {
    const run = fleet("fleet-unread", { ANA_HOSTS: "[{" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("ANA_HOSTS is not JSON");
    expect(run.stderr).toContain("ANA_CHECK_HOST=here without --fleet runs every suite on this machine");
    expect(run.sent).toEqual([]);
  }, 60_000);
});

describe("the nightly pass", () => {
  const tree = join(root, "nightly-tree");
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  };
  const commit = (message: string) => {
    gitText(tree, "add", ".");
    gitText(tree, "commit", "-q", "-m", message);
    return gitText(tree, "rev-parse", "HEAD");
  };
  const testOf = (name: string, imports: string, body: string) =>
    put(
      `test/${name}.test.ts`,
      `import { expect, it } from "bun:test";\n${imports}\nit("${name}", () => ${body});\n`,
    );
  const doneOf = (state: string) => capturedJsonParse(readFileSync(join(state, "done.json"), "utf8"));

  it("sweeps owners against every test reaching them, then mutates changed lines against direct importers", () => {
    put(
      "src/kernel/solve.ts",
      "export type Flag = boolean;\nexport const above = (x: number): Flag => x > 1;\n",
    );
    put(
      "src/cycle-a.ts",
      'import { ping } from "./cycle-b.ts";\nimport { above } from "./kernel/solve.ts";\nexport const check = (x: number) => (ping() ? above(x) : false);\n',
    );
    put(
      "src/cycle-b.ts",
      'import { check } from "./cycle-a.ts";\nexport const ping = () => typeof check === "function";\n',
    );
    testOf("a-slow-indirect", 'import { check } from "../src/cycle-a.ts";', "expect(check(2)).toBe(true)");
    testOf(
      "z-fast-indirect",
      'import { check } from "../src/cycle-a.ts";',
      "expect([check(1), check(2)]).toEqual([false, true])",
    );
    testOf("literal-mention", "", 'expect("src/kernel/solve.ts").toContain("solve")');
    testOf(
      "type-only",
      'import type { Flag } from "../src/kernel/solve.ts";\nconst ok: Flag = true;',
      "expect(ok).toBe(true)",
    );
    testOf("unrelated", "", "expect(1).toBe(1)");
    put("test/unparseable.test.ts", "export const = ;;;\n");
    put(".gitignore", ".env\n");
    gitText(tree, "init", "-q");
    gitText(tree, "config", "user.email", "test@example.com");
    gitText(tree, "config", "user.name", "Test");
    const head = commit("seed");
    put(".env", "SECRET=1\n");
    const timings = { "test/a-slow-indirect.test.ts": 50_000, "test/z-fast-indirect.test.ts": 100 };
    put("test/.test-timings.json", JSON.stringify({ version: 1, files: timings }));
    const chosen = ["z-fast-indirect", "a-slow-indirect", "literal-mention"];

    const linked = join(root, "nightly-linked");
    gitText(tree, "worktree", "add", "-q", "--detach", linked, "HEAD");
    symlinkSync(linked, join(root, "nightly-link"));
    const linkedHere = join(root, "nightly-linked-plan");
    mkdirSync(linkedHere);
    const linkedPlan = planOf(realpathSync(join(root, "nightly-link")), linkedHere, head, null);
    expect(linkedPlan.jobs.map(({ file, suites }) => [file, Object.keys(suites)])).toStrictEqual([
      ["src/kernel/solve.ts", chosen],
    ]);

    const state = join(root, "nightly-state");
    expect(runNightly(tree, state).exitCode).toBe(0);
    const rows = rowsOf(join(state, head, "src_kernel_solve.jsonl"));
    expect(rows.length).toBeGreaterThan(0);
    const [first = "", second = "", third = ""] = chosen;
    expect(new Set(rows.map(({ killed }) => JSON.stringify(killed)))).toStrictEqual(
      new Set([JSON.stringify({ [first]: true, [second]: null, [third]: null })]),
    );
    expect(doneOf(state)).toStrictEqual({ commit: head, full: head });
    expect(existsSync(join(state, "clone.clone-0", "test", "z-fast-indirect.test.ts"))).toBe(true);
    expect(existsSync(join(state, "clone.clone-0", ".env"))).toBe(false);
    const noop = runNightly(tree, state);
    expect([noop.exitCode, noop.stdout.toString().includes("0 diff mutants")]).toStrictEqual([0, true]);

    put(
      "src/kernel/solve.ts",
      "export type Flag = boolean;\nexport const above = (x: number): Flag => x > 1;\nexport const below = (x: number): Flag => x < 0;\n",
    );
    put("src/extra.ts", "export const zero = (x: number) => x === 0;\n");
    put(
      "src/extra-wrap.ts",
      'import { zero } from "./extra.ts";\nexport const wrap = (x: number) => zero(x);\n',
    );
    testOf(
      "extra",
      'import { zero } from "../src/extra.ts";',
      "expect([zero(0), zero(1)]).toEqual([true, false])",
    );
    testOf("extra-indirect", 'import { wrap } from "../src/extra-wrap.ts";', "expect(wrap(0)).toBe(true)");
    const head2 = commit("diff hunk");
    const diffStem = (owner: string) => join(state, head2, `${owner}.diff-${head.slice(0, 9)}`);
    expect(runNightly(tree, state).exitCode).toBe(3);
    const solveRows = rowsOf(`${diffStem("src_kernel_solve")}.jsonl`);
    expect(
      new Set(solveRows.map(({ line, killed }) => `${String(line)} ${String(killed["literal-mention"])}`)),
    ).toStrictEqual(new Set(["3 false"]));
    expect(rowsOf(`${diffStem("src_extra")}.jsonl`).every(({ killed }) => killed.extra === true)).toBe(true);
    expect(capturedJsonParse(readFileSync(`${diffStem("src_extra")}.suites.json`, "utf8"))).toStrictEqual({
      extra: ["test/extra.test.ts"],
    });
    expect(
      readFileSync(join(state, head2, `survivors.diff-${head.slice(0, 9)}.ids.txt`), "utf8")
        .trim()
        .split("\n"),
    ).toStrictEqual(solveRows.map(({ id }) => id));
    expect(readFileSync(join(state, head2, "report.md"), "utf8")).toContain("- `src/kernel/solve.ts:3  ");
    expect(doneOf(state)).toStrictEqual({ commit: head2, full: head });

    put("src/kernel/untested.ts", "export const orphan = (x: number) => x > 0;\n");
    const head3 = commit("untested only");
    expect(runNightly(tree, state).exitCode).toBe(3);
    expect(readFileSync(join(state, head3, "report.md"), "utf8")).toContain(
      "No nearby test: `src/kernel/untested.ts`",
    );

    put("src/extra.ts", "// comment only\nexport const zero = (x: number) => x === 0;\n");
    const head4 = commit("comment only");
    expect(runNightly(tree, state).exitCode).toBe(0);
    expect(existsSync(join(state, head4, `src_extra.diff-${head3.slice(0, 9)}.jsonl`))).toBe(false);
    expect(runNightly(tree, state, ["--diff", head]).exitCode).toBe(3);
    expect(existsSync(join(state, head4, `src_extra.diff-${head.slice(0, 9)}.jsonl`))).toBe(true);
    expect(doneOf(state)).toStrictEqual({ commit: head4, full: head });
    expect(runNightly(tree, state, ["--diff", "nonexistent-ref"]).exitCode).toBe(2);
    expect(runNightly(tree, state, ["--diff", head, "--full"]).exitCode).toBe(2);

    expect(runNightly(tree, state, ["--full"]).exitCode).toBe(3);
    expect(
      new Set(rowsOf(join(state, head4, "src_kernel_solve.jsonl")).map(({ line }) => line)),
    ).toStrictEqual(new Set([2, 3]));
    expect(doneOf(state)).toStrictEqual({ commit: head4, full: head4 });
    put("test/.test-timings.json", "{broken");
    expect(runNightly(tree, join(root, "nightly-bad")).exitCode).toBe(0);

    gitText(tree, "update-ref", "refs/remotes/origin/main", head);
    gitText(tree, "checkout", "-q", "-f", "-B", "rebased", head);
    put("tools/sub/run.ts", "export const flag = (n: number) => n > 0;\n");
    testOf(
      "sub",
      'import { join } from "node:path";\nconst dir = join("tools", "sub");',
      'expect(dir).toContain("sub")',
    );
    const head5 = commit("rebased stack");
    expect(runNightly(tree, state).exitCode).toBe(3);
    const subStem = join(state, head5, `tools_sub_run.diff-${head.slice(0, 9)}`);
    expect(capturedJsonParse(readFileSync(`${subStem}.suites.json`, "utf8"))).toStrictEqual({
      sub: ["test/sub.test.ts"],
    });
    expect(readFileSync(join(state, head5, "report.md"), "utf8")).toContain(`(since ${head.slice(0, 9)})`);
  }, 120_000);
});

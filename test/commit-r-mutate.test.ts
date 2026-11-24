// The commit-r mutation oracle (`.claude/skills/commit-r/scripts/mutate.ts`) records a kill for a
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
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

const SCRIPT = join(import.meta.dir, "..", ".claude", "skills", "commit-r", "scripts", "mutate.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-mutate-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const runScript = (...argv: string[]) =>
  Bun.spawnSync([capturedExecPath, SCRIPT, ...argv], {
    env: { ...Bun.env, ANA_CHECK_HOST: "here" },
    stdout: "pipe",
    stderr: "pipe",
  });

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
      'export const above = (x: number) => x > 1;\nexport const label = (x: number) => (x > 5 ? "big" : "small");\n',
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
    expect(onLine(1).length).toBeGreaterThan(0);
    expect(onLine(2).length).toBeGreaterThan(0);
    expect(new Set(onLine(1).map(({ killed }) => killed.t))).toStrictEqual(new Set([true]));
    expect(new Set(onLine(2).map(({ killed }) => killed.t))).toStrictEqual(new Set([false]));

    // Solo report (no `--old`) tallies killed/survived/unread and lists line-2 survivors.
    const solo = runScript("report", out);
    expect(solo.exitCode).toBe(0);
    expect(solo.stdout.toString().trim()).toBe(
      `file  killed  survived  unread\na.ts  ${String(onLine(1).length)}  ${String(onLine(2).length)}  0`,
    );
    const soloSurvivors = runScript("report", out, "--survivors");
    expect(soloSurvivors.exitCode).toBe(0);
    expect(soloSurvivors.stdout.toString().trim().split("\n")).toStrictEqual(onLine(2).map((row) => row.id));

    // Comparative report (`--old t` with no second suite) marks every line-1 kill as `O-`.
    const compared = runScript("report", out, "--old", "t");
    expect(compared.exitCode).toBe(0);
    expect(compared.stdout.toString().trim()).toBe(
      `file  ON  O-  -N  --  unread\na.ts  0  ${String(onLine(1).length)}  0  ${String(onLine(2).length)}  0`,
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

  const fleet = (name: string, env: Readonly<Record<string, string | undefined>>) => {
    const out = join(root, `${name}.jsonl`);
    const log = join(root, `${name}.log`);
    if (!existsSync(log)) writeFileSync(log, "");
    const given = { ...Bun.env, PATH: `${bin}:${Bun.env.PATH ?? ""}`, ANA_REAL_BUN: capturedExecPath };
    const merged: Record<string, string | undefined> = { ...given, ANA_FAKE_LOG: log, ...env };
    for (const key of ["ANA_CHECK_HOST", "ANA_RUNNER_ACTIVE", "ANA_HOP"]) {
      if (!(key in env)) delete merged[key];
    }
    const run = Bun.spawnSync(
      [capturedExecPath, SCRIPT, "run", tree, "a.ts", "--out", out, "--suites", suites, "--timeout", "30"],
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

  it("puts a mutant back where its host stops answering, and another host reads it", () => {
    const run = fleet("fleet-fades", {
      ANA_HOSTS: hosts(host("a", 1), host("e", 1)),
      ANA_FAKE_FADES: "e",
      ANA_FAKE_FADE_AFTER: "1",
    });
    expect(run.status).toBe(0);
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
    expect(run.stderr).toContain("ANA_CHECK_HOST=here runs every suite on this machine");
    expect(run.sent).toEqual([]);
  }, 60_000);
});

// The commit-r mutation oracle (`.claude/skills/commit-r/scripts/mutate.ts`) records a kill for a
// mutant its suite fails on (including Bun 1.4 `--bail` runs that print no pass/fail counts),
// refuses to mutate when a baseline suite fails unmutated, and supports both comparative (`--old`)
// and solo (`report` without `--old`) reporting.
import { afterAll, describe, expect, it } from "bun:test";
import {
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

const SCRIPT = join(import.meta.dir, "..", ".claude", "skills", "commit-r", "scripts", "mutate.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-mutate-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const runScript = (...argv: string[]) =>
  Bun.spawnSync(["bun", SCRIPT, ...argv], { stdout: "pipe", stderr: "pipe" });

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
    // SAFETY: every line is one the script appended, a mutant's line and its suites' verdicts.
    const rows = readFileSync(out, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string; line: number; killed: { t: boolean | null } });
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
    const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
    // SAFETY: every line is one the script appended, a mutant's line and its suites' verdicts.
    const rows = lines.map(
      (line) => JSON.parse(line) as { label: string; killed: Record<string, boolean | null> },
    );
    const verdicts = Object.fromEntries(rows.map(({ label, killed }) => [label, killed]));
    expect(verdicts).toStrictEqual({
      "> -> >=": { old: false, new: false },
      "1 -> 2": { old: null, new: null },
    });
    expect(runScript("report", out, "--old", "old").stdout.toString().trim()).toBe(
      "file  ON  O-  -N  --  unread\nc.ts  0  0  0  1  1",
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

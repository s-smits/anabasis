// The commit-r mutation oracle (`.claude/skills/commit-r/scripts/mutate.ts`) records a kill for a
// mutant its suite fails on, however the runner ends the run: Bun 1.4 prints no counts after
// `--bail` stops a suite at its first failure, only "Bailed out after 1 failure".
import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const SCRIPT = join(import.meta.dir, "..", ".claude", "skills", "commit-r", "scripts", "mutate.ts");
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-mutate-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the mutation oracle", () => {
  it("records a bailed suite's failure as a kill, a passing suite as a survivor, and no mutant as unread", () => {
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
    const run = Bun.spawnSync(
      ["bun", SCRIPT, "run", tree, "a.ts", "--out", out, "--suites", suites, "--jobs", "1"],
      { env: { ...runtimeProcess.env, ANA_CHECK_HOST: "here" }, stdout: "pipe", stderr: "pipe" },
    );
    expect(run.exitCode).toBe(0);
    // SAFETY: every line is one the script appended, a mutant's line and its suites' verdicts.
    const rows = readFileSync(out, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { line: number; killed: { t: boolean | null } });
    const onLine = (line: number) => rows.filter((row) => row.line === line).map(({ killed }) => killed.t);
    expect(onLine(1).length).toBeGreaterThan(0);
    expect(onLine(2).length).toBeGreaterThan(0);
    expect(new Set(onLine(1))).toStrictEqual(new Set([true]));
    expect(new Set(onLine(2))).toStrictEqual(new Set([false]));
  }, 60_000);
});

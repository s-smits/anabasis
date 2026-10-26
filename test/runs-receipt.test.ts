// Source selectors must mean the same for a named run and for a collection of runs.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { ranWith, writeReceipt } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-runs-receipt-")));
const repo = join(root, "repo");
const mechanism = "export const MECHANISM";
const modulePath = new URL("../tools/runs/receipt.ts", import.meta.url).pathname;
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(repo, "src"), { recursive: true });
gitText(repo, "init", "-q");
gitText(
  repo,
  "-c",
  "user.name=t",
  "-c",
  "user.email=t@t.dev",
  "commit",
  "-q",
  "--allow-empty",
  "-m",
  "before",
);
const before = gitText(repo, "rev-parse", "HEAD");
writeFileSync(join(repo, "src", "mechanism.ts"), `${mechanism} = 1;\n`);
gitText(repo, "add", "src");
gitText(repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", "commit", "-q", "-m", "mechanism");
const withMechanism = gitText(repo, "rev-parse", "HEAD");

function campaign(name: string, commits: readonly string[]): string {
  const folder = join(repo, "data", "runs", "here", name);
  mkdirSync(folder, { recursive: true });
  const log = join(folder, "log.jsonl");
  writeFileSync(log, "");
  for (const [index, commit] of commits.entries()) {
    writeReceipt(log, `run-${String(index + 1)}`, {
      at: "2026-10-26T00:00:00.000Z",
      pid: 1,
      flags: [],
      envFile: null,
      commit,
      dirty: false,
      load: 0,
      cores: 1,
    });
  }
  return log;
}

function source(...args: string[]) {
  const result = runSync(
    [
      capturedExecPath,
      "--no-env-file",
      "-e",
      `import { source } from ${JSON.stringify(modulePath)}; await source(${JSON.stringify(args)});`,
    ],
    { cwd: repo, env: { ...Bun.env, ANA_HOSTS: "[]" } },
  );
  return { code: result.exitCode, out: decodeOutput(result.stdout).trim(), err: decodeOutput(result.stderr) };
}

describe("run provenance selectors", () => {
  campaign("single", [withMechanism]);
  campaign("repeated", [withMechanism, withMechanism]);
  campaign("mixed", [before, withMechanism]);
  campaign("absent", [before]);
  campaign("unrecorded", []);
  campaign("unknown", ["f".repeat(40)]);

  it("requires every launch to carry every selector for named runs as for collections", () => {
    for (const selectors of [
      ["--has", mechanism],
      ["--holds", withMechanism],
      ["--holds", before, "--has", mechanism],
      ["--holds", withMechanism, "--has", mechanism],
    ]) {
      expect(source(...selectors)).toEqual({ code: 0, out: "repeated\nsingle", err: "" });
      for (const name of ["mixed", "absent", "unrecorded", "unknown"]) {
        expect(source(name, ...selectors)).toEqual({ code: 0, out: "", err: "" });
      }
      for (const name of ["single", "repeated"]) {
        const selected = source(name, ...selectors);
        expect(selected.code).toBe(0);
        expect(selected.out).toContain(withMechanism.slice(0, 9));
        expect(selected.err).toBe("");
      }
    }
  });

  it("requires all requested texts and commits even when another selector matches", () => {
    const log = join(repo, "data", "runs", "here", "single", "log.jsonl");
    expect(ranWith(log, repo, { holds: [before, withMechanism], has: [mechanism] })).toBe(true);
    for (const selectors of [
      ["--holds", withMechanism, "--has", "missing mechanism"],
      ["--has", mechanism, "--has", "missing mechanism"],
      ["--holds", withMechanism, "--holds", "f".repeat(40)],
    ]) {
      expect(source(...selectors)).toEqual({ code: 0, out: "", err: "" });
      expect(source("single", ...selectors)).toEqual({ code: 0, out: "", err: "" });
    }
  });

  it("refuses several run names instead of silently reading only the first", () => {
    for (const args of [
      ["single", "mixed"],
      ["single", "mixed", "--has", mechanism],
    ]) {
      const result = source(...args);
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain("source takes at most one run name");
    }
  });
});

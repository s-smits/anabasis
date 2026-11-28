// Source selectors must mean the same for a named run and for a collection of runs.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "../src/meta/subprocess.ts";
import { launchRun, ranWith, source, writeReceipt } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-runs-receipt-")));
const repo = join(root, "repo");
const mechanism = "export const MECHANISM";
afterAll(() => rmSync(root, { recursive: true, force: true }));

let before: string;
let withMechanism: string;

function campaign(name: string, commits: readonly string[]): void {
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
}

async function selected(...args: string[]) {
  const output: string[] = [];
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const printed = spyOn(console, "log").mockImplementation((text: string) => {
    output.push(text);
  });
  try {
    await source(args);
    expect(errors).not.toHaveBeenCalled();
    return output.join("\n");
  } finally {
    printed.mockRestore();
    errors.mockRestore();
  }
}

describe("run provenance selectors", () => {
  const cwd = process.cwd();
  const peers = Bun.env.ANA_HOSTS;
  beforeAll(() => {
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
    before = gitText(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "src", "mechanism.ts"), `${mechanism} = 1;\n`);
    gitText(repo, "add", "src");
    gitText(repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", "commit", "-q", "-m", "mechanism");
    withMechanism = gitText(repo, "rev-parse", "HEAD");
    campaign("single", [withMechanism]);
    campaign("repeated", [withMechanism, withMechanism]);
    campaign("mixed", [before, withMechanism]);
    campaign("absent", [before]);
    campaign("unrecorded", []);
    campaign("unknown", ["f".repeat(40)]);
    process.chdir(repo);
    Bun.env.ANA_HOSTS = "[]";
  });
  afterAll(() => {
    process.chdir(cwd);
    if (peers === undefined) delete Bun.env.ANA_HOSTS;
    else Bun.env.ANA_HOSTS = peers;
  });

  it("requires all requested texts and commits even when another selector matches", async () => {
    const log = join(repo, "data", "runs", "here", "single", "log.jsonl");
    expect(ranWith(log, repo, { holds: [before, withMechanism], has: [mechanism] })).toBe(true);
    for (const selectors of [
      ["--holds", withMechanism, "--has", "missing mechanism"],
      ["--has", mechanism, "--has", "missing mechanism"],
      ["--holds", withMechanism, "--holds", "f".repeat(40)],
    ]) {
      expect(await selected(...selectors)).toBe("");
      expect(await selected("single", ...selectors)).toBe("");
    }
  });
});

describe("a launched run", () => {
  it("runs in a process group of its own, its output named for the log's next run", async () => {
    campaign("launched", ["c1"]);
    const log = join(repo, "data", "runs", "here", "launched", "log.jsonl");
    const { pid, err } = launchRun([capturedExecPath, "--eval=setTimeout(()=>{},3e4)"], log, {
      cwd: root,
      env: runtimeProcess.env,
    });
    try {
      expect(err).toBe(join(repo, "data", "runs", "here", "launched", "launch-run-2.err"));
      expect(runTextSyncOrThrow(["ps", "-o", "pgid=", "-p", String(pid)]).trim()).toBe(String(pid));
    } finally {
      expect(await terminateAndReapProcessGroupId(pid)).toBe(true);
    }
  });
});

// Source selectors must mean the same for a named run and for a collection of runs.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { hostPython } from "../tools/runs/host-facts.ts";
import { ranWith, type Receipt, source, sources, writeReceipt } from "../tools/runs/receipt.ts";

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

  it("requires every launch to carry every selector for named runs as for collections", async () => {
    for (const selectors of [
      ["--has", mechanism],
      ["--holds", withMechanism],
      ["--holds", before, "--has", mechanism],
      ["--holds", withMechanism, "--has", mechanism],
    ]) {
      expect(await selected(...selectors)).toBe("repeated\nsingle");
      for (const name of ["mixed", "absent", "unrecorded", "unknown"]) {
        expect(await selected(name, ...selectors)).toBe("");
      }
      for (const name of ["single", "repeated"]) {
        expect(await selected(name, ...selectors)).toContain(withMechanism.slice(0, 9));
      }
    }
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

describe("what a launch records of the host's Python", () => {
  /** A folder holding a `python3` that runs `body`. */
  function pythonIn(name: string, body: string): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "python3"), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, "python3"), 0o755);
    return dir;
  }
  const said = (version: string, ...packages: string[]) =>
    `echo '${capturedJsonStringify([version, packages])}'`;

  it("reads the first python3 on the path, with its packages sorted", () => {
    const first = pythonIn("first", said("3.14.7", "scipy==1", "numpy==2"));
    const second = pythonIn("second", said("3.15.0"));
    expect(hostPython([join(root, "none"), first, second])).toEqual({
      version: "3.14.7",
      packages: ["numpy==2", "scipy==1"],
    });
  });

  it("reads no Python from an empty path, one that fails, or one that prints something else", () => {
    expect(hostPython([join(root, "none")])).toBeNull();
    expect(hostPython([pythonIn("fails", "exit 3")])).toBeNull();
    expect(hostPython([pythonIn("prose", "echo not json")])).toBeNull();
  });

  it("isolates the probe from the shell that launched it, as a solve's own home is", () => {
    const argv = pythonIn("argv", `[ "$1" = "-I" ] || exit 9\n${said("3.14.7")}`);
    expect(hostPython([argv])?.version).toBe("3.14.7");
  });

  it("tells two launches apart by their packages", () => {
    const launch = (name: string, python: Receipt["python"]) => {
      const folder = join(root, name);
      mkdirSync(folder, { recursive: true });
      const log = join(folder, "log.jsonl");
      writeReceipt(log, "run-1", {
        at: "2026-11-05T00:00:00.000Z",
        pid: 1,
        flags: [],
        envFile: null,
        commit: before,
        dirty: false,
        load: 0,
        cores: 1,
        ...keyIfDefined("python", python),
      });
      return sources(log, repo, []).filter((line) => line.includes("python"));
    };
    const [one] = launch("py-one", { version: "3.14.7", packages: ["numpy==2"] });
    const [other] = launch("py-other", { version: "3.14.7", packages: [] });
    expect(one).toContain("3.14.7, 1 packages");
    expect(other).toContain("3.14.7, 0 packages");
    expect(one?.split(" ").at(-1)).not.toBe(other?.split(" ").at(-1));
    expect(launch("py-none", null)).toEqual(["  no python3 answered on the wall's path"]);
    expect(launch("py-old", undefined)).toEqual([]);
  });
});

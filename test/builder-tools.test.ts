/**
 * The seven capabilities the Builder actually holds — read, write, edit, bash, grep, find and ls —
 * driven through a real isolation rather than a stub. The question here is not whether the wall
 * works, which is settled elsewhere, but whether each tool goes through it: a tool that reads the
 * filesystem directly would pass every functional assertion about what it returned and quietly have
 * no wall in front of it at all. So the cases run against a fixture repo with a derived policy, and
 * the path record is read back afterwards to show which accesses were allowed and which denied.
 *
 * Two things bound what a pass here means. The capability block is
 * `describe.if(osIsolationSupport().ok)`, so on a host with neither Darwin Seatbelt nor Linux
 * Bubblewrap available it does not run and reports nothing — a green suite on such a host has not
 * exercised these tools. And the policy itself, along with the OS enforcement behind it, belongs to
 * `candidate-isolation-policy.test.ts` and `candidate-isolation-guard.test.ts` for the decisions and
 * to `candidate-isolation-darwin.test.ts` and `candidate-isolation-linux.test.ts` for the executed
 * children.
 *
 * The refusals carry their own obligation. A typed error is not enough on its own, because the text
 * that explains the refusal is written for a model that must not learn what it just failed to
 * reach, so the assertions check both that the error is typed and that no protected measurement
 * content rode out with it. What the cases cover is the listed accesses, not every path the
 * filesystem could offer.
 */
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
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, relative } from "../src/meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { afterAll, describe, expect, it } from "bun:test";
import {
  CandidateIsolationRefusal,
  openPathRecord,
  readPathRecordRows,
} from "../src/builder/candidate-isolation-runtime.ts";
import {
  type CandidateIsolationBinding,
  deriveCandidateIsolation,
} from "../src/builder/candidate-isolation.ts";
import { type BuilderIsolation, createBuilderTools } from "../src/builder/tools.ts";
import { SAFEGUARDS_LOG_FILE, createSafeguardContext } from "../src/meta/safeguard.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";

const SCRATCH = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-toolkit-")));
interface MakeFixtureRepoResult {
  repoRoot: string;
  binding: CandidateIsolationBinding;
}

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

import { REMEDY_LEAK, seedIsolationFixture } from "./helpers/isolation-fixture.ts";

function makeFixtureRepo(): MakeFixtureRepoResult {
  const fixture = seedIsolationFixture(SCRATCH, "repo", {
    correctnessBarrels: true,
    rootFiles: { ".env": "SECRET=hunter2\n", "package.json": "{}\n" },
    iterationFiles: {
      "slug/correctness-model/brief.json": '{"authored":true}\n',
      "slug/poem.txt": "line one\nline two\nline three\na -dash row\nstopped at exit(12\n",
      "census.json": JSON.stringify({ findings: [{ detail: REMEDY_LEAK }] }),
    },
  });
  return { repoRoot: fixture.repoRoot, binding: fixture.binding };
}

const FIXTURE = makeFixtureRepo();

describe("the durable path-record sequence", () => {
  it("continues after the highest existing row when an epoch resumes", () => {
    const epochDir = join(SCRATCH, "resumed-epoch");
    mkdirSync(epochDir, { recursive: true });
    writeFileSync(
      join(epochDir, "builder-path-record.jsonl"),
      `${JSON.stringify({
        seq: 7,
        at: "2026-07-31T00:00:00.000Z",
        sessionId: "earlier",
        guardId: "candidate-isolation/guardPath@v1",
        capability: "read",
        mode: "read",
        policyDigest: "a".repeat(64),
        profileDigest: null,
        requested: "STARTER.md",
        resolved: "/workspace/STARTER.md",
        decision: "allow",
        reason: "allow/under-root",
        enforcement: "os-allowed",
        bytes: 12,
      })}\n`,
    );
    const record = openPathRecord(epochDir, "resumed");
    const appended = record.append({
      capability: "read",
      mode: "read",
      policyDigest: "a".repeat(64),
      profileDigest: null,
      requested: "MEMORY.md",
      resolved: "/workspace/MEMORY.md",
      decision: "allow",
      reason: "allow/under-root",
      enforcement: "os-allowed",
      bytes: 8,
    });
    expect(appended.seq).toBe(8);
    expect(record.count()).toBe(1);
  });
});

describe.if(osIsolationSupport().ok)("the seven capabilities through the isolation", () => {
  const { repoRoot, binding } = FIXTURE;
  const policy = deriveCandidateIsolation(binding, "author");
  const isolation: BuilderIsolation = {
    policy,
    record: openPathRecord(binding.epochDir, "toolkit-test"),
    workDir: binding.iterationDir,
  };
  const byName = new Map<string, AgentTool>(createBuilderTools(isolation).map((tool) => [tool.name, tool]));
  const run = async (name: string, params: Record<string, JsonValue>): Promise<string> => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`${name} tool not found`);
    const outcome = await tool.execute("t", params);
    const first = outcome.content[0];
    if (first?.type !== "text") throw new Error(`${name} returned non-text content`);
    return first.text;
  };
  const workspacePath = (...tail: string[]) =>
    relative(binding.iterationDir, join(binding.iterationDir, ...tail));
  const rejectionOf = async (promise: Promise<unknown>): Promise<Error> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof Error) return error;
      throw new Error("isolated tool rejected with a non-Error value", { cause: error });
    }
    throw new Error("isolated tool unexpectedly resolved");
  };

  it("read: workspace-relative paths, line windowing, and a typed measured-evidence refusal with no remedy text", async () => {
    expect(await run("read", { path: workspacePath("slug", "correctness-model", "brief.json") })).toContain(
      '"authored":true',
    );
    const windowed = await run("read", {
      path: join(binding.iterationDir, "slug", "poem.txt"),
      offset: 2,
      limit: 1,
    });
    expect(windowed).toContain("line two");
    expect(windowed).not.toContain("line one");
    expect(windowed).not.toContain("line three");
    // The grammar is the regression: reading past the end of a one-line file used to report
    // "(1 lines total)", so the assertion below is spelled singular and a returning plural fails.
    await run("write", { path: workspacePath("slug", "gen", "one.txt"), content: "only" });
    const past = await rejectionOf(run("read", { path: workspacePath("slug", "gen", "one.txt"), offset: 5 }));
    expect(String(past)).toContain("(1 line total)");
    const refusal = await rejectionOf(run("read", { path: join(binding.iterationDir, "census.json") }));
    expect(refusal).toBeInstanceOf(CandidateIsolationRefusal);
    expect(String(refusal)).not.toContain("remedy");
    expect(String(refusal)).not.toContain("OpenSees");
  });

  it("write: creates parents inside the candidate tree, refuses the repo with nothing written", async () => {
    await run("write", { path: workspacePath("slug", "gen", "solver.ts"), content: "export const s = 1;\n" });
    expect(readFileSync(join(binding.iterationDir, "slug", "gen", "solver.ts"), "utf8")).toBe(
      "export const s = 1;\n",
    );
    await expect(
      run("write", { path: join(repoRoot, "src", "evil.ts"), content: "pwn" }),
    ).rejects.toBeInstanceOf(CandidateIsolationRefusal);
    expect(existsSync(join(repoRoot, "src", "evil.ts"))).toBe(false);
  });

  it("edit: applies exact replacements through the isolation and reports success", async () => {
    const target = join(binding.iterationDir, "slug", "gen", "solver.ts");
    const text = await run("edit", { path: target, edits: [{ oldText: "s = 1", newText: "s = 2" }] });
    expect(text).toContain("1 block(s)");
    expect(readFileSync(target, "utf8")).toBe("export const s = 2;\n");
  });

  it("bash: builds in the iteration dir by default, cannot exfiltrate secrets, refuses an out-of-isolation cwd", async () => {
    await run("bash", { command: "echo built > out.txt" });
    expect(readFileSync(join(binding.iterationDir, "out.txt"), "utf8")).toBe("built\n");
    const installEnv = await run("bash", { command: 'printf "%s\\n%s" "$HOME" "$PATH"' });
    expect(installEnv).toContain(`${join(binding.iterationDir, ".toolchain", "home")}\n`);
    expect(installEnv).toContain(join(binding.iterationDir, ".toolchain", "home", ".local", "bin"));
    expect(installEnv).toContain(join(binding.iterationDir, ".toolchain", "home", ".cargo", "bin"));
    const refusal = await rejectionOf(run("bash", { command: `cat ${join(repoRoot, ".env")}` }));
    expect(refusal).toBeInstanceOf(Error);
    if (!(refusal instanceof Error)) throw new Error("bash refusal was not an Error");
    expect(refusal.message).toContain("exited with code");
    expect(refusal.message).not.toContain("hunter2");
    await expect(run("bash", { command: "true", cwd: repoRoot })).rejects.toBeInstanceOf(
      CandidateIsolationRefusal,
    );
  });

  // Safeguard 32 through the toolkit's own shell. A guard writing something that is not its hook
  // protocol has decided nothing, so the command runs, and the run this toolkit was mounted for
  // keeps the only durable trace. `Bun.env` is where the shell looks the guard up, so the swap puts
  // one broken guard, and only that one, in front of it; the host's own installed guard would
  // otherwise answer and there would be nothing to record.
  it("bash: honours a model-supplied deadline and names it when the command is killed", async () => {
    const killed = await rejectionOf(run("bash", { command: "sleep 5; echo late", timeout: 1 }));
    expect(killed.message).toContain("killed after 1 s");
    expect(killed.message).toContain("up to 7200");
    expect(killed.message).toMatch(/host load average was \d+\.\d on \d+ cores/);
    expect(killed.message).not.toContain("late");
    expect(await run("bash", { command: "echo quick", timeout: 5 })).toContain("quick");
  });

  // The positive case and its nearest hostile neighbour: a command whose output fits keeps the
  // workspace clean, and one that overruns leaves every dropped byte where `read` can page it.
  // Pi's truncation reports the size it dropped but not the bytes, and the child is gone by then.
  it("bash: keeps the whole output of a truncated command where read can page it", async () => {
    const short = await run("bash", { command: "echo small" });
    expect(short).toContain("small");
    expect(short).not.toContain(".bash-output");
    expect(existsSync(join(binding.iterationDir, ".bash-output"))).toBe(false);

    const long = await run("bash", { command: "awk 'BEGIN { for (i = 0; i < 60000; i++) print i }'" });
    const named = /at (\.bash-output\/bash-[a-z0-9]+-[a-z0-9]+\.txt); read it with offset and limit/.exec(
      long,
    );
    const wholePath = named?.[1];
    if (wholePath === undefined) {
      throw new Error(`truncated bash result named no whole-output file: ${long.slice(-400)}`);
    }

    // The head the tail-truncation dropped is the half a compiler error usually needs, so the
    // recovered file must carry it, and the read tool must be able to reach it unaided.
    expect(long).not.toContain("\n0\n");
    const whole = await run("read", { path: wholePath });
    expect(whole).toContain("0");
    expect(whole).toContain("Use offset=");

    // A spilled file is not candidate content: it carries no fingerprinted path.
    expect(wholePath.startsWith(".bash-output/")).toBe(true);
  });

  it("bash: records an unanswering guard under the run this toolkit was mounted for", async () => {
    const bin = join(SCRATCH, "guard-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "dcg"),
      ["#!/bin/sh", "/bin/cat >/dev/null", "printf '%s' 'dcg: internal error'", "exit 0", ""].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(join(bin, "dcg"), 0o700);
    const logDir = join(SCRATCH, "guard-safeguards");
    const mounted = new Map<string, AgentTool>(
      createBuilderTools({ ...isolation, safeguardContext: createSafeguardContext(logDir) }).map((tool) => [
        tool.name,
        tool,
      ]),
    );
    const shell = mounted.get("bash");
    if (!shell) throw new Error("bash tool not found");
    const path = Bun.env.PATH ?? "";
    const home = Bun.env.HOME ?? "";
    Bun.env.PATH = bin;
    Bun.env.HOME = join(SCRATCH, "guard-home");
    try {
      await shell.execute("t", { command: "echo built > guard-probe.txt" });
    } finally {
      Bun.env.PATH = path;
      Bun.env.HOME = home;
    }
    expect(readFileSync(join(binding.iterationDir, "guard-probe.txt"), "utf8")).toBe("built\n");
    const rows = readFileSync(join(logDir, SAFEGUARDS_LOG_FILE), "utf8").trim().split("\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(
      `| 32-command-guard-unanswered | 1 installed guard(s) answered nothing about a "echo" command, which then ran unguarded: ${join(bin, "dcg")}`,
    );
  });

  it("grep: finds authored content, and measured evidence are invisible to it", async () => {
    expect(await run("grep", { pattern: "authored" })).toContain("brief.json");
    expect(await run("grep", { pattern: "remedy" })).toBe("No matches");
    expect(await run("grep", { pattern: "OpenSees" })).toBe("No matches");
  });

  it("grep: a single-file target and context rows keep their path instead of tripping the guard", async () => {
    // rg drops the file name for a single-file target and separates context rows with `-`, so a
    // guard reading the leading field as a path sees `2` and refuses every such search.
    const poem = workspacePath("slug", "poem.txt");
    const rows = await run("grep", { pattern: "line two", path: poem, context: 1 });
    expect(rows).toContain(`${poem}:2:line two`);
    expect(rows).toContain(`${poem}:1-line one`);
    expect(rows).toContain(`${poem}:3-line three`);
    expect(rows).not.toContain("\0");
    expect(await run("grep", { pattern: "line", path: poem, limit: 1 })).toBe(`${poem}:1:line one`);
  });

  it("grep: a pattern that begins with a dash is searched for, not read as a flag", async () => {
    const poem = workspacePath("slug", "poem.txt");
    expect(await run("grep", { pattern: "-dash", path: poem, literal: true })).toBe(`${poem}:4:a -dash row`);
    expect(await run("grep", { pattern: "-absent", path: poem })).toBe("No matches");
  });

  it("grep: a pattern that is no regular expression is searched as the text it spells", async () => {
    const poem = workspacePath("slug", "poem.txt");
    const literal = "[Not a regular expression; searched as literal text.]";
    expect(await run("grep", { pattern: "exit(12", path: poem })).toBe(
      `${literal}\n${poem}:5:stopped at exit(12`,
    );
    expect(await run("grep", { pattern: "exit(13", path: poem })).toBe(`${literal}\nNo matches`);
    expect(await run("grep", { pattern: "exit.12", path: poem })).toBe(`${poem}:5:stopped at exit(12`);
  });

  it("find and ls: enumerate the candidate tree, drop denied names, and record the drops", async () => {
    const found = await run("find", { pattern: "*.json", path: binding.iterationDir });
    expect(found).toContain(workspacePath("slug", "correctness-model", "brief.json"));
    expect(found).not.toContain("census.json");
    const listed = await run("ls", { path: binding.iterationDir });
    expect(listed).toContain("slug/");
    expect(listed).not.toContain("census.json");
    const rows = readPathRecordRows(isolation.record.path);
    expect(
      rows.filter((row) => row.capability === "ls" && row.decision === "deny").length,
    ).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.reason === "deny/measured").length).toBeGreaterThanOrEqual(1);
  });

  it("the record carries every capability's rows with both checks", () => {
    const rows = readPathRecordRows(isolation.record.path);
    for (const capability of ["read", "write", "edit", "bash", "grep", "find", "ls"]) {
      expect(
        rows.some((row) => row.capability === capability),
        capability,
      ).toBe(true);
    }
    expect(rows.filter((row) => row.decision === "deny").length).toBeGreaterThanOrEqual(4);
    expect(rows.filter((row) => row.decision === "allow").length).toBeGreaterThanOrEqual(7);
  });
});

// The Codex launcher of the codex-gpt-swarm skill, through its command line, with a stand-in
// `codex` passed by `--codex-bin`: no real Codex session starts. The stand-in knows a session by
// the report path it is handed (`<out>/<name>.md`), since a resumed attempt's prompt does not carry
// the task, and runs the next step of that session's plan on each call.
import { afterAll, describe, expect, it } from "bun:test";
import { type Session, sessionsOf } from "#skills/codex-gpt-swarm/scripts/gpt-sessions.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

/** One session row as a manifest carries it. `model` is there to be refused. */
type Row = { name: string; task: string; sandbox?: string; ownedPaths?: string[]; model?: string };

interface Step {
  thread?: string;
  stderr?: string;
  report?: string;
  exit?: number;
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-gpt-sessions-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const workdir = join(root, "workdir");
mkdirSync(workdir);
const launcher = join(import.meta.dir, "../.claude/skills/codex-gpt-swarm/scripts/gpt-sessions.ts");
const codex = join(root, "fake-codex");
writeFileSync(
  codex,
  `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const report = args[args.indexOf("--output-last-message") + 1];
const name = report.slice(report.lastIndexOf("/") + 1).replace(/\\.md$/, "");
const calls = ${capturedJsonStringify(join(root, "calls.jsonl"))};
const earlier = existsSync(calls) ? readFileSync(calls, "utf8").split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const attempt = earlier.filter((call) => call.name === name).length;
const plan = JSON.parse(readFileSync(${capturedJsonStringify(join(root, "plan.json"))}, "utf8"))[name] ?? [{ report: "report from " + name }];
const step = plan[Math.min(attempt, plan.length - 1)];
appendFileSync(calls, JSON.stringify({ name, args, stdin: await Bun.stdin.text() }) + "\\n");
if (step.thread) console.log(JSON.stringify({ type: "thread.started", thread_id: step.thread }));
if (step.stderr) console.error(step.stderr);
if (step.report !== undefined) writeFileSync(report, step.report);
process.exit(step.exit ?? 0);
`,
  { mode: 0o700 },
);

const plan = (steps: Record<string, Step[]>) =>
  writeFileSync(join(root, "plan.json"), capturedJsonStringify(steps));
const calls = () =>
  readFileSync(join(root, "calls.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => parseJsonAs<{ name: string; args: string[]; stdin: string }>(line));
const run = (...args: string[]) => {
  const result = runSync([capturedExecPath, launcher, ...args]);
  return { code: result.exitCode, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
};
const manifest = (sessions: Row[]) => {
  const path = join(root, "manifest.json");
  writeFileSync(path, capturedJsonStringify({ workdir, sessions }));
  return path;
};
const named = (sessions: readonly Session[]) => sessions.map((session) => session.name);

describe("a manifest", () => {
  it("gives each session the shared instructions, its task and its authority, in that order", () => {
    const [read, write] = sessionsOf({
      workdir,
      instructions: "Shared rules.",
      sessions: [
        { name: "read", task: "Count the callers." },
        { name: "write", task: "Write the fixture.", sandbox: "workspace-write", ownedPaths: ["test/"] },
      ],
    });
    expect(read?.prompt).toBe(
      "Shared rules.\n\nCount the callers.\n\nAuthority: read-only. Do not edit files or change external state.",
    );
    expect(write?.prompt).toContain("Authority: workspace-write. You own only: test/.");
    expect(write?.workdir).toBe(workdir);
  });

  it("refuses a repeated name or task, a stray field, and a write session that owns nothing", () => {
    const of = (sessions: Row[]) => () => sessionsOf({ workdir, sessions });
    expect(
      of([
        { name: "a", task: "x" },
        { name: "a", task: "y" },
      ]),
    ).toThrow("duplicate session name: a");
    expect(
      of([
        { name: "a", task: "x" },
        { name: "b", task: " x " },
      ]),
    ).toThrow("repeats an earlier session's task");
    expect(of([{ name: "a", task: "x", model: "gpt-6-luna" }])).toThrow("unsupported fields: model");
    expect(of([{ name: "a", task: "x", sandbox: "workspace-write" }])).toThrow("must declare ownedPaths");
    expect(named(sessionsOf({ workdir, sessions: [{ name: "a", task: "x" }] }))).toStrictEqual(["a"]);
  });
});

describe("a launch", () => {
  const out = join(root, "out");

  it("resumes a session that stopped by its thread, and types a rate limit Codex reported", () => {
    plan({
      flaky: [{ thread: "thread_flaky_0001", exit: 1 }, { report: "report from flaky" }],
      limited: [{ stderr: "429 Too Many Requests", exit: 1 }],
    });
    const sessions = ["ok", "flaky", "limited"].map((name) => ({ name, task: `Task of ${name}.` }));
    const launched = run(
      "--manifest",
      manifest(sessions),
      "--output-dir",
      out,
      "--codex-bin",
      codex,
      "--model",
      "gpt-6.1-sol",
      "--start-interval-ms",
      "0",
    );
    expect(launched.code).toBe(1);
    const summary = parseJsonAs<{
      reasoningEffort: string;
      sessions: { name: string; status: string; attempts: number; failureKind: string | null }[];
    }>(readFileSync(join(out, "summary.json"), "utf8"));
    expect(summary.reasoningEffort).toBe("medium");
    expect(
      summary.sessions.map(({ name, status, attempts, failureKind }) => [
        name,
        status,
        attempts,
        failureKind,
      ]),
    ).toStrictEqual([
      ["ok", "completed", 1, null],
      ["flaky", "completed", 2, null],
      ["limited", "failed", 2, "rate-limit"],
    ]);
    const resumed = calls().filter((call) => call.name === "flaky")[1];
    expect(resumed?.args.slice(0, 2)).toStrictEqual(["exec", "resume"]);
    expect(resumed?.args.at(-2)).toBe("thread_flaky_0001");
    expect(resumed?.stdin).toContain("Continue the task from where it stopped");
  });

  it("drains each settled report once, and retries only the session left incomplete", () => {
    const first = run("--drain", out);
    expect(first.stdout).toContain("## ok");
    expect(first.stdout).toContain("Failure kind: rate-limit");
    expect(run("--drain", out).stdout).toBe("");
    plan({ limited: [{ report: "report from limited" }] });
    const before = calls().length;
    const retried = run("--retry", out, "--codex-bin", codex);
    expect(retried.code).toBe(0);
    expect(
      calls()
        .slice(before)
        .map((call) => call.name),
    ).toStrictEqual(["limited"]);
    expect(run("--drain", out).stdout).toContain("report from limited");
  });

  it("refuses an effort the model does not take, and a condition a retry would change", () => {
    const refused = run(
      "--manifest",
      manifest([{ name: "a", task: "x" }]),
      "--codex-bin",
      codex,
      "--reasoning-effort",
      "max",
      "--model",
      "gpt-6.1-sol",
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("--reasoning-effort must be one of low, medium, high, or xhigh");
    expect(run("--retry", out, "--model", "gpt-6-luna").stderr).toContain("--retry does not take --model");
  });
});

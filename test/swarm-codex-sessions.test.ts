// The subject is `.claude/skills/codex-luna-swarm/scripts/codex-sessions.ts`, which sits in a
// dot-directory Bun's discovery never descends into, so a suite written beside it would sit green
// and unread. That is why this file lives in `test/` and reaches back across the boundary with a
// relative import, and why it is `.mjs`: the script is plain ESM and is also spawned here as a
// subprocess, so the test speaks the same dialect it does. Nothing else in the tree exercises the
// script's behaviour — `test/build-manifest.test.ts` only matches its name in a rendered command
// line — so the batch policy, the argument reader and the launch path are covered here or nowhere.
import assert from "../src/meta/assert.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { required } from "./helpers/doubles.ts";

import { afterEach, test } from "bun:test";

const { batchPolicy, planSessions } = await import(
  "../.claude/skills/codex-luna-swarm/scripts/codex-sessions.ts"
);
const script = join(import.meta.dir, "../.claude/skills/codex-luna-swarm/scripts/codex-sessions.ts");
const scratchRoots: string[] = [];

/** What the stand-in companion prints: the argv it was given and the prompt it read. */
interface CompanionLog {
  args: string[];
  prompt: string;
}

interface DrainSummary {
  finished: number;
  failed: number;
  running: number;
  printed: number;
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "ana-codex-sessions-"));
  scratchRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in companion: records its argv and prompt, exits with the code the prompt names. */
function fakeCompanion(dir: string) {
  const path = join(dir, "fake-companion.mjs");
  writeFileSync(
    path,
    [
      'import { readFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      'const promptFile = args[args.indexOf("--prompt-file") + 1];',
      'const prompt = readFileSync(promptFile, "utf8");',
      "console.log(JSON.stringify({ args, prompt }));",
      String.raw`const wanted = /exit=(\d+)/.exec(prompt);`,
      "process.exit(wanted ? Number(wanted[1]) : 0);",
    ].join("\n"),
  );
  return path;
}

function run(args: string[], cwd: string) {
  const result = runSync([runtimeProcess.execPath, script, ...args], { cwd });
  return { code: result.exitCode, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
}

async function waitForExitFiles(outDir: string, names: string[], deadlineMs = 15_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (names.every((name) => existsSync(join(outDir, `${name}.exit.json`)))) return;
    await Bun.sleep(50);
  }
  throw new Error(`sessions did not finish within ${deadlineMs} ms: ${names.join(", ")}`);
}

test("batch policy: up to five sessions take Sol medium, six or more take Luna xhigh", () => {
  assert.deepEqual(batchPolicy(1).model, "gpt-5.6-sol");
  assert.deepEqual(batchPolicy(5), {
    model: "gpt-5.6-sol",
    effort: "medium",
    rule: "1-5 sessions: gpt-5.6-sol medium",
  });
  assert.deepEqual(batchPolicy(6), {
    model: "gpt-6-luna",
    effort: "xhigh",
    rule: "6+ sessions: gpt-6-luna xhigh",
  });
  assert.throws(() => batchPolicy(0), /at least one session/);
});

test("planSessions applies the policy, keeps explicit choices and refuses bad rows", () => {
  const two = planSessions(
    [
      { name: "a", task: "x" },
      { name: "b", task: "y" },
    ],
    {},
  );
  assert.deepEqual(
    two.sessions.map((row) => `${row.model}/${row.effort}`),
    ["gpt-5.6-sol/medium", "gpt-5.6-sol/medium"],
  );
  const six = planSessions(
    Array.from({ length: 6 }, (_, index) => ({ name: `s${index}`, task: "q" })),
    {},
  );
  assert.equal(six.sessions[5]?.model, "gpt-6-luna");
  assert.equal(six.sessions[5]?.effort, "xhigh");
  const explicit = planSessions(
    [
      { name: "a", task: "x" },
      { name: "b", task: "y", effort: "max" },
    ],
    { model: "gpt-6-luna", effort: "high" },
  );
  assert.equal(explicit.policy, "explicit flags");
  assert.deepEqual(
    explicit.sessions.map((row) => row.effort),
    ["high", "max"],
  );
  assert.throws(
    () =>
      planSessions(
        [
          { name: "a", task: "x" },
          { name: "a", task: "y" },
        ],
        {},
      ),
    /duplicate name/,
  );
  assert.throws(() => planSessions([{ name: "Bad-Name", task: "x" }], {}), /name must match/);
  assert.throws(() => planSessions([{ name: "a", task: "x", effort: "turbo" }], {}), /not one of/);
  assert.throws(() => planSessions([], {}), /non-empty array/);
});

test("planSessions carries a task's own workdir and refuses a relative one", () => {
  const plan = planSessions(
    [
      { name: "a", task: "x" },
      { name: "b", task: "y", write: true, workdir: "/abs/scratch" },
    ],
    {},
  );
  assert.equal(plan.sessions[0]?.workdir, undefined);
  assert.equal(plan.sessions[1]?.workdir, "/abs/scratch");
  assert.equal(plan.sessions[1]?.write, true);
  assert.throws(() => planSessions([{ name: "a", task: "x", workdir: "scratch" }], {}), /absolute path/);
});

test("each command parses its own options and refuses what it does not take with exit 2", () => {
  const dir = scratch();
  // A misspelled flag used to be stored as an option nothing read; now it refuses before running.
  const refusals = [
    [["launch", "--out-dri", "/x"], /unknown option "--out-dri"/],
    [["status", "--plan-only"], /unknown option "--plan-only"/],
    [["launch", "--out-dir"], /needs a value/],
    [["lunch"], /expected one of launch, run-one, status, drain, watch, got "lunch"/],
    [["status"], /--out-dir is required/],
  ] satisfies [string[], RegExp][];
  for (const [args, message] of refusals) {
    const result = run(args, dir);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, message);
  }
  const help = run(["status", "--help"], dir);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /codex-sessions.ts launch --tasks-file/);
});

test("launch refuses a relative --out-dir and an unknown effort before spawning", () => {
  const dir = scratch();
  const tasks = join(dir, "tasks.json");
  writeFileSync(tasks, JSON.stringify([{ name: "a", task: "x" }]));
  const relative = run(
    ["launch", "--tasks-file", tasks, "--out-dir", "relative/dir", "--companion", fakeCompanion(dir)],
    dir,
  );
  assert.equal(relative.code, 2);
  assert.match(relative.stderr, /--out-dir must be an absolute path/);
  const effort = run(
    [
      "launch",
      "--tasks-file",
      tasks,
      "--out-dir",
      join(dir, "out"),
      "--effort",
      "turbo",
      "--companion",
      fakeCompanion(dir),
    ],
    dir,
  );
  assert.equal(effort.code, 1);
  assert.match(effort.stderr, /not one of/);
  assert.equal(existsSync(join(dir, "out", "launch.json")), false);
});

test("plan-only prints the resolved batch without spawning", () => {
  const dir = scratch();
  const tasks = join(dir, "tasks.json");
  writeFileSync(
    tasks,
    JSON.stringify(Array.from({ length: 6 }, (_, index) => ({ name: `s${index}`, task: "q" }))),
  );
  const result = run(["launch", "--tasks-file", tasks, "--out-dir", join(dir, "out"), "--plan-only"], dir);
  assert.equal(result.code, 0, result.stderr);
  const plan = parseJsonAs<{ event: string; policy: string; sessions: unknown[] }>(result.stdout.trim());
  assert.equal(plan.event, "codex_sessions.plan");
  assert.equal(plan.policy, "6+ sessions: gpt-6-luna xhigh");
  assert.equal(plan.sessions.length, 6);
  assert.equal(existsSync(join(dir, "out")), false);
});

test("launch detaches one companion per task, then drain prints each report exactly once", async () => {
  const dir = scratch();
  const outDir = join(dir, "out");
  const tasks = join(dir, "tasks.json");
  writeFileSync(
    tasks,
    JSON.stringify([
      { name: "good", task: "answer plainly" },
      { name: "bad", task: "please exit=3", write: true },
    ]),
  );
  const launched = run(
    [
      "launch",
      "--tasks-file",
      tasks,
      "--out-dir",
      outDir,
      "--workdir",
      dir,
      "--companion",
      fakeCompanion(dir),
      "--drain-every",
      "0",
    ],
    dir,
  );
  assert.equal(launched.code, 0, launched.stderr);
  const event = parseJsonAs<{ event: string; count: number; policy: string; watcher: number | null }>(
    launched.stdout.trim(),
  );
  assert.equal(event.watcher, null);
  assert.equal(event.event, "codex_sessions.launched");
  assert.equal(event.count, 2);
  assert.equal(event.policy, "1-5 sessions: gpt-5.6-sol medium");
  await waitForExitFiles(outDir, ["good", "bad"]);

  const good = parseJsonAs<CompanionLog>(readFileSync(join(outDir, "good.log"), "utf8").trim());
  assert.deepEqual(good.args, [
    "task",
    "--fresh",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "medium",
    "--prompt-file",
    join(outDir, "good.prompt.md"),
    "--cwd",
    dir,
  ]);
  assert.equal(good.prompt, "answer plainly");
  const bad = parseJsonAs<CompanionLog>(readFileSync(join(outDir, "bad.log"), "utf8").trim());
  assert.ok(bad.args.includes("--write"));
  assert.equal(
    parseJsonAs<{ exitCode: number }>(readFileSync(join(outDir, "bad.exit.json"), "utf8")).exitCode,
    3,
  );

  const first = run(["drain", "--out-dir", outDir], dir);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /===== good \(gpt-5.6-sol\/medium, finished, exit 0/);
  assert.match(first.stdout, /===== bad \(gpt-5.6-sol\/medium, failed, exit 3/);
  const firstSummary = parseJsonAs<DrainSummary>(
    required(first.stdout.trim().split("\n").at(-1), "summary line"),
  );
  assert.deepEqual(
    [firstSummary.finished, firstSummary.failed, firstSummary.running, firstSummary.printed],
    [1, 1, 0, 2],
  );

  const second = run(["drain", "--out-dir", outDir], dir);
  assert.equal(second.code, 0);
  assert.doesNotMatch(second.stdout, /=====/);
  assert.equal(parseJsonAs<DrainSummary>(second.stdout.trim()).printed, 0);

  const status = run(["status", "--out-dir", outDir], dir);
  assert.match(status.stdout, /^good\tfinished\tgpt-5.6-sol\/medium\texit 0$/m);
  assert.match(status.stdout, /^bad\tfailed\tgpt-5.6-sol\/medium\texit 3$/m);

  const again = run(
    ["launch", "--tasks-file", tasks, "--out-dir", outDir, "--companion", fakeCompanion(dir)],
    dir,
  );
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already holds a launch/);
});

// Sixty lanes of one batch finished and were never read, because nothing drained them. A launch now
// detaches a watcher that drains every --drain-every seconds into drained.md, once per report, and
// exits when no session is left running.
test("a launch's watcher drains every report once into drained.md, then exits", async () => {
  const dir = scratch();
  const outDir = join(dir, "out");
  const tasks = join(dir, "tasks.json");
  writeFileSync(tasks, JSON.stringify([{ name: "one", task: "answer plainly" }]));
  const launched = run(
    [
      "launch",
      "--tasks-file",
      tasks,
      "--out-dir",
      outDir,
      "--companion",
      fakeCompanion(dir),
      "--drain-every",
      "1",
    ],
    dir,
  );
  assert.equal(launched.code, 0, launched.stderr);
  assert.notEqual(parseJsonAs<{ watcher: number | null }>(launched.stdout.trim()).watcher, null);
  const deadline = Date.now() + 15_000;
  const summaries = () =>
    existsSync(join(outDir, "watch.log"))
      ? readFileSync(join(outDir, "watch.log"), "utf8").trim().split("\n").filter(Boolean)
      : [];
  while (summaries().every((line) => parseJsonAs<DrainSummary>(line).running > 0) && Date.now() < deadline) {
    await Bun.sleep(200);
  }
  const last = parseJsonAs<DrainSummary>(required(summaries().at(-1), "watch summary"));
  assert.deepEqual([last.finished, last.running], [1, 0]);
  const drained = readFileSync(join(outDir, "drained.md"), "utf8");
  assert.equal(drained.match(/===== one \(/g)?.length, 1);
  assert.doesNotMatch(run(["drain", "--out-dir", outDir], dir).stdout, /=====/);
});

// The Luna launcher's lifecycle, read through its command line: which sessions it accepts, the
// Codex call it makes for each, how it paces them, and the one session-level retry it owns. Codex
// itself retries a request, reconnects a stream and falls back from WebSocket to HTTPS inside a
// session; what it cannot do is start a session that stopped, which is the launcher's part.
import assert from "../src/meta/assert.ts";
import { sha256 } from "../src/meta/digest.ts";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { leafPrompt } from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { BUN, LAUNCHER, type SessionRow, done, lunaRig, until } from "./helpers/luna-rig.ts";

import { afterAll, test } from "bun:test";

/** The receipts as far as these tests read them. */
interface LaunchReceipt {
  model: string;
  reasoningEffort: string;
  runtime: { bunVersion: string; nodeVersion?: string };
  sessions: { name: string; workdir: string; sandbox: string; ownedPaths: string[]; promptSha256: string }[];
}
interface SummaryRow {
  name: string;
  status: string;
  exitCode: number | null;
  failureKind: string | null;
  threadId: string | null;
  attempts?: number;
}
interface Summary {
  reasoningEffort: string;
  sessions: SummaryRow[];
}

const markdownParser = join(dirname(LAUNCHER), "parse-markdown-tasks.ts");
const managedStart = "# codex-luna-swarm:start";
const managedEnd = "# codex-luna-swarm:end";
const expectedStopHookCommand =
  'bun "$(git rev-parse --show-toplevel)/.claude/skills/codex-luna-swarm/scripts/luna-sessions.ts" --stop-hook';
const repositoryRoot = join(dirname(LAUNCHER), "..", "..", "..", "..");

afterAll(cleanupScratch);

function managedBlock(config: string) {
  const start = config.indexOf(managedStart);
  const end = config.indexOf(managedEnd, start);
  assert.notEqual(start, -1, "managed Luna hook start marker is present");
  assert.notEqual(end, -1, "managed Luna hook end marker is present");
  return config.slice(start, end + managedEnd.length);
}

function firstLine<T>(stdout: string): T {
  return parseJsonAs<T>(stdout.trim().split("\n")[0] ?? "");
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  return args[args.indexOf(flag) + 1];
}

test("passes the chosen Luna effort to Codex and records it in every receipt, max by default", () => {
  for (const effort of [null, "high", "xhigh", "max"]) {
    const rig = lunaRig("luna-effort-");
    const manifest = rig.manifest([{ name: "effort", task: "Return a short test report." }]);
    const chosen = effort === null ? [] : ["--reasoning-effort", effort];
    const result = rig.run([
      "--manifest",
      manifest,
      "--codex-bin",
      rig.codex,
      "--output-dir",
      rig.out,
      ...chosen,
      "--launch-only",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const expected = effort ?? "max";
    const launch = rig.read<LaunchReceipt>("launch.json");
    const summary = rig.read<Summary>("summary.json");
    assert.equal(firstLine<{ reasoningEffort: string }>(result.stdout).reasoningEffort, expected);
    assert.equal(launch.reasoningEffort, expected);
    assert.equal(launch.model, "gpt-6-luna");
    assert.equal(launch.runtime.bunVersion, Bun.version);
    assert.equal(launch.runtime.nodeVersion, undefined);
    assert.equal(summary.reasoningEffort, expected);
    assert.deepEqual(
      summary.sessions.map(({ status, exitCode }) => [status, exitCode]),
      [["completed", 0]],
    );
    const [call] = rig.calls();
    assert.ok(call);
    assert.equal(call.args[0], "exec");
    assert.equal(valueAfter(call.args, "--model"), "gpt-6-luna");
    assert.ok(call.args.includes(`model_reasoning_effort="${expected}"`));
    assert.ok(call.args.includes('service_tier="priority"'));
    assert.equal(valueAfter(call.args, "--sandbox"), "read-only");
    assert.ok(call.args.includes("--json"));
    assert.equal(valueAfter(call.args, "--output-last-message"), join(rig.out, "effort.md"));
    assert.equal(call.args.at(-1), "-");
    assert.equal(call.cwd, rig.workdir);
    assert.equal(call.lunaSession, "1");
  }
});

test("refuses an effort Luna does not run, before it writes or starts anything", () => {
  const rig = lunaRig("luna-effort-refused-");
  const manifest = rig.manifest([{ name: "effort", task: "Return a short test report." }]);
  const result = rig.run([
    "--manifest",
    manifest,
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--reasoning-effort",
    "medium",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--reasoning-effort must be one of high, xhigh, or max/);
  assert.equal(existsSync(rig.out), false);
  assert.deepEqual(rig.calls(), []);
});

// WRI checks every launched prompt against the one its manifest composed, so the launcher must
// send those bytes exactly: the shared instructions, the task, then the authority line.
test("sends each session the prompt WRI composes, and lets a scratch row own its path", () => {
  const rig = lunaRig("luna-prompt-");
  const scratch = join(rig.root, "scratch");
  mkdirSync(scratch);
  const instructions = join(rig.root, "instructions.md");
  writeFileSync(instructions, "Shared instructions.\n");
  const tasks = join(rig.root, "tasks.json");
  const rows = [
    { name: "reader", task: "Read the oracle." },
    {
      name: "writer",
      task: "Build the adapter.",
      workdir: scratch,
      sandbox: "workspace-write",
      ownedPaths: [scratch],
    },
  ];
  writeFileSync(tasks, JSON.stringify(rows));
  const result = rig.run([
    "--tasks-file",
    tasks,
    "--workdir",
    rig.workdir,
    "--instructions-file",
    instructions,
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const launch = rig.read<LaunchReceipt>("launch.json");
  const calls = rig.calls();
  const reader = calls.find((call) => call.name === "reader");
  const writer = calls.find((call) => call.name === "writer");
  assert.equal(reader?.stdin, leafPrompt("Shared instructions.\n", "Read the oracle.", null));
  assert.equal(writer?.stdin, leafPrompt("Shared instructions.\n", "Build the adapter.", scratch));
  assert.deepEqual(
    launch.sessions.map(({ name, workdir, sandbox, ownedPaths, promptSha256 }) => ({
      name,
      workdir,
      sandbox,
      ownedPaths,
      promptSha256,
    })),
    [
      {
        name: "reader",
        workdir: rig.workdir,
        sandbox: "read-only",
        ownedPaths: [],
        promptSha256: sha256(reader?.stdin ?? ""),
      },
      {
        name: "writer",
        workdir: realpathSync(scratch),
        sandbox: "workspace-write",
        ownedPaths: [scratch],
        promptSha256: sha256(writer?.stdin ?? ""),
      },
    ],
  );
  assert.equal(valueAfter(writer?.args ?? [], "--sandbox"), "workspace-write");
  assert.equal(writer?.cwd, realpathSync(scratch));
});

test("refuses a malformed manifest or tasks file before it writes or starts anything", () => {
  const rig = lunaRig("luna-refusals-");
  const tasks = join(rig.root, "tasks.json");
  const instructions = join(rig.root, "instructions.md");
  writeFileSync(instructions, "Shared instructions.\n");
  // Each case writes its input file when it runs, since the cases share the two paths.
  const tasksRun = (rows: SessionRow[]) => () => {
    writeFileSync(tasks, JSON.stringify(rows));
    return [
      "--tasks-file",
      tasks,
      "--workdir",
      rig.workdir,
      "--instructions-file",
      instructions,
      "--output-dir",
      rig.out,
    ];
  };
  const manifestRun =
    (sessions: SessionRow[], ...more: string[]) =>
    () => ["--manifest", rig.manifest(sessions), "--output-dir", rig.out, ...more];
  const task = { name: "a", task: "Read the oracle." };
  const refusals: [() => string[], RegExp][] = [
    [tasksRun([{ name: "b", task: "y", sandbox: "workspace-write" }]), /must declare ownedPaths/],
    [tasksRun([{ name: "b", task: "y", model: "other" }]), /unsupported fields: model/],
    [manifestRun([]), /at least one session/],
    [manifestRun([{ name: "Bad-Name", task: "x" }]), /name must match/],
    [manifestRun([task, task]), /duplicate session name: a/],
    [manifestRun([{ ...task, workdir: "relative" }]), /must be an absolute path/],
    [
      manifestRun([{ ...task, sandbox: "danger-full-access" }]),
      /sandbox must be read-only or workspace-write/,
    ],
    [manifestRun([task], "--reasoning-effort", "turbo"), /--reasoning-effort must be one of/],
    [
      () => ["--manifest", rig.manifest([task]), "--output-dir", "relative/out"],
      /--output-dir must be absolute/,
    ],
  ];
  for (const [argsOf, message] of refusals) {
    const args = argsOf();
    const result = rig.run([...args, "--codex-bin", rig.codex]);
    assert.equal(result.exitCode, 1, `${args.join(" ")}\n${result.stderr}`);
    assert.match(result.stderr, message);
    assert.equal(existsSync(rig.out), false, args.join(" "));
  }
  mkdirSync(rig.out);
  const used = rig.run([
    "--manifest",
    rig.manifest([task]),
    "--output-dir",
    rig.out,
    "--codex-bin",
    rig.codex,
  ]);
  assert.equal(used.exitCode, 1);
  assert.match(used.stderr, /--output-dir must not already exist/);
  assert.deepEqual(rig.calls(), []);
});

test("refuses an unknown or valueless option with exit 2, and prints its usage on --help", () => {
  for (const [args, message] of [
    [["--reasoning-effrot", "high"], /luna-sessions: unknown option "--reasoning-effrot"/],
    [["--drain"], /luna-sessions: option "--drain" needs a value/],
  ] satisfies [string[], RegExp][]) {
    const result = runSync([BUN, LAUNCHER, ...args]);
    assert.equal(result.exitCode, 2, decodeOutput(result.stderr));
    assert.match(decodeOutput(result.stderr), message);
  }
  const help = runSync([BUN, LAUNCHER, "--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(decodeOutput(help.stdout), /--manifest/);
  assert.match(decodeOutput(help.stdout), /--tasks-file/);
});

test("launches the task names the Markdown parser emits", () => {
  const rig = lunaRig("luna-markdown-");
  const input = join(rig.root, "tasks.md");
  const tasks = join(rig.root, "tasks.json");
  const instructions = join(rig.root, "instructions.md");
  writeFileSync(instructions, "Shared instructions.\n");
  writeFileSync(
    input,
    `# Tasks\n\n## ${"Long repeated heading ".repeat(8)}\n\nInspect it.\n\n## ${"Another long heading ".repeat(8)}\n\nInspect this too.\n`,
  );
  const parsed = runSync([BUN, markdownParser, "--input", input, "--output", tasks, "--expected-count", "2"]);
  assert.equal(parsed.exitCode, 0, decodeOutput(parsed.stderr));
  for (const { name } of parseJsonAs<{ name: string }[]>(readFileSync(tasks, "utf8"))) {
    assert.match(name, /^[a-z][a-z0-9_]{0,47}$/);
  }
  const result = rig.run([
    "--tasks-file",
    tasks,
    "--workdir",
    rig.workdir,
    "--instructions-file",
    instructions,
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(rig.read<Summary>("summary.json").sessions.length, 2);
});

test("runs one session at a time under --max-active 1, and spaces starts by --start-interval-ms", () => {
  const rig = lunaRig("luna-queue-");
  const names = ["one", "two", "three"];
  rig.plan(Object.fromEntries(names.map((name) => [name, [done(name, { sleepMs: 150 })]])));
  const sessions = names.map((name) => ({ name, task: `Inspect ${name}.` }));
  const serial = rig.run([
    "--manifest",
    rig.manifest(sessions),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--max-active",
    "1",
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(serial.exitCode, 0, serial.stderr);
  const starts = rig.calls().map((call) => call.at);
  const ends = rig.ends().map((end) => end.at);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(
      (starts[index] ?? 0) >= (ends[index - 1] ?? Infinity),
      "each session starts after the last ended",
    );
  }

  const paced = lunaRig("luna-pace-");
  const pacedRun = paced.run([
    "--manifest",
    paced.manifest(sessions.slice(0, 2)),
    "--codex-bin",
    paced.codex,
    "--output-dir",
    paced.out,
    "--start-interval-ms",
    "400",
    "--launch-only",
  ]);
  assert.equal(pacedRun.exitCode, 0, pacedRun.stderr);
  const [first, second] = paced
    .read<{ sessions: { startedAt: string }[] }>("summary.json")
    .sessions.map((row) => Date.parse(row.startedAt));
  assert.ok((second ?? 0) - (first ?? 0) >= 390, "the second session waited out the interval");
});

test("configures the tracked stop hook exactly as the skill snippet declares", () => {
  const config = readFileSync(join(repositoryRoot, ".codex", "config.toml"), "utf8");
  const snippet = readFileSync(join(dirname(dirname(LAUNCHER)), "assets", "config.toml.snippet"), "utf8");
  assert.equal(managedBlock(config), managedBlock(snippet));
  assert.equal(managedBlock(config).match(/^command = '([^']+)'$/m)?.[1], expectedStopHookCommand);
});

test("the stop hook lets a nested child Luna session end", () => {
  const result = runSync([BUN, LAUNCHER, "--stop-hook"], {
    env: { ...Bun.env, CODEX_LUNA_SESSION: "1" },
    input: "{}\n",
  });
  assert.equal(result.exitCode, 0, decodeOutput(result.stderr));
  assert.equal(decodeOutput(result.stdout), "{}\n");
  assert.equal(decodeOutput(result.stderr), "");
});

test("the stop hook holds the parent Codex task while its launcher runs, then sends it to drain", async () => {
  const rig = lunaRig("luna-stop-hook-");
  const release = join(rig.root, "release");
  rig.plan({ held: [done("held", { waitFor: release })] });
  const parent = { ...Bun.env, CODEX_THREAD_ID: "thread_parent_0001" };
  const hook = () =>
    parseJsonAs<{ decision?: string; reason?: string }>(
      decodeOutput(
        runSync([BUN, LAUNCHER, "--stop-hook"], {
          env: Bun.env,
          input: '{"session_id":"thread_parent_0001"}',
        }).stdout,
      ),
    );
  const launch = rig.start(
    [
      "--manifest",
      rig.manifest([{ name: "held", task: "Wait." }]),
      "--codex-bin",
      rig.codex,
      "--output-dir",
      rig.out,
    ],
    parent,
  );
  await until(() => rig.calls().length === 1, "the held session to start");
  const running = hook();
  assert.equal(running.decision, "block");
  assert.match(running.reason ?? "", /active at/);
  writeFileSync(release, "");
  assert.equal((await launch.exited()).exitCode, 0);
  const finished = hook();
  assert.equal(finished.decision, "block");
  assert.match(finished.reason ?? "", /finished at .*Drain/);
  assert.deepEqual(hook(), {});
});

test("resumes a session that stopped after Codex named its thread", () => {
  const rig = lunaRig("luna-resume-");
  rig.plan({ solve: [{ thread: "thread_resume_0001", exit: 1 }, { report: "resumed report\n" }] });
  const result = rig.run([
    "--manifest",
    rig.manifest([{ name: "solve", task: "Solve the task named SOLVE-TASK." }]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const [first, second] = rig.calls();
  assert.deepEqual(second?.args.slice(0, 2), ["exec", "resume"]);
  assert.equal(second?.args.includes("thread_resume_0001"), true);
  assert.equal(second?.args.includes('sandbox_mode="read-only"'), true);
  assert.equal(valueAfter(second?.args ?? [], "--model"), "gpt-6-luna");
  assert.equal(valueAfter(second?.args ?? [], "--output-last-message"), join(rig.out, "solve.md"));
  assert.equal(second?.cwd, rig.workdir);
  assert.match(first?.stdin ?? "", /SOLVE-TASK/);
  assert.doesNotMatch(second?.stdin ?? "", /SOLVE-TASK/);
  const [row] = rig.read<Summary>("summary.json").sessions;
  assert.deepEqual([row?.status, row?.attempts, row?.threadId], ["completed", 2, "thread_resume_0001"]);
});

test("starts a session again from its prompt when it stopped before Codex named a thread", () => {
  const rig = lunaRig("luna-restart-");
  rig.plan({ solve: [{ stderr: "could not reach the provider", exit: 1 }, done("solve")] });
  const result = rig.run([
    "--manifest",
    rig.manifest([{ name: "solve", task: "Solve the task named SOLVE-TASK." }]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const [first, second] = rig.calls();
  assert.equal(second?.args[1], "--model");
  assert.equal(second?.stdin, first?.stdin);
  const [row] = rig.read<Summary>("summary.json").sessions;
  assert.deepEqual([row?.status, row?.attempts], ["completed", 2]);
});

test("retries a failed session once by default, and not at all under --retries 0", () => {
  for (const [retries, attempts] of [
    [[], 2],
    [["--retries", "0"], 1],
  ] satisfies [string[], number][]) {
    const rig = lunaRig("luna-retries-");
    rig.plan({ solve: [{ thread: "thread_fails_0001", exit: 1 }] });
    const result = rig.run([
      "--manifest",
      rig.manifest([{ name: "solve", task: "Solve it." }]),
      "--codex-bin",
      rig.codex,
      "--output-dir",
      rig.out,
      ...retries,
      "--launch-only",
    ]);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(rig.calls().length, attempts);
    const [row] = rig.read<Summary>("summary.json").sessions;
    assert.deepEqual([row?.status, row?.attempts], ["failed", attempts]);
  }
});

test("retries only the sessions an earlier launch left incomplete, from that launch's own record", () => {
  const rig = lunaRig("luna-retry-dir-");
  rig.plan({
    kept: [done("kept")],
    resumed: [{ thread: "thread_resumed_0001", exit: 1 }, { report: "resumed\n" }],
    restarted: [{ stderr: "no thread yet", exit: 1 }, done("restarted")],
  });
  const sessions = ["kept", "resumed", "restarted"].map((name) => ({ name, task: `Inspect ${name}.` }));
  const first = rig.run([
    "--manifest",
    rig.manifest(sessions),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--retries",
    "0",
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(first.exitCode, 1, first.stderr);
  const launchBytes = readFileSync(join(rig.out, "launch.json"));
  const keptBytes = readFileSync(join(rig.out, "kept.result.json"));
  const before = rig.calls().length;

  const retry = rig.run(["--retry", rig.out, "--codex-bin", rig.codex, "--launch-only"]);
  assert.equal(retry.exitCode, 0, retry.stderr);
  const rerun = rig.calls().slice(before);
  assert.deepEqual(rerun.map((call) => call.name).toSorted(), ["restarted", "resumed"]);
  const resumed = rerun.find((call) => call.name === "resumed");
  const restarted = rerun.find((call) => call.name === "restarted");
  assert.deepEqual(resumed?.args.slice(0, 2), ["exec", "resume"]);
  assert.equal(resumed?.args.includes("thread_resumed_0001"), true);
  assert.equal(restarted?.args[1], "--model");
  assert.match(restarted?.stdin ?? "", /Inspect restarted\./);
  assert.deepEqual(readFileSync(join(rig.out, "launch.json")), launchBytes);
  assert.deepEqual(readFileSync(join(rig.out, "kept.result.json")), keptBytes);
  assert.deepEqual(
    rig.read<Summary>("summary.json").sessions.map(({ name, status }) => [name, status]),
    [
      ["kept", "completed"],
      ["resumed", "completed"],
      ["restarted", "completed"],
    ],
  );

  const settled = rig.run(["--retry", rig.out, "--codex-bin", rig.codex, "--launch-only"]);
  assert.equal(settled.exitCode, 0, settled.stderr);
  assert.equal(rig.calls().length, before + 2);
});

test("refuses to retry a directory whose launcher is still running", async () => {
  const rig = lunaRig("luna-retry-live-");
  const release = join(rig.root, "release");
  rig.plan({ held: [done("held", { waitFor: release })] });
  const launch = rig.start([
    "--manifest",
    rig.manifest([{ name: "held", task: "Wait." }]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--launch-only",
  ]);
  await until(() => rig.calls().length === 1, "the held session to start");
  const refused = rig.run(["--retry", rig.out, "--codex-bin", rig.codex]);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /still running/);
  writeFileSync(release, "");
  assert.equal((await launch.exited()).exitCode, 0);
  assert.equal(rig.calls().length, 1);
});

test("accepts a concurrency cap above the session count", () => {
  const rig = lunaRig("luna-cap-");
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "one", task: "Inspect one." },
      { name: "two", task: "Inspect two." },
    ]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--max-active",
    "4",
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(rig.calls().length, 2);
});

test("runs Sol at Sol's own efforts, and refuses a model or effort the launcher does not name", () => {
  const rig = lunaRig("luna-sol-");
  const manifest = rig.manifest([{ name: "review", task: "Review the change." }]);
  const refused: [string[], RegExp][] = [
    [["--model", "gpt-4"], /--model must be one of gpt-6-luna or gpt-5\.6-sol/],
    [
      ["--model", "gpt-5.6-sol", "--reasoning-effort", "max"],
      /--reasoning-effort must be one of low, medium, high, or xhigh/,
    ],
  ];
  for (const [args, message] of refused) {
    const result = rig.run([
      "--manifest",
      manifest,
      "--codex-bin",
      rig.codex,
      "--output-dir",
      rig.out,
      ...args,
    ]);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, message);
  }
  const result = rig.run([
    "--manifest",
    manifest,
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--model",
    "gpt-5.6-sol",
    "--reasoning-effort",
    "medium",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const [call] = rig.calls();
  assert.equal(valueAfter(call?.args ?? [], "--model"), "gpt-5.6-sol");
  assert.equal(call?.args.includes('model_reasoning_effort="medium"'), true);
  const launch = rig.read<LaunchReceipt>("launch.json");
  assert.deepEqual([launch.model, launch.reasoningEffort], ["gpt-5.6-sol", "medium"]);
});

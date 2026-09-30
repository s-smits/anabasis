// What a Luna launch decides about each session, and how its reports are read back. A session's
// outcome is three facts of its last attempt: Codex exited 0, that attempt wrote the report, and
// what Codex itself said. reports.md gains each session's section as it settles, and the drain
// prints what reports.md gained since the last drain.
import assert from "../src/meta/assert.ts";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { done, lunaRig, until } from "./helpers/luna-rig.ts";

import { afterAll, test } from "bun:test";

interface Row {
  name: string;
  status: string;
  exitCode: number | null;
  error: string | null;
  failureKind: string | null;
  attempts: number;
  reportPath: string;
}

interface Summary {
  type: string;
  outputDir: string;
  sessions: Row[];
}

const TOO_MANY = "429 Too Many Requests";

afterAll(cleanupScratch);

function kinds(summary: Summary): Record<string, [string, string | null]> {
  return Object.fromEntries(summary.sessions.map((row) => [row.name, [row.status, row.failureKind]]));
}

/** The launch's arguments after the manifest: the stand-in, the output directory, no pacing. */
function launchArgs(rig: ReturnType<typeof lunaRig>, codex = rig.codex): string[] {
  return ["--codex-bin", codex, "--output-dir", rig.out, "--start-interval-ms", "0", "--launch-only"];
}

test("labels a session rate limited only from what Codex itself said", () => {
  const rig = lunaRig("luna-rate-limit-");
  // Every session fails. "reader" read the 429 in a file, which Codex records as a command's
  // output; the others heard it from Codex, as an error event, on stderr, or as a failed turn.
  rig.plan({
    reader: [
      {
        thread: "thread_reader_0001",
        events: [
          { type: "item.completed", item: { type: "command_execution", aggregated_output: TOO_MANY } },
        ],
        exit: 1,
      },
    ],
    throttled: [{ thread: "thread_throttled_0001", events: [{ type: "error", message: TOO_MANY }], exit: 1 }],
    stderr: [{ thread: "thread_stderr_0001", stderr: `ERROR: ${TOO_MANY}`, exit: 1 }],
    turn: [
      {
        thread: "thread_turn_0001",
        events: [{ type: "turn.failed", error: { message: "Rate limit reached for requests" } }],
        exit: 1,
      },
    ],
    plain: [{ thread: "thread_plain_0001", stderr: "ERROR: the sandbox refused a write", exit: 1 }],
  });
  const names = ["reader", "throttled", "stderr", "turn", "plain"];
  const result = rig.run([
    "--manifest",
    rig.manifest(names.map((name) => ({ name, task: `Fail as ${name}.` }))),
    "--retries",
    "0",
    ...launchArgs(rig),
  ]);
  // A failed session fails the launch; the completion line counts only those Codex refused.
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stdout, /"rateLimitedCount":3/);
  assert.deepEqual(kinds(rig.read<Summary>("summary.json")), {
    reader: ["failed", null],
    throttled: ["failed", "rate-limit"],
    stderr: ["failed", "rate-limit"],
    turn: ["failed", "rate-limit"],
    plain: ["failed", null],
  });
});

test("labels a session from its last attempt, not from an earlier one it resumed", () => {
  const rig = lunaRig("luna-last-attempt-");
  const plainFailure = { stderr: "ERROR: the sandbox refused a write", exit: 1 };
  rig.plan({
    recovered: [
      { thread: "thread_recovered_0001", events: [{ type: "error", message: TOO_MANY }], exit: 1 },
      plainFailure,
    ],
    throttled: [
      { thread: "thread_throttled_0001", ...plainFailure },
      { stderr: `ERROR: ${TOO_MANY}`, exit: 1 },
    ],
  });
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "recovered", task: "Meet the refusal, then fail otherwise." },
      { name: "throttled", task: "Fail, then meet the refusal." },
    ]),
    ...launchArgs(rig),
  ]);
  assert.equal(result.exitCode, 1, result.stderr);
  const summary = rig.read<Summary>("summary.json");
  assert.deepEqual(
    summary.sessions.map((row) => row.attempts),
    [2, 2],
  );
  assert.deepEqual(kinds(summary), { recovered: ["failed", null], throttled: ["failed", "rate-limit"] });
});

test("settles a session Codex could not be started for as failed, and still writes the summary", () => {
  const rig = lunaRig("luna-spawn-");
  // An executable file whose interpreter is gone passes the launcher's check and fails to start.
  const codex = join(rig.root, "codex-without-interpreter");
  writeFileSync(codex, "#!/nonexistent/interpreter\n");
  chmodSync(codex, 0o700);
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "first", task: "Never start." },
      { name: "second", task: "Never start either." },
    ]),
    ...launchArgs(rig, codex),
  ]);
  assert.equal(result.exitCode, 1, result.stderr);
  const finished = result.stdout
    .split("\n")
    .filter((line) => line.includes('"luna_session.finished"'))
    .map((line) => parseJsonAs<Row>(line));
  const expected = { first: ["failed", "spawn"], second: ["failed", "spawn"] };
  assert.deepEqual(kinds({ type: "", outputDir: "", sessions: finished }), expected);
  const summary = rig.read<Summary>("summary.json");
  assert.deepEqual(kinds(summary), expected);
  for (const row of summary.sessions) {
    assert.equal(row.attempts, 2);
    assert.match(row.error ?? "", /ENOENT/);
  }
});

test("writes one summary row per session in manifest order, each report inside the output directory", () => {
  const rig = lunaRig("luna-summary-");
  rig.plan({
    late: [done("late", { sleepMs: 300 })],
    // Terminal escapes and a right-to-left override never reach reports.md.
    early: [done("early", { report: "report from early \u001B[31mred\u001B[0m ‮turned\n" })],
  });
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "late", task: "Finish last." },
      { name: "early", task: "Finish first." },
    ]),
    ...launchArgs(rig),
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const summary = rig.read<Summary>("summary.json");
  assert.equal(summary.type, "luna_sessions.completed");
  assert.equal(summary.outputDir, rig.out);
  assert.deepEqual(
    summary.sessions.map(({ name, status, exitCode, failureKind, reportPath }) => [
      name,
      status,
      exitCode,
      failureKind,
      reportPath,
    ]),
    [
      ["late", "completed", 0, null, join(rig.out, "late.md")],
      ["early", "completed", 0, null, join(rig.out, "early.md")],
    ],
  );
  const reports = readFileSync(join(rig.out, "reports.md"), "utf8");
  assert.match(reports, /^## late$/m);
  assert.match(reports, /^## early$/m);
  assert.match(reports, /report from early red turned/);
});

test("adds each session's report to reports.md as it settles, before the launch ends", async () => {
  const rig = lunaRig("luna-reports-");
  const release = join(rig.root, "release");
  rig.plan({ quick: [done("quick")], held: [done("held", { waitFor: release })] });
  const launch = rig.start([
    "--manifest",
    rig.manifest([
      { name: "held", task: "Finish when released." },
      { name: "quick", task: "Finish now." },
    ]),
    ...launchArgs(rig),
  ]);
  await until(() => existsSync(join(rig.out, "quick.result.json")), "the quick session to settle");
  const reportsPath = join(rig.out, "reports.md");
  const during = existsSync(reportsPath) ? readFileSync(reportsPath, "utf8") : "";
  // Released before any assertion, so a failing one leaves no launcher waiting.
  writeFileSync(release, "");
  assert.equal((await launch.exited()).exitCode, 0);
  assert.match(during, /^## quick$/m);
  assert.match(during, /report from quick/);
  assert.doesNotMatch(during, /^## held$/m);
  const after = readFileSync(reportsPath, "utf8");
  assert.ok(after.startsWith(during), "reports.md is only ever appended to");
  assert.equal(after.match(/^## quick$/gm)?.length, 1);
  assert.equal(after.match(/^## held$/gm)?.length, 1);
});

// Sixty reports of one 2026-09-29 batch sat unread because nothing drained them while it ran.
test("drains each finished report once, while the launch runs and after it ends", async () => {
  const rig = lunaRig("luna-drain-");
  const release = join(rig.root, "release");
  rig.plan({ quick: [done("quick")], held: [done("held", { waitFor: release })] });
  const launch = rig.start([
    "--manifest",
    rig.manifest([
      { name: "quick", task: "Finish now." },
      { name: "held", task: "Finish when released." },
    ]),
    ...launchArgs(rig),
  ]);
  await until(() => existsSync(join(rig.out, "quick.result.json")), "the quick session to finish");
  const first = rig.run(["--drain", rig.out]);
  writeFileSync(release, "");
  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(first.stdout, /^## quick$/m);
  assert.match(first.stdout, /report from quick/);
  assert.doesNotMatch(first.stdout, /^## held$/m);
  assert.equal((await launch.exited()).exitCode, 0);
  const second = rig.run(["--drain", rig.out]);
  assert.match(second.stdout, /^## held$/m);
  assert.doesNotMatch(second.stdout, /^## quick$/m);
  const third = rig.run(["--drain", rig.out]);
  assert.equal(third.exitCode, 0, third.stderr);
  assert.equal(third.stdout, "");
});

test("drains a retried session's new report, though an earlier drain printed its failure", () => {
  const rig = lunaRig("luna-drain-retry-");
  rig.plan({
    flaky: [{ thread: "thread_flaky_0001", stderr: "ERROR: stream disconnected", exit: 1 }, done("flaky")],
  });
  const launch = rig.run([
    "--manifest",
    rig.manifest([
      { name: "flaky", task: "Fail once." },
      { name: "steady", task: "Finish." },
    ]),
    "--retries",
    "0",
    ...launchArgs(rig),
  ]);
  assert.equal(launch.exitCode, 1, launch.stderr);
  const before = rig.run(["--drain", rig.out]);
  assert.match(before.stdout, /^## flaky\n\nStatus: failed$/m);
  assert.match(before.stdout, /^## steady$/m);
  const retry = rig.run([
    "--retry",
    rig.out,
    "--codex-bin",
    rig.codex,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(retry.exitCode, 0, retry.stderr);
  const after = rig.run(["--drain", rig.out]);
  assert.equal(after.exitCode, 0, after.stderr);
  assert.match(after.stdout, /^## flaky\n\nStatus: completed$/m);
  assert.match(after.stdout, /report from flaky/);
  assert.doesNotMatch(after.stdout, /^## steady$/m);
});

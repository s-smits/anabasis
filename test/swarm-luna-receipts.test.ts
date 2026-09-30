// What a Luna launch records about each session, and how its reports are read back: the failure
// label, the summary every WRI reader joins by name, and the drain that prints each report once.
import assert from "../src/meta/assert.ts";
import { existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { done, lunaRig, until } from "./helpers/luna-rig.ts";

import { afterAll, test } from "bun:test";

interface Summary {
  type: string;
  outputDir: string;
  sessions: {
    name: string;
    status: string;
    exitCode: number | null;
    failureKind: string | null;
    reportPath: string;
  }[];
}

const TOO_MANY = "429 Too Many Requests";

afterAll(cleanupScratch);

function kinds(summary: Summary): Record<string, [string, string | null]> {
  return Object.fromEntries(summary.sessions.map((row) => [row.name, [row.status, row.failureKind]]));
}

test("labels a session rate limited from what Codex reported, not from what a command printed", () => {
  const rig = lunaRig("luna-rate-limit-");
  // Both sessions fail on "429 Too Many Requests". One read it in a file, which Codex records as a
  // command's output; the other received it from the provider, which Codex records as an error.
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
  });
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "reader", task: "Read a file that quotes a status." },
      { name: "throttled", task: "Meet the refusal." },
    ]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  // A failed session fails the launch; the completion line counts only the one Codex refused.
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stdout, /"rateLimitedCount":1/);
  assert.deepEqual(kinds(rig.read<Summary>("summary.json")), {
    reader: ["failed", null],
    throttled: ["failed", "rate-limit"],
  });
});

test("reads a rate limit from Codex's stderr and from a failed turn", () => {
  const rig = lunaRig("luna-rate-limit-sources-");
  rig.plan({
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
  const result = rig.run([
    "--manifest",
    rig.manifest(["stderr", "turn", "plain"].map((name) => ({ name, task: `Fail as ${name}.` }))),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.deepEqual(kinds(rig.read<Summary>("summary.json")), {
    stderr: ["failed", "rate-limit"],
    turn: ["failed", "rate-limit"],
    plain: ["failed", null],
  });
});

test("writes one summary row per session in manifest order, each report inside the output directory", () => {
  const rig = lunaRig("luna-summary-");
  rig.plan({ late: [done("late", { sleepMs: 300 })], early: [done("early")] });
  const result = rig.run([
    "--manifest",
    rig.manifest([
      { name: "late", task: "Finish last." },
      { name: "early", task: "Finish first." },
    ]),
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const summary = rig.read<Summary>("summary.json");
  assert.equal(summary.type, "luna_sessions.completed");
  assert.equal(summary.outputDir, rig.out);
  assert.deepEqual(
    summary.sessions.map(({ name, status, exitCode, reportPath }) => [name, status, exitCode, reportPath]),
    [
      ["late", "completed", 0, join(rig.out, "late.md")],
      ["early", "completed", 0, join(rig.out, "early.md")],
    ],
  );
  const reports = readFileSync(join(rig.out, "reports.md"), "utf8");
  assert.match(reports, /^## late$/m);
  assert.match(reports, /^## early$/m);
  assert.match(reports, /report from early/);
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
    "--codex-bin",
    rig.codex,
    "--output-dir",
    rig.out,
    "--start-interval-ms",
    "0",
    "--launch-only",
  ]);
  await until(() => existsSync(join(rig.out, "quick.result.json")), "the quick session to finish");
  const first = rig.run(["--drain", rig.out]);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(first.stdout, /^## quick$/m);
  assert.match(first.stdout, /report from quick/);
  assert.doesNotMatch(first.stdout, /^## held$/m);
  writeFileSync(release, "");
  assert.equal((await launch.exited()).exitCode, 0);
  const second = rig.run(["--drain", rig.out]);
  assert.match(second.stdout, /^## held$/m);
  assert.doesNotMatch(second.stdout, /^## quick$/m);
  const third = rig.run(["--drain", rig.out]);
  assert.equal(third.exitCode, 0, third.stderr);
  assert.equal(third.stdout, "");
});

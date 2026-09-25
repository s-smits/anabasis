import assert from "../src/meta/assert.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { mkdtemp, rm } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { test } from "bun:test";

const SCRIPT = join(import.meta.dir, "../.claude/skills/monitor-session-until-idle/scripts/thread-state.mjs");

function snapshot(turns, status = "active") {
  return {
    thread: {
      id: "thread-1",
      hostId: "local",
      title: "Fixture",
      status: { type: status, activeFlags: [] },
    },
    turns,
  };
}

function run(...args) {
  return JSON.parse(runTextSyncOrThrow([Bun.argv[0], SCRIPT, ...args, "--json"]));
}

test("history restores chronology and projects user content and phases", async () => {
  const root = await mkdtemp(join(tmpdir(), "thread-state-"));
  const path = join(root, "snapshot.json");
  try {
    await Bun.write(
      path,
      JSON.stringify(
        snapshot([
          {
            id: "turn-2",
            status: "inProgress",
            startedAt: 2,
            items: [
              { id: "user-2", type: "userMessage", content: [{ type: "text", text: "Continue watching." }] },
            ],
          },
          {
            id: "turn-1",
            status: "completed",
            startedAt: 1,
            items: [
              { id: "agent-1", type: "agentMessage", phase: "final_answer", text: "The run remains active." },
            ],
          },
        ]),
      ),
    );
    const result = run("history", path, "--all");
    assert.deepEqual(
      result.recentItems.map((item) => item.id),
      ["agent-1", "user-2"],
    );
    assert.deepEqual(
      result.recentItems.map((item) => item.turnId),
      ["turn-1", "turn-2"],
    );
    assert.equal(result.recentItems[0].phase, "final_answer");
    assert.equal(result.recentItems[1].text, "Continue watching.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("idle completed state remains inspect-before-stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "thread-state-"));
  const path = join(root, "snapshot.json");
  try {
    await Bun.write(
      path,
      JSON.stringify(snapshot([{ id: "turn-1", status: "completed", startedAt: 1, items: [] }], "idle")),
    );
    assert.equal(run("summary", path).recommendation.code, "INSPECT_BEFORE_STOP");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown option, or none of the commands, refuses with exit 2 before reading a snapshot", () => {
  for (const [args, message] of [
    [["summary", "missing.json", "--lsat", "3"], /thread-state: unknown option "--lsat"/],
    [["summary", "missing.json", "--all"], /thread-state: unknown option "--all"/],
    [[], /thread-state: expected one of summary, history, diff/],
  ]) {
    const result = runSync([Bun.argv[0], SCRIPT, ...args]);
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.match(decodeOutput(result.stderr), message);
  }
});

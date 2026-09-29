import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { type ClaudeSession, processExists, readClaudeSession } from "../.claude/skills/main/session.ts";
import { sessionThreadState } from "../.claude/skills/monitor-session-until-idle/scripts/session-state.ts";

const SESSION = "0f3c9a52-7d41-4e8b-b6a0-5c2e91d4f7a3";

async function endedPid(): Promise<number> {
  const child = Bun.spawn([runtimeProcess.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
  await child.exited;
  return child.pid;
}

function configDir(records: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), "session-state-"));
  mkdirSync(join(home, "sessions"));
  for (const [file, text] of Object.entries(records)) writeFileSync(join(home, "sessions", file), text);
  return home;
}

function refusedWith(code: string): () => never {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

test("a process the probe may not signal reads as existing, and only ESRCH reads as ended", async () => {
  expect(processExists(runtimeProcess.pid)).toBe(true);
  expect(processExists(await endedPid())).toBe(false);
  expect(processExists("1")).toBe(false);
  expect(processExists(0)).toBe(false);
  // Another user's process, or any process outside a sandbox's wall, refuses for permission.
  const refused = spyOn(runtimeProcess, "kill").mockImplementation(refusedWith("EPERM"));
  try {
    expect(processExists(4242)).toBe(true);
    refused.mockImplementation(refusedWith("ESRCH"));
    expect(processExists(4242)).toBe(false);
  } finally {
    refused.mockRestore();
  }
});

test("the live record of a resumed session wins over the one its earlier process left", async () => {
  const dead = await endedPid();
  const home = configDir({
    [`${dead}.json`]: JSON.stringify({ pid: dead, sessionId: SESSION, status: "idle", name: "old" }),
    [`${runtimeProcess.pid}.json`]: JSON.stringify({
      pid: runtimeProcess.pid,
      sessionId: SESSION,
      cwd: "/work/anabasis",
      name: "main Session",
      status: "waiting",
      waitingFor: "input needed",
      statusUpdatedAt: Date.UTC(2026, 8, 28, 1, 51),
    }),
    "99.json": JSON.stringify({ pid: runtimeProcess.pid, sessionId: "another", status: "busy" }),
    "torn.json": '{"pid": 4',
    [`${runtimeProcess.pid}.key`]: "not json and never read",
  });
  mkdirSync(join(home, "projects", "-work-anabasis"), { recursive: true });
  const transcript = join(home, "projects", "-work-anabasis", `${SESSION}.jsonl`);
  writeFileSync(transcript, "{}\n");
  const now = Date.now();
  utimesSync(transcript, new Date(now - 600_000), new Date(now - 600_000));

  expect(readClaudeSession(home, SESSION, now)).toStrictEqual({
    sessionId: SESSION,
    pid: runtimeProcess.pid,
    live: true,
    name: "main Session",
    cwd: "/work/anabasis",
    status: "waiting",
    statusUpdatedAt: "2026-09-28T01:51:00.000Z",
    waitingFor: "input needed",
    transcript,
    quietSeconds: 600,
  });
});

test("a session no record names reads as not loaded, and one whose process ended as not live", async () => {
  const dead = await endedPid();
  const home = configDir({
    [`${dead}.json`]: JSON.stringify({ pid: dead, sessionId: SESSION, status: "busy" }),
  });
  const ended = readClaudeSession(home, SESSION);
  expect(ended.pid).toBe(dead);
  expect(ended.live).toBe(false);
  expect(ended.transcript).toBeNull();
  expect(readClaudeSession(home, "missing").pid).toBeNull();
});

test("with no live record the one that changed state last is read, whichever way it spells the time", async () => {
  const [older, newer, undated] = [await endedPid(), await endedPid(), await endedPid()];
  const home = configDir({
    [`${older}.json`]: JSON.stringify({
      pid: older,
      sessionId: SESSION,
      statusUpdatedAt: Date.UTC(2026, 8, 27),
    }),
    [`${newer}.json`]: JSON.stringify({
      pid: newer,
      sessionId: SESSION,
      statusUpdatedAt: "2026-09-28T10:07:00Z",
    }),
    [`${undated}.json`]: JSON.stringify({ pid: undated, sessionId: SESSION, statusUpdatedAt: "not a date" }),
  });
  const read = readClaudeSession(home, SESSION);
  expect(read.pid).toBe(newer);
  expect(read.statusUpdatedAt).toBe("2026-09-28T10:07:00.000Z");
});

function session(live: boolean, status: string | null, pid: number | null = 1): ClaudeSession {
  return {
    sessionId: SESSION,
    pid,
    live,
    name: null,
    cwd: null,
    status,
    statusUpdatedAt: null,
    waitingFor: status === "waiting" ? "input needed" : null,
    transcript: null,
    quietSeconds: null,
  };
}

test("a waiting session is a turn in progress to the checker, and one it cannot read never finished", () => {
  const states = [
    session(true, "busy"),
    session(true, "waiting"),
    session(true, "idle"),
    session(false, "busy"),
    session(true, null),
    session(false, null, null),
  ].map((entry) => {
    const { thread, latestTurn } = sessionThreadState(entry);
    return [thread.status, latestTurn.status];
  });
  expect(states).toStrictEqual([
    ["active", "inProgress"],
    ["active", "inProgress"],
    ["idle", "completed"],
    ["notLoaded", "completed"],
    ["idle", "unknown"],
    ["notLoaded", "unknown"],
  ]);
});

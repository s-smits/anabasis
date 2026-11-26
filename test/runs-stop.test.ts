// A stop ends the run's own process and what it started, and no sibling, and releases what the
// run's unfinished solves and sessions left on the host.
import { afterAll, describe, expect, it } from "bun:test";
import { keepCutNotes, sessionDirs } from "../src/builder/session.ts";
import { builderMemoryBlock, MEMORY_FILE } from "../src/builder/memory.ts";
import { append, read } from "../src/kernel/log.ts";
import { endedOf } from "../src/kernel/reports.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, dirname, join } from "../src/meta/path.ts";
import { capturedSpawn } from "../src/meta/process.ts";
import { processGroupExists, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import type { Run } from "../tools/runs/registry.ts";
import { seedCampaign } from "../tools/runs/seed.ts";
import { stateOf } from "../tools/runs/state.ts";
import { family, recordStop, stopProcessTree, unreleasedSandboxes } from "../tools/runs/stop.ts";

const root = mkdtempSync(join(tmpdir(), "ana-runs-stop-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("a stop", () => {
  // A Builder's root named for its session id alone, left mounted, would refuse that id to every
  // campaign on the host with a bare EEXIST.
  it("names what a run's unfinished solves and sessions left, and nothing of a seed's source", () => {
    const path = join(root, "r1", "log.jsonl");
    mkdirSync(dirname(path));
    for (const [kind, key, id] of [
      ["solve.started", "solve", "s-1"],
      ["solve.finished", "solve", "s-1"],
      ["solve.started", "solve", "s-2"],
      ["build.started", "session", "b-1"],
      ["build.finished", "session", "b-1"],
      ["build.started", "session", "b-2"],
      ["exam.started", "session", "x-1"],
      ["exam.finished", "session", "x-1"],
      ["exam.started", "session", "x-2"],
      ["draft.started", "session", "d-1"],
    ] as const) {
      append(path, kind, { [key]: id });
    }
    const left = (run: Parameters<typeof unreleasedSandboxes>[0]) =>
      unreleasedSandboxes(run)
        .map((dirs) => basename(dirs.root))
        .toSorted();
    expect(left({ path })).toEqual([
      "solve-build-r1-b-2",
      "solve-exam-r1-d-1",
      "solve-exam-r1-x-1",
      "solve-exam-r1-x-2",
      "solve-s-2",
    ]);
    const rested = join(root, "r2", "log.jsonl");
    mkdirSync(dirname(rested));
    append(rested, "exam.started", { session: "x-1" });
    append(rested, "exam.finished", { session: "x-1" });
    append(rested, "exam.started", { session: "x-2", conversation: "x-1" });
    append(rested, "exam.finished", { session: "x-2" });
    expect(left({ path: rested })).toEqual(["solve-exam-r2-x-1", "solve-exam-r2-x-2"]);
    const copy = join(root, "sim-r1", "log.jsonl");
    seedCampaign(dirname(path), dirname(copy), {});
    expect(left({ path: copy, seed: true })).toEqual([]);
    append(copy, "solve.started", { solve: "s-3" });
    append(copy, "build.started", { session: "b-2" });
    expect(left({ path: copy, seed: true })).toEqual(["solve-build-sim-r1-b-2", "solve-s-3"]);
  });

  // A stop releases a cut Builder's root, and its home with it, so the next session does not open
  // on the starter's notes after its predecessor was stopped.
  it("keeps a cut Builder's notes for the next session before its home goes", () => {
    const path = join(root, basename(root), "log.jsonl");
    const cut = sessionDirs(path, "b-1");
    try {
      mkdirSync(dirname(path));
      append(path, "build.started", { session: "b-1" });
      expect(unreleasedSandboxes({ path }).map(({ build }) => build)).toEqual(["b-1"]);
      mkdirSync(cut.home, { recursive: true });
      writeFileSync(join(cut.home, MEMORY_FILE), "Next: widen the sweep.\n");
      keepCutNotes(path, "b-1");
      rmSync(cut.root, { recursive: true, force: true });
      keepCutNotes(path, "b-1");
      expect(builderMemoryBlock(join(dirname(path), "memory"), ["b-1"])).toContain("Next: widen the sweep.");
    } finally {
      rmSync(cut.root, { recursive: true, force: true });
    }
  });

  it("ends a process started in a group of its own and its children, through the group", async () => {
    const child = capturedSpawn({
      cmd: ["sh", "-c", "echo up; sleep 60 & sleep 60"],
      stdin: "ignore",
      stdout: Bun.file(join(root, "launch-run-1.out")),
      stderr: Bun.file(join(root, "launch-run-1.err")),
      detached: true,
    });
    const ps = (...columns: string[]) => runTextSyncOrThrow(["ps", "-axo", columns.join(",")]);
    const out = Bun.file(join(root, "launch-run-1.out"));
    const up = async () => family(ps("pid=", "ppid="), child.pid).length > 1 && (await out.text()) === "up\n";
    const settled = Date.now() + 10_000;
    while (!(await up()) && Date.now() < settled) await Bun.sleep(20);
    const pids = family(ps("pid=", "ppid="), child.pid);
    expect(pids.length).toBeGreaterThan(1);
    expect(
      ps("pid=", "pgid=")
        .split("\n")
        .map((row) => row.trim().split(/\s+/).map(Number)),
    ).toContainEqual([child.pid, child.pid]);
    expect(await out.text()).toBe("up\n");
    expect(existsSync(join(root, "launch-run-1.err"))).toBe(true);
    expect(await stopProcessTree(child.pid)).toBe(0);
    expect(pids.some((pid) => processGroupExists(pid))).toBe(false);
  });

  it("records campaign.ended on direct stop, while preserving pauses, existing endings, and empty logs", () => {
    const mk = (name: string): Run => {
      const path = join(root, name, "log.jsonl");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
      return { name, tree: root, path, end: "comparison.reported" };
    };
    const closed = { writing: false, kept: false };
    const now = Date.now();

    const empty = mk("stop-empty");
    expect(recordStop(empty)).toBe(false);
    expect(read(empty.path)).toEqual([]);

    const direct = mk("stop-direct");
    append(direct.path, "campaign.opened", { project: "p" });
    append(direct.path, "harness.promoted", { from: "starter", harness: "h1" });
    append(direct.path, "build.checkpoint", { session: "b-2", harness: "h2" });
    append(direct.path, "solve.started", { solve: "s-1" });
    expect(recordStop(direct, "operator abort")).toBe(true);
    const directEvents = read(direct.path);
    expect(endedOf(directEvents)).toEqual({ ending: "stop", why: "operator abort" });
    expect(directEvents.at(-1)?.data).toMatchObject({ reference: "h1", latest: "h2" });
    expect(stateOf(directEvents, closed, now)).toEqual({ kind: "ended", ending: "stop" });
    expect(recordStop(direct)).toBe(false);

    const paused = mk("stop-paused");
    append(paused.path, "campaign.opened", { project: "p" });
    append(paused.path, "campaign.word", { word: "pause", why: "runs pause --after next" });
    append(paused.path, "build.started", { session: "b-1" });
    expect(recordStop(paused)).toBe(false);
    const pausedState = stateOf(read(paused.path), closed, now);
    expect(pausedState.kind).toBe("stopped");
    if (pausedState.kind === "stopped") expect(pausedState.pause?.why).toBe("runs pause --after next");

    const ended = mk("stop-ended");
    append(ended.path, "campaign.ended", { ending: "budget", why: "spent" });
    expect(recordStop(ended)).toBe(false);
    expect(endedOf(read(ended.path))).toEqual({ ending: "budget", why: "spent" });
  });
});

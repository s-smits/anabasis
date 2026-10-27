// A stop ends the run's own process and what it started, and no sibling, and releases what the
// run's unfinished solves and sessions left on the host.
import { describe, expect, it } from "bun:test";
import { keepCutNotes, sessionDirs } from "../src/builder/session.ts";
import { lastKept, SCRATCHPAD_FILE, seedMemory } from "../src/builder/memory.ts";
import { append } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, dirname, join } from "../src/meta/path.ts";
import { capturedSpawn } from "../src/meta/process.ts";
import {
  processGroupExists,
  runTextSyncOrThrow,
  terminateAndReapProcessGroupId,
} from "../src/meta/subprocess.ts";
import { seedCampaign } from "../tools/runs/seed.ts";
import { family, leftOpen } from "../tools/runs/stop.ts";

describe("a stop", () => {
  it("finds a process and all it started, the nearest first, and none beside it", () => {
    const table = ["  10     1", "  11    10", "  12    11", "  13    10", "  20     1", "  21    20"].join(
      "\n",
    );
    expect(family(table, 10)).toEqual([10, 11, 13, 12]);
    expect(family(table, 12)).toEqual([12]);
  });

  // What a stop releases. A Builder's root was once named for its session id alone, and one left
  // mounted refused that id to every campaign on the host with a bare EEXIST (2026-10-08).
  it("names what a run's unfinished solves and sessions left, and nothing of a seed's source", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-stop-test-"));
    try {
      const path = join(root, "r1", "log.jsonl");
      mkdirSync(dirname(path));
      append(path, "solve.started", { solve: "s-1" });
      append(path, "solve.finished", { solve: "s-1" });
      append(path, "solve.started", { solve: "s-2" });
      append(path, "build.started", { session: "b-1" });
      append(path, "build.finished", { session: "b-1" });
      append(path, "build.started", { session: "b-2" });
      // An Examiner session's root is capped as a Builder's, and a stop cut one (x-1, 2026-10-10).
      append(path, "exam.started", { session: "x-1" });
      append(path, "exam.finished", { session: "x-1" });
      append(path, "exam.started", { session: "x-2" });
      // A session that drafts an exam has one too since 11 October.
      append(path, "draft.started", { session: "d-1" });
      const left = (run: Parameters<typeof leftOpen>[0]) =>
        leftOpen(run)
          .map((dirs) => basename(dirs.root))
          .toSorted();
      expect(left({ path })).toEqual([
        "solve-build-r1-b-2",
        "solve-exam-r1-d-1",
        "solve-exam-r1-x-2",
        "solve-s-2",
      ]);
      // A seed of that run where it stands. The solve and the session the run has open are still
      // the run's, and may be live: a stop of the seed names only what the seed started.
      const copy = join(root, "sim-r1", "log.jsonl");
      seedCampaign(dirname(path), dirname(copy), {});
      expect(left({ path: copy, seed: true })).toEqual([]);
      append(copy, "solve.started", { solve: "s-3" });
      append(copy, "build.started", { session: "b-2" });
      expect(left({ path: copy, seed: true })).toEqual(["solve-build-sim-r1-b-2", "solve-s-3"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A stop releases a cut Builder's root, and its home with it. PR377-m1-air's b-2 opened on the
  // starter's notes after its b-1 was stopped (lane 33 of the investigation of 27 October).
  it("keeps a cut Builder's notes for the next session before its home goes", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-stop-test-"));
    const path = join(root, basename(root), "log.jsonl");
    const cut = sessionDirs(path, "b-1");
    try {
      mkdirSync(dirname(path));
      append(path, "build.started", { session: "b-1" });
      expect(leftOpen({ path }).map(({ build }) => build)).toEqual(["b-1"]);
      mkdirSync(cut.home, { recursive: true });
      writeFileSync(join(cut.home, SCRATCHPAD_FILE), "# Scratchpad\n\nNext: widen the sweep.\n");
      keepCutNotes(path, "b-1");
      rmSync(cut.root, { recursive: true, force: true });
      keepCutNotes(path, "b-1");
      const memory = join(dirname(path), "memory");
      const next = join(root, "b-2-home");
      mkdirSync(next);
      seedMemory(next, memory, lastKept(memory, ["b-1"]));
      expect(readFileSync(join(next, SCRATCHPAD_FILE), "utf8")).toContain("Next: widen the sweep.");
    } finally {
      rmSync(cut.root, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The campaign command is started niced, in a process group of its own, with its output in two
  // files (`bun run runs launch`).
  it("ends a process started in a group of its own and its children, through the group", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-stop-test-"));
    try {
      const child = capturedSpawn({
        cmd: ["sh", "-c", "echo up; sleep 60 & sleep 60"],
        stdin: "ignore",
        stdout: Bun.file(join(root, "launch-run-1.out")),
        stderr: Bun.file(join(root, "launch-run-1.err")),
        detached: true,
      });
      const ps = (...columns: string[]) => runTextSyncOrThrow(["ps", "-axo", columns.join(",")]);
      // The shell forks its first sleep and writes its line in its own time: wait for both, to a deadline.
      const out = Bun.file(join(root, "launch-run-1.out"));
      const up = async () =>
        family(ps("pid=", "ppid="), child.pid).length > 1 && (await out.text()) === "up\n";
      const settled = Date.now() + 10_000;
      while (!(await up()) && Date.now() < settled) await Bun.sleep(20);
      const pids = family(ps("pid=", "ppid="), child.pid);
      expect(pids.length).toBeGreaterThan(1);
      // It leads its group, so this test's end is not its end.
      expect(
        ps("pid=", "pgid=")
          .split("\n")
          .map((row) => row.trim().split(/\s+/).map(Number)),
      ).toContainEqual([child.pid, child.pid]);
      expect(await out.text()).toBe("up\n");
      expect(existsSync(join(root, "launch-run-1.err"))).toBe(true);
      for (const pid of pids) expect(await terminateAndReapProcessGroupId(pid)).toBe(true);
      expect(pids.some((pid) => processGroupExists(pid))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

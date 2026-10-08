// A launch is refused while its round could report nothing or would confound its own times, and a
// stop ends the run's own process and what it started, and no sibling.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  processGroupExists,
  runTextSyncOrThrow,
  terminateAndReapProcessGroupId,
} from "../src/meta/subprocess.ts";
import { spent } from "../src/builder/round.ts";
import { type Asked, family, preflight, start } from "../tools/runs/launch.ts";

const SETS = {
  feasible: ["a1", "a2", "p1", "c1"],
  anchor: ["a1", "a2"],
  released: ["p1"],
  admitted: [],
  candidates: ["c1"],
};
const ASKED: Asked = {
  target: undefined,
  admitted: false,
  loaded: false,
  load: 3,
  cores: 12,
  running: [],
  missing: null,
  spent: null,
};

describe("a launch's preflight", () => {
  it("lets a round start that has an anchor and a task to screen, and says its sets", () => {
    expect(preflight(SETS, ASKED)).toEqual({
      refusals: [],
      notes: ["2 anchor · 1 released for practice · 1 held to screen · 0 admitted"],
    });
  });

  it("refuses a scoring round with nothing to screen, and lets an anchor-only one say it cannot step", () => {
    const bare = { ...SETS, candidates: [] };
    expect(preflight(bare, ASKED).refusals).toEqual([
      expect.stringContaining("nothing to screen and cannot step"),
    ]);
    expect(preflight(bare, { ...ASKED, target: "24" }).refusals).toHaveLength(1);
    const anchorOnly = preflight(bare, { ...ASKED, target: "0" });
    expect(anchorOnly.refusals).toEqual([]);
    expect(anchorOnly.notes[1]).toContain("cannot read step");
    // Admitted tasks are scored only when the round is asked to.
    const admitted = { ...bare, admitted: ["s1"] };
    expect(preflight(admitted, ASKED).refusals).toHaveLength(1);
    expect(preflight(admitted, { ...ASKED, admitted: true }).refusals).toEqual([]);
  });

  it("refuses an empty log, a campaign with no anchor, a loaded host, a second start and a missing env file", () => {
    const none = { feasible: [], anchor: [], released: [], admitted: [], candidates: [] };
    expect(preflight(none, ASKED).refusals).toEqual([expect.stringContaining("holds no feasible task")]);
    expect(preflight({ ...SETS, anchor: [] }, ASKED).refusals).toEqual([
      expect.stringContaining("no anchor is drawn"),
    ]);
    const loaded = { ...ASKED, load: 14.2 };
    expect(preflight(SETS, loaded).refusals).toEqual([expect.stringContaining("load is 14.2 on 12 cores")]);
    expect(preflight(SETS, { ...loaded, loaded: true }).refusals).toEqual([]);
    expect(preflight(SETS, { ...ASKED, running: [41] }).refusals).toEqual([
      "the round is already running here, as pid 41",
    ]);
    expect(preflight(SETS, { ...ASKED, missing: "gone.env" }).refusals).toEqual(["gone.env is not there"]);
    expect(preflight({ ...SETS, released: [] }, ASKED).notes[1]).toContain("nothing to practise on");
  });

  it("refuses a session whose Builder started and did not end whole, in the round's own words", () => {
    const at = "2026-10-08T00:00:00.000Z";
    const started = { at, kind: "build.started", data: { session: "b-1" } } as const;
    const ended = (how: string) =>
      ({ at, kind: "build.finished", data: { session: "b-1", ended: how } }) as const;
    expect(spent([], "b-1")).toBeNull();
    expect(spent([started], "b-2")).toBeNull();
    expect(spent([started], "b-1")).toContain("started and never finished");
    expect(spent([started, ended("killed")], "b-1")).toContain("was killed");
    expect(spent([started, ended("wall")], "b-1")).toBeNull();
    expect(preflight(SETS, { ...ASKED, spent: "session b-1 was cut" }).refusals).toEqual([
      "session b-1 was cut. Pass another --session",
    ]);
  });
});

describe("a stop", () => {
  it("finds a process and all it started, the nearest first, and none beside it", () => {
    const table = ["  10     1", "  11    10", "  12    11", "  13    10", "  20     1", "  21    20"].join(
      "\n",
    );
    expect(family(table, 10)).toEqual([10, 11, 13, 12]);
    expect(family(table, 12)).toEqual([12]);
  });

  it("ends a started process and its children, which ran in a group of their own", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-launch-test-"));
    try {
      const child = start(["sh", "-c", "echo up; sleep 60 & sleep 60"], join(root, "launch-b-1"));
      await Bun.sleep(300);
      const ps = (...columns: string[]) => runTextSyncOrThrow(["ps", "-axo", columns.join(",")]);
      const pids = family(ps("pid=", "ppid="), child.pid);
      expect(pids.length).toBeGreaterThan(1);
      // It leads its group, so this test's end is not its end.
      expect(
        ps("pid=", "pgid=")
          .split("\n")
          .map((row) => row.trim().split(/\s+/).map(Number)),
      ).toContainEqual([child.pid, child.pid]);
      expect(await Bun.file(join(root, "launch-b-1.out")).text()).toBe("up\n");
      expect(existsSync(join(root, "launch-b-1.err"))).toBe(true);
      for (const pid of pids) expect(await terminateAndReapProcessGroupId(pid)).toBe(true);
      expect(pids.some((pid) => processGroupExists(pid))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

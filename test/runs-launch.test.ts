// A launch is refused while its comparison could report nothing or would confound its own times,
// and a stop ends the run's own process and what it started, and no sibling.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, dirname, join } from "../src/meta/path.ts";
import {
  processGroupExists,
  runTextSyncOrThrow,
  terminateAndReapProcessGroupId,
} from "../src/meta/subprocess.ts";
import { admission, sessionAdmission, type Supply } from "../src/builder/admission.ts";
import { spent } from "../src/builder/session.ts";
import { claimed } from "../src/examiner/session.ts";
import { append, type LogEvent } from "../src/kernel/log.ts";
import {
  type Asked,
  examPreflight,
  family,
  launch,
  leftOpen,
  preflight,
  reportedAs,
  sessionPreflight,
  sessionTaken,
  settingFlagged,
  start,
} from "../tools/runs/launch.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import { seedCampaign } from "../tools/runs/seed.ts";

/** A campaign whose checker was read with no fault and is not frozen. */
const SETS: Supply = {
  held: 4,
  awaiting: 0,
  released: 1,
  untied: null,
  since: 0,
  faults: 0,
  frozen: false,
  stop: { checkpoints: 0, sinceStep: 0, stop: false },
};
const ASKED: Asked = {
  target: 12,
  solves: 2,
  level: 0.1,
  builds: true,
  cap: { dollars: 600, reserve: 10 },
  reported: null,
  loaded: false,
  load: 3,
  cores: 12,
  running: [],
  missing: null,
  spent: null,
  named: { solver: undefined, limits: LIMITS },
  ran: null,
};

describe("a launch's preflight", () => {
  it("is the comparison's own admission, with what only the host and the id can refuse", () => {
    const wanted = { target: 12, solves: 2, level: 0.1, builds: true, cap: ASKED.cap, restarted: [] };
    expect(preflight(SETS, ASKED)).toEqual(admission(SETS, wanted));
    // Both are said at once: what the log refuses, then what the host does.
    const unread = { ...SETS, faults: null };
    expect(preflight(unread, { ...ASKED, load: 14.2 }).refusals).toEqual([
      ...admission(unread, wanted).refusals,
      expect.stringContaining("load is 14.2 on 12 cores"),
    ]);
    // The operator's reason to go on past the stop rule reaches the admission as it was given.
    const stopped = { ...SETS, stop: { checkpoints: 3, sinceStep: 3, stop: true } };
    expect(preflight(stopped, ASKED).refusals).toHaveLength(1);
    expect(preflight(stopped, { ...ASKED, pastStop: "new tasks since" }).refusals).toEqual([]);
  });

  it("refuses a loaded host, a second start and a missing env file", () => {
    const loaded = { ...ASKED, load: 14.2 };
    expect(preflight(SETS, loaded).refusals).toEqual([expect.stringContaining("load is 14.2 on 12 cores")]);
    expect(preflight(SETS, { ...loaded, loaded: true }).refusals).toEqual([]);
    expect(preflight(SETS, { ...ASKED, running: [41] }).refusals).toEqual([
      "this campaign's log is already being written here, by pid 41",
    ]);
    expect(preflight(SETS, { ...ASKED, missing: "gone.env" }).refusals).toEqual(["gone.env is not there"]);
  });

  it("refuses an id whose comparison has reported: a comparison that reported is finished", () => {
    const at = "2026-10-09T00:00:00.000Z";
    const log: LogEvent[] = [
      { at, kind: "comparison.reported", data: { session: "g0", reading: "no-step" } },
    ];
    expect(reportedAs(log, "g1")).toBeNull();
    expect(reportedAs(log, "g0")).toBe(
      "comparison g0 has reported no-step, and a comparison that reported is finished",
    );
    expect(preflight(SETS, { ...ASKED, reported: reportedAs(log, "g0") }).refusals).toEqual([
      "comparison g0 has reported no-step, and a comparison that reported is finished. Pass another id",
    ]);
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
    // A whole session with no report goes on whenever it is asked to, whatever ran since.
    const later = { at, kind: "build.started", data: { session: "b-2" } } as const;
    expect(spent([started, ended("wall"), later], "b-1")).toBeNull();
    expect(preflight(SETS, { ...ASKED, spent: "session b-1 was cut" }).refusals).toEqual([
      "session b-1 was cut. Pass another --session",
    ]);
  });
});

describe("a launch of a Builder session with no comparison after it", () => {
  const at = "2026-10-09T00:00:00.000Z";

  it("is the session's own admission, with what only the host and the id can refuse", () => {
    expect(sessionPreflight(SETS, ASKED)).toEqual(sessionAdmission(SETS, { cap: ASKED.cap }));
    // It scores nothing: a log with no held-out task, which refuses a comparison, does not refuse it.
    const none = { ...SETS, held: 0 };
    expect(preflight(none, ASKED).refusals).toHaveLength(1);
    expect(sessionPreflight(none, ASKED).refusals).toEqual([]);
    const unread = { ...SETS, faults: null };
    expect(sessionPreflight(unread, { ...ASKED, cap: null, load: 14.2 }).refusals).toEqual([
      ...sessionAdmission(unread, { cap: null }).refusals,
      expect.stringContaining("load is 14.2 on 12 cores"),
    ]);
  });

  it("refuses a session that ended, which launched again would only say what it left", () => {
    const started = { at, kind: "build.started", data: { session: "b-2" } } as const;
    const ended = { at, kind: "build.finished", data: { session: "b-2", ended: "wall" } } as const;
    expect(sessionTaken([], "b-2")).toBeNull();
    expect(sessionTaken([started], "b-2")).toContain("started and never finished");
    expect(sessionTaken([started, ended], "b-2")).toBe(
      "session b-2 has ended, and what it left is on record",
    );
    // Inside a round the same session goes on to its comparison, and is not refused.
    expect(spent([started, ended], "b-2")).toBeNull();
    expect(sessionTaken([started, ended], "b-3")).toBeNull();
  });

  it("is named by --no-comparison, which neither a checkpoint nor an Examiner session takes", async () => {
    const flags = ["--name", "no-such-campaign", "--no-comparison"];
    await expect(launch([...flags, "--id", "g2"])).rejects.toThrow(
      "--no-comparison names a Builder session by itself",
    );
    await expect(
      launch([...flags, "--session", "x-1", "--examiner", "claude/claude-opus-5-5"]),
    ).rejects.toThrow("--no-comparison names a Builder session by itself");
  });
});

describe("a launch's reading of the setting", () => {
  it("refuses a wall the command itself would refuse, before anything starts", async () => {
    const flags = ["--name", "no-such-campaign", "--session", "b-1"];
    await expect(launch([...flags, "--solve-minutes", "0"])).rejects.toThrow(
      "--solve-minutes 0 --solve-turns 24: a solve's wall and its turns are whole numbers of at least one",
    );
    await expect(
      launch(["--name", "no-such-campaign", "--id", "g2", "--solve-turns", "2.5"]),
    ).rejects.toThrow("--solve-minutes 120 --solve-turns 2.5");
  });

  it("holds a comparison's flags to the campaign's record, and none of an Examiner session's", () => {
    const at = "2026-10-09T00:00:00.000Z";
    const record = { solver: null, minutes: 8, turns: 24, modelTurns: null, tasks: null, target: 12 };
    const log: LogEvent[] = [{ at, kind: "campaign.setting", data: record }];
    expect(settingFlagged({}, log).named.limits.wallSeconds).toBe(480);
    expect(() => settingFlagged({ "solve-minutes": "5" }, log)).toThrow(
      "--solve-minutes 5 names another setting than the campaign's",
    );
    expect(settingFlagged({ "solve-minutes": "5", "new-setting": true }, log).record).toMatchObject({
      minutes: 5,
    });
    // An Examiner's --tasks is how many tasks it may write, and no scored set: nothing is refused.
    expect(settingFlagged({ examiner: "claude/claude-opus-5-5", tasks: "6" }, log).tasks).toBeUndefined();
  });

  it("says in a note when that setting is not the one the log's last solves ran under", () => {
    const ran = { model: "p/m", effort: "high", limits: LIMITS };
    const longer = { solver: undefined, limits: { ...LIMITS, wallSeconds: 4 * 3600 } };
    const told = "are another setting's";
    expect(preflight(SETS, { ...ASKED, ran }).notes.join("\n")).not.toContain(told);
    expect(preflight(SETS, { ...ASKED, named: longer, ran }).notes.at(-1)).toContain(told);
    // The share on record is then another setting's, and every task is counted whole.
    const tied = { ...SETS, held: 12, untied: 0.25 };
    expect(preflight(tied, { ...ASKED, ran }).refusals).toHaveLength(1);
    expect(preflight(tied, { ...ASKED, named: longer, ran }).refusals).toEqual([]);
    // An Examiner session solves nothing, so nothing of the kind is said of it.
    expect(examPreflight([], { ...ASKED, named: longer, ran }).notes.join("\n")).not.toContain(told);
  });
});

describe("an Examiner session's preflight", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at, kind, data });
  /** One session's task, held out. */
  const left = [
    event("exam.started", { session: "x-1" }),
    event("task.proposed", {
      version: "v1",
      taskId: "x-1-001",
      session: "x-1",
      task: { taskId: "x-1-001", family: "fixture", publicInput: {}, hidden: null },
    }),
    event("task.gate", { version: "v1", gate: 1, outcome: "passed" }),
  ];

  it("needs the campaign's log and no set in it, and says where its tasks go", () => {
    expect(examPreflight(left, ASKED)).toEqual({
      refusals: [],
      notes: ["1 held out · 0 released for practice: what this session writes is held out beside them"],
    });
    expect(examPreflight(null, ASKED)).toEqual({
      refusals: [expect.stringContaining("the campaign has no log in this worktree")],
      notes: [],
    });
  });

  it("refuses a session id the log holds, a loaded host and a second writer, as a round's does", () => {
    expect(claimed(left, "x-2")).toBeNull();
    const again = examPreflight(left, {
      ...ASKED,
      spent: claimed(left, "x-1"),
      load: 14.2,
      running: [41],
    });
    expect(again.refusals).toEqual([
      "this campaign's log is already being written here, by pid 41",
      expect.stringContaining("load is 14.2 on 12 cores"),
      "session x-1 is in the log already; a session's id names one session. Pass another --session",
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

  // What a stop releases. A Builder's root was once named for its session id alone, and one left
  // mounted refused that id to every campaign on the host with a bare EEXIST (2026-10-08).
  it("names what a run's unfinished solves and Builder session left, and nothing of a seed's source", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-runs-launch-test-"));
    try {
      const path = join(root, "r1", "log.jsonl");
      mkdirSync(dirname(path));
      append(path, "solve.started", { solve: "s-1" });
      append(path, "solve.finished", { solve: "s-1" });
      append(path, "solve.started", { solve: "s-2" });
      append(path, "build.started", { session: "b-1" });
      append(path, "build.finished", { session: "b-1" });
      append(path, "build.started", { session: "b-2" });
      const left = (run: Parameters<typeof leftOpen>[0]) => leftOpen(run).map((dirs) => basename(dirs.root));
      expect(left({ path })).toEqual(["solve-s-2", "solve-build-r1-b-2"]);
      // A seed of that run where it stands. The solve and the session the run has open are still
      // the run's, and may be live: a stop of the seed names only what the seed started.
      const copy = join(root, "sim-r1", "log.jsonl");
      seedCampaign(dirname(path), dirname(copy), {});
      expect(left({ path: copy, seed: true })).toEqual([]);
      append(copy, "solve.started", { solve: "s-3" });
      append(copy, "build.started", { session: "b-2" });
      expect(left({ path: copy, seed: true })).toEqual(["solve-s-3", "solve-build-sim-r1-b-2"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

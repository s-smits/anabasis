// A launch is refused while its round could report nothing or would confound its own times, and a
// stop ends the run's own process and what it started, and no sibling.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { basename, dirname, join } from "../src/meta/path.ts";
import {
  processGroupExists,
  runTextSyncOrThrow,
  terminateAndReapProcessGroupId,
} from "../src/meta/subprocess.ts";
import { spent } from "../src/builder/round.ts";
import { claimed } from "../src/examiner/session.ts";
import { append, type LogEvent } from "../src/kernel/log.ts";
import {
  type Asked,
  examPreflight,
  family,
  launch,
  leftOpen,
  preflight,
  start,
} from "../tools/runs/launch.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import { seedCampaign } from "../tools/runs/seed.ts";

const SETS = {
  feasible: ["a1", "a2", "p1", "c1"],
  anchor: ["a1", "a2"],
  released: ["p1"],
  admitted: [],
  candidates: ["c1"],
};
const ASKED: Asked = {
  target: undefined,
  // A level one win clears and a floor the anchor meets: a round of this size can read step.
  level: 0.5,
  anchorFloor: 2,
  loaded: false,
  load: 3,
  cores: 12,
  running: [],
  missing: null,
  spent: null,
  solves: 3,
  limits: LIMITS,
  ran: null,
};

describe("a launch's preflight", () => {
  it("lets a round start that has an anchor and a task to screen, and says its sets and its size", () => {
    const { refusals, notes } = preflight(SETS, ASKED);
    expect(refusals).toEqual([]);
    expect(notes).toHaveLength(3);
    expect(notes.slice(0, 2)).toEqual([
      "2 anchor · 1 released for practice · 1 held to screen · 0 admitted",
      "at most 1 task can be scored; at --level 0.5 the smallest results that clear are 1-0",
    ]);
    // One task, won outright 12 times in 100: the chance is the effect's own share.
    expect(notes[2]).toStartWith(
      "the chance that the scored test clears on 1 task at 3 solves a side, were the true effect: 12 points as 12 tasks in 100 turned from failed to passed, 0.12; ",
    );
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
    // A task an earlier round admitted is in the pool: this round screens it again.
    expect(preflight({ ...bare, admitted: ["s1"] }, ASKED).refusals).toEqual([]);
  });

  // As exam-1 stood on 2026-10-08: an anchor under the round's floor of eight, and one task held.
  it("says when a round is too small for either of its tests, at the round's own defaults", () => {
    const small = { ...ASKED, level: 0.1, anchorFloor: 8 };
    expect(preflight(SETS, small).notes.slice(1)).toEqual([
      "at most 1 task(s) can be scored, and at --level 0.1 a step takes 4, all won: this round cannot read step. Its screening still retires each candidate both harnesses pass, as too-easy",
      "the anchor holds 2 task(s) and --anchor-floor is 8: the anchor cannot be tested, so the round reads neither step nor anchor-lost",
    ]);
    // Four tasks to screen can read a step, and the launch says what it takes and how likely it is:
    // all four won, which a quarter of the tasks turned gives 1 time in 256.
    const four = { ...SETS, candidates: ["c1", "c2", "c3", "c4"] };
    const able = preflight(four, { ...small, anchorFloor: 2 }).notes;
    expect(able).toHaveLength(3);
    expect(able[1]).toBe(
      "at most 4 tasks can be scored; at --level 0.1 the smallest results that clear are 4-0",
    );
    expect(able[2]).toContain("25 points as 25 tasks in 100 turned, 0.00;");
    // The solves a side move the chance of an effect spread over every task, and of no other.
    const once = preflight(four, { ...small, anchorFloor: 2, solves: 1 }).notes[2] ?? "";
    expect(once).toContain("at 1 solve a side");
    expect(once.split("; ")[0]).toBe((able[2] ?? "").split("; ")[0]?.replace("3 solves", "1 solve"));
    expect(once.split("; ")[3]).not.toBe((able[2] ?? "").split("; ")[3]);
    // A target under the sweep caps the scored set as few candidates do.
    expect(preflight(four, { ...small, anchorFloor: 2, target: "3" }).notes[1]).toContain("at most 3");
    expect(preflight(four, { ...small, anchorFloor: 2, level: 0.05 }).notes[1]).toContain("a step takes 5");
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
      "this campaign's log is already being written here, by pid 41",
    ]);
    expect(preflight(SETS, { ...ASKED, missing: "gone.env" }).refusals).toEqual(["gone.env is not there"]);
    expect(preflight({ ...SETS, released: [] }, ASKED).notes.at(-1)).toContain("nothing to practise on");
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

describe("a launch under limits the log's last solves did not run under", () => {
  const longer = { ...LIMITS, wallSeconds: 4 * 3600 };

  it("says that every standing restarts, for a round and for an Examiner session", () => {
    // No solve on record, or the same limits: nothing restarts, and nothing is said.
    expect(preflight(SETS, ASKED).notes.join("\n")).not.toContain("no standing carries over");
    expect(preflight(SETS, { ...ASKED, ran: LIMITS }).notes.join("\n")).not.toContain("carries over");
    const note =
      "a solve here is held to 240 minutes and 24 turns, and the log's last test-side solves ran under 120 minutes and 24 turns: under other limits no standing carries over, so each task screened is solved under both harnesses and each reach task is put to the stronger solver again (tools/d2/limits.ts)";
    expect(preflight(SETS, { ...ASKED, limits: longer, ran: LIMITS }).notes.at(-1)).toBe(note);
    const exam = examPreflight([], { ...ASKED, limits: longer, ran: LIMITS, reviewer: true });
    expect(exam.notes.at(-1)).toBe(note);
    // More turns are other limits too.
    expect(
      preflight(SETS, { ...ASKED, limits: { ...LIMITS, turns: 48 }, ran: LIMITS }).notes.at(-1),
    ).toContain("held to 120 minutes and 48 turns");
  });

  it("refuses a wall the command itself would refuse, before anything starts", async () => {
    const flags = ["--name", "no-such-campaign", "--session", "b-1"];
    await expect(launch([...flags, "--solve-minutes", "0"])).rejects.toThrow(
      "--solve-minutes 0 --solve-turns 24: a solve's wall and its turns are whole numbers of at least one",
    );
    await expect(launch([...flags, "--examiner", "m", "--solve-turns", "2.5"])).rejects.toThrow(
      "--solve-minutes 120 --solve-turns 2.5",
    );
  });
});

describe("an Examiner session's preflight", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at, kind, data });
  /** A session's task as far as gate 3: the log of exam-1 when the provider's limit ended x-1. */
  const left = [
    event("exam.started", { session: "x-1" }),
    event("task.proposed", {
      version: "v1",
      taskId: "x-1-001",
      session: "x-1",
      task: { taskId: "x-1-001", family: "fixture", publicInput: {}, hidden: null },
    }),
    event("task.gate", { version: "v1", gate: 1, outcome: "passed" }),
    event("verdict", { solve: "s-1", task: "x-1-001", answer: { answer: "1" }, kind: "pass" }),
    event("task.gate", { version: "v1", gate: 2, outcome: "passed", solve: "s-1" }),
    event("task.gate", { version: "v1", gate: 3, outcome: "passed" }),
  ];

  const REVIEWED = { ...ASKED, reviewer: true };

  it("needs the campaign's log and no set in it, and says what the session is handed", () => {
    expect(examPreflight(left, REVIEWED)).toEqual({
      refusals: [],
      notes: [
        "x-1-001 passed gate 3 in an earlier session and is handed to this one for its controls",
        expect.stringContaining("no anchor is drawn: run tools/d2/prepare.ts after this session"),
      ],
    });
    // A pack's task through its four gates and drawn: this session's tasks come after the anchor.
    const drawn = [
      ...left,
      event("task.proposed", { version: "a1" }),
      ...[1, 2, 3, 4].map((gate) =>
        event("task.gate", { version: "a1", gate, outcome: "passed", controls: "d" }),
      ),
      event("anchor.drawn", { tasks: ["a1"] }),
    ];
    expect(examPreflight(drawn, REVIEWED).notes[1]).toContain("is not drawn into the anchor");
    expect(examPreflight(null, { ...ASKED, reviewer: false })).toEqual({
      refusals: [expect.stringContaining("the campaign has no log in this worktree")],
      notes: [],
    });
    // With no reviewer a too-hard word is all that is kept of a refused stronger solve.
    expect(examPreflight(left, { ...ASKED, reviewer: false }).notes.at(-1)).toContain(
      "no --reviewer: a task whose stronger solve a check refuses is closed as too hard",
    );
  });

  it("refuses a session id the log holds, a loaded host and a second writer, as a round's does", () => {
    expect(claimed(left, "x-2")).toBeNull();
    const again = examPreflight(left, {
      ...REVIEWED,
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

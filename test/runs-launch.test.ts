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
import { spent } from "../src/builder/round.ts";
import { claimed } from "../src/examiner/session.ts";
import { append, type LogEvent } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import {
  type Asked,
  examPreflight,
  family,
  launch,
  leftOpen,
  preflight,
  start,
  type Supply,
  supplyOf,
} from "../tools/runs/launch.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import { seedCampaign } from "../tools/runs/seed.ts";

const SETS: Supply = { held: 4, awaiting: 0, released: 1, untied: null };
const ASKED: Asked = {
  target: 12,
  solves: 2,
  level: 0.1,
  builds: true,
  capped: true,
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
  it("lets a comparison start that can read a step, and says its sets and its size", () => {
    const { refusals, notes } = preflight(SETS, ASKED);
    expect(refusals).toEqual([]);
    expect(notes).toEqual([
      "4 held out · 1 released for practice · 4 to score",
      ...sizeLines(4, { solves: 2, level: 0.1 }),
    ]);
    expect(notes[1]).toBe(
      "4 held-out tasks can be scored; at --level 0.1 the smallest results that clear are 4-0",
    );
    // A target caps the scored set as few held-out tasks do.
    expect(preflight({ ...SETS, held: 20 }, ASKED).notes[0]).toBe(
      "20 held out · 1 released for practice · 12 to score",
    );
  });

  // As exam-1 stood on 2026-10-08, with one task to score. It was a note then, and eight rounds ran.
  it("refuses a comparison of fewer tasks than a step takes: it could not read one", () => {
    const small = preflight({ ...SETS, held: 3 }, ASKED);
    expect(small.refusals).toEqual([
      "3 held-out tasks can be scored, and at --level 0.1 a step takes 4, all won: this comparison cannot read a step. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks",
    ]);
    expect(small.notes).toEqual(["3 held out · 1 released for practice · 3 to score"]);
    // A target under the least sweep is refused as few tasks are, and says which it is.
    expect(preflight(SETS, { ...ASKED, target: 3 }).refusals).toEqual([
      expect.stringContaining("and ask for a --target of 4 or more"),
    ]);
    expect(preflight(SETS, { ...ASKED, level: 0.05 }).refusals).toEqual([
      expect.stringContaining("a step takes 5"),
    ]);
  });

  it("counts untied tasks: it refuses a comparison the campaign's own tie share leaves too few of", () => {
    // The last comparison left a quarter of its tasks untied. Twelve tasks then leave about
    // three, and a step takes four.
    const tied = { ...SETS, held: 12, untied: 0.25 };
    expect(preflight(tied, ASKED).refusals).toEqual([
      "the campaign's last comparison left 25% of its tasks untied, and at that share 12 scored tasks leave about 3.0 untied, where at --level 0.1 a step takes 4, all won: this comparison could hardly read a step. Run an Examiner session (tools/d1b/examine.ts) for more held-out tasks, or change the budget so that fewer tasks tie",
    ]);
    // At a half, twelve leave six, and it starts. Before any comparison every task is counted.
    expect(preflight({ ...tied, untied: 0.5 }, ASKED).refusals).toEqual([]);
    expect(preflight({ ...tied, untied: null }, ASKED).refusals).toEqual([]);
    // The share is the last tallied comparison's: its wins and losses over the tasks it tallied.
    const at = "2026-10-09T00:00:00.000Z";
    const reported = (session: string, more: LogEvent["data"]): LogEvent => ({
      at,
      kind: "comparison.reported",
      data: { session, ...more },
    });
    const log = [
      reported("b-1", { scored: { wins: 6, losses: 0, ties: 2 }, versions: Array(8).fill("v") }),
      reported("b-2", { scored: { wins: 1, losses: 1, ties: 6 }, versions: Array(8).fill("v") }),
      // One the cap cut, and one with every task set aside, tallied nothing and say nothing of it.
      reported("b-3", { scored: null, versions: [], capped: true }),
      reported("b-4", { scored: { wins: 0, losses: 0, ties: 0 }, versions: [] }),
    ];
    expect(supplyOf(log)).toEqual({ held: 0, awaiting: 0, released: 0, untied: 0.25 });
    expect(supplyOf([]).untied).toBeNull();
  });

  it("refuses a comparison that names no dollar cap", () => {
    expect(preflight(SETS, { ...ASKED, capped: false }).refusals).toEqual([
      "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
    ]);
  });

  it("refuses an empty log, a loaded host, a second start and a missing env file", () => {
    const none = { ...SETS, held: 0, released: 0 };
    expect(preflight(none, ASKED).refusals).toEqual([expect.stringContaining("holds no held-out task")]);
    const loaded = { ...ASKED, load: 14.2 };
    expect(preflight(SETS, loaded).refusals).toEqual([expect.stringContaining("load is 14.2 on 12 cores")]);
    expect(preflight(SETS, { ...loaded, loaded: true }).refusals).toEqual([]);
    expect(preflight(SETS, { ...ASKED, running: [41] }).refusals).toEqual([
      "this campaign's log is already being written here, by pid 41",
    ]);
    expect(preflight(SETS, { ...ASKED, missing: "gone.env" }).refusals).toEqual(["gone.env is not there"]);
    // A round's Builder needs practice, and a checkpoint has no Builder.
    const unreleased = { ...SETS, released: 0 };
    expect(preflight(unreleased, ASKED).notes.at(-1)).toContain("nothing to practise on");
    expect(preflight(unreleased, { ...ASKED, builds: false }).notes.join("\n")).not.toContain("practise");
    // A task that waits for a person's label is said, and is not among the tasks to score.
    expect(preflight({ ...SETS, awaiting: 2 }, ASKED).notes).toContain(
      "2 held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)",
    );
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

describe("a launch under limits the log's last solves did not run under", () => {
  const longer = { ...LIMITS, wallSeconds: 4 * 3600 };

  it("says that what the log measured so far was another setting's, for a round and a checkpoint", () => {
    const told = "are another setting's";
    // No solve on record, or the same limits: nothing moved, and nothing is said.
    expect(preflight(SETS, ASKED).notes.join("\n")).not.toContain(told);
    const ran = { model: "p/m", effort: "high", limits: LIMITS };
    expect(preflight(SETS, { ...ASKED, ran }).notes.join("\n")).not.toContain(told);
    const note =
      "a solve here is held to 240 minutes and 24 turns, and the log's last test-side solves ran under 120 minutes and 24 turns: the tallies, the tie share and the cost of a solve on record are another setting's, and say little of this comparison (tools/d2/setting.ts)";
    const under = (limits: typeof LIMITS) => ({ solver: undefined, limits });
    expect(preflight(SETS, { ...ASKED, named: under(longer), ran }).notes.at(-1)).toBe(note);
    // An Examiner session solves nothing, so nothing of the kind is said of it.
    expect(examPreflight([], { ...ASKED, named: under(longer), ran }).notes.join("\n")).not.toContain(told);
    // More turns are other limits too.
    expect(preflight(SETS, { ...ASKED, named: under({ ...LIMITS, turns: 48 }), ran }).notes.at(-1)).toContain(
      "held to 120 minutes and 48 turns",
    );
    // Another solver than the log's last is said the same way, and the same one is not.
    const other = { solver: { model: "p/other", effort: "high" as const }, limits: LIMITS };
    expect(preflight(SETS, { ...ASKED, named: other, ran }).notes.at(-1)).toContain(
      "solves here are p/other at high, and the log's last test-side solves were p/m at high: the tallies",
    );
    const same = { solver: { model: "p/m", effort: "high" as const }, limits: LIMITS };
    expect(preflight(SETS, { ...ASKED, named: same, ran }).notes.join("\n")).not.toContain(told);
  });

  it("refuses a wall the command itself would refuse, before anything starts", async () => {
    const flags = ["--name", "no-such-campaign", "--session", "b-1"];
    await expect(launch([...flags, "--solve-minutes", "0"])).rejects.toThrow(
      "--solve-minutes 0 --solve-turns 24: a solve's wall and its turns are whole numbers of at least one",
    );
    await expect(
      launch(["--name", "no-such-campaign", "--id", "g2", "--solve-turns", "2.5"]),
    ).rejects.toThrow("--solve-minutes 120 --solve-turns 2.5");
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

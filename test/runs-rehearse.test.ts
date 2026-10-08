// A seed is a campaign's folder under another name with its log cut where a question starts. A
// rehearsal's script takes each task's answers from what is on record, hands the harness's own
// artifact-writer the one its side was scripted to, and names a solve that ended otherwise.
import { afterAll, describe, expect, it } from "bun:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import { type TaskPackage, taskVersion } from "../src/kernel/task.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { parseArgs } from "../src/meta/process.ts";
import type { Kept } from "../tools/d2/campaign.ts";
import type { Campaign } from "../tools/d2/round.ts";
import { passedOn } from "../tools/runs/launch.ts";
import { answersOf, rehearse, scriptedSeats, sidesOf } from "../tools/runs/rehearse.ts";
import { SEED_FILE } from "../tools/runs/pulse.ts";
import { replayed } from "../tools/runs/replay.ts";
import { keptLines, seedCampaign } from "../tools/runs/seed.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-rehearse-")));
const AT = "2026-10-08T00:00:00.000Z";
const line = (kind: string, data: JsonObject) => JSON.stringify({ at: AT, kind, data });
const LINES = [
  line("task.proposed", { version: "v1" }),
  line("build.started", { session: "b-1" }),
  line("build.finished", { session: "b-1", ended: "finished" }),
  line("exam.started", { session: "x-1" }),
  line("build.started", { session: "b-2" }),
];

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A campaign's folder holding `lines` as its log, a staged check and one kept state. */
function campaignAt(name: string, lines: readonly string[], tail = ""): string {
  const folder = join(root, name);
  mkdirSync(join(folder, "checks"), { recursive: true });
  mkdirSync(join(folder, "states", "abc", "agent"), { recursive: true });
  writeFileSync(join(folder, "log.jsonl"), `${lines.map((each) => `${each}\n`).join("")}${tail}`);
  writeFileSync(join(folder, "checks", "brief.json"), "{}");
  writeFileSync(join(folder, "states", "abc", "agent", "BUILT_AGENTS.md"), "guide\n");
  writeFileSync(join(folder, "launch-b-1.json"), "{}");
  return folder;
}

describe("a seed's cut", () => {
  it("keeps what came before a session started, a count of events, or the whole log", () => {
    expect(keptLines(LINES, {})).toBe(5);
    expect(keptLines(LINES, { before: "b-1" })).toBe(1);
    expect(keptLines(LINES, { before: "x-1" })).toBe(3);
    expect(keptLines(LINES, { before: "b-2" })).toBe(4);
    expect(keptLines(LINES, { events: "2" })).toBe(2);
    expect(keptLines(LINES, { events: "0" })).toBe(0);
  });

  it("refuses a session the log does not hold, a count past its end, and both at once", () => {
    expect(() => keptLines(LINES, { before: "b-9" })).toThrow("holds no session b-9");
    expect(() => keptLines(LINES, { events: "6" })).toThrow("the log holds 5 events");
    expect(() => keptLines(LINES, { events: "two" })).toThrow("--events two");
    expect(() => keptLines(LINES, { before: "b-1", events: "1" })).toThrow("not both");
  });
});

describe("a seed", () => {
  it("copies the log cut, the checks and the states, and says where it came from", () => {
    // The source is still being written: its last line is torn, and is no event yet.
    const from = campaignAt("source", LINES, '{"at":"2026');
    const to = join(root, "seeded");
    const made = seedCampaign(from, to, { before: "x-1" });
    expect(made).toMatchObject({ from, events: 3, of: 5, before: "x-1", waiting: [] });
    expect(read(join(to, "log.jsonl")).map(({ kind }) => kind)).toEqual([
      "task.proposed",
      "build.started",
      "build.finished",
    ]);
    expect(readFileSync(join(to, "states", "abc", "agent", "BUILT_AGENTS.md"), "utf8")).toBe("guide\n");
    expect(existsSync(join(to, "checks", "brief.json"))).toBe(true);
    expect(parseJsonAs<object>(readFileSync(join(to, SEED_FILE), "utf8"))).toEqual({
      from,
      events: 3,
      of: 5,
      before: "x-1",
    });
    // The launch receipts are the source run's, and the source's log is as it was.
    expect(existsSync(join(to, "launch-b-1.json"))).toBe(false);
    expect(readFileSync(join(from, "log.jsonl"), "utf8").endsWith('{"at":"2026')).toBe(true);
  });

  it("refuses a name that is taken and a folder with no log, and leaves nothing of a copy that does not read", () => {
    const from = campaignAt("source-2", LINES);
    expect(() => seedCampaign(from, from, {})).toThrow("is there already");
    expect(() => seedCampaign(join(root, "nowhere"), join(root, "seed-2"), {})).toThrow("holds no log.jsonl");
    expect(() => seedCampaign(from, join(root, "seed-3"), { before: "b-9" })).toThrow("holds no session");
    expect(existsSync(join(root, "seed-3"))).toBe(false);
    // An event kind this tree does not know is refused when the seed is made, not mid-round.
    const strange = campaignAt("source-3", [...LINES, line("round.imagined", {})]);
    expect(() => seedCampaign(strange, join(root, "seed-4"), {})).toThrow("is not a log event");
    expect(existsSync(join(root, "seed-4"))).toBe(false);
  });
});

describe("a replay", () => {
  it("says what this tree's readers make of a log, and refuses one they do not read", () => {
    const at = (name: string, lines: readonly string[]) => join(campaignAt(name, lines), "log.jsonl");
    const gates = [1, 2, 3, 4].map((gate) =>
      line("task.gate", { version: "v1", gate, outcome: "passed", controls: "d" }),
    );
    expect(replayed(at("replayed", [LINES[0] ?? "", ...gates, ...LINES.slice(1, 3)]))).toBe(
      "7 events · 0 conditions · 0 anchor, 0 released, 1 held, 0 admitted · 0 written and feasible, 0 waiting for controls · 0 reported · 2 lanes with something to read",
    );
    expect(() => replayed(at("strange", [line("round.imagined", {})]))).toThrow("is not a log event");
    // A gate for a task the log never proposed is a fold's refusal, not a line's.
    expect(() => replayed(at("unfolded", gates))).toThrow("task v1 is not proposed");
  });
});

describe("a rehearsal's script", () => {
  it("reads how a solve ends under the old harness and the new", () => {
    expect(sidesOf("fail:pass")).toEqual({ old: "fail", fresh: "pass" });
    expect(sidesOf("pass:pass")).toEqual({ old: "pass", fresh: "pass" });
    for (const flag of ["pass", "pass:maybe", "pass:fail:pass", ""]) {
      expect(() => sidesOf(flag)).toThrow("as pass:fail");
    }
  });

  it("takes each task's first answer of each ending: a graded pass before the pack's accept control, and a session's own", () => {
    const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at: AT, kind, data });
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 4 }, hidden: null };
    const set = [{ answer: { answer: "0" }, expectedCheckId: "check-product" }];
    const events = [
      event("task.proposed", { version: "v9", taskId: "x-1-001", session: "x-1", task: written }),
      event("verdict", { solve: "s-9", task: "x-1-001", answer: { answer: "24" }, kind: "pass" }),
      event("task.gate", { version: "v9", gate: 2, solve: "s-9", outcome: "passed" }),
      event("task.gate", { version: "v9", gate: 4, outcome: "passed", controls: "d", set }),
    ];
    const graded = [
      { taskId: "t-1", answer: { answer: "graded" }, refusedBy: null },
      { taskId: "t-1", answer: { answer: "stale" }, refusedBy: null },
      { taskId: "t-1", answer: { answer: "wrong" }, refusedBy: "check-product" },
      { taskId: "t-1", answer: { answer: "wrong too" }, refusedBy: "check-sum" },
      { taskId: "t-2", answer: { answer: "only a pass" }, refusedBy: null },
    ];
    const answers = answersOf(graded, events);
    expect(answers.get("t-1")).toEqual({ pass: { answer: "graded" }, fail: { answer: "wrong" } });
    expect(answers.get("t-2")).toEqual({ pass: { answer: "only a pass" } });
    expect(answers.get("x-1-001")).toEqual({ pass: { answer: "24" }, fail: { answer: "0" } });
  });

  it("hands on another command's flags without its own", () => {
    const args = [
      "--held",
      "pass:pass",
      "--name",
      "sim",
      "--anchor=fail:pass",
      "--session",
      "r-1",
      "--referee-decides",
    ];
    const { tokens } = parseArgs({
      args,
      strict: false,
      tokens: true,
      options: { held: { type: "string" }, anchor: { type: "string" } },
    });
    expect(passedOn(args, tokens, new Set(["held", "anchor"]))).toEqual([
      "--name",
      "sim",
      "--session",
      "r-1",
      "--referee-decides",
    ]);
  });
});

describe("a rehearsal's seats", () => {
  const pack = (taskId: string): TaskPackage => ({
    taskId,
    family: "fixture",
    publicInput: { base: 2 },
    hidden: null,
    ruleIds: ["R1"],
    checks: join(root, "no-checks"),
  });
  const [anchored, held] = [pack("t-1"), pack("t-2")];
  const graded = [anchored, held].flatMap(({ taskId }) => [
    { taskId, answer: { answer: `${taskId} right` }, refusedBy: null },
    { taskId, answer: { answer: `${taskId} wrong` }, refusedBy: "check-product" },
  ]);
  const SCRIPT = { held: sidesOf("fail:pass"), anchor: sidesOf("pass:pass") };

  /** A campaign over `folder` whose solves end as `ending`, and each solve's first scripted call. */
  function campaignOver(folder: string, ending: Ending) {
    const log = join(folder, "log.jsonl");
    const calls: unknown[] = [];
    // SAFETY: a rehearsal's seats read a campaign's log, its test solver and `solveOnce`, and no more.
    const campaign = {
      log,
      test: { effort: "medium", side: "test" },
      setting: () => "scripted",
      solveOnce: async (_task: TaskPackage, _harness: Kept, by: Parameters<Campaign["solveOnce"]>[2]) => {
        const context = normalizeContext({ messages: [{ role: "user", content: "Solve.", timestamp: 0 }] });
        const turn = await by.models?.("").streamSimple(by.model, context).result();
        calls.push(turn?.content.find((part) => part.type === "toolCall"));
        return { solve: `s-${String(calls.length)}`, ending };
      },
    } as unknown as Campaign;
    return { campaign, calls, log };
  }

  it("are refused on a campaign that is no seed, whose next round would count their solves", () => {
    const { campaign } = campaignOver(campaignAt("real", []), { outcome: "pass" });
    expect(() =>
      scriptedSeats(SCRIPT, graded, [])(campaign, { builder: undefined, parent: FIXTURE }),
    ).toThrow("is no seed");
  });

  it("are no model's: a flag that names one is refused before anything is opened", async () => {
    const flags = ["--root", root, "--sweep", "s", "--bundle", root, "--name", "n", "--session", "r-1"];
    await expect(rehearse([...flags, "--reviewer", "claude/claude-opus-5"])).rejects.toThrow(
      "a rehearsal seats no model: drop --reviewer",
    );
    await expect(rehearse([...flags, "--builder", "a", "--solver", "b"])).rejects.toThrow(
      "drop --builder, --solver",
    );
  });

  it("script each solve by its task's set and its harness, and name the one that ended otherwise", async () => {
    const folder = campaignAt("rehearsed", []);
    writeFileSync(join(folder, SEED_FILE), "{}\n");
    const { campaign, calls, log } = campaignOver(folder, { outcome: "pass" });
    for (const version of [anchored, held].map(taskVersion)) {
      append(log, "task.proposed", { version });
      for (const gate of [1, 2, 3, 4]) {
        append(log, "task.gate", { version, gate, outcome: "passed", controls: "d" });
      }
    }
    append(log, "anchor.drawn", { tasks: [taskVersion(anchored)], seed: "s", from: 2 });
    const strayed: string[] = [];
    const seats = scriptedSeats(SCRIPT, graded, strayed)(campaign, { builder: undefined, parent: FIXTURE });
    expect(seats.builder.model.id).toBe("script");
    const fresh = { dir: join(root, "fresh"), digest: "f" };
    const old = { dir: FIXTURE, digest: "o" };
    await seats.solve(anchored, old, undefined);
    await seats.solve(held, fresh, undefined);
    expect(strayed).toEqual([]);
    // A held task under the old harness is scripted to fail, and this campaign's solves all pass.
    await seats.solve(held, old, undefined);
    expect(calls).toMatchObject([
      { name: "record_answer", arguments: { answer: "t-1 right" } },
      { name: "record_answer", arguments: { answer: "t-2 right" } },
      { name: "record_answer", arguments: { answer: "t-2 wrong" } },
    ]);
    expect(strayed).toEqual([
      's-3: t-2 under the old harness was scripted to fail and ended {"outcome":"pass"}',
    ]);
    // A task with no answer on record for its scripted ending stops the rehearsal where it is.
    await expect(seats.solve(pack("t-3"), old, undefined)).rejects.toThrow(
      "t-3 has no answer on record that the checks refused",
    );
  });
});

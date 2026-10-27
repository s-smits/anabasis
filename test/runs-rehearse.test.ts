// A seed is a campaign's folder under another name with its log cut where a question starts. A
// rehearsal's script takes each task's answers from what is on record, writes the one its side was
// scripted to into the answer file with what the harness selects, and names a solve that ended
// otherwise. On 18 October 2026 admission joins it: five rehearsals seated no reference,
// although esp32-fresh-opus refused 45 of 50 drafts after promotion.
import { afterAll, describe, expect, it } from "bun:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { type LogEvent, read } from "../src/kernel/log.ts";
import type { TaskPackage } from "../src/kernel/task.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  cpSync,
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
import { decide } from "../src/campaign/decide.ts";
import { starter } from "../tools/d2/campaign.ts";
import type { Campaign } from "../tools/d2/round.ts";
import {
  answersOf,
  passedOn,
  rehearse,
  scriptedExaminer,
  scriptedSeats,
  sidesOf,
} from "../tools/runs/rehearse.ts";
import { seat, sweep } from "./helpers/examiner-seat.ts";
import { SEED_FILE } from "../tools/runs/registry.ts";
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

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  sweep();
});

/** A campaign's folder holding `lines` as its log, a staged check and one kept state. */
function campaignAt(name: string, lines: readonly string[], tail = ""): string {
  const folder = join(root, name);
  mkdirSync(join(folder, "checks"), { recursive: true });
  mkdirSync(join(folder, "states", "abc", "agent"), { recursive: true });
  writeFileSync(join(folder, "log.jsonl"), `${lines.map((each) => `${each}\n`).join("")}${tail}`);
  writeFileSync(join(folder, "checks", "brief.json"), "{}");
  // A drafted exam, as a campaign opened from a prompt stages it (`tools/d2/exam.ts`).
  mkdirSync(join(folder, "exams", "f32e9cd8", "checks"), { recursive: true });
  writeFileSync(join(folder, "exams", "f32e9cd8", "checks", "evaluator.ts"), "export const checks = {};\n");
  writeFileSync(join(folder, "states", "abc", "agent", "BUILT_AGENTS.md"), "guide\n");
  writeFileSync(join(folder, "launch-b-1.json"), "{}");
  // The notes two Builder sessions left, each in the folder the campaign keeps for it.
  for (const session of ["b-1", "b-2"]) {
    mkdirSync(join(folder, "memory", session), { recursive: true });
    writeFileSync(join(folder, "memory", session, "MEMORY.md"), `notes of ${session}\n`);
  }
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
  it("copies the log cut, the checks, a drafted exam and the states, and says where it came from", () => {
    // The source is still being written: its last line is torn, and is no event yet.
    const from = campaignAt("source", LINES, '{"at":"2026');
    const to = join(root, "seeded");
    const made = seedCampaign(from, to, { before: "x-1" });
    expect(made).toMatchObject({ from, events: 3, of: 5, before: "x-1", sets: { held: [], released: [] } });
    expect(read(join(to, "log.jsonl")).map(({ kind }) => kind)).toEqual([
      "task.proposed",
      "build.started",
      "build.finished",
    ]);
    expect(readFileSync(join(to, "states", "abc", "agent", "BUILT_AGENTS.md"), "utf8")).toBe("guide\n");
    expect(existsSync(join(to, "checks", "brief.json"))).toBe(true);
    expect(existsSync(join(to, "exams", "f32e9cd8", "checks", "evaluator.ts"))).toBe(true);
    // The notes of a session the cut log holds come with it. Those of a later session stay: a
    // session run again under that id would find them in the place its own are kept.
    expect(readFileSync(join(to, "memory", "b-1", "MEMORY.md"), "utf8")).toBe("notes of b-1\n");
    expect(existsSync(join(to, "memory", "b-2"))).toBe(false);
    expect(parseJsonAs<object>(readFileSync(join(to, SEED_FILE), "utf8"))).toEqual({
      from,
      events: 3,
      of: 5,
      before: "x-1",
      examinerHome: false,
    });
    // The launch receipts are the source run's, and the source's log is as it was.
    expect(existsSync(join(to, "launch-b-1.json"))).toBe(false);
    expect(readFileSync(join(from, "log.jsonl"), "utf8").endsWith('{"at":"2026')).toBe(true);
  });

  it("carries the Examiner's home only where no session after the cut replaced it", () => {
    const lines = [...LINES.slice(0, 4), line("exam.finished", { session: "x-1" }), LINES[4] ?? ""];
    const from = campaignAt("homed", lines);
    mkdirSync(join(from, "examiner-home"), { recursive: true });
    writeFileSync(join(from, "examiner-home", "notes.md"), "x-1 left this\n");
    const after = seedCampaign(from, join(root, "homed-after"), { before: "b-2" });
    expect(after.examinerHome).toBe(true);
    expect(readFileSync(join(root, "homed-after", "examiner-home", "notes.md"), "utf8")).toBe(
      "x-1 left this\n",
    );
    // Cut before x-1 ended, the home is the one x-1 left, which no session at the cut had.
    for (const [name, cut] of [
      ["homed-before", { before: "x-1" }],
      ["homed-inside", { events: "4" }],
    ] as const) {
      expect(seedCampaign(from, join(root, name), cut).examinerHome).toBe(false);
      expect(existsSync(join(root, name, "examiner-home"))).toBe(false);
    }
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
      "7 events · 0 conditions · 1 held out, 0 released · 0 written by a session · 0 compared · 0 counted by the stop rule",
    );
    // Two comparisons of harnesses no session built: both reported, and the stop rule counts neither.
    const reports = ["g-1", "g-2"].map((session) =>
      line("comparison.reported", { session, reading: "no-step", old: "starter", fresh: "elsewhere" }),
    );
    expect(replayed(at("reported", [...LINES.slice(0, 3), ...reports]))).toMatch(
      / · 2 compared · 0 counted by the stop rule$/,
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
    // A solve that reaches its limits has no answer, which is not valid and needs no ruling.
    expect(sidesOf("none:pass")).toEqual({ old: "none", fresh: "pass" });
    for (const flag of ["pass", "pass:maybe", "pass:fail:pass", ""]) {
      expect(() => sidesOf(flag)).toThrow("each pass, fail or none, as none:pass");
    }
  });

  it("takes each task's first answer of each ending: a graded pass before the pack's accept control, and what the log's solves answered", () => {
    const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at: AT, kind, data });
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 4 }, hidden: null };
    // A task a session wrote is in no pack. Once solves have answered it, their answers script it.
    const events = [
      event("task.proposed", { version: "v9", taskId: "x-1-001", session: "x-1", task: written }),
      event("verdict", { solve: "s-9", task: "x-1-001", answer: { answer: "24" }, kind: "pass" }),
      event("verdict", {
        solve: "s-10",
        task: "x-1-001",
        answer: { answer: "0" },
        kind: "fail",
        blocking: ["check-product"],
      }),
      // An answer outside the format reached no check, and is no answer a check rejected.
      event("verdict", { solve: "s-11", task: "x-1-001", answer: { junk: 1 }, kind: "fail", fault: "f" }),
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
    const args = ["--held", "pass:pass", "--name", "sim", "--starter=fail", "--session", "r-1", "--yes"];
    const { tokens } = parseArgs({
      args,
      strict: false,
      tokens: true,
      options: { held: { type: "string" }, starter: { type: "string" } },
    });
    expect(passedOn(args, tokens, new Set(["held", "starter"]))).toEqual([
      "--name",
      "sim",
      "--session",
      "r-1",
      "--yes",
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
  const [other, held] = [pack("t-1"), pack("t-2")];
  const graded = [other, held].flatMap(({ taskId }) => [
    { taskId, answer: { answer: `${taskId} right` }, refusedBy: null },
    { taskId, answer: { answer: `${taskId} wrong` }, refusedBy: "check-product" },
  ]);
  const SCRIPT = { held: sidesOf("fail:pass"), starter: "fail" } as const;

  /** A campaign over `folder` whose solves end as `ending`, and each solve's first scripted call. */
  function campaignOver(folder: string, ending?: Ending) {
    const log = join(folder, "log.jsonl");
    const calls: unknown[] = [];
    /** The comparison each solve was made for, as the seat handed it on. */
    const named: unknown[] = [];
    // SAFETY: a rehearsal's seats read a campaign's log, its test solver and `solveOnce`, and no more.
    const campaign = {
      log,
      states: join(folder, "kept"),
      test: { effort: "medium", side: "test" },
      limits: { turns: 24 },
      setting: () => "scripted",
      solveOnce: async (...asked: Parameters<Campaign["solveOnce"]>) => {
        const by = asked[2];
        named.push(asked[4]);
        const context = normalizeContext({ messages: [{ role: "user", content: "Solve.", timestamp: 0 }] });
        const turn = await by.models?.("").streamSimple(by.model, context).result();
        calls.push(turn?.content.find((part) => part.type === "toolCall"));
        return {
          solve: `s-${String(calls.length)}`,
          ending:
            ending ??
            (turn?.content.some((part) => part.type === "toolCall" && part.name === "submit") === true
              ? { outcome: "fail", kind: "turns-ended" }
              : { outcome: "pass" }),
        };
      },
    } as unknown as Campaign;
    return { campaign, calls, named, log };
  }

  it("refuses answered drafts at three of three and holds a proved draft the reference does not answer", async () => {
    for (const [old, refused] of [
      ["pass", 2],
      ["none", 0],
    ] as const) {
      const folder = campaignAt(`gate-${old}`, []);
      writeFileSync(join(folder, SEED_FILE), "{}\n");
      const { campaign, named } = campaignOver(folder);
      const strayed: string[] = [];
      const source = { taskId: "source", family: "fixture", publicInput: { base: 2 }, hidden: null };
      const controls = [
        {
          taskId: source.taskId,
          answer: { answer: "12", unit: "N" },
          refusedBy: null,
        },
      ];
      const factory = scriptedSeats({ held: { old, fresh: "none" }, starter: "pass" }, controls, strayed);
      const reference = { dir: FIXTURE, digest: "promoted" };
      const solver = factory(campaign, { builder: undefined, reference: reference.dir });
      const session = seat("write", []);
      const result = await scriptedExaminer(
        [],
        [source],
        2,
        controls,
      )({
        ...session.request,
        log: campaign.log,
        wanted: 2,
        verify: async () => ({ kind: "pass" }),
        probe: async (task, id, kill) => (await solver.solve(task, reference, kill, id)).ending,
      });
      const gates = read(campaign.log).flatMap(({ kind, data }) => (kind === "task.gate" ? [data] : []));
      // try_task returns before its gate does, so the script reaches its finish whether or not the
      // gate held enough, and the session ends finished.
      expect(result).toMatchObject({ puts: 2, ended: "finished" });
      expect(result.refused).toHaveLength(refused);
      expect(result.held).toHaveLength(2 - refused);
      expect(gates.slice(0, refused)).toMatchObject(
        Array.from({ length: refused }, () => ({ outcome: "refused", reference: { valid: 3, solves: 3 } })),
      );
      expect(gates.slice(refused)).toMatchObject(
        Array.from({ length: 2 - refused }, () => ({
          outcome: "passed",
          reference: { valid: 0, solves: 1, ran: 1 },
        })),
      );
      // A proved draft is held at its first failed solve, and the gate stops there (20 October).
      expect(named).toEqual(Array.from({ length: refused === 2 ? 6 : 2 }, () => "x-1"));
      expect(strayed).toEqual([]);
      if (refused === 2) {
        const events: LogEvent[] = [
          { at: AT, kind: "checker.read", data: { contract: "c", checks: "k", faults: [] } },
          { at: AT, kind: "harness.promoted", data: { harness: reference.digest } },
          ...read(campaign.log),
        ];
        expect(
          decide(events, {
            sessions: 1,
            patience: 1,
            unprepared: false,
            practice: null,
            wanted: { target: 2, level: 0.1 },
            pastStop: null,
            prompted: false,
            admits: [],
            left: null,
          }),
        ).toMatchObject({ move: "end", ending: "exam" });
      }
      // The comparison keeps --held's ending after the admission sequence changed it.
      const compared = await solver.solve({ ...held, taskId: "source" }, reference, undefined, "g-1");
      expect(compared.ending.outcome).toBe(old === "pass" ? "pass" : "fail");
      expect(strayed).toEqual([]);
    }
  });

  it("are refused on a campaign that is no seed, whose next round would count their solves", () => {
    const { campaign } = campaignOver(campaignAt("real", []), { outcome: "pass" });
    expect(() =>
      scriptedSeats(SCRIPT, graded, [])(campaign, { builder: undefined, reference: FIXTURE }),
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

  it("take a stored pack by its three flags together, or a drafted exam's seed, and nothing between", async () => {
    // Two of the three flags name no pack; none of them names the seed's own drafted exam, which
    // a campaign of this tree holds in its log and not here.
    await expect(
      rehearse(["--root", root, "--sweep", "s", "--name", "n", "--session", "r-1"]),
    ).rejects.toThrow("usage:");
    await expect(rehearse(["--name", "no-such-campaign", "--session", "r-1"])).rejects.toThrow(
      /no such file|holds no exam of its own/,
    );
  });

  it("script each solve by its harness, and name the one that ended otherwise", async () => {
    const folder = campaignAt("rehearsed", []);
    writeFileSync(join(folder, SEED_FILE), "{}\n");
    const { campaign, calls, named } = campaignOver(folder, { outcome: "pass" });
    const strayed: string[] = [];
    const seats = scriptedSeats(
      SCRIPT,
      graded,
      strayed,
    )(campaign, { builder: undefined, reference: FIXTURE });
    expect(seats.builder?.model.id).toBe("script");
    // The new harness is one a session kept, and selects the shell alone, as the fixture it copies
    // does: its answer is written through the shell. The starter selects pi's `write`.
    const fresh = { dir: join(root, "fresh"), digest: "f" };
    cpSync(FIXTURE, fresh.dir, { recursive: true });
    const old = { dir: FIXTURE, digest: "o" };
    await seats.solve(held, fresh, undefined);
    expect(strayed).toEqual([]);
    // Under the reference harness and under the starter a task is scripted to fail, and this
    // campaign's solves all pass.
    await seats.solve(held, old, undefined);
    await seats.solve(other, await starter(campaign), undefined);
    expect(calls).toMatchObject([
      { name: "bash", arguments: { command: `printf %s '{"answer":"t-2 right"}' > answer.json` } },
      { name: "bash", arguments: { command: `printf %s '{"answer":"t-2 wrong"}' > answer.json` } },
      { name: "write", arguments: { path: "answer.json", content: '{"answer":"t-1 wrong"}' } },
    ]);
    expect(strayed).toEqual([
      's-2: t-2 under the reference harness was scripted to fail and ended {"outcome":"pass"}',
      's-3: t-1 under the starter was scripted to fail and ended {"outcome":"pass"}',
    ]);
    // A task with no answer on record for its scripted ending is given none, and named once at
    // the end: the rehearsal goes on, as the control after a promotion has to over tasks no solve
    // has answered (10 October).
    await seats.solve(pack("t-3"), old, undefined);
    expect(calls.at(-1)).toMatchObject({ name: "submit" });
    expect(strayed.at(-1)).toBe(
      "t-3 has no answer on record that the checks rejected, so the script gave none",
    );
    // Scripted to give no answer, a solve submits with none written, whatever is on record.
    const silent = scriptedSeats({ held: sidesOf("none:pass"), starter: "none" }, graded, strayed);
    await silent(campaign, { builder: undefined, reference: FIXTURE }).solve(pack("t-3"), old, undefined);
    expect(calls.at(-1)).toMatchObject({ name: "submit" });
    expect(strayed.at(-1)).toBe(
      's-5: t-3 under the reference harness was scripted to give no answer and ended {"outcome":"pass"}',
    );
    // Both endings a blocked submit leads to are held, and a rejection is not one of them: a
    // scripted campaign's solve stops where the script runs out, a live one is asked to its turns.
    const ends = strayed.length;
    const ran = async (kind: "no-answer" | "turns-ended" | "rejected") => {
      const quiet = campaignOver(folder, { outcome: "fail", kind });
      await silent(quiet.campaign, { builder: undefined, reference: FIXTURE }).solve(
        pack("t-3"),
        old,
        undefined,
      );
    };
    await ran("no-answer");
    await ran("turns-ended");
    expect(strayed).toHaveLength(ends);
    await ran("rejected");
    expect(strayed.at(-1)).toEndWith('ended {"outcome":"fail","kind":"rejected"}');
    // Where the starter is the reference harness, as it is until a promotion, it is scripted as
    // that side of the comparison, by `--held`'s first word; `--starter` scripts it only as a
    // third harness. And a seat hands on the comparison it solves for.
    const least = await starter(campaign);
    const under = scriptedSeats({ held: sidesOf("fail:pass"), starter: "pass" }, graded, strayed);
    await under(campaign, { builder: undefined, reference: least.dir }).solve(held, least, undefined, "g0");
    expect(calls.at(-1)).toMatchObject({
      name: "write",
      arguments: { path: "answer.json", content: '{"answer":"t-2 wrong"}' },
    });
    expect(strayed.at(-1)).toStartWith("s-6: t-2 under the reference harness was scripted to fail");
    expect(named).toEqual([undefined, undefined, undefined, undefined, undefined, "g0"]);
  });
});

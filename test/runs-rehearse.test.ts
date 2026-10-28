// A seed is a campaign's folder under another name with its log cut where a question starts. A
// rehearsal's script takes each task's answers from what is on record, writes the one its side was
// scripted to into the answer file with what the harness selects, and names a solve that ended
// otherwise. On 18 October 2026 admission joins it: five rehearsals seated no reference,
// although esp32-fresh-opus refused 45 of 50 drafts after promotion.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
import { dirname, join } from "../src/meta/path.ts";
import { decide } from "../src/campaign/decide.ts";
import { starter } from "../tools/d2/campaign.ts";
import type { Campaign } from "../tools/d2/round.ts";
import { answersOf, scriptedExaminer, scriptedSeats, sidesOf } from "../tools/runs/rehearse.ts";
import { seat, sweep } from "./helpers/examiner-seat.ts";
import { SEED_FILE } from "../tools/runs/registry.ts";
import { replayed } from "../tools/runs/replay.ts";
import { seedCampaign } from "../tools/runs/seed.ts";

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

/** A minimal campaign log; seed artefacts are built only by the seed compartment. */
function campaignAt(name: string, lines: readonly string[], tail = ""): string {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "log.jsonl"), `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${tail}`);
  return folder;
}

describe("a seed", () => {
  let from: string;
  beforeAll(() => {
    from = campaignAt("source", LINES, '{"at":"2026');
    for (const [path, content] of [
      ["checks/brief.json", "{}"],
      ["exams/f32e9cd8/checks/evaluator.ts", "export const checks = {};\n"],
      ["states/abc/agent/BUILT_AGENTS.md", "guide\n"],
      ["launch-b-1.json", "{}"],
      ["memory/b-1/MEMORY.md", "notes of b-1\n"],
      ["memory/b-2/MEMORY.md", "notes of b-2\n"],
    ] as const) {
      mkdirSync(dirname(join(from, path)), { recursive: true });
      writeFileSync(join(from, path), content);
    }
  });
  it("copies the log cut, the checks, a drafted exam and the states, and says where it came from", () => {
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
    expect(readFileSync(join(to, "memory", "b-1", "MEMORY.md"), "utf8")).toBe("notes of b-1\n");
    expect(existsSync(join(to, "memory", "b-2"))).toBe(false);
    expect(parseJsonAs<object>(readFileSync(join(to, SEED_FILE), "utf8"))).toEqual({
      from,
      events: 3,
      of: 5,
      before: "x-1",
      examinerHome: false,
    });
    expect(existsSync(join(to, "launch-b-1.json"))).toBe(false);
    expect(readFileSync(join(from, "log.jsonl"), "utf8").endsWith('{"at":"2026')).toBe(true);
  });

  it("carries the Examiner's home only where no session after the cut replaced it", () => {
    const lines = [...LINES.slice(0, 4), line("exam.finished", { session: "x-1" }), LINES[4] ?? ""];
    const homed = campaignAt("homed", lines);
    mkdirSync(join(homed, "examiner-home"), { recursive: true });
    writeFileSync(join(homed, "examiner-home", "notes.md"), "x-1 left this\n");
    const after = seedCampaign(homed, join(root, "homed-after"), { before: "b-2" });
    expect(after.examinerHome).toBe(true);
    expect(readFileSync(join(root, "homed-after", "examiner-home", "notes.md"), "utf8")).toBe(
      "x-1 left this\n",
    );
    for (const [name, cut] of [
      ["homed-before", { before: "x-1" }],
      ["homed-inside", { events: "4" }],
    ] as const) {
      expect(seedCampaign(homed, join(root, name), cut).examinerHome).toBe(false);
      expect(existsSync(join(root, name, "examiner-home"))).toBe(false);
    }
  });

  it("refuses a name that is taken and a folder with no log, and leaves nothing of a copy that does not read", () => {
    expect(() => seedCampaign(from, from, {})).toThrow("is there already");
    expect(() => seedCampaign(join(root, "nowhere"), join(root, "seed-2"), {})).toThrow("holds no log.jsonl");
    expect(() => seedCampaign(from, join(root, "seed-3"), { before: "b-9" })).toThrow("holds no session");
    expect(existsSync(join(root, "seed-3"))).toBe(false);
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
    const summary = replayed(at("replayed", [LINES[0] ?? "", ...gates, ...LINES.slice(1, 3)]));
    for (const fact of [
      "7 events",
      "0 conditions",
      "1 held out",
      "0 released",
      "0 written",
      "0 compared",
      "0 counted",
    ]) {
      expect(summary).toContain(fact);
    }
    const reports = ["g-1", "g-2"].map((session) =>
      line("comparison.reported", { session, reading: "no-step", old: "starter", fresh: "elsewhere" }),
    );
    const compared = replayed(at("reported", [...LINES.slice(0, 3), ...reports]));
    expect(compared).toContain("2 compared");
    expect(compared).toContain("0 counted");
    expect(() => replayed(at("strange", [line("round.imagined", {})]))).toThrow("is not a log event");
    expect(() => replayed(at("unfolded", gates))).toThrow("task v1 is not proposed");
  });
});

describe("a rehearsal's script", () => {
  it("takes each task's first answer of each ending: a graded pass before the pack's accept control, and what the log's solves answered", () => {
    const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at: AT, kind, data });
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 4 }, hidden: null };
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
});

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

describe("a rehearsal's seats", () => {
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
      const compared = await solver.solve({ ...held, taskId: "source" }, reference, undefined, "g-1");
      expect(compared.ending.outcome).toBe(old === "pass" ? "pass" : "fail");
      expect(strayed).toEqual([]);
    }
  });
});

describe("scripted solves", () => {
  it("are refused on a campaign that is no seed, whose next round would count their solves", () => {
    const { campaign } = campaignOver(campaignAt("real", []), { outcome: "pass" });
    expect(() =>
      scriptedSeats(SCRIPT, graded, [])(campaign, { builder: undefined, reference: FIXTURE }),
    ).toThrow("is no seed");
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
    // The fresh harness selects bash; the starter selects write.
    const fresh = { dir: join(root, "fresh"), digest: "f" };
    cpSync(FIXTURE, fresh.dir, { recursive: true });
    const old = { dir: FIXTURE, digest: "o" };
    await seats.solve(held, fresh, undefined);
    expect(strayed).toEqual([]);
    await seats.solve(held, old, undefined);
    await seats.solve(other, await starter(campaign), undefined);
    expect(calls).toMatchObject([
      { name: "bash", arguments: { command: `printf %s '{"answer":"t-2 right"}' > answer.json` } },
      { name: "bash", arguments: { command: `printf %s '{"answer":"t-2 wrong"}' > answer.json` } },
      { name: "write", arguments: { path: "answer.json", content: '{"answer":"t-1 wrong"}' } },
    ]);
    expect(strayed).toHaveLength(2);
    for (const [index, facts] of [
      [0, ["s-2", "t-2", "reference", "fail", '{"outcome":"pass"}']],
      [1, ["s-3", "t-1", "starter", "fail", '{"outcome":"pass"}']],
    ] as const) {
      for (const fact of facts) expect(strayed[index]).toContain(fact);
    }
    await seats.solve(pack("t-3"), old, undefined);
    expect(calls.at(-1)).toMatchObject({ name: "submit" });
    for (const fact of ["t-3", "no answer", "rejected"]) expect(strayed.at(-1)).toContain(fact);
    const silent = scriptedSeats({ held: sidesOf("none:pass"), starter: "none" }, graded, strayed);
    await silent(campaign, { builder: undefined, reference: FIXTURE }).solve(pack("t-3"), old, undefined);
    expect(calls.at(-1)).toMatchObject({ name: "submit" });
    for (const fact of ["s-5", "t-3", "reference", "no answer", '{"outcome":"pass"}']) {
      expect(strayed.at(-1)).toContain(fact);
    }
    const ends = strayed.length;
    for (const kind of ["no-answer", "turns-ended", "rejected"] as const) {
      const quiet = campaignOver(folder, { outcome: "fail", kind });
      await silent(quiet.campaign, { builder: undefined, reference: FIXTURE }).solve(
        pack("t-3"),
        old,
        undefined,
      );
      expect(strayed).toHaveLength(ends + (kind === "rejected" ? 1 : 0));
    }
    expect(strayed).toHaveLength(ends + 1);
    expect(strayed.at(-1)).toContain('{"outcome":"fail","kind":"rejected"}');
    const least = await starter(campaign);
    const under = scriptedSeats({ held: sidesOf("fail:pass"), starter: "pass" }, graded, strayed);
    await under(campaign, { builder: undefined, reference: least.dir }).solve(held, least, undefined, "g0");
    expect(calls.at(-1)).toMatchObject({
      name: "write",
      arguments: { path: "answer.json", content: '{"answer":"t-2 wrong"}' },
    });
    for (const fact of ["s-6", "t-2", "reference", "fail"]) expect(strayed.at(-1)).toContain(fact);
    expect(named).toEqual([undefined, undefined, undefined, undefined, undefined, "g0"]);
  });
});

// One Examiner session on the faux provider. What is under test is the host's side: an instance is
// held out on the shape of its package and on nothing a solver did, what its author is told, what
// the log keeps, and the one outcome the author hears of a task an earlier session wrote.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { heard } from "../src/examiner/record.ts";
import { claimed, type ExamRequest, examine } from "../src/examiner/session.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { writtenTasks } from "../src/kernel/history.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
import type { Task } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isFunction, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const SOLVER = "solver-canary-7f3a";
const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { answer: { type: "string" }, unit: { type: "string" } },
    required: ["answer", "unit"],
  },
  conventions: "SI units.",
  rules: [
    { id: "R1", statement: "The answer is the base times six." },
    { id: "R2", statement: "The unit is the newton." },
  ],
  scope: "Fixture.",
};
const CHECKS = [
  { id: "check-product", assertion: "The answer is six times the base.", families: "all" as const },
  { id: "check-unit", assertion: "The unit is N.", families: "all" as const },
];
const LIMITS = { wallSeconds: 600, turns: 12, proposals: 4, tasks: 24 };
const EXAMPLE: Task = { taskId: "e-1", family: "fixture", publicInput: { base: 2 }, hidden: { seed: 5 } };
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const finish = call("finish", { note: "Stacked two requirements." });
const instance = (base: number | null) => ({
  family: "fixture",
  public_input: base === null ? null : { base },
  hidden: { seed: 1 },
});
const propose = (...bases: (number | null)[]) => call("propose_tasks", { tasks: bases.map(instance) });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A scratch with a check program's two named files and a log. No solver and no verifier: a
 *  session asks for neither. */
function setup(responses: FauxResponseStep[]) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-examiner-")));
  scratches.push(scratch);
  const checks = join(scratch, "checks");
  const log = join(scratch, "log.jsonl");
  mkdirSync(checks);
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(checks, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: [
        { id: "check-product", citedDecisionIds: ["R1"], execution },
        { id: "check-unit", citedDecisionIds: ["R2"], execution },
      ],
    }),
  );
  writeFileSync(join(checks, "evaluator.ts"), "export const checks = {};\n");
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-examiner",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(
    responses.map(
      (step): FauxResponseStep =>
        isFunction(step)
          ? step
          : (context) => {
              sent.push(JSON.stringify(context));
              return step;
            },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const pack = (task: Task): TaskPackage => ({ ...task, ruleIds: ["R1", "R2"], checks });
  const request: ExamRequest = {
    id: "x-1",
    contract: CONTRACT,
    checks: CHECKS,
    examples: [EXAMPLE],
    pack,
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    log,
  };
  const of = (kind: EventKind) =>
    read(log)
      .filter((event) => event.kind === kind)
      .map(({ data }) => data);
  const versionOf = (taskId: string, base: number) =>
    taskVersion(pack({ taskId, family: "fixture", publicInput: { base }, hidden: { seed: 1 } }));
  return { request, log, sent, of, versionOf };
}

describe("an Examiner session", () => {
  it("is given the contract, the checks and the campaign's tasks, and nothing of a solver", async () => {
    const s = setup([call("read_example", { task: "e-1" }), finish]);
    const examined = await examine(s.request);
    expect(examined).toEqual({ held: [], refused: [], ended: "finished" });
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain("check-product (every family): The answer is six times the base.");
    // The pack's task is listed with its outcome, as every task of the campaign is.
    expect(s.sent[0]).toContain("- e-1 (family fixture): not yet compared");
    expect(s.sent[0]).toContain("10 minutes and 12 turns");
    // The budget every solve is held to, as a fact and no target, where the campaign lends it.
    expect(s.sent[0]).not.toContain("Every solve of a task is held to");
    const told = setup([finish]);
    await examine({ ...told.request, budget: { modelTurns: 3, minutes: 8 } });
    expect(told.sent[0]).toContain(
      "Every solve of a task is held to 3 turns of the solver's own, a turn being one reply with the tool calls in it, and 8 minutes. Both harnesses are measured under that budget",
    );
    expect(told.sent[0]).toContain("it is no target of yours");
    // Asked for room, it is told the need and no count, share or zone (10 October): the exam's
    // tasks were answered, and the campaign needs tasks a solver under the budget can fail.
    expect(s.sent[0]).not.toContain("leave no room");
    const room = setup([finish]);
    await examine({ ...room.request, room: true });
    expect(room.sent[0]).toContain(
      "The tasks the exam holds leave no room: the reference harness answered nearly all of them within the budget",
    );
    expect(room.sent[0]).toContain("Harder is yours to judge from the domain");
    // It is told how a task is scored: a valid answer within the budget, with no objective to rank
    // two of them, and neither the size of the budget nor any count.
    expect(s.sent[0]).toContain("the harness that gives more valid answers wins");
    // It is told that a task needs a valid answer, and that it may derive the task from one.
    expect(s.sent[0]).toContain("A task with no valid answer measures nothing");
    expect(s.sent[0]).not.toContain("objective");
    // How many tasks are wanted is not the Examiner's to know: no prompt and no tool text says 24.
    expect((s.sent[0] ?? "").replace(/"timestamp":\d+/g, "")).not.toContain("24");
    // It writes no control and is put to no solver, and its prompt promises neither.
    expect(s.sent[0]).not.toContain("write_controls");
    expect(s.sent[0]).not.toContain("stronger solver");
    expect(s.sent[1]).toContain(String.raw`\"seed\": 5`);
    expect(s.of("exam.started")[0]).toMatchObject({
      session: "x-1",
      checks: ["check-product", "check-unit"],
      examples: ["e-1"],
    });
    expect(s.of("exam.finished")[0]).toMatchObject({
      ended: "finished",
      proposed: 0,
      note: "Stacked two requirements.",
    });
  });

  it("runs the checks on an instance with an answer of its own, where the campaign lends it its verifier, and keeps nothing", async () => {
    const tried = (answer: number) =>
      call("try_answer", { family: "fixture", public_input: { base: 7 }, hidden: null, answer: { answer } });
    // Without a verifier the tool is not given; with one, the checks say which refuse the answer.
    const bare = setup([finish]);
    await examine(bare.request);
    expect(bare.sent[0]).not.toContain('{"name":"try_answer"');
    const s = setup([tried(42), tried(41), finish]);
    const asked: unknown[] = [];
    await examine({
      ...s.request,
      verify: async (task, answer) => {
        asked.push([task.taskId, task.publicInput, answer]);
        return asRecord(answer)?.answer === 42
          ? { kind: "pass" }
          : { kind: "fail", blocking: ["check-product"] };
      },
    });
    expect(s.sent[0]).toContain('{"name":"try_answer"');
    expect(asked).toEqual([
      ["try", { base: 7 }, { answer: 42 }],
      ["try", { base: 7 }, { answer: 41 }],
    ]);
    expect(JSON.stringify(s.of("exam.call")[0])).toContain("Every applicable check passed this answer");
    expect(JSON.stringify(s.of("exam.call")[1])).toContain("Refused by check-product.");
    // A try is no proposal: no task was held out, and no answer entered the log but in the trace.
    expect(s.of("task.proposed")).toEqual([]);
    expect(s.of("exam.finished")[0]).toMatchObject({ proposed: 0 });

    // What a pass keeps is the fact: a proposal with the content the host saw answered is logged
    // feasible, and one whose content moved, by its public input or its hidden values, is not.
    const kept = setup([
      call("try_answer", {
        family: "fixture",
        public_input: { base: 7 },
        hidden: { seed: 1 },
        answer: { answer: 42 },
      }),
      call("try_answer", {
        family: "fixture",
        public_input: { base: 8 },
        hidden: { seed: 1 },
        answer: { answer: 1 },
      }),
      propose(7, 8),
      finish,
    ]);
    await examine({
      ...kept.request,
      verify: async (_task, answer) =>
        asRecord(answer)?.answer === 42 ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] },
    });
    expect(kept.of("task.proposed").map(({ taskId, feasible }) => [taskId, feasible ?? null])).toEqual([
      ["x-1-001", true],
      ["x-1-002", null],
    ]);
    expect(JSON.stringify(kept.of("task.proposed"))).not.toContain('"answer":42');
    // The Examiner is told it has the tool, and the shell, and what neither does to the exam.
    expect(s.sent[0]).toContain("try_answer runs the checks on an instance with an answer of yours");
    expect(s.sent[0]).toContain("bash, read and write are yours in a home of your own");
  });

  it("holds an instance out on the shape of its package, and says why another is refused", async () => {
    const s = setup([propose(7, null, 7), finish]);
    const examined = await examine(s.request);
    const told = s.sent[1] ?? "";
    expect(told).toContain("x-1-001: held out.");
    expect(told).toContain("x-1-002: refused: no inputs");
    expect(told).toContain("An instance proposed before was not taken again.");
    const [held, refused] = [
      s.versionOf("x-1-001", 7),
      taskVersion(
        s.request.pack({ taskId: "x-1-002", family: "fixture", publicInput: null, hidden: { seed: 1 } }),
      ),
    ];
    expect(examined).toEqual({ held: [held], refused: [refused], ended: "finished" });
    // One gate, and the task is a held-out task from then on: no solve, no control, no word.
    expect(s.of("task.gate")).toEqual([
      { version: held, gate: 1, outcome: "passed" },
      { version: refused, gate: 1, outcome: "refused", reason: "no inputs" },
    ]);
    expect(taskSets(read(s.log))).toMatchObject({ held: [held], released: [] });
    expect(taskStates(read(s.log)).get(refused)).toBe("refused");
    expect(s.of("solve.started")).toEqual([]);
    expect(s.of("exam.word")).toEqual([]);
    // The instance is in the log whole, so a later solve of it needs nothing else.
    expect(s.of("task.proposed")[0]).toMatchObject({
      version: held,
      taskId: "x-1-001",
      session: "x-1",
      task: { family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } },
    });
    expect(writtenTasks(read(s.log)).map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-002"]);
    expect(s.of("exam.finished")[0]).toMatchObject({ proposed: 2, held: [held], refused: [refused] });
  });

  it("ends when the host has its tasks though another call shares the turn, and takes no instance after it", async () => {
    const both = fauxAssistantMessage(
      [
        fauxToolCall("propose_tasks", { tasks: [instance(2), instance(3)] }),
        fauxToolCall("propose_tasks", { tasks: [instance(11)] }),
      ],
      toolUse,
    );
    const s = setup([both, propose(13), finish]);
    const examined = await examine({ ...s.request, limits: { ...LIMITS, tasks: 2 } });
    expect(examined.ended).toBe("supplied");
    expect(examined.held).toHaveLength(2);
    // The second call of the turn was answered that the host has what it needs, and no turn followed.
    expect(JSON.stringify(s.of("exam.call").at(-1))).toContain("The host has the tasks it needs");
    expect(s.of("task.proposed")).toHaveLength(2);
    expect(s.of("exam.turn")).toHaveLength(1);
  });

  it("takes no instance past its proposals, nor one an earlier session already wrote", async () => {
    const spent = setup([propose(1, 2, 3), propose(4, 5), propose(6), finish]);
    await examine(spent.request);
    expect(spent.sent[2]).toContain("An instance was not taken: this session can propose no further task.");
    expect(spent.sent[3]).toContain("This session can propose no further task.");
    expect(spent.of("task.proposed")).toHaveLength(4);
    // A second session is a new process, and the same instance under a new id is the same task.
    const again = setup([propose(7), finish, propose(7, 8), finish]);
    await examine(again.request);
    const second = await examine({ ...again.request, id: "x-2" });
    expect(again.sent[3]).toContain("An instance an earlier session wrote was not taken again.");
    expect(second.held).toEqual([again.versionOf("x-2-001", 8)]);
  });

  it("takes one session to an id, and is a crashed session when the provider fails its turn", async () => {
    const limit = "You've hit your session limit";
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: limit });
    const s = setup([propose(7), failed]);
    // The task it held out before the turn failed is a held-out task all the same.
    expect(await examine(s.request)).toMatchObject({ held: [s.versionOf("x-1-001", 7)], ended: "crashed" });
    expect(s.of("exam.finished")[0]).toMatchObject({ ended: "crashed", crash: limit });
    expect(claimed(read(s.log), "x-1")).toBe(
      "session x-1 is in the log already; a session's id names one session",
    );
    expect(claimed(read(s.log), "x-2")).toBeNull();
    await expect(examine(s.request)).rejects.toThrow("session x-1 is in the log already");
    expect(s.of("exam.started")).toHaveLength(1);
  });
});

describe("what an Examiner hears of the tasks its campaign holds", () => {
  const condition = (task: string, harness: string): Condition => ({
    contract: "c1",
    harness,
    task,
    model: "faux/solver",
    effort: "medium",
    prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: {},
    compaction: "off",
    solverTools: harness,
    verifierTools: "t1",
    sandbox: "p1",
    limits: {
      wallSeconds: 600,
      turns: 12,
      shellDefaultSeconds: 30,
      shellMaxSeconds: 60,
      concurrency: 1,
      diskBytes: 1024,
    },
    host: "h",
    side: "test",
  });

  it("is one outcome a task: one harness won, a tie between valid answers, no valid answer yet, or disputed", async () => {
    const s = setup([propose(1, 2, 3, 4, 5), finish, finish]);
    await examine({ ...s.request, limits: { ...LIMITS, proposals: 6 } });
    const [won, tied, unsolved, practice, aside] = [1, 2, 3, 4, 5].map((base) =>
      s.versionOf(`x-1-00${String(base)}`, base),
    );
    // The pack's own task is in the log as `prepare.ts` leaves it: by its id, and held out.
    const packed = taskVersion(s.request.pack(EXAMPLE));
    append(s.log, "task.proposed", { version: packed, taskId: EXAMPLE.taskId });
    append(s.log, "task.gate", { version: packed, gate: 1, outcome: "passed" });
    let solves = 0;
    /** Two solves of a task under a harness, each valid or rejected. */
    const solved = (task: string | undefined, harness: string, valid: readonly boolean[]) => {
      const ran = condition(task ?? "", harness);
      const id = conditionId(ran);
      append(s.log, "condition.recorded", { id, condition: requireJsonValue(ran) });
      for (const pass of valid) {
        solves += 1;
        const solve = `s-${String(solves)}`;
        append(s.log, "solve.started", { solve, condition: id, comparison: "b-1" });
        append(s.log, "verdict", { solve, kind: pass ? "pass" : "fail", answer: { answer: SOLVER } });
        append(s.log, "solve.finished", { solve, ending: { outcome: pass ? "pass" : "fail" } });
      }
    };
    solved(won, "h1", [false, false]);
    solved(won, "h2", [true, true]);
    solved(tied, "h1", [true, true]);
    solved(tied, "h2", [true, true]);
    solved(unsolved, "h1", [false, false]);
    solved(unsolved, "h2", [false, false]);
    solved(packed, "h1", [true, false]);
    solved(packed, "h2", [true, true]);
    append(s.log, "comparison.reported", {
      session: "b-1",
      reading: "no-step",
      old: "h1",
      fresh: "h2",
      solves: 2,
      setting: settingId(condition("any", "any")),
      versions: [won ?? "", tied ?? "", unsolved ?? "", packed],
      aside: [aside ?? ""],
      scored: { wins: 2, losses: 0, ties: 2 },
    });
    append(s.log, "task.state", { version: practice ?? "", state: "released" });
    // Every task the campaign holds, the pack's first: the session is handed them in that order.
    const tasks = [EXAMPLE, ...writtenTasks(read(s.log))];
    // The reference harness is h1, the comparison's old side: the author hears how it did on
    // each task, and nothing of h2.
    expect(heard(read(s.log), tasks)).toEqual([
      "e-1 (family fixture): the reference harness answered it validly in some solves of the last comparison and not in others",
      "x-1-001 (family fixture): the reference harness answered it validly in no solve of the last comparison",
      "x-1-002 (family fixture): the reference harness answered it validly in every solve of the last comparison",
      "x-1-003 (family fixture): the reference harness answered it validly in no solve of the last comparison",
      "x-1-004 (family fixture): in use as practice, and so never scored",
      "x-1-005 (family fixture): disputed: a rejection of an answer to it is not settled",
    ]);

    await examine({ ...s.request, id: "x-2", examples: tasks });
    const opening = s.sent[2] ?? "";
    expect(opening).toContain(
      "The tasks of the exam so far, and what the last comparison that scored each one found",
    );
    expect(opening).toContain(
      "- e-1 (family fixture): the reference harness answered it validly in some solves",
    );
    expect(opening).toContain(
      "- x-1-002 (family fixture): the reference harness answered it validly in every solve",
    );
    // Which harness won, how many solves failed and what a solver answered are not the author's.
    expect(opening).not.toContain("h2");
    expect(opening).not.toContain(SOLVER);
    expect(opening).not.toContain("too easy");
    // Every one of them can be read whole, an earlier session's as the pack's.
    expect(s.of("exam.started")[1]).toMatchObject({
      session: "x-2",
      examples: tasks.map(({ taskId }) => taskId),
    });
  });

  it("says a task is not yet compared, leaves a refused one out, and says when a check was at fault", async () => {
    const s = setup([propose(5, null, 6), finish]);
    await examine(s.request);
    append(s.log, "task.state", { version: s.versionOf("x-1-003", 6), state: "disputed" });
    const tasks = writtenTasks(read(s.log));
    expect(tasks.map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-002", "x-1-003"]);
    expect(heard(read(s.log), tasks)).toEqual([
      "x-1-001 (family fixture): not yet compared",
      "x-1-003 (family fixture): disputed: a check was at fault on an answer to it",
    ]);
    // A task the log does not hold yet, as a pack's is before `prepare.ts`, is not yet compared.
    expect(heard([], [EXAMPLE])).toEqual(["e-1 (family fixture): not yet compared"]);
    expect(heard([], [])).toEqual([]);
  });
});

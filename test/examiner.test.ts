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
import { heard, SAID } from "../src/examiner/record.ts";
import { systemPrompt } from "../src/examiner/prompt.ts";
import {
  claimed,
  type ExamRequest,
  examine,
  examineWalled,
  keepHome,
  lastNote,
  seedHome,
} from "../src/examiner/session.ts";
import { examinerDirs } from "../src/examiner/shell.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { writtenTasks } from "../src/kernel/history.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { billedParts, feasibleTasks } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { ranUnder, solvesIn } from "../src/kernel/solves.ts";
import { type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
import type { Task } from "../src/kernel/verify.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { asRecord, isFunction, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const TRY_ANSWER = "try_answer";
const TASK_PROPOSED = "task.proposed";
const TASK_FEASIBLE = "task.feasible";
const TASK_GATE = "task.gate";
const EXAM_CALL = "exam.call";
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
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const EXAMPLE: Task = { taskId: "e-1", family: "fixture", publicInput: { base: 2 }, hidden: { seed: 5 } };
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const finish = call("finish", { note: "Stacked two requirements." });
// A first finish while the host has not the tasks it needs is declined once, and the session goes
// on; every live session of 9 and 10 October finished after one batch of one to three tasks.
const instance = (base: number | null) => ({
  family: "fixture",
  public_input: base === null ? null : { base },
  hidden: { seed: 1 },
});
const propose = (...bases: (number | null)[]) => call("propose_tasks", { tasks: bases.map(instance) });
/** A solve's condition, as the launcher records one: the task version, the harness and the test side. */
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
    const s = setup([call("read_example", { task: "e-1" }), finish, finish]);
    const examined = await examine(s.request);
    expect(examined).toEqual({ held: [], refused: [], ended: "finished" });
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain("check-product (every family): The answer is six times the base.");
    // The pack's task is listed with its outcome, as every task of the campaign is.
    expect(s.sent[0]).toContain("- e-1 (family fixture): not yet compared");
    expect(s.sent[0]).toContain("10 minutes and 12 turns");
    // The budget every solve is held to, as a fact and no target, where the campaign lends it.
    expect(s.sent[0]).not.toContain("Every solve of a task is held to");
    const told = setup([finish, finish, finish]);
    await examine({ ...told.request, budget: { modelTurns: 3, minutes: 8 } });
    expect(told.sent[0]).toContain(
      "Every solve of a task is held to 3 turns of the solver's own, a turn being one reply with the tool calls in it, and 8 minutes. Both harnesses are measured under that budget",
    );
    expect(told.sent[0]).toContain("it is no target of yours");
    // Every session is asked for the same thing, tasks the reference harness fails, with the
    // need and no count, share or zone (10 October); until 11 October a session was asked it in
    // a mode of its own after a promotion, and the opening carries no such paragraph.
    expect(s.sent[0]).not.toContain("leave no room");
    expect(systemPrompt(undefined)).toContain("What the exam needs from every session is the same");
    expect(systemPrompt(undefined)).toContain("Harder is yours to judge from the domain");
    // It is told how a task is scored: a valid answer within the budget, with no objective to rank
    // two of them, and neither the size of the budget nor any count.
    expect(s.sent[0]).toContain("the harness that gives more valid answers wins");
    // It is told that a task needs a valid answer, and that it may derive the task from one.
    expect(s.sent[0]).toContain("A task with no valid answer measures nothing");
    // The contract declares none, so the opening names none; the system prompt says what one
    // would do.
    expect(s.sent[0]).not.toContain("Objective:");
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
      call(TRY_ANSWER, {
        family: "fixture",
        public_input: { base: 7 },
        hidden: null,
        answer: { answer: String(answer), unit: "N" },
      });
    // Without a verifier the tool is not given; with one, the checks say which refuse the answer.
    const bare = setup([finish, finish, finish]);
    await examine(bare.request);
    expect(bare.sent[0]).not.toContain(`{"name":"${TRY_ANSWER}"`);
    const s = setup([tried(42), tried(41), finish, finish]);
    const asked: unknown[] = [];
    await examine({
      ...s.request,
      verify: async (task, answer) => {
        asked.push([task.taskId, task.publicInput, answer]);
        return asRecord(answer)?.answer === "42"
          ? { kind: "pass" }
          : { kind: "fail", blocking: ["check-product"] };
      },
    });
    expect(s.sent[0]).toContain(`{"name":"${TRY_ANSWER}"`);
    expect(asked).toEqual([
      ["try", { base: 7 }, { answer: "42", unit: "N" }],
      ["try", { base: 7 }, { answer: "41", unit: "N" }],
    ]);
    expect(JSON.stringify(s.of(EXAM_CALL)[0])).toContain("Every applicable check passed this answer");
    expect(JSON.stringify(s.of(EXAM_CALL)[1])).toContain("Refused by check-product.");
    // A try is no proposal: no task was held out, and no answer entered the log but in the trace.
    expect(s.of(TASK_PROPOSED)).toEqual([]);
    expect(s.of("exam.finished")[0]).toMatchObject({ proposed: 0 });

    // What a pass keeps is the fact: a proposal with the content the host saw answered is logged
    // feasible, and one whose content moved, by its public input or its hidden values, is not.
    const kept = setup([
      call(TRY_ANSWER, {
        family: "fixture",
        public_input: { base: 7 },
        hidden: { seed: 1 },
        answer: { answer: "42", unit: "N" },
      }),
      call(TRY_ANSWER, {
        family: "fixture",
        public_input: { base: 8 },
        hidden: { seed: 1 },
        answer: { answer: "1", unit: "N" },
      }),
      // A hidden value sent as JSON text is read as the JSON it encodes, for the checks and for the
      // mark: on 12 October tries sent "null" where their proposals sent null, and no mark was kept.
      call("try_answer", {
        family: "fixture",
        public_input: { base: 9 },
        hidden: '{"seed": 1}',
        answer: { answer: "42", unit: "N" },
      }),
      call("try_answer", {
        family: "fixture",
        public_input: { base: 10 },
        hidden: { seed: 1 },
        answer: { answer: "42", unit: "N" },
      }),
      // And a proposal's the same way, so it keys as the try of its instance did (12 October,
      // the Oracle's reading: a proposal kept the string until then).
      call("propose_tasks", {
        tasks: [...[7, 8, 9].map(instance), { ...instance(10), hidden: '{"seed": 1}' }],
      }),
      finish,
      finish,
    ]);
    const checked: unknown[] = [];
    await examine({
      ...kept.request,
      verify: async (task, answer) => {
        checked.push(task.hidden);
        return asRecord(answer)?.answer === "42"
          ? { kind: "pass" }
          : { kind: "fail", blocking: ["check-product"] };
      },
    });
    // Four tries, and a recheck under its task id of each of the three that passed: every check
    // read the hidden value as the JSON it encodes.
    expect(checked).toEqual(Array.from({ length: 7 }, () => ({ seed: 1 })));
    const proved = [
      kept.versionOf("x-1-001", 7),
      kept.versionOf("x-1-003", 9),
      kept.versionOf("x-1-004", 10),
    ];
    expect(feasibleTasks(read(kept.log))).toEqual(new Set(proved));
    expect(kept.of(TASK_FEASIBLE)).toEqual(proved.map((version) => ({ version, session: "x-1" })));
    expect(JSON.stringify(kept.of(TASK_FEASIBLE))).not.toContain('"answer":"42"');
    // The Examiner is told it has the tool, and the shell, and what neither does to the exam.
    expect(s.sent[0]).toContain("try_answer runs the checks on an instance with an answer of yours");
    expect(s.sent[0]).toContain("bash, read and write are yours in a home of your own");
  });

  it("rechecks an author answer on the final task id before keeping a pre-proposal proof", async () => {
    const s = setup([
      call(TRY_ANSWER, { ...instance(7), answer: { answer: "42", unit: "N" } }),
      propose(7),
      finish,
      finish,
    ]);
    const checked: string[] = [];
    await examine({
      ...s.request,
      verify: async (task) => {
        checked.push(task.taskId);
        return task.taskId === "try" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] };
      },
    });
    expect(checked).toEqual(["try", "x-1-001"]);
    expect(s.of(TASK_PROPOSED)[0]?.feasible).toBeUndefined();
    expect(feasibleTasks(read(s.log))).toEqual(new Set());
    expect(JSON.stringify(s.of(EXAM_CALL))).toContain(
      "Author proof was not retained under this task id: Refused by check-product",
    );
  });

  it("reports a faulty or unavailable final-id recheck without treating it as an answer failure", async () => {
    for (const verdict of [
      { kind: "faulty", check: "check-product", reason: "engine unavailable" },
      { kind: "non-result", reason: "engine unavailable" },
    ] as const) {
      const s = setup([
        call(TRY_ANSWER, { ...instance(7), answer: { answer: "42", unit: "N" } }),
        propose(7),
        finish,
        finish,
      ]);
      await examine({
        ...s.request,
        verify: async (task) => (task.taskId === "try" ? { kind: "pass" } : verdict),
      });
      expect(s.of(TASK_PROPOSED)[0]?.feasible).toBeUndefined();
      expect(JSON.stringify(s.of(EXAM_CALL))).toContain("Author proof was not retained under this task id");
      expect(JSON.stringify(s.of(EXAM_CALL))).toContain("engine unavailable");
      expect(s.of("exam.finished")[0]?.ended).toBe("finished");
    }
  });

  it("keeps a valid author answer tried after the task was proposed", async () => {
    const s = setup([
      propose(7),
      call(TRY_ANSWER, {
        ...instance(7),
        answer: { answer: "42", unit: "N" },
      }),
      call(TRY_ANSWER, { ...instance(7), answer: { answer: "42", unit: "N" } }),
      finish,
      finish,
    ]);
    await examine({ ...s.request, verify: async () => ({ kind: "pass" }) });
    const version = s.versionOf("x-1-001", 7);
    expect(feasibleTasks(read(s.log)).has(version)).toBe(true);
    expect(s.of(TASK_FEASIBLE)).toEqual([{ version, session: "x-1" }]);
    expect(heard(read(s.log), writtenTasks(read(s.log))).lines).toEqual([
      "x-1-001 (family fixture): not yet compared; a valid answer to it is on record",
    ]);
  });

  it("records the proposal and passed gate before a recheck that throws", async () => {
    const s = setup([
      call(TRY_ANSWER, { ...instance(7), answer: { answer: "42", unit: "N" } }),
      propose(7),
      finish,
      finish,
    ]);
    await examine({
      ...s.request,
      verify: (task) => {
        if (task.taskId === "try") return Promise.resolve({ kind: "pass" });
        expect(taskSets(read(s.log)).held).toEqual([s.versionOf(task.taskId, 7)]);
        throw new Error("engine interrupted");
      },
    });
    expect(s.of(TASK_PROPOSED)).toHaveLength(1);
    expect(s.of(TASK_FEASIBLE)).toEqual([]);
    expect(JSON.stringify(s.of(EXAM_CALL))).toContain("The checks could not run: engine interrupted");
    expect(s.of("exam.finished")[0]?.ended).toBe("finished");
  });

  it("does not recheck or prove a proposal whose package gate refuses it", async () => {
    const s = setup([
      call(TRY_ANSWER, { ...instance(null), answer: { answer: "42", unit: "N" } }),
      propose(null),
      finish,
      finish,
    ]);
    const checked: string[] = [];
    await examine({
      ...s.request,
      verify: async (task) => {
        checked.push(task.taskId);
        return { kind: "pass" };
      },
    });
    expect(checked).toEqual(["try"]);
    expect(s.of(TASK_PROPOSED)).toHaveLength(1);
    expect(s.of(TASK_GATE)[0]?.outcome).toBe("refused");
    expect(s.of(TASK_FEASIBLE)).toEqual([]);
    expect(taskSets(read(s.log)).held).toEqual([]);
  });

  it("requires a passed package gate for a late proof and retains proofs for released or disputed tasks", async () => {
    for (const state of ["ungated", "released", "disputed"] as const) {
      const s = setup([
        call(TRY_ANSWER, {
          family: EXAMPLE.family,
          public_input: EXAMPLE.publicInput,
          hidden: EXAMPLE.hidden,
          answer: { answer: "12", unit: "N" },
        }),
        finish,
        finish,
      ]);
      const version = taskVersion(s.request.pack(EXAMPLE));
      append(s.log, TASK_PROPOSED, { version, taskId: EXAMPLE.taskId });
      if (state !== "ungated") {
        append(s.log, TASK_GATE, { version, gate: 1, outcome: "passed" });
        append(s.log, "task.state", { version, state });
      }
      await examine({ ...s.request, verify: async () => ({ kind: "pass" }) });
      expect(s.of(TASK_FEASIBLE)).toEqual(state === "ungated" ? [] : [{ version, session: "x-1" }]);
    }
  });

  it("records no author proof for a task the operator refused", async () => {
    const s = setup([
      call(TRY_ANSWER, {
        family: EXAMPLE.family,
        public_input: EXAMPLE.publicInput,
        hidden: EXAMPLE.hidden,
        answer: { answer: "12", unit: "N" },
      }),
      finish,
      finish,
    ]);
    const version = taskVersion(s.request.pack(EXAMPLE));
    append(s.log, TASK_PROPOSED, { version, taskId: EXAMPLE.taskId });
    append(s.log, TASK_GATE, { version, gate: 1, outcome: "passed" });
    append(s.log, "task.state", { version, state: "refused" });
    await examine({ ...s.request, verify: async () => ({ kind: "pass" }) });
    expect(s.of(TASK_FEASIBLE)).toEqual([]);
  });

  it("keeps a late proof for an earlier pack task, and none for different content or a refused answer", async () => {
    const s = setup([
      call(TRY_ANSWER, {
        family: EXAMPLE.family,
        public_input: EXAMPLE.publicInput,
        hidden: EXAMPLE.hidden,
        answer: { answer: "12", unit: "N" },
      }),
      propose(7),
      call(TRY_ANSWER, { ...instance(7), answer: { answer: "1", unit: "N" } }),
      call(TRY_ANSWER, { ...instance(7), hidden: { seed: 2 }, answer: { answer: "42", unit: "N" } }),
      finish,
      finish,
    ]);
    const version = taskVersion(s.request.pack(EXAMPLE));
    append(s.log, TASK_PROPOSED, { version, taskId: EXAMPLE.taskId });
    append(s.log, TASK_GATE, { version, gate: 1, outcome: "passed" });
    await examine({
      ...s.request,
      verify: async (_task, answer) =>
        asRecord(answer)?.answer === "1" ? { kind: "fail", blocking: ["check-product"] } : { kind: "pass" },
    });
    expect(s.of(TASK_FEASIBLE)).toEqual([{ version, session: "x-1" }]);
    expect(feasibleTasks(read(s.log))).toEqual(new Set([version]));
    expect(heard(read(s.log), s.request.examples).lines[0]).toContain("a valid answer to it is on record");
  });

  it("does not log a proof for an unprepared example or one rejected under its own task id", async () => {
    const tried = call(TRY_ANSWER, {
      family: EXAMPLE.family,
      public_input: EXAMPLE.publicInput,
      hidden: EXAMPLE.hidden,
      answer: { answer: "12", unit: "N" },
    });
    const bare = setup([tried, finish, finish]);
    await examine({ ...bare.request, verify: async () => ({ kind: "pass" }) });
    expect(bare.of(TASK_FEASIBLE)).toEqual([]);
    expect(bare.of("exam.finished")[0]?.ended).toBe("finished");

    const prepared = setup([tried, finish, finish]);
    const version = taskVersion(prepared.request.pack(EXAMPLE));
    append(prepared.log, TASK_PROPOSED, { version, taskId: EXAMPLE.taskId });
    append(prepared.log, TASK_GATE, { version, gate: 1, outcome: "passed" });
    const checked: string[] = [];
    await examine({
      ...prepared.request,
      verify: async (task) => {
        checked.push(task.taskId);
        return task.taskId === "try" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] };
      },
    });
    expect(checked).toEqual([EXAMPLE.taskId]);
    expect(prepared.of(TASK_FEASIBLE)).toEqual([]);
    expect(feasibleTasks(read(prepared.log))).toEqual(new Set());
  });

  it("holds a tried answer to the format before the checks, and keeps no instance feasible on one the format refuses", async () => {
    // Checks that pass every answer, and an answer the format refuses: a number, and no unit.
    const s = setup([
      call(TRY_ANSWER, {
        family: "fixture",
        public_input: { base: 7 },
        hidden: { seed: 1 },
        answer: { answer: 42 },
      }),
      propose(7),
      finish,
      finish,
    ]);
    const asked: unknown[] = [];
    await examine({
      ...s.request,
      verify: async (task, answer) => {
        asked.push([task.taskId, answer]);
        return { kind: "pass" };
      },
    });
    expect(asked).toEqual([]);
    const told = JSON.stringify(s.of(EXAM_CALL)[0]);
    expect(told).toContain("This answer does not follow the answer format");
    expect(told).toContain("no check was run");
    expect(told).not.toContain("Every applicable check passed this answer");
    expect(s.of(TASK_PROPOSED).map(({ taskId }) => taskId)).toEqual(["x-1-001"]);
    expect(s.of(TASK_FEASIBLE)).toEqual([]);
  });

  it("refuses a task that carries a planted answer whole, in its public input or hidden values, and holds one that does not", async () => {
    // A planted answer passes try_answer; the first instance proposed hides it, the second shows
    // it inside the public input, and the third holds none of it. A second answer that passes on
    // the same instance leaves the first planted: every answer that passed is one, not the last.
    const planted = { answer: "12", unit: "N" };
    const tried = (answer: JsonObject) =>
      call("try_answer", { family: "fixture", public_input: { base: 2 }, hidden: { seed: 1 }, answer });
    const s = setup([
      tried(planted),
      tried({ answer: "12.0", unit: "N" }),
      call("propose_tasks", {
        tasks: [
          { family: "fixture", public_input: { base: 2 }, hidden: { seed: 1, witness: planted } },
          { family: "fixture", public_input: { base: 3, given: [planted] }, hidden: { seed: 1 } },
          instance(2),
        ],
      }),
      finish,
      finish,
    ]);
    const examined = await examine({ ...s.request, verify: async () => ({ kind: "pass" }) });
    const refused = "refused: it carries, whole, an answer that passed try_answer in this session";
    const result = s.of(EXAM_CALL)[2]?.text;
    const told = isString(result) ? result.split("\n") : [];
    expect(told.map((line) => line.slice(0, 9 + refused.length))).toEqual([
      `x-1-001: ${refused}`,
      `x-1-002: ${refused}`,
      "x-1-003: held out.",
    ]);
    expect(examined.held).toEqual([s.versionOf("x-1-003", 2)]);
    // The prompt names the lever, plant-and-grow, where the planted answer goes, and that size
    // alone is no growth.
    for (const said of [
      "several of the domain's requirements sharing one limit",
      "grow a planted task",
      "The planted answer is for try_answer alone",
      "Growing a task by size alone grows nothing",
    ]) {
      expect(systemPrompt(undefined)).toContain(said);
    }
  });

  it("holds an instance out on the shape of its package, and says why another is refused", async () => {
    const s = setup([propose(7, null, 7), finish, finish]);
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
    expect(s.of(TASK_GATE)).toEqual([
      { version: held, gate: 1, outcome: "passed" },
      { version: refused, gate: 1, outcome: "refused", reason: "no inputs" },
    ]);
    expect(taskSets(read(s.log))).toMatchObject({ held: [held], released: [] });
    expect(taskStates(read(s.log)).get(refused)).toBe("refused");
    expect(s.of("solve.started")).toEqual([]);
    expect(s.of("exam.word")).toEqual([]);
    // The instance is in the log whole, so a later solve of it needs nothing else.
    expect(s.of(TASK_PROPOSED)[0]).toMatchObject({
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
    const s = setup([both, propose(13), finish, finish]);
    const examined = await examine({ ...s.request, limits: { ...LIMITS, tasks: 2 } });
    expect(examined.ended).toBe("supplied");
    expect(examined.held).toHaveLength(2);
    // The second call of the turn was answered that the host has what it needs, and no turn followed.
    expect(JSON.stringify(s.of(EXAM_CALL).at(-1))).toContain("The host has the tasks it needs");
    expect(s.of(TASK_PROPOSED)).toHaveLength(2);
    expect(s.of("exam.turn")).toHaveLength(1);
  });

  it("declines a first finish once while the host has not the tasks it needs, and ends at the second", async () => {
    // Every live session of 9 and 10 October proposed one batch of one to three tasks in three
    // turns and finished, of twelve tasks and two hundred turns it had.
    const s = setup([propose(1), finish, propose(2), finish]);
    const examined = await examine(s.request);
    expect(examined.ended).toBe("finished");
    expect(examined.held).toHaveLength(2);
    expect(JSON.stringify(s.of(EXAM_CALL)[1])).toContain("the host does not yet have the tasks it needs");
    expect(s.of("exam.turn")).toHaveLength(4);
    // A session that held out what the host asks for ends at its first finish.
    const enough = setup([propose(3, 4), finish]);
    expect((await examine({ ...enough.request, limits: { ...LIMITS, tasks: 2 } })).ended).toBe("supplied");
  });

  it("takes no instance past its proposals, nor one an earlier session already wrote", async () => {
    const spent = setup([propose(1, 2, 3), propose(4, 5), propose(6), finish, finish]);
    await examine(spent.request);
    expect(spent.sent[2]).toContain("An instance was not taken: this session can propose no further task.");
    expect(spent.sent[3]).toContain("This session can propose no further task.");
    expect(spent.of(TASK_PROPOSED)).toHaveLength(4);
    // A second session is a new process, and the same instance under a new id is the same task.
    const again = setup([propose(7), finish, finish, propose(7, 8), finish, finish]);
    await examine(again.request);
    const second = await examine({ ...again.request, id: "x-2" });
    expect(again.sent[4]).toContain("An instance an earlier session wrote was not taken again.");
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

describe("try_task", () => {
  it("holds a task out at some valid solves of the reference harness and not all, tells the Examiner the counts alone, and leaves its solves to no comparison", async () => {
    // Each base's three solves by the reference harness, seeded: valid in one, two, none and all of
    // them, and one that ends in no reading. A solver's flag that the task is malformed is a solve
    // that answered nothing validly, as in every tally.
    const seeded = new Map<number, readonly Ending[]>([
      [2, [PASS, REJECTED, REJECTED]],
      [3, [PASS, PASS, REJECTED]],
      [4, [REJECTED, REJECTED, REJECTED]],
      [5, [PASS, PASS, PASS]],
      [
        6,
        [
          PASS,
          { outcome: "flagged", reason: "the base is given twice" },
          { outcome: "non-result", kind: "provider", reason: "overloaded" },
        ],
      ],
    ]);
    const s = setup([call("try_task", { tasks: [2, 3, 4, 5, 6].map(instance) }), finish, finish]);
    const asked: string[] = [];
    // The launcher's record of each solve, as a comparison's solve writes it, with the answer the
    // Examiner must never be shown, and its price.
    const probe = async (task: TaskPackage, session: string) => {
      const base = Number(asRecord(task.publicInput)?.base);
      const ending = seeded.get(base)?.[asked.filter((each) => each === `${session} ${String(base)}`).length];
      asked.push(`${session} ${String(base)}`);
      if (ending === undefined) throw new Error(`no fourth solve of base ${String(base)} is seeded`);
      const solve = `s-${String(asked.length)}`;
      const ran = condition(taskVersion(task), "h-reference");
      append(s.log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      append(s.log, "solve.started", { solve, condition: conditionId(ran), comparison: session });
      append(s.log, "verdict", { solve, answer: { answer: SOLVER, unit: "N" } });
      append(s.log, "solve.finished", { solve, ending, billed: 0.5 });
      return ending;
    };
    const examined = await examine({ ...s.request, limits: { ...LIMITS, proposals: 5 }, probe });
    const versions = [2, 3, 4, 5, 6].map((base, nth) => s.versionOf(`x-1-00${String(nth + 1)}`, base));
    expect(examined).toEqual({ held: versions.slice(0, 2), refused: versions.slice(2), ended: "finished" });
    expect(taskSets(read(s.log)).held).toEqual(versions.slice(0, 2));
    const counted = (valid: number) =>
      `the reference harness answered it validly in ${String(valid)} of 3 solves`;
    expect(s.of(EXAM_CALL)[0]?.text).toBe(
      [
        `x-1-001: held out; ${counted(1)}.`,
        `x-1-002: held out; ${counted(2)}.`,
        `x-1-003: refused: ${counted(0)}, and a task is held out only where it answers some and not all`,
        `x-1-004: refused: ${counted(3)}, and a task is held out only where it answers some and not all`,
        "x-1-005: refused: 1 of the reference harness's 3 solves of it ended in no reading, so it is not measured",
      ].join("\n"),
    );
    // Its cost a task, on the gate's event; the solves are the session's, named by it, and no
    // comparison's: a comparison counts the solves whose start names it (`pairsOf`).
    expect(s.of(TASK_GATE).map(({ reference }) => reference)).toEqual(
      [1, 2, 0, 3, 1].map((valid, nth) => ({ valid, solves: nth === 4 ? 2 : 3, billed: 1.5 })),
    );
    expect(asked).toHaveLength(15);
    expect(solvesIn(read(s.log)).map(({ start }) => start.comparison)).toEqual(Array(15).fill("x-1"));
    expect(billedParts(read(s.log), "x-1")).toEqual({ session: 0, comparison: 7.5 });
    // Each is on record with its condition, as the launcher writes one, and none is part of a
    // task's answers or a tally; a valid one is a witness, so its task is feasible and nothing more.
    expect(ranUnder(read(s.log))).toEqual([]);
    expect(feasibleTasks(read(s.log))).toEqual(new Set(versions.filter((_version, nth) => nth !== 2)));
    expect(heard(read(s.log), writtenTasks(read(s.log))).lines[0]).toBe(
      "x-1-001 (family fixture): not yet compared; a valid answer to it is on record",
    );
    expect(s.of("exam.started")).toMatchObject([{ tried: 3 }]);
    expect(s.sent[0]).toContain("try_task takes instances");
    expect(s.sent[0]).not.toContain("propose_tasks");
    expect(s.sent.join("\n")).not.toContain(SOLVER);
  });
  it("ends at the session's wall with no solve of the reference harness left running", async () => {
    const s = setup([call("try_task", { tasks: [instance(2)] }), finish, finish]);
    const running = new Set<string>();
    // Each solve would pass long after the wall, unless the kill a comparison's solves take
    // stops it first; the launcher records its end either way.
    const probe = (task: TaskPackage, session: string, kill: AbortSignal) =>
      new Promise<Ending>((settle) => {
        const solve = `w-${String(s.of("solve.started").length + 1)}`;
        running.add(solve);
        append(s.log, "solve.started", { solve, task: task.taskId, comparison: session });
        const end = (ending: Ending) => {
          if (!running.delete(solve)) return;
          clearTimeout(late);
          append(s.log, "solve.finished", { solve, ending });
          settle(ending);
        };
        const late = setTimeout(() => end(PASS), 5_000);
        kill.addEventListener("abort", () => end({ outcome: "non-result", kind: "killed", reason: "wall" }));
      });
    const started = performance.now();
    const examined = await examine({ ...s.request, limits: { ...LIMITS, wallSeconds: 0.5 }, probe });
    expect(examined.ended).toBe("wall");
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(running.size).toBe(0);
    expect(s.of("solve.finished").map(({ ending }) => asRecord(ending)?.kind)).toEqual([
      "killed",
      "killed",
      "killed",
    ]);
    expect(s.of(TASK_GATE)).toMatchObject([{ outcome: "refused", reference: { valid: 0, solves: 0 } }]);
  });
});

describe("an Examiner's walled shell, with the engines its campaign's checks run", () => {
  /** The repository this suite runs in, which the wall closes to the Examiner's commands. */
  const repo = resolve(import.meta.dir, "..");

  it("runs the engine a check names, from where it lies, and no other program of its tree", async () => {
    const bash = (command: string) => call("bash", { command });
    let pack = "";
    const s = setup([
      bash("fixeng"),
      bash("command -v solver-x || echo absent"),
      // The tree the engine runs from is open again for reading, and the pack around it is not.
      () => bash(`cat ${join(pack, "hidden.json")} 2>/dev/null || echo refused`),
      bash(`(echo x > "$(command -v fixeng)") 2>/dev/null && echo written || echo refused`),
      finish,
      finish,
    ]);
    // A stored pack the wall closes: a check program that names one engine, a tool tree that holds
    // it, its data beside it and a solver a v1 Builder left there, and the pack's hidden values.
    pack = join(dirname(s.log), "pack");
    const tools = join(pack, ".toolchain");
    mkdirSync(join(pack, "checks"), { recursive: true });
    // The fixture's check program, with its first check naming the engine it runs.
    const brief = JSON.parse(readFileSync(join(dirname(s.log), "checks", "brief.json"), "utf8"));
    brief.truthChecks[0].execution.requiredToolIds = ["fixeng"];
    writeFileSync(join(pack, "checks", "brief.json"), JSON.stringify(brief));
    mkdirSync(join(tools, "bin"), { recursive: true });
    mkdirSync(join(tools, "share"), { recursive: true });
    writeFileSync(join(tools, "share", "fixeng.dat"), "engine data\n");
    // The engine finds its data beside where it was started from, as buffer's `phreeqc` does.
    writeFileSync(join(tools, "bin", "fixeng"), '#!/bin/sh\ncat "$(dirname "$0")/../share/fixeng.dat"\n', {
      mode: 0o755,
    });
    writeFileSync(join(tools, "bin", "solver-x"), "#!/bin/sh\necho solved\n", { mode: 0o755 });
    writeFileSync(join(pack, "hidden.json"), `{"secret": "${SOLVER}"}\n`);
    await examineWalled({
      ...s.request,
      repoRoot: repo,
      packRoots: [pack],
      diskBytes: 64 * 1024 ** 2,
      engines: { checks: join(pack, "checks"), tools },
    });
    // The engine ran by name and read its own data; the solver beside it is on no path; the
    // pack's other files stay closed; and the program that starts the engine is the host's.
    expect(s.of(EXAM_CALL).map(({ tool, text }) => [tool, text])).toEqual([
      ["bash", "engine data"],
      ["bash", "absent"],
      ["bash", "refused"],
      ["bash", "refused"],
      [
        "finish",
        "Noted, and the session goes on: the host does not yet have the tasks it needs from it. Propose further tasks, varying what they ask, and call finish again when you have none left worth proposing.",
      ],
      ["finish", "Finished."],
    ]);
    // The session's start names the engine by its digest, as the host pinned it.
    expect(s.of("exam.started")[0]).toMatchObject({
      engines: [{ name: "fixeng", sha256: sha256OfFile(join(tools, "bin", "fixeng")) }],
    });
    // It is told the engine by name, and that try_answer alone runs the checks.
    expect(s.sent[0]).toContain(
      "The engines the exam's checks run are installed, and run by name: fixeng. They compute; try_answer alone runs the checks on an answer.",
    );
    expect(s.sent[0]).not.toContain("solver-x");
    expect(existsSync(examinerDirs(s.log, "x-1").host)).toBe(false);
  });

  it("keeps the home of a session that ended, and not of one whose turn the provider failed", async () => {
    const bash = (command: string) => call("bash", { command });
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const s = setup([bash("echo half > half.txt"), failed, bash("echo whole > whole.txt"), finish, finish]);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    writeFileSync(join(keep, "kept.txt"), "kept\n");
    const walled = { ...s.request, repoRoot: repo, packRoots: [], diskBytes: 64 * 1024 ** 2, keep };
    expect((await examineWalled(walled)).ended).toBe("crashed");
    expect(readdirSync(keep)).toEqual(["kept.txt"]);
    expect((await examineWalled({ ...walled, id: "x-2" })).ended).toBe("finished");
    expect(readdirSync(keep).sort()).toEqual(["kept.txt", "whole.txt"]);
  });
});

describe("what an Examiner hears of the tasks its campaign holds", () => {
  it("is one outcome a task: one harness won, a tie between valid answers, no valid answer yet, or disputed", async () => {
    const s = setup([propose(1, 2, 3, 4, 5), finish, finish, finish, finish]);
    await examine({ ...s.request, limits: { ...LIMITS, proposals: 6 } });
    const [won, tied, unsolved, practice, aside] = [1, 2, 3, 4, 5].map((base) =>
      s.versionOf(`x-1-00${String(base)}`, base),
    );
    // The pack's own task is in the log as `prepare.ts` leaves it: by its id, and held out.
    const packed = taskVersion(s.request.pack(EXAMPLE));
    append(s.log, TASK_PROPOSED, { version: packed, taskId: EXAMPLE.taskId });
    append(s.log, TASK_GATE, { version: packed, gate: 1, outcome: "passed" });
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
    // Reports written before 9 October did not name the starter; the first old side still stands.
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
    // Beside the outcome, one fact that names no side: whether a valid answer to the task is on
    // record at all, a solve's under either harness or the author's own try.
    expect(heard(read(s.log), tasks).lines).toEqual([
      "e-1 (family fixture): the reference harness answered it validly in some solves of the last comparison and not in others; a valid answer to it is on record",
      "x-1-001 (family fixture): the reference harness answered it validly in no solve of the last comparison; a valid answer to it is on record",
      "x-1-002 (family fixture): the reference harness answered it validly in every solve of the last comparison; a valid answer to it is on record",
      "x-1-003 (family fixture): the reference harness answered it validly in no solve of the last comparison; no valid answer to it is on record",
      "x-1-004 (family fixture): in use as practice, and so never scored",
      "x-1-005 (family fixture): disputed: a rejection of an answer to it is not settled; no valid answer to it is on record",
    ]);
    // Beside the lines, from the same pass: the five lines read on the reference's side, counted
    // by family. The tie both harnesses answered in every solve (x-1-002) and the one neither
    // answered in any (x-1-003) are counted apart; which side won e-1 and x-1-001 is told in the
    // count alone, and the practice task is in none.
    expect(heard(read(s.log), tasks).counts).toBe(
      [
        "Counted from the same comparisons as the lines above, by family where every family counted holds two tasks or more and otherwise in a total alone: each task whose last comparison had the reference harness on one side, or that a later report set aside, and no other. The other harness is whichever the reference harness was compared with there. These are measurements and no target.",
        "- family fixture, 5 tasks: 2 told apart, won by the other harness 2 and by the reference harness 0; 1 tied with both harnesses valid in every solve; 1 tied with neither valid in any solve, of which 0 with a valid answer on record; 0 tied otherwise; 1 set aside on a rejection not settled.",
        "Each count rests on 2 solves a side of the task's last comparison. The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
      ].join("\n"),
    );

    await examine({ ...s.request, id: "x-2", examples: tasks });
    const opening = s.sent[3] ?? "";
    expect(opening).toContain(
      "The tasks of the exam so far, what the last comparison that scored each one found, and whether a valid answer to it is on record",
    );
    expect(opening).toContain(
      "- e-1 (family fixture): the reference harness answered it validly in some solves",
    );
    expect(opening).toContain(
      "- x-1-002 (family fixture): the reference harness answered it validly in every solve",
    );
    expect(opening).toContain(
      String.raw`- x-1-005 (family fixture): disputed: a rejection of an answer to it is not settled; no valid answer to it is on record\n\nCounted from the same comparisons as the lines above`,
    );
    expect(opening).toContain("- family fixture, 5 tasks: 2 told apart, won by the other harness 2");
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

  it("opens the next session with what the last one said at its finish, and nothing of a session that said nothing", async () => {
    const s = setup([propose(1), finish, finish]);
    await examine(s.request);
    expect(lastNote(read(s.log))).toBe("Stacked two requirements.");
    const next = setup([finish, finish]);
    expect(lastNote(read(next.log))).toBeNull();
    await examine({ ...next.request, log: s.log, id: "x-2" });
    const opening = next.sent[0] ?? "";
    expect(opening).toContain(
      "What the last Examiner session of this campaign said at its finish, in its own words:",
    );
    expect(opening).toContain(String.raw`in its own words:\nStacked two requirements.`);
    // A first session, with no finished one before it, is told nothing of the kind.
    expect(s.sent[0]).not.toContain("said at its finish");
    // The exhausted line says what the fold does: the reference's own solves, and the kept third.
    expect(SAID.exhausted).toContain(
      "the reference harness answered it validly in every solve of two comparisons",
    );
    expect(SAID.exhausted).not.toContain("both harnesses");
  });

  it("carries a session's home whole into the next session's, replacing what was kept before", () => {
    const root = mkdtempSync(join(tmpdir(), "examiner-home-"));
    const [first, keep, second] = [join(root, "first"), join(root, "keep"), join(root, "second")];
    mkdirSync(join(first, "w"), { recursive: true });
    writeFileSync(join(first, "w", "model.py"), "print(1)\n");
    writeFileSync(join(first, "stale.txt"), "old\n");
    // A first session finds nothing kept, and leaves its home whole.
    mkdirSync(second, { recursive: true });
    seedHome(second, keep);
    expect(readdirSync(second)).toEqual([]);
    keepHome(first, keep);
    seedHome(second, keep);
    expect(readFileSync(join(second, "w", "model.py"), "utf8")).toBe("print(1)\n");
    expect(existsSync(join(second, "stale.txt"))).toBe(true);
    // The next carry replaces the kept copy: what a session deleted stays deleted.
    rmSync(join(second, "stale.txt"));
    keepHome(second, keep);
    expect(existsSync(join(keep, "stale.txt"))).toBe(false);
    expect(existsSync(join(keep, "w", "model.py"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("says a task is not yet compared, leaves a refused one out, and says when a check was at fault", async () => {
    const s = setup([propose(5, null, 6), finish, finish]);
    await examine(s.request);
    append(s.log, "task.state", { version: s.versionOf("x-1-003", 6), state: "disputed" });
    const tasks = writtenTasks(read(s.log));
    expect(tasks.map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-002", "x-1-003"]);
    expect(heard(read(s.log), tasks)).toEqual({
      lines: [
        "x-1-001 (family fixture): not yet compared; no valid answer to it is on record",
        "x-1-003 (family fixture): disputed: a check was at fault on an answer to it",
      ],
      // No comparison has scored a task, so there is nothing to count, and the opening says none.
      counts: null,
      turns: null,
    });
    // A task the log does not hold yet, as a pack's is before `prepare.ts`, is not yet compared.
    expect(heard([], [EXAMPLE])).toEqual({
      lines: ["e-1 (family fixture): not yet compared; no valid answer to it is on record"],
      counts: null,
      turns: null,
    });
    expect(heard([], [])).toEqual({ lines: [], counts: null, turns: null });
    expect(s.sent[0]).not.toContain("Counted from the same comparisons");
  });

  it("counts by family with a total the tasks read on the reference's side, and none in practice, refused or last compared between two other harnesses", () => {
    const events: LogEvent[] = [];
    const add = (kind: EventKind, data: JsonObject) =>
      events.push({ at: "2026-10-11T00:00:00.000Z", kind, data });
    let solves = 0;
    // Each solve took the turns given, and 11 where none is given.
    const solved = (
      comparison: string,
      taskId: string,
      harness: string,
      valid: readonly boolean[],
      turns: readonly number[] = [],
    ) => {
      const ran = condition(`v-${taskId}`, harness);
      add("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      for (const [nth, pass] of valid.entries()) {
        solves += 1;
        const solve = `t-${String(solves)}`;
        add("solve.started", { solve, condition: conditionId(ran), comparison });
        add("solve.finished", {
          solve,
          ending: pass ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
          turns: turns[nth] ?? 11,
        });
      }
    };
    const reported = (session: string, old: string, fresh: string, side: number, ids: readonly string[]) =>
      add("comparison.reported", {
        session,
        reading: "no-step",
        old,
        fresh,
        starter: "h1",
        solves: side,
        setting: settingId(condition("any", "any")),
        versions: ids.map((id) => `v-${id}`),
      });
    const tasks = [
      { taskId: "a-1", family: "beam" },
      { taskId: "a-2", family: "beam" },
      { taskId: "b-1", family: "slab" },
      { taskId: "b-2", family: "slab" },
      { taskId: "b-3", family: "slab" },
      { taskId: "b-4", family: "slab" },
    ];
    for (const { taskId } of tasks) {
      add(TASK_PROPOSED, { version: `v-${taskId}`, taskId });
      add(TASK_GATE, { version: `v-${taskId}`, gate: 1, outcome: "passed" });
    }
    const first = events.length;
    // c-1, against the reference h1 at two solves a side.
    solved("c-1", "a-1", "h1", [false, false]);
    solved("c-1", "a-1", "h2", [true, false]);
    solved("c-1", "a-2", "h1", [true, true], [2, 2]);
    solved("c-1", "a-2", "h2", [true, true]);
    solved("c-1", "b-1", "h1", [false, false]);
    solved("c-1", "b-1", "h2", [false, false]);
    solved("c-1", "b-2", "h1", [true, false], [7, 1]);
    solved("c-1", "b-2", "h2", [false, true]);
    solved("c-1", "b-3", "h1", [true, true], [3, 3]);
    solved("c-1", "b-3", "h2", [true, true]);
    solved("c-1", "b-4", "h1", [false, false]);
    solved("c-1", "b-4", "h2", [false, false]);
    reported("c-1", "h1", "h2", 2, ["a-1", "a-2", "b-1", "b-2", "b-3", "b-4"]);
    // c-2 between two other harnesses, and c-3 against the reference at three solves a side.
    solved("c-2", "a-2", "h3", [true, true]);
    solved("c-2", "a-2", "h4", [false, false]);
    reported("c-2", "h3", "h4", 2, ["a-2"]);
    solved("c-3", "b-1", "h1", [true, true, true], [4, 6, 5]);
    solved("c-3", "b-1", "h5", [false, false, false]);
    reported("c-3", "h1", "h5", 3, ["b-1"]);
    add("task.state", { version: "v-b-3", state: "released" });
    add("task.state", { version: "v-b-4", state: "refused" });
    const { lines, counts, turns } = heard(events, tasks);
    expect(lines).toEqual([
      "a-1 (family beam): the reference harness answered it validly in no solve of the last comparison; a valid answer to it is on record",
      "a-2 (family beam): the last comparison that scored it was between two other harnesses, so the reference harness's own record on it is older or none; a valid answer to it is on record",
      "b-1 (family slab): the reference harness answered it validly in every solve of the last comparison; a valid answer to it is on record",
      "b-2 (family slab): the reference harness answered it validly in some solves of the last comparison and not in others; a valid answer to it is on record",
      "b-3 (family slab): in use as practice, and so never scored",
    ]);
    // a-2, b-3 and b-4 were each scored by c-1 and are in no count: the three lines read on the
    // reference's side are the three the total counts. Family beam counts one task, a-1, so its
    // row would be a-1's result: the rows by family fold into the total. Until 12 October beam's
    // row said which side won a-1, and esp32's 40 families each held one task.
    expect(counts?.split("\n").slice(1)).toEqual([
      "- every family, 3 tasks: 2 told apart, won by the other harness 1 and by the reference harness 1; 0 tied with both harnesses valid in every solve; 0 tied with neither valid in any solve, of which 0 with a valid answer on record; 1 tied otherwise; 0 set aside on a rejection not settled.",
      "Each count rests on 2 to 3 solves a side of the task's last comparison. The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
    ]);
    expect(
      lines.filter((line) =>
        /: the reference harness answered it validly in (every|some|no) solve/.test(line),
      ),
    ).toHaveLength(3);
    // One task counted alone is no count at all: it would be that task's result.
    expect(heard(events, tasks.slice(0, 1)).counts).toBeNull();
    // The turns of the reference's valid answers, from the comparison each line reads: b-1's three
    // in c-3 and b-2's one valid answer in c-1. a-2's answers in c-1 are not its last comparison's,
    // b-3 is practice, and no turn of another harness (11) is among them.
    expect(turns?.split("\n")).toEqual([
      "The solver's own turns each valid answer of the reference harness took, in the same comparisons as the lines above, by family and fewest first. These are measurements and no target.",
      "- family slab: 4, 5, 6, 7",
    ]);
    // A control between two other harnesses that reported first is not the reference: the turns
    // stay the starter's, as the lines and the counts do. Read from the first report's old side,
    // they were none of the reference's and the control's own (9) where it stood last.
    const from = events.length;
    solved("c-0", "b-2", "h3", [true, true], [9, 9]);
    solved("c-0", "b-2", "h4", [false, false]);
    reported("c-0", "h3", "h4", 2, ["b-2"]);
    const control = events.splice(from);
    expect(heard(events.toSpliced(first, 0, ...control), tasks)).toEqual({ lines, counts, turns });
    // Neither the lines nor the counts name a harness.
    expect([...lines, counts, turns].join("\n")).not.toMatch(/\bh[1-5]\b/);
  });
});

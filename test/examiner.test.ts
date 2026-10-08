// One Examiner session on the faux provider, with a verifier and solves that answer by a task's
// numbers. What is under test is the host's side: which gates an instance meets and in what order,
// the one word its author is told, what the log keeps, and that a task's word moves no task.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Practised } from "../src/builder/session.ts";
import { type ExamRequest, examine } from "../src/examiner/session.ts";
import { supply } from "../src/examiner/supply.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { type TaskPackage, taskStates, taskVersion } from "../src/kernel/task.ts";
import type { Task, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { RefereeFinding } from "../src/review/referee.ts";

/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const SOLVER = "solver-canary-7f3a";
const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { answer: { type: "string" }, unit: { type: "string" } },
    required: ["answer", "unit"],
  },
  tools: [],
  install: "",
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
const LIMITS = { wallSeconds: 600, turns: 12, concurrency: 2, candidates: 4, feasible: 24 };
const EXAMPLE: Task = { taskId: "e-1", family: "fixture", publicInput: { base: 2 }, hidden: { seed: 5 } };
const PASS: Ending = { outcome: "pass" };
const FAIL: Ending = { outcome: "fail", kind: "rejected" };
const UNFINISHED: Ending = { outcome: "non-result", kind: "refusal", reason: "r" };
const FAULTY: Ending = { outcome: "non-result", kind: "check", reason: "check-unit: threw" };
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
/** Three controls of the task `id`, each one change to the accepted answer. */
const controlSets = (id: string, wrong = "41") => ({
  sets: [
    {
      task: id,
      controls: [
        { check: "check-product", path: "$.answer", value: JSON.stringify(wrong) },
        { check: "check-unit", path: "$.unit", value: '"kg"' },
        { check: "check-product", path: "$.answer", value: '"0"' },
      ],
    },
  ],
});
const controls = (id: string, wrong = "41") => call("write_controls", controlSets(id, wrong));

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

const baseOf = (task: Task) => Number(asRecord(task.publicInput)?.base);

/** The stand-in verifier: the product and the unit, each its own check. */
const verify: Verifier = async (task, answer) => {
  const given = asRecord(answer);
  const blocking = [
    ...(given?.answer === String(baseOf(task) * 6) ? [] : ["check-product"]),
    ...(given?.unit === "N" ? [] : ["check-unit"]),
  ];
  return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
};

/**
 * A scratch with a check program's two named files, a log, and solves that end by a task's base:
 * the stronger solver fails a base above 100 and cannot finish a base of 0, and the measured solver
 * ends as `test` says.
 */
function setup(responses: FauxResponseStep[], test: (base: number, nth: number) => Ending = () => PASS) {
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
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  const solves = { strong: 0, test: 0 };
  const counts = new Map<string, number>();
  /** A solve as the runner logs one: started, a verdict with its answer when it submitted, finished. */
  const solved = (side: "strong" | "test", task: Task, ending: Ending, answer: JsonValue): Practised => {
    solves[side] += 1;
    const solve = `${side}-${String(solves[side])}`;
    record("solve.started", { solve, task: task.taskId });
    if (ending.outcome !== "non-result") {
      record("verdict", { solve, task: task.taskId, answer, kind: ending.outcome });
    }
    record("solve.finished", { solve, ending });
    return { solve, ending };
  };
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
    responses.map((step) =>
      typeof step === "function"
        ? step
        : (context: unknown) => {
            sent.push(JSON.stringify(context));
            return step;
          },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const pack = (task: Task): TaskPackage => ({
    ...task,
    statement: `Fixture: ${task.taskId}`,
    ruleIds: ["R1", "R2"],
    checks,
  });
  const request: ExamRequest = {
    id: "x-1",
    contract: CONTRACT,
    checks: CHECKS,
    examples: [EXAMPLE],
    pack,
    verify,
    strong: async (task) => {
      const base = baseOf(task);
      if (base === 0) return solved("strong", task, UNFINISHED, null);
      const answer = { answer: String(base * 6), unit: "N" };
      return solved(
        "strong",
        task,
        base > 100 ? FAIL : PASS,
        base > 100 ? { answer: "1", unit: "N" } : answer,
      );
    },
    test: async (task) => {
      const base = baseOf(task);
      const nth = counts.get(task.taskId) ?? 0;
      counts.set(task.taskId, nth + 1);
      return solved("test", task, test(base, nth), { answer: SOLVER, unit: "N" });
    },
    screening: { solves: 3, fails: 2 },
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
  return { request, log, sent, of, solves, versionOf };
}

describe("an Examiner session", () => {
  it("is given the contract, the checks and the examples, and nothing of a solver", async () => {
    const s = setup([call("read_example", { task: "e-1" }), finish]);
    const examined = await examine(s.request);
    expect(examined).toEqual({ feasible: [], words: {}, ended: "finished" });
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain("check-product (every family): The answer is six times the base.");
    expect(s.sent[0]).toContain("e-1 (family fixture)");
    expect(s.sent[0]).toContain("10 minutes and 12 turns");
    // How many tasks are wanted is not the Examiner's to know: no prompt and no tool text says 24.
    expect((s.sent[0] ?? "").replace(/"timestamp":\d+/g, "")).not.toContain("24");
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

  it("puts an instance through its gates in order and tells its author one word of it", async () => {
    // The measured solver fails a base of 7 twice in three.
    const s = setup(
      [propose(7, 200, null, 7), controls("x-1-001", "42"), controls("x-1-001"), finish],
      (base, nth) => (base === 7 && nth < 2 ? FAIL : PASS),
    );
    const examined = await examine(s.request);
    const proposed = s.sent[1] ?? "";
    expect(proposed).toContain("x-1-001: feasible so far. The answer the checks accepted:");
    expect(proposed).toContain(String.raw`\"answer\": \"42\"`);
    expect(proposed).toContain("x-1-002: too hard");
    expect(proposed).toContain("x-1-003: refused: no inputs");
    expect(proposed).toContain("An instance proposed before was not taken again.");
    // A control that changes nothing is a slip and costs no try; one the checks pass would be a defect.
    expect(s.sent[2]).toContain(
      "x-1-001: the answer already carries that value at $.answer. Write its controls again.",
    );
    expect(s.sent[3]).toContain("x-1-001: scored");
    // The stronger solver solved the two instances gate 1 let through, and no instance twice.
    expect(s.solves).toEqual({ strong: 2, test: 3 });
    const [feasible, hard] = [s.versionOf("x-1-001", 7), s.versionOf("x-1-002", 200)];
    expect(examined).toMatchObject({ feasible: [feasible], ended: "finished" });
    expect(examined.words[feasible]).toBe("scored");
    expect(examined.words[hard]).toBe("too hard");
    // The word moved no task: a scored task is still held, for a round to screen under both harnesses.
    const states = taskStates(read(s.log));
    expect(states.get(feasible)).toBe("held");
    expect(states.get(hard)).toBe("too-hard");
    expect([...states.values()].sort()).toEqual(["held", "refused", "too-hard"]);
    const gates = s.of("task.gate").filter(({ version }) => version === feasible);
    expect(gates.map(({ gate, outcome }) => [gate, outcome])).toEqual([
      [1, "passed"],
      [2, "passed"],
      [3, "passed"],
      [4, "passed"],
    ]);
    expect(gates[3]?.controls).toMatch(/^[0-9a-f]{64}$/);
    // The instance is in the log whole, so a later solve of it needs nothing else.
    expect(s.of("task.proposed")[0]).toMatchObject({
      version: feasible,
      taskId: "x-1-001",
      session: "x-1",
      task: { family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } },
    });
    expect(
      s
        .of("exam.word")
        .map(({ taskId, word }) => `${JSON.stringify(taskId)} ${JSON.stringify(word)}`)
        .sort(),
    ).toEqual(['"x-1-001" "scored"', '"x-1-002" "too hard"', '"x-1-003" "refused"']);
    expect(s.of("exam.word").at(-1)).toMatchObject({
      word: "scored",
      fails: 2,
      solves: ["test-1", "test-2", "test-3"],
    });
    // Nothing a measured solve submitted reached the Examiner.
    expect(s.sent.join("\n")).not.toContain(SOLVER);
    expect(JSON.stringify(s.of("exam.call"))).not.toContain(SOLVER);
  });

  it("tells too easy, wall-bound and undecided apart, and ends when the host has its tasks", async () => {
    const s = setup(
      [propose(2, 3, 0), controls("x-1-001", "1"), controls("x-1-002", "1"), finish],
      // Base 3 only ever runs out of time, twice.
      (base, nth) => (base === 3 && nth < 2 ? { outcome: "fail", kind: "wall-ended" } : PASS),
    );
    const examined = await examine({ ...s.request, limits: { ...LIMITS, feasible: 2 } });
    expect(s.sent[1]).toContain("x-1-003: undecided: the host could not finish a solve of it");
    expect(s.sent[2]).toContain("x-1-001: too easy");
    expect(JSON.stringify(s.of("exam.call").at(-1))).toContain("x-1-002: wall-bound");
    expect(examined.ended).toBe("supplied");
    expect(Object.values(examined.words).sort()).toEqual(["too easy", "undecided", "wall-bound"]);
    // The second feasible task ended the session: the last turn was never asked for.
    expect(s.sent).toHaveLength(3);
    expect(JSON.stringify(s.of("exam.call").at(-1))).toContain("The host has the tasks it needs");
    expect(examined.feasible).toHaveLength(2);
    expect([...taskStates(read(s.log)).values()]).toEqual(["held", "held", "held"]);
  });

  it("refuses a task whose controls do not hold in three tries", async () => {
    // The second control names the wrong check: the unit's change is refused by the unit's check.
    const passing = call("write_controls", {
      sets: [
        {
          task: "x-1-001",
          controls: [
            { check: "check-product", path: "$.answer", value: '"1"' },
            { check: "check-product", path: "$.unit", value: '"kg"' },
            { check: "check-unit", path: "$.unit", value: '"g"' },
          ],
        },
      ],
    });
    const s = setup([propose(5), passing, passing, passing, controls("x-1-001"), finish]);
    const examined = await examine(s.request);
    expect(s.sent[2]).toContain(
      "its controls do not hold: control 2 failed check-unit, not check-product. Write them again.",
    );
    expect(s.sent[4]).toContain("x-1-001: refused: control 2 failed check-unit, not check-product");
    expect(s.sent[5]).toContain("x-1-001 is not waiting for controls.");
    expect(examined.feasible).toEqual([]);
    expect(s.solves.test).toBe(0);
    expect(s.of("task.gate").at(-1)).toMatchObject({ gate: 4, outcome: "refused" });
    expect([...taskStates(read(s.log)).values()]).toEqual(["refused"]);
  });

  it("disputes a feasible task a check is at fault on, by the check itself or by the Referee's ruling", async () => {
    const s = setup(
      [propose(4, 6), controls("x-1-001", "1"), controls("x-1-002", "1"), finish],
      (base, nth) => {
        if (base === 4 && nth === 0) return FAULTY;
        return base === 6 ? FAIL : PASS;
      },
    );
    const referee = async (): Promise<RefereeFinding> => ({
      ruling: "check-defect",
      check: "check-product",
      rule: null,
      field: null,
      reason: "r",
      probes: [],
    });
    const examined = await examine({ ...s.request, referee });
    expect(s.sent[2]).toContain("x-1-001: refused: a check was at fault on a solver's answer");
    expect(s.sent[3]).toContain("x-1-002: refused: a check was at fault on a solver's answer");
    expect(examined.feasible).toEqual([]);
    expect([...taskStates(read(s.log)).values()]).toEqual(["disputed", "disputed"]);
  });

  it("takes no instance past its proposals, and ends when a solve throws without saying why", async () => {
    const spent = setup([propose(1, 2, 3), propose(4, 5), propose(6), finish]);
    await examine({ ...spent.request, limits: { ...LIMITS, candidates: 4 } });
    expect(spent.sent[2]).toContain("An instance was not taken: this session can propose no further task.");
    expect(spent.sent[3]).toContain("This session can propose no further task.");
    expect(spent.solves.strong).toBe(4);

    const s = setup([propose(8), finish]);
    const stop = "the verifier could not decide x-1-001, so the run stops: check-unit";
    await expect(
      examine({
        ...s.request,
        strong: async () => {
          throw new Error(stop);
        },
      }),
    ).rejects.toThrow(stop);
    expect(s.of("exam.finished")[0]).toMatchObject({ ended: "crashed", crash: stop });
    expect(JSON.stringify(s.of("exam.call"))).toContain("The host could not go on");
    expect(JSON.stringify(s.of("exam.call"))).not.toContain("check-unit");
    expect(s.sent).toHaveLength(1);
  });
  it("counts toward its tasks only those whose test-side solves all counted", async () => {
    // Base 2's first test-side solve ends in nothing countable; base 4's all pass.
    const s = setup(
      [propose(2, 4), controls("x-1-001", "1"), controls("x-1-002", "1"), finish],
      (base, nth) => (base === 2 && nth === 0 ? UNFINISHED : PASS),
    );
    const examined = await examine({ ...s.request, limits: { ...LIMITS, feasible: 2 } });
    expect(s.sent[2]).toContain("x-1-001: undecided");
    // Both tasks are feasible and stay held, and the host does not yet have two it can read.
    expect(examined).toMatchObject({ ended: "finished" });
    expect(examined.feasible).toHaveLength(2);
    expect(supply(read(s.log))).toMatchObject({ feasible: 1, reading: "unfinished" });
  });

  it("ends at supply though another call shares the turn, and takes no instance after it", async () => {
    const both = fauxAssistantMessage(
      [
        fauxToolCall("write_controls", controlSets("x-1-001", "1")),
        fauxToolCall("propose_tasks", { tasks: [instance(11), instance(12)] }),
      ],
      toolUse,
    );
    const s = setup([propose(2), both, propose(13), finish]);
    const examined = await examine({ ...s.request, limits: { ...LIMITS, feasible: 1 } });
    expect(examined.ended).toBe("supplied");
    // One stronger solve, of the one task: the two instances beside the controls were not taken.
    expect(s.solves).toEqual({ strong: 1, test: 3 });
    expect(JSON.stringify(s.of("exam.call").at(-1))).toContain("The host has the tasks it needs");
    expect(s.of("exam.turn")).toHaveLength(2);
  });

  it("ends on a broken harness and not on a word, and takes one session to an id", async () => {
    const broken: Ending = { outcome: "fail", kind: "broken-harness", reason: "no tools" };
    const strong = setup([propose(5, 6), finish]);
    await expect(
      examine({ ...strong.request, strong: async () => ({ solve: "s", ending: broken }) }),
    ).rejects.toThrow("the harness is broken, so no solve of any task counts: no tools");
    // No task was told too hard for it, and none was moved.
    expect(strong.of("exam.word")).toEqual([]);
    expect([...taskStates(read(strong.log)).values()]).toEqual(["held", "held"]);
    const test = setup([propose(5), controls("x-1-001", "1"), finish], () => broken);
    await expect(examine(test.request)).rejects.toThrow("the harness is broken");
    expect(test.of("exam.finished")[0]).toMatchObject({ ended: "crashed" });
    await expect(examine(test.request)).rejects.toThrow("session x-1 is in the log already");
    expect(test.of("exam.started")).toHaveLength(1);
  });
});

describe("D1b's supply reading", () => {
  it("counts what a session wrote, and what each feasible task's solves showed", async () => {
    const s = setup(
      [propose(7, 200, null, 3), controls("x-1-001"), controls("x-1-004", "1"), finish],
      // Base 7 fails twice in three and base 3 once.
      (base, nth) => (nth < (base === 7 ? 2 : 1) ? FAIL : PASS),
    );
    await examine(s.request);
    expect(supply(read(s.log))).toEqual({
      proposed: 4,
      words: { scored: 1, "too hard": 1, refused: 1, "too easy": 1 },
      feasible: 2,
      once: 2,
      twice: 1,
      wallBound: 0,
      solves: { strong: 3, test: 6 },
      bracketed: 1,
      reading: "unfinished",
    });
  });

  it("reads the plan's rule over the first 24 feasible tasks: go at 8, revise at 5 to 7, stop below", () => {
    const told = (scored: number, feasible: number) =>
      Array.from({ length: feasible }, (_, index) => ({
        at: "2026-10-08T00:00:00.000Z",
        kind: "exam.word" as const,
        data: {
          session: "x",
          version: `v${String(index)}`,
          word: index < scored ? "scored" : "too easy",
          fails: index < scored ? 2 : 0,
          solves: ["a", "b", "c"],
        },
      }));
    expect(supply(told(8, 24)).reading).toBe("go");
    expect(supply(told(7, 24)).reading).toBe("revise");
    expect(supply(told(5, 30)).reading).toBe("revise");
    expect(supply(told(4, 24)).reading).toBe("stop");
    expect(supply(told(23, 23)).reading).toBe("unfinished");
    // A task scored after the twenty-fourth feasible one is supply, and is outside the rule.
    expect(
      supply([
        ...told(4, 24),
        ...told(1, 1).map((event) => ({ ...event, data: { ...event.data, version: "late" } })),
      ]),
    ).toMatchObject({ feasible: 25, bracketed: 4, once: 4, twice: 4, reading: "stop" });
    // A wall-bound task has fails and is not bracketed, and is named apart for that.
    const walled = told(0, 24).map((event, index) =>
      index === 0 ? { ...event, data: { ...event.data, word: "wall-bound", fails: 2 } } : event,
    );
    expect(supply(walled)).toMatchObject({ bracketed: 0, once: 1, twice: 1, wallBound: 1, reading: "stop" });
  });
});

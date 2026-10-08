// One Rule Author session on the faux provider, over a pack on disk and a verifier with no wall: it
// loads the staged candidate program in this process and runs each applicable check on the
// projection the real verifier would hand it. What is under test is the host's side: the proof
// that a candidate only adds, each gate and what it refuses, the interference reading, what the
// session is and is not sent, and that a candidate is left only by a session that finished on one.
//
// A second stand-in runs each check as the verifier does, less the OS wall: `check-child.ts` in a
// process of its own, over a copy of the program in a cell of its own. The tests that try to move
// an existing check from inside an added module use that one, since what holds there is the
// process and the copy and not this process's module cache.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ControlRun } from "../src/kernel/acceptance.ts";
import type { CheckChildInput, CheckChildResult } from "../src/kernel/check-child.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { type Contract, contractHash } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import {
  applicableTruthChecks,
  checkEvaluationRequest,
  checkProgramFiles,
  checkProgramVersion,
  readBrief,
  type Task,
  type Verdict,
  type Verifier,
} from "../src/kernel/verify.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isBoolean, isFunction, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { hashJsonValue, requireJsonValue } from "../src/meta/stable-json.ts";
import {
  type Added,
  type Addition,
  additive,
  copyTools,
  entryText,
  modelOf,
  writeCandidate,
} from "../src/rules/candidate.ts";
import {
  interference,
  interfering,
  labelFaults,
  type NamedControl,
  type Stored,
} from "../src/rules/gates.ts";
import { authorRule, type RuleRequest } from "../src/rules/session.ts";
import { storedIn } from "../tools/c/rule-author.ts";
import { checkProgram, contractOf, packControls, readPack } from "../tools/m0/stored-sweep.ts";
import { overview } from "../tools/wri/read.ts";

/** What no Rule Author may be sent, each planted where a campaign's log or its pack holds it: the
 *  text of a measured solve's answer, the digest of the harness the campaign stands on, a
 *  Builder's note, a passage of a measured solve's trace, and the answers only the host reads, a
 *  stored sweep's pass and a pack's accept control. */
const SOLVER = "solver-canary-7f3a";
const HARNESS = "harness-canary-91c4";
const BUILDER = "builder-canary-5d2e";
const TRACE = "trace-canary-c81b";
const SWEEP = "sweep-canary-0e66";
const CONTROL = "control-canary-a47d";
const CANARIES = [SOLVER, HARNESS, BUILDER, TRACE, SWEEP, CONTROL];
const CHECK_CHILD = join(import.meta.dir, "..", "src", "kernel", "check-child.ts");
/** The check program's entry, as `verify.ts` names it. */
const ENTRY = "evaluator.ts";
/** The event a session's record ends on. */
const FINISHED: EventKind = "rule.finished";
const RULES = [
  { id: "R1", statement: "The answer is the base times six.", visibility: "public" },
  { id: "R2", statement: "The unit is the newton.", visibility: "public" },
];
const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { answer: { type: "string" }, unit: { type: "string" }, note: { type: "string" } },
    required: ["answer", "unit", "note"],
  },
  conventions: "SI units.",
  rules: RULES,
  scope: "Fixture.",
};
const EVALUATOR = `import { FACTOR } from "./reference/model.ts";
export const checks = {
  "check-product": ({ artifact, publicTask }) => artifact.answer === String(publicTask.publicInput.base * FACTOR),
  "check-unit": ({ artifact }) => artifact.unit === "N",
};
`;
const LIMITS = { wallSeconds: 600, turns: 12, concurrency: 2, tries: 3 };
/** The rule the sessions here add: the note names the task's base. */
const NOTE_CODE =
  "export const check = ({ artifact, publicTask }) => artifact.note.trim() === `base ${publicTask.publicInput.base}`;\n";
const RULE = {
  id: "R3",
  statement:
    "The note is the word base, a space and the task's base in decimal digits; spaces at either end are ignored.",
};
const CHECK = {
  id: "check-note",
  assertion: "The note names the task's base.",
  answer_paths: ["$.note"],
  public_input_paths: ["$.base"],
};
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
/** The gates of a first addition that held, as `gates` reads them: the interference over the
 *  witnesses, which is all its check is put to while the session runs. */
const HELD = [
  [1, "shape", "passed"],
  [1, "controls", "passed"],
  [1, "determinism", "passed"],
  [1, "interference", "reported", "witnesses"],
];

/** A pack's brief as these tests rewrite one. */
interface LooseBrief {
  domain: string;
  ruleDecisions: JsonObject[];
  truthChecks: (JsonObject & { execution: JsonObject })[];
}

const execution = (reads: string, inputs: string[]) => ({
  families: "all",
  artifactPaths: [reads],
  publicInputPaths: inputs,
  hidden: "none",
  evidence: { kind: "authored" },
});
const BRIEF = {
  correctnessContract: "check-program/v1",
  domain: "Fixture",
  ruleDecisions: [...RULES, { id: "P1", statement: "Search widest first.", visibility: "private" }],
  truthChecks: [
    {
      id: "check-product",
      assertion: "The answer is six times the base.",
      citedDecisionIds: ["R1"],
      execution: execution("$.answer", ["$.base"]),
    },
    {
      id: "check-unit",
      assertion: "The unit is N.",
      citedDecisionIds: ["R2"],
      execution: execution("$.unit", []),
    },
  ],
};
const task = (taskId: string, base: number): Task => ({
  taskId,
  family: "fixture",
  publicInput: { base },
  hidden: { seed: 5 },
});
const PACKED = task("e-1", 2);
const WRITTEN = [task("x-1-001", 7), task("x-1-002", 3), task("x-1-003", 5)];
const answer = (product: number, note: string, unit = "N") => ({ answer: String(product), unit, note });
/** The answers stronger solves were accepted on. The second was accepted before any rule spoke of
 *  the note, and its note names no base. */
const WITNESSES = [answer(42, "base 7"), answer(18, "three"), answer(30, "base 5")];
const noted = (taskId: string, label: "accept" | "reject", note: JsonValue) => ({
  task: taskId,
  expect: label,
  change: { path: "$.note", value: JSON.stringify(note) },
});
const REJECTS = [
  noted("x-1-001", "reject", "base 8"),
  noted("x-1-001", "reject", "7"),
  noted("x-1-001", "reject", "Base 7"),
];
const CONTROLS = [...REJECTS, noted("x-1-001", "accept", " base 7 "), { task: "x-1-003", expect: "accept" }];
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
/** The answers only the host reads: the pack's accept control, which has gone stale, and the
 *  stored sweep's pass. Each carries a canary in a field no check reads. */
const CONTROL_ANSWER = { ...answer(12, "base 2", "kg"), aside: CONTROL };
const SWEEP_ANSWER = { ...answer(12, "base 2"), aside: SWEEP };
/** The condition a measured solve of a task version runs under, where the campaign stands. */
const condition = (version: string): Condition => ({
  contract: "c1",
  harness: HARNESS,
  task: version,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: HARNESS,
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
const finish = call("finish", { note: "The note rule, from the fixture's own convention." });
const propose = (over: JsonObject = {}) =>
  call("propose_rule", { rule: RULE, check: CHECK, code: NOTE_CODE, controls: CONTROLS, ...over });

// Some tests here run every check in a process of its own, a few dozen to a session.
setDefaultTimeout(60_000);

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A verifier with no wall over a staged check program: each applicable check of its brief, run in
 *  this process on the request the real verifier would hand it. A check that throws, is missing or
 *  returns no boolean is faulty, as `check-child.ts` has it. */
function verifierOver(checks: string): Verifier {
  const brief = readBrief(checks);
  return async (given, submitted): Promise<Verdict> => {
    if (submitted === undefined) return { kind: "fail", blocking: [] };
    const program = await import(join(checks, ENTRY));
    const blocking: string[] = [];
    for (const check of applicableTruthChecks(brief, given)) {
      let passed: unknown;
      try {
        passed = await program.checks[check.id](
          checkEvaluationRequest(check, { publicTask: given, artifact: submitted, hidden: given.hidden }),
        );
      } catch (error) {
        return { kind: "faulty", check: check.id, reason: `the check threw: ${errorMessage(error)}` };
      }
      if (!isBoolean(passed)) return { kind: "faulty", check: check.id, reason: "no boolean" };
      if (!passed) blocking.push(check.id);
    }
    return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
  };
}

/** A pack as v1 lays one out, with a tool tree of one file. */
function layPack(scratch: string): string {
  const pack = join(scratch, "pack");
  const model = join(pack, "correctness-model");
  mkdirSync(join(model, "reference"), { recursive: true });
  mkdirSync(join(pack, ".toolchain", "bin"), { recursive: true });
  writeFileSync(join(pack, ".toolchain", "bin", "tool"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(model, "brief.json"), JSON.stringify(BRIEF));
  writeFileSync(join(model, ENTRY), EVALUATOR);
  writeFileSync(join(model, "reference", "model.ts"), "export const FACTOR = 6;\n");
  writeFileSync(join(model, "tasks.json"), JSON.stringify([PACKED]));
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({ accept: [{ taskId: "e-1", artifact: CONTROL_ANSWER }], reject: [] }),
  );
  return pack;
}

/**
 * The verifier's own way of running a check, less the OS wall: each applicable check as
 * `check-child.ts` in a process of its own, over a copy of the staged program in a cell of its
 * own, with the request `verify.ts` would hand it. What a check's module does to its process or
 * to its copy ends with them.
 */
function cellVerifier(checks: string): Verifier {
  const brief = readBrief(checks);
  const files = checkProgramFiles(checks);
  return async (given, submitted): Promise<Verdict> => {
    if (submitted === undefined) return { kind: "fail", blocking: [] };
    const blocking: string[] = [];
    for (const check of applicableTruthChecks(brief, given)) {
      const cell = mkdtempSync(join(tmpdir(), "ana-rule-cell-"));
      try {
        for (const file of files) {
          mkdirSync(dirname(join(cell, "program", file)), { recursive: true });
          copyFileSync(join(checks, file), join(cell, "program", file));
        }
        const input: CheckChildInput = {
          program: join(cell, "program", ENTRY),
          checkId: check.id,
          request: checkEvaluationRequest(check, {
            publicTask: given,
            artifact: submitted,
            hidden: given.hidden,
          }),
          tools: [],
          toolPath: "",
          toolCeilingMs: 1000,
        };
        const child = Bun.spawn({
          cmd: [capturedExecPath, CHECK_CHILD],
          cwd: cell,
          stdin: new TextEncoder().encode(JSON.stringify(input)),
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
        if (!existsSync(join(cell, "result.json"))) return { kind: "non-result", reason: stderr.slice(-300) };
        const result = parseJsonAs<CheckChildResult>(readFileSync(join(cell, "result.json"), "utf8"));
        if ("nonResult" in result) return { kind: "non-result", reason: result.nonResult };
        if ("faulty" in result) return { kind: "faulty", check: check.id, reason: result.faulty };
        if (!result.passed) blocking.push(check.id);
      } finally {
        rmSync(cell, { recursive: true, force: true });
      }
    }
    return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
  };
}

/**
 * A scratch with a pack, a log and a session's request. The log holds three tasks a session wrote,
 * each past gate 4 on a stronger solve's answer; four solves of the solver being measured where
 * the campaign stands, two of them passes, each with its trace; and a Builder session, a ruling
 * and a diagnosis. The pack's accept control has gone stale, and the stored sweep holds one pass.
 * Everything a Rule Author may not be sent carries a canary.
 */
function setup(responses: FauxResponseStep[]) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-rule-author-")));
  scratches.push(scratch);
  const pack = layPack(scratch);
  const log = join(scratch, "log.jsonl");
  const candidates = join(scratch, "candidates");
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const [index, written] of WRITTEN.entries()) {
    const version = `v-${written.taskId}`;
    const solve = `strong-${String(index + 1)}`;
    const { taskId, family, publicInput, hidden } = written;
    record("task.proposed", {
      version,
      taskId,
      session: "x-1",
      task: { taskId, family, publicInput, hidden },
    });
    record("task.gate", { version, gate: 1, outcome: "passed" });
    record("verdict", { solve, task: taskId, answer: WITNESSES[index] ?? null, kind: "pass" });
    record("task.gate", { version, gate: 2, outcome: "passed", solve });
    record("task.gate", { version, gate: 3, outcome: "passed" });
    record("task.gate", { version, gate: 4, outcome: "passed", controls: "d" });
  }
  /** One finished solve of the solver being measured: its condition, its trace and its verdict. */
  const measuredSolve = (solve: string, taskId: string, submitted: JsonValue, blocking?: string[]) => {
    const ran = condition(`v-${taskId}`);
    const id = conditionId(ran);
    if (!read(log).some(({ kind, data }) => kind === "condition.recorded" && data.id === id)) {
      record("condition.recorded", { id, condition: requireJsonValue(ran) });
    }
    record("solve.started", { solve, condition: id });
    record("solve.turn", { solve, turn: 1, text: TRACE });
    record("solve.call", { solve, turn: 1, tool: "bash", args: { command: TRACE }, result: TRACE });
    const ending = blocking === undefined ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" };
    record("solve.finished", { solve, ending });
    const verdict = blocking === undefined ? { kind: "pass" } : { kind: "fail", blocking };
    record("verdict", { solve, task: taskId, answer: submitted, ...verdict });
  };
  measuredSolve("test-1", "x-1-001", answer(42, SOLVER));
  measuredSolve("test-2", "x-1-003", answer(30, " base 5"));
  // A fail is no accepted answer, and no interference reads it.
  measuredSolve("test-3", "x-1-003", answer(1, SOLVER), ["check-product"]);
  measuredSolve("test-4", "x-1-003", answer(2, SOLVER), ["check-product"]);
  record("build.started", { session: "b-1", parent: HARNESS, tasks: [] });
  record("build.call", {
    session: "b-1",
    tool: "write_file",
    args: { path: "agent/guide.md", text: BUILDER },
  });
  record("build.finished", { session: "b-1", ended: "finished", note: BUILDER, harness: HARNESS });
  record("referee.finding", { solve: "test-3", ruling: "earned", reason: TRACE });
  record("diagnosis.recorded", { solve: "test-3", owner: "harness/guide", reason: BUILDER });
  const tasks = [PACKED, ...WRITTEN];
  const stored: Stored[] = [
    ...storedIn(read(log), tasks),
    { task: PACKED, answer: CONTROL_ANSWER, from: "control" },
    { task: PACKED, answer: SWEEP_ANSWER, from: "sweep" },
  ];
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-rule-author",
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
  const request: RuleRequest = {
    id: "r-1",
    contract: CONTRACT,
    base: {
      contract: contractHash(CONTRACT),
      checks: hashJsonValue(checkProgramVersion(checkProgram(pack, join(scratch, "base-checks")))),
    },
    pack,
    candidates,
    tasks,
    stored,
    standsOn: { harness: HARNESS, setting: settingId(condition("any")) },
    screening: { solves: 3, fails: 2 },
    binding: { binds: "correctness-model", why: "two sessions wrote mostly tasks the solver passes" },
    stage: checkProgram,
    verifier: verifierOver,
    found: () => false,
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
  /** Each gate an addition met: its try, the gate and the outcome, and for an interference
   *  reading what it was taken over. */
  const gates = () =>
    of("rule.gate").map(({ try: nth, gate, outcome, over }) =>
      over === undefined ? [nth, gate, outcome] : [nth, gate, outcome, over],
    );
  /** Nothing the session was sent holds a canary, and nothing its own turns and calls left in the
   *  log does: what it wrote and what its tools returned. */
  const expectWalled = () => {
    const seen = [...sent, ...[...of("rule.turn"), ...of("rule.call")].map((data) => JSON.stringify(data))];
    expect(CANARIES.filter((canary) => seen.some((text) => text.includes(canary)))).toEqual([]);
  };
  return { request, scratch, pack, log, candidates, sent, of, gates, expectWalled };
}

describe("a Rule Author session", () => {
  it("is given the contract, the checks, the tasks and the witnesses, and nothing of a harness or a measured solver", async () => {
    const s = setup([
      call("read_check_program", {}),
      call("read_check_program", { path: "evaluator.ts" }),
      call("read_task", { task: "x-1-001" }),
      call("read_task", { task: "e-1" }),
      finish,
    ]);
    const authored = await authorRule(s.request);
    expect(authored).toEqual({ ended: "finished", tries: 0, candidate: null });
    const opening = s.sent[0] ?? "";
    expect(opening).toContain("R1: The answer is the base times six.");
    expect(opening).toContain(
      "check-product (every family): The answer is six times the base. Cites R1; reads $.answer of the answer and $.base of the public input.",
    );
    expect(opening).toContain("Tools a check may name: none.");
    expect(opening).toContain("- x-1-001 (family fixture), with an accepted answer on record");
    expect(opening).toContain(String.raw`- e-1 (family fixture)\n`);
    // What was measured of the campaign's tasks where it stands: a word and counts, and the
    // checks that refused, as an Examiner is told them.
    expect(opening).toContain("- x-1-001 (family fixture): not yet measured");
    expect(opening).toContain(
      "- x-1-003 (family fixture): scored: 2 of 3 solves failed, refused by check-product (2)",
    );
    expect(opening).toContain("10 minutes, 12 turns and 3 attempts at the gates");
    // A private decision of the pack's author is no public rule, and is not shown as one.
    expect(opening).not.toContain("P1:");
    // The program it reads is the staged one: the battery is no part of it.
    expect(s.sent[1]).toContain(String.raw`brief.json\nevaluator.ts\nreference/model.ts`);
    expect(s.sent[1]).not.toContain("tasks.json");
    expect(s.sent[2]).toContain("FACTOR");
    expect(s.sent[3]).toContain(String.raw`\"note\": \"base 7\"`);
    expect(s.sent[3]).toContain(String.raw`\"seed\": 5`);
    expect(s.sent[4]).toContain("No accepted answer of it is on record for you to read.");
    // The harness is named in the log, for whoever reads the session, and in nothing it was sent;
    // nor is a measured solve's answer or trace, a Builder's note, or an answer only the host reads.
    expect(s.sent).toHaveLength(5);
    s.expectWalled();
    expect(s.of("rule.started")[0]).toMatchObject({
      session: "r-1",
      standsOn: HARNESS,
      binding: { binds: "correctness-model" },
      base: s.request.base,
      checks: ["check-product", "check-unit"],
      witnessed: ["x-1-001", "x-1-002", "x-1-003"],
      stored: { witness: 3, solve: 2, control: 1, sweep: 1 },
    });
    expect(s.of(FINISHED)[0]).toMatchObject({ ended: "finished", tries: 0, candidate: null });
    // A session that adds nothing leaves nothing on disk.
    expect(readdirSync(s.candidates)).toEqual([]);
  });

  it("adds one rule and one check, and leaves a candidate whose existing parts are byte-identical", async () => {
    const s = setup([propose(), finish]);
    const before = checkProgramVersion(modelOf(s.pack));
    const authored = await authorRule(s.request);
    const dir = join(s.candidates, "r-1");
    expect(authored).toMatchObject({
      ended: "finished",
      tries: 1,
      candidate: { dir, rule: "R3", check: "check-note" },
    });
    // The pack itself was not touched, and every file of it is in the candidate as it was.
    expect(checkProgramVersion(modelOf(s.pack))).toEqual(before);
    const [was, now] = [modelOf(s.pack), modelOf(dir)];
    for (const file of ["reference/model.ts", "tasks.json", "controls.json"]) {
      expect(sha256OfFile(join(now, file))).toBe(sha256OfFile(join(was, file)));
    }
    expect(sha256OfFile(join(now, "evaluator.pack.ts"))).toBe(sha256OfFile(join(was, "evaluator.ts")));
    expect(sha256OfFile(join(dir, ".toolchain", "bin", "tool"))).toBe(
      sha256OfFile(join(s.pack, ".toolchain", "bin", "tool")),
    );
    // What is new: the host's entry, the session's module, and one row at the end of each list.
    expect(readFileSync(join(now, ENTRY), "utf8")).toBe(entryText(["check-note"]));
    expect(readFileSync(join(now, "added", "check-note.ts"), "utf8")).toBe(NOTE_CODE);
    const brief = JSON.parse(readFileSync(join(now, "brief.json"), "utf8"));
    expect(brief.ruleDecisions.slice(0, 3)).toEqual(BRIEF.ruleDecisions);
    expect(brief.truthChecks.slice(0, 2)).toEqual(BRIEF.truthChecks);
    const row = { ...RULE, visibility: "public", publicInputPaths: ["$.base"] };
    expect(brief.ruleDecisions.slice(3)).toEqual([row]);
    expect(brief.truthChecks.slice(2)).toEqual([
      {
        id: "check-note",
        assertion: CHECK.assertion,
        citedDecisionIds: ["R3"],
        execution: execution("$.note", ["$.base"]),
      },
    ]);
    expect(additive(s.pack, dir, "with-tools")).toMatchObject({ rule: RULE, check: { id: "check-note" } });

    // The four gates in order, and what each kept. The interference is read twice: over the
    // witnesses while the session ran, and over the whole record once it had finished.
    expect(s.gates()).toEqual([...HELD, [1, "interference", "reported", "record"]]);
    const checker = {
      contract: contractHash({ ...CONTRACT, rules: [...RULES, row] }),
      checks: hashJsonValue(checkProgramVersion(checkProgram(dir, join(s.scratch, "left-checks")))),
    };
    const [proven, controlled, , readable, interfered] = s.of("rule.gate");
    expect(proven).toMatchObject({ rule: "R3", check: "check-note", ...checker });
    // The controls are whole in the log: the two answers they start from, and the four edits.
    expect(controlled).toMatchObject({ accepts: 3, rejects: 3 });
    expect(controlled?.set).toEqual([
      { taskId: "x-1-001", answer: answer(42, "base 7"), refusedBy: null },
      { taskId: "x-1-003", answer: answer(30, "base 5"), refusedBy: null },
      { taskId: "x-1-001", answer: answer(42, "base 8"), refusedBy: "check-note" },
      { taskId: "x-1-001", answer: answer(42, "7"), refusedBy: "check-note" },
      { taskId: "x-1-001", answer: answer(42, "Base 7"), refusedBy: "check-note" },
      { taskId: "x-1-001", answer: answer(42, " base 7 "), refusedBy: null },
    ]);
    // While the session ran its check was put to the three witnesses and to nothing else: beside
    // the two its controls start from, one, which it refuses.
    expect(readable).toMatchObject({
      applied: 1,
      refused: 1,
      stale: 0,
      reading: "refuses-all",
      tasks: [{ taskId: "x-1-002", refused: 1, unrunnable: 0, kept: 0 }],
      from: { witness: 3 },
    });
    // The whole record, beside the two answers the controls start from: one witness and one
    // measured pass refused, one measured pass and the sweep's kept, and a stale control apart.
    expect(interfered).toMatchObject({
      applied: 4,
      refused: 2,
      unrunnable: 0,
      stale: 1,
      reading: "refuses-some",
      suspect: false,
      tasks: [
        { taskId: "x-1-001", refused: 1, unrunnable: 0, kept: 1 },
        { taskId: "x-1-002", refused: 1, unrunnable: 0, kept: 0 },
      ],
      from: { witness: 3, solve: 2, control: 1, sweep: 1 },
    });
    expect(authored.candidate?.checker).toEqual(checker);
    expect(s.of("rule.candidate")).toEqual([
      {
        session: "r-1",
        try: 1,
        dir: "candidates/r-1",
        rule: RULE,
        check: { id: "check-note", assertion: CHECK.assertion },
        base: { ...s.request.base },
        ...checker,
        reading: "refuses-some",
        suspect: false,
        note: authored.candidate?.interference.note ?? "",
      },
    ]);
    expect(s.of(FINISHED)[0]).toMatchObject({
      ended: "finished",
      tries: 1,
      candidate: "candidates/r-1",
      unfinished: null,
    });
    // Its author is told of the witnesses it can read, and nothing of the measured solver's pass.
    const told = s.sent[1] ?? "";
    expect(told).toContain(
      "The addition holds at every gate: rule R3 and check check-note, on 3 accept controls and 3 reject controls, each run twice.",
    );
    expect(told).toContain(
      "Of the 1 other accepted answer you can read that check-note applies to, it refuses 1 (x-1-002) and could not run on 0.",
    );
    s.expectWalled();
    // The investigation's reader finds the candidate and its reading in the log as this session
    // wrote it, and names no answer.
    const triggers = overview(read(s.log)).triggers.flatMap(({ name, detail }) =>
      name === "CANDIDATE INTERFERENCE" || name === "RULE CANDIDATE LEFT" ? [detail] : [],
    );
    expect(triggers).toEqual([
      "r-1: check-note refuses 2 of 4 accepted answers on record and could not run on 0, which leaves 1 task with none accepted; 1 more the existing checks no longer accept; reading refuses-some",
      `r-1: rule R3 with check check-note over check program ${s.request.base.checks.slice(0, 8)}, as check program ${checker.checks.slice(0, 8)} in candidates/r-1; no event of this log adopts it`,
    ]);
    // Nothing but the candidate is left beside it.
    expect(existsSync(`${dir}.tries`)).toBe(false);
    // The candidate is a pack the existing commands read: its brief and tasks, its controls, and
    // its check program staged without the battery. Its public rules are the contract it would be
    // opened under, and its program decides as the gates saw it decide.
    const packed = readPack(dir);
    expect(packed.tasks).toEqual([PACKED]);
    expect(packed.brief.truthChecks.map(({ assertion }) => assertion).at(-1)).toBe(CHECK.assertion);
    expect(contractHash({ ...CONTRACT, rules: contractOf(packed.brief, CONTRACT.answerFormat).rules })).toBe(
      checker.contract,
    );
    expect(packControls(dir)).toEqual([{ taskId: "e-1", answer: CONTROL_ANSWER, refusedBy: null }]);
    const again = checkProgram(dir, join(s.scratch, "again"));
    expect(checkProgramFiles(again)).toEqual([
      "added/check-note.ts",
      "brief.json",
      "evaluator.pack.ts",
      "evaluator.ts",
      "reference/model.ts",
    ]);
    const verify = verifierOver(again);
    expect(await verify(WRITTEN[0] ?? PACKED, answer(42, "base 7"))).toEqual({ kind: "pass" });
    expect(await verify(WRITTEN[0] ?? PACKED, answer(41, "seven"))).toEqual({
      kind: "fail",
      blocking: ["check-product", "check-note"],
    });
  });

  it("refuses at the shape gate what does not only add, and takes the addition again", async () => {
    const s = setup([
      propose({ rule: { ...RULE, id: "P1" } }),
      propose({ code: `import { readFileSync } from "node:fs";\n${NOTE_CODE}` }),
      propose({ check: { ...CHECK, tools: ["python3"], cites: ["R9"] } }),
      propose({ code: `import { FACTOR } from "../reference/model.ts";\n${NOTE_CODE}` }),
      finish,
    ]);
    const authored = await authorRule({ ...s.request, limits: { ...LIMITS, tries: 4 } });
    // A private decision's id is taken too: a citation must mean one requirement.
    expect(s.sent[1]).toContain("Refused at the shape gate: the new rule's id is not a new one: P1.");
    expect(s.sent[1]).toContain("Send the addition again, revised: 3 attempts left.");
    expect(s.sent[2]).toContain(
      "added/check-note.ts imports node:fs, which is not a file of the pack's own check program",
    );
    expect(s.sent[3]).toContain("the new check cites R9, which is no public rule");
    expect(s.sent[3]).toContain("the new check names the tool python3, which no existing check names");
    expect(s.sent[3]).toContain("python3 is not on the verifier's tool path");
    // The pack's own module may be imported, and the fourth addition holds.
    expect(s.gates()).toEqual([
      [1, "shape", "refused"],
      [2, "shape", "refused"],
      [3, "shape", "refused"],
      [4, "shape", "passed"],
      [4, "controls", "passed"],
      [4, "determinism", "passed"],
      [4, "interference", "reported", "witnesses"],
      [4, "interference", "reported", "record"],
    ]);
    expect(authored).toMatchObject({ tries: 4, candidate: { check: "check-note" } });
  });

  it("refuses at the shape gate an addition that takes an existing check's name or names a file elsewhere", async () => {
    const s = setup([
      // Under an existing check's id the host's entry would hand that check to the new module.
      propose({ check: { ...CHECK, id: "check-unit" }, code: "export const check = () => true;\n" }),
      propose({ check: { ...CHECK, id: "../reference/model" } }),
      propose({ rule: { ...RULE, id: "r2" } }),
      finish,
    ]);
    const before = checkProgramVersion(modelOf(s.pack));
    const authored = await authorRule(s.request);
    expect(s.sent[1]).toContain(
      "Refused at the shape gate: the new check's id is not a new one that can name its module: check-unit.",
    );
    expect(s.sent[2]).toContain(
      String.raw`Refused at the shape gate: check id \"../reference/model\" is not a safe single path segment`,
    );
    expect(s.sent[3]).toContain("Refused at the shape gate: the new rule's id is not a new one: r2.");
    expect(s.gates()).toEqual([
      [1, "shape", "refused"],
      [2, "shape", "refused"],
      [3, "shape", "refused"],
    ]);
    expect(authored).toEqual({ ended: "finished", tries: 3, candidate: null });
    // No verifier ran a line of what was sent, and nothing was written over.
    expect(checkProgramVersion(modelOf(s.pack))).toEqual(before);
    expect(readdirSync(s.candidates)).toEqual([]);
  });

  it("refuses at the controls gate, names every fault, and charges no try for a slip", async () => {
    const s = setup([
      // Two slips: a task with no answer to start from, and a reject control that changes nothing.
      propose({ controls: [noted("e-1", "reject", "base 9")] }),
      propose({ controls: [{ task: "x-1-001", expect: "reject" }] }),
      // A reject control another check refuses, and one the new check passes.
      propose({
        controls: [
          REJECTS[0] ?? {},
          { task: "x-1-001", expect: "reject", change: { path: "$.unit", value: '"kg"' } },
          noted("x-1-001", "reject", "base 7 "),
        ],
      }),
      // An accepted answer the candidate cannot pass: the second witness's note names no base.
      propose({ controls: ["base 4", "3", "Base 3"].map((note) => noted("x-1-002", "reject", note)) }),
      // Too few, one outside the answer format, and one that repeats another.
      propose({
        controls: [
          REJECTS[0] ?? {},
          REJECTS[0] ?? {},
          { task: "x-1-001", expect: "accept", change: { path: "$.note", value: "7" } },
        ],
      }),
      propose(),
      finish,
    ]);
    const authored = await authorRule(s.request);
    expect(s.sent[1]).toContain(
      "e-1 has no accepted answer on record for a control to start from. Nothing was put to the gates.",
    );
    expect(s.sent[2]).toContain("control 1 is a reject control and names no change. Nothing was put");
    expect(s.sent[3]).toContain(
      "Refused at the controls gate: control 2 was refused by check-unit and not by check-note; check-note passed control 3, which it must refuse.",
    );
    expect(s.sent[4]).toContain(
      "the accepted answer of x-1-002 must pass every check and did not: fail check-note",
    );
    expect(s.sent[5]).toContain(
      "reject controls: 2, where at least 3 are due; control 2 repeats another control or the answer it starts from; control 3 does not follow the answer format.",
    );
    expect(s.sent[5]).toContain("This session has no attempt left. Call finish.");
    expect(JSON.stringify(s.of("rule.call").at(-2))).toContain(
      "This session has no attempt left at the gates",
    );
    expect(s.of("rule.gate").flatMap(({ gate, kinds }) => (gate === "controls" ? [kinds] : []))).toEqual([
      ["other-check", "passed"],
      ["accept-refused"],
      ["count", "format", "repeat"],
    ]);
    // Three tries were spent on three refusals, so nothing held and nothing is left.
    expect(authored).toEqual({ ended: "finished", tries: 3, candidate: null });
    // The investigation's reader counts the refusals from the log as this session wrote it.
    const triggers = overview(read(s.log)).triggers.flatMap(({ name, detail }) =>
      name === "RULE ADDITION REFUSED" || name === "RULE SESSION ENDED" ? [detail] : [],
    );
    expect(triggers).toEqual([
      "3 of 3 additions put to the gates; by gate: controls 3; control faults: accept-refused 1, count 1, format 1, other-check 1, passed 1, repeat 1",
      "r-1 ended finished after 3 additions",
    ]);
    expect(existsSync(join(s.candidates, "r-1"))).toBe(false);
  });

  it("refuses a check whose second verdict of an answer is another", async () => {
    // Right the first time it sees an answer, and the other way round the second.
    const flaky = [
      "const seen = new Map();",
      "export const check = ({ artifact, publicTask }) => {",
      "  const times = (seen.get(artifact.note) ?? 0) + 1;",
      "  seen.set(artifact.note, times);",
      "  return (artifact.note.trim() === `base ${publicTask.publicInput.base}`) === (times === 1);",
      "};",
      "",
    ].join("\n");
    const s = setup([propose({ code: flaky, controls: REJECTS }), finish]);
    const authored = await authorRule({ ...s.request, limits: { ...LIMITS, concurrency: 1 } });
    expect(s.sent[1]).toContain(
      "Refused at the determinism gate: the accepted answer of x-1-001 got two verdicts",
    );
    expect(s.gates()).toEqual([
      [1, "shape", "passed"],
      [1, "controls", "passed"],
      [1, "determinism", "refused"],
    ]);
    expect(authored.candidate).toBeNull();
  });

  it("keeps no addition its author did not finish on, and none it finished on unread", async () => {
    // The session's turns end with an addition that held and no word from its author.
    const cut = setup([propose()]);
    const ended = await authorRule({ ...cut.request, limits: { ...LIMITS, turns: 1 } });
    expect(ended).toEqual({ ended: "turns", tries: 1, candidate: null });
    expect(cut.of(FINISHED)[0]).toMatchObject({ candidate: null, unfinished: "check-note" });
    expect(cut.of("rule.candidate")).toEqual([]);
    expect(existsSync(join(cut.candidates, "r-1"))).toBe(false);
    expect(existsSync(join(cut.candidates, "r-1.tries"))).toBe(false);

    // A finish beside the addition, in one turn, has read nothing of what was said of it.
    const both = fauxAssistantMessage(
      [
        fauxToolCall("propose_rule", { rule: RULE, check: CHECK, code: NOTE_CODE, controls: CONTROLS }),
        fauxToolCall("finish", { note: "Done." }),
      ],
      toolUse,
    );
    const s = setup([both, finish]);
    const authored = await authorRule(s.request);
    expect(s.sent[1]).toContain(
      "propose_rule returned in this same turn. Read what it said, then call finish.",
    );
    expect(authored).toMatchObject({ ended: "finished", candidate: { check: "check-note" } });
    expect(s.of("rule.turn")).toHaveLength(2);

    // The other way round the session is over before the addition is read by any gate: gated
    // there, it held and became the candidate with its author told nothing of it.
    const first = setup([
      fauxAssistantMessage(
        [
          fauxToolCall("finish", { note: "Done." }),
          fauxToolCall("propose_rule", { rule: RULE, check: CHECK, code: NOTE_CODE, controls: CONTROLS }),
        ],
        toolUse,
      ),
    ]);
    expect(await authorRule(first.request)).toEqual({ ended: "finished", tries: 0, candidate: null });
    expect(first.gates()).toEqual([]);
    expect(JSON.stringify(first.of("rule.call").at(-1))).toContain(
      "The session has finished. Nothing was put to the gates.",
    );
    expect(existsSync(join(first.candidates, "r-1"))).toBe(false);
  });

  it("keeps the addition that held when the next is a slip or refused for want of a try, and none a refused one replaced", async () => {
    // A slip beside finish: the author meant to replace what held, and reads that it did not.
    const slip = fauxAssistantMessage(
      [
        fauxToolCall("propose_rule", {
          rule: RULE,
          check: CHECK,
          code: NOTE_CODE,
          controls: [noted("e-1", "reject", "base 9")],
        }),
        fauxToolCall("finish", { note: "Done." }),
      ],
      toolUse,
    );
    const kept = setup([propose(), slip, finish]);
    const authored = await authorRule(kept.request);
    expect(kept.sent[2]).toContain(
      "Nothing was put to the gates, and the addition that held before this one stands. Send the addition again.",
    );
    expect(kept.sent[2]).toContain("propose_rule returned in this same turn.");
    expect(authored).toMatchObject({ ended: "finished", tries: 1, candidate: { check: "check-note" } });

    // With no try left the call is refused before any gate, and what held stands.
    const spent = setup([propose(), propose({ code: "export const check = () => true;\n" }), finish]);
    const last = await authorRule({ ...spent.request, limits: { ...LIMITS, tries: 1 } });
    expect(JSON.stringify(spent.of("rule.call")[1])).toContain("no attempt left at the gates");
    expect(last).toMatchObject({ tries: 1, candidate: { check: "check-note" } });
    expect(readFileSync(join(modelOf(last.candidate?.dir ?? ""), "added", "check-note.ts"), "utf8")).toBe(
      NOTE_CODE,
    );

    // An addition put to the gates replaces the one before it, held or not.
    const replaced = setup([propose(), propose({ code: "export const check = () => true;\n" }), finish]);
    expect(await authorRule(replaced.request)).toEqual({ ended: "finished", tries: 2, candidate: null });
    expect(replaced.gates()).toEqual([...HELD, [2, "shape", "passed"], [2, "controls", "refused"]]);
    expect(replaced.of(FINISHED)[0]).toMatchObject({ candidate: null, unfinished: null });
    expect(readdirSync(replaced.candidates)).toEqual([]);
  });

  it("puts its check to no answer its author cannot read while the session can still be told", async () => {
    // A check that keeps every note it is handed in a file of the user's temporary directory, which
    // the Darwin wall leaves a check's cell to write in, and a second that throws that file's text
    // on a control. A computed import passes the scan of its imports.
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-rule-stash-")));
    scratches.push(scratch);
    const stash = JSON.stringify(join(scratch, "stash"));
    const keeping = [
      'const fs = await import("node:" + "fs");',
      "export const check = ({ artifact, publicTask }) => {",
      `  fs.appendFileSync(${stash}, artifact.note + ";");`,
      "  THROWS",
      "  return artifact.note.trim() === `base ${publicTask.publicInput.base}`;",
      "};",
      "",
    ].join("\n");
    const telling = `if (artifact.note === "base 8") throw new Error(fs.readFileSync(${stash}, "utf8"));`;
    const s = setup([
      propose({ code: keeping.replace("THROWS", ""), controls: REJECTS }),
      propose({ code: keeping.replace("THROWS", telling), controls: REJECTS }),
      finish,
    ]);
    const authored = await authorRule({ ...s.request, verifier: cellVerifier });
    // The first held, and its author was told so.
    expect(s.gates()).toEqual([...HELD, [2, "shape", "passed"], [2, "controls", "refused"]]);
    // The second carried back what the first had been handed: witnesses' notes, which its author
    // may read, and no measured solver's, which the first was never put to.
    expect(s.sent[2]).toContain("control 1: check check-note could not run on it: the check threw: ");
    expect(s.sent[2]).toContain("three;");
    expect(readFileSync(join(scratch, "stash"), "utf8")).not.toContain(SOLVER);
    s.expectWalled();
    expect(authored.candidate).toBeNull();

    // Once the session has finished on such a check it is put to the whole record, and by then
    // nothing is sent.
    const left = setup([propose({ code: keeping.replace("THROWS", ""), controls: REJECTS }), finish]);
    rmSync(join(scratch, "stash"));
    const done = await authorRule({ ...left.request, verifier: cellVerifier });
    expect(done.candidate?.interference).toMatchObject({ applied: 5, refused: 2, stale: 1 });
    expect(readFileSync(join(scratch, "stash"), "utf8")).toContain(SOLVER);
    expect(left.sent).toHaveLength(2);
    left.expectWalled();
  });

  it("leaves no candidate whose check program is not the one the gates ran", async () => {
    // A verifier with no wall, under which a check's run rewrites its own module where the host
    // built it: the candidate still only adds, and is not what was gated.
    const s = setup([propose(), finish]);
    const rewriting = (checks: string): Verifier => {
      const verify = verifierOver(checks);
      const built = join(modelOf(checks.replace(/-checks$/, "")), "added", "check-note.ts");
      return (given, submitted) => {
        if (submitted === SWEEP_ANSWER) writeFileSync(built, "export const check = () => true;\n");
        return verify(given, submitted);
      };
    };
    await expect(authorRule({ ...s.request, verifier: rewriting })).rejects.toThrow(
      "is not the contract and the check program the gates ran",
    );
    expect(s.gates()).toEqual([...HELD, [1, "interference", "reported", "record"]]);
    expect(s.of("rule.candidate")).toEqual([]);
    expect(s.of(FINISHED)[0]).toMatchObject({
      ended: "crashed",
      candidate: null,
      unfinished: "check-note",
    });
    expect(readdirSync(s.candidates)).toEqual([]);
  });

  it("ends crashed, at its wall or killed with nothing kept, and gates the addition in flight to its end", async () => {
    // The provider fails the turn after an addition held.
    const limit = "You have hit your session limit";
    const failed = setup([propose(), fauxAssistantMessage("", { stopReason: "error", errorMessage: limit })]);
    expect(await authorRule(failed.request)).toEqual({ ended: "crashed", tries: 1, candidate: null });
    expect(failed.of(FINISHED)[0]).toMatchObject({
      ended: "crashed",
      crash: limit,
      candidate: null,
      unfinished: "check-note",
    });
    expect(readdirSync(failed.candidates)).toEqual([]);

    // The wall and a kill come while the verifier runs: the limits are read between calls.
    const slow = (checks: string): Verifier => {
      const verify = verifierOver(checks);
      return async (given, submitted) => {
        await Bun.sleep(40);
        return verify(given, submitted);
      };
    };
    const walled = setup([propose(), finish]);
    const atWall = await authorRule({
      ...walled.request,
      verifier: slow,
      limits: { ...LIMITS, wallSeconds: 0.1 },
    });
    expect(atWall).toEqual({ ended: "wall", tries: 1, candidate: null });
    expect(walled.gates()).toEqual(HELD);
    expect(walled.sent).toHaveLength(1);
    expect(walled.of(FINISHED)[0]).toMatchObject({ ended: "wall", unfinished: "check-note" });
    // The try was gated to its end before the session's record was written, and nothing follows it.
    await Bun.sleep(100);
    expect(read(walled.log).at(-1)?.kind).toBe(FINISHED);

    const stopped = setup([propose(), finish]);
    const kill = new AbortController();
    setTimeout(() => kill.abort(), 100);
    const killed = await authorRule({ ...stopped.request, verifier: slow, kill: kill.signal });
    expect(killed).toEqual({ ended: "killed", tries: 1, candidate: null });
    expect(stopped.of(FINISHED)[0]).toMatchObject({ ended: "killed", unfinished: "check-note" });
    expect(readdirSync(stopped.candidates)).toEqual([]);
  });

  it("takes no addition of more controls than it will run", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      noted("x-1-001", "reject", `base ${String(index + 8)}`),
    );
    const s = setup([propose({ controls: many }), finish]);
    expect(await authorRule(s.request)).toEqual({ ended: "finished", tries: 0, candidate: null });
    expect(s.gates()).toEqual([]);
    expect(s.sent[1]).toContain("controls: must not have more than 24 items");
  });

  it("starts under no id that cannot name a directory, and over no candidate already there", async () => {
    const s = setup([finish]);
    await expect(authorRule({ ...s.request, id: "../r-1" })).rejects.toThrow("is not a safe single path");
    mkdirSync(join(s.candidates, "r-1"), { recursive: true });
    await expect(authorRule(s.request)).rejects.toThrow("is there already, and no session of this log");
    // Neither left a line in the log or took a turn.
    expect(s.of("rule.started")).toEqual([]);
    expect(s.sent).toEqual([]);
  });

  it("runs its addition as the verifier does, each check in a process and a cell of its own", async () => {
    const s = setup([propose(), finish]);
    const authored = await authorRule({ ...s.request, verifier: cellVerifier });
    expect(s.gates()).toEqual([...HELD, [1, "interference", "reported", "record"]]);
    expect(authored.candidate?.interference).toMatchObject({
      applied: 4,
      refused: 2,
      unrunnable: 0,
      stale: 1,
      reading: "refuses-some",
    });
  });

  it("ends when the verifier cannot decide, and starts under no id twice and over no pack but the campaign's", async () => {
    const s = setup([propose(), finish]);
    const undecided: Verifier = async () => ({ kind: "non-result", reason: "no wall" });
    await expect(authorRule({ ...s.request, verifier: () => undecided })).rejects.toThrow(
      "the verifier could not decide x-1-001, so the run stops",
    );
    expect(s.of(FINISHED)[0]).toMatchObject({ ended: "crashed", candidate: null });
    expect(JSON.stringify(s.of("rule.call"))).toContain("The host could not go on");
    expect(s.sent).toHaveLength(1);
    expect(existsSync(join(s.candidates, "r-1.tries"))).toBe(false);
    await expect(authorRule(s.request)).rejects.toThrow("session r-1 is in the log already");

    // A pack whose check program is not the one the campaign runs under is no base for a proof.
    const other = { ...s.request, id: "r-2", base: { ...s.request.base, checks: "another" } };
    await expect(authorRule(other)).rejects.toThrow("is not the pack this campaign runs under");
    expect(s.of("rule.started")).toHaveLength(1);
    expect(existsSync(join(s.candidates, "r-2.tries"))).toBe(false);
  });
});

describe("the proof that a candidate only adds", () => {
  const ADDITION: Addition = {
    rule: RULE,
    check: {
      id: "check-note",
      assertion: CHECK.assertion,
      families: "all",
      cites: [],
      artifactPaths: ["$.note"],
      publicInputPaths: ["$.base"],
      tools: [],
    },
    code: NOTE_CODE,
  };
  /** A pack and a candidate of it, the candidate's brief rewritten by `edit` where one is given. */
  function made(edit?: (brief: LooseBrief) => void) {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-rule-proof-")));
    scratches.push(scratch);
    const pack = layPack(scratch);
    const candidate = join(scratch, "candidate");
    writeCandidate(pack, ADDITION, candidate);
    const model = modelOf(candidate);
    if (edit !== undefined) {
      const brief = JSON.parse(readFileSync(join(model, "brief.json"), "utf8"));
      edit(brief);
      writeFileSync(join(model, "brief.json"), JSON.stringify(brief));
    }
    return { scratch, pack, candidate, model };
  }
  const faultsOf = (found: ReturnType<typeof additive>) => ("faults" in found ? found.faults : []);
  /** A pack, changed by `lay` where one is given, and the candidate the host builds of it from
   *  the addition with `over` in it: what the proof finds, or what the host refused to write. */
  function built(
    over: { rule?: string; check?: string; code?: string; families?: readonly string[] },
    lay?: (model: string) => void,
  ) {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-rule-proof-")));
    scratches.push(scratch);
    const pack = layPack(scratch);
    lay?.(modelOf(pack));
    const candidate = join(scratch, "candidate");
    const addition: Addition = {
      rule: { ...RULE, id: over.rule ?? RULE.id },
      check: { ...ADDITION.check, id: over.check ?? "check-note", families: over.families ?? "all" },
      code: over.code ?? NOTE_CODE,
    };
    let found: ReturnType<typeof additive>;
    try {
      writeCandidate(pack, addition, candidate);
      found = additive(pack, candidate, "model-only");
    } catch (error) {
      found = { faults: [errorMessage(error)] };
    }
    return { scratch, pack, candidate, found };
  }

  it("holds for what the host built, and names what it found added", () => {
    const { pack, candidate } = made();
    const found = additive(pack, candidate, "model-only");
    expect(found).toMatchObject({
      rule: RULE,
      check: { id: "check-note", assertion: CHECK.assertion, families: "all" },
    });
    // The candidate's public rules, the new one last: a private decision is not among them.
    expect("rules" in found ? found.rules.map(({ id }) => id) : []).toEqual(["R1", "R2", "R3"]);
  });

  it("refuses an edited existing check, in its code or in its row", () => {
    const code = made();
    writeFileSync(join(code.model, "evaluator.pack.ts"), EVALUATOR.replace('=== "N"', '!== ""'));
    expect(faultsOf(additive(code.pack, code.candidate, "model-only"))).toEqual([
      "the pack's evaluator.ts is not kept whole as evaluator.pack.ts",
    ]);
    // The whole program written afresh as one file is what an author with the pen would do.
    const whole = made();
    writeFileSync(join(whole.model, ENTRY), `${EVALUATOR}// and check-note inline\n`);
    expect(faultsOf(additive(whole.pack, whole.candidate, "model-only"))).toEqual([
      "evaluator.ts is not the entry the host writes for check-note",
    ]);
    // The host's entry with one line more, which hands an existing check to other code.
    const shadowed = made();
    writeFileSync(
      join(shadowed.model, ENTRY),
      entryText(["check-note"]).replace("};", '  "check-unit": () => true,\n};'),
    );
    expect(faultsOf(additive(shadowed.pack, shadowed.candidate, "model-only"))).toEqual([
      "evaluator.ts is not the entry the host writes for check-note",
    ]);
    const helper = made();
    writeFileSync(join(helper.model, "reference", "model.ts"), "export const FACTOR = 7;\n");
    expect(faultsOf(additive(helper.pack, helper.candidate, "model-only"))).toEqual([
      "reference/model.ts is not the pack's own",
    ]);
    const row = made((brief) => {
      brief.truthChecks[0]!.citedDecisionIds = ["R2"];
    });
    expect(faultsOf(additive(row.pack, row.candidate, "model-only"))).toEqual([
      "truthChecks row 1 (check-product) is not the pack's own",
    ]);
  });

  it("refuses an edited or removed rule, task or control, and a file that is no part of one check", () => {
    const rule = made((brief) => {
      brief.ruleDecisions[1]!.statement = "The unit is the kilonewton.";
    });
    expect(faultsOf(additive(rule.pack, rule.candidate, "model-only"))).toEqual([
      "ruleDecisions row 2 (R2) is not the pack's own",
    ]);
    const removed = made((brief) => {
      brief.ruleDecisions.splice(2, 1);
      brief.truthChecks.splice(1, 1);
    });
    expect(faultsOf(additive(removed.pack, removed.candidate, "model-only"))).toEqual([
      "ruleDecisions holds 3 rows where the pack's 3 and one more were due",
      "ruleDecisions row 3 (P1) is not the pack's own",
      "truthChecks holds 2 rows where the pack's 2 and one more were due",
      "truthChecks row 2 (check-unit) is not the pack's own",
    ]);
    const battery = made();
    writeFileSync(join(battery.model, "tasks.json"), "[]");
    rmSync(join(battery.model, "controls.json"));
    writeFileSync(join(battery.model, "notes.ts"), "export {};\n");
    expect(faultsOf(additive(battery.pack, battery.candidate, "model-only"))).toEqual([
      "controls.json is not the pack's own",
      "tasks.json is not the pack's own",
      "notes.ts is no part of the pack or of one check",
    ]);
    const domain = made((brief) => {
      brief.domain = "Another";
    });
    expect(faultsOf(additive(domain.pack, domain.candidate, "model-only"))).toEqual([
      "brief.json differs from the pack's outside its rules and checks",
    ]);
  });

  it("refuses a new check that cites no new rule, asks for a hidden value, or reads nothing", () => {
    const uncited = made((brief) => {
      brief.truthChecks[2]!.citedDecisionIds = ["R1", "P1"];
    });
    expect(faultsOf(additive(uncited.pack, uncited.candidate, "model-only"))).toEqual([
      "the new check check-note does not cite the new rule R3",
      "the new check cites P1, which is no public rule",
    ]);
    const hidden = made((brief) => {
      const row = brief.truthChecks[2]!.execution;
      row.hidden = "required";
      row.artifactPaths = [];
      row.publicInputPaths = ["base"];
      row.families = [];
    });
    expect(faultsOf(additive(hidden.pack, hidden.candidate, "model-only"))).toEqual([
      "the new check names no family: `all`, or a list of families",
      "the new check reads no path of the answer",
      "base is not a path as the checks spell theirs",
      "the new check asks for a hidden value, which no task holds",
    ]);
    const secret = made((brief) => {
      brief.ruleDecisions[3]!.visibility = "private";
    });
    expect(faultsOf(additive(secret.pack, secret.candidate, "model-only"))).toEqual([
      "the new rule is not a public rule with a statement",
    ]);
  });

  it("refuses an id that is taken, differs from one only by case, or is no single word", () => {
    const faults = (over: Parameters<typeof built>[0]) => faultsOf(built(over).found);
    // A check under an existing id would stand in the entry where that check stood.
    for (const id of ["check-unit", "Check-Unit"]) {
      expect(faults({ check: id })).toEqual([
        `the new check's id is not a new one that can name its module: ${id}`,
      ]);
    }
    // A private decision's id is taken too: a citation must mean one requirement.
    for (const id of ["R1", "r1", "p1"]) {
      expect(faults({ rule: id })).toEqual([`the new rule's id is not a new one: ${id}`]);
    }
    // An id is shown to a solver before its statement, a line a rule: this one would read as two.
    expect(faults({ rule: "R3\n- R4: Any unit will do" })).toEqual([
      String.raw`the new rule's id is not one word of letters, digits, dots, dashes and underscores: "R3\n- R4: Any unit will do"`,
    ]);
    expect(faults({ rule: "R1 " })[0]).toContain("is not one word of letters");
    // A check's id names a file, and one that names another place is refused before anything is
    // written: the pack's helper it points at is not copied, let alone written over.
    for (const id of ["../reference/model", "reference/model", "..", "__proto__", ""]) {
      const { found, candidate } = built({ check: id });
      expect(faultsOf(found)).toEqual([
        `check id ${JSON.stringify(id)} is not a safe single path segment — use [A-Za-z0-9._-], starting alphanumeric, no ".."`,
      ]);
      expect(existsSync(candidate)).toBe(false);
    }
  });

  it("writes over no file of the pack, and reads no link", () => {
    // A pack whose author keeps a directory of that name: the new module lands on its file.
    const own = built({}, (model) => {
      mkdirSync(join(model, "added"));
      writeFileSync(join(model, "added", "check-note.ts"), "export const TOLERANCE = 0;\n");
    });
    expect(faultsOf(own.found)).toEqual(["added/check-note.ts is not the pack's own"]);
    // A link would let the candidate's version and a cell's copy read bytes from elsewhere.
    const linked = made();
    symlinkSync(join(modelOf(linked.pack), "tasks.json"), join(linked.model, "added", "battery.ts"));
    expect(faultsOf(additive(linked.pack, linked.candidate, "model-only"))).toEqual([
      "the candidate does not read: the check program's added/battery.ts is neither a file nor a directory",
    ]);
  });

  it("moves no existing check from inside an added module, as the verifier runs each check", async () => {
    // A module that does what it can reach: writes over the pack's checks where it imported them,
    // changes a prototype every check shares, and rewrites the pack's evaluator and helper in its
    // cell. Its imports pass the scan, one of them because its specifier is computed.
    const hostile = [
      'import { checks } from "../evaluator.pack.ts";',
      'checks["check-unit"] = () => true;',
      'checks["check-product"] = () => true;',
      'Object.prototype.unit = "N";',
      'String.prototype.valueOf = () => "N";',
      'const fs = await import("node:" + "fs");',
      'fs.writeFileSync(new URL("../evaluator.pack.ts", import.meta.url), "export const checks = {};");',
      'fs.writeFileSync(new URL("../reference/model.ts", import.meta.url), "export const FACTOR = 0;");',
      "export const check = () => true;",
      "",
    ].join("\n");
    const { scratch, candidate, found } = built({ code: hostile });
    expect(faultsOf(found)).toEqual([]);
    const staged = checkProgram(candidate, join(scratch, "staged"));
    const before = checkProgramVersion(staged);
    const verify = cellVerifier(staged);
    // Every verdict here ran the hostile check too, in its own process, before or after the others.
    expect(await verify(PACKED, answer(12, "x", "kg"))).toEqual({ kind: "fail", blocking: ["check-unit"] });
    expect(await verify(PACKED, answer(13, "x"))).toEqual({ kind: "fail", blocking: ["check-product"] });
    expect(await verify(PACKED, answer(12, "x"))).toEqual({ kind: "pass" });
    expect(await verify(PACKED, answer(12, "x", "kg"))).toEqual({ kind: "fail", blocking: ["check-unit"] });
    expect(checkProgramVersion(staged)).toEqual(before);

    // A module may call an existing check, and that moves the added check's verdict alone: on the
    // added check's own projection of the answer, which holds no unit, check-unit says no.
    const wrapping = [
      'import { checks } from "../evaluator.pack.ts";',
      'export const check = (request) => checks["check-unit"](request);',
      "",
    ].join("\n");
    const wrapped = built({ code: wrapping });
    expect(faultsOf(wrapped.found)).toEqual([]);
    const contrary = cellVerifier(checkProgram(wrapped.candidate, join(wrapped.scratch, "staged")));
    expect(await contrary(PACKED, answer(12, "x"))).toEqual({ kind: "fail", blocking: ["check-note"] });

    // A module that does not load is its own check's fault. Where its check does not apply, the
    // program decides as the pack's did; loaded with the entry, it would have left no check able
    // to run and every verdict a non-result.
    const broken = 'throw new Error("at load");\nexport const check = () => true;\n';
    const all = built({ code: broken });
    const stopped = cellVerifier(checkProgram(all.candidate, join(all.scratch, "staged")));
    expect(await stopped(PACKED, answer(12, "x"))).toEqual({
      kind: "faulty",
      check: "check-note",
      reason: "the check threw: at load",
    });
    const elsewhere = built({ code: broken, families: ["elsewhere"] });
    const apart = cellVerifier(checkProgram(elsewhere.candidate, join(elsewhere.scratch, "staged")));
    expect(await apart(PACKED, answer(12, "x"))).toEqual({ kind: "pass" });
    expect(await apart(PACKED, answer(12, "x", "kg"))).toEqual({ kind: "fail", blocking: ["check-unit"] });
  });

  it("takes a second addition over the first, each module apart, and one addition at a time", () => {
    const first = made();
    const second = join(first.scratch, "second");
    const next: Addition = {
      rule: { id: "R4", statement: "The note is at most forty characters." },
      check: { ...ADDITION.check, id: "check-length", publicInputPaths: [], cites: ["R3"] },
      code: "export const check = ({ artifact }) => artifact.note.length <= 40;\n",
    };
    writeCandidate(first.candidate, next, second);
    expect(additive(first.candidate, second, "model-only")).toMatchObject({
      rule: { id: "R4" },
      check: { id: "check-length" },
    });
    expect(readFileSync(join(modelOf(second), ENTRY), "utf8")).toBe(
      entryText(["check-note", "check-length"]),
    );
    // Two rules at once are not one addition, whatever each is.
    expect(faultsOf(additive(first.pack, second, "model-only"))).toEqual([
      "ruleDecisions holds 5 rows where the pack's 3 and one more were due",
      "truthChecks holds 4 rows where the pack's 2 and one more were due",
    ]);
    // An addition that leans on another could not be withdrawn alone.
    const leaning = join(first.scratch, "leaning");
    writeCandidate(first.candidate, { ...next, code: `import "./check-note.ts";\n${next.code}` }, leaning);
    expect(faultsOf(additive(first.candidate, leaning, "model-only"))).toEqual([
      "added/check-length.ts imports ./check-note.ts, which is not a file of the pack's own check program",
    ]);
    // A pack that holds evaluator.pack.ts under an entry the host did not write is in neither form.
    writeFileSync(join(modelOf(first.candidate), ENTRY), EVALUATOR);
    expect(faultsOf(additive(first.candidate, second, "model-only"))).toEqual([
      "the pack cannot take an addition: evaluator.ts is not the entry the host writes over evaluator.pack.ts",
    ]);
  });

  it("holds the tool tree to the pack's own, once the candidate has one", () => {
    const { pack, candidate } = made();
    expect(faultsOf(additive(pack, candidate, "with-tools"))).toEqual([
      ".toolchain is not the pack's own tool tree",
    ]);
    copyTools(pack, candidate);
    expect(faultsOf(additive(pack, candidate, "with-tools"))).toEqual([]);
    writeFileSync(join(candidate, ".toolchain", "bin", "tool"), "#!/bin/sh\nexit 1\n");
    expect(faultsOf(additive(pack, candidate, "with-tools"))).toEqual([
      ".toolchain is not the pack's own tool tree",
    ]);
  });
});

describe("the interference reading", () => {
  const ADDED: Added = {
    rule: RULE,
    check: { id: "check-note", assertion: "", families: ["fixture"] },
    rules: [],
  };
  const stored = (taskId: string, note: string, from: Stored["from"] = "solve"): Stored => ({
    task: task(taskId, 2),
    answer: answer(12, note),
    from,
  });
  const PASS: Verdict = { kind: "pass" };
  const REFUSED: Verdict = { kind: "fail", blocking: ["check-note"] };
  const graded = (...verdicts: Verdict[]) =>
    verdicts.map((verdict, index) => ({ stored: stored(`t-${String(index + 1)}`, "n"), verdict }));

  it("reads each accepted answer once, of the tasks the check applies to", () => {
    const elsewhere: Stored = { ...stored("t-9", "a"), task: { ...task("t-9", 2), family: "other" } };
    const chosen = interfering(ADDED, [
      stored("t-1", "a", "witness"),
      stored("t-1", "a"),
      stored("t-1", "b"),
      elsewhere,
    ]);
    expect(chosen.map(({ task: of, from }) => `${of.taskId} ${from}`)).toEqual(["t-1 witness", "t-1 solve"]);
  });

  it("says which of four readings the counts are, and when the reading alone is a reason to doubt", () => {
    expect(interference("check-note", graded(PASS, PASS), [])).toMatchObject({
      applied: 2,
      refused: 0,
      reading: "refuses-none",
      suspect: false,
      tasks: [],
    });
    expect(interference("check-note", graded(PASS, REFUSED), [])).toMatchObject({
      reading: "refuses-some",
      suspect: false,
      tasks: [{ taskId: "t-2", refused: 1, unrunnable: 0, kept: 0 }],
    });
    expect(interference("check-note", graded(REFUSED, REFUSED), [])).toMatchObject({
      applied: 2,
      refused: 2,
      reading: "refuses-all",
      suspect: true,
    });
    // The answers its own controls start from pass by the controls gate, and are no part of "all".
    const own = { taskId: "t-1", answer: answer(12, "n"), refusedBy: null };
    expect(interference("check-note", graded(PASS, REFUSED), [own])).toMatchObject({
      applied: 1,
      refused: 1,
      reading: "refuses-all",
      suspect: true,
      tasks: [{ taskId: "t-2", refused: 1, unrunnable: 0, kept: 0 }],
    });
    expect(interference("check-note", graded(PASS), [own])).toMatchObject({ applied: 0, reading: "unread" });
  });

  it("counts apart an answer the check cannot run on, and one an existing check no longer accepts", () => {
    const threw: Verdict = { kind: "faulty", check: "check-note", reason: "threw" };
    const stale: Verdict = { kind: "fail", blocking: ["check-unit"] };
    const found = interference("check-note", graded(PASS, threw, stale, stale), []);
    expect(found).toMatchObject({
      applied: 2,
      refused: 0,
      unrunnable: 1,
      stale: 2,
      reading: "refuses-some",
      suspect: true,
      tasks: [{ taskId: "t-2", refused: 0, unrunnable: 1, kept: 0 }],
    });
    expect(found.note).toContain("it could not run on 1 accepted answer on record");
  });

  it("holds a reject control to the new check alone", () => {
    const run = (name: string, verdict: Verdict): ControlRun & NamedControl => ({
      name,
      taskId: "t-1",
      answer: null,
      refusedBy: "check-note",
      verdicts: [verdict, verdict],
    });
    expect(
      labelFaults("check-note", [
        run("control 1", REFUSED),
        run("control 2", { kind: "fail", blocking: ["check-unit", "check-note"] }),
        run("control 3", { kind: "faulty", check: "check-note", reason: "threw" }),
      ]),
    ).toEqual([
      [
        "also-refused",
        "control 2 was refused by check-unit as well as check-note: a reject control changes only what the new check judges",
      ],
      ["faulty", "control 3: check check-note could not run on it: threw"],
    ]);
  });
});

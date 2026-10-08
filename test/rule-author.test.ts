// One Rule Author session on the faux provider, over a pack on disk and a verifier with no wall: it
// loads the staged candidate program in this process and runs each applicable check on the
// projection the real verifier would hand it. What is under test is the host's side: the proof
// that a candidate only adds, each gate and what it refuses, the interference reading, what the
// session is and is not sent, and that a candidate is left only by a session that finished on one.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ControlRun } from "../src/kernel/acceptance.ts";
import { type Contract, contractHash } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import {
  applicableTruthChecks,
  checkEvaluationRequest,
  checkProgramVersion,
  readBrief,
  type Task,
  type Verdict,
  type Verifier,
} from "../src/kernel/verify.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
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
import { isBoolean, isFunction, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
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
import { authorRule, candidatesOf, type RuleRequest } from "../src/rules/session.ts";
import { storedIn } from "../tools/c/rule-author.ts";
import { checkProgram } from "../tools/m0/stored-sweep.ts";

/** Two things no Rule Author may be sent: the text of a measured solve's accepted answer, and the
 *  digest of the harness the campaign stands on. */
const SOLVER = "solver-canary-7f3a";
const HARNESS = "harness-canary-91c4";
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
const finish = call("finish", { note: "The note rule, from the fixture's own convention." });
const propose = (over: JsonObject = {}) =>
  call("propose_rule", { rule: RULE, check: CHECK, code: NOTE_CODE, controls: CONTROLS, ...over });

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
    const program = await import(join(checks, "evaluator.ts"));
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
  writeFileSync(join(model, "evaluator.ts"), EVALUATOR);
  writeFileSync(join(model, "reference", "model.ts"), "export const FACTOR = 6;\n");
  writeFileSync(join(model, "tasks.json"), JSON.stringify([PACKED]));
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({ accept: [{ taskId: "e-1", artifact: answer(12, "base 2", "kg") }], reject: [] }),
  );
  return pack;
}

/**
 * A scratch with a pack, a log and a session's request. The log holds three tasks a session wrote,
 * each past gate 4 on a stronger solve's answer, and two passes of the solver being measured, one
 * of which carries the canary. The pack's accept control has gone stale, and the stored sweep holds
 * one pass.
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
  record("verdict", { solve: "test-1", task: "x-1-001", answer: answer(42, SOLVER), kind: "pass" });
  record("verdict", { solve: "test-2", task: "x-1-003", answer: answer(30, " base 5"), kind: "pass" });
  // A fail is no accepted answer, and is read by no one here.
  record("verdict", { solve: "test-3", task: "x-1-003", answer: answer(1, SOLVER), kind: "fail" });
  const tasks = [PACKED, ...WRITTEN];
  const stored: Stored[] = [
    ...storedIn(read(log), tasks),
    { task: PACKED, answer: answer(12, "base 2", "kg"), from: "control" },
    { task: PACKED, answer: answer(12, "base 2"), from: "sweep" },
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
    standsOn: { harness: HARNESS, setting: "s1" },
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
  const gates = () => of("rule.gate").map(({ try: nth, gate, outcome }) => [nth, gate, outcome]);
  return { request, scratch, pack, log, candidates, sent, of, gates };
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
    expect(opening).toContain("- x-1-001 (family fixture): not yet measured");
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
    // The harness is named in the log, for whoever reads the session, and in nothing it was sent.
    for (const context of s.sent) {
      expect(context).not.toContain(SOLVER);
      expect(context).not.toContain(HARNESS);
    }
    expect(s.of("rule.started")[0]).toMatchObject({
      session: "r-1",
      standsOn: HARNESS,
      binding: { binds: "correctness-model" },
      base: s.request.base,
      checks: ["check-product", "check-unit"],
      witnessed: ["x-1-001", "x-1-002", "x-1-003"],
      stored: { witness: 3, solve: 2, control: 1, sweep: 1 },
    });
    expect(s.of("rule.finished")[0]).toMatchObject({ ended: "finished", tries: 0, candidate: null });
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
    expect(readFileSync(join(now, "evaluator.ts"), "utf8")).toBe(entryText(["check-note"]));
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

    // The four gates in order, and what each kept.
    expect(s.gates()).toEqual([
      [1, "shape", "passed"],
      [1, "controls", "passed"],
      [1, "determinism", "passed"],
      [1, "interference", "reported"],
    ]);
    const checker = {
      contract: contractHash({ ...CONTRACT, rules: [...RULES, row] }),
      checks: hashJsonValue(checkProgramVersion(checkProgram(dir, join(s.scratch, "left-checks")))),
    };
    const [proven, controlled, , interfered] = s.of("rule.gate");
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
    // The interference, beside the two answers the controls start from: one witness and one
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
    expect(candidatesOf(read(s.log))).toEqual([
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
    expect(s.of("rule.finished")[0]).toMatchObject({
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
    expect(s.sent.join("\n")).not.toContain(SOLVER);
    expect(JSON.stringify(s.of("rule.call"))).not.toContain(SOLVER);
    // Nothing but the candidate is left beside it.
    expect(existsSync(`${dir}.tries`)).toBe(false);
    // The candidate is a pack: staged like one, its program decides as the gates saw it decide.
    const verify = verifierOver(checkProgram(dir, join(s.scratch, "again")));
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
      [4, "interference", "reported"],
    ]);
    expect(authored).toMatchObject({ tries: 4, candidate: { check: "check-note" } });
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
    expect(cut.of("rule.finished")[0]).toMatchObject({ candidate: null, unfinished: "check-note" });
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
  });

  it("ends when the verifier cannot decide, and starts under no id twice and over no pack but the campaign's", async () => {
    const s = setup([propose(), finish]);
    const undecided: Verifier = async () => ({ kind: "non-result", reason: "no wall" });
    await expect(authorRule({ ...s.request, verifier: () => undecided })).rejects.toThrow(
      "the verifier could not decide x-1-001, so the run stops",
    );
    expect(s.of("rule.finished")[0]).toMatchObject({ ended: "crashed", candidate: null });
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
    writeFileSync(join(whole.model, "evaluator.ts"), `${EVALUATOR}// and check-note inline\n`);
    expect(faultsOf(additive(whole.pack, whole.candidate, "model-only"))).toEqual([
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
    expect(readFileSync(join(modelOf(second), "evaluator.ts"), "utf8")).toBe(
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
    writeFileSync(join(modelOf(first.candidate), "evaluator.ts"), EVALUATOR);
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

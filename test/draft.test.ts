// An exam drafted from a prompt: the shape the host holds a draft to before anything runs, the
// session that puts drafts to the host's reading (`src/examiner/draft.ts`), and that reading on a
// staged draft with the real verifier (`tools/d2/exam.ts`).

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { type Draft, draftExam, draftFaults, draftOf } from "../src/examiner/draft.ts";
import { type LogEvent, read } from "../src/kernel/log.ts";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { draftReading, stageExam } from "../tools/d2/exam.ts";
import { packControls, readPack, sweepResources } from "../tools/m0/stored-sweep.ts";

const TOOL_USE = { stopReason: "toolUse" } as const;
const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const BASES = [2, 3, 4];
const LIMITS = { wallSeconds: 60, turns: 10, tries: 3 };
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-")));
const product = (base: number) => ({ answer: String(base * 6) });
/** A sound draft: one rule, its check, three examples, an accept control each and one reject. */
const SOUND: Draft = {
  domain: "Fixture products",
  scope: "A task gives a base and asks for six times it.",
  conventions: "The answer is a decimal string without a sign.",
  rules: [
    { id: "R1", statement: "The answer is the base times six.", source: "A fixture: no field states it." },
  ],
  answerFormat: FORMAT,
  checks: [{ id: "check-product", rule: "R1", assertion: "The answer is six times the base." }],
  evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
  tasks: BASES.map((base) => ({ family: "fixture", publicInput: { base }, hidden: null })),
  accept: BASES.map((base, task) => ({ task, answer: product(base) })),
  reject: [{ task: 0, answer: { answer: "13" }, check: "check-product" }],
};
/** The draft as the tool takes it. */
const args = (draft: Draft): JsonObject => ({
  domain: draft.domain,
  scope: draft.scope,
  conventions: draft.conventions,
  rules: draft.rules.map((rule) => ({ ...rule })),
  answer_format: draft.answerFormat,
  checks: draft.checks.map((check) => ({ ...check })),
  evaluator: draft.evaluator,
  tasks: draft.tasks.map(({ family, publicInput, hidden }) => ({
    family,
    public_input: publicInput,
    hidden,
  })),
  accept_controls: draft.accept.map((control) => ({ ...control })),
  reject_controls: draft.reject.map((control) => ({ ...control })),
});

setDefaultTimeout(120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A model that makes `calls` in order, a turn each. */
function scripted(calls: readonly (readonly [string, JsonObject])[]) {
  const faux = fauxProvider({
    models: [
      { id: "script", contextWindow: 200_000, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
  });
  faux.setResponses(calls.map(([name, given]) => fauxAssistantMessage(fauxToolCall(name, given), TOOL_USE)));
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models };
}

const of = (log: string, kind: string): JsonObject[] =>
  read(log).flatMap((event: LogEvent) => (event.kind === kind ? [event.data] : []));
/** The lines of what a tool call returned. */
const lines = (text: unknown): string[] => (isString(text) ? text.split("\n") : []);

describe("the shape of a draft", () => {
  it("holds a sound draft to nothing", () => {
    expect(draftFaults(SOUND)).toEqual([]);
  });

  it("says an answer format that is no schema of an object first, and alone", () => {
    expect(draftFaults({ ...SOUND, answerFormat: "a string", rules: [] })).toEqual([
      "the answer format is not a JSON Schema of type object: a solver's answer is one JSON object, which the schema describes",
    ]);
  });

  it("holds each rule to a source and to one check, and each check to a rule and a place in the program", () => {
    const rules = [...SOUND.rules, { id: "R2", statement: "The answer has no leading zero.", source: " " }];
    expect(draftFaults({ ...SOUND, rules })).toEqual([
      "rule R2 names no source: the standard, manual or text that states it",
      "rule R2 has 0 checks, and each rule has one",
    ]);
    const stray = [...SOUND.checks, { id: "check-zero", rule: "R9", assertion: "No leading zero." }];
    expect(draftFaults({ ...SOUND, checks: stray })).toEqual([
      "check check-zero enforces R9, and the draft holds no such rule",
      "the check program names no check-zero: `checks` holds a function under each check's id",
      "check check-zero has no reject control: an answer that breaks its rule and names it",
    ]);
    const twice = [...SOUND.checks, { id: "check-product", rule: "R1", assertion: "Again." }];
    expect(draftFaults({ ...SOUND, checks: twice })).toEqual([
      "check-product is named twice: an id names one rule or one check",
      "rule R1 has 2 checks, and each rule has one",
    ]);
  });

  it("holds the examples to three, to one kind of hidden values, and to a control each way", () => {
    const two = { ...SOUND, tasks: SOUND.tasks.slice(0, 2), accept: SOUND.accept.slice(0, 2) };
    expect(draftFaults(two)).toEqual(["the draft holds 2 example tasks, and at least 3 are needed"]);
    const mixed = SOUND.tasks.map((task, index) => (index === 0 ? { ...task, hidden: { seed: 1 } } : task));
    expect(draftFaults({ ...SOUND, tasks: mixed })).toEqual([
      "some examples carry hidden values and some carry none: either every task has them or none does",
    ]);
    expect(draftFaults({ ...SOUND, accept: SOUND.accept.slice(1), reject: [] })).toEqual([
      "example 0 has no accept control: an answer to it that keeps every rule",
      "check check-product has no reject control: an answer that breaks its rule and names it",
    ]);
  });

  it("refuses a check program that reaches outside its request", () => {
    const reads = `import { readFileSync } from "node:fs";\n${SOUND.evaluator}`;
    expect(draftFaults({ ...SOUND, evaluator: reads })).toEqual([
      "the check program reaches for an import: a check computes from its request alone, so that one answer gets one verdict on every host",
    ]);
    const drifts = SOUND.evaluator.replace("=== String", "!== String(Math.random()) && String");
    expect(draftFaults({ ...SOUND, evaluator: drifts })).toEqual([
      "the check program reaches for a random number or the clock: a check computes from its request alone, so that one answer gets one verdict on every host",
    ]);
    // A date parsed from the answer is the request's own, and no clock.
    const dated = SOUND.evaluator.replace("=== String", "!== String(new Date(0).getTime() + 1) && String");
    expect(draftFaults({ ...SOUND, evaluator: dated })).toEqual([]);
  });

  it("refuses a control that names no example, no check, or an answer the format does not allow", () => {
    const reject = [
      { task: 7, answer: { answer: "13" }, check: "check-product" },
      { task: 0, answer: { answer: 13 }, check: "check-product" },
      { task: 0, answer: { answer: "13" }, check: "check-other" },
    ];
    const faults = draftFaults({ ...SOUND, reject });
    expect(faults).toHaveLength(3);
    expect(faults[0]).toBe("a reject control for check-product names example 7, and the examples are 0 to 2");
    expect(faults[1]).toStartWith(
      "a reject control for check-product of example 0 does not follow the answer format (",
    );
    expect(faults[2]).toBe("a reject control names check-other, and the draft holds no such check");
  });
});

describe("the session that drafts", () => {
  it("records the first draft that stands, whole, and ends there", async () => {
    const log = join(root, "stands.jsonl");
    const told: string[] = [];
    const drafted = await draftExam({
      id: "d-1",
      prompt: "A fixture.",
      // The first draft is told one fault, and the second none.
      reading: async () => {
        told.push("read");
        return told.length === 1 ? ["the accept control of ex-001 did not pass: fail check-product"] : [];
      },
      effort: "high",
      limits: LIMITS,
      log,
      ...scripted([
        ["draft_exam", args(SOUND)],
        ["draft_exam", args(SOUND)],
        ["finish", { note: "Never reached." }],
      ]),
    });
    expect(drafted).toEqual({ stands: true, tries: 2, ended: "stands" });
    expect(of(log, "draft.call").map(({ text }) => text)).toEqual([
      "The draft does not stand. 1 fault:\n- the accept control of ex-001 did not pass: fail check-product\nMend them and put the whole draft again. This session can put 2 more drafts.",
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    // The log holds the exam as it was drafted, and a campaign reads it from there.
    expect(draftOf(read(log))).toEqual(SOUND);
    expect(of(log, "draft.started")).toMatchObject([{ session: "d-1", prompt: "A fixture." }]);
    expect(of(log, "draft.finished")).toMatchObject([
      { session: "d-1", stands: true, tries: 2, crash: null },
    ]);
  });

  it("puts no more drafts than it has, and leaves no exam where none stood", async () => {
    const log = join(root, "falls.jsonl");
    const drafted = await draftExam({
      id: "d-1",
      prompt: "A fixture.",
      reading: async () => ["a fault"],
      effort: "high",
      limits: { ...LIMITS, tries: 2 },
      log,
      ...scripted([
        ["draft_exam", args(SOUND)],
        ["draft_exam", args(SOUND)],
        ["draft_exam", args(SOUND)],
        ["finish", { note: "No draft stood." }],
      ]),
    });
    expect(drafted).toEqual({ stands: false, tries: 2, ended: "finished" });
    expect(of(log, "draft.call").map(({ text, isError }) => [lines(text).at(-1), isError])).toEqual([
      ["Mend them and put the whole draft again. This session can put 1 more draft.", false],
      ["This session can put no further draft. Call finish.", false],
      ["This session can put no further draft. Call finish.", true],
      ["Finished.", false],
    ]);
    expect(draftOf(read(log))).toBeNull();
    // A session's id names one session.
    expect(
      draftExam({
        id: "d-1",
        prompt: "",
        reading: async () => [],
        effort: "high",
        limits: LIMITS,
        log,
        ...scripted([]),
      }),
    ).rejects.toThrow("session d-1 is in the log already");
  });
});

describe("a draft read without a model", () => {
  it("stages a draft as a pack a campaign reads, once", () => {
    const staged = stageExam(join(root, "staged"), SOUND);
    expect(stageExam(join(root, "staged"), SOUND)).toEqual(staged);
    const { brief, tasks } = readPack(staged.bundle);
    expect(tasks.map(({ taskId }) => taskId)).toEqual(["ex-001", "ex-002", "ex-003"]);
    expect(brief.ruleDecisions).toMatchObject([
      { id: "R1", source: SOUND.rules[0]?.source, visibility: "public" },
    ]);
    expect(packControls(staged.bundle)).toHaveLength(4);
    // A solver reads the scope and the conventions with the rules, and each rule's source.
    const resources = new Map(sweepResources(brief).map(({ name, content }) => [name, content]));
    expect(resources.get("public-scope")).toEqual([
      { domain: SOUND.domain, scope: SOUND.scope, conventions: SOUND.conventions },
    ]);
    expect(resources.get("public-rule-decisions")).toEqual([{ ...SOUND.rules[0], visibility: "public" }]);
    // The check program is staged without the tasks and the controls, which hold what is hidden.
    expect(readFileSync(join(staged.checks, "evaluator.ts"), "utf8")).toBe(SOUND.evaluator);
    expect(() => readFileSync(join(staged.checks, "controls.json"), "utf8")).toThrow();
  });

  it("finds no fault in a sound draft, and tells the faults of one whose check passes everything", async () => {
    expect(await draftReading(join(root, "read"), SOUND, 2)).toEqual([]);
    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    expect(await draftReading(join(root, "read"), lax, 2)).toEqual([
      "a reject control of ex-001 names check-product, which did not refuse it: pass",
      "check-product has refused nothing: no control and no stored answer",
      "the do-nothing answer was not rejected on ex-001: pass",
      "the do-nothing answer was not rejected on ex-002: pass",
      "the do-nothing answer was not rejected on ex-003: pass",
    ]);
  });

  it("tells a check program that does not load as a fault, and the shape before anything runs", async () => {
    const broken = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => req.artifact.answer === ;\n`,
    };
    // Which control met it first is the pool's order.
    const [fault, ...more] = await draftReading(join(root, "read"), broken, 2);
    expect(more).toEqual([]);
    expect(fault).toStartWith(
      "the check program could not be put to its controls: the verifier could not decide ex-00",
    );
    expect(fault).toEndWith("check-product: the check program did not load: Unexpected ;");
    expect(await draftReading(join(root, "read"), { ...SOUND, reject: [] }, 2)).toEqual([
      "check check-product has no reject control: an answer that breaks its rule and names it",
    ]);
  });
});

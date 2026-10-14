// An exam drafted from a prompt: the shape the host holds a draft to before anything runs
// (`draftFaults`, `src/examiner/draft.ts`), which a drafting session reads before the host's own
// reading, and that reading on a staged draft with the real verifier (`tools/d2/exam.ts`). The
// session a draft is put in is `examine`'s, held in `test/examiner.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Draft, draftFaults, draftOf } from "../src/examiner/draft.ts";
import { examine } from "../src/examiner/session.ts";
import { append, read } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { draftReading, stagedExamOf, stageExam } from "../tools/d2/exam.ts";
import { packControls, readPack, sweepResources } from "../tools/m0/stored-sweep.ts";
import { drafted, finish, SOUND, seat, sweep } from "./helpers/examiner-seat.ts";

const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-")));

setDefaultTimeout(120_000);

afterAll(() => {
  sweep();
  rmSync(root, { recursive: true, force: true });
});

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

  it("holds a draft that declares an objective to a check program that exports one", () => {
    const objective = { quantity: "mass in kg", direction: "lower" } as const;
    expect(draftFaults({ ...SOUND, objective })).toEqual([
      "the draft declares an objective and the check program exports no `objective`: a function of the request that returns the quantity as a number",
    ]);
    const measured = `${SOUND.evaluator}\nexport const objective = (request) => request.artifact.mass;\n`;
    expect(draftFaults({ ...SOUND, objective, evaluator: measured })).toEqual([]);
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

  it("is read by the session before the host's reading, which a draft out of shape never reaches", async () => {
    const lone: Draft = { ...SOUND, accept: SOUND.accept.slice(1), reject: [] };
    const s = seat("draft", [drafted(lone), drafted(SOUND), finish]);
    const reached: Draft[] = [];
    const examined = await examine({
      ...s.request,
      reading: async (draft: Draft) => {
        reached.push(draft);
        return [];
      },
    });
    expect(examined).toMatchObject({ ended: "stands", puts: 2 });
    expect(reached).toEqual([SOUND]);
    expect(s.of("draft.call")[0]?.text).toBe(
      "The draft does not stand. 2 faults:\n- example 0 has no accept control: an answer to it that keeps every rule\n- check check-product has no reject control: an answer that breaks its rule and names it\nMend them and put the whole draft again. This session can put 3 more drafts.",
    );
    expect(draftOf(read(s.log))).toEqual(SOUND);
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

  it("tells a reader that writes nothing where a campaign staged the exam its log drafted", () => {
    const logged = (dir: string) => {
      mkdirSync(dir, { recursive: true });
      const log = join(dir, "log.jsonl");
      append(log, "exam.drafted", {
        session: "d-1",
        draft: parseJsonAs<JsonObject>(capturedJsonStringify(SOUND)),
      });
      return log;
    };
    // Staged by the campaign: the staged pack and checks. Never staged: refused, and not written.
    const campaign = join(root, "campaign");
    const log = logged(campaign);
    const staged = stageExam(campaign, SOUND);
    expect(stagedExamOf(log)).toEqual(staged);
    const unstaged = logged(join(root, "unstaged"));
    expect(() => stagedExamOf(unstaged)).toThrow("is not staged at");
    expect(existsSync(join(root, "unstaged", "exams"))).toBe(false);
    // A log that drafted nothing has a stored pack, and the reader says so with null.
    mkdirSync(join(root, "stored"), { recursive: true });
    const stored = join(root, "stored", "log.jsonl");
    append(stored, "contract.frozen", { contract: "c", checks: "k" });
    expect(stagedExamOf(stored)).toBeNull();
  });

  it("finds no fault in a sound draft, and tells the faults of one whose check passes everything", async () => {
    expect(await draftReading(join(root, "read"), SOUND, 2)).toEqual([]);
    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    expect(await draftReading(join(root, "read"), lax, 2)).toEqual([
      "a reject control of ex-001 names check-product, which did not refuse it: pass",
      "check-product has refused nothing in this reading",
      "the do-nothing answer was not rejected on ex-001: pass",
      "the do-nothing answer was not rejected on ex-002: pass",
      "the do-nothing answer was not rejected on ex-003: pass",
    ]);
  });

  it("tells a do-nothing answer that does not follow the format as a fault, with a check that passes everything", async () => {
    const digits = { ...FORMAT, properties: { answer: { type: "string", pattern: "^[0-9]+$" } } };
    const lax = {
      ...SOUND,
      answerFormat: digits,
      evaluator: `export const checks = { "check-product": () => true };\n`,
    };
    expect(await draftReading(join(root, "read"), lax, 2)).toEqual([
      "a reject control of ex-001 names check-product, which did not refuse it: pass",
      "check-product has refused nothing in this reading",
      `the do-nothing answer {"answer":""} does not follow the answer format (Validation failed for tool "answer":\n  - answer: must match pattern "^[0-9]+$"), so no check was seen to refuse it: the host builds it from the schema's types, required properties, minimums, least lengths and counts, first enumerated or constant values and first choices, and reads no other keyword`,
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

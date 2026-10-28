// An exam drafted from a prompt: the shape the host holds a draft to before anything runs
// (`draftFaults`, `src/examiner/draft.ts`), which a drafting session reads before the host's own
// reading, and that reading on a staged draft with the real verifier (`tools/d2/exam.ts`). The
// session a draft is put in is `examine`'s, held in `test/examiner.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Draft, draftFaults, draftOf, type Measured } from "../src/examiner/draft.ts";
import { examine } from "../src/examiner/session.ts";
import { append, read } from "../src/kernel/log.ts";
import { examinerSessions } from "../src/kernel/solves.ts";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { draftReading, stageExam } from "../tools/d2/exam.ts";
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
    // The refusal carries each of the draft's faults and the puts it has left.
    const told = s.of("draft.call")[0]?.text;
    const faults = draftFaults(lone);
    expect(faults).toHaveLength(2);
    for (const fault of faults) expect(told).toContain(`- ${fault}`);
    expect(told).toContain("3 more drafts");
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

  it("finds no fault in a sound draft, and tells the faults of one whose check passes everything", async () => {
    expect(await draftReading(join(root, "read"), SOUND, 2)).toEqual([]);
    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    expect(await draftReading(join(root, "read"), lax, 2)).toEqual([
      "a reject control of ex-001 names check-product, which did not refuse it: pass",
      "check-product has refused nothing in this reading",
      "the do-nothing answer was not rejected on ex-001: pass",
      "the do-nothing answer was not rejected on ex-002: pass",
      "the do-nothing answer was not rejected on ex-003: pass",
      "the answer's field answer moved no check's verdict and no objective when changed on an accept control: check what it says, or drop it from the answer format",
    ]);
  });

  it("tells a field of the answer that no check reads, and leaves one the format allows no change of", async () => {
    const noted = (format: JsonObject) => ({
      ...SOUND,
      answerFormat: { ...FORMAT, properties: { ...FORMAT.properties, note: format } },
      accept: [2, 3, 4].map((base, task) => ({
        task,
        answer: { answer: String(base * 6), note: "six times" },
      })),
    });
    expect(await draftReading(join(root, "read"), noted({ type: "string" }), 2)).toEqual([
      "the answer's field note moved no check's verdict and no objective when changed on an accept control: check what it says, or drop it from the answer format",
    ]);
    expect(await draftReading(join(root, "read"), noted({ const: "six times" }), 2)).toEqual([]);
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

describe("a draft measured before it stands", () => {
  const MEASURED = { budget: { modelTurns: 20, minutes: 30 }, examples: ["seen 0", "seen 1", "seen 2"] };
  const REVISED: Draft = { ...SOUND, domain: "Fixture products, revised" };

  /** A drafting session over `puts` whose measure is `measure`, counting the drafts it measures. */
  async function measuredSession(puts: readonly Draft[], measure: Measured | null, limit = puts.length) {
    const s = seat("draft", [...puts.map(drafted), finish]);
    const asked: Draft[] = [];
    const examined = await examine({
      ...s.request,
      limits: { ...s.request.limits, puts: limit },
      measure: async (draft: Draft) => {
        asked.push(draft);
        return measure;
      },
    });
    return { examined, asked, said: s.of("draft.call").map(({ text }) => text), log: s.log };
  }

  it("tells the measure of a draft with no fault, and stands the same draft put again", async () => {
    const { examined, asked, said, log } = await measuredSession([SOUND, SOUND], MEASURED, 3);
    expect(examined).toMatchObject({ ended: "stands", puts: 2 });
    expect(asked).toEqual([SOUND]);
    // The budget and one line an example, and the draft is not yet the exam.
    expect(said[0]).toContain("20 turns");
    expect(said[0]).toContain("30 minutes");
    for (const line of MEASURED.examples) expect(said[0]).toContain(line);
    expect(said[0]).toContain("2 more drafts");
    expect(draftOf(read(log))).toEqual(SOUND);
  });

  it("measures a revised draft in turn, and stands the last put unmeasured", async () => {
    const { examined, asked, log } = await measuredSession([SOUND, REVISED, SOUND], MEASURED);
    expect(examined).toMatchObject({ ended: "stands", puts: 3 });
    expect(asked).toEqual([SOUND, REVISED]);
    expect(draftOf(read(log))).toEqual(SOUND);
  });

  it("counts the solves a drafting session asks for as the Examiner's, as a writing session's", () => {
    const log = join(root, "sessions.jsonl");
    append(log, "draft.started", { session: "d-1" });
    append(log, "exam.started", { session: "x-1" });
    append(log, "build.started", { session: "b-1" });
    expect(examinerSessions(read(log))).toEqual(new Set(["d-1", "x-1"]));
  });
});

// An exam drafted from a prompt: the shape the host holds a draft to before anything runs
// (`draftFaults`, `src/examiner/draft.ts`), which a drafting session reads before the host's own
// reading, that reading on a staged draft with the real verifier (`tools/d2/exam.ts`), and the
// campaign's end once its drafts are spent. The session a draft is put in is `examine`'s, held in
// `test/examiner.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { decide } from "../src/campaign/decide.ts";
import { type Draft, draftFaults, draftOf } from "../src/examiner/draft.ts";
import { examine, type Session } from "../src/examiner/session.ts";
import { append, read } from "../src/kernel/log.ts";
import { examinerSessions, solvesIn } from "../src/kernel/solves.ts";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { draftCommand } from "../tools/d1b/draft.ts";
import { campaignLog } from "../tools/d2/campaign.ts";
import { draftReading, stageExam } from "../tools/d2/exam.ts";
import { packControls, readPack, sweepResources } from "../tools/m0/stored-sweep.ts";
import { call, draftArgs, drafted, finish, NOTE, SOUND, seat, sweep } from "./helpers/examiner-seat.ts";
import { scriptedModel } from "./helpers/fixture-pack.ts";

const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-")));
const STEM = `test-draft-${String(runtimeProcess.pid)}`;
const SOLVER = "claude/claude-opus-5-5";
const campaigns: string[] = [];
const OBJECTIVE = { quantity: "mass in kg", direction: "lower" } as const;
// The sound draft with no decision on the objective, and with a quantity in place of its reason.
const { unmeasured: _reason, ...SILENT } = SOUND;
const MEASURED: Draft = {
  ...SILENT,
  objective: OBJECTIVE,
  evaluator: `${SOUND.evaluator}\nexport const objective = () => 1;`,
};

setDefaultTimeout(120_000);

afterAll(() => {
  sweep();
  rmSync(root, { recursive: true, force: true });
  for (const name of campaigns) rmSync(dirname(campaignLog(name)), { recursive: true, force: true });
});

describe("the shape of a draft", () => {
  it("rejects imports or nondeterminism in the check program, while allowing input dates", () => {
    const importing = `import "node:fs";\n${SOUND.evaluator}`;
    const random = `${SOUND.evaluator}\nconst random = Math.random();`;
    for (const [evaluator, fact] of [
      [importing, "import"],
      [random, "random number or the clock"],
    ] as const) {
      const faults = draftFaults({ ...SOUND, evaluator });
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain(fact);
    }
    const dated = `${SOUND.evaluator}\nconst date = new Date(0).getTime();`;
    for (const draft of [SOUND, MEASURED, { ...SOUND, evaluator: dated }]) {
      expect(draftFaults(draft)).toEqual([]);
    }
  });

  it("holds a draft to one decision on the objective: a quantity with its direction, or why there is none", () => {
    expect(draftFaults(SOUND)).toEqual([]);
    expect(draftFaults(MEASURED)).toEqual([]);
    // Neither form, and both, are the same one fault.
    for (const draft of [SILENT, { ...MEASURED, unmeasured: "every answer is as good" }]) {
      const faults = draftFaults(draft);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain("objective");
    }
  });

  it("refuses an accept control that carries a field the answer format does not name, wherever it sits", () => {
    const settings: JsonObject = { channel: 0, clk_div_q8: 1000 };
    const pwmAs = (pwm: JsonObject): JsonObject => ({
      ...FORMAT,
      properties: { ...FORMAT.properties, pwm: { type: ["object", "null"], ...pwm } },
    });
    const carrying = (answerFormat: JsonValue): Draft => ({
      ...SOUND,
      answerFormat,
      accept: [2, 3, 4].map((base, task) => ({ task, answer: { answer: String(base * 6), pwm: settings } })),
    });
    // An object with no properties, as esp32's `pwm` was, and one that names some of them.
    for (const format of [pwmAs({}), pwmAs({ properties: { channel: { type: "integer" } } })]) {
      const faults = draftFaults(carrying(format));
      expect(faults).toHaveLength(3);
      expect(faults[0]).toContain("$.pwm.clk_div_q8");
      expect(faults[0]).toContain("does not name");
    }
    // Named in the properties, under a typed map, in one branch of a choice, beside a choice that
    // only requires, under a condition, or behind a reference.
    const both = { channel: { type: "integer" }, clk_div_q8: { type: "integer" } };
    for (const format of [
      pwmAs({ properties: both }),
      pwmAs({ additionalProperties: { type: "integer" } }),
      pwmAs({ anyOf: [{ properties: { duty: {} } }, { properties: { channel: {}, clk_div_q8: {} } }] }),
      pwmAs({ properties: both, anyOf: [{ required: ["channel"] }, { required: ["clk_div_q8"] }] }),
      pwmAs({ dependentSchemas: { channel: { properties: both } } }),
      { ...FORMAT, properties: { ...FORMAT.properties, pwm: { $ref: "#/$defs/pwm" } }, $defs: { pwm: {} } },
    ]) {
      expect(draftFaults(carrying(format))).toEqual([]);
    }
    // A reject control may carry what it likes: the check it names is what refuses it.
    const reject = [{ task: 0, answer: { answer: "13", pwm: settings }, check: "check-product" }];
    expect(draftFaults({ ...SOUND, answerFormat: pwmAs({}), reject })).toEqual([]);
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
    expect(told).toMatch(/3.*drafts/u);
    expect(draftOf(read(s.log))).toEqual(SOUND);
  });

  it("spends no put on a draft whose objective, rule or family the schema refuses", async () => {
    const args = draftArgs(SOUND);
    const { objective: _objective, ...unsaid } = args;
    const blank = (draft: Draft): Draft => ({
      ...draft,
      rules: draft.rules.map((rule) => ({ ...rule, source: "  " })),
    });
    for (const refused of [
      unsaid,
      draftArgs(blank(SOUND)),
      draftArgs({ ...SOUND, tasks: SOUND.tasks.map((task) => ({ ...task, family: " " })) }),
    ]) {
      const s = seat("draft", [call("draft_exam", refused), drafted(SOUND), finish]);
      expect(await examine(s.request)).toMatchObject({ ended: "stands", puts: 1 });
      expect(s.of("draft.finished")).toMatchObject([{ stands: true, tries: 1 }]);
    }
  });

  it("tells a quantity without its direction as no decision, and the draft does not stand", async () => {
    const half = { ...draftArgs(SILENT), objective: { quantity: OBJECTIVE.quantity } };
    const s = seat("draft", [call("draft_exam", half), drafted(SOUND), finish]);
    expect(await examine(s.request)).toMatchObject({ ended: "stands", puts: 2 });
    expect(s.of("draft.call")[0]?.text).toContain("objective");
    expect(draftOf(read(s.log))).toEqual(SOUND);
  });

  it("reads a draft logged before the objective was required, with or without one", () => {
    for (const old of [SILENT, { ...SILENT, objective: OBJECTIVE }]) {
      const log = join(root, `old-${String(old.objective !== undefined)}.jsonl`);
      append(log, "exam.drafted", {
        session: "d-1",
        draft: parseJsonAs<JsonObject>(capturedJsonStringify(old)),
      });
      expect(draftOf(read(log))).toEqual(old);
    }
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

  it("stages the reason for no objective nowhere a solver, a Builder or a writing session reads", () => {
    const model = (draft: Draft) =>
      join(stageExam(join(root, "unmeasured"), draft).bundle, "correctness-model");
    const files = ["brief.json", "tasks.json", "controls.json", "evaluator.ts"];
    const [one, other] = [SOUND, { ...SOUND, unmeasured: "another reason" }].map((draft) =>
      files.map((file) => readFileSync(join(model(draft), file), "utf8")),
    );
    expect(one).toEqual(other);
    // A declared objective is staged, as before.
    expect(readPack(stageExam(join(root, "unmeasured"), MEASURED).bundle).brief.objective).toEqual(OBJECTIVE);
  });

  it("finds no fault in a sound draft, and tells the faults of one whose check passes everything", async () => {
    expect(await draftReading(join(root, "read"), SOUND, 2)).toEqual([]);
    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    const faults = await draftReading(join(root, "read"), lax, 2);
    expect(faults).toHaveLength(5);
    for (const [index, facts] of [
      ["ex-001", "check-product", "reject control", "pass"],
      ["check-product", "refused nothing"],
      ...["ex-001", "ex-002", "ex-003"].map((id) => [id, "do-nothing", "pass"]),
    ].entries()) {
      for (const fact of facts) expect(faults[index]).toContain(fact);
    }
  });

  it("gives each check a task's hidden values as the author wrote them", async () => {
    const hidden = {
      ...SOUND,
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * req.hidden.factor),\n};\n`,
      tasks: SOUND.tasks.map((task) => ({ ...task, hidden: { factor: 6 } })),
    };
    expect(await draftReading(join(root, "read"), hidden, 2)).toEqual([]);
  });

  it("tells a check program that does not load as a fault", async () => {
    const broken = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => req.artifact.answer === ;\n`,
    };
    // Which control met it first is the pool's order.
    const [fault, ...more] = await draftReading(join(root, "read"), broken, 2);
    expect(more).toEqual([]);
    for (const fact of ["ex-00", "check-product", "did not load", "Unexpected ;"]) {
      expect(fault).toContain(fact);
    }
  });

  it("tells a declared objective the program does not export, and a check it does not define", async () => {
    expect(await draftReading(join(root, "read"), MEASURED, 2)).toEqual([]);
    const unexported = await draftReading(join(root, "read"), { ...MEASURED, evaluator: SOUND.evaluator }, 2);
    expect(unexported.some((fault) => fault.includes("objective"))).toBe(true);
    const renamed = SOUND.evaluator.replace("check-product", "check-other");
    const undefinedCheck = await draftReading(join(root, "read"), { ...SOUND, evaluator: renamed }, 2);
    expect(undefinedCheck.length).toBeGreaterThan(0);
    expect(undefinedCheck.some((fault) => fault.includes("check-product"))).toBe(true);
  });
});

describe("a draft put to the host", () => {
  it("stands at its first put once it has no fault, with no solve of its examples", async () => {
    const s = seat("draft", [drafted(SOUND), finish]);
    expect(await examine(s.request)).toMatchObject({ ended: "stands", puts: 1 });
    expect(s.of("draft.call").map(({ text }) => text)).toEqual([
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    expect(draftOf(read(s.log))).toEqual(SOUND);
    expect(solvesIn(read(s.log))).toEqual([]);
    expect(s.of("draft.finished")).toMatchObject([{ ended: "stands", stands: true, tries: 1 }]);
    expect(s.of("draft.finished")[0]).not.toHaveProperty("measurement");
    // Its system prompt says what the host reads of a draft, and of no solve of it.
    expect(s.sent[0]).toContain("draft_exam puts a whole draft to the host");
    expect(s.sent[0]).not.toMatch(/starter harness|is then solved/u);
    // Its opening says the budget the exam's solves will be held to, as a writing session's does.
    expect(s.sent.join("\n")).toMatch(
      /held to 20 turns of the solver's own[^.]*, and 30 minutes, and a comparison solves each task 2 times under each harness\./u,
    );
  });

  it("counts a drafting session's solves as the Examiner's, as a writing session's", () => {
    const log = join(root, "sessions.jsonl");
    append(log, "draft.started", { session: "d-1" });
    append(log, "exam.started", { session: "x-1" });
    append(log, "build.started", { session: "b-1" });
    expect(examinerSessions(read(log))).toEqual(new Set(["d-1", "x-1"]));
  });
});

/** A campaign opened from a prompt, with no exam yet, under the repository as a campaign is. */
function opened(name: string): string[] {
  campaigns.push(name);
  const log = campaignLog(name);
  mkdirSync(dirname(log), { recursive: true });
  append(log, "campaign.opened", { prompt: "A fixture.", solver: { model: SOLVER, effort: "high" } });
  return ["--name", name, "--examiner", SOLVER, "--solver", SOLVER];
}

/** An Examiner that puts `drafts` in turn and then finishes. */
const putting =
  (...drafts: Draft[]): Session<"draft"> =>
  (request) =>
    examine({
      ...request,
      ...scriptedModel([
        ...drafts.map((draft) => ["draft_exam", draftArgs(draft)] as const),
        ["finish", { note: NOTE }],
      ]),
    });

describe("a campaign's drafts", () => {
  it("ends the campaign on its exam once three drafts in two sessions did not stand", async () => {
    const name = `${STEM}-spent`;
    const flags = opened(name);
    const log = campaignLog(name);
    const unformed: Draft = { ...SOUND, answerFormat: { type: "string" } };
    await draftCommand([...flags, "--session", "d-1"], putting(unformed));
    await draftCommand([...flags, "--session", "d-2"], putting(unformed, unformed));
    const events = read(log);
    expect(draftOf(events)).toBeNull();
    const plan = {
      sessions: 1,
      patience: 3,
      unprepared: false,
      practice: null,
      wanted: { target: 12, level: 0.02 },
      pastStop: null,
      prompted: true,
      admits: [],
      left: null,
      promotions: null,
    };
    expect(decide(events, plan)).toMatchObject({ move: "end", ending: "exam" });
    expect(decide(events, plan).why).toContain("3 drafts in 2 sessions did not stand");
  });
});

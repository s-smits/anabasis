// An exam drafted from a prompt: the shape the host holds a draft to before anything runs
// (`draftFaults`, `src/examiner/draft.ts`), which a drafting session reads before the host's own
// reading, that reading on a staged draft with the real verifier (`tools/d2/exam.ts`), and the
// starter's solves of a draft with no fault, by a scripted solver in the real wall
// (`starterFaults`, `tools/d1b/draft.ts`). The session a draft is put in is `examine`'s, held in
// `test/examiner.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { decide } from "../src/campaign/decide.ts";
import { type Draft, draftFaults, draftOf } from "../src/examiner/draft.ts";
import { examine, type Session } from "../src/examiner/session.ts";
import { append, read } from "../src/kernel/log.ts";
import { examinerSessions, solvesIn } from "../src/kernel/solves.ts";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { draftCommand } from "../tools/d1b/draft.ts";
import { campaignLog } from "../tools/d2/campaign.ts";
import { draftReading, stageExam } from "../tools/d2/exam.ts";
import type { Seated } from "../tools/d2/round.ts";
import { packControls, readPack, sweepResources } from "../tools/m0/stored-sweep.ts";
import { draftArgs, drafted, finish, NOTE, SOUND, seat, sweep } from "./helpers/examiner-seat.ts";
import { scriptedModel } from "./helpers/fixture-pack.ts";

const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-")));
const STEM = `test-draft-${String(runtimeProcess.pid)}`;
const SOLVER = "claude/claude-opus-5-5";
const campaigns: string[] = [];

setDefaultTimeout(120_000);

afterAll(() => {
  sweep();
  rmSync(root, { recursive: true, force: true });
  for (const name of campaigns) rmSync(dirname(campaignLog(name)), { recursive: true, force: true });
});

describe("the shape of a draft", () => {
  it("requires an objective export and rejects imports or nondeterminism, while allowing input dates", () => {
    const objective = { quantity: "mass in kg", direction: "lower" } as const;
    const importing = `import "node:fs";\n${SOUND.evaluator}`;
    const random = `${SOUND.evaluator}\nconst random = Math.random();`;
    for (const [draft, fact] of [
      [{ ...SOUND, objective }, "objective"],
      [{ ...SOUND, evaluator: importing }, "import"],
      [{ ...SOUND, evaluator: random }, "random number or the clock"],
    ] as const) {
      const faults = draftFaults(draft);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain(fact);
    }
    const measured = `${SOUND.evaluator}\nexport const objective = () => 1;`;
    const dated = `${SOUND.evaluator}\nconst date = new Date(0).getTime();`;
    for (const draft of [
      SOUND,
      { ...SOUND, objective, evaluator: measured },
      { ...SOUND, evaluator: dated },
    ]) {
      expect(draftFaults(draft)).toEqual([]);
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
        return { faults: [], notes: [] };
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
    expect(await draftReading(join(root, "read"), SOUND, 2)).toEqual({ faults: [], notes: [] });
    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    const { faults, notes } = await draftReading(join(root, "read"), lax, 2);
    expect(faults).toHaveLength(5);
    for (const [index, facts] of [
      ["ex-001", "check-product", "reject control", "pass"],
      ["check-product", "refused nothing"],
      ...["ex-001", "ex-002", "ex-003"].map((id) => [id, "do-nothing", "pass"]),
    ].entries()) {
      for (const fact of facts) expect(faults[index]).toContain(fact);
    }
    // A field no check reads is a note the draft stands with.
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/field answer.*no check's verdict and no objective/u);
  });

  it("gives each check a task's hidden values as the author wrote them", async () => {
    const hidden = {
      ...SOUND,
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * req.hidden.factor),\n};\n`,
      tasks: SOUND.tasks.map((task) => ({ ...task, hidden: { factor: 6 } })),
    };
    expect(await draftReading(join(root, "read"), hidden, 2)).toEqual({ faults: [], notes: [] });
  });

  it("notes a field of the answer that no check reads, and leaves one the format allows no change of", async () => {
    for (const [format, count] of [
      [{ type: "string" }, 1],
      [{ const: "six times" }, 0],
    ] as const) {
      const noted = {
        ...SOUND,
        answerFormat: { ...FORMAT, properties: { ...FORMAT.properties, note: format } },
        accept: [2, 3, 4].map((base, task) => ({
          task,
          answer: { answer: String(base * 6), note: "six times" },
        })),
      };
      const { faults, notes } = await draftReading(join(root, "read"), noted, 2);
      expect(faults).toEqual([]);
      expect(notes).toHaveLength(count);
      if (count === 1) expect(notes[0]).toContain("field note");
    }
  });

  it("tells a check program that does not load as a fault, and the shape before anything runs", async () => {
    const broken = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => req.artifact.answer === ;\n`,
    };
    // Which control met it first is the pool's order.
    const [fault, ...more] = (await draftReading(join(root, "read"), broken, 2)).faults;
    expect(more).toEqual([]);
    for (const fact of ["ex-00", "check-product", "did not load", "Unexpected ;"]) {
      expect(fault).toContain(fact);
    }
    const missing = (await draftReading(join(root, "read"), { ...SOUND, reject: [] }, 2)).faults;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("check-product");
    expect(missing[0]).toContain("no reject control");
  });
});

describe("a draft put to the host", () => {
  it("stands at its first put once it has no fault, with no solve of its examples where the caller seats no solver", async () => {
    const s = seat("draft", [drafted(SOUND), finish]);
    expect(await examine(s.request)).toMatchObject({ ended: "stands", puts: 1 });
    expect(s.of("draft.call").map(({ text }) => text)).toEqual([
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    expect(draftOf(read(s.log))).toEqual(SOUND);
    expect(solvesIn(read(s.log))).toEqual([]);
    expect(s.of("draft.finished")).toMatchObject([{ ended: "stands", stands: true, tries: 1 }]);
    expect(s.of("draft.finished")[0]).not.toHaveProperty("measurement");
    // Its system prompt says what the host reads of a draft, and that the starter solves it.
    expect(s.sent[0]).toContain("draft_exam puts a whole draft to the host");
    expect(s.sent[0]).toContain(
      "the starter harness, the one every campaign starts from, solves each example",
    );
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

/** The starter's solver, scripted in the real wall: the `nth` solve of an example writes the answer
 *  `answer(base, nth)` and submits it. */
const answering =
  (answer: (base: number, nth: number) => number): Seated =>
  (campaign) => {
    const nths = new Map<string, number>();
    return {
      builder: null,
      setting: campaign.setting({ ...campaign.test, ...scriptedModel([]) }),
      solve: async (task, harness, kill, comparison) => {
        const nth = nths.get(task.taskId) ?? 0;
        nths.set(task.taskId, nth + 1);
        const content = JSON.stringify({
          answer: String(answer(Number(asRecord(task.publicInput)?.base), nth)),
        });
        const by = scriptedModel(
          [
            ["write", { path: "answer.json", content }],
            ["submit", {}],
          ],
          campaign.limits.turns + 1,
        );
        return await campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill, comparison);
      },
    };
  };

/** What the drafting session was told of each draft it put. */
const told = (log: string) =>
  read(log).flatMap(({ kind, data }) => (kind === "draft.call" && isString(data.text) ? [data.text] : []));

describe("a draft the starter solves", () => {
  const sixfold = answering((base) => base * 6);

  it("does not stand where the starter answered every example on every solve, and three such drafts end the campaign on its exam", async () => {
    const name = `${STEM}-answered`;
    const flags = opened(name);
    const log = campaignLog(name);
    const first = await draftCommand([...flags, "--session", "d-1"], putting(SOUND), sixfold);
    expect(first).toMatchObject({ puts: 1 });
    expect(draftOf(read(log))).toBeNull();
    const refusal = told(log)[0] ?? "";
    expect(refusal).toContain("The draft does not stand. 1 fault:");
    expect(refusal).toContain("answered every example validly on every solve");
    for (const index of [0, 1, 2]) {
      expect(refusal).toMatch(
        new RegExp(`example ${String(index)}: 2 of 2 solves valid, taking \\d+, \\d+ model turns`, "u"),
      );
    }
    // Facts only: the refusal names no course for the next draft.
    expect(refusal).not.toMatch(/harder|should|try /u);
    // Each solve is the drafting session's: never scored and on no task's record.
    const solves = solvesIn(read(log));
    expect(solves).toHaveLength(6);
    expect(new Set(solves.map(({ start }) => start.comparison))).toEqual(new Set(["d-1"]));
    expect(examinerSessions(read(log))).toEqual(new Set(["d-1"]));

    // Two more drafts like it in a second session, and the campaign's drafts are spent.
    await draftCommand([...flags, "--session", "d-2"], putting(SOUND, SOUND), sixfold);
    const events = read(log);
    expect(draftOf(events)).toBeNull();
    expect(events.filter(({ kind }) => kind === "campaign.setting")).toHaveLength(1);
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

  it("stands where a solve of an example is rejected, unruled, or where two valid answers differ by the objective", async () => {
    const failing = `${STEM}-rejected`;
    const once = answering((base, nth) => (nth === 0 ? base * 7 : base * 6));
    expect(await draftCommand([...opened(failing), "--session", "d-1"], putting(SOUND), once)).toMatchObject({
      ended: "stands",
      puts: 1,
    });
    expect(draftOf(read(campaignLog(failing)))).toEqual(SOUND);
    expect(read(campaignLog(failing)).some(({ kind }) => kind.startsWith("referee."))).toBe(false);

    // Every answer a positive multiple of the base is valid, and the smaller is the better.
    const multiple: Draft = {
      ...SOUND,
      rules: [
        {
          ...SOUND.rules[0],
          id: "R1",
          statement: "The answer is a positive multiple of the base.",
          source: "A fixture.",
        },
      ],
      checks: [
        { id: "check-product", rule: "R1", assertion: "The answer is a positive multiple of the base." },
      ],
      objective: { quantity: "the answer as a number", direction: "lower" },
      evaluator: [
        "const of = (req) => Number(req.artifact.answer);",
        "export const checks = {",
        '  "check-product": (req) => Number.isInteger(of(req)) && of(req) > 0 && of(req) % req.publicTask.publicInput.base === 0,',
        "};",
        "export const objective = of;",
        "",
      ].join("\n"),
    };
    const gap = `${STEM}-gap`;
    const doubled = answering((base, nth) => base * 6 * (nth + 1));
    expect(
      await draftCommand([...opened(gap), "--session", "d-1"], putting(multiple), doubled),
    ).toMatchObject({
      ended: "stands",
      puts: 1,
    });
    // The same answer on every solve leaves no gap, and the draft does not stand.
    const level = `${STEM}-level`;
    expect(
      await draftCommand([...opened(level), "--session", "d-1"], putting(multiple), sixfold),
    ).toMatchObject({
      puts: 1,
    });
    expect(told(campaignLog(level))[0]).toContain("and no valid answer bettered another by the objective");
  });

  it("stands unsolved where the caller seats no solver", async () => {
    const name = `${STEM}-unseated`;
    expect(await draftCommand([...opened(name), "--session", "d-1"], putting(SOUND), null)).toMatchObject({
      ended: "stands",
    });
    const events = read(campaignLog(name));
    expect(draftOf(events)).toEqual(SOUND);
    expect(solvesIn(events)).toEqual([]);
  });
});

// The repair move's session (`src/examiner/repair.ts`): the Examiner repairs its check program or
// its controls between comparisons, each repair put to a reading the host makes without a model;
// what it is shown of the campaign, and what not; the shape a repair is held to before anything
// runs; and its walled home, which holds the exam's side of the campaign as files.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { type Repair, repairCheck, repairFaults, repairWalled } from "../src/examiner/repair.ts";
import type { Control } from "../src/kernel/acceptance.ts";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import { billedAll } from "../src/kernel/reports.ts";
import type { Task } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const TOOL_USE = { stopReason: "toolUse" } as const;
const LIMITS = { wallSeconds: 60, turns: 10, tries: 2 };
const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const SECRET = "the solver's own words, which no repair session reads";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-repair-")));
const checks = join(root, "checks");
const contract: Contract = {
  answerFormat: FORMAT,
  conventions: "The answer is a decimal string.",
  rules: [{ id: "R1", statement: "The answer is the base times six." }],
  scope: "A task gives a base and asks for six times it.",
};
const tasks: Task[] = [2, 3].map((base, index) => ({
  taskId: `t-${String(index + 1)}`,
  family: "fixture",
  publicInput: { base },
  hidden: { hiddenSeed: `seed-${String(base)}` },
}));
const controls: Control[] = [
  { taskId: "t-1", answer: { answer: "12" }, refusedBy: null },
  { taskId: "t-1", answer: { answer: "13" }, refusedBy: "check-product" },
];
const MENDED: Repair = {
  files: [
    {
      path: "evaluator.ts",
      content: `export const checks = { "check-product": (r) => r.artifact.answer === String(r.publicTask.publicInput.base * 6) };\n`,
    },
  ],
  controls,
};
const campaign = { checks, contract, controls, tasks };
mkdirSync(checks, { recursive: true });
writeFileSync(
  join(checks, "brief.json"),
  capturedJsonStringify({
    correctnessContract: "fixture",
    truthChecks: [
      {
        id: "check-product",
        citedDecisionIds: ["R1"],
        execution: {
          families: "all",
          artifactPaths: ["$"],
          publicInputPaths: ["$"],
          hidden: "required",
          evidence: { kind: "authored" },
        },
      },
    ],
  }),
);
// The planted defect: the check multiplies by seven where its rule says six.
writeFileSync(
  join(checks, "evaluator.ts"),
  `export const checks = { "check-product": (r) => r.artifact.answer === String(r.publicTask.publicInput.base * 7) };\n`,
);

setDefaultTimeout(120_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A model that makes `calls` in order, a turn each; what it was sent goes to `sent`. */
function scripted(calls: readonly (readonly [string, JsonObject])[], sent: string[]) {
  const faux = fauxProvider({
    models: [
      { id: "script", contextWindow: 200_000, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
  });
  faux.setResponses(
    calls.map(([name, given]) => (context) => {
      sent.push(JSON.stringify(context));
      return fauxAssistantMessage(fauxToolCall(name, given), TOOL_USE);
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models };
}

const condition = (harness: string): Condition => ({
  contract: "c1",
  harness,
  task: "v-t",
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

/**
 * A campaign's log after one comparison: three answers to t-1 the planted check refused, one the
 * Referee ruled a check defect, one it ruled so and a person labelled earned, and one nobody read;
 * and t-2 flagged as malformed once under the new harness and once in practice.
 */
function seededLog(name: string): string {
  const log = join(root, `${name}.jsonl`);
  append(log, "comparison.started", {
    session: "c-1",
    old: "h-old",
    fresh: "h-new",
    starter: "h-0",
    setting: "s",
    solves: 1,
    level: 0.02,
    trigger: 0.25,
  });
  for (const harness of ["h-old", "h-new"]) {
    append(log, "condition.recorded", {
      id: conditionId(condition(harness)),
      condition: requireJsonValue(condition(harness)),
    });
  }
  const solve = (id: string, task: string, harness: string, ending: JsonObject, comparison?: string) => {
    append(log, "solve.started", {
      solve: id,
      task,
      condition: conditionId(condition(harness)),
      ...keyIfDefined("comparison", comparison),
    });
    append(log, "solve.finished", { solve: id, ending });
  };
  for (const id of ["s-1", "s-2", "s-3"]) {
    solve(id, "t-1", "h-old", { outcome: "fail", kind: "rejected" }, "c-1");
    append(log, "verdict", {
      solve: id,
      task: "t-1",
      answer: { answer: "12" },
      kind: "fail",
      blocking: ["check-product"],
    });
  }
  for (const id of ["s-1", "s-2"]) {
    append(log, "referee.finding", {
      solve: id,
      ruling: "check-defect",
      check: "check-product",
      reason: "the check multiplies by seven where R1 says six",
    });
  }
  solve("s-4", "t-2", "h-new", { outcome: "flagged", reason: SECRET }, "c-1");
  solve("s-5", "t-2", "h-old", { outcome: "flagged", reason: SECRET });
  append(log, "comparison.reported", {
    session: "c-1",
    settled: {
      labelled: 1,
      defects: 0,
      disputed: [],
      restored: [],
      labels: { "s-2": "earned" },
      passes: {},
    },
  });
  append(log, "checker.read", { faults: ["the accept control of t-1 did not pass: fail check-product"] });
  return log;
}

/** The repair as the tool takes it. */
const args = (repair: Repair): JsonObject => ({
  files: repair.files.map((file) => ({ ...file })),
  accept_controls: repair.controls.flatMap(({ taskId, answer, refusedBy }) =>
    refusedBy === null ? [{ task: taskId, answer }] : [],
  ),
  reject_controls: repair.controls.flatMap(({ taskId, answer, refusedBy }) =>
    refusedBy === null ? [] : [{ task: taskId, answer, check: refusedBy }],
  ),
});

const of = (log: string, kind: string): JsonObject[] =>
  read(log).flatMap((event: LogEvent) => (event.kind === kind ? [event.data] : []));

describe("the session that repairs a check", () => {
  it("is shown the rules, the read rejections with their tasks' hidden values, the last reading and the flags by side, and no solver's words", async () => {
    const log = seededLog("shown");
    const sent: string[] = [];
    const ended = await repairCheck({
      id: "r-1",
      successor: "fixture-r-1",
      ...campaign,
      reading: async () => [],
      effort: "high",
      limits: LIMITS,
      log,
      ...scripted([["repair_check", args(MENDED)]], sent),
    });
    expect(ended).toEqual({ stands: true, tries: 1, ended: "stands", repair: MENDED });
    const told = sent[0] ?? "";
    expect(told).toContain("R1: The answer is the base times six.");
    expect(told).toContain("check-product, citing R1");
    expect(told).toContain(
      "s-1, refused by check-product: check-defect, by the Referee's ruling naming check-product: the check multiplies by seven where R1 says six",
    );
    // A person's label stands over the Referee's ruling of the same answer.
    expect(told).toContain("s-2, refused by check-product: earned, by a person's label");
    expect(told).toContain("seed-2");
    expect(told).toContain("1 more refused answers were read by nobody");
    expect(told).toContain("the accept control of t-1 did not pass: fail check-product");
    expect(told).toContain("t-2: 0 under the reference harness, 1 under the new harness, 1 in practice");
    expect(told).not.toContain(SECRET);
    expect(told).not.toContain("h-new");
    // It reads the program it repairs, as the Referee does.
    expect(told).toContain("read_check_program");
  });

  it("mends a repair on the faults it is told, and hands back the one that stands", async () => {
    const log = seededLog("stands");
    const put: Repair[] = [];
    const ended = await repairCheck({
      id: "r-1",
      successor: "fixture-r-1",
      ...campaign,
      reading: async (repair) => {
        put.push(repair);
        return put.length === 1 ? ["the answer s-1 is refused still: fail check-product"] : [];
      },
      effort: "high",
      limits: LIMITS,
      log,
      ...scripted(
        [
          ["repair_check", { files: [], accept_controls: [{ task: "t-2", answer: { answer: "18" } }] }],
          ["repair_check", args(MENDED)],
          ["finish", { note: "Never reached." }],
        ],
        [],
      ),
    });
    expect(ended).toMatchObject({ stands: true, tries: 2, ended: "stands", repair: MENDED });
    // Controls left out stay as they were, and controls put replace their kind whole.
    expect(put[0]?.controls).toEqual([
      { taskId: "t-2", answer: { answer: "18" }, refusedBy: null },
      { taskId: "t-1", answer: { answer: "13" }, refusedBy: "check-product" },
    ]);
    expect(of(log, "repair.call").map(({ text }) => text)).toEqual([
      "The repair does not stand. 1 fault:\n- the answer s-1 is refused still: fail check-product\nMend them and put the whole repair again. This session can put 1 more repair.",
      "The repair stands: the host takes it into a campaign of its own. The session ends here.",
    ]);
    const [started] = of(log, "repair.started");
    expect(started).toMatchObject({ session: "r-1", successor: "fixture-r-1", engines: [] });
    expect(of(log, "repair.finished")).toMatchObject([
      { session: "r-1", ended: "stands", stands: true, tries: 2 },
    ]);
  });

  it("ends unresolved where no repair stands within its tries, with what it billed in the log", async () => {
    const log = seededLog("unresolved");
    const before = billedAll(read(log));
    const ended = await repairCheck({
      id: "r-1",
      successor: "fixture-r-1",
      ...campaign,
      reading: async () => ["the accept control of t-1 did not pass: fail check-product"],
      effort: "high",
      limits: LIMITS,
      log,
      ...scripted(
        [
          ["repair_check", args(MENDED)],
          ["repair_check", args(MENDED)],
          ["repair_check", args(MENDED)],
          ["finish", { note: "The check cannot be repaired without its rule." }],
        ],
        [],
      ),
    });
    expect(ended).toEqual({ stands: false, tries: 2, ended: "finished", repair: null });
    const calls = of(log, "repair.call");
    expect(calls.map(({ isError }) => isError)).toEqual([false, false, true, false]);
    expect(calls[2]?.text).toContain("This session can put no further repair. Call finish.");
    const [finished] = of(log, "repair.finished");
    expect(finished).toMatchObject({
      stands: false,
      tries: 2,
      note: "The check cannot be repaired without its rule.",
    });
    expect(billedAll(read(log))).toBeGreaterThan(before);
  });
});

describe("the shape of a repair", () => {
  it("holds a repair of a file or a control to nothing", () => {
    expect(repairFaults(MENDED, campaign)).toEqual([]);
    expect(repairFaults({ files: [], controls: controls.slice(1) }, campaign)).toEqual([]);
  });

  it("refuses the declaration of the checks, the battery, a path outside the program and a repair of nothing", () => {
    const files = ["brief.json", "controls.json", "../evaluator.ts", "/etc/evaluator.ts", "a//b.ts"].map(
      (path) => ({ path, content: "" }),
    );
    expect(repairFaults({ files, controls }, campaign)).toEqual([
      "brief.json declares the public rules and each check, and no repair changes it: a check repaired is the same check, and its rule the same rule",
      "controls.json holds the controls, which a repair puts as accept_controls and reject_controls",
      "../evaluator.ts is no path inside the check program: name a file as check-program/ holds it",
      "/etc/evaluator.ts is no path inside the check program: name a file as check-program/ holds it",
      "a//b.ts is no path inside the check program: name a file as check-program/ holds it",
    ]);
    expect(repairFaults({ files: [], controls }, campaign)).toEqual([
      "the repair changes no file and no control",
    ]);
  });

  it("refuses a control on a task the campaign does not hold, for a check it does not declare, or outside the format", () => {
    const stray: Control[] = [
      { taskId: "t-9", answer: { answer: "1" }, refusedBy: null },
      { taskId: "t-1", answer: { answer: "1" }, refusedBy: "check-other" },
    ];
    expect(repairFaults({ files: [], controls: stray }, campaign)).toEqual([
      "an accept control of t-9 names a task the campaign does not hold",
      "a reject control of t-1 for check-other names a check the program does not declare",
    ]);
    const [unformed] = repairFaults(
      { files: [], controls: [{ taskId: "t-1", answer: { answer: 12 }, refusedBy: null }] },
      campaign,
    );
    expect(unformed).toStartWith("an accept control of t-1 does not follow the answer format (");
  });
});

describe("the session that repairs a check, in a walled home of its own", () => {
  /** The repository this suite runs in, which the wall closes to the Examiner's commands. */
  const repo = resolve(import.meta.dir, "..");

  it("finds the check program, the controls, every task and the evidence in its home, and no solver's words", async () => {
    const log = seededLog("walled");
    const told: string[] = [];
    const ended = await repairWalled({
      id: "r-1",
      successor: "fixture-r-1",
      ...campaign,
      reading: async () => [],
      effort: "high",
      limits: LIMITS,
      log,
      repoRoot: repo,
      diskBytes: 64 * 1024 ** 2,
      ...scripted(
        [
          [
            "bash",
            { command: "ls check-program && cat controls.json tasks.json evidence.json | tr -d ' \\n'" },
          ],
          ["repair_check", args(MENDED)],
        ],
        told,
      ),
    });
    expect(ended.stands).toBe(true);
    // Its shell is described with what its home holds, and the tool the checks run through.
    const [bash] = of(log, "repair.call");
    expect(bash?.tool).toBe("bash");
    expect(told[0]).toContain("holds, at its start, the check program in check-program/");
    expect(told[0]).not.toContain("empty at its start");
    expect(told[0]).not.toContain("try_answer");
    const [listed] = of(log, "repair.call").flatMap(({ text }) => (isString(text) ? [text] : []));
    expect(listed).toStartWith("brief.json\nevaluator.ts\n");
    expect(listed).toContain(`"reject":[{"task":"t-1","answer":{"answer":"13"},"check":"check-product"}]`);
    expect(listed).toContain(`"hiddenSeed":"seed-3"`);
    expect(listed).toContain(`"flags":{"t-2":{"reference":0,"fresh":1,"practice":1}}`);
    expect(listed).not.toContain(SECRET);
  });
});

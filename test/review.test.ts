// The two reviewers on the faux provider: the probe's field replacement and refusals, the Referee's
// three rulings with a check-defect standing only on a probe that decided both sides and reached the
// named check, its replay of the checks before any reading, and the Diagnoser reading only earned
// fails on released tasks, against a pass under the same condition, quoting what it read or abstaining.
import { afterAll, describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Task, Verdict } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { diagnose } from "../src/review/diagnoser.ts";
import { agreement, clears } from "../src/review/agreement.ts";
import {
  editedPassage,
  PROBE_BUDGET,
  type ProbeRow,
  probeTool,
  withReplacedField,
} from "../src/review/probe.ts";
import type { Reader } from "../src/review/reader.ts";
import { referee } from "../src/review/referee.ts";

const CANARY = "hidden-canary-r7";
const TASK: Task = { taskId: "t-1", family: "beam", publicInput: { load: 5 }, hidden: { limit: CANARY } };
const CONTRACT: Contract = {
  answerFormat: {},
  tools: [],
  install: "",
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "A span is at most 12 m." }],
  scope: "Fixture.",
};
const ANSWER = { span: 12, members: [{ area: 3 }] };
/** The test condition of task version v1; the Diagnoser reads a solve's task version from it. */
const CONDITION: Condition = {
  contract: "c1",
  harness: "h1",
  task: "v1",
  model: "faux/faux-reader",
  effort: "medium",
  prices: { "faux/faux-reader": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: "h1",
  verifierTools: "v1",
  sandbox: "p1",
  limits: {
    wallSeconds: 7_200,
    turns: 24,
    shellDefaultSeconds: 300,
    shellMaxSeconds: 900,
    concurrency: 3,
    diskBytes: 2 * 1024 ** 3,
  },
  host: "h",
  side: "test",
};
/** A check that refuses spans over 10, where the rule allows 12. */
const verify = async (_task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
  const span = (answer as { span?: number } | undefined)?.span ?? 0;
  return span > 10 ? { kind: "fail", blocking: ["span"] } : { kind: "pass" };
};
const toolUse = { stopReason: "toolUse" } as const;

const scratches: string[] = [];
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A scratch with a check program and a log, and a reader scripted with `responses`, keeping what
 *  each model call was sent. */
function setup(responses: ReturnType<typeof fauxAssistantMessage>[]) {
  const scratch = mkdtempSync(join(tmpdir(), "ana-review-"));
  scratches.push(scratch);
  const checks = join(scratch, "checks");
  mkdirSync(checks);
  writeFileSync(
    join(checks, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: [
        {
          id: "span",
          citedDecisionIds: ["R1"],
          execution: {
            families: "all",
            artifactPaths: ["$.span"],
            publicInputPaths: [],
            hidden: "none",
            evidence: { kind: "authored" },
          },
        },
      ],
    }),
  );
  writeFileSync(join(checks, "evaluator.ts"), "// span <= 10\n");
  const sent: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-reader",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(
    responses.map((message) => (context: unknown, options?: { signal?: AbortSignal }) => {
      sent.push(JSON.stringify(context));
      signals.push(options?.signal);
      return message;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const reader: Reader = { model: faux.getModel(), effort: "medium", models: () => models };
  const log = join(scratch, "log.jsonl");
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  return { checks, log, reader, sent, signals, record, calls: () => sent.length };
}

describe("the probe", () => {
  it("replaces one existing leaf of a copy, and refuses a path the answer lacks", () => {
    expect(withReplacedField(ANSWER, "$.members[0].area", 4)).toEqual({ span: 12, members: [{ area: 4 }] });
    expect(ANSWER.members[0]?.area).toBe(3);
    expect(withReplacedField(ANSWER, "$.members[1].area", 4)).toBeNull();
    expect(withReplacedField(ANSWER, "$.depth", 4)).toBeNull();
    expect(withReplacedField(ANSWER, "span", 4)).toBeNull();
  });

  it("says which checks moved, and refuses what is not a one-field change", async () => {
    const rows: ProbeRow[] = [];
    const tool = probeTool(verify, TASK, ANSWER, rows);
    const probe = (path: string, value: string) => tool.execute("id", { path, value });
    const moved = await probe("$.span", "10");
    expect(moved.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("1 check(s) moved: span") }),
    ]);
    await probe("$.members[0].area", "5");
    expect(rows.map((row) => row.moved)).toEqual([["span"], []]);
    await expect(probe("$.span", "ten")).rejects.toThrow("value must be JSON text");
    await expect(probe("$.depth", "1")).rejects.toThrow("$.depth is not an existing field");
    await expect(probe("$.span", "12")).rejects.toThrow("already carries that value");
    await expect(probe("$.span", JSON.stringify("x".repeat(4_000)))).rejects.toThrow(
      "at most 4000 characters",
    );
    while (rows.length < PROBE_BUDGET) await probe("$.span", String(rows.length));
    await expect(probe("$.span", "1")).rejects.toThrow(`at most ${String(PROBE_BUDGET)} probes`);
  });

  it("rewrites one passage inside a text field, where the thing in dispute is one line of a file", async () => {
    // A stand-in that refuses valid code: it rejects any call of `min`, which the rules allow.
    const source = { files: { "main.cpp": "int a = min(x, 3);\nint b = max(x, 3);\n" } };
    const standIn = async (_task: Task, answer: JsonValue | undefined): Promise<Verdict> =>
      JSON.stringify(answer).includes("min(") ? { kind: "fail", blocking: ["compiles"] } : { kind: "pass" };
    const rows: ProbeRow[] = [];
    const tool = probeTool(standIn, TASK, source, rows);
    const path = "$.files['main.cpp']";
    const edited = await tool.execute("id", { path, find: "min(x, 3)", replace: "(x < 3 ? x : 3)" });
    expect(edited.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("edited, its one passage of 9 characters rewritten as 15"),
      }),
    ]);
    expect(rows[0]).toMatchObject({ value: null, edit: { find: "min(x, 3)" }, moved: ["compiles"] });
    expect(editedPassage(source, path, { find: "min", replace: "MIN" })).toContain("int a = MIN(x, 3);");
    // `(x, 3)` names two passages, so editing either would be a guess; and a dollar sign is text.
    expect(editedPassage(source, path, { find: "(x, 3)", replace: "()" })).toBeNull();
    expect(editedPassage(source, path, { find: "max", replace: "$&$1" })).toContain("int b = $&$1(x, 3);");
    await expect(tool.execute("id", { path, find: "(x, 3)", replace: "" })).rejects.toThrow(
      "is not a text field holding `find` exactly once",
    );
    await expect(tool.execute("id", { path, value: '""', find: "min", replace: "" })).rejects.toThrow(
      "send either `value`, or `find` with `replace`",
    );
    await expect(tool.execute("id", { path })).rejects.toThrow(
      "send either `value`, or `find` with `replace`",
    );
  });
});

describe("the Referee", () => {
  const failed = (record: ReturnType<typeof setup>["record"]) =>
    record("verdict", { solve: "s-1", task: "t-1", answer: ANSWER, kind: "fail", blocking: ["span"] });
  const fail = (s: ReturnType<typeof setup>) => ({
    solve: "s-1",
    task: TASK,
    contract: CONTRACT,
    checks: s.checks,
    verify,
    log: s.log,
  });
  const ruling = (args: JsonObject) => fauxAssistantMessage(fauxToolCall("record_ruling", args), toolUse);

  it("rules a check-defect only on a probe that decided both sides", async () => {
    const s = setup([
      ruling({ ruling: "check-defect", check: "span", reason: "R1 allows 12.", probes: [] }),
      fauxAssistantMessage(fauxToolCall("read_check_program", { path: "evaluator.ts" }), toolUse),
      fauxAssistantMessage(fauxToolCall("probe_check", { path: "$.span", value: "10" }), toolUse),
      ruling({
        ruling: "check-defect",
        check: "span",
        reason: "R1 allows 12; the check stops at 10.",
        probes: [1],
      }),
    ]);
    failed(s.record);
    const finding = await referee(s.reader, fail(s));
    expect(finding).toEqual({
      ruling: "check-defect",
      check: "span",
      rule: null,
      field: null,
      reason: "R1 allows 12; the check stops at 10.",
      probes: [1],
    });
    expect(s.sent[1]).toContain("cites at least one probe whose two sides both reached a verdict");
    expect(s.sent[2]).toContain("// span <= 10");
    expect(s.sent[0]).toContain(CANARY);
    expect(s.sent[0]).toContain(String.raw`span, citing R1 (\"A span is at most 12 m.\"); reads $.span`);
    const logged = read(s.log).findLast((event) => event.kind === "referee.finding")?.data;
    expect(logged).toMatchObject({ solve: "s-1", task: "t-1", ruling: "check-defect", turns: 4 });
    expect(logged?.probeRows).toEqual([expect.objectContaining({ id: 1, moved: ["span"] })]);
    expect(logged?.replay).toEqual({ kind: "fail", blocking: ["span"] });
  });

  it("refuses a check-defect on a probe the named check never receives", async () => {
    const s = setup([
      fauxAssistantMessage(fauxToolCall("probe_check", { path: "$.members[0].area", value: "5" }), toolUse),
      ruling({ ruling: "check-defect", check: "span", reason: "The check is too strict.", probes: [1] }),
      ruling({ ruling: "unclear", reason: "No probe on the span yet.", probes: [1] }),
    ]);
    failed(s.record);
    expect((await referee(s.reader, fail(s))).ruling).toBe("unclear");
    expect(s.sent[2]).toContain("span reads $.span, and no cited probe changed that");
  });

  it("replays the checks once, and the first probe reuses that run", async () => {
    const s = setup([
      fauxAssistantMessage(fauxToolCall("probe_check", { path: "$.span", value: "10" }), toolUse),
      ruling({
        ruling: "earned",
        rule: "R1",
        field: "$.span",
        reason: "12 m is over the check's 10.",
        probes: [1],
      }),
    ]);
    failed(s.record);
    const answers: JsonValue[] = [];
    await referee(s.reader, {
      ...fail(s),
      verify: async (task, answer) => {
        answers.push(answer ?? null);
        return verify(task, answer);
      },
    });
    expect(answers).toEqual([ANSWER, { ...ANSWER, span: 10 }]);
  });

  it("rules a check that does not repeat a check-defect, and an undecided replay unclear, unread", async () => {
    const s = setup([]);
    failed(s.record);
    expect(await referee(s.reader, { ...fail(s), verify: async () => ({ kind: "pass" }) })).toMatchObject({
      ruling: "check-defect",
      check: "span",
      probes: [],
    });
    expect(read(s.log).at(-1)?.data).toMatchObject({ ruling: "check-defect", replay: { kind: "pass" } });
    const undecided = async (): Promise<Verdict> => ({ kind: "non-result", reason: "the cell timed out" });
    expect(await referee(s.reader, { ...fail(s), verify: undecided })).toMatchObject({
      ruling: "unclear",
      reason: "the replay reached no verdict: the cell timed out",
    });
    expect(s.calls()).toBe(0);
  });

  it("rules earned with no reading when no answer reached a check", async () => {
    const s = setup([]);
    expect(await referee(s.reader, fail(s))).toEqual({
      ruling: "earned",
      check: null,
      rule: null,
      field: null,
      reason: "no answer reached a check",
      probes: [],
    });
    expect(s.calls()).toBe(0);
    expect(read(s.log).map((event) => event.kind)).toEqual(["referee.finding"]);
    // An answer outside the contract's format broke the contract before any check ran.
    s.record("verdict", {
      solve: "s-1",
      task: "t-1",
      answer: ANSWER,
      kind: "fail",
      fault: "span is not a number",
    });
    expect(await referee(s.reader, fail(s))).toMatchObject({
      ruling: "earned",
      reason: "the answer does not follow the contract's format: span is not a number",
    });
    expect(s.calls()).toBe(0);
  });

  it("holds an earned ruling to the rule the answer breaks and the field that breaks it", async () => {
    const earned = (rest: JsonObject) =>
      ruling({ ruling: "earned", reason: "Over the limit.", probes: [], ...rest });
    const s = setup([
      earned({}),
      earned({ rule: "R9", field: "$.span" }),
      earned({ rule: "R1", field: "$.depth" }),
      earned({ rule: "R1", field: "$.members[0].area" }),
      earned({ rule: "R1", field: "$.span" }),
    ]);
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "earned", rule: "R1", field: "$.span" });
    expect(s.sent[1]).toContain("names the public rule the answer breaks, one a refusing check cites: R1");
    expect(s.sent[2]).toContain("one a refusing check cites: R1");
    expect(s.sent[3]).toContain("a path that exists in the answer");
    expect(s.sent[4]).toContain("no refusing check that cites R1 reads $.members[0].area");
    expect(read(s.log).at(-1)?.data).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: "$.span",
      turns: 5,
    });
  });

  it("sets an answer the checks accepted for the task beside the one under review", async () => {
    const unclear = ruling({ ruling: "unclear", reason: "Not settled.", probes: [] });
    const s = setup([unclear, unclear]);
    failed(s.record);
    await referee(s.reader, fail(s));
    expect(s.sent[0]).toContain("No answer the checks accepted for this task is recorded.");
    s.record("verdict", { solve: "s-0", task: "t-1", answer: { span: 9, members: [] }, kind: "pass" });
    s.record("verdict", { solve: "s-9", task: "t-2", answer: { span: 1, members: [] }, kind: "pass" });
    await referee(s.reader, fail(s));
    expect(s.sent[1]).toContain(
      String.raw`An answer the checks accepted for this task: {\"span\":9,\"members\":[]}`,
    );
  });

  it("ends a reading at its wall, and says so in the finding", async () => {
    // The replay is the host's and runs before the reading; the probe's second run outlasts the wall.
    const s = setup([
      fauxAssistantMessage(fauxToolCall("probe_check", { path: "$.span", value: "10" }), toolUse),
      ruling({ ruling: "earned", rule: "R1", field: "$.span", reason: "Too late.", probes: [1] }),
    ]);
    failed(s.record);
    let runs = 0;
    const slow = async (task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
      runs += 1;
      if (runs > 1) await Bun.sleep(400);
      return verify(task, answer);
    };
    const finding = await referee({ ...s.reader, wallSeconds: 0.05 }, { ...fail(s), verify: slow });
    expect(finding.ruling).toBe("unclear");
    expect(read(s.log).at(-1)?.data).toMatchObject({ walled: true, ruling: "unclear" });
  });

  it("leaves the fail unclear when the reader never rules", async () => {
    const s = setup([fauxAssistantMessage("The check looks right to me.")]);
    failed(s.record);
    expect((await referee(s.reader, fail(s))).ruling).toBe("unclear");
  });

  // Claude Code keeps its query open for a prompt after the loop ends; the session's signal is what
  // closes it, so a reader that returned with its signal live left the process running.
  it("ends the model's query once the session returns", async () => {
    const s = setup([fauxAssistantMessage("The check looks right to me.")]);
    failed(s.record);
    await referee(s.reader, fail(s));
    expect(s.signals).toHaveLength(1);
    expect(s.signals[0]?.aborted).toBe(true);
  });
});

describe("the Referee's agreement with hand labels", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const ruled = (solve: string, ruling: string) => ({
    at,
    kind: "referee.finding" as const,
    data: { solve, ruling },
  });
  const events = [
    ruled("a", "unclear"),
    ruled("a", "check-defect"),
    ruled("b", "earned"),
    ruled("c", "earned"),
    ruled("d", "check-defect"),
    ruled("e", "unclear"),
  ];
  const labels = new Map([
    ["a", "check-defect"],
    ["b", "check-defect"],
    ["c", "earned"],
    ["d", "earned"],
    ["e", "earned"],
  ] as const);

  it("counts the last ruling of each labelled fail against its label", () => {
    const measured = agreement(events, labels);
    expect(measured.table["check-defect"]).toEqual({ earned: 1, "check-defect": 1, unclear: 0 });
    expect(measured.table.earned).toEqual({ earned: 1, "check-defect": 1, unclear: 1 });
    expect(measured).toMatchObject({ caught: 0.5, unruled: [] });
    expect(measured.voided).toBeCloseTo(1 / 3);
  });

  it("clears a bar written beforehand, and nothing when a label is unruled or a rate has no fails", () => {
    const measured = agreement(events, labels);
    expect(clears(measured, { fails: 5, caught: 0.5, voided: 0.4 })).toBe(true);
    expect(clears(measured, { fails: 5, caught: 0.8, voided: 0.4 })).toBe(false);
    expect(clears(measured, { fails: 5, caught: 0.5, voided: 0.1 })).toBe(false);
    expect(clears(measured, { fails: 6, caught: 0.5, voided: 0.4 })).toBe(false);
    expect(
      clears(agreement(events, new Map([...labels, ["z", "earned"]])), { fails: 1, caught: 0, voided: 1 }),
    ).toBe(false);
    const noDefects = agreement(events, new Map([["c", "earned"]] as const));
    expect(noDefects.caught).toBeNull();
    expect(clears(noDefects, { fails: 1, caught: 0, voided: 1 })).toBe(false);
  });
});

describe("the Diagnoser", () => {
  const diagnosis = (args: JsonObject) =>
    fauxAssistantMessage(fauxToolCall("record_diagnosis", args), toolUse);
  /** A solve of t-1 begun under `condition`, which the log records as a live solve's is. */
  const started = (s: ReturnType<typeof setup>, solve: string, condition = CONDITION) =>
    s.record("solve.started", { solve, condition: recordCondition(s.log, condition), task: "t-1" });
  const solved = (s: ReturnType<typeof setup>) => {
    const { record } = s;
    started(s, "s-0");
    record("solve.call", {
      solve: "s-0",
      turn: 1,
      tool: "bash",
      args: {},
      isError: false,
      text: "span 9 within limit",
      ms: 3,
    });
    record("solve.finished", { solve: "s-0", ending: { outcome: "pass" } });
    started(s, "s-1");
    record("solve.call", {
      solve: "s-1",
      turn: 1,
      tool: "bash",
      args: { command: "python beam.py" },
      isError: true,
      text: "ModuleNotFoundError: numpy",
      ms: 5,
    });
    record("solve.turn", { solve: "s-1", turn: 1, stopReason: "toolUse", text: "" });
    record("solve.turn", { solve: "s-1", turn: 2, stopReason: "stop", text: "Done: span 12." });
    record("verdict", { solve: "s-1", task: "t-1", answer: ANSWER, kind: "fail", blocking: ["span"] });
    record("solve.finished", { solve: "s-1", ending: { outcome: "fail", kind: "rejected" } });
  };
  /** v1 released: screened, the anchor drawn from another version first. */
  const released = (record: ReturnType<typeof setup>["record"]) => {
    for (const version of ["v0", "v1"]) {
      record("task.proposed", { version });
      for (const gate of [1, 2, 3, 4]) {
        record("task.gate", { version, gate, outcome: "passed", controls: "digest" });
      }
    }
    record("anchor.drawn", { tasks: ["v0"] });
    record("task.state", { version: "v1", state: "released" });
  };
  const fail = (s: ReturnType<typeof setup>) => ({
    solve: "s-1",
    task: TASK,
    contract: CONTRACT,
    log: s.log,
  });

  it("refuses a task that is not released, and a fail the Referee has not ruled earned", async () => {
    const s = setup([]);
    solved(s);
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    await expect(diagnose(s.reader, fail(s))).rejects.toThrow("task v1 is not released");
    released(s.record);
    s.record("referee.finding", { solve: "s-1", ruling: "unclear" });
    await expect(diagnose(s.reader, fail(s))).rejects.toThrow("has not ruled the fail of s-1 earned");
    expect(s.calls()).toBe(0);
  });

  it("takes the task version from the solve's logged condition, never from the caller", async () => {
    const s = setup([]);
    released(s.record);
    // A solve of the anchor's version v0, which is feasible and not released, and one of no recorded
    // condition: with v1 released, neither may be read under its name.
    started(s, "s-anchor", { ...CONDITION, task: "v0" });
    s.record("solve.started", { solve: "s-bare", task: "t-1" });
    for (const solve of ["s-anchor", "s-bare"]) s.record("referee.finding", { solve, ruling: "earned" });
    await expect(diagnose(s.reader, { ...fail(s), solve: "s-anchor" })).rejects.toThrow(
      "task v0 is not released",
    );
    await expect(diagnose(s.reader, { ...fail(s), solve: "s-bare" })).rejects.toThrow(
      "the log records no condition for s-bare",
    );
    expect(s.calls()).toBe(0);
  });

  it("records a cause whose divergence quotes the trace, beside the passing solve", async () => {
    const recorded = {
      owner: "harness" as const,
      cause: "The guide never says numpy is missing, so the script fails and the solver guesses.",
      falsifier: "A later solve that imports numpy without error and still answers 12.",
      firstDivergence: "ModuleNotFoundError:   numpy",
      contrastSuccess: "span 9 within limit",
      confidence: "medium" as const,
    };
    const s = setup([
      diagnosis({ ...recorded, firstDivergence: "the solver ignored the load" }),
      diagnosis(recorded),
    ]);
    released(s.record);
    solved(s);
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    expect(await diagnose(s.reader, fail(s))).toEqual({
      ...recorded,
      firstDivergence: "ModuleNotFoundError:   numpy",
    });
    expect(s.sent[0]).toContain("call 1 failed bash: ModuleNotFoundError: numpy");
    expect(s.sent[0]).toContain("Passing solve of the same task under the same condition");
    expect(s.sent[0]).toContain("2 counted solve(s) of this task, 1 passed");
    expect(s.sent[0]).toContain(String.raw`ending: {\"outcome\":\"fail\",\"kind\":\"rejected\"}`);
    expect(s.sent[0]).not.toContain(CANARY);
    expect(s.sent[1]).toContain("firstDivergence must quote the failed solve's excerpt");
    expect(read(s.log).findLast((event) => event.kind === "diagnosis.recorded")?.data).toMatchObject({
      solve: "s-1",
      version: "v1",
      owner: "harness",
      confidence: "medium",
      record: { solves: 2, passed: 1 },
    });
  });

  it("contrasts only with a pass under the failed solve's own condition", async () => {
    const s = setup([diagnosis({ abstainReason: "Nothing to compare." })]);
    released(s.record);
    started(s, "s-strong", { ...CONDITION, side: "strong" });
    s.record("solve.call", {
      solve: "s-strong",
      turn: 1,
      tool: "bash",
      isError: false,
      text: "stronger path",
    });
    s.record("solve.finished", { solve: "s-strong", ending: { outcome: "pass" } });
    started(s, "s-1");
    s.record("solve.finished", { solve: "s-1", ending: { outcome: "fail", kind: "wall-ended" } });
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    await diagnose(s.reader, fail(s));
    expect(s.sent[0]).toContain("No passing solve of this task is recorded under this condition.");
    expect(s.sent[0]).toContain("1 counted solve(s) of this task, 0 passed");
    expect(s.sent[0]).not.toContain("stronger path");
  });

  it("reads a call the excerpt left out, and only then may quote it", async () => {
    const quoting = {
      owner: "solver",
      cause: "The solver saw the breach at call 20 and submitted anyway.",
      falsifier: "A later solve that reads the same breach and revises before it submits.",
      firstDivergence: "margin -0.2 at call 20",
      confidence: "low",
    };
    const s = setup([
      diagnosis(quoting),
      fauxAssistantMessage(fauxToolCall("read_trace", { solve: "failed" }), toolUse),
      fauxAssistantMessage(fauxToolCall("read_trace", { solve: "failed", call: 20 }), toolUse),
      diagnosis(quoting),
    ]);
    released(s.record);
    started(s, "s-1");
    for (let call = 1; call <= 40; call += 1) {
      s.record("solve.call", {
        solve: "s-1",
        turn: call,
        tool: "bash",
        args: { command: `step ${String(call)}` },
        isError: false,
        text: `margin -0.2 at call ${String(call)}`,
      });
    }
    s.record("solve.finished", { solve: "s-1", ending: { outcome: "fail", kind: "rejected" } });
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    expect(await diagnose(s.reader, fail(s))).toMatchObject({ owner: "solver", contrastSuccess: null });
    expect(s.sent[0]).toContain("tool result excerpts: 3/40; 37 omitted");
    expect(s.sent[1]).toContain(
      "firstDivergence must quote the failed solve's excerpt, a call of it you read",
    );
    expect(s.sent[2]).toContain(String.raw`20 bash\n21 bash`);
    expect(s.sent[3]).toContain("result: margin -0.2 at call 20");
  });

  it("abstains when the reader says what evidence is missing", async () => {
    const s = setup([diagnosis({ abstainReason: "No tool output shows how the span was chosen." })]);
    released(s.record);
    solved(s);
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    expect(await diagnose(s.reader, fail(s))).toEqual({
      abstain: "No tool output shows how the span was chosen.",
    });
  });
});

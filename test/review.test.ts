// The two reviewers on the faux provider: the probe's field replacement and refusals, the Referee's
// three rulings with a check-defect standing only on a probe that decided both sides and reached the
// named check, its replay of the checks before any reading, and the Diagnoser reading only earned
// fails on released tasks, against a pass under the same condition, quoting what it read or abstaining.
import { afterAll, describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Task, Verdict } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { diagnose } from "../src/review/diagnoser.ts";
import { PROBE_BUDGET, type ProbeRow, probeTool, withReplacedField } from "../src/review/probe.ts";
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
    await expect(probe("$.span", JSON.stringify("x".repeat(400)))).rejects.toThrow("at most 400 characters");
    while (rows.length < PROBE_BUDGET) await probe("$.span", String(rows.length));
    await expect(probe("$.span", "1")).rejects.toThrow(`at most ${String(PROBE_BUDGET)} probes`);
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
      ruling({ ruling: "earned", reason: "12 m is over the check's 10.", probes: [1] }),
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
      reason: "no answer reached a check",
      probes: [],
    });
    expect(s.calls()).toBe(0);
    expect(read(s.log).map((event) => event.kind)).toEqual(["referee.finding"]);
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

describe("the Diagnoser", () => {
  const diagnosis = (args: JsonObject) =>
    fauxAssistantMessage(fauxToolCall("record_diagnosis", args), toolUse);
  const solved = (record: ReturnType<typeof setup>["record"]) => {
    record("solve.started", { solve: "s-0", task: "t-1" });
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
    record("solve.started", { solve: "s-1", task: "t-1" });
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
    version: "v1",
    task: TASK,
    contract: CONTRACT,
    log: s.log,
  });

  it("refuses a task that is not released, and a fail the Referee has not ruled earned", async () => {
    const s = setup([]);
    solved(s.record);
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    await expect(diagnose(s.reader, fail(s))).rejects.toThrow("task v1 is not released");
    released(s.record);
    s.record("referee.finding", { solve: "s-1", ruling: "unclear" });
    await expect(diagnose(s.reader, fail(s))).rejects.toThrow("has not ruled the fail of s-1 earned");
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
    solved(s.record);
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
    s.record("solve.started", { solve: "s-strong", condition: "stronger", task: "t-1" });
    s.record("solve.call", {
      solve: "s-strong",
      turn: 1,
      tool: "bash",
      isError: false,
      text: "stronger path",
    });
    s.record("solve.finished", { solve: "s-strong", ending: { outcome: "pass" } });
    s.record("solve.started", { solve: "s-1", condition: "test", task: "t-1" });
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
    s.record("solve.started", { solve: "s-1", task: "t-1" });
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
    solved(s.record);
    s.record("referee.finding", { solve: "s-1", ruling: "earned" });
    expect(await diagnose(s.reader, fail(s))).toEqual({
      abstain: "No tool output shows how the span was chosen.",
    });
  });
});

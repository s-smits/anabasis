// The two reviewers on the faux provider: the probe's field replacement and refusals, the Referee's
// three rulings with a check-defect standing only on a probe that decided both sides and reached the
// named check, its replay of the checks before any reading, and the Diagnoser reading only earned
// fails on released tasks, against a pass under the same condition, quoting what it read or abstaining.
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Task, Verdict } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
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
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "A span is at most 12 m." }],
  scope: "Fixture.",
};
const ANSWER = { span: 12, members: [{ area: 3 }] };
/** The field of the answer the fixture's one check reads. */
const SPAN = "$.span";
const FINDING: EventKind = "referee.finding";
const scratches: string[] = [];
/** A check that refuses spans over 10, where the rule allows 12. */
const verify = async (_task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
  const span = asRecord(answer)?.span;
  return isNumber(span) && span > 10 ? { kind: "fail", blocking: ["span"] } : { kind: "pass" };
};
const toolUse = { stopReason: "toolUse" } as const;

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
            artifactPaths: [SPAN],
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
  const sessions: (string | undefined)[] = [];
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
    responses.map((message) => (context: TranscriptContext, options?: SimpleStreamOptions) => {
      sent.push(JSON.stringify(context));
      signals.push(options?.signal);
      sessions.push(options?.sessionId);
      return message;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const reader: Reader = { model: faux.getModel(), effort: "medium", models: () => models };
  const log = join(scratch, "log.jsonl");
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  return { checks, log, reader, sent, signals, sessions, record, calls: () => sent.length };
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
    const moved = await probe(SPAN, "10");
    expect(moved.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("1 check moved: span") }),
    ]);
    await probe("$.members[0].area", "5");
    expect(rows.map((row) => row.moved)).toEqual([["span"], []]);
    await expect(probe(SPAN, "ten")).rejects.toThrow("value must be JSON text");
    await expect(probe("$.depth", "1")).rejects.toThrow("$.depth is not an existing field");
    await expect(probe(SPAN, "12")).rejects.toThrow("already carries that value");
    await expect(probe(SPAN, JSON.stringify("x".repeat(4_000)))).rejects.toThrow("at most 4000 characters");
    while (rows.length < PROBE_BUDGET) await probe(SPAN, String(rows.length));
    await expect(probe(SPAN, "1")).rejects.toThrow(`at most ${String(PROBE_BUDGET)} probes`);
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
      fauxAssistantMessage(fauxToolCall("probe_check", { path: SPAN, value: "10" }), toolUse),
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
    const logged = read(s.log).findLast((event) => event.kind === FINDING)?.data;
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
      fauxAssistantMessage(fauxToolCall("probe_check", { path: SPAN, value: "10" }), toolUse),
      ruling({
        ruling: "earned",
        rule: "R1",
        field: SPAN,
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
    expect(read(s.log).map((event) => event.kind)).toEqual([FINDING]);
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
      earned({ rule: "R9", field: SPAN }),
      earned({ rule: "R1", field: "$.depth" }),
      earned({ rule: "R1", field: "$.members[0].area" }),
      fauxAssistantMessage(fauxToolCall("probe_check", { path: SPAN, value: "9" }), toolUse),
      earned({ rule: "R1", field: SPAN, probes: [1] }),
    ]);
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: SPAN,
      probes: [1],
    });
    expect(s.sent[1]).toContain("names the public rule the answer breaks, one a refusing check cites: R1");
    expect(s.sent[2]).toContain("one a refusing check cites: R1");
    expect(s.sent[3]).toContain("a path that exists in the answer");
    expect(s.sent[4]).toContain("no refusing check that cites R1 reads $.members[0].area");
    expect(read(s.log).at(-1)?.data).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: SPAN,
      turns: 6,
    });
  });

  it("refuses an earned ruling as evidence unless its probe moved a refusing check off its refusal, and leaves the fail unclear", async () => {
    // truss-141-m3's rulings of 12 October, replayed in shape: 8 of 8 on `mass-budget` cited a
    // probe that moved nothing, and one of the 12 cited none. A span of 11 is still over the
    // check's 10, so the check refuses it as it refused 12; the members are a field it never reads.
    const earned = (probes: number[]) =>
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Over the limit.", probes });
    const s = setup([
      earned([]),
      fauxAssistantMessage(fauxToolCall("probe_check", { path: SPAN, value: "11" }), toolUse),
      earned([1]),
      fauxAssistantMessage(fauxToolCall("probe_check", { path: "$.members[0].area", value: "1" }), toolUse),
      earned([2]),
      ruling({ ruling: "unclear", reason: "No probe moved the check.", probes: [1, 2] }),
    ]);
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "unclear", probes: [1, 2] });
    const refused =
      "an earned ruling cites a probe that changed $.span and moved a check that cites R1 off its refusal";
    // Each call is sent the whole reading so far: the refusals are one, then two, then three.
    expect([1, 3, 5].map((call) => (s.sent[call] ?? "").split(refused).length - 1)).toEqual([1, 2, 3]);
    expect(read(s.log).at(-1)?.data.probeRows).toEqual([
      expect.objectContaining({ id: 1, moved: [] }),
      expect.objectContaining({ id: 2, moved: [] }),
    ]);
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
      fauxAssistantMessage(fauxToolCall("probe_check", { path: SPAN, value: "10" }), toolUse),
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Too late.", probes: [1] }),
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

  it("logs no ruling where the provider ended the reading before it ruled, so the fail is asked again", async () => {
    // buffer-a's g-5 (12 October): a reading the provider's session limit cut at its first turn was
    // logged unclear, which no caller puts again, and the task it set aside stayed aside.
    const limit = "the account's session limit is reached";
    const s = setup([fauxAssistantMessage("", { stopReason: "error", errorMessage: limit })]);
    failed(s.record);
    expect((await referee(s.reader, fail(s))).ruling).toBeNull();
    expect(read(s.log).findLast((event) => event.kind === FINDING)?.data).toMatchObject({
      ruling: null,
      error: limit,
      walled: false,
    });
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

  // The Claude backend keeps one live query a session id, and a comparison rules its rejections in
  // parallel: two readings begun in one millisecond shared a query until 11 October.
  it("gives two readings begun in the same millisecond two session ids", async () => {
    const unclear = ruling({ ruling: "unclear", reason: "Not settled.", probes: [] });
    const [a, b] = [setup([unclear]), setup([unclear])];
    failed(a.record);
    failed(b.record);
    const clock = spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 11));
    try {
      await Promise.all([referee(a.reader, fail(a)), referee(b.reader, fail(b))]);
    } finally {
      clock.mockRestore();
    }
    expect([a.sessions.length, b.sessions.length]).toEqual([1, 1]);
    expect(a.sessions[0]).not.toBe(b.sessions[0]);
  });
});

describe("the Referee's agreement with hand labels", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const ruled = (solve: string, ruling: string) => ({
    at,
    kind: FINDING,
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

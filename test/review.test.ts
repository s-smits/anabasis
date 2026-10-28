// The Referee's probe evidence, refusals, rulings, replay and trace on the faux provider.
import { afterAll, expect, it, spyOn } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import type { SeatTool } from "../src/agent/session.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { unfinished } from "../src/kernel/trace.ts";
import type { Task, Verdict } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { agreement, clears, unclearReport } from "../src/referee/agreement.ts";
import { type ProbeRow, probeTool } from "../src/referee/probe.ts";
import type { Reader } from "../src/referee/reader.ts";
import { referee } from "../src/referee/referee.ts";

const CANARY = "hidden-canary-r7";
const TASK: Task = { taskId: "t-1", family: "beam", publicInput: { load: 5 }, hidden: { limit: CANARY } };
const CONTRACT: Contract = {
  answerFormat: {},
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "A span is at most 12 m." }],
  scope: "Fixture.",
};
const ANSWER = { span: 12, members: [{ area: 3 }] };
const SPAN = "$.span";
const FINDING: EventKind = "referee.finding";
const PROBE = "probe_check";
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

/** Script one reading and retain each model call's context. */
function setup(responses: ReturnType<typeof fauxAssistantMessage>[], fields: readonly string[] = [SPAN]) {
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
            artifactPaths: fields,
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

function invoke(tool: SeatTool, args: JsonObject) {
  // The probe uses the real cancellation context and no execution API operations.
  return tool.execute(args, undefined!, BACKGROUND_CONTEXT);
}

it("the probe refuses object and array root replacements before running a check", async () => {
  let calls = 0;
  for (const answer of [ANSWER, [1, 2]]) {
    const rows: ProbeRow[] = [];
    const tool = probeTool(
      async () => {
        calls += 1;
        return { kind: "pass" };
      },
      TASK,
      answer,
      rows,
    );
    await expect(invoke(tool, { changes: [{ path: "$", value: "null" }] })).rejects.toThrow("scalar root");
    expect(rows).toHaveLength(0);
  }
  expect(calls).toBe(0);
});

it("the probe caps coupled changes at three paths read together by one refusing check", async () => {
  const rows: ProbeRow[] = [];
  const tool = probeTool(verify, TASK, ANSWER, rows, [[SPAN], ["$.members[0].area"]]);
  await expect(
    invoke(tool, {
      changes: ["9", "8", "7", "6"].map((value) => ({ path: SPAN, value })),
    }),
  ).rejects.toThrow("at most 3 paths");
  await expect(
    invoke(tool, {
      changes: [
        { path: SPAN, value: "9" },
        { path: "$.members[0].area", value: "4" },
      ],
    }),
  ).rejects.toThrow("one refusing check reads together");
  expect(rows).toHaveLength(0);
});

it("the probe replaces a scalar root, including null, with another JSON value", async () => {
  for (const [before, after] of [
    [1, null],
    [null, "text"],
    ["text", 2],
  ] as const) {
    const handed: (JsonValue | undefined)[] = [];
    const rows: ProbeRow[] = [];
    const tool = probeTool(
      async (_task, answer) => {
        handed.push(answer);
        return { kind: "pass" };
      },
      TASK,
      before,
      rows,
    );
    await invoke(tool, { changes: [{ path: "$", value: JSON.stringify(after) }] });
    expect(handed).toEqual([before, after]);
    expect(rows).toHaveLength(1);
  }
});

it("the probe replaces one existing leaf of a copy, and refuses a path the answer lacks", async () => {
  const handed: JsonValue[] = [];
  const seen = async (task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
    handed.push(answer ?? null);
    return verify(task, answer);
  };
  const tool = probeTool(seen, TASK, ANSWER, []);
  const probe = (path: string) => invoke(tool, { changes: [{ path, value: "4" }] });
  await probe("$.members[0].area");
  expect(handed).toEqual([ANSWER, { span: 12, members: [{ area: 4 }] }]);
  await invoke(tool, { changes: [{ path: "$.members", value: '[{"area":5}]' }] });
  expect(handed.at(-1)).toEqual({ span: 12, members: [{ area: 5 }] });
  expect(ANSWER.members[0]?.area).toBe(3);
  for (const path of ["$.members[1].area", "$.depth", "span"]) {
    await expect(probe(path)).rejects.toThrow(`${path} is not an existing field of the answer`);
  }
});

it("the probe says which checks moved, and refuses invalid or unchanged edits", async () => {
  const rows: ProbeRow[] = [];
  const tool = probeTool(verify, TASK, ANSWER, rows);
  const probe = (path: string, value: string) => invoke(tool, { changes: [{ path, value }] });
  const moved = await probe(SPAN, "10");
  expect(moved.output).toEqual([
    expect.objectContaining({ text: expect.stringContaining("1 check moved: span") }),
  ]);
  expect(JSON.stringify(moved.output)).toContain("probe 1 of 8: 7 probes left");
  expect(tool.description).toContain("at most 8 probes");
  await probe("$.members[0].area", "5");
  expect(rows.map((row) => row.moved)).toEqual([["span"], []]);
  await expect(probe(SPAN, "ten")).rejects.toThrow("value must be JSON text");
  await expect(probe("$.depth", "1")).rejects.toThrow("$.depth is not an existing field");
  await expect(probe(SPAN, "12")).rejects.toThrow("already carries that value");
  await expect(probe(SPAN, JSON.stringify("x".repeat(4_000)))).rejects.toThrow("at most 4000 characters");
  await expect(invoke(tool, { changes: [] })).rejects.toThrow("leave the answer unchanged");
  await expect(
    invoke(tool, {
      changes: [
        { path: SPAN, value: "10" },
        { path: SPAN, value: "12" },
      ],
    }),
  ).rejects.toThrow("leave the answer unchanged");
  await expect(
    invoke(tool, {
      changes: [
        { path: SPAN, value: "10" },
        { path: "$.depth", value: "1" },
      ],
    }),
  ).rejects.toThrow("$.depth is not an existing field");
  expect(rows).toHaveLength(2);
  while (rows.length < 7) await probe(SPAN, String(rows.length));
  const last = await probe(SPAN, "99");
  expect(JSON.stringify(last.output)).toContain("none left, so record your ruling");
  await expect(probe(SPAN, "1")).rejects.toThrow("at most 8 probes");
});

it("the probe rewrites one passage inside a text field, where the thing in dispute is one line of a file", async () => {
  const source = { files: { "main.cpp": "int a = min(x, 3);\nint b = max(x, 3);\n" } };
  const handed: string[] = [];
  const standIn = async (_task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
    const given = JSON.stringify(answer);
    handed.push(given);
    return given.includes("min(") ? { kind: "fail", blocking: ["compiles"] } : { kind: "pass" };
  };
  const rows: ProbeRow[] = [];
  const tool = probeTool(standIn, TASK, source, rows);
  const path = "$.files['main.cpp']";
  const edited = await invoke(tool, {
    changes: [{ path, find: "min(x, 3)", replace: "(x < 3 ? x : 3)" }],
  });
  expect(edited.output).toEqual([
    expect.objectContaining({
      text: expect.stringContaining("edited, its one passage of 9 characters rewritten as 15"),
    }),
  ]);
  expect(rows[0]).toMatchObject({
    changes: [{ value: null, edit: { find: "min(x, 3)" } }],
    moved: ["compiles"],
  });
  expect(handed.at(-1)).toContain("int a = (x < 3 ? x : 3);");
  await invoke(tool, { changes: [{ path, find: "max", replace: "$&$1" }] });
  expect(handed.at(-1)).toContain("int b = $&$1(x, 3);");
  await expect(invoke(tool, { changes: [{ path, find: "(x, 3)", replace: "" }] })).rejects.toThrow(
    "is not a text field holding `find` exactly once",
  );
  await expect(invoke(tool, { changes: [{ path, value: '""', find: "min", replace: "" }] })).rejects.toThrow(
    "send either `value`, or `find` with `replace`",
  );
  await expect(invoke(tool, { changes: [{ path }] })).rejects.toThrow(
    "send either `value`, or `find` with `replace`",
  );
});

{
  const failed = (record: ReturnType<typeof setup>["record"]) => {
    record("task.proposed", { taskId: TASK.taskId, version: "v-1" });
    record("verdict", { solve: "s-1", task: "t-1", answer: ANSWER, kind: "fail", blocking: ["span"] });
  };
  const fail = (s: ReturnType<typeof setup>) => ({
    solve: "s-1",
    task: TASK,
    contract: CONTRACT,
    checks: s.checks,
    verify,
    log: s.log,
  });
  const ruling = (args: JsonObject) => fauxAssistantMessage(fauxToolCall("record_ruling", args), toolUse);
  const UNSETTLED = { ruling: "unclear", reason: "Not settled.", probes: [] };

  it("the Referee accepts coupled edits only when their cited probe clears the deciding check", async () => {
    const answer = { left: `${"x".repeat(4_001)}bad`, right: `${"x".repeat(4_001)}bad` };
    const change = (path: string) => ({ path, find: "bad", replace: "good" });
    const s = setup(
      [
        fauxAssistantMessage(fauxToolCall(PROBE, { changes: [change("$.left")] }), toolUse),
        ruling({
          ruling: "earned",
          rule: "R1",
          field: "$",
          reason: "Both texts must end alike.",
          probes: [1],
        }),
        fauxAssistantMessage(
          fauxToolCall(PROBE, { changes: [change("$.left"), change("$.right")] }),
          toolUse,
        ),
        ruling({
          ruling: "earned",
          rule: "R1",
          field: "$",
          reason: "Both texts must end alike.",
          probes: [2],
        }),
      ],
      ["$.left", "$.right"],
    );
    s.record("verdict", { solve: "s-1", task: TASK.taskId, answer, kind: "fail", blocking: ["span"] });
    const finding = await referee(s.reader, {
      ...fail(s),
      verify: async (_task, given) => {
        const texts = asRecord(given);
        return [texts?.left, texts?.right].every((value) => isString(value) && value.endsWith("good"))
          ? { kind: "pass" }
          : { kind: "fail", blocking: ["span"] };
      },
    });
    expect(finding).toMatchObject({ ruling: "earned", field: "$", probes: [2] });
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(1);
    expect(read(s.log).at(-1)?.data.probeRows).toMatchObject([
      { id: 1, moved: [] },
      {
        id: 2,
        moved: ["span"],
        changes: [
          { path: "$.left", edit: { find: "bad", replace: "good" } },
          { path: "$.right", edit: { find: "bad", replace: "good" } },
        ],
      },
    ]);
    expect(answer.left).toEndWith("bad");
  });

  it("the Referee rules a defect on a check with no answer fields only after a conclusive probe", async () => {
    const defect = (probes: number[]) =>
      ruling({
        ruling: "check-defect",
        check: "span",
        reason: "It refuses independently of the answer.",
        probes,
      });
    const s = setup(
      [
        defect([]),
        fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "11" }] }), toolUse),
        defect([1]),
        fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
        defect([2]),
      ],
      [],
    );
    failed(s.record);
    let calls = 0;
    const finding = await referee(s.reader, {
      ...fail(s),
      verify: async () =>
        ++calls === 2
          ? { kind: "faulty", check: "span", reason: "No verdict." }
          : { kind: "fail", blocking: ["span"] },
    });
    expect(finding).toMatchObject({ ruling: "check-defect", check: "span", probes: [2] });
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(2);
    expect(read(s.log).at(-1)?.data.probeRows).toMatchObject([
      { id: 1, changed: { kind: "faulty" } },
      { id: 2, moved: [] },
    ]);
  });

  it("the Referee rules a check-defect only on a probe that decided both sides", async () => {
    const s = setup([
      ruling({ ruling: "check-defect", check: "span", reason: "R1 allows 12.", probes: [] }),
      fauxAssistantMessage(fauxToolCall("read_check_program", { path: "evaluator.ts" }), toolUse),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
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

  it("the Referee refuses a check-defect on a probe the named check never receives", async () => {
    const s = setup([
      fauxAssistantMessage(
        fauxToolCall(PROBE, { changes: [{ path: "$.members[0].area", value: "5" }] }),
        toolUse,
      ),
      ruling({ ruling: "check-defect", check: "span", reason: "The check is too strict.", probes: [1] }),
      ruling({ ruling: "unclear", reason: "No probe on the span yet.", probes: [1] }),
    ]);
    failed(s.record);
    expect((await referee(s.reader, fail(s))).ruling).toBe("unclear");
    expect(s.sent[2]).toContain("span reads $.span, and no cited probe changed that");
  });

  it("the Referee refuses a ruling on a probe whose changed side reached no verdict, and a check-defect on a check that did not refuse", async () => {
    const threw = async (task: Task, answer: JsonValue | undefined): Promise<Verdict> =>
      asRecord(answer)?.span === 11 ? { kind: "non-result", reason: "span: threw" } : verify(task, answer);
    const s = setup([
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "11" }] }), toolUse),
      ruling({ ruling: "check-defect", check: "span", reason: "The check moved.", probes: [1] }),
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "12 m is over 10.", probes: [1] }),
      ruling({ ruling: "check-defect", check: "depth", reason: "The depth check is wrong.", probes: [1] }),
      ruling({ ruling: "unclear", reason: "The probe decided nothing.", probes: [1] }),
    ]);
    failed(s.record);
    expect((await referee(s.reader, { ...fail(s), verify: threw })).ruling).toBe("unclear");
    expect(s.sent[2]).toContain("cites at least one probe whose two sides both reached a verdict");
    expect(s.sent[3]).toContain(
      "an earned ruling cites a probe that changed $.span and moved a check that cites R1 off its refusal",
    );
    expect(s.sent[4]).toContain("a check-defect names one of the refusing checks: span");
  });

  it("the Referee replays the checks once, and the first probe reuses that run", async () => {
    const s = setup([
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
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

  it("the Referee rules a check that does not repeat a check-defect", async () => {
    const s = setup([]);
    failed(s.record);
    expect(await referee(s.reader, { ...fail(s), verify: async () => ({ kind: "pass" }) })).toMatchObject({
      ruling: "check-defect",
      check: "span",
      probes: [],
    });
    expect(read(s.log).at(-1)?.data).toMatchObject({ ruling: "check-defect", replay: { kind: "pass" } });
    expect(s.calls()).toBe(0);
  });

  it("the Referee leaves a replay that reaches no verdict unruled, without a model read", async () => {
    const replays = [
      { kind: "non-result", reason: "the cell timed out" },
      { kind: "faulty", check: "span", reason: "the check threw" },
    ] as const satisfies readonly Verdict[];
    for (const replay of replays) {
      const s = setup([]);
      failed(s.record);
      const finding = await referee(s.reader, { ...fail(s), verify: async () => replay });
      expect(finding).toMatchObject({
        ruling: null,
        reason: `the replay reached no verdict: ${replay.reason}`,
      });
      expect(s.calls()).toBe(0);
      expect(read(s.log).at(-1)?.data).toMatchObject({ ruling: null, replay });
    }
  });

  it("the Referee refuses a solve with no answer on record, writing nothing, and rules an answer outside the format earned unread", async () => {
    const s = setup([]);
    await expect(referee(s.reader, fail(s))).rejects.toThrow(
      "solve s-1 has no answer on record: the Referee rules a rejected answer alone",
    );
    expect(s.calls()).toBe(0);
    expect(read(s.log)).toEqual([]);
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

  it("the Referee holds an earned ruling to the rule the answer breaks and the field that breaks it", async () => {
    const earned = (rest: JsonObject) =>
      ruling({ ruling: "earned", reason: "Over the limit.", probes: [], ...rest });
    const s = setup([
      earned({}),
      earned({ rule: "R9", field: SPAN }),
      earned({ rule: "R1", field: "$.depth" }),
      earned({ rule: "R1", field: "$.members[0].area" }),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "9" }] }), toolUse),
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
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => data.asked)).toEqual([
      { ruling: "earned", reason: "Over the limit.", probes: [] },
      { ruling: "earned", rule: "R9", field: SPAN, reason: "Over the limit.", probes: [] },
      { ruling: "earned", rule: "R1", field: "$.depth", reason: "Over the limit.", probes: [] },
      { ruling: "earned", rule: "R1", field: "$.members[0].area", reason: "Over the limit.", probes: [] },
    ]);
    expect(refused.map(({ data }) => [data.solve, data.task])).toEqual(Array(4).fill(["s-1", "t-1"]));
    expect(refused[3]?.data.why).toContain("no refusing check that cites R1 reads $.members[0].area");
    expect(read(s.log).at(-1)?.kind).toBe(FINDING);
  });

  it("the Referee logs no refusal where the first ruling stands", async () => {
    const s = setup([ruling(UNSETTLED)]);
    failed(s.record);
    expect((await referee(s.reader, fail(s))).ruling).toBe("unclear");
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(0);
  });

  it("the Referee records the ruling it gives after a turn with no call", async () => {
    // On 27 October two esp32 readers answered in prose and were set aside as unruled.
    const s = setup([fauxAssistantMessage("The rejection looks earned."), ruling(UNSETTLED)]);
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "unclear", reason: "Not settled." });
    expect(s.calls()).toBe(2);
  });

  it("the Referee ends after an accepted ruling in a round that also reads a check, in either order", async () => {
    for (const order of ["read-first", "ruling-first"]) {
      const calls = [
        fauxToolCall("read_check_program", { path: "evaluator.ts" }),
        fauxToolCall("record_ruling", UNSETTLED),
      ];
      const s = setup([fauxAssistantMessage(order === "read-first" ? calls : calls.toReversed(), toolUse)]);
      failed(s.record);
      expect((await referee(s.reader, fail(s))).ruling).toBe("unclear");
      expect(s.calls()).toBe(1);
      const trace = read(s.log).filter(({ kind }) => kind === "referee.turn" || kind === "referee.call");
      expect(trace.map(({ kind }) => kind)).toEqual(["referee.turn", "referee.call", "referee.call"]);
      expect(trace[0]?.data.usage).toBeDefined();
      expect(trace[0]?.data.reader).toBe(s.sessions[0]);
      // The finding names the reading it ends, so a ruled reading is billed once.
      expect(read(s.log).at(-1)?.data.reader).toBe(s.sessions[0]);
      expect(unfinished(read(s.log))).toEqual([]);
      expect(trace.slice(1).map(({ data }) => data.tool)).toEqual(
        (order === "read-first" ? calls : calls.toReversed()).map(({ name }) => name),
      );
    }
  });

  it("the Referee refuses an earned ruling as evidence unless its probe moved a refusing check off its refusal, and leaves the fail unclear", async () => {
    const earned = (probes: number[]) =>
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Over the limit.", probes });
    const s = setup([
      earned([]),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "11" }] }), toolUse),
      earned([1]),
      fauxAssistantMessage(
        fauxToolCall(PROBE, { changes: [{ path: "$.members[0].area", value: "1" }] }),
        toolUse,
      ),
      earned([2]),
      ruling({ ruling: "unclear", reason: "No probe moved the check.", probes: [1, 2] }),
    ]);
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "unclear", probes: [1, 2] });
    // Each of the three earned rulings is refused on record, and its reason reaches the reader next.
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => asRecord(data.asked)?.probes)).toEqual([[], [1], [2]]);
    refused.forEach(({ data }, index) => {
      expect(s.sent[[1, 3, 5][index] ?? 0]).toContain(JSON.stringify(data.why).slice(1, -1));
    });
    expect(read(s.log).at(-1)?.data.probeRows).toEqual([
      expect.objectContaining({ id: 1, moved: [] }),
      expect.objectContaining({ id: 2, moved: [] }),
    ]);
  });

  it("the Referee gives the Referee the whole public contract", async () => {
    const s = setup([ruling({ ruling: "unclear", reason: "The contract leaves this open.", probes: [] })]);
    failed(s.record);
    const contract = {
      ...CONTRACT,
      answerFormat: { type: "object", required: ["span"] },
      objective: { quantity: "material", direction: "lower" } as const,
    };
    await referee(s.reader, { ...fail(s), contract });
    expect(s.sent[0]).toContain(JSON.stringify(JSON.stringify(contract)).slice(1, -1));
  });

  it("the Referee reads an author's accepted answer by task version, and skips proofs without an answer", async () => {
    const unclear = ruling({ ruling: "unclear", reason: "The evidence leaves this open.", probes: [] });
    const s = setup([unclear, unclear]);
    failed(s.record);
    s.record("task.proposed", { taskId: "t-2", version: "v-2" });
    s.record("task.feasible", { version: "v-1", answer: { span: 9, members: [] } });
    s.record("task.feasible", { version: "v-2", answer: { span: 1, members: [] } });
    s.record("task.feasible", { version: "v-1" });
    await referee(s.reader, fail(s));
    expect(s.sent[0]).toContain(
      String.raw`An answer the checks accepted for this task: {\"span\":9,\"members\":[]}`,
    );
    s.record("verdict", { solve: "s-0", task: TASK.taskId, kind: "pass", answer: null });
    await referee(s.reader, fail(s));
    expect(s.sent[1]).toContain("An answer the checks accepted for this task: null");
  });

  it("the Referee sets an answer the checks accepted for the task beside the one under review", async () => {
    const unclear = ruling(UNSETTLED);
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

  it("the Referee refuses a whole-answer swap and an accepted projection as defect evidence, but admits a disputed-field probe", async () => {
    const accepted = { span: 9, members: [] };
    const defect = (probes: number[]) =>
      ruling({ ruling: "check-defect", check: "span", reason: "The public rule permits this span.", probes });
    const s = setup([
      fauxAssistantMessage(
        fauxToolCall(PROBE, { changes: [{ path: "$", value: JSON.stringify(accepted) }] }),
        toolUse,
      ),
      defect([1]),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "9" }] }), toolUse),
      defect([1]),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
      defect([2]),
    ]);
    failed(s.record);
    s.record("task.feasible", { version: "v-1", answer: accepted });
    s.record("verdict", { solve: "s-0", task: TASK.taskId, kind: "pass", answer: { span: 8, members: [] } });
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "check-defect", probes: [2] });
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused).toHaveLength(2);
    expect(refused[1]?.data.why).toContain("accepted answer");
    expect(read(s.log).at(-1)?.data.probeRows).toMatchObject([
      { id: 1, changes: [{ path: SPAN, value: "9" }] },
      { id: 2, changes: [{ path: SPAN, value: "10" }] },
    ]);
  });

  it("the Referee ends a reading at its wall, and says so in the finding", async () => {
    const s = setup([
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Too late.", probes: [1] }),
    ]);
    failed(s.record);
    let runs = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const slow = async (
      task: Task,
      answer: JsonValue | undefined,
      signal?: AbortSignal,
    ): Promise<Verdict> => {
      runs += 1;
      signals.push(signal);
      if (runs > 1) {
        if (signal === undefined) return { kind: "non-result", reason: "the verifier was not cancellable" };
        const stopped = Promise.withResolvers<Verdict>();
        const stop = () => stopped.resolve({ kind: "non-result", reason: "the verifier was cancelled" });
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
        try {
          return await stopped.promise;
        } finally {
          signal.removeEventListener("abort", stop);
        }
      }
      return verify(task, answer);
    };
    const finding = await referee({ ...s.reader, wallSeconds: 0.05 }, { ...fail(s), verify: slow });
    expect(finding.ruling).toBe("unclear");
    expect(read(s.log).at(-1)?.data).toMatchObject({ walled: true, ruling: "unclear" });
    expect(signals.at(-1)?.aborted).toBe(true);
  });

  it("the Referee leaves the fail unclear when the reader never rules", async () => {
    // Each turn with no call is answered once more, until the reader's cap of 24 turns.
    const s = setup(Array.from({ length: 24 }, () => fauxAssistantMessage("The check looks right to me.")));
    failed(s.record);
    expect(await referee(s.reader, fail(s))).toMatchObject({
      ruling: "unclear",
      reason: "the Referee recorded no ruling",
    });
    expect(s.calls()).toBe(24);
  });

  it("the Referee logs no ruling where the provider ended the reading before it ruled, so the fail is asked again", async () => {
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

  it("the Referee ends the model's query once the session returns", async () => {
    const s = setup([fauxAssistantMessage("The check looks right to me.")]);
    failed(s.record);
    await referee(s.reader, fail(s));
    expect(s.signals).toHaveLength(1);
    expect(s.signals[0]?.aborted).toBe(true);
  });

  it("the Referee gives two readings begun in the same millisecond two session ids", async () => {
    const unclear = ruling(UNSETTLED);
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
}

{
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

  it("agreement with hand labels counts the last ruling of each labelled fail against its label", () => {
    const measured = agreement(events, labels);
    expect(measured.table["check-defect"]).toEqual({ earned: 1, "check-defect": 1, unclear: 0 });
    expect(measured.table.earned).toEqual({ earned: 1, "check-defect": 1, unclear: 1 });
    expect(measured).toMatchObject({ caught: 0.5, unruled: [] });
    expect(measured.voided).toBeCloseTo(2 / 3);
    expect(agreement(events, new Map([["e", "check-defect"]] as const)).caught).toBe(1);
    expect(measured.specific).toEqual({ earned: 2 / 5, "check-defect": 2 / 4, unclear: 0 });
    expect(measured.observed).toBeCloseTo(2 / 5);
    expect(measured.kappa).toBeCloseTo(0);
    expect(measured.pabak).toBeCloseTo(0.1);
    expect(agreement(events, new Map())).toMatchObject({ observed: null, kappa: null, pabak: null });
    expect(agreement(events, new Map([["c", "earned"]] as const))).toMatchObject({
      specific: { earned: 1, "check-defect": null, unclear: null },
      observed: 1,
      kappa: null,
      pabak: 1,
    });
  });

  it("agreement with hand labels clears a bar written beforehand on thirty labels or more, and nothing when a label is unruled or a rate has no fails", () => {
    const times = [0, 1, 2, 3, 4, 5];
    const many = times.flatMap((n) =>
      events.map((event) => ({
        ...event,
        data: { ...event.data, solve: `${event.data.solve}${String(n)}` },
      })),
    );
    const thirty = new Map(
      times.flatMap((n) => [...labels].map(([solve, label]) => [`${solve}${String(n)}`, label] as const)),
    );
    const measured = agreement(many, thirty);
    expect(clears(measured, { caught: 0.5, voided: 0.7 })).toBe(true);
    expect(clears(measured, { caught: 0.5, voided: 0.4 })).toBe(false);
    expect(clears(measured, { caught: 0.8, voided: 0.7 })).toBe(false);
    expect(clears(measured, { caught: 0.5, voided: 0.1 })).toBe(false);
    const fewer = new Map([...thirty].filter(([solve]) => solve !== "c0"));
    expect(clears(agreement(many, fewer), { caught: 0, voided: 1 })).toBe(false);
    expect(clears(agreement(events, labels), { caught: 0, voided: 1 })).toBe(false);
    expect(clears(agreement(many, new Map([...thirty, ["z", "earned"]])), { caught: 0, voided: 1 })).toBe(
      false,
    );
    const noDefects = agreement(many, new Map([...thirty].filter(([, label]) => label === "earned")));
    expect(noDefects.caught).toBeNull();
    expect(clears(noDefects, { caught: 0, voided: 1 })).toBe(false);
  });

  it("agreement with hand labels says so when a person labels more than one in four unclear rulings earned, and gates nothing", () => {
    const unclear = ["u1", "u2", "u3", "u4"].map((solve) => ruled(solve, "unclear"));
    const labelled = (earned: number) =>
      agreement(
        unclear,
        new Map(
          ["u1", "u2", "u3", "u4"].map(
            (solve, index) => [solve, index < earned ? "earned" : "unclear"] as const,
          ),
        ),
      );
    expect(labelled(1).unclearEarned).toBe(0.25);
    expect(unclearReport(labelled(1))).toBeNull();
    expect(labelled(2).unclearEarned).toBe(0.5);
    // The report counts the earned labels over the unclear rulings.
    expect(unclearReport(labelled(2))).toContain("2 of the Referee's 4 unclear rulings");
    expect(agreement(events, new Map([["c", "earned"]] as const)).unclearEarned).toBeNull();
    expect(unclearReport(agreement(events, new Map([["c", "earned"]] as const)))).toBeNull();
  });
}

// The Referee's probe evidence, refusals, rulings, replay and trace on the faux provider.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import type { SeatTool } from "../src/agent/session.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { Cancellation } from "../src/kernel/solve.ts";
import type { Task, Verdict, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { agreement, clears } from "../src/referee/agreement.ts";
import { type ProbeRow, probeTool } from "../src/referee/probe.ts";
import type { Reader } from "../src/referee/reader.ts";
import { referee } from "../src/referee/referee.ts";
import { containing, copies, objectWith } from "./helpers/matchers.ts";

// SAFETY: the probe uses only the context's abort signal, no tool API methods.
const UNUSED_API = undefined as never;
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
const scratch = mkdtempSync(join(tmpdir(), "ana-review-"));
const programs = new Map<string, string>();
let readings = 0;
const UNSETTLED = { ruling: "unclear", reason: "Not settled.", probes: [] };
/** A check that refuses spans over 10, where the rule allows 12. */
const verify = async (_task: Task, answer: JsonValue | undefined): Promise<Verdict> => {
  const span = asRecord(answer)?.span;
  return isNumber(span) && span > 10 ? { kind: "fail", blocking: ["span"] } : { kind: "pass" };
};
const toolUse = { stopReason: "toolUse" } as const;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeAll(() => {
  for (const fields of [[SPAN], [], ["$.left", "$.right"]]) {
    const checks = join(scratch, `checks-${programs.size}`);
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
    programs.set(JSON.stringify(fields), checks);
  }
});

/** Each reading owns its log and provider; only the immutable check programs are shared. */
function setup(
  responses: ReturnType<typeof fauxAssistantMessage>[],
  fields: readonly string[] = [SPAN],
  seeded: "answer" | "empty" = "answer",
) {
  const checks = programs.get(JSON.stringify(fields));
  if (checks === undefined) throw new Error("no check program for these fields");
  const sent: string[] = [];
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
    responses.map((message) => (context: TranscriptContext) => {
      sent.push(JSON.stringify(context));
      return message;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const reader: Reader = { model: faux.getModel(), effort: "medium", models: () => models };
  const log = join(scratch, `reading-${++readings}.jsonl`);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  if (seeded === "answer") {
    record("task.proposed", { taskId: TASK.taskId, version: "v-1" });
    record("verdict", { solve: "s-1", task: TASK.taskId, answer: ANSWER, kind: "fail", blocking: ["span"] });
  }
  return { checks, log, reader, sent, record, calls: () => sent.length };
}

function invoke(tool: SeatTool, args: JsonObject) {
  // The probe uses the real cancellation context and no execution API operations.
  return tool.execute(args, UNUSED_API, BACKGROUND_CONTEXT);
}

describe("the probe", () => {
  it("the probe refuses object and array root replacements before running a check", async () => {
    let calls = 0;
    const counted = async () => {
      calls += 1;
      return { kind: "pass" } as const;
    };
    for (const answer of [ANSWER, [1, 2]]) {
      const rows: ProbeRow[] = [];
      const tool = probeTool(counted, TASK, answer, rows);
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

  it("the probe says which checks moved, and refuses invalid or unchanged edits", async () => {
    const rows: ProbeRow[] = [];
    const tool = probeTool(verify, TASK, ANSWER, rows);
    const probe = (path: string, value: string) => invoke(tool, { changes: [{ path, value }] });
    const moved = await probe(SPAN, "10");
    expect(moved.output).toEqual([objectWith({ text: containing("1 check moved: span") })]);
    expect(JSON.stringify(moved.output)).toContain("probe 1 of 8: 7 probes left");
    expect(tool.description).toContain("at most 8 probes");
    await probe("$.members[0].area", "5");
    expect(rows.map((row) => row.moved)).toEqual([["span"], []]);
    for (const [changes, fact] of [
      [[{ path: SPAN, value: "ten" }], /JSON/u],
      [[{ path: "$.depth", value: "1" }], /\$\.depth.*existing field/u],
      [[{ path: SPAN, value: "12" }], /already.*value/u],
      [[{ path: SPAN, value: JSON.stringify("x".repeat(4000)) }], /4000/u],
      [[], /unchanged/u],
      [
        [
          { path: SPAN, value: "10" },
          { path: SPAN, value: "12" },
        ],
        /unchanged/u,
      ],
      [
        [
          { path: SPAN, value: "10" },
          { path: "$.depth", value: "1" },
        ],
        /\$\.depth.*existing field/u,
      ],
    ] satisfies [JsonObject[], RegExp][]) {
      await expect(invoke(tool, { changes })).rejects.toThrow(fact);
    }
    expect(rows).toHaveLength(2);
    while (rows.length < 7) await probe(SPAN, String(rows.length));
    const last = await probe(SPAN, "99");
    expect(JSON.stringify(last.output)).toMatch(/probe 8 of 8.*none left/u);
    await expect(probe(SPAN, "1")).rejects.toThrow("at most 8 probes");
  });
});

const fail = (s: ReturnType<typeof setup>) => ({
  solve: "s-1",
  task: TASK,
  contract: CONTRACT,
  checks: s.checks,
  verify,
  log: s.log,
});
const ruling = (args: JsonObject) => fauxAssistantMessage(fauxToolCall("record_ruling", args), toolUse);

describe("coupled and check-defect evidence", () => {
  it("the Referee accepts coupled edits only when their cited probe clears the deciding check", async () => {
    const answer = { left: `${"x".repeat(4001)}bad`, right: `${"x".repeat(4001)}bad` };
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
});

describe("deciding check-defect probes", () => {
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
    const finding = await referee(s.reader, fail(s));
    expect(finding).toEqual({
      ruling: "check-defect",
      check: "span",
      rule: null,
      field: null,
      reason: "R1 allows 12; the check stops at 10.",
      probes: [1],
    });
    expect(
      read(s.log)
        .filter(({ kind }) => kind === "referee.refused")
        .map(({ data }) => data.asked),
    ).toMatchObject([{ ruling: "check-defect", probes: [] }]);
    expect(s.sent[2]).toContain("// span <= 10");
    expect(s.sent[0]).toContain(CANARY);
    for (const fact of ["span", "R1", "A span is at most 12 m.", SPAN]) expect(s.sent[0]).toContain(fact);
    const logged = read(s.log).findLast((event) => event.kind === FINDING)?.data;
    expect(logged).toMatchObject({ solve: "s-1", task: "t-1", ruling: "check-defect", turns: 4 });
    expect(logged?.probeRows).toEqual([objectWith({ id: 1, moved: ["span"] })]);
    expect(logged?.replay).toEqual({ kind: "fail", blocking: ["span"] });
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
    expect((await referee(s.reader, { ...fail(s), verify: threw })).ruling).toBe("unclear");
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => data.asked)).toMatchObject([
      { ruling: "check-defect", check: "span", probes: [1] },
      { ruling: "earned", rule: "R1", field: SPAN, probes: [1] },
      { ruling: "check-defect", check: "depth", probes: [1] },
    ]);
    const reasons = [/two sides.*verdict/u, /earned.*\$\.span.*R1.*refusal/u, /refusing checks.*span/u];
    for (const [index, { data }] of refused.entries()) {
      expect(data.why).toMatch(reasons[index] ?? /missing refusal/u);
      expect(s.sent[index + 2]).toContain(JSON.stringify(data.why).slice(1, -1));
    }
  });
});

describe("host replay", () => {
  it("rules a changed replay a defect and leaves an undecided replay unruled without a model read", async () => {
    for (const [replay, expected] of [
      [{ kind: "pass" }, { ruling: "check-defect", check: "span", probes: [] }],
      [
        { kind: "non-result", reason: "the cell timed out" },
        { ruling: null, reason: containing("the cell timed out") },
      ],
      [
        { kind: "faulty", check: "span", reason: "the check threw" },
        { ruling: null, reason: containing("the check threw") },
      ],
    ] satisfies [Verdict, JsonObject][]) {
      const s = setup([]);
      expect(await referee(s.reader, { ...fail(s), verify: async () => replay })).toMatchObject(expected);
      expect(s.calls()).toBe(0);
      expect(read(s.log).at(-1)?.data).toMatchObject({ ...expected, replay });
    }
  });

  it("the Referee refuses a solve with no answer on record, writing nothing, and rules an answer outside the format earned unread", async () => {
    const s = setup([], [SPAN], "empty");
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
      reason: containing("span is not a number"),
    });
    expect(s.calls()).toBe(0);
  });
});

describe("earned evidence", () => {
  it("the Referee holds an earned ruling to the rule the answer breaks and the field that breaks it", async () => {
    const earned = (rest: JsonObject) =>
      ruling({ ruling: "earned", reason: "Over the limit.", probes: [], ...rest });
    const invalid: JsonObject[] = [
      {},
      { rule: "R9", field: SPAN },
      { rule: "R1", field: "$.depth" },
      { rule: "R1", field: "$.members[0].area" },
    ];
    const s = setup([
      ...invalid.map(earned),
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "9" }] }), toolUse),
      earned({ rule: "R1", field: SPAN, probes: [1] }),
    ]);
    expect(await referee(s.reader, fail(s))).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: SPAN,
      probes: [1],
    });
    expect(read(s.log).at(-1)?.data).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: SPAN,
      turns: 6,
    });
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => data.asked)).toEqual(
      invalid.map((rest) => ({ ruling: "earned", reason: "Over the limit.", probes: [], ...rest })),
    );
    const reasons = [/rule.*R1/u, /rule.*R1/u, /exists.*answer/u, /R1.*\$\.members\[0\]\.area/u];
    for (const [index, { data }] of refused.entries()) {
      expect(data.why).toMatch(reasons[index] ?? /missing refusal/u);
    }
    expect(refused.map(({ data }) => [data.solve, data.task])).toEqual(copies(4, ["s-1", "t-1"]));
    for (const [index, { data }] of refused.entries()) {
      expect(s.sent[index + 1]).toContain(JSON.stringify(data.why).slice(1, -1));
    }
    expect(read(s.log).at(-1)?.kind).toBe(FINDING);
  });

  it("the Referee records the ruling it gives after a turn with no call", async () => {
    // On 27 October two esp32 readers answered in prose and were set aside as unruled.
    const s = setup([fauxAssistantMessage("The rejection looks earned."), ruling(UNSETTLED)]);
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "unclear", reason: "Not settled." });
    expect(s.calls()).toBe(2);
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
    expect(await referee(s.reader, fail(s))).toMatchObject({ ruling: "unclear", probes: [1, 2] });
    // Each of the three earned rulings is refused on record, and its reason reaches the reader next.
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => asRecord(data.asked)?.probes)).toEqual([[], [1], [2]]);
    for (const [index, { data }] of refused.entries()) {
      expect(s.sent[[1, 3, 5][index] ?? 0]).toContain(JSON.stringify(data.why).slice(1, -1));
    }
    expect(read(s.log).at(-1)?.data.probeRows).toEqual([
      objectWith({ id: 1, moved: [] }),
      objectWith({ id: 2, moved: [] }),
    ]);
  });
});

describe("accepted answers and reading limits", () => {
  it("the Referee sets an answer the checks accepted for the task beside the one under review", async () => {
    const unclear = ruling(UNSETTLED);
    const s = setup([unclear, unclear]);
    await referee(s.reader, fail(s));
    expect(s.sent[0]).not.toContain(String.raw`\"span\":9`);
    s.record("verdict", { solve: "s-0", task: "t-1", answer: { span: 9, members: [] }, kind: "pass" });
    s.record("verdict", { solve: "s-9", task: "t-2", answer: { span: 1, members: [] }, kind: "pass" });
    await referee(s.reader, fail(s));
    expect(s.sent[1]).toContain(String.raw`{\"span\":9,\"members\":[]}`);
    expect(s.sent[1]).not.toContain(String.raw`{\"span\":1,\"members\":[]}`);
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

  it("the Referee logs no ruling where the provider ended the reading before it ruled, so the fail is asked again", async () => {
    const limit = "the account's session limit is reached";
    const s = setup([fauxAssistantMessage("", { stopReason: "error", errorMessage: limit })]);
    expect((await referee(s.reader, fail(s))).ruling).toBeNull();
    expect(read(s.log).findLast((event) => event.kind === FINDING)?.data).toMatchObject({
      ruling: null,
      error: limit,
      walled: false,
    });
  });

  it("the Referee logs no ruling, and names the cause, where a kill ended the reading between turns", async () => {
    const kill = new AbortController();
    const s = setup([
      fauxAssistantMessage(fauxToolCall(PROBE, { changes: [{ path: SPAN, value: "10" }] }), toolUse),
    ]);
    // The replay runs first; the probe's run is where the campaign's budget runs out.
    let runs = 0;
    const stopping: Verifier = async (task, answer) => {
      runs += 1;
      if (runs > 1) kill.abort(new Cancellation("campaign-budget"));
      return verify(task, answer);
    };
    expect(
      (await referee({ ...s.reader, kill: kill.signal }, { ...fail(s), verify: stopping })).ruling,
    ).toBeNull();
    expect(read(s.log).findLast((event) => event.kind === FINDING)?.data).toMatchObject({
      ruling: null,
      cancelledBy: "campaign-budget",
      error: null,
      walled: false,
    });
  });
});

describe("agreement with hand labels", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const ruled = (solve: string, decision: string) => ({
    at,
    kind: FINDING,
    data: { solve, ruling: decision },
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
    for (const [caught, voided, expected] of [
      [0.5, 0.7, true],
      [0.5, 0.4, false],
      [0.8, 0.7, false],
      [0.5, 0.1, false],
    ] as const) {
      expect(clears(measured, { caught, voided })).toBe(expected);
    }
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
});

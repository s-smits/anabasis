// Behavioural and boundary tests for Referee probes (`src/audit/probe.ts`), rejection
// adjudication (`src/audit/auditor.ts`), adversarial draft audits (`src/audit/draft-audit.ts`),
// and hand-label agreement (`src/audit/agreement.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AgentTool } from "../src/agent/session.ts";
import { type AnswerFile, keepAnswerFiles, shownFiles } from "../src/kernel/answer-files.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { billedBetween } from "../src/kernel/meter.ts";
import { Cancellation } from "../src/kernel/solve.ts";
import { unfinished } from "../src/kernel/trace.ts";
import type { Task, Verdict, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  agreement,
  clears,
  passAgreement,
  settledPassLabels,
  unclearReport,
  VERDICT_BAR,
} from "../src/audit/agreement.ts";
import { replayDraftProbes, reviewDraft } from "../src/audit/draft-audit.ts";
import { type DraftProbeRow, type ProbeRow, probeExamplesTool, probeTool } from "../src/audit/probe.ts";
import { type Reader, auditRejection } from "../src/audit/auditor.ts";
import { containing, copies, matching, objectWith } from "./helpers/matchers.ts";
import { zipOf } from "./helpers/zip.ts";

// SAFETY: probe tools read only `context.abortSignal` and touch no execution API methods.
const UNUSED_API = undefined as never;
const CANARY = "hidden-canary-r7";
const TASK: Task = { taskId: "t-1", family: "beam", publicInput: { load: 5 }, hidden: { limit: CANARY } };
const CONTRACT: Contract = {
  answerFormat: { type: "object" },
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "A span is at most 12 m." }],
  scope: "Fixture.",
};
const ANSWER = { span: 12, members: [{ area: 3 }] };
const SPAN = "$.span";
const CONTROL = { taskId: "t-1", answer: ANSWER, refusedBy: null };
const AREA = "$.members[0].area";
const BOOK = "file:book.xlsx";
const MEMBER = `${BOOK}/xl/sharedStrings.xml`;
const FINDING: EventKind = "referee.finding";
const PROBE = "probe_check";
const UNSETTLED = { ruling: "unclear", reason: "Not settled.", probes: [] };
const TOOL_USE = { stopReason: "toolUse" } as const;

const scratch = mkdtempSync(join(tmpdir(), "ana-review-"));
const programs = new Map<string, string>();
let readings = 0;

/** Refuses spans > 10 where R1 allows 12. */
const verify: Verifier = async (_task, answer) => {
  const span = asRecord(answer)?.span;
  return isNumber(span) && span > 10 ? { kind: "fail", blocking: ["span"] } : { kind: "pass" };
};

const callTool = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE);
const ruling = (args: JsonObject) => callTool("record_ruling", args);
const reviewCall = (args: JsonObject) => callTool("record_draft_review", args);
const invoke = (tool: AgentTool, args: JsonObject) => tool.execute(args, UNUSED_API, BACKGROUND_CONTEXT);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeAll(() => {
  const specs: readonly [string, readonly string[], readonly string[]][] = [
    [JSON.stringify([SPAN]), [SPAN], []],
    [JSON.stringify([]), [], []],
    [JSON.stringify(["$.left", "$.right"]), ["$.left", "$.right"], []],
    ["files", [], ["$"]],
  ];
  for (const [key, artifactPaths, filePaths] of specs) {
    const checks = join(scratch, `checks-${String(programs.size)}`);
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
              artifactPaths,
              ...keyIfDefined("filePaths", filePaths.length > 0 ? filePaths : undefined),
              publicInputPaths: [],
              hidden: "none",
              evidence: { kind: "authored" },
            },
          },
        ],
      }),
    );
    writeFileSync(join(checks, "evaluator.ts"), "// span <= 10\n");
    programs.set(key, checks);
  }
});

function setup(
  responses: ReturnType<typeof fauxAssistantMessage>[],
  key: string = JSON.stringify([SPAN]),
  seeded: "answer" | "empty" = "answer",
) {
  const checks = programs.get(key);
  if (checks === undefined) throw new Error(`missing check program ${key}`);
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
  const log = join(scratch, `reading-${String(++readings)}.jsonl`);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  if (seeded === "answer") {
    record("task.proposed", { taskId: TASK.taskId, version: "v-1" });
    record("verdict", { solve: "s-1", task: TASK.taskId, answer: ANSWER, kind: "fail", blocking: ["span"] });
  }
  return {
    checks,
    log,
    reader,
    sent,
    record,
    calls: () => sent.length,
    fail: (over: Partial<Parameters<typeof auditRejection>[1]> = {}) => ({
      solve: "s-1",
      task: TASK,
      contract: CONTRACT,
      checks,
      verify,
      log,
      ...over,
    }),
  };
}

describe("answer and file probes", () => {
  it("blocks root replacement, enforces change-count and readTogether caps, and tracks the 8-probe budget", async () => {
    let calls = 0;
    const counted: Verifier = async () => {
      calls += 1;
      return { kind: "pass" };
    };
    for (const answer of [ANSWER, [1, 2]]) {
      const rows: ProbeRow[] = [];
      await expect(
        invoke(probeTool(counted, TASK, answer, rows), { changes: [{ path: "$", value: "null" }] }),
      ).rejects.toThrow("scalar root");
      expect(rows).toHaveLength(0);
    }
    expect(calls).toBe(0);

    const coupledRows: ProbeRow[] = [];
    const coupled = probeTool(verify, TASK, ANSWER, coupledRows, { readTogether: [[SPAN], [AREA]] });
    await expect(
      invoke(coupled, { changes: ["9", "8", "7", "6"].map((value) => ({ path: SPAN, value })) }),
    ).rejects.toThrow("at most 3 paths");
    await expect(
      invoke(coupled, {
        changes: [
          { path: SPAN, value: "9" },
          { path: AREA, value: "4" },
        ],
      }),
    ).rejects.toThrow("one refusing check reads together");
    expect(coupledRows).toHaveLength(0);

    const rows: ProbeRow[] = [];
    const tool = probeTool(verify, TASK, ANSWER, rows);
    const probe = (path: string, value: string) => invoke(tool, { changes: [{ path, value }] });
    const moved = await probe(SPAN, "10");
    expect(moved.output).toEqual([objectWith({ text: containing("1 check moved: span") })]);
    expect(JSON.stringify(moved.output)).toContain("$.span replaced with 10");
    expect(JSON.stringify(moved.output)).toContain("probe 1 of 8: 7 probes left");
    expect(tool.description).toContain("at most 8 probes");
    const fileRows: ProbeRow[] = [];
    const fileTool = probeTool(verify, TASK, ANSWER, fileRows, {
      files: [{ path: "report.txt", base64: "YmFk", text: "bad" }],
    });
    await expect(
      invoke(fileTool, { changes: [{ path: "file:report.txt", value: '"bad"' }] }),
    ).rejects.toThrow("JSON string");
    await probe(AREA, "5");
    expect(rows.map((r) => r.moved)).toEqual([["span"], []]);

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
    expect(JSON.stringify((await probe(SPAN, "99")).output)).toMatch(/probe 8 of 8.*none left/u);
    await expect(probe(SPAN, "1")).rejects.toThrow("at most 8 probes");
  });

  it("caps replacement length to max(4000, current field, accepted field at same path)", async () => {
    const members = (area: number) => Array.from({ length: 900 }, () => ({ area }));
    const long = { span: 12, members: members(3), note: "x".repeat(200) };
    const longRows: ProbeRow[] = [];
    const longTool = probeTool(verify, TASK, long, longRows);
    await invoke(longTool, { changes: [{ path: "$.members", value: JSON.stringify(members(4)) }] });
    await expect(
      invoke(longTool, { changes: [{ path: "$.note", value: JSON.stringify("y".repeat(9000)) }] }),
    ).rejects.toThrow(/4000/u);
    await expect(
      invoke(longTool, { changes: [{ path: "$.note", find: "xx", replace: "y".repeat(9000) }] }),
    ).rejects.toThrow(/4000/u);
    expect(longRows).toHaveLength(1);

    const wide = members(4);
    const offered = JSON.stringify(wide);
    const shortRows: ProbeRow[] = [];
    await expect(
      invoke(probeTool(verify, TASK, ANSWER, shortRows), {
        changes: [{ path: "$.members", value: offered }],
      }),
    ).rejects.toThrow(/4000/u);
    const acceptedTool = probeTool(verify, TASK, ANSWER, shortRows, {
      accepted: { span: 12, members: wide },
    });
    await invoke(acceptedTool, { changes: [{ path: "$.members", value: offered }] });
    for (const change of [
      { path: "$.members", value: JSON.stringify([...wide, ...wide]) },
      { path: SPAN, value: offered },
    ]) {
      await expect(invoke(acceptedTool, { changes: [change] })).rejects.toThrow(/4000/u);
    }
    expect(shortRows).toHaveLength(1);
  });

  it("supports multi-example draft probes with cached originals, objective output, and bounded archive previews", async () => {
    let originalCalls = 0;
    const measured: Verifier = async (_task, answer) => {
      const span = asRecord(answer)?.span;
      if (span === 12) originalCalls += 1;
      return isNumber(span) && span <= 12
        ? { kind: "pass", objective: span }
        : { kind: "fail", blocking: ["span"] };
    };
    const rows: DraftProbeRow[] = [];
    const tool = probeExamplesTool(measured, [{ task: TASK, answer: ANSWER }], rows);
    await expect(invoke(tool, { task: "missing", changes: [{ path: SPAN, value: "9" }] })).rejects.toThrow(
      "unknown example task",
    );
    const first = await invoke(tool, { task: "t-1", changes: [{ path: SPAN, value: "9" }] });
    expect(JSON.stringify(first.output)).toContain("objective 9");
    await invoke(tool, { task: "t-1", changes: [{ path: SPAN, value: "20" }] });
    expect(originalCalls).toBe(1);
    expect(rows.map((r) => [r.task, r.changed.kind])).toEqual([
      ["t-1", "pass"],
      ["t-1", "fail"],
    ]);

    for (const [count, text, expectedShown] of [
      [70, "x".repeat(8192), 63],
      [20_000, '"', null],
      [400, "語".repeat(3000), null],
    ] as const) {
      const entries = Array.from({ length: count }, (_none, at) => ({ path: String(at), text }));
      const manifest = [{ path: "deck.pptx", bytes: 0, sha256: "0".repeat(64) }];
      const [deck] = shownFiles("unread.jsonl", manifest, [{ path: "deck.pptx", base64: "", entries }]);
      const listed = asRecord(deck)?.entries;
      const length = Array.isArray(listed) ? listed.length : 0;
      expect(Buffer.byteLength(JSON.stringify(listed))).toBeLessThanOrEqual(64 * 4096);
      expect(asRecord(deck)?.unlisted).toBe(count - length);
      if (expectedShown !== null) expect(length).toBe(expectedShown);
    }
  });
});

describe("host replay shortcuts", () => {
  it("refuses missing answers, rules format faults earned unread, and settles non-reproducing replays without calling the model", async () => {
    const empty = setup([], JSON.stringify([SPAN]), "empty");
    await expect(auditRejection(empty.reader, empty.fail())).rejects.toThrow(
      "solve s-1 has no answer on record: the Referee rules a rejected answer alone",
    );
    expect(empty.calls()).toBe(0);
    expect(read(empty.log)).toEqual([]);

    empty.record("verdict", {
      solve: "s-1",
      task: "t-1",
      answer: ANSWER,
      kind: "fail",
      fault: "span is not a number",
    });
    expect(await auditRejection(empty.reader, empty.fail())).toMatchObject({
      ruling: "earned",
      reason: containing("span is not a number"),
    });
    expect(empty.calls()).toBe(0);

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
      expect(await auditRejection(s.reader, s.fail({ verify: async () => replay }))).toMatchObject(expected);
      expect(s.calls()).toBe(0);
      expect(read(s.log).at(-1)?.data).toMatchObject({ ...expected, replay });
    }
  });
});

describe("rejection adjudication and evidence gates", () => {
  it("presents task context, check program, and same-task accepted answers, and settles check-defect rulings", async () => {
    const s = setup([
      callTool("read_check_program", { path: "evaluator.ts" }),
      callTool(PROBE, { changes: [{ path: SPAN, value: "10" }] }),
      ruling({
        ruling: "check-defect",
        check: "span",
        reason: "R1 allows 12; the check stops at 10.",
        probes: [1],
      }),
    ]);
    const finding = await auditRejection(s.reader, s.fail());
    expect(finding).toEqual({
      ruling: "check-defect",
      check: "span",
      rule: null,
      field: null,
      reason: "R1 allows 12; the check stops at 10.",
      probes: [1],
    });
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(0);
    expect(s.sent[1]).toContain("// span <= 10");
    for (const fact of [CANARY, "span", "R1", "A span is at most 12 m.", SPAN, "30 minutes"]) {
      expect(s.sent[0]).toContain(fact);
    }
    expect(read(s.log).findLast((e) => e.kind === FINDING)?.data).toMatchObject({
      solve: "s-1",
      task: "t-1",
      ruling: "check-defect",
      turns: 3,
      probeRows: [objectWith({ id: 1, moved: ["span"] })],
      replay: { kind: "fail", blocking: ["span"] },
    });

    const noFields = setup(
      [
        ruling({
          ruling: "check-defect",
          check: "span",
          reason: "Refuses independently of answer.",
          probes: [],
        }),
      ],
      JSON.stringify([]),
    );
    expect(await auditRejection(noFields.reader, noFields.fail())).toMatchObject({
      ruling: "check-defect",
      check: "span",
      probes: [],
    });

    // Accepted answer shown only for the same task, never another task.
    const peer = setup([ruling(UNSETTLED), ruling(UNSETTLED)]);
    await auditRejection(peer.reader, peer.fail());
    expect(peer.sent[0]).not.toContain(String.raw`\"span\":9`);
    peer.record("verdict", { solve: "s-0", task: "t-1", answer: { span: 9, members: [] }, kind: "pass" });
    peer.record("verdict", { solve: "s-9", task: "t-2", answer: { span: 1, members: [] }, kind: "pass" });
    await auditRejection(peer.reader, peer.fail());
    expect(peer.sent[1]).toContain(String.raw`{\"span\":9,\"members\":[]}`);
    expect(peer.sent[1]).not.toContain(String.raw`{\"span\":1,\"members\":[]}`);
  });

  it("refuses ungrounded earned and check-defect rulings with logged reasons and accepts grounded coupled edits", async () => {
    // Earned refusal matrix: missing rule, unknown rule, missing field, unread field.
    const earned = (rest: JsonObject) =>
      ruling({ ruling: "earned", reason: "Over the limit.", probes: [], ...rest });
    const invalid: JsonObject[] = [
      {},
      { rule: "R9", field: SPAN },
      { rule: "R1", field: "$.depth" },
      { rule: "R1", field: AREA },
    ];
    const s = setup([
      ...invalid.map(earned),
      callTool(PROBE, { changes: [{ path: SPAN, value: "9" }] }),
      earned({ rule: "R1", field: SPAN, probes: [1] }),
    ]);
    expect(await auditRejection(s.reader, s.fail())).toMatchObject({
      ruling: "earned",
      rule: "R1",
      field: SPAN,
      probes: [1],
    });
    const refused = read(s.log).filter(({ kind }) => kind === "referee.refused");
    expect(refused.map(({ data }) => [data.solve, data.task])).toEqual(copies(4, ["s-1", "t-1"]));
    const patterns = [/rule.*R1/u, /rule.*R1/u, /exists.*answer/u, /R1.*\$\.members\[0\]\.area/u];
    for (const [i, { data }] of refused.entries()) {
      expect(data.why).toMatch(patterns[i] ?? /missing/u);
      expect(s.sent[i + 1]).toContain(JSON.stringify(data.why).slice(1, -1));
    }

    // Inconclusive / non-moving probes refused for earned & check-defect; prose turn tolerated before ruling.
    const threw: Verifier = async (task, answer) =>
      asRecord(answer)?.span === 11 ? { kind: "non-result", reason: "span: threw" } : verify(task, answer);
    const gate = setup([
      callTool(PROBE, { changes: [{ path: SPAN, value: "11" }] }),
      callTool(PROBE, { changes: [{ path: SPAN, value: "13" }] }),
      callTool(PROBE, { changes: [{ path: SPAN, value: "10" }] }),
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Inconclusive.", probes: [1] }),
      ruling({ ruling: "check-defect", check: "depth", reason: "Wrong check.", probes: [3] }),
      ruling({ ruling: "check-defect", check: "span", reason: "Did not move.", probes: [1, 2] }),
      fauxAssistantMessage("Thinking aloud."),
      ruling({ ruling: "check-defect", check: "span", reason: "R1 allows 12.", probes: [3] }),
    ]);
    expect(await auditRejection(gate.reader, gate.fail({ verify: threw }))).toMatchObject({
      ruling: "check-defect",
      check: "span",
      probes: [3],
    });
    expect(
      read(gate.log)
        .filter(({ kind }) => kind === "referee.refused")
        .map(({ data }) => data.why),
    ).toEqual([
      matching(/earned.*\$\.span.*R1.*refusal/u),
      matching(/refusing checks.*span/u),
      matching(/probe that moved span off its refusal/u),
    ]);

    // Coupled passage edits require moving the deciding check and never mutate the original answer.
    const coupledAnswer = { left: `${"x".repeat(4001)}bad`, right: `${"x".repeat(4001)}bad` };
    const edit = (path: string) => ({ path, find: "bad", replace: "good" });
    const coupled = setup(
      [
        callTool(PROBE, { changes: [edit("$.left")] }),
        ruling({ ruling: "earned", rule: "R1", field: "$", reason: "Both must match.", probes: [1] }),
        callTool(PROBE, { changes: [edit("$.left"), edit("$.right")] }),
        ruling({ ruling: "earned", rule: "R1", field: "$", reason: "Both must match.", probes: [2] }),
      ],
      JSON.stringify(["$.left", "$.right"]),
    );
    coupled.record("verdict", {
      solve: "s-1",
      task: TASK.taskId,
      answer: coupledAnswer,
      kind: "fail",
      blocking: ["span"],
    });
    const coupledFinding = await auditRejection(
      coupled.reader,
      coupled.fail({
        verify: async (_task, given) => {
          const rec = asRecord(given);
          return [rec?.left, rec?.right].every((v) => isString(v) && v.endsWith("good"))
            ? { kind: "pass" }
            : { kind: "fail", blocking: ["span"] };
        },
      }),
    );
    expect(coupledFinding).toMatchObject({ ruling: "earned", field: "$", probes: [2] });
    expect(read(coupled.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(1);
    expect(coupledAnswer.left).toEndWith("bad");
  });

  it("grounds no check-defect ruling on a probe whose change breaks the answer format", async () => {
    const typed = { ...CONTRACT, answerFormat: { type: "object", properties: { span: { type: "number" } } } };
    const s = setup([
      callTool(PROBE, { changes: [{ path: SPAN, value: '"12"' }] }),
      ruling({ ruling: "check-defect", check: "span", reason: "A span of 12 passes as text.", probes: [1] }),
      ruling(UNSETTLED),
    ]);
    expect(await auditRejection(s.reader, s.fail({ contract: typed }))).toMatchObject({ ruling: "unclear" });
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(1);
  });

  it("handles submitted text files and archive members across replay, probes, and rulings", async () => {
    // Text file replay, packet preview without base64, and file-based earned ruling.
    const textFile = [{ path: "report.txt", base64: "YmFk", text: "bad" }];
    const s = setup(
      [
        callTool(PROBE, { changes: [{ path: SPAN, value: "10" }] }),
        ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Wrong field.", probes: [1] }),
        callTool(PROBE, { changes: [{ path: "file:report.txt", find: "bad", replace: "good" }] }),
        ruling({
          ruling: "earned",
          rule: "R1",
          field: "file:report.txt",
          reason: "The report.",
          probes: [2],
        }),
      ],
      "files",
    );
    s.record("verdict", {
      solve: "s-1",
      task: TASK.taskId,
      answer: ANSWER,
      files: keepAnswerFiles(s.log, textFile).map((f) => ({ ...f })),
      kind: "fail",
      blocking: ["span"],
    });
    const seen: (readonly AnswerFile[] | undefined)[] = [];
    const fileFinding = await auditRejection(
      s.reader,
      s.fail({
        verify: async (_t, _a, _sig, files) => {
          seen.push(files);
          return files?.[0]?.text === "good" ? { kind: "pass" } : { kind: "fail", blocking: ["span"] };
        },
      }),
    );
    expect(fileFinding).toMatchObject({ ruling: "earned", field: "file:report.txt", probes: [2] });
    expect(seen.slice(0, 2)).toEqual([textFile, textFile]);
    expect(s.sent[0]).toContain("reads file:$");
    expect(s.sent[0]).toContain(String.raw`\"text\":\"bad\"`);
    expect(s.sent[0]).not.toContain("YmFk");

    // Archive member probes: whole-archive and missing-member rejected before verify; ruling stands on BOOK or MEMBER.
    const book = zipOf([
      ["xl/sharedStrings.xml", "<t>bad</t>", true],
      ["xl/worksheets/sheet1.xml", "<v>bad</v>", false],
    ]).toString("base64");
    for (const field of [BOOK, MEMBER]) {
      const z = setup(
        [
          callTool(PROBE, { changes: [{ path: BOOK, value: '"good"' }] }),
          callTool(PROBE, { changes: [{ path: `${BOOK}/xl/none.xml`, find: "bad", replace: "good" }] }),
          callTool(PROBE, { changes: [{ path: MEMBER, find: "bad", replace: "good" }] }),
          ruling({
            ruling: "earned",
            rule: "R1",
            field: `${BOOK}/xl/none.xml`,
            reason: "Missing.",
            probes: [1],
          }),
          ruling({ ruling: "earned", rule: "R1", field, reason: "The label.", probes: [1] }),
        ],
        "files",
      );
      z.record("verdict", {
        solve: "s-1",
        task: TASK.taskId,
        answer: ANSWER,
        files: keepAnswerFiles(z.log, [{ path: "book.xlsx", base64: book }]).map((f) => ({ ...f })),
        kind: "fail",
        blocking: ["span"],
      });
      const given: (readonly AnswerFile[] | undefined)[] = [];
      expect(
        await auditRejection(
          z.reader,
          z.fail({
            verify: async (_t, _a, _sig, files) => {
              given.push(files);
              return files?.[0]?.entries?.[0]?.text === "<t>good</t>"
                ? { kind: "pass" }
                : { kind: "fail", blocking: ["span"] };
            },
          }),
        ),
      ).toMatchObject({ ruling: "earned", field, probes: [1] });
      expect(read(z.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(1);
      expect(given).toHaveLength(2);
      expect(given.at(-1)?.[0]?.base64).toBe(book);
      expect(given.at(-1)?.[0]?.entries?.[1]).toEqual({
        path: "xl/worksheets/sheet1.xml",
        text: "<v>bad</v>",
      });
      expect(z.sent[0]).toContain("<t>bad</t>");
      expect(z.sent[0]).not.toContain(book);
    }
  });

  it("handles wall timeouts, provider errors, and kill cancellations cleanly", async () => {
    // Wall timeout aborts verifier signal and records unclear with walled: true.
    const wall = setup([
      callTool(PROBE, { changes: [{ path: SPAN, value: "10" }] }),
      ruling({ ruling: "earned", rule: "R1", field: SPAN, reason: "Too late.", probes: [1] }),
    ]);
    let runs = 0;
    const signals: (AbortSignal | undefined)[] = [];
    const slow: Verifier = async (task, answer, signal) => {
      runs += 1;
      signals.push(signal);
      if (runs === 1) return verify(task, answer);
      const stopped = Promise.withResolvers<Verdict>();
      const stop = () => stopped.resolve({ kind: "non-result", reason: "cancelled" });
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted === true) stop();
      return stopped.promise;
    };
    expect(
      (await auditRejection({ ...wall.reader, wallSeconds: 0.05 }, wall.fail({ verify: slow }))).ruling,
    ).toBe("unclear");
    expect(read(wall.log).at(-1)?.data).toMatchObject({ walled: true, ruling: "unclear" });
    expect(signals.at(-1)?.aborted).toBe(true);

    const limit = "the account's session limit is reached";
    const errored = setup([fauxAssistantMessage("", { stopReason: "error", errorMessage: limit })]);
    expect((await auditRejection(errored.reader, errored.fail())).ruling).toBeNull();
    expect(read(errored.log).findLast((e) => e.kind === FINDING)?.data).toMatchObject({
      ruling: null,
      error: limit,
      walled: false,
    });

    const kill = new AbortController();
    const killed = setup([callTool(PROBE, { changes: [{ path: SPAN, value: "10" }] })]);
    let killRuns = 0;
    expect(
      (
        await auditRejection(
          { ...killed.reader, kill: kill.signal },
          killed.fail({
            verify: async (task, answer) => {
              if (++killRuns > 1) kill.abort(new Cancellation("campaign-budget"));
              return verify(task, answer);
            },
          }),
        )
      ).ruling,
    ).toBeNull();
    expect(read(killed.log).findLast((e) => e.kind === FINDING)?.data).toMatchObject({
      ruling: null,
      error: null,
      walled: false,
    });
  });
});

describe("adversarial draft audit", () => {
  it("enforces probe evidence for vacuous-pass and check-defect findings and fails open on silence or empty controls", async () => {
    const checks = programs.get(JSON.stringify([SPAN]));
    if (checks === undefined) throw new Error("missing check program");
    const vacuousVerify: Verifier = async (_task, answer) =>
      asRecord(answer)?.span === -1 ? { kind: "fail", blocking: ["span"] } : { kind: "pass", objective: 10 };

    // Refuses sound-with-findings, empty defects, unknown probe, mismatched task, wrong changed verdict, wrong check id, and objective-defect on fail; reads example deliverables; then accepts grounded defects across all three classes.
    const s = setup([
      callTool("read_example_file", { path: "t-1/results.csv" }),
      reviewCall({
        verdict: "sound",
        findings: [{ kind: "vacuous-pass", task: "t-1", probe: 1, reason: "contradiction" }],
        summary: "bad sound",
      }),
      reviewCall({ verdict: "defects", findings: [], summary: "empty" }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "t-1", probe: 1, reason: "no probe yet" }],
        summary: "missing probe",
      }),
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "999" }] }),
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "-1" }] }),
      callTool(PROBE, { task: "t-1", changes: [{ path: "file:results.csv", value: "null" }] }),
      callTool(PROBE, { task: "t-1", changes: [{ path: "file:missing.csv", value: "null" }] }),
      callTool(PROBE, {
        task: "t-1",
        changes: [
          { path: "file:results.csv", value: "null" },
          { path: "file:results.csv", value: JSON.stringify("a,b\n1,2\n") },
        ],
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "t-2", probe: 1, reason: "wrong task" }],
        summary: "task mismatch",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "t-1", probe: 2, reason: "actually failed" }],
        summary: "wrong kind for fail",
      }),
      reviewCall({
        verdict: "defects",
        findings: [
          { kind: "objective-defect", task: "t-1", probe: 2, reason: "failed probe has no objective" },
        ],
        summary: "wrong kind for objective-defect",
      }),
      reviewCall({
        verdict: "defects",
        findings: [
          { kind: "objective-defect", task: "t-1", item: "report", probe: 1, reason: "no item scored" },
        ],
        summary: "item on a probe that scored no items",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "t-1", item: "report", probe: 3, reason: "item off kind" }],
        summary: "item on a vacuous-pass",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "check-defect", task: "t-1", probe: 1, reason: "actually passed" }],
        summary: "wrong kind for pass",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "check-defect", task: "t-1", probe: 2, reason: "missing check id" }],
        summary: "missing check id",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "check-defect", task: "t-1", check: "other", probe: 2, reason: "wrong check" }],
        summary: "wrong check id",
      }),
      reviewCall({
        verdict: "defects",
        findings: [
          { kind: "vacuous-pass", task: "t-1", probe: 3, reason: "removing results.csv still passed" },
          { kind: "check-defect", task: "t-1", check: "span", probe: 2, reason: "span=-1 blocked by span" },
          {
            kind: "objective-defect",
            task: "t-1",
            probe: 1,
            reason: "corrupted span=999 scored identical 10",
          },
        ],
        summary: "three probe-verified findings",
      }),
    ]);
    const target = {
      session: "d-1",
      pass: 2,
      prompt: "Keep spans <= 12 m.",
      contract: { ...CONTRACT, objective: { quantity: "score", direction: "higher" as const } },
      checks,
      verify: vacuousVerify,
      tasks: [TASK],
      controls: [
        {
          taskId: "t-1",
          answer: ANSWER,
          files: [{ path: "results.csv", base64: "YSxiCjEsMgo=", text: "a,b\n1,2\n" }],
          refusedBy: null,
        },
      ],
      notes: ["note-1"],
      priorFindings: ["prior-finding-1"],
      log: s.log,
    };
    const res = await reviewDraft(s.reader, target);
    expect(res.verdict).toBe("defects");
    expect(res.findings).toHaveLength(3);
    expect(res.probes).toHaveLength(3);
    expect(res.probes[2]?.texts).toEqual([
      { path: "file:results.csv", was: { lines: 2, bytes: 8 }, now: null },
    ]);
    expect(read(s.log).filter(({ kind }) => kind === "referee.refused")).toHaveLength(0);
    const draftRefused = read(s.log).filter(({ kind }) => kind === "referee.draft.refused");
    expect(draftRefused).toHaveLength(11);
    expect(draftRefused.every(({ data }) => data.pass === 2)).toBe(true);
    expect(read(s.log).filter(({ kind }) => kind === "referee.draft")).toMatchObject([{ data: { pass: 2 } }]);
    expect(unfinished(read(s.log))).toEqual([]);
    expect(billedBetween(read(s.log), 0)).toBeGreaterThanOrEqual(0);
    expect(s.sent[0]).toContain("note-1");
    expect(s.sent[0]).toContain("prior-finding-1");
    expect(s.sent[0]).toContain("file:results.csv");
    expect(s.sent[1]).toContain(String.raw`a,b\n1,2\n`);

    // Large example publicInput.files are bounded in the draft-audit opening and readable via read_task_file.
    const bigTail = "DRAFT_AUDIT_TAIL_999";
    const bigInputCsv = `id,x\n${"1,abcdefghij0123456789\n".repeat(1200)}999,${bigTail}\n`;
    let draftVerifiedLen = 0;
    const taskWithBigFile: Task = {
      ...TASK,
      publicInput: { files: [{ path: "inputs/big.csv", text: bigInputCsv }] },
    };
    const bigSetup = setup([
      callTool("read_task_file", {}),
      callTool("read_task_file", { path: "t-1/inputs/big.csv", from: bigInputCsv.length - 40 }),
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "999" }] }),
      reviewCall({ verdict: "sound", findings: [], summary: "checked input and probe" }),
    ]);
    const bigRes = await reviewDraft(bigSetup.reader, {
      ...target,
      contract: CONTRACT,
      tasks: [taskWithBigFile],
      verify: async (task, answer, signal, files) => {
        const list = asRecord(task.publicInput)?.files;
        const first = Array.isArray(list) ? asRecord(list[0]) : null;
        if (isString(first?.text)) draftVerifiedLen = first.text.length;
        return vacuousVerify(task, answer, signal, files);
      },
      log: bigSetup.log,
    });
    expect(bigRes.verdict).toBe("sound");
    expect(bigSetup.sent[0]).not.toContain(bigTail);
    expect(bigSetup.sent[0]?.length ?? 0).toBeLessThan(15_000);
    expect(bigSetup.sent[1]).toContain("t-1/inputs/big.csv");
    expect(bigSetup.sent[2]).toContain(bigTail);
    expect(draftVerifiedLen).toBe(bigInputCsv.length);

    const noControls = setup([]);
    expect(
      (await reviewDraft(noControls.reader, { ...target, controls: [], log: noControls.log })).verdict,
    ).toBe("skipped");
    expect(noControls.calls()).toBe(0);

    // Silence or provider error fails open as `skipped`.
    for (const response of [
      fauxAssistantMessage("No tool call."),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider down" }),
    ]) {
      const open = setup([response]);
      expect((await reviewDraft(open.reader, { ...target, log: open.log })).verdict).toBe("skipped");
    }

    // Objective-bearing exams require at least one passing probe whose perturbation actually moves the objective before `sound`.
    const objectiveContract = { ...CONTRACT, objective: { quantity: "score", direction: "lower" as const } };
    const sensitiveVerify: Verifier = async (_task, answer, _signal, files) => {
      if (asRecord(answer)?.span === -1) return { kind: "fail", blocking: ["span"] };
      if ((files ?? []).length === 0) return { kind: "pass", objective: 10 };
      return { kind: "pass", objective: asRecord(answer)?.span === 999 ? 50 : 10 };
    };
    const gated = setup([
      reviewCall({ verdict: "sound", findings: [], summary: "premature sound without probe" }),
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "-1" }] }),
      reviewCall({ verdict: "sound", findings: [], summary: "failing probe does not measure objective" }),
      callTool(PROBE, { task: "t-1", changes: [{ path: "file:results.csv", value: "null" }] }),
      reviewCall({ verdict: "sound", findings: [], summary: "file probe left objective unchanged" }),
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "999" }] }),
      reviewCall({ verdict: "sound", findings: [], summary: "sound after objective-moving probe" }),
    ]);
    const gatedRes = await reviewDraft(gated.reader, {
      ...target,
      contract: objectiveContract,
      verify: sensitiveVerify,
      verifiedFixed: ["vacuous-pass on t-1, probe #1: fixed"],
      priorFindings: [],
      log: gated.log,
    });
    expect(gatedRes.verdict).toBe("sound");
    expect(read(gated.log).filter(({ kind }) => kind === "referee.draft.refused")).toHaveLength(3);
    expect(gated.sent[0]).toContain("one replayed probe, not a fresh test");

    // `replayDraftProbes` flags persisting defects, verifies fixed ones at $0, and leaves inconclusive/missing probes unverified.
    const sameStill = await replayDraftProbes(res, {
      contract: objectiveContract,
      verify: vacuousVerify,
      tasks: [TASK],
      controls: target.controls,
    });
    expect(sameStill.stillBroken).toHaveLength(3);
    expect(sameStill.verifiedFixed).toEqual([]);
    expect(sameStill.unverified).toEqual([]);

    const fixedVerify: Verifier = async (_task, answer, _signal, files) => {
      if ((files ?? []).length === 0) return { kind: "fail", blocking: ["files"] };
      return { kind: "pass", objective: asRecord(answer)?.span === 999 ? 50 : 10 };
    };
    const fixedReplay = await replayDraftProbes(res, {
      contract: objectiveContract,
      verify: fixedVerify,
      tasks: [TASK],
      controls: target.controls,
    });
    expect(fixedReplay.stillBroken).toEqual([]);
    expect(fixedReplay.verifiedFixed).toHaveLength(3);
    expect(fixedReplay.unverified).toEqual([]);

    const crashedVerify: Verifier = async () => ({ kind: "non-result", reason: "sandbox down" });
    const crashedReplay = await replayDraftProbes(res, {
      contract: objectiveContract,
      verify: crashedVerify,
      tasks: [TASK],
      controls: target.controls,
    });
    expect(crashedReplay.stillBroken).toEqual([]);
    expect(crashedReplay.verifiedFixed).toEqual([]);
    expect(crashedReplay.unverified).toHaveLength(3);
  });
});

describe("draft audit on a check that throws", () => {
  it("accepts check-defect on the check a valid alternative makes throw, and only on that check", async () => {
    const checks = programs.get(JSON.stringify([SPAN]));
    if (checks === undefined) throw new Error("missing check program");
    const throwing: Verifier = async (_task, answer) =>
      asRecord(answer)?.span === -2
        ? { kind: "faulty", check: "span", reason: "the check threw" }
        : { kind: "pass", objective: 10 };
    const s = setup([
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "-2" }] }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "check-defect", task: "t-1", check: "other", probe: 1, reason: "wrong check" }],
        summary: "wrong check id",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "t-1", probe: 1, reason: "a throw is no pass" }],
        summary: "wrong kind for a throw",
      }),
      reviewCall({
        verdict: "defects",
        findings: [{ kind: "check-defect", task: "t-1", check: "span", probe: 1, reason: "span=-2 throws" }],
        summary: "throwing check",
      }),
    ]);
    const res = await reviewDraft(s.reader, {
      session: "d-1",
      pass: 1,
      prompt: "Keep spans <= 12 m.",
      contract: CONTRACT,
      checks,
      verify: throwing,
      tasks: [TASK],
      controls: [CONTROL],
      notes: [],
      log: s.log,
    });
    expect(res.findings).toMatchObject([{ kind: "check-defect", check: "span", probe: 1 }]);
    expect(read(s.log).filter(({ kind }) => kind === "referee.draft.refused")).toHaveLength(2);
    expect(s.sent.join("\n")).toContain("made check span throw");

    const target = {
      contract: CONTRACT,
      tasks: [TASK],
      controls: [CONTROL],
    };
    expect(await replayDraftProbes(res, { ...target, verify: throwing })).toMatchObject({
      stillBroken: [expect.stringContaining("still reproduces")],
      unverified: [],
    });
    const mended: Verifier = async () => ({ kind: "pass", objective: 10 });
    expect((await replayDraftProbes(res, { ...target, verify: mended })).verifiedFixed).toHaveLength(1);
  });

  it("refuses check-defect on a throw from an answer the answer format already refuses", async () => {
    const checks = programs.get(JSON.stringify([SPAN]));
    if (checks === undefined) throw new Error("missing check program");
    const s = setup([
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: '"x"' }] }),
      reviewCall({
        verdict: "defects",
        findings: [
          { kind: "check-defect", task: "t-1", check: "span", probe: 1, reason: "a string span throws" },
        ],
        summary: "throwing check",
      }),
      reviewCall({ verdict: "sound", findings: [], summary: "nothing a campaign reaches" }),
    ]);
    const res = await reviewDraft(s.reader, {
      session: "d-1",
      pass: 1,
      prompt: "Keep spans <= 12 m.",
      contract: { ...CONTRACT, answerFormat: { type: "object", properties: { span: { type: "number" } } } },
      checks,
      verify: async (_task, answer) =>
        isNumber(asRecord(answer)?.span)
          ? { kind: "pass", objective: 10 }
          : { kind: "faulty", check: "span", reason: "the check threw" },
      tasks: [TASK],
      controls: [CONTROL],
      notes: [],
      log: s.log,
    });
    expect(res.findings).toEqual([]);
    expect(read(s.log).filter(({ kind }) => kind === "referee.draft.refused")).toHaveLength(1);
  });
});

describe("draft audit replay of an objective defect", () => {
  it("reproduces while the scored item stands, and leaves it to a fresh audit once the revision drops the item", async () => {
    const scored =
      (scores: Record<string, number>): Verifier =>
      async () => ({ kind: "pass", objective: 0.9, scores });
    const both = { accuracy: 0.9, report: 1 };
    const prior = {
      verdict: "defects" as const,
      summary: "report item reads keywords only",
      findings: [
        {
          kind: "objective-defect" as const,
          task: "t-1",
          item: "report",
          probe: 1,
          reason: "wrong report keeps report=1",
        },
      ],
      probes: [
        {
          id: 1,
          task: "t-1",
          changes: [{ path: SPAN, value: "13", edit: null }],
          texts: [],
          original: { kind: "pass" as const, objective: 0.9, scores: both },
          changed: { kind: "pass" as const, objective: 0.9, scores: both },
          moved: [],
        },
      ],
    };
    const target = {
      contract: { ...CONTRACT, objective: { quantity: "score", direction: "higher" as const } },
      tasks: [TASK],
      controls: [CONTROL],
    };
    expect(await replayDraftProbes(prior, { ...target, verify: scored(both) })).toMatchObject({
      stillBroken: [expect.stringContaining("still reproduces")],
      unverified: [],
    });
    expect(await replayDraftProbes(prior, { ...target, verify: scored({ report: 1 }) })).toMatchObject({
      stillBroken: [expect.stringContaining("still reproduces")],
    });
    expect(await replayDraftProbes(prior, { ...target, verify: scored({ accuracy: 0.9 }) })).toMatchObject({
      stillBroken: [],
      verifiedFixed: [],
      unverified: [expect.stringContaining("objective-defect on t-1")],
    });
    const scalar: Verifier = async () => ({ kind: "pass", objective: 0.9 });
    expect(await replayDraftProbes(prior, { ...target, verify: scalar })).toMatchObject({
      unverified: [expect.stringContaining("objective-defect on t-1")],
    });
    for (const [changed, fixed] of [
      [0.995, false],
      [0.98, true],
      [0.5, true],
    ] as const) {
      const fix: Verifier = async (_task, answer) => ({
        kind: "pass",
        objective: 0.9,
        scores: { accuracy: 0.9, report: asRecord(answer)?.span === 12 ? 1 : changed },
      });
      const replay = await replayDraftProbes(prior, { ...target, verify: fix });
      expect([replay.stillBroken.length, replay.verifiedFixed.length]).toEqual(fixed ? [0, 1] : [1, 0]);
    }
  });

  it("admits an objective-defect only on a scored item its own probe left standing", async () => {
    const checks = programs.get(JSON.stringify([SPAN]));
    if (checks === undefined) throw new Error("missing check program");
    const finding = (item?: string) => ({
      verdict: "defects",
      findings: [
        {
          kind: "objective-defect",
          task: "t-1",
          ...keyIfDefined("item", item),
          probe: 1,
          reason: "span=13 scores",
        },
      ],
      summary: item ?? "unnamed",
    });
    const s = setup([
      callTool(PROBE, { task: "t-1", changes: [{ path: SPAN, value: "13" }] }),
      reviewCall(finding("report")),
      reviewCall(finding("missing")),
      reviewCall(finding()),
      reviewCall(finding("accuracy")),
    ]);
    const itemScores: Verifier = async (_task, answer) => ({
      kind: "pass",
      objective: 0.9,
      scores: { accuracy: 0.9, report: asRecord(answer)?.span === 12 ? 1 : 0.5 },
    });
    const res = await reviewDraft(s.reader, {
      session: "d-1",
      prompt: "Keep spans <= 12 m.",
      contract: { ...CONTRACT, objective: { quantity: "score", direction: "higher" as const } },
      checks,
      verify: itemScores,
      tasks: [TASK],
      controls: [CONTROL],
      notes: [],
      priorFindings: [],
      log: s.log,
    });
    expect(res.findings).toMatchObject([{ item: "accuracy" }]);
    expect(read(s.log).filter(({ kind }) => kind === "referee.draft.refused")).toHaveLength(3);
  });
});

describe("hand-label agreement", () => {
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

  it("scores last rulings against hand labels and enforces the 30-label clearing bar", () => {
    const measured = agreement(events, labels);
    expect(measured.table["check-defect"]).toEqual({ earned: 1, "check-defect": 1, unclear: 0 });
    expect(measured.table.earned).toEqual({ earned: 1, "check-defect": 1, unclear: 1 });
    expect(measured).toMatchObject({
      caught: 0.5,
      unclearEarned: 1,
      unruled: [],
      specific: { earned: 2 / 5, "check-defect": 2 / 4, unclear: 0 },
    });
    expect(measured.voided).toBeCloseTo(2 / 3);
    expect(measured.observed).toBeCloseTo(2 / 5);
    expect(measured.kappa).toBeCloseTo(0);
    expect(measured.pabak).toBeCloseTo(0.1);
    const nonZeroKappa = agreement(
      [
        ruled("k1", "earned"),
        ruled("k2", "earned"),
        ruled("k3", "check-defect"),
        ruled("k4", "check-defect"),
      ],
      new Map([
        ["k1", "earned"],
        ["k2", "earned"],
        ["k3", "check-defect"],
        ["k4", "earned"],
      ] as const),
    );
    expect(nonZeroKappa.kappa).toBeCloseTo(0.5);
    expect(VERDICT_BAR).toEqual({ caught: 0.75, voided: 0.1 });
    expect(agreement(events, new Map([["e", "check-defect"]] as const)).caught).toBe(1);
    expect(agreement(events, new Map())).toMatchObject({ observed: null, kappa: null, pabak: null });
    expect(agreement(events, new Map([["c", "earned"]] as const))).toMatchObject({
      specific: { earned: 1, "check-defect": null, unclear: null },
      unclearEarned: null,
      observed: 1,
      kappa: null,
      pabak: 1,
    });

    const times = [0, 1, 2, 3, 4, 5];
    const many = times.flatMap((n) =>
      events.map((e) => ({ ...e, data: { ...e.data, solve: `${e.data.solve}${String(n)}` } })),
    );
    const thirty = new Map(
      times.flatMap((n) => [...labels].map(([k, v]) => [`${k}${String(n)}`, v] as const)),
    );
    const full = agreement(many, thirty);
    for (const [caught, voided, expected] of [
      [0.5, 0.7, true],
      [0.5, 2 / 3, true],
      [0.5, 0.4, false],
      [0.8, 0.7, false],
      [0.5, 0.1, false],
    ] as const) {
      expect(clears(full, { caught, voided })).toBe(expected);
    }
    expect(
      clears(agreement(many, new Map([...thirty].filter(([k]) => k !== "c0"))), { caught: 0, voided: 1 }),
    ).toBe(false);
    expect(clears(agreement(many, new Map([...thirty, ["z", "earned"]])), { caught: 0, voided: 1 })).toBe(
      false,
    );
    const ten = Array.from({ length: 10 }, (_, n) => n);
    const tenfold = ten.flatMap((n) =>
      events.map((e) => ({ ...e, data: { ...e.data, solve: `${e.data.solve}${String(n)}` } })),
    );
    const fifty = new Map(ten.flatMap((n) => [...labels].map(([k, v]) => [`${k}${String(n)}`, v] as const)));
    const defects = [...fifty].flatMap(([k, v]) => (v === "check-defect" ? [k] : []));
    const keepDefects = (kept: number) =>
      new Map([...fifty].filter(([k]) => !defects.slice(kept).includes(k)));
    expect(clears(agreement(tenfold, keepDefects(8)), { caught: 0, voided: 1 })).toBe(true);
    expect(clears(agreement(tenfold, keepDefects(7)), { caught: 0, voided: 1 })).toBe(false);
    const noDefects = agreement(many, new Map([...thirty].filter(([, v]) => v === "earned")));
    expect(noDefects.caught).toBeNull();
    expect(clears(noDefects, { caught: 0, voided: 1 })).toBe(false);

    expect(unclearReport(agreement(events, new Map([["c", "earned"]] as const)))).toBeNull();
    const unclearOf = (earnedCount: number, defectCount: number) => {
      const total = earnedCount + defectCount;
      const evs = Array.from({ length: total }, (_, i) => ruled(`u-${String(i)}`, "unclear"));
      const lbls = new Map(
        Array.from(
          { length: total },
          (_, i) => [`u-${String(i)}`, i < earnedCount ? "earned" : "check-defect"] as const,
        ),
      );
      return unclearReport(agreement(evs, lbls));
    };
    expect(unclearOf(1, 3)).toBeNull();
    expect(unclearOf(2, 5)).toMatch(/\b2\b.*\b7\b/u);
  });

  it("parses settled pass labels and clears at 20 decided labels with at most 10% wrong", () => {
    const parsed = settledPassLabels([
      {
        at: "2026-11-22T00:00:00Z",
        kind: "comparison.reported",
        data: {
          session: "g-1",
          settled: { passes: { p1: "sound", p2: "wrong", p3: "unclear", p4: "ignored" } },
        },
      },
    ]);
    expect([...parsed.entries()]).toEqual([
      ["p1", "sound"],
      ["p2", "wrong"],
      ["p3", "unclear"],
    ]);
    expect(passAgreement(parsed)).toEqual({
      counts: { sound: 1, wrong: 1, unclear: 1 },
      total: 3,
      decided: 2,
      wrongRate: 0.5,
      clears: false,
    });
    expect(passAgreement(new Map())).toEqual({
      counts: { sound: 0, wrong: 0, unclear: 0 },
      total: 0,
      decided: 0,
      wrongRate: null,
      clears: false,
    });
    const mk = (s: number, w: number, u: number) =>
      new Map([
        ...Array.from({ length: s }, (_, i) => [`s-${String(i)}`, "sound" as const] as const),
        ...Array.from({ length: w }, (_, i) => [`w-${String(i)}`, "wrong" as const] as const),
        ...Array.from({ length: u }, (_, i) => [`u-${String(i)}`, "unclear" as const] as const),
      ]);
    expect(passAgreement(mk(19, 0, 0)).clears).toBe(false);
    expect(passAgreement(mk(8, 2, 10))).toMatchObject({
      total: 20,
      decided: 10,
      wrongRate: 0.2,
      clears: false,
    });
    expect(passAgreement(mk(18, 2, 0))).toMatchObject({
      total: 20,
      decided: 20,
      wrongRate: 0.1,
      clears: true,
    });
    expect(passAgreement(mk(17, 3, 0))).toMatchObject({
      total: 20,
      decided: 20,
      wrongRate: 0.15,
      clears: false,
    });
  });
});

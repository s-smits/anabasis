import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { type AnswerFile, keepAnswerFiles, textFiles } from "../src/kernel/answer-files.ts";
import { conditionId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, read } from "../src/kernel/log.ts";
import type { Task, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { storedZip, zipMembers } from "../src/meta/zip.ts";
import { agreement } from "../src/audit/agreement.ts";
import { executeProbe, type ProbeRow, probeTool } from "../src/audit/probe.ts";
import { auditRejection, boundPublicInput } from "../src/audit/auditor.ts";
import { conditionOf } from "./helpers/logged-round.ts";
import { containing, objectWith } from "./helpers/matchers.ts";

const TASK: Task = { taskId: "t-1", family: "ledger", publicInput: {}, hidden: {} };
const CONTRACT: Contract = {
  answerFormat: { type: "object" },
  conventions: "Plain text.",
  rules: [
    { id: "R1", statement: "No row of data.csv is marked bad." },
    { id: "R2", statement: "The answer holds summary.md." },
    { id: "R3", statement: "A span is at most 10 m." },
  ],
  scope: "Fixture.",
};
const DATA = "file:data.csv";
const SUMMARY = "file:summary.md";
const READ = "read_answer_file";
const PROBE = "probe_check";
const BAD = "row-bad";
/** 400 rows and 13 kB: the one bad row lies past the first message's cut and past one read window. */
const ROWS = [
  "id,label",
  ...Array.from(
    { length: 400 },
    (_, at) => `${String(at)},${at === 390 ? BAD : "row-good"}-${"x".repeat(20)}`,
  ),
];
const CSV = `${ROWS.join("\n")}\n`;
/** 5,000 lines in 10 kB: more lines in one window of characters than a tool's result keeps. */
const IDS = "1\n".repeat(5000);
const SUBMITTED = [
  { path: "data.csv", text: CSV },
  { path: "ids.txt", text: IDS },
];
const NOTE = /\n\[(\d+) more characters from (\d+)\]$/u;
const scratch = mkdtempSync(join(tmpdir(), "ana-referee-files-"));
const checks = join(scratch, "checks");
const toolUse = { stopReason: "toolUse" } as const;
let readings = 0;

/** The checks of the fixture: a bad row refuses `rows`, a long span `span`, and a missing summary
 *  `summary` unless the task asks for none. */
const verify: Verifier = async (task, answer, _signal, files = []) => {
  const text = (path: string) => files.find((file) => file.path === path)?.text;
  const blocking = [
    ...(text("data.csv")?.includes(BAD) === true ? ["rows"] : []),
    ...(asRecord(task.publicInput)?.summary !== false && text("summary.md") === undefined ? ["summary"] : []),
    ...(JSON.stringify(answer).includes('"span":12') ? ["span"] : []),
  ];
  return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
};

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
beforeAll(() => {
  mkdirSync(checks);
  const check = (id: string, rule: string, reads: JsonObject) => ({
    id,
    citedDecisionIds: [rule],
    execution: {
      families: "all",
      artifactPaths: [],
      publicInputPaths: [],
      hidden: "none",
      evidence: { kind: "authored" },
      ...reads,
    },
  });
  writeFileSync(
    join(checks, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: [
        check("rows", "R1", { filePaths: ["data.csv"] }),
        check("summary", "R2", { filePaths: ["summary.md"] }),
        check("span", "R3", { artifactPaths: ["$.span"] }),
      ],
    }),
  );
});

const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const ruling = (args: JsonObject) => call("record_ruling", args);
const whole = (path: string, text: string) =>
  call(PROBE, { changes: [{ path, value: JSON.stringify(text) }] });

async function reading(
  files: readonly { path: string; text: string }[],
  blocking: readonly string[],
  responses: ReturnType<typeof fauxAssistantMessage>[],
  task: Task = TASK,
  onVerify?: (asked: Task) => void,
) {
  const sent: TranscriptContext[] = [];
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
      sent.push(structuredClone(context));
      return message;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const log = join(scratch, `reading-${String(++readings)}.jsonl`);
  const kept = files.map(({ path, text }) => ({ path, text, base64: Buffer.from(text).toString("base64") }));
  append(log, "verdict", {
    solve: "s-1",
    task: TASK.taskId,
    answer: { span: blocking.includes("span") ? 12 : 9 },
    ...keysIf(kept.length > 0, () => ({ files: keepAnswerFiles(log, kept).map((file) => ({ ...file })) })),
    kind: "fail",
    blocking: [...blocking],
  });
  const given: string[][] = [];
  const finding = await auditRejection(
    { model: faux.getModel(), effort: "medium", models: () => models },
    {
      solve: "s-1",
      task,
      contract: CONTRACT,
      checks,
      log,
      verify: async (asked, answer, signal, received) => {
        onVerify?.(asked);
        given.push((received ?? []).map(({ path }) => path));
        return verify(asked, answer, signal, received);
      },
    },
  );
  const results = (sent.at(-1)?.messages ?? []).flatMap((message) =>
    message.role === "toolResult"
      ? [message.content.map((part) => (part.type === "text" ? part.text : "")).join("")]
      : [],
  );
  const events = read(log);
  return {
    finding,
    given,
    results,
    opening: JSON.stringify(sent[0]),
    refused: events.filter(({ kind }) => kind === "referee.refused").map(({ data }) => data.why),
    rows: events.findLast(({ kind }) => kind === "referee.finding")?.data.probeRows,
  };
}

describe("the Referee's read of an answer's files", () => {
  it("the Referee reads a file whole in windows, past the first message's cut and within a result's lines", async () => {
    const s = await reading(
      SUBMITTED,
      ["rows", "summary"],
      [
        call(READ, {}),
        call(READ, { path: DATA }),
        call(READ, { path: DATA, from: 12_000 }),
        call(READ, { path: "file:ids.txt" }),
        call(READ, { path: "file:ids.txt", from: 3993 }),
        call(READ, { path: "file:ids.txt", from: 7985 }),
        call(READ, { path: "file:other.csv" }),
        ruling({ ruling: "unclear", reason: "Read only.", probes: [] }),
      ],
    );
    expect(CSV.indexOf(BAD)).toBeGreaterThan(12_000);
    expect(s.opening).toContain("row-good");
    expect(s.opening).toContain("bytes omitted");
    expect(s.opening).not.toContain(BAD);
    const [list, head, tail, ...ids] = s.results;
    expect(list).toBe(`${DATA}\nfile:ids.txt`);
    expect(head).toMatch(NOTE);
    expect(NOTE.exec(head ?? "")?.[2]).toBe("12000");
    expect(`${head?.replace(NOTE, "") ?? ""}${tail ?? ""}`).toBe(CSV);
    expect(tail).toContain(BAD);
    // A window ends a line short of what a result keeps, so none is cut where it gives no offset.
    const windows = ids.slice(0, 3);
    expect(windows.map((window) => NOTE.exec(window)?.[2])).toEqual(["3993", "7985", undefined]);
    expect(windows.map((window) => window.replace(NOTE, "")).join("")).toBe(IDS);
    for (const window of windows) expect(window).not.toContain("Left out here");
    expect(ids[3]).toContain("file:other.csv is not among the texts of the answer's files");
  });

  it("the Referee is told where a read holds no text, and no window ends inside a character", async () => {
    const wide = `${"a".repeat(11_999)}\u{1F600}b`;
    const s = await reading(
      [
        { path: "empty.md", text: "" },
        { path: "wide.md", text: wide },
      ],
      ["summary"],
      [
        call(READ, { path: "file:empty.md" }),
        call(READ, { path: "file:wide.md" }),
        call(READ, { path: "file:wide.md", from: 11_999 }),
        call(READ, { path: "file:wide.md", from: 12_002 }),
        ruling({ ruling: "unclear", reason: "Read only.", probes: [] }),
      ],
    );
    expect(s.results).toEqual([
      "(no text from character 0: it holds 0)",
      `${"a".repeat(11_999)}\n[3 more characters from 11999]`,
      "\u{1F600}b",
      "(no text from character 12002: it holds 12002)",
    ]);
  });

  it("the Referee is told a refusing check's files are absent where the solve submitted none, and nothing of files where no refusing check reads one", async () => {
    const unclear = ruling({ ruling: "unclear", reason: "Read only.", probes: [] });
    const none = await reading([], ["summary"], [call(READ, {}), unclear]);
    expect(none.opening).toContain("Files under review: none: the solve submitted no file");
    expect(none.opening).toContain(`reads ${SUMMARY}`);
    expect(none.results[0]).toBe("(none)");
    const plain = { ...TASK, publicInput: { summary: false } };
    expect((await reading([], ["span"], [unclear], plain)).opening).not.toContain("Files under review");
  });
});

describe("a probe of a file", () => {
  it("a probe says what its file held before and after, to the Referee and in the finding, and a field's probe names no file", async () => {
    const stub = "id,label\n1,row-good\n";
    const s = await reading(
      SUBMITTED,
      ["rows", "summary", "span"],
      [
        whole(DATA, stub),
        call(PROBE, { changes: [{ path: DATA, find: BAD, replace: "row-new" }] }),
        call(PROBE, { changes: [{ path: "$.span", value: "9" }] }),
        ruling({ ruling: "solver-fail", rule: "R1", field: DATA, reason: "A bad row.", probes: [1] }),
      ],
    );
    const was = { lines: 401, bytes: Buffer.byteLength(CSV) };
    expect(s.results[0]).toContain(
      `${DATA} changed (401 lines, ${String(was.bytes)} bytes -> 2 lines, 20 bytes)`,
    );
    expect(s.results[0]).not.toContain("1,row-good");
    expect(s.results[2]).not.toContain("changed (");
    expect(s.rows).toEqual([
      objectWith({ id: 1, moved: ["rows"], texts: [{ path: DATA, was, now: { lines: 2, bytes: 20 } }] }),
      objectWith({
        id: 2,
        moved: ["rows"],
        texts: [{ path: DATA, was, now: { lines: 401, bytes: was.bytes } }],
      }),
      objectWith({ id: 3, moved: ["span"], texts: [] }),
    ]);
    // No size refuses the ruling: the host's test stays necessary, and the row is what a reader checks.
    expect(s.finding).toMatchObject({ ruling: "solver-fail", field: DATA, probes: [1] });
    expect(s.refused).toEqual([]);
  });

  it("a probe adds a file the answer lacks, and an earned ruling stands on that file once the probe moved its check", async () => {
    const earned = (field: string, probes: number[]) =>
      ruling({ ruling: "solver-fail", rule: "R2", field, reason: "No summary.", probes });
    const s = await reading(
      [{ path: "data.csv", text: "id,label\n1,row-good\n" }],
      ["summary"],
      [
        earned(SUMMARY, []),
        call(PROBE, { changes: [{ path: SUMMARY, find: "a", replace: "b" }] }),
        whole("file:../summary.md", "Summary.\n"),
        whole("file:data.csv/summary.md", "Summary.\n"),
        whole(SUMMARY, "Summary.\n"),
        earned("file:notes.md", [1]),
        earned(SUMMARY, [1]),
      ],
    );
    expect(s.finding).toMatchObject({ ruling: "solver-fail", rule: "R2", field: SUMMARY, probes: [1] });
    expect(s.refused).toEqual([
      containing("once a probe has added it"),
      containing("once a probe has added it"),
    ]);
    expect(s.results.slice(1, 5)).toEqual([
      containing("add a new text file with `value` alone"),
      containing("file:../summary.md is not a valid deliverable file path"),
      containing("is neither a submitted text file nor an archive member"),
      containing(`${SUMMARY} added (1 line, 9 bytes)`),
    ]);
    expect(s.rows).toEqual([
      objectWith({
        id: 1,
        moved: ["summary"],
        texts: [{ path: SUMMARY, was: null, now: { lines: 1, bytes: 9 } }],
      }),
    ]);
    // The replay, then the one probe's changed side: the refused changes ran no check.
    expect(s.given).toEqual([["data.csv"], ["data.csv", "summary.md"]]);
  });

  it("a probe finds a file by its own path beside one named `$`, and adds none at a folder that holds one", async () => {
    const files: AnswerFile[] = [
      { path: "$", base64: "", text: "x" },
      { path: "out/data.csv", base64: "", text: "row-bad\n" },
    ];
    const rows: ProbeRow[] = [];
    // SAFETY: the probe uses only the context's abort signal, no tool API method.
    const invoke = (change: { path: string; value?: string; find?: string; replace?: string }) =>
      probeTool(verify, TASK, { span: 9 }, rows, { files }).execute(
        { changes: [change] },
        undefined as never,
        BACKGROUND_CONTEXT,
      );
    await expect(invoke({ path: "file:out", value: '"x"' })).rejects.toThrow(
      "add a new text file with `value` alone",
    );
    expect(rows).toHaveLength(0);
    // A check that reads `file:$` reads every file, and a file named `$` is still one file.
    await invoke({ path: "file:out/data.csv", find: "row-bad", replace: "row-newer" });
    const sizes = { was: { lines: 1, bytes: 8 }, now: { lines: 1, bytes: 10 } };
    expect(rows).toMatchObject([{ texts: [{ path: "file:out/data.csv", ...sizes }] }]);
  });
});

describe("publicInput.files bounding in Referee", () => {
  it("bounds large publicInput.files inline while keeping small memos intact, serves full windows via read_task_file, and passes untouched task to verify", async () => {
    const memo = "Short protocol memo under 2 KB.\n";
    const tailMarker = "TAIL_MARKER_ROW_9999";
    const bigCsv = `id,val\n${"1,abcdef0123456789\n".repeat(1200)}9999,${tailMarker}\n`;
    const extraFiles = Array.from({ length: 10 }, (_, idx) => ({
      path: `extra/table_${String(idx)}.csv`,
      text: `k,v\n${"x,1234567890\n".repeat(250)}`,
    }));
    const taskWithFiles: Task = {
      taskId: "t-big",
      family: "ledger",
      publicInput: {
        summary: false,
        files: [{ path: "memo.txt", text: memo }, { path: "big/input.csv", text: bigCsv }, ...extraFiles],
      },
      hidden: {},
    };
    let verifiedBigLen = 0;
    const s = await reading(
      [],
      ["span"],
      [
        call("read_task_file", {}),
        call("read_task_file", { path: "big/input.csv", from: bigCsv.length - 40 }),
        call(PROBE, { changes: [{ path: "$.span", value: "9" }] }),
        ruling({
          ruling: "solver-fail",
          rule: "R3",
          field: "$.span",
          reason: "Span exceeds 10 m.",
          probes: [1],
        }),
      ],
      taskWithFiles,
      (asked) => {
        const list = asRecord(asked.publicInput)?.files;
        const big = (Array.isArray(list) ? list : [])
          .map((row) => asRecord(row))
          .find((row) => row?.path === "big/input.csv");
        if (isString(big?.text)) verifiedBigLen = big.text.length;
      },
    );
    expect(s.finding).toMatchObject({ ruling: "solver-fail", rule: "R3", field: "$.span", probes: [1] });
    expect(s.opening).toContain(memo.trim());
    expect(s.opening).not.toContain(tailMarker);
    expect(s.opening).toContain("omittedBytes");
    expect(s.opening.length).toBeLessThan(30_000);
    expect(verifiedBigLen).toBe(bigCsv.length);
    expect(s.results[0]).toContain("big/input.csv");
    expect(s.results[0]).toContain("extra/table_9.csv");
    expect(s.results[1]).toContain(tailMarker);
  });

  it("bounds oversized hidden, answer, and accepted answer JSONs inline and serves full text via read_task_file", async () => {
    const hiddenTail = "HIDDEN_TAIL_999";
    const answerTail = "ANSWER_TAIL_888";
    const acceptedTail = "ACCEPTED_TAIL_777";
    const bigHidden = { blob: `${"h".repeat(25_000)}${hiddenTail}` };
    const bigAnswer = { span: 12, blob: `${"a".repeat(25_000)}${answerTail}` };
    const bigAccepted = { span: 9, blob: `${"c".repeat(25_000)}${acceptedTail}` };
    const log = join(scratch, `reading-json-${String(++readings)}.jsonl`);
    append(log, "task.proposed", { version: "v-big", taskId: "t-json" });
    append(log, "verdict", { solve: "s-ok", task: "t-json", answer: bigAccepted, kind: "pass" });
    append(log, "verdict", {
      solve: "s-bad",
      task: "t-json",
      answer: bigAnswer,
      kind: "fail",
      blocking: ["span"],
    });
    const sent: TranscriptContext[] = [];
    const faux = fauxProvider({
      models: [
        {
          id: "faux-json",
          contextWindow: 200_000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        },
      ],
    });
    const responses = [
      call("read_task_file", {}),
      call("read_task_file", { path: "case:hidden.json", from: 20_000 }),
      call("read_task_file", { path: "case:answer.json", from: 20_000 }),
      call("read_task_file", { path: "case:accepted-answer.json", from: 20_000 }),
      ruling({ ruling: "unclear", reason: "Read oversized JSONs.", probes: [] }),
    ];
    faux.setResponses(
      responses.map((message) => (context: TranscriptContext) => {
        sent.push(structuredClone(context));
        return message;
      }),
    );
    const models = createModels();
    models.setProvider(faux.provider);
    let sawHiddenLen = 0;
    let sawAnswerLen = 0;
    const finding = await auditRejection(
      { model: faux.getModel(), effort: "medium", models: () => models },
      {
        solve: "s-bad",
        task: { taskId: "t-json", family: "ledger", publicInput: { summary: false }, hidden: bigHidden },
        contract: CONTRACT,
        checks,
        log,
        verify: async (asked, answer, signal, files) => {
          sawHiddenLen = JSON.stringify(asked.hidden).length;
          sawAnswerLen = JSON.stringify(answer).length;
          return verify(asked, answer, signal, files);
        },
      },
    );
    const opening = JSON.stringify(sent[0]);
    const results = (sent.at(-1)?.messages ?? []).flatMap((message) =>
      message.role === "toolResult"
        ? [message.content.map((part) => (part.type === "text" ? part.text : "")).join("")]
        : [],
    );
    expect(finding.ruling).toBe("unclear");
    expect(opening).toContain("case:hidden.json");
    expect(opening).toContain("case:answer.json");
    expect(opening).toContain("case:accepted-answer.json");
    expect(opening).not.toContain(hiddenTail);
    expect(opening).not.toContain(answerTail);
    expect(opening).not.toContain(acceptedTail);
    expect(results[0]).toBe("case:hidden.json\ncase:answer.json\ncase:accepted-answer.json");
    expect(results[1]).toContain(hiddenTail);
    expect(results[2]).toContain(answerTail);
    expect(results[3]).toContain(acceptedTail);
    expect(sawHiddenLen).toBeGreaterThan(25_000);
    expect(sawAnswerLen).toBeGreaterThan(25_000);
  });

  it("reuses same-check check-defect rulings within one comparison and task version while failing closed and excluding reused rows from agreement", async () => {
    const log = join(scratch, `reading-reuse-${String(++readings)}.jsonl`);
    const task: Task = { taskId: "t-reuse", family: "ledger", publicInput: { summary: false }, hidden: {} };
    const condV1 = conditionOf("v-reuse-1", "h-1");
    const condV2 = conditionOf("v-reuse-2", "h-1");
    const cidV1 = conditionId(condV1);
    const cidV2 = conditionId(condV2);
    append(log, "condition.recorded", { id: cidV1, condition: requireJsonValue(condV1) });
    append(log, "condition.recorded", { id: cidV2, condition: requireJsonValue(condV2) });
    const recordSolve = (
      solve: string,
      comparison: string | undefined,
      blocking: readonly string[],
      cid: string = cidV1,
    ) => {
      append(log, "solve.started", {
        solve,
        condition: cid,
        ...keyIfDefined("comparison", comparison),
      });
      append(log, "verdict", {
        solve,
        task: task.taskId,
        answer: { span: blocking.includes("span") ? 12 : 9 },
        kind: "fail",
        blocking: [...blocking],
      });
    };
    recordSolve("s-1", "g-1", ["span"]);
    append(log, "referee.finding", {
      solve: "s-1",
      task: task.taskId,
      ruling: "check-defect",
      check: "span",
      rule: null,
      field: null,
      reason: "check over-strict",
      probes: [1],
    });
    recordSolve("s-2", "g-1", ["span"]);
    recordSolve("s-3", "g-1", ["rows"]);
    recordSolve("s-v2", "g-1", ["span"], cidV2);
    recordSolve("s-nocond", "g-1", ["span"], "missing-cond");
    recordSolve("s-4", "g-2", ["span"]);
    recordSolve("s-5", undefined, ["span"]);

    recordSolve("s-walled", "g-walled", ["span"]);
    append(log, "referee.finding", {
      solve: "s-walled",
      task: task.taskId,
      ruling: "check-defect",
      check: "span",
      walled: true,
      probes: [],
    });
    recordSolve("s-after-walled", "g-walled", ["span"]);

    recordSolve("s-settled", "g-settled", ["span"]);
    append(log, "referee.finding", {
      solve: "s-settled",
      task: task.taskId,
      ruling: "check-defect",
      check: "span",
      probes: [1],
    });
    append(log, "comparison.reported", {
      session: "g-settled",
      settled: { labels: { "s-settled": "solver-fail" } },
    });
    recordSolve("s-after-settled", "g-settled", ["span"]);

    recordSolve("s-superseded", "g-sup", ["span"]);
    append(log, "referee.finding", {
      solve: "s-superseded",
      task: task.taskId,
      ruling: "check-defect",
      check: "span",
      probes: [1],
    });
    append(log, "referee.finding", {
      solve: "s-superseded",
      task: task.taskId,
      ruling: "solver-fail",
      rule: "R3",
      field: "$.span",
      probes: [1],
    });
    recordSolve("s-after-sup", "g-sup", ["span"]);

    let llmCalls = 0;
    const faux = fauxProvider({
      models: [
        {
          id: "faux-reuse",
          contextWindow: 200_000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        },
      ],
    });
    faux.setResponses(
      Array.from({ length: 8 }, () => () => {
        llmCalls += 1;
        return ruling({ ruling: "unclear", reason: "Fresh session.", probes: [] });
      }),
    );
    const models = createModels();
    models.setProvider(faux.provider);
    const reader = { model: faux.getModel(), effort: "medium" as const, models: () => models };
    const run = (solve: string, blocking: readonly string[]) =>
      auditRejection(reader, {
        solve,
        task,
        contract: CONTRACT,
        checks,
        log,
        verify: async () => ({ kind: "fail", blocking: [...blocking] }),
      });

    expect(await run("s-2", ["span"])).toMatchObject({ ruling: "check-defect", check: "span", probes: [] });
    expect(llmCalls).toBe(0);

    for (const [solve, blk] of [
      ["s-3", ["rows"]],
      ["s-v2", ["span"]],
      ["s-nocond", ["span"]],
      ["s-4", ["span"]],
      ["s-5", ["span"]],
      ["s-after-walled", ["span"]],
      ["s-after-settled", ["span"]],
      ["s-after-sup", ["span"]],
    ] as const) {
      expect((await run(solve, blk)).ruling).toBe("unclear");
    }
    expect(llmCalls).toBe(8);
    recordSolve("s-3b", "g-1", ["rows"]);
    expect(await run("s-3b", ["rows"])).toMatchObject({ ruling: "unclear", check: null });
    recordSolve("s-3c", "g-1", ["rows", "span"]);
    expect(await run("s-3c", ["rows", "span"])).toMatchObject({ ruling: "check-defect", check: "span" });
    expect(llmCalls).toBe(8);

    const events = read(log);
    const reusedRow = events.find(({ kind, data }) => kind === "referee.finding" && data.solve === "s-2");
    expect(reusedRow?.data.reusedFrom).toBe("s-1");
    expect(reusedRow?.data.reader).toBeUndefined();
    const agree = agreement(
      events,
      new Map([
        ["s-1", "check-defect"],
        ["s-2", "solver-fail"],
      ]),
    );
    expect(agree.table["check-defect"]["check-defect"]).toBe(1);
    expect(agree.table["solver-fail"]["check-defect"]).toBe(0);
    expect(agree.unruled).toEqual(["s-2"]);
  });

  it("rebuilds archive base64 while preserving binary members when probing an entry inside a zip deliverable", async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
    const zip = storedZip([
      { path: "xl/workbook.xml", text: '<workbook><sheet name="Population"/></workbook>' },
      { path: "xl/media/chart.png", text: binary },
    ]);
    const files = textFiles([{ path: "analysis.xlsx", base64: zip.toString("base64") }]);
    let seenZip: Buffer | null = null;
    const verifyZip: Verifier = async (_task, _answer, _signal, received) => {
      const workbook = received?.find((f) => f.path === "analysis.xlsx");
      if (workbook === undefined) return { kind: "fail", blocking: ["check-xlsx"] };
      seenZip = Buffer.from(workbook.base64, "base64");
      const xml = zipMembers(seenZip, 1024 * 1024).members.find((m) => m.path === "xl/workbook.xml");
      return (xml?.data.toString("utf8").includes('name="Population"') ?? false)
        ? { kind: "pass" }
        : { kind: "fail", blocking: ["check-xlsx"] };
    };
    const row = await executeProbe({
      used: 0,
      verify: verifyZip,
      task: TASK,
      answer: {},
      files,
      signal: undefined,
      original: async () => ({ kind: "pass" }),
      rawChanges: [{ path: "file:analysis.xlsx/xl/workbook.xml", find: "Population", replace: "Sheet1" }],
    });
    expect(row.changed).toEqual({ kind: "fail", blocking: ["check-xlsx"] });
    const members = seenZip === null ? [] : zipMembers(seenZip, 1024 * 1024).members;
    expect(members.find((m) => m.path === "xl/media/chart.png")?.data.equals(binary)).toBe(true);
  });

  it("bounds base64, invalid base64, archive entries, and non-text rows in boundPublicInput", () => {
    const raw = Buffer.from("hello").toString("base64");
    const bounded = boundPublicInput({
      files: [
        { path: "ok.bin", base64: raw },
        { path: "bad.bin", base64: "not-valid-base64!" },
        {
          path: "pack.zip",
          entries: [
            { path: "a.txt", text: "1" },
            { path: "b.txt", text: "2" },
          ],
        },
        { path: "empty.txt" },
        { text: "missing-path" },
        "raw-entry",
      ],
    });
    expect(bounded).toEqual({
      files: [
        { path: "ok.bin", bytes: 5, omittedBytes: 5 },
        { path: "bad.bin", omittedBytes: 17, invalidBase64: true },
        { path: "pack.zip", members: 2 },
        { path: "empty.txt" },
        { text: "missing-path" },
        "raw-entry",
      ],
    });
  });
});

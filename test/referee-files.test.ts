// The Referee and an answer's files: each read whole, what a probe's file kept, and a file the answer lacks.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { type AnswerFile, keepAnswerFiles } from "../src/kernel/answer-files.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, read } from "../src/kernel/log.ts";
import type { Task, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, type JsonObject } from "../src/meta/json-shape.ts";
import { keysIf } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type ProbeRow, probeTool } from "../src/referee/probe.ts";
import { referee } from "../src/referee/referee.ts";
import { containing, objectWith } from "./helpers/matchers.ts";

const TASK: Task = { taskId: "t-1", family: "ledger", publicInput: {}, hidden: {} };
const CONTRACT: Contract = {
  answerFormat: {},
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

/** One reading of a solve that submitted `files` and that `blocking` refused, its span too long where
 *  `span` is among them: the finding, the first message, each tool result as the reader was sent it,
 *  and the files each verification was given. */
async function reading(
  files: readonly { path: string; text: string }[],
  blocking: readonly string[],
  responses: ReturnType<typeof fauxAssistantMessage>[],
  task: Task = TASK,
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
  const finding = await referee(
    { model: faux.getModel(), effort: "medium", models: () => models },
    {
      solve: "s-1",
      task,
      contract: CONTRACT,
      checks,
      log,
      verify: async (asked, answer, signal, received) => {
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
    for (const window of windows) expect(window).not.toContain("Shown: the first");
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
        ruling({ ruling: "earned", rule: "R1", field: DATA, reason: "A bad row.", probes: [1] }),
      ],
    );
    const was = { lines: 401, bytes: Buffer.byteLength(CSV) };
    expect(s.results[0]).toContain(
      `${DATA} held 401 lines in ${String(was.bytes)} bytes in the answer and holds 2 lines in 20 bytes on the changed side`,
    );
    expect(s.results[0]).not.toContain("1,row-good");
    expect(s.results[2]).not.toContain("in the answer and holds");
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
    expect(s.finding).toMatchObject({ ruling: "earned", field: DATA, probes: [1] });
    expect(s.refused).toEqual([]);
  });

  it("a probe adds a file the answer lacks, and an earned ruling stands on that file once the probe moved its check", async () => {
    const earned = (field: string, probes: number[]) =>
      ruling({ ruling: "earned", rule: "R2", field, reason: "No summary.", probes });
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
    expect(s.finding).toMatchObject({ ruling: "earned", rule: "R2", field: SUMMARY, probes: [1] });
    // Before any probe, and for a file no probe added, the ruling names no field of the answer.
    expect(s.refused).toEqual([
      containing("once a probe has added it"),
      containing("once a probe has added it"),
    ]);
    expect(s.results.slice(1, 5)).toEqual([
      containing("adds a text file, by `value` alone"),
      containing("file:../summary.md is no path a solve can submit a file under"),
      containing("is neither a text file the solve submitted nor a member of its archive"),
      containing(`${SUMMARY} is a file the answer did not hold: the changed side adds it, 1 line in 9 bytes`),
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
    await expect(invoke({ path: "file:out", value: '"x"' })).rejects.toThrow("holds none adds a text file");
    expect(rows).toHaveLength(0);
    // A check that reads `file:$` reads every file, and a file named `$` is still one file.
    await invoke({ path: "file:out/data.csv", find: "row-bad", replace: "row-newer" });
    const sizes = { was: { lines: 1, bytes: 8 }, now: { lines: 1, bytes: 10 } };
    expect(rows).toMatchObject([{ texts: [{ path: "file:out/data.csv", ...sizes }] }]);
  });
});

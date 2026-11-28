import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { keepAnswerFiles, textFiles } from "../src/kernel/answer-files.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, read } from "../src/kernel/log.ts";
import { unfinished } from "../src/kernel/trace.ts";
import type { Task } from "../src/kernel/verify.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { storedZip } from "../src/meta/zip.ts";
import { judgePair } from "../src/audit/judge.ts";
import type { Reader } from "../src/audit/auditor.ts";

const CANARY = "hidden-canary-j4";
const TASK: Task = {
  taskId: "t-1",
  family: "memo",
  publicInput: { ask: "a memo" },
  hidden: { must: CANARY },
};
const CONTRACT: Contract = {
  answerFormat: {},
  conventions: "",
  rules: [],
  scope: "Memos.",
  objective: {
    quantity: "quality",
    direction: "higher",
    scale: "unit",
    items: [
      { id: "cites", weight: 3, kind: "judge", criterion: "The memo cites the figures the request gives." },
      { id: "plain", weight: 1, kind: "judge", criterion: "The memo is written in plain language." },
    ],
  },
};
const STRONG = "the strong memo";
const WEAK = "the weak memo";
const VIEW_IMAGE = "view_image";
const scratch = mkdtempSync(join(tmpdir(), "ana-judge-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let logs = 0;

type Said = (context: string) => JsonObject | string;
function seated(said: Said) {
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-judge",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  const reply = (context: TranscriptContext) => {
    const shown = JSON.stringify(context);
    sent.push(shown);
    const vote = said(shown);
    return isString(vote)
      ? fauxAssistantMessage(vote)
      : fauxAssistantMessage(fauxToolCall("record_vote", vote), { stopReason: "toolUse" });
  };
  faux.setResponses(Array.from({ length: 16 }, () => reply));
  const models = createModels();
  models.setProvider(faux.provider);
  const reader: Reader = { model: faux.getModel(), effort: "medium", models: () => models };
  const log = join(scratch, `judged-${String(++logs)}.jsonl`);
  append(log, "verdict", { solve: "s-strong", task: TASK.taskId, kind: "pass", answer: { memo: STRONG } });
  append(log, "verdict", { solve: "s-weak", task: TASK.taskId, kind: "pass", answer: { memo: WEAK } });
  return { reader, log, sent };
}
async function judged(said: Said, first = "s-strong", second = "s-weak") {
  const at = seated(said);
  const given = { log: at.log, comparison: "g-1", task: TASK, contract: CONTRACT };
  await judgePair(at.reader, { ...given, first, second });
  const pair = read(at.log).find(({ kind }) => kind === "referee.pair")?.data;
  return { ...at, pair };
}

const answerA = (shown: string) => shown.slice(shown.indexOf("Answer A:"), shown.indexOf("Answer B:"));
const allSame = (better: "A" | "B" | "neither", reason = "r") => ({
  cites: { better, reason },
  plain: { better, reason },
  holistic: { better, reason },
});
const onSubstance: Said = (shown) => allSame(answerA(shown).includes(STRONG) ? "A" : "B");

describe("the pairwise judge", () => {
  it("scores a substantive preference in both orders alike, and a positional one as no preference", async () => {
    for (const [first, second, sign] of [
      ["s-strong", "s-weak", 1],
      ["s-weak", "s-strong", -1],
    ] as const) {
      const { pair } = await judged(onSubstance, first, second);
      expect(pair).toMatchObject({ solve: first, old: second, judge: sign, holistic: sign, disagreed: [] });
    }
    const { pair } = await judged(() => allSame("A", "r".repeat(2000)));
    expect(pair).toMatchObject({ judge: 0, holistic: 0, disagreed: ["cites", "plain", "holistic"] });
  });

  it("weights criteria as the contract does, counts a tie in both orders as agreement and a half-swap as disagreement", async () => {
    const split: Said = (shown) => ({
      cites: { better: answerA(shown).includes(STRONG) ? "A" : "B", reason: "r" },
      plain: { better: "neither", reason: "r" },
      holistic: { better: "neither", reason: "r" },
    });
    const { pair } = await judged(split);
    expect(pair).toMatchObject({
      judge: 3 / 4,
      holistic: 0,
      criteria: { cites: 1, plain: 0, holistic: 0 },
      disagreed: [],
    });
    const half: Said = (shown) => allSame(answerA(shown).includes(STRONG) ? "A" : "neither");
    expect((await judged(half)).pair).toMatchObject({
      judge: 0.5,
      disagreed: ["cites", "plain", "holistic"],
    });
  });

  it("bills a pair the judge left unfinished and records no vote for it", async () => {
    let calls = 0;
    const at = seated((shown) => {
      if (calls++ === 1) throw new Error("the judge's login is at its limit");
      return onSubstance(shown);
    });
    const given = { log: at.log, comparison: "g-1", task: TASK, contract: CONTRACT };
    await expect(judgePair(at.reader, { ...given, first: "s-strong", second: "s-weak" })).rejects.toThrow(
      "recorded no vote",
    );
    const pair = read(at.log).find(({ kind }) => kind === "referee.pair")?.data;
    expect(pair).toMatchObject({ judge: null, holistic: null });
    expect(pair?.billed).toBeGreaterThan(0);
  });

  it("waits out a judge's usage limit and asks the vote again", async () => {
    const reset = Math.floor(Date.now() / 1000) - 58;
    let limited = 0;
    const at = seated((shown) => {
      if (limited++ < 2) {
        throw new Error(`limit reached|${String(reset)}`);
      }
      return onSubstance(shown);
    });
    const given = { log: at.log, comparison: "g-1", task: TASK, contract: CONTRACT };
    await judgePair(at.reader, { ...given, first: "s-strong", second: "s-weak" });
    const events = read(at.log);
    expect(events.filter(({ kind }) => kind === "campaign.waited")).toHaveLength(2);
    expect(events.find(({ kind }) => kind === "referee.pair")?.data).toMatchObject({ judge: 1, holistic: 1 });
  });

  it("asks no vote again once a session has billed before its limit", async () => {
    const reset = Math.floor(Date.now() / 1000) - 59;
    const weighing = "Let me weigh both answers first.";
    const at = seated((shown) => {
      if (!shown.includes(weighing)) return weighing;
      throw new Error(`limit reached|${String(reset)}`);
    });
    const given = { log: at.log, comparison: "g-1", task: TASK, contract: CONTRACT };
    await expect(judgePair(at.reader, { ...given, first: "s-strong", second: "s-weak" })).rejects.toThrow(
      "limit reached",
    );
    expect(read(at.log).filter(({ kind }) => kind === "campaign.waited")).toEqual([]);
  });

  it("runs two swapped sessions covering all criteria and holistic with hidden values, fences once, and lists criteria last", async () => {
    const { sent, pair, log } = await judged(onSubstance);
    expect(sent).toHaveLength(2);
    expect(sent.filter((shown) => shown.includes(CANARY))).toHaveLength(2);
    expect(sent.filter((shown) => shown.includes("Overall, which answer"))).toHaveLength(2);
    expect(new Set(sent.flatMap((shown) => shown.match(/=== [0-9a-f-]{36} ===/gu) ?? []))).toHaveLength(1);
    for (const shown of sent) {
      expect(shown.indexOf("Criteria to judge:")).toBeGreaterThan(shown.indexOf("Answer B:"));
    }
    expect(pair?.billed).toBeGreaterThan(0);
    expect(unfinished(read(log))).toEqual([]);
  });

  it("uses distinct session ids per vote, anchors to operator prompt/rules, and preserves middle deliverable files", async () => {
    const at = seated(onSubstance);
    const pad = "Z".repeat(55_000);
    const mid = "CRITICAL_MIDDLE_FILE_MARKER";
    const files = keepAnswerFiles(
      at.log,
      textFiles([
        { path: "a-first.txt", text: pad },
        { path: "b-middle.txt", text: mid },
        { path: "c-last.txt", text: pad },
      ]),
    );
    append(at.log, "verdict", {
      solve: "s-multi-a",
      task: TASK.taskId,
      kind: "pass",
      answer: { note: "ok" },
      files: files.map((file) => ({ ...file })),
    });
    append(at.log, "verdict", {
      solve: "s-multi-b",
      task: TASK.taskId,
      kind: "pass",
      answer: { note: "ok" },
    });
    const contract: Contract = {
      ...CONTRACT,
      conventions: "Report all totals in EUR.",
      rules: [{ id: "r1", statement: "Include every reconciliation table." }],
    };
    const given = {
      log: at.log,
      comparison: "g-2",
      task: TASK,
      contract,
      prompt: "Deliver an executive reconciliation memo.",
    };
    await judgePair(at.reader, { ...given, first: "s-multi-a", second: "s-multi-b" });
    const events = read(at.log);
    const pair = events.find(({ kind }) => kind === "referee.pair")?.data;
    expect(Array.isArray(pair?.readers) ? pair.readers.length : 0).toBe(2);
    expect(new Set(Array.isArray(pair?.readers) ? pair.readers : []).size).toBe(2);
    expect(unfinished(events)).toEqual([]);
    const pairPrompts = at.sent;
    expect(pairPrompts.every((shown) => shown.includes("Deliver an executive reconciliation memo."))).toBe(
      true,
    );
    expect(pairPrompts.every((shown) => shown.includes("Include every reconciliation table."))).toBe(true);
    expect(pairPrompts.every((shown) => shown.includes(mid))).toBe(true);
    expect(pairPrompts.some((shown) => shown.includes(VIEW_IMAGE))).toBe(false);
    expect(Math.max(...pairPrompts.map((shown) => Buffer.byteLength(answerA(shown))))).toBeLessThan(96_500);
  });

  it("prepares valid delivered images via pi-durable Photon and exposes view_image to vision-capable judges", async () => {
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const faux = fauxProvider({
      models: [
        {
          id: "faux-vision-judge",
          input: ["text", "image"],
          contextWindow: 200_000,
          cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const sawImage: boolean[] = [];
    let askedMissing = false;
    let askedOverflow = false;
    const reply = (context: TranscriptContext) => {
      const shown = JSON.stringify(context);
      const hasImageBlock = shown.includes('"type":"image"');
      const answer = answerA(shown).includes("report.docx#word/media/chart.png") ? "A" : "B";
      if (!askedMissing && shown.includes(VIEW_IMAGE)) {
        askedMissing = true;
        return fauxAssistantMessage(fauxToolCall(VIEW_IMAGE, { answer, path: "no-such.png" }), {
          stopReason: "toolUse",
        });
      }
      if (!askedOverflow && shown.includes(VIEW_IMAGE)) {
        askedOverflow = true;
        return fauxAssistantMessage(fauxToolCall(VIEW_IMAGE, { answer, path: "extra-fifth.png" }), {
          stopReason: "toolUse",
        });
      }
      if (!hasImageBlock && shown.includes(VIEW_IMAGE)) {
        return fauxAssistantMessage(
          fauxToolCall(VIEW_IMAGE, { answer, path: "report.docx#word/media/chart.png" }),
          { stopReason: "toolUse" },
        );
      }
      sawImage.push(hasImageBlock);
      return fauxAssistantMessage(
        fauxToolCall("record_vote", {
          vis: { better: answer, reason: "visual check" },
          holistic: { better: answer, reason: "visual check" },
        }),
        { stopReason: "toolUse" },
      );
    };
    faux.setResponses(Array.from({ length: 18 }, () => reply));
    const models = createModels();
    models.setProvider(faux.provider);
    const log = join(scratch, `judged-vision-${String(++logs)}.jsonl`);
    const docx = storedZip([
      {
        path: "word/document.xml",
        text: "<w:document><w:body><w:p><w:r><w:t>Chart</w:t></w:r></w:p></w:body></w:document>",
      },
      { path: "word/media/chart.png", text: Buffer.from(png1x1, "base64") },
    ]).toString("base64");
    const files = keepAnswerFiles(log, [
      { path: "forest.png", base64: png1x1 },
      { path: "report.docx", base64: docx },
      { path: "third.png", base64: png1x1 },
      { path: "fourth.png", base64: png1x1 },
      { path: "extra-fifth.png", base64: png1x1 },
      { path: "stub.png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") },
    ]);
    append(log, "verdict", {
      solve: "s-img",
      task: TASK.taskId,
      kind: "pass",
      answer: { note: "ok" },
      files: files.map((file) => ({ ...file })),
    });
    append(log, "verdict", { solve: "s-plain", task: TASK.taskId, kind: "pass", answer: { note: "ok" } });
    const oneItem: Contract = {
      ...CONTRACT,
      objective: {
        quantity: "quality",
        direction: "higher",
        scale: "unit",
        items: [{ id: "vis", weight: 1, kind: "judge", criterion: "Figure is clear and well labelled." }],
      },
    };
    await judgePair(
      { model: faux.getModel(), effort: "medium", models: () => models },
      { log, comparison: "g-img", task: TASK, contract: oneItem, first: "s-img", second: "s-plain" },
    );
    const events = read(log);
    const pair = events.find(({ kind }) => kind === "referee.pair")?.data;
    expect(pair?.extracts).toEqual({ files: 6, empty: 2, faults: 0, truncated: 0 });
    expect(pair).toMatchObject({ judge: 1, holistic: 1 });
    const viewErrors = events
      .filter(
        ({ kind, data }) => kind === "referee.call" && data.tool === VIEW_IMAGE && data.isError === true,
      )
      .map(({ data }) => (isString(data.text) ? data.text : ""));
    expect(viewErrors.some((msg) => msg.includes("has no viewable image no-such.png"))).toBe(true);
    expect(viewErrors.some((msg) => msg.includes("has no viewable image extra-fifth.png"))).toBe(true);
    expect(sawImage).toEqual([true, true]);

    const singleLog = join(scratch, `judged-vision-one-${String(++logs)}.jsonl`);
    const singleFile = keepAnswerFiles(singleLog, [{ path: "solo.png", base64: png1x1 }]);
    append(singleLog, "verdict", {
      solve: "s-one",
      task: TASK.taskId,
      kind: "pass",
      answer: { note: "ok" },
      files: singleFile.map((file) => ({ ...file })),
    });
    append(singleLog, "verdict", {
      solve: "s-none",
      task: TASK.taskId,
      kind: "pass",
      answer: { note: "ok" },
    });
    const singleSaw: boolean[] = [];
    faux.setResponses(
      Array.from({ length: 8 }, () => (context: TranscriptContext) => {
        const shown = JSON.stringify(context);
        if (!shown.includes('"type":"image"') && shown.includes(VIEW_IMAGE)) {
          const answer = answerA(shown).includes("solo.png") ? "A" : "B";
          return fauxAssistantMessage(fauxToolCall(VIEW_IMAGE, { answer, path: "solo.png" }), {
            stopReason: "toolUse",
          });
        }
        singleSaw.push(shown.includes('"type":"image"'));
        return fauxAssistantMessage(
          fauxToolCall("record_vote", {
            vis: { better: "neither", reason: "one img" },
            holistic: { better: "neither", reason: "one img" },
          }),
          { stopReason: "toolUse" },
        );
      }),
    );
    await judgePair(
      { model: faux.getModel(), effort: "medium", models: () => models },
      {
        log: singleLog,
        comparison: "g-one",
        task: TASK,
        contract: oneItem,
        first: "s-one",
        second: "s-none",
      },
    );
    expect(singleSaw).toEqual([true, true]);
  });
});

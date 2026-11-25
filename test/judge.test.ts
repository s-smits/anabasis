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
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { judgePair } from "../src/referee/judge.ts";
import type { Reader } from "../src/referee/referee.ts";

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
const scratch = mkdtempSync(join(tmpdir(), "ana-judge-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let logs = 0;

type Said = (context: string) => JsonObject;
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
    return fauxAssistantMessage(fauxToolCall("record_vote", said(shown)), { stopReason: "toolUse" });
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
const onSubstance: Said = (shown) => ({ better: answerA(shown).includes(STRONG) ? "A" : "B", reason: "r" });

describe("the pairwise judge", () => {
  it("scores a substantive preference in both orders alike, and a positional one as no preference", async () => {
    for (const [first, second, sign] of [
      ["s-strong", "s-weak", 1],
      ["s-weak", "s-strong", -1],
    ] as const) {
      const { pair } = await judged(onSubstance, first, second);
      expect(pair).toMatchObject({ solve: first, old: second, judge: sign, holistic: sign, disagreed: [] });
    }
    const { pair } = await judged(() => ({ better: "A", reason: "r" }));
    expect(pair).toMatchObject({ judge: 0, holistic: 0, disagreed: ["cites", "plain", "holistic"] });
  });

  it("weights criteria as the contract does, and counts a tie in both orders as no disagreement", async () => {
    const split: Said = (shown) =>
      shown.includes("cites the figures the request")
        ? { better: answerA(shown).includes(STRONG) ? "A" : "B", reason: "r" }
        : { better: "neither", reason: "r" };
    const { pair } = await judged(split);
    expect(pair).toMatchObject({
      judge: 3 / 4,
      holistic: 0,
      criteria: { cites: 1, plain: 0, holistic: 0 },
      disagreed: [],
    });
  });

  it("bills a pair the judge left unfinished and records no vote for it", async () => {
    const at = seated((shown) => {
      if (shown.includes("Overall, which answer")) throw new Error("the judge's login is at its limit");
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

  it("shows hidden values to criterion votes alone, fences a pair once, and asks its criterion last", async () => {
    const { sent, pair, log } = await judged(onSubstance);
    expect(sent).toHaveLength(6);
    const holistic = sent.filter((shown) => shown.includes("Overall, which answer"));
    expect(holistic).toHaveLength(2);
    expect(holistic.filter((shown) => shown.includes(CANARY))).toEqual([]);
    expect(sent.filter((shown) => shown.includes(CANARY))).toHaveLength(4);
    expect(new Set(sent.flatMap((shown) => shown.match(/=== [0-9a-f-]{36} ===/gu) ?? []))).toHaveLength(1);
    for (const shown of sent) {
      expect(shown.indexOf("The criterion:")).toBeGreaterThan(shown.indexOf("Answer B:"));
    }
    expect(pair?.billed).toBeGreaterThan(0);
    expect(unfinished(read(log))).toEqual([]);
  });

  it("uses distinct session ids per vote, anchors to operator prompt/rules, and preserves middle deliverable files", async () => {
    const at = seated(onSubstance);
    const pad = "Z".repeat(15_000);
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
    expect(Array.isArray(pair?.readers) ? pair.readers.length : 0).toBe(6);
    expect(new Set(Array.isArray(pair?.readers) ? pair.readers : []).size).toBe(6);
    expect(unfinished(events)).toEqual([]);
    const pairPrompts = at.sent;
    expect(pairPrompts.every((shown) => shown.includes("Deliver an executive reconciliation memo."))).toBe(
      true,
    );
    expect(pairPrompts.every((shown) => shown.includes("Include every reconciliation table."))).toBe(true);
    expect(pairPrompts.every((shown) => shown.includes(mid))).toBe(true);
    expect(Math.max(...pairPrompts.map((shown) => Buffer.byteLength(answerA(shown))))).toBeLessThan(24_500);
  });
});

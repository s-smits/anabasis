import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import { append, read } from "../src/kernel/log.ts";
import { unfinished } from "../src/kernel/trace.ts";
import type { Task } from "../src/kernel/verify.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { judgeBrief, judgePair } from "../src/referee/judge.ts";
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
    const brief = shown.includes("record_brief");
    const args = brief ? { expectations: ["cites the figures", "plain"], flags: [] } : said(shown);
    return fauxAssistantMessage(fauxToolCall(brief ? "record_brief" : "record_vote", args), {
      stopReason: "toolUse",
    });
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
  await judgeBrief(at.reader, given);
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
      expect(pair).toMatchObject({ solve: first, old: second, judge: sign, holistic: sign, ties: {} });
    }
    const { pair } = await judged(() => ({ better: "A", reason: "r" }));
    expect(pair).toMatchObject({ judge: 0, holistic: 0 });
    expect(pair?.ties).toEqual({
      cites: "swap-disagreed",
      plain: "swap-disagreed",
      holistic: "swap-disagreed",
    });
  });

  it("weights criteria as the contract does, and names the tie kind both orders agree on", async () => {
    const split: Said = (shown) =>
      shown.includes("cites the figures the request")
        ? { better: answerA(shown).includes(STRONG) ? "A" : "B", reason: "r" }
        : { better: "neither", kind: "both-weak", reason: "r" };
    const { pair } = await judged(split);
    expect(pair).toMatchObject({ judge: 3 / 4, holistic: 0, criteria: { cites: 1, plain: 0, holistic: 0 } });
    expect(pair?.ties).toEqual({ plain: "both-weak", holistic: "both-weak" });
    const { pair: torn } = await judged((shown) => ({
      better: "neither",
      kind: answerA(shown).includes(STRONG) ? "both-strong" : "both-weak",
      reason: "r",
    }));
    expect(torn?.ties).toEqual({});
  });

  it("shows hidden values to the brief alone, bills each pair, and leaves no session open", async () => {
    const { sent, pair, log } = await judged(onSubstance);
    const [brief, ...pairs] = sent;
    expect(brief).toContain(CANARY);
    expect(pairs).toHaveLength(6);
    expect(pairs.filter((shown) => shown.includes(CANARY))).toEqual([]);
    expect(pairs.filter((shown) => shown.includes("What a strong answer shows"))).toHaveLength(4);
    expect(pair?.billed).toBeGreaterThan(0);
    expect(unfinished(read(log))).toEqual([]);
  });
});

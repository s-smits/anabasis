/**
 * Host text a model reads may promise only what the host provides on the path it is read on. Each
 * row renders one composed surface with one optional feature off and asserts that the sentence
 * promising that feature is not there unconditionally. The meta-review of 2026-10-07 found three
 * such promises: an Epoch Review prompt describing a Judge list that no authoring checkpoint carries,
 * a Built prompt saying the prepared answer is submitted "at the end" when only the solve wall
 * submits it, and a restore result calling an answer prepared that the candidate never held.
 *
 * A new optional feature a model is told about adds a row here: the surface rendered without it and
 * the phrase that would promise it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Type } from "@earendil-works/pi-ai";
import {
  type DomainHarnessFactory,
  builtAgentInterface,
  createBuiltStarter,
} from "../src/solve/built-starter.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/correctness-bundle/harness-config.ts";
import { double } from "./helpers/doubles.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

/** A starter whose one domain writer sets the draft and whose one artifact-writer prepares it. */
function starter() {
  const factory: DomainHarnessFactory = () => ({
    tools: [
      defineDraftTool({
        name: "write",
        label: "Write",
        description: "Set the answer.",
        parameters: Type.Object({ answer: Type.String() }),
        executionMode: "sequential",
        run: ({ answer }, draft) => {
          draft.setValue("answer", answer);
          return { text: "written" };
        },
      }),
      defineDraftTool({
        name: "finish",
        label: "Finish",
        description: "Prepare the answer.",
        parameters: Type.Object({}),
        executionMode: "sequential",
        run: (_params, draft) => {
          draft.setArtifact({ answer: draft.getValue("answer") });
          return { text: "prepared" };
        },
      }),
    ],
  });
  return createBuiltStarter({ taskId: "t", family: "f", publicInput: {} }, factory, null, {
    domainToolAuthorities: [
      { name: "write", authority: "writer" },
      { name: "finish", authority: "artifact-writer" },
    ],
  });
}

/** The text each call returns, in order, joined: what the solver read from the tools. */
async function toolReplies(calls: readonly [string, Record<string, string>][]): Promise<string> {
  const { tools } = starter();
  const replies: string[] = [];
  for (const [name, args] of calls) {
    const result = await tools.find((tool) => tool.name === name)?.execute(name, double(args));
    replies.push(...(result?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])));
  }
  return replies.join("\n");
}

/** The Built system prompt as the starter's roster composes it. */
function solverContract(): string {
  const { tools, registration } = starter();
  return builtAgentInterface(tools, registration, null, DEFAULT_HARNESS_SETTINGS.solveMs).systemPrompt;
}

/** The Epoch Review prompt and the orientation an authoring checkpoint is handed. */
async function authoringReview(): Promise<string> {
  const root = scratchDir(".ana-scratch-model-visible-promises-", import.meta.dir);
  uppercaseFixture(root);
  let shown = "";
  await runEpochReview({
    repoRoot: root,
    slug: "promises",
    runId: "authoring-1",
    treeRoot: ".",
    analysis: null,
    priorAdvice: null,
    publicRequest: "solves the domain",
    review: {
      enabled: true,
      kind: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "low",
      source: "operator",
    },
    readerTurn: async (input) => {
      shown = `${input.systemPrompt}\n${input.prompt}`;
      return { pin: null, text: "", error: null };
    },
  });
  return shown;
}

const ROWS: readonly { off: string; surface: () => Promise<string> | string; promise: string }[] = [
  {
    off: "a Main Judge, at an authoring checkpoint",
    surface: authoringReview,
    promise: "The orientation lists every case the Main Judge",
  },
  {
    off: "the solve wall, for a session ending at its turn cap, after failed turns, on a cancel or on silence",
    surface: solverContract,
    promise: "at the end the last answer an artifact-writer prepared is submitted for you",
  },
  {
    off: "a prepared answer, for a candidate saved before any was prepared",
    surface: () =>
      toolReplies([
        ["save_candidate", { name: "early" }],
        ["restore_candidate", { name: "early" }],
      ]),
    promise: "is prepared again",
  },
  {
    off: "a current prepared answer, for a candidate saved after the draft moved past it",
    surface: () =>
      toolReplies([
        ["write", { answer: "ok" }],
        ["finish", {}],
        ["write", { answer: "worse" }],
        ["save_candidate", { name: "moved" }],
        ["restore_candidate", { name: "moved" }],
      ]),
    promise: "is prepared again",
  },
];

describe("a model-visible promise the host keeps only on some paths", () => {
  for (const { off, surface, promise } of ROWS) {
    it(`is not made without ${off}`, async () => {
      const text = await surface();
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain(promise);
    });
  }

  it("is still made where the host keeps it: a candidate saved with its answer current", async () => {
    const text = await toolReplies([
      ["write", { answer: "ok" }],
      ["finish", {}],
      ["save_candidate", { name: "best" }],
      ["write", { answer: "worse" }],
      ["restore_candidate", { name: "best" }],
    ]);
    expect(text).toContain("is prepared again");
  });
});

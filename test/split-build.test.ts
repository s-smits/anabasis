/**
 * A split build: an answer agent writes the correctness model, the controller hands its public
 * projection to a Harness Builder, and the Harness Builder's submit runs every gate. The wall
 * between the two halves is candidate-isolation-guard.test.ts; this file proves the prompts, the
 * answer pass, the sequencing and that no correctness-model finding reaches the Harness Builder.
 * The sessions are scripted, so these prove routing and recording, not authoring.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { answerSystemPrompt, harnessSystemPrompt, wallHours } from "../src/author/split-prompts.ts";
import { builderSystemPrompt } from "../src/author/builder-start-prompt.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import type { PiTool } from "../src/backends/pi-session.ts";
import { controllerValidatedFindings } from "../src/correctness-bundle/brief.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { answerWallMs } from "../src/run/builder-backend.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { FRESH_BUILD, namedTool, replyText } from "./helpers/builder-campaign.ts";
import { scriptedSession, toolDouble } from "./helpers/doubles.ts";
import {
  MATCHING_ACCEPTS,
  MATCHING_BRIEF,
  MATCHING_EVALUATOR_SOURCE,
  MATCHING_OPERATING_GUIDE,
  MATCHING_REFERENCE_SOURCE,
  MATCHING_REJECTS,
  MATCHING_TASKS,
  MATCHING_TOOLS_SOURCE,
  MATCHING_TOOLS_SPEC,
  padToCalibrationFloor,
} from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const HOUR = 3_600_000;

/** A detail only the correctness model holds, as a census row would quote it. */
const PROTECTED_DETAIL = "reference member load 41.7 kN at node 3";

type Role = "answer" | "harness";
type Turn = { pass: number; prompt: string; tools: readonly PiTool[] };

afterAll(cleanupScratch);

function writeAnswerHalf(workspace: string): void {
  mkdirSync(join(workspace, "correctness-model/reference"), { recursive: true });
  writeFileSync(join(workspace, "correctness-model/brief.json"), JSON.stringify(MATCHING_BRIEF));
  writeFileSync(join(workspace, "correctness-model/evaluator.ts"), MATCHING_EVALUATOR_SOURCE);
  writeFileSync(join(workspace, "correctness-model/reference/index.ts"), MATCHING_REFERENCE_SOURCE);
  writeFileSync(join(workspace, "correctness-model/tasks.json"), JSON.stringify(MATCHING_TASKS));
  const controls = {
    accept: padToCalibrationFloor("accept", MATCHING_ACCEPTS),
    reject: padToCalibrationFloor("reject", MATCHING_REJECTS),
  };
  writeFileSync(join(workspace, "correctness-model/controls.json"), JSON.stringify(controls));
}

function writeHarnessHalf(workspace: string): void {
  writeFileSync(join(workspace, "agent/tools.ts"), MATCHING_TOOLS_SOURCE);
  writeFileSync(join(workspace, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
  writeFileSync(join(workspace, "agent/tools-spec.json"), JSON.stringify(MATCHING_TOOLS_SPEC));
}

/** One opener for both roles, told apart by the system prompt each session opens with. A continued
 *  conversation keeps its session and receives its next roster through `configure`. */
function splitSessions(script: Record<Role, (turn: Turn) => Promise<void> | void>) {
  const turns: Array<Turn & { role: Role }> = [];
  const passes: Record<Role, number> = { answer: 0, harness: 0 };
  const open = async (opened: readonly PiTool[], systemPrompt: string) => {
    const role: Role = systemPrompt.startsWith("You are the answer agent") ? "answer" : "harness";
    let tools = opened;
    return scriptedSession(
      async ({ prompt }) => {
        passes[role] += 1;
        const turn = { pass: passes[role], prompt, tools };
        turns.push({ ...turn, role });
        await script[role](turn);
        return { status: "completed", assistantText: "done" };
      },
      () => {},
      (next) => {
        tools = next;
      },
    );
  };
  return { open, turns };
}

const names = (tools: readonly PiTool[]) => tools.map((tool) => tool.name);

describe("the split prompts", () => {
  const answer = answerSystemPrompt({ webSearch: false, wallMs: 4 * HOUR });
  const harness = harnessSystemPrompt({ webSearch: false });

  it("offers the answer agent its routes as options and states its wall", () => {
    expect(answer).toContain("The routes are options, alone or together, not steps:");
    for (const route of ["- Answer first:", "- Budget:", "- Depth:"]) expect(answer).toContain(route);
    expect(answer).toContain("store the best artifact under correctness-model/reference/");
    expect(answer).toContain("Your wall is 4 hours.");
    const routes = answer.split("\n").filter((line) => line.startsWith("- "));
    expect(routes).toHaveLength(3);
    for (const route of routes) expect(route).not.toMatch(/\b(?:step|then|next|after|before)\b/i);
    expect(wallHours(1.5 * HOUR)).toBe("1.5 hours");
    expect(wallHours(HOUR)).toBe("1 hour");
  });

  it("tells the Harness Builder of the public projection only, and none of the answer agent's duties", () => {
    expect(harness).toContain("public/tasks.json");
    expect(harness).toContain("you cannot read correctness-model/");
    for (const duty of ["hidden expectations", "reference solve", "controls", "raise"]) {
      expect(harness).not.toContain(duty);
    }
    expect(answer).not.toBe(builderSystemPrompt(false));
  });
});

describe("the answer wall's setting", () => {
  it.each<[Record<string, string>, number | undefined]>([
    [{}, undefined],
    [{ HARNESS_ANSWER_AGENT: "false", HARNESS_ANSWER_WALL_HOURS: "2" }, undefined],
    [{ HARNESS_ANSWER_AGENT: "true" }, 4 * HOUR],
    [{ HARNESS_ANSWER_AGENT: "true", HARNESS_ANSWER_WALL_HOURS: "1.5" }, 1.5 * HOUR],
  ])("reads %j", (env, wall) => {
    expect(answerWallMs(env)).toBe(wall);
  });

  it.each([
    { HARNESS_ANSWER_AGENT: "yes" },
    { HARNESS_ANSWER_AGENT: "true", HARNESS_ANSWER_WALL_HOURS: "0" },
  ])("refuses %j", (env) => {
    expect(() => answerWallMs(env)).toThrow(/must be/);
  });
});

describe("an answer pass", () => {
  it("has no submit, ends with its turn and refuses its tools once the wall has passed", async () => {
    const workspace = scratchDir("ana-answer-pass-");
    const seen = { roster: [""], system: "", reply: "" };
    const write = toolDouble({ name: "write", execute: async () => ({ content: [] }) });
    const outcome = await runBuilderSession(
      {
        slug: "matching",
        kickoff: "Build a harness.",
        workspace,
        split: { role: "answer", wallMs: 0 },
        maxTurns: 1,
      },
      {
        tools: [write],
        waitMs: async () => {},
        open: async (tools, systemPrompt) => {
          seen.roster = names(tools);
          seen.system = systemPrompt;
          return scriptedSession(async () => {
            seen.reply = await replyText(namedTool(tools, "write"), "call");
            return { status: "completed", assistantText: "done" };
          });
        },
      },
    );
    expect(seen.roster).toEqual(["write"]);
    expect(seen.system).toBe(answerSystemPrompt({ webSearch: false, wallMs: 0 }));
    expect(seen.reply).toContain('"reason":"wall"');
    expect(outcome).toMatchObject({ ok: false, turns: 1, terminal: false, terminalClause: null });
  });
});

describe("a split build's round", () => {
  it("hands the Harness Builder the projection, and hands a correctness-model refusal back unread", async () => {
    const campaignDir = scratchDir("ana-split-round-");
    const workspace = join(campaignDir, "workspace");
    let gateCalls = 0;
    const replies: string[] = [];
    const { open, turns } = splitSessions({
      answer: ({ pass }) => {
        if (pass === 2) writeAnswerHalf(workspace);
        if (pass === 3) writeFileSync(join(workspace, "correctness-model/NOTES.md"), "revised\n");
      },
      harness: async ({ tools }) => {
        writeHarnessHalf(workspace);
        replies.push(await replyText(namedTool(tools, "correctness_check"), "check"));
        replies.push(await replyText(namedTool(tools, "submit"), "submit"));
      },
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD },
      {
        tools: [],
        answer: { tools: [], wallMs: HOUR },
        toolsProbes: () => ({}),
        waitMs: async () => {},
        gates: async () =>
          gateCalls++ === 0
            ? [
                {
                  owner: "correctness-model/evaluator.ts",
                  severity: "blocking",
                  claim: "the reference solve fails a check",
                  evidence: "census.json",
                  findings: controllerValidatedFindings([
                    { code: "reference-solve-failed", path: "census.json", detail: PROTECTED_DETAIL },
                  ]),
                },
              ]
            : [],
        open,
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(turns.map((turn) => turn.role)).toEqual(["answer", "answer", "harness", "answer", "harness"]);
    const [empty, written, harness, revised, resubmit] = turns;
    // The starter's correctness model does not validate alone, so it goes back before any harness pass.
    expect(written?.prompt).toContain("The correctness model came back with these findings:");
    expect(names(empty?.tools ?? [])).not.toContain("submit");
    expect(names(harness?.tools ?? [])).toContain("submit");
    for (const tool of ["harness_reset", "public_source", "verifier_workshop"]) {
      expect(names(harness?.tools ?? [])).not.toContain(tool);
    }
    const published = JSON.parse(readFileSync(join(workspace, "public/tasks.json"), "utf8"));
    expect(published).toHaveLength(MATCHING_TASKS.length);
    expect(JSON.stringify(published)).not.toContain('"hidden"');
    expect(existsSync(join(workspace, "public/resources.json"))).toBe(true);
    // Rule 4 across the split: the census row reaches the answer agent and never the Harness Builder.
    expect(replies[0]).toContain("Not shown here: 1 finding on the correctness model");
    expect(replies[1]).toContain("split-handed-back");
    for (const reply of replies) expect(reply).not.toContain(PROTECTED_DETAIL);
    expect(harness?.prompt).not.toContain(PROTECTED_DETAIL);
    expect(revised?.prompt).toContain(PROTECTED_DETAIL);
    expect(resubmit?.prompt).toContain(
      "The answer agent revised the correctness model after your last submit",
    );
    expect(gateCalls).toBe(2);
  });

  it("ends as stalled when the correctness model never validates within its passes", async () => {
    const campaignDir = scratchDir("ana-split-stall-");
    const { open, turns } = splitSessions({ answer: () => {}, harness: () => {} });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD },
      {
        tools: [],
        answer: { tools: [], wallMs: HOUR },
        toolsProbes: () => ({}),
        waitMs: async () => {},
        open,
      },
    );
    expect(turns.map((turn) => turn.role)).toEqual(["answer", "answer", "answer"]);
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "authoring-stalled" });
  });
});

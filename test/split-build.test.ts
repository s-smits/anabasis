/**
 * A split build: an answer agent writes the correctness model, the controller hands its public
 * projection to a Harness Builder, and the Harness Builder's submit runs every gate. The wall
 * between the two halves is candidate-isolation-guard.test.ts; this file proves the prompts, the
 * answer pass, the sequencing and that no correctness-model finding reaches the Harness Builder,
 * and that each side opens through the production entry gate against its own roster, both sides
 * checked before the first answer pass. The sessions are scripted, so these prove routing and
 * recording, not authoring.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { answerSystemPrompt, harnessSystemPrompt, wallHours } from "../src/author/split-prompts.ts";
import { builderSystemPrompt } from "../src/author/builder-start-prompt.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import type { PiTool } from "../src/backends/pi-session.ts";
import { controllerValidatedFindings } from "../src/correctness-bundle/brief.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { ResolvedSlots } from "../src/backends/resolve.ts";
import { answerWallMs } from "../src/run/builder-backend.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { composeBuilderRuntime } from "../src/run/builder-runtime.ts";
import type { AskManifest } from "../src/run/ask-manifest.ts";
import { FRESH_BUILD, namedTool, replyText } from "./helpers/builder-campaign.ts";
import { mountRepo } from "./helpers/builder-mount-repo.ts";
import { double, scriptedSession, toolDouble } from "./helpers/doubles.ts";
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
import { errorMessage } from "../src/meta/runtime-values.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { toolTreeSearchDirs } from "../src/verify/solve-command-isolation.ts";

const HOUR = 3_600_000;

/** A detail only the correctness model holds, as a census row would quote it. */
const PROTECTED_DETAIL = "reference member load 41.7 kN at node 3";

/** Every tool a side registers, as the production composition mounts it and the campaign adds the
 *  round's own: the Harness Builder submits and neither researches nor runs the workshop, the
 *  answer agent researches and never submits, and neither side has a reset. */
const ROSTERS = {
  harness: "bash context correctness_check edit find grep harness_inspect harness_trial ls read submit write",
  answer:
    "bash context correctness_check edit find grep harness_inspect harness_trial ls public_source read verifier_workshop write",
};

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

/** What one tool call returned to the model, a refusal's message included. */
async function callText(tools: readonly PiTool[], name: string, args: Record<string, string>) {
  try {
    return await namedTool(tools, name)
      .execute(name, args)
      .then((result) => result.content.map((part) => part.text).join("\n"));
  } catch (error) {
    return `refused: ${errorMessage(error)}`;
  }
}

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

/** The gate that refuses a starter correctness model once, as a census row would. */
function refusesOnce() {
  let calls = 0;
  const gates = async (): Promise<CampaignFeedback[]> =>
    calls++ === 0
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
      : [];
  return { gates, calls: () => calls };
}

describe("a split build's round", () => {
  it("hands the Harness Builder the projection, and hands a correctness-model refusal back unread", async () => {
    const campaignDir = scratchDir("ana-split-round-");
    const workspace = join(campaignDir, "workspace");
    const gate = refusesOnce();
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
        gates: gate.gates,
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
    expect(gate.calls()).toBe(2);
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

/** The production split composition, mount and session recorder, on a minimal repository. */
function productionSplit(label: string) {
  const { repoRoot, campaignDir } = mountRepo(scratchDir("ana-split-production-"), label);
  const slot = { kind: "openrouter", model: "vendor/model", reasoningEffort: "high", source: "default" };
  const runtime = composeBuilderRuntime(double<AskManifest>({ slug: "hw" }), {}, repoRoot, campaignDir, {
    slots: double<ResolvedSlots>({
      slug: "hw",
      builder: slot,
      built: slot,
      review: slot,
      operatorConfig: null,
    }),
    builder: { kind: "openrouter", model: "vendor/model", reasoningEffort: "high", answerWallMs: HOUR },
  });
  const answer = runtime.answer;
  if (answer === undefined) throw new Error("a split condition composed no answer agent");
  return { campaignDir, workspace: join(campaignDir, "workspace"), runtime, answer };
}

const evidenceAt = (campaignDir: string, file: string) =>
  JSON.parse(readFileSync(join(campaignDir, file), "utf8"));

describe("a split round on the production composition", () => {
  it("opens each side through the entry gate against its own roster and leaves each side's evidence", async () => {
    const { campaignDir, workspace, runtime, answer } = productionSplit("round");
    const gate = refusesOnce();
    const { open, turns } = splitSessions({
      answer: ({ pass }) => {
        if (pass === 2) writeAnswerHalf(workspace);
        if (pass === 3) writeFileSync(join(workspace, "correctness-model/NOTES.md"), "revised\n");
      },
      harness: async ({ tools }) => {
        writeHarnessHalf(workspace);
        await replyText(namedTool(tools, "submit"), "submit");
      },
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD },
      {
        tools: runtime.tools,
        answer,
        recordSession: runtime.recordSession,
        toolsProbes: () => ({}),
        waitMs: async () => {},
        gates: gate.gates,
        open,
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(turns.map((turn) => turn.role)).toEqual(["answer", "answer", "harness", "answer", "harness"]);
    for (const turn of turns) expect(names(turn.tools).sort().join(" ")).toBe(ROSTERS[turn.role]);
    const harness = evidenceAt(campaignDir, "builder-session.json");
    const answered = evidenceAt(campaignDir, "builder-session-answer.json");
    expect(harness.contract.catalogued.join(" ")).toBe(ROSTERS.harness);
    expect(harness.contract.registered).toEqual(harness.contract.catalogued);
    expect(answered.contract.catalogued.join(" ")).toBe(ROSTERS.answer);
    expect(answered.contract.registered).toEqual(answered.contract.catalogued);
    // Each side records the wall its own file tools run behind.
    const filePolicy = (evidence: { isolations: Array<{ policyDigest: string; capabilities: string[] }> }) =>
      evidence.isolations.find((row) => row.capabilities.includes("write"))?.policyDigest;
    expect(filePolicy(answered)).toMatch(/^[0-9a-f]{64}$/);
    expect(filePolicy(answered)).not.toBe(filePolicy(harness));
    expect(answered.framingDigest).not.toBe(harness.framingDigest);
  });

  // Seconds before the answer pass, not hours after it.
  it.each([
    ["harness", "the Harness Builder's roster"],
    ["answer", "the answer agent's roster"],
  ] as const)("refuses %s drift before any session opens (%s)", async (side) => {
    const { campaignDir, runtime, answer } = productionSplit(`drift-${side}`);
    const { open, turns } = splitSessions({ answer: () => {}, harness: () => {} });
    const drop = (tools: typeof runtime.tools) => tools.filter((tool) => tool.name !== "grep");
    const run = runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD },
      {
        tools: side === "harness" ? drop(runtime.tools) : runtime.tools,
        answer: side === "answer" ? { ...answer, tools: drop(answer.tools) } : answer,
        recordSession: runtime.recordSession,
        toolsProbes: () => ({}),
        waitMs: async () => {},
        gates: refusesOnce().gates,
        open,
      },
    );
    await expect(run).rejects.toThrow(new RegExp(`^Builder entry gate \\(${side}\\): `));
    expect(turns).toEqual([]);
  });

  // The answer agent's instruments run in the verifier's cell from the tool tree, so they cannot
  // live in correctness-model/; they live in the tool tree's answer subtree, behind the wall.
  it.if(osIsolationSupport().ok)(
    "keeps an instrument the answer agent installed from the Harness Builder's file tools and shell",
    async () => {
      const { campaignDir, workspace, runtime, answer } = productionSplit("install");
      const instrument = ".toolchain/answer/bin/truss-verify";
      const body = `#!/bin/sh\necho "${PROTECTED_DETAIL}"\n`;
      const seen: Record<string, string> = {};
      const { open, turns } = splitSessions({
        answer: async ({ tools }) => {
          writeAnswerHalf(workspace);
          seen.install = await callText(tools, "write", { path: instrument, content: body });
          seen.run = await callText(tools, "bash", { command: `chmod +x ${instrument} && ${instrument}` });
          seen.stray = await callText(tools, "write", {
            path: ".toolchain/lib/truss_verify.py",
            content: body,
          });
        },
        harness: async ({ tools }) => {
          writeHarnessHalf(workspace);
          seen.read = await callText(tools, "read", { path: instrument });
          seen.cat = await callText(tools, "bash", { command: `cat ${instrument}` });
          seen.append = await callText(tools, "bash", { command: `echo tampered >> ${instrument}` });
          seen.own = await callText(tools, "write", {
            path: ".toolchain/bin/harness-tool",
            content: "#!/bin/sh\n",
          });
          seen.submit = await callText(tools, "submit", {});
        },
      });
      const outcome = await runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD },
        {
          tools: runtime.tools,
          answer,
          recordSession: runtime.recordSession,
          toolsProbes: () => ({}),
          waitMs: async () => {},
          gates: async () => [],
          open,
        },
      );
      expect(turns.map((turn) => turn.role)).toEqual(["answer", "harness"]);
      expect(outcome.buildAdmissible).toBe(true);
      expect(seen.read).toStartWith("refused:");
      for (const reply of [seen.read, seen.cat, seen.append]) expect(reply).not.toContain(PROTECTED_DETAIL);
      expect(seen.cat).toContain("Operation not permitted");
      expect(seen.append).toContain("Operation not permitted");
      expect(seen.own).not.toStartWith("refused:");
      expect(seen.stray).toStartWith("refused:");
      expect(seen.run).toContain(PROTECTED_DETAIL);
      expect(readFileSync(join(workspace, instrument), "utf8")).toBe(body);
      // The verifier's tool search, which the check cell and the Built shell share, finds it.
      expect(toolTreeSearchDirs(join(workspace, ".toolchain"))).toContain(
        join(workspace, ".toolchain/answer/bin"),
      );
    },
  );
});

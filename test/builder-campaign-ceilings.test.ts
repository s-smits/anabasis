/**
 * When a Builder campaign stops paying for a session that cannot make progress.
 *
 * Three counters end a session: the no-op strike on the controller-owned candidate identity, the
 * durable provider budget and a blocking environment row. Each one counts across
 * invocations, so a relaunch cannot buy its allowance again, and none of them charges an
 * environment non-result to the author. Below its ceiling a counter steers instead of stopping.
 */
import { existsSync, mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  FRESH_BUILD,
  TRUSS_CRASH,
  blockingRow,
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  proposeExperiment,
  requireExternalVerifier,
  submitTool,
  submittingSession,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { required, scriptedSession } from "./helpers/doubles.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { POLICY } from "../src/critic/policy.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { generatedExecutionFinding } from "../src/truth/brief.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { BuilderCampaignDeps } from "../src/run/builder-campaign.ts";
import { submitProjection } from "../src/author/builder-execution.ts";
import { readAuthoringAttemptEvidence } from "../src/author/build-attempt-evidence.ts";
import type { AgentToolsProbes } from "../src/author/agent-tools-session.ts";
import type { CampaignOutcome, FeedbackOwner, IterationEvidence } from "../src/author/campaign-types.ts";
import {
  CampaignBudgetConfigurationError,
  campaignBudgetGate,
  setTurnBudget,
} from "../src/run/campaign-budget.ts";
import { loadBudget } from "../src/run/controller-ledger.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

afterAll(cleanupScratch);

const BARE = { tools: [], toolsProbes: () => ({}) } satisfies Pick<
  BuilderCampaignDeps,
  "tools" | "toolsProbes"
>;
const KICKOFF_HASH = hashJsonValue(FRESH_BUILD.kickoff);
const refusedConformance = (): AgentToolsProbes => ({
  load: async () => [{ code: "generated-load-crash", path: "agent/tools.ts", detail: "worker exited" }],
});
const neverOpens = async (): Promise<HostSession> => {
  throw new Error("a refused campaign must not open a provider session");
};

/** Completed iteration records a relaunch replays, bound to the fixture campaign. */
function recordIterations(campaignDir: string, rows: readonly Partial<IterationEvidence>[]): void {
  writeFileSync(
    join(campaignDir, "campaign.json"),
    JSON.stringify({ domain: "matching", kickoffHash: KICKOFF_HASH }),
  );
  rows.forEach((row, index) => {
    const dir = join(campaignDir, `${String(index + 1).padStart(2, "0")}-matching`);
    mkdirSync(dir, { recursive: true });
    const record = { submissionConditionId: `condition-${index + 1}`, feedback: [], ...row };
    writeFileSync(join(dir, "iteration.json"), JSON.stringify(record));
  });
}

describe("a relaunch reads the durable counters before it opens a session", () => {
  const commit = "52e0d68c".padEnd(40, "0");
  const unchanged: Partial<IterationEvidence> = {
    outcome: "fingerprinted",
    workspaceChange: { baseCommit: commit, commit, changedPaths: [], deletedPaths: [] },
  };
  const blockedBy = (owner: FeedbackOwner): Partial<IterationEvidence> => ({
    outcome: "gates-blocked",
    feedback: [blockingRow(owner, "carried from the last build", "iteration.json")],
  });
  it.concurrent.each([
    [
      "the unchanged-candidate ceiling on the replayed commit",
      Array(POLICY.loop.unchangedCandidateStrikes).fill(unchanged),
      "authoring-stalled",
    ],
    ["a carried blocking environment row", [blockedBy("environment")], "environment-blocked"],
    ["carried author-owned feedback with no admitted packet", [blockedBy("agent/BUILT_AGENTS.md")], null],
  ] as const)("%s", async (_name, rows, clause) => {
    const campaignDir = scratchDir("ana-pre-session-");
    recordIterations(campaignDir, rows);
    let opened = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1, experiment: "build" },
      {
        ...BARE,
        open: async () => {
          opened += 1;
          return scriptedSession(async () => ({ status: "completed", assistantText: "no submission" }));
        },
      },
    );
    if (clause === null) {
      // A pre-adoption continuation carries its feedback in the queue, and the in-flight build owns
      // the whole tree, so author-owned rows direct the session rather than refusing it.
      expect(opened).toBe(1);
      expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
      return;
    }
    expect(outcome).toEqual({ buildAdmissible: false, clause, iterations: [] });
    expect(opened).toBe(0);
    expect(existsSync(join(campaignDir, "workspace"))).toBe(false);
  });
});

describe("the no-op strike on a candidate the session keeps resubmitting", () => {
  it.concurrent("reuses a refusal when the session returns to an earlier candidate, then accepts changed bytes", async () => {
    const campaignDir = scratchDir("ana-strike-cycle-");
    const workspace = join(campaignDir, "workspace");
    // A → B → A → C. Only three trees are distinct, so the return to A costs no gate run.
    const lines = ["a", "b", "a", "c"];
    let gateCalls = 0;
    const session = submittingSession((turn) => {
      completeBundle(workspace);
      writeFileSync(
        join(workspace, "agent/BUILT_AGENTS.md"),
        `${MATCHING_OPERATING_GUIDE}\n${lines[turn - 1]}\n`,
      );
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 4 },
      {
        ...BARE,
        open: session.open,
        gates: async () => {
          gateCalls += 1;
          return gateCalls < 3
            ? [blockingRow("correctness-model/tasks.json", "the defect remains", `census-${gateCalls}.json`)]
            : [];
        },
      },
    );
    expect(gateCalls).toBe(3);
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations.map((row) => row.outcome)).toEqual([
      "gates-blocked",
      "gates-blocked",
      "fingerprinted",
    ]);
    // The controller commits before it validates, so the return to A lands on a third commit over
    // the first tree. The execution record keys on the tree, and names the return.
    const submits = required(readExecutionEvidence(campaignDir)[0], "one execution record").submits;
    expect(submits.map((row) => row.treeFirstSubmittedAsAttempt)).toEqual([null, null, 1, null]);
    expect(submits[2]?.commit).not.toBe(submits[0]?.commit);
    expect(submits[2]?.treeId).toBe(required(submits[0]?.treeId, "the first tree"));
    expect(submitProjection(submits)).toMatchObject({ uniqueCandidateTrees: 3, repeatedTreeSubmits: 1 });
  });

  // The strike identity is the candidate contract, not the workspace commit: note files at the
  // workspace root sit outside both contract roots, and a bundle refusal is struck on the same
  // identity as a gate refusal, so neither kind of churn can keep a stalled session alive.
  it.concurrent.each([
    ["a gate refusal resubmitted under note-file churn", false, 1, 1],
    ["a bundle refusal naming a tool installed nowhere", true, 0, 0],
  ] as const)(
    "ends %s on the strike ceiling",
    async (_name, externalTool, expectedGateCalls, expectedIterations) => {
      const campaignDir = scratchDir("ana-strike-ceiling-");
      const workspace = join(campaignDir, "workspace");
      let gateCalls = 0;
      const session = submittingSession((turn) => {
        completeBundle(workspace);
        if (externalTool) requireExternalVerifier(workspace);
        writeFileSync(join(workspace, "MEMORY.md"), `note for attempt ${turn}\n`);
      });
      const outcome = await runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, maxTurns: 8 },
        {
          ...BARE,
          open: session.open,
          gates: async () => {
            gateCalls += 1;
            return [
              blockingRow(
                "correctness-model/tasks.json",
                "the same task defect remains",
                `census-${gateCalls}.json`,
              ),
            ];
          },
        },
      );
      // Eight turns were available: one refusal, three counted strikes, terminal on the third. A
      // bundle refusal never reaches the verifier gate, so it cannot settle verifier-required either.
      expect(session.replies).toHaveLength(4);
      expect(outcome).toMatchObject({ buildAdmissible: false, clause: "authoring-stalled" });
      expect(gateCalls).toBe(expectedGateCalls);
      expect(outcome.iterations).toHaveLength(expectedIterations);
      const record = required(readExecutionEvidence(campaignDir)[0], "one execution record");
      expect(record.submits.map((row) => row.workspaceChanged)).toEqual([null, false, false, false]);
      expect(submitProjection(record.submits)).toMatchObject({
        uniqueCandidateTrees: 1,
        unchangedTreeSubmits: 3,
      });
    },
  );

  it.concurrent("continues the strike count across invocations on the same blocked candidate", async () => {
    const campaignDir = scratchDir("ana-strike-resume-");
    const workspace = join(campaignDir, "workspace");
    const run = async (maxTurns: number) => {
      const session = submittingSession(() => completeBundle(workspace));
      const outcome = await runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, maxTurns },
        {
          ...BARE,
          open: session.open,
          gates: async () => [blockingRow("correctness-model/tasks.json", "the same task defect remains")],
        },
      );
      return { outcome, turns: session.replies.length };
    };
    expect((await run(2)).turns).toBe(2);
    // The replayed identity makes the resumed refusal a strike, so the ceiling ends the second
    // invocation after three turns instead of granting four fresh ones.
    const resumed = await run(6);
    expect(resumed.turns).toBe(3);
    expect(resumed.outcome).toMatchObject({ buildAdmissible: false, clause: "authoring-stalled" });
  }, 30_000);

  it.concurrent("re-executes a tree whose only refusal was a typed runtime non-result, and strikes nothing", async () => {
    const campaignDir = scratchDir("ana-strike-nonresult-");
    const workspace = join(campaignDir, "workspace");
    let loads = 0;
    const session = submittingSession(() => completeBundle(workspace));
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 4 },
      {
        ...BARE,
        toolsProbes: () => ({
          load: async () => {
            loads += 1;
            const termination = {
              code: "generated-toolset-termination",
              path: "agent/tools.ts",
              detail: "worker crashed",
            };
            return loads <= 2 ? [generatedExecutionFinding(termination, "generated-toolset-contract")] : [];
          },
        }),
        gates: async () => [],
        open: session.open,
      },
    );
    // A non-result is a fact about one execution, not a verdict on the bytes: the same tree paid
    // for a fresh execution each time, and the unchanged resubmit was not a no-op strike.
    expect(loads).toBe(3);
    expect(session.replies[1]).not.toContain("authoring-noop-submit");
    expect(outcome.buildAdmissible).toBe(true);
  });

  it.concurrent("keeps each refused proposal as evidence without treating its wording as progress", async () => {
    const campaignDir = scratchDir("ana-strike-proposal-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    completeBundle(adoptedDir);
    bundleWithoutGuide(workspace);
    const proposals: ReturnType<typeof proposeExperiment>[] = [];
    const replies: string[] = [];
    let opens = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: POLICY.loop.unchangedCandidateStrikes + 1,
        experiment: "build",
        adoptedDir,
      },
      {
        ...BARE,
        gates: async () => {
          throw new Error("a malformed candidate must not reach the gates");
        },
        open: async (tools) => {
          opens += 1;
          return scriptedSession(async () => {
            for (let index = 0; index <= POLICY.loop.unchangedCandidateStrikes; index += 1) {
              proposals.push(proposeExperiment(workspace, "product", `Public gap hypothesis ${index}.`));
              const reply = await submitTool(tools).execute(`proposal-${index}`, {});
              replies.push(reply.content[0]?.text ?? "");
            }
            return { status: "completed" };
          });
        },
      },
    );
    expect(opens).toBe(1);
    expect(outcome).toMatchObject({
      buildAdmissible: false,
      clause: "authoring-stalled",
      experimentProposal: proposals.at(-1),
      iterations: [],
    });
    const submits = required(readExecutionEvidence(campaignDir)[0], "one execution record").submits;
    expect(submits.map((row) => row.experimentProposal)).toEqual(proposals);
    expect(submits.at(-1)?.terminal).toBe(true);
    expect(replies[1]).toContain("unchanged candidate and verifier condition");
    expect(replies[1]).toContain("EXPERIMENT.json and memory edits do not change that condition");
    expect(replies.at(-1)).toContain("proposal or memory edits do not change that condition");
    expect(replies.join("\n")).not.toContain("byte-identical tree");
  });
});

describe("the trailing run of one identical diagnosis", () => {
  /** One blocked attempt per turn, each moving the agent bundle so the fingerprint changes while the
   *  gates repeat or alternate their claim. The attempts are split across campaigns so the trailing
   *  run has to survive the campaign boundary through memory as well as inside one session. */
  async function churn(turnsPerCampaign: readonly number[], claimFor: (attempt: number) => string) {
    const campaignDir = scratchDir("ana-stalled-findings-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const session = submittingSession((attempt) =>
      writeFileSync(join(workspace, "agent/tools.ts"), `export const attempt = ${attempt};\n`),
    );
    const outcomes: CampaignOutcome[] = [];
    for (const maxTurns of turnsPerCampaign) {
      outcomes.push(
        await runBuilderCampaign(
          { campaignDir, ...FRESH_BUILD, maxTurns },
          {
            ...BARE,
            open: session.open,
            gates: async () => [
              blockingRow("correctness-model/tasks.json", claimFor(session.replies.length + 1)),
            ],
          },
        ),
      );
    }
    return { outcomes, rows: outcomes.flatMap((outcome) => outcome.iterations), replies: session.replies };
  }

  it.concurrent("leaves one diagnosis repeated over changed bytes to the Builder however long it runs", async () => {
    // More rounds than the loop has ever allowed a repeat, split across a relaunch.
    const { outcomes, rows, replies } = await churn([8, 1], () => "the same authoring defect remains");
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    }
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((row) => row.findingsHash)).size).toBe(1);
    expect(replies.join("\n")).not.toContain("authoring-repeated-findings");
  }, 40_000);
});

describe("a census that reached no completed run", () => {
  /** One campaign whose gate writes a copy of TRUSS_CRASH for the tool named on that turn; `null`
   *  leaves only the gate refusal. The tree changes every turn, so the no-op strike never fires. */
  async function sealing(perTurn: readonly (string | null)[], probes = (): AgentToolsProbes => ({})) {
    const campaignDir = scratchDir("ana-tool-ceiling-");
    const workspace = join(campaignDir, "workspace");
    const session = submittingSession((turn) => {
      completeBundle(workspace);
      writeFileSync(join(workspace, "correctness-model/attempt.md"), `attempt ${turn}\n`);
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: perTurn.length },
      {
        tools: [],
        toolsProbes: probes,
        open: session.open,
        gates: async (_harness, iterationDir) => {
          const toolId = perTurn[session.replies.length] ?? null;
          if (toolId !== null) {
            writeFileSync(
              join(iterationDir, "verifier-non-result.json"),
              `${JSON.stringify({ ...TRUSS_CRASH, toolId })}\n`,
            );
          }
          return [
            blockingRow("correctness-model/evaluator.ts", "the control census did not settle", "census.json"),
          ];
        },
      },
    );
    return { outcome, replies: session.replies, campaignDir };
  }

  it("records each no-result census for the author and never settles the campaign on it", async () => {
    const { outcome, replies } = await sealing(Array(4).fill("fwcheck"));
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    expect(outcome.iterations).toHaveLength(4);
    expect(replies).toHaveLength(4);
    expect(replies.join("\n")).not.toContain("tool-non-result");
  });

  it("settles an environment-blocked gate run beside a conformance refusal on its first turn, with no iteration", async () => {
    const campaignDir = scratchDir("ana-conformance-env-");
    const workspace = join(campaignDir, "workspace");
    const session = submittingSession((turn) => {
      completeBundle(workspace);
      writeFileSync(join(workspace, "correctness-model/attempt.md"), `attempt ${turn}\n`);
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: refusedConformance,
        gates: async () => [blockingRow("environment", "the host refused the census", "census.json")],
        open: session.open,
      },
    );
    expect(outcome).toEqual({ buildAdmissible: false, clause: "environment-blocked", iterations: [] });
    expect(session.replies).toHaveLength(1);
  });
});

describe("the campaign's provider ledger", () => {
  const talking = (status: "completed" | "failed", text: string) => async () =>
    scriptedSession(async () =>
      status === "completed" ? { status, assistantText: text } : { status, errorMessages: [text] },
    );

  it.concurrent("refuses an exhausted budget before opening a session, and charges nothing for asking", async () => {
    const campaignDir = scratchDir("ana-budget-exhausted-");
    setTurnBudget(campaignDir, 1);
    campaignBudgetGate(campaignDir).startAttempt("builder").complete();
    const before = loadBudget(campaignDir);
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 3 },
      { ...BARE, budget: campaignBudgetGate(campaignDir), open: neverOpens },
    );
    expect(outcome).toEqual({ buildAdmissible: false, clause: "budget-limited", iterations: [] });
    expect(loadBudget(campaignDir)).toEqual(before);
  });

  it.concurrent("charges every completed turn, the session tail after the last submit included", async () => {
    const campaignDir = scratchDir("ana-budget-tail-");
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 3 },
      {
        ...BARE,
        budget: campaignBudgetGate(campaignDir),
        open: talking("completed", "still reading the workspace"),
      },
    );
    expect(loadBudget(campaignDir)).toMatchObject({ turnsUsed: 3, status: "active" });
  });

  it.concurrent("derives the per-call gate from the durable budget and stops before a second turn", async () => {
    const campaignDir = scratchDir("ana-budget-per-call-");
    setTurnBudget(campaignDir, 1);
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      {
        ...BARE,
        budget: campaignBudgetGate(campaignDir),
        open: async () =>
          scriptedSession(async () => {
            turns += 1;
            return { status: "completed", assistantText: "still authoring" };
          }),
      },
    );
    expect(turns).toBe(1);
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "budget-limited" });
    expect(loadBudget(campaignDir)).toEqual({ turnBudget: 1, turnsUsed: 1, status: "budget_limited" });
  });

  it.concurrent("records a failed Builder turn as a non-result and charges each of its retries", async () => {
    const campaignDir = scratchDir("ana-budget-non-result-");
    await expect(
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD },
        {
          ...BARE,
          waitMs: async () => {},
          budget: campaignBudgetGate(campaignDir),
          open: talking("failed", "provider unavailable"),
        },
      ),
    ).rejects.toThrow(/failed \(role builder\).*provider unavailable/);
    expect(readAuthoringAttemptEvidence(campaignDir)).toMatchObject([
      {
        outcome: "non-result",
        terminal: { role: "builder", status: "failed", attribution: null },
        authorCalls: { builder: 1 },
      },
    ]);
    // One authoring turn, four model calls: the failed turn and the three retries it was given.
    expect(loadBudget(campaignDir)).toMatchObject({ turnsUsed: 4, status: "active" });
  });

  it.concurrent("charges a failed turn after an accepted submit exactly once", async () => {
    const campaignDir = scratchDir("ana-budget-submit-then-fail-");
    setTurnBudget(campaignDir, 1);
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        ...BARE,
        waitMs: async () => {},
        gates: async () => [],
        budget: campaignBudgetGate(campaignDir),
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(join(campaignDir, "workspace"));
            await submitTool(tools).execute("submit", {});
            return { status: "failed", errorMessages: ["provider ended after submit"] };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(loadBudget(campaignDir)).toEqual({ turnBudget: 1, turnsUsed: 1, status: "budget_limited" });
  });

  it.concurrent("refuses a budget double narrower than the durable gate before opening a session", async () => {
    const campaignDir = scratchDir("ana-budget-narrow-");
    await expect(
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD },
        { ...BARE, budget: { status: () => "active" }, open: neverOpens },
      ),
    ).rejects.toBeInstanceOf(CampaignBudgetConfigurationError);
  });

  it.concurrent("ends a session whose cap ran out mid-turn with a typed terminal and no laundered prose", async () => {
    // The in-session budget terminal is a claim-only environment row: nothing a controller
    // validator produced, so the author reads the fail-closed label rather than the row's prose.
    const campaignDir = scratchDir("ana-budget-in-session-");
    let checks = 0;
    const session = submittingSession();
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        ...BARE,
        gates: async () => [],
        open: session.open,
        budget: {
          // Active at the pre-session boundary, spent by the submit.
          status: () => (checks++ === 0 ? "active" : "budget_limited"),
          campaignRoot: campaignDir,
          assertAttemptAvailable: () => {},
          startAttempt: () => ({ beginProviderTurn: () => {}, complete: () => {} }),
        },
      },
    );
    expect(session.replies[0]).not.toContain("campaign turn budget is spent");
    expect(session.replies[0]).toContain(
      "gate-unvalidated environment: this gate produced no controller-validated finding; no public detail is available",
    );
    const execution = readExecutionEvidence(campaignDir);
    expect(execution).toHaveLength(1);
    expect(execution[0]?.submits).toEqual([
      expect.objectContaining({ kind: "controller-terminal", commit: "budget-limited", terminal: true }),
    ]);
    expect(submitProjection(execution[0]?.submits ?? []).submitCounts).toEqual({
      raw: 1,
      candidates: 0,
      controllerTerminals: 1,
    });
  });
});

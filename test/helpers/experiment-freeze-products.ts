/**
 * The adopted products experiment-intent{,-tool}.e2e.test.ts continue from, and the one scripted
 * continuation each of its rows runs. A row rewrites a fresh workspace from the fixture, edits it,
 * declares an experiment and submits through the campaign's own submit, census and full-task F2
 * over a private copy of the adopted product; the accepted bytes then decide the attribution. Two
 * variants are adopted: authored checks alone, and checks that require the installed fixture tool.
 */
import { PLAN_FIELDS } from "./experiment-plan.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { expect } from "bun:test";
import { double, required, scriptedSession } from "./doubles.ts";
import { uppercaseFixture } from "./uppercase-fixture.ts";
import { cpSync, existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { scratchDir } from "./scratch.ts";
import { fingerprintSlug } from "../../src/claim/fingerprint.ts";
import { makeAgentToolsProbes } from "../../src/author/agent-tools-session.ts";
import { makeProbeControls } from "../../src/truth/probes.ts";
import { makeSolvabilityCensusGate } from "../../src/run/solvability-gate.ts";
import { publishProductVersion } from "../../src/run/product-versions.ts";
import { makeCensusGate } from "../../src/run/census-gate.ts";
import { type BuilderCampaignDeps, runBuilderCampaign } from "../../src/run/builder-campaign.ts";
import {
  type VerifierLifetime,
  createVerifierLifetime,
  closeVerifierLifetime,
} from "../../src/verify/verifier-lifetime.ts";
import type { BuiltHarness, FeedbackOwner } from "../../src/author/campaign-types.ts";
import type { HarnessExperiment } from "../../src/critic/types.ts";
import { EXPERIMENT_FILE } from "../../src/author/builder-memory.ts";

const FRESH = {
  slug: "matching",
  kickoff: "Build a harness.",
  expectedTasks: 4,
  maxTurns: 1,
} as const;
const FIXTURE_TOOL = ".toolchain/bin/uppercase-fixture";

export interface AdoptedProduct {
  adoptedDir: string;
  harness: BuiltHarness;
}

/** One continuation: the fixture battery (redesigned or the adopted one) plus an edit, under a
 *  declared scope. `admitted` is the attribution the accepted bytes must carry; `refused` is the
 *  code the submission must name instead. */
export interface IntentRow {
  tool: boolean;
  scope: "tasks" | "product";
  redesign: boolean;
  /** The owner of an admitted blocking finding about the adopted product. */
  owner?: FeedbackOwner;
  edit?: (workspace: string) => void;
  /** An edit made while the gates run, after submit captured the candidate. */
  midGate?: (workspace: string) => void;
  /** No conformance probes run, so the submission condition stays unproven: a build. */
  unprobed?: true;
  admitted?: HarnessExperiment;
  refused?: string;
}

export function censusGates(lifetime: VerifierLifetime) {
  const options = { verifierLifetime: lifetime };
  return makeCensusGate({
    expectedTasks: 4,
    ...options,
    probeControls: makeProbeControls(options),
    solvability: makeSolvabilityCensusGate(options),
  });
}

/** One scripted Builder turn: edit the workspace and submit. */
function scriptedBuilderTurn(edit: () => void) {
  const last = { prompt: "", submission: "" };
  const open: BuilderCampaignDeps["open"] = async (tools) =>
    scriptedSession(async ({ prompt }) => {
      last.prompt = prompt;
      edit();
      const submit = required(
        tools.map((tool) => double<AgentTool>(tool)).find((tool) => tool.name === "submit"),
        "campaign submit tool",
      );
      last.submission = JSON.stringify(await submit.execute("submit", {}));
      return { status: "completed", assistantText: "submitted" };
    });
  return { open, last };
}

/** The initial build a row continues from, adopted through the real product path. */
export async function buildAdopted(tool: boolean): Promise<AdoptedProduct> {
  const root = scratchDir("ana-adopted-product-");
  const lifetime = createVerifierLifetime({ root: join(root, "verifier-lifetime") });
  try {
    const buildDir = join(root, "build");
    const built = await runBuilderCampaign(
      { ...FRESH, campaignDir: buildDir },
      {
        tools: [],
        toolsProbes: makeAgentToolsProbes,
        gates: censusGates(lifetime),
        open: scriptedBuilderTurn(() => uppercaseFixture(join(buildDir, "workspace"), false, tool)).open,
      },
    );
    if (!built.buildAdmissible) throw new Error(JSON.stringify(built));
    const adoptedDir = publishProductVersion({
      repoRoot: root,
      slug: "matching",
      id: "adopted",
      acceptedSnapshot: built.acceptedSnapshot,
      fingerprint: built.harness.fingerprint,
      conformancePath: join(built.iterationDir, "conformance.json"),
    });
    return { adoptedDir, harness: built.harness };
  } finally {
    await closeVerifierLifetime(lifetime, "clean");
  }
}

/** The edits a row composes from. */
export const EDITS = {
  /** An edited installed tool: a new verifier condition under the same agent and scoring program. */
  tool: (workspace: string) => writeFileSync(join(workspace, FIXTURE_TOOL), "#!/bin/sh\n# changed\nexit 0\n"),
  /** A singleton-array accept control, which widens the compiled submission schema. */
  schema: (workspace: string) => {
    const path = join(workspace, "correctness-model/controls.json");
    const controls = JSON.parse(readFileSync(path, "utf8"));
    controls.accept[0].artifact.answer = [controls.accept[0].artifact.answer];
    writeFileSync(path, JSON.stringify(controls));
  },
  /** A controls-only correction: the calibration corpus moves, the scoring program does not. */
  controls: (workspace: string) => {
    const path = join(workspace, "correctness-model/controls.json");
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
  },
} as const;

function proposal(scope: IntentRow["scope"]) {
  return {
    scope,
    target: { comparator: "at-least" as const, verifiedPasses: 0 },
    gap: "The prior battery did not test the proposed condition.",
    change: "Change the proposed condition.",
    ...PLAN_FIELDS,
    expectedResult: "All four tasks remain publicly solvable.",
  };
}

function priorEvidence(owner: FeedbackOwner | undefined) {
  const claim = {
    severity: "blocking" as const,
    claim: "Repair the adopted product.",
    evidence: "admitted.json",
  };
  return {
    kind: "admitted-packet" as const,
    digest: "adopted-feedback",
    feedback: owner === undefined ? [] : [{ owner, ...claim }],
  };
}

/** Runs one row over a private copy of the adopted product and checks its outcome. */
export async function checkIntent(shared: AdoptedProduct, row: IntentRow): Promise<void> {
  const root = scratchDir("ana-proposed-experiment-");
  const lifetime = createVerifierLifetime({ root: join(root, "verifier-lifetime") });
  try {
    // A private copy of the adopted product, so a row's edits touch nothing another row reads.
    const adoptedDir = join(root, "adopted");
    cpSync(shared.adoptedDir, adoptedDir, { recursive: true });
    const adoptedGuide = readFileSync(join(adoptedDir, "agent/BUILT_AGENTS.md"), "utf8");
    const campaignDir = join(root, "continuation");
    const workspace = join(campaignDir, "workspace");
    const gates = censusGates(lifetime);
    let gateCalls = 0;
    const session = scriptedBuilderTurn(() => {
      uppercaseFixture(workspace, row.redesign, row.tool);
      row.edit?.(workspace);
      writeFileSync(join(workspace, EXPERIMENT_FILE), JSON.stringify(proposal(row.scope)));
    });
    const outcome = await runBuilderCampaign(
      {
        ...FRESH,
        campaignDir,
        experiment: "build",
        adoptedDir,
        priorEvidence: priorEvidence(row.owner),
      },
      {
        tools: [],
        toolsProbes: row.unprobed ? () => ({}) : makeAgentToolsProbes,
        open: session.open,
        gates: async (...args) => {
          gateCalls++;
          row.midGate?.(workspace);
          return gates(...args);
        },
      },
    );
    // An admission refusal still runs the gates once, so one submit reports every stage.
    expect(gateCalls).toBe(1);
    expect(readFileSync(join(adoptedDir, "agent/BUILT_AGENTS.md"), "utf8")).toBe(adoptedGuide);
    if (row.refused !== undefined) {
      expect(outcome.buildAdmissible).toBe(false);
      expect(session.last.submission).toContain(row.refused);
      return;
    }
    if (!outcome.buildAdmissible) throw new Error(session.last.submission);
    expect(outcome.experimentScope?.actual).toBe(required(row.admitted, "admitted attribution"));
    expect(outcome.iterations[0]?.experimentScope).toEqual(outcome.experimentScope);
    expect(session.last.prompt).toContain("Choose the next useful experiment");
    // Conformance evidence stays beside the iteration, never inside the accepted bytes.
    expect(existsSync(join(outcome.acceptedSnapshot, "conformance.json"))).toBe(false);
    expect(existsSync(join(outcome.iterationDir, "conformance.json"))).toBe(!row.unprobed);
    if (row.unprobed) {
      expect(outcome.experimentScope?.freeze?.clauses).toContainEqual(
        expect.stringContaining("submission-schema-unverifiable"),
      );
    }
    const { sha256 } = outcome.harness.publicArtifactSchema;
    expect(sha256 !== shared.harness.publicArtifactSchema.sha256).toBe(row.edit === EDITS.schema);
    if (row.tool) {
      // The tool edit alone moved the condition: agent and correctness model are the adopted ones.
      expect(fingerprintSlug(workspace)).toMatchObject({
        agentHash: shared.harness.fingerprint.agentHash,
        correctnessModelHash: shared.harness.fingerprint.correctnessModelHash,
      });
    }
    // The accepted snapshot is immutable: a later workspace edit does not reach it.
    const tasks = join(outcome.acceptedSnapshot, "correctness-model/tasks.json");
    const accepted = readFileSync(tasks, "utf8");
    writeFileSync(join(workspace, "correctness-model/tasks.json"), "[]");
    expect(readFileSync(tasks, "utf8")).toBe(accepted);
  } finally {
    await closeVerifierLifetime(lifetime, "clean");
  }
}

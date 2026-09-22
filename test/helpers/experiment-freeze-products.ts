/**
 * The adopted product the experiment-freeze e2e files continue from, and the one scripted intent
 * case they share. The real-submit cases run the campaign's own submit, census and full-task F2
 * over an adopted product. Every case used to build and adopt the same initial product itself,
 * which cost the suite one serial worker for minutes; then one file built both variants once and
 * ran 21 cases four at a time on one worker, and that file alone set the suite's wall (68 s in the
 * Linux VM, 154 s gate). The cases now live in three files, one per product variant, so they spread
 * across workers and each file builds only the variant it needs.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { expect } from "bun:test";
import { double, required, scriptedSession } from "./doubles.ts";
import { uppercaseFixture } from "./uppercase-fixture.ts";
import { cpSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
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
import type { BuiltHarness } from "../../src/author/campaign-types.ts";
import type { HarnessExperiment } from "../../src/critic/types.ts";
import { EXPERIMENT_FILE } from "../../src/author/builder-memory.ts";

export const FRESH = {
  slug: "matching",
  kickoff: "Build a harness.",
  expectedTasks: 4,
  maxTurns: 1,
} as const;

export interface AdoptedProduct {
  adoptedDir: string;
  harness: BuiltHarness;
}

/** Kinds whose continuation redesigns the public battery (new inputs and a new family). */
const REDESIGNED = new Set([
  "tasks",
  "product-tasks",
  "schema-tasks",
  "schema-product",
  "schema-scope-revision",
  "unsolvable",
  "blocked-tasks",
  "blocked-product",
  "tool-relocated",
  "tool-tasks",
  "tool-product",
  "tool-unknown",
  "tool-mid-gate",
]);
/** Kinds whose continuation changes the installed tool's bytes before submit. */
const TOOL_EDITED = new Set(["tool-tasks", "tool-product", "tool-only"]);
const CHANGED_TOOL = "#!/bin/sh\n# changed implementation\nexit 0\n";

/** kind, proposed scope, prior-evidence owner, admitted scope (null: refused), refusal text, gate calls */
type IntentRow = readonly [
  string,
  "tasks" | "product",
  "correctness-model" | "unknown" | null,
  HarnessExperiment | null,
  string | null,
  number,
];

export function censusGates(lifetime: VerifierLifetime) {
  const options = { verifierLifetime: lifetime };
  return makeCensusGate({
    expectedTasks: 4,
    ...options,
    probeControls: makeProbeControls(options),
    solvability: makeSolvabilityCensusGate(options),
  });
}

/** One scripted Builder turn: edit the workspace, submit once, and optionally revise after a
 *  scope-mismatch refusal. The last prompt and submission text are readable by the case. */
export function scriptedBuilderTurn(edit: () => void, revise?: () => void) {
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
      if (revise !== undefined) {
        expect(last.submission).toContain("experiment-scope-mismatch");
        revise();
        last.submission = JSON.stringify(await submit.execute("revised", {}));
      }
      return { status: "completed", assistantText: "submitted" };
    });
  return { open, last };
}

/** The initial build a file's real-submit cases continue from, adopted through the real product
 *  path. Two variants: authored checks alone, and checks that require the fixture tool. */
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

/** A case's own copy of the file's adopted product, so its edits and its unchanged-bytes
 *  assertion touch nothing another case reads. */
export function adoptedCopy(root: string, shared: AdoptedProduct): AdoptedProduct {
  const adoptedDir = join(root, "adopted");
  cpSync(shared.adoptedDir, adoptedDir, { recursive: true });
  return { adoptedDir, harness: shared.harness };
}

/** One continuation over a copy of the adopted product: the proposal is checked through
 *  immutable submit, census and full-task F2, and the outcome against the row. */
export async function checkIntent(
  adopted: AdoptedProduct,
  [kind, scope, owner, actual, refusal, expectedGates]: IntentRow,
): Promise<void> {
  const root = scratchDir("ana-proposed-experiment-");
  const lifetime = createVerifierLifetime({ root: join(root, "verifier-lifetime") });
  try {
    const tool = kind.startsWith("tool-");
    const { adoptedDir, harness: adoptedHarness } = adoptedCopy(root, adopted);
    const original = readFileSync(join(adoptedDir, "agent/BUILT_AGENTS.md"), "utf8");
    if (kind === "tool-unknown") {
      const path = join(adoptedDir, "conformance.json");
      const evidence = JSON.parse(readFileSync(path, "utf8"));
      delete evidence.verifierEnvironmentHash;
      writeFileSync(path, JSON.stringify(evidence));
    }
    const campaignDir = join(root, kind);
    const workspace = join(campaignDir, "workspace");
    const gates = censusGates(lifetime);
    let gateCalls = 0;
    const proposal = {
      scope,
      target: { comparator: "at-least" as const, verifiedPasses: 0 },
      gap: "The prior battery did not test the proposed condition.",
      change: `Change ${kind}.`,
      expectedResult: "All four tasks remain publicly solvable.",
    };
    const session = scriptedBuilderTurn(
      () => {
        uppercaseFixture(workspace, REDESIGNED.has(kind), tool);
        if (TOOL_EDITED.has(kind)) {
          writeFileSync(join(workspace, ".toolchain/bin/uppercase-fixture"), CHANGED_TOOL);
        }
        if (tool) {
          expect(fingerprintSlug(workspace)).toMatchObject({
            agentHash: adoptedHarness.fingerprint.agentHash,
            correctnessModelHash: adoptedHarness.fingerprint.correctnessModelHash,
          });
        }
        writeFileSync(join(workspace, EXPERIMENT_FILE), JSON.stringify(proposal));
        if (kind.startsWith("schema-")) {
          const path = join(workspace, "correctness-model/controls.json");
          const controls = JSON.parse(readFileSync(path, "utf8"));
          controls.accept[0].artifact.answer = [controls.accept[0].artifact.answer];
          writeFileSync(path, JSON.stringify(controls));
          expect(fingerprintSlug(workspace)).toMatchObject({
            agentHash: adoptedHarness.fingerprint.agentHash,
            correctnessModelHash: adoptedHarness.fingerprint.correctnessModelHash,
          });
        }
        if (kind === "agent" || kind === "mismatch") {
          writeFileSync(
            join(workspace, "agent/BUILT_AGENTS.md"),
            original + "\nRead the complete public input.\n",
          );
        }
        if (kind === "controls") {
          const path = join(workspace, "correctness-model/controls.json");
          writeFileSync(path, readFileSync(path, "utf8") + "\n");
        }
        if (kind === "unsolvable") {
          writeFileSync(
            join(workspace, "correctness-model/reference/index.ts"),
            'export function solve(task) { return { answer: task.publicInput.input === "w" ? "wrong" : task.publicInput.input.toUpperCase() }; }',
          );
        }
      },
      kind === "schema-scope-revision"
        ? () =>
            writeFileSync(join(workspace, EXPERIMENT_FILE), JSON.stringify({ ...proposal, scope: "product" }))
        : undefined,
    );
    const outcome = await runBuilderCampaign(
      {
        ...FRESH,
        campaignDir,
        maxTurns: kind === "schema-scope-revision" ? 2 : 1,
        experiment: "build",
        adoptedDir,
        priorEvidence: {
          kind: "admitted-packet",
          digest: "adopted-feedback",
          feedback:
            owner === null
              ? []
              : [
                  {
                    owner,
                    severity: "blocking",
                    claim: "Repair the adopted evaluation.",
                    evidence: "admitted.json",
                  },
                ],
        },
      },
      {
        tools: [],
        toolsProbes: makeAgentToolsProbes,
        open: session.open,
        gates: async (...args) => {
          gateCalls++;
          if (kind === "tool-mid-gate") {
            writeFileSync(
              join(workspace, ".toolchain/bin/uppercase-fixture"),
              "#!/bin/sh\n# changed after capture\nexit 0\n",
            );
          }
          return gates(...args);
        },
      },
    );
    if (outcome.buildAdmissible !== (actual !== null)) throw new Error(`${kind}: ${session.last.submission}`);
    expect(gateCalls).toBe(expectedGates);
    if (refusal !== null) expect(session.last.submission).toContain(refusal);
    if (kind === "unsolvable") {
      expect(
        outcome.iterations
          .flatMap((row) => row.feedback)
          .some((row) => row.claim.includes("1 of 4 authored tasks rejected")),
      ).toBe(true);
    }
    expect(readFileSync(join(adoptedDir, "agent/BUILT_AGENTS.md"), "utf8")).toBe(original);
    if (!outcome.buildAdmissible) return;
    expect(outcome.experimentScope?.actual).toBe(required(actual, "expected admitted scope"));
    if (tool) {
      expect(outcome.harness.publicArtifactSchema.sha256).toBe(adoptedHarness.publicArtifactSchema.sha256);
    }
    if (kind === "schema-product") {
      expect(outcome.harness.publicArtifactSchema.sha256).not.toBe(
        adoptedHarness.publicArtifactSchema.sha256,
      );
    }
    expect(outcome.iterations[0]?.experimentScope).toEqual(outcome.experimentScope);
    // The accepted snapshot is immutable: a later workspace edit does not reach it.
    const accepted = readFileSync(join(outcome.acceptedSnapshot, "correctness-model/tasks.json"), "utf8");
    writeFileSync(join(workspace, "correctness-model/tasks.json"), "[]");
    expect(readFileSync(join(outcome.acceptedSnapshot, "correctness-model/tasks.json"), "utf8")).toBe(
      accepted,
    );
  } finally {
    await closeVerifierLifetime(lifetime, "clean");
  }
}

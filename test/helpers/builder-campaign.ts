/**
 * The scaffolding a campaign test needs before it can assert anything.
 *
 * A campaign test drives the real campaign, files, snapshots and evidence writers with a scripted
 * Builder session, so every one of them needs a workspace, a bundle in it, a session that answers
 * one turn, and a way to reach the submit tool the campaign registered. That is a lot of setup for
 * one assertion, and it used to live inside the single file that used it, which is how two other
 * test files came to rebuild their own.
 *
 * These checks prove routing and recording, not model authoring or solve quality.
 */
import { PLAN_FIELDS } from "./experiment-plan.ts";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { expect } from "bun:test";
import type { AgentToolsProbes } from "../../src/author/agent-tools-session.ts";
import type { CampaignFeedback, FeedbackOwner } from "../../src/author/campaign-types.ts";
import type { PiTool } from "../../src/backends/pi-session.ts";
import { commitAll, initWorkspace } from "../../src/author/domain-repo.ts";
import { hashJsonValue } from "../../src/meta/stable-json.ts";
import { type BuilderCampaignInput, runBuilderCampaign } from "../../src/run/builder-campaign.ts";
import type { VerifierExecutionEvidence, VerifierHostHandle } from "../../src/verify/verifier-port.ts";
import { createVerifierHost } from "../../src/verify/host.ts";
import { createVerifierLifetime } from "../../src/verify/verifier-lifetime.ts";
import { sha256OfFile } from "../../src/meta/digest.ts";
import {
  MATCHING_ACCEPTS,
  MATCHING_OPERATING_GUIDE,
  MATCHING_REJECTS,
  MATCHING_TASKS,
  padToCalibrationFloor,
  writeMatchingSlug,
} from "./matching-fixture.ts";
import { scriptedSession } from "./doubles.ts";
import { scratchDir } from "./scratch.ts";

/** The campaign's submit tool as a fixture drives it. The campaign binds the draft and the record
 *  itself, so submit takes no arguments and answers one text block the fixture serialises. */
export interface FixtureSubmitTool {
  execute(id: string, args: Record<string, string>): Promise<{ content: { type: "text"; text: string }[] }>;
}

/** The fresh-build campaign input every opening test starts from. */
export const FRESH_BUILD = { slug: "matching", kickoff: "Build a harness.", expectedTasks: 4 };

/** truss-w37-sol: `node checker.js contract` in a cell that never held checker.js. */
export const TRUSS_CRASH: VerifierExecutionEvidence = {
  toolId: "truss-contract-checker",
  checkId: "design-contract",
  requestId: "req-33610154",
  runId: null,
  phase: "discrimination",
  subjectId: "accept-span-alternate-topology",
  attempt: 1,
  artifactDigest: "5cbbdef87adf0531696a4225131d0da967decfb3a0ea76dd08a2feae291b4eed",
  publicTaskDigest: "0cf57fce95f369d48c3f70fbff08f263a62e930fa6de131316a4efff95fc825b",
  command: "node",
  args: ["checker.js", "contract"],
  toolDigest: "2407ac26a0df11c5a0dfc879b2c413a93d43fd0a8a1ee530d3f05bcb03906d1d",
  toolSource: "workspace-toolchain",
  toolKind: "script",
  inputPaths: [],
  filesDigest: null,
  stdinDigest: null,
  sandbox: "darwin-seatbelt/v1",
  sandboxPolicyHash: "cce4244c91cf16e4853ac3ad8723d5b4f5c348ca2ade92e2b4a6684d4e7e301f",
  requestDigest: "0e5f5648e973078f2279663f52bc7bf0232c18b09fcfb528926b258f24fb44c9",
  durationMs: 66,
  exitCode: 1,
  signal: null,
  timedOut: false,
  stdoutBytes: 0,
  stderrBytes: 786,
  stderrTail: "Error: Cannot find module '/private/var/folders/.../ana-verifier-iHyS2V/checker.js'",
  outcome: "crash",
};

/** w37-opus: a pre-spawn refusal — no exit status, no stderr, and no recorded reason. The
 *  wall is the environment's, so this kind never reaches the author. */
export const OPUS_SANDBOX: VerifierExecutionEvidence = {
  ...TRUSS_CRASH,
  toolId: "fwcheck",
  checkId: "fw-light-actuation",
  subjectId: "reject-fw-wifi-lamp-fw-sensor-read",
  command: "/opt/zerobrew/prefix/Cellar/node@24/24.13.0/bin/node",
  args: ["checker.js"],
  sandbox: "workdir+env-allowlist",
  sandboxPolicyHash: null,
  durationMs: 0,
  exitCode: null,
  signal: null,
  stderrBytes: 0,
  stderrTail: "",
  outcome: "sandbox",
};
/** A bundle with every part the gate reads except the operating guide. The starter package seeds
 *  agent/BUILT_AGENTS.md, so a guide-less tree needs the deletion a legacy epoch actually carries;
 *  the missing-file refusal path stays exercised. */
export function bundleWithoutGuide(workspace: string): void {
  writeMatchingSlug(workspace);
  rmSync(join(workspace, "agent/BUILT_AGENTS.md"), { force: true });
  writeFileSync(join(workspace, "correctness-model/tasks.json"), JSON.stringify(MATCHING_TASKS));
  writeFileSync(
    join(workspace, "correctness-model/controls.json"),
    JSON.stringify({
      accept: padToCalibrationFloor("accept", MATCHING_ACCEPTS),
      reject: padToCalibrationFloor("reject", MATCHING_REJECTS),
    }),
  );
  writeFileSync(
    join(workspace, "agent/tools-spec.json"),
    JSON.stringify({
      presets: ["shell"],
      tools: [
        { name: "declare_part", kind: "writer", description: "declare one part" },
        { name: "bind_slot", kind: "artifact-writer", description: "bind one part to a slot" },
        { name: "hint", kind: "advisor", description: "inspect public slot conventions" },
      ],
    }),
  );
}

export function completeBundle(workspace: string): void {
  bundleWithoutGuide(workspace);
  writeFileSync(join(workspace, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
}

export function proposeExperiment(
  workspace: string,
  scope: "tasks" | "product" = "product",
  gap = "The previous condition leaves a public capability unmeasured.",
) {
  const proposal = {
    scope,
    target: { comparator: "at-least" as const, verifiedPasses: 0 },
    gap,
    change: "Revise the public harness condition.",
    ...PLAN_FIELDS,
    expectedResult: "The next measurement distinguishes the revised condition.",
  };
  writeFileSync(join(workspace, "EXPERIMENT.json"), JSON.stringify(proposal));
  return { ...proposal, digest: hashJsonValue(proposal) };
}

/** A host over one installed tool the fixture writes itself, so a census test settles on a row the
 *  host measured rather than on an outcome string the test chose. */
export function toolHost(dir: string, script: string): VerifierHostHandle {
  const path = join(dir, "fwcheck");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return createVerifierHost({
    lifetime: createVerifierLifetime({ root: join(dir, "verifier-lifetime") }),
    inventory: {
      fwcheck: {
        id: "fwcheck",
        path,
        digest: sha256OfFile(path),
        source: "host",
        kind: "binary",
        interpreter: null,
      },
    },
  });
}

/** Install one executable under the candidate's own tool tree, where validation resolves the tool
 *  ids the brief's external checks name. The tree sits outside the fingerprint, so what a Builder
 *  installs here is exactly the part of its verifier condition `snapshotId` cannot see. */
export function installTool(workspace: string, id: string, body = "#!/bin/sh\nexit 0\n"): string {
  const bin = join(workspace, ".toolchain", "bin");
  mkdirSync(bin, { recursive: true });
  const path = join(bin, id);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

/** One run of that tool through its own evaluate scope, returning the host's evidence row. */
export async function runOneTool(host: VerifierHostHandle): Promise<VerifierExecutionEvidence> {
  const scope = host.openSubject({
    checks: null,
    runId: null,
    phase: "discrimination",
    subjectId: "protected-subject-id",
    attempt: 1,
    artifact: {},
    publicTask: null,
  });
  try {
    return (await scope.port.run({ toolId: "fwcheck", checkId: "parts-assigned" })).evidence;
  } finally {
    await scope.close();
  }
}

/** Give a repair one accepted-byte-shaped Git boundary without completing an earlier campaign. */
export function commitRoundEntry(workspace: string): void {
  initWorkspace(workspace);
  completeBundle(workspace);
  commitAll(workspace, "fixture: round entry");
}

/** One registered authoring tool, by the name the campaign toolkit gave it. */
export function namedTool(tools: readonly unknown[], name: string): FixtureSubmitTool {
  // SAFETY: every campaign toolkit registers exactly one tool under each of these names; a fixture
  // that stopped seeing one would fail on the call that follows rather than read a wrong tool.
  return tools.find((tool) => (tool as { name?: string }).name === name) as FixtureSubmitTool;
}

export function submitTool(tools: readonly unknown[]): FixtureSubmitTool {
  return namedTool(tools, "submit");
}

/** The whole text a tool call returned to the model. */
export async function replyText(tool: FixtureSubmitTool, id: string): Promise<string> {
  return (await tool.execute(id, {})).content.map((part) => part.text).join("\n");
}

/** A blocking gate row, the shape every refusing gate double returns. */
export function blockingRow(owner: FeedbackOwner, claim: string, evidence = "gate.json"): CampaignFeedback {
  return { owner, severity: "blocking", claim, evidence };
}

/** A session that runs `author` and then submits once per turn, keeping each reply the model read.
 *  The turn count is the reply count, because every turn submits exactly once. */
export function submittingSession(author: (turn: number) => void | Promise<void> = () => {}) {
  const replies: string[] = [];
  const open = async (tools: readonly PiTool[]) =>
    scriptedSession(async () => {
      const turn = replies.length + 1;
      await author(turn);
      replies.push(await replyText(submitTool(tools), `submit-${turn}`));
      return { status: "completed", assistantText: "submitted" };
    });
  return { open, replies };
}

/** One campaign attempt whose session runs `author` once and submits, returning the submit tool's
 *  serialised output. */
export async function submitOnce(
  dir: string,
  author: () => void,
  probes: AgentToolsProbes = {},
): Promise<string> {
  let submitOutput = "";
  await runBuilderCampaign(
    { campaignDir: dir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
    {
      tools: [],
      toolsProbes: () => probes,
      gates: async () => [],
      open: async (tools) =>
        scriptedSession(async () => {
          author();
          submitOutput = JSON.stringify(await submitTool(tools).execute("submit", {}));
          return { status: "completed", assistantText: "submitted" };
        }),
    },
  );
  return submitOutput;
}

/** Move the bundle's second truth check onto an installed tool, reconciling the tasks and controls
 *  with the external declaration so a refusal comes from the post-record verifier gate rather than
 *  from stale intrinsic rows still in the tree. */
export function requireExternalVerifier(workspace: string, adapterId = "field-engine"): void {
  const path = join(workspace, "correctness-model/brief.json");
  const brief = JSON.parse(readFileSync(path, "utf8"));
  brief.truthChecks[1].execution.evidence = { kind: "external", requiredToolIds: [adapterId] };
  writeFileSync(path, JSON.stringify(brief));
  const externalCheckId = brief.truthChecks[1].id;
  const tasksPath = join(workspace, "correctness-model/tasks.json");
  const tasks = JSON.parse(readFileSync(tasksPath, "utf8"));
  for (const task of tasks.tasks ?? tasks) {
    for (const row of task.hidden) {
      if (row.checkId === externalCheckId) row.expectation = { kind: "controller-owned-external-verifier" };
    }
  }
  writeFileSync(tasksPath, JSON.stringify(tasks));
  const controlsPath = join(workspace, "correctness-model/controls.json");
  const controls = JSON.parse(readFileSync(controlsPath, "utf8"));
  for (const control of controls.reject) {
    if (control.expectedCheckId === externalCheckId) Reflect.deleteProperty(control, "hidden");
  }
  writeFileSync(controlsPath, JSON.stringify(controls));
}

/** What the composed campaign hands its first Builder turn. The session stops at that turn, so this
 *  reports what the controller assembled rather than what the Builder did with it. */
export async function openingPrompt(input: Omit<BuilderCampaignInput, "campaignDir">): Promise<string> {
  const dir = scratchDir("ana-opening-prompt-");
  let delivered = "";
  await expect(
    runBuilderCampaign(
      { campaignDir: dir, ...input },
      {
        tools: [],
        toolsProbes: () => ({}),
        // A scripted failed turn is retried on a growing backoff; this test spends none of it.
        waitMs: async () => {},
        open: async () =>
          scriptedSession(async ({ prompt }) => {
            delivered = prompt;
            return { status: "failed", errorMessages: ["stop after prompt proof"] };
          }),
      },
    ),
  ).rejects.toThrow(/stop after prompt proof/);
  return delivered;
}

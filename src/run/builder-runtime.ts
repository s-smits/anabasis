/** One build campaign's live Builder isolation, tools and backend runtime. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import { WORKSPACE_DIR } from "../author/builder-memory.ts";
import { BUILDER_WORKSPACE_CARD } from "../author/builder-start-prompt.ts";
import type { CampaignBuilderCondition } from "../author/campaign-epoch.ts";
import { piBuiltReadAllowRoots, piBuiltSolver, resolvePiBuiltRuntime } from "../backends/pi-built.ts";
import type { PiTool } from "../backends/pi-session.ts";
import type { BackendKind, ResolvedSlots } from "../backends/resolve.ts";
import { openPathRecord } from "../builder/path-record.ts";
import type { BuilderRole } from "../builder/builder-tool-interface.ts";
import {
  type CandidateAccessPolicy,
  deriveCandidateIsolation,
  policyReadGrant,
} from "../builder/candidate-isolation.ts";
import { writeBuilderSessionEvidence } from "../builder/session-evidence.ts";
import { createBuilderTools } from "../builder/tools.ts";
import { createVerifierWorkshopTool, createPublicSourceTool } from "../builder/verifier-workshop-tool.ts";
import { createVerifierWorkshop } from "../builder/verifier-workshop.ts";
import { WORKSHOP_ACTION_FILE } from "../builder/verifier-workshop-evidence.ts";
import { workshopExportBinding } from "../builder/verifier-workshop-export.ts";
import {
  createVmWorkshopRunner,
  scopeVmWorkshopCell,
  vmWorkshopCellFromEnv,
} from "../builder/vm-workshop-cell.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { ANSWER_TOOL_TREE, WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { Solver } from "../correctness-bundle/solve.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { builderSessionOpener, builderShellWall, builderSlot } from "./builder-backend.ts";
import type { runBuilderCampaign } from "./builder-campaign.ts";
import { builtSolveIsolation } from "./built-agent-runtime.ts";
import { assertSupportedHostRuntime } from "./host-runtime-policy.ts";
import { BACKENDS_FILE, backendStartupEvidence, preflightCampaignModels } from "./model-preflight.ts";

/** What one build campaign opens its Builder session with. */
interface BuilderRuntime {
  open: Parameters<typeof runBuilderCampaign>[1]["open"];
  /** Record what each round's session exposes; `open` is the transport alone. */
  recordSession?: Parameters<typeof runBuilderCampaign>[1]["recordSession"];
  tools: PiTool[];
  /** Whether the Builder slot's profile carries public web search, so the start prompt states what
   *  the session actually has. A search tool the Builder was never told about is the same as not
   *  having one: the session spends its rounds without ever reaching for it. */
  webSearch: boolean;
  /** The measured Built solver, for `harness_trial`'s blind rehearsal: the same runtime, turn guard
   *  and confinement a battery case solves under, so a rehearsal measures the battery's own
   *  condition rather than a cheaper stand-in. Absent for a scripted runtime with no Built slot. */
  builtSolver?: (providerBudget?: ProviderResourceBudget) => Solver;
  /** A split build's answer agent: its toolkit, which writes the correctness model and its scratch
   *  and holds the research and workshop tools, and its wall per pass. `tools` above is then the
   *  Harness Builder's. */
  answer?: { tools: PiTool[]; wallMs: number };
}

interface BuilderRuntimeCondition {
  slots: ResolvedSlots;
  builder: CampaignBuilderCondition;
  turnTimeoutMs?: number;
}

/** The one interface between the build step and the Builder session. Production binds
 *  `productionBuilderRuntime`; a test or simulation may bind a scripted session here so the real
 *  submit, census, solvability and adoption path runs with no provider. The CLI exposes no such
 *  backend: `--builder-backend` admits only the three pi transports. */
export type BuilderRuntimeFactory = (
  manifest: AskManifest,
  options: { safeguardContext?: SafeguardContext },
  repoRoot: string,
  campaignDir: string,
  condition: BuilderRuntimeCondition,
) => Promise<BuilderRuntime>;

/** Every backend uses the same policy-enforced filesystem tools, alongside public research and the
 *  correctness-model workshop. The host enforces each call, so a late evidence deny still holds.
 *  A split build mounts the file tools twice, once behind each side of its wall, and gives the
 *  research and the workshop, whose exports land in the correctness model, to the answer agent. */
export function campaignBuilderMount(
  repoRoot: string,
  slug: string,
  campaignDir: string,
  safeguardContext?: SafeguardContext,
  split = false,
) {
  assertSupportedHostRuntime();
  const workspace = join(campaignDir, WORKSPACE_DIR);
  // With the microvm opt-in the workshop cell must live inside the guest's virtiofs share, so the
  // same bytes are host-readable for the workshop's own checks and guest-visible for its commands.
  // The policy binds whichever root is chosen, so the cell's identity follows its real location.
  const configuredVmCell = vmWorkshopCellFromEnv(Bun.env);
  // The provisioned guest mounts the VM's parent share. Give each campaign its own child and
  // have the runner bind only that child into the guest namespace; sibling campaigns and the
  // controller's staging area never become part of this workshop cell.
  const vmCell =
    configuredVmCell === null ? null : scopeVmWorkshopCell(configuredVmCell, repoRoot, slug, campaignDir);
  const ossRoot = vmCell === null ? join(campaignDir, ".oss") : join(vmCell.hostShareRoot, ".oss");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(ossRoot, { recursive: true });
  const binding = {
    repoRoot,
    epochDir: campaignDir,
    iterationDir: workspace,
    ossRoot,
    ...keyIfDefined("sharedCellRoot", vmCell?.hostShareRoot),
  };
  const workshopPolicy = deriveCandidateIsolation(binding, "workshop");
  const authorPolicy = deriveCandidateIsolation(binding, split ? "harness" : "author");
  const exportBinding = workshopExportBinding(workspace, workshopPolicy);
  const record = openPathRecord(campaignDir, "builder-primary");
  const workshop = createVerifierWorkshop({
    root: ossRoot,
    evidencePath: join(campaignDir, WORKSHOP_ACTION_FILE),
    policy: workshopPolicy,
    exportBinding,
    record,
    ...keyIfDefined("runner", vmCell === null ? undefined : createVmWorkshopRunner(vmCell)),
  });
  const custom = [createPublicSourceTool(workshop), createVerifierWorkshopTool(workshop)];
  /** One side's mount: its file tools under its own policy, installing into its own tree, beside
   *  `beside`, and the session evidence it records, each capability against the policy it uses. */
  const sideUnder = (policy: CandidateAccessPolicy, installTree: string, beside: readonly PiTool[]) => {
    const files = createBuilderTools({
      policy,
      record,
      workDir: workspace,
      installTree,
      ...keyIfDefined("safeguardContext", safeguardContext),
    });
    const evidenceInput = {
      epochDir: campaignDir,
      policy,
      capabilityPolicies: {
        public_source: [workshopPolicy],
        verifier_workshop: [workshopPolicy, exportBinding.policy],
        ...Object.fromEntries(files.map(({ name }) => [name, [policy]])),
      },
      record,
      framing: BUILDER_WORKSPACE_CARD,
    };
    return { tools: [...files, ...beside], evidenceInput };
  };
  const author = sideUnder(authorPolicy, WORKSPACE_TOOL_TREE, split ? [] : custom);
  writeBuilderSessionEvidence({
    ...author.evidenceInput,
    role: split ? "harness" : "whole",
    tools: author.tools,
  });
  const answer = split
    ? sideUnder(deriveCandidateIsolation(binding, "answer"), ANSWER_TOOL_TREE, custom)
    : undefined;
  return { ...author, ...keyIfDefined("answer", answer) };
}

/** The production Builder session composition — mount, roster, search capability, trial wall and
 *  session evidence — with no login check or provider contact. `productionBuilderRuntime` adds the
 *  model preflight; a prompt capture replaces `open` here and keeps `recordSession`, so it records
 *  the same condition it stops. */
export function composeBuilderRuntime(
  manifest: AskManifest,
  options: { safeguardContext?: SafeguardContext },
  repoRoot: string,
  campaignDir: string,
  condition: BuilderRuntimeCondition,
): BuilderRuntime & {
  backend: BackendKind;
  trialIsolation: ReturnType<typeof builtSolveIsolation>;
  builtSolver: NonNullable<BuilderRuntime["builtSolver"]>;
} {
  const { slots, builder } = condition;
  const { answerWallMs } = builder;
  const mount = campaignBuilderMount(
    repoRoot,
    manifest.slug,
    campaignDir,
    options.safeguardContext,
    answerWallMs !== undefined,
  );
  const workspace = join(campaignDir, WORKSPACE_DIR);
  const trialIsolation = builtSolveIsolation(repoRoot, piBuiltReadAllowRoots(slots));
  const slot = builderSlot(builder, repoRoot);
  const shellWall = builderShellWall(builder.kind, workspace, policyReadGrant(mount.evidenceInput.policy));
  // Every round records what its session exposes, whether the round opened the session or continued
  // the run's conversation: the registered roster against the declarations the provider receives,
  // and the catalogue of the role it opens in, with that role's own isolation.
  const recordSession = (roster: readonly PiTool[], systemPrompt: string, role: BuilderRole): void => {
    const side = role === "answer" ? mount.answer : mount;
    if (side === undefined) throw new Error("an answer session on a Builder mount with no answer side");
    writeBuilderSessionEvidence({
      ...side.evidenceInput,
      role,
      shellWall,
      tools: roster,
      framing: systemPrompt,
      contract: { backend: builder.kind, backendExposed: roster.map(toToolDeclaration) },
    });
  };
  return {
    backend: builder.kind,
    open: builderSessionOpener(slot, workspace),
    recordSession,
    tools: mount.tools,
    ...keyIfDefined(
      "answer",
      mount.answer === undefined || answerWallMs === undefined
        ? undefined
        : { tools: mount.answer.tools, wallMs: answerWallMs },
    ),
    webSearch: slot.profile.webSearch === true,
    trialIsolation,
    // Resolved lazily: a session that never rehearses opens no Built runtime, and one that does
    // gets the same runtime `productionBuilderRuntime` already preflights below.
    builtSolver: (providerBudget?: ProviderResourceBudget) =>
      piBuiltSolver(resolvePiBuiltRuntime(slots, repoRoot, trialIsolation), {
        maxTurns: undefined,
        observer: undefined,
        observationPhase: undefined,
        providerBudget,
      }),
  };
}

export async function productionBuilderRuntime(
  manifest: AskManifest,
  options: { safeguardContext?: SafeguardContext },
  repoRoot: string,
  campaignDir: string,
  condition: BuilderRuntimeCondition,
): Promise<BuilderRuntime> {
  const { slots, builder } = condition;
  const runtime = composeBuilderRuntime(manifest, options, repoRoot, campaignDir, condition);
  const preflight = await preflightCampaignModels({
    builder,
    review: slots.review,
    repoRoot,
    builtRuntime: resolvePiBuiltRuntime(slots, repoRoot, runtime.trialIsolation),
    phase: "authoring",
  });
  await Bun.write(
    join(campaignDir, BACKENDS_FILE),
    capturedJsonStringify(
      backendStartupEvidence(slots, preflight.hostRuntime, preflight.modelSelections),
      null,
      2,
    ),
  );
  return {
    open: runtime.open,
    recordSession: runtime.recordSession,
    tools: runtime.tools,
    ...keyIfDefined("answer", runtime.answer),
    webSearch: runtime.webSearch,
    builtSolver: runtime.builtSolver,
  };
}

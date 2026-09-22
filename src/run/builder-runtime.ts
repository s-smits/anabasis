/** One build campaign's live Builder isolation, tools and backend runtime. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import { WORKSPACE_DIR } from "../author/builder-memory.ts";
import { BUILDER_WORKSPACE_CARD } from "../author/builder-start-prompt.ts";
import type { CampaignBuilderCondition } from "../author/campaign-epoch.ts";
import type { BackendKind } from "../backends/backend-kinds.ts";
import { piBuiltReadAllowRoots, piBuiltSolver, resolvePiBuiltRuntime } from "../backends/pi-built.ts";
import type { PiTool } from "../backends/pi-session.ts";
import type { ResolvedSlots } from "../backends/resolve.ts";
import { openPathRecord } from "../builder/candidate-isolation-runtime.ts";
import { deriveCandidateIsolation, policyReadGrant } from "../builder/candidate-isolation.ts";
import { createPublicSourceTool } from "../builder/public-source-tool.ts";
import { writeBuilderSessionEvidence } from "../builder/session-evidence.ts";
import { createBuilderTools } from "../builder/tools.ts";
import {
  EMPTY_USER_CONTEXT,
  type PreparedUserContext,
  createUserContextTool,
} from "../builder/user-context.ts";
import { createVerifierWorkshopTool } from "../builder/verifier-workshop-tool.ts";
import { createVerifierWorkshop } from "../builder/verifier-workshop.ts";
import { WORKSHOP_ACTION_FILE } from "../builder/verifier-workshop-evidence.ts";
import { workshopExportBinding } from "../builder/verifier-workshop-export.ts";
import {
  createVmWorkshopRunner,
  scopeVmWorkshopCell,
  vmWorkshopCellFromEnv,
} from "../builder/vm-workshop-cell.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { Solver } from "../truth/solve.ts";
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
   *  the session actually has: runs w28 and w30 spent four sessions with a working search tool
   *  nobody had told the Builder about. */
  webSearch: boolean;
  /** The measured Built solver, for `harness_trial`'s blind rehearsal: the same runtime, turn cap
   *  and confinement a battery case solves under, so a rehearsal measures the battery's own
   *  condition rather than a cheaper stand-in. Absent for a scripted runtime with no Built slot. */
  builtSolver?: (providerBudget?: ProviderResourceBudget) => Solver;
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
  options: { userContext?: PreparedUserContext; safeguardContext?: SafeguardContext },
  repoRoot: string,
  campaignDir: string,
  condition: BuilderRuntimeCondition,
) => Promise<BuilderRuntime>;

/** Every backend uses the same policy-enforced filesystem tools, alongside public research and the
 *  correctness-model workshop. The host enforces each call, so a late evidence deny still holds. */
export function campaignBuilderMount(
  repoRoot: string,
  slug: string,
  campaignDir: string,
  userContext: PreparedUserContext = EMPTY_USER_CONTEXT,
  safeguardContext?: SafeguardContext,
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
    slug,
    epochDir: campaignDir,
    iterationDir: workspace,
    ossRoot,
    ...keysIf(vmCell !== null, () => ({
      sharedCellRoot: /* SAFETY: keysIf runs only when vmCell !== null. */ (
        vmCell as NonNullable<typeof vmCell>
      ).hostShareRoot,
    })),
  };
  const workshopPolicy = deriveCandidateIsolation(binding, "workshop");
  const authorPolicy = deriveCandidateIsolation(binding, "author");
  const exportBinding = workshopExportBinding(workspace, workshopPolicy);
  const record = openPathRecord(campaignDir, "builder-primary");
  const workshop = createVerifierWorkshop({
    root: ossRoot,
    evidencePath: join(campaignDir, WORKSHOP_ACTION_FILE),
    policy: workshopPolicy,
    exportBinding,
    record,
    ...keysIf(vmCell !== null, () => ({
      runner: createVmWorkshopRunner(
        /* SAFETY: keysIf runs only when vmCell !== null. */ vmCell as NonNullable<typeof vmCell>,
      ),
    })),
  });
  const custom = [
    createUserContextTool(userContext),
    createPublicSourceTool(workshop),
    createVerifierWorkshopTool(workshop),
  ];
  const fileTools = createBuilderTools({
    policy: authorPolicy,
    record,
    workDir: workspace,
    ...keyIfDefined("safeguardContext", safeguardContext),
  });
  const tools: PiTool[] = [...fileTools, ...custom];
  const evidenceInput = {
    epochDir: campaignDir,
    policy: authorPolicy,
    capabilityPolicies: {
      public_source: [workshopPolicy],
      verifier_workshop: [workshopPolicy, exportBinding.policy],
      ...Object.fromEntries(fileTools.map(({ name }) => [name, [authorPolicy]])),
    },
    record,
    framing: BUILDER_WORKSPACE_CARD,
  };
  writeBuilderSessionEvidence({ ...evidenceInput, tools });
  return { tools, evidenceInput, authorPolicy };
}

/** The production Builder session composition — mount, roster, search capability, trial wall and
 *  session evidence — with no login check or provider contact. `productionBuilderRuntime` adds the
 *  model preflight; a prompt capture replaces `open` here and keeps `recordSession`, so it records
 *  the same condition it stops. */
export function composeBuilderRuntime(
  manifest: AskManifest,
  options: {
    userContext?: PreparedUserContext;
    safeguardContext?: SafeguardContext;
  },
  repoRoot: string,
  campaignDir: string,
  condition: BuilderRuntimeCondition,
): BuilderRuntime & {
  backend: BackendKind;
  trialIsolation: ReturnType<typeof builtSolveIsolation>;
  builtSolver: NonNullable<BuilderRuntime["builtSolver"]>;
} {
  const { slots, builder } = condition;
  const mount = campaignBuilderMount(
    repoRoot,
    manifest.slug,
    campaignDir,
    options.userContext,
    options.safeguardContext,
  );
  const workspace = join(campaignDir, WORKSPACE_DIR);
  const trialIsolation = builtSolveIsolation(repoRoot, piBuiltReadAllowRoots(slots));
  const slot = builderSlot(builder, repoRoot);
  const shellWall = builderShellWall(builder.kind, workspace, policyReadGrant(mount.authorPolicy));
  // Every round records what its session exposes, whether the round opened the session or continued
  // the run's conversation: the registered roster against the declarations the provider receives.
  const recordSession = (roster: readonly PiTool[], systemPrompt: string): void => {
    writeBuilderSessionEvidence({
      ...mount.evidenceInput,
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
  options: {
    userContext?: PreparedUserContext;
    safeguardContext?: SafeguardContext;
  },
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
    webSearch: runtime.webSearch,
    builtSolver: runtime.builtSolver,
  };
}

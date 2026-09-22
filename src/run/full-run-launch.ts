/**
 * The deterministic full-run launch contract:
 *
 * argv → narrowed arguments → run/source assertions → immutable user input
 *      → registry transaction → project identity → campaign lock
 *
 * Assertions happen before the first controller write. A short global lock protects the shared
 * project registry transaction; a separate project lock stays held for the run. Full-run receives
 * one admitted value and cannot reorder these steps around provider work.
 *
 * The three things this sequence calls are owned elsewhere, because none of them reads another's
 * state: `launch-arguments.ts` narrows argv, `launch-project.ts` derives the campaign tree and
 * `campaign-lock.ts` decides who may write to it.
 */

import { type PreparedUserContext, prepareUserContext } from "../builder/user-context.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { lstatSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { assertExternalPathSegment } from "../meta/path-segment.ts";
import { errorCode } from "../meta/runtime-values.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { setTurnBudget } from "./campaign-budget.ts";
import { acquireCampaignLock, acquireRegistryLock } from "./campaign-lock.ts";
import { resolveLaunchRunId } from "./controller-lineage.ts";
import { directManifest } from "./direct-input.ts";
import { assertSupportedHostRuntime } from "./host-runtime-policy.ts";
import type { FullRunArgs } from "./launch-arguments.ts";
import { type ProjectIdentity, selectProject } from "./launch-project.ts";
import { recordProjectRequest } from "./project-registry.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";

export interface FullRunInput {
  prompt: string;
  userContext: PreparedUserContext;
  project: ProjectIdentity;
  manifest: AskManifest;
}

export interface FullRunLaunch extends FullRunInput {
  runId: string;
  campaignLockToken: string;
  ownsLock(): boolean;
  release(): boolean;
}

/** A run may name the exact clean source it expects to be measured on. A dirty or different tree
 *  is a changed condition, so it refuses here rather than recording the intended identity. */
function assertLaunchExpectations(args: FullRunArgs): void {
  if (args.runId !== undefined) assertExternalPathSegment("runId", args.runId);
  if (args.expectedSource === undefined) return;
  const actual = SOURCE_IDENTITY;
  if (
    actual !== null &&
    !actual.dirty &&
    actual.commit === args.expectedSource.commit &&
    actual.sourceDigest === args.expectedSource.sourceDigest
  ) {
    return;
  }
  const observed =
    actual === null
      ? "unattributed"
      : `${actual.commit}:${actual.sourceDigest}${actual.dirty ? " (dirty)" : ""}`;
  throw new Error(
    `launch source mismatch — expected clean ${args.expectedSource.commit}:${args.expectedSource.sourceDigest}, observed ${observed}`,
  );
}

/** A run must own its dependencies: a linked `node_modules` can resolve `@ana` into another
 *  tree's source, which would measure bytes the opening never names. */
function assertOwnDependencies(repoRoot: string): void {
  try {
    if (lstatSync(join(repoRoot, "node_modules")).isSymbolicLink()) {
      throw new Error(
        `node_modules is a symlink — a run must own its dependencies; run scripts/worktree.sh setup ${repoRoot} from a prepared checkout`,
      );
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/** The registry transaction: resolve the project again under the lock, take the campaign, apply
 *  the operator's budget and record the request. All of it is durable before the first controller
 *  opening reads it. */
function openUnderRegistryLock(
  args: FullRunArgs,
  repoRoot: string,
  prompt: string,
  userContext: PreparedUserContext,
): FullRunLaunch {
  const project = selectProject(repoRoot, prompt, userContext.digest, args.project);
  const campaignLock = acquireCampaignLock(repoRoot, project.id);
  try {
    const requested = args.runId ?? `fullrun-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    // The campaign lock is the authority boundary for the epoch-spanning spend row. Apply the
    // operator's cap before returning, so the first opening observes the same durable state even
    // when its first move is measure or stop and therefore never reaches buildHarness.
    if (args.turnBudget !== undefined) setTurnBudget(campaignDir(repoRoot, project.id), args.turnBudget);
    recordProjectRequest(repoRoot, project.id, project.requestDigest);
    return {
      prompt,
      userContext,
      project,
      runId: resolveLaunchRunId(repoRoot, project.id, requested),
      manifest: directManifest(project.id),
      campaignLockToken: campaignLock.token,
      ownsLock: campaignLock.owns,
      // One release path frees both the campaign lock and the context's staging root.
      release: () => {
        const freed = campaignLock.release();
        userContext.dispose();
        return freed;
      },
    };
  } catch (error) {
    campaignLock.release();
    throw error;
  }
}

/** Prepare the launch in order. The run controller receives the resulting checked input; any
 *  failure after preparation removes the staged corpus, since only a returned launch keeps it. */
export function openFullRunLaunch(args: FullRunArgs, repoRoot: string): FullRunLaunch {
  assertSupportedHostRuntime();
  assertOwnDependencies(repoRoot);
  assertLaunchExpectations(args);
  const prompt = args.prompt ?? "";
  if (prompt.trim() === "") throw new Error("fullRun requires a non-empty direct prompt");
  const userContext = prepareUserContext(repoRoot, args.contextPaths ?? []);
  try {
    // Detect a damaged registry before the first controller write, then resolve again inside the
    // short shared transaction so concurrent projects cannot write from stale snapshots.
    selectProject(repoRoot, prompt, userContext.digest, args.project);
    const releaseRegistry = acquireRegistryLock(repoRoot);
    try {
      return openUnderRegistryLock(args, repoRoot, prompt, userContext);
    } finally {
      releaseRegistry.release();
    }
  } catch (cause) {
    userContext.dispose();
    throw cause;
  }
}

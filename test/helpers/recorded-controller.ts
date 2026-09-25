import { mkdirSync } from "../../src/meta/filesystem.ts";
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { join } from "../../src/meta/path.ts";
import { hashJsonValue } from "../../src/meta/stable-json.ts";
import { writeCompleted } from "../../src/meta/completed-json.ts";
import { campaignDir } from "../../src/meta/campaign-root.ts";
import { selectCampaignEpoch } from "../../src/author/campaign-epoch.ts";
import { loadBudget } from "../../src/run/controller-ledger.ts";
import { hostRuntimeIdentity } from "../../src/run/host-runtime-policy.ts";
import { SOURCE_IDENTITY } from "../../src/run/source-identity.ts";
import { ControllerSignalAbort } from "../../src/run/controller-abort-clause.ts";
import { controllerIterationRunId } from "../../src/run/controller-battery-record-policy.ts";
import {
  CAMPAIGN_OPENING_SCHEMA,
  prepareControllerTerminal,
  writeControllerTerminal,
} from "../../src/run/controller-evidence.ts";
import { ProviderResourceBudget } from "../../src/run/provider-resource-budget.ts";

/**
 * One campaign whose controller opening and terminal were produced the way a run produces them.
 * The terminal comes from its only writer. The opening's writer is private, so the assembly is
 * repeated here from the same producers it uses, never from values typed out beside them.
 *
 * `bindBattery` adds a second round that measured one battery under its own run id, which is the
 * only battery a round may bind. That battery has no case rows and so no record either, which the
 * strict reader admits only on a signal-terminated final round, so binding one records the run as
 * ended by a signal.
 *
 * `providerTurns` spends that many completed turns per role on a real provider budget, whose
 * opening and terminal snapshots the two records then carry; `builtModel` is the Built slot's
 * pinned model, and `absentSteps` the steps the terminal records as not completed.
 */
export function recordedController(input: {
  repo: string;
  projectId: string;
  runId: string;
  openedAt: string;
  bindBattery?: boolean;
  ownedAtRecord?: boolean;
  providerTurns?: { builder: number; built: number; review: number };
  builtModel?: string;
  absentSteps?: string[];
}) {
  const source = SOURCE_IDENTITY;
  if (source === null) throw new Error("recorded controller evidence needs a source identity");
  const campaign = campaignDir(input.repo, input.projectId);
  const epoch = selectCampaignEpoch(campaign, { kickoff: `one line for ${input.projectId}` });
  const controllerDir = join(campaign, "controller", input.runId);
  mkdirSync(controllerDir, { recursive: true });
  const turns = input.providerTurns;
  const providerBudget =
    turns === undefined
      ? undefined
      : new ProviderResourceBudget(turns.builder + turns.built + turns.review + 1);
  const slot = (model: string) => ({ kind: "claude", model, source: "operator", reasoningEffort: "medium" });
  const opening = {
    schema: CAMPAIGN_OPENING_SCHEMA,
    writtenAt: input.openedAt,
    runtime: hostRuntimeIdentity(),
    source,
    project: { id: input.projectId, requestDigest: "0".repeat(64) },
    runId: input.runId,
    continuation: null,
    abandonedRuns: [],
    epoch: { key: epoch.key, supersedes: epoch.supersedes },
    modelSlots: {
      builder: slot("fixture"),
      built: slot(input.builtModel ?? "fixture"),
      review: { enabled: true, ...slot("fixture") },
    },
    budget: loadBudget(campaign),
    providerResourceBudget: providerBudget?.snapshot() ?? null,
    command: { name: "fullrun", digest: hashJsonValue({ prompt: null }) },
  };
  writeCompleted(join(controllerDir, "opening.json"), opening);
  for (const role of ["builder", "built", "review"] as const) {
    for (let turn = 0; turn < (turns?.[role] ?? 0); turn += 1) {
      providerBudget?.reserve(role).complete(undefined);
    }
  }
  const round = (ordinal: number, battery: boolean) => {
    const runId = controllerIterationRunId(input.runId, ordinal);
    return {
      runId,
      terminal: "completed",
      buildClause: null,
      buildDetail: null,
      measured: battery,
    };
  };
  const iterations = input.bindBattery === true ? [round(1, false), round(2, true)] : [round(1, false)];
  const prepared = prepareControllerTerminal({
    repoRoot: input.repo,
    projectId: input.projectId,
    opening: { digest: hashJsonValue(opening), epoch, runId: input.runId },
    iterations,
    absentSteps: input.absentSteps ?? [],
    ...keyIfDefined("providerBudget", providerBudget),
    failure: input.bindBattery === true ? new ControllerSignalAbort("SIGTERM") : null,
  });
  writeControllerTerminal(prepared, {
    token: `lock-${input.runId}`,
    ownedAtRecord: input.ownedAtRecord ?? true,
  });
  return {
    campaign,
    controllerDir,
    openingDigest: hashJsonValue(opening),
    batteryRunId: input.bindBattery === true ? (iterations.at(-1)?.runId ?? null) : null,
  };
}

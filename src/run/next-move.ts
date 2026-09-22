/** Code admits the next bounded round; the existing Builder chooses its experiment.
 * Difficulty statistics remain evidence, not commands to climb, broaden or discard a product. */
import { existsSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join, relative } from "../meta/path.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import { type CampaignBindingInput, latestCampaignEpochForBinding } from "../author/campaign-epoch.ts";
import { latestPreAdoptionFeedback } from "../author/campaign-memory.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { AdmissionLineage, CampaignFeedback, PriorEvidence } from "../author/campaign-types.ts";
import { readAdmission } from "./admission.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { claimsDirFor } from "./claim-write.ts";
import { type ClimbReadout, allowanceStop, readClimbReadout } from "./climb-readout.ts";

export interface NextMove {
  /** `rebuild` is the retained round name for adopted-product authoring, not an order to redesign. */
  move: "build" | "measure" | "rebuild" | "stop";
  reason: string;
  seed?: "adopted" | "starter";
  /** One measured condition opens one resumable pass; prose changes cannot reset its allowance. */
  reopenKey?: string;
}

export const MEASURE_FOR_FEEDBACK_REASON =
  "no saved measurement has feedback; measure the current harness to produce it";

interface SelectedNextMove {
  prior: PriorEvidence | null;
  lineage: AdmissionLineage | null;
  /** Recorded statistical observations, never authority to choose the proposed experiment. */
  readout: ClimbReadout | null;
  decision: NextMove;
  kickoff: string;
}

/** The pass a reopening round binds its epoch on: the measured evidence identity, or the
 * selector's reason when no measurement keyed it. A fresh build carries none. The
 * opening and the build step read this one value, so the epoch the opening records is the epoch
 * the authoring session writes into (the 13 September seeded continuation recorded an empty
 * opening epoch beside the working one because only the build step carried the pass). */
export function epochPassOf(decision: NextMove): string | undefined {
  if (decision.seed === undefined) return undefined;
  return decision.reopenKey ?? decision.reason;
}

/** A measured blocker remains authoritative. Otherwise an exact-epoch pre-adoption blocker
 * outranks measured advisory prose. Neither packet chooses the domain strategy. */
function selectDecisionEvidence(
  measured: CampaignFeedback[] | null,
  preAdoption: CampaignFeedback[] | null,
): CampaignFeedback[] | null {
  if (measured?.some((row) => row.severity === "blocking") === true) return measured;
  if (preAdoption?.some((row) => row.severity === "blocking") === true) return preAdoption;
  return measured;
}

/** Build when no adopted product exists; measure a condition that has not been measured.
 * Thereafter the Builder chooses a hypothesis and a permitted scope from the actual evidence.
 * A host/environment blocker still stops before another authoring or measurement spend. */
export function decideNextMove(
  product: "adopted" | "none",
  feedback: CampaignFeedback[] | null,
  readout: ClimbReadout | null = null,
  preAdoption = false,
): NextMove {
  if (product === "none") {
    return { move: "build", reason: "no adopted domain harness; build one from the original request" };
  }
  const blocking = [
    ...new Set((feedback ?? []).filter((row) => row.severity === "blocking").map((row) => row.owner)),
  ].sort();
  if (blocking.includes("environment")) {
    return {
      move: "stop",
      reason: `blocking feedback includes environment outside the product (${blocking.join(", ")}); authoring cannot clear the complete packet`,
    };
  }
  // The allowance counts rounds that ended off the aim or with a refused claim; the Builder still
  // chooses what to change while it runs, and spending it ends the campaign rather than holding
  // anything fixed.
  const stop = allowanceStop(readout);
  if (stop !== null) return { move: "stop", reason: stop };
  // A same-condition battery that created no claim was still an attempt at this condition, so the
  // round has been observed; an identity or comparability refusal says nothing about it.
  const observed = (readout?.admitted ?? 0) > 0 || (readout?.excluded ?? []).some((row) => row.claimRefused);
  if (!observed && (feedback === null || feedback.length === 0)) {
    return { move: "measure", reason: MEASURE_FOR_FEEDBACK_REASON };
  }
  const reason = [
    preAdoption
      ? "pre-adoption continuation: finish or revise the in-flight proposal"
      : "the measured condition is ready for the Builder's next experiment",
    "start from the adopted product; choose task redesign or product repair, state what would support or contradict it, and submit the corresponding bytes",
    // Named, not required: admission refuses an unrepaired product only under --product-policy
    // fixed (src/gate/experiment-admission.ts, `experiment-product-repair-required`). An open
    // campaign admits a candidate that leaves these owners alone, so promising otherwise here
    // tells the Builder its own experiment will be refused when it will not.
    blocking.length === 0 ? null : `blocking feedback stands against ${blocking.join(", ")}`,
  ]
    .filter((part) => part !== null)
    .join("; ");
  return { move: "rebuild", seed: "adopted", reason };
}

/** A changed evidence basis opens a successor pass. Re-entry into the same basis reads its
 * unfinished attempt and preserves the draft; the public request is never a curriculum command. */
export function selectNextMoveFromDisk(input: {
  repoRoot: string;
  manifest: AskManifest;
  baseKickoff: string;
  runPin: string;
  runId: string;
  domainDir: string;
  builder: NonNullable<CampaignBindingInput["builder"]>;
}): SelectedNextMove {
  const { repoRoot, manifest, baseKickoff, runPin, domainDir, builder } = input;
  const { priorEvidence: measured, lineage } = readAdmission(repoRoot, manifest.slug);
  const readout = readClimbReadout(
    domainDir,
    runPin,
    claimsDirFor(repoRoot, manifest.slug),
    join(repoRoot, FROZEN_MANIFEST_PATH),
  );
  const binding = { kickoff: baseKickoff, builder };
  const campaignRoot = campaignDir(repoRoot, manifest.slug);
  // selectedProductDir names an immutable version. Its identity also changes when an otherwise
  // identical measurement is followed by an agent-only repair.
  const pass = `experiment:${hashJsonValue({ adoptedProduct: relative(campaignRoot, domainDir), admission: measured?.digest ?? null, readout })}`;
  const epoch = latestCampaignEpochForBinding(campaignRoot, { ...binding, pass });
  const preAdoption = epoch === null ? null : latestPreAdoptionFeedback(epoch);
  const selected = selectDecisionEvidence(measured?.feedback ?? null, preAdoption);
  const selectedPreAdoption = selected !== null && selected === preAdoption;
  const decided = decideNextMove(
    existsSync(domainDir) ? "adopted" : "none",
    selected,
    readout,
    selectedPreAdoption,
  );
  return {
    prior: selectedPreAdoption ? null : measured,
    lineage,
    readout,
    decision: decided.move === "rebuild" ? { ...decided, reopenKey: pass } : decided,
    kickoff: baseKickoff,
  };
}

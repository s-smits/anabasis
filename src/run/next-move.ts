/** Code admits the next bounded round; the existing Builder chooses its experiment.
 * Difficulty statistics remain evidence, not commands to climb, broaden or discard a product. */
import { existsSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { relative } from "../meta/path.ts";
import { type CampaignBindingInput, latestCampaignEpochForBinding } from "../author/campaign-epoch.ts";
import { latestPreAdoptionFeedback } from "../author/campaign-memory.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { AdmissionLineage, CampaignFeedback, PriorEvidence } from "../author/campaign-types.ts";
import { readAdmission } from "./admission.ts";
import type { AskManifest } from "./ask-manifest.ts";
import { type ClimbReadout, readClimbReadout } from "./climb-readout.ts";
import { type Remeasure, censoredRemeasure } from "./battery-reuse.ts";
import { isString } from "../meta/json-shape.ts";
import type { SlotChoice } from "../backends/resolve.ts";
import { endsSession } from "../gate/settlement.ts";

export interface NextMove {
  /** `rebuild` is the retained round name for adopted-product authoring, not an order to redesign. */
  move: "build" | "measure" | "rebuild" | "stop";
  reason: string;
  /** One measured condition opens one resumable pass; prose changes cannot reset its allowance. */
  reopenKey?: string;
}

interface SelectedNextMove {
  prior: PriorEvidence | null;
  lineage: AdmissionLineage | null;
  /** Recorded statistical observations, never authority to choose the proposed experiment. */
  readout: ClimbReadout | null;
  decision: NextMove;
  kickoff: string;
}

/** The pass a reopening round binds its epoch on: the measured evidence identity, or the
 * selector's reason when no measurement keyed it. A fresh build carries none. The opening and the
 * build step read this one value, so the epoch the opening records is the epoch the authoring
 * session writes into. Carry the pass in the build step alone and a seeded continuation records an
 * empty opening epoch beside the working one. */
export function epochPassOf(decision: NextMove): string | undefined {
  if (decision.move !== "rebuild") return undefined;
  return decision.reopenKey ?? decision.reason;
}

/** Build when no adopted product exists; measure a condition that has not been measured.
 * Thereafter the Builder chooses a hypothesis and a permitted scope from the actual evidence.
 * A host/environment blocker still stops before another authoring or measurement spend, unless all
 * it reports is reference solves the host cut short (`endsSession`), which the next round submits again. A battery
 * the environment cut short is measured again on unchanged bytes before any rebuild, because the
 * Builder would otherwise author against cases nothing measured. */
export function decideNextMove(
  product: "adopted" | "none",
  feedback: CampaignFeedback[] | null,
  readout: ClimbReadout | null = null,
  preAdoption = false,
  remeasure: Remeasure | null = null,
): NextMove {
  if (product === "none") {
    return { move: "build", reason: "no adopted domain harness; build one from the original request" };
  }
  const blocking = [
    ...new Set((feedback ?? []).filter((row) => row.severity === "blocking").map((row) => row.owner)),
  ].sort();
  if ((feedback ?? []).some(endsSession)) {
    return {
      move: "stop",
      reason: `blocking feedback includes environment outside the product (${blocking.join(", ")}); authoring cannot clear the complete packet`,
    };
  }
  // A same-condition battery that created no claim was still an attempt at this condition, so the
  // round has been observed; an identity or comparability refusal says nothing about it.
  const observed = (readout?.admitted ?? 0) > 0 || (readout?.excluded ?? []).some((row) => row.claimRefused);
  if (!observed && (feedback === null || feedback.length === 0)) {
    return {
      move: "measure",
      reason: "no saved measurement has feedback; measure the current harness to produce it",
    };
  }
  if (!preAdoption && blocking.length === 0 && remeasure !== null) {
    return {
      move: "measure",
      reason: `${remeasure.taskIds.length} case(s) of battery ${remeasure.of} ended in environment-owned non-results; rerun them without changing the harness and regrade the rest`,
    };
  }
  const reason = [
    preAdoption
      ? "pre-adoption continuation: finish or revise the in-flight proposal"
      : "the measured condition is ready for the Builder's next experiment",
    "start from the adopted product; choose task redesign or product repair, and submit the corresponding bytes",
    // Named, not required: an open campaign admits a candidate that leaves these owners alone, so
    // promising otherwise here tells the Builder its own experiment will be refused when it will not.
    blocking.length === 0 ? null : `blocking feedback stands against ${blocking.join(", ")}`,
  ]
    .filter((part) => part !== null)
    .join("; ");
  return { move: "rebuild", reason };
}

/** A changed evidence basis opens a successor pass. Re-entry into the same basis reads its
 * unfinished attempt and preserves the draft; the public request is never a curriculum command.
 * A measured blocker outranks everything; otherwise an exact-epoch pre-adoption blocker outranks
 * measured advisory prose. Neither packet chooses the domain strategy. */
export function selectNextMoveFromDisk(input: {
  repoRoot: string;
  manifest: AskManifest;
  baseKickoff: string;
  runPin: string;
  domainDir: string;
  builder: NonNullable<CampaignBindingInput["builder"]>;
  /** This run's Built slot, which a remeasure's re-solved cases would run under. */
  built: Pick<SlotChoice, "reasoningEffort" | "withholdInstruments">;
}): SelectedNextMove {
  const { repoRoot, manifest, baseKickoff, runPin, domainDir, builder, built } = input;
  const { priorEvidence: measured, lineage } = readAdmission(repoRoot, manifest.slug);
  const readout = readClimbReadout(domainDir, runPin, { repoRoot, slug: manifest.slug });
  const campaignRoot = campaignDir(repoRoot, manifest.slug);
  // selectedProductDir names an immutable version. Its identity also changes when an otherwise
  // identical measurement is followed by an agent-only repair.
  const pass = `experiment:${hashJsonValue({ adoptedProduct: relative(campaignRoot, domainDir), admission: measured?.digest ?? null, readout })}`;
  const epoch = latestCampaignEpochForBinding(campaignRoot, { kickoff: baseKickoff, builder, pass });
  const preAdoption = epoch === null ? null : latestPreAdoptionFeedback(epoch);
  const blocks = (rows: CampaignFeedback[] | null) =>
    rows?.some((row) => row.severity === "blocking") === true;
  const fromPreAdoption = !blocks(measured?.feedback ?? null) && blocks(preAdoption);
  const adopted = existsSync(domainDir);
  const remeasure = adopted
    ? censoredRemeasure({ repoRoot, slug: manifest.slug, runPin, built, candidateDir: domainDir }, readout)
    : "no adopted product";
  const decided = decideNextMove(
    adopted ? "adopted" : "none",
    fromPreAdoption ? preAdoption : (measured?.feedback ?? null),
    readout,
    fromPreAdoption,
    isString(remeasure) ? null : remeasure,
  );
  return {
    prior: fromPreAdoption ? null : measured,
    lineage,
    readout,
    decision: decided.move === "rebuild" ? { ...decided, reopenKey: pass } : decided,
    kickoff: baseKickoff,
  };
}

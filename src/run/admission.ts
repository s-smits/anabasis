/** The campaign row that carries one admission packet from iteration N's analysis to iteration
 *  N+1's build: preparing it, publishing it into the campaign that prepared it, reading it back
 *  for the adopted tree, and recording an attempt against it. `admission-packet.ts` owns every
 *  decision about the packet's own bytes; this file owns the ledger and the campaign binding. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { type AdmittedEvidence, FEEDBACK_POLICY } from "../analyse/iteration-analysis.ts";
import type { AdmissionLineage, CampaignFeedback, PriorEvidence } from "../author/campaign-types.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { join, normalize } from "../meta/path.ts";
import { hashJsonValue, requireJsonValue } from "../meta/stable-json.ts";
import {
  attemptsConsumed,
  movedIdentity,
  parseAdmission,
  type PersistedAdmission,
} from "./admission-packet.ts";
import { type EvaluationIdentity, evaluationIdentity } from "../claim/fingerprint.ts";
import { ControllerLedger, controllerLedgerExists } from "./controller-ledger.ts";
import { selectedProductDir } from "./product-versions.ts";

export interface AdmissionPointer {
  path: string;
  payload: JsonValue;
  digest: string;
}

/** Feedback for the next build and the recorded reason when a packet supplies none. Both come
 *  from one read, so "no packet" stays distinct from "a packet with nothing to route". */
type AdmissionRead = {
  priorEvidence: PriorEvidence | null;
  lineage: AdmissionLineage | null;
};

const NOTHING: AdmissionRead = { priorEvidence: null, lineage: null };

/** The historical logical path. A prepared packet commits with product selection in SQLite; this
 *  path binds it to its campaign and is not a second writable admission authority. */
function admissionFile(repoRoot: string, slug: string): string {
  return join(campaignDir(repoRoot, slug), "analysis", "latest-admission.json");
}

export function prepareAdmissionPointer(
  repoRoot: string,
  slug: string,
  runId: string,
  admission: AdmittedEvidence,
  observedEvaluation: EvaluationIdentity,
): AdmissionPointer {
  const file = admissionFile(repoRoot, slug);
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  const previous = ledger.readAdmission();
  // Read for the refusal alone: replacing bytes nobody can parse loses whatever they recorded.
  if (previous !== null) parseAdmission(previous, file, "cannot replace admission evidence");
  // Record the scoring program and battery that produced these findings. A held evaluation
  // candidate can have a saved packet without being adopted, so the reader must compare that
  // identity with the selected product before using the findings as feedback. The payload's
  // runId already identifies the run and does not need to be repeated inside the condition.
  // Null in either identity field means it could not be recorded. This field records provenance
  // alongside the admitted
  // evidence rather than changing the admission's own digest, which identifies the feedback
  // used by stall counting and repair settlement. The outer packet digest includes both.
  const payload = requireJsonValue({
    runId,
    policy: FEEDBACK_POLICY,
    schema: "repair-agenda/v1",
    attempts: [],
    ...admission,
    observedEvaluation,
  });
  return { path: file, payload, digest: hashJsonValue(payload) };
}

/** Publish one already-planned pointer into the campaign the caller names. The root is the
 *  caller's own fact: deriving it from the path being checked made the binding compare a value
 *  with itself, so a packet prepared for one campaign published into another. */
export function publishAdmissionPointer(pointer: AdmissionPointer, root: string): void {
  const payload = admissionPointerPayload(pointer, root);
  using ledger = ControllerLedger.open(root);
  ledger.writeAdmission(payload);
}

/** Both standalone feedback and product selection consume the same campaign-bound bytes. The two
 *  halves refuse separately: one sentence covering both is how a campaign binding that had stopped
 *  comparing anything went unnoticed. */
export function admissionPointerPayload(pointer: AdmissionPointer, root: string): string {
  const expected = join(root, "analysis", "latest-admission.json");
  if (normalize(pointer.path) !== normalize(expected)) {
    throw new Error(
      `admission packet is not bound to this campaign: prepared for ${pointer.path}, publishing into ${expected}`,
    );
  }
  if (hashJsonValue(pointer.payload) !== pointer.digest) {
    throw new Error("admission packet is not bound to its prepared digest");
  }
  return capturedJsonStringify(pointer.payload);
}

/** The packet's pending rows for the adopted tree, or `null` when recorded identities establish
 *  that it came from another evaluation.
 *
 *  Publication does not imply adoption: a held evaluation candidate publishes a packet measured
 *  on a tree that was never installed. Which cases failed, which traces were diagnosed and
 *  whether a failure is agent-owned are all decisions of that evaluator and its controls corpus,
 *  so a packet from another evaluation states nothing here — not even about an agent-scoped
 *  owner, whose finding a faulty evaluator could produce. Retain the packet as history: its
 *  digest and rows stay recorded, but it supplies no repair feedback.
 *
 *  The match is all-or-nothing on identity. Filtering by owner scope was the earlier rule and is
 *  removed: it kept exactly the rows whose labels the moved evaluator produced. An identity
 *  missing from either side retains its feedback — excluding one requires a recorded mismatch. */
function feedbackForAdoptedTree(
  repoRoot: string,
  slug: string,
  admission: PersistedAdmission,
): CampaignFeedback[] | null {
  const observed = admission.observedEvaluation;
  const adopted = evaluationIdentity(selectedProductDir(repoRoot, slug));
  const moved = movedIdentity(observed, adopted);
  if (moved === null) return admission.feedback;
  console.error(
    `[admission] campaigns/${slug}/analysis/latest-admission.json: observed under ${moved} ${observed[moved] ?? "none"}, adopted is ${adopted[moved] ?? "none"} — reading it as lineage, not feedback; its findings were labelled by an evaluation this tree does not have`,
  );
  return null;
}

function held(digest: string, reason: AdmissionLineage["reason"]): AdmissionRead {
  return { priorEvidence: null, lineage: { digest, reason } };
}

function admissionPayload(root: string): string | null {
  if (!controllerLedgerExists(root)) return null;
  using ledger = ControllerLedger.open(root);
  return ledger.readAdmission();
}

/** The persisted admission for a slug — how iteration N's analysed evidence enters iteration
 *  N+1's build without a scheduler. An unreadable packet is refused here, naming its logical
 *  path, instead of surfacing mid-build. */
export function readAdmission(repoRoot: string, slug: string): AdmissionRead {
  const payload = admissionPayload(campaignDir(repoRoot, slug));
  if (payload === null) return NOTHING;
  const file = admissionFile(repoRoot, slug);
  const admission = parseAdmission(
    payload,
    file,
    "a corrupt evidence packet must not silently seed or skip a build; repair or delete it",
  );
  // A packet from another routing policy cannot supply current feedback, since its owners and
  // severities follow a different rule. Disclosed by name, never a throw: the next run's own
  // analysis writes a fresh packet.
  if (admission.policy !== FEEDBACK_POLICY) {
    console.error(
      `[admission] ${file}: created under feedback policy "${admission.policy ?? "none"}", current is "${FEEDBACK_POLICY}" — reading it as no evidence packet; this run decides from measured history instead`,
    );
    return NOTHING;
  }
  const feedback = feedbackForAdoptedTree(repoRoot, slug, admission);
  if (feedback === null) return held(admission.digest, "evaluation-identity-unadopted");
  if (admission.feedback.length === 0) return held(admission.digest, "no-feedback");
  if (feedback.length === 0 || attemptsConsumed(admission)) return held(admission.digest, "agenda-consumed");
  return { priorEvidence: { digest: admission.digest, feedback, kind: "admitted-packet" }, lineage: null };
}

/** Record one attempt by exact run id. One in-loop hold permits one retry; a completed attempt
 *  or second hold consumes reuse. Feedback stays intact and no finding is marked fixed. */
export function settleRebuildAdvice(
  repoRoot: string,
  slug: string,
  input: { admissionDigest: string; runId: string; heldInLoop: boolean },
): boolean {
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  const payload = ledger.readAdmission();
  if (payload === null) return false;
  const parsed = parseAdmission(
    payload,
    admissionFile(repoRoot, slug),
    "rebuild settlement cannot mutate an unbound evidence packet",
  );
  if (parsed.policy !== FEEDBACK_POLICY || parsed.digest !== input.admissionDigest) return false;
  const feedback = feedbackForAdoptedTree(repoRoot, slug, parsed);
  if (feedback === null || feedback.length === 0 || attemptsConsumed(parsed)) return false;
  if (parsed.attempts.some((row) => row.runId === input.runId)) return false;
  const next = {
    ...parsed,
    attempts: [
      ...parsed.attempts,
      { policy: FEEDBACK_POLICY, runId: input.runId, heldInLoop: input.heldInLoop },
    ],
  };
  if (!ledger.replaceAdmission(payload, capturedJsonStringify(next))) {
    throw new Error("admission changed before rebuild settlement");
  }
  return attemptsConsumed(next);
}

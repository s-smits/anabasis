/**
 * Detect accept controls that are the reference solve's own output.
 *
 * Controls calibrate the checks: an accept control is meant to be a known-good artifact reached
 * independently of `correctness-model/reference/`, so that passing it says something F2 did not
 * already say. When the accept corpus is copied from the reference, the census proves that the
 * reference agrees with itself — which F2 proves before adoption anyway — and the candidate ships
 * with no evidence that its checks accept a second correct answer.
 *
 * Two adopted bundles of 2026-09-19 are why:
 *
 *   truss `truss-opus-20260919T192747000Z-d18bef`  5 of 6 accepts deep-equal `REFERENCE_DESIGNS`
 *                                                  for their task; the 6th is that copy with two
 *                                                  members moved one catalogue step.
 *   run `17f9de-i03`                               all 7 accepts are the reference generator's
 *                                                  templates carrying the reference's own recorded
 *                                                  flash and RAM sizes.
 *
 * Nothing in `src/truth/**` or `src/gate/**` compared the two before this module: the control
 * census only requires accepts to pass and rejects to fail on their declared check, and a copied
 * reference artifact passes by construction.
 *
 * `acceptControlIndependence` is recorded into `solvability.json` beside the representation
 * observations. `acceptIndependenceFeedback` turns that reading into one advisory row when the
 * corpus compared enough accepts to calibrate and fewer of those than the declared floor were
 * reached without the reference; it refuses nothing, and why it stops at advice is in its own
 * comment.
 */
import { existsSync } from "../meta/filesystem.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { compareCodeUnits, sameJsonValue } from "../meta/stable-json.ts";
import type { CampaignFeedback } from "../author/campaign-types.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../claim/calibration.ts";
import { controllerValidatedFinding } from "../truth/brief.ts";
import type { Witness } from "./representation-census.ts";
import { CONTROLS_FILE } from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

/** The two fields this module reads off a recorded accept row. A malformed corpus is not this
 *  module's to report: `validateAcceptControls` owns control shape, and a corpus that cannot be
 *  parsed yields no copies rather than a second opinion on the same defect. */
interface RecordedAccept {
  id?: unknown;
  taskId?: unknown;
  artifact?: JsonValue;
}

/** The recorded reading: how many accept controls the reference witnesses already account for. */
export interface AcceptIndependence {
  /** Accept rows carrying a usable id: every control the corpus declares as known-correct. */
  accepts: number;
  /**
   * Of those, the rows whose task reached a passed F2 witness, so a comparison could actually
   * run. The rest were not found to differ from the reference; nothing was held up against them.
   */
  compared: number;
  /** Accept rows whose artifact equals the F2 witness for the same task, by control id. */
  copiedFromReference: string[];
}

function recordedAccepts(slugDir: string): RecordedAccept[] {
  const file = join(slugDir, CONTROLS_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = readJsonFile(file);
    // SAFETY: the corpus is read only through `accept`, which the next line admits only as an
    // array, and through RecordedAccept's optional fields, each re-checked at its use site.
    const corpus = parsed as { accept?: unknown };
    if (!Array.isArray(corpus?.accept)) return [];
    // SAFETY: an array whose elements are read only through RecordedAccept's optional fields.
    return corpus.accept as RecordedAccept[];
  } catch {
    return [];
  }
}

/**
 * Read the accept corpus against the F2 witnesses. A domain whose task admits exactly one correct
 * artifact reaches `copiedFromReference.length === accepts` by construction and could not author
 * its way out, so a gate on this number would refuse valid candidates — rule 8's named failure
 * mode. The number itself is reporting fidelity, which is always fair game: a reader comparing two
 * campaigns can ask whether the accept corpus carried discrimination evidence of its own, or only
 * re-stated the reference F2 had already run.
 */
export function acceptControlIndependence(
  slugDir: string,
  witnesses: readonly Witness[],
): AcceptIndependence {
  const byTask = new Map(witnesses.map((witness) => [witness.taskId, witness.artifact]));
  const copies: string[] = [];
  let accepts = 0;
  let compared = 0;
  for (const row of recordedAccepts(slugDir)) {
    if (!isString(row.id)) continue;
    accepts += 1;
    // No passed witness for this task means no comparison ran. Counting the row as reached
    // without the reference would read a missing F2 result as evidence about the corpus.
    if (!isString(row.taskId) || !byTask.has(row.taskId)) continue;
    compared += 1;
    // By value rather than by bytes: both sides arrive as parsed JSON, so key order and
    // whitespace are not the question being asked.
    if (sameJsonValue(row.artifact, byTask.get(row.taskId))) copies.push(row.id);
  }
  return { accepts, compared, copiedFromReference: copies.sort(compareCodeUnits) };
}

/**
 * The advisory row a corpus earns when it shows the domain admits a second correct artifact and
 * then declines to use that freedom.
 *
 * The calibration this waited for arrived on 2026-09-20. Both campaigns that closed that day
 * copied most of their accepts and then measured batteries that found no limit:
 *
 *   truss `3fd52f9e-16`   epoch-47640433acdc   7 accepts, 7 compared, 6 copied, 1 independent
 *                                              batteries 6/6, 6/6, 5/5 — the row fires here
 *   campaign `9c0c68b1-2` epoch-3803ffed507b   4 accepts, 4 compared, 3 copied, 1 independent
 *                                              batteries 25/25, 11/11 — silent under the floor
 *                                              below: four accepts cannot reach five independent
 *                                              ones however they were reached, so what that corpus
 *                                              is short of is accepts, which is another row's to say
 *
 * A copied corpus is only a defect when the domain had room for a second correct answer, and the
 * census cannot see a domain. It can see the corpus: **one independent accept is the proof**, since
 * an accept the reference did not produce is a correct artifact the reference did not reach. Both
 * campaigns above carry exactly one and then stop, which is the reading worth a sentence.
 *
 * Independent means compared and found to differ, which is why `compared` and not `accepts` is the
 * population. An accept whose task reached no passed F2 witness was never held up against
 * anything, and subtracting the copies from every declared accept read each of those as an
 * artifact the reference could not produce — the opposite of what a missing witness says. The same
 * reading bars a corpus the census barely saw: under the floor the comparison itself is too small
 * to show that copies are what put the count there, whatever the copies say.
 *
 * Zero independent accepts is therefore silent, not loudest. It is the single-answer domain and the
 * wholly copied corpus at once, and no census evidence separates them: the first `uppercase`
 * candidate through the end-to-end gate has 25 accepts over 4 tasks, every one of them the only
 * correct answer its task has, and a row there would fire forever on a candidate that has nothing
 * to fix. A reading that cannot tell a defect from a domain says nothing.
 *
 * The upper threshold is the declared accept floor, `evaluatorCalibration.minimumKnownPasses`: a
 * corpus states that many known-correct rows, and a row the reference already accounts for is not a
 * second opinion on the checks. Under that count the corpus nominally calibrates and actually does
 * not; at or above it the copies are surplus and silent.
 *
 * It stays advisory. The Builder is the only party that can weigh how much of its corpus a domain
 * lets it vary, prior 5 leaves that judgement with the model, and the census verdict is unchanged:
 * advisory rows refuse no candidate (census-gate.ts).
 *
 * Control ids are Builder-authored public identities, so they cross in full (rule 7). Task ids do
 * not, and none is composed here.
 */
export function acceptIndependenceFeedback(independence: AcceptIndependence): CampaignFeedback[] {
  const copied = independence.copiedFromReference;
  const floor = EVALUATOR_CALIBRATION_POLICY.minimumKnownPasses;
  const independent = independence.compared - copied.length;
  if (independence.compared < floor || independent === 0 || independent >= floor) return [];
  return [
    {
      owner: "accept-controls",
      severity: "advisory",
      claim: `accept-control independence: ${String(independent)} of the ${String(independence.compared)} accept controls compared with a reference witness were reached without it, under the declared floor of ${String(floor)}`,
      evidence:
        "pre-adoption F2 census: each accept artifact compared by value with the reference witness for the same task",
      findings: [
        controllerValidatedFinding({
          code: "accept-control-copies-reference",
          path: CONTROLS_FILE,
          detail: `${copied.join(", ")} carry their task's reference artifact, so passing them repeats what the reference solve already proved. The accepts that are not copies show this domain admits more than one correct artifact, so reach the rest of your corpus the same way`,
        }),
      ],
    },
  ];
}

/**
 * Detects accept controls that are the reference solve's own output.
 *
 * Controls exist to calibrate the checks, which means an accept control is meant to be a
 * known-good artifact reached independently of `correctness-model/reference/`, so that passing it
 * says something F2 did not already say. When the accept corpus is copied from the reference, the
 * census proves only that the reference agrees with itself — which F2 proves before adoption
 * anyway — and the candidate ships with no evidence at all that its checks accept a second correct
 * answer.
 *
 * The control census alone never catches this, because it asks only that accepts pass and rejects
 * fail on their declared check, and a copied reference artifact passes by construction. Copying
 * takes several shapes: an accept deep-equal to the reference design for its task, that same copy
 * with a member or two nudged one catalogue step, or the reference generator's own templates
 * carrying the reference's recorded numbers. This module is the only place the two corpora are held
 * up against each other; `solvability-gate.ts` is its single caller, and it runs there because that
 * is where the F2 witnesses exist.
 *
 * `acceptControlIndependence` records the reading into `solvability.json` beside the representation
 * observations, and `acceptIndependenceFeedback` turns it into at most one advisory row. It refuses
 * nothing, and the reason it stops at advice is in that function's own comment.
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

/** The fields this module reads off a recorded accept row. A malformed corpus is not its to
 *  report: `validateAcceptControls` owns control shape, so a corpus that cannot be parsed yields no
 *  copies here rather than a second opinion on the same defect. */
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
   * Of those, the rows whose task reached a passed F2 witness, so a comparison could actually run.
   * The rest were not found to differ from the reference; nothing was held up against them at all,
   * which is a different statement and the reason this count is separate from `accepts`.
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
 * Reads the accept corpus against the F2 witnesses. This is a reading and not a gate, because a
 * domain whose task admits exactly one correct artifact reaches
 * `copiedFromReference.length === accepts` by construction and could not author its way out of it;
 * a gate on this number would refuse valid candidates, which is rule 8's named failure mode.
 *
 * The number itself is reporting fidelity, which is always fair game: a reader comparing two
 * campaigns can ask whether the accept corpus carried discrimination evidence of its own, or only
 * restated the reference F2 had already run.
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
    // No passed witness for this task means no comparison ran. Counting the row as reached without
    // the reference would read a missing F2 result as evidence about the corpus, which it is not.
    if (!isString(row.taskId) || !byTask.has(row.taskId)) continue;
    compared += 1;
    // By value rather than by bytes: both sides arrive as parsed JSON, so key order and whitespace
    // are not the question being asked.
    if (sameJsonValue(row.artifact, byTask.get(row.taskId))) copies.push(row.id);
  }
  return { accepts, compared, copiedFromReference: copies.sort(compareCodeUnits) };
}

/**
 * The advisory row a corpus earns when it shows the domain admits a second correct artifact and
 * then declines to use that freedom.
 *
 * A copied corpus is only a defect when the domain had room for a second correct answer, and the
 * census cannot see a domain. It can see the corpus, though, and one independent accept is the
 * proof, since an accept the reference did not produce is a correct artifact the reference did not
 * reach. The shape this fires on is a corpus that reaches exactly one such accept and then stops,
 * copying the rest — and such a corpus goes on to measure batteries that find no limit.
 *
 * Independent means compared and found to differ, which is why `compared` and not `accepts` is the
 * population. An accept whose task reached no passed F2 witness was never held up against
 * anything, so subtracting the copies from every declared accept would read each of those as an
 * artifact the reference could not produce — the opposite of what a missing witness says. The same
 * reading is what bars a corpus the census barely saw: under the floor, the comparison is too
 * small to show that copies are what put the count there, whatever the copies say.
 *
 * Zero independent accepts is therefore silent rather than loudest. It is the single-answer domain
 * and the wholly copied corpus at once, and no census evidence separates them: the `uppercase`
 * fixture that drives the end-to-end gate declares 25 accepts over 4 tasks, every one of them the
 * only correct answer its task has, and a row there would fire forever on a candidate with nothing
 * to fix. A reading that cannot tell a defect from a domain says nothing.
 *
 * The upper threshold is the declared accept floor, `evaluatorCalibration.minimumKnownPasses`: a
 * corpus states that many known-correct rows, and a row the reference already accounts for is not
 * a second opinion on the checks. Under that count the corpus nominally calibrates and actually
 * does not; at or above it the copies are surplus and the row stays silent.
 *
 * It stays advisory because the Builder is the only party that can weigh how much of its corpus a
 * domain lets it vary — prior 5 leaves that judgement with the model — and because an advisory row
 * refuses no candidate, so the census verdict is unchanged (census-gate.ts).
 *
 * Control ids are Builder-authored public identities, so they cross in full under rule 7. Task ids
 * do not, and none is composed here.
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

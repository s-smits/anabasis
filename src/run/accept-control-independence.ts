/**
 * Detects accept controls that are the reference solve's own output.
 *
 * An accept control should be a known-good artifact reached independently of the reference, so
 * that passing it says something F2 did not. A copied accept passes by construction and shows only
 * that the reference agrees with itself.
 *
 * `acceptControlIndependence` is recorded in `solvability.json`; `acceptIndependenceFeedback` turns
 * it into at most one advisory row.
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

/** The fields read off a recorded accept row. Control shape belongs to `validateAcceptControls`, so
 *  an unparseable corpus yields no copies here. */
interface RecordedAccept {
  id?: unknown;
  taskId?: unknown;
  artifact?: JsonValue;
}

/** The recorded reading: how many accept controls the reference witnesses already account for. */
export interface AcceptIndependence {
  /** Accept rows carrying a usable id. */
  accepts: number;
  /** Of those, the rows whose task has a passed F2 witness, so a comparison ran. */
  compared: number;
  /** Accept rows whose artifact equals the F2 witness for the same task, by control id. */
  copiedFromReference: string[];
}

function recordedAccepts(slugDir: string): RecordedAccept[] {
  const file = join(slugDir, CONTROLS_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = readJsonFile(file);
    // SAFETY: only `accept` is read, and the next line admits it only as an array.
    const corpus = parsed as { accept?: unknown };
    if (!Array.isArray(corpus?.accept)) return [];
    // SAFETY: an array whose elements are read only through RecordedAccept's optional fields.
    return corpus.accept as RecordedAccept[];
  } catch {
    return [];
  }
}

/**
 * Compares the accept corpus with the F2 witnesses. This is a reading, not a gate: a domain with
 * one correct artifact per task copies the reference by construction.
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
    // Without a passed witness no comparison ran, so the row says nothing about independence.
    if (!isString(row.taskId) || !byTask.has(row.taskId)) continue;
    compared += 1;
    // By value, so key order and whitespace do not matter.
    if (sameJsonValue(row.artifact, byTask.get(row.taskId))) copies.push(row.id);
  }
  return { accepts, compared, copiedFromReference: copies.sort(compareCodeUnits) };
}

/**
 * One advisory row when the corpus proves the domain admits a second correct artifact but reaches
 * fewer than the accept floor (`minimumKnownPasses`) of its compared accepts independently.
 *
 * - One independent accept proves a second correct answer exists.
 * - Zero is silent: a single-answer domain and a wholly copied corpus look the same.
 * - Fewer compared accepts than the floor is silent: the comparison is too small to read.
 *
 * It stays advisory because only the Builder can weigh how far its domain allows variation.
 * Control ids are public Builder identities and cross in full; no task id is composed.
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

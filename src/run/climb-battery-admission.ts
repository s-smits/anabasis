/**
 * Decide whether a recorded run belongs to this tree's difficulty history and read its evidence.
 *
 * climb-history.ts interprets the admitted batteries for the difficulty selector. This module
 * decides whether each battery can enter that history at all, and answers with the named
 * exclusion row the author will read when it cannot. Every refusal is settled here, at the bytes
 * that caused it, so the reader downstream states the population law and nothing else.
 */
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { Check as validateSchema } from "typebox/value";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { MeasuredDifficulty } from "../claim/battery-difficulty.ts";
import { recordedEvidence } from "../claim/evidence-log.ts";
import { loadFrozenManifest } from "../critic/manifest.ts";
import { isBoolean, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { BATTERY_FILE } from "../truth/battery-record.ts";
import { recordedVerifierHash } from "../truth/verifier-environment.ts";
import { parseExperimentSubmission } from "../author/experiment-proposal.ts";
import { ExperimentAuthoringSchema, type ExperimentAuthoring } from "./experiment-freeze.ts";
import { SHIPPING_VARIANT } from "./run-driver.ts";

/** The claim clauses the climb does not read: both count what the environment failed to do, and
 *  neither says anything about the tasks. `src/claim/claim.ts` raises the first when a supported
 *  transport did not record complete per-case model identity, and the second when more than a
 *  quarter of the attempted cases were typed non-results. See `claimFacts`.
 *
 *  `runtime-model-identity-contradicted` is deliberately absent. It is raised when the census did
 *  record an identity and that identity names another served model, transport or provider — which
 *  is a statement about the run, not a gap in it. Admitting it would put another model's pass rate
 *  into this product's climb, against the contract's "comparison requires matching measured
 *  model". Until 2026-09-20 one clause carried both readings and this set admitted them together. */
const ENVIRONMENT_CLAUSES = new Set(["runtime-model-identity-unproven", "non-result-ratio-excessive"]);

/** Partial recorded battery shape. Admission checks experiment authoring before returning it;
 * the history reader checks the remaining fields it consumes. */
export interface BatteryEvidence {
  runId?: unknown;
  backendPin?: unknown;
  thresholdManifestDigest?: unknown;
  condition?: { variant?: unknown };
  bundleSnapshot?: { agentHash?: unknown; scoringHash?: unknown; taskSetHash?: unknown };
  execution?: JsonValue;
  cases?: Array<{
    taskId?: unknown;
    pass?: unknown;
    acceptedSubmit?: unknown;
    runtimeNonResult?: unknown;
    solver?: { toolCalls?: unknown };
  }>;
  /** Loose at the boundary: `admitBattery` normalises it. */
  measured?: Omit<Partial<MeasuredDifficulty>, "changedSubset"> & {
    changedSubset?: { attempts?: unknown; passes?: unknown };
  };
  experimentAuthoring?: ExperimentAuthoring;
}

/** The run's threshold identity for battery comparability. Three states, kept apart because the
 *  old reader collapsed the last two into null and an unreadable manifest silently disabled the
 *  threshold-identity check — evidence recorded under a different frozen manifest was admitted as
 *  comparable. "unstated" (caller named no manifest) still states nothing about thresholds;
 *  "unavailable" (named but unreadable) fails closed in admitBattery. */
export type ThresholdIdentity =
  | { kind: "unstated" }
  | { kind: "digest"; digest: string }
  | { kind: "unavailable" };

/** Read the claim's refusal and recorded write time, which orders batteries in the history.
 *  The claim decides whether a battery's score supports a truth claim. The difficulty reader
 *  uses that decision instead of deriving it again from battery bytes. A missing or unreadable
 *  claim is treated as refused and cannot supply a rate.
 *  A created claim without `createdAt` is also refused: ordering requires a recorded timestamp,
 *  otherwise it would depend on filesystem metadata. In run 9,
 *  the file for the version without advisers was 71 minutes older, and that timing alone made the
 *  selector climb. */
type ClaimFacts = { refusal: string; createdAt: string | null } | { refusal: null; createdAt: string };

/**
 * One run directory's verdict: an admitted battery, an exclusion, or — for a claim-refused battery
 * a recorded clock can still place — both. The exclusion row is built here, where the reason is
 * decided, so no reader re-derives one or has to name the run a second time.
 *
 * `claimRefused` separates a same-condition battery that created no claim from an identity or
 * comparability refusal: another pin's history says nothing about this condition, while a
 * same-condition battery that ran and created no claim records an unsuccessful attempt under it.
 */
export type ExcludedBattery = {
  runId: string;
  reason: string;
  claimRefused: boolean;
};

export type BatteryAdmission =
  | {
      ok: true;
      /** Null for admitted evidence. The claim's own refusal when this battery measured under
       *  this condition and a recorded clock can place it, but its numbers may not carry a rate:
       *  the row keeps its place in history, and climb-history.ts decides whether it still
       *  states a level. A refused claim removes the rate, not the fact that the battery ran. */
      excluded: ExcludedBattery | null;
      evidence: BatteryEvidence;
      /** The recorded difficulty in its current shape. */
      measured: MeasuredDifficulty;
      /** The harness these bytes measured, or null when they do not state one. */
      harnessId: string | null;
      /** The threshold digest and variant admission required and checked. */
      condition: { thresholdManifestDigest: string; variant: string };
      runId: string;
      batterySha256: string;
      createdAt: string;
    }
  | { ok: false; excluded: ExcludedBattery };

export function currentThresholdDigest(manifestPath?: string): ThresholdIdentity {
  if (manifestPath === undefined) return { kind: "unstated" };
  try {
    return { kind: "digest", digest: loadFrozenManifest(manifestPath).digest };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The harness identity a battery measured: agent, scoring program and recorded verifier bytes.
 *  The task set, its controls, reference solves and tests are excluded, because a task probe
 *  rewrites them together and keeps this product fixed. Null when the evidence lacks the required
 *  identity, as every battery recorded before `scoringHash` does; a null never matches another, so
 *  it can only shorten a hold chain, never extend one. */
function harnessIdentity(evidence: BatteryEvidence): string | null {
  const { agentHash, scoringHash } = evidence.bundleSnapshot ?? {};
  return isString(agentHash) && isString(scoringHash)
    ? harnessBundleIdentity({ agentHash, scoringHash }, recordedVerifierHash(evidence.execution))
    : null;
}

/** One comparison identity for recorded batteries and trees with a retained verifier condition. */
export function harnessBundleIdentity(
  bundle: { agentHash: string; scoringHash: string },
  verifierEnvironmentHash: string | null | undefined,
): string | null {
  return verifierEnvironmentHash === undefined
    ? null
    : `${bundle.agentHash}:${bundle.scoringHash}:${verifierEnvironmentHash}`;
}

function claimFacts(claimsDir: string, runId: string): ClaimFacts {
  const path = join(claimsDir, `${runId}.json`);
  try {
    const evidence =
      /* SAFETY: every field of the declared shape is optional and `unknown`, so the reader below states the claim's own contract and checks it before reading. */ capturedJsonParse(
        readFileSync(path, "utf8"),
      ) as {
        schema?: unknown;
        runId?: unknown;
        createdAt?: unknown;
        claim?: { ok?: boolean; clauses?: Array<{ clause?: string }> };
      };
    const createdAt = isString(evidence.createdAt) ? evidence.createdAt : null;
    // The writer has always used run-claim/v1. Another schema may give ok/clauses different
    // meanings, so its filename cannot establish that this reader understands the record.
    // This check follows the evidence-reader audit on 2026-08-03.
    if (evidence.schema !== "run-claim/v1") {
      return {
        refusal: `claim evidence declares ${capturedJsonStringify(evidence.schema ?? null)} instead of run-claim/v1`,
        createdAt: null,
      };
    }
    // Check the runId inside the claim as well as its filename. Previously, copying or renaming
    // a claim could make it apply to another battery. Clause names now affect controller
    // decisions, including stopping a run, so the claim must identify the battery it describes.
    if (evidence.runId !== runId) {
      return {
        refusal: `claim evidence names run ${capturedJsonStringify(evidence.runId ?? null)} instead of ${runId} — a claim speaks for its own battery, not for the file name it was found under`,
        createdAt: null,
      };
    }
    if (evidence.claim?.ok !== true) {
      const names = (evidence.claim?.clauses ?? []).flatMap((row) =>
        row.clause === undefined ? [] : [row.clause],
      );
      // Comparison identity already has an owner here: `admitBattery` checks the battery's own
      // recorded `backendPin` against the run pin. Both environment clauses belong to the
      // environment owner and not to the task author, so a second reading of either voided a
      // battery's rate for a gap the tasks did not cause. On 18 September the identity clause
      // deleted truss run c1d2a7's i04 — the first battery in four rounds to produce failing
      // cases, 3 of 5 — from the difficulty population, and the next climb repeated "6/6,
      // significantly too easy" off the round before it. The ratio clause did the same to
      // campaign 3fd52f9e-28 three rounds running, on batteries that scored 14/14, 11/11 and 1/1
      // truth-verified passes: seven consecutive decisions re-read one 24/25 from five days
      // earlier while 26 verified passes sat unread. The claim keeps its clause; the climb stops
      // being its second reader. The shorter sample is read honestly — `placeOnBand` owns whether
      // the cases that did run are enough to place, and refuses rather than misplaces.
      if (createdAt !== null && names.length > 0 && names.every((name) => ENVIRONMENT_CLAUSES.has(name))) {
        return { refusal: null, createdAt };
      }
      return {
        refusal: names.length === 0 ? "claim refused" : `claim refused: ${names.join(", ")}`,
        // A refused claim is recorded evidence too: its clock places this refusal against the
        // admitted batteries, so a later reader can determine what the latest evidence said.
        createdAt,
      };
    }
    if (createdAt === null) {
      return {
        refusal: "created claim carries no createdAt — evidence-borne chronology cannot place it",
        createdAt: null,
      };
    }
    return { refusal: null, createdAt };
  } catch {
    return { refusal: existsSync(path) ? "unreadable claim evidence" : "no claim evidence", createdAt: null };
  }
}

/** The recorded difficulty, resolved once at the parse boundary so that every reader downstream
 *  receives the same rows: the item tallies and the changed subset's two counts. Older batteries
 *  carry `levels`, `ladder`, `findings` and a stored rate and interval beside them; every reader
 *  now derives those from the counts, so they are dropped here rather than carried through. */
function measuredDifficulty(stored: BatteryEvidence["measured"]): MeasuredDifficulty {
  const subset = stored?.changedSubset;
  const counts =
    subset !== undefined && isNumber(subset.attempts) && isNumber(subset.passes)
      ? { attempts: subset.attempts, passes: subset.passes }
      : undefined;
  return {
    items: Array.isArray(stored?.items) ? stored.items : [],
    ...keyIfDefined("changedSubset", counts),
  };
}

/** What the claim verdict does to a battery that passed every identity gate. An admitted claim
 *  carries the rate. A refused claim removes the rate and keeps the history row, so the battery's
 *  level stays readable — unless no recorded clock can place the refusal, and a row no chronology
 *  admits cannot sit in the difficulty history at all. */
function claimAdmission(
  claim: ClaimFacts,
  row: {
    evidence: BatteryEvidence;
    measured: MeasuredDifficulty;
    harnessId: string | null;
    condition: { thresholdManifestDigest: string; variant: string };
    runId: string;
    batterySha256: string;
  },
): BatteryAdmission {
  if (claim.refusal === null) return { ok: true, excluded: null, ...row, createdAt: claim.createdAt };
  const excluded = {
    runId: row.runId,
    reason: `${claim.refusal} — a battery that created no claim is not climb evidence`,
    claimRefused: true,
  };
  if (claim.createdAt === null) return { ok: false, excluded };
  return { ok: true, excluded, ...row, createdAt: claim.createdAt };
}

/**
 * Admit one run directory, or name why it is not this tree's climb history. Each gate is its own
 * refusal:
 *
 *  - the run directory must pass the run-record ownership check, and `batterySha256` is the
 *    manifest's recorded battery.json hash (`recordedEvidence`): an unrecorded, tampered, foreign, or
 *    torn run dir is not evidence. The old reader bound `bundleSnapshot.taskSetHash` here — a hash of
 *    different bytes that could never match the recorded battery.json digest;
 *  - the recorded evidence's own runId must equal its directory name: a recorded run dir copied
 *    under another name is not this tree's history;
 *  - a non-null `runPin` gates comparison identity (null reads history across model pins):
 *    a different backend pin measures a different condition — run 6 climbed to L1 on a codex-era 25/25 while its
 *    own pinned backend scored 0/25 at the base difficulty;
 *  - `thresholdDigest` checks threshold identity the same way: evidence recorded under a different
 *    fixed threshold manifest measured a different condition (thresholds stay fixed
 *    across a climb), so it is excluded by name. Evidence that states no digest is excluded too:
 *    the measuring runner writes one on every battery (operator decision 2026-09-22);
 *  - only the main battery counts (`SHIPPING_VARIANT`); evidence without a variant field states
 *    no condition and is excluded;
 *  - `claimsDir` is the claim check: a battery whose claim was refused, or never created, carries
 *    the claim's own clauses as its `excludedReason`, so no rate reads from it. Run 8 recorded a
 *    0/25 of provider outages; the claim refused it, but the old reader read the zeros as a
 *    too-hard base difficulty. A refusal a recorded clock cannot place refuses outright. The one
 *    exception is a refusal carrying nothing but an environment clause, which the run pin check
 *    above already owns; `ENVIRONMENT_CLAUSES` says which and why.
 *
 * `null` means the directory holds no battery at all, which is not an exclusion.
 */
export function admitBattery(
  runDir: string,
  name: string,
  runPin: string | null,
  thresholdDigest: ThresholdIdentity,
  claimsDir: string,
): BatteryAdmission | null {
  if (!existsSync(join(runDir, BATTERY_FILE))) return null;
  const refuse = (reason: string): BatteryAdmission => ({
    ok: false,
    excluded: { runId: name, reason, claimRefused: false },
  });
  if (thresholdDigest.kind === "unavailable") {
    return refuse(
      "this run's frozen threshold manifest cannot be read, so threshold identity cannot be proved — no recorded battery is comparable until the manifest is legible",
    );
  }
  const recorded = recordedEvidence(runDir, BATTERY_FILE);
  if (!recorded.ok) return refuse(recorded.refusal);
  let evidence: BatteryEvidence;
  try {
    // Use the reader's own attested bytes (review 2026-08-03, evidence-reader audit): a second
    // readFileSync here could consume a file rewritten after the ownership check passed.
    evidence =
      /* SAFETY: admission validates experimentAuthoring below; the remaining fields are checked by their readers before use. */ capturedJsonParse(
        recorded.bytes,
      ) as BatteryEvidence;
  } catch {
    return refuse("unreadable battery evidence");
  }
  if (!isString(evidence.runId) || !Array.isArray(evidence.cases)) {
    return refuse("evidence states no run id or case rows");
  }
  if (!evidence.cases.every((row) => isBoolean(row.acceptedSubmit))) {
    return refuse("a case row states no acceptedSubmit, which every battery the runner writes records");
  }
  if (
    evidence.experimentAuthoring !== undefined &&
    (!validateSchema(ExperimentAuthoringSchema, evidence.experimentAuthoring) ||
      parseExperimentSubmission(evidence.experimentAuthoring.proposal) === null)
  ) {
    return refuse("recorded experiment authoring is malformed or has an unbound proposal digest");
  }
  if (evidence.runId !== name) {
    return refuse(
      "recorded battery carries a different runId than its directory — a relocated run dir is not this tree's history",
    );
  }
  if (runPin !== null && evidence.backendPin !== runPin) {
    const pin = isString(evidence.backendPin) ? evidence.backendPin : "absent";
    return refuse(`recorded backend pin ${pin} is not the run's ${runPin} — not comparable`);
  }
  if (!isString(evidence.thresholdManifestDigest)) {
    return refuse("records no threshold manifest digest, so its thresholds cannot be compared");
  }
  if (thresholdDigest.kind === "digest" && evidence.thresholdManifestDigest !== thresholdDigest.digest) {
    return refuse(
      "recorded under a different frozen threshold manifest than this run's — thresholds are part of the frozen condition, so the evidence is not comparable",
    );
  }
  const variant = evidence.condition?.variant;
  if (!isString(variant)) {
    return refuse("records no condition variant, so it cannot be read as the shipping condition");
  }
  if (variant !== SHIPPING_VARIANT) {
    return refuse(`saved under condition ${variant}; climb history reads only the shipping condition`);
  }
  return claimAdmission(claimFacts(claimsDir, evidence.runId), {
    evidence,
    measured: measuredDifficulty(evidence.measured),
    harnessId: harnessIdentity(evidence),
    condition: { thresholdManifestDigest: evidence.thresholdManifestDigest, variant },
    runId: evidence.runId,
    batterySha256: recorded.sha256,
  });
}

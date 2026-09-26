/**
 * Decides whether a recorded run belongs to this tree's difficulty history, and reads its evidence
 * when it does.
 *
 * climb-history.ts interprets the admitted batteries for the difficulty selector. This module
 * decides whether each battery may enter that history at all, and answers with the named exclusion
 * row the author will read when it cannot. Every refusal is settled here, at the bytes that caused
 * it, so that the reader downstream states the population law and nothing else; splitting the
 * decision across both would give one battery two chances to be excluded for two different reasons.
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
import { parseExperimentSubmission } from "../author/experiment-plan.ts";
import { ExperimentAuthoringSchema, type ExperimentAuthoring } from "./experiment-freeze.ts";
import { SHIPPING_VARIANT } from "./run-driver.ts";

/** The two claim clauses the climb does not read. Both count something the environment failed to
 *  do, and neither says anything about the tasks. `src/claim/claim.ts` raises
 *  `runtime-model-identity-unproven` when a supported transport did not record complete per-case
 *  model identity, and `non-result-ratio-excessive` when at least two non-results account for more
 *  than a quarter of the attempted cases. A claim refused only for these still gives the climb a
 *  rate, because the tasks did the same work either way.
 *
 *  `runtime-model-identity-contradicted` is deliberately absent, which is the whole point of having
 *  two names. It is raised when the census did record an identity and that identity names another
 *  served model, transport or provider — a statement about the run rather than a gap in it.
 *  Admitting it would put another model's pass rate into this product's climb, against the
 *  contract's "comparison requires matching measured model". */
const ENVIRONMENT_CLAUSES = new Set(["runtime-model-identity-unproven", "non-result-ratio-excessive"]);

/** Partial recorded battery shape. Admission validates the experiment authoring before returning
 *  the evidence, because a malformed proposal digest is a refusal rather than a field to skip; the
 *  history reader checks the remaining fields it consumes, at the point it consumes them. */
export interface BatteryEvidence {
  runId?: unknown;
  backendPin?: unknown;
  thresholdManifestDigest?: unknown;
  condition?: { variant?: unknown };
  bundleSnapshot?: { agentHash?: unknown; scoringHash?: unknown; taskSetHash?: unknown };
  execution?: JsonValue;
  cases?: Array<{
    taskId?: unknown;
    family?: unknown;
    pass?: unknown;
    acceptedSubmit?: unknown;
    runtimeNonResult?: unknown;
    solver?: { toolCalls?: unknown; turns?: unknown; startedAt?: unknown; endedAt?: unknown };
  }>;
  /** Loose at the boundary: `admitBattery` normalises it. */
  measured?: Omit<Partial<MeasuredDifficulty>, "changedSubset"> & {
    changedSubset?: { attempts?: unknown; passes?: unknown };
  };
  experimentAuthoring?: ExperimentAuthoring;
}

/** The run's threshold identity for battery comparability, in three states rather than two.
 *  Collapsing the last two into null would let an unreadable manifest silently disable the
 *  threshold-identity check and admit evidence recorded under a different frozen manifest as
 *  comparable. Kept apart, "unstated" — the caller named no manifest — states nothing about
 *  thresholds and checks nothing, while "unavailable" — named but unreadable — fails closed in
 *  `admitBattery` and refuses every battery until the manifest is legible again. */
export type ThresholdIdentity =
  | { kind: "unstated" }
  | { kind: "digest"; digest: string }
  | { kind: "unavailable" };

/** The claim's refusal and its recorded write time, which is what orders batteries in the history.
 *  The claim already decides whether a battery's score supports a truth claim, so the difficulty
 *  reader uses that decision rather than deriving it a second time from battery bytes. A missing or
 *  unreadable claim is treated as refused and cannot supply a rate. A created claim without
 *  `createdAt` is refused as well, because ordering has to come from recorded evidence rather than
 *  from filesystem metadata, where an mtime an hour apart is enough to make the selector climb. */
type ClaimFacts = { refusal: string; createdAt: string | null } | { refusal: null; createdAt: string };

/**
 * Why a run directory is excluded. The row is built where the reason is decided, so that no reader
 * downstream re-derives one or has to name the run a second time.
 *
 * `claimRefused` separates two exclusions that would otherwise read alike. A same-condition battery
 * that ran and created no claim is an unsuccessful attempt under this condition; an identity or
 * comparability refusal says nothing about this condition at all, because another pin's history is
 * another product's history.
 */
export type ExcludedBattery = {
  runId: string;
  reason: string;
  claimRefused: boolean;
};

/** One run directory's verdict: an admitted battery, an exclusion, or — for a claim-refused battery
 *  that a recorded clock can still place — both at once. */
export type BatteryAdmission =
  | {
      ok: true;
      /** Null for admitted evidence. It carries the claim's own refusal when this battery measured
       *  under this condition and a recorded clock can place it, but its numbers may not carry a
       *  rate: the row keeps its place in history and climb-history.ts decides whether it still
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

/** A refused claim whose every clause is the environment's, the one reading both the climb and
 *  the authoring allowance take of a refusal. */
export function refusedForEnvironmentOnly(names: readonly string[]): boolean {
  return names.length > 0 && names.every((name) => ENVIRONMENT_CLAUSES.has(name));
}

export function currentThresholdDigest(manifestPath?: string): ThresholdIdentity {
  if (manifestPath === undefined) return { kind: "unstated" };
  try {
    return { kind: "digest", digest: loadFrozenManifest(manifestPath).digest };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The harness identity a battery measured: agent, scoring program and recorded verifier bytes.
 *  The task set, its controls, reference solves and tests are excluded on purpose, because a task
 *  probe rewrites them together while keeping this product fixed, so a probe that changed this
 *  identity would make every earlier battery of the same product incomparable. Null when the
 *  evidence lacks an agent or scoring hash, and a null is dropped rather than matched, so it never
 *  collapses several products into one. */
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
    // The writer has always used run-claim/v1. Another schema may give `ok` and `clauses`
    // different meanings, so the file name it was found under cannot establish that this reader
    // understands the record; the declared schema has to say so.
    if (evidence.schema !== "run-claim/v1") {
      return {
        refusal: `claim evidence declares ${capturedJsonStringify(evidence.schema ?? null)} instead of run-claim/v1`,
        createdAt: null,
      };
    }
    // The runId inside the claim is checked as well as the one in its filename, because copying or
    // renaming a claim file used to be enough to make it apply to another battery. Clause names
    // now reach controller decisions, including stopping a run, so the claim has to identify the
    // battery it actually describes.
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
      // Environment clauses alone do not void the rate, because comparison identity already has an
      // owner here: `admitBattery` checks the battery's own recorded `backendPin` against the run
      // pin. Both environment clauses belong to the environment owner rather than the task author,
      // so reading either a second time voids a battery's rate for a gap the tasks did not cause —
      // and that deletes exactly the batteries that produced failing cases, leaving the climb to
      // re-read an older, easier battery for round after round. The claim keeps its clause; the
      // climb simply stops being its second reader. The shorter sample is then read honestly,
      // because `placeOnBand` owns whether the cases that did run are enough to place at all, and
      // refuses a placement rather than misplacing one.
      if (createdAt !== null && refusedForEnvironmentOnly(names)) {
        return { refusal: null, createdAt };
      }
      return {
        refusal: names.length === 0 ? "claim refused" : `claim refused: ${names.join(", ")}`,
        // A refused claim is recorded evidence too, so its clock still places the refusal among the
        // admitted batteries and a later reader can tell what the most recent evidence said.
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

/** The recorded difficulty, resolved once at the parse boundary so every reader downstream receives
 *  the same rows: the item tallies and the changed subset's two counts. A stored rate and interval
 *  are dropped here rather than carried through, since every reader derives those from the counts
 *  and a carried field is one a reader might trust over its own arithmetic. */
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

/** What the claim verdict does to a battery that has already passed every identity gate. An
 *  admitted claim carries the rate. A refused claim removes the rate and keeps the history row, so
 *  the battery's level stays readable — unless no recorded clock can place the refusal, and a row
 *  that no chronology admits cannot sit in the difficulty history at all. */
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
 * Admits one run directory to the climb history, or names why it is not this tree's history. Each
 * gate is its own refusal, and each one exists because reading past it once changed a decision:
 *
 *  - the run directory must pass the run-record ownership check, and `batterySha256` is the
 *    manifest's recorded battery.json hash from `recordedEvidence`, so an unrecorded, tampered,
 *    foreign or torn run dir is not evidence;
 *  - the recorded evidence's own runId must equal its directory name, since a recorded run dir
 *    copied under another name is not this tree's history;
 *  - a non-null `runPin` gates comparison identity, and passing null reads history across model
 *    pins deliberately. A different backend pin measures a different condition, so one pin's 25/25
 *    can climb a product whose own pinned backend scores nothing at the base difficulty;
 *  - `thresholdDigest` checks threshold identity the same way, because thresholds stay fixed across
 *    a climb, so evidence recorded under a different frozen manifest measured a different
 *    condition. Evidence that states no digest is excluded too, since the measuring runner writes
 *    one on every battery (operator decision);
 *  - only the main battery counts (`SHIPPING_VARIANT`), and evidence without a variant field states
 *    no condition at all;
 *  - `claimsDir` is the claim check. A battery whose claim was refused, or never created, carries
 *    the claim's own clauses as its `excludedReason` so that no rate reads from it — otherwise a
 *    0/25 of provider outages reads as a too-hard base difficulty. A refusal that no recorded clock
 *    can place is refused outright. The one exception is a refusal carrying nothing but an
 *    environment clause, which the run pin check above already owns; `ENVIRONMENT_CLAUSES` says
 *    which clauses and why.
 *
 * `null` means the directory holds no battery at all, which is not an exclusion and should not be
 * reported as one.
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
    // Parse the reader's own attested bytes rather than reading the file again: a second
    // `readFileSync` here could consume a file rewritten after the ownership check passed.
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

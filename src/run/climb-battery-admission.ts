/**
 * Decides whether a recorded battery enters this tree's difficulty history, and names the
 * exclusion when it does not. climb-history.ts reads the admitted batteries.
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

/** Claim clauses that describe environment gaps, not the tasks, so a claim refused only for them
 *  still gives the climb a rate. `runtime-model-identity-contradicted` is absent on purpose: it
 *  says another model was measured, which is not comparable. */
const ENVIRONMENT_CLAUSES = new Set(["runtime-model-identity-unproven", "non-result-ratio-excessive"]);

/** Partial recorded battery shape. Admission checks experiment authoring; readers check the rest. */
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

/** The run's threshold identity. "unstated" (no manifest named) checks nothing; "unavailable"
 *  (named but unreadable) refuses every battery in admitBattery. */
export type ThresholdIdentity =
  | { kind: "unstated" }
  | { kind: "digest"; digest: string }
  | { kind: "unavailable" };

/** The claim's refusal and its recorded `createdAt`, which orders batteries in the history. A
 *  missing or unreadable claim, or a created one without `createdAt`, is refused: ordering never
 *  falls back to filesystem times. */
type ClaimFacts = { refusal: string; createdAt: string | null } | { refusal: null; createdAt: string };

/**
 * Why a run directory is excluded. `claimRefused` marks a same-condition battery whose claim was
 * refused (an unsuccessful attempt under this condition), as opposed to an identity or
 * comparability refusal, which says nothing about this condition.
 */
export type ExcludedBattery = {
  runId: string;
  reason: string;
  claimRefused: boolean;
};

/** One run directory's verdict: admitted, excluded, or both for a claim-refused battery that a
 *  recorded clock can still place. */
export type BatteryAdmission =
  | {
      ok: true;
      /** Null for admitted evidence; the claim's refusal when the battery keeps its place in
       *  history but carries no rate. */
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

/** The harness identity a battery measured: agent, scoring program and recorded verifier bytes,
 *  excluding the task set a task probe may rewrite. Null when the evidence lacks an identity; a
 *  null matches nothing. */
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
    // Another schema may give ok/clauses different meanings.
    if (evidence.schema !== "run-claim/v1") {
      return {
        refusal: `claim evidence declares ${capturedJsonStringify(evidence.schema ?? null)} instead of run-claim/v1`,
        createdAt: null,
      };
    }
    // The claim must name its own battery; a copied or renamed claim file does not.
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
      // Environment clauses alone do not void the rate: `admitBattery` owns comparison identity
      // through the backend pin, and `placeOnBand` decides whether the cases that ran can place.
      if (createdAt !== null && names.length > 0 && names.every((name) => ENVIRONMENT_CLAUSES.has(name))) {
        return { refusal: null, createdAt };
      }
      return {
        refusal: names.length === 0 ? "claim refused" : `claim refused: ${names.join(", ")}`,
        // A refused claim's clock still places it among the admitted batteries.
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

/** The recorded difficulty, normalised once: item tallies and the changed subset's two counts. */
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

/** Applies the claim verdict to a battery that passed every identity gate. A refused claim drops
 *  the rate but keeps the history row, unless no recorded clock can place it. */
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
 * Admits one run directory to the climb history, or names why not. Each gate refuses on its own:
 *
 *  - the run directory passes the run-record ownership check; `batterySha256` is the recorded
 *    battery.json hash;
 *  - the evidence's runId equals its directory name;
 *  - a non-null `runPin` must match the recorded backend pin (null reads across pins);
 *  - the recorded threshold manifest digest must be present and match `thresholdDigest`;
 *  - only the shipping variant counts;
 *  - the claim in `claimsDir` must be created, or refused only for `ENVIRONMENT_CLAUSES`; a
 *    refused claim a recorded clock can place keeps its row without a rate.
 *
 * `null` means the directory holds no battery, which is not an exclusion.
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
    // Parse the attested bytes; a second read could see a file rewritten after the check.
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

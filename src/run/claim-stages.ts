/**
 * Claim maturity is recorded as ordered claim stages. This evidence says how far an adopted
 * harness has progressed through admission, measurement, claim creation, readiness and activation;
 * it never states task difficulty or capability.
 */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { writeJsonFile } from "../meta/completed-json.ts";

export const CLAIM_STAGES = ["build-admissible", "measured", "claim-created", "ready", "activated"] as const;
export type ClaimStage = (typeof CLAIM_STAGES)[number];

interface ClaimStageStep {
  stage: ClaimStage;
  at: string;
  /** The admission, measurement, or explicit activation evidence that produced this stage. */
  evidence: string;
}

interface ClaimStageEvidence {
  slug: string;
  steps: ClaimStageStep[];
}

export const CLAIM_STAGES_FILE = "claim-stages.json";

/** Read one recorded step, which owns exactly the stage its position names. */
function readStep(file: string, value: unknown, index: number): ClaimStageStep {
  const row = isRecord(value) ? value : {};
  const stage = CLAIM_STAGES[index];
  if (stage === undefined || row.stage !== stage || !isString(row.at) || !isString(row.evidence)) {
    throw new Error(
      `${file}: step ${index} must be {stage: "${CLAIM_STAGES[index] ?? "?"}", at, evidence} — claim stages advance one at a time from build-admissible`,
    );
  }
  return { stage, at: row.at, evidence: row.evidence };
}

/** Read recorded claim-stage evidence, or null when the tree records none. */
export function readClaimStages(adoptDir: string): ClaimStageEvidence | null {
  const file = join(adoptDir, CLAIM_STAGES_FILE);
  if (!existsSync(file)) return null;
  const parsed = parseJsonAs<{ slug?: unknown; steps?: unknown }>(readFileSync(file, "utf8"));
  if (!isString(parsed.slug) || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(`${file}: not claim-stage evidence ({slug, steps[...]})`);
  }
  return { slug: parsed.slug, steps: parsed.steps.map((value, index) => readStep(file, value, index)) };
}

/** The tree's current claim stage, or null when no claim-stage evidence exists. */
export function claimStage(adoptDir: string): ClaimStage | null {
  return readClaimStages(adoptDir)?.steps.at(-1)?.stage ?? null;
}

/** Append exactly the next claim stage. Every step sits at its own stage's position, so the count
 *  of recorded steps is the index of the one stage this tree may record next. */
export function advanceClaimStage(
  adoptDir: string,
  stage: ClaimStage,
  evidencePath: string,
  at: string = new Date().toISOString(),
  slug: string | null = null,
): ClaimStageEvidence {
  const claimStages = readClaimStages(adoptDir) ?? { slug: slug ?? basename(adoptDir), steps: [] };
  const expected = CLAIM_STAGES[claimStages.steps.length];
  if (stage !== expected) {
    throw new Error(
      `${adoptDir}: claim stages are at "${claimStages.steps.at(-1)?.stage ?? "no evidence"}" — the only admissible next claim stage is "${expected ?? "none: activated is terminal"}", never "${stage}"`,
    );
  }
  claimStages.steps.push({ stage, at, evidence: evidencePath });
  writeJsonFile(join(adoptDir, CLAIM_STAGES_FILE), claimStages);
  return claimStages;
}

/** Fold a measurement's verdicts into the claim stages it earned, stopping at the first one the
 *  measurement did not earn. A tree recording no claim stages earns none and is left untouched. */
export function recordMeasurement(
  adoptDir: string,
  outcome: { runId: string; measured: boolean; claimCreated: boolean; ready: boolean },
  at?: string,
): ClaimStage | null {
  let evidence = readClaimStages(adoptDir);
  if (evidence === null) return null;
  const earnedStages: ReadonlyArray<readonly [ClaimStage, boolean]> = [
    ["measured", outcome.measured],
    ["claim-created", outcome.claimCreated],
    ["ready", outcome.ready],
  ];
  for (const [stage, earned] of earnedStages) {
    if (!earned) break;
    if (CLAIM_STAGES[evidence.steps.length] === stage) {
      evidence = advanceClaimStage(adoptDir, stage, outcome.runId, at);
    }
  }
  return evidence.steps.at(-1)?.stage ?? null;
}

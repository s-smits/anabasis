/**
 * Claim stages: adoption starts the evidence at build-admissible, stages advance one at a time and
 * never regress, activation is terminal, and a tree recording none states nothing and writes nothing.
 */
import { afterAll, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import {
  CLAIM_STAGES_FILE,
  type ClaimStage,
  advanceClaimStage,
  claimStage,
  readClaimStages,
  recordMeasurement,
} from "../src/run/claim-stages.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

const adoptDir = (): string => scratchDir("ana-claim-stages-");

function record(dir: string, ...recorded: ClaimStage[]): void {
  writeFileSync(
    join(dir, CLAIM_STAGES_FILE),
    JSON.stringify({ slug: "x", steps: recorded.map((stage) => ({ stage, at: "t", evidence: "e" })) }),
  );
}

it("a tree recording no claim stages states nothing and admits only build-admissible", () => {
  const dir = adoptDir();
  expect(claimStage(dir)).toBeNull();
  expect(() => advanceClaimStage(dir, "measured", "r1")).toThrow(
    /only admissible next claim stage is "build-admissible"/,
  );
  expect(advanceClaimStage(dir, "build-admissible", "conformance.json").steps).toEqual([
    { stage: "build-admissible", at: expect.any(String), evidence: "conformance.json" },
  ]);
});

it.each<[string, ClaimStage[], RegExp]>([
  ["no steps", [], /not claim-stage evidence/],
  ["a first step that is not build-admissible", ["ready"], /one at a time from build-admissible/],
  [
    "a step that repeats its predecessor",
    ["build-admissible", "measured", "measured"],
    /step 2 must be \{stage: "claim-created"/,
  ],
])("refuses recorded evidence with %s", (_, stages, message) => {
  const dir = adoptDir();
  record(dir, ...stages);
  expect(() => claimStage(dir)).toThrow(message);
});

it("advances one stage at a time: skipping, regressing and re-activating all refuse", () => {
  const dir = adoptDir();
  advanceClaimStage(dir, "build-admissible", "adopt");
  expect(() => advanceClaimStage(dir, "ready", "r1")).toThrow(
    /next claim stage is "measured", never "ready"/,
  );
  advanceClaimStage(dir, "measured", "r1");
  expect(() => advanceClaimStage(dir, "build-admissible", "again")).toThrow(
    /next claim stage is "claim-created"/,
  );
  for (const stage of ["claim-created", "ready", "activated"] as const) advanceClaimStage(dir, stage, "r1");
  expect(claimStage(dir)).toBe("activated");
  expect(() => advanceClaimStage(dir, "activated", "twice")).toThrow(/activated is terminal/);
});

it("folds a measurement into the stages it earned, stops at the first it did not, and never regresses", () => {
  const dir = adoptDir();
  advanceClaimStage(dir, "build-admissible", "adopt");
  expect(recordMeasurement(dir, { runId: "r1", measured: true, claimCreated: false, ready: true })).toBe(
    "measured",
  );
  expect(recordMeasurement(dir, { runId: "r2", measured: true, claimCreated: true, ready: true })).toBe(
    "ready",
  );
  expect(recordMeasurement(dir, { runId: "r3", measured: false, claimCreated: false, ready: false })).toBe(
    "ready",
  );
  expect(readClaimStages(dir)?.steps.map((step) => [step.stage, step.evidence])).toEqual([
    ["build-admissible", "adopt"],
    ["measured", "r1"],
    ["claim-created", "r2"],
    ["ready", "r2"],
  ]);
});

it("records nothing for a tree without claim stages", () => {
  const dir = adoptDir();
  expect(recordMeasurement(dir, { runId: "r1", measured: true, claimCreated: true, ready: true })).toBeNull();
  expect(existsSync(join(dir, CLAIM_STAGES_FILE))).toBe(false);
});

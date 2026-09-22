/**
 * Claim stages: adoption starts the evidence at build-admissible, stages advance one at a time and
 * never regress, activation is terminal, and a tree recording none states nothing and writes nothing.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, expect, it } from "bun:test";
import {
  type ClaimStage,
  advanceClaimStage,
  claimStage,
  readClaimStages,
  recordMeasurement,
} from "../src/run/claim-stages.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function adoptDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-claim-stages-"));
  scratch.push(dir);
  return dir;
}

function record(dir: string, ...recorded: ClaimStage[]): void {
  writeFileSync(
    join(dir, "claim-stages.json"),
    JSON.stringify({ slug: "x", steps: recorded.map((stage) => ({ stage, at: "t", evidence: "e" })) }),
  );
}

it("a tree recording no claim stages states nothing and admits only build-admissible", () => {
  const dir = adoptDir();
  expect(readClaimStages(dir)).toBeNull();
  expect(claimStage(dir)).toBeNull();
  expect(() => advanceClaimStage(dir, "measured", "r1")).toThrow(
    /only admissible next claim stage is "build-admissible"/,
  );
  expect(
    advanceClaimStage(dir, "build-admissible", "conformance.json", "2026-07-26T00:00:00Z").steps,
  ).toEqual([{ stage: "build-admissible", at: "2026-07-26T00:00:00Z", evidence: "conformance.json" }]);
});

it("refuses evidence with no steps and evidence whose step is not the stage its position names", () => {
  const dir = adoptDir();
  record(dir);
  expect(() => claimStage(dir)).toThrow(/not claim-stage evidence/);
  record(dir, "ready");
  expect(() => claimStage(dir)).toThrow(/one at a time from build-admissible/);
  record(dir, "build-admissible", "measured", "measured");
  expect(() => claimStage(dir)).toThrow(/step 2 must be \{stage: "claim-created"/);
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

it("folds one measurement into the stages it earned and stops at the first it did not", () => {
  const dir = adoptDir();
  advanceClaimStage(dir, "build-admissible", "adopt");
  expect(recordMeasurement(dir, { runId: "r1", measured: true, claimCreated: false, ready: false })).toBe(
    "measured",
  );
  expect(recordMeasurement(dir, { runId: "r2", measured: true, claimCreated: true, ready: true })).toBe(
    "ready",
  );
  expect(readClaimStages(dir)?.steps).toEqual([
    { stage: "build-admissible", at: expect.any(String), evidence: "adopt" },
    { stage: "measured", at: expect.any(String), evidence: "r1" },
    { stage: "claim-created", at: expect.any(String), evidence: "r2" },
    { stage: "ready", at: expect.any(String), evidence: "r2" },
  ]);
});

it("never regresses a measured tree and records nothing for a tree without claim stages", () => {
  const dir = adoptDir();
  record(dir, "build-admissible", "measured", "claim-created", "ready");
  expect(recordMeasurement(dir, { runId: "r9", measured: false, claimCreated: false, ready: false })).toBe(
    "ready",
  );
  expect(recordMeasurement(dir, { runId: "r9", measured: true, claimCreated: true, ready: true })).toBe(
    "ready",
  );
  const empty = adoptDir();
  expect(
    recordMeasurement(empty, { runId: "r1", measured: true, claimCreated: true, ready: true }),
  ).toBeNull();
  expect(existsSync(join(empty, "claim-stages.json"))).toBe(false);
});

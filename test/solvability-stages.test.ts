/**
 * Remembered F2 stages: a census reuses a reference solve only when its key — every byte and
 * constant the stage read — still matches, and never remembers one the wall cut.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch } from "./helpers/scratch.ts";
import { createSolvabilityStageCache } from "../src/correctness-bundle/solvability-stages.ts";
import type { VerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { required } from "./helpers/doubles.ts";
import {
  GOOD_VERIFIER,
  countingHost,
  evaluateLog,
  keys,
  probe,
  revise,
  sources,
  specimen,
  statuses,
  testLifetime,
} from "./helpers/solvability-specimen.ts";
import { familyFixture } from "./helpers/solvability-families.ts";

/** Counts reference-solve children through the protected lifetime every child must lease. */
function countingLifetime() {
  const lifetime = testLifetime();
  const launches = { reference: 0 };
  const counted: VerifierLifetime = {
    begin: (input) => {
      if (input.role === "reference") launches.reference += 1;
      return lifetime.begin(input);
    },
    assertUsable: () => lifetime.assertUsable(),
    pendingReceipts: () => lifetime.pendingReceipts(),
    close: () => lifetime.close(),
    recover: () => lifetime.recover(),
  };
  return { lifetime: counted, launches };
}

afterAll(cleanupScratch);

describe("remembered F2 stages", () => {
  it("reuses every reference solve across an evaluator-only change", async () => {
    const stages = createSolvabilityStageCache();
    const counted = countingLifetime();
    const fixture = familyFixture({ answers: ["A", "B"] });
    const first = await probe({ verifierLifetime: counted.lifetime })(fixture, stages);

    expect(statuses(first)).toEqual(["passed", "passed", "passed"]);
    expect(sources(first)).toEqual(["executed", "executed", "executed"]);
    expect(counted.launches.reference).toBe(3);

    const revised = revise(
      fixture,
      "evaluator.ts",
      "return request.artifact?.answer === expected;",
      "return [expected].indexOf(request.artifact?.answer) >= 0;",
    );
    const log = evaluateLog();
    const second = await probe({
      verifierLifetime: counted.lifetime,
      createVerifier: () => countingHost(log),
    })(revised, stages);

    expect(second.evidence?.bundleSnapshotId).not.toBe(first.evidence?.bundleSnapshotId);
    expect(counted.launches.reference).toBe(3);
    expect(statuses(second)).toEqual(["passed", "passed", "passed"]);
    expect(second.evidence?.cases.map((row) => row.referenceSolve)).toEqual(
      first.evidence?.cases.map((row) => ({
        key: required(row.referenceSolve, "reference-solve receipt").key,
        source: "reused" as const,
        producedUnder: required(first.evidence, "first evidence").bundleSnapshotId,
      })),
    );
    // The submission path and the evaluation still ran on the changed snapshot.
    expect(second.evidence?.cases.every((row) => row.submissionPath !== null)).toBe(true);
    expect(log.subjects.filter((subject) => subject.startsWith("self:"))).toHaveLength(3);
  });

  it("re-runs the reference solves when the reference changes its witnesses", async () => {
    const stages = createSolvabilityStageCache();
    const counted = countingLifetime();
    const fixture = revise(
      familyFixture({ answers: ["A", "B"] }),
      "evaluator.ts",
      "return request.artifact?.answer === expected;",
      "return String(request.artifact?.answer).toLowerCase() === String(expected).toLowerCase();",
    );
    const run = probe({ verifierLifetime: counted.lifetime });
    const first = await run(fixture, stages);
    expect(statuses(first)).toEqual(["passed", "passed", "passed"]);

    const revised = revise(
      fixture,
      "reference/index.ts",
      "answer: task.publicInput.expected,",
      "answer: task.publicInput.expected.toLowerCase(),",
    );
    const second = await run(revised, stages);

    expect(statuses(second)).toEqual(["passed", "passed", "passed"]);
    expect(counted.launches.reference).toBe(6);
    expect(sources(second)).toEqual(["executed", "executed", "executed"]);
    expect(keys(second)?.some((key) => keys(first)?.includes(key) === true)).toBe(false);
  });

  it("remembers no reference solve the wall cut", async () => {
    const stages = createSolvabilityStageCache();
    const counted = countingLifetime();
    const slow = specimen({
      verifier:
        "export async function solve() { while (true) {} }\n// CHECKS\nexport const checks = { answer: () => true };\n",
    });
    const cut = probe({ verifierLifetime: counted.lifetime, referenceSolveTimeoutMs: 750 });

    expect(statuses(await cut(slow, stages))).toEqual(["failed", "failed"]);
    expect(stages.referenceSolves.size).toBe(0);
    await cut(slow, stages);
    expect(counted.launches.reference).toBe(4);
  });

  it("misses the reference-solve memory when the wall constant changes", async () => {
    const stages = createSolvabilityStageCache();
    const counted = countingLifetime();
    const fixture = specimen({ verifier: GOOD_VERIFIER });
    const at = (referenceSolveTimeoutMs: number) =>
      probe({ verifierLifetime: counted.lifetime, referenceSolveTimeoutMs })(fixture, stages);

    const wide = await at(60_000);
    const narrow = await at(45_000);
    expect(sources(narrow)).toEqual(["executed", "executed"]);
    expect(keys(narrow)?.some((key) => keys(wide)?.includes(key) === true)).toBe(false);
    expect(counted.launches.reference).toBe(4);

    const again = await at(60_000);
    expect(sources(again)).toEqual(["reused", "reused"]);
    expect(keys(again)).toEqual(keys(wide));
    expect(counted.launches.reference).toBe(4);
  });
});

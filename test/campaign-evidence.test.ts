import { describe, expect, it } from "bun:test";
import type { FeedbackOwner, IterationEvidence } from "../src/author/campaign-types.ts";
import { decorateIterationEvidence } from "../src/run/campaign-evidence.ts";
import { SOURCE_IDENTITY } from "../src/run/source-identity.ts";

const workspaceChange = {
  baseCommit: "a".repeat(40),
  commit: "b".repeat(40),
  changedPaths: ["agent/index.ts"],
  deletedPaths: [],
};

function undecoratedEvidence(): IterationEvidence {
  return {
    ordinal: 1,
    dir: "01-example",
    outcome: "build-failed",
    stage: "brief",
    focusOwner: null,
    attempts: { builder: 1 },
    findingsHash: null,
    fingerprint: null,
    feedback: [],
  };
}

function decorate(first: boolean, hasResumedCarry: boolean, repairOwner: FeedbackOwner | null) {
  const evidence = undecoratedEvidence();
  const before = structuredClone(evidence);
  const decorated = decorateIterationEvidence(evidence, {
    first,
    hasResumedCarry,
    repairOwner,
    workspaceChange,
    declaredDiagnosis: { kind: "rebuild-advice", digest: "diagnosis-digest" },
  });
  expect(evidence).toEqual(before);
  expect(decorated).not.toBe(evidence);
  expect(decorated).toMatchObject({ source: SOURCE_IDENTITY, repairOwner, workspaceChange });
  expect(decorated).not.toHaveProperty("consumedEvidenceDigests");
  expect(decorated).not.toHaveProperty("admissionLineage");
  return decorated;
}

describe("iteration evidence decoration", () => {
  const CARRY = { kind: "in-campaign-carry", digest: null } as const;
  it.each([
    [
      "a fresh first iteration uses the declared diagnosis",
      true,
      false,
      "brief",
      { kind: "rebuild-advice", digest: "diagnosis-digest" },
    ],
    ["a resumed first iteration uses carried provenance", true, true, "brief", CARRY],
    ["a later iteration without an owner uses carried provenance", false, false, null, CARRY],
    ["a later routed iteration uses carried provenance", false, false, "correctness-model", CARRY],
  ] as const)("%s", (_title, first, resumed, owner, diagnosisInput) => {
    expect(decorate(first, resumed, owner).diagnosisInput).toEqual(diagnosisInput);
  });
});

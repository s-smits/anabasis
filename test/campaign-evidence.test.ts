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
  it("uses the declared diagnosis on a fresh first iteration", () => {
    expect(decorate(true, false, "brief").diagnosisInput).toEqual({
      kind: "rebuild-advice",
      digest: "diagnosis-digest",
    });
  });

  it("uses carried provenance on a resumed first iteration", () => {
    expect(decorate(true, true, "brief").diagnosisInput).toEqual({
      kind: "in-campaign-carry",
      digest: null,
    });
  });

  it("uses carried provenance on a later iteration without an owner", () => {
    expect(decorate(false, false, null).diagnosisInput).toEqual({
      kind: "in-campaign-carry",
      digest: null,
    });
  });

  it("uses carried provenance on a later routed iteration", () => {
    expect(decorate(false, false, "correctness-model").diagnosisInput).toEqual({
      kind: "in-campaign-carry",
      digest: null,
    });
  });
});

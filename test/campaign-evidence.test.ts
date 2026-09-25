import { describe, expect, it } from "bun:test";
import type { IterationEvidence } from "../src/author/campaign-types.ts";
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
    outcome: "gates-blocked",
    focusOwner: null,
    attempts: { builder: 1 },
    findingsHash: null,
    fingerprint: null,
    feedback: [],
  };
}

function decorate(first: boolean, hasResumedCarry: boolean) {
  const evidence = undecoratedEvidence();
  const before = structuredClone(evidence);
  const decorated = decorateIterationEvidence(evidence, {
    first,
    hasResumedCarry,
    workspaceChange,
    declaredDiagnosis: { kind: "rebuild-advice", digest: "diagnosis-digest" },
  });
  expect(evidence).toEqual(before);
  expect(decorated).not.toBe(evidence);
  expect(decorated).toMatchObject({ source: SOURCE_IDENTITY, workspaceChange });
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
      { kind: "rebuild-advice", digest: "diagnosis-digest" },
    ],
    ["a resumed first iteration uses carried provenance", true, true, CARRY],
    ["a later iteration uses carried provenance", false, false, CARRY],
  ] as const)("%s", (_title, first, resumed, diagnosisInput) => {
    expect(decorate(first, resumed).diagnosisInput).toEqual(diagnosisInput);
  });
});

/**
 * The representation the submission path must express: a truth-correct reference artifact that the
 * generated writer cannot produce, or that the compiled public schema rejects, is a defect of the
 * bundle's representation contract rather than of the solve.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch } from "./helpers/scratch.ts";
import {
  type BuiltStarter,
  type BuiltStarterNonResult,
  type GeneratedToolWorkerEvidence,
} from "../src/solve/built-starter.ts";
import { double } from "./helpers/doubles.ts";
import {
  GOOD_VERIFIER,
  type StarterFactory,
  check,
  codes,
  createSolvabilityStarter,
  failure,
  solving,
  specimen,
  statuses,
  witness,
} from "./helpers/solvability-specimen.ts";

/** A worker that never answered its handshake: the starter carries the host's non-result and
 *  nothing else, and the submission path reads exactly those two fields before refusing. */
function starterThatNeverOpened(preparationNonResult: BuiltStarterNonResult): StarterFactory {
  return () => Promise.resolve(double<BuiltStarter>({ tools: [], preparationNonResult }));
}

/** The ordinary in-process starter, closing with a scripted termination instead of a normal one. */
function starterClosingWith(termination: GeneratedToolWorkerEvidence["termination"]): StarterFactory {
  return async (options) => ({
    ...(await createSolvabilityStarter(options)),
    close: () => Promise.resolve(double<GeneratedToolWorkerEvidence>({ termination })),
  });
}

afterAll(cleanupScratch);

describe("the representation the submission path must express", () => {
  it.concurrent("derives the whole-artifact writer contract when generated code declares different roots", async () => {
    // Generated code declares `other` and an incremental field writer. The compiled public schema
    // still owns the live write_answer parameters and exact DraftStore materialisation.
    const result = await witness(
      specimen({ verifier: GOOD_VERIFIER, writerRoots: ["other"], fieldWriter: true }),
    );

    expect(result.findings).toEqual([]);
    expect(result.evidence?.cases).toMatchObject([
      {
        status: "passed",
        submissionPath: { writerCalls: [{ name: "write_answer", callId: "f2-writer-1" }] },
      },
      { status: "passed" },
    ]);
  });

  it.concurrent("holds a truth-correct reference artifact to the compiled public submission schema", async () => {
    // The accept corpus certifies an empty object, so the compiled submission schema at $.design is
    // an empty closed object. The reference returns a populated design that evaluates true and
    // passes the root check, yet no solver could ever submit it.
    const fixture = specimen({
      verifier: solving('return { answer: task.publicInput.expected, design: { part: "cpu" } };').replace(
        "export const checks = { answer:",
        "export const checks = { design: () => true, answer:",
      ),
      schema: [
        { name: "answer", "shape": "string" },
        { name: "design", "shape": "object" },
      ],
      // The design root needs a declared reader for validateBrief, and its check declares
      // required hidden data, so each task also carries that operand.
      extraChecks: [check({ id: "design", roots: ["$.design"] })],
      extraHidden: [{ checkId: "design", expectation: { part: "cpu" } }],
      acceptArtifacts: [{ answer: "A", design: {} }],
    });
    const result = await witness(fixture);

    expect(codes(result)).toContain("solvability-witness-failed");
    expect(statuses(result)).toEqual(["failed", "failed"]);
    expect(failure(result)).toContain("reference artifact violates the compiled public submission schema");
    expect(failure(result)).toContain("$.design");
  });

  it.concurrent("types a public-valid nullable branch omitted by the writer schema as a representation defect", async () => {
    const fixture = specimen({
      verifier: GOOD_VERIFIER,
      schema: [{ name: "answer", "shape": "string or null" }],
      answers: [null, "B"],
      acceptArtifacts: [{ answer: null }, { answer: "B" }],
      writerKinds: { answer: "string" },
    });
    const result = await witness(fixture);

    expect(result.evidence?.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "ta",
          artifact: { answer: null },
          status: "failed",
          failureKind: "representation-defect",
          submissionPath: null,
        }),
        expect.objectContaining({ taskId: "tb", status: "passed" }),
      ]),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "solvability-representation-defect",
        disclosure: expect.objectContaining({ classification: "generated-toolset-contract" }),
      }),
    );
  });

  const HOST_NON_RESULT = {
    status: "non-result" as const,
    row: { nonResultKind: "submission-path-host", failureKind: null },
    finding: {
      code: "solvability-submission-path-host-non-result",
      classification: "submission-path-host",
    },
  };
  // A worker wall is the host's, whatever the bytes; a worker that answered its handshake and then
  // broke the protocol is the product's representation, whatever the host.
  it.concurrent.each([
    {
      worker: "timing out before its ready handshake",
      starter: () =>
        starterThatNeverOpened({
          kind: "runtime",
          message: "generated-tool worker timed out before its ready handshake",
          deadline: true,
        }),
      expected: HOST_NON_RESULT,
    },
    {
      worker: "timing out during close",
      starter: () =>
        starterClosingWith({
          status: "non-result",
          kind: "runtime",
          message: "generated-tool worker did not close within 1000ms",
          deadline: true,
        }),
      expected: HOST_NON_RESULT,
    },
    {
      worker: "closing with pending requests after its handshake",
      starter: () =>
        starterClosingWith({
          status: "non-result",
          kind: "protocol",
          message: "generated-tool worker closed with pending requests",
        }),
      expected: {
        status: "failed" as const,
        row: { nonResultKind: null, failureKind: "representation-defect" },
        finding: {
          code: "solvability-representation-defect",
          classification: "generated-toolset-contract",
        },
      },
    },
  ])("classifies a submission worker $worker", async ({ starter, expected }) => {
    const result = await witness(specimen({ verifier: GOOD_VERIFIER }), {
      createSolvabilityStarter: starter(),
    });

    expect(statuses(result)).toEqual([expected.status, expected.status]);
    expect(result.evidence?.cases).toMatchObject([expected.row, expected.row]);
    const { classification, ...finding } = expected.finding;
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ...finding, disclosure: expect.objectContaining({ classification }) }),
    );
  });
});

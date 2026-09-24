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

// ---------------------------------------------------------------------------------------------
// The specimen: one description of a whole candidate.

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

  it.concurrent("holds a truth-correct reference artifact to the compiled public submission schema (run 81)", async () => {
    // Run 81's L3 shape: the accept corpus certifies an empty object, so the compiled submission
    // schema at $.design is an empty closed object. The reference returns a populated design that
    // evaluates true and passes the root check, yet no solver could ever submit it.
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
        owner: "bh-representation",
        disclosure: expect.objectContaining({ classification: "generated-toolset-contract" }),
      }),
    );
  });

  it.concurrent.each([
    {
      wall: "ready",
      starter: () =>
        starterThatNeverOpened({
          kind: "runtime",
          message: "generated-tool worker timed out before its ready handshake",
          deadline: true,
        }),
    },
    {
      wall: "close",
      starter: () =>
        starterClosingWith({
          status: "non-result",
          kind: "runtime",
          message: "generated-tool worker did not close within 1000ms",
          deadline: true,
        }),
    },
  ])("classifies a submission worker $wall timeout as an environment non-result", async ({ starter }) => {
    // Run 51 round 2: a worker timed out at startup and another during close, while the same
    // adopted bytes passed 25/25 before and after. Both were classified representation defects.
    const result = await witness(specimen({ verifier: GOOD_VERIFIER }), {
      createSolvabilityStarter: starter(),
    });

    expect(statuses(result)).toEqual(["non-result", "non-result"]);
    expect(
      result.evidence?.cases.every(
        (row) =>
          row.nonResultKind === "submission-path-host" &&
          row.failureOwner === "environment" &&
          row.failureKind === null,
      ),
    ).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "solvability-submission-path-host-non-result",
        owner: "environment",
        disclosure: expect.objectContaining({ classification: "submission-path-host" }),
      }),
    );
  });

  it.concurrent("keeps a worker that answered its handshake and then broke the protocol a representation defect", async () => {
    const result = await witness(specimen({ verifier: GOOD_VERIFIER }), {
      createSolvabilityStarter: starterClosingWith({
        status: "non-result",
        kind: "protocol",
        message: "generated-tool worker closed with pending requests",
      }),
    });

    expect(statuses(result)).toEqual(["failed", "failed"]);
    expect(
      result.evidence?.cases.every(
        (row) =>
          row.nonResultKind === null &&
          row.failureKind === "representation-defect" &&
          row.failureOwner === "product",
      ),
    ).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "solvability-representation-defect",
        owner: "bh-representation",
        disclosure: expect.objectContaining({ classification: "generated-toolset-contract" }),
      }),
    );
  });
});

/**
 * How each truth check's verdict is evidenced, and what the claim records about it.
 *
 * A declared check has to show two separate things before its verdicts can carry a claim. It must
 * have rejected something: a reject control that failed on exactly this check, which is the only
 * in-process evidence available, since no capability boundary exists inside the verifier. And, when
 * an installed tool decides it, that tool must have run on the specific verified case being scored.
 *
 * The claim then says which instrument actually ran. A declared kind is the author's statement
 * about that; the host's rows are the fact. The one way the rows can contradict an `external`
 * declaration without a digest is a program the check built inside its own cell and then ran —
 * the artifact compiled together with whatever the check supplied, which no inventory hashed at
 * submit. So every coverage row counts those launches beside the declared tool's own, and the
 * claim records them rather than refusing: a reader of an `external` row sees whether its verdict
 * also passed through a built program.
 */
import { describe, expect, it } from "bun:test";
import type { ScoredCase } from "../src/claim/claim-evidence.ts";
import { NO_EXTERNAL_EXECUTION, type VerifierExecutionEvidence } from "../src/truth/grounding.ts";
import {
  AUTHORED_C1,
  GREEN_SCORE,
  QISKIT_TOOLS,
  RESONANCE,
  clauseNames,
  createClaim,
  discriminatedChecks,
  greenEvidence,
  qiskitExecution,
} from "./helpers/claim-evidence.ts";

/** GREEN_SCORE with the external check applied by every case. */
const resonanceEverywhere: ScoredCase[] = GREEN_SCORE.map((row) => ({ ...row, checkIds: ["resonance"] }));

/** GREEN_SCORE with the external check applied by t1 alone. */
const resonanceOnT1: ScoredCase[] = GREEN_SCORE.map((row) =>
  row.caseId === "t1" ? { ...row, checkIds: ["c1", "resonance"] } : row,
);

/** A battery row: one completed run of `adapterId` for `checkId` on `subjectId`. */
function ran(subjectId: string, checkId: string, adapterId: string) {
  return { phase: "battery" as const, subjectId, attempt: 1, checkId, adapterId };
}

/** The recorded shape of a behaviour check declared external over an installed compiler: each case
 *  compiles the artifact with the check's own driver and then runs the program that build left in
 *  the cell. */
const BEHAVIOUR = {
  checkId: "display-composition",
  grounding: { kind: "external-verifier", adapterId: "cc", assertion: "the display shows the reading" },
} as const;

const CC_TOOLS: VerifierExecutionEvidence["tools"] = {
  cc: { digest: "c".repeat(64), source: "host", kind: "binary", interpreter: null },
};

/** Every GREEN_SCORE case applies the behaviour check. */
const behaviourEverywhere: ScoredCase[] = GREEN_SCORE.map((row) => ({
  ...row,
  checkIds: ["display-composition"],
}));

function behaviourExecution(executed: VerifierExecutionEvidence["executed"]): VerifierExecutionEvidence {
  return { executed, verifierEnvironmentHash: "e".repeat(64), tools: CC_TOOLS };
}

describe("every declared check must have rejected something", () => {
  it("blocks an authored check no reject control ever failed on", () => {
    // The honest runtime evidence for an in-process check is behavioural: import presence and
    // source shape prove nothing about whether the check can reject an invalid artifact.
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [AUTHORED_C1], execution: NO_EXTERNAL_EXECUTION },
        discrimination: { claimable: true, findings: [], attributedCheckIds: {} },
      }),
    );
    expect(clauseNames(result)).toContain("intrinsic-grounding-uncovered");
    if (!result.ok) {
      expect(result.clauses.find((c) => c.clause === "intrinsic-grounding-uncovered")?.repairable).toBe(
        false,
      );
    }
  });

  it("requires attribution on the exact checkId, not an aggregate over its neighbours", () => {
    const covered = createClaim(
      greenEvidence({
        discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 2, other: 5 } },
      }),
    );
    expect(covered.ok).toBe(true);
  });

  it("blocks a fully executed external check that no reject ever made fail, under its own clause", () => {
    // Running proves execution alone: both measured firmware runs shipped an engine session in exactly
    // this state.
    const executed = qiskitExecution(["t1"]);
    const uncovered = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: executed },
        discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 1 } },
      }),
    );
    expect(clauseNames(uncovered)).toContain("external-grounding-uncovered");
    expect(clauseNames(uncovered)).not.toContain("intrinsic-grounding-uncovered");
    if (!uncovered.ok) {
      expect(uncovered.clauses.find((c) => c.clause === "external-grounding-uncovered")?.repairable).toBe(
        false,
      );
    }
    // One attributing reject is the whole difference.
    const covered = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: executed },
        discrimination: discriminatedChecks("resonance"),
      }),
    );
    expect(covered.ok).toBe(true);
  });

  it("blocks when no check names where its evidence comes from", () => {
    expect(clauseNames(createClaim(greenEvidence({ grounding: null })))).toContain("grounding-missing");
    expect(
      clauseNames(
        createClaim(greenEvidence({ grounding: { declared: [], execution: NO_EXTERNAL_EXECUTION } })),
      ),
    ).toContain("grounding-missing");
  });

  it("requires an authored check to have both rejected and fired", () => {
    const evidence = greenEvidence({
      grounding: { declared: [AUTHORED_C1], execution: NO_EXTERNAL_EXECUTION },
    });
    const covered = createClaim(evidence);
    expect(covered.ok).toBe(true);
    if (covered.ok) {
      expect(covered.statement.groundings).toEqual([{ checkId: "c1", kind: "authored", adapterId: null }]);
    }
    const unrejected = createClaim({
      ...evidence,
      discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 0 } },
    });
    expect(clauseNames(unrejected)).toContain("intrinsic-grounding-uncovered");
    const unfired = createClaim({
      ...evidence,
      truthCheckFiring: {
        firedByCheck: { c1: 0 },
        executedByCheck: {},
        blockingByCheck: {},
        applicableByCheck: { c1: 4 },
        verifierVerifiedCount: 4,
      },
    });
    expect(clauseNames(unfired)).toContain("TRUTH_CHECK_NEVER_FIRED");
  });
});

describe("a tool's run binds to one case, one check and one adapter", () => {
  it("requires a run for each verified case the external check applies to", () => {
    // Only t1's evaluation consumed a tool run; t2 and t3 passed without one. t4 failed on c1,
    // whose evidence was complete, so a run it skipped could only have withheld a pass.
    const partial = createClaim(
      greenEvidence({ grounding: { declared: [RESONANCE], execution: qiskitExecution(["t1"]) } }),
      resonanceEverywhere,
    );
    const uncovered = partial.ok
      ? []
      : partial.clauses.filter((c) => c.clause === "external-grounding-case-uncovered");
    expect(uncovered).toHaveLength(2);
    expect(uncovered.map((c) => c.detail).join("\n")).toContain('"t2"');

    // A control-only run satisfies any run-level reading and grounds zero verified cases.
    const controlOnly = createClaim(
      greenEvidence({ grounding: { declared: [RESONANCE], execution: qiskitExecution(["reject-7"]) } }),
      resonanceEverywhere,
    );
    expect(clauseNames(controlOnly).filter((c) => c === "external-grounding-case-uncovered")).toHaveLength(3);

    // One run per verified case clears the gate.
    const covered = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["t1", "t2", "t3", "t4"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      resonanceEverywhere,
    );
    expect(covered.ok).toBe(true);
  });

  it("requires no run over bytes the verifier never received", () => {
    // An unaccepted attempt stays a scored difficulty failure, but has no accepted artifact an
    // adapter could have executed. The three graded cases still need their exact bindings.
    const oneUnaccepted = resonanceEverywhere.map((row) =>
      row.caseId === "t4" ? { ...row, truthVerified: false } : row,
    );
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["t1", "t2", "t3"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      oneUnaccepted,
    );
    expect(result.ok).toBe(true);
  });

  it("does not join a run recorded under a different check or a different adapter", () => {
    const discriminated = { claimable: true, findings: [], attributedCheckIds: { resonance: 2 } };
    const base = { verifierEnvironmentHash: "e".repeat(64), tools: QISKIT_TOOLS };
    // Same adapter, wrong check: adapter-name membership was the P0 insufficiency.
    const wrongCheck = createClaim(
      greenEvidence({
        grounding: {
          declared: [RESONANCE],
          execution: { ...base, executed: [ran("t1", "some-other-check", "qiskit-adapter")] },
        },
        discrimination: discriminatedChecks("resonance"),
      }),
    );
    expect(wrongCheck.ok).toBe(true);
    if (wrongCheck.ok) expect(wrongCheck.statement.externalCheckCoverage).toEqual([]);

    // Right check, neighbouring adapter: the declared grounding names qiskit-adapter, so another
    // tool's run vouches for nothing here.
    const wrongAdapter = createClaim(
      greenEvidence({
        grounding: {
          declared: [RESONANCE],
          execution: { ...base, executed: [ran("t1", "resonance", "some-other-adapter")] },
        },
        discrimination: discriminated,
      }),
      resonanceOnT1,
    );
    expect(clauseNames(wrongAdapter)).toContain("external-grounding-case-uncovered");

    const ownAdapter = createClaim(
      greenEvidence({
        grounding: {
          declared: [RESONANCE],
          execution: { ...base, executed: [ran("t1", "resonance", "qiskit-adapter")] },
        },
        discrimination: discriminated,
      }),
      resonanceOnT1,
    );
    expect(ownAdapter.ok).toBe(true);
  });

  it("requires every declared tool of one check on every one of its verified cases", () => {
    const qiskit = qiskitExecution(resonanceEverywhere.map((row) => row.caseId));
    const execution: VerifierExecutionEvidence = {
      ...qiskit,
      tools: {
        ...qiskit.tools,
        "statevector-audit": { digest: "a".repeat(64), source: "host", kind: "binary", interpreter: null },
      },
      executed: [
        ...qiskit.executed,
        ...qiskit.executed.map((row) => ({ ...row, adapterId: "statevector-audit" })),
      ],
    };
    const evidence = greenEvidence({
      grounding: {
        declared: [
          RESONANCE,
          { checkId: "resonance", grounding: { ...RESONANCE.grounding, adapterId: "statevector-audit" } },
        ],
        execution,
      },
      discrimination: discriminatedChecks("resonance"),
    });
    const covered = createClaim(evidence, resonanceEverywhere);
    expect(covered.ok).toBe(true);
    if (covered.ok) {
      expect(covered.statement.externalCheckCoverage).toEqual(
        ["qiskit-adapter", "statevector-audit"].map((toolId) => ({
          checkId: "resonance",
          toolId,
          attestedLaunches: 4,
          cellProgramLaunches: 0,
          rejects: 2,
          kind: "external",
        })),
      );
    }
    // Dropping the second tool on one case, and relabelling it on that case, both leave the gap.
    for (const replacement of [null, "foreign-adapter"]) {
      const hostile = createClaim(
        {
          ...evidence,
          grounding: {
            declared: evidence.grounding?.declared ?? [],
            execution: {
              ...execution,
              executed: execution.executed.flatMap((row) => {
                if (row.subjectId !== "t2" || row.adapterId !== "statevector-audit") return [row];
                return replacement === null ? [] : [{ ...row, adapterId: replacement }];
              }),
            },
          },
        },
        resonanceEverywhere,
      );
      expect(hostile.ok).toBe(false);
      if (hostile.ok) continue;
      const gaps = hostile.clauses.filter((row) => row.clause === "external-grounding-case-uncovered");
      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.detail).toContain('"t2"');
      expect(gaps[0]?.detail).toContain('"statevector-audit"');
    }
  });

  it("holds an authored check to its required tools while keeping its authored kind", () => {
    const execution = qiskitExecution(GREEN_SCORE.map((row) => row.caseId));
    execution.executed = execution.executed.map((row) => ({ ...row, checkId: "c1" }));
    const evidence = greenEvidence({
      grounding: { declared: [{ ...AUTHORED_C1, requiredToolIds: ["qiskit-adapter"] }], execution },
    });
    const covered = createClaim(evidence);
    expect(covered.ok).toBe(true);
    if (covered.ok) {
      // An interpreter running the Builder's own algorithm stays authored computation.
      expect(covered.statement.groundings).toEqual([
        { checkId: "c1", kind: "authored", adapterId: null, requiredToolIds: ["qiskit-adapter"] },
      ]);
      expect(covered.statement.externalCheckCoverage).toEqual([
        {
          checkId: "c1",
          toolId: "qiskit-adapter",
          attestedLaunches: 4,
          cellProgramLaunches: 0,
          rejects: 1,
          kind: "authored",
        },
      ]);
    }
    execution.executed = execution.executed.filter((row) => row.subjectId !== "t2");
    expect(clauseNames(createClaim(evidence))).toContain("external-grounding-case-uncovered");
  });
});

describe("the claim records which instrument ran, not only which one was declared", () => {
  it("counts the programs an external check built and ran in its cell, and still claims", () => {
    // The recorded shape: every behaviour check declared external over `cc` compiled the artifact
    // with a driver the Builder published, then ran the result. `cc` alone is what the inventory
    // hashed; the verdict came from the built program.
    const executed = GREEN_SCORE.flatMap((row) => [
      ran(row.caseId, "display-composition", "cc"),
      ran(row.caseId, "display-composition", "cell:app"),
    ]);
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [AUTHORED_C1, BEHAVIOUR], execution: behaviourExecution(executed) },
        discrimination: discriminatedChecks("display-composition"),
      }),
      behaviourEverywhere,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statement.externalCheckCoverage).toEqual([
      {
        checkId: "display-composition",
        toolId: "cc",
        attestedLaunches: 4,
        cellProgramLaunches: 4,
        rejects: 2,
        kind: "external",
      },
    ]);
    // The built program is no inventory tool, so it never enters the hashed tool list.
    expect(result.statement.verifierTools.map((tool) => tool.toolId)).toEqual(["cc"]);
  });

  it("counts a built program only on the check that ran it and only on a verified case", () => {
    // A program run for a neighbouring check, on a control, or on a case with no verdict grounds
    // nothing this row reports.
    const executed = [
      ...GREEN_SCORE.map((row) => ran(row.caseId, "display-composition", "cc")),
      ran("t1", "another-check", "cell:app"),
      ran("reject-7", "display-composition", "cell:app"),
      ran("t4", "display-composition", "cell:app"),
    ];
    const t4Unverified = behaviourEverywhere.map((row) =>
      row.caseId === "t4" ? { ...row, truthVerified: false } : row,
    );
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [AUTHORED_C1, BEHAVIOUR], execution: behaviourExecution(executed) },
        discrimination: discriminatedChecks("display-composition"),
      }),
      t4Unverified,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statement.externalCheckCoverage).toEqual([
      {
        checkId: "display-composition",
        toolId: "cc",
        attestedLaunches: 3,
        cellProgramLaunches: 0,
        rejects: 2,
        kind: "external",
      },
    ]);
  });

  it("counts an authored check's built programs the same way, without changing its kind", () => {
    // An authored check that compiles its own test with an installed compiler and runs it is the
    // honest declaration of the same computation: the count is recorded and the kind stays.
    const executed = GREEN_SCORE.flatMap((row) => [
      ran(row.caseId, "c1", "cc"),
      ran(row.caseId, "c1", "cell:firmware-test"),
    ]);
    const result = createClaim(
      greenEvidence({
        grounding: {
          declared: [{ ...AUTHORED_C1, requiredToolIds: ["cc"] }],
          execution: behaviourExecution(executed),
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statement.externalCheckCoverage).toEqual([
      {
        checkId: "c1",
        toolId: "cc",
        attestedLaunches: 4,
        cellProgramLaunches: 4,
        rejects: 1,
        kind: "authored",
      },
    ]);
  });
});

describe("the tools that ran are identified by what the host hashed", () => {
  it("blocks executed runs with no environment fingerprint, and stays silent when nothing ran", () => {
    // A tool reports the same version after its binary changes, so two runs on different tool
    // versions must not share one identity.
    const unfingerprinted = createClaim(
      greenEvidence({
        grounding: {
          declared: [RESONANCE],
          execution: { ...qiskitExecution(["t1"]), verifierEnvironmentHash: null, tools: {} },
        },
      }),
    );
    expect(clauseNames(unfingerprinted)).toContain("grounding-environment-unfingerprinted");
    // Nothing executed, so there is no tool to fingerprint: an in-process check still claims.
    const nothingRan = createClaim(greenEvidence());
    expect(clauseNames(nothingRan)).not.toContain("grounding-environment-unfingerprinted");
    expect(nothingRan.ok).toBe(true);
  });

  it("names the adapter that executed each external check on the statement, and nothing else", () => {
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["t1"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statement.groundings).toEqual([
      { checkId: "resonance", kind: "external-verifier", adapterId: "qiskit-adapter" },
    ]);
    expect(result.statement.verifierEnvironmentHash).toBe("e".repeat(64));
    // Every check is authored or external, so there is no third kind with prose of its own to
    // carry: the statement has no exception list.
    expect(Object.hasOwn(result.statement, "groundingExceptions")).toBe(false);
  });
});

describe("a coverage row exists only where a verified case gave the tool an opportunity", () => {
  it("records the launches a verified case attested, and refuses a control-only run", () => {
    const onVerifiedCase = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["t1"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      resonanceOnT1,
    );
    expect(onVerifiedCase.ok).toBe(true);
    if (onVerifiedCase.ok) {
      expect(onVerifiedCase.statement.externalCheckCoverage).toEqual([
        {
          checkId: "resonance",
          toolId: "qiskit-adapter",
          attestedLaunches: 1,
          cellProgramLaunches: 0,
          rejects: 2,
          kind: "external",
        },
      ]);
    }
    const onControlOnly = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["reject-7"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      resonanceOnT1,
    );
    expect(clauseNames(onControlOnly)).toContain("external-grounding-case-uncovered");
  });

  it("writes no row for a check no verified case applied", () => {
    // Adapter source text is not proof the engine ran; with no verified opportunity there is
    // nothing to record a launch against, so there is no row and no accusation either.
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: NO_EXTERNAL_EXECUTION },
        discrimination: { claimable: true, findings: [], attributedCheckIds: { resonance: 2 } },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.statement.externalCheckCoverage).toEqual([]);
  });

  it("writes no row when the check's only applicable case got no truth verdict", () => {
    // That case had no verified opportunity, so zero launches say nothing about its tool. The
    // non-result stays a non-result rather than becoming an unlaunched-tool accusation.
    const resonanceOnNonResult = GREEN_SCORE.map((row) =>
      row.caseId === "t4"
        ? { ...row, passed: false, truthVerified: false, checkIds: ["c1", "resonance"] }
        : row,
    );
    const result = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["t4"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      resonanceOnNonResult,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.statement.externalCheckCoverage).toEqual([]);
  });

  it("writes no row for a tool-free authored brief, nor for a battery that verified nothing", () => {
    const authored = createClaim(greenEvidence());
    expect(authored.ok).toBe(true);
    if (authored.ok) expect(authored.statement.externalCheckCoverage).toEqual([]);

    const unverified = createClaim(
      greenEvidence({
        grounding: { declared: [RESONANCE], execution: qiskitExecution(["reject-7"]) },
        discrimination: discriminatedChecks("resonance"),
      }),
      GREEN_SCORE.map((row) => ({ ...row, truthVerified: false, passed: false })),
    );
    expect(unverified.ok).toBe(true);
    if (unverified.ok) expect(unverified.statement.externalCheckCoverage).toEqual([]);
  });
});

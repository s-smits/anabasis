/**
 * How a check decided by an installed tool is evidenced on the claim.
 *
 * Executing and discriminating are separate facts. A tool can run on every case while no reject
 * control ever made it fail, so an external check still needs its own attributing reject. And a
 * tool run vouches for one case, one check and one adapter only: a run recorded under a neighbouring
 * check or adapter, or over a control, or over another case, grounds nothing. The coverage rows on
 * the statement exist only where a verified case gave the tool an opportunity, and each one also
 * counts the programs the check built inside its own cell and ran, which no inventory hashed.
 *
 * The authored half of grounding — a reject per declared check, a check that fired — is a
 * single-fact refusal and lives in `claim-create.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import type { ClaimEvidence, ScoredCase } from "../src/claim/claim-evidence.ts";
import type { ToolCheckCoverage } from "../src/truth/grounding-coverage.ts";
import { NO_EXTERNAL_EXECUTION, type VerifierExecutionEvidence } from "../src/truth/grounding.ts";
import {
  AUTHORED_C1,
  GREEN_SCORE,
  RESONANCE,
  clauseNames,
  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // clauseOf,
  createClaim,
  discriminatedChecks,
  greenEvidence,
  qiskitExecution,
  statementOf,
} from "./helpers/claim-evidence.ts";

type Coverage = { evidence: Partial<ClaimEvidence>; score: ScoredCase[]; rows: ToolCheckCoverage[] };

const ALL = ["t1", "t2", "t3", "t4"];

const resonanceEverywhere: ScoredCase[] = GREEN_SCORE.map((row) => ({ ...row, checkIds: ["resonance"] }));
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

/** The behaviour check, discriminated, over the given battery rows. */
function behaviour(executed: VerifierExecutionEvidence["executed"]): Partial<ClaimEvidence> {
  return {
    grounding: {
      declared: [AUTHORED_C1, BEHAVIOUR],
      execution: { executed, verifierEnvironmentHash: "e".repeat(64), tools: CC_TOOLS },
    },
    discrimination: discriminatedChecks("display-composition"),
  };
}

/** The declared external check, run over `execution`, with a reject attributed to it. */
const external = (execution: VerifierExecutionEvidence): Partial<ClaimEvidence> => ({
  grounding: { declared: [RESONANCE], execution },
  discrimination: discriminatedChecks("resonance"),
});

/** One battery run of `resonance` on t1 under the given check and adapter names. */
const runOnT1 = (checkId: string, adapterId: string): VerifierExecutionEvidence => ({
  ...qiskitExecution([]),
  executed: [ran("t1", checkId, adapterId)],
});

/** `resonance` declared twice, decided by qiskit-adapter and statevector-audit on every case. */
function twoTools(): Partial<ClaimEvidence> & { grounding: { execution: VerifierExecutionEvidence } } {
  const qiskit = qiskitExecution(ALL);
  const audit = { digest: "a".repeat(64), source: "host", kind: "binary", interpreter: null } as const;
  const execution: VerifierExecutionEvidence = {
    ...qiskit,
    tools: { ...qiskit.tools, "statevector-audit": audit },
    executed: [
      ...qiskit.executed,
      ...qiskit.executed.map((row) => ({ ...row, adapterId: "statevector-audit" })),
    ],
  };
  return {
    grounding: {
      declared: [
        RESONANCE,
        { checkId: "resonance", grounding: { ...RESONANCE.grounding, adapterId: "statevector-audit" } },
      ],
      execution,
    },
    discrimination: discriminatedChecks("resonance"),
  };
}

/** An authored check that requires qiskit-adapter as its interpreter, run on the given cases. */
function authoredWithTool(subjectIds: readonly string[]): Partial<ClaimEvidence> {
  const execution = qiskitExecution(subjectIds);
  return {
    grounding: {
      declared: [{ ...AUTHORED_C1, requiredToolIds: ["qiskit-adapter"] }],
      execution: { ...execution, executed: execution.executed.map((row) => ({ ...row, checkId: "c1" })) },
    },
  };
}

/** An external coverage row of `resonance`, which built no program of its own. */
const resonanceRow = (toolId: string, attestedLaunches: number): ToolCheckCoverage => ({
  checkId: "resonance",
  toolId,
  attestedLaunches,
  cellProgramLaunches: 0,
  rejects: 2,
  kind: "external",
});

// Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
// describe("an external check must have rejected something", () => {
//   it("refuses a fully executed check no reject made fail, under its own clause, and clears with one", () => {
//     const executed = qiskitExecution(["t1"]);
//     const uncovered = createClaim(
//       greenEvidence({
//         grounding: { declared: [RESONANCE], execution: executed },
//         discrimination: { claimable: true, findings: [], attributedCheckIds: { c1: 1 } },
//       }),
//     );
//     expect(clauseNames(uncovered)).toEqual(["external-grounding-uncovered"]);
//     expect(clauseOf(uncovered, "external-grounding-uncovered")?.repairable).toBe(false);
//     expect(clauseNames(createClaim(greenEvidence(external(executed))))).toEqual([]);
//   });
// });

const COVERAGE = {
  "one run per verified case": {
    evidence: external(qiskitExecution(ALL)),
    score: resonanceEverywhere,
    rows: [resonanceRow("qiskit-adapter", 4)],
  },
  "a case whose bytes never reached the verifier, which needs no run": {
    evidence: external(qiskitExecution(["t1", "t2", "t3"])),
    score: resonanceEverywhere.map((r) => (r.caseId === "t4" ? { ...r, truthVerified: false } : r)),
    rows: [resonanceRow("qiskit-adapter", 3)],
  },
  "the check's own run on its only verified case": {
    evidence: external(runOnT1("resonance", "qiskit-adapter")),
    score: resonanceOnT1,
    rows: [resonanceRow("qiskit-adapter", 1)],
  },
  "every declared tool of one check on every case": {
    evidence: twoTools(),
    score: resonanceEverywhere,
    rows: [resonanceRow("qiskit-adapter", 4), resonanceRow("statevector-audit", 4)],
  },
  "an authored check's required tool, which keeps its authored kind": {
    evidence: authoredWithTool(ALL),
    score: GREEN_SCORE,
    rows: [
      {
        checkId: "c1",
        toolId: "qiskit-adapter",
        attestedLaunches: 4,
        cellProgramLaunches: 0,
        rejects: 1,
        kind: "authored",
      },
    ],
  },
  // The recorded shape: every behaviour check declared external over `cc` compiled the artifact with
  // a driver the Builder published, then ran the result. `cc` alone is what the inventory hashed;
  // the verdict came from the built program, so the row counts it and the claim still stands.
  "an external check that built and ran a program in its cell": {
    evidence: behaviour(
      GREEN_SCORE.flatMap((row) => [
        ran(row.caseId, "display-composition", "cc"),
        ran(row.caseId, "display-composition", "cell:app"),
      ]),
    ),
    score: behaviourEverywhere,
    rows: [
      {
        checkId: "display-composition",
        toolId: "cc",
        attestedLaunches: 4,
        cellProgramLaunches: 4,
        rejects: 2,
        kind: "external",
      },
    ],
  },
  // A program run for a neighbouring check, on a control, or on a case with no verdict counts nowhere.
  "a built program only on its own check and a verified case": {
    evidence: behaviour([
      ...GREEN_SCORE.map((row) => ran(row.caseId, "display-composition", "cc")),
      ran("t1", "another-check", "cell:app"),
      ran("reject-7", "display-composition", "cell:app"),
      ran("t4", "display-composition", "cell:app"),
    ]),
    score: behaviourEverywhere.map((r) => (r.caseId === "t4" ? { ...r, truthVerified: false } : r)),
    rows: [
      {
        checkId: "display-composition",
        toolId: "cc",
        attestedLaunches: 3,
        cellProgramLaunches: 0,
        rejects: 2,
        kind: "external",
      },
    ],
  },
  // An authored check that compiles its own test with an installed compiler and runs it is the honest
  // declaration of the same computation: the count is recorded and the kind stays.
  "an authored check's built programs, counted without changing its kind": {
    evidence: {
      grounding: {
        declared: [{ ...AUTHORED_C1, requiredToolIds: ["cc"] }],
        execution: {
          executed: GREEN_SCORE.flatMap((row) => [
            ran(row.caseId, "c1", "cc"),
            ran(row.caseId, "c1", "cell:firmware-test"),
          ]),
          verifierEnvironmentHash: "e".repeat(64),
          tools: CC_TOOLS,
        },
      },
    },
    score: GREEN_SCORE,
    rows: [
      {
        checkId: "c1",
        toolId: "cc",
        attestedLaunches: 4,
        cellProgramLaunches: 4,
        rejects: 1,
        kind: "authored",
      },
    ],
  },
  "a run recorded under a different check": {
    evidence: external(runOnT1("some-other-check", "qiskit-adapter")),
    score: GREEN_SCORE,
    rows: [],
  },
  "a check no verified case applied": {
    evidence: external(NO_EXTERNAL_EXECUTION),
    score: GREEN_SCORE,
    rows: [],
  },
  "a check whose only applicable case got no truth verdict": {
    evidence: external(qiskitExecution(["t4"])),
    score: GREEN_SCORE.map((r) =>
      r.caseId === "t4" ? { ...r, passed: false, truthVerified: false, checkIds: ["c1", "resonance"] } : r,
    ),
    rows: [],
  },
  "a battery that verified nothing": {
    evidence: external(qiskitExecution(["reject-7"])),
    score: GREEN_SCORE.map((r) => ({ ...r, truthVerified: false, passed: false })),
    rows: [],
  },
  "a tool-free authored brief": { evidence: {}, score: GREEN_SCORE, rows: [] },
} satisfies Record<string, Coverage>;

describe("a coverage row exists only where a verified case gave the tool an opportunity", () => {
  it.each(Object.entries<Coverage>(COVERAGE))("%s", (_, { evidence, score, rows }) => {
    expect(statementOf(createClaim(greenEvidence(evidence), score)).externalCheckCoverage).toEqual(rows);
  });
});

describe("what the statement says about grounding", () => {
  it("names the adapter of an external check and the host's environment hash, and nothing else", () => {
    const statement = statementOf(createClaim(greenEvidence(external(qiskitExecution(["t1"])))));
    expect(statement.groundings).toEqual([
      { checkId: "resonance", kind: "external-verifier", adapterId: "qiskit-adapter" },
    ]);
    // Every check is authored or external, so there is no third kind with prose of its own to carry:
    // the statement has no exception list.
    expect(Object.hasOwn(statement, "groundingExceptions")).toBe(false);
    expect(statement.verifierEnvironmentHash).toBe("e".repeat(64));
  });

  it("leaves a built program out of the hashed tool list", () => {
    const statement = statementOf(
      createClaim(
        greenEvidence(
          behaviour(
            GREEN_SCORE.flatMap((row) => [
              ran(row.caseId, "display-composition", "cc"),
              ran(row.caseId, "display-composition", "cell:app"),
            ]),
          ),
        ),
        behaviourEverywhere,
      ),
    );
    expect(statement.verifierTools.map((tool) => tool.toolId)).toEqual(["cc"]);
  });

  it("keeps an authored check authored even when an installed interpreter ran it", () => {
    expect(statementOf(createClaim(greenEvidence(authoredWithTool(ALL)))).groundings).toEqual([
      { checkId: "c1", kind: "authored", adapterId: null, requiredToolIds: ["qiskit-adapter"] },
    ]);
  });

  it("refuses executed runs with no environment fingerprint", () => {
    // A tool reports the same version after its binary changes, so the host's hash is the identity.
    const unfingerprinted = { ...qiskitExecution(["t1"]), verifierEnvironmentHash: null, tools: {} };
    expect(clauseNames(createClaim(greenEvidence(external(unfingerprinted))))).toEqual([
      "grounding-environment-unfingerprinted",
    ]);
  });
});

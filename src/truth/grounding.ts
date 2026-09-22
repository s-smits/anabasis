/**
 * Recorded evidence-source declarations for truth checks (scientific-verifier handover, C1).
 * Current checks distinguish authored computation and required tool execution; the union also
 * retains intrinsic and exception declarations for readers of earlier evidence.
 *
 * This module defines the shared evidence types without runtime imports. The claim combines
 * declarations derived from the brief with host-recorded executions. A required tool with no
 * matching execution prevents the corresponding claim: naming a tool in source does not prove
 * that it ran (done-gate 2).
 */

export type TruthGrounding =
  | {
      kind: "authored";
      /** A generated check program; its semantics have no independent grounding proof. */
      assertion: string;
    }
  | {
      kind: "external-verifier";
      /** Required installed tool invocation — never an LLM or a proof of algorithm independence. */
      adapterId: string;
      /** What the tool is asked to establish, in the tool's own vocabulary. */
      assertion: string;
    }
  | {
      kind: "intrinsic";
      /** The in-process pure primitive that decides the check, e.g. "relationalJoin". */
      primitive: string;
    }
  | {
      kind: "exception";
      /** Why no executable grounding exists — substantive prose, surfaced on the claim. */
      justification: string;
    };

export interface GroundingDeclaration {
  checkId: string;
  grounding: TruthGrounding;
  /** Execution requirements are independent of the declared semantic grounding. */
  requiredToolIds?: readonly string[];
}

/**
 * The run facts the verifier host writes as one unit: which (phase, subjectId, attempt, checkId, adapterId)
 * combinations an installed tool actually ran to completion for, and the content address of the tools
 * that ran (toolId → executable digest and where it resolved; null when nothing ran). Bindings are
 * per subject and per check: a tool run for check A never grounds check B, and a run for one case
 * or control never grounds a neighbouring case. correctnessModelHash covers the evaluator source;
 * the environment hash covers the executables it called, so two runs on different tool versions
 * never share comparison identity. A correctnessModel that shells out on its own earns neither.
 */
export type VerifierExecutionEvidence = {
  executed: Array<{
    phase: "discrimination" | "solvability" | "battery";
    subjectId: string;
    attempt: number;
    checkId: string;
    adapterId: string;
  }>;
  verifierEnvironmentHash: string | null;
  /** Every tool that ran to completion: its executable digest, whether it came from the
   *  candidate's own `.toolchain` tree or the host path, and whether it is a binary or a script
   *  behind an interpreter. A claim reader sees here whether the compiler that judged the artifact
   *  was one the Builder installed, and whether "the tool" is a text file the Builder could have
   *  written. The environment hash covers digest and source only, so adding provenance moved no
   *  recorded identity. */
  tools: Record<
    string,
    {
      digest: string;
      source: "workspace-toolchain" | "host";
      kind: "binary" | "script";
      interpreter: string | null;
      interpreterDigest?: string;
    }
  >;
};

/** The one value for "no tool ran" — refer to it instead of restating the fields. */
export const NO_EXTERNAL_EXECUTION: VerifierExecutionEvidence = Object.freeze({
  executed: [],
  verifierEnvironmentHash: null,
  tools: {},
});

/** Declared groundings (from the validated brief) plus the host-created execution evidence. */
export interface GroundingEvidence {
  declared: GroundingDeclaration[];
  execution: VerifierExecutionEvidence;
}

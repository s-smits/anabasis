/** Public and evidence contracts for one Judge subject. The runner stays in judge.ts; this file
 * defines the shared types so writers and readers use the same context and evidence fields. */
import type { RunCondition } from "../claim/case-record.ts";
import type { NonResultKind } from "../claim/record-events.ts";
import type { PublicBriefResource } from "./public-resources.ts";

export interface JudgePublicTask {
  taskId: string;
  family: string;
  publicInput: unknown;
  /** Public rules applicable to this task. Identity, predicates and hidden markers stay absent. */
  publicValidityRules?: Array<{ assertion: string; publicInputPaths: string[] }>;
}

/** Every subject is a battery case, bound to the public task it solved. */
export interface JudgePublicContext {
  domain: JudgePublicDomain;
  publicTask: JudgePublicTask;
}

/** Public contract facts only. Truth checks, joins, hidden operands, verifier code, solver traces and
 * the Built system prompt have no representation here. */
export interface JudgePublicDomain {
  slug: string;
  domain: string;
  /** Exact operator request; null for a direct measurement that carries none, such as a
   *  harness-query probe. */
  publicRequest: string | null;
  artifactSchema: unknown;
  publicResources: PublicBriefResource[];
  /** Builder-declared tools, filtered to those available in the measured condition. */
  toolContract: {
    presets: string[];
    tools: Array<{ name: string; kind: string; description: string }>;
    availableToolNames: string[];
  } | null;
  /** Public execution facts that shape what the Built Harness was asked to do. */
  runtimeFacts: {
    capabilities: string[];
    maxSubmitAttempts: number;
    condition: RunCondition;
  };
}

/** Complete model-visible input: identity and verifier facts stay controller-side. */
export interface JudgeInput {
  publicContext: JudgePublicContext;
  /** Untrusted input for the Judge sanitizer. */
  submittedArtifact: unknown;
}

/** Controller join key plus the strictly narrower model-visible input. */
export interface JudgeRequest extends JudgeInput {
  subjectId: string;
}

export type JudgeAttempt = {
  verdict: boolean | null;
  /** Designed abstention is distinct from a null verdict caused by evaluator failure. */
  abstained: boolean;
  rationale: string | null;
  /** The shown rules a fail cites verbatim, as many as it rests on: public validity assertions,
   *  `artifactSchema` or `publicInput`. Empty for a pass, an abstention and an error. */
  rules: string[];
  error: string | null;
  /** Structural classification of `error`, typed at the site that knows what failed: a turn the
   *  provider did not complete is "provider", a completed turn without usable output is
   *  "protocol", a thrown call is "transport". Null exactly when `error` is null, so a
   *  zero-verdict census can record a typed cause instead of flattened prose. */
  errorKind: NonResultKind | null;
  turns: number;
};

export type JudgeCallContext = {
  subjectId: string;
  subjectKind: JudgeSubjectEvidence["subjectKind"];
};

export type Judge = (input: JudgeInput, context?: JudgeCallContext) => Promise<JudgeAttempt>;

export interface JudgeSession {
  pin: string;
  promptPolicyDigest?: string;
  invoke: Judge;
}

type JudgeSubjectEvidenceCore = JudgeAttempt & {
  subjectId: string;
  /** One member, because a battery case is the only thing the Judge reviews. `judge.ts` asserts
   *  this value on every battery observation, so a second subject kind cannot appear unnoticed. */
  subjectKind: "battery-case";
  judgePin: string;
  verifierBlind: true;
  sanitizer: { version: string; modified: boolean; actions: string[] };
  /** A second fresh sample, taken only when the first verdict contradicts the verifier's, so a
   *  contradiction reaches the reviewer only when both samples agree. One sample does not settle
   *  it: replaying the same subject can split two fail to one pass, so a single draw would decide
   *  whether the reviewer had a case to settle at all. */
  confirmation?: JudgeAttempt;
};

/** V3 binds the exact sanitized context and full model input. */
export type JudgeSubjectEvidence = JudgeSubjectEvidenceCore & {
  schema: "judge-subject/v3";
  publicContextDigest: string;
  judgeInputDigest: string;
};

export interface JudgeObservation {
  evidence: JudgeSubjectEvidence;
  /** The verifier's verdict on the same case; never sent to the judge. */
  verifierVerdict: boolean | null;
}

/** The epoch-relative evidence file these rows are appended to, one JSON row per action. */
export const WORKSHOP_ACTION_FILE = "verifier-workshop.jsonl";

export type VerifierWorkshopAction = "fetch" | "inspect" | "read" | "write" | "run" | "export";

type VerifierWorkshopNonResult =
  | "mechanism-unavailable"
  | "sandbox-refused"
  | "timeout"
  | "source-unavailable"
  | "source-timeout";

type VerifierWorkshopFailure = "command-failed" | "process-signalled" | "request-refused" | "source-refused";

export type VerifierWorkshopReason = VerifierWorkshopNonResult | VerifierWorkshopFailure;

interface WorkshopEvidenceBody {
  at: string;
  action: VerifierWorkshopAction | "propose";
  outcome: "completed" | "failed" | "non-result";
  reason: VerifierWorkshopReason | null;
  policyDigest: string;
  requestDigest: string;
  resultDigest: string;
  subjectDigest: string | null;
}

export type VerifierWorkshopActionEvidence = WorkshopEvidenceBody & {
  schema: "verifier-workshop-action/v2";
  sequence: number;
  process: import("./verifier-workshop.ts").WorkshopProcessFacts | null;
};

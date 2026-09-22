/** Semantic outcomes for the verifier workshop and public-source actions in one epoch. */
import { readFileSync } from "../../src/meta/filesystem.ts";
import { plainRecord } from "../../src/meta/json-evidence.ts";
import { isString } from "../../src/meta/json-shape.ts";
import type {
  VerifierWorkshopAction,
  VerifierWorkshopActionEvidence,
  VerifierWorkshopReason,
} from "../../src/builder/verifier-workshop-evidence.ts";

export { WORKSHOP_ACTION_FILE } from "../../src/builder/verifier-workshop-evidence.ts";

export type WorkshopActionFact = Pick<
  VerifierWorkshopActionEvidence,
  "at" | "action" | "outcome" | "reason" | "policyDigest" | "subjectDigest"
> & {
  /** The row's host-authored identity: one-based, equal to its own line, and the receipt join key. */
  sequence: number;
  /** Digest of the workshop result this row recorded. Null only on damaged pre-field rows; the
   *  digest is the join key to the receipt's own recorded result. */
  resultDigest: string | null;
};

export interface WorkshopActionCensus {
  actions: number;
  completed: number;
  failed: number;
  nonResults: number;
  byAction: Partial<Record<VerifierWorkshopAction | "propose", number>>;
  /** Keeps failure reasons joined to the action that produced them. */
  byActionOutcome: Partial<
    Record<
      VerifierWorkshopAction | "propose",
      {
        completed: number;
        failed: number;
        nonResults: number;
        byReason: Partial<Record<VerifierWorkshopReason, number>>;
      }
    >
  >;
  byReason: Partial<Record<VerifierWorkshopReason, number>>;
  policyDigests: string[];
  subjectDigests: string[];
}

export function readWorkshopActionFacts(path: string): WorkshopActionFact[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line, index) => {
      const parsed: unknown = JSON.parse(line);
      const record = plainRecord(parsed);
      if (
        record?.schema !== "verifier-workshop-action/v2" ||
        record.sequence !== index + 1 ||
        !isString(record.outcome) ||
        !["completed", "failed", "non-result"].includes(record.outcome)
      ) {
        throw new Error(`invalid verifier workshop action evidence at line ${index + 1}`);
      }
      const evidence =
        /* SAFETY: the checks above accept the one recorded schema, its line-bound sequence, and a closed outcome. */ parsed as VerifierWorkshopActionEvidence;
      return {
        at: evidence.at,
        action: evidence.action,
        outcome: evidence.outcome,
        reason: evidence.reason,
        policyDigest: evidence.policyDigest,
        sequence: evidence.sequence,
        // SAFETY: `evidence` passed the schema gate above; isString re-checks the one field damaged older rows may omit.
        resultDigest: isString(evidence.resultDigest) ? evidence.resultDigest : null,
        subjectDigest: evidence.subjectDigest,
      };
    });
}

export function foldWorkshopActions(path: string): WorkshopActionCensus {
  return foldWorkshopFacts(readWorkshopActionFacts(path));
}

export function foldWorkshopFacts(evidence: readonly WorkshopActionFact[]): WorkshopActionCensus {
  const census: WorkshopActionCensus = {
    actions: evidence.length,
    completed: 0,
    failed: 0,
    nonResults: 0,
    byAction: {},
    byActionOutcome: {},
    byReason: {},
    policyDigests: [],
    subjectDigests: [],
  };
  const policies = new Set<string>();
  const subjects = new Set<string>();
  for (const actionEvidence of evidence) {
    census.byAction[actionEvidence.action] = (census.byAction[actionEvidence.action] ?? 0) + 1;
    const action = census.byActionOutcome[actionEvidence.action] ?? {
      completed: 0,
      failed: 0,
      nonResults: 0,
      byReason: {},
    };
    census.byActionOutcome[actionEvidence.action] = action;
    if (actionEvidence.outcome === "completed") {
      census.completed += 1;
      action.completed += 1;
    } else {
      const field = actionEvidence.outcome === "failed" ? "failed" : "nonResults";
      census[field] += 1;
      action[field] += 1;
      if (actionEvidence.reason !== null) {
        census.byReason[actionEvidence.reason] = (census.byReason[actionEvidence.reason] ?? 0) + 1;
        action.byReason[actionEvidence.reason] = (action.byReason[actionEvidence.reason] ?? 0) + 1;
      }
    }
    policies.add(actionEvidence.policyDigest);
    if (actionEvidence.subjectDigest !== null) subjects.add(actionEvidence.subjectDigest);
  }
  census.policyDigests = [...policies].sort();
  census.subjectDigests = [...subjects].sort();
  return census;
}

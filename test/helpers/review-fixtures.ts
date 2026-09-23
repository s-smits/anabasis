/**
 * What a review test needs before it can assert anything.
 *
 * The advice issue and the packet around it were written out twice — once in the omnibus
 * review-readers file and once in rebuild-advice.test.ts as `priorIssue`, differing only in the
 * count each happened to default to — and the two constants the epoch-review tests quote were
 * reachable only from the file that declared them. One owner each, so a change to the packet shape
 * reaches every reader of it.
 */
import type { JsonValue } from "../../src/meta/json-shape.ts";
import {
  type AdviceIssue,
  type RebuildAdvicePacket,
  REBUILD_ADVICE_SCHEMA,
  adviceIssueId,
} from "../../src/author/rebuild-advice.ts";
import type { DiagnosisReaderEvidence } from "../../src/review/diagnosis-reader.ts";
import type { ReviewState } from "../../src/review/epoch-review-findings.ts";
import { emptyProbeState } from "../../src/review/review-probe.ts";
import type { ReaderTool } from "../../src/review/review-reader.ts";
import { double } from "./doubles.ts";

/** The two issue ids every fixture uses: one verified failure, one unaccepted submission. */
export const BEAMS = adviceIssueId("verified-fail", "beams", null);
export const JOINTS = adviceIssueId("unaccepted", "joints", null);

/** A statement a reviewed artifact makes, used where a test needs prose a judge could cite. */
export const DEMO =
  "a layout split into two support-anchored components passes the m + r = 2j count and the singularity test";

/** One citation into the candidate's own evaluator: a finding that cites nothing is a non-result,
 *  so every test that expects a finding to be recorded supplies this. */
export const CITATIONS = [{ path: "evaluator.ts", quote: "return artifact.count >= 0;" }];

export const REVIEW_IDENTITY = {
  reviewerPin: "review-pin",
  reviewerEffort: "low",
  requestDigest: "request-digest",
  obligationsDigest: "obligations-digest",
};

export function issue(overrides: Partial<AdviceIssue> = {}): AdviceIssue {
  return {
    id: BEAMS,
    kind: "verified-fail",
    family: "beams",
    detail: null,
    count: 2,
    denominator: 5,
    firstSeenRunId: "r1",
    lastSeenRunId: "r1",
    absentBatteries: 0,
    returned: false,
    retired: false,
    diagnosis: null,
    dispute: null,
    ...overrides,
  };
}

export function advicePacket(issues: AdviceIssue[]): RebuildAdvicePacket {
  return {
    schema: REBUILD_ADVICE_SCHEMA,
    slug: "truss",
    runId: "r2",
    analysisDigest: "d".repeat(64),
    families: [{ family: "beams", verified: 5, passed: 3, unaccepted: 0, nonResults: 0 }],
    blockingByCheck: {},
    applicableByCheck: {},
    issues,
    judge: null,
    findings: [],
  };
}

/** A diagnosis the reader produced, complete enough that every field has a recorded value. Tests
 *  that check what stays private need one whose prose must not appear in the rendered advice. */
export const READING = {
  issueId: BEAMS,
  cause: "the writer tool cannot express a pinned joint",
  falsifier: "a beams task passes with a pinned joint",
  firstDivergence: "the writer's second call omits the joint list the schema requires",
  interventionClass: "tools-spec" as const,
  contrastSuccess: "the passing case of this family needed no pinned joint",
  confidence: "medium" as const,
  runId: "r2",
};

/** The record a diagnosis tool writes into, offering one issue and holding nothing yet. */
export function diagnosisSink(): DiagnosisReaderEvidence {
  return {
    schema: "diagnosis-reading/v1",
    slug: "truss",
    runId: "r2",
    readerPin: null,
    offered: [BEAMS],
    diagnoses: [],
    abstentions: [],
    refused: 0,
    error: null,
    readerText: null,
  };
}

/** A review that has read the evaluator once and recorded nothing yet. */
export function reviewState(): ReviewState {
  return {
    reads: ["evaluator.ts"],
    readChars: 12,
    refused: 0,
    probes: emptyProbeState(),
    delivered: [
      { path: "evaluator.ts", digest: "", length: 0, pages: [{ start: 0, text: CITATIONS[0]!.quote }] },
    ],
    findings: [],
    disputes: [],
    admission: { continuations: 0, citationRefusals: 0, severityAdjusted: [] },
  };
}

/** One call of a reader tool, answering with the text the model would see. */
export async function call(tool: ReaderTool, args: Record<string, JsonValue>): Promise<string> {
  const [first] = (await tool.execute("call-1", double<never>(args))).content;
  return first?.type === "text" ? first.text : "";
}

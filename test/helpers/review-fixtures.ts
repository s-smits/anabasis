/**
 * What a review test needs before it can assert anything.
 *
 * The advice issue and the packet around it were written out twice — once in the omnibus
 * review-readers file and once in rebuild-advice.test.ts as `priorIssue`, differing only in the
 * count each happened to default to — and the two constants the epoch-review tests quote were
 * reachable only from the file that declared them. One owner each, so a change to the packet shape
 * reaches every reader of it.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import { type RebuildAdvicePacket, REBUILD_ADVICE_SCHEMA } from "../../src/author/rebuild-advice.ts";
import { type AdviceIssue, type IssueDiagnosis, adviceIssueId } from "../../src/author/issue-register.ts";
import {
  type CaseDisposition,
  EPOCH_REVIEW_SCHEMA,
  type ReviewState,
} from "../../src/review/epoch-review-findings.ts";
import { emptyProbeState } from "../../src/review/review-probe.ts";
import type { ReaderTool } from "../../src/review/review-reader.ts";
import { double } from "./doubles.ts";

/** The two issue ids every fixture uses: one verified failure, one unaccepted submission. */
export const BEAMS = adviceIssueId("verified-fail", "beams", null);
export const JOINTS = adviceIssueId("unaccepted", "joints", null);

/** The condition every fixture battery measured under: one family's tasks and their public inputs,
 *  the scoring program (its bytes, its verdict closure and the public wording), the tools its checks
 *  ran and the Built model and resource condition. An absence counts as a complete recheck only
 *  across batteries that share the inputs, the closure, the tools and the Built condition, so a test
 *  that means a different condition says which part moved. */
export const MEASURED_UNDER = {
  taskIds: ["t1", "t2"],
  taskInputs: "1".repeat(64),
  scoringHash: "2".repeat(64),
  verdictClosureHash: "5".repeat(64),
  publicationHash: "6".repeat(64),
  checkTools: "4".repeat(64),
  measuredCondition: "3".repeat(64),
} as const;

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

/** A diagnosis the reader produced, complete enough that every field has a recorded value. Its
 *  cause is the one field that stays in the record; the render test checks that it does. */
export const READING: IssueDiagnosis = {
  runId: "r2",
  owner: "agent/tools-spec.json",
  boundary: {
    tool: "write_layout",
    reading: "the writer's second call omits the joint list the schema requires",
  },
  cause: "the writer tool cannot express a pinned joint",
  falsifier: "a beams solve writes a pinned joint through write_layout and still fails",
  support: { cases: 2, shown: 3, matching: 3, contrasts: 1 },
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
    rulesChangedRechecks: 0,
    returned: false,
    retired: false,
    observedUnder: { ...MEASURED_UNDER },
    unmeasured: [],
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
    backendPin: "codex:built-model:high",
    analysisDigest: "d".repeat(64),
    condition: {
      scoringHash: MEASURED_UNDER.scoringHash,
      verdictClosureHash: MEASURED_UNDER.verdictClosureHash,
      publicationHash: MEASURED_UNDER.publicationHash,
      checkTools: MEASURED_UNDER.checkTools,
      measuredCondition: MEASURED_UNDER.measuredCondition,
    },
    families: [
      {
        family: "beams",
        verified: 5,
        passed: 3,
        unaccepted: 0,
        nonResults: 0,
        taskIds: MEASURED_UNDER.taskIds,
        taskInputs: MEASURED_UNDER.taskInputs,
      },
    ],
    blockingByCheck: {},
    applicableByCheck: {},
    issues,
    judge: null,
    findings: [],
  };
}

/** A review that has read the evaluator once and recorded nothing yet. */
export function reviewState(): ReviewState {
  return {
    reads: ["evaluator.ts"],
    readChars: 12,
    probes: emptyProbeState(),
    dispositions: [],
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

/** A review of `runId` in `analysis` whose dispositions settle each named case against `bench`, the
 *  one check that decided it, unless the row says otherwise; an undefined field is left out. */
export function writeSettledReview(
  analysis: string,
  runId: string,
  rows: Array<{ [K in keyof CaseDisposition]?: CaseDisposition[K] | undefined }>,
  status = "completed",
): void {
  const dispositions = rows.map((row) => ({
    family: "f",
    kind: "disputed-pass",
    checkId: "bench",
    checkIds: ["bench"],
    disposition: "against-check",
    finding: 0,
    ...row,
  }));
  mkdirSync(analysis, { recursive: true });
  const review = { schema: EPOCH_REVIEW_SCHEMA, runId, status, findings: [], dispositions };
  writeFileSync(join(analysis, `${runId}-epoch-review.json`), JSON.stringify(review));
}

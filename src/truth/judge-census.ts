/**
 * Runs the Main Judge over the battery's accepted verified cases in groups of five and writes each
 * completed result in input order. After each group, five consecutive errors without an abstention
 * stop further paid calls. Completed observations still reach `summarizeJudge`, which reports
 * incomplete coverage itself.
 */
import { JUDGE_MAX_CONCURRENCY, runJudgeBatches } from "../run/session-pool.ts";
import {
  type JudgeSession,
  type JudgeObservation,
  type JudgeRequest,
  type JudgeSubjectEvidence,
  judgeSubject,
} from "./judge.ts";
import type { JsonValue } from "../meta/json-shape.ts";

const JUDGE_CENSUS_ABORT_AFTER = 5;

type JudgeCensusAbort = {
  schema: "judge-census-abort/v1";
  /** One member. Runs before 2026-09-14 could also record `control-census`, which the operator
   *  removed that day. */
  phase: "battery-census";
  attempted: number;
  threshold: number;
  lastError: string | null;
};

export interface JudgeCensusSubject {
  evidencePath: string;
  request: JudgeRequest;
  subjectKind: JudgeSubjectEvidence["subjectKind"];
  observation: Omit<JudgeObservation, "evidence">;
}

/** How the census records a subject: a path and the JSON to put there. The return is `void` because
 *  no caller reads one — every caller writes and moves on. */
type EvidenceWriter = (path: string, value: JsonValue) => void;

export class JudgeCensus {
  private streak = 0;
  private attempted = 0;
  private lastError: string | null = null;

  constructor(
    private readonly session: JudgeSession,
    private readonly write: EvidenceWriter,
  ) {}

  async run(
    subjects: readonly JudgeCensusSubject[],
  ): Promise<{ observations: JudgeObservation[]; abort: JudgeCensusAbort | null }> {
    const observations: JudgeObservation[] = [];
    let abort: JudgeCensusAbort | null = null;
    await runJudgeBatches(
      subjects,
      async (subject) => ({
        subject,
        evidence: await judgeSubject(
          this.session,
          subject.request,
          subject.subjectKind,
          subject.observation.verifierVerdict,
        ),
      }),
      (batch) => {
        for (const { subject, evidence } of batch) {
          this.write(subject.evidencePath, evidence);
          observations.push({ evidence, ...subject.observation });
          this.observe(evidence);
        }
        abort = this.abortEvidence();
        if (abort !== null) this.write("judge/census-abort.json", abort);
        return abort === null;
      },
      this.session.maxConcurrency ?? JUDGE_MAX_CONCURRENCY,
    );
    return { observations, abort };
  }

  private observe(evidence: JudgeSubjectEvidence): void {
    this.attempted += 1;
    const errored = evidence.verdict === null && !evidence.abstained;
    this.streak = errored ? this.streak + 1 : 0;
    if (errored && evidence.error !== null) this.lastError = evidence.error;
  }

  private abortEvidence(): JudgeCensusAbort | null {
    return this.streak < JUDGE_CENSUS_ABORT_AFTER
      ? null
      : {
          schema: "judge-census-abort/v1",
          phase: "battery-census",
          attempted: this.attempted,
          threshold: JUDGE_CENSUS_ABORT_AFTER,
          lastError: this.lastError,
        };
  }
}

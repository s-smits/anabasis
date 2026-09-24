/**
 * The Epoch Reviewer beside a live authoring session. A review starts at a completed host tool call
 * over bytes frozen the way the gate freezes a candidate, and the Builder keeps working while it
 * runs; what it found rides the first tool result after it finishes. Submit is the one call that
 * waits for it, and findings the Builder has not read come back in place of that submit's verdict.
 * Each review is handed the round's blind rehearsals as well, as the bytes the solver submitted and
 * the one verdict they earned, which is more than the Builder that ran them is shown.
 */
import { ensureBundleSnapshot } from "../claim/bundle-snapshot.ts";
import { type FingerprintEvidence, fingerprintSlug } from "../claim/fingerprint.ts";
import { type ExperimentSubmission, type RehearsalRow, currentPlan } from "../author/experiment-plan.ts";
import type { SubmittedRehearsal } from "../builder/harness-trial.ts";
import type { AuthoringReviewClock } from "../gate/review-clock.ts";
import type { RehearsalCase } from "../review/epoch-reviewer.ts";

/** `repair` follows a clear `correctness_check` over a changed product; `backstop` is the clock. */
type ReviewTrigger = "repair" | "backstop";

/** What one review hands the Builder: its public text, and how many findings that text shows. A
 *  review showing none holds no submit. */
export interface AuthoringAdvice {
  text: string;
  findings: number;
}

export type ReviewAuthoring = (
  root: string,
  trigger: ReviewTrigger,
  plan: ExperimentSubmission | null,
  rehearsals: readonly RehearsalCase[],
) => Promise<AuthoringAdvice>;

/** What a held submit says ahead of the review's findings. The review may have finished while the
 *  submit waited for it, or before the call with no other call between to hand it over, so the
 *  text says neither. The call reached no gate, so the same bytes submitted next are judged as a
 *  first submission of them. */
const HELD_SUBMIT =
  "Nothing was submitted. An Epoch review that ran while you worked finished with findings you had not yet read; they follow. This call counted as no submit, so call submit again once you have read them, with or without changes.";

type Settled = { advice: AuthoringAdvice } | { error: unknown };

export class AuthoringReviews {
  /** Whether a review is in flight. There is at most one: a trigger that fires meanwhile stays in
   *  the clock, which keeps only the latest validated product, and is read when this one finishes,
   *  so triggers coalesce rather than queue. */
  private reading = false;
  /** The latest review; once it has finished, awaiting it returns at once. */
  private running: Promise<void> = Promise.resolve();
  /** A finished review the Builder has not been handed yet. */
  private settled: Settled | null = null;
  /** The round's rehearsals, each named by the candidate its solver was given. */
  private readonly rehearsals: Array<Omit<RehearsalCase, "current"> & { candidateId: string | null }> = [];

  constructor(
    private readonly workspace: string,
    private readonly slug: string,
    private readonly clock: AuthoringReviewClock,
    private readonly review: ReviewAuthoring,
  ) {}

  /** At a completed tool call: hand over what a finished review said, then start the review now due
   *  if none is running. A failed review is rethrown, so the call's receipt records a review that
   *  produced nothing while the tool's own result goes back unchanged. Bound, like `join`, because
   *  the session calls both as plain functions. */
  readonly afterTool = async (): Promise<string | null> => {
    const { settled } = this;
    this.settled = null;
    this.start();
    if (settled === null) return null;
    if ("error" in settled) throw settled.error;
    return settled.advice.text;
  };

  /** Wait for a review in flight, and return findings the Builder has not read. Submit calls it
   *  before counting an attempt and returns that text in place of the verdict; the round's end calls
   *  it so that no review outlives the round that started it, and what it returns there is dropped
   *  with the round. With nothing in flight and nothing unread it returns at once. */
  readonly join = async (): Promise<string | null> => {
    await this.running;
    const { settled } = this;
    if (settled === null || "error" in settled || settled.advice.findings === 0) return null;
    this.settled = null;
    return `${HELD_SUBMIT}\n${settled.advice.text}`;
  };

  /** A rehearsal that reached a solve. Each field is taken by name, so whatever else a grading holds
   *  (the failing check, the verifier's output, where the artifact failed) stays behind. */
  rehearsed(row: RehearsalRow, submitted: SubmittedRehearsal): void {
    const { taskId, family, verdict } = row;
    const { ordinal, artifact, candidateId } = submitted;
    this.rehearsals.push({ ordinal, taskId, family, verdict, artifact, candidateId });
  }

  private start(): void {
    if (this.reading) return;
    const due = this.clock.due();
    if (due === null) return;
    const fingerprint =
      due.kind === "repair" ? due.fingerprint : fingerprintSlug(this.workspace, { slug: this.slug });
    // A draft that does not fingerprint cannot be frozen, and the live tree is never read in its
    // place: the clock stays due and the next completed call tries again.
    if (!fingerprint.ok) return;
    this.reading = true;
    this.running = this.read(due.kind, fingerprint);
  }

  /** The freeze runs before the review's first await, so the bytes read are the bytes at the call
   *  that started it. */
  private async read(trigger: ReviewTrigger, fingerprint: FingerprintEvidence): Promise<void> {
    try {
      const snapshot = ensureBundleSnapshot(this.workspace, fingerprint);
      // Whether each rehearsal solved the bytes this review reads, which a later edit makes false.
      const rehearsals = this.rehearsals.map(({ candidateId, ...rest }) => ({
        ...rest,
        current: candidateId === snapshot.id,
      }));
      const plan = currentPlan(this.workspace);
      this.settled = { advice: await this.review(snapshot.dir, trigger, plan, rehearsals) };
      this.clock.read(fingerprint);
    } catch (error) {
      this.settled = { error };
    } finally {
      this.clock.restart();
      this.reading = false;
    }
  }
}

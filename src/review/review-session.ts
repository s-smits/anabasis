/**
 * The review slot: the Main Judge's census session (`judgeSessionFor`) and the session the
 * diagnosis reader and the Epoch Reviewer read in (`openReviewSession`). All three are pi harnesses
 * on the shared host session, each with its own tools and framing; their output is advice or a
 * Judge verdict, and neither changes a pass, an acceptance, a claim or a promotion.
 *
 * The slot was called `judge` until 2026-08-19. The Main Judge census names — evidence, pin fields
 * and the verdict schema — still say `judge`, because they describe that one caller and appear in
 * run records written before the rename; renaming them would make an older record unreadable
 * without making a current one clearer. Every transport records a verdict through the one schema
 * tool (judge-drivers.ts), so no transport gets its own parsing of what a verdict is.
 *
 * Two historical judgeDeAnchoring settings correspond to construction here rather than to a check
 * that enforces them:
 *   - fallbackConfigured: false — the slot resolves one model and configures no fallback; runtime
 *     identity evidence separately establishes which model served the request.
 *   - commitAllTasksInPhaseZero: true — every subject opens a fresh session, keeping verdicts from
 *     earlier subjects out of the next subject's session.
 * The remaining rows (commitBeforeSeeingCandidate, predictionsMustBeFalsifiable,
 * predictionsMustBeDisposed) describe the rank-2 paired-comparison protocol, which is not
 * implemented here. These session constructors do not establish those properties.
 */
import { type PiSlotDefaults, type PiSlotRuntime, resolvePiSlot } from "../backends/pi-providers.ts";
import { type HostSession, type PiTool, openHostSession } from "../backends/pi-session.ts";
import { backendConditionPin } from "../backends/resolve-side.ts";
import type { ReviewChoice } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { ACTIVE_JUDGE_PROMPT_DIGESTS } from "../truth/judge-prompt-policy.ts";
import { type JudgeSession, sessionJudge } from "../truth/judge.ts";

type EnabledReview = Extract<ReviewChoice, { enabled: true }>;

/** The Judge census turn wall. A substantive review turn has completed successfully in roughly 24
 *  minutes in live runs, so the wall has to leave that valid path room; the reason it exists at all
 *  is that a silent broker otherwise sits until the session's generic one-hour ceiling and reports
 *  nothing about which turn died, and half an hour converts it into a typed turn timeout first. The
 *  Judge census uses this one; a reader has its own. */
export const REVIEW_TURN_TIMEOUT_MS = 30 * 60_000;

/** "high" is the documented judge convention when the slot pins no effort. The review slot reads
 *  what the controller hands it and searches nothing. */
const REVIEW_DEFAULTS: PiSlotDefaults = { effort: "high", webSearch: false };

/** The review slot's pin — the string every judge evidence names as the evaluator; null when the
 *  slot is disabled. The review slot does not inherit the Built Harness backend. */
export function reviewSlotPin(review: ReviewChoice): string | null {
  return review.enabled ? backendConditionPin(review) : null;
}

/** The review slot's served condition and credential. */
export function reviewSlot(review: EnabledReview, repoRoot: string): PiSlotRuntime {
  return resolvePiSlot("review", review, REVIEW_DEFAULTS, repoRoot);
}

/** Open one review session on these tools and this framing. The slot resolves at each open, so a
 *  review credential lost mid-run ends that session as a typed failure rather than the battery. */
export async function openReviewSession(
  review: EnabledReview,
  repoRoot: string,
  tools: readonly PiTool[],
  systemPrompt: string,
): Promise<HostSession> {
  return openHostSession({ slot: reviewSlot(review, repoRoot), tools, systemPrompt });
}

/**
 * The census session the eval runner drives. null when the slot is unconfigured: the runner reads
 * an omitted review slot as explicitly OFF and the battery records `judge: "off"`, which is a
 * disclosure, not a gap.
 */
export function judgeSessionFor(
  review: ReviewChoice,
  repoRoot: string,
  observer?: RunObserver,
  providerBudget?: ProviderResourceBudget,
): JudgeSession | null {
  if (!review.enabled) return null;
  return {
    pin: backendConditionPin(review),
    promptPolicyDigest: ACTIVE_JUDGE_PROMPT_DIGESTS.census,
    invoke: sessionJudge({
      openSession: (tool) => openReviewSession(review, repoRoot, [tool], ""),
      turnTimeoutMs: REVIEW_TURN_TIMEOUT_MS,
      ...keyIfDefined("observer", observer),
      ...keyIfDefined("providerBudget", providerBudget),
    }),
  };
}

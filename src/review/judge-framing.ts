import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { ACTIVE_JUDGE_PROMPTS } from "./judge-prompt-policy.ts";
/**
 * Assemble the public context and shared instructions for each Judge subject. The policy module
 * owns the base prompt, judge-drivers.ts owns the output instructions, and judge.ts records the
 * subject evidence. Both output methods use this assembly, so their context wording stays aligned.
 *
 * The original split kept prompt changes separate from the ported runner. This remains the
 * useful distinction: disclosure rules constrain what the Judge reads, while transport code
 * delivers that text and captures the response.
 */
import type { JudgeInput } from "./judge.ts";

/**
 * Tell the Judge the request includes its public task. Every subject is a measured case that
 * carries its task, so the Judge can apply task-dependent rules — and both ways of leaving that
 * unsaid have been paid for. A Judge that does not know the task is there decides confidently and
 * wrongly with no usable abstention path; told instead to abstain when it lacks context, it
 * abstains on every accept. Neither Judge had the task context its verdict needed.
 *
 * This states the request shape, never what would make an artifact valid: the no-hints boundary
 * owns the second, and disclosing the request shape is not disclosing verifier detail.
 */
const TASK_SENTENCE = "This input contains a public task. Decide whether the output solves that task.";

/** Both output methods receive the same instructions. Only their final output sentence differs. */
export function judgeTurnPrompt(input: JudgeInput, checkSentence: string): string {
  return `${ACTIVE_JUDGE_PROMPTS.census} ${TASK_SENTENCE} ${checkSentence}\n\nPublic context:\n${capturedJsonStringify(input.publicContext, null, 2)}\n\nSubmitted artifact:\n${capturedJsonStringify(input.submittedArtifact, null, 2)}`;
}

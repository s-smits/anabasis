/** Owner labels identify repair surfaces. The complete admitted feedback is the repair agenda;
 * an owner never limits which safe findings the Builder can read. */
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { projectFindingForAuthor } from "../correctness-bundle/brief.ts";
import { REFERENCE_SOLVE_ENTRY } from "../correctness-bundle/evaluator-process-bundle.ts";
import { HARNESS_CONFIG_FILE } from "../correctness-bundle/harness-config.ts";
import type { CampaignFeedback, FeedbackOwner } from "./campaign-types.ts";
import {
  AGENT_DIR,
  BRIEF_FILE,
  CONTROLS_FILE,
  EVALUATOR_FILE,
  GENERATED_TOOLS_FILE,
  TASKS_FILE,
  TOOLS_SPEC_FILE,
} from "../meta/bundle-layout.ts";

/** The files a Builder writes, and so the files a finding can name as the one at fault. An owner
 *  is one of these or `environment`, so "which part is at fault" and "which file to open" have one
 *  answer, and the side a repair reopens is the path's own prefix. */
export const BUNDLE_FILES = [
  BRIEF_FILE,
  TASKS_FILE,
  CONTROLS_FILE,
  EVALUATOR_FILE,
  REFERENCE_SOLVE_ENTRY,
  TOOLS_SPEC_FILE,
  GENERATED_TOOLS_FILE,
  BUILT_AGENTS_FILE,
  HARNESS_CONFIG_FILE,
] as const satisfies readonly (`agent/${string}` | `correctness-model/${string}`)[];
export type BundleFile = (typeof BUNDLE_FILES)[number];

export function isBundleFile(owner: FeedbackOwner | null): owner is BundleFile {
  return owner !== null && owner !== "environment";
}

/** The half of the bundle a repair of this file reopens. */
export function ownerSide(file: BundleFile): "agent" | "correctness-model" {
  return file.startsWith(AGENT_DIR) ? "agent" : "correctness-model";
}

/** Optional evidence label only. Null means an empty or mixed-owner agenda, never no work. */
export function feedbackOwner(feedback: readonly CampaignFeedback[]): FeedbackOwner | null {
  const owners = new Set(feedback.map((row) => row.owner));
  return owners.size === 1 ? (feedback[0]?.owner ?? null) : null;
}

/** How a feedback row reaches the Builder: one line per projected finding, or one line naming the
 *  owner when the row has no findings. Each row names the owner's file rather than the finding's
 *  recorded path, which is controller evidence the Builder cannot open. The owner is that file, so
 *  the label is already an address. */
export function advisory(feedback: CampaignFeedback[]): string | undefined {
  if (feedback.length === 0) return undefined;
  return feedback
    .flatMap((row) => {
      const projected = (row.findings ?? []).map(projectFindingForAuthor);
      return projected.length === 0
        ? [`- ${row.owner}: [${row.severity}] a previous finding remains; inspect the public contract`]
        : projected.map((finding) => `- ${row.owner}: [${row.severity}] ${finding.code}: ${finding.detail}`);
    })
    .join("\n");
}

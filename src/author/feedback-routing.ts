/** Owner labels identify repair surfaces. The complete admitted feedback is the repair agenda;
 * an owner never limits which safe findings the Builder can read. */
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { projectFindingForAuthor } from "../truth/brief.ts";
import type { CampaignFeedback, FeedbackOwner } from "./campaign-types.ts";
import {
  BRIEF_FILE,
  CONTROLS_FILE,
  EVALUATOR_FILE,
  GENERATED_TOOLS_FILE,
  TASKS_FILE,
  TOOLS_SPEC_FILE,
} from "../meta/bundle-layout.ts";

type RoutableOwner = Exclude<FeedbackOwner, "environment">;

/** Each routable owner's files and repair tier: "agent" when the repair stays inside the agent
 *  bundle, "rebuild" when it reopens the correctness model or the battery. */
const OWNERS = {
  brief: { files: [BRIEF_FILE], tier: "rebuild" },
  tests: { files: [TASKS_FILE], tier: "rebuild" },
  instructions: { files: [BUILT_AGENTS_FILE], tier: "agent" },
  "tools-spec": { files: [TOOLS_SPEC_FILE], tier: "agent" },
  "accept-controls": { files: [], tier: "rebuild" },
  controls: { files: [CONTROLS_FILE], tier: "rebuild" },
  "correctness-model": { files: [EVALUATOR_FILE], tier: "rebuild" },
  fingerprint: { files: [GENERATED_TOOLS_FILE], tier: "agent" },
} as const satisfies Record<RoutableOwner, { files: readonly string[]; tier: "agent" | "rebuild" }>;

export const BUILDER_OWNED: ReadonlySet<RoutableOwner> = new Set(
  // SAFETY: the literal table above contains exactly the RoutableOwner keys.
  Object.keys(OWNERS) as RoutableOwner[],
);

// Gate audit 2026-09-25 (docs/gate-audit.md, product-repair-required): commented out (unsure): its one reader is the commented-out product-repair refusal
// /** A narrow operation must serve every blocking owner. */
// export const BATTERY_SERVED: ReadonlySet<FeedbackOwner> = new Set(["tests", "controls"]);
export const EVALUATION_SERVED: ReadonlySet<FeedbackOwner> = new Set([
  "correctness-model",
  "accept-controls",
  "controls",
]);

export function routableOwner(owner: FeedbackOwner | null): owner is RoutableOwner {
  return owner !== null && owner !== "environment";
}

export function routableOwnerOf(value: string | null): RoutableOwner | null {
  for (const owner of BUILDER_OWNED) if (owner === value) return owner;
  return null;
}

export function ownerWritableFiles(owner: RoutableOwner): readonly string[] {
  return OWNERS[owner].files;
}

export function ownerTier(owner: RoutableOwner): "agent" | "rebuild" {
  return OWNERS[owner].tier;
}

/** Optional evidence label only. Null means an empty or mixed-owner agenda, never no work. */
export function feedbackOwner(feedback: readonly CampaignFeedback[]): FeedbackOwner | null {
  const owners = new Set(feedback.map((row) => row.owner));
  return owners.size === 1 ? (feedback[0]?.owner ?? null) : null;
}

/** The owner label with the file it names. Nothing model-visible mapped "instructions" to
 *  agent/BUILT_AGENTS.md, and it showed: most packets pointing at that owner preceded a successor
 *  that had left the guide byte-identical. Naming the file is what turns the label into an
 *  address. */
function ownerTarget(owner: FeedbackOwner): string {
  const files = routableOwner(owner) ? ownerWritableFiles(owner) : [];
  return files.length === 0 ? owner : `${owner} (${files.join(", ")})`;
}

/** How a feedback row reaches the Builder: one line per projected finding, or one line naming the
 *  owner when the row has no findings. Each row names the owner's file rather than the finding's
 *  recorded path, which is controller evidence the Builder cannot open. */
export function advisory(feedback: CampaignFeedback[]): string | undefined {
  if (feedback.length === 0) return undefined;
  return feedback
    .flatMap((row) => {
      const projected = (row.findings ?? []).map(projectFindingForAuthor);
      return projected.length === 0
        ? [
            `- ${ownerTarget(row.owner)}: [${row.severity}] a previous ${row.owner} finding remains; inspect the public contract`,
          ]
        : projected.map(
            (finding) => `- ${ownerTarget(row.owner)}: [${row.severity}] ${finding.code}: ${finding.detail}`,
          );
    })
    .join("\n");
}

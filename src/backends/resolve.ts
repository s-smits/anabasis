/**
 * Shared backend-slot resolver, so display and launch cannot disagree.
 *
 * Resolution rules:
 * - One resolver reads only `loadRepoEnv`'s merged values, with no separate wrapper or ambient env reads.
 * - The review slot inherits only when requested: unconfigured means disabled; following the built
 *   backend requires the explicit marker `{ "inherit": true }` (operator file) or
 *   `HARNESS_REVIEW_BACKEND=inherit`, and the choice carries `source: "inherited-explicit"`.
 * - Unknown kinds produce errors naming their source, so a typo cannot silently select a
 *   different backend.
 * - Operator files may not set models. Named environment pins are the descriptor registry's
 *   one model owner, including the three independent Codex slots.
 * - A provider with no resolved model (no env override or default) produces an error naming the env var:
 *   evaluation needs an identified model before it can start.
 * - A kind whose transport is unavailable is refused during resolution, and the transport's
 *   no-turn preflight verifies CLI, OAuth and exact model support. A resolver can never silently
 *   route a pin to another engine.
 * - The unconfigured default per slot is declared beside the completeness matrix
 *   (project-backend-policy): builder → claude, built → claude. The default and slot-support check
 *   share one owner, so they cannot disagree.
 */
import type { BackendKind } from "./backend-kinds.ts";
import { validateReviewOperator } from "./config-file.ts";
import type { RepoEnv } from "./env.ts";
import { type OperatorPin, OperatorSelection } from "./operator-selection.ts";
import {
  backendConditionPin,
  requireKind,
  requireVendoredTransport,
  resolveSide,
  resolvedSlot,
  type SlotChoice,
} from "./resolve-side.ts";
import { keyIfTruthy } from "../meta/optional-key.ts";
export type { SlotChoice } from "./resolve-side.ts";

export type ReviewChoice =
  /** `operator` means explicitly disabled; `unconfigured` means no selection was made. Before
   *  running a battery, drive-campaign reports the latter so judge:"off" has an explanation. */
  | { enabled: false; source: "unconfigured" | "operator" }
  | {
      enabled: true;
      kind: BackendKind;
      model: string | null;
      reasoningEffort?: string;
      providerPin?: string[];
      source: "operator" | "env" | "inherited-explicit";
    };

export type ResolvedSlots = {
  slug: string;
  builder: SlotChoice;
  built: SlotChoice;
  review: ReviewChoice;
  /** Repo-relative operator selection files this resolution read, highest precedence first, or
   *  null when none existed. Together with a slot's `source: "default"`, null records that
   *  the default was used without an operator file. */
  operatorConfig: string | null;
};

/** The kernel's ClaimStatement.backendPin string for the built side. */
export function backendPinOf(slots: ResolvedSlots): string {
  return backendConditionPin(slots.built);
}

export function resolveSlots(repoRoot: string, slug: string, repo: RepoEnv): ResolvedSlots {
  const selection = OperatorSelection.read(repoRoot, slug);
  const builder = resolveSide("builder", selection.pin("builder"), "HARNESS_BUILDER_BACKEND", repo);
  const built = resolveSide("built", selection.pin("built"), "HARNESS_BUILT_BACKEND", repo);
  const review = resolveReview(selection.pin("review"), repo, built);
  return { slug, builder, built, review, operatorConfig: selection.files.join(" over ") || null };
}

function resolveReview(pin: OperatorPin, repo: RepoEnv, built: SlotChoice): ReviewChoice {
  const { side: operator, path: operatorPath } = pin;
  if (operator !== undefined) {
    validateReviewOperator(operator, operatorPath);
    if (operator.disabled === true) return { enabled: false, source: "operator" };
    if (operator.model !== undefined) {
      throw new Error(
        `${operatorPath}: review.model is not an operator field — models resolve from named environment pins so each slot has one owner`,
      );
    }
    if (operator.inherit === true) {
      return {
        enabled: true,
        kind: built.kind,
        model: built.model,
        source: "inherited-explicit",
        ...keyIfTruthy("reasoningEffort", built.reasoningEffort),
        ...keyIfTruthy("providerPin", built.providerPin),
      };
    }
    if (operator.kind !== undefined) {
      const kind = requireKind(operator.kind, `${operatorPath}: review.kind`);
      requireVendoredTransport(kind, `${operatorPath}: review.kind`);
      return { enabled: true, ...resolvedSlot(kind, repo.env, "review", "operator"), source: "operator" };
    }
    throw new Error(
      `${operatorPath}: review must be {"kind": ...}, {"inherit": true}, or {"disabled": true} — an empty review object is ambiguous, and an absent one takes the standing default instead of turning the reviewers off`,
    );
  }
  const envName = "HARNESS_REVIEW_BACKEND";
  const fromEnv = repo.env[envName];
  if (fromEnv !== undefined) {
    if (fromEnv === "inherit") {
      return {
        enabled: true,
        kind: built.kind,
        model: built.model,
        source: "inherited-explicit",
        ...keyIfTruthy("reasoningEffort", built.reasoningEffort),
      };
    }
    const kind = requireKind(fromEnv, `env ${envName}`);
    requireVendoredTransport(kind, `env ${envName}`);
    return { enabled: true, ...resolvedSlot(kind, repo.env, "review", "env"), source: "env" };
  }
  return { enabled: false, source: "unconfigured" };
}

/**
 * Shared backend-slot resolver, so what a display shows and what a launch runs cannot disagree.
 *
 * Resolution rules, each of them a refusal to guess:
 * - One resolver reads only `loadRepoEnv`'s merged values, with no separate wrapper and no ambient
 *   env read, so the condition a run reports is the condition it resolved.
 * - The review slot inherits only when asked to: unconfigured means disabled, and following the
 *   built backend requires the explicit marker `{ "inherit": true }` in an operator file or
 *   `HARNESS_REVIEW_BACKEND=inherit`. The choice then carries `source: "inherited-explicit"`, so
 *   the evidence says the inheritance was chosen rather than fallen into.
 * - An unknown kind produces an error naming its source, because a typo that silently selected a
 *   different backend would be measured as the condition the operator thought they asked for.
 * - Operator files may not set models: the named environment pins are the descriptor registry's one
 *   model owner, the three independent Codex slots included.
 * - A provider with no resolved model, from neither an env override nor a default, is an error
 *   naming the env var, since an evaluation needs an identified model before it can start.
 * - A kind whose transport is unavailable is refused during resolution, and the transport's own
 *   no-turn preflight then verifies the CLI, the OAuth credential and support for the exact model.
 *   A resolver can never silently route a pin to another engine.
 * - The unconfigured default per slot is declared beside the completeness matrix in
 *   project-backend-policy.ts -- builder to claude, built to claude -- so the default and the
 *   slot-support check share one owner and cannot disagree about what a slot may serve.
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
  /** `operator` means explicitly disabled; `unconfigured` means no selection was ever made. The
   *  two are kept apart because `harness-measure.ts` reports the second before a battery runs, so
   *  a recorded `judge: "off"` has an explanation rather than looking like a choice. */
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
  /** Repo-relative operator selection files this resolution read, highest precedence first, or null
   *  when none existed. Together with a slot's `source: "default"`, that null is what records that
   *  the default was used because no operator file existed to say otherwise. */
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

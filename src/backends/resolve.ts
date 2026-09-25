/**
 * Backend slot resolution: which engine, model and reasoning effort serves each of the three model
 * slots -- Builder, Built Harness and review -- so what a display shows and what a launch runs
 * cannot disagree.
 *
 * Resolution rules, each of them a refusal to guess:
 * - One resolver reads only `loadRepoEnv`'s merged values, with no separate wrapper and no ambient
 *   env read, so the condition a run reports is the condition it resolved.
 * - Selection precedence per slot: the operator file's kind, then the environment pin, then the
 *   slot default declared below.
 * - The review slot inherits only when asked to: unconfigured means disabled, and following the
 *   built backend requires the explicit marker `{ "inherit": true }` in an operator file or
 *   `HARNESS_REVIEW_BACKEND=inherit`. Either spelling copies the Built slot's whole condition and
 *   carries `source: "inherited-explicit"`, so the evidence says the inheritance was chosen.
 * - An unknown kind produces an error naming its source, because a typo that silently selected a
 *   different backend would be measured as the condition the operator thought they asked for.
 * - Operator files may not set models: the named environment pins are the one model owner.
 * - Every kind serves every slot. The Builder and review slots run the one pi host session
 *   (pi-session.ts) with the campaign's host-enforced tools, and the Built slot runs pi in its
 *   confined child, so a kind is either unknown or runnable on any slot.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfTruthy } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { assertPathSegment } from "../meta/path-segment.ts";
import type { RepoEnv } from "./env.ts";
import { openRouterProviderPin } from "./openrouter-model.ts";
import { OPERATOR_BACKENDS_DIR, type OperatorPin, OperatorSelection } from "./operator-selection.ts";

/** The selectable engines, in canonical display order. A new kind is appended here first, and the
 *  tables below then refuse to compile until it has an entry. */
export const BACKEND_KINDS = ["codex", "openrouter", "claude"] as const;

/** A user/operator backend selection, and the engine a turn reports it ran on. */
export type BackendKind = (typeof BACKEND_KINDS)[number];

/** The three independently configured model slots. Each resolves its own model, so no slot ever
 *  serves on another's pin. `review` is one slot for several callers, which review-session.ts
 *  holds together: the Main Judge, the diagnosis reader and the Epoch Reviewer share one pin. */
export type BackendSlot = "builder" | "built" | "review";

/** What the operator may write for one slot: a kind, or for review alone an off switch or an
 *  explicit inheritance of the Built slot. */
export type ProjectBackendSelection = BackendKind | "disabled" | "inherit";

export type SlotChoice = {
  kind: BackendKind;
  /** Resolved provider model, recorded as part of the run condition even when selected by default. */
  model: string | null;
  /** The effort the slot serves at, pinned or from `KIND_DEFAULTS`. */
  reasoningEffort: string;
  /** Ordered exclusive upstream route, resolved once with the slot rather than reread later. */
  providerPin?: string[];
  source: "operator" | "env" | "default";
};

export type ReviewChoice =
  /** `operator` means explicitly disabled; `unconfigured` means no selection was ever made. The
   *  two are kept apart because `harness-measure.ts` reports the second before a battery runs, so
   *  a recorded `judge: "off"` has an explanation rather than looking like a choice. */
  | { enabled: false; source: "unconfigured" | "operator" }
  | (Omit<SlotChoice, "source"> & { enabled: true; source: "operator" | "env" | "inherited-explicit" });

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

/** Narrow an untrusted value (operator file, env var, form input) to a known kind. */
function isBackendKind(value: JsonValue): value is BackendKind {
  return isString(value) && BACKEND_KINDS.some((known) => known === value);
}

/**
 * Each kind's display name, model pins, default model and default reasoning effort per slot. This
 * table is the one owner of what an unpinned slot serves: `CODEX_MODEL`, `CODEX_BUILDER_MODEL`,
 * `CODEX_BUILT_MODEL` and `CODEX_REVIEW_MODEL` (and the `CLAUDE_*` equivalents) override the model,
 * and `<KIND>_<SLOT>_REASONING_EFFORT` overrides the effort. Each transport still validates the
 * resolved effort against the levels its model serves before a session starts.
 *
 * An unpinned codex slot measures Luna at xhigh on all three slots. An unpinned Built slot opens at
 * "medium" on Claude rather than "off", because a Built slot silently running without thinking
 * would be recorded as the same condition the other two slots named; OpenRouter keeps "off" there,
 * the level its preflight opens at, because a level that transport never requests would clear a
 * model the run cannot reach.
 */
const KIND_DEFAULTS = {
  codex: {
    label: "Codex",
    modelEnv: "CODEX_MODEL",
    slotModelPins: true,
    defaultModel: "gpt-5.6-luna",
    effort: { builder: "xhigh", built: "xhigh", review: "xhigh" },
  },
  openrouter: {
    label: "OpenRouter",
    modelEnv: "OPENROUTER_MODEL",
    slotModelPins: false,
    defaultModel: "inclusionai/ling-3.0-flash:free",
    effort: { builder: "medium", built: "off", review: "high" },
  },
  claude: {
    label: "Claude",
    modelEnv: "CLAUDE_MODEL",
    slotModelPins: true,
    defaultModel: "claude-opus-5",
    effort: { builder: "medium", built: "medium", review: "high" },
  },
} satisfies Record<
  BackendKind,
  {
    label: string;
    modelEnv: string;
    slotModelPins: boolean;
    defaultModel: string;
    effort: Record<BackendSlot, string>;
  }
>;

/** The model an unpinned slot of this kind serves. */
export function defaultModelOf(kind: BackendKind): string {
  return KIND_DEFAULTS[kind].defaultModel;
}

/** The environment variable that pins one slot's reasoning effort for one kind. */
export function reasoningEffortEnv(kind: BackendKind, slot: BackendSlot): string {
  return `${kind.toUpperCase()}_${slot.toUpperCase()}_REASONING_EFFORT`;
}

/** Defaults are independent of display order, so adding a kind cannot silently move a run. */
const SLOT_DEFAULTS = { builder: "claude", built: "claude" } as const satisfies Record<
  Exclude<BackendSlot, "review">,
  BackendKind
>;

export function backendConditionPin(choice: Pick<SlotChoice, "kind" | "model" | "providerPin">): string {
  const base = `${choice.kind}/${choice.model ?? "unresolved"}`;
  if (choice.kind !== "openrouter") return base;
  return `${base}@providers=${choice.providerPin?.join(",") ?? "unconstrained"}`;
}

/** The kernel's ClaimStatement.backendPin string for the built side. */
export function backendPinOf(slots: ResolvedSlots): string {
  return backendConditionPin(slots.built);
}

function requireKind(value: unknown, where: string): BackendKind {
  if (!isString(value) || !isBackendKind(value)) {
    throw new Error(
      `${where} names unknown backend kind ${capturedJsonStringify(value)}; choose one of [${BACKEND_KINDS.join(", ")}]`,
    );
  }
  return value;
}

function nonEmptyEnv(env: Record<string, string>, name: string): string | undefined {
  const pin = env[name];
  if (pin === undefined) return undefined;
  const normalized = pin.trim();
  if (!normalized) {
    throw new Error(`env ${name} is empty — a model or reasoning-effort pin must be non-empty`);
  }
  return normalized;
}

function resolveModel(kind: BackendKind, env: Record<string, string>, side: BackendSlot): string {
  const defaults = KIND_DEFAULTS[kind];
  const slotPin = defaults.slotModelPins ? `${kind.toUpperCase()}_${side.toUpperCase()}_MODEL` : null;
  return (
    (slotPin === null ? undefined : nonEmptyEnv(env, slotPin)) ??
    (side === "review" && kind !== "codex" ? nonEmptyEnv(env, "REVIEW_MODEL") : undefined) ??
    nonEmptyEnv(env, defaults.modelEnv) ??
    defaults.defaultModel
  );
}

export function resolvedSlot(
  kind: BackendKind,
  env: Record<string, string>,
  side: BackendSlot,
  source: SlotChoice["source"],
): SlotChoice {
  return {
    kind,
    model: resolveModel(kind, env, side),
    reasoningEffort: nonEmptyEnv(env, reasoningEffortEnv(kind, side)) ?? KIND_DEFAULTS[kind].effort[side],
    source,
    ...keyIfTruthy("providerPin", kind === "openrouter" ? openRouterProviderPin(env) : undefined),
  };
}

function resolveSide(side: "builder" | "built", pin: OperatorPin, repo: RepoEnv): SlotChoice {
  const { side: operator, path: operatorPath } = pin;
  if (operator?.model !== undefined) {
    throw new Error(
      `${operatorPath}: ${side}.model is not an operator field — models are denominated by the descriptor registry (env for slug engines) so run records stay comparable`,
    );
  }
  // `disabled` and `inherit` belong to the review slot, the only slot with an off state. Ignoring
  // either here would resolve this slot to the standing default with no sign that the operator had
  // asked for anything else -- a silent slot substitution, which is the defect class this whole
  // file refuses.
  for (const reviewOnly of ["disabled", "inherit"] as const) {
    if (operator?.[reviewOnly] !== undefined) {
      throw new Error(
        `${operatorPath}: ${side}.${reviewOnly} is review-only; choose a backend kind or remove the key`,
      );
    }
  }
  if (operator?.kind !== undefined) {
    const kind = requireKind(operator.kind, `${operatorPath}: ${side}.kind`);
    return resolvedSlot(kind, repo.env, side, "operator");
  }
  const envVar = `HARNESS_${side.toUpperCase()}_BACKEND`;
  const fromEnv = repo.env[envVar];
  if (fromEnv !== undefined) {
    return resolvedSlot(requireKind(fromEnv, `env ${envVar}`), repo.env, side, "env");
  }
  return resolvedSlot(SLOT_DEFAULTS[side], repo.env, side, "default");
}

export function resolveSlots(repoRoot: string, slug: string, repo: RepoEnv): ResolvedSlots {
  const selection = OperatorSelection.read(repoRoot, slug);
  const builder = resolveSide("builder", selection.pin("builder"), repo);
  const built = resolveSide("built", selection.pin("built"), repo);
  const review = resolveReview(selection.pin("review"), repo, built);
  return { slug, builder, built, review, operatorConfig: selection.files.join(" over ") || null };
}

/** The review slot following the Built slot: its whole served condition, provider route included,
 *  whichever of the operator file or the environment asked for it. */
function inheritBuilt({ kind, model, reasoningEffort, providerPin }: SlotChoice): ReviewChoice {
  return {
    enabled: true,
    kind,
    model,
    reasoningEffort,
    source: "inherited-explicit",
    ...keyIfTruthy("providerPin", providerPin),
  };
}

/** Review has three mutually exclusive modes, so declaring two is a refusal rather than a
 *  precedence puzzle. The boolean keys must be a literal `true`: `disabled: false` looks like an
 *  instruction and means nothing here, since an absent review key already says nobody chose, and
 *  the two readings of that spelling would be a silent difference in which slot ran. */
function validateReviewOperator(
  operator: { kind?: unknown; inherit?: unknown; disabled?: unknown },
  operatorPath: string | null,
): void {
  const choices = [operator.kind, operator.inherit, operator.disabled].filter((key) => key !== undefined);
  if (choices.length > 1) {
    throw new Error(`${operatorPath}: review must choose exactly one of kind, inherit, or disabled`);
  }
  if (operator.disabled !== undefined && operator.disabled !== true) {
    throw new Error(`${operatorPath}: review.disabled must be true when present`);
  }
  if (operator.inherit !== undefined && operator.inherit !== true) {
    throw new Error(`${operatorPath}: review.inherit must be true when present`);
  }
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
    if (operator.inherit === true) return inheritBuilt(built);
    if (operator.kind !== undefined) {
      const kind = requireKind(operator.kind, `${operatorPath}: review.kind`);
      return { ...resolvedSlot(kind, repo.env, "review", "operator"), enabled: true, source: "operator" };
    }
    throw new Error(
      `${operatorPath}: review must be {"kind": ...}, {"inherit": true}, or {"disabled": true} — an empty review object is ambiguous, and an absent one takes the standing default instead of turning the reviewers off`,
    );
  }
  const envName = "HARNESS_REVIEW_BACKEND";
  const fromEnv = repo.env[envName];
  if (fromEnv === undefined) return { enabled: false, source: "unconfigured" };
  if (fromEnv === "inherit") return inheritBuilt(built);
  const kind = requireKind(fromEnv, `env ${envName}`);
  return { ...resolvedSlot(kind, repo.env, "review", "env"), enabled: true, source: "env" };
}

/** The choices an operator surface offers for one slot, in display order. */
export function projectBackendChoices(
  slot: BackendSlot,
): { value: ProjectBackendSelection; label: string }[] {
  const kinds = BACKEND_KINDS.map((kind) => ({ value: kind, label: KIND_DEFAULTS[kind].label }));
  if (slot !== "review") return kinds;
  return [
    { value: "disabled", label: "Disabled" },
    { value: "inherit", label: "Same as Built Harness" },
    ...kinds,
  ];
}

export function assertProjectBackendSelection(slot: BackendSlot, selection: ProjectBackendSelection): void {
  if (selection === "disabled" || selection === "inherit") {
    if (slot !== "review") throw new Error(`${slot} cannot be ${selection}`);
    return;
  }
  if (!isBackendKind(selection)) throw new Error(`unknown backend ${capturedJsonStringify(selection)}`);
}

export function operatorBackendsPath(repoRoot: string, projectId: string): string {
  try {
    assertPathSegment("project", projectId);
  } catch {
    throw new Error(`project id ${capturedJsonStringify(projectId)} is invalid; use one path segment`);
  }
  return join(repoRoot, OPERATOR_BACKENDS_DIR, `${projectId}.json`);
}

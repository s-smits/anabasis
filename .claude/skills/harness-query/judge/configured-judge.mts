/**
 * The judge backend: whatever review slot this repository is already configured with.
 *
 * It resolves nothing itself. `open` returns `undefined`, which is measureHarness's "resolve the
 * configured review slot" state, so the census session is opened by the same `judgeSessionFor`
 * call the controller makes during a real battery — claude, codex or openrouter, from
 * `.harness/backends/<slug>.json` over `default.json` over `HARNESS_REVIEW_BACKEND`. That path is
 * the product's, and this file adds nothing to it beyond a line saying which slot answered.
 *
 * Spend is the configured account's: a Claude or Codex review slot bills the same credential a
 * full run would.
 *
 * Models stay with their one owner. Operator files may not name a model, so `--judge-model` and
 * `--judge-effort` are applied as the named environment pins the resolver reads (`REVIEW_MODEL`
 * and `<KIND>_REVIEW_REASONING_EFFORT`), never as a second model source.
 */
import { loadRepoEnv } from "#src/backends/env.ts";
import { reasoningEffortEnv } from "#src/backends/effort-envs.ts";
import { resolveSlots } from "#src/backends/resolve.ts";
import type { JudgeContext, JudgeFlags, JudgeProfile, JudgeSlot } from "./judge-option.mts";

/** The review slot this repository resolves for that battery, with the file or env that chose it. */
function resolvedReview(context: JudgeContext) {
  const repo = loadRepoEnv(context.repoRoot);
  const slots = resolveSlots(context.repoRoot, context.slug, repo);
  return { review: slots.review, operatorConfig: slots.operatorConfig };
}

function describe(context: JudgeContext): string {
  const { review, operatorConfig } = resolvedReview(context);
  if (!review.enabled) {
    return (
      `judge configured — but the review slot is ${review.source === "operator" ? "explicitly disabled" : "unconfigured"}` +
      `; pin one in .harness/backends/default.json or HARNESS_REVIEW_BACKEND, or use --judge off`
    );
  }
  // `+` binds tighter than `===`, so writing this as one expression compared the whole prefix with
  // `undefined` and printed only the effort clause. Each optional clause is its own binding.
  const effort = review.reasoningEffort === undefined ? "" : ` at ${review.reasoningEffort}`;
  const source = `${review.source}${operatorConfig === null ? "" : `, ${operatorConfig}`}`;
  return (
    `judge configured — ${review.kind}/${review.model ?? "unresolved"}${effort}` +
    ` (source: ${source}); spends that account's credential`
  );
}

/** Apply the flag pins to the process environment, which the resolver reads first, then hand the
 *  slot back to measureHarness unresolved. */
function open(flags: JudgeFlags, context: JudgeContext): Promise<JudgeSlot> {
  if (flags.model !== null) Bun.env.REVIEW_MODEL = flags.model;
  if (flags.effort !== null) {
    const { review } = resolvedReview(context);
    if (!review.enabled) throw new Error("--judge-effort needs an enabled review slot; see the line above");
    const name = reasoningEffortEnv(review.kind, "review");
    if (name === undefined) throw new Error(`the ${review.kind} review slot has no reasoning-effort pin`);
    Bun.env[name] = flags.effort;
  }
  return Promise.resolve(undefined);
}

export function configuredJudgeProfile(flags: JudgeFlags): JudgeProfile {
  return {
    name: "configured",
    describe,
    open: (context) => open(flags, context),
  };
}

/**
 * The `--judge` flag for harness-query: which reviewer, if any, sees the artifacts this battery
 * ships.
 *
 * One file per judge backend, so switching is a flag and never an edit:
 *
 *   off         no census at all (the standing default; the battery records judge:"off")
 *   configured  the repository's own review slot — .harness/backends/<slug>.json over
 *               default.json over HARNESS_REVIEW_BACKEND (configured-judge.mts)
 *
 * A profile only chooses and opens a reviewer. The Judge stays advisory everywhere: it cannot
 * change a verdict, a pass, a claim or an adoption, and harness-query writes none of those.
 */
import type { JudgeSession } from "#src/review/judge.ts";

/** measureHarness's judge tri-state: `null` disables the census, `undefined` makes it resolve the
 *  configured review slot, and a session is the one this profile opened itself. */
export type JudgeSlot = JudgeSession | null | undefined;

/** What a profile may read about the battery it is about to review. The slug is the probe slug
 *  measureHarness runs under, so a slot resolved for display is the slot that will serve. */
export interface JudgeContext {
  repoRoot: string;
  slug: string;
}

export interface JudgeProfile {
  name: string;
  /** One line printed before any turn is spent: who reviews, on what, at whose cost. */
  describe(context: JudgeContext): string;
  /** Opened after the probe bundle is derived and before the battery runs. */
  open(context: JudgeContext): Promise<JudgeSlot>;
}

export interface JudgeFlags {
  /** Profile name from `--judge`; the default keeps harness-query's historical judge-off battery. */
  profile: string;
  /** `--judge-model`: the reviewing model. */
  model: string | null;
  /** `--judge-effort`: reasoning effort for that reviewer. */
  effort: string | null;
}

export const JUDGE_FLAG_DEFAULTS: JudgeFlags = { profile: "off", model: null, effort: null };

/** No reviewer. Kept here rather than in a file of its own: `off` is the absence of a judge
 *  backend, not another one. */
const offProfile: JudgeProfile = {
  name: "off",
  describe: () => 'judge off — the battery records judge:"off" and no artifact is reviewed',
  open: () => Promise.resolve(null),
};

export async function judgeProfileFor(flags: JudgeFlags): Promise<JudgeProfile> {
  if (flags.profile === "off") {
    if (flags.model !== null || flags.effort !== null) {
      throw new Error("--judge-model and --judge-effort need a judge; pass --judge configured");
    }
    return offProfile;
  }
  if (flags.profile === "configured") {
    const { configuredJudgeProfile } = await import("./configured-judge.mts");
    return configuredJudgeProfile(flags);
  }
  throw new Error(`unknown --judge ${flags.profile}; choose off or configured`);
}

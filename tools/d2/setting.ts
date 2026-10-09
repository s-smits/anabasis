/**
 * A campaign's setting, named once for every command that solves: who solves, and the wall and the
 * turns a solve is held to, as four flags with one set of defaults.
 *
 *   --solver claude/claude-sonnet-5-5   the model that solves in the stored cycle's place
 *   --solver-effort high                its effort, read beside --solver and not without it
 *   --solve-minutes 120                 the wall of one solve
 *   --solve-turns 24                    the prompts a solver is given before a solve stops without an answer
 *
 * A round, a checkpoint, a rehearsal and the launcher all read these four here, and nothing else
 * names who solves a campaign's tasks or what a solve is held to. So every command of a campaign
 * reads the same setting when it is given the same flags, and no two can measure different solvers
 * by accident. The defaults are the stored cycle's own model and effort and the stored sweep's
 * limits (`campaign.ts`, `LIMITS`).
 *
 * Name the same four on every command of a campaign. They are part of the solver's setting
 * (`src/kernel/condition.ts`), and a solver that is another model, at another effort or under
 * other limits is another solver. Moving any of the four costs no solve: every comparison solves
 * both of its harnesses afresh, whatever the setting (`src/builder/round.ts`). What it costs is
 * what the earlier comparisons measured. Their tallies, the share of tasks they left untied and
 * the cost of a solve were measured of another solver, and the size of the next comparison cannot
 * be read from them.
 *
 * What does not follow the solver is the campaign's own: a task's state and the harnesses it
 * keeps. The concurrency and the disk cap stay the sweep's: neither is what a harder task runs out
 * of first, and each is one more thing two comparisons could differ in. A rehearsal seats a script
 * where the solver sits and refuses `--solver`; its limits are these.
 *
 * The shell's two timeouts are the sweep's as far as the wall leaves room for them
 * (`commandSeconds`). They ignored the wall until 2026-10-09: under the five-minute wall of the one
 * comparison that read a step, a command was allowed 300 s by default and 900 s at most, so none a
 * solver started could be cut and handed back to it before the solve itself ended.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { Limits } from "#src/kernel/condition.ts";
import type { solverLast } from "#src/kernel/solves.ts";
import { LIMITS } from "./campaign.ts";

/** What the four flags name, as `openCampaign` takes it: the solver in the stored cycle's place,
 *  or none, and the limits of every solve. */
export interface NamedSetting {
  readonly solver: { readonly model: string; readonly effort: ThinkingLevel } | undefined;
  readonly limits: Limits;
}

/** Where the notes send their reader for what a restart costs. */
const DOCUMENTED = "tools/d2/setting.ts";

/** The four flags, as every command of a campaign takes them. The limits' defaults are `LIMITS`'s,
 *  spelled out so that a command's `--help` and its source say them; a test holds the two together.
 *  `--solver` has none: without it the solver is the stored cycle's own. */
export const SETTING_OPTIONS = {
  solver: { type: "string" },
  "solver-effort": { type: "string", default: "high" },
  "solve-minutes": { type: "string", default: "120" },
  "solve-turns": { type: "string", default: "24" },
} as const;

/**
 * What those four flags name. `--solver-effort` without `--solver` names nothing, as it never did:
 * the cycle's model solves at the cycle's effort. A wall or a turn cap that is no whole number of
 * at least one is refused: a fraction of a minute would hash to a setting nobody could name again.
 */
export function settingNamed(values: {
  readonly solver?: string | undefined;
  readonly "solver-effort": string;
  readonly "solve-minutes": string;
  readonly "solve-turns": string;
}): NamedSetting {
  const [minutes, turns] = [Number(values["solve-minutes"]), Number(values["solve-turns"])];
  if (!Number.isInteger(minutes) || minutes < 1 || !Number.isInteger(turns) || turns < 1) {
    throw new Error(
      `--solve-minutes ${values["solve-minutes"]} --solve-turns ${values["solve-turns"]}: a solve's wall and its turns are whole numbers of at least one`,
    );
  }
  // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
  const effort = values["solver-effort"] as ThinkingLevel;
  const wallSeconds = minutes * 60;
  return {
    solver: values.solver === undefined ? undefined : { model: values.solver, effort },
    limits: { ...LIMITS, wallSeconds, turns, ...commandSeconds(wallSeconds) },
  };
}

/**
 * How long one command may run under a wall: the sweep's two limits, 300 s where a command names
 * no timeout and 900 s at most, each held to a share of the wall, a quarter and a half. So a
 * command that names nothing can be cut and returned four times in a solve, and the longest one a
 * solver may ask for leaves it half its time. From a wall of half an hour up both are the sweep's
 * own. Each is at least a second.
 */
export function commandSeconds(wallSeconds: number): Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds"> {
  const held = (most: number, share: number) => Math.max(1, Math.min(most, Math.floor(wallSeconds / share)));
  return {
    shellDefaultSeconds: held(LIMITS.shellDefaultSeconds, 4),
    shellMaxSeconds: held(LIMITS.shellMaxSeconds, 2),
  };
}

/**
 * What a reader should know when a command would solve as another solver, or under other limits,
 * than the log's last test-side solves ran as (`solverLast`): what the comparisons so far measured
 * was measured of that other solver. `solver` is who the command solves as, where the caller knows: a
 * launch that names no `--solver` solves as the stored cycle's, which it does not open, so it says
 * nothing of the solver then. Another host's code, pins or prices are another setting too, and are
 * not read here: a log's conditions hold them, and no flag names them.
 */
export function restarts(
  named: {
    readonly solver?: { readonly model: string; readonly effort: string } | undefined;
    readonly limits: Limits;
  },
  ran: ReturnType<typeof solverLast>,
): string[] {
  if (ran === null) return [];
  const { solver, limits } = named;
  const held = (to: Limits) => `${String(to.wallSeconds / 60)} minutes and ${String(to.turns)} turns`;
  const costs = `the tallies, the tie share and the cost of a solve on record are another setting's, and say little of this comparison (${DOCUMENTED})`;
  return [
    ...(solver !== undefined && (solver.model !== ran.model || solver.effort !== ran.effort)
      ? [
          `solves here are ${solver.model} at ${solver.effort}, and the log's last test-side solves were ${ran.model} at ${ran.effort}: ${costs}`,
        ]
      : []),
    ...(limits.wallSeconds !== ran.limits.wallSeconds || limits.turns !== ran.limits.turns
      ? [
          `a solve here is held to ${held(limits)}, and the log's last test-side solves ran under ${held(ran.limits)}: ${costs}`,
        ]
      : []),
  ];
}

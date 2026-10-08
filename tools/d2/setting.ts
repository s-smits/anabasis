/**
 * A campaign's setting, named once for every command of it: who solves, and the wall and the turns
 * a solve is held to, as four flags with one set of defaults.
 *
 *   --solver claude/claude-sonnet-5-5   the model that solves in the stored cycle's place
 *   --solver-effort high                its effort, read beside --solver and not without it
 *   --solve-minutes 120                 the wall of one solve
 *   --solve-turns 24                    the prompts a solver is given before a solve stops without an answer
 *
 * A round, an Examiner session, `prepare.ts`, a rehearsal and the launcher all read these four
 * here, and nothing else names who solves a campaign's tasks or what a solve is held to. So every
 * command of a campaign reads the same setting when it is given the same flags, and no two can
 * measure different solvers by accident. The defaults are the stored cycle's own model and effort
 * and the stored sweep's limits (`campaign.ts`, `LIMITS`): a command that names none of the four
 * runs under exactly the setting every campaign ran under before the flags existed.
 *
 * Until 2026-10-08 the limits were a constant, and a task whose solves only ran out of time was
 * set aside for good under a wall nobody could move. A round alone took `--solver` and
 * `--solver-effort`, and `prepare.ts` and an Examiner session took neither. A simulated walk of
 * that day ran a round under another solver: `prepare.ts` then read the campaign's default
 * setting and placed nothing, seven tasks `no solve has placed` where the investigation's reader,
 * which takes the latest test-side solve's setting, read seven the harness clears, and an Examiner
 * session's solves would have been another solver's than the one the round measured.
 *
 * Name the same four on every command of a campaign. They are part of the solver's setting
 * (`src/kernel/condition.ts`), and a solver that is another model, at another effort or under
 * other limits is another solver. A campaign run under two solvers therefore has two sets of
 * standings: each solver's solves place tasks for it alone (`src/kernel/ladder.ts`), and nothing
 * one placed is placed for the other. What moving any of the four costs is counted in solves:
 *
 * - No standing carries over. A round under an unchanged setting reads the parent's solves on
 *   record: a task they stop is carried with no solve, and a task they clear is solved under the
 *   child alone. Under a new one nothing is on record, so each task the round screens is solved
 *   `--screen` times under each harness: at the defaults six solves a task, where a carried task
 *   cost none and a cleared one three. A round screens until its `--target` is filled, so the most
 *   this adds is `--screen` solves for every pool task the old setting had placed, and as many
 *   again for each the round would have carried.
 * - A reach task whose last stronger solve ran under another setting is put to the stronger
 *   solver again by the next Examiner session, up to its `--reach`: one stronger solve a task.
 *   Other limits are another setting for the stronger solver too. Another measured solver is not,
 *   except through its effort: the stronger solver runs at the measured one's effort unless
 *   `--strong-effort` names its own (`tools/d1b/examine.ts`).
 * - A task set aside as `wall-bound` under a shorter wall returns to the pool, where a round
 *   screens it again (`src/kernel/limits.ts`, `prepare.ts`).
 *
 * What does not follow the solver is the campaign's own: a task's state and the frontier. A task
 * one solver's round retired as too easy, or set aside as wall-bound, is so for the other, and the
 * harness the campaign stands on is the last step's, whichever solver's round read it.
 *
 * Scoring and anchor solves are made fresh by every round, and cost what they did. The other
 * limits, the shell's two timeouts, the concurrency and the disk cap, stay the sweep's: none of
 * them is what a harder task runs out of first, and each is one more thing two rounds could differ
 * in. A rehearsal seats a script where the solver sits and refuses `--solver`; its limits are
 * these.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { Limits } from "#src/kernel/condition.ts";
import type { solverLast } from "#src/kernel/wall.ts";
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
  return {
    solver: values.solver === undefined ? undefined : { model: values.solver, effort },
    limits: { ...LIMITS, wallSeconds: minutes * 60, turns },
  };
}

/**
 * What a reader should know when a command would solve as another solver, or under other limits,
 * than the log's last test-side solves ran as (`solverLast`): that solver's standings are not this
 * one's. `solver` is who the command solves as, where the caller knows: `prepare.ts` has opened the
 * campaign and does, and a launch that names no `--solver` solves as the stored cycle's, which it
 * does not open, so it says nothing of the solver then. Another host's code, pins or prices are
 * another setting too, and are not read here: a log's conditions hold them, and no flag names them.
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
  return [
    ...(solver !== undefined && (solver.model !== ran.model || solver.effort !== ran.effort)
      ? [
          `solves here are ${solver.model} at ${solver.effort}, and the log's last test-side solves were ${ran.model} at ${ran.effort}: another solver's standings do not carry over, so nothing those solves placed is placed here and a round solves each task it screens under both harnesses (${DOCUMENTED})`,
        ]
      : []),
    ...(limits.wallSeconds !== ran.limits.wallSeconds || limits.turns !== ran.limits.turns
      ? [
          `a solve here is held to ${held(limits)}, and the log's last test-side solves ran under ${held(ran.limits)}: under other limits no standing carries over, so each task screened is solved under both harnesses and each reach task is put to the stronger solver again (${DOCUMENTED})`,
        ]
      : []),
  ];
}

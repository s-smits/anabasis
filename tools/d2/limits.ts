/**
 * A campaign's limits, named once for every command of it: the wall and the turns a solve is held
 * to, as two flags with one set of defaults.
 *
 *   --solve-minutes 120   the wall of one solve
 *   --solve-turns 24      the prompts a solver is given before a solve stops without an answer
 *
 * A round, an Examiner session, `prepare.ts`, a rehearsal and the launcher all read these two and
 * nothing else names a solve's limits, so no two commands of one campaign can hold a solver to
 * different ones by accident. The defaults are the stored sweep's (`campaign.ts`, `LIMITS`), and a
 * command that names neither flag runs under exactly the limits every campaign ran under before
 * the flags existed. Until 2026-10-08 they were a constant, and a task whose solves only ran out of
 * time was set aside for good under a wall nobody could move.
 *
 * Name the same two on every command of a campaign. The limits are part of the solver's setting
 * (`src/kernel/condition.ts`), so a solver under other limits is another solver, and what that
 * costs is counted in solves:
 *
 * - No standing carries over (`src/kernel/ladder.ts`). A round under unchanged limits reads the
 *   parent's solves on record: a task they stop is carried with no solve, and a task they clear is
 *   solved under the child alone. Under new limits nothing is on record, so each task the round
 *   screens is solved `--screen` times under each harness: at the defaults six solves a task,
 *   where a carried task cost none and a cleared one three. A round screens until its `--target`
 *   is filled, so the most this adds is `--screen` solves for every pool task the old limits had
 *   placed, and as many again for each the round would have carried.
 * - Every reach task's last stronger solve ran under other limits, so the next Examiner session
 *   puts each to the stronger solver again, up to its `--reach`: one stronger solve a task.
 * - A task set aside as `wall-bound` under a shorter wall returns to the pool, where a round
 *   screens it again (`src/kernel/limits.ts`, `prepare.ts`).
 *
 * Scoring and anchor solves are made fresh by every round, and cost what they did. The other
 * limits, the shell's two timeouts, the concurrency and the disk cap, stay the sweep's: none of
 * them is what a harder task runs out of first, and each is one more thing two rounds could differ
 * in.
 */
import type { Limits } from "#src/kernel/condition.ts";
import { LIMITS } from "./campaign.ts";

/** The two flags, as every command of a campaign takes them. The defaults are `LIMITS`'s, spelled
 *  out so that a command's `--help` and its source say them; a test holds the two together. */
export const LIMITS_OPTIONS = {
  "solve-minutes": { type: "string", default: "120" },
  "solve-turns": { type: "string", default: "24" },
} as const;

/** The limits those two flags name. A wall or a turn cap that is no whole number of at least one is
 *  refused: a fraction of a minute would hash to a setting nobody could name again. */
export function limitsNamed(values: {
  readonly "solve-minutes": string;
  readonly "solve-turns": string;
}): Limits {
  const [minutes, turns] = [Number(values["solve-minutes"]), Number(values["solve-turns"])];
  if (!Number.isInteger(minutes) || minutes < 1 || !Number.isInteger(turns) || turns < 1) {
    throw new Error(
      `--solve-minutes ${values["solve-minutes"]} --solve-turns ${values["solve-turns"]}: a solve's wall and its turns are whole numbers of at least one`,
    );
  }
  return { ...LIMITS, wallSeconds: minutes * 60, turns };
}

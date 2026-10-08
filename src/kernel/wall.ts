/**
 * Whether the wall binds: a reading of the log from where the solver stands.
 *
 * A harder exam asks for longer solves, and a wall that was ample for the first tasks then decides
 * results the harness did not. v1 read the share of its wall a solve used as the measure that
 * moves on every battery and leads a fail: 18.6% against 6.6% in truss batteries that went on to
 * fail a case, and the opposite in firmware, where fails at 1.5% of the wall were not the solver's
 * (lane 26 of the investigation's catalogue). So the share is read for passes and for fails apart,
 * beside the two counts a wall leaves in a campaign's task sets: pool tasks whose only fails where
 * the solver stands ended at the wall (`walled`, `ladder.ts`), and tasks a round's screening set
 * aside as `wall-bound` (`task.ts`).
 *
 * It is a reading and names no wall to run under. v1 measured what a distance from a limit does
 * when it is given to whoever can move the limit: an author told each answer's distance from its
 * limit moved limits (v1 `AGENTS.md`, "Tried and taken out"). The counts are for the operator, and
 * no session is told them.
 */
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { median } from "../meta/tally.ts";
import { plural } from "../meta/text.ts";
import { conditionsOf, type Limits, settingId } from "./condition.ts";
import { ladder, type Rule, type Stand } from "./ladder.ts";
import { limitsIn, roomier } from "./limits.ts";
import type { LogEvent } from "./log.ts";
import { taskSets } from "./task.ts";

/** One solve's time against the wall it ran under. */
export interface Timed {
  readonly seconds: number;
  readonly wallSeconds: number;
}

/** Tasks a wall has marked: of so many in the pool, the ones standing walled, and the ones set
 *  aside as wall-bound, which are outside the pool. */
interface Marked {
  readonly pool: number;
  readonly walled: number;
  readonly bound: number;
}

export interface WallReading extends Marked {
  /** The wall-bound tasks the solver's limits would return to the pool: bound under a shorter wall
   *  and nothing roomier (`limits.ts`). */
  readonly returning: number;
  /** The same three counts over the tasks Examiner sessions wrote. */
  readonly written: Marked;
  /** The solver's counted solves under this harness and setting, whatever their task: how many
   *  passed and failed, the median share of the wall each kind used, null for none timed, and the
   *  fails the wall ended. A broken harness's fails are no solve's time and are left out. */
  readonly passes: { readonly solves: number; readonly share: number | null };
  readonly fails: { readonly solves: number; readonly share: number | null; readonly atWall: number };
}

/** The median share of its wall a set of solves used, or null for none under a wall. The
 *  investigation's reader takes its lane 26 shares from here too (`tools/wri/read.ts`). */
export function wallShare(solves: readonly Timed[]): number | null {
  return median(
    solves.flatMap((solve) => (solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : [])),
  );
}

/** Who solved last on the test side of a log, and under what limits: the model, the effort and the
 *  limits of the condition its last test-side solve started under, or null before any. It is what a
 *  command about to solve as another solver, or under other limits, is set against
 *  (`tools/d2/setting.ts`). */
export function solverLast(
  events: readonly LogEvent[],
): { readonly model: string; readonly effort: string; readonly limits: Limits } | null {
  const tested = new Map(
    events.flatMap(({ kind, data }) => {
      const condition = asRecord(data.condition);
      return kind === "condition.recorded" && isString(data.id) && condition?.side === "test"
        ? [[data.id, condition] as const]
        : [];
    }),
  );
  const started = events.findLast(
    ({ kind, data }) => kind === "solve.started" && isString(data.condition) && tested.has(data.condition),
  )?.data.condition;
  const ran = tested.get(isString(started) ? started : "");
  const limits = limitsIn(ran?.limits);
  return ran !== undefined && isString(ran.model) && isString(ran.effort) && limits !== null
    ? { model: ran.model, effort: ran.effort, limits }
    : null;
}

/** The wall-bound task versions a campaign whose solver runs under `limits` returns to its pool:
 *  the ones the task fold would let go (`task.ts`). */
export function returning(events: readonly LogEvent[], limits: Limits): string[] {
  return [...taskSets(events).bound].flatMap(([version, under]) =>
    under !== null && roomier(limits, under) ? [version] : [],
  );
}

/** The Examiner sessions whose measured solver ran under limits that `limits` have outgrown
 *  (`roomier`): a word of theirs that rests on the wall is a word about a shorter one. A session
 *  whose limits the log does not hold, one logged before sessions named their setting among them,
 *  is not one of these. */
export function outgrown(events: readonly LogEvent[], limits: Limits): Set<string> {
  const under = new Map(
    [...conditionsOf(events).values()].map((condition) => [settingId(condition), condition.limits] as const),
  );
  return new Set(
    events.flatMap(({ kind, data }) => {
      const then = under.get(isString(data.setting) ? data.setting : "");
      return kind === "exam.started" && isString(data.session) && then !== undefined && roomier(limits, then)
        ? [data.session]
        : [];
    }),
  );
}

/** What the wall has marked and how much of it the solver's solves used, where the solver stands.
 *  `limits` are the ones its next solves would run under. */
export function wallReading(
  events: readonly LogEvent[],
  stand: Stand,
  given: { readonly rule: Rule; readonly limits: Limits },
): WallReading {
  const { pool } = ladder(events, stand, given.rule);
  const { bound } = taskSets(events);
  const written = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "task.proposed" && isString(data.session) && isString(data.version) ? [data.version] : [],
    ),
  );
  const marked = (kept: (version: string) => boolean): Marked => ({
    pool: Object.values(pool).reduce((sum, versions) => sum + versions.filter(kept).length, 0),
    walled: pool.walled.filter(kept).length,
    bound: [...bound.keys()].filter(kept).length,
  });
  const walls = new Map(
    [...conditionsOf(events)].flatMap(([id, condition]) =>
      condition.harness === stand.harness && settingId(condition) === stand.setting
        ? [[id, condition.limits.wallSeconds] as const]
        : [],
    ),
  );
  const ran = new Map(
    events.flatMap(({ kind, data }) => {
      const wall = walls.get(isString(data.condition) ? data.condition : "");
      return kind === "solve.started" && isString(data.solve) && wall !== undefined
        ? [[data.solve, wall] as const]
        : [];
    }),
  );
  const ended = events.flatMap(({ kind, data }) => {
    const wallSeconds = ran.get(isString(data.solve) ? data.solve : "");
    const ending = asRecord(data.ending);
    const counted =
      ending?.outcome === "pass" || (ending?.outcome === "fail" && ending.kind !== "broken-harness");
    return kind === "solve.finished" && wallSeconds !== undefined && counted
      ? [
          {
            pass: ending.outcome === "pass",
            atWall: ending.kind === "wall-ended",
            timed: isNumber(data.seconds) ? [{ seconds: data.seconds, wallSeconds }] : [],
          },
        ]
      : [];
  });
  const [passes, fails] = [ended.filter(({ pass }) => pass), ended.filter(({ pass }) => !pass)];
  return {
    ...marked(() => true),
    returning: returning(events, given.limits).length,
    written: marked((version) => written.has(version)),
    passes: { solves: passes.length, share: wallShare(passes.flatMap(({ timed }) => timed)) },
    fails: {
      solves: fails.length,
      share: wallShare(fails.flatMap(({ timed }) => timed)),
      atWall: fails.filter(({ atWall }) => atWall).length,
    },
  };
}

/** That reading in one line, beside the wall the solver's next solves would run under. It says
 *  what was counted and recommends no wall. */
export function wallLine(read: WallReading, limits: Limits): string {
  const percent = (share: number | null) =>
    share === null ? "an untimed share" : `${(share * 100).toFixed(1)}%`;
  const solved =
    read.passes.solves + read.fails.solves === 0
      ? "no solve under these limits is on record against this harness"
      : `its ${plural(read.passes.solves, "passing solve")} here used a median ${percent(read.passes.share)} of the wall and its ${plural(read.fails.solves, "failed solve")} ${percent(read.fails.share)}, ${String(read.fails.atWall)} ended by it`;
  return `against a wall of ${String(limits.wallSeconds / 60)} minutes: ${String(read.walled)} of ${plural(read.pool, "pool task")} walled, ${plural(read.bound, "task")} set aside as wall-bound outside the pool (Examiner sessions wrote ${String(read.written.pool)} of the pool, ${String(read.written.walled)} of the walled and ${String(read.written.bound)} of the wall-bound); ${solved}`;
}

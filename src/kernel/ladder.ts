/**
 * The ladder: the harness a campaign stands on, and how each task stands against it.
 *
 * A climb is two lines that move. A harness change lifts the pass rate, and an exam that asks more
 * drops it again. v1 moved the second line by prose alone: after a battery passed whole, its
 * Builder read that the next one had to demand more and carry no task forward unchanged, and no
 * code chose a task by how the solver had done on it. On 2026-09-30, 570 of the 1,465 tasks v1
 * measured after a full pass were carried unchanged, a failed task was dropped or eased three times
 * in six, and a fail became a harness change once in six (v1 `AGENTS.md`, "Open gaps").
 *
 * Here the second line is read from the log. The frontier is the harness the last step left. A
 * task stands against a harness by the solves the log already holds of it under that harness:
 * it stops the harness, the harness clears it, or nobody knows yet. Every part of a campaign that
 * chooses tasks reads this one view: a round carries the tasks its parent still fails and retires
 * the ones both its harnesses pass (`src/builder/round.ts`), a reach task is witnessed again when
 * the frontier has moved (`src/examiner/session.ts`), an Examiner is told how its earlier tasks
 * stand now (`src/examiner/record.ts`), and practice is drawn from what the frontier fails
 * (`tools/d2/prepare.ts`).
 *
 * Nothing here decides a comparison. A standing only chooses what is solved next, as screening
 * does: the solves that score a task are made fresh, after its admission, and never the ones that
 * placed it.
 */
import { asRecord, isString, type JsonObject } from "../meta/json-shape.ts";
import { conditionsOf, settingId } from "./condition.ts";
import type { LogEvent } from "./log.ts";
import type { Counted } from "./solve.ts";
import { taskSets } from "./task.ts";

/** Gate 5's rule: the solves of a task under a harness that are read, and the fails that stop it. */
export interface Rule {
  readonly solves: number;
  readonly fails: number;
}

/**
 * Where a solver stands: a harness by its digest, and the setting its solves ran under
 * (`settingId`). Only solves under both are read as this solver's against this harness, so a
 * change of model, effort, limits or host code places no task and reuses no solve.
 */
export interface Stand {
  readonly harness: string;
  readonly setting: string;
}

/** How a task stands against a harness: it stops it, the harness clears it, its only fails ended at
 *  the wall, or the log holds too few solves to say. */
export type Standing = "stops" | "clears" | "walled" | "unknown";

export interface Ladder {
  /** The pool, feasible tasks held or admitted outside the anchor, by standing. */
  readonly pool: Readonly<Record<Standing, readonly string[]>>;
  /** Tasks with no witness yet: no stronger solve of them has been accepted. */
  readonly reach: readonly string[];
  /** Released tasks the harness is not known to clear: what a Builder can still learn from. */
  readonly practice: readonly string[];
}

/** The kinds of fail a solver owns outright, as `solve.ts` types them. */
const FAILS = ["rejected", "wall-ended", "context-ended", "no-answer"] as const;

/**
 * The harness a campaign stands on: the one the last round that read `step` left, by its digest,
 * or null while no round has. A report a person's labels settled is its round's last, so a step
 * settled away moves nothing and one settled in does. A reading short of a step, an anchor too
 * thin to test among them, leaves the frontier where it was: whether to build on such a harness is
 * the operator's, by naming it.
 */
export function frontierOf(events: readonly LogEvent[]): string | null {
  const fresh = lastReports(events).findLast(({ data }) => data.reading === "step" && isString(data.fresh))
    ?.data.fresh;
  return isString(fresh) ? fresh : null;
}

/** Each session's last report in a log, in the order those reports were written, with where each
 *  stands in it. A round writes one, and a person's settling writes its round's again. */
export function lastReports(
  events: readonly LogEvent[],
): { readonly session: string; readonly index: number; readonly data: JsonObject }[] {
  const last = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "comparison.reported" && isString(data.session)) last.set(data.session, index);
  }
  return [...last]
    .sort(([, a], [, b]) => a - b)
    .flatMap(([session, index]) => {
      const data = events[index]?.data;
      return data === undefined ? [] : [{ session, index, data }];
    });
}

/** A task version's counted solves where a solver stands, each with how it ended, oldest first. A
 *  setting holds its side, so a test solver's stand reads no stronger solve. */
export function solvesOf(
  events: readonly LogEvent[],
  version: string,
  stand: Stand,
): { readonly solve: string; readonly ending: Counted }[] {
  const under = new Set(
    [...conditionsOf(events)].flatMap(([id, condition]) =>
      condition.task === version &&
      condition.harness === stand.harness &&
      settingId(condition) === stand.setting
        ? [id]
        : [],
    ),
  );
  const ran = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "solve.started" &&
      isString(data.solve) &&
      isString(data.condition) &&
      under.has(data.condition)
        ? [data.solve]
        : [],
    ),
  );
  return events.flatMap(({ kind, data }) => {
    const { solve } = data;
    const ending = asRecord(data.ending);
    if (kind !== "solve.finished" || !isString(solve) || !ran.has(solve)) return [];
    const counted = (told: Counted) => [{ solve, ending: told }];
    if (ending?.outcome === "pass") return counted({ outcome: "pass" });
    if (ending?.outcome !== "fail") return [];
    if (ending.kind === "broken-harness") {
      return counted({
        outcome: "fail",
        kind: "broken-harness",
        reason: isString(ending.reason) ? ending.reason : "",
      });
    }
    const failed = FAILS.find((known) => known === ending.kind);
    return failed === undefined ? [] : counted({ outcome: "fail", kind: failed });
  });
}

/** The same solves as their endings alone. */
export function endingsOf(events: readonly LogEvent[], version: string, stand: Stand): Counted[] {
  return solvesOf(events, version, stand).map(({ ending }) => ending);
}

/**
 * How a task stands on `endings`, its solves under one harness: read on the latest `rule.solves` of
 * them, since a harness's newest solves say most of it. Enough fails stop the harness, whatever the
 * count; a full reading with fewer clears. A broken harness fails every task alike, so its fails
 * are no reading of this one.
 */
export function standing(endings: readonly Counted[], rule: Rule): Standing {
  const read = endings
    .filter((ending) => !(ending.outcome === "fail" && ending.kind === "broken-harness"))
    .slice(-rule.solves);
  const fails = read.flatMap((ending) => (ending.outcome === "fail" ? [ending.kind] : []));
  if (fails.length >= rule.fails) return fails.every((kind) => kind === "wall-ended") ? "walled" : "stops";
  return read.length >= rule.solves ? "clears" : "unknown";
}

/** Every task of a log by how it stands where the solver does. */
export function ladder(events: readonly LogEvent[], stand: Stand, rule: Rule): Ladder {
  const { states, feasible, anchor } = taskSets(events);
  const against = (version: string) => standing(endingsOf(events, version, stand), rule);
  const pool: Record<Standing, string[]> = { stops: [], clears: [], walled: [], unknown: [] };
  for (const version of feasible) {
    const state = states.get(version);
    if ((state === "held" || state === "admitted") && !anchor.has(version)) {
      pool[against(version)].push(version);
    }
  }
  const inState = (wanted: string) =>
    [...states].flatMap(([version, state]) => (state === wanted ? [version] : []));
  return {
    pool,
    reach: inState("too-hard"),
    practice: inState("released").filter((version) => against(version) !== "clears"),
  };
}

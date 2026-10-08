/**
 * D1b's reading: what the Examiner sessions in a log supplied, and how the plan's supply rule reads
 * it. The plan asks for the candidates written, the share feasible, the share bracketed once and
 * twice in three, the check defects, and the solves spent; its rule is to go at 8 or more bracketed
 * tasks of 24 feasible, to revise the Examiner's inputs once at 5 to 7, and to stop below 5.
 *
 * Everything is read from `exam.word`, the one event per task that says what its author was told
 * and on which solves. A task is feasible here when it passed gates 1 to 4 and its test-side solves
 * all ended in a pass or a fail, which are the tasks told too easy, wall-bound or scored.
 *
 * The rule is read over the first `of` feasible tasks in the order they were told, and so is every
 * count beside it; it is `unfinished` until there are that many, since a share of fewer says less
 * than the rule assumes. Bracketed is `scored`, by whatever the session's screening asked for. Once
 * and twice in three count the tasks with at least that many fails of any kind, so the rule can be
 * read at either before the plan's decision 26 is made, and `wallBound` names those among them
 * whose only fails ended at the wall: they are counted apart and are not bracketed, as decision 21
 * stands.
 */
import { toldOf } from "../kernel/binding.ts";
import type { LogEvent } from "../kernel/log.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { countBy } from "../meta/tally.ts";

/** The plan's supply rule: the feasible tasks it is read over, and the reading each count of
 *  scored tasks among them reaches, highest first. */
const FEASIBLE = 24;
const THRESHOLDS: readonly (readonly [number, SupplyReading])[] = [
  [8, "go"],
  [5, "revise"],
  [0, "stop"],
];
/** The words of a task whose screening solves all counted. */
const SCREENED = new Set(["too easy", "wall-bound", "scored"]);

export type SupplyReading = "go" | "revise" | "stop" | "unfinished";

export function supply(events: readonly LogEvent[], of = FEASIBLE) {
  // A task is told one word at a time, and the last stands: a feasible task is told again once its
  // controls hold and it is screened.
  const tasks = [...toldOf(events).values()];
  const feasible = tasks.filter(({ word }) => SCREENED.has(word));
  const read = feasible.slice(0, of);
  const bracketed = read.filter(({ word }) => word === "scored").length;
  const reached = THRESHOLDS.find(([least]) => bracketed >= least)?.[1] ?? "stop";
  const reading: SupplyReading = read.length < of ? "unfinished" : reached;
  const written = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "task.proposed" && isString(data.session) ? [data.version] : [],
    ),
  );
  /** The gate events of the sessions' own tasks that ended in `outcome` at `gate`. */
  const gates = (gate: number, outcome: string) =>
    events.flatMap(({ kind, data }) =>
      kind === "task.gate" && data.gate === gate && data.outcome === outcome && written.has(data.version)
        ? [data]
        : [],
    );
  /** Each task's last gate 2, the stronger solve it stands on. */
  const witness = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "task.gate" && data.gate === 2 && written.has(data.version)
        ? [[data.version, data] as const]
        : [],
    ),
  );
  return {
    proposed: written.size,
    words: countBy(tasks, ({ word }) => word),
    // What each gate refused, so that a gate's cost is read beside what it let through. Gates 1 and
    // 4 refuse what the Examiner wrote, a package or its controls; gates 2 and 3 refuse a task for
    // its checks, one that could not run on an answer or did not repeat, which is the checker's
    // fault and not the author's. v1 never had this count for its submit gate: "whether the gate
    // buys protection is not measured" (v1 #113).
    refusedAt: countBy(
      events.flatMap(({ kind, data }) =>
        kind === "task.gate" && data.outcome === "refused" && written.has(data.version) && isNumber(data.gate)
          ? [data.gate]
          : [],
      ),
      (gate) => `gate ${String(gate)}`,
    ),
    // Why the two gates that cost most said no. `tooHard` is how the stronger solve that closed a
    // task ended: a check refused its answer, or its wall, its context or no answer ended it. A
    // refused answer is the one a reviewer can read for a check's fault. `controls` is the kinds
    // of fault in the controls gate 4 refused (`controlsGate`), a refusal under each kind it holds.
    // A log written before either was recorded counts as unrecorded.
    // A reach task is put to the stronger solver again when the harness has moved, so a task is
    // counted by its last such solve, and one that has passed since is not counted.
    tooHard: countBy(
      [...witness.values()].filter(({ outcome }) => outcome === "too-hard"),
      ({ kind }) => (isString(kind) ? kind : "unrecorded"),
    ),
    // The too-hard tasks whose refusal an advising Referee ruled a check defect: tasks a repair of
    // the checker might give back (`tools/c/carry.ts` counts those it would).
    tooHardFlagged: tasks.filter(({ word, flagged }) => word === "too hard" && flagged).length,
    controls: countBy(
      gates(4, "refused").flatMap(({ kinds }) =>
        Array.isArray(kinds) && kinds.length > 0 ? kinds.filter(isString) : ["unrecorded"],
      ),
      (kind) => kind,
    ),
    feasible: feasible.length,
    once: read.filter(({ fails }) => fails >= 1).length,
    twice: read.filter(({ fails }) => fails >= 2).length,
    wallBound: read.filter(({ word }) => word === "wall-bound").length,
    solves: {
      // Every task of a session that passed gate 1 was put to the stronger condition once, and a
      // reach task once more each time a later session tried it again.
      strong:
        gates(1, "passed").length + gates(2, "too-hard").length + gates(2, "passed").length - witness.size,
      test: tasks.reduce((sum, { solves }) => sum + solves, 0),
    },
    bracketed,
    reading,
  };
}

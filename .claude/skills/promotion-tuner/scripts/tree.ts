/**
 * The tree whose score reads the record in a promotion replay. A tree is any worktree of the
 * repository, `main`'s or a candidate's, and the replay reaches its kernel only through its own
 * modules, so one script reads the same record under two scores and the tables differ in what the
 * trees differ in (19 October: the margin, level and repeat prototypes each imported a tree by
 * hand). The logs a replay reads are listed by `campaignLogs` (`.claude/skills/main/logs.ts`).
 *
 * A tree scores a task by its weighted measures (`pointsOf`, `WEIGHTS`, since 21 October), and one
 * without them is refused: until 21 October the tuner also read the margin, the trigger and the
 * two-stage rule of older trees, which no candidate branched from `main` can hold.
 */
import { type Paired, UNMEASURED } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { gitText } from "#src/meta/git.ts";
import { asRecord, isFunction } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

/** What a reading of the reference against itself is made between (`Sides`, `compare.ts`). */
interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  readonly comparison: string;
  readonly halves: "mirrored";
  readonly objective?: { readonly direction: "lower" | "higher" } | undefined;
}

/** A task's points by measure. A tree from before 2 November also scores the bill; a tree after it
 *  scores none, which reads here as no points by the bill. */
export type Points = Readonly<Record<"validity" | "objective" | "bill", number>>;

/** The kernel of one tree, as the replay calls it. */
export interface Tree {
  readonly path: string;
  /** The tree's short commit, and whether its `src` holds changes no commit has. */
  readonly commit: string;
  /** The tree's weight of each measure (`WEIGHTS`). */
  readonly weights: Points;
  read: (path: string) => LogEvent[];
  lastReports: (events: readonly LogEvent[]) => Reported[];
  pairsReported: (events: readonly LogEvent[], report: Reported) => Paired[];
  pairsOf: (
    events: readonly LogEvent[],
    versions: readonly string[],
    sides: Sides,
    solves: number,
  ) => Paired[];
  /** A task's points by measure under the tree's weights (`pointsOf`). */
  points: (pair: Paired) => Points;
  flipP: (differences: readonly number[]) => number;
  /** Whether the tree's own step rule (`stepOf`) reads a step on these scores, with `unbilled`
   *  null where a set's scores without the bill cannot be read again. */
  readsStep: (differences: readonly number[], unbilled: readonly number[] | null, level: number) => boolean;
  /** Whether a reading of a harness against itself reads a step either way at `level`. */
  readsStepEitherWay: (differences: readonly number[], level: number, unbilled: readonly number[]) => boolean;
  billedBetween: (events: readonly LogEvent[], from: number, to: number) => number;
}

/** The kernel of the worktree at `path`, imported from its own files; refused where it scores no
 *  weighted measures. */
export async function loadTree(path: string): Promise<Tree> {
  // SAFETY: the tree under replay is a worktree of this repository; its kernel modules are typed
  // as this tree's, and the check below refuses a tree whose scores have a different shape.
  const kernel = async <Module>(file: string): Promise<Module> =>
    (await import(join(path, "src", "kernel", file))) as Module;
  const [log, reports, compare, meter, trace] = await Promise.all([
    kernel<typeof import("#src/kernel/log.ts")>("log.ts"),
    kernel<typeof import("#src/kernel/reports.ts")>("reports.ts"),
    kernel<typeof import("#src/kernel/compare.ts")>("compare.ts"),
    kernel<object>("meter.ts"),
    kernel<object>("trace.ts"),
  ]);
  // From 1 November a tree's billing folds are its meter's; a tree before keeps them in its trace.
  const billing: unknown = Reflect.get(meter, "billedBetween") ?? Reflect.get(trace, "billedBetween");
  if (!isFunction(billing)) throw new Error(`${path} has no billedBetween in its meter or its trace`);
  if (!isFunction(compare.pointsOf) || asRecord(compare.WEIGHTS) === null) {
    throw new Error(`${path} scores no weighted measures (pointsOf, WEIGHTS): a tree from before 21 October`);
  }
  const changed = gitText(path, "status", "--porcelain", "--", "src") !== "";
  return {
    path,
    commit: `${gitText(path, "rev-parse", "--short", "HEAD")}${changed ? " with uncommitted changes under src" : ""}`,
    weights: { bill: 0, ...compare.WEIGHTS },
    read: (file) => log.read(file),
    lastReports: (events) => reports.lastReports(events),
    pairsReported: (events, report) => reports.pairsReported(events, report),
    pairsOf: (events, versions, sides, solves) => compare.pairsOf(events, versions, sides, solves).pairs,
    points: (pair) => ({ bill: 0, ...compare.pointsOf(pair) }),
    flipP: (differences) => compare.flipP(differences),
    // The tree's own rule, whatever it exports beside it: #392's tree read the bill-free test
    // inside `stepOf` before `readsStep` existed, a tree before it reads its scores alone, and a tree
    // from 2 November scores no bill, so its scores are the ones it reads. A rule that needs scores
    // without the bill where none can be read refuses them, and reads no step.
    readsStep: (differences, unbilled, level) => {
      const stepOf: unknown = Reflect.get(compare, "stepOf");
      if (!isFunction(stepOf)) return compare.readsStep(differences, level);
      try {
        const frontier = unbilled === null ? { differences } : { differences, unbilled };
        return Reflect.apply(stepOf, undefined, [{ frontier, retained: UNMEASURED }, level]) === "step";
      } catch {
        return false;
      }
    },
    // From 31 October a tree's step reads the scores without the bill alone, and its `readsStep`
    // takes them and the level; a tree before that reads the scores as they stand first.
    readsStepEitherWay: (differences, level, unbilled) =>
      isFunction(compare.readsStep) && compare.readsStep.length === 2
        ? compare.readsStepEitherWay(unbilled, level)
        : Reflect.apply(compare.readsStepEitherWay, undefined, [differences, level, unbilled]) === true,
    billedBetween: (events, from, to) => Number(Reflect.apply(billing, undefined, [events, from, to])),
  };
}

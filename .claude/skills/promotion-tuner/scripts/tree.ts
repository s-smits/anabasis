/**
 * The tree whose score reads the record in a promotion replay: any worktree of the repository,
 * `main`'s or a candidate's, whose kernel the replay reaches only through the tree's own modules,
 * so one script reads the same record under two scores and the tables differ only in what the trees
 * differ in.
 */
import { type Paired, UNMEASURED } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { gitText } from "#src/meta/git.ts";
import { asRecord, isFunction } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  readonly comparison: string;
  readonly halves: "mirrored";
  readonly objective?: { readonly direction: "lower" | "higher" } | undefined;
}

/** A task's points by measure; a tree that scores no bill reads here as no points by the bill. */
export type Points = Readonly<Record<"validity" | "objective" | "bill", number>>;

export interface Tree {
  readonly path: string;
  readonly commit: string;
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
  points: (pair: Paired) => Points;
  flipP: (differences: readonly number[]) => number;
  readsStep: (differences: readonly number[], unbilled: readonly number[] | null, level: number) => boolean;
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
  // A tree's billing folds are its meter's, or in an older tree its trace's.
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
    read: (file) => (log.CALL_KINDS === undefined ? log.read(file) : log.read(file, log.CALL_KINDS)),
    lastReports: (events) => reports.lastReports(events),
    pairsReported: (events, report) => reports.pairsReported(events, report),
    pairsOf: (events, versions, sides, solves) => compare.pairsOf(events, versions, sides, solves).pairs,
    points: (pair) => ({ bill: 0, ...compare.pointsOf(pair) }),
    flipP: (differences) => compare.flipP(differences),
    // The tree's own rule: `stepOf` where it exports one, else `readsStep` on the scores. A rule
    // that needs scores without the bill where none can be read refuses them, and reads no step.
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
    billedBetween: (events, from, to) => Number(Reflect.apply(billing, undefined, [events, from, to])),
  };
}

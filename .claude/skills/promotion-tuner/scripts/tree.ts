/**
 * The two inputs of a promotion replay: the tree whose score reads the record, and the campaign logs
 * it reads. A tree is any worktree of the repository, `main`'s or a candidate's, and the replay
 * reaches its kernel only through its own modules, so one script reads the same record under two
 * scores and the tables differ in what the trees differ in (19 October: the margin, level and
 * repeat prototypes each imported a tree by hand, and each kept its own list of logs).
 *
 * A tree scores a task by its weighted measures (`pointsOf`, `WEIGHTS`, since 21 October), and one
 * without them is refused: until 21 October the tuner also read the margin, the trigger and the
 * two-stage rule of older trees, which no candidate branched from `main` can hold.
 *
 * Default discovery uses the production registry and refreshed records on every configured host
 * (22 October 2026). Explicit --logs retains the offline <logs>/<worktree>/.ana/d2/ layout, with
 * the largest copy of each name there. Left out: a seed (`seed.json` beside its
 * log), a name that starts `sim-`, `rh-` or `test-`, and a rehearsal, whose seats are
 * `faux/script`.
 */
import { type Measures, type Paired, UNMEASURED } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { type JsonValue, asRecord, isFunction, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { readableAcross } from "#tools/runs/snapshots.ts";

/** What a reading of the reference against itself is made between (`Sides`, `compare.ts`). */
interface Sides {
  readonly old: string;
  readonly fresh: string;
  readonly setting: string;
  readonly comparison: string;
  readonly halves: "mirrored";
  readonly objective?: { readonly direction: "lower" | "higher" };
}

/** The kernel of one tree, as the replay calls it. */
export interface Tree {
  readonly path: string;
  /** The tree's short commit, and whether its `src` holds changes no commit has. */
  readonly commit: string;
  /** The tree's weight of each measure (`WEIGHTS`). */
  readonly weights: Measures;
  read(path: string): LogEvent[];
  lastReports(events: readonly LogEvent[]): Reported[];
  pairsReported(events: readonly LogEvent[], report: Reported): Paired[];
  pairsOf(events: readonly LogEvent[], versions: readonly string[], sides: Sides, solves: number): Paired[];
  /** A task's points by measure under the tree's weights (`pointsOf`). */
  points(pair: Paired): Measures;
  flipP(differences: readonly number[]): number;
  /** Whether the tree's own step rule (`stepOf`) reads a step on these scores, with `unbilled`
   *  null where a set's scores without the bill cannot be read again. */
  readsStep(differences: readonly number[], unbilled: readonly number[] | null, level: number): boolean;
  /** Whether a reading of a harness against itself reads a step either way at `level`. */
  readsStepEitherWay(differences: readonly number[], level: number, unbilled: readonly number[]): boolean;
  /** The points a report holds by measure, or undefined in a report from before the weights. */
  measures(value: JsonValue | undefined): Measures | undefined;
  billedBetween(events: readonly LogEvent[], from: number, to: number): number;
  /** The event kinds that carry a `billed` field the tree sums. */
  readonly billed: ReadonlySet<string>;
}

export interface Found {
  readonly name: string;
  readonly path: string;
}

/** Bytes read from a log's end to find its last event's time without reading the whole file. */
const TAIL = 65_536;
const LEFT_OUT = ["sim-", "rh-", "test-"] as const;
const AT = '{"at":"';

/** The kernel of the worktree at `path`, imported from its own files; refused where it scores no
 *  weighted measures. */
export async function loadTree(path: string): Promise<Tree> {
  // SAFETY: the tree under replay is a worktree of this repository; its kernel modules are typed
  // as this tree's, and the check below refuses a tree whose scores have a different shape.
  const kernel = async <Module>(file: string): Promise<Module> =>
    (await import(join(path, "src", "kernel", file))) as Module;
  const [log, reports, compare, trace] = await Promise.all([
    kernel<typeof import("#src/kernel/log.ts")>("log.ts"),
    kernel<typeof import("#src/kernel/reports.ts")>("reports.ts"),
    kernel<typeof import("#src/kernel/compare.ts")>("compare.ts"),
    kernel<typeof import("#src/kernel/trace.ts")>("trace.ts"),
  ]);
  if (!isFunction(compare.pointsOf) || asRecord(compare.WEIGHTS) === null) {
    throw new Error(`${path} scores no weighted measures (pointsOf, WEIGHTS): a tree from before 21 October`);
  }
  const changed = gitText(path, "status", "--porcelain", "--", "src") !== "";
  return {
    path,
    commit: `${gitText(path, "rev-parse", "--short", "HEAD")}${changed ? " with uncommitted changes under src" : ""}`,
    weights: compare.WEIGHTS,
    read: (file) => log.read(file),
    lastReports: (events) => reports.lastReports(events),
    pairsReported: (events, report) => reports.pairsReported(events, report),
    pairsOf: (events, versions, sides, solves) => compare.pairsOf(events, versions, sides, solves).pairs,
    points: (pair) => compare.pointsOf(pair),
    flipP: (differences) => compare.flipP(differences),
    // The tree's own rule, whatever it exports beside it: #392's tree read the bill-free test
    // inside `stepOf` before `readsStep` existed, and a tree before it reads its scores alone. Scores
    // that cannot be read without the bill stand as an empty test, which a rule needing them never
    // reads as a step.
    readsStep: (differences, unbilled, level) =>
      compare.stepOf({ frontier: { differences, unbilled: unbilled ?? [] }, retained: UNMEASURED }, level) ===
      "step",
    readsStepEitherWay: (differences, level, unbilled) =>
      compare.readsStepEitherWay(differences, level, unbilled),
    measures: (value) => compare.measuresIn(value),
    billedBetween: (events, from, to) => trace.billedBetween(events, from, to),
    billed: trace.BILLED,
  };
}

/** The time of a log's last event, read from its end; null where the end holds no whole event. */
function lastAt(path: string): string | null {
  const size = statSync(path).size;
  const length = Math.min(size, TAIL);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  // The first line of the tail may be cut; a cut that starts as an event does starts one.
  const last = buffer
    .toString("utf8")
    .split("\n")
    .findLast((line) => line.startsWith(AT));
  return last?.slice(AT.length, AT.length + 24) ?? null;
}

/** Every campaign log under `home`, one a name, the largest where copies exist; seeds and the
 *  names of `LEFT_OUT` are not listed. */
function everyLog(home: string): Found[] {
  const largest = new Map<string, { path: string; size: number }>();
  for (const worktree of readdirSync(home)) {
    const campaigns = join(home, worktree, ".ana", "d2");
    if (!existsSync(campaigns)) continue;
    for (const name of readdirSync(campaigns)) {
      const path = join(campaigns, name, "log.jsonl");
      if (LEFT_OUT.some((prefix) => name.startsWith(prefix)) || !existsSync(path)) continue;
      if (existsSync(join(campaigns, name, "seed.json"))) continue;
      const { size } = statSync(path);
      if (size > (largest.get(name)?.size ?? -1)) largest.set(name, { path, size });
    }
  }
  return [...largest]
    .map(([name, { path }]) => ({ name, path }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/** The logs a replay reads: those `names` lists where it lists any, else those whose last event is
 *  at or after `since`. */
export async function campaignLogs(
  home: string | null,
  names: readonly string[],
  since: string,
): Promise<Found[]> {
  const all =
    home === null
      ? (await readableAcross(names)).filter(
          (run) => run.seed !== true && !LEFT_OUT.some((prefix) => run.name.startsWith(prefix)),
        )
      : everyLog(home);
  return all.filter(({ name, path }) =>
    names.length > 0 ? names.includes(name) : (lastAt(path) ?? "") >= since,
  );
}

/** Whether a log is a rehearsal's: a seat or its solver is `faux/script`. */
export function rehearsed(events: readonly LogEvent[]): boolean {
  const models = events.flatMap(({ kind, data }) => {
    if (kind === "campaign.setting") return [asRecord(data.solver)?.model];
    if (kind !== "campaign.opened") return [];
    return Object.values(asRecord(data.seats) ?? {}).map((seat) => asRecord(seat)?.model);
  });
  return models.some((model) => isString(model) && model.startsWith("faux/"));
}

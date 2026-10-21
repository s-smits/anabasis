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
 * The logs are every campaign under `<logs>/<worktree>/.ana/d2/`, one a campaign name, the largest
 * file where copies of one name sit in several worktrees. Left out: a seed (`seed.json` beside its
 * log), a name that starts `sim-`, `rh-` or `test-`, and a rehearsal, whose seats are
 * `faux/script`.
 */
import type { Measures, Paired } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Reported } from "#src/kernel/reports.ts";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { type JsonValue, asRecord, isFunction, isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";

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
  /** Whether a reading of a harness against itself reads a step either way at `level`. */
  readsStepEitherWay(differences: readonly number[], level: number): boolean;
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
  const kernel = (file: string) => import(join(path, "src", "kernel", file));
  const [log, reports, compare] = await Promise.all([
    kernel("log.ts"),
    kernel("reports.ts"),
    kernel("compare.ts"),
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
    readsStepEitherWay: (differences, level) => compare.readsStepEitherWay(differences, level),
    measures: (value) => compare.measuresIn(value),
    billedBetween: (events, from, to) => reports.billedBetween(events, from, to),
    billed: reports.BILLED,
  };
}

/** The folder that holds the repository's worktrees: the parent of its main checkout. */
export function worktreesHome(tree: string): string {
  return dirname(dirname(gitText(tree, "rev-parse", "--path-format=absolute", "--git-common-dir")));
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
export function campaignLogs(home: string, names: readonly string[], since: string): Found[] {
  return everyLog(home).filter(({ name, path }) =>
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

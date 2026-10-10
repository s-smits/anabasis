/**
 * The climb, as one reading of a campaign's log: its epochs. An epoch runs from the opening, or a
 * promotion, to the next promotion or the log's end, under one reference harness. The climb the
 * system is for is a chain of epochs in which each promoted harness answers tasks the one before
 * it failed, so an epoch's row keeps apart what each side answered on the tasks held out in it:
 * the reference harness, as the control and the comparisons read it, and the starter, the fixed
 * lower reference, which says whether the tasks got harder from one epoch to the next. A row holds
 * counts of valid answers and solves and nothing of a task.
 *
 * Written on 10 October, when the operator asked for the climb to be read as such: ten campaigns
 * had promoted once each and none twice, and no view said at which epoch a campaign stood or what
 * its tasks had done since the promotion. `runs view` prints the rows.
 */
import { conditionsOf } from "../kernel/condition.ts";
import type { LogEvent } from "../kernel/log.ts";
import { passed, solvesIn } from "../kernel/solves.ts";
import { isString } from "../meta/json-shape.ts";

/** Valid answers and solves of one harness on a set of tasks. */
export interface Share {
  readonly valid: number;
  readonly solves: number;
}

export interface Epoch {
  /** The epoch's number, from one. */
  readonly nth: number;
  /** The reference harness, by digest, or "starter" for the first epoch of a campaign. */
  readonly reference: string;
  /** Where the epoch starts in the log, and where it ends: null while it is the last. */
  readonly from: number;
  readonly to: number | null;
  /** The harness promoted at its end, or null. */
  readonly promoted: string | null;
  /** The task versions held out during the epoch. */
  readonly tasks: readonly string[];
  /** Builder sessions that finished in the epoch, and how many changed the harness. */
  readonly sessions: number;
  readonly changed: number;
  /** The comparisons reported in the epoch, by id, with their readings. */
  readonly comparisons: readonly { readonly id: string; readonly reading: string }[];
  /** What the reference and the starter answered of the solves of the epoch's own tasks within
   *  it: null where no solve of that harness on those tasks is on record. */
  readonly reference_share: Share | null;
  readonly starter_share: Share | null;
}

const PROMOTED = "harness.promoted";

/** The share of valid answers among `solves`, or null where there is none. */
function shareOf(solves: readonly (boolean | null)[]): Share | null {
  const judged = solves.filter((each): each is boolean => each !== null);
  return judged.length === 0 ? null : { valid: judged.filter(Boolean).length, solves: judged.length };
}

/** The epochs of a log, oldest first. A log with no promotion is one epoch. */
export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const promotions = events.flatMap(({ kind, data }, index) =>
    kind === PROMOTED && isString(data.harness) ? [{ index, harness: data.harness }] : [],
  );
  const starter = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  const conditions = conditionsOf(events);
  const solves = solvesIn(events);
  const bounds = [{ index: 0, harness: "starter" }, ...promotions];
  return bounds.map(({ index: from, harness: reference }, nth) => {
    const next = bounds[nth + 1];
    const to = next?.index ?? null;
    const within = (at: number) => at >= from && (to === null || at < to);
    const tasks = events.flatMap(({ kind, data }, at) =>
      within(at) && kind === "task.gate" && data.outcome === "passed" && isString(data.version)
        ? [data.version]
        : [],
    );
    const held = new Set(tasks);
    const builds = events.filter(({ kind }, at) => within(at) && kind === "build.finished");
    const comparisons = events.flatMap(({ kind, data }, at) =>
      within(at) && kind === "comparison.reported" && isString(data.session)
        ? [{ id: data.session, reading: isString(data.reading) ? data.reading : "" }]
        : [],
    );
    const starterDigest = isString(starter) ? starter : null;
    const referenceDigest = reference === "starter" ? starterDigest : reference;
    const under = (digest: string | null) =>
      digest === null
        ? []
        : solves.flatMap((solve) => {
            const condition = conditions.get(solve.condition);
            return within(solve.started) && condition?.harness === digest && held.has(condition.task)
              ? [passed(solve)]
              : [];
          });
    return {
      nth: nth + 1,
      reference,
      from,
      to,
      promoted: next?.harness ?? null,
      tasks,
      sessions: builds.length,
      changed: builds.filter(({ data }) => data.changed === true).length,
      comparisons,
      reference_share: shareOf(under(referenceDigest)),
      starter_share: reference === "starter" ? null : shareOf(under(starterDigest)),
    };
  });
}

/** One line an epoch, as the view prints them. */
export function epochLine(epoch: Epoch): string {
  const share = (named: string, found: Share | null) =>
    found === null ? `${named} unread` : `${named} valid ${String(found.valid)} of ${String(found.solves)}`;
  const reference = epoch.reference === "starter" ? "the starter" : epoch.reference.slice(0, 8);
  const readings = epoch.comparisons.map(({ id, reading }) => `${id} ${reading}`).join(", ") || "none";
  const end = epoch.promoted === null ? "open" : `promoted ${epoch.promoted.slice(0, 8)}`;
  return `epoch ${String(epoch.nth)}: reference ${reference}; ${String(epoch.tasks.length)} tasks held out; ${String(epoch.sessions)} sessions (${String(epoch.changed)} changed); comparisons ${readings}; ${share("reference", epoch.reference_share)}${epoch.reference === "starter" ? "" : `, ${share("starter", epoch.starter_share)}`} on them; ${end}`;
}

/**
 * The outside scores on record set beside the promotions they belong to, so that a climb read on a
 * campaign's own held-out tasks is checked against a grader the campaign never saw: promotions
 * that come faster while their harnesses score no higher outside than the Starter are fitted to
 * the campaign's comparisons (the operator's rule: "link the evals to the promotion ratio").
 */
import { MISSING, printed } from "#skills/main/print.ts";
import type { Promotion, Run } from "#skills/main/runs.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { isBaselineArmName, isCut, readJudgedStore } from "#tools/runs/bench-store.ts";

/** One judged rollout: an arm's points on a task. */
export interface Score {
  readonly arm: string;
  readonly harness: string;
  readonly task: string;
  readonly points: number;
  readonly total: number;
  /** The campaign the arm's harness was built by, `starter`, or null for an arm built elsewhere. */
  readonly of: string | null;
  /** Whether the judge's reader cut a file of the deliverable before the judge read it. */
  readonly cut: boolean;
}

const STARTER = "starter";
const BASE = "base";
const HEAD = [
  "arm",
  "pack",
  "promotion",
  "promoted on",
  "confirmed by the starter",
  "tasks",
  "points",
  "Starter, lowest to highest",
  "against the Starter",
];
const VERDICTS = ["above", "inside", "below"] as const;
type Verdict = (typeof VERDICTS)[number];

/** Every judged rollout of a store, or those on the tasks named, since the parts of a read are never
 *  summed. A record without points (a judgement that failed) is none, and a named task no record is
 *  on is refused: left out silently, a mistyped name would place the arm on a smaller part. */
export function scoresOf(store: string, only: readonly string[] | null = null): Score[] {
  const root = join(store, "judged");
  if (!existsSync(root)) throw new Error(`${root} is not there: --bench takes a score store`);
  const all: Score[] = readJudgedStore(store).map((record) => ({
    arm: record.arm,
    harness: record.harness,
    task: record.task,
    points: record.points,
    total: record.total,
    of:
      record.buildOf === STARTER || record.buildOf === BASE || isBaselineArmName(record.arm)
        ? STARTER
        : record.campaign,
    cut: isCut(record),
  }));
  if (only === null) return all;
  const absent = only.filter((task) => all.every((score) => score.task !== task));
  if (absent.length > 0) throw new Error(`no judged rollout on ${absent.join(", ")}`);
  return all.filter(({ task }) => only.includes(task));
}

/** The campaigns the arms of a store were built by, which a caller folds before `outsideLines`. */
export const campaignsOf = (scores: readonly Score[]): string[] => [
  ...new Set(scores.flatMap(({ of }) => (of === null || of === STARTER ? [] : [of]))),
];

const summed = (scores: readonly Score[]) => scores.reduce((sum, { points }) => sum + points, 0);

/** An arm's sum against the Starter's sums on the same tasks, one sum a Starter arm that holds them
 *  all. The Starter's lowest rollout of each task, summed, is a rollout nobody ran, and it falls
 *  with every Starter arm added, until every arm beside it reads inside. */
function againstStarter(own: readonly Score[], starter: readonly Score[]) {
  const shared = own.filter(({ task }) => starter.some((score) => score.task === task));
  const sums = [...Map.groupBy(starter, ({ arm }) => arm).values()].flatMap((rollout) => {
    const held = rollout.filter(({ task }) => shared.some((score) => score.task === task));
    return held.length === shared.length ? [summed(held)] : [];
  });
  const [points, low, high] = [summed(shared), Math.min(...sums), Math.max(...sums)];
  const placed: Verdict = points > high ? "above" : points < low ? "below" : "inside";
  return {
    tasks: shared.length,
    points,
    total: shared.reduce((sum, score) => sum + score.total, 0),
    low,
    high,
    rollouts: sums.length,
    verdict: sums.length === 0 ? null : placed,
    cut: shared.filter((score) => score.cut).length,
  };
}

/** The outside block: one row an arm that is no Starter, then what the join reads. */
export function outsideLines(scores: readonly Score[], runs: readonly Run[], format: "md" | "tsv"): string[] {
  const starter = scores.filter(({ of }) => of === STARTER);
  const arms = Map.groupBy(
    scores.filter(({ of }) => of !== STARTER),
    ({ arm }) => arm,
  );
  const joined: { confirmed: boolean | null; verdict: Verdict }[] = [];
  const rows = [...arms].map(([arm, own]) => {
    const [first] = own;
    // The digest is the harness's identity, so it finds the promotion where a record names no campaign.
    const promotes = ({ harness }: Promotion) => harness === first?.harness;
    const run =
      runs.find(({ promotions }) => promotions.some(promotes)) ?? runs.find(({ name }) => name === first?.of);
    const promotion = run?.promotions.find(promotes);
    const read = againstStarter(own, starter);
    if (promotion !== undefined && read.verdict !== null) {
      joined.push({ confirmed: promotion.confirmed, verdict: read.verdict });
    }
    const spread = read.rollouts === 1 ? ", one Starter rollout" : "";
    return [
      arm,
      run?.pack ?? MISSING,
      promotion === undefined || run === undefined
        ? "no recorded promotion"
        : `${String(promotion.nth)} of ${String(run.promotions.length)}`,
      promotion?.tally ?? MISSING,
      promotion === undefined ? MISSING : confirmedWord(promotion.confirmed),
      `${String(read.tasks)}${read.cut > 0 ? ` (${String(read.cut)} cut)` : ""}`,
      `${String(read.points)}/${String(read.total)}`,
      read.verdict === null ? MISSING : `${String(read.low)} to ${String(read.high)}`,
      read.verdict === null ? MISSING : `${read.verdict}${spread}`,
    ];
  });
  if (format === "tsv") return [printed(HEAD, rows, format)];
  const counted = (confirmed: boolean | null) => {
    const own = joined.filter((each) => each.confirmed === confirmed);
    const by = VERDICTS.map(
      (verdict) => `${String(own.filter((each) => each.verdict === verdict).length)} ${verdict}`,
    );
    return `${confirmedWord(confirmed)} ${String(own.length)} (${by.join(", ")})`;
  };
  const agree = joined.filter(
    ({ confirmed, verdict }) => (confirmed === true) === (verdict === "above"),
  ).length;
  return [
    "## Outside: the promotions a bench has scored",
    "",
    printed(HEAD, rows, format),
    "",
    `Arms that name a promotion ${String(joined.length)}, by what the starter read of it: ${[true, false, null].map(counted).join("; ")}.`,
    `The two readings agree on ${String(agree)} of ${String(joined.length)}: a promotion the starter confirmed that scores above the Starter's spread, or one it did not that does not.`,
    "An arm is read on the tasks a Starter rollout also holds, against the lowest and highest sum among the Starter arms that hold them all; inside that spread is no reading, and one rollout a task reads a direction only. A deficit is a difference in conditions first (what the export carries and tells the solver, the interpreter, the day) and the harness only once those are equal.",
    "A campaign climbs on its own comparisons alone: promotions that come faster while these rows stay inside or below the Starter's spread are fitted to those comparisons. A bench score promotes nothing, and no seat, prompt, check or query reads this table.",
  ];
}

function confirmedWord(confirmed: boolean | null): string {
  return confirmed === null ? "not read" : confirmed ? "confirmed" : "not confirmed";
}

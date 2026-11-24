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
import { formatCriteria, isCut, readJudgedStore, type SolverTier } from "#tools/runs/bench-store.ts";

/** One judged rollout: an arm's points, criteria, spend, runtime and tier on a task. */
export interface Score {
  readonly arm: string;
  readonly harness: string;
  readonly task: string;
  readonly runtime: string;
  readonly tier: SolverTier;
  readonly points: number;
  readonly total: number;
  readonly criteriaPassed: number | null;
  readonly criteriaTotal: number | null;
  readonly solveUsd: number;
  readonly delivered: boolean;
  /** The campaign the arm's harness was built by, or null for baselines and external arms. */
  readonly of: string | null;
  /** Whether the judge's reader cut a file of the deliverable before the judge read it. */
  readonly cut: boolean;
}

const BUILT: SolverTier = "builtSolver";
const BARE: SolverTier = "bareSolver";
const STARTER_TIER: SolverTier = "baseStarter";
const HEAD = [
  "arm",
  "runtime",
  "pack",
  "promotion",
  "promoted on",
  "confirmed by the starter",
  "tasks",
  "points",
  "criteria",
  "solve USD",
  "baseline",
  "baseline, lowest to highest",
  "against baseline",
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
    runtime: record.runtime,
    tier: record.tier,
    points: record.points,
    total: record.total,
    criteriaPassed: record.criteriaPassed,
    criteriaTotal: record.criteriaTotal,
    solveUsd: record.solveUsd,
    delivered: record.delivered,
    of: record.tier === BUILT ? record.campaign : null,
    cut: isCut(record),
  }));
  if (only === null) return all;
  const absent = only.filter((task) => all.every((score) => score.task !== task));
  if (absent.length > 0) throw new Error(`no judged rollout on ${absent.join(", ")}`);
  return all.filter(({ task }) => only.includes(task));
}

/** The campaigns the arms of a store were built by, which a caller folds before `outsideLines`. */
export const campaignsOf = (scores: readonly Score[]): string[] => [
  ...new Set(scores.flatMap(({ tier, of }) => (tier !== BUILT || of === null ? [] : [of]))),
];

const summed = (scores: readonly Score[]) => scores.reduce((sum, { points }) => sum + points, 0);

/** An arm's sum against same-runtime delivered baseline rollouts of one solver tier on the same tasks. */
function againstBaseline(arm: string, own: readonly Score[], baselines: readonly Score[]) {
  const runtime = own[0]?.runtime ?? "claude-code";
  const sameRuntime = baselines.filter((score) => score.delivered && score.runtime === runtime);
  const byArm = Map.groupBy(sameRuntime, ({ arm: name }) => name);
  const tierOrder: readonly SolverTier[] = byArm.has(`base-${arm}`)
    ? [BARE, STARTER_TIER]
    : byArm.has(`starter-${arm}`)
      ? [STARTER_TIER, BARE]
      : [BARE, STARTER_TIER];
  const tasks = new Set(own.map(({ task }) => task));
  const points = summed(own);
  const total = own.reduce((sum, score) => sum + score.total, 0);
  const cut = own.filter((score) => score.cut).length;
  for (const tier of tierOrder) {
    const sums = [
      ...Map.groupBy(
        sameRuntime.filter((score) => score.tier === tier),
        ({ arm: name }) => name,
      ).values(),
    ].flatMap((rollout) => {
      const held = rollout.filter(({ task }) => tasks.has(task));
      return held.length === own.length ? [summed(held)] : [];
    });
    if (sums.length === 0) continue;
    const [low, high] = [Math.min(...sums), Math.max(...sums)];
    const verdict: Verdict = points > high ? "above" : points < low ? "below" : "inside";
    return { tier, tasks: own.length, points, total, low, high, rollouts: sums.length, verdict, cut };
  }
  return {
    tier: null,
    tasks: own.length,
    points,
    total,
    low: 0,
    high: 0,
    rollouts: 0,
    verdict: null,
    cut,
  };
}

/** The outside block: one row an arm that is no baseline, then what the join reads. */
export function outsideLines(scores: readonly Score[], runs: readonly Run[], format: "md" | "tsv"): string[] {
  const baselines = scores.filter(({ tier }) => tier !== BUILT);
  const arms = Map.groupBy(
    scores.filter(({ tier }) => tier === BUILT),
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
    const read = againstBaseline(arm, own, baselines);
    if (promotion !== undefined && read.verdict !== null) {
      joined.push({ confirmed: promotion.confirmed, verdict: read.verdict });
    }
    const criteria = formatCriteria(own);
    const solveUsd = own.reduce((sum, score) => sum + score.solveUsd, 0).toFixed(2);
    const spread = read.rollouts === 1 && read.tier !== null ? `, one ${read.tier} rollout` : "";
    return [
      arm,
      first?.runtime ?? MISSING,
      run?.pack ?? MISSING,
      promotion === undefined || run === undefined
        ? "no recorded promotion"
        : `${String(promotion.nth)} of ${String(run.promotions.length)}`,
      promotion?.tally ?? MISSING,
      promotion === undefined ? MISSING : confirmedWord(promotion.confirmed),
      `${String(read.tasks)}${read.cut > 0 ? ` (${String(read.cut)} cut)` : ""}`,
      `${String(read.points)}/${String(read.total)}`,
      criteria === "?/?" ? MISSING : criteria,
      solveUsd,
      read.tier ?? MISSING,
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
    `The two readings agree on ${String(agree)} of ${String(joined.length)}: a promotion the starter confirmed that scores above the baseline spread, or one it did not that does not.`,
    "An arm is read on its tasks strictly against same-runtime delivered baseline rollouts of one solver tier (bareSolver or baseStarter) that hold them all; inside that spread is no reading, and one rollout a task reads a direction only. A deficit is a difference in conditions first (what the export carries and tells the solver, the interpreter, the day) and the harness only once those are equal.",
    "A campaign climbs on its own comparisons alone: promotions that come faster while these rows stay inside or below the baseline spread are fitted to those comparisons. A bench score promotes nothing, and no seat, prompt, check or query reads this table.",
  ];
}

function confirmedWord(confirmed: boolean | null): string {
  return confirmed === null ? "not read" : confirmed ? "confirmed" : "not confirmed";
}

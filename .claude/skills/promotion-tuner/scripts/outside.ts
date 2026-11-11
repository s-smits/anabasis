/**
 * The outside scores on record set beside the promotions they belong to, so that a climb read on a
 * campaign's own held-out tasks is checked against a grader the campaign never saw: promotions
 * that come faster while their harnesses score no higher outside than the Starter are fitted to
 * the campaign's comparisons (operator, 11 November 2026: "link the evals to the promotion ratio").
 *
 * The scores are the records `studies/harness2/score.ts` writes under `<store>/judged/<arm>/`,
 * one a task and arm. This reader is kept apart from that script on purpose, since a change to
 * `score.ts` makes every arm's stored rollouts another condition.
 *
 * An arm is joined to the promotion that promoted the digest its records name, among the campaigns
 * a caller folded; two arms can name one promotion, so the counts are of arms. Its points are
 * summed over the tasks a Starter rollout also holds and read against the Starter's lowest and
 * highest sum over its rollouts of them: inside that spread is no reading (rule 6).
 *
 * It prints counts, arm labels and task counts, never a rubric or a deliverable. Nothing here
 * reaches a seat, a prompt, a check or a query, and a bench score promotes nothing (`AGENTS.md`,
 * section 1, "An outside benchmark against fitting the query to it").
 */
import { MISSING, printed } from "#skills/main/print.ts";
import type { Promotion, Run } from "#skills/main/runs.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

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

/** Every judged rollout of a store; a record without points (a judgement that failed) is none. */
export function scoresOf(store: string): Score[] {
  const root = join(store, "judged");
  if (!existsSync(root)) throw new Error(`${root} is not there: --bench takes a score store`);
  // Sorted, so that the table's rows come in one order on every filesystem.
  const arms = readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
    .toSorted();
  return arms.flatMap((arm) =>
    readdirSync(join(root, arm))
      .toSorted()
      .flatMap((file) => {
        const record = asRecord(capturedJsonParse(readFileSync(join(root, arm, file), "utf8")));
        if (record === null || !isString(record.task)) return [];
        if (!isNumber(record.points) || !isNumber(record.total)) return [];
        const of = asRecord(record.build)?.of;
        return [
          {
            arm: isString(record.arm) ? record.arm : arm,
            harness: isString(record.harness) ? record.harness : "",
            task: record.task,
            points: record.points,
            total: record.total,
            of: isString(of) ? of : null,
            cut: Array.isArray(record.cut) && record.cut.length > 0,
          },
        ];
      }),
  );
}

/** The campaigns the arms of a store were built by, which a caller folds before `outsideLines`. */
export const campaignsOf = (scores: readonly Score[]): string[] => [
  ...new Set(scores.flatMap(({ of }) => (of === null || of === STARTER ? [] : [of]))),
];

/** An arm's sum against the Starter's sums on the same tasks. */
function againstStarter(own: readonly Score[], starter: readonly Score[]) {
  const shared = own.filter(({ task }) => starter.some((score) => score.task === task));
  const bound = (pick: (points: readonly number[]) => number) =>
    shared.reduce(
      (sum, { task }) =>
        sum + pick(starter.filter((score) => score.task === task).map(({ points }) => points)),
      0,
    );
  const [points, low, high] = [
    shared.reduce((sum, score) => sum + score.points, 0),
    bound((all) => Math.min(...all)),
    bound((all) => Math.max(...all)),
  ];
  const placed: Verdict = points > high ? "above" : points < low ? "below" : "inside";
  return {
    tasks: shared.length,
    points,
    total: shared.reduce((sum, score) => sum + score.total, 0),
    low,
    high,
    verdict: shared.length === 0 ? null : placed,
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
    const spread = read.low === read.high ? ", one Starter rollout" : "";
    return [
      arm,
      run?.pack ?? MISSING,
      promotion === undefined || run === undefined
        ? "no promotion on record"
        : `${String(promotion.nth)} of ${String(run.promotions.length)}`,
      promotion?.tally ?? MISSING,
      promotion === undefined ? MISSING : confirmedWord(promotion.confirmed),
      `${String(read.tasks)}${read.cut > 0 ? ` (${String(read.cut)} cut)` : ""}`,
      `${String(read.points)}/${String(read.total)}`,
      `${String(read.low)} to ${String(read.high)}`,
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
    "An arm is read on the tasks a Starter rollout also holds, against the Starter's lowest and highest sum over its rollouts of them; inside that spread is no reading, and one rollout a task reads a direction only. A deficit is a difference in conditions first (what the export carries and tells the solver, the interpreter, the day) and the harness only once those are equal.",
    "A campaign climbs on its own comparisons alone: promotions that come faster while these rows stay inside or below the Starter's spread are fitted to those comparisons. A bench score promotes nothing, and no seat, prompt, check or query reads this table.",
  ];
}

function confirmedWord(confirmed: boolean | null): string {
  return confirmed === null ? "not read" : confirmed ? "confirmed" : "not confirmed";
}

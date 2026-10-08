/**
 * The reviewers' weight in a round's reading: how much of its scored test rests on fails nobody
 * read, and how many mistaken rulings it would take to move it.
 *
 * As the gap between two harnesses shrinks, a round's reading comes to rest on a handful of
 * informative pairs, and the reviewers' error has to stay under that handful. Two readings already
 * touch this. A round reads `flags-decide` when its reading differs with and without the tasks an
 * advising Referee flagged (`src/builder/round.ts`), and `agreement.ts` holds the Referee to a bar
 * against hand labels. Neither says how the Referee's error compares with the size of the effect
 * in one report. This does, in three counts.
 *
 * - Of the informative pairs, wins and losses, how many hold a counted fail no reviewer ruled on.
 *   By the round's own rule a check defect on either side takes the whole task out of the
 *   comparison, so an unread fail under either harness leaves its pair unexamined.
 * - How many pairs would have to leave for the scored test to read the other way: wins, when it
 *   clears its level, and losses, when it does not. That is the number of mistaken rulings it
 *   takes, a mistaken ruling being a fail the Referee let stand that was a check's fault. The
 *   other mistake, an earned fail ruled a check defect, is the one `flags-decide` and the
 *   report's `unflagged` reading already show.
 * - How many such mistakes the Referee's measured error leads one to expect among those pairs.
 *
 * The third needs a measurement, and there is one only where a person labelled fails the Referee
 * also ruled (`agreement`). Without it the error is `unmeasured` and nothing is put in its place:
 * no rate is assumed, and none is borrowed from v1. A campaign's log holds no hand label today.
 * The labels are files beside a log (`tools/c/rejections.ts`), and the ones `tools/d2/settle.ts`
 * takes are made beside the rulings and measure nothing of the Referee. So read from a log alone
 * the error is unmeasured, and the measured reading is for a caller that holds blind labels.
 *
 * With a measurement, the rate is the share of the labelled fails the Referee let stand, ruled
 * earned or unclear, that a person labelled a check defect. It is given with the largest value it
 * has at 90% confidence, one-sided and exact (Clopper and Pearson's bound, by bisection on the
 * binomial sum): none mistaken of twelve bounds the rate at 17%, and reads as no error only to
 * someone who forgets there were twelve. The expected count takes one ruling a pair, since a
 * pair's fails are of one task and mostly of the same checks, and takes this round's fails to be
 * like the labelled ones, which were drawn from another set. Both are assumptions. It counts the
 * pairs every fail of which the Referee let stand, since those are the rulings the rate is of: a
 * pair with a fail it ruled a check defect is the report's `flagged`, and is read there.
 *
 * It is a reading. It disputes no task and moves no report.
 */
import { type Paired, signP } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { binomial } from "../kernel/size.ts";
import { isString } from "../meta/json-shape.ts";
import type { Agreement } from "./agreement.ts";

/** How often a ruling that lets a fail stand was mistaken, where hand labels measured it. */
export interface MeasuredError {
  /** Labelled fails the Referee ruled earned or unclear, and those of them labelled a check defect. */
  readonly stood: number;
  readonly mistaken: number;
  /** That share, and the largest it is at 90% confidence. */
  readonly rate: number;
  readonly atMost: number;
  /** Of the pairs the reading rests on whose fails the Referee all let stand: how many a mistaken
   *  ruling is expected under, at the rate and at its bound. */
  readonly expected: number;
  readonly expectedAtMost: number;
}

export interface Weight {
  /** The scored tasks that tell the two harnesses apart, and those of them with a counted fail,
   *  under either harness, that the log holds no ruling for. */
  readonly informative: number;
  readonly unread: number;
  /** Whether the scored test clears its level, and the pairs that reading rests on: its wins when
   *  it clears, its losses when it does not. */
  readonly cleared: boolean;
  readonly resting: number;
  /** The fewest of those pairs that would have to leave the tally for the test to read the other
   *  way; null when the test would not clear with every loss gone. */
  readonly toMove: number | null;
  readonly error: "unmeasured" | MeasuredError;
}

/** The confidence the rate's bound is given at, one-sided. */
const CONFIDENCE = 0.9;
/** Halvings of the bound's search, which leave it exact to the last bit a double holds. */
const HALVINGS = 60;
const DEFECT = "check-defect";

/** The largest rate at which `mistaken` or fewer of `stood` is still as likely as the confidence
 *  leaves: one when every one was mistaken. */
function bound(stood: number, mistaken: number): number {
  if (mistaken >= stood) return 1;
  const atMost = (rate: number) =>
    binomial(stood, rate)
      .slice(0, mistaken + 1)
      .reduce((sum, term) => sum + term, 0);
  let [low, high] = [mistaken / stood, 1];
  for (let step = 0; step < HALVINGS; step += 1) {
    const middle = (low + high) / 2;
    if (atMost(middle) > 1 - CONFIDENCE) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * The weight of the reviewers in the scored test of `pairs` at `level`. `pairs` are a report's own
 * (`pairsReported`, `src/builder/round.ts`), each naming its solves; a fail is read when `events`
 * hold a `referee.finding` for it, whatever the ruling. `measured` is the Referee's agreement with
 * hand labels, or null where there are none.
 */
export function weight(
  events: readonly LogEvent[],
  pairs: readonly Paired[],
  given: { readonly level: number; readonly measured: Agreement | null },
): Weight {
  // The last ruling the log holds for each solve, as `agreement` reads it.
  const rulings = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "referee.finding" && isString(data.solve) ? [[data.solve, data.ruling] as const] : [],
    ),
  );
  const sided = pairs.flatMap(({ old, fresh, solves }) => {
    const ahead = fresh.filter(Boolean).length - old.filter(Boolean).length;
    const fails = [
      ...old.flatMap((pass, index) => (pass ? [] : [solves?.old[index] ?? ""])),
      ...fresh.flatMap((pass, index) => (pass ? [] : [solves?.fresh[index] ?? ""])),
    ];
    const read = fails.every((solve) => rulings.has(solve));
    return ahead === 0
      ? []
      : [{ win: ahead > 0, read, letStand: read && fails.every((solve) => rulings.get(solve) !== DEFECT) }];
  });
  const wins = sided.filter(({ win }) => win).length;
  const losses = sided.length - wins;
  const cleared = signP(wins, losses) <= given.level;
  const resting = sided.filter(({ win }) => win === cleared);
  const gone = Array.from({ length: resting.length }, (_, index) => index + 1).find((left) =>
    cleared ? signP(wins - left, losses) > given.level : signP(wins, losses - left) <= given.level,
  );
  const table = given.measured?.table;
  const stood =
    table === undefined
      ? 0
      : [table.earned, table[DEFECT], table.unclear].reduce((sum, row) => sum + row.earned + row.unclear, 0);
  const mistaken = table === undefined ? 0 : table[DEFECT].earned + table[DEFECT].unclear;
  const examined = resting.filter(({ letStand }) => letStand).length;
  return {
    informative: sided.length,
    unread: sided.filter(({ read }) => !read).length,
    cleared,
    resting: resting.length,
    toMove: gone ?? null,
    error:
      stood === 0
        ? "unmeasured"
        : {
            stood,
            mistaken,
            rate: mistaken / stood,
            atMost: bound(stood, mistaken),
            expected: (examined * mistaken) / stood,
            expectedAtMost: examined * bound(stood, mistaken),
          },
  };
}

/** That reading in one line. Without a measurement it says `unmeasured` and nothing else of the
 *  Referee's error. */
export function weightLine(read: Weight): string {
  const side = read.cleared ? "wins" : "losses";
  const moved =
    read.toMove === null
      ? `with every one of its ${String(read.resting)} ${side} gone it would still not clear`
      : `${String(read.toMove)} of its ${String(read.resting)} ${side} resting on a mistaken ruling would move it`;
  const error =
    read.error === "unmeasured"
      ? "unmeasured"
      : `${String(read.error.mistaken)} of ${String(read.error.stood)} labelled fails it let stand, at most ${(read.error.atMost * 100).toFixed(0)}% at 90%: ${read.error.expected.toFixed(1)} such pairs expected, at most ${read.error.expectedAtMost.toFixed(1)}`;
  return `${String(read.unread)} of ${String(read.informative)} informative pairs rest on a fail no reviewer read; the scored test ${read.cleared ? "clears" : "does not clear"} its level, and ${moved}; the Referee's error is ${error}`;
}

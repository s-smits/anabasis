/**
 * How far the Referee's rulings agree with a person's labels of the same fails.
 *
 * The plan has every failing answer of the pilot and of D1 read by hand, as a wrong answer, a check
 * that refuses a right answer, or unclear: the Referee's three rulings. Those labels are the only set
 * the Referee can be measured on before it decides anything, and v1's equivalent reader failed the
 * bar frozen for it. So the bar is an argument the operator writes down before the Referee runs on
 * the labelled fails, and this file only counts.
 *
 * Two rates carry the risk, and they pull apart. A check defect the Referee lets stand turns a broken
 * check into a scored task; an earned fail it voids removes a real limit from the count.
 *
 * Beside them, since 12 October, the agreement of each kind and over all three (the overhaul plan's
 * M3, research 06): on kinds as uneven as these, most fails earned, Cohen's kappa can be low while
 * the share read alike is high, so kappa is reported beside PABAK, the share read alike corrected
 * for three kinds and not for how they are spread, and never alone.
 *
 * Since 13 October no bar is read on fewer than thirty labelled fails (`LEAST_LABELS`), whatever
 * else the operator sets. And where a person
 * labels more than one in four of the Referee's `unclear` rulings earned, it is said in one line
 * (`unclearReport`): an unclear ruling sets its task aside, so a Referee that rules unclear what a
 * person reads as earned removes real limits from the count. The line is a report and gates nothing.
 */
import type { LogEvent } from "../kernel/log.ts";
import { isString } from "../meta/json-shape.ts";
import type { Ruling } from "./referee.ts";

/** The Referee's three rulings, which are a person's three labels too. */
export const RULINGS = ["earned", "check-defect", "unclear"] as const;

/** The fewest labelled fails any bar is read on. */
const LEAST_LABELS = 30;
/** The share of `unclear` rulings labelled earned past which the report speaks. */
const UNCLEAR_EARNED = 1 / 4;

/** The bar, frozen before the Referee reads a labelled fail. */
interface Bar {
  /** Of the fails a person labelled a check defect, the least share the Referee must void. */
  readonly caught: number;
  /** Of the fails a person labelled earned, the most the Referee may void. */
  readonly voided: number;
}

interface Agreement {
  /** `table[label][ruling]`: fails a person labelled `label` that the Referee ruled `ruling`. */
  readonly table: Readonly<Record<Ruling, Readonly<Record<Ruling, number>>>>;
  /** Labelled fails the log holds no ruling for. */
  readonly unruled: readonly string[];
  /** The two rates; null where no fail carries the label they are a share of. */
  readonly caught: number | null;
  readonly voided: number | null;
  /** Of the fails the Referee ruled unclear, the share a person labelled earned; null where it
   *  ruled none unclear. */
  readonly unclearEarned: number | null;
  /** Of each kind, twice the fails both called it over the fails either did; null where neither did. */
  readonly specific: Readonly<Record<Ruling, number | null>>;
  /** The share of ruled fails both read alike, Cohen's kappa and PABAK; null where none was ruled,
   *  and kappa null where chance alone would have them agree on every one. */
  readonly observed: number | null;
  readonly kappa: number | null;
  readonly pabak: number | null;
}

/** The last ruling the log holds for each labelled solve, set against its label. */
export function agreement(events: readonly LogEvent[], labels: ReadonlyMap<string, Ruling>): Agreement {
  // SAFETY: both levels are built from RULINGS, so every Ruling key is present at each.
  const table = Object.fromEntries(
    RULINGS.map((label) => [label, Object.fromEntries(RULINGS.map((ruling) => [ruling, 0]))]),
  ) as Record<Ruling, Record<Ruling, number>>;
  const unruled: string[] = [];
  for (const [solve, label] of labels) {
    const found = events.findLast(({ kind, data }) => kind === "referee.finding" && data.solve === solve)
      ?.data.ruling;
    const ruling = RULINGS.find((known) => known === found);
    if (!isString(found) || ruling === undefined) unruled.push(solve);
    else table[label][ruling] += 1;
  }
  const labelled = (kind: Ruling) => RULINGS.reduce((sum, ruling) => sum + table[kind][ruling], 0);
  const ruled = (kind: Ruling) => RULINGS.reduce((sum, label) => sum + table[label][kind], 0);
  const share = (label: Ruling) => {
    const total = labelled(label);
    return total === 0 ? null : table[label]["check-defect"] / total;
  };
  const total = RULINGS.reduce((sum, kind) => sum + labelled(kind), 0);
  const alike = RULINGS.reduce((sum, kind) => sum + table[kind][kind], 0) / total;
  const chance = RULINGS.reduce((sum, kind) => sum + labelled(kind) * ruled(kind), 0) / total ** 2;
  return {
    table,
    unruled,
    caught: share("check-defect"),
    voided: share("earned"),
    unclearEarned: ruled("unclear") === 0 ? null : table.earned.unclear / ruled("unclear"),
    // SAFETY: built from RULINGS, so every Ruling key is present.
    specific: Object.fromEntries(
      RULINGS.map((kind) => {
        const either = labelled(kind) + ruled(kind);
        return [kind, either === 0 ? null : (2 * table[kind][kind]) / either];
      }),
    ) as Record<Ruling, number | null>,
    observed: total === 0 ? null : alike,
    kappa: total === 0 || chance === 1 ? null : (alike - chance) / (1 - chance),
    pabak: total === 0 ? null : (RULINGS.length * alike - 1) / (RULINGS.length - 1),
  };
}

/** Whether the rulings clear the bar. Fewer than `LEAST_LABELS` labelled fails clear nothing, and
 *  nor does a rate with nothing to be a share of: a set with no hand-labelled check defect cannot
 *  show the Referee catches one. */
export function clears(measured: Agreement, bar: Bar): boolean {
  const labelled = RULINGS.flatMap((label) => RULINGS.map((ruling) => measured.table[label][ruling]));
  return (
    measured.unruled.length === 0 &&
    labelled.reduce((sum, count) => sum + count, 0) >= LEAST_LABELS &&
    measured.caught !== null &&
    measured.caught >= bar.caught &&
    measured.voided !== null &&
    measured.voided <= bar.voided
  );
}

/** One line where a person labelled more than one in four of the Referee's `unclear` rulings
 *  earned; null otherwise. It gates nothing. */
export function unclearReport({ table, unclearEarned }: Agreement): string | null {
  if (unclearEarned === null || unclearEarned <= UNCLEAR_EARNED) return null;
  const ruled = RULINGS.reduce((sum, label) => sum + table[label].unclear, 0);
  return `a person labelled earned ${String(table.earned.unclear)} of the Referee's ${String(ruled)} unclear rulings, more than one in four: an unclear ruling sets aside a task a person reads as a real limit`;
}

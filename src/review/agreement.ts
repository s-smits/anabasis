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
 */
import type { LogEvent } from "../kernel/log.ts";
import { isString } from "../meta/json-shape.ts";
import { type Owner, OWNERS } from "./diagnoser.ts";
import type { Ruling } from "./referee.ts";

/** The Referee's three rulings, which are a person's three labels too. */
export const RULINGS = ["earned", "check-defect", "unclear"] as const;

/** A person's words on one diagnosed practice fail: the Diagnoser's three owners, or unclear. */
export const DIAGNOSIS_LABELS = [...OWNERS, "unclear"] as const;
type DiagnosisLabel = (typeof DIAGNOSIS_LABELS)[number];

interface DiagnosesAgreement {
  /** Diagnoses on record that named an owner, and how many named the solver: the lean. Of the
   *  first twelve with real models (9 October) all twelve named the solver, from a reader shown
   *  no guide; of eight on 10 October all eight did, one naming an engine the Starter lacked. */
  readonly recorded: number;
  readonly solver: number;
  /** Labelled diagnoses, and how many the Diagnoser's owner agrees with; one labelled unclear is
   *  counted in neither. Labelled fails the log holds no diagnosis for. */
  readonly labelled: number;
  readonly agreed: number;
  readonly undiagnosed: readonly string[];
}

/** The bar, frozen before the Referee reads a labelled fail. */
interface Bar {
  /** The fewest labelled fails that measure anything. */
  readonly fails: number;
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
  const share = (label: Ruling) => {
    const row = table[label];
    const total = row.earned + row["check-defect"] + row.unclear;
    return total === 0 ? null : row["check-defect"] / total;
  };
  return { table, unruled, caught: share("check-defect"), voided: share("earned") };
}

/** Whether the rulings clear the bar. A rate with nothing to be a share of clears nothing: a set
 *  with no hand-labelled check defect cannot show the Referee catches one. */
export function clears(measured: Agreement, bar: Bar): boolean {
  const labelled = RULINGS.flatMap((label) => RULINGS.map((ruling) => measured.table[label][ruling]));
  return (
    measured.unruled.length === 0 &&
    labelled.reduce((sum, count) => sum + count, 0) >= bar.fails &&
    measured.caught !== null &&
    measured.caught >= bar.caught &&
    measured.voided !== null &&
    measured.voided <= bar.voided
  );
}

/** The Diagnoser's owner for each labelled solve set against the person's label. A diagnosis is
 *  the Builder's lead and enters no verdict, so this measures a lean and no bar: a Diagnoser that
 *  blames the solver whatever the harness did steers Builders away from their own faults. */
export function diagnosesAgreement(
  events: readonly LogEvent[],
  labels: ReadonlyMap<string, DiagnosisLabel>,
): DiagnosesAgreement {
  const owners = new Map<string, Owner>();
  for (const { kind, data } of events) {
    if (kind !== "diagnosis.recorded" || !isString(data.solve)) continue;
    const owner = OWNERS.find((known) => known === data.owner);
    if (owner !== undefined) owners.set(data.solve, owner);
  }
  const counts = { labelled: 0, agreed: 0 };
  const undiagnosed: string[] = [];
  for (const [solve, label] of labels) {
    const owner = owners.get(solve);
    if (owner === undefined) {
      undiagnosed.push(solve);
      continue;
    }
    if (label === "unclear") continue;
    counts.labelled += 1;
    if (owner === label) counts.agreed += 1;
  }
  return {
    recorded: owners.size,
    solver: [...owners.values()].filter((owner) => owner === "solver").length,
    ...counts,
    undiagnosed,
  };
}

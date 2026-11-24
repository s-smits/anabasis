import type { LogEvent } from "../kernel/log.ts";
import { labelsIn, rulingsOf } from "../kernel/solves.ts";
import type { Ruling } from "./referee.ts";

export const RULINGS = ["earned", "check-defect", "unclear"] as const;
export const PASS_LABELS = ["sound", "wrong", "unclear"] as const;
export type PassLabel = (typeof PASS_LABELS)[number];

const LEAST_LABELS = 30;
const LEAST_PASS_LABELS = 20;
const MAX_WRONG_PASS = 0.1;
const UNCLEAR_EARNED = 1 / 4;

interface Bar {
  readonly caught: number;
  readonly voided: number;
}

interface Agreement {
  readonly table: Readonly<Record<Ruling, Readonly<Record<Ruling, number>>>>;
  readonly unruled: readonly string[];
  readonly caught: number | null;
  readonly voided: number | null;
  readonly unclearEarned: number | null;
  readonly specific: Readonly<Record<Ruling, number | null>>;
  readonly observed: number | null;
  readonly kappa: number | null;
  readonly pabak: number | null;
}

function settledBy<T extends string>(
  events: readonly LogEvent[],
  field: "labels" | "passes",
  known: readonly T[],
): Map<string, T> {
  return new Map(
    [...labelsIn(events, field)].flatMap(([solve, label]) => {
      const matched = known.find((word) => word === label);
      return matched === undefined ? [] : [[solve, matched] as const];
    }),
  );
}

export const settledLabels = (events: readonly LogEvent[]): Map<string, Ruling> =>
  settledBy(events, "labels", RULINGS);

export function agreement(events: readonly LogEvent[], labels: ReadonlyMap<string, Ruling>): Agreement {
  // SAFETY: both levels are built from RULINGS, so every Ruling key is present at each.
  const table = Object.fromEntries(
    RULINGS.map((label) => [label, Object.fromEntries(RULINGS.map((ruling) => [ruling, 0]))]),
  ) as Record<Ruling, Record<Ruling, number>>;
  const unruled: string[] = [];
  const rulings = rulingsOf(events);
  for (const [solve, label] of labels) {
    const ruling = RULINGS.find((known) => known === rulings.get(solve));
    if (ruling === undefined) unruled.push(solve);
    else table[label][ruling] += 1;
  }
  const labelled = (kind: Ruling) => RULINGS.reduce((sum, ruling) => sum + table[kind][ruling], 0);
  const ruled = (kind: Ruling) => RULINGS.reduce((sum, label) => sum + table[label][kind], 0);
  const share = (label: Ruling) => {
    const total = labelled(label);
    return total === 0 ? null : (total - table[label].earned) / total;
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

export function unclearReport({ table, unclearEarned }: Agreement): string | null {
  if (unclearEarned === null || unclearEarned <= UNCLEAR_EARNED) return null;
  const ruled = RULINGS.reduce((sum, label) => sum + table[label].unclear, 0);
  return `a person labelled earned ${String(table.earned.unclear)} of the Referee's ${String(ruled)} unclear rulings, more than one in four: an unclear ruling sets aside a task a person reads as a real limit`;
}

export const settledPassLabels = (events: readonly LogEvent[]): Map<string, PassLabel> =>
  settledBy(events, "passes", PASS_LABELS);

export function passAgreement(labels: ReadonlyMap<string, PassLabel>) {
  const counts: Record<PassLabel, number> = { sound: 0, wrong: 0, unclear: 0 };
  for (const label of labels.values()) counts[label] += 1;
  const total = labels.size;
  const decided = counts.sound + counts.wrong;
  const wrongRate = decided === 0 ? null : counts.wrong / decided;
  return {
    counts,
    total,
    decided,
    wrongRate,
    clears: decided >= LEAST_PASS_LABELS && wrongRate !== null && wrongRate <= MAX_WRONG_PASS,
  };
}

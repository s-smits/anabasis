import { eventsOf, type LogEvent } from "../kernel/log.ts";
import { labelsIn, normalizeRuling } from "../kernel/solves.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import type { Ruling } from "./auditor.ts";

export const RULINGS = ["solver-fail", "check-defect", "unclear"] as const;
export const PASS_LABELS = ["sound", "wrong", "unclear"] as const;
export type PassLabel = (typeof PASS_LABELS)[number];

const LEAST_LABELS = 30;
const LEAST_DEFECTS = 8;
const LEAST_PASS_LABELS = 20;
const MAX_WRONG_PASS = 0.1;
const UNCLEAR_EARNED = 1 / 4;

interface Bar {
  readonly caught: number;
  readonly voided: number;
}

export const VERDICT_BAR: Bar = { caught: 0.75, voided: 0.1 };

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
  const rulings = new Map<string, string | null>();
  for (const {
    event: { data },
  } of eventsOf(events, "referee.finding")) {
    if (!isString(data.solve) || isString(data.reusedFrom)) continue;
    rulings.set(data.solve, normalizeRuling(data.ruling));
  }
  for (const [solve, label] of labels) {
    const ruling = RULINGS.find((known) => known === rulings.get(solve));
    if (ruling === undefined) unruled.push(solve);
    else table[label][ruling] += 1;
  }
  const labelledCount = (kind: Ruling) => RULINGS.reduce((sum, ruling) => sum + table[kind][ruling], 0);
  const ruled = (kind: Ruling) => RULINGS.reduce((sum, label) => sum + table[label][kind], 0);
  const share = (label: Ruling) => {
    const total = labelledCount(label);
    return total === 0 ? null : (total - table[label]["solver-fail"]) / total;
  };
  const total = RULINGS.reduce((sum, kind) => sum + labelledCount(kind), 0);
  const alike = RULINGS.reduce((sum, kind) => sum + table[kind][kind], 0) / total;
  const chance = RULINGS.reduce((sum, kind) => sum + labelledCount(kind) * ruled(kind), 0) / total ** 2;
  return {
    table,
    unruled,
    caught: share("check-defect"),
    voided: share("solver-fail"),
    unclearEarned: ruled("unclear") === 0 ? null : table["solver-fail"].unclear / ruled("unclear"),
    // SAFETY: built from RULINGS, so every Ruling key is present.
    specific: Object.fromEntries(
      RULINGS.map((kind) => {
        const either = labelledCount(kind) + ruled(kind);
        return [kind, either === 0 ? null : (2 * table[kind][kind]) / either];
      }),
    ) as Record<Ruling, number | null>,
    observed: total === 0 ? null : alike,
    kappa: total === 0 || chance === 1 ? null : (alike - chance) / (1 - chance),
    pabak: total === 0 ? null : (RULINGS.length * alike - 1) / (RULINGS.length - 1),
  };
}

export function clears(measured: Agreement, bar: Bar): boolean {
  const counts = RULINGS.flatMap((label) => RULINGS.map((ruling) => measured.table[label][ruling]));
  return (
    measured.unruled.length === 0 &&
    counts.reduce((sum, count) => sum + count, 0) >= LEAST_LABELS &&
    RULINGS.reduce((sum, ruling) => sum + measured.table["check-defect"][ruling], 0) >= LEAST_DEFECTS &&
    measured.caught !== null &&
    measured.caught >= bar.caught &&
    measured.voided !== null &&
    measured.voided <= bar.voided
  );
}

export function unclearReport({ table, unclearEarned }: Agreement): string | null {
  if (unclearEarned === null || unclearEarned <= UNCLEAR_EARNED) return null;
  const ruled = RULINGS.reduce((sum, label) => sum + table[label].unclear, 0);
  return `human reviewers labelled solver-fail on ${String(table["solver-fail"].unclear)} of the Auditor's ${String(ruled)} unclear rulings, more than one in four`;
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

export function labelled<Word extends string>(file: JsonValue, known: readonly Word[]) {
  const labels = new Map<string, Word>();
  const open: string[] = [];
  for (const [solve, value] of Object.entries(asRecord(file) ?? {})) {
    const word = known.find((each) => each === value);
    if (word === undefined) open.push(solve);
    else labels.set(solve, word);
  }
  return { labels, open };
}

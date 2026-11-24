import { append, eventsOf, type LogEvent, read } from "../kernel/log.ts";
import { ranUnder } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { asRecord } from "../meta/json-shape.ts";
import type { PassLabel } from "../referee/agreement.ts";
import type { Ruling } from "../referee/referee.ts";
import {
  compared,
  coverageOf,
  DEFECT,
  type Fixed,
  fixedIn,
  passesIn,
  type Report,
  REPORTED,
  reported,
  startOf,
  toLabel,
  UNSETTLED,
  wrongAsFailed,
} from "./comparison.ts";
import { dispute } from "./round.ts";

function restopped(
  report: Report,
  events: readonly LogEvent[],
  fixed: Fixed,
  labels: ReadonlyMap<string, Ruling>,
): Report {
  const { short, aside, withdrawn } = coverageOf(events, fixed, labels);
  const states = taskStates(events);
  return { ...report, short, aside: aside.filter((task) => states.get(task) !== "disputed"), withdrawn };
}

export function settleReading(
  log: string,
  id: string,
  labels: ReadonlyMap<string, Ruling>,
  passes: ReadonlyMap<string, PassLabel> = new Map(),
): Report {
  const before = read(log);
  const last = eventsOf(before, REPORTED).findLast(({ event }) => event.data.session === id)?.event.data;
  const report = reported(before, id);
  const fixed = fixedIn(before, id);
  if (last === undefined || report === null) throw new Error(`comparison ${id} has no report to settle`);
  if (report.settled !== null && report.settled !== UNSETTLED) {
    const was = { ...report.settled.labels, ...report.settled.passes };
    const given = new Map<string, string>([...labels, ...passes]);
    const other = [...new Set([...given.keys(), ...Object.keys(was)])].filter(
      (solve) => given.get(solve) !== was[solve],
    );
    if (other.length > 0) {
      throw new Error(
        `comparison ${id} is settled already, and these labels are not the ones it was settled on (${other.join(", ")}): a comparison is settled once`,
      );
    }
    return report;
  }
  if (fixed === null) {
    throw new Error(
      `comparison ${id} reads ${report.reading} and compared nothing, so there is nothing to settle`,
    );
  }
  const began = startOf(before, id)?.budgets;
  if (Array.isArray(began) && began.length > 0) {
    throw new Error(
      `comparison ${id} began with ${String(began.length)} shorter budgets, which this source reads no longer: its report stands as it was written. Settle it from the commit it was made at`,
    );
  }
  const { aside, others } = toLabel(before, id);
  const known = new Set([...aside, ...others]);
  const stray = [...labels.keys()].find((solve) => !known.has(solve));
  if (stray !== undefined) throw new Error(`${stray} is no rejected answer of comparison ${id}`);
  const valid = new Set(passesIn(before, id));
  const unpassed = [...passes.keys()].find((solve) => !valid.has(solve));
  if (unpassed !== undefined) throw new Error(`${unpassed} is no answer that passed in comparison ${id}`);
  const versionOf = new Map(ranUnder(before).map((solve) => [solve.id, solve.under.task] as const));
  const defects = [...labels].flatMap(([solve, label]) => (label === DEFECT ? [solve] : []));
  const reason = "a person labelled the rejection a check defect";
  const disputed = defects.flatMap((solve) => {
    const version = versionOf.get(solve) ?? "";
    return dispute(log, id, version, { solve, reason }) ? [version] : [];
  });
  const failed = wrongAsFailed(
    disputed.length === 0 ? before : read(log),
    labels,
    Object.fromEntries(passes),
  );
  const found =
    report.scored === null
      ? restopped(report, failed.events, fixed, failed.labels)
      : compared(failed.events, fixed, failed.labels);
  const settled: Report = {
    old: report.old,
    fresh: report.fresh,
    starter: report.starter,
    ...found,
    disputed: [...new Set([...report.disputed, ...disputed])],
    capped: report.capped,
    settled: {
      labelled: labels.size,
      defects: defects.length,
      disputed,
      restored:
        report.scored === null ? [] : found.versions.filter((version) => report.aside.includes(version)),
      labels: Object.fromEntries(labels),
      passes: Object.fromEntries(passes),
    },
  };
  append(log, REPORTED, { ...last, ...asRecord(settled) });
  return settled;
}

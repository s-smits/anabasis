/**
 * Settle a comparison reading using blind operator labels (`settleReading`): recomputes the
 * comparison outcome from the existing solves and appends an updated `comparison.reported` event
 * without launching new solves.
 */
import { append, type LogEvent, read } from "../kernel/log.ts";
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

/** A stopped report's coverage read again under a person's labels: its reading and its absent test
 *  stand, and a task the labels disputed leaves what it set aside. */
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

/**
 * Settle a comparison's reading on a person's answer to its packet (`settle.ts`), and report again.
 */
export function settleReading(
  log: string,
  id: string,
  labels: ReadonlyMap<string, Ruling>,
  passes: ReadonlyMap<string, PassLabel> = new Map(),
): Report {
  const before = read(log);
  const last = before.findLast((event) => event.kind === REPORTED && event.data.session === id)?.data;
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
  // A comparison that began with shorter budgets, as an old one may have, reported
  // rows this source reads no longer, and the settled report would drop them in place of the report
  // the comparison began with.
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
  // A task a person refused since stays refused: its rejection keeps its label, and the task is
  // left out of this comparison as one set aside.
  const disputed = defects.flatMap((solve) => {
    const version = versionOf.get(solve) ?? "";
    return dispute(log, id, version, { solve, reason }) ? [version] : [];
  });
  const failed = wrongAsFailed(read(log), labels, Object.fromEntries(passes));
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
  // The comparison's own terms are carried, so the settled report reads alone as the first one did.
  append(log, REPORTED, { ...last, ...asRecord(settled) });
  return settled;
}

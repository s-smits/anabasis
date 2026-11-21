/**
 * Settling a comparison on a person's labels: its reading is read again from the same solves
 * (`settleReading`), and the result is logged as the comparison's last report. No solve is made.
 */
import { append, type LogEvent, read } from "../kernel/log.ts";
import { ranUnder } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { asRecord } from "../meta/json-shape.ts";
import type { Ruling } from "../referee/referee.ts";
import {
  compared,
  coverageOf,
  DEFECT,
  type Fixed,
  fixedIn,
  type PassLabel,
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
 *
 * `labels` holds a ruling a rejected answer, and a person's label stands over the Referee's ruling
 * of the same rejection. A task whose rejections then all stand as earned is restored to the tally.
 * One labelled a check defect disputes its task, which leaves every comparison from then on. One
 * labelled unclear, and one set aside on a rejection the packet did not draw, stays out of this
 * comparison. `passes` holds a person's word on a drawn answer that passed: one labelled wrong
 * counts as its side's fail, as an earned rejection does, and sound or unclear change nothing.
 * The tests are read again from the same solves and logged as the comparison's last report, with
 * what was settled and the labels themselves. Run again with the same labels it returns that
 * report. A comparison is settled once: other labels for one already settled are refused.
 *
 * A settling makes no solve. A stopped comparison records its labels and completion facts while
 * retaining its original reading and absent test; no task can be restored to a tally it never had.
 *
 * The comparison is read as its own report found it (`asReported`), so the labels settle the same
 * reading whether they come at once or after later comparisons have solved the same tasks.
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

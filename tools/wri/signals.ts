/**
 * Current-system WRI triggers covering pass soundness (`settledPassLabels`), deliverable artifact
 * capture (`manifestOf`), practice probing and epoch-scoped release, export readiness, Examiner
 * zero-yield and family concentration, seat compaction and interrupted handover, underpowered
 * no-steps, solver tool-error friction, and billing residuals.
 *
 * Every trigger prints only wall-safe counts, digests, and session identifiers — never task text,
 * family names, file paths, or hidden values.
 */
import { short } from "#src/campaign/move.ts";
import { DELIVERABLES, manifestOf } from "#src/kernel/answer-files.ts";
import { costLine } from "#src/kernel/meter.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { passAgreement, settledPassLabels } from "#src/referee/agreement.ts";
import { draftDeliverableInfo } from "./deliverables.ts";
import { unpricedCompactions } from "./epoch-spend.ts";
import {
  EXAM_END,
  firedIf,
  type Index,
  items,
  percent,
  practiceOf,
  share,
  tallyOf,
  text,
  type Trigger,
} from "./folds.ts";
import { inheritedPracticeReleases } from "./transfer.ts";

const REPEATED_PRACTICE = 4;
const MAX_SHOWN = 6;
const MIN_FAMILY_POOL = 8;
const UNDERPOWERED_MAX_TASKS = 10;
const UNDERPOWERED_MIN_RUNS = 2;
const MIN_ARM_CALLS = 10;
const RESIDUAL_PCT = 5;
const RESIDUAL_RE = /\(([+-]\d+(?:\.\d+)?)%\)$/u;

/** Lane 1: human pass-soundness labels recorded on this log (`passAgreement`). */
function passLabelTriggers(log: Index): Trigger[] {
  const summary = passAgreement(settledPassLabels(log.events));
  if (summary.total === 0) return [];
  const rate = summary.wrongRate === null ? "none" : `${(summary.wrongRate * 100).toFixed(1)}%`;
  return firedIf(
    true,
    "PASSES LABELLED",
    `${plural(summary.total, "labelled pass")}: sound ${String(summary.counts.sound)}, wrong ${String(summary.counts.wrong)}, unclear ${String(summary.counts.unclear)}; wrong rate ${rate} (${share(summary.counts.wrong, summary.decided)} decided); bar ${summary.clears ? "clears" : "unmet"}`,
  );
}

/** Lane 3: deliverable file capture across verdicts and draft file declarations. */
function deliverableTriggers(log: Index): Trigger[] {
  const verdicts = log.of("verdict");
  let [withFiles, totalFiles, maxBytes, atBound] = [0, 0, 0, 0];
  for (const data of verdicts) {
    if (data.files === undefined) continue;
    const files = manifestOf(data.files);
    if (files.length === 0) continue;
    withFiles += 1;
    totalFiles += files.length;
    const bytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
    if (bytes > maxBytes) maxBytes = bytes;
    if (files.length >= DELIVERABLES.count || bytes >= DELIVERABLES.bytes) atBound += 1;
  }
  const draftInfo = draftDeliverableInfo(log.events);
  const draftUsesFiles =
    draftInfo.evaluatorUsesFiles || draftInfo.acceptWithFiles > 0 || draftInfo.rejectWithFiles > 0;
  return [
    ...firedIf(
      withFiles > 0,
      "DELIVERABLES CAPTURED",
      `${share(withFiles, verdicts.length)} verdicts carried ${plural(totalFiles, "file")} (max ${String(maxBytes)} bytes; ${String(atBound)} at capture bound)`,
    ),
    ...firedIf(
      withFiles === 0 && draftUsesFiles && verdicts.length > 0,
      "NO DELIVERABLES CAPTURED",
      `drafted exam references deliverables but 0 of ${plural(verdicts.length, "verdict")} carried files`,
    ),
  ];
}

/** Lane 11: repeated single-task practice probing and pre-promotion tasks released after promotion. */
function practiceSignalTriggers(log: Index): Trigger[] {
  const repeated = log.builds.flatMap((build) => {
    const counts = countBy(practiceOf(log, build), (solve) => solve.version);
    const heavy = Object.entries(counts)
      .filter(([, times]) => times >= REPEATED_PRACTICE)
      .toSorted(([, left], [, right]) => right - left);
    return heavy.length === 0
      ? []
      : [
          `${build.session}: ${heavy
            .slice(0, MAX_SHOWN)
            .map(([version, times]) => `${short(version)} (${String(times)})`)
            .join(", ")}${heavy.length > MAX_SHOWN ? ` +${String(heavy.length - MAX_SHOWN)} more` : ""}`,
        ];
  });
  const inherited = inheritedPracticeReleases(log.events).map(short);
  return [
    ...firedIf(
      repeated.length > 0,
      "PRACTICE CONCENTRATION",
      `tasks practised ${String(REPEATED_PRACTICE)}+ times in one session: ${repeated.join("; ")}`,
    ),
    ...firedIf(
      inherited.length > 0,
      "PRE-PROMOTION PRACTICE RELEASED",
      `${plural(inherited.length, "pre-promotion task")} released after a promotion: ${inherited.slice(0, MAX_SHOWN).join(" ")}`,
    ),
  ];
}

/** Lane 12: built or promoted harnesses ready for portability and external-transfer review. */
function exportTriggers(log: Index): Trigger[] {
  const promoted = log.of("harness.promoted").map((data) => short(text(data.harness)));
  const built = new Set(
    log.compared.flatMap(({ own }) => {
      const fresh = text(own.fresh);
      return fresh !== "" && fresh !== text(own.old) && fresh !== text(own.starter) ? [short(fresh)] : [];
    }),
  );
  return firedIf(
    promoted.length > 0 || built.size > 0,
    "BUILT HARNESS FOR EXPORT",
    `${String(promoted.length)} promoted ${promoted.length === 1 ? "harness" : "harnesses"} (${promoted.join(", ") || "none"}), ${plural(built.size, "compared candidate")}`,
  );
}

/** Lane 13: Examiner sessions holding zero tasks and held-out family concentration (counts only). */
function examinerSignalTriggers(log: Index): Trigger[] {
  const proposedBy = countBy(
    log.of("task.proposed").filter((data) => isString(data.session)),
    (data) => text(data.session),
  );
  const triesBy = countBy(
    log.traces.filter(
      (each) => each.part === "call" && each.seat === "exam" && each.tool === "try_reference",
    ),
    (each) => each.id,
  );
  const zeroYield = log.of(EXAM_END).flatMap((data) => {
    const session = text(data.session);
    const held = items(data.held).length;
    if (held > 0) return [];
    const proposed = proposedBy[session] ?? 0;
    const tries = triesBy[session] ?? 0;
    return [
      `${session} (${text(data.ended) || "ended"}, ${String(proposed)} proposed, ${String(tries)} try_reference)`,
    ];
  });
  const familyOf = new Map<string, string>();
  for (const data of log.of("task.proposed")) {
    const version = text(data.version);
    const task = asRecord(data.task);
    const family = text(task?.family) || text(data.family);
    if (version !== "" && family !== "") familyOf.set(version, family);
  }
  const heldFamilies = countBy(
    log.held.flatMap((version) => {
      const family = familyOf.get(version);
      return family === undefined ? [] : [family];
    }),
    (family) => family,
  );
  const counts = Object.values(heldFamilies).toSorted((a, b) => b - a);
  const topCount = counts[0] ?? 0;
  return [
    ...firedIf(zeroYield.length > 0, "EXAMINER ZERO YIELD", zeroYield.join("; ")),
    ...firedIf(
      log.held.length >= MIN_FAMILY_POOL && topCount * 2 > log.held.length,
      "FAMILY CONCENTRATION",
      `largest family holds ${share(topCount, log.held.length)} held tasks across ${String(counts.length)} ${counts.length === 1 ? "family" : "families"}`,
    ),
  ];
}

/** Lane 15: Examiner/solver compactions and Builder sessions opening after interrupted predecessors. */
function continuityTriggers(log: Index): Trigger[] {
  const compactions = log.traces.filter((each) => each.part === "compacted");
  const examCompacted = compactions.filter((each) => each.seat === "exam" || each.seat === "draft");
  const examGroups = Map.groupBy(examCompacted, ({ seat, id }) => `${seat}:${id}`);
  const examLines = [...examGroups].map(([key, rows]) => {
    const [seat = "", id = ""] = key.split(":");
    const opened = log.traces.filter(
      (each) => each.part === "call" && each.seat === seat && each.id === id && each.tool === "read_opening",
    ).length;
    return `${id}: ${plural(rows.length, "compaction")}, read_opening ${String(opened)}`;
  });
  const solveCompacted = compactions.filter((each) => each.seat === "solve");
  const compactedSolves = new Set(solveCompacted.map((each) => each.id));
  const handovers = log.builds.slice(1).flatMap((build, index) => {
    const previous = log.builds[index];
    const prevEnded =
      previous === undefined ? "" : previous.finished === null ? "unfinished" : text(previous.finished.ended);
    return previous !== undefined && prevEnded !== "finished"
      ? [`${build.session} after ${previous.session} (${prevEnded})`]
      : [];
  });
  return [
    ...firedIf(examLines.length > 0, "EXAMINER COMPACTED", examLines.join("; ")),
    ...firedIf(
      solveCompacted.length > 0,
      "SOLVER COMPACTED",
      `${plural(solveCompacted.length, "compaction")} across ${plural(compactedSolves.size, "solve")}`,
    ),
    ...firedIf(handovers.length > 0, "INTERRUPTED HANDOVER", handovers.join("; ")),
  ];
}

/** Lane 16: repeated candidate no-steps scored on 10 or fewer tasks (burning stop-rule patience). */
function underpoweredTriggers(log: Index): Trigger[] {
  const small = log.compared.flatMap(({ session, own, last }) => {
    if (text(last.reading) !== "no-step" || own.fresh === own.starter || own.old === own.fresh) return [];
    const scored = tallyOf(last.scored);
    if (scored === null) return [];
    const tasks = scored.wins + scored.losses + scored.ties;
    return tasks > 0 && tasks <= UNDERPOWERED_MAX_TASKS ? [`${session} (${String(tasks)} tasks)`] : [];
  });
  return firedIf(
    small.length >= UNDERPOWERED_MIN_RUNS,
    "UNDERPOWERED NO-STEPS",
    `${plural(small.length, "candidate no-step")} scored <= ${String(UNDERPOWERED_MAX_TASKS)} tasks: ${small.join("; ")}`,
  );
}

/** Lane 17: comparison arms whose solver tool calls exceed a 20% error rate. */
function toolErrorTriggers(log: Index): Trigger[] {
  const high = log.compared.flatMap(({ session, own, scoring }) => {
    const checkSide = (label: string, harness: JsonValue | undefined) => {
      const side = scoring.filter((solve) => solve.harness === harness);
      const calls = side.reduce((sum, solve) => sum + solve.calls.length, 0);
      const errors = side.reduce((sum, solve) => sum + solve.errors, 0);
      return calls >= MIN_ARM_CALLS && errors * 5 > calls
        ? [`${session} ${label}: ${share(errors, calls)} calls (${percent(errors / calls)})`]
        : [];
    };
    return [...checkSide("reference", own.old), ...checkSide("new", own.fresh)];
  });
  return firedIf(high.length > 0, "HIGH TOOL ERROR RATE", high.join("; "));
}

/** Lane 19: billing residual > 5% between local meter and backend totals, or open unpriced compactions. */
function billingTriggers(log: Index): Trigger[] {
  const line = costLine(log.events);
  const match = RESIDUAL_RE.exec(line);
  const pct = match === null ? 0 : Math.abs(Number(match[1]));
  const unpriced = unpricedCompactions(log.events, log.traces);
  const parts = [
    ...(pct > RESIDUAL_PCT ? [line] : []),
    ...(unpriced > 0 ? [`${plural(unpriced, "open compaction")} with 0 locally priced usage`] : []),
  ];
  return firedIf(parts.length > 0, "BILLING RESIDUAL", parts.join("; "));
}

/** All current-system triggers added in the WRI rewrite. */
export function signalTriggers(log: Index): Trigger[] {
  return [
    ...passLabelTriggers(log),
    ...deliverableTriggers(log),
    ...practiceSignalTriggers(log),
    ...exportTriggers(log),
    ...examinerSignalTriggers(log),
    ...continuityTriggers(log),
    ...underpoweredTriggers(log),
    ...toolErrorTriggers(log),
    ...billingTriggers(log),
  ];
}

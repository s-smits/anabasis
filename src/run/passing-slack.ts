/**
 * How much room each passing case of the latest admitted battery shipped with against its public
 * limits, read the way the solver's own margin table reads it.
 *
 * A battery that passes everything says nothing about how close it came, and a Builder choosing the
 * next battery otherwise has to guess whether its shipped answers cleared a published limit by a
 * hair or by half. The comparisons come from `publishedMargins` alone, which projects only what the
 * Builder declared public in the brief, and each one is evaluated by `readMargins` over the
 * solver's accepted artifact and the task's public input. No hidden expectation, verifier output,
 * reference artifact or failing case enters, so changing any of those leaves this text unchanged.
 *
 * It decides nothing. A comparison it cannot read says unknown, never zero, and a brief that no
 * longer matches the scoring program the battery recorded is not read at all, because its
 * comparisons would describe a different measurement.
 */
import { dirname, join } from "../meta/path.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { type EvidenceLogViolation, recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { scoringClosureHash } from "../claim/scoring-closure.ts";
import { type PublishedMargin, decimal, readMargins } from "../solve/published-margin.ts";
import { BATTERY_FILE, CASE_ARTIFACT_FILE } from "../truth/battery-record.ts";
import { publishedMargins } from "../truth/numeric-boundary.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { type AdmittedClimbRow, recordedPublicTasks, retainedRunDir } from "./climb-history.ts";
import { FRAME, fill } from "./climb-readout-frame.ts";

/** One declared comparison read on one shipped answer; a null operand or slack is unknown. */
type SlackReading = {
  label: string;
  direction: PublishedMargin["direction"];
  reported: number | null;
  limit: number | null;
  slack: number | null;
};

export type PassingSlack = {
  runId: string;
  passing: number;
  /** Why no case can be read, or null when the measured brief declares at least one comparison. */
  unknown: "noComparison" | "unbound" | null;
  /** Passing cases in evidence order; `readings` is null when the case cannot be vouched for, and
   *  empty when no declared comparison applies to its family. */
  cases: Array<{ taskId: string; readings: SlackReading[] | null }>;
};

/** Whole cases shown before the rest are counted, so a large battery keeps the line bounded. */
const SHOWN_CASES = 10;

/** The declared comparisons of the brief this battery was scored under; null when that brief cannot
 *  be read back or no longer matches the battery's recorded scoring program. */
function measuredMargins(runDir: string, violations: EvidenceLogViolation[]): PublishedMargin[] | null {
  const battery = recordedEvidence(runDir, BATTERY_FILE, violations);
  if (!battery.ok) return null;
  let recorded: unknown;
  try {
    const parsed = capturedJsonParse(battery.bytes);
    recorded = isRecord(parsed) && isRecord(parsed.bundleSnapshot) ? parsed.bundleSnapshot.scoringHash : null;
  } catch {
    return null;
  }
  const productDir = dirname(dirname(runDir));
  if (!isString(recorded) || scoringClosureHash(join(productDir, "correctness-model")) !== recorded) {
    return null;
  }
  const brief = readValidatedBrief(productDir);
  return brief === null ? null : publishedMargins(brief);
}

function caseReadings(
  runDir: string,
  taskId: string,
  margins: readonly PublishedMargin[],
  violations: EvidenceLogViolation[],
): SlackReading[] | null {
  const recorded = recordedPublicTasks(runDir, [taskId], violations);
  const artifact = recordedEvidence(runDir, `cases/${taskId}/${CASE_ARTIFACT_FILE}`, violations);
  const task = "tasks" in recorded ? recorded.tasks[0] : undefined;
  if (!isRecord(task) || !artifact.ok) return null;
  try {
    const family = isString(task.family) ? task.family : "";
    return readMargins(margins, family, task.publicInput, capturedJsonParse(artifact.bytes)).map(
      ({ label, direction, reported, limit, slack }) => ({ label, direction, reported, limit, slack }),
    );
  } catch {
    return null;
  }
}

/** The latest admitted battery's passing cases read against their declared public limits; null when
 *  it passed nothing, since only a passing case's shipped answer is published here. */
export function readPassingSlack(domainDir: string, row: AdmittedClimbRow | undefined): PassingSlack | null {
  const ids = row?.authoring.passedTaskIds ?? [];
  if (row === undefined || row.excludedReason !== null || ids.length === 0) return null;
  const base = { runId: row.battery.runId, passing: ids.length };
  const runDir = retainedRunDir(domainDir, row.battery.runId);
  const violations = runDir === null ? [] : verifyRunDir(runDir);
  const margins = runDir === null ? null : measuredMargins(runDir, violations);
  if (runDir === null || margins === null) return { ...base, unknown: "unbound", cases: [] };
  if (margins.length === 0) return { ...base, unknown: "noComparison", cases: [] };
  return {
    ...base,
    unknown: null,
    cases: ids.map((taskId) => ({ taskId, readings: caseReadings(runDir, taskId, margins, violations) })),
  };
}

function comparison(reading: SlackReading): string {
  const words = FRAME.passingSlack;
  const value = (number: number | null) => (number === null ? words.unknownValue : decimal(number));
  return fill(words.comparison, {
    label: reading.label,
    shipped: value(reading.reported),
    bound: reading.direction === "atMost" ? words.atMost : words.atLeast,
    limit: value(reading.limit),
    slack: reading.slack !== null && reading.slack > 0 ? `+${decimal(reading.slack)}` : value(reading.slack),
  });
}

/** The rendered summary, whole cases first and the rest counted; null when there is nothing to say. */
export function passingSlackLine(slack: PassingSlack | null): string | null {
  if (slack === null) return null;
  const words = FRAME.passingSlack;
  const { runId, passing } = slack;
  if (slack.unknown !== null) return fill(words.unknown, { runId, passing, reason: words[slack.unknown] });
  const shown = slack.cases.slice(0, SHOWN_CASES).map(({ taskId, readings }) => {
    if (readings === null) return fill(words.taskUnread, { taskId });
    if (readings.length === 0) return fill(words.taskNoComparison, { taskId });
    return fill(words.task, { taskId, comparisons: readings.map(comparison).join("; ") });
  });
  const rest = slack.cases.length - shown.length;
  const cases = [...shown, ...(rest > 0 ? [fill(words.more, { count: rest })] : [])].join(" ");
  return fill(words.read, { runId, passing, cases });
}

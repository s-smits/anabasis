import type { JsonValue } from "#src/meta/json-shape.ts";

import type { ReadCaseTrace } from "#src/claim/trace-read.ts";
// The folded trace facts are the outcome reader's own shape; this sidecar describes a script that
// prints what that reader produced, so it takes the type from its owner rather than restating it.
import type { FoldedTraceFacts } from "#tools/outcome/trace-facts.ts";

interface ToolUse {
  name: string;
  calls: number;
  errors: number;
  repeats: number;
  share: number | null;
}

interface SequenceUse {
  value: string;
  count: number;
}

interface TraceSummaryBase extends FoldedTraceFacts {
  /** `seen` against `recorded`: a case with no readable trace still counts in the battery. */
  cases: { seen: number; recorded: number };
  tools: ToolUse[];
  sequences: { distinct: number; frequencies: SequenceUse[] };
}

interface TraceSummary extends TraceSummaryBase {
  families: Record<string, TraceSummaryBase>;
}

interface PairedTaskSide {
  turns: number | null;
  toolCalls: number | null;
  sequence: string[];
  outcome: string;
}

interface PairedComparison {
  left: string;
  right: string;
  sharedRecordedTasks: number;
  turnsChanged: number;
  toolCallsChanged: number;
  sequencesChanged: number;
  outcomesChanged: number;
  rightMinusLeftTurns: number;
  rightMinusLeftToolCalls: number;
  taskDiffs: Array<{
    taskId: string;
    family: string;
    left: PairedTaskSide;
    right: PairedTaskSide;
  }>;
}

export function buildTraceTelemetry(
  records: Array<{
    runId: string;
    taskId: string;
    family: string;
    outcome: string;
    trace: ReadCaseTrace | null;
    /** The rest of the recorded case row, which this reader carries but never opens. */
    [key: string]: JsonValue | ReadCaseTrace | null;
  }>,
): {
  schema: "whole-run-trace-telemetry/v1";
  batteries: Record<string, TraceSummary>;
  paired: PairedComparison[];
};

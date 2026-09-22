import type { JsonObject } from "#src/meta/json-shape.ts";

export const DEFAULT_MAX_CHARS: number;

export { buildTraceTelemetry } from "./trace-telemetry.mjs";

export function renderTraceRecord(
  stored: { seq: number },
  row: {
    runId: string;
    taskId: string;
    family: string;
    acceptedSubmit: boolean;
    pass: boolean | null;
    runtimeNonResult: string | null;
    traces: Array<{ path: string; sha256: string }>;
  },
  read: {
    state: string;
    path: string | null;
    trace: {
      schema: string;
      turns: JsonObject[];
      toolCalls: JsonObject[];
      truncated: boolean;
      droppedRawEvents: number;
    } | null;
  },
  outcome: string,
): { seq: number; taskId: string; family: string; state: string; text: string };

export function selectLatestRecords(
  records: Array<{ seq: number; text: string }>,
  maxChars?: number,
): {
  records: Array<{ seq: number; text: string; selectedBytes: number; clipped: boolean }>;
  context: string;
  sourceBytes: number;
  selectedBytes: number;
  sourceChars: number;
  selectedChars: number;
  omittedRecords: number;
  truncated: boolean;
};

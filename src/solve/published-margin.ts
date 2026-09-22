/**
 * The published limits a prepared answer can be measured against before it is submitted.
 *
 * A truth check's `numericBoundary` names where a task's public input states a limit. With the
 * artifact path that reports the bounded value and the comparison's direction, the comparison is
 * public on both sides, so the harness evaluates it and tells the solver where its answer stands.
 *
 * It decides nothing: a missing or non-numeric operand reads as unknown, clearing every margin does
 * not make an answer correct, and a breach does not block submission. The verifier owns correctness.
 */
import { resolveJsonPath } from "../meta/json-evidence.ts";
import { type JsonObject, isNumber, isRecord } from "../meta/json-shape.ts";

export type MarginDirection = "atMost" | "atLeast";

/**
 * What an artifact-writer does, stated by the host that binds it: the authored description says
 * what the tool is for, this sentence says what runs. It names no count, so the registration is
 * identical across a battery.
 */
export const WRITER_BINDING_SENTENCE =
  "The host binds this tool: its parameters are the exact public artifact schema, a call records the " +
  "answer that would be submitted at the wall, and the result reports each published limit that " +
  "applies to your task beside the value your answer gives for it. Where the description above says " +
  "otherwise about what this tool runs or returns, this sentence is what runs.";

/** One published comparison, complete enough to evaluate with no hidden operand. */
export interface PublishedMargin {
  /** The `designRuleConstants` row naming this limit, which the solver already reads. */
  label: string;
  /** Where the submitted artifact reports the bounded value. */
  artifactPath: string;
  /** Where this task's public input states the limit. */
  publicInputPath: string;
  direction: MarginDirection;
  /** Families the owning check applies to, or null when it applies to every family. */
  families: readonly string[] | null;
}

interface MarginReading {
  label: string;
  artifactPath: string;
  direction: MarginDirection;
  reported: number | null;
  limit: number | null;
  /** How far inside its limit the reported value sits. Negative is a breach, null unreadable. */
  slack: number | null;
  breached: boolean;
}

function numberAt(root: JsonObject, path: string): number | null {
  const resolved = resolveJsonPath(root, path);
  return resolved.found && isNumber(resolved.value) ? resolved.value : null;
}

/** Every comparison that applies to this task's family, read against one prepared answer. */
export function readMargins(
  margins: readonly PublishedMargin[],
  family: string,
  publicInput: unknown,
  artifact: unknown,
): MarginReading[] {
  // A non-object holds no path, so its operands read as unknown rather than as a breach.
  const answer = isRecord(artifact) ? artifact : {};
  const task = isRecord(publicInput) ? publicInput : {};
  return margins.flatMap((margin) => {
    if (margin.families !== null && !margin.families.includes(family)) return [];
    const reported = numberAt(answer, margin.artifactPath);
    const limit = numberAt(task, margin.publicInputPath);
    const slack =
      reported === null || limit === null
        ? null
        : margin.direction === "atMost"
          ? limit - reported
          : reported - limit;
    return [
      {
        label: margin.label,
        artifactPath: margin.artifactPath,
        direction: margin.direction,
        reported,
        limit,
        slack,
        breached: slack !== null && slack < 0,
      },
    ];
  });
}

function decimal(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10)));
}

function marginLine(reading: MarginReading): string {
  const bound = reading.direction === "atMost" ? "at most" : "at least";
  if (reading.slack === null) {
    const missing =
      reading.reported === null
        ? `your answer reports nothing at ${reading.artifactPath}`
        : "this task states no limit";
    return `${reading.label}: not checked — ${missing}.`;
  }
  const share =
    reading.limit === 0
      ? ""
      : ` (${decimal((Math.abs(reading.slack) / Math.abs(reading.limit ?? 1)) * 100)}%)`;
  return reading.breached
    ? `${reading.label}: BREACHED. Reports ${decimal(reading.reported ?? 0)}, ${bound} ${decimal(reading.limit ?? 0)}; over by ${decimal(-reading.slack)}${share}.`
    : `${reading.label}: ${decimal(reading.reported ?? 0)}, ${bound} ${decimal(reading.limit ?? 0)}; ${decimal(reading.slack)} to spare${share}.`;
}

/** The margin table the solver reads; empty when no complete boundary applies. */
export function renderMargins(readings: readonly MarginReading[]): string {
  if (readings.length === 0) return "";
  const worst = readings.some((reading) => reading.breached)
    ? "\nThis answer is not yet sendable as it stands: a published limit it reports against is breached."
    : "";
  return `\n\nPublished limits, measured on the answer you just prepared:\n${readings.map((reading) => `- ${marginLine(reading)}`).join("\n")}${worst}`;
}

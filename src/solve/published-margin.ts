/**
 * The published limits a prepared answer can be measured against before it is submitted.
 *
 * A truth check may declare a `numericBoundary`: the public input path carrying a limit, and the
 * public `designRuleConstants` row naming its value. That says where the limit is but not what it
 * bounds, so nothing could evaluate it. Adding the artifact path the answer reports that value at,
 * and the direction of the comparison, completes it — and a complete comparison is public on both
 * sides, so the harness can run it and tell the solver where its own answer stands.
 *
 * This exists because the solver could not see it. On the round4-veryhard truss pack of 2026-09-17
 * (cycle c03, 2 verified of 23) 19 of 19 recorded answers breached a published limit by the numbers
 * they themselves reported, and were submitted anyway; the prompt had asked the solver to compare
 * each reported value with each published requirement itself, which is a duty a solver discharges
 * badly and the harness discharges exactly. Three prompt clauses asking for that comparison, and for
 * margin against it, were removed when this landed.
 *
 * It decides nothing. A comparison whose operand is missing or non-numeric reads as unknown rather
 * than as a breach, clearing every margin does not make an answer correct, and a breach does not
 * block submission: the verifier owns correctness, and a mis-declared boundary must not be able to
 * wedge a case. What this removes is the case where the answer's own published numbers already said
 * it fails and nobody read them.
 */
import { resolveJsonPath } from "../meta/json-evidence.ts";
import { type JsonObject, isNumber, isRecord } from "../meta/json-shape.ts";

export type MarginDirection = "atMost" | "atLeast";

/**
 * What an artifact-writer does, said by the host that does it.
 *
 * The host replaces an exact artifact-writer's parameters and execution: the parameters become the
 * public artifact schema, and the call records the answer and returns the margin table below. The
 * Builder can observe neither, and one truss writer's description ended "It runs no analysis and
 * checks nothing against the published limits" while the bound call was returning a table of exactly
 * that. The authored sentence stays, because it says what the tool is for in the domain's own words;
 * this one says what runs. It names no count, so every task in a battery serves the same text and
 * the registration stays stable across families.
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
  // Both sides are public JSON the caller has not narrowed. Anything that is not an object holds no
  // path at all, so it reads as an unreadable operand rather than as a breach.
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

/**
 * The margin table the solver reads, stated once here. Empty when the harness declared no complete
 * boundary, so a domain that publishes none carries no sentence about them either.
 */
export function renderMargins(readings: readonly MarginReading[]): string {
  if (readings.length === 0) return "";
  const worst = readings.some((reading) => reading.breached)
    ? "\nThis answer is not yet sendable as it stands: a published limit it reports against is breached."
    : "";
  return `\n\nPublished limits, measured on the answer you just prepared:\n${readings.map((reading) => `- ${marginLine(reading)}`).join("\n")}${worst}`;
}

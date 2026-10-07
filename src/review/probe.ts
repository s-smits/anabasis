/**
 * The Referee's one executing tool: run the task's checks over the answer under review and over a
 * copy with one field changed, and say which checks moved. Sed from harness-builder-v4 at 7af7315,
 * `src/review/review-probe.ts`: the budget, the value cap, the one-grammar path and its refusals,
 * the symmetric move and the conclusive rule are v1's, as is most of the tool's text.
 *
 * Departures:
 * - v1 probed an accept control the candidate published. A v2 Referee reviews one failing answer,
 *   so the probe starts from that answer and runs the run's own verifier, not a control census.
 * - Conclusive needs both sides to reach a verdict, pass or fail. v1 also needed the original to
 *   pass, which the answer under review never does.
 * - A refusal is a thrown error, pi's error result, where v1 returned "refused:" text.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { Task, Verdict, Verifier } from "../kernel/verify.ts";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedStructuredClone } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { text, tool } from "../solve/answer.ts";

/** review-probe.ts:57: each probe runs every applicable check, so eight keep a review from becoming
 *  a second battery. */
export const PROBE_BUDGET = 8;
/** review-probe.ts:59: a replacement value is one field, not a redesigned answer. */
const VALUE_MAX_CHARS = 400;

/** What one probe ran and what the checks said. */
export interface ProbeRow {
  /** 1-based, and what a ruling cites. */
  readonly id: number;
  readonly path: string;
  /** The JSON text of the substituted value, as the Referee wrote it. */
  readonly value: string;
  readonly original: Verdict;
  readonly changed: Verdict;
  /** Checks whose verdict the one changed field moved. */
  readonly moved: readonly string[];
}

/** review-probe.ts:95-100: both sides decided, so the comparison carries information. A check that
 *  throws or times out settles with no blocking checks, which reads exactly like "nothing moved". */
export function conclusive(row: ProbeRow): boolean {
  const decides = (verdict: Verdict) => verdict.kind === "pass" || verdict.kind === "fail";
  return decides(row.original) && decides(row.changed);
}

const blockingOf = (verdict: Verdict) => (verdict.kind === "fail" ? verdict.blocking : []);

/** review-probe.ts:197-203, symmetric: a check that stops refusing moved as much as one that starts. */
function movedChecks(original: Verdict, changed: Verdict): string[] {
  const before = new Set(blockingOf(original));
  const after = new Set(blockingOf(changed));
  return [...before.symmetricDifference(after)].sort();
}

/** review-probe.ts:159-185: a deep copy of `answer` with one existing leaf replaced, the path spelled
 *  as the checks spell theirs (`$.members[0].area`). Null when the path does not resolve, since a
 *  probe that adds a field answers "no check reads it" about a field the answer never carried. */
export function withReplacedField(answer: JsonValue, path: string, value: JsonValue): JsonValue | null {
  const keys = jsonPathTokens(path)?.map((token) =>
    token.startsWith("[") ? token.slice(1, -1) : token.slice(1),
  );
  const leaf = keys?.pop();
  if (keys === undefined || leaf === undefined || !resolveJsonPath(answer, path).found) return null;
  const copy: JsonValue = capturedStructuredClone(answer);
  // SAFETY: the path resolves in `answer`, so each step of its clone is an array or a record holding
  // the next key, and an array takes its position as a string key too.
  const parent = keys.reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], copy);
  (parent as Record<string, JsonValue>)[leaf] = value;
  return copy;
}

function sideText(label: string, verdict: Verdict): string {
  const detail =
    verdict.kind === "fail"
      ? verdict.blocking.length === 0
        ? ""
        : `, blocked by ${verdict.blocking.join(", ")}`
      : verdict.kind === "pass"
        ? ""
        : `: ${verdict.kind === "faulty" ? `${verdict.check} ${verdict.reason}` : verdict.reason}`;
  return `  ${label}: ${verdict.kind}${detail}`;
}

/** review-probe.ts:224-238. */
function rowText(row: ProbeRow): string {
  return [
    `probe ${String(row.id)}: ${row.path} replaced with ${row.value}`,
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? `  no check changed its verdict for this replacement. That alone does not show ${row.path} is unread: a check that reads it may simply decide the new value the same way`
      : `  ${String(row.moved.length)} check(s) moved: ${row.moved.join(", ")}`,
    ...(conclusive(row) ? [] : ["  inconclusive: a side reached no verdict, so this probe is not evidence"]),
  ].join("\n");
}

/** The probe tool over one answer; `rows` collects every probe that ran, in order. Probes run one at
 *  a time, as v1's did, so ids and the budget stay exact. */
export function probeTool(verify: Verifier, task: Task, answer: JsonValue, rows: ProbeRow[]): AgentTool {
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    label: "Probe the checks",
    description:
      "Run the task's checks over the answer under review and over a copy of it with a single field changed, and return which checks moved their verdict. Use it instead of arguing a check's behaviour from source: choose a replacement that the public rules decide one way, so a check reading that field would have to decide it that way too, and read what the checks actually did. No check moving is not by itself proof that nothing reads the field, since a check that reads it can decide the new value the same way. The path must already exist in the answer and the value must differ from the one it carries. Cite the probe numbers you relied on when you record your ruling.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "A rooted path to an existing leaf of the answer, spelled as the checks spell theirs: `$.layout.members[0].area`. Array positions are bracketed.",
      }),
      value: Type.String({
        description:
          'The replacement value as JSON text, e.g. `0.0001`, `"bolted"` or `null`. One field only.',
      }),
    }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      if (rows.length >= PROBE_BUDGET) {
        throw new Error(`a review runs at most ${String(PROBE_BUDGET)} probes`);
      }
      if (args.value.length > VALUE_MAX_CHARS) {
        throw new Error(
          `value must be at most ${String(VALUE_MAX_CHARS)} characters: a probe changes one field`,
        );
      }
      let value: JsonValue;
      try {
        value = capturedJsonParse(args.value);
      } catch {
        throw new Error("value must be JSON text; quote a string value");
      }
      const changed = withReplacedField(answer, args.path, value);
      if (changed === null) throw new Error(`${args.path} is not an existing field of the answer`);
      if (hashJsonValue(changed) === hashJsonValue(answer)) {
        throw new Error(`the answer already carries that value at ${args.path}`);
      }
      original ??= verify(task, answer);
      const [before, after] = [await original, await verify(task, changed)];
      const row = {
        id: rows.length + 1,
        path: args.path,
        value: args.value,
        original: before,
        changed: after,
        moved: movedChecks(before, after),
      };
      rows.push(row);
      return text(rowText(row));
    },
  });
}

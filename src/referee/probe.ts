/**
 * The Referee's counterfactual: compare the rejected answer with a copy after one list of changes.
 * Each replaces an existing field or parent, including a scalar root, or edits one text passage.
 * Coupled changes are one probe, with both complete answers checked once: the review of 20 October
 * found three unclear rulings that could not clear a check by changing one failing part alone
 * (buffer-fresh-opus:2829,4268; recode-pr169-sonnet:291). Parent replacement alone is insufficient
 * when coupled source fields together exceed the value cap. The eight-probe budget and 4000-character
 * cap per value or passage remain; a side without a verdict still supplies no evidence. The same
 * review found that whole-answer swaps could manufacture defect evidence: object and array roots
 * stay fixed, and a coupled probe has at most three paths that one refusing check reads together.
 */
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import type { Task, Verdict, Verifier } from "../kernel/verify.ts";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedStructuredClone } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../tools/answer.ts";

/** review-probe.ts:57: each probe runs every applicable check, so eight keep a review from becoming
 *  a second battery. */
const PROBE_BUDGET = 8;
/** Bound each replacement value and each half of a text edit, including within a coupled probe. */
const VALUE_MAX_CHARS = 4_000;

/** The one passage of a text field that `find` names, rewritten to `replace`. */
type ProbeEdit = {
  readonly find: string;
  readonly replace: string;
};

/** What one probe ran and what the checks said. */
export type ProbeRow = {
  /** 1-based, and what a ruling cites. */
  readonly id: number;
  readonly changes: readonly {
    readonly path: string;
    readonly value: string | null;
    readonly edit: ProbeEdit | null;
  }[];
  readonly original: Verdict;
  readonly changed: Verdict;
  /** Checks whose verdict the changes moved. */
  readonly moved: readonly string[];
};

/** review-probe.ts:95-100: both sides decided, so the comparison carries information. A check that
 *  throws or times out settles with no blocking checks, which reads exactly like "nothing moved". */
export function conclusive(row: ProbeRow): boolean {
  const decides = (verdict: Verdict) => verdict.kind === "pass" || verdict.kind === "fail";
  return decides(row.original) && decides(row.changed);
}

const blockingOf = (verdict: Verdict) => (verdict.kind === "fail" ? verdict.blocking : []);

/** A check receives declared paths alone. A change reaches one when it names the field, a child
 *  or its parent; malformed paths authorise nothing. */
export function reaches(path: string, declared: readonly string[]): boolean {
  const probed = jsonPathTokens(path);
  return (
    probed !== null &&
    declared.some((field) => {
      const tokens = jsonPathTokens(field);
      return (
        tokens !== null && probed.slice(0, tokens.length).every((token, index) => token === tokens[index])
      );
    })
  );
}

/** review-probe.ts:197-203, symmetric: a check that stops refusing moved as much as one that starts. */
function movedChecks(original: Verdict, changed: Verdict): string[] {
  const before = new Set(blockingOf(original));
  const after = new Set(blockingOf(changed));
  return [...before.symmetricDifference(after)].sort();
}

/** A copy with an existing field or parent replaced; `$` replaces a scalar answer alone. */
function withReplacedField(answer: JsonValue, path: string, value: JsonValue): JsonValue {
  const keys = jsonPathTokens(path)?.map((token) =>
    token.startsWith("[") ? token.slice(1, -1) : token.slice(1),
  );
  if (keys === undefined || !resolveJsonPath(answer, path).found) {
    throw new Error(`${path} is not an existing field of the answer`);
  }
  const leaf = keys.pop();
  if (leaf === undefined) {
    if (isRecord(answer) || Array.isArray(answer)) throw new Error("only a scalar root can be replaced");
    return capturedStructuredClone(value);
  }
  const copy: JsonValue = capturedStructuredClone(answer);
  // SAFETY: the path resolves in `answer`, so each step of its clone is an array or a record holding
  // the next key, and an array takes its position as a string key too.
  const parent = keys.reduce((at, key) => at[key] as JsonObject, copy as JsonObject);
  parent[leaf] = value;
  return copy;
}

/**
 * The text at `path` with the one passage `find` names rewritten to `replace`; null where the field
 * is not text holding `find` exactly once. Overlapping occurrences count, since `aa` in `aaa` names
 * two passages and editing either would be a guess. The text is sliced, not passed through
 * `String.replace`, which reads `$&` in a replacement as a pattern, and code is full of dollar signs.
 */
function editedPassage(answer: JsonValue, path: string, edit: ProbeEdit): string | null {
  const field = resolveJsonPath(answer, path).value;
  if (!isString(field)) return null;
  const at = field.indexOf(edit.find);
  return edit.find === "" || at === -1 || at !== field.lastIndexOf(edit.find)
    ? null
    : `${field.slice(0, at)}${edit.replace}${field.slice(at + edit.find.length)}`;
}

function sideText(label: string, verdict: Verdict): string {
  const detail =
    verdict.kind === "pass" || (verdict.kind === "fail" && verdict.blocking.length === 0)
      ? ""
      : verdict.kind === "fail"
        ? `, blocked by ${verdict.blocking.join(", ")}`
        : `: ${verdict.kind === "faulty" ? `${verdict.check} ${verdict.reason}` : verdict.reason}`;
  return `  ${label}: ${verdict.kind}${detail}`;
}

/** review-probe.ts:224-238. */
function rowText(row: ProbeRow): string {
  return [
    `probe ${String(row.id)}:`,
    ...row.changes.map(({ path, value, edit }) =>
      edit === null
        ? `  ${path} replaced with ${String(value)}`
        : `  ${path} edited, its one passage of ${String(edit.find.length)} characters rewritten as ${String(edit.replace.length)}`,
    ),
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? "  no check changed its verdict. That alone does not show the changed fields are unread: a check may decide the new values the same way"
      : `  ${plural(row.moved.length, "check")} moved: ${row.moved.join(", ")}`,
    ...(conclusive(row) ? [] : ["  inconclusive: a side reached no verdict, so this probe is not evidence"]),
  ].join("\n");
}

/** How much of the review's probe budget is spent. In two campaigns of 12 October every unclear
 *  ruling, 8 of 8, came after the eighth probe, while no message had named the budget: the ninth
 *  was refused unannounced. */
function budgetLine(used: number): string {
  const left = PROBE_BUDGET - used;
  return left === 0
    ? `  probe ${String(used)} of ${String(PROBE_BUDGET)}: none left, so record your ruling on the probes made`
    : `  probe ${String(used)} of ${String(PROBE_BUDGET)}: ${plural(left, "probe")} left`;
}

/**
 * The answer with the one change made. Throws, in words for the model that sent it, a change that
 * is not one: both forms or neither, a value that is not JSON, a path the answer does not hold, a
 * passage that is not there exactly once, or a change that changes nothing.
 */
function changedAnswer(answer: JsonValue, change: ProbeRow["changes"][number]): JsonValue {
  const { edit } = change;
  if ((change.value === null) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  if ([change.value, edit?.find, edit?.replace].some((part) => (part?.length ?? 0) > VALUE_MAX_CHARS)) {
    throw new Error(
      `a value and each half of an edit are at most ${String(VALUE_MAX_CHARS)} characters: one field or one passage changes`,
    );
  }
  let value: JsonValue;
  if (edit === null) {
    try {
      value = capturedJsonParse(change.value ?? "");
    } catch {
      throw new Error("value must be JSON text; quote a string value");
    }
  } else {
    const edited = editedPassage(answer, change.path, edit);
    if (edited === null) {
      throw new Error(`${change.path} is not a text field holding \`find\` exactly once`);
    }
    value = edited;
  }
  const changed = withReplacedField(answer, change.path, value);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error(`the answer already carries that value at ${change.path}`);
  }
  return changed;
}

/** Rebuild the exact counterfactual for verification and for the ruling's evidence test. */
export function probeAnswer(answer: JsonValue, changes: ProbeRow["changes"]): JsonValue {
  if (changes.length > 3) throw new Error("a probe changes at most 3 paths");
  const changed = changes.reduce(changedAnswer, answer);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error("the changes leave the answer unchanged");
  }
  return changed;
}

/** The probe tool over one answer; `rows` collects every probe that ran, in order. Probes run one at
 *  a time, as v1's did, so ids and the budget stay exact. */
export function probeTool(
  verify: Verifier,
  task: Task,
  answer: JsonValue,
  rows: ProbeRow[],
  readTogether: readonly (readonly string[])[] = [],
): SeatTool {
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    description: `Run the task's checks over the answer under review and a copy with at most three changes applied together. Choose changes the public rules decide, and read which checks moved. Each change replaces an existing field or its parent with \`value\`, or rewrites one text passage with \`find\` and \`replace\`. Coupled changes must all reach fields one refusing check reads together. Only a scalar root can be replaced. No check moving does not prove the fields are unread. Every path must exist, each change must change it, and the complete answer must change. A review runs at most ${String(PROBE_BUDGET)} probes; each result says how many are left. Cite the probe numbers when recording the ruling.`,
    parameters: Type.Object({
      changes: Type.Array(
        Type.Object({
          path: Type.String({
            description:
              "An existing field or its parent; `$` only where the answer is a scalar. Array positions are bracketed; a key holding a dot or slash is quoted: `$.files['src/main.cpp']`.",
          }),
          value: Type.Optional(
            Type.String({
              description:
                'The replacement value as JSON text, e.g. `0.0001`, `"high"` or `null`. One field only. Omit it when you send `find` and `replace`.',
            }),
          ),
          find: Type.Optional(
            Type.String({
              description:
                "Exact text inside the string field at `path`, occurring there exactly once; include enough of its surroundings to make it unique. Sent with `replace`, in place of `value`.",
            }),
          ),
          replace: Type.Optional(
            Type.String({ description: "The text that takes the place of `find`; empty deletes it." }),
          ),
        }),
        { minItems: 1, maxItems: 3 },
      ),
    }),
    executionMode: "sequential",
    execute: async (args, _api, context) => {
      if (rows.length >= PROBE_BUDGET) {
        throw new Error(`a review runs at most ${String(PROBE_BUDGET)} probes`);
      }
      const changes = args.changes.map(({ path, value, find, replace }) => ({
        path,
        value: value ?? null,
        edit: find === undefined || replace === undefined ? null : { find, replace },
      }));
      const changed = probeAnswer(answer, changes);
      if (
        changes.length > 1 &&
        !readTogether.some((fields) => changes.every(({ path }) => reaches(path, fields)))
      ) {
        throw new Error("coupled changes name paths one refusing check reads together, or their parents");
      }
      original ??= verify(task, answer, context.abortSignal);
      const [before, after] = [await original, await verify(task, changed, context.abortSignal)];
      const row = {
        id: rows.length + 1,
        changes,
        original: before,
        changed: after,
        moved: movedChecks(before, after),
      };
      rows.push(row);
      return text(`${rowText(row)}\n${budgetLine(rows.length)}`);
    },
  });
}

/**
 * The Referee's one executing tool: run the task's checks over the answer under review and over a
 * copy with one field changed, and say which checks moved. Sed from harness-builder-v4 at 7af7315,
 * `src/review/review-probe.ts`: the budget, the value cap, the one-grammar path and its refusals,
 * the symmetric move and the conclusive rule are v1's, as is most of the tool's text.
 *
 * A change is a whole replacement value, or an edit of one passage inside a text field (v1's
 * `editedPassage`, github.com/s-smits/anabasis at 3f93d06b, `src/review/review-probe.ts:264-282`).
 * When an answer is a source file, the field two readings of a rule disagree about is that whole
 * file, and the thing in dispute is one line of it: most of v1's firmware fails were valid code a
 * stand-in refused, which no whole-field replacement of bounded size can test.
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
/** review-probe.ts:87-90 at 3f93d06b: a replacement value is one field, not a redesigned answer, and
 *  each half of an edit is one passage. */
const VALUE_MAX_CHARS = 4_000;

/** One change to an answer, as a tool is sent it: a field replaced whole by `value`, JSON text, or
 *  one passage of a text field rewritten by `find` and `replace`. */
export interface Change {
  readonly path: string;
  readonly value?: string | undefined;
  readonly find?: string | undefined;
  readonly replace?: string | undefined;
}

/** The one passage of a text field that `find` names, rewritten to `replace`. */
export interface ProbeEdit {
  readonly find: string;
  readonly replace: string;
}

/** What one probe ran and what the checks said. */
export interface ProbeRow {
  /** 1-based, and what a ruling cites. */
  readonly id: number;
  readonly path: string;
  /** The JSON text of the substituted value, as the Referee wrote it; null for an edit. */
  readonly value: string | null;
  /** The passage edited inside the text field at `path`; null for a whole replacement. */
  readonly edit: ProbeEdit | null;
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

/**
 * The text at `path` with the one passage `find` names rewritten to `replace`; null where the field
 * is not text holding `find` exactly once. Overlapping occurrences count, since `aa` in `aaa` names
 * two passages and editing either would be a guess. The text is sliced, not passed through
 * `String.replace`, which reads `$&` in a replacement as a pattern, and code is full of dollar signs.
 */
export function editedPassage(answer: JsonValue, path: string, edit: ProbeEdit): string | null {
  const field = resolveJsonPath(answer, path).value;
  if (typeof field !== "string") return null;
  const at = field.indexOf(edit.find);
  return edit.find === "" || at === -1 || at !== field.lastIndexOf(edit.find)
    ? null
    : `${field.slice(0, at)}${edit.replace}${field.slice(at + edit.find.length)}`;
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
    // An edit is named by its size: the Referee wrote both halves, and the field around them can
    // run to thousands of characters (review-probe.ts:398-399).
    row.edit === null
      ? `probe ${String(row.id)}: ${row.path} replaced with ${String(row.value)}`
      : `probe ${String(row.id)}: ${row.path} edited, its one passage of ${String(row.edit.find.length)} characters rewritten as ${String(row.edit.replace.length)}`,
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? `  no check changed its verdict for this replacement. That alone does not show ${row.path} is unread: a check that reads it may simply decide the new value the same way`
      : `  ${String(row.moved.length)} check(s) moved: ${row.moved.join(", ")}`,
    ...(conclusive(row) ? [] : ["  inconclusive: a side reached no verdict, so this probe is not evidence"]),
  ].join("\n");
}

/**
 * The answer with the one change made. Throws, in words for the model that sent it, a change that
 * is not one: both forms or neither, a value that is not JSON, a path the answer does not hold, a
 * passage that is not there exactly once, or a change that changes nothing. A probe and a reject
 * control are both an answer with one fact moved, and this is what holds each to one.
 */
export function changedAnswer(answer: JsonValue, change: Change): JsonValue {
  const edit =
    change.find === undefined || change.replace === undefined
      ? null
      : { find: change.find, replace: change.replace };
  if ((change.value === undefined) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  if ([change.value, change.find, change.replace].some((part) => (part?.length ?? 0) > VALUE_MAX_CHARS)) {
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
  if (changed === null) throw new Error(`${change.path} is not an existing field of the answer`);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error(`the answer already carries that value at ${change.path}`);
  }
  return changed;
}

/** The probe tool over one answer; `rows` collects every probe that ran, in order. Probes run one at
 *  a time, as v1's did, so ids and the budget stay exact. */
export function probeTool(verify: Verifier, task: Task, answer: JsonValue, rows: ProbeRow[]): AgentTool {
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    label: "Probe the checks",
    description:
      "Run the task's checks over the answer under review and over a copy of it with a single field changed, and return which checks moved their verdict. Use it instead of arguing a check's behaviour from source: choose a change that the public rules decide one way, so a check reading that field would have to decide it that way too, and read what the checks actually did. Send `value` to replace the field whole, or `find` and `replace` to rewrite one passage inside a text field, which is how one line of a source file is changed. No check moving is not by itself proof that nothing reads the field, since a check that reads it can decide the new value the same way. The path must already exist in the answer and the change must change it. Cite the probe numbers you relied on when you record your ruling.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "A rooted path to an existing leaf of the answer, spelled as the checks spell theirs: `$.items[0].value`. Array positions are bracketed; a key holding a dot or a slash is quoted: `$.files['src/main.cpp']`.",
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
    executionMode: "sequential",
    execute: async (_id, args) => {
      if (rows.length >= PROBE_BUDGET) {
        throw new Error(`a review runs at most ${String(PROBE_BUDGET)} probes`);
      }
      const edit =
        args.find === undefined || args.replace === undefined
          ? null
          : { find: args.find, replace: args.replace };
      const changed = changedAnswer(answer, args);
      original ??= verify(task, answer);
      const [before, after] = [await original, await verify(task, changed)];
      const row = {
        id: rows.length + 1,
        path: args.path,
        value: args.value ?? null,
        edit,
        original: before,
        changed: after,
        moved: movedChecks(before, after),
      };
      rows.push(row);
      return text(rowText(row));
    },
  });
}

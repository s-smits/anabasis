/**
 * The Referee's answer probe: compare an answer with a copy after up to three field or file
 * changes, run through the sandboxed verifier. Shared by rejection adjudication (`probeTool`) and
 * adversarial draft audits (`probeExamplesTool`).
 */
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { type AnswerFile, textFiles } from "../kernel/answer-files.ts";
import { blockingOf, decides, faultyOf, type Task, type Verdict, type Verifier } from "../kernel/verify.ts";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../tools/answer.ts";

/** One passage rewrite inside a text field or file. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- type alias stays assignable to `JsonObject`
type ProbeEdit = {
  readonly find: string;
  readonly replace: string;
};

/** What one answer probe ran and what the checks said. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- type alias stays assignable to `JsonObject`
export type ProbeRow = {
  /** 1-based, and what a ruling cites. */
  readonly id: number;
  readonly changes: readonly {
    readonly path: string;
    readonly value: string | null;
    readonly edit: ProbeEdit | null;
  }[];
  /** Line and byte counts of each changed, added, or removed (`now: null`) file text. */
  readonly texts: readonly {
    readonly path: string;
    readonly was: { readonly lines: number; readonly bytes: number } | null;
    readonly now: { readonly lines: number; readonly bytes: number } | null;
  }[];
  readonly original: Verdict;
  readonly changed: Verdict;
  /** Checks whose verdict the changes moved. */
  readonly moved: readonly string[];
};

/** One draft-audit probe row: a `ProbeRow` tagged with the example task id probed. */
export type DraftProbeRow = ProbeRow & { readonly task: string };

interface RawChange {
  readonly path: string;
  readonly value?: string | undefined;
  readonly find?: string | undefined;
  readonly replace?: string | undefined;
}

type TextSize = NonNullable<ProbeRow["texts"][number]["now"]>;

/** Prefix for submitted deliverable file paths (`file:report.md`, `file:$`). */
export const FILE = "file:";

const PROBE_BUDGET = 8;
const VALUE_MAX_CHARS = 4000;

const CHANGE_SCHEMA = Type.Object({
  path: Type.String({
    description:
      "An existing field or its parent (`$` only for a scalar root). Bracket array indices and quote keys holding `.` or `/` (`$.files['src/main.cpp']`). Submitted text files use `file:<path>` (or `file:<archive>/<member>`); a new `file:<path>` with a JSON string `value` adds a text file, and `value: \"null\"` on an existing submitted `file:<path>` removes that deliverable file.",
  }),
  value: Type.Optional(
    Type.String({
      description: 'Replacement value as JSON text, e.g. `0.0001`, `"high"`, or `null`.',
    }),
  ),
  find: Type.Optional(
    Type.String({ description: "Exact text inside the string field at `path`, occurring once." }),
  ),
  replace: Type.Optional(
    Type.String({ description: "Replacement text for `find`; empty string deletes it." }),
  ),
});

/** True when both original and changed sides reached a pass or fail verdict. */
export function conclusive(row: ProbeRow): boolean {
  return decides(row.original) && decides(row.changed);
}

/** True when `path` reaches a field or file declared by a check. */
export function reaches(path: string, declared: readonly string[]): boolean {
  if (path.startsWith(FILE)) {
    return declared.some((field) => field === path || path.startsWith(`${field}/`) || field === `${FILE}$`);
  }
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

function movedChecks(original: Verdict, changed: Verdict): string[] {
  const before = new Set(blockingOf(original));
  const after = new Set(blockingOf(changed));
  return [...before.symmetricDifference(after)].toSorted();
}

/** Return a copy of `answer` with the existing field or parent at `path` replaced. */
export function withReplacedField(answer: JsonValue, path: string, value: JsonValue): JsonValue {
  const keys = jsonPathTokens(path)?.map((token) =>
    token.startsWith("[") ? token.slice(1, -1) : token.slice(1),
  );
  if (keys === undefined || !resolveJsonPath(answer, path).found) {
    throw new Error(`${path} is not an existing field of the answer`);
  }
  const leaf = keys.pop();
  if (leaf === undefined) {
    if (isRecord(answer) || Array.isArray(answer)) throw new Error("only a scalar root can be replaced");
    return structuredClone(value);
  }
  const copy: JsonValue = structuredClone(answer);
  // SAFETY: `resolveJsonPath` confirmed every intermediate container along `keys` exists in `answer`.
  const parent = keys.reduce((at, key) => at[key] as JsonObject, copy as JsonObject);
  parent[leaf] = value;
  return copy;
}

function editedPassage(field: JsonValue | undefined, edit: ProbeEdit): string | null {
  if (!isString(field)) return null;
  const at = field.indexOf(edit.find);
  return edit.find === "" || at === -1 || at !== field.lastIndexOf(edit.find)
    ? null
    : `${field.slice(0, at)}${edit.replace}${field.slice(at + edit.find.length)}`;
}

function sideText(label: string, verdict: Verdict): string {
  if (verdict.kind === "pass") {
    const measured = verdict.objective === undefined ? "" : ` (objective ${String(verdict.objective)})`;
    return `  ${label}: pass${measured}`;
  }
  if (verdict.kind === "fail") {
    const blocked = verdict.blocking.length === 0 ? "" : `, blocked by ${verdict.blocking.join(", ")}`;
    return `  ${label}: fail${blocked}`;
  }
  const fault = faultyOf(verdict);
  const detail = fault === null ? verdict.reason : `${fault.check} ${fault.reason}`;
  return `  ${label}: ${verdict.kind}: ${detail}`;
}

function rowText(row: ProbeRow): string {
  const held = ({ lines, bytes }: TextSize) => `${plural(lines, "line")} in ${plural(bytes, "byte")}`;
  return [
    `probe ${String(row.id)}:`,
    ...row.changes.map(({ path, value, edit }) => {
      if (edit !== null) {
        return `  ${path} edited, its one passage of ${String(edit.find.length)} characters rewritten as ${String(edit.replace.length)}`;
      }
      if (path.startsWith(FILE)) {
        return value?.trim() === "null" ? `  ${path} removed` : `  ${path} given a whole text`;
      }
      return `  ${path} replaced with ${String(value)}`;
    }),
    ...row.texts.map(({ path, was, now }) => {
      if (was === null) {
        return `  ${path} is a file the answer did not hold: the changed side adds it, ${held(now ?? { lines: 0, bytes: 0 })}`;
      }
      if (now === null) return `  ${path} held ${held(was)} in the answer and is removed on the changed side`;
      return `  ${path} held ${held(was)} in the answer and holds ${held(now)} on the changed side`;
    }),
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? "  no check changed its verdict. That alone does not show the changed fields are unread: a check may decide the new values the same way"
      : `  ${plural(row.moved.length, "check")} moved: ${row.moved.join(", ")}`,
    ...(conclusive(row) ? [] : ["  inconclusive: a side reached no verdict, so this probe is not evidence"]),
  ].join("\n");
}

function budgetLine(used: number, budget = PROBE_BUDGET): string {
  const left = budget - used;
  return left === 0
    ? `  probe ${String(used)} of ${String(budget)}: none left, so record your ruling on the probes made`
    : `  probe ${String(used)} of ${String(budget)}: ${plural(left, "probe")} left`;
}

/** Parse a JSON `value` or apply a `{ find, replace }` passage edit, enforcing `maxChars`. */
function parseChangeValue(
  current: JsonValue | undefined,
  change: ProbeRow["changes"][number],
  maxChars: number,
  target: "file" | "field",
): JsonValue {
  const { edit } = change;
  if ((change.value === null) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  const boundErr =
    target === "file"
      ? `${change.path} takes a JSON string \`value\` for its whole text, or a passage \`find\` names once with its \`replace\`, that changes it, each at most ${String(VALUE_MAX_CHARS)} characters or the file's length`
      : `a value and each half of an edit are at most ${String(VALUE_MAX_CHARS)} characters, or the length of the field they change as JSON, in this answer or the accepted one, where that is longer: one field or one passage changes`;
  if ([change.value, edit?.find, edit?.replace].some((part) => (part?.length ?? 0) > maxChars)) {
    throw new Error(boundErr);
  }
  if (edit === null) {
    try {
      const parsed = capturedJsonParse(change.value ?? "");
      if (target === "file" && !isString(parsed)) throw new Error(boundErr);
      return parsed;
    } catch {
      throw new Error(target === "file" ? boundErr : "value must be JSON text; quote a string value");
    }
  }
  const edited = editedPassage(current, edit);
  if (edited === null) {
    throw new Error(
      target === "file" ? boundErr : `${change.path} is not a text field holding \`find\` exactly once`,
    );
  }
  return edited;
}

function changedAnswer(
  answer: JsonValue,
  change: ProbeRow["changes"][number],
  accepted: JsonValue | undefined,
): JsonValue {
  const lengths = [answer, accepted].map((whole) => {
    const field = whole === undefined ? null : resolveJsonPath(whole, change.path);
    return field?.found === true ? (capturedJsonStringify(field.value)?.length ?? 0) : 0;
  });
  const value = parseChangeValue(
    resolveJsonPath(answer, change.path).value,
    change,
    Math.max(VALUE_MAX_CHARS, ...lengths),
    "field",
  );
  const changed = withReplacedField(answer, change.path, value);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error(`the answer already carries that value at ${change.path}`);
  }
  return changed;
}

function probeAnswer(
  answer: JsonValue,
  changes: ProbeRow["changes"],
  accepted: JsonValue | undefined,
): JsonValue {
  const changed = changes.reduce((at, change) => changedAnswer(at, change, accepted), answer);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error("the changes leave the answer unchanged");
  }
  return changed;
}

/** True when `path` (`file:...`) names `file` or an archive member inside it. */
export const inFile = (path: string, file: string): boolean =>
  path === `${FILE}${file}` || path.startsWith(`${FILE}${file}/`);

/** Map every text file and archive text member in `files` by its `file:` probe path. */
export function fileTexts(files: readonly AnswerFile[]): Map<string, string> {
  return new Map(
    files.flatMap(({ path, text: whole, entries = [] }) => [
      ...(whole === undefined ? [] : [[`${FILE}${path}`, whole] as const]),
      ...entries.map((member) => [`${FILE}${path}/${member.path}`, member.text] as const),
    ]),
  );
}

function changedFile(files: readonly AnswerFile[], change: ProbeRow["changes"][number]): AnswerFile[] {
  const at = files.findIndex(({ path }) => inFile(change.path, path));
  const file = files[at];
  const wholeFile = file !== undefined && change.path === `${FILE}${file.path}`;
  if (change.edit === null && change.value?.trim() === "null") {
    if (!wholeFile) {
      throw new Error(
        `${change.path} cannot be removed: \`value: "null"\` removes an existing submitted \`file:<path>\` deliverable`,
      );
    }
    return files.toSpliced(at, 1);
  }
  const was = fileTexts(files).get(change.path);
  const folder = files.some(({ path }) => `${FILE}${path}`.startsWith(`${change.path}/`));
  if (was === undefined && (file !== undefined || change.edit !== null || folder)) {
    throw new Error(
      `${change.path} is neither a text file the solve submitted nor a member of its archive; a path that is no submitted file's, lies under none and holds none adds a text file, by \`value\` alone`,
    );
  }
  const parsed = parseChangeValue(was, change, Math.max(VALUE_MAX_CHARS, was?.length ?? 0), "file");
  if (!isString(parsed) || parsed === was) {
    throw new Error(
      `${change.path} takes a JSON string \`value\` for its whole text, or a passage \`find\` names once with its \`replace\`, that changes it, each at most ${String(VALUE_MAX_CHARS)} characters or the file's length`,
    );
  }
  if (file === undefined || wholeFile) {
    try {
      const whole = textFiles([{ path: change.path.slice(FILE.length), text: parsed }]);
      return files.toSpliced(file === undefined ? files.length : at, 1, ...whole);
    } catch {
      throw new Error(`${change.path} is no path a solve can submit a file under`);
    }
  }
  const inside = change.path.slice(`${FILE}${file.path}/`.length);
  return files.with(at, {
    ...file,
    entries: (file.entries ?? []).map((each) =>
      each.path === inside ? { path: inside, text: parsed } : each,
    ),
  });
}

function sizeOf(held: string): TextSize {
  const lines = held === "" ? 0 : held.split("\n").length - (held.endsWith("\n") ? 1 : 0);
  return { lines, bytes: Buffer.byteLength(held) };
}

/** Shared probe execution for single-answer and multi-example probe tools. */
export async function executeProbe(given: {
  readonly used: number;
  readonly budget?: number;
  readonly verify: Verifier;
  readonly task: Task;
  readonly answer: JsonValue;
  readonly files: readonly AnswerFile[];
  readonly rawChanges: readonly RawChange[];
  readonly signal: AbortSignal | undefined;
  readonly original: () => Promise<Verdict>;
  readonly accepted?: JsonValue | undefined;
  readonly readTogether?: readonly (readonly string[])[] | undefined;
}): Promise<ProbeRow> {
  const {
    used,
    budget = PROBE_BUDGET,
    verify,
    task,
    answer,
    files,
    rawChanges,
    signal,
    original,
    accepted,
    readTogether,
  } = given;
  if (used >= budget) throw new Error(`a review runs at most ${String(budget)} probes`);
  const changes = rawChanges.map(({ path, value, find, replace }) => ({
    path,
    value: value ?? null,
    edit: find === undefined || replace === undefined ? null : { find, replace },
  }));
  if (changes.length > 3) throw new Error("a probe changes at most 3 paths");
  const onFiles = changes.filter(({ path }) => path.startsWith(FILE));
  const onAnswer = changes.filter((change) => !onFiles.includes(change));
  const changed =
    onFiles.length > 0 && onAnswer.length === 0 ? answer : probeAnswer(answer, onAnswer, accepted);
  const changedFiles = onFiles.reduce((at, change) => changedFile(at, change), files);
  if (onFiles.length > 0 && onAnswer.length === 0 && hashJsonValue(changedFiles) === hashJsonValue(files)) {
    throw new Error("the changes leave the files unchanged");
  }
  if (
    readTogether !== undefined &&
    changes.length > 1 &&
    !readTogether.some((fields) => changes.every(({ path }) => reaches(path, fields)))
  ) {
    throw new Error("coupled changes name paths one refusing check reads together, or their parents");
  }
  const before = await original();
  const after = await verify(task, changed, signal, changedFiles);
  const submitted = fileTexts(files);
  const updated = fileTexts(changedFiles);
  const filePaths = [...new Set(onFiles.map(({ path }) => path))];
  return {
    id: used + 1,
    changes,
    texts: filePaths.flatMap((path) => {
      const was = submitted.get(path);
      const now = updated.get(path);
      if (was === undefined && now === undefined) return [];
      return [
        {
          path,
          was: was === undefined ? null : sizeOf(was),
          now: now === undefined ? null : sizeOf(now),
        },
      ];
    }),
    original: before,
    changed: after,
    moved: movedChecks(before, after),
  };
}

/** Answer probe tool for adjudicating one rejected solve (`src/referee/referee.ts`). */
export function probeTool(
  verify: Verifier,
  task: Task,
  answer: JsonValue,
  rows: ProbeRow[],
  around: {
    readonly readTogether?: readonly (readonly string[])[];
    readonly accepted?: JsonValue | undefined;
    readonly files?: readonly AnswerFile[];
  } = {},
): SeatTool {
  const { readTogether = [], accepted, files = [] } = around;
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    description: `Run the task's checks over the answer under review and a copy with at most three changes applied together, and say which checks moved. Coupled changes must all reach fields one refusing check reads together. A review runs at most ${String(PROBE_BUDGET)} probes; each result says how many are left.`,
    parameters: Type.Object({ changes: Type.Array(CHANGE_SCHEMA, { minItems: 1, maxItems: 3 }) }),
    execute: async (args, _api, context) => {
      const row = await executeProbe({
        used: rows.length,
        verify,
        task,
        answer,
        files,
        rawChanges: args.changes,
        signal: context.abortSignal,
        original: () => (original ??= verify(task, answer, context.abortSignal, files)),
        accepted,
        readTogether,
      });
      rows.push(row);
      return text(`${rowText(row)}\n${budgetLine(rows.length)}`);
    },
  });
}

/** Multi-example answer probe tool for adversarial draft audits (`src/referee/referee.ts`). */
export function probeExamplesTool(
  verify: Verifier,
  examples: readonly {
    readonly task: Task;
    readonly answer: JsonValue;
    readonly files?: readonly AnswerFile[];
  }[],
  rows: DraftProbeRow[],
  budget = PROBE_BUDGET,
): SeatTool {
  const byId = new Map(examples.map((example) => [example.task.taskId, example]));
  const originals = new Map<string, Promise<Verdict>>();
  return tool({
    name: "probe_check",
    description: `Run a drafted example's checks over its accept control and a copy with up to three changes (fields or \`file:<path>\` deliverables) to test for vacuous passes, over-strict checks, or gameable objectives. At most ${String(budget)} probes across all examples.`,
    parameters: Type.Object({
      task: Type.String({
        description: `The example task id to probe (${examples.map(({ task }) => task.taskId).join(", ")}).`,
      }),
      changes: Type.Array(CHANGE_SCHEMA, { minItems: 1, maxItems: 3 }),
    }),
    execute: async (args, _api, context) => {
      const example = byId.get(args.task);
      if (example === undefined) {
        throw new Error(`unknown example task ${args.task}; choose one of ${[...byId.keys()].join(", ")}`);
      }
      const files = example.files ?? [];
      const row = await executeProbe({
        used: rows.length,
        budget,
        verify,
        task: example.task,
        answer: example.answer,
        files,
        rawChanges: args.changes,
        signal: context.abortSignal,
        original: () => {
          const cached =
            originals.get(args.task) ?? verify(example.task, example.answer, context.abortSignal, files);
          originals.set(args.task, cached);
          return cached;
        },
      });
      rows.push({ task: args.task, ...row });
      return text(`task ${args.task}\n${rowText(row)}\n${budgetLine(rows.length, budget)}`);
    },
  });
}

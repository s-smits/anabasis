/**
 * The Referee's answer probe: compare the rejected answer with a copy after one list of changes.
 * Each replaces an existing field or parent, including a scalar root, or edits one text passage.
 * Coupled changes are one answer probe, with both complete answers checked once, since some checks
 * cannot be cleared by changing one failing part alone. Parent replacement alone is insufficient
 * when coupled source fields together exceed the value cap. The eight-probe budget and the cap per
 * value or passage remain; a side without a verdict still supplies no evidence. Whole-answer swaps
 * could manufacture defect evidence, so object and array roots
 * stay fixed, and a coupled answer probe has at most three paths that one refusing check reads together.
 */
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { type AnswerFile, textFiles } from "../kernel/answer-files.ts";
import { blockingOf, decides, type Task, type Verdict, type Verifier } from "../kernel/verify.ts";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../tools/answer.ts";

/** How a probe and a ruling name a submitted file, and a check's declared files (`file:$` for all):
 *  a JSON path starts at `$`, so the two never meet. */
export const FILE = "file:";

/** review-probe.ts:57: each answer probe runs every applicable check, so eight keep a review from becoming
 *  a second exam. */
const PROBE_BUDGET = 8;
/** Bound each replacement value and each half of a text edit, including within a coupled probe, or
 *  the field's own length as JSON where that is longer: one field still changes, whatever its size.
 *  The field is read in the refused answer and in the accepted one the prompt offers, so that value
 *  always fits, since a bound of 4000 alone kept rulings from replacing a long field such as a
 *  members list, which left tasks out of comparisons. */
const VALUE_MAX_CHARS = 4000;

/** The one passage of a text field that `find` names, rewritten to `replace`. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to `JsonObject`, and an interface has no implicit index signature
type ProbeEdit = {
  readonly find: string;
  readonly replace: string;
};

/** What one answer probe ran and what the checks said. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to `JsonObject`, and an interface has no implicit index signature
export type ProbeRow = {
  /** 1-based, and what a ruling cites. */
  readonly id: number;
  readonly changes: readonly {
    readonly path: string;
    readonly value: string | null;
    readonly edit: ProbeEdit | null;
  }[];
  /** Each file text the changes replaced, edited or added, as a change names it, with what it held
   *  before, null where the answer held no file there, and after. The oldest rows have none. */
  readonly texts: readonly {
    readonly path: string;
    readonly was: { readonly lines: number; readonly bytes: number } | null;
    readonly now: { readonly lines: number; readonly bytes: number };
  }[];
  readonly original: Verdict;
  readonly changed: Verdict;
  /** Checks whose verdict the changes moved. */
  readonly moved: readonly string[];
};

/** How much text a file holds, as a row records it. */
type TextSize = ProbeRow["texts"][number]["now"];

/** review-probe.ts:95-100: both sides decided, so the comparison carries information. A check that
 *  throws or times out settles with no blocking checks, which reads exactly like "nothing moved". */
export function conclusive(row: ProbeRow): boolean {
  return decides(row.original) && decides(row.changed);
}

/** A check receives declared paths alone. A change reaches one when it names the field, a child
 *  or its parent, or a file the check is given or a member of it; malformed paths authorise nothing. */
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

/** review-probe.ts:197-203, symmetric: a check that stops refusing moved as much as one that starts. */
function movedChecks(original: Verdict, changed: Verdict): string[] {
  const before = new Set(blockingOf(original));
  const after = new Set(blockingOf(changed));
  return [...before.symmetricDifference(after)].toSorted();
}

/** A copy with an existing field or parent replaced; `$` replaces a scalar answer alone. */
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
function editedPassage(field: JsonValue | undefined, edit: ProbeEdit): string | null {
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

/** review-probe.ts:224-238. A file's new text is not echoed: its sizes say what the change kept. */
function rowText(row: ProbeRow): string {
  const held = ({ lines, bytes }: TextSize) => `${plural(lines, "line")} in ${plural(bytes, "byte")}`;
  return [
    `probe ${String(row.id)}:`,
    ...row.changes.map(({ path, value, edit }) => {
      if (edit !== null) {
        return `  ${path} edited, its one passage of ${String(edit.find.length)} characters rewritten as ${String(edit.replace.length)}`;
      }
      return path.startsWith(FILE)
        ? `  ${path} given a whole text`
        : `  ${path} replaced with ${String(value)}`;
    }),
    ...row.texts.map(({ path, was, now }) =>
      was === null
        ? `  ${path} is a file the answer did not hold: the changed side adds it, ${held(now)}`
        : `  ${path} held ${held(was)} in the answer and holds ${held(now)} on the changed side`,
    ),
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? "  no check changed its verdict. That alone does not show the changed fields are unread: a check may decide the new values the same way"
      : `  ${plural(row.moved.length, "check")} moved: ${row.moved.join(", ")}`,
    ...(conclusive(row) ? [] : ["  inconclusive: a side reached no verdict, so this probe is not evidence"]),
  ].join("\n");
}

/** How much of the review's probe budget is spent, since a reader never told the budget spends it
 *  and has its next probe refused unannounced. */
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
function changedAnswer(
  answer: JsonValue,
  change: ProbeRow["changes"][number],
  accepted: JsonValue | undefined,
): JsonValue {
  const { edit } = change;
  if ((change.value === null) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  const lengths = [answer, accepted].map((whole) => {
    const field = whole === undefined ? null : resolveJsonPath(whole, change.path);
    return field?.found === true ? (capturedJsonStringify(field.value)?.length ?? 0) : 0;
  });
  const most = Math.max(VALUE_MAX_CHARS, ...lengths);
  if ([change.value, edit?.find, edit?.replace].some((part) => (part?.length ?? 0) > most)) {
    throw new Error(
      `a value and each half of an edit are at most ${String(VALUE_MAX_CHARS)} characters, or the length of the field they change as JSON, in this answer or the accepted one, where that is longer: one field or one passage changes`,
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
    const edited = editedPassage(resolveJsonPath(answer, change.path).value, edit);
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

/** Rebuild the exact counterfactual a probe verifies. */
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

/** Whether `path`, as a probe names a file, is the submitted `file` or lies under it. `reaches`
 *  also takes `file:$`, which is every file to a check and locates none. */
export const inFile = (path: string, file: string): boolean =>
  path === `${FILE}${file}` || path.startsWith(`${FILE}${file}/`);

/** Every text among `files` by the path a probe, a ruling and a read name it with: a text file's,
 *  `file:report.md`, and each text member of an archive after its file,
 *  `file:book.xlsx/xl/sharedStrings.xml`. A file that is neither text nor an archive has none. */
export function fileTexts(files: readonly AnswerFile[]): Map<string, string> {
  return new Map(
    files.flatMap(({ path, text: whole, entries = [] }) => [
      ...(whole === undefined ? [] : [[`${FILE}${path}`, whole] as const]),
      ...entries.map((member) => [`${FILE}${path}/${member.path}`, member.text] as const),
    ]),
  );
}

/** The submitted files with one text file's passage rewritten, or its whole text replaced by a JSON
 *  string, under the bound a field's change takes. An archive's member is named after its file,
 *  `file:book.xlsx/xl/sharedStrings.xml`; the archive's bytes stay as submitted, so only a check that
 *  reads the members can move. A path that is no submitted file's, lies under none and is the folder
 *  of none names a file the answer lacks, which a `value` adds as a control's file is made
 *  (`textFiles`). The changed side is not held to the capture's count or bytes: a probe adds three
 *  texts at most, each within a value's bound. */
function changedFile(files: readonly AnswerFile[], change: ProbeRow["changes"][number]): AnswerFile[] {
  const at = files.findIndex(({ path }) => inFile(change.path, path));
  const { edit } = change;
  const file = files[at];
  const was = fileTexts(files).get(change.path);
  const folder = files.some(({ path }) => `${FILE}${path}`.startsWith(`${change.path}/`));
  if (was === undefined && (file !== undefined || edit !== null || folder)) {
    throw new Error(
      `${change.path} is neither a text file the solve submitted nor a member of its archive; a path that is no submitted file's, lies under none and holds none adds a text file, by \`value\` alone`,
    );
  }
  if ((change.value === null) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  let now: JsonValue | null = null;
  try {
    now = edit === null ? capturedJsonParse(change.value ?? "") : editedPassage(was, edit);
  } catch {
    /* Not JSON: refused below with the form a file's change takes. */
  }
  const most = Math.max(VALUE_MAX_CHARS, was?.length ?? 0);
  const parts = [edit === null ? now : null, edit?.find, edit?.replace];
  if (!isString(now) || now === was || parts.some((part) => isString(part) && part.length > most)) {
    throw new Error(
      `${change.path} takes a JSON string \`value\` for its whole text, or a passage \`find\` names once with its \`replace\`, that changes it, each at most ${String(VALUE_MAX_CHARS)} characters or the file's length`,
    );
  }
  if (file === undefined || change.path === `${FILE}${file.path}`) {
    try {
      const whole = textFiles([{ path: change.path.slice(FILE.length), text: now }]);
      return files.toSpliced(file === undefined ? files.length : at, 1, ...whole);
    } catch {
      throw new Error(`${change.path} is no path a solve can submit a file under`);
    }
  }
  const inside = change.path.slice(`${FILE}${file.path}/`.length);
  return files.with(at, {
    ...file,
    entries: (file.entries ?? []).map((each) => (each.path === inside ? { path: inside, text: now } : each)),
  });
}

/** The lines and bytes of `held`, a last line counted whether or not a newline ends it. */
function sizeOf(held: string): TextSize {
  const lines = held === "" ? 0 : held.split("\n").length - (held.endsWith("\n") ? 1 : 0);
  return { lines, bytes: Buffer.byteLength(held) };
}

/** The answer probe tool over one answer; `rows` collects every answer probe that ran, in order. Probes run one at
 *  a time, as v1's did, so ids and the budget stay exact. */
export function probeTool(
  verify: Verifier,
  task: Task,
  answer: JsonValue,
  rows: ProbeRow[],
  around: {
    /** The fields each refusing check reads together, which a coupled probe keeps to. */
    readonly readTogether?: readonly (readonly string[])[];
    /** The accepted answer the Referee's first message offers, whose values a probe may carry. */
    readonly accepted?: JsonValue | undefined;
    /** The files the solve submitted, which every probe gives the checks, changed where it names one. */
    readonly files?: readonly AnswerFile[];
  } = {},
): SeatTool {
  const { readTogether = [], accepted, files = [] } = around;
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    description: `Run the task's checks over the answer under review and a copy with at most three changes applied together, and say which checks moved. Each change replaces the field at \`path\` with \`value\`, or rewrites one text passage there with \`find\` and \`replace\`. Each must change its field and together they must change the answer; coupled changes must all reach fields one refusing check reads together. A review runs at most ${String(PROBE_BUDGET)} probes; each result says how many are left.`,
    parameters: Type.Object({
      changes: Type.Array(
        Type.Object({
          path: Type.String({
            description:
              "An existing field or its parent; `$` only where the answer is a scalar, since only a scalar root can be replaced. Array positions are bracketed; a key holding a dot or slash is quoted: `$.files['src/main.cpp']`. A submitted text file is `file:` and its path, `file:report.md`, changed by `find` and `replace` or by a JSON string `value` for its whole text; a member of a workbook or document is its file's path and its own, `file:model.xlsx/xl/sharedStrings.xml`, changed the same ways. A `file:` path that is no submitted file's, lies under none and holds none names a file the answer lacks, and a JSON string `value` adds it as a text file; a check that reads `file:$` reads every file.",
          }),
          value: Type.Optional(
            Type.String({
              description:
                'The replacement value as JSON text, e.g. `0.0001`, `"high"` or `null`. One field only.',
            }),
          ),
          find: Type.Optional(
            Type.String({
              description:
                "Exact text inside the string field at `path`, occurring there exactly once; include enough of its surroundings to make it unique.",
            }),
          ),
          replace: Type.Optional(
            Type.String({ description: "The text that takes the place of `find`; empty deletes it." }),
          ),
        }),
        { minItems: 1, maxItems: 3 },
      ),
    }),
    execute: async (args, _api, context) => {
      if (rows.length >= PROBE_BUDGET) {
        throw new Error(`a review runs at most ${String(PROBE_BUDGET)} probes`);
      }
      const changes = args.changes.map(({ path, value, find, replace }) => ({
        path,
        value: value ?? null,
        edit: find === undefined || replace === undefined ? null : { find, replace },
      }));
      if (changes.length > 3) throw new Error("a probe changes at most 3 paths");
      const onFiles = changes.filter(({ path }) => path.startsWith(FILE));
      const onAnswer = changes.filter((change) => !onFiles.includes(change));
      // A probe of files alone leaves the answer as it is; an empty one is refused as unchanged.
      const changed =
        onFiles.length > 0 && onAnswer.length === 0 ? answer : probeAnswer(answer, onAnswer, accepted);
      const changedFiles = onFiles.reduce((at, change) => changedFile(at, change), files);
      if (
        changes.length > 1 &&
        !readTogether.some((fields) => changes.every(({ path }) => reaches(path, fields)))
      ) {
        throw new Error("coupled changes name paths one refusing check reads together, or their parents");
      }
      original ??= verify(task, answer, context.abortSignal, files);
      const before = await original;
      const after = await verify(task, changed, context.abortSignal, changedFiles);
      const submitted = fileTexts(files);
      const row = {
        id: rows.length + 1,
        changes,
        texts: [...fileTexts(changedFiles)].flatMap(([path, now]) => {
          const was = submitted.get(path);
          return onFiles.some((change) => change.path === path)
            ? [{ path, was: was === undefined ? null : sizeOf(was), now: sizeOf(now) }]
            : [];
        }),
        original: before,
        changed: after,
        moved: movedChecks(before, after),
      };
      rows.push(row);
      return text(`${rowText(row)}\n${budgetLine(rows.length)}`);
    },
  });
}

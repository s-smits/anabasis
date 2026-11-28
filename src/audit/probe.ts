import { Type } from "typebox";
import type { AgentTool } from "../agent/session.ts";
import { type AnswerFile, DELIVERABLES, textFiles } from "../kernel/answer-files.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import {
  blockingOf,
  decides,
  faultyOf,
  formatScores,
  type Task,
  type Verdict,
  type Verifier,
} from "../kernel/verify.ts";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { storedZip, zipMembers } from "../meta/zip.ts";
import { text, tool } from "../tools/answer.ts";

// oxlint-disable-next-line typescript/consistent-type-definitions -- type alias stays assignable to `JsonObject`
type ProbeEdit = {
  readonly find: string;
  readonly replace: string;
};

// oxlint-disable-next-line typescript/consistent-type-definitions -- type alias stays assignable to `JsonObject`
export type ProbeRow = {
  readonly id: number;
  readonly changes: readonly {
    readonly path: string;
    readonly value: string | null;
    readonly edit: ProbeEdit | null;
  }[];
  readonly texts: readonly {
    readonly path: string;
    readonly was: { readonly lines: number; readonly bytes: number } | null;
    readonly now: { readonly lines: number; readonly bytes: number } | null;
  }[];
  readonly original: Verdict;
  readonly changed: Verdict;
  readonly moved: readonly string[];
};

export type DraftProbeRow = ProbeRow & { readonly task: string; readonly taskDigest?: string };

interface RawChange {
  readonly path: string;
  readonly value?: string | undefined;
  readonly find?: string | undefined;
  readonly replace?: string | undefined;
}

type TextSize = NonNullable<ProbeRow["texts"][number]["now"]>;

export const FILE = "file:";
const PROBE_BUDGET = 16;

const CHANGE_SCHEMA = Type.Object({
  path: Type.String({
    description:
      'Target path: `$` replaces the entire answer JSON; `$.field` or `$.arr[0]` targets an existing field; `file:<path>` (or `file:<archive>/<member>`) edits, adds, or removes (`value: "null"`) a deliverable file.',
  }),
  value: Type.Optional(
    Type.String({
      description: 'Replacement value as JSON text (e.g. `0.0001`, `"high"`, `null`, or a full JSON object).',
    }),
  ),
  find: Type.Optional(
    Type.String({ description: "Exact substring inside the string at `path`, occurring once." }),
  ),
  replace: Type.Optional(
    Type.String({ description: "Replacement text for `find`; empty string deletes it." }),
  ),
});

export function conclusive(row: ProbeRow): boolean {
  return decides(row.original) && decides(row.changed);
}

export function throwsIn(row: ProbeRow): string | null {
  return decides(row.original) ? (faultyOf(row.changed)?.check ?? null) : null;
}

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

export function withReplacedField(answer: JsonValue, path: string, value: JsonValue): JsonValue {
  const keys = jsonPathTokens(path)?.map((token) =>
    token.startsWith("[") ? token.slice(1, -1) : token.slice(1),
  );
  if (keys === undefined || !resolveJsonPath(answer, path).found) {
    throw new Error(`${path} is not an existing field of the answer`);
  }
  const leaf = keys.pop();
  if (leaf === undefined) return structuredClone(value);
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
    const items = verdict.scores === undefined ? "" : `: ${formatScores(verdict.scores)}`;
    const measured =
      verdict.objective === undefined ? "" : ` (objective ${String(verdict.objective)}${items})`;
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
  const size = ({ lines, bytes }: TextSize) => `${plural(lines, "line")}, ${plural(bytes, "byte")}`;
  return [
    `probe ${String(row.id)}:`,
    ...row.changes.map(({ path, value, edit }) => {
      if (edit !== null) {
        return `  ${path} edited (${String(edit.find.length)} chars -> ${String(edit.replace.length)} chars)`;
      }
      if (path.startsWith(FILE)) {
        return value?.trim() === "null" ? `  ${path} removed` : `  ${path} replaced`;
      }
      return `  ${path} replaced with ${String(value)}`;
    }),
    ...row.texts.map(({ path, was, now }) => {
      if (was === null) return `  ${path} added (${size(now ?? { lines: 0, bytes: 0 })})`;
      if (now === null) return `  ${path} removed (was ${size(was)})`;
      return `  ${path} changed (${size(was)} -> ${size(now)})`;
    }),
    sideText("original", row.original),
    sideText("changed", row.changed),
    row.moved.length === 0
      ? "  no check changed its verdict"
      : `  ${plural(row.moved.length, "check")} moved: ${row.moved.join(", ")}`,
    ...(conclusive(row)
      ? []
      : throwsIn(row) === null
        ? ["  inconclusive: one side reached no verdict"]
        : [`  changed answer made check ${String(throwsIn(row))} throw`]),
  ].join("\n");
}

function budgetLine(used: number, budget = PROBE_BUDGET): string {
  const left = budget - used;
  return left === 0
    ? `  probe ${String(used)} of ${String(budget)}: none left`
    : `  probe ${String(used)} of ${String(budget)}: ${plural(left, "probe")} left`;
}

function parseChangeValue(
  current: JsonValue | undefined,
  change: ProbeRow["changes"][number],
  target: "file" | "field",
): JsonValue {
  const { edit } = change;
  if ((change.value === null) === (edit === null)) {
    throw new Error("send either `value`, or `find` with `replace`");
  }
  if (edit === null) {
    try {
      const parsed = capturedJsonParse(change.value ?? "");
      if (target === "file" && !isString(parsed)) {
        throw new Error(`${change.path} requires a JSON string value`);
      }
      return parsed;
    } catch {
      throw new Error(
        target === "file"
          ? `${change.path} requires a JSON string value`
          : "value must be valid JSON text (quote strings)",
      );
    }
  }
  const edited = editedPassage(current, edit);
  if (edited === null) {
    throw new Error(`${change.path} is not a text ${target} containing \`find\` exactly once`);
  }
  return edited;
}

function changedAnswer(answer: JsonValue, change: ProbeRow["changes"][number]): JsonValue {
  const value = parseChangeValue(resolveJsonPath(answer, change.path).value, change, "field");
  const changed = withReplacedField(answer, change.path, value);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error(`the answer already carries that value at ${change.path}`);
  }
  return changed;
}

export function formedOnly(contract: Contract, verify: Verifier): Verifier {
  return async (task, answer, signal, files) =>
    answer !== undefined && answerFormatFault(contract.answerFormat, answer) !== null
      ? {
          kind: "non-result",
          reason: "the changed answer violates the contract answerFormat",
        }
      : verify(task, answer, signal, files);
}

function probeAnswer(answer: JsonValue, changes: ProbeRow["changes"]): JsonValue {
  const changed = changes.reduce((at, change) => changedAnswer(at, change), answer);
  if (hashJsonValue(changed) === hashJsonValue(answer)) {
    throw new Error("the changes leave the answer unchanged");
  }
  return changed;
}

export const inFile = (path: string, file: string): boolean =>
  path === `${FILE}${file}` || path.startsWith(`${FILE}${file}/`);

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
      throw new Error(`${change.path} cannot be removed: \`value: "null"\` removes an existing file:<path>`);
    }
    return files.toSpliced(at, 1);
  }
  const was = fileTexts(files).get(change.path);
  const folder = files.some(({ path }) => `${FILE}${path}`.startsWith(`${change.path}/`));
  if (was === undefined && (file !== undefined || change.edit !== null || folder)) {
    throw new Error(
      `${change.path} is neither a submitted text file nor an archive member; add a new text file with \`value\` alone`,
    );
  }
  const parsed = parseChangeValue(was, change, "file");
  if (!isString(parsed) || parsed === was) {
    throw new Error(`${change.path} requires a JSON string value or edit that changes the file`);
  }
  if (file === undefined || wholeFile) {
    try {
      const whole = textFiles([{ path: change.path.slice(FILE.length), text: parsed }]);
      return files.toSpliced(file === undefined ? files.length : at, 1, ...whole);
    } catch {
      throw new Error(`${change.path} is not a valid deliverable file path`);
    }
  }
  const inside = change.path.slice(`${FILE}${file.path}/`.length);
  const updatedEntries = (file.entries ?? []).map((each) =>
    each.path === inside ? { path: inside, text: parsed } : each,
  );
  const rawMembers = zipMembers(Buffer.from(file.base64, "base64"), DELIVERABLES.bytes).members;
  const rebuiltZip = storedZip(
    rawMembers.map(({ path, data }) => ({ path, text: path === inside ? parsed : data })),
  ).toString("base64");
  const { text: _staleText, ...rest } = file;
  return files.with(at, { ...rest, base64: rebuiltZip, entries: updatedEntries });
}

function sizeOf(content: string): TextSize {
  const lines = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return { lines, bytes: Buffer.byteLength(content) };
}

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
    readTogether,
  } = given;
  if (used >= budget) throw new Error(`at most ${String(budget)} probes per review`);
  const changes = rawChanges.map(({ path, value, find, replace }) => ({
    path,
    value: value ?? null,
    edit: find === undefined || replace === undefined ? null : { find, replace },
  }));
  const onFiles = changes.filter(({ path }) => path.startsWith(FILE));
  const onAnswer = changes.filter((change) => !onFiles.includes(change));
  const changed = onFiles.length > 0 && onAnswer.length === 0 ? answer : probeAnswer(answer, onAnswer);
  const changedFiles = onFiles.reduce((at, change) => changedFile(at, change), files);
  if (onFiles.length > 0 && onAnswer.length === 0 && hashJsonValue(changedFiles) === hashJsonValue(files)) {
    throw new Error("the changes leave the files unchanged");
  }
  if (
    readTogether !== undefined &&
    readTogether.length > 0 &&
    changes.length > 1 &&
    !readTogether.some((fields) => changes.every(({ path }) => reaches(path, fields)))
  ) {
    throw new Error("coupled changes must target fields read together by one refusing check");
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
): AgentTool {
  const { readTogether = [], files = [] } = around;
  let original: Promise<Verdict> | null = null;
  return tool({
    name: "probe_check",
    description: `Run the task's checks on the answer and a modified copy (whole answer via \`$\`, field paths, or \`file:<path>\` deliverables) and report which checks moved. Up to ${String(PROBE_BUDGET)} probes.`,
    parameters: Type.Object({ changes: Type.Array(CHANGE_SCHEMA, { minItems: 1 }) }),
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
        readTogether,
      });
      rows.push(row);
      return text(`${rowText(row)}\n${budgetLine(rows.length)}`);
    },
  });
}

export function taskContentDigest(task: Task): string {
  return hashJsonValue({ family: task.family, publicInput: task.publicInput, hidden: task.hidden });
}

export function probeExamplesTool(
  verify: Verifier,
  examples: readonly {
    readonly task: Task;
    readonly answer: JsonValue;
    readonly files?: readonly AnswerFile[];
  }[],
  rows: DraftProbeRow[],
  budget = PROBE_BUDGET,
): AgentTool {
  const byId = new Map(examples.map((example) => [example.task.taskId, example]));
  const originals = new Map<string, Promise<Verdict>>();
  return tool({
    name: "probe_check",
    description: `Run an example's checks on its accept control and a modified copy (whole answer via \`$\`, field paths, or \`file:<path>\` deliverables) to test for vacuous passes, over-strict checks, or gameable objectives. Up to ${String(budget)} probes.`,
    parameters: Type.Object({
      task: Type.String({
        description: `Example task id to probe (${examples.map(({ task }) => task.taskId).join(", ")}).`,
      }),
      changes: Type.Array(CHANGE_SCHEMA, { minItems: 1 }),
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
      rows.push({ task: args.task, taskDigest: taskContentDigest(example.task), ...row });
      return text(`task ${args.task}\n${rowText(row)}\n${budgetLine(rows.length, budget)}`);
    },
  });
}

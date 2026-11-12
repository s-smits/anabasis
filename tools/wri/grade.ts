/**
 * `wri.ts grade`: put answers to a campaign's own checker and print each verdict in one line, with
 * the command that repeats it. It writes nothing and logs nothing. It needs the pack and its tool
 * tree, and the Mac's verifier wall.
 *
 *   bun tools/wri/wri.ts grade --log <log> [--bundle <pack>] --task <taskId> --answer <file> [--set <path>=<json>]...
 *   bun tools/wri/wri.ts grade --log <log> [--bundle <pack>] --solve <id> [--set <path>=<json>]...
 *   bun tools/wri/wri.ts grade --log <log> [--bundle <pack>] --answers <dir>
 *
 * - `--answer` grades one file against `--task`.
 * - `--solve` grades the answer the log's last verdict of that solve holds (`verdictsOf`), against the
 *   task that verdict names, and prints the recorded verdict beside the new one, so a moved checker
 *   or tool tree shows as the two differing.
 * - `--set` replaces one existing field of that answer first, by a path as a probe names one
 *   (`$.items[2].limit`, or `items[2].limit`), with a JSON value. It refuses a path the answer does not hold and a value of
 *   another JSON type than the field's, so no field is added or retyped unseen, and prints each
 *   change back. Several `--set`s are one change, as a Referee's coupled probe is.
 * - `--answers` grades every `.json` file of a folder in name order, each against the task its name
 *   begins with (`<taskId>.json` or `<taskId>--<label>.json`), and prints the sha256 of the bytes it
 *   graded, so a lane's frozen digests can be set against what was graded.
 *
 * Between 3 and 10 November 16 of 18 lane 1 sessions pulled answers out of verdicts by hand, 4 wrote
 * their own one-field mutation, and 6 of 7 lane 4 sessions graded a corpus in a shell loop; the one
 * rounding defect three lanes of one investigation found was vetted plausible only, since no session
 * printed a repeatable grade of it.
 *
 * An answer outside a drafted exam's answer format is refused first, as `judge` refuses a solver's,
 * and no check reads it (`src/solver/run.ts`). The format is the draft's, which the campaign's
 * contract holds (`packOpened`, `tools/d2/campaign.ts`). Until 20 October grade put every answer to
 * the checks alone, and a lane of buffer-fresh-opus-forkedPR223_v0_5_4-r3's investigation, probing
 * through it, read the evaluator's leniency on keys the format refuses as a gap of the exam, where the
 * host refuses such an answer before any check: none of the campaign's 2,480 verdicts held a format
 * fault. A stored pack's format is read from its sweep, which grade is not given, so its answers are
 * put to the checks alone, and grade says so. A campaign over a stored pack names it with `--bundle`,
 * and its checks stand beside the log; a campaign that drafted its exam names none, and its exam is
 * read where the campaign staged it (`exams/<digest>/`, `tools/d2/exam.ts`). On 10 October t-10's
 * lane 1 was given `<campaign>/checks` for a drafted exam and stopped on ENOENT.
 */
import { draftOf } from "#src/examiner/draft.ts";
import { answerFormatFault } from "#src/kernel/contract.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { read } from "#src/kernel/log.ts";
import { verdictsOf } from "#src/kernel/solves.ts";
import { openVerifier, spelled, type Task } from "#src/kernel/verify.ts";
import { sha256 } from "#src/meta/digest.ts";
import { readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { resolveJsonPath } from "#src/meta/json-evidence.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { withReplacedField } from "#src/referee/probe.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { readPack } from "../m0/stored-sweep.ts";

interface GradeOptions {
  readonly log: string;
  readonly bundle: string | undefined;
  readonly task: string | undefined;
  readonly answer: string | undefined;
  readonly solve: string | undefined;
  readonly set: readonly string[];
  readonly answers: string | undefined;
}

/** Where an answer to grade came from, and what it was. */
interface Graded {
  readonly task: string;
  readonly answer: JsonValue;
  /** The file and its digest, for an answer of a folder. */
  readonly label: string | null;
  /** The verdict the log holds of it, for an answer read from a solve. */
  readonly recorded: string | null;
  readonly repeat: readonly string[];
}

const quoted = (word: string) => `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** The JSON type of a value, as `--set` holds a replacement to it. */
const typeOf = (value: JsonValue | undefined): string => {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (isString(value)) return "string";
  return isNumber(value) ? "number" : "boolean";
};

/** A value as a change prints it, cut at 80 characters with its length: a replaced field can be a
 *  recorded answer's whole text, and a lane's report is read outside the exam side. */
const clipped = (value: JsonValue | undefined) => {
  const said = String(capturedJsonStringify(value));
  return said.length > 80 ? `${said.slice(0, 80)}... (${String(said.length)} characters)` : said;
};

/**
 * `answer` with each `<path>=<json>` replaced, and one line a change; it throws where a path does
 * not resolve in the answer or a value would change the field's JSON type. A scalar answer's root
 * `$` can be replaced; an object or array root cannot, as a Referee's probe cannot.
 */
export function withSet(answer: JsonValue, sets: readonly string[]): { answer: JsonValue; said: string[] } {
  let changed = answer;
  const said = sets.map((each) => {
    const at = each.indexOf("=");
    const given = at === -1 ? each : each.slice(0, at);
    // A lane names a field as it reads it (`cohort.x`); a probe roots it (`$.cohort.x`).
    const path = given.startsWith("$") ? given : `$.${given}`;
    const held = resolveJsonPath(changed, path);
    if (at === -1 || !held.found) {
      throw new Error(
        `--set ${each}: ${path} is no field of the answer (an index goes in brackets: items[2].limit)`,
      );
    }
    let value: JsonValue;
    try {
      value = capturedJsonParse(each.slice(at + 1));
    } catch (error) {
      throw new Error(`--set ${each}: the value is not JSON (a string is quoted: '"text"')`, {
        cause: error,
      });
    }
    if (typeOf(value) !== typeOf(held.value)) {
      throw new Error(
        `--set ${each}: ${path} holds a ${typeOf(held.value)} and the value is a ${typeOf(value)}`,
      );
    }
    // The Referee's own replacement, so a lane's change and a probe's are one operation.
    changed = withReplacedField(changed, path, value);
    return `set ${path}: ${clipped(held.value)} -> ${clipped(value)}`;
  });
  return { answer: changed, said };
}

/** The answers to grade: one recorded or given, or every file of a folder. */
function answersOf(options: GradeOptions, events: ReturnType<typeof read>): Graded[] {
  const base = ["bun", "tools/wri/wri.ts", "grade", "--log", quoted(options.log)];
  const bundle = options.bundle === undefined ? [] : ["--bundle", quoted(options.bundle)];
  if (options.answers !== undefined) {
    const dir = options.answers;
    return readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .toSorted()
      .map((file) => {
        const bytes = readFileSync(join(dir, file), "utf8");
        return {
          task: file.slice(0, -".json".length).split("--")[0] ?? "",
          answer: capturedJsonParse(bytes),
          label: `${file}  ${sha256(bytes).slice(0, 8)}`,
          recorded: null,
          repeat: [...base, ...bundle, "--answers", quoted(dir)],
        };
      });
  }
  const sets = options.set.flatMap((each) => ["--set", quoted(each)]);
  if (options.solve !== undefined) {
    const wanted = options.solve;
    const verdict = [...verdictsOf(events).values()].find(
      ({ solve }) => solve === wanted || solve.endsWith(`-${wanted}`),
    );
    if (verdict === undefined) throw new Error(`the log holds no verdict of solve ${wanted}`);
    if (verdict.task === null || verdict.answer === undefined) {
      throw new Error(`solve ${verdict.solve}'s verdict names no task or holds no answer (${verdict.kind})`);
    }
    const held =
      verdict.checker === null
        ? `${verdict.kind}${verdict.fault === null ? "" : ` format: ${verdict.fault}`}`
        : spelled(verdict.checker);
    return [
      {
        task: verdict.task,
        answer: verdict.answer,
        label: null,
        recorded: held,
        repeat: [...base, ...bundle, "--solve", verdict.solve, ...sets],
      },
    ];
  }
  if (options.task === undefined || options.answer === undefined) {
    throw new Error("name --task and --answer, or --solve, or --answers");
  }
  return [
    {
      task: options.task,
      answer: capturedJsonParse(readFileSync(options.answer, "utf8")),
      label: null,
      recorded: null,
      repeat: [
        ...base,
        ...bundle,
        "--task",
        quoted(options.task),
        "--answer",
        quoted(options.answer),
        ...sets,
      ],
    },
  ];
}

export async function grade(options: GradeOptions): Promise<number> {
  const { log } = options;
  // The pack and the check program: the stored pack `--bundle` names, whose checks the campaign
  // staged beside its log, or the exam the log drafted, where the campaign staged it.
  const staged = options.bundle === undefined ? stagedExamOf(log) : null;
  if (options.bundle === undefined && staged === null) {
    throw new Error("name --bundle: the campaign drafted no exam of its own, so its pack is a stored one");
  }
  const { bundle, checks } = staged ?? { bundle: options.bundle ?? "", checks: join(dirname(log), "checks") };
  if (options.answers !== undefined && options.set.length > 0) {
    throw new Error("--set changes one answer, not a folder");
  }
  // The tasks an Examiner wrote are in the log and in no pack.
  const events = read(log);
  const tasks = new Map<string, Task>(
    [...writtenTasks(events), ...readPack(bundle).tasks].map((task) => [task.taskId, task]),
  );
  // The format first, as the host holds a solver's answer to it before any check reads it (`judge`).
  const answerFormat = draftOf(events)?.answerFormat;
  if (answerFormat === undefined) {
    console.error(
      "the answer format of a stored pack is read from its sweep, which grade is not given: not held to it",
    );
  }
  const verify = openVerifier({ checks, tools: join(bundle, ".toolchain"), packRoots: [bundle] });
  const judged = async (task: Task, answer: JsonValue) => {
    const fault = answerFormat === undefined ? null : answerFormatFault(answerFormat, answer);
    return fault === null ? spelled(await verify(task, answer)) : `fail format: ${fault}`;
  };
  const graded = answersOf(options, events);
  const many = options.answers !== undefined;
  for (const { task: taskId, answer, label, recorded } of graded) {
    const task = tasks.get(taskId);
    if (task === undefined) {
      if (!many) throw new Error(`neither the log nor the pack holds task ${taskId}`);
      console.log(`${label ?? ""}  ${taskId}  no such task in the log or the pack`);
      continue;
    }
    if (many) {
      console.log(`${label ?? ""}  ${taskId}  ${await judged(task, answer)}`);
      continue;
    }
    const { answer: changed, said } = withSet(answer, options.set);
    for (const line of said) console.log(line);
    const now = await judged(task, answer);
    // A plain grade prints its verdict alone; a regrade beside the recorded one; a change after both.
    const plain = recorded === null && said.length === 0 ? [now] : [];
    const lines = [
      ...plain,
      ...(recorded === null ? [] : [`recorded: ${recorded}`, `regraded: ${now}`]),
      ...(said.length === 0 ? [] : [`with the change: ${await judged(task, changed)}`]),
    ];
    console.log(lines.join("\n"));
  }
  console.log(`repeat: ${graded[0]?.repeat.join(" ") ?? "nothing to grade"}`);
  return 0;
}

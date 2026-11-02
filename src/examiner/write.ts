/**
 * The Examiner's task-writing mode: the agent that writes tasks, and the host that holds each one
 * out (`writing`, which `examine` seats, `session.ts`).
 *
 * The session is given the public contract, its checks by id and assertion, and every task the
 * campaign holds with its outcome so far (`record.ts`). Each instance it proposes is put to the
 * gate (`admitDraft`), which refuses one that carries an answer that passed `try_answer` whole
 * (`carries`) or whose package fails the shape check (`src/kernel/task.ts`), and holds out the
 * rest. No solver is put to a draft there, and no stronger solver passes a task first
 * (`AGENTS.md`, rule 9): when sessions put each instance to one, the first lost 14 of 25 tasks at
 * that solve and the second spent $48.45. Until 1 November `try_task` also put each draft to up to
 * three fresh solves by the reference harness and held it only where they left the reference
 * room. In the gate ablation on buffer of 31 October, one campaign an arm, the campaign without
 * them and the one with them each promoted on its first comparison, 8 to 0 and 10 to 0, on the
 * objective alone; the room solves admitted the same kind of task 1.1 hours later and for about
 * $24 of reference solves, and across the record since 16 October 5,664 of 6,225 of their readings
 * had the reference valid on every solve. Whether a task leaves the reference room is a
 * comparison's to read.
 *
 * An Examiner is a new process each session, so the host keeps what a session cannot: an instance
 * held or refused is not taken again, the session's home is carried into the next
 * (`Wall.keep`, `shell.ts`), and what a session said at its `finish` opens the next. An instance is
 * logged whole with its proposal, hidden values too, so a later solve needs the log alone; no tool
 * here returns a line of the log. An author's accepted answer is kept for the Referee
 * (`task.feasible`). read_example also serves the author's earlier drafts, so recovery needs no
 * carried shell file. Only admitted tasks count towards supply.
 * On 26 October, all 64 proposals in one campaign repeated input already sent to try_answer,
 * totalling 1,148,964 characters. A checked instance can now be proposed by its content reference,
 * with the same identity and gate as a full instance, for the rest of this session.
 */
import type { SeatTool } from "../agent/session.ts";
import { Type } from "typebox";
import { openingOf } from "../campaign/opening.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { acceptedAnswers, proposalsOf, writtenTasks } from "../kernel/history.ts";
import { poolOf } from "../kernel/reports.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { packageGate as checkPackage, type TaskPackage, taskSets, taskVersion } from "../kernel/task.ts";
import type { Task, Verdict, Verifier } from "../kernel/verify.ts";
import { capturedJsonStringify, decodedJsonText } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { type CheckRow, firstMessage, systemPrompt } from "./prompt.ts";
import type { Walls } from "./shell.ts";
import { heard, measuredGate as admissionSettled } from "./record.ts";

/** What a task-writing session is handed: who sits, as far as this mode reads it, and its campaign. */
interface Terms {
  /** Names the session in the log, and prefixes the ids of the tasks it writes. */
  readonly id: string;
  readonly log: string;
  /** `puts` is the instances the session may put to the gate. */
  readonly limits: { readonly wallSeconds: number; readonly turns: number; readonly puts: number };
  readonly contract: Contract;
  /** The checks as the Examiner is shown them. */
  readonly checks: readonly CheckRow[];
  /** The tasks the campaign holds, the pack's and the ones earlier sessions wrote. Each is listed
   *  at the opening with its outcome so far and counted (`record.ts`), and shown whole on request. */
  readonly tasks: readonly Task[];
  /** Held-out tasks at which the host has what it asked for and ends the session. The Examiner is
   *  never told the number. */
  readonly wanted: number;
  /** An instance as a package: the caller's rule ids and check program for it. */
  readonly pack: (task: Task) => TaskPackage;
  /** The budget every solve is held to, as a fact for the Examiner: the solver's own turns, null
   *  where unlimited, and the minutes. Null where the caller knows none, as a test may. */
  readonly budget: { readonly modelTurns: number | null; readonly minutes: number } | null;
  /** The campaign's verifier, for `try_answer`: the checks run on an instance with an answer of the
   *  Examiner's own. Null, the tool is not given. */
  readonly verify: Verifier | null;
  /** Called as the gate holds a task, so the campaign can release practice while the session writes
   *  (`releaseOwed`, `campaign-actions.ts`). */
  readonly held?: () => void;
}

/** What a task-writing session's tools share. */
interface Desk {
  readonly request: Terms;
  /** The session's signal, which its deadline, its end and a killed run abort. */
  readonly stop: AbortSignal;
  proposed: number;
  /** Content held or refused, in this or an earlier session. */
  readonly seen: Map<string, "now" | "earlier">;
  /** The last author answer that passed on each instance, kept only in session memory and
   *  rechecked on the final task before recording a known valid answer. */
  readonly answered: Map<string, JsonValue>;
  /** Checked content, kept once so a proposal can name it without sending its input again. */
  readonly checked: Map<string, Task>;
  /** Every answer that passed, by hash: a task that carries one whole is refused, since a planted
   *  answer is for `try_answer` and for no task (`carries`; `AGENTS.md`, rule 9). */
  readonly planted: Set<string>;
  readonly held: string[];
  readonly refused: string[];
}

/** The event a task admission writes of each draft (`admitDraft`). */
const TASK_ADMISSION = "task.gate";
/** What only the checks read of an instance, as each tool that takes one describes it. */
const HIDDEN = Type.Unknown({ description: "What only the checks receive; null when a task has none." });
const INSTANCE = Type.Object({
  family: Type.String({ minLength: 1 }),
  public_input: Type.Unknown({ description: "What the solver reads of the task." }),
  hidden: HIDDEN,
});
const REFERENCE = Type.Object({
  reference: Type.String({ description: "The instance reference returned by try_answer in this session." }),
});
/** A planted author's answer would reach the solver as task content. Accepted author answers
 *  stay on the exam side as `task.feasible`, for the Referee, rather than inside the task. */
const PLANTED =
  "it carries, whole, an answer that passed try_answer in this session: a planted answer is for try_answer alone, and no task holds one, in its public input or its hidden values";
const SUPPLIED = "The host has the tasks it needs. The session ends here.";
/** What a first `finish` is answered with while the host has not the tasks it needs: every live
 *  Examiner session of 9 and 10 October proposed one batch of one to three tasks in three turns
 *  and finished, of two hundred turns and twelve tasks it had, so a campaign paid a session's
 *  opening six times for what one session could have written. The need, and no count. */
const MORE =
  "Noted. The host would take more tasks from this session. A second finish with nothing proposed since ends it.";

/** Whether `value` holds, as itself or anywhere inside it, a value whose hash is in `planted`. */
function carries(value: JsonValue, planted: ReadonlySet<string>): boolean {
  if (planted.has(hashJsonValue(value))) return true;
  const inner = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  return inner.some((each) => carries(each, planted));
}

/** An instance by what a solver and the checks read of it, whatever id it carries. */
function contentOf({ family, publicInput, hidden }: Omit<Task, "taskId">): string {
  return hashJsonValue({ family, publicInput, hidden: hidden ?? null });
}

/** An instance as a tool's arguments carry it, under `taskId`. A hidden value sent as JSON text is
 *  the JSON it encodes, for a try as for a proposal: on 12 October tries sent "null" where their
 *  proposals sent null, and no valid answer was kept for a task. */
function instanceOf(
  taskId: string,
  given: { readonly family: string; readonly public_input: unknown; readonly hidden: unknown },
): Task {
  return {
    taskId,
    family: given.family,
    // SAFETY: a tool's arguments are JSON the provider parsed.
    publicInput: given.public_input as JsonValue,
    // SAFETY: as above.
    hidden: decodedJsonText((given.hidden ?? null) as JsonValue),
  };
}

/** What `task.feasible` keeps of the author's valid answer beside its version, where the contract
 *  declares an objective: the quantity, its direction and the verifier's measure of the answer,
 *  which `bettered` reads as the author's best. Empty where the contract declares none. */
function measureOf(contract: Contract, verdict: Verdict): JsonObject {
  const declared = contract.objective;
  if (declared === undefined || verdict.kind !== "pass" || verdict.objective === undefined) return {};
  const { quantity, direction } = declared;
  return { objective: { quantity, direction, measure: verdict.objective } };
}

/** A verdict as the Examiner reads it. */
function tried(verdict: Verdict): string {
  if (verdict.kind === "pass") {
    return "Every applicable check passed this answer: the instance has a valid answer.";
  }
  if (verdict.kind === "fail") {
    return `Refused by ${verdict.blocking.join(", ") || "no check: the answer was missing"}.`;
  }
  if (verdict.kind === "faulty") return `Check ${verdict.check} could not decide: ${verdict.reason}`;
  return `The checks could not run: ${verdict.reason}`;
}

/** Why the gate refuses a package, or null where it holds it out: an answer that passed
 *  try_answer in this session carried whole (`carries`), or the package's shape check. */
function refusalOf(contract: Contract, task: TaskPackage, planted: ReadonlySet<string>): string | null {
  if (carries([task.publicInput, task.hidden], planted)) return PLANTED;
  const packaged = checkPackage(contract, task);
  return packaged.outcome === "refused" ? packaged.reason : null;
}

/** One proposed instance and its reply. Once held, the author's last passing answer on its content
 *  is checked again under the task's own id and kept for the Referee where it still passes. */
async function admitDraft(desk: Desk, instance: Task): Promise<string> {
  const { request } = desk;
  const { log, id: session, verify } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(log, "task.proposed", { version, taskId, session, task: { taskId, family, publicInput, hidden } });
  const reason = refusalOf(request.contract, task, desk.planted);
  const answer = desk.answered.get(contentOf(instance));
  const outcome = reason === null ? { outcome: "passed" } : { outcome: "refused", reason };
  append(log, TASK_ADMISSION, { version, gate: 1, ...outcome, proved: answer !== undefined });
  if (reason !== null) {
    append(log, "task.state", { version, state: "refused", session });
    desk.refused.push(version);
    return `${taskId}: refused: ${reason}`;
  }
  desk.held.push(version);
  request.held?.();
  const held = `${taskId}: held out.`;
  if (verify === null || answer === undefined) return held;
  const verdict = await Promise.try(() => verify(instance, answer)).catch(
    (error: unknown): Verdict => ({ kind: "non-result", reason: errorMessage(error) }),
  );
  if (verdict.kind !== "pass") {
    return `${held} Author proof was not retained under this task id: ${tried(verdict)}`;
  }
  append(log, "task.feasible", { version, session, answer, ...measureOf(request.contract, verdict) });
  return held;
}

/** Whether the host has the tasks it asked for. */
const supplied = (desk: Desk): boolean => desk.held.length >= desk.request.wanted;

/** Whether the session has put every instance its limits allow. */
function spent(desk: Desk): boolean {
  return desk.proposed >= desk.request.limits.puts;
}

/** The tool that puts tasks to the gate. */
function proposeTool(desk: Desk): SeatTool {
  const { id, limits } = desk.request;
  /** One instance of a batch: why it was not taken, or the instance under its task id. */
  const taken = (instance: Omit<Task, "taskId">, stop: AbortSignal): string | Task => {
    const content = contentOf(instance);
    const before = desk.seen.get(content);
    if (before === "now") return "An instance proposed before was not taken again.";
    if (before === "earlier") return "An instance an earlier session wrote was not taken again.";
    if (spent(desk)) return "An instance was not taken: this session can propose no further task.";
    if (supplied(desk)) return `An instance was not taken. ${SUPPLIED}`;
    // Until 14 October an instance was still proposed after the deadline: recode-151's x-1 ended with
    // two batches of room solves killed so.
    if (stop.aborted) return "An instance was not taken: the session has ended.";
    desk.seen.set(content, "now");
    desk.proposed += 1;
    return { ...instance, taskId: `${id}-${String(desk.proposed).padStart(3, "0")}` };
  };
  return tool({
    name: "propose_tasks",
    description: "Put task instances to the host's gate, as the system prompt's section on the gate says.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Union([INSTANCE, REFERENCE], {
          description: "An instance in the shape of the existing tasks, or its checked reference.",
        }),
        { minItems: 1 },
      ),
    }),
    executionMode: "sequential",
    execute: async (args, _api, context) => {
      context.abortSignal?.throwIfAborted();
      const signal = desk.stop;
      if (supplied(desk)) throw new Error(SUPPLIED);
      if (spent(desk)) throw new Error("This session can propose no further task. Call finish.");
      // Take the call's instances before the gate reads them, so a batch may exceed what is wanted.
      const instances = args.tasks.map((given) => {
        if (!("reference" in given)) return taken(instanceOf("", given), signal);
        const checked = desk.checked.get(given.reference);
        return checked === undefined
          ? `Unknown instance reference ${given.reference}. Known references: ${desk.checked.size === 0 ? "none" : [...desk.checked.keys()].join(", ")}.`
          : taken(checked, signal);
      });
      // How many of its drafts the session has put: told the limit at the opening alone, esp32-fresh-opus-terra's
      // x-2 and x-3 met it unawares with a draft still unproposed (27 October).
      const used = `${String(desk.proposed)} of ${plural(limits.puts, "draft")} put to the gate in this session.`;
      const lines = await Promise.all(
        instances.map(async (instance) => (isString(instance) ? instance : admitDraft(desk, instance))),
      );
      const result = text(`${lines.join("\n")}\n${used}${supplied(desk) ? `\n\n${SUPPLIED}` : ""}`);
      return supplied(desk) ? ending(result) : result;
    },
  });
}

/** `read_example`, over the log as it stands at each call: until 28 October it served what stood at
 *  the session's start, and 31 calls asked in vain for a draft, most of them the session's own. */
function exampleTool(tasks: () => readonly Task[]): SeatTool {
  return tool({
    name: "read_example",
    description:
      "Return one task whole: its family, its public input and its hidden values. It serves the exam's tasks and every instance proposed in this campaign, this session's and those a gate refused among them.",
    parameters: Type.Object({
      task: Type.String({ description: "A task's or a draft's id." }),
    }),
    executionMode: "sequential",
    execute: async (args) => {
      const examples = new Map(tasks().map((task) => [task.taskId, task]));
      const example = examples.get(args.task);
      if (example === undefined) {
        throw new Error(`${args.task} is not one of the tasks: ${[...examples.keys()].join(", ")}`);
      }
      const { taskId, family, publicInput, hidden } = example;
      return text(capturedJsonStringify({ taskId, family, publicInput, hidden }, null, 2));
    },
  });
}

/** The checks run on one instance with an answer of the Examiner's: which refuse it, or that none
 *  does. Without it the Examiner wrote tasks it could not know to have a valid answer: on 10 October the
 *  notes of nine sessions said in eight that validity rested on hand estimates, and two of
 *  seven tasks of one session asked for more than their input allowed. Nothing of a try is kept
 *  but its trace and, where the checks pass on a task in the exam, the known valid answer.
 *  An instance the campaign already holds is checked under that task's own id, and a pass
 *  records a known valid answer where it is held out, in practice or disputed.
 *
 *  An answer is held to the format first, as a solver's is (`answerFormatFault`): one the checks
 *  passed though the format refused it would mark its instance as having a known valid answer on an answer no solver
 *  could submit (`poolOf`). */
function tryTool(desk: Desk, verify: Verifier): SeatTool {
  const { request } = desk;
  const { log, contract } = request;
  /** Puts on record that a held task has a valid answer, where the log does not say so yet or the
   *  answer carries a measure of the objective, which each such pass keeps (`measureOf`). */
  const recordValidAnswer = (
    events: readonly LogEvent[],
    version: string,
    verdict: Verdict,
    answer: JsonValue,
  ) => {
    const sets = taskSets(events);
    const inExam =
      sets.held.includes(version) ||
      sets.released.includes(version) ||
      sets.states.get(version) === "disputed";
    const measure = measureOf(contract, verdict);
    if (
      inExam &&
      (!poolOf(events).feasible.has(version) ||
        acceptedAnswers(events, version).length === 0 ||
        "objective" in measure)
    ) {
      append(log, "task.feasible", { version, session: request.id, answer, ...measure });
    }
  };
  return tool({
    name: "try_answer",
    description:
      "Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. Return an instance reference for proposing this checked content without resending it. A try enters no task in the exam. Where the checks pass, the host keeps the answer on the exam side for the Referee, for a task held with that content before or after the try. A refused task stays refused. The gate's reading of the instance's package comes first, where it would refuse it.",
    parameters: Type.Object({
      family: Type.String({ minLength: 1 }),
      public_input: Type.Unknown({ description: "What the solver would read of the task." }),
      hidden: HIDDEN,
      answer: Type.Unknown({ description: "An answer in the domain's answer format." }),
    }),
    executionMode: "sequential",
    execute: async (args, _api, context) => {
      const candidate = instanceOf("try", args);
      // SAFETY: a tool's arguments are JSON the provider parsed.
      const answer = args.answer as JsonValue;
      const events = read(log);
      const content = contentOf(candidate);
      const instance =
        [...writtenTasks(events), ...request.tasks].find((task) => contentOf(task) === content) ?? candidate;
      const packaged = checkPackage(contract, request.pack(instance));
      const admission =
        packaged.outcome === "passed" ? "" : `The gate would refuse this instance: ${packaged.reason}\n`;
      if (context.abortSignal?.aborted === true) throw new Error("The session has ended.");
      const unformed = answerFormatFault(contract.answerFormat, answer);
      if (unformed !== null) {
        return text(
          `${admission}This answer does not follow the answer format, so a solver's answer like it is refused before any check reads it, and no check was run: ${unformed}`,
        );
      }
      const verdict = await verify(instance, answer);
      desk.checked.set(content, instance);
      if (verdict.kind === "pass") {
        desk.answered.set(content, answer);
        desk.planted.add(hashJsonValue(answer));
        recordValidAnswer(events, taskVersion(request.pack(instance)), verdict, answer);
      }
      // The verifier's measure, kept with a held task's answer for the comparisons (`measureOf`).
      const { objective } = measureOf(contract, verdict);
      const measure =
        isRecord(objective) && isNumber(objective.measure)
          ? ` By the objective it measures ${String(Number(objective.measure.toPrecision(6)))}.`
          : "";
      return text(`${admission}${tried(verdict)}${measure}\nInstance reference: ${content}.`);
    },
  });
}

/**
 * The instances earlier sessions wrote that their gate read. One whose session was cut before its
 * gate wrote anything is no task of the campaign's, and may be proposed again, as may one an
 * earlier log's room solves refused unmeasured (`measuredGate`, `record.ts`).
 */
function admittedDrafts(events: readonly LogEvent[]): Task[] {
  const admissions = new Set(
    events.flatMap(({ kind, data }) =>
      kind === TASK_ADMISSION && admissionSettled(data) ? [data.version] : [],
    ),
  );
  return proposalsOf(events).flatMap(({ version, task }) =>
    task !== null && admissions.has(version) ? [task] : [],
  );
}

/**
 * The mode that writes tasks: the exam's own tools, `try_answer` where the host verifies, and the
 * system prompt that says whether a copy of the reference harness is in its home (`reference`),
 * which the wall lays there and leaves out of the home it keeps (`inExaminerWall`). Blind to it, esp32-fresh-opus's Examiner held 0 of 49
 * drafts under its first promoted reference; in the supply ablation of 19 October on the buffer
 * domain, 1 of 8 drafts held blind and 4 of 8 with the copy. The campaign command always lays it.
 */
export function writing(
  request: Terms,
  // The engines installed in its shell.
  walls: Pick<Walls, "pinned"> | undefined,
  reference: "unseen" | "in-home",
  stop = new AbortController().signal,
) {
  const { limits, verify, wanted } = request;
  const before = read(request.log);
  const desk: Desk = {
    request,
    stop,
    proposed: 0,
    seen: new Map(admittedDrafts(before).map((task) => [contentOf(task), "earlier"] as const)),
    answered: new Map(),
    checked: new Map(),
    planted: new Set(),
    held: [],
    refused: [],
  };
  // What the last Examiner session that finished under the reference harness said at its
  // `finish`, where one did. A note written under a reference since replaced is about the tasks
  // that one failed: main0_5_1's x-6 and buffer-159-opus's x-8 opened on one (16 October).
  const epoch = before.slice(before.findLastIndex(({ kind }) => kind === "harness.promoted") + 1);
  const note = epoch.findLast(({ kind, data }) => kind === "exam.finished" && isString(data.note))?.data.note;
  return {
    kind: "exam" as const,
    system: systemPrompt(reference),
    opening: firstMessage(request.contract, request.checks, heard(before, request.tasks), limits, {
      brief: openingOf(before)?.prompt ?? null,
      budget: request.budget,
      lastNote: isString(note) && note.trim() !== "" ? note : null,
    }),
    started: {
      limits: { wallSeconds: limits.wallSeconds, turns: limits.turns, proposals: limits.puts, tasks: wanted },
      checks: request.checks.map(({ id }) => id),
      examples: request.tasks.map(({ taskId }) => taskId),
      engines: (walls?.pinned ?? []).map(({ name, sha256 }) => ({ name, sha256 })),
      referenceHome: reference === "in-home",
    },
    tools: [
      proposeTool(desk),
      exampleTool(() => [...writtenTasks(read(request.log)), ...request.tasks]),
      ...(verify === null ? [] : [tryTool(desk, verify)]),
    ],
    enters: "a task enters it through propose_tasks alone",
    nudge: "Propose further tasks",
    finish:
      "End the session. Say in one or two sentences what kinds of task you wrote, which kinds the gate held and refused, and what you would try next.",
    // Until 30 October a session with no proposal left was still asked for more: 6 of 206
    // declined finishes came after the allowance was spent, 20 turns that could propose nothing.
    get declined() {
      return spent(desk) ? null : MORE;
    },
    done: (): "supplied" | null => (supplied(desk) ? "supplied" : null),
    counted: () => ({ proposed: desk.proposed, held: desk.held, refused: desk.refused }),
    result: () => ({ puts: desk.proposed, held: desk.held, refused: desk.refused }),
  };
}

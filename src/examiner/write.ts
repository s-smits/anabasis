/**
 * The Examiner's task-writing mode: the agent that writes tasks, and the host that holds each one
 * out (`writing`, which `examine` seats, `session.ts`).
 *
 * The session is given the domain's public contract, its checks by id and assertion, and every task
 * the campaign holds, each with its outcome so far and readable whole. It proposes instances, and
 * the host puts each to the task's one gate (`src/kernel/task.ts`): the shape of its package. An
 * instance that passes is a held-out task from then on, and every comparison may score it. The
 * Examiner is told that, or why the gate refused.
 *
 * No solve runs here unless the host can have the reference harness solve a draft task
 * (`try_task`): no stronger solver passes a task first, and the measured solver does not solve it
 * for its author (`docs/plan.md`, Phase 2). v1's solver matched whatever its author's side found,
 * and when sessions here did put each instance to a stronger solver, the first lost 14 of 25 tasks
 * at that solve and the second spent $48.45, of which the Examiner's own turns were $2.01. What a
 * task's author hears instead comes from the comparisons, one outcome a task with the tasks
 * counted by family or in a total beside them, at the next session's opening (`record.ts`).
 *
 * An Examiner is a new process each session, so the host keeps what a session cannot: an instance
 * an earlier session already wrote is not taken again, whatever id it would get; the home a
 * session computed in is carried whole into the next session's (`Wall.keep`, `shell.ts`), unless
 * it crashed, and what a session said at its `finish` opens the next. On 11 October two sessions
 * of one campaign each spent their first minutes fetching and compiling the same engine and
 * writing an optimiser around it.
 *
 * The session ends at `finish`, at its wall or its turns, or when the host has the tasks it was
 * asked for. An instance is logged whole with its proposal, hidden values too, so a later solve of
 * it needs the log and nothing beside it; no tool here returns a line of the log.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { affords, openingOf } from "../builder/opening.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { proposalsOf, writtenTasks } from "../kernel/history.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { poolOf } from "../kernel/reports.ts";
import { informative, type Paired } from "../kernel/compare.ts";
import type { Ending } from "../kernel/solve.ts";
import { packageGate, type TaskPackage, taskSets, taskVersion } from "../kernel/task.ts";
import type { Engine, Task, Verdict, Verifier } from "../kernel/verify.ts";
import { cpSync, existsSync, rmSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { capturedJsonStringify, decodedJsonText } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../solve/answer.ts";
import { type CheckRow, firstMessage, systemPrompt } from "./prompt.ts";
import { gateAnswers, gateBilled, heard, measuredGate, TRIED, UNAFFORDED } from "./record.ts";

/** The home's copy of the reference harness, where the campaign's term lays one there. */
const REFERENCE_HOME = "reference-harness";

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
  /** One fresh solve of a draft task by the reference harness, under the setting every solve of a
   *  comparison is held to, made at the asking of `session`: its start names the session, so no
   *  comparison counts it and no Builder is shown it (`pairsOf`, `practiceRan`). It is the solve
   *  launcher a comparison uses, called (`tools/d1b/examine.ts`). Given, a task is held out by
   *  `try_task` on `TRIED` such solves; null, by `propose_tasks` on its package's shape. */
  readonly probe: ((task: TaskPackage, session: string, kill: AbortSignal) => Promise<Ending>) | null;
}

/** What a task-writing session's tools share. */
interface Desk {
  readonly request: Terms;
  proposed: number;
  /** The instances this campaign has been given so far, by content, so that none is taken twice:
   *  this session's, and the ones earlier sessions wrote. */
  readonly seen: Map<string, "now" | "earlier">;
  /** The last author answer that passed on each instance, kept only in session memory and
   *  rechecked on the final task before recording proof. */
  readonly answered: Map<string, JsonValue>;
  /** Every answer that passed, by hash: a task that carries one whole is refused, since a planted
   *  answer is for `try_answer` and for no task (`carries`; `AGENTS.md`, rule 9). */
  readonly planted: Set<string>;
  readonly held: string[];
  readonly refused: string[];
  /** The gate's work still running under `try_task`, one promise an instance, and the lines it said
   *  of instances that the session has not been told yet (`heard`). */
  readonly pending: Set<Promise<void>>;
  readonly arrived: string[];
}

/** The most of an example one result shows. */
const SHOWN_CHARS = 20_000;
/** The event a gate writes of each draft (`gated`). */
const GATE = "task.gate";
/** The tool a task is held out by, as the Examiner is told it: on its package's shape, or on that
 *  and the reference harness's solves of it. */
const GATES = {
  propose_tasks: {
    label: "Propose tasks",
    description:
      "Put task instances to the host's gate, as the system prompt's section on the gate says. Each instance is a family, a public input and hidden values, in the shape of the existing tasks.",
  },
  try_task: {
    label: "Try tasks",
    description: `Put task instances to the host's gate and return at once: the shape of each package, then ${String(TRIED)} solves of it by the reference harness, as the system prompt's section on the gate says. What the gate says of each comes with a later tool result. Each instance is a family, a public input and hidden values, in the shape of the existing tasks.`,
  },
} as const;
/** What only the checks read of an instance, as each tool that takes one describes it. */
const HIDDEN = Type.Unknown({ description: "What only the checks receive; null when a task has none." });
/** Why the gate refuses a task that carries a planted answer: the witness serves the feasibility
 *  gate and is then discarded, so it never reaches a solver (the overhaul plan, S.4; rule 9). */
const PLANTED =
  "it carries, whole, an answer that passed try_answer in this session: a planted answer is for try_answer alone, and no task holds one, in its public input or its hidden values";
const SUPPLIED = "The host has the tasks it needs. The session ends here.";
/** What a first `finish` is answered with while the host has not the tasks it needs: every live
 *  Examiner session of 9 and 10 October proposed one batch of one to three tasks in three turns
 *  and finished, of two hundred turns and twelve tasks it had, so a campaign paid a session's
 *  opening six times for what one session could have written. The need, and no count. */
const MORE =
  "Noted, and the session goes on: the host does not yet have the tasks it needs from it. Propose further tasks, varying what they ask, and call finish again when you have none left worth proposing.";

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
 *  proposals sent null, and no proof of a task was kept. */
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
 *  declares an objective: the quantity and its direction as the contract states them, and the
 *  measure the verifier took of the answer (`OBJECTIVE`, `src/kernel/verify.ts`). The event
 *  stores no answer, which the Examiner's own trace alone keeps (`exam.call`), and until
 *  19 October it stored no measure either: 74 of 74 `try_answer`
 *  results of esp32-fresh-opus held none, so whether an author's answer beat the reference
 *  harness's best, which leaves a task the reference answers every time room to gain
 *  on (`informative`, `src/kernel/compare.ts`), could not be read off any record. Nothing reads it
 *  yet, and no seat is told it. Empty where the contract declares no objective. */
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

/** A measure as the Examiner reads it: six significant digits. */
function shown(measure: number): string {
  return String(Number(measure.toPrecision(6)));
}

/** What the gate reads of one package: its shape, and under `try_task` the reference harness's
 *  solves of a package whose shape passed, `TRIED` of them at once, with what they billed. The task
 *  is held out where the solves that gave a reading leave the reference room as a comparison reads
 *  it (`informative`): a valid answer and a fail, or valid answers apart by the objective; or no valid answer where its author's answer passes on it (`gated`). Until 16 October
 *  the gate read no objective, and of the drafts five fresh campaigns' gates refused as answered
 *  every time, 6 held valid answers more than 1% apart. A solve that ended in no reading, or in
 *  a rejection the Referee did not rule earned (`probing`, `tools/d1b/examine.ts`), is no reading,
 *  and leaves the draft unmeasured only where the readings left do not decide it: every one valid
 *  short of `TRIED`, or none. Until 15 October any such solve refused the draft unmeasured: 29 of
 *  the 174 drafts of four campaigns, 20 of them on readings that already held both a pass and a
 *  fail, or only fails beside a passing proof (main0_5_1 14, buffer-pr169-opus 5). The
 *  Examiner hears the counts; no answer and no trace of a solve reaches it. The session bounds them: `stop` is the session's own signal, which its wall, its end
 *  and a killed run abort, and it is the kill a comparison's solves take (`probe`), so a wall that
 *  fires mid-try leaves no solve running and the task refused unmeasured. `ahead` is the drafts of
 *  the same call measured beside this one (`proposeTool`). */
async function measured(
  desk: Desk,
  task: TaskPackage,
  stop: AbortSignal,
  { ahead, proof }: { readonly ahead: number; readonly proof: () => Promise<Verdict | null> },
) {
  const { contract, log, id, probe } = desk.request;
  if (carries([task.publicInput, task.hidden], desk.planted)) return { reason: PLANTED, said: "" };
  const packaged = packageGate(contract, task);
  if (packaged.outcome === "refused") return { reason: packaged.reason, said: "" };
  if (probe === null) return { reason: null, said: "" };
  // The three solves are held at the campaign's reserve before any starts, beside the solves in
  // flight (`affords`) and those of the call's drafts ahead of this one, which start with it and may
  // not be in flight yet: until 14 October nothing held them, and two reserves left started three.
  if (!affords(log, TRIED * (ahead + 1))) return { reason: UNAFFORDED, said: "" };
  const from = read(log).length - 1;
  const endings = await Promise.all(Array.from({ length: TRIED }, () => probe(task, id, stop)));
  const readings = endings.filter(({ outcome }) => outcome !== "non-result");
  const solves = readings.length;
  const valid = readings.filter(({ outcome }) => outcome === "pass").length;
  const unread =
    solves < TRIED
      ? `, ${String(TRIED - solves)} of them ending in no reading or in a rejection the Referee did not rule earned`
      : "";
  // The turns each valid answer took, as the session's later ones are told by family, and the
  // objective of each, by which a task the reference answers every time still leaves room.
  const answers = gateAnswers(read(log), from).get(taskVersion(task)) ?? [];
  // The author's proof is read only where it decides: every solve valid, or none (`gated`).
  const checked = valid === solves || valid === 0 ? await proof() : null;
  const authored =
    checked?.kind === "pass" && contract.objective !== undefined ? checked.objective : undefined;
  const took = answers.flatMap(({ turns: each }) => (each === null ? [] : [each]));
  const turns = took.length === 0 ? "" : `, taking ${took.join(", ")} of the solver's own turns`;
  // The measures by the objective, theirs and the author's, which decide room where every solve is
  // valid (`informative`): until 19 October the Examiner was told neither, and 181 of the 338
  // drafts five campaigns' gates refused as answered 3 of 3 with measures held answers apart by
  // less than the margin then in force, 0.01, none of which their author could see.
  const measures = answers.flatMap(({ measure }) => (measure === null ? [] : [shown(measure)]));
  const theirs = measures.length === 0 ? "" : `, its valid answers measuring ${measures.join(", ")}`;
  const yours =
    authored === undefined ? "" : `, and your answer that passed try_answer on it ${shown(authored)}`;
  const counted = `the reference harness answered it validly in ${String(valid)} of ${String(TRIED)} solves${turns}${theirs}${yours}${unread}`;
  const unmeasured = `${counted}, so it is not measured`;
  const unsolved = solves > 0 && valid === 0;
  // The rule itself is the system prompt's, said once there (17 October).
  const roomless = `${counted}, ${unsolved ? "and no answer of yours passed try_answer on it" : "which leaves no room"}`;
  // Room as a comparison reads it (`informative`), on the reference's side alone; a task it never
  // answers is held on its author's proof (`gated`), so no feasible task is named here.
  const objective = contract.objective && { direction: contract.objective.direction };
  const pair: Paired = {
    task: taskVersion(task),
    old: readings.map(({ outcome }) => outcome === "pass"),
    fresh: [],
    ...keyIfDefined(
      "objective",
      objective && { ...objective, old: answers.map(({ measure }) => measure), fresh: [] },
    ),
  };
  const bests = new Map(authored === undefined ? [] : [[pair.task, authored]]);
  const some = valid > 0 && informative(pair, "old", new Set(), bests);
  return {
    reason: some ? null : unsolved || solves === TRIED ? roomless : unmeasured,
    said: `; ${counted}`,
    reference: {
      valid,
      solves,
      billed: gateBilled(read(log), id, taskVersion(task)),
    },
    unsolved,
  };
}

/** The gate for one instance the Examiner proposed, and the line it is told (`measured`). Its gate
 *  says whether it came with a proof: an answer of its author's that passed the checks on its
 *  content before it was proposed (`proved`). The proof is put to the checks
 *  again under the task's own id, and the task is on record as feasible only where it passes there.
 *  A task the reference harness answered in none of its solves is held out where it passes so: a
 *  witness says a valid answer exists, which three failed solves do not say either way, and a task
 *  the reference never answers while a valid answer to it is on record is the room a promotion
 *  leaves (`informative`, `src/kernel/compare.ts`). Without a proof it is refused, as is a task the
 *  solves left unmeasured. Until 15 October every such task was held for a ladder, a fixed set read
 *  only after a promotion: in five campaigns of 14 October 31 of 120 drafts were, 47 were held out,
 *  and a promoted harness that answered every scored solve (buffer-149's 68 of 68, recode-151's 56
 *  of 56) was left only the drafts it answered some of the time. Until 16 October the first of
 *  every three still was, and the ladder was retired: its readings after a promotion found the new
 *  reference valid on 14 of 14 tasks and 5 of 6, the set already closed, for $33.06 and 5.9 hours
 *  in one campaign, while a third of these drafts were kept from the exam. Since 19 October one
 *  it answered validly in every solve is held where the proof is better by the objective than each
 *  of those answers, so the proof is read before the solves. */
async function gated(desk: Desk, instance: Task, stop: AbortSignal, ahead: number): Promise<string> {
  const { request } = desk;
  const { log, id: session, verify } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(log, "task.proposed", { version, taskId, session, task: { taskId, family, publicInput, hidden } });
  const answer = desk.answered.get(contentOf(instance));
  // The proof is read once: before the gate where the solves leave it to decide, a task the
  // reference never answered or answered alike in every solve (`measured`), else once it is held.
  let checked: Promise<Verdict | null> | undefined;
  const proof = () => {
    checked ??=
      verify === null || answer === undefined
        ? Promise.resolve(null)
        : Promise.try(() => verify(instance, answer)).catch(
            (error: unknown) => ({ kind: "non-result", reason: errorMessage(error) }) as const,
          );
    return checked;
  };
  const { reason, said, reference, unsolved } = await measured(desk, task, stop, { ahead, proof });
  const proved = unsolved === true && (await proof())?.kind === "pass";
  const outcome = reason === null || proved ? { outcome: "passed" } : { outcome: "refused", reason };
  append(log, GATE, {
    version,
    gate: 1,
    ...outcome,
    ...keyIfDefined("reference", reference),
    proved: answer !== undefined,
  });
  if (outcome.outcome === "refused") {
    append(log, "task.state", { version, state: "refused", session });
    desk.refused.push(version);
    return `${taskId}: refused: ${reason}`;
  }
  desk.held.push(version);
  const verdict = await proof();
  if (verdict === null) return `${taskId}: held out${said}.`;
  if (verdict.kind !== "pass") {
    return `${taskId}: held out${said}. Author proof was not retained under this task id: ${tried(verdict)}`;
  }
  append(log, "task.feasible", { version, session, ...measureOf(request.contract, verdict) });
  return `${taskId}: held out${said}.`;
}

/** Whether the host has the tasks it asked for. */
const supplied = (desk: Desk): boolean => desk.held.length >= desk.request.wanted;

/**
 * A `try_task` call's instances put to the gate without waiting on it: the line of each instance
 * not taken, and the ids of the ones whose solves now run while the session goes on. What the gate
 * says of each is told with the session's next tool result after it (`heard`), and `finish` and the
 * session's end wait for it (`settle`). Until 19 October a call waited on its slowest instance's
 * three solves: in the three Opus buffer campaigns of that day the first Examiner session spent
 * 56, 57 and 80 minutes of its 218, 112 and 215 on the gate's replies, putting a mean of 1.0, 3.9
 * and 1.5 instances a call, and the GPT ones 79 of 171 at 1.0. Until it had held enough tasks no
 * comparison could start, so its waits were the campaign's first hours.
 */
function putAside(
  desk: Desk,
  instances: readonly (string | Task)[],
  gate: (instance: Task) => Promise<string>,
) {
  const put = instances.flatMap((instance) => {
    if (isString(instance)) return [];
    const running = gate(instance)
      .catch((error: unknown) => `${instance.taskId}: the gate stopped on it: ${errorMessage(error)}`)
      .then((line) => {
        desk.arrived.push(line);
        desk.pending.delete(running);
      });
    desk.pending.add(running);
    return [instance.taskId];
  });
  const gating =
    put.length === 0
      ? []
      : [`${put.join(", ")}: put to the gate. What it says of each comes with a later tool result.`];
  return [...instances.filter(isString), ...gating].join("\n");
}

/** The tool that holds tasks out, under the name the session's gate has. */
function proposeTool(desk: Desk, name: keyof typeof GATES): AgentTool {
  const { id, limits } = desk.request;
  const spent = () => desk.proposed >= limits.puts;
  /** One instance of a batch: why it was not taken, or the instance under its task id. */
  const taken = (instance: Omit<Task, "taskId">, stop: AbortSignal): string | Task => {
    const content = contentOf(instance);
    const before = desk.seen.get(content);
    if (before === "now") return "An instance proposed before was not taken again.";
    if (before === "earlier") return "An instance an earlier session wrote was not taken again.";
    if (spent()) return "An instance was not taken: this session can propose no further task.";
    if (supplied(desk)) return `An instance was not taken. ${SUPPLIED}`;
    // Until 14 October an instance was still proposed after the wall, and its three solves started
    // on the spent signal to be killed at once: recode-151's x-1 ended with two batches killed so.
    if (stop.aborted) return "An instance was not taken: the session has ended.";
    desk.seen.set(content, "now");
    desk.proposed += 1;
    return { ...instance, taskId: `${id}-${String(desk.proposed).padStart(3, "0")}` };
  };
  return tool({
    name,
    ...GATES[name],
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          family: Type.String({ minLength: 1 }),
          public_input: Type.Unknown({ description: "What the solver reads of the task." }),
          hidden: HIDDEN,
        }),
        { minItems: 1 },
      ),
    }),
    executionMode: "sequential",
    // The session's signal, which its wall, its end and a killed run abort (`measured`).
    execute: async (_id, args, signal = new AbortController().signal) => {
      if (supplied(desk)) throw new Error(SUPPLIED);
      if (spent()) throw new Error("This session can propose no further task. Call finish.");
      // A call's instances are taken in order and then gated together. Until 17 October they were
      // gated one at a time, each waiting on the last one's three solves: the gate was 13.4 of
      // buffer-159-opus's 63.6 hours and 15.4 of recode-pr169-sonnet's 33.1, its Examiners putting
      // a mean of 1.0 to 1.6 instances a call. Being supplied is read before the call's gates, so a
      // call may hold out more than the host asked for.
      let ahead = 0;
      const instances = args.tasks.map((given) => taken(instanceOf("", given), signal));
      if (name === "try_task") {
        return text(putAside(desk, instances, (instance) => gated(desk, instance, signal, ahead++)));
      }
      const lines = await Promise.all(
        instances.map(async (instance) =>
          isString(instance) ? instance : await gated(desk, instance, signal, ahead++),
        ),
      );
      return {
        ...text(`${lines.join("\n")}${supplied(desk) ? `\n\n${SUPPLIED}` : ""}`),
        terminate: supplied(desk),
      };
    },
  });
}

function exampleTool(tasks: readonly Task[]): AgentTool {
  const examples = new Map(tasks.map((task) => [task.taskId, task]));
  return tool({
    name: "read_example",
    label: "Read an example",
    description: "Return one task of the exam whole: its family, its public input and its hidden values.",
    parameters: Type.Object({
      task: Type.String({ description: "A task's id, from the opening message." }),
    }),
    executionMode: "parallel",
    execute: async (_id, args) => {
      const example = examples.get(args.task);
      if (example === undefined) {
        throw new Error(`${args.task} is not one of the tasks: ${[...examples.keys()].join(", ")}`);
      }
      const { taskId, family, publicInput, hidden } = example;
      return text(
        capturedJsonStringify({ taskId, family, publicInput, hidden }, null, 2).slice(0, SHOWN_CHARS),
      );
    },
  });
}

/** The checks run on one instance with an answer of the Examiner's: which refuse it, or that none
 *  does. Without it the Examiner wrote tasks it could not know to be feasible: on 10 October the
 *  notes of nine sessions said in eight that feasibility rested on hand estimates, and two of
 *  seven tasks of one session asked for more than their input allowed. Nothing of a try is kept
 *  but its trace and, where the checks pass, that the instance has a valid answer: no task, no
 *  answer. An instance the campaign already holds is checked under that task's own id, and a pass
 *  proves the task where it is held out, in practice or disputed.
 *
 *  An answer is held to the format first, as a solver's is (`answerFormatFault`): one the checks
 *  passed though the format refused it would mark its instance feasible on an answer no solver
 *  could submit (`poolOf`). */
function tryTool(desk: Desk, verify: Verifier): AgentTool {
  const { request } = desk;
  const { log, contract } = request;
  /** Puts on record that a held task has a valid answer, where the log does not say so yet or the
   *  answer carries a measure of the objective, which each such pass keeps (`measureOf`). */
  const prove = (events: readonly LogEvent[], version: string, verdict: Verdict) => {
    const sets = taskSets(events);
    const inExam =
      sets.held.includes(version) ||
      sets.released.includes(version) ||
      sets.states.get(version) === "disputed";
    const measure = measureOf(contract, verdict);
    if (inExam && (!poolOf(events).feasible.has(version) || "objective" in measure)) {
      append(log, "task.feasible", { version, session: request.id, ...measure });
    }
  };
  return tool({
    name: "try_answer",
    label: "Try an answer",
    description:
      "Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. A try enters no task in the exam. Where the checks pass, the host records that the instance has a valid answer and holds the answer for this session alone, so a task proposed with that content, before or after the try, has its valid answer on record. The gate's reading of the instance's package comes first, where it would refuse it.",
    parameters: Type.Object({
      family: Type.String({ minLength: 1 }),
      public_input: Type.Unknown({ description: "What the solver would read of the task." }),
      hidden: HIDDEN,
      answer: Type.Unknown({ description: "An answer in the domain's answer format." }),
    }),
    executionMode: "parallel",
    execute: async (_id, args, signal) => {
      const candidate = instanceOf("try", args);
      // SAFETY: a tool's arguments are JSON the provider parsed.
      const answer = args.answer as JsonValue;
      const events = read(log);
      const content = contentOf(candidate);
      const instance =
        [...writtenTasks(events), ...request.tasks].find((task) => contentOf(task) === content) ?? candidate;
      const packaged = packageGate(contract, request.pack(instance));
      const gate =
        packaged.outcome === "passed" ? "" : `The gate would refuse this instance: ${packaged.reason}\n`;
      if (signal?.aborted === true) throw new Error("The session has ended.");
      const unformed = answerFormatFault(contract.answerFormat, answer);
      if (unformed !== null) {
        return text(
          `${gate}This answer does not follow the answer format, so a solver's answer like it is refused before any check reads it, and no check was run: ${unformed}`,
        );
      }
      const verdict = await verify(instance, answer);
      if (verdict.kind === "pass") {
        desk.answered.set(content, answer);
        desk.planted.add(hashJsonValue(answer));
        prove(events, taskVersion(request.pack(instance)), verdict);
      }
      // The verifier's measure, which the gate reads against the reference's (`measured`).
      const { objective } = measureOf(contract, verdict);
      const measure =
        isRecord(objective) && isNumber(objective.measure)
          ? ` By the objective it measures ${shown(objective.measure)}.`
          : "";
      return text(`${gate}${tried(verdict)}${measure}`);
    },
  });
}

/**
 * The instances earlier sessions wrote that were put to their gate and read by it. A session cut while a task was
 * being measured leaves its proposal with no gate on record, and until 13 October the next session
 * was told that instance was written already: it was neither held out nor refused, and could not
 * be proposed again (one such proposal in each of two campaigns on 12 October, each cut inside its
 * second session). Without a gate it is no task of the campaign's, so it may be proposed again,
 * and is gated then under the id it is given.
 */
function gatedTasks(events: readonly LogEvent[]): Task[] {
  const gates = new Set(
    events.flatMap(({ kind, data }) => (kind === GATE && measuredGate(data) ? [data.version] : [])),
  );
  return proposalsOf(events).flatMap(({ version, task }) =>
    task !== null && gates.has(version) ? [task] : [],
  );
}

/**
 * The mode that writes tasks: the exam's own tools, `try_answer` where the host verifies, the home
 * carried from the campaign's last session where the wall keeps one (`keep`), and in it a copy of
 * the reference harness where the wall names one (`reference`).
 *
 * The copy answers the supply after a promotion. Told each refused draft's outcome and the turns
 * its solves took, esp32-fresh-opus's Examiner held 0 of 49 drafts under its first promoted
 * reference, 44 of them answered in 3 of 3 solves, and wrote denser instances of what its programs
 * already answered (18 October): it never saw what the reference brings to a task. Seeing it
 * reverses the ruling of 12 October that the Examiner never sees the solver's tools, so it is the
 * operator's term. It was off unless named until the supply ablation of 19 October, one session an
 * arm on the buffer domain after its second promotion: 1 of 8 drafts held blind for $9.22, 4 of 8
 * with the copy for $14.41, $3.60 a held draft; on esp32, with no room left, none either way. It
 * is on unless a campaign names it off since, on the operator's word of that day. The copy
 * is the reference's alone, never a candidate's, laid afresh each session and left out of the
 * kept home.
 */
export function writing(
  request: Terms,
  pinned: readonly Engine[],
  keep: string | undefined,
  reference: string | undefined,
) {
  const { limits, verify, wanted } = request;
  const before = read(request.log);
  const desk: Desk = {
    request,
    proposed: 0,
    seen: new Map(gatedTasks(before).map((task) => [contentOf(task), "earlier"] as const)),
    answered: new Map(),
    planted: new Set(),
    held: [],
    refused: [],
    pending: new Set(),
    arrived: [],
  };
  // How a task is held out: on its package's shape, or on that and `TRIED` solves of the reference
  // harness where the host can have it solve one.
  const gate = request.probe === null ? "propose_tasks" : "try_task";
  const attempts = request.probe === null ? undefined : TRIED;
  // What the last Examiner session that finished under the reference harness said at its
  // `finish`, where one did. A note written under a reference since replaced is about the tasks
  // that one failed: main0_5_1's x-6 and buffer-159-opus's x-8 opened on one (16 October).
  const epoch = before.slice(before.findLastIndex(({ kind }) => kind === "harness.promoted") + 1);
  const note = epoch.findLast(({ kind, data }) => kind === "exam.finished" && isString(data.note))?.data.note;
  // The last session, where the provider failed its turn with no command running: its home is kept.
  const cut = before.findLast(({ kind }) => kind === "exam.finished")?.data;
  const kept = cut?.ended === "crashed" && cut.running === 0 && isString(cut.session) ? cut.session : null;
  return {
    kind: "exam" as const,
    system: systemPrompt(attempts, reference === undefined ? "unseen" : "in-home"),
    opening: firstMessage(request.contract, request.checks, heard(before, request.tasks), limits, {
      brief: openingOf(before)?.prompt ?? null,
      budget: request.budget,
      lastNote: isString(note) && note.trim() !== "" ? note : null,
    }),
    started: {
      limits: { wallSeconds: limits.wallSeconds, turns: limits.turns, proposals: limits.puts, tasks: wanted },
      checks: request.checks.map(({ id }) => id),
      examples: request.tasks.map(({ taskId }) => taskId),
      engines: pinned.map(({ name, sha256 }) => ({ name, sha256 })),
      ...keyIfDefined("tried", attempts),
      referenceHome: reference !== undefined,
    },
    tools: [
      proposeTool(desk, gate),
      exampleTool(request.tasks),
      ...(verify === null ? [] : [tryTool(desk, verify)]),
    ],
    enters: `a task enters it through ${gate} alone`,
    home:
      keep === undefined
        ? undefined
        : `${
            kept === null
              ? "holds what the last Examiner session of this campaign left in it, or nothing at the campaign's first"
              : `holds what Examiner session ${kept} of this campaign left in it when the provider failed one of its turns, before it finished`
          }${reference === undefined ? "" : `, and ${REFERENCE_HOME}/, a copy of the reference harness laid afresh for this session`}`,
    checked: undefined,
    nudge: "Propose further tasks",
    finish:
      "End the session. Say in one or two sentences what kinds of task you wrote and what you would try next.",
    declined: MORE,
    done: (): "supplied" | null => (supplied(desk) ? "supplied" : null),
    // What the gate said since the session was last told, and at a turn's last call how many
    // instances are still at it (`putAside`).
    heard: (last: boolean) => {
      const waiting =
        last && desk.pending.size > 0 ? `${plural(desk.pending.size, "instance")} still at the gate.` : "";
      return [...desk.arrived.splice(0), waiting].filter((line) => line !== "").join("\n");
    },
    settle: async () => {
      while (desk.pending.size > 0) await Promise.all(desk.pending);
    },
    counted: () => ({ proposed: desk.proposed, held: desk.held, refused: desk.refused }),
    result: () => ({ puts: desk.proposed, held: desk.held, refused: desk.refused }),
    // The next session's home is seeded with what the campaign keeps of the last one's.
    enter: (home: string) => {
      if (keep !== undefined && existsSync(keep)) cpSync(keep, home, { recursive: true });
      // A kept state names its programs by a link to the campaign's store, which the wall closes.
      if (reference !== undefined) {
        cpSync(reference, join(home, REFERENCE_HOME), { recursive: true, dereference: true });
      }
    },
    // The campaign's copy of a session's home, made whole when the session ends and replacing the
    // one before: it is the exam side's, under the campaign's folder beside the log, which every
    // wall closes. No link is followed, as the Builder's carry follows none. Not a session that
    // crashed with a command running, whose home is as no command left it. Until 12 October every
    // crashed session's home replaced the kept one, and on buffer the next session opened in the
    // working files of one whose turn the provider failed, under an earlier session's note; from
    // then until 14 October none did, and a crashed Examiner's work was lost to the provider. A
    // crash in a model request is now kept, and the next session is told whose home it is (`home`).
    leave: (home: string, ended: string, running: number) => {
      if (keep === undefined || (ended === "crashed" && running > 0)) return;
      rmSync(keep, { recursive: true, force: true });
      if (existsSync(home)) cpSync(home, keep, { recursive: true });
      // The copy is the session's own, so a session with the term off never opens on one.
      rmSync(join(keep, REFERENCE_HOME), { recursive: true, force: true });
    },
  };
}

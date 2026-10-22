/**
 * The Examiner's task-writing mode: the agent that writes tasks, and the host that holds each one
 * out (`writing`, which `examine` seats, `session.ts`).
 *
 * The session is given the public contract, its checks by id and assertion, and every task the
 * campaign holds with its outcome so far (`record.ts`). Each instance it proposes goes to the gate:
 * the shape of its package (`src/kernel/task.ts`) and, under `try_task`, fresh solves by the
 * reference harness, held out where they leave it room (`measured`). No stronger solver passes a
 * task first (`AGENTS.md`, rule 9): when sessions put each instance to one, the first lost 14 of 25
 * tasks at that solve and the second spent $48.45. Of the gate's solves the author hears counts,
 * turns and measures, and how far its own answer stands from their best, and nothing else.
 *
 * An Examiner is a new process each session, so the host keeps what a session cannot: an instance
 * held, measured or still at the gate is not taken again, the session's home is carried into the next
 * (`Wall.keep`, `shell.ts`), and what a session said at its `finish` opens the next. An instance is
 * logged whole with its proposal, hidden values too, so a later solve needs the log alone; no tool
 * here returns a line of the log. An author's accepted answer is kept for the Referee
 * (`task.feasible`).
 * On 21 October, 23 passing tries followed a proposal in 30 logs; the proof is read when needed.
 * Unmeasured drafts may return in the same session (5 retry signatures in 30 logs), and the
 * reserve holds the next solve alone (2 reserve refusals of 1,396 drafts).
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { affords, openingOf } from "../builder/opening.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { acceptedAnswers, proposalsOf, writtenTasks } from "../kernel/history.ts";
import { poolOf } from "../kernel/reports.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { gainOver, informative, type Paired } from "../kernel/compare.ts";
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
import { waitTool } from "../builder/tools.ts";
import { text, tool } from "../solve/answer.ts";
import { type CheckRow, firstMessage, systemPrompt } from "./prompt.ts";
import { gapSaid, gateAnswers, gateBilled, heard, measuredGate, TRIED, UNAFFORDED } from "./record.ts";

/** The home's copy of the reference harness, where the campaign's term lays one there. */
const REFERENCE_HOME = "reference-harness";

/** The author's current answer checked under the draft's own id when needed (`gated`). */
type Proof = () => Promise<Verdict | null>;

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
   *  `try_task` on up to `TRIED` such solves; null, by `propose_tasks` on its package's shape. */
  readonly probe: ((task: TaskPackage, session: string, kill: AbortSignal) => Promise<Ending>) | null;
  /** Whether each task's line says who won it in its last comparison (`exam-results`, `heard`);
   *  told unless a campaign names the term off. */
  readonly results?: boolean;
}

/** What the gate reads of one draft: the campaign's contract and log, the session that asks, the
 *  reference harness's solve, and the answers that passed `try_answer` in the session. */
type Gate = Pick<Terms, "contract" | "log" | "id" | "probe"> & { readonly planted: ReadonlySet<string> };

/** What a task-writing session's tools share. */
interface Desk {
  readonly request: Terms;
  proposed: number;
  /** Content held, refused on a reading or still at the gate, in this or an earlier session. */
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
    description: `Put task instances to the host's gate and return at once: the shape of each package, then up to ${String(TRIED)} solves of it by the reference harness, one at a time, as the system prompt's section on the gate says. What the gate says of each comes with a later tool result, and wait returns with it. Each instance is a family, a public input and hidden values, in the shape of the existing tasks.`,
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

/** A measure as the Examiner reads it: six significant digits. */
function shown(measure: number): string {
  return String(Number(measure.toPrecision(6)));
}

/** What the reference harness's readings of a draft so far show (`measured`): the counts, its
 *  valid answers with their turns and measures, its author's measure and how far that stands from
 *  their best (`gap`, by `gainOver`), and whether they leave the reference room as a comparison
 *  reads it (`informative`). Each later reading only adds to them, so room once shown stays. */
async function seenOf(
  { contract, log }: Gate,
  task: TaskPackage,
  {
    from,
    readings,
    proof,
  }: { readonly from: number; readonly readings: readonly Ending[]; readonly proof: Proof },
) {
  const solves = readings.length;
  const valid = readings.filter(({ outcome }) => outcome === "pass").length;
  const version = taskVersion(task);
  const answers = gateAnswers(read(log), from).get(version) ?? [];
  // The author's proof is read once the gate has a reading: it decides a task the reference never
  // answers, as a valid answer on record, and one it answers every time where it is better by the
  // floor than one of the reference's answers (`informative`). A draft the reference answers in
  // some solves is held anyway, and its proof read then, so its gap is told too.
  const checked = solves > 0 ? await proof() : null;
  const declared = contract.objective;
  const authored = checked?.kind === "pass" && declared !== undefined ? checked.objective : undefined;
  const pair: Paired = {
    task: version,
    old: readings.map(({ outcome }) => outcome === "pass"),
    fresh: [],
    ...keyIfDefined(
      "objective",
      declared && { direction: declared.direction, old: answers.map(({ measure }) => measure), fresh: [] },
    ),
  };
  // How the author's answer stands against the reference's best valid one: the worst of its gains.
  const gains = answers.flatMap(({ measure }) =>
    declared === undefined || authored === undefined ? [] : (gainOver(declared, authored, measure) ?? []),
  );
  const gap = gains.length === 0 ? undefined : Math.min(...gains);
  const unsolved = solves > 0 && valid === 0;
  const proved = new Set(unsolved && checked?.kind === "pass" ? [version] : []);
  const room = informative(pair, "old", proved, new Map(authored === undefined ? [] : [[version, authored]]));
  return { solves, valid, answers, authored, gap, unsolved, room };
}

/** What the gate reads of one package: its shape, and under `try_task` the reference harness's
 *  solves of a package whose shape passed, one at a time and at most `TRIED`. The draft is held at
 *  the first reading that leaves the reference room (`seenOf`): replayed, that decided 304 drafts of
 *  five campaigns as all three at once had, on 627 of 912 solves. A solve that ended in no reading,
 *  or in a rejection the Referee did not rule earned (`probing`, `tools/d1b/examine.ts`), is no
 *  reading. `stop` is the session's signal, which its wall, its end and a killed run abort, so a
 *  wall that fires mid-try starts no other solve and leaves the draft refused unmeasured. */
export async function measured(gate: Gate, task: TaskPackage, stop: AbortSignal, proof: Proof) {
  const { contract, log, id, probe } = gate;
  if (carries([task.publicInput, task.hidden], gate.planted)) return { reason: PLANTED, said: "" };
  const packaged = packageGate(contract, task);
  if (packaged.outcome === "refused") return { reason: packaged.reason, said: "" };
  if (probe === null) return { reason: null, said: "" };
  if (!affords(log, 1)) return { reason: UNAFFORDED, said: "" };
  const from = read(log).length - 1;
  const readings: Ending[] = [];
  let ran = 0;
  let seen: Awaited<ReturnType<typeof seenOf>>;
  do {
    const ending = await probe(task, id, stop);
    ran += 1;
    if (ending.outcome !== "non-result") readings.push(ending);
    seen = await seenOf(gate, task, { from, readings, proof });
  } while (!seen.room && ran < TRIED && !stop.aborted && affords(log, 1));
  const { solves, valid, answers, authored, gap, unsolved } = seen;
  const unread =
    solves < ran
      ? `, ${String(ran - solves)} of them ending in no reading or in a rejection the Referee did not rule earned`
      : "";
  // The turns each valid answer took, as the session's later ones are told by family.
  const took = answers.flatMap(({ turns: each }) => (each === null ? [] : [each]));
  const turns = took.length === 0 ? "" : `, taking ${took.join(", ")} of the solver's own turns`;
  // The measures by the objective, theirs and the author's, which decide room where every solve is
  // valid (`informative`).
  const measures = answers.flatMap(({ measure }) => (measure === null ? [] : [shown(measure)]));
  const theirs = measures.length === 0 ? "" : `, its valid answers measuring ${measures.join(", ")}`;
  const yours =
    authored === undefined
      ? ""
      : `, and your answer that passed try_answer on it ${shown(authored)}${gap === undefined ? "" : `, ${gapSaid(gap)}`}`;
  const counted = `the reference harness answered it validly in ${String(valid)} of ${String(ran)} solves${turns}${theirs}${yours}${unread}`;
  // The rule itself is the system prompt's, said once there.
  const roomless = `${counted}, ${unsolved ? "and no answer of yours passed try_answer on it" : "which leaves no room"}`;
  return {
    reason: seen.room ? null : solves === TRIED ? roomless : `${counted}, so it is not measured`,
    said: counted,
    reference: {
      valid,
      solves,
      ran,
      billed: gateBilled(read(log), id, taskVersion(task)),
      ...keyIfDefined("gap", gap),
    },
  };
}

/** One proposed instance and its reply. The author's current passing answer is checked under
 *  the task's id at each reading and once held. No cached absence or verdict hides a later try.
 *  A task the reference never answers needs that proof to leave room (`measured`). */
async function gated(desk: Desk, instance: Task, stop: AbortSignal): Promise<string> {
  const { request } = desk;
  const { log, id: session, verify } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(log, "task.proposed", { version, taskId, session, task: { taskId, family, publicInput, hidden } });
  let answer: JsonValue | undefined;
  const proof = () => {
    answer = desk.answered.get(contentOf(instance));
    return verify === null || answer === undefined
      ? Promise.resolve(null)
      : Promise.try(() => verify(instance, answer)).catch(
          (error: unknown) => ({ kind: "non-result", reason: errorMessage(error) }) as const,
        );
  };
  const { reason, said, reference } = await measured(
    { ...request, planted: desk.planted },
    task,
    stop,
    proof,
  );
  const held = `${taskId}: held out${said === "" ? "" : `; ${said}`}.`;
  const outcome = reason === null ? { outcome: "passed" } : { outcome: "refused", reason };
  append(log, GATE, {
    version,
    gate: 1,
    ...outcome,
    ...keyIfDefined("reference", reference),
    proved: desk.answered.has(contentOf(instance)),
  });
  if (outcome.outcome === "refused") {
    if (!measuredGate({ ...outcome, ...keyIfDefined("reference", reference) })) {
      desk.seen.delete(contentOf(instance));
    }
    append(log, "task.state", { version, state: "refused", session });
    desk.refused.push(version);
    return `${taskId}: refused: ${reason}`;
  }
  desk.held.push(version);
  const verdict = await proof();
  if (verdict === null || answer === undefined) return held;
  if (verdict.kind !== "pass") {
    return `${held} Author proof was not retained under this task id: ${tried(verdict)}`;
  }
  append(log, "task.feasible", { version, session, answer, ...measureOf(request.contract, verdict) });
  return held;
}

/** Whether the host has the tasks it asked for. */
const supplied = (desk: Desk): boolean => desk.held.length >= desk.request.wanted;

/** All of the gate, or its next word: the wall ends both, as the solves run on the session's signal. */
async function settled(desk: Desk, until: "all" | "next"): Promise<void> {
  const waiting = () => desk.pending.size > 0 && (until === "all" || desk.arrived.length === 0);
  while (waiting()) await Promise.race(desk.pending);
}

/**
 * A `try_task` call's instances put to the gate without waiting on it: the line of each instance
 * not taken, and the ids of the ones whose solves now run while the session goes on. What the gate
 * says of each comes with a later tool result, and `finish` and the session's end wait for it
 * (`settle`). Until 19 October a call waited on its slowest instance, and the first Examiner
 * sessions of three buffer campaigns spent 56, 57 and 80 minutes on the gate's replies.
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
      : [
          `${put.join(", ")}: put to the gate. What it says of each comes with a later tool result, and wait returns with it.`,
        ];
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
      // Take the call's instances before their gates start, so a batch may exceed what is wanted.
      const instances = args.tasks.map((given) => taken(instanceOf("", given), signal));
      if (name === "try_task") {
        return text(putAside(desk, instances, (instance) => gated(desk, instance, signal)));
      }
      const lines = await Promise.all(
        instances.map(async (instance) =>
          isString(instance) ? instance : await gated(desk, instance, signal),
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
 *  but its trace and, where the checks pass on a task in the exam, the answer with its proof.
 *  An instance the campaign already holds is checked under that task's own id, and a pass
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
  const prove = (events: readonly LogEvent[], version: string, verdict: Verdict, answer: JsonValue) => {
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
    label: "Try an answer",
    description:
      "Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. A try enters no task in the exam. Where the checks pass, the host holds the answer for a task proposed with that content before or after the try. While its gate is still reading, the proof can decide admission; once held, it is kept on the exam side for the Referee. A refused task stays refused. The gate's reading of the instance's package comes first, where it would refuse it.",
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
        prove(events, taskVersion(request.pack(instance)), verdict, answer);
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
 * The instances earlier sessions wrote that their gate read. One whose session was cut before its
 * gate wrote anything is no task of the campaign's, and may be proposed again.
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
 * the reference harness where the wall names one (`reference`): the reference's alone, laid afresh
 * each session and left out of the kept home. Blind to it, esp32-fresh-opus's Examiner held 0 of 49
 * drafts under its first promoted reference; in the supply ablation of 19 October on the buffer
 * domain, 1 of 8 drafts held blind and 4 of 8 with the copy. It is the operator's term
 * (`exam-reference`), on unless a campaign names it off.
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
  return {
    kind: "exam" as const,
    system: systemPrompt(attempts, reference === undefined ? "unseen" : "in-home"),
    opening: firstMessage(
      request.contract,
      request.checks,
      heard(before, request.tasks, request.results ?? true),
      limits,
      {
        brief: openingOf(before)?.prompt ?? null,
        budget: request.budget,
        lastNote: isString(note) && note.trim() !== "" ? note : null,
      },
    ),
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
      ...(request.probe === null
        ? []
        : [
            waitTool(
              "Wait for the gate's next word on the instances still at it, and return with it; at once where it has said something you have not been told, or nothing is at the gate.",
              async () => {
                await settled(desk, "next");
                return desk.arrived.length === 0 ? "Nothing is at the gate." : "The gate said:";
              },
            ),
          ]),
    ],
    enters: `a task enters it through ${gate} alone`,
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
    settle: async (all: boolean) => await settled(desk, all ? "all" : "next"),
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
    // crash in a model request is now kept.
    leave: (home: string, ended: string, running: number) => {
      if (keep === undefined || (ended === "crashed" && running > 0)) return;
      rmSync(keep, { recursive: true, force: true });
      if (existsSync(home)) cpSync(home, keep, { recursive: true });
      // The copy is the session's own, so a session with the term off never opens on one.
      rmSync(join(keep, REFERENCE_HOME), { recursive: true, force: true });
    },
  };
}

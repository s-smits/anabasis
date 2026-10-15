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
import { billedFor, poolOf } from "../kernel/reports.ts";
import type { Ending } from "../kernel/solve.ts";
import { LADDER, packageGate, type TaskPackage, taskSets, taskVersion } from "../kernel/task.ts";
import type { Engine, Task, Verdict, Verifier } from "../kernel/verify.ts";
import { cpSync, existsSync, rmSync } from "../meta/filesystem.ts";
import { capturedJsonStringify, decodedJsonText } from "../meta/json-runtime.ts";
import { asRecord, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { text, tool } from "../solve/answer.ts";
import { type CheckRow, firstMessage, systemPrompt } from "./prompt.ts";
import { heard, measuredGate, TRIED, UNAFFORDED } from "./record.ts";

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
}

/** The most of an example one result shows. */
const SHOWN_CHARS = 20_000;
/** The event a gate writes of each draft (`gated`). */
const GATE = "task.gate";
/** Of every `LADDER_EVERY` drafts the reference harness answered in none of their solves and their
 *  author's answer passes on, the first is held for the ladder and the rest are held out
 *  (`gated`). */
const LADDER_EVERY = 3;
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
    description: `Put task instances to the host's gate, one at a time: the shape of each package, then ${String(TRIED)} solves of it by the reference harness, as the system prompt's section on the gate says. Each instance is a family, a public input and hidden values, in the shape of the existing tasks.`,
  },
} as const;
/** What only the checks read of an instance, as each tool that takes one describes it. */
const HIDDEN = Type.Unknown({ description: "What only the checks receive; null when a task has none." });
/** Why the gate refuses a task that carries a planted answer: the witness serves the feasibility
 *  gate and is then discarded, so it never reaches a solver (the overhaul plan, S.4; rule 9). */
const PLANTED =
  "it carries, whole, an answer that passed try_answer in this session: a planted answer is for try_answer alone, and no task holds one, in its public input or its hidden values";
const SUPPLIED = "The host has the tasks it needs. The session ends here.";
/** What the Examiner is told of a task held for the ladder: the outcome, and nothing of a solve. */
const LADDERED =
  "held for the ladder. This task will never be scored for promotion or released for practice.";
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

/** What the gate reads of one package: its shape, and under `try_task` the reference harness's
 *  solves of a package whose shape passed, `TRIED` of them at once, with what they billed. The task
 *  is held out where some of them and not all gave a valid answer, or none where its author's answer
 *  passes on it (`gated`), and a solve that ended in no reading leaves it unmeasured, as does a
 *  rejection the Referee did not rule earned (`probing`, `tools/d1b/examine.ts`): until 15 October
 *  the refusal said only the first, and 15 of 16 such refusals on record were the second. The
 *  Examiner hears the counts; no answer and no trace of a solve reaches it. The session bounds them: `stop` is the session's own signal, which its wall, its end
 *  and a killed run abort, and it is the kill a comparison's solves take (`probe`), so a wall that
 *  fires mid-try leaves no solve running and the task refused unmeasured. */
async function measured(desk: Desk, task: TaskPackage, stop: AbortSignal) {
  const { contract, log, id, probe } = desk.request;
  if (carries([task.publicInput, task.hidden], desk.planted)) return { reason: PLANTED, said: "" };
  const packaged = packageGate(contract, task);
  if (packaged.outcome === "refused") return { reason: packaged.reason, said: "" };
  if (probe === null) return { reason: null, said: "" };
  // The three solves are held at the campaign's reserve before any starts, beside the solves in
  // flight (`affords`): until 14 October nothing held them, and two reserves left started three.
  if (!affords(log, TRIED)) return { reason: UNAFFORDED, said: "" };
  const before = billedFor(read(log), id);
  const endings = await Promise.all(Array.from({ length: TRIED }, () => probe(task, id, stop)));
  const solves = endings.filter(({ outcome }) => outcome !== "non-result").length;
  const valid = endings.filter(({ outcome }) => outcome === "pass").length;
  const counted = `the reference harness answered it validly in ${String(valid)} of ${String(TRIED)} solves`;
  const unmeasured = `${String(TRIED - solves)} of the reference harness's ${String(TRIED)} solves of it ended in no reading or in a rejection the Referee did not rule earned, so it is not measured`;
  const roomless = `${counted}, and a task is held out only where it answers some and not all, or none where an answer of its author's passes on it`;
  const some = valid > 0 && valid < TRIED;
  return {
    reason: solves < TRIED ? unmeasured : some ? null : roomless,
    said: `; ${counted}`,
    reference: { valid, solves, billed: billedFor(read(log), id) - before },
    unsolved: solves === TRIED && valid === 0,
  };
}

/** The gates so far of drafts the reference harness answered in none of their three solves and
 *  that passed all the same, held out or for the ladder: what `gated` counts the next one against. */
function provedUnsolved(events: readonly LogEvent[]): number {
  return events.filter(({ kind, data }) => {
    const reference = asRecord(data.reference);
    return (
      kind === GATE &&
      (data.outcome === "passed" || data.outcome === LADDER) &&
      reference?.valid === 0 &&
      reference.solves === TRIED
    );
  }).length;
}

/** The gate for one instance the Examiner proposed, and the line it is told (`measured`). Its gate
 *  says whether it came with a proof: an answer of its author's that passed the checks on its
 *  content before it was proposed (`proved`, read by `heldShare`). The proof is put to the checks
 *  again under the task's own id, and the task is on record as feasible only where it passes there.
 *  A task the reference harness answered in none of its solves is held out where it passes so: a
 *  witness says a valid answer exists, which three failed solves do not say either way, and a task
 *  the reference never answers while a valid answer to it is on record is the room a promotion
 *  leaves (`informative`, `src/kernel/compare.ts`). The first of every `LADDER_EVERY` such drafts
 *  in the campaign's log is held for the ladder instead (`LADDER`, `task.ts`), the climb's fixed
 *  yardstick, so the ladder has a task once any such draft does; a count, and no hash of the
 *  version, since two to fourteen such drafts a campaign are too few for a hash's share to hold.
 *  Without a proof it is refused, as is a task the solves left unmeasured. Until 15 October every
 *  such task went to the ladder: in five campaigns of 14 October 31 of 120 drafts did, 47 were held
 *  out, and a promoted harness that answered every scored solve (buffer-149's 68 of 68,
 *  recode-151's 56 of 56) was left only the drafts it answered some of the time. */
async function gated(desk: Desk, instance: Task, stop: AbortSignal): Promise<string> {
  const { request } = desk;
  const { log, id: session, verify } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(log, "task.proposed", { version, taskId, session, task: { taskId, family, publicInput, hidden } });
  const answer = desk.answered.get(contentOf(instance));
  const { reason, said, reference, unsolved } = await measured(desk, task, stop);
  const proof = async () =>
    verify === null || answer === undefined
      ? null
      : await Promise.try(() => verify(instance, answer)).catch(
          (error: unknown) => ({ kind: "non-result", reason: errorMessage(error) }) as const,
        );
  // A task the reference never answered is held on its proof, so that is read before its gate; one
  // it answered some of the time is held on the solves, and its proof is read once it is held.
  const early = unsolved === true ? await proof() : null;
  const proved = early?.kind === "pass";
  const ladder = proved && provedUnsolved(read(log)) % LADDER_EVERY === 0;
  const outcome =
    reason === null || (proved && !ladder)
      ? { outcome: "passed" }
      : ladder
        ? { outcome: LADDER }
        : { outcome: "refused", reason };
  append(log, GATE, {
    version,
    gate: 1,
    ...outcome,
    ...keyIfDefined("reference", reference),
    proved: answer !== undefined,
  });
  if (ladder) {
    append(log, "task.feasible", { version, session });
    append(log, "task.state", { version, state: LADDER, session });
    return `${taskId}: ${LADDERED}`;
  }
  if (outcome.outcome === "refused") {
    append(log, "task.state", { version, state: "refused", session });
    desk.refused.push(version);
    return `${taskId}: refused: ${reason}`;
  }
  desk.held.push(version);
  const verdict = early ?? (await proof());
  if (verdict === null) return `${taskId}: held out${said}.`;
  if (verdict.kind !== "pass") {
    return `${taskId}: held out${said}. Author proof was not retained under this task id: ${tried(verdict)}`;
  }
  append(log, "task.feasible", { version, session });
  return `${taskId}: held out${said}.`;
}

/** The campaign's gates of drafts so far, as the Examiner is told them after each proposal: how
 *  many of those that came with a proof were held out, and of those that did not. A fact and no
 *  rule. On the three run logs read on 13 October the proof foretold the gate: in one campaign the
 *  drafts with one were held 23 of 23, and of those without, 5 were held and 21 refused, 11 at no
 *  valid solve of three and 10 at three. A gate with no `proved`, as a pack's task has, is no
 *  draft's and is not counted. */
function heldShare(events: readonly LogEvent[]): string {
  const of = (proved: boolean) => {
    const gates = events.filter(({ kind, data }) => kind === GATE && data.proved === proved);
    const held = gates.filter(({ data }) => data.outcome === "passed").length;
    return `${String(held)} of ${String(gates.length)}`;
  };
  return `So far in this campaign, drafts with a proof were held ${of(true)}, and drafts without one ${of(false)}.`;
}

/** Whether the host has the tasks it asked for. */
const supplied = (desk: Desk): boolean => desk.held.length >= desk.request.wanted;

/** The tool that holds tasks out, under the name the session's gate has. */
function proposeTool(desk: Desk, name: keyof typeof GATES): AgentTool {
  const { id, limits } = desk.request;
  const spent = () => desk.proposed >= limits.puts;
  /** One instance of a batch: why it was not taken, or the gate's line of it. */
  const taken = async (instance: Omit<Task, "taskId">, stop: AbortSignal): Promise<string> => {
    const content = contentOf(instance);
    const before = desk.seen.get(content);
    if (before === "now") return "An instance proposed before was not taken again.";
    if (before === "earlier") return "An instance an earlier session wrote was not taken again.";
    if (spent()) return "An instance was not taken: this session can propose no further task.";
    if (supplied(desk)) return `An instance was not taken. ${SUPPLIED}`;
    // A batch is gated one instance at a time, so the wall can fire between two of them. Until
    // 14 October the next was still proposed and its three solves started on the spent signal, to
    // be killed at once: recode-151's x-1 ended with two batches of three solves killed.
    if (stop.aborted) return "An instance was not taken: the session has ended.";
    desk.seen.set(content, "now");
    desk.proposed += 1;
    return await gated(
      desk,
      { ...instance, taskId: `${id}-${String(desk.proposed).padStart(3, "0")}` },
      stop,
    );
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
      const lines: string[] = [];
      for (const given of args.tasks) lines.push(await taken(instanceOf("", given), signal));
      lines.push(heldShare(read(desk.request.log)));
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
  /** Puts on record that a held task has a valid answer, where the log does not say so yet. */
  const prove = (events: readonly LogEvent[], version: string) => {
    const sets = taskSets(events);
    const inExam =
      sets.held.includes(version) ||
      sets.released.includes(version) ||
      sets.states.get(version) === "disputed";
    if (inExam && !poolOf(events).feasible.has(version)) {
      append(log, "task.feasible", { version, session: request.id });
    }
  };
  return tool({
    name: "try_answer",
    label: "Try an answer",
    description:
      "Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. Use it to make sure a task has a valid answer, and to see how close to a limit an answer can sit: write the answer first, derive the task, and try it. A try enters no task in the exam, and no answer is recorded; where the checks pass, the host records that the instance has a valid answer and holds the answer for this session alone, so a task proposed with that content, before or after the try, is not later read as possibly infeasible. The gate's reading of the instance's package is given first, where it would refuse it.",
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
      const unformed = answerFormatFault(contract, answer);
      if (unformed !== null) {
        return text(
          `${gate}This answer does not follow the answer format, so a solver's answer like it is refused before any check reads it, and no check was run: ${unformed}`,
        );
      }
      const verdict = await verify(instance, answer);
      if (verdict.kind === "pass") {
        desk.answered.set(content, answer);
        desk.planted.add(hashJsonValue(answer));
        prove(events, taskVersion(request.pack(instance)));
      }
      return text(`${gate}${tried(verdict)}`);
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

/** The mode that writes tasks: the exam's own tools, `try_answer` where the host verifies, and
 *  the home carried from the campaign's last session where the wall keeps one (`keep`). */
export function writing(request: Terms, pinned: readonly Engine[], keep: string | undefined) {
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
  };
  // How a task is held out: on its package's shape, or on that and `TRIED` solves of the reference
  // harness where the host can have it solve one.
  const gate = request.probe === null ? "propose_tasks" : "try_task";
  const attempts = request.probe === null ? undefined : TRIED;
  // What the last Examiner session that finished said at its `finish`, where one did.
  const note = before.findLast(({ kind, data }) => kind === "exam.finished" && isString(data.note))?.data
    .note;
  // The last session, where the provider failed its turn with no command running: its home is kept.
  const cut = before.findLast(({ kind }) => kind === "exam.finished")?.data;
  const kept = cut?.ended === "crashed" && cut.running === 0 && isString(cut.session) ? cut.session : null;
  return {
    kind: "exam" as const,
    system: systemPrompt(attempts),
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
        : kept === null
          ? "holds what the last Examiner session of this campaign left in it, or nothing at the campaign's first"
          : `holds what Examiner session ${kept} of this campaign left in it when the provider failed one of its turns, before it finished`,
    checked: undefined,
    nudge: "Propose further tasks",
    finish:
      "End the session. Say in one or two sentences what kinds of task you wrote and what you would try next.",
    declined: MORE,
    done: (): "supplied" | null => (supplied(desk) ? "supplied" : null),
    counted: () => ({ proposed: desk.proposed, held: desk.held, refused: desk.refused }),
    result: () => ({ puts: desk.proposed, held: desk.held, refused: desk.refused }),
    // The next session's home is seeded with what the campaign keeps of the last one's.
    enter: (home: string) => {
      if (keep !== undefined && existsSync(keep)) cpSync(keep, home, { recursive: true });
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
    },
  };
}

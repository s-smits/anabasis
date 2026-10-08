/**
 * One Examiner session: the agent that writes tasks, and the host that puts each through its gates.
 *
 * The plan's D1b is "one Examiner session writes task instances only", and until this file nothing
 * in v2 wrote a task: every task a gate had seen came from a pack v1 authored. The session is given
 * the domain's public contract, its checks by id and assertion, and existing tasks for their shape.
 * It proposes instances, and for each the host runs the task's own gates (`src/kernel/task.ts`):
 *
 * 1. the package's shape;
 * 2. one solve under the stronger condition, whose pass is the witness that the task can be done;
 * 3. the checks again on the answer that solve submitted;
 * 4. three reject controls, which the Examiner writes as edits of that answer.
 *
 * A task past gate 4 is feasible. It is then solved under the test condition and the Examiner is
 * told one word of it. That word is a supply reading and the author's feedback, and it moves no
 * task: D1b has one harness, and a task admitted or dropped on one harness's solves would be chosen
 * by that harness's fails, which is the selection the plan's symmetric admission exists to prevent.
 * So a feasible task stays held, the word is logged as `exam.word`, and a round screens the task
 * again under both of its harnesses (`src/builder/round.ts`).
 *
 * What the Examiner is never given: a harness, a solver's trace, or the measured solver's answers.
 * It has no shell and reads no file. It does read the stronger solve's accepted answer, since a
 * reject control is an edit of it: one field replaced or one passage rewritten, made by the host
 * from the change the Examiner names (`changedAnswer`), so a control is one fact apart from the
 * answer by construction and no author copies an answer out three times. It is told a gate's reason
 * when a gate refuses. Gates 1, 3 and 4 judge its own package and the checks it writes controls
 * for; gate 2's one reason is a check that could not run on the stronger solver's answer, which is
 * the instance's fault or the check's and says nothing of the solver being measured.
 *
 * A task's limit is set the plain way here, the plan's option A of decision 15: the Examiner sets it
 * and learns from the words. Option B, the host setting it from the stronger solve, changes a task
 * after its version is taken and waits on the operator's word.
 *
 * The session ends at `finish`, at its wall or its turns, when the host has the feasible tasks it
 * was asked for, or when a solve or the verifier throws, which stops a run: the session writes its
 * record and throws it again. An instance is logged whole with its proposal, hidden values too, so a
 * later solve of it needs the log and nothing beside it; no tool here returns a line of the log.
 */
import { type AgentMessage, type AgentTool, runAgentLoop } from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { REPORTED_COST } from "../backends/claude.ts";
import type { Practised } from "../builder/session.ts";
import type { Contract } from "../kernel/contract.ts";
import { append, type EventKind, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import type { Counted } from "../kernel/solve.ts";
import {
  CONTROLS,
  controlsGate,
  determinismGate,
  packageGate,
  type RejectControl,
  screen,
  type TaskPackage,
  taskVersion,
} from "../kernel/task.ts";
import type { Task, Verifier } from "../kernel/verify.ts";
import { mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { type Change, changedAnswer } from "../review/probe.ts";
import type { RefereeFinding } from "../review/referee.ts";
import { text, tool } from "../solve/answer.ts";
import { traceSink } from "../solve/run.ts";
import { type CheckRow, firstMessage, NUDGE, SYSTEM_PROMPT } from "./prompt.ts";

/** What an Examiner is told of a task. */
export type Word = "refused" | "too hard" | "too easy" | "wall-bound" | "scored" | "undecided";

export interface ExamLimits {
  readonly wallSeconds: number;
  /** The model's turns, each reply one, with or without a tool call. */
  readonly turns: number;
  /** Solves in flight at once, the stronger condition's and the test condition's alike. */
  readonly concurrency: number;
  /** Instances the session may put to gate 2, each of which costs a stronger solve. */
  readonly candidates: number;
  /** Feasible tasks told a word of their test-side solves, at which the host has what it needs and
   *  ends the session: the plan's 24. A feasible task whose solves did not all count is not among
   *  them, since the supply rule could not be read on it. */
  readonly feasible: number;
}

export interface ExamRequest {
  /** Names the session in the log, and prefixes the ids of the tasks it writes. */
  readonly id: string;
  readonly contract: Contract;
  /** The checks as the Examiner is shown them. */
  readonly checks: readonly CheckRow[];
  /** Existing tasks of the domain, shown whole on request, for their shape. */
  readonly examples: readonly Task[];
  /** An instance as a package: the caller's statement, rule ids and check program for it. */
  readonly pack: (task: Task) => TaskPackage;
  readonly verify: Verifier;
  /** One solve of the task under the stronger condition and under the test condition. The caller
   *  builds each condition, records it and hands `kill` to the solve. A throw ends the session. */
  readonly strong: (task: TaskPackage, version: string, kill: AbortSignal) => Promise<Practised>;
  readonly test: (task: TaskPackage, version: string, kill: AbortSignal) => Promise<Practised>;
  /** Test-side solves of a feasible task, and the fails among them that make it scored. */
  readonly screening: { readonly solves: number; readonly fails: number };
  /** The Referee, when the caller has a reader for it, and whether a fail it rules a check defect
   *  disputes the task or is only noted beside its word: the hand reading is the gate until the
   *  Referee's rulings have cleared the operator's bar (`src/review/agreement.ts`). */
  readonly referee?: (solve: string, task: TaskPackage, kill: AbortSignal) => Promise<RefereeFinding>;
  readonly refereeDecides: boolean;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: ExamLimits;
  /** The backends, built on the home the Examiner's model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly log: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

export interface Examined {
  /** The versions of the tasks past gate 4 and not disputed since, in the order they got there. */
  readonly feasible: readonly string[];
  /** The word each was told, by version. */
  readonly words: Readonly<Record<string, Word>>;
  /** How the session ended: by `finish`, with the tasks the host asked for, at a limit, or otherwise. */
  readonly ended: "finished" | "supplied" | "wall" | "turns" | "killed" | "crashed" | "stopped";
}

/** A reject control as the Examiner sends it: one change to the accepted answer, and the check
 *  that must refuse the result. */
type ControlEdit = Change & { readonly check: string };

/** A task past gate 3, waiting for its controls. */
interface Waiting {
  readonly task: TaskPackage;
  readonly version: string;
  readonly accepted: JsonValue;
  tries: number;
}

/** What a session's tools share. */
interface Desk {
  readonly request: ExamRequest;
  proposed: number;
  /** The instances proposed so far, by content, so that one is not paid for twice. */
  readonly seen: Set<string>;
  readonly waiting: Map<string, Waiting>;
  readonly feasible: string[];
  /** Feasible tasks told too easy, wall-bound or scored: the ones the supply rule reads. */
  screened: number;
  readonly words: Map<string, Word>;
  /** Referee failures, kept for the host. */
  readonly faults: string[];
  /** Aborted when a solve or the verifier threw, which ends the session. */
  readonly halt: AbortController;
  fatal: Error | null;
  note: string | null;
}

/** Times a task's controls may be written before gate 4 refuses it: a control is checked by the
 *  verifier alone, and a second stronger solve of the same instance would cost far more. */
const CONTROL_TRIES = 3;
/** The most of an example or an accepted answer one result shows. */
const SHOWN_CHARS = 20_000;
const ENDINGS = ["finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
const SUPPLIED = "The host has the tasks it needs. The session ends here.";

const shown = (value: JsonValue) => capturedJsonStringify(value, null, 2).slice(0, SHOWN_CHARS);

/** Whether the host has the tasks it asked for. */
function supplied(desk: Desk): boolean {
  return desk.screened >= desk.request.limits.feasible;
}

/** A harness that cannot list its tools fails every task before its first turn. That is the host's
 *  to mend and no task's fault, so it ends the session where a task's own fail would be a word. */
function refuseBroken(ending: Practised["ending"]): void {
  if (ending.outcome === "fail" && ending.kind === "broken-harness") {
    throw new Error(`the harness is broken, so no solve of any task counts: ${ending.reason}`);
  }
}

/** Stop the session on what a solve or the verifier threw, and tell the Examiner only that. */
function halted(desk: Desk, error: unknown): Error {
  desk.fatal ??= asError(error);
  desk.halt.abort();
  return new Error("The host could not go on, which is not your task's fault. The session ends here.");
}

/** Record the word a task's author is told of it, and return it. */
function told(desk: Desk, task: Pick<Task, "taskId">, version: string, word: Word, why: JsonObject): Word {
  desk.words.set(version, word);
  append(desk.request.log, "exam.word", {
    session: desk.request.id,
    version,
    taskId: task.taskId,
    word,
    ...why,
  });
  return word;
}

/** Gates 1 to 3 for one instance: the line the Examiner is told, with the task left waiting for its
 *  controls when it is feasible so far. */
async function gated(desk: Desk, instance: Task, kill: AbortSignal): Promise<string> {
  const { request } = desk;
  const { log } = request;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, { version, ...data });
  const refused = (reason: string) => {
    record("task.state", { state: "refused", session: request.id });
    return `${task.taskId}: ${told(desk, task, version, "refused", { reason })}: ${reason}`;
  };
  const { taskId, family, publicInput, hidden } = instance;
  record("task.proposed", { taskId, session: request.id, task: { taskId, family, publicInput, hidden } });
  const packaged = packageGate(request.contract, task);
  record("task.gate", { gate: 1, ...packaged });
  if (packaged.outcome === "refused") return refused(packaged.reason);

  const { solve, ending } = await request.strong(task, version, kill);
  refuseBroken(ending);
  if (ending.outcome === "non-result" && ending.kind !== "check") {
    told(desk, task, version, "undecided", { solve, kind: ending.kind });
    return `${task.taskId}: undecided: the host could not finish a solve of it, which says nothing of the task.`;
  }
  if (ending.outcome === "non-result") {
    record("task.gate", { gate: 2, outcome: "refused", solve, reason: ending.reason });
    return refused(`a check could not run on a solver's answer: ${ending.reason}`);
  }
  if (ending.outcome === "fail") {
    record("task.gate", { gate: 2, outcome: "too-hard", solve, kind: ending.kind });
    record("task.state", { state: "too-hard", session: request.id });
    return `${task.taskId}: ${told(desk, task, version, "too hard", { solve, kind: ending.kind })}`;
  }
  const accepted = read(log).findLast(({ kind, data }) => kind === "verdict" && data.solve === solve)?.data
    .answer;
  if (accepted === undefined) throw new Error(`solve ${solve} passed and left no answer in the log`);
  record("task.gate", { gate: 2, outcome: "passed", solve });

  const repeated = await determinismGate(request.verify, task, accepted);
  record("task.gate", { gate: 3, ...repeated });
  if (repeated.outcome === "refused") return refused(repeated.reason);
  desk.waiting.set(task.taskId, { task, version, accepted, tries: 0 });
  return `${task.taskId}: feasible so far. The answer the checks accepted:\n${shown(accepted)}\nWrite its ${String(CONTROLS)} reject controls with write_controls.`;
}

function proposeTool(desk: Desk): AgentTool {
  const { request } = desk;
  return tool({
    name: "propose_tasks",
    label: "Propose tasks",
    description:
      "Put task instances through the host's gates: shape, one solve by the stronger solver, and the checks again on its answer. Each instance is a family, a public input and hidden values, in the shape of the existing tasks. For each it returns refused with the gate's reason, too hard, or feasible so far with the answer the checks accepted. Each instance costs a long solve, and several in one call are solved side by side.",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          family: Type.String({ minLength: 1 }),
          public_input: Type.Unknown({ description: "What the solver reads of the task." }),
          hidden: Type.Unknown({ description: "What only the checks receive; null when a task has none." }),
        }),
        { minItems: 1 },
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, args, signal) => {
      if (supplied(desk)) throw new Error(SUPPLIED);
      const left = request.limits.candidates - desk.proposed;
      if (left <= 0) {
        throw new Error(
          "This session can propose no further task. Write the controls still waited for, or call finish.",
        );
      }
      const kill = signal ?? desk.halt.signal;
      const lines: string[] = [];
      const taken: Task[] = [];
      for (const { family, public_input, hidden } of args.tasks) {
        // SAFETY: a tool's arguments are JSON the provider parsed.
        const [publicInput, kept] = [public_input as JsonValue, (hidden ?? null) as JsonValue];
        const content = hashJsonValue({ family, publicInput, hidden: kept });
        if (desk.seen.has(content)) {
          lines.push("An instance proposed before was not taken again.");
        } else if (taken.length >= left) {
          lines.push("An instance was not taken: this session can propose no further task.");
        } else {
          desk.seen.add(content);
          desk.proposed += 1;
          const taskId = `${request.id}-${String(desk.proposed).padStart(3, "0")}`;
          taken.push({ taskId, family, publicInput, hidden: kept });
        }
      }
      try {
        lines.push(
          ...(await pooled(taken, request.limits.concurrency, (instance) => gated(desk, instance, kill))),
        );
      } catch (error) {
        throw halted(desk, error);
      }
      return text(lines.join("\n\n"));
    },
  });
}

/** Gate 4 for one waiting task: null when its controls hold, otherwise the line the Examiner is told. */
async function controlled(desk: Desk, taskId: string, edits: readonly ControlEdit[]): Promise<string | null> {
  const { request } = desk;
  const waiting = desk.waiting.get(taskId);
  if (waiting === undefined) return `${taskId} is not waiting for controls.`;
  const { task, version, accepted } = waiting;
  let controls: RejectControl[];
  try {
    controls = edits.map((edit) => ({ answer: changedAnswer(accepted, edit), expectedCheckId: edit.check }));
  } catch (error) {
    // A change that is not one is the Examiner's slip of the pen, and costs it no try.
    return `${taskId}: ${errorMessage(error)}. Write its controls again.`;
  }
  const result = await controlsGate(request.contract, request.verify, task, accepted, controls);
  if (result.outcome === "refused") {
    waiting.tries += 1;
    if (waiting.tries < CONTROL_TRIES) {
      return `${taskId}: its controls do not hold: ${result.reason}. Write them again.`;
    }
  }
  append(request.log, "task.gate", { version, gate: 4, ...result });
  desk.waiting.delete(taskId);
  if (result.outcome === "passed") return null;
  append(request.log, "task.state", { version, state: "refused", session: request.id });
  return `${taskId}: ${told(desk, task, version, "refused", { reason: result.reason })}: ${result.reason}`;
}

/** The test-side solves of the tasks that just became feasible, and the word each is told. */
async function worded(desk: Desk, tasks: readonly Waiting[], kill: AbortSignal): Promise<string[]> {
  const { request } = desk;
  const { solves, fails } = request.screening;
  const jobs = tasks.flatMap((waiting) => Array.from({ length: solves }, () => waiting));
  const ran = await pooled(jobs, request.limits.concurrency, async ({ task, version }) => {
    const { solve, ending } = await request.test(task, version, kill);
    refuseBroken(ending);
    const faulty = ending.outcome === "non-result" && ending.kind === "check";
    let ruled = false;
    if (ending.outcome === "fail" && request.referee !== undefined) {
      try {
        ruled = (await request.referee(solve, task, kill)).ruling === "check-defect";
      } catch (error) {
        desk.faults.push(`${solve}: ${errorMessage(error)}`);
      }
    }
    return { version, solve, ending, defect: faulty || (ruled && request.refereeDecides), ruled };
  });
  return tasks.map(({ task, version }) => {
    const mine = ran.filter((each) => each.version === version);
    const counted = mine.flatMap(({ ending }): Counted[] =>
      ending.outcome === "non-result" ? [] : [ending],
    );
    const defect = mine.find((each) => each.defect);
    let word: Word = "undecided";
    if (defect !== undefined) {
      append(request.log, "task.state", {
        version,
        state: "disputed",
        session: request.id,
        solve: defect.solve,
        reason: "a check was at fault on a solver's answer",
      });
      desk.feasible.splice(desk.feasible.indexOf(version), 1);
      word = "refused";
    } else if (counted.length === solves) {
      // One harness screens here, so it stands on both sides of the two-harness rule.
      const state = screen([counted, counted], fails);
      word = state === "admitted" ? "scored" : state === "too-easy" ? "too easy" : state;
      desk.screened += 1;
    }
    told(desk, task, version, word, {
      solves: mine.map(({ solve }) => solve),
      fails: counted.filter(({ outcome }) => outcome === "fail").length,
      // Fails an advising Referee ruled a check defect, for the person who reads them.
      flagged: mine.flatMap((each) => (each.ruled ? [each.solve] : [])),
    });
    return `${task.taskId}: ${word}${word === "refused" ? ": a check was at fault on a solver's answer" : ""}`;
  });
}

function controlsTool(desk: Desk): AgentTool {
  return tool({
    name: "write_controls",
    label: "Write controls",
    description: `Write the ${String(CONTROLS)} reject controls of feasible tasks. A control is one change to the task's accepted answer, a field replaced or a passage rewritten, and the id of the check that must refuse the changed answer. The host makes the change, so send the change and not the answer. When a task's controls hold it is solved by the solver being measured, which takes as long as its solves, and the result is the one word: too easy, wall-bound or scored.`,
    parameters: Type.Object({
      sets: Type.Array(
        Type.Object({
          task: Type.String({ description: "The task's id, as propose_tasks returned it." }),
          controls: Type.Array(
            Type.Object({
              check: Type.String({ description: "The id of the check that must refuse the changed answer." }),
              path: Type.String({
                description:
                  "A rooted path to an existing leaf of the accepted answer: `$.layout.members[0].area`. Array positions are bracketed; a key holding a dot or a slash is quoted: `$.files['src/main.cpp']`.",
              }),
              value: Type.Optional(
                Type.String({
                  description:
                    'The value that replaces the field, as JSON text: `0.0001`, `"bolted"` or `null`. Omit it when you send `find` and `replace`.',
                }),
              ),
              find: Type.Optional(
                Type.String({
                  description:
                    "Exact text inside the string field at `path`, occurring there exactly once. Sent with `replace`, in place of `value`: how one line of a source file is changed.",
                }),
              ),
              replace: Type.Optional(
                Type.String({ description: "The text that takes the place of `find`." }),
              ),
            }),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, args, signal) => {
      if (supplied(desk)) throw new Error(SUPPLIED);
      const kill = signal ?? desk.halt.signal;
      const lines: string[] = [];
      const passed: Waiting[] = [];
      try {
        for (const { task: taskId, controls } of args.sets) {
          const waiting = desk.waiting.get(taskId);
          const line = await controlled(desk, taskId, controls);
          if (line !== null) lines.push(line);
          else if (waiting !== undefined) {
            passed.push(waiting);
            desk.feasible.push(waiting.version);
          }
        }
        lines.push(...(await worded(desk, passed, kill)));
      } catch (error) {
        throw halted(desk, error);
      }
      return {
        ...text(`${lines.join("\n")}${supplied(desk) ? `\n\n${SUPPLIED}` : ""}`),
        terminate: supplied(desk),
      };
    },
  });
}

function exampleTool(desk: Desk): AgentTool {
  const examples = new Map(desk.request.examples.map((task) => [task.taskId, task]));
  return tool({
    name: "read_example",
    label: "Read an example",
    description:
      "Return one existing task of the domain whole: its family, its public input and its hidden values.",
    parameters: Type.Object({
      task: Type.String({ description: "An example's id, from the opening message." }),
    }),
    executionMode: "parallel",
    execute: async (_id, args) => {
      const example = examples.get(args.task);
      if (example === undefined) {
        throw new Error(`${args.task} is not one of the examples: ${[...examples.keys()].join(", ")}`);
      }
      const { taskId, family, publicInput, hidden } = example;
      return text(shown({ taskId, family, publicInput, hidden }));
    },
  });
}

function finishTool(desk: Desk): AgentTool {
  return tool({
    name: "finish",
    label: "Finish",
    description:
      "End the session. Say in one or two sentences what kinds of task you wrote and what you would try next.",
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      desk.note = args.note.trim();
      return { ...text("Finished."), terminate: true };
    },
  });
}

export async function examine(request: ExamRequest): Promise<Examined> {
  const { log, limits, model } = request;
  const began = performance.now();
  // A session's id prefixes its tasks' ids, and the Referee finds a task's accepted answer by them.
  if (read(log).some(({ kind, data }) => kind === "exam.started" && data.session === request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const desk: Desk = {
    request,
    proposed: 0,
    seen: new Set(),
    waiting: new Map(),
    feasible: [],
    screened: 0,
    words: new Map(),
    faults: [],
    halt: new AbortController(),
    fatal: null,
    note: null,
  };
  append(log, "exam.started", {
    session: request.id,
    model: priceKey(model),
    effort: request.effort,
    // SAFETY: the limits are plain numbers.
    limits: limits as unknown as JsonObject,
    screening: request.screening,
    checks: request.checks.map(({ id }) => id),
    examples: request.examples.map(({ taskId }) => taskId),
  });
  const tools = [proposeTool(desk), controlsTool(desk), exampleTool(desk), finishTool(desk)];
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([
    wall.signal,
    done.signal,
    desk.halt.signal,
    ...(request.kill ? [request.kill] : []),
  ]);
  const turns: AssistantMessage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  const home = mkdtempSync(join(tmpdir(), "ana-examiner-"));
  let crash: string | null = null;
  const timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
  try {
    const models = request.models(home);
    await runAgentLoop(
      [user(firstMessage(request.contract, request.checks, request.examples, limits))],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          // The session ends at `finish` and at supply even beside another call in the turn, where
          // pi would go on and a further instance would cost a further solve.
          const over = desk.note !== null || supplied(desk) || turns.length >= limits.turns;
          return over ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => (desk.note === null && !supplied(desk) ? [user(NUDGE)] : []),
      },
      traceSink(log, "exam", request.id, () => turns.length),
      signal,
      (asked, context, options) => models.streamSimple(asked, context, options),
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  crash ??= desk.fatal?.message ?? null;
  const by = {
    finished: desk.note !== null,
    supplied: supplied(desk),
    killed: request.kill?.aborted === true,
    wall: wall.signal.aborted,
    crashed: crash !== null,
    turns: turns.length >= limits.turns,
  };
  const ended = desk.fatal === null ? (ENDINGS.find((reason) => by[reason]) ?? "stopped") : "crashed";
  const tokens = tokensOf(turns.map((turn) => turn.usage));
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
  const words = Object.fromEntries(desk.words);
  append(log, "exam.finished", {
    session: request.id,
    ended,
    note: desk.note,
    proposed: desk.proposed,
    feasible: desk.feasible,
    words,
    waiting: [...desk.waiting.keys()],
    reviewFaults: desk.faults,
    crash,
    turns: turns.length,
    // SAFETY: the token classes are numbers.
    tokens: tokens as unknown as JsonObject,
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: isNumber(reported) ? reported : null,
    seconds: (performance.now() - began) / 1000,
  });
  if (desk.fatal !== null) throw desk.fatal;
  return { feasible: desk.feasible, words, ended };
}

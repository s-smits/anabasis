/**
 * One Examiner session: the agent that writes tasks, and the host that holds each one out.
 *
 * The session is given the domain's public contract, its checks by id and assertion, and every task
 * the campaign holds, each with its outcome so far and readable whole. It proposes instances, and the host puts each to the task's one gate
 * (`src/kernel/task.ts`): the shape of its package. An instance that passes is a held-out task from
 * then on, and every comparison may score it. The Examiner is told that, or why the gate refused.
 *
 * No solve runs here. Until 2026-10-09 a session put each instance to a stronger solver, whose
 * pass was the witness that the task could be done, ran the checks again on that answer, had the
 * Examiner write three reject controls as edits of it, and then solved the task three times under
 * the measured solver to tell its author a word. The plan after the v1 review removes all of it
 * (`docs/plan.md`, Phase 2): v1's solver matched whatever its author's side found, the first
 * sessions here lost 14 of 25 tasks at the stronger solve, and the second session spent $48.45 of
 * which the Examiner's own turns were $2.01. What a task's author hears instead comes from the
 * comparisons, one outcome a task, at the next session's opening (`record.ts`).
 *
 * What the Examiner is never given: a harness, a solver's trace or answer, a check's program. It
 * has no shell and reads no file.
 *
 * An Examiner is a new process each session, so the host keeps what a session cannot: an instance
 * an earlier session already wrote is not taken again, whatever id it would get.
 *
 * The session ends at `finish`, at its wall or its turns, or when the host has the tasks it was
 * asked for. A turn of its own the provider failed ends it crashed, with what the provider said.
 * An instance is logged whole with its proposal, hidden values too, so a later solve of it needs
 * the log and nothing beside it; no tool here returns a line of the log.
 */
import {
  type AgentMessage,
  type AgentTool,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { REPORTED_COST } from "../backends/claude.ts";
import type { Contract } from "../kernel/contract.ts";
import { writtenTasks } from "../kernel/history.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { packageGate, type TaskPackage, taskVersion } from "../kernel/task.ts";
import type { Task } from "../kernel/verify.ts";
import { mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isNumber, type JsonValue } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { text, tool } from "../solve/answer.ts";
import { failedTurn, loopCompaction, traceSink } from "../solve/run.ts";
import { type CheckRow, firstMessage, NUDGE, SYSTEM_PROMPT } from "./prompt.ts";
import { heard } from "./record.ts";

interface ExamLimits {
  readonly wallSeconds: number;
  /** The model's turns, each reply one, with or without a tool call. */
  readonly turns: number;
  /** Instances the session may put to the gate. */
  readonly proposals: number;
  /** Held-out tasks at which the host has what it asked for and ends the session. The Examiner is
   *  never told the number. */
  readonly tasks: number;
}

export interface ExamRequest {
  /** Names the session in the log, and prefixes the ids of the tasks it writes. */
  readonly id: string;
  readonly contract: Contract;
  /** The checks as the Examiner is shown them. */
  readonly checks: readonly CheckRow[];
  /** The tasks the campaign holds, the pack's and the ones earlier sessions wrote. Each is listed
   *  at the opening with its outcome so far (`record.ts`), and shown whole on request. */
  readonly examples: readonly Task[];
  /** An instance as a package: the caller's rule ids and check program for it. */
  readonly pack: (task: Task) => TaskPackage;
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
  /** The versions of the tasks this session held out, in the order it proposed them. */
  readonly held: readonly string[];
  /** The versions of the instances the gate refused. */
  readonly refused: readonly string[];
  /** How the session ended: by `finish`, with the tasks the host asked for, at a limit, or otherwise. */
  readonly ended: "finished" | "supplied" | "wall" | "turns" | "killed" | "crashed" | "stopped";
}

/** What a session's tools share. */
interface Desk {
  readonly request: ExamRequest;
  proposed: number;
  /** The instances this campaign has been given so far, by content, so that none is taken twice:
   *  this session's, and the ones earlier sessions wrote. */
  readonly seen: Map<string, "now" | "earlier">;
  readonly held: string[];
  readonly refused: string[];
  note: string | null;
}

/** The most of an example one result shows. */
const SHOWN_CHARS = 20_000;
const ENDINGS = ["finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
const SUPPLIED = "The host has the tasks it needs. The session ends here.";

/** An instance by what a solver and the checks read of it, whatever id it carries. */
function contentOf({ family, publicInput, hidden }: Omit<Task, "taskId">): string {
  return hashJsonValue({ family, publicInput, hidden: hidden ?? null });
}

/** Whether the host has the tasks it asked for. */
function supplied(desk: Desk): boolean {
  return desk.held.length >= desk.request.limits.tasks;
}

/** The gate for one instance the Examiner proposed: the line it is told. */
function gated(desk: Desk, instance: Task): string {
  const { request } = desk;
  const task = request.pack(instance);
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = instance;
  append(request.log, "task.proposed", {
    version,
    taskId,
    session: request.id,
    task: { taskId, family, publicInput, hidden },
  });
  const packaged = packageGate(request.contract, task);
  append(request.log, "task.gate", { version, gate: 1, ...packaged });
  if (packaged.outcome === "passed") {
    desk.held.push(version);
    return `${taskId}: held out.`;
  }
  append(request.log, "task.state", { version, state: "refused", session: request.id });
  desk.refused.push(version);
  return `${taskId}: refused: ${packaged.reason}`;
}

function proposeTool(desk: Desk): AgentTool {
  const { request } = desk;
  return tool({
    name: "propose_tasks",
    label: "Propose tasks",
    description:
      "Put task instances to the host's gate, which reads the shape of each package. Each instance is a family, a public input and hidden values, in the shape of the existing tasks. For each it returns held out, or refused with the gate's reason. A task that is held out is in the exam from then on.",
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
    execute: async (_id, args) => {
      if (supplied(desk)) throw new Error(SUPPLIED);
      if (desk.proposed >= request.limits.proposals) {
        throw new Error("This session can propose no further task. Call finish.");
      }
      const lines: string[] = [];
      for (const { family, public_input, hidden } of args.tasks) {
        // SAFETY: a tool's arguments are JSON the provider parsed.
        const [publicInput, kept] = [public_input as JsonValue, (hidden ?? null) as JsonValue];
        const content = contentOf({ family, publicInput, hidden: kept });
        const before = desk.seen.get(content);
        if (before !== undefined) {
          lines.push(
            before === "now"
              ? "An instance proposed before was not taken again."
              : "An instance an earlier session wrote was not taken again.",
          );
        } else if (desk.proposed >= request.limits.proposals) {
          lines.push("An instance was not taken: this session can propose no further task.");
        } else if (supplied(desk)) {
          lines.push(`An instance was not taken. ${SUPPLIED}`);
        } else {
          desk.seen.set(content, "now");
          desk.proposed += 1;
          const taskId = `${request.id}-${String(desk.proposed).padStart(3, "0")}`;
          lines.push(gated(desk, { taskId, family, publicInput, hidden: kept }));
        }
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

/** Why no Examiner session starts under `id` on this log, or null. A session's id prefixes its
 *  tasks' ids. A launcher asks before it starts one. */
export function claimed(events: readonly LogEvent[], id: string): string | null {
  return events.some(({ kind, data }) => kind === "exam.started" && data.session === id)
    ? `session ${id} is in the log already; a session's id names one session`
    : null;
}

export async function examine(request: ExamRequest): Promise<Examined> {
  const { log, limits, model } = request;
  const began = performance.now();
  const before = read(log);
  const why = claimed(before, request.id);
  if (why !== null) throw new Error(why);
  const desk: Desk = {
    request,
    proposed: 0,
    seen: new Map(writtenTasks(before).map((task) => [contentOf(task), "earlier"] as const)),
    held: [],
    refused: [],
    note: null,
  };
  append(log, "exam.started", {
    session: request.id,
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
    checks: request.checks.map(({ id }) => id),
    examples: request.examples.map(({ taskId }) => taskId),
  });
  const tools = [proposeTool(desk), exampleTool(desk), finishTool(desk)];
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([wall.signal, done.signal, ...(request.kill ? [request.kill] : [])]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  // A name every solver's wall denies (`wall-policy.ts`): the Examiner's Claude Code keeps its
  // session here, the tasks' hidden expectations included.
  const home = mkdtempSync(join(tmpdir(), "ana-claude-cli-examiner-"));
  let crash: string | null = null;
  const timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
  try {
    const models = request.models(home);
    const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
    await runAgentLoop(
      [user(firstMessage(request.contract, request.checks, heard(before, request.examples), limits))],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          // The session ends at `finish` and at supply even beside another call in the turn.
          const over = desk.note !== null || supplied(desk) || turns.length >= limits.turns;
          return over ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => (desk.note === null && !supplied(desk) ? [user(NUDGE)] : []),
        prepareRequest: loopCompaction(log, "exam", request.id, stream, summaries),
      },
      traceSink(log, "exam", request.id, () => turns.length),
      signal,
      stream,
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  const cut = wall.signal.aborted || request.kill?.aborted === true;
  crash ??= cut ? null : failedTurn(turns);
  const by = {
    finished: desk.note !== null,
    supplied: supplied(desk),
    killed: request.kill?.aborted === true,
    wall: wall.signal.aborted,
    crashed: crash !== null,
    turns: turns.length >= limits.turns,
  };
  const ended = ENDINGS.find((reason) => by[reason]) ?? "stopped";
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
  append(log, "exam.finished", {
    session: request.id,
    ended,
    note: desk.note,
    proposed: desk.proposed,
    held: desk.held,
    refused: desk.refused,
    crash,
    turns: turns.length,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: isNumber(reported) ? reported : null,
    seconds: (performance.now() - began) / 1000,
  });
  return { held: desk.held, refused: desk.refused, ended };
}

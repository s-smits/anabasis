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
import type { Task, Verdict, Verifier } from "../kernel/verify.ts";
import { rmSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isNumber, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { basename, dirname } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { text, tool } from "../solve/answer.ts";
import {
  type CommandWall,
  networkReach,
  type SolveDirs,
  solveDirs,
  type Walled,
  walledBase,
} from "../solve/command.ts";
import { codingTools } from "../solve/coding-tools.ts";
import { failedTurn, loopCompaction, traceSink } from "../solve/run.ts";
import { mountDiskCap } from "../verify/disk-cap.ts";
import { hostScratch } from "../verify/wall-policy.ts";
import { wrapToolDefinitions } from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { openingOf } from "../builder/opening.ts";
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
  /** The budget every solve is held to, as a fact for the Examiner: the solver's own turns, null
   *  where unlimited, and the minutes. Null where the caller knows none, as a test may. */
  readonly budget?: { readonly modelTurns: number | null; readonly minutes: number } | null | undefined;
  /** The campaign's verifier, for `try_answer`: the checks run on an instance with an answer of the
   *  Examiner's own. Absent, the tool is not given. */
  readonly verify?: Verifier | undefined;
  /** The Examiner's shell, where the session has one: `bash`, `read` and `write` in a walled home
   *  of its own. Absent, the Examiner computes nothing (`examineWalled` gives one). */
  readonly shell?: CommandWall | undefined;
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
  /** The instances, by content, the host saw a valid answer to in this session's `try_answer`:
   *  a proposal of one is logged as feasible, and never waits for a person as possibly infeasible
   *  (`awaitingLabel`). The answer itself is kept nowhere (11 October, `docs/simplify.md`, F4). */
  readonly answered: Set<string>;
  readonly held: string[];
  readonly refused: string[];
  note: string | null;
  /** Whether `finish` was once declined: a session that held out fewer tasks than the host asks
   *  for is told so once, and ends at its second word. */
  declined: boolean;
}

/** The most of an example one result shows. */
const SHOWN_CHARS = 20_000;
const ENDINGS = ["finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
const SUPPLIED = "The host has the tasks it needs. The session ends here.";
/** What a first `finish` is answered with while the host has not the tasks it needs: every live
 *  Examiner session of 9 and 10 October proposed one batch of one to three tasks in three turns
 *  and finished, of two hundred turns and twelve tasks it had, so a campaign paid a session's
 *  opening six times for what one session could have written. The need, and no count. */
const MORE =
  "Noted, and the session goes on: the host does not yet have the tasks it needs from it. Propose further tasks, varying what they ask, and call finish again when you have none left worth proposing.";

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
    ...keyIfDefined("feasible", desk.answered.has(contentOf(instance)) ? true : undefined),
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

/** The checks run on one instance with an answer of the Examiner's: which refuse it, or that none
 *  does. The Examiner wrote tasks it could not know to be feasible: on 10 October the notes of
 *  nine sessions said in eight that feasibility rested on hand estimates, and two of seven tasks
 *  of one session asked for more than their input allowed. Nothing of a try is kept but its
 *  trace: no task, no answer. */
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

function tryTool(desk: Desk, verify: Verifier): AgentTool {
  const { request } = desk;
  return tool({
    name: "try_answer",
    label: "Try an answer",
    description:
      "Run the checks on an instance with an answer of yours, and say which checks refuse it, or that none does. Use it to make sure a task has a valid answer, and to see how close to a limit an answer can sit: write the answer first, derive the task, and try it. A try keeps no answer and enters no task in the exam; where the checks pass, the host keeps that the instance has a valid answer, so a task proposed with that content is not later read as possibly infeasible. The gate's reading of the instance's package is given first, where it would refuse it.",
    parameters: Type.Object({
      family: Type.String({ minLength: 1 }),
      public_input: Type.Unknown({ description: "What the solver would read of the task." }),
      hidden: Type.Unknown({ description: "What only the checks receive; null when a task has none." }),
      answer: Type.Unknown({ description: "An answer in the domain's answer format." }),
    }),
    executionMode: "parallel",
    execute: async (_id, args, signal) => {
      // SAFETY: a tool's arguments are JSON the provider parsed.
      const [publicInput, hidden, answer] = [args.public_input, args.hidden ?? null, args.answer] as [
        JsonValue,
        JsonValue,
        JsonValue,
      ];
      const instance: Task = { taskId: "try", family: args.family, publicInput, hidden };
      const packaged = packageGate(request.contract, request.pack(instance));
      const gate =
        packaged.outcome === "passed"
          ? ""
          : `The gate would refuse this instance: ${packaged.reason}
`;
      if (signal?.aborted === true) throw new Error("The session has ended.");
      const verdict = await verify(instance, answer);
      if (verdict.kind === "pass") desk.answered.add(contentOf(instance));
      return text(`${gate}${tried(verdict)}`);
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
      if (!desk.declined && !supplied(desk)) {
        desk.declined = true;
        return text(MORE);
      }
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

/** The session's tools: the exam's own, `try_answer` where the host verifies, the shell where the
 *  session has one, with what it is told of its wall, and `finish`. */
async function toolsOf(desk: Desk): Promise<AgentTool[]> {
  const { request } = desk;
  // What the shell is told of its wall, after pi's own description of `bash`; the network as the
  // wall's probe found it (`networkReach`).
  const network = request.shell === undefined ? "unreached" : await networkReach(request.shell);
  const walls = ` The command runs in your home directory, which is yours for the session and empty at its start. It can write there and $TMPDIR, which is kept for the whole session; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. It can read the host's own toolchains and public runtime roots, but no repository or private data. ${network === "reached" ? "It has network access: a package index was reached from inside the wall when this process started." : "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be installed."} A command has a default time limit and may name a longer timeout. Nothing a command starts runs on after it returns. Nothing in your home enters the exam: a task enters it through propose_tasks alone.`;
  const shell =
    request.shell === undefined
      ? []
      : // SAFETY: pi's wrapper types its tools' parameters `any`; each is one of pi's definitions.
        (wrapToolDefinitions(codingTools(request.shell, ["bash", "read", "write"])) as AgentTool[]).map(
          (each) => (each.name === "bash" ? { ...each, description: `${each.description}${walls}` } : each),
        );
  return [
    proposeTool(desk),
    exampleTool(desk),
    ...(request.verify === undefined ? [] : [tryTool(desk, request.verify)]),
    ...shell,
    finishTool(desk),
  ];
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
    answered: new Set(),
    held: [],
    refused: [],
    note: null,
    declined: false,
  };
  append(log, "exam.started", {
    session: request.id,
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
    checks: request.checks.map(({ id }) => id),
    examples: request.examples.map(({ taskId }) => taskId),
  });
  const tools = await toolsOf(desk);
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([wall.signal, done.signal, ...(request.kill ? [request.kill] : [])]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  // Under the host's own scratch, which every wall closes (`wall-policy.ts`): the Examiner's
  // Claude Code keeps its session here, the tasks' hidden expectations included.
  const home = hostScratch("claude-cli-examiner-");
  let crash: string | null = null;
  const timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
  try {
    const models = request.models(home);
    const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
    await runAgentLoop(
      [
        user(
          firstMessage(request.contract, request.checks, heard(before, request.examples), limits, {
            brief: openingOf(before)?.prompt,
            budget: request.budget,
          }),
        ),
      ],
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

/** Where an Examiner session's shell runs: a capped root of its own, as a Builder's. */
export const examinerDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`exam-${basename(dirname(log))}-${id}`);

/**
 * One Examiner session with a shell under the solver's command wall and disk cap: mount, run,
 * tear down. Until 10 October an Examiner could run nothing, and its notes said that a task's
 * feasibility rested on hand estimates; with a shell it computes an instance, and with
 * `try_answer` it knows the instance has a valid answer before it proposes it.
 */
export async function examineWalled(request: Omit<ExamRequest, "shell"> & Walled): Promise<Examined> {
  const dirs = examinerDirs(request.log, request.id);
  const release = await mountDiskCap({ root: dirs.root, bytes: request.diskBytes });
  try {
    const shell: CommandWall = {
      base: await walledBase(dirs, request, "an Examiner"),
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 120, shellMaxSeconds: 600 },
    };
    return await examine({ ...request, shell });
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}

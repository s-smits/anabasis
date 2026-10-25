/**
 * The Examiner's one session, in its two modes: it drafts an exam (`draft.ts`), or it writes tasks
 * (`write.ts`). Until 13 October a third mode repaired a check; no campaign opened one, and no seat
 * repairs a check (`AGENTS.md` rule 2). A log of before keeps its `repair.*` events.
 *
 * A mode is what a session is told, the tools it works with and when its work is done (`Mode`);
 * everything else is one loop (`examining`) in the frame every seat's session has (`sit`,
 * `src/agent/session.ts`): its start event, its `finish`, its shell where it has one, the turns and
 * calls in the log under the mode's kind, and its end event with what it billed. A
 * turn of its own the provider failed ends it crashed, with what the provider said. A drafting
 * session puts one whole draft to the host's reading until one stands (`putting`); a writing
 * session proposes many tasks. The id, the root and the home are the wall's (`inExaminerWall`,
 * `shell.ts`), which seeds a writing session's home and carries it on.
 *
 * What the Examiner is never given, in any mode: a harness, a solver's trace or answer. Its
 * shell, where it has one, is a walled home of its own, closed to the repository.
 *
 * The session clock charges setup and author work. Only explicit gate settlement pauses its one
 * timer; background admission still consumes author time. Nested waits share one host interval,
 * and kill and budget signals remain independent. Typed abort reasons latch the first parent
 * source before the agent loop aborts an invocation. A draft's end records the accepted draft's
 * measurement independently of acceptance, beside elapsed and host seconds.
 */
import {
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { type Static, type TSchema, Type } from "typebox";
import { openingOf } from "../campaign/opening.ts";
import { endingWith, openingTool } from "../builder/tools.ts";
import { append, read } from "../kernel/log.ts";
import { examinerSessions } from "../kernel/solves.ts";
import { Cancellation } from "../kernel/solve.ts";
import { priceKey } from "../kernel/meter.ts";
import { billedAll } from "../kernel/trace.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { type SeatTool, sit } from "../agent/session.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { walledEnv } from "../tools/env.ts";
import { drafting, type Measurement } from "./draft.ts";
import { examinerShell, inExaminerWall, type Wall, type Walls } from "./shell.ts";
import { writing } from "./write.ts";

/** Who sits, whatever the mode: its name, its model, its limits and its log. */
interface Sitting {
  /** Names the session in the log; a task-writing session's prefixes the ids of its tasks. */
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: {
    /** Author time from setup, including a wall's claim, excluding blocked gate settlement. */
    readonly wallSeconds: number;
    /** The model's turns, each reply one, with or without a tool call. */
    readonly turns: number;
    /** What the session may put to the host: drafts, or instances to the gate. */
    readonly puts: number;
  };
  /** The backends, built on the home the Examiner's model process keeps its state in. */
  readonly models: (home: string, shutdown: AbortSignal) => Models;
  readonly log: string;
  /** Cancels the session; an unlabelled reason is recorded as caller cancellation. */
  readonly kill?: AbortSignal;
  /** Called once the session is on record, so a caller can let it run on beside other work. */
  readonly opened?: () => void;
}

/** What a session of each mode is handed beside who sits, as the mode's own file takes it. */
type DraftTerms = { readonly mode: "draft" } & Omit<Parameters<typeof drafting>[0], keyof Sitting>;
type WriteTerms = { readonly mode: "write" } & Omit<Parameters<typeof writing>[0], keyof Sitting>;

/** One Examiner session: who sits, and what its mode hands it. */
export type ExamRequest = Sitting & (DraftTerms | WriteTerms);

export interface Examined {
  /** How the session ended: with a draft that stands, by `finish`, with the tasks the host asked
   *  for, at a limit, or otherwise. */
  readonly ended: (typeof ENDINGS)[number] | "stopped";
  /** The drafts it put to the host, or the instances it put to the gate. */
  readonly puts: number;
  /** The versions of the tasks it held out, in the order it proposed them; none but in writing. */
  readonly held: readonly string[];
  /** The versions of the instances the gate refused. */
  readonly refused: readonly string[];
}

/** A session of one mode as a caller may stand in for it: `examine`, or a script with no model. */
export type Session<M extends ExamRequest["mode"]> = (
  request: Extract<ExamRequest, { readonly mode: M }>,
  wall?: Wall,
) => Promise<Examined>;

/** What a mode is: what a session of it is told, what it works with, and when its work is done.
 *  The loop reads nothing else of the mode (`examining`). */
interface Mode {
  /** The log's kind for the session's events: `exam.*` or `draft.*`. */
  readonly kind: "exam" | "draft";
  readonly system: string;
  readonly opening: string;
  /** What its start event holds beside the session, the model and the effort: its limits under
   *  the log's own words for them, and the mode's facts. */
  readonly started: JsonObject;
  /** Its own tools, before the shell's and `finish`. */
  readonly tools: readonly SeatTool[];
  /** How something of the session enters the exam, as its shell is told (`examinerShell`). */
  readonly enters: string;
  /** What a turn with no call is told the session can still do, before `finish`. */
  readonly nudge: string;
  /** What `finish` is described as. */
  readonly finish: string;
  /** What a first `finish` is answered with while the mode's work is not done; null where a first
   *  `finish` ends the session. */
  readonly declined: string | null;
  /** Whether the mode's work is done, which ends the session, and how that ending is named. */
  readonly done: () => "stands" | "supplied" | null;
  /** What the mode's work running beside the session has said since it was last told, read into
   *  each tool result; `last` where it is the turn's last call. */
  readonly heard: ((last: boolean) => string) | undefined;
  /** Waits for that work: all of it (`finish`, the end), or after a turn with no call its next word. */
  readonly settle: ((all: boolean) => Promise<void>) | undefined;
  /** What its end event holds of its work, under the log's own words. */
  readonly counted: () => JsonObject;
  readonly result: () => Omit<Examined, "ended">;
}

/** What one kind of session that puts a whole thing is told and puts (`putting`). */
interface Put<Parameters extends TSchema, Thing> {
  readonly kind: "draft";
  readonly system: string;
  /** Its opening message, before the sentence that tells its limits. */
  readonly opening: string;
  readonly started: JsonObject;
  /** The tool that puts the thing, and the thing the tool's arguments carry. */
  readonly put: Pick<ToolRegistration<Parameters>, "name" | "description" | "parameters">;
  readonly thing: (args: Static<Parameters>) => Thing;
  /** What the host says of the thing before anything runs, and then, of one whose shape holds,
   *  what the caller's reading says: one sentence a fault, none where it stands. */
  readonly unformed: (thing: Thing) => readonly string[];
  readonly reading: (thing: Thing) => Promise<readonly string[]>;
  /** Keeps the accepted draft and returns its matching measurement status. */
  readonly stood: (thing: Thing) => Measurement;
  /** What the session is told when one stands, before it is told that it ends. */
  readonly stands: string;
  /** What the host measured of a thing with no fault that it has not yet told the session of, which
   *  then does not stand until it is put again; null where it has, or where the measure was cut
   *  short, and the thing stands. Absent, a thing with no fault stands at once. */
  readonly measure?: ((thing: Thing, stop: AbortSignal) => Promise<string | null>) | undefined;
  readonly finish: string;
  /** The tools it reads with beside its shell. */
  readonly reads: readonly SeatTool[];
}

/** What `finish` leaves the loop: the note, and whether a first `finish` was declined. */
interface Said {
  note: string | null;
  declined: boolean;
}

/** What `read_opening` says it serves. */
const REREAD =
  "The session's opening message again, as it was sent: the record of the campaign's tasks and drafts it began with. Read it after your context was compacted.";

/** The first of these that holds names a session's ending; none, and it `stopped`. */
const ENDINGS = ["stands", "finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
/** The mode that puts one whole thing of `of`'s kind to the host until one stands: each put is
 *  one of the session's, read for its shape and then by the caller, and answered with the faults
 *  or with the session's end. */
function putting<Parameters extends TSchema, Thing>(
  { limits }: Sitting,
  of: Put<Parameters, Thing>,
  stop: AbortSignal,
): Mode {
  const { kind } = of;
  const desk: { tries: number; stands: boolean; measurement?: Measurement } = { tries: 0, stands: false };
  const none = `This session can put no further ${kind}. Call finish.`;
  const put = tool({
    ...of.put,
    executionMode: "sequential",
    execute: async (args, _api, context) => {
      const cancelled = new AbortController();
      const parent = () => cancelled.abort(stop.reason);
      const invocation = () => cancelled.abort(new Cancellation("invocation"));
      stop.addEventListener("abort", parent, { once: true });
      context.abortSignal?.addEventListener("abort", invocation, { once: true });
      if (stop.aborted) parent();
      else if (context.abortSignal?.aborted === true) invocation();
      try {
        if (desk.tries >= limits.puts) throw new Error(none);
        desk.tries += 1;
        const thing = of.thing(args);
        const unformed = of.unformed(thing);
        const faults = unformed.length > 0 ? unformed : await of.reading(thing);
        const left = limits.puts - desk.tries;
        // The last put stands without a measure, so a session told one always has a put to answer it.
        const told =
          faults.length > 0 || left === 0 ? null : ((await of.measure?.(thing, cancelled.signal)) ?? null);
        if (told !== null) return text(`${told}\nThis session can put ${plural(left, `more ${kind}`)}.`);
        if (faults.length === 0) {
          desk.measurement = of.stood(thing);
          desk.stands = true;
          return ending(text(`${of.stands} The session ends here.`));
        }
        return text(
          [
            `The ${kind} does not stand. ${plural(faults.length, "fault")}:`,
            ...faults.map((fault) => `- ${fault}`),
            left > 0
              ? `Mend them and put the whole ${kind} again. This session can put ${plural(left, `more ${kind}`)}.`
              : none,
          ].join("\n"),
        );
      } finally {
        stop.removeEventListener("abort", parent);
        context.abortSignal?.removeEventListener("abort", invocation);
      }
    },
  });
  return {
    kind,
    system: of.system,
    opening: `${of.opening}\n\nThis session has ${plural(Math.round(limits.wallSeconds / 60), "minute")}, ${plural(limits.turns, "turn")} and ${plural(limits.puts, kind)}.`,
    started: {
      limits: { wallSeconds: limits.wallSeconds, turns: limits.turns, tries: limits.puts },
      ...of.started,
    },
    tools: [put, ...of.reads],
    enters: `a ${kind} enters it through ${of.put.name} alone`,
    nudge: `Put a ${kind} with ${of.put.name}`,
    finish: of.finish,
    declined: null,
    done: () => (desk.stands ? "stands" : null),
    heard: undefined,
    settle: undefined,
    counted: () => ({ ...desk }),
    result: () => ({ puts: desk.tries, held: [], refused: [] }),
  };
}

/**
 * The campaign's whole budget, read before each request and each compaction, which bills too:
 * where it holds no reserve for one more, `spent` is aborted and the
 * request is refused. The log's sum counts this session's own turns while it is unfinished
 * (`billedAll`), so a session inside a live Builder's conversation is held as the Builder is. A log
 * with no opening, or an opening with no budget, holds nothing.
 */
function withinBudget(log: string, spent: AbortController): void {
  const events = read(log);
  const budget = openingOf(events)?.budget;
  if (budget === null || budget === undefined) return;
  if (budget.dollars - billedAll(events) >= budget.reserve) return;
  spent.abort(new Cancellation("campaign-budget"));
  throw new Error("the campaign budget has no reserve left");
}

/** The session's `finish`: the work still running is waited for and told first, so that the
 *  session's end reads it, and a first `finish` is declined once where the mode declines one and
 *  its work is not done. */
function finishTool(mode: Mode, said: Said, told: (last: boolean, line: string) => string): SeatTool {
  return tool({
    name: "finish",
    description: mode.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (args) => {
      await mode.settle?.(true);
      if (mode.declined !== null && !said.declined && mode.done() === null) {
        said.declined = true;
        return text(told(true, mode.declined));
      }
      said.note = args.note.trim();
      return ending(text(told(true, "Finished.")));
    },
  });
}

/** One author timer, paused only while host settlement is awaited. Overlapping waits share one
 *  interval; the last finally resumes the remaining allowance, unless the owner has closed it. */
function sessionClock(began: number, seconds: number) {
  const wall = new AbortController();
  let aside = 0;
  let since = 0;
  let depth = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hostMilliseconds = () => aside + (depth === 0 ? 0 : performance.now() - since);
  const ownSeconds = () => (performance.now() - began - hostMilliseconds()) / 1000;
  const arm = () => {
    clearTimeout(timer);
    if (closed || wall.signal.aborted) return;
    timer = setTimeout(
      () => wall.abort(new Cancellation("session-wall")),
      Math.max(0, (seconds - ownSeconds()) * 1000),
    );
  };
  arm();
  return {
    signal: wall.signal,
    seconds: ownSeconds,
    hostSeconds: () => hostMilliseconds() / 1000,
    within: async (action: () => Promise<void>) => {
      if (depth === 0) {
        if (ownSeconds() >= seconds) wall.abort(new Cancellation("session-wall"));
        clearTimeout(timer);
        since = performance.now();
      }
      depth += 1;
      try {
        await action();
      } finally {
        depth -= 1;
        if (depth === 0) {
          aside += performance.now() - since;
          arm();
        }
      }
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
    },
  };
}

/**
 * One session of `mode`: the Examiner works with the mode's tools until its work is done, it calls
 * `finish`, or a limit ends it. Everything it does is in the log under the mode's kind: its start,
 * its turns and calls, and its end with what it billed and, for a crash, how many of its commands
 * were running, which decides whether its home is carried on (`inExaminerWall`).
 */
async function examining(
  request: Sitting,
  modeOf: (stop: AbortSignal, hostWait: (action: () => Promise<void>) => Promise<void>) => Mode,
  walls: Walls | undefined,
): Promise<Examined> {
  const began = walls?.began ?? performance.now();
  const clock = sessionClock(began, request.limits.wallSeconds);
  const { log, limits, model, id } = request;
  const caller = new AbortController();
  const cancel = () => {
    const reason: unknown = request.kill?.reason;
    caller.abort(reason instanceof Cancellation ? reason : new Cancellation("caller"));
  };
  request.kill?.addEventListener("abort", cancel, { once: true });
  if (request.kill?.aborted === true) cancel();
  try {
    const spent = new AbortController();
    const stops = [clock.signal, spent.signal, caller.signal];
    const mode = modeOf(AbortSignal.any(stops), clock.within);
    append(log, `${mode.kind}.started`, {
      session: id,
      model: priceKey(model),
      effort: request.effort,
      ...mode.started,
    });
    request.opened?.();
    const said: Said = { note: null, declined: false };
    // Every tool result ends with what the mode heard since, then its own line.
    const told = (last: boolean, line: string) =>
      [mode.heard?.(last) ?? "", line].filter((part) => part !== "").join("\n\n");
    const turns: AssistantMessage[] = [];
    // The current turn's last call, whose result says what the session has used: told its limits at the
    // opening alone, two of eleven sessions on 14 October were cut at their wall while still proposing.
    let lastCall: string | undefined;
    const used = (call: string) => {
      const minutes = `${String(Math.floor(clock.seconds() / 60))} of ${plural(Math.round(limits.wallSeconds / 60), "minute")}`;
      const line = `Turn ${String(turns.length)} of ${String(limits.turns)}; ${minutes} used.`;
      return call === lastCall ? told(true, line) : told(false, "");
    };
    const shell = await examinerShell(walls?.shell, mode.enters);
    const tools = [
      ...[...mode.tools, ...shell, openingTool(mode.opening, REREAD)].map((each) => endingWith(each, used)),
      finishTool(mode, said, told),
    ];
    let running = 0;
    const sat = await sit({
      models: request.models,
      id,
      model,
      effort: request.effort,
      system: mode.system,
      opening: mode.opening,
      tools,
      ...keyIfDefined("env", walls === undefined ? undefined : walledEnv(walls.shell)),
      trace: { log, of: mode.kind },
      before: () => withinBudget(log, spent),
      turns,
      most: limits.turns,
      // The session ends at `finish` and when its work is done, even beside another call in the turn.
      over: () => said.note !== null || mode.done() !== null,
      next: async () => {
        await mode.settle?.(false);
        return said.note !== null || mode.done() !== null
          ? null
          : told(true, `You have not called finish. ${mode.nudge}, or call finish.`);
      },
      onTurn: (message) => {
        lastCall = message.content
          .flatMap((part) =>
            part.type === "toolCall" && tools.some(({ name }) => name === part.name) ? [part.id] : [],
          )
          .at(-1);
      },
      onTool: (phase) => {
        running += phase === "start" ? 1 : -1;
      },
      // A crash leaves the gate under its wall, kill and budget, just as finish does (21 October).
      settle: async () => mode.settle?.(true),
      stops,
    });
    const work = mode.done();
    const by = {
      stands: work === "stands",
      finished: said.note !== null,
      supplied: work === "supplied",
      killed: request.kill?.aborted === true,
      wall: clock.signal.aborted,
      crashed: sat.crash !== null,
      turns: turns.length >= limits.turns,
    };
    const ended = ENDINGS.find((reason) => by[reason]) ?? "stopped";
    append(log, `${mode.kind}.finished`, {
      session: id,
      ended,
      note: said.note,
      ...mode.counted(),
      crash: sat.crash,
      ...keyIfDefined("running", ended === "crashed" ? running : undefined),
      ...sat.spent,
      seconds: (performance.now() - began) / 1000,
      hostSeconds: clock.hostSeconds(),
    });
    return { ended, ...mode.result() };
  } finally {
    clock.close();
    request.kill?.removeEventListener("abort", cancel);
  }
}

/**
 * One Examiner session in the mode its request names. With a `wall` it has a shell under the
 * solver's command wall (`shell.ts`), and its time is counted from before its root is claimed;
 * without one it has no shell and computes nothing. A drafting session is given no engines, no kept
 * home and no reference harness: nothing is drafted yet that names one. A run killed before the
 * session began, and an id a session of the log already took, claim nothing and start nothing.
 */
export async function examine(request: ExamRequest, wall?: Wall): Promise<Examined> {
  if (request.kill?.aborted === true) throw new Error(`session ${request.id} was stopped before it began`);
  if (examinerSessions(read(request.log)).has(request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const reference = wall?.reference === undefined ? "unseen" : "in-home";
  const seated = async (walls?: Walls) =>
    await examining(
      request,
      (stop, hostWait) =>
        request.mode === "draft"
          ? putting(request, drafting(request), stop)
          : writing(request, walls?.pinned ?? [], reference, stop, hostWait),
      walls,
    );
  if (wall === undefined) return await seated();
  const walled =
    request.mode === "draft" ? { ...wall, engines: undefined, keep: undefined, reference: undefined } : wall;
  return await inExaminerWall(request, walled, seated);
}

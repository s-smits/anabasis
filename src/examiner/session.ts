/**
 * The Examiner's one session, in its two modes: it drafts an exam (`draft.ts`), or it writes tasks
 * (`write.ts`). Until 13 October a third mode repaired a check; no campaign opened one, and no seat
 * repairs a check (`AGENTS.md` rule 2). A log of before keeps its `repair.*` events.
 *
 * A mode is what a session is told, the tools it works with and when its work is done (`Mode`);
 * everything else is one loop (`sit`): the id it claims, its start event, its wall, its `finish`,
 * its shell where it has one (`shell.ts`), the turns and calls in the log under the mode's kind,
 * and its end event with what it billed. A turn of its own the provider failed ends it crashed,
 * with what the provider said. A drafting session puts one whole draft to the host's reading until
 * one stands (`putting`); a writing session proposes many tasks.
 *
 * What the Examiner is never given, in any mode: a harness, a solver's trace or answer. Its
 * shell, where it has one, is a walled home of its own, closed to the repository.
 */
import type { AgentTool, PrepareRequest } from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  type Usage,
} from "@earendil-works/pi-ai";
import { type Static, type TSchema, Type } from "typebox";
import { openingOf } from "../builder/opening.ts";
import { endingWith, openingTool } from "../builder/tools.ts";
import { append, read } from "../kernel/log.ts";
import { examinerSessions } from "../kernel/solves.ts";
import { priceKey } from "../kernel/meter.ts";
import { billedAll } from "../kernel/reports.ts";
import { rmSync } from "../meta/filesystem.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { text, tool } from "../solve/answer.ts";
import { failedTurn, seatLoop, spentBy, traceSink, userTurn } from "../solve/seat.ts";
import { hostScratch } from "../verify/wall-policy.ts";
import { drafting } from "./draft.ts";
import { examinerShell, inExaminerWall, type Wall, type Walls } from "./shell.ts";
import { writing } from "./write.ts";

/** Who sits, whatever the mode: its name, its model, its limits and its log. */
interface Sitting {
  /** Names the session in the log; a task-writing session's prefixes the ids of its tasks. */
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: {
    /** Counted from when the seat began to be set up, so a wall's claim is inside it. */
    readonly wallSeconds: number;
    /** The model's turns, each reply one, with or without a tool call. */
    readonly turns: number;
    /** What the session may put to the host: drafts, or instances to the gate. */
    readonly puts: number;
  };
  /** The backends, built on the home the Examiner's model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly log: string;
  /** Aborts when the run is killed. */
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
 *  The loop reads nothing else of the mode (`sit`). */
interface Mode {
  /** The log's kind for the session's events: `exam.*` or `draft.*`. */
  readonly kind: "exam" | "draft";
  readonly system: string;
  readonly opening: string;
  /** What its start event holds beside the session, the model and the effort: its limits under
   *  the log's own words for them, and the mode's facts. */
  readonly started: JsonObject;
  /** Its own tools, before the shell's and `finish`. */
  readonly tools: readonly AgentTool[];
  /** How its shell is described (`examinerShell`): how something enters the exam, what the home
   *  holds at its start, and through which tool the host runs the checks. */
  readonly enters: string;
  readonly home: string | undefined;
  readonly checked: string | undefined;
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
  /** What is laid in the shell's home before the session, and what is kept of it after. */
  readonly enter: ((home: string) => void) | undefined;
  /** `running` is how many of its commands were running as the session ended. */
  readonly leave: ((home: string, ended: Examined["ended"], running: number) => void) | undefined;
}

/** What one kind of session that puts a whole thing is told and puts (`putting`). */
interface Put<Parameters extends TSchema, Thing> {
  readonly kind: "draft";
  readonly system: string;
  /** Its opening message, before the sentence that tells its limits. */
  readonly opening: string;
  readonly started: JsonObject;
  /** The tool that puts the thing, and the thing the tool's arguments carry. */
  readonly put: Pick<AgentTool<Parameters>, "name" | "label" | "description" | "parameters">;
  readonly thing: (args: Static<Parameters>) => Thing;
  /** What the host says of the thing before anything runs, and then, of one whose shape holds,
   *  what the caller's reading says: one sentence a fault, none where it stands. */
  readonly unformed: (thing: Thing) => readonly string[];
  readonly reading: (thing: Thing) => Promise<readonly string[]>;
  /** What the host keeps of the thing that stood, before the session ends. */
  readonly stood: (thing: Thing) => void;
  /** What the session is told when one stands, before it is told that it ends. */
  readonly stands: string;
  /** What the host measured of a thing with no fault that it has not yet told the session of, which
   *  then does not stand until it is put again; null where it has, or where the measure was cut
   *  short, and the thing stands. Absent, a thing with no fault stands at once. */
  readonly measure?: ((thing: Thing, stop: AbortSignal) => Promise<string | null>) | undefined;
  readonly finish: string;
  /** The tools it reads with beside its shell. */
  readonly reads: readonly AgentTool[];
  readonly home?: string;
  readonly checked?: string;
  readonly enter?: (home: string) => void;
}

/** What `finish` leaves the loop: the note, and whether a first `finish` was declined. */
interface Said {
  note: string | null;
  declined: boolean;
}

/** The first of these that holds names a session's ending; none, and it `stopped`. */
const ENDINGS = ["stands", "finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
/** The mode that puts one whole thing of `of`'s kind to the host until one stands: each put is
 *  one of the session's, read for its shape and then by the caller, and answered with the faults
 *  or with the session's end. */
function putting<Parameters extends TSchema, Thing>({ limits }: Sitting, of: Put<Parameters, Thing>): Mode {
  const { kind } = of;
  const desk = { tries: 0, stands: false };
  const none = `This session can put no further ${kind}. Call finish.`;
  const put = tool({
    ...of.put,
    executionMode: "sequential",
    execute: async (_id, args, signal = new AbortController().signal) => {
      if (desk.tries >= limits.puts) throw new Error(none);
      desk.tries += 1;
      const thing = of.thing(args);
      const unformed = of.unformed(thing);
      const faults = unformed.length > 0 ? unformed : await of.reading(thing);
      const left = limits.puts - desk.tries;
      // The last put stands without a measure, so a session told one always has a put to answer it.
      const told = faults.length > 0 || left === 0 ? null : ((await of.measure?.(thing, signal)) ?? null);
      if (told !== null) return text(`${told}\nThis session can put ${plural(left, `more ${kind}`)}.`);
      if (faults.length === 0) {
        of.stood(thing);
        desk.stands = true;
        return { ...text(`${of.stands} The session ends here.`), terminate: true };
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
    home: of.home,
    checked: of.checked,
    nudge: `Put a ${kind} with ${of.put.name}`,
    finish: of.finish,
    declined: null,
    done: () => (desk.stands ? "stands" : null),
    heard: undefined,
    settle: undefined,
    counted: () => ({ ...desk }),
    result: () => ({ puts: desk.tries, held: [], refused: [] }),
    enter: of.enter,
    leave: undefined,
  };
}

/**
 * `compact` held to the campaign's whole budget, which is read before each request and again after
 * a compaction, which bills too: where it holds no reserve for one more, `spent` is aborted and the
 * request is refused. The log's sum counts this session's own turns while it is unfinished
 * (`billedAll`), so a session inside a live Builder's conversation is held as the Builder is. A log
 * with no opening, or an opening with no budget, holds nothing.
 */
function withinBudget(log: string, spent: AbortController, compact: PrepareRequest): PrepareRequest {
  const afforded = () => {
    const events = read(log);
    const budget = openingOf(events)?.budget;
    if (budget === null || budget === undefined) return;
    if (budget.dollars - billedAll(events) >= budget.reserve) return;
    spent.abort();
    throw new Error("the campaign budget has no reserve left");
  };
  return async (context, cut) => {
    afforded();
    const update = await compact(context, cut);
    afforded();
    return update ?? undefined;
  };
}

/** The session's `finish`, with what it leaves the loop (`said`) and how every tool result of the
 *  session ends (`told`): what the mode heard since, then the line. The work still running is waited
 *  for and told first, so that the session's end reads it, and a first `finish` is declined once
 *  where the mode declines one and its work is not done. */
function finishing(mode: Mode) {
  const said: Said = { note: null, declined: false };
  const told = (last: boolean, line: string) =>
    [mode.heard?.(last) ?? "", line].filter((part) => part !== "").join("\n\n");
  const finish = tool({
    name: "finish",
    label: "Finish",
    description: mode.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      await mode.settle?.(true);
      if (mode.declined !== null && !said.declined && mode.done() === null) {
        said.declined = true;
        return text(told(true, mode.declined));
      }
      said.note = args.note.trim();
      return { ...text(told(true, "Finished.")), terminate: true };
    },
  });
  return { said, told, finish };
}

/**
 * One session of `mode`: the Examiner works with the mode's tools until its work is done, it calls
 * `finish`, or a limit ends it. Everything it does is in the log under the mode's kind: its start,
 * its turns and calls, and its end with what it billed.
 */
async function sit(request: Sitting, mode: Mode, walls: Walls | undefined): Promise<Examined> {
  const { log, limits, model, id } = request;
  const { kind } = mode;
  const began = walls?.began ?? performance.now();
  const home = walls?.shell.dirs.home;
  if (home !== undefined) mode.enter?.(home);
  append(log, `${kind}.started`, {
    session: id,
    model: priceKey(model),
    effort: request.effort,
    ...mode.started,
  });
  request.opened?.();
  const { said, told, finish } = finishing(mode);
  const shell = await examinerShell(walls?.shell, mode.enters, mode.home, mode.checked);
  // The model's turns so far, each pushed once its tool results are in (`finishTurn`).
  const turns: AssistantMessage[] = [];
  // The ids of the current turn's calls. The result of its last says what the session has used, once
  // a turn: the limits were told at the opening alone, and on the six logs read on 14 October two of
  // eleven sessions were cut at their wall while still proposing, one in a command of 207 s.
  let calls: string[] = [];
  const used = (call: string) => {
    const last = call === calls.at(-1);
    const turn = last
      ? `Turn ${String(turns.length + 1)} of ${String(limits.turns)}; ${String(Math.floor((performance.now() - began) / 60_000))} of ${plural(Math.round(limits.wallSeconds / 60), "minute")} used.`
      : "";
    return told(last, turn);
  };
  const reread = openingTool(
    mode.opening,
    "The session's opening message again, as it was sent: the record of the campaign's tasks and drafts it began with. Read it after your context was compacted.",
  );
  const tools = [...[...mode.tools, ...shell, reread].map((each) => endingWith(each, used)), finish];
  // The wall runs from the seat's start (`began`), so the claim, the wall's own probe and the
  // shell's network probe, awaited above, are inside the session's limit.
  const wall = new AbortController();
  const timer = setTimeout(
    () => wall.abort(),
    Math.max(0, limits.wallSeconds * 1000 - (performance.now() - began)),
  );
  // `done` closes the model after its gate settles; `spent` stops both when no reserve remains.
  const [done, spent] = [new AbortController(), new AbortController()];
  const kill = request.kill ? [request.kill] : [];
  const signal = AbortSignal.any([wall.signal, done.signal, spent.signal, ...kill]);
  const summaries: Usage[] = [];
  // The session ends at `finish` and when its work is done, even beside another call in the turn.
  const over = () => said.note !== null || mode.done() !== null;
  // Under the host's own scratch, which every wall closes (`wall-policy.ts`): the Examiner's
  // Claude Code keeps its session here, the checks and hidden values it wrote or read included.
  const state = hostScratch("claude-cli-examiner-");
  let crash: string | null = null;
  // The commands running as the session ends: a crash in a model request leaves the home as its
  // last command left it, and one in a command does not (`leave`).
  let running = 0;
  const trace = traceSink(log, kind, id, () => turns.length);
  try {
    await seatLoop({
      models: request.models(state),
      id,
      system: mode.system,
      opening: mode.opening,
      tools,
      config: {
        model,
        reasoning: request.effort,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return over() || turns.length >= limits.turns ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => {
          await mode.settle?.(false);
          return over()
            ? []
            : [userTurn(told(true, `You have not called finish. ${mode.nudge}, or call finish.`))];
        },
      },
      compact: { log, of: kind, summaries, guard: (compact) => withinBudget(log, spent, compact) },
      emit: (event) => {
        if (event.type === "message_end" && event.message.role === "assistant") {
          calls = event.message.content.flatMap((part) =>
            part.type === "toolCall" && tools.some(({ name }) => name === part.name) ? [part.id] : [],
          );
        }
        if (event.type === "tool_execution_start") running += 1;
        if (event.type === "tool_execution_end") running -= 1;
        trace(event);
      },
      signal,
    });
  } catch (error) {
    if (!spent.signal.aborted) crash = errorMessage(error);
  } finally {
    try {
      // A crash leaves the gate under its wall, kill and budget, just as finish does (21 October).
      await mode.settle?.(true);
    } finally {
      clearTimeout(timer);
      done.abort();
      rmSync(state, { recursive: true, force: true });
    }
  }
  const killed = request.kill?.aborted === true;
  crash ??= wall.signal.aborted || killed || spent.signal.aborted ? null : failedTurn(turns);
  const work = mode.done();
  const by = {
    stands: work === "stands",
    finished: said.note !== null,
    supplied: work === "supplied",
    killed,
    wall: wall.signal.aborted,
    crashed: crash !== null,
    turns: turns.length >= limits.turns,
  };
  const ended = ENDINGS.find((reason) => by[reason]) ?? "stopped";
  append(log, `${kind}.finished`, {
    session: id,
    ended,
    note: said.note,
    ...mode.counted(),
    crash,
    ...keyIfDefined("running", ended === "crashed" ? running : undefined),
    ...(await spentBy(model, id, turns, summaries)),
    seconds: (performance.now() - began) / 1000,
  });
  if (home !== undefined) mode.leave?.(home, ended, running);
  return { ended, ...mode.result() };
}

/**
 * One Examiner session in the mode its request names. With a `wall` it has a shell under the
 * solver's command wall (`shell.ts`), with the engines its campaign's checks run where the wall
 * names them, and its time is counted from before its root is claimed; without one it has no shell
 * and computes nothing. A run killed before the session began, and an id a drafting or writing
 * session of the log already took, claim nothing and start nothing.
 */
export async function examine(request: ExamRequest, wall?: Wall): Promise<Examined> {
  if (request.kill?.aborted === true) throw new Error(`session ${request.id} was stopped before it began`);
  if (examinerSessions(read(request.log)).has(request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const seated = (walls: Walls | undefined) => {
    const pinned = walls?.pinned ?? [];
    switch (request.mode) {
      case "draft":
        return sit(request, putting(request, drafting(request)), walls);
      case "write":
        return sit(request, writing(request, pinned, wall?.keep, wall?.reference), walls);
    }
  };
  if (wall === undefined) return await seated(undefined);
  const engines = request.mode === "draft" ? undefined : wall.engines;
  return await inExaminerWall(request, { ...wall, engines }, seated);
}

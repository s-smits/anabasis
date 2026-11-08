/**
 * The Examiner's one session, in its two modes: it drafts an exam (`draft.ts`), or it writes tasks
 * (`write.ts`). No seat repairs a check (`AGENTS.md` rule 2).
 *
 * A mode is what a session is told, the tools it works with and when its work is done (`Mode`);
 * everything else is one loop (`examining`) in the frame every seat's session has (`sit`,
 * `src/agent/session.ts`): its start event, its `finish`, its shell where it has one, the model turns and
 * calls in the log under the mode's kind, and its end event with what it billed. A
 * turn of its own the provider failed ends it crashed, with what the provider said. A drafting
 * session puts one whole draft to the host's reading until one stands (`drafting`); a writing
 * session proposes many tasks. The id, the root and the home are the wall's (`inExaminerWall`,
 * `shell.ts`), which seeds a writing session's home and carries it on.
 *
 * A writing session receives a copy of the reference harness in its home (`shell.ts`). Neither
 * mode receives a solver's trace or answer. Its shell is a walled home, closed to the repository.
 *
 * The session clock charges setup and every turn and tool call except a drafting session's wait for
 * the host's reading of a draft, which is the verifier's time (`drafting`), and kill
 * and budget signals stay independent of it. Typed abort reasons latch the first parent source
 * before the agent loop aborts an invocation. Until 1 November the clock paused while the session
 * waited on its gate's room solves, a tool result told what that gate had said since, and `finish`
 * and the session's end waited for it; no solve runs at the gate now (`write.ts`).
 */
import type { Api, AssistantMessage, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type SeatTool, sessionClock, sit } from "../agent/session.ts";
import { endingWith, openingTool } from "../builder/tools.ts";
import { budgetLeft } from "../campaign/opening.ts";
import { append, read } from "../kernel/log.ts";
import { priceKey } from "../kernel/meter.ts";
import { Cancellation } from "../kernel/solve.ts";
import { examinerSessions } from "../kernel/solves.ts";
import { unfinished } from "../kernel/trace.ts";
import { boundText } from "../meta/bounded-text.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { walledEnv } from "../tools/env.ts";
import { drafting } from "./draft.ts";
import { examinerShell, inExaminerWall, layReference, type Wall, type Walls } from "./shell.ts";
import { writing } from "./write.ts";

type Clock = ReturnType<typeof sessionClock>;

/** Who sits, whatever the mode: its name, its model, its limits and its log. */
interface Sitting {
  /** Names the session in the log; a task-writing session's prefixes the ids of its tasks. */
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: {
    /** Author time from setup, including a wall's claim. */
    readonly wallSeconds: number;
    /** The model turn limit, each reply one, with or without a tool call. */
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
  /** Handed a writing session's result where its work is done: the next ask of the conversation,
   *  or null to end it (`examining`). None, and the session ends there. */
  readonly rest?: ((examined: Examined) => Promise<Ask | null>) | undefined;
}

/** The next ask of a resting conversation, as the examine command built it. */
export interface Ask {
  readonly request: Extract<ExamRequest, { readonly mode: "write" }>;
  readonly wall?: Wall | undefined;
}

/** An ask's end at its rest: what the next ask is told, or null where the conversation ends. */
type Rest = (ended: "finished" | "supplied") => Promise<string | null>;

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
  /** What `finish` is answered with while the mode's work is not done; null where `finish` ends the
   *  session. */
  readonly declined: string | null;
  /** Whether the mode's work is done, which ends the session, and how that ending is named. */
  readonly done: () => "stands" | "supplied" | null;
  /** What its end event holds of its work, under the log's own words. */
  readonly counted: () => JsonObject;
  readonly result: () => Omit<Examined, "ended">;
  /** Takes in the next ask and says what it is told. */
  readonly ask?: (next: Ask["request"]) => string;
}

/** What `finish` leaves the loop: the note, and what the mode had counted at the last declined one. */
interface Said {
  note: string | null;
  declined: string | null;
}

/** What `read_opening` says it serves. */
const REREAD =
  "The session's opening message as it read when the host last asked: the record of the campaign's tasks and the limits of that ask. Read it after your context was compacted.";

/** The first of these that holds names a session's ending; none, and it `stopped`. */
const ENDINGS = ["stands", "finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
/**
 * Whether the campaign's whole budget holds a reserve for one more, read before each request and
 * each compaction, which bills too: where it does not, `spent` is aborted, which ends the session.
 * The log's sum counts this
 * session's own turns while it is unfinished (`billedAll`), so a session inside a live Builder's
 * conversation is held as the Builder is. A log with no opening, or an opening with no budget,
 * holds nothing.
 */
function withinBudget(log: string, spent: AbortController): boolean {
  const left = budgetLeft(read(log));
  if (left === null || left.dollars >= left.reserve) return true;
  spent.abort(new Cancellation("campaign-budget"));
  return false;
}

/** The session's `finish`: declined where the mode declines one, its work is not
 *  done and its count moved since the last decline. Until 28 October only a first `finish` was:
 *  round 11's GPT arm proposed three more drafts after it and ended at its second, at 9 of 36
 *  drafts and 35 of 240 minutes; two in a row still end a session that has nothing left. A note
 *  is kept to its first 700 bytes, as a Referee's reason is: until 28 October a longer one was
 *  refused, 23 times in 417 calls, each a turn spent rewriting it. */
function finishTool(mode: Mode, said: Said, rest: Rest): SeatTool {
  return tool({
    name: "finish",
    description: mode.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1 }) }),
    execute: async (args) => {
      const counted = capturedJsonStringify(mode.counted());
      if (mode.declined !== null && said.declined !== counted && mode.done() === null) {
        said.declined = counted;
        return text(mode.declined);
      }
      said.note = boundText(args.note, 700).shown;
      const woken = await rest("finished");
      return woken === null ? ending(text("Finished.")) : text(woken);
    },
  });
}

/**
 * One session of `mode`: the Examiner works with the mode's tools until its work is done, it calls
 * `finish`, or a limit ends it. Everything it does is in the log under the mode's kind: its start,
 * its turns and calls, and its end with what it billed and, for a crash, how many of its commands
 * were running, which decides whether its home is carried on (`inExaminerWall`).
 *
 * Given `rest`, a writing session is one ask of a conversation (5 November): its done work or
 * accepted `finish` ends the ask on record and the call waits, off any clock, for the next ask, with
 * its own id, events, clock and turns, and is told the readings since (`ask`, `write.ts`).
 */
async function examining(
  request: Sitting,
  modeOf: (stop: AbortSignal, within: Clock["within"], rest: Rest) => Mode,
  walls: Walls | undefined,
): Promise<Examined> {
  let began = walls?.began ?? performance.now();
  const spent = new AbortController();
  // The ask in force, the turns and dollars before it, and its own clock, which a rest closes.
  let current: Sitting = request;
  let [from, billed] = [0, 0];
  const timed = new AbortController();
  const clocked = () => {
    const own = sessionClock(began, current.limits.wallSeconds);
    own.signal.addEventListener("abort", () => timed.abort(own.signal.reason));
    return own;
  };
  let clock = clocked();
  const { log, model } = request;
  const caller = new AbortController();
  const cancel = () => {
    const reason: unknown = request.kill?.reason;
    caller.abort(reason instanceof Cancellation ? reason : new Cancellation("caller"));
  };
  request.kill?.addEventListener("abort", cancel, { once: true });
  if (request.kill?.aborted === true) cancel();
  try {
    const stops = [timed.signal, spent.signal, caller.signal];
    const said: Said = { note: null, declined: null };
    const turns: AssistantMessage[] = [];
    const closeAsk = (ended: Examined["ended"], spend: JsonObject): Examined => {
      append(log, `${mode.kind}.finished`, {
        session: current.id,
        ended,
        note: said.note,
        ...mode.counted(),
        ...spend,
        seconds: (performance.now() - began) / 1000,
      });
      return { ended, ...mode.result() };
    };
    const start = () =>
      append(log, `${mode.kind}.started`, {
        session: current.id,
        ...keyIfDefined("conversation", current === request ? undefined : request.id),
        model: priceKey(model),
        effort: request.effort,
        ...mode.started,
      });
    // An ask that ended at a rest the host closed: nothing more goes on record.
    let rested: Examined | null = null;
    const rest: Rest = async (ended) => {
      const asking = mode.ask;
      if (request.rest === undefined || asking === undefined) return null;
      clock.close();
      const dollars =
        unfinished(read(log)).find(({ of, id }) => of === mode.kind && id === current.id)?.dollars ?? 0;
      billed += dollars;
      const result = closeAsk(ended, { crash: null, turns: turns.length - from, billed: dollars });
      // An ask's home is kept at its rest, as a session's was at its end before one conversation
      // held every ask: the conversation's wall closes only when the conversation does.
      walls?.keep();
      const closed = AbortSignal.any([spent.signal, caller.signal]);
      const next = await Promise.race([
        request.rest(result),
        new Promise<null>((resolve) => {
          closed.addEventListener("abort", () => resolve(null), { once: true });
        }),
      ]);
      if (next === null || closed.aborted) {
        rested = result;
        return null;
      }
      // A promotion while the conversation rested changed the reference its home holds.
      const laid = next.wall?.reference;
      if (laid !== undefined && walls !== undefined) layReference(laid, walls.shell.dirs.home);
      [current, from, began] = [next.request, turns.length, performance.now()];
      Object.assign(said, { note: null, declined: null });
      clock = clocked();
      const woken = asking(next.request);
      start();
      next.request.opened?.();
      return woken;
    };
    // The ask's clock in force, whichever ask a call runs in.
    const mode = modeOf(AbortSignal.any(stops), async (action) => await clock.within(action), rest);
    start();
    request.opened?.();
    // The current turn's last call, whose result says what the session has used: told its limits at the
    // opening alone, two of eleven sessions on 14 October were cut at their deadline while still proposing.
    let lastCall: string | undefined;
    const used = (call: string) => {
      const minutes = `${String(Math.floor(clock.seconds() / 60))} of ${plural(Math.round(current.limits.wallSeconds / 60), "minute")}`;
      const line = `Turn ${String(turns.length - from)} of ${String(current.limits.turns)}; ${minutes} used.`;
      return call === lastCall ? line : "";
    };
    const shell = await examinerShell(walls?.shell, mode.enters);
    const tools = [
      ...[...mode.tools, ...shell, openingTool(() => mode.opening, REREAD)].map((each) =>
        endingWith(each, used),
      ),
      finishTool(mode, said, rest),
    ];
    let running = 0;
    const sat = await sit({
      models: request.models,
      id: request.id,
      model,
      effort: request.effort,
      system: mode.system,
      opening: mode.opening,
      tools,
      ...keyIfDefined("env", walls === undefined ? undefined : walledEnv(walls.shell)),
      trace: { log, of: mode.kind, as: () => current.id },
      before: () => {
        if (!withinBudget(log, spent)) throw new Error("the campaign budget has no reserve left");
      },
      turns,
      // The session ends at `finish` and when its work is done, even beside another call in the turn.
      over: () => said.note !== null || mode.done() !== null || turns.length - from >= current.limits.turns,
      next: async () =>
        said.note !== null || mode.done() !== null
          ? null
          : `You have not called finish. ${mode.nudge}, or call finish.`,
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
      stops,
    });
    if (rested !== null) return rested;
    const work = mode.done();
    const by = {
      stands: work === "stands",
      finished: said.note !== null,
      supplied: work === "supplied",
      killed: request.kill?.aborted === true,
      wall: clock.signal.aborted,
      crashed: sat.crash !== null,
      turns: turns.length - from >= current.limits.turns,
    };
    const ended = ENDINGS.find((reason) => by[reason]) ?? "stopped";
    // A later ask bills the conversation's bill beyond the asks before it, and no backend total.
    return closeAsk(ended, {
      crash: sat.crash,
      ...keyIfDefined("running", ended === "crashed" ? running : undefined),
      ...sat.spent,
      turns: turns.length - from,
      billed: Math.max(0, sat.spent.billed - billed),
      reportedCost: from === 0 ? sat.spent.reportedCost : null,
    });
  } finally {
    clock.close();
    request.kill?.removeEventListener("abort", cancel);
  }
}

/**
 * One Examiner session in the mode its request names. With a `wall` it has a shell under the
 * solver's command wall (`shell.ts`), and its time is counted from before its root is claimed;
 * without one it has no shell and computes nothing. A drafting session is given no engines and no
 * reference harness, since nothing is drafted yet that names one, and its home is kept for the first
 * writing session (5 November). A run killed before the
 * session began, and an id a session of the log already took, claim nothing and start nothing.
 */
export async function examine(request: ExamRequest, wall?: Wall): Promise<Examined> {
  if (request.kill?.aborted === true) throw new Error(`session ${request.id} was stopped before it began`);
  if (examinerSessions(read(request.log)).has(request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const reference = wall?.reference === undefined ? "unseen" : "in-home";
  const seated = async (walls?: Walls) =>
    examining(
      request,
      (stop, within, resting) =>
        request.mode === "draft"
          ? drafting(request, within)
          : writing(request, walls, reference, { stop, within, rest: resting }),
      walls,
    );
  if (wall === undefined) return await seated();
  const walled = request.mode === "draft" ? { ...wall, engines: undefined, reference: undefined } : wall;
  return await inExaminerWall(request, walled, seated);
}

/** The Examiner's asks as one conversation (5 November): each later ask wakes it where it rests,
 *  and where it crashed or met a limit the next opens afresh from the log (`record.ts`). An ask is
 *  answered at its own end or at the conversation's; `close` ends a resting one. */
export function conversing(sitting: Session<"write">) {
  let live: {
    settle: (examined: Examined) => void;
    wake: ((ask: Ask | null) => void) | null;
    readonly conversed: Promise<Examined>;
  } | null = null;
  const session: Session<"write"> = async (request, wall) => {
    const answered = Promise.withResolvers<Examined>();
    if (live?.wake != null) {
      const { wake } = live;
      [live.settle, live.wake] = [answered.resolve, null];
      wake({ request, wall });
      return await Promise.race([answered.promise, live.conversed]);
    }
    const rest = async (examined: Examined) => {
      own.settle(examined);
      return await new Promise<Ask | null>((resolve) => {
        own.wake = resolve;
      });
    };
    const own: NonNullable<typeof live> = {
      settle: answered.resolve,
      wake: null,
      conversed: sitting({ ...request, rest }, wall).finally(() => {
        own.wake = null;
        if (live === own) live = null;
      }),
    };
    live = own;
    return await Promise.race([answered.promise, own.conversed]);
  };
  const close = async () => {
    live?.wake?.(null);
    await live?.conversed.catch(() => undefined);
  };
  return { session, close };
}

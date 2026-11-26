import type { Api, AssistantMessage, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type AgentTool, sessionClock, runAgent } from "../agent/session.ts";
import { endingWith, openingTool } from "../builder/tools.ts";
import { budgetLeft } from "../campaign/opening.ts";
import { append, CALL_KINDS, read, TRACE_KINDS } from "../kernel/log.ts";
import { priceKey, reportedShare, type Spent } from "../kernel/meter.ts";
import { Cancellation } from "../kernel/solve.ts";
import { examinerSessions } from "../kernel/solves.ts";
import { boundText } from "../meta/bounded-text.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { plural } from "../meta/text.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { walledEnv } from "../tools/env.ts";
import { drafting } from "./draft.ts";
import { examinerShell, inExaminerSandbox, type Wall, type Walls } from "./shell.ts";
import { writing } from "./write.ts";

type Clock = ReturnType<typeof sessionClock>;

interface Sitting {
  readonly id: string;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: {
    readonly wallSeconds: number;
    readonly turns: number;
    readonly puts: number;
  };
  readonly models: (home: string, shutdown: AbortSignal, cwd?: string) => Models;
  readonly log: string;
  readonly kill?: AbortSignal;
  readonly opened?: () => void;
  readonly rest?: ((examined: Examined) => Promise<Ask | null>) | undefined;
}

export type Ask = Extract<ExamRequest, { readonly mode: "write" }>;

type Rest = (ended: "finished" | "supplied") => Promise<string | null>;

type DraftTerms = { readonly mode: "draft" } & Omit<Parameters<typeof drafting>[0], keyof Sitting>;
type WriteTerms = { readonly mode: "write" } & Omit<Parameters<typeof writing>[0], keyof Sitting>;

export type ExamRequest = Sitting & (DraftTerms | WriteTerms);

export interface Examined {
  readonly ended: (typeof ENDINGS)[number] | "stopped";
  readonly puts: number;
  readonly held: readonly string[];
  readonly refused: readonly string[];
}

export type Session<M extends ExamRequest["mode"]> = (
  request: Extract<ExamRequest, { readonly mode: M }>,
  wall?: Wall,
) => Promise<Examined>;

interface Mode {
  readonly kind: "exam" | "draft";
  readonly system: string;
  readonly opening: string;
  readonly started: JsonObject;
  readonly tools: readonly AgentTool[];
  readonly enters: string;
  readonly nudge: string;
  readonly finish: string;
  readonly declined: string | null;
  readonly done: () => "stands" | "supplied" | null;
  readonly counted: () => JsonObject;
  readonly result: () => Omit<Examined, "ended">;
  readonly ask?: (next: Ask) => string;
}

interface Said {
  note: string | null;
  declined: string | null;
}

const REREAD =
  "The session's opening message as it read when the host last asked: the record of the campaign's tasks and the limits of that ask. Read it after your context was compacted.";

const ENDINGS = ["stands", "finished", "supplied", "killed", "wall", "crashed", "turns"] as const;
function withinBudget(log: string, spent: AbortController): boolean {
  const left = budgetLeft(read(log, CALL_KINDS));
  if (left === null || left.dollars >= left.reserve) return true;
  spent.abort(new Cancellation("campaign-budget"));
  return false;
}

function guardAsk(each: AgentTool, stopped: () => string | null): AgentTool {
  return {
    ...each,
    execute: async (args, api, context) => {
      const reason = stopped();
      return reason === null ? await each.execute(args, api, context) : text(reason);
    },
  };
}

function finishTool(mode: Mode, said: Said, rest: Rest): AgentTool {
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
      const woken = mode.result().held.length === 0 ? null : await rest("finished");
      return woken === null ? ending(text("Finished.")) : text(woken);
    },
  });
}

async function examining(
  request: Sitting,
  modeOf: (stop: AbortSignal, within: Clock["within"], rest: Rest) => Mode,
  walls: Walls | undefined,
): Promise<Examined> {
  let began = walls?.began ?? performance.now();
  const spent = new AbortController();
  let current: Sitting = request;
  let [from, billed] = [0, 0];
  let reported: number | null = 0;
  const ownReported = (total: number | null) => {
    const own = reportedShare(total, reported);
    reported = total;
    return own;
  };
  let soFar: (() => Promise<Spent>) | undefined;
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
    const reason: unknown = current.kill?.reason;
    caller.abort(reason instanceof Cancellation ? reason : new Cancellation("caller"));
  };
  let watchedKill: AbortSignal | undefined;
  const watchKill = (kill: AbortSignal | undefined) => {
    watchedKill?.removeEventListener("abort", cancel);
    watchedKill = kill;
    kill?.addEventListener("abort", cancel, { once: true });
    if (kill?.aborted === true) cancel();
  };
  watchKill(request.kill);
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
    let rested: Examined | null = null;
    const rest: Rest = async (ended) => {
      const asking = mode.ask;
      if (request.rest === undefined || asking === undefined) return null;
      clock.close();
      const now = await soFar?.();
      const total = Math.max(billed, now?.billed ?? 0);
      const dollars = total - billed;
      billed = total;
      const result = closeAsk(ended, {
        crash: null,
        turns: turns.length - from,
        billed: dollars,
        reportedCost: ownReported(now?.reportedCost ?? null),
      });
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
      [current, from, began] = [next, turns.length, performance.now()];
      askEpoch += 1;
      compacted = false;
      watchKill(next.kill);
      Object.assign(said, { note: null, declined: null });
      clock = clocked();
      const woken = asking(next);
      start();
      next.opened?.();
      return woken;
    };
    const mode = modeOf(AbortSignal.any(stops), async (action) => await clock.within(action), rest);
    start();
    request.opened?.();
    let lastCall: string | undefined;
    let [compacted, askEpoch, turnEpoch] = [false, 0, 0];
    const used = (call: string) => {
      if (call !== lastCall) return "";
      const minutes = `${String(Math.floor(clock.seconds() / 60))} of ${plural(Math.round(current.limits.wallSeconds / 60), "minute")}`;
      const cue = compacted
        ? " Context compacted; read_opening holds the ask's opening record and limits."
        : "";
      return `Turn ${String(turns.length - from)} of ${String(current.limits.turns)}; ${minutes} used.${cue}`;
    };
    const shell = await examinerShell(walls?.shell, mode.enters);
    const reread = openingTool(() => {
      compacted = false;
      return mode.opening;
    }, REREAD);
    const tools = [
      ...[...mode.tools, ...shell, reread].map((each) => endingWith(each, used)),
      finishTool(mode, said, rest),
    ].map((each) =>
      guardAsk(each, () => {
        if (rested !== null) return "The previous ask ended and the session is closing.";
        if (turnEpoch !== askEpoch) {
          return "The previous ask ended and the host moved to a new ask; act on the wake message above.";
        }
        return null;
      }),
    );
    let running = 0;
    const sat = await runAgent({
      models: request.models,
      ...keyIfDefined("cwd", walls?.shell.dirs.home),
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
      over: () => said.note !== null || mode.done() !== null || turns.length - from >= current.limits.turns,
      next: async () =>
        said.note !== null || mode.done() !== null
          ? null
          : `You have not called finish. ${mode.nudge}, or call finish.`,
      onTurn: (message) => {
        turnEpoch = askEpoch;
        lastCall = message.content
          .flatMap((part) =>
            part.type === "toolCall" && tools.some(({ name }) => name === part.name) ? [part.id] : [],
          )
          .at(-1);
      },
      onTool: (phase) => {
        running += phase === "start" ? 1 : -1;
      },
      onCompact: () => {
        compacted = true;
      },
      spending: (now) => {
        soFar = now;
      },
      stops,
    });
    if (rested !== null) return rested;
    const by = {
      [mode.done() ?? "none"]: true,
      finished: said.note !== null,
      killed: caller.signal.aborted,
      wall: clock.signal.aborted,
      crashed: sat.crash !== null,
      turns: turns.length - from >= current.limits.turns,
    };
    const ended = ENDINGS.find((reason) => by[reason] === true) ?? "stopped";
    return closeAsk(ended, {
      crash: sat.crash,
      ...keyIfDefined("running", ended === "crashed" ? running : undefined),
      ...sat.spent,
      turns: turns.length - from,
      billed: Math.max(0, sat.spent.billed - billed),
      reportedCost: ownReported(sat.spent.reportedCost),
    });
  } finally {
    clock.close();
    watchedKill?.removeEventListener("abort", cancel);
  }
}

export async function examine(request: ExamRequest, wall?: Wall): Promise<Examined> {
  if (request.kill?.aborted === true) throw new Error(`session ${request.id} was stopped before it began`);
  if (examinerSessions(read(request.log, TRACE_KINDS)).has(request.id)) {
    throw new Error(`session ${request.id} is in the log already; a session's id names one session`);
  }
  const seated = async (walls?: Walls) =>
    examining(
      request,
      (stop, within, resting) =>
        request.mode === "draft"
          ? drafting(request, within, walls?.shell.dirs.home)
          : writing(request, walls, { stop, rest: resting, home: walls?.shell.dirs.home }),
      walls,
    );
  if (wall === undefined) return await seated();
  const walled = request.mode === "draft" ? { ...wall, engines: undefined } : wall;
  return await inExaminerSandbox(request, walled, seated);
}

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
      wake(request);
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

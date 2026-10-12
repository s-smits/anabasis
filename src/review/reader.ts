/**
 * One reviewer session: pi's agent loop over a packet and a few host tools, ended by the tool that
 * records the reviewer's one answer. The Referee runs here. It touches no file the solver can
 * reach, so nothing is walled: its tools read the host's records and run the verifier, which walls
 * its own checks.
 *
 * v1 ran a reader as one provider turn over a fixed packet (`src/review/review-reader.ts` at
 * 7af7315). Here it is a loop, since the Referee's probes and reads are calls the model chooses, and
 * a cap on model turns stands in for v1's single turn.
 *
 * A session also ends at a wall and at the run's kill. The turn cap bounds spend and not time, and a
 * session that hangs would hang the run that waits on it. The same signal is aborted when the session
 * ends for any reason, because that is what closes a backend's own process: a Claude Code query stays
 * open until its signal fires (`src/backends/claude.ts`).
 */
import { type AgentTool, runAgentLoop } from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
} from "@earendil-works/pi-ai";
import { reportedCost } from "../backends/claude.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { rmSync } from "../meta/filesystem.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { hostScratch } from "../verify/wall-policy.ts";

/** Who reads, and on what. */
export interface Reader {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  /** The backends, built for one session on the home its model process keeps its state in. */
  readonly models: (home: string) => Models;
  /** Seconds one session may run; `WALL_SECONDS` when the caller names none. */
  readonly wallSeconds?: number;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

/** Enough for a dozen reads and probes and the ruling; a reader that has not ruled by then will not. */
const TURN_CAP = 24;
/** Half an hour: v1's reader deadline was an hour, and its ESP32 reviews spent 50 and 63 minutes of it
 *  inside probes (`review-probe.ts:84-86` at 3f93d06b). A v2 reader reads one fail, not a battery. */
const WALL_SECONDS = 1_800;

/** Run one session until a tool ends it or the turn cap does, and return its spend and length for
 *  the finding's log line; the caller's record tool holds the answer. */
export async function readOnce(
  reader: Reader,
  system: string,
  packet: string,
  tools: readonly AgentTool[],
): Promise<JsonObject> {
  // Under the host's own scratch, which every wall closes (`wall-policy.ts`): the reader's Claude
  // Code keeps what it was sent here, hidden expectations included.
  const home = hostScratch("claude-cli-reader-");
  const turns: AssistantMessage[] = [];
  // A record tool ends the loop while Claude Code still waits on its result, and only this signal
  // ends that query: on 8 October a live Referee's Claude Code outlived its ruling by two hours.
  const [wall, done] = [new AbortController(), new AbortController()];
  // The Claude backend keeps one live query a session id in the process. A comparison rules its
  // rejections in parallel, so the id is random: two rulings begun in one millisecond once shared
  // an id, and the second reader's packet went into the first one's query.
  const session = `reader-${crypto.randomUUID()}`;
  const timer = setTimeout(() => wall.abort(), (reader.wallSeconds ?? WALL_SECONDS) * 1000);
  try {
    const models = reader.models(home);
    const head = createInitialSystemMessage(system, tools.map(toToolDeclaration));
    await runAgentLoop(
      [{ role: "user", content: packet, timestamp: Date.now() }],
      { messages: head === undefined ? [] : [head], tools: [...tools] },
      {
        model: reader.model,
        reasoning: reader.effort,
        sessionId: session,
        convertToLlm: (messages) => messages,
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return turns.length >= TURN_CAP ? { action: "end" } : undefined;
        },
      },
      () => {},
      AbortSignal.any([wall.signal, done.signal, ...(reader.kill ? [reader.kill] : [])]),
      (model, context, options) => models.streamSimple(model, context, options),
    );
  } finally {
    clearTimeout(timer);
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  const tokens = tokensOf(turns.map((turn) => turn.usage));
  return {
    model: priceKey(reader.model),
    turns: turns.length,
    walled: wall.signal.aborted,
    error: turns.at(-1)?.errorMessage ?? null,
    ...dollars(freezePrices([reader.model]), priceKey(reader.model), tokens),
    reportedCost: await reportedCost(session, turns),
  };
}

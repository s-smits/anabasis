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
 * session that hangs would hang the run that waits on it. The seat's frame aborts the loop's signal
 * when the session ends for any reason (`sit`, `src/agent/session.ts`), because that is what closes a
 * backend's own process: a Claude Code query stays open until its signal fires. On 20 October triage found that the wall
 * could stop the model loop while an executing probe kept verifier work open; that signal now also
 * reaches each tool, so a Referee probe can cancel the verifier and its check cell with the session.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { priceKey } from "../kernel/meter.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { sit } from "../agent/session.ts";

/** Who reads, and on what. */
export interface Reader {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  /** The backends, built for one session on the home its model process keeps its state in. */
  readonly models: (home: string, shutdown: AbortSignal) => Models;
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
  const wall = AbortSignal.timeout((reader.wallSeconds ?? WALL_SECONDS) * 1000);
  // The Claude backend keeps one live query a session id in the process. A comparison rules its
  // rejections in parallel, so the id is random: two rulings begun in one millisecond once shared
  // an id, and the second reader's packet went into the first one's query.
  const turns: AssistantMessage[] = [];
  const { spent } = await sit({
    models: reader.models,
    id: `reader-${crypto.randomUUID()}`,
    model: reader.model,
    effort: reader.effort,
    system,
    opening: packet,
    tools,
    turns,
    most: TURN_CAP,
    stops: [wall, reader.kill],
  });
  return {
    model: priceKey(reader.model),
    walled: wall.aborted,
    error: turns.at(-1)?.errorMessage ?? null,
    ...spent,
  };
}

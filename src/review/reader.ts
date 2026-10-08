/**
 * One reviewer session: pi's agent loop over a packet and a few host tools, ended by the tool that
 * records the reviewer's one answer. The Referee and the Diagnoser both run here. Neither touches a
 * file the solver can reach, so nothing is walled: their tools read the host's records and run the
 * verifier, which walls its own checks.
 *
 * v1 ran a reader as one provider turn over a fixed packet (`src/review/review-reader.ts` at
 * 7af7315). Here it is a loop, since the Referee's probes and reads are calls the model chooses, and
 * a cap on model turns stands in for v1's single turn.
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
import { REPORTED_COST } from "../backends/claude.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, type JsonObject } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";

/** Who reads, and on what. */
export interface Reader {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  /** The backends, built for one session on the home its model process keeps its state in. */
  readonly models: (home: string) => Models;
}

/** Enough for a dozen reads and probes and the ruling; a reader that has not ruled by then will not. */
const TURN_CAP = 24;

/** Run one session until a tool ends it or the turn cap does, and return its spend and length for
 *  the finding's log line; the caller's record tool holds the answer. */
export async function readOnce(
  reader: Reader,
  system: string,
  packet: string,
  tools: readonly AgentTool[],
): Promise<JsonObject> {
  const home = mkdtempSync(join(tmpdir(), "ana-reader-"));
  const turns: AssistantMessage[] = [];
  // A record tool ends the loop while Claude Code still waits on its result, and only this signal
  // ends that query: on 8 October a live Referee's Claude Code outlived its ruling by two hours.
  const done = new AbortController();
  try {
    const models = reader.models(home);
    const head = createInitialSystemMessage(system, tools.map(toToolDeclaration));
    await runAgentLoop(
      [{ role: "user", content: packet, timestamp: Date.now() }],
      { messages: head === undefined ? [] : [head], tools: [...tools] },
      {
        model: reader.model,
        reasoning: reader.effort,
        sessionId: `reader-${String(Date.now())}`,
        convertToLlm: (messages) => messages,
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return turns.length >= TURN_CAP ? { action: "end" } : undefined;
        },
      },
      () => {},
      done.signal,
      (model, context, options) => models.streamSimple(model, context, options),
    );
  } finally {
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  const tokens = tokensOf(turns.map((turn) => turn.usage));
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
  return {
    model: priceKey(reader.model),
    turns: turns.length,
    error: turns.at(-1)?.errorMessage ?? null,
    ...dollars(freezePrices([reader.model]), priceKey(reader.model), tokens),
    reportedCost: isNumber(reported) ? reported : null,
  };
}

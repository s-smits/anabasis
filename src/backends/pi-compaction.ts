/**
 * Compaction for pi's own loop, which serves Codex and OpenRouter: v1's `src/backends/pi-compaction.ts`
 * (7af7315), on pi coding-agent's compaction, vendored in `vendor/pi-coding-agent/core/compaction`
 * since pi-agent-core no longer carries it. Before each model call, a context past the window
 * less pi's reserve has its older span summarised by the served model, and the summary leads the
 * retained tail; a failed summary leaves the context as it was. The summary runs at the loop's
 * own thinking level, as pi's session does. Claude Code compacts in its own CLI
 * (`claude.ts`), so a Claude model is left alone here.
 */
import type { AgentMessage, PrepareRequest, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import {
  compact,
  compactionSummaryMessage,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  shouldCompact,
} from "../../vendor/pi-coding-agent/core/compaction/compaction.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { SWEEP_COMPACT_WINDOW, servedByClaude } from "./claude.ts";

/** One compaction, as the log records it: `error` is the summary's failure, when it failed. */
export interface Compacted {
  readonly tokensBefore: number;
  readonly seconds: number;
  readonly usages: readonly Usage[];
  readonly error: string | null;
}

/** The window pi's loop compacts at on `model`: the sweep's, or the model's own when smaller. */
const windowOf = (model: Pick<Model<Api>, "contextWindow">) =>
  Math.min(model.contextWindow, SWEEP_COMPACT_WINDOW);

/** The compaction a condition pins for a solve in pi's own loop on `model`. */
export function piCompactionMode(model: Pick<Model<Api>, "contextWindow">): string {
  const { reserveTokens, keepRecentTokens } = DEFAULT_COMPACTION_SETTINGS;
  return `pi window=${String(windowOf(model))} reserve=${String(reserveTokens)} keep=${String(keepRecentTokens)}`;
}

/** The loop's `prepareRequest`: compacts through `stream`, and tells `compacted` of each attempt. */
export function compactBeforeRequest(
  stream: StreamFn,
  compacted: (event: Compacted) => void,
): PrepareRequest {
  let summary: AgentMessage | undefined;
  let previous: string | undefined;
  // Usage reported before the last compaction counts the context it replaced.
  let fresh = 0;
  return async ({ context, model, thinkingLevel }, signal) => {
    if (servedByClaude(model.provider)) return undefined;
    const { messages } = context;
    const estimate = estimateContextTokens(messages);
    const tokens =
      estimate.lastUsageIndex !== null && estimate.lastUsageIndex < fresh
        ? messages.reduce((sum, message) => sum + estimateTokens(message), 0)
        : estimate.tokens;
    if (!shouldCompact(tokens, windowOf(model), DEFAULT_COMPACTION_SETTINGS)) return undefined;
    const body = messages.filter((message) => message.role !== "system" && message !== summary);
    const preparation = prepareCompaction(body, DEFAULT_COMPACTION_SETTINGS, tokens, previous);
    if (preparation === undefined) return undefined;
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const result = await compact(preparation, model, { streamFn: stream, signal, thinkingLevel });
      compacted({ tokensBefore: tokens, seconds: seconds(), usages: result.usages, error: null });
      previous = result.summary;
      summary = compactionSummaryMessage(result.summary);
      const kept = [
        ...messages.filter((message) => message.role === "system"),
        summary,
        ...body.slice(result.firstKeptIndex),
      ];
      fresh = kept.length;
      return { context: { ...context, messages: kept } };
    } catch (error) {
      compacted({ tokensBefore: tokens, seconds: seconds(), usages: [], error: errorMessage(error) });
      return undefined;
    }
  };
}

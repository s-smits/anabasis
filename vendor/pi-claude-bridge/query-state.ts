// Query state: QueryContext class.
//
// All per-query and per-turn mutable state lives here. Reentrant queries
// each get their own QueryContext instance, managed by provider.ts.
// Adding a new field = one property on the class.
//
// Extracted from index.ts so tests can import without activating the extension.

import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { Query } from "claude-agent-sdk-bridge";
import type { McpResult } from "./extract-tool-results.js";
import type { PromptStream } from "./prompt-stream.js";

/** Blocks carry two streaming-only fields pi-ai does not declare: `index` pairs a delta to its block, `partialJson` accumulates tool input until it parses. */
export type TurnBlock = AssistantMessage["content"][number] & { index?: number | undefined; partialJson?: string | undefined };

interface PendingToolCall {
	toolName: string;
	resolve: (result: McpResult) => void;
}

export class QueryContext {
	// Query-scoped (fully isolated per query)
	activeQuery: Query | null = null;
	currentPiStream: AssistantMessageEventStream | null = null;
	latestCursor = 0;
	pendingToolCalls = new Map<string, PendingToolCall>();
	pendingResults = new Map<string, McpResult>();
	/** tool_use ids emitted this turn. Sole purpose is routing a delivered result
	 *  to the owning query when several queries are in flight — pairing a result
	 *  to its call is done by id from Claude's tools/call _meta, not from here. */
	turnToolCallIds: string[] = [];
	/** Streaming-input handle for the active query — how steers reach CC mid-turn. */
	promptStream: PromptStream | null = null;
	/** Stops the active query as a caller's abort would. */
	abort: (() => void) | null = null;

	// Per-turn (reset together)
	turnOutput: AssistantMessage | null = null;
	turnStarted = false;
	turnSawStreamEvent = false;
	turnSawToolCall = false;
	/** Where the streaming message's blocks begin, until its message_delta says it completed. */
	messageFrom: number | null = null;

	/** Output and stream exist between ensureTurnStarted and the stream ending; stated once, here. */
	get liveOutput(): AssistantMessage { if (!this.turnOutput) throw new Error("turnOutput accessed before resetTurnState"); return this.turnOutput; }
	get liveStream(): AssistantMessageEventStream { if (!this.currentPiStream) throw new Error("stream accessed before ensureTurnStarted"); return this.currentPiStream; }
	get turnBlocks(): TurnBlock[] { return this.liveOutput.content; }

	resetTurnState(model: Model<Api>): void {
		this.turnOutput = {
			role: "assistant", content: [],
			api: model.api, provider: model.provider, model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop", timestamp: Date.now(),
		};
		this.turnStarted = false; this.turnSawStreamEvent = false; this.turnSawToolCall = false; this.messageFrom = null;
		// turnToolCallIds is retained across tool-result delivery
		// callbacks within the same assistant message so results can be routed to
		// this query while its handlers are still pending.
	}
}

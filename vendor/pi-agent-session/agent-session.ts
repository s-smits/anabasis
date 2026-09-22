// Copied from pi coding-agent v0.86.1 (github.com/earendil-works/pi, 13cbf77df, MIT, see LICENSE),
// checked against v0.87.0 (16787ad): AgentSession's prompt loop, auto-retry and auto-compaction
// from packages/coding-agent/src/core/agent-session.ts, plus getLatestCompactionEntry from
// session-manager.ts, line ranges in order. The session log is held in memory and compaction runs
// through pi-agent-core's compact(). Left out: the CLI's settings, session files, extensions,
// templates and system-prompt builder, and 0.87.0's persisted projection and turn boundaries.
// Added here, absent upstream through v0.87.0: an abort during prompt()'s pre-prompt compaction
// cancels the prompt instead of starting the agent after it.
/**
 * PiAgentSession - the prompt loop pi coding-agent runs every prompt through, over one Agent.
 *
 * It encapsulates:
 * - Agent state access
 * - Event subscription with an in-memory session log
 * - Auto-compaction on overflow and threshold
 * - Auto-retry of transient provider errors
 * - Steering, follow-up and abort
 *
 * Callers set the model, tools and system prompt on `agent.state` directly.
 */

import type {
	Agent,
	AgentContext,
	AgentEvent,
	AgentMessage,
	AgentState,
	CompactionEntry,
	CompactionSettings,
	CompactResult,
	Entry,
	JsonValue,
	PrepareNextTurnContext,
	ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
	BACKGROUND_CONTEXT,
	calculateContextTokens,
	compact,
	estimateContextTokens,
	estimateTokens,
	prepareCompaction,
	shouldCompact,
	withAbortSignal,
} from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type Model,
	type Models,
	type RetryCallbacks,
	type RetryPolicy,
	type Usage,
	contentText,
	getCurrentSystemMessage,
	isContextOverflow,
	isRecoverableLength,
	isRetryableAssistantError,
	normalizeContext,
	retryDelayMs,
} from "@earendil-works/pi-ai";
import {
	buildContextEntries,
	type SessionCompactionEntry,
	type SessionEntry,
	sessionEntryToContextMessages,
} from "./session-context.ts";
import { sleep } from "./sleep.ts";

/** Session-specific events that extend the core AgentEvent */
export type PiAgentSessionEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| {
			type: "agent_end";
			messages: AgentMessage[];
			willRetry: boolean;
	  }
	| { type: "agent_settled" }
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| { type: "compaction_start"; reason: "threshold" | "overflow" }
	| {
			type: "compaction_end";
			reason: "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string | undefined;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string | undefined }
	| {
			type: "summarization_retry_scheduled";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
	  }
	| {
			type: "summarization_retry_attempt_start";
			source: "compaction";
			reason: "threshold" | "overflow";
	  }
	| { type: "summarization_retry_finished" };

/** Listener function for agent session events */
export type PiAgentSessionEventListener = (event: PiAgentSessionEvent) => void;

export interface PiAgentSessionConfig {
	agent: Agent;
	/** Compaction thresholds. `window` caps the model's context window for threshold admission;
	 *  `enabled: false` leaves compaction to a provider that compacts natively. */
	compaction: CompactionSettings & { window: number };
	/** Auto-retry of transient provider errors, also applied to compaction summary requests. */
	retry: RetryPolicy;
}

/** What one compaction wrote, as compaction_end reports it. */
export interface CompactionResult {
	summary: string;
	tokensBefore: number;
	estimatedTokensAfter: number;
	usage?: Usage;
	details?: JsonValue;
}

export function getLatestCompactionEntry(entries: readonly Entry[]): CompactionEntry | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "compaction") {
			return entry;
		}
	}
	return null;
}

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		tokens += estimateTokens(message);
	}
	return tokens;
}

/**
 * The one Models method compact() calls (pi-agent-core 0.87.0, compaction.js
 * completeSimpleWithRetries), answered the way pi coding-agent sends its summaries: through the
 * agent's own stream function and key.
 */
function summaryModels(agent: Agent): Models {
	const models: Pick<Models, "completeSimple"> = {
		completeSimple: async (model, context, options) => {
			const apiKey = await agent.getApiKey?.(model.provider);
			const stream = await agent.streamFunction(
				model,
				normalizeContext(context),
				apiKey === undefined ? options : { ...options, apiKey },
			);
			return stream.result();
		},
	};
	// SAFETY: compact() reaches the registry only through completeSimple; no other member is read.
	return models as Models;
}

// ============================================================================
// PiAgentSession Class
// ============================================================================

export class PiAgentSession {
	readonly agent: Agent;

	// Event subscription state
	private _unsubscribeAgent: (() => void) | undefined;
	private _eventListeners: PiAgentSessionEventListener[] = [];
	private _isAgentRunActive = false;
	private _agentRunAbortRequested = false;
	// Spans the whole prompt(), pre-prompt compaction included; the agent-run flags start later.
	private _isPromptActive = false;
	private _promptAbortRequested = false;
	private _idleWaitPromise: Promise<void> | undefined;
	private _resolveIdleWait: (() => void) | undefined;

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	private readonly _steeringMessages: string[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	private readonly _followUpMessages: string[] = [];

	// Compaction state
	private _autoCompactionAbortController: AbortController | undefined = undefined;
	private _overflowRecoveryAttempted = false;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;

	// Session log and policy
	private readonly _entries: SessionEntry[] = [];
	private readonly _compaction: PiAgentSessionConfig["compaction"];
	private readonly _retry: RetryPolicy;

	constructor(config: PiAgentSessionConfig) {
		this.agent = config.agent;
		this._compaction = config.compaction;
		this._retry = config.retry;

		// Always subscribe to agent events for internal handling
		// (session persistence, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._installAgentNextTurnRefresh();
	}

	/** The session path: every message the agent ended, and each compaction, in order. */
	getBranch(): readonly SessionEntry[] {
		return this._entries;
	}

	private _appendMessage(message: AgentMessage): void {
		this._entries.push({
			type: "message",
			id: crypto.randomUUID(),
			parentId: this._entries.at(-1)?.id ?? null,
			seq: this._entries.length,
			timestamp: Date.now(),
			message,
		});
	}

	private _appendCompaction(result: CompactResult): void {
		const timestamp = Date.now();
		const systemMessage = getCurrentSystemMessage(this.agent.state.messages);
		const entry: SessionCompactionEntry = {
			type: "compaction",
			id: crypto.randomUUID(),
			parentId: this._entries.at(-1)?.id ?? null,
			seq: this._entries.length,
			timestamp,
			summary: result.summary,
			retainedTail: result.retainedTail,
			tokensBefore: result.tokensBefore,
			fromHook: false,
		};
		// The live context holds the framing and tool declarations the log never saw, so the replay
		// reads it rather than the entries (session-manager.ts appendCompaction reads its own log).
		if (systemMessage !== undefined) entry.systemMessage = { ...systemMessage, timestamp };
		if (result.details !== undefined) entry.details = result.details;
		if (result.usage !== undefined) entry.usage = result.usage;
		this._entries.push(entry);
	}

	/** The window threshold compaction admits against: the model's own, capped by the configured window. */
	private _compactionWindow(): number {
		return Math.min(this.model?.contextWindow ?? 0, this._compaction.window);
	}

	private async _compactBeforeNextAssistantResponse(context: AgentContext): Promise<AgentContext> {
		const model = this.model;
		const settings = this._compaction;
		const contextWindow = this._compactionWindow();

		if (
			!model ||
			contextWindow <= 0 ||
			!shouldCompact(estimateContextTokens(context.messages).tokens, contextWindow, settings)
		) {
			return context;
		}

		await this._runAutoCompaction("threshold", "keep-turn");
		return {
			...context,
			messages: this.agent.state.messages.slice(),
		};
	}

	private _installAgentNextTurnRefresh(): void {
		const previousPrepareNextTurnWithContext =
			this.agent.prepareNextTurnWithContext ??
			(this.agent.prepareNextTurn
				? async (_turn: PrepareNextTurnContext, signal?: AbortSignal) => await this.agent.prepareNextTurn?.(signal)
				: undefined);
		this.agent.prepareNextTurnWithContext = async (turn, signal) => {
			const context = await this._compactBeforeNextAssistantResponse(turn.context);
			const previousSnapshot = await previousPrepareNextTurnWithContext?.({ ...turn, context }, signal);
			return {
				...previousSnapshot,
				context: previousSnapshot?.context ?? context,
			};
		};
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: PiAgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	private _getIdleWaitPromise(): Promise<void> {
		this._idleWaitPromise ??= new Promise((resolve) => {
			this._resolveIdleWait = resolve;
		});
		return this._idleWaitPromise;
	}

	private _resolveIdleWaitIfIdle(): void {
		if (!this.isIdle || !this._resolveIdleWait) {
			return;
		}
		const resolve = this._resolveIdleWait;
		this._idleWaitPromise = undefined;
		this._resolveIdleWait = undefined;
		resolve();
	}

	private _emitAgentSettled(): void {
		this._isAgentRunActive = false;
		try {
			this._emit({ type: "agent_settled" });
		} finally {
			this._resolveIdleWaitIfIdle();
		}
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private readonly _handleAgentEvent = (event: AgentEvent): void => {
		// When a user message starts, check if it's from either queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user") {
			this._overflowRecoveryAttempted = false;
			const messageText = contentText(event.message.content, "");
			// Check steering queue first, then follow-up queue
			if (messageText !== "" && (this._dequeue(this._steeringMessages, messageText) || this._dequeue(this._followUpMessages, messageText))) {
				this._emitQueueUpdate();
			}
		}

		// Notify all listeners
		this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event);

		// Handle session persistence
		if (event.type === "message_end") {
			if (
				event.message.role === "system" ||
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as a message entry
				this._appendMessage(event.message);
			}
			// compactionSummary messages are persisted as the compaction entry itself

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;

				const assistantMsg = event.message;
				if (assistantMsg.stopReason !== "error" && assistantMsg.stopReason !== "length") {
					this._overflowRecoveryAttempted = false;
				}

				// Reset retry counter immediately on successful assistant response
				// This prevents accumulation across multiple LLM calls within a turn
				if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
					this._emit({
						type: "auto_retry_end",
						success: true,
						attempt: this._retryAttempt,
					});
					this._retryAttempt = 0;
				}
			}
		}
	};

	private _dequeue(queue: string[], text: string): boolean {
		const index = queue.indexOf(text);
		if (index === -1) return false;
		queue.splice(index, 1);
		return true;
	}

	private _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
		if (this._agentRunAbortRequested) return false;
		const settings = this._retry;
		if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
			return false;
		}

		for (let i = event.messages.length - 1; i >= 0; i--) {
			const message = event.messages[i];
			if (message?.role === "assistant") {
				return this._isRetryableError(message);
			}
		}
		return false;
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant") {
				return msg;
			}
		}
		return undefined;
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: PiAgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/** Disconnect from agent events during disposal. */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	dispose(): void {
		try {
			this.abortRetry();
			this._autoCompactionAbortController?.abort();
			this.agent.abort();
		} catch {
			// Dispose must succeed even if an abort hook throws.
		}

		this._disconnectFromAgent();
		this._eventListeners = [];
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether the session is currently processing an agent run or post-run continuation. */
	get isStreaming(): boolean {
		return this._isAgentRunActive;
	}

	/** Whether the session has no active agent run, compaction, retry, or queued continuation. */
	get isIdle(): boolean {
		return !this._isAgentRunActive && !this.isCompacting;
	}

	/** Current system prompt */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryAttempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((t) => t.name);
	}

	/** Whether compaction is currently running */
	get isCompacting(): boolean {
		return this._autoCompactionAbortController !== undefined;
	}

	/** Messages in agent state: the context the next request sends */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		this._agentRunAbortRequested = false;
		this._isAgentRunActive = true;
		try {
			await this.agent.prompt(messages);
			while (await this._handlePostAgentRun()) {
				if (this._agentRunAbortRequested) break;
				await this.agent.continue();
			}
		} finally {
			if (this._agentRunAbortRequested) this._finishCancelledRetry();
			this._emitAgentSettled();
		}
	}

	private async _handlePostAgentRun(): Promise<boolean> {
		const msg = this._lastAssistantMessage;
		this._lastAssistantMessage = undefined;
		if (this._agentRunAbortRequested) {
			this._finishCancelledRetry();
			return false;
		}
		if (!msg) {
			return false;
		}

		if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
			if (this._agentRunAbortRequested) this._finishCancelledRetry();
			return !this._agentRunAbortRequested;
		}
		if (this._agentRunAbortRequested) {
			this._finishCancelledRetry();
			return false;
		}

		if (msg.stopReason === "error" && this._retryAttempt > 0) {
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt,
				finalError: msg.errorMessage,
			});
			this._retryAttempt = 0;
		}

		if (await this._checkCompaction(msg)) {
			return !this._agentRunAbortRequested;
		}

		// The agent loop drains both queues before emitting agent_end. Any messages
		// here were queued by agent_end listeners and need a continuation.
		return !this._agentRunAbortRequested && this.agent.hasQueuedMessages();
	}

	/**
	 * Send a prompt to the agent.
	 * - Checks compaction before sending (catches aborted responses)
	 * - Runs retry and compaction continuations until the run settles
	 * @throws Error if the agent is already processing; queue with steer() or followUp() instead
	 */
	async prompt(text: string): Promise<void> {
		if (this.isStreaming) {
			throw new Error("Agent is already processing. Queue the message with steer() or followUp().");
		}

		this._isPromptActive = true;
		this._promptAbortRequested = false;
		try {
			// Check if we need to compact before sending (catches aborted responses).
			// The user's new prompt is sent below, so do not call agent.continue() here.
			const lastAssistant = this._findLastAssistantMessage();
			if (lastAssistant) {
				await this._checkCompaction(lastAssistant, false);
			}
			// An abort during that compaction cancels the prompt: no request and no tool run follow.
			if (this._promptAbortRequested) return;

			await this._runAgentPrompt(userMessage(text));
		} finally {
			this._isPromptActive = false;
		}
	}

	/**
	 * Queue a steering message while the agent is running.
	 * Delivered after the current assistant turn finishes executing its tool calls,
	 * before the next LLM call.
	 */
	steer(text: string): void {
		this._steeringMessages.push(text);
		this._emitQueueUpdate();
		this.agent.steer(userMessage(text));
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 */
	followUp(text: string): void {
		this._followUpMessages.push(text);
		this._emitQueueUpdate();
		this.agent.followUp(userMessage(text));
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		if (this._isAgentRunActive) {
			this._agentRunAbortRequested = true;
		}
		if (this._isPromptActive) {
			this._promptAbortRequested = true;
		}
		this.abortRetry();
		this._autoCompactionAbortController?.abort();
		this.agent.abort();
		await this.waitForIdle();
	}

	async waitForIdle(): Promise<void> {
		if (this.isIdle) {
			return;
		}
		await this._getIdleWaitPromise();
	}

	/**
	 * Dispatch automatic compaction after `agent_end` or before prompt submission.
	 *
	 * Automatic cases:
	 * 1. Overflow with retry: a context-overflow error or recoverable length stop;
	 *    remove the failed assistant message, compact, and retry the turn once.
	 * 2. Overflow without retry: a successful response exceeded the configured
	 *    context window; compact but preserve the completed response.
	 * 3. Threshold without retry: valid or estimated context usage crossed the
	 *    configured threshold; compact without retrying the completed response.
	 *
	 * Each case calls `_runAutoCompaction()`. Threshold admission uses the model's window capped by
	 * the configured window; overflow detection uses the model's own window.
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 * @returns Whether the post-run loop should call `agent.continue()` for overflow recovery or queued messages
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		const settings = this._compaction;
		if (!settings.enabled) return false;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

		const contextWindow = this.model?.contextWindow ?? 0;

		// Skip overflow check if the message came from a different model.
		// This handles the case where user switched from a smaller-context model (e.g. opus)
		// to a larger-context model (e.g. codex) - the overflow error from the old model
		// shouldn't trigger compaction for the new model.
		const sameModel =
			this.model !== undefined &&
			assistantMessage.provider === this.model.provider &&
			assistantMessage.model === this.model.id;

		// Skip compaction checks if this assistant message is older than the latest
		// compaction boundary. This prevents a stale pre-compaction usage/error
		// from retriggering compaction on the first prompt after compaction.
		const compactionEntry = getLatestCompactionEntry(this._entries);
		const assistantIsFromBeforeCompaction =
			compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
		if (assistantIsFromBeforeCompaction) {
			return false;
		}

		// Automatic cases 1 and 2: context overflow.
		// A length stop is recoverable when output ended below the model's original desired limit,
		// independent of the configured context size or any context-clamped provider request limit.
		const contextOverflow = sameModel && isContextOverflow(assistantMessage, contextWindow);
		const recoverableLength = sameModel && isRecoverableLength(assistantMessage, this.model?.maxTokens ?? 0);
		if (contextOverflow || recoverableLength) {
			return await this._recoverOverflow(assistantMessage, contextOverflow ? "context-overflow" : "length");
		}

		// Case 3: threshold compaction without retry.
		const contextTokens = this._thresholdContextTokens(assistantMessage, compactionEntry);
		if (contextTokens !== undefined && shouldCompact(contextTokens, this._compactionWindow(), settings)) {
			return await this._runAutoCompaction("threshold", "keep-turn");
		}
		return false;
	}

	/** Automatic cases 1 and 2 of `_checkCompaction()`: an overflowed or truncated response. */
	private async _recoverOverflow(
		assistantMessage: AssistantMessage,
		cause: "context-overflow" | "length",
	): Promise<boolean> {
		const willRetry = assistantMessage.stopReason !== "stop";

		// Case 2: the response completed successfully. Compact, but do not retry because
		// agent.continue() cannot continue from a completed assistant response.
		if (!willRetry) {
			return await this._runAutoCompaction("overflow", "keep-turn");
		}

		if (this._overflowRecoveryAttempted) {
			const errorMessage =
				cause === "context-overflow"
					? "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."
					: "Truncated response recovery failed after one compact-and-retry attempt.";
			this._emit({
				type: "compaction_end",
				reason: "overflow",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage,
			});
			return false;
		}

		// Case 1: remove the failed or truncated message from agent state, compact, and
		// retry once. The message remains in session history but is excluded from retry context.
		this._overflowRecoveryAttempted = true;
		const messages = this.agent.state.messages;
		if (messages.at(-1)?.role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}
		return await this._runAutoCompaction("overflow", "retry-turn");
	}

	/**
	 * Context size for case 3 of `_checkCompaction()`, or undefined when the only usage on record
	 * predates the latest compaction.
	 *
	 * For error messages or all-zero usage messages, estimate from the last valid response.
	 * This ensures sessions that hit persistent API errors (e.g. 529) or malformed zero-usage
	 * responses can still compact and do not reset context accounting.
	 */
	private _thresholdContextTokens(
		assistantMessage: AssistantMessage,
		compactionEntry: CompactionEntry | null,
	): number | undefined {
		const directContextTokens = calculateContextTokens(assistantMessage.usage);
		if (assistantMessage.stopReason !== "error" && directContextTokens !== 0) {
			return directContextTokens;
		}
		const messages = this.agent.state.messages;
		const estimate = estimateContextTokens(messages);
		// Without provider usage, estimate.tokens is the pure message-size estimate.
		// Only usage-backed estimates need the stale pre-compaction check.
		if (estimate.lastUsageIndex !== null) {
			// Verify the usage source is post-compaction. Kept pre-compaction messages
			// have stale usage reflecting the old (larger) context and would falsely
			// trigger compaction right after one just finished.
			const usageMsg = messages[estimate.lastUsageIndex];
			if (
				compactionEntry !== null &&
				usageMsg?.role === "assistant" &&
				usageMsg.timestamp <= new Date(compactionEntry.timestamp).getTime()
			) {
				return undefined;
			}
		}
		return estimate.tokens;
	}

	/**
	 * Execute threshold or overflow compaction through pi-agent-core's `compact()`, with the
	 * session's own model, thinking level and stream function answering the summary request.
	 *
	 * @param reason Automatic trigger selected by `_checkCompaction()`
	 * @param turn Whether to retry the interrupted turn after overflow compaction
	 * @returns Whether the post-run loop should call `agent.continue()`
	 */
	private async _runAutoCompaction(
		reason: "overflow" | "threshold",
		turn: "retry-turn" | "keep-turn",
	): Promise<boolean> {
		const willRetry = turn === "retry-turn";
		const model = this.model;
		const settings = this._compaction;
		let abortController: AbortController | undefined;
		let started = false;

		try {
			if (!model) {
				return false;
			}

			const prepared = prepareCompaction([...this._entries], settings);
			if (!prepared.ok) throw prepared.error;
			const preparation = prepared.value;
			// An empty summarised head would only prepend a summary to an unchanged transcript.
			if (
				!preparation ||
				(preparation.messagesToSummarize.length === 0 && preparation.turnPrefixMessages.length === 0)
			) {
				return false;
			}

			abortController = new AbortController();
			this._autoCompactionAbortController = abortController;
			started = true;
			this._emit({ type: "compaction_start", reason });
			abortController.signal.throwIfAborted();

			const compacted = await compact(
				preparation,
				summaryModels(this.agent),
				model,
				undefined,
				this.thinkingLevel,
				this._retry,
				this._summarizationRetryCallbacks({ source: "compaction", reason }),
				withAbortSignal(abortController.signal, BACKGROUND_CONTEXT),
			);
			if (!compacted.ok) throw compacted.error;
			const { summary, tokensBefore, usage, details } = compacted.value;
			abortController.signal.throwIfAborted();

			this._appendCompaction(compacted.value);
			const messages = buildContextEntries(this._entries).flatMap(sessionEntryToContextMessages);
			this.agent.state.messages = messages;
			const estimatedTokensAfter = estimateMessagesTokens(messages);

			const result: CompactionResult = { summary, tokensBefore, estimatedTokensAfter };
			if (usage !== undefined) result.usage = usage;
			if (details !== undefined) result.details = details;
			this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

			if (willRetry) {
				const lastMsg = this.agent.state.messages.at(-1);
				// The overflow response was persisted on message_end before _checkCompaction() removed it
				// from agent state. Rebuilding state from the new compaction can restore that kept entry,
				// leaving an assistant as the final message. agent.continue() rejects that state, so remove
				// the retriable error or truncated-length response again before continuing the interrupted turn.
				if (lastMsg?.role === "assistant" && (lastMsg.stopReason === "error" || lastMsg.stopReason === "length")) {
					this.agent.state.messages = this.agent.state.messages.slice(0, -1);
				}
				return true;
			}

			// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
			// Continue once so queued messages are delivered.
			return this.agent.hasQueuedMessages();
		} catch (error) {
			const message = error instanceof Error ? error.message : "compaction failed";
			const aborted = abortController?.signal.aborted === true;
			if (started) {
				const errorMessage = aborted
					? undefined
					: reason === "overflow"
						? `Context overflow recovery failed: ${message}`
						: `Auto-compaction failed: ${message}`;
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted,
					willRetry: false,
					errorMessage,
				});
			}
			return false;
		} finally {
			if (this._autoCompactionAbortController === abortController) {
				this._autoCompactionAbortController = undefined;
			}
			this._resolveIdleWaitIfIdle();
		}
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		// Context overflow is handled by compaction, not retry.
		if (isContextOverflow(message, this.model?.contextWindow ?? 0)) return false;
		return isRetryableAssistantError(message);
	}

	/**
	 * Retry policy + callbacks for compaction summarization calls.
	 * Uses the same retry budget/backoff as agent-turn retries so a single transient
	 * stream drop no longer fails the whole operation.
	 */
	private _summarizationRetryCallbacks(
		source: { source: "compaction"; reason: "threshold" | "overflow" },
	): RetryCallbacks {
		return {
			onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) => {
				this._emit({
					type: "summarization_retry_scheduled",
					attempt,
					maxAttempts,
					delayMs,
					errorMessage,
				});
			},
			onRetryAttemptStart: () => {
				this._emit({
					type: "summarization_retry_attempt_start",
					...source,
				});
			},
			onRetryFinished: () => {
				this._emit({ type: "summarization_retry_finished" });
			},
		};
	}

	private _finishCancelledRetry(): void {
		if (this._retryAttempt === 0) return;
		const attempt = this._retryAttempt;
		this._retryAttempt = 0;
		this._emit({
			type: "auto_retry_end",
			success: false,
			attempt,
			finalError: "Retry cancelled",
		});
	}

	/**
	 * Prepare a retryable error for continuation with exponential backoff.
	 * @returns true if the caller should continue the agent, false otherwise
	 */
	private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
		const settings = this._retry;
		if (!settings.enabled) {
			return false;
		}

		this._retryAttempt++;

		if (this._retryAttempt > settings.maxRetries) {
			// Preserve the completed attempt count so post-run handling can emit the final failure.
			this._retryAttempt--;
			return false;
		}

		const delayMs = retryDelayMs(settings, this._retryAttempt);

		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage ?? "Unknown error",
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.at(-1)?.role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			this._finishCancelledRetry();
			return false;
		} finally {
			this._retryAbortController = undefined;
		}

		return true;
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryAbortController?.abort();
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryAbortController !== undefined;
	}
}

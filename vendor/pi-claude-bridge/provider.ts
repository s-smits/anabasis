// Provider core copied from pi-claude-bridge v0.6.3 (github.com/elidickinson/pi-claude-bridge,
// commit 2bc9a7e, MIT). Adapted from index.ts without the pi-app extension interface:
// the default export (pi.on handlers, registerProvider, AskClaude tool), the TUI/summary/compaction
// helpers, and the app config loader. Comments marked "v4 boundary" identify local changes: adapted
// imports (SDK under the alias claude-agent-sdk-bridge, the repository's only copy of the SDK
// since every slot runs through this bridge), two inlined types whose declarations lived in
// unported files, pi's system prompt joining the CLI prompt append, and the exported initializer
// that replaces the config loader. V4 also removes unreachable extension helpers and fixes
// host discovery/MCP settings at the confined transport boundary.
// v4 boundary: imports adapted from index.ts lines 1-23 (drop pi-coding-agent, pi-tui, typebox,
// config.js, askclaude-ui.js, applyLongContext; SDK renamed to the alias).
import { type Api, type AssistantMessageEventStream, type Context, type ImageContent, type Model, type SimpleStreamOptions, type TextContent, type Tool, type UserMessage, createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, normalizeContext } from "@earendil-works/pi-ai";
import { type EffortLevel, type SDKResultMessage, query } from "claude-agent-sdk-bridge";
// v4 boundary: block types derived from the aliased SDK instead of the root @anthropic-ai/sdk, whose
// ContentBlockParam can differ from the copy bundled with the SDK.
type SdkMessageParam = import("claude-agent-sdk-bridge").SDKUserMessage["message"];
type ContentBlockParam = Exclude<SdkMessageParam["content"], string>[number];
type Base64ImageSource = Extract<Extract<ContentBlockParam, { type: "image" }>["source"], { type: "base64" }>;
import { deleteSession } from "cc-session-io";
import { type QueryTally, takeCompactSummaries } from "./compact-summary.js";
import { isNumber, isString, typeName } from "../../src/meta/json-shape.ts";
import { type BuiltinToolObserver, cliOwnedBuiltin } from "./cli-builtins.js";
import { messageContentToText } from "./convert.js";
import { type McpResult, extractAllToolResults as _extractAllToolResults } from "./extract-tool-results.js";
import { createToolServer } from "./mcp-server.js";
import { type LongContextSettings, claudeCodeModelId } from "./models.js";
import { makePromptStream, userMessage } from "./prompt-stream.js";
import { QueryContext } from "./query-state.js";
import { type SessionContinuity, type SyncResult, sessionContinuity } from "./session-continuity.js";
import { inspectServedModel } from "./result-identity.js";
import {
	MCP_SERVER_NAME, MCP_TOOL_PREFIX, type TurnTools,
	applyAssistantMessage, applyResultText, applyStreamEvent,
	completeStream, failCurrentStream, finalizeCurrentStream,
} from "./turn-translation.js";
import { runtimeProcess } from "../../src/meta/process.ts";
import { asError, errorMessage } from "../../src/meta/runtime-values.ts";
import { hasText } from "../../src/meta/text.ts";

// V4 owns one confined Built transport; app discovery and UI configuration are not part of it.
type BridgeProviderSettings = {
	pathToClaudeCodeExecutable?: string;
	/** v4 boundary: CLI builtins to enable by name beside pi's registered tools. Empty by default, the
	 *  upstream contract. Only server-side names belong here — a native file or shell builtin would open a second workspace that submit never sees. */
	builtinTools?: string[];
	/** v4 boundary: observes each CLI-owned builtin call so the host can record it (see cli-builtins.ts). */
	onBuiltinTool?: BuiltinToolObserver;
	/** v4 boundary: the CLI compacts at this many tokens instead of leaving context to the caller. One
	 *  query spans the host's whole Pi turn, so the caller cannot cut its context mid-query. */
	autoCompactWindow?: number;
	/** v4 boundary: observes each CLI compaction with its pre-compaction token count. */
	onCompaction?: (tokensBefore: number) => void;
	/** v4 boundary: observes the summary each CLI compaction wrote, read from the transcript at turn end. */
	onCompactionSummary?: (summary: string) => void;
	/** v4 boundary: the environment the CLI child starts from, this process's own when absent. Its
	 *  CLAUDE_CONFIG_DIR also names where the bridge writes and deletes session files, so two bridges
	 *  in one process keep their credentials and sessions apart. */
	env?: Record<string, string | undefined>;
	/** v4 boundary: the directory the CLI works in, else this process's. The Builder's CLI works in
	 *  its authoring workspace. */
	cwd?: string;
	/** v4 boundary: put the CLI's own `claude_code` preset ahead of the controller's prompt, the
	 *  upstream contract. Absent, the controller's prompt is the whole system prompt. */
	claudeCodePreset?: boolean;
};

/** v4 boundary: one bridge's state. Upstream keeps it at module scope, which allows one bridge per
 *  process; the Builder, the review slot and the Built child each open their own here. */
type Bridge = {
	readonly settings: BridgeProviderSettings;
	/** Every query with a live CLI, for routing a delivered tool result to its owner. */
	readonly active: Set<QueryContext>;
	/** Which CC session the next turn resumes, and what has to be rewritten first. */
	readonly continuity: SessionContinuity;
	/** The top-level query's context; a reentrant query gets its own. */
	top: QueryContext;
	readonly configDir: string | undefined;
	/** Pi compacted while the top query ran; its tool results open a fresh query. */
	restart: boolean;
};

// --- Constants ---

const longContextSettings: LongContextSettings = { plan: "pro", longContextExtraUsage: false };

// --- Provider helpers: tool name mapping ---

/** The tools to bridge plus both name directions between pi and the SDK. */
type ResolvedMcpTools = { mcpTools: Tool[]; customToolNameToSdk: Map<string, string>; customToolNameToPi: Map<string, string> };
// --- Usage helpers ---

/** The token counters this port reads. The SDK's message and delta usage types each declare a
 *  superset of them and neither carries an index signature. */
// --- Effort level mapping ---
// Pi reasoning levels → CC SDK effort levels

const REASONING_TO_EFFORT = new Map<string, EffortLevel>([
	["minimal", "low"], ["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "max"],
]);

type QueryOptions = NonNullable<Parameters<typeof query>[0]["options"]>;

/** One SDK query opening: the model and directory it runs in, the tool servers it may call, the
 *  controller's own system prompt append, its reasoning level and the session it resumes. */
type ClaudeQueryOpening = {
	readonly model: Model<Api>;
	readonly cwd: string;
	readonly mcpServers: ReturnType<typeof buildMcpServers>;
	readonly systemPromptAppend: string | undefined;
	readonly reasoning: SimpleStreamOptions["reasoning"];
	readonly resume: SyncResult;
	readonly settings: BridgeProviderSettings;
};

// v4 boundary: the return type of the authored createClaudeBridge at the end of this file.
/** The stream function pi's Agent calls, and the call its caller makes after rewriting the history
 *  the CLI session holds. Upstream marks that rebuild from pi's session_compact event, which only
 *  the pi app emits. */
export type ClaudeBridgeStream = ((model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream) & {
	historyRewritten: () => void;
};

// Pi doesn't pass tool results directly — it appends them to the context and
// calls the provider again.
function extractAllToolResults(context: Context): McpResult[] {
	return _extractAllToolResults(context.messages).results;
}

/** Index of the first message of the current user turn — the trailing run of
 *  user messages that has not been written into the Claude Code session yet.
 *  Equals messages.length when the last message is not a user message.
 *
 *  Single source of truth for the history/prompt split: everything before this
 *  index is replayed as session history, everything from it onward becomes the
 *  prompt. Deriving both halves from one index is what keeps a message from
 *  landing in both — an extension appending a display-only user message after
 *  the real one (see issue #34) makes the turn longer than one message. */
function turnStart(messages: Context["messages"]): number {
	let i = messages.length;
	while (i > 0 && messages[i - 1]?.role === "user") i--;
	return i;
}

/** Extract the current user turn as a prompt string. Returns null if the last message is not a user message. */
function extractUserPrompt(messages: Context["messages"]): string | null {
	const turn = /* SAFETY: turnStart walks back only over `role === "user"` rows, so the slice holds user messages only. */ messages.slice(turnStart(messages)) as UserMessage[];
	if (turn.length === 0) return null;
	// Drop empties before joining so an all-empty turn still yields "" and trips
	// the caller's empty-prompt guard rather than sending bare newlines.
	return turn
		.map((m) => (isString(m.content) ? m.content : messageContentToText(m.content)))
		.filter((text) => text)
		.join("\n");
}

/** Extract the current user turn as ContentBlockParam[] (preserving images).
 *  Returns null if no images — caller should fall back to string prompt. */
function extractUserPromptBlocks(messages: Context["messages"]): ContentBlockParam[] | null {
	const turn = /* SAFETY: turnStart walks back only over `role === "user"` rows, so the slice holds user messages only. */ messages.slice(turnStart(messages)) as UserMessage[];
	if (turn.length === 0) return null;

	let hasImage = false;
	const blocks: ContentBlockParam[] = [];
	for (const message of turn) {
		const content: (TextContent | ImageContent)[] = isString(message.content)
			? [{ type: "text", text: message.content }]
			: message.content;
		// Content outside UserMessage's declared shape cannot be converted. Name
		// the received type so the caller can locate the malformed context row.
		if (!Array.isArray(content)) {
			throw new Error(
				`extractUserPromptBlocks: user message content must be a string or block array, got ${typeName(content)} — likely a malformed message from another extension`,
			);
		}
		for (const block of content) {
			if (block.type === "text" && block.text) {
				blocks.push({ type: "text", text: block.text });
			} else if (block.type === "image") {
				// Guard before logging: data-less image blocks do occur, and reading
				// .length off the missing field in the debug template would throw
				// before this check ever runs (template args evaluate unconditionally).
				if (!block.data || !block.mimeType) {
					continue;
				}
				hasImage = true;
				blocks.push({
					type: "image",
					source: {
						type: "base64",
						// SAFETY: Pi supplies the image MIME type; this preserves it for the SDK's narrower type.
						media_type: block.mimeType as Base64ImageSource["media_type"],
						data: block.data,
					},
				});
			}
		}
	}
	return hasImage ? blocks : null;
}

function contextForToolResults(active: Set<QueryContext>, results: McpResult[]): QueryContext | undefined {
	for (const result of results) {
		const id = result.toolCallId;
		if (!hasText(id)) continue;
		for (const queryCtx of active) {
			if (queryCtx.pendingToolCalls.has(id) || queryCtx.pendingResults.has(id) || queryCtx.turnToolCallIds.includes(id)) {
				return queryCtx;
			}
		}
	}
	return undefined;
}

function resolveMcpTools(context: Context): ResolvedMcpTools {
	const mcpTools: Tool[] = [];
	const customToolNameToSdk = new Map<string, string>();
	const customToolNameToPi = new Map<string, string>();

	if (!context.tools) return { mcpTools, customToolNameToSdk, customToolNameToPi };

	for (const tool of context.tools) {
		const sdkName = `${MCP_TOOL_PREFIX}${tool.name}`;
		mcpTools.push(tool);
		customToolNameToSdk.set(tool.name, sdkName);
		customToolNameToSdk.set(tool.name.toLowerCase(), sdkName);
		customToolNameToPi.set(sdkName, tool.name);
		customToolNameToPi.set(sdkName.toLowerCase(), tool.name);
	}

	return { mcpTools, customToolNameToSdk, customToolNameToPi };
}

// Creates an MCP server that bridges pi tools to the SDK. Each tool handler
// blocks on a Promise until pi delivers the tool result via streamSimple.
// Handlers receive their toolCallId from Claude's tools/call _meta, so results
// are matched by ID end to end.
//
// The handler and pi's result can arrive in either order, hence the two maps:
// a result that lands first waits in `pendingResults` for the handler to claim
// it, and a handler that runs first parks its resolver in `pendingToolCalls`.
// Handlers close over the captured `queryCtx`, ensuring they operate on the
// correct query's state while multiple queries run concurrently.
function buildMcpServers(tools: Tool[], queryCtx: QueryContext): Record<string, ReturnType<typeof createToolServer>> | undefined {
	if (tools.length === 0) return undefined;
	const mcpTools = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.parameters,
		handler: async (toolCallId: string) => {
			const queued = queryCtx.pendingResults.get(toolCallId);
			if (queued !== undefined) {
				queryCtx.pendingResults.delete(toolCallId);
				return queued;
			}
			return new Promise<McpResult>((resolve) => {
				queryCtx.pendingToolCalls.set(toolCallId, { toolName: tool.name, resolve });
			});
		},
	}));
	return { [MCP_SERVER_NAME]: createToolServer(MCP_SERVER_NAME, mcpTools) };
}

// --- Provider: streaming function ---
//
// Push-based streaming with MCP tool bridge:
// 1. streamSimple starts a query() and kicks off consumeQuery() in background
// 2. consumeQuery() iterates the SDK generator, pushing events to currentPiStream
// 3. On tool_use: ends the current pi stream, nulls it out. The MCP handler
//    blocks the generator naturally — no events arrive until resolved.
// 4. Pi executes the tool, calls streamSimple again. We swap in the new stream,
//    resolve the MCP handler, and the generator unblocks — events flow to new stream.
//
// Note: resetTurnState clears turnSawStreamEvent while the generator may still
// have queued messages from the previous turn. This is safe because step 3 nulls
// currentPiStream, so any leftover messages hit the `!ctx().currentPiStream` guard
// in consumeQuery and are skipped while no Pi stream is active.

/** Background consumer: iterates the SDK generator, pushing events to currentPiStream.
 *  Runs until the query ends. Per turn, the SDK yields stream_events (deltas), then
 *  an assistant message (completed blocks). On tool_use, the stream is ended by
 *  whichever path handles it first (processStreamEvent or processAssistantMessage),
 *  and the MCP handler blocks the generator until pi delivers the tool result. */
async function consumeQuery(
	settings: BridgeProviderSettings,
	sdkQuery: ReturnType<typeof query>,
	turn: Pick<TurnTools, "model" | "toPi">,
	queryCtx: QueryContext,
	tally: QueryTally,
): Promise<{ sawResult: boolean }> {
	let sawResult = false;
	const { model } = turn;
	const tools: TurnTools = {
		...turn,
		// Neither a CLI builtin nor this MCP server's tool: the CLI answers it itself, so pi must not run it too (see the bridge test).
		cliKeepsTool: (name, call, toPi) => cliOwnedBuiltin(settings.builtinTools, settings.onBuiltinTool, name, call) || !(toPi.has(name) || toPi.has(name.toLowerCase())),
	};

	for await (const message of sdkQuery) {
		if (tally.aborted) break;
		// Ahead of the currentPiStream guard: nothing else closes the CLI's stdin
		// now that the prompt is a streamed generator (isSingleUserTurn=false), so
		// missing this would hang the query forever.
		if (message.type === "result") {
			sawResult = true;
			queryCtx.promptStream?.end();
			const servedModel = inspectServedModel(message, model);
			// A tool-use message closes the Pi stream before the SDK result arrives. Keep the served
			// model on the emitted message even then; responseId already holds the provider message id
			// captured at message_start. Multiple usage keys cannot supply one result-level model;
			// any identity already captured from the message itself remains available.
			if (queryCtx.turnOutput) {
				if (servedModel !== undefined) queryCtx.turnOutput.responseModel = servedModel;
			}
		}
		// v4: the CLI may compact between tool round-trips, while no Pi stream is open.
		if (message.type === "system" && message.subtype === "compact_boundary") {
			tally.compactions += 1;
			settings.onCompaction?.(message.compact_metadata.pre_tokens);
		}
		// Query-scoped, like the result identity and the compaction report above: the CLI announces
		// the session before the first turn, so reading it below the turn guard loses it whenever no
		// Pi stream is open yet.
		if (message.type === "system" && message.subtype === "init" && message.session_id) {
			tally.sessionId = message.session_id;
		}
		if (!queryCtx.currentPiStream || !queryCtx.turnOutput) continue;

		// oxlint-disable-next-line typescript/switch-exhaustiveness-check -- this external SDK stream intentionally logs unconsumed telemetry, including future event types.
		switch (message.type) {
			case "stream_event":
				applyStreamEvent(message, tools, queryCtx);
				break;
			case "assistant":
				applyAssistantMessage(message, tools, queryCtx);
				break;
			case "result":
				applyResult(message, tools, queryCtx);
				break;
			case "system":
				break;
			case "user":
				// SDK echo of the user prompt — no stream events to emit. Note it
				// carries only prompts and tool results: a steer CC drained at a
				// tool boundary is recorded in its session transcript as a
				// `queued_command` attachment and never reaches this stream, which
				// is why the mid-turn steering check has to live in the
				// integration test.
				break;
			case "rate_limit_event":
				break;
			default:
				break;
		}
	}

	return { sawResult };
}

/** v4 boundary: hands the host each summary the CLI wrote in this query: a stopped query from its
 *  abort, a settled one before its settle may delete the transcript. */
function reportCompactSummaries(bridge: Bridge, tally: QueryTally, fallbackSessionId: string | undefined, cwd: string): void {
	const summaries = takeCompactSummaries(tally, fallbackSessionId, cwd, bridge.configDir);
	for (const summary of summaries) bridge.settings.onCompactionSummary?.(summary);
}

/** v4 boundary: a provider refusal (a 429, a spent allowance) arrives as a result with is_error
 *  set, often with subtype "success" and the refusal as its text. Read as an answer it settled a
 *  dead provider as completed turns (runs 61 and 62: 32 turns, no tool call, no token), so it fails
 *  the turn in the SDK's own wording instead. A success result answers only a turn that no stream
 *  event and no assistant message carried: those already hold its text. */
function applyResult(message: SDKResultMessage, tools: TurnTools, queryCtx: QueryContext): void {
	const failure = resultFailure(message);
	if (failure !== null) failCurrentStream(queryCtx, failure);
	else if (!queryCtx.turnSawStreamEvent && queryCtx.turnBlocks.length === 0 && message.subtype === "success") {
		applyResultText(queryCtx, tools, message.result || "");
	}
}

/** The error a result carries, as the SDK words it when the CLI exits on one, or null for a
 *  successful result. */
function resultFailure(message: SDKResultMessage): string | null {
	if (!message.is_error) return null;
	const prefix = "Claude Code returned an error result: ";
	if (message.subtype !== "success") {
		const errors = message.errors.map((error) => error.trim()).filter(Boolean);
		return `${prefix}${errors.length > 0 ? errors.join("; ") : message.subtype}`;
	}
	const status = isNumber(message.api_error_status) ? ` (status ${String(message.api_error_status)})` : "";
	return `${prefix}${message.result || "no text"}${status}`;
}

/** The trailing user turn as content blocks, or null if there isn't one.
 *  Blocks rather than text so image steers keep their images. */
function steerBlocks(messages: Context["messages"]): ContentBlockParam[] | null {
	const blocks = extractUserPromptBlocks(messages);
	if (blocks) return blocks;
	const text = extractUserPrompt(messages);
	return hasText(text) ? [{ type: "text", text }] : null;
}

/** Releases this turn's tool results to their MCP handlers, after first pushing
 *  any steer to CC.
 *
 *  The ordering is mandatory, not an optimization. The steer and the MCP tool
 *  result travel back to CC over the same stdin FIFO. Awaiting the push ack
 *  (which resolves only once the SDK's write to stdin completed) before
 *  resolving any handler guarantees CC enqueues the steer *before* it reads the
 *  tool result, so its post-tool-call drain sees it and acts on it this turn.
 *  Resolve first and the steer can miss that read, arriving as a later
 *  follow-up instead.
 *
 *  Both the post-tool-call drain and the FIFO ordering are CC CLI internals,
 *  not SDK contract. An integration check must exercise that ordering after CLI changes. */
async function deliverToolResults(
	continuity: SessionContinuity,
	c: QueryContext,
	results: McpResult[],
	steer: ContentBlockParam[] | null,
): Promise<void> {
	if (steer) {
		if (c.promptStream) {
			try {
				await c.promptStream.push(userMessage(steer, "next"));
			} catch {
				// The query is ending; pushing further input could block tool-result
				// delivery, so the steer doesn't reach this query. It is still in
				// pi's context, and the caller has already advanced the session
				// cursor past it, so force a rebuild or CC would never see it.
				continuity.rebuildNextTurn();
			}
		} else {
			continuity.rebuildNextTurn();
		}
	}

	for (const result of results) {
		const id = result.toolCallId;
		const pending = hasText(id) ? c.pendingToolCalls.get(id) : undefined;
		if (hasText(id) && pending) {
			c.pendingToolCalls.delete(id);
			pending.resolve(result);
		} else if (hasText(id)) {
			c.pendingResults.set(id, result);
		}
	}
}

/**
 * The options one CLI query runs under. Everything the caller may vary — the model, the
 * directory, its MCP servers, the appended system prompt, the reasoning level and the
 * session it resumes — is a parameter; every other value here is a v4 boundary the caller
 * does not get to move.
 */
function claudeQueryOptions(opening: ClaudeQueryOpening): QueryOptions {
	const { model, cwd, mcpServers, systemPromptAppend, reasoning, resume, settings } = opening;
	const claudeExecutable = settings.pathToClaudeCodeExecutable;

	// Prefer the model's own thinkingLevelMap when present (pi-ai 0.72+ ships
	// per-model overrides — e.g. opus-4-7 wants xhigh→xhigh, not xhigh→max).
	// Fall back to our generic table for older pi-ai or unmapped levels.
	const effort = reasoning
		? (/* SAFETY: a registry that ships thinkingLevelMap spells its values in the SDK's effort set; anything else falls through to the table below. */ model.thinkingLevelMap?.[reasoning] as EffortLevel | undefined)
			?? REASONING_TO_EFFORT.get(reasoning)
		: undefined;

	// cliModel is the actual id sent to Claude Code (may carry [1m]); model.id is the
	// pi-registered id. Log cliModel so debug lines reflect what CC actually received.
	const cliModel = claudeCodeModelId(model, longContextSettings);
	// The CLI flags the SDK forwards verbatim: a value, or null for a flag that carries none.
	const extraArgs = new Map<string, string | null>([["model", cliModel], ["strict-mcp-config", null]]);
	// Opus 4.7 defaults thinking.display to "omitted" (empty thinking text in stream).
	// Force summarized so thinking_delta events arrive. See anthropics/claude-agent-sdk-python#830.
	if (effort) extraArgs.set("thinking-display", "summarized");

	// Suppress claude.ai cloud MCP servers (Figma/Canva/etc. auto-discovered via OAuth
	// when the user is logged into Anthropic). These are a separate code path from
	// filesystem MCP and are not blocked by --strict-mcp-config or settingSources alone.
	// The native CC binary gates them on env var ENABLE_CLAUDEAI_MCP_SERVERS: setting it
	// to "0"/"false"/"no"/"off" makes the loader return early before any cloud fetch.
	// DISABLE_AUTO_COMPACT=1 leaves context management with the caller; CC compacting too would
	// invalidate the prompt cache twice and race the caller's threshold (issue #8). v4 boundary:
	// a caller that sets autoCompactWindow does not compact itself, so CC compacts there.
	const childEnv = {
		...(settings.env ?? Bun.env),
		ENABLE_CLAUDEAI_MCP_SERVERS: "0",
		...(settings.autoCompactWindow === undefined
			? { DISABLE_AUTO_COMPACT: "1" }
			: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(settings.autoCompactWindow) }) };
	return {
		cwd,
		env: childEnv,
		// Upstream disables every CLI builtin: pi's registered tools are the whole contract. The Built
		// files preset is DraftStore-backed (src/solve/draft-files.ts), so no builtin is a twin —
		// a native Write would open a second workspace that submit never sees. The caller may name
		// server-side builtins (WebSearch), which own no local path.
		tools: settings.builtinTools ?? [],
		// v4 boundary: no CLI skill discovery — the Built prompt may not vary with host state.
		skills: [],
		permissionMode: "bypassPermissions",
		// v4 boundary: documented as required beside bypassPermissions at SDK 0.3.271 (sdk.d.ts:1861).
		allowDangerouslySkipPermissions: true,
		includePartialMessages: true,
		// v4 boundary: the preset carries the CLI's own framing and this host's directory and git
		// state, none of which the controller's prompt digest records, so only a caller that asks
		// for it gets it.
		systemPrompt: settings.claudeCodePreset === true
			? {
				type: "preset", preset: "claude_code",
				...(hasText(systemPromptAppend) ? { append: systemPromptAppend } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
			}
			: (systemPromptAppend ?? ""),
		extraArgs: Object.fromEntries(extraArgs),
		...(effort ? { effort } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
		settingSources: [],
		...(mcpServers ? { mcpServers } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
		...(hasText(resume.sessionId) && resume.forkOf === undefined ? { resume: resume.sessionId } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
		// v4 boundary: a fork resumes that session's content under the id continuity chose for it.
		...(resume.forkOf === undefined ? {} : { resume: resume.forkOf, forkSession: true, sessionId: resume.sessionId }), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
		...(hasText(claudeExecutable) ? { pathToClaudeCodeExecutable: claudeExecutable } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
	};
}

/** Provider entry point. Pi calls this for each new prompt and each tool result.
 *  Two cases: tool result delivery (active query) or fresh query. */
function streamClaudeAgentSdk(bridge: Bridge, model: Model<Api>, transcript: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const { active, continuity } = bridge;
	const stream = createAssistantMessageEventStream();
	// pi 0.86 carries the prompt and tools as transcript system messages rather than context
	// fields; replay them here so the rest of the bridge keeps one message list without them.
	const { messages } = normalizeContext(transcript);
	const context: Context = {
		systemPrompt: getCurrentSystemPrompt(messages),
		tools: getCurrentTools(messages),
		messages: messages.filter((message) => message.role !== "system"),
	};

	const lastMsgRole = context.messages.at(-1)?.role;
	const allResults = active.size > 0 ? extractAllToolResults(context) : [];
	const resultCtx = allResults.length > 0 ? contextForToolResults(active, allResults) : undefined;

	// --- Tool result delivery ---
	// Pi appends tool results to context and calls back. Extract this turn's results
	// (everything after the last assistant message) and match against waiting MCP
	// handlers. Results that arrive before their handler get queued in pendingResults.
	if (resultCtx) {
		resultCtx.currentPiStream = stream;
		resultCtx.resetTurnState(model);
		// User messages (steer/followUp) pi injected into context during the
		// active query: a steer sent while a tool was executing, drained by pi at
		// the turn boundary and appended alongside the tool result.
		const steer = lastMsgRole === "user" ? steerBlocks(context.messages) : null;
		// Delivery is async because the steer must reach CC's stdin *before* the
		// tool result does — see deliverToolResults. Detached so the provider
		// still returns its stream synchronously.
		void deliverToolResults(continuity, resultCtx, allResults, steer).catch((error) => {
			resultCtx.promptStream?.fail(asError(error));
			resultCtx.liveOutput.stopReason = "error";
			resultCtx.liveOutput.errorMessage = String(error);
			const failedStream = resultCtx.currentPiStream;
			failedStream?.push({ type: "error", reason: "error", error: resultCtx.liveOutput });
			completeStream(failedStream);
			resultCtx.currentPiStream = null;
		});
		continuity.advancedTo(context.messages.length);
		resultCtx.latestCursor = Math.max(resultCtx.latestCursor, context.messages.length);
		return stream;
	}

	// --- Orphaned tool result (e.g. user aborted a tool call) ---
	// The query is gone but pi still delivered the result. Nothing to do — just
	// emit end_turn so pi waits for the next real user message.
	const lastMsg = context.messages.at(-1);
	if (lastMsg?.role === "toolResult" && !bridge.restart) {
		continuity.advancedTo(context.messages.length);
		const c = bridge.top;  // capture current context for the microtask
		queueMicrotask(() => {
			c.resetTurnState(model);
			stream.push({ type: "done", reason: "stop", message: c.liveOutput });
			completeStream(stream);
		});
		return stream;
	}

	// --- Fresh query ---

	// 1. Determine reentrancy. Reentrant queries get their own QueryContext so
	//    background subagents can run concurrently with the parent query.
	const isReentrant = bridge.top.activeQuery !== null;
	const queryCtx = isReentrant ? new QueryContext() : bridge.top;

	// 2. Fresh child context — constructor already gave us clean Maps and empty
	//    arrays. For a reused top-level context, clear explicitly.
	queryCtx.currentPiStream = stream;
	queryCtx.pendingToolCalls.clear();
	queryCtx.pendingResults.clear();
	// Stale ids would let a late result from the previous query route here via
	// contextForToolResults — which now means pushing its steer into this
	// query's stdin, not just mismatching a map.
	queryCtx.turnToolCallIds = [];
	queryCtx.resetTurnState(model);
	queryCtx.latestCursor = 0;

	const { mcpTools, customToolNameToSdk, customToolNameToPi } = resolveMcpTools(context);
	// v4 boundary: pi-agent-core's Agent never puts a working directory on the options bag, so the
	// bridge's own setting decides; absent means this process's cwd.
	const cwd = bridge.settings.cwd ?? runtimeProcess.cwd();
	const priorMessages = context.messages.slice(0, turnStart(context.messages));
	const syncResult = continuity.sync(priorMessages, cwd, customToolNameToSdk, model.id);
	// With no usable text or image prompt left (a non-user tail, or empty user content), a
	// continuation prompt keeps the SDK from sending an empty text block.
	const promptText = extractUserPrompt(context.messages);
	const prompt: ContentBlockParam[] = extractUserPromptBlocks(context.messages)
		?? [{ type: "text", text: hasText(promptText) ? promptText : "[continue]" }];

	// Always stream the prompt rather than passing a string: a parked input
	// generator is what lets us write steers to CC's stdin mid-turn. The cost is
	// that `isSingleUserTurn` is false, so the SDK no longer closes stdin on the
	// first result — consumeQuery ends the stream explicitly instead, or the
	// query would never terminate.
	const promptStream = makePromptStream();
	// A push rejection means the SDK already closed the stream; consumeQuery
	// reports that end through its own result, so there is nothing to add here.
	void promptStream.push(userMessage(hasText(syncResult.carried) ? [{ type: "text", text: syncResult.carried }, ...prompt] : prompt)).catch(() => {});
	queryCtx.promptStream = promptStream;
	const promptAppend = context.systemPrompt?.trim();
	const queryOptions = claudeQueryOptions({
		model,
		cwd,
		mcpServers: buildMcpServers(mcpTools, queryCtx),
		// The Built prompt is controller-owned. Host AGENTS.md, skills and settings never join it.
		systemPromptAppend: hasText(promptAppend) ? promptAppend : undefined,
		reasoning: options?.reasoning,
		resume: syncResult,
		settings: bridge.settings,
	});

	// 3. Start SDK query and claim it for this context
	const tally: QueryTally = { aborted: false, compactions: 0, sessionId: undefined };
	const sdkQuery = query({ prompt: promptStream.stream, options: queryOptions });
	queryCtx.activeQuery = sdkQuery;
	active.add(queryCtx);

	// 4. Capture context for abort handling
	const abortCtx = queryCtx;

	const requestAbort = () => {
		// interrupt() asks the CLI to stop gracefully; close() kills it immediately.
		// Both are needed — interrupt alone lets the current API call finish.
		void sdkQuery.interrupt().catch(() => {});
		try {
			sdkQuery.close();
		} catch {
			// the query may already be closed
		}
	};
	const onAbort = () => {
		tally.aborted = true;
		// Terminate the input generator and settle its acks — the pump abandons
		// iteration on abort, so an in-flight push would otherwise hang forever
		// and take tool-result delivery with it.
		promptStream.fail(new Error("Operation aborted"));
		for (const pending of abortCtx.pendingToolCalls.values()) { pending.resolve({ content: [{ type: "text", text: "Operation aborted" }] }); }
		abortCtx.pendingToolCalls.clear();
		abortCtx.pendingResults.clear();
		// v4 boundary: the stop is recorded now, not when the stopped CLI exits. Until then the next
		// prompt, carrying this turn's tool results, routed into this query as a steer and failed as
		// aborted, and its sync missed the abort (live check of 2026-09-22, round two after end_round).
		reportCompactSummaries(bridge, tally, continuity.state()?.sessionId, cwd);
		continuity.aborted();
		active.delete(abortCtx);
		if (bridge.top === abortCtx) bridge.top = new QueryContext();
		requestAbort();
	};
	queryCtx.abort = onAbort;
	bridge.restart = false;
	if (options?.signal) {
		if (options.signal.aborted) onAbort();
		else options.signal.addEventListener("abort", onAbort, { once: true });
	}

	// Background consumer — runs until query ends
	consumeQuery(bridge.settings, sdkQuery, { model, toPi: customToolNameToPi }, queryCtx, tally)
		.then(async ({ sawResult }) => {

			// --- Abort detection in normal completion path ---
			if (tally.aborted || options?.signal?.aborted === true) {
				if (queryCtx.turnOutput) {
					queryCtx.turnOutput.stopReason = "aborted";
					queryCtx.turnOutput.errorMessage = "Operation aborted";
				}
				const piStream = queryCtx.currentPiStream;
				piStream?.push({ type: "error", reason: "aborted", error: queryCtx.liveOutput });
				completeStream(piStream);
				queryCtx.currentPiStream = null;
				return;
			}

			// --- Capture session ID ---
			const capturedSessionId = tally.sessionId;
			const sessionId = capturedSessionId ?? continuity.state()?.sessionId;
			reportCompactSummaries(bridge, tally, sessionId, cwd);
			if (syncResult.held) {
				// The session this turn started is not the one the bridge is tracking.
				if (hasText(capturedSessionId) && capturedSessionId !== continuity.state()?.sessionId) {
					deleteSession(capturedSessionId, cwd, bridge.configDir);
				}
			} else if (!sawResult || queryCtx.turnOutput?.stopReason === "error") {
				// A refused or unanswered turn is not the session's continuation: pi retries it with the
				// same history, which only a rebuild gives back. The thrown path below settles the same way.
				continuity.failed();
			} else if (hasText(sessionId)) {
				continuity.settled(sessionId, Math.max(context.messages.length, queryCtx.latestCursor), cwd);
			}

			if (!isReentrant && queryCtx.activeQuery === sdkQuery) {
				queryCtx.activeQuery = null;
			}
			// v4 boundary: a CLI that exits cleanly before any result leaves the turn unanswered.
			if (sawResult) finalizeCurrentStream(queryCtx, queryCtx.turnOutput?.stopReason);
			else failCurrentStream(queryCtx, "claude stream ended before the turn completed");
		})
		.catch((error) => {
			reportCompactSummaries(bridge, tally, continuity.state()?.sessionId, cwd);
			if (!tally.aborted && options?.signal?.aborted !== true) continuity.failed();
			promptStream.fail(asError(error));
			if (queryCtx.turnOutput) {
				queryCtx.turnOutput.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
				queryCtx.turnOutput.errorMessage = errorMessage(error);
			}
			if (!isReentrant && queryCtx.activeQuery === sdkQuery) {
				for (const pending of queryCtx.pendingToolCalls.values()) { pending.resolve({ content: [{ type: "text", text: "Query ended" }] }); }
				queryCtx.pendingToolCalls.clear();
				queryCtx.pendingResults.clear();
				queryCtx.activeQuery = null;
			}
			const piStream = queryCtx.currentPiStream;
			piStream?.push({ type: "error", reason: queryCtx.turnOutput?.stopReason === "aborted" ? "aborted" : "error", error: queryCtx.liveOutput });
			completeStream(piStream);
			queryCtx.currentPiStream = null;
		})
		.finally(() => {
			if (options?.signal) options.signal.removeEventListener("abort", onAbort);
			// Settle any ack still parked in the generator — the CLI is gone, so
			// nothing will resume it. Clear the handle only if a later query
			// hasn't already claimed the shared context.
			promptStream.fail(new Error("query ended"));
			if (queryCtx.promptStream === promptStream) queryCtx.promptStream = null;
			if (queryCtx.activeQuery === sdkQuery) {
				// Drain pending handlers for this query
				for (const pending of queryCtx.pendingToolCalls.values()) { pending.resolve({ content: [{ type: "text", text: "Query ended" }] }); }
				queryCtx.pendingToolCalls.clear();
				queryCtx.pendingResults.clear();
				queryCtx.activeQuery = null;
			}
			// v4 boundary: the next prompt may already have reclaimed the shared top context by now.
			if (queryCtx.activeQuery === null) active.delete(queryCtx);
			sdkQuery.close();
		});

	return stream;
}

// v4 boundary (authored tail; not from pi-claude-bridge): the extension default
// export is not ported. Each caller opens its own bridge instead of the app config
// loader, and hands the returned stream function to pi's Agent as its streamFn.
export type { BridgeProviderSettings };
export function createClaudeBridge(settings: BridgeProviderSettings): ClaudeBridgeStream {
	const configDir = (settings.env ?? Bun.env).CLAUDE_CONFIG_DIR;
	const bridge: Bridge = { settings, active: new Set(), continuity: sessionContinuity(configDir, settings.autoCompactWindow), top: new QueryContext(), configDir, restart: false };
	const stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => streamClaudeAgentSdk(bridge, model, context, options);
	return Object.assign(stream, { historyRewritten: () => historyRewritten(bridge) });
}

/** v4 boundary: pi compacted. A live CLI query holds the uncompacted history and takes every tool
 *  result of its turn, so it would never see the rewrite (live120-pi5 compacted 10 times in one turn
 *  while the CLI grew to 151k). Stop it; pi's next request opens a fresh query on the rewritten file. */
function historyRewritten(bridge: Bridge): void {
	const live = bridge.top;
	if (live.activeQuery === null) return bridge.continuity.rebuildNextTurn();
	// Its abort gives the rewrite a fresh id, since the stopped CLI may still flush into its file.
	bridge.restart = true;
	live.abort?.();
}
export { consumeQuery as consumeQueryForTest };

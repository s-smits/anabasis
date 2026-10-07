// Copied from pi coding-agent v1.0.0 (github.com/earendil-works/pi, a13d35a, MIT, see LICENSE):
// packages/coding-agent/src/core/extensions/types.ts, only the members the copied tools read. Left
// out: the extension runtime (UI, session manager, model registry, loadout, exposure, namespaces,
// annotations and renderers), which Anabasis does not host. The tools run with no context, so they
// fall back to the cwd they were created with and to no session environment.

import type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode } from "@earendil-works/pi-agent-core";
import type { Api, ConstrainedSamplingConfig, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";

/** The read-only session members the bash tool reads for its PI_* environment. */
interface ReadonlySessionManager {
	getSessionId(): string;
	getSessionFile(): string | undefined;
}

export interface ExtensionContext {
	/** Current working directory */
	cwd: string;
	/** Session manager (read-only) */
	sessionManager: ReadonlySessionManager;
	/** Current model (may be undefined) */
	model: Model<Api> | undefined;
	/** Current thinking level, when provided by the session runtime. */
	thinkingLevel?: ThinkingLevel | undefined;
}

export interface ExtensionToolContext extends ExtensionContext {}

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, _TState = any> {
	/** Tool name (used in LLM tool calls) */
	name: string;
	/** Human-readable label for UI */
	label: string;
	/** Description for LLM */
	description: string;
	/** Optional one-line snippet for the Available tools section in the default system prompt. Custom tools are omitted from that section when this is not provided. */
	promptSnippet?: string | undefined;
	/** Optional guideline bullets appended to the default system prompt Guidelines section when this tool is active. */
	promptGuidelines?: string[] | undefined;
	/** Parameter schema (TypeBox) */
	parameters: TParams;
	/** Optional provider-side constrained sampling request for this tool. Set false to explicitly disable it, equivalent to leaving it undefined. */
	constrainedSampling?: false | ConstrainedSamplingConfig | undefined;
	/** Controls whether ToolExecutionComponent renders the standard colored shell or the tool renders its own framing. */
	renderShell?: "default" | "self" | undefined;

	/** Optional compatibility shim to prepare raw tool call arguments before schema validation. Must return an object conforming to TParams. */
	prepareArguments?: ((args: unknown) => Static<TParams>) | undefined;

	/**
	 * JSON Schema of `structuredContent` in successful results. Tools that declare it should always
	 * set `structuredContent`; codemode scripts then receive it instead of the text content.
	 */
	outputSchema?: TSchema | undefined;

	/**
	 * Per-tool execution mode override.
	 * - "sequential": this tool must execute one at a time with other tool calls.
	 * - "parallel": this tool can execute concurrently with other tool calls.
	 *
	 * If omitted, the default execution mode applies.
	 */
	executionMode?: ToolExecutionMode | undefined;

	/** Execute the tool. */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ExtensionToolContext,
	): Promise<AgentToolResult<TDetails>>;
}

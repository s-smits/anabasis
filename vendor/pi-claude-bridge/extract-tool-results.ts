// Tool-result extraction: walks the context tail to collect this turn's
// tool results. Pi appends results to context and calls the provider again;
// this scrapes them back out. Walks past user messages (steer/followUp) that
// pi may inject between toolResults. Stops at the nearest assistant message
// (turn boundary).
// Extracted from index.ts so tests can import without activating the extension.

import { asRecord, isString } from "../../src/meta/json-shape.ts";

type McpContent = Array<
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
>;

export interface McpResult {
	content: McpContent;
	isError?: boolean | undefined;
	toolCallId?: string | undefined;
}

/** The context rows this walk reads. Pi carries further keys the walk never opens. */
type ContextMessage = { role: string; content?: unknown; toolCallId?: string; isError?: boolean };

/** Returned together so callers can log the walk boundary. */
type ExtractedToolResults = { results: McpResult[]; stopIdx: number };

function toolResultToMcpContent(content: unknown): McpContent {
	if (isString(content)) return [{ type: "text", text: content || "" }];
	if (!Array.isArray(content)) return [{ type: "text", text: "" }];
	const blocks: McpContent = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (block?.type === "text" && isString(block.text)) blocks.push({ type: "text", text: block.text });
		else if (block?.type === "image" && isString(block.data) && isString(block.mimeType)) blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
	}
	return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

export function extractAllToolResults(messages: ContextMessage[]): ExtractedToolResults {
	const results: McpResult[] = [];
	let stopIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "toolResult") {
			results.unshift({ content: toolResultToMcpContent(msg.content), isError: msg.isError, toolCallId: msg.toolCallId });
		} else if (msg?.role === "assistant") { stopIdx = i; break; }
		// user messages: skip (steer/followUp injected mid-tool-execution)
	}
	return { results, stopIdx };
}

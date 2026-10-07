// Copied from pi-claude-bridge 0.9.1 at main (github.com/elidickinson/pi-claude-bridge, e870bc89, MIT, see
// LICENSE): src/extract-tool-results.ts, verbatim but for the compiler: this repository's strict options
// force the `!` on indexed reads and the `| undefined` on optional fields. Only this file and its three
// siblings come over: src/backends/claude.ts replaces index.ts, the extension around them.
// Tool-result extraction: walks the context tail to collect this turn's
// tool results. Pi appends results to context and calls the provider again;
// this scrapes them back out. Walks past user messages (steer/followUp) that
// pi may inject between toolResults. Stops at the nearest assistant message
// (turn boundary).
// Extracted from index.ts so tests can import without activating the extension.

export type McpContent = Array<
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
>;

export interface McpResult {
	content: McpContent;
	isError?: boolean | undefined;
	toolCallId?: string | undefined;
	[key: string]: unknown;
}

export function toolResultToMcpContent(
	content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): McpContent {
	if (typeof content === "string") return [{ type: "text", text: content || "" }];
	if (!Array.isArray(content)) return [{ type: "text", text: "" }];
	const blocks: McpContent = [];
	for (const block of content) {
		if (block.type === "text" && block.text) blocks.push({ type: "text", text: block.text });
		else if (block.type === "image" && block.data && block.mimeType) blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
	}
	return blocks.length ? blocks : [{ type: "text", text: "" }];
}

// Returns { results, stopIdx } so callers can log the walk boundary.
export function extractAllToolResults(
	messages: Array<{ role: string; content?: unknown; toolCallId?: string; isError?: boolean; [key: string]: unknown }>,
): { results: McpResult[]; stopIdx: number } {
	const results: McpResult[] = [];
	let stopIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]!;
		if (msg.role === "toolResult") {
			results.unshift({ content: toolResultToMcpContent(msg.content as string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>), isError: msg.isError, toolCallId: msg.toolCallId });
		} else if (msg.role === "assistant") { stopIdx = i; break; }
		// user messages: skip (steer/followUp injected mid-tool-execution)
	}
	return { results, stopIdx };
}

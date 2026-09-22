// In-process MCP server that exposes pi tools to Claude Code.
//
// Pi declares tool parameters as TypeBox objects, which are already JSON
// Schema at runtime — the same thing MCP puts on the wire. This serves them
// verbatim instead of going through the SDK's `createSdkMcpServer`, which only
// accepts Zod and therefore forces a JSON Schema → Zod → JSON Schema round
// trip. That round trip is lossy below the top level: nested objects collapse
// to open records and `anyOf`/`const` vanish, so Claude saw only the first
// level of any tool with a nested schema — including the builtin `edit`.
//
// Handlers go on the underlying protocol server rather than through
// `McpServer.registerTool`, which is the Zod-only path. Skipping registerTool
// also skips its argument validation, which is what we want: pi validates and
// executes tools itself, and the arguments MCP sees are discarded. A rejection
// there would only prevent the handler from running, stranding the call.
//
// This rests on the Agent SDK treating what we hand it as an opaque JSON-RPC
// endpoint: `connectSdkMcpServer` in sdk.mjs calls `instance.connect(transport)`
// and nothing else, so none of McpServer's higher-level machinery is required.
// The `McpServer` wrapper is kept only because the SDK's `mcpServers` option is
// typed against that class. If this breaks after an SDK update, check whether
// the SDK began inspecting the instance — reading registered tools, or expecting
// tools/list_changed notifications we never send.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type JsonObject, asRecord, isString } from "../../src/meta/json-shape.ts";
import type { McpResult } from "./extract-tool-results.js";

// Claude Code fingerprints every tools/call with the id of the tool_use block it came
// from. That is the only reliable way to pair a call with its result: call order
// is not guaranteed to match the order the tool_use blocks were emitted, so
// counting calls mispairs results as soon as the two diverge.
//
// This is a Claude Code extension, not part of the MCP spec — CC sets it in
// `src/services/mcp/client.ts` (see reference-code/claude-code-rip). If CC ever
// stops sending it, every tool call fails with the error below rather than
// silently pairing results to the wrong call, which is the intended tradeoff.
const TOOL_USE_ID_META = "claudecode/toolUseId";

interface McpToolDef {
	name: string;
	description: string;
	inputSchema: unknown;
	handler: (toolCallId: string) => Promise<McpResult>;
}

const EMPTY_SCHEMA: JsonObject = { type: "object", properties: {} };

export function createToolServer(name: string, tools: McpToolDef[]) {
	const server = new McpServer({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
	const byName = new Map(tools.map((tool) => [tool.name, tool]));

	server.server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((tool) => {
			// Tool parameters come from arbitrary pi extensions; MCP requires an
			// object schema, so anything else is advertised as taking no arguments
			// rather than being put on the wire malformed.
			const schema = asRecord(tool.inputSchema);
			return {
				name: tool.name,
				description: tool.description,
				inputSchema: schema?.type === "object" && schema.properties !== undefined ? schema : EMPTY_SCHEMA,
			};
		}),
	}));

	server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = byName.get(request.params.name);
		if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
		const toolCallId = request.params._meta?.[TOOL_USE_ID_META];
		if (!isString(toolCallId)) {
			throw new Error(`${tool.name}: tools/call is missing _meta["${TOOL_USE_ID_META}"] — cannot pair the result with its tool call`);
		}
		// Narrowed deliberately: McpResult also carries `toolCallId`, which is our
		// own bookkeeping for pairing and not part of MCP's CallToolResult.
		const { content, isError } = await tool.handler(toolCallId);
		return { content, isError };
	});

	return { type: "sdk" as const, name, instance: server };
}

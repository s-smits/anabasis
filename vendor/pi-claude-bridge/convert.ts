// Pure pi→Anthropic message conversion helpers.
// Extracted so they can be tested without pulling in the full extension runtime.

import type { Message as PiMessage } from "@earendil-works/pi-ai";
import type { ContentBlock, Message as SessionMessage } from "cc-session-io";
import { pascalCase } from "change-case";
import { isString } from "../../src/meta/json-shape.ts";
import { hasText } from "../../src/meta/text.ts";

const PROVIDER_ID = "claude-bridge";

const PI_TO_SDK_TOOL_NAME = new Map([
	["read", "Read"],
	["write", "Write"],
	["edit", "Edit"],
	["bash", "Bash"],
]);

type PiUserContent = Extract<PiMessage, { role: "user" }>["content"];
type PiAssistant = Extract<PiMessage, { role: "assistant" }>;
type PiToolResult = Extract<PiMessage, { role: "toolResult" }>;
type PiThinking = Extract<PiAssistant["content"][number], { type: "thinking" }>;

type ToolIds = { readonly idFor: (id: string) => string };

/**
 * A session id may hold only `[A-Za-z0-9_-]`, so a pi id is cleaned. Cleaning alone is
 * not enough: `call:1` and `call_1` clean to the same string, and a session holding two
 * tool_use blocks under one id binds the second result to the first call. One pi id
 * therefore keeps one session id, and two pi ids never share one.
 */
function sessionToolIds(): ToolIds {
	const held = new Map<string, string>();
	const taken = new Set<string>();
	return {
		idFor: (id) => {
			const known = held.get(id);
			if (known !== undefined) return known;
			const clean = id.replace(/[^a-zA-Z0-9_-]/g, "_");
			let unique = clean;
			for (let suffix = 2; taken.has(unique); suffix += 1) unique = `${clean}_${suffix}`;
			taken.add(unique);
			held.set(id, unique);
			return unique;
		},
	};
}

function mapPiToolNameToSdk(name: string, customToolNameToSdk?: Map<string, string>): string {
	if (!name) return "";
	const normalized = name.toLowerCase();
	const custom = customToolNameToSdk?.get(name) ?? customToolNameToSdk?.get(normalized);
	return custom ?? PI_TO_SDK_TOOL_NAME.get(normalized) ?? pascalCase(name);
}

/**
 * Flatten pi content to text. A block kind with no counterpart is named in place, but a
 * message of nothing but such placeholders carried no text and is reported as none.
 */
export function messageContentToText(
	content: string | ReadonlyArray<{ type: string; text?: string }>,
): string {
	if (isString(content)) return content;
	const parts = [];
	let carriedText = false;
	for (const block of content) {
		if (block.type === "text" && hasText(block.text)) {
			parts.push(block.text);
			carriedText = true;
		} else if (block.type !== "text" && block.type !== "image") parts.push(`[${block.type}]`);
	}
	return carriedText ? parts.join("\n") : "";
}

/** A thinking block replays only behind the signature the API verifies it against. */
function replayableThinking(block: PiThinking, message: PiAssistant): ContentBlock | null {
	const signature = block.thinkingSignature;
	const fromAnthropic = message.provider === PROVIDER_ID || message.api === "anthropic";
	if (!fromAnthropic || !hasText(signature)) return null;
	return { type: "thinking", thinking: block.thinking ?? "", signature };
}

function userTurn(content: PiUserContent): SessionMessage {
	if (isString(content)) return { role: "user", content: content || "[empty]" };
	const parts: ContentBlock[] = [];
	for (const block of content) {
		if (block.type === "text" && block.text) parts.push({ type: "text", text: block.text });
		else if (block.type === "image" && block.data && block.mimeType) {
			const source = { type: "base64", media_type: block.mimeType, data: block.data } as const;
			parts.push({ type: "image", source });
		}
	}
	if (parts.length > 0) return { role: "user", content: parts };
	// The API rejects an empty turn, so something stands in its place — and it says which
	// of the two happened, an image the session cannot hold or a turn that held nothing.
	const hadImage = content.some((block) => block.type === "image");
	return { role: "user", content: hadImage ? "[image]" : "[empty]" };
}

function assistantTurn(
	message: PiAssistant,
	ids: ToolIds,
	customToolNameToSdk?: Map<string, string>,
): SessionMessage {
	const blocks: ContentBlock[] = [];
	for (const block of message.content) {
		if (block.type === "text" && block.text) blocks.push({ type: "text", text: block.text });
		else if (block.type === "thinking") {
			const thinking = replayableThinking(block, message);
			if (thinking !== null) blocks.push(thinking);
		} else if (block.type === "toolCall") {
			const name = mapPiToolNameToSdk(block.name, customToolNameToSdk);
			blocks.push({ type: "tool_use", id: ids.idFor(block.id), name, input: block.arguments ?? {} });
		}
	}
	if (blocks.length > 0) return { role: "assistant", content: blocks };
	// Everything the turn said was unreplayable, but the turn still holds its place in
	// the history, and the API rejects an assistant message with no content.
	return { role: "assistant", content: [{ type: "text", text: "[incompatible content omitted]" }] };
}

function toolResultBlock(message: PiToolResult, ids: ToolIds): ContentBlock {
	return {
		type: "tool_result",
		tool_use_id: ids.idFor(message.toolCallId),
		content: messageContentToText(message.content),
		is_error: message.isError,
	};
}

/** Convert a pi conversation into the history a Claude Code session resumes from. */
export function convertPiMessages(
	messages: readonly PiMessage[],
	customToolNameToSdk?: Map<string, string>,
): SessionMessage[] {
	const ids = sessionToolIds();
	// Pi holds one message per tool result. The session answers parallel calls in one user turn,
	// and the pairing repair drops a second result turn as an orphan (pi6 rewrite, 2026-09-22).
	let results: ContentBlock[] | null = null;
	return messages.flatMap((message): SessionMessage[] => {
		// The prompt and tools ride the SDK query options, never the resumed session file.
		if (message.role === "system") return [];
		if (message.role === "toolResult") {
			const opens = results === null;
			(results ??= []).push(toolResultBlock(message, ids));
			return opens ? [{ role: "user", content: results }] : [];
		}
		results = null;
		if (message.role === "user") return [userTurn(message.content)];
		return [assistantTurn(message, ids, customToolNameToSdk)];
	});
}

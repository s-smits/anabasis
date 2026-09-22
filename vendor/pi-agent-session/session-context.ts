// Copied from pi agent v0.86.1 (github.com/earendil-works/pi, commit 13cbf77df, MIT,
// see LICENSE): the session context projection from
// packages/agent/src/harness/session/context.ts, which the installed package does not export.
// The source is byte-identical in v0.87.0. The compaction entry's `systemMessage` and its replay
// ahead of the summary are copied from pi coding-agent's
// packages/coding-agent/src/core/session-manager.ts at the same commit, where the prompt and tool
// declarations live in transcript system messages; v0.87.0 keeps the same mechanism.
import type { AgentMessage, CompactionEntry, Entry } from "@earendil-works/pi-agent-core";
import { createBranchSummaryMessage, createCompactionSummaryMessage } from "@earendil-works/pi-agent-core";
import type { SystemMessage } from "@earendil-works/pi-ai";

export interface SessionCompactionEntry extends CompactionEntry {
	/** Complete prompt and tool state at this compaction boundary. */
	systemMessage?: SystemMessage;
}

export type SessionEntry = Exclude<Entry, CompactionEntry> | SessionCompactionEntry;

export function buildContextEntries(pathEntries: readonly SessionEntry[]): SessionEntry[] {
	let compaction: SessionCompactionEntry | undefined;
	let compactionIndex = -1;
	for (let index = pathEntries.length - 1; index >= 0; index--) {
		const entry = pathEntries[index];
		if (entry?.type === "compaction") {
			compaction = entry;
			compactionIndex = index;
			break;
		}
	}
	return compaction === undefined ? [...pathEntries] : [compaction, ...pathEntries.slice(compactionIndex + 1)];
}

function isContextMessage(message: AgentMessage): boolean {
	return (
		message.role !== "assistant" ||
		(message.stopReason !== "error" && message.stopReason !== "aborted" && message.stopReason !== "deferred")
	);
}

export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
	switch (entry.type) {
		case "message":
			return isContextMessage(entry.message) ? [entry.message] : [];
		case "compaction": {
			const summary = createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
			// Kept system messages are already folded into the entry's replayed system message.
			const kept = entry.retainedTail.filter((message) => isContextMessage(message) && message.role !== "system");
			return entry.systemMessage ? [entry.systemMessage, summary, ...kept] : [summary, ...kept];
		}
		case "branch_summary":
			return entry.summary ? [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)] : [];
		case "custom":
			return [];
	}
}

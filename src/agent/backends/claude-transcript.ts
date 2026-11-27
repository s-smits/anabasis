import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "../../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../../meta/json-runtime.ts";
import { asRecord, isRecord, isString, type JsonObject } from "../../meta/json-shape.ts";
import { keyIfDefined } from "../../meta/optional-key.ts";
import { join } from "../../meta/path.ts";
import { isSafePathSegment } from "../../meta/path-segment.ts";
import { runtimeProcess } from "../../meta/process.ts";

export const CLAUDE_PROJECT_DIR = "seat";
export const CLAUDE_SESSIONS_DIR = "claude-sessions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface ClaudePersist {
  readonly dir: string;
  readonly seat: string;
}

export interface ClaudeFork {
  readonly transcript: string;
  readonly upToTurn?: number | undefined;
  readonly upToUuid?: string | undefined;
}

interface ParsedEntry {
  readonly uuid: string;
  readonly raw: JsonObject;
}

interface TurnSpan {
  readonly messageId: string;
  endUuid: string;
  readonly toolUseIds: Set<string>;
  readonly toolResultIds: Set<string>;
}

function parseTranscript(jsonl: string): {
  readonly sdkSessionId: string;
  readonly entries: readonly ParsedEntry[];
} {
  let sdkSessionId: string | undefined;
  const entries: ParsedEntry[] = [];
  const lines = jsonl.split("\n").filter((line) => line.trim() !== "");
  for (const [index, line] of lines.entries()) {
    let raw: JsonObject | null;
    try {
      raw = asRecord(capturedJsonParse(line));
    } catch (error) {
      if (index === lines.length - 1 && error instanceof SyntaxError) break;
      throw error;
    }
    if (raw === null) continue;
    if (sdkSessionId === undefined && isString(raw.sessionId) && UUID.test(raw.sessionId)) {
      sdkSessionId = raw.sessionId;
    }
    if (isString(raw.uuid)) entries.push({ uuid: raw.uuid, raw });
  }
  if (sdkSessionId === undefined) {
    throw new Error("the Claude transcript records no valid sessionId UUID");
  }
  return { sdkSessionId, entries };
}

function messageBlocks(entry: JsonObject): readonly JsonObject[] | null {
  const message = asRecord(entry.message);
  if (message === null || !Array.isArray(message.content)) return null;
  return message.content.flatMap((block) => (isRecord(block) ? [block] : []));
}

function isAssistantTurnEntry(entry: ParsedEntry): JsonObject | null {
  if (entry.raw.type !== "assistant") return null;
  const message = asRecord(entry.raw.message);
  if (message === null || message.model === "<synthetic>") return null;
  return message;
}

function isToolResultCarrier(entry: ParsedEntry): readonly JsonObject[] | null {
  if (entry.raw.type !== "user") return null;
  const blocks = messageBlocks(entry.raw);
  if (blocks === null || blocks.length === 0) return null;
  return blocks.every((block) => block.type === "tool_result") ? blocks : null;
}

function recordToolUses(entry: ParsedEntry, turn: TurnSpan): void {
  for (const block of messageBlocks(entry.raw) ?? []) {
    if (block.type === "tool_use" && isString(block.id)) turn.toolUseIds.add(block.id);
  }
}

function recordToolResults(blocks: readonly JsonObject[], turn: TurnSpan): void {
  for (const block of blocks) {
    if (isString(block.tool_use_id)) turn.toolResultIds.add(block.tool_use_id);
  }
}

function assistantTurns(entries: readonly ParsedEntry[]): readonly TurnSpan[] {
  const turns: TurnSpan[] = [];
  let current: TurnSpan | null = null;
  for (const [index, entry] of entries.entries()) {
    const assistant = isAssistantTurnEntry(entry);
    if (assistant !== null) {
      const messageId = isString(assistant.id) ? assistant.id : `anon-${String(index)}`;
      if (current === null || current.messageId !== messageId) {
        current = { messageId, endUuid: entry.uuid, toolUseIds: new Set(), toolResultIds: new Set() };
        turns.push(current);
      }
      current.endUuid = entry.uuid;
      recordToolUses(entry, current);
      continue;
    }
    if (current === null) continue;
    const toolResults = isToolResultCarrier(entry);
    if (toolResults !== null) {
      recordToolResults(toolResults, current);
      current.endUuid = entry.uuid;
    } else if (entry.raw.type === "attachment") {
      current.endUuid = entry.uuid;
    } else if (entry.raw.type === "user") {
      current = null;
    }
  }
  return turns;
}

function missingToolIds(turn: TurnSpan): readonly string[] {
  return [...turn.toolUseIds].filter((id) => !turn.toolResultIds.has(id));
}

function lastCompleteForkPoint(jsonl: string): {
  readonly sdkSessionId: string;
  readonly resumeSessionAt?: string;
} {
  const { sdkSessionId, entries } = parseTranscript(jsonl);
  const turns = assistantTurns(entries);
  if (turns.length === 0) return { sdkSessionId };
  const complete = turns.findLast((turn) => missingToolIds(turn).length === 0);
  if (complete === undefined) {
    throw new Error("the Claude transcript holds no completed assistant turn to fork from");
  }
  return { sdkSessionId, resumeSessionAt: complete.endUuid };
}

export function resolveForkPoint(
  jsonl: string,
  atTurn: number,
): { readonly sdkSessionId: string; readonly resumeSessionAt: string; readonly turnCount: number } {
  if (!Number.isInteger(atTurn) || atTurn < 1) {
    throw new Error(`--at-turn ${String(atTurn)}: turn number must be a positive integer`);
  }
  const { sdkSessionId, entries } = parseTranscript(jsonl);
  const turns = assistantTurns(entries);
  const chosen = turns[atTurn - 1];
  if (chosen === undefined) {
    throw new Error(
      `turn ${String(atTurn)} is out of range: transcript holds ${String(turns.length)} assistant turns`,
    );
  }
  const missing = missingToolIds(chosen);
  if (missing.length > 0) {
    const earlier =
      atTurn > 1 ? `fork at turn ${String(atTurn - 1)} instead` : "no earlier completed turn exists";
    throw new Error(`turn ${String(atTurn)} has unanswered tool calls (${missing.join(", ")}); ${earlier}`);
  }
  return { sdkSessionId, resumeSessionAt: chosen.endUuid, turnCount: turns.length };
}

export function stageForkTranscript(
  configDir: string,
  fork: ClaudeFork,
): { readonly resume: string; readonly resumeSessionAt?: string } {
  if (fork.upToTurn !== undefined && fork.upToUuid !== undefined) {
    throw new Error("name upToTurn or upToUuid when forking a Claude transcript, not both");
  }
  if (!existsSync(fork.transcript)) {
    throw new Error(`Claude transcript not found: ${fork.transcript}`);
  }
  const raw = readFileSync(fork.transcript, "utf8");
  let sdkSessionId: string;
  let resumeSessionAt: string | undefined;
  if (fork.upToTurn === undefined) {
    if (fork.upToUuid === undefined) {
      ({ sdkSessionId, resumeSessionAt } = lastCompleteForkPoint(raw));
    } else {
      const parsed = parseTranscript(raw);
      sdkSessionId = parsed.sdkSessionId;
      if (!parsed.entries.some(({ uuid }) => uuid === fork.upToUuid)) {
        throw new Error(`message UUID ${fork.upToUuid} is not in ${fork.transcript}`);
      }
      resumeSessionAt = fork.upToUuid;
    }
  } else {
    ({ sdkSessionId, resumeSessionAt } = resolveForkPoint(raw, fork.upToTurn));
  }
  const projectDir = join(configDir, "projects", CLAUDE_PROJECT_DIR);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sdkSessionId}.jsonl`), raw);
  return { resume: sdkSessionId, ...keyIfDefined("resumeSessionAt", resumeSessionAt) };
}

export function savePersistedTranscript(
  configDir: string,
  persist: ClaudePersist,
  sdkSessionId: string,
): boolean {
  if (!isSafePathSegment(persist.seat) || !isSafePathSegment(sdkSessionId)) return false;
  const source = join(configDir, "projects", CLAUDE_PROJECT_DIR, `${sdkSessionId}.jsonl`);
  if (!existsSync(source)) return false;
  mkdirSync(persist.dir, { recursive: true });
  const target = join(persist.dir, `${persist.seat}.jsonl`);
  const temp = `${target}.${String(runtimeProcess.pid)}.tmp`;
  copyFileSync(source, temp);
  renameSync(temp, target);
  const meta = join(persist.dir, `${persist.seat}.json`);
  const metaTemp = `${meta}.${String(runtimeProcess.pid)}.tmp`;
  writeFileSync(metaTemp, `${capturedJsonStringify({ seat: persist.seat, sdkSessionId })}\n`);
  renameSync(metaTemp, meta);
  return true;
}

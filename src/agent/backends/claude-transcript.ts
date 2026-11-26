import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
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
  readonly type: string;
  readonly raw: JsonObject;
}

interface TurnSpan {
  readonly messageId: string;
  endIndex: number;
  readonly toolUseIds: Set<string>;
  readonly toolResultIds: Set<string>;
}

function parseTranscript(jsonl: string): {
  readonly sdkSessionId: string;
  readonly entries: readonly ParsedEntry[];
} {
  let sdkSessionId: string | undefined;
  const entries: ParsedEntry[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    const raw = asRecord(capturedJsonParse(line));
    if (raw === null) continue;
    if (sdkSessionId === undefined && isString(raw.sessionId) && UUID.test(raw.sessionId)) {
      sdkSessionId = raw.sessionId;
    }
    if (
      isString(raw.uuid) &&
      isString(raw.type) &&
      raw.isSidechain !== true &&
      raw.teamName === undefined &&
      raw.type !== "progress"
    ) {
      entries.push({ uuid: raw.uuid, type: raw.type, raw });
    }
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
  if (entry.type !== "assistant") return null;
  const message = asRecord(entry.raw.message);
  if (message === null || message.model === "<synthetic>") return null;
  return message;
}

function isToolResultCarrier(entry: ParsedEntry): readonly JsonObject[] | null {
  if (entry.type !== "user") return null;
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
        current = { messageId, endIndex: index, toolUseIds: new Set(), toolResultIds: new Set() };
        turns.push(current);
      }
      current.endIndex = index;
      recordToolUses(entry, current);
      continue;
    }
    if (current === null) continue;
    const toolResults = isToolResultCarrier(entry);
    if (toolResults !== null) {
      recordToolResults(toolResults, current);
      current.endIndex = index;
    } else if (entry.type === "attachment") {
      current.endIndex = index;
    } else if (entry.type === "user") {
      current = null;
    }
  }
  return turns;
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
  const missing = [...chosen.toolUseIds].filter((id) => !chosen.toolResultIds.has(id));
  if (missing.length > 0) {
    const earlier =
      atTurn > 1 ? `fork at turn ${String(atTurn - 1)} instead` : "no earlier completed turn exists";
    throw new Error(`turn ${String(atTurn)} has unanswered tool calls (${missing.join(", ")}); ${earlier}`);
  }
  const end = entries[chosen.endIndex];
  if (end === undefined) throw new Error(`turn ${String(atTurn)} resolved to no chain entry`);
  return { sdkSessionId, resumeSessionAt: end.uuid, turnCount: turns.length };
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
    const parsed = parseTranscript(raw);
    sdkSessionId = parsed.sdkSessionId;
    if (fork.upToUuid !== undefined) {
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

function persistedSource(
  projectDir: string,
  sdkSessionId: string | undefined,
): {
  readonly file: string;
  readonly sdkSessionId: string | undefined;
} | null {
  if (!existsSync(projectDir)) return null;
  if (sdkSessionId !== undefined) {
    const exact = join(projectDir, `${sdkSessionId}.jsonl`);
    if (existsSync(exact)) return { file: exact, sdkSessionId };
  }
  const candidates = readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      name,
      path: join(projectDir, name),
      mtimeMs: statSync(join(projectDir, name)).mtimeMs,
    }))
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs);
  const newest = candidates[0];
  if (newest === undefined) return null;
  const stem = newest.name.slice(0, -".jsonl".length);
  return { file: newest.path, sdkSessionId: UUID.test(stem) ? stem : sdkSessionId };
}

export function savePersistedTranscript(
  configDir: string,
  persist: ClaudePersist,
  sdkSessionId: string | undefined,
): boolean {
  if (!isSafePathSegment(persist.seat)) return false;
  const found = persistedSource(join(configDir, "projects", CLAUDE_PROJECT_DIR), sdkSessionId);
  if (found === null) return false;
  mkdirSync(persist.dir, { recursive: true });
  const target = join(persist.dir, `${persist.seat}.jsonl`);
  const temp = `${target}.${String(runtimeProcess.pid)}.tmp`;
  copyFileSync(found.file, temp);
  renameSync(temp, target);
  const meta = join(persist.dir, `${persist.seat}.json`);
  const metaTemp = `${meta}.${String(runtimeProcess.pid)}.tmp`;
  writeFileSync(
    metaTemp,
    `${capturedJsonStringify({ seat: persist.seat, ...keyIfDefined("sdkSessionId", found.sdkSessionId) })}\n`,
  );
  renameSync(metaTemp, meta);
  return true;
}

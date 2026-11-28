import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "../../meta/filesystem.ts";
import { capturedJsonParse } from "../../meta/json-runtime.ts";
import { asRecord, isRecord, isString, type JsonObject } from "../../meta/json-shape.ts";
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
  readonly atTurn: number;
}

interface Turn {
  end: string;
  readonly open: Set<string>;
}

function entriesOf(jsonl: string): readonly JsonObject[] {
  const lines = jsonl.split("\n").filter((line) => line.trim() !== "");
  return lines.flatMap((line, index) => {
    try {
      return [asRecord(capturedJsonParse(line)) ?? {}];
    } catch (error) {
      if (index === lines.length - 1 && error instanceof SyntaxError) return [];
      throw error;
    }
  });
}

function idsOf(blocks: readonly JsonObject[], type: string, key: string): readonly string[] {
  return blocks.flatMap((block) => {
    const id = block[key];
    return block.type === type && isString(id) ? [id] : [];
  });
}

function forkPoint(jsonl: string, atTurn: number): { readonly resume: string; readonly at: string } {
  const entries = entriesOf(jsonl);
  const resume = entries.map(({ sessionId }) => sessionId).find((id) => isString(id) && UUID.test(id));
  if (!isString(resume)) throw new Error("the Claude transcript records no valid sessionId UUID");
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let messageId: string | null = null;
  let compactedAfter = 0;
  for (const entry of entries) {
    if (entry.subtype === "compact_boundary") compactedAfter = turns.length;
    if (!isString(entry.uuid) || entry.isSidechain === true || entry.teamName !== undefined) continue;
    const message = asRecord(entry.message);
    const blocks = Array.isArray(message?.content) ? message.content.filter(isRecord) : [];
    if (entry.type === "assistant" && message !== null && message.model !== "<synthetic>") {
      const id = isString(message.id) ? message.id : null;
      if (current === null || id === null || id !== messageId) {
        current = { end: entry.uuid, open: new Set() };
        turns.push(current);
      }
      messageId = id;
      current.end = entry.uuid;
      for (const use of idsOf(blocks, "tool_use", "id")) current.open.add(use);
    } else if (current === null) {
      continue;
    } else if (entry.type === "attachment") {
      current.end = entry.uuid;
    } else if (
      entry.type === "user" &&
      blocks.length > 0 &&
      blocks.every(({ type }) => type === "tool_result")
    ) {
      for (const answered of idsOf(blocks, "tool_result", "tool_use_id")) current.open.delete(answered);
      current.end = entry.uuid;
    } else if (entry.type === "user") {
      current = null;
    }
  }
  const turn = turns[atTurn - 1];
  if (turn === undefined) {
    throw new Error(
      `turn ${String(atTurn)} is out of range: the transcript holds ${String(turns.length)} turns`,
    );
  }
  if (turn.open.size > 0) {
    throw new Error(`turn ${String(atTurn)} has unanswered tool calls (${[...turn.open].join(", ")})`);
  }
  if (atTurn <= compactedAfter) {
    throw new Error(`turn ${String(atTurn)} precedes the compaction after turn ${String(compactedAfter)}`);
  }
  return { resume, at: turn.end };
}

export function stageFork(configDir: string, fork: ClaudeFork) {
  const raw = readFileSync(fork.transcript, "utf8");
  const { resume, at } = forkPoint(raw, fork.atTurn);
  const projectDir = join(configDir, "projects", CLAUDE_PROJECT_DIR);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${resume}.jsonl`), raw);
  return { resume, resumeSessionAt: at };
}

export function saveTranscript(configDir: string, persist: ClaudePersist, sessionId: string): void {
  const source = join(configDir, "projects", CLAUDE_PROJECT_DIR, `${sessionId}.jsonl`);
  if (!isSafePathSegment(persist.seat) || !isSafePathSegment(sessionId) || !existsSync(source)) return;
  mkdirSync(persist.dir, { recursive: true });
  const target = join(persist.dir, `${persist.seat}.jsonl`);
  const temp = `${target}.${String(runtimeProcess.pid)}.tmp`;
  copyFileSync(source, temp);
  renameSync(temp, target);
}

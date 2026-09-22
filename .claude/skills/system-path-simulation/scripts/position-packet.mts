/**
 * Derive the "history the actor is told it lived" from the actor's own transcript instead of
 * writing it: the last N exchanges of a Claude Agent SDK session, rendered under an authored
 * summary that is labelled as authored.
 *
 *   bun .claude/skills/system-path-simulation/scripts/position-packet.mts \
 *     --transcript /abs/.claude/projects/<workspace-slug>/<session>.jsonl \
 *     --summary-file /abs/summary.md [--exchanges 5] [--result-chars 1200]
 *
 * An exchange is one assistant message (text and tool calls) with the tool results it received.
 * `--exchanges` accepts 1 to 5 (operator decision 2026-08-23: three to five carry the situation,
 * ten obscure it). Results are cut to `--result-chars` per block with the cut marked, never
 * silently. The packet ends with the transcript path, its sha256 and the exchange range, so a
 * reader can check the copied bytes.
 *
 * The transcript is the actor's own view, so the packet may seed only the same role that produced
 * it: a Builder packet never enters a Built Harness or Judge prompt, because Builder tool
 * results include verifier workshop output. The Codex backend writes rollouts under
 * ~/.codex/sessions in another shape; this reader refuses them instead of guessing.
 */
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";
import { asRecord, isString } from "#src/meta/json-shape.ts";

const die: ExitWith = exitWith("position-packet");

interface Block {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
  content?: unknown;
}

interface Turn {
  role: "assistant" | "user";
  at: string;
  blocks: Block[];
}

export interface Exchange {
  assistant: Turn;
  results: Turn[];
}

function asBlocks(value: unknown): Block[] {
  if (isString(value)) return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Block => {
    const row = asRecord(entry);
    return row !== null && isString(row.type);
  });
}

/** Keeps the assistant and user rows of an SDK session log, in file order. */
export function readTurns(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(row);
    if (record === null) continue;
    if (record.type !== "assistant" && record.type !== "user") continue;
    turns.push({
      role: record.type,
      at: isString(record.timestamp) ? record.timestamp : "",
      blocks: asBlocks(asRecord(record.message)?.content),
    });
  }
  return turns;
}

/** Groups each assistant turn with the user turns that answer it until the next assistant turn. */
export function exchanges(turns: Turn[]): Exchange[] {
  const out: Exchange[] = [];
  for (const turn of turns) {
    if (turn.role === "assistant") out.push({ assistant: turn, results: [] });
    else out.at(-1)?.results.push(turn);
  }
  return out;
}

function cut(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n[cut: ${value.length - limit} more characters]`;
}

function renderBlock(block: Block, limit: number): string {
  if (block.type === "text") return cut(block.text ?? "", limit);
  if (block.type === "tool_use") {
    return `tool ${block.name ?? "?"} ${cut(JSON.stringify(block.input ?? null), limit)}`;
  }
  if (block.type === "tool_result") {
    const body = isString(block.content) ? block.content : JSON.stringify(block.content ?? null);
    return `result ${cut(body, limit)}`;
  }
  return `[${block.type} block omitted]`;
}

export function renderPacket(input: {
  summary: string;
  all: Exchange[];
  count: number;
  limit: number;
  transcript: string;
  digest: string;
}): string {
  const chosen = input.all.slice(-input.count);
  const first = input.all.length - chosen.length + 1;
  const lines = [
    "## Summary (authored by the steward, not transcript bytes)",
    "",
    input.summary.trim(),
    "",
    `## Last ${chosen.length} of ${input.all.length} exchanges (copied from the transcript)`,
    "",
  ];
  chosen.forEach((exchange, index) => {
    lines.push(`### Exchange ${first + index} — ${exchange.assistant.at}`);
    for (const block of exchange.assistant.blocks) lines.push("", renderBlock(block, input.limit));
    for (const turn of exchange.results) {
      for (const block of turn.blocks) lines.push("", renderBlock(block, input.limit));
    }
    lines.push("");
  });
  lines.push(
    `Derived from ${input.transcript} (sha256 ${input.digest}), exchanges ${first}–${input.all.length}.`,
  );
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const parsed = parseOrDie(die, {
    values: ["transcript", "summary-file", "exchanges", "result-chars"],
    flags: [],
  });
  const transcript = parsed.single.get("transcript");
  const summaryFile = parsed.single.get("summary-file");
  if (transcript === undefined || !isAbsolute(transcript)) {
    die("--transcript must be an absolute path to an SDK session .jsonl");
  }
  if (summaryFile === undefined || !isAbsolute(summaryFile)) {
    die("--summary-file must be an absolute path to the authored summary");
  }
  if (!existsSync(transcript)) die(`${transcript} does not exist`);
  if (!existsSync(summaryFile)) die(`${summaryFile} does not exist`);
  const count = Number(parsed.single.get("exchanges") ?? "5");
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    die("--exchanges takes 1 to 5; ten exchanges obscure the situation (operator decision 2026-08-23)");
  }
  const limit = Number(parsed.single.get("result-chars") ?? "1200");
  if (!Number.isInteger(limit) || limit < 100) die("--result-chars takes an integer of at least 100");
  const bytes = readFileSync(transcript);
  const text = bytes.toString("utf8");
  if (
    /^\{"timestamp":.*"type":"(session_meta|response_item)"/m.test(text) &&
    !/"type":"assistant"/.test(text)
  ) {
    die("this looks like a Codex rollout, not a Claude SDK session; this reader knows only the SDK shape");
  }
  const all = exchanges(readTurns(text));
  if (all.length === 0) die("no assistant turn in the transcript");
  const summary = readFileSync(summaryFile, "utf8");
  if (summary.trim() === "") {
    die("the summary file is empty; write what happened before the copied exchanges, and label it yours");
  }
  console.log(renderPacket({ summary, all, count, limit, transcript, digest: sha256(bytes) }).trimEnd());
}

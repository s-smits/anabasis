#!/usr/bin/env bun

import { type ExitWith, exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type JsonObject, type JsonValue, asRecord, isString } from "#src/meta/json-shape.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { hasText } from "#src/meta/text.ts";

const TERMINAL_TURN_STATES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "aborted",
]);

const COMMANDS = {
  summary: { values: ["last"], flags: ["json", "help"], positionals: 1 },
  history: { values: ["last"], flags: ["json", "all", "help"], positionals: 1 },
  diff: { values: ["last"], flags: ["json", "help"], positionals: 2 },
};

/** One item of a thread snapshot, paired with the turn that holds it. */
type Entry = { item: JsonValue; turn: JsonValue | undefined };
type ProjectedItem = {
  turnId: JsonValue;
  id: JsonValue;
  type: JsonValue;
  phase: JsonValue;
  status: string;
  text: string;
  changedPaths: string[];
};
type Recommendation = { code: string; reason: string };
type ThreadFacts = {
  id: JsonValue;
  hostId: JsonValue;
  title: JsonValue;
  status: string;
  activeFlags: readonly JsonValue[];
};
type TurnFacts = {
  id: JsonValue;
  status: string;
  startedAt: JsonValue;
  completedAt: JsonValue;
  itemCount: number;
};
type Summary = {
  thread: ThreadFacts;
  latestTurn: TurnFacts | null;
  recommendation: Recommendation;
  recentItems: ProjectedItem[];
};
type SnapshotDiff = {
  transition: {
    threadStatus: [string, string];
    turnStatus: [string | null, string | null];
    latestTurnId: [JsonValue, JsonValue];
  };
  recommendation: Recommendation;
  newItemCount: number;
  newItems: ProjectedItem[];
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  thread-state.ts summary <snapshot.json|-> [--last N] [--json]",
      "  thread-state.ts history <snapshot.json|-> [--all|--last N] [--json]",
      "  thread-state.ts diff <before.json> <after.json> [--last N] [--json]",
      "",
      "Snapshots are raw JSON returned by a Codex thread-read tool.",
    ].join("\n") + "\n",
  );
  return runtimeProcess.exit(0);
}

async function readPayload(path: string): Promise<JsonObject> {
  const raw = path === "-" ? await Bun.stdin.text() : await Bun.file(path).text();

  let value = capturedJsonParse(raw);
  while (isString(value)) {
    value = capturedJsonParse(value);
  }

  const content = asRecord(value)?.content;
  const textBlock = Array.isArray(content)
    ? content.find((item) => {
        const block = asRecord(item);
        return block?.type === "text" && isString(block.text);
      })
    : undefined;
  const contentText = asRecord(textBlock)?.text;
  if (!present(asRecord(value)?.thread) && isString(contentText) && hasText(contentText)) {
    value = capturedJsonParse(contentText);
    while (isString(value)) {
      value = capturedJsonParse(value);
    }
  }

  const snapshot = asRecord(value);
  if (snapshot === null || !present(snapshot.thread)) {
    throw new Error("Snapshot does not contain a thread object");
  }
  return snapshot;
}

/** JavaScript truthiness over a JSON value, which is what these reads have always tested. */
function present(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
}

function stateType(state: JsonValue | undefined): string {
  if (isString(state)) {
    return state;
  }
  const type = asRecord(state)?.type;
  return isString(type) ? type : "unknown";
}

function orderedTurns(snapshot: JsonObject): JsonValue[] {
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  const startedAt = (turn: JsonValue): number => Number(asRecord(turn)?.startedAt ?? 0);
  return [...turns].sort((left, right) => startedAt(left) - startedAt(right));
}

/** The text an item carries, in the three shapes a transcript writes it: a plain string, a
 *  summary, or a list of content blocks. */
function rawItemText(item: JsonValue | undefined): string {
  const record = asRecord(item);
  if (isString(record?.text)) return record.text;
  if (isString(record?.summary)) return record.summary;
  const content = record?.content;
  if (Array.isArray(content)) {
    return content
      .flatMap((block) => {
        const text = asRecord(block)?.text;
        return isString(text) && hasText(text) ? [text] : [];
      })
      .join("\n");
  }
  return "";
}

function itemText(item: JsonValue | undefined): string {
  return rawItemText(item).replace(/\s+/g, " ").trim();
}

function changedPaths(item: JsonValue | undefined): string[] {
  const changes = asRecord(item)?.changes;
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes.flatMap((change) => {
    const path = asRecord(change)?.path;
    return isString(path) ? [path] : [];
  });
}

function meaningfulItem(item: JsonValue | undefined): boolean {
  const record = asRecord(item);
  if (record === null || record.type === "reasoning") {
    return false;
  }
  return (
    hasText(itemText(record)) ||
    changedPaths(record).length > 0 ||
    record.type === "subAgentActivity" ||
    record.type === "contextCompaction"
  );
}

function flattenEntries(snapshot: JsonObject): Entry[] {
  return orderedTurns(snapshot).flatMap((turn) => {
    const items = asRecord(turn)?.items;
    return (Array.isArray(items) ? items : []).map((item) => ({ item, turn }));
  });
}

function projectItem(item: JsonValue, turn: JsonValue | undefined): ProjectedItem {
  const record = asRecord(item);
  return {
    turnId: asRecord(turn)?.id ?? null,
    id: record?.id ?? null,
    type: record?.type ?? null,
    phase: record?.phase ?? null,
    status: stateType(record?.status),
    text: boundText(itemText(item), 1_200).shown,
    changedPaths: changedPaths(item),
  };
}

function recommendation(threadStatus: string, turnStatus: string): Recommendation {
  if (threadStatus === "idle" && (!hasText(turnStatus) || TERMINAL_TURN_STATES.has(turnStatus))) {
    return {
      code: "INSPECT_BEFORE_STOP",
      reason: "The thread is idle; inspect commitments and owned processes before stopping.",
    };
  }
  if (TERMINAL_TURN_STATES.has(turnStatus) && threadStatus !== "active") {
    return {
      code: "INSPECT_BEFORE_STOP",
      reason: "The latest turn is terminal; inspect commitments and owned processes before stopping.",
    };
  }
  if (threadStatus === "active" || turnStatus === "inProgress") {
    return {
      code: "CONTINUE",
      reason: "The thread or latest turn is active.",
    };
  }
  return {
    code: "INSPECT",
    reason: "Thread and turn states do not form a known stop or continue pair.",
  };
}

function summarise(snapshot: JsonObject, lastCount: number): Summary {
  const turn = orderedTurns(snapshot).at(-1);
  const turnRecord = asRecord(turn);
  const thread = asRecord(snapshot.thread);
  const threadStatus = stateType(thread?.status);
  const turnStatus = stateType(turnRecord?.status);
  const turnItems = turnRecord?.items;
  const items = (Array.isArray(turnItems) ? turnItems : []).filter(meaningfulItem);
  const flags = asRecord(thread?.status)?.activeFlags;
  const activeFlags = Array.isArray(flags) ? flags : [];

  return {
    thread: {
      id: thread?.id ?? null,
      hostId: thread?.hostId ?? null,
      title: thread?.title ?? null,
      status: threadStatus,
      activeFlags,
    },
    latestTurn: present(turn)
      ? {
          id: turnRecord?.id ?? null,
          status: turnStatus,
          startedAt: turnRecord?.startedAt ?? null,
          completedAt: turnRecord?.completedAt ?? null,
          itemCount: Array.isArray(turnItems) ? turnItems.length : 0,
        }
      : null,
    recommendation: recommendation(threadStatus, turnStatus),
    recentItems: items.slice(-lastCount).map((item) => projectItem(item, turn)),
  };
}

function summariseHistory(snapshot: JsonObject, lastCount: number): Summary & { historyItemCount: number } {
  const summary = summarise(snapshot, 1);
  const entries = flattenEntries(snapshot).filter(({ item }) => meaningfulItem(item));
  return {
    ...summary,
    historyItemCount: entries.length,
    recentItems: entries.slice(-lastCount).map(({ item, turn }) => projectItem(item, turn)),
  };
}

function diffSnapshots(before: JsonObject, after: JsonObject, lastCount: number): SnapshotDiff {
  const beforeSummary = summarise(before, lastCount);
  const afterSummary = summarise(after, lastCount);
  const beforeIds = new Set<JsonValue | undefined>(
    flattenEntries(before).flatMap(({ item }) => {
      const id = asRecord(item)?.id;
      return present(id) ? [id] : [];
    }),
  );
  const newEntries = flattenEntries(after)
    .filter(({ item }) => !beforeIds.has(asRecord(item)?.id))
    .filter(({ item }) => meaningfulItem(item));

  return {
    transition: {
      threadStatus: [beforeSummary.thread.status, afterSummary.thread.status],
      turnStatus: [beforeSummary.latestTurn?.status ?? null, afterSummary.latestTurn?.status ?? null],
      latestTurnId: [beforeSummary.latestTurn?.id ?? null, afterSummary.latestTurn?.id ?? null],
    },
    recommendation: afterSummary.recommendation,
    newItemCount: newEntries.length,
    newItems: newEntries.slice(-lastCount).map(({ item, turn }) => projectItem(item, turn)),
  };
}

/** A recorded value as a Markdown line prints it. */
function shown(value: JsonValue): string {
  return isString(value) ? value : JSON.stringify(value);
}

/** Values joined as `Array.prototype.join` renders them, with null as the empty string. */
function joined(values: readonly JsonValue[], separator: string): string {
  return values.map((value) => (value === null ? "" : shown(value))).join(separator);
}

function markdownSummary(summary: Summary): string {
  const flags = joined(summary.thread.activeFlags, ",");
  const lines = [
    `thread: ${shown(summary.thread.id ?? "unknown")}`,
    `host: ${shown(summary.thread.hostId ?? "unknown")}`,
    `thread_status: ${summary.thread.status}`,
    `active_flags: ${hasText(flags) ? flags : "none"}`,
    `latest_turn: ${shown(summary.latestTurn?.id ?? "none")}`,
    `turn_status: ${summary.latestTurn?.status ?? "none"}`,
    `action: ${summary.recommendation.code}`,
    `reason: ${summary.recommendation.reason}`,
    "recent_items:",
  ];
  return withItems(lines, summary.recentItems);
}

function markdownDiff(diff: SnapshotDiff): string {
  const lines = [
    `thread_status: ${diff.transition.threadStatus.join(" -> ")}`,
    `turn_status: ${diff.transition.turnStatus.join(" -> ")}`,
    `latest_turn: ${joined(diff.transition.latestTurnId, " -> ")}`,
    `new_items: ${diff.newItemCount}`,
    `action: ${diff.recommendation.code}`,
    `reason: ${diff.recommendation.reason}`,
    "changes:",
  ];
  return withItems(lines, diff.newItems);
}

/** The header lines, then one line per item, as the text both Markdown views print. */
function withItems(lines: readonly string[], items: readonly ProjectedItem[]): string {
  const itemLines = items.map((item) => {
    const paths = item.changedPaths.length > 0 ? ` paths=${item.changedPaths.join(",")}` : "";
    const text = hasText(item.text) ? ` ${item.text}` : "";
    return `- ${shown(item.id ?? "no-id")} ${shown(item.type ?? "unknown")}${paths}${text}`;
  });
  return `${[...lines, ...itemLines].join("\n")}\n`;
}

const die: ExitWith = exitWith("thread-state");
const { command, single, flags, positionals } = parseCommandOrDie(die, COMMANDS);
if (flags.has("help")) usage();
const jsonOutput = flags.has("json");
const lastCount = single.has("last") ? Number(single.get("last")) : 8;
if (!Number.isInteger(lastCount) || lastCount < 1 || lastCount > 1000) {
  die("--last must be an integer from 1 to 1000");
}

try {
  const [first, second] = await Promise.all(positionals.map(readPayload));
  if (first === undefined) throw new Error("Snapshot does not contain a thread object");
  const count = flags.has("all") ? Number.MAX_SAFE_INTEGER : lastCount;
  if (command === "diff") {
    if (second === undefined) throw new Error("Snapshot does not contain a thread object");
    const result = diffSnapshots(first, second, count);
    console.write(jsonOutput ? `${JSON.stringify(result, null, 2)}\n` : markdownDiff(result));
  } else {
    const result = command === "history" ? summariseHistory(first, count) : summarise(first, count);
    console.write(jsonOutput ? `${JSON.stringify(result, null, 2)}\n` : markdownSummary(result));
  }
} catch (error) {
  console.error(`thread-state: ${errorMessage(error)}`);
  runtimeProcess.exit(1);
}

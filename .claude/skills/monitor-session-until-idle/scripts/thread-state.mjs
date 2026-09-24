#!/usr/bin/env bun

import { exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";

const TERMINAL_TURN_STATES = new Set([
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

function usage() {
  console.error(
    [
      "Usage:",
      "  thread-state.mjs summary <snapshot.json|-> [--last N] [--json]",
      "  thread-state.mjs history <snapshot.json|-> [--all|--last N] [--json]",
      "  thread-state.mjs diff <before.json> <after.json> [--last N] [--json]",
      "",
      "Snapshots are raw JSON returned by a Codex thread-read tool.",
    ].join("\n") + "\n",
  );
  runtimeProcess.exit(0);
}

async function readPayload(path) {
  const raw = path === "-" ? await Bun.stdin.text() : await Bun.file(path).text();

  let value = JSON.parse(raw);
  while (isString(value)) {
    value = JSON.parse(value);
  }

  const contentText = value?.content?.find?.((item) => item?.type === "text" && isString(item.text))?.text;
  if (!value?.thread && contentText) {
    value = JSON.parse(contentText);
    while (isString(value)) {
      value = JSON.parse(value);
    }
  }

  if (!value || typeof value !== "object" || !value.thread) {
    throw new Error("Snapshot does not contain a thread object");
  }
  return value;
}

function stateType(state) {
  if (isString(state)) {
    return state;
  }
  return isString(state?.type) ? state.type : "unknown";
}

function orderedTurns(snapshot) {
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  return [...turns].sort((left, right) => Number(left?.startedAt ?? 0) - Number(right?.startedAt ?? 0));
}

/** The text an item carries, in the three shapes a transcript writes it: a plain string, a
 *  summary, or a list of content blocks. */
function rawItemText(item) {
  if (isString(item?.text)) return item.text;
  if (isString(item?.summary)) return item.summary;
  if (Array.isArray(item?.content)) {
    return item.content.flatMap((block) => (isString(block?.text) ? block.text || [] : [])).join("\n");
  }
  return "";
}

function itemText(item) {
  return rawItemText(item).replace(/\s+/g, " ").trim();
}

function changedPaths(item) {
  if (!Array.isArray(item?.changes)) {
    return [];
  }
  return item.changes.map((change) => change?.path).filter((path) => isString(path));
}

function meaningfulItem(item) {
  if (!item || item.type === "reasoning") {
    return false;
  }
  return Boolean(
    itemText(item) ||
      changedPaths(item).length > 0 ||
      item.type === "subAgentActivity" ||
      item.type === "contextCompaction",
  );
}

function flattenEntries(snapshot) {
  return orderedTurns(snapshot).flatMap((turn) =>
    (Array.isArray(turn?.items) ? turn.items : []).map((item) => ({ item, turn })),
  );
}

function projectItem(item, turn) {
  return {
    turnId: turn?.id ?? null,
    id: item.id ?? null,
    type: item.type ?? null,
    phase: item.phase ?? null,
    status: stateType(item.status),
    text: itemText(item).slice(0, 1_200),
    changedPaths: changedPaths(item),
  };
}

function recommendation(threadStatus, turnStatus) {
  if (threadStatus === "idle" && (!turnStatus || TERMINAL_TURN_STATES.has(turnStatus))) {
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

function summarise(snapshot, lastCount) {
  const turn = orderedTurns(snapshot).at(-1);
  const threadStatus = stateType(snapshot.thread?.status);
  const turnStatus = stateType(turn?.status);
  const items = (Array.isArray(turn?.items) ? turn.items : []).filter(meaningfulItem);
  const activeFlags = Array.isArray(snapshot.thread?.status?.activeFlags)
    ? snapshot.thread.status.activeFlags
    : [];

  return {
    thread: {
      id: snapshot.thread?.id ?? null,
      hostId: snapshot.thread?.hostId ?? null,
      title: snapshot.thread?.title ?? null,
      status: threadStatus,
      activeFlags,
    },
    latestTurn: turn
      ? {
          id: turn.id ?? null,
          status: turnStatus,
          startedAt: turn.startedAt ?? null,
          completedAt: turn.completedAt ?? null,
          itemCount: Array.isArray(turn.items) ? turn.items.length : 0,
        }
      : null,
    recommendation: recommendation(threadStatus, turnStatus),
    recentItems: items.slice(-lastCount).map((item) => projectItem(item, turn)),
  };
}

function summariseHistory(snapshot, lastCount) {
  const summary = summarise(snapshot, 1);
  const entries = flattenEntries(snapshot).filter(({ item }) => meaningfulItem(item));
  return {
    ...summary,
    historyItemCount: entries.length,
    recentItems: entries.slice(-lastCount).map(({ item, turn }) => projectItem(item, turn)),
  };
}

function diffSnapshots(before, after, lastCount) {
  const beforeSummary = summarise(before, lastCount);
  const afterSummary = summarise(after, lastCount);
  const beforeIds = new Set(flattenEntries(before).flatMap(({ item }) => item?.id || []));
  const newEntries = flattenEntries(after)
    .filter(({ item }) => !beforeIds.has(item?.id))
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

function markdownSummary(summary) {
  const lines = [
    `thread: ${summary.thread.id ?? "unknown"}`,
    `host: ${summary.thread.hostId ?? "unknown"}`,
    `thread_status: ${summary.thread.status}`,
    `active_flags: ${summary.thread.activeFlags.join(",") || "none"}`,
    `latest_turn: ${summary.latestTurn?.id ?? "none"}`,
    `turn_status: ${summary.latestTurn?.status ?? "none"}`,
    `action: ${summary.recommendation.code}`,
    `reason: ${summary.recommendation.reason}`,
    "recent_items:",
  ];
  return withItems(lines, summary.recentItems);
}

function markdownDiff(diff) {
  const lines = [
    `thread_status: ${diff.transition.threadStatus.join(" -> ")}`,
    `turn_status: ${diff.transition.turnStatus.join(" -> ")}`,
    `latest_turn: ${diff.transition.latestTurnId.join(" -> ")}`,
    `new_items: ${diff.newItemCount}`,
    `action: ${diff.recommendation.code}`,
    `reason: ${diff.recommendation.reason}`,
    "changes:",
  ];
  return withItems(lines, diff.newItems);
}

/** The header lines, then one line per item, as the text both Markdown views print. */
function withItems(lines, items) {
  const itemLines = items.map((item) => {
    const paths = item.changedPaths.length > 0 ? ` paths=${item.changedPaths.join(",")}` : "";
    const text = item.text ? ` ${item.text}` : "";
    return `- ${item.id ?? "no-id"} ${item.type ?? "unknown"}${paths}${text}`;
  });
  return `${[...lines, ...itemLines].join("\n")}\n`;
}

const die = exitWith("thread-state");
const { command, single, flags, positionals } = parseCommandOrDie(die, COMMANDS);
if (flags.has("help")) usage();
const jsonOutput = flags.has("json");
const lastCount = single.has("last") ? Number(single.get("last")) : 8;
if (!Number.isInteger(lastCount) || lastCount < 1 || lastCount > 1000) {
  die("--last must be an integer from 1 to 1000");
}

try {
  const payloads = await Promise.all(positionals.map(readPayload));
  const count = flags.has("all") ? Number.MAX_SAFE_INTEGER : lastCount;
  if (command === "diff") {
    const result = diffSnapshots(payloads[0], payloads[1], count);
    console.write(jsonOutput ? `${JSON.stringify(result, null, 2)}\n` : markdownDiff(result));
  } else {
    const result =
      command === "history" ? summariseHistory(payloads[0], count) : summarise(payloads[0], count);
    console.write(jsonOutput ? `${JSON.stringify(result, null, 2)}\n` : markdownSummary(result));
  }
} catch (error) {
  console.error(`thread-state: ${errorMessage(error)}`);
  runtimeProcess.exit(1);
}

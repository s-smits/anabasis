#!/usr/bin/env bun
/**
 * What each session timer did, counted from the session's own transcripts instead of from a
 * firing's account of itself.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/timers.ts <transcript.jsonl | folder> ... [--since <ISO time>]
 *
 * It reads Claude Code transcripts (a session's `.jsonl`, or every one under a folder) and prints one
 * line for each timer `CronCreate` made: its id, its schedule, how often it fired and how its firings
 * ended. A firing **changed** something where its turn edited a file, appended to one, ran a verb
 * that moves a run, a pull request or an investigation, or started an agent or a timer (`CHANGE`,
 * `ACTS`); it was **quiet** where it changed nothing and its last message was shorter than 400
 * characters. The split is a reading of the turn's tool calls and so an estimate, never a record: a
 * command longer than its first line can hide a write.
 *
 * The cycle ledgers asked every firing to say whether it was useful and when it should have fired.
 * Over 389 rows in nine ledgers up to 10 November 2026, 68 said the first and none the second, while
 * the transcripts of the same weeks held 941 firings of recurring timers of which 470 were quiet.
 * A session copied between logins repeats its past, so each line counts once, by its `uuid`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { closeSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { type JsonObject, type JsonValue, asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/timers.ts";
const USAGE = `usage: bun ${SCRIPT} <transcript.jsonl | folder> ... [--since <ISO time>]`;
const CHUNK = 1 << 20;
const QUIET_CHARS = 400;
/** A shell command that moves a run, a pull request, an investigation or a file. */
const CHANGE =
  /runs (?:on \S+ )?(?:fresh|pause|stop|continue|move|keep|retire)\b|git (?:commit|push)|gh pr (?:create|edit|merge|ready|comment)|land -- |wri2p2\.ts open|wri\.ts (?:start|lanes|collect|synthesis)|nohup|>>|tee -a/u;
/** The tools whose call is itself a change. */
const ACTS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "Agent",
  "Task",
  "CronCreate",
  "CronDelete",
  "SendMessage",
]);
const MADE = /Scheduled (?<kind>recurring job|one-shot task) (?<id>[0-9a-f]{8})/u;

/** One timer: what made it, and how each of its firings ended. */
export interface Timer {
  readonly id: string;
  readonly cron: string;
  readonly recurring: boolean;
  readonly prompt: string;
  readonly firings: number;
  readonly changed: number;
  readonly quiet: number;
}

interface Turn {
  readonly id: string;
  changed: boolean;
  said: number;
}

/** The parts of a transcript line's message: its tool calls, their results and its text. */
const partsOf = (row: JsonObject): JsonObject[] => {
  const content = asRecord(row.message)?.content;
  return Array.isArray(content)
    ? content.flatMap((part): JsonObject[] => {
        const record = asRecord(part);
        return record === null ? [] : [record];
      })
    : [];
};

/** The text of a tool result, which is a string or a list of text parts. */
function textOf(value: JsonValue | undefined): string {
  if (isString(value)) return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => asRecord(part)?.text)
    .filter(isString)
    .join(" ");
}

/** Every timer the transcript `lines` made or fired from `since` on, in the order first seen. */
export function timersIn(lines: Iterable<string>, since = ""): Timer[] {
  const seen = new Set<string>();
  const asked = new Map<string, JsonObject>();
  const timers = new Map<string, Timer>();
  const timer = (id: string): Timer =>
    timers.get(id) ?? { id, cron: "?", recurring: false, prompt: "", firings: 0, changed: 0, quiet: 0 };
  let turn: Turn | null = null;
  const close = () => {
    if (turn === null) return;
    const { id, changed, said } = turn;
    const old = timer(id);
    const quiet = !changed && said < QUIET_CHARS;
    timers.set(id, {
      ...old,
      firings: old.firings + 1,
      changed: old.changed + Number(changed),
      quiet: old.quiet + Number(quiet),
    });
    turn = null;
  };
  for (const line of lines) {
    // A transcript line is often megabytes of one tool's output, so only a line that can name a
    // timer, or that belongs to a firing's turn, is parsed.
    const named = line.includes('"CronCreate"') || line.includes('"scheduledTaskId"');
    if (!(named || turn !== null || (asked.size > 0 && line.includes('"tool_result"')))) continue;
    const row = asRecord(capturedJsonParse(line));
    if (row === null || !isString(row.uuid) || seen.has(row.uuid)) continue;
    seen.add(row.uuid);
    if (isString(row.timestamp) && row.timestamp < since) continue;
    const parts = partsOf(row);
    if (row.type === "user") {
      const results = parts.filter((part) => part.type === "tool_result");
      for (const part of results) {
        const input = isString(part.tool_use_id) ? asked.get(part.tool_use_id) : undefined;
        const made = MADE.exec(textOf(part.content))?.groups;
        if (input === undefined || made?.id === undefined) continue;
        timers.set(made.id, {
          ...timer(made.id),
          cron: isString(input.cron) ? input.cron : "?",
          recurring: made.kind === "recurring job",
          prompt: isString(input.prompt) ? input.prompt : "",
        });
      }
      if (results.length > 0) continue;
      close();
      if (isString(row.scheduledTaskId)) turn = { id: row.scheduledTaskId, changed: false, said: 0 };
      continue;
    }
    for (const part of parts) {
      const input = asRecord(part.input) ?? {};
      if (part.name === "CronCreate" && isString(part.id)) asked.set(part.id, input);
      if (turn === null) continue;
      if (isString(part.text)) turn.said = part.text.length;
      if (!isString(part.name)) continue;
      const command = isString(input.command) ? input.command : "";
      turn.changed ||= ACTS.has(part.name) || (part.name === "Bash" && CHANGE.test(command));
    }
  }
  close();
  return [...timers.values()];
}

const share = (part: number, whole: number) =>
  whole === 0 ? "" : ` (${String(Math.round((100 * part) / whole))}%)`;

/** One line a timer that fired, the most firings first, then the counts of each kind. */
export function timerLines(timers: readonly Timer[]): string[] {
  const total = (kind: "recurring" | "one-shot") => {
    const own = timers.filter((each) => each.recurring === (kind === "recurring"));
    const sum = (pick: (each: Timer) => number) => own.reduce((count, each) => count + pick(each), 0);
    const [firings, changed, quiet] = [sum((t) => t.firings), sum((t) => t.changed), sum((t) => t.quiet)];
    const idle = own.filter((each) => each.firings === 0).length;
    return `${kind}: ${String(own.length)} timer(s), ${String(idle)} never fired · ${String(firings)} firing(s), ${String(changed)} changed${share(changed, firings)}, ${String(quiet)} quiet${share(quiet, firings)}`;
  };
  return [
    ...timers
      .filter(({ firings }) => firings > 0)
      .toSorted((one, other) => other.firings - one.firings)
      .map(
        ({ id, cron, recurring, prompt, firings, changed, quiet }) =>
          `${id} · ${cron} · ${recurring ? "recurring" : "once"} · ${String(firings)} fired, ${String(changed)} changed, ${String(quiet)} quiet · ${prompt.replaceAll(/\s+/gu, " ").slice(0, 60)}`,
      ),
    total("recurring"),
    total("one-shot"),
  ];
}

/** Each line of the file `path`, read a chunk at a time: one session's transcript can hold a gigabyte. */
function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, "r");
  const chunk = new Uint8Array(CHUNK);
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      const lines = (rest + decoder.decode(chunk.subarray(0, read), { stream: true })).split("\n");
      rest = lines.pop() ?? "";
      yield* lines;
    }
  } finally {
    closeSync(fd);
  }
  if (rest !== "") yield rest;
}

/** The transcripts `path` names: itself, or every `.jsonl` beneath it. */
function transcripts(path: string): string[] {
  if (!statSync(path).isDirectory()) return path.endsWith(".jsonl") ? [path] : [];
  return readdirSync(path).flatMap((entry) => transcripts(join(path, entry)));
}

if (import.meta.main) {
  await runCommand(
    { name: "timers", usage: USAGE, options: { since: "text" }, positionals: [1, 64] },
    (args: CommandArgs) => {
      const files = args.positionals.flatMap(transcripts);
      if (files.length === 0) args.die(`no transcript under ${args.positionals.join(", ")}`);
      const since = args.value("since") ?? "";
      const lines = (function* all() {
        for (const file of files) yield* linesOf(file);
      })();
      console.log(`timers in ${String(files.length)} transcript(s)${since === "" ? "" : ` since ${since}`}`);
      for (const line of timerLines(timersIn(lines, since))) console.log(line);
    },
  );
}

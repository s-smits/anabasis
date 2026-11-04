#!/usr/bin/env bun
/**
 * Print parts of one campaign's log as markdown, chosen by where they stand in the run, for an
 * Oracle document or a reader who wants a few turns and not the whole log.
 *
 *   bun .claude/skills/oracle-handover/scripts/slice.ts <run | log | folder> <selector>... [--whole] [--max-chars 6000]
 *
 * A selector names a seat or an event kind, optionally a session, and optionally which items:
 *
 *   Builder                 the Builder's sessions, one row each (one session: its turns, one row each)
 *   HarnessBuilder{4-7}     the Builder's 4th to 7th turns, each with every tool call it made
 *   Builder:b-2{1,3,10-}    turns 1, 3 and 10 to the last of session b-2
 *   Examiner:x-1{~2}        the last two turns of Examiner session x-1
 *   Solver:mw1kj2l9-1-1{1-3} the first three turns of the solve whose id ends so
 *   comparison.reported{~1} the last `comparison.reported` event, whole
 *
 * Seats are Builder (or HarnessBuilder, build), Examiner (exam), Drafter (draft), Referee,
 * Solver (solve) and Repair. A model turn and the calls it asked for are one group, so `{4}` is
 * the fourth time the seat spoke and everything it ran then. Without a session the groups are
 * numbered across the seat's sessions in log order, each printed with its session and turn; a
 * session's own numbering is its turn numbers. An item is `N`, `N-M`, `N-` (to the last) or `~N`
 * (the last N). A range past the end stops at the end and a selector that finds nothing prints a
 * line saying so, so a reader may guess wide (`Builder{1-40}`) without reading the log first.
 *
 * The log is read through the production readers: `logAcross` (`tools/runs/snapshots.ts`) finds a
 * run by name on any host, and `tracesIn` (`src/kernel/trace.ts`) reads every turn and call, so
 * this script parses no event itself. A call's result and an event longer than `--max-chars` are
 * cut in the middle with the count cut said in place; `--whole` cuts nothing. The output holds what
 * the log holds, hidden values included: it is for the operator's side of the wall (`AGENTS.md`
 * section 1) and an Oracle, never for a seat.
 *
 * Until 4 November an Oracle document's log extracts were written by a script made for that one
 * document in a session's scratch folder (the drafting record of five jobstat campaigns that day).
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { type Call, type Seat, type Turn, tracesIn } from "#src/kernel/trace.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** One model turn and the tool calls it asked for. */
interface Group {
  readonly seat: Seat;
  readonly id: string;
  readonly turn: number | null;
  readonly at: string;
  readonly said: Turn | null;
  readonly calls: Call[];
}

interface Selector {
  readonly seat: Seat | null;
  readonly kind: string | null;
  readonly id: string | null;
  /** The items asked for as written, or null for the overview. */
  readonly items: string | null;
}

interface Shown {
  readonly whole: boolean;
  readonly maxChars: number;
}

const SEAT_NAMES = {
  harnessbuilder: "build",
  builder: "build",
  build: "build",
  examiner: "exam",
  exam: "exam",
  drafter: "draft",
  draft: "draft",
  referee: "referee",
  solver: "solve",
  solve: "solve",
  repair: "repair",
} as const satisfies Record<string, Seat>;

const SEAT_TITLES = {
  build: "Builder",
  exam: "Examiner",
  draft: "Drafter",
  referee: "Referee",
  solve: "Solver",
  repair: "Repair",
} as const satisfies Record<Seat, string>;

const SELECTOR = /^(?<what>[A-Za-z][\w.]*)(?::(?<id>[^{}]+))?(?:\{(?<items>[^{}]*)\})?$/u;
export const DEFAULT_MAX_CHARS = 6000;

/** Read selector `text`, refusing a seat or an item list it cannot name. */
export function parseSelector(text: string): Selector {
  const groups = SELECTOR.exec(text.trim())?.groups;
  const what = groups?.what;
  if (what === undefined) {
    throw new CommandFailure(`${text}: a selector is <seat or kind>[:<session>][{<items>}]`);
  }
  const seat = Object.entries(SEAT_NAMES).find(([name]) => name === what.toLowerCase())?.[1] ?? null;
  if (seat === null && !what.includes(".")) {
    throw new CommandFailure(
      `${what}: name a seat (${Object.values(SEAT_TITLES).join(", ")}) or an event kind`,
    );
  }
  if (seat === null && groups?.id !== undefined) {
    throw new CommandFailure(`${text}: an event kind takes no session; choose its items instead`);
  }
  return {
    seat,
    kind: seat === null ? what : null,
    id: groups?.id?.trim() ?? null,
    items: groups?.items ?? null,
  };
}

/** The 0-based positions items `items` name among `count`, in the order written, once each. A
 *  range past the end is cut at the end: a reader guesses wide, and what is not there is no fault. */
export function pick(items: string, count: number): number[] {
  const out = new Set<number>();
  for (const raw of items.split(",")) {
    const item = raw.trim();
    const last = /^~(\d+)$/u.exec(item);
    const span = /^(\d+)(?:-(\d*))?$/u.exec(item);
    let from: number;
    let to: number;
    if (last !== null) {
      from = Math.max(1, count - Number(last[1]) + 1);
      to = count;
    } else if (span === null) {
      throw new CommandFailure(`${item}: an item is N, N-M, N- or ~N`);
    } else {
      from = Number(span[1]);
      to = span[2] === undefined ? from : span[2] === "" ? count : Number(span[2]);
    }
    for (let at = Math.max(1, from); at <= Math.min(to, count); at += 1) out.add(at - 1);
  }
  return [...out];
}

/** Every group of seat `seat`, of every session or solve whose id is or ends with `id` if given.
 *  A log of before about 23 October writes a turn's calls before the turn, numbered one lower
 *  (72 of 177 archived logs on 4 November): a session whose first trace is a call holds its calls
 *  for the turn that follows them. */
export function groupsOf(events: readonly LogEvent[], seat: Seat, id: string | null): Group[] {
  const own = tracesIn(events).filter(
    (each): each is Turn | Call =>
      each.part !== "compacted" &&
      each.seat === seat &&
      (id === null || each.id === id || each.id.endsWith(id)),
  );
  const firstPart = new Map<string, string>();
  for (const each of own) {
    if (!firstPart.has(each.id)) firstPart.set(each.id, each.part);
  }
  const groups: Group[] = [];
  const open = new Map<string, Group>();
  const held = new Map<string, Call[]>();
  for (const each of own) {
    const was = open.get(each.id);
    if (each.part === "call" && firstPart.get(each.id) === "call") {
      held.set(each.id, [...(held.get(each.id) ?? []), each]);
      continue;
    }
    if (each.part === "call" && was !== undefined && (each.turn === null || each.turn === was.turn)) {
      was.calls.push(each);
      continue;
    }
    const said = each.part === "turn" ? each : null;
    const calls = each.part === "call" ? [each] : (held.get(each.id) ?? []);
    held.delete(each.id);
    const group: Group = { seat, id: each.id, turn: each.turn, at: each.at, said, calls };
    groups.push(group);
    open.set(each.id, group);
  }
  // Calls of an old-order session that no turn followed: the session ended inside them.
  for (const [session, calls] of held) {
    const first = calls[0];
    if (first !== undefined) {
      groups.push({ seat, id: session, turn: first.turn, at: first.at, said: null, calls });
    }
  }
  return groups;
}

/** A fence for `text` that no run of backticks inside it closes. */
export function fenced(text: string, lang = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text.endsWith("\n") ? text : `${text}\n`}${fence}`;
}

/** `text` whole, or cut in its middle to about `shown.maxChars` with the cut said in place. */
function clip(text: string, shown: Shown): string {
  if (shown.maxChars < 1) throw new CommandFailure("--max-chars takes a count of at least 1");
  if (shown.whole || text.length <= shown.maxChars) return text;
  const head = Math.floor((shown.maxChars * 2) / 3);
  const tail = shown.maxChars - head;
  const cut = text.length - head - tail;
  return `${text.slice(0, head)}\n[... ${plural(cut, "character")} cut here; --whole prints them ...]\n${text.slice(-tail)}`;
}

function callMarkdown(call: Call, number: number, shown: Shown): string {
  const took = call.ms === null ? "" : `, ${(call.ms / 1000).toFixed(1)} s`;
  const command = asRecord(call.args)?.command;
  const args = isString(command)
    ? fenced(command, "sh")
    : fenced(capturedJsonStringify(call.args, null, 1), "json");
  return [
    `**Call ${String(number)}: \`${call.tool}\`${call.isError ? ", failed" : ""}** (result ${plural(call.text.length, "character")}${took})`,
    "",
    args,
    "",
    fenced(clip(call.text || "(no result recorded)", shown), "text"),
  ].join("\n");
}

function groupMarkdown(group: Group, label: string, shown: Shown): string {
  const turn = group.turn === null ? "" : `, turn ${String(group.turn)}`;
  const billed = group.said?.billed;
  const cost = billed === null || billed === undefined ? "" : `, $${billed.toFixed(3)}`;
  const head = `#### ${SEAT_TITLES[group.seat]} ${group.id}${turn} (${label}, ${group.at}${cost})`;
  const words = group.said?.text.trim() ?? "";
  // Fenced, so that a cut inside the model's own code block or heading cannot run into the page.
  const said = words === "" ? "_No words in this turn._" : fenced(clip(words, shown), "markdown");
  const stop =
    group.said?.error === null || group.said?.error === undefined ? [] : [`Error: ${group.said.error}`];
  return [
    head,
    "",
    said,
    ...stop,
    ...group.calls.map((call, at) => `\n${callMarkdown(call, at + 1, shown)}`),
  ].join("\n");
}

/** One row a session, or one row a group where one session is chosen or the seat has one. */
function overview(groups: readonly Group[], selector: Selector): string {
  const ids = [...new Set(groups.map((group) => group.id))];
  if (ids.length > 1 && selector.id === null) {
    const rows = ids.map((id) => {
      const own = groups.filter((group) => group.id === id);
      const billed = own.reduce((sum, group) => sum + (group.said?.billed ?? 0), 0);
      const calls = own.reduce((sum, group) => sum + group.calls.length, 0);
      return `| ${id} | ${String(own.length)} | ${String(calls)} | ${own[0]?.at ?? ""} | ${own.at(-1)?.at ?? ""} | $${billed.toFixed(2)} |`;
    });
    return [
      "| session | turns | calls | first | last | billed |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n");
  }
  const rows = groups.map(
    (group, at) =>
      `| ${String(at + 1)} | ${group.id} | ${String(group.turn ?? "")} | ${group.at} | ${group.calls.map((call) => call.tool).join(", ") || "none"} | ${String(group.said?.text.length ?? 0)} |`,
  );
  return [
    "| group | session | turn | at | calls | words (characters) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function eventsMarkdown(events: readonly LogEvent[], selector: Selector, shown: Shown): string {
  const own = events.filter((event) => event.kind === selector.kind);
  if (own.length === 0) return `_The log holds no \`${String(selector.kind)}\` event._`;
  if (selector.items === null) {
    const rows = own.map(
      (event, at) =>
        `| ${String(at + 1)} | ${event.at} | ${capturedJsonStringify(event.data).slice(0, 100)} |`,
    );
    return ["| item | at | data begins |", "| --- | --- | --- |", ...rows].join("\n");
  }
  const chosen = pick(selector.items, own.length);
  if (chosen.length === 0) {
    return `_The log holds ${plural(own.length, `\`${String(selector.kind)}\` event`)}; \`{${selector.items}}\` names none._`;
  }
  return chosen
    .map((at) => {
      const event = own[at];
      if (event === undefined) return "";
      const head = `#### \`${event.kind}\` ${String(at + 1)} of ${String(own.length)} (${event.at})`;
      return `${head}\n\n${fenced(clip(capturedJsonStringify(event.data, null, 1), shown), "json")}`;
    })
    .join("\n\n");
}

/** The markdown selector `text` chooses from `events`. */
export function slice(events: readonly LogEvent[], text: string, shown: Shown): string {
  const selector = parseSelector(text);
  if (selector.seat === null) return eventsMarkdown(events, selector, shown);
  const groups = groupsOf(events, selector.seat, selector.id);
  const of = selector.id === null ? "" : ` of ${selector.id}`;
  if (groups.length === 0) return `_The log holds no ${SEAT_TITLES[selector.seat]} turn${of}._`;
  if (selector.items === null) return overview(groups, selector);
  const chosen = pick(selector.items, groups.length);
  if (chosen.length === 0) {
    return `_The ${SEAT_TITLES[selector.seat]}${of} took ${plural(groups.length, "turn")}; \`{${selector.items}}\` names none._`;
  }
  return chosen
    .flatMap((at) => {
      const group = groups[at];
      return group === undefined
        ? []
        : [groupMarkdown(group, `group ${String(at + 1)} of ${String(groups.length)}`, shown)];
    })
    .join("\n\n");
}

/** Every selector's markdown over the log run `named` resolves to, under one heading each. */
export async function sliceRun(named: string, selectors: readonly string[], shown: Shown): Promise<string> {
  const path = await logAcross(named, "record");
  const run = basename(path === named && !named.endsWith(LOG_FILE) ? named : dirname(path));
  const events = read(path);
  return selectors.map((text) => `### ${run}: \`${text}\`\n\n${slice(events, text, shown)}`).join("\n\n");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "slice",
      usage: "slice.ts <run | log | folder> <selector>... [--whole] [--max-chars 6000]",
      options: { whole: "flag", "max-chars": "int" },
      positionals: [2, 64],
    },
    async (args: CommandArgs) => {
      const [named = "", ...selectors] = args.positionals;
      console.log(
        await sliceRun(named, selectors, {
          whole: args.flag("whole"),
          maxChars: args.int("max-chars") ?? DEFAULT_MAX_CHARS,
        }),
      );
    },
  );
}

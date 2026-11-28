#!/usr/bin/env bun
/**
 * Prints parts of one campaign's log as markdown, chosen by where they stand in the run: `slice.ts
 * <run | log | folder> <selector>... [--whole] [--max-chars 6000] [--count <phrase>]`.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { printed } from "#skills/main/print.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { type Call, type Seat, type Turn, tracesIn } from "#src/kernel/trace.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "#src/meta/optional-key.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

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
  readonly items: string | null;
  readonly tools?: readonly string[];
}

interface Shown {
  readonly whole: boolean;
  readonly maxChars: number;
  readonly count?: string;
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
} as const satisfies Record<string, Seat>;

const SEAT_TITLES = {
  build: "Builder",
  exam: "Examiner",
  draft: "Drafter",
  referee: "Referee",
  solve: "Solver",
} as const satisfies Record<Seat, string>;

const SELECTOR =
  /^(?<what>[A-Za-z][\w.]*)(?::(?<id>[^{}[\]]+))?(?:\[(?<tools>[^[\]]*)\])?(?:\{(?<items>[^{}]*)\})?$/u;
export const DEFAULT_MAX_CHARS = 6000;

export function parseSelector(text: string): Selector {
  const groups = SELECTOR.exec(text.trim())?.groups;
  const what = groups?.what;
  if (what === undefined) {
    throw new CommandFailure(`${text}: a selector is <seat or kind>[:<session>][[<tool>,...]][{<items>}]`);
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
  const tools = groups?.tools?.split(",").map((tool) => tool.trim());
  if (tools !== undefined && (seat === null || tools.includes(""))) {
    throw new CommandFailure(`${text}: a [tool,...] list follows a seat and names each tool`);
  }
  return {
    seat,
    kind: seat === null ? what : null,
    id: groups?.id?.trim() ?? null,
    items: groups?.items ?? null,
    ...keyIfDefined("tools", tools),
  };
}

/** A range past the end is cut at the end: a reader guesses wide, and what is not there is no fault. */
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

/** An older log writes a turn's calls before the turn, numbered one lower: a session whose first
 *  trace is a call holds its calls for the turn that follows them. */
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

export function fenced(text: string, lang = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text.endsWith("\n") ? text : `${text}\n`}${fence}`;
}

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

function overview(groups: readonly Group[], selector: Selector): string {
  const ids = [...new Set(groups.map((group) => group.id))];
  if (ids.length > 1 && selector.id === null) {
    const rows = ids.map((id) => {
      const own = groups.filter((group) => group.id === id);
      const billed = own.reduce((sum, group) => sum + (group.said?.billed ?? 0), 0);
      const calls = own.reduce((sum, group) => sum + group.calls.length, 0);
      return [
        id,
        String(own.length),
        String(calls),
        own[0]?.at ?? "",
        own.at(-1)?.at ?? "",
        `$${billed.toFixed(2)}`,
      ];
    });
    return printed(["session", "turns", "calls", "first", "last", "billed"], rows);
  }
  const rows = groups.map((group, at) => [
    String(at + 1),
    group.id,
    String(group.turn ?? ""),
    group.at,
    group.calls.map((call) => call.tool).join(", ") || "none",
    String(group.said?.text.length ?? 0),
  ]);
  return printed(["group", "session", "turn", "at", "calls", "words (characters)"], rows);
}

function eventsMarkdown(events: readonly LogEvent[], selector: Selector, shown: Shown): string {
  const own = events.filter((event) => event.kind === selector.kind);
  if (own.length === 0) return `_The log holds no \`${String(selector.kind)}\` event._`;
  const phrase = shown.count;
  if (phrase !== undefined) {
    const chosen = selector.items === null ? own.map((_, at) => at) : pick(selector.items, own.length);
    const rows = chosen.map((at) => {
      const data = capturedJsonStringify(own[at]?.data ?? {});
      return `- ${String(selector.kind)} ${String(at + 1)} of ${String(own.length)}: ${String(occurrences(data, phrase))}`;
    });
    return [`"${phrase}" in each chosen event's data, as JSON:`, ...rows].join("\n");
  }
  if (selector.items === null) {
    const rows = own.map((event, at) => [
      String(at + 1),
      event.at,
      capturedJsonStringify(event.data).slice(0, 100),
    ]);
    return [
      `An index of each event's first 100 characters; \`${String(selector.kind)}{1-${String(own.length)}}\` gives each whole.`,
      "",
      printed(["item", "at", "data begins"], rows),
    ].join("\n");
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

const occurrences = (text: string, phrase: string): number => text.split(phrase).length - 1;

function countRows(groups: readonly Group[], phrase: string): string {
  const calls = groups.flatMap(({ calls: each }) => each);
  const found = calls.map((call) => occurrences(call.text, phrase));
  const head = `"${phrase}" in each chosen call's result: ${String(found.filter((count) => count > 0).length)} of ${plural(calls.length, "call")} hold it, ${String(found.reduce((sum, count) => sum + count, 0))} times in all`;
  const rows = calls.map(
    (call, at) => `- ${call.id} turn ${String(call.turn ?? "?")} ${call.tool}: ${String(found[at] ?? 0)}`,
  );
  return [head, ...rows].join("\n");
}

/** The groups whose calls include one to `tools`, each keeping those calls alone; a tool none of
 *  `groups` called is refused with the tools they did call. */
function withTools(groups: readonly Group[], tools: readonly string[] | undefined): Group[] {
  if (tools === undefined) return [...groups];
  const used = new Set(groups.flatMap(({ calls }) => calls.map(({ tool }) => tool)));
  const missing = tools.filter((tool) => !used.has(tool));
  if (missing.length > 0) {
    throw new CommandFailure(
      `${missing.join(", ")}: no chosen call used it; they called ${[...used].toSorted().join(", ") || "no tool"}`,
    );
  }
  return groups.flatMap((group) => {
    const calls = group.calls.filter(({ tool }) => tools.includes(tool));
    return calls.length === 0 ? [] : [{ ...group, calls }];
  });
}

export function slice(events: readonly LogEvent[], text: string, shown: Shown): string {
  const selector = parseSelector(text);
  if (selector.seat === null) return eventsMarkdown(events, selector, shown);
  const all = groupsOf(events, selector.seat, selector.id);
  const of = selector.id === null ? "" : ` of ${selector.id}`;
  if (all.length === 0) return `_The log holds no ${SEAT_TITLES[selector.seat]} turn${of}._`;
  const groups = withTools(all, selector.tools);
  if (selector.items === null) {
    return shown.count === undefined ? overview(groups, selector) : countRows(groups, shown.count);
  }
  const chosen = pick(selector.items, groups.length);
  if (chosen.length === 0) {
    return `_The ${SEAT_TITLES[selector.seat]}${of} took ${plural(groups.length, "turn")}; \`{${selector.items}}\` names none._`;
  }
  if (shown.count !== undefined) {
    return countRows(
      chosen.flatMap((at) => groups.slice(at, at + 1)),
      shown.count,
    );
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
      usage: [
        "What a seat read and said at a turn: the text of a tool's result (read_opening, compare, wait,",
        "practice), a turn's words, an event whole, or how often a phrase stands in each result.",
        "",
        "slice.ts <run | log | folder> <selector>... [--whole] [--max-chars 6000] [--count <phrase>]",
        "  selector: <seat or kind>[:<session>][[<tool>,...]][{<items>}], as Builder:b-1[read_opening]{~1}",
      ].join("\n"),
      options: { whole: "flag", "max-chars": "int", count: "text" },
      positionals: [2, 64],
    },
    async (args: CommandArgs) => {
      const [named = "", ...selectors] = args.positionals;
      const count = args.value("count");
      if (count === "") args.die("--count takes a phrase of at least one character");
      console.log(
        await sliceRun(named, selectors, {
          whole: args.flag("whole"),
          maxChars: args.int("max-chars") ?? DEFAULT_MAX_CHARS,
          ...keyIfNotNull("count", count),
        }),
      );
    },
  );
}

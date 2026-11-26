#!/usr/bin/env bun
/**
 * Background log waiter: `until.ts <log | folder | name> [--at <kind>[:<count>|:next]] [--hours
 * <n>] [--say <text>]` polls a campaign log until it records `count` events of the kind (1 by
 * default; `:next` targets one more than at startup, for per-promotion chaining), reaches
 * `campaign.ended`, or passes `--hours` since opening, then prints one status line with live counts
 * to wake the calling session. `--say` appends a note without conferring operator authority.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { type EventKind, isKind, type LogEvent } from "#src/kernel/log.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { PROMOTED, REPORTED, TRIGGER_AT } from "#tools/runs/summary.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

interface BoundSpec {
  readonly kind: EventKind;
  readonly target: number | "next";
}

interface Wait {
  readonly bound: { readonly kind: EventKind; readonly count: number } | null;
  readonly hours: number | null;
  readonly say: string | null;
}

const POLL_MS = 30_000;
const MAX_READ_FAILS = 10;
const USAGE =
  "usage: until.ts <log | folder | name> [--at <kind>[:<count>|next]] [--hours <n>] [--say <text>]";

/** A kind no log holds is refused, since a mistyped one would wait for good. */
function boundOf(text: string): BoundSpec {
  const [kind = "", count = "1"] = text.split(":");
  if (!isKind(kind)) throw new Error(`--at ${text}: ${kind} is no event kind`);
  if (count === "next") return { kind, target: "next" };
  if (!/^[1-9]\d*$/u.test(count)) {
    throw new Error(`--at ${text}: the count is a whole number >= 1 or "next"`);
  }
  return { kind, target: Number(count) };
}

function untilLine(name: string, events: readonly LogEvent[], wait: Wait, now: number): string | null {
  const { bound, hours, say } = wait;
  const count = events.filter(({ kind }) => kind === bound?.kind).length;
  const opened = events.find(({ kind }) => kind === "campaign.opened")?.at;
  const since = opened === undefined ? null : (now - Date.parse(opened)) / HOUR_MS;
  const why = [
    bound !== null && count >= bound.count ? `${String(bound.count)} ${bound.kind}` : null,
    events.at(-1)?.kind === "campaign.ended" ? "an ending before any bound" : null,
    hours !== null && since !== null && since >= hours
      ? `${String(hours)} raw hours with no bound reached`
      : null,
  ].find((reason) => reason !== null);
  if (why === undefined) return null;
  const promos = events.filter(({ kind }) => kind === PROMOTED).length;
  const compared = events.filter(({ kind }) => kind === REPORTED).length;
  const counted = bound === null ? "" : `; ${String(count)} ${bound.kind}`;
  const summary = ` (${String(promos)} promoted in ${String(compared)} compared, ${String(events.length)} events)`;
  const raw = since === null ? "no opening in the log" : `${since.toFixed(1)} raw hours since it opened`;
  const at = `${new Date(now).toISOString().slice(0, 16)}Z`;
  const decision =
    bound?.kind === PROMOTED
      ? ` Backtrack predictions-${name}.md against the log and decide pause (--after reported) vs continue (up to ${String(TRIGGER_AT.ceilingPromotions)}).`
      : "";
  return `UNTIL (automated, not operator input) at ${at}: ${name} reached ${why}${counted}${summary}; ${raw}.${decision}${say === null ? "" : ` ${say}`}`;
}

/** Reads `log` when its file signature moved, or null on transient swap or partial-line errors. */
function pollLog(
  log: string,
  prev: { readonly sig: string; readonly events: LogEvent[] },
): { readonly sig: string; readonly events: LogEvent[] } | null {
  try {
    const file = Bun.file(log);
    const sig = `${String(file.size)}:${String(file.lastModified)}`;
    if (sig === prev.sig && prev.events.length > 0) return prev;
    const events = logEvents(log);
    return { sig, events };
  } catch {
    return null;
  }
}

if (import.meta.main) {
  await runCommand(
    { name: "until", usage: USAGE, options: { at: "text", hours: "text", say: "text" }, positionals: 1 },
    async (args: CommandArgs) => {
      const [at, asked] = [args.value("at"), args.value("hours")];
      const hours = asked === null ? null : Number(asked);
      const spec = at === null ? null : boundOf(at);
      if (hours !== null && !(hours > 0)) args.die("--hours must be a number above 0");
      if (spec === null && hours === null) args.die("name --at, --hours or both");
      const log = await logAcross(args.positionals[0] ?? "");
      let state = pollLog(log, { sig: "", events: [] });
      if (state === null || state.events.length === 0) {
        throw new CommandFailure(`${log} holds no readable event`);
      }
      const initial = spec === null ? 0 : state.events.filter(({ kind }) => kind === spec.kind).length;
      const bound =
        spec === null ? null : { kind: spec.kind, count: spec.target === "next" ? initial + 1 : spec.target };
      const wait: Wait = { bound, hours, say: args.value("say") };
      let misses = 0;
      for (;;) {
        const next = pollLog(log, state);
        if (next === null) {
          misses += 1;
          if (misses >= MAX_READ_FAILS) {
            throw new CommandFailure(
              `${log} stayed unreadable for ${String(misses)} consecutive checks (ENOENT or partial write)`,
            );
          }
          await Bun.sleep(POLL_MS);
          continue;
        }
        misses = 0;
        state = next;
        const line = untilLine(basename(dirname(log)), state.events, wait, Date.now());
        if (line !== null) return console.log(line);
        await Bun.sleep(POLL_MS);
      }
    },
  );
}

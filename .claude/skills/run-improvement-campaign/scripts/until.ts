#!/usr/bin/env bun
/**
 * Wait in the background until a run's log holds `count` events of the `--at` kind (1 by default),
 * ends, or is `--hours` raw hours past its opening, then print one line that says which and wakes
 * the session; `--say` appends the session's own words, which grant nothing.
 */
import { lastAt } from "#skills/main/logs.ts";
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { type EventKind, isKind, type LogEvent } from "#src/kernel/log.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

interface Wait {
  readonly bound: { readonly kind: EventKind; readonly count: number } | null;
  readonly hours: number | null;
  readonly say: string | null;
}

/** The `--at` asked; a kind no log holds is refused, since a mistyped one would wait for good. */
export function boundOf(text: string): NonNullable<Wait["bound"]> {
  const [kind = "", count = "1"] = text.split(":");
  if (!isKind(kind)) throw new Error(`--at ${text}: ${kind} is no event kind`);
  if (!/^[1-9]\d*$/.test(count)) throw new Error(`--at ${text}: the count is a whole number, at least 1`);
  return { kind, count: Number(count) };
}

/** The line that ends the wait on `events` at `now`, or null while it goes on. */
export function untilLine(name: string, events: readonly LogEvent[], wait: Wait, now: number): string | null {
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
  const counted = bound === null ? "" : `; ${String(count)} ${bound.kind}`;
  const raw = since === null ? "no opening in the log" : `${since.toFixed(1)} raw hours since it opened`;
  const at = `${new Date(now).toISOString().slice(0, 16)}Z`;
  return `UNTIL (automated, not operator input) at ${at}: ${name} reached ${why}${counted}; ${raw}.${say === null ? "" : ` ${say}`}`;
}

if (import.meta.main) {
  const usage = "usage: until.ts <log | folder | name> [--at <kind>[:<count>]] [--hours <n>] [--say <text>]";
  await runCommand(
    { name: "until", usage, options: { at: "text", hours: "text", say: "text" }, positionals: 1 },
    async (args: CommandArgs) => {
      const [at, asked] = [args.value("at"), args.value("hours")];
      const hours = asked === null ? null : Number(asked);
      const wait = { bound: at === null ? null : boundOf(at), hours, say: args.value("say") };
      if (wait.hours !== null && !(wait.hours > 0)) args.die("--hours must be a number above 0");
      if (wait.bound === null && wait.hours === null) args.die("name --at, --hours or both");
      const log = await logAcross(args.positionals[0] ?? "");
      // A log runs to tens of megabytes, so it is read again only once its last event has moved.
      let [seen, events]: [string, LogEvent[]] = ["", []];
      for (;;) {
        if (lastAt(log) !== seen) [seen, events] = [lastAt(log), logEvents(log)];
        const line = untilLine(basename(dirname(log)), events, wait, Date.now());
        if (line !== null) return console.log(line);
        if (events.length === 0) throw new CommandFailure(`${log} holds no event`);
        await Bun.sleep(30_000);
      }
    },
  );
}

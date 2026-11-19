/**
 * `bun run runs loadwatch [<seconds>] [--once | -s|--short [-w|--window 1m|5m|15m]]`: the CPU and
 * the load of this machine and of every host `ANA_HOSTS` lists, live in the terminal, refreshed
 * every `<seconds>` (5 by default); `--once` prints one frame and ends it with the machines in
 * order of load, the least loaded first, which is the line a session reads before it places a run;
 * `-s` (`--short`) prints only one line, `last 5m:` and then each machine's load a core over that
 * window out of 100, least loaded first, and `-w` (`--window`) names the one- or fifteen-minute
 * window instead.
 *
 * A deadline counts elapsed time, so a solve on a loaded host has less of the machine than one on a
 * quiet host under the same setting (`AGENTS.md`, section 10, item 4), and the solve queue only
 * holds a solve back for half an hour (`tools/d2/host.ts`). This is where an operator sees that
 * load before placing a run. It ports the operator's own `ana-loadwatch` (30 October), whose host
 * list was written into the script, to the host list every other verb reads.
 *
 * Each machine runs one sampling loop for the whole watch (`load.ts`), so a refresh costs no
 * connection, and a loop that closes or falls silent is opened again. A screen update is one write
 * of the lines that changed, inside synchronised output (DEC 2026), so the terminal paints it at once.
 */
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { hostsOf } from "./host-config.ts";
import { byLoad, firstSamples, stream, watchedOf, WINDOWS, type Watched, type Window } from "./load.ts";
import { Misused } from "./registry.ts";

const RETRY_MS = 3000;
const TICK_MS = 200;
const BAR = 40;
const ESC = "\u001B";
const [RESET, DIM, BOLD] = [`${ESC}[0m`, `${ESC}[2m`, `${ESC}[1m`];
const [GREEN, YELLOW, RED] = [`${ESC}[32m`, `${ESC}[33m`, `${ESC}[31m`];
const ROWS = ["cpu now ", "load 1m ", "load 5m ", "load 15m"] as const;

function bar(value: number, most: number): string {
  // A load above the core count shows as processes waiting beside the bar, never above 100%.
  const share = most > 0 ? value / most : 0;
  const filled = Math.min(BAR, Math.floor(share * BAR));
  const percent = Math.min(100, Math.floor(share * 100));
  const colour = percent >= 90 ? RED : percent >= 60 ? YELLOW : GREEN;
  return `${colour}${"█".repeat(filled)}${DIM}${"·".repeat(BAR - filled)}${RESET} ${String(percent).padStart(3)}%`;
}

function linesOf({ label, state }: Watched): string[] {
  const head = `${BOLD}${label.padEnd(20)}${RESET}`;
  if (state === "connecting" || state === "unreachable") {
    // The same skeleton as a sample's, so one arriving fills it in and nothing shifts.
    const said = state === "unreachable" ? `${RED}UNREACHABLE${RESET}` : `${DIM}connecting…${RESET}`;
    return [`${head} ${said}`, ...ROWS.map((row) => `  ${DIM}${row} ${"·".repeat(BAR)}     –${RESET}`)];
  }
  const { cores, loads, busy } = state;
  return [
    `${head} ${DIM}${String(cores)} cores${RESET}`,
    `  ${DIM}${ROWS[0]}${RESET} ${bar(busy, 100)}`,
    ...loads.map(
      (load, at) =>
        `  ${DIM}${ROWS[at + 1] ?? ""}${RESET} ${bar(load, cores)}  ${DIM}(${load.toFixed(2)})${RESET}${RED}${queuedOf(load, cores)}${RESET}`,
    ),
  ];
}

/** Past the core count, how many runnable processes wait for a core on average. */
function queuedOf(load: number, cores: number): string {
  return load - cores < 0.5 ? "" : ` +${(load - cores).toFixed(0)} waiting`;
}

function frame(watched: readonly Watched[], seconds: string): string[] {
  const now = new Date().toTimeString().slice(0, 8);
  return [
    `${BOLD}ana load watch${RESET}  ${DIM}${now}  (refresh ${seconds}s, ctrl-c quits)${RESET}`,
    ...watched.flatMap((each) => ["", ...linesOf(each)]),
    "",
    `${DIM}cpu: % busy now; load: the load average against the cores, capped at 100%; +N waiting: the queue beyond them${RESET}`,
  ];
}

/** `-s`: the window named first, then each machine's load a core over it out of 100, least loaded
 *  first, the queue beyond its cores as the frame says it, and a machine that did not answer last. */
function short(watched: readonly Watched[], window: string, at: Window): string {
  const read = byLoad(watched, at).map(({ label, load, cores }) => {
    const percent = Math.min(100, Math.round((100 * load) / cores));
    return `${label} ${String(percent)}/100${queuedOf(load, cores)}`;
  });
  const lost = watched.flatMap(({ label, state }) =>
    state === "unreachable" ? [`${label} unreachable`] : [],
  );
  return [`last ${window}:`, ...read, ...lost].join("  ");
}

/** Repaint the lines that changed since `before`, all of them after a resize, in one write. */
function paint(lines: readonly string[], before: readonly string[]): void {
  const changed = lines.flatMap((line, row) =>
    before[row] === line ? [] : [`${ESC}[${String(row + 1)};1H${line}${ESC}[K`],
  );
  const cleared = before.length > lines.length ? [`${ESC}[${String(lines.length + 1)};1H${ESC}[J`] : [];
  const reset = before.length === 0 ? [`${ESC}[H${ESC}[2J`] : [];
  const out = [...reset, ...changed, ...cleared];
  if (out.length > 0) runtimeProcess.stdout.write(`${ESC}[?2026h${out.join("")}${ESC}[?2026l`);
}

export async function loadwatch(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      short: { type: "boolean", short: "s", default: false },
      window: { type: "string", short: "w", default: "5m" },
    },
  });
  const [given = "5", extra] = positionals;
  const seconds = Number(given);
  const at = Object.entries(WINDOWS).find(([name]) => name === values.window)?.[1];
  if (extra !== undefined || !Number.isFinite(seconds) || seconds <= 0 || at === undefined) {
    throw new Misused();
  }
  const watched = watchedOf([undefined, ...hostsOf()], seconds);
  const intervalMs = seconds * 1000;
  if (values.once || values.short) {
    await firstSamples(watched, intervalMs);
    if (values.short) {
      console.log(short(watched, values.window, at));
      return;
    }
    // The one-minute ranking: the queue a solve started now would join.
    const order = byLoad(watched, 0).map(({ label, load, cores }) => `${label} ${(load / cores).toFixed(2)}`);
    console.log(
      [...frame(watched, given), `least loaded first, 1m load a core: ${order.join(", ")}`].join("\n"),
    );
    return;
  }
  for (const each of watched) {
    (async () => {
      for (;;) {
        await stream(each, intervalMs, "closed");
        await Bun.sleep(RETRY_MS);
      }
    })().catch(() => undefined);
  }
  let before: string[] = [];
  const quit = () => {
    for (const { child } of watched) if (child !== null) killProcessGroup(child, "SIGKILL");
    runtimeProcess.stdout.write(`${ESC}[?25h${ESC}[?1049l`);
    runtimeProcess.exit(0);
  };
  runtimeProcess.on("SIGINT", quit);
  runtimeProcess.on("SIGTERM", quit);
  runtimeProcess.on("SIGWINCH", () => {
    before = [];
  });
  // The alternate screen and a hidden cursor; the shell's screen comes back untouched on exit.
  runtimeProcess.stdout.write(`${ESC}[?1049h${ESC}[?25l`);
  for (;;) {
    const lines = frame(watched, given);
    paint(lines, before);
    before = lines;
    await Bun.sleep(TICK_MS);
  }
}

/**
 * `bun run runs loadwatch [<seconds>] [--once | -s|--short [-w|--window 1m|5m|15m]]`: the CPU and
 * the load of this machine and of every host `ANA_HOSTS` lists, live in the terminal, refreshed
 * every `<seconds>` (5 by default); `--once` prints one frame and ends it with the machines in
 * order of load, the least loaded first, which is the line a session reads before it places a run;
 * `-s` (`--short`) prints only one line, `last 5m:` and then each machine's load a core over that
 * window out of 100, least loaded first, and `-w` (`--window`) names the one- or fifteen-minute
 * window instead.
 */
import { byLoad, sampleOf, watchedScript, WINDOWS, type Watched } from "./load.ts";
import { BAR, bar, DIM, headOf, RED, RESET, waitingOf, watch } from "./watch.ts";

const ROWS = ["cpu now ", "load 1m ", "load 5m ", "load 15m"] as const;

function linesOf({ label, state }: Watched): string[] {
  if (state === "connecting" || state === "unreachable") {
    // The same skeleton as a sample's, so one arriving fills it in and nothing shifts.
    return [waitingOf(label, state), ...ROWS.map((row) => `  ${DIM}${row} ${"·".repeat(BAR)}     –${RESET}`)];
  }
  const { cores, loads, busy } = state;
  return [
    `${headOf(label)} ${DIM}${String(cores)} cores${RESET}`,
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

function frame(watched: readonly Watched[]): string[] {
  return [
    ...watched.flatMap((each) => ["", ...linesOf(each)]),
    "",
    `${DIM}cpu: % busy now; load: the load average against the cores, capped at 100%; +N waiting: the queue beyond them${RESET}`,
  ];
}

/** `-s`: the window named first, then each machine's load a core over it out of 100, least loaded
 *  first, the queue beyond its cores as the frame says it, and a machine that did not answer last. */
function short(watched: readonly Watched[], window = "5m"): string {
  const read = byLoad(
    watched,
    Object.entries(WINDOWS).find(([name]) => name === window)?.[1] ?? WINDOWS["5m"],
  ).map(({ label, load, cores }) => {
    const percent = Math.min(100, Math.round((100 * load) / cores));
    return `${label} ${String(percent)}/100${queuedOf(load, cores)}`;
  });
  const lost = watched.flatMap(({ label, state }) =>
    state === "unreachable" ? [`${label} unreachable`] : [],
  );
  return [`last ${window}:`, ...read, ...lost].join("  ");
}

export const loadwatch = (args: readonly string[]): Promise<void> =>
  watch(args, {
    name: "load",
    seconds: "5",
    script: watchedScript,
    parse: sampleOf,
    ready: () => true,
    frame,
    // The one-minute ranking: the queue a solve started now would join.
    once: (watched) => [
      `least loaded first, 1m load a core: ${byLoad(watched, WINDOWS["1m"])
        .map(({ label, load, cores }) => `${label} ${(load / cores).toFixed(2)}`)
        .join(", ")}`,
    ],
    short,
    windows: Object.keys(WINDOWS),
  });

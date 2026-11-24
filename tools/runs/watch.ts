/**
 * Shared terminal driver for live multi-host monitors (`loadwatch`, `netwatch`) over `ANA_HOSTS`
 * plus the local machine (`Watch`).
 *
 *   bun run runs <watch> [<seconds>] [--once | -s|--short [-w|--window <window>]]
 *
 * In live mode, redraws on the alternate screen until interrupted, maintaining one persistent
 * streaming shell loop per host (`keepFollowing`, `load.ts`) and emitting differential line updates
 * inside DEC 2026 synchronised-output blocks. `--once` prints a single frame once every host has
 * reported or timed out; `-s` prints a one-line summary for the selected `-w` window.
 */
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { hostsOf } from "./host-config.ts";
import { firstReadings, keepFollowing, watchersOf, type State, type Watched } from "./load.ts";
import { Misused } from "./registry.ts";

/** What one watch reads from each machine and draws. */
interface Watch<S> {
  /** The frame's title is `ana <name> watch`. */
  readonly name: string;
  /** The refresh in seconds where none is given. */
  readonly seconds: string;
  /** The shell loop each machine runs, printing one block a reading, each ended by a `---` line. */
  readonly script: (seconds: number) => string;
  /** A reading from a block and the machine's reading before it, or null for a block that is not one. */
  readonly parse: (block: string, before: State<S>) => S | null;
  /** Whether a reading has all a frame draws. */
  readonly ready: (reading: S) => boolean;
  /** The frame below its title. */
  readonly frame: (watched: readonly Watched<S>[]) => string[];
  /** What `--once` prints below the frame. */
  readonly once: (watched: readonly Watched<S>[]) => string[];
  /** `-s`'s line, over `window` where the watch has windows. */
  readonly short: (watched: readonly Watched<S>[], window: string | undefined) => string;
  /** The windows `-w` names, none where the watch has none. */
  readonly windows: readonly string[];
}

const TICK_MS = 200;
export const BAR = 40;
const ESC = "\u001B";
export const [RESET, DIM, BOLD] = [`${ESC}[0m`, `${ESC}[2m`, `${ESC}[1m`];
export const [GREEN, YELLOW, RED] = [`${ESC}[32m`, `${ESC}[33m`, `${ESC}[31m`];

/** `value` against `most` as a bar and a percent, both capped at full. */
export function bar(value: number, most: number): string {
  const share = most > 0 ? value / most : 0;
  const filled = Math.min(BAR, Math.floor(share * BAR));
  const percent = Math.min(100, Math.floor(share * 100));
  const colour = percent >= 90 ? RED : percent >= 60 ? YELLOW : GREEN;
  return `${colour}${"█".repeat(filled)}${DIM}${"·".repeat(BAR - filled)}${RESET} ${String(percent).padStart(3)}%`;
}

/** A machine's name, padded to the column. */
export const headOf = (label: string): string => `${BOLD}${label.padEnd(20)}${RESET}`;

/** A machine's head line before its first reading, or once it is lost. */
export const waitingOf = (label: string, state: "connecting" | "unreachable"): string =>
  `${headOf(label)} ${state === "unreachable" ? `${RED}UNREACHABLE${RESET}` : `${DIM}connecting…${RESET}`}`;

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

/** The interval the first positional names in seconds, `fallback` without one; misuse past it. */
export function secondsOf(positionals: readonly string[], fallback: string, name: string): number {
  const [given = fallback, extra] = positionals;
  const seconds = Number(given);
  if (extra !== undefined) {
    throw new Misused(`${name}watch takes one number of seconds, not \`${extra}\``);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Misused(`\`${given}\` is not a positive number of seconds`);
  }
  return seconds;
}

/** On ctrl-c or a kill, end every watched connection, run `last`, then exit; the same for a caller
 *  that calls the returned function. */
export function endingOn(watched: readonly { child: Bun.Subprocess | null }[], last = () => {}): () => never {
  const quit = (): never => {
    for (const { child } of watched) if (child !== null) killProcessGroup(child, "SIGKILL");
    last();
    return runtimeProcess.exit(0);
  };
  runtimeProcess.on("SIGINT", quit);
  runtimeProcess.on("SIGTERM", quit);
  return quit;
}

/** Draw `draw()` on the alternate screen with a hidden cursor until ctrl-c, which ends every watched
 *  connection and gives the shell's screen back untouched. */
async function liveScreen(
  watched: readonly { child: Bun.Subprocess | null }[],
  draw: () => string[],
): Promise<never> {
  let before: string[] = [];
  endingOn(watched, () => runtimeProcess.stdout.write(`${ESC}[?25h${ESC}[?1049l`));
  runtimeProcess.on("SIGWINCH", () => {
    before = [];
  });
  runtimeProcess.stdout.write(`${ESC}[?1049h${ESC}[?25l`);
  for (;;) {
    const lines = draw();
    paint(lines, before);
    before = lines;
    await Bun.sleep(TICK_MS);
  }
}

export async function watch<S>(args: readonly string[], spec: Watch<S>): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      short: { type: "boolean", short: "s", default: false },
      window: { type: "string", short: "w" },
    },
  });
  const seconds = secondsOf(positionals, spec.seconds, spec.name);
  const window = values.window;
  if (window !== undefined && !spec.windows.includes(window)) {
    throw new Misused(
      spec.windows.length === 0
        ? `${spec.name}watch takes no -w`
        : `-w takes ${spec.windows.join(", ")}, not \`${window}\``,
    );
  }
  const watched = watchersOf([undefined, ...hostsOf()], spec.script(seconds), spec.parse);
  const title = () =>
    `${BOLD}ana ${spec.name} watch${RESET}  ${DIM}${new Date().toTimeString().slice(0, 8)}  (refresh ${String(seconds)}s, ctrl-c quits)${RESET}`;
  if (values.once || values.short) {
    await firstReadings(watched, seconds * 1000, spec.ready);
    console.log(
      values.short
        ? spec.short(watched, window)
        : [title(), ...spec.frame(watched), ...spec.once(watched)].join("\n"),
    );
    return;
  }
  keepFollowing(watched, seconds * 1000);
  await liveScreen(watched, () => [title(), ...spec.frame(watched)]);
}

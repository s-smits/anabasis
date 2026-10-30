/**
 * `bun run runs loadwatch [<seconds>] [--once]`: the CPU and the load of this machine and of every
 * host `ANA_HOSTS` lists, live in the terminal, refreshed every `<seconds>` (5 by default); `--once`
 * prints one frame and ends.
 *
 * A deadline counts elapsed time, so a solve on a loaded host has less of the machine than one on a
 * quiet host under the same setting (`AGENTS.md`, section 10, item 4), and the solve queue only
 * holds a solve back for half an hour (`tools/d2/host.ts`). This is where an operator sees that
 * load before placing a run. It ports the operator's own `ana-loadwatch` (30 October), whose host
 * list was written into the script, to the host list every other verb reads.
 *
 * Each machine runs one sampling loop for the whole watch, so a refresh costs no connection. A host's
 * loop goes through `sshScript`, whose control socket (`sshOptions`) the other verbs and the check
 * runner share, so a reconnect after a drop reuses the connection that is already open. The loop
 * picks its source by what the machine has: `/proc/stat` deltas on
 * Linux, and on macOS a streaming `iostat`, whose tick deltas see short-lived processes that
 * `ps %cpu`, a decaying average, misses. A stream silent for longer than its interval and
 * `SILENT_MS` reads as unreachable and is opened again. A screen update is one write of the lines
 * that changed, inside synchronised output (DEC 2026), so the terminal paints it at once.
 */
import { capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { hostsOf, ownName } from "./host-config.ts";
import { sshScript } from "./host-command.ts";

interface Sample {
  readonly cores: number;
  /** The one-, five- and fifteen-minute load averages. */
  readonly loads: readonly [number, number, number];
  /** The share of the CPU busy over the last interval, in percent. */
  readonly busy: number;
}
type State = Sample | "connecting" | "unreachable";
interface Watched {
  readonly label: string;
  readonly argv: readonly string[];
  state: State;
  child: Bun.Subprocess | null;
}

const SILENT_MS = 20_000;
const RETRY_MS = 3000;
const TICK_MS = 200;
const BAR = 40;
const ESC = "\u001B";
const [RESET, DIM, BOLD] = [`${ESC}[0m`, `${ESC}[2m`, `${ESC}[1m`];
const [GREEN, YELLOW, RED] = [`${ESC}[32m`, `${ESC}[33m`, `${ESC}[31m`];
const ROWS = ["cpu now ", "load 1m ", "load 5m ", "load 15m"] as const;
const USAGE = "usage: runs loadwatch [<seconds>] [--once]";
// Each sample is "<cores>\n<1m> <5m> <15m>\n<idle percent>\n---\n". @I@ is the interval in seconds.
const LOOP = String.raw`
if [ -r /proc/stat ]; then
  n=$(nproc)
  snap() { read -r _ u ni s id io irq sirq st _ < /proc/stat; T=$((u+ni+s+id+io+irq+sirq+st)); I=$((id+io)); }
  snap; pT=$T; pI=$I; sleep 0.3
  while :; do
    snap; dt=$((T-pT)); di=$((I-pI)); pT=$T; pI=$I; [ "$dt" -gt 0 ] || dt=1
    read -r a b c _ < /proc/loadavg
    printf '%s\n%s %s %s\n%s\n---\n' "$n" "$a" "$b" "$c" "$((100*di/dt))"
    sleep @I@
  done
else
  n=$(sysctl -n hw.ncpu)
  emit='$1 ~ /^[0-9]+$/ && ++k > 1 { print n; print $4 " " $5 " " $6; print $3; print "---"; fflush() }'
  iostat -n0 -w 1 -c 2 | awk -v n="$n" "$emit"
  iostat -n0 -w @W@ | awk -v n="$n" "$emit"
fi
`;

/** One sample from the loop's block, or null for a block that is not one. */
function sampleOf(block: string): Sample | null {
  const [cores, loads, idle] = block.trim().split("\n");
  const [one, five, fifteen] = (loads ?? "").trim().split(/\s+/u).map(Number);
  const numbers = [Number(cores), one, five, fifteen, Number(idle)];
  if (!numbers.every((value) => value !== undefined && Number.isFinite(value))) return null;
  if (one === undefined || five === undefined || fifteen === undefined) return null;
  return { cores: Number(cores), loads: [one, five, fifteen], busy: Math.max(0, 100 - Number(idle)) };
}

/** Read one connection until it closes or falls silent, or until its first sample. */
async function stream(watched: Watched, intervalMs: number, until: "first" | "closed"): Promise<void> {
  const child = capturedSpawn([...watched.argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    detached: true,
  });
  watched.child = child;
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let silentMs = SILENT_MS;
  try {
    for (;;) {
      const read = await Promise.race([reader.read(), Bun.sleep(silentMs).then(() => null)]);
      if (read === null || read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const blocks = buffer.split("---\n");
      buffer = blocks.pop() ?? "";
      const sample = blocks.flatMap((block) => sampleOf(block) ?? []).at(-1);
      if (sample === undefined) continue;
      watched.state = sample;
      silentMs = intervalMs + SILENT_MS;
      if (until === "first") return;
    }
    watched.state = "unreachable";
  } finally {
    killProcessGroup(child, "SIGKILL");
    watched.child = null;
  }
}

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
    // Past the core count, how many runnable processes wait for a core on average.
    ...loads.map((load, at) => {
      const queued = load - cores < 0.5 ? "" : ` ${RED}+${(load - cores).toFixed(0)} waiting${RESET}`;
      return `  ${DIM}${ROWS[at + 1] ?? ""}${RESET} ${bar(load, cores)}  ${DIM}(${load.toFixed(2)})${RESET}${queued}`;
    }),
  ];
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
    options: { once: { type: "boolean", default: false } },
  });
  const [given = "5", extra] = positionals;
  const seconds = Number(given);
  if (extra !== undefined || !Number.isFinite(seconds) || seconds <= 0) throw new Error(USAGE);
  const script = LOOP.replaceAll("@I@", String(Math.max(seconds, 0.5))).replaceAll(
    "@W@",
    String(Math.max(1, Math.round(seconds))),
  );
  const watched: Watched[] = [
    { label: ownName(), argv: ["/bin/sh", "-c", script], state: "connecting", child: null },
    ...hostsOf().map((host) => ({
      label: host.name,
      argv: sshScript(host, script),
      state: "connecting" as const,
      child: null,
    })),
  ];
  const intervalMs = seconds * 1000;
  if (values.once) {
    await Promise.all(watched.map((each) => stream(each, intervalMs, "first")));
    console.log(frame(watched, given).join("\n"));
    return;
  }
  for (const each of watched) {
    void (async () => {
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

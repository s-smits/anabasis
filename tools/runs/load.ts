/**
 * Host CPU and load-average sampling and streaming watcher primitives (`watchersOf`,
 * `keepFollowing`, `firstReadings`, `minuteLoads`). Powers both `bun run runs loadwatch` and
 * `ANA_CHECK_HOST=auto` host selection so interactive monitoring and automated task placement read
 * identical metrics.
 */
import { capturedSpawn } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import type { Host } from "./host-config.ts";
import { ownName } from "./host-config.ts";
import { shellOn } from "./host-command.ts";

interface Sample {
  readonly cores: number;
  /** The one-, five- and fifteen-minute load averages. */
  readonly loads: readonly [number, number, number];
  /** The share of the CPU busy over the last interval, in percent. */
  readonly busy: number;
}
export type State<S = Sample> = S | "connecting" | "unreachable";
export interface Watched<S = Sample> {
  readonly label: string;
  /** The host sampled, or undefined for this machine. */
  readonly host: Host | undefined;
  readonly argv: readonly string[];
  /** One reading from a block of the loop's output and the reading before it, or null for a block
   *  that is not one. */
  readonly parse: (block: string, before: State<S>) => S | null;
  state: State<S>;
  child: Bun.Subprocess | null;
}

/** Each load average by its window, and its place in a sample's `loads`. */
export const WINDOWS = { "1m": 0, "5m": 1, "15m": 2 } as const;
type Window = (typeof WINDOWS)[keyof typeof WINDOWS];

const SILENT_MS = 20_000;
const RETRY_MS = 3000;
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
// One-shot load reading for `minuteLoads`: same block format as `LOOP`, without `iostat`'s 1s or
// `/proc/stat`'s 0.3s CPU-busy sleep, which `minuteLoads` never reads.
const ONCE = String.raw`
if [ -r /proc/loadavg ]; then
  read -r a b c _ < /proc/loadavg
  printf '%s\n%s %s %s\n0\n---\n' "$(nproc)" "$a" "$b" "$c"
else
  n=$(sysctl -n hw.ncpu 2>/dev/null || true)
  l=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || true)
  printf '%s\n%s\n0\n---\n' "$n" "$l"
fi
`;

/** Null after `ms`, on a timer that does not hold the process open once the race it is in is over:
 *  a `Bun.sleep` there kept a pick that had its answers alive for the whole silence. */
function lapse(ms: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, ms).unref();
  });
}

/** One sample from the loop's block, or null for a block that is not one, a count of no cores
 *  among them. */
export function sampleOf(block: string): Sample | null {
  const [cores, loads, idle] = block.trim().split("\n");
  const [one, five, fifteen] = (loads ?? "").trim().split(/\s+/u).map(Number);
  const numbers = [Number(cores), one, five, fifteen, Number(idle)];
  if (!numbers.every((value) => value !== undefined && Number.isFinite(value))) return null;
  if (one === undefined || five === undefined || fifteen === undefined || !(Number(cores) > 0)) return null;
  return { cores: Number(cores), loads: [one, five, fifteen], busy: Math.max(0, 100 - Number(idle)) };
}

/** The sampling loop, a sample every `seconds`. */
export const watchedScript = (seconds: number): string =>
  LOOP.replaceAll("@I@", String(Math.max(seconds, 0.5))).replaceAll(
    "@W@",
    String(Math.max(1, Math.round(seconds))),
  );

/** This machine (`undefined`) and each host, each to run the shell loop `script`, whose blocks
 *  `parse` reads, not yet read. */
export function watchersOf<S>(
  hosts: readonly (Host | undefined)[],
  script: string,
  parse: (block: string, before: State<S>) => S | null,
): Watched<S>[] {
  return hosts.map((host) => ({
    label: host?.name ?? ownName(),
    host,
    argv: shellOn(host, script),
    parse,
    state: "connecting",
    child: null,
  }));
}

/** Follow each connection for good, opening one that closes or falls silent again after a pause. */
export function keepFollowing<S>(watched: readonly Watched<S>[], intervalMs: number): void {
  for (const each of watched) {
    (async () => {
      for (;;) {
        await follow(each, intervalMs, null);
        await Bun.sleep(RETRY_MS);
      }
    })().catch(() => undefined);
  }
}

/** Read one connection's blocks, each ended by a `---` line, until it closes or falls silent, or
 *  until a reading is `ready`; each read block in turn is the watched state. */
async function follow<S>(
  watched: Watched<S>,
  intervalMs: number,
  ready: ((reading: S) => boolean) | null,
): Promise<void> {
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
      const read = await Promise.race([reader.read(), lapse(silentMs)]);
      if (read === null || read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      const blocks = buffer.split("---\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const reading = watched.parse(block, watched.state);
        if (reading === null) continue;
        watched.state = reading;
        silentMs = intervalMs + SILENT_MS;
        if (ready?.(reading) === true) return;
      }
    }
    watched.state = "unreachable";
  } finally {
    killProcessGroup(child, "SIGKILL");
    watched.child = null;
  }
}

/** Each machine's first `ready` reading, all at once; with `deadlineMs`, a machine that has none by
 *  then is stopped. */
export async function firstReadings<S>(
  watched: readonly Watched<S>[],
  intervalMs: number,
  ready: (reading: S) => boolean,
  deadlineMs?: number,
): Promise<void> {
  const all = Promise.all(watched.map((each) => follow(each, intervalMs, ready)));
  if (deadlineMs === undefined) {
    await all;
    return;
  }
  await Promise.race([all, lapse(deadlineMs)]);
  for (const { child } of watched) if (child !== null) killProcessGroup(child, "SIGKILL");
}

/** The machines that answered, least loaded first, by one load average a core. A machine that did
 *  not answer is left out, never read as idle. */
export function byLoad(
  watched: readonly Watched[],
  at: Window,
): { label: string; host: Host | undefined; load: number; cores: number }[] {
  const read = watched.flatMap(({ label, host, state }) =>
    state === "connecting" || state === "unreachable"
      ? []
      : [{ label, host, load: state.loads[at], cores: state.cores }],
  );
  return read.toSorted((a, b) => a.load / a.cores - b.load / b.cores);
}

/** One reading of each machine's one-minute load a core, at most `waitMs` long: those that answered,
 *  least loaded first, and the labels of those that did not, which are never read as idle. The
 *  check runner's `auto` and a fresh campaign's placement both choose by it. */
export async function minuteLoads(
  hosts: readonly (Host | undefined)[],
  waitMs: number,
): Promise<{ order: { label: string; host: Host | undefined; share: number }[]; silent: string[] }> {
  const watched = watchersOf(hosts, ONCE, sampleOf);
  await firstReadings(watched, 1000, () => true, waitMs);
  const order = byLoad(watched, WINDOWS["1m"]).map(({ label, host, load, cores }) => ({
    label,
    host,
    share: load / cores,
  }));
  const silent = watched.flatMap(({ label }) => (order.some((each) => each.label === label) ? [] : [label]));
  return { order, silent };
}

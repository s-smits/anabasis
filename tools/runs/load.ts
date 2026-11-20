/**
 * The load of this machine and of hosts, sampled: what `runs loadwatch` draws and what the check
 * runner's `RUN_REMOTE=auto` chooses by, so both read the one sample and the one order.
 *
 * Each machine runs one sampling loop, through `shellOn`: on a host that is `sshScript`, whose
 * control socket (`sshOptions`) the other verbs and the check runner share, so a reconnect after a
 * drop reuses the connection that is already open. The loop picks its source by what the machine
 * has: `/proc/stat` deltas on Linux, and on macOS a streaming `iostat`, whose tick deltas see
 * short-lived processes that `ps %cpu`, a decaying average, misses. A stream silent for longer than
 * its interval and `SILENT_MS` reads as unreachable.
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
export type State = Sample | "connecting" | "unreachable";
export interface Watched {
  readonly label: string;
  /** The host sampled, or undefined for this machine. */
  readonly host: Host | undefined;
  readonly argv: readonly string[];
  state: State;
  child: Bun.Subprocess | null;
}

/** Each load average by its window, and its place in a sample's `loads`. */
export const WINDOWS = { "1m": 0, "5m": 1, "15m": 2 } as const;
export type Window = (typeof WINDOWS)[keyof typeof WINDOWS];

const SILENT_MS = 20_000;
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
function sampleOf(block: string): Sample | null {
  const [cores, loads, idle] = block.trim().split("\n");
  const [one, five, fifteen] = (loads ?? "").trim().split(/\s+/u).map(Number);
  const numbers = [Number(cores), one, five, fifteen, Number(idle)];
  if (!numbers.every((value) => value !== undefined && Number.isFinite(value))) return null;
  if (one === undefined || five === undefined || fifteen === undefined || !(Number(cores) > 0)) return null;
  return { cores: Number(cores), loads: [one, five, fifteen], busy: Math.max(0, 100 - Number(idle)) };
}

/** This machine (`undefined`) and each host, not yet sampled, each sampled every `seconds`. */
export function watchedOf(hosts: readonly (Host | undefined)[], seconds: number): Watched[] {
  const script = LOOP.replaceAll("@I@", String(Math.max(seconds, 0.5))).replaceAll(
    "@W@",
    String(Math.max(1, Math.round(seconds))),
  );
  return hosts.map((host) => ({
    label: host?.name ?? ownName(),
    host,
    argv: shellOn(host, script),
    state: "connecting",
    child: null,
  }));
}

/** Read one connection until it closes or falls silent, or until its first sample. */
export async function stream(watched: Watched, intervalMs: number, until: "first" | "closed"): Promise<void> {
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

/** The first sample of each, all at once; with `deadlineMs`, a machine that has not answered by
 *  then is stopped and keeps no sample. */
export async function firstSamples(
  watched: readonly Watched[],
  intervalMs: number,
  deadlineMs?: number,
): Promise<void> {
  const all = Promise.all(watched.map((each) => stream(each, intervalMs, "first")));
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
  const watched = watchedOf(hosts, 1);
  await firstSamples(watched, 1000, waitMs);
  const order = byLoad(watched, WINDOWS["1m"]).map(({ label, host, load, cores }) => ({
    label,
    host,
    share: load / cores,
  }));
  const silent = watched.flatMap(({ label }) => (order.some((each) => each.label === label) ? [] : [label]));
  return { order, silent };
}

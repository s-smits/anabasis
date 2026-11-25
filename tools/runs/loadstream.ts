/**
 * `bun run runs loadwatch --json [<seconds>] [--once]`: each machine's CPU in detail as one JSON line
 * every `<seconds>` (1 by default), for a program that keeps its own history: the busy share split
 * into user, system and idle, the busy share of every core, the load averages, the cores and their
 * kind, and the busiest processes. `--once` prints one line once every machine has answered.
 *
 * Each machine runs one Python loop (`DETAIL`) over its kernel's counters: `/proc` on Linux, the
 * Mach per-processor ticks and `ps` on macOS. The placement path keeps `load.ts`'s shell loop, which
 * needs no Python.
 */
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hostsOf } from "./host-config.ts";
import { firstReadings, keepFollowing, watchersOf, type State, type Watched } from "./load.ts";
import { endingOn, secondsOf } from "./watch.ts";

export interface Detail {
  readonly cores: number;
  readonly model: string;
  /** The efficiency and performance cores, in that order among `perCore`, where the machine has both. */
  readonly clusters: { readonly efficiency: number; readonly performance: number } | null;
  readonly loads: readonly [number, number, number];
  /** The whole CPU over the last interval, in percent. */
  readonly cpu: { readonly user: number; readonly system: number; readonly idle: number };
  /** Each core's busy share over the last interval, in percent. */
  readonly perCore: readonly number[];
  /** The busiest processes, refreshed every five seconds or so, busiest first. */
  readonly top: readonly { readonly pid: number; readonly cpu: number; readonly name: string }[];
  readonly at: number;
}

// Each block: `cores`, `model`, `clusters <efficiency> <performance>` (macOS with both kinds),
// `load`, `cpu <user> <system> <idle>`, `core <busy>…`, then `proc <pid> <cpu> <name>` lines on the
// readings that carry processes, ended by `---`. @I@ is the interval in seconds.
const DETAIL = String.raw`
p=$(command -v python3 || echo /usr/bin/python3)
exec "$p" - @I@ <<'PY'
import os, sys, time, subprocess
interval = float(sys.argv[1])
every = max(1, round(5 / interval))
linux = os.path.exists("/proc/stat")

def emit(lines):
    sys.stdout.write("\n".join(lines) + "\n---\n")
    sys.stdout.flush()

if linux:
    hz = os.sysconf("SC_CLK_TCK")
    with open("/proc/cpuinfo") as f:
        model = next((l.split(":", 1)[1].strip() for l in f if l.startswith("model name")), "")
    clusters = None

    def ticks():
        cores = []
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("cpu") and line[3].isdigit():
                    v = [int(x) for x in line.split()[1:9]] + [0] * 8
                    cores.append((v[0] + v[1], v[2] + v[5] + v[6] + v[7], v[3] + v[4]))
        return cores

    def diff(a, b):
        return [max(0, y - x) for x, y in zip(a, b)]

    seen, seen_at = {}, 0.0
    def busiest():
        global seen, seen_at
        now, at = {}, time.monotonic()
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open("/proc/" + pid + "/stat") as f:
                    s = f.read()
            except OSError:
                continue
            fields = s[s.rindex(")") + 2:].split()
            name = s[s.index("(") + 1:s.rindex(")")].replace("\n", " ").replace("\r", " ")
            now[pid] = (int(fields[11]) + int(fields[12]), name)
        span = (at - seen_at) * hz
        rows = (
            [
                (100 * (t - seen[pid][0]) / span, int(pid), name)
                for pid, (t, name) in now.items()
                if pid in seen and t >= seen[pid][0]
            ]
            if span > 0
            else []
        )
        seen, seen_at = now, at
        return sorted(rows, reverse=True)[:8]
else:
    import ctypes
    lib = ctypes.CDLL("/usr/lib/libSystem.dylib")
    lib.mach_host_self.restype = ctypes.c_uint
    lib.host_processor_info.argtypes = [
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_int)),
        ctypes.POINTER(ctypes.c_uint),
    ]
    lib.host_processor_info.restype = ctypes.c_int
    lib.vm_deallocate.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_size_t]
    lib.vm_deallocate.restype = ctypes.c_int
    task = ctypes.c_uint.in_dll(lib, "mach_task_self_").value
    sysctl = lambda name: subprocess.run(["sysctl", "-n", name], capture_output=True, text=True).stdout.strip()
    model = sysctl("machdep.cpu.brand_string")
    p, e = sysctl("hw.perflevel0.logicalcpu"), sysctl("hw.perflevel1.logicalcpu")
    clusters = (int(e), int(p)) if p.isdigit() and e.isdigit() else None

    def ticks():
        n, info, size = ctypes.c_uint(), ctypes.POINTER(ctypes.c_int)(), ctypes.c_uint()
        if lib.host_processor_info(lib.mach_host_self(), 2, ctypes.byref(n), ctypes.byref(info), ctypes.byref(size)) != 0:
            return []
        u = [info[i] & 0xFFFFFFFF for i in range(n.value * 4)]
        lib.vm_deallocate(task, ctypes.cast(info, ctypes.c_void_p), size.value * 4)
        return [(u[4 * c] + u[4 * c + 3], u[4 * c + 1], u[4 * c + 2]) for c in range(n.value)]

    def diff(a, b):
        return [(y - x) % 2**32 for x, y in zip(a, b)]

    def busiest():
        out = subprocess.run(["ps", "-Ac", "-o", "pid=,pcpu=,comm=", "-r"], capture_output=True, text=True, env=dict(os.environ, LC_ALL="C")).stdout
        rows = []
        for line in out.splitlines()[:8]:
            pid, cpu, name = (line.split(None, 2) + ["", "", ""])[:3]
            if not pid.isdigit():
                continue
            try:
                pct_cpu = float(cpu.replace(",", "."))
            except ValueError:
                continue
            rows.append((pct_cpu, int(pid), name.replace("\n", " ").replace("\r", " ")))
        return rows

def pct(d):
    total = sum(d) or 1
    return [100 * v / total for v in d]

before = ticks()
if linux:
    busiest()
time.sleep(min(interval, 0.5))
k = 0
while True:
    now = ticks()
    if len(now) == len(before) and now:
        deltas = [diff(a, b) for a, b in zip(before, now)]
        per = [pct(d) for d in deltas]
        whole = pct([sum(d[i] for d in deltas) for i in range(3)])
        lines = ["cores %d" % len(now), "model " + model]
        if clusters:
            lines.append("clusters %d %d" % clusters)
        lines.append("load %.2f %.2f %.2f" % os.getloadavg())
        lines.append("cpu %.1f %.1f %.1f" % tuple(whole))
        lines.append("core " + " ".join("%.1f" % (c[0] + c[1]) for c in per))
        if k % every == 0:
            lines += ["proc %d %.1f %s" % (pid, cpu, name) for cpu, pid, name in busiest()]
        emit(lines)
        k += 1
    before = now
    time.sleep(interval)
PY
`;

const isReading = (state: State<Detail>): state is Detail =>
  state !== "connecting" && state !== "unreachable";

/** The three finite numbers a line holds, or null. */
function threeOf(text = ""): [number, number, number] | null {
  const [a, b, c, ...rest] = text.trim().split(/\s+/u).map(Number);
  if (a === undefined || b === undefined || c === undefined || rest.length > 0) return null;
  return Number.isFinite(a + b + c) ? [a, b, c] : null;
}

/** A reading from one block, keeping `before`'s processes on a block that carries none; null for a
 *  block that lacks the cores, the load or the CPU split. */
export function detailOf(block: string, before: State<Detail>, at = Date.now()): Detail | null {
  const fields = new Map<string, string>();
  const top: Detail["top"][number][] = [];
  for (const line of block.trim().split("\n")) {
    const proc = /^proc (\d+) (\S+) (.*)$/u.exec(line);
    if (proc === null) {
      const space = line.indexOf(" ");
      fields.set(space === -1 ? line : line.slice(0, space), space === -1 ? "" : line.slice(space + 1));
      continue;
    }
    const [, pid = "", cpu = "", name = ""] = proc;
    if (Number.isFinite(Number(cpu))) top.push({ pid: Number(pid), cpu: Number(cpu), name });
  }
  const cores = Number(fields.get("cores"));
  const loads = threeOf(fields.get("load"));
  const cpu = threeOf(fields.get("cpu"));
  if (!(cores > 0) || loads === null || cpu === null) return null;
  const [, efficiency, performance] = /^(\d+) (\d+)$/u.exec(fields.get("clusters") ?? "") ?? [];
  const coreText = (fields.get("core") ?? "").trim();
  return {
    cores,
    model: fields.get("model") ?? "",
    clusters:
      efficiency === undefined || performance === undefined
        ? null
        : { efficiency: Number(efficiency), performance: Number(performance) },
    loads,
    cpu: { user: cpu[0], system: cpu[1], idle: cpu[2] },
    perCore: coreText === "" ? [] : coreText.split(/\s+/u).map(Number).filter(Number.isFinite),
    top: top.length > 0 || !isReading(before) ? top : before.top,
    at,
  };
}

/** The line a program reads: every machine, this one marked `local`, with its reading or its state. */
export function lineOf(watched: readonly Watched<Detail>[], at = Date.now()): string {
  return JSON.stringify({
    at,
    hosts: watched.map(({ label, host, state }) => ({
      label,
      local: host === undefined,
      ...(isReading(state) ? { state: "read", ...state } : { state }),
    })),
  });
}

export async function stream(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: { type: "boolean", default: false }, once: { type: "boolean", default: false } },
  });
  const seconds = secondsOf(positionals, "1", "load");
  const watched = watchersOf(
    [undefined, ...hostsOf()],
    DETAIL.replaceAll("@I@", String(Math.max(seconds, 0.5))),
    detailOf,
  );
  const quit = endingOn(watched);
  if (values.once) {
    await firstReadings(watched, seconds * 1000, () => true);
    console.log(lineOf(watched));
    return;
  }
  // The reader went away: nothing is left to write for.
  runtimeProcess.stdout.on("error", quit);
  keepFollowing(watched, seconds * 1000);
  for (;;) {
    await Bun.sleep(seconds * 1000);
    runtimeProcess.stdout.write(`${lineOf(watched)}\n`);
  }
}

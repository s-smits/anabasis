/** One bounded health reading per machine, using the same live-run owner as placement. */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { existsSync, statfsSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree, worktrees } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { availableParallelism, loadavg } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { controllersOf } from "./code.ts";
import { asked, hosts } from "./hosts.ts";
import { liveHere, seatsIn } from "./live.ts";
import { ARCHIVE, processes, runs, writers } from "./registry.ts";

const MAYBE_NUMBER = Type.Union([Type.Number(), Type.Null()]);
const HEALTH = Type.Object({
  load: Type.Number(),
  cores: Type.Number(),
  performanceCores: MAYBE_NUMBER,
  charger: Type.String(),
  freeGiB: Type.Number(),
  freePct: Type.Number(),
  sizes: Type.Record(Type.String(), MAYBE_NUMBER),
  bun: Type.String(),
  commit: Type.String(),
  ready: Type.Boolean(),
  live: Type.Array(
    Type.Object({
      name: Type.String(),
      login: Type.Union([Type.String(), Type.Null()]),
      host: Type.String(),
    }),
  ),
  busiest: Type.Array(
    Type.Object({
      pid: Type.Number(),
      cpu: Type.Number(),
      command: Type.String(),
      run: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});
type Health = Static<typeof HEALTH>;

/** Probe optional OS facts without treating an absent macOS tool as a failed host. */
function probe(command: readonly string[]): string | null {
  try {
    const result = runSync([...command], { timeout: 20_000 });
    return result.exitCode === 0 ? decodeOutput(result.stdout).trim() : null;
  } catch {
    return null;
  }
}

function sizesHere(main: string, controllers: string): Record<string, number | null> {
  const areas = [
    { name: ".ana", paths: [join(main, ".ana")] },
    { name: "archive", paths: [join(main, ARCHIVE)] },
    { name: "controllers", paths: [controllers] },
    {
      name: "other worktrees",
      paths: worktrees(main).filter((tree) => tree !== main && !tree.startsWith(`${controllers}/`)),
    },
  ];
  // One `du` an area: on a machine of 198 worktrees (22 October) the worktrees alone took 39 s,
  // past the probe's 20 s, and one call for every area left every size unavailable.
  return Object.fromEntries(
    areas.map((area) => {
      const paths = area.paths.filter(existsSync);
      const output = paths.length === 0 ? "" : probe(["du", "-sk", ...paths]);
      return [
        area.name,
        output === null
          ? null
          : output.split("\n").reduce((sum, line) => sum + Number(/^(\d+)\s/.exec(line)?.[1] ?? 0), 0),
      ];
    }),
  );
}

/** Attribute hot descendants to their campaign writer rather than guessing from a run name. */
function busiestHere(): Health["busiest"] {
  const running = processes();
  const owners = new Map(
    runs().flatMap((run) => writers(run, running).map((writer) => [writer.pid, run.name] as const)),
  );
  const table = probe(["ps", "-axww", "-o", "pid=,ppid=,pcpu=,args="]);
  if (table === null) throw new Error("cannot inspect the busiest processes");
  const rows = table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            cpu: Number(match[3]),
            args: (match[4] ?? "").split(/\s+/),
          },
        ];
  });
  for (const row of rows) {
    const [seat] = seatsIn([row.args.join(" ")], "here");
    if (seat !== undefined) owners.set(row.pid, seat.name);
  }
  const parents = new Map(rows.map((row) => [row.pid, row.parent]));
  return rows
    .toSorted((a, b) => b.cpu - a.cpu)
    .slice(0, 3)
    .map((row) => {
      const seen = new Set<number>();
      let pid = row.pid;
      while (!owners.has(pid) && parents.has(pid) && !seen.has(pid)) {
        seen.add(pid);
        pid = parents.get(pid) ?? 0;
      }
      return {
        pid: row.pid,
        cpu: row.cpu,
        command: basename(row.args[0] ?? "?"),
        run: owners.get(pid) ?? null,
      };
    });
}

function healthHere(): Health {
  const main = mainTree(runtimeProcess.cwd());
  const controllers = controllersOf(main);
  const disk = statfsSync(main);
  const commit = gitText(runtimeProcess.cwd(), "rev-parse", "HEAD");
  const power = probe(["pmset", "-g", "ac"]);
  const performanceCores = probe(["sysctl", "-n", "hw.perflevel0.physicalcpu"]);
  return {
    load: loadavg()[0] ?? 0,
    cores: availableParallelism(),
    performanceCores:
      performanceCores !== null && /^\d+$/.test(performanceCores) ? Number(performanceCores) : null,
    // `pmset -g ac` also prints the adapter's serial number, which a pasted reading would carry.
    charger: power === null ? "not reported by this OS" : (/Wattage = \S+/.exec(power)?.[0] ?? "no charger"),
    freeGiB: (disk.bavail * disk.bsize) / 2 ** 30,
    freePct: (100 * disk.bavail) / Math.max(1, disk.blocks),
    sizes: sizesHere(main, controllers),
    bun: Bun.version,
    commit,
    ready:
      existsSync(join(runtimeProcess.cwd(), "node_modules")) &&
      (runtimeProcess.cwd() !== join(controllers, commit) ||
        existsSync(join(controllers, `${commit}.ready`))),
    live: liveHere(),
    busiest: busiestHere(),
  };
}

function healthLines(reading: Health): string[] {
  return [
    `${reading.load > reading.cores ? "⚠ " : ""}load ${reading.load.toFixed(1)}/${String(reading.cores)} cores; performance cores ${String(reading.performanceCores ?? "not reported")}`,
    `charger: ${reading.charger.replace(/\s+/g, " ")}`,
    `${reading.freePct < 10 ? "⚠ " : ""}disk ${reading.freeGiB.toFixed(1)} GiB free (${reading.freePct.toFixed(1)}%)`,
    `sizes: ${Object.entries(reading.sizes)
      .map(([name, size]) => `${name} ${size === null ? "unavailable" : `${(size / 1024).toFixed(1)} MiB`}`)
      .join("; ")}`,
    `Bun ${reading.bun}; controller ${reading.commit.slice(0, 9)} ${reading.ready ? "ready" : "not ready"}`,
    `live campaigns and seats: ${reading.live.map((run) => `${run.name}${run.login === null ? "" : ` (login ${run.login})`}`).join(", ") || "none"}`,
    ...reading.busiest.map(
      (row) =>
        `cpu ${row.cpu.toFixed(1)}% pid ${String(row.pid)} ${row.command}; run ${row.run ?? "unassigned"}`,
    ),
  ];
}

/** `hosts --health` includes this machine; --here is the single JSON response used by fan-out. */
export async function hostsHealth(args: readonly string[]): Promise<void> {
  if (!args.includes("--health")) return await hosts(args);
  const { values } = parseArgs({
    args: [...args],
    options: { health: { type: "boolean" }, here: { type: "boolean" } },
  });
  if (values.here === true) return console.log(capturedJsonStringify(healthHere()));
  const away = asked(["hosts", "--health", "--here"]);
  try {
    console.log(`── here\n${healthLines(healthHere()).join("\n")}`);
  } catch (error) {
    console.error(`here: health unavailable: ${errorMessage(error)}`);
    runtimeProcess.exitCode = 1;
  }
  for (const { host, lines, elapsedMs } of await away) {
    console.log(`── ${host.name} (${(elapsedMs / 1000).toFixed(1)} s)`);
    try {
      const reading = capturedJsonParse(lines?.join("\n") ?? "null");
      if (!Value.Check(HEALTH, reading)) throw new Error("no valid health answer");
      console.log(healthLines(reading).join("\n"));
    } catch (error) {
      console.error(`${host.name}: health unavailable: ${errorMessage(error)}`);
      runtimeProcess.exitCode = 1;
    }
  }
}

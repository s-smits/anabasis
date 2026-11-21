/**
 * `bun run runs netwatch [<seconds>] [--once]`: the traffic between the machines, live in the
 * terminal beside `loadwatch`, refreshed every `<seconds>` (2 by default). Each machine `ANA_HOSTS`
 * lists, this one included, reports the bytes it has sent to and received from each Tailscale peer
 * (`tailscale status --json`), and the watch reads the rate of each link from two reports in a row,
 * whether it is direct or relayed, and the bytes moved since the watch began. The last line is the
 * whole network: the sum over links, each counted once, as the larger of its two ends' readings, with
 * the peak since the watch began. `--once` prints one frame after two reports from every machine.
 *
 * Traffic that does not cross Tailscale (a Thunderbolt link, the LAN by address) is not counted.
 * Each machine runs one sampling loop for the whole watch (`follow`, `load.ts`). Its Tailscale CLI is
 * the first on the login path, Homebrew's or the macOS app's that answers, and where `tailscaled`
 * runs in userspace with a socket of its own, that socket.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { hostsOf } from "./host-config.ts";
import { keepFollowing, watchersOf, type Watched } from "./load.ts";
import { bar, BOLD, DIM, liveScreen, RED, RESET } from "./loadwatch.ts";
import { Misused } from "./registry.ts";

interface Peer {
  readonly name: string;
  readonly rx: number;
  readonly tx: number;
  /** The direct address, or the relay's region where there is none. */
  readonly path: string;
}
interface Report {
  readonly at: number;
  readonly peers: readonly Peer[];
}
interface Link {
  readonly name: string;
  readonly path: string;
  /** Bytes a second received and sent over the last two reports. */
  readonly down: number;
  readonly up: number;
  /** Bytes both ways since the watch began. */
  readonly moved: number;
}

// Each report is one line of `tailscale status --json`, then "---". @I@ is the interval in seconds.
const LOOP = String.raw`
sock=$(ps axww -o args= | awk '$1 ~ /tailscaled$/' | sed -n 's/.*--socket=\(.*\.sock\).*/\1/p' | head -n 1)
cli=""
for c in tailscale /opt/homebrew/bin/tailscale /usr/bin/tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  command -v "$c" >/dev/null 2>&1 || continue
  if [ -n "$sock" ] && "$c" --socket="$sock" status --json >/dev/null 2>&1; then cli=$c; break; fi
  if "$c" status --json >/dev/null 2>&1; then cli=$c; sock=""; break; fi
done
[ -n "$cli" ] || exit 1
while :; do
  if [ -n "$sock" ]; then "$cli" --socket="$sock" status --json; else "$cli" status --json; fi | tr -d '\n'
  printf '\n---\n'
  sleep @I@
done
`;

const PEER = Type.Object({
  HostName: Type.String(),
  RxBytes: Type.Number(),
  TxBytes: Type.Number(),
  CurAddr: Type.Optional(Type.String()),
  Relay: Type.Optional(Type.String()),
});
const STATUS = Type.Object({ Peer: Type.Optional(Type.Record(Type.String(), Type.Unknown())) });
const UNITS = ["B/s", "kB/s", "MB/s", "GB/s"] as const;

/** One report from a status block, or null for a block that is not one; a peer of another shape is
 *  left out rather than read as idle. */
export function reportOf(block: string): Report | null {
  let status: unknown;
  try {
    status = capturedJsonParse(block.trim());
  } catch {
    return null;
  }
  if (!Value.Check(STATUS, status)) return null;
  const peers = Object.values(status.Peer ?? {}).flatMap((peer) =>
    Value.Check(PEER, peer)
      ? [
          {
            name: peer.HostName,
            rx: peer.RxBytes,
            tx: peer.TxBytes,
            path: (peer.CurAddr ?? "") === "" ? `relay ${peer.Relay ?? "?"}` : `direct ${peer.CurAddr ?? ""}`,
          },
        ]
      : [],
  );
  return { at: Date.now(), peers };
}

/** Each machine's links from its newest report against the one before and its first, kept per
 *  machine so a refresh between reports keeps the last reading. */
class Rates {
  readonly #first = new Map<string, Report>();
  readonly #last = new Map<string, Report>();
  readonly #links = new Map<string, Link[]>();
  peak = 0;
  readonly since = new Date().toTimeString().slice(0, 8);

  linksOf({ label, state }: Watched<Report>): Link[] | null {
    if (state === "connecting" || state === "unreachable") return null;
    const before = this.#last.get(label);
    if (before !== state) {
      this.#last.set(label, state);
      if (!this.#first.has(label)) this.#first.set(label, state);
      if (before !== undefined) this.#links.set(label, linksBetween(before, state, this.#first.get(label)));
    }
    return this.#links.get(label) ?? null;
  }
}

/** The links of `now` against the report `before` it and the `first` of the watch. */
export function linksBetween(before: Report, now: Report, first: Report | undefined): Link[] {
  const seconds = Math.max(0.001, (now.at - before.at) / 1000);
  // A counter that went back (a peer reconnected) reads as no traffic, never as negative.
  const gain = (a: number, b: number | undefined) => Math.max(0, a - (b ?? a));
  return now.peers.flatMap((peer) => {
    const prior = before.peers.find((each) => each.name === peer.name);
    const start = first?.peers.find((each) => each.name === peer.name);
    if (peer.rx + peer.tx === 0) return [];
    return [
      {
        name: peer.name,
        path: peer.path,
        down: gain(peer.rx, prior?.rx) / seconds,
        up: gain(peer.tx, prior?.tx) / seconds,
        moved: gain(peer.rx, start?.rx) + gain(peer.tx, start?.tx),
      },
    ];
  });
}

function rate(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit] ?? ""}`;
}
const size = (bytes: number): string => rate(bytes).replace("/s", "");

/** Each link once, by its two ends, at the larger of their readings. */
export function network(read: readonly (readonly [string, readonly Link[]])[]): {
  now: number;
  moved: number;
} {
  const links = new Map<string, { now: number; moved: number }>();
  for (const [self, own] of read) {
    for (const link of own) {
      const key = [self, link.name].toSorted().join(" ");
      const seen = links.get(key) ?? { now: 0, moved: 0 };
      links.set(key, {
        now: Math.max(seen.now, link.down + link.up),
        moved: Math.max(seen.moved, link.moved),
      });
    }
  }
  return [...links.values()].reduce(
    (sum, each) => ({ now: sum.now + each.now, moved: sum.moved + each.moved }),
    {
      now: 0,
      moved: 0,
    },
  );
}

function frame(watched: readonly Watched<Report>[], rates: Rates, seconds: string): string[] {
  const now = new Date().toTimeString().slice(0, 8);
  const read = watched.map((each) => [each, rates.linksOf(each)] as const);
  const busiest = Math.max(
    1e6,
    ...read.flatMap(([, links]) => (links ?? []).map((link) => link.down + link.up)),
  );
  const blocks = read.flatMap(([{ label, state }, links]) => {
    const head = `${BOLD}${label.padEnd(20)}${RESET}`;
    if (links === null) {
      const said = state === "unreachable" ? `${RED}UNREACHABLE${RESET}` : `${DIM}connecting…${RESET}`;
      return ["", `${head} ${said}`];
    }
    const down = links.reduce((sum, link) => sum + link.down, 0);
    const up = links.reduce((sum, link) => sum + link.up, 0);
    return [
      "",
      `${head} ↓ ${rate(down).padStart(9)}  ↑ ${rate(up).padStart(9)}`,
      ...links.map(
        (link) =>
          `  ${link.name.padEnd(14)} ${bar(link.down + link.up, busiest)}  ↓ ${rate(link.down).padStart(9)}  ↑ ${rate(link.up).padStart(9)}  ${DIM}${size(link.moved).padStart(7)} moved; ${link.path}${RESET}`,
      ),
      ...(links.length === 0 ? [`  ${DIM}no traffic with any peer${RESET}`] : []),
    ];
  });
  const total = network(
    read.flatMap(([{ label }, links]) => (links === null ? [] : [[label, links] as const])),
  );
  rates.peak = Math.max(rates.peak, total.now);
  return [
    `${BOLD}ana net watch${RESET}  ${DIM}${now}  (refresh ${seconds}s, ctrl-c quits)${RESET}`,
    ...blocks,
    "",
    `${BOLD}${"intranet".padEnd(20)}${RESET} ${bar(total.now, Math.max(rates.peak, 1e6))}  ${rate(total.now)} now, peak ${rate(rates.peak)}; ${size(total.moved)} moved since ${rates.since}`,
    "",
    `${DIM}↓ received, ↑ sent by the machine named above, over Tailscale; link bars against the busiest link now (at least 1 MB/s), the intranet's against its peak; the intranet counts each link once, at the larger of its two ends${RESET}`,
  ];
}

export async function netwatch(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { once: { type: "boolean", default: false } },
  });
  const [given = "2", extra] = positionals;
  const seconds = Number(given);
  if (extra !== undefined || !Number.isFinite(seconds) || seconds <= 0) throw new Misused();
  const script = LOOP.replaceAll("@I@", String(Math.max(seconds, 0.5)));
  const watched = watchersOf<Report>([undefined, ...hostsOf()], script);
  keepFollowing(watched, reportOf, seconds * 1000);
  const rates = new Rates();
  if (!values.once) return await liveScreen(watched, () => frame(watched, rates, given));
  // Two reports from each machine, or its silence, before the one frame.
  const deadline = Date.now() + 2000 * seconds + 30_000;
  while (
    Date.now() < deadline &&
    watched.some((each) => each.state !== "unreachable" && rates.linksOf(each) === null)
  ) {
    await Bun.sleep(100);
  }
  console.log(frame(watched, rates, given).join("\n"));
  for (const { child } of watched) if (child !== null) killProcessGroup(child, "SIGKILL");
  // The sampling loops would open each connection again.
  runtimeProcess.exit(0);
}

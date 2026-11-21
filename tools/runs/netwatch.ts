/**
 * `bun run runs netwatch [<seconds>] [--once | -s|--short]`: the traffic between the machines, live
 * beside `loadwatch` and through the same driver (`watch.ts`), refreshed every `<seconds>` (2 by
 * default). Each machine reports the bytes it has sent to and received from each Tailscale peer
 * (`tailscale status --json`), and each reading holds every link's rate from that report against the
 * one before, whether it is direct or relayed, and the bytes moved since the watch reached the
 * machine. The intranet is every link counted once, at the larger of its two ends' readings, with
 * its peak since the watch began. `--once` prints one frame once every machine has two reports, and
 * `-s` one line: the intranet's rate and each link's, busiest first.
 *
 * Traffic that does not cross Tailscale (a Thunderbolt link, the LAN by address) is not counted.
 * Each machine's Tailscale CLI is the first that answers of the one on its path, Homebrew's,
 * `/usr/bin`'s and the macOS app's, and where `tailscaled` runs in userspace with a socket of its
 * own, that socket.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import type { State, Watched } from "./load.ts";
import { bar, DIM, headOf, RESET, waitingOf, watch } from "./watch.ts";

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

/** A machine's newest report, its first, and its links against the report before, none yet after
 *  its first. */
interface Reading {
  readonly report: Report;
  readonly first: Report;
  readonly links: readonly Link[] | null;
}
interface Pair {
  readonly ends: string;
  readonly now: number;
  readonly moved: number;
}

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

/** The next reading of a machine from a status block and the reading before it. */
function readingOf(block: string, before: State<Reading>): Reading | null {
  const report = reportOf(block);
  if (report === null) return null;
  if (before === "connecting" || before === "unreachable") return { report, first: report, links: null };
  return { report, first: before.first, links: linksBetween(before.report, report, before.first) };
}

/** Each machine's links where it has them. */
const linksOf = (watched: readonly Watched<Reading>[]): (readonly [string, readonly Link[]])[] =>
  watched.flatMap(({ label, state }) =>
    state === "connecting" || state === "unreachable" || state.links === null
      ? []
      : [[label, state.links] as const],
  );

/** Each link once, by its two ends, at the larger of their readings, busiest first. */
export function pairsOf(read: readonly (readonly [string, readonly Link[]])[]): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const [self, own] of read) {
    for (const link of own) {
      const ends = [self, link.name].toSorted().join("↔");
      const seen = pairs.get(ends);
      pairs.set(ends, {
        ends,
        now: Math.max(seen?.now ?? 0, link.down + link.up),
        moved: Math.max(seen?.moved ?? 0, link.moved),
      });
    }
  }
  return [...pairs.values()].toSorted((a, b) => b.now - a.now);
}

const sum = (pairs: readonly Pair[], key: "now" | "moved"): number =>
  pairs.reduce((total, pair) => total + pair[key], 0);

/** Each machine's link at most, in bytes a second, from `ANA_NET_MAX` (`<name>:<MB/s>,...`), measured
 *  by hand; a link's most is the slower of its two ends', and the intranet's the fastest machine's. */
const MOST = new Map(
  (runtimeProcess.env.ANA_NET_MAX ?? "").split(",").flatMap((entry) => {
    const [name = "", most = ""] = entry.trim().split(":");
    return Number(most) > 0 ? [[name, Number(most) * 1e6] as const] : [];
  }),
);

/** The frame below the title, and the intranet's peak since the watch began. */
function framer(): (watched: readonly Watched<Reading>[]) => string[] {
  let peak = 0;
  const since = new Date().toTimeString().slice(0, 8);
  return (watched) => {
    const read = linksOf(watched);
    const busiest = Math.max(1e6, ...read.flatMap(([, links]) => links.map((link) => link.down + link.up)));
    const mostOf = (a: string, b: string) => Math.min(MOST.get(a) ?? busiest, MOST.get(b) ?? busiest);
    const blocks = watched.flatMap(({ label, state }) => {
      // A machine with one report so far has no rate yet, so it is still connecting.
      if (state === "connecting" || state === "unreachable" || state.links === null) {
        return ["", waitingOf(label, state === "unreachable" ? state : "connecting")];
      }
      const { links } = state;
      const down = links.reduce((total, link) => total + link.down, 0);
      const up = links.reduce((total, link) => total + link.up, 0);
      return [
        "",
        `${headOf(label)} ↓ ${rate(down).padStart(9)}  ↑ ${rate(up).padStart(9)}`,
        ...links.map(
          (link) =>
            `  ${link.name.padEnd(14)} ${bar(link.down + link.up, mostOf(label, link.name))}  ↓ ${rate(link.down).padStart(9)}  ↑ ${rate(link.up).padStart(9)}  ${DIM}${size(link.moved).padStart(7)} moved; ${link.path}${RESET}`,
        ),
        ...(links.length === 0 ? [`  ${DIM}no traffic with any peer${RESET}`] : []),
      ];
    });
    const pairs = pairsOf(read);
    const now = sum(pairs, "now");
    peak = Math.max(peak, now);
    const most = Math.max(0, ...MOST.values());
    return [
      ...blocks,
      "",
      `${headOf("intranet")} ${bar(now, most || Math.max(peak, 1e6))}  ${rate(now)} now, peak ${rate(peak)}${most > 0 ? ` of ${rate(most)}` : ""}; ${size(sum(pairs, "moved"))} moved since ${since}`,
      "",
      `${DIM}↓ received, ↑ sent by the machine named above, over Tailscale; bars against each link's most in ANA_NET_MAX, else the busiest link now (at least 1 MB/s) and the intranet's peak; the intranet counts each link once, at the larger of its two ends${RESET}`,
    ];
  };
}

/** `-s`: the intranet's rate, then each link's, busiest first, and a machine that did not answer last. */
function short(watched: readonly Watched<Reading>[]): string {
  const pairs = pairsOf(linksOf(watched));
  const lost = watched.flatMap(({ label, state }) =>
    state === "unreachable" ? [`${label} unreachable`] : [],
  );
  return [
    `intranet ${rate(sum(pairs, "now"))}:`,
    ...pairs.map((pair) => `${pair.ends} ${rate(pair.now)}`),
    ...lost,
  ].join("  ");
}

export const netwatch = (args: readonly string[]): Promise<void> =>
  watch(args, {
    name: "net",
    seconds: "2",
    script: (seconds) => LOOP.replaceAll("@I@", String(Math.max(seconds, 0.5))),
    parse: readingOf,
    ready: (reading) => reading.links !== null,
    frame: framer(),
    once: () => [],
    short,
    windows: [],
  });

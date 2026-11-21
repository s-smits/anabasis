// The net watch reads each link's rate from two Tailscale reports in a row, and the intranet total
// counts a link seen from both ends once.
import { expect, test } from "bun:test";
import { linksBetween, network, reportOf } from "../tools/runs/netwatch.ts";

const status = (rx: number, tx: number) =>
  JSON.stringify({
    Self: { HostName: "a" },
    Peer: {
      k1: { HostName: "b", RxBytes: rx, TxBytes: tx, CurAddr: "10.0.0.2:41641", Relay: "ams" },
      k2: { HostName: "idle", RxBytes: 0, TxBytes: 0, CurAddr: "", Relay: "ams" },
      k3: { HostName: "odd", RxBytes: "many" },
    },
  });

test("a link's rate comes from the bytes between two reports, and a counter that went back reads as none", () => {
  const first = reportOf(status(1000, 500));
  const before = reportOf(status(2000, 1000));
  const now = reportOf(status(6000, 3000));
  if (first === null || before === null || now === null) throw new Error("no report");
  expect(now.peers.map((peer) => peer.name)).toEqual(["b", "idle"]);
  const [link, ...rest] = linksBetween({ ...before, at: 0 }, { ...now, at: 2000 }, first);
  expect(rest).toEqual([]);
  expect(link).toEqual({ name: "b", path: "direct 10.0.0.2:41641", down: 2000, up: 1000, moved: 7500 });
  const reset = reportOf(status(10, 10));
  if (reset === null) throw new Error("no report");
  expect(linksBetween({ ...now, at: 0 }, { ...reset, at: 1000 }, first)[0]).toMatchObject({ down: 0, up: 0 });
  expect(reportOf("not json")).toBeNull();
});

test("the intranet counts each link once, at the larger of its two ends' readings", () => {
  const link = (name: string, down: number, up: number, moved: number) => ({
    name,
    path: "",
    down,
    up,
    moved,
  });
  expect(
    network([
      ["a", [link("b", 100, 50, 1000), link("c", 10, 0, 10)]],
      ["b", [link("a", 40, 90, 900)]],
    ]),
  ).toEqual({ now: 160, moved: 1010 });
});

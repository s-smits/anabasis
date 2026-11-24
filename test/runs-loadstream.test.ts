// `loadwatch --json` reads each machine's detailed block, keeps the last processes on a block without
// them, and writes every machine on one line, this one marked local.
import { expect, test } from "bun:test";
import type { Host } from "../tools/runs/host-config.ts";
import type { Watched } from "../tools/runs/load.ts";
import { type Detail, detailOf, lineOf } from "../tools/runs/loadstream.ts";

const block = [
  "cores 4",
  "model Apple M1",
  "clusters 2 2",
  "load 1.50 2.25 3.00",
  "cpu 30.0 10.0 60.0",
  "core 80.0 40.0 0.0 40.0",
  "proc 42 99.5 Brave Browser Helper",
  "proc 7 3.0 bun",
].join("\n");

test("a block reads as its cores, load, split, cores' shares and processes, names with spaces whole", () => {
  expect(detailOf(block, "connecting", 1000)).toEqual({
    cores: 4,
    model: "Apple M1",
    clusters: { efficiency: 2, performance: 2 },
    loads: [1.5, 2.25, 3],
    cpu: { user: 30, system: 10, idle: 60 },
    perCore: [80, 40, 0, 40],
    top: [
      { pid: 42, cpu: 99.5, name: "Brave Browser Helper" },
      { pid: 7, cpu: 3, name: "bun" },
    ],
    at: 1000,
  });
});

test("a block without processes keeps the reading before's, and one without the split is none", () => {
  const before = detailOf(block, "connecting", 1000);
  if (before === null) throw new Error("no reading");
  const plain = block.split("\n").filter((line) => !line.startsWith("proc") && !line.startsWith("clusters"));
  const next = detailOf(plain.join("\n"), before, 2000);
  expect(next?.top).toEqual(before.top);
  expect(next?.clusters).toBeNull();
  expect(detailOf(plain.join("\n"), "unreachable", 2000)?.top).toEqual([]);
  expect(detailOf(plain.filter((line) => !line.startsWith("core ")).join("\n"), before)?.perCore).toEqual([]);
  expect(detailOf(plain.filter((line) => !line.startsWith("cpu")).join("\n"), before)).toBeNull();
  expect(detailOf("cores 0\nload 1 1 1\ncpu 0 0 100", before)).toBeNull();
});

test("the line holds every machine, this one local, a reading spread and a lost one by its state", () => {
  const reading = detailOf(block, "connecting", 1000);
  if (reading === null) throw new Error("no reading");
  const watcher = (
    label: string,
    host: Host | undefined,
    state: Watched<Detail>["state"],
  ): Watched<Detail> => ({
    label,
    host,
    argv: [],
    parse: detailOf,
    state,
    child: null,
  });
  const far: Host = { name: "far", ssh: "far", tree: "~/anabasis", bun: "bun" };
  const line: unknown = JSON.parse(
    lineOf([watcher("here", undefined, reading), watcher("far", far, "unreachable")], 5000),
  );
  expect(line).toEqual({
    at: 5000,
    hosts: [
      { label: "here", local: true, state: "read", ...reading },
      { label: "far", local: false, state: "unreachable" },
    ],
  });
});

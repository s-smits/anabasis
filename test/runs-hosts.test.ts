// Where a verb of `bun run runs` runs: here, or on the host that holds the run it names.
import { describe, expect, it } from "bun:test";
import { type Host, routesOf } from "../tools/runs/hosts.ts";

const host = (name: string): Host => ({ name, ssh: `me@${name}`, tree: "~/anabasis", bun: "bun" });
const runner = host("runner");
const other = host("other");

describe("a verb's routes", () => {
  it("sends a verb that names a run another host holds to that host, whole", () => {
    const held = new Map([["r3", runner]]);
    expect(routesOf("continue", ["r3", "--login", "3", "--yes"], held)).toEqual({
      here: null,
      away: [[runner, ["continue", "r3", "--login", "3", "--yes"]]],
    });
    expect(routesOf("view", ["r3"], held).away).toEqual([[runner, ["view", "r3"]]]);
  });

  it("keeps here a run nobody claims, so the verb refuses it in its own words", () => {
    expect(routesOf("keep", ["gone", "--yes"], new Map())).toEqual({ here: ["gone", "--yes"], away: [] });
  });

  it("keeps here a verb that names no run, whatever a host holds", () => {
    const held = new Map([["r3", runner]]);
    expect(routesOf("status", ["r3"], held)).toEqual({ here: ["r3"], away: [] });
    expect(routesOf("launch", ["r3", "--yes"], held)).toEqual({ here: ["r3", "--yes"], away: [] });
  });

  it("splits a stop over the machines that hold its runs, each with the flags", () => {
    const held = new Map([
      ["a", runner],
      ["b", other],
      ["c", runner],
    ]);
    expect(routesOf("stop", ["here1", "a", "b", "c", "--yes"], held)).toEqual({
      here: ["here1", "--yes"],
      away: [
        [runner, ["stop", "a", "c", "--yes"]],
        [other, ["stop", "b", "--yes"]],
      ],
    });
    expect(routesOf("stop", ["a", "--yes"], held).here).toBeNull();
  });
});

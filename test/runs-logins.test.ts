// What `runs active` prints: each login's live runs across machines, the runs that name no login,
// and the hosts that went uncounted.
import { describe, expect, it } from "bun:test";
import { liveOf, seatsIn } from "../tools/runs/hosts.ts";
import { activeLines, capOf } from "../tools/runs/logins.ts";

const live = [
  { name: "a", login: "2", host: "here" },
  { name: "b", login: "2", host: "m1" },
  { name: "c", login: "5", host: "here" },
  { name: "d", login: null, host: "linux" },
];

describe("each login's live runs", () => {
  it("counts a login's runs across machines, and names a login a run may take with none", () => {
    const lines = activeLines(live, ["2", "3"], []);
    expect(lines[0]).toContain("login 2");
    expect(lines[0]).toContain("2 live: a (here), b (m1)");
    expect(lines[1]).toContain("login 3");
    expect(lines[1]).toContain("none live");
  });

  it("keeps a login no run may take, and a run with no login, on lines of their own", () => {
    const lines = activeLines(live, ["2", "3"], []);
    expect(lines[2]).toContain("login 5");
    expect(lines[2]).toContain("1 live: c (here)");
    expect(lines[3]).toContain("no login");
    expect(lines[3]).toContain("1 live: d (linux)");
    expect(lines).toHaveLength(4);
  });

  it("says which hosts went uncounted", () => {
    expect(activeLines([], ["2"], ["linux"]).at(-1)).toContain("linux");
    expect(activeLines([], ["2"], [])).toHaveLength(1);
  });

  it("leaves a host uncounted whose answer is no list, as a tree before the verb answers", () => {
    expect(liveOf("m1", [])).toBeNull();
    expect(liveOf("m1", null)).toBeNull();
    expect(liveOf("m1", ["usage: bun run runs pulse|zip ..."])).toBeNull();
    expect(liveOf("m1", ["[]"])).toEqual([]);
    expect(liveOf("m1", ['[{"name":"a","login":"2","host":"here"}]'])).toEqual([
      { name: "a", login: "2", host: "m1" },
    ]);
  });
});

describe("capOf", () => {
  it("reads a login's own most before the one for every login", () => {
    const env = { ANA_LOGIN_RUNS: "2, 1:4" };
    expect(capOf(env, "1")).toBe("4");
    expect(capOf(env, "3")).toBe("2");
    expect(capOf({ ANA_LOGIN_RUNS: "1:4" }, "3")).toBeNull();
    expect(capOf({}, "2")).toBeNull();
  });
});

describe("seatsIn", () => {
  it("reads a seat's seed and login from its own flags, once a seed", () => {
    const seat =
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree /t --name sim-a --login 3 -- tools/d1b/examine.ts --login 9";
    const table = [
      seat,
      `zsh -c ${seat}`,
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat x",
      "bun tools/d1b/examine.ts --name sim-b",
    ];
    expect(seatsIn(table, "here")).toEqual([{ name: "sim-a", login: "3", host: "here" }]);
    expect(seatsIn([seat.replace(" --login 3", "")], "here")).toEqual([
      { name: "sim-a", login: null, host: "here" },
    ]);
  });
});

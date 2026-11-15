// What `runs active` prints: each login's live runs across machines, the runs that name no login,
// and the hosts that went uncounted.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { gatheredOn, liveOf, payerOf, seatsCodex, seatsIn } from "../tools/runs/live.ts";
import type { Run } from "../tools/runs/registry.ts";
import { activeLines, capOf, fitOf, perRunHour, perRunRate, startRefusal } from "../tools/runs/logins.ts";

describe("each login's live runs", () => {
  it("leaves a host uncounted whose answer is no list, as a tree before the verb answers", () => {
    for (const lines of [[], null, ["usage: bun run runs pulse|zip ..."]]) {
      expect(liveOf("m1", lines)).toBeNull();
    }
    expect(liveOf("m1", ["[]"])).toEqual([]);
    expect(liveOf("m1", ['[{"name":"a","login":"2","host":"here"}]'])).toEqual([
      { name: "a", login: "2", host: "m1" },
    ]);
    // A record without its login, or a list that is not one of records, leaves the host uncounted.
    for (const said of ['[{"name":"a"}]', '[{"name":"a","login":2}]', '["a"]']) {
      expect(liveOf("m1", [said])).toBeNull();
    }
    expect(
      liveOf("m1", [
        '[{"name":"a","login":null,"unwritten":true},{"name":"b","login":null,"unwritten":false}]',
      ]),
    ).toEqual([
      { name: "a", login: null, host: "m1", unwritten: true },
      { name: "b", login: null, host: "m1" },
    ]);
  });
});

describe("each payer's cap", () => {
  it("prints each login's live runs out of its most, and the Codex login's most a machine", () => {
    const live = [
      { name: "a", login: "2", host: "here" },
      { name: "g", login: "codex", host: "m1" },
    ];
    const env = { ANA_LOGIN_RUNS: "2,1:4" };
    expect(activeLines(live, ["1", "2"], { unasked: [] }, env)).toEqual([
      "login 1   0/4 live",
      "login 2   1/2 live: a (here)",
      "codex     1 live, at most 1 a machine: g (m1)",
    ]);
    expect(capOf(env, "codex")).toBe("1");
    expect(capOf({ ANA_LOGIN_RUNS: "codex:2" }, "codex")).toBe("2");
    expect(capOf({}, "2")).toBeNull();
  });

  it("takes a login's most from its subscription, below its own entry and above the bare number", () => {
    const env = { ANA_LOGIN_SUBS: "1:ultra,2:max,3:ultra,4:pro200,codex:pro200", ANA_LOGIN_RUNS: "5,3:3" };
    expect(["1", "2", "3", "4", "5", "codex"].map((login) => capOf(env, login))).toEqual([
      "2",
      "1",
      "3",
      "5",
      "5",
      "4",
    ]);
    expect(capOf({ ANA_LOGIN_SUBS: "codex:ultra" }, "codex")).toBe("1");
    expect(activeLines([], ["1"], { unasked: [] }, env)).toEqual([
      "login 1   0/2 live (ultra)",
      "codex     0 live, at most 4 a machine (pro200)",
    ]);
  });

  it("names the Codex login the payer of a launch that seats an openai-codex model, and of no other", () => {
    expect(seatsCodex(["--solver", "openai-codex/gpt-6.1-sol", "--budget", "800"])).toBe(true);
    expect(seatsCodex(["--solver", "claude/claude-opus-5-5"])).toBe(false);
  });

  it("refuses a continue or a move over a login's cap or a machine's Codex run, counting every run but its own", () => {
    const env = { ANA_LOGIN_RUNS: "2" };
    const live = [
      { name: "a", login: "2", host: "here" },
      { name: "b", login: "2", host: "m1" },
      { name: "g", login: "codex", host: "m1" },
    ];
    const counted = { live, unasked: [] };
    const gpt = ["--solver", "openai-codex/gpt-6.1-sol"];
    expect(startRefusal(env, payerOf("2", []), "here", counted, "c")).toContain(
      "login 2 is at its live-run cap",
    );
    expect(startRefusal(env, payerOf("2", []), "here", counted, "a")).toBeNull();
    expect(startRefusal(env, payerOf(undefined, gpt), "m1", counted, "h")).toContain(
      "m1 carries 1 live codex run(s)",
    );
    expect(startRefusal(env, payerOf(undefined, gpt), "here", counted, "h")).toBeNull();
    expect(startRefusal(env, payerOf(undefined, gpt), "m1", counted, "g")).toBeNull();
    expect(
      startRefusal(env, payerOf(undefined, ["--solver", "openrouter/x"]), "m1", counted, "h"),
    ).toBeNull();
    expect(startRefusal(env, "3", "here", { live, unasked: ["linux"] }, "c")).toContain(
      "not counted on linux",
    );
  });

  it("starts the first kept runs by name where more wait on a login than its cap, and none over its writers", () => {
    const env = { ANA_LOGIN_RUNS: "2" };
    const kept = ["a", "b", "c"].map((name) => ({
      name,
      login: "2",
      host: "here",
      unwritten: true as const,
    }));
    const counted = { live: kept, unasked: [] };
    const refused = kept.map(({ name }) => startRefusal(env, "2", "here", counted, name));
    expect(refused.slice(0, 2)).toEqual([null, null]);
    expect(refused[2]).toContain("login 2 is at its live-run cap");
    // A run nothing kept takes no kept run's slot, and a kept run first by name none of a writer's.
    expect(startRefusal(env, "2", "here", { live: kept.slice(1), unasked: [] }, "a")).toContain(
      "login 2 is at its live-run cap",
    );
    const writing = ["x", "y"].map((name) => ({ name, login: "2", host: "m1" }));
    expect(startRefusal(env, "2", "here", { live: [...kept, ...writing], unasked: [] }, "a")).toContain(
      "login 2 is at its live-run cap",
    );
  });
});

describe("a host that does not answer", () => {
  it("is counted as the archive last gathered it, so a start on a login it carried nothing on goes ahead", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-gathered-"));
    try {
      const copy = (name: string, from: string, observation: JsonObject, login: string): Run => {
        mkdirSync(join(dir, from, name), { recursive: true });
        writeFileSync(join(dir, from, name, "log.jsonl"), "");
        writeFileSync(join(dir, from, name, "observation.json"), JSON.stringify(observation));
        const receipt = { at: "2026-11-13T00:00:00.000Z", pid: 1, flags: [], envFile: null, login };
        writeFileSync(join(dir, from, name, "launch-run-1.json"), JSON.stringify(receipt));
        const path = join(dir, from, name, "log.jsonl");
        return { name, tree: dir, path, end: "comparison.reported", archived: from };
      };
      const copies = [
        copy("open", "peer", { open: true, stderr: null }, "2"),
        copy("waiting", "peer", { open: false, kept: true, stderr: null }, "2"),
        copy("closed", "peer", { open: false, stderr: null }, "4"),
        copy("elsewhere", "other", { open: true, stderr: null }, "4"),
      ];
      const gathered = gatheredOn("peer", copies);
      expect(gathered).toEqual([
        { name: "open", login: "2", host: "peer" },
        { name: "waiting", login: "2", host: "peer", unwritten: true },
      ]);
      expect(gatheredOn("never-gathered", copies)).toBeNull();
      const env = { ANA_LOGIN_RUNS: "2,4:1" };
      const counted = { live: gathered ?? [], unasked: ["peer"], gathered: ["peer"] };
      expect(startRefusal(env, "4", "here", counted, "moved")).toBeNull();
      // The copies still hold a login to its cap, and a host with no copies still refuses.
      expect(startRefusal(env, "2", "here", counted, "moved")).toContain("login 2 is at its live-run cap");
      expect(startRefusal(env, "4", "here", { ...counted, unasked: ["peer", "linux"] }, "moved")).toBe(
        "not counted on linux: no answer to `active`",
      );
      expect(activeLines([], [], counted).at(-1)).toEqual(
        "counted on peer as the archive last gathered it: no answer to `active`",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    ].map((row) => ({ args: row.split(" ") }));
    expect(seatsIn(table, "here")).toEqual([{ name: "sim-a", login: "3", host: "here" }]);
    expect(seatsIn([{ args: seat.replace(" --login 3", "").split(" ") }], "here")).toEqual([
      { name: "sim-a", login: null, host: "here" },
    ]);
  });
});

describe("how many runs a login's week carries", () => {
  const HOUR = 3_600_000;
  const reading = (hour: number, pct: number, runs?: number) => ({
    at: hour * HOUR,
    weeks: { "2": { pct, reset: 100 * HOUR } },
    ...keyIfDefined("runs", runs === undefined ? undefined : { "2": runs }),
  });

  it("measures a run's hourly share only across enough counted run-hours in one week", () => {
    const reset = { at: 2 * HOUR, weeks: { "2": { pct: 0, reset: 268 * HOUR } }, runs: { "2": 2 } };
    for (const [history, expected] of [
      [[reading(0, 10, 2), reading(1, 12, 2), reading(2, 14, 2), reading(3, 16, 2)], 1],
      [[reading(0, 10), reading(1, 12), reading(2, 14), reading(3, 16)], null],
      [[reading(0, 10, 2), reading(1, 12, 2)], null],
      [[reading(0, 10, 2), reading(1, 12, 2), reset], null],
      // A fall under one reset is a window opened afresh, as a plan's upgrade does, not an hour of none.
      [[reading(0, 90, 2), reading(1, 92, 2), reading(2, 0, 2), reading(3, 2, 2), reading(4, 4, 2)], 1],
      // An uncounted reading between counted ones does not split and drop the span across it.
      [[reading(0, 10, 2), reading(1, 12, 2), reading(1.1, 12), reading(2, 14, 2), reading(3, 16, 2)], 1],
    ] as const) {
      expect(perRunRate(history)).toBe(expected);
    }
  });

  it("fits as many runs as the week left carries for a run's 12 hours, or to a sooner reset, active 16 of 24 hours", () => {
    const now = 0;
    const active = perRunHour({ login: "2", pct: 0, reset: 0 }, 1, 1, now);
    // 8% left carries one run of 12 hours at 2/3% an hour, however far off the reset is.
    expect(fitOf({ login: "3", pct: 92, reset: 42 * HOUR }, active, now)).toBe(1);
    expect(fitOf({ login: "1", pct: 84, reset: 83 * HOUR }, active, now)).toBe(2);
    expect(fitOf({ login: "3", pct: 95, reset: 42 * HOUR }, active, now)).toBe(0);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, active, now)).toBe(11);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, null, now)).toBeNull();
  });

  it("reads a week's own pace over its live runs until a rate is measured", () => {
    // 70% in the first 4 days: shared over two runs, a run of 12 hours needs about 4.4% of the 30% left.
    const week = { login: "2", pct: 70, reset: 72 * HOUR };
    const now = 0;
    expect(fitOf(week, perRunHour(week, 2, null, now), now)).toBe(6);
    expect(perRunHour(week, 0, null, now)).toBeNull();
    expect(perRunHour(week, 2, 1, now)).toBeCloseTo(16 / 24);
  });
});

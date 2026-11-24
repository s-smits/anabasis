// What the run tools decide from pure state: each login's live runs counted on every host against
// its cap, the pack a run's name reads as, and the machines a kept harness's programs run on. The
// router's choice of check host, and a move refused for a foreign harness, are held end to end in
// `router.test.ts` and `runs-move.test.ts`.
import { describe, expect, it } from "bun:test";
import { foreignHead, placeOf, UNAME_PLACES } from "#src/harness/place.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { liveOf, payerOf, seatsIn } from "../tools/runs/live.ts";
import { allowedLogins, asGathered, capOf, startRefusal } from "../tools/runs/logins.ts";
import type { Host } from "../tools/runs/host-config.ts";
import { leastOccupied } from "../tools/runs/placement.ts";
import { packOf, type Run, runNamed } from "../tools/runs/registry.ts";
import { decidedOn, planOn } from "../tools/runs/view.ts";

describe("each login's live runs, on every host", () => {
  it("leaves a host uncounted whose answer is no list of records with logins", () => {
    for (const lines of [[], null, ["usage: bun run runs pulse|zip ..."]]) {
      expect(liveOf("m1", lines)).toBeNull();
    }
    for (const said of ['[{"name":"a"}]', '[{"name":"a","login":2}]', '["a"]']) {
      expect(liveOf("m1", [said])).toBeNull();
    }
    expect(liveOf("m1", ["[]"])).toEqual([]);
    expect(
      liveOf("m1", ['[{"name":"a","login":"2","host":"here"},{"name":"b","login":null,"unwritten":true}]']),
    ).toEqual([
      { name: "a", login: "2", host: "m1" },
      { name: "b", login: null, host: "m1", unwritten: true },
    ]);
  });

  it("counts a simulation seat by its own flags, once a seat", () => {
    const seat =
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree /t --name sim-a --login 3 -- tools/d1b/examine.ts --login 9";
    const table = [
      seat,
      `zsh -c ${seat}`,
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat x",
      "bun tools/d1b/examine.ts --name sim-b",
    ].map((row) => ({ args: row.split(" ") }));
    expect(seatsIn(table, "here")).toEqual([{ name: "sim-a", login: "3", host: "here" }]);
  });

  it("takes a login's cap from its subscription, below its own entry and above the bare number", () => {
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
  });

  it("refuses a start over a login's cap or a machine's Codex run, counting every run but its own", () => {
    const env = { ANA_LOGIN_RUNS: "2" };
    const live = [
      { name: "a", login: "2", host: "here" },
      { name: "b", login: "2", host: "m1" },
      { name: "g", login: "codex", host: "m1" },
    ];
    const counted = { live, unasked: [] };
    const gpt = payerOf(undefined, ["--solver", "openai-codex/gpt-6.1-sol"]);
    const rows: [string | undefined, string, string, string | null][] = [
      [payerOf("2", []), "here", "c", "login 2 is at its live-run cap"],
      [payerOf("2", []), "here", "a", null],
      [gpt, "m1", "h", "m1 carries 1 live codex run(s)"],
      [gpt, "here", "h", null],
      [gpt, "m1", "g", null],
      [payerOf(undefined, ["--solver", "openrouter/x"]), "m1", "h", null],
      [payerOf(undefined, ["--model=openai-codex/z", "--prompt", "openai-codex/z"]), "m1", "h", null],
      [payerOf(undefined, ["--examiner=openai-codex/z"]), "m1", "h", "m1 carries 1 live codex run(s)"],
    ];
    for (const [payer, host, name, refusal] of rows) {
      const said = startRefusal(env, payer, host, counted, name);
      if (refusal === null) expect(said).toBeNull();
      else expect(said).toContain(refusal);
    }
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
    const writing = ["x", "y"].map((name) => ({ name, login: "2", host: "m1" }));
    const cap = "login 2 is at its live-run cap";
    const rows: [typeof kept | (typeof writing)[number][], string, string | null][] = [
      [kept, "a", null],
      [kept, "b", null],
      [kept, "c", cap],
      // A run nothing kept takes no kept run's slot, and a kept run first by name none of a writer's.
      [kept.slice(1), "a", cap],
      [[...kept, ...writing], "a", cap],
    ];
    for (const [live, name, refusal] of rows) {
      const said = startRefusal(env, "2", "here", { live, unasked: [] }, name);
      if (refusal === null) expect([name, said]).toEqual([name, null]);
      else expect(said).toContain(refusal);
    }
  });

  it("counts a host that does not answer as the archive last gathered it, and refuses one never gathered", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-gathered-"));
    try {
      const copy = (name: string, from: string, observation: JsonObject, login: string) => {
        mkdirSync(join(dir, from, name), { recursive: true });
        writeFileSync(join(dir, from, name, "log.jsonl"), "");
        writeFileSync(join(dir, from, name, "observation.json"), JSON.stringify(observation));
        const receipt = { at: "2026-11-13T00:00:00.000Z", pid: 1, flags: [], envFile: null, login };
        writeFileSync(join(dir, from, name, "launch-run-1.json"), JSON.stringify(receipt));
        const path = join(dir, from, name, "log.jsonl");
        return { name, tree: dir, path, end: "comparison.reported" as const, archived: from };
      };
      const copies = [
        copy("open", "peer", { open: true, stderr: null }, "2"),
        copy("waiting", "peer", { open: false, kept: true, stderr: null }, "2"),
        copy("closed", "peer", { open: false, stderr: null }, "4"),
        copy("elsewhere", "other", { open: true, stderr: null }, "4"),
      ];
      const env = { ANA_LOGIN_RUNS: "2,4:1" };
      const counted = asGathered({ live: [], unasked: ["peer"] }, copies);
      expect(counted).toEqual({
        live: [
          { name: "open", login: "2", host: "peer" },
          { name: "waiting", login: "2", host: "peer", unwritten: true },
        ],
        unasked: [],
      });
      expect(startRefusal(env, "4", "here", counted, "moved")).toBeNull();
      expect(startRefusal(env, "2", "here", counted, "moved")).toContain("login 2 is at its live-run cap");
      const blind = asGathered({ live: [], unasked: ["peer", "linux"] }, copies);
      expect(startRefusal(env, "4", "here", blind, "moved")).toBe(
        "not counted on linux: no answer to `active`",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the machine a fresh campaign is placed on", () => {
  const host = (name: string): Host => ({ name, ssh: name, tree: "~/t", bun: "~/b" });
  const [a, b, c] = [host("a"), host("b"), host("c")];
  type Row = Parameters<typeof leastOccupied>[0][number];

  it("takes the login's least used machine, then the least load a core, halved with no run, and never a full one", () => {
    const loads: Row[] = [
      { host: a, live: 1, capacity: 2, load: 0.5, familiar: true },
      { host: b, live: 0, capacity: 2, load: 0.9 },
      { host: c, live: 1, capacity: 2, load: 0.6 },
    ];
    const rows: [string, Row[], Host][] = [
      // b's 0.9 counts as 0.45 with no run there, below a's 0.5 and the familiar pack there.
      ["halved", loads, b],
      ["b carries a run", loads.map((row) => (row.host === b ? { ...row, live: 1 } : row)), a],
      ["b is full", loads.map((row) => (row.host === b ? { ...row, capacity: 0 } : row)), a],
      [
        "the login runs on a",
        [
          { host: a, live: 1, capacity: 2, load: 0.1, sameLogin: 1 },
          { host: b, live: 1, capacity: 2, load: 0.9, sameLogin: 0 },
        ],
        b,
      ],
      [
        "a load did not come",
        [
          // Read as idle, b's missing load would beat a's 0.9; unread, a's familiar pack decides.
          { host: a, live: 1, capacity: 2, load: 0.9, familiar: true },
          { host: b, live: 1, capacity: 2 },
        ],
        a,
      ],
    ];
    for (const [why, given, chosen] of rows) expect([why, leastOccupied(given)]).toEqual([why, chosen]);
    expect(() => leastOccupied([{ host: a, live: 2, capacity: 2, load: 0 }])).toThrow("no host has room");
  });
});

describe("a run's name", () => {
  const campaign = (name: string, tree: string): Run => ({
    name,
    tree,
    path: join(tree, ".ana", "d2", name, "log.jsonl"),
    end: "comparison.reported",
  });

  it("names one campaign, whole, and refuses none or two", () => {
    const round = campaign("r1", "/wt");
    const listed = [
      round,
      // A live solve of the same name is no campaign, and a campaign of the name in another
      // worktree is a second one, since two campaigns can run under one name.
      { ...round, path: "/wt/.ana/live/r1.jsonl", end: "solve.finished" as const },
      campaign("r2", "/wt"),
      campaign("r2", "/other"),
    ];
    expect(runNamed("r1", listed)).toBe(round);
    expect(() => runNamed("r", listed)).toThrow("no campaign log is named r in");
    expect(() => runNamed("r2", listed)).toThrow("r2 names a campaign in /wt and in /other");
  });

  it("reads its pack whole before the first `-fresh-`, and a name without one by its first word", () => {
    const rows: [string, string][] = [
      ["jobstat-anabasis-v5-fresh-opus-host", "jobstat-anabasis-v5"],
      ["jobstat-fresh-opus-host", "jobstat"],
      ["kernel-cyber2-fresh-opus-re-fresh-x-host", "kernel-cyber2"],
      ["buffer-control-r2", "buffer"],
      ["seating", "seating"],
    ];
    for (const [name, pack] of rows) expect(packOf(name)).toBe(pack);
  });
});

describe("the machines a kept harness's programs run on", () => {
  const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
  const elf = (machine: number) => {
    const head = Buffer.alloc(20);
    head.writeUInt32BE(0x7f_45_4c_46, 0);
    head.writeUInt16LE(machine, 18);
    return head;
  };
  const SCRIPT = Buffer.from("#!/Users/me/venv/bin/python3\n");

  it("reads every system and processor a move asks of, and passes each program on its own", () => {
    const places = [...new Set(UNAME_PLACES.values())].toSorted();
    expect(places).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    const rows: [string, Buffer, string | null][] = [
      ["darwin-arm64", MACH_O, null],
      ["linux-x64", MACH_O, "a Mach-O binary"],
      ["linux-arm64", MACH_O, "a Mach-O binary"],
      ["linux-x64", elf(62), null],
      ["linux-arm64", elf(62), "an ELF binary for machine 62"],
      ["linux-arm64", elf(183), null],
      ["darwin-arm64", elf(183), "an ELF binary for machine 183"],
      // Outside a container a script's interpreter is the machine's own concern.
      ["linux-x64", SCRIPT, null],
    ];
    for (const [place, head, why] of rows) {
      expect([place, foreignHead(head, placeOf(place))]).toEqual([place, why]);
    }
    expect(() => placeOf("windows-x64")).toThrow("names no machine");
  });

  it("treats explicit empty ANA_LOGINS as an empty pool rather than widening to every login in env", () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN2: "tok-2", CLAUDE_CODE_OAUTH_TOKEN3: "tok-3" };
    expect(allowedLogins(env)).toEqual(["2", "3"]);
    expect(allowedLogins({ ...env, ANA_LOGINS: "" })).toEqual([]);
    expect(allowedLogins({ ...env, ANA_LOGINS: "  " })).toEqual([]);
    expect(allowedLogins({ ...env, ANA_LOGINS: "3" })).toEqual(["3"]);
  });

  it("reads a prompt-opened campaign with a frozen exam and zero tasks as examine, not prepare", () => {
    const at = "2026-11-22T00:00:00.000Z";
    const events = [
      { at, kind: "campaign.opened", data: { prompt: "statistical diagnostics", attended: false } },
      { at, kind: "exam.drafted", data: { session: "d-1", draft: { tasks: [] } } },
      { at, kind: "checker.read", data: { contract: "c1", checks: "k1", faults: [] } },
      { at, kind: "contract.frozen", data: { contract: "c1", checks: "k1" } },
    ] as const;
    expect(planOn(events).unprepared).toBe(false);
    expect(decidedOn(events).move).toBe("examine");
    // A stored-pack opening (no prompt) still reports unprepared before tasks are proposed.
    const packEvents = events.slice(1);
    expect(planOn(packEvents).unprepared).toBe(true);
    expect(decidedOn(packEvents).move).toBe("prepare");
  });
});

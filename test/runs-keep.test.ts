// Keeping a campaign going: the turn a keeper takes, and the login it moves the run to.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { seats } from "../tools/runs/fresh.ts";
import { keeperOf, nextLogin, roomFor, type Turn, turnOf } from "../tools/runs/keep.ts";
import { stateOf } from "../tools/runs/state.ts";
import { billsLogin, fiveHourWith, type Reading } from "../tools/runs/logins.ts";
import { WAIT_HOURS } from "../tools/runs/manage.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const HOUR = 3_600_000;
const OPUS = "claude/claude-opus-5-5";
const fixtures: string[] = [];

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-15T12:00:00.000Z",
  kind,
  data,
});
const waited = (hours: number, reason = "provider") =>
  event("campaign.waited", { for: reason, until: new Date(NOW + hours * HOUR).toISOString() });

describe("the turn a keeper takes", () => {
  it("moves only a live provider wait past its bound and continues only interrupted runs", () => {
    const turn = (events: readonly LogEvent[], writing: boolean, launched = 0) =>
      turnOf(stateOf(events, { writing, kept: false }, NOW, launched), NOW, HOUR);
    for (const [events, status, expected] of [
      [[waited(2)], "open", "move"],
      [[waited(1)], "open", "watch"],
      [[waited(5, "load")], "open", "watch"],
      [[waited(5), event("build.started", { session: "b-1" })], "open", "watch"],
      // A seat that ran on after the wait writes its call and its failed turn; the wait stands.
      [
        [waited(2), event("exam.call", { session: "x-1" }), event("exam.turn", { stopReason: "error" })],
        "open",
        "move",
      ],
      [[waited(2), event("exam.turn", { session: "x-1", stopReason: "toolUse" })], "open", "watch"],
      [[], "open", "watch"],
      [[event("build.started", { session: "b-1" })], "closed", "continue"],
      [[event("campaign.ended", { ending: "environment" })], "closed", "continue"],
    ] as const) {
      expect(turn(events, status === "open")).toBe(expected);
    }
    for (const ending of ["budget", "stop", "operator", "finished", "no-room"]) {
      expect(turn([event("campaign.ended", { ending })], false)).toBe("done");
    }
    // A wait the launch before this one recorded is not this launch's to move: the keeper that just
    // moved the run would move it again while its new process makes its first calls.
    expect(turn([waited(2), event("exam.call", { session: "x-1" })], true, 1)).toBe("watch");
  });

  it("leaves a run that ended on its own terms whatever other keeper lives, and keeps one a login limit cut", () => {
    const kept = (events: readonly LogEvent[]) => stateOf(events, { writing: false, kept: true }, NOW);
    for (const ending of ["budget", "stop", "operator", "finished", "no-room", "exam"]) {
      const state = kept([event("campaign.ended", { ending })]);
      expect(state).toEqual({ kind: "ended", ending });
      expect(turnOf(state, NOW, HOUR)).toBe("done");
    }
    // A login's limit is waited out, so its process dies on the wait or ends on its environment.
    for (const events of [[waited(2)], [waited(2), event("campaign.ended", { ending: "environment" })]]) {
      expect(kept(events).kind).toBe("kept");
      expect(turnOf(kept(events), NOW, HOUR)).toBe("continue");
    }
  });
});

const read = (login: string, week: number, five = 10, status = "allowed", reset = 1): Reading => ({
  login,
  plain: false,
  via: "ratelimit-headers",
  fiveHour: { pct: five, resetsAt: new Date(NOW + 4 * HOUR).toISOString(), status },
  sevenDay: { pct: week, resetsAt: new Date(NOW + reset * HOUR).toISOString(), status },
  notes: [],
});

describe("the login a run moves to", () => {
  it("leaves a login at its live-run cap across the fleet, and waits while a host goes uncounted", async () => {
    const live = [1, 2].map((n) => ({ name: `run-${n}`, login: "2", host: n === 1 ? "here" : "m1" }));
    const readAll = (wanted: readonly string[]) =>
      Promise.resolve(
        [read("2", 10, 10, "allowed", 1), read("3", 50, 10, "allowed", 40)].filter((reading) =>
          wanted.includes(reading.login),
        ),
      );
    const env = { ANA_LOGIN_RUNS: "2" };
    const on = { env, now: NOW };
    const logins = async (counted: { live: typeof live; unasked: string[] }) =>
      (await roomFor(["2", "3"], new Set(), counted, readAll, on)).logins;
    expect(await logins({ live, unasked: [] })).toEqual(["3"]);
    expect(await logins({ live: live.slice(1), unasked: [] })).toEqual(["2", "3"]);
    expect(await logins({ live: [], unasked: ["m1"] })).toEqual([]);
  });
});

it("reads a login's five hours with a run added: a live login's pace shared over its runs, an idle one by its window", () => {
  const five = (pct: number | null, hoursLeft: number | null): Reading => ({
    ...read("2", 10),
    fiveHour: { pct, resetsAt: hoursLeft === null ? null : new Date(NOW + hoursLeft * HOUR).toISOString() },
  });
  // 20% in the first hour, 4 left: the two runs add 80 more, so a third adds 40 on top.
  const rows: [Reading, number, number | null][] = [
    [five(20, 4), 2, 140],
    [five(10, 4), 2, 70],
    [five(0, null), 0, 75],
    [five(0, 5), 0, 75],
    [five(60, 1), 0, 75],
    [five(60, 4), 0, 120],
    [{ login: "2", plain: false, error: "unauthorized" }, 0, null],
    [five(null, 4), 0, null],
    [five(30, null), 1, null],
  ];
  for (const [reading, runs, expected] of rows) {
    const said = fiveHourWith(reading, runs, NOW);
    if (expected === null) expect(said).toBeNull();
    else expect(said).toBeCloseTo(expected);
  }
  // A window about to reset leaves nothing to spend.
  expect(fiveHourWith(five(90, 0.01), 3, NOW)).toBeLessThan(100);
});

describe("a keeper's looks, scripted", () => {
  const MINUTE = 60_000;
  const WAIT_MS = Number(WAIT_HOURS) * HOUR;

  /** A keeper of a run on login 2 over logins 2 to 4, over a log and readings a test sets. */
  function scripted(flags: readonly string[] = [`--builder=${OPUS}`], login: string | undefined = "2") {
    const none: string[] = [];
    const nobody: { name: string; login: string; host: string }[] = [];
    const log: LogEvent[] = [waited(40)];
    const state = {
      events: log,
      open: true,
      otherKeeper: false,
      readings: [read("3", 10), read("4", 10, 10, "allowed", 2)],
      pool: ["2", "3", "4"],
      live: nobody,
      unasked: none,
      asked: 0,
      refusal: "",
      acted: [...none],
      said: [...none],
    };
    const look = keeperOf("sample", async () => state.pool, WAIT_MS, {
      events: () => state.events,
      stands: (events, now) => stateOf(events, { writing: state.open, kept: state.otherKeeper }, now),
      last: () => ({ login, flags }),
      fleet: () => Promise.resolve({ live: state.live, unasked: state.unasked }),
      read: (wanted) => {
        state.asked += wanted.length > 0 ? 1 : 0;
        return Promise.resolve(state.readings.filter((one) => wanted.includes(one.login)));
      },
      checkStart: () => (state.refusal === "" ? Promise.resolve() : Promise.reject(new Error(state.refusal))),
      stop: () => {
        state.acted.push("stop");
        return Promise.resolve();
      },
      start: (to) => {
        state.acted.push(`start ${to ?? "none"}`);
        return Promise.resolve(true);
      },
      say: (line) => state.said.push(line),
      env: { ANA_LOGIN_RUNS: "2" },
    });
    return { state, look };
  }

  it("keeps the writer alive when the restart is refused and retries once it can start", async () => {
    const { state, look } = scripted();
    state.refusal = "the run's commit is on no remote branch or tag";
    expect(await look(NOW)).toBe(false);
    expect(state.acted).toEqual([]);
    expect(state.said[0]).toContain(state.refusal);
    state.refusal = "";
    expect(await look(NOW + MINUTE)).toBe(false);
    expect(state.acted).toEqual([]);
    expect(await look(NOW + 10 * MINUTE)).toBe(false);
    expect(state.acted).toEqual(["stop", "start 3"]);
  });

  it("does not take the login it moved off again until its limit resets, and then may", async () => {
    const { state, look } = scripted();
    state.readings = [read("2", 10), read("3", 100)];
    state.events = [waited(2)];
    await look(NOW);
    expect(state.acted).toEqual([]);
    state.events = [];
    state.open = false;
    await look(NOW + 3 * HOUR);
    expect(state.acted).toEqual(["start 2"]);
  });

  it("goes on with a kept run on its own login where it is first by name of more kept runs than the cap", async () => {
    const kept = (name: string) => ({ name, login: "2", host: "here", unwritten: true as const });
    const acted = async (live: { name: string; login: string; host: string; unwritten?: true }[]) => {
      const { state, look } = scripted();
      state.open = false;
      state.otherKeeper = true;
      state.pool = ["2"];
      state.live = live;
      await look(NOW);
      return state.acted;
    };
    expect(await acted(["sample", "t", "u"].map(kept))).toEqual(["start 2"]);
    expect(await acted(["r", "s", "sample"].map(kept))).toEqual([]);
    expect(
      await acted([kept("sample"), ...["t", "u"].map((name) => ({ name, login: "2", host: "m1" }))]),
    ).toEqual([]);
  });

  it("stops nothing while every login is at its cap, unread, or a host goes uncounted", async () => {
    const full = scripted();
    full.state.live = ["3", "4"].flatMap((login) =>
      [1, 2].map((n) => ({ name: `on-${login}-${n}`, login, host: "here" })),
    );
    await full.look(NOW);
    expect(full.state.acted).toEqual([]);
    expect(full.state.asked).toBe(0);
    expect(full.state.said[0]).toContain("no login to go on with");

    const unread = scripted();
    unread.state.readings = [
      { login: "3", plain: false, error: "unauthorized" },
      { ...read("4", 10), fiveHour: { pct: null, resetsAt: null } },
    ];
    await unread.look(NOW);
    expect(unread.state.acted).toEqual([]);
    expect(unread.state.said[0]).toContain("login 3, 4 could not be read");

    const uncounted = scripted();
    uncounted.state.unasked = ["peer"];
    await uncounted.look(NOW);
    expect(uncounted.state.acted).toEqual([]);
    expect(uncounted.state.asked).toBe(0);
  });

  it("rotates off a login permanently after a non-retryable provider ending, while retrying transient ones", async () => {
    for (const otherKeeper of [true, false]) {
      const dead = scripted();
      dead.state.open = false;
      dead.state.otherKeeper = otherKeeper;
      dead.state.events = [
        event("campaign.ended", {
          ending: "environment",
          why: "3 sessions in a row crashed (disabled Claude subscription access)",
        }),
      ];
      await dead.look(NOW);
      expect(dead.state.acted).toEqual(["start 3"]);
      // Even a week later, the permanently dead login is not taken again.
      dead.state.acted = [];
      dead.state.pool = ["2"];
      await dead.look(NOW + 168 * HOUR);
      expect(dead.state.acted).toEqual([]);
    }
    const transient = scripted();
    transient.state.open = false;
    transient.state.otherKeeper = true;
    transient.state.events = [
      event("campaign.ended", {
        ending: "environment",
        why: "3 sessions in a row crashed (fetch failed)",
      }),
    ];
    await transient.look(NOW);
    expect(transient.state.acted).toEqual(["start 2"]);
  });
});

describe("going on with a live run after a pause", () => {
  /** `continue --after next` of a live campaign whose comparisons began at 0.02, on `level`. The
   *  campaign command here takes its dry run's refusal from the real opening (`opened`), and its
   *  live run, once it reads the pause word, finishes a solve. Each case takes 60 s: under a whole
   *  suite, the word, the run's end and `continue`'s polls outlast 20 s. */
  async function goOnLive(level: string) {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "sample");
    mkdirSync(folder, { recursive: true });
    mkdirSync(join(made.main, "tools", "d2"), { recursive: true });
    writeFileSync(join(made.main, "package.json"), '{ "name": "fixture" }\n');
    const log = join(folder, "log.jsonl");
    const terms = join(import.meta.dir, "..", "tools", "d2", "campaign-terms.ts");
    writeFileSync(
      join(made.main, "tools", "d2", "harness-builder.ts"),
      `import { appendFileSync, readFileSync } from "node:fs";
import { flagsOf, opened } from ${JSON.stringify(terms)};
const log = ${JSON.stringify(log)};
if (process.argv.includes("--dry-run")) opened(log, flagsOf(process.argv.slice(2)), "scripted");
else {
  // It finishes a solve only once paused by a word, however long a loaded host takes to write one.
  while (!readFileSync(log, "utf8").includes("campaign.word")) await Bun.sleep(100);
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), kind: "solve.finished", data: { solve: "s-1" } }) + "\\n");
  await Bun.sleep(3000);
}
`,
    );
    writeFileSync(
      log,
      `${JSON.stringify(event("comparison.started", { comparison: "c-1", level: 0.02 }))}\n`,
    );
    const live = capturedSpawn([capturedExecPath, "tools/d2/harness-builder.ts", "--name", "sample"], {
      cwd: made.main,
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    // The fixture's `ps` lists the live run while it lives, and not once it is a zombie, as
    // `writers` reads it.
    const row = `${String(live.pid)} ${capturedExecPath} tools/d2/harness-builder.ts --name sample`;
    writeFileSync(
      join(made.root, "bin", "ps"),
      `#!${capturedExecPath}
const stat = Bun.spawnSync(["/bin/ps", "-o", "stat=", "-p", "${String(live.pid)}"]).stdout.toString().trim();
if (stat !== "" && !stat.startsWith("Z")) console.log(${JSON.stringify(row)});
`,
    );
    const before = readFileSync(log, "utf8");
    const flags = ["--project", "p", "--prompt", "a domain", "--solver", OPUS, "--level", level];
    const words = JSON.stringify(["sample", "--after", "next", "--yes", "--", ...flags]);
    const result = made.run(
      `import { continueRun } from "REPOSITORY/tools/runs/manage.ts"; await continueRun(${words});`,
      { FAKE_CWDS: `p${String(live.pid)}\nn${made.main}` },
    );
    const alive = await Promise.race([live.exited.then(() => false), Bun.sleep(1000).then(() => true)]);
    live.kill();
    return { result, before, after: readFileSync(log, "utf8"), alive };
  }

  it("refuses the campaign command's own refusal before it pauses the run, and leaves the log as it was", async () => {
    const { result, before, after, alive } = await goOnLive("0.05");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--level 0.05: the campaign's comparisons began at level 0.02");
    expect(after).toBe(before);
    expect(alive).toBe(true);
  }, 60_000);

  it("pauses the run and goes on with it where the dry run passes", async () => {
    const { result, before, after, alive } = await goOnLive("0.02");
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("running");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('"kind":"campaign.word"');
    expect(alive).toBe(false);
  }, 60_000);
});

describe("the login a run goes on with", () => {
  const claude = ["--builder", OPUS, "--solver", OPUS];
  const codex = ["--builder", "openai-codex/gpt-6.1-sol", "--solver", "openai-codex/gpt-6.1-sol"];
  it("keeps a Claude run on its own available login or takes room, and gives GPT none", async () => {
    const cases: [
      Turn,
      string | undefined,
      readonly string[],
      { spent?: string[]; roomy?: string[]; full?: string[] },
      string | null | undefined,
    ][] = [
      ["continue", "2", claude, {}, "2"],
      ["continue", "2", claude, { spent: ["2"] }, null],
      ["move", "2", claude, { spent: ["2"], roomy: ["1"] }, "1"],
      ["continue", undefined, claude, {}, null],
      ["continue", "2", claude, { full: ["2"], roomy: ["3"] }, "3"],
      ["continue", "2", claude, { full: ["2"] }, null],
      ["continue", "2", claude, { full: ["3"], roomy: ["3"] }, "2"],
      ["continue", undefined, codex, {}, undefined],
      ["continue", "2", codex, { spent: ["2"] }, undefined],
      ["move", "2", codex, { roomy: ["1"] }, null],
    ];
    for (const [turn, current, flags, { spent = [], roomy = [], full = [] }, expected] of cases) {
      expect(
        await nextLogin(
          turn,
          { current, spent: new Set(spent), billed: billsLogin([], flags) },
          async () => roomy,
          async (login) => full.includes(login),
        ),
      ).toBe(expected);
    }
  });

  it("bills a login for a Claude seat its flags name, by a space or a sign, or its record names", () => {
    const codexOpening = event("campaign.opened", {
      seats: { builder: { model: "openai-codex/gpt-6.1-sol", effort: "high" } },
    });
    const claudeOpening = event("campaign.opened", {
      seats: { builder: { model: OPUS, effort: "high" } },
    });
    const claudeSolver = event("campaign.setting", {
      solver: { model: OPUS, effort: "high" },
      minutes: 30,
      modelTurns: 20,
      target: 24,
    });
    expect(billsLogin([], [...codex, "--budget", "800"])).toBe(false);
    expect(billsLogin([codexOpening], [`--builder=${OPUS}`])).toBe(true);
    expect(billsLogin([claudeOpening], ["--budget", "800"])).toBe(true);
    expect(billsLogin([codexOpening], ["--budget", "800"])).toBe(false);
    expect(billsLogin([codexOpening, claudeSolver], [])).toBe(true);
  });

  it("bills only the effective seats after the campaign's overrides", () => {
    const preset = seats(OPUS, "hhhh");
    const overrides = seats("openai-codex/gpt-6.1-sol", "hhhh");
    expect(billsLogin([], [...preset, ...overrides])).toBe(false);
    expect(billsLogin([], [...overrides, "--prompt", "claude/a domain"])).toBe(false);
    const opening = event("campaign.opened", {
      seats: Object.fromEntries(
        ["builder", "examiner", "reviewer"].map((name) => [name, { model: OPUS, effort: "high" }]),
      ),
      solver: { model: OPUS, effort: "high" },
    });
    expect(billsLogin([opening], overrides)).toBe(false);
  });
});

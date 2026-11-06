// Keeping a campaign going: the turn a keeper takes, and the login it moves the run to.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { seats } from "../tools/runs/fresh.ts";
import { keeperOf, nextLogin, roomFor, type Turn, turnOf, turnsIn } from "../tools/runs/keep.ts";
import { billsLogin, fiveHourWith, type Reading, room } from "../tools/runs/logins.ts";
import { keepsItself, WAIT_HOURS } from "../tools/runs/manage.ts";
import { type Receipt, writeReceipt } from "../tools/runs/receipt.ts";
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
      expect(turnOf(events, status, NOW, HOUR)).toBe(expected);
    }
    for (const ending of ["budget", "stop", "operator", "finished", "no-room"]) {
      expect(turnOf([event("campaign.ended", { ending })], "closed", NOW, HOUR)).toBe("done");
    }
  });

  it("counts as work an answered model turn of any seat, and none of what a going-on into a failure writes", () => {
    const worked = [
      event("build.turn", { session: "b-1", stopReason: "toolUse" }),
      event("solve.turn", { solve: "s-1", stopReason: "toolUse" }),
    ];
    // A going-on into a network failure, as esp32-fresh-opus-m1-air-r2 wrote it 15 times.
    const failed = [
      event("campaign.move", { move: "build", code: "led" }),
      event("build.started", { session: "b-2" }),
      event("exam.started", { session: "x-2" }),
      event("build.turn", { session: "b-2", turn: 1, stopReason: "error" }),
      event("exam.turn", { session: "x-2", turn: 1, stopReason: "error" }),
      event("exam.finished", { session: "x-2", ended: "crashed" }),
      event("build.finished", { session: "b-2", ended: "crashed" }),
      event("campaign.ended", { ending: "environment" }),
    ];
    expect(turnsIn(worked)).toBe(2);
    expect(turnsIn([...worked, ...failed, ...failed])).toBe(2);
    expect(turnsIn([...worked, event("exam.turn", { session: "x-1", stopReason: "stop" })])).toBe(3);
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
  it("takes the allowed logins with room, the week that resets soonest first", () => {
    const readings = [
      read("2", 40, 10, "allowed", 30),
      read("3", 95, 10, "allowed_warning", 5),
      read("4", 10),
    ];
    expect(room(readings, ["2", "3", "4"], new Set())).toEqual(["4", "3", "2"]);
    expect(room(readings, ["2", "3"], new Set())).toEqual(["3", "2"]);
    expect(room(readings, ["2", "3", "4"], new Set(["4"]))).toEqual(["3", "2"]);
  });

  it("leaves a login whose week is spent, whose five hours are, that is refused, or that could not be read", () => {
    const readings: Reading[] = [
      read("1", 100),
      read("2", 20, 100),
      read("3", 20, 10, "rejected"),
      { login: "4", plain: false, error: "unauthorized" },
    ];
    expect(room(readings, ["1", "2", "3", "4"], new Set())).toEqual([]);
  });

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

describe("the five hours a login is read to last with a run added", () => {
  const five = (pct: number | null, hoursLeft: number | null): Reading => ({
    ...read("2", 10),
    fiveHour: {
      pct,
      resetsAt: hoursLeft === null ? null : new Date(NOW + hoursLeft * HOUR).toISOString(),
    },
  });

  it("shares a live login's pace over its runs and adds one more", () => {
    // 20% in the first hour, 4 left: the two runs add 80 more, so a third adds 40 on top.
    expect(fiveHourWith(five(20, 4), 2, NOW)).toBeCloseTo(140);
    expect(fiveHourWith(five(10, 4), 2, NOW)).toBeCloseTo(70);
    // A window about to reset leaves nothing to spend.
    expect(fiveHourWith(five(90, 0.01), 3, NOW)).toBeLessThan(100);
  });

  it("prices an idle login by what is left of its window, whatever runs that have left spent", () => {
    expect(fiveHourWith(five(0, null), 0, NOW)).toBe(75);
    expect(fiveHourWith(five(0, 5), 0, NOW)).toBe(75);
    expect(fiveHourWith(five(60, 1), 0, NOW)).toBe(75);
    expect(fiveHourWith(five(60, 4), 0, NOW)).toBe(120);
  });

  it("says nothing of a login with no reading, no share, or a share with no reset", () => {
    expect(fiveHourWith({ login: "2", plain: false, error: "unauthorized" }, 0, NOW)).toBeNull();
    expect(fiveHourWith(five(null, 4), 0, NOW)).toBeNull();
    expect(fiveHourWith(five(30, null), 1, NOW)).toBeNull();
  });

  it("leaves a login predicted over or unread, names which, and keeps the rest soonest week first", async () => {
    const readings: Reading[] = [
      { ...read("2", 10, 60, "allowed", 1) },
      read("3", 10, 10, "allowed", 50),
      read("4", 10, 10, "allowed", 2),
      { login: "5", plain: false, error: "unauthorized" },
    ];
    const reader = (wanted: readonly string[]) =>
      Promise.resolve(readings.filter(({ login }) => wanted.includes(login)));
    const found = await roomFor(["2", "3", "4", "5"], new Set(), { live: [], unasked: [] }, reader, {
      env: {},
      now: NOW,
    });
    expect(found.logins).toEqual(["4", "3"]);
    expect(found.why).toContain("login 2 would reach five hours");
    expect(found.why).toContain("login 5 could not be read");
  });

  it("asks the provider nothing where every login is at its cap", async () => {
    const live = ["2", "3"].map((login) => ({ name: `on-${login}`, login, host: "here" }));
    let asked = 0;
    const reader = (wanted: readonly string[]) => {
      asked += wanted.length;
      return Promise.resolve([]);
    };
    const found = await roomFor(["2", "3"], new Set(), { live, unasked: [] }, reader, {
      env: { ANA_LOGIN_RUNS: "1" },
      now: NOW,
    });
    expect(found).toEqual({ logins: [], why: "" });
    expect(asked).toBe(0);
  });
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
      readings: [read("3", 10), read("4", 10, 10, "allowed", 2)],
      live: nobody,
      unasked: none,
      asked: 0,
      acted: [...none],
      said: [...none],
    };
    const look = keeperOf("sample", ["2", "3", "4"], WAIT_MS, {
      events: () => state.events,
      open: () => state.open,
      last: () => ({ login, flags }),
      fleet: () => Promise.resolve({ live: state.live, unasked: state.unasked }),
      read: (wanted) => {
        state.asked += wanted.length > 0 ? 1 : 0;
        return Promise.resolve(state.readings.filter((one) => wanted.includes(one.login)));
      },
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

  it("moves a run off a week's limit and off a short five-hour wait, soonest week first", async () => {
    for (const hours of [40, 0.5]) {
      const { state, look } = scripted();
      state.events = [waited(hours)];
      expect(await look(NOW)).toBe(false);
      expect(state.acted).toEqual(["stop", "start 3"]);
    }
  });

  it("leaves a run whose login recovers first to go on by itself", async () => {
    const { state, look } = scripted();
    state.events = [waited(0.2)];
    expect(await look(NOW)).toBe(false);
    expect(state.acted).toEqual([]);
    expect(state.asked).toBe(0);
    // The reset passed: the seat wrote a turn the provider answered, and the keeper has moved nothing.
    state.events = [waited(0.2), event("build.turn", { session: "b-1", stopReason: "toolUse" })];
    expect(await look(NOW + HOUR)).toBe(false);
    expect(state.acted).toEqual([]);
  });

  it("says once that every login is predicted over, asks again later, and moves when one fits", async () => {
    const { state, look } = scripted();
    const over = (login: string) => read(login, 10, 60);
    state.readings = [over("3"), over("4")];
    await look(NOW);
    expect(state.asked).toBe(1);
    await look(NOW + MINUTE);
    await look(NOW + 2 * MINUTE);
    // Nothing was stopped, one line was said, and the provider was asked once in ten minutes.
    expect(state.acted).toEqual([]);
    expect(state.asked).toBe(1);
    expect(state.said).toHaveLength(1);
    expect(state.said[0]).toContain("login 3, 4 would reach five hours");
    await look(NOW + 11 * MINUTE);
    expect(state.asked).toBe(2);
    expect(state.said).toHaveLength(1);
    state.readings = [over("3"), read("4", 10)];
    await look(NOW + 22 * MINUTE);
    expect(state.acted).toEqual(["stop", "start 4"]);
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

  it("leaves a run that bills no login to its wait, with no restart into the same limit", async () => {
    const codex = ["--builder", "openai-codex/gpt-6.1-sol", "--solver", "openai-codex/gpt-6.1-sol"];
    const { state, look } = scripted(codex, undefined);
    await look(NOW);
    await look(NOW + 11 * MINUTE);
    expect(state.acted).toEqual([]);
    expect(state.asked).toBe(0);
    state.events = [];
    state.open = false;
    await look(NOW + 22 * MINUTE);
    expect(state.acted).toEqual(["start none"]);
  });

  it("leaves when the campaign ends on its own terms", async () => {
    const { state, look } = scripted();
    state.events = [event("campaign.ended", { ending: "budget" })];
    state.open = false;
    expect(await look(NOW)).toBe(true);
    expect(state.acted).toEqual([]);
  });
});

describe("the keeper a run gets by itself", () => {
  const env = { ANA_LOGINS: "2,3" };

  it("goes with a numbered login where another is allowed, unless it was turned off", () => {
    expect(keepsItself(env, "2")).toBe(true);
    expect(keepsItself({ ...env, ANA_KEEP: "off" }, "2")).toBe(false);
    expect(keepsItself(env, undefined)).toBe(false);
    expect(keepsItself({ ANA_LOGINS: "2" }, "2")).toBe(false);
    expect(keepsItself({ CLAUDE_CODE_OAUTH_TOKEN2: "a", CLAUDE_CODE_OAUTH_TOKEN3: "b" }, "2")).toBe(true);
  });

  /** `continue` of a stopped campaign whose log already ended, over a campaign command that lives for
   *  a few seconds, so that a keeper it leaves reads the ending and goes by itself. */
  function goOn(extra: string[], environment: Record<string, string>) {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "sample");
    mkdirSync(folder, { recursive: true });
    mkdirSync(join(made.main, "tools", "d2"), { recursive: true });
    writeFileSync(
      join(made.main, "tools", "d2", "harness-builder.ts"),
      'if (!process.argv.includes("--dry-run")) await Bun.sleep(5000);\n',
    );
    writeFileSync(join(made.main, "package.json"), '{ "name": "fixture" }\n');
    const log = join(folder, "log.jsonl");
    writeFileSync(log, `${JSON.stringify(event("campaign.ended", { ending: "budget" }))}\n`);
    writeReceipt(log, "run-1", {
      at: new Date(NOW).toISOString(),
      pid: 1,
      flags: seats(OPUS, "hhhh"),
      envFile: null,
      commit: made.commit,
      dirty: false,
      load: 0,
      cores: 1,
    });
    const words = JSON.stringify(["sample", "--login", "2", ...extra, "--yes"]);
    const result = made.run(
      `import { continueRun } from "REPOSITORY/tools/runs/manage.ts"; await continueRun(${words});`,
      { ANA_LOGINS: "2,3", ANA_LOGIN_RUNS: "2", CLAUDE_CODE_OAUTH_TOKEN2: "a", ...environment },
    );
    return { result, out: join(folder, "keep.out") };
  }

  it("is left running by continue, and goes when the run has ended", async () => {
    const { result, out } = goOn([], {});
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("sample: kept by pid");
    let said = "";
    for (let tries = 0; tries < 50 && !said.includes("kept no longer"); tries += 1) {
      await Bun.sleep(200);
      said = existsSync(out) ? readFileSync(out, "utf8") : "";
    }
    expect(said).toContain("sample ended on budget: kept no longer");
  }, 20_000);

  it("is not left where the environment turns keepers off", () => {
    const { result, out } = goOn([], { ANA_KEEP: "off" });
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("kept by pid");
    expect(existsSync(out)).toBe(false);
  }, 20_000);
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

  it("keeps an all-GPT campaign with no login, and a Claude campaign only where the plain login is set", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const folder = join(made.main, ".ana", "d2", "sample");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "log.jsonl");
    writeFileSync(log, "");
    const receipt: Receipt = {
      at: new Date(NOW).toISOString(),
      pid: 1,
      flags: seats("openai-codex/gpt-6.1-sol", "hhhh"),
      envFile: null,
      commit: made.commit,
      dirty: false,
      load: 0,
      cores: 1,
    };
    writeReceipt(log, "run-1", receipt);
    const command = 'import { keep } from "REPOSITORY/tools/runs/keep.ts"; await keep(["sample"]);';
    const result = made.run(command);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("would be kept going");
    expect(made.recorded().some(({ tool }) => tool === "ssh")).toBe(false);
    writeReceipt(log, "run-1", { ...receipt, flags: seats(OPUS, "hhhh") });
    const refused = made.run(command);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("no allowed Claude login");
    const plain = made.run(command, { CLAUDE_CODE_OAUTH_TOKEN: "plain" });
    expect(plain.code).toBe(0);
    expect(plain.out).toContain("would be kept going");
    // The word the detached keeper is handed on such a machine names no login.
    const handed = made.run(command.replace('["sample"]', '["sample", "--logins", ""]'));
    expect(handed.code).toBe(1);
    expect(handed.err).toContain("no allowed Claude login");
  });
});

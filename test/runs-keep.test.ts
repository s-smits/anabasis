// Keeping a campaign going: the turn a keeper takes, and the login it moves the run to.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { seats } from "../tools/runs/fresh.ts";
import { nextLogin, roomFor, type Turn, turnOf, turnsIn } from "../tools/runs/keep.ts";
import { billsLogin, type Reading, room } from "../tools/runs/logins.ts";
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
  fiveHour: { pct: five, resetsAt: null, status },
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
    expect(await roomFor(["2", "3"], new Set(), { live, unasked: [] }, readAll, env)).toEqual(["3"]);
    expect(await roomFor(["2", "3"], new Set(), { live: live.slice(1), unasked: [] }, readAll, env)).toEqual([
      "2",
      "3",
    ]);
    expect(await roomFor(["2", "3"], new Set(), { live: [], unasked: ["m1"] }, readAll, env)).toEqual([]);
  });
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
      ["move", "2", codex, { roomy: ["1"] }, undefined],
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

  it("keeps an all-GPT campaign with no login and refuses a Claude campaign there", () => {
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
  });
});

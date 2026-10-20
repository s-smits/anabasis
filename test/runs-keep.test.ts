// Keeping a campaign going: the turn a keeper takes, and the login it moves the run to.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { nextLogin, seatModels, type Turn, turnOf } from "../tools/runs/keep.ts";
import { allowedLogins, type Reading, room } from "../tools/runs/logins.ts";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const HOUR = 3_600_000;

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-15T12:00:00.000Z",
  kind,
  data,
});
const waited = (hours: number, reason = "provider") =>
  event("campaign.waited", { for: reason, until: new Date(NOW + hours * HOUR).toISOString() });

describe("the turn a keeper takes", () => {
  it("moves a live run off a provider wait longer than its bound, and watches it otherwise", () => {
    expect(turnOf([waited(2)], "open", NOW, HOUR)).toBe("move");
    // A wait of the bound exactly is waited out where the run is.
    expect(turnOf([waited(1)], "open", NOW, HOUR)).toBe("watch");
    expect(turnOf([waited(5, "load")], "open", NOW, HOUR)).toBe("watch");
    expect(turnOf([waited(5), event("build.started", { session: "b-1" })], "open", NOW, HOUR)).toBe("watch");
    expect(turnOf([], "open", NOW, HOUR)).toBe("watch");
  });

  it("goes on with a run that died or ended on its environment, and leaves one that ended on its own terms", () => {
    expect(turnOf([event("build.started", { session: "b-1" })], "closed", NOW, HOUR)).toBe("continue");
    expect(turnOf([event("campaign.ended", { ending: "environment" })], "closed", NOW, HOUR)).toBe(
      "continue",
    );
    for (const ending of ["budget", "stop", "operator", "finished", "no-room"]) {
      expect(turnOf([event("campaign.ended", { ending })], "closed", NOW, HOUR)).toBe("done");
    }
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
      read("3", 50, 10, "allowed_warning", 5),
      read("4", 10),
    ];
    expect(room(readings, ["2", "3", "4"], new Set())).toEqual(["4", "3", "2"]);
    expect(room(readings, ["2", "3"], new Set())).toEqual(["3", "2"]);
    expect(room(readings, ["2", "3", "4"], new Set(["4"]))).toEqual(["3", "2"]);
  });

  it("leaves a login whose week is nearly spent, whose five hours are, that is refused, or that could not be read", () => {
    const readings: Reading[] = [
      read("1", 90),
      read("2", 20, 100),
      read("3", 20, 10, "rejected"),
      { login: "4", plain: false, error: "unauthorized" },
    ];
    expect(room(readings, ["1", "2", "3", "4"], new Set())).toEqual([]);
  });

  it("allows the logins ANA_LOGINS names, or else every login the environment holds", () => {
    const key = "CLAUDE_CODE_OAUTH_TOKEN";
    const env = { [key]: "a", [`${key}10`]: "x", [`${key}3`]: "c", [`${key}2`]: "b" };
    expect(allowedLogins(env)).toEqual(["2", "3", "10"]);
    expect(allowedLogins({ ...env, ANA_LOGINS: " 3, 4 ," })).toEqual(["3", "4"]);
    expect(allowedLogins({ ...env, ANA_LOGINS: "" })).toEqual(["2", "3", "10"]);
  });
});

describe("the login a run goes on with", () => {
  const claude = ["--builder", "claude/claude-opus-5-5", "--solver", "claude/claude-opus-5-5"];
  const codex = ["--builder", "openai-codex/gpt-6.1-sol", "--solver", "openai-codex/gpt-6.1-sol"];
  const goOn = (
    turn: Turn,
    current: string | undefined,
    models: readonly string[],
    { spent = [], roomy = [] }: { spent?: readonly string[]; roomy?: readonly string[] } = {},
  ) => nextLogin(turn, { current, spent: new Set(spent), models }, async () => roomy, ["3", "1", "2"]);

  it("goes on with a dead run on its own login, and a Claude run waits once its own is spent and none has room", async () => {
    expect(await goOn("continue", "2", claude)).toBe("2");
    expect(await goOn("continue", "2", claude, { spent: ["2"] })).toBeNull();
    expect(await goOn("move", "2", claude, { spent: ["2"], roomy: ["1"] })).toBe("1");
  });

  it("goes on with a run no Claude seat runs in whatever room the logins have", async () => {
    expect(await goOn("continue", undefined, codex)).toBe("3");
    expect(await goOn("continue", "2", codex, { spent: ["2"] })).toBe("2");
    expect(await goOn("continue", undefined, claude)).toBeNull();
  });

  it("reads a Claude seat from a flag joined by its sign, and from the opening the flags leave it to", async () => {
    const codexOpening = event("campaign.opened", {
      seats: { builder: { model: "openai-codex/gpt-6.1-sol", effort: "high" } },
    });
    const claudeOpening = event("campaign.opened", {
      seats: { builder: { model: "claude/claude-opus-5-5", effort: "high" } },
    });
    expect(
      await goOn("continue", undefined, seatModels([codexOpening], ["--builder=claude/claude-opus-5-5"])),
    ).toBeNull();
    expect(await goOn("continue", undefined, seatModels([claudeOpening], ["--budget", "800"]))).toBeNull();
    expect(await goOn("continue", undefined, seatModels([codexOpening], ["--budget", "800"]))).toBe("3");
  });
});

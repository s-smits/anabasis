// Keeping a campaign going: the turn a keeper takes, and the login it moves the run to.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { seats } from "../tools/runs/fresh.ts";
import { nextLogin, type Turn, turnOf } from "../tools/runs/keep.ts";
import { allowedLogins, billsLogin, type Reading, room } from "../tools/runs/logins.ts";
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
  const claude = ["--builder", OPUS, "--solver", OPUS];
  const codex = ["--builder", "openai-codex/gpt-6.1-sol", "--solver", "openai-codex/gpt-6.1-sol"];
  const goOn = (
    turn: Turn,
    current: string | undefined,
    flags: readonly string[],
    { spent = [], roomy = [] }: { spent?: readonly string[]; roomy?: readonly string[] } = {},
  ) => nextLogin(turn, { current, spent: new Set(spent), billed: billsLogin([], flags) }, async () => roomy);

  it("goes on with a dead run on its own login, and a Claude run waits once its own is spent and none has room", async () => {
    expect(await goOn("continue", "2", claude)).toBe("2");
    expect(await goOn("continue", "2", claude, { spent: ["2"] })).toBeNull();
    expect(await goOn("move", "2", claude, { spent: ["2"], roomy: ["1"] })).toBe("1");
    expect(await goOn("continue", undefined, claude)).toBeNull();
  });

  it("goes on with a run no Claude seat runs in without a login, so no login counts it", async () => {
    // On 20 October two Codex runs kept on the M1 would have waited for one of three spent logins
    // none of their seats used; a login named for them counted against its most.
    expect(await goOn("continue", undefined, codex)).toBeUndefined();
    expect(await goOn("continue", "2", codex, { spent: ["2"] })).toBeUndefined();
    expect(await goOn("move", "2", codex, { roomy: ["1"] })).toBeUndefined();
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
    const opening = event("campaign.opened", {
      seats: Object.fromEntries(
        ["builder", "examiner", "reviewer"].map((name) => [name, { model: OPUS, effort: "high" }]),
      ),
      solver: { model: OPUS, effort: "high" },
    });
    expect(billsLogin([opening], overrides)).toBe(false);
  });

  it("leaves prompt text out of login billing", () => {
    const gpt = seats("openai-codex/gpt-6.1-sol", "hhhh");
    expect(billsLogin([], [...gpt, "--prompt", "claude/a domain to investigate"])).toBe(false);
    expect(billsLogin([], [...gpt, "--prompt=claude/a domain to investigate"])).toBe(false);
  });

  it("reads the seats past a flag the campaign command does not take", () => {
    const gpt = seats("openai-codex/gpt-6.1-sol", "hhhh");
    expect(billsLogin([], [...gpt, "--at", "campaign-value"])).toBe(false);
    expect(billsLogin([], ["--at", "campaign-value", ...seats(OPUS, "hhhh")])).toBe(true);
  });

  it("bills a login for all-Claude and mixed seats", () => {
    const gpt = seats("openai-codex/gpt-6.1-sol", "hhhh");
    expect(billsLogin([], seats(OPUS, "hhhh"))).toBe(true);
    expect(billsLogin([], [...gpt, `--reviewer=${OPUS}`])).toBe(true);
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

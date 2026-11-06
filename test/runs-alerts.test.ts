// The alerts over the live runs: the fold from one look's rows to its lines, and the verb over real logs.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { type AlertState, alertsOf, type HostRows, onAlerts, type Row } from "../tools/runs/alerts.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const CLI = "tools/runs/cli.ts";
const folders: string[] = [];
afterAll(() => {
  for (const root of folders) rmSync(root, { recursive: true, force: true });
});

const row = (more: Partial<Row> = {}): Row => ({
  name: "r",
  promotions: [],
  ending: null,
  writer: true,
  keeper: true,
  owed: true,
  quiet: false,
  lastAt: "2026-11-06T10:00:00.000Z",
  kept: [],
  ...more,
});
const heldAs = (rows: readonly Row[], more: readonly string[] = []): HostRows => ({
  rows,
  held: [...rows.map(({ name }) => name), ...more],
});
const here = (...rows: Row[]) => [{ host: "here", said: heldAs(rows) }];
const unread = (digest: string) => ({ digest, read: null });
const read = (digest: string, session: string, confirmed = true) => ({
  digest,
  read: {
    session,
    reading: "no-step",
    tally: { wins: 6, losses: 0, ties: 2 },
    confirmed,
  },
});
/** What a look at `rows` remembers, whatever it printed. */
const lookedAt = (...rows: Row[]): AlertState => alertsOf(null, here(...rows)).next;

describe("the fold of one look", () => {
  it("records the present on a first look, firing on no history, and says so in one line", () => {
    const old = row({
      promotions: [read("aaaa", "g-1"), read("bbbb", "g-2")],
      ending: "budget",
      writer: false,
    });
    const { lines, next } = alertsOf(null, here(old));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("first look");
    expect(alertsOf(next, here(old)).lines).toEqual([]);
  });

  it("says a promotion seen once once, with its count and digest", () => {
    const one = row({ promotions: [unread("aaaa")] });
    const first = alertsOf(lookedAt(row()), here(one));
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toMatch(/^r \(here\): promotion 1, harness aaaa/u);
    expect(alertsOf(first.next, here(one)).lines).toEqual([]);
    const two = row({ promotions: [unread("aaaa"), unread("bbbb")] });
    const second = alertsOf(first.next, here(two));
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toContain("promotion 2, harness bbbb");
  });

  it("says a promotion and its starter read of one look in order, and tells no pause to wait for a read it holds", () => {
    const { lines } = alertsOf(lookedAt(row()), here(row({ promotions: [read("aaaa", "g-3", false)] })));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("promotion 1, harness aaaa");
    expect(lines[0]).not.toContain("wait");
    expect(lines[1]).toContain("starter comparison g-3 after promotion 1 (aaaa) read no-step");
    expect(lines[1]).toContain("won 6, lost 0, tied 2, not confirmed");
    // A peer whose tree predates the split sends no tally of it, and its line stands without one.
    expect(lines[1]).not.toContain("written after");
  });

  it("says beside a starter read how the tasks written after the promotion stood", () => {
    const told = read("aaaa", "g-3", false);
    const split = { ...told, read: { ...told.read, writtenAfter: { wins: 0, losses: 6, ties: 1 } } };
    const { lines } = alertsOf(lookedAt(row()), here(row({ promotions: [split] })));
    expect(lines[1]).toContain(
      "won 6, lost 0, tied 2, not confirmed; on tasks written after it won 0, lost 6, tied 1",
    );
  });

  it("says a run is ready to pause, with the command, once a second promotion is read and only then", () => {
    const unconfirmed = row({ promotions: [read("aaaa", "g-1"), unread("bbbb")] });
    const waiting = alertsOf(lookedAt(row({ promotions: [read("aaaa", "g-1")] })), here(unconfirmed));
    expect(waiting.lines.join("\n")).not.toContain("ready to pause");
    const both = row({ promotions: [read("aaaa", "g-1"), read("bbbb", "g-2")] });
    const ready = alertsOf(waiting.next, here(both));
    expect(ready.lines).toHaveLength(2);
    expect(ready.lines[1]).toContain("ready to pause");
    expect(ready.lines[1]).toEndWith("bun run runs pause r --yes");
    const third = row({ promotions: [...both.promotions, read("cccc", "g-3")] });
    expect(alertsOf(ready.next, here(third)).lines.join("\n")).not.toContain("ready to pause");
  });

  it("reads no second promotion as ready where its first was never read against the starter", () => {
    const { lines } = alertsOf(
      lookedAt(row({ promotions: [unread("aaaa")] })),
      here(row({ promotions: [unread("aaaa"), read("bbbb", "g-2")] })),
    );
    expect(lines.join("\n")).not.toContain("ready to pause");
  });

  it("says what the keeper did once, and nothing of what it did before the run was seen", () => {
    const before = lookedAt(row({ kept: ["T r: move on login 3"] }));
    const moved = row({ kept: ["T r: move on login 3", "r: every login is spent; left waiting"] });
    const { lines, next } = alertsOf(before, here(moved));
    expect(lines).toEqual(["r (here): keeper: every login is spent; left waiting"]);
    expect(alertsOf(next, here(moved)).lines).toEqual([]);
    const fresh = alertsOf(before, here(moved, row({ name: "new", kept: ["T new: move on login 3"] })));
    expect(fresh.lines.join("\n")).not.toContain("new (here)");
  });

  it("says each gap in a live run once, and none in a run owed no keeper or one that ended", () => {
    const start = lookedAt(row());
    const gaps = [
      [{ keeper: false }, "no keeper"],
      [{ writer: false }, "no writer process; its keeper lives"],
      [{ writer: false, keeper: false }, "no writer process and no keeper"],
      [{ writer: false, keeper: false, owed: false }, "no writer process"],
    ] as const;
    for (const [state, says] of gaps) {
      const once = alertsOf(start, here(row(state)));
      expect(once.lines).toEqual([`r (here): ${says}`]);
      expect(alertsOf(once.next, here(row(state))).lines).toEqual([]);
    }
    expect(alertsOf(start, here(row({ keeper: false, owed: false }))).lines).toEqual([]);
    expect(alertsOf(start, here(row({ writer: false, keeper: false, ending: "budget" }))).lines).toEqual([
      "r (here): ended budget",
    ]);
  });

  it("says a stall once, and again once the run has moved and stalled afresh", () => {
    const stalled = row({ quiet: true });
    const first = alertsOf(lookedAt(row()), here(stalled));
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toContain("no new event since 2026-11-06T10:00:00.000Z");
    expect(alertsOf(first.next, here(stalled)).lines).toEqual([]);
    const moving = alertsOf(first.next, here(row()));
    expect(moving.lines).toEqual([]);
    expect(alertsOf(moving.next, here(stalled)).lines).toHaveLength(1);
  });

  it("says a host down once, holds its runs, and says what they gained when it answers", () => {
    const start = alertsOf(null, [
      { host: "here", said: heldAs([]) },
      { host: "peer", said: heldAs([row()]) },
    ]).next;
    const away = [
      { host: "here", said: heldAs([]) },
      { host: "peer", said: null },
    ];
    const down = alertsOf(start, away);
    expect(down.lines).toHaveLength(1);
    expect(down.lines[0]).toStartWith("peer: did not answer");
    const again = alertsOf(down.next, away);
    expect(again.lines).toEqual([]);
    expect(Object.keys(again.next.runs)).toEqual(["r"]);
    const back = alertsOf(again.next, [
      { host: "here", said: heldAs([]) },
      { host: "peer", said: heldAs([row({ promotions: [unread("aaaa")] })]) },
    ]);
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0]).toContain("r (peer): promotion 1");
    expect(back.next.down).toEqual([]);
    expect(alertsOf(back.next, away).lines).toHaveLength(1);
  });

  it("says a live run that left the registry once, forgets it, and says nothing of one that ended", () => {
    const gone = alertsOf(lookedAt(row()), here());
    expect(gone.lines).toEqual(["r (here): left the registry with no ending seen"]);
    expect(gone.next.runs).toEqual({});
    expect(alertsOf(gone.next, here()).lines).toEqual([]);
    const ended = alertsOf(lookedAt(row({ ending: "budget", writer: false })), here());
    expect(ended.lines).toEqual([]);
    expect(ended.next.runs).toEqual({});
  });

  it("keeps quiet of a run still held though the rows left it out, and it reads on when it returns", () => {
    const dormant = alertsOf(lookedAt(row({ writer: false, keeper: false })), [
      { host: "here", said: heldAs([], ["r"]) },
    ]);
    expect(dormant.lines).toEqual([]);
    const back = alertsOf(dormant.next, here(row({ promotions: [unread("aaaa")] })));
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0]).toContain("promotion 1");
  });

  it("takes a run moved to another host as the same run, whichever of the two is read last", () => {
    const start = alertsOf(null, [
      { host: "here", said: heldAs([row({ promotions: [unread("aaaa")] })]) },
    ]).next;
    const landed = row({ promotions: [unread("aaaa")] });
    const moved = alertsOf(start, [
      { host: "peer", said: heldAs([landed]) },
      { host: "here", said: heldAs([]) },
    ]);
    expect(moved.lines).toEqual([]);
    expect(moved.next.runs.r?.host).toBe("peer");
    const midway = alertsOf(start, [
      { host: "peer", said: heldAs([landed]) },
      { host: "here", said: heldAs([{ ...landed, writer: false, keeper: false }]) },
    ]);
    expect(midway.lines).toEqual([]);
  });

  it("says a run first seen with promotions in one line, since they may be its seed's", () => {
    const { lines } = alertsOf(
      lookedAt(),
      here(row({ promotions: [read("aaaa", "g-1"), read("bbbb", "g-2")] })),
    );
    expect(lines).toEqual(["r (here): first seen with 2 promotions, the last bbbb"]);
  });
});

describe("the verb over real logs", () => {
  /** A fixture host with one campaign's log, read by the real CLI under `extra`. */
  function host(extra: Record<string, string> = { ANA_HOSTS: "[]" }) {
    const made = fakeHosts();
    folders.push(made.root);
    const folder = join(made.main, ".ana", "d2", "the-run");
    mkdirSync(folder, { recursive: true });
    const log = join(folder, "log.jsonl");
    const event = (kind: string, data: JsonObject) =>
      writeFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), kind, data })}\n`, { flag: "a" });
    event("comparison.started", { session: "g-1", starter: "s".repeat(64), old: "s".repeat(64) });
    const state = join(made.root, "alerts.json");
    const look = (more: Record<string, string> = {}) =>
      made.runScript(CLI, ["alerts", "--state", state], { ...extra, ...more });
    return { made, folder, event, state, look };
  }
  const STARTER = "s".repeat(64);
  const HARNESS = `abcd1234${"e".repeat(56)}`;

  it("leaves out a seed a rehearsal writes, and reads one a launch continued", () => {
    const { folder } = host();
    const run = {
      name: "the-run",
      path: join(folder, "log.jsonl"),
      tree: "",
      end: "comparison.reported" as const,
      seed: true,
    };
    expect(onAlerts(run, true, 0)).toBe(false);
    expect(onAlerts({ ...run, seed: false }, true, 0)).toBe(true);
    writeFileSync(join(folder, "launch-run-1.json"), JSON.stringify({ at: "2026-11-06T07:00:00.000Z" }));
    expect(onAlerts(run, true, 0)).toBe(true);
    expect(onAlerts(run, false, 0)).toBe(false);
  });

  it("reads a promotion and its starter comparison from a log, prints each once and exits 0", () => {
    const { event, look, folder } = host();
    const first = look();
    expect(first.code).toBe(0);
    expect(first.out.trim().split("\n")).toHaveLength(1);
    expect(first.out).toContain("first look: recorded 1 run on 1 host");
    expect(look().out).toBe("");
    event("harness.promoted", { harness: HARNESS });
    event("comparison.reported", {
      session: "g-2",
      old: HARNESS,
      fresh: STARTER,
      reading: "no-step",
      level: 0.02,
      scored: { differences: Array.from({ length: 6 }, () => -1) },
    });
    writeFileSync(
      join(folder, "keep.out"),
      "2026-11-06T10:00:00.000Z the-run: move on login 3\n  a refusal\n",
    );
    const news = look();
    expect(news.code).toBe(0);
    const lines = news.out.trim().split("\n");
    // The first look recorded that this log has no writer, so that gap says nothing here.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith("the-run (here): promotion 1, harness abcd1234");
    expect(lines[1]).toContain("starter comparison g-2 after promotion 1 (abcd1234) read no-step");
    expect(lines[1]).toContain("won 6, lost 0, tied 0, confirmed");
    expect(lines[2]).toBe("the-run (here): keeper: 2026-11-06T10:00:00.000Z move on login 3");
    expect(look().out).toBe("");
    event("campaign.ended", { ending: "budget" });
    expect(look().out).toBe("the-run (here): ended budget\n");
  });

  it("reads a torn or misshapen state file as a first look and fires on no history", () => {
    const { event, look, state } = host();
    event("harness.promoted", { harness: HARNESS });
    look();
    for (const torn of [`{"down":[],"runs":{"the-run":{"ho`, `{"down":[],"runs":{"the-run":{}}}`, "[]"]) {
      writeFileSync(state, torn);
      const after = look();
      expect(after.code).toBe(0);
      const lines = after.out.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("could not be read");
      expect(lines[1]).toContain("first look");
      expect(look().out).toBe("");
    }
  });

  it("says a host that does not answer once, on any look, and still exits 0", () => {
    const { made, look, state } = host({});
    const first = look({ FAKE_OFFLINE: "1" });
    expect(first.code).toBe(0);
    expect(first.out).toContain(`${made.host.name} did not answer`);
    const second = look({ FAKE_OFFLINE: "1" });
    expect([second.code, second.out]).toEqual([0, ""]);
    expect(readFileSync(state, "utf8")).toContain(made.host.name);
  });

  it("reads an answer no look can use as a host that did not answer, and a good one as that host's rows", () => {
    const { made, look } = host({});
    const fleet = (alerts: string) => ({
      FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { alerts } }),
    });
    const peer = (promotions: Row["promotions"]) =>
      JSON.stringify({ rows: [row({ name: "away", promotions })], held: ["away"] });
    expect(look(fleet(peer([]))).out).toContain("recorded 2 runs on 2 hosts");
    const down = look(fleet("no list here"));
    expect(down.out).toBe(`${made.host.name}: did not answer; its runs stay as last seen\n`);
    const back = look(fleet(peer([{ digest: "aaaa", read: null }])));
    expect(back.code).toBe(0);
    expect(back.out).toContain(`away (${made.host.name}): promotion 1, harness aaaa`);
  });

  it("answers another host with its rows and writes no state there", () => {
    const { made, event, state } = host();
    event("harness.promoted", { harness: HARNESS });
    const { out, code } = made.runScript(CLI, ["alerts", "--rows", "--state", state], { ANA_HOSTS: "[]" });
    expect(code).toBe(0);
    const answer = parseJsonAs<HostRows>(out);
    expect(answer.held).toEqual(["the-run"]);
    expect(answer.rows[0]?.promotions[0]?.digest).toBe("abcd1234");
    expect(() => readFileSync(state, "utf8")).toThrow();
  });
});

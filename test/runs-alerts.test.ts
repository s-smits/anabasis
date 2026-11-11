// The alerts over the live runs: the fold from one look's rows to its lines, and the verb over real logs.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { type AlertState, alertsOf, type HostRows, onAlerts, type Row } from "../tools/runs/alerts.ts";
import type { RunState } from "../tools/runs/state.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const CLI = "tools/runs/cli.ts";
const ENDED: RunState = { kind: "ended", ending: "budget" };
const STOPPED: RunState = { kind: "stopped" };
const folders: string[] = [];
afterAll(() => {
  for (const root of folders) rmSync(root, { recursive: true, force: true });
});

const row = (more: Partial<Row> = {}): Row => ({
  name: "r",
  promotions: [],
  state: { kind: "live", kept: true },
  owed: true,
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
      state: ENDED,
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
    expect(lines[1]).toContain(
      "starter comparison g-3 after promotion 1 (aaaa) read no step for the reference: won 6, lost 0, tied 2, not confirmed",
    );
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
      [{ state: { kind: "live", kept: false } }, "no keeper"],
      [{ state: { kind: "kept" } }, "no writer process; its keeper lives"],
      [{ state: STOPPED }, "no writer process and no keeper"],
      [{ state: STOPPED, owed: false }, "no writer process"],
      // A run its launch's pause stopped is paused, owed a keeper or not; a peer that sends no word of
      // a pause says the older line above.
      [{ state: STOPPED, paused: true }, "paused"],
      [{ state: STOPPED, owed: false, paused: true }, "paused"],
      [{ state: STOPPED, paused: false }, "no writer process and no keeper"],
    ] as const;
    for (const [state, says] of gaps) {
      const once = alertsOf(start, here(row(state)));
      expect(once.lines).toEqual([`r (here): ${says}`]);
      expect(alertsOf(once.next, here(row(state))).lines).toEqual([]);
    }
    expect(alertsOf(start, here(row({ state: { kind: "live", kept: false }, owed: false }))).lines).toEqual(
      [],
    );
    expect(alertsOf(start, here(row({ state: ENDED }))).lines).toEqual(["r (here): ended budget"]);
  });

  it("says an ending its keeper goes on past once, and again only once the run went on and ended afresh", () => {
    const kept = row({ state: { kind: "kept", ending: "environment" } });
    const first = alertsOf(lookedAt(row()), here(kept));
    expect(first.lines).toEqual([
      "r (here): no writer process; its keeper lives",
      "r (here): ended environment",
    ]);
    expect(alertsOf(first.next, here(kept)).lines).toEqual([]);
    const again = alertsOf(alertsOf(first.next, here(row())).next, here(kept));
    expect(again.lines).toContain("r (here): ended environment");
  });

  it("says a stall once, and again once the run has moved and stalled afresh", () => {
    const stalled = row({ state: { kind: "quiet", kept: true, since: 0 } });
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
    expect(down.lines[0]).toStartWith("peer: gave no answer this tree reads");
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
    const ended = alertsOf(lookedAt(row({ state: ENDED })), here());
    expect(ended.lines).toEqual([]);
    expect(ended.next.runs).toEqual({});
    // One `runs retire` moved into the archive of a host that answered is said nothing of, and forgotten.
    const retired = alertsOf(lookedAt(row({ state: STOPPED })), [
      { host: "here", said: { ...heldAs([]), retired: ["r"] } },
    ]);
    expect(retired.lines).toEqual([]);
    expect(retired.next.runs).toEqual({});
    // A peer that names no archive says it as before.
    const older = alertsOf(lookedAt(row({ state: STOPPED })), [{ host: "here", said: heldAs([]) }]);
    expect(older.lines).toEqual(["r (here): left the registry with no ending seen"]);
  });

  it("keeps quiet of a run still held though the rows left it out, and it reads on when it returns", () => {
    const dormant = alertsOf(lookedAt(row({ state: STOPPED })), [{ host: "here", said: heldAs([], ["r"]) }]);
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
      { host: "here", said: heldAs([{ ...landed, state: STOPPED }]) },
    ]);
    expect(midway.lines).toEqual([]);
  });

  it("says the same lines and remembers the same look for every pair of standings a run moves between", () => {
    const wait = { for: "provider", until: 0 };
    const standings: RunState[] = [
      { kind: "live", kept: true },
      { kind: "live", kept: false },
      { kind: "waiting", kept: true, wait },
      { kind: "waiting", kept: false, wait },
      { kind: "quiet", kept: true, since: 0 },
      { kind: "quiet", kept: false, since: 0 },
      { kind: "kept" },
      { kind: "ended", ending: "budget" },
      { kind: "stopped" },
    ];
    const said = new Map([
      ["quiet: no new event since 2026-11-06T10:00:00.000Z, and no login limit waited on", "Q"],
      ["no writer process; its keeper lives", "K"],
      ["ended budget", "E"],
      ["no keeper", "N"],
      ["no writer process and no keeper", "W"],
      ["no writer process", "O"],
    ]);
    // Rows: the standing last seen; columns: the standing now, owed a keeper and then not.
    const lines = [
      "- - N - - - N - Q Q NQ Q K K E E W O",
      "- - - - - - - - Q Q Q Q K K E E W O",
      "- - N - - - N - Q Q NQ Q K K E E W O",
      "- - - - - - - - Q Q Q Q K K E E W O",
      "- - N - - - N - - - N - K K E E W O",
      "- - - - - - - - - - - - K K E E W O",
      "- - N - - - N - Q Q NQ Q - - E E W O",
      "- - N - - - N - Q Q NQ Q K K - - W O",
      "- - N - - - N - Q Q NQ Q K K E E - -",
    ];
    const keeper = "no writer process; its keeper lives";
    // What the state file keeps of each standing now, owed a keeper and then not: ending, gap, quiet.
    const kept = [
      [null, null, false, null, null, false],
      [null, "no keeper", false, null, null, false],
      [null, null, false, null, null, false],
      [null, "no keeper", false, null, null, false],
      [null, null, true, null, null, true],
      [null, "no keeper", true, null, null, true],
      [null, keeper, false, null, keeper, false],
      ["budget", null, false, "budget", null, false],
      [null, "no writer process and no keeper", false, null, "no writer process", false],
    ];
    const told: string[] = [];
    const remembered: (string | boolean | null)[][] = [];
    for (const before of standings) {
      const cells: string[] = [];
      for (const [at, now] of standings.entries()) {
        const seen: (string | boolean | null)[] = [];
        for (const owed of [true, false]) {
          const look = alertsOf(lookedAt(row({ state: before, owed })), here(row({ state: now, owed })));
          const codes = look.lines.map((line) => said.get(line.replace("r (here): ", "")) ?? "?");
          cells.push(codes.join("") || "-");
          const { ending, gap, quiet } = look.next.runs.r ?? {};
          seen.push(ending ?? null, gap ?? null, quiet ?? null);
        }
        remembered[at] = seen;
      }
      told.push(cells.join(" "));
    }
    expect(told).toEqual(lines);
    expect(remembered).toEqual(kept);
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
  const SECOND = `cdef5678${"f".repeat(56)}`;

  it("leaves out a seed a rehearsal writes, and reads one a launch continued", () => {
    const { folder } = host();
    const run = {
      name: "the-run",
      path: join(folder, "log.jsonl"),
      tree: "",
      end: "comparison.reported" as const,
      seed: true,
    };
    expect(onAlerts(run, "open", 0)).toBe(false);
    expect(onAlerts({ ...run, seed: false }, "open", 0)).toBe(true);
    writeFileSync(join(folder, "launch-run-1.json"), JSON.stringify({ at: "2026-11-06T07:00:00.000Z" }));
    // Continued, it is read as any run: closed and written lately (a keeper between two starts), or not.
    expect(onAlerts(run, "open", 0)).toBe(true);
    expect(onAlerts(run, "closed", 0)).toBe(onAlerts({ ...run, seed: false }, "closed", 0));
    expect(onAlerts(run, "closed", 30 * 86_400_000)).toBe(false);
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
    // The comparison read no-step, the starter not above the reference; the starter read is a step.
    expect(lines[1]).toContain(
      "starter comparison g-2 after promotion 1 (abcd1234) read a step for the reference: won 6, lost 0, tied 0, confirmed",
    );
    expect(lines[2]).toBe("the-run (here): keeper: 2026-11-06T10:00:00.000Z move on login 3");
    expect(look().out).toBe("");
    // The nearest hostile case: a starter read that reads no step for the reference either.
    event("harness.promoted", { harness: SECOND });
    event("comparison.reported", {
      session: "g-4",
      old: SECOND,
      fresh: STARTER,
      reading: "no-step",
      level: 0.02,
      scored: { differences: [-1, 1, -1, 1, 0, 0] },
    });
    expect(look().out).toContain(
      "starter comparison g-4 after promotion 2 (cdef5678) read no step for the reference: won 2, lost 2, tied 2, not confirmed",
    );
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
    expect(first.out).toContain(`${made.host.name} gave no answer this tree reads`);
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
    expect(down.out).toBe(`${made.host.name}: gave no answer this tree reads; its runs stay as last seen\n`);
    const back = look(fleet(peer([{ digest: "aaaa", read: null }])));
    expect(back.code).toBe(0);
    expect(back.out).toContain(`away (${made.host.name}): promotion 1, harness aaaa`);
  });

  it("reads a peer answering from an older tree as a host down, in one line, and the peer that answered as before", () => {
    const { made, look } = host({});
    const behind = { ...made.host, name: "behind", ssh: "fake-behind" };
    const whole = row({ name: "aged" });
    const { state: _, ...rest } = whole;
    const stateless = JSON.stringify(rest);
    const fleet = (current: Row["promotions"], aged: string) => ({
      ANA_HOSTS: JSON.stringify([made.host, behind]),
      FAKE_FLEET: JSON.stringify({
        [made.host.ssh]: {
          alerts: JSON.stringify(heldAs([row({ name: "away", promotions: current })])),
        },
        [behind.ssh]: { alerts: `{"rows":[${aged}],"held":["aged"]}` },
      }),
    });
    const first = look(fleet([], JSON.stringify(whole)));
    expect([first.code, first.out]).toEqual([
      0,
      "first look: recorded 3 runs on 3 hosts, and each later look prints what is new\n",
    ]);
    const promoted = [unread("aaaa")];
    const next = look(fleet(promoted, stateless));
    expect([next.code, next.err]).toEqual([0, ""]);
    const named = "behind: gave no answer this tree reads; its runs stay as last seen";
    const [said, promotion, ...more] = next.out.trim().split("\n");
    expect(said).toBe(named);
    expect(promotion).toStartWith(`away (${made.host.name}): promotion 1, harness aaaa`);
    expect(more).toEqual([]);
    expect(look(fleet(promoted, stateless)).out).toBe("");
    // Back on a whole answer, and then a starter read with no tally, which the fold would also throw on.
    expect(look(fleet(promoted, JSON.stringify(whole))).out).toBe("");
    const untallied = JSON.stringify({
      ...whole,
      promotions: [{ digest: "bbbb", read: { session: "g-9" } }],
    });
    const again = look(fleet(promoted, untallied));
    expect([again.code, again.out]).toEqual([0, `${named}\n`]);
  });

  it("answers another host with its rows and writes no state there", () => {
    const { made, event, state } = host();
    event("harness.promoted", { harness: HARNESS });
    const { out, code } = made.runScript(CLI, ["alerts", "--rows", "--state", state], { ANA_HOSTS: "[]" });
    expect(code).toBe(0);
    const answer = parseJsonAs<HostRows>(out);
    expect(answer.held).toEqual(["the-run"]);
    expect(answer.rows[0]?.promotions[0]?.digest).toBe("abcd1234");
    expect(answer.rows[0]?.paused).toBe(false);
    expect(answer.retired).toEqual([]);
    expect(() => readFileSync(state, "utf8")).toThrow();
  });

  it("reads a pause left in the run's current launch, and none left before it", () => {
    const { made, folder, event, state } = host();
    const rows = () =>
      parseJsonAs<HostRows>(
        made.runScript(CLI, ["alerts", "--rows", "--state", state], { ANA_HOSTS: "[]" }).out,
      ).rows[0];
    event("campaign.word", { word: "pause", why: "two promotions" });
    expect(rows()?.paused).toBe(true);
    // A launch after it is the run gone on, and its pause was for the process that stopped.
    writeFileSync(
      join(folder, "launch-run-2.json"),
      JSON.stringify({ at: new Date(Date.now() + 1000).toISOString() }),
    );
    event("build.started", { session: "b-2" });
    const later = rows();
    expect(later?.paused).toBe(false);
  });
});

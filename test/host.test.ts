/**
 * What a campaign waits for (`tools/d2/host.ts`): the host's load before a solve, the campaign's
 * reserve beside the solves in flight, a provider's named reset and a network that failed a
 * session. Every wait sleeps through the host, so a test stands in one that only counts.
 */
import { describe, expect, it } from "bun:test";
import { resetOf } from "../src/agent/backends/claude.ts";
import { crashedRun } from "../src/campaign/ground.ts";
import { affords, flying } from "../src/campaign/opening.ts";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import type { TaskPackage } from "../src/kernel/task.ts";
import { mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { Kept } from "../tools/d2/campaign.ts";
import { waitOut } from "../src/solver/run.ts";
import { gated, type Host, waitCrashed } from "../tools/d2/host.ts";
import type { Campaign, Seats } from "../tools/d2/round.ts";
import { EXAMPLE } from "./helpers/examiner-seat.ts";

// 12 October, 12:09Z: 14:09 in Amsterdam.
const NOW = new Date("2026-10-12T12:09:00Z");
const TASK: TaskPackage = { ...EXAMPLE, ruleIds: [], checks: "" };
const HARNESS: Kept = { dir: "", digest: "h1" };

const logIn = (name: string) => join(mkdtempSync(join(tmpdir(), `ana-host-${name}-`)), "campaign.jsonl");
const waits = (log: string) => read(log).filter(({ kind }) => kind === "campaign.waited");

/** A host whose load is `load` at each look, whose sleeps are counted, return at once and call
 *  `slept` with their count. */
function hostOf(load: () => number, cores = 4, slept: (count: number) => void = () => {}) {
  const sleeps: number[] = [];
  const host: Host = {
    load,
    cores,
    waitMs: 30_000,
    sleep: async (ms) => {
      sleeps.push(ms);
      slept(sleeps.length);
    },
  };
  return { ...host, slept: sleeps };
}

/** The gate on a seat that passes each solve, as a campaign's solves meet it. */
function gate(log: string, host: Host, loaded = false) {
  const seat: Seats = {
    builder: null,
    setting: "s",
    solve: async () => ({ solve: "s-1", ending: { outcome: "pass" } }),
  };
  // SAFETY: the gate hands the campaign to the seat it wraps and reads nothing of it, and the
  // seat above reads none of its arguments, so an empty one stands in.
  return gated({ seated: () => seat, loaded, host }, log)({} as Campaign, {
    builder: undefined,
    reference: "h1",
  });
}

describe("the gate at a solve's start", () => {
  it("starts a solve at once on a host at or under its cores, and under --loaded on any", async () => {
    const log = logIn("idle");
    const idle = hostOf(() => 4);
    await gate(log, idle).solve(TASK, HARNESS, undefined);
    const busy = hostOf(() => 99);
    await gate(log, busy, true).solve(TASK, HARNESS, undefined);
    expect([idle.slept, busy.slept]).toEqual([[], []]);
    expect(waits(log)).toEqual([]);
  });

  it("waits while the load is over the cores, and puts the wait on record with the load it first read", async () => {
    const log = logIn("falls");
    const loads = [12, 9, 6];
    const host = hostOf(() => loads.shift() ?? 0, 8);
    const ended = await gate(log, host).solve(TASK, HARNESS, undefined, "g-1");
    expect(ended).toMatchObject({ ending: { outcome: "pass" } });
    expect(host.slept).toEqual([30_000, 30_000]);
    expect(waits(log).map(({ data }) => data)).toEqual([
      { task: EXAMPLE.taskId, harness: "h1", comparison: "g-1", load: 12, cores: 8, ms: expect.any(Number) },
    ]);
  });

  it("starts a solve all the same after half an hour of looks where the load never falls", async () => {
    // On 15 October one campaign's solves waited 107 minutes while two others kept its host of 8 cores loaded.
    const log = logIn("looks");
    const host = hostOf(() => 99);
    expect(await gate(log, host).solve(TASK, HARNESS, undefined)).toMatchObject({
      ending: { outcome: "pass" },
    });
    expect(host.slept).toHaveLength(60);
    expect(waits(log)).toHaveLength(1);
  });

  it("holds a solve while another is in flight and the reserve is short, until the kill, and puts nothing on record", async () => {
    const log = logIn("reserve");
    append(log, "campaign.opened", { budget: { dollars: 0.7, reserve: 0.4 } });
    const kill = new AbortController();
    const host = hostOf(
      () => 0,
      4,
      (count) => count === 3 && kill.abort(),
    );
    const held = gate(log, host);
    await flying(log, () => held.solve(TASK, HARNESS, kill.signal));
    expect(host.slept).toHaveLength(3);
    // With nothing in flight the solve starts at once.
    await held.solve(TASK, HARNESS, kill.signal);
    expect(host.slept).toHaveLength(3);
    expect(waits(log)).toEqual([]);
  });

  it("counts the reserve over the solves in flight in this process, whoever started them", async () => {
    const log = logIn("reserve");
    // No opening, no budget: every solve is afforded.
    expect(affords(log, 99)).toBe(true);
    append(log, "campaign.opened", { budget: { dollars: 1, reserve: 0.4 } });
    expect([affords(log, 2), affords(log, 3)]).toEqual([true, false]);
    // A practice solve in flight takes one reserve from an Examiner's three (14 October).
    await flying(log, async () => {
      expect([affords(log, 1), affords(log, 2)]).toEqual([true, false]);
    });
    expect(affords(log, 2)).toBe(true);
  });
});

describe("the seats behind the gate", () => {
  it("say they are paid where the seats they hold do, so a move the campaign command makes asks its admission", () => {
    const script: Seats = {
      builder: null,
      setting: "s",
      solve: async () => ({ solve: "s-1", ending: { outcome: "pass" } }),
    };
    // SAFETY: as in `gate`, the gate hands the campaign to the seat it wraps and reads nothing of it.
    const through = (seats: Seats) =>
      gated({ seated: () => seats, loaded: false, host: hostOf(() => 0) }, logIn("paid"))({} as Campaign, {
        builder: undefined,
        reference: "h1",
      });
    expect(through({ ...script, paid: true }).paid).toBe(true);
    expect(through(script).paid).toBeUndefined();
  });
});

describe("the provider's named reset", () => {
  it("is read from a clock time in a named zone, from the host's, from a week's date, or from Unix seconds", () => {
    expect(resetOf("You've hit your limit · resets 3:50pm (Europe/Amsterdam)", NOW)?.toISOString()).toBe(
      "2026-10-12T13:50:00.000Z",
    );
    // A time already past in that zone is the next day's.
    expect(resetOf("Session limit reached ∙ resets 1am (Europe/Amsterdam)", NOW)?.toISOString()).toBe(
      "2026-10-12T23:00:00.000Z",
    );
    expect(resetOf("Claude AI usage limit reached|1791811800", NOW)?.toISOString()).toBe(
      "2026-10-12T13:30:00.000Z",
    );
    expect(resetOf("You've hit your limit · resets 15:50", NOW)).not.toBeNull();
    // A week's reset names its date, which until 15 October read as the hour 15, host-local.
    expect(resetOf("weekly limit · resets Oct 15 at 9pm (Europe/Amsterdam)", NOW)?.toISOString()).toBe(
      "2026-10-15T19:00:00.000Z",
    );
  });

  it("is none where the message names none, is no limit, or names a month or zone nobody knows", () => {
    expect(resetOf("You've hit your limit", NOW)).toBeNull();
    expect(resetOf("socket hang up: connection reset by peer at 5", NOW)).toBeNull();
    expect(resetOf("limit reached · resets 3pm (Mars/Olympus)", NOW)).toBeNull();
    expect(resetOf("weekly limit · resets Smarch 15 at 9pm (Europe/Amsterdam)", NOW)).toBeNull();
  });

  it("is waited out to a minute past it and on record, however far on, from what a move threw", async () => {
    const log = logIn("reset");
    const host = hostOf(() => 0);
    expect(
      await waitOut(
        log,
        new Error("You've hit your limit · resets 3:50pm (Europe/Amsterdam)"),
        host.sleep,
        NOW,
      ),
    ).toBe(true);
    expect(await waitOut(log, "Weekly limit reached|1792416600", host.sleep, NOW)).toBe(true);
    // A reset past, a message with no reset and a throw that is no limit are not waited for.
    expect(await waitOut(log, "limit reached|1791811800", host.sleep, new Date("2026-10-12T14:00:00Z"))).toBe(
      false,
    );
    expect(await waitOut(log, new Error("exited 1"), host.sleep, NOW)).toBe(false);
    expect(await waitOut(log, null, host.sleep, NOW)).toBe(false);
    const minutes = 101 * 60_000 + 60_000;
    const week = 7 * 86_400_000 + 81 * 60_000 + 60_000;
    expect(host.slept).toEqual([minutes, week]);
    expect(waits(log).map(({ data }) => data)).toEqual([
      { for: "provider", until: "2026-10-12T13:50:00.000Z", ms: minutes },
      { for: "provider", until: "2026-10-19T13:30:00.000Z", ms: week },
    ]);
  });

  it("starts the crash rule's count again, as an ending does, and a wait on the load does not", () => {
    const crashed = (at: number): LogEvent => ({
      kind: "exam.finished",
      at: new Date(at).toISOString(),
      data: { session: `x-${String(at)}`, ended: "crashed", crash: "limit · resets 3:50pm" },
    });
    const waited = (data: LogEvent["data"]): LogEvent => ({
      kind: "campaign.waited",
      at: NOW.toISOString(),
      data,
    });
    expect(crashedRun([crashed(1), crashed(2)]).count).toBe(2);
    expect(crashedRun([crashed(1), waited({ for: "provider" }), crashed(2)]).count).toBe(1);
    expect(crashedRun([crashed(1), waited({ load: 99 }), crashed(2)]).count).toBe(2);
  });

  it("is waited out after a Builder crashed on it past its checkpoint, which the count leaves out", async () => {
    const log = logIn("kept");
    const host = hostOf(() => 0);
    const crash = (said: string) => {
      append(log, "build.checkpoint", { session: "b-1" });
      append(log, "build.finished", { session: "b-1", ended: "crashed", changed: true, crash: said });
    };
    // The network's failure of a session that moved the campaign is no crash in a row to wait for.
    crash("read ECONNRESET");
    await waitCrashed(log, host);
    expect(host.slept).toEqual([]);
    // Until 15 October its limit was not waited for either, and the next conversation opened into it.
    const reset = `limit reached|${String(Math.ceil(Date.now() / 1000) + 3600)}`;
    crash(reset);
    expect(crashedRun(read(log))).toEqual({ count: 0, crash: reset });
    await waitCrashed(log, host);
    expect(host.slept).toHaveLength(1);
    expect(waits(log)).toMatchObject([{ data: { for: "provider" } }]);
  });

  it("is waited out after any seat's session crashed on it, a draft's as a Builder's", async () => {
    // 16 October: three drafts crashed on a named reset, nothing waited, and three fresh
    // campaigns ended on their environment 33 minutes before it.
    const log = logIn("draft");
    const host = hostOf(() => 0);
    const reset = `limit reached|${String(Math.ceil(Date.now() / 1000) + 3600)}`;
    append(log, "draft.finished", { session: "d-1", tries: 0, ended: "crashed", crash: reset });
    expect(crashedRun(read(log))).toEqual({ count: 1, crash: reset });
    await waitCrashed(log, host);
    expect(host.slept).toHaveLength(1);
    expect(crashedRun(read(log)).count).toBe(0);
    // One that put a draft before it crashed moved the campaign.
    append(log, "draft.finished", { session: "d-2", tries: 1, ended: "crashed", crash: "exited 1" });
    expect(crashedRun(read(log)).count).toBe(0);
  });
});

describe("the wait after a session the network failed", () => {
  const crash = (log: string, session: string, said: string) =>
    append(log, "exam.finished", { session, ended: "crashed", crash: said, held: [] });

  it("is a minute after the first crash and five after the second, once a crash, and none before the ending", async () => {
    const log = logIn("network");
    const host = hostOf(() => 0);
    crash(log, "x-1", "getaddrinfo ENOTFOUND api.example.test");
    await waitCrashed(log, host);
    // Asked again before another session ends, as every later move asks: one wait a crash.
    await waitCrashed(log, host);
    crash(log, "x-2", "read ECONNRESET");
    await waitCrashed(log, host);
    // The third ends the campaign on its environment, and is not waited for.
    crash(log, "x-3", "connect ETIMEDOUT");
    await waitCrashed(log, host);
    expect(host.slept).toEqual([60_000, 300_000]);
    expect(crashedRun(read(log)).count).toBe(3);
    expect(waits(log).map(({ data }) => data)).toEqual([
      { for: "network", ms: 60_000 },
      { for: "network", ms: 300_000 },
    ]);
  });

  it("reads Linux's temporary DNS failure and a refused connection as the network's, and no other crash", async () => {
    const host = hostOf(() => 0);
    for (const said of [
      "getaddrinfo EAI_AGAIN api.example.test",
      "ConnectionRefused: Unable to connect",
      "exited 1",
    ]) {
      const log = logIn("network");
      crash(log, "x-1", said);
      await waitCrashed(log, host);
    }
    expect(host.slept).toEqual([60_000, 60_000]);
  });
});

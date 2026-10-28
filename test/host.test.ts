/**
 * What a campaign waits for (`tools/d2/host.ts`): the host's load before a solve, the campaign's
 * reserve and shared slots beside the solves in flight, a provider's named reset and a network
 * that failed a session. Queued solves leave on cancellation while the host's sleep remains unresolved;
 * only load waits record their elapsed time. Tests inject the host's sleeps and clock.
 */
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { resetOf } from "../src/agent/backends/claude.ts";
import { crashedRun } from "../src/campaign/ground.ts";
import { affords, flying } from "../src/campaign/opening.ts";
import { measured } from "../src/examiner/write.ts";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import type { TaskPackage } from "../src/kernel/task.ts";
import { mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import type { Kept } from "../tools/d2/campaign.ts";
import { waitOut } from "../src/solver/run.ts";
import { gated, type Host, waitCrashed } from "../tools/d2/host.ts";
import type { Campaign, Seats } from "../tools/d2/round.ts";
import { EXAMPLE, seat as examinerSeat, sweep } from "./helpers/examiner-seat.ts";

const NOW = new Date("2026-10-12T12:09:00Z");
const TASK: TaskPackage = { ...EXAMPLE, ruleIds: [], checks: "" };
const HARNESS: Kept = { dir: "", digest: "h1" };
afterAll(sweep);

const REPO = dirname(import.meta.dir);
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
function gate(log: string, host: Host, loaded = false, concurrency = 4) {
  const calls: string[] = [];
  const seat: Seats = {
    builder: null,
    setting: "s",
    solve: async (task) => {
      calls.push(task.taskId);
      return { solve: "s-1", ending: { outcome: "pass" } };
    },
  };
  // SAFETY: the host reads only these solve limits; the scripted seat reads no campaign fields.
  const campaign = { limits: { concurrency } } as Campaign;
  const seats = gated({ seated: () => seat, loaded, host }, log)(campaign, {
    builder: undefined,
    reference: "h1",
  });
  return { ...seats, calls };
}

describe("shared solve slots", () => {
  it("holds admission probes and comparison solves within the condition's shared concurrency", async () => {
    const s = examinerSeat("write", []);
    const log = s.log;
    const release = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    let running = 0;
    let peak = 0;
    let starts = 0;
    const held = gated(
      {
        loaded: true,
        host: { load: () => 0, cores: 8, waitMs: 30_000, sleep: () => release.promise },
        seated: () => ({
          builder: null,
          setting: "s",
          solve: async () => {
            starts += 1;
            running += 1;
            peak = Math.max(peak, running);
            if (running === 4) ready.resolve();
            try {
              await release.promise;
              return { solve: `s-${String(starts)}`, ending: { outcome: "pass" } };
            } finally {
              running -= 1;
            }
          },
        }),
      },
      log,
    );
    // SAFETY: the scripted seat reads no campaign fields; the host reads only its solve limits.
    const campaign = { limits: { concurrency: 4 } } as Campaign;
    const given = { builder: undefined, reference: HARNESS.dir };
    const comparison = held(campaign, given);
    const admission = held(campaign, given);
    const work = Promise.all([
      comparison.solve(TASK, HARNESS, undefined, "g-1"),
      ...Array.from({ length: 7 }, (_, index) =>
        measured(
          {
            log,
            id: "x-1",
            contract: s.request.contract,
            planted: new Set<string>(),
            probe: async (task, session, kill) =>
              (await admission.solve(task, HARNESS, kill, session)).ending,
          },
          s.request.pack({ ...EXAMPLE, taskId: `draft-${String(index)}` }),
          new AbortController().signal,
          async () => null,
        ),
      ),
    ]);
    await ready.promise;
    try {
      expect(running).toBe(4);
    } finally {
      release.resolve();
      await work;
    }
    expect(starts).toBe(22);
    expect(peak).toBe(4);
    expect(running).toBe(0);
  });
});

describe("load and reserve admission", () => {
  it("starts a solve at once on a host at or under its cores, and under --loaded on any", async () => {
    const log = logIn("idle");
    for (const [load, loaded] of [
      [4, false],
      [99, true],
    ] as const) {
      const host = hostOf(() => load);
      const seated = gate(log, host, loaded);
      await seated.solve(TASK, HARNESS, undefined);
      expect(seated.calls).toEqual([TASK.taskId]);
      expect(host.slept).toEqual([]);
    }
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

  it("reads the load again while a solve waits for a slot, and waits for it before the start", async () => {
    const log = logIn("slot-then-load");
    let load = 0;
    const free = Promise.withResolvers<void>();
    const host = hostOf(
      () => load,
      4,
      (count) => {
        if (count === 1) [load] = [99, free.resolve()];
        if (count === 3) load = 0;
      },
    );
    const held = gate(log, host, false, 1);
    const [, ended] = await Promise.all([
      flying(log, () => free.promise),
      held.solve(TASK, HARNESS, undefined, "x-1"),
    ]);
    expect(ended).toMatchObject({ ending: { outcome: "pass" } });
    expect(waits(log).map(({ data }) => data.load)).toEqual([99]);
  });

  it("holds a solve while another is in flight and the reserve is short, until the kill, and puts nothing on record", async () => {
    const log = logIn("reserve");
    append(log, "campaign.opened", { budget: { dollars: 0.7, reserve: 0.4 } });
    const kill = new AbortController();
    const reason = new Error("the reserve wait was cancelled");
    const host = hostOf(
      () => 0,
      4,
      (count) => count === 3 && kill.abort(reason),
    );
    const held = gate(log, host);
    await expect(flying(log, () => held.solve(TASK, HARNESS, kill.signal))).rejects.toBe(reason);
    expect(host.slept).toHaveLength(3);
    expect(held.calls).toEqual([]);
    await held.solve(TASK, HARNESS, new AbortController().signal);
    expect(held.calls).toEqual([TASK.taskId]);
    expect(host.slept).toHaveLength(3);
    expect(waits(log)).toEqual([]);
  });
});

describe("cancelling queued solves", () => {
  it("leaves a load, reserve or slot wait on cancellation without releasing the host's sleep", async () => {
    for (const queued of ["load", "reserve", "slot"]) {
      const log = logIn(queued);
      const kill = new AbortController();
      const reason = new Error("the queued solve was cancelled");
      const sleeping = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const host: Host = {
        load: () => (queued === "load" ? 99 : 0),
        cores: 4,
        waitMs: 30_000,
        sleep: () => {
          sleeping.resolve();
          return release.promise;
        },
      };
      if (queued === "reserve") append(log, "campaign.opened", { budget: { dollars: 0.7, reserve: 0.4 } });
      const held = gate(log, host, false, queued === "slot" ? 1 : 4);
      let now = 1000;
      const clock = spyOn(Date, "now").mockImplementation(() => now);
      try {
        const pending =
          queued === "load"
            ? held.solve(TASK, HARNESS, kill.signal, "x-1")
            : flying(log, () => held.solve(TASK, HARNESS, kill.signal));
        const deadline = AbortSignal.timeout(200);
        const bounded = Promise.race([
          pending.then(
            () => false,
            (error: unknown) => error instanceof Error && error === reason,
          ),
          new Promise<boolean>((resolve) => {
            deadline.addEventListener("abort", () => resolve(false), {
              once: true,
            });
          }),
        ]);
        await sleeping.promise;
        now += 1234;
        kill.abort(reason);
        expect(await bounded).toBe(true);
        expect(held.calls).toEqual([]);
        expect(waits(log).map(({ data }) => data)).toEqual(
          queued === "load"
            ? [
                {
                  task: TASK.taskId,
                  harness: HARNESS.digest,
                  comparison: "x-1",
                  load: 99,
                  cores: 4,
                  ms: 1234,
                },
              ]
            : [],
        );
      } finally {
        clock.mockRestore();
      }
    }
  }, 1000);

  it("starts no cancelled solve when load falls at wake or when an idle or --loaded host is already cancelled", async () => {
    for (const mode of ["falls", "idle", "loaded"]) {
      const log = logIn(mode);
      const kill = new AbortController();
      let load = mode === "idle" ? 0 : 99;
      const host = hostOf(
        () => load,
        4,
        () => {
          load = 0;
          kill.abort();
        },
      );
      if (mode !== "falls") kill.abort();
      const held = gate(log, host, mode === "loaded");
      await expect(held.solve(TASK, HARNESS, kill.signal)).rejects.toBe(kill.signal.reason);
      expect(held.calls).toEqual([]);
      expect(host.slept).toHaveLength(mode === "falls" ? 1 : 0);
      expect(waits(log)).toHaveLength(mode === "falls" ? 1 : 0);
    }
  });

  it("holds no process past a cancelled load wait on this host's own sleep", () => {
    // A process whose only solve waits five seconds a look on `HOST`, cancelled after 50 ms: it ends
    // once the wait is left, rather than when a sleep nobody waits for runs out.
    const script = `
      const { gated, HOST } = await import(${JSON.stringify(join(REPO, "tools/d2/host.ts"))});
      const seat = { builder: null, setting: "s", solve: async () => ({ solve: "s-1", ending: { outcome: "pass" } }) };
      const host = { ...HOST, load: () => 99, cores: 1, waitMs: 5000 };
      const seats = gated({ seated: () => seat, loaded: false, host }, ${JSON.stringify(logIn("exit"))})({ limits: { concurrency: 4 } }, {});
      const kill = new AbortController();
      setTimeout(() => kill.abort(), 50);
      await seats.solve({ taskId: "t" }, { dir: "", digest: "h1" }, kill.signal).catch(() => {});
    `;
    const started = performance.now();
    const ran = Bun.spawnSync({ cmd: [capturedExecPath, "-e", script], cwd: REPO });
    expect(ran.exitCode).toBe(0);
    expect(performance.now() - started).toBeLessThan(2500);
  });
});

describe("shared solve reserve", () => {
  it("counts the reserve over the solves in flight in this process, whoever started them", async () => {
    const log = logIn("reserve");
    expect(affords(log, 99)).toBe(true);
    append(log, "campaign.opened", { budget: { dollars: 1, reserve: 0.4 } });
    expect([affords(log, 2), affords(log, 3)]).toEqual([true, false]);
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
    for (const [message, reset] of [
      ["You've hit your limit · resets 3:50pm (Europe/Amsterdam)", "2026-10-12T13:50:00.000Z"],
      ["Session limit reached ∙ resets 1am (Europe/Amsterdam)", "2026-10-12T23:00:00.000Z"],
      ["Claude AI usage limit reached|1791811800", "2026-10-12T13:30:00.000Z"],
      ["weekly limit · resets Oct 15 at 9pm (Europe/Amsterdam)", "2026-10-15T19:00:00.000Z"],
    ]) {
      expect(resetOf(message!, NOW)?.toISOString()).toBe(reset);
    }
    expect(resetOf("You've hit your limit · resets 15:50", NOW)).not.toBeNull();
    for (const message of ["You've hit your limit", "socket hang up", "limit · resets 3pm (Mars/Olympus)"]) {
      expect(resetOf(message, NOW)).toBeNull();
    }
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

  it("is waited out after any seat's session crashed on it, a draft's as a Builder's", async () => {
    const log = logIn("draft");
    const host = hostOf(() => 0);
    const reset = `limit reached|${String(Math.ceil(Date.now() / 1000) + 3600)}`;
    append(log, "draft.finished", { session: "d-1", tries: 0, ended: "crashed", crash: reset });
    expect(crashedRun(read(log))).toEqual({ count: 1, crash: reset });
    await waitCrashed(log, host);
    expect(host.slept).toHaveLength(1);
    expect(crashedRun(read(log)).count).toBe(0);
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
    await waitCrashed(log, host);
    crash(log, "x-2", "read ECONNRESET");
    await waitCrashed(log, host);
    crash(log, "x-3", "connect ETIMEDOUT");
    await waitCrashed(log, host);
    expect(host.slept).toEqual([60_000, 300_000]);
    expect(crashedRun(read(log)).count).toBe(3);
    expect(waits(log).map(({ data }) => data)).toEqual([
      { for: "network", ms: 60_000 },
      { for: "network", ms: 300_000 },
    ]);
  });
});

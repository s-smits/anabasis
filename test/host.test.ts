/**
 * The provider's named reset (`resetOf` in `src/backends/claude.ts`, `waitOut` in `tools/d2/host.ts`): a usage limit that says
 * when it lifts is waited out and on record, and the crash rule counts no session before the wait.
 */
import { describe, expect, it } from "bun:test";
import { resetOf } from "../src/backends/claude.ts";
import { crashedRun } from "../src/builder/ground.ts";
import { affords, flying } from "../src/builder/opening.ts";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import { mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { waitCrashed, waitOut } from "../tools/d2/host.ts";

// 12 October, 12:09Z: 14:09 in Amsterdam.
const NOW = new Date("2026-10-12T12:09:00Z");

describe("the provider's named reset", () => {
  it("is read from a clock time in a named zone, from the host's, or from Unix seconds", () => {
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
  });

  it("is no reset where the message names none, is no limit, or names a zone the host does not know", () => {
    expect(resetOf("You've hit your limit", NOW)).toBeNull();
    expect(resetOf("socket hang up: connection reset by peer at 5", NOW)).toBeNull();
    expect(resetOf("limit reached · resets 3pm (Mars/Olympus)", NOW)).toBeNull();
  });

  it("is waited out to a minute past it and on record, where it is at most six hours on", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "ana-host-reset-")), "campaign.jsonl");
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    expect(await waitOut(log, "You've hit your limit · resets 3:50pm (Europe/Amsterdam)", sleep, NOW)).toBe(
      true,
    );
    // A week's limit, a message with no reset and a crash that is no limit are not waited for.
    expect(await waitOut(log, "Weekly limit reached|1792416600", sleep, NOW)).toBe(false);
    expect(await waitOut(log, "exited 1", sleep, NOW)).toBe(false);
    expect(await waitOut(log, null, sleep, NOW)).toBe(false);
    const minutes = 101 * 60_000 + 60_000;
    expect(slept).toEqual([minutes]);
    expect(read(log).map(({ kind, data }) => [kind, data])).toEqual([
      ["campaign.waited", { for: "provider", until: "2026-10-12T13:50:00.000Z", ms: minutes }],
    ]);
  });

  it("starts the crash rule's count again, as an ending does", () => {
    const crashed = (at: number): LogEvent => ({
      kind: "exam.finished",
      at: new Date(at).toISOString(),
      data: { session: `x-${String(at)}`, ended: "crashed", crash: "limit · resets 3:50pm" },
    });
    const waited: LogEvent = { kind: "campaign.waited", at: NOW.toISOString(), data: { for: "provider" } };
    expect(crashedRun([crashed(1), crashed(2)]).count).toBe(2);
    expect(crashedRun([crashed(1), waited, crashed(2)]).count).toBe(1);
    // A solve's wait at a loaded host is no provider's.
    const loaded: LogEvent = { kind: "campaign.waited", at: NOW.toISOString(), data: { load: 99 } };
    expect(crashedRun([crashed(1), loaded, crashed(2)]).count).toBe(2);
  });
});

describe("the wait after a session the network failed", () => {
  it("is a minute after the first crash and five after the second, starts no count, and none before the ending", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "ana-host-network-")), "campaign.jsonl");
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    const crash = (session: string, said: string) =>
      append(log, "exam.finished", { session, ended: "crashed", crash: said, held: [] });
    crash("x-1", "getaddrinfo ENOTFOUND api.example.test");
    await waitCrashed(log, sleep);
    crash("x-2", "read ECONNRESET");
    await waitCrashed(log, sleep);
    // The third ends the campaign on its environment, and is not waited for.
    crash("x-3", "connect ETIMEDOUT");
    await waitCrashed(log, sleep);
    expect(slept).toEqual([60_000, 300_000]);
    expect(crashedRun(read(log)).count).toBe(3);
    // A crash that is no network's and names no reset is not waited for.
    const other = join(mkdtempSync(join(tmpdir(), "ana-host-network-")), "campaign.jsonl");
    append(other, "exam.finished", { session: "x-1", ended: "crashed", crash: "exited 1", held: [] });
    await waitCrashed(other, sleep);
    expect(slept).toHaveLength(2);
  });
});

describe("the campaign's reserve", () => {
  it("holds the solves in flight in this process, whoever started them", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "ana-host-reserve-")), "campaign.jsonl");
    // No opening, no budget: every solve is afforded.
    expect(affords(log, 99)).toBe(true);
    append(log, "campaign.opened", { budget: { dollars: 1, reserve: 0.4 } });
    expect(affords(log, 2)).toBe(true);
    expect(affords(log, 3)).toBe(false);
    // A practice solve in flight takes one reserve from an Examiner's three (14 October).
    await flying(log, async () => {
      expect(affords(log, 2)).toBe(false);
      expect(affords(log, 1)).toBe(true);
    });
    expect(affords(log, 2)).toBe(true);
  });
});

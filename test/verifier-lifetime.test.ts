import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import * as subprocess from "../src/meta/subprocess.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import {
  closeVerifierLifetime,
  createVerifierLifetime,
  VerifierOperationalStop,
} from "../src/verify/verifier-lifetime.ts";
import { launchConfinedChild } from "../src/verify/verifier-lifetime-process.ts";
import { double } from "./helpers/doubles.ts";
import { campaignVerifierLifetime } from "../src/run/verifier-lifetime.ts";
import * as runLifetime from "../src/run/verifier-lifetime.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { campaignBudgetGate, setTurnBudget } from "../src/run/campaign-budget.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "verifier-lifetime-"));
  roots.push(root);
  const cells = join(root, "cells");
  mkdirSync(cells);
  const lifetime = createVerifierLifetime({ root: join(root, "receipts") });
  return { root, cells, lifetime };
}

describe("verifier settlement", () => {
  it.each(["normal", "held-pipe", "unreaped"] as const)(
    "bounds the actual host with a %s process boundary",
    async (mode) => {
      const f = fixture();
      const exit = Promise.withResolvers<number>();
      let release = () => {};
      const stdout = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("prefix"));
          release = () => c.close();
          if (mode !== "held-pipe") c.close();
        },
      });
      const stderr = new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      });
      const unref = spyOn({ run() {} }, "run");
      const spawn = spyOn(Bun, "spawn").mockReturnValue(
        double({ pid: 987654321, exited: exit.promise, signalCode: null, stdout, stderr, unref }),
      );
      const reap = spyOn(subprocess, "terminateAndReapProcessGroup").mockResolvedValue(mode !== "unreaped");
      try {
        const host = createVerifierHost({
          lifetime: f.lifetime,
          baseDir: f.cells,
          requireOsSandbox: false,
          inventory: {
            true: {
              id: "true",
              path: "/usr/bin/true",
              digest: sha256OfFile("/usr/bin/true"),
              source: "host",
              kind: "binary",
              interpreter: null,
            },
          },
        });
        const scope = host.openSubject({
          checks: null,
          runId: "test",
          phase: "discrimination",
          subjectId: mode,
          attempt: 1,
          artifact: {},
          publicTask: null,
        });
        const pending = scope.port.run({ toolId: "true", checkId: "c", timeoutMs: 20 });
        if (mode !== "unreaped") exit.resolve(0);
        const before = Date.now();
        const result = await pending;
        expect(Date.now() - before).toBeLessThan(3_000);
        expect(result.executed).toBe(mode === "normal");
        expect(result.exitCode).toBe(mode === "unreaped" ? null : 0);
        expect(result.signal).toBeNull();
        expect(result.evidence.stdoutBytes).toBe(6);
        expect(result.evidence.settlement?.outputComplete).toBe(mode !== "held-pipe");
        expect(host.evidence()).toHaveLength(1);
        const closed = await scope.close();
        expect(closed.cleanup?.state).toBe(mode === "unreaped" ? "pending" : "complete");
        if (mode === "unreaped") {
          expect(() => f.lifetime.assertUsable()).toThrow(VerifierOperationalStop);
          expect((await scope.port.run({ toolId: "true", checkId: "late" })).executed).toBe(false);
          expect(spawn).toHaveBeenCalledTimes(1);
          expect(unref).toHaveBeenCalledTimes(1);
          exit.resolve(0);
          await Bun.sleep(1);
          expect(host.evidence()).toHaveLength(2); // one original row, one separately bound closed-scope refusal
        }
      } finally {
        exit.resolve(0);
        if (mode === "held-pipe") {
          try {
            release();
          } catch {
            // the lock may already be released
          }
        }
        spawn.mockRestore();
        reap.mockRestore();
      }
    },
    5_000,
  );
});

describe("durable verifier ownership", () => {
  it.each([false, true])("closes the direct build fallback owner after epoch failure: %s", async (fail) => {
    const f = fixture();
    const campaign = join(f.root, "campaigns", "direct");
    mkdirSync(campaign, { recursive: true });
    setTurnBudget(campaign, 1);
    campaignBudgetGate(campaign).startAttempt("builder").complete();
    if (fail) writeFileSync(join(campaign, "epochs.json"), "broken");
    const create = spyOn(runLifetime, "campaignVerifierLifetime").mockReturnValue(f.lifetime);
    const close = spyOn(f.lifetime, "close");
    try {
      const built = buildHarness(
        { slug: "direct", domain: "truss", expectedTasks: 25 },
        { repoRoot: f.root, kickoff: "Build a truss harness." },
      );
      if (fail) await expect(built).rejects.toThrow();
      else expect((await built).adopted).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      expect(() => f.lifetime.assertUsable()).toThrow(VerifierOperationalStop);
    } finally {
      create.mockRestore();
      close.mockRestore();
    }
  });
  it.each(["campaign", "controller", "domain", "standalone-domain"] as const)(
    "blocks the next campaign on pending %s ownership",
    (kind) => {
      const f = fixture();
      const campaign = join(f.root, "campaign");
      const domain = join(f.root, "domain");
      const root = {
        campaign: join(campaign, "verifier-lifetime"),
        controller: join(campaign, "controller", "previous", "verifier-lifetime"),
        domain: join(domain, "runs", "previous", "verifier-lifetime"),
        "standalone-domain": join(domain, "verifier-lifetime"),
      }[kind];
      const owner = createVerifierLifetime({ root });
      const lease = owner.begin({ role: "tool" });
      expect(() => campaignVerifierLifetime(campaign, "next", domain)).toThrow(VerifierOperationalStop);
      expect(existsSync(lease.id)).toBe(true);
    },
  );

  it("closes direct ownership and preserves an existing primary failure", async () => {
    const f = fixture();
    f.lifetime.begin({ role: "tool" });
    await expect(closeVerifierLifetime(f.lifetime, "clean")).rejects.toBeInstanceOf(VerifierOperationalStop);
    await closeVerifierLifetime(f.lifetime, "failed");
    expect(() => f.lifetime.assertUsable()).toThrow(VerifierOperationalStop);
  });
  it("retains live or unknown groups and recovers only an exact cell, without sending a signal", async () => {
    const f = fixture();
    const cell = join(f.cells, "cell");
    mkdirSync(cell);
    const lease = f.lifetime.begin({ role: "tool", cell });
    lease.spawned(987654321);
    lease.settle({
      receiptId: lease.id,
      exit: null,
      groupReaped: false,
      outputComplete: false,
      timedOut: true,
    });
    const exists = spyOn(subprocess, "processGroupExists").mockReturnValue(true);
    const kill = spyOn(subprocess, "killProcessGroupId");
    try {
      const recovered = createVerifierLifetime({ root: join(f.root, "receipts") });
      expect(recovered.recover()).toEqual([lease.id]);
      expect(existsSync(cell)).toBe(true);
      exists.mockReturnValue(false);
      expect(recovered.recover()).toEqual([]);
      expect(existsSync(cell)).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      expect(createVerifierLifetime({ root: join(f.root, "receipts") }).pendingReceipts()).toEqual([]);
    } finally {
      exists.mockRestore();
      kill.mockRestore();
    }
  });

  it("keeps a pre-spawn intent and corrupt receipts blocked", () => {
    const f = fixture();
    const cell = join(f.cells, "cell");
    mkdirSync(cell);
    const lease = f.lifetime.begin({ role: "tool", cell });
    const restarted = createVerifierLifetime({ root: join(f.root, "receipts") });
    expect(restarted.recover()).toEqual([lease.id]);
    expect(existsSync(cell)).toBe(true);
    const path = join(lease.id, "intent.json");
    writeFileSync(path, readFileSync(path, "utf8").replace('"hostname":', '"wrong":'));
    expect(createVerifierLifetime({ root: join(f.root, "receipts") }).recover()).toEqual([lease.id]);
    expect(existsSync(cell)).toBe(true);
  });

  it.each([false, true])(
    "recovers mixed cell receipts only when the PID-less peer is settled: %s",
    async (settled) => {
      const f = fixture();
      const cell = join(f.cells, "shared");
      mkdirSync(cell);
      const noSpawn = f.lifetime.begin({ role: "tool", cell });
      const spawned = f.lifetime.begin({ role: "tool", cell });
      if (settled) {
        noSpawn.settle({
          receiptId: noSpawn.id,
          exit: null,
          groupReaped: true,
          outputComplete: true,
          timedOut: false,
        });
      }
      const child = Bun.spawn({
        cmd: ["/usr/bin/true"],
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      const kill = spyOn(subprocess, "killProcessGroupId");
      try {
        spawned.spawned(child.pid);
        expect(await child.exited).toBe(0);
        expect(subprocess.processGroupExists(child.pid)).toBe(false);
        // A controller lost after spawn leaves its actual receipt without a settlement.
        expect(await f.lifetime.close()).toContain(spawned.id);
        const recovered = createVerifierLifetime({ root: join(f.root, "receipts") });
        const pending = recovered.recover();
        expect(pending.sort()).toEqual(settled ? [] : [noSpawn.id, spawned.id].sort());
        expect(existsSync(cell)).toBe(!settled);
        expect(kill).not.toHaveBeenCalled();
        expect(
          createVerifierLifetime({ root: join(f.root, "receipts") })
            .pendingReceipts()
            .sort(),
        ).toEqual(pending.sort());
      } finally {
        kill.mockRestore();
        if (child.exitCode === null) await subprocess.terminateAndReapProcessGroup(child);
        await child.exited;
      }
    },
  );

  it("preserves a replacement cell when a recorded group disappears", () => {
    const f = fixture();
    const cell = join(f.cells, "cell");
    mkdirSync(cell);
    const lease = f.lifetime.begin({ role: "tool", cell });
    lease.spawned(987654321);
    lease.settle({
      receiptId: lease.id,
      exit: null,
      groupReaped: false,
      outputComplete: false,
      timedOut: true,
    });
    const intentPath = join(lease.id, "intent.json");
    const intent = JSON.parse(readFileSync(intentPath, "utf8"));
    intent.cell.inode += 1;
    writeFileSync(intentPath, JSON.stringify(intent));
    const absent = spyOn(subprocess, "processGroupExists").mockReturnValue(false);
    try {
      expect(createVerifierLifetime({ root: join(f.root, "receipts") }).recover()).toEqual([lease.id]);
      expect(existsSync(cell)).toBe(true);
    } finally {
      absent.mockRestore();
    }
  });

  it("reports active intents to terminal closure and prevents new admission", async () => {
    const f = fixture();
    const lease = f.lifetime.begin({ role: "evaluator" });
    expect(f.lifetime.pendingReceipts()).toEqual([lease.id]);
    expect(() => f.lifetime.assertUsable()).not.toThrow();
    expect(await f.lifetime.close()).toEqual([lease.id]);
    // Each stop carries its own sentence. Where one sentence covers them all, it is the sentence
    // written for the first, and a reader chasing "restore the host" checks the receipts and finds
    // every one settled — because the throw was this one, a begin after close. `solvability.ts`
    // carries the message into an environment-owned finding, so the wrong sentence routes as evidence.
    expect(() => f.lifetime.begin({ role: "tool" })).toThrow(/lifetime is closed/);
  });
});

describe("the confined child launcher", () => {
  const settledCleanly = {
    exit: null,
    groupReaped: true,
    outputComplete: true,
    timedOut: false,
  };

  it("starts the bundle under the policy's executable and hands back its output", async () => {
    const f = fixture();
    const cell = join(f.cells, "launch");
    mkdirSync(cell);
    const file = join(cell, "bundle.txt");
    writeFileSync(file, "bundle");
    const lease = f.lifetime.begin({ role: "evaluator", cell });
    const policy = { executable: "/bin/sh", launchArgs: ["-c", 'cat "$0"'], runtimeEnvironment: {} };
    const { child, output } = launchConfinedChild(lease, policy, { dir: cell, file }, (m) => new Error(m));
    lease.spawned(child.pid);
    await child.stdin.end();
    expect(await new Response(output.stream).text()).toBe("bundle");
    expect(await child.exited).toBe(0);
    lease.settle({ receiptId: lease.id, ...settledCleanly });
    expect(await f.lifetime.close()).toEqual([]);
  });

  it("settles the lease as unspawned and types the refusal when the executable cannot start", async () => {
    const f = fixture();
    const cell = join(f.cells, "refused");
    mkdirSync(cell);
    const lease = f.lifetime.begin({ role: "reference", cell });
    const policy = { executable: join(f.root, "absent"), launchArgs: [], runtimeEnvironment: {} };
    class Refused extends Error {}
    expect(() =>
      launchConfinedChild(lease, policy, { dir: cell, file: join(cell, "x") }, (m) => new Refused(m)),
    ).toThrow(Refused);
    // A receipt the launcher left unsettled would read as a child still owed cleanup.
    expect(await f.lifetime.close()).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { FullRunClosure } from "../src/run/full-run-deadline.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("full-run settlement failure", () => {
  const provider = (activeReservations: number) => ({
    activeReservations,
    stopNewReservations() {},
    cancelActiveTurns() {},
    async waitForIdle() {},
  });

  it("records the settlement error instead of a completed terminal when reservations remain active", async () => {
    // The finally block used to record the original cause, which was null on the success
    // path. It therefore marked the run completed even with active reservations.
    // A later retry could not correct the record because the run was already closed.
    let closedCause: Error | null | "unrecorded" = "unrecorded";
    const closure = new FullRunClosure(provider(1), (cause) => {
      closedCause = cause instanceof Error ? cause : null;
    });
    await expect(closure.settleAndClose(null)).rejects.toThrow(
      "provider reservations remained active after run settlement",
    );
    expect(errorMessage(closedCause)).toContain("provider reservations remained active after run settlement");
  });

  it("records the original null cause once no reservations remain", async () => {
    let closedCause: Error | null | "unrecorded" = "unrecorded";
    const closure = new FullRunClosure(provider(0), (cause) => {
      closedCause = cause instanceof Error ? cause : null;
    });
    await closure.settleAndClose(null);
    expect(closedCause).toBeNull();
  });

  it.each([false, true])(
    "settles providers after verifier closure fails, preserving primary failure: %s",
    async (hasPrimary) => {
      const events: string[] = [];
      const primary = hasPrimary ? new Error("primary failure") : null;
      const cleanup = new Error("verifier cleanup");
      let recorded: unknown;
      const boundary = {
        ...provider(0),
        stopNewReservations() {
          events.push("stop");
        },
        async waitForIdle() {
          events.push("idle");
        },
      };
      const closure = new FullRunClosure(
        boundary,
        (cause) => {
          recorded = cause;
          events.push("terminal");
        },
        async () => {
          events.push("verifier");
          throw cleanup;
        },
      );
      if (primary === null) await expect(closure.settleAndClose(primary)).rejects.toBe(cleanup);
      else await closure.settleAndClose(primary);
      expect(recorded).toBe(primary ?? cleanup);
      expect(events).toEqual(["stop", "verifier", "idle", "terminal"]);
      await closure.settleAndClose(primary);
      expect(events).toHaveLength(4);
    },
  );
});

describe("full-run closure first cause", () => {
  it("keeps the first SIGINT cooperative and lets the second one force a wedged controller to end", async () => {
    const closureModule = join(import.meta.dirname, "..", "src", "run", "full-run-deadline.ts");
    const script = `
      import { FullRunClosure } from ${JSON.stringify(closureModule)};
      let settlements = 0;
      const closure = new FullRunClosure({
        activeReservations: 0,
        stopNewReservations() {},
        cancelActiveTurns() {},
        async waitForIdle() {},
      }, () => {}, async () => {
        settlements++;
        console.log(JSON.stringify({ settlements }));
        await new Promise(() => {});
      });
      closure.install();
      process.kill(process.pid, "SIGINT");
      await Bun.sleep(25);
      if (settlements !== 1) throw new Error("first SIGINT did not start settlement");
      process.kill(process.pid, "SIGINT");
      await Bun.sleep(1_000);
      throw new Error("second SIGINT did not end the wedged controller");
    `;
    const child = Bun.spawn([Bun.argv[0]!, "--no-env-file", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exited = await Promise.race([child.exited, Bun.sleep(2_000).then(() => "timed-out")]);
    expect(exited).not.toBe("timed-out");
    expect(child.signalCode).toBe("SIGINT");
    expect((await new Response(child.stdout).text()).trim()).toBe('{"settlements":1}');
    expect((await new Response(child.stderr).text()).trim()).toBe("");
  });

  it.each([false, true])(
    "settles a real verifier before terminal with zero provider reservations; pending intent: %s",
    (pendingIntent) => {
      const root = mkdtempSync(join(tmpdir(), "ana-signal-verifier-"));
      roots.push(root);
      const source = join(import.meta.dirname, "..", "src");
      const script = `
      import { FullRunClosure } from ${JSON.stringify(join(source, "run/full-run-deadline.ts"))};
      import { createVerifierLifetime, superviseVerifierProcess, VerifierOperationalStop }
        from ${JSON.stringify(join(source, "verify/verifier-lifetime.ts"))};
      import { processGroupExists, terminateAndReapProcessGroup }
        from ${JSON.stringify(join(source, "meta/subprocess.ts"))};
      const lifetime = createVerifierLifetime({ root: ${JSON.stringify(join(root, "receipts"))} });
      const lease = lifetime.begin({ role: "tool" });
      const pending = ${String(pendingIntent)} ? lifetime.begin({ role: "evaluator" }).id : null;
      const child = Bun.spawn(["/bin/sleep", "30"], {
        detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore",
      });
      lease.spawned(child.pid);
      const supervised = superviseVerifierProcess(child, lease, { drained: Promise.resolve(), cancel() {} }, 30_000);
      let settlements = 0;
      let releaseSettlement;
      const settling = new Promise(resolve => { releaseSettlement = resolve; });
      const terminals = [];
      const provider = { activeReservations: 0, stopNewReservations() {}, cancelActiveTurns() {}, async waitForIdle() {} };
      const closure = new FullRunClosure(provider, (cause) => {
        terminals.push({ cause: String(cause), pending: lifetime.pendingReceipts(), alive: processGroupExists(child.pid) });
      }, async () => {
        settlements++;
        const remaining = await lifetime.close();
        await settling;
        if (remaining.length) throw new VerifierOperationalStop("unsettled-children", remaining);
      });
      closure.install();
      try {
        process.kill(process.pid, "SIGTERM");
        await supervised.done;
        process.kill(process.pid, "SIGTERM");
        await Bun.sleep(20);
        const beforeUnwind = terminals.length;
        const closing = [closure.settleAndClose(closure.stopRequested()), closure.settleAndClose(closure.stopRequested())];
        process.kill(process.pid, "SIGTERM");
        await Bun.sleep(20);
        const duringSettlement = terminals.length;
        releaseSettlement();
        await Promise.all(closing);
        await closure.settleAndClose(null);
        const reloaded = createVerifierLifetime({ root: ${JSON.stringify(join(root, "receipts"))} });
        console.log(JSON.stringify({ settlements, beforeUnwind, duringSettlement, terminals, pending, reloaded: reloaded.pendingReceipts() }));
      } finally {
        await terminateAndReapProcessGroup(child);
        await child.exited;
      }
    `;
      const child = Bun.spawnSync([Bun.argv[0]!, "--no-env-file", "-e", script], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      });
      expect(child.stderr.toString()).toBe("");
      expect(child.exitCode).toBe(0);
      const result = JSON.parse(child.stdout.toString());
      expect(result).toMatchObject({
        settlements: 1,
        beforeUnwind: 0,
        duringSettlement: 0,
        terminals: [{ cause: "ControllerSignalAbort: fullrun received SIGTERM", alive: false }],
      });
      expect(result.terminals).toHaveLength(1);
      expect(result.terminals[0].pending).toEqual(pendingIntent ? [result.pending] : []);
      expect(result.reloaded).toEqual(pendingIntent ? [result.pending] : []);
    },
  );
});

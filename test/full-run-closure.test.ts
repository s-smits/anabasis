/**
 * Closing a controller run: the terminal a closure records, the settlement order when the verifier
 * or a provider reservation is still live, the operator's signals, and the cancellation of every
 * active model turn and confined Built worker with its spent usage kept.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { closeControllerRun } from "../src/run/full-run-close.ts";
import { FullRunClosure } from "../src/run/full-run-deadline.ts";
import type { ControllerRunState } from "../src/run/controller-evidence.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import type { AgentSession, AgentTurnResult, RunTurnOptions } from "../src/backends/backend-types.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { PiBuiltWorkerNonResult, startPiBuiltWorker } from "../src/backends/pi-built-process.ts";
import type { PiBuiltRuntime } from "../src/backends/pi-built.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { ProviderResourceBudget, runBudgetedAgentTurn } from "../src/run/provider-resource-budget.ts";
import { builtAgentInterface, starterRegistration } from "../src/solve/built-starter.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/correctness-bundle/harness-config.ts";
import { double } from "./helpers/doubles.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["success", "failure", "unsettled"] as const)(
  "records verifier cleanup without replacing %s closure",
  (mode) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "full-run-close-"));
    roots.push(repoRoot);
    mkdirSync(join(repoRoot, "campaigns", "project", "controller", "test"), { recursive: true });
    const lifetime = createVerifierLifetime({ root: join(repoRoot, "receipts") });
    const receipt = mode === "unsettled" ? null : lifetime.begin({ role: "tool" }).id;
    let released = false;
    const state: ControllerRunState = {
      opening: { digest: "opening", epoch: double({ key: "epoch-aaaaaaaaaaaa" }), runId: "test" },
      iterations: [],
      absentSteps: [],
      verifierLifetime: lifetime,
    };
    closeControllerRun(
      repoRoot,
      double({
        project: { id: "project" },
        campaignLockToken: "lock",
        ownsLock: () => true,
        release() {
          released = true;
        },
      }),
      state,
      mode === "failure" ? new Error("primary failure") : null,
    );
    const terminal = JSON.parse(
      readFileSync(join(repoRoot, "campaigns", "project", "controller", "test", "terminal.json"), "utf8"),
    );
    expect(released).toBe(true);
    if (mode === "unsettled") expect(terminal.verifierCleanup).toBeUndefined();
    else {
      expect(terminal.verifierCleanup).toEqual({ state: "pending", receiptIds: [receipt] });
      expect(terminal.outcome).toBe("aborted");
      expect(terminal.terminalReason).toContain(
        mode === "failure" ? "primary failure" : "verifier process cleanup",
      );
    }
  },
);

describe("full-run settlement failure", () => {
  const provider = (activeReservations: number) => ({
    activeReservations,
    stopNewReservations() {},
    cancelActiveTurns() {},
    async waitForIdle() {},
  });

  // Recording the original cause would mark a run completed on the success path while a reservation
  // was still active, and a later retry cannot correct a run that is already closed.
  it.each([
    [1, "provider reservations remained active after run settlement"],
    [0, null],
  ])("with %d active reservations records the cause %p", async (active, message) => {
    let closedCause: Error | null | "unrecorded" = "unrecorded";
    const closure = new FullRunClosure(provider(active), (cause) => {
      closedCause = cause instanceof Error ? cause : null;
    });
    if (message === null) {
      await closure.settleAndClose(null);
      expect(closedCause).toBeNull();
    } else {
      await expect(closure.settleAndClose(null)).rejects.toThrow(message);
      expect(errorMessage(closedCause)).toBe(message);
    }
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

it.each(["builder", "review"] as const)(
  "cancels the active %s consumer and keeps its spent usage",
  async (role) => {
    const budget = new ProviderResourceBudget(3);
    const entered = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<AgentTurnResult>();
    let seen: RunTurnOptions | undefined;
    let disposed = 0;
    const session: HostSession = {
      backend: "codex",
      configure() {},
      sessionId: "pi-test",
      async runTurn(options) {
        seen = options;
        const onAbort = () => {
          options.onEvent?.({
            type: "turn_ended",
            usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, costUsd: null },
          });
          finished.resolve({ status: "aborted" });
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        entered.resolve();
        try {
          return await finished.promise;
        } finally {
          options.signal?.removeEventListener("abort", onAbort);
        }
      },
      async dispose() {
        disposed += 1;
      },
    };
    const workspace = mkdtempSync(join(tmpdir(), "ana-cancel-builder-"));
    const pending =
      role === "review"
        ? runBudgetedAgentTurn(session, { prompt: "review" }, budget, role)
        : runBuilderSession(
            { slug: "cancel", kickoff: "build", workspace, maxTurns: 1 },
            {
              open: async () => session,
              tools: [],
              providerBudget: budget,
              submit: () => {
                throw new Error("cancelled turn must not submit");
              },
            },
          );
    const settled = Promise.allSettled([pending]);
    try {
      await entered.promise;
      expect(seen?.signal).toBeDefined();
      const cause = new Error("controller stop");
      budget.cancelActiveTurns(cause);
      budget.cancelActiveTurns(new Error("later stop"));
      expect(seen?.signal?.reason).toBe(cause);
      await settled;
      rmSync(workspace, { recursive: true, force: true });
      await budget.waitForIdle();
      expect(budget.terminalSnapshot()).toMatchObject({
        used: 1,
        active: 0,
        byRole: { [role]: 1 },
        usage: { reportedTurns: 1, unreportedTurns: 0, totalTokens: 12, costUsd: null },
      });
      expect(() => budget.assertAvailable("built")).toThrow(cause);
      if (role === "builder") expect(disposed).toBe(1);
    } finally {
      finished.resolve({ status: "aborted" });
      await settled;
    }
  },
);

it("refuses an already cancelled session call without reserving a turn", async () => {
  const budget = new ProviderResourceBudget(1);
  const caller = new AbortController();
  const cause = new Error("caller closed before readiness");
  caller.abort(cause);
  let started = false;
  const session: AgentSession = {
    backend: "codex",
    async runTurn() {
      started = true;
      return { status: "completed" };
    },
    async dispose() {},
  };
  await expect(
    runBudgetedAgentTurn(session, { prompt: "closed", signal: caller.signal }, budget, "review"),
  ).rejects.toBe(cause);
  expect(started).toBe(false);
  expect(budget.snapshot()).toMatchObject({ used: 0, active: 0 });
});

it("controller TERM cancels an active reservation and records the original signal cause", () => {
  const closurePath = join(import.meta.dir, "../src/run/full-run-deadline.ts");
  const budgetPath = join(import.meta.dir, "../src/run/provider-resource-budget.ts");
  const child = Bun.spawnSync(
    [
      Bun.argv[0]!,
      "--no-env-file",
      "-e",
      `
    import { FullRunClosure } from ${JSON.stringify(closurePath)};
    import { ProviderResourceBudget, runBudgetedAgentTurn } from ${JSON.stringify(budgetPath)};
    const budget = new ProviderResourceBudget(2);
    let terminal;
    const closure = new FullRunClosure(budget, (cause) => {
      terminal = { name: cause.name, message: cause.message, budget: budget.terminalSnapshot() };
    });
    closure.install();
    const turn = runBudgetedAgentTurn({
      backend: "codex", abort() {}, async dispose() {},
      runTurn(options) {
        return new Promise(resolve => options.signal.addEventListener("abort", () => {
          resolve({ status: "aborted" });
        }, { once: true }));
      }
    }, { prompt: "active" }, budget, "review");
    process.kill(process.pid, "SIGTERM");
    await turn;
    await closure.settleAndClose(new Error("later settlement"));
    console.log(JSON.stringify(terminal));
  `,
    ],
    { stdout: "pipe", stderr: "pipe", timeout: 5_000 },
  );
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toMatchObject({
    name: "ControllerSignalAbort",
    message: "fullrun received SIGTERM",
    budget: { used: 1, active: 0, usage: { unreportedTurns: 1 } },
  });
});

it("cancels and reaps a confined Built worker which ignores TERM, settling its active permit", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-cancel-worker-")));
  const file = join(dir, "worker.cjs");
  const source = `
process.on("SIGTERM", () => {});
setInterval(() => {}, 60000);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let end;
  while ((end = input.indexOf("\\n")) >= 0) {
    const message = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    if (message.type === "start") {
      process.stdout.write(JSON.stringify({ type: "ready", workerInstanceId: message.workerInstanceId,
        pid: process.pid, promptDigest: message.contract.promptDigest, toolSchemaDigest: message.contract.toolSchemaDigest,
        modelSelection: { source: "faux-provider", resolvedModel: message.profile.model, effort: "off" } }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "turn_permit_request", turn: 1 }) + "\\n");
    }
  }
});
`;
  writeFileSync(file, source);
  const budget = new ProviderResourceBudget(2);
  const entered = Promise.withResolvers<void>();
  const runtime: PiBuiltRuntime = {
    profile: { provider: "openrouter", transport: "openrouter", model: "faux-cancel", thinkingLevel: "off" },
    auth: async () => ({ type: "api_key", key: "fake" }),
    policy: builtSolveIsolation(runtimeProcess.cwd()),
    fakeResponses: [],
  };
  const worker = startPiBuiltWorker({
    runtime,
    bundle: {
      dir,
      file,
      digest: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
    },
    start: {
      type: "start",
      profile: runtime.profile,
      credential: await runtime.auth(),
      contract: builtAgentInterface([], starterRegistration([]), null, DEFAULT_HARNESS_SETTINGS.solveMs),
      prompt: "",
      nudge: "",
      maxTurns: 1,
      fakeResponses: [],
    },
    conditionDigest: "cancellation-fixture",
    tools: new Map(),
    onMessage: () => {},
    reserveTurn: () => {
      const reservation = budget.reserve("built");
      entered.resolve();
      return reservation;
    },
    signal: budget.cancellationSignal,
  });
  const result = worker.catch((error: unknown) => {
    if (!(error instanceof Error)) throw error;
    return error;
  });
  const cleanup = setTimeout(() => budget.cancelActiveTurns(new Error("fixture wall")), 10_000);
  try {
    await Promise.race([entered.promise, worker]);
    expect(budget.activeReservations).toBe(1);
    budget.cancelActiveTurns(new Error("operator stopped"));
    const error = await result;
    expect(error).toBeInstanceOf(PiBuiltWorkerNonResult);
    if (!(error instanceof PiBuiltWorkerNonResult)) throw new Error("worker did not cancel");
    expect(error.message).toContain("controller cancelled");
    const pid = error.modelWorker.confinedPid;
    expect(pid).toBeGreaterThan(1);
    if (pid === null) throw new Error("worker identity missing");
    expect(() => runtimeProcess.kill(pid, 0)).toThrow();
    await budget.waitForIdle();
    expect(budget.terminalSnapshot()).toMatchObject({
      used: 1,
      active: 0,
      byRole: { built: 1 },
      usage: { reportedTurns: 0, unreportedTurns: 1 },
    });
  } finally {
    clearTimeout(cleanup);
    budget.cancelActiveTurns(new Error("fixture cleanup"));
    await result;
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

import { expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { AgentSession, AgentTurnResult, RunTurnOptions } from "../src/backends/backend-types.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { PiBuiltWorkerNonResult, startPiBuiltWorker } from "../src/backends/pi-built-process.ts";
import type { PiBuiltRuntime } from "../src/backends/pi-built.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { ProviderResourceBudget, runBudgetedAgentTurn } from "../src/run/provider-resource-budget.ts";
import { builtAgentInterface, starterRegistration } from "../src/solve/built-starter.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";

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

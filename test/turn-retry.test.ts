/**
 * What a Builder turn does when the provider, not the task, ended it.
 *
 * Three shapes, one question each. A transport failure that produced no build output is run again
 * on a growing ladder (run53-sol-0903 and run55-sol-0903 on an unrefreshable access token,
 * truss-run12-sol-0903 on the per-turn settle cap during a host outage: each ended the whole run on
 * its first failed turn). A refusal that no wait clears spends no wait at all
 * (opus-20260905T065506215Z sat through 17 minutes of ladder on a disabled organisation). And
 * a limit that names when it clears waits for that instant, because the ladder cannot reach it:
 * campaign 3fd52f9e-28 ended twice on 2026-09-17, at 07:33 against "resets 12pm (Europe/Amsterdam)"
 * and at 12:36 against "resets 6:30pm", each time abandoning a live campaign hours early.
 *
 * Every case drives the real `runBuilderTurn` against a scripted session, so the retry owner, the
 * recorded rows and the typed non-result are the production ones.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, AgentTurnResult, RunTurnOptions } from "../src/backends/backend-types.ts";
import { BuildAgentTurnNonResult } from "../src/author/build-agent.ts";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import { runBuilderTurn, type BuilderTurnState } from "../src/author/builder-turn-loop.ts";
import {
  PERMANENT_REFUSAL,
  PROVIDER_RESET_MARGIN_MS,
  TURN_RETRY_BACKOFF_MS,
} from "../src/author/turn-retry.ts";
import { allowanceWait, providerResetAt } from "../src/truth/provider-reset.ts";
import { ProviderResourceBudget } from "../src/run/provider-resource-budget.ts";
import { ControllerSignalAbort, controllerAbortClause } from "../src/run/controller-abort-clause.ts";

/** The wording run53 and run55 both ended on. No canonical matcher recognises it, which is why the
 *  retry is decided on the turn's outcome rather than on prose. */
const TOKEN_REFRESH =
  "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.";
const SETTLE_CAP = "per-turn settle cap 3600000 ms elapsed before turn/completed; turn interrupted";

const NO_CALLS: NonNullable<AgentTurnResult["toolCalls"]> = {
  byName: {},
  failedByName: {},
  failed: 0,
  total: 0,
};
const failed = (...errorMessages: string[]): AgentTurnResult => ({
  status: "failed",
  errorMessages,
  toolCalls: NO_CALLS,
});
const completed = (): AgentTurnResult => ({
  status: "completed",
  assistantText: "authored",
  toolCalls: NO_CALLS,
});

function freshState(): BuilderTurnState {
  return {
    accepted: null,
    attempts: 0,
    lastRefusal: [],
    activeTurn: 0,
    terminal: false,
    terminalClause: null,
    idleTurns: 0,
  };
}

/** One scripted Builder turn: the recorded prompts and waits are what the assertions read. */
function turnUnderTest(replies: (attempt: number) => AgentTurnResult) {
  const prompts: string[] = [];
  const waits: number[] = [];
  const recorder = new BuilderExecutionRecorder();
  let attempts = 0;
  const session: AgentSession = {
    backend: "codex",
    runTurn: async (options: RunTurnOptions) => {
      prompts.push(options.prompt);
      attempts += 1;
      return replies(attempts);
    },
    dispose: async () => {},
  };
  const input = {
    session,
    state: freshState(),
    recorder,
    prompt: "build",
    kickoff: "Build the thing.",
    turn: 1,
    onTurnEvent: () => {},
    checkpoint: () => {},
    maxTurns: 8,
    openedAtMs: Date.now(),
    authoring: { workspace: "/nonexistent-workspace", paths: [], openingIdentity: "opening" },
    waitMs: async (ms: number): Promise<void> => {
      waits.push(ms);
    },
  };
  return {
    input,
    prompts,
    waits,
    recorder,
    attempts: () => attempts,
    run: () => runBuilderTurn(input),
    /** The error `runBuilderTurn` raised, for the cases that end the run. A turn that returned, or
     *  a throwable that is not an Error, is the case failing rather than a value to assert on. */
    failure: async (overrides: Partial<Parameters<typeof runBuilderTurn>[0]> = {}): Promise<Error> => {
      try {
        await runBuilderTurn({ ...input, ...overrides });
      } catch (cause) {
        if (cause instanceof Error) return cause;
        throw cause;
      }
      throw new Error("the turn returned instead of ending the run");
    },
  };
}

describe("a Builder turn the provider ended with no build output", () => {
  it("runs the same turn again on a growing wait, and continues from the attempt that worked", async () => {
    const turn = turnUnderTest((attempt) =>
      attempt === 1
        ? failed(TOKEN_REFRESH)
        : attempt === 2
          ? { ...failed(SETTLE_CAP), status: "aborted" }
          : completed(),
    );
    const next = await turn.run();

    expect(turn.attempts()).toBe(3);
    // The same turn with the same prompt: a retry leaves the session and its workspace untouched.
    expect(new Set(turn.prompts)).toEqual(new Set(["build"]));
    expect(turn.waits).toEqual([TURN_RETRY_BACKOFF_MS[0], TURN_RETRY_BACKOFF_MS[1]]);
    expect(turn.input.state.terminal).toBe(false);
    expect(next.prompt).not.toContain("without live-testing");

    const rows = turn.recorder.finish("recorded").turnRetries;
    expect(rows).toMatchObject([
      { role: "builder", turn: 1, attempt: 1, of: 3, status: "failed", waitMs: TURN_RETRY_BACKOFF_MS[0] },
      { role: "builder", turn: 1, attempt: 2, of: 3, status: "aborted", waitMs: TURN_RETRY_BACKOFF_MS[1] },
    ]);
    expect(rows?.[0]?.reason).toContain("access token could not be refreshed");
    expect(rows?.[1]?.reason).toContain("per-turn settle cap");
  });

  it("ends the run on the same clause once the ladder is spent", async () => {
    const turn = turnUnderTest(() => failed(TOKEN_REFRESH));
    const failure = await turn.failure();

    expect(turn.attempts()).toBe(TURN_RETRY_BACKOFF_MS.length + 1);
    expect(turn.waits).toEqual([...TURN_RETRY_BACKOFF_MS]);
    expect(failure).toBeInstanceOf(BuildAgentTurnNonResult);
    expect(failure.message).toContain("build agent turn failed (role builder)");
    expect(failure.message).toContain("turn produced no build output");
    expect(controllerAbortClause(failure)).toBe("environment-blocked");
    expect(turn.recorder.finish("turn-non-result").turnRetries).toHaveLength(3);
  });

  it("retries a bare 429 that claims no allowance at all", async () => {
    const turn = turnUnderTest((attempt) =>
      attempt === 1 ? failed("api_error status 429: rate limit exceeded; retry later") : completed(),
    );
    await turn.run();
    expect(turn.attempts()).toBe(2);
    expect(turn.waits).toEqual([TURN_RETRY_BACKOFF_MS[0]]);
  });
});

describe("a refusal the run cannot wait out", () => {
  it.each([
    [
      "an administrator's to clear",
      "api_error status 403: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
    ],
    [
      "a monthly allowance naming no clock",
      "api_error status 429: You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
    ],
    // A weekly allowance names a calendar date, so no clock resolves and the run ends as before.
    [
      "a weekly allowance naming a date",
      "api_error status 429: You've hit your weekly limit · resets Sep 12 at 8am (Europe/Amsterdam)",
    ],
  ])("spends no wait on %s", async (_refusal, message) => {
    const turn = turnUnderTest(() => failed(message));
    const failure = await turn.failure();

    expect(turn.attempts()).toBe(1);
    expect(turn.waits).toEqual([]);
    expect(failure).toBeInstanceOf(BuildAgentTurnNonResult);
    expect(controllerAbortClause(failure)).toBe("environment-blocked");
    expect(turn.recorder.finish("turn-non-result").turnRetries).toEqual([]);
  });

  it("spends no wait when a second allowance beside a clocked one names no clock", async () => {
    // One turn can carry both: the session limit says it clears at noon, the monthly spend limit
    // says to raise it at claude.ai/settings/usage and clears on no clock at all. Until 2026-09-20
    // one clause was read across the whole list, so noon spoke for both and the run slept the
    // hours to it before meeting the same monthly limit unchanged.
    const turn = turnUnderTest(() =>
      failed(
        "api_error status 429: You've hit your session limit · resets 12pm (Europe/Amsterdam)",
        "api_error status 429: You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
      ),
    );
    const failure = await turn.failure();

    expect(turn.waits).toEqual([]);
    expect(turn.attempts()).toBe(1);
    expect(controllerAbortClause(failure)).toBe("environment-blocked");
  });

  it("spends no wait once the provider budget can admit no further turn", async () => {
    const turn = turnUnderTest(() => failed(TOKEN_REFRESH));
    // The one admitted turn is the failed one, so the retry is refused before it waits and the
    // budget owns the terminal instead of the transport.
    await expect(
      runBuilderTurn({ ...turn.input, providerBudget: new ProviderResourceBudget(1) }),
    ).rejects.toMatchObject({
      kind: "provider-resource-budget-exhausted",
    });
    expect(turn.waits).toEqual([]);
  });

  it("keeps the token-refresh wording out of the permanent set", () => {
    expect(PERMANENT_REFUSAL.test(TOKEN_REFRESH)).toBe(false);
  });
});

describe("a session limit that says when it clears", () => {
  it.each([
    "api_error status 429: You've hit your session limit · resets 5:50am (Europe/Amsterdam)",
    "Claude Code returned an error result: You've hit your limit · resets 4pm (Europe/Amsterdam)",
  ])("waits for the provider's own clock: %s", async (message) => {
    const turn = turnUnderTest((attempt) => (attempt === 1 ? failed(message) : completed()));
    await turn.run();

    expect(turn.attempts()).toBe(2);
    // The wait is the provider's number, not a step of the ladder: past the margin, under a day.
    const waited = turn.waits[0] ?? 0;
    expect(waited).toBeGreaterThan(PROVIDER_RESET_MARGIN_MS);
    expect(waited).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + PROVIDER_RESET_MARGIN_MS);
    expect(TURN_RETRY_BACKOFF_MS).not.toContain(waited);
    // The row carries the real wait and the provider's words, so the run records why it slept.
    const row = turn.recorder.finish("recorded").turnRetries?.[0];
    expect(row).toMatchObject({ attempt: 1, of: 3, waitMs: waited });
    expect(row?.reason).toContain("resets");
  });

  it("ends the wait when the controller stops during it, on the operator's own clause", async () => {
    const budget = new ProviderResourceBudget(8);
    const turn = turnUnderTest(() =>
      failed("api_error status 429: You've hit your session limit · resets 4pm (Europe/Amsterdam)"),
    );
    // The stop arrives inside the wait, which for a reset is most of the hours it covers. Before
    // this the gates were asked only on the way in, so the run slept to the provider's clock first.
    const waitMs = async (ms: number) => {
      turn.waits.push(ms);
      budget.cancelActiveTurns(new ControllerSignalAbort("SIGTERM"));
    };
    const failure = await turn.failure({ providerBudget: budget, waitMs });

    expect(controllerAbortClause(failure)).toBe("signal-terminated");
    // One wait entered and one left: the ladder's remaining attempts are never opened.
    expect(turn.waits).toHaveLength(1);
    expect(turn.attempts()).toBe(1);
  });

  it("leaves no timer running, so the stopped run's process can exit", async () => {
    // Every case above injects `waitMs`, which replaces the very thing that holds the process
    // open, so the default wait was never exercised. Resolving the race is not enough: a
    // `Bun.sleep(8_000)` raced against an abort at 200 ms returns at 201 ms and exits at 8002 ms,
    // where a timer the abort clears exits at 201 ms. A run stopped during a wait until a
    // provider-named reset would sit on a live timer to that reset, hours after terminal.json.
    const dir = mkdtempSync(join(tmpdir(), "ana-turn-retry-exit-"));
    const fixture = join(dir, "stopped-wait.ts");
    const root = join(import.meta.dir, "..");
    writeFileSync(
      fixture,
      [
        `import { ProviderResourceBudget } from ${JSON.stringify(join(root, "src/run/provider-resource-budget.ts"))};`,
        `import { awaitTurnRetry } from ${JSON.stringify(join(root, "src/author/turn-retry.ts"))};`,
        `import { BuilderExecutionRecorder } from ${JSON.stringify(join(root, "src/author/builder-execution.ts"))};`,
        `import { ControllerSignalAbort } from ${JSON.stringify(join(root, "src/run/controller-abort-clause.ts"))};`,
        "const budget = new ProviderResourceBudget(8);",
        'setTimeout(() => { budget.cancelActiveTurns(new ControllerSignalAbort("SIGTERM")); }, 200);',
        // The ladder's first step is two minutes: long enough that a leaked timer is unmistakable,
        // short enough that this test fails in seconds rather than in the hours a reset would take.
        'await awaitTurnRetry({ role: "builder", turn: 1, recorder: new BuilderExecutionRecorder(0), providerBudget: budget }, 0, "failed", ["api_error status 429"])',
        "  .catch(() => undefined);",
        "",
      ].join("\n"),
    );
    const started = Date.now();
    const exited = await Bun.spawn(["bun", fixture], { stdout: "ignore", stderr: "ignore" }).exited;
    const elapsed = Date.now() - started;
    rmSync(dir, { recursive: true, force: true });

    expect(exited).toBe(0);
    // Under the defect this is TURN_RETRY_BACKOFF_MS[0], two minutes.
    expect(elapsed).toBeLessThan(15_000);
  }, 140_000);

  it("still ends the run when the clock arrives and the provider refuses again", async () => {
    const turn = turnUnderTest(() =>
      failed("api_error status 429: You've hit your session limit · resets 4pm (Europe/Amsterdam)"),
    );
    expect(controllerAbortClause(await turn.failure())).toBe("environment-blocked");
    // Three attempts bound the reset waits exactly as they bound the ladder: no new counter.
    expect(turn.waits).toHaveLength(TURN_RETRY_BACKOFF_MS.length);
  });
});

describe("the reset time a provider names", () => {
  it("resolves the clause campaign 3fd52f9e-28 died on, in the zone it names", () => {
    // 07:33:23Z on 2026-09-17 is 09:33 in Amsterdam, so noon there is 10:00Z — two and a half hours
    // later. The run ended instead, and three further authoring rounds opened against a dead provider.
    const limit = "api_error status 429: You've hit your session limit · resets 12pm (Europe/Amsterdam)";
    expect(providerResetAt(limit, new Date("2026-09-17T07:33:23Z"))?.toISOString()).toBe(
      "2026-09-17T10:00:00.000Z",
    );
    expect(
      providerResetAt(
        "... limit · resets 6:30pm (Europe/Amsterdam)",
        new Date("2026-09-17T12:36:11Z"),
      )?.toISOString(),
    ).toBe("2026-09-17T16:30:00.000Z");
  });

  it("takes the clock's next occurrence when today's has passed", () => {
    // 12:36Z is 14:36 in Oslo, so 1:30am is tomorrow's — 23:30Z, still under a day away.
    expect(
      providerResetAt("resets 1:30am (Europe/Oslo)", new Date("2026-09-17T12:36:00Z"))?.toISOString(),
    ).toBe("2026-09-17T23:30:00.000Z");
  });

  it("reads each clock from the allowance that named it", () => {
    const now = new Date("2026-09-17T07:33:23Z");
    const noon = "api_error status 429: You've hit your session limit · resets 12pm (Europe/Amsterdam)";
    const spend =
      "api_error status 429: You've hit your monthly spend limit · raise it at claude.ai/settings/usage";

    // An allowance naming no clock refuses, whatever a clause beside it says.
    expect(allowanceWait([noon, spend], now)).toMatchObject({ refuse: true });
    expect(allowanceWait([spend], now)).toMatchObject({ refuse: true, at: null });
    // Where several allowances name clocks, work resumes when the last of them lifts, not the first.
    expect(
      allowanceWait([noon, "You've hit your session limit · resets 4pm (Europe/Amsterdam)"], now),
    ).toMatchObject({ refuse: false, at: new Date("2026-09-17T14:00:00.000Z") });
    // A transport failure is no allowance, so the caller keeps its ordinary ladder.
    expect(allowanceWait(["api_error status 429: too many requests; retry later"], now)).toMatchObject({
      refuse: false,
      at: null,
    });
  });

  it("resolves nothing it cannot sleep on", () => {
    const now = new Date("2026-09-17T12:36:00Z");
    // Read as a bare clock, a dated allowance would sleep until tomorrow morning for a limit that
    // clears in days.
    expect(
      providerResetAt("You've hit your weekly limit · resets Sep 12 at 8am (Europe/Amsterdam)", now),
    ).toBeNull();
    expect(
      providerResetAt("You've hit your monthly spend limit · raise it at claude.ai/settings/usage", now),
    ).toBeNull();
    expect(providerResetAt("Your organization has disabled Claude subscription access", now)).toBeNull();
    expect(providerResetAt("resets soon (Mars/Olympus_Mons)", now)).toBeNull();
  });
});

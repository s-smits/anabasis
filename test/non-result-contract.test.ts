/**
 * The typed non-result contract, in one place: which kinds exist and survive the read boundary,
 * who owns a failed tool run, which wording routes a dead provider out of the score, and what
 * counts as evidence that a tool failed.
 *
 * Every matcher case here is a recorded regression. The shape they share is that a provider or
 * transport failure was read as a task failure — or the reverse, a solver's own prose read as an
 * outage — and either direction moves a capability rate that is meant to mean something.
 */
import { describe, expect, it } from "bun:test";
import {
  ENVIRONMENT_OWNED_NONRESULT_KINDS,
  NON_RESULT_KINDS,
  type NonResultKind,
  isNonResultKind,
} from "../src/claim/record-events.ts";
import {
  VERIFIER_EXECUTION_NON_RESULT_KINDS,
  type VerifierExecutionNonResultKind,
} from "../src/verify/correctness-model-result.ts";
import {
  CODEX_THREAD_OPEN_FATAL,
  PROVIDER_ALLOWANCE,
  RUNTIME_NON_RESULT_MESSAGE,
  runtimeNonResultReason,
  solverNonResultReason,
} from "../src/truth/runtime-blocker.ts";
import { providerResetAt } from "../src/truth/provider-reset.ts";
import {
  ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS,
  VerifierExecutionNonResult,
  environmentOwnedToolNonResult,
} from "../src/truth/verifier-nonresult.ts";
import { hostNonResult, subjectRuns } from "../src/truth/tool-runs.ts";
import type { VerifierExecutionEvidence, VerifierHostHandle } from "../src/verify/verifier-port.ts";
import { double } from "./helpers/doubles.ts";

// Each negative pin is expected to remain a type error. If a retired spelling returns to the
// append contract, TypeScript reports an unused directive and the repository typecheck fails.
// @ts-expect-error `interrupted` is a run/process disposition, never a case-level non-result.
const interruptedCase: NonResultKind = "interrupted";
// @ts-expect-error the live verifier contract uses `verifierUnavailable`.
const legacyVerifierSpelling: NonResultKind = "verifier-unavailable";
// @ts-expect-error no case producer or consumer owns `keyless`.
const unownedKeyless: NonResultKind = "keyless";
// @ts-expect-error the Builder-declared engine wire is gone; a tool the host could not read is
// `verifierUnavailable`, and one that ran and died is `crash`.
const retiredEngineKind: NonResultKind = "engine-unavailable";

describe("the case non-result vocabulary", () => {
  it("is the producer list the evaluator and verifier host share, in order", () => {
    // `satisfies` is the pin: a kind added to or dropped from the union fails the typecheck here,
    // so the runtime export and the compile-time union cannot drift apart.
    const producers = [
      "solver",
      "runtime",
      "verifier-throw",
      "verifier",
      "provider",
      "transport",
      "verifierUnavailable",
      "sandbox",
      "timeout",
      "crash",
      "protocol",
    ] as const satisfies readonly NonResultKind[];
    expect([...NON_RESULT_KINDS]).toEqual([...producers]);
  });

  it("keeps the verifier relay vocabulary a subset of the case vocabulary", () => {
    // evaluator.ts is a size-frozen copied file, so the runtime spelling lives here instead.
    const relayed = [
      "provider",
      "transport",
      "verifierUnavailable",
      "sandbox",
      "timeout",
      "crash",
      "protocol",
    ] as const satisfies readonly VerifierExecutionNonResultKind[];
    const cases = new Set<string>(NON_RESULT_KINDS);
    for (const kind of relayed) expect(cases.has(kind)).toBe(true);
  });

  it.each([...NON_RESULT_KINDS])("admits %s at the read boundary", (kind) => {
    expect(isNonResultKind(kind)).toBe(true);
  });

  it.each(
    [
      // The retired spellings above, plus the shapes an unvalidated JSON read hands in.
      interruptedCase,
      legacyVerifierSpelling,
      unownedKeyless,
      retiredEngineKind,
      "SOLVER",
      "solver ",
      "",
      42,
      null,
      undefined,
      ["solver"],
    ].map((hostile) => ({ hostile })),
  )("refuses %j at the read boundary", ({ hostile }) => {
    expect(isNonResultKind(hostile)).toBe(false);
  });

  it("assigns an unreadable tool to the environment without excusing a tool that ran and died", () => {
    expect(ENVIRONMENT_OWNED_NONRESULT_KINDS.has("verifierUnavailable")).toBe(true);
    expect(ENVIRONMENT_OWNED_NONRESULT_KINDS.has("crash")).toBe(false);
  });
});

describe("who owns a failed tool run", () => {
  // The host assigns every kind — an installed tool has no wire on which to report its own outcome —
  // so ownership reads straight off it. Two kinds mean the environment failed before the tool could
  // answer: the wall was unavailable or refused (`sandbox`), or the executable could not be read
  // (`verifierUnavailable`). Those get the one fresh replay the census gate and the battery control
  // replay allow. Everything else is a tool the author chose, run over an input the artifact
  // produced, which the author can act on — so it settles at once.
  it.each([...ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS])("gives %s to the environment", (kind) => {
    expect(environmentOwnedToolNonResult(kind)).toBe(true);
  });

  it.each([
    // Author-owned kinds, then spellings no tool run produces at all.
    "timeout",
    "crash",
    "protocol",
    "provider",
    "transport",
    "verifier-throw",
    "verifier",
    "solver",
    "runtime",
    "",
    "SANDBOX",
    "engine-unavailable",
  ])("leaves %j outside the environment's account", (kind) => {
    expect(environmentOwnedToolNonResult(kind)).toBe(false);
  });

  it("partitions the tool-run vocabulary in two, with nothing left over", () => {
    // The census gate and the shipping battery both read this split, so a new host kind missing
    // from the expected partition must fail here and receive an explicit retry-ownership decision.
    const environment = VERIFIER_EXECUTION_NON_RESULT_KINDS.filter(environmentOwnedToolNonResult);
    const author = VERIFIER_EXECUTION_NON_RESULT_KINDS.filter((kind) => !environmentOwnedToolNonResult(kind));
    expect(new Set<string>(environment)).toEqual(new Set(ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS));
    expect(author).toEqual(["provider", "transport", "timeout", "crash", "protocol"]);
  });
});

describe("the wording that routes a dead provider out of the score", () => {
  it.each([
    // esp32-opus-controls-20260905T1440Z: two Builder turns returned this 403 and were retried as
    // ordinary failures; in the Built slot the same refusal would have scored 25 unaccepted cases.
    "api_error status 403: Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
    // The claude run filed three provider-limit cases as unaccepted because this exact public
    // wording matched no clause. Regression on the wording, not a paraphrase of it.
    "You are out of extra usage credit for this billing period.",
    // esp32-run57-sol-0903 battery i02: during the OpenAI incident every Codex call returned 404
    // with an empty body, pi-ai reported the bare status text, and all 25 cases recorded as
    // solver-kind non-results instead of the provider-kind ones the battery stop rule counts.
    "Not Found",
    "unexpected status 404 Not Found: Unknown error, url: https://chatgpt.com/backend-api/codex/responses",
    // Run truss-w38-sol, case service-panel-low: the Pi worker's own transport error arrived after
    // two tool calls, so the case stayed an unaccepted attempt and fed a claim refusal.
    "WebSocket error",
    // esp32-base-sol i02, case uno-reed-counter-wrap: the close code missed the anchor, the case
    // recorded pass:false, and its empty runtime identity voided the whole 24-case battery.
    "WebSocket closed 1006 Connection ended",
    "api_error status 429: too many requests; retry later",
  ])("types %j as a provider non-result", (message) => {
    expect(RUNTIME_NON_RESULT_MESSAGE.test(message)).toBe(true);
    expect(runtimeNonResultReason([message, "turn 1 failed"])).toBe(message);
  });

  it("matches the codex thread-creation session-data fatal", () => {
    // Campaigns esp32 -4 and -5 each aborted at open on this, with abortClause null: the error was
    // thrown rather than settled as a failed turn, and its wording matched no clause.
    const message =
      "error creating thread: Fatal error: Session data under /private/var/tmp/ana-codex-home/run-LxIpoh/sessions looks corrupt or unreadable. Clearing the sessions directory may help (this will remove saved threads). (underlying error: failed to load AGENTS.md instructions for environment `local`: Operation not permitted (os error 1))";
    expect(runtimeNonResultReason([message])).toBe(message);
    // The transport's one retry reads the same clause, so the two readers cannot drift apart.
    expect(CODEX_THREAD_OPEN_FATAL.test(message)).toBe(true);
  });

  it.each([
    // Each of these is a solver's own product output in some domain, and each sits one word away
    // from a clause above. Matching one books a genuine failed attempt out of the denominator.
    "file not found: src/main.c",
    "Not Found in the include path",
    "Error creating thread with pthread_create returned 11",
    "replay aborted: the session data in day3.journal is corrupt or unreadable at offset 4096",
    "the agent hit a websocket error while probing the API",
    "websocket closed the deal on the retry logic",
    "sensor sample exceeded its configured limit",
    "You've hit your limit while allocating task slots",
  ])("leaves %j a genuine failed attempt", (message) => {
    expect(runtimeNonResultReason([message, "turn 3 failed"])).toBeNull();
  });

  it("keeps an accepted artifact out of the environment's reach", () => {
    // A transport drop cannot erase work the solver had already submitted.
    const signals = {
      toolCalls: 5,
      startedToolCalls: 5,
      errors: ["WebSocket error"],
      turns: 2,
      completedTurns: 1,
    };
    expect(solverNonResultReason({ ...signals, acceptedSubmit: false })).toBe("WebSocket error");
    expect(solverNonResultReason({ ...signals, acceptedSubmit: true })).toBeNull();
  });

  it("routes a provider-limit-only solve to the environment rather than an unaccepted attempt", () => {
    expect(
      solverNonResultReason({
        toolCalls: 0,
        startedToolCalls: 0,
        acceptedSubmit: false,
        errors: ["out of extra usage"],
      }),
    ).toBe("out of extra usage");
  });
});

describe("an allowance, and whether the run can wait for it", () => {
  // Two separate questions on the same message. Classification is unconditional: an exhausted
  // allowance is always a provider non-result, whatever clock it names. Only the authoring retry
  // asks the second question, and campaign 3fd52f9e-28 is why it now does: reading a clock-bounded
  // session limit as exhaustion ended two live campaigns hours before their stated reset.
  it.each([
    "api_error status 429: You've hit your session limit · resets 12pm (Europe/Amsterdam)",
    "Claude Code returned an error result: You've hit your limit · resets 4pm (Europe/Amsterdam)",
    "You've hit your weekly limit · resets Sep 12 at 8am (Europe/Amsterdam)",
    "api_error status 429: You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
  ])("still types %j as an exhausted allowance", (message) => {
    expect(PROVIDER_ALLOWANCE.test(message)).toBe(true);
    expect(runtimeNonResultReason([message, "turn 1 failed"])).toBe(message);
  });

  it("separates a limit that names a clock from one that does not", () => {
    const now = new Date("2026-09-17T07:33:23Z");
    const waitable = "api_error status 429: You've hit your session limit · resets 12pm (Europe/Amsterdam)";
    const spent =
      "api_error status 429: You've hit your monthly spend limit · raise it at claude.ai/settings/usage";
    expect(providerResetAt(waitable, now)).not.toBeNull();
    expect(providerResetAt(spent, now)).toBeNull();
    // Both remain provider non-results; only the wait differs. test/turn-retry.test.ts owns the
    // decision that reads this and the resolution of the clock itself.
    expect(PROVIDER_ALLOWANCE.test(waitable) && PROVIDER_ALLOWANCE.test(spent)).toBe(true);
  });

  it("keeps a throttle out of the allowance set", () => {
    // A bare 429 claims no allowance, so it retries on the ordinary ladder rather than ending a run.
    const throttle = "api_error status 429: too many requests; retry later";
    expect(PROVIDER_ALLOWANCE.test(throttle)).toBe(false);
    expect(providerResetAt(throttle)).toBeNull();
  });
});

describe("evidence that a tool failed", () => {
  // Only the host's recorded row establishes a tool failure: an object built separately with the
  // same fields does not acquire the identity of the recorded host result.
  const row = (over: Partial<VerifierExecutionEvidence>): VerifierExecutionEvidence =>
    double<VerifierExecutionEvidence>({
      toolId: "gcc",
      checkId: "compiles",
      runId: "run-1",
      phase: "battery",
      subjectId: "case-1",
      attempt: 1,
      outcome: "executed",
      ...over,
    });
  const hostWith = (rows: VerifierExecutionEvidence[]): VerifierHostHandle =>
    double<VerifierHostHandle>({ evidence: () => rows });
  const subject = { phase: "battery" as const, subjectId: "case-1", attempt: 1 };

  it("carries the exact host row rather than an object with matching fields", () => {
    const failed = row({ outcome: "timeout" });
    expect<unknown>(hostNonResult(hostWith([row({}), failed]), subject)).toBe(failed);
    expect(new VerifierExecutionNonResult(row({ outcome: "timeout" })).evidence).not.toBe(failed);
  });

  it("finds no non-result when every run of the subject executed", () => {
    expect(hostNonResult(hostWith([row({}), row({})]), subject)).toBeNull();
  });

  it("reads only this subject's own runs: another case's outage grounds nothing here", () => {
    const mine = row({});
    const verifier = hostWith([
      row({ subjectId: "case-2", outcome: "sandbox" }),
      row({ attempt: 2, outcome: "sandbox" }),
      row({ phase: "discrimination", outcome: "sandbox" }),
      mine,
    ]);
    expect(subjectRuns(verifier, subject)).toEqual([mine]);
    expect(hostNonResult(verifier, subject)).toBeNull();
  });
});

describe("what the solve's own signals establish when no message names the provider", () => {
  // The clauses above read the error text. These read the shape of the attempt: how many outer
  // turns completed, whether any tool call started, whether anything was submitted. Each one has
  // to fail closed, because the cost of a wrong yes is a genuine failure booked out of the
  // denominator, and the cost of a wrong no is an outage booked as a product fail.

  it("does not let product prose about a missing verdict shrink the denominator", () => {
    expect(
      solverNonResultReason({
        toolCalls: 5,
        acceptedSubmit: false,
        errors: ["artifact is not a valid truth verdict"],
      }),
    ).toBeNull();
    expect(
      solverNonResultReason({
        toolCalls: 3,
        acceptedSubmit: false,
        errors: ["An error occurred while processing your request. Fix the artifact and try again."],
      }),
    ).toBeNull();
    // The verifier's own staging failure is the environment's, whatever the solver did.
    expect(
      solverNonResultReason({
        toolCalls: 5,
        acceptedSubmit: false,
        errors: ["remote verifier staging failed: transport unavailable"],
      }),
    ).toContain("remote verifier staging failed");
  });

  it("types a solve whose every outer turn completed no provider result as environment (live-run-08)", () => {
    // The exact recorded shape run 8 booked as 50 product fails: four provider-degraded turns per
    // case under a spend-limit outage, zero tool starts, zero completions, no submit.
    const errors = [1, 2, 3, 4].map(
      (turn) => `turn ${String(turn)} completed no claude-opus-5 result (provider-degraded turn)`,
    );
    const degraded = {
      toolCalls: 0,
      startedToolCalls: 0,
      acceptedSubmit: false,
      turns: 4,
      completedTurns: 0,
      errors,
    };
    expect(solverNonResultReason(degraded)).toContain("no outer turn completed a provider result");
    // Tool work alongside degraded turns remains an unaccepted attempt.
    expect(solverNonResultReason({ ...degraded, toolCalls: 3, startedToolCalls: 3 })).toBeNull();
    // A started call that never completed is still a real attempt: the clause fails closed.
    expect(solverNonResultReason({ ...degraded, startedToolCalls: 1 })).toBeNull();
    // One completed turn prevents the clause from applying at all.
    expect(solverNonResultReason({ ...degraded, completedTurns: 1, errors: [] })).toBeNull();
    // An unknown completed-turn count cannot establish it.
    expect(
      solverNonResultReason({ toolCalls: 0, startedToolCalls: 0, acceptedSubmit: false, errors }),
    ).toBeNull();
  });

  it("types a solve that never reached the loop, and fails closed on an unknown tool count", () => {
    for (const error of ["turn 1 aborted", "turn 1 failed"]) {
      expect(
        solverNonResultReason({ toolCalls: 0, startedToolCalls: 0, acceptedSubmit: false, errors: [error] }),
      ).toContain("never reached the loop");
    }
    // Without the started-call count, zero completed calls does not prove nothing started.
    expect(
      solverNonResultReason({ toolCalls: 0, acceptedSubmit: false, errors: ["turn 1 aborted"] }),
    ).toBeNull();
    expect(
      solverNonResultReason({ toolCalls: undefined, acceptedSubmit: false, errors: ["turn 1 aborted"] }),
    ).toBeNull();
  });

  it("leaves an abort or a tool refusal after real tool work a genuine failed attempt", () => {
    for (const error of ["turn 3 aborted", "tool rejected input"]) {
      expect(solverNonResultReason({ toolCalls: 5, acceptedSubmit: false, errors: [error] })).toBeNull();
    }
  });
});

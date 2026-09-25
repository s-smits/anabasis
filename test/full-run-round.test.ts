/**
 * Whether a round ends the campaign, and how the per-round counters carry into the next one, as
 * src/run/full-run-round.ts decides it. Every ending is read here as one table under a loop state
 * where no guard fires, so a row that continues is the table's own verdict rather than a quiet
 * guard; the guards then get rows of their own. The loop consuming these decisions is exercised in
 * full-run-loop.test.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  AUTHORING_STALL_LIMIT,
  type IterationResult,
  type LoopState,
  type UnresolvedAuthoringStall,
  heldInLoop,
  loopTerminal,
  nextBlockedRounds,
  nextUnresolvedAuthoringStall,
  terminalEvidenceFor,
} from "../src/run/full-run-round.ts";
import { type LoopTerminalCode, fullRunExitStatus, loopTerminalCode } from "../src/run/loop-terminal.ts";
import { double } from "./helpers/doubles.ts";

type Move = IterationResult["decision"]["move"];

/** Budget active and no blocked streak: every guard is quiet. */
const quiet: LoopState = { budget: { status: () => "active" }, blockedRounds: 0, authoringStall: null };
const spent: LoopState = { ...quiet, budget: { status: () => "budget_limited" } };
const blocked: LoopState = { ...quiet, blockedRounds: 3 };

function result(
  build: IterationResult["build"],
  over: {
    move?: Move;
    reason?: string;
    nextMove?: Move | undefined;
    nextReason?: string | undefined;
    promoted?: boolean;
    experiment?: "build" | "climb";
    clauses?: string[];
    measured?: boolean;
    admissionDigest?: string | undefined;
    admissionBasisDigest?: string | undefined;
  } = {},
): IterationResult {
  return double({
    decision: { move: over.move ?? "measure", reason: over.reason ?? "r" },
    admissionBasisDigest: over.admissionBasisDigest ?? null,
    nextDecision:
      over.nextMove === undefined ? null : { move: over.nextMove, reason: over.nextReason ?? "next reason" },
    build,
    buildClauses: over.clauses ?? (build === "build-failed" ? ["iterations-exhausted"] : []),
    steps: {
      promotion:
        over.promoted === undefined
          ? null
          : {
              decision: over.promoted ? "promoted" : "held",
              experiment: over.experiment ?? null,
              clauses: ["clause-0: prose"],
            },
      measure:
        over.measured === undefined
          ? null
          : { verdicts: { measured: over.measured, claimCreated: false, ready: false }, claim: null },
      admission: over.admissionDigest === undefined ? null : { digest: over.admissionDigest },
    },
  });
}

const failedRetry = (move: Move = "rebuild") => result("build-failed", { move, nextMove: move });
const held = (move: Move, nextMove?: Move, nextReason?: string) =>
  result("candidate", {
    move,
    promoted: false,
    experiment: "build",
    nextMove,
    nextReason,
  });

describe("loopTerminal", () => {
  it.each<[string, IterationResult, LoopState]>([
    ["a failed rebuild whose recomputed move is another rebuild", failedRetry(), quiet],
    [
      "a failed build inside the strike ceiling",
      failedRetry("build"),
      { ...quiet, authoringStall: { key: "k", rounds: 2 } },
    ],
    ["a held build into a lawful measure", held("build", "measure"), quiet],
    ["a held rebuild into a lawful measure", held("rebuild", "measure"), quiet],
    ["a held rebuild into a fresh rebuild", held("rebuild", "rebuild"), quiet],
    ["a promoted candidate", result("candidate", { promoted: true }), quiet],
    ["an adopted fresh build, whether or not its evidence changed", result("adopted"), quiet],
    ["a reused measurement", result("reused", { measured: true }), quiet],
    ["a reused round that measured nothing", result("reused"), quiet],
    ["two blocked batteries, one short of the allowance", result("reused"), { ...quiet, blockedRounds: 2 }],
  ])("continues %s", (_name, round, loop) => {
    expect(loopTerminal(round, loop)).toBeNull();
  });

  const budgetLimited = "budget-limited: the campaign model-call budget is spent";
  const environmentBlocked =
    "environment-blocked: 3 consecutive batteries were stopped by the provider or recorded only typed non-results";
  const buildFailed = "build-failed: the final iteration produced no build-admissible candidate";
  it.each<[string, IterationResult, LoopState, string]>([
    [
      "a stopped round, in the decision's words",
      result("stopped", { reason: "limit-reached" }),
      quiet,
      "stopped: limit-reached",
    ],
    [
      "a stopped round on a spent budget: the table reads first",
      result("stopped", { reason: "limit-reached" }),
      spent,
      "stopped: limit-reached",
    ],
    [
      "a fixed-product boundary clause, verbatim",
      result("build-failed", { clauses: ["fixed-product-boundary: the product is fixed"] }),
      quiet,
      "fixed-product-boundary: the product is fixed",
    ],
    [
      "a failed build with no next decision",
      result("build-failed"),
      quiet,
      `${buildFailed} (iterations-exhausted)`,
    ],
    [
      "a failed rebuild whose next move is measure",
      result("build-failed", { move: "rebuild", nextMove: "measure" }),
      quiet,
      buildFailed,
    ],
    [
      "a failed rebuild whose selector stops, in the selector's words",
      result("build-failed", {
        move: "rebuild",
        nextMove: "stop",
        nextReason: "blocking feedback belongs to environment",
      }),
      quiet,
      "stopped: blocking feedback belongs to environment",
    ],
    ...[["environment-blocked"], ["authoring-stalled"], ["authoring-stalled", "environment-blocked"]].map(
      (clauses): [string, IterationResult, LoopState, string] => [
        `a retry carrying ${clauses.join(" + ")}, which has its own owner`,
        result("build-failed", { move: "rebuild", nextMove: "rebuild", clauses }),
        quiet,
        buildFailed,
      ],
    ),
    [
      "a failed build at the strike ceiling",
      failedRetry("build"),
      { ...quiet, authoringStall: { key: "k", rounds: 3 } },
      buildFailed,
    ],
    ["a failed rebuild retry on a spent budget", failedRetry(), spent, budgetLimited],
    ["an adopted round on a spent budget", result("adopted"), spent, budgetLimited],
    ["a reused measurement on a spent budget", result("reused", { measured: true }), spent, budgetLimited],
    ["three blocked batteries", result("reused"), blocked, environmentBlocked],
    [
      "three blocked batteries on a spent budget: spend outranks the environment",
      result("reused"),
      { ...blocked, budget: spent.budget },
      budgetLimited,
    ],
    [
      "a held task-only round, naming the move that did not continue",
      result("candidate", { move: "measure", promoted: false, experiment: "climb", nextMove: "measure" }),
      quiet,
      'candidate-held: the measure candidate was held; a next "measure" does not continue in this invocation',
    ],
    [
      "a held round with no grounded next decision, naming that absence",
      result("candidate", { move: "measure", promoted: false, experiment: "climb" }),
      quiet,
      "candidate-held: the measure candidate was held and no grounded next decision exists",
    ],
    ["a candidate with no promotion row", result("candidate"), quiet, "candidate-held"],
    ["a held build whose next move opens another build", held("build", "build"), quiet, "candidate-held"],
    ["a held build with no next decision", held("build"), quiet, "candidate-held"],
    ["a held build continuing on a spent budget", held("build", "measure"), spent, budgetLimited],
    [
      "a held build continuing after three blocked batteries",
      held("build", "measure"),
      blocked,
      environmentBlocked,
    ],
    [
      "a held build whose selector stops, in the selector's words",
      held("build", "stop", "no routable owner remains"),
      quiet,
      "stopped: no routable owner remains",
    ],
  ])("ends %s", (_name, round, loop, ending) => {
    expect(loopTerminal(round, loop)).toStartWith(ending);
  });
});

describe("the shared unresolved-authoring allowance", () => {
  const heldOn = (basis: string | undefined, produced?: string) =>
    result("candidate", {
      move: "rebuild",
      nextMove: "rebuild",
      promoted: false,
      admissionBasisDigest: basis,
      admissionDigest: produced,
    });
  const failedWith = (over: { clauses?: string[]; reason?: string }) =>
    result("build-failed", { move: "rebuild", nextMove: "rebuild", ...over });
  const heldEnding = "candidate-held: 3 unresolved authoring rounds";
  const failedEnding = "build-failed";

  it.each<[string, IterationResult[], string]>([
    ["held, failed and held alternating", [heldOn(undefined), failedRetry(), heldOn(undefined)], heldEnding],
    [
      "an A/B alternation of clauses",
      [
        failedWith({ clauses: ["A: first"] }),
        failedWith({ clauses: ["B: second"] }),
        failedWith({ clauses: ["A: first"] }),
      ],
      failedEnding,
    ],
    [
      "one decision reworded each round",
      [
        failedWith({ reason: "first wording" }),
        failedWith({ reason: "second wording" }),
        failedWith({ reason: "third wording" }),
      ],
      failedEnding,
    ],
    [
      "one consumed basis, whatever packet each round produced",
      [heldOn("basis", "produced-1"), heldOn("basis", "produced-2"), heldOn("basis", "produced-3")],
      heldEnding,
    ],
  ])("counts %s as one stall and ends at the allowance", (_name, rounds, ending) => {
    let stall: UnresolvedAuthoringStall | null = null;
    for (const round of rounds) stall = nextUnresolvedAuthoringStall(stall, round);
    expect(stall?.rounds).toBe(AUTHORING_STALL_LIMIT);
    expect(loopTerminal(rounds.at(-1)!, { ...quiet, authoringStall: stall })).toStartWith(ending);
  });

  it("leaves a zero-verified hold out of the allowance", () => {
    const nonzero = heldOn(undefined);
    const zeroVerified: IterationResult = {
      ...nonzero,
      steps: { ...nonzero.steps, promotion: double({ decision: "held", battery: { verified: 0 } }) },
    };
    const stall = nextUnresolvedAuthoringStall(null, nonzero);
    expect(nextUnresolvedAuthoringStall(stall, zeroVerified)).toBe(stall);
    expect(nextUnresolvedAuthoringStall(null, zeroVerified)).toBeNull();
  });

  it("opens a new stall each round the consumed basis advances", () => {
    let stall: UnresolvedAuthoringStall | null = null;
    for (const basis of ["basis-1", "basis-2", "basis-3"]) {
      stall = nextUnresolvedAuthoringStall(stall, heldOn(basis));
      expect(stall?.rounds).toBe(1);
    }
  });

  it("resets on adoption, and on nothing a round merely produced", () => {
    const stall = nextUnresolvedAuthoringStall(null, heldOn(undefined));
    expect(nextUnresolvedAuthoringStall(stall, result("reused"))).toBe(stall);
    // A packet this round accepted is not progress: it reaches the next round as its basis, where
    // the changed key clears the streak.
    expect(nextUnresolvedAuthoringStall(stall, heldOn(undefined, "new-evidence"))?.rounds).toBe(2);
    expect(nextUnresolvedAuthoringStall(stall, result("reused", { admissionDigest: "new" }))).toBe(stall);
    expect(
      nextUnresolvedAuthoringStall(stall, result("candidate", { move: "rebuild", promoted: true })),
    ).toBeNull();
  });
});

describe("the ending's code and exit status", () => {
  // Only completed exits 0; operator-interrupted exits 3, so `fullrun ... && deploy` cannot deploy an
  // unfinished campaign while a rehearsal script can still accept the cap on purpose.
  it.each<[string | null, LoopTerminalCode | null, 0 | 1 | 3]>([
    ["completed", "completed", 0],
    ["stopped: limit-reached", "stopped", 1],
    ["fixed-product-boundary: prose", "fixed-product-boundary", 1],
    ["build-failed: prose", "build-failed", 1],
    ["candidate-held: the climb candidate was held", "candidate-held", 1],
    ["budget-limited: prose", "budget-limited", 1],
    ["environment-blocked: prose", "environment-blocked", 1],
    ["operator-interrupted: round cap 1 reached", "operator-interrupted", 3],
    ["something-else: prose", null, 1],
    ["measurement-stalled: prose", null, 1],
    [null, null, 1],
  ])("reads %j as code %j, exit %d", (terminal, code, status) => {
    expect(loopTerminalCode(terminal)).toBe(code);
    expect(fullRunExitStatus(terminal)).toBe(status);
  });
});

it("cites the promotion row behind a held candidate, and nothing behind any other ending", () => {
  const withRow = result("candidate");
  // SAFETY: terminalEvidenceFor reads only promotion.runId off this step.
  withRow.steps.promotion = { runId: "run-02", decision: "held", clauses: [] } as never;
  const heldEnding = "candidate-held: the climb candidate was held";
  expect(terminalEvidenceFor(heldEnding, withRow, "slug")).toEqual(["campaigns/slug/promotions/run-02.json"]);
  expect(terminalEvidenceFor(heldEnding, result("candidate"), "slug")).toBeNull();
  expect(terminalEvidenceFor("stopped: limit-reached", withRow, "slug")).toBeNull();
  expect(terminalEvidenceFor(null, withRow, "slug")).toBeNull();
});

/** A present claim resets the blocked count even at a zero pass rate, except the refusal a
 *  provider-stopped battery writes for the same dead provider; a round with no battery holds it. */
it.each<[string, object | null, number, number]>([
  ["a blocked battery", { claim: null }, 0, 1],
  ["another blocked battery", { claim: null }, 2, 3],
  ["a zero-pass claim", { claim: { statement: { passRate: 0 } } }, 2, 0],
  ["a provider-stopped refusal", { disposition: "provider-stopped", claim: { created: false } }, 2, 3],
  [
    "a provider-stopped battery that still created its claim",
    { disposition: "provider-stopped", claim: { created: true } },
    2,
    0,
  ],
  ["a round that drove no battery", null, 2, 2],
])("nextBlockedRounds counts %s", (_name, measure, prev, next) => {
  expect(nextBlockedRounds(prev, double<IterationResult>({ steps: { measure } }))).toBe(next);
});

it.each<
  [
    string,
    "promoted" | "held" | null,
    null | { created: boolean; clauses: Array<{ repairable: boolean }> },
    boolean,
  ]
>([
  [
    "a hold whose refused claim is all repairable",
    "held",
    { created: false, clauses: [{ repairable: true }, { repairable: true }] },
    true,
  ],
  [
    "a clause that blames the candidate's bytes",
    "held",
    { created: false, clauses: [{ repairable: true }, { repairable: false }] },
    false,
  ],
  ["a created claim that still held", "held", { created: true, clauses: [] }, false],
  ["a hold with no claim", "held", null, false],
  ["a promoted candidate", "promoted", { created: false, clauses: [{ repairable: true }] }, false],
  ["no promotion row", null, { created: false, clauses: [{ repairable: true }] }, false],
])("heldInLoop reads %s", (_name, promotion, claim, expected) => {
  // SAFETY: heldInLoop reads only promotion.decision, measure.claim.created and measure.claim.clauses[].repairable.
  const steps = {
    promotion: promotion === null ? null : { decision: promotion },
    measure: { claim },
  } as never;
  expect(heldInLoop(steps)).toBe(expected);
});

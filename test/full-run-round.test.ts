/**
 * A round either ends the campaign or it does not, and src/run/full-run-round.ts owns that call:
 * which ending cites evidence, which hold still lets the loop continue, and how the per-round
 * counters advance into the next one.
 *
 * Every stop reason lives in one function, so the continuation table is read row by row under a
 * loop state where no guard fires: a row that continues is the table's own verdict rather than a
 * quiet guard. The loop that consumes these decisions is tested in full-run-loop.test.ts, and the
 * ending vocabulary itself in loop-terminal.ts's own callers.
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
  nextStalledMeasureRounds,
  nextUnresolvedAuthoringStall,
  terminalEvidenceFor,
} from "../src/run/full-run-round.ts";
import { LOOP_TERMINAL_CODES, fullRunExitStatus, loopTerminalCode } from "../src/run/loop-terminal.ts";
import { MEASURE_FOR_FEEDBACK_REASON } from "../src/run/next-move.ts";
import { roundCapTerminal } from "../src/run/full-run.ts";
import { double } from "./helpers/doubles.ts";

/** Every stop reason in one function: the continuation table row by row, then the guards
 *  and their order. The rows are read under a loop state where no guard fires, so a row that
 *  continues is the table's own verdict rather than a quiet guard. */
describe("loopTerminal", () => {
  /** Budget active and no blocked streak: every curriculum guard is quiet. */
  const quiet: LoopState = {
    budget: { status: () => "active" },
    blockedRounds: 0,
    authoringStall: null,
    stalledMeasureRounds: 0,
  };
  const result = (
    build: IterationResult["build"],
    over: Partial<{
      move: IterationResult["decision"]["move"];
      reason: string;
      nextMove: IterationResult["decision"]["move"];
      nextReason: string;
      promoted: boolean;
      clauses: number;
      clauseCodes: string[];
      experiment: "build" | "climb" | "evaluation";
      measured: boolean;
      admissionDigest: string;
      admissionBasisDigest: string | null;
      claimEvidence: boolean;
    }> = {},
  ): IterationResult =>
    double({
      decision: { move: over.move ?? "measure", reason: over.reason ?? "r" },
      admissionBasisDigest: over.admissionBasisDigest ?? null,
      nextDecision:
        over.nextMove === undefined
          ? null
          : { move: over.nextMove, reason: over.nextReason ?? "next reason" },
      build,
      buildClauses: build === "build-failed" ? ["iterations-exhausted"] : [],
      steps: {
        promotion:
          over.promoted === undefined
            ? null
            : {
                decision: over.promoted ? "promoted" : "held",
                experiment: over.experiment ?? null,
                clauses:
                  over.clauseCodes === undefined
                    ? Array.from({ length: over.clauses ?? 1 }, (_unused, index) => `clause-${index}: prose`)
                    : over.clauseCodes.map((code) => `${code}: prose`),
              },
        // SAFETY: loopTerminal reads only `measure.verdicts.measured`, and the literal below
        // carries exactly that field; the rest of the measure shape stays unread here.
        measure:
          over.measured === undefined && over.claimEvidence !== true
            ? null
            : {
                verdicts: {
                  measured: over.measured === true,
                  claimCreated: over.claimEvidence === true,
                  ready: false,
                },
                claim: over.claimEvidence === true ? { created: true } : null,
              },
        admission: over.admissionDigest === undefined ? null : { digest: over.admissionDigest },
      },
    });

  it("uses one finite allowance for held and failed authoring alternation", () => {
    const held = result("candidate", {
      move: "rebuild",
      nextMove: "rebuild",
      promoted: false,
      clauseCodes: ["A"],
    });
    const failed = result("build-failed", { move: "rebuild", nextMove: "rebuild" });
    let stall: UnresolvedAuthoringStall | null = null;
    stall = nextUnresolvedAuthoringStall(stall, held);
    stall = nextUnresolvedAuthoringStall(stall, failed);
    stall = nextUnresolvedAuthoringStall(stall, held);
    expect(stall?.rounds).toBe(AUTHORING_STALL_LIMIT);
    expect(loopTerminal(held, { ...quiet, authoringStall: stall })).toMatch(
      /^candidate-held: 3 unresolved authoring rounds/,
    );
  });

  it("does not reset an A/B clause alternation or mistake clauses for evidence", () => {
    const failed = (clause: string) =>
      double<IterationResult>({
        ...result("build-failed", { move: "rebuild", nextMove: "rebuild" }),
        buildClauses: [clause],
      });
    let stall: UnresolvedAuthoringStall | null = null;
    for (const clause of ["A: first", "B: second", "A: first"]) {
      stall = nextUnresolvedAuthoringStall(stall, failed(clause));
    }
    expect(stall?.rounds).toBe(AUTHORING_STALL_LIMIT);
  });

  it("does not reset one structured decision when only its reason is reworded", () => {
    const failed = (reason: string) =>
      double<IterationResult>({
        ...result("build-failed", { move: "rebuild", nextMove: "rebuild" }),
        decision: { move: "rebuild", reason },
      });
    let stall: UnresolvedAuthoringStall | null = null;
    for (const reason of ["first wording", "second wording", "third wording"]) {
      stall = nextUnresolvedAuthoringStall(stall, failed(reason));
    }
    expect(stall?.rounds).toBe(AUTHORING_STALL_LIMIT);
  });

  it("resets on adoption, and on nothing a round merely produced", () => {
    const held = result("candidate", { move: "rebuild", nextMove: "rebuild", promoted: false });
    const adopted = result("candidate", { move: "rebuild", promoted: true });
    const stall = nextUnresolvedAuthoringStall(null, held);
    expect(nextUnresolvedAuthoringStall(stall, result("reused", { move: "measure" }))?.rounds).toBe(1);
    // A packet this round ACCEPTED is not progress: an unpublished one reaches no reader, and a
    // published one reaches the next round as its basis, where the changed key clears the streak.
    expect(
      nextUnresolvedAuthoringStall(
        stall,
        result("candidate", {
          move: "rebuild",
          nextMove: "rebuild",
          promoted: false,
          admissionDigest: "new-evidence",
        }),
      )?.rounds,
    ).toBe(2);
    expect(
      nextUnresolvedAuthoringStall(stall, result("reused", { move: "measure", admissionDigest: "new" })),
    ).toBe(stall);
    expect(nextUnresolvedAuthoringStall(stall, adopted)).toBeNull();
  });

  it("counts three held rounds under one consumed basis, whatever each round produced", () => {
    // The production shape the key inversion hid: run21 iterations 11-13 and run22 each held under
    // one unchanged basis while recording a different fresh packet, so the declared held-candidate
    // allowance never accumulated and the loop kept opening rounds.
    const heldOn = (basis: string, produced: string) =>
      result("candidate", {
        move: "rebuild",
        nextMove: "rebuild",
        promoted: false,
        admissionBasisDigest: basis,
        admissionDigest: produced,
      });
    let stall: UnresolvedAuthoringStall | null = null;
    for (const produced of ["40de504e", "7c45a0e3", "1f2a33b0"]) {
      stall = nextUnresolvedAuthoringStall(stall, heldOn("73c950e9", produced));
    }
    expect(stall?.rounds).toBe(AUTHORING_STALL_LIMIT);
    expect(loopTerminal(heldOn("73c950e9", "1f2a33b0"), { ...quiet, authoringStall: stall })).toMatch(
      /^candidate-held: 3 unresolved authoring rounds/,
    );
  });

  it("stays at one round while the consumed basis advances each round", () => {
    // The publication fix's other half: a packet measured on the adopted harness IS published, so
    // the next round consumes it, the key moves, and three held rounds are three separate stalls.
    let stall: UnresolvedAuthoringStall | null = null;
    for (const basis of ["73c950e9", "40de504e", "7c45a0e3"]) {
      stall = nextUnresolvedAuthoringStall(
        stall,
        result("candidate", {
          move: "rebuild",
          nextMove: "rebuild",
          promoted: false,
          admissionBasisDigest: basis,
        }),
      );
      expect(stall?.rounds).toBe(1);
    }
  });

  it("reads a typed code out of every terminal it writes, and out of nothing else", () => {
    // The exit status is the first reader that must ACT on an ending rather than print it. It used
    // to read the measured verdict, which gave candidate-held and budget-limited a success status
    // whenever the last round happened to measure. The code is the
    // part of the sentence allowed to decide; the prose after the colon stays free to be reworded.
    expect(loopTerminalCode("stopped: limit-reached")).toBe("stopped");
    expect(loopTerminalCode("candidate-held: the climb candidate was held")).toBe("candidate-held");
    expect(loopTerminalCode("budget-limited: the durable authoring/session-call budget is spent")).toBe(
      "budget-limited",
    );
    expect(loopTerminalCode(null)).toBeNull();
    // An ending no code names is not silently read as one that settled the question.
    expect(loopTerminalCode("something-else: prose")).toBeNull();
    expect(loopTerminalCode("completed")).toBe("completed");
  });

  it("maps every ending in the closed set to a status a caller can act on", () => {
    // Check the complete set: adding a terminal code requires choosing a status that tells
    // the caller what happened. Only completed returns zero; a stopped run returns one.
    // operator-interrupted gets its own 3: a zero would let `fullrun ... && deploy` deploy on an
    // unfinished campaign, and a plain one would call the ordinary --max-iterations 1 rehearsal
    // broken. A rehearsal script can accept 3 on purpose; a chain cannot accept it by accident.
    const statuses = Object.fromEntries(
      LOOP_TERMINAL_CODES.map((code) => [code, fullRunExitStatus(`${code}: prose`)]),
    );
    expect(statuses).toEqual({
      completed: 0,
      stopped: 1,
      "fixed-product-boundary": 1,
      "build-failed": 1,
      "candidate-held": 1,
      "budget-limited": 1,
      "environment-blocked": 1,
      "measurement-stalled": 1,
      "operator-interrupted": 3,
    });
    expect(fullRunExitStatus(roundCapTerminal(1, 1))).toBe(3);
    // An ending no code names, and no ending at all, are both short of the question.
    expect(fullRunExitStatus("something-else: prose")).toBe(1);
    expect(fullRunExitStatus(null)).toBe(1);
  });

  it("ends on stopped and build-failed with the decision's own words", () => {
    expect(loopTerminal(result("stopped", { reason: "limit-reached" }), quiet)).toBe(
      "stopped: limit-reached",
    );
    expect(loopTerminal(result("build-failed"), quiet)).toMatch(/build-failed/);
  });

  it("continues only a failed round whose recomputed decision names another authoring move", () => {
    expect(loopTerminal(result("build-failed", { move: "rebuild", nextMove: "rebuild" }), quiet)).toBeNull();
    expect(loopTerminal(result("build-failed", { move: "rebuild", nextMove: "measure" }), quiet)).toMatch(
      /^build-failed/,
    );
    expect(
      loopTerminal(
        result("build-failed", {
          move: "rebuild",
          nextMove: "stop",
          nextReason: "blocking feedback belongs to environment",
        }),
        quiet,
      ),
    ).toBe("stopped: blocking feedback belongs to environment");
  });

  it.each([
    { clauses: ["environment-blocked"] },
    { clauses: ["authoring-stalled"] },
    { clauses: ["authoring-stalled", "environment-blocked"] },
  ])("stays terminal when a clause with its own owner is among them: %j", ({ clauses }) => {
    const stalled = {
      ...result("build-failed", { move: "rebuild", nextMove: "rebuild" }),
      buildClauses: [...clauses],
    };
    expect(loopTerminal(stalled, quiet)).toMatch(/^build-failed/);
  });

  it("bounds the retry by budget and by the shared authoring allowance", () => {
    const retry = () => result("build-failed", { move: "rebuild", nextMove: "rebuild" });
    expect(loopTerminal(retry(), { ...quiet, budget: { status: () => "budget_limited" } })).toMatch(
      /^budget-limited/,
    );
    let stall: UnresolvedAuthoringStall | null = null;
    for (let i = 0; i < AUTHORING_STALL_LIMIT; i++) stall = nextUnresolvedAuthoringStall(stall, retry());
    expect(loopTerminal(retry(), { ...quiet, authoringStall: stall })).toMatch(/^build-failed/);
  });

  it("lets an unroutable packet be answered by the rebuild it ordered", () => {
    // `repair-unroutable` is not on the non-recoverable list. When the recorded next move is
    // rebuild, this clause therefore allows the loop to continue instead of ending the campaign.
    //
    // This is a terminal-routing check: it supplies a failed result and its next decision,
    // then asks whether the loop should stop. It does not execute authoring or show that a
    // second candidate will pass. In particular, allowing another round says nothing about
    // whether the Builder can resolve the finding that produced the original refusal.
    // The neighbouring tests cover clauses that must stop and the budget that can prevent
    // continuation. Together they bound this exception to a changed rebuild decision; the
    // ordinary same-move failure remains terminal.
    const unroutable = {
      ...result("build-failed", { move: "rebuild", nextMove: "rebuild" }),
      buildClauses: ["repair-unroutable"],
    };
    expect(loopTerminal(unroutable, quiet)).toBeNull();
  });

  it("checks the budget before continuing a failed rebuild retry", () => {
    const pivot = result("build-failed", { move: "rebuild", nextMove: "rebuild" });
    const spent = {
      ...quiet,
      budget: { status: () => "budget_limited" as const },
    };
    expect(loopTerminal(pivot, spent)).toMatch(/^budget-limited/);
    expect(loopTerminal(pivot, quiet)).toBeNull();
  });

  it("retries a failed build within the strike ceiling, and stops at it", () => {
    // 12 of 55 recorded runs (2026-08-06 to 08-19) ended on a single failed authoring round while
    // the recomputed decision named a lawful retry; the streak, not the first failure, ends it.
    const failed = result("build-failed", { move: "build", nextMove: "build" });
    expect(loopTerminal(failed, quiet)).toBeNull();
    expect(loopTerminal(failed, { ...quiet, authoringStall: { key: "k", rounds: 2 } })).toBeNull();
    expect(loopTerminal(failed, { ...quiet, authoringStall: { key: "k", rounds: 3 } })).toMatch(
      /^build-failed/,
    );
    // A clause with its own bounded escalation or owner stays terminal on the first round.
    const stalled = { ...failed, buildClauses: ["authoring-stalled"] };
    expect(loopTerminal(stalled, quiet)).toMatch(/^build-failed/);
    // A next decision that is not an authoring move offers no retry to take.
    expect(loopTerminal(result("build-failed", { move: "build", nextMove: "measure" }), quiet)).toMatch(
      /^build-failed/,
    );
  });

  it("ends after consecutive environment-blocked batteries instead of re-measuring to the round cap", () => {
    const measuring = result("reused");
    // Run 169: 12 identical environment-blocked rounds ran to the operator round cap because no
    // guard read the blocked streak. At the policy threshold the loop closes with its own terminal.
    expect(loopTerminal(measuring, { ...quiet, blockedRounds: 2 })).toBeNull();
    expect(loopTerminal(measuring, { ...quiet, blockedRounds: 3 })).toMatch(/^environment-blocked/);
    // Budget exhaustion still reports first: spend control outranks the environment diagnosis.
    const spent = {
      ...quiet,
      blockedRounds: 3,
      budget: { status: () => "budget_limited" as const },
    };
    expect(loopTerminal(measuring, spent)).toMatch(/^budget-limited/);
  });

  it("gives the blocked-battery counter its own ending after three rounds of that shape", () => {
    expect(loopTerminal(result("reused"), { ...quiet, blockedRounds: 3 })).toContain(
      "consecutive batteries were stopped by the provider or recorded only typed non-results",
    );
    expect(loopTerminal(result("reused"), { ...quiet, blockedRounds: 2 })).toBeNull();
  });

  it("ends after consecutive measurements the selector cannot read, and counts only that shape", () => {
    const measuring = result("reused");
    expect(loopTerminal(measuring, { ...quiet, stalledMeasureRounds: 2 })).toBeNull();
    expect(loopTerminal(measuring, { ...quiet, stalledMeasureRounds: 3 })).toMatch(/^measurement-stalled/);

    const stalledEntry = { move: "measure", reason: MEASURE_FOR_FEEDBACK_REASON } as const;
    const measured = double<IterationResult>({
      steps: { measure: { claim: null } },
      decision: stalledEntry,
      nextDecision: null,
    });
    expect(nextStalledMeasureRounds(2, measured)).toBe(3);
    const annotated = double<IterationResult>({
      steps: { measure: { claim: null } },
      decision: { move: "measure", reason: `${MEASURE_FOR_FEEDBACK_REASON}; excluded 1 battery` },
      nextDecision: null,
    });
    expect(nextStalledMeasureRounds(2, annotated)).toBe(3);
    // The round that finally produced what the selector reads resets the count instead of ending
    // the run as its third stalled round: a written claim is difficulty evidence, admitted feedback
    // is the other readable output.
    const claimed = double<IterationResult>({
      steps: { measure: { claim: { statement: {} } } },
      decision: stalledEntry,
      nextDecision: null,
    });
    expect(nextStalledMeasureRounds(2, claimed)).toBe(0);
    const fedBack = double<IterationResult>({
      steps: { measure: { claim: null }, admission: { feedback: [{ owner: "tests" }] } },
      decision: stalledEntry,
      nextDecision: null,
    });
    expect(nextStalledMeasureRounds(2, fedBack)).toBe(0);
    expect(
      nextStalledMeasureRounds(
        2,
        double<IterationResult>({ steps: { measure: null }, decision: stalledEntry }),
      ),
    ).toBe(0);
    expect(
      nextStalledMeasureRounds(
        2,
        double<IterationResult>({
          steps: { measure: { claim: null } },
          decision: { move: "climb", reason: "band cleared; author the adjacent level" },
        }),
      ),
    ).toBe(0);
  });

  // A held candidate's terminal names the move that did not continue, so the reader need not open
  // the promotion row to learn why (three held runs between truss-w30 and truss-w36-sol recorded a
  // bare "candidate-held").
  it("continues a promoted candidate; a held task-only round ends with the move that did not continue", () => {
    expect(loopTerminal(result("candidate", { promoted: true }), quiet)).toBeNull();
    const held = loopTerminal(
      result("candidate", { move: "measure", promoted: false, experiment: "climb", nextMove: "measure" }),
      quiet,
    );
    expect(held).toMatch(/^candidate-held/);
    expect(held).toContain('a next "measure" does not continue in this invocation');
    // No grounded next decision at all names that absence instead of a move.
    expect(
      loopTerminal(result("candidate", { move: "measure", promoted: false, experiment: "climb" }), quiet),
    ).toContain("no grounded next decision exists");
    expect(loopTerminal(result("candidate", { promoted: false }), quiet)).toMatch(/^candidate-held/);
    expect(loopTerminal(result("candidate"), quiet)).toMatch(/^candidate-held/);
  });

  it("continues a held build or rebuild into a lawful measure or fresh rebuild", () => {
    // Run w14 ended candidate-held after one build round with 12 rounds of budget left. The held
    // candidate publishes nothing, so the selector's next decision is grounded in adopted history
    // and a current-harness measurement may run in the same invocation.
    expect(
      loopTerminal(
        result("candidate", { move: "build", promoted: false, experiment: "build", nextMove: "measure" }),
        quiet,
      ),
    ).toBeNull();
    expect(
      loopTerminal(
        result("candidate", { move: "rebuild", promoted: false, experiment: "build", nextMove: "measure" }),
        quiet,
      ),
    ).toBeNull();
    // A held rebuild may continue into another rebuild round: the sterile repeat is refused at
    // submit (rebuild-evaluation-unmoved), so the continuation buys a changed candidate or a
    // typed refusal, never a silent identical re-measure (run truss-w38-sol ended on exactly
    // this decision with budget left).
    expect(
      loopTerminal(
        result("candidate", { move: "rebuild", promoted: false, experiment: "build", nextMove: "rebuild" }),
        quiet,
      ),
    ).toBeNull();
    // A next stop-free move outside the three, or an absent decision, keeps the terminal: it
    // would open a new authoring round against the held packet inside one invocation.
    expect(
      loopTerminal(
        result("candidate", { move: "build", promoted: false, experiment: "build", nextMove: "build" }),
        quiet,
      ),
    ).toMatch(/^candidate-held/);
    expect(
      loopTerminal(result("candidate", { move: "build", promoted: false, experiment: "build" }), quiet),
    ).toMatch(/^candidate-held/);
    // Spend control and the blocked-streak guard outrank the continuation.
    const spent = {
      ...quiet,
      budget: { status: () => "budget_limited" as const },
    };
    expect(
      loopTerminal(
        result("candidate", { move: "build", promoted: false, experiment: "build", nextMove: "measure" }),
        spent,
      ),
    ).toMatch(/^budget-limited/);
    expect(
      loopTerminal(
        result("candidate", { move: "build", promoted: false, experiment: "build", nextMove: "measure" }),
        { ...quiet, blockedRounds: 3 },
      ),
    ).toMatch(/^environment-blocked/);
    // The selector-owned stop still speaks in its own words.
    expect(
      loopTerminal(
        result("candidate", {
          move: "build",
          promoted: false,
          experiment: "build",
          nextMove: "stop",
          nextReason: "no routable owner remains",
        }),
        quiet,
      ),
    ).toBe("stopped: no routable owner remains");
  });

  it("checks the budget before continuing past a held candidate", () => {
    const held = result("candidate", {
      move: "build",
      promoted: false,
      experiment: "build",
      nextMove: "measure",
    });
    const spent = {
      ...quiet,
      budget: { status: () => "budget_limited" as const },
    };
    expect(loopTerminal(held, spent)).toMatch(/^budget-limited/);
  });

  it("reports the selector-owned stop after a held candidate", () => {
    expect(
      loopTerminal(
        result("candidate", {
          move: "rebuild",
          promoted: false,
          experiment: "climb",
          nextMove: "stop",
          nextReason: "difficulty setting is inconsistent",
        }),
        quiet,
      ),
    ).toBe("stopped: difficulty setting is inconsistent");
  });

  it("continues a reused measurement until a real loop guard ends it", () => {
    expect(loopTerminal(result("reused", { measured: true }), quiet)).toBeNull();
    expect(loopTerminal(result("reused"), quiet)).toBeNull();
    const spent = { ...quiet, budget: { status: () => "budget_limited" as const } };
    expect(loopTerminal(result("reused", { measured: true }), spent)).toMatch(/^budget-limited/);
  });

  // truss-run6-opus-0902 closed on four held clauses and `terminalEvidence: null`, so the reader
  // had to guess which file states the hold. The recorded promotion row is that file.
  it("cites the promotion row behind a held candidate, and nothing behind any other ending", () => {
    const held = result("candidate");
    // SAFETY: terminalEvidenceFor reads only promotion.runId off this step.
    held.steps.promotion = {
      runId: "run-02",
      decision: "held",
      clauses: ["candidate-zero-verified"],
    } as never;
    expect(terminalEvidenceFor("candidate-held: the climb candidate was held", held, "slug")).toEqual([
      "campaigns/slug/promotions/run-02.json",
    ]);
    // A hold with no promotion row cites nothing rather than [].
    expect(
      terminalEvidenceFor("candidate-held: the climb candidate was held", result("candidate"), "slug"),
    ).toBeNull();
    // Every other ending stays prose-only, promotion row or not.
    expect(terminalEvidenceFor("stopped: limit-reached", held, "slug")).toBeNull();
    expect(terminalEvidenceFor(null, held, "slug")).toBeNull();
  });

  it("continues an adopted fresh build without asking whether its evidence changed", () => {
    // The loop once ended any round that changed no admitted climb evidence. Both recorded
    // firings were wrong (run 45 read refused batteries as absent; run 68 stopped 80 seconds
    // after recording a blocking, repair-promotable admission), so no staleness guard sits here:
    // the round cap, the budget gate and the decision layer's own stops bound the loop.
    expect(loopTerminal(result("adopted"), quiet)).toBeNull();
    expect(loopTerminal(result("candidate", { promoted: true }), quiet)).toBeNull();
  });

  it("reads the table before the guards: a stopped round says stopped even on a spent budget", () => {
    const spent: LoopState = {
      ...quiet,
      budget: { status: () => "budget_limited" },
    };
    expect(loopTerminal(result("stopped", { reason: "limit-reached" }), spent)).toBe(
      "stopped: limit-reached",
    );
    // The same guard state ends a round the table would have continued.
    expect(loopTerminal(result("adopted"), spent)).toMatch(/^budget-limited/);
  });
});

/** The blocked-round counter reads the returned measurement claim. A present claim resets
 *  the counter even when its pass rate is zero; a measured round with a null claim increments
 *  it. A round without measurement leaves the previous count unchanged. */
describe("nextBlockedRounds", () => {
  const blocked = double<IterationResult>({ steps: { measure: { claim: null } } });
  const claimed = double<IterationResult>({
    steps: { measure: { claim: { statement: { passRate: 0 } } } },
  });
  const unmeasured = double<IterationResult>({ steps: { measure: null } });

  it("increments on a blocked battery, resets on any returned claim, holds otherwise", () => {
    expect(nextBlockedRounds(0, blocked)).toBe(1);
    expect(nextBlockedRounds(2, blocked)).toBe(3);
    // A present claim resets the count even when no cases passed.
    expect(nextBlockedRounds(2, claimed)).toBe(0);
    // A round that drove no battery says nothing either way about the environment.
    expect(nextBlockedRounds(2, unmeasured)).toBe(2);
  });

  /** Campaign 3fd52f9e-28 recorded three consecutive provider-stopped batteries on 2026-09-17
   *  (11, 14 then 24 of 25 cases non-results). Each wrote a claim refused for that same dead
   *  provider, which reset this counter, so the declared allowance never engaged and three more
   *  authoring rounds opened. A refusal the provider caused is not a delivery. */
  const providerStopped = (created: boolean) =>
    double<IterationResult>({ steps: { measure: { disposition: "provider-stopped", claim: { created } } } });

  it("counts a battery the provider stopped before it could produce a claim", () => {
    expect(nextBlockedRounds(0, providerStopped(false))).toBe(1);
    expect(nextBlockedRounds(2, providerStopped(false))).toBe(3);
    // Enough cases were measured to create the claim, so the provider did deliver evidence.
    expect(nextBlockedRounds(2, providerStopped(true))).toBe(0);
  });
});

describe("heldInLoop", () => {
  it("heldInLoop reads the hold and the refused claim's clauses, nothing else", () => {
    const step = (
      promotion: "promoted" | "held" | null,
      claim: null | { created: boolean; clauses: Array<{ repairable: boolean }> },
    ) =>
      // SAFETY: heldInLoop reads only promotion.decision, measure.claim.created and measure.claim.clauses[].repairable.
      ({ promotion: promotion === null ? null : { decision: promotion }, measure: { claim } }) as never;
    const inLoop = { created: false, clauses: [{ repairable: true }, { repairable: true }] };
    expect(heldInLoop(step("held", inLoop))).toBe(true);
    // A clause that blames the candidate's bytes, a created claim that still lost to current, an
    // environment-blocked battery and a promoted candidate all keep the ordinary settlement.
    expect(
      heldInLoop(step("held", { created: false, clauses: [{ repairable: true }, { repairable: false }] })),
    ).toBe(false);
    expect(heldInLoop(step("held", { created: true, clauses: [] }))).toBe(false);
    expect(heldInLoop(step("held", null))).toBe(false);
    expect(heldInLoop(step("promoted", inLoop))).toBe(false);
    expect(heldInLoop(step(null, inLoop))).toBe(false);
  });
});

/**
 * Whether the model that solved the battery is evidenced or merely configured.
 *
 * A backend pin is what the operator asked for. The runtime census is what the provider reported.
 * When they match on every scored case, the claim states `provider-native`; when the evidence is
 * absent, incomplete or attested by a different transport, the pin is configuration and the claim
 * must not present it as proof.
 *
 * The line between refusing and disclosing is the one this file spends most of its cases on, and
 * two recorded runs set it. Both Astra claims of 2026-09-08 were refused because pi-ai's codex
 * route reports no served model at all — a fact about the route, so the claim now discloses
 * `unverified` instead. c1d2a7-i04's canopy-03 passed the verifier and then lost its one outer
 * turn to the whole-solve wall, leaving no census row; that absence refused a whole battery and
 * held the only round of the run with failing cases. An absence is not a contradiction. A
 * mismatch still is.
 */
import { describe, expect, it } from "bun:test";
import type { RuntimeModelIdentity } from "../src/claim/runtime-model-identity.ts";
import { double } from "./helpers/doubles.ts";
import {
  GREEN_SCORE,
  claudeIdentities,
  clauseDetail,
  clauseNames,
  codexIdentities,
  createClaim,
  greenEvidence,
  identityAt,
  identityRowAt,
} from "./helpers/claim-evidence.ts";

const CLAUDE_PIN = "claude/claude-opus-4-8";
const UNPROVEN = "runtime-model-identity-unproven";
/** Raised when the census did record an identity and it names another condition. Separate from
 *  UNPROVEN since 2026-09-20: both refuse the claim, but `climb-battery-admission.ts` admits an
 *  unproven battery into the difficulty population and must keep a contradicted one out. */
const CONTRADICTED = "runtime-model-identity-contradicted";

/** The clauses a Claude-pinned battery carries with this census and nothing else changed. */
const claudeClauses = (runtimeIdentities: ReturnType<typeof claudeIdentities>) =>
  clauseNames(createClaim(greenEvidence({ backendPin: CLAUDE_PIN, runtimeIdentities })));

describe("a census that proves the pin", () => {
  it("states provider-native for a complete matching census whose native session is explicitly absent", () => {
    for (const [backendPin, runtimeIdentities] of [
      ["codex/gpt-5.5", codexIdentities()],
      [CLAUDE_PIN, claudeIdentities()],
    ] as const) {
      const result = createClaim(greenEvidence({ backendPin, runtimeIdentities }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.statement.modelIdentity).toBe("provider-native");
    }
  });

  it("keeps a case claimable when one outer turn aborted and the next completed", () => {
    // Two outer turns, the first aborted with no provider result, the second completed. One
    // identity for one completed turn is honest — the exact regression the old
    // `identities.length === turns` invariant sank.
    const abortThenComplete = claudeIdentities();
    identityRowAt(abortThenComplete, 0).turns = 2;
    expect(
      createClaim(greenEvidence({ backendPin: CLAUDE_PIN, runtimeIdentities: abortThenComplete })).ok,
    ).toBe(true);
  });
});

describe("an absent attestation discloses; a contradicted one refuses", () => {
  it("refuses a supported pin with no census at all", () => {
    const evidence = greenEvidence({ backendPin: "codex/gpt-5.5" });
    delete evidence.runtimeIdentities;
    const result = createClaim(evidence);
    expect(result.ok).toBe(false);
    expect(clauseNames(result)).toContain(UNPROVEN);
    // The same holds for a Claude pin that never recorded identity evidence.
    const claudeEvidence = greenEvidence({ backendPin: CLAUDE_PIN });
    delete claudeEvidence.runtimeIdentities;
    expect(clauseNames(createClaim(claudeEvidence))).toContain(UNPROVEN);
    // And the nearest hostile case, which this assertion used to be by accident: the green
    // evidence's default census is a codex one, so under a Claude pin it is not an absence at
    // all. It names another provider and another model, which is the contradiction clause.
    expect(clauseNames(createClaim(greenEvidence({ backendPin: CLAUDE_PIN })))).toEqual([CONTRADICTED]);
  });

  it("discloses unverified for a route that reports no served model, and refuses a wrong one", () => {
    // Astra run 23a1bc, i01 and i02: every Codex case recorded
    // `provider.model: null` because pi-ai's codex route never reports a served model, and both
    // 25-case claims were refused on that alone.
    const rows = claudeIdentities();
    for (let index = 0; index < rows.length; index += 1) {
      const identity = identityAt(rows, index);
      identity.provider = { ...identity.provider, id: "openai-codex", model: null };
    }
    const result = createClaim(greenEvidence({ backendPin: "codex/gpt-6-astra", runtimeIdentities: rows }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.statement.modelIdentity).toBe("unverified");
    // The nearest hostile case: a reported model that differs from the pin is a mismatch, not an absence.
    identityAt(rows, 0).provider.model = "some-other-model";
    const mismatched = createClaim(
      greenEvidence({ backendPin: "codex/gpt-6-astra", runtimeIdentities: rows }),
    );
    expect(mismatched.ok).toBe(false);
    expect(clauseNames(mismatched)).toContain(CONTRADICTED);
    expect(clauseDetail(mismatched, CONTRADICTED)).toContain('was served model "some-other-model"');
  });

  it("states unverified, and refuses nothing, when graded bytes carry no attestation", () => {
    // c1d2a7-i04's canopy-03 drove 58 tool calls, submitted and passed the verifier; the whole-solve
    // wall then ended its one outer turn, which closed no provider result and left the census with
    // no row. The battery's whole claim was refused on that absence.
    const unproven = claudeIdentities();
    identityRowAt(unproven, 0).completedTurns = 0;
    identityRowAt(unproven, 0).identities = [];
    const result = createClaim(greenEvidence({ backendPin: CLAUDE_PIN, runtimeIdentities: unproven }));
    expect(clauseNames(result)).toEqual([]);
    if (result.ok) expect(result.statement.modelIdentity).toBe("unverified");
  });

  it("refuses a case whose bytes never reached the verifier, and names it as scored", () => {
    // Run 81's i03 refusal listed five caseIds as "completed no provider result"; five review
    // sessions and the operator packet all filed those ids against the ledger's typed non-results,
    // which are a disjoint set. Nothing was graded here, so the missing attestation is the identity
    // of nothing — but the clause has to say what the case is: scored, inside the denominator,
    // identity unproven.
    const ungraded = claudeIdentities();
    const row = identityRowAt(ungraded, 0);
    row.turns = 3; // every outer turn aborted, so no provider evidence can exist
    row.completedTurns = 0;
    row.identities = [];
    const score = GREEN_SCORE.map((c) => (c.caseId === "t1" ? { ...c, truthVerified: false } : c));
    const result = createClaim(greenEvidence({ backendPin: CLAUDE_PIN, runtimeIdentities: ungraded }), score);
    expect(clauseNames(result)).toContain(UNPROVEN);
    const detail = clauseDetail(result, UNPROVEN);
    expect(detail).toContain('scored case "t1" has no recorded provider identity');
    expect(detail).toContain("identity unproven, not a non-result");
    expect(detail).not.toContain('case "t1" completed no provider result');
  });
});

describe("a census the pinned transport did not produce", () => {
  it("refuses rows attested by anthropic under a codex pin, however the models are named", () => {
    // Anthropic-attested identities with only the model strings relabelled to match a codex pin.
    // The provider attestation still says "anthropic", so nothing proves the pinned route produced them.
    const relabelled = claudeIdentities().map((row) => ({
      ...row,
      identities: row.identities.map((identity) => ({
        ...identity,
        provider: { ...identity.provider, model: "gpt-5.5" },
      })),
    }));
    expect(
      clauseNames(createClaim(greenEvidence({ backendPin: "codex/gpt-5.5", runtimeIdentities: relabelled }))),
    ).toContain(CONTRADICTED);
    const openrouter = claudeIdentities();
    identityAt(openrouter, 0).provider.id = "openrouter";
    expect(claudeClauses(openrouter)).toContain(CONTRADICTED);
  });

  it("refuses a pin whose model segment is blank, even when blank-model identities match it", () => {
    const blankModel = claudeIdentities().map((row) => ({
      ...row,
      identities: row.identities.map((identity) => ({
        ...identity,
        provider: { ...identity.provider, model: "" },
      })),
    }));
    expect(
      clauseNames(createClaim(greenEvidence({ backendPin: "claude/", runtimeIdentities: blankModel }))),
    ).toContain(UNPROVEN);
  });

  it("refuses a census row naming a case the score does not contain", () => {
    const extra = claudeIdentities();
    // The ghost row gets its own session and result so only the unscored-case reading can fire.
    const ghost = structuredClone(identityAt(extra, 0));
    ghost.agentRuntime.sessionId = "pi-session-ghost";
    ghost.provider.resultId = "pi-result-ghost";
    extra.push({ caseId: "ghost", turns: 1, completedTurns: 1, identities: [ghost] });
    expect(claudeClauses(extra)).toContain(UNPROVEN);
  });

  it("refuses two census rows for one scored case", () => {
    const duplicated = claudeIdentities();
    duplicated.push(structuredClone(identityRowAt(duplicated, 0)));
    expect(claudeClauses(duplicated)).toContain(UNPROVEN);
  });

  it("reads a row recorded in an earlier identity shape as incomplete, not as a crash", () => {
    const earlier = claudeIdentities();
    identityRowAt(earlier, 0).identities = [
      double<RuntimeModelIdentity>({ transport: "claude", model: "claude-opus-4-8" }),
    ];
    expect(claudeClauses(earlier)).toEqual([UNPROVEN]);
  });
});

describe("an incomplete or contradicted identity", () => {
  it("refuses a served model the pin does not match", () => {
    const modelMismatch = claudeIdentities();
    identityAt(modelMismatch, 0).provider.model = "claude-sonnet-4-6";
    expect(claudeClauses(modelMismatch)).toContain(CONTRADICTED);
    const codexMismatch = codexIdentities();
    identityAt(codexMismatch, 0).provider.model = "some-other-model";
    expect(
      clauseNames(
        createClaim(greenEvidence({ backendPin: "codex/gpt-5.5", runtimeIdentities: codexMismatch })),
      ),
    ).toContain(CONTRADICTED);
  });

  it("refuses every field of the identity that can go missing or blank", () => {
    const mutations: Array<(rows: ReturnType<typeof claudeIdentities>) => void> = [
      (rows) => {
        identityAt(rows, 0).provider.model = null;
      },
      (rows) => {
        // Present-but-blank is a recording defect, unlike the explicit null the green fixture carries.
        identityAt(rows, 0).provider.nativeSessionId = "";
      },
      (rows) => {
        identityAt(rows, 0).agentRuntime.version = "";
      },
      (rows) => {
        identityAt(rows, 0).agentRuntime.sessionId = "";
      },
      (rows) => {
        identityAt(rows, 0).provider.resultId = null;
      },
      (rows) => {
        identityAt(rows, 0).provider.resultId = "";
      },
    ];
    for (const mutate of mutations) {
      const incomplete = claudeIdentities();
      mutate(incomplete);
      expect(claudeClauses(incomplete)).toContain(UNPROVEN);
    }
  });

  it("refuses a completed turn that recorded no identity", () => {
    // A case that settled two provider results but recorded one identity has a completed turn with
    // no provider evidence. Turns may legitimately exceed completedTurns, so the block keys off
    // completedTurns.
    const missing = claudeIdentities();
    identityRowAt(missing, 0).turns = 2;
    identityRowAt(missing, 0).completedTurns = 2;
    expect(claudeClauses(missing)).toContain(UNPROVEN);
  });

  it("still names the contradiction when the same case's identity count is short", () => {
    // Two clauses, two owners. A count short of the completed turns is a broken census, which
    // says only that the pin was not evidenced, and `climb-battery-admission.ts` reads that as an
    // environment clause. The one identity the row does carry names a different served model,
    // which says a different condition was measured. Reading the count first dropped the second
    // sentence, and the battery routed to the environment owner with a wrong-model census in it.
    const crossed = claudeIdentities();
    identityRowAt(crossed, 0).turns = 2;
    identityRowAt(crossed, 0).completedTurns = 2;
    identityAt(crossed, 0).provider.model = "gpt-5.5";
    const clauses = claudeClauses(crossed);
    expect(clauses).toContain(UNPROVEN);
    expect(clauses).toContain(CONTRADICTED);
  });

  it("still names it when the turn counts themselves are unreadable", () => {
    // The same two owners, one exit earlier. The row above was repaired by moving the read over
    // the identity-count check; the two turn-count checks stayed above it, so a census whose
    // totals do not add up still took its crossed identities out through the environment owner.
    // A damaged row is the kind likeliest to carry one.
    const noTurns = claudeIdentities();
    identityRowAt(noTurns, 0).turns = 0;
    identityAt(noTurns, 0).provider.model = "gpt-5.5";
    expect(claudeClauses(noTurns)).toContain(UNPROVEN);
    expect(claudeClauses(noTurns)).toContain(CONTRADICTED);

    const overCounted = claudeIdentities();
    identityRowAt(overCounted, 0).completedTurns = 4;
    identityAt(overCounted, 0).provider.model = "gpt-5.5";
    expect(claudeClauses(overCounted)).toContain(UNPROVEN);
    expect(claudeClauses(overCounted)).toContain(CONTRADICTED);
  });

  it("does not accuse an incomplete identity of reusing a result id", () => {
    // live-run-06 chfw-09: four completed turns and the early identities degraded. The old early
    // break stopped set population at the first incomplete identity, and the size comparison then
    // reported "reused or omitted a provider result id" — evidence stating something that did not
    // happen. The block itself must survive; the false clause must not.
    const degraded = claudeIdentities();
    const row = identityRowAt(degraded, 0);
    row.turns = 4;
    row.completedTurns = 4;
    const base = identityAt(degraded, 0);
    row.identities = [0, 1, 2, 3].map((turn) => ({
      ...base,
      provider: { ...base.provider, resultId: turn < 3 ? null : "pi-result-turn-4" },
    }));
    const result = createClaim(greenEvidence({ backendPin: CLAUDE_PIN, runtimeIdentities: degraded }));
    expect(clauseNames(result)).toEqual([UNPROVEN]);
    expect(clauseDetail(result, UNPROVEN)).toContain("incomplete provider identity");
    expect(clauseDetail(result, UNPROVEN)).not.toContain("reused or omitted");
  });

  it("refuses a session that changes, or a result id that repeats, across one case's turns", () => {
    const changedSession = claudeIdentities();
    const changedRow = identityRowAt(changedSession, 0);
    changedRow.turns = 2;
    changedRow.completedTurns = 2;
    const second = structuredClone(identityAt(changedSession, 0));
    second.agentRuntime.sessionId = "pi-session-1b"; // a different runtime session mid-case
    second.provider.resultId = "pi-result-1b";
    changedRow.identities = [identityAt(changedSession, 0), second];
    expect(claudeClauses(changedSession)).toContain(UNPROVEN);

    const reusedResult = claudeIdentities();
    const reusedRow = identityRowAt(reusedResult, 0);
    reusedRow.turns = 2;
    reusedRow.completedTurns = 2;
    // The same runtime session is legitimate — a nudge stays in one session — but not the same result id.
    reusedRow.identities = [identityAt(reusedResult, 0), structuredClone(identityAt(reusedResult, 0))];
    expect(claudeClauses(reusedResult)).toContain(UNPROVEN);
  });

  it("refuses two cases that share one session or one provider result", () => {
    const reusedRuntime = claudeIdentities();
    identityAt(reusedRuntime, 1).agentRuntime.sessionId = identityAt(reusedRuntime, 0).agentRuntime.sessionId;
    expect(claudeClauses(reusedRuntime)).toContain(UNPROVEN);

    const reusedResultId = claudeIdentities();
    identityAt(reusedResultId, 1).provider.resultId = identityAt(reusedResultId, 0).provider.resultId;
    expect(claudeClauses(reusedResultId)).toContain(UNPROVEN);
  });
});

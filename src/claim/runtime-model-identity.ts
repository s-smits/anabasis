/** Runtime identity evidence and the shared identity check used by claim creation. */

/**
 * Pi's identity. Pi owns an agent-runtime session but exposes no provider-native session, so those
 * facts stay separate instead of putting an empty sentinel into one session field.
 */
export type RuntimeModelIdentity = {
  schema: "runtime-model-identity/v2";
  agentRuntime: {
    id: "pi-agent-core";
    version: string;
    sessionId: string;
  };
  provider: {
    id: "anthropic" | "openai-codex" | "openrouter";
    /** Provider-reported served model. Null means the transport supplied no unambiguous attestation. */
    model: string | null;
    resultId: string | null;
    nativeSessionId: string | null;
  };
};

/** One scored case's complete outer-turn identity census. */
export interface RuntimeIdentityCaseEvidence {
  caseId: string;
  /** Every outer turn the solve drove, including turns that completed no provider result. */
  turns: number;
  /** Outer turns that completed a provider result. */
  completedTurns: number;
  identities: RuntimeModelIdentity[];
}

/** The provider each pinned backend kind reaches. */
const PROVIDER_BY_BACKEND_KIND = {
  claude: "anthropic",
  codex: "openai-codex",
  openrouter: "openrouter",
} as const;

interface IdentityObservation {
  sessionId: string;
  resultId: string | null;
  /** A field the census should carry is missing or blank: nothing was recorded to compare. */
  incomplete: boolean;
  /** Something the census did record disagrees with the pin — a different served model, or a
   *  different transport or provider attesting the row. This is the opposite of `incomplete`:
   *  the run produced evidence, and the evidence names another condition. The two are separate
   *  because the difficulty population admits absence and must refuse contradiction
   *  (`src/run/climb-battery-admission.ts`): a battery some other model solved carries no
   *  information about this product's tasks, while one whose provider recorded nothing carries
   *  its scores unchanged. Before 2026-09-20 both were one boolean and one clause name. */
  contradictions: string[];
  /** The transport reports no served model by construction; the pin stays configuration. */
  unattested: string | null;
}

/** Pi's unpatched Codex Responses parser does not expose the served model. */
const UNATTESTING_PROVIDER = "openai-codex";

/** The three lists a census inspection appends to: blocking findings, contradictions of the pin
 *  and rows whose transport attests no served model. */
type IdentityCensusFindings = {
  readonly invalid: string[];
  readonly contradicted: string[];
  readonly unattested: string[];
};

/**
 * Evaluate the scored cases' runtime-identity census against the pinned backend: a stable, unique
 * Pi runtime session per case, with the provider-native session permitted to be explicitly null.
 */
interface RuntimeIdentityFindingsResult {
  /** A census that is absent, blank or internally inconsistent: nothing here says another model
   *  ran, only that this one was not evidenced. */
  blocking: string[];
  /** Recorded evidence that disagrees with the pin — another served model, transport or provider.
   *  Refuses alongside `blocking`, under its own clause, because a contradicted battery measured
   *  a different condition and the climb must not read it as this product's. */
  contradicted: string[];
  /** No attestation was recorded — the pinned transport reports no served model, or a verified
   *  case's turn closed no provider result. The identity stays unverified and nothing refuses. */
  unattested: string[];
}

function expectedProvider(kind: string): string {
  return kind in PROVIDER_BY_BACKEND_KIND
    ? PROVIDER_BY_BACKEND_KIND[
        /* SAFETY: reached only when `kind in PROVIDER_BY_BACKEND_KIND`. */ kind as keyof typeof PROVIDER_BY_BACKEND_KIND
      ]
    : kind;
}

/** What a row records and the pin disagrees about. A null served model is absence, handled by
 *  `incomplete` and `unattested` below, so only a reported one can contradict. */
function piContradictions(
  identity: RuntimeModelIdentity,
  pin: { kind: string; model: string },
  caseId: string,
): string[] {
  const rows: string[] = [];
  if (identity.provider.id !== expectedProvider(pin.kind)) {
    rows.push(
      `case "${caseId}" carries an identity attested by provider "${identity.provider.id}", not the pinned transport's "${expectedProvider(pin.kind)}" provider`,
    );
  }
  if (identity.provider.model !== null && identity.provider.model !== pin.model) {
    rows.push(
      `case "${caseId}" was served model "${identity.provider.model}", not the pinned "${pin.model}"`,
    );
  }
  return rows;
}

function inspectPiIdentity(
  identity: RuntimeModelIdentity,
  pin: { kind: string; model: string },
  caseId: string,
): IdentityObservation {
  const nativeSessionInvalid = identity.provider.nativeSessionId?.trim() === "";
  return {
    sessionId: identity.agentRuntime.sessionId,
    resultId: identity.provider.resultId,
    incomplete:
      identity.agentRuntime.id !== "pi-agent-core" ||
      identity.agentRuntime.version.trim() === "" ||
      identity.agentRuntime.sessionId.trim() === "" ||
      (identity.provider.model === null && identity.provider.id !== UNATTESTING_PROVIDER) ||
      nativeSessionInvalid ||
      identity.provider.resultId === null ||
      identity.provider.resultId.trim() === "",
    contradictions: piContradictions(identity, pin, caseId),
    // Substituting the pinned model for the Codex route's absent attestation was removed, and
    // both Astra claims of 2026-09-08 were then refused on that absence alone. The absence is a
    // fact about the route rather than about the run, so the identity stays unverified without
    // refusing the claim. Any other provider's null model, and any different reported model,
    // still refuses.
    unattested:
      identity.provider.model === null && identity.provider.id === UNATTESTING_PROVIDER
        ? `case "${caseId}": provider "${identity.provider.id}" reported no served model, so the pinned model is configuration rather than attestation`
        : null,
  };
}

/** A row in any other shape was recorded before this census and is unreadable: incomplete. */
function inspectIdentity(
  identity: RuntimeModelIdentity,
  pin: { kind: string; model: string },
  caseId: string,
): IdentityObservation {
  if (identity.schema === "runtime-model-identity/v2") return inspectPiIdentity(identity, pin, caseId);
  return { sessionId: "", resultId: null, incomplete: true, contradictions: [], unattested: null };
}

function inspectCase(
  row: RuntimeIdentityCaseEvidence,
  pin: { kind: string; model: string },
  /** Whether this case's accepted artifact bytes reached the correctness model and got a verdict. */
  truth: "verified" | "unverified",
  found: IdentityCensusFindings,
): string | null {
  const { invalid, contradicted, unattested } = found;
  // Read before any branch returns, including the two counts below. Each refusal here records the
  // case as `blocking`, and `blocking` says only that the pin was not evidenced — an absent, blank
  // or internally inconsistent census. An identity naming another served model says something else
  // entirely: that a different condition was measured. The two clauses route to different owners,
  // one of them an environment clause, so a contradiction recorded beside a broken count must not
  // leave through the count's exit. It sat under the count checks until 2026-09-20, where a census
  // whose turn totals disagreed took its crossed identities with it, and the reading a wrong-model
  // run needs is exactly the one a damaged row is likeliest to carry. Nothing here reads a count,
  // so the order costs one map over rows a refusal would discard.
  const observations = row.identities.map((identity) => inspectIdentity(identity, pin, row.caseId));
  for (const observation of observations) contradicted.push(...observation.contradictions);
  if (!Number.isInteger(row.turns) || row.turns <= 0) {
    invalid.push(`case "${row.caseId}" records a non-positive outer-turn count (${String(row.turns)})`);
    return null;
  }
  if (!Number.isInteger(row.completedTurns) || row.completedTurns < 0 || row.completedTurns > row.turns) {
    invalid.push(
      `case "${row.caseId}" records ${String(row.completedTurns)} completed of ${String(row.turns)} outer turn(s)`,
    );
    return null;
  }
  if (row.completedTurns === 0) {
    // Named as a scored case on purpose: this clause lists cases inside the verified denominator
    // whose provider identity is unproven. Run 81's clause read as a non-result list, and six
    // independent readers filed these ids against that run's typed non-results.
    //
    // Absence of an attestation is not a contradiction in one. When the case's bytes reached the
    // verifier and got a verdict, nothing here says the wrong model ran; the census simply holds
    // no row, because a turn the whole-solve wall cuts closes no provider result. c1d2a7's
    // canopy-03 is that case exactly: 58 tool calls, an accepted submit, a verifier pass, and an
    // ended turn at the two-hour wall. It refused its battery's whole claim, which held the only
    // round of that run with failing cases. `unattested` is the bucket for it — the statement
    // leaves `modelIdentity` unverified and nothing refuses — and it is the same line
    // `src/truth/runtime-blocker.ts` draws on this count, where zero completed turns is an
    // environment blocker only with no tool calls and no accepted submit.
    //
    // An unverified case keeps the refusal, because no bytes were graded and there is nothing the
    // missing attestation would have been the identity of.
    (truth === "verified" ? unattested : invalid).push(
      `scored case "${row.caseId}" has no recorded provider identity (identity unproven, not a non-result) across ${String(row.turns)} outer turn(s)`,
    );
    return null;
  }
  if (row.identities.length !== row.completedTurns) {
    invalid.push(
      `case "${row.caseId}" records ${row.identities.length} identities for ${String(row.completedTurns)} completed turn(s) of ${String(row.turns)} outer turn(s)`,
    );
    return null;
  }
  for (const observation of observations) {
    if (observation.unattested !== null) unattested.push(observation.unattested);
  }
  const incomplete = observations.some((observation) => observation.incomplete);
  if (incomplete) invalid.push(`case "${row.caseId}" carries an incomplete provider identity`);
  const sessions = new Set(observations.map((observation) => observation.sessionId));
  if (sessions.size !== 1) invalid.push(`case "${row.caseId}" changed runtime session across outer turns`);
  const resultIds = new Set(
    observations.flatMap((observation) => (observation.resultId === null ? [] : [observation.resultId])),
  );
  if (!incomplete && resultIds.size !== row.identities.length) {
    invalid.push(`case "${row.caseId}" reused or omitted a provider result id across outer turns`);
  }
  return observations[0]?.sessionId ?? null;
}

export function runtimeIdentityFindings(
  pin: { kind: string; model: string },
  rows: RuntimeIdentityCaseEvidence[] | null | undefined,
  score: readonly { caseId: string; truthVerified: boolean }[],
): RuntimeIdentityFindingsResult {
  const invalid: string[] = [];
  const contradicted: string[] = [];
  const unattested: string[] = [];
  // A pin missing a segment contradicts nothing; it leaves the comparison without one of its two
  // sides, which is the absence case.
  if (pin.kind.trim() === "" || pin.model.trim() === "") {
    invalid.push("backend pin does not name both a transport and a model segment");
  }
  if (!Array.isArray(rows)) {
    invalid.push("no runtime-identity census was recorded");
    return { blocking: invalid, contradicted, unattested };
  }
  const byCase = new Map<string, RuntimeIdentityCaseEvidence[]>();
  for (const row of rows) byCase.set(row.caseId, [...(byCase.get(row.caseId) ?? []), row]);
  // Pair each scored case with its truth state for `inspectCase`.
  const scored = new Map(
    score.map((row) => [row.caseId, row.truthVerified ? "verified" : "unverified"] as const),
  );
  const caseSessions: string[] = [];
  const resultIds: string[] = [];
  for (const [caseId, truth] of scored) {
    const matches = byCase.get(caseId) ?? [];
    if (matches.length !== 1) {
      invalid.push(`case "${caseId}" has ${matches.length} runtime-identity rows`);
      continue;
    }
    const sessionId = inspectCase(
      /* SAFETY: the check above returned when `matches.length !== 1`, so index 0 exists. */ matches[0] as RuntimeIdentityCaseEvidence,
      pin,
      truth,
      { invalid, contradicted, unattested },
    );
    if (sessionId !== null) caseSessions.push(sessionId);
    for (const identity of matches[0]?.identities ?? []) {
      const resultId = identity.schema === "runtime-model-identity/v2" ? identity.provider.resultId : null;
      if (resultId !== null && resultId.trim() !== "") resultIds.push(resultId);
    }
  }
  for (const caseId of byCase.keys()) {
    if (!scored.has(caseId)) invalid.push(`runtime identity names unscored case "${caseId}"`);
  }
  if (caseSessions.some((sessionId) => sessionId.trim() === "")) {
    invalid.push("one or more case sessions are blank");
  } else if (new Set(caseSessions).size !== caseSessions.length) {
    invalid.push("a runtime session was reused across scored cases");
  }
  if (new Set(resultIds).size !== resultIds.length) {
    invalid.push("a provider result id was reused across scored cases");
  }
  return { blocking: invalid, contradicted, unattested };
}

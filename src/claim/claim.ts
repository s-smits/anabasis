/**
 * Writing a claim from recorded evidence, rather than from completion stated in prose.
 *
 * `Claim.create()` reads the evidence first and returns every blocking clause at once, because a
 * repair loop that peels one clause per round pays for a full rerun per defect. Only when the list
 * is empty does the write happen, and the write itself is guarded twice: a private constructor
 * stops callers at compile time, and a module-private token stops them at runtime. The audit that
 * prompted the brand found `{ ok: true, statement }` compiling clean with no `new` and no cast.
 *
 * `claim-evidence.ts` owns the vocabulary these clauses read. This module owns the decisions.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { GroundingEvidence } from "../truth/grounding.ts";
import { type ToolCheckCoverage, toolCheckCoverage } from "../truth/grounding-coverage.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type {
  BundleHashesEvidence,
  ClaimClause,
  ClaimCreationInput,
  ClaimEvidence,
  ClaimStatement,
  PredictionItem,
  RunStatusEvidence,
  ScoredCase,
} from "./claim-evidence.ts";
import { InvalidReviewEvidenceError, validateJudgeEvidence } from "./judge.ts";
import { PROVIDER_STOPPED_REASON_PREFIX } from "./record-events.ts";
import { runtimeIdentityFindings } from "./runtime-model-identity.ts";
import { hasText } from "../meta/text.ts";

/** Whether a clause's remedy is in-loop. `BLOCKING` needs the product rebuilt before another run;
 *  `IN_LOOP` is resume, rerun or prediction closure, and a refusal is repairable only when every
 *  clause on it is. They are read from the first clause producer below, so they are declared here. */
const BLOCKING = "blocking";
const IN_LOOP = "in-loop";

/** The evidence a run has once every clause producer stayed silent. Each field is nullable on
 *  {@link ClaimEvidence} and proved present by a named producer: `bundles` by `bundleClauses`
 *  and `grounding` by `groundingClauses`. Narrowing once here is what lets the statement be
 *  assembled without repeating an assertion per field. */
type ClaimableEvidence = ClaimEvidence & {
  bundles: BundleHashesEvidence;
  grounding: GroundingEvidence;
};

type IdentityFindings = ReturnType<typeof runtimeIdentityFindings>;

const WRITE: unique symbol = Symbol("ana-claim-write");

export class NonClaimable {
  readonly ok = false as const;
  constructor(readonly clauses: ClaimClause[]) {}

  /** True when every blocking clause has an in-loop remedy — continue, don't hard-stop. */
  get repairable(): boolean {
    return this.clauses.length > 0 && this.clauses.every((c) => c.repairable);
  }
}

export class Claim {
  readonly ok = true as const;
  readonly statement: ClaimStatement;
  // A class without a private member can be satisfied by an object literal: the audit's
  // { ok: true, statement } compiled without calling Claim.create(). A private brand makes
  // TypeScript reject that shortcut, requiring callers to pass through evidence validation.
  declare private readonly brand: typeof WRITE;

  private constructor(token: typeof WRITE, statement: ClaimStatement) {
    if (token !== WRITE) throw new Error("Create claims only with Claim.create()");
    this.statement = statement;
    Object.freeze(this.statement);
    Object.freeze(this);
  }

  /**
   * Write a claim from evidence, or return every blocking clause at once. Clause names are a
   * shared vocabulary: DISCRIMINATION_* codes pass through verbatim.
   */
  static create(input: ClaimCreationInput): Claim | NonClaimable {
    const { evidence, score } = input;

    // One evaluator for both identity consumers: the supported-transport blocking clause and the
    // modelIdentity disclosure derive from the same findings, so they can never drift apart.
    // The clauses consume `blocking` and `contradicted`, never `unattested`; the disclosure
    // additionally requires the pin to name both segments and every identity to be attested by
    // the pinned transport, so relabelled rows or a blank-model pin read unverified instead of
    // provider-native.
    const identityFindings = runtimeIdentityFindings(
      pinSegments(evidence.backendPin),
      evidence.runtimeIdentities,
      score,
    );
    assertReviewEvidenceConsistent(evidence);

    const clauses: ClaimClause[] = [
      ...caseIdentityClauses(score),
      ...runStatusClauses(evidence),
      ...conditionIdentityClauses(evidence, identityFindings),
      ...bundleClauses(evidence.bundles),
      ...groundingClauses(evidence, score),
      ...truthCheckFiringClauses(evidence),
      ...predictionClauses(evidence.predictions),
      ...denominatorClauses(evidence.runStatus, score.length),
    ];
    if (clauses.length > 0) return new NonClaimable(clauses);

    const buildInputsHash = evidence.staleness.hashes[0];
    if (!hasText(buildInputsHash)) {
      return new NonClaimable([
        clause(
          "evidence-stale",
          "no verified case has a buildInputsHash, so the run cannot support a claim",
          BLOCKING,
        ),
      ]);
    }
    // SAFETY: every nullable field ClaimableEvidence narrows pushes its own missing clause above,
    // and the empty clause list is what reaching this line means.
    return Claim.write(input, evidence as ClaimableEvidence, identityFindings, buildInputsHash);
  }

  /** Assemble the statement. Reached only with an empty clause list, so every value here is one the
   *  clause producers established rather than one this function has to check again. */
  private static write(
    input: ClaimCreationInput,
    evidence: ClaimableEvidence,
    identityFindings: IdentityFindings,
    buildInputsHash: string,
  ): Claim {
    const { score } = input;
    const { bundles, grounding } = evidence;
    const passed = score.filter((c) => c.passed).length;
    const groundings = grounding.declared.map((d) => ({
      checkId: d.checkId,
      kind: d.grounding.kind,
      adapterId: d.grounding.kind === "external-verifier" ? d.grounding.adapterId : null,
      ...keyIfDefined("requiredToolIds", d.requiredToolIds),
    }));
    return new Claim(WRITE, {
      slug: input.slug,
      runId: input.runId,
      externalCheckCoverage: externalCheckCoverage(
        groundings,
        grounding.execution,
        score,
        evidence.discrimination.attributedCheckIds,
      ),
      n: score.length,
      passed,
      passRate: passed / score.length,
      vetoed: evidence.judge.judge === "off" ? 0 : evidence.judge.vetoed,
      backendPin: evidence.backendPin,
      thresholdManifestDigest: evidence.thresholdManifestDigest,
      judge: evidence.judge.judge,
      judgeDecision: evidence.judge.judge === "off" ? null : evidence.judge.decision,
      // Copied, so a caller editing the array it passed cannot edit a written claim's condition.
      capabilities: [...evidence.capabilities],
      buildInputsHash,
      agentHash: bundles.agentHash,
      correctnessModelHash: bundles.correctnessModelHash,
      taskSetHash: bundles.taskSetHash,
      correctnessModelId: `correctness-model@${bundles.correctnessModelHash}`,
      groundings,
      verifierEnvironmentHash: grounding.execution.verifierEnvironmentHash,
      verifierTools: Object.entries(grounding.execution.tools)
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([toolId, tool]) => ({ toolId, ...tool })),
      groundingExceptions: grounding.declared.flatMap((d) =>
        d.grounding.kind === "exception"
          ? [{ checkId: d.checkId, justification: d.grounding.justification }]
          : [],
      ),
      modelIdentity:
        identityFindings.blocking.length === 0 &&
        identityFindings.contradicted.length === 0 &&
        identityFindings.unattested.length === 0
          ? "provider-native"
          : "unverified",
    });
  }
}

function clause(name: string, detail: string, remedy: "in-loop" | "blocking"): ClaimClause {
  return { clause: name, detail, repairable: remedy === "in-loop" };
}

/** Read a count safely when the Builder chose the checkId. The evaluation runner creates maps
 *  with no prototype, but parsing saved JSON creates ordinary objects with Object.prototype.
 *  Without an own-key check, an unrecorded checkId such as `constructor` could return an
 *  inherited value instead of 0. The never-observed check would then be skipped, incorrectly
 *  allowing claim creation. */
function recordedCount(record: Record<string, number>, checkId: string): number {
  return Object.hasOwn(record, checkId) ? (record[checkId] ?? 0) : 0;
}

/** The `<kind>/<model>` halves of a backend pin; a missing or unsplit pin yields two empty
 *  segments so the identity evaluator reads it as unpinned rather than as a model. */
function pinSegments(backendPin: string | null) {
  const slash = backendPin?.indexOf("/") ?? -1;
  if (!hasText(backendPin) || slash < 0) return { kind: "", model: "" };
  return { kind: backendPin.slice(0, slash), model: backendPin.slice(slash + 1) };
}

/** The grounding-coverage rows scoped to the battery's verified cases: a run on a control or an
 *  unverified attempt grounds no verified verdict. Admission computes the same rows over the
 *  control census, and readiness reads these through the same finding, so "this check's tool ran"
 *  has one computation. A check gets a row only where a verified case applied it (the case's
 *  `checkIds`, from the one applicability owner): a check whose only applicable case became a
 *  non-result had no verified opportunity, and zero launches there say nothing about its tool.
 *  Empty when nothing was verified: a zero-verified claim keeps its clauses. */
function externalCheckCoverage(
  groundings: ClaimStatement["groundings"],
  execution: GroundingEvidence["execution"],
  score: ScoredCase[],
  attributedCheckIds: Record<string, number>,
): ToolCheckCoverage[] {
  const verified = score.filter((c) => c.truthVerified);
  const verifiedCaseIds = new Set(verified.map((c) => c.caseId));
  if (verifiedCaseIds.size === 0) return [];
  const applied = new Set(verified.flatMap((c) => c.checkIds));
  return toolCheckCoverage({
    externalChecks: groundings.flatMap(({ checkId, adapterId, requiredToolIds, kind }) =>
      applied.has(checkId)
        ? [...new Set([...(adapterId === null ? [] : [adapterId]), ...(requiredToolIds ?? [])])].map(
            (toolId) => ({
              checkId,
              adapterId: toolId,
              kind: kind === "external-verifier" ? ("external" as const) : ("authored" as const),
            }),
          )
        : [],
    ),
    evidence: execution.executed
      .filter((row) => row.phase === "battery" && row.attempt === 1 && verifiedCaseIds.has(row.subjectId))
      .map((row) => ({ checkId: row.checkId, toolId: row.adapterId })),
    rejects: (checkId) => recordedCount(attributedCheckIds, checkId),
  });
}

/** A blank or repeated caseId cannot be joined to a run record or checked for double counting. */
function caseIdentityClauses(score: ScoredCase[]): ClaimClause[] {
  const clauses: ClaimClause[] = [];
  const blank = score.filter((c) => c.caseId.trim() === "").length;
  if (blank > 0) {
    clauses.push(
      clause(
        "case-identity-missing",
        `${blank} scored case(s) have an empty caseId, so they cannot be matched with run records or checked for duplicates`,
        BLOCKING,
      ),
    );
  }
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of score) {
    if (seen.has(c.caseId)) dupes.add(c.caseId);
    seen.add(c.caseId);
  }
  if (dupes.size > 0) {
    clauses.push(
      clause(
        "case-identity-duplicate",
        `case identit${dupes.size === 1 ? "y" : "ies"} [${[...dupes].join(", ")}] appear more than once; remove the duplicate where the rows are written`,
        BLOCKING,
      ),
    );
  }
  return clauses;
}

/** Run completion, build staleness and the executed discrimination verdict. */
function runStatusClauses(evidence: ClaimEvidence): ClaimClause[] {
  const clauses: ClaimClause[] = [];
  if (evidence.runStatus.state === "interrupted") {
    // Interrupted ≠ failed: non-claimable, and the remedy is resume/rerun — never "failure".
    clauses.push(
      clause(
        "run-interrupted",
        `run stopped before completion (${evidence.runStatus.reason ?? "no reason recorded"}). Resume or rerun it; an incomplete run cannot support a claim`,
        IN_LOOP,
      ),
    );
  } else if (evidence.runStatus.state !== "terminal") {
    clauses.push(
      clause(
        "run-not-terminal",
        "run has no run-terminal event; an incomplete run cannot support a claim",
        IN_LOOP,
      ),
    );
  }
  if (evidence.staleness.stale) {
    clauses.push(
      clause(
        "evidence-stale",
        `cases came from different builds [${evidence.staleness.hashes.join(", ")}], so this run cannot support a claim`,
        BLOCKING,
      ),
    );
  }
  if (!evidence.discrimination.claimable) {
    for (const finding of evidence.discrimination.findings) {
      clauses.push(clause(finding.code, finding.message, BLOCKING));
    }
  }
  return clauses;
}

/** One identity clause, or none when nothing was found. The findings are the detail: at most four
 *  are quoted and the rest counted, so a census of 25 cases does not become the clause. */
function identityClause(name: string, prefix: string, findings: readonly string[]): ClaimClause[] {
  if (findings.length === 0) return [];
  const overflow = findings.length > 4 ? `; +${findings.length - 4} more` : "";
  return [clause(name, `${prefix}: ${findings.slice(0, 4).join("; ")}${overflow}`, BLOCKING)];
}

/** The served-model identity of the named run condition. */
function conditionIdentityClauses(
  evidence: ClaimEvidence,
  identityFindings: IdentityFindings,
): ClaimClause[] {
  const clauses: ClaimClause[] = [];
  // An `unattested` row leaves `modelIdentity` unverified in the statement without refusing:
  // both Astra claims of 2026-09-08 were refused on a route that reports no served model at
  // all, which is a fact about the route, not about the scored cases.
  //
  // Absence and contradiction refuse alike but are named apart, because one reader downstream
  // treats them differently. `climb-battery-admission.ts` admits a battery refused only for an
  // unproven identity into the difficulty population: the environment failed to record who
  // solved the tasks, and the scores still describe these tasks. A contradicted census says
  // something else — another model or transport produced them — so that battery measured a
  // different condition and belongs to no product's climb. One clause name could not carry both
  // readings, and until 2026-09-20 the climb took a contradicted battery as its own.
  const supportedTransport = ["claude/", "codex/"].some((prefix) => evidence.backendPin.startsWith(prefix));
  if (supportedTransport) {
    clauses.push(
      ...identityClause(
        "runtime-model-identity-unproven",
        `backend pin "${evidence.backendPin}" is configured, but the provider did not record a complete model and session identity`,
        identityFindings.blocking,
      ),
      ...identityClause(
        "runtime-model-identity-contradicted",
        `backend pin "${evidence.backendPin}" is configured, but the recorded identity names another condition`,
        identityFindings.contradicted,
      ),
    );
  }
  return clauses;
}

/** Contradictory review evidence is a producer error; throw instead of returning a claim refusal.
 *  A clause would invite a repair loop to route around a defect in the producer. */
function assertReviewEvidenceConsistent(evidence: ClaimEvidence): void {
  validateJudgeEvidence(evidence.judge);
  if (evidence.judge.judge === "off") return;
  if (evidence.judge.evaluatedPin !== evidence.backendPin) {
    throw new InvalidReviewEvidenceError(
      `evaluatedPin ${capturedJsonStringify(evidence.judge.evaluatedPin)} does not match battery backendPin ${capturedJsonStringify(evidence.backendPin)}`,
    );
  }
  if (evidence.bundles === null) return;
  const claimCorrectnessModelId = `correctness-model@${evidence.bundles.correctnessModelHash}`;
  if (evidence.judge.correctnessModelId !== claimCorrectnessModelId) {
    throw new InvalidReviewEvidenceError(
      `correctnessModelId ${capturedJsonStringify(evidence.judge.correctnessModelId)} does not match claim Correctness Model identity ${capturedJsonStringify(claimCorrectnessModelId)}`,
    );
  }
}

function bundleClauses(bundles: BundleHashesEvidence | null): ClaimClause[] {
  if (!bundles) {
    return [
      clause(
        "bundle-hashes-missing",
        "the harness was not recorded with its agent and correctnessModel hashes; record it again before starting a new run",
        BLOCKING,
      ),
    ];
  }
  if (bundles.taskSetHash.trim() === "") {
    return [
      clause(
        "task-set-hash-missing",
        "the recorded task set has no hash, so the claim cannot identify the tasks and hidden values that were measured",
        BLOCKING,
      ),
    ];
  }
  return [];
}

function groundingClauses(evidence: ClaimEvidence, score: ScoredCase[]): ClaimClause[] {
  const { grounding } = evidence;
  if (!grounding || grounding.declared.length === 0) {
    return [
      clause("grounding-missing", "every truth check must name where its evidence comes from", BLOCKING),
    ];
  }
  const externalByCheck = new Map<string, string[]>();
  for (const { checkId, grounding: g, requiredToolIds } of grounding.declared) {
    const tools = [...(g.kind === "external-verifier" ? [g.adapterId] : []), ...(requiredToolIds ?? [])];
    if (tools.length > 0) {
      externalByCheck.set(checkId, [...new Set([...(externalByCheck.get(checkId) ?? []), ...tools])]);
    }
  }
  return [
    ...declaredGroundingClauses(grounding, evidence.discrimination.attributedCheckIds),
    ...caseGroundingClauses(grounding.execution, externalByCheck, score),
    ...executionResolutionClauses(grounding.execution),
  ];
}

/** Every declared check must have been observed doing something: an external check by an
 *  execution bound to its exact (checkId, adapterId), and both kinds by a reject control that
 *  failed on exactly this check. */
function declaredGroundingClauses(
  grounding: GroundingEvidence,
  attributedCheckIds: Record<string, number>,
): ClaimClause[] {
  const clauses: ClaimClause[] = [];
  // Whether an external check's tool ran is owned by the grounding-coverage rows: admission
  // refuses a never-launched tool before the battery, caseGroundingClauses refuses a verified case
  // without its own subject-bound run, and readiness names a check that ran on no verified case.
  for (const { checkId, grounding: g } of grounding.declared) {
    if (g.kind === "exception") continue;
    // In-process checks have no separate host tool call to attest. A reject control failing
    // only this check establishes that it discriminated that invalid artifact. This does not
    // establish which primitive caused the verdict; source and import validation are
    // authoring checks, not execution evidence. With no attributed rejects, the check has
    // not demonstrated that it can reject an invalid artifact. External checks need the same
    // evidence, under their existing clause id so older claims retain their vocabulary.
    // Launching an adapter proves only execution: esp32 runs 20 and 21 recorded complete
    // engine-adapter executions, but no control had ever made the adapter reject an artifact.
    if (recordedCount(attributedCheckIds, checkId) === 0) {
      clauses.push(
        clause(
          g.kind === "external-verifier" ? "external-grounding-uncovered" : "intrinsic-grounding-uncovered",
          `no invalid example failed check "${checkId}"; add one that fails only because of this check`,
          BLOCKING,
        ),
      );
    }
  }
  return clauses;
}

/** Per-case coverage (handover 2026-07-11). Run-level evidence previously allowed one case's
 *  or control's tool execution to satisfy the requirement for every case using the same check.
 *  Require each applicable external check to have its own execution record for the specific
 *  verified case being scored. */
function caseGroundingClauses(
  execution: GroundingEvidence["execution"],
  externalByCheck: Map<string, string[]>,
  score: ScoredCase[],
): ClaimClause[] {
  if (externalByCheck.size === 0) return [];
  const clauses: ClaimClause[] = [];
  const executedTriples = new Set(
    execution.executed.map((b) =>
      capturedJsonStringify([b.phase, b.subjectId, b.attempt, b.checkId, b.adapterId]),
    ),
  );
  for (const scored of score) {
    // A fail decided by a check with complete evidence needs no run of the tool it skipped: that
    // run could only have withheld a pass (solve-case.ts `acceptedOutcome`).
    if (!scored.truthVerified || !scored.passed) continue;
    for (const checkId of scored.checkIds) {
      for (const adapterId of externalByCheck.get(checkId) ?? []) {
        if (executedTriples.has(capturedJsonStringify(["battery", scored.caseId, 1, checkId, adapterId]))) {
          continue;
        }
        clauses.push(
          clause(
            "external-grounding-case-uncovered",
            `no adapter result was recorded for case "${scored.caseId}" and check "${checkId}"; run adapter "${adapterId}" for every applicable case`,
            BLOCKING,
          ),
        );
      }
    }
  }
  return clauses;
}

/** A tool that ran is identified by the bytes the host hashed before spawning it, never by what it
 *  reports about itself: a tool can report the same version after its binary changes. */
function executionResolutionClauses(execution: GroundingEvidence["execution"]): ClaimClause[] {
  if (execution.executed.length === 0 || execution.verifierEnvironmentHash !== null) return [];
  return [
    clause(
      "grounding-environment-unfingerprinted",
      "external checks ran without a verifierEnvironmentHash; record the executed tool digests so runs can be compared",
      BLOCKING,
    ),
  ];
}

/** Detect authored checks that never ran despite having applicable verified cases. In hw1,
 *  all 16 cases passed without the answer-key comparison executing, yet the claim was ready.
 *  These runtime counts complement tasks-check-unexercised, which establishes only that
 *  tasks declare a check. This function covers intrinsic and authored checks. External checks
 *  have their own grounding clauses, and exception groundings have no executable predicate.
 *  Cases with no accepted artifact cannot establish whether an applicable check would run. */
function truthCheckFiringClauses(evidence: ClaimEvidence): ClaimClause[] {
  const intrinsicCheckIds =
    evidence.grounding === null
      ? []
      : evidence.grounding.declared
          .filter((d) => d.grounding.kind === "intrinsic" || d.grounding.kind === "authored")
          .map((d) => d.checkId);
  const firing = evidence.truthCheckFiring;
  // No artifact reached the correctness model: the empty-denominator, non-result and paid-agent
  // clauses own that, and a check cannot fire where nothing verified.
  if (intrinsicCheckIds.length === 0 || firing.verifierVerifiedCount === 0) return [];
  const neverFired = intrinsicCheckIds.filter(
    (checkId) =>
      recordedCount(firing.firedByCheck, checkId) === 0 &&
      recordedCount(firing.applicableByCheck, checkId) > 0,
  );
  if (neverFired.length === 0) return [];
  return [
    clause(
      "TRUTH_CHECK_NEVER_FIRED",
      `authored check(s) [${neverFired.join(", ")}] ran in 0 of ${firing.verifierVerifiedCount} verified case(s)`,
      BLOCKING,
    ),
  ];
}

/**
 * Prediction closure rule. A `held` prediction needs no further disposition; `refuted` needs
 * repair or deletion; `inconclusive` and `unexercised` need retesting or deletion, because
 * repairing what never ran closes nothing. An `open` prediction remains unfinished.
 */
function predictionClosed(p: PredictionItem): boolean {
  return (
    p.outcome === "held" ||
    (p.outcome === "refuted" && (p.disposition === "repair" || p.disposition === "delete")) ||
    ((p.outcome === "inconclusive" || p.outcome === "unexercised") &&
      (p.disposition === "retest" || p.disposition === "delete"))
  );
}

function predictionClauses(predictions: PredictionItem[] | null): ClaimClause[] {
  return (predictions ?? []).flatMap((p) =>
    predictionClosed(p)
      ? []
      : [
          clause(
            "prediction-record-open",
            `prediction "${p.id}" is ${p.outcome} without a final outcome; classify every item before creating a claim`,
            IN_LOOP,
          ),
        ],
  );
}

/**
 * Explain why too many attempted cases are absent from the score denominator. The ratio decides
 * whether the clause applies; the terminal reason can identify a provider stop. Read that recorded
 * reason rather than inferring an outage from the ratio alone. The producer in
 * src/truth/battery-record.ts uses the shared `PROVIDER_STOPPED_REASON_PREFIX`, keeping this
 * reader aligned with the recorded reason format.
 */
function nonResultRatioDetail(reason: string | null, nonResultTotal: number, attempted: number): string {
  const counted = `${nonResultTotal}/${attempted} attempted case(s) were non-results (>25%)`;
  return reason?.startsWith(PROVIDER_STOPPED_REASON_PREFIX) === true
    ? `${counted}; the battery recorded "${reason}", so the provider-stop rule ended it — rerun when the provider is healthy`
    : `${counted}; too many cases could not be measured to support a claim, so rerun when the environment is healthy`;
}

/** Require enough operationally valid evidence for a claim. Reporting only the two measured
 *  cases from a battery with 38 crashes would conceal how little was measured. Counting those
 *  crashes as failures would also be wrong (plan-revision finding 6). */
function denominatorClauses(runStatus: RunStatusEvidence, n: number): ClaimClause[] {
  const clauses: ClaimClause[] = [];
  if (n !== runStatus.verified) {
    clauses.push(
      clause(
        "score-denominator-mismatch",
        `claimed n=${n}, but the run records contain ${runStatus.verified} verified case(s); use the verified-case count from the run records`,
        BLOCKING,
      ),
    );
  }
  if (n === 0) clauses.push(clause("empty-denominator", "a claim needs at least one verified case", IN_LOOP));
  const nonResultTotal = Object.values(runStatus.nonResults).reduce((a, b) => a + b, 0);
  const verifierThrows = runStatus.nonResults["verifier-throw"] ?? 0;
  if (verifierThrows > 0) {
    clauses.push(
      clause(
        "suspect-correctness-model",
        `the Correctness Model evaluator threw for ${verifierThrows} case(s). Fix the Correctness Model and rerun; do not base a claim on the remaining cases`,
        IN_LOOP,
      ),
    );
  }
  const attempted = runStatus.verified + nonResultTotal;
  // Threshold policy: >25% of attempted cases unmeasured, with at least 2 non-results so a
  // single flake in a tiny battery does not block (a 1-of-3 transient stays claimable; a
  // mostly-unmeasured battery never does).
  if (nonResultTotal >= 2 && attempted > 0 && nonResultTotal / attempted > 0.25) {
    clauses.push(
      clause(
        "non-result-ratio-excessive",
        nonResultRatioDetail(runStatus.reason, nonResultTotal, attempted),
        IN_LOOP,
      ),
    );
  }
  return clauses;
}

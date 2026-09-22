import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  ARCHIVE_FILES,
  ArchiveValidationError,
  predictionFrozenHash,
  validateArchiveDirectory,
  writeArchive,
} from "../.claude/skills/whole-run-investigation/scripts/validate-archive.mjs";
const PREDICTIONS = "#predictions";
const MAIN_SYNTHESIS_MD = "main_synthesis.md";
const DIGEST_MD = "digest.md";

const dirs: string[] = [];
const sourceRevision = "a".repeat(40);
const runGitHash = "b".repeat(40);
const sourceDigest = "c".repeat(64);
const worktree = "/worktree/run-1";
let activeWorktree = worktree;
const mainSynthesis =
  "# Main synthesis\n\n## Predictions\n\n## Safeguards\n\n## Terminal accounting\n\n## Learning\n\n## Safeguards T1\n";
const lunaSyntheses = "# Luna syntheses\n\n## sessions\n\n## reports\n";
const digestText =
  "# Deterministic digest\n\n## snapshot\n\n## manifest\n\n## safeguards-log\n\n## safeguards-t0\n\n## review\n";

function fileDigest(path: string) {
  const text =
    path === MAIN_SYNTHESIS_MD ? mainSynthesis : path === "luna_syntheses.md" ? lunaSyntheses : digestText;
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function pointer(path: string, anchor = "#evidence") {
  return { path, anchor, sha256: fileDigest(path) };
}

function sourceSetup(root: string) {
  mkdirSync(join(root, "src/meta"), { recursive: true });
  mkdirSync(join(root, "src/run"), { recursive: true });
  writeFileSync(
    join(root, "src/meta/safeguard.ts"),
    'safeguardTriggered("runtime-1", "detail");\nsafeguardTriggered("runtime-2", "detail");\n',
  );
  writeFileSync(join(root, "src/run/other.ts"), 'safeguardTriggered("runtime-3", "detail");\n');
  writeFileSync(
    join(root, "src/run/climb-history.ts"),
    "export function readClimbBatteries() {}\nexport function climbLedgerRows() {}\n",
  );
}

function sourceFile(relativeFile: string) {
  const path = join(activeWorktree, relativeFile);
  return {
    relativeFile,
    sha256: new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex"),
    ids: readFileSync(path, "utf8")
      .matchAll(/safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g)
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .toArray(),
  };
}

function sourceFileDigest(relativeFile: string) {
  return new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(activeWorktree, relativeFile)))
    .digest("hex");
}

function canonicalDigest(value: {
  predictionId: string;
  status: string;
  casualties: string[];
  survivors: string[];
  dependents: string[];
}) {
  const text = `{"casualties":${JSON.stringify(value.casualties)},"dependents":${JSON.stringify(value.dependents)},"predictionId":${JSON.stringify(value.predictionId)},"status":${JSON.stringify(value.status)},"survivors":${JSON.stringify(value.survivors)}}`;
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function prediction() {
  const row = {
    id: "prediction-1",
    sourceRevision,
    runId: "run-1",
    epoch: "epoch-1",
    bundle: "bundle-1",
    taskSet: "task-set-1",
    claim: "The next run from a clean source tree will write a terminal record.",
    expectedEffect: "A terminal record exists before the controller closes.",
    trigger: "The six-round controller cap is reached.",
    falsifier: "No terminal record exists after the capped run.",
    owner: "campaign",
    frozenHash: "",
    status: "sufficed",
    advisoryReason: "The fixture carries no canonical campaign event receipt.",
    closureState: "not-campaign-closure",
    eligible: false,
    decidingEvidence: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
    successor: [],
    dependsOn: [],
    backtrackEvent: "none",
    consumedBy: ["run-2"],
    eligibility: {
      state: "unknown",
      nextEligibleRunId: "new-authorised-child-required",
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
    },
    opportunity: { state: "present", evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)] },
    triggerEvidence: { state: "triggered", evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)] },
    effectEvidence: { state: "observed", evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)] },
    denominator: {
      state: "recorded",
      counts: { total: 2, verified: 1, unaccepted: 1, nonResult: 0 },
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, "#terminal-accounting")],
    },
    dependencyWalk: {
      walked: false,
      closed: false,
      casualties: [],
      survivors: ["prediction-1"],
      dependents: [],
      evidencePointers: [],
    },
  };
  row.frozenHash = predictionFrozenHash(row);
  return row;
}

function safeguards() {
  const runtime = ["runtime-1", "runtime-2", "runtime-3"].map((id) => {
    const definitionFile = id === "runtime-3" ? "src/run/other.ts" : "src/meta/safeguard.ts";
    const evidence = pointer(DIGEST_MD, "#safeguards-log");
    return {
      id,
      kind: "runtime-log-only",
      status: "no-opportunity",
      owner: "runtime",
      version: "runtime-safeguard@source-callers-v1",
      definitionSha256: sourceFileDigest(definitionFile),
      sensor: "src/meta/safeguard.ts:safeguardTriggered",
      evidencePointers: [pointer(DIGEST_MD, "#safeguards-log")],
      evidenceBinding: {
        runId: "run-1",
        sourceRevision,
        epoch: "epoch-1",
        bundle: "bundle-1",
        taskSet: "task-set-1",
      },
      opportunity: { state: "absent", evidencePointers: [pointer(DIGEST_MD, "#safeguards-log")] },
      firing: { state: "not-applicable", decidingEvidence: [evidence], evidencePointers: [evidence] },
      logReceipt: {
        state: "not-applicable",
        complete: false,
        decidingEvidence: [evidence],
        evidencePointers: [evidence],
      },
      stderrReceipt: {
        state: "not-applicable",
        complete: false,
        decidingEvidence: [evidence],
        evidencePointers: [evidence],
      },
      processReceipt: {
        state: "not-applicable",
        complete: false,
        decidingEvidence: [evidence],
        evidencePointers: [evidence],
      },
      action: { state: "not-applicable", owner: "runtime", evidencePointers: [evidence] },
      backtrack: { state: "not-needed", evidencePointers: [] },
      coverage: { complete: true, t0: true, t1: true },
      route: { owner: "runtime", state: "not-routed" },
      retirement: {
        retired: false,
        eligibleIterations: 0,
        backtrackPreserved: true,
        backtrackPointers: [],
        independentReview: { reviewed: true, evidencePointers: [pointer(DIGEST_MD, "#safeguards-log")] },
      },
    };
  });
  return runtime;
}

function review() {
  const deterministicRows = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((id) => ({
    id,
    state: "pass",
    evidencePointers: [pointer(DIGEST_MD, "#review")],
  }));
  const digestVerdicts = [
    "discrimination-inertness",
    "submit-stall-shape",
    "evidence-integrity",
    "solver-process",
    "saturation-ledger",
    "check-informativeness",
    "family-wise-coverage",
    "role-spend-and-censoring",
  ].map((id) => ({ id, state: "pass", evidencePointers: [pointer(DIGEST_MD, "#review")] }));
  const stateIdentity = {
    sourceRevision,
    runId: "run-1",
    epoch: "epoch-1",
    bundle: "bundle-1",
    taskSet: "task-set-1",
  };
  const angleStates = Array.from({ length: 36 }, (_, index) => ({
    angle: index + 1,
    state: "N/A",
    session: `angle_${String(index + 1).padStart(2, "0")}`,
    mode: "targeted",
    identity: stateIdentity,
    denominator: {
      state: "absent",
      reason: "No angle-specific denominator was recorded.",
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
    },
    reason: "The angle was not admitted in this fixture.",
    evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
  }));
  const sessionStates = [
    ...angleStates.map((row) => ({
      id: row.session,
      state: "inactive",
      evidencePointers: row.evidencePointers,
    })),
    {
      id: "session_30",
      state: "complete",
      applicability: "applicable",
      contract: "CL-F",
      readinessWitness: {
        sourceFile: "src/run/climb-history.ts",
        producerSymbol: "readClimbBatteries",
        consumerSymbol: "climbLedgerRows",
        sourceRevision,
        sourceDigest: sourceFileDigest("src/run/climb-history.ts"),
        vocabulary: "source-ready-no-level-decisions",
        difficultyDecisionCount: 0,
        evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
      },
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
    },
  ];
  return {
    schema: "wri-archive/v1",
    authority: "advisory",
    lifecycle: { stage: "terminal" },
    identity: {
      runId: "run-1",
      sourceRevision,
      runGitHash,
      sourceDigest,
      worktree: activeWorktree,
      epoch: "epoch-1",
      bundle: "bundle-1",
      taskSet: "task-set-1",
    },
    procedureIdentity: {
      name: "SuperLoop",
      version: "v1",
      sourceRevision,
      sourceDigest,
      worktree: activeWorktree,
      sameTree: true,
      sha256: sourceDigest,
      pointer: pointer(MAIN_SYNTHESIS_MD, "#learning"),
    },
    ledgerProjection: {
      schema: "superloop-ledger-projection/v1",
      authority: "projection-only",
      mutable: false,
      sourceRevision,
      sha256: fileDigest(MAIN_SYNTHESIS_MD),
      pointer: pointer(MAIN_SYNTHESIS_MD, PREDICTIONS),
    },
    launchIdentity: { state: "incomplete", reason: "historical A1 launch record unavailable" },
    digests: {
      snapshot: { sha256: fileDigest(DIGEST_MD), pointer: pointer(DIGEST_MD, "#snapshot") },
      manifest: { sha256: fileDigest(DIGEST_MD), pointer: pointer(DIGEST_MD, "#manifest") },
      sessions: {
        sha256: fileDigest("luna_syntheses.md"),
        pointer: pointer("luna_syntheses.md", "#sessions"),
      },
      reports: { sha256: fileDigest("luna_syntheses.md"), pointer: pointer("luna_syntheses.md", "#reports") },
    },
    terminalAccounting: {
      state: "recorded",
      denominator: { state: "recorded", total: 2, verified: 1, unaccepted: 1, nonResult: 0 },
      evidencePointer: pointer(MAIN_SYNTHESIS_MD, "#terminal-accounting"),
      outerCap: 6,
      completedRounds: 1,
      realAuthoringIterations: 1,
      candidateSubmits: 0,
      controllerTerminalRows: 1,
      recordedSubmitRows: 1,
      authorCalls: { budget: 20, opening: 0, terminal: 4, delta: 4 },
      counts: { raw: 3, real: 2, controller: 1 },
      parents: { lastCandidate: "candidate-1", adopted: "candidate-0", accepted: "candidate-0" },
    },
    terminal: {
      outcome: "completed",
      capabilityResult: "recorded",
      terminalReceiptSha256: "d".repeat(64),
      automaticFollowOn: false,
    },
    deterministicRows,
    digestVerdicts,
    angleStates,
    sessionStates,
    predictions: [prediction()],
    safeguards: safeguards(),
    safeguardCensus: {
      complete: true,
      sourceRevision,
      sourceDigest,
      derivation: "source-callers-v1",
      definitionFile: "src/meta/safeguard.ts",
      callerFiles: [sourceFile("src/meta/safeguard.ts"), sourceFile("src/run/other.ts")],
      ids: ["runtime-1", "runtime-2", "runtime-3"],
      evidencePointers: [pointer(DIGEST_MD, "#safeguards-log")],
    },
    safeguardReconciliation: {
      bytesVerified: true,
      t0Identity: {
        complete: true,
        runId: "run-1",
        sourceRevision,
        sourceDigest,
        epoch: "epoch-1",
        bundle: "bundle-1",
        taskSet: "task-set-1",
      },
      t1Identity: {
        complete: true,
        runId: "run-1",
        sourceRevision,
        sourceDigest,
        epoch: "epoch-1",
        bundle: "bundle-1",
        taskSet: "task-set-1",
      },
      t0: pointer(DIGEST_MD, "#safeguards-t0"),
      t1: pointer(MAIN_SYNTHESIS_MD, "#safeguards-t1"),
    },
    metaReview: {
      state: "not-used",
      authority: "advisory",
      reason: "No independent meta pair was used in this ordinary fixture review.",
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, "#learning")],
    },
    conditionManifest: {
      state: "not-used",
      authority: "advisory",
      reason: "No paired battery condition was available in this ordinary fixture review.",
      evidencePointers: [pointer(DIGEST_MD, "#review")],
    },
    learningHandoff: {
      authority: "advisory",
      hypotheses: [],
      rivalSets: [],
      experimentProposals: [],
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, "#learning")],
    },
    sectionPointers: {
      predictionLedger: pointer(MAIN_SYNTHESIS_MD, PREDICTIONS),
      safeguards: pointer(MAIN_SYNTHESIS_MD, "#safeguards"),
      terminalAccounting: pointer(MAIN_SYNTHESIS_MD, "#terminal-accounting"),
    },
    primaryReview: {
      assertion:
        "The primary reviewer checked deterministic evidence and protected verifier detail was not copied.",
      protectedEvidenceChecked: true,
      evidencePointers: [pointer(DIGEST_MD, "#review")],
    },
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ana-wri-archive-"));
  dirs.push(dir);
  const archive = join(dir, "run-1");
  activeWorktree = join(dir, "source");
  sourceSetup(activeWorktree);
  const result = writeArchive({
    archiveDir: archive,
    mainSynthesis,
    lunaSyntheses,
    digest: digestText,
    review: review(),
  });
  expect(result.valid).toBe(true);
  return { dir, archive };
}

it("preserves uncapped authoring and separates rounds from submission terminals", () => {
  const { archive } = fixture();
  rewriteReview(archive, (value) => {
    value.terminalAccounting.authorCalls.budget = "uncapped";
    value.terminalAccounting.controllerTerminalRows = 0;
    value.terminalAccounting.candidateSubmits = 11;
    value.terminalAccounting.recordedSubmitRows = 11;
  });
  expect(validateArchiveDirectory(archive).valid).toBe(true);
  rewriteReview(archive, (value) => {
    value.terminalAccounting.recordedSubmitRows = 12;
  });
  expect(() => validateArchiveDirectory(archive)).toThrow("recordedSubmitRows must equal");
  rewriteReview(archive, (value) => {
    value.terminalAccounting.recordedSubmitRows = 11;
    value.terminalAccounting.authorCalls.budget = "unknown";
  });
  expect(() => validateArchiveDirectory(archive)).toThrow("authorCalls.budget must be");
});

function rewriteReview(archive: string, mutate: (value: any) => void) {
  const path = join(archive, "review.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function attachEligibleCampaignEvent(
  f: { dir: string; archive: string },
  status: "inconclusive" | "untriggered",
) {
  const reviewPath = join(f.archive, "review.json");
  const value = JSON.parse(readFileSync(reviewPath, "utf8"));
  const row = value.predictions[0];
  row.status = status;
  row.eligible = true;
  row.eligibility.state = "eligible";
  row.eligibility.nextEligibleRunId = "run-2";
  row.triggerEvidence.state = status === "untriggered" ? "not-triggered" : "unknown";
  row.effectEvidence.state = "unknown";
  row.dependencyWalk.casualties = [];
  row.dependencyWalk.survivors = [];
  row.dependencyWalk.dependents = [];
  row.dependencyWalk.promotions = [];

  const receiptId = `event-${status}`;
  const ticketCoreSha256 = "e".repeat(64);
  row.campaignEvent = {
    authority: "campaign",
    origin: "campaign-ledger",
    receiptId,
    ticketCoreSha256,
    identity: { sourceRevision, runId: "run-1", epoch: "epoch-1", bundle: "bundle-1", taskSet: "task-set-1" },
    evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
  };
  row.frozenHash = predictionFrozenHash(row);
  const freeze = {
    id: row.id,
    sourceRevision: row.sourceRevision,
    runId: row.runId,
    epoch: row.epoch,
    bundle: row.bundle,
    taskSet: row.taskSet,
    claim: row.claim,
    expectedEffect: row.expectedEffect,
    trigger: row.trigger,
    falsifier: row.falsifier,
    owner: row.owner,
    frozenHash: row.frozenHash,
  };
  const receipt = {
    schema: "superloop-backtrack-event/v1",
    producer: "run-improvement-campaign",
    origin: "campaign-ledger",
    authoritative: true,
    ticketCoreSha256,
    predictionId: row.id,
    frozenHash: row.frozenHash,
    freeze,
    status,
    consumer: {
      predictionId: row.id,
      status,
      consumerId: "run-2",
      identity: {
        sourceRevision,
        runId: "run-2",
        epoch: "epoch-2",
        bundle: "bundle-2",
        taskSet: "task-set-2",
      },
      eligibility: "eligible",
      eligible: true,
      trigger: status === "untriggered" ? "absent" : "unknown",
      effect: status === "untriggered" ? "not-applicable" : "unknown",
      consumedBy: "run-2",
      successor: null,
      evidence: {
        trigger: "trigger-evidence",
        effect: "effect-evidence",
        denominator: "denominator-evidence",
      },
    },
    dependents: [],
    dependencyWalk: { casualties: [], survivors: [], promotions: [] },
    safeguardRetirement: null,
  };
  const receiptPath = join(f.dir, `${receiptId}.json`);
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(receiptPath, receiptBytes);
  const projection = { predictionId: row.id, status, casualties: [], survivors: [], dependents: [] };
  row.campaignEvent.receipt = {
    file: receiptPath,
    sha256: new Bun.CryptoHasher("sha256").update(receiptBytes).digest("hex"),
  };
  row.campaignEvent.projectionSha256 = canonicalDigest(projection);
  writeFileSync(reviewPath, `${JSON.stringify(value, null, 2)}\n`);
}

function issuesOf(error: unknown): string[] {
  if (!(error instanceof ArchiveValidationError)) throw error;
  return error.issues;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("WRI four-file archive contract", () => {
  it("uses the campaign frozen projection and excludes mutable links", () => {
    const row: any = prediction();
    const { frozenHash } = row;
    row.successor = ["prediction-2"];
    row.dependsOn = ["prediction-0"];
    row.backtrackEvent = "event-1";
    row.campaignEvent = { receiptId: "event-1" };
    expect(predictionFrozenHash(row)).toBe(frozenHash);
    expect(predictionFrozenHash({ ...row, id: "prediction-other" })).not.toBe(frozenHash);
    expect(predictionFrozenHash({ ...row, claim: "changed claim" })).not.toBe(frozenHash);
  });

  it("writes and validates the identity-bound advisory archive", () => {
    const f = fixture();
    expect(ARCHIVE_FILES).toEqual([MAIN_SYNTHESIS_MD, "luna_syntheses.md", DIGEST_MD, "review.json"]);
    expect(validateArchiveDirectory(f.archive).predictionCount).toBe(1);
    expect(validateArchiveDirectory(f.archive).safeguardCount).toBe(3);
  });

  it("rejects a fifth file instead of silently treating it as a handoff channel", () => {
    const f = fixture();
    writeFileSync(join(f.archive, "predictions.json"), "{}\n");
    expect(() => validateArchiveDirectory(f.archive)).toThrow("forbidden extra file: predictions.json");
  });

  it("rejects pending predictions and stale frozen identity", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.predictions[0].status = "pending";
      value.predictions[0].sourceRevision = "d".repeat(40);
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("cannot remain pending");
  });

  it("keeps prediction eligibility, consumption and refutation closure explicit", () => {
    const consumed = fixture();
    rewriteReview(consumed.archive, (value) => {
      value.predictions[0].consumedBy = ["run-2", "run-3"];
    });
    expect(() => validateArchiveDirectory(consumed.archive)).toThrow("at most one consuming run");

    const refuted = fixture();
    rewriteReview(refuted.archive, (value) => {
      value.predictions[0].status = "refuted";
      value.predictions[0].eligible = true;
      value.predictions[0].eligibility.state = "eligible";
      value.predictions[0].effectEvidence.state = "not-observed";
      value.predictions[0].dependencyWalk.closed = false;
    });
    expect(() => validateArchiveDirectory(refuted.archive)).toThrow("closed dependency walk");

    const beforeOpening = fixture();
    rewriteReview(beforeOpening.archive, (value) => {
      value.predictions[0].opportunity.state = "absent-before-opening";
    });
    expect(() => validateArchiveDirectory(beforeOpening.archive)).toThrow("only in a preopening archive");
  });

  it("does not accept a WRI-authored refutation without procedure-owned receipt bytes", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.predictions[0].status = "refuted";
      value.predictions[0].eligible = true;
      value.predictions[0].eligibility.state = "eligible";
      value.predictions[0].effectEvidence.state = "not-observed";
      value.predictions[0].backtrackEvent = "event-1";
      value.predictions[0].dependencyWalk.walked = true;
      value.predictions[0].dependencyWalk.closed = true;
      value.predictions[0].dependencyWalk.survivors = ["prediction-1 survived independently"];
      value.predictions[0].dependencyWalk.evidencePointers = [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)];
      value.predictions[0].campaignEvent = {
        authority: "campaign",
        origin: "campaign-ledger",
        receiptId: "event-1",
        kind: "refutation",
        ticketCoreSha256: "e".repeat(64),
        identity: {
          sourceRevision,
          runId: "run-1",
          epoch: "epoch-1",
          bundle: "bundle-1",
          taskSet: "task-set-1",
        },
        receipt: { file: join(f.archive, "review.json"), sha256: "e".repeat(64) },
        projectionSha256: "e".repeat(64),
        evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
      };
      value.predictions[0].frozenHash = predictionFrozenHash(value.predictions[0]);
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("outside the four-file archive");
  });

  it("verifies archive pointer bytes, anchors and run-bound safeguard evidence", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.sectionPointers.safeguards.sha256 = "c".repeat(64);
      value.safeguards[0].evidenceBinding.runId = "another-run";
    });
    let error: unknown;
    try {
      validateArchiveDirectory(f.archive);
    } catch (caught) {
      error = caught;
    }
    expect(issuesOf(error)).toContain(
      "review.json.sectionPointers.safeguards.sha256 does not match main_synthesis.md",
    );
    expect(issuesOf(error)).toContain("safeguards[0].evidenceBinding.runId differs from archive identity");
  });

  it("rejects unsafe pointers and promotion authority", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.sectionPointers.safeguards.path = "../digest.md";
      value.learningHandoff.authority = "promotion";
    });
    let error: unknown;
    try {
      validateArchiveDirectory(f.archive);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ArchiveValidationError);
    expect(issuesOf(error)).toContain(
      "sectionPointers.safeguards.path must name one of the four archive files",
    );
    expect(issuesOf(error)).toContain("learningHandoff authority must be exactly advisory");
  });

  it("refuses a safeguard retired before two eligible iterations", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.safeguards[0].retirement.retired = true;
      value.safeguards[0].retirement.eligibleIterations = 1;
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("cannot retire before two eligible iterations");
  });

  it("keeps product and procedure identities distinct unless sameTree is explicit", () => {
    const separate = fixture();
    rewriteReview(separate.archive, (value) => {
      value.procedureIdentity.sameTree = false;
      value.procedureIdentity.sourceRevision = "d".repeat(40);
      value.procedureIdentity.sourceDigest = "e".repeat(64);
      value.procedureIdentity.sha256 = "e".repeat(64);
      value.procedureIdentity.worktree = "/procedure/superloop";
    });
    expect(validateArchiveDirectory(separate.archive).valid).toBe(true);

    const joined = fixture();
    rewriteReview(joined.archive, (value) => {
      value.procedureIdentity.sourceDigest = "e".repeat(64);
    });
    expect(() => validateArchiveDirectory(joined.archive)).toThrow("while sameTree is true");

    const falselySeparate = fixture();
    rewriteReview(falselySeparate.archive, (value) => {
      value.procedureIdentity.sameTree = false;
    });
    expect(() => validateArchiveDirectory(falselySeparate.archive)).toThrow("when sameTree is false");
  });

  /** Until 2026-09-18 the scaffold pushed five constant "S1".."S5" campaign rows and the validator
   *  refused an archive without them, for sentinels no file ever defined. Both went. `runtime-log-only`
   *  is now the only kind, so a review that reinvents a campaign row is refused rather than carrying
   *  placeholder evidence into the archive. */
  it("refuses a safeguard row that is not a runtime sensor", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.safeguards[0].kind = "campaign";
    });
    let error: unknown;
    try {
      validateArchiveDirectory(f.archive);
    } catch (caught) {
      error = caught;
    }
    expect(issuesOf(error)).toContain("safeguards[0].kind is unsupported");
  });

  it("rejects a log filename sensor and incomplete deterministic coverage", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.safeguards[0].sensor = "SAFEGUARDS_LOG.txt";
      value.deterministicRows.splice(0, 1);
    });
    let error: unknown;
    try {
      validateArchiveDirectory(f.archive);
    } catch (caught) {
      error = caught;
    }
    expect(issuesOf(error)).toContain(
      "safeguards[0].sensor must not use the SAFEGUARDS_LOG filename as a sensor identity",
    );
    expect(issuesOf(error)).toContain("deterministicRows must contain A-I exactly once and in order");
  });

  it("refuses an archive written under an older catalogue shape", () => {
    const older = fixture();
    rewriteReview(older.archive, (value) => {
      value.deterministicRows = value.deterministicRows.slice(0, 8);
      value.digestVerdicts = value.digestVerdicts.slice(0, 5);
      const dropped = new Set(value.angleStates.slice(31).map((row: any) => row.session));
      value.angleStates = value.angleStates.slice(0, 31);
      value.sessionStates = value.sessionStates.filter((row: any) => !dropped.has(row.id));
    });
    let error: unknown;
    try {
      validateArchiveDirectory(older.archive);
    } catch (caught) {
      error = caught;
    }
    expect(issuesOf(error)).toEqual(
      expect.arrayContaining([
        "deterministicRows must contain A-I exactly once and in order",
        "digestVerdicts must contain the 8 canonical verdicts in order",
        "angleStates must contain angles 1-36 exactly once and in order",
      ]),
    );
  });

  it("records an absent safeguard helper as unobservable instead of inventing callers", () => {
    const f = fixture();
    rmSync(join(f.dir, "source/src/meta/safeguard.ts"));
    rewriteReview(f.archive, (value) => {
      value.safeguards = [];
      value.safeguardCensus.availability = "unobservable";
      value.safeguardCensus.callerFiles = [];
      value.safeguardCensus.ids = [];
    });
    expect(validateArchiveDirectory(f.archive).valid).toBe(true);
  });

  it("requires the CL-F producer and consumer symbols in the named source file", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.sessionStates.at(-1).readinessWitness.producerSymbol = "missingProducer";
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("producerSymbol is absent");
  });

  it("requires a campaign receipt for an eligible but undecidable prediction", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      const row = value.predictions[0];
      row.status = "inconclusive";
      row.eligible = true;
      row.eligibility.state = "eligible";
      row.effectEvidence.state = "unknown";
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("eligible prediction requires");
  });

  it("requires a campaign receipt for an eligible untriggered prediction", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      const row = value.predictions[0];
      row.status = "untriggered";
      row.eligible = true;
      row.eligibility.state = "eligible";
      row.triggerEvidence.state = "not-triggered";
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("eligible prediction requires");
  });

  it("accepts an eligible inconclusive prediction with a campaign receipt", () => {
    const f = fixture();
    attachEligibleCampaignEvent(f, "inconclusive");
    expect(validateArchiveDirectory(f.archive).valid).toBe(true);
  });

  it("rejects overlapping dependency partitions and foreign promotions", () => {
    const f = fixture();
    attachEligibleCampaignEvent(f, "inconclusive");
    const reviewPath = join(f.archive, "review.json");
    const value = JSON.parse(readFileSync(reviewPath, "utf8"));
    const row = value.predictions[0];
    row.dependencyWalk.casualties = ["P-2"];
    row.dependencyWalk.survivors = ["P-2"];
    row.dependencyWalk.dependents = ["P-2"];
    row.dependencyWalk.promotions = ["P-foreign"];
    const receiptPath = join(f.dir, "event-inconclusive.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    receipt.dependents = ["P-2"];
    receipt.dependencyWalk = { casualties: ["P-2"], survivors: ["P-2"], promotions: ["P-foreign"] };
    const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
    writeFileSync(receiptPath, receiptBytes);
    row.campaignEvent.receipt.sha256 = new Bun.CryptoHasher("sha256").update(receiptBytes).digest("hex");
    row.campaignEvent.projectionSha256 = canonicalDigest({
      predictionId: row.id,
      status: row.status,
      casualties: ["P-2"],
      survivors: ["P-2"],
      dependents: ["P-2"],
    });
    writeFileSync(reviewPath, `${JSON.stringify(value, null, 2)}\n`);
    let error: unknown;
    try {
      validateArchiveDirectory(f.archive);
    } catch (caught) {
      error = caught;
    }
    expect(
      issuesOf(error).some((issue) =>
        issue.includes("receipt dependency walk casualties and survivors must be disjoint"),
      ),
    ).toBe(true);
    expect(
      issuesOf(error).some((issue) =>
        issue.includes("receipt dependency walk promotions must name a dependent in the partition"),
      ),
    ).toBe(true);
  });

  it("keeps an opportunity with missing runtime receipts inconclusive", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      const row = value.safeguards.find((item: any) => item.kind === "runtime-log-only");
      row.opportunity.state = "present";
      row.logReceipt = null;
      row.status = "not-fired";
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("status must be inconclusive");
  });

  it("requires the full receipt identity set for a bound launch", () => {
    const f = fixture();
    rewriteReview(f.archive, (value) => {
      value.launchIdentity.state = "bound";
      value.launchIdentity.sha256 = "e".repeat(64);
      value.launchIdentity.pointer = pointer(MAIN_SYNTHESIS_MD, PREDICTIONS);
    });
    expect(() => validateArchiveDirectory(f.archive)).toThrow("launchIdentity.ticket must be an object");
  });
});

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  ARCHIVE_SCHEMA,
  predictionFrozenHash,
} from "../.claude/skills/whole-run-investigation/scripts/archive-shape.mjs";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROWS,
  DIGEST_VERDICTS,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.mjs";
import {
  ArchiveValidationError,
  validateArchiveDirectory,
} from "../.claude/skills/whole-run-investigation/scripts/validate-archive.mjs";

type Mutate = (value: any) => void;

const PREDICTIONS = "#predictions";
const MAIN_SYNTHESIS_MD = "main_synthesis.md";
const DIGEST_MD = "digest.md";

const sourceRevision = "a".repeat(40);
const runGitHash = "b".repeat(40);
const sourceDigest = "c".repeat(64);
let activeWorktree = "/worktree/run-1";
/** The run identity every evidence row binds to. */
const binding = {
  runId: "run-1",
  sourceRevision,
  epoch: "epoch-1",
  bundle: "bundle-1",
  taskSet: "task-set-1",
};
const mainSynthesis =
  "# Main synthesis\n\n## Predictions\n\n## Safeguards\n\n## Terminal accounting\n\n## Learning\n\n## Safeguards T1\n";
const lunaSyntheses = "# Luna syntheses\n\n## sessions\n\n## reports\n";
const digestText =
  "# Deterministic digest\n\n## snapshot\n\n## manifest\n\n## safeguards-log\n\n## safeguards-t0\n\n## review\n";
const validator = resolve(
  import.meta.dirname,
  "../.claude/skills/whole-run-investigation/scripts/validate-archive.mjs",
);

function runValidator(...args: string[]) {
  return spawnTextSync(Bun.argv[0]!, [validator, ...args]);
}

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
}

function sourceFileDigest(relativeFile: string) {
  return new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(activeWorktree, relativeFile)))
    .digest("hex");
}

function sourceFile(relativeFile: string) {
  return {
    relativeFile,
    sha256: sourceFileDigest(relativeFile),
    ids: readFileSync(join(activeWorktree, relativeFile), "utf8")
      .matchAll(/safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g)
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .toArray(),
  };
}

function prediction() {
  const row = {
    id: "prediction-1",
    ...binding,
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
  return ["runtime-1", "runtime-2", "runtime-3"].map((id) => {
    const definitionFile = id === "runtime-3" ? "src/run/other.ts" : "src/meta/safeguard.ts";
    const evidence = pointer(DIGEST_MD, "#safeguards-log");
    const receipt = () => ({
      state: "not-applicable",
      complete: false,
      decidingEvidence: [evidence],
      evidencePointers: [evidence],
    });
    return {
      id,
      kind: "runtime-log-only",
      status: "no-opportunity",
      owner: "runtime",
      version: "runtime-safeguard@source-callers-v1",
      definitionSha256: sourceFileDigest(definitionFile),
      sensor: "src/meta/safeguard.ts:safeguardTriggered",
      evidencePointers: [evidence],
      evidenceBinding: { ...binding },
      opportunity: { state: "absent", evidencePointers: [evidence] },
      firing: { state: "not-applicable", decidingEvidence: [evidence], evidencePointers: [evidence] },
      logReceipt: receipt(),
      stderrReceipt: receipt(),
      processReceipt: receipt(),
      action: { state: "not-applicable", owner: "runtime", evidencePointers: [evidence] },
      backtrack: { state: "not-needed", evidencePointers: [] },
      coverage: { complete: true, t0: true, t1: true },
      route: { owner: "runtime", state: "not-routed" },
      retirement: {
        retired: false,
        eligibleIterations: 0,
        backtrackPreserved: true,
        backtrackPointers: [],
        independentReview: { reviewed: true, evidencePointers: [evidence] },
      },
    };
  });
}

function review() {
  const passing = (id: string) => ({ id, state: "pass", evidencePointers: [pointer(DIGEST_MD, "#review")] });
  const angleStates = Array.from({ length: ANGLE_COUNT }, (_, index) => ({
    angle: index + 1,
    state: "N/A",
    session: `lane_${String(index + 1).padStart(2, "0")}`,
    mode: "targeted",
    identity: binding,
    denominator: {
      state: "absent",
      reason: "No angle-specific denominator was recorded.",
      evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
    },
    reason: "The angle was not admitted in this fixture.",
    evidencePointers: [pointer(MAIN_SYNTHESIS_MD, PREDICTIONS)],
  }));
  // One session row per launched lane and nothing else: the primary settles no session of its own.
  const sessionStates = angleStates.map((row) => ({
    id: row.session,
    state: "inactive",
    evidencePointers: row.evidencePointers,
  }));
  return {
    schema: ARCHIVE_SCHEMA,
    authority: "advisory",
    lifecycle: { stage: "terminal" },
    identity: { ...binding, runGitHash, sourceDigest, worktree: activeWorktree },
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
    deterministicRows: DETERMINISTIC_ROWS.map(passing),
    digestVerdicts: DIGEST_VERDICTS.map(passing),
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
      t0Identity: { complete: true, ...binding, sourceDigest },
      t1Identity: { complete: true, ...binding, sourceDigest },
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
  const dir = scratchDir("ana-wri-archive-");
  const archive = join(dir, "run-1");
  activeWorktree = join(dir, "source");
  sourceSetup(activeWorktree);
  mkdirSync(archive);
  writeFileSync(join(archive, MAIN_SYNTHESIS_MD), mainSynthesis);
  writeFileSync(join(archive, "luna_syntheses.md"), lunaSyntheses);
  writeFileSync(join(archive, DIGEST_MD), digestText);
  writeFileSync(join(archive, "review.json"), `${JSON.stringify(review(), null, 2)}\n`);
  expect(validateArchiveDirectory(archive).valid).toBe(true);
  return { dir, archive };
}

function rewriteReview(archive: string, mutate: Mutate) {
  const path = join(archive, "review.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every issue the validator names for this archive, or none when it admits it. */
function issuesOf(archive: string): string[] {
  try {
    validateArchiveDirectory(archive);
  } catch (error) {
    if (!(error instanceof ArchiveValidationError)) throw error;
    return error.issues;
  }
  return [];
}

afterAll(cleanupScratch);

describe("WRI four-file archive contract", () => {
  it("uses the campaign frozen projection and excludes mutable links", () => {
    const row: any = prediction();
    const { frozenHash } = row;
    row.successor = ["prediction-2"];
    row.dependsOn = ["prediction-0"];
    row.backtrackEvent = "event-1";
    expect(predictionFrozenHash(row)).toBe(frozenHash);
    expect(predictionFrozenHash({ ...row, id: "prediction-other" })).not.toBe(frozenHash);
    expect(predictionFrozenHash({ ...row, claim: "changed claim" })).not.toBe(frozenHash);
    // A missing array slot must hash apart from an empty array.
    expect(predictionFrozenHash({ ...row, claim: [undefined] })).not.toBe(
      predictionFrozenHash({ ...row, claim: [] }),
    );
  });

  it("validates the identity-bound advisory archive and counts its rows", () => {
    const f = fixture();
    expect(validateArchiveDirectory(f.archive)).toMatchObject({ predictionCount: 1, safeguardCount: 3 });
  });

  const admitted: [string, Mutate][] = [
    [
      "uncapped authoring with rounds apart from submission terminals",
      (value) => {
        value.terminalAccounting.authorCalls.budget = "uncapped";
        value.terminalAccounting.controllerTerminalRows = 0;
        value.terminalAccounting.candidateSubmits = 11;
        value.terminalAccounting.recordedSubmitRows = 11;
      },
    ],
    [
      "an invalid terminal denominator carrying its reason",
      (value) => {
        value.terminal.capabilityResult = "inconclusive";
        value.terminalAccounting.state = "incomplete";
        value.terminalAccounting.denominator = { state: "invalid", reason: "case-record unreadable" };
        value.terminalAccounting.reason = "controller denominator invalid — case-record unreadable";
      },
    ],
    [
      "a procedure identity declared apart from the product with sameTree false",
      (value) => {
        value.procedureIdentity.sameTree = false;
        value.procedureIdentity.sourceRevision = "d".repeat(40);
        value.procedureIdentity.sourceDigest = "e".repeat(64);
        value.procedureIdentity.sha256 = "e".repeat(64);
        value.procedureIdentity.worktree = "/procedure/superloop";
      },
    ],
  ];

  it.each(admitted)("admits %s", (_title, mutate) => {
    const f = fixture();
    rewriteReview(f.archive, mutate);
    expect(issuesOf(f.archive)).toEqual([]);
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
    expect(issuesOf(f.archive)).toEqual([]);
  });

  const eligible = (value: any, status: string) => {
    const row = value.predictions[0];
    row.status = status;
    row.eligible = true;
    row.eligibility.state = "eligible";
    return row;
  };

  const refused: [string, Mutate, string[]][] = [
    [
      "recorded submit rows that differ from the candidate submits",
      (value) => {
        value.terminalAccounting.recordedSubmitRows = 12;
      },
      ["recordedSubmitRows must equal"],
    ],
    [
      "an author-call budget that is neither a count nor uncapped",
      (value) => {
        value.terminalAccounting.authorCalls.budget = "unknown";
      },
      ["authorCalls.budget must be"],
    ],
    [
      "an invalid denominator without its reason",
      (value) => {
        value.terminal.capabilityResult = "inconclusive";
        value.terminalAccounting.state = "incomplete";
        value.terminalAccounting.denominator = { state: "invalid" };
        value.terminalAccounting.reason = "controller denominator invalid";
      },
      ["terminalAccounting.denominator.reason"],
    ],
    [
      "a sealed denominator state no controller writes",
      (value) => {
        value.terminalAccounting.state = "sealed";
        value.terminalAccounting.denominator.state = "sealed";
      },
      ["terminalAccounting.state is unsupported: sealed"],
    ],
    [
      "a pending prediction with stale frozen identity",
      (value) => {
        value.predictions[0].status = "pending";
        value.predictions[0].sourceRevision = "d".repeat(40);
      },
      ["cannot remain pending"],
    ],
    [
      "a prediction consumed by two runs",
      (value) => {
        value.predictions[0].consumedBy = ["run-2", "run-3"];
      },
      ["at most one consuming run"],
    ],
    [
      "an eligible refutation without a closed dependency walk",
      (value) => {
        eligible(value, "refuted").effectEvidence.state = "not-observed";
      },
      ["closed dependency walk"],
    ],
    [
      "an opportunity absent before opening in a terminal archive",
      (value) => {
        value.predictions[0].opportunity.state = "absent-before-opening";
      },
      ["only in a preopening archive"],
    ],
    [
      "an eligible but undecidable prediction without a campaign receipt",
      (value) => {
        eligible(value, "inconclusive").effectEvidence.state = "unknown";
      },
      ["eligible prediction requires"],
    ],
    [
      "an eligible untriggered prediction without a campaign receipt",
      (value) => {
        eligible(value, "untriggered").triggerEvidence.state = "not-triggered";
      },
      ["eligible prediction requires"],
    ],
    [
      "stale pointer bytes and safeguard evidence bound to another run",
      (value) => {
        value.sectionPointers.safeguards.sha256 = "c".repeat(64);
        value.safeguards[0].evidenceBinding.runId = "another-run";
      },
      [
        "review.json.sectionPointers.safeguards.sha256 does not match main_synthesis.md",
        "safeguards[0].evidenceBinding.runId differs from archive identity",
      ],
    ],
    [
      "an unsafe pointer path and promotion authority",
      (value) => {
        value.sectionPointers.safeguards.path = "../digest.md";
        value.learningHandoff.authority = "promotion";
      },
      [
        "sectionPointers.safeguards.path must name one of the four archive files",
        "learningHandoff authority must be exactly advisory",
      ],
    ],
    [
      "a safeguard retired before two eligible iterations",
      (value) => {
        value.safeguards[0].retirement.retired = true;
        value.safeguards[0].retirement.eligibleIterations = 1;
      },
      ["cannot retire before two eligible iterations"],
    ],
    [
      "a procedure digest that differs while sameTree is true",
      (value) => {
        value.procedureIdentity.sourceDigest = "e".repeat(64);
      },
      ["while sameTree is true"],
    ],
    [
      "sameTree false over an identical procedure identity",
      (value) => {
        value.procedureIdentity.sameTree = false;
      },
      ["when sameTree is false"],
    ],
    [
      "a safeguard row that is not a runtime sensor",
      (value) => {
        value.safeguards[0].kind = "campaign";
      },
      ["safeguards[0].kind is unsupported"],
    ],
    [
      "a log filename used as a sensor and incomplete deterministic coverage",
      (value) => {
        value.safeguards[0].sensor = "SAFEGUARDS_LOG.txt";
        value.deterministicRows.splice(0, 1);
      },
      [
        "safeguards[0].sensor must not use the SAFEGUARDS_LOG filename as a sensor identity",
        "deterministicRows must contain A-I exactly once and in order",
      ],
    ],
    [
      "an archive written under an older catalogue shape",
      (value) => {
        value.deterministicRows = value.deterministicRows.slice(0, 8);
        value.digestVerdicts = value.digestVerdicts.slice(0, 5);
        const dropped = new Set(value.angleStates.slice(7).map((row: any) => row.session));
        value.angleStates = value.angleStates.slice(0, 7);
        value.sessionStates = value.sessionStates.filter((row: any) => !dropped.has(row.id));
      },
      [
        "deterministicRows must contain A-I exactly once and in order",
        "digestVerdicts must contain the 10 canonical verdicts in order",
        "angleStates must contain angles 1-28 exactly once and in order",
      ],
    ],
    [
      "an archive declaring the previous schema instead of being rewritten",
      (value) => {
        value.schema = "wri-archive/v1";
      },
      ["schema wri-archive/v1 is the previous archive shape and is refused"],
    ],
    [
      "a verdict list without the rehearsal ledger",
      (value) => {
        value.digestVerdicts = value.digestVerdicts.filter((row: any) => row.id !== "rehearsal-ledger");
      },
      ["digestVerdicts must contain the 10 canonical verdicts in order"],
    ],
    [
      "an angle whose session has no row to hold it to",
      (value) => {
        value.angleStates[2].session = "lane_99";
      },
      ["angleStates[2].session lane_99 has no sessionStates row"],
    ],
    [
      "an opportunity with missing runtime receipts read as not fired",
      (value) => {
        value.safeguards[0].opportunity.state = "present";
        value.safeguards[0].logReceipt = null;
        value.safeguards[0].status = "not-fired";
      },
      ["status must be inconclusive"],
    ],
    [
      "a bound launch without its receipt identity set",
      (value) => {
        value.launchIdentity.state = "bound";
        value.launchIdentity.sha256 = "e".repeat(64);
        value.launchIdentity.pointer = pointer(MAIN_SYNTHESIS_MD, PREDICTIONS);
      },
      ["launchIdentity.ticket must be an object"],
    ],
  ];

  it.each(refused)("refuses %s", (_title, mutate, messages) => {
    const f = fixture();
    rewriteReview(f.archive, mutate);
    const issues = issuesOf(f.archive).join("\n");
    for (const message of messages) expect(issues).toContain(message);
  });

  it("rejects a fifth file instead of silently treating it as a handoff channel", () => {
    const f = fixture();
    writeFileSync(join(f.archive, "predictions.json"), "{}\n");
    expect(issuesOf(f.archive)).toContain("archive contains forbidden extra file: predictions.json");
  });

  it("records a valid archive outside it, exits 1 on a refused one and 2 on a misspelled flag", () => {
    const f = fixture();
    const out = join(f.dir, "validation.json");
    const valid = runValidator("--archive", f.archive, "--out", out);
    expect(valid.status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8")).valid).toBe(true);
    const inside = runValidator("--archive", f.archive, "--out", join(f.archive, "v.json"));
    expect(inside.status).toBe(2);
    expect(inside.stderr).toContain("--out must be outside the four-file archive");
    const misspelled = runValidator("--archve", f.archive);
    expect(misspelled.status).toBe(2);
    expect(misspelled.stderr).toContain(`unknown option "--archve"`);
    rewriteReview(f.archive, (value) => {
      value.authority = "binding";
    });
    const refusedRun = runValidator("--archive", f.archive);
    expect(refusedRun.status).toBe(1);
    expect(refusedRun.stderr).toContain("WRI authority must be exactly advisory");
  });
});

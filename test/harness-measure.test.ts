import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { isString } from "../src/meta/json-shape.ts";
import { hashJsonBytes, parseJsonAs } from "../src/meta/json-runtime.ts";
import { admitFindings, deriveIterationAnalysis, hostFindings } from "../src/analyse/iteration-analysis.ts";
import { latestRebuildAdvicePath } from "../src/author/rebuild-advice.ts";
import { loadRepoEnv } from "../src/backends/env.ts";
import { resolveSlots } from "../src/backends/resolve.ts";
import { readCaseRecord } from "../src/claim/case-record.ts";
import { EPOCH_REVIEW_SCHEMA, measuredConditionOf } from "../src/review/epoch-review-findings.ts";
import { analyseStep } from "../src/run/analyse-step.ts";
import { measurementDriverId } from "../src/run/harness-measure.ts";
import { MATCHING_TASKS, scriptedMatchingSolver } from "./helpers/matching-fixture.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { DRIVER_ID, measure, measureScratch, scaffoldRepo } from "./helpers/measure-repo.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

/**
 * The shared measurement entrypoint. The driver reads an adopted product, resolves the Built slot,
 * combines isolation probe and session evidence, then measures one battery with the adopted tools.
 * Fingerprinting, evaluation, case records and claims use their production paths; solvers, provider
 * sessions and selected host checks use doubles where each case states.
 *
 * Each case scaffolds its own adopted-product fixture through `helpers/measure-repo.ts`. What a
 * green run here proves is that the measurement code did what it was asked; it says nothing about
 * a model's ability to solve domain tasks, because every solver in this file is scripted. The
 * Judge pass that rides the same round belongs to `harness-measure-judge.test.ts`.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = measureScratch();

const ALL_MATCHING_IDS = new Set(MATCHING_TASKS.map((t) => t.taskId));

describe("measureHarness", () => {
  it.concurrent("refuses to run without an adopted harness — adoption is the build campaign's act, never the driver's", async () => {
    const repo = join(SCRATCH_ROOT, "no-adoption");
    mkdirSync(repo, { recursive: true });
    await expect(measure({ runId: "x", repoRoot: repo, processEnv: {} })).rejects.toThrow(
      /no adopted harness/,
    );
  });

  it.concurrent("names the round's claim in the observation stream, not in stderr alone", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "claim-observed"), { toolsSpec: true, conformance: true });
    await measure({
      runId: "m5-claim",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(new Set(), () => {}),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
    });
    const stream = readFileSync(
      join(repo, "campaigns", "bridge-truss", "observability", "m5-claim.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    // The round's verdict on its own battery must reach the stream, not stderr alone: a refusal
    // that holds its candidate leaves the next round sizing from a stale landing, and a live reader
    // watching the stream would see no row saying so.
    expect(
      stream.filter((row) => row.phase === "claim").map((row) => [row.state, row.summary, row.evidence]),
    ).toEqual([
      ["completed", "battery recorded — claim 4/4 truth", ["campaigns/bridge-truss/claims/m5-claim.json"]],
    ]);
  });

  it.concurrent("publishes the advice ledger before the epoch review turn, so an interrupted reviewer costs only its reading", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "analyse-ledger"), { toolsSpec: true, conformance: true });
    const processEnv = { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" };
    await measure({
      runId: "m4-ledger",
      repoRoot: repo,
      processEnv,
      solver: scriptedMatchingSolver(new Set(), () => {}),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
    });
    const measured = join(repo, "domains", "bridge-truss");
    const resolvedSlots = {
      ...resolveSlots(repo, "bridge-truss", loadRepoEnv(repo, processEnv)),
      review: { enabled: false, source: "operator" } as const,
    };
    const ledger = latestRebuildAdvicePath(repo, "bridge-truss");
    expect(existsSync(ledger)).toBe(false);
    // A provider interruption inside the epoch review turn would otherwise end the step before any
    // ledger is written, leaving the next rebuild to open with no advice from a battery that measured.
    await expect(
      analyseStep(repo, "bridge-truss", "m4-ledger", measured, {
        resolvedSlots,
        epochReview: async () => {
          throw new Error("provider interrupted the epoch review");
        },
      }),
    ).rejects.toThrow("provider interrupted the epoch review");
    const interrupted = JSON.parse(readFileSync(ledger, "utf8"));
    expect(interrupted.runId).toBe("m4-ledger");
    expect(interrupted.families).toEqual([
      { family: "single-part", verified: 2, passed: 2, unaccepted: 0, nonResults: 0 },
      { family: "two-part", verified: 2, passed: 2, unaccepted: 0, nonResults: 0 },
    ]);
    // The complete step republishes the same battery's ledger with what the readers attached.
    const complete = await analyseStep(repo, "bridge-truss", "m4-ledger", measured, { resolvedSlots });
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toEqual(complete.advice);
    expect(complete.advice.runId).toBe("m4-ledger");
    // A review slot that is off is an operator condition, not absent work.
    expect(complete.absent).toEqual([]);
    // Reader turns lost to the transport leave the controller terminal listing no absent step; a
    // reader turn that failed after it opened is named there.
    for (const status of ["failed", "incomplete"] as const) {
      const failed = await analyseStep(repo, "bridge-truss", "m4-ledger", measured, {
        resolvedSlots,
        epochReview: async (input) => {
          if (input.analysis === null) throw new Error("measured review lost its analysis");
          return {
            schema: EPOCH_REVIEW_SCHEMA,
            slug: "bridge-truss",
            runId: "m4-ledger",
            status,
            reason: "review did not finish",
            condition: measuredConditionOf({
              ...input.analysis.identities.bundleSnapshot,
              builtPin: input.analysis.identities.backendPin,
              verifierIdentity: null,
            }),
            reviewerPin: "pin",
            reviewerEffort: null,
            requestDigest: "request",
            obligationsDigest: "obligations",
            reads: [],
            contestedReads: [],
            coverage: { files: 0, opened: 0, chars: 0 },
            findings: [],
            disputes: [],
            report: null,
          };
        },
      });
      expect(failed.absent).toEqual([`epoch review: ${status} — review did not finish`]);
    }
  });

  it.concurrent("drives one battery through measurement and records its claim and case rows", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "e2e-spec"), { toolsSpec: true, conformance: true });
    const seen = new Set<string>();
    const started: string[] = [];
    const result = await measure({
      runId: "m4-e2e",
      repoRoot: repo,
      // The scripted solver carries a Codex-native identity, so the evaluated Built slot is
      // pinned to the same provider. Defaults are covered by the resolution suites.
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(new Set(), (_taskId, names) => {
        for (const name of names) seen.add(name);
      }),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
      onBatteryStart: (runId) => started.push(runId),
    });
    // One battery, one run id: the measured id is the base id, with no variant suffix.
    expect(result.runId).toBe("m4-e2e");
    expect(started).toEqual(["m4-e2e"]);
    expect(result.isolation.strength).toBe("physical");
    expect(existsSync(join(repo, "domains", "bridge-truss", "runs", "m4-e2e-repair-off"))).toBe(false);
    expect(existsSync(join(repo, "domains", "bridge-truss", "runs", "m4-e2e-repair-on"))).toBe(false);
    // The shipping battery offers the adopted tree's whole tool interface, advisers included.
    expect(seen.has("hint")).toBe(true);
    expect(seen.has("bind_slot")).toBe(true);
    const registration = parseJsonAs<{ tools: Array<{ name: string }> }>(
      readFileSync(
        join(repo, "domains", "bridge-truss", "runs", "m4-e2e", "cases", "t1", "built-registration.json"),
        "utf8",
      ),
    );
    expect(registration.tools.map((tool) => tool.name)).toContain("hint");
    // Campaign evidence lands in campaigns/bridge-truss — the driver wrote nothing by hand into
    // domains/ or runs/; that evidence is the runner's own.
    const rows = readCaseRecord(join(repo, "campaigns", "bridge-truss", "case-record.jsonl")).map(
      (e) => e.row,
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.runId).toBe("m4-e2e");
      expect(row.builderId).toBe(DRIVER_ID);
      expect(row.isolation?.strength).toBe("physical");
      expect(row.condition?.variant).toBe("shipping");
      expect(row.condition?.advisorsRemoved).toEqual([]);
    }
    // The executed probe is recorded beside those rows under the battery's own run id, so a later
    // reader can name the wall the paid turns ran behind. It carries both halves of the composed
    // evidence: nothing else in the tree writes this file, and until now nothing read it back.
    const probeRecord = parseJsonAs<{ strength: string; session: { role: string } }>(
      readFileSync(join(repo, "campaigns", "bridge-truss", "isolation-probe-m4-e2e.json"), "utf8"),
    );
    expect(probeRecord.strength).toBe("physical");
    expect(probeRecord.session.role).toBe(builtSession().role);

    // The gate identity is DERIVED from the slug, so a renamed ask cannot leave a stale literal
    // on the rows it evaluates.
    expect(DRIVER_ID).toBe("ana/drive-bridge-truss-battery");
    expect(measurementDriverId("regional-routing")).toBe("ana/drive-regional-routing-battery");
    // With the adoption-carried conformance evidence present the battery reads READY: created
    // claim, passing solvability witness, hash-joined conformance, clean run records.
    if (result.claim === null) throw new Error("expected the healthy battery to write a claim");
    const { claim } = result;
    const evidence = JSON.parse(readFileSync(claim.evidencePath, "utf8"));
    expect(evidence.solvability?.cases).toEqual(
      MATCHING_TASKS.map((task) => expect.objectContaining({ taskId: task.taskId, status: "passed" })),
    );
    expect(claim.created).toBe(true);
    expect(claim.statement?.passRate).toBe(1);
    expect(claim.readiness?.clauses).toEqual([]);
    expect(claim.readiness?.ready).toBe(true);
    // The typed terminal verdicts: measured (battery recorded), claimCreated and ready are SEPARATE —
    // the caller chooses which one is success.
    expect(result.verdicts).toEqual({ measured: true, claimCreated: true, ready: true });
    // Durable claim evidence lives OUTSIDE the recorded run dir (a post-record write into
    // runs/<runId>/ would itself be the recorded-evidence violation readiness checks for).
    expect(claim.evidencePath).toContain(join("campaigns", "bridge-truss", "claims"));
    expect(evidence.claim.ok).toBe(true);
    expect(evidence.claim.statement.runId).toBe("m4-e2e");
    expect(evidence.solvability?.cases.every((c: { status: string }) => c.status === "passed")).toBe(true);
    // The evidence record derives its packet from THESE recorded bytes and nothing else:
    // bundleSnapshot identity, censored denominators, the disclosed condition, per-case trace pointers.
    const analysis = deriveIterationAnalysis(repo, "bridge-truss", "m4-e2e");
    expect(analysis.schema).toBe("iteration-analysis/v5");
    expect(analysis.identities.isolationStrength).toBe("physical");
    expect(analysis.identities.bundleSnapshot.agentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(isString(analysis.identities.bundleSnapshot.taskSetHash)).toBe(true);
    expect(analysis.battery.runId).toBe("m4-e2e");
    expect(analysis.battery.condition).toMatchObject({ variant: "shipping", advisorsRemoved: [] });
    expect(analysis.battery.claimCreated).toBe(true);
    expect(analysis.battery.summary.passRate).toBe(1);
    expect(analysis.cases).toHaveLength(4);
    expect(analysis.absent.join(",")).toMatch(/main-judge census: revalidated by runJudgeReviews/);
    // A perfect battery carries no finding. It found no limit, which the measurement note owns and
    // states with its distance, its streak and its scope; the advisory this packet used to add said
    // the same thing under a kind naming a defect the harness does not have, routed to an owner the
    // evidence had not chosen. The packet is empty here and the digest still binds it.
    const findings = hostFindings(repo, analysis);
    expect(findings).toEqual([]);
    const admitted = admitFindings(repo, analysis, findings);
    expect(admitted.refused).toEqual([]);
    expect(admitted.feedback).toEqual([]);
    // Loop-closure precondition: a different packet is a different digest — altered evidence
    // can never masquerade as the consumed packet.
    const altered = { ...analysis, runId: "m4-e2e-tampered" };
    expect(hashJsonBytes(altered)).not.toBe(admitted.digest);
    // Change only protected verifier detail in the claim evidence's per-task solvability
    // diagnostics. Those diagnostics live outside the recorded run directory. Neither the
    // analysis digest nor feedback sent to the Builder may change when that detail changes.
    // The packet selects clause names, counts with their exclusions, and trace pointers;
    // it does not copy verifier text and then try to remove sensitive passages.
    const claimEvidence = JSON.parse(readFileSync(claim.evidencePath, "utf8"));
    claimEvidence.solvability = { tampered: "protected per-task diagnostics changed" };
    writeFileSync(claim.evidencePath, JSON.stringify(claimEvidence));
    const rederived = deriveIterationAnalysis(repo, "bridge-truss", "m4-e2e");
    expect(hashJsonBytes(rederived)).toBe(admitted.digest);
    expect(admitFindings(repo, rederived, hostFindings(repo, rederived)).feedback).toEqual(admitted.feedback);
    // An unrecorded verifier file inside the recorded run directory invalidates the evidence. The
    // analysis refuses it instead of silently omitting the file.
    const protectedTrace = join(repo, "domains", "bridge-truss", "runs", "m4-e2e", "cases");
    writeFileSync(join(protectedTrace, "trace.json"), `{"issues": "PROTECTED VERIFIER DETAIL"}`);
    expect(() => deriveIterationAnalysis(repo, "bridge-truss", "m4-e2e")).toThrow(
      /\[evidence-foreign\] cases\/trace\.json/,
    );
    unlinkSync(join(protectedTrace, "trace.json"));
    // Case rows disagreeing on isolation strength refuse: one battery, one isolation.
    // Mutated last on purpose: nothing after this line reads the fixture.
    const recordPath = join(repo, "campaigns", "bridge-truss", "case-record.jsonl");
    const entries = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    entries[0].row.isolation = { strength: "mutated-for-refusal-probe" };
    writeFileSync(recordPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    expect(() => deriveIterationAnalysis(repo, "bridge-truss", "m4-e2e")).toThrow(
      /disagree on isolation strength/,
    );
    // Also check the empty set: a pre-spend-skipped battery records ZERO case rows, and the
    // disagreement sentence over an empty set would misdescribe the condition as "disagree on
    // isolation strength ()". Zero rows is its own precondition failure.
    writeFileSync(
      recordPath,
      `${entries
        .map((entry) => JSON.stringify({ ...entry, row: { ...entry.row, runId: "another-run" } }))
        .join("\n")}\n`,
    );
    expect(() => deriveIterationAnalysis(repo, "bridge-truss", "m4-e2e")).toThrow(/recorded zero case rows/);
  }, 240_000);

  it.concurrent("creates an honest low-pass claim and leaves readiness to its own clause", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "one-pass"), { toolsSpec: true, conformance: true });
    const [keptTaskId] = [...ALL_MATCHING_IDS];
    const result = await measure({
      runId: "one-pass",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(new Set([...ALL_MATCHING_IDS].filter((id) => id !== keptTaskId))),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
    });
    // Create is a measurement, readiness is the verdict: a 1/4 battery creates exactly like a 4/4.
    expect(result.claim?.batteryScore).toEqual({ verified: 4, passed: 1 });
    expect(result.claim?.created).toBe(true);
    expect(result.claim?.readiness?.clauses.map((clause) => clause.clause) ?? []).not.toContain(
      "paid-agent-zero-pass",
    );
    expect(result.verdicts).toEqual({ measured: true, claimCreated: true, ready: true });
    // A 0/4 battery also creates a claim, with paid-agent-zero-pass in its readiness clauses.
    // This test checks measurement and readiness; it does not execute candidate promotion.
    const zero = await measure({
      runId: "zero-pass",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(ALL_MATCHING_IDS),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
    });
    expect(zero.claim?.created).toBe(true);
    expect(zero.claim?.statement?.passed).toBe(0);
    expect(zero.claim?.readiness?.ready).toBe(false);
    expect(zero.claim?.readiness?.clauses.map((c) => c.clause)).toEqual(["paid-agent-zero-pass"]);
    expect(zero.verdicts).toEqual({ measured: true, claimCreated: true, ready: false });
  }, 240_000);

  it.concurrent("settles a typed absence when every solve is provider-degraded — no crash, no 0/N score (live-run-08)", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "e2e-environment-blocked"), {
      toolsSpec: true,
      conformance: true,
    });
    const result = await measure({
      runId: "m4-blocked",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      // The exact solve shape run 8 recorded under the spend-limit outage: four outer turns, none
      // settling a provider result, zero tool starts, zero completions, no submit.
      solver: async () => ({
        turns: 4,
        completedTurns: 0,
        toolCalls: 0,
        startedToolCalls: 0,
        runtimeIdentities: [],
        nonResult: {
          kind: "provider",
          message: "no outer turn completed a provider result",
        },
        errors: [1, 2, 3, 4].map(
          (turn) => `turn ${String(turn)} completed no claude-opus-5 result (provider-degraded turn)`,
        ),
      }),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
    });
    // The battery drove and no claim was created: the null claim IS the statement of the absence,
    // and read as anything else this shape books as product failures. The reason lives in the
    // recorded battery and the typed case rows below, never in a second channel on the result.
    expect(result.claim).toBeNull();
    expect(result.verdicts).toEqual({ measured: false, claimCreated: false, ready: false });
    // The campaign record still carries every case as a typed solver non-result — visible to
    // analysis, excluded from every denominator.
    const rows = readCaseRecord(join(repo, "campaigns", "bridge-truss", "case-record.jsonl")).map(
      (e) => e.row,
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.runtimeNonResultKind).toBe("provider");
      expect(row.runtimeNonResult).toContain("no outer turn completed a provider result");
      expect(row.pass).toBeNull();
      expect(row.truthOk).toBeNull();
    }
    const blockedBattery = JSON.parse(
      readFileSync(join(repo, "domains", "bridge-truss", "runs", "m4-blocked", "battery.json"), "utf8"),
    );
    expect(blockedBattery.cases[0].solver.nonResult).toEqual({
      kind: "provider",
      message: "no outer turn completed a provider result",
    });
    // Every recorded case row carries its own controller timestamps.
    for (const row of blockedBattery.cases) {
      expect(row.solver.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Date.parse(row.solver.endedAt)).toBeGreaterThanOrEqual(Date.parse(row.solver.startedAt));
    }
  }, 240_000);

  it.concurrent("refuses a pre-persistence tree whose recorded tool specification is absent", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "e2e-nospec"), { toolsSpec: false });
    await expect(
      measure({
        runId: "m4-nospec",
        repoRoot: repo,
        processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
        solver: scriptedMatchingSolver(),
        createVerifier: () => fullFakeHost(),
        isolationProbe: () => probeEvidence(false),
      }),
    ).rejects.toThrow(/agent\/tools-spec\.json is missing/);
  }, 240_000);
});

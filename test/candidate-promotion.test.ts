/**
 * What lets a measured candidate replace the selected product. One battery decides a round, through
 * a set of floors the candidate meets on its own. Its claim has to reach
 * `measured` and then pass it, because stopping exactly at `measured` means the battery ran and
 * the claim was refused. Its battery has to have verified at least one case, since a battery of
 * non-results is an operational result and no capability result. Its tasks and correctness model
 * have to be readable and fingerprintable, or there is nothing to bind the decision to. And the
 * measured package has to differ from current's, or the round re-measured what is already
 * installed. That they are floors is the point: none is a contest with current, so a candidate
 * held at `claim-created` by a readiness clause still replaces a `ready` product. Promotion never
 * compares the two claim stages, which is why `current.claimStage` reaches the evidence row and
 * is read by nothing.
 *
 * Everything else is a hold, and a hold is not a no-op: current stays byte-identical while the
 * evidence row is still written, so the reason the candidate did not ship survives the round.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, basename } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { type ClaimStage, advanceClaimStage } from "../src/run/claim-stages.ts";
import {
  type PromotionEvidence,
  promoteCandidate,
  recordExperimentIntegrityHold,
} from "../src/run/candidate-promotion.ts";
import type { BundleSnapshotFact } from "../src/correctness-bundle/battery-record.ts";
import {
  measuredSelectedProduct,
  publishProductVersion,
  selectInitialProduct,
  selectedProductDir,
} from "../src/run/product-versions.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { ControllerLedger, controllerLedgerPath } from "../src/run/controller-ledger.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { measureDifficulty } from "../src/claim/battery-difficulty.ts";
import { selectNextMoveFromDisk } from "../src/run/next-move.ts";
import { decideDifficulty } from "../src/run/climb-readout.ts";
import { recordDifficultyDecision } from "../src/run/difficulty-decision.ts";
import { runBuildStep } from "../src/run/full-run-build-step.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { double, required } from "./helpers/doubles.ts";
import type { FullRunDeps } from "../src/run/full-run.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";

const SLUG = "bridge-truss";

const MEASURED: ClaimStage[] = ["build-admissible", "measured"];
const READY: ClaimStage[] = ["build-admissible", "measured", "claim-created", "ready"];

afterEach(cleanupScratch);

function scratchRoot(name: string): string {
  const root = scratchDir(`ana-${name}-`);
  writeFixtureThresholds(root);
  return root;
}

/** A minimal adopted tree in the two-bundle layout the fingerprint requires. The tasks.json bytes
 *  are its task-set identity and the agent bytes its solving identity, so a case moves exactly the
 *  one it is about. */
function tree(
  root: string,
  rel: string,
  tasks: string,
  stages: ClaimStage[],
  agent = "export const agent = 1;\n",
): string {
  const dir = join(root, rel);
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(join(dir, "correctness-model", "tasks.json"), tasks);
  writeFileSync(join(dir, "correctness-model", "evaluator.ts"), "export const rule = 1;\n");
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "agent", "index.ts"), agent);
  writeBoundRepresentation(dir);
  for (const stage of stages) advanceClaimStage(dir, stage, "test");
  if (rel.includes("/candidates/")) {
    const fingerprint = fingerprintSlug(dir, { slug: SLUG });
    if (!fingerprint.ok) throw new Error("invalid test product");
    const version = publishProductVersion({
      repoRoot: root,
      slug: SLUG,
      id: basename(dir),
      acceptedSnapshot: dir,
      fingerprint,
      conformancePath: join(dir, "conformance.json"),
    });
    for (const stage of stages.slice(1)) advanceClaimStage(version, stage, "test");
    return version;
  }
  if (rel.startsWith("domains/")) {
    const fingerprint = fingerprintSlug(dir, { slug: SLUG });
    if (!fingerprint.ok) throw new Error("invalid test product");
    const version = publishProductVersion({
      repoRoot: root,
      slug: SLUG,
      id: "current",
      acceptedSnapshot: dir,
      fingerprint,
      conformancePath: join(dir, "conformance.json"),
    });
    for (const stage of stages.slice(1)) advanceClaimStage(version, stage, "test");
    selectInitialProduct(root, SLUG, "current");
    return version;
  }
  return dir;
}

/** The shipping bundle the candidate's own battery recorded: taken from the candidate tree, so the
 *  fresh fingerprint promotion takes just before install has something real to agree with. */
function sealedBundleOf(candidateDir: string): BundleSnapshotFact {
  const observed = fingerprintSlug(candidateDir, { slug: SLUG });
  if (!observed.ok) throw new Error(`fixture candidate does not fingerprint: ${observed.findings[0]?.code}`);
  return {
    id: "shipping",
    agentHash: observed.agentHash,
    correctnessModelHash: observed.correctnessModelHash,
    scoringHash: observed.scoringHash,
    taskSetHash: observed.taskSetHash,
  };
}

const persistedRow = (root: string, runId: string): PromotionEvidence =>
  parseJsonAs<PromotionEvidence>(
    readFileSync(join(root, "campaigns", SLUG, "promotions", `${runId}.json`), "utf8"),
  );

describe("promoteCandidate — one battery, one decision", () => {
  it.each(["agent-repair", "verifier-repair", "unchanged", "zero-verified"] as const)(
    "checks the whole measured package for %s",
    (kind) => {
      const root = scratchRoot("promote-package");
      const previous = tree(root, `domains/${SLUG}`, '["same-exam"]', MEASURED);
      const original = sealedBundleOf(previous);
      const candidate = tree(
        root,
        `campaigns/${SLUG}/candidates/repair`,
        '["same-exam"]',
        READY,
        kind === "agent-repair" || kind === "zero-verified"
          ? "export const agent = 2;\n"
          : "export const agent = 1;\n",
      );
      if (kind === "verifier-repair") {
        const file = join(candidate, "conformance.json");
        writeFileSync(
          file,
          JSON.stringify({
            ...parseJsonAs<object>(readFileSync(file, "utf8")),
            verifierEnvironmentHash: "a".repeat(64),
          }),
        );
      }
      const repaired = kind === "agent-repair" || kind === "verifier-repair";
      const expectedShippingBundle = sealedBundleOf(candidate);
      const evidence = promoteCandidate(root, SLUG, candidate, "repair", {
        experiment: "build",
        transaction: { expectedShippingBundle },
        battery: { verified: kind === "zero-verified" ? 0 : 4 },
      });
      expect(evidence.decision).toBe(repaired ? "promoted" : "held");
      expect(evidence.shippingIdentity.observed).toMatchObject({
        agentHash: expectedShippingBundle.agentHash,
        correctnessModelHash: original.correctnessModelHash,
        taskSetHash: original.taskSetHash,
      });
      expect(sealedBundleOf(previous)).toEqual(original);
      expect(selectedProductDir(root, SLUG)).toBe(repaired ? candidate : previous);
      if (!repaired) {
        expect(evidence.clauses.join(" ")).toContain(
          kind === "unchanged" ? "stale-task-identity" : "candidate-zero-verified",
        );
      }
    },
  );

  it.each([true, false])(
    "a zero-pass battery with verified=%s keeps promotion, difficulty evidence and the next adopted seed distinct",
    async (accepted) => {
      const root = scratchRoot("promote-zero-pass-climb");
      const tasks = (level: number) =>
        Array.from({ length: 25 }, (_, i) => ({
          taskId: `level-${level}-${i}`,
          family: "truss",
          level,
          publicInput: { span: level + i },
          hidden: [],
        }));
      const previous = tree(root, `domains/${SLUG}`, JSON.stringify(tasks(1)), MEASURED);
      const failedTasks = JSON.stringify(tasks(2));
      const candidate = tree(root, `campaigns/${SLUG}/candidates/failed-l2`, failedTasks, READY);
      const expectedShippingBundle = sealedBundleOf(candidate);
      const measured = measureDifficulty(tasks(2).map((task) => ({ item: task.family, pass: false })));
      const evidence = new EvidenceLog(join(candidate, "runs", "failed-l2"));
      evidence.write("battery.json", {
        runId: "failed-l2",
        backendPin: "fixture",
        thresholdManifestDigest: fixtureThresholdDigest(root),
        condition: { variant: "shipping" },
        bundleSnapshot: expectedShippingBundle,
        cases: tasks(2).map((task) => ({
          taskId: task.taskId,
          pass: false,
          acceptedSubmit: accepted,
          truthOk: accepted ? false : null,
        })),
        measured,
      });
      evidence.record();
      const promoted = promoteCandidate(root, SLUG, candidate, "failed-l2", {
        experiment: "climb",
        transaction: { expectedShippingBundle },
        battery: { verified: accepted ? 25 : 0 },
      });
      expect(promoted.decision).toBe(accepted ? "promoted" : "held");
      if (!accepted) {
        expect(promoted.clauses.join(" ")).toContain("candidate-zero-verified");
        expect(selectedProductDir(root, SLUG)).toBe(previous);
        expect(
          decideDifficulty([
            { runId: "failed-l2", batterySha256: "fixture", n: 25, passed: 0, unaccepted: 25, measured },
          ]).placement,
        ).toBeNull();
        return;
      }
      const claims = join(root, "campaigns", SLUG, "claims");
      mkdirSync(claims, { recursive: true });
      writeFileSync(
        join(claims, "failed-l2.json"),
        JSON.stringify({
          schema: "run-claim/v1",
          runId: "failed-l2",
          createdAt: "2026-09-09T00:00:00Z",
          claim: { ok: true },
        }),
      );
      const selected = selectNextMoveFromDisk({
        repoRoot: root,
        manifest: { slug: SLUG, domain: SLUG, expectedTasks: 25 },
        baseKickoff: "build trusses",
        runPin: "fixture",
        runId: "intermediate",
        domainDir: selectedProductDir(root, SLUG),
        builder: { kind: "codex", model: "fixture", reasoningEffort: "low" },
      });
      expect(selected.readout?.decision).toMatchObject({ placement: { zone: "too-hard" } });
      expect(selected.decision).toMatchObject({ move: "rebuild", seed: "adopted" });
      expect(selected.kickoff).toBe("build trusses");
      let calls = 0;
      const build: FullRunDeps["build"] = async (_manifest, options) => {
        calls += 1;
        expect(selectedProductDir(root, SLUG)).toBe(candidate);
        expect(readFileSync(join(candidate, "correctness-model", "tasks.json"), "utf8")).toBe(failedTasks);
        expect(options?.advisoryNote).toContain("passed 0 of 25");
        return double({
          buildAdmissible: false,
          adopted: false,
          clauses: ["fixture-stop-before-authoring"],
          iterations: [],
        });
      };
      await runBuildStep(
        double({
          args: {},
          repoRoot: root,
          manifest: { slug: SLUG },
          runId: "intermediate",
          runPin: "fixture",
          slots: {},
          userContext: EMPTY_USER_CONTEXT,
          deps: { build },
          observer: createRunObserver(root, SLUG, "intermediate"),
        }),
        selected.decision,
        {
          kickoff: selected.kickoff,
          prior: selected.prior,
          lineage: selected.lineage,
          difficulty: recordDifficultyDecision({
            campaignRoot: campaignDir(root, SLUG),
            runId: "intermediate",
            slug: SLUG,
            difficulty: required(selected.readout, "the round's readout"),
          }),
        },
      );
      expect(calls).toBe(1);
    },
  );

  it("adopts a claim-created candidate over a ready product and holds an unmeasured or unclaimed one", () => {
    const root = scratchRoot("stage-floor");
    tree(root, `domains/${SLUG}`, `["v1-tasks"]`, READY);
    const below = tree(root, `campaigns/${SLUG}/candidates/r2`, `["v2-tasks"]`, [
      "build-admissible",
      "measured",
      "claim-created",
    ]);
    const adopted = promoteCandidate(root, SLUG, below, "r2", {
      experiment: "build",
      transaction: { expectedShippingBundle: sealedBundleOf(below) },
      battery: { verified: 5 },
    });
    expect(adopted.decision).toBe("promoted");
    expect(adopted.clauses).toEqual([]);
    expect(adopted.current.claimStage).toBe("ready");
    expect(adopted.candidate.claimStage).toBe("claim-created");

    const unmeasured = tree(root, `campaigns/${SLUG}/candidates/r3`, `["v3-tasks"]`, ["build-admissible"]);
    const held = promoteCandidate(root, SLUG, unmeasured, "r3", {
      experiment: "build",
      transaction: { expectedShippingBundle: sealedBundleOf(unmeasured) },
      battery: { verified: 5 },
    });
    expect(held.decision).toBe("held");
    expect(held.clauses).toEqual(['candidate-unmeasured: its claim stages end at "build-admissible"']);

    // Verified cases, but the battery's claim was refused, so the stages stop at measured.
    const refused = tree(root, `campaigns/${SLUG}/candidates/r4`, `["v4-tasks"]`, MEASURED);
    const unclaimed = promoteCandidate(root, SLUG, refused, "r4", {
      experiment: "build",
      transaction: { expectedShippingBundle: sealedBundleOf(refused) },
      battery: { verified: 14 },
    });
    expect(unclaimed.decision).toBe("held");
    expect(unclaimed.clauses).toEqual([expect.stringContaining("candidate-claim-refused")]);
  });

  it("promotes a measured build candidate whose battery verified cases and retains the previous product", () => {
    const root = scratchRoot("promote");
    tree(root, `domains/${SLUG}`, `["v1-tasks"]`, MEASURED);
    const candidate = tree(root, `campaigns/${SLUG}/candidates/r2`, `["v2-tasks"]`, READY);

    const evidence = promoteCandidate(root, SLUG, candidate, "r2", {
      experiment: "build",
      transaction: { expectedShippingBundle: sealedBundleOf(candidate) },
      battery: { verified: 5 },
    });

    expect(evidence.decision).toBe("promoted");
    expect(evidence.clauses).toEqual([]);
    expect(evidence.battery).toEqual({ verified: 5 });
    expect(
      readFileSync(join(selectedProductDir(root, SLUG), "correctness-model", "tasks.json"), "utf8"),
    ).toBe(`["v2-tasks"]`);
    // The previous product stays at its retained address.
    expect(
      readFileSync(
        join(evidence.current.archivedTo ?? "missing-retained-product", "correctness-model", "tasks.json"),
        "utf8",
      ),
    ).toBe(`["v1-tasks"]`);
    expect(existsSync(candidate)).toBe(true);
    expect(persistedRow(root, "r2").decision).toBe("promoted");
    // Selection no longer creates a directory-install journal.
    const promotions = readdirSync(join(root, "campaigns", SLUG, "promotions"));
    expect(promotions.some((file) => file.endsWith("-install-journal.json") || file.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("holds a climb candidate whose harness identity moved, and promotes the one that only moved the battery", () => {
    const root = scratchRoot("promote-climb");
    tree(root, `domains/${SLUG}`, `["level-1"]`, MEASURED);
    // A climb freezes the agent and the correctness model and changes only the task difficulty.
    // This candidate rewrote the agent, so it does not qualify as a task-only change.
    const drifted = tree(
      root,
      `campaigns/${SLUG}/candidates/r3`,
      `["level-2"]`,
      READY,
      "export const agent = 2;\n",
    );

    const held = promoteCandidate(root, SLUG, drifted, "r3", {
      experiment: "climb",
      transaction: { expectedShippingBundle: sealedBundleOf(drifted) },
      battery: { verified: 5 },
    });
    expect(held.decision).toBe("held");
    expect(held.clauses.join("; ")).toContain("climb-harness-drifted");
    expect(readFileSync(join(root, "domains", SLUG, "correctness-model", "tasks.json"), "utf8")).toBe(
      `["level-1"]`,
    );

    // The positive half: the same climb with the frozen harness kept byte-identical.
    const frozen = tree(root, `campaigns/${SLUG}/candidates/r4`, `["level-2"]`, READY);
    const promoted = promoteCandidate(root, SLUG, frozen, "r4", {
      experiment: "climb",
      transaction: { expectedShippingBundle: sealedBundleOf(frozen) },
      battery: { verified: 5 },
    });
    expect(promoted.clauses).toEqual([]);
    expect(promoted.decision).toBe("promoted");
    expect(
      readFileSync(join(selectedProductDir(root, SLUG), "correctness-model", "tasks.json"), "utf8"),
    ).toBe(`["level-2"]`);
  });
});

describe("recordExperimentIntegrityHold", () => {
  it("writes a held row before any battery is measured, naming the clauses that held it", () => {
    const root = scratchRoot("integrity-hold");
    tree(root, `domains/${SLUG}`, `["level-1"]`, MEASURED);
    const candidate = tree(
      root,
      `campaigns/${SLUG}/candidates/r5`,
      `["level-1"]`,
      READY,
      "export const agent = 2;\n",
    );

    const evidence = recordExperimentIntegrityHold({
      repoRoot: root,
      slug: SLUG,
      runId: "r5",
      candidateDir: candidate,
      experiment: "climb",
      clauses: ["climb-harness-drifted: the candidate changed the agent"],
    });

    expect(evidence.decision).toBe("held");
    expect(evidence.experiment).toBe("climb");
    expect(evidence.clauses[0]).toContain("climb-harness-drifted");
    // No battery ran, so the row states that instead of reading zero as a measurement.
    expect(evidence.battery).toBeNull();
    expect(evidence.current.archivedTo).toBe(selectedProductDir(root, SLUG));
    expect(evidence.candidate.dir).toBe(candidate);
    // The row is on disk under the run id, where the promotion reader and the loop terminal cite it.
    expect(persistedRow(root, "r5").decision).toBe("held");
    // Nothing was installed.
    expect(readFileSync(join(root, "domains", SLUG, "correctness-model", "tasks.json"), "utf8")).toBe(
      `["level-1"]`,
    );
    expect(existsSync(candidate)).toBe(true);
  });

  it("refuses to replay a committed row whose bytes moved after its digest", () => {
    const root = scratchRoot("digest-replay");
    tree(root, `domains/${SLUG}`, `["v1-tasks"]`, MEASURED);
    const candidate = tree(root, `campaigns/${SLUG}/candidates/r7`, `["v2-tasks"]`, READY);
    const inputs = { experiment: "build", battery: { verified: 5 } } as const;
    promoteCandidate(root, SLUG, candidate, "r7", {
      ...inputs,
      transaction: { expectedShippingBundle: sealedBundleOf(candidate) },
    });
    // A shape-valid edit: every identity the replay compares still holds, only a clause moved.
    const db = new Database(controllerLedgerPath(campaignDir(root, SLUG)));
    const committed = required(
      db.query<{ evidence: string }, [string]>("SELECT evidence FROM product_decisions WHERE id=?").get("r7"),
      "committed promotion row",
    );
    const edited = { ...parseJsonAs<PromotionEvidence>(committed.evidence), clauses: ["edited"] };
    db.run("UPDATE product_decisions SET evidence=? WHERE id=?", [JSON.stringify(edited), "r7"]);
    db.close();
    expect(() => promoteCandidate(root, SLUG, candidate, "r7", { ...inputs, transaction: {} })).toThrow(
      "no longer match its digest",
    );
  });
});

describe("measuredSelectedProduct", () => {
  /** A `reused` measurement round binds a later runId to the version already selected, so
   *  `advice.runId !== selectedId` said "not this tree" of a battery that measured exactly it. The
   *  ledger holds the binding; the reader asks it. */
  it("answers from the ledger's binding, and leaves an unbound battery unmade", () => {
    const root = scratchRoot("measured-selected");
    tree(root, `domains/${SLUG}`, "[1]", MEASURED);
    tree(root, `campaigns/${SLUG}/candidates/other`, "[2]", MEASURED);
    using ledger = ControllerLedger.open(campaignDir(root, SLUG));
    ledger.bindMeasurement("i02", "current");
    ledger.bindMeasurement("i03", "other");
    expect(measuredSelectedProduct(root, SLUG, "i02")).toBe(true);
    expect(measuredSelectedProduct(root, SLUG, "i03")).toBe(false);
    expect(measuredSelectedProduct(root, SLUG, "never-ran")).toBeNull();
    expect(measuredSelectedProduct(root, "no-such-slug", "i02")).toBeNull();
  });
});

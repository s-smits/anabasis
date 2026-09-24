import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isRecord } from "../src/meta/json-shape.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import { BATTERY_SIZE } from "../src/run/battery-sizing.ts";
import { selectNextMoveFromDisk } from "../src/run/next-move.ts";
import { runBuildStep } from "../src/run/full-run-build-step.ts";
import {
  AUTHORING_STALL_LIMIT,
  loopTerminal,
  nextUnresolvedAuthoringStall,
  type IterationResult,
  type LoopState,
} from "../src/run/full-run-round.ts";
import type { FullRunDeps } from "../src/run/full-run.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { validateTasks, type BuildTask } from "../src/truth/tasks.ts";
import { MATCHING_BRIEF, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";
import { double, required } from "./helpers/doubles.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { recordDifficultyDecision } from "../src/run/difficulty-decision.ts";

const SLUG = "matching";
const RUN_PIN = "broadening-test";
const scratch: string[] = [];
afterAll(() => {
  for (const root of scratch) rmSync(root, { recursive: true, force: true });
});

function tasks(prefix: string): BuildTask[] {
  return Array.from({ length: BATTERY_SIZE.default }, (_, i) => ({
    taskId: `${prefix}-${i}`,
    family: `${prefix}-${i % 2}`,
    level: 2,
    publicInput: {
      parts: [`${prefix}-part-${i}`],
      bindings: [{ part: `${prefix}-part-${i}`, slot: `slot-${i}` }],
    },
    hidden: [
      { checkId: "parts-assigned", expectation: { parts: [`${prefix}-part-${i}`] } },
      { checkId: "expected-binding", expectation: { pairs: [[`${prefix}-part-${i}`, `slot-${i}`]] } },
    ],
  }));
}

/** Record two passing levels through the real evidence writer, then ask the disk selector. Two,
 * because a third would reach the off-aim allowance and stop the campaign; family scope is what
 * this file is about, and test/next-move-rebuild.test.ts owns the allowance itself. */
function saturatedRoot(brief: typeof MATCHING_BRIEF, previous: BuildTask[]): string {
  const root = mkdtempSync(join(tmpdir(), "ana-broaden-scope-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  const modelDir = join(root, "domains", SLUG, "correctness-model");
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(join(modelDir, "brief.json"), JSON.stringify(brief));
  writeFileSync(join(modelDir, "tasks.json"), JSON.stringify(previous));
  mkdirSync(claimsDirFor(root, SLUG), { recursive: true });
  for (const level of [0, 1]) recordBattery(root, `level-${level}`, previous, { level });
  return root;
}

/** One passing battery with its public tasks and created claim, through the real evidence writer.
 *  `condition` overrides the run's own pin or adds a threshold manifest digest. */
function recordBattery(
  root: string,
  runId: string,
  previous: BuildTask[],
  recorded: { level: number; condition?: { backendPin?: string; thresholdManifestDigest?: string } },
): void {
  const { level } = recorded;
  const evidence = new EvidenceLog(join(root, "domains", SLUG, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: RUN_PIN,
    thresholdManifestDigest: fixtureThresholdDigest(root),
    ...recorded.condition,
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", correctnessModelHash: "correctnessModel-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: previous.map((task) => ({ taskId: task.taskId, pass: true, acceptedSubmit: true })),
    measured: {
      items: [],
      levels: [
        {
          level,
          attempts: previous.length,
          passes: previous.length,
          rate: 1,
          lo: 0.96,
          hi: 1,
          difficulty: level,
        },
      ],
      findings: [],
    },
  });
  for (const task of previous) {
    evidence.write(`cases/${task.taskId}/public-task.json`, {
      taskId: task.taskId,
      publicTask: { taskId: task.taskId, publicInput: task.publicInput },
    });
  }
  evidence.record();
  writeFileSync(
    join(claimsDirFor(root, SLUG), `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      createdAt: `2026-09-09T0${level}:00:00Z`,
      claim: { ok: true },
    }),
  );
}

it.each(["all", "unmeasured", "exhausted"] as const)(
  "the Builder chooses its experiment with %s adopted family scopes",
  async (scope) => {
    const brief = structuredClone(MATCHING_BRIEF);
    const previous = tasks("measured");
    const fresh = tasks("fresh");
    const named = ["measured-0", "measured-1", "fresh-0", "fresh-1"];
    for (const check of brief.truthChecks) check.execution.families = scope === "all" ? "all" : named;
    if (scope === "exhausted") brief.truthChecks[0]!.execution.families = ["measured-0", "measured-1"];
    const validation = validateTasks(
      brief,
      { tasks: fresh },
      { authoring: true, exactTasks: previous.length },
    );
    // A check scoped away from every fresh family leaves its hidden operands unread; that row names it.
    if (scope === "exhausted") {
      expect(validation.findings.map((row) => row.code)).toContain("tasks-hidden-operand-unexpected");
    } else expect(validation.findings).toEqual([]);

    const root = saturatedRoot(brief, previous);
    const selected = selectNextMoveFromDisk({
      repoRoot: root,
      manifest: { slug: SLUG, domain: SLUG, expectedTasks: previous.length },
      baseKickoff: "assign parts to slots",
      runPin: RUN_PIN,
      runId: "next-round",
      domainDir: join(root, "domains", SLUG),
      builder: { kind: "codex", model: "test-model", reasoningEffort: "low" },
    });
    expect(selected.decision).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(selected.readout?.decision).toMatchObject({
      action: "placed",
      placement: { zone: "too-easy" },
    });
    expect(selected.decision).not.toHaveProperty("final");
    expect(selected.kickoff).toBe("assign parts to slots");
    expect(selected.decision.reopenKey).toMatch(/^experiment:[a-f0-9]{64}$/);
    await assertRebuildRound(root, selected);
  },
);

async function assertRebuildRound(
  root: string,
  selected: ReturnType<typeof selectNextMoveFromDisk>,
): Promise<void> {
  let calls = 0;
  const build: FullRunDeps["build"] = async (_manifest, options) => {
    calls += 1;
    expect(options).toMatchObject({
      experiment: "build",
      kickoff: selected.kickoff,
      epochPass: selected.decision.reopenKey,
    });
    expect(options?.advisoryNote).toContain(selected.decision.reason);
    expect(options?.measured?.history?.().map((doc) => doc.id)).toContain("history/overview");
    return double({
      buildAdmissible: false,
      adopted: false,
      clauses: ["iterations-exhausted"],
      iterations: [],
    });
  };
  const built = await runBuildStep(
    double({
      args: {},
      repoRoot: root,
      manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
      runId: "next-round",
      runPin: RUN_PIN,
      slots: {},
      userContext: EMPTY_USER_CONTEXT,
      deps: { build },
      observer: createRunObserver(root, SLUG, "next-round"),
    }),
    selected.decision,
    {
      kickoff: selected.kickoff,
      prior: selected.prior,
      lineage: selected.lineage,
      difficulty: recordDifficultyDecision({
        campaignRoot: campaignDir(root, SLUG),
        runId: "next-round",
        slug: SLUG,
        difficulty: required(selected.readout, "the round's readout"),
      }),
    },
  );
  expect(calls).toBe(1);
  const failed: IterationResult = double({
    decision: selected.decision,
    nextDecision: selected.decision,
    build: built.build,
    buildClauses: built.clauses,
    admissionBasisDigest: selected.prior?.digest ?? null,
    steps: { promotion: null, measure: null },
  });
  const loop: LoopState = {
    budget: { status: () => "active" },
    blockedRounds: 0,
    authoringStall: null,
  };
  for (let round = 1; round <= AUTHORING_STALL_LIMIT; round += 1) {
    loop.authoringStall = nextUnresolvedAuthoringStall(loop.authoringStall, failed);
    const terminal = loopTerminal(failed, loop);
    if (round < AUTHORING_STALL_LIMIT) expect(terminal).toBeNull();
    else expect(terminal).toContain("earlier recorded iterations keep their own evidence");
  }
  expect(loop.authoringStall?.rounds).toBe(AUTHORING_STALL_LIMIT);
}

it("keeps another pin's and another threshold's public tasks readable, outside the readout", async () => {
  const previous = tasks("measured");
  const root = saturatedRoot(MATCHING_BRIEF, previous);
  const select = () =>
    selectNextMoveFromDisk({
      repoRoot: root,
      manifest: { slug: SLUG, domain: SLUG, expectedTasks: previous.length },
      baseKickoff: "assign parts to slots",
      runPin: RUN_PIN,
      runId: "next-round",
      domainDir: join(root, "domains", SLUG),
      builder: { kind: "codex", model: "test-model", reasoningEffort: "low" },
    });
  const alone = select();
  // Two more passing batteries, newer than the run's own: a third same-side round would spend the
  // allowance and stop the campaign, so either one entering the readout shows at once.
  recordBattery(root, "other-pin", previous, { level: 2, condition: { backendPin: "other-model" } });
  recordBattery(root, "other-thresholds", previous, {
    level: 3,
    condition: { thresholdManifestDigest: "other-manifest" },
  });
  const selected = select();
  const readout = required(selected.readout, "the round's readout");
  expect(selected.decision.move).toBe("rebuild");
  expect(readout.decision).toEqual(required(alone.readout, "the prior readout").decision);
  expect(readout.rows).toEqual(required(alone.readout, "the prior readout").rows);
  expect(readout.allowance).toEqual(required(alone.readout, "the prior readout").allowance);
  expect(readout.excluded.map((row) => row.runId)).toEqual(["other-pin", "other-thresholds"]);

  let pages: unknown[] = [];
  const build: FullRunDeps["build"] = async (_manifest, options) => {
    const history = required(options?.measured?.history, "the history source")();
    pages = ["other-pin", "other-thresholds"].map((runId) => {
      const doc = history.find((item) => item.id === `history/${runId}`);
      const text = doc !== undefined && "text" in doc ? doc.text() : "";
      const page = capturedJsonParse(text.slice(text.indexOf("\n") + 1));
      if (!isRecord(page) || !Array.isArray(page.tasks)) return page;
      return { ...page, tasks: page.tasks.filter((task) => isRecord(task) && task.taskId === "measured-3") };
    });
    return double({
      buildAdmissible: false,
      adopted: false,
      clauses: ["iterations-exhausted"],
      iterations: [],
    });
  };
  await runBuildStep(
    double({
      args: {},
      repoRoot: root,
      manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
      runId: "next-round",
      runPin: RUN_PIN,
      slots: {},
      userContext: EMPTY_USER_CONTEXT,
      deps: { build },
      observer: createRunObserver(root, SLUG, "next-round"),
    }),
    selected.decision,
    {
      kickoff: selected.kickoff,
      prior: selected.prior,
      lineage: selected.lineage,
      difficulty: recordDifficultyDecision({
        campaignRoot: campaignDir(root, SLUG),
        runId: "next-round",
        slug: SLUG,
        difficulty: readout,
      }),
    },
  );
  const task = { taskId: "measured-3", publicInput: previous[3]?.publicInput };
  expect(pages).toEqual([
    {
      runId: "other-pin",
      condition: {
        backendPin: "other-model",
        thresholdManifestDigest: fixtureThresholdDigest(root),
        variant: "shipping",
      },
      tasks: [task],
    },
    {
      runId: "other-thresholds",
      condition: { backendPin: RUN_PIN, thresholdManifestDigest: "other-manifest", variant: "shipping" },
      tasks: [task],
    },
  ]);
});

it("carries accepted intent and the host-derived changed subset out of the build step", async () => {
  const root = saturatedRoot(MATCHING_BRIEF, tasks("measured"));
  const baseline = join(root, "domains", SLUG);
  const acceptedSnapshot = join(root, "accepted");
  for (const dir of [baseline, acceptedSnapshot]) writeMatchingBuildFixture(dir);
  writeFileSync(join(acceptedSnapshot, "correctness-model/tasks.json"), JSON.stringify(tasks("new")));
  const proposal = {
    scope: "tasks" as const,
    target: { comparator: "at-least" as const, verifiedPasses: 0 },
    gap: "Coverage was narrow.",
    change: "Author new families.",
    ...PLAN_FIELDS,
    expectedResult: "Test coordination.",
  };
  const experimentProposal = { ...proposal, digest: hashJsonValue(proposal) };
  const result = await runBuildStep(
    double({
      args: {},
      repoRoot: root,
      manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
      runId: "next-round",
      runPin: RUN_PIN,
      slots: {},
      userContext: EMPTY_USER_CONTEXT,
      deps: {
        build: async () => ({
          buildAdmissible: true,
          adopted: true,
          acceptedSnapshot,
          experimentProposal,
          experimentScope: { actual: "climb", operation: { operation: "task-probe", moved: ["tasks"] } },
          iterations: [],
        }),
      },
      observer: createRunObserver(root, SLUG, "next-round"),
    }),
    { move: "rebuild", seed: "adopted", reason: "Choose the next experiment." },
    { kickoff: "assign parts", prior: null, lineage: null, difficulty: null },
  );
  expect(result.build).toBe("candidate");
  expect(result.experiment).toBe("climb");
  expect(result.experimentAuthoring?.proposal).toEqual(experimentProposal);
  expect(result.experimentAuthoring?.changedTaskIds).toEqual(tasks("new").map((task) => task.taskId));
  const fingerprint = fingerprintSlug(baseline);
  if (!fingerprint.ok || fingerprint.taskSetHash === null) throw new Error("fixture baseline refused");
  expect(result.experimentAuthoring?.baseline.taskSetHash).toBe(fingerprint.taskSetHash);
});

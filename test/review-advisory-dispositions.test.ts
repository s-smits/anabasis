/**
 * What a review records of the advisory defects the review before it recorded.
 *
 * An advisory defect reopens nothing, and one the next review did not name again left no trace
 * anywhere: no record said whether it still stood, came back as something other than a defect, or
 * was simply not repeated, so a defect the reviewer stopped mentioning read the same as one that
 * had been repaired. The next completed review now records each one's disposition, host-side and
 * from public identities alone. Absent is not fixed: a review that did not name a defect measured
 * nothing about it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import type { AnalysisFinding } from "../src/analyse/iteration-analysis.ts";
import type { RebuildAdvicePacket } from "../src/author/rebuild-advice.ts";
import { BUNDLE_FILES } from "../src/author/feedback-routing.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { EPOCH_REVIEW_SCHEMA, measuredConditionOf } from "../src/review/epoch-review-findings.ts";
import { type EpochReviewInput, runEpochReview } from "../src/review/epoch-reviewer.ts";
import { advisoryDefects, advisoryRecord, carriedDemonstrations } from "../src/review/review-carry.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { reviewInventory } from "../src/review/review-sources.ts";
import type { ReaderTool } from "../src/review/review-reader.ts";
import { double, required } from "./helpers/doubles.ts";
import { call } from "./helpers/review-fixtures.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SLUG = "bounds";
const TOOLS = "agent/tools.ts";
const QUOTE = "return { count: 11 };";

const review = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

/** A battery that verified nothing, as the runner records one. */
const NO_FIRING = {
  firedByCheck: {},
  executedByCheck: {},
  blockingByCheck: {},
  applicableByCheck: {},
  verifierVerifiedCount: 0,
};

/** The earlier review's findings: three advisory defects, one naming a check, one a public input
 *  and one nothing, beside a blocking defect and an observation, which carry no disposition. */
const EARLIER: AnalysisFinding[] = [
  { owner: TOOLS, defect: true, severity: "advisory", claim: "c", evidence: "e", checkId: "bounds" },
  { owner: "agent/BUILT_AGENTS.md", defect: true, severity: "advisory", claim: "c", evidence: "e" },
  {
    owner: "correctness-model/tasks.json",
    defect: true,
    severity: "advisory",
    claim: "c",
    evidence: "e",
    publicInputPath: "$.limit",
  },
  { owner: "correctness-model/evaluator.ts", defect: true, claim: "c", evidence: "e", checkId: "other" },
  { owner: "correctness-model/tasks.json", defect: false, claim: "c", evidence: "e", checkId: "bounds" },
];

afterAll(cleanupScratch);

/** A measured tree whose one tool file returns a count past the published ten. */
function measuredTree(): string {
  const root = scratchDir("ana-advisory-dispositions-");
  for (const path of BUNDLE_FILES) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "{}");
  }
  writeFileSync(join(root, TOOLS), QUOTE);
  writeFileSync(
    join(root, "correctness-model/brief.json"),
    JSON.stringify({ artifactSchema: [{ name: "count" }], truthChecks: [{ id: "bounds" }] }),
  );
  const log = new EvidenceLog(join(root, "runs/r1"));
  log.write("battery.json", {
    runId: "r1",
    cases: [],
    execution: { executed: [], tools: {}, verifierEnvironmentHash: null },
    executionEvidence: [],
    truthCheckFiring: NO_FIRING,
  });
  log.record();
  return root;
}

/** The previous battery's completed review, recorded under another measured condition. */
function recordEarlier(root: string, runId: string, findings: AnalysisFinding[]): void {
  const dir = join(root, "campaigns", SLUG, "analysis");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}-epoch-review.json`),
    JSON.stringify({
      schema: EPOCH_REVIEW_SCHEMA,
      slug: SLUG,
      runId,
      status: "completed",
      reason: null,
      condition: measuredConditionOf({
        agentHash: "a0",
        correctnessModelHash: "c",
        taskSetHash: "t",
        builtPin: "built-pin",
        verifierIdentity: "v",
      }),
      coverage: { files: 1, opened: 1, chars: 1, complete: true },
      findings,
      disputes: [],
    }),
  );
}

/** One measured review of battery r1, whose prior advice packet names `priorRunId`, and whose
 *  reader reads every source file, then takes `step`, then ends with `error`. */
async function measured(
  root: string,
  priorRunId: string,
  step: (tools: ReadonlyMap<string, ReaderTool>) => Promise<void>,
  error: string | null = null,
) {
  return runEpochReview({
    repoRoot: root,
    slug: SLUG,
    runId: "r1",
    treeRoot: ".",
    priorAdvice: double<RebuildAdvicePacket>({
      runId: priorRunId,
      backendPin: "built-pin",
      issues: [],
      families: [],
    }),
    publicRequest: "Choose a count at most ten.",
    analysis: double<EpochReviewInput["analysis"]>({
      slug: SLUG,
      runId: "r1",
      treeRoot: ".",
      cases: [],
      identities: {
        bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
        backendPin: "built-pin",
      },
      battery: {
        summary: { passed: 0, verified: 0, unaccepted: 0, nonResults: 0 },
        blockingByCheck: {},
        applicableByCheck: {},
      },
    }),
    review,
    readerTurn: async ({ tools }) => {
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      const reader = required(byName.get("read_source"), "read_source");
      for (const file of reviewInventory(root).files) await call(reader, { path: file });
      await step(byName);
      return { pin: null, text: "Read.", error };
    },
  });
}

/** The bounds defect again, on the tool file that returns eleven. */
async function boundsDefect(tools: ReadonlyMap<string, ReaderTool>): Promise<string> {
  return call(required(tools.get("record_finding"), "record_finding"), {
    defect: true,
    claim: "the writer exceeds the upper bound",
    owner: TOOLS,
    severity: "advisory",
    checkId: "bounds",
    demonstration:
      "The request limits count to ten; this writer always returns eleven, so its output violates that limit. This is source-derived.",
    citations: [{ path: TOOLS, quote: QUOTE }],
  });
}

describe("each earlier advisory defect, as the next completed review left it", () => {
  it("records on a measured review what the previous battery's review left advisory", async () => {
    const root = measuredTree();
    recordEarlier(root, "r0", EARLIER);
    const result = await measured(root, "r0", async (tools) => {
      // Named at a second measured condition, the advisory defect is admitted blocking.
      expect(await boundsDefect(tools)).toBe("recorded defect as blocking");
    });
    expect(result.status).toBe("completed");
    expect(result.earlierAdvisory).toEqual([
      { runId: "r0", owner: TOOLS, subject: "bounds", disposition: "standing", severity: "blocking" },
      { runId: "r0", owner: "agent/BUILT_AGENTS.md", subject: null, disposition: "absent" },
      { runId: "r0", owner: "correctness-model/tasks.json", subject: "$.limit", disposition: "absent" },
    ]);
  });

  it("records nothing where no earlier review completed, or this one did not", async () => {
    const root = measuredTree();
    recordEarlier(root, "r0", EARLIER);
    // No completed review of the battery the prior packet names.
    expect((await measured(root, "r9", async () => {})).earlierAdvisory).toBeUndefined();
    // A review that did not finish has weighed nothing it could leave absent.
    const failed = await measured(root, "r0", async () => {}, "provider stopped");
    expect(failed.status).toBe("failed");
    expect(failed.earlierAdvisory).toBeUndefined();
  });

  it("carries a completed review's advisory defects alone, once per file and subject", () => {
    const recorded = { runId: "r0", status: "completed", findings: [...EARLIER, ...EARLIER] };
    expect(advisoryDefects(recorded)).toEqual([
      { runId: "r0", owner: TOOLS, subject: "bounds" },
      { runId: "r0", owner: "agent/BUILT_AGENTS.md", subject: null },
      { runId: "r0", owner: "correctness-model/tasks.json", subject: "$.limit" },
    ]);
    // An unfinished review's findings never reached the Builder.
    expect(advisoryDefects({ ...recorded, status: "incomplete" })).toEqual([]);
    expect(carriedDemonstrations({ ...recorded, status: "incomplete" })?.advisory).toEqual([]);
    expect(carriedDemonstrations(recorded)?.advisory).toEqual(advisoryDefects(recorded));
  });

  it("reads a subject named only as an observation, and a subjectless defect's file named again, as neither standing nor absent", () => {
    const earlier = advisoryDefects({ runId: "r0", status: "completed", findings: EARLIER });
    const later: AnalysisFinding[] = [
      { owner: "correctness-model/tasks.json", defect: false, claim: "c", evidence: "e", checkId: "bounds" },
      { owner: "agent/BUILT_AGENTS.md", defect: true, severity: "advisory", claim: "c", evidence: "e" },
      {
        owner: "correctness-model/tasks.json",
        defect: true,
        severity: "advisory",
        claim: "c",
        evidence: "e",
        publicInputPath: "$.limit",
      },
    ];
    expect(advisoryRecord({ status: "completed", findings: later }, earlier).earlierAdvisory).toEqual([
      { runId: "r0", owner: TOOLS, subject: "bounds", disposition: "observation" },
      { runId: "r0", owner: "agent/BUILT_AGENTS.md", subject: null, disposition: "unmatched" },
      {
        runId: "r0",
        owner: "correctness-model/tasks.json",
        subject: "$.limit",
        disposition: "standing",
        severity: "advisory",
      },
    ]);
    expect(advisoryRecord({ status: "incomplete", findings: [] }, earlier)).toEqual({});
  });

  it("records on an authoring review what the round's previous review left advisory", async () => {
    const root = scratchDir(".ana-scratch-advisory-dispositions-", import.meta.dir);
    uppercaseFixture(root);
    const carried = required(
      carriedDemonstrations({ runId: "authoring-0", status: "completed", findings: EARLIER }),
      "the previous review's carry",
    );
    const result = await runEpochReview({
      repoRoot: root,
      slug: SLUG,
      runId: "authoring-1",
      treeRoot: ".",
      analysis: null,
      priorAdvice: null,
      demonstrations: carried,
      review,
      publicRequest: "Uppercase the public input.",
      readerTurn: async ({ tools }) => {
        const reader = required(
          tools.find((tool) => tool.name === "read_source"),
          "read_source",
        );
        for (const file of reviewInventory(root).files) await call(reader, { path: file });
        return { pin: null, text: "Read.", error: null };
      },
    });
    expect(result.status).toBe("completed");
    expect(result.earlierAdvisory?.map((row) => [row.runId, row.owner, row.disposition])).toEqual([
      ["authoring-0", TOOLS, "absent"],
      ["authoring-0", "agent/BUILT_AGENTS.md", "absent"],
      ["authoring-0", "correctness-model/tasks.json", "absent"],
    ]);
  });
});

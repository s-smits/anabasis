import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, dirname } from "../src/meta/path.ts";
import { runReaderTurn } from "../src/review/review-reader.ts";
import {
  type SourceReadState,
  deliveredSource,
  readSourceTool,
  reviewInventory,
  reviewVerifierEvidence,
  reviewCoverage,
} from "../src/review/review-sources.ts";
import { BUILDER_OWNED, ownerWritableFiles, routableOwner } from "../src/author/feedback-routing.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { verifierEnvironmentHashOfTools } from "../src/truth/verifier-environment.ts";
import { sha256 } from "../src/meta/digest.ts";
import { type EpochReviewInput, runEpochReview } from "../src/review/epoch-reviewer.ts";
import {
  EPOCH_REVIEW_SCHEMA,
  conditionAlreadyReviewed,
  measuredConditionOf,
} from "../src/review/epoch-review-findings.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { double } from "./helpers/doubles.ts";
import { reviewSlotPin } from "../src/review/review-session.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { REVIEW_IDENTITY, call } from "./helpers/review-fixtures.ts";
import { REBUILD_ADVICE_SCHEMA } from "../src/author/rebuild-advice.ts";
const EVALUATOR_TS = "evaluator.ts";
/** A battery that verified nothing, as the runner records one. */
const NO_FIRING = {
  firedByCheck: {},
  executedByCheck: {},
  blockingByCheck: {},
  applicableByCheck: {},
  verifierVerifiedCount: 0,
};

afterAll(cleanupScratch);

const reviewState = (): SourceReadState => ({ reads: [], readChars: 0, refused: 0, delivered: [] });
const complete = (state: SourceReadState, path: string) => deliveredSource(state, path).complete;
const quoted = (state: SourceReadState, path: string, quote: string) =>
  deliveredSource(state, path).record?.pages.some((page) => page.text.includes(quote)) ?? false;

function coreTree() {
  const root = scratchDir("ana-review-core-");
  for (const path of [...BUILDER_OWNED].filter(routableOwner).flatMap(ownerWritableFiles)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "{}");
  }
  return root;
}

function recordedTool(root: string, source = "#!/bin/sh\nexit 0\n", kind = "script") {
  const path = join(root, ".toolchain/bin/domain-check");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  const digest = sha256(source);
  const log = new EvidenceLog(join(root, "runs/r1"));
  const receipt = {
    outcome: "executed",
    toolId: "domain-check",
    command: path,
    toolDigest: digest,
    toolSource: "workspace-toolchain",
    toolKind: kind,
  };
  const tools = {
    "domain-check": {
      digest,
      source: "workspace-toolchain",
      kind,
      interpreter: kind === "script" ? "sh" : null,
    },
  };
  const execution = { executed: [], verifierEnvironmentHash: verifierEnvironmentHashOfTools(tools), tools };
  const battery = {
    runId: "r1",
    cases: [],
    execution,
    executionEvidence: [receipt],
    truthCheckFiring: NO_FIRING,
  };
  log.write("battery.json", battery);
  log.record();
  return { path, log, battery };
}

/** A closing synthesis longer than the 4,000 characters the report used to keep, so a cap
 *  reintroduced anywhere between the turn and the record cuts its end off and fails the case. */
const LONG_SYNTHESIS = `Final synthesis.${" The closing sentence must survive whole.".repeat(120)}`;

/** The review slot every case here starts from: pinned by the operator to one codex model. */
const REVIEW = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

describe("review coverage tied to recorded execution", () => {
  test("an early finish resumes the same session; no progress or a failed turn ends it", async () => {
    for (const mode of ["complete", "stalled", "failed"] as const) {
      const root = coreTree();
      writeFileSync(
        join(root, "correctness-model/tasks.json"),
        JSON.stringify([{ taskId: "case-1", publicInput: { count: 1 } }]),
      );
      writeFileSync(join(root, "correctness-model/controls.json"), "x".repeat(40_000));
      let opens = 0,
        turns = 0,
        disposals = 0;
      const result = await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        analysis: null,
        priorAdvice: null,
        publicRequest: "Choose a count.",
        review: REVIEW,
        readerTurn: (input) =>
          runReaderTurn({
            ...input,
            openSession: async () => {
              opens++;
              return {
                backend: "codex",
                abort() {},
                configure() {},
                sessionId: "pi-test",
                async dispose() {
                  disposals++;
                },
                async runTurn({ prompt }) {
                  turns++;
                  if (turns > 1) expect(prompt).toContain("Source remains unread");
                  if (mode === "failed" && turns > 1) {
                    return { status: "failed", errorMessages: ["provider stopped"] };
                  }
                  if (turns === 1) {
                    const recorder = input.tools.find((tool) => tool.name === "record_finding")!;
                    expect(
                      await call(recorder, {
                        kind: "curriculum-defect",
                        severity: "advisory",
                        claim: "Only one count is sampled.",
                        publicInputPath: "$.count",
                      }),
                    ).not.toContain("refused");
                    const source = input.tools.find((tool) => tool.name === "read_source")!;
                    await call(source, { path: "agent/tools.ts" });
                    const finding = {
                      kind: "harness-defect",
                      owner: "tools-spec",
                      severity: "blocking",
                      claim: "Private source-derived concern.",
                      demonstration: "Private specimen demonstrating the missing public obligation.",
                    };
                    expect(
                      await call(recorder, {
                        ...finding,
                        citations: [{ path: "agent/tools.ts", quote: "PRIVATE_UNREAD_QUOTE" }],
                      }),
                    ).toContain("refused");
                    expect(
                      await call(recorder, {
                        ...finding,
                        citations: [{ path: "agent/tools.ts", quote: "{}" }],
                      }),
                    ).toContain("as advisory");
                  }
                  const reader = input.tools.find((tool) => tool.name === "read_source")!;
                  if (mode === "complete") {
                    if (turns === 1) await call(reader, {});
                    else {
                      let page = "";
                      for (let i = 0; i < 50 && !page.startsWith("No unread source"); i++) {
                        page = await call(reader, {});
                      }
                      expect(page).toContain("No unread source");
                    }
                  }
                  return {
                    status: "completed",
                    finalText: turns === 1 ? "Premature finish" : LONG_SYNTHESIS,
                  };
                },
              };
            },
          }),
      });
      expect([opens, turns, disposals]).toEqual([1, 2, 1]);
      expect(result.status).toBe(
        mode === "complete" ? "completed" : mode === "stalled" ? "incomplete" : "failed",
      );
      expect(result.coverage.complete).toBe(mode === "complete");
      expect(result.report).toBe(mode === "failed" ? null : LONG_SYNTHESIS);
      expect(publicEpochReview(result).findings).toHaveLength(mode === "complete" ? 2 : 0);
      if (mode === "failed") expect(result.findings).toEqual([]);
      expect(result.admission).toEqual({
        continuations: 1,
        citationRefusals: 1,
        severityAdjusted: [{ owner: "tools-spec", requested: "blocking", admitted: "advisory" }],
      });
      expect(JSON.stringify(result.admission)).not.toMatch(
        /PRIVATE_UNREAD_QUOTE|Private source-derived|Private specimen/,
      );
    }
  });

  test("authoring uses the same reader without inventing a measured condition or bypassing missing coverage", async () => {
    const root = coreTree();
    writeFileSync(
      join(root, "correctness-model/tasks.json"),
      JSON.stringify([{ taskId: "private-task", publicInput: { count: 1 } }]),
    );
    for (const phase of ["authoring", "measured", "partial-draft"] as const) {
      if (phase === "partial-draft") writeFileSync(join(root, "correctness-model/tasks.json"), "{");
      const result = await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        priorAdvice: null,
        publicRequest: "Choose a count.",
        review: REVIEW,
        analysis:
          phase === "measured"
            ? double<NonNullable<EpochReviewInput["analysis"]>>({
                slug: "bounds",
                runId: "r1",
                treeRoot: ".",
                cases: [],
                identities: {
                  bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
                  backendPin: "built-pin",
                },
                battery: { summary: { passed: 0, verified: 0, unaccepted: 0, nonResults: 0 } },
              })
            : null,
        readerTurn: async ({ prompt, tools }) => {
          expect(prompt.includes("Authoring checkpoint before measurement")).toBe(phase !== "measured");
          const reader = tools.find((tool) => tool.name === "read_source")!;
          for (const path of reviewInventory(root).files) await call(reader, { path });
          return { pin: reviewSlotPin(REVIEW), text: "Source inspection only.", error: null };
        },
      });
      expect(result.status).toBe(phase === "authoring" ? "completed" : "incomplete");
      if (phase === "measured") {
        expect(result.verifier?.unavailable).toContain("unavailable");
      } else {
        expect(result.condition).toBeNull();
      }
      expect(publicEpochReview(result).findings).toEqual([]);
    }
  });

  test("an authoring checkpoint reads the previous battery's counts, and invents none without a packet", async () => {
    const root = coreTree();
    writeFileSync(
      join(root, "correctness-model/tasks.json"),
      JSON.stringify([{ taskId: "private-task", publicInput: { count: 1 } }]),
    );
    // Three consecutive reviews of campaign 3fd52f9e-10 inferred solver reach from the accept
    // control, which its author pinned to the published mass limit, and asked for looser limits on
    // the reading that "an all-fail battery is the likely outcome"; both batteries measured on
    // those limits passed 6 of 6. The counts ride the packet the caller already reads.
    const packet = double<NonNullable<EpochReviewInput["priorAdvice"]>>({
      schema: REBUILD_ADVICE_SCHEMA,
      slug: "bounds",
      runId: "r0",
      analysisDigest: "d",
      families: [
        { family: "canopy", verified: 2, passed: 2, unaccepted: 0, nonResults: 0 },
        { family: "mast", verified: 3, passed: 1, unaccepted: 1, nonResults: 2 },
      ],
      blockingByCheck: {},
      issues: [],
      judge: null,
      findings: [],
    });
    for (const priorAdvice of [packet, null]) {
      let seen = "";
      await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        analysis: null,
        priorAdvice,
        // Whose battery the counts are is the neighbouring question, settled by the ledger: this
        // tree was seeded from the version that battery measured.
        priorAdviceOnSeededTree: true,
        publicRequest: "Choose a count.",
        review: REVIEW,
        readerTurn: async ({ prompt, tools }) => {
          seen = prompt;
          const reader = tools.find((tool) => tool.name === "read_source")!;
          for (const path of reviewInventory(root).files) await call(reader, { path });
          return { pin: reviewSlotPin(REVIEW), text: "Source inspection only.", error: null };
        },
      });
      expect(seen).toContain("Authoring checkpoint before measurement");
      if (priorAdvice === null) {
        expect(seen).not.toContain("The previous battery of this product");
        expect(seen).not.toContain("is no sample of solver behaviour");
      } else {
        expect(seen).toContain(
          "The previous battery of this product (r0) measured 3 of 5 verified cases passed, 1 unaccepted at submission, 2 runtime non-results; per family (passed/verified): canopy 2/2, mast 1/3.",
        );
        expect(seen).toContain(
          "An accept control sits where its author put it and is no sample of solver behaviour.",
        );
      }
    }
  });

  test("a vetoed case reaches the reviewer with its citation, its check and a readable artifact", async () => {
    const root = coreTree();
    writeFileSync(
      join(root, "correctness-model/tasks.json"),
      JSON.stringify([{ taskId: "roof-3", publicInput: { span: 12 } }]),
    );
    mkdirSync(join(root, "runs/r1/cases/roof-3"), { recursive: true });
    writeFileSync(
      join(root, "runs/r1/cases/roof-3/artifact.json"),
      JSON.stringify({ members: [{ id: "m1", utilisation: 1.4 }] }),
    );
    mkdirSync(join(root, "runs/r1/cases/roof-4"), { recursive: true });
    writeFileSync(
      join(root, "runs/r1/cases/roof-4/artifact.json"),
      JSON.stringify({ members: [{ id: "m1", utilisation: 0.9 }] }),
    );
    let seen = "";
    const result = await runEpochReview({
      repoRoot: root,
      slug: "bounds",
      runId: "r1",
      treeRoot: ".",
      priorAdvice: null,
      publicRequest: "Design a roof.",
      review: REVIEW,
      analysis: double<NonNullable<EpochReviewInput["analysis"]>>({
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        cases: [],
        identities: {
          bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
          backendPin: "built-pin",
        },
        battery: { summary: { passed: 1, verified: 1, unaccepted: 0, nonResults: 0 } },
      }),
      vetoed: [
        {
          taskId: "roof-3",
          family: "roofs",
          judge: false,
          verifier: true,
          rules: ["every member stays under its capacity"],
          rationale: "m1 is at 1.4",
          confirmed: true,
          checkIds: ["member-capacity"],
          evidence: "runs/r1/cases/roof-3/judge.json",
          artifact: "runs/r1/cases/roof-3/artifact.json",
        },
        {
          taskId: "roof-5",
          family: "roofs",
          judge: false,
          verifier: true,
          rules: ["every member stays under its capacity"],
          rationale: "unread",
          confirmed: true,
          checkIds: ["member-capacity"],
          evidence: "runs/r1/cases/roof-5/judge.json",
          artifact: "runs/r1/cases/roof-5/artifact.json",
        },
      ],
      disputed: [
        {
          taskId: "roof-4",
          family: "roofs",
          judge: true,
          verifier: false,
          rules: [],
          rationale: "every member is under 1.0",
          confirmed: true,
          checkIds: ["member-capacity"],
          evidence: "runs/r1/cases/roof-4/judge.json",
          artifact: "runs/r1/cases/roof-4/artifact.json",
        },
      ],
      readerTurn: async ({ prompt, tools }) => {
        expect(prompt).toContain(
          'Vetoed: roof-3 (roofs) passed member-capacity; the Judge cited "every member stays under its capacity": m1 is at 1.4. Artifact: runs/r1/cases/roof-3/artifact.json.',
        );
        expect(prompt).toContain(
          "Disputed fail: roof-4 (roofs) failed member-capacity; the Judge passed it: every member is under 1.0. Artifact: runs/r1/cases/roof-4/artifact.json.",
        );
        const reader = tools.find((tool) => tool.name === "read_source")!;
        seen = await call(reader, { path: "runs/r1/cases/roof-3/artifact.json" });
        seen += await call(reader, { path: "runs/r1/cases/roof-4/artifact.json" });
        return { pin: reviewSlotPin(REVIEW), text: "Settled.", error: null };
      },
    });
    expect(seen).toContain('"utilisation":1.4');
    expect(seen).toContain('"utilisation":0.9');
    // The artifacts are required reads for settling the veto and the dispute, not covered source files.
    expect(result.reads).toContain("runs/r1/cases/roof-3/artifact.json");
    expect(result.reads).toContain("runs/r1/cases/roof-4/artifact.json");
    // roof-5 names the same check but was never opened, so it is not among the settled cases.
    expect(result.contestedReads).toEqual([
      "runs/r1/cases/roof-3/artifact.json",
      "runs/r1/cases/roof-4/artifact.json",
    ]);
  });

  test("a completed review stands in only for the same contested artifacts and standing issues", async () => {
    const root = coreTree();
    writeFileSync(
      join(root, "correctness-model/tasks.json"),
      JSON.stringify([{ taskId: "roof-3", publicInput: { span: 12 } }]),
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
    // Outside the recorded run directory, whose ownership check refuses foreign files.
    mkdirSync(join(root, "contested/roof-3"), { recursive: true });
    const artifact = "contested/roof-3/artifact.json";
    writeFileSync(join(root, artifact), JSON.stringify({ members: [{ id: "m1", utilisation: 1.4 }] }));
    const vetoed = [
      {
        taskId: "roof-3",
        family: "roofs",
        judge: false,
        verifier: true,
        rules: ["capacity"],
        rationale: "m1 is at 1.4",
        confirmed: true,
        checkIds: ["member-capacity"],
        evidence: "e",
        artifact,
      },
    ];
    const reviewDir = join(root, "campaigns/bounds/analysis");
    mkdirSync(reviewDir, { recursive: true });
    let turns = 0;
    const reviewOnce = async (index: number, contested: typeof vetoed) => {
      const result = await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        priorAdvice: null,
        publicRequest: "Design a roof.",
        review: REVIEW,
        vetoed: contested,
        analysis: double<EpochReviewInput["analysis"]>({
          slug: "bounds",
          runId: "r1",
          treeRoot: ".",
          cases: [],
          identities: {
            bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
            backendPin: "built-pin",
          },
          battery: { summary: { passed: 1, verified: 1, unaccepted: 0, nonResults: 0 } },
        }),
        readerTurn: async ({ tools }) => {
          turns += 1;
          const reader = tools.find((tool) => tool.name === "read_source")!;
          for (const file of reviewInventory(root).files) await call(reader, { path: file });
          return { pin: reviewSlotPin(REVIEW), text: "Read.", error: null };
        },
      });
      writeFileSync(join(reviewDir, `r${index}-epoch-review.json`), JSON.stringify(result));
      return result;
    };
    const first = await reviewOnce(0, []);
    expect([first.status, first.reason]).toEqual(["completed", null]);
    expect((await reviewOnce(1, [])).reason).toBe("condition-already-reviewed");
    expect(turns).toBe(1);
    // A new contested artifact under the same condition is new settlement work.
    expect((await reviewOnce(2, vetoed)).status).toBe("completed");
    expect((await reviewOnce(3, vetoed)).reason).toBe("condition-already-reviewed");
    writeFileSync(join(root, artifact), JSON.stringify({ members: [{ id: "m1", utilisation: 1.5 }] }));
    expect((await reviewOnce(4, vetoed)).status).toBe("completed");
    expect(turns).toBe(3);
  });

  test("lists required files before applying the inventory cap and marks truncated coverage incomplete", async () => {
    const root = coreTree();
    for (let i = 0; i < 400; i++) writeFileSync(join(root, "agent", `${i}.ts`), "x");
    const inventory = reviewInventory(root);
    expect(inventory.files).toContain("correctness-model/evaluator.ts");
    expect(inventory.files).toHaveLength(400);
    expect(inventory.truncated).toBe(true);
    expect(inventory.missing).toEqual([]);
    const state = reviewState();
    const reader = readSourceTool(root, new Set(inventory.files), state, {}, new Map());
    for (const path of inventory.files) await call(reader, { path });
    expect(
      reviewCoverage(inventory, { identity: "none", tools: {}, unavailable: null }, state).complete,
    ).toBe(false);
  });

  test("requires every source page and every required file for complete coverage", async () => {
    const root = coreTree();
    const path = "correctness-model/evaluator.ts";
    writeFileSync(join(root, path), "a".repeat(20_000));
    const inventory = reviewInventory(root),
      state = reviewState();
    const reader = readSourceTool(root, new Set(inventory.files), state, {}, new Map());
    const verifier = { identity: "none", tools: {}, unavailable: null };
    for (const file of inventory.files.filter((name) => name !== path)) await call(reader, { path: file });
    expect(await call(reader, { path, offset: 16_000 })).toContain(
      "only path and reread: true beside it are accepted",
    );
    expect(reviewCoverage(inventory, verifier, state).complete).toBe(false);
    await call(reader, { path });
    expect(reviewCoverage(inventory, verifier, state).complete).toBe(false);
    await call(reader, { path });
    expect(reviewCoverage(inventory, verifier, state).complete).toBe(true);
    unlinkSync(join(root, path));
    expect(reviewCoverage(reviewInventory(root), verifier, state).complete).toBe(false);
  });

  test("recorded verifier source is readable by alias, and altered bytes are refused", async () => {
    const root = coreTree(),
      { path } = recordedTool(root);
    const verifier = reviewVerifierEvidence(root, "r1");
    expect(verifier.unavailable).toBeNull();
    const aliases = Object.keys(verifier.tools),
      state = reviewState();
    expect(aliases).toHaveLength(1);
    const alias = aliases[0]!;
    const inventory = reviewInventory(root);
    const reader = readSourceTool(
      root,
      new Set([...inventory.files, ...aliases]),
      state,
      verifier.tools,
      new Map(),
    );
    expect(await call(reader, { path: alias })).toContain("#!/bin/sh\nexit 0");
    expect(await call(reader, { path })).toContain("not in the inventory");
    expect(await call(reader, { path: ".toolchain/bin/domain-check" })).toContain("not in the inventory");
    writeFileSync(path, "PRIVATE_REPLACEMENT");
    const refused = await call(reader, { path: alias });
    expect(refused).toContain("executable bytes changed");
    expect(refused).not.toContain("PRIVATE_REPLACEMENT");
    // The page delivered before the swap was the recorded bytes; the refusal erases nothing.
    expect(complete(state, alias)).toBe(true);
    expect(quoted(state, alias, "exit 0")).toBe(true);
  });

  test("binary provenance is explicit, and unbound or tampered receipts grant no reads", async () => {
    const root = coreTree(),
      { log, battery } = recordedTool(root, "BINARY_BYTES", "binary");
    const verifier = reviewVerifierEvidence(root, "r1");
    const alias = Object.keys(verifier.tools)[0]!;
    const text = await call(
      readSourceTool(root, new Set([alias]), reviewState(), verifier.tools, new Map()),
      {
        path: alias,
      },
    );
    expect(text).toContain("Binary entry point: source is unavailable");
    expect(text).not.toContain("BINARY_BYTES");
    log.write("battery.json", { ...battery, executionEvidence: [] });
    expect(reviewVerifierEvidence(root, "r1").identity).toBeNull();
    expect(reviewVerifierEvidence(root, "r1").tools).toEqual({});
    writeFileSync(join(root, "runs/r1/battery.json"), JSON.stringify(battery));
    expect(reviewVerifierEvidence(root, "r1").identity).toBeNull();
  });

  test("known empty execution has identity; missing or contradictory evidence does not", () => {
    const root = coreTree(),
      { log, battery } = recordedTool(root);
    const empty = {
      ...battery,
      execution: { executed: [], tools: {}, verifierEnvironmentHash: null },
      executionEvidence: [],
    };
    log.write("battery.json", empty);
    expect(reviewVerifierEvidence(root, "r1").identity).not.toBeNull();
    for (const changed of [
      { ...empty, executionEvidence: battery.executionEvidence },
      { ...empty, execution: undefined },
      { ...battery, execution: { ...battery.execution, verifierEnvironmentHash: "0".repeat(64) } },
    ]) {
      log.write("battery.json", JSON.parse(JSON.stringify(changed)));
      expect(reviewVerifierEvidence(root, "r1").identity).toBeNull();
    }
  });

  test("changing recorded tool bytes invalidates a completed review of the same harness", () => {
    const root = coreTree();
    recordedTool(root);
    const first = reviewVerifierEvidence(root, "r1");
    const condition = measuredConditionOf({
      agentHash: "a",
      correctnessModelHash: "c",
      taskSetHash: "t",
      builtPin: "pin",
      verifierIdentity: first.identity,
    });
    const reviews = join(root, "reviews");
    mkdirSync(reviews);
    writeFileSync(
      join(reviews, "r1-epoch-review.json"),
      JSON.stringify({
        ...REVIEW_IDENTITY,
        schema: EPOCH_REVIEW_SCHEMA,
        status: "completed",
        findings: [],
        coverage: { complete: true },
        condition,
      }),
    );
    expect(conditionAlreadyReviewed(reviews, condition, REVIEW_IDENTITY)).toBe(true);
    recordedTool(root, "#!/bin/sh\nexit 1\n");
    const next = reviewVerifierEvidence(root, "r1");
    expect(next.identity).not.toBe(first.identity);
    expect(
      conditionAlreadyReviewed(
        reviews,
        measuredConditionOf({ ...condition, verifierIdentity: next.identity }),
        REVIEW_IDENTITY,
      ),
    ).toBe(false);
  });

  test("rereading a condition under another reviewer does not manufacture recurrence", async () => {
    const root = coreTree();
    const path = "agent/tools.ts",
      quote = "return { count: 11 };";
    writeFileSync(join(root, path), quote);
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
    const reviewDir = join(root, "campaigns/bounds/analysis");
    mkdirSync(reviewDir, { recursive: true });
    for (const [index, taskSetHash, model, reasoningEffort] of [
      [0, "t1", "gpt-6-astra", "low"],
      [1, "t1", "gpt-6-astra", "low"],
      [2, "t1", "gpt-6-astra", "medium"],
      [3, "t1", "gpt-5.6-sol", "medium"],
      [4, "t2", "gpt-5.6-sol", "medium"],
    ] as const) {
      const review = { enabled: true, kind: "codex", model, reasoningEffort, source: "operator" } as const;
      const result = await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        priorAdvice: null,
        publicRequest: "Choose a count at most ten.",
        analysis: double<EpochReviewInput["analysis"]>({
          slug: "bounds",
          runId: "r1",
          treeRoot: ".",
          cases: [],
          identities: {
            bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash },
            backendPin: "built-pin",
          },
          battery: { summary: { passed: 0, verified: 0, unaccepted: 0, nonResults: 0 } },
        }),
        review,
        readerTurn: async ({ tools }) => {
          const reader = tools.find((tool) => tool.name === "read_source")!;
          for (const file of reviewInventory(root).files) await call(reader, { path: file });
          const finding = tools.find((tool) => tool.name === "record_finding")!;
          expect(
            await call(finding, {
              kind: "harness-defect",
              claim: "the writer exceeds the upper bound",
              owner: "tools-spec",
              severity: "advisory",
              checkId: "bounds",
              demonstration:
                "The request limits count to ten; this writer always returns eleven, so its output violates that limit. This is source-derived.",
              citations: [{ path, quote }],
            }),
          ).toBe(`recorded harness-defect as ${taskSetHash === "t2" ? "blocking" : "advisory"}`);
          return { pin: reviewSlotPin(review), text: "A source-derived boundary gap.", error: null };
        },
      });
      expect(result.status).toBe("completed");
      expect(result.coverage.complete).toBe(true);
      expect(result.findings[0]?.severity).toBe(taskSetHash === "t2" ? undefined : "advisory");
      // An older prompt/policy changed reuse identity while all persisted measured fields stayed fixed.
      if (index === 0 && result.condition !== null) {
        result.condition.digest = "earlier-review-prompt-and-policy";
      }
      writeFileSync(join(reviewDir, `r${index}-epoch-review.json`), JSON.stringify(result));
    }
  });

  test("the epoch review checks quotations and excludes incomplete or failed reviews from admission", async () => {
    const root = coreTree();
    const sourcePath = "correctness-model/evaluator.ts";
    const quote = "return artifact.count >= 0;";
    writeFileSync(join(root, sourcePath), quote);
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
    const analysis = double<EpochReviewInput["analysis"]>({
      slug: "bounds",
      runId: "r1",
      treeRoot: ".",
      cases: [],
      identities: {
        bundleSnapshot: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
        backendPin: "built-pin",
      },
      battery: { summary: { passed: 0, verified: 0, unaccepted: 0, nonResults: 0 } },
    });
    for (const mode of ["complete", "incomplete", "failed"] as const) {
      const result = await runEpochReview({
        repoRoot: root,
        slug: "bounds",
        runId: "r1",
        treeRoot: ".",
        analysis,
        priorAdvice: null,
        publicRequest: "Choose a count within the inclusive bounds.",
        review: REVIEW,
        readerTurn: async ({ tools }) => {
          const reader = tools.find((tool) => tool.name === "read_source")!;
          const finding = tools.find((tool) => tool.name === "record_finding")!;
          const args = {
            kind: "harness-defect",
            claim: "the upper bound is not enforced",
            owner: "correctness-model",
            severity: "blocking",
            checkId: "bounds",
            demonstration:
              "With upper bound 10, count 11 passes the sole lower-bound comparison; this is source-derived, not an executed result.",
            citations: [{ path: sourcePath, quote }],
          };
          expect(await call(finding, args)).toContain("actually returned");
          await call(reader, { path: sourcePath });
          expect(
            await call(finding, { ...args, citations: [{ path: sourcePath, quote: "return true;" }] }),
          ).toContain("actually returned");
          expect(await call(finding, args)).toBe("recorded harness-defect as blocking");
          if (mode !== "incomplete") {
            for (const path of reviewInventory(root).files) await call(reader, { path });
          }
          return {
            pin: "review-pin",
            text: "A source-derived boundary gap.",
            error: mode === "failed" ? "stream closed" : null,
          };
        },
      });
      expect(result.status).toBe(mode === "complete" ? "completed" : mode);
      expect(result.reviewerEffort).toBe("low");
      expect(result.findings).toHaveLength(mode === "failed" ? 0 : 1);
      expect(publicEpochReview(result).findings).toHaveLength(mode === "complete" ? 1 : 0);
      expect(JSON.stringify(publicEpochReview(result))).not.toContain(quote);
    }
  });
});

describe("what the reviewer may open", () => {
  test("automatic reading advances pages and files without offsets, and no refusal erases delivered source", async () => {
    // Sol i03 (2026-09-12) read a 33-page task file 231 times: selecting a completed file started
    // it again, and every refusal reset its cursor and citation evidence.
    const root = coreTree(),
      state = reviewState();
    const first = "correctness-model/tasks.json",
      second = "correctness-model/controls.json";
    writeFileSync(join(root, first), "x".repeat(20_000));
    const reader = readSourceTool(root, new Set([first, second]), state, {}, new Map());
    expect(await call(reader, {})).toContain(`${first} (offset 0)`);
    expect(await call(reader, {})).toContain(`${first} (offset 16000)`);
    expect(await call(reader, {})).toContain(`${second} (offset 0)`);
    expect(await call(reader, {})).toContain("No unread source");
    expect(state.reads).toEqual([first, first, second]);
    expect(await call(reader, { path: first, offset: -1 })).toContain(
      "only path and reread: true beside it are accepted",
    );
    expect(await call(reader, { reread: true })).toContain(
      "only path and reread: true beside it are accepted",
    );
    expect(await call(reader, { path: first, reread: false })).toContain(
      "only path and reread: true beside it are accepted",
    );
    expect(complete(state, first)).toBe(true);
    expect(await call(reader, {})).toContain("No unread source");
    expect(await call(reader, { path: first })).toBe(
      `${first} is already completely delivered (20000 characters). Pass reread: true beside the path to read it again from the start.`,
    );
    expect(await call(reader, { path: first, reread: true })).toStartWith("x".repeat(16_000));
    expect(await call(reader, { path: first })).toBe("x".repeat(4_000));
    expect(await call(reader, { path: first })).toContain("already completely delivered");
    expect(state.reads).toEqual([first, first, second, first, first]);
    expect(state.refused).toBe(3);
    // A spent budget refuses the next page and keeps what was delivered eligible for citation.
    state.readChars = 4_000_000;
    expect(await call(reader, { path: first, reread: true })).toContain("read budget is spent");
    expect(complete(state, first)).toBe(true);
    expect(complete(state, second)).toBe(true);
    expect(quoted(state, first, "x".repeat(4_000))).toBe(true);
    expect(quoted(state, first, "x".repeat(16_001))).toBe(false);
  });

  test("automatic reading walks past an entry that yields no bytes, instead of refusing every call", async () => {
    // One undeliverable entry used to block the whole automatic scan: it was the first incomplete
    // path every time, so each parameterless call refused on it and the reviewer read nothing at
    // all. A named path still gets its reason; only the scan walks on.
    const root = scratchDir("ana-read-skip-");
    const outside = scratchDir("ana-read-skip-out-");
    writeFileSync(join(outside, "secret.txt"), "private controller bytes");
    symlinkSync(join(outside, "secret.txt"), join(root, "broken.json"));
    writeFileSync(join(root, "real.json"), "the evidence the reviewer needs");
    const state = reviewState();
    const reader = readSourceTool(root, new Set(["broken.json", "real.json"]), state, {}, new Map());
    expect(await call(reader, {})).toContain("real.json (offset 0)");
    expect(state.reads).toEqual(["real.json"]);
    expect(state.refused).toBe(0);
    // With nothing left it can deliver, the scan says so once rather than pretending more remains.
    const exhausted = await call(reader, {});
    expect(exhausted).toContain("no unread entry could be delivered; 1 remain unreadable (broken.json)");
    expect(state.refused).toBe(1);
    // The unreadable entry is still missing coverage, and naming it still returns its reason.
    expect(await call(reader, { path: "broken.json" })).toContain("path escapes the measured tree");
    expect(complete(state, "broken.json")).toBe(false);
    expect(complete(state, "real.json")).toBe(true);
  });

  test("the scan reports a changed file rather than silently reading the next one", async () => {
    // Invalidated pages are not an undeliverable entry: the reviewer must learn its citations went
    // stale, and the next call reads that same file from the start.
    const root = scratchDir("ana-read-changed-");
    writeFileSync(join(root, "a.json"), "a".repeat(20_000));
    writeFileSync(join(root, "b.json"), "b");
    const state = reviewState();
    const reader = readSourceTool(root, new Set(["a.json", "b.json"]), state, {}, new Map());
    expect(await call(reader, {})).toContain("a.json (offset 0)");
    writeFileSync(join(root, "a.json"), "a".repeat(30_000));
    expect(await call(reader, {})).toContain("a.json changed since its pages were delivered");
    expect(state.reads).toEqual(["a.json"]);
    expect(await call(reader, {})).toContain("a.json (offset 0)");
  });

  test("the inventory carries the harness and skips installed and generated trees", () => {
    const root = scratchDir("ana-inventory-");
    mkdirSync(join(root, "agent"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(root, "runs", "r1"), { recursive: true });
    writeFileSync(join(root, "tasks.json"), "{}");
    writeFileSync(join(root, "agent", "solve.ts"), "export {};");
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports={};");
    writeFileSync(join(root, "runs", "r1", "case.json"), "{}");
    expect(reviewInventory(root).files.sort()).toEqual(["agent/solve.ts", "tasks.json"]);
  });

  test("skips a dangling symlink while keeping readable inventory entries", () => {
    const root = scratchDir("ana-inv-");
    writeFileSync(join(root, EVALUATOR_TS), "export const x = 1;");
    symlinkSync(join(root, "gone.ts"), join(root, "broken.ts"));
    expect(reviewInventory(root).files).toEqual([EVALUATOR_TS]);
  });

  test("the inventory excludes linked files and directories outside the measured tree", () => {
    const root = scratchDir("ana-inv-links-");
    const outside = scratchDir("ana-private-");
    writeFileSync(join(root, EVALUATOR_TS), "public evaluation");
    writeFileSync(join(outside, "secret.txt"), "private controller bytes");
    symlinkSync(join(outside, "secret.txt"), join(root, "linked.txt"));
    symlinkSync(outside, join(root, "linked-dir"));
    expect(reviewInventory(root).files).toEqual([EVALUATOR_TS]);
  });

  test("refuses a listed file replaced by an outside link without consuming the text budget", async () => {
    const root = scratchDir("ana-read-link-");
    const outside = scratchDir("ana-private-");
    writeFileSync(join(root, EVALUATOR_TS), "public evaluation");
    writeFileSync(join(outside, "secret.txt"), "private controller bytes");
    const inventory = new Set(reviewInventory(root).files);
    const state = reviewState();
    const tool = readSourceTool(root, inventory, state, {}, new Map());
    expect(await call(tool, { path: EVALUATOR_TS })).toBe("public evaluation");
    unlinkSync(join(root, EVALUATOR_TS));
    symlinkSync(join(outside, "secret.txt"), join(root, EVALUATOR_TS));
    expect(await call(tool, { path: EVALUATOR_TS })).toContain("refused:");
    expect(state.readChars).toBe("public evaluation".length);
    expect(state.reads).toEqual([EVALUATOR_TS]);
    expect(state.refused).toBe(1);
  });

  test("pages preserve Unicode, and changed bytes keep their delivered pages as history that certifies nothing", async () => {
    const root = scratchDir("ana-read-surrogate-");
    const source = `${"a".repeat(15_999)}\u{1F600}b`;
    writeFileSync(join(root, EVALUATOR_TS), source);
    const state = reviewState();
    const tool = readSourceTool(root, new Set([EVALUATOR_TS]), state, {}, new Map());
    const first = await call(tool, { path: EVALUATOR_TS });
    expect(first.startsWith("a".repeat(15_999))).toBe(true);
    expect(first).toContain("call again to continue.");
    writeFileSync(join(root, EVALUATOR_TS), "shorter");
    expect(await call(tool, { path: EVALUATOR_TS })).toContain(
      "refused: evaluator.ts changed since its pages were delivered",
    );
    // The page delivered for the old bytes no longer admits a quote or counts as coverage.
    expect(quoted(state, EVALUATOR_TS, "aaa")).toBe(false);
    expect(complete(state, EVALUATOR_TS)).toBe(false);
    expect(state.reads).toEqual([EVALUATOR_TS]);
    expect(state.refused).toBe(1);
    // No page was delivered for "shorter", so changing the file again reads it from the start without a second refusal.
    writeFileSync(join(root, EVALUATOR_TS), source);
    expect(await call(tool, { path: EVALUATOR_TS })).toBe(first);
    expect(complete(state, EVALUATOR_TS)).toBe(false);
    expect(await call(tool, { path: EVALUATOR_TS })).toBe("\u{1F600}b");
    expect(complete(state, EVALUATOR_TS)).toBe(true);
    expect(quoted(state, EVALUATOR_TS, "\u{1F600}b")).toBe(true);
    expect(state.readChars).toBe(15_999 + source.length);
  });

  test("a file outside the inventory is refused, and a long one continues without offsets", async () => {
    const root = scratchDir("ana-read-source-");
    const source = Array.from({ length: 7_000 }, (_, index) => `line ${index}: evaluation\n`).join("");
    writeFileSync(join(root, EVALUATOR_TS), source);
    writeFileSync(join(root, "secret.txt"), "not offered");
    const state = reviewState();
    const tool = readSourceTool(root, new Set([EVALUATOR_TS]), state, {}, new Map());
    expect(await call(tool, { path: "secret.txt" })).toContain("not in the inventory");
    let reconstructed = "";
    while (reconstructed.length < source.length) {
      const page = await call(tool, { path: EVALUATOR_TS });
      const continuation = /\n\n\((\d+) characters remain; call again to continue\.\)$/.exec(page);
      const content = continuation === null ? page : page.slice(0, continuation.index);
      expect(state.delivered.at(-1)?.pages.at(-1)?.text).toBe(content);
      expect(content.length).toBeGreaterThan(0);
      expect(content.length).toBeLessThanOrEqual(16_000);
      reconstructed += content;
      if (continuation !== null) expect(Number(continuation[1])).toBe(source.length - reconstructed.length);
    }
    expect(reconstructed).toBe(source);
    // One character short of complete: the count, its noun and its verb all agree.
    const edge = readSourceTool(root, new Set(["edge.ts"]), reviewState(), {}, new Map());
    writeFileSync(join(root, "edge.ts"), "e".repeat(16_001));
    expect(await call(edge, { path: "edge.ts" })).toEndWith("(1 character remains; call again to continue.)");
    expect(state.readChars).toBe(source.length);
    expect(state.reads).toEqual(Array(Math.ceil(source.length / 16_000)).fill(EVALUATOR_TS));
  });
});

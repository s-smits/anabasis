/**
 * A condition is reviewed once, and a finding's severity comes from its own evidence.
 *
 * Review spend is bounded by the measured-condition digest, so the question is what counts as
 * a new condition and what is the same one seen twice. Severity reads nothing from earlier
 * reviews and nothing from the owner's directory: a demonstrated, cited defect keeps the reviewer's
 * severity wherever it sits, and a cited probe neither lifts nor lowers it.
 */
import { EVALUATOR_FILE } from "../src/meta/bundle-layout.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { CITATIONS, DEMO, REVIEW_IDENTITY, call, reviewState } from "./helpers/review-fixtures.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import {
  EPOCH_REVIEW_SCHEMA,
  conditionAlreadyReviewed,
  measuredConditionOf,
  recordFindingTool,
} from "../src/review/epoch-review-findings.ts";
import type { MeasuredCondition } from "../src/review/epoch-review-findings.ts";

type ReviewerIdentity = Parameters<typeof conditionAlreadyReviewed>[2];

/** What the finding tool answers when it records a defect at each admitted severity. */
const ADVISORY = "recorded defect as advisory";
const BLOCKING = "recorded defect as blocking";

afterAll(cleanupScratch);

describe("a condition is reviewed once", () => {
  const condition = (taskSetHash: string | null): MeasuredCondition =>
    measuredConditionOf({
      agentHash: "a",
      correctnessModelHash: "c",
      taskSetHash,
      builtPin: "claude/claude-opus-5",
      builtEffort: "medium",
      verifierIdentity: "verifier-a",
    });

  const dir = () => {
    const root = scratchDir("ana-epoch-review-");
    mkdirSync(root, { recursive: true });
    return root;
  };

  const write = (root: string, runId: string, body: Record<string, JsonValue>) =>
    writeFileSync(
      join(root, `${runId}-epoch-review.json`),
      JSON.stringify({
        ...REVIEW_IDENTITY,
        schema: EPOCH_REVIEW_SCHEMA,
        findings: [],
        coverage: { complete: true },
        ...body,
      }),
    );

  test("a completed review of the same condition, by the same reviewer, is not bought twice", () => {
    const root = dir();
    write(root, "r1", { status: "completed", condition: condition("t1") });
    expect(conditionAlreadyReviewed(root, condition("t1"), REVIEW_IDENTITY)).toBe(true);
  });

  const unknownVerifier = measuredConditionOf({ ...condition("t1"), verifierIdentity: null });
  test.each<[string, Record<string, JsonValue>, MeasuredCondition, ReviewerIdentity]>([
    [
      "another reviewer pin",
      {},
      condition("t1"),
      { ...REVIEW_IDENTITY, reviewerPin: "another-model/effort" },
    ],
    ["an unknown reviewer pin", {}, condition("t1"), { ...REVIEW_IDENTITY, reviewerPin: null }],
    ["another reviewer effort", {}, condition("t1"), { ...REVIEW_IDENTITY, reviewerEffort: "medium" }],
    ["an unknown reviewer effort", {}, condition("t1"), { ...REVIEW_IDENTITY, reviewerEffort: null }],
    ["another request", {}, condition("t1"), { ...REVIEW_IDENTITY, requestDigest: "another-request" }],
    // New contested artifacts or standing issues under the same condition are new settlement work.
    ["another obligation set", {}, condition("t1"), { ...REVIEW_IDENTITY, obligationsDigest: "another" }],
    ["a new task set", {}, condition("t2"), REVIEW_IDENTITY],
    [
      "a changed verifier",
      {},
      measuredConditionOf({ ...condition("t1"), verifierIdentity: "verifier-b" }),
      REVIEW_IDENTITY,
    ],
    ["an unknown verifier", {}, unknownVerifier, REVIEW_IDENTITY],
    // The pin names no effort, so a battery solved at another effort under one pin is another condition.
    [
      "another Built effort",
      {},
      measuredConditionOf({ ...condition("t1"), builtEffort: "high" }),
      REVIEW_IDENTITY,
    ],
    [
      "an unrecorded Built effort",
      {},
      measuredConditionOf({ ...condition("t1"), builtEffort: null }),
      REVIEW_IDENTITY,
    ],
    ["a review under the previous schema", { schema: "epoch-review/v3" }, condition("t1"), REVIEW_IDENTITY],
    ["a failed review", { status: "failed" }, condition("t1"), REVIEW_IDENTITY],
    [
      "an incomplete review",
      { status: "incomplete", coverage: { complete: false } },
      condition("t1"),
      REVIEW_IDENTITY,
    ],
    ["a review with no recorded condition", { condition: null }, condition("t1"), REVIEW_IDENTITY],
    ["a review with no recorded effort", { reviewerEffort: null }, condition("t1"), REVIEW_IDENTITY],
  ])("a completed review is not reused for %s", (_label, body, asked, identity) => {
    const root = dir();
    write(root, "r1", { status: "completed", condition: condition("t1"), ...body });
    expect(conditionAlreadyReviewed(root, asked, identity)).toBe(false);
  });

  test("no analysis directory yet is not coverage", () => {
    expect(conditionAlreadyReviewed(join(dir(), "absent"), condition("t1"), REVIEW_IDENTITY)).toBe(false);
  });

  test("a review under another prompt or policy is not reused for the same measured condition", () => {
    const root = dir();
    const current = condition("t1");
    write(root, "old-prompt", {
      status: "completed",
      condition: { ...current, digest: "earlier-prompt-and-policy" },
    });
    expect(conditionAlreadyReviewed(root, current, REVIEW_IDENTITY)).toBe(false);
  });

  test("every owner is held to one demonstration rule, and an unrelated probe moves no severity", async () => {
    // A demonstrated, cited defect keeps the severity the reviewer chose, whichever side owns it.
    // The agent side once also needed a cited probe, and any conclusive probe satisfied that, so a
    // probe of an evaluator check that had nothing to do with the agent's tool decided whether a
    // source reading of that tool reopened the product.
    const identities = { schemaRoots: ["layout"], checkIds: ["shortcut-check", "budget-check"] };
    const named = {
      defect: true,
      owner: "agent/tools-spec.json",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the tool supplies the remaining decision",
      checkId: "shortcut-check",
    };
    const reviewed = (severity: string, extra: Record<string, JsonValue>) => {
      const state = reviewState();
      // A conclusive probe of an evaluator check the finding does not name.
      state.probes.rows.push({
        id: 1,
        controlId: "accept-a",
        taskId: "t0",
        path: "layout.budget",
        change: { value: "0" },
        refused: null,
        baseline: { outcome: "pass", blockingCheckIds: [] },
        mutated: { outcome: "fail", blockingCheckIds: ["budget-check"] },
        applicableCheckIds: ["budget-check"],
        movedCheckIds: ["budget-check"],
      });
      return call(recordFindingTool([], [], "e", state, { identities }), { ...named, severity, ...extra });
    };
    expect(await reviewed("blocking", { probeIds: [1] })).toBe(BLOCKING);
    expect(await reviewed("blocking", {})).toBe(BLOCKING);
    expect(await reviewed("advisory", { probeIds: [1] })).toBe(ADVISORY);
    expect(await reviewed("advisory", {})).toBe(ADVISORY);
    // The identical finding on an evaluation owner is held to the same rule.
    expect(await reviewed("blocking", { owner: EVALUATOR_FILE, checkId: "budget-check", probeIds: [] })).toBe(
      BLOCKING,
    );
    // Without a demonstration nothing blocks, on either side.
    const bare = reviewState();
    expect(
      await call(recordFindingTool([], [], "e", bare, { identities }), {
        ...named,
        severity: "blocking",
        demonstration: "too short",
      }),
    ).toContain("refused: blocking or disputing requires a concrete case");
  });

  test("what a probe executed reaches the author, whatever severity the finding is held at", async () => {
    // The review has run the candidate's own checks over its own changed field, and a bare check id
    // tells the author none of that. A probe that watched a check refuse a changed artifact over a
    // rule no published decision states is exactly what the author needs, so it crosses whether the
    // finding is held at advice or not.
    const identities = { schemaRoots: ["layout"], checkIds: ["shortcut-check"] };
    const named = {
      defect: true,
      owner: "agent/tools-spec.json",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the tool supplies the remaining decision",
      checkId: "shortcut-check",
    };
    const probed = () => {
      const state = reviewState();
      state.probes.rows.push({
        id: 1,
        controlId: "accept-a",
        taskId: "t0",
        path: "layout.span",
        change: { value: '"widened"' },
        refused: null,
        baseline: { outcome: "pass", blockingCheckIds: [] },
        mutated: { outcome: "fail", blockingCheckIds: ["shortcut-check"] },
        applicableCheckIds: ["shortcut-check"],
        movedCheckIds: ["shortcut-check"],
      });
      return { state, tool: recordFindingTool([], [], "e", state, { identities }) };
    };

    const first = probed();
    await call(first.tool, { ...named, probeIds: [1] });
    expect(first.state.findings[0]?.severity).toBeUndefined();
    expect(first.state.findings[0]?.probes).toEqual([
      { controlId: "accept-a", path: "layout.span", movedCheckIds: ["shortcut-check"] },
    ]);
    const line =
      "Executed against this candidate's own declared checks: changing layout.span on accept control accept-a moved shortcut-check.";
    expect(publicEpochReview({ status: "completed", ...first.state }).findings[0]?.claim ?? "").toContain(
      line,
    );

    // Held at advice by the reviewer's own choice: the same line still crosses.
    const worn = probed();
    expect(await call(worn.tool, { ...named, severity: "advisory", probeIds: [1] })).toBe(ADVISORY);
    const advised = publicEpochReview({ status: "completed", ...worn.state });
    expect(advised.findings[0]?.claim ?? "").toContain(line);

    // The replacement value is a counterexample the reviewer generated and `blockingCheckIds` is
    // verifier detail. Neither crosses; the control, the path and the moved checks are the class
    // the finding's own `checkId` already crosses by.
    for (const projection of [publicEpochReview({ status: "completed", ...first.state }), advised]) {
      expect(projection.findings[0]?.claim ?? "").not.toContain("widened");
    }

    // A source-only reading says so with `probeIds: []` and carries no such line.
    const source = reviewState();
    await call(recordFindingTool([], [], "e", source, { identities }), {
      ...named,
      probeIds: [],
    });
    expect(source.findings[0]?.probes).toBeUndefined();
    expect(publicEpochReview({ status: "completed", ...source }).findings[0]?.claim ?? "").not.toContain(
      "Executed against",
    );
  });

  test("only a probe that decided both sides is recorded as the finding's executed evidence", async () => {
    // A probe row is the candidate's own declared checks ruling on the candidate's own accept
    // control, and it is evidence only where both sides reached a verdict and the original passed.
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the check refuses what the rule admits",
      checkId: "shortcut-check",
    };
    const identities = { schemaRoots: ["layout"], checkIds: ["shortcut-check"] };
    const side = (outcome: "pass" | "fail" | "non-result", blockingCheckIds: string[] = []) => ({
      outcome,
      blockingCheckIds,
    });
    const ran = (id: number, refused: string | null) => ({
      id,
      controlId: "accept-a",
      taskId: "t0",
      path: "layout.span",
      change: { value: "1" },
      baseline: side("pass"),
      mutated: side("fail", ["shortcut-check"]),
      applicableCheckIds: ["shortcut-check"],
      movedCheckIds: ["shortcut-check"],
      refused,
    });
    const recorded = async (row: ReturnType<typeof ran>) => {
      const state = reviewState();
      state.probes.rows.push(row);
      expect(
        await call(recordFindingTool([], [], "e", state, { identities }), { ...named, probeIds: [1] }),
      ).toBe(BLOCKING);
      return state.findings[0];
    };
    const backed = await recorded(ran(1, null));
    expect(backed?.claim).toContain("Executed probes: 1");
    expect(backed?.probes).toHaveLength(1);
    // Citing a probe the host refused credits the request, not a result. A pair that returned
    // without deciding is not a result either: `runControls` does not throw when a check times out,
    // and the receipt comes back `non-result` with no blocking checks, which reads exactly like "no
    // check moved". Nor is a changed artifact informative against an original the checks refuse.
    for (const row of [
      ran(1, "the checks did not settle"),
      { ...ran(1, null), mutated: side("non-result"), movedCheckIds: [] },
      { ...ran(1, null), baseline: side("fail", ["shortcut-check"]) },
    ]) {
      const finding = await recorded(row);
      expect(finding?.claim).not.toContain("Executed probes");
      expect(finding?.probes).toBeUndefined();
    }
  });

  test("a probe-backed evaluator defect keeps the blocking severity the reviewer chose", async () => {
    // The shape of a firmware round whose `wiring-behavior` check refused valid answers: the review
    // demonstrated it with probes and asked for blocking, and the Builder must not read the
    // strongest finding of the run as optional.
    const identities = { schemaRoots: ["files"], checkIds: ["wiring-behavior"] };
    const finding = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "wiring-behavior refuses the platform-default pins the published rule admits",
      checkId: "wiring-behavior",
    };
    const reviewed = (severity: string, probeIds: number[]) => {
      const state = reviewState();
      state.probes.rows.push({
        id: 1,
        controlId: "accept-portable",
        taskId: "t3",
        path: "files[0].text",
        change: { find: "Wire.begin(21, 22);", replace: "Wire.begin();" },
        refused: null,
        baseline: { outcome: "pass", blockingCheckIds: [] },
        mutated: { outcome: "fail", blockingCheckIds: ["wiring-behavior"] },
        applicableCheckIds: ["wiring-behavior"],
        movedCheckIds: ["wiring-behavior"],
      });
      return call(recordFindingTool([], [], "e", state, { identities }), {
        ...finding,
        severity,
        probeIds,
      });
    };
    expect(await reviewed("blocking", [1])).toBe(BLOCKING);
    // The reviewer's own choice still stands, and an evaluator reading from source keeps it too.
    expect(await reviewed("advisory", [1])).toBe(ADVISORY);
    expect(await reviewed("blocking", [])).toBe(BLOCKING);
  });

  test("an evaluation defect recorded after a probe ran must say whether it rests on it", async () => {
    // A review can run all eight probes, write a defect whose own claim narrates what they
    // returned, and still leave `probeIds` unset. Its recorded claim then carries no link to the
    // rows that support it, and the author is told nothing was executed. Asking costs one argument.
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "advisory",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the tool supplies the remaining decision",
      checkId: "shortcut-check",
    };
    const identities = { schemaRoots: ["layout"], checkIds: ["shortcut-check"] };
    const side = (outcome: "pass" | "fail" | "non-result", blockingCheckIds: string[] = []) => ({
      outcome,
      blockingCheckIds,
    });
    const ran = (id: number, refused: string | null = null) => ({
      id,
      controlId: "accept-a",
      taskId: "t0",
      path: "layout.span",
      change: { value: "1" },
      baseline: side("pass"),
      mutated: side("fail", ["shortcut-check"]),
      applicableCheckIds: ["shortcut-check"],
      movedCheckIds: ["shortcut-check"],
      refused,
    });

    const silent = reviewState();
    silent.probes.rows.push(ran(1), ran(2));
    const asked = await call(recordFindingTool([], [], "e", silent, { identities }), named);
    expect(asked).toContain("this review executed probes 1, 2");
    expect(asked).toContain("probeIds: [] when you read this from source alone");
    expect(silent.findings).toHaveLength(0);

    // `probeIds: []` is the answer for a reading taken from source alone, and it records.
    expect(
      await call(recordFindingTool([], [], "e", silent, { identities }), {
        ...named,
        probeIds: [],
      }),
    ).toBe(ADVISORY);
    expect(silent.findings[0]?.claim).not.toContain("Executed probes");

    // A probe that decided nothing is not evidence, so there is nothing to ask about.
    const inconclusive = reviewState();
    inconclusive.probes.rows.push({ ...ran(1), baseline: side("fail", ["shortcut-check"]) });
    expect(await call(recordFindingTool([], [], "e", inconclusive, { identities }), named)).toBe(ADVISORY);

    // A probe runs the declared checks, so it says nothing about an agent file, and a defect owned
    // there is not asked about the probes the review ran.
    const agent = reviewState();
    agent.probes.rows.push(ran(1));
    expect(
      await call(recordFindingTool([], [], "e", agent, { identities }), {
        ...named,
        owner: "agent/tools-spec.json",
      }),
    ).toBe(ADVISORY);

    // Nor is an observation, which asks for no repair.
    const observed = reviewState();
    observed.probes.rows.push(ran(1));
    expect(
      await call(recordFindingTool([], [], "e", observed, { identities }), {
        defect: false,
        claim: "the mass limits leave no headroom",
        severity: "advisory",
      }),
    ).toBe("recorded observation as advisory");
  });

  test("two supported findings keep their severity in either order", async () => {
    // Severity is one finding's evidence, so a review that records the same two findings in the
    // other order admits them the same way; how many owners a round reopens is decided after.
    const identities = { schemaRoots: ["layout"], checkIds: ["bounds", "budget"] };
    const finding = (checkId: string) => ({
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: `${checkId} refuses a valid answer`,
      checkId,
    });
    const admitted = async (order: string[]) => {
      const state = reviewState();
      const tool = recordFindingTool([], [], "e", state, { identities });
      for (const checkId of order) await call(tool, finding(checkId));
      return Object.fromEntries(state.findings.map((row) => [row.checkId, row.severity ?? "blocking"]));
    };
    expect(await admitted(["bounds", "budget"])).toEqual({ bounds: "blocking", budget: "blocking" });
    expect(await admitted(["budget", "bounds"])).toEqual(await admitted(["bounds", "budget"]));
  });

  test("an absent task set hash still separates conditions", () => {
    expect(condition(null).digest).not.toBe(condition("t1").digest);
  });
});

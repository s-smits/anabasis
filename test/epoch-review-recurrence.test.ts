/**
 * A condition is reviewed once, and a defect earns its severity by recurring.
 *
 * Review spend is bounded by the measured-condition digest, so the question is what counts as
 * a new condition and what is the same one seen twice. On top of that sits the severity rule:
 * an agent-side defect advises on its first reading and blocks on its second, and a probe that
 * actually executed may block on the first.
 */
import { EVALUATOR_FILE } from "../src/meta/bundle-layout.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { CITATIONS, DEMO, REVIEW_IDENTITY, call, reviewState } from "./helpers/review-fixtures.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { ownerSide } from "../src/author/feedback-routing.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import {
  EPOCH_REVIEW_SCHEMA,
  conditionAlreadyReviewed,
  measuredConditionOf,
  recordFindingTool,
  recurringDefects,
} from "../src/review/epoch-review-findings.ts";
import type { MeasuredCondition } from "../src/review/epoch-review-findings.ts";

type ReviewerIdentity = Parameters<typeof conditionAlreadyReviewed>[2];

afterAll(cleanupScratch);

describe("a condition is reviewed once", () => {
  const condition = (taskSetHash: string | null): MeasuredCondition =>
    measuredConditionOf({
      agentHash: "a",
      correctnessModelHash: "c",
      taskSetHash,
      builtPin: "claude/claude-opus-5/medium",
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
    ["a review under the previous schema", { schema: "epoch-review/v3" }, condition("t1"), REVIEW_IDENTITY],
    ["a failed review", { status: "failed" }, condition("t1"), REVIEW_IDENTITY],
    [
      "an incomplete review",
      { status: "incomplete", coverage: { complete: false } },
      condition("t1"),
      REVIEW_IDENTITY,
    ],
    [
      "coverage without a completeness verdict",
      { coverage: { files: 400, opened: 400, chars: 800 } },
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

  test("recurrence counts distinct measured conditions, not duplicate findings or replay files", () => {
    const root = dir();
    const finding = {
      defect: true,
      owner: EVALUATOR_FILE,
      checkId: "bounds",
      claim: "private",
      evidence: "e",
    };
    write(root, "r1", { status: "completed", condition: condition("t1"), findings: [finding, finding] });
    write(root, "r1-replay", { status: "completed", condition: condition("t1"), findings: [finding] });
    write(root, "r2-partial", {
      status: "completed",
      condition: condition("t2"),
      coverage: { complete: false },
      findings: [finding],
    });
    expect(recurringDefects(root, condition("t1")).size).toBe(0);
    expect(recurringDefects(root, condition("next")).get("bounds")).toBe(1);
    write(root, "r2", { status: "completed", condition: condition("t2"), findings: [finding] });
    expect(recurringDefects(root, condition("next")).get("bounds")).toBe(2);
  });

  test("review procedure changes do not count as new measured conditions, and incomplete identities are excluded", () => {
    const root = dir();
    const finding = {
      defect: true,
      owner: EVALUATOR_FILE,
      checkId: "bounds",
      claim: "private",
      evidence: "e",
    };
    const current = condition("t1");
    write(root, "old-prompt", {
      status: "completed",
      condition: { ...current, digest: "earlier-prompt-and-policy" },
      findings: [finding],
    });
    expect(conditionAlreadyReviewed(root, current, REVIEW_IDENTITY)).toBe(false);
    expect(recurringDefects(root, current).size).toBe(0);
    write(root, "another-prompt", {
      status: "completed",
      condition: { ...current, digest: "another-review-procedure" },
      findings: [finding],
    });
    write(root, "missing-condition", { status: "completed", condition: null, findings: [finding] });
    for (const field of [
      "agentHash",
      "correctnessModelHash",
      "taskSetHash",
      "builtPin",
      "verifierIdentity",
    ]) {
      write(root, `missing-${field}`, {
        status: "completed",
        condition: { ...condition(`unknown-${field}`), [field]: null },
        findings: [finding],
      });
    }
    expect(recurringDefects(root, condition("next")).get("bounds")).toBe(1);
    expect(recurringDefects(root, condition(null)).size).toBe(0);
  });

  test("recurrence never promotes an advisory suspicion without its own demonstrated, cited case", async () => {
    const state = reviewState();
    const tool = recordFindingTool([], [], "e", state, {
      identities: { schemaRoots: [], checkIds: ["bounds"] },
      recurring: new Map([["bounds", 1]]),
    });
    const args = {
      defect: true,
      owner: EVALUATOR_FILE,
      checkId: "bounds",
      severity: "advisory",
      claim: "a possible boundary gap",
    };
    await call(tool, args);
    await call(tool, { ...args, demonstration: DEMO });
    expect(await call(tool, { ...args, demonstration: DEMO, citations: CITATIONS })).toContain("as blocking");
    expect(state.findings.map((row) => row.severity)).toEqual(["advisory", "advisory", undefined]);
  });

  test("a defect whose check an earlier review named is admitted as blocking", async () => {
    const root = dir();
    const prior = {
      defect: true,
      claim: "private prose",
      evidence: "e",
      owner: "correctness-model/brief.json",
      severity: "advisory",
      checkId: "sections-minimal-mass",
      artifactSchemaPath: "layout.members",
    };
    write(root, "r1", { status: "completed", condition: condition("t1"), findings: [prior] });
    write(root, "r2", {
      status: "failed",
      condition: condition("t2"),
      findings: [{ ...prior, checkId: "unfinished-review" }],
    });
    const recurring = recurringDefects(root, condition("next"));
    expect([...recurring.keys()]).toEqual(["sections-minimal-mass"]);
    const state = reviewState();
    const tool = recordFindingTool([], [], "e", state, {
      identities: { schemaRoots: ["layout"], checkIds: ["sections-minimal-mass", "other-check"] },
      recurring,
    });
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "advisory",
      citations: CITATIONS,
      demonstration: DEMO,
      artifactSchemaPath: "layout.members",
    };
    await call(tool, { ...named, claim: "a different check on the same path", checkId: "other-check" });
    await call(tool, { ...named, claim: "the same gap again", checkId: "sections-minimal-mass" });
    expect(state.findings[0]?.severity).toBe("advisory");
    expect(state.findings[1]?.severity).toBeUndefined();
    expect(recurringDefects(join(root, "absent"), condition("next")).size).toBe(0);
  });

  test("a bare schema root is not a defect identity, and a path inside the artifact is", async () => {
    // A domain whose artifactSchema has one root gives every finding that names no check the same
    // one word. A floating-point rule, a header contract and a new pin binding then share an
    // identity, and the pin finding arrives carrying recurrences it has nothing to do with. A path
    // below a root still identifies a place, so that is what counts as an identity.
    const root = dir();
    const unnamed = (artifactSchemaPath: string, claim: string) => ({
      defect: true,
      claim,
      evidence: "e",
      owner: EVALUATOR_FILE,
      severity: "advisory",
      artifactSchemaPath,
    });
    write(root, "r1", {
      status: "completed",
      condition: condition("t1"),
      findings: [
        unnamed("files", "no check reads the floating-point rule"),
        unnamed("design.members", "no check reads the member table"),
      ],
    });
    write(root, "r2", {
      status: "completed",
      condition: condition("t2"),
      findings: [
        unnamed("files", "no check reads the header contract"),
        unnamed("design.members", "the member table is still unread"),
      ],
    });
    const recurring = recurringDefects(root, condition("next"));
    expect([...recurring.keys()]).toEqual(["design.members"]);

    // So a third finding on the one root is read as what it is, a first one, and the severity its
    // own demonstration earned stands.
    const identities = { schemaRoots: ["files", "design"], checkIds: [] };
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the two I2C pin roles are bound by no declared check",
    };
    const onRoot = reviewState();
    await call(recordFindingTool([], [], "e", onRoot, { identities, recurring }), {
      ...named,
      artifactSchemaPath: "files",
    });
    expect(onRoot.findings[0]?.severity).toBeUndefined();

    // The ceiling itself is untouched: where the identity really did recur, it still holds the
    // third naming at advice.
    const onPath = reviewState();
    expect(
      await call(recordFindingTool([], [], "e", onPath, { identities, recurring }), {
        ...named,
        artifactSchemaPath: "design.members",
      }),
    ).toBe("recorded defect as advisory");
  });

  test("an agent-side defect advises on its first reading and blocks on its second", async () => {
    // Without the floor, a first blocking tools-spec finding can send a harness that passed its
    // whole battery back to the starter seed. It is the owner's tier that decides who gets the
    // floor, so the two tiers are pinned first — every reading below turns on them.
    //
    // Read the severity assertions with the writer in mind: `recordFinding` only writes a
    // `severity` field when it demotes, so `"advisory"` is a demotion and `undefined` is the
    // requested blocking standing unchanged.
    expect(ownerSide("agent/tools-spec.json")).toBe("agent");
    expect(ownerSide(EVALUATOR_FILE)).toBe("correctness-model");
    const state = reviewState();
    const identities = { schemaRoots: ["layout"], checkIds: ["shortcut-check", "budget-check"] };
    const first = recordFindingTool([], [], "e", state, { identities, recurring: new Map() });
    const named = {
      defect: true,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the tool supplies the remaining decision",
    };
    await call(first, { ...named, owner: "agent/tools-spec.json", checkId: "shortcut-check" });
    expect(state.findings[0]?.severity).toBe("advisory");
    // The identical finding on an evaluation owner is admitted blocking on its first reading,
    // because the floor is the agent tier's alone. All that settles is the severity; what the
    // author does next is the run loop's decision, not this one's.
    const evaluatorSide = reviewState();
    await call(recordFindingTool([], [], "e", evaluatorSide, { identities, recurring: new Map() }), {
      ...named,
      owner: EVALUATOR_FILE,
      checkId: "budget-check",
    });
    expect(evaluatorSide.findings[0]?.severity).toBeUndefined();
    // One earlier condition having named the same check is what lifts the agent-tier floor, so
    // the second reading of `shortcut-check` is admitted blocking after all.
    const second = reviewState();
    await call(
      recordFindingTool([], [], "e", second, { identities, recurring: new Map([["shortcut-check", 1]]) }),
      {
        ...named,
        owner: "agent/tools-spec.json",
        checkId: "shortcut-check",
      },
    );
    expect(second.findings[0]?.severity).toBeUndefined();
  });

  test("what a probe executed reaches the author, whatever severity the finding is held at", async () => {
    // The two-occurrence ceiling exists because forcing blocking a third time repairs nothing while
    // the public projection supplies only the check's name: the review has run the candidate's own
    // checks over its own changed field, and the author reads a check id. A probe that watched a
    // check refuse a changed artifact over a rule no published decision states is exactly what the
    // author needs, so it crosses whether the finding is held at advice or not.
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
    const probed = (recurrences: Map<string, number>) => {
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
        movedCheckIds: ["shortcut-check"],
      });
      return { state, tool: recordFindingTool([], [], "e", state, { identities, recurring: recurrences }) };
    };

    const first = probed(new Map());
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

    // Held at advice by the ceiling, and deferred on top of that: the same line still crosses. This
    // is the round the ceiling was written for, and the round that used to project a bare check id.
    const worn = probed(new Map([["shortcut-check", 2]]));
    expect(await call(worn.tool, { ...named, probeIds: [1] })).toBe("recorded defect as advisory");
    const deferred = publicEpochReview(
      { status: "completed", ...worn.state },
      { brief: null, deferAdvisory: true },
    );
    expect(deferred.findings[0]?.claim ?? "").toContain(line);

    // The replacement value is a counterexample the reviewer generated and `blockingCheckIds` is
    // verifier detail. Neither crosses; the control, the path and the moved checks are the class
    // the finding's own `checkId` already crosses by.
    for (const projection of [publicEpochReview({ status: "completed", ...first.state }), deferred]) {
      expect(projection.findings[0]?.claim ?? "").not.toContain("widened");
    }

    // A source-only reading says so with `probeIds: []` and carries no such line.
    const source = reviewState();
    await call(recordFindingTool([], [], "e", source, { identities, recurring: new Map() }), {
      ...named,
      probeIds: [],
    });
    expect(source.findings[0]?.probes).toBeUndefined();
    expect(publicEpochReview({ status: "completed", ...source }).findings[0]?.claim ?? "").not.toContain(
      "Executed against",
    );
  });

  test("a probe-backed agent-side defect blocks on its first reading, and an uncited probe does not", async () => {
    // The agent-tier floor above exists because a reviewer reading source can only suspect: a
    // defect that concedes no current artifact distinguishes the two readings can go no
    // further than advice. A probe row is the candidate's own declared checks ruling on the
    // candidate's own accept control, so the first-occurrence floor does not apply to it.
    const named = {
      defect: true,
      owner: "agent/tools-spec.json",
      severity: "blocking",
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
    const ran = (id: number, refused: string | null) => ({
      id,
      controlId: "accept-a",
      taskId: "t0",
      path: "layout.span",
      change: { value: "1" },
      baseline: side("pass"),
      mutated: side("fail", ["shortcut-check"]),
      movedCheckIds: ["shortcut-check"],
      refused,
    });

    const backed = reviewState();
    backed.probes.rows.push(ran(1, null));
    expect(
      await call(recordFindingTool([], [], "e", backed, { identities, recurring: new Map() }), {
        ...named,
        probeIds: [1],
      }),
    ).toBe("recorded defect as blocking");
    expect(backed.findings[0]?.severity).toBeUndefined();
    expect(backed.findings[0]?.claim).toContain("Executed probes: 1");

    // Citing a probe the host refused credits the request, not a result.
    const refused = reviewState();
    refused.probes.rows.push(ran(1, "the checks did not settle"));
    expect(
      await call(recordFindingTool([], [], "e", refused, { identities, recurring: new Map() }), {
        ...named,
        probeIds: [1],
      }),
    ).toBe("recorded defect as advisory");
    expect(refused.findings[0]?.claim).not.toContain("Executed probes");

    // A pair that returned without deciding is not a result. `runControls` does not throw when a
    // check times out or an evaluation fails: the receipt comes back `non-result` with no blocking
    // checks, which reads exactly like "no check moved" to anything that only asks whether the
    // probe ran.
    const unsettled = reviewState();
    unsettled.probes.rows.push({ ...ran(1, null), mutated: side("non-result"), movedCheckIds: [] });
    expect(
      await call(recordFindingTool([], [], "e", unsettled, { identities, recurring: new Map() }), {
        ...named,
        probeIds: [1],
      }),
    ).toBe("recorded defect as advisory");
    expect(unsettled.findings[0]?.claim).not.toContain("Executed probes");

    // Nor is a changed artifact informative against an original the checks already refuse.
    const unsound = reviewState();
    unsound.probes.rows.push({ ...ran(1, null), baseline: side("fail", ["shortcut-check"]) });
    expect(
      await call(recordFindingTool([], [], "e", unsound, { identities, recurring: new Map() }), {
        ...named,
        probeIds: [1],
      }),
    ).toBe("recorded defect as advisory");

    // Every other limit still applies: two prior conditions hold the defect at advice.
    const worn = reviewState();
    worn.probes.rows.push(ran(1, null));
    expect(
      await call(
        recordFindingTool([], [], "e", worn, { identities, recurring: new Map([["shortcut-check", 2]]) }),
        {
          ...named,
          probeIds: [1],
        },
      ),
    ).toBe("recorded defect as advisory");
  });

  test("a defect recorded after a probe ran must say whether it rests on it", async () => {
    // A review can run all eight probes, write a defect whose own claim narrates what they
    // returned, and still leave `probeIds` unset. That finding is not probe-backed: it takes the
    // source-derived advisory floor, and its recorded claim carries no link to the rows that
    // support it. Asking costs one argument.
    const named = {
      defect: true,
      owner: "agent/tools-spec.json",
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
      movedCheckIds: ["shortcut-check"],
      refused,
    });

    const silent = reviewState();
    silent.probes.rows.push(ran(1), ran(2));
    const asked = await call(
      recordFindingTool([], [], "e", silent, { identities, recurring: new Map() }),
      named,
    );
    expect(asked).toContain("this review executed probes 1, 2");
    expect(asked).toContain("probeIds: [] when you read this from source alone");
    expect(silent.findings).toHaveLength(0);

    // `probeIds: []` is the answer for a reading taken from source alone, and it records.
    expect(
      await call(recordFindingTool([], [], "e", silent, { identities, recurring: new Map() }), {
        ...named,
        probeIds: [],
      }),
    ).toBe("recorded defect as advisory");
    expect(silent.findings[0]?.claim).not.toContain("Executed probes");

    // A probe that decided nothing is not evidence, so there is nothing to ask about.
    const inconclusive = reviewState();
    inconclusive.probes.rows.push({ ...ran(1), baseline: side("fail", ["shortcut-check"]) });
    expect(
      await call(recordFindingTool([], [], "e", inconclusive, { identities, recurring: new Map() }), named),
    ).toBe("recorded defect as advisory");

    // Only a defect can be admitted blocking on a probe, so only it is asked.
    const observed = reviewState();
    observed.probes.rows.push(ran(1));
    expect(
      await call(recordFindingTool([], [], "e", observed, { identities, recurring: new Map() }), {
        defect: false,
        claim: "the mass limits leave no headroom",
        severity: "advisory",
      }),
    ).toBe("recorded observation as advisory");
  });

  test("the same check named at a moved path, and under another placement, still counts as recurrence", async () => {
    // One check can be recorded as a defect at an artifact path and then, in the next review, as an
    // observation of hardness at no path. An identity keyed on the path and the placement reads
    // those two namings as two defects and never escalates.
    const root = dir();
    write(root, "r1", {
      status: "completed",
      condition: condition("t1"),
      findings: [
        {
          defect: true,
          claim: "private prose",
          evidence: "e",
          owner: EVALUATOR_FILE,
          severity: "advisory",
          checkId: "change-budget",
          artifactSchemaPath: "layout.members",
        },
      ],
    });
    write(root, "r2", {
      status: "completed",
      condition: condition("t2"),
      findings: [
        {
          defect: false,
          claim: "private prose",
          evidence: "e",
          owner: "correctness-model/tasks.json",
          severity: "advisory",
          checkId: "other-check",
        },
      ],
    });
    expect([...recurringDefects(root, condition("next")).keys()].sort()).toEqual([
      "change-budget",
      "other-check",
    ]);
    const state = reviewState();
    const tool = recordFindingTool([], [], "e", state, {
      identities: { schemaRoots: ["layout"], checkIds: ["change-budget", "other-check", "fresh-check"] },
      recurring: recurringDefects(root, condition("next")),
    });
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "advisory",
      claim: "the same check again",
      demonstration: DEMO,
      citations: CITATIONS,
    };
    // The path moved and the earlier placement differed; the check is the declared decision, so
    // both escalate. A check no review has named stays where the reviewer put it.
    await call(tool, { ...named, checkId: "change-budget" });
    expect(state.findings[0]?.severity).toBeUndefined();
    await call(tool, { ...named, checkId: "fresh-check" });
    expect(state.findings[1]?.severity).toBe("advisory");
  });

  test("a check named in two earlier conditions receives advisory severity on its next finding", async () => {
    // One check named in three successive reviews, forced blocking each time, orders a full rebuild
    // each time while the one-line projection never leads the author to the gap. So the first
    // recurrence can still become blocking, and after two earlier conditions have named the check
    // its next finding stays advisory; this test does not prescribe the next experiment.
    const root = dir();
    const finding = {
      defect: true,
      claim: "private prose",
      evidence: "e",
      owner: EVALUATOR_FILE,
      checkId: "target-compiles",
      artifactSchemaPath: "files",
    };
    write(root, "r1", { status: "completed", condition: condition("t1"), findings: [finding] });
    write(root, "r2", { status: "completed", condition: condition("t2"), findings: [finding] });
    expect(recurringDefects(root, condition("next")).get("target-compiles")).toBe(2);
    const identities = { schemaRoots: ["files"], checkIds: ["target-compiles"] };
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      claim: "the same gap a third time",
      checkId: "target-compiles",
    };
    const third = reviewState();
    await call(
      recordFindingTool([], [], "e", third, {
        identities,
        recurring: recurringDefects(root, condition("next")),
      }),
      named,
    );
    expect(third.findings[0]?.severity).toBe("advisory");
    // With only one earlier occurrence, the same supported finding still becomes blocking.
    const second = reviewState();
    await call(
      recordFindingTool([], [], "e", second, { identities, recurring: new Map([["target-compiles", 1]]) }),
      {
        ...named,
        severity: "advisory",
      },
    );
    expect(second.findings[0]?.severity).toBeUndefined();
  });

  test("an unattributed observation is not an earlier naming of its check", async () => {
    // An unplaced observation recorded on a check in one round would otherwise be enough, on its
    // own, to force the next round's defect on that same check to blocking.
    const root = dir();
    write(root, "r1", {
      status: "completed",
      condition: condition("t1"),
      findings: [
        {
          defect: false,
          claim: "private prose",
          evidence: "e",
          owner: null,
          severity: "advisory",
          checkId: "topology",
        },
      ],
    });
    write(root, "r2", {
      status: "completed",
      condition: condition("t2"),
      findings: [
        {
          defect: false,
          claim: "private prose",
          evidence: "e",
          owner: "correctness-model/tasks.json",
          severity: "advisory",
          checkId: "capacity",
        },
      ],
    });
    expect([...recurringDefects(root, condition("next")).keys()].sort()).toEqual(["capacity"]);
    const state = reviewState();
    const tool = recordFindingTool([], [], "e", state, {
      identities: { schemaRoots: ["layout"], checkIds: ["topology", "capacity"] },
      recurring: recurringDefects(root, condition("next")),
    });
    const named = {
      defect: true,
      owner: EVALUATOR_FILE,
      claim: "the same check again",
      citations: CITATIONS,
      demonstration: DEMO,
    };
    // The unplaced naming does not escalate; the positive one still does.
    await call(tool, { ...named, severity: "advisory", checkId: "topology" });
    expect(state.findings[0]?.severity).toBe("advisory");
    await call(tool, { ...named, severity: "advisory", checkId: "capacity" });
    expect(state.findings[1]?.severity).toBeUndefined();
  });

  test("an absent task set hash still separates conditions", () => {
    expect(condition(null).digest).not.toBe(condition("t1").digest);
  });
});

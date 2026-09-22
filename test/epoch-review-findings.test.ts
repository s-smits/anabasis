/**
 * The epoch reviewer's finding tool, and the authority it stays inside.
 *
 * A finding routes to an owner and is advisory unless it demonstrates a violation. The tool
 * decides which is which: a blocking severity needs the case it rests on, a dispute needs an
 * offered issue, and a check identity needs to exist in the measured brief. The Judge's own
 * reason never travels with any of them.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double } from "./helpers/doubles.ts";
import type { Brief } from "../src/truth/brief.ts";
import {
  BEAMS,
  CITATIONS,
  DEMO,
  JOINTS,
  call,
  issue,
  advicePacket,
  reviewState,
} from "./helpers/review-fixtures.ts";
import { authoringReviewText, recordAuthoringDisputes } from "../src/run/harness-build.ts";
import {
  attachIssueReadings,
  issueStatusWord,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  renderRebuildAdvice,
} from "../src/author/rebuild-advice.ts";
import type { AdviceIssue } from "../src/author/rebuild-advice.ts";
import { standingIssues } from "../src/review/diagnosis-reader.ts";
import { EPOCH_REVIEW_PROMPT } from "../src/review/epoch-review-prompt.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { briefIdentities, recordFindingTool } from "../src/review/epoch-review-findings.ts";

afterAll(cleanupScratch);

describe("the epoch reviewer's finding tool stays inside its authority", () => {
  test("its prompt distinguishes candidate analysis from answer disclosure", () => {
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "bounded candidate generation and complete public-requirement reports are legitimate solving support",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("A short tool sequence is not a defect");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "neither a single complete-analysis endpoint nor a dedicated optimiser is required",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("Exploratory subset analysis is valid");
    expect(EPOCH_REVIEW_PROMPT).toContain("protected answers or verifier material exposed to the solver");
    expect(EPOCH_REVIEW_PROMPT).toContain("analysis that silently omits required public scenarios");
    expect(EPOCH_REVIEW_PROMPT).toContain("Before alleging answer leakage");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "If the evidence only shows easy or repetitive tasks, record a curriculum concern",
    );
    // de8b40's first backstop review fired forty minutes in, read brief.json `{}` and a tools module
    // returning no tools, and spent its one blocking finding on the seed placeholder the next turn
    // replaced. The same review read the authored tasks and found a real defect there, so the rule
    // is that unwritten work is not a finding, not that an unfinished tree goes unread.
    expect(EPOCH_REVIEW_PROMPT).toContain("is work not yet done rather than a defect");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "Review what has been authored; where nothing has been, say so and record nothing",
    );
    // c1d2a7 round two: the review's one curriculum finding read the published mass limit, which
    // equals the author's own reference mass, and asked for a limit "independently of any stored
    // solution". Adoption refuses that candidate — its reference must earn a truth verdict against
    // every published limit (solvability-witness-failed) — so the ask cost a slot and could not be
    // met. Both halves of the shape: which way the margins point, and the floor under the limit.
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "A published limit set at the author's own reference result is the shape to read carefully",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "do not ask for a limit set independently of the author's own solution",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "a tighter published limit means a stronger reference search and nothing else",
    );
    expect(EPOCH_REVIEW_PROMPT).not.toContain("a task whose answer is recoverable from its own inputs");
    // Run 8729bb: three consecutive reviews reported the artifact-writer's empty generated
    // schema as a missing channel; the host binds that schema and execution (bindDraftTools).
    expect(EPOCH_REVIEW_PROMPT).toContain("an empty schema there is not a missing channel");
    // The 0905 review corpus: 9 of 75 findings over-claimed verifier equivalence, hidden-key
    // recovery or pin infeasibility from read source alone. The prompt names the three shapes.
    expect(EPOCH_REVIEW_PROMPT).toContain("Read source is not executed source.");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "a reading taken from source alone against the agent's tools or guide is held to advice",
    );
    // One statement of that rule, not four. The corpus it was measured against holds 92 hedged
    // claims and 103 findings of a kind that routes to no owner; repeating the instruction in
    // four places bought none of the caution it asks for.
    expect(EPOCH_REVIEW_PROMPT.split("held to advice").length - 1).toBe(1);
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "Block only when the verbatim original request or a published public rule requires the property",
    );
  });

  // Four bundles across two unrelated domains carried exactly one private ruleDecisions row each,
  // 133 to 265 characters, and in every one no declared check read the decision it described. The
  // twelve reviews over them spent 25 findings and never read the publication ceiling, because the
  // prompt only ever named the floor. The duty is stated once, with the probe that settles it and
  // the three surfaces that can own it.
  test("its prompt makes the publication ceiling a standing reading", () => {
    expect(EPOCH_REVIEW_PROMPT).toContain("Read the publication ceiling every time");
    expect(EPOCH_REVIEW_PROMPT).toContain("at least one decision a passing answer needs stays out of it");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "whether it is a sufficient construction algorithm for the artifact the declared checks decide",
    );
    // A private row is not evidence of withholding by existing; the reviewer reads it against the
    // checks, and the probe is what turns "no check reads it" from a reading into a demonstration.
    expect(EPOCH_REVIEW_PROMPT).toContain("withholds nothing when no declared check reads the order");
    expect(EPOCH_REVIEW_PROMPT).toContain("`probe_check` settles it");
    for (const owner of ["`brief` for the rule rows", "`instructions` for the guide", "`tools-spec`"]) {
      expect(EPOCH_REVIEW_PROMPT).toContain(owner);
    }
    // Stated once. The same corpus shows a duty repeated in four places buys none of the care.
    expect(EPOCH_REVIEW_PROMPT.split("publication ceiling").length - 1).toBe(1);
  });

  test("its prompt says what carries a finding to an owner, and what a probe is for", () => {
    // 180 of the 497 findings recorded across 314 reviews carry no checkId, no artifactSchemaPath
    // and no publicInputPath, so their public sentence names nothing to repair; 103 are of a kind
    // that routes to no owner at all while still spending one of the six slots. The prompt says so.
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "A finding reaches its owner through its identities, not its prose",
    );
    // c1d2a7 round two: the review's harness-defect on accept-controls carried no checkId,
    // artifactSchemaPath or publicInputPath, so publicFindingClaim took its identity-free branch
    // and the whole finding reached the author as "inspect that contract for a mismatch".
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "A finding that names none of the three reaches that pass as its kind and owner and nothing else",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("name the declared check those controls are meant to distinguish");
    expect(EPOCH_REVIEW_PROMPT).toContain("still spend one of your six slots");
    // The 2026-09-16 replay ran eight probes and cited none, so its harness-defect took the
    // source-derived floor. The prompt asks before record_finding has to.
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "Once you have run a probe, every harness-defect must say what it rests on",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("send `probeIds: []` for a reading taken from source alone");
    // No blocking finding exists in that corpus, and the Judge contests nothing in most batteries.
    // One paragraph settles both directions where two mirrored ones stood.
    expect(EPOCH_REVIEW_PROMPT).toContain("in either direction");
    expect(EPOCH_REVIEW_PROMPT).not.toContain("A disputed fail is the reverse");
    // The host refuses a task-naming claim outright and record_finding's own description says so.
    expect(EPOCH_REVIEW_PROMPT).not.toContain("Never name an individual task in a claim");
    // An esp32 admissibility check tested `prescaler >= 1` and never membership in the board's
    // published prescalerChoices, though the same file exported that catalogue as the reference
    // search's candidate list. The probe paragraph names the replacement that settles the class.
    expect(EPOCH_REVIEW_PROMPT).toContain("A closed value set the public input publishes");
    expect(EPOCH_REVIEW_PROMPT).toContain("name a value outside the set");
    expect(EPOCH_REVIEW_PROMPT).toContain("tests only a bound on it passes such a probe");
    // The reference enumerating a set for its own search is what made the hole easy to miss.
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "a set the reference enumerates for its own search is not thereby a set the declared checks enforce",
    );
  });

  const evidence = "campaigns/truss/analysis/r2-epoch-review.json";

  test("a harness defect must name a routable owner", async () => {
    const state = reviewState();
    const tool = recordFindingTool([issue()], [], evidence, state);
    const ownerContract = JSON.stringify(tool.parameters);
    expect(ownerContract).toContain("tests: correctness-model/tasks.json");
    expect(ownerContract).toContain("correctness-model: correctness-model/evaluator.ts");
    expect(ownerContract).toContain("controls: correctness-model/controls.json");
    expect(ownerContract).toContain("The Builder may make a broader repair");
    expect(ownerContract).not.toContain("evaluation correction freezes the agent and tasks");
    expect(ownerContract).toContain("demonstrated violation of the request or a declared requirement");
    expect(ownerContract).toContain("partial repair does not close");
    expect(
      await call(tool, {
        kind: "harness-defect",
        claim: "the writer omits a required root",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      }),
    ).toContain("routable owner");
    expect(
      await call(tool, {
        kind: "harness-defect",
        claim: "the writer omits a required root",
        owner: "not-an-owner",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      }),
    ).toContain("routable owner");
    expect(state.findings).toHaveLength(0);
  });

  test("a blocking harness defect must state the case it demonstrates", async () => {
    // Run truss-opus-20260907T210000000Z-6bf0e9 round 3 blocked on a defect whose own claim said it
    // could not construct the passing case, and that finding took the run's next move.
    const state = reviewState();
    const identities = { schemaRoots: ["layout"], checkIds: ["topology"] };
    const tool = recordFindingTool([], [], evidence, state, { identities });
    const hedged = {
      kind: "harness-defect",
      owner: "correctness-model",
      checkId: "topology",
      claim: "the check never walks connectivity",
      severity: "blocking",
    };
    expect(await call(tool, hedged)).toContain("`demonstration`");
    expect(await call(tool, { ...hedged, demonstration: "too short to be a case" })).toContain(
      "`demonstration`",
    );
    expect(state.findings).toHaveLength(0);
    // The same reading recorded as advice is admitted, demonstration or not.
    expect(await call(tool, { ...hedged, severity: "advisory" })).toContain("recorded harness-defect");
    expect(state.findings[0]?.severity).toBe("advisory");
    // The stated case and citation satisfy this admission check; review evidence retains both.
    const stated = reviewState();
    await call(recordFindingTool([], [], evidence, stated, { identities }), {
      ...hedged,
      citations: CITATIONS,
      demonstration: DEMO,
    });
    expect(stated.findings[0]?.severity).toBeUndefined();
    expect(stated.findings[0]?.claim).toContain("Demonstration: " + DEMO);
    // A schema-valid claim used to consume the entire stored prose allowance, erasing its case.
    const long = reviewState();
    const longTool = recordFindingTool([], [], evidence, long, { identities });
    const claim = "x".repeat(1_200);
    const demonstration = DEMO.repeat(12);
    await call(longTool, { ...hedged, claim, demonstration, citations: CITATIONS });
    expect(long.findings[0]?.claim).toContain(`${claim}\n\nDemonstration: ${demonstration}`);
    expect(publicEpochReview({ status: "completed", ...long })).toEqual(
      publicEpochReview({ status: "completed", ...stated }),
    );
    expect(await call(longTool, { ...hedged, claim: claim + "x", demonstration })).toContain(
      "claim must be at most 1200 characters",
    );
    expect(long.findings).toHaveLength(1);
  });

  test("a curriculum defect must name the public input the fresh battery should vary", async () => {
    // Run truss-opus-20260907T210000000Z-6bf0e9 recorded three curriculum defects naming no
    // identity. Each reached the task author as "inspect that contract for a mismatch", and the
    // batteries stayed at 24/24, 24/24 and 25/25.
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const args = {
      kind: "curriculum-defect",
      claim: "one template closes every family",
      severity: "advisory",
    };
    expect(await call(tool, args)).toContain("`publicInputPath`");
    expect(state.findings).toHaveLength(0);

    await call(tool, { ...args, publicInputPath: "$.limits.maxMemberLengthMm" });
    expect(state.findings).toHaveLength(1);
    const projected = publicEpochReview({ status: "completed", ...state }).findings[0]?.claim ?? "";
    expect(projected).toContain("$.limits.maxMemberLengthMm");
    // A curriculum finding names a task input to vary, rather than a correctness check to repair.
    expect(projected).toContain("let this input differ between the fresh battery's tasks");
    expect(projected).not.toContain("inspect and repair that contract");
    // Which way to vary. c1d2a7's third author read this sentence against `$.limits.massLimitKg`;
    // moving a published limit between batteries is the move 846c029d-3 made six times on a
    // byte-identical task set, and c1d2a7's round two made on five of six limits before repeating
    // 6 of 6.
    expect(projected).toContain("it does not ask for a published limit to move between batteries");
    // The owner already names the contract; the subject named it a second time, so every curriculum
    // finding read "in the public contract: the contract (public input `...`)".
    expect(projected).toContain("Epoch review (tasks): public input `$.limits.maxMemberLengthMm`");
    expect(projected).not.toContain("the contract (public input");
    // The private claim never crosses.
    expect(projected).not.toContain("one template");
  });

  test("an omitted or invalid severity cannot silently create a blocking finding", async () => {
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    for (const severity of [undefined, null, "urgent", ""]) {
      const args = {
        kind: "curriculum-defect",
        claim: "the task range may be too narrow",
        publicInputPath: "$.limits.span",
      };
      expect(await call(tool, severity === undefined ? args : { ...args, severity })).toContain(
        "severity must explicitly",
      );
    }
    expect(state.findings).toHaveLength(0);
    expect(state.refused).toBe(4);
    await call(tool, {
      kind: "curriculum-defect",
      claim: "the task range may be too narrow",
      severity: "advisory",
      publicInputPath: "$.limits.span",
    });
    expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.severity).toBe("advisory");
  });

  test("an authoring review defers advisory defects and states the request once", () => {
    // Eight recorded Builders (2026-09-14 to 16) repaired advisory review findings before submit
    // and paid a fresh full check for each.
    const defect = {
      kind: "harness-defect" as const,
      claim: "private remedy text",
      evidence: "e.json",
      proposedOwner: "correctness-model" as const,
      checkId: "mass-within-limit",
    };
    const review = {
      status: "completed" as const,
      disputes: [],
      findings: [
        { ...defect, severity: "advisory" as const },
        { ...defect, checkId: "deflection" },
      ],
    };
    const { findings } = publicEpochReview(review, { brief: null, deferAdvisory: true });
    const [advisory, blocking] = findings.map((finding) => finding.claim);
    expect(advisory).toContain("asks for no change before submit");
    expect(advisory).not.toMatch(/repair that contract|Repair the complete/);
    expect(blocking).toContain("inspect and repair that contract");
    expect(blocking).toContain("Repair the complete public obligation");
    const text = authoringReviewText("repair", "completed", "design trusses", findings);
    expect(text.split("design trusses")).toHaveLength(2);
    expect(text).toContain("1 blocking finding(s)");
    expect(text).not.toContain("private remedy");
    // An advisory row without a probe stays out of the tool result: five runs showed 33 such rows,
    // repeated and promised to a next round no reader carried them to.
    expect(text).not.toContain("[advisory]");
    expect(text).not.toContain("next round");
    const deferredOnly = authoringReviewText("repair", "completed", "design trusses", findings.slice(0, 1));
    expect(deferredOnly).toBe(
      "Epoch review of the candidate your clear correctness_check just previewed. Review completed. No finding blocks submit.",
    );
    // A probe behind an advisory row is executed evidence, and it still crosses.
    const probed = [{ ...findings[0]!, probes: [{ controlId: "a", path: "x", movedCheckIds: [] }] }];
    expect(authoringReviewText("repair", "completed", "design trusses", probed)).toContain("- [advisory] ");
    // Without the authoring reading, the measured-battery projection keeps its repair order.
    expect(publicEpochReview(review, { brief: null }).findings[0]?.claim).toContain(
      "inspect and repair that contract",
    );
  });

  test("an authoring dispute reaches the ledger the next build reads", () => {
    // Campaign -10's two authoring reviews each disputed a standing issue by id; its
    // `rebuild-advice-latest.json` carries all three of its issues with `"dispute": null`, because
    // the authoring path wrote the review file and projected its findings and dropped the rest.
    const root = scratchDir("ana-authoring-dispute-");
    mkdirSync(join(root, "campaigns", "truss", "analysis"), { recursive: true });
    const ledger = (issues: AdviceIssue[]) => {
      writeFileSync(latestRebuildAdvicePath(root, "truss"), JSON.stringify(advicePacket(issues)));
    };
    const carried = () => readLatestRebuildAdvice(root, "truss")?.issues[0] ?? null;
    ledger([issue()]);
    // Nothing to carry, and a dispute of an issue this ledger does not hold, both leave it alone.
    recordAuthoringDisputes(root, "truss", []);
    recordAuthoringDisputes(root, "truss", [{ issueId: JOINTS, reason: "a different family" }]);
    expect(carried()?.dispute).toBeNull();
    // A retired issue is not standing, so the review cannot suspend one the battery already closed.
    ledger([issue({ retired: true })]);
    recordAuthoringDisputes(root, "truss", [{ issueId: BEAMS, reason: "the limit is the reference mass" }]);
    expect(carried()?.dispute).toBeNull();

    ledger([issue()]);
    recordAuthoringDisputes(root, "truss", [{ issueId: BEAMS, reason: "the limit is the reference mass" }]);
    const disputed = carried();
    expect(disputed?.dispute).toContain("reference mass");
    expect(disputed === null ? null : issueStatusWord(disputed)).toBe("disputed");
    const rendered = renderRebuildAdvice(advicePacket(disputed === null ? [] : [disputed]));
    expect(rendered).toContain("do not rebuild the agent around them: beams (verified-fail)");
  });

  test("only the first blocking harness defect reopens an authoring area", async () => {
    const state = reviewState();
    // correctness-model, not an agent-side owner: this case is about the one-blocking cap, and an
    // agent-side owner would be advisory on its first reading for a different reason.
    const tool = recordFindingTool([issue()], [], evidence, state);
    expect(
      await call(tool, {
        kind: "harness-defect",
        claim: "first defect",
        owner: "correctness-model",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      }),
    ).toContain("as blocking");
    expect(
      await call(tool, {
        kind: "harness-defect",
        claim: "second defect",
        owner: "correctness-model",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      }),
    ).toContain("as advisory");
    expect(state.findings[0]?.severity).toBeUndefined();
    expect(state.findings[1]?.severity).toBe("advisory");
  });

  test("a claim naming a task in the battery is refused", async () => {
    const state = reviewState();
    const text = await call(recordFindingTool([issue()], ["truss-09"], evidence, state), {
      kind: "curriculum-defect",
      claim: "truss-09 is unsolvable",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      publicInputPath: "$.limits.span",
    });
    expect(text).toContain("may not name an individual task");
    expect(state.findings).toHaveLength(0);
  });

  test("a finding may dispute one offered issue, and only once", async () => {
    const state = reviewState();
    const tool = recordFindingTool([issue()], [], evidence, state);
    await call(tool, {
      kind: "curriculum-defect",
      claim: "the beams check passes any artifact",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      publicInputPath: "$.limits.span",
      disputesIssue: BEAMS.slice(0, 12),
    });
    await call(tool, {
      kind: "curriculum-defect",
      claim: "restated",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      publicInputPath: "$.limits.span",
      disputesIssue: BEAMS.slice(0, 12),
    });
    expect(state.disputes).toEqual([{ issueId: BEAMS, reason: "the beams check passes any artifact" }]);
    const publicReview = publicEpochReview({ status: "completed", ...state });
    const changed = publicEpochReview({
      status: "completed",
      findings: state.findings.map((row) => ({ ...row, claim: "private reference uses 1800 mm2" })),
      disputes: state.disputes.map((row) => ({ ...row, reason: "private verifier remedy" })),
    });
    expect(changed).toEqual(publicReview);
    expect(publicReview.findings).toHaveLength(state.findings.length);
    expect(publicReview.disputes[0]?.issueId).toBe(BEAMS);
    expect(
      renderRebuildAdvice(attachIssueReadings(advicePacket([issue()]), { disputes: publicReview.disputes })),
    ).not.toContain(state.disputes[0]?.reason ?? "unexpected missing dispute");
  });

  test("a finding citing an unoffered issue records the finding and no dispute", async () => {
    const state = reviewState();
    await call(recordFindingTool([issue()], [], evidence, state), {
      kind: "curriculum-defect",
      claim: "the task range may be too narrow",
      severity: "advisory",
      publicInputPath: "$.limits.span",
      citations: CITATIONS,
      demonstration: DEMO,
      disputesIssue: "0".repeat(12),
    });
    expect(state.findings).toHaveLength(1);
    expect(state.disputes).toHaveLength(0);
  });

  test("hardness, uncertainty and solving-agent defects leave verified failures available for diagnosis", async () => {
    for (const kind of ["hardness", "diagnosis-uncertain", "harness-defect"]) {
      const state = reviewState();
      const tool = recordFindingTool([issue()], [], evidence, state);
      const finding = {
        kind,
        owner: "tools-spec",
        claim: "the family is feasible but the agent fails",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      };
      expect(await call(tool, { ...finding, disputesIssue: BEAMS.slice(0, 12) })).toContain(
        "cannot dispute an issue",
      );
      expect(state.findings).toHaveLength(0);
      expect(await call(tool, finding)).toContain(`recorded ${kind}`);
      const advice = attachIssueReadings(
        advicePacket([issue()]),
        publicEpochReview({ status: "completed", ...state }),
      );
      expect(state.disputes).toHaveLength(0);
      expect(standingIssues(advice.issues).map((row) => row.id)).toEqual([BEAMS]);
      expect(renderRebuildAdvice(advice)).not.toContain("evaluation defect");
    }
  });

  test("an evaluation-side defect may still dispute an offered issue", async () => {
    const state = reviewState();
    const tool = recordFindingTool([issue()], [], evidence, state);
    expect(
      await call(tool, {
        kind: "harness-defect",
        owner: "correctness-model",
        claim: "the evaluator rejects a permitted representation",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
        disputesIssue: BEAMS.slice(0, 12),
      }),
    ).toContain("disputing issue");
    expect(
      attachIssueReadings(advicePacket([issue()]), publicEpochReview({ status: "completed", ...state }))
        .issues[0]?.dispute,
    ).not.toBeNull();
  });

  describe("public identities cross the projection; the claim never does", () => {
    const identities = { schemaRoots: ["pins"], checkIds: ["gpio-exit-code"] };
    const defect = {
      kind: "harness-defect",
      owner: "correctness-model",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
    };

    test("the tool asks the reviewer to fill the identities", () => {
      const tool = recordFindingTool([], [], evidence, reviewState(), { identities });
      expect(tool.description).toContain(
        "Fill checkId, artifactSchemaPath and publicInputPath whenever you know them",
      );
      for (const field of ["checkId", "artifactSchemaPath", "publicInputPath"]) {
        expect(JSON.stringify(tool.parameters)).toContain(`"${field}":`);
      }
    });

    test("a valid check id and schema path are recorded and projected without the private claim", async () => {
      const state = reviewState();
      const text = await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "the mock header returns 0 for every exit predicate",
        checkId: "gpio-exit-code",
        artifactSchemaPath: "pins.gpio",
        publicInputPath: "$.board.pins",
      });
      expect(text).toBe("recorded harness-defect as blocking");
      expect(state.findings[0]).toMatchObject({
        checkId: "gpio-exit-code",
        artifactSchemaPath: "pins.gpio",
        publicInputPath: "$.board.pins",
      });
      const projected = publicEpochReview({ status: "completed", ...state }).findings[0]?.claim ?? "";
      expect(projected).toBe(
        "Epoch review (evaluator): check `gpio-exit-code` at artifact path `pins.gpio` (public input `$.board.pins`); inspect and repair that contract.",
      );
      for (const word of ["mock", "header", "returns", "predicate"]) expect(projected).not.toContain(word);
    });

    // ESP32 run 0dba8e: three reviews named the compile check for a sketch no check ran, and the
    // Builder repaired the compile check each time.
    test("an unobserved obligation names its path, asks for a check and refuses a nearest check id", async () => {
      const state = reviewState();
      const tool = recordFindingTool([], [], evidence, state, { identities });
      expect(
        await call(tool, {
          ...defect,
          claim: "no check runs the sketch",
          unobserved: true,
          checkId: "gpio-exit-code",
          artifactSchemaPath: "pins",
        }),
      ).toContain("refused: an unobserved obligation has no check");
      expect(
        await call(tool, {
          ...defect,
          claim: "no check runs the sketch",
          unobserved: true,
          artifactSchemaPath: "pins",
        }),
      ).toBe("recorded harness-defect as blocking");
      expect(state.findings[0]).toMatchObject({ unobserved: true, artifactSchemaPath: "pins" });
      expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.claim).toBe(
        "Epoch review (evaluator): no declared check observes the obligation the review traced at artifact path `pins`; add a check that observes what the delivered artifact does there.",
      );
      // esp32 08c0f2: every one of nine checks read `$.firmware`, and two different gaps both
      // reached the Builder as "no declared check observes artifact path `firmware`".
      const reads = (id: string, artifactPaths: string[]) => ({ id, execution: { artifactPaths } });
      const brief = double<Brief>({
        truthChecks: [
          reads("builds", ["$.pins"]),
          reads("budget", ["$.pins.gpio"]),
          reads("report", ["$.report"]),
        ],
      });
      const traced = { ...state.findings[0]!, publicInputPath: "$.board.pins" };
      expect(
        publicEpochReview({ status: "completed", ...state, findings: [traced] }, { brief }).findings[0]
          ?.claim,
      ).toBe(
        "Epoch review (evaluator): none of the 2 declared checks reading artifact path `pins` observes the obligation the review traced there (public input `$.board.pins`); add a check that observes what the delivered artifact does there.",
      );
    });

    test("a defect on a vetoed check carries the veto's count and families, never the Judge's reason", async () => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "private prose",
        checkId: "gpio-exit-code",
      });
      const at = (task: string) => `campaigns/s/versions/r/runs/r/cases/${task}/artifact.json`;
      const row = {
        taskId: "t1",
        family: "uno",
        judge: false,
        verifier: true,
        rules: ["the exit code is 0"],
        rationale: "PRIVATE reason",
        confirmed: true,
        checkIds: ["gpio-exit-code"],
        evidence: "e",
        artifact: at("t1"),
      };
      const vetoed = [
        row,
        { ...row, taskId: "t2", family: "esp32", artifact: at("t2") },
        { ...row, taskId: "t3", checkIds: ["other-check"], artifact: at("t3") },
        { ...row, taskId: "t4", artifact: null },
      ];
      const reviewed = {
        status: "completed" as const,
        ...state,
        contestedReads: [at("t1"), at("t2"), at("t3")],
      };
      const projected = publicEpochReview(reviewed, { brief: null, vetoed }).findings[0]?.claim ?? "";
      expect(projected).toContain(
        "The Judge failed 2 verified pass(es) in esp32, uno citing this obligation, and the review settled them against the check",
      );
      for (const word of ["PRIVATE", "private prose", "t1", "exit code is 0"]) {
        expect(projected).not.toContain(word);
      }
      const other =
        publicEpochReview(reviewed, { brief: null, vetoed: [{ ...row, checkIds: ["other-check"] }] })
          .findings[0]?.claim ?? "";
      expect(other).not.toContain("The Judge failed");
      // A completed review that never opened a vetoed artifact has not settled that case.
      expect(
        publicEpochReview({ ...reviewed, contestedReads: [] }, { brief: null, vetoed }).findings[0]?.claim,
      ).not.toContain("The Judge failed");
    });

    test("a defect on a disputed check carries the Judge-pass count and families, never the Judge's reason", async () => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "private prose",
        checkId: "gpio-exit-code",
      });
      const row = {
        taskId: "t1",
        family: "uno",
        judge: true,
        verifier: false,
        rules: [],
        rationale: "PRIVATE reason",
        confirmed: true,
        checkIds: ["gpio-exit-code"],
        evidence: "e",
        artifact: "runs/r/cases/t1/artifact.json",
      };
      const reviewed = {
        status: "completed" as const,
        ...state,
        contestedReads: ["runs/r/cases/t1/artifact.json", "runs/r/cases/t2/artifact.json"],
      };
      const projected =
        publicEpochReview(reviewed, {
          brief: null,
          disputed: [
            row,
            { ...row, taskId: "t2", family: "esp32", artifact: "runs/r/cases/t2/artifact.json" },
          ],
        }).findings[0]?.claim ?? "";
      expect(projected).toContain(
        "The Judge passed 2 verified fail(s) in esp32, uno holding this obligation satisfied, and the review settled them against the check: it refuses an artifact the obligation admits.",
      );
      expect(projected).not.toContain("The Judge failed");
      for (const word of ["PRIVATE", "private prose", "t1"]) expect(projected).not.toContain(word);
    });

    test("an incomplete review projects only the veto it settled after reading the artifact, as advice", async () => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "private prose",
        checkId: "gpio-exit-code",
      });
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "private prose",
        checkId: "unrelated-check",
      });
      const row = {
        taskId: "t1",
        family: "uno",
        judge: false,
        verifier: true,
        rules: ["the exit code is 0"],
        rationale: "PRIVATE reason",
        confirmed: true,
        checkIds: ["gpio-exit-code"],
        evidence: "e",
        artifact: "campaigns/s/versions/r/runs/r/cases/t1/artifact.json",
      };
      const read = {
        status: "incomplete" as const,
        ...state,
        contestedReads: ["campaigns/s/versions/r/runs/r/cases/t1/artifact.json"],
      };
      const projected = publicEpochReview(read, { brief: null, vetoed: [row] });
      expect(projected.findings.map((finding) => [finding.checkId, finding.severity])).toEqual([
        ["gpio-exit-code", "advisory"],
      ]);
      expect(projected.findings[0]?.claim).toContain("The Judge failed 1 verified pass(es) in uno");
      expect(projected.disputes).toEqual([]);
      // Reading case t1 settles t1 alone, although t2 names the same check.
      const both = [
        row,
        {
          ...row,
          taskId: "t2",
          family: "esp32",
          artifact: "campaigns/s/versions/r/runs/r/cases/t2/artifact.json",
        },
      ];
      expect(publicEpochReview(read, { brief: null, vetoed: both }).findings[0]?.claim).toContain(
        "The Judge failed 1 verified pass(es) in uno citing",
      );
      // Settlement binds to the exact opened artifact, not to a path that merely ends like it.
      expect(
        publicEpochReview(
          { ...read, contestedReads: ["runs/r/cases/t1/artifact.json"] },
          { brief: null, vetoed: [row] },
        ).findings,
      ).toEqual([]);
      expect(
        publicEpochReview({ ...read, contestedReads: [] }, { brief: null, vetoed: [row] }).findings,
      ).toEqual([]);
      expect(
        publicEpochReview({ ...read, status: "completed" }, { brief: null, vetoed: [row] }).findings,
      ).toHaveLength(state.findings.length);
    });

    test("hardness and an uncertain diagnosis name the check as an observation, never as a repair order", async () => {
      // Astra reviews i11 to i18 (2026-09-12 to 14) recorded diagnosis-uncertain on equilibrium and
      // provenance in eight rounds; each reached the Builder as "inspect and repair that contract"
      // followed by "Repair the complete public obligation".
      for (const kind of ["hardness", "diagnosis-uncertain"] as const) {
        const state = reviewState();
        expect(
          await call(recordFindingTool([], [], evidence, state, { identities }), {
            kind,
            severity: "advisory",
            claim: "private prose",
            checkId: "gpio-exit-code",
          }),
        ).toBe(`recorded ${kind} as advisory`);
        const projected =
          publicEpochReview({ status: "completed", ...state }, { brief: null }).findings[0]?.claim ?? "";
        expect(projected).toContain("check `gpio-exit-code`");
        expect(projected).toContain("asks for no repair");
        expect(projected).not.toContain("Original request");
        for (const order of [
          "inspect and repair",
          "Repair the complete public obligation",
          "private prose",
        ]) {
          expect(projected).not.toContain(order);
        }
        const bare = reviewState();
        await call(recordFindingTool([], [], evidence, bare, { identities }), {
          kind,
          severity: "advisory",
          claim: "private prose",
        });
        expect(publicEpochReview({ status: "completed", ...bare }).findings[0]?.claim).toBe(
          "Epoch review (unplaced): no check, path or file named; it is an observation and asks for no repair.",
        );
      }
    });

    // The owner's file is the one concrete name such a finding has; the label and kind stay private.
    test("a finding without identities names its owner's file under its group", async () => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "the writer omits a required root",
      });
      expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.claim).toBe(
        "Epoch review (evaluator): correctness-model/evaluator.ts; inspect that contract for a mismatch.",
      );
      expect(state.findings[0]).not.toHaveProperty("checkId");
    });

    test("an undeclared check id, an unknown schema root and a bare input path are refused", async () => {
      const state = reviewState();
      const tool = recordFindingTool([], ["esp32-04"], evidence, state, { identities });
      const base = { ...defect, claim: "a check is not enforced" };
      expect(await call(tool, { ...base, checkId: "uart-parity" })).toContain(
        "not a declared truthChecks id",
      );
      expect(await call(tool, { ...base, artifactSchemaPath: "firmware.main" })).toContain(
        "not a declared artifactSchema root",
      );
      expect(await call(tool, { ...base, artifactSchemaPath: "pins..gpio" })).toContain(
        "without empty segments",
      );
      expect(await call(tool, { ...base, publicInputPath: "board.pins" })).toContain("must start with $.");
      expect(await call(tool, { ...base, publicInputPath: "$.tasks.esp32-04" })).toContain(
        "may not name an individual task",
      );
      expect(state.findings).toHaveLength(0);
      expect(state.refused).toBe(5);
    });

    test("the identities are read from the measured brief, and an absent brief declares none", () => {
      const root = scratchDir("ana-brief-identities-");
      expect(briefIdentities(root)).toEqual({ schemaRoots: [], checkIds: [] });
      mkdirSync(join(root, "correctness-model"));
      writeFileSync(
        join(root, "correctness-model/brief.json"),
        JSON.stringify({
          artifactSchema: [{ name: "pins" }, { unnamed: true }],
          truthChecks: [{ id: "gpio-exit-code" }],
        }),
      );
      expect(briefIdentities(root)).toEqual(identities);
    });
  });
});

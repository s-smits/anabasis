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
  isStanding,
  issueStatusWord,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  renderRebuildAdvice,
} from "../src/author/rebuild-advice.ts";
import type { AdviceIssue } from "../src/author/rebuild-advice.ts";
import { EPOCH_REVIEW_PROMPT } from "../src/review/epoch-review-prompt.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { briefIdentities, recordFindingTool } from "../src/review/epoch-review-findings.ts";
import { PROBE_BUDGET } from "../src/review/review-probe.ts";
import { ownerWritableFiles } from "../src/author/feedback-routing.ts";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

afterAll(cleanupScratch);

describe("the epoch reviewer's finding tool stays inside its authority", () => {
  const evidence = "campaigns/truss/analysis/r2-epoch-review.json";

  // The prompt is a condition identity, so it is held to properties rather than to its sentences:
  // each duty is stated once, superseded phrasings stay out, and the bounds it spells in words are
  // the bounds the host enforces.
  test("its prompt states each duty once, keeps retired phrasings out and spells the host's bounds", async () => {
    for (const duty of [
      "held to advice",
      "publication ceiling",
      "Read source is not executed source",
      "A finding reaches its owner through its identities",
      "Your closing message is recorded",
      "Block only when",
    ]) {
      expect(EPOCH_REVIEW_PROMPT.split(duty).length - 1).toBe(1);
    }
    for (const retired of [
      "a task whose answer is recoverable from its own inputs",
      "A disputed fail is the reverse",
      "Never name an individual task in a claim",
      "close with a short synthesis",
    ]) {
      expect(EPOCH_REVIEW_PROMPT).not.toContain(retired);
    }
    expect(EPOCH_REVIEW_PROMPT).toContain(`at most ${NUMBER_WORDS[PROBE_BUDGET]} in a review`);
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const hardness = {
      kind: "hardness",
      claim: "the family asks more than the harness reaches",
      severity: "advisory",
    };
    for (let attempt = 0; attempt < NUMBER_WORDS.length; attempt += 1) {
      if ((await call(tool, hardness)).includes("records at most")) break;
    }
    expect(EPOCH_REVIEW_PROMPT).toContain(`one of your ${NUMBER_WORDS[state.findings.length]} slots`);
  });

  test("a harness defect must name a routable owner, and the owner field lists what each one writes", async () => {
    const state = reviewState();
    const tool = recordFindingTool([issue()], [], evidence, state);
    const ownerContract = JSON.stringify(tool.parameters);
    for (const owner of ["tests", "correctness-model", "controls"] as const) {
      expect(ownerContract).toContain(`${owner}: ${ownerWritableFiles(owner).join(", ")}`);
    }
    expect(ownerContract).not.toContain("evaluation correction freezes the agent and tasks");
    const defect = {
      kind: "harness-defect",
      claim: "the writer omits a required root",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
    };
    expect(await call(tool, defect)).toContain("routable owner");
    expect(await call(tool, { ...defect, owner: "not-an-owner" })).toContain("routable owner");
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
    // Nothing reads the claim's length: it stays in review evidence and never crosses to authoring,
    // so a longer one is recorded whole rather than refused for its form.
    const longer = `${claim}${"y".repeat(800)}`;
    expect(await call(longTool, { ...hedged, severity: "advisory", claim: longer })).toContain(
      "recorded harness-defect",
    );
    expect(long.findings[1]?.claim).toBe(longer);
    expect(longTool.parameters).not.toHaveProperty("properties.claim.maxLength");
  });

  test("citations are held to what read_source returned, not to a count or a length", async () => {
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const advisory = { kind: "hardness", claim: "the family demands little", severity: "advisory" };
    // Five bound quotations, one of them longer than the old 800-character ceiling, all quote
    // returned pages, so each is a citation the finding may carry.
    const long = "x".repeat(900);
    state.delivered.push({
      path: "long.ts",
      digest: "",
      length: long.length,
      pages: [{ start: 0, text: long }],
    });
    const five = [...CITATIONS, ...CITATIONS, ...CITATIONS, ...CITATIONS, { path: "long.ts", quote: long }];
    expect(await call(tool, { ...advisory, citations: five })).toContain("recorded hardness");
    // An empty list cites nothing, which is the same as sending none.
    expect(await call(tool, { ...advisory, citations: [] })).toContain("recorded hardness");
    // A quotation no returned page contains is still refused: that is the rule, not the form.
    expect(
      await call(tool, { ...advisory, citations: [{ path: "evaluator.ts", quote: "never returned" }] }),
    ).toContain("citations must quote");
    expect(state.findings).toHaveLength(2);
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
    expect(projected).toContain("not only in the values published in it");
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
    const { text, findings: shown } = authoringReviewText("repair", "completed", "design trusses", findings);
    // The count is what holds a submit that arrives before the Builder has read the review.
    expect(shown).toBe(1);
    expect(text.split("design trusses")).toHaveLength(2);
    expect(text).toContain("1 blocking finding(s)");
    expect(text).not.toContain("private remedy");
    // An advisory row without a probe stays out of the tool result: five runs showed 33 such rows,
    // repeated and promised to a next round no reader carried them to.
    expect(text).not.toContain("[advisory]");
    expect(text).not.toContain("next round");
    const deferredOnly = authoringReviewText("repair", "completed", "design trusses", findings.slice(0, 1));
    // The review ran while the Builder kept working, so the header names the bytes it read and says
    // that later edits are not in them; a review showing nothing holds no submit.
    expect(deferredOnly).toEqual({
      text: "Epoch review of the candidate your clear correctness_check previewed. It ran while you kept working, so edits made since are not in it. Review completed. No finding blocks submit.",
      findings: 0,
    });
    expect(authoringReviewText("backstop", "completed", "design trusses", []).text).toStartWith(
      "Epoch review of your workspace, frozen when the review began. It ran while you kept working",
    );
    // A probe behind an advisory row is executed evidence, and it still crosses.
    const probed = [{ ...findings[0]!, probes: [{ controlId: "a", path: "x", movedCheckIds: [] }] }];
    expect(authoringReviewText("repair", "completed", "design trusses", probed)).toMatchObject({
      text: expect.stringContaining("- [advisory] "),
      findings: 1,
    });
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
      expect(advice.issues.filter(isStanding).map((row) => row.id)).toEqual([BEAMS]);
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

    test("the tool's schema offers the reviewer the identities", () => {
      const tool = recordFindingTool([], [], evidence, reviewState(), { identities });
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

    // Run 0dba8e: three reviews named the compile check for a sketch no check ran, and the
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
      // Run 08c0f2: every one of nine checks read `$.firmware`, and two different gaps both
      // reached the Builder as "no declared check observes artifact path `firmware`".
      const reads = (id: string, artifactPaths: string[]) => ({ id, execution: { artifactPaths } });
      const brief = double<Brief>({
        truthChecks: [
          reads("builds", ["$.pins"]),
          reads("budget", ["$.pins.gpio"]),
          // The bracketed spelling the brief validator accepts reads the same path.
          reads("wiring", ["$['pins']['gpio']"]),
          reads("report", ["$.report"]),
        ],
      });
      const traced = { ...state.findings[0]!, publicInputPath: "$.board.pins" };
      expect(
        publicEpochReview({ status: "completed", ...state, findings: [traced] }, { brief }).findings[0]
          ?.claim,
      ).toBe(
        "Epoch review (evaluator): none of the 3 declared checks reading artifact path `pins` observes the obligation the review traced there (public input `$.board.pins`); add a check that observes what the delivered artifact does there.",
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
        { ...row, taskId: "t2", family: "roof", artifact: at("t2") },
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
        "The Judge failed 2 verified pass(es) in roof, uno citing this obligation, and the review settled them against the check",
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
            { ...row, taskId: "t2", family: "roof", artifact: "runs/r/cases/t2/artifact.json" },
          ],
        }).findings[0]?.claim ?? "";
      expect(projected).toContain(
        "The Judge passed 2 verified fail(s) in roof, uno holding this obligation satisfied, and the review settled them against the check: it refuses an artifact the obligation admits.",
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
          family: "roof",
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
      const tool = recordFindingTool([], ["roof-04"], evidence, state, { identities });
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
      expect(await call(tool, { ...base, publicInputPath: "$.tasks.roof-04" })).toContain(
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

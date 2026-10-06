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
import type { Brief } from "../src/correctness-bundle/brief.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
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
  adviceIssueId,
  attachIssueReadings,
  isStanding,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  renderRebuildAdvice,
} from "../src/author/rebuild-advice.ts";
import type { AdviceIssue } from "../src/author/rebuild-advice.ts";
import { EPOCH_REVIEW_PROMPT } from "../src/review/epoch-review-prompt.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import {
  type SettlementCase,
  briefIdentities,
  recordFindingTool,
} from "../src/review/epoch-review-findings.ts";
import { BUNDLE_FILES } from "../src/author/feedback-routing.ts";
import { EVALUATOR_FILE, TASKS_FILE } from "../src/meta/bundle-layout.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

/** The method sentences the projection once attached to a finding. The author chooses the repair, so
 *  none of them may reach a projected finding again. */
const PRESCRIPTION =
  /repair|fresh battery|inspect|make the|loosen|tighten|vary|differ in what|bind a first|hold the|decide the public rule|add a check/i;

afterAll(cleanupScratch);

describe("the epoch reviewer's finding tool stays inside its authority", () => {
  const evidence = "campaigns/truss/analysis/r2-epoch-review.json";

  // The prompt is a condition identity, so it is held to properties rather than to its sentences:
  // each duty is stated once, superseded phrasings stay out, and the finding cap its tool states is
  // the cap the host enforces.
  test("its prompt states each duty once and keeps retired phrasings out, and its tool states the cap", async () => {
    for (const duty of [
      "held to advice",
      "publication boundary",
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
      '"nothing demonstrated" does not answer it',
      "family by family",
      "do not ask for a limit set independently",
      "names something it can repair",
      "inspect that contract for a mismatch",
    ]) {
      expect(EPOCH_REVIEW_PROMPT).not.toContain(retired);
    }
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const hardness = {
      defect: false,
      claim: "the family asks more than the harness reaches",
      severity: "advisory",
    };
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      if ((await call(tool, hardness)).includes("records at most")) break;
    }
    expect(tool.description).toContain(`a review records at most ${state.findings.length}.`);
  });

  // The publication paragraph once required a decision a passing answer needs to stay private,
  // which only a check-enforced private rule meets, and reviewers then recommended hiding enforced
  // formulas. It now publishes every enforced rule and asks for a recipe before calling one trivial.
  test("its publication paragraph asks for no check-enforced private decision", () => {
    for (const retired of [
      "at least one decision a passing answer needs stays out",
      "withholds nothing",
      "Say which decision you would have kept private",
      "naming the decision you would withhold",
    ]) {
      expect(EPOCH_REVIEW_PROMPT).not.toContain(retired);
    }
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "It must state the whole acceptance relation — every rule, constant, precedence and tolerance a declared check enforces",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("Claim it leaves none only by writing the recipe out");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "A unique passing answer or an explicit formula is not that demonstration",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "Never recommend hiding an enforced mapping, tolerance or precedence rule",
    );
  });

  test("a defect must name a bundle file as its owner, and the owner field lists every one", async () => {
    const state = reviewState();
    const tool = recordFindingTool([issue()], [], evidence, state);
    const ownerContract = JSON.stringify(tool.parameters);
    for (const file of BUNDLE_FILES) expect(ownerContract).toContain(`"${file}"`);
    expect(ownerContract).not.toContain('"environment"');
    expect(ownerContract).not.toContain("evaluation correction freezes the agent and tasks");
    const defect = {
      defect: true,
      claim: "the writer omits a required root",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
    };
    expect(await call(tool, defect)).toContain("bundle file at fault");
    expect(await call(tool, { ...defect, owner: "not-an-owner" })).toContain("bundle file at fault");
    expect(state.findings).toHaveLength(0);
  });

  test("a blocking defect must state the case it demonstrates", async () => {
    // Run truss-opus-20260907T210000000Z-6bf0e9 round 3 blocked on a defect whose own claim said it
    // could not construct the passing case, and that finding took the run's next move.
    const state = reviewState();
    const identities = { schemaRoots: ["layout"], checkIds: ["topology"] };
    const tool = recordFindingTool([], [], evidence, state, { identities });
    const hedged = {
      defect: true,
      owner: "correctness-model/evaluator.ts",
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
    expect(await call(tool, { ...hedged, severity: "advisory" })).toContain("recorded defect");
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
      "recorded defect",
    );
    expect(long.findings[1]?.claim).toBe(longer);
    expect(longTool.parameters).not.toHaveProperty("properties.claim.maxLength");
  });

  test("citations are held to what read_source returned, not to a count or a length", async () => {
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const advisory = { defect: false, claim: "the family demands little", severity: "advisory" };
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
    expect(await call(tool, { ...advisory, citations: five })).toContain("recorded observation");
    // An empty list cites nothing, which is the same as sending none.
    expect(await call(tool, { ...advisory, citations: [] })).toContain("recorded observation");
    // A quotation no returned page contains is still refused: that is the rule, not the form.
    expect(
      await call(tool, { ...advisory, citations: [{ path: "evaluator.ts", quote: "never returned" }] }),
    ).toContain("citations must quote");
    expect(state.findings).toHaveLength(2);
  });

  test("a task-set defect needs no public input and crosses as what it named, never as a repair", async () => {
    // A task-set defect was refused unless it named the public input "the fresh battery should
    // vary", and then crossed as an order to vary it. What to change is the author's decision; the
    // projection carries what the review found and where.
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    const args = {
      defect: true,
      owner: TASKS_FILE,
      claim: "one template closes every family",
      severity: "advisory",
    };
    // Blocking on the task set asks for the same stated case as blocking on any other file.
    expect(await call(tool, { ...args, severity: "blocking" })).toContain("`demonstration`");
    expect(await call(tool, args)).toBe("recorded defect as advisory");
    await call(tool, { ...args, publicInputPath: "$.limits.maxMemberLengthMm" });
    const [bare, named] = publicEpochReview({ status: "completed", ...state }).findings.map(
      (finding) => finding.claim,
    );
    expect(bare).toBe("Epoch review (correctness-model/tasks.json): no check or path named; a defect.");
    expect(named).toBe(
      "Epoch review (correctness-model/tasks.json): public input `$.limits.maxMemberLengthMm`; a defect.",
    );
  });

  test("an omitted or invalid severity cannot silently create a blocking finding", async () => {
    const state = reviewState();
    const tool = recordFindingTool([], [], evidence, state);
    for (const severity of [undefined, null, "urgent", ""]) {
      const args = {
        defect: true,
        owner: TASKS_FILE,
        claim: "the task range may be too narrow",
        publicInputPath: "$.limits.span",
      };
      expect(await call(tool, severity === undefined ? args : { ...args, severity })).toContain(
        "severity must explicitly",
      );
    }
    expect(state.findings).toHaveLength(0);
    await call(tool, {
      defect: true,
      owner: TASKS_FILE,
      claim: "the task range may be too narrow",
      severity: "advisory",
      publicInputPath: "$.limits.span",
    });
    expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.severity).toBe("advisory");
  });

  test("an authoring review states the request once, and no row it shows names a repair", () => {
    const defect = {
      defect: true,
      claim: "private remedy text",
      evidence: "e.json",
      owner: "correctness-model/evaluator.ts" as const,
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
    const { findings } = publicEpochReview(review, { brief: null });
    // Advisory or blocking, a row says what the review found and where; the severity is its own field.
    expect(findings.map((finding) => [finding.severity, finding.claim])).toEqual([
      ["advisory", "Epoch review (correctness-model/evaluator.ts): check `mass-within-limit`; a defect."],
      [undefined, "Epoch review (correctness-model/evaluator.ts): check `deflection`; a defect."],
    ]);
    const { text, blocking: held } = authoringReviewText("repair", "completed", "design trusses", findings);
    // The blocking count is what holds a submit that arrives before the Builder has read the review.
    expect(held).toBe(1);
    expect(text.split("design trusses")).toHaveLength(2);
    expect(text).toContain("1 blocking finding(s)");
    expect(text).not.toContain("private remedy");
    // An advisory row with neither a probe nor a demand gap stays out of the tool result: five runs
    // showed 33 such rows, repeated and promised to a next round no reader carried them to.
    expect(text).not.toContain("[advisory]");
    expect(text).not.toContain("next round");
    const deferredOnly = authoringReviewText("repair", "completed", "design trusses", findings.slice(0, 1));
    // The review ran while the Builder kept working, so the header names the bytes it read and says
    // that later edits are not in them; a review showing nothing holds no submit.
    expect(deferredOnly).toEqual({
      text: "Epoch review of the candidate your clear correctness_check previewed. It ran while you kept working, so edits made since are not in it. Review completed. No finding blocks submit.",
      blocking: 0,
    });
    expect(authoringReviewText("backstop", "completed", "design trusses", []).text).toStartWith(
      "Epoch review of your workspace, frozen when the review began. It ran while you kept working",
    );
    // A probe behind an advisory row is executed evidence, and it still crosses; being advisory, it
    // rides the next tool result and holds no submit. An observation is advisory by kind, and the row
    // it earns by its probe carries that probe's line.
    const probed = publicEpochReview(
      {
        status: "completed",
        disputes: [],
        findings: [
          {
            ...defect,
            defect: false,
            severity: "advisory",
            probes: [{ controlId: "a", path: "x", movedCheckIds: [] }],
          },
        ],
      },
      { brief: null },
    ).findings;
    const shown = authoringReviewText("repair", "completed", "design trusses", probed);
    expect(shown.blocking).toBe(0);
    expect(shown.text).toContain("- [advisory] ");
    expect(shown.text).toContain(
      "Executed against this candidate's own declared checks: changing x on accept control a moved no declared check.",
    );
    // A demand gap can carry no probe, since a probe re-runs the checks and the gap is in the tasks,
    // yet it answers whether the tasks are too easy: 381 of 485 recorded in authoring reviews were
    // hidden behind the probe filter. It crosses with its fixed sentence and holds no submit.
    const gap = publicEpochReview(
      {
        status: "completed",
        disputes: [],
        findings: [
          {
            defect: false,
            claim: "private reading",
            evidence: "e.json",
            owner: "correctness-model/tasks.json",
            severity: "advisory",
            demandGap: "limit-cleared-widely",
          },
        ],
      },
      { brief: null },
    ).findings;
    expect(authoringReviewText("repair", "completed", "design trusses", gap)).toMatchObject({
      text: expect.stringContaining(
        "- [advisory] Epoch review (correctness-model/tasks.json): no check or path named; an observation, not a demonstrated defect.\nThe first reasonable candidate clears a published limit widely.",
      ),
      blocking: 0,
    });
  });

  test("a probe-backed finding prints what its probes executed, and only a defect adds which way they show", () => {
    const executed =
      "Executed against this candidate's own declared checks: changing layout.span on accept control accept-a moved a-check, b-check.";
    const finding = { claim: "private reading", evidence: "e.json", checkId: "a-check" };
    const probes = [{ controlId: "accept-a", path: "layout.span", movedCheckIds: ["b-check", "a-check"] }];
    const claimOf = (row: Parameters<typeof publicEpochReview>[0]["findings"][number]) =>
      publicEpochReview({ status: "completed", disputes: [], findings: [row] }, { brief: null }).findings[0]
        ?.claim ?? "";
    const falseAcceptance = "a false acceptance";
    const falseRejection = "a false rejection";

    // An observation with probes: the line, whichever way the reviewer read them, and no direction.
    const observed = claimOf({
      ...finding,
      owner: null,
      defect: false,
      severity: "advisory",
      probes,
      probeDirection: "accepts-invalid",
    });
    expect(observed).toContain(executed);
    expect(observed).not.toContain(falseAcceptance);
    expect(observed).not.toContain("do not establish");

    // A defect with probes: the line and the direction the probes show, or that they do not say.
    const shows = claimOf({
      ...finding,
      owner: EVALUATOR_FILE,
      defect: true,
      probes,
      probeDirection: "rejects-valid",
    });
    expect(shows).toContain(executed);
    expect(shows).toContain(falseRejection);
    const unresolved = claimOf({ ...finding, owner: EVALUATOR_FILE, defect: true, probes });
    expect(unresolved).toContain(executed);
    expect(unresolved).toContain("do not establish");

    // An observation with no probes prints neither.
    const unprobed = claimOf({ ...finding, owner: null, defect: false, severity: "advisory" });
    expect(unprobed).not.toContain("Executed against");
    expect(unprobed).not.toContain(falseAcceptance);
    expect(unprobed).not.toContain(falseRejection);
    expect(unprobed).not.toContain("do not establish");
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
    expect(disputed === null ? null : isStanding(disputed)).toBe(false);
    const rendered = renderRebuildAdvice(advicePacket(disputed === null ? [] : [disputed]));
    expect(rendered).toContain("rather than the harness: beams (verified-fail)");
  });

  test("a claim naming a task in the battery is refused", async () => {
    const state = reviewState();
    const text = await call(recordFindingTool([issue()], ["truss-09"], evidence, state), {
      defect: true,
      owner: TASKS_FILE,
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
      defect: true,
      owner: TASKS_FILE,
      claim: "the beams check passes any artifact",
      severity: "blocking",
      citations: CITATIONS,
      demonstration: DEMO,
      publicInputPath: "$.limits.span",
      disputesIssue: BEAMS.slice(0, 12),
    });
    await call(tool, {
      defect: true,
      owner: TASKS_FILE,
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
      defect: true,
      owner: TASKS_FILE,
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

  test("observations and solving-agent defects leave verified failures available for diagnosis", async () => {
    const placements = [
      { defect: false, owner: TASKS_FILE },
      { defect: false },
      { defect: true, owner: "agent/tools-spec.json" },
    ];
    for (const placement of placements) {
      const state = reviewState();
      const tool = recordFindingTool([issue()], [], evidence, state);
      const finding = {
        ...placement,
        claim: "the family is feasible but the agent fails",
        severity: "blocking",
        citations: CITATIONS,
        demonstration: DEMO,
      };
      expect(await call(tool, { ...finding, disputesIssue: BEAMS.slice(0, 12) })).toContain(
        "cannot dispute an issue",
      );
      expect(state.findings).toHaveLength(0);
      expect(await call(tool, finding)).toContain(`recorded ${placement.defect ? "defect" : "observation"}`);
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
        defect: true,
        owner: "correctness-model/evaluator.ts",
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
      defect: true,
      owner: "correctness-model/evaluator.ts",
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
      expect(text).toBe("recorded defect as blocking");
      expect(state.findings[0]).toMatchObject({
        checkId: "gpio-exit-code",
        artifactSchemaPath: "pins.gpio",
        publicInputPath: "$.board.pins",
      });
      const projected = publicEpochReview({ status: "completed", ...state }).findings[0]?.claim ?? "";
      expect(projected).toBe(
        "Epoch review (correctness-model/evaluator.ts): check `gpio-exit-code` at artifact path `pins.gpio` (public input `$.board.pins`); a defect.",
      );
      for (const word of ["mock", "header", "returns", "predicate"]) expect(projected).not.toContain(word);
    });

    // Run 0dba8e: three reviews named the compile check for a sketch no check ran, and the
    // Builder repaired the compile check each time.
    test("an unobserved obligation names its path, counts its readers and refuses a nearest check id", async () => {
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
      ).toBe("recorded defect as blocking");
      expect(state.findings[0]).toMatchObject({ unobserved: true, artifactSchemaPath: "pins" });
      expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.claim).toBe(
        "Epoch review (correctness-model/evaluator.ts): no declared check observes the obligation the review traced at artifact path `pins`; a defect.",
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
        "Epoch review (correctness-model/evaluator.ts): none of the 3 declared checks reading artifact path `pins` observes the obligation the review traced there (public input `$.board.pins`); a defect.",
      );
    });

    // A case settles only where a finding names it. Reading an artifact, or sharing a check with a
    // case that was named, settles nothing: both once counted as settlement, and a review that
    // settled one case in a family could send the author several it never adjudicated.
    const at = (task: string) => `runs/r/cases/${task}/artifact.json`;
    const listed = (
      taskId: string,
      family: string,
      kind: SettlementCase["kind"],
      checkId = "gpio-exit-code",
    ) => ({
      taskId,
      family,
      kind,
      checkIds: [checkId],
      path: at(taskId),
    });
    const cases = [
      listed("t1", "uno", "veto"),
      listed("t2", "roof", "veto"),
      listed("t3", "uno", "veto", "other-check"),
      listed("t4", "uno", "veto"),
      listed("d1", "uno", "disputed-pass"),
    ];
    // Probe 1 wrote an invalid variant the check still passed; probe 2 a valid one it refused.
    const probe = (id: number, direction: "accepts-invalid" | "rejects-valid") => {
      const moved = direction === "rejects-valid" ? ["gpio-exit-code"] : [];
      return {
        id,
        controlId: "accept-1",
        taskId: "t1",
        path: "$.pins",
        change: { value: "1" },
        baseline: { outcome: "pass" as const, blockingCheckIds: [] },
        mutated: {
          outcome: moved.length === 0 ? ("pass" as const) : ("fail" as const),
          blockingCheckIds: moved,
        },
        applicableCheckIds: ["gpio-exit-code", "other-check"],
        movedCheckIds: moved,
        refused: null,
      };
    };
    const settling = () => {
      const state = reviewState();
      state.probes.rows.push(probe(1, "accepts-invalid"), probe(2, "rejects-valid"));
      state.reads.push(at("t1"), at("t2"), at("t3"), at("d1"));
      const tool = recordFindingTool([], ["t1", "t2", "t3", "t4", "d1"], evidence, state, {
        identities: { ...identities, checkIds: ["gpio-exit-code", "other-check"] },
        cases,
      });
      return { state, tool };
    };
    const named = { ...defect, claim: "private prose", checkId: "gpio-exit-code", probeIds: [1] };

    test("a defect settles exactly the listed cases it names, against the check, as counts and families", async () => {
      const { state, tool } = settling();
      expect(await call(tool, { ...named, settlesCases: ["t1", "t2"] })).toBe("recorded defect as blocking");
      expect(state.dispositions.map((row) => [row.taskId, row.disposition])).toEqual([
        ["t1", "against-check"],
        ["t2", "against-check"],
      ]);
      const projected = publicEpochReview({ status: "completed", ...state }).findings[0]?.claim ?? "";
      expect(projected).toContain(
        "The Judge failed 2 verified passes in roof, uno citing this obligation, and they were settled against the check",
      );
      for (const word of ["PRIVATE", "private prose", "t1", "t2"]) expect(projected).not.toContain(word);
      // A second finding on the same check, naming no case, settles none, and says nothing about them.
      await call(tool, { ...named, settlesCases: [] });
      expect(publicEpochReview({ status: "completed", ...state }).findings[1]?.claim).not.toContain(
        "The Judge",
      );
    });

    test("an opened case no finding names stays standing, and every unfit settlement is refused", async () => {
      const { state, tool } = settling();
      // Both t1 and t2 were opened; only t1 is adjudicated.
      await call(tool, { ...named, settlesCases: ["t1"] });
      expect(state.dispositions.map((row) => row.taskId)).toEqual(["t1"]);
      for (const [args, why] of [
        [{ settlesCases: ["t3"] }, "gpio-exit-code did not decide t3"],
        [{ settlesCases: ["t4"] }, "read t4's artifact with read_source before settling it"],
        [{ settlesCases: ["t9"] }, "t9 is not a listed veto or disputed fail"],
        [{ settlesCases: ["t1"] }, "t1 is already settled by an earlier finding"],
        // A defect with no probe of the check behind it settles nothing, whatever it says.
        [
          { settlesCases: ["t2"], probeIds: [] },
          "t2 is a veto case, which only a cited probe showing accepts-invalid on gpio-exit-code settles",
        ],
        [
          { settlesCases: ["t2"], owner: "agent/tools.ts" },
          "settlesCases is for a finding naming the deciding checkId",
        ],
        [
          { settlesCases: ["t2"], owner: TASKS_FILE },
          "settlesCases is for a finding naming the deciding checkId",
        ],
        [{ settlesCases: ["t2"], checkId: "" }, "settlesCases is for a finding naming the deciding checkId"],
      ] as const) {
        expect(await call(tool, { ...named, ...args })).toContain(why);
      }
      expect(state.dispositions.map((row) => row.taskId)).toEqual(["t1"]);
    });

    test("a false rejection settles disputed fails and cannot touch a veto", async () => {
      const { state, tool } = settling();
      const rejects = { ...named, probeIds: [2], probeDirection: "rejects-valid" };
      expect(await call(tool, { ...rejects, settlesCases: ["t1"] })).toContain(
        "t1 is a veto case, which only a cited probe showing accepts-invalid on gpio-exit-code settles against the check",
      );
      // The direction is the probe's, not the finding's: claiming rejects-valid over probe 1 settles no dispute.
      expect(await call(tool, { ...named, probeDirection: "rejects-valid", settlesCases: ["d1"] })).toContain(
        "d1 is a disputed-pass case, which only a cited probe showing rejects-valid",
      );
      expect(await call(tool, { ...rejects, settlesCases: ["d1"] })).toBe("recorded defect as blocking");
      const projected = publicEpochReview({ status: "completed", ...state }).findings[0]?.claim ?? "";
      expect(projected).toContain(
        "The Judge did not fail 1 verified fail in uno on this obligation, and it was settled against the check: it refuses an artifact the obligation admits.",
      );
      expect(projected).not.toContain("The Judge failed");
    });

    test("an unfinished review hands every admitted finding across as advice and settles nothing", async () => {
      const { state, tool } = settling();
      await call(tool, { ...named, settlesCases: ["t1"] });
      await call(tool, { ...named, checkId: "other-check" });
      for (const status of ["incomplete", "failed"] as const) {
        const projected = publicEpochReview({ status, ...state, disputes: [{ issueId: "i", reason: "r" }] });
        expect(projected.findings.map((finding) => [finding.checkId, finding.severity])).toEqual([
          ["gpio-exit-code", "advisory"],
          ["other-check", "advisory"],
        ]);
        for (const finding of projected.findings) {
          expect(finding.claim).toContain("did not finish reading the source, so it is advice");
          expect(finding.claim).not.toContain("The Judge failed");
        }
        expect(projected.disputes).toEqual([]);
        expect(projected.settledJudge).toEqual([]);
      }
      const completed = publicEpochReview({ status: "completed", ...state });
      expect(completed.findings.map((finding) => finding.severity)).toEqual([undefined, undefined]);
      expect(completed.findings[0]?.claim).toContain(
        "The Judge failed 1 verified pass in uno citing this obligation, and it was settled against the check",
      );
    });

    test("an observation names the check and says it demonstrated nothing", async () => {
      for (const placement of [{ owner: TASKS_FILE }, {}]) {
        const state = reviewState();
        expect(
          await call(recordFindingTool([], [], evidence, state, { identities }), {
            defect: false,
            ...placement,
            severity: "advisory",
            claim: "private prose",
            checkId: "gpio-exit-code",
          }),
        ).toBe("recorded observation as advisory");
        const projected =
          publicEpochReview({ status: "completed", ...state }, { brief: null }).findings[0]?.claim ?? "";
        expect(projected).toEndWith("check `gpio-exit-code`; an observation, not a demonstrated defect.");
        expect(projected).not.toContain("Original request");
        expect(projected).not.toContain("private prose");
        const bare = reviewState();
        await call(recordFindingTool([], [], evidence, bare, { identities }), {
          defect: false,
          severity: "advisory",
          claim: "private prose",
        });
        expect(publicEpochReview({ status: "completed", ...bare }).findings[0]?.claim).toBe(
          "Epoch review (no file named): no check or path named; an observation, not a demonstrated defect.",
        );
      }
    });

    // The owner's file is the one concrete name such a finding has; the claim stays private.
    test("a finding without identities names its owner's file and nothing to do there", async () => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        claim: "the writer omits a required root",
      });
      expect(publicEpochReview({ status: "completed", ...state }).findings[0]?.claim).toBe(
        "Epoch review (correctness-model/evaluator.ts): no check or path named; a defect.",
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

describe("what a finding's typed fields carry to authoring", () => {
  const evidence = "campaigns/truss/analysis/r2-epoch-review.json";
  const identities = { schemaRoots: ["layout"], checkIds: ["deflection"] };
  const brief = double<Brief>({
    truthChecks: [{ id: "deflection", assertion: "span/250", citedDecisionIds: [], execution: {} }],
    ruleDecisions: [],
  });
  const advisory = { defect: true, severity: "advisory", citations: CITATIONS };
  const probeRow = (id: number, movedCheckIds: string[]) => ({
    id,
    controlId: "accept-1",
    taskId: "t1",
    path: "$.layout.members[0].area",
    change: { value: "1" },
    baseline: { outcome: "pass" as const, blockingCheckIds: [] },
    mutated: {
      outcome: movedCheckIds.length === 0 ? ("pass" as const) : ("fail" as const),
      blockingCheckIds: movedCheckIds,
    },
    applicableCheckIds: ["deflection"],
    movedCheckIds,
    refused: null,
  });

  test("a shape and a second public input cross; the claim alone moves no projection", async () => {
    const project = async (claim: string) => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...advisory,
        owner: TASKS_FILE,
        claim,
        demandGap: "limit-cleared-widely",
        publicInputPath: "$.loads",
        secondPublicInputPath: "$.limits.deflection",
      });
      return publicEpochReview({ status: "completed", ...state }, { brief });
    };
    const first = await project("the limit is cleared by half");
    expect(first.findings[0]?.claim).toBe(
      "Epoch review (correctness-model/tasks.json): public inputs `$.loads` and `$.limits.deflection`; a defect.\nThe first reasonable candidate clears a published limit widely.",
    );
    const reworded = await project("a wholly different private wording");
    expect(reworded.findings.map((finding) => finding.claim)).toEqual(
      first.findings.map((finding) => finding.claim),
    );
  });

  // Each gap once crossed with a method attached — make the limit bind, demand a decision beyond
  // reading margins, vary what an input brings together — which is a second planner choosing the
  // Builder's next experiment. The gap is what the review observed; the method is the author's.
  test("each demand gap crosses as its observation alone, and protected detail moves no projection", async () => {
    const project = async (fields: Record<string, JsonValue>, claim: string, demonstration: string) => {
      const state = reviewState();
      state.reads.push("agent/tools.ts");
      state.delivered.push({
        path: "agent/tools.ts",
        digest: "",
        length: 0,
        pages: [{ start: 0, text: "return { margins: checks.map(read) };" }],
      });
      const citations =
        claim === "first"
          ? CITATIONS
          : [{ path: "agent/tools.ts", quote: "return { margins: checks.map(read) };" }];
      const recorded = await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...advisory,
        claim,
        demonstration,
        citations,
        ...fields,
      });
      expect(recorded).toStartWith("recorded");
      return publicEpochReview({ status: "completed", ...state }, { brief }).findings[0]?.claim ?? "";
    };
    const gapFindings: Array<[Record<string, JsonValue>, string]> = [
      [
        { owner: TASKS_FILE, demandGap: "limit-cleared-widely", publicInputPath: "$.limits.deflection" },
        "Epoch review (correctness-model/tasks.json): public input `$.limits.deflection`; a defect.\nThe first reasonable candidate clears a published limit widely.",
      ],
      [
        { owner: TASKS_FILE, demandGap: "rule-outside-request", publicInputPath: "$.loads" },
        "Epoch review (correctness-model/tasks.json): public input `$.loads`; a defect.\nA rule stands that no practitioner of the request would hold.",
      ],
      [
        { owner: TASKS_FILE, demandGap: "sibling-values-only", publicInputPath: "$.loads" },
        "Epoch review (correctness-model/tasks.json): public input `$.loads`; a defect.\nSibling tasks differ only in the values they publish.",
      ],
      [
        { owner: TASKS_FILE, demandGap: "capability-unexercised" },
        "Epoch review (correctness-model/tasks.json): no check or path named; a defect.\nThe request names a capability no task in the battery exercises.",
      ],
      [
        { owner: EVALUATOR_FILE, demandGap: "published-scenario-only" },
        `Epoch review (${EVALUATOR_FILE}): no check or path named; a defect.\nThe checks observe only the inputs the task publishes, so an answer that reproduces the published outputs without reading its inputs passes.`,
      ],
      [
        { owner: TASKS_FILE, demandGap: "requirements-one-at-a-time", defect: false },
        "Epoch review (correctness-model/tasks.json): no check or path named; an observation, not a demonstrated defect.\nEach task asks for the request's requirements one at a time, so none asks for several acting together on one answer, where meeting one spends the margin another needs.",
      ],
      [
        { owner: "agent/tools.ts", demandGap: "rule-outside-request" },
        "Epoch review (agent/tools.ts): no check or path named; a defect.\nA rule stands that no practitioner of the request would hold.",
      ],
      [{ owner: "agent/config.yaml" }, "Epoch review (agent/config.yaml): no check or path named; a defect."],
    ];
    for (const [fields, expected] of gapFindings) {
      const first = await project(fields, "first", DEMO);
      expect(first).toBe(expected);
      expect(first).not.toMatch(PRESCRIPTION);
      // Claim, demonstration and citations are the review's own protected detail.
      expect(await project(fields, "a wholly different private wording", "another private case")).toBe(first);
    }
  });

  test("a shape outside the closed set, and a second input naming a task, are refused", async () => {
    const tool = recordFindingTool([], ["t1"], evidence, reviewState(), { identities });
    const base = {
      ...advisory,
      owner: TASKS_FILE,
      claim: "c",
      publicInputPath: "$.loads",
    };
    expect(await call(tool, { ...base, demandGap: "too-easy" })).toContain(
      "refused: demandGap must be one of",
    );
    expect(await call(tool, { ...base, secondPublicInputPath: "loads" })).toContain(
      "secondPublicInputPath must start with $.",
    );
    expect(await call(tool, { ...base, secondPublicInputPath: "$.t1.loads" })).toContain(
      "secondPublicInputPath may not name an individual task",
    );
  });

  test("a defect naming a declared check carries its public obligation whichever file it names", async () => {
    const project = async (owner: string, defect = true) => {
      const state = reviewState();
      await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...advisory,
        defect,
        owner,
        claim: "c",
        checkId: "deflection",
      });
      return publicEpochReview({ status: "completed", ...state }, { brief }).findings[0]?.claim ?? "";
    };
    const obligation = 'Declared public obligation: {"assertion":"span/250","rules":[]}';
    expect(await project("correctness-model/brief.json")).toBe(
      `Epoch review (correctness-model/brief.json): check \`deflection\`; a defect.\n${obligation}`,
    );
    expect(await project("correctness-model/evaluator.ts")).toBe(
      `Epoch review (correctness-model/evaluator.ts): check \`deflection\`; a defect.\n${obligation}`,
    );
    // An observation demonstrated nothing, so quoting the check back at its author adds only bulk.
    expect(await project("correctness-model/evaluator.ts", false)).toBe(
      "Epoch review (correctness-model/evaluator.ts): check `deflection`; an observation, not a demonstrated defect.",
    );
  });

  const opened = "runs/r/cases/t1/artifact.json";
  const vetoedCase = (taskId: string, family: string) => ({
    taskId,
    family,
    kind: "veto" as const,
    checkIds: ["deflection"],
    path: `runs/r/cases/${taskId}/artifact.json`,
  });

  test("an observation settles a named case in the check's favour only with a probe that moved it, and then settles the issue", async () => {
    const observation = {
      defect: false,
      claim: "the Judge misread span/250",
      severity: "advisory",
      checkId: "deflection",
      settlesCases: ["t1"],
      citations: CITATIONS,
    };
    const reviewed = (moved: string[], cases = [vetoedCase("t1", "roof")]) => {
      const state = reviewState();
      state.reads.push(opened);
      state.probes.rows.push(probeRow(1, moved));
      return { state, tool: recordFindingTool([], [], evidence, state, { identities, cases }) };
    };
    const refused = reviewed([]);
    expect(await call(refused.tool, { ...observation, probeIds: [1] })).toContain(
      "settling a case in the check's favour requires a cited probe",
    );
    expect(await call(refused.tool, observation)).toContain("requires a cited probe");
    const unlisted = reviewed(["deflection"], []);
    expect(await call(unlisted.tool, { ...observation, probeIds: [1] })).toContain(
      "t1 is not a listed veto or disputed fail",
    );

    const { state, tool } = reviewed(["deflection"]);
    expect(await call(tool, { ...observation, probeIds: [1] })).toContain("recorded observation");
    expect(state.dispositions).toEqual([
      {
        taskId: "t1",
        family: "roof",
        kind: "veto",
        checkIds: ["deflection"],
        checkId: "deflection",
        disposition: "check-stands",
        finding: 0,
      },
    ]);
    const vetoedIssue = issue({
      id: adviceIssueId("judge-failed-verifier-passed", "roof", null),
      kind: "judge-failed-verifier-passed",
      family: "roof",
      count: 1,
    });
    const projected = publicEpochReview({ status: "completed", ...state }, { brief });
    expect(projected.settledJudge).toEqual([vetoedIssue.id]);
    expect(projected.findings[0]?.claim).toContain(
      "The Judge's disagreement was settled on 1 case in roof in the check's favour",
    );
    expect(projected.findings[0]?.claim).not.toContain("PRIVATE");
    const settled = attachIssueReadings(advicePacket([vetoedIssue, issue()]), {
      settled: projected.settledJudge,
    });
    expect(settled.issues.map((row) => row.judgeSettled === true)).toEqual([true, false]);
    expect(settled.issues.map(isStanding)).toEqual([false, true]);
    const rendered = renderRebuildAdvice(settled);
    expect(rendered).toContain("Settled Judge disagreements");
    expect(rendered).toContain("roof (judge-failed-verifier-passed)");

    // The same observation naming no case settles nothing, and the issue stays standing.
    const silent = reviewed(["deflection"]);
    await call(silent.tool, { ...observation, settlesCases: [], probeIds: [1] });
    const unsettled = publicEpochReview({ status: "completed", ...silent.state }, { brief });
    expect(unsettled.settledJudge).toEqual([]);
    expect(
      attachIssueReadings(advicePacket([vetoedIssue]), { settled: unsettled.settledJudge }).issues.map(
        isStanding,
      ),
    ).toEqual([true]);
  });

  // The probe ran on an accept control, so it shows how the check reads its rule; the cases it
  // settles are the ones the review read and named, and no sibling that merely names the same check.
  test("an observation settles only the cases it names, and an issue only once every case it counts is", async () => {
    const cases = [vetoedCase("t1", "roof"), vetoedCase("t2", "walls"), vetoedCase("t3", "roof")];
    const project = async (named: string[]) => {
      const state = reviewState();
      state.reads.push(...cases.map((row) => row.path));
      state.probes.rows.push(probeRow(1, ["deflection"]));
      await call(recordFindingTool([], [], evidence, state, { identities, cases }), {
        defect: false,
        claim: "the Judge misread span/250",
        severity: "advisory",
        checkId: "deflection",
        settlesCases: named,
        citations: CITATIONS,
        probeIds: [1],
      });
      return publicEpochReview({ status: "completed", ...state }, { brief });
    };
    const judgeIssue = (family: string, count: number) =>
      issue({
        id: adviceIssueId("judge-failed-verifier-passed", family, null),
        kind: "judge-failed-verifier-passed",
        family,
        count,
      });
    const standing = async (named: string[]) =>
      attachIssueReadings(advicePacket([judgeIssue("roof", 2), judgeIssue("walls", 1)]), {
        settled: (await project(named)).settledJudge,
      }).issues.map(isStanding);

    const claim = (await project(["t1"])).findings[0]?.claim ?? "";
    expect(claim).toContain("The Judge's disagreement was settled on 1 case in roof in the check's favour");
    for (const word of ["t1", "t2", "walls", "PRIVATE", "misread"]) expect(claim).not.toContain(word);
    expect((await project([])).findings[0]?.claim).not.toContain("disagreement was settled");
    // One named case of roof's two leaves roof standing, and walls, read but never named, stands too.
    expect(await standing(["t1"])).toEqual([true, true]);
    expect(await standing(["t1", "t3"])).toEqual([false, true]);
    expect(await standing(["t1", "t2", "t3"])).toEqual([false, false]);
  });

  // A probe that wrote a valid variant the check refused, and one that wrote an invalid variant the
  // check passed, both reach the author as "a check moved", so the direction crosses as its own
  // fact, and a probe that established neither says so. Which repair follows is the author's.
  test("a probe-backed defect's direction, or its absence, crosses as fixed text, and the probe's value does not", async () => {
    const defect = {
      defect: true,
      claim: "an ignorable line before the report is refused",
      severity: "advisory",
      owner: "correctness-model/evaluator.ts",
      checkId: "deflection",
      citations: CITATIONS,
      probeIds: [1],
    };
    const project = async (probeDirection: string | undefined, value: string) => {
      const state = reviewState();
      const moved = probeDirection === "accepts-invalid" ? [] : ["deflection"];
      state.probes.rows.push({ ...probeRow(1, moved), change: { value } });
      const recorded = await call(recordFindingTool([], [], evidence, state, { identities }), {
        ...defect,
        ...keyIfDefined("probeDirection", probeDirection),
      });
      expect(recorded).toStartWith("recorded defect");
      return publicEpochReview({ status: "completed", ...state }, { brief }).findings[0]?.claim ?? "";
    };
    const rejects = await project("rejects-valid", '"diag: boot, then report"');
    expect(rejects).toEndWith(
      "The review's probe wrote an answer the published rule allows, and the check refused it: a false rejection.",
    );
    expect(rejects).not.toContain("diag");
    const accepts = await project("accepts-invalid", '"diag: boot, then report"');
    expect(accepts).toEndWith(
      "The review's probe wrote an answer the published rule forbids, and the check let it through: a false acceptance.",
    );
    expect(await project(undefined, '"diag: boot, then report"')).toEndWith(
      "The cited probes do not establish whether a check refused a valid answer or let an invalid one through.",
    );
    for (const claim of [rejects, accepts]) expect(claim).not.toMatch(PRESCRIPTION);
    // Rule 4: the probe's replacement value is protected, so changing it alone moves nothing.
    expect(await project("rejects-valid", '"another private counterexample"')).toBe(rejects);
  });

  // A pass/pass probe moved no check, so it cannot be projected as the check refusing an answer.
  test("a direction is kept only where the cited probe shows it, and one off the closed set reads as none", async () => {
    const state = reviewState();
    state.probes.rows.push(probeRow(1, ["deflection"]), probeRow(2, []));
    const tool = recordFindingTool([], [], evidence, state, { identities });
    const base = {
      defect: true,
      claim: "c",
      severity: "advisory",
      owner: "correctness-model/evaluator.ts",
      checkId: "deflection",
      citations: CITATIONS,
      probeDirection: "rejects-valid",
    };
    expect(await call(tool, { ...base, probeIds: [] })).toStartWith("recorded defect");
    expect(await call(tool, { ...base, probeIds: [1], probeDirection: "loose" })).toStartWith(
      "recorded defect",
    );
    expect(await call(tool, { ...base, probeIds: [1] })).toStartWith("recorded defect");
    expect(await call(tool, { ...base, probeIds: [2] })).toStartWith("recorded defect");
    expect(await call(tool, { ...base, probeIds: [2], probeDirection: "accepts-invalid" })).toStartWith(
      "recorded defect",
    );
    expect(await call(tool, { ...base, probeIds: [1], probeDirection: "accepts-invalid" })).toStartWith(
      "recorded defect",
    );
    expect(state.findings.map((row) => row.probeDirection)).toEqual([
      undefined,
      undefined,
      "rejects-valid",
      undefined,
      "accepts-invalid",
      undefined,
    ]);
  });

  // A probe of a control whose task's family does not select the named check ran that check on
  // neither side, so its not moving says nothing about what the check accepts. Where one cited
  // probe does show the stated direction, the direction stands whatever the others show.
  test("a stated direction the cited probes' receipts do not establish is dropped", async () => {
    const state = reviewState();
    state.probes.rows.push({ ...probeRow(1, []), applicableCheckIds: [] }, probeRow(2, ["deflection"]));
    state.probes.rows.push(probeRow(3, []));
    const tool = recordFindingTool([], [], evidence, state, { identities });
    const base = {
      defect: true,
      claim: "c",
      severity: "advisory",
      owner: "correctness-model/evaluator.ts",
      checkId: "deflection",
      citations: CITATIONS,
      probeDirection: "accepts-invalid",
    };
    // Three recorded findings, whatever each direction became.
    for (const probeIds of [[1], [1, 2], [2, 3]]) await call(tool, { ...base, probeIds });
    expect(state.findings.map((row) => row.probeDirection)).toEqual([
      undefined,
      undefined,
      "accepts-invalid",
    ]);
  });
});

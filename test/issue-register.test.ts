/**
 * The issue register records, battery after battery, what each failure's family did, and never a
 * verdict on it. An issue says where it was first and last observed, how many complete rechecks
 * have not observed it since, which part of the condition moved when a recheck was not comparable,
 * and whether its family left the task set. Nothing turns those into "fixed" or "regressed", because
 * an absence is a failure not seen again and a repair is a claim an absence cannot carry.
 *
 * The first group is the ageing rule: what counts as a recheck, what leaves an issue unchanged, what
 * retires it and what a second sighting says. The second is the one decision the family's name
 * cannot make for it. An issue is about the tasks that failed, and the family is the label the author
 * gave them, so a label that disappears while its tasks keep running is a family that was renamed,
 * split or merged, which is an issue nobody has re-measured, and not one that went away. The third
 * is when an absence is comparable, which the condition reads (test/issue-condition.test.ts); here
 * it is only what the register does with the answer. The last is how a review's reading attaches to
 * an issue without changing a count.
 *
 * The packet that carries the register and what the author reads of it are in
 * test/rebuild-advice.test.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  type AdviceFamilyRow,
  type AdviceIssue,
  advanceIssues,
  adviceIssueId,
  attachIssueReadings,
  continuedUnder,
  isStanding,
  issueFacts,
} from "../src/author/issue-register.ts";
import { required } from "./helpers/doubles.ts";
import { BEAMS, JOINTS, MEASURED_UNDER, READING, advicePacket, issue } from "./helpers/review-fixtures.ts";

const other = (digit: string) => digit.repeat(64);

/** The ageing tests below count one failure in two attempts; everything else about the issue is
 *  the shared fixture's. */
const priorIssue = (overrides?: Partial<AdviceIssue>): AdviceIssue =>
  issue({ count: 1, denominator: 2, ...overrides });

const beamsFail = {
  kind: "verified-fail" as const,
  family: "beams",
  detail: null,
  count: 1,
  denominator: 2,
};

/** One family's row in the battery, every case of it truth-verified and passing unless `counts`
 *  says otherwise. The fixture's own family runs the fixture's tasks, and any other runs one of its own. */
const familyRow = (
  family: string,
  counts?: { verified?: number; unaccepted?: number; nonResults?: number },
  taskIds: readonly string[] = family === "beams" ? MEASURED_UNDER.taskIds : [`${family}-1`],
) => {
  const verified = counts?.verified ?? 1;
  return {
    family,
    verified,
    passed: verified,
    unaccepted: 0,
    nonResults: 0,
    ...counts,
    taskIds,
    taskInputs: MEASURED_UNDER.taskInputs,
  };
};
/** The battery's family rows. A family is only evidence about an issue once it produced a
 *  truth-verified case; `verified: 0` is a family the provider never let run. */
const ran = (...names: string[]) => names.map((family) => familyRow(family));
const unverified = (family: string) => [familyRow(family, { verified: 0, nonResults: 5 })];

/** The ageing rule under the fixture's scoring program and Built condition. */
function advance(
  previous: readonly AdviceIssue[],
  observed: Parameters<typeof advanceIssues>[1],
  runId: string,
  families: Parameters<typeof advanceIssues>[3]["families"],
  judgeReview: "complete" | "incomplete",
): AdviceIssue[] {
  return advanceIssues(previous, observed, runId, { ...MEASURED_UNDER, families }, judgeReview);
}

/** The same, with part of the battery's condition other than the fixture's. */
const advanceUnder = (
  previous: readonly AdviceIssue[],
  battery: Partial<Omit<Parameters<typeof advanceIssues>[3], "families">>,
  families: readonly AdviceFamilyRow[] = ran("beams"),
  observed: Parameters<typeof advanceIssues>[1] = [],
  runId = "r2",
) => advanceIssues(previous, observed, runId, { ...MEASURED_UNDER, ...battery, families }, "complete");

const facts = (issues: readonly AdviceIssue[]) => issues.map(issueFacts);

describe("how an issue ages across batteries", () => {
  it("counts each complete recheck that did not observe the issue, and states the count rather than a fix", () => {
    const once = advance([priorIssue()], [], "r2", ran("beams"), "complete");
    expect(once).toEqual([
      expect.objectContaining({ absentBatteries: 1, firstSeenRunId: "r1", observedUnder: MEASURED_UNDER }),
    ]);
    expect(facts(once)).toEqual(["first seen r1, not observed in 1 complete recheck since r1"]);
    const twice = advance(once, [], "r3", ran("beams"), "complete");
    expect(twice).toEqual([expect.objectContaining({ absentBatteries: 2 })]);
    expect(facts(twice)).toEqual(["first seen r1, not observed in 2 complete rechecks since r1"]);
  });

  it("retires an issue whose family and tasks left, and observes it again without a return if the family comes back", () => {
    // Without this, an issue stays active through every later battery of a rebuilt task set that
    // no longer holds its family. Absence of the family is not evidence of a fix either.
    const gone = advance([priorIssue()], [], "r2", ran("joints"), "complete");
    expect(gone).toEqual([
      expect.objectContaining({ retired: true, absentBatteries: 0, lastSeenRunId: "r1" }),
    ]);
    expect(facts(gone)).toEqual(["first seen r1, last seen r1, family left the task set"]);
    expect(advance(gone, [], "r3", ran("joints"), "complete")).toEqual(gone);
    const returned = advance(gone, [beamsFail], "r4", ran("beams"), "complete");
    expect(returned).toEqual([expect.objectContaining({ firstSeenRunId: "r1", lastSeenRunId: "r4" })]);
    expect(facts(returned)).toEqual(["first seen r1, last seen r4"]);
  });

  it("carries an issue unchanged when its family ran but the provider measured none of it", () => {
    // A battery whose cases were nearly all provider non-results still lists every family in its
    // rows, so reading appearance as "ran" counts a recheck for each of their issues on a battery
    // that verified nothing. A family that produced no truth-verified
    // case is evidence in neither direction: it did not leave the task set, so it is not retired,
    // and nothing observed the issue, so it does not age.
    const held = advance([priorIssue()], [], "r2", unverified("beams"), "complete");
    expect(held).toEqual([
      expect.objectContaining({ absentBatteries: 0, retired: false, lastSeenRunId: "r1" }),
    ]);
    expect(held.filter(isStanding)).toEqual(held);
    // Two such batteries still say nothing; the first measured one counts a recheck.
    expect(advance(held, [], "r3", unverified("beams"), "complete")).toEqual(held);
    expect(advance(held, [], "r4", ran("beams"), "complete")[0]?.absentBatteries).toBe(1);
  });

  it("carries an issue unchanged through a partial recheck, and ages it once every case of its family is verified", () => {
    // Task A failed and task B passed. A battery in which A came back a provider non-result and B
    // passed again never re-verified the case that exposed the issue, so its absence says nothing
    // about the case; counted, two such batteries would read as two rechecks no verdict had made.
    const onePassOneNonResult = [familyRow("beams", { nonResults: 1 })];
    const held = advance([priorIssue()], [], "r2", onePassOneNonResult, "complete");
    expect(held).toEqual([priorIssue()]);
    expect(advance(held, [], "r3", onePassOneNonResult, "complete")).toEqual(held);
    // An unaccepted case left no verdict either.
    expect(advance(held, [], "r3", [familyRow("beams", { unaccepted: 1 })], "complete")).toEqual(held);
    const verified = advance(held, [], "r3", [familyRow("beams", { verified: 2 })], "complete");
    expect(verified).toEqual([expect.objectContaining({ absentBatteries: 1, lastSeenRunId: "r1" })]);
  });

  it("keeps a Judge issue standing while the battery's census is unvalidated", () => {
    // A Judge that disagrees on the same case again under an unvalidated census has observed
    // nothing admissible, so counting a recheck there would record an absence nothing observed.
    const judgeIssue = priorIssue({ kind: "judge-passed-verifier-failed" });
    const unvalidated = advance([judgeIssue], [], "r2", ran("beams"), "incomplete");
    expect(unvalidated).toEqual([expect.objectContaining({ absentBatteries: 0, lastSeenRunId: "r1" })]);
    expect(unvalidated.filter(isStanding)).toEqual(unvalidated);
    expect(advance(unvalidated, [], "r3", ran("beams"), "complete")[0]?.absentBatteries).toBe(1);
    expect(advance([judgeIssue], [], "r2", ran("joints"), "incomplete")[0]?.retired).toBe(true);
  });

  it("keeps a dispute only while the issue is disputed", () => {
    // Left in place, a dispute string rides an issue no recheck observes through every later battery.
    const disputed = priorIssue({ dispute: "the evaluator pins a stale header" });
    const seenAgain = advance([disputed], [beamsFail], "r2", ran("beams"), "complete");
    expect(seenAgain).toEqual([expect.objectContaining({ dispute: "the evaluator pins a stale header" })]);
    expect(facts(seenAgain)).toEqual(["first seen r1, last seen r2, disputed"]);
    const absent = advance([disputed], [], "r2", ran("beams"), "complete");
    expect(absent).toEqual([expect.objectContaining({ dispute: null, absentBatteries: 1 })]);
    expect(advance([disputed], [], "r2", ran("joints"), "complete")).toEqual([
      expect.objectContaining({ retired: true, dispute: null }),
    ]);
    const back = advance(absent, [beamsFail], "r3", ran("beams"), "complete");
    expect(back).toEqual([expect.objectContaining({ returned: true, dispute: null })]);
    expect(facts(back)).toEqual(["first seen r1, last seen r3, seen again after an absence"]);
  });

  it("records an issue observed after a complete recheck missed it as returned, and keeps its first-seen battery", () => {
    const missed = advance([priorIssue()], [], "r2", ran("beams"), "complete");
    const back = advance(missed, [beamsFail], "r3", ran("beams"), "complete");
    expect(back).toEqual([
      expect.objectContaining({
        returned: true,
        firstSeenRunId: "r1",
        lastSeenRunId: "r3",
        absentBatteries: 0,
      }),
    ]);
    // An issue seen again with no recheck between did not go anywhere, so it did not return.
    const again = advance([priorIssue()], [beamsFail], "r2", ran("beams"), "complete");
    expect(again).toEqual([expect.objectContaining({ returned: false, lastSeenRunId: "r2" })]);
    expect(facts(again)).toEqual(["first seen r1, last seen r2"]);
  });

  it("reads an issue seen again on other tasks as first seen there, and as returned only on the same tasks", () => {
    // Identity names where a failure showed, not on which tasks, so one id can name failures on two
    // task records. The second is not the first seen again, and no recheck missed it.
    const moved = [{ ...familyRow("beams"), taskInputs: other("9") }];
    const missed = advance([priorIssue()], [], "r2", ran("beams"), "complete");
    expect(missed[0]?.absentBatteries).toBe(1);
    const elsewhere = advance(missed, [beamsFail], "r3", moved, "complete");
    expect(elsewhere).toEqual([
      expect.objectContaining({
        id: BEAMS,
        firstSeenRunId: "r3",
        lastSeenRunId: "r3",
        returned: false,
        observedUnder: { ...MEASURED_UNDER, taskInputs: other("9") },
      }),
    ]);
    expect(facts(elsewhere)).toEqual(["first seen r3, last seen r3"]);
    // The same failure on those tasks again, after a recheck there, is a return.
    const rechecked = advance(elsewhere, [], "r4", moved, "complete");
    const back = advance(rechecked, [beamsFail], "r5", moved, "complete");
    expect(back).toEqual([expect.objectContaining({ firstSeenRunId: "r3", returned: true })]);
    // Tasks that could not be vouched for, on either side, compare with nothing.
    const unvouched = priorIssue({ observedUnder: { ...MEASURED_UNDER, taskInputs: null }, returned: true });
    expect(advance([unvouched], [beamsFail], "r2", ran("beams"), "complete")).toEqual([
      expect.objectContaining({ firstSeenRunId: "r2", returned: false }),
    ]);
    const unread = [{ ...familyRow("beams"), taskInputs: null }];
    expect(advance(missed, [beamsFail], "r3", unread, "complete")).toEqual([
      expect.objectContaining({ firstSeenRunId: "r3", returned: false }),
    ]);
  });

  it("carries a dispute to a re-observation only under the condition that recorded it, and a diagnosis to none", () => {
    // Identity is kind, family and detail, not the failure's cause. A dispute an evaluator defect
    // earned, kept across the evaluator's repair, would suspend the solver failure the repaired
    // evaluator now reports in the same family. A diagnosis read one battery's traces, so it stays
    // with that observation: a partial recheck carries it, and the next observation is read afresh.
    const dispute = "the evaluator pins a stale header";
    const read = priorIssue({ diagnosis: READING, dispute });
    const same = advance([read], [beamsFail], "r2", ran("beams"), "complete");
    expect(same).toEqual([expect.objectContaining({ diagnosis: null, dispute, lastSeenRunId: "r2" })]);
    const partial = advance([read], [], "r2", [familyRow("beams", { nonResults: 1 })], "complete");
    expect(partial).toEqual([read]);
    const repaired = advanceUnder(
      [read],
      { scoringHash: other("8"), verdictClosureHash: other("9") },
      ran("beams"),
      [beamsFail],
    );
    expect(repaired).toEqual([
      expect.objectContaining({ diagnosis: null, dispute: null, lastSeenRunId: "r2" }),
    ]);
    expect(repaired.filter(isStanding)).toHaveLength(1);
    const otherTasks = [{ ...familyRow("beams"), taskInputs: other("9") }];
    expect(advance([read], [beamsFail], "r2", otherTasks, "complete")).toEqual([
      expect.objectContaining({ diagnosis: null, dispute: null }),
    ]);
  });

  it("gives different kinds and different non-result details different identities", () => {
    expect(adviceIssueId("verified-fail", "beams", null)).not.toBe(
      adviceIssueId("unaccepted", "beams", null),
    );
    expect(adviceIssueId("non-result", "beams", "provider")).not.toBe(
      adviceIssueId("non-result", "beams", "sandbox"),
    );
  });
});

describe("a family whose name left the battery while its tasks kept running", () => {
  // The issue is about the tasks that failed. The family is the label the author gave them, and the
  // author relabels: two tasks of "beams" become "girders", or fold into a sibling family. Read by
  // the label alone that is a family that left the task set, and the issue it carried is retired and
  // gone from the next round's advice, when nobody has shown the failing tasks fixed.
  /** The battery's one family, run under `name` on `taskIds`, whose records read differently for
   *  carrying another family name. */
  const runUnder = (name: string, taskIds: string[]) => [
    { ...familyRow(name, undefined, taskIds), taskInputs: other("9") },
  ];
  const renamed = runUnder("girders", ["t1", "t2"]);
  const unmeasured = ["task-inputs"];

  it("holds the issue as unmeasured, and credits no recheck however the tasks did under the new name", () => {
    const held = advance([priorIssue()], [], "r2", renamed, "complete");
    expect(held).toEqual([
      expect.objectContaining({
        retired: false,
        absentBatteries: 0,
        rulesChangedRechecks: 0,
        unmeasured,
        lastSeenRunId: "r1",
        observedUnder: MEASURED_UNDER,
      }),
    ]);
    expect(facts(held)).toEqual([
      "first seen r1, last seen r1, latest recheck not comparable (task inputs changed)",
    ]);
    // Every case of the renamed family was verified and passed; it still counts nothing, and it does
    // not stand, because the author is told it was not measured and not that it fails.
    expect(held.filter(isStanding)).toEqual([]);
    expect(continuedUnder(required(held[0], "the held issue"), renamed)).toEqual(["girders"]);
  });

  it("says where the tasks went when they split across two names or merged into one, and only then", () => {
    const [first] = advance([priorIssue()], [], "r2", renamed, "complete");
    const split = [familyRow("girders", undefined, ["t1"]), familyRow("columns", undefined, ["t2"])];
    expect(continuedUnder(required(first, "the held issue"), split)).toEqual(["columns", "girders"]);
    const merged = [familyRow("frames", undefined, ["t0", "t1", "t2"])];
    expect(continuedUnder(required(first, "the held issue"), merged)).toEqual(["frames"]);
    // A family that kept its own name is not renamed, whatever its tasks did, and a battery that
    // never ran one of the issue's tasks has nowhere to say it went.
    expect(continuedUnder(priorIssue(), ran("beams"))).toEqual([]);
    expect(continuedUnder(priorIssue(), [familyRow("girders", undefined, ["t9"])])).toEqual([]);
  });

  it("holds through later batteries while any of its tasks runs, and retires it once none does", () => {
    const held = advance([priorIssue()], [], "r2", renamed, "complete");
    const second = advance(held, [], "r3", runUnder("girders", ["t2", "t3"]), "complete");
    expect(second).toEqual([expect.objectContaining({ retired: false, unmeasured, absentBatteries: 0 })]);
    const gone = advance(second, [], "r4", runUnder("girders", ["t3"]), "complete");
    expect(gone).toEqual([expect.objectContaining({ retired: true, unmeasured: [], absentBatteries: 0 })]);
    expect(facts(gone)).toEqual(["first seen r1, last seen r1, family left the task set"]);
    expect(advance(gone, [], "r5", renamed, "complete")).toEqual(gone);
  });

  it("names the rest of the condition that moved beside the label", () => {
    const held = advanceUnder(
      [priorIssue()],
      { scoringHash: other("8"), verdictClosureHash: other("7"), checkTools: other("6") },
      renamed,
    );
    expect(held[0]?.unmeasured).toEqual(["task-inputs", "scoring", "check-tools"]);
    expect(held[0]?.retired).toBe(false);
  });

  it("retires an issue that recorded no tasks, and takes a dispute away from one it holds", () => {
    const unrecorded = priorIssue({ observedUnder: { ...MEASURED_UNDER, taskIds: [] } });
    expect(advance([unrecorded], [], "r2", renamed, "complete")[0]?.retired).toBe(true);
    const disputed = priorIssue({ dispute: "the evaluator pins a stale header" });
    expect(advance([disputed], [], "r2", renamed, "complete")).toEqual([
      expect.objectContaining({ retired: false, dispute: null }),
    ]);
  });

  it("counts a recheck again once the family's name is back on the tasks the issue was observed under", () => {
    const held = advance([priorIssue()], [], "r2", renamed, "complete");
    const back = advance(held, [], "r3", ran("beams"), "complete");
    expect(back).toEqual([expect.objectContaining({ retired: false, unmeasured: [], absentBatteries: 1 })]);
    // Seen again under the new name it is a failure of a family the register has no issue for yet.
    const girders = { ...beamsFail, family: "girders" };
    const under = advance(held, [girders], "r3", renamed, "complete");
    expect(under.map((row) => [row.family, row.firstSeenRunId, row.retired])).toEqual([
      ["beams", "r1", false],
      ["girders", "r3", false],
    ]);
  });
});

describe("what the register does with a comparison it was given", () => {
  const ranOn = (taskInputs: string | null) => [{ ...familyRow("beams", { verified: 2 }), taskInputs }];

  it("reads an absence on other task inputs as unmeasured, never as a fix", () => {
    // The family ran and every verified case passed, but on tasks it never failed: nothing about
    // the issue was asked again, so the absence proves nothing about whether it was repaired.
    const moved = advance([issue()], [], "r2", ranOn(other("9")), "complete");
    expect(moved).toEqual([
      expect.objectContaining({ absentBatteries: 0, unmeasured: ["task-inputs"], lastSeenRunId: "r1" }),
    ]);
    expect(facts(moved)).toEqual([
      "first seen r1, last seen r1, latest recheck not comparable (task inputs changed)",
    ]);
    expect(moved.filter(isStanding)).toEqual([]);
    // A family whose tasks could not be vouched for compares with nothing.
    expect(advance([issue()], [], "r2", ranOn(null), "complete")[0]?.unmeasured).toEqual(["task-inputs"]);
  });

  it("reads an absence as unmeasured when the checks, their tools or the Built condition moved, even on identical inputs", () => {
    // Identical inputs are necessary and not enough: a weaker evaluator, a replaced analyser and
    // another model each make an issue vanish unrepaired.
    const cases = [
      [{ scoringHash: other("8"), verdictClosureHash: other("9") }, ["scoring"]],
      [{ checkTools: other("6") }, ["check-tools"]],
      [{ checkTools: null }, ["check-tools"]],
      [{ measuredCondition: other("7") }, ["built-condition"]],
    ] as const;
    for (const [moved, gaps] of cases) {
      expect(advanceUnder([issue()], moved, ranOn(MEASURED_UNDER.taskInputs))[0]).toMatchObject({
        absentBatteries: 0,
        unmeasured: gaps,
      });
    }
    const otherModel = advanceUnder([issue()], { measuredCondition: other("7") }, ranOn(other("9")));
    expect(otherModel[0]?.unmeasured).toEqual(["task-inputs", "built-condition"]);
  });

  it("counts a recheck once a comparable battery runs, and seeing it again after none is no return", () => {
    const moved = advance([issue()], [], "r2", ranOn(other("9")), "complete");
    const comparable = advance(moved, [], "r3", ranOn(MEASURED_UNDER.taskInputs), "complete");
    expect(comparable).toEqual([expect.objectContaining({ absentBatteries: 1, unmeasured: [] })]);
    // Seen again after an absence no battery could compare, no complete comparable recheck ever
    // missed it, so it did not return.
    const seen = advance(moved, [beamsFail], "r3", ranOn(other("9")), "complete");
    expect(seen).toEqual([
      expect.objectContaining({
        returned: false,
        unmeasured: [],
        observedUnder: { ...MEASURED_UNDER, taskInputs: other("9") },
      }),
    ]);
  });

  describe("a recheck after the public rules changed", () => {
    // The brief was reworded: the scoring hash reads its bytes, so it moved, while the verdict
    // closure, which reads the checks and not their prose, did not.
    const reworded = { scoringHash: other("8"), publicationHash: other("7") };
    const recheck = (battery: Parameters<typeof advanceUnder>[1], previous = [issue()]) =>
      advanceUnder(previous, battery);

    it("is credited as a recheck under unchanged checks, with the changed rules named, never as unmeasured", () => {
      const result = recheck(reworded);
      expect(result).toEqual([
        expect.objectContaining({ absentBatteries: 1, rulesChangedRechecks: 1, unmeasured: [] }),
      ]);
      expect(facts(result)).toEqual([
        "first seen r1, not observed in 1 complete recheck since r1, rechecked under unchanged checks, public rules changed",
      ]);
      expect(result.filter(isStanding)).toEqual([]);
    });

    it("is a plain recheck when the rules read the same, even though the brief's bytes moved", () => {
      // A private row or a decision moves the scoring hash and publishes nothing.
      for (const battery of [{}, { scoringHash: other("8") }]) {
        const result = recheck(battery);
        expect(result).toEqual([
          expect.objectContaining({ absentBatteries: 1, rulesChangedRechecks: 0, unmeasured: [] }),
        ]);
        expect(issueFacts(required(result[0], "the rechecked issue"))).toBe(
          "first seen r1, not observed in 1 complete recheck since r1",
        );
      }
    });

    it("stays unmeasured when the checks, their tools, the tasks or the Built condition moved, whatever the rules did", () => {
      expect(recheck({ ...reworded, verdictClosureHash: other("9") })[0]).toMatchObject({
        absentBatteries: 0,
        rulesChangedRechecks: 0,
        unmeasured: ["scoring"],
      });
      // A closure that could not be vouched for compares with nothing, on either side.
      expect(recheck({ ...reworded, verdictClosureHash: null })[0]?.unmeasured).toEqual(["scoring"]);
      const unvouched = { ...MEASURED_UNDER, verdictClosureHash: null };
      expect(recheck(reworded, [issue({ observedUnder: unvouched })])[0]?.unmeasured).toEqual(["scoring"]);
      expect(recheck({ ...reworded, checkTools: other("6") })[0]?.unmeasured).toEqual(["check-tools"]);
      expect(recheck({ ...reworded, measuredCondition: other("5") })[0]?.unmeasured).toEqual([
        "built-condition",
      ]);
      const moved = advanceUnder([issue()], reworded, ranOn(other("4")));
      expect(moved[0]?.unmeasured).toEqual(["task-inputs"]);
      // Unvouched rules cannot show identical instructions, but the checks are the same.
      expect(recheck({ ...reworded, publicationHash: null })[0]).toMatchObject({
        absentBatteries: 1,
        rulesChangedRechecks: 1,
      });
    });

    it("counts beside the plain rechecks, and a mixed history is not named as changed rules alone", () => {
      const plain = recheck({});
      const [mixed] = recheck(reworded, plain);
      expect(mixed).toMatchObject({ absentBatteries: 2, rulesChangedRechecks: 1 });
      expect(issueFacts(required(mixed, "the rechecked issue"))).toContain(
        "not observed in 2 complete rechecks since r1, 1 of them rechecked under unchanged checks, public rules changed",
      );
    });

    it("returns as seen again after an absence, and takes the dispute away", () => {
      const rechecked = recheck(reworded, [issue({ dispute: "the check enforces an unpublished rule" })]);
      expect(rechecked[0]?.dispute).toBeNull();
      const again = advanceUnder(rechecked, reworded, ran("beams"), [beamsFail], "r3");
      expect(again[0]).toMatchObject({ returned: true, rulesChangedRechecks: 0, absentBatteries: 0 });
      // The same condition keeps a dispute through a second sighting; changed public rules do not.
      const disputed = issue({ dispute: "the check enforces an unpublished rule" });
      const [same] = advanceUnder([disputed], {}, ran("beams"), [beamsFail]);
      const [moved] = advanceUnder([disputed], reworded, ran("beams"), [beamsFail]);
      expect([same?.dispute, moved?.dispute]).toEqual(["the check enforces an unpublished rule", null]);
    });
  });
});

describe("a reading attaches to an issue without changing what the battery counted", () => {
  it("attaches a diagnosis to the named issue without changing counts or standing", () => {
    const before = advicePacket([issue(), issue({ id: JOINTS, kind: "unaccepted", family: "joints" })]);
    const after = attachIssueReadings(before, { diagnoses: [{ issueIds: [BEAMS], diagnosis: READING }] });
    expect(after.issues[0]?.diagnosis?.cause).toBe(READING.cause);
    expect(after.issues[0]?.count).toBe(2);
    expect(isStanding(after.issues[0] ?? issue())).toBe(true);
    expect(after.issues[1]?.diagnosis).toBeNull();
  });

  it("marks a standing issue as disputed and records the reason", () => {
    const after = attachIssueReadings(advicePacket([issue()]), {
      disputes: [{ issueId: BEAMS, reason: "the check cannot fail on a real task" }],
    });
    expect(isStanding(after.issues[0] ?? issue())).toBe(false);
    expect(after.issues[0]?.dispute).toBe("the check cannot fail on a real task");
  });

  it("a dispute leaves rechecked, held and retired issues unchanged", () => {
    for (const notStanding of [
      { absentBatteries: 2 },
      { retired: true },
      { unmeasured: ["task-inputs" as const] },
    ]) {
      const before = advicePacket([issue(notStanding)]);
      const after = attachIssueReadings(before, {
        disputes: [{ issueId: BEAMS, reason: "evaluation artefact" }],
      });
      expect(after).toEqual(before);
    }
  });

  it("no reading returns the same packet", () => {
    const before = advicePacket([issue()]);
    expect(attachIssueReadings(before, {})).toBe(before);
  });

  it("a Judge settlement holds once every case the issue counts is settled, and touches no other", () => {
    const twoFamilies = advicePacket([issue(), issue({ id: JOINTS, family: "joints" })]);
    // The issue counts two cases, and one settled case leaves its unsettled sibling standing.
    expect(attachIssueReadings(twoFamilies, { settled: [BEAMS] }).issues.map(isStanding)).toEqual([
      true,
      true,
    ]);
    const after = attachIssueReadings(twoFamilies, { settled: [BEAMS, BEAMS] });
    expect(after.issues.map(isStanding)).toEqual([false, true]);
    expect(after.issues.map(issueFacts)[0]).toBe("first seen r1, last seen r1, settled by an epoch review");
    expect(after.issues[0]?.count).toBe(2);
    for (const notStanding of [{ absentBatteries: 2 }, { retired: true }, { dispute: "evaluation" }]) {
      const before = advicePacket([issue(notStanding)]);
      expect(attachIssueReadings(before, { settled: [BEAMS, BEAMS] })).toEqual(before);
    }
    // A later battery that observes the disagreement again records it afresh, standing.
    const [again] = advance(
      after.issues.slice(0, 1),
      [{ kind: "verified-fail", family: "beams", detail: null, count: 2, denominator: 5 }],
      "r3",
      advicePacket([]).families,
      "complete",
    );
    expect(again?.judgeSettled).toBeUndefined();
    expect(isStanding(again ?? issue())).toBe(true);
  });
});

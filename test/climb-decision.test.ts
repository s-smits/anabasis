/**
 * Where a measured battery sits against the target band, and what that says to do next.
 *
 * Two owners. `placeOnBand` turns a pass count into a zone, the pass counts an author can act on
 * and the distance to them; `decideDifficulty` is the one decision over recorded batteries — the
 * three shapes whose rate is not difficulty evidence first, then the placement.
 *
 * Sample size has a single owner, the interval. A thin sample widens it until neither outer zone
 * can be reached, so a focused two-case change lands in range and carries a placement instead of
 * being discarded; and a sample that was never measured has no placement at all, which is the one
 * null the decision turns into its one "no difficulty evidence" answer.
 */
import { describe, expect, it } from "bun:test";
import {
  aimCounts,
  type BandZone,
  bandLandmarks,
  measureDifficulty,
  type Observation,
  placeOnBand,
} from "../src/claim/battery-difficulty.ts";
import { REPORTING_CONFIDENCE, REPORTING_Z, wilsonInterval } from "../src/claim/estimation.ts";
import { POLICY } from "../src/critic/policy.ts";
import { type ClimbBattery, countUnaccepted } from "../src/run/climb-history.ts";
import {
  type ClimbAction,
  type DifficultyDecision,
  decideDifficulty,
  renderBatteryContract,
} from "../src/run/climb-readout.ts";
import { SCOPE_CLAUSE } from "../src/author/builder-start-prompt.ts";
import { required } from "./helpers/doubles.ts";

const BAND: [number, number] = [0.2, 0.5];

/** The zone a decision placed its sample in, or the set-aside it recorded instead. Every placement
 *  carries one action, `placed`, because the zone is the reading and re-encoding five zones as
 *  three action names only lost the difference between a battery below the aim, one at the limit
 *  and one whose limit is not measured yet. */
const placedZone = (decision: DifficultyDecision): BandZone | ClimbAction =>
  decision.action === "placed" ? decision.placement.zone : decision.action;

function battery(overrides: Partial<ClimbBattery> & Pick<ClimbBattery, "n" | "passed">): ClimbBattery {
  return {
    runId: "run-001",
    batterySha256: "a".repeat(64),
    unaccepted: 0,
    measured: { items: [] },
    ...overrides,
  };
}

const continuation = (n: number) => renderBatteryContract(n, n, POLICY.climb.band, true);

const place = (passes: number, n: number, band: readonly [number, number] = BAND) =>
  required(placeOnBand(passes, n, band), `${passes} of ${n} has no placement`);

describe("placeOnBand — one count, one zone", () => {
  it("reads the registered 95% interval, and nothing else", () => {
    expect([REPORTING_CONFIDENCE, Number(REPORTING_Z.toFixed(2))]).toEqual([0.95, 1.96]);
    // 8/10 at 95% is the textbook interval, so the placement is reading Wilson and not an
    // approximation of it.
    expect([place(8, 10).lo, place(8, 10).hi].map((bound) => Number(bound.toFixed(4)))).toEqual([
      0.4902, 0.9433,
    ]);
    const { lower, upper } = required(wilsonInterval(8, 10), "the interval of 8 of 10");
    expect([place(8, 10).lo, place(8, 10).hi]).toEqual([lower, upper]);
  });

  it.each([
    [0, 0],
    [3, 2],
    [-1, 4],
    [1.5, 4],
  ])("has no placement for %s of %s — null, never a fabricated zone", (passes, n) => {
    // The same null the interval returns. An unmeasured battery must not read as "at the limit".
    expect(placeOnBand(passes, n, BAND)).toBeNull();
    expect(wilsonInterval(passes, n)).toBeNull();
  });

  it("has no placement for a battery too small to hold a whole count inside the band", () => {
    // aimCounts(1, [0.2, 0.5]) is [1, 0]: an empty range that read 0 of 1 as under-aim by one and
    // 1 of 1 as over-aim by one, so every count of a one-case battery was off the aim in both
    // directions and none could be on it. Campaign 3fd52f9e-28's last round measured one case.
    expect(aimCounts(1, BAND)).toEqual([1, 0]);
    expect([placeOnBand(0, 1, BAND), placeOnBand(1, 1, BAND)]).toEqual([null, null]);
    // The interval is fine; it is the band that has no whole count at this size. A band the size
    // admits places the same battery.
    expect(wilsonInterval(1, 1)).not.toBeNull();
    expect(place(1, 1, [0.2, 1]).zone).toBe("on-aim");
    // Two cases already hold one: the repair reaches exactly the size that could not be placed.
    expect(aimCounts(2, BAND)).toEqual([1, 1]);
  });

  it("gives an outer zone only to a significant sample, so a thin one lands in range", () => {
    // The 2026-09-18 defect: a Builder that changed two tasks and failed both of them was told
    // nothing, because a second case-count floor discarded the placement. Two of two is genuinely
    // uninformative — the interval says so by spanning the band — and "in range" is the honest
    // reading of it, not silence.
    expect([place(0, 2).zone, place(2, 2).zone]).toEqual(["under-aim", "over-aim"]);
    expect(place(0, 2).hi).toBeGreaterThan(BAND[0]);
    expect(place(2, 2).lo).toBeLessThan(BAND[1]);
    // Widening the same rates to a sample that can separate flips both to an outer zone.
    expect([place(0, 25).zone, place(25, 25).zone]).toEqual(["too-hard", "too-easy"]);
  });

  it("separates the aim from the edges and reports the distance to it", () => {
    expect([2, 4, 5, 12, 13, 17].map((k) => place(k, 25).zone)).toEqual([
      "under-aim",
      "under-aim",
      "on-aim",
      "on-aim",
      "over-aim",
      "over-aim",
    ]);
    expect([place(2, 25).toAim, place(12, 25).toAim, place(21, 25).toAim]).toEqual([3, 0, -9]);
    // 0.2 × 15 is 3.0000000000000004 in floating point; the aim still starts at 3.
    expect(aimCounts(15, BAND)).toEqual([3, 7]);
    expect(place(0, 15).aim).toEqual(aimCounts(15, BAND));
  });

  it("is the one numeric owner: every surface that names a count reads it from the battery size", () => {
    const [floor, ceiling] = POLICY.climb.band;
    const tooEasy = Array.from({ length: 26 }, (_, k) => k).find(
      (k) => place(k, 25, POLICY.climb.band).lo > ceiling,
    );
    const range = `${Math.ceil(floor * 25)} to ${Math.floor(ceiling * 25)}`;
    expect([tooEasy, range]).toEqual([18, "5 to 12"]);
    expect(bandLandmarks(25, POLICY.climb.band)).toEqual({
      tooHardUpTo: 1,
      aim: [5, 12],
      tooEasyFrom: 18,
      first: 3,
    });
    expect(continuation(25)).toContain(`Aim for ${range} of 25`);
    expect(continuation(25)).toContain(`passing ${tooEasy} of 25 or more`);
    // A continuation names the aim alone. The first-battery count is the fresh path's; stating it
    // on a continuation put "expect about 3 of 25" beside a readout reporting 24 of 25.
    expect(continuation(25)).not.toContain("verified cases to pass");
    expect(continuation(25)).not.toContain("the first battery above");
    expect(renderBatteryContract(25)).toContain("Expect about 3 of 25 verified cases to pass");
    expect(continuation(25)).toContain("it does not by itself answer a battery that found no limit");
    // 3fd52f9e-28 moved only published magnitudes for four batteries and stayed too easy, which
    // the exclusion list allowed: it named identifiers, labels, names and wording, not numbers.
    // Why the number appears here as a list item and not as its own sentence: SCOPE_CLAUSE owns
    // the mechanism ("re-tunes the published numbers ... leaves it nothing new to reconcile"),
    // and every continuation session reads it.
    expect(continuation(25)).toContain("longer wording or a re-tuned published number establishes neither");
    expect(SCOPE_CLAUSE.join(" ")).toContain(
      "re-tuning the published numbers of the requirements the tasks already had",
    );
    // A smaller battery restates every count from its own size, and nothing carries 25 in its text.
    expect(bandLandmarks(10, POLICY.climb.band)).toEqual({
      tooHardUpTo: null,
      aim: [2, 5],
      tooEasyFrom: 9,
      first: 1,
    });
    expect(renderBatteryContract(10)).toContain("about 1 of 10 verified cases to pass");
    expect(continuation(10)).toContain("Aim for 2 to 5 of 10");
    expect(continuation(10)).toContain("passing 9 of 10 or more");
    expect(SCOPE_CLAUSE.join(" ")).toContain(
      "the authoring context states the exact counts for this run's battery size",
    );
    expect(SCOPE_CLAUSE.join(" ")).not.toContain("of 25");
  });
});

describe("measureDifficulty — the per-item tally a battery records", () => {
  it("ranks items hardest-first, breaking a tie by name so the recorded order is stable", () => {
    const observations: Observation[] = [
      ...Array.from({ length: 10 }, () => ({ item: "easy", pass: true })),
      ...Array.from({ length: 10 }, () => ({ item: "hard", pass: false })),
      ...Array.from({ length: 12 }, (_, i) => ({ item: "mid", pass: i < 6 })),
      ...Array.from({ length: 12 }, (_, i) => ({ item: "also-mid", pass: i < 6 })),
    ];
    expect(measureDifficulty(observations).items).toEqual([
      { item: "hard", attempts: 10, passes: 0 },
      { item: "also-mid", attempts: 12, passes: 6 },
      { item: "mid", attempts: 12, passes: 6 },
      { item: "easy", attempts: 10, passes: 10 },
    ]);
  });

  it("records counts alone — every rate and interval is read back through the placement", () => {
    const measured = measureDifficulty([
      { item: "f", pass: true },
      { item: "f", pass: false },
    ]);
    expect(Object.keys(measured)).toEqual(["items"]);
    expect(Object.keys(required(measured.items[0], "the only item"))).toEqual(["item", "attempts", "passes"]);
  });
});

describe("decideDifficulty — the one decision over recorded batteries", () => {
  const INTERVALS: Array<[number, number, BandZone]> = [
    // 4/8 has a point rate of 0.5 and a floor near 0.22, so neither outer zone is reached; the aim
    // of a battery of 8 is 2 to 4, and the point count lands on its ceiling.
    [4, 8, "on-aim"],
    // Operator band 2026-09-16, 20 to 50 per cent: of 25, 17 is in range (floor 0.484) and 18 is
    // significantly too easy (0.524).
    [17, 25, "over-aim"],
    [18, 25, "too-easy"],
    // Three of three has a floor of 0.438, under the ceiling: it separates from nothing.
    [3, 3, "over-aim"],
    // 40/100 gives an interval near [0.31, 0.50], overlapping the band on both sides.
    [40, 100, "on-aim"],
    // 5/100 → hi ≈ 0.11 < 0.2: significantly too hard.
    [5, 100, "too-hard"],
    // 90/100 → lo ≈ 0.83 > 0.5: significantly too easy.
    [90, 100, "too-easy"],
  ];
  it.each(INTERVALS)("decides %s of %s by the interval, not the point rate: %s", (passed, n, zone) => {
    expect(placedZone(decideDifficulty([battery({ n, passed })]))).toBe(zone);
  });

  it("agrees with the placement on every count of a 25-case battery", () => {
    for (let passes = 0; passes <= 25; passes += 1) {
      const { zone } = place(passes, 25);
      expect(placedZone(decideDifficulty([battery({ n: 25, passed: passes })])), `${passes}/25`).toBe(zone);
    }
  });

  it("carries the placement, so the note words the same numbers the decision used", () => {
    const decision = decideDifficulty([battery({ runId: "run-x", n: 100, passed: 90 })]);
    if (decision.action !== "placed") throw new Error(`expected a placement, got ${decision.action}`);
    expect(decision.placement).toEqual(place(90, 100));
    // The full band, not the crossed bound alone: the rationale is the one channel that reaches the
    // author, and "too easy" without a lower edge invites overshooting into too hard.
    expect(decision.rationale).toContain("90/100");
    expect(decision.rationale).toContain("target range [0.2, 0.5]");
    expect(decision.evidence).toEqual([{ runId: "run-x", batterySha256: "a".repeat(64) }]);
  });

  it("names the range in both directions", () => {
    expect(decideDifficulty([battery({ n: 100, passed: 5 })]).rationale).toContain("significantly too hard");
    expect(decideDifficulty([battery({ n: 100, passed: 90 })]).rationale).toContain("significantly too easy");
    expect(decideDifficulty([battery({ n: 100, passed: 40 })]).rationale).toContain("limit");
  });

  it("lets only the latest battery decide, while earlier ones ride as evidence", () => {
    const decision = decideDifficulty([
      battery({ runId: "run-1", batterySha256: "b".repeat(64), n: 100, passed: 90 }),
      battery({ runId: "run-2", batterySha256: "c".repeat(64), n: 100, passed: 40 }),
    ]);
    expect(placedZone(decision)).toBe("on-aim");
    expect(decision.evidence.map((row) => row.runId)).toEqual(["run-1", "run-2"]);
  });

  it("is pure: the same inputs produce byte-identical decisions", () => {
    const input = [battery({ n: 100, passed: 40 })];
    expect(JSON.stringify(decideDifficulty(input))).toBe(JSON.stringify(decideDifficulty(input)));
  });

  const MISCONFIGURED: Array<[string, [number, number]]> = [
    ["an inverted band, which would make both direction predicates true", [0.8, 0.2]],
    ["a band that is not a number", [Number.NaN, 0.5]],
    ["a band outside [0, 1]", [0.2, 1.5]],
  ];
  it.each(MISCONFIGURED)("throws at construction on %s", (_description, configured) => {
    expect(() => decideDifficulty([battery({ n: 100, passed: 40 })], configured)).toThrow(TypeError);
  });
});

describe("decideDifficulty — the changed subset of a task-only experiment", () => {
  it("decides on the changed subset alone, which unchanged successes cannot dilute", () => {
    // 5 changed cases failed while 20 retained ones passed. The whole battery reads 20/25 and would
    // climb; the changed subset reads 0/5 and holds.
    const measured = { items: [], changedSubset: { attempts: 5, passes: 0 } };
    const decision = decideDifficulty([battery({ n: 25, passed: 20, measured })]);
    expect(placedZone(decision)).toBe("under-aim");
    expect(decision.rationale).toContain("0/5");
  });

  it("places a two-case subset rather than discarding it — the author still gets a measurement", () => {
    const decision = decideDifficulty([
      battery({ n: 6, passed: 4, measured: { items: [], changedSubset: { attempts: 2, passes: 0 } } }),
    ]);
    if (decision.action !== "placed") throw new Error(`expected a placement, got ${decision.action}`);
    expect(decision.placement).toEqual(place(0, 2));
    expect(decision.rationale).toContain("0/2");
  });

  it("reads the interval from the counts, so a recorded subset cannot disagree with itself", () => {
    const subset = { attempts: 8, passes: 8 };
    const decision = decideDifficulty([
      battery({ n: 28, passed: 28, measured: { items: [], changedSubset: subset } }),
    ]);
    if (decision.action !== "placed") throw new Error(`expected a placement, got ${decision.action}`);
    expect(decision.placement).toEqual(place(8, 8));
  });

  it("has no difficulty evidence when the subset was identified but measured nothing", () => {
    const decision = decideDifficulty([
      battery({ n: 25, passed: 20, measured: { items: [], changedSubset: { attempts: 0, passes: 0 } } }),
    ]);
    expect(decision.action).toBe("no-difficulty-evidence");
    // The deciding sample is the changed subset, and the 20 of 25 the whole battery scored cannot
    // stand in for it: the rationale names the sample that could not be placed.
    expect(decision.rationale).toContain("the deciding sample of 0/0");
  });
});

describe("decideDifficulty — an unaccepted attempt is a difficulty failure, not a missing case", () => {
  it("has no difficulty evidence on an empty history", () => {
    expect(decideDifficulty([])).toMatchObject({ action: "no-difficulty-evidence", evidence: [] });
  });

  it("carries no difficulty evidence when every attempt was refused at admission", () => {
    // The claude-med replay: 25 refusals evaluate nothing, so no rate and no difficulty strike.
    const decision = decideDifficulty([battery({ n: 25, passed: 0, unaccepted: 25 })]);
    expect(decision.action).toBe("no-difficulty-evidence");
    expect(decision.rationale).toContain("zero cases were truth-verified");
  });

  it("keeps unaccepted attempts in the denominator of a mixed battery — the F5 lesson stands", () => {
    // 60 admission refusals beside 40 verified rows: 5/100, significantly too hard, ease.
    const decision = decideDifficulty([battery({ n: 100, passed: 5, unaccepted: 60 })]);
    expect(placedZone(decision)).toBe("too-hard");
    expect(decision.rationale).toContain("5/100");
  });

  it("counts admission-refused rows through the one outcome owner", () => {
    expect(
      countUnaccepted([
        { pass: true, acceptedSubmit: true },
        { pass: false, acceptedSubmit: true },
        { pass: false, acceptedSubmit: false },
      ]),
    ).toBe(1);
  });
});

describe("decideDifficulty — a failing set that did not move", () => {
  // The run w6 shape: one recorded task set measured twice at 17/25, the same eight cases failing
  // both times. 68% sits inside the band, so the band selector holds the level and the run keeps
  // paying for the same eight failures.
  const stuck = (runId: string, failed: string[]) =>
    battery({
      runId,
      batterySha256: `sha-${runId}`,
      taskSetHash: "task-set-one",
      n: 12,
      passed: 4,
      failedTaskIds: failed,
    });
  const eight = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
  // The run w7 shape, which exact set equality could not refuse: three service cases failed in all
  // five batteries of one task set while the marginal cases rotated, giving failing sets of
  // 4, 4, 5, 5 and 3 — a frozen core in every adjacent pair and equal to none of them.
  const w7Core = ["service.tablet", "service.monitor", "service.router"];

  it("reports the repeat, its size and both denominators", () => {
    const decision = decideDifficulty([
      { ...stuck("r1", eight), passed: 17, n: 25 },
      { ...stuck("r2", eight.toReversed()), passed: 19, n: 25 },
    ]);
    expect(decision.action).toBe("repeated-failure-set");
    expect(decision.rationale).toContain("the same 8 case(s) failed");
    // One battery's rate is not the observation, and no task id reaches the Builder's advisory.
    expect(decision.rationale).toContain("17/25 then 19/25");
    for (const id of eight) expect(decision.rationale).not.toContain(id);
  });

  it.each([
    [
      "a core of four inside sets of different sizes",
      [...w7Core, "firmware.laptop-b"],
      [...w7Core, "firmware.laptop-b", "firmware.handheld-c"],
    ],
    ["a core that is exactly half the smaller set", ["a1", "a2", "b3", "b4"], ["a1", "a2", "c3", "c4"]],
    ["a shrinking core, which never reads as progress", eight, eight.slice(0, 5)],
  ])("refuses on %s", (_arrangement, before, now) => {
    expect(decideDifficulty([stuck("r1", before), stuck("r2", now)]).action).toBe("repeated-failure-set");
  });

  it("recognises the shared core in every adjacent pair of the w7 fixture", () => {
    const sets = [
      [...w7Core, "firmware.laptop-b"],
      [...w7Core, "firmware.laptop-b"],
      [...w7Core, "firmware.laptop-b", "firmware.handheld-c"],
      [...w7Core, "firmware.laptop-b", "build.tower-value"],
      [...w7Core],
    ];
    for (const [index, before] of sets.slice(0, -1).entries()) {
      const now = required(sets[index + 1], "the next failing set");
      expect(
        decideDifficulty([stuck(`r${index}`, before), stuck(`r${index + 1}`, now)]).action,
        `pair ${index} -> ${index + 1}`,
      ).toBe("repeated-failure-set");
    }
  });

  it.each([
    [
      "one shared case of eight, below the floor and the majority rule",
      ["a1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"],
    ],
    ["one shared case of four", ["a1", "b2", "b3", "b4"]],
    ["two shared of five, over the floor but under the majority rule", ["a1", "a2", "c3", "c4", "c5"]],
  ])("reads %s as a moved set, and decides by the interval instead", (_arrangement, now) => {
    const before =
      now.length === 5 ? ["a1", "a2", "b3", "b4", "b5"] : now.length === 4 ? ["a1", "a2", "a3", "a4"] : eight;
    expect(decideDifficulty([stuck("r1", before), stuck("r2", now)]).action).toBe("placed");
  });

  it.each([
    [
      "a freshly authored battery, which is a different task set",
      () => [stuck("r1", eight), { ...stuck("r2", eight), taskSetHash: "task-set-two" }],
    ],
    [
      "a battery recording no task-set identity — absence never reads as a match",
      () => [
        { ...stuck("r1", eight), taskSetHash: null },
        { ...stuck("r2", eight), taskSetHash: null },
      ],
    ],
    [
      "a failing set that could not be read",
      () => {
        const { failedTaskIds: _unreadable, ...first } = stuck("r1", eight);
        return [first, stuck("r2", eight)];
      },
    ],
    [
      "an older match that does not reach across a moved battery",
      () => [
        stuck("r1", eight),
        stuck("r2", ["a1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]),
        stuck("r3", eight),
      ],
    ],
  ])("matches nothing on %s", (_arrangement, history) => {
    expect(decideDifficulty(history()).action).toBe("placed");
  });

  it("keys on the task set, because two measurements of one set have different battery digests", () => {
    // batterySha256 digests each run's own battery.json, run id included. Keying on it would make
    // this refusal unreachable on recorded evidence, which is how it first shipped.
    expect(
      decideDifficulty([
        { ...stuck("r1", eight), batterySha256: "sha-run-1" },
        { ...stuck("r2", eight), batterySha256: "sha-run-2" },
      ]).action,
    ).toBe("repeated-failure-set");
  });

  it("is not fired by a perfect battery repeated — an empty failing set matches nothing", () => {
    const perfect = (runId: string) =>
      battery({
        runId,
        batterySha256: "sha-one-task-set",
        taskSetHash: "one",
        n: 25,
        passed: 25,
        failedTaskIds: [],
      });
    expect(placedZone(decideDifficulty([perfect("r1"), perfect("r2")]))).toBe("too-easy");
  });

  it("comes after the zero-verified refusal: a wall of admission refusals evaluates nothing to repeat", () => {
    const rejected = battery({
      runId: "r2",
      batterySha256: "sha-2",
      taskSetHash: "task-set-one",
      n: 25,
      passed: 0,
      unaccepted: 25,
      failedTaskIds: eight,
    });
    expect(decideDifficulty([stuck("r1", eight), rejected]).action).toBe("no-difficulty-evidence");
  });
});

describe("decideDifficulty — two families pulling the pooled rate apart", () => {
  const item = (family: string, passes: number, attempts: number) => ({ item: family, attempts, passes });
  const conflicted = (n: number, passed: number, attempts: number) =>
    battery({
      n,
      passed,
      measured: { items: [item("saturated", attempts, attempts), item("infeasible", 0, attempts)] },
    });

  it("reads one family entirely above the band beside one entirely below it as a conflict", () => {
    // The aggregate is 25/50 = 50%, comfortably inside the band: the point rate would hold the level
    // while one family never fails and another never passes.
    const decision = decideDifficulty([conflicted(50, 25, 25)]);
    expect(decision.action).toBe("family-conflict");
    expect(decision.rationale).toContain('"saturated"');
    expect(decision.rationale).toContain('"infeasible"');
    expect(decision.rationale).toContain("the families need separate changes");
  });

  it("reads each family through the same placement the battery uses", () => {
    // At n=3 even 3/3 has a floor near 0.44, inside the band on both sides: the widths already
    // encode the sample size, so no separate family floor is kept beside them.
    expect(place(3, 3).zone).not.toBe("too-easy");
    expect(decideDifficulty([conflicted(6, 3, 3)]).action).not.toBe("family-conflict");
    expect(place(25, 25).zone).toBe("too-easy");
    expect(place(0, 25).zone).toBe("too-hard");
  });

  it("never reads an unmeasured or blank family row as a conflict", () => {
    const rows = {
      items: [item("", 25, 25), item("empty", 0, 0), item("saturated", 25, 25), item("infeasible", 0, 25)],
    };
    expect(decideDifficulty([battery({ n: 50, passed: 25, measured: rows })]).action).toBe("family-conflict");
    const withoutTheHardOne = { items: rows.items.slice(0, 3) };
    expect(decideDifficulty([battery({ n: 50, passed: 25, measured: withoutTheHardOne })]).action).toBe(
      "placed",
    );
  });

  it("comes after the zero-verified refusal: no family rows without a verified case", () => {
    expect(decideDifficulty([{ ...conflicted(25, 0, 25), unaccepted: 25 }]).action).toBe(
      "no-difficulty-evidence",
    );
  });
});

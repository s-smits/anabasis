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
  placeOnBand,
} from "../src/claim/battery-difficulty.ts";
import { wilsonInterval } from "../src/claim/estimation.ts";
import { POLICY } from "../src/critic/policy.ts";
import { type ClimbBattery, countUnaccepted } from "../src/run/climb-history.ts";
import {
  type DifficultyDecision,
  decideDifficulty,
  renderBatteryContract,
} from "../src/run/climb-readout.ts";
import { SCOPE_CLAUSE } from "../src/author/builder-start-prompt.ts";
import { required } from "./helpers/doubles.ts";

const BAND: [number, number] = [0.2, 0.5];
const EIGHT = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
/** A frozen core of three failing in every battery while the marginal cases rotate: equal as a set
 *  to none of its neighbours, and the same few tasks failing throughout. */
const CORE = ["service.tablet", "service.monitor", "service.router"];

/** The zone a decision placed its sample in, or null where it placed it nowhere. */
const placedZone = (decision: DifficultyDecision): BandZone | null => decision.placement?.zone ?? null;

function battery(overrides: Partial<ClimbBattery> & Pick<ClimbBattery, "n" | "passed">): ClimbBattery {
  return {
    runId: "run-001",
    batterySha256: "a".repeat(64),
    unaccepted: 0,
    measured: { items: [] },
    ...overrides,
  };
}

/** A battery of one recorded task set, 4 of 12 passing, failing exactly these cases. */
const stuck = (runId: string, failed: string[]) =>
  battery({
    runId,
    batterySha256: `sha-${runId}`,
    taskSetHash: "task-set-one",
    n: 12,
    passed: 4,
    failedTaskIds: failed,
  });

const subset = (attempts: number, passes: number) => ({ items: [], changedSubset: { attempts, passes } });

const family = (item: string, passes: number, attempts: number) => ({ item, attempts, passes });

const continuation = (n: number) => renderBatteryContract(n, n, POLICY.climb.band, true);

const place = (passes: number, n: number, band: readonly [number, number] = BAND) =>
  required(placeOnBand(passes, n, band), `${passes} of ${n} has no placement`);

describe("placeOnBand — one count, one zone", () => {
  it("reads the Wilson interval itself, not an approximation of it", () => {
    // 8/10 at 95% is the textbook interval.
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
    // The same null the interval returns. An unmeasured battery must not read as "on the calibration target".
    expect(placeOnBand(passes, n, BAND)).toBeNull();
    expect(wilsonInterval(passes, n)).toBeNull();
  });

  it("has no placement for a battery too small to hold a whole count inside the band", () => {
    // An empty aim read 0 of 1 as under-aim by one and 1 of 1 as over-aim by one, so no count of a
    // one-case battery could be on it.
    expect(aimCounts(1, BAND)).toEqual([1, 0]);
    expect([placeOnBand(0, 1, BAND), placeOnBand(1, 1, BAND)]).toEqual([null, null]);
    // The interval is fine; it is the band that has no whole count at this size.
    expect(wilsonInterval(1, 1)).not.toBeNull();
    expect(place(1, 1, [0.2, 1]).zone).toBe("on-aim");
    expect(aimCounts(2, BAND)).toEqual([1, 1]);
  });

  it("gives an outer zone only to a significant sample, so a thin one lands in range", () => {
    // Two of two is genuinely uninformative — the interval spans the band — and "in range" is the
    // honest reading of it, not silence.
    expect([place(0, 2).zone, place(2, 2).zone]).toEqual(["under-aim", "over-aim"]);
    expect(place(0, 2).hi).toBeGreaterThan(BAND[0]);
    expect(place(2, 2).lo).toBeLessThan(BAND[1]);
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
    // A continuation names the aim alone; the first-battery count is the fresh path's.
    expect(continuation(25)).not.toContain("verified cases to pass");
    expect(continuation(25)).not.toContain("the first battery above");
    expect(renderBatteryContract(25)).toContain("Expect about 3 of 25 verified cases to pass");
    expect(continuation(25)).toContain("does not by itself answer a battery that found no limit");
    expect(continuation(25)).toContain(
      "a re-tuned published number is harder demand only where a witness of yours reaches it and a rehearsal shows your solver does not",
    );
    // A smaller battery restates every count from its own size.
    expect(bandLandmarks(10, POLICY.climb.band)).toEqual({
      tooHardUpTo: null,
      aim: [2, 5],
      tooEasyFrom: 9,
      first: 1,
    });
    expect(renderBatteryContract(10)).toContain("about 1 of 10 verified cases to pass");
    expect(continuation(10)).toContain("Aim for 2 to 5 of 10");
    expect(continuation(10)).toContain("passing 9 of 10 or more");
    // The system prompt states no count at all; the contract rendered for the round's size does.
    expect(SCOPE_CLAUSE.join(" ")).not.toMatch(/of 25|verified pass|battery/);
  });
});

describe("measureDifficulty — the per-item tally a battery records", () => {
  it("records counts alone, hardest item first, breaking a tie by name", () => {
    const observations = [
      ...Array.from({ length: 10 }, () => ({ item: "easy", pass: true })),
      ...Array.from({ length: 10 }, () => ({ item: "hard", pass: false })),
      ...Array.from({ length: 12 }, (_, i) => ({ item: "mid", pass: i < 6 })),
      ...Array.from({ length: 12 }, (_, i) => ({ item: "also-mid", pass: i < 6 })),
    ];
    // Strict: every rate and interval is read back through the placement, never stored beside it.
    expect(measureDifficulty(observations)).toStrictEqual({
      items: [
        { item: "hard", attempts: 10, passes: 0 },
        { item: "also-mid", attempts: 12, passes: 6 },
        { item: "mid", attempts: 12, passes: 6 },
        { item: "easy", attempts: 10, passes: 10 },
      ],
    });
  });
});

describe("decideDifficulty — the placement of the latest battery", () => {
  it.each<[number, number, BandZone]>([
    // 4/8: point rate 0.5, floor near 0.22, count on the aim's ceiling of 2 to 4.
    [4, 8, "on-aim"],
    // Of 25, 17 is in range (floor 0.484) and 18 is significantly too easy (0.524).
    [17, 25, "over-aim"],
    [18, 25, "too-easy"],
    // Three of three has a floor of 0.438, under the ceiling: it separates from nothing.
    [3, 3, "over-aim"],
    [40, 100, "on-aim"],
    [5, 100, "too-hard"],
    [90, 100, "too-easy"],
  ])("decides %s of %s by the interval, not the point rate: %s", (passed, n, zone) => {
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
    if (decision.placement === null) throw new Error(`expected a placement: ${decision.rationale}`);
    expect(decision.placement).toEqual(place(90, 100));
    // The full band, not the crossed bound alone: "too easy" without a lower edge invites
    // overshooting into too hard.
    expect(decision.rationale).toContain("90/100");
    expect(decision.rationale).toContain("target range [0.2, 0.5]");
    expect(decision.evidence).toEqual([{ runId: "run-x", batterySha256: "a".repeat(64) }]);
  });

  it.each([
    [5, "significantly too hard"],
    [90, "significantly too easy"],
    [40, "on the calibration target"],
  ])("words %s of 100 as %s", (passed, words) => {
    expect(decideDifficulty([battery({ n: 100, passed })]).rationale).toContain(words);
  });

  it("lets only the latest battery decide, while earlier ones ride as evidence", () => {
    const decision = decideDifficulty([
      battery({ runId: "run-1", batterySha256: "b".repeat(64), n: 100, passed: 90 }),
      battery({ runId: "run-2", batterySha256: "c".repeat(64), n: 100, passed: 40 }),
    ]);
    expect(placedZone(decision)).toBe("on-aim");
    expect(decision.evidence.map((row) => row.runId)).toEqual(["run-1", "run-2"]);
  });

  it.each<[string, ClimbBattery, BandZone, number, number]>([
    // 5 changed cases failed while 20 retained ones passed: the whole battery reads 20/25.
    [
      "unchanged successes cannot dilute it",
      battery({ n: 25, passed: 20, measured: subset(5, 0) }),
      "under-aim",
      0,
      5,
    ],
    [
      "a two-case subset is placed, not discarded",
      battery({ n: 6, passed: 4, measured: subset(2, 0) }),
      "under-aim",
      0,
      2,
    ],
    [
      "the interval is read from the counts",
      battery({ n: 28, passed: 28, measured: subset(8, 8) }),
      "too-easy",
      8,
      8,
    ],
  ])("decides a task-only experiment on its changed subset: %s", (_name, recorded, zone, passes, n) => {
    const decision = decideDifficulty([recorded]);
    if (decision.placement === null) throw new Error(`expected a placement: ${decision.rationale}`);
    expect(decision.placement).toEqual(place(passes, n));
    expect(decision.placement.zone).toBe(zone);
    expect(decision.rationale).toContain(`${passes}/${n}`);
  });
});

describe("decideDifficulty — the batteries placed nowhere", () => {
  it.each<[string, ClimbBattery[], string]>([
    ["an empty history", [], "no battery"],
    // The 20 of 25 the whole battery scored cannot stand in for a subset that measured nothing.
    [
      "a changed subset identified but never measured",
      [battery({ n: 25, passed: 20, measured: subset(0, 0) })],
      "the deciding sample of 0/0",
    ],
    [
      "every attempt refused at admission",
      [battery({ n: 25, passed: 0, unaccepted: 25 })],
      "zero cases were truth-verified",
    ],
    // A wall of admission refusals evaluates nothing to repeat and has no family rows.
    [
      "a refused wall after a stuck battery",
      [stuck("r1", EIGHT), { ...stuck("r2", EIGHT), n: 25, passed: 0, unaccepted: 25 }],
      "zero cases were truth-verified",
    ],
    [
      "a refused wall over conflicting families",
      [
        battery({
          n: 25,
          passed: 0,
          unaccepted: 25,
          measured: { items: [family("saturated", 25, 25), family("infeasible", 0, 25)] },
        }),
      ],
      "zero cases were truth-verified",
    ],
  ])("places nothing on %s", (_name, history, named) => {
    const decision = decideDifficulty(history);
    expect(decision.placement).toBeNull();
    // A wall of refusals evaluated nothing, so it states no repeat and no family conflict either.
    expect(decision).not.toHaveProperty("repeated");
    expect(decision).not.toHaveProperty("conflict");
    expect(decision.evidence).toHaveLength(history.length);
    expect(decision.rationale).toContain(named);
  });

  it("keeps unaccepted attempts in the denominator of a mixed battery", () => {
    // 60 admission refusals beside 40 verified rows: 5/100, significantly too hard.
    const decision = decideDifficulty([battery({ n: 100, passed: 5, unaccepted: 60 })]);
    expect(placedZone(decision)).toBe("too-hard");
    expect(decision.rationale).toContain("5/100");
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
  it("states the repeat, its size and both denominators beside the placement, and no task id", () => {
    const decision = decideDifficulty([
      { ...stuck("r1", EIGHT), passed: 17, n: 25 },
      { ...stuck("r2", EIGHT.toReversed()), passed: 19, n: 25 },
    ]);
    expect(decision.repeated).toEqual({ cases: 8, scores: ["17/25", "19/25"] });
    // The repeat is a fact beside the zone, never instead of it.
    expect(placedZone(decision)).toBe(place(19, 25).zone);
    for (const id of EIGHT) expect(JSON.stringify(decision)).not.toContain(`"${id}"`);
  });

  it.each<[string, string[], string[]]>([
    ["a core of four inside sets of different sizes", [...CORE, "fw.b"], [...CORE, "fw.b", "fw.c"]],
    ["a core that is exactly half the smaller set", ["a1", "a2", "b3", "b4"], ["a1", "a2", "c3", "c4"]],
    ["a shrinking core, which never reads as progress", EIGHT, EIGHT.slice(0, 5)],
    ["a rotating margin around one core", [...CORE, "fw.b", "fw.c"], [...CORE, "fw.b", "build.d"]],
    ["the core alone after a wider set", [...CORE, "fw.b", "build.d"], [...CORE]],
    ["an identical set", [...CORE, "fw.b"], [...CORE, "fw.b"]],
  ])("finds the core on %s", (_arrangement, before, now) => {
    expect(decideDifficulty([stuck("r1", before), stuck("r2", now)]).repeated).toBeDefined();
  });

  it("keys on the task set, because two measurements of one set have different battery digests", () => {
    // batterySha256 digests each run's own battery.json, run id included; keying on it would make
    // this refusal unreachable on recorded evidence.
    expect(
      decideDifficulty([
        { ...stuck("r1", EIGHT), batterySha256: "sha-run-1" },
        { ...stuck("r2", EIGHT), batterySha256: "sha-run-2" },
      ]).repeated,
    ).toBeDefined();
  });

  it.each<[string, () => ClimbBattery[]]>([
    [
      "one shared case of eight",
      () => [stuck("r1", EIGHT), stuck("r2", ["a1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"])],
    ],
    [
      "one shared case of four",
      () => [stuck("r1", ["a1", "a2", "a3", "a4"]), stuck("r2", ["a1", "b2", "b3", "b4"])],
    ],
    [
      "two shared of five, over the floor but under the majority rule",
      () => [stuck("r1", ["a1", "a2", "b3", "b4", "b5"]), stuck("r2", ["a1", "a2", "c3", "c4", "c5"])],
    ],
    [
      "a freshly authored battery",
      () => [stuck("r1", EIGHT), { ...stuck("r2", EIGHT), taskSetHash: "task-set-two" }],
    ],
    [
      "batteries recording no task-set identity",
      () => [
        { ...stuck("r1", EIGHT), taskSetHash: null },
        { ...stuck("r2", EIGHT), taskSetHash: null },
      ],
    ],
    [
      "a failing set that could not be read",
      () => {
        const { failedTaskIds: _unreadable, ...first } = stuck("r1", EIGHT);
        return [first, stuck("r2", EIGHT)];
      },
    ],
    [
      "an older match across a moved battery",
      () => [
        stuck("r1", EIGHT),
        stuck("r2", ["a1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]),
        stuck("r3", EIGHT),
      ],
    ],
  ])("matches nothing on %s", (_arrangement, history) => {
    const decision = decideDifficulty(history());
    expect(decision).not.toHaveProperty("repeated");
    expect(decision.placement).not.toBeNull();
  });

  it("is not fired by a perfect battery repeated — an empty failing set matches nothing", () => {
    const perfect = (runId: string) =>
      battery({ runId, batterySha256: "sha", taskSetHash: "one", n: 25, passed: 25, failedTaskIds: [] });
    expect(placedZone(decideDifficulty([perfect("r1"), perfect("r2")]))).toBe("too-easy");
  });
});

describe("decideDifficulty — two families pulling the pooled rate apart", () => {
  it("states one family entirely above the band beside one entirely below it as a conflict", () => {
    // 25/50 sits inside the band while one family never fails and another never passes. A blank or
    // unmeasured family row beside them is no party to the conflict.
    const items = [
      family("", 25, 25),
      family("empty", 0, 0),
      family("saturated", 25, 25),
      family("infeasible", 0, 25),
    ];
    const decision = decideDifficulty([battery({ n: 50, passed: 25, measured: { items } })]);
    expect(decision.conflict).toEqual({ easy: "saturated", hard: "infeasible" });
    expect(placedZone(decision)).toBe(place(25, 50).zone);
  });

  it.each([
    [
      "the hard family is absent",
      [family("", 25, 25), family("empty", 0, 0), family("saturated", 25, 25)],
      50,
      25,
    ],
    // At n=3 even 3/3 has a floor near 0.44: the widths already encode the sample size.
    ["each family is too thin to separate", [family("saturated", 3, 3), family("infeasible", 0, 3)], 6, 3],
  ])("states no conflict when %s", (_name, items, n, passed) => {
    const decision = decideDifficulty([battery({ n, passed, measured: { items } })]);
    expect(decision).not.toHaveProperty("conflict");
    expect(decision.placement).not.toBeNull();
  });
});

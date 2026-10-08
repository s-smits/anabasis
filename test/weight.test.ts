// The reviewers' weight in a round's reading, on pairs counted by hand: how many informative pairs
// hold a fail nobody ruled on, how many mistaken rulings would move the scored test, and the
// Referee's error beside them, measured where hand labels are given and unmeasured where not.
import { describe, expect, it } from "bun:test";
import type { Paired } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { agreement } from "../src/review/agreement.ts";
import type { Ruling } from "../src/review/referee.ts";
import { weight, weightLine } from "../src/review/weight.ts";

const LEVEL = 0.1;
const unmeasured = { level: LEVEL, measured: null };
const [P, F] = [true, false];
const at = "2026-10-08T00:00:00.000Z";
const ruling = (solve: string, ruled: Ruling): LogEvent => ({
  at,
  kind: "referee.finding",
  data: { solve, ruling: ruled },
});
/** A task the new harness wins, loses or ties on two solves a side, its solves named after it. */
const pair = (task: string, how: "win" | "loss" | "tie"): Paired => ({
  task,
  old: how === "win" ? [F, F] : [P, P],
  fresh: how === "loss" ? [P, F] : [P, P],
  solves: { old: [`${task}-o1`, `${task}-o2`], fresh: [`${task}-f1`, `${task}-f2`] },
});
const set = (wins: number, losses: number, ties: number) => [
  ...Array.from({ length: wins }, (_, index) => pair(`w${String(index)}`, "win")),
  ...Array.from({ length: losses }, (_, index) => pair(`l${String(index)}`, "loss")),
  ...Array.from({ length: ties }, (_, index) => pair(`t${String(index)}`, "tie")),
];
/** An earned ruling of every fail of `pairs`. */
const read = (pairs: readonly Paired[]) =>
  pairs.flatMap(({ old, fresh, solves }) => [
    ...old.flatMap((pass, index) => (pass ? [] : [ruling(solves?.old[index] ?? "", "earned")])),
    ...fresh.flatMap((pass, index) => (pass ? [] : [ruling(solves?.fresh[index] ?? "", "earned")])),
  ]);

describe("the reviewers' weight in a scored test", () => {
  it("counts the informative pairs that hold a fail no reviewer ruled on, under either harness", () => {
    const pairs = set(3, 1, 2);
    // No ruling in the log: every win and the loss rest on unread fails, and a tie on nothing.
    expect(weight([], pairs, unmeasured)).toMatchObject({ informative: 4, unread: 4 });
    expect(weight(read(pairs), pairs, unmeasured)).toMatchObject({ informative: 4, unread: 0 });
    // One of a win's two fails unread leaves the pair unexamined, whichever harness failed.
    const [, ...rest] = read(pairs);
    expect(weight(rest, pairs, unmeasured).unread).toBe(1);
    const mixed: Paired = {
      task: "m",
      old: [F, F],
      fresh: [P, F],
      solves: { old: ["m-o1", "m-o2"], fresh: ["m-f1", "m-f2"] },
    };
    const butOne = [ruling("m-o1", "earned"), ruling("m-o2", "earned")];
    expect(weight(butOne, [mixed], unmeasured)).toMatchObject({ informative: 1, unread: 1 });
    expect(weight([...butOne, ruling("m-f2", "unclear")], [mixed], unmeasured).unread).toBe(0);
    // Pairs that name no solve cannot be set against a ruling, and read as unread.
    expect(weight(read(pairs), [{ task: "n", old: [F], fresh: [P] }], unmeasured).unread).toBe(1);
  });

  it("says how many wins a test that clears can lose before it does not", () => {
    // 6-1 clears at 1 in 16, and 5-1 does not: one win on a mistaken ruling moves it.
    expect(weight([], set(6, 1, 0), unmeasured)).toMatchObject({ cleared: true, resting: 6, toMove: 1 });
    // 6-0 clears, and so do 5-0 and 4-0. 3-0 does not: three.
    expect(weight([], set(6, 0, 0), unmeasured)).toMatchObject({ cleared: true, resting: 6, toMove: 3 });
    expect(weight([], set(4, 0, 9), unmeasured)).toMatchObject({ cleared: true, resting: 4, toMove: 1 });
  });

  it("says how many losses a test that does not clear would have to lose, or that none would do", () => {
    // 5-1 is 7 in 64, and 5-0 clears: one loss.
    expect(weight([], set(5, 1, 0), unmeasured)).toMatchObject({ cleared: false, resting: 1, toMove: 1 });
    // 6-3 is 130 in 512 and 6-2 is 37 in 256, both short. 6-1 clears: two losses.
    expect(weight([], set(6, 3, 0), unmeasured)).toMatchObject({ cleared: false, resting: 3, toMove: 2 });
    // 3-2 with both losses gone is 3-0, which is under the least sweep.
    expect(weight([], set(3, 2, 5), unmeasured)).toMatchObject({ cleared: false, resting: 2, toMove: null });
    expect(weight([], set(0, 0, 4), unmeasured)).toMatchObject({ informative: 0, resting: 0, toMove: null });
  });

  it("says unmeasured, and nothing else, of an error no hand label measured", () => {
    const pairs = set(6, 1, 0);
    const none = weight(read(pairs), pairs, unmeasured);
    expect(none.error).toBe("unmeasured");
    expect(weightLine(none)).toBe(
      "0 of 7 informative pairs rest on a fail no reviewer read; the scored test clears its level, and 1 of its 6 wins resting on a mistaken ruling would move it; the Referee's error is unmeasured",
    );
    // Labels of fails the Referee ruled check defects alone measure no ruling that let a fail stand.
    const voided = [ruling("x1", "check-defect"), ruling("x2", "check-defect")];
    const labels = new Map<string, Ruling>([
      ["x1", "check-defect"],
      ["x2", "earned"],
    ]);
    expect(weight(read(pairs), pairs, { level: LEVEL, measured: agreement(voided, labels) }).error).toBe(
      "unmeasured",
    );
    const short = weight([], set(3, 2, 5), unmeasured);
    expect(weightLine(short)).toBe(
      "5 of 5 informative pairs rest on a fail no reviewer read; the scored test does not clear its level, and with every one of its 2 losses gone it would still not clear; the Referee's error is unmeasured",
    );
  });

  it("sets the measured error beside the count, with the bound its few labels leave", () => {
    // Twelve labelled fails. The Referee let ten stand, one of which a person labelled a check
    // defect, and ruled two check defects, which a person labelled so too.
    const rulings = [
      ...Array.from({ length: 10 }, (_, index) =>
        ruling(`k${String(index)}`, index < 9 ? "earned" : "unclear"),
      ),
      ruling("k10", "check-defect"),
      ruling("k11", "check-defect"),
    ];
    const labels = new Map<string, Ruling>([
      ...Array.from({ length: 9 }, (_, index) => [`k${String(index)}`, "earned"] as const),
      ["k9", "check-defect"],
      ["k10", "check-defect"],
      ["k11", "check-defect"],
    ]);
    const pairs = set(6, 1, 0);
    // One win's fails are unread: five of the six wins were ruled on in full.
    const events = [...rulings, ...read(pairs).slice(2)];
    const { error, unread } = weight(events, pairs, { level: LEVEL, measured: agreement(rulings, labels) });
    expect(unread).toBe(1);
    if (error === "unmeasured") throw new Error("the labels measure a standing ruling");
    expect(error).toMatchObject({ stood: 10, mistaken: 1, rate: 0.1, expected: 0.5 });
    // The bound is the rate at which one or none mistaken of ten is still one time in ten.
    const { atMost } = error;
    expect((1 - atMost) ** 10 + 10 * atMost * (1 - atMost) ** 9).toBeCloseTo(0.1, 10);
    expect(error.expectedAtMost).toBeCloseTo(5 * atMost, 12);
    expect(
      weightLine(weight(events, pairs, { level: LEVEL, measured: agreement(rulings, labels) })),
    ).toEndWith(
      "the Referee's error is 1 of 10 labelled fails it let stand, at most 34% at 90%: 0.5 such pairs expected, at most 1.7",
    );
    // A win with a fail the Referee ruled a check defect is read, and is the report's flagged
    // task: the rate is of rulings that let a fail stand, so four pairs are left to expect one under.
    const flagged = [...events, ruling("w1-o1", "check-defect")];
    const marked = weight(flagged, pairs, { level: LEVEL, measured: agreement(rulings, labels) });
    expect(marked).toMatchObject({ unread: 1, error: { expected: 0.4 } });
  });

  it("bounds an error nobody saw by how few labels looked for it", () => {
    const rulings = Array.from({ length: 12 }, (_, index) => ruling(`k${String(index)}`, "earned"));
    const labels = new Map<string, Ruling>(rulings.map((_, index) => [`k${String(index)}`, "earned"]));
    const { error } = weight([], set(4, 0, 0), { level: LEVEL, measured: agreement(rulings, labels) });
    if (error === "unmeasured") throw new Error("the labels measure a standing ruling");
    // None mistaken of twelve: the rate is nought, and at 90% it is under 1 - 0.1^(1/12), 17.5%.
    expect(error).toMatchObject({ stood: 12, mistaken: 0, rate: 0, expected: 0 });
    expect(error.atMost).toBeCloseTo(1 - 0.1 ** (1 / 12), 10);
  });
});

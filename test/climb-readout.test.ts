/**
 * One reading per recorded battery, and every rendering reads that same one. The reading is where a
 * battery's sample, its placement on the band and its declared target are settled, so most of what
 * is pinned below is what must not be settled quietly: a battery refused whole takes its own row
 * instead of being placed as too hard, a claim-refused battery stays in the table with its refusal
 * and counts inside the allowance, and every non-result counts in the prediction's favour before a
 * target is called missed.
 *
 * The rendering half is bounded rather than open-ended. It drops whole older rows and then the
 * family line to stay under its character ceiling, and says that it did; it leaves no placeholder
 * unfilled in any sentence it sends; and nothing protected reaches the text, so changing the failed
 * task ids changes nothing the Builder can read.
 */
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { describe, expect, it } from "bun:test";
import type {
  AdmittedClimbRow,
  ClimbBatteriesRead,
  ClimbBattery,
  ClimbEffort,
  FamilyEffort,
} from "../src/run/climb-history.ts";
import {
  CLIMB_READOUT_MAX_CHARS,
  type ClimbReadout,
  climbReadout,
  readoutHistoryDocuments,
  renderBatteryContract,
  renderReadout,
} from "../src/run/climb-readout.ts";
import { FRAME_REVISION, fill } from "../src/run/climb-readout-frame.ts";
import type { ExperimentAuthoring } from "../src/run/experiment-freeze.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isRecord } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { required } from "./helpers/doubles.ts";

const BAND: [number, number] = [0.2, 0.5];
const DOMAIN = "/nonexistent-domain";
const UNFILLED = /\{[A-Za-z]+\}/;

type Spec = {
  passed: number;
  n: number;
  unaccepted?: number;
  /** Recorded case rows, non-results included; `n` when absent. */
  slots?: number;
  changed?: { attempts: number; passes: number };
  families?: Array<{ item: string; attempts: number; passes: number }>;
  product?: string | null;
  refused?: string;
  target?: { comparator: "at-least" | "at-most"; verifiedPasses: number };
  failed?: string[];
  gap?: string;
  effort?: ClimbEffort;
  familyEffort?: FamilyEffort[];
  calibration?: AdmittedClimbRow["authoring"]["calibration"];
};

function authoring(target: NonNullable<Spec["target"]>, gap: string): ExperimentAuthoring {
  const proposal: ExperimentAuthoring["proposal"] = {
    scope: "tasks",
    gap,
    change: "harder spans",
    ...PLAN_FIELDS,
    expectedResult: "fewer passes",
    digest: "d",
    target,
  };
  return {
    proposal,
    operation: { operation: "task-probe", moved: ["tasks"] },
    baseline: { agentHash: "agent", correctnessModelHash: "model", taskSetHash: "tasks" },
    actual: "climb",
    changedTaskIds: [],
  };
}

/** One recorded battery; `index` orders the clock. */
function row(runId: string, index: number, spec: Spec): AdmittedClimbRow {
  const slots = spec.slots ?? spec.n;
  const measured: ClimbBattery["measured"] = {
    items: spec.families ?? [],
    ...keyIfDefined("changedSubset", spec.changed),
  };
  const battery: ClimbBattery = {
    runId,
    batterySha256: `sha-${runId}`,
    n: spec.n,
    passed: spec.passed,
    unaccepted: spec.unaccepted ?? 0,
    measured,
    taskSetHash: "tasks",
    ...keyIfDefined("failedTaskIds", spec.failed),
  };
  const recorded: AdmittedClimbRow["authoring"] = {
    taskSetHash: "tasks",
    caseIds: Array.from({ length: slots }, (_, i) => `task-${String(i)}`),
    familySummary: (spec.families ?? []).map((family) => ({
      family: family.item,
      attempts: family.attempts,
      passes: family.passes,
      wilson: [0, 1],
    })),
    effort: spec.effort ?? null,
    familyEffort: spec.familyEffort ?? [],
    calibration: spec.calibration ?? null,
    passedTaskIds: [],
    solveWallMinutes: 120,
  };
  if (spec.target !== undefined || spec.gap !== undefined) {
    recorded.experimentAuthoring = authoring(
      spec.target ?? { comparator: "at-least", verifiedPasses: 0 },
      spec.gap ?? "the limit is unmeasured",
    );
  }
  return {
    createdAt: `2026-09-21T${String(10 + index)}:00:00Z`,
    condition: { backendPin: "pin", thresholdManifestDigest: "digest-a", variant: "shipping" },
    battery,
    harnessId: spec.product === undefined ? "product-a" : spec.product,
    excludedReason: spec.refused ?? null,
    authoring: recorded,
  };
}

function historyOf(...rows: AdmittedClimbRow[]): ClimbBatteriesRead {
  return {
    history: rows,
    admitted: rows.filter((item) => item.excludedReason === null),
    excluded: rows.flatMap((item) =>
      item.excludedReason === null
        ? []
        : [{ runId: item.battery.runId, reason: item.excludedReason, claimRefused: true }],
    ),
  };
}

const readoutOf = (...rows: AdmittedClimbRow[]) => climbReadout(historyOf(...rows), BAND, () => null);
const render = (readout: ClimbReadout) => renderReadout(readout, "choose the next experiment");
/** One history document's text: the overview, or one battery's public tasks; "absent" when the
 *  source holds no such document. */
const history = (readout: ClimbReadout, rows: AdmittedClimbRow[], runId = "overview") => {
  const doc = readoutHistoryDocuments(DOMAIN, readout, rows).find((item) => item.id === `history/${runId}`);
  return doc === undefined || !("text" in doc) ? "absent" : doc.text();
};
/** The overview's JSON body, below its one-line note. */
const historyBody = (readout: ClimbReadout, rows: AdmittedClimbRow[]) => {
  const text = history(readout, rows);
  const body = capturedJsonParse(text.slice(text.indexOf("\n") + 1));
  return isRecord(body) ? body : {};
};

describe("one reading per battery", () => {
  it("reads a changed subset over its own sample in the table, the reading and the history", () => {
    // 20 retained tasks passed and the 5 changed ones failed: the subset decides, never 20 of 25.
    const subset = row("r1", 0, {
      passed: 20,
      n: 25,
      changed: { attempts: 5, passes: 0 },
      target: { comparator: "at-most", verifiedPasses: 4 },
    });
    const readout = readoutOf(subset);
    const text = render(readout);
    expect(text).toContain("| 0/5 changed-subset | under-aim | +1 | 1–2 |");
    expect(text).toContain("Reading: the deciding sample (changed-subset) passed 0 of 5");
    expect(text).not.toContain("passed 20 of 25");
    // The target is read over the whole battery's slots, which is what the author predicted.
    expect(text).toContain("at-most 4: missed by 16");
    const { rows } = historyBody(readout, [subset]);
    const [first] = Array.isArray(rows) ? rows : [];
    expect(first).toMatchObject({
      deciding: { population: "changed-subset", passes: 0, n: 5 },
      zone: "under-aim",
    });
  });

  it("sets a battery refused whole aside in its own row instead of placing it too hard", () => {
    const readout = readoutOf(
      row("r1", 0, { passed: 3, n: 10 }),
      row("r2", 1, { passed: 0, n: 25, unaccepted: 25 }),
    );
    expect(readout.rows.map((item) => [item.runId, item.zone, item.setAside])).toEqual([
      ["r2", null, "no-difficulty-evidence"],
      ["r1", "on-aim", null],
    ]);
    const text = render(readout);
    expect(text).toContain("| no-difficulty-evidence |");
    expect(text).not.toContain("| too-hard |");
    expect(text).toContain("Reading: all 25 attempts were refused at submission admission");
    // A set-aside round ends the allowance's run of misses.
    expect(readout.allowance).toBeNull();
  });

  it("keeps a claim-refused battery in the table with its refusal, and counts it inside the allowance", () => {
    const rows = [
      row("r1", 0, { passed: 25, n: 25 }),
      row("r2", 1, {
        passed: 9,
        n: 10,
        refused: "verifier environment unbound",
        target: { comparator: "at-most", verifiedPasses: 4 },
        effort: { cases: 10, turns: 4, minutes: 9, toolCalls: 40 },
      }),
      row("r3", 2, { passed: 11, n: 11, families: [{ item: "beams", attempts: 11, passes: 11 }] }),
    ];
    const readout = readoutOf(...rows);
    const refused = required(
      readout.rows.find((item) => item.runId === "r2"),
      "the refused row",
    );
    expect(refused).toMatchObject({
      passed: null,
      deciding: null,
      zone: null,
      setAside: null,
      families: null,
      effort: null,
      claimRefusal: "verifier environment unbound",
      target: { comparator: "at-most", verifiedPasses: 4, result: "unadmitted" },
    });
    expect(readout.allowance).toEqual({
      rounds: 3,
      placed: 2,
      refused: 1,
      side: "above",
      products: 1,
      sameSchema: 0,
    });
    const text = render(readout);
    expect(text).toContain("| claim refused: verifier environment unbound |");
    expect(text).toContain("Off-aim allowance: 3 of 3 consecutive rounds have ended above the aim");
    expect(text).toContain(
      "Families of the latest admitted battery (passes of attempts, Wilson interval): beams 11/11",
    );
    // The round states the allowance once. A session whose opening turn compaction cut reads the
    // same counts back here, because the rows cannot reconstruct them: this one spans two
    // placements and a refused claim.
    expect(historyBody(readout, rows).allowance).toEqual(readout.allowance);
    // A refused claim's passes are not evidence, so changing only them changes nothing sent.
    expect(text).toContain("| r3 | P1 | T1 | — | 11 | 11 | 0 | 0 | 11/11 whole-battery | too-easy |");
    expect(text).toContain("| r2 | P1 | T1 | task-probe | — | 10 | 0 | 0 | — | claim refused:");
    const other = [...rows];
    other[1] = row("r2", 1, {
      passed: 2,
      n: 10,
      changed: { attempts: 5, passes: 1 },
      refused: "verifier environment unbound",
      target: { comparator: "at-most", verifiedPasses: 4 },
    });
    const otherReadout = readoutOf(...other);
    expect(render(otherReadout)).toBe(text);
    expect(history(otherReadout, other)).toBe(history(readout, rows));
  });
});

describe("the declared target", () => {
  const read = (target: NonNullable<Spec["target"]>) =>
    readoutOf(row("r1", 0, { passed: 4, n: 8, slots: 10, target })).rows[0]?.target;

  // Four of eight verified passed and two slots ended as non-results: either could have passed, so
  // each counts in the prediction's favour before it is called missed.
  it.each<["at-least" | "at-most", number, Partial<NonNullable<ReturnType<typeof read>>>]>([
    ["at-least", 5, { result: "undetermined" }],
    ["at-least", 7, { result: "missed", missedBy: 1 }],
    ["at-least", 4, { result: "met" }],
    ["at-most", 5, { result: "undetermined" }],
    ["at-most", 6, { result: "met" }],
    ["at-most", 3, { result: "missed", missedBy: 1 }],
  ])("reads %s %s over 4 of 8 verified in 10 slots", (comparator, verifiedPasses, result) => {
    expect(read({ comparator, verifiedPasses })).toMatchObject(result);
  });

  it("says when the target itself lies outside the aim", () => {
    const text = render(
      readoutOf(row("r1", 0, { passed: 4, n: 25, target: { comparator: "at-least", verifiedPasses: 20 } })),
    );
    expect(text).toContain("That target, 20, lies above the aim of 5 to 12 of 25");
  });
});

describe("rendering", () => {
  it("renders only the boundary when nothing was measured", () => {
    expect(renderReadout(null, "build from the request")).toBe(
      "Controller authoring boundary: build from the request",
    );
  });

  it("drops whole older rows and then the family line to stay under its ceiling, and says so", () => {
    const families = Array.from({ length: 600 }, (_, i) => ({
      item: `family-${"x".repeat(30)}-${String(i)}`,
      attempts: 2,
      passes: 1,
    }));
    const rows = Array.from({ length: 5 }, (_, i) => row(`r${String(i)}`, i, { passed: 3, n: 10, families }));
    const text = render(readoutOf(...rows));
    expect(text.length).toBeLessThanOrEqual(CLIMB_READOUT_MAX_CHARS);
    expect(text).toContain("4 older row(s) are not shown here.");
    expect(text).not.toContain("Families of the latest admitted battery");
    // Whole rows only: every table line is complete.
    const lines = text.split("\n").filter((line) => line.startsWith("|"));
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.endsWith("|")).toBe(true);
    expect(text).toContain("| r4 |");
  });

  // Each recorded fact renders when the battery carries it and not otherwise, and none reads what
  // the solver spent as nearness to a limit, in either direction.
  it.each<[string, Partial<Spec>, string, string]>([
    [
      'every row\'s spend, with a measure no case recorded as "—"',
      { effort: { cases: 6, turns: 1, minutes: 14.8, toolCalls: null } },
      "| 1t 14.8m —c over 6 |",
      "m —c over",
    ],
    [
      "each family's effort against the solve wall, as a fact and never as difficulty",
      {
        familyEffort: [
          { family: "span", cases: 3, medianMinutes: 9, maxMinutes: 20, medianToolCalls: 14 },
          { family: "joint", cases: 2, medianMinutes: null, maxMinutes: null, medianToolCalls: 6 },
        ],
      },
      "Solve effort by family in the latest admitted battery, against its 120-minute solve wall: span 9 median and 20 most minutes, 14 median tool calls over 3 case(s); joint unrecorded median and unrecorded most minutes, 6 median tool calls over 2 case(s). Effort is what the solver spent and says nothing about difficulty",
      "Solve effort by family",
    ],
    [
      "the latest plan's predictions scored against its verdicts",
      { calibration: { scored: 5, brier: 0.21, expected: 1.4, observed: 3 } },
      "Predictions bound to r1: 5 scored task(s), 1.4 passes expected and 3 observed, Brier score 0.21",
      "Predictions bound to",
    ],
  ])("states %s", (_name, extra, sentence, marker) => {
    const text = render(readoutOf(row("r1", 0, { passed: 2, n: 5, ...extra })));
    expect(text).toContain(sentence);
    expect(text).not.toMatch(/near the wall|under a quarter|too fast|too slow/);
    expect(render(readoutOf(row("r1", 0, { passed: 2, n: 5 })))).not.toContain(marker);
  });

  it("says a battery passing every verified case found no limit and asks for a new move", () => {
    const allPass = render(readoutOf(row("r1", 0, { passed: 5, n: 5 })));
    expect(allPass).toContain(
      "The latest battery passed every one of its 5 verified cases, so it found no limit.",
    );
    expect(allPass).toContain("declare it per family as a new move in EXPERIMENT.json");
    // A re-tuned number or a longer list of named states is coverage, not a new move.
    expect(allPass).toContain(
      "A re-tuned published number, or a longer list of the states the tasks already name, is not one.",
    );
    expect(render(readoutOf(row("r1", 0, { passed: 4, n: 5 })))).not.toContain("found no limit.");
    // Refused attempts are not verified, so a battery passing every verified case is still all-pass.
    expect(render(readoutOf(row("r1", 0, { passed: 3, n: 5, unaccepted: 2 })))).toContain(
      "every one of its 3 verified cases",
    );
  });

  it("renders nothing protected: failed task ids never reach the text, and changing them changes nothing", () => {
    const a = row("r1", 0, { passed: 3, n: 10, failed: ["secret-alpha", "secret-beta"] });
    const b = row("r1", 0, { passed: 3, n: 10, failed: ["secret-gamma"] });
    const [readA, readB] = [readoutOf(a), readoutOf(b)];
    expect(render(readA)).toBe(render(readB));
    expect(history(readA, [a])).toBe(history(readB, [b]));
    for (const text of [render(readA), history(readA, [a])]) expect(text).not.toContain("secret-");
  });

  it("leaves no placeholder unfilled in any sentence it sends", () => {
    const rows = [
      row("r1", 0, { passed: 25, n: 25, gap: "g" }),
      row("r2", 1, { passed: 0, n: 5, unaccepted: 5 }),
      row("r3", 2, {
        passed: 9,
        n: 10,
        refused: "claim refused",
        target: { comparator: "at-least", verifiedPasses: 9 },
      }),
      row("r4", 3, {
        passed: 2,
        n: 10,
        families: [{ item: "beams", attempts: 10, passes: 2 }],
        target: { comparator: "at-most", verifiedPasses: 3 },
        effort: { cases: 10, turns: 4, minutes: 9, toolCalls: 40 },
      }),
    ];
    const readout = readoutOf(...rows);
    const texts = [
      render(readout),
      history(readout, rows),
      renderBatteryContract(25),
      renderBatteryContract(10, 5),
      renderBatteryContract(25, 25, BAND, true),
      renderBatteryContract(10, 5, [0.2, 0.95], true),
    ];
    for (const text of texts) expect(text).not.toMatch(UNFILLED);
    // A target every outcome meets is no prediction, and neither is one the rehearsals contradict.
    expect(renderBatteryContract(25, 25, BAND, true)).toContain(
      "A target every outcome meets predicts nothing",
    );
  });

  it("carries a declared band into the reading, the contract and the history", () => {
    const declared: [number, number] = [0.6, 0.9];
    const battery = row("r1", 0, { passed: 4, n: 5 });
    const readout = climbReadout(historyOf(battery), declared, () => null);
    expect(readout.decision).toMatchObject({ action: "placed", placement: { zone: "on-aim", aim: [3, 4] } });
    const text = render(readout);
    expect(text).toContain("target range [0.6, 0.9], aim 3 to 4 of 5): at the limit.");
    expect(renderBatteryContract(5, 5, declared, true)).toContain("Aim for 3 to 4 of 5");
    expect(historyBody(readout, [battery]).band).toEqual(declared);
  });

  it("states in every contract that the solver has walls the reference does not", () => {
    const contracts = [
      renderBatteryContract(25),
      renderBatteryContract(10, 5),
      renderBatteryContract(25, 25, BAND, true),
      renderBatteryContract(10, 5, BAND, true),
    ];
    for (const contract of contracts) {
      expect(contract).toContain("every .toolchain binary in its shell, under the walls agent/config.yaml");
      expect(contract).toContain("the reference solve is held to none of them");
      expect(contract).toContain("only if the solver cannot run that search inside its walls");
      expect(contract).not.toContain("cannot reach");
    }
  });
});

describe("the history page", () => {
  const rows = [row("r1", 0, { passed: 3, n: 10 }), row("r2", 1, { passed: 5, n: 10 })];
  const readout = readoutOf(...rows);

  it("lists rows and batteries newest first", () => {
    const text = history(readout, rows);
    expect(text.indexOf('"runId": "r2"')).toBeLessThan(text.indexOf('"runId": "r1"'));
    expect(readoutHistoryDocuments(DOMAIN, readout, rows).map((doc) => doc.id)).toEqual([
      "history/overview",
      "history/r2",
      "history/r1",
    ]);
  });

  it("holds no document for a runId it has no history for, and says why a battery cannot be read", () => {
    expect(history(readout, rows, "r9")).toBe("absent");
    expect(history(readout, rows, "r2")).toContain("No public task of r2 can be vouched for");
  });
});

describe("the frame", () => {
  it("fills a sentence exactly, and refuses a missing or an unasked value", () => {
    expect(fill("{a} of {b}", { a: 1, b: 2 })).toBe("1 of 2");
    expect(() => fill("{a} of {b}", { a: 1 })).toThrow("{b} has no value");
    expect(() => fill("{a}", { a: 1, c: 3 })).toThrow("no {c} placeholder");
    expect(FRAME_REVISION).toMatch(/^[a-f0-9]{64}$/);
  });
});

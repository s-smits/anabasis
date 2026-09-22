/** The climb readout: one decision per recorded battery, and every rendering reads it. */
import { describe, expect, it } from "bun:test";
import type {
  AdmittedClimbRow,
  ClimbBatteriesRead,
  ClimbBattery,
  ClimbEffort,
} from "../src/run/climb-history.ts";
import {
  CLIMB_READOUT_MAX_CHARS,
  type ClimbReadout,
  allowanceStop,
  climbReadout,
  readReadoutHistory,
  renderBatteryContract,
  renderReadout,
} from "../src/run/climb-readout.ts";
import { FRAME_REVISION, fill } from "../src/run/climb-readout-frame.ts";
import type { ExperimentAuthoring } from "../src/run/experiment-freeze.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isRecord, isString } from "../src/meta/json-shape.ts";
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
};

function authoring(target: NonNullable<Spec["target"]>, gap: string): ExperimentAuthoring {
  const proposal: ExperimentAuthoring["proposal"] = {
    scope: "tasks",
    gap,
    change: "harder spans",
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
const history = (readout: ClimbReadout, rows: AdmittedClimbRow[], runId?: string) =>
  readReadoutHistory(DOMAIN, readout, rows, { runId });

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
    const page = history(readout, [subset]);
    expect(page).toContain(String.raw`\"deciding\":{\"population\":\"changed-subset\",\"passes\":0,\"n\":5}`);
    expect(page).toContain(String.raw`\"zone\":\"under-aim\"`);
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
    expect(allowanceStop(readout)).toContain(
      "3 consecutive rounds ended above the aim or with a refused claim",
    );
    // The round states the allowance once. A session whose opening turn compaction cut reads the
    // same counts back here, because the rows cannot reconstruct them: this one spans two
    // placements and a refused claim.
    const page = capturedJsonParse(history(readout, rows));
    const body = capturedJsonParse(isRecord(page) && isString(page.text) ? page.text : "{}");
    expect(isRecord(body) ? body.allowance : null).toEqual(readout.allowance);
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

  it("counts every non-result in the prediction's favour before calling it missed", () => {
    // Four of eight verified passed and two slots ended as non-results: either could have passed.
    expect(read({ comparator: "at-least", verifiedPasses: 5 })).toMatchObject({ result: "undetermined" });
    expect(read({ comparator: "at-least", verifiedPasses: 7 })).toMatchObject({
      result: "missed",
      missedBy: 1,
    });
    expect(read({ comparator: "at-least", verifiedPasses: 4 })).toMatchObject({ result: "met" });
    expect(read({ comparator: "at-most", verifiedPasses: 5 })).toMatchObject({ result: "undetermined" });
    expect(read({ comparator: "at-most", verifiedPasses: 6 })).toMatchObject({ result: "met" });
    expect(read({ comparator: "at-most", verifiedPasses: 3 })).toMatchObject({
      result: "missed",
      missedBy: 1,
    });
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

  it('gives every row\'s table line what the solver spent, and a measure no case recorded as "?"', () => {
    // Run 1aa6e6's battery: 6 of 6, no case past 1 turn of the 24 its config declares or 15
    // minutes of the 120. The pass count alone reads the same as a battery that used every wall.
    const effort: ClimbEffort = { cases: 6, turns: 1, minutes: 14.8, toolCalls: null };
    const text = render(readoutOf(row("r1", 0, { passed: 6, n: 6, effort })));

    expect(text).toContain("| 1t 14.8m —c over 6 |");
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
  });

  it("carries a declared band into the reading, the contract and the history", () => {
    const declared: [number, number] = [0.6, 0.9];
    const battery = row("r1", 0, { passed: 4, n: 5 });
    const readout = climbReadout(historyOf(battery), declared, () => null);
    expect(readout.decision).toMatchObject({ action: "placed", placement: { zone: "on-aim", aim: [3, 4] } });
    const text = render(readout);
    expect(text).toContain("target range [0.6, 0.9], aim 3 to 4 of 5): at the limit.");
    expect(renderBatteryContract(5, 5, declared, true)).toContain("Aim for 3 to 4 of 5");
    const page = capturedJsonParse(history(readout, [battery]));
    const body = isRecord(page) && isString(page.text) ? capturedJsonParse(page.text) : null;
    expect(isRecord(body) ? body.band : null).toEqual(declared);
  });
});

describe("the history page", () => {
  const rows = [row("r1", 0, { passed: 3, n: 10 }), row("r2", 1, { passed: 5, n: 10 })];
  const readout = readoutOf(...rows);

  it("lists rows newest first, and pages by character", () => {
    const page = capturedJsonParse(history(readout, rows));
    const text = isRecord(page) && isString(page.text) ? page.text : "";
    expect(text.indexOf('"runId":"r2"')).toBeLessThan(text.indexOf('"runId":"r1"'));
    const first = capturedJsonParse(readReadoutHistory(DOMAIN, readout, rows, { limit: 40 }));
    expect(first).toMatchObject({ from: 1, to: 40, more: true });
  });

  it("refuses a runId it holds no history for", () => {
    expect(history(readout, rows, "r9")).toContain("No verified history is bound to this runId.");
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

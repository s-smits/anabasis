/**
 * One reading per recorded battery, and every rendering reads that same one. The reading is where a
 * battery's sample and its placement on the band are settled, so most of what is pinned below is
 * what must not be settled quietly: a battery refused whole is placed nowhere instead of as too
 * hard, a repeated failing core stays a recorded fact beside its zone, and a claim-refused battery
 * stays in the table with its refusal.
 *
 * The rendering is counts and placements only: the newest rows, the reading, the families, where
 * the passing artifacts are and the one sentence that a witness proves feasibility and not
 * difficulty. Nothing protected reaches it, so changing the failed task ids changes nothing the
 * Builder can read.
 */
import { describe, expect, it } from "bun:test";
import type {
  AdmittedClimbRow,
  ClimbBatteriesRead,
  ClimbBattery,
  ClimbEffort,
  FamilyEffort,
} from "../src/run/climb-history.ts";
import {
  type ClimbReadout,
  climbReadout,
  readoutHistoryDocuments,
  renderBatteryContract,
  renderReadout,
} from "../src/run/climb-readout.ts";
import type { ExperimentAuthoring } from "../src/run/experiment-freeze.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isRecord } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { required } from "./helpers/doubles.ts";

const BAND: [number, number] = [0.2, 0.5];
const DOMAIN = "/nonexistent-domain";

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
  failed?: string[];
  gap?: string;
  effort?: ClimbEffort;
  familyEffort?: FamilyEffort[];
  wall?: number;
  wallBound?: number;
  agent?: string | null;
};

function authoring(gap: string): ExperimentAuthoring {
  return {
    plan: {
      gap,
      change: "harder spans",
      families: ["uppercase"],
      expectedPasses: { atMost: 2 },
      digest: "d",
    },
    changedFamilies: ["uppercase"],
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
    passedTaskIds: [],
    solveWallMinutes: spec.wall ?? 120,
    wallBound: spec.wallBound ?? 0,
    agentHash: spec.agent === undefined ? "agent-a" : spec.agent,
  };
  if (spec.gap !== undefined) recorded.experimentAuthoring = authoring(spec.gap);
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

const readoutOf = (...rows: AdmittedClimbRow[]) => climbReadout(historyOf(...rows), BAND);
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
    });
    const readout = readoutOf(subset);
    const text = render(readout);
    expect(text).toContain("| 0/5 changed-subset | under-aim | 1–2 |");
    expect(text).toContain("Reading: the deciding sample (changed-subset) passed 0 of 5");
    expect(text).not.toContain("passed 20 of 25");
    const { rows } = historyBody(readout, [subset]);
    const [first] = Array.isArray(rows) ? rows : [];
    expect(first).toMatchObject({
      deciding: { population: "changed-subset", passes: 0, n: 5 },
      zone: "under-aim",
    });
  });

  it("places a battery refused whole nowhere instead of placing it too hard", () => {
    const readout = readoutOf(
      row("r1", 0, { passed: 3, n: 10 }),
      row("r2", 1, { passed: 0, n: 25, unaccepted: 25 }),
    );
    expect(readout.rows.map((item) => [item.runId, item.zone])).toEqual([
      ["r2", null],
      ["r1", "on-aim"],
    ]);
    const text = render(readout);
    expect(text).toContain("| unplaced |");
    expect(text).not.toContain("| too-hard |");
    expect(text).toContain("Reading: all 25 attempts refused at submission, none truth-verified.");
  });

  it("keeps a repeated failing core as a fact beside the zone, and never names its tasks", () => {
    const failed = ["core-a", "core-b"];
    const readout = readoutOf(
      row("r1", 0, { passed: 8, n: 10, failed }),
      row("r2", 1, { passed: 8, n: 10, failed }),
    );
    expect(readout.decision).toMatchObject({
      placement: { zone: "over-aim" },
      repeated: { cases: 2, scores: ["8/10", "8/10"] },
    });
    const text = render(readout);
    expect(text).toContain("| over-aim |");
    expect(text).not.toContain("core-a");
  });

  it("keeps a claim-refused battery in the table with its refusal", () => {
    const rows = [
      row("r1", 0, { passed: 25, n: 25 }),
      row("r2", 1, {
        passed: 9,
        n: 10,
        refused: "verifier environment unbound",
        gap: "the limit is unmeasured",
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
      families: null,
      effort: null,
      claimRefusal: "verifier environment unbound",
    });
    const text = render(readout);
    expect(text).toContain(
      "Families of the latest admitted battery (passes of attempts, Wilson interval): beams 11/11",
    );
    // A refused claim's passes are not evidence, so changing only them changes nothing sent.
    expect(text).toContain("| r3 | P1 | T1 | — | 11 | 11 | 0 | 0 | 11/11 whole-battery | too-easy |");
    expect(text).toContain(
      "| r2 | P1 | T1 | task-probe | — | 10 | 0 | 0 | — | claim refused: verifier environment unbound | — |",
    );
    const other = [...rows];
    other[1] = row("r2", 1, {
      passed: 2,
      n: 10,
      changed: { attempts: 5, passes: 1 },
      refused: "verifier environment unbound",
      gap: "the limit is unmeasured",
    });
    const otherReadout = readoutOf(...other);
    expect(render(otherReadout)).toBe(text);
    expect(history(otherReadout, other)).toBe(history(readout, rows));
  });
});

describe("rendering", () => {
  it("renders only the boundary when nothing was measured", () => {
    expect(renderReadout(null, "build from the request")).toBe(
      "Controller authoring boundary: build from the request",
    );
  });

  it("shows the newest three rows whole and counts the rest", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`r${String(i)}`, i, { passed: 3, n: 10 }));
    const text = render(readoutOf(...rows));
    expect(text).toContain("2 older rows are not shown here.");
    const lines = text.split("\n").filter((line) => /^\| r\d/.test(line));
    expect(lines.map((line) => line.split(" | ")[0])).toEqual(["| r4", "| r3", "| r2"]);
    expect(render(readoutOf(...rows.slice(0, 4)))).toContain("1 older row is not shown here.");
  });

  it("points at the latest battery's passing artifacts, and states that a witness proves feasibility", () => {
    const text = render(readoutOf(row("r1", 0, { passed: 6, n: 6 })));
    expect(text).toContain(
      "Battery r1 passed 6 cases; each passing solve and the artifact it submitted is at traces/r1/<taskId>/artifact.",
    );
    expect(text).toContain("it proves a task feasible, never difficult");
    expect(render(readoutOf(row("r1", 0, { passed: 0, n: 6 })))).not.toContain("traces/r1");
  });

  it("states no course: no streak, target, prediction, ladder or move", () => {
    for (const passed of [0, 2, 5]) {
      const text = [render(readoutOf(row("r1", 0, { passed, n: 5, gap: "g" }))), renderBatteryContract(5)]
        .join("\n")
        .replace(/\s+/g, " ");
      expect(text).not.toMatch(/streak|EXPERIMENT\.json|predict|ladder|new move|comparator/i);
    }
  });

  it("renders nothing protected: failed task ids never reach the text, and changing them changes nothing", () => {
    const a = row("r1", 0, { passed: 3, n: 10, failed: ["secret-alpha", "secret-beta"] });
    const b = row("r1", 0, { passed: 3, n: 10, failed: ["secret-gamma"] });
    const [readA, readB] = [readoutOf(a), readoutOf(b)];
    expect(render(readA)).toBe(render(readB));
    expect(history(readA, [a])).toBe(history(readB, [b]));
    for (const text of [render(readA), history(readA, [a])]) expect(text).not.toContain("secret-");
  });

  it("states the aim per size across a probe range, and what finds no limit", () => {
    const contract = renderBatteryContract(10, 5);
    expect(contract).toContain("5 tasks: aim 1 to 2 passing");
    expect(contract).toContain("10 tasks: aim");
    expect(contract).toContain("it proves a task feasible, never difficult");
    expect(renderBatteryContract(25)).not.toContain("24 tasks");
  });

  it("carries a declared band into the reading, the contract and the history", () => {
    const declared: [number, number] = [0.6, 0.9];
    const battery = row("r1", 0, { passed: 4, n: 5 });
    const readout = climbReadout(historyOf(battery), declared);
    expect(readout.decision).toMatchObject({ placement: { zone: "on-aim", aim: [3, 4] } });
    const text = render(readout);
    expect(text).toContain("band [0.6, 0.9], aim 3 to 4 of 5): on the calibration target.");
    expect(renderBatteryContract(5, 5, declared)).toContain("5 tasks: aim 3 to 4 passing");
    expect(historyBody(readout, [battery]).band).toEqual(declared);
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

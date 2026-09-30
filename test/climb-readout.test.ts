/**
 * One reading per recorded battery, and every rendering reads that same one. The controller settles
 * each battery's sample and its placement on the band, so what is pinned below is first what must
 * not be settled quietly: a battery refused whole is placed nowhere instead of as too hard, a
 * repeated failing core stays a recorded fact beside its zone, and a claim-refused battery keeps a
 * row carrying its refusal.
 *
 * The author reads measured facts and no placement: per battery the verified, unaccepted and
 * non-result counts kept apart, the solves regraded from an earlier battery apart from the fresh
 * ones, and the product, task-set and scoring identities that say whether two batteries share a
 * condition. No count to author towards reaches it at any size. What it is told about a limit is a
 * necessary condition and never a sufficient one: a battery that passes some but not all of its
 * cases can locate a limit only where the checks that failed it are right, since a checker that
 * refuses a valid answer produces the same partial count. Nothing protected reaches the text, so
 * changing the failed task ids changes nothing the Builder can read.
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
import { EXPERIMENT_AUTHORING_SCHEMA, type ExperimentAuthoring } from "../src/run/experiment-freeze.ts";
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
  scoring?: string | null;
  regrade?: { of: string; reused: number };
  refused?: string;
  failed?: string[];
  /** Recorded as a task probe. */
  probe?: true;
  effort?: ClimbEffort;
  familyEffort?: FamilyEffort[];
  wall?: number;
  wallBound?: number;
  /** Verified cases a completed review settled against their check, among `slots` but not `n`. */
  settled?: number;
};

/** The exclusion reason `admitBattery` records for a refused claim. It opens with its own "claim
 *  refused", so the battery line must not say it twice. */
const REFUSED =
  "claim refused: verifier environment unbound — a battery that created no claim is not climb evidence";

function authoring(): ExperimentAuthoring {
  return {
    schema: EXPERIMENT_AUTHORING_SCHEMA,
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
    ...keyIfDefined("settledAgainst", spec.settled),
  };
  const recorded: AdmittedClimbRow["authoring"] = {
    taskSetHash: "tasks",
    scoringHash: spec.scoring === undefined ? "scoring-a" : spec.scoring,
    regrade: spec.regrade ?? null,
    caseIds: Array.from({ length: slots }, (_, i) => `task-${String(i)}`),
    familySummary: (spec.families ?? []).map((family) => ({
      family: family.item,
      attempts: family.attempts,
      passes: family.passes,
    })),
    effort: spec.effort ?? null,
    familyEffort: spec.familyEffort ?? [],
    passedTaskIds: [],
    solveWallMinutes: spec.wall ?? 120,
    wallBound: spec.wallBound ?? 0,
  };
  if (spec.probe === true) recorded.experimentAuthoring = authoring();
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
/** The rendered line of one battery, or "absent". */
const lineOf = (text: string, runId: string) =>
  text.split("\n").find((line) => line.startsWith(`- ${runId} `)) ?? "absent";
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
  it("states a changed subset's own sample beside the whole battery, and keeps the zone for the controller", () => {
    const subset = row("r1", 0, { passed: 20, n: 25, changed: { attempts: 5, passes: 0 } });
    const readout = readoutOf(subset);
    // The controller still places the battery over the subset, never over 20 of 25.
    expect(readout.rows[0]).toMatchObject({
      deciding: { population: "changed-subset", passes: 0, n: 5 },
      zone: "under-aim",
    });
    expect(lineOf(render(readout), "r1")).toBe(
      "- r1 (P1, T1, S1): 20 passed of 25 verified, 0 unaccepted, 0 non-results; the changed tasks passed 0 of 5 attempts.",
    );
    const { rows } = historyBody(readout, [subset]);
    const [first] = Array.isArray(rows) ? rows : [];
    expect(first).toMatchObject({ deciding: { population: "changed-subset", passes: 0, n: 5 } });
    expect(first).not.toHaveProperty("zone");
  });

  it("places a battery refused whole nowhere, and states that none of it was verified", () => {
    const readout = readoutOf(
      row("r1", 0, { passed: 3, n: 10 }),
      row("r2", 1, { passed: 0, n: 25, unaccepted: 25 }),
    );
    expect(readout.rows.map((item) => [item.runId, item.zone])).toEqual([
      ["r2", null],
      ["r1", "on-aim"],
    ]);
    expect(readout.decision.refused).toBe(25);
    expect(lineOf(render(readout), "r2")).toBe(
      "- r2 (P1, T1, S1): 0 passed of 0 verified, 25 unaccepted, 0 non-results.",
    );
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
    expect(render(readout)).not.toContain("core-a");
  });

  it("keeps a claim-refused battery as a row carrying its refusal", () => {
    const rows = [
      row("r1", 0, { passed: 25, n: 25 }),
      row("r2", 1, {
        passed: 9,
        n: 10,
        refused: REFUSED,
        probe: true,
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
      claimRefusal: REFUSED,
    });
    const text = render(readout);
    expect(text).toContain("Families of the latest admitted battery (passes of attempts): beams 11/11.");
    expect(lineOf(text, "r3")).toBe(
      "- r3 (P1, T1, S1): 11 passed of 11 verified, 0 unaccepted, 0 non-results.",
    );
    expect(lineOf(text, "r2")).toBe(
      `- r2 (P1, T1, S1, task-probe): ${REFUSED}; 10 verified, 0 unaccepted, 0 non-results.`,
    );
    expect(text).not.toContain("claim refused: claim refused");
    // A refused claim's passes are not evidence, so changing only them changes nothing sent.
    const other = [...rows];
    other[1] = row("r2", 1, {
      passed: 2,
      n: 10,
      changed: { attempts: 5, passes: 1 },
      refused: REFUSED,
      probe: true,
    });
    const otherReadout = readoutOf(...other);
    expect(render(otherReadout)).toBe(text);
    expect(history(otherReadout, other)).toBe(history(readout, rows));
  });
});

describe("the measured facts the author reads", () => {
  it("keeps six verified fails, six unaccepted attempts and six non-results apart", () => {
    const lines = [
      { passed: 0, n: 6 },
      { passed: 0, n: 6, unaccepted: 6 },
      { passed: 0, n: 6, unaccepted: 6, wallBound: 4 },
      { passed: 0, n: 0, slots: 6 },
    ].map((spec) => lineOf(render(readoutOf(row("r1", 0, spec))), "r1"));
    expect(lines).toEqual([
      "- r1 (P1, T1, S1): 0 passed of 6 verified, 0 unaccepted, 0 non-results.",
      "- r1 (P1, T1, S1): 0 passed of 0 verified, 6 unaccepted, 0 non-results.",
      "- r1 (P1, T1, S1): 0 passed of 0 verified, 6 unaccepted (4 ran to the 120-minute solve wall), 0 non-results.",
      "- r1 (P1, T1, S1): 0 passed of 0 verified, 0 unaccepted, 6 non-results.",
    ]);
  });

  it("counts the cases settled against their check apart, neither verified nor a non-result", () => {
    const lines = [
      { passed: 2, n: 2, slots: 6, settled: 4 },
      { passed: 1, n: 5, slots: 7, settled: 1 },
    ].map((spec) => lineOf(render(readoutOf(row("r1", 0, spec))), "r1"));
    expect(lines).toEqual([
      "- r1 (P1, T1, S1): 2 passed of 2 verified, 0 unaccepted, 0 non-results; 4 verified cases settled against their check, counted neither way.",
      "- r1 (P1, T1, S1): 1 passed of 5 verified, 0 unaccepted, 1 non-result; 1 verified case settled against its check, counted neither way.",
    ]);
  });

  it("tells solves regraded from an earlier battery apart from fresh ones", () => {
    const text = render(
      readoutOf(
        row("r1", 0, { passed: 6, n: 6 }),
        row("r2", 1, { passed: 7, n: 7, regrade: { of: "r1", reused: 6 } }),
      ),
    );
    expect(lineOf(text, "r2")).toBe(
      "- r2 (P1, T1, S1): 7 passed of 7 verified, 0 unaccepted, 0 non-results; 6 regraded from r1's recorded solves, 1 not regraded.",
    );
    expect(lineOf(text, "r1")).toBe(
      "- r1 (P1, T1, S1): 6 passed of 6 verified, 0 unaccepted, 0 non-results.",
    );
  });

  it("aliases the scoring program, so a changed evaluator reads as a changed condition", () => {
    const text = render(
      readoutOf(row("r1", 0, { passed: 3, n: 6 }), row("r2", 1, { passed: 5, n: 6, scoring: "scoring-b" })),
    );
    expect(lineOf(text, "r2")).toStartWith("- r2 (P1, T1, S2): ");
    expect(lineOf(text, "r1")).toStartWith("- r1 (P1, T1, S1): ");
  });

  it("states no zone, aim or interval, whichever side of the band a battery reads", () => {
    for (const passed of [0, 2, 5]) {
      const rows = [
        row("r1", 0, { passed, n: 5, families: [{ item: "beams", attempts: 5, passes: passed }] }),
      ];
      const readout = readoutOf(...rows);
      const text = [render(readout), history(readout, rows)].join("\n");
      expect(text).not.toMatch(
        /too-easy|too-hard|under-aim|on-aim|over-aim|Wilson|wilson|"aim"|toAim|Reading:/,
      );
    }
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
    const lines = text.split("\n").filter((line) => /^- r\d/.test(line));
    expect(lines.map((line) => line.split(" ")[1])).toEqual(["r4", "r3", "r2"]);
    expect(render(readoutOf(...rows.slice(0, 4)))).toContain("1 older row is not shown here.");
  });

  it("points at the latest battery's passing artifacts, and leaves the witness sentence to the contract", () => {
    const text = render(readoutOf(row("r1", 0, { passed: 6, n: 6 })));
    expect(text).toContain(
      "Battery r1 passed 6 cases; each passing solve and the artifact it submitted is at traces/r1/<taskId>/artifact.",
    );
    // The round contract rides in the same opening prompt and already says what a witness proves.
    expect(text).not.toContain("it proves a task feasible, never difficult");
    expect(renderBatteryContract(6)).toContain("it proves a task feasible, never difficult");
    expect(render(readoutOf(row("r1", 0, { passed: 0, n: 6 })))).not.toContain("traces/r1");
  });

  it("states no course: no streak, target, prediction, ladder or move", () => {
    for (const passed of [0, 2, 5]) {
      const text = [render(readoutOf(row("r1", 0, { passed, n: 5, probe: true }))), renderBatteryContract(5)]
        .join("\n")
        .replace(/\s+/g, " ");
      expect(text).not.toMatch(/streak|predict|ladder|new move|comparator/i);
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

  it("states what a limit needs for a battery of the round's one size, and no count at any size", () => {
    const probe = renderBatteryContract(10, 5);
    const one = renderBatteryContract(25);
    expect(one).toContain(
      "Only a battery that passes some but not all of its cases can locate a limit, an unaccepted attempt counting as a fail and a non-result as neither, and only where the checks that failed it are right; one that passes every case found none.",
    );
    // A partial count is necessary and not sufficient, so nothing says a partial battery located one.
    expect(one).not.toContain("locates a limit");
    // A probe range leaves that sentence to the sizing sentence, which says what a probe must pass.
    expect(probe).not.toContain("locate a limit");
    for (const text of [probe, one]) {
      expect(text).not.toMatch(/\baim\b|\d+ tasks|\d+ to \d+|Calibration|band/);
      expect(text).toContain("Every task must be valid and solved by your reference.");
      expect(text).toContain("it proves a task feasible, never difficult");
    }
  });

  it("keeps a declared band in the controller's placement and out of the author's history", () => {
    const declared: [number, number] = [0.6, 0.9];
    const battery = row("r1", 0, { passed: 4, n: 5 });
    const readout = climbReadout(historyOf(battery), declared);
    expect(readout.decision).toMatchObject({ placement: { zone: "on-aim", aim: [3, 4] } });
    expect(historyBody(readout, [battery])).not.toHaveProperty("band");
  });

  it("says the latest battery found no limit only when it passed every case it scored", () => {
    // A full pass also names what to read before the next battery: how the passing solves won, not how
    // far their answers sat from the reference. Pointed at that distance, every round of the five
    // all-pass batteries of run 6a8ca0 (2026-09-30) moved limits or enlarged instances that the solver's
    // same enumeration still settled in one turn. Depth is requirements acting together under one
    // shared limit, and no widening route is offered: a wider battery at the same demand passed whole.
    expect(render(readoutOf(row("r1", 0, { passed: 6, n: 6 })))).toContain(
      "Battery r1 passed all 6 of its verified cases, so it found no limit. More tasks, families, inputs or scenarios at the same demand measure the same reach again, so the next battery has to demand more of the field's own work within its tasks: make more of the requirements the request names act together on one answer under one shared limit, so that meeting one spends the margin another needs, in tasks you expect the solver to fail. Carry none of its tasks forward unchanged, since a task it passed measures the same pass again: raise what each one demands or replace it. Record in your notes which public requirement it changes and the reasoning that change adds. Before you set the next battery, read how its passing solves reached their answers, the tools they called and the search they ran: a limit moved or an instance enlarged while those same steps would still find an answer asks nothing new, so the change has to be one those steps do not settle.",
    );
    expect(render(readoutOf(row("r1", 0, { passed: 1, n: 1 })))).toContain(
      "Battery r1 passed its one verified case, so it found no limit",
    );
    expect(render(readoutOf(row("r1", 0, { passed: 6, n: 6 })))).not.toContain(
      "across what the request names",
    );
    // A non-result scored nothing, so a battery that lost cases to one asks for no harder demand.
    const censored = render(readoutOf(row("r1", 0, { passed: 1, n: 1, slots: 6 })));
    expect(censored).toContain(
      "Battery r1 passed its one verified case and 5 cases ended as non-results that scored nothing, so it found no limit among the cases it scored and did not measure the rest.",
    );
    expect(censored).not.toContain("demand more");
    expect(censored).not.toContain("Carry none of its tasks forward");
    expect(censored).not.toContain("read how its passing solves reached their answers");
    // An unaccepted attempt is a fail, and a battery with no pass or a partial one says nothing more.
    const silent = [
      row("r1", 0, { passed: 5, n: 6, unaccepted: 1 }),
      row("r1", 0, { passed: 0, n: 6 }),
      row("r1", 0, { passed: 3, n: 6 }),
    ];
    for (const battery of silent) expect(render(readoutOf(battery))).not.toContain("found no limit");
    // Only the latest battery speaks: an earlier whole pass under a later partial one says nothing.
    const text = render(readoutOf(row("r1", 0, { passed: 6, n: 6 }), row("r2", 1, { passed: 3, n: 6 })));
    expect(text).not.toContain("found no limit");
  });

  it("says how much of the solve wall a full pass's slowest solve took", () => {
    // Of 233 all-pass batteries from 2026-09-25 to 09-30, 153 finished their slowest solve inside a
    // tenth of the 120-minute wall, and the round that authored the next one was never told so.
    const effort = { cases: 6, turns: 3, minutes: 3.1, toolCalls: 12 };
    expect(render(readoutOf(row("r1", 0, { passed: 6, n: 6, effort })))).toContain(
      "raise what each one demands or replace it. Its slowest solve took 3.1 of the 120 minutes a solve may run. Record in your notes",
    );
    // Unrecorded minutes stay unsaid rather than read as none.
    expect(
      render(readoutOf(row("r1", 0, { passed: 6, n: 6, effort: { ...effort, minutes: null } }))),
    ).not.toContain("slowest solve");
    // A battery that failed a case, or lost one to a non-result, says nothing of it.
    const silent = [
      row("r1", 0, { passed: 3, n: 6, effort }),
      row("r1", 0, { passed: 1, n: 1, slots: 6, effort }),
    ];
    for (const battery of silent) expect(render(readoutOf(battery))).not.toContain("slowest solve");
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

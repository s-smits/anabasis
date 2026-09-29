/**
 * The climb-evidence reader: one recorded population, and the climb readout read from it on
 * disk.
 *
 * `admitBattery` decides whether each run directory belongs here at all and names every refusal;
 * `test/climb-battery-admission.test.ts` owns those gates. What is left — and what this file states
 * — is the population law and the reading: every directory holding a battery is in `admitted` or in
 * `excluded`, never both and never neither, except a claim-refused battery a recorded clock can
 * place, which keeps a history row and enters no rate. Chronology is the claim's own `createdAt`,
 * never file mtime.
 *
 * The band arithmetic belongs to `test/climb-decision.test.ts` and the rendered readout to
 * `test/climb-readout.test.ts`.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type JsonValue, isString } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
import { EXPERIMENT_AUTHORING_SCHEMA } from "../src/run/experiment-freeze.ts";
import {
  type AdmittedClimbRow,
  type ClimbBatteriesRead,
  climbThresholds,
  excludedSummary,
  readClimbBatteries,
} from "../src/run/climb-history.ts";
import { readClimbReadout, renderReadout } from "../src/run/climb-readout.ts";
import { required } from "./helpers/doubles.ts";
import { fixtureThresholdDigest } from "./helpers/thresholds.ts";

const RUN_PIN = "test/pin";
const BAND: [number, number] = [0.2, 0.5];
/** One recorded time for every battery here, so an ordering test orders on something else. */
const RECORDED_AT = "2026-01-01T00:00:00.000Z";
const NEXT_DAY = "2026-01-02T00:00:00.000Z";

/** One recorded case row. Only what a reader downstream actually consumes: the scored verdict, the
 *  accepted-submit flag the unaccepted count reads, the solver's tool calls, and the public input
 *  the run records beside the case. */
interface CaseRow {
  taskId?: string | null;
  family?: string;
  pass: boolean | null;
  acceptedSubmit?: boolean;
  toolCalls?: number;
  turns?: number;
  /** Wall-clock minutes the solve took. A negative value records the two instants in reverse. */
  minutes?: number;
  publicInput?: JsonValue;
  /** The recorded reason a case ended in a runtime non-result. */
  runtimeNonResult?: string;
}

type BatteryFields = { [field: string]: JsonValue | undefined };

const tmp = () => mkdtempSync(join(tmpdir(), "ana-climb-history-"));

function caseRecord(row: CaseRow): JsonValue {
  const solvedFor = (minutes: number) => new Date(Date.parse(RECORDED_AT) + minutes * 60_000).toISOString();
  const span = row.minutes === undefined ? {} : { startedAt: RECORDED_AT, endedAt: solvedFor(row.minutes) };
  const solver = {
    ...keyIfDefined("toolCalls", row.toolCalls),
    ...keyIfDefined("turns", row.turns),
    ...span,
  };
  return {
    ...keyIfDefined("taskId", row.taskId === null ? undefined : (row.taskId ?? "t")),
    ...keyIfDefined("family", row.family),
    pass: row.pass,
    acceptedSubmit: row.acceptedSubmit ?? row.pass !== null,
    ...keyIfDefined("runtimeNonResult", row.runtimeNonResult),
    ...keyIfDefined("solver", Object.keys(solver).length === 0 ? undefined : solver),
  };
}

/** Write one recorded battery and the accepted claim whose `createdAt` orders it. */
function writeBattery(
  tree: string,
  runId: string,
  cases: CaseRow[],
  createdAt: string,
  overrides: BatteryFields = {},
): void {
  openBattery(tree, runId, cases, overrides).record();
  writeClaim(tree, runId, createdAt, true);
}

/** The battery's evidence log with its battery and public tasks written and not yet recorded, so a
 *  test can add the files a run records beside them. */
function openBattery(tree: string, runId: string, cases: CaseRow[], overrides: BatteryFields = {}) {
  const evidence = new EvidenceLog(join(tree, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: RUN_PIN,
    thresholdManifestDigest: "digest-a",
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", correctnessModelHash: "correctnessModel-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: cases.map(caseRecord),
    measured: { items: [] },
    ...overrides,
  });
  for (const { taskId, publicInput } of cases) {
    if (isString(taskId) && publicInput !== undefined) {
      evidence.write(`cases/${taskId}/public-task.json`, { taskId, publicTask: { publicInput } });
    }
  }
  return evidence;
}

function writeClaim(tree: string, runId: string, createdAt: string, ok: boolean): void {
  mkdirSync(join(tree, "claims"), { recursive: true });
  writeFileSync(
    join(tree, "claims", `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      createdAt,
      claim: ok ? { ok: true } : { ok: false, clauses: [{ clause: "grounding-missing" }] },
    }),
  );
}

/** Pass rows, the shorthand most cases want. */
const passes = (n: number, verdict: boolean | null = true): CaseRow[] =>
  Array.from({ length: n }, (_, i) => ({ taskId: `t${String(i)}`, pass: verdict }));

const read = (tree: string, pin: string | null = RUN_PIN): ClimbBatteriesRead =>
  readClimbBatteries(tree, pin, join(tree, "claims"));

const runIds = (rows: readonly AdmittedClimbRow[]) => rows.map((row) => row.battery.runId);

describe("the population law — every directory accounted for exactly once", () => {
  it("reads nothing for a tree no battery ever measured, and no readout either", () => {
    const tree = tmp();
    expect(read(tree)).toEqual({ history: [], admitted: [], excluded: [] });
    expect(readClimbReadout(tree, RUN_PIN, join(tree, "claims"))).toBeNull();
  });

  it("puts a claim-refused battery in the history and out of the rate, carrying its own refusal", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(5), RECORDED_AT);
    writeBattery(tree, "r2", passes(5), NEXT_DAY);
    writeClaim(tree, "r2", NEXT_DAY, false);

    const view = read(tree);

    // A refused battery's zeros are not a too-hard base level.
    expect(runIds(view.history)).toEqual(["r1", "r2"]);
    expect(runIds(view.admitted)).toEqual(["r1"]);
    expect(view.history[1]?.excludedReason).toContain("claim refused: grounding-missing");
    expect(view.excluded.map((row) => row.runId)).toEqual(["r2"]);
  });

  it("orders by the claims' createdAt then run id, never by file time, and exclusions by run id", () => {
    const tree = tmp();
    writeBattery(tree, "later", passes(3), "2026-01-09T00:00:00.000Z");
    writeBattery(tree, "rb", passes(3), RECORDED_AT);
    writeBattery(tree, "ra", passes(3), RECORDED_AT);
    writeBattery(tree, "xb", passes(3), RECORDED_AT, { backendPin: "other/pin" });
    writeBattery(tree, "xa", passes(3), NEXT_DAY, { backendPin: "other/pin" });
    const stale = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(join(tree, "claims", "later.json"), stale, stale);

    const view = read(tree);
    expect(runIds(view.history)).toEqual(["ra", "rb", "later"]);
    expect(view.excluded.map((row) => row.runId)).toEqual(["xa", "xb"]);
  });
});

describe("what one battery contributes to the reading", () => {
  type Authoring = AdmittedClimbRow["authoring"];
  /** The part of the admitted row a case states; everything it leaves out is some other case's. */
  interface Reading {
    battery?: Partial<AdmittedClimbRow["battery"]>;
    condition?: AdmittedClimbRow["condition"];
    authoring?: Partial<Omit<Authoring, "familySummary">> & {
      familySummary?: Partial<Authoring["familySummary"][number]>[];
    };
  }
  const admittedOnly = (tree: string) => required(read(tree).admitted[0], "the admitted battery");

  it.each<[string, CaseRow[], BatteryFields, Reading]>([
    [
      "keeps non-results out of the denominator and unaccepted attempts in it",
      [
        { taskId: "a", pass: true },
        { taskId: "b", pass: false },
        { taskId: "c", pass: false, acceptedSubmit: false },
        { taskId: "d", pass: null },
      ],
      {},
      { battery: { n: 3, passed: 1, unaccepted: 1 } },
    ],
    [
      "names which cases failed",
      [
        { taskId: "a", pass: true },
        { taskId: "b", pass: false },
      ],
      {},
      { battery: { failedTaskIds: ["b"] } },
    ],
    [
      "keeps every case id in the authoring row, disclosing the ones without one",
      [
        { taskId: "a", pass: true },
        { taskId: null, pass: null },
      ],
      {},
      { authoring: { caseIds: ["a", null] } },
    ],
    [
      "records the condition labels a battery carries, without claiming they are comparable",
      passes(3),
      {},
      { condition: { backendPin: RUN_PIN, thresholdManifestDigest: "digest-a", variant: "shipping" } },
    ],
    [
      "summarises families by name and drops a row carrying no readable sample",
      passes(4),
      {
        measured: {
          items: [
            { item: "void-span", attempts: 2, passes: 1 },
            { item: "arch", attempts: 2, passes: 2 },
            { item: "  ", attempts: 2, passes: 1 },
            { item: "empty", attempts: 0, passes: 0 },
          ],
        },
      },
      {
        authoring: {
          familySummary: [
            { family: "arch", attempts: 2, passes: 2 },
            { family: "void-span", attempts: 2, passes: 1 },
          ],
        },
      },
    ],
    [
      "reads the most any one case spent, as a fact beside the verdicts",
      [
        { taskId: "t1", pass: true, turns: 1, toolCalls: 25, minutes: 7.3 },
        { taskId: "t2", pass: true, turns: 2, toolCalls: 53, minutes: 14.8 },
        // Instants the wrong way round leave the span unknown while turns and tool calls still
        // count; no solver block at all is not a solve that cost nothing.
        { taskId: "t3", pass: false, turns: 1, toolCalls: 9, minutes: -9.7 },
        { taskId: "t4", pass: true },
      ],
      {},
      { authoring: { effort: { cases: 3, turns: 2, minutes: 14.8, toolCalls: 53 } } },
    ],
    ["states no effort when no case recorded a solver block", passes(4), {}, { authoring: { effort: null } }],
    [
      "reads each family's median and most minutes and its median tool calls",
      [
        { taskId: "t1", family: "span", pass: true, toolCalls: 10, minutes: 4 },
        { taskId: "t2", family: "span", pass: false, toolCalls: 30, minutes: 20 },
        { taskId: "t3", family: "span", pass: true, toolCalls: 14, minutes: 9 },
        { taskId: "t4", family: "joint", pass: true, toolCalls: 5, minutes: 2 },
        { taskId: "t5", family: "joint", pass: true, toolCalls: 7 },
        // A case without a family, and one without a solver block, join no family's effort.
        { taskId: "t6", pass: true, toolCalls: 99, minutes: 99 },
        { taskId: "t7", family: "joint", pass: true },
      ],
      {},
      {
        authoring: {
          familyEffort: [
            { family: "joint", cases: 2, medianMinutes: 2, maxMinutes: 2, medianToolCalls: 6 },
            { family: "span", cases: 3, medianMinutes: 9, maxMinutes: 20, medianToolCalls: 14 },
          ],
        },
      },
    ],
  ])("%s", (_name, cases, overrides, expected) => {
    const tree = tmp();
    writeBattery(tree, "r1", cases, RECORDED_AT, overrides);
    expect(admittedOnly(tree)).toMatchObject(expected);
  });

  it("counts the unaccepted cases whose solve ran to the product's own wall", () => {
    const tree = tmp();
    mkdirSync(join(tree, "agent"), { recursive: true });
    writeFileSync(join(tree, "agent", "config.yaml"), "solver:\n  solve_minutes: 12\n");
    writeBattery(
      tree,
      "r1",
      [
        { taskId: "cut", pass: false, acceptedSubmit: false, minutes: 12 },
        // Unaccepted well inside the wall, and accepted at the wall: neither was cut by it.
        { taskId: "early", pass: false, acceptedSubmit: false, minutes: 3 },
        { taskId: "slow", pass: true, minutes: 12 },
      ],
      RECORDED_AT,
    );
    expect(admittedOnly(tree).authoring).toMatchObject({ solveWallMinutes: 12, wallBound: 1 });
  });

  it("names a family every case of which ended in a non-result, and no family that kept one scored", () => {
    const tree = tmp();
    const cut = { pass: null, acceptedSubmit: false, runtimeNonResult: "usage limit reached" };
    writeBattery(
      tree,
      "r1",
      [
        { taskId: "a", family: "span", pass: true },
        { taskId: "b", family: "span", ...cut },
        { taskId: "c", family: "joint", ...cut },
        { taskId: "d", family: "joint", ...cut },
      ],
      RECORDED_AT,
    );
    expect(admittedOnly(tree).battery.censoredFamilies).toEqual(["joint"]);
  });

  it("calls the failing set unknown, never empty, when one failing row carries no id", () => {
    const tree = tmp();
    writeBattery(
      tree,
      "r1",
      [
        { taskId: "a", pass: true },
        { taskId: null, pass: false },
      ],
      RECORDED_AT,
    );
    const { battery } = admittedOnly(tree);
    expect(battery.passed).toBe(1);
    expect(battery).not.toHaveProperty("failedTaskIds");
  });

  it("reads history across model pins when no pin is stated, keeping each battery's own label", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(3), RECORDED_AT, { backendPin: "other/pin" });

    expect(read(tree, null).admitted[0]?.condition.backendPin).toBe("other/pin");
    expect(read(tree).admitted).toEqual([]);
  });

  // Rule 4's mechanical test for the readout: protected files recorded beside each case change
  // nothing a Builder reads.
  it("renders a byte-identical readout when only protected verifier detail differs", () => {
    const rendered = (secret: string) => {
      const tree = tmp();
      const evidence = openBattery(tree, "r1", [
        { taskId: "t1", family: "span", pass: true, toolCalls: 4, minutes: 3 },
        { taskId: "t2", family: "span", pass: false, toolCalls: 8, minutes: 6 },
      ]);
      for (const taskId of ["t1", "t2"]) {
        evidence.write(`cases/${taskId}/verifier.json`, { stdout: secret, issues: [secret] });
        evidence.write(`cases/${taskId}/oracle.json`, { expectation: secret });
      }
      evidence.record();
      writeClaim(tree, "r1", RECORDED_AT, true);
      return renderReadout(readClimbReadout(tree, RUN_PIN, join(tree, "claims")), "next");
    };
    const a = rendered("secret-verifier-a");
    expect(rendered("secret-verifier-b")).toBe(a);
    expect(a).not.toContain("secret-verifier");
    expect(a).toContain("Battery r1 passed 1 case;");
  });
});

describe("cases the battery's completed review settled against their check", () => {
  type Disposition = { taskId: string; kind: string; disposition: string; checkIds?: string[] };
  /** Two passes and four fails over two families; `v` is the one veto, a verifier pass. */
  const CASES: CaseRow[] = [
    { taskId: "p1", family: "span", pass: true },
    { taskId: "v", family: "span", pass: true },
    { taskId: "f1", family: "span", pass: false },
    { taskId: "f2", family: "joint", pass: false },
    { taskId: "f3", family: "joint", pass: false },
    { taskId: "f4", family: "joint", pass: false },
  ];
  const MEASURED = {
    items: [
      { item: "span", attempts: 3, passes: 2 },
      { item: "joint", attempts: 3, passes: 0 },
    ],
  };
  const against = (taskId: string, kind = "disputed-pass", checkIds = ["bench"]): Disposition => ({
    taskId,
    kind,
    disposition: "against-check",
    checkIds,
  });

  function reviewed(dispositions: Disposition[], status = "completed", overrides: BatteryFields = {}) {
    const tree = tmp();
    writeBattery(tree, "r1", CASES, RECORDED_AT, { measured: MEASURED, ...overrides });
    mkdirSync(join(tree, "analysis"), { recursive: true });
    writeFileSync(
      join(tree, "analysis", "r1-epoch-review.json"),
      JSON.stringify({
        schema: EPOCH_REVIEW_SCHEMA,
        runId: "r1",
        status,
        findings: [],
        dispositions: dispositions.map((row) => ({ family: "joint", checkId: "bench", finding: 0, ...row })),
      }),
    );
    return required(read(tree).admitted[0], "the admitted battery");
  }

  const UNTOUCHED = { n: 6, passed: 2, failedTaskIds: ["f1", "f2", "f3", "f4"] };

  it("leaves a settled disputed fail out of the sample, its family and its failing set", () => {
    const row = reviewed([against("f2")]);
    expect(row.battery).toMatchObject({
      n: 5,
      passed: 2,
      settledAgainst: 1,
      failedTaskIds: ["f1", "f3", "f4"],
    });
    expect(row.authoring.familySummary).toEqual([
      { family: "joint", attempts: 2, passes: 0 },
      { family: "span", attempts: 3, passes: 2 },
    ]);
  });

  it("drops a settled veto from both counts rather than turning it into a fail", () => {
    expect(reviewed([against("v", "veto")]).battery).toMatchObject({ n: 5, passed: 1, settledAgainst: 1 });
  });

  it("subtracts a settled case from the changed subset it belongs to, and none it does not", () => {
    const experimentAuthoring = {
      schema: EXPERIMENT_AUTHORING_SCHEMA,
      operation: { operation: "task-probe", moved: ["tasks"] },
      baseline: { agentHash: "agent", correctnessModelHash: "model", taskSetHash: "tasks" },
      actual: "climb",
      changedTaskIds: ["f2", "f3", "p1"],
    };
    const changed = { ...MEASURED, changedSubset: { attempts: 3, passes: 1 } };
    const row = reviewed([against("f2"), against("f1")], "completed", {
      measured: changed,
      experimentAuthoring,
    });
    expect(row.battery.measured.changedSubset).toEqual({ attempts: 2, passes: 1 });
    // A subset whose members the record does not name gives way to the whole battery.
    const unnamed = reviewed([against("f2")], "completed", { measured: changed });
    expect(unnamed.battery.measured).not.toHaveProperty("changedSubset");
  });

  it.each<[string, Disposition[], string]>([
    ["an incomplete review", [against("f2")], "incomplete"],
    ["a failed review", [against("f2")], "failed"],
    ["a settlement in the check's favour", [{ ...against("f2"), disposition: "check-stands" }], "completed"],
    ["a case another check also decided", [against("f2", "disputed-pass", ["bench", "timing"])], "completed"],
    [
      "a disposition that recorded no checks",
      [{ taskId: "f2", kind: "disputed-pass", disposition: "against-check" }],
      "completed",
    ],
  ])("settles nothing on %s", (_name, dispositions, status) => {
    const { battery } = reviewed(dispositions, status);
    expect(battery).toMatchObject(UNTOUCHED);
    expect(battery).not.toHaveProperty("settledAgainst");
  });
});

describe("the refusals, summarised for the author", () => {
  it("says nothing without exclusions, names each battery, and groups one shared reason", () => {
    expect(excludedSummary([], 3)).toBeNull();
    expect(
      excludedSummary(
        [
          { runId: "r1", reason: "not comparable", claimRefused: false },
          { runId: "r2", reason: "claim refused", claimRefused: true },
        ],
        1,
      ),
    ).toBe(
      "2 of 3 recorded batteries excluded from difficulty evidence: not comparable — r1; claim refused — r2",
    );
    // A whole campaign read at another pin shares one reason: it is stated once, not per run.
    const shared = Array.from({ length: 6 }, (_, i) => ({
      runId: `r${String(i)}`,
      reason: "not comparable",
      claimRefused: false,
    }));
    const summary = excludedSummary(shared, 0);
    expect(summary).toContain("not comparable — r0, r1, r2, r3 and 2 more");
    expect(summary?.match(/not comparable/g)).toHaveLength(1);
  });
});

describe("the frozen climb thresholds a round reads", () => {
  // A bad row never blocks a run: each invalid or missing field takes its declared default.
  it.each<[string | null, [number, number]]>([
    ["climb:\n  band: [0.3, 0.6]\n", [0.3, 0.6]],
    ["climb:\n  band: [2, 3]\n", BAND],
    ["climb:\n  band: [0.5, 0.2]\n", BAND],
    ["climb:\n  band: [.nan, 0.5]\n", BAND],
    ["climb:\n  band: sometimes\n", BAND],
    ["significanceGate:\n  z: 1.96\n", BAND],
    [null, BAND],
  ])("reads the band of %p", (body, band) => {
    const path = join(tmp(), "thresholds.frozen.yaml");
    if (body !== null) writeFileSync(path, body);
    expect(climbThresholds(path).band).toEqual(band);
  });
});

describe("the climb readout, read from recorded batteries", () => {
  /** A battery of five, all passing: above the aim of 1 to 2, and significantly so. */
  const above = 5;

  type Round = { passed: number | null; agent?: string | null; inputs?: readonly JsonValue[] };

  /** One battery per round; `null` passes writes a claim-refused battery, `agent: null` one that
   *  records no product identity, and `inputs` the public input of each of its five tasks. */
  function roundsTree(rounds: readonly Round[], thresholdManifestDigest = "digest-a"): string {
    const tree = tmp();
    rounds.forEach((round, i) => {
      const at = `2026-09-0${String(i + 1)}T00:00:00Z`;
      const passed = round.passed ?? above;
      const cases = [...passes(passed), ...passes(5 - passed, false)].map((row, j) => ({
        ...row,
        ...keyIfDefined("publicInput", round.inputs?.[j]),
      }));
      writeBattery(tree, `r${String(i)}`, cases, at, {
        thresholdManifestDigest,
        bundleSnapshot: {
          // No agent hash leaves the battery no harness identity.
          ...keyIfDefined("agentHash", round.agent === null ? undefined : (round.agent ?? "agent-a")),
          correctnessModelHash: "correctnessModel-a",
          scoringHash: "scoring-a",
        },
      });
      if (round.passed === null) writeClaim(tree, `r${String(i)}`, at, false);
    });
    return tree;
  }

  const readout = (tree: string, manifest?: string) =>
    required(readClimbReadout(tree, RUN_PIN, join(tree, "claims"), manifest), "a climb readout");

  it("places no battery whose every attempt was refused at submission", () => {
    // Every attempt refused at submission is no difficulty evidence, not a battery below the aim.
    const tree = roundsTree([{ passed: above }, { passed: above }]);
    writeBattery(
      tree,
      "r9",
      passes(5).map((row) => ({ ...row, pass: false, acceptedSubmit: false })),
      "2026-09-09T00:00:00Z",
    );
    const seen = readout(tree);
    expect(seen.decision.placement).toBeNull();
    expect(seen.rows[0]).toMatchObject({ runId: "r9", zone: null });
  });

  // The off-aim streak and its same-schema count, and the calibration of per-task predictions, left
  // the readout with the plan's target and predictions: a run of batteries above the aim, however
  // long and however re-tuned, is read through its placements alone.
  it("states no off-aim streak, schema count or prediction calibration after rounds above the aim", () => {
    const inputs = (scale: number) => [1, 2, 3, 4, 5].map((span) => ({ span: span * scale, load: "snow" }));
    const seen = readout(
      roundsTree([
        { passed: above, inputs: inputs(1) },
        { passed: above, inputs: inputs(10) },
        { passed: above, inputs: inputs(100) },
      ]),
    );
    expect(seen).not.toHaveProperty("allowance");
    const rendered = renderReadout(seen, "choose the next experiment");
    // The placement stays the controller's; the author reads the counts it was taken over.
    expect(seen.decision.placement?.zone).toBe("too-easy");
    expect(rendered).not.toContain("too-easy");
    for (const gone of [
      "Off-aim streak",
      "posed its set of public task schemas",
      "Predictions bound to",
      "Brier",
    ]) {
      expect(rendered).not.toContain(gone);
    }
  });

  it("reads the frozen manifest's band, so an override reaches every placement", () => {
    const policy = tmp();
    const manifest = join(policy, "thresholds.frozen.yaml");
    writeFileSync(manifest, "climb:\n  band: [0.6, 0.9]\n");
    const seen = readout(roundsTree([{ passed: 4 }], fixtureThresholdDigest(policy)), manifest);
    expect(seen.band).toEqual([0.6, 0.9]);
    // 4 of 5 is above the default aim of 1 to 2 and on the overridden aim of 3 to 4.
    expect(seen.rows[0]).toMatchObject({ zone: "on-aim", aim: [3, 4] });
  });
});

describe("the identities a battery line names", () => {
  // A remeasure records its regrade even when no recorded solve matched, because the remeasure
  // chain reads that presence; for the author every case of such a battery was solved fresh.
  it("reads the scoring hash, and a regrade only when it reused a recorded solve", () => {
    const tree = tmp();
    const snapshot = { agentHash: "agent-a", correctnessModelHash: "cm-a", scoringHash: "scoring-a" };
    writeBattery(tree, "r1", passes(3), RECORDED_AT, { bundleSnapshot: snapshot });
    writeBattery(tree, "r2", passes(3), NEXT_DAY, {
      bundleSnapshot: snapshot,
      regrade: { of: "r1", reused: 2, changedPasses: 0 },
    });
    writeBattery(tree, "r3", passes(3), "2026-01-09T00:00:00.000Z", {
      regrade: { of: "r2", reused: 0, changedPasses: 0 },
    });
    expect(read(tree).history.map((row) => [row.authoring.scoringHash, row.authoring.regrade])).toEqual([
      ["scoring-a", null],
      ["scoring-a", { of: "r1", reused: 2 }],
      [null, null],
    ]);
  });
});

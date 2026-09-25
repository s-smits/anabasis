/**
 * The climb-evidence reader: one recorded population, and the climb readout's off-aim allowance
 * read from it on disk.
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
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import {
  type AdmittedClimbRow,
  type ClimbBatteriesRead,
  climbThresholds,
  excludedSummary,
  // Gate audit 2026-09-25 (docs/gate-audit.md, repeated-public-condition): commented out (unsure): only the
  // fingerprint cases below read these.
  // priorPublicFingerprints,
  // productConditionFingerprint,
  // publicBatteryFingerprint,
  readClimbBatteries,
} from "../src/run/climb-history.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
// import { POLICY } from "../src/critic/policy.ts";
import { type OffAimAllowance, readClimbReadout, renderReadout } from "../src/run/climb-readout.ts";
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
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
    ["states no calibration without a bound plan", passes(2), {}, { authoring: { calibration: null } }],
  ])("%s", (_name, cases, overrides, expected) => {
    const tree = tmp();
    writeBattery(tree, "r1", cases, RECORDED_AT, overrides);
    expect(admittedOnly(tree)).toMatchObject(expected);
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

  it("scores the bound plan's predictions against the verdicts", () => {
    const plan = {
      ...PLAN_FIELDS,
      scope: "tasks" as const,
      gap: "g",
      change: "c",
      expectedResult: "r",
      target: { comparator: "at-most" as const, verifiedPasses: 1 },
      predictions: [
        { taskId: "t1", pass: 0.2 },
        { taskId: "t2", pass: 0.9 },
        { taskId: "unmeasured", pass: 0.5 },
      ],
    };
    const experimentAuthoring = {
      proposal: { ...plan, digest: hashJsonValue(plan) },
      operation: { operation: "task-probe", moved: ["tasks"] },
      baseline: { agentHash: "agent", correctnessModelHash: "model", taskSetHash: "tasks" },
      actual: "climb",
      changedTaskIds: [],
    };
    const tree = tmp();
    const cases = [
      { taskId: "t1", pass: true },
      { taskId: "t2", pass: false },
    ];
    writeBattery(tree, "r1", cases, RECORDED_AT, { experimentAuthoring });
    expect(read(tree).admitted[0]?.authoring.calibration).toEqual({
      scored: 2,
      brier: 0.725,
      expected: 1.1,
      observed: 1,
    });
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
    expect(a).toContain("Solve effort by family");
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

describe("the off-aim allowance, read from recorded batteries", () => {
  /** A battery of five, all passing: above the aim of 1 to 2, and significantly so. */
  const above = 5;
  /** A battery of five passing one: on the aim, which ends a run of misses. */
  const onAim = 1;

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

  // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
  // const limit = POLICY.climb.offAimStreakRounds;
  const limit = 3;
  const products = Array.from({ length: limit }, (_, i) => ({ passed: above, agent: `agent-${String(i)}` }));
  const olderRefusals = [{ passed: null }, { passed: null }, { passed: 2 }, { passed: above }];

  it.each<[string, Round[], Partial<OffAimAllowance>]>([
    [
      "counts every trailing miss on one side, and stops at a battery on the aim",
      [{ passed: above }, { passed: onAim }, { passed: above }, { passed: above }],
      { rounds: 2, placed: 2, refused: 0, side: "above", products: 1, sameSchema: 0 },
    ],
    [
      "stops where the product crossed the aim, because that is two runs of misses",
      [{ passed: above }, { passed: above }, { passed: 0 }],
      { rounds: 1, side: "below" },
    ],
    [
      "counts product identities across the run",
      [{ passed: above, agent: "agent-old" }, { passed: above }, { passed: above }],
      { rounds: 3, products: 2 },
    ],
    // A null identity never proves sameness.
    [
      "counts two unidentified batteries as two products",
      [
        { passed: above, agent: null },
        { passed: above, agent: null },
      ],
      { rounds: 2, products: 2 },
    ],
    // Refusals behind a battery that then landed on the aim are an earlier story.
    [
      "counts a refused round inside the run as one, and none from before it",
      [
        { passed: null },
        { passed: null },
        { passed: onAim },
        { passed: above },
        { passed: null },
        { passed: above },
      ],
      { rounds: 3, placed: 2, refused: 1, side: "above", products: 1, sameSchema: 0 },
    ],
    // Reading the campaign-wide exclusion list into the count would stop a new run on its first round.
    ["does not count refusals older than the run", olderRefusals, { rounds: 1, refused: 0 }],
    [
      "counts a refusal beside the run's own miss",
      [...olderRefusals, { passed: null }],
      { rounds: 2, placed: 1, refused: 1 },
    ],
    [
      "counts a whole allowance of above-aim rounds, each product identity once",
      products,
      { rounds: limit, placed: limit, refused: 0, side: "above", products: limit },
    ],
    ["counts one short of the allowance", products.slice(1), { rounds: limit - 1 }],
  ])("%s", (_name, rounds, allowance) => {
    expect(readout(roundsTree(rounds)).allowance).toMatchObject(allowance);
  });

  it("reads an unplaced round as the end of the run, since it was not placed off the aim", () => {
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
    expect(seen.allowance).toBeNull();
  });

  it("names the batteries that posed the latest one's task schemas again, whatever values they published", () => {
    // Re-tuned published numbers under one set of schemas are not a new exam.
    const truss = (span: number) => ({ span, load: "snow", bays: [2, 4] });
    const frame = (storeys: number) => ({ storeys, braced: true });
    const mixed = (scale: number) => [
      truss(6 * scale),
      frame(scale),
      truss(9 * scale),
      truss(12 * scale),
      frame(2),
    ];
    // A new mix of the same two kinds, in another order: neither a task count nor an order counts.
    const remixed = [frame(7), frame(3), truss(90), frame(4), frame(1)];
    const sentence =
      "of the batteries placed above the aim before the latest one posed its set of public task schemas";
    const retuned = readout(
      roundsTree([
        { passed: above, inputs: mixed(1) },
        { passed: above, inputs: mixed(10) },
        { passed: above, inputs: remixed },
      ]),
    );
    expect(retuned.allowance).toMatchObject({ rounds: 3, placed: 3, sameSchema: 2 });
    expect(renderReadout(retuned, "choose the next experiment")).toContain(`2 ${sentence}`);
    // A new field, or a value of another type, is another question, and the sentence is not printed.
    const newQuestions = readout(
      roundsTree([
        { passed: above, inputs: mixed(1) },
        { passed: above, inputs: mixed(1).map((input) => ({ ...input, support: "pinned" })) },
        {
          passed: above,
          inputs: mixed(1).map((input) => ("storeys" in input ? { ...input, storeys: "1" } : input)),
        },
      ]),
    );
    expect(newQuestions.allowance).toMatchObject({ rounds: 3, placed: 3, sameSchema: 0 });
    expect(renderReadout(newQuestions, "choose the next experiment")).not.toContain(sentence);
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

// Gate audit 2026-09-25 (docs/gate-audit.md, repeated-public-condition): commented out (unsure): these cases
// pin the admitted-history fingerprints the repeated-condition refusal compared against.
// describe("the prior public fingerprints the repeated-condition refusal compares against", () => {
//   /** One battery's recorded public projection, written the way the run records it. */
//   function writeProjection(tree: string, runId: string, inputs: readonly JsonValue[]): void {
//     const evidence = new EvidenceLog(join(tree, "runs", runId));
//     inputs.forEach((publicInput, i) =>
//       evidence.write(`cases/t${String(i)}/public-task.json`, {
//         taskId: `t${String(i)}`,
//         publicTask: { publicInput },
//       }),
//     );
//     evidence.record();
//   }
//
//   function measured(runId: string, count: number, harnessId: string | null = "product-a") {
//     return {
//       harnessId,
//       battery: {
//         runId,
//         batterySha256: `sha-${runId}`,
//         n: count,
//         passed: count,
//         unaccepted: 0,
//         measured: { items: [] },
//       },
//       authoring: {
//         taskSetHash: `set-${runId}`,
//         caseIds: Array.from({ length: count }, (_, i) => `t${String(i)}`),
//         familySummary: [],
//         effort: null,
//         familyEffort: [],
//         calibration: null,
//         passedTaskIds: [],
//         solveWallMinutes: 120,
//       },
//     };
//   }
//
//   const print = (inputs: readonly JsonValue[]) =>
//     publicBatteryFingerprint(inputs.map((publicInput) => ({ publicInput })));
//
//   it("binds each measured exam to the product that measured it, so another product may measure it", () => {
//     // A shared pack is how a harness intervention is compared: B on A's exam is B's first reading.
//     const tree = tmp();
//     const examX = [{ span: 1 }, { span: 2 }];
//     writeProjection(tree, "a-on-x", examX);
//     writeProjection(tree, "b-on-y", [{ span: 3 }, { span: 4 }]);
//     const prints = priorPublicFingerprints(tree, [measured("a-on-x", 2), measured("b-on-y", 2, "product-b")]);
//     expect(prints).toContain(productConditionFingerprint("product-a", print(examX)));
//     expect(prints).not.toContain(productConditionFingerprint("product-b", print(examX)));
//     // A battery without a recorded product is attributed to none.
//     expect(priorPublicFingerprints(tree, [measured("a-on-x", 2, null)])).toEqual([]);
//   });
//
//   it("prints an exam by its public inputs, so a controls or expectations edit does not reset it", () => {
//     const tree = tmp();
//     const exam = Array.from({ length: 6 }, (_, span) => ({ span }));
//     writeProjection(tree, "first", exam);
//     writeProjection(tree, "repaired", exam);
//     const prints = priorPublicFingerprints(tree, [measured("first", 6), measured("repaired", 6)]);
//     expect(prints).toContain(productConditionFingerprint("product-a", print(exam)));
//     expect(new Set(prints).size).toBe(1);
//   });
//
//   it("yields no fingerprint for a battery whose projection cannot be read, rather than a partial one", () => {
//     // Hashing an absent field would collapse distinct batteries onto one sentinel print and refuse
//     // honest fresh sets.
//     const tree = tmp();
//     mkdirSync(join(tree, "runs", "drifted", "cases", "t0"), { recursive: true });
//     writeFileSync(
//       join(tree, "runs", "drifted", "cases", "t0", "public-task.json"),
//       JSON.stringify({ taskId: "t0", publicTask: {} }),
//     );
//     expect(priorPublicFingerprints(tree, [measured("drifted", 1)])).toEqual([]);
//     expect(priorPublicFingerprints(tree, [measured("absent", 1)])).toEqual([]);
//   });
// });

/**
 * The climb-evidence reader: one recorded population, and the climb readout's off-aim allowance
 * read from it on disk.
 *
 * `admitBattery` decides whether each run directory belongs here at all and names every refusal;
 * `test/climb-battery-admission.test.ts` owns those gates. What is left — and what this file states
 * — is the population law and the reading: every directory holding a battery is in `admitted` or in
 * `excluded`, never both and never neither, except a claim-refused battery a recorded clock can
 * place, which keeps a history row and enters no rate. Chronology is the claim's own `createdAt`,
 * never file mtime: in run 9 a file 71 minutes older made the selector climb.
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
import { required } from "./helpers/doubles.ts";
import { fixtureThresholdDigest } from "./helpers/thresholds.ts";

/** One recorded time for every battery here, so an ordering test orders on something else. */
const RECORDED_AT = "2026-01-01T00:00:00.000Z";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import {
  type AdmittedClimbRow,
  type ClimbBatteriesRead,
  climbThresholds,
  excludedSummary,
  priorPublicFingerprints,
  productConditionFingerprint,
  publicBatteryFingerprint,
  readClimbBatteries,
} from "../src/run/climb-history.ts";
import { POLICY } from "../src/critic/policy.ts";
import { allowanceStop, readClimbReadout, renderReadout } from "../src/run/climb-readout.ts";

const RUN_PIN = "test/pin";
const BAND: [number, number] = [0.2, 0.5];

/** One recorded case row. Only what a reader downstream actually consumes: the scored verdict, the
 *  accepted-submit flag the unaccepted count reads, the solver's tool calls, and the public input
 *  the run records beside the case. */
interface CaseRow {
  taskId?: string | null;
  pass: boolean | null;
  acceptedSubmit?: boolean;
  toolCalls?: number;
  publicInput?: JsonValue;
}

type BatteryFields = { [field: string]: JsonValue | undefined };

const tmp = () => mkdtempSync(join(tmpdir(), "ana-climb-history-"));

function caseRecord(row: CaseRow): JsonValue {
  return {
    ...keyIfDefined("taskId", row.taskId === null ? undefined : (row.taskId ?? "t")),
    pass: row.pass,
    acceptedSubmit: row.acceptedSubmit ?? row.pass !== null,
    ...keyIfDefined("solver", row.toolCalls === undefined ? undefined : { toolCalls: row.toolCalls }),
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
  evidence.record();
  writeClaim(tree, runId, createdAt, true);
}

function writeClaim(
  tree: string,
  runId: string,
  createdAt: string,
  ok: boolean,
  clause = "grounding-missing",
): void {
  mkdirSync(join(tree, "claims"), { recursive: true });
  writeFileSync(
    join(tree, "claims", `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      createdAt,
      claim: ok ? { ok: true } : { ok: false, clauses: [{ clause }] },
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
  it("answers empty for a tree no battery ever measured", () => {
    const view = read(tmp());

    expect(view).toEqual({ history: [], admitted: [], excluded: [] });
  });

  it("puts a claim-refused battery in the history and out of the rate, carrying its own refusal", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(5), RECORDED_AT);
    writeBattery(tree, "r2", passes(5), "2026-01-02T00:00:00.000Z");
    writeClaim(tree, "r2", "2026-01-02T00:00:00.000Z", false);

    const view = read(tree);

    // Run 8's shape: an older reader took a refused battery's zeros for a too-hard base level.
    expect(runIds(view.history)).toEqual(["r1", "r2"]);
    expect(runIds(view.admitted)).toEqual(["r1"]);
    expect(view.history[1]?.excludedReason).toContain("claim refused: grounding-missing");
    expect(view.excluded.map((row) => row.runId)).toEqual(["r2"]);
  });

  it("orders by the claims' recorded createdAt — touching a file never reorders history", () => {
    const tree = tmp();
    writeBattery(tree, "later", passes(3), "2026-01-09T00:00:00.000Z");
    writeBattery(tree, "earlier", passes(3), RECORDED_AT);
    // In run 9 the version without advisers had a file 71 minutes older, and that alone climbed.
    const stale = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(join(tree, "claims", "earlier.json"), stale, stale);

    expect(runIds(read(tree).history)).toEqual(["earlier", "later"]);
  });

  it("breaks a createdAt tie on the run id, so one clock never leaves the order undecided", () => {
    const tree = tmp();
    writeBattery(tree, "rb", passes(3), RECORDED_AT);
    writeBattery(tree, "ra", passes(3), RECORDED_AT);

    expect(runIds(read(tree).history)).toEqual(["ra", "rb"]);
  });

  it("orders exclusions by run id, so the list does not depend on the directory that held them", () => {
    const tree = tmp();
    writeBattery(tree, "rb", passes(3), RECORDED_AT, { backendPin: "other/pin" });
    writeBattery(tree, "ra", passes(3), "2026-01-02T00:00:00.000Z", { backendPin: "other/pin" });

    expect(read(tree).excluded.map((row) => row.runId)).toEqual(["ra", "rb"]);
  });
});

describe("what one battery contributes to the reading", () => {
  it("keeps non-results out of the denominator and unaccepted attempts in it", () => {
    const tree = tmp();
    writeBattery(
      tree,
      "r1",
      [
        { taskId: "a", pass: true },
        { taskId: "b", pass: false },
        { taskId: "c", pass: false, acceptedSubmit: false },
        { taskId: "d", pass: null },
      ],
      RECORDED_AT,
    );

    const battery = read(tree).admitted[0]?.battery;

    expect(battery?.n).toBe(3);
    expect(battery?.passed).toBe(1);
    expect(battery?.unaccepted).toBe(1);
  });

  it("names which cases failed, and calls the set unknown when one failing row carries no id", () => {
    const tree = tmp();
    writeBattery(
      tree,
      "named",
      [
        { taskId: "a", pass: true },
        { taskId: "b", pass: false },
      ],
      RECORDED_AT,
    );
    writeBattery(
      tree,
      "blank",
      [
        { taskId: "a", pass: true },
        { taskId: null, pass: false },
      ],
      "2026-01-02T00:00:00.000Z",
    );

    const view = read(tree);

    expect(view.admitted[0]?.battery.failedTaskIds).toEqual(["b"]);
    // Unknown, never "nothing failed".
    expect(view.admitted[1]?.battery.failedTaskIds).toBeUndefined();
    expect(view.admitted[1]?.battery.passed).toBe(1);
  });

  it("records the condition labels a battery carries, without claiming they are comparable", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(3), RECORDED_AT, { thresholdManifestDigest: "digest-a" });

    expect(read(tree).admitted[0]?.condition).toEqual({
      backendPin: RUN_PIN,
      thresholdManifestDigest: "digest-a",
      variant: "shipping",
    });
  });

  it("summarises families hardest-name-first and drops a row carrying no readable sample", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(4), RECORDED_AT, {
      measured: {
        items: [
          { item: "void-span", attempts: 2, passes: 1 },
          { item: "arch", attempts: 2, passes: 2 },
          { item: "  ", attempts: 2, passes: 1 },
          { item: "empty", attempts: 0, passes: 0 },
        ],
      },
    });

    const summary = read(tree).admitted[0]?.authoring.familySummary ?? [];

    expect(summary.map((row) => row.family)).toEqual(["arch", "void-span"]);
    expect(summary[1]).toMatchObject({ family: "void-span", attempts: 2, passes: 1 });
  });

  it("keeps every case id in the authoring row, disclosing the ones without one", () => {
    const tree = tmp();
    writeBattery(
      tree,
      "r1",
      [
        { taskId: "a", pass: true },
        { taskId: null, pass: null },
      ],
      RECORDED_AT,
    );

    expect(read(tree).admitted[0]?.authoring.caseIds).toEqual(["a", null]);
  });

  it("reads history across model pins when no pin is stated, keeping each battery's own label", () => {
    const tree = tmp();
    writeBattery(tree, "r1", passes(3), RECORDED_AT, { backendPin: "other/pin" });

    expect(read(tree, null).admitted[0]?.condition.backendPin).toBe("other/pin");
    expect(read(tree).admitted).toEqual([]);
  });
});

describe("the refusals, summarised for the author", () => {
  it("says nothing when nothing was excluded", () => {
    expect(excludedSummary([], 3)).toBeNull();
  });

  it("states the excluded count against the admitted one and names each battery", () => {
    const summary = excludedSummary(
      [
        { runId: "r1", reason: "not comparable", claimRefused: false },
        { runId: "r2", reason: "claim refused", claimRefused: true },
      ],
      1,
    );

    expect(summary).toBe(
      "2 of 3 recorded batteries excluded from difficulty evidence: not comparable — r1; claim refused — r2",
    );
  });

  it("groups one shared reason and counts the rest, instead of repeating the sentence per run", () => {
    // Reading planar-truss-synthesis-lay-199f6a55-14 at another pin excluded all sixteen of its
    // batteries; the per-run form wrote the same sentence sixteen times, 2,265 characters.
    const rows = Array.from({ length: 6 }, (_, i) => ({
      runId: `r${String(i)}`,
      reason: "not comparable",
      claimRefused: false,
    }));

    const summary = excludedSummary(rows, 0);

    expect(summary).toContain("not comparable — r0, r1, r2, r3 and 2 more");
    expect(summary?.match(/not comparable/g)).toHaveLength(1);
  });
});

describe("the frozen climb thresholds a round reads", () => {
  const manifest = (body: string): string => {
    const path = join(tmp(), "thresholds.frozen.yaml");
    writeFileSync(path, body);
    return path;
  };

  it("takes a stated band, and each invalid or missing field's declared default instead of refusing", () => {
    // Operator direction 2026-07-26: a bad row never blocks a run, per field.
    expect(climbThresholds(manifest("climb:\n  band: [0.3, 0.6]\n")).band).toEqual([0.3, 0.6]);
    expect(climbThresholds(manifest("climb:\n  band: [2, 3]\n")).band).toEqual(BAND);
    expect(climbThresholds(manifest("climb:\n  band: sometimes\n")).band).toEqual(BAND);
    expect(climbThresholds(manifest("significanceGate:\n  z: 1.96\n")).band).toEqual(BAND);
    expect(climbThresholds(join(tmp(), "absent.yaml")).band).toEqual(BAND);
  });
});

describe("the off-aim allowance, read from recorded batteries", () => {
  /** A battery of five, all passing: above the aim of 1 to 2, and significantly so. */
  const above = 5;
  /** A battery of five passing one: on the aim, which ends a run of misses. */
  const onAim = 1;

  /** One battery per round; `null` passes writes a claim-refused battery, `agent: null` one that
   *  records no product identity, and `inputs` the public input of each of its five tasks. */
  function roundsTree(
    rounds: ReadonlyArray<{ passed: number | null; agent?: string | null; inputs?: readonly JsonValue[] }>,
    thresholdManifestDigest = "digest-a",
  ): string {
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

  it("reads nothing for a tree nothing ever measured, admitted or refused", () => {
    const tree = tmp();
    expect(readClimbReadout(tree, RUN_PIN, join(tree, "claims"))).toBeNull();
  });

  it("counts every trailing battery that missed on the same side, and stops at one on the aim", () => {
    const seen = readout(
      roundsTree([{ passed: above }, { passed: onAim }, { passed: above }, { passed: above }]),
    );
    expect(seen.allowance).toEqual({
      rounds: 2,
      placed: 2,
      refused: 0,
      side: "above",
      products: 1,
      sameSchema: 0,
    });
  });

  it("stops where the product crossed the aim, because that is two runs of misses", () => {
    const seen = readout(roundsTree([{ passed: above }, { passed: above }, { passed: 0 }]));
    expect(seen.allowance).toMatchObject({ rounds: 1, side: "below" });
  });

  it("counts product identities across the run, and an unidentified battery as its own", () => {
    const changed = readout(
      roundsTree([{ passed: above, agent: "agent-old" }, { passed: above }, { passed: above }]),
    );
    expect(changed.allowance).toMatchObject({ rounds: 3, products: 2 });
    // A null identity never proves sameness, so two unidentified batteries are two products.
    const unknown = readout(
      roundsTree([
        { passed: above, agent: null },
        { passed: above, agent: null },
      ]),
    );
    expect(unknown.allowance).toMatchObject({ rounds: 2, products: 2 });
  });

  it("counts a refused round inside the run as one, and none from before it", () => {
    // e6e332 recomputed one too-easy reading across four invocations while every battery behind it
    // was claim-refused. Two refusals behind a battery that then landed on the aim are an earlier
    // story.
    const seen = readout(
      roundsTree([
        { passed: null },
        { passed: null },
        { passed: onAim },
        { passed: above },
        { passed: null },
        { passed: above },
      ]),
    );
    expect(seen.allowance).toEqual({
      rounds: 3,
      placed: 2,
      refused: 1,
      side: "above",
      products: 1,
      sameSchema: 0,
    });
    expect(seen.excluded.filter((row) => row.claimRefused)).toHaveLength(3);
  });

  it("does not count refusals older than the run, so an old exclusion list cannot stop a new run", () => {
    // Reading the campaign-wide exclusion list into a trailing count once made refused, refused,
    // in-band, too-easy report three consecutive off-aim rounds and stop on its first one.
    const rounds = [{ passed: null }, { passed: null }, { passed: 2 }, { passed: above }];
    expect(readout(roundsTree(rounds)).allowance).toMatchObject({ rounds: 1, refused: 0 });
    const beside = readout(roundsTree([...rounds, { passed: null }]));
    expect(beside.allowance).toMatchObject({ rounds: 2, placed: 1, refused: 1 });
  });

  it("reads a set-aside round as the end of the run, since it was not placed off the aim", () => {
    // Every attempt refused at submission is no difficulty evidence, not a battery below the aim.
    const tree = roundsTree([{ passed: above }, { passed: above }]);
    writeBattery(
      tree,
      "r9",
      passes(5).map((row) => ({ ...row, pass: false, acceptedSubmit: false })),
      "2026-09-09T00:00:00Z",
    );
    const seen = readout(tree);
    expect(seen.decision.action).toBe("no-difficulty-evidence");
    expect(seen.rows[0]).toMatchObject({ runId: "r9", zone: null, setAside: "no-difficulty-evidence" });
    expect(seen.allowance).toBeNull();
  });

  it("names the batteries that posed the latest one's task schemas again, whatever values they published", () => {
    // 3fd52f9e-28's first three batteries re-tuned their published numbers under one set of
    // schemas, and a comparison of bytes read each as a new exam.
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

  it("stops at the configured allowance and says what the stop does not establish", () => {
    const limit = POLICY.climb.offAimStreakRounds;
    const rounds = Array.from({ length: limit }, (_, i) => ({ passed: above, agent: `agent-${String(i)}` }));
    const stop = required(allowanceStop(readout(roundsTree(rounds))), "a stop reason");
    expect(stop).toContain(`${String(limit)} consecutive rounds ended above the aim`);
    expect(stop).toContain(`across ${String(limit)} product identities`);
    expect(stop).toContain("does not establish that another product would add no evidence");
    expect(allowanceStop(readout(roundsTree(rounds.slice(1))))).toBeNull();
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

describe("the prior public fingerprints the repeated-condition refusal compares against", () => {
  /** One battery's recorded public projection, written the way the run records it. */
  function writeProjection(tree: string, runId: string, inputs: readonly JsonValue[]): void {
    const evidence = new EvidenceLog(join(tree, "runs", runId));
    inputs.forEach((publicInput, i) =>
      evidence.write(`cases/t${String(i)}/public-task.json`, {
        taskId: `t${String(i)}`,
        publicTask: { publicInput },
      }),
    );
    evidence.record();
  }

  function measured(runId: string, count: number, harnessId: string | null = "product-a") {
    return {
      harnessId,
      battery: {
        runId,
        batterySha256: `sha-${runId}`,
        n: count,
        passed: count,
        unaccepted: 0,
        measured: { items: [] },
      },
      authoring: {
        taskSetHash: `set-${runId}`,
        caseIds: Array.from({ length: count }, (_, i) => `t${String(i)}`),
        familySummary: [],
      },
    };
  }

  const print = (inputs: readonly JsonValue[]) =>
    publicBatteryFingerprint(inputs.map((publicInput) => ({ publicInput })));

  it("binds each measured exam to the product that measured it, so another product may measure it", () => {
    // A measured X, then B measured Y: B on X is B's first reading of X, and a shared pack is how a
    // harness intervention is compared.
    const tree = tmp();
    const examX = [{ span: 1 }, { span: 2 }];
    writeProjection(tree, "a-on-x", examX);
    writeProjection(tree, "b-on-y", [{ span: 3 }, { span: 4 }]);
    const prints = priorPublicFingerprints(tree, [measured("a-on-x", 2), measured("b-on-y", 2, "product-b")]);
    expect(prints).toContain(productConditionFingerprint("product-a", print(examX)));
    expect(prints).not.toContain(productConditionFingerprint("product-b", print(examX)));
    // A battery without a recorded product is attributed to none.
    expect(priorPublicFingerprints(tree, [measured("a-on-x", 2, null)])).toEqual([]);
  });

  it("prints an exam by its public inputs, so a controls or expectations edit does not reset it", () => {
    const tree = tmp();
    const exam = Array.from({ length: 6 }, (_, span) => ({ span }));
    writeProjection(tree, "first", exam);
    writeProjection(tree, "repaired", exam);
    const prints = priorPublicFingerprints(tree, [measured("first", 6), measured("repaired", 6)]);
    expect(prints).toContain(productConditionFingerprint("product-a", print(exam)));
    expect(new Set(prints).size).toBe(1);
  });

  it("yields no fingerprint for a battery whose projection cannot be read, rather than a partial one", () => {
    // Hashing an absent field would collapse distinct batteries onto one sentinel print and refuse
    // honest fresh sets.
    const tree = tmp();
    mkdirSync(join(tree, "runs", "drifted", "cases", "t0"), { recursive: true });
    writeFileSync(
      join(tree, "runs", "drifted", "cases", "t0", "public-task.json"),
      JSON.stringify({ taskId: "t0", publicTask: {} }),
    );
    expect(priorPublicFingerprints(tree, [measured("drifted", 1)])).toEqual([]);
    expect(priorPublicFingerprints(tree, [measured("absent", 1)])).toEqual([]);
  });
});

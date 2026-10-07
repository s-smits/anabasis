/**
 * How many tasks a round's battery has, decided from one placement.
 *
 * Hypothesis: sizing is one reading of one landing. `placeOnBand` over the adopted battery's scored
 * cases says both whether a probe graduates — at least one pass, and a count at or under the aim —
 * and how small a battery past the probe may be, the smallest size that still reads too easy. The
 * sentence that tells the Builder about the probe belongs to the same owner and states its share
 * from the same band, so a declared band moves the rule and its wording together.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  BATTERY_SIZE,
  adoptedTaskCount,
  batterySize,
  batterySizingGate,
  renderProbeSizing,
  taskCountSentence,
} from "../src/run/battery-sizing.ts";
import { directManifest } from "../src/run/direct-input.ts";
import { readClimbReadout } from "../src/run/climb-readout.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import type { RecordedDifficultyDecision } from "../src/run/difficulty-decision.ts";
import { runBuildStep } from "../src/run/full-run-build-step.ts";
import type { FullRunDeps } from "../src/run/full-run.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import {
  MATCHING_TASKS,
  MATCHING_TOOLS_SPEC,
  writeMatchingBuildFixture,
} from "./helpers/matching-fixture.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";
import { double, required } from "./helpers/doubles.ts";
import { writeSettledReview } from "./helpers/review-fixtures.ts";

const PROBE = BATTERY_SIZE.probe;
const exact = (n: number) => ({ min: n, max: n });
const landed = (passes: number, n: number) => () => ({ passes, n });
const none = () => null;
const unread = () => {
  throw new Error("sizing read a battery it did not need");
};

describe("the requested size", () => {
  it("accepts every size inside the policy bounds and refuses outside them instead of clamping", () => {
    const { floor, ceiling } = BATTERY_SIZE;
    expect(batterySize(undefined)).toBe(BATTERY_SIZE.default);
    // The probe's own bounds are ordinary sizes, so a probe round needs no second path.
    for (const n of [floor, PROBE.min, PROBE.max, ceiling]) expect(batterySize(n)).toBe(n);
    // A silently altered operator condition is a silently dropped one: refuse, never clamp.
    const outside = `outside [${floor}, ${ceiling}]`;
    for (const n of [floor - 1, ceiling + 1, double<number>(25.5)]) {
      expect(() => batterySize(n)).toThrow(outside);
    }
  });

  it("is stated once, as one size or as the range the Builder chooses in", () => {
    expect(taskCountSentence({ expectedTasks: 25 })).toBe("Task count: exactly 25 tasks.");
    expect(taskCountSentence({ expectedTasks: 10, minTasks: 5 })).toBe(
      "Task count: between 5 and 10 tasks — choose the size in that range yourself.",
    );
  });

  it("creates the manifest from the slug alone, at the default battery size", () => {
    expect(directManifest("bridge-truss")).toEqual({
      slug: "bridge-truss",
      domain: "bridge-truss",
      expectedTasks: BATTERY_SIZE.default,
    });
  });

  it("counts the adopted battery and reports none before adoption", () => {
    const domain = mkdtempSync(join(tmpdir(), "battery-sizing-domain-"));
    expect(adoptedTaskCount(domain)).toBeNull();
    mkdirSync(join(domain, "correctness-model"));
    writeFileSync(join(domain, "correctness-model", "tasks.json"), JSON.stringify([{}, {}, {}]));
    expect(adoptedTaskCount(domain)).toBe(3);
  });
});

describe("a probe graduates on its placement", () => {
  it("starts a fresh product on the probe range without reading a battery", () => {
    expect(batterySizingGate(25, null, unread)).toEqual(PROBE);
  });

  it("leaves a request no larger than the probe alone, without reading a battery", () => {
    expect(batterySizingGate(10, null, unread)).toEqual(exact(10));
    expect(batterySizingGate(10, 25, unread)).toEqual(exact(10));
  });

  it("graduates once a probe passed at least one case and landed at or under the aim", () => {
    // The aim at seven tasks is 2 to 3 passes; one pass is under it and still located something.
    for (const passes of [1, 2, 3]) expect(batterySizingGate(25, 7, landed(passes, 7))).toEqual(exact(25));
  });

  it("keeps probing after nothing scored, nothing passed, or a count above the aim", () => {
    // 5 of 6 and 7 of 8 are recorded graduations whose requested-size battery then passed 25 of 25
    // and 24 of 25: one failed case among six says the probe held one hard task, not a limit.
    for (const landing of [none, landed(0, 8), landed(8, 8), landed(4, 7), landed(5, 6), landed(7, 8)]) {
      expect(batterySizingGate(25, 8, landing)).toEqual(PROBE);
    }
  });

  it("reads the aim from the run's band, so a declared band moves graduation with the placement", () => {
    // Under [0.2, 0.95] the aim at six tasks runs to 5 passes, so 5 of 6 graduates there.
    expect(batterySizingGate(25, 6, landed(5, 6), [0.2, 0.95])).toEqual(exact(25));
    expect(batterySizingGate(25, 6, landed(5, 6))).toEqual(PROBE);
  });
});

describe("a product past the probe keeps the smallest size that still holds its reading", () => {
  it("re-reads a too-easy battery for less, and never on a reading only its projection makes", () => {
    // 9 of 11 still reads significantly too easy, so eleven buys the 22-of-25 reading for 44% of it.
    expect(batterySizingGate(25, 25, landed(22, 25))).toEqual(exact(11));
    expect(batterySizingGate(25, 25, landed(20, 25))).toEqual(exact(14));
    // 6 of 6 is significantly too easy; 5 of 6 is not, though 9 of 11 at its rate would be.
    expect(batterySizingGate(25, 25, landed(6, 6))).toEqual(exact(11));
    expect(batterySizingGate(25, 25, landed(5, 6))).toEqual(exact(25));
  });

  it("keeps the requested size when no smaller battery holds the reading, or there is none to read", () => {
    for (const landing of [landed(15, 25), landed(13, 25), landed(0, 25), landed(0, 0), none]) {
      expect(batterySizingGate(25, 25, landing)).toEqual(exact(25));
    }
  });

  it("never sizes back down into the probe range", () => {
    for (const passes of [11, 15, 20, 22, 25]) {
      expect(batterySizingGate(25, 25, landed(passes, 25)).min).toBeGreaterThan(PROBE.max);
    }
  });
});

describe("the probe sentence", () => {
  it("states the rule a probe graduates on without a share to author towards", () => {
    expect(renderProbeSizing(PROBE, 25, null)).toBe(
      "Battery sizing: this product's batteries stay at the task count above until one passes some of its scored cases and the controller reads it as hard enough, then 25.",
    );
  });

  it("is absent past the probe, so nothing there anchors a score", () => {
    for (const landing of [landed(22, 25), landed(15, 25), none]) {
      expect(renderProbeSizing(batterySizingGate(25, 25, landing), 25, 25)).toBeNull();
    }
  });

  // Tasks added at the demand the probe's passing families met passed, and carried the graduated
  // battery back above the aim, so the round a probe graduates in asks for the hardest families'.
  it("asks a graduating round's added tasks for the demand of the hardest families, and no other round", () => {
    const demand = "write the tasks you add at the demand of that battery's hardest families";
    const graduation = required(
      renderProbeSizing(batterySizingGate(25, 6, landed(2, 6)), 25, 6),
      "a graduation sentence",
    );
    expect(graduation).toContain(demand);
    // No count, share or score to author towards (prior 10).
    expect(graduation).not.toMatch(/\d|aim/);
    expect(renderProbeSizing(batterySizingGate(25, 6, landed(5, 6)), 25, 6)).not.toContain(demand);
    expect(renderProbeSizing(batterySizingGate(25, 25, landed(15, 25)), 25, 25)).toBeNull();
  });
});

describe("runBuildStep battery sizing", () => {
  const SLUG = "matching";
  const PIN = "sizing-test";

  /** An adopted battery of `total` tasks, `passes` of which passed. The default is the eight-task
   *  probe whose four retained tasks passed and four changed tasks failed. */
  function probeRoot(recordBattery: boolean, total = 8, passes = 4, band?: [number, number]): string {
    const root = mkdtempSync(join(tmpdir(), "battery-sizing-step-"));
    // Written first, because writeFixtureThresholds keeps a policy the test already stated.
    if (band !== undefined) {
      writeFileSync(join(root, "thresholds.frozen.yaml"), `climb:\n  band: [${band[0]}, ${band[1]}]\n`);
    }
    writeFixtureThresholds(root);
    const domain = join(root, "domains", SLUG);
    writeMatchingBuildFixture(domain);
    const tasks = Array.from({ length: total }, (_, i) => ({ ...MATCHING_TASKS[0], taskId: `probe-${i}` }));
    writeFileSync(join(domain, "correctness-model", "tasks.json"), JSON.stringify(tasks));
    writeBoundRepresentation(domain, "sha256:test-schema", JSON.stringify(MATCHING_TOOLS_SPEC));
    const fingerprint = fingerprintSlug(domain);
    if (!fingerprint.ok) throw new Error("fixture fingerprint refused");
    mkdirSync(claimsDirFor(root, SLUG), { recursive: true });
    if (!recordBattery) return root;
    const evidence = new EvidenceLog(join(domain, "runs", "probe"));
    evidence.write("battery.json", {
      runId: "probe",
      backendPin: PIN,
      thresholdManifestDigest: fixtureThresholdDigest(root),
      condition: { variant: "shipping" },
      bundleSnapshot: {
        agentHash: fingerprint.agentHash,
        correctnessModelHash: fingerprint.correctnessModelHash,
        scoringHash: fingerprint.scoringHash,
        taskSetHash: fingerprint.taskSetHash,
      },
      execution: { tools: {}, verifierEnvironmentHash: null },
      cases: tasks.map((task, i) => ({
        taskId: task.taskId,
        pass: i < passes,
        acceptedSubmit: true,
        truthOk: i < passes,
      })),
      measured: { items: [], changedSubset: { attempts: 4, passes: 0 } },
    });
    evidence.record();
    writeFileSync(
      join(claimsDirFor(root, SLUG), "probe.json"),
      JSON.stringify({
        schema: "run-claim/v1",
        runId: "probe",
        createdAt: "2026-09-17T00:00:00Z",
        claim: { ok: true },
      }),
    );
    return root;
  }

  async function sizedRound(
    root: string,
    difficulty: RecordedDifficultyDecision | null,
    move: "build" | "rebuild" = "rebuild",
  ) {
    const seen: Array<{
      expectedTasks: number;
      minTasks?: number;
      note?: string;
    }> = [];
    const build: FullRunDeps["build"] = async (manifest, options) => {
      seen.push({
        expectedTasks: manifest.expectedTasks,
        ...keyIfDefined("minTasks", manifest.minTasks),
        ...keyIfDefined("note", options?.advisoryNote),
      });
      return double({
        buildAdmissible: false,
        adopted: false,
        clause: "iterations-exhausted",
        iterations: [],
      });
    };
    await runBuildStep(
      double({
        args: {},
        repoRoot: root,
        manifest: { slug: SLUG, domain: SLUG, expectedTasks: 25 },
        runId: "next",
        runPin: PIN,
        slots: {},
        userContext: EMPTY_USER_CONTEXT,
        deps: { build },
        observer: createRunObserver(root, SLUG, "next"),
      }),
      { move, reason: "Choose the next experiment." },
      { kickoff: "assign parts", prior: null, lineage: null, difficulty },
    );
    return required(seen[0], "build call");
  }

  /** The readout the controller would record for this tree, read the way the round reads it. */
  function recordedReadout(root: string): RecordedDifficultyDecision | null {
    const readout = readClimbReadout(join(root, "domains", SLUG), PIN, { repoRoot: root, slug: SLUG });
    return readout === null
      ? null
      : double<RecordedDifficultyDecision>({ path: "decision.json", evidence: { difficulty: readout } });
  }

  it("expands after a probe on the aim while the readout reads its changed subset", async () => {
    const root = probeRoot(true);
    const round = await sizedRound(root, recordedReadout(root));
    expect(round).toMatchObject({ expectedTasks: 25 });
    expect(round.minTasks).toBeUndefined();
    // Sizing reads the whole probe, 4 of 8; the readout reads the changed subset, 0 of 4.
    expect(round.note).toContain("passed 0 of 4");
    expect(round.note).toContain(required(renderProbeSizing(exact(25), 25, 8), "a graduation sentence"));
    expect(round.note).not.toContain("the controller reads it as hard enough");
  });

  it("keeps a probe above the aim on probes and says what it must pass", async () => {
    const round = await sizedRound(probeRoot(true, 8, 7), null);
    expect(round).toMatchObject({ expectedTasks: 10, minTasks: 5 });
    expect(round.note).toContain("the controller reads it as hard enough");
    expect(round.note).not.toMatch(/\d+%/);
  });

  it("keeps probing when the fails that put a probe on the aim were settled against their check", async () => {
    // 2 of 6 is on the aim and graduates; with its four fails settled against the one check that
    // decided each, it reads 2 of 2, above the aim.
    const root = probeRoot(true, 6, 2);
    expect(await sizedRound(root, null)).toMatchObject({ expectedTasks: 25 });
    const settled = ["probe-2", "probe-3", "probe-4", "probe-5"].map((taskId) => ({ taskId }));
    writeSettledReview(join(dirname(claimsDirFor(root, SLUG)), "analysis"), "probe", settled);
    expect(await sizedRound(root, null)).toMatchObject({ expectedTasks: 10, minTasks: 5 });
  });

  it("sizes a round past the probe by the whole battery, and adds no note", async () => {
    const round = await sizedRound(probeRoot(true, 25, 22), null);
    expect(round.expectedTasks).toBe(11);
    expect(round.minTasks).toBeUndefined();
    expect(round.note ?? "").not.toContain("Battery sizing");
  });

  it("keeps the requested size past the probe when the adopted product does not fingerprint", async () => {
    // An unbindable tree has no landing this round may attribute to it; sizing only ever buys a
    // saving, so it gives the saving up rather than refusing the round.
    const root = probeRoot(true, 25, 22);
    rmSync(join(root, "domains", SLUG, "agent", "tools-spec.json"));
    expect(await sizedRound(root, null)).toMatchObject({ expectedTasks: 25 });
  });

  it("gives a fresh build the range and its rule, and no pass count to author towards", async () => {
    const fresh = await sizedRound(probeRoot(false), null, "build");
    expect(fresh).toMatchObject({ expectedTasks: 10, minTasks: 5 });
    const note = required(fresh.note, "a sizing note");
    expect(note).toContain(renderProbeSizing(PROBE, 25, null) ?? "");
    for (const count of ["verified pass", "aim", "finds no limit"]) expect(note).not.toContain(count);
  });

  it("moves the gate with a declared band, and states no share of it", async () => {
    const declared: [number, number] = [0.2, 0.95];
    // 22 of 25 holds too-easy at eleven tasks under the code-owned ceiling and at no size under 0.95.
    expect(await sizedRound(probeRoot(true, 25, 22), null)).toMatchObject({ expectedTasks: 11 });
    expect(await sizedRound(probeRoot(true, 25, 22, declared), null)).toMatchObject({ expectedTasks: 25 });
    const fresh = await sizedRound(probeRoot(false, 8, 4, declared), null, "build");
    expect(fresh.note).toBe(required(renderProbeSizing(PROBE, 25, null), "a probe sentence"));
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  BATTERY_SIZE,
  adoptedTaskCount,
  batterySize,
  batterySizingGate,
  taskCountSentence,
} from "../src/run/battery-sizing.ts";
import { directManifest } from "../src/run/direct-input.ts";
import { POLICY } from "../src/critic/policy.ts";
import { readClimbReadout, renderBatteryContract, renderProbeSizing } from "../src/run/climb-readout.ts";
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

const PROBE = { min: 5, max: 10 };

const continuation = (n: number, min = n, band = POLICY.climb.band) =>
  renderBatteryContract(n, min, band, true);

describe("batterySize", () => {
  it("bounds every requested size and REFUSES out of range instead of clamping", () => {
    expect(batterySize(undefined)).toBe(25);
    expect(batterySize(BATTERY_SIZE.floor)).toBe(5);
    expect(batterySize(BATTERY_SIZE.ceiling)).toBe(60);
    // A silently altered operator condition is a silently dropped one: refuse, never clamp.
    expect(() => batterySize(4)).toThrow(/outside \[5, 60\]/);
    expect(() => batterySize(61)).toThrow(/outside \[5, 60\]/);
    expect(() => batterySize(double(25.5))).toThrow(/outside/);
  });

  it("accepts the probe's own bounds, so a probe round is an ordinary size", () => {
    expect(batterySize(PROBE.min)).toBe(PROBE.min);
    expect(batterySize(PROBE.max)).toBe(PROBE.max);
  });
});

describe("taskCountSentence", () => {
  it("states one size, or the range the Builder chooses in", () => {
    expect(taskCountSentence({ expectedTasks: 25 })).toBe("Task count: exactly 25 tasks.");
    expect(taskCountSentence({ expectedTasks: 10, minTasks: 5 })).toBe(
      "Task count: between 5 and 10 tasks — choose the size in that range yourself.",
    );
  });
});

describe("batterySizingGate", () => {
  const none = () => null;
  const landed = (passes: number, n: number) => () => ({ passes, n });
  const unread = () => {
    throw new Error("sizing read a battery it did not need");
  };

  it("measures a fresh product at the probe range first", () => {
    expect(batterySizingGate(25, null, unread)).toEqual(PROBE);
  });

  it("keeps probing after a probe that passed none, all or scored nothing", () => {
    for (const landing of [landed(0, 8), landed(8, 8), none]) {
      expect(batterySizingGate(25, 8, landing)).toEqual(PROBE);
    }
  });

  it("expands after a mixed probe", () => {
    for (const passes of [3, 4]) {
      expect(batterySizingGate(25, 7, landed(passes, 7))).toEqual({ min: 25, max: 25 });
    }
  });

  it("leaves a request no larger than the probe alone, without reading a battery", () => {
    expect(batterySizingGate(10, null, unread)).toEqual({ min: 10, max: 10 });
    expect(batterySizingGate(10, 25, unread)).toEqual({ min: 10, max: 10 });
  });

  it("sizes a product past the probe to the smallest battery that still carries its last reading", () => {
    // Truss de8b40 measured 22 of 25 and then paid 25 solves a round to re-read the same thing.
    // Nine of eleven still reads significantly too easy, so eleven buys the reading for 44% of it.
    expect(batterySizingGate(25, 25, landed(22, 25))).toEqual({ min: 11, max: 11 });
    expect(batterySizingGate(25, 25, landed(6, 6))).toEqual({ min: 11, max: 11 });
    expect(batterySizingGate(25, 25, landed(20, 25))).toEqual({ min: 14, max: 14 });
  });

  it("keeps the requested size whenever no smaller battery holds the reading", () => {
    // 0.6 and 0.52 sit too close to the band's upper edge for any size below 25 to exclude it.
    expect(batterySizingGate(25, 25, landed(15, 25))).toEqual({ min: 25, max: 25 });
    expect(batterySizingGate(25, 25, landed(13, 25))).toEqual({ min: 25, max: 25 });
    // A battery the solver failed outright is the too-hard side, which no size below 25 reads either.
    expect(batterySizingGate(25, 25, landed(0, 25))).toEqual({ min: 25, max: 25 });
  });

  it("keeps the requested size when the product past the probe has no landing to read", () => {
    expect(batterySizingGate(25, 25, none)).toEqual({ min: 25, max: 25 });
    expect(batterySizingGate(25, 25, landed(0, 0))).toEqual({ min: 25, max: 25 });
  });

  it("never sizes a product past the probe back down into the probe range", () => {
    // Six reads too easy only at 6 of 6, and a rate under 1 floors below that, so a probe-sized
    // round past the probe would buy no reading at all. The saving never buys the reading.
    for (const passes of [11, 15, 20, 22, 25]) {
      expect(batterySizingGate(25, 25, landed(passes, 25)).min).toBeGreaterThan(BATTERY_SIZE.probe.max);
    }
  });

  it("tells the Builder nothing about the size it chose past the probe, so no note anchors a score", () => {
    // The count reaches the author through taskCountSentence alone (rule 14, one owner per sentence).
    for (const landing of [landed(22, 25), landed(15, 25), none]) {
      expect(renderProbeSizing(batterySizingGate(25, 25, landing), 25)).toBeNull();
    }
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
      band?: [number, number];
    }> = [];
    const build: FullRunDeps["build"] = async (manifest, options) => {
      seen.push({
        expectedTasks: manifest.expectedTasks,
        ...keyIfDefined("minTasks", manifest.minTasks),
        ...keyIfDefined("note", options?.advisoryNote),
        ...keyIfDefined("band", options?.band),
      });
      return double({ buildAdmissible: false, adopted: false, clauses: ["fixture-stop"], iterations: [] });
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
      { move, seed: "adopted", reason: "Choose the next experiment." },
      { kickoff: "assign parts", prior: null, lineage: null, difficulty },
    );
    return required(seen[0], "build call");
  }

  /** The readout the controller would record for this tree, read the way the round reads it. */
  function recordedReadout(root: string): RecordedDifficultyDecision | null {
    const readout = readClimbReadout(
      join(root, "domains", SLUG),
      PIN,
      claimsDirFor(root, SLUG),
      join(root, "thresholds.frozen.yaml"),
    );
    return readout === null
      ? null
      : double<RecordedDifficultyDecision>({ path: "decision.json", evidence: { difficulty: readout } });
  }

  it("expands after a mixed probe while the readout reads its changed subset", async () => {
    const root = probeRoot(true);
    const round = await sizedRound(root, recordedReadout(root));
    expect(round.expectedTasks).toBe(25);
    expect(round.minTasks).toBeUndefined();
    // Sizing reads the whole probe, 4 of 8; the readout reads the changed subset, 0 of 4.
    expect(round.note).toContain("passed 0 of 4");
    expect(round.note).not.toContain("Battery sizing");
  });

  it("sizes a round past the probe to the size its last battery's reading survives at", async () => {
    // Truss de8b40 measured 22 of 25 and then paid 25 solves a round to re-read the same thing.
    const round = await sizedRound(probeRoot(true, 25, 22), null);
    // Sizing reads the whole battery, 22 of 25, not the changed subset the difficulty selector uses.
    expect(round.expectedTasks).toBe(11);
    expect(round.minTasks).toBeUndefined();
    // No note: the count reaches the author through taskCountSentence alone, so nothing here tells
    // a Builder what its next battery is expected to score.
    expect(round.note ?? "").not.toContain("Battery sizing");
  });

  it("keeps the requested size past the probe when the adopted product does not fingerprint", async () => {
    // An unbindable tree has no landing this round may attribute to it. Sizing only ever buys a
    // saving, so it gives the saving up rather than refusing the round over it.
    const root = probeRoot(true, 25, 22);
    rmSync(join(root, "domains", SLUG, "agent", "tools-spec.json"));
    expect(await sizedRound(root, null)).toMatchObject({ expectedTasks: 25 });
  });

  /** The counts a round is authored against have one owner, and it is the start prompt.
   *
   *  A "measurement note" briefly filled the null a round with no recorded placement leaves,
   *  stating the first battery's count, the count that finds no limit and the aim. On a fresh build
   *  those are the three counts the first-battery contract had already put in the same context
   *  block, word for word; on a continuation whose readout could not be read, they are the
   *  first-battery count the continuation contract exists to keep out — the "Expect about 3 of 25"
   *  beside a measurement reporting 24 of 25. */
  it("leaves the pass counts to the prompt that owns them, and adds no second owner", async () => {
    const fresh = await sizedRound(probeRoot(false), null, "build");
    expect(fresh).toMatchObject({ expectedTasks: 10, minTasks: 5 });
    const note = required(fresh.note, "a sizing note");
    expect(note).toContain(
      "batteries have 5 to 10 tasks until one passes some but not all of its scored cases, then 25",
    );
    for (const count of ["verified pass", "aim", "finds no limit"]) expect(note).not.toContain(count);
    // A fresh build is told all three counts, per size, by the prompt that owns them.
    expect(renderBatteryContract(10, 5)).toContain(
      "5 tasks — author for about 1, aim 1 to 2, 5 or more finds no limit",
    );
    // A continuation is told the aim and never the first battery's count.
    expect(continuation(25)).toContain("Aim for 5 to 12 of 25");
    expect(continuation(25)).not.toContain("Expect about");
  });

  /** One number, three owners: the band.
   *
   *  `climb.band` is a manifest row, and `climbThresholds` reads it. Until 2026-09-21 two consumers
   *  did not: the prompt contract and `battery-sizing` read the `POLICY.climb` constant
   *  directly. A run that declared its own band therefore had its placement read against the
   *  declared one while the Builder was told to aim at the code-owned counts and the sizing gate
   *  held the code-owned ceiling — three readings of one number, agreeing only while nothing
   *  overrode it, so no test ever saw them disagree. This declares a band and asserts all three
   *  move together.
   *
   *  [0.2, 0.95] is the contrast that makes each visible: at 25 cases no count is significantly too
   *  easy under it, and 22 of 25 no longer holds "too easy" at any size below the requested one. */
  it("moves the prompt counts and the sizing gate with a declared band, not only the placement", async () => {
    const declared: [number, number] = [0.2, 0.95];
    // Same battery, same 22 of 25: under the code-owned ceiling it holds too-easy at eleven tasks.
    expect(await sizedRound(probeRoot(true, 25, 22), null)).toMatchObject({ expectedTasks: 11 });
    const round = await sizedRound(probeRoot(true, 25, 22, declared), null);
    // Under the declared ceiling no smaller size holds the reading, so the round keeps its size.
    expect(round.expectedTasks).toBe(25);
    // And the band the controller read is the one the authoring session is handed.
    expect(round.band).toEqual(declared);
    // The Builder's sentences are written from that band, not from the policy row.
    expect(continuation(25, 25, declared)).toContain("Aim for 5 to 23 of 25");
    expect(continuation(25, 25, declared)).toContain("At 25 cases no pass count is significantly too easy");
    expect(continuation(25)).toContain("Aim for 5 to 12 of 25");
  });

  /** The readout reports the latest battery's target either way — met, missed with a distance, or
   *  undetermined by non-results — so the contract names the comparator's direction and that one
   *  reader, and no reader that does not exist. */
  it("says which comparator the direction asks for, and what the next round does with it", () => {
    const contract = continuation(25);
    expect(contract).toContain(
      "at-most when it should pass fewer cases than the last one did, at-least when it should pass more",
    );
    expect(contract).toContain("reports whether that target was met and, when it was missed, by how much");
    expect(contract).not.toContain("the next round reports how far the measurement landed from it");
  });
});

describe("adoptedTaskCount", () => {
  it("counts the adopted battery and reports none before adoption", () => {
    const domain = mkdtempSync(join(tmpdir(), "battery-sizing-domain-"));
    expect(adoptedTaskCount(domain)).toBeNull();
    mkdirSync(join(domain, "correctness-model"));
    writeFileSync(join(domain, "correctness-model", "tasks.json"), JSON.stringify([{}, {}, {}]));
    expect(adoptedTaskCount(domain)).toBe(3);
  });
});

it("creates the manifest from the slug alone, at the default battery size", () => {
  // The manifest carries routing only: the slug owns the campaign identity and the battery
  // size, and the engines come from what the Builder declares in the candidate bundle.
  expect(directManifest("bridge-truss")).toEqual({
    slug: "bridge-truss",
    domain: "bridge-truss",
    expectedTasks: BATTERY_SIZE.default,
  });
  expect(directManifest("truss-w36-sol").slug).toBe("truss-w36-sol");
});

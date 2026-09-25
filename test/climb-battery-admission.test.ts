/**
 * Battery admission: whether one recorded run directory belongs to this tree's difficulty history.
 *
 * `admitBattery` is a sequence of gates over one run dir, and every refusal is settled here rather
 * than downstream, so each row below names one gate and the bytes that trip it. A battery measured
 * under a foreign pin, another frozen manifest or another condition is not this history; a claim
 * refused for the tasks keeps the battery readable and out of the rate; and the two environment
 * clauses keep the rate, because the tasks did not cause the outage.
 *
 * What is admitted is a row, not a reading. History order, the ledger, the notes and the band
 * arithmetic belong to their own owners and are tested there.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { sha256 } from "../src/meta/digest.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { EvidenceLog, RUN_MANIFEST_NAME } from "../src/claim/evidence-log.ts";
import {
  type ThresholdIdentity,
  admitBattery,
  currentThresholdDigest,
  harnessBundleIdentity,
} from "../src/run/climb-battery-admission.ts";
import { required } from "./helpers/doubles.ts";

const RUN_PIN = "test/pin";
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const UNSTATED: ThresholdIdentity = { kind: "unstated" };
const DIGEST_A: ThresholdIdentity = { kind: "digest", digest: "digest-a" };

/** Battery fields a case replaces. `undefined` is a value here, not an absence: it is how a case
 *  records a battery MISSING one field, which is what several refusals are about. */
type BatteryFields = { [field: string]: JsonValue | undefined };

const tmp = () => mkdtempSync(join(tmpdir(), "ana-admission-"));

/** Write one recorded battery the way the runner does — through the real evidence writer, so the
 *  ownership check a case does not target always passes. */
function writeBattery(tree: string, runId: string, overrides: BatteryFields = {}): string {
  const dir = join(tree, "runs", runId);
  const evidence = new EvidenceLog(dir);
  evidence.write("battery.json", {
    runId,
    backendPin: RUN_PIN,
    thresholdManifestDigest: "digest-a",
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", scoringHash: "scoring-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: [{ taskId: "t", pass: true, acceptedSubmit: true }],
    measured: { items: [] },
    ...overrides,
  });
  evidence.record();
  return dir;
}

/** Raw claim-file bytes beside the battery, for the cases whose subject is the file itself. */
function writeClaimFile(tree: string, runId: string, bytes: string): void {
  mkdirSync(join(tree, "claims"), { recursive: true });
  writeFileSync(join(tree, "claims", `${runId}.json`), bytes);
}

/** The claim beside it. A battery with no claim of its own is how the "no claim evidence" refusal
 *  is written, so nothing here creates one by default. */
function writeClaim(
  tree: string,
  runId: string,
  claim: JsonObject,
  createdAt: string | null = CREATED_AT,
): void {
  const envelope = {
    schema: "run-claim/v1",
    runId,
    ...keyIfDefined("createdAt", createdAt ?? undefined),
    claim,
  };
  writeClaimFile(tree, runId, JSON.stringify(envelope));
}

function admit(
  tree: string,
  runId: string,
  pin: string | null = RUN_PIN,
  digest: ThresholdIdentity = UNSTATED,
) {
  return admitBattery(join(tree, "runs", runId), runId, pin, digest, join(tree, "claims"));
}

/** One line naming the verdict: admitted, kept out of the rate for a reason, or refused for one.
 *  A failing expectation then reads as the wrong verdict rather than as a property of null. */
function verdictOf(admission: ReturnType<typeof admitBattery>): string {
  if (admission === null) return "<no battery>";
  if (admission.excluded === null) return "admitted";
  const kind = admission.excluded.claimRefused ? "claim" : "gate";
  return `${admission.ok ? "kept out" : "refused"} (${kind}): ${admission.excluded.reason}`;
}

/** The harness these bytes measured, or null for a refusal as well as for evidence stating none. */
function harnessIdOf(admission: ReturnType<typeof admitBattery>): string | null {
  return admission?.ok === true ? admission.harnessId : null;
}

describe("admission — the ordinary battery, and the directory that holds none", () => {
  it("admits a recorded battery with an accepted claim, carrying the manifest's own battery hash", () => {
    const tree = tmp();
    const dir = writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: true });

    const admission = admit(tree, "r1");

    expect(verdictOf(admission)).toBe("admitted");
    if (admission?.ok !== true) return;
    expect([admission.runId, admission.createdAt]).toEqual(["r1", CREATED_AT]);
    // The recorded battery.json digest, not a hash of other bytes such as the task set.
    const manifest = parseJsonAs<{ files: Record<string, string> }>(
      readFileSync(join(dir, RUN_MANIFEST_NAME), "utf8"),
    );
    expect(admission.batterySha256).toBe(
      required(manifest.files["battery.json"], "the recorded battery digest"),
    );
  });

  it("answers null for a directory holding no battery — an empty dir is not a refusal", () => {
    const tree = tmp();
    mkdirSync(join(tree, "runs", "r1"), { recursive: true });

    expect(admit(tree, "r1")).toBeNull();
  });
});

describe("admission — the gates over the battery's own bytes", () => {
  it.each<[string, BatteryFields, string | null, ThresholdIdentity, string]>([
    ["a relocated dir", { runId: "somewhere-else" }, RUN_PIN, UNSTATED, "different runId than its directory"],
    ["no run id", { runId: undefined }, RUN_PIN, UNSTATED, "states no run id or case rows"],
    ["no case rows", { cases: undefined }, RUN_PIN, UNSTATED, "states no run id or case rows"],
    [
      "a case row without acceptedSubmit, which the runner records on every row",
      { cases: [{ taskId: "t", pass: true }] },
      RUN_PIN,
      UNSTATED,
      "a case row states no acceptedSubmit",
    ],
    [
      "malformed experiment authoring",
      { experimentAuthoring: { actual: "climb" } },
      RUN_PIN,
      UNSTATED,
      "malformed or has an unbound proposal digest",
    ],
    [
      "a foreign pin, which is not this condition's history",
      { backendPin: "other/pin" },
      RUN_PIN,
      UNSTATED,
      "refused (gate): recorded backend pin other/pin is not the run's test/pin — not comparable",
    ],
    [
      "an absent pin, named rather than printed",
      { backendPin: undefined },
      RUN_PIN,
      UNSTATED,
      "recorded backend pin absent is not the run's",
    ],
    // An unreadable manifest once disabled the threshold check silently.
    [
      "an unprovable threshold identity",
      {},
      RUN_PIN,
      { kind: "unavailable" },
      "threshold identity cannot be proved",
    ],
    [
      "another frozen manifest",
      { thresholdManifestDigest: "digest-b" },
      RUN_PIN,
      DIGEST_A,
      "different frozen threshold manifest",
    ],
    [
      "no threshold digest",
      { thresholdManifestDigest: undefined },
      RUN_PIN,
      DIGEST_A,
      "records no threshold manifest digest",
    ],
    // Excluded even when the caller names no digest of its own.
    [
      "a null threshold digest",
      { thresholdManifestDigest: null },
      RUN_PIN,
      UNSTATED,
      "records no threshold manifest digest",
    ],
    [
      "another condition",
      { condition: { variant: "repair-off" } },
      RUN_PIN,
      UNSTATED,
      "refused (gate): saved under condition repair-off; climb history reads only the shipping condition",
    ],
    ["no condition", { condition: undefined }, RUN_PIN, UNSTATED, "records no condition variant"],
  ])("refuses %s", (_battery, overrides, pin, digest, reason) => {
    const tree = tmp();
    writeBattery(tree, "r1", overrides);
    writeClaim(tree, "r1", { ok: true });

    const verdict = verdictOf(admit(tree, "r1", pin, digest));
    expect(verdict.startsWith("refused (gate): ")).toBe(true);
    expect(verdict).toContain(reason);
  });

  it.each<[string, BatteryFields, string | null, ThresholdIdentity]>([
    ["history across pins when the caller states none", { backendPin: "other/pin" }, null, UNSTATED],
    ["the matching frozen manifest", { thresholdManifestDigest: "digest-a" }, RUN_PIN, DIGEST_A],
    ["the shipping condition", { condition: { variant: "shipping" } }, RUN_PIN, UNSTATED],
  ])("admits %s", (_battery, overrides, pin, digest) => {
    const tree = tmp();
    writeBattery(tree, "r1", overrides);
    writeClaim(tree, "r1", { ok: true });

    expect(verdictOf(admit(tree, "r1", pin, digest))).toBe("admitted");
  });

  it("refuses a run dir the ownership check rejects, and bytes that match the manifest but do not parse", () => {
    const tree = tmp();
    // Rewritten after the manifest was published: the bytes no longer hash to what was recorded.
    writeFileSync(join(writeBattery(tree, "r1"), "battery.json"), JSON.stringify({ runId: "r1", cases: [] }));
    writeClaim(tree, "r1", { ok: true });
    const dir = join(tree, "runs", "r2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "battery.json"), "{not json");
    writeFileSync(
      join(dir, RUN_MANIFEST_NAME),
      JSON.stringify({ schemaVersion: "evidence-stage/v1", files: { "battery.json": sha256("{not json") } }),
    );
    writeClaim(tree, "r2", { ok: true });

    expect(verdictOf(admit(tree, "r1"))).toContain("run dir fails the ownership check");
    expect(verdictOf(admit(tree, "r2"))).toBe("refused (gate): unreadable battery evidence");
  });
});

describe("admission — what the claim decides", () => {
  const refused = (...clauses: string[]): JsonObject => ({
    ok: false,
    clauses: clauses.map((clause) => ({ clause })),
  });

  it.each<[string, JsonObject, string | null, string]>([
    // In the history and out of the rate, when a recorded clock can place it.
    [
      "a refused claim with a clock",
      refused("grounding-missing"),
      CREATED_AT,
      "kept out (claim): claim refused: grounding-missing",
    ],
    [
      "a refused claim no clock can place",
      refused("grounding-missing"),
      null,
      "refused (claim): claim refused: grounding-missing",
    ],
    ["a refusal carrying no clauses", { ok: false }, CREATED_AT, "kept out (claim): claim refused —"],
    // A contradicted census recorded another served model, transport or provider, so the battery's
    // pass rate belongs to that condition and not to this product's climb.
    [
      "a contradicted identity",
      refused("runtime-model-identity-contradicted"),
      CREATED_AT,
      "kept out (claim): claim refused: runtime-model-identity-contradicted",
    ],
    [
      "an environment clause beside any other clause",
      refused("non-result-ratio-excessive", "grounding-missing"),
      CREATED_AT,
      "kept out (claim)",
    ],
    // The environment clauses keep the rate: the tasks did not cause the outage, and excluding them
    // deleted a product's first failing cases from its population.
    ["an unproven identity", refused("runtime-model-identity-unproven"), CREATED_AT, "admitted"],
    ["an excessive non-result ratio", refused("non-result-ratio-excessive"), CREATED_AT, "admitted"],
    // Order may not come from file metadata.
    [
      "an accepted claim carrying no createdAt",
      { ok: true },
      null,
      "refused (claim): created claim carries no createdAt",
    ],
  ])("reads %s", (_claim, claim, createdAt, verdict) => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", claim, createdAt);

    const admission = admit(tree, "r1");
    expect(verdictOf(admission)).toContain(verdict);
    if (admission?.ok === true && admission.excluded !== null) expect(admission.createdAt).toBe(CREATED_AT);
  });

  it.each<[string, string | null, string]>([
    ["no claim", null, "no claim evidence"],
    ["an unreadable claim", "{not json", "unreadable claim evidence"],
    // The file name cannot establish the claim's meaning, or which battery it speaks for.
    [
      "a claim under another schema",
      JSON.stringify({ schema: "run-claim/v2", runId: "r1", createdAt: CREATED_AT, claim: { ok: true } }),
      'declares "run-claim/v2" instead of run-claim/v1',
    ],
    [
      "a claim for another battery",
      JSON.stringify({ schema: "run-claim/v1", runId: "r2", createdAt: CREATED_AT, claim: { ok: true } }),
      'names run "r2" instead of r1',
    ],
    [
      "a clock under mintedAt, the field before the vocabulary changed",
      JSON.stringify({ schema: "run-claim/v1", runId: "r1", mintedAt: CREATED_AT, claim: { ok: true } }),
      "carries no createdAt",
    ],
  ])("refuses %s", (_claim, bytes, reason) => {
    const tree = tmp();
    writeBattery(tree, "r1");
    if (bytes !== null) writeClaimFile(tree, "r1", bytes);

    const verdict = verdictOf(admit(tree, "r1"));
    expect(verdict.startsWith("refused (claim): ")).toBe(true);
    expect(verdict).toContain(reason);
  });
});

describe("admission — the row it hands downstream", () => {
  it("states the harness the bytes measured, leaving the task set out, and null when they state none", () => {
    const tree = tmp();
    const snapshot = (taskSetHash: string) => ({
      agentHash: "agent-a",
      scoringHash: "scoring-a",
      taskSetHash,
    });
    writeBattery(tree, "r1", { bundleSnapshot: snapshot("tasks-1") });
    writeBattery(tree, "r2", { bundleSnapshot: snapshot("tasks-2") });
    writeBattery(tree, "r3", { bundleSnapshot: { agentHash: "agent-a" } });
    for (const runId of ["r1", "r2", "r3"]) writeClaim(tree, runId, { ok: true });

    // A task-only change keeps one product.
    expect(["r1", "r2", "r3"].map((runId) => harnessIdOf(admit(tree, runId)))).toEqual([
      "agent-a:scoring-a:null",
      "agent-a:scoring-a:null",
      null,
    ]);
    expect(verdictOf(admit(tree, "r3"))).toBe("admitted");
    // A missing verifier hash is not a match — a null identity can only shorten a chain.
    expect(harnessBundleIdentity({ agentHash: "a", scoringHash: "c" }, undefined)).toBeNull();
    expect(harnessBundleIdentity({ agentHash: "a", scoringHash: "c" }, null)).toBe("a:c:null");
  });

  it("normalises the recorded difficulty: items default to empty and a half-stated subset is dropped", () => {
    const tree = tmp();
    writeBattery(tree, "r1", { measured: { changedSubset: { attempts: 4, passes: 1 } } });
    writeBattery(tree, "r2", { measured: { changedSubset: { attempts: 4 } } });
    writeClaim(tree, "r1", { ok: true });
    writeClaim(tree, "r2", { ok: true });

    const whole = admit(tree, "r1");
    expect(whole?.ok === true && whole.measured).toEqual({
      items: [],
      changedSubset: { attempts: 4, passes: 1 },
    });
    const half = admit(tree, "r2");
    expect(half?.ok === true && half.measured).toEqual({ items: [] });
  });
});

describe("the run's own threshold identity", () => {
  it("is unstated with no manifest named, unavailable when one cannot be read, and a digest otherwise", () => {
    const path = join(tmp(), "thresholds.frozen.yaml");
    expect(currentThresholdDigest()).toEqual({ kind: "unstated" });
    expect(currentThresholdDigest(path)).toEqual({ kind: "unavailable" });
    writeFileSync(path, "climb:\n  band: [0.2, 0.75]\n");
    expect(currentThresholdDigest(path)).toMatchObject({ kind: "digest" });
  });
});

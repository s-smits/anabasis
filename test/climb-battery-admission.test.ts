/**
 * Battery admission: whether one recorded run directory belongs to this tree's difficulty history.
 *
 * `admitBattery` is a sequence of gates over one run dir, and every refusal is settled here rather
 * than downstream, so each case below names one gate and the bytes that trip it. Two recorded runs
 * fix two of them: run 6 climbed on a foreign-pin 25/25 while its own pinned backend scored 0/25,
 * and run 8 read a provider outage's 0/25 as a too-hard level. A third fixes the exception — the
 * climb stopped being the second reader of the two environment clauses after they deleted truss
 * c1d2a7's 3-of-5 i04, the first failing cases in four rounds, from the population.
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

const RUN_PIN = "test/pin";
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const UNSTATED: ThresholdIdentity = { kind: "unstated" };

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

/** The claim beside it. A battery with no claim of its own is how the "no claim evidence" refusal
 *  is written, so nothing here creates one by default. */
function writeClaim(
  tree: string,
  runId: string,
  claim: JsonObject,
  createdAt: string | null = CREATED_AT,
): void {
  const dir = join(tree, "claims");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      ...keyIfDefined("createdAt", createdAt ?? undefined),
      claim,
    }),
  );
}

/** A battery and an accepted claim: the ordinary admitted case every refusal is measured against. */
function writeAdmitted(tree: string, runId: string, overrides: BatteryFields = {}): void {
  writeBattery(tree, runId, overrides);
  writeClaim(tree, runId, { ok: true });
}

/** What the writer's own manifest recorded for one file, so a case can bind the admitted hash to
 *  the bytes the ownership check attested rather than to a second hash of its own. */
function recordedDigest(runDir: string, rel: string): string {
  const manifest = parseJsonAs<{ files: Record<string, string> }>(
    readFileSync(join(runDir, RUN_MANIFEST_NAME), "utf8"),
  );
  return manifest.files[rel] ?? "<not recorded>";
}

function admit(
  tree: string,
  runId: string,
  pin: string | null = RUN_PIN,
  digest: ThresholdIdentity = UNSTATED,
) {
  return admitBattery(join(tree, "runs", runId), runId, pin, digest, join(tree, "claims"));
}

/** The harness these bytes measured, or null for a refusal as well as for evidence stating none —
 *  a case that cares about the difference asserts the verdict too. */
function harnessIdOf(admission: ReturnType<typeof admitBattery>): string | null {
  return admission?.ok === true ? admission.harnessId : null;
}

/** The reason of a refusal, or a marker naming what came back instead, so a failing expectation
 *  reads as the wrong verdict rather than as a property of null. */
function refusalOf(admission: ReturnType<typeof admitBattery>): string {
  if (admission === null) return "<no battery>";
  return admission.ok
    ? `<admitted, excluded=${admission.excluded === null ? "null" : admission.excluded.reason}>`
    : admission.excluded.reason;
}

describe("admission — the ordinary battery, and the directory that holds none", () => {
  it("admits a recorded battery with an accepted claim, carrying the manifest's own battery hash", () => {
    const tree = tmp();
    const dir = writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: true });

    const admission = admit(tree, "r1");

    expect(admission?.ok).toBe(true);
    if (admission?.ok !== true) return;
    expect(admission.excluded).toBeNull();
    expect(admission.runId).toBe("r1");
    expect(admission.createdAt).toBe(CREATED_AT);
    // The recorded battery.json digest, not a hash of other bytes: an earlier reader bound
    // `bundleSnapshot.taskSetHash` here, which could never match what the manifest recorded.
    expect(admission.batterySha256).toBe(recordedDigest(dir, "battery.json"));
  });

  it("answers null for a directory holding no battery — an empty dir is not a refusal", () => {
    const tree = tmp();
    mkdirSync(join(tree, "runs", "r1"), { recursive: true });

    expect(admit(tree, "r1")).toBeNull();
  });
});

describe("admission — identity: these bytes, this directory, this condition", () => {
  it("refuses a relocated run dir whose evidence names a different run", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { runId: "somewhere-else" });

    expect(refusalOf(admit(tree, "r1"))).toContain("different runId than its directory");
  });

  it("refuses evidence that states no run id or no case rows", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { runId: undefined });
    writeAdmitted(tree, "r2", { cases: undefined });

    expect(refusalOf(admit(tree, "r1"))).toContain("states no run id or case rows");
    expect(refusalOf(admit(tree, "r2"))).toContain("states no run id or case rows");
  });

  it("refuses a case row that states no acceptedSubmit, since the runner records it on every row", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { cases: [{ taskId: "t", pass: true }] });

    expect(refusalOf(admit(tree, "r1"))).toContain("a case row states no acceptedSubmit");
  });

  it("refuses a run dir the ownership check rejects, quoting that check's own refusal", () => {
    const tree = tmp();
    const dir = writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: true });
    // Rewritten after the manifest was published: the bytes no longer hash to what was recorded.
    writeFileSync(join(dir, "battery.json"), JSON.stringify({ runId: "r1", cases: [] }));

    expect(refusalOf(admit(tree, "r1"))).toContain("run dir fails the ownership check");
  });

  it("refuses battery bytes that match the manifest but do not parse", () => {
    const tree = tmp();
    const dir = join(tree, "runs", "r1");
    mkdirSync(dir, { recursive: true });
    const bytes = "{not json";
    writeFileSync(join(dir, "battery.json"), bytes);
    writeFileSync(
      join(dir, RUN_MANIFEST_NAME),
      JSON.stringify({ schemaVersion: "evidence-stage/v1", files: { "battery.json": sha256(bytes) } }),
    );
    writeClaim(tree, "r1", { ok: true });

    expect(refusalOf(admit(tree, "r1"))).toBe("unreadable battery evidence");
  });

  it("refuses recorded experiment authoring that is malformed", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { experimentAuthoring: { actual: "climb" } });

    expect(refusalOf(admit(tree, "r1"))).toContain("malformed or has an unbound proposal digest");
  });
});

describe("admission — comparability: pin, thresholds and condition", () => {
  it("refuses run 6's shape exactly: a foreign-pin battery is not this condition's history", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { backendPin: "other/pin" });

    expect(refusalOf(admit(tree, "r1"))).toBe(
      "recorded backend pin other/pin is not the run's test/pin — not comparable",
    );
  });

  it("names an absent pin rather than printing a missing value", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { backendPin: undefined });

    expect(refusalOf(admit(tree, "r1"))).toContain("recorded backend pin absent is not the run's");
  });

  it("reads history across pins when the caller states no pin", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { backendPin: "other/pin" });

    expect(admit(tree, "r1", null)?.ok).toBe(true);
  });

  it("fails closed when this run's own threshold manifest cannot be read", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1");

    // An unreadable manifest once disabled the threshold check silently, and evidence recorded
    // under a different frozen manifest was admitted as comparable.
    expect(refusalOf(admit(tree, "r1", RUN_PIN, { kind: "unavailable" }))).toContain(
      "threshold identity cannot be proved",
    );
  });

  it("excludes a battery recorded under a different frozen manifest and admits the matching one", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { thresholdManifestDigest: "digest-b" });
    writeAdmitted(tree, "r2", { thresholdManifestDigest: "digest-a" });
    const digest: ThresholdIdentity = { kind: "digest", digest: "digest-a" };

    expect(refusalOf(admit(tree, "r1", RUN_PIN, digest))).toContain("different frozen threshold manifest");
    expect(admit(tree, "r2", RUN_PIN, digest)?.ok).toBe(true);
  });

  it("excludes evidence that states no threshold digest, even when the caller names none", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { thresholdManifestDigest: undefined });
    writeAdmitted(tree, "r2", { thresholdManifestDigest: null });

    expect(refusalOf(admit(tree, "r1", RUN_PIN, { kind: "digest", digest: "digest-a" }))).toContain(
      "records no threshold manifest digest",
    );
    expect(refusalOf(admit(tree, "r2"))).toContain("records no threshold manifest digest");
  });

  it("reads only the shipping condition, and excludes evidence that names no condition", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { condition: { variant: "repair-off" } });
    writeAdmitted(tree, "r2", { condition: { variant: "shipping" } });
    writeAdmitted(tree, "r3", { condition: undefined });

    expect(refusalOf(admit(tree, "r1"))).toBe(
      "saved under condition repair-off; climb history reads only the shipping condition",
    );
    expect(admit(tree, "r2")?.ok).toBe(true);
    expect(refusalOf(admit(tree, "r3"))).toContain("records no condition variant");
  });
});

describe("admission — what the claim decides", () => {
  it("keeps a refused battery in the history and out of the rate, when a clock can place it", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: false, clauses: [{ clause: "grounding-missing" }] });

    const admission = admit(tree, "r1");

    expect(admission?.ok).toBe(true);
    if (admission?.ok !== true) return;
    expect(admission.excluded?.claimRefused).toBe(true);
    expect(admission.excluded?.reason).toContain("claim refused: grounding-missing");
    expect(admission.createdAt).toBe(CREATED_AT);
  });

  it("refuses outright a refusal no recorded clock can place", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: false, clauses: [{ clause: "grounding-missing" }] }, null);

    const admission = admit(tree, "r1");

    expect(admission?.ok).toBe(false);
    expect(refusalOf(admission)).toContain("claim refused: grounding-missing");
  });

  it("names a refusal that carries no clauses", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: false });

    expect(admit(tree, "r1")?.excluded?.reason).toContain("claim refused —");
  });

  it("lets the two environment clauses keep the rate, because the tasks did not cause the outage", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: false, clauses: [{ clause: "runtime-model-identity-unproven" }] });
    writeBattery(tree, "r2");
    writeClaim(tree, "r2", { ok: false, clauses: [{ clause: "non-result-ratio-excessive" }] });

    // Truss c1d2a7's i04 — 3 of 5, the first failing cases in four rounds — was deleted from the
    // population by the identity clause, and the next climb re-read "6/6, significantly too easy".
    expect(admit(tree, "r1")?.excluded).toBeNull();
    expect(admit(tree, "r2")?.excluded).toBeNull();
  });

  it("keeps a contradicted identity out, because that battery measured another condition", () => {
    // The environment clause above covers what the provider failed to record. A contradicted
    // census recorded something and it names another served model, transport or provider, so the
    // battery's pass rate belongs to that condition and not to this product's climb. Until
    // 2026-09-20 one clause carried both readings and this set admitted them together.
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: false, clauses: [{ clause: "runtime-model-identity-contradicted" }] });

    // Excluded with a reason naming the clause. The row keeps its recorded clock, so it stays
    // readable in the history beside the admitted batteries and enters no rate.
    expect(admit(tree, "r1")?.excluded?.claimRefused).toBe(true);
    expect(admit(tree, "r1")?.excluded?.reason).toContain("runtime-model-identity-contradicted");
  });

  it("refuses when an environment clause arrives beside any other clause", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", {
      ok: false,
      clauses: [{ clause: "non-result-ratio-excessive" }, { clause: "grounding-missing" }],
    });

    expect(admit(tree, "r1")?.excluded?.claimRefused).toBe(true);
  });

  it("separates no claim from an unreadable one", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeBattery(tree, "r2");
    mkdirSync(join(tree, "claims"), { recursive: true });
    writeFileSync(join(tree, "claims", "r2.json"), "{not json");

    expect(refusalOf(admit(tree, "r1"))).toContain("no claim evidence");
    expect(refusalOf(admit(tree, "r2"))).toContain("unreadable claim evidence");
  });

  it("refuses a claim under another schema, because the file name cannot establish its meaning", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    mkdirSync(join(tree, "claims"), { recursive: true });
    writeFileSync(
      join(tree, "claims", "r1.json"),
      JSON.stringify({ schema: "run-claim/v2", runId: "r1", createdAt: CREATED_AT, claim: { ok: true } }),
    );

    expect(refusalOf(admit(tree, "r1"))).toContain('declares "run-claim/v2" instead of run-claim/v1');
  });

  it("refuses a claim that speaks for another battery, however it was named on disk", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    mkdirSync(join(tree, "claims"), { recursive: true });
    writeFileSync(
      join(tree, "claims", "r1.json"),
      JSON.stringify({ schema: "run-claim/v1", runId: "r2", createdAt: CREATED_AT, claim: { ok: true } }),
    );

    expect(refusalOf(admit(tree, "r1"))).toContain('names run "r2" instead of r1');
  });

  it("refuses an accepted claim carrying no createdAt — order may not come from file metadata", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    writeClaim(tree, "r1", { ok: true }, null);

    // In run 9 the version without advisers had a file 71 minutes older, and that timing alone
    // made the selector climb.
    expect(refusalOf(admit(tree, "r1"))).toContain("carries no createdAt");
  });

  it("reads no chronology from mintedAt, the field before the vocabulary changed", () => {
    const tree = tmp();
    writeBattery(tree, "r1");
    mkdirSync(join(tree, "claims"), { recursive: true });
    writeFileSync(
      join(tree, "claims", "r1.json"),
      JSON.stringify({ schema: "run-claim/v1", runId: "r1", mintedAt: CREATED_AT, claim: { ok: true } }),
    );

    expect(refusalOf(admit(tree, "r1"))).toContain("carries no createdAt");
  });
});

describe("admission — the row it hands downstream", () => {
  it("states the harness the bytes measured, and null when they do not state one", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1");
    writeAdmitted(tree, "r2", { bundleSnapshot: { agentHash: "agent-a" } });

    const admission = admit(tree, "r1");
    expect(admission?.ok === true && admission.harnessId).toBe("agent-a:scoring-a:null");
    const partial = admit(tree, "r2");
    expect(partial?.ok === true && partial.harnessId).toBeNull();
  });

  it("leaves the task set out of the harness identity, so a task-only change keeps one product", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", {
      bundleSnapshot: {
        agentHash: "agent-a",
        scoringHash: "scoring-a",
        taskSetHash: "tasks-1",
      },
    });
    writeAdmitted(tree, "r2", {
      bundleSnapshot: {
        agentHash: "agent-a",
        scoringHash: "scoring-a",
        taskSetHash: "tasks-2",
      },
    });

    expect(harnessIdOf(admit(tree, "r1"))).toBe(harnessIdOf(admit(tree, "r2")));
    expect(harnessIdOf(admit(tree, "r1"))).toBe("agent-a:scoring-a:null");
  });

  it("refuses to call a missing verifier hash a match — a null identity can only shorten a chain", () => {
    expect(harnessBundleIdentity({ agentHash: "a", scoringHash: "c" }, undefined)).toBeNull();
    expect(harnessBundleIdentity({ agentHash: "a", scoringHash: "c" }, null)).toBe("a:c:null");
  });

  it("normalises the recorded difficulty: items default to empty and a half-stated subset is dropped", () => {
    const tree = tmp();
    writeAdmitted(tree, "r1", { measured: { changedSubset: { attempts: 4, passes: 1 } } });
    writeAdmitted(tree, "r2", { measured: { changedSubset: { attempts: 4 } } });

    const whole = admit(tree, "r1");
    expect(whole?.ok === true && whole.measured.changedSubset).toEqual({ attempts: 4, passes: 1 });
    const half = admit(tree, "r2");
    expect(half?.ok === true && half.measured).toEqual({ items: [] });
  });
});

describe("the run's own threshold identity", () => {
  it("states unstated when no manifest is named, and unavailable when a named one cannot be read", () => {
    expect(currentThresholdDigest()).toEqual({ kind: "unstated" });
    expect(currentThresholdDigest(join(tmp(), "absent.yaml"))).toEqual({ kind: "unavailable" });
  });

  it("reads a digest from a legible manifest", () => {
    const tree = tmp();
    const path = join(tree, "thresholds.frozen.yaml");
    writeFileSync(path, "climb:\n  band: [0.2, 0.75]\n");

    expect(currentThresholdDigest(path)).toMatchObject({ kind: "digest" });
  });
});

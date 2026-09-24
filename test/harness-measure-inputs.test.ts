import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { type ConformanceEvidence, readBoundConformance } from "../src/claim/conformance-evidence.ts";
import { caseIsolationFromProbe, resolveBuiltSlot } from "../src/run/harness-measure.ts";
import { loadRecordedTasks } from "../src/run/run-driver.ts";
import { probeHostSolveReadDeny } from "../src/verify/solve-sandbox.ts";
import { MATCHING_TASKS, MATCHING_TOOLS_SPEC } from "./helpers/matching-fixture.ts";
import { builtSession, probeEvidence } from "./helpers/measure-doubles.ts";
import { measureScratch, scaffoldRepo } from "./helpers/measure-repo.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

/**
 * What measurement reads before it measures: which Built slot a run resolves, what an isolation
 * probe and a Built session together prove, the task array the build loop persisted, and the
 * conformance evidence an adoption carried.
 *
 * Each of these refuses rather than guesses. The conformance reader in particular rejoins its
 * evidence to the tree's own bytes, so evidence recorded over different tools, different task
 * bytes, a stale probe policy or a stale worker protocol is not evidence for this tree.
 * `harness-measure.test.ts` owns what the driver then does with them.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = measureScratch();

/** A scaffolded adopted product's slug directory, which is what both readers below take. */
const tree = (name: string, opts: { toolsSpec: boolean; conformance?: boolean }): string =>
  join(scaffoldRepo(join(SCRATCH_ROOT, name), opts), "domains", "bridge-truss");

describe("the built-slot resolution", () => {
  it.concurrent("resolves the unconfigured default to claude and admits every Pi-carried provider by env", () => {
    // The default is its own declaration, not the first entry of the support list, so a support
    // edit cannot move the measured provider onto one the operator never chose.
    const repo = join(SCRATCH_ROOT, "resolve-default");
    mkdirSync(repo, { recursive: true });
    expect(resolveBuiltSlot(repo, "bridge-truss", {}).built).toMatchObject({
      kind: "claude",
      source: "default",
    });
    for (const kind of ["claude", "codex", "openrouter"] as const) {
      expect(resolveBuiltSlot(repo, "bridge-truss", { HARNESS_BUILT_BACKEND: kind }).built).toMatchObject({
        kind,
        source: "env",
      });
    }
  });
});

describe("the case isolation check result", () => {
  it.concurrent("records physical isolation only when an isolated probe meets the Built session profile", () => {
    expect(caseIsolationFromProbe(probeEvidence(true), builtSession()).strength).toBe("physical");
    // Anything short of that match stays contractual: no session, a failed probe, another
    // activated profile or another role.
    for (const [probe, session] of [
      [probeEvidence(true), undefined],
      [probeEvidence(false), builtSession()],
      [probeEvidence(true), { ...builtSession(), activePermissionProfile: "anabasis-workspace" }],
      [probeEvidence(true), { ...builtSession(), role: "builder" }],
    ] as const) {
      expect(caseIsolationFromProbe(probe, session).strength).toBe("contractual");
    }
  });

  it.concurrent("carries the executed probe and supplied session record as evidence", () => {
    const probe = probeHostSolveReadDeny({ repoRoot: SCRATCH_ROOT });
    if (probe.profileDigest === null) throw new Error("host solve probe returned no policy digest");
    const session = builtSession(probe.profileDigest);
    const evidence = caseIsolationFromProbe(probe, session);
    expect(evidence.strength).toBe("physical");
    expect(evidence.probe).toBe(probe);
    expect(evidence.session).toBe(session);
  });
});

describe("the persisted task battery re-read", () => {
  it.concurrent("round-trips the bare array the build loop persists", () => {
    const tasks = loadRecordedTasks(tree("tasks-ok", { toolsSpec: false }));
    expect(tasks.map((t) => t.taskId)).toEqual(MATCHING_TASKS.map((t) => t.taskId));
  });

  it.concurrent("refuses an empty array, a wrapper object, and a structurally damaged row", () => {
    const slugDir = join(SCRATCH_ROOT, "tasks-bad", "domains", "bridge-truss");
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    const file = join(slugDir, "correctness-model", "tasks.json");
    writeFileSync(file, "[]");
    expect(() => loadRecordedTasks(slugDir)).toThrow(/non-empty task array/);
    writeFileSync(file, JSON.stringify({ tasks: MATCHING_TASKS }));
    expect(() => loadRecordedTasks(slugDir)).toThrow(/non-empty task array/);
    writeFileSync(file, JSON.stringify([{ taskId: "t1" }]));
    expect(() => loadRecordedTasks(slugDir)).toThrow(/not a persisted BuildTask/);
  });
});

describe("the adoption-carried conformance evidence", () => {
  it.concurrent("returns null on a pre-persistence tree — readiness reads conformance-unprobed", () => {
    expect(readBoundConformance(tree("conf-absent", { toolsSpec: true }))).toBeNull();
  });

  it.concurrent("hash-joins the evidence to the tree's own tools-spec bytes", () => {
    const evidence = readBoundConformance(tree("conf-ok", { toolsSpec: true, conformance: true }));
    expect(evidence?.toolsSpecHash).toBe(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(MATCHING_TOOLS_SPEC)).digest("hex"),
    );
  });

  it.concurrent("refuses evidence created over a different tool contract", () => {
    const slugDir = tree("conf-drift", { toolsSpec: true, conformance: true });
    writeFileSync(
      join(slugDir, "agent", "tools-spec.json"),
      JSON.stringify({
        presets: [],
        declined: { files: "fixture without a shell" },
        tools: [{ name: "other", kind: "artifact-writer", description: "Prepare another answer." }],
      }),
    );
    expect(() => readBoundConformance(slugDir)).toThrow(/does not re-derive/);
  });

  it.concurrent("refuses evidence when task bytes drift under the same task ids", () => {
    const slugDir = tree("conf-task-drift", { toolsSpec: true, conformance: true });
    const changedTasks = MATCHING_TASKS.map((task, index) =>
      index === 0 ? { ...task, publicInput: { evidenceDrift: true } } : task,
    );
    writeFileSync(join(slugDir, "correctness-model", "tasks.json"), JSON.stringify(changedTasks));
    expect(() => readBoundConformance(slugDir)).toThrow(/task identity drifted/);
  });

  it.concurrent.each([
    [
      "conformance policy",
      (evidence: ConformanceEvidence) => ({ ...evidence, probePolicy: "falsifier-conformance/v16" }),
    ],
    [
      "generated-worker protocol",
      (evidence: ConformanceEvidence) => ({
        ...evidence,
        worker: { ...evidence.worker, schema: "generated-tool-worker/v1" },
      }),
    ],
  ] as const)("refuses evidence created by a stale %s", (label, stale) => {
    const slugDir = tree(`conf-stale-${label.replaceAll(" ", "-")}`, { toolsSpec: true, conformance: true });
    const file = join(slugDir, "conformance.json");
    writeFileSync(file, JSON.stringify(stale(JSON.parse(readFileSync(file, "utf8")))));
    expect(() => readBoundConformance(slugDir)).toThrow(/not a ConformanceEvidence/);
  });

  it.concurrent("refuses evidence whose tool contract is absent from the tree", () => {
    expect(() => readBoundConformance(tree("conf-orphan", { toolsSpec: false, conformance: true }))).toThrow(
      /absent contract/,
    );
  });
});

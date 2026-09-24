import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { taskSetFacts } from "../.claude/skills/final-harness-audit/scripts/harness-task-facts.mjs";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { publishProductVersion, selectInitialProduct } from "../src/run/product-versions.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const script = join(repoRoot, ".claude/skills/final-harness-audit/scripts/harness-versions.mjs");
const bunExecutable = Bun.argv[0];
const temporaryDirectories: string[] = [];
type FixtureJson = null | boolean | number | string | FixtureJson[] | { [key: string]: FixtureJson };

if (bunExecutable === undefined) throw new Error("Bun executable is unavailable");
function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function git(workspace: string, args: string[]): string {
  const result = spawnSync("git", ["-C", workspace, ...args], {});
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function writeJson(path: string, value: FixtureJson): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commit(workspace: string, subject: string): string {
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", subject]);
  return git(workspace, ["rev-parse", "HEAD"]);
}

function fingerprint(seed: string) {
  return {
    agentHash: seed.repeat(64).slice(0, 64),
    correctnessModelHash: `${seed}b`.repeat(64).slice(0, 64),
    taskSetHash: `${seed}c`.repeat(64).slice(0, 64),
  };
}

function fixture() {
  const root = temporaryDirectory("ana-harness-evolution-");
  const campaign = join(root, "campaigns/domain");
  const epoch = join(campaign, "epoch-one");
  const workspace = join(epoch, "workspace");
  mkdirSync(join(workspace, "agent"), { recursive: true });
  mkdirSync(join(workspace, "correctness-model"), { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "Test"]);

  writeFileSync(join(workspace, "agent/solve.ts"), "export const solve = () => 'starter';\n");
  writeJson(join(workspace, "correctness-model/tasks.json"), [
    { taskId: "one", family: "routing", publicInput: { query: "alpha beta", mode: "a" } },
    { taskId: "two", family: "routing", publicInput: { query: "gamma delta", mode: "b" } },
  ]);
  writeFileSync(join(workspace, "correctness-model/evaluator.ts"), "export const check = () => true;\n");
  const starter = commit(workspace, "starter: domain workspace skeleton");

  writeFileSync(
    join(workspace, "agent/solve.ts"),
    "export function solve(value: string) {\n  return value.trim().toUpperCase();\n}\n",
  );
  const first = commit(workspace, "submit: first candidate");
  const firstFingerprint = fingerprint("a");
  mkdirSync(join(epoch, "01-domain"), { recursive: true });
  writeJson(join(epoch, "01-domain/iteration.json"), {
    ordinal: 1,
    outcome: "fingerprinted",
    workspaceChange: { baseCommit: starter, commit: first, changedPaths: ["agent/solve.ts"] },
    fingerprint: firstFingerprint,
  });

  writeJson(join(workspace, "correctness-model/tasks.json"), [
    { taskId: "one", family: "routing", publicInput: { query: "alpha beta", mode: "a" } },
    { taskId: "two", family: "routing", publicInput: { query: "gamma epsilon", mode: "b" } },
    {
      taskId: "three",
      parentTaskId: "two",
      family: "routing",
      publicInput: { query: "zeta eta", mode: "c" },
    },
  ]);
  writeFileSync(join(workspace, "agent/table.json"), `${JSON.stringify({ values: Array(20).fill("x") })}\n`);
  const second = commit(workspace, "submit: expanded candidate");
  const secondFingerprint = fingerprint("d");
  mkdirSync(join(epoch, "02-domain"), { recursive: true });
  writeJson(join(epoch, "02-domain/iteration.json"), {
    ordinal: 2,
    outcome: "fingerprinted",
    focusOwner: "environment",
    findingsHash: "f".repeat(64),
    source: { commit: "a".repeat(40), dirty: true, sourceDigest: "b".repeat(64) },
    workspaceChange: {
      baseCommit: first,
      commit: second,
      changedPaths: ["agent/table.json", "correctness-model/tasks.json"],
    },
    fingerprint: secondFingerprint,
  });
  writeJson(join(epoch, "campaign.json"), { domain: "domain" });

  const firstRun = join(campaign, "candidates/first/runs/measure-first");
  mkdirSync(firstRun, { recursive: true });
  const firstEvidence = new EvidenceLog(firstRun);
  firstEvidence.write("battery.json", {
    runId: "measure-first",
    bundleSnapshot: firstFingerprint,
    cases: [
      { acceptedSubmit: true, truthOk: true, pass: true, runtimeNonResult: null, runtimeNonResultKind: null },
      {
        acceptedSubmit: true,
        truthOk: false,
        pass: false,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      },
      {
        acceptedSubmit: false,
        truthOk: null,
        pass: false,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      },
      {
        acceptedSubmit: false,
        truthOk: null,
        pass: null,
        runtimeNonResult: "provider unavailable",
        runtimeNonResultKind: "provider",
      },
    ],
  });
  firstEvidence.record();
  const secondRun = join(campaign, "contest/final/runs/measure-second");
  mkdirSync(secondRun, { recursive: true });
  const secondEvidence = new EvidenceLog(secondRun);
  secondEvidence.write("battery.json", {
    runId: "measure-second",
    bundleSnapshot: secondFingerprint,
    cases: [
      { acceptedSubmit: true, truthOk: true, pass: true, runtimeNonResult: null, runtimeNonResultKind: null },
      {
        acceptedSubmit: false,
        truthOk: null,
        pass: false,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      },
    ],
  });
  secondEvidence.record();
  return { root, campaign };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const path = temporaryDirectories.pop();
    if (path !== undefined) rmSync(path, { recursive: true, force: true });
  }
});

describe("harness evolution facts", () => {
  it("joins candidate and contest measurements to size, starter-deviation and public-task facts", () => {
    const { root, campaign } = fixture();
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(0);
    const audit = JSON.parse(result.stdout);

    expect(audit.schema).toBe("harness-evolution/v1");
    expect(audit.summary).toMatchObject({ gitVersions: 3, iterationCheckpoints: 2, measuredCheckpoints: 2 });
    expect(audit.quickRead.latestCheckpoint).toMatchObject({
      ordinal: 2,
      focusOwner: "environment",
      findingsHash: "f".repeat(64),
      source: { commit: "a".repeat(40), dirty: true, sourceDigest: "b".repeat(64) },
      measuredBatteries: 1,
      product: { files: 4, dataToCodeLineRatio: expect.any(Number) },
      fromStarter: { filesChanged: 3 },
      taskSet: { tasks: 3, publicInputLayouts: 1, tasksPerPublicInputLayout: 3 },
    });
    expect(audit.quickRead.measuredCheckpoints.map((row: { ordinal: number }) => row.ordinal)).toEqual([
      1, 2,
    ]);
    expect(audit.quickRead.measuredToLastGrowth).toMatchObject({ fromOrdinal: 1, toOrdinal: 2 });
    expect(audit.quickRead.taskTransitions[0]).toMatchObject({
      ordinal: 2,
      exactPublicRepeats: 1,
      currentTasks: 3,
      linkKinds: { parentTaskId: 1, sameTaskId: 2, nearestLexical: 0, unmatched: 0 },
    });
    const { checkpoint } = audit.versions.find((row: { ordinal: number }) => row.ordinal === 2);
    expect(checkpoint.productTree.linesByKind.data).toBeGreaterThan(0);
    expect(checkpoint.fromStarter.added).toBeGreaterThan(0);
    expect(checkpoint.fromPreviousCheckpoint.paths.map((row: { path: string }) => row.path)).toContain(
      "correctness-model/tasks.json",
    );
    expect(audit.quickRead.measuredCheckpoints[0].batteries[0]).toMatchObject({
      runId: "measure-first",
      verified: 2,
      passed: 1,
      unaccepted: 1,
      nonResults: 1,
    });
    expect(audit.quickRead.measuredCheckpoints[1].batteries[0]).toMatchObject({
      total: 2,
      verified: 1,
      passed: 1,
      unaccepted: 1,
      nonResults: 0,
    });
  });

  it("reads saved products without checkpoint joins and preserves missing, conflicting and unmatched evidence", () => {
    const { root, campaign } = fixture();
    const workspace = join(campaign, "epoch-one", "workspace");
    for (const [id, verified] of [
      ["saved-first", 25],
      ["saved-second", 22],
      ["saved-missing", 0],
    ] as const) {
      writeJson(join(workspace, "correctness-model/tasks.json"), [{ taskId: id }]);
      const stamped = fingerprintSlug(workspace, { slug: "domain" });
      if (!stamped.ok) throw new Error("fixture fingerprint refused");
      const product = publishProductVersion({
        repoRoot: root,
        slug: "domain",
        id,
        acceptedSnapshot: workspace,
        fingerprint: stamped,
      });
      if (id === "saved-missing") {
        rmSync(product, { recursive: true, force: true });
        continue;
      }
      if (id === "saved-first") selectInitialProduct(root, "domain", id);
      const evidence = new EvidenceLog(join(product, "runs", id));
      evidence.write("battery.json", {
        runId: id,
        bundleSnapshot: {
          agentHash: stamped.agentHash,
          correctnessModelHash: stamped.correctnessModelHash,
          taskSetHash: stamped.taskSetHash,
        },
        cases: Array.from({ length: 25 }, (_, index) => ({
          acceptedSubmit: index < verified,
          truthOk: index < verified ? true : null,
          pass: index < verified,
          runtimeNonResult: null,
          runtimeNonResultKind: null,
        })),
      });
      evidence.record();
    }
    mkdirSync(join(campaign, "versions", "broken"));
    writeFileSync(join(campaign, "versions", "broken", "version.json"), "{");
    const conflicting = join(campaign, "candidates", "duplicate", "runs", "measure-first");
    cpSync(join(campaign, "candidates", "first", "runs", "measure-first"), conflicting, { recursive: true });
    const conflict = new EvidenceLog(conflicting);
    conflict.write("battery.json", { runId: "measure-first", bundleSnapshot: fingerprint("a"), cases: [] });
    conflict.record();
    const unmatched = new EvidenceLog(join(campaign, "candidates", "unmatched", "runs", "unmatched"));
    unmatched.write("battery.json", { runId: "unmatched", bundleSnapshot: fingerprint("e"), cases: [] });
    unmatched.record();
    // The controller files a snapshot with no task set as "no-tasks"; the audit has to spell it the same
    // way, or the battery that measured such a snapshot can never join it.
    const taskless = new EvidenceLog(join(campaign, "candidates", "taskless", "runs", "taskless"));
    taskless.write("battery.json", {
      runId: "taskless",
      bundleSnapshot: { ...fingerprint("f"), taskSetHash: null },
      cases: [],
    });
    taskless.record();
    const ledgerBefore = readFileSync(join(campaign, "controller.sqlite"));
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(0);
    const audit = JSON.parse(result.stdout);
    expect(audit.summary).toMatchObject({ savedVersions: 4, measuredSavedVersions: 2, measuredBatteries: 5 });
    expect(
      audit.savedVersions.find((row: { id: string }) => row.id === "saved-first").measuredBy[0],
    ).toMatchObject({ verified: 25, unaccepted: 0 });
    expect(
      audit.savedVersions.find((row: { id: string }) => row.id === "saved-second").measuredBy[0],
    ).toMatchObject({ verified: 22, unaccepted: 3 });
    expect(audit.savedVersions.find((row: { id: string }) => row.id === "broken")).toMatchObject({
      state: "unobservable",
      measuredBy: [],
    });
    expect(audit.savedVersions.find((row: { id: string }) => row.id === "saved-missing")).toMatchObject({
      state: "unobservable",
      measuredBy: [],
      findings: [expect.stringContaining("ENOENT")],
    });
    expect(audit.evidenceGaps).toContainEqual(
      expect.objectContaining({ runId: "measure-first", reason: "conflicting copies of battery" }),
    );
    expect(audit.unmatchedBatteries).toContainEqual(expect.objectContaining({ runId: "unmatched" }));
    expect(audit.unmatchedBatteries).toContainEqual(
      expect.objectContaining({
        runId: "taskless",
        bundleSnapshotId: `${"f".repeat(16)}-${"fb".repeat(8)}-no-tasks`,
      }),
    );
    expect(audit.current.bundleSnapshotId).toBe(
      audit.savedVersions.find((row: { id: string }) => row.id === "saved-first").bundleSnapshotId,
    );
    expect(readFileSync(join(campaign, "controller.sqlite"))).toEqual(ledgerBefore);
    writeJson(join(campaign, "budget.json"), { schema: "controller-ledger/v1", id: "wrong-ledger" });
    const corrupted = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    const incomplete = JSON.parse(corrupted.stdout);
    expect(incomplete.savedVersions).toHaveLength(3);
    expect(incomplete.current).toMatchObject({ state: "unobservable", bundleSnapshotId: null });
    expect(incomplete.evidenceGaps).toContainEqual(
      expect.stringContaining("the controller ledger identity does not match"),
    );
  });

  it("refuses changed battery bytes instead of reporting their counts as measured evidence", () => {
    const { root, campaign } = fixture();
    writeJson(join(campaign, "candidates/first/runs/measure-first/battery.json"), {
      runId: "measure-first",
      bundleSnapshot: fingerprint("a"),
      cases: [],
    });
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("evidence-tampered");
  });

  it("orders checkpoints by recorded commit time when an older epoch is touched last", () => {
    const { root, campaign } = fixture();
    const epoch = join(campaign, "epoch-older");
    const workspace = join(epoch, "workspace");
    mkdirSync(join(workspace, "agent"), { recursive: true });
    mkdirSync(join(workspace, "correctness-model"), { recursive: true });
    git(workspace, ["init", "-q"]);
    git(workspace, ["config", "user.email", "test@example.com"]);
    git(workspace, ["config", "user.name", "Test"]);
    writeFileSync(join(workspace, "agent/solve.ts"), "export const solve = () => 'older';\n");
    writeJson(join(workspace, "correctness-model/tasks.json"), []);
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "starter: older epoch", "--date=2000-01-01T00:00:00Z"]);
    const starter = git(workspace, ["rev-parse", "HEAD"]);
    writeFileSync(join(workspace, "agent/solve.ts"), "export const solve = () => 'old candidate';\n");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "submit: old candidate", "--date=2000-01-02T00:00:00Z"]);
    const older = git(workspace, ["rev-parse", "HEAD"]);
    mkdirSync(join(epoch, "01-domain"));
    writeJson(join(epoch, "01-domain/iteration.json"), {
      ordinal: 1,
      outcome: "gates-blocked",
      workspaceChange: { baseCommit: starter, commit: older, changedPaths: ["agent/solve.ts"] },
    });
    writeJson(join(epoch, "campaign.json"), { domain: "domain" });
    utimesSync(join(epoch, "campaign.json"), new Date("2099-01-01"), new Date("2099-01-01"));
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(0);
    const audit = JSON.parse(result.stdout);
    expect(audit.versions[0].epoch).toBe("epoch-older");
    expect(audit.quickRead.latestCheckpoint).toMatchObject({ ordinal: 2, measuredBatteries: 1 });
    expect(audit.quickRead.latestCheckpoint.commit).not.toBe(older);
    expect(audit.quickRead.measuredToLastGrowth.toOrdinal).toBe(2);
  });

  it("refuses a recorded contradictory verdict instead of inventing a verified result", () => {
    const { root, campaign } = fixture();
    const evidence = new EvidenceLog(join(campaign, "candidates/first/runs/measure-first"));
    evidence.write("battery.json", {
      runId: "measure-first",
      bundleSnapshot: fingerprint("a"),
      cases: [
        {
          acceptedSubmit: true,
          truthOk: null,
          pass: null,
          runtimeNonResult: null,
          runtimeNonResultKind: null,
        },
      ],
    });
    evidence.record();
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("a verified row needs boolean truthOk and pass");
  });

  it("keeps malformed or pairless task sets explicit instead of reporting false similarity zeros", () => {
    expect(taskSetFacts("{}")).toEqual({ state: "unobservable", reason: "tasks.json is not a JSON array" });
    const singleton = taskSetFacts(JSON.stringify([{ taskId: "one", family: "only", publicInput: {} }]));
    expect(singleton.state).toBe("recorded");
    if (singleton.state !== "recorded") throw new Error("expected recorded task facts");
    expect(singleton.lexical?.medianSameFamilyCosine).toBeNull();
    expect(singleton.lexical?.p90SameFamilyCosine).toBeNull();
  });

  it("keeps the latest product and task summary in quickRead when no battery measured any checkpoint", () => {
    const { root, campaign } = fixture();
    rmSync(join(campaign, "candidates"), { recursive: true, force: true });
    rmSync(join(campaign, "contest"), { recursive: true, force: true });
    const result = spawnSync(
      bunExecutable,
      [script, "domain", "--repo", root, "--campaign", campaign, "--json"],
      {},
    );
    expect(result.status).toBe(0);
    const audit = JSON.parse(result.stdout);
    expect(audit.summary.measuredCheckpoints).toBe(0);
    expect(audit.quickRead.measuredCheckpoints).toEqual([]);
    expect(audit.quickRead.latestCheckpoint).toMatchObject({
      ordinal: 2,
      measuredBatteries: 0,
      product: { nonBlankLines: expect.any(Number) },
      fromStarter: { added: expect.any(Number) },
      taskSet: { tasks: 3 },
    });
  });
});

/**
 * The controller's own evidence: the typed owner an abort records, the terminal and opening fields
 * the strict reader refuses to do without, the dead-process witness beside an opening that never
 * closed, the case denominator derived from the case rows, and the launch id walk over recorded
 * openings. src/run/controller-evidence.ts owns the reader and writer.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { readJsonFile } from "../src/meta/completed-json.ts";
import { BuildAgentTurnNonResult } from "../src/author/build-agent.ts";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
import { CampaignBudgetExhausted } from "../src/run/controller-ledger.ts";
import { ProviderResourceBudgetExhausted } from "../src/run/provider-resource-budget.ts";
import { ControllerSignalAbort, controllerAbortClause } from "../src/run/controller-abort-clause.ts";
import {
  type PreparedControllerTerminal,
  prepareControllerTerminal,
  readControllerEvidence,
  resolveLaunchRunId,
  writeControllerTerminal,
} from "../src/run/controller-evidence.ts";
import { controllerDenominator } from "../src/run/controller-denominator.ts";
import { type LoopTerminalCode, loopTerminalCode } from "../src/run/loop-terminal.ts";
import type { ControllerAbortClause } from "../src/run/controller-stop-evidence.ts";
import { SOURCE_IDENTITY } from "../src/run/source-identity.ts";

const RUN = "run-current";
const EPOCH = "epoch-aaaaaaaaaaaa";
const ABSENT = Symbol("absent abandonedRuns");
const RUN_END = { climb: null, provenance: [] };
const roots: string[] = [];
afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "ana-controller-evidence-"));
  roots.push(value);
  return value;
}

/** A campaign holding one recorded opening and terminal for RUN. */
function recordedCampaign(
  abandonedRuns: JsonValue | typeof ABSENT = [],
  verifierCleanup?: JsonValue,
  terminalSchema = "campaign-terminal/v4",
): string {
  const campaignDir = join(root(), "campaigns", "project");
  const controllerDir = join(campaignDir, "controller", RUN);
  mkdirSync(controllerDir, { recursive: true });
  writeFileSync(
    join(campaignDir, "epochs.json"),
    JSON.stringify({
      schema: "campaign-epochs/v1",
      current: EPOCH,
      epochs: [{ key: EPOCH, supersedes: null }],
    }),
  );
  const source = { commit: "a".repeat(40), dirty: false, sourceDigest: "b".repeat(64) };
  const budget = { turnBudget: null, turnsUsed: 0, status: "active" };
  const opening: JsonObject = {
    schema: "campaign-opening/v2",
    runId: RUN,
    source,
    budget,
    epoch: { key: EPOCH },
    continuation: null,
    operatorVerifierRegistry: null,
  };
  if (abandonedRuns !== ABSENT) opening.abandonedRuns = abandonedRuns;
  writeFileSync(join(controllerDir, "opening.json"), JSON.stringify(opening));
  writeFileSync(
    join(controllerDir, "terminal.json"),
    JSON.stringify({
      schema: terminalSchema,
      budget,
      openingDigest: hashJsonValue(opening),
      source,
      epoch: EPOCH,
      lock: { token: "recorded-token", ownedAtRecord: true },
      iterations: [],
      absentSteps: [],
      outcome: "completed",
      abortClause: null,
      terminalReason: "completed",
      writtenAt: "2026-01-01T00:00:00.000Z",
      runEnd: RUN_END,
      ...keyIfDefined("verifierCleanup", verifierCleanup),
    }),
  );
  return campaignDir;
}

describe("the recorded terminal the strict reader admits", () => {
  it("reads back the run-end numbers, absent steps and cleanup receipts it recorded", () => {
    const verifierCleanup = { state: "pending", receiptIds: ["/protected/receipt"] };
    expect(readControllerEvidence(recordedCampaign([], verifierCleanup), RUN)).toMatchObject({
      state: "recorded",
      runEnd: RUN_END,
      absentSteps: [],
      verifierCleanup,
    });
    expect(readControllerEvidence(recordedCampaign([], { state: "complete" }), RUN)).toMatchObject({
      verifierCleanup: { state: "complete" },
    });
  });

  it.each<[string, JsonValue]>([
    ["an empty observation", []],
    ["a sorted predecessor list", ["run-a", "run-b"]],
  ])("reads %s of abandoned runs", (_name, abandonedRuns) => {
    expect(readControllerEvidence(recordedCampaign(abandonedRuns), RUN)).toMatchObject({
      state: "recorded",
      abandonedRuns,
    });
  });

  it.each<[string, JsonValue | typeof ABSENT]>([
    ["an opening that records none", ABSENT],
    ["a non-list", "run-a"],
    ["an empty run id", [""]],
    ["the current run", [RUN]],
    ["duplicates", ["run-a", "run-a"]],
    ["a reordered list", ["run-b", "run-a"]],
  ])("refuses abandoned runs given as %s", (_name, abandonedRuns) => {
    expect(() => readControllerEvidence(recordedCampaign(abandonedRuns), RUN)).toThrow(/abandonedRuns/);
  });

  it("refuses an empty pending cleanup, a terminal from before the run-end numbers, and one without absent steps", () => {
    expect(() =>
      readControllerEvidence(recordedCampaign([], { state: "pending", receiptIds: [] }), RUN),
    ).toThrow("verifierCleanup");
    expect(() =>
      readControllerEvidence(recordedCampaign([], undefined, "campaign-terminal/v3"), RUN),
    ).toThrow(/campaign-terminal\/v3.*campaign-terminal\/v4/);
    const campaign = recordedCampaign([]);
    const terminalPath = join(campaign, "controller", RUN, "terminal.json");
    const { absentSteps: _dropped, ...rest } = JSON.parse(readFileSync(terminalPath, "utf8"));
    writeFileSync(terminalPath, JSON.stringify(rest));
    expect(() => readControllerEvidence(campaign, RUN)).toThrow(/absentSteps/);
  });
});

function storageError(code: string): Error {
  const error: Error & { code?: string } = new Error("write failed");
  error.code = code;
  return error;
}

function prepared(overrides: Partial<PreparedControllerTerminal>): PreparedControllerTerminal {
  return {
    path: join(root(), "terminal.json"),
    source: SOURCE_IDENTITY,
    epoch: EPOCH,
    openingDigest: "b".repeat(64),
    iterations: [],
    absentSteps: [],
    outcome: "aborted",
    abortClause: null,
    terminalReason: "aborted: fixture",
    denominator: { state: "absent" },
    budget: { turnBudget: null, turnsUsed: 0, status: "active" },
    providerResourceBudget: null,
    runEnd: { climb: null, provenance: [] },
    ...overrides,
  };
}

describe("the typed owner an abort records", () => {
  it.each<[ControllerAbortClause, string, unknown]>([
    ["budget-limited", "campaign budget", new CampaignBudgetExhausted()],
    [
      "budget-limited",
      "provider budget, whose message also matches the environment",
      new ProviderResourceBudgetExhausted("builder", 5, 5),
    ],
    [
      "environment-blocked",
      "Builder turn non-result",
      new BuildAgentTurnNonResult("builder", "failed", ["provider refused the turn"]),
    ],
    ["environment-blocked", "environment refusal", new EnvironmentRefusal("no credential is configured")],
    [
      "environment-blocked",
      "plain capacity message",
      new Error("429 Too Many Requests: the model is overloaded"),
    ],
    ["signal-terminated", "signal", new ControllerSignalAbort("SIGTERM")],
    ["host-storage-exhausted", "ENOSPC", storageError("ENOSPC")],
    ["controller-unclassified", "unrecognised error", new Error("provider exploded")],
  ])("names %s for a %s", (clause, _name, input) => {
    expect(controllerAbortClause(input)).toBe(clause);
  });

  // A reason leading with `aborted: ` would resolve to no code for every aborted terminal, so the
  // recorded reason leads with the owner; owners that are not loop codes stay unresolved.
  it.each<[LoopTerminalCode | null, Error, string]>([
    ["environment-blocked", new EnvironmentRefusal("no credential is configured"), "environment-blocked: "],
    ["budget-limited", new CampaignBudgetExhausted(), "budget-limited: "],
    [null, new Error("provider exploded"), "controller-unclassified: "],
  ])("resolves code %p from the reason a prepared abort records", (code, failure, head) => {
    const repoRoot = root();
    const reason = prepareControllerTerminal({
      repoRoot,
      projectId: "abort-encoding",
      opening: {
        digest: "b".repeat(64),
        epoch: { key: EPOCH, dir: repoRoot, supersedes: null },
        runId: "r1",
      },
      iterations: [],
      absentSteps: [],
      failure,
    }).terminalReason;
    expect(reason).toStartWith(head);
    expect(loopTerminalCode(reason)).toBe(code);
  });

  it("refuses to record an aborted terminal with no typed owner, and records a completed one with its run end", () => {
    expect(() => writeControllerTerminal(prepared({}), { token: "t", ownedAtRecord: true })).toThrow(
      "an aborted controller terminal must record a typed abort clause",
    );
    const path = join(root(), "terminal.json");
    const runEnd = { unreadable: "no adopted product" };
    writeControllerTerminal(prepared({ path, outcome: "completed", terminalReason: "completed", runEnd }), {
      token: "t",
      ownedAtRecord: true,
    });
    expect(readJsonFile(path)).toMatchObject({ schema: "campaign-terminal/v4", runEnd });
  });
});

/** SIGKILL runs no handler, so an opening with no terminal is explained by its lock holder; a live
 *  holder must never read as dead, since that would invent a terminal the controller will write. */
it.each<[string, string | null, string]>([
  ["no lock", null, "absent"],
  ["a pid no process can hold", JSON.stringify({ pid: 2_147_483_646 }), "proved-dead"],
  ["this live process", JSON.stringify({ pid: process.pid, token: "live" }), "held"],
  ["an unreadable lock", "{not json", "unreadable"],
])("names the holder beside an unfinished opening with %s", (_name, lock, holder) => {
  const campaignDir = join(root(), "campaigns", "witness-project");
  const dir = join(campaignDir, "controller", "killed-run");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "opening.json"),
    JSON.stringify({
      schema: "campaign-opening/v2",
      runId: "killed-run",
      source: { commit: "a".repeat(40), dirty: false, sourceDigest: "b".repeat(64) },
      epoch: { key: EPOCH },
      project: { id: "witness-project" },
    }),
  );
  if (lock !== null) writeFileSync(join(campaignDir, ".controller.lock"), lock);
  expect(readControllerEvidence(campaignDir, "killed-run")).toMatchObject({
    state: "unfinished",
    holder,
    evidence: { opening: join("controller", "killed-run", "opening.json") },
  });
});

it("counts zero cases for a battery refused before any case ran, and invalid only for an unparsable record", () => {
  const dir = root();
  expect(controllerDenominator(dir, [])).toEqual({ state: "absent" });
  expect(controllerDenominator(dir, [RUN])).toEqual({
    state: "recorded",
    total: 0,
    verified: 0,
    unaccepted: 0,
    nonResults: 0,
  });
  writeFileSync(join(dir, "case-record.jsonl"), "{not-json\n");
  expect(controllerDenominator(dir, [RUN])).toEqual({ state: "invalid", error: "case-record unreadable" });
});

it("resolveLaunchRunId walks the letter suffixes and refuses only at exhaustion", () => {
  const repoRoot = root();
  const controller = join(repoRoot, "campaigns", "walk", "controller");
  const record = (id: string) => {
    mkdirSync(join(controller, id), { recursive: true });
    writeFileSync(join(controller, id, "opening.json"), "{}\n");
  };
  for (const id of ["walk-run", "walk-runb", "walk-runc"]) record(id);
  expect(resolveLaunchRunId(repoRoot, "walk", "fresh-run")).toBe("fresh-run");
  expect(resolveLaunchRunId(repoRoot, "walk", "walk-run")).toBe("walk-rund");
  for (const letter of "defghijklmnopqrstuvwxyz") record(`walk-run${letter}`);
  expect(() => resolveLaunchRunId(repoRoot, "walk", "walk-run")).toThrow(/every continuation suffix b-z/);
});

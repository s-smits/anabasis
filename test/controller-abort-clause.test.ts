import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { BuildAgentTurnNonResult } from "../src/author/build-agent.ts";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
import { CampaignBudgetExhausted } from "../src/run/campaign-budget.ts";
import { ProviderResourceBudgetExhausted } from "../src/run/provider-resource-budget.ts";
import { ControllerSignalAbort, controllerAbortClause } from "../src/run/controller-abort-clause.ts";
import {
  type PreparedControllerTerminal,
  prepareControllerTerminal,
  readControllerEvidence,
  writeControllerTerminal,
} from "../src/run/controller-evidence.ts";
import { type LoopTerminalCode, loopTerminalCode } from "../src/run/loop-terminal.ts";
import type { ControllerAbortClause } from "../src/run/controller-stop-evidence.ts";
import { SOURCE_IDENTITY } from "../src/run/source-identity.ts";

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "ana-abort-clause-"));
  roots.push(value);
  return value;
}

function storageError(code: string): Error {
  const error: Error & { code?: string } = new Error("write failed");
  error.code = code;
  return error;
}

function prepared(overrides: Partial<PreparedControllerTerminal>): PreparedControllerTerminal {
  return {
    path: join(root(), "terminal.json"),
    source: SOURCE_IDENTITY,
    epoch: "epoch-aaaaaaaaaaaa",
    openingDigest: "b".repeat(64),
    iterations: [],
    absentSteps: [],
    lastIteration: null,
    outcome: "aborted",
    abortClause: null,
    terminalReason: "aborted: fixture",
    denominator: { state: "absent" },
    budget: { turnBudget: null, turnsUsed: 0, status: "active" },
    providerResourceBudget: null,
    ...overrides,
  };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("controller abort clause", () => {
  // One row per recognised failure kind. The last row checks that an unrecognised error receives
  // the controller-unclassified clause, so a missing classification remains visible.
  const cases: Array<[ControllerAbortClause, unknown]> = [
    ["budget-limited", new CampaignBudgetExhausted()],
    ["budget-limited", new ProviderResourceBudgetExhausted("built", 10, 10)],
    ["environment-blocked", new BuildAgentTurnNonResult("builder", "failed", ["provider refused the turn"])],
    ["environment-blocked", new EnvironmentRefusal("no credential is configured")],
    ["signal-terminated", new ControllerSignalAbort("SIGTERM")],
    ["host-storage-exhausted", storageError("ENOSPC")],
    ["controller-unclassified", new Error("provider exploded")],
  ];

  for (const [clause, input] of cases) {
    it(`names ${clause} for its failure input`, () => {
      expect(controllerAbortClause(input)).toBe(clause);
    });
  }

  it("reads a provider capacity message through the one canonical matcher", () => {
    // Raised outside a Builder turn wrapper, this reaches the controller as a plain Error. Before
    // the classifier it recorded no owner at all; run 25's invocation c is that record.
    expect(controllerAbortClause(new Error("429 Too Many Requests: the model is overloaded"))).toBe(
      "environment-blocked",
    );
  });

  it("keeps the budget owner even when its message would also match the environment", () => {
    const failure = new ProviderResourceBudgetExhausted("builder", 5, 5);
    expect(controllerAbortClause(failure)).toBe("budget-limited");
  });

  it("refuses to record an aborted terminal with no typed owner", () => {
    // The hostile case the reader cannot repair afterwards: prose in place of an owner.
    expect(() => writeControllerTerminal(prepared({}), { token: "t", ownedAtRecord: true })).toThrow(
      "an aborted controller terminal must record a typed abort clause",
    );
  });

  it("records a completed terminal with no clause", () => {
    const path = join(root(), "terminal.json");
    writeControllerTerminal(prepared({ path, outcome: "completed", terminalReason: "completed" }), {
      token: "t",
      ownedAtRecord: true,
    });
    expect(Bun.file(path).size).toBeGreaterThan(0);
  });
});

describe("a recorded abort names its terminal code", () => {
  function reasonFor(failure: Error): string {
    const repoRoot = root();
    return prepareControllerTerminal({
      repoRoot,
      projectId: "abort-encoding",
      opening: {
        digest: "b".repeat(64),
        epoch: { key: "epoch-aaaaaaaaaaaa", dir: repoRoot, supersedes: null },
        runId: "r1",
      },
      iterations: [],
      absentSteps: [],
      failure,
    }).terminalReason;
  }

  // `loopTerminalCode` takes the head before the first colon. The reason used to lead with
  // `aborted: `, repeating the `outcome` field recorded beside it, so 45 of the 60 terminals
  // recorded up to 2026-09-18 resolved to null -- every environment-blocked and budget-limited
  // ending among them, and whole-run-investigation's digest printed `aborted` for each. Nothing
  // pinned the recorded encoding, which is how the two vocabularies drifted apart unnoticed.
  const codes: Array<[LoopTerminalCode, Error]> = [
    ["environment-blocked", new EnvironmentRefusal("no credential is configured")],
    ["budget-limited", new CampaignBudgetExhausted()],
  ];
  for (const [code, failure] of codes) {
    it(`resolves ${code} from the reason it records`, () => {
      expect(loopTerminalCode(reasonFor(failure))).toBe(code);
    });
  }

  it("leaves an owner that names no terminal code unresolved", () => {
    // Five abort clauses exist and only two are also loop terminal codes, so `signal-terminated`,
    // `host-storage-exhausted` and `controller-unclassified` are owners with no code to resolve
    // to. They stay null, which the exit status already reads as "did not settle the question",
    // while still naming their owner — which is the half worth keeping.
    const reason = reasonFor(new Error("provider exploded"));
    expect(reason.startsWith("controller-unclassified: ")).toBe(true);
    expect(loopTerminalCode(reason)).toBeNull();
  });
});

describe("dead-process witness", () => {
  function opening(campaignDir: string, runId: string): void {
    const dir = join(campaignDir, "controller", runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "opening.json"),
      JSON.stringify({
        schema: "campaign-opening/v2",
        runId,
        source: { commit: "a".repeat(40), dirty: false, sourceDigest: "b".repeat(64) },
        epoch: { key: "epoch-aaaaaaaaaaaa" },
        project: { id: "witness-project" },
      }),
    );
  }

  it("names the lock holder beside an opening that never recorded", () => {
    // SIGKILL runs no handler, so no in-process record can close this run. The reader says whether
    // the holder is still alive instead of leaving the missing terminal unexplained.
    const campaignDir = join(root(), "campaigns", "witness-project");
    opening(campaignDir, "killed-run");
    const evidence = readControllerEvidence(campaignDir, "killed-run");
    expect(evidence.state).toBe("unfinished");
    if (evidence.state !== "unfinished") throw new Error("unexpected controller state");
    expect(evidence.holder).toBe("absent");
    expect(evidence.evidence.opening).toBe(join("controller", "killed-run", "opening.json"));
  });

  it("proves a dead holder from its own lock record", () => {
    const campaignDir = join(root(), "campaigns", "witness-project");
    opening(campaignDir, "killed-run");
    // A pid no process can hold: `kill(pid, 0)` raises ESRCH, which is the one witness the rule
    // accepts. The recorded holder cannot still be preparing its terminal record.
    writeFileSync(join(campaignDir, ".controller.lock"), JSON.stringify({ pid: 2_147_483_646 }));
    const evidence = readControllerEvidence(campaignDir, "killed-run");
    if (evidence.state !== "unfinished") throw new Error("unexpected controller state");
    expect(evidence.holder).toBe("proved-dead");
  });

  it("keeps a live holder held, so a running controller is never called dead", () => {
    // The hostile direction. An unfinished opening whose holder still runs is a run in progress:
    // reading it as a dead-process witness would invent a terminal the controller will write.
    const campaignDir = join(root(), "campaigns", "witness-project");
    opening(campaignDir, "live-run");
    writeFileSync(join(campaignDir, ".controller.lock"), JSON.stringify({ pid: process.pid, token: "live" }));
    const evidence = readControllerEvidence(campaignDir, "live-run");
    if (evidence.state !== "unfinished") throw new Error("unexpected controller state");
    expect(evidence.holder).toBe("held");
  });

  it("leaves an unreadable lock undeterminable", () => {
    const campaignDir = join(root(), "campaigns", "witness-project");
    opening(campaignDir, "damaged-run");
    writeFileSync(join(campaignDir, ".controller.lock"), "{not json");
    const evidence = readControllerEvidence(campaignDir, "damaged-run");
    if (evidence.state !== "unfinished") throw new Error("unexpected controller state");
    expect(evidence.holder).toBe("unreadable");
  });
});

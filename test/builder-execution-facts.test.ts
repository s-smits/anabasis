import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  submitProjection,
  type BuilderExecutionEvidence,
  type BuilderSubmitAttempt,
} from "../src/author/builder-execution.ts";
import {
  readExecutionEvidence,
  readExecutionEvidenceDetails,
} from "../tools/outcome/builder-execution-facts.ts";
const BUILDER_EXECUTION_JSON = "builder-execution.json";

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An epoch directory under its campaign root, because the reader asks the controller evidence
 *  beside it whether the campaign has closed. */
function epoch() {
  const campaign = mkdtempSync(join(tmpdir(), "ana-execution-facts-"));
  cleanups.push(campaign);
  const dir = join(campaign, "epoch-one");
  mkdirSync(dir, { recursive: true });
  return { dir, campaign };
}

function candidate(ordinal: number, over: Partial<BuilderSubmitAttempt> = {}): BuilderSubmitAttempt {
  return {
    kind: "candidate",
    ordinal,
    turn: ordinal,
    atMs: ordinal * 1000,
    outcome: "refused",
    stage: "validation",
    commit: `commit-${ordinal}`,
    findingsDigest: `digest-${ordinal}`,
    findingCodes: ["missing-check"],
    // Only the first candidate has no predecessor to compare itself against.
    repeatedFindings: ordinal === 1 ? null : false,
    findingsDelta: ordinal === 1 ? null : { carried: 0, resolved: 0, introduced: 0 },
    workspaceChanged: ordinal === 1 ? null : true,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
    ...over,
  };
}

/** The one row the controller writes itself, when the saved model-call budget is spent before a
 *  candidate is inspected. */
function controllerStop(ordinal: number): BuilderSubmitAttempt {
  return {
    kind: "controller-terminal",
    ordinal,
    turn: ordinal,
    atMs: ordinal * 1000,
    outcome: "refused",
    stage: "gates",
    commit: "budget-limited",
    findingsDigest: "budget-digest",
    findingCodes: ["budget"],
    repeatedFindings: null,
    findingsDelta: null,
    workspaceChanged: null,
    treeFirstSubmittedAsAttempt: null,
    terminal: true,
  };
}

/** A current record; its counts are its submit rows' projection, as the writer states them. */
function record(over: Partial<BuilderExecutionEvidence> = {}): BuilderExecutionEvidence {
  const base: BuilderExecutionEvidence = {
    schema: "builder-execution/v5",
    backend: "claude",
    runtimeIdentity: null,
    turns: 2,
    durationMs: 5_000,
    toolCalls: { total: 1, failed: 0, byName: { submit: 1 }, custom: 1, native: 0 },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 2, estimatedTurns: 0 },
    firstToolMs: 100,
    submits: [candidate(1)],
    ...submitProjection([candidate(1)]),
    partialTurn: null,
    turnRetries: [],
    authoringReviews: [],
    failedCalls: [],
    failedCallsOmitted: 0,
    failedByName: {},
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-09-01T10:00:00.000Z",
    ...over,
  };
  return { ...base, ...submitProjection(base.submits) };
}

function write(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), body);
}

function writeRecord(dir: string, name: string, evidence: BuilderExecutionEvidence): void {
  write(dir, name, JSON.stringify(evidence));
}

function closeCampaign(campaign: string, runId: string, writtenAt: string): void {
  mkdirSync(join(campaign, "controller", runId), { recursive: true });
  writeFileSync(
    join(campaign, "controller", runId, "terminal.json"),
    JSON.stringify({ writtenAt, terminal: "completed" }),
  );
}

describe("execution evidence for one epoch", () => {
  test("reads the bare file as session 1 and each numbered file as the session after it", () => {
    const { dir } = epoch();
    writeRecord(dir, BUILDER_EXECUTION_JSON, record({ turns: 1 }));
    writeRecord(dir, "builder-execution-02.json", record({ turns: 2 }));
    writeRecord(dir, "builder-execution-03.json", record({ turns: 3 }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.sessions).toEqual([1, 2, 3]);
    expect(read.records.map((session) => session.turns)).toEqual([1, 2, 3]);
    expect(read.unavailable).toEqual([]);
    expect(readExecutionEvidence(dir)).toEqual(read.records);
  });

  test("an epoch with no directory and one with no record both read as no sessions", () => {
    const { dir } = epoch();
    expect(readExecutionEvidence(join(dir, "absent"))).toEqual([]);
    expect(readExecutionEvidence(dir)).toEqual([]);
  });

  test("refuses a record whose counts are not its submit rows' projection", () => {
    const { dir } = epoch();
    // Run 35 resubmitted one tree against a refusal it had already been handed. The rows say so;
    // a counter stating the opposite beside them was not written by the recorder.
    const submits = [
      candidate(1),
      candidate(2, { commit: "commit-1", repeatedFindings: true, treeFirstSubmittedAsAttempt: 1 }),
      candidate(3, { workspaceChanged: false }),
    ];
    writeRecord(dir, BUILDER_EXECUTION_JSON, { ...record({ submits }), repeatedFindingSubmits: 0 });
    writeRecord(dir, "builder-execution-02.json", record({ submits }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.sessions).toEqual([2]);
    expect(read.records[0]).toMatchObject({ repeatedFindingSubmits: 1, uniqueCandidateTrees: 2 });
    expect(read.unavailable).toEqual([
      `${join(dir, BUILDER_EXECUTION_JSON)}: builder-execution/v5 record has an incomplete or invalid shape`,
    ]);
  });

  test("keeps the controller's own stop out of every candidate-derived count", () => {
    const { dir } = epoch();
    writeRecord(
      dir,
      BUILDER_EXECUTION_JSON,
      record({ submits: [controllerStop(1), candidate(2), candidate(3)] }),
    );
    const read = readExecutionEvidence(dir)[0];
    expect(read?.submitCounts).toEqual({ raw: 3, candidates: 2, controllerTerminals: 1 });
    // The stop has the earliest instant and a commit of its own; neither becomes a candidate fact.
    expect(read?.firstSubmitMs).toBe(2000);
    expect(read?.uniqueCandidateTrees).toBe(2);
  });

  test("reads a closing record's two invocations", () => {
    const { dir } = epoch();
    write(
      dir,
      BUILDER_EXECUTION_JSON,
      JSON.stringify({
        ...record({ outcome: "recorded-at-terminal" }),
        closure: { runId: "run-7", closedAt: "2026-09-01T11:00:00.000Z" },
        postTerminal: { runId: "run-8", closedAt: "2026-09-01T12:00:00.000Z" },
      }),
    );
    const read = readExecutionEvidence(dir)[0];
    expect(read?.closure).toEqual({ runId: "run-7", closedAt: "2026-09-01T11:00:00.000Z" });
    expect(read?.postTerminal).toEqual({ runId: "run-8", closedAt: "2026-09-01T12:00:00.000Z" });
  });

  test("does not read a closing record in the earlier sealed spelling", () => {
    const { dir } = epoch();
    for (const [outcome, closure] of [
      ["sealed-at-terminal", { runId: "run-7", closedAt: "2026-09-01T11:00:00.000Z" }],
      ["recorded-at-terminal", { runId: "run-7", sealedAt: "2026-09-01T11:00:00.000Z" }],
    ] as const) {
      write(dir, BUILDER_EXECUTION_JSON, JSON.stringify({ ...record({}), outcome, closure }));
      const read = readExecutionEvidenceDetails(dir);
      expect(read.records).toEqual([]);
      expect(read.unavailable).toHaveLength(1);
    }
  });
});

describe("evidence a reader cannot safely project", () => {
  test("names an unreadable session and keeps the ones after it", () => {
    const { dir } = epoch();
    writeRecord(dir, BUILDER_EXECUTION_JSON, record({ turns: 1 }));
    write(dir, "builder-execution-02.json", JSON.stringify({ schema: "builder-execution/v2" }));
    writeRecord(dir, "builder-execution-03.json", record({ turns: 3 }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.sessions).toEqual([1, 3]);
    expect(read.records.map((session) => session.turns)).toEqual([1, 3]);
    expect(read.unavailable).toEqual([
      `${join(dir, "builder-execution-02.json")}: malformed execution record with unknown schema "builder-execution/v2"`,
    ]);
  });

  test("refuses a record whose submit row does not say which kind it is", () => {
    // The rule lives in the record validator alone: a row without a kind makes the whole record
    // an invalid shape, which is why no reason names the submit row.
    const { dir } = epoch();
    const withoutKind = Object.fromEntries(
      Object.entries(candidate(1)).filter(([field]) => field !== "kind"),
    );
    write(dir, BUILDER_EXECUTION_JSON, JSON.stringify({ ...record(), submits: [withoutKind] }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.records).toEqual([]);
    expect(read.unavailable).toEqual([
      `${join(dir, BUILDER_EXECUTION_JSON)}: builder-execution/v5 record has an incomplete or invalid shape`,
    ]);
  });

  test("reports malformed JSON with the parse error, not as a missing session", () => {
    const { dir } = epoch();
    write(dir, BUILDER_EXECUTION_JSON, "{ not json");
    const read = readExecutionEvidenceDetails(dir);
    expect(read.records).toEqual([]);
    expect(read.unavailable[0]).toContain(`${join(dir, BUILDER_EXECUTION_JSON)}: malformed JSON (`);
  });

  test("names the gap a missing middle session leaves and still reads the sessions past it", () => {
    const { dir } = epoch();
    writeRecord(dir, BUILDER_EXECUTION_JSON, record({ turns: 1 }));
    writeRecord(dir, "builder-execution-04.json", record({ turns: 4 }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.sessions).toEqual([1, 4]);
    expect(read.unavailable).toEqual([
      `${join(dir, "builder-execution-02.json")}: execution evidence gap at session 2 through 3; later numbered records are present`,
    ]);
  });

  test("names a second file for one session and says which one it read", () => {
    const { dir } = epoch();
    writeRecord(dir, BUILDER_EXECUTION_JSON, record({ turns: 1 }));
    writeRecord(dir, "builder-execution-02.json", record({ turns: 2 }));
    writeRecord(dir, "builder-execution-2.json", record({ turns: 22 }));
    const read = readExecutionEvidenceDetails(dir);
    expect(read.records.map((session) => session.turns)).toEqual([1, 2]);
    expect(read.unavailable).toEqual([
      `${join(dir, "builder-execution-2.json")}: duplicate execution evidence for session 2; ${join(dir, "builder-execution-02.json")} is the selected record`,
    ]);
  });

  test("refuses a filename whose session number is not a positive integer", () => {
    const { dir } = epoch();
    writeRecord(dir, "builder-execution-0.json", record());
    const read = readExecutionEvidenceDetails(dir);
    expect(read.records).toEqual([]);
    expect(read.unavailable).toEqual([
      `${join(dir, "builder-execution-0.json")}: malformed execution record filename; session number must be a positive integer`,
    ]);
  });

  test("names an in-flight checkpoint once the campaign has closed, and still returns it", () => {
    // Three of run 25's four records stayed in flight after the campaign ended. The checkpoint's
    // totals are real, so the rows stay; what the report must not lose is that they never ended.
    const { dir, campaign } = epoch();
    writeRecord(dir, BUILDER_EXECUTION_JSON, record({ outcome: "in-flight" }));
    expect(readExecutionEvidenceDetails(dir).unavailable).toEqual([]);

    closeCampaign(campaign, "run-9", "2026-09-01T13:00:00.000Z");
    const read = readExecutionEvidenceDetails(dir);
    expect(read.records.map((session) => session.outcome)).toEqual(["in-flight"]);
    expect(read.unavailable).toEqual([
      `${join(dir, BUILDER_EXECUTION_JSON)}: session 1 still reads in-flight after controller run run-9 recorded its terminal at 2026-09-01T13:00:00.000Z`,
    ]);
  });
});

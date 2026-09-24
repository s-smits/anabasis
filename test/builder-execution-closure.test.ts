import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import {
  builderExecutionEvidenceWriter,
  writeBuilderExecutionEvidence,
} from "../src/author/builder-execution-writer.ts";
import {
  type BuilderExecutionInvocation,
  latestClosedInvocation,
  postTerminalInvocation,
  closeOpenBuilderExecutionRecords,
} from "../src/run/builder-execution-closure.ts";

const cleanups: string[] = [];

/** The three fields the closure owns; every other field of the record is its session's own. */
interface StoredRecord {
  outcome: string;
  closure?: BuilderExecutionInvocation;
  postTerminal?: BuilderExecutionInvocation;
}

afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function campaign() {
  const campaignRoot = mkdtempSync(join(tmpdir(), "ana-execution-closure-"));
  cleanups.push(campaignRoot);
  const epochDir = join(campaignRoot, "epoch-a1");
  mkdirSync(epochDir, { recursive: true });
  return { campaignRoot, epochDir };
}

function execution(outcome: BuilderExecutionEvidence["outcome"]): BuilderExecutionEvidence {
  return {
    schema: "builder-execution/v6",
    backend: "codex",
    runtimeIdentity: null,
    turns: 1,
    durationMs: 100,
    toolCalls: { total: 1, failed: 0, byName: { submit: 1 }, custom: 1, native: 0 },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: 0,
    submits: [],
    partialTurn: null,
    turnRetries: [],
    authoringReviews: [],
    failedCalls: [],
    failedCallsOmitted: 0,
    failedByName: {},
    customCalls: [],
    customCallsOmitted: 0,
    outcome,
    writtenAt: "2026-08-25T00:00:00.000Z",
  };
}

function writeRecord(epochDir: string, name: string, outcome: BuilderExecutionEvidence["outcome"]): string {
  const path = join(epochDir, name);
  writeFileSync(path, JSON.stringify(execution(outcome)));
  return path;
}

function open(campaignRoot: string, runId: string, writtenAt?: string): string {
  const dir = join(campaignRoot, "controller", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "opening.json"),
    JSON.stringify({ schema: "campaign-opening/v2", runId, writtenAt }),
  );
  return dir;
}

function record(campaignRoot: string, runId: string, writtenAt: string): void {
  writeFileSync(
    join(open(campaignRoot, runId), "terminal.json"),
    JSON.stringify({ schema: "campaign-terminal/v4", outcome: "completed", writtenAt }),
  );
}

function read(path: string): StoredRecord {
  return parseJsonAs<StoredRecord>(readFileSync(path, "utf8"));
}

describe("latest recorded invocation", () => {
  it("stays null while an invocation newer than every terminal is still open", () => {
    const { campaignRoot } = campaign();
    record(campaignRoot, "run-1", "2026-08-25T01:00:00.000Z");
    open(campaignRoot, "run-2", "2026-08-25T02:00:00.000Z");
    expect(latestClosedInvocation(campaignRoot)).toBeNull();
  });

  it("ignores a dead orphan opening older than the newest recorded terminal", () => {
    // The run-25 case: an invocation wrote its opening and was killed, and a later invocation
    // ran to a recorded terminal. Treating the orphan as forever-open disabled the closure on the
    // exact campaign it was written for.
    const { campaignRoot } = campaign();
    open(campaignRoot, "run-0", "2026-08-25T00:30:00.000Z");
    record(campaignRoot, "run-1", "2026-08-25T01:00:00.000Z");
    expect(latestClosedInvocation(campaignRoot)).toEqual({
      runId: "run-1",
      closedAt: "2026-08-25T01:00:00.000Z",
    });
  });

  it("stays null when an open opening's write time cannot be read", () => {
    // Undeterminable is never dead: a damaged opening blocks rather than being recorded over.
    const { campaignRoot } = campaign();
    record(campaignRoot, "run-1", "2026-08-25T01:00:00.000Z");
    open(campaignRoot, "run-2");
    expect(latestClosedInvocation(campaignRoot)).toBeNull();
  });

  it("stays null when a terminal cannot prove when it recorded", () => {
    const { campaignRoot } = campaign();
    record(campaignRoot, "run-1", "not-a-timestamp");
    expect(latestClosedInvocation(campaignRoot)).toBeNull();
  });

  it("stays null for a campaign with no controller evidence at all", () => {
    // A fixture or a tool directory has no invocation to be after; it is never post-terminal.
    const { campaignRoot } = campaign();
    expect(latestClosedInvocation(campaignRoot)).toBeNull();
  });

  it("names the newest recorded run once every invocation has closed", () => {
    const { campaignRoot } = campaign();
    record(campaignRoot, "run-1", "2026-08-25T01:00:00.000Z");
    record(campaignRoot, "run-2", "2026-08-25T03:00:00.000Z");
    expect(latestClosedInvocation(campaignRoot)).toEqual({
      runId: "run-2",
      closedAt: "2026-08-25T03:00:00.000Z",
    });
  });
});

describe("closing records the controller left open", () => {
  it("closes an in-flight record and names the terminal that closed it", () => {
    // Run 25 ended with three of four records still reading in-flight. The session that wrote the
    // checkpoint never returned, so only the controller can say the run is over.
    const { campaignRoot, epochDir } = campaign();
    const path = writeRecord(epochDir, "builder-execution.json", "in-flight");
    const invocation = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };

    expect(closeOpenBuilderExecutionRecords(campaignRoot, invocation)).toEqual([path]);
    expect(read(path)).toMatchObject({ outcome: "recorded-at-terminal", closure: invocation });
  });

  it("leaves a record sitting at the campaign root alone: records live in epochs", () => {
    const { campaignRoot } = campaign();
    const path = writeRecord(campaignRoot, "builder-execution.json", "in-flight");
    expect(
      closeOpenBuilderExecutionRecords(campaignRoot, { runId: "r", closedAt: "2026-08-25T02:00:00.000Z" }),
    ).toEqual([]);
    expect(read(path).outcome).toBe("in-flight");
  });

  it("leaves a settled record exactly as its own session wrote it", () => {
    // The hostile direction: recording must not overwrite an outcome a session decided for itself.
    const { campaignRoot, epochDir } = campaign();
    const path = writeRecord(epochDir, "builder-execution.json", "recorded");
    const before = readFileSync(path, "utf8");

    expect(closeOpenBuilderExecutionRecords(campaignRoot, { runId: "r", closedAt: "t" })).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("closes every numbered session of every epoch", () => {
    const { campaignRoot, epochDir } = campaign();
    const first = writeRecord(epochDir, "builder-execution.json", "in-flight");
    const second = writeRecord(epochDir, "builder-execution-02.json", "in-flight");
    const settled = writeRecord(epochDir, "builder-execution-03.json", "turn-bound");

    const recorded = closeOpenBuilderExecutionRecords(campaignRoot, { runId: "r", closedAt: "t" });
    // The caller ignores the order; what it reports is which records it closed.
    expect([...recorded].sort()).toEqual([first, second].sort());
    expect(read(settled).outcome).toBe("turn-bound");
  });
});

describe("a write that lands after its invocation recorded", () => {
  it.each([false, true])(
    "retains its own closure when a successor invocation has closed: %s",
    (successorClosed) => {
      const { campaignRoot, epochDir } = campaign();
      open(campaignRoot, "run-1", "2026-08-25T00:00:00.000Z");
      const writeA = builderExecutionEvidenceWriter(epochDir);
      const pathA = join(epochDir, "builder-execution.json");
      writeA(execution("in-flight"));
      const invocationA = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };
      record(campaignRoot, invocationA.runId, invocationA.closedAt);
      closeOpenBuilderExecutionRecords(campaignRoot, invocationA);
      open(campaignRoot, "run-2", "2026-08-25T03:00:00.000Z");
      const writeB = builderExecutionEvidenceWriter(epochDir);
      const pathB = join(epochDir, "builder-execution-02.json");
      writeB(execution("in-flight"));
      const invocationB = { runId: "run-2", closedAt: "2026-08-25T04:00:00.000Z" };
      if (successorClosed) {
        record(campaignRoot, invocationB.runId, invocationB.closedAt);
        closeOpenBuilderExecutionRecords(campaignRoot, invocationB);
      }
      const late = { ...execution("in-flight"), turns: 2 };
      writeA(late);
      expect(JSON.parse(readFileSync(pathA, "utf8"))).toEqual({
        ...late,
        outcome: "recorded-at-terminal",
        closure: invocationA,
        postTerminal: invocationA,
      });
      expect(read(pathB)).toMatchObject(
        successorClosed
          ? { outcome: "recorded-at-terminal", closure: invocationB }
          : { outcome: "in-flight" },
      );
      expect(read(pathB).postTerminal).toBeUndefined();
      if (!successorClosed) expect(read(pathB).closure).toBeUndefined();
      writeA(execution("recorded"));
      expect(read(pathA)).toMatchObject({ outcome: "recorded", postTerminal: invocationA });
      expect(read(pathA).closure).toBeUndefined();
      // The session's settled outcome has no closure field; its retained witness still belongs to A.
      writeA(execution("recorded"));
      expect(read(pathA).postTerminal).toEqual(invocationA);
    },
  );

  it("keeps late checkpoints closed while retaining the session's latest evidence", () => {
    const { campaignRoot, epochDir } = campaign();
    open(campaignRoot, "run-1", "2026-08-25T00:00:00.000Z");
    const write = builderExecutionEvidenceWriter(epochDir);
    const path = join(epochDir, "builder-execution.json");
    write(execution("in-flight"));
    expect(read(path).outcome).toBe("in-flight");
    const invocation = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };
    record(campaignRoot, invocation.runId, invocation.closedAt);
    closeOpenBuilderExecutionRecords(campaignRoot, invocation);
    const late = { ...execution("in-flight"), turns: 2 };
    write(late);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      ...late,
      outcome: "recorded-at-terminal",
      closure: invocation,
      postTerminal: invocation,
    });
    write(execution("recorded"));
    expect(read(path).outcome).toBe("recorded");
    expect(read(path).closure).toBeUndefined();
  });

  it("is kept and named rather than accepted silently", () => {
    // Run 25 wrote sessions 2 and 4 eighteen and twenty-eight minutes after their invocations had
    // ended, into a campaign no controller still owned.
    const { campaignRoot, epochDir } = campaign();
    record(campaignRoot, "run-1", "2026-08-25T02:00:00.000Z");

    writeBuilderExecutionEvidence(epochDir, execution("recorded"));

    expect(read(join(epochDir, "builder-execution.json"))).toMatchObject({
      outcome: "recorded",
      postTerminal: { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" },
    });
  });

  it("leaves an ordinary write during an open invocation unmarked", () => {
    // Every legitimate write happens here: the controller driving the session has not recorded yet.
    const { campaignRoot, epochDir } = campaign();
    open(campaignRoot, "run-1");

    writeBuilderExecutionEvidence(epochDir, execution("recorded"));

    expect(postTerminalInvocation(epochDir)).toBeNull();
    expect(read(join(epochDir, "builder-execution.json")).postTerminal).toBeUndefined();
  });
});

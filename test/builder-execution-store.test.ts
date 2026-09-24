/**
 * Where a Builder execution record lives on disk, and what a reader can say about it afterwards.
 *
 * One file per authoring session: the first owns the bare name, each later session claims the next
 * numbered one, a session's checkpoints rewrite its own file, and its prose goes to a sidecar
 * carrying the same number. When the controller records a terminal, the records still reading
 * in-flight are closed and named with that terminal, and a write that lands after it is kept and
 * marked rather than accepted silently. The reader returns every session it can prove and names
 * every one it cannot, with the reason.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import {
  BUILDER_EXECUTION_EVIDENCE_FILE as FIRST,
  BuilderExecutionRecorder,
  submitProjection,
} from "../src/author/builder-execution.ts";
import { builderExecutionEvidenceWriter } from "../src/author/builder-execution-writer.ts";
import { proseRowCap, proseSidecarPath } from "../src/author/builder-prose.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import type { AgentTurnEvent, AgentTurnResult } from "../src/backends/backend-types.ts";
import { PiPromptRecord } from "../src/backends/pi-session.ts";
import {
  type BuilderExecutionInvocation,
  closeOpenBuilderExecutionRecords,
  latestClosedInvocation,
  postTerminalInvocation,
} from "../src/run/builder-execution-closure.ts";
import {
  readExecutionEvidence,
  readExecutionEvidenceDetails,
} from "../tools/outcome/builder-execution-facts.ts";
import {
  censusProse,
  publicCensus,
} from "../.claude/skills/whole-run-investigation/classifier/prose-input.mjs";
import { double } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { executionRecord, submitRow } from "./helpers/session-execution-record.ts";

/** The fields a closure owns, plus the one a late checkpoint changes. */
interface StoredRecord {
  outcome: string;
  turns: number;
  closure?: BuilderExecutionInvocation;
  postTerminal?: BuilderExecutionInvocation;
}

afterAll(cleanupScratch);

/** An epoch directory under its campaign root, because the writer and the reader both ask the
 *  controller evidence beside it whether the campaign has closed. */
function campaign() {
  const root = scratchDir("ana-execution-store-");
  const epochDir = join(root, "epoch-a1");
  mkdirSync(epochDir, { recursive: true });
  return { root, epochDir };
}

/** The bound a message or reasoning row is cut to. */
const CAP = proseRowCap("reasoning");

/** One session's whole life: a fresh writer that claims its file on the first write. */
const writeSession = (epochDir: string, evidence: BuilderExecutionEvidence) =>
  builderExecutionEvidenceWriter(epochDir)(evidence);

/** A settled record whose one turn ended on `text`, so it carries prose. */
function spoken(text: string): BuilderExecutionEvidence {
  const recorder = new BuilderExecutionRecorder();
  recorder.turnCompleted(double<AgentTurnResult>({ status: "completed", assistantText: text }));
  return recorder.finish("recorded");
}

function opening(root: string, runId: string, writtenAt?: string): string {
  const dir = join(root, "controller", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "opening.json"),
    JSON.stringify({ schema: "campaign-opening/v2", runId, writtenAt }),
  );
  return dir;
}

function terminal(root: string, runId: string, writtenAt: string): void {
  writeFileSync(
    join(opening(root, runId), "terminal.json"),
    JSON.stringify({ schema: "campaign-terminal/v4", outcome: "completed", writtenAt }),
  );
}

const read = (path: string) => parseJsonAs<StoredRecord>(readFileSync(path, "utf8"));
const jsonLines = (path: string) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("one file per session", () => {
  it("numbers each session's record and sidecar, rewrites a session's checkpoints in place, and reads them in order", () => {
    const { epochDir } = campaign();
    const first = builderExecutionEvidenceWriter(epochDir);
    first({ ...spoken("first session"), outcome: "in-flight", turns: 1 });
    // A checkpoint from the same session rewrites its own file rather than claiming another.
    first({ ...spoken("first session"), turns: 2 });
    writeSession(epochDir, { ...spoken("second session"), turns: 3 });
    writeSession(epochDir, { ...spoken("third session"), turns: 4 });

    const details = readExecutionEvidenceDetails(epochDir);
    expect(details.sessions).toEqual([1, 2, 3]);
    expect(details.records.map((record) => record.turns)).toEqual([2, 3, 4]);
    expect(details.unavailable).toEqual([]);
    expect(readExecutionEvidence(epochDir)).toEqual(details.records);
    expect(readFileSync(join(epochDir, "builder-prose.jsonl"), "utf8")).toContain("first session");
    expect(readFileSync(join(epochDir, "builder-prose-02.jsonl"), "utf8")).toContain("second session");
    expect(proseSidecarPath(join(epochDir, "builder-execution-100.json"))).toBe(
      join(epochDir, "builder-prose-100.jsonl"),
    );
  });

  it("reads an epoch with no directory and one with no record as no sessions", () => {
    const { epochDir } = campaign();
    expect(readExecutionEvidence(join(epochDir, "absent"))).toEqual([]);
    expect(readExecutionEvidence(epochDir)).toEqual([]);
  });

  it("does not overwrite an orphaned sidecar left before its execution record", () => {
    const { epochDir } = campaign();
    writeFileSync(join(epochDir, "builder-prose.jsonl"), "interrupted-sidecar\n");
    writeSession(epochDir, spoken("later session"));
    expect(readFileSync(join(epochDir, "builder-prose.jsonl"), "utf8")).toBe("interrupted-sidecar\n");
    expect(existsSync(join(epochDir, "builder-execution-02.json"))).toBe(true);
    expect(existsSync(join(epochDir, "builder-prose-02.jsonl"))).toBe(true);
  });
});

describe("the prose sidecar", () => {
  it("records reasoning and message rows beside the execution record, out of the JSON", () => {
    const { epochDir } = campaign();
    const recorder = new BuilderExecutionRecorder();
    recorder.reasoning("The accept controls fail on the temp root; try the workspace instead.");
    recorder.message("Moved the checker under .toolchain.");
    recorder.message("Resubmitted after the workspace check.");
    const turn = (assistantText: string) =>
      recorder.turnCompleted(double<AgentTurnResult>({ status: "completed", assistantText }));
    turn("the completed-message fallback must not duplicate this turn");
    recorder.reasoning("x".repeat(CAP + 10));
    // A cut that lands on the blank line between two paragraphs ends the row at the first one.
    recorder.reasoning(`${"y".repeat(CAP - 1)}\n\n${"z".repeat(100)}`);
    // A transport with no completed-message event has its returned text retained once.
    turn("A transport with no message event still has a final message.");
    writeSession(epochDir, recorder.finish("in-flight"));

    const executionPath = join(epochDir, FIRST);
    const record = JSON.parse(readFileSync(executionPath, "utf8"));
    expect(record.prose).toBeUndefined();
    expect(record.proseOmitted).toBe(0);
    const [header, ...rows] = jsonLines(proseSidecarPath(executionPath));
    expect(record.proseCapture).toEqual({
      schema: "builder-prose-capture/v1",
      captureId: header.captureId,
      file: "builder-prose.jsonl",
      rows: 6,
      omitted: 0,
    });
    expect(header).toEqual({ ...record.proseCapture, executionFile: FIRST });
    expect(rows.map((row) => [row.sequence, row.turn, row.kind, row.truncated])).toEqual([
      [1, 1, "reasoning", false],
      [2, 1, "message", false],
      [3, 1, "message", false],
      [4, 2, "reasoning", true],
      [5, 2, "reasoning", true],
      [6, 2, "message", false],
    ]);
    expect([rows[3].chars, rows[3].text.length]).toEqual([CAP + 10, CAP]);
    expect([rows[4].chars, rows[4].text]).toEqual([CAP + 101, "y".repeat(CAP - 1)]);
    expect(rows[5].text).toBe("A transport with no message event still has a final message.");
    expect(rows[0].schema).toBe("builder-prose/v2");
  });

  it("pairs each CLI summary with its compaction in order, and keeps a long one whole", () => {
    const record = new PiPromptRecord(
      () => {},
      () => [],
    );
    record.cliCompaction(200_000);
    record.cliCompaction(210_000);
    const long = `Summary: ${"s".repeat(CAP * 3)}`;
    record.cliCompactionSummary("first");
    record.cliCompactionSummary(long);
    record.cliCompactionSummary("no compaction left to own this");
    expect(record.compactions.map((compaction) => compaction.summary)).toEqual(["first", long]);

    const { epochDir } = campaign();
    const recorder = new BuilderExecutionRecorder();
    recorder.turnCompleted(double<AgentTurnResult>({ status: "completed", compactions: record.compactions }));
    writeSession(epochDir, recorder.finish("in-flight"));
    const rows = jsonLines(proseSidecarPath(join(epochDir, FIRST))).slice(1);
    expect(rows.map((row) => [row.kind, row.truncated])).toEqual([
      ["compaction", false],
      ["compaction", false],
    ]);
    expect(rows[1].text).toBe(`tokensBefore=210000 compacted=true\n\n${long}`);
  });

  it("surfaces thinking separately and joins one completed message's text blocks by line", () => {
    const events: AgentTurnEvent[] = [];
    const record = new PiPromptRecord(
      (event) => events.push(event),
      () => [],
    );
    record.observe(
      double<Parameters<PiPromptRecord["observe"]>[0]>({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "weigh the two forms" },
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: "reasoning_text", text: "weigh the two forms" },
      { type: "message_text", text: "first\nsecond" },
    ]);
  });

  it("censuses sessions in recorded epoch order, past two digits", () => {
    const root = scratchDir("ana-prose-campaign-");
    // Epoch keys are hashes of their binding, so the recorded order is not the sorted one.
    const first = selectCampaignEpoch(root, { kickoff: "one line b" });
    const second = selectCampaignEpoch(root, { kickoff: "one line a" });
    expect(second.key < first.key).toBe(true);
    for (const epoch of [first, second]) writeSession(epoch.dir, spoken(epoch.key));
    writeFileSync(join(second.dir, "builder-execution-100.json"), "{}");
    const sessions = publicCensus(censusProse(root)).captures.map(
      (row: { epoch: string; session: number }) => [row.epoch, row.session],
    );
    expect(sessions.slice(0, 2)).toEqual([
      [first.key, 1],
      [second.key, 1],
    ]);
    expect(sessions.at(-1)).toEqual([second.key, 100]);
  });

  it("binds each sidecar to its record, and refuses a mismatched or missing capture receipt", () => {
    const root = scratchDir("ana-prose-campaign-");
    const { key, dir: epochDir } = selectCampaignEpoch(root, { kickoff: "one line" });
    writeSession(epochDir, spoken("first session"));
    writeSession(epochDir, spoken("second session"));
    const census = publicCensus(censusProse(root));
    expect(census.ok).toBe(true);
    expect(
      census.captures.map((row: { epoch: string; session: number; state: string }) => [
        row.epoch,
        row.session,
        row.state,
      ]),
    ).toEqual([
      [key, 1, "bound"],
      [key, 2, "bound"],
    ]);

    const executionPath = join(epochDir, "builder-execution-02.json");
    const execution = JSON.parse(readFileSync(executionPath, "utf8"));
    execution.proseCapture.rows += 1;
    writeFileSync(executionPath, JSON.stringify(execution));
    const refused = publicCensus(censusProse(root));
    expect(refused.ok).toBe(false);
    expect(refused.captures[1].state).toBe("receipt-mismatch");
    expect(refused.issues).toContain(
      "builder-execution-02.json and builder-prose-02.jsonl: capture receipts disagree",
    );

    delete execution.proseCapture;
    writeFileSync(executionPath, JSON.stringify(execution));
    const prosePath = join(epochDir, "builder-prose-02.jsonl");
    writeFileSync(prosePath, readFileSync(prosePath, "utf8").split("\n").slice(1).join("\n"));
    const unbound = publicCensus(censusProse(root));
    expect(unbound.captures[1].state).toBe("receipt-mismatch");
    expect(unbound.issues).toContain(
      "builder-execution-02.json and builder-prose-02.jsonl: a capture receipt is missing",
    );
  });
});

describe("the latest closed invocation", () => {
  // An undeterminable time is never dead: a damaged opening or terminal blocks rather than being
  // recorded over, and a campaign with no controller evidence has no invocation to be after.
  it.each([
    [
      "an invocation newer than every terminal is still open",
      null,
      (root: string) => {
        terminal(root, "run-1", "2026-08-25T01:00:00.000Z");
        opening(root, "run-2", "2026-08-25T02:00:00.000Z");
      },
    ],
    [
      "an open opening's write time cannot be read",
      null,
      (root: string) => {
        terminal(root, "run-1", "2026-08-25T01:00:00.000Z");
        opening(root, "run-2");
      },
    ],
    [
      "a terminal cannot prove when it recorded",
      null,
      (root: string) => terminal(root, "run-1", "not-a-timestamp"),
    ],
    ["the campaign has no controller evidence", null, () => {}],
    [
      "a dead orphan opening is older than the newest terminal",
      "run-1",
      (root: string) => {
        opening(root, "run-0", "2026-08-25T00:30:00.000Z");
        terminal(root, "run-1", "2026-08-25T01:00:00.000Z");
      },
    ],
    [
      "every invocation has closed",
      "run-2",
      (root: string) => {
        terminal(root, "run-1", "2026-08-25T01:00:00.000Z");
        terminal(root, "run-2", "2026-08-25T03:00:00.000Z");
      },
    ],
    // 03:00 at +02:00 is 01:00Z: chronologically older but lexicographically newer, for a terminal
    // and for an orphan opening alike.
    [
      "timestamps order by instant rather than spelling",
      "latest",
      (root: string) => {
        terminal(root, "latest", "2026-08-25T01:30:00.000Z");
        terminal(root, "older-offset", "2026-08-25T03:00:00+02:00");
        opening(root, "older-open", "2026-08-25T03:00:00+02:00");
      },
    ],
  ] as const)("when %s, is %p", (_, runId, setup) => {
    const { root } = campaign();
    setup(root);
    const closed = latestClosedInvocation(root);
    expect(closed?.runId ?? null).toBe(runId);
    if (closed !== null) expect(Number.isFinite(Date.parse(closed.closedAt))).toBe(true);
  });
});

describe("closing what the controller left open", () => {
  it("closes every in-flight session record of every epoch, and leaves settled and root-level records alone", () => {
    const { root, epochDir } = campaign();
    const write = (dir: string, name: string, outcome: BuilderExecutionEvidence["outcome"]) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(executionRecord({ outcome })));
      return path;
    };
    const first = write(epochDir, FIRST, "in-flight");
    const second = write(epochDir, "builder-execution-02.json", "in-flight");
    const settled = write(epochDir, "builder-execution-03.json", "turn-bound");
    // Records live in epochs; one at the campaign root is not a session record.
    const stray = write(root, FIRST, "in-flight");
    const settledBytes = readFileSync(settled, "utf8");
    const invocation = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };

    const closed = closeOpenBuilderExecutionRecords(root, invocation);
    expect([...closed].sort()).toEqual([first, second].sort());
    for (const path of [first, second]) {
      expect(read(path)).toMatchObject({ outcome: "recorded-at-terminal", closure: invocation });
    }
    // A session's own settled outcome is never overwritten.
    expect(readFileSync(settled, "utf8")).toBe(settledBytes);
    expect(read(stray).outcome).toBe("in-flight");
  });
});

describe("a write that lands after its invocation recorded", () => {
  it.each([false, true])(
    "keeps its own closure whether or not a successor has closed (%p)",
    (successorClosed) => {
      const { root, epochDir } = campaign();
      opening(root, "run-1", "2026-08-25T00:00:00.000Z");
      const writeA = builderExecutionEvidenceWriter(epochDir);
      const pathA = join(epochDir, FIRST);
      writeA(executionRecord({ outcome: "in-flight" }));
      const invocationA = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };
      terminal(root, invocationA.runId, invocationA.closedAt);
      closeOpenBuilderExecutionRecords(root, invocationA);
      opening(root, "run-2", "2026-08-25T03:00:00.000Z");
      const pathB = join(epochDir, "builder-execution-02.json");
      builderExecutionEvidenceWriter(epochDir)(executionRecord({ outcome: "in-flight" }));
      const invocationB = { runId: "run-2", closedAt: "2026-08-25T04:00:00.000Z" };
      if (successorClosed) {
        terminal(root, invocationB.runId, invocationB.closedAt);
        closeOpenBuilderExecutionRecords(root, invocationB);
      }

      // A late checkpoint cannot reopen A, and keeps A's own invocation rather than B's.
      const late = executionRecord({ outcome: "in-flight", turns: 2 });
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
      // A settled outcome has no closure field, and its retained witness still belongs to A.
      writeA(executionRecord({ outcome: "recorded" }));
      expect(read(pathA)).toMatchObject({ outcome: "recorded", postTerminal: invocationA });
      expect(read(pathA).closure).toBeUndefined();
    },
  );

  it.each([
    ["is kept and named after its invocation recorded", true],
    ["is left unmarked while its invocation is open", false],
  ])("a session's first write %s", (_, recorded) => {
    const { root, epochDir } = campaign();
    const invocation = { runId: "run-1", closedAt: "2026-08-25T02:00:00.000Z" };
    if (recorded) terminal(root, invocation.runId, invocation.closedAt);
    else opening(root, invocation.runId);
    writeSession(epochDir, executionRecord());
    expect(postTerminalInvocation(epochDir)).toEqual(recorded ? invocation : null);
    expect(read(join(epochDir, FIRST))).toMatchObject({ outcome: "recorded" });
    expect(read(join(epochDir, FIRST)).postTerminal).toEqual(recorded ? invocation : undefined);
  });
});

describe("what the reader derives", () => {
  it("derives candidate counts from the rows, not a counter beside them, and keeps the controller's stop out", () => {
    const { epochDir } = campaign();
    const refused = {
      outcome: "refused" as const,
      stage: "validation" as const,
      findingsDigest: "d",
      findingCodes: ["missing-check"],
    };
    const submits = [
      submitRow(1, {
        ...refused,
        stage: "gates",
        kind: "controller-terminal",
        commit: "budget-limited",
        repeatedFindings: null,
        findingsDelta: null,
        workspaceChanged: null,
        terminal: true,
      }),
      submitRow(2, { ...refused, commit: "commit-2" }),
      submitRow(3, {
        ...refused,
        commit: "commit-2",
        repeatedFindings: true,
        treeFirstSubmittedAsAttempt: 2,
      }),
      submitRow(4, { ...refused, commit: "commit-4", workspaceChanged: false }),
    ];
    writeFileSync(
      join(epochDir, FIRST),
      JSON.stringify({ ...executionRecord({ submits }), repeatedFindingSubmits: 0 }),
    );
    const details = readExecutionEvidenceDetails(epochDir);
    expect(details.unavailable).toEqual([]);
    expect(submitProjection(details.records[0]?.submits ?? [])).toMatchObject({
      submitCounts: { raw: 4, candidates: 3, controllerTerminals: 1 },
      // The stop has the earliest instant; it does not become the first candidate submit.
      firstSubmitMs: 2000,
      repeatedFindingSubmits: 1,
      unchangedTreeSubmits: 1,
      uniqueCandidateTrees: 2,
    });
  });

  it("reads a closing record's two invocations", () => {
    const { epochDir } = campaign();
    const closure = { runId: "run-7", closedAt: "2026-09-01T11:00:00.000Z" };
    const postTerminal = { runId: "run-8", closedAt: "2026-09-01T12:00:00.000Z" };
    writeFileSync(
      join(epochDir, FIRST),
      JSON.stringify({ ...executionRecord({ outcome: "recorded-at-terminal" }), closure, postTerminal }),
    );
    expect(readExecutionEvidence(epochDir)[0]).toMatchObject({ closure, postTerminal });
  });

  const withoutKind = Object.fromEntries(Object.entries(submitRow(1)).filter(([field]) => field !== "kind"));
  it.each([
    [
      "an unknown schema, keeping the sessions after it",
      {
        [FIRST]: executionRecord({ turns: 1 }),
        "builder-execution-02.json": { schema: "builder-execution/v2" },
        "builder-execution-03.json": executionRecord({ turns: 3 }),
      },
      [1, 3],
      [
        "builder-execution-02.json",
        ': malformed execution record with unknown schema "builder-execution/v2"',
      ],
    ],
    [
      "a submit row that does not say which kind it is",
      { [FIRST]: { ...executionRecord(), submits: [withoutKind] } },
      [],
      [FIRST, ": builder-execution/v6 record has an incomplete or invalid shape"],
    ],
    [
      "a missing middle session, still reading the sessions past it",
      {
        [FIRST]: executionRecord({ turns: 1 }),
        "builder-execution-04.json": executionRecord({ turns: 4 }),
      },
      [1, 4],
      [
        "builder-execution-02.json",
        ": execution evidence gap at session 2 through 3; later numbered records are present",
      ],
    ],
    [
      "a second file for one session",
      {
        [FIRST]: executionRecord({ turns: 1 }),
        "builder-execution-02.json": executionRecord({ turns: 2 }),
        "builder-execution-2.json": executionRecord({ turns: 22 }),
      },
      [1, 2],
      [
        "builder-execution-2.json",
        ": duplicate execution evidence for session 2; <dir>/builder-execution-02.json is the selected record",
      ],
    ],
    [
      "a filename whose session number is not a positive integer",
      { "builder-execution-0.json": executionRecord() },
      [],
      [
        "builder-execution-0.json",
        ": malformed execution record filename; session number must be a positive integer",
      ],
    ],
  ] as const)("names %s", (_, files, sessions, [file, reason]) => {
    const { epochDir } = campaign();
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(epochDir, name), JSON.stringify(body));
    }
    const details = readExecutionEvidenceDetails(epochDir);
    expect(details.sessions).toEqual([...sessions]);
    expect(details.unavailable).toEqual([`${join(epochDir, file)}${reason.replace("<dir>", epochDir)}`]);
  });

  it("reports malformed JSON with the parse error, not as a missing session", () => {
    const { epochDir } = campaign();
    writeFileSync(join(epochDir, FIRST), "{ not json");
    const details = readExecutionEvidenceDetails(epochDir);
    expect(details.records).toEqual([]);
    expect(details.unavailable[0]).toContain(`${join(epochDir, FIRST)}: malformed JSON (`);
  });

  // The checkpoint's totals are real, so the rows stay; what the report must not lose is that the
  // session never ended. Before the terminal, the same record reads clean.
  it("names an in-flight checkpoint once the campaign has closed, and still returns it", () => {
    const { root, epochDir } = campaign();
    writeFileSync(join(epochDir, FIRST), JSON.stringify(executionRecord({ outcome: "in-flight" })));
    expect(readExecutionEvidenceDetails(epochDir).unavailable).toEqual([]);
    terminal(root, "run-9", "2026-09-01T13:00:00.000Z");
    const details = readExecutionEvidenceDetails(epochDir);
    expect(details.records.map((session) => session.outcome)).toEqual(["in-flight"]);
    expect(details.unavailable).toEqual([
      `${join(epochDir, FIRST)}: session 1 still reads in-flight after controller run run-9 recorded its terminal at 2026-09-01T13:00:00.000Z`,
    ]);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { writeBuilderExecutionEvidence } from "../src/author/builder-execution-writer.ts";
import { MAX_PROSE_CHARS, proseSidecarPath } from "../src/author/builder-prose.ts";
import { PiPromptRecord } from "../src/backends/pi-session.ts";
import type { AgentTurnEvent, AgentTurnResult } from "../src/backends/backend-types.ts";
import {
  censusProse,
  publicCensus,
} from "../.claude/skills/whole-run-investigation/classifier/prose-input.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function turnResult(assistantText: string): AgentTurnResult {
  return double<AgentTurnResult>({ status: "completed", assistantText });
}

describe("builder prose log", () => {
  it("records reasoning and message rows beside the execution record, out of the JSON", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-prose-"));
    dirs.push(epochDir);
    const recorder = new BuilderExecutionRecorder();
    recorder.reasoning("The accept controls fail on the temp root; try the workspace instead.");
    recorder.message("Moved the checker under .toolchain.");
    recorder.message("Resubmitted after the workspace check.");
    recorder.turnCompleted(turnResult("the completed-message fallback must not duplicate this turn"));
    recorder.reasoning("x".repeat(MAX_PROSE_CHARS + 10));
    // OpenRouter has no completed-message event, so the returned text is retained once.
    recorder.turnCompleted(turnResult("A transport with no message event still has a final message."));
    writeBuilderExecutionEvidence(epochDir, recorder.finish("in-flight"));

    const executionPath = join(epochDir, "builder-execution.json");
    const record = JSON.parse(readFileSync(executionPath, "utf8"));
    expect(record.prose).toBeUndefined();
    expect(record.proseOmitted).toBe(0);

    const [header, ...rows] = readFileSync(proseSidecarPath(executionPath), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(record.proseCapture).toEqual({
      schema: "builder-prose-capture/v1",
      captureId: header.captureId,
      file: "builder-prose.jsonl",
      rows: 5,
      omitted: 0,
    });
    expect(header).toEqual({
      ...record.proseCapture,
      executionFile: "builder-execution.json",
    });
    expect(rows.map((row) => [row.sequence, row.turn, row.kind, row.truncated])).toEqual([
      [1, 1, "reasoning", false],
      [2, 1, "message", false],
      [3, 1, "message", false],
      [4, 2, "reasoning", true],
      [5, 2, "message", false],
    ]);
    expect(rows[3].chars).toBe(MAX_PROSE_CHARS + 10);
    expect(rows[3].text.length).toBe(MAX_PROSE_CHARS);
    expect(rows[4].text).toBe("A transport with no message event still has a final message.");
    expect(rows[0].schema).toBe("builder-prose/v2");
  });

  it("pairs each CLI summary with its compaction in order, and keeps a long one whole", () => {
    const record = new PiPromptRecord(
      () => {},
      () => [],
    );
    record.cliCompaction(200_000);
    record.cliCompaction(210_000);
    const long = `Summary: ${"s".repeat(MAX_PROSE_CHARS * 3)}`;
    record.cliCompactionSummary("first");
    record.cliCompactionSummary(long);
    record.cliCompactionSummary("no compaction left to own this");
    expect(record.compactions.map((compaction) => compaction.summary)).toEqual(["first", long]);

    const epochDir = mkdtempSync(join(tmpdir(), "ana-prose-"));
    dirs.push(epochDir);
    const recorder = new BuilderExecutionRecorder();
    recorder.turnCompleted(double<AgentTurnResult>({ status: "completed", compactions: record.compactions }));
    writeBuilderExecutionEvidence(epochDir, recorder.finish("in-flight"));
    const rows = readFileSync(proseSidecarPath(join(epochDir, "builder-execution.json")), "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => [row.kind, row.truncated])).toEqual([
      ["compaction", false],
      ["compaction", false],
    ]);
    expect(rows[1].text).toBe(`tokensBefore=210000 compacted=true\n\n${long}`);
  });

  it("numbers a second session's sidecar with its execution record", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-prose-"));
    dirs.push(epochDir);
    for (const text of ["first session", "second session"]) {
      const recorder = new BuilderExecutionRecorder();
      recorder.turnCompleted(turnResult(text));
      writeBuilderExecutionEvidence(epochDir, recorder.finish("recorded"));
    }
    expect(existsSync(join(epochDir, "builder-prose.jsonl"))).toBe(true);
    expect(readFileSync(join(epochDir, "builder-prose-02.jsonl"), "utf8")).toContain("second session");
  });

  it("keeps a three-digit session paired with its own sidecar", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-prose-"));
    dirs.push(epochDir);
    const executionPath = join(epochDir, "builder-execution-100.json");
    expect(proseSidecarPath(executionPath)).toBe(join(epochDir, "builder-prose-100.jsonl"));
  });

  it("does not overwrite an orphaned sidecar left before its execution record", () => {
    const epochDir = mkdtempSync(join(tmpdir(), "ana-prose-"));
    dirs.push(epochDir);
    writeFileSync(join(epochDir, "builder-prose.jsonl"), "interrupted-sidecar\n");
    const recorder = new BuilderExecutionRecorder();
    recorder.turnCompleted(turnResult("later session"));
    writeBuilderExecutionEvidence(epochDir, recorder.finish("recorded"));
    expect(readFileSync(join(epochDir, "builder-prose.jsonl"), "utf8")).toBe("interrupted-sidecar\n");
    expect(existsSync(join(epochDir, "builder-execution-02.json"))).toBe(true);
    expect(existsSync(join(epochDir, "builder-prose-02.jsonl"))).toBe(true);
  });

  // The host session reads each completed assistant message once: its thinking reaches the prose
  // log as reasoning, and its text blocks as one message.
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

  it("walks epochs in their recorded order and reads a session numbered past two digits", () => {
    const campaignDir = mkdtempSync(join(tmpdir(), "ana-prose-campaign-"));
    dirs.push(campaignDir);
    // Epoch keys are hashes of their binding, so the recorded order is not the sorted one.
    const first = selectCampaignEpoch(campaignDir, { kickoff: "one line b" });
    const second = selectCampaignEpoch(campaignDir, { kickoff: "one line a" });
    expect(second.key < first.key).toBe(true);
    for (const epoch of [first, second]) {
      const recorder = new BuilderExecutionRecorder();
      recorder.turnCompleted(turnResult(epoch.key));
      writeBuilderExecutionEvidence(epoch.dir, recorder.finish("recorded"));
    }
    writeFileSync(join(second.dir, "builder-execution-100.json"), "{}");
    const census = publicCensus(censusProse(campaignDir));
    const sessions = census.captures.map((row: { epoch: string; session: number }) => [
      row.epoch,
      row.session,
    ]);
    expect(sessions.slice(0, 2)).toEqual([
      [first.key, 1],
      [second.key, 1],
    ]);
    expect(sessions.at(-1)).toEqual([second.key, 100]);
  });

  it("censuses campaign sessions in order and refuses a mismatched capture receipt", () => {
    const campaignDir = mkdtempSync(join(tmpdir(), "ana-prose-campaign-"));
    dirs.push(campaignDir);
    const { key, dir: epochDir } = selectCampaignEpoch(campaignDir, { kickoff: "one line" });
    for (const text of ["first session", "second session"]) {
      const recorder = new BuilderExecutionRecorder();
      recorder.turnCompleted(turnResult(text));
      writeBuilderExecutionEvidence(epochDir, recorder.finish("recorded"));
    }
    const census = publicCensus(censusProse(campaignDir));
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
    const refused = publicCensus(censusProse(campaignDir));
    expect(refused.ok).toBe(false);
    expect(refused.captures[1].state).toBe("receipt-mismatch");
    expect(refused.issues).toContain(
      "builder-execution-02.json and builder-prose-02.jsonl: capture receipts disagree",
    );

    // A session written before capture receipts carries neither receipt nor header: refused.
    delete execution.proseCapture;
    writeFileSync(executionPath, JSON.stringify(execution));
    const prosePath = join(epochDir, "builder-prose-02.jsonl");
    writeFileSync(prosePath, readFileSync(prosePath, "utf8").split("\n").slice(1).join("\n"));
    const unbound = publicCensus(censusProse(campaignDir));
    expect(unbound.captures[1].state).toBe("receipt-mismatch");
    expect(unbound.issues).toContain(
      "builder-execution-02.json and builder-prose-02.jsonl: a capture receipt is missing",
    );
  });
});

/**
 * The Builder transcript pointer (src/builder/session-transcript.ts) names the controller's event
 * transcript as the session opens, before the first turn has ended, and each round keeps its own
 * pointer on the session's record sequence. That is what lets a round be traced back to the events
 * it produced, so the pointer has to be written even when the session turns out to have no
 * transcript directory at all.
 *
 * The integrity check then reports a missing, empty, drifted or malformed transcript as four
 * separate states rather than asserting one exists, and a missing transcript is a warning rather
 * than a failed session. Reading them apart is the point: an empty file reported as drift would
 * name an undefined session, and a malformed one that threw would take the round with it. The
 * event writer's own buffering and digest are covered beside the steering tests in
 * test/authoring-steering.test.ts.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  type BuilderTranscriptPointerV2,
  BUILDER_TRANSCRIPT_POINTER_FILE,
  SessionTranscriptSink,
  verifyWrittenTranscript,
} from "../src/builder/session-transcript.ts";

const SESSION = "pi-3fcc81e0-a7bf-4216-adfb-f3cb79446b00";
const EVENTS = `builder-events-${SESSION}.jsonl`;

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function pointerAt(path: string): BuilderTranscriptPointerV2 {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("the Builder transcript pointer", () => {
  // A session killed while authoring never ends a turn, so a pointer written at the first turn's
  // end would leave nothing in the campaign naming its transcript.
  it("names the transcript as the session opens, before its first turn ends", () => {
    const dir = tmpDir("transcript-pointer-");
    const sink = new SessionTranscriptSink();
    sink.prompt(1, "Build a harness.");
    sink.open(SESSION, "claude", dir, "/tmp/ws/run65");
    const live = pointerAt(join(dir, BUILDER_TRANSCRIPT_POINTER_FILE));
    expect(live).toMatchObject({
      schema: "builder-transcript-pointer/v2",
      source: "controller-events",
      transport: "claude",
      sessionId: SESSION,
      cwd: "/tmp/ws/run65",
      path: join(dir, EVENTS),
      settledAt: null,
    });
    expect(new Date(live.openedAt).toISOString()).toBe(live.openedAt);
    // The prompt recorded before the opening reaches the named file before the pointer digests it,
    // so a run killed mid-session still leaves a pointer that verifies.
    expect(readFileSync(live.path, "utf8")).toContain("Build a harness.");
    expect(live.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(live.warnings).toEqual([]);
    sink.turnCompleted(1, { status: "completed", assistantText: "worked" });
    sink.settle();
    const settled = pointerAt(join(dir, BUILDER_TRANSCRIPT_POINTER_FILE));
    expect(settled.settledAt).not.toBeNull();
    expect(settled.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(settled.warnings).toEqual([]);
  });

  // A Builder round runs for hours on one context; a compaction inside it must leave a record, or a
  // run cannot show whether the framing survived it.
  it("records each compaction of a turn before its result", () => {
    const dir = tmpDir("transcript-compaction-");
    const sink = new SessionTranscriptSink();
    sink.open(SESSION, "codex", dir, "/tmp/ws");
    sink.turnCompleted(1, {
      status: "aborted",
      compactions: [
        { tokensBefore: 290_000, compacted: true },
        { tokensBefore: 120_000, compacted: false },
      ],
    });
    const records = readFileSync(join(dir, EVENTS), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map(({ kind, tokensBefore, compacted }) => ({ kind, tokensBefore, compacted }))).toEqual([
      { kind: "compaction", tokensBefore: 290_000, compacted: true },
      { kind: "compaction", tokensBefore: 120_000, compacted: false },
      { kind: "turn_result", tokensBefore: undefined, compacted: undefined },
    ]);
  });

  // A continued session serves several rounds, and an epoch may open several sessions; each pointer
  // is one round's only durable link to its transcript, so a later round claims the next free
  // numbered name instead of overwriting the first, and the session's records keep counting.
  it("keeps one pointer per round and continues the session's record sequence", () => {
    const dir = tmpDir("transcript-pointer-multi-");
    const first = new SessionTranscriptSink();
    first.prompt(1, "round one");
    first.open(SESSION, "claude", dir, "/tmp/ws/one");
    first.settle();
    const opening = readFileSync(join(dir, BUILDER_TRANSCRIPT_POINTER_FILE), "utf8");
    const second = new SessionTranscriptSink();
    second.prompt(1, "round two");
    second.open(SESSION, "claude", dir, "/tmp/ws/one");
    second.settle();
    expect(readFileSync(join(dir, BUILDER_TRANSCRIPT_POINTER_FILE), "utf8")).toBe(opening);
    expect(pointerAt(join(dir, "builder-transcript-02.json"))).toMatchObject({
      sessionId: SESSION,
      warnings: [],
    });
    const records = readFileSync(join(dir, EVENTS), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map(({ seq, text }) => [seq, text])).toEqual([
      [1, "round one"],
      [2, "round two"],
    ]);
  });

  it("writes nothing, and holds nothing, when the session has no transcript directory", () => {
    const sink = new SessionTranscriptSink();
    sink.open(SESSION, "claude", undefined, "/tmp/ws/none");
    sink.prompt(1, "unrecorded");
    sink.settle();
    // The opening is spent: a later directory cannot reopen a round that recorded nothing.
    const dir = tmpDir("transcript-pointer-late-");
    sink.open(SESSION, "claude", dir, "/tmp/ws/none");
    expect(existsSync(join(dir, BUILDER_TRANSCRIPT_POINTER_FILE))).toBe(false);
  });
});

describe("the written-transcript check", () => {
  it("reports no warning while the first and last records name the session", () => {
    const path = join(tmpDir("transcript-scratch-"), "live.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({ sessionId: SESSION })}\n${JSON.stringify({ sessionId: SESSION })}\n`,
    );
    expect(verifyWrittenTranscript(path, SESSION)).toEqual([]);
  });

  it("names an empty transcript instead of reporting it as drift to an undefined session", () => {
    const path = join(tmpDir("transcript-scratch-"), "empty.jsonl");
    writeFileSync(path, "");
    expect(verifyWrittenTranscript(path, SESSION)[0]).toMatch(/^transcript empty — .*bytes=0$/);
  });

  it("records a missing transcript as a warning rather than failing the session", () => {
    const warnings = verifyWrittenTranscript(join(tmpDir("transcript-scratch-"), "absent.jsonl"), SESSION);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^transcript missing —/);
  });

  it("reports session-id drift between the first and last record", () => {
    const path = join(tmpDir("transcript-scratch-"), "drift.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({ sessionId: SESSION })}\n${JSON.stringify({ sessionId: "other" })}\n`,
    );
    expect(verifyWrittenTranscript(path, SESSION)).toEqual([
      `sessionId drift — expected=${SESSION} first=${SESSION} last=other`,
    ]);
  });

  it("reports a malformed transcript instead of throwing", () => {
    const path = join(tmpDir("transcript-scratch-"), "broken.jsonl");
    writeFileSync(path, "{not json}\n");
    expect(verifyWrittenTranscript(path, SESSION)[0]).toMatch(/^malformed JSONL —/);
  });
});

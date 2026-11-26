import { afterAll, describe, expect, it } from "bun:test";
import { CLAUDE_SESSIONS_DIR } from "../src/agent/backends/claude-transcript.ts";
import { applyContinuation } from "../src/agent/session.ts";
import type { EventKind } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { seatForkPlan } from "../tools/campaign/seat-fork.ts";
import { modelNamed } from "../tools/m0/stored-sweep.ts";
import { SEED_FILE } from "../tools/runs/registry.ts";

const root = mkdtempSync(join(tmpdir(), "ana-seat-fork-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const claudeModel = modelNamed("claude/claude-haiku-4-5");
const codexModel = modelNamed("openai-codex/gpt-6-luna");
const SID = "12345678-1234-1234-1234-1234567890ab";

function line(kind: EventKind, data: JsonObject): string {
  return JSON.stringify({ at: "2026-11-26T00:00:00.000Z", kind, data });
}

function makeSeed(name: string, originEvents: readonly string[], withTranscript: "yes" | "no") {
  const origin = join(root, `${name}-origin`);
  const seed = join(root, name);
  mkdirSync(origin, { recursive: true });
  mkdirSync(seed, { recursive: true });
  writeFileSync(join(origin, "log.jsonl"), originEvents.length === 0 ? "" : `${originEvents.join("\n")}\n`);
  writeFileSync(join(seed, "log.jsonl"), "");
  writeFileSync(join(seed, SEED_FILE), JSON.stringify({ from: origin, events: 0, of: originEvents.length }));
  if (withTranscript === "yes") {
    mkdirSync(join(origin, CLAUDE_SESSIONS_DIR), { recursive: true });
    writeFileSync(
      join(origin, CLAUDE_SESSIONS_DIR, "x-1.jsonl"),
      `${JSON.stringify({ type: "user", uuid: "u0", sessionId: SID, message: { role: "user", content: "Hi" } })}\n`,
    );
  }
  return { origin, seed, log: join(seed, "log.jsonl") };
}

describe("seatForkPlan and applyContinuation", () => {
  it("refuses fork, wrap, and nudge flags outside a sim-* seed", () => {
    const live = join(root, "real-run");
    mkdirSync(live, { recursive: true });
    const log = join(live, "log.jsonl");
    writeFileSync(log, "");
    expect(seatForkPlan(log, "exam", claudeModel, {})).toEqual({});
    expect(() => seatForkPlan(log, "exam", claudeModel, { nudge: "try harder" })).toThrow("simulation seed");
    expect(() => seatForkPlan(log, "exam", claudeModel, { "wrap-turns": "x-1:1" })).toThrow(
      "simulation seed",
    );
    expect(() => seatForkPlan(log, "exam", claudeModel, { "fork-from": "x-1" })).toThrow("simulation seed");
  });

  it("enforces mutual exclusions, non-Claude refusal, and fail-closed missing-transcript refusal", () => {
    const { log } = makeSeed("sim-guards", [], "no");
    expect(() =>
      seatForkPlan(log, "exam", claudeModel, { "fork-from": "x-1", "wrap-turns": "x-1:1" }),
    ).toThrow("not both");
    expect(() => seatForkPlan(log, "exam", claudeModel, { "at-turn": "2" })).toThrow("requires --fork-from");
    expect(() => seatForkPlan(log, "exam", claudeModel, { nudge: "   " })).toThrow("non-empty text");
    expect(() => seatForkPlan(log, "exam", codexModel, { "fork-from": "x-1" })).toThrow("Claude backend");
    expect(() => seatForkPlan(log, "exam", claudeModel, { "fork-from": "x-1" })).toThrow("--wrap-turns");
    const unsafeSegments = ["../bad", "..", ".", "a/b"];
    const badInputs: readonly [Parameters<typeof seatForkPlan>[3], string][] = [
      ...unsafeSegments.map((seg): [Parameters<typeof seatForkPlan>[3], string] => [
        { "fork-from": seg },
        "name a session id",
      ]),
      ...unsafeSegments.map((seg): [Parameters<typeof seatForkPlan>[3], string] => [
        { "wrap-turns": `${seg}:1` },
        "invalid session id",
      ]),
      [{ "fork-from": "x-1", "at-turn": "0" }, "positive integer"],
      [{ "fork-from": "x-1", "at-turn": "-1" }, "positive integer"],
      [{ "fork-from": "x-1", "at-turn": "1.5" }, "positive integer"],
      [{ "fork-from": "x-1", "at-turn": "abc" }, "positive integer"],
      [{ "wrap-turns": "x-2" }, "expected <session>:<turn>"],
      [{ "wrap-turns": ":1" }, "expected <session>:<turn>"],
      [{ "wrap-turns": "x-2:" }, "expected <session>:<turn>"],
    ];
    for (const [flags, message] of badInputs) {
      expect(() => seatForkPlan(log, "exam", claudeModel, flags)).toThrow(message);
    }
    expect(seatForkPlan(log, "exam", claudeModel, { nudge: "  Try again.  " })).toEqual({
      continuation: { mode: "nudge", text: "Try again." },
    });
  });

  it("resolves native SDK forks from origin claude-sessions and caps conversational children at their own last turn", () => {
    const { origin, log } = makeSeed(
      "sim-native",
      [
        line("exam.started", { session: "x-1" }),
        line("exam.turn", { session: "x-1", turn: 1, text: "t1" }),
        line("exam.turn", { session: "x-1", turn: 2, text: "t2" }),
        line("exam.finished", { session: "x-1", ended: "supplied" }),
        line("exam.started", { session: "x-2", conversation: "x-1" }),
        line("exam.turn", { session: "x-2", turn: 3, text: "t3" }),
      ],
      "yes",
    );
    const transcriptFile = join(origin, CLAUDE_SESSIONS_DIR, "x-1.jsonl");
    const forX1 = seatForkPlan(log, "exam", claudeModel, { "fork-from": "x-1" });
    expect(forX1.fork).toEqual({
      transcript: transcriptFile,
      upToTurn: 2,
    });
    expect(forX1.continuation).toEqual({ mode: "fork", text: "Continue from where you left off." });

    const directPath = seatForkPlan(log, "exam", claudeModel, {
      "fork-from": transcriptFile,
      "at-turn": "1",
    });
    expect(directPath.fork).toEqual({ transcript: transcriptFile, upToTurn: 1 });

    const unshared = makeSeed(
      "sim-unshared",
      [line("exam.started", { session: "x-1" }), line("exam.turn", { session: "x-1", turn: 1, text: "t1" })],
      "yes",
    );
    expect(seatForkPlan(unshared.log, "exam", claudeModel, { "fork-from": "x-1" }).fork).toEqual({
      transcript: join(unshared.origin, CLAUDE_SESSIONS_DIR, "x-1.jsonl"),
    });

    const forX2 = seatForkPlan(log, "exam", claudeModel, {
      "fork-from": "x-2",
      "at-turn": "1",
      nudge: "Focus on edge cases.",
    });
    expect(forX2.fork).toEqual({
      transcript: transcriptFile,
      upToTurn: 3,
    });
    expect(forX2.continuation).toEqual({ mode: "fork", text: "Focus on edge cases." });
    expect(() => seatForkPlan(log, "exam", claudeModel, { "fork-from": "x-2", "at-turn": "2" })).toThrow(
      "recorded 1 exam turns",
    );
  });

  it("reconstructs exact turn-bounded wrapped context from log.jsonl and refuses counts past recorded turns", () => {
    const { log } = makeSeed(
      "sim-wrap",
      [
        line("exam.started", { session: "x-2" }),
        line("exam.turn", { session: "x-2", turn: 19, text: "Planning first draft." }),
        line("exam.call", {
          session: "x-2",
          turn: 19,
          tool: "bash",
          args: { command: "ls" },
          isError: false,
          text: "gen.py",
        }),
        line("exam.turn", { session: "x-2", turn: 20, text: "Drafting task 2." }),
        line("exam.turn", { session: "x-2", turn: 21, text: "Should not appear." }),
      ],
      "no",
    );
    const wrapped = seatForkPlan(log, "exam", claudeModel, {
      "wrap-turns": "x-2:2",
      nudge: "Now try non-uniform bounds.",
    });
    expect(wrapped.fork).toBeUndefined();
    expect(wrapped.continuation?.mode).toBe("wrap");
    expect(wrapped.continuation?.text).toContain("SIMULATION WRAPPED PRIOR CONTEXT");
    expect(wrapped.continuation?.text).toContain("Planning first draft.");
    expect(wrapped.continuation?.text).toContain("[call bash (ok)]");
    expect(wrapped.continuation?.text).toContain("Drafting task 2.");
    expect(wrapped.continuation?.text).not.toContain("Should not appear.");
    expect(wrapped.continuation?.text).toContain("Now try non-uniform bounds.");

    expect(() => seatForkPlan(log, "exam", claudeModel, { "wrap-turns": "x-2:5" })).toThrow("fewer than 5");
  });

  it("applies fork, wrap, and nudge continuations cleanly to an opening message", () => {
    expect(applyContinuation("OPEN", undefined)).toBe("OPEN");
    expect(applyContinuation("OPEN", { mode: "fork", text: "NUDGE" })).toBe("NUDGE");
    expect(applyContinuation("OPEN", { mode: "wrap", text: "WRAPPED" })).toBe("OPEN\n\nWRAPPED");
    expect(applyContinuation("OPEN", { mode: "nudge", text: "EXTRA" })).toBe("OPEN\n\nEXTRA");
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import {
  resolveForkPoint,
  savePersistedTranscript,
  stageForkTranscript,
} from "../src/agent/backends/claude-transcript.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const root = mkdtempSync(join(tmpdir(), "ana-claude-transcript-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sid = "11111111-2222-3333-4444-555555555555";
const altSid = "99999999-8888-7777-6666-555555555555";
const row = (type: string, uuid: string, extra: JsonObject = {}) =>
  JSON.stringify({ type, uuid, sessionId: sid, ...extra });
const assistant = (uuid: string, id: string, content: JsonObject[], extra: JsonObject = {}) =>
  row("assistant", uuid, { message: { id, model: "claude-opus-5-5", content }, ...extra });

const transcript = `${[
  '"ignored-primitive"',
  JSON.stringify({ type: "system", uuid: "s0", sessionId: "not-a-uuid" }),
  row("user", "u0", { message: { role: "user", content: "Open." } }),
  assistant("a1-think", "msg_1", [{ type: "thinking", thinking: "hmm" }]),
  assistant("a1-tool", "msg_1", [
    { type: "tool_use", id: "tu_1", name: "bash" },
    { type: "text", id: "not-a-tool", text: "running" },
  ]),
  row("user", "u1-res", {
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
  }),
  row("attachment", "att-1"),
  row("progress", "prog-1"),
  row("assistant", "synth-1", {
    message: { id: "msg_synth", model: "<synthetic>", content: [{ type: "text", text: "x" }] },
  }),
  assistant("a2-text", "msg_2", [{ type: "text", text: "Done." }]),
  row("user", "u2-nudge", { message: { role: "user", content: "Old nudge." } }),
  row("attachment", "att-after-nudge"),
  assistant("a3-open", "msg_3", [{ type: "tool_use", id: "tu_orphan", name: "bash" }], { sessionId: altSid }),
  row("system", "sys-fake-result", {
    sessionId: altSid,
    message: { role: "system", content: [{ type: "tool_result", tool_use_id: "tu_orphan", content: "no" }] },
  }),
].join("\n")}\n`;

describe.concurrent("Claude transcript fork point resolution and staging", () => {
  it("resolves turn-k across multi-block turns, attachments, and torn final lines while refusing incomplete or out-of-range turns", () => {
    expect(resolveForkPoint(transcript, 1)).toEqual({
      sdkSessionId: sid,
      resumeSessionAt: "att-1",
      turnCount: 3,
    });
    expect(resolveForkPoint(`${transcript}{"truncated`, 2)).toEqual({
      sdkSessionId: sid,
      resumeSessionAt: "a2-text",
      turnCount: 3,
    });
    expect(() => resolveForkPoint(transcript, 3)).toThrow(
      "unanswered tool calls (tu_orphan); fork at turn 2 instead",
    );
    expect(() => resolveForkPoint(transcript, 4)).toThrow("holds 3 assistant turns");
    expect(() => resolveForkPoint(transcript, 0)).toThrow("positive integer");
    expect(() => resolveForkPoint('{"type":"user","uuid":"u0"}\n', 1)).toThrow("no valid sessionId UUID");
    expect(() => resolveForkPoint(`{"broken\n${transcript}`, 1)).toThrow(SyntaxError);
    const onlyOpen = `${row("user", "u0")}\n${assistant("a1-open", "msg_1", [{ type: "tool_use", id: "tu_1", name: "bash" }])}\n`;
    expect(() => resolveForkPoint(onlyOpen, 1)).toThrow("no earlier completed turn exists");
  });

  it("stages uuid and default-complete forks and saves only the reported session's transcript under safe names", () => {
    const dir = mkdtempSync(join(root, "stage-"));
    const file = join(dir, "src.jsonl");
    writeFileSync(file, transcript);
    const noTurns = join(dir, "no-turns.jsonl");
    writeFileSync(noTurns, `${row("user", "u0")}\n`);
    const onlyIncomplete = join(dir, "incomplete.jsonl");
    writeFileSync(
      onlyIncomplete,
      `${row("user", "u0")}\n${assistant("a1-open", "msg_1", [{ type: "tool_use", id: "tu_1", name: "bash" }])}\n`,
    );
    expect(stageForkTranscript(join(dir, "c1"), { transcript: file, upToUuid: "a2-text" })).toEqual({
      resume: sid,
      resumeSessionAt: "a2-text",
    });
    expect(stageForkTranscript(join(dir, "c2"), { transcript: file })).toEqual({
      resume: sid,
      resumeSessionAt: "a2-text",
    });
    expect(stageForkTranscript(join(dir, "c-empty"), { transcript: noTurns })).toEqual({ resume: sid });
    expect(() => stageForkTranscript(join(dir, "c-inc"), { transcript: onlyIncomplete })).toThrow(
      "no completed assistant turn",
    );
    expect(() =>
      stageForkTranscript(join(dir, "c3"), { transcript: file, upToTurn: 1, upToUuid: "a2-text" }),
    ).toThrow("not both");
    expect(() => stageForkTranscript(join(dir, "c4"), { transcript: file, upToUuid: "missing" })).toThrow(
      "not in",
    );
    expect(() => stageForkTranscript(join(dir, "c5"), { transcript: join(dir, "none.jsonl") })).toThrow(
      "not found",
    );
    expect(savePersistedTranscript(join(dir, "c1"), { dir: join(dir, "out"), seat: "../bad" }, sid)).toBe(
      false,
    );
    writeFileSync(join(dir, "c1", "projects", "escape.jsonl"), "secret\n");
    expect(
      savePersistedTranscript(join(dir, "c1"), { dir: join(dir, "out"), seat: "x-esc" }, "../escape"),
    ).toBe(false);
    expect(savePersistedTranscript(join(dir, "empty"), { dir: join(dir, "out"), seat: "x-1" }, sid)).toBe(
      false,
    );
    const otherSid = "22222222-2222-3333-4444-555555555555";
    expect(savePersistedTranscript(join(dir, "c1"), { dir: join(dir, "out"), seat: "x-1" }, otherSid)).toBe(
      false,
    );
    const out = join(dir, "saved");
    expect(savePersistedTranscript(join(dir, "c1"), { dir: out, seat: "x-1" }, sid)).toBe(true);
    expect(readFileSync(join(out, "x-1.jsonl"), "utf8")).toBe(transcript);
    expect(capturedJsonParse(readFileSync(join(out, "x-1.json"), "utf8"))).toEqual({
      seat: "x-1",
      sdkSessionId: sid,
    });
  });
});

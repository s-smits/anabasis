import { afterAll, describe, expect, it } from "bun:test";
import { CLAUDE_PROJECT_DIR, saveTranscript, stageFork } from "../src/agent/backends/claude-transcript.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const root = mkdtempSync(join(tmpdir(), "ana-claude-transcript-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sid = "11111111-2222-3333-4444-555555555555";
const row = (type: string, uuid: string, extra: JsonObject = {}) =>
  JSON.stringify({ type, uuid, sessionId: sid, ...extra });
const assistant = (uuid: string, id: string, content: JsonObject[], extra: JsonObject = {}) =>
  row("assistant", uuid, {
    message: { id, model: "claude-opus-5-5", content },
    ...extra,
  });
const done = (uuid: string, id: string) => assistant(uuid, id, [{ type: "text", text: "Done." }]);

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
  assistant("side-1", "msg_side", [{ type: "text", text: "side" }], { isSidechain: true }),
  row("assistant", "synth-1", {
    message: { id: "msg_synth", model: "<synthetic>", content: [{ type: "text", text: "x" }] },
  }),
  done("a2-text", "msg_2"),
  row("user", "u2-nudge", { message: { role: "user", content: "Old nudge." } }),
  row("attachment", "att-after-nudge"),
  assistant("a3-open", "msg_3", [{ type: "tool_use", id: "tu_orphan", name: "bash" }]),
  row("system", "sys-fake-result", {
    message: {
      role: "system",
      content: [{ type: "tool_result", tool_use_id: "tu_orphan", content: "no" }],
    },
  }),
].join("\n")}\n`;
const compacted = `${transcript}${row("system", "cb", { subtype: "compact_boundary" })}\n${row("user", "u4")}\n${done("a4", "msg_4")}\n`;

describe.concurrent("Claude transcript forks and saves", () => {
  it("forks at the last entry of a complete turn and refuses unanswered, absent and pre-compaction turns", () => {
    const cases: readonly [string, number, string][] = [
      [transcript, 1, "att-1"],
      [`${transcript}{"torn`, 2, "a2-text"],
      [transcript, 3, "unanswered tool calls (tu_orphan)"],
      [transcript, 4, "out of range: the transcript holds 3 turns"],
      [transcript, 0, "out of range"],
      [compacted, 2, "precedes the compaction after turn 3"],
      [compacted, 4, "a4"],
      [`${row("user", "u0")}\n`.replaceAll(sid, "no-uuid"), 1, "no valid sessionId UUID"],
      [`{"broken\n${transcript}`, 1, "JSON"],
    ];
    for (const [raw, atTurn, expected] of cases) {
      const dir = mkdtempSync(join(root, "stage-"));
      writeFileSync(join(dir, "src.jsonl"), raw);
      const stage = () =>
        stageFork(join(dir, "config"), {
          transcript: join(dir, "src.jsonl"),
          atTurn,
        });
      if (/^a[0-9]|^att/u.test(expected)) {
        expect(stage()).toEqual({ resume: sid, resumeSessionAt: expected });
        expect(
          readFileSync(join(dir, "config", "projects", CLAUDE_PROJECT_DIR, `${sid}.jsonl`), "utf8"),
        ).toBe(raw);
      } else expect(stage).toThrow(expected);
    }
  });

  it("saves only the named session's transcript, under a safe seat name", () => {
    const config = join(root, "save");
    mkdirSync(join(config, "projects", CLAUDE_PROJECT_DIR), {
      recursive: true,
    });
    writeFileSync(join(config, "projects", CLAUDE_PROJECT_DIR, `${sid}.jsonl`), "kept\n");
    writeFileSync(join(config, "projects", "escape.jsonl"), "secret\n");
    const out = join(root, "saved");
    const cases: readonly [string, string, boolean][] = [
      ["x-1", sid, true],
      ["../bad", sid, false],
      ["x-esc", "../escape", false],
      ["x-none", "22222222-2222-3333-4444-555555555555", false],
    ];
    for (const [seat, session, saved] of cases) {
      saveTranscript(config, { dir: out, seat }, session);
      expect(existsSync(join(out, `${seat}.jsonl`))).toBe(saved);
    }
    expect(readFileSync(join(out, "x-1.jsonl"), "utf8")).toBe("kept\n");
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import { CLAUDE_SESSIONS_DIR } from "../src/agent/backends/claude-transcript.ts";
import type { EventKind } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { seatFork } from "../tools/campaign/seat-fork.ts";
import { modelNamed } from "../tools/m0/stored-sweep.ts";
import { SEED_FILE } from "../tools/runs/registry.ts";

const root = mkdtempSync(join(tmpdir(), "ana-seat-fork-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const claude = modelNamed("claude/claude-haiku-4-5");
const codex = modelNamed("openai-codex/gpt-6-luna");
const line = (kind: EventKind, data: JsonObject) =>
  JSON.stringify({ at: "2026-11-26T00:00:00.000Z", kind, data });

function makeSeed(name: string) {
  const source = join(root, `${name}-source`);
  const seed = join(root, name);
  const x1 = [line("exam.started", { session: "x-1" })];
  const events = [
    ...x1,
    line("exam.turn", { session: "x-1", turn: 1, text: "t1" }),
    line("exam.turn", { session: "x-1", turn: 2, text: "t2" }),
    line("exam.started", { session: "x-2", conversation: "x-1" }),
    line("exam.turn", { session: "x-2", turn: 3, text: "t3" }),
  ];
  for (const dir of [join(source, CLAUDE_SESSIONS_DIR), seed]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(source, "log.jsonl"), `${events.join("\n")}\n`);
  writeFileSync(join(source, CLAUDE_SESSIONS_DIR, "x-1.jsonl"), "{}\n");
  writeFileSync(join(seed, "log.jsonl"), `${x1.join("\n")}\n`);
  writeFileSync(join(seed, SEED_FILE), JSON.stringify({ from: source }));
  return { log: join(seed, "log.jsonl"), seed, transcript: join(source, CLAUDE_SESSIONS_DIR, "x-1.jsonl") };
}

describe("seatFork", () => {
  const sim = makeSeed("sim-fork");
  const live = makeSeed("live-fork");

  it("forks a seed's session from its conversation's transcript at the session's own turn", () => {
    const persistDir = join(sim.seed, CLAUDE_SESSIONS_DIR);
    expect(seatFork(sim.log, "exam", claude, {})).toBeNull();
    expect(seatFork(sim.log, "exam", claude, { "fork-from": "x-1", "at-turn": "2" })).toEqual({
      seat: { persistDir, fork: { transcript: sim.transcript, atTurn: 2 } },
      resumeWith: "Continue from where you left off.",
    });
    expect(
      seatFork(sim.log, "exam", claude, { "fork-from": "x-2", "at-turn": "1", nudge: "  Edge cases.  " }),
    ).toEqual({
      seat: { persistDir, fork: { transcript: sim.transcript, atTurn: 3 } },
      resumeWith: "Edge cases.",
    });
    expect(
      seatFork(sim.log, "exam", claude, { "fork-from": "/a/b.jsonl", "at-turn": "4" })?.seat.fork,
    ).toEqual({
      transcript: "/a/b.jsonl",
      atTurn: 4,
    });
  });

  it("refuses forks off a seed, off Claude, without a turn, or past what was recorded", () => {
    const refusals: readonly [string, Parameters<typeof seatFork>[3], string][] = [
      [live.log, { "fork-from": "x-1", "at-turn": "1" }, "on a simulation seed"],
      [sim.log, { nudge: "try harder" }, "go together"],
      [sim.log, { "fork-from": "x-1" }, "go together"],
      [sim.log, { "at-turn": "1" }, "go together"],
      [sim.log, { "fork-from": "x-1", "at-turn": "0" }, "positive integer"],
      [sim.log, { "fork-from": "x-1", "at-turn": "1.5" }, "positive integer"],
      [sim.log, { "fork-from": "../x-1", "at-turn": "1" }, "name a session or a .jsonl path"],
      [sim.log, { "fork-from": "x-2", "at-turn": "2" }, "recorded fewer exam turns"],
      [sim.log, { "fork-from": "x-9", "at-turn": "1" }, "no claude-sessions/ transcript"],
    ];
    for (const [log, flags, message] of refusals) {
      expect(() => seatFork(log, "exam", claude, flags)).toThrow(message);
    }
    expect(() => seatFork(sim.log, "exam", codex, { "fork-from": "x-1", "at-turn": "1" })).toThrow(
      "Claude seat",
    );
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

const PROTECTED = "SECRET-REMEDY: add Arduino.h at line 3";

let scratch;
let campaign;

function run(...args) {
  return runTypeScript("difficulty-watch.mts", ["--campaign", campaign, ...args]);
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "difficulty-watch-test-"));
  campaign = join(scratch, "campaigns", "demo");
  writeJson(join(campaign, "controller", "fullrun-1", "opening.json"), {
    runId: "fullrun-1",
    writtenAt: "2026-08-23T14:00:00.000Z",
    source: {
      commit: "bf06e8856966f660499c880c9d47a4d6832053e2",
      dirty: false,
      sourceDigest: "a".repeat(64),
    },
    epoch: { key: "epoch-b77b", supersedes: null },
    modelSlots: { builder: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" } },
  });
  writeJson(join(campaign, "epoch-b77b", "builder-execution.json"), {
    backend: "codex",
    outcome: "recorded",
    turns: 1,
    durationMs: 6909159,
    toolCalls: { total: 3, failed: 0, byName: { correctness_check: 2, submit: 1 } },
    customCalls: [
      {
        sequence: 28,
        turn: 1,
        tool: "correctness_check",
        action: "run",
        startedAtMs: 2994407,
        durationMs: 71,
        dispatchOutcome: "returned",
        text: PROTECTED,
      },
      {
        sequence: 29,
        turn: 1,
        tool: "fileChange",
        action: "write",
        startedAtMs: 2995000,
        durationMs: 5,
        dispatchOutcome: "returned",
      },
      {
        sequence: 30,
        turn: 1,
        tool: "submit",
        action: "run",
        startedAtMs: 6909000,
        durationMs: 159,
        dispatchOutcome: "returned",
      },
    ],
    submits: [
      {
        ordinal: 1,
        turn: 1,
        atMs: 6909159,
        outcome: "accepted",
        stage: null,
        findingCodes: ["F2_WITNESS", PROTECTED],
        repeatedFindings: null,
        workspaceChanged: null,
        terminal: false,
        message: PROTECTED,
      },
    ],
    writtenAt: "2026-08-23T16:03:34.892Z",
  });
  writeJson(join(campaign, "epoch-b77b", "builder-execution-02.json"), {
    backend: "codex",
    outcome: "refused",
    turns: 2,
    customCalls: [],
    submits: [],
  });
  writeFileSync(join(campaign, "epoch-b77b", "builder-execution-zz.json"), "{not json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("difficulty-watch", () => {
  it("prints the controller opening, the sequence calls and the submit rows, in order", () => {
    const result = run();
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe("run fullrun-1: source bf06e8856 epoch epoch-b77b supersedes null");
    expect(lines[1]).toBe("  terminal: absent");
    expect(lines[2]).toBe(
      'epoch-b77b/builder-execution.json: outcome recorded turns 1 01:55:09 tools {"correctness_check":2,"submit":1}',
    );
    expect(lines[3]).toBe("  00:49:54 t1 #28 correctness_check:run 71ms returned");
    expect(lines[4]).toBe("  01:55:09 t1 #30 submit:run 159ms returned");
    expect(lines[5]).toBe(
      "  01:55:09 submit 1 → accepted stage null codes F2_WITNESS repeated null changed null terminal false",
    );
    expect(lines[6]).toBe("epoch-b77b/builder-execution-02.json: outcome refused turns 2 --:-- tools {}");
  });

  it("omits unselected text fields and filters prose from finding codes", () => {
    const text = run();
    const json = run("--json");
    expect(text.stdout).not.toContain("SECRET-REMEDY");
    expect(json.stdout).not.toContain("SECRET-REMEDY");
    expect(json.stdout).not.toContain('"text"');
    expect(json.stdout).not.toContain('"message"');
    expect(JSON.parse(json.stdout).executions[0].sequence.map((call) => call.tool)).toEqual([
      "correctness_check",
      "submit",
    ]);
  });

  it("names the strict reader's refusal of an opening instead of reading around it", () => {
    writeJson(join(campaign, "controller", "fullrun-2", "opening.json"), {
      runId: "fullrun-2",
      writtenAt: "2026-08-23T15:00:00.000Z",
      source: { commit: "bf06e8856966f660499c880c9d47a4d6832053e2", dirty: false },
      epoch: { key: "epoch-b77b", supersedes: null },
    });
    const result = run();
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines[2]).toBe("run fullrun-2: source ? epoch ? supersedes null");
    expect(lines[4]).toContain("refused by the strict reader: opening source identity is not concrete");
    const row = JSON.parse(run("--json").stdout).controller[1];
    expect(row.refused).toContain("opening source identity is not concrete");
  });
});

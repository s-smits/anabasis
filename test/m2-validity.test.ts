import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { capturedJsonParse, parseJsonAs } from "../src/meta/json-runtime.ts";
import { createSubmissionAuthority } from "../src/solve/final-submission.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { commitPublicTask } from "../src/correctness-bundle/task-split.ts";
import type { ReplayToolRun } from "../tools/replay/cli.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { MATCHING_ACCEPTS, MATCHING_BRIEF, MATCHING_TASKS } from "./helpers/matching-fixture.ts";
import {
  type CaseReplay,
  type M2Label,
  batteryCases,
  buildPacket,
  deterministicLabel,
} from "#skills/run-improvement-campaign/scripts/m2-packets.ts";
import { caseKey } from "#skills/run-improvement-campaign/scripts/climb-outcome.ts";
import {
  type ReadResult,
  aggregate,
  labelLines,
  parseLabels,
  readOfTranscript,
} from "#skills/run-improvement-campaign/scripts/m2-read.ts";
import { type TruthRow, calibrate, scoreBar } from "#skills/run-improvement-campaign/scripts/m2-calibrate.ts";

const TASK = MATCHING_TASKS[0]!;
const CHECK = "parts-assigned";

/** One arm of a comparison: everything that names whose run a case came from. */
interface Arm {
  slug: string;
  runId: string;
  model: string;
  epoch: string;
  digest: string;
  at: string;
}

/** One check's row as a packet renders it. */
interface PacketCheck {
  checkId: string;
  toolRuns: { graded: string; instrument?: string }[];
}

const OPUS: Arm = {
  slug: "design-truss-3fd52f9e-26",
  runId: "truss-opushmm-20260929T031800000Z-198d70a-i10",
  model: "claude-opus-5-5",
  epoch: "epoch-62104ef837b2",
  digest: "a".repeat(64),
  at: "2026-09-29T03:18:00.123Z",
};
const SOL: Arm = {
  slug: "design-truss-3fd52f9e-27",
  runId: "truss-sol-20261007T010940127Z-5d09120-i10",
  model: "gpt-6-sol",
  epoch: "epoch-0ff00ce68e67",
  digest: "b".repeat(64),
  at: "2026-10-07T01:09:40.127Z",
};

/** Tool output as a run would print it, naming its own campaign, run, model and time. */
function stderrOf(arm: Arm, campaignDir: string): string {
  return [
    `${campaignDir}/${arm.epoch}/workspace/.toolchain/bin/python3: Fatal Python error: init_import_site`,
    `run ${arm.runId} under ${arm.model} at ${arm.at}`,
    `  File "${campaignDir}/versions/${arm.runId}/correctness-model/stand_in.py", line 3`,
  ].join("\n");
}

function toolRun(arm: Arm, campaignDir: string): ReplayToolRun {
  return {
    checkId: CHECK,
    toolId: "python3",
    toolSource: "workspace-toolchain",
    toolKind: "script",
    toolDigest: arm.digest,
    exitCode: 1,
    signal: null,
    timedOut: false,
    outcome: "executed",
    durationMs: arm === OPUS ? 812 : 377,
    stderrTail: stderrOf(arm, campaignDir),
  };
}

/** A recorded battery holding t1's accepted answer, failed on one check, under `arm`'s names. */
function recordArm(arm: Arm): string {
  const campaignDir = join(realpathSync(scratchDir("m2-arm-")), "campaigns", arm.slug);
  const runDir = join(campaignDir, "versions", arm.runId, "runs", arm.runId);
  mkdirSync(runDir, { recursive: true });
  const log = new EvidenceLog(runDir);
  log.write("battery.json", {
    runId: arm.runId,
    bundleSnapshot: { id: "snapshot-1", agentHash: "a", correctnessModelHash: "b", taskSetHash: "c" },
    cases: [
      {
        taskId: TASK.taskId,
        family: TASK.family,
        acceptedSubmit: true,
        truthOk: false,
        pass: false,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      },
    ],
    executionEvidence: [{ ...toolRun(arm, campaignDir), subjectId: TASK.taskId }],
  });
  const authority = createSubmissionAuthority({
    maxAttempts: 1,
    publicArtifactSchema: compilePublicArtifactSchema(
      MATCHING_BRIEF.artifactSchema,
      MATCHING_ACCEPTS.map((row) => row.artifact),
    ),
  });
  const final = authority.acceptArtifact(JSON.stringify({ assignments: [{ part: "alpha", slot: "s1" }] }));
  const prefix = `cases/${TASK.taskId}`;
  log.write(`${prefix}/final-submission.json`, capturedJsonParse(JSON.stringify(final)));
  log.write(`${prefix}/public-task.json`, { publicTaskDigest: commitPublicTask(TASK).publicTaskDigest });
  log.write(`${prefix}/verifier.json`, {
    ok: false,
    issues: [{ checkId: CHECK, message: `${arm.model} expected slot s3 in ${arm.runId}` }],
    checkReceipts: [{ checkId: CHECK, passed: false, artifactInputDigest: "x", publicTaskInputDigest: "y" }],
  });
  log.write(`${prefix}/trace.json`, {
    schema: "trace/v1",
    toolCalls: [{ toolName: "bash" }, { toolName: "submit" }],
  });
  log.record();
  return campaignDir;
}

/** The case as the packet step reads it from `arm`'s record, and its packet. */
function packetOf(arm: Arm) {
  const campaignDir = recordArm(arm);
  const [one, ...rest] = batteryCases(campaignDir, arm.runId);
  expect(rest).toEqual([]);
  if (one?.final?.artifactJson === null || one?.final?.artifactJson === undefined) {
    throw new Error("no answer");
  }
  const replay: CaseReplay = {
    verdict: "non-result",
    nonResultKind: "verifierUnavailable",
    checkRuns: [
      { seq: 0, checkId: CHECK, outcome: "fail", errorKind: null, startedAt: arm.at, durationMs: 9 },
    ],
    toolRuns: [toolRun(arm, campaignDir)],
    missingTools: ["python3"],
  };
  const packet = buildPacket({
    brief: MATCHING_BRIEF,
    task: TASK,
    answer: capturedJsonParse(one.final.artifactJson),
    recorded: one.recorded,
    replay,
    solveEnd: one.solveEnd,
    identity: one.identity,
  });
  return { one, packet, campaignDir };
}

afterAll(cleanupScratch);

describe("m2 packets are blind", () => {
  const opus = packetOf(OPUS);
  const sol = packetOf(SOL);

  it("carry no arm, source sha, run id, campaign slug, model slot, path or time", () => {
    for (const [arm, { packet, campaignDir }] of [
      [OPUS, opus],
      [SOL, sol],
    ] as const) {
      for (const name of [arm.slug, "design-truss-3fd52f9e", arm.runId, arm.epoch, arm.model, campaignDir]) {
        expect(packet).not.toContain(name);
      }
      expect(packet).not.toMatch(/198d70a|5d09120|opushmm|\bsol\b|claude-|gpt-|\/Users\/|\/private\//);
      expect(packet).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}|\d{8}T\d{6}/);
      expect(packet).not.toMatch(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/);
      // Verifier issue messages are not packet evidence; the tool run's own exit and stderr are.
      expect(packet).not.toContain("expected slot");
      expect(packet).toContain("Fatal Python error");
      expect(packet).toContain('"alpha"');
    }
  });

  it("are byte-identical for the same case read from two arms", () => {
    expect(opus.packet).toBe(sol.packet);
    expect(caseKey(opus.one.campaignDir, opus.one.locator, TASK.taskId)).not.toBe(
      caseKey(sol.one.campaignDir, sol.one.locator, TASK.taskId),
    );
  });

  it("leave a wall's draft and an unanswered case to the record", () => {
    const { one } = opus;
    expect(deterministicLabel(one, null)).toBeNull();
    expect(deterministicLabel({ ...one, solveEnd: { ...one.solveEnd, solverSubmitted: false } }, null)).toBe(
      "wall-ended",
    );
    const unanswered = { ...one, final: null, recorded: { outcomes: null, toolRuns: [] } };
    expect(deterministicLabel({ ...unanswered, solveEnd: { ...one.solveEnd, accepted: false } }, null)).toBe(
      "unclassified",
    );
  });
});

describe("m2 packet checks", () => {
  const { one, campaignDir } = packetOf(OPUS);
  const run = toolRun(OPUS, campaignDir);
  const checkOf = (recorded: typeof one.recorded, outcome: "pass" | "fail") => {
    const packet = buildPacket({
      brief: MATCHING_BRIEF,
      task: TASK,
      answer: capturedJsonParse(one.final?.artifactJson ?? "null"),
      recorded,
      replay: {
        verdict: outcome,
        nonResultKind: null,
        checkRuns: [{ seq: 0, checkId: CHECK, outcome, errorKind: null, startedAt: OPUS.at, durationMs: 9 }],
        toolRuns: [run],
        missingTools: [],
      },
      solveEnd: one.solveEnd,
      identity: one.identity,
    });
    return parseJsonAs<{ checks: PacketCheck[] }>(packet).checks.find((check) => check.checkId === CHECK);
  };

  it("list no tool run under a check that passed on every side it has", () => {
    expect(checkOf({ outcomes: null, toolRuns: [] }, "pass")?.toolRuns).toEqual([]);
    expect(checkOf({ outcomes: { [CHECK]: "fail" }, toolRuns: [] }, "pass")?.toolRuns).toHaveLength(1);
  });

  it("compare a replayed tool with the recorded runs of that tool only", () => {
    const replayed = (recorded: typeof one.recorded) =>
      checkOf(recorded, "fail")?.toolRuns.find((row) => row.graded === "replayed")?.instrument;
    expect(replayed({ outcomes: { [CHECK]: "fail" }, toolRuns: [] })).toBe("no recorded run of this tool");
    expect(replayed({ outcomes: { [CHECK]: "fail" }, toolRuns: [{ ...run, toolId: "other" }] })).toBe(
      "no recorded run of this tool",
    );
    expect(replayed({ outcomes: { [CHECK]: "fail" }, toolRuns: [run] })).toBe(
      "the same bytes as the recorded run",
    );
    expect(
      replayed({ outcomes: { [CHECK]: "fail" }, toolRuns: [{ ...run, toolDigest: "f".repeat(64) }] }),
    ).toBe("different bytes from the recorded run");
  });
});

describe("caseKey", () => {
  // Fixed vectors: a label written under one key must join under the next release's.
  it.each([
    [
      "/Users/air/Developer/anabasis/campaigns/writes-firmware-esp32-raspberry-9c0c68b1-11",
      "custom-sol-20260926T200000000Z-7398e7",
      "pico-light",
      "ab34525a7220203a",
    ],
    ["/c", "r", "t", "eea537148320f304"],
    ["/private/tmp/campaigns/café-1", "run-1", "tâche", "bbde8b5cbed25f12"],
  ])("%s / %s / %s → %s", (campaignDir, runId, taskId, key) => {
    expect(caseKey(campaignDir, runId, taskId)).toBe(key);
  });
});

function read(label: ReadResult["label"], error: string | null = null): ReadResult {
  return { label, decidingCheck: CHECK, reason: "r", models: ["claude-opus-5-5"], tools: [], error };
}

describe("m2 reads", () => {
  it("take the label two thirds of the replicates agree on, and unclassified otherwise", () => {
    expect(aggregate([read("limit"), read("limit"), read("check-defect")], 3).label).toBe("limit");
    expect(aggregate([read("limit"), read("check-defect"), read("under-specified")], 3).label).toBe(
      "unclassified",
    );
    expect(aggregate([read("limit"), read("limit")], 3)).toEqual({ label: "limit", agreement: 2 / 3 });
    expect(aggregate([read("limit")], 3).label).toBe("unclassified");
  });

  const transcript = (model: string, tool: string) => [
    JSON.stringify({ type: "system", subtype: "init", model, tools: ["StructuredOutput"] }),
    JSON.stringify({ type: "assistant", message: { model, content: [{ type: "tool_use", name: tool }] } }),
    JSON.stringify({
      type: "result",
      modelUsage: { [model]: {} },
      structured_output: { label: "check-defect", decidingCheck: CHECK, reason: "r" },
    }),
  ];

  it("count a read only when its transcript shows the asked model and no tool but the schema's", () => {
    expect(
      readOfTranscript(transcript("claude-opus-5-5", "StructuredOutput"), "claude-opus-5-5"),
    ).toMatchObject({
      label: "check-defect",
      error: null,
    });
    expect(readOfTranscript(transcript("claude-opus-5-5", "Read"), "claude-opus-5-5")).toMatchObject({
      label: null,
    });
    expect(
      readOfTranscript(transcript("claude-opus-5", "StructuredOutput"), "claude-opus-5-5"),
    ).toMatchObject({
      label: null,
      models: ["claude-opus-5"],
    });
  });

  it("round-trip the label file and refuse a line it cannot score", () => {
    const lines = [
      { caseKey: "ab34525a7220203a", label: "limit" },
      { caseKey: "eea537148320f304", label: "wall-ended" },
    ] as const;
    const text = labelLines(lines);
    expect(text).toBe(
      '{"caseKey":"ab34525a7220203a","label":"limit"}\n{"caseKey":"eea537148320f304","label":"wall-ended"}\n',
    );
    const parsed = parseLabels(text);
    const lineOf = ([key, label]: [string, M2Label]) => ({ caseKey: key, label });
    expect([...parsed].map(lineOf)).toEqual([...lines]);
    expect(labelLines([...parsed].map(lineOf))).toBe(text);
    expect(() => parseLabels('{"caseKey":"k","label":"real"}\n')).toThrow("known label");
    expect(() => parseLabels(`${text}${text}`)).toThrow("labelled twice");
  });
});

/** The calibration's primary set: 12 limits, 47 check defects and 9 under-specified cases, with one
 *  limit and three defects flagged as breaking the domain rule. */
function primary(): TruthRow[] {
  const rows = (label: TruthRow["label"], count: number, from: number): TruthRow[] =>
    Array.from({ length: count }, (_, index) => ({
      caseKey: `k${from + index}`,
      caseId: `case-${from + index}`,
      label,
      stratum: "primary" as const,
    }));
  const all = [...rows("limit", 12, 0), ...rows("check-defect", 47, 12), ...rows("under-specified", 9, 59)];
  all[0] = { ...all[0]!, domainRuleBreaker: "limit" };
  for (const index of [12, 13, 14]) all[index] = { ...all[index]!, domainRuleBreaker: "check-side" };
  return all;
}

describe("m2 calibration bar", () => {
  const truth = primary();
  const perfect = new Map(truth.map((row) => [row.caseKey, row.label]));
  const reading = (changes: Record<string, TruthRow["label"] | null>) => {
    const labels = new Map(perfect);
    for (const [key, label] of Object.entries(changes)) {
      if (label === null) labels.delete(key);
      else labels.set(key, label);
    }
    return scoreBar(truth, labels);
  };
  const failing = (score: ReturnType<typeof scoreBar>) =>
    Object.entries(score.bar).flatMap(([part, result]) => (result.pass ? [] : [part]));

  it("passes a reading that agrees everywhere, even across the defect and under-specified line", () => {
    expect(reading({}).pass).toBe(true);
    expect(failing(reading({ k20: "under-specified", k60: "check-defect" }))).toEqual([]);
  });

  it("fails P1 on one missed limit and P2 on two false ones", () => {
    expect(failing(reading({ k5: "check-defect" }))).toEqual(["P1"]);
    expect(failing(reading({ k30: "limit" }))).toEqual([]);
    expect(failing(reading({ k30: "limit", k31: "limit" }))).toEqual(["P2"]);
  });

  it("holds P3 at 65 of 68 three-way agreements, and P4 on every flagged case", () => {
    expect(failing(reading({ k20: "wall-ended", k21: "wall-ended", k22: "wall-ended" }))).toEqual([]);
    expect(
      failing(reading({ k20: "wall-ended", k21: "wall-ended", k22: "wall-ended", k23: "wall-ended" })),
    ).toEqual(["P3"]);
    expect(failing(reading({ k13: "limit" }))).toEqual(["P4"]);
  });

  it("counts a missing label as unclassified, and fails P5 past three", () => {
    expect(reading({ k20: null, k21: "unclassified", k22: "unclassified" }).bar.P5.value).toBe(
      "3 (at most 3)",
    );
    expect(
      failing(reading({ k20: null, k21: "unclassified", k22: "unclassified", k23: "unclassified" })),
    ).toEqual(["P3", "P5"]);
  });

  it("scores an added case on a second reading, with P3's bar scaled to 66 of 69", () => {
    const added: TruthRow = { caseKey: "k68", caseId: "case-68", label: "limit", stratum: "added" };
    const report = calibrate([...truth, added], new Map([...perfect, ["k68", "check-defect"]]));
    expect(report.bars.get("primary")?.pass).toBe(true);
    expect(report.bars.get("primary+added")?.bar.P1.value).toBe("12/13");
    expect(report.bars.get("primary+added")?.bar.P3.value).toBe("68/69 (at least 66)");
    expect(report.rules).toBe(false);
    const limits = report.confusion.find((row) => row.truth === "limit");
    expect(limits).toMatchObject({ n: 13, cells: { limit: 12, "check-defect": 1 } });
  });
});

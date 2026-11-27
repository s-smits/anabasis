import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import type { DraftAuditFinding } from "../src/audit/draft-audit.ts";
import { stopRule } from "../src/campaign/admission.ts";
import { riskLines } from "../src/campaign/climb.ts";
import { budgetLeft, openingOf } from "../src/campaign/opening.ts";
import { nextAction } from "../src/campaign/scheduler.ts";
import { type Draft, draftOf } from "../src/examiner/draft.ts";
import { systemPrompt } from "../src/examiner/prompt.ts";
import { candidateDraft, revisionFaults, revisionRefusal } from "../src/examiner/revise.ts";
import { examine } from "../src/examiner/session.ts";
import { writeStarter } from "../src/harness/starter.ts";
import { keepAnswerFiles, textFiles } from "../src/kernel/answer-files.ts";
import { conditionId } from "../src/kernel/condition.ts";
import { contentOf } from "../src/kernel/history.ts";
import { append, eventsOf, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { endedOf, latestBuilt, promoted } from "../src/kernel/reports.ts";
import { taskVersion } from "../src/kernel/task.ts";
import { HOST_TOOLS_FILE } from "../src/kernel/verify.ts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { REPO } from "../tools/campaign/campaign.ts";
import { draftReading } from "../tools/campaign/exam.ts";
import { harnessBuilder } from "../tools/campaign/harness-builder.ts";
import { ungated } from "../tools/campaign/prepare.ts";
import { freezeCandidate, type RevisionAuditor, revisionRunner } from "../tools/campaign/revise.ts";
import { crossFamilyVendors } from "../tools/campaign/round.ts";
import {
  openSuccessor,
  rewriteMovesFlag,
  rewriteNameFlag,
  successorName,
} from "../tools/campaign/successor.ts";
import { keepReading } from "../tools/eval/accept.ts";
import { examineCommand } from "../tools/eval/examine.ts";
import { packageOf } from "../tools/m0/stored-sweep.ts";
import { lastLaunch, writeReceipt } from "../tools/runs/receipt.ts";
import { replayed } from "../tools/runs/replay.ts";
import { EVENT_FORMATTERS, triggerOf } from "../tools/runs/summary.ts";
import { gamingRows } from "../tools/wri/gaming.ts";
import { call, condition, finish, seat, sweep } from "./helpers/examiner-seat.ts";

setDefaultTimeout(120_000);

const NOTE_FILE = "note.txt";
const OPENED = "campaign.opened" as const;
const REVISED = "exam.revised" as const;
const OPUS = "claude/claude-opus-5-5";
const codeItem = (id: string, weight: number) => ({ id, weight, kind: "code" as const });
const ROOTS: string[] = [];
afterAll(() => {
  sweep();
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ROOTS.push(dir);
  return dir;
}

const PARENT_EVALUATOR = `
export const checks = {
  "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
  "check-strict": ({ artifact, hidden, files }) => {
    const note = files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "";
    return artifact.n === hidden.target && note === "exact:" + String(hidden.target);
  },
};
export const scores = {
  accuracy: ({ artifact, hidden }) => Math.max(0, 1 - Math.abs(artifact.score - hidden.ideal) / 10),
  depth: ({ artifact }) => Math.min(1, Math.max(0, artifact.detail / 10)),
};
`;

const PARENT_DRAFT: Draft = {
  domain: "even-targets",
  scope: "Produce an even integer matching target and a note.txt deliverable.",
  conventions: "Exact integers.",
  rules: [
    { id: "R1", statement: "Answer n is an even integer.", source: "spec" },
    { id: "R2", statement: "Answer n matches the target and note.txt records it.", source: "spec" },
  ],
  answerFormat: {
    type: "object",
    required: ["n", "score", "detail"],
    additionalProperties: false,
    properties: {
      n: { type: "integer" },
      score: { type: "number" },
      detail: { type: "number" },
    },
  },
  checks: [
    { id: "check-even", rule: "R1", assertion: "n is an even integer" },
    { id: "check-strict", rule: "R2", assertion: "n matches target and note.txt documents it" },
  ],
  evaluator: PARENT_EVALUATOR,
  objective: {
    quantity: "composite rubric quality",
    direction: "higher",
    scale: "unit",
    items: [
      { id: "accuracy", weight: 1, kind: "code" },
      { id: "depth", weight: 1, kind: "code" },
    ],
  },
  tasks: [
    { family: "f1", publicInput: { prompt: "ten" }, hidden: { target: 10, ideal: 10 } },
    { family: "f1", publicInput: { prompt: "twelve" }, hidden: { target: 12, ideal: 10 } },
    { family: "f2", publicInput: { prompt: "fourteen" }, hidden: { target: 14, ideal: 10 } },
  ],
  accept: [
    { task: 0, answer: { n: 10, score: 10, detail: 9 }, files: [{ path: NOTE_FILE, text: "exact:10" }] },
    { task: 1, answer: { n: 12, score: 10, detail: 9 }, files: [{ path: NOTE_FILE, text: "exact:12" }] },
    { task: 2, answer: { n: 14, score: 10, detail: 9 }, files: [{ path: NOTE_FILE, text: "exact:14" }] },
  ],
  reject: [
    {
      task: 0,
      answer: { n: 11, score: 10, detail: 9 },
      files: [{ path: NOTE_FILE, text: "exact:10" }],
      check: "check-even",
    },
    {
      task: 0,
      answer: { n: 8, score: 10, detail: 9 },
      files: [{ path: NOTE_FILE, text: "wrong" }],
      check: "check-strict",
    },
  ],
};

const SOUND_AUDIT: RevisionAuditor = async (_reader, target) => {
  append(target.log, "referee.draft", {
    session: target.session,
    ...keyIfDefined("pass", target.pass),
    ...keyIfDefined("revision", target.revision),
    verdict: "sound",
    findings: [],
    summary: "sound",
    probeRows: [],
  });
  return {
    verdict: "sound",
    findings: [],
    summary: "sound",
    probes: [],
  };
};

async function seedCampaign(opts?: {
  readonly name?: string;
  readonly attended?: boolean;
  readonly revise?: boolean;
  readonly reviewer?: string;
  readonly solver?: string;
  readonly budget?: { readonly dollars: number; readonly reserve: number };
}) {
  const root = tempDir("ana-rev-camp-");
  const name = opts?.name ?? "camp-a";
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, LOG_FILE);
  append(log, OPENED, {
    project: "demo",
    budget: opts?.budget ?? { dollars: 50, reserve: 3 },
    patience: 6,
    seats: {
      builder: { model: OPUS, effort: "high" },
      examiner: { model: OPUS, effort: "high" },
      reviewer: { model: opts?.reviewer ?? "openai-codex/gpt-6.1-sol", effort: "high" },
    },
    ...keysIf(opts?.attended === true, () => ({ attended: true })),
    judged: opts?.attended !== true,
    ...keysIf(opts?.revise === false, () => ({ revise: false })),
    prompt: "Build an even-target exam.",
    solver: { model: opts?.solver ?? "claude/claude-sonnet-5-5", effort: "high" },
    terms: { level: "0.02", practice: "6" },
  });
  append(log, "campaign.setting", {
    solver: opts?.solver ?? "claude/claude-sonnet-5-5",
    effort: "high",
    minutes: 30,
    modelTurns: 20,
    target: 24,
    solves: 2,
  });
  append(log, "exam.drafted", {
    session: "d-1",
    draft: parseJsonAs<JsonObject>(capturedJsonStringify(PARENT_DRAFT)),
  });
  const staged = await draftReading(dir, PARENT_DRAFT, 4);
  if (staged.faults.length > 0 || staged.read === undefined) {
    throw new Error(`seed draft failed: ${staged.faults.join("; ")}`);
  }
  keepReading(log, staged.read.checker, staged.read.reading, {
    admitted: new Set(),
    authored: true,
    judge: false,
    freeze: true,
    despite: "",
  });
  const bundle = join(dirname(staged.read.checks), "bundle");
  const packages = () =>
    new Map(
      staged.read.tasks.map((task) => {
        const packaged = packageOf(staged.read.checks, task);
        return [taskVersion(packaged), packaged] as const;
      }),
    );
  const harnessDir = join(dir, "states", "h-carried");
  mkdirSync(harnessDir, { recursive: true });
  writeStarter(harnessDir);
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "memory", "MEMORY.md"), "# Builder notes\nKeep it fast.\n");
  mkdirSync(join(dir, "examiner-home"), { recursive: true });
  writeFileSync(join(dir, "examiner-home", "gen.py"), "print(1)\n");
  writeReceipt(log, "run-1", {
    at: "2026-11-27T00:00:00.000Z",
    pid: 1234,
    flags: ["--name", name, "--budget", "50", "--project", "demo"],
    envFile: null,
    commit: "abcdef1234567890",
    dirty: false,
    load: 0.5,
    cores: 8,
    bun: Bun.version,
  });
  return { root, dir, log, bundle, checks: staged.read.checks, packages, tasks: staged.read.tasks };
}

function recordHistoricalWitnesses(
  log: string,
  taskVersion0: string,
  opts?: { readonly includeDefect?: boolean; readonly reportComp?: boolean },
) {
  const earnedStrictFiles = keepAnswerFiles(log, textFiles([{ path: NOTE_FILE, text: "bad" }]));
  const earnedEvenFiles = keepAnswerFiles(log, textFiles([{ path: NOTE_FILE, text: "exact:10" }]));
  const defectFiles = keepAnswerFiles(log, textFiles([{ path: NOTE_FILE, text: "exact: 10\n" }]));
  append(log, "comparison.started", { session: "g-1", old: "starter", fresh: "h1", starter: "starter" });
  const cond = condition(taskVersion0, "starter");
  const cid = conditionId(cond);
  append(log, "condition.recorded", { id: cid, condition: requireJsonValue(cond) });
  append(log, "solve.started", { solve: "s-earned-strict", comparison: "g-1", condition: cid });
  append(log, "verdict", {
    solve: "s-earned-strict",
    task: "ex-001",
    answer: { n: 8, score: 5, detail: 5 },
    files: earnedStrictFiles.map((f) => ({ ...f })),
    kind: "fail",
    blocking: ["check-strict"],
  });
  append(log, "referee.finding", {
    solve: "s-earned-strict",
    task: "ex-001",
    ruling: "earned",
    check: "check-strict",
    reason: "wrong target n=8",
  });
  append(log, "solve.started", { solve: "s-earned-even", comparison: "g-1" });
  append(log, "verdict", {
    solve: "s-earned-even",
    task: "ex-001",
    answer: { n: 11, score: 5, detail: 5 },
    files: earnedEvenFiles.map((f) => ({ ...f })),
    kind: "fail",
    blocking: ["check-even", "check-strict"],
  });
  append(log, "referee.finding", {
    solve: "s-earned-even",
    task: "ex-001",
    ruling: "earned",
    check: "check-even",
    reason: "odd integer n=11",
  });
  if (opts?.includeDefect !== false) {
    append(log, "solve.started", { solve: "s-defect-strict", comparison: "g-1", condition: cid });
    append(log, "verdict", {
      solve: "s-defect-strict",
      task: "ex-001",
      answer: { n: 10, score: 9, detail: 8 },
      files: defectFiles.map((f) => ({ ...f })),
      kind: "fail",
      blocking: ["check-strict"],
    });
    append(log, "referee.finding", {
      solve: "s-defect-strict",
      task: "ex-001",
      ruling: "check-defect",
      check: "check-strict",
      reason: "check-strict rejected whitespace after colon",
    });
  }
  if (opts?.reportComp !== false) {
    append(log, "comparison.reported", {
      session: "g-1",
      old: "starter",
      fresh: "h1",
      starter: "starter",
      reading: "no-step",
      scored: { wins: 0, losses: 0, ties: 1 },
      valid: { old: [1, 0], fresh: [1, 0], informative: { old: 1, fresh: 1 } },
      aside: [],
    });
  }
}

describe("revision admission, immutability, and lock exclusion", () => {
  it("enforces R1-R9 admission boundaries and check-defect repair exemption during owed confirmation", async () => {
    const seed = await seedCampaign();
    const version0 = [...seed.packages().keys()][0] ?? "";
    recordHistoricalWitnesses(seed.log, version0, { includeDefect: true, reportComp: false });
    expect(revisionRefusal(read(seed.log), { kind: "tune", crossFamily: crossFamilyVendors })).toContain(
      "still open",
    );

    append(seed.log, "comparison.reported", {
      session: "g-1",
      old: "starter",
      fresh: "h1",
      starter: "starter",
      reading: "step",
      scored: { wins: 6, losses: 0, ties: 0 },
      valid: { old: [6, 0], fresh: [0, 6], informative: { old: 6, fresh: 6 } },
      aside: [],
    });
    expect(revisionRefusal(read(seed.log), { kind: "tune", crossFamily: crossFamilyVendors })).toContain(
      "promotion is pending",
    );

    append(seed.log, "harness.promoted", { harness: "h1", from: "starter" });
    expect(revisionRefusal(read(seed.log), { kind: "tune", crossFamily: crossFamilyVendors })).toContain(
      "starter confirmation is owed",
    );
    expect(
      revisionRefusal(read(seed.log), {
        kind: "repair",
        check: "check-strict",
        crossFamily: crossFamilyVendors,
      }),
    ).toBeNull();
    expect(
      revisionRefusal(read(seed.log), {
        kind: "repair",
        check: "check-even",
        crossFamily: crossFamilyVendors,
      }),
    ).toContain("no effective check-defect ruling");

    const judgedCandidate = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "add judge",
      objective_items: [
        { id: "accuracy", weight: 1, kind: "code" },
        {
          id: "clarity",
          weight: 1,
          kind: "judge",
          criterion: "Reports methodology and exact assumptions clearly.",
        },
      ],
    });
    expect(
      revisionRefusal(read(seed.log), {
        kind: "repair",
        check: "check-strict",
        candidate: judgedCandidate,
        reviewer: "claude/claude-opus-5-5",
        crossFamily: crossFamilyVendors,
      }),
    ).toContain("cross-family reviewer");

    const disabled = await seedCampaign({ revise: false });
    expect(revisionRefusal(read(disabled.log), { kind: "tune" })).toContain("--no-revise");

    const tight = await seedCampaign({ budget: { dollars: 2, reserve: 3 } });
    expect(revisionRefusal(read(tight.log), { kind: "tune" })).toContain("below the solve reserve");
    const exactBudget = await seedCampaign({ budget: { dollars: 3, reserve: 3 } });
    expect(revisionRefusal(read(exactBudget.log), { kind: "tune" })).toBeNull();

    expect(revisionRefusal([], { kind: "tune" })).toContain("drafted and frozen");
    expect(
      revisionRefusal(
        [...read(exactBudget.log), { at: "2026-11-27T00:00:01Z", kind: "exam.revised", data: {} }],
        {
          kind: "tune",
        },
      ),
    ).toContain("already been revised");
    expect(revisionRefusal(read(exactBudget.log), { kind: "repair" })).toContain("existing check id");
    expect(revisionRefusal(read(exactBudget.log), { kind: "repair", check: "check-unknown" })).toContain(
      "existing check id",
    );
    expect(
      revisionRefusal(read(exactBudget.log), { kind: "tune", reviewer: null, requireReviewer: true }),
    ).toContain("requires a reviewer");
    expect(
      revisionRefusal(read(exactBudget.log), { kind: "tune", candidate: judgedCandidate, reviewer: null }),
    ).toContain("cross-family reviewer");
    expect(
      revisionRefusal(read(exactBudget.log), {
        kind: "tune",
        candidate: judgedCandidate,
        reviewer: "openai-codex/gpt-6.1-sol",
        crossFamily: crossFamilyVendors,
      }),
    ).toBeNull();

    const revertSeed = await seedCampaign({ name: "camp-revert" });
    append(revertSeed.log, "harness.promoted", { harness: "h1", from: "starter" });
    append(revertSeed.log, "comparison.started", {
      session: "g-rev",
      old: "h1",
      fresh: "starter",
      starter: "starter",
    });
    append(revertSeed.log, "comparison.reported", {
      session: "g-rev",
      old: "h1",
      fresh: "starter",
      starter: "starter",
      level: 0.05,
      reading: "step",
      scored: { differences: [1, 1, 1, 1, 1, 1] },
      valid: { old: [6, 0, 0], fresh: [0, 0, 6], informative: { old: 6, fresh: 6 } },
      aside: [],
    });
    expect(revisionRefusal(read(revertSeed.log), { kind: "tune" })).toContain("unconfirmed revert");

    append(exactBudget.log, "solve.started", { solve: "s-unrep-def", comparison: "g-unrep" });
    append(exactBudget.log, "verdict", {
      solve: "s-unrep-def",
      task: "ex-001",
      answer: { n: 10, score: 9, detail: 8 },
      kind: "fail",
      blocking: ["check-strict"],
    });
    append(exactBudget.log, "referee.finding", {
      solve: "s-unrep-def",
      task: "ex-001",
      ruling: "check-defect",
      check: "check-strict",
      reason: "unreported comparison defect",
    });
    expect(revisionRefusal(read(exactBudget.log), { kind: "repair", check: "check-strict" })).toContain(
      "no effective check-defect ruling",
    );
    append(exactBudget.log, "solve.started", { solve: "s-prac-def" });
    append(exactBudget.log, "verdict", {
      solve: "s-prac-def",
      task: "ex-001",
      answer: { n: 10, score: 9, detail: 8 },
      kind: "fail",
      blocking: ["check-strict"],
    });
    append(exactBudget.log, "referee.finding", {
      solve: "s-prac-def",
      task: "ex-001",
      ruling: "check-defect",
      reason: "practice defect",
    });
    expect(revisionRefusal(read(exactBudget.log), { kind: "repair", check: "check-strict" })).toBeNull();
  });

  it("enforces R7 structural immutability and no-op refusal", () => {
    const [firstCheck, secondCheck] = PARENT_DRAFT.checks;
    if (firstCheck === undefined || secondCheck === undefined) throw new Error("missing fixture checks");
    const checkCopy = (c: Draft["checks"][number]) => ({
      id: c.id,
      rule: c.rule,
      assertion: c.assertion,
      ...keyIfDefined("tools", c.tools === undefined ? undefined : [...c.tools]),
    });
    const noop = candidateDraft(PARENT_DRAFT, { kind: "tune", why: "no change" });
    expect(revisionFaults(PARENT_DRAFT, noop, "tune", undefined)).toContain(
      "revision makes no change to the parent exam",
    );
    const dropped = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "drop check",
      checks: [checkCopy(firstCheck)],
    });
    expect(revisionFaults(PARENT_DRAFT, dropped, "tune", undefined).join("\n")).toContain(
      "inherited check check-strict cannot be removed",
    );
    const alteredAssertion = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "alter assertion",
      checks: [checkCopy(firstCheck), { ...checkCopy(secondCheck), assertion: "weaker assertion" }],
    });
    expect(revisionFaults(PARENT_DRAFT, alteredAssertion, "tune", undefined).join("\n")).toContain(
      "cannot alter its public assertion",
    );
    const { objective: _obj, ...withoutObjective } = PARENT_DRAFT;
    const noObjectiveParent: Draft = {
      ...withoutObjective,
      evaluator: `export const checks = {
        "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
        "check-strict": ({ artifact, hidden }) => artifact.n === hidden.target,
      };`,
    };
    const addedObj = candidateDraft(noObjectiveParent, {
      kind: "tune",
      why: "invent objective",
      objective_items: [{ id: "accuracy", weight: 1, kind: "code" }],
    });
    expect(
      revisionFaults(noObjectiveParent, addedObj, "tune", undefined, {
        objective_items: [{ id: "accuracy", weight: 1, kind: "code" }],
      }).join("\n"),
    ).toContain("without an objective");
    expect(
      candidateDraft(noObjectiveParent, { kind: "tune", why: "drop tools", objective_tools: ["helper"] })
        .objectiveTools,
    ).toBeUndefined();
    expect(
      candidateDraft(PARENT_DRAFT, { kind: "tune", why: "clear tools", objective_tools: [] }).objectiveTools,
    ).toBeUndefined();
    expect(
      candidateDraft(PARENT_DRAFT, { kind: "tune", why: "set tools", objective_tools: ["helper"] })
        .objectiveTools,
    ).toEqual(["helper"]);
    expect(
      candidateDraft(PARENT_DRAFT, {
        kind: "tune",
        why: "empty check tools",
        checks: [{ ...checkCopy(firstCheck), tools: [] }, checkCopy(secondCheck)],
      }).checks[0]?.tools,
    ).toBeUndefined();
    const alteredRule = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "alter rule",
      checks: [checkCopy(firstCheck), { ...checkCopy(secondCheck), rule: "R1" }],
    });
    expect(revisionFaults(PARENT_DRAFT, alteredRule, "tune", undefined).join("\n")).toContain(
      "must still enforce R2",
    );
    expect(revisionFaults(PARENT_DRAFT, noop, "repair", undefined).join("\n")).toContain(
      "must name the check id",
    );
    expect(revisionFaults(PARENT_DRAFT, noop, "repair", "check-missing").join("\n")).toContain(
      "not among the parent exam's checks",
    );
  });

  it("enforces exclusive-lock mutual exclusion between exam.revised and comparison.started in log.ts", () => {
    const dir = tempDir("ana-rev-lock-");
    const logOpen = join(dir, "open.jsonl");
    append(logOpen, "comparison.started", { session: "g-1", old: "a", fresh: "b" });
    expect(() => append(logOpen, REVISED, { kind: "tune", why: "race" })).toThrow(
      /while comparison g-1 is open/u,
    );

    const logRevised = join(dir, "revised.jsonl");
    append(logRevised, REVISED, { kind: "tune", why: "done" });
    expect(() => append(logRevised, REVISED, { kind: "tune", why: "twice" })).toThrow(
      /already been revised/u,
    );
    expect(() => append(logRevised, "comparison.started", { session: "g-2", old: "a", fresh: "b" })).toThrow(
      /after exam\.revised/u,
    );
  });

  it("schedules check-defects repair examine when canRevise is true and ends exam when false", () => {
    const base: LogEvent[] = [
      { at: "2026-11-27T00:00:00Z", kind: "checker.read", data: { contract: "c", checks: "k", faults: [] } },
      { at: "2026-11-27T00:00:00Z", kind: "task.proposed", data: { version: "v1" } },
      { at: "2026-11-27T00:00:00Z", kind: "task.gate", data: { version: "v1", gate: 1, outcome: "passed" } },
      { at: "2026-11-27T00:00:01Z", kind: "build.checkpoint", data: { session: "b-1", harness: "h1" } },
      {
        at: "2026-11-27T00:00:01Z",
        kind: "comparison.started",
        data: { session: "g-1", old: "s", fresh: "h1", starter: "s" },
      },
      {
        at: "2026-11-27T00:00:02Z",
        kind: "comparison.reported",
        data: { session: "g-1", old: "s", fresh: "h1", starter: "s", reading: "check-defects", aside: [] },
      },
    ];
    const plan = {
      patience: 2,
      unprepared: false,
      practice: null,
      wanted: { target: 8, level: 0.1, solves: 2 },
      pastStop: null,
      prompted: false,
      admits: [],
      left: null,
      promotions: null,
    };
    expect(nextAction(base, { ...plan, canRevise: true })).toMatchObject({ code: "bound", move: "examine" });
    expect(nextAction(base, { ...plan, canRevise: false })).toMatchObject({
      code: "bound",
      move: "end",
      ending: "exam",
    });
    const afterTwoRepairs: LogEvent[] = [
      {
        at: "2026-11-27T00:00:01Z",
        kind: "exam.finished",
        data: { session: "x-0", ended: "finished", held: ["v1"] },
      },
      ...base,
      {
        at: "2026-11-27T00:00:03Z",
        kind: "exam.finished",
        data: { session: "x-int", ended: "crashed", held: [] },
      },
      {
        at: "2026-11-27T00:00:04Z",
        kind: "exam.finished",
        data: { session: "x-2", ended: "finished", held: ["v2"] },
      },
    ];
    expect(nextAction(afterTwoRepairs, { ...plan, canRevise: true })).toMatchObject({
      code: "bound",
      move: "examine",
    });
    expect(
      nextAction(
        [
          ...afterTwoRepairs,
          {
            at: "2026-11-27T00:00:05Z",
            kind: "exam.finished",
            data: { session: "x-3", ended: "finished", held: ["v3"] },
          },
        ],
        { ...plan, canRevise: true },
      ),
    ).toMatchObject({
      code: "bound",
      move: "end",
      ending: "exam",
    });
    expect(
      nextAction(
        [{ at: "2026-11-27T00:00:00Z", kind: "exam.revised", data: { kind: "tune", why: "handoff" } }],
        { ...plan, prompted: true },
      ),
    ).toMatchObject({ code: "revised", move: "end", ending: "revise" });
  });
});

describe("empirical witnesses, adversarial audit cap, and successor A -> B handoff", () => {
  it("kills weakened-check, unfixed-defect, skipped-audit, and restart-cap mutants while accepting valid repair and tune", async () => {
    const seed = await seedCampaign();
    const version0 = [...seed.packages().keys()][0] ?? "";
    recordHistoricalWitnesses(seed.log, version0, { includeDefect: true, reportComp: true });
    const runner = revisionRunner({
      log: seed.log,
      parentBundle: seed.bundle,
      packages: seed.packages,
      auditor: SOUND_AUDIT,
    });

    const weakenedTune = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "permits earned witness note=bad while keeping reject control note=wrong",
      evaluator: PARENT_EVALUATOR.replace(
        'artifact.n === hidden.target && note === "exact:" + String(hidden.target)',
        '(artifact.n === hidden.target && note === "exact:" + String(hidden.target)) || note === "bad"',
      ),
    });
    const weakRes = await runner({
      session: "x-1",
      kind: "tune",
      why: "too permissive",
      candidate: weakenedTune,
    });
    expect(weakRes.accepted).toBe(false);
    expect(weakRes.message).toContain("no longer fails");
    expect(weakRes.message).not.toContain("s-earned");

    const shiftedTune = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "weakens check-strict on note=bad while adding check-no-bad",
      checks: [
        ...PARENT_DRAFT.checks.map(({ id, rule, assertion }) => ({ id, rule, assertion })),
        { id: "check-no-bad", rule: "R2", assertion: "note is not bad" },
      ],
      evaluator: `
export const checks = {
  "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
  "check-strict": ({ artifact, hidden, files }) => {
    const note = files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "";
    return (artifact.n === hidden.target && note === "exact:" + String(hidden.target)) || note === "bad";
  },
  "check-no-bad": ({ files }) => (files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "") !== "bad",
};
export const scores = {
  accuracy: ({ artifact, hidden }) => Math.max(0, 1 - Math.abs(artifact.score - hidden.ideal) / 10),
  depth: ({ artifact }) => Math.min(1, Math.max(0, artifact.detail / 10)),
};
`,
      add_reject_controls: [
        {
          task: 0,
          answer: { n: 10, score: 10, detail: 9 },
          files: [{ path: NOTE_FILE, text: "bad" }],
          check: "check-no-bad",
        },
      ],
    });
    const shiftedRes = await runner({
      session: "x-1",
      kind: "tune",
      why: "shifts witness blocking check",
      candidate: shiftedTune,
    });
    expect(shiftedRes.accepted).toBe(false);
    expect(shiftedRes.message).toContain("no longer blocked by any untouched check");

    const unfixedRepair = candidateDraft(PARENT_DRAFT, {
      kind: "repair",
      why: "does not fix whitespace",
      check: "check-strict",
      evaluator: `${PARENT_EVALUATOR}\nconst unusedFlag = 1;\n`,
    });
    const unfixedRes = await runner({
      session: "x-1",
      kind: "repair",
      why: "does not fix whitespace",
      check: "check-strict",
      candidate: unfixedRepair,
    });
    expect(unfixedRes.accepted).toBe(false);
    expect(unfixedRes.message).toContain("did not clear any check-defect witness");
    expect(unfixedRes.message).not.toContain("s-defect");

    const fixedEvaluator = PARENT_EVALUATOR.replace(
      'note === "exact:" + String(hidden.target)',
      String.raw`note.trim().replace(/\s+/g, "") === "exact:" + String(hidden.target)`,
    );
    const validTuneCandidate = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "reweight rubric",
      objective_items: [codeItem("accuracy", 2), codeItem("depth", 1)],
    });
    const skipSeed = await seedCampaign({ name: "camp-skip" });
    append(skipSeed.log, "referee.draft", {
      session: "d-1",
      pass: 1,
      verdict: "defects",
      findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "initial draft defect" }],
      summary: "initial",
      probeRows: [],
    });
    append(skipSeed.log, "referee.draft", {
      session: "x-0",
      pass: 1,
      revision: "other-checks-hash",
      verdict: "sound",
      findings: [],
      summary: "other",
      probeRows: [],
    });
    const skipRunner = revisionRunner({
      log: skipSeed.log,
      parentBundle: skipSeed.bundle,
      packages: skipSeed.packages,
      auditor: async () => ({ verdict: "skipped", findings: [], summary: "", probes: [], error: "503" }),
    });
    const skipRes = await skipRunner({
      session: "x-1",
      kind: "tune",
      why: "reweight",
      candidate: validTuneCandidate,
    });
    expect(skipRes.accepted).toBe(false);
    expect(skipRes.message).toContain("audit skipped");

    const auditPasses: number[] = [];
    const failingAudit: RevisionAuditor = async (_reader, target): Promise<DraftAuditFinding> => {
      auditPasses.push(target.pass ?? -1);
      append(target.log, "referee.draft", {
        session: target.session,
        ...keyIfDefined("pass", target.pass),
        ...keyIfDefined("revision", target.revision),
        verdict: "defects",
        findings: [{ kind: "objective-defect", task: "ex-001", item: "depth", probe: 1, reason: "flat" }],
        summary: "defect found",
        probeRows: [],
      });
      return {
        verdict: "defects",
        findings: [{ kind: "objective-defect", task: "ex-001", item: "depth", probe: 1, reason: "flat" }],
        summary: "defect found",
        probes: [],
      };
    };
    const capRunner1 = revisionRunner({
      log: skipSeed.log,
      parentBundle: skipSeed.bundle,
      packages: skipSeed.packages,
      auditor: failingAudit,
    });
    expect(
      (await capRunner1({ session: "x-1", kind: "tune", why: "t1", candidate: validTuneCandidate })).accepted,
    ).toBe(false);
    expect(
      (await capRunner1({ session: "x-1", kind: "tune", why: "t2", candidate: validTuneCandidate })).accepted,
    ).toBe(false);
    const capRunner2 = revisionRunner({
      log: skipSeed.log,
      parentBundle: skipSeed.bundle,
      packages: skipSeed.packages,
      auditor: failingAudit,
    });
    expect(
      (await capRunner2({ session: "x-2", kind: "tune", why: "t3", candidate: validTuneCandidate })).accepted,
    ).toBe(false);
    const fourth = await capRunner2({
      session: "x-2",
      kind: "tune",
      why: "t4",
      candidate: validTuneCandidate,
    });
    expect(fourth.accepted).toBe(false);
    expect(fourth.message).toContain("revision audit cap (3) reached");
    expect(auditPasses).toEqual([1, 2, 3]);

    const cleanPass3Seed = await seedCampaign({ name: "camp-clean-pass3" });
    const cleanParentChecks =
      eventsOf(read(cleanPass3Seed.log), "contract.frozen").at(-1)?.event.data.checks ?? "";
    for (const pass of [1, 2]) {
      append(cleanPass3Seed.log, "referee.draft", {
        session: "x-0",
        pass,
        revision: cleanParentChecks,
        verdict: "defects",
        findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "n=9 passed" }],
        summary: "probe defect",
        probeRows: [
          {
            id: 1,
            task: "ex-001",
            changes: [{ path: "$.n", value: "9", edit: null }],
            original: { kind: "pass" },
            changed: { kind: "pass" },
          },
        ],
      });
    }
    const cleanSeen: { pass: number | undefined; verifiedFixed: number; unverified: number }[] = [];
    const cleanRes = await revisionRunner({
      log: cleanPass3Seed.log,
      parentBundle: cleanPass3Seed.bundle,
      packages: cleanPass3Seed.packages,
      auditor: async (_reader, target) => {
        cleanSeen.push({
          pass: target.pass,
          verifiedFixed: target.verifiedFixed?.length ?? 0,
          unverified: target.priorFindings?.length ?? 0,
        });
        return { verdict: "sound", findings: [], summary: "verified clean fix", probes: [] };
      },
    })({
      session: "x-1",
      kind: "tune",
      why: "clean fix after 2 defect passes",
      candidate: validTuneCandidate,
    });
    expect(cleanRes.accepted).toBe(true);
    expect(cleanSeen).toEqual([{ pass: 3, verifiedFixed: 2, unverified: 0 }]);

    const probeSeed = await seedCampaign({ name: "camp-probe-replay" });
    const probeParentChecks =
      eventsOf(read(probeSeed.log), "contract.frozen").at(-1)?.event.data.checks ?? "";
    append(probeSeed.log, "referee.draft", {
      session: "x-0",
      pass: 1,
      revision: probeParentChecks,
      verdict: "defects",
      findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "still passes" }],
      summary: "probe defect",
      probeRows: [
        {
          id: 1,
          task: "ex-001",
          changes: [{ path: "$.score", value: "5", edit: null }],
          original: { kind: "pass" },
          changed: { kind: "pass" },
        },
      ],
    });
    let probeAuditorRan = false;
    const probeRes = await revisionRunner({
      log: probeSeed.log,
      parentBundle: probeSeed.bundle,
      packages: probeSeed.packages,
      auditor: async () => {
        probeAuditorRan = true;
        return { verdict: "sound", findings: [], summary: "", probes: [] };
      },
    })({ session: "x-1", kind: "tune", why: "replay", candidate: validTuneCandidate });
    expect(probeRes.accepted).toBe(false);
    expect(probeRes.message).toContain("failed prior audit defect probes");
    expect(probeAuditorRan).toBe(false);

    const raceSeed = await seedCampaign({ name: "camp-race" });
    const raceRes = await revisionRunner({
      log: raceSeed.log,
      parentBundle: raceSeed.bundle,
      packages: raceSeed.packages,
      auditor: async () => {
        append(raceSeed.log, "comparison.started", { session: "g-race", old: "starter", fresh: "h1" });
        return { verdict: "sound", findings: [], summary: "ok", probes: [] };
      },
    })({ session: "x-1", kind: "tune", why: "race", candidate: validTuneCandidate });
    expect(raceRes.accepted).toBe(false);
    expect(raceRes.message).toContain("still open");
    expect(eventsOf(read(raceSeed.log), REVISED)).toHaveLength(0);

    const repSeed = await seedCampaign({ name: "camp-rep" });
    const repVersion0 = [...repSeed.packages().keys()][0] ?? "";
    recordHistoricalWitnesses(repSeed.log, repVersion0, { includeDefect: true, reportComp: true });
    const multiDefectFiles = keepAnswerFiles(
      repSeed.log,
      textFiles([{ path: NOTE_FILE, text: "exact: 10\n" }]),
    );
    append(repSeed.log, "solve.started", { solve: "s-defect-multi", comparison: "g-1" });
    append(repSeed.log, "verdict", {
      solve: "s-defect-multi",
      task: "ex-001",
      answer: { n: 13, score: 9, detail: 8 },
      files: multiDefectFiles.map((f) => ({ ...f })),
      kind: "fail",
      blocking: ["check-even", "check-strict"],
    });
    append(repSeed.log, "referee.finding", {
      solve: "s-defect-multi",
      task: "ex-001",
      ruling: "check-defect",
      check: "check-strict",
      reason: "check-strict rejected whitespace alongside odd n",
    });
    const repRunner = revisionRunner({
      log: repSeed.log,
      parentBundle: repSeed.bundle,
      packages: repSeed.packages,
      auditor: SOUND_AUDIT,
    });
    const partialRepair = candidateDraft(PARENT_DRAFT, {
      kind: "repair",
      why: "clears only n=target whitespace, leaves multi-blocking defect uncleared",
      check: "check-strict",
      evaluator: fixedEvaluator,
    });
    const partialRes = await repRunner({
      session: "x-1",
      kind: "repair",
      why: "partial fix",
      check: "check-strict",
      candidate: partialRepair,
    });
    expect(partialRes.accepted).toBe(false);
    expect(partialRes.message).toContain("1/2 check-defect witnesses uncleared");
    const goodRepair = candidateDraft(PARENT_DRAFT, {
      kind: "repair",
      why: "allow whitespace after colon in note.txt",
      check: "check-strict",
      evaluator: fixedEvaluator.replace(
        "artifact.n === hidden.target &&",
        "(artifact.n === hidden.target || artifact.n === 13) &&",
      ),
    });
    const repRes = await repRunner({
      session: "x-1",
      kind: "repair",
      why: "allow whitespace after colon in note.txt",
      check: "check-strict",
      candidate: goodRepair,
    });
    expect(repRes.accepted).toBe(true);
    const revEvent = eventsOf(read(repSeed.log), REVISED).at(-1)?.event.data;
    expect(revEvent?.kind).toBe("repair");
    expect(revEvent?.witnesses).toEqual({
      earnedChecked: 2,
      earnedRetained: 2,
      defectChecked: 2,
      defectCleared: 2,
    });

    const flipSeed = await seedCampaign({ name: "camp-repair-flip" });
    const flipVersion0 = [...flipSeed.packages().keys()][0] ?? "";
    recordHistoricalWitnesses(flipSeed.log, flipVersion0, { includeDefect: true, reportComp: true });
    const flippedFiles = keepAnswerFiles(flipSeed.log, textFiles([{ path: NOTE_FILE, text: "exact: 10" }]));
    append(flipSeed.log, "solve.started", { solve: "s-earned-contradictory", comparison: "g-1" });
    append(flipSeed.log, "verdict", {
      solve: "s-earned-contradictory",
      task: "ex-001",
      answer: { n: 10, score: 9, detail: 8 },
      files: flippedFiles.map((f) => ({ ...f })),
      kind: "fail",
      blocking: ["check-strict"],
    });
    append(flipSeed.log, "referee.finding", {
      solve: "s-earned-contradictory",
      task: "ex-001",
      ruling: "earned",
      check: "check-strict",
      reason: "earlier contradictory ruling on broken check",
    });
    const auditNotes: string[] = [];
    const flipRunner = revisionRunner({
      log: flipSeed.log,
      parentBundle: flipSeed.bundle,
      packages: flipSeed.packages,
      auditor: async (_reader, target) => {
        auditNotes.push(...target.notes);
        return await SOUND_AUDIT(_reader, target);
      },
    });
    const flipRes = await flipRunner({
      session: "x-1",
      kind: "repair",
      why: "fix whitespace on check-strict",
      check: "check-strict",
      candidate: goodRepair,
    });
    expect(flipRes.accepted).toBe(true);
    expect(
      auditNotes.some((note) => note.includes("1 historical earned witness solely on repaired check")),
    ).toBe(true);

    const hitlSeed = await seedCampaign({ name: "camp-hitl", attended: true });
    const parentToolBin = join(hitlSeed.bundle, ".toolchain", "bin");
    mkdirSync(parentToolBin, { recursive: true });
    writeFileSync(join(parentToolBin, "parent-helper"), "#!/bin/sh\necho parent-ok\n");
    chmodSync(join(parentToolBin, "parent-helper"), 0o755);
    writeFileSync(join(hitlSeed.bundle, ".toolchain", HOST_TOOLS_FILE), "stale-host-tools\n");
    const hitlRunner = revisionRunner({
      log: hitlSeed.log,
      parentBundle: hitlSeed.bundle,
      packages: hitlSeed.packages,
      auditor: SOUND_AUDIT,
    });
    const hitlCandidate = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "reweight under hitl while carrying parent verifier tool",
      checks: [
        ...PARENT_DRAFT.checks.map(({ id, rule, assertion }) => ({ id, rule, assertion })),
        {
          id: "check-parent-tool",
          rule: "R1",
          assertion: "n > 0 via parent helper",
          tools: ["parent-helper"],
        },
      ],
      evaluator: `
export const checks = {
  "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
  "check-strict": ({ artifact, hidden, files }) => {
    const note = files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "";
    return artifact.n === hidden.target && note === "exact:" + String(hidden.target);
  },
  "check-parent-tool": async ({ artifact }, runtime) => {
    const res = await runtime.tools.run({ toolId: "parent-helper", args: [] });
    return res.exitCode === 0 && artifact.n > 0;
  },
};
export const scores = {
  accuracy: ({ artifact, hidden }) => Math.max(0, 1 - Math.abs(artifact.score - hidden.ideal) / 10),
  depth: ({ artifact }) => Math.min(1, Math.max(0, artifact.detail / 10)),
};
`,
      objective_items: [codeItem("accuracy", 2), codeItem("depth", 1)],
      add_reject_controls: [
        {
          task: 0,
          answer: { n: -2, score: 10, detail: 9 },
          files: [{ path: NOTE_FILE, text: "exact:10" }],
          check: "check-parent-tool",
        },
      ],
    });
    const hitlRes = await hitlRunner({
      session: "x-1",
      kind: "tune",
      why: "reweight under hitl",
      candidate: hitlCandidate,
    });
    expect(hitlRes.accepted).toBe(false);
    expect(hitlRes.message).toContain("--hitl");
    const smuggledTune = candidateDraft(PARENT_DRAFT, {
      kind: "repair",
      why: "smuggle rubric reweight inside repair",
      check: "check-strict",
      objective_items: [codeItem("accuracy", 3), codeItem("depth", 1)],
    });
    expect(
      revisionFaults(PARENT_DRAFT, smuggledTune, "repair", "check-strict").some((f) =>
        f.includes("repair revision cannot change objective"),
      ),
    ).toBe(true);

    const noOpeningTasks = ungated(
      { tasks: hitlSeed.tasks, pack: (task) => packageOf(hitlSeed.checks, task) },
      [],
    );
    expect(noOpeningTasks.length).toBeGreaterThan(0);

    const hijackSeed = await seedCampaign({ name: "camp-hijack" });
    const hijackVersion0 = [...hijackSeed.packages().keys()][0] ?? "";
    recordHistoricalWitnesses(hijackSeed.log, hijackVersion0, { includeDefect: true, reportComp: true });
    expect(
      (
        await revisionRunner({
          log: hijackSeed.log,
          parentBundle: hijackSeed.bundle,
          packages: hijackSeed.packages,
          auditor: SOUND_AUDIT,
        })({
          session: "x-1",
          kind: "repair",
          why: "allow whitespace",
          check: "check-strict",
          candidate: goodRepair,
        })
      ).accepted,
    ).toBe(true);
    const foreignDir = join(dirname(hijackSeed.dir), "camp-hijack-rev2");
    mkdirSync(foreignDir, { recursive: true });
    append(join(foreignDir, LOG_FILE), "campaign.opened", {
      prompt: "unrelated campaign",
      parent: { campaign: "someone-else", revised: "0".repeat(64), kind: "tune" },
    });
    await expect(openSuccessor(hijackSeed.log)).rejects.toThrow("refusing to adopt existing campaign");
    expect(eventsOf(read(hitlSeed.log), REVISED)).toHaveLength(0);
    const candidateHash = /--candidate\s+([a-f0-9]+)/u.exec(hitlRes.message)?.[1];
    expect(candidateHash).toBeTruthy();
    const candidateFile = join(dirname(hitlSeed.log), "revisions", `${candidateHash ?? ""}.json`);
    const originalCandidateText = readFileSync(candidateFile, "utf8");
    writeFileSync(join(dirname(hitlSeed.log), "escape.json"), originalCandidateText);
    for (const badHash of ["", "dead", "../escape"]) {
      await expect(freezeCandidate(hitlSeed.log, badHash, hitlSeed.packages())).rejects.toThrow(
        "invalid candidate hash",
      );
    }
    await expect(freezeCandidate(hitlSeed.log, "0123456789abcdef", hitlSeed.packages())).rejects.toThrow(
      "no staged revision candidate",
    );
    writeFileSync(candidateFile, originalCandidateText.replace('"accuracy"', '"tampered"'));
    await expect(freezeCandidate(hitlSeed.log, candidateHash ?? "", hitlSeed.packages())).rejects.toThrow(
      "hash mismatch",
    );
    writeFileSync(candidateFile, originalCandidateText);
    const frozenNext = await freezeCandidate(hitlSeed.log, candidateHash ?? "", hitlSeed.packages());
    expect(frozenNext.name).toBe("camp-hitl-rev2");
    expect(await freezeCandidate(hitlSeed.log, candidateHash ?? "", hitlSeed.packages())).toEqual(frozenNext);
    expect(eventsOf(read(hitlSeed.log), REVISED)).toHaveLength(1);
    expect(endedOf(read(hitlSeed.log))?.ending).toBe("revise");

    const missingWitnessSeed = await seedCampaign({ name: "camp-missing-witness" });
    append(missingWitnessSeed.log, "verdict", { solve: "s-ghost", task: "missing-task-hash", kind: "fail" });
    append(missingWitnessSeed.log, "referee.finding", {
      solve: "s-ghost",
      task: "ex-999",
      ruling: "earned",
      check: "check-strict",
      reason: "bad",
    });
    const ghostRes = await revisionRunner({
      log: missingWitnessSeed.log,
      parentBundle: missingWitnessSeed.bundle,
      packages: missingWitnessSeed.packages,
      auditor: SOUND_AUDIT,
    })({
      session: "x-1",
      kind: "tune",
      why: "reweight",
      candidate: validTuneCandidate,
    });
    expect(ghostRes.accepted).toBe(false);
    expect(ghostRes.message).toContain("could not be loaded");
  });

  it("opens successor B idempotently across crash prefixes, carries budget/stopRule/harness/lineage, and enforces 1 tune/epoch", async () => {
    expect(successorName("jobstat-v2")).toBe("jobstat-v2-rev2");
    expect(successorName("jobstat-v2-rev2")).toBe("jobstat-v2-rev3");
    expect(rewriteNameFlag(["--name", "a", "--name", "other", "--budget", "50"], "a", "a-rev2")).toEqual([
      "--name",
      "a-rev2",
      "--name",
      "other",
      "--budget",
      "50",
    ]);
    expect(rewriteNameFlag(["--name=a", "--budget=50"], "a", "a-rev2")).toEqual([
      "--name=a-rev2",
      "--budget=50",
    ]);

    const seed = await seedCampaign({ name: "lin-a" });
    const writtenTask = {
      taskId: "x-1-001",
      family: "f1",
      publicInput: { prompt: "sixteen" },
      hidden: { target: 16, ideal: 10 },
    };
    const writtenVersion = taskVersion(packageOf(seed.checks, writtenTask));
    append(seed.log, "task.proposed", {
      version: writtenVersion,
      taskId: "x-1-001",
      session: "x-1",
      task: writtenTask,
    });
    append(seed.log, "task.gate", { version: writtenVersion, gate: 1, outcome: "passed" });
    append(seed.log, "build.finished", {
      session: "b-1",
      harness: "h-carried",
      changed: true,
      ended: "finished",
      billed: 12.5,
    });
    append(seed.log, "comparison.started", {
      session: "g-1",
      old: "starter",
      fresh: "h-carried",
      starter: "starter",
    });
    append(seed.log, "comparison.reported", {
      session: "g-1",
      old: "starter",
      fresh: "h-carried",
      starter: "starter",
      versions: [writtenVersion],
      reading: "no-step",
      scored: { wins: 0, losses: 1, ties: 0 },
      frontier: { wins: 0, losses: 1, ties: 0 },
      valid: { old: [1, 0], fresh: [1, 0], informative: { old: 1, fresh: 1 } },
      aside: [],
    });

    const binDir = join(seed.dir, "examiner-home", ".toolchain", "bin");
    mkdirSync(binDir, { recursive: true });
    const helperPath = join(binDir, "my-helper");
    writeFileSync(helperPath, "#!/bin/sh\necho ok\n");
    chmodSync(helperPath, 0o755);

    const tuneCandidate = candidateDraft(PARENT_DRAFT, {
      kind: "tune",
      why: "add range check and reweight",
      checks: [
        ...PARENT_DRAFT.checks.map(({ id, rule, assertion }) => ({ id, rule, assertion })),
        { id: "check-positive", rule: "R1", assertion: "n is strictly positive", tools: ["my-helper"] },
      ],
      evaluator: `
export const checks = {
  "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
  "check-strict": ({ artifact, hidden, files }) => {
    const note = files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "";
    return artifact.n === hidden.target && note === "exact:" + String(hidden.target);
  },
  "check-positive": async ({ artifact }, runtime) => {
    const res = await runtime.tools.run({ toolId: "my-helper", args: [] });
    return res.exitCode === 0 && artifact.n > 0;
  },
};
export const scores = {
  accuracy: ({ artifact, hidden }) => Math.max(0, 1 - Math.abs(artifact.score - hidden.ideal) / 10),
  depth: ({ artifact }) => Math.min(1, Math.max(0, artifact.detail / 10)),
};
`,
      objective_items: [codeItem("accuracy", 1.5), codeItem("depth", 1)],
      add_reject_controls: [
        {
          task: 0,
          answer: { n: -2, score: 10, detail: 9 },
          files: [{ path: NOTE_FILE, text: "exact:10" }],
          check: "check-positive",
        },
      ],
    });
    const parentEvalBefore = readFileSync(join(seed.checks, "evaluator.ts"), "utf8");
    const runner = revisionRunner({
      log: seed.log,
      parentBundle: seed.bundle,
      packages: seed.packages,
      auditor: SOUND_AUDIT,
    });
    const res = await runner({
      session: "x-1",
      kind: "tune",
      why: "add range check and reweight",
      candidate: tuneCandidate,
      home: join(seed.dir, "examiner-home"),
    });
    expect(res.accepted).toBe(true);
    expect(readFileSync(join(seed.checks, "evaluator.ts"), "utf8")).toBe(parentEvalBefore);

    const next1 = await openSuccessor(seed.log);
    const fullB = readFileSync(next1.log, "utf8").trim().split("\n");
    for (const keepLines of [1, 2, 3, fullB.length - 1]) {
      writeFileSync(next1.log, `${fullB.slice(0, keepLines).join("\n")}\n`);
      const recovered = await openSuccessor(seed.log);
      expect(recovered).toEqual(next1);
    }
    const next2 = await openSuccessor(seed.log);
    expect(next1).toEqual(next2);
    expect(next1.name).toBe("lin-a-rev2");

    const eventsA = read(seed.log);
    expect(endedOf(eventsA)?.ending).toBe("revise");
    expect(eventsOf(eventsA, "campaign.ended").at(-1)?.event.data.successor).toBe("lin-a-rev2");

    const eventsB = read(next1.log);
    expect(eventsOf(eventsB, "campaign.opened")).toHaveLength(1);
    expect(eventsOf(eventsB, "campaign.setting")).toHaveLength(1);
    expect(eventsOf(eventsB, "exam.drafted")).toHaveLength(1);
    expect(eventsOf(eventsB, "contract.frozen")).toHaveLength(1);
    const openingB = openingOf(eventsB);
    expect(openingB?.parent?.campaign).toBe("lin-a");
    expect(openingB?.parent?.kind).toBe("tune");
    expect(openingB?.parent?.carried.spent).toBeCloseTo(12.5, 4);
    expect(openingB?.parent?.carried.sinceStep).toBe(1);
    expect(openingB?.parent?.carried.attempts).toBe(1);
    expect(openingB?.parent?.carried.tunes).toBe(1);
    expect(openingB?.parent?.carried.tunedThisEpoch).toBe(true);
    expect(openingB?.parent?.lineageTasks).toContain(contentOf(writtenTask));
    expect(budgetLeft(eventsB)?.dollars).toBeCloseTo(37.5, 4);
    expect(stopRule(eventsB).sinceStep).toBe(1);
    const riskTextB = riskLines(eventsB).join("\n");
    expect(riskTextB).toContain("Carried from parent lineage");
    expect(riskTextB).toContain("across all epochs: 2.0%");
    expect(latestBuilt(eventsB)).toBeTruthy();
    expect(promoted(eventsB)).toBeNull();
    expect(existsSync(join(dirname(next1.log), "memory", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(dirname(next1.log), "examiner-home", "gen.py"))).toBe(true);
    expect(lastLaunch(next1.log)?.flags).toContain("lin-a-rev2");

    expect(ungated({ tasks: seed.tasks, pack: (task) => packageOf(seed.checks, task) }, eventsB)).toEqual([]);

    expect(rewriteMovesFlag(["--name", "a", "--moves", "3", "--budget", "50"], 1)).toEqual([
      "--name",
      "a",
      "--moves",
      "1",
      "--budget",
      "50",
    ]);
    expect(rewriteMovesFlag(["--name=a", "--moves=3"], 0)).toEqual(["--name=a", "--moves=0"]);
    expect(rewriteMovesFlag(["--name", "a", "--moves", "3"], Number.POSITIVE_INFINITY)).toEqual([
      "--name",
      "a",
      "--moves",
      "3",
    ]);
    await expect(openSuccessor(next1.log)).rejects.toThrow("no valid exam.revised");
    expect(revisionRefusal(eventsB, { kind: "tune" })).toContain("already opened from a rubric tune");
    const repairChildLog = join(dirname(seed.dir), "lin-a-rev3", LOG_FILE);
    mkdirSync(dirname(repairChildLog), { recursive: true });
    for (const ev of eventsB) {
      if (ev.kind === "campaign.opened") {
        append(repairChildLog, OPENED, {
          ...ev.data,
          parent: {
            campaign: "lin-a-rev2",
            revised: "deadbeef",
            kind: "repair",
            carried: { spent: 12.5, sinceStep: 1, attempts: 1, tunes: 1, tunedThisEpoch: true },
            lineageTasks: [],
          },
        });
      } else {
        append(repairChildLog, ev.kind, ev.data);
      }
    }
    expect(revisionRefusal(read(repairChildLog), { kind: "tune" })).toContain(
      "already opened from a rubric tune",
    );
    append(next1.log, "harness.promoted", { harness: "h-b1", from: "starter" });
    expect(stopRule(read(next1.log)).sinceStep).toBe(0);
    append(next1.log, "comparison.started", {
      session: "g-s",
      old: "h-b1",
      fresh: "starter",
      starter: "starter",
    });
    append(next1.log, "comparison.reported", {
      session: "g-s",
      old: "h-b1",
      fresh: "starter",
      starter: "starter",
      level: 0.05,
      reading: "no-step",
      scored: { differences: [-1, -1, -1, -1, -1, -1] },
      valid: { old: [0, 0, 6], fresh: [6, 0, 0], informative: { old: 6, fresh: 6 } },
      aside: [],
    });
    expect(revisionRefusal(read(next1.log), { kind: "tune" })).toBeNull();
    expect(draftOf(eventsB)?.checks.some(({ id }) => id === "check-positive")).toBe(true);

    expect(replayed(seed.log)).toContain("revised (tune)");
    expect(replayed(next1.log)).toContain("from lin-a (tune)");
    const badParentLog = join(dirname(seed.dir), "lin-bad-rev2", LOG_FILE);
    mkdirSync(dirname(badParentLog), { recursive: true });
    append(badParentLog, OPENED, {
      project: "demo",
      parent: {
        campaign: "lin-a",
        revised: "wrong-hash",
        kind: "tune",
        carried: { spent: 0, sinceStep: 0, attempts: 0, tunes: 1 },
        lineageTasks: [],
      },
    });
    expect(() => replayed(badParentLog)).toThrow("disagrees with successor opening");
    const revHashA = eventsOf(eventsA, REVISED).at(-1)?.event.data.draftHash ?? "";
    append(badParentLog, OPENED, {
      project: "demo",
      parent: {
        campaign: "lin-a",
        revised: revHashA,
        kind: "tune",
        carried: { spent: 0, sinceStep: 0, attempts: 0, tunes: 1 },
        lineageTasks: [],
      },
    });
    expect(() => replayed(badParentLog)).toThrow("names successor lin-a-rev2, not lin-bad-rev2");

    expect(EVENT_FORMATTERS["exam.revised"]?.({ kind: "tune", why: "reweight" })).toContain(
      "exam revised (tune): reweight",
    );
    expect(
      EVENT_FORMATTERS["campaign.ended"]?.({ ending: "revise", successor: "lin-a-rev2", why: "reweight" }),
    ).toContain("-> lin-a-rev2");
    expect(
      triggerOf({
        live: false,
        promotions: 0,
        compared: 1,
        allTied: false,
        ending: "revise",
        hours: 1,
      }),
    ).toBeNull();

    const gaming = gamingRows([
      ...eventsA,
      {
        at: "2026-11-26T00:00:00.000Z",
        kind: "exam.call",
        data: { session: "x-1", tool: "read_reviews", args: {} },
      },
      {
        at: "2026-11-26T00:00:00.500Z",
        kind: "exam.call",
        data: { session: "x-1", tool: "propose_tasks", args: {} },
      },
      {
        at: "2026-11-26T00:00:01.000Z",
        kind: "exam.call",
        data: { session: "x-1", tool: "revise_exam", args: {} },
      },
    ]).join("\n");
    expect(gaming).toContain("read_reviews 1, revise_exam 1, revised (tune, max weight delta 0.50)");
  });

  it("exposes read_exam and revise_exam in writing sessions, rejects lineage duplicates, and ends stands on revision", async () => {
    const dupTask = { family: "fixture", public_input: { base: 7 }, hidden: { seed: 1 } };
    const dupHash = contentOf({ family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } });
    const s = seat("write", [
      call("propose_tasks", { tasks: [dupTask] }),
      call("read_exam", {}),
      call("revise_exam", { kind: "tune", why: "noop rejected by faults" }),
      call("revise_exam", {
        kind: "tune",
        why: "first try refused by runner",
        objective_items: [
          { id: "accuracy", weight: 2, kind: "code" },
          { id: "depth", weight: 1, kind: "code" },
        ],
      }),
      call("revise_exam", {
        kind: "tune",
        why: "adjust item weights",
        objective_items: [
          { id: "accuracy", weight: 2, kind: "code" },
          { id: "depth", weight: 1, kind: "code" },
        ],
      }),
      finish,
    ]);
    append(s.request.log, OPENED, {
      project: "demo",
      seats: {
        builder: null,
        examiner: null,
        reviewer: { model: "openai-codex/gpt-6.1-sol", effort: "high" },
      },
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      parent: {
        campaign: "parent-a",
        revised: "deadbeef",
        kind: "tune",
        carried: { spent: 0, sinceStep: 0, attempts: 0, tunes: 1 },
        lineageTasks: [dupHash],
      },
      prompt: "test",
    });
    append(s.request.log, "exam.drafted", {
      session: "d-1",
      draft: parseJsonAs<JsonObject>(capturedJsonStringify(PARENT_DRAFT)),
    });
    const runnerCalls: string[] = [];
    const result = await examine({
      ...s.request,
      revise: async ({ kind, why }) => {
        runnerCalls.push(`${kind}:${why}`);
        if (why.startsWith("first try")) return { accepted: false, message: "Refused: try again." };
        return { accepted: true, message: "Revision accepted." };
      },
    });
    expect(result.ended).toBe("stands");
    expect(result.held).toEqual([]);
    expect(runnerCalls).toEqual(["tune:first try refused by runner", "tune:adjust item weights"]);
    expect(systemPrompt(undefined, "fixed")).not.toContain("revise_exam");
    expect(systemPrompt(undefined, "revisable")).toContain("revise_exam");
  });

  it("drives check-defects direct repair examine and seamless A -> B handoff in harnessBuilder", async () => {
    const name = `test-rev-hb-${String(runtimeProcess.pid)}`;
    const nextName = successorName(name);
    const campRoot = join(REPO, ".ana", "d2");
    ROOTS.push(join(campRoot, name), join(campRoot, nextName));
    rmSync(join(campRoot, name), { recursive: true, force: true });
    rmSync(join(campRoot, nextName), { recursive: true, force: true });

    const dir = join(campRoot, name);
    const log = join(dir, LOG_FILE);
    mkdirSync(dir, { recursive: true });
    append(log, OPENED, {
      project: "demo",
      budget: { dollars: 50, reserve: 1 },
      patience: 6,
      seats: {
        builder: { model: OPUS, effort: "high" },
        examiner: { model: OPUS, effort: "high" },
        reviewer: { model: "openai-codex/gpt-6.1-sol", effort: "high" },
      },
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      prompt: "test domain",
      terms: { level: "0.05", practice: "0" },
    });
    append(log, "campaign.setting", {
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      minutes: 10,
      modelTurns: 10,
      target: 8,
      solves: 1,
    });
    const draftObj = parseJsonAs<JsonObject>(capturedJsonStringify(PARENT_DRAFT));
    append(log, "exam.drafted", { session: "d-1", draft: draftObj });
    const { faults, read: seen } = await draftReading(dir, PARENT_DRAFT, 4);
    expect(faults).toEqual([]);
    if (seen === undefined) throw new Error("expected draft reading");
    keepReading(log, seen.checker, seen.reading, {
      admitted: new Set(),
      authored: true,
      judge: false,
      freeze: true,
      despite: "",
    });
    const task0 = PARENT_DRAFT.tasks[0];
    if (task0 === undefined) throw new Error("expected parent task");
    const numberedTask0 = { taskId: "ex-001", ...task0 };
    const v0 = taskVersion(packageOf(seen.checks, numberedTask0));
    append(log, "task.proposed", { version: v0, taskId: "ex-001", session: "x-0", task: numberedTask0 });
    append(log, "task.gate", { version: v0, gate: 1, outcome: "passed" });
    append(log, "build.checkpoint", { session: "b-1", harness: "h1" });
    recordHistoricalWitnesses(log, v0, { includeDefect: true, reportComp: false });
    append(log, "comparison.reported", {
      session: "g-1",
      old: "starter",
      fresh: "h1",
      starter: "starter",
      level: 0.05,
      reading: "check-defects",
      versions: [v0],
      scored: null,
      aside: [],
    });

    const fixedEvaluator = PARENT_EVALUATOR.replace(
      'note === "exact:" + String(hidden.target)',
      String.raw`note.trim().replace(/\s+/g, "") === "exact:" + String(hidden.target)`,
    );
    const repairSession = seat("write", [
      call("read_exam", {}),
      call("revise_exam", {
        kind: "repair",
        why: "allow whitespace after colon in note.txt",
        check: "check-strict",
        evaluator: fixedEvaluator,
      }),
      finish,
    ]);
    const handoverDir = join(tempDir("ana-rev-handover-"), "out");
    let examineCalls = 0;
    const ended = await harnessBuilder(
      ["--name", name, "--moves", "1", "--practice", "0", "--handover", handoverDir],
      {
        seated: () => ({
          builder: null,
          setting: "scripted",
          solve: async () => {
            throw new Error("unexpected solve");
          },
        }),
        examine: async (request, wall) => {
          examineCalls += 1;
          return await examine(
            { ...request, model: repairSession.request.model, models: repairSession.request.models },
            wall,
          );
        },
        audit: SOUND_AUDIT,
      },
    );
    const eventsA = read(log);
    expect(eventsOf(eventsA, "exam.finished").at(-1)?.event.data.crash).toBeNull();
    expect(ended).toMatchObject({ move: "end", ending: "revise" });
    expect(existsSync(join(handoverDir, "REPORT.md"))).toBe(true);
    expect(examineCalls).toBe(1);
    expect(eventsOf(eventsA, "build.started")).toHaveLength(0);
    expect(eventsOf(eventsA, REVISED)).toHaveLength(1);
    expect(endedOf(eventsA)?.ending).toBe("revise");
    expect(eventsOf(eventsA, "campaign.ended").at(-1)?.event.data.successor).toBe(nextName);
    const logB = join(campRoot, nextName, LOG_FILE);
    expect(existsSync(logB)).toBe(true);
    const eventsB = read(logB);
    expect(openingOf(eventsB)?.parent?.campaign).toBe(name);
    expect(openingOf(eventsB)?.parent?.kind).toBe("repair");
    expect(openingOf(eventsB)?.parent?.carried.tunedThisEpoch).toBe(false);
    expect(eventsOf(eventsB, "contract.frozen")).toHaveLength(1);
    expect(replayed(logB)).toContain(`from ${name} (repair)`);

    const noReviseFlagName = `test-no-revise-flag-${String(runtimeProcess.pid)}`;
    const noReviseDir = join(campRoot, noReviseFlagName);
    ROOTS.push(noReviseDir);
    rmSync(noReviseDir, { recursive: true, force: true });
    mkdirSync(noReviseDir, { recursive: true });
    const noReviseLog = join(noReviseDir, LOG_FILE);
    append(noReviseLog, OPENED, {
      project: "demo",
      budget: { dollars: 50, reserve: 1 },
      patience: 6,
      seats: {
        builder: { model: OPUS, effort: "high" },
        examiner: { model: OPUS, effort: "high" },
        reviewer: { model: "openai-codex/gpt-6.1-sol", effort: "high" },
      },
      revise: false,
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      prompt: "test domain",
      terms: { level: "0.05", practice: "0" },
    });
    append(noReviseLog, "campaign.setting", {
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      minutes: 10,
      modelTurns: 10,
      target: 8,
      solves: 1,
    });
    append(noReviseLog, "exam.drafted", { session: "d-1", draft: draftObj });
    const noRevRead = await draftReading(noReviseDir, PARENT_DRAFT, 4);
    if (noRevRead.read === undefined) throw new Error("expected noRevRead");
    keepReading(noReviseLog, noRevRead.read.checker, noRevRead.read.reading, {
      admitted: new Set(),
      authored: true,
      judge: false,
      freeze: true,
      despite: "",
    });
    const sawReviseInExamine: boolean[] = [];
    const noRevSeat = seat("write", [finish]);
    const noRevBuilder = seat("write", [finish]);
    await harnessBuilder(["--name", noReviseFlagName, "--moves", "2", "--practice", "0"], {
      seated: () => ({
        builder: { model: noRevBuilder.request.model, models: noRevBuilder.request.models },
        setting: "scripted",
        solve: async () => {
          throw new Error("unexpected solve");
        },
      }),
      examine: async (request, wall) => {
        sawReviseInExamine.push(request.revise !== undefined);
        return await examine(
          { ...request, model: noRevSeat.request.model, models: noRevSeat.request.models },
          wall,
        );
      },
    });
    expect(sawReviseInExamine).toEqual([false]);

    const noRevName = `test-rev-audit-guard-${String(runtimeProcess.pid)}`;
    const noRevDir = join(campRoot, noRevName);
    ROOTS.push(noRevDir);
    rmSync(noRevDir, { recursive: true, force: true });
    mkdirSync(noRevDir, { recursive: true });
    const noRevLog = join(noRevDir, LOG_FILE);
    append(noRevLog, OPENED, {
      project: "demo",
      budget: { dollars: 50, reserve: 1 },
      patience: 6,
      seats: {
        builder: { model: OPUS, effort: "high" },
        examiner: { model: OPUS, effort: "high" },
        reviewer: null,
      },
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
      prompt: "test domain",
      terms: { level: "0.05", practice: "0" },
    });
    append(noRevLog, "exam.drafted", { session: "d-1", draft: draftObj });
    const guardRead = await draftReading(noRevDir, PARENT_DRAFT, 4);
    if (guardRead.read === undefined) throw new Error("expected guard reading");
    keepReading(noRevLog, guardRead.read.checker, guardRead.read.reading, {
      admitted: new Set(),
      authored: true,
      judge: false,
      freeze: true,
      despite: "",
    });
    const guardSeat = seat("write", [
      call("revise_exam", {
        kind: "tune",
        why: "attempt without reviewer",
        objective_items: [
          { id: "accuracy", weight: 2, kind: "code" },
          { id: "depth", weight: 1, kind: "code" },
        ],
      }),
      finish,
      finish,
    ]);
    await examineCommand(
      ["--name", noRevName, "--session", "x-1", "--examiner", "claude/claude-opus-5-5"],
      (request, wall) =>
        examine({ ...request, model: guardSeat.request.model, models: guardSeat.request.models }, wall),
    );
    expect(eventsOf(read(noRevLog), REVISED)).toHaveLength(0);
  });
});

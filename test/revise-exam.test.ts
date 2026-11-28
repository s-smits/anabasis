import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import type { DraftAuditFinding } from "../src/audit/draft-audit.ts";
import { stopRule } from "../src/campaign/admission.ts";
import { riskLines } from "../src/campaign/climb.ts";
import { budgetLeft, openingOf } from "../src/campaign/opening.ts";
import { nextAction } from "../src/campaign/scheduler.ts";
import { type Draft, draftOf } from "../src/examiner/draft.ts";
import { systemPrompt } from "../src/examiner/prompt.ts";
import { candidateDraft, revisionFaults } from "../src/examiner/revise.ts";
import { examine } from "../src/examiner/session.ts";
import { writeStarter } from "../src/harness/starter.ts";
import { keepAnswerFiles, textFiles } from "../src/kernel/answer-files.ts";
import { contentOf } from "../src/kernel/history.ts";
import { append, eventsOf, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { endedOf, latestBuilt, promoted } from "../src/kernel/reports.ts";
import { taskVersion } from "../src/kernel/task.ts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { hashJsonValue, requireJsonValue } from "../src/meta/stable-json.ts";
import { REPO } from "../tools/campaign/campaign.ts";
import { draftReading } from "../tools/campaign/exam.ts";
import { harnessBuilder } from "../tools/campaign/harness-builder.ts";
import { ungated } from "../tools/campaign/prepare.ts";
import {
  freezeCandidate,
  openSuccessor,
  revisionRunner,
  successorName,
  withFlag,
} from "../tools/campaign/revise.ts";
import { keepReading } from "../tools/eval/accept.ts";
import { type DraftAuditor, draftAuditReader } from "../tools/eval/draft.ts";
import { examineCommand } from "../tools/eval/examine.ts";
import { packageOf } from "../tools/m0/stored-sweep.ts";
import { lastLaunch, writeReceipt } from "../tools/runs/receipt.ts";
import { triggerOf } from "../tools/runs/summary.ts";
import { gamingRows } from "../tools/wri/gaming.ts";
import { call, finish, seat, sweep } from "./helpers/examiner-seat.ts";

setDefaultTimeout(120_000);

const NOTE_FILE = "note.txt";
const OPENED = "campaign.opened" as const;
const REVISED = "exam.revised" as const;
const STARTED = "comparison.started" as const;
const OPUS = "claude/claude-opus-5-5";
const CROSS = "openai-codex/gpt-6.1-sol";
const SONNET = "claude/claude-sonnet-5-5";
const READER = draftAuditReader({ reviewer: CROSS }, null);
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

const SCORES = `
export const scores = {
  accuracy: ({ artifact, hidden }) => Math.max(0, 1 - Math.abs(artifact.score - hidden.ideal) / 10),
  depth: ({ artifact }) => Math.min(1, Math.max(0, artifact.detail / 10)),
};
`;
const STRICT = `({ artifact, hidden, files }) => {
    const note = files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "";
    return artifact.n === hidden.target && note === "exact:" + String(hidden.target);
  }`;
const evaluatorWith = (strict: string, extra = "") => `
export const checks = {
  "check-even": ({ artifact }) => Number.isInteger(artifact.n) && artifact.n % 2 === 0,
  "check-strict": ${strict},${extra}
};
${SCORES}`;
const PARENT_EVALUATOR = evaluatorWith(STRICT);
const FIXED_EVALUATOR = PARENT_EVALUATOR.replace(
  'note === "exact:" + String(hidden.target)',
  String.raw`note.trim().replace(/\s+/g, "") === "exact:" + String(hidden.target)`,
);
const answer = (n: number, note: string, task = 0) => ({
  task,
  answer: { n, score: 10, detail: 9 },
  files: [{ path: NOTE_FILE, text: note }],
});

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
    properties: { n: { type: "integer" }, score: { type: "number" }, detail: { type: "number" } },
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
    items: [codeItem("accuracy", 1), codeItem("depth", 1)],
  },
  tasks: [
    { family: "f1", publicInput: { prompt: "ten" }, hidden: { target: 10, ideal: 10 } },
    { family: "f1", publicInput: { prompt: "twelve" }, hidden: { target: 12, ideal: 10 } },
    { family: "f2", publicInput: { prompt: "fourteen" }, hidden: { target: 14, ideal: 10 } },
  ],
  accept: [answer(10, "exact:10"), answer(12, "exact:12", 1), answer(14, "exact:14", 2)],
  reject: [
    { ...answer(11, "exact:10"), check: "check-even" },
    { ...answer(8, "wrong"), check: "check-strict" },
  ],
};
const rubric = (
  ...items: readonly (
    | { id: string; weight: number; kind: "code" }
    | { id: string; weight: number; kind: "judge"; criterion: string }
  )[]
) => ({
  objective: { quantity: "composite rubric quality", direction: "higher" as const, items: [...items] },
});
const KEPT_CHECKS = PARENT_DRAFT.checks.map(({ id, rule, assertion }) => ({ id, rule, assertion }));
const TUNE = candidateDraft(PARENT_DRAFT, {
  why: "reweight rubric",
  ...rubric(codeItem("accuracy", 2), codeItem("depth", 1)),
});
const TUNE_INPUT = { session: "x-1", why: "reweight", repair: undefined, candidate: TUNE, home: undefined };

const GOOD_REPAIR = candidateDraft(PARENT_DRAFT, {
  why: "allow whitespace after colon in note.txt",
  repair: "check-strict",
  evaluator: FIXED_EVALUATOR.replace(
    "artifact.n === hidden.target &&",
    "(artifact.n === hidden.target || artifact.n === 13) &&",
  ),
});

const auditing =
  (verdict: DraftAuditFinding["verdict"], findings: DraftAuditFinding["findings"] = []): DraftAuditor =>
  async (_reader, target) => {
    append(target.log, "referee.draft", {
      session: target.session,
      ...keyIfDefined("pass", target.pass),
      ...keyIfDefined("revision", target.revision),
      verdict,
      findings: requireJsonValue(findings),
      summary: verdict,
      probeRows: [],
    });
    return { verdict, findings, summary: verdict, probes: [] };
  };
const SOUND_AUDIT = auditing("sound");
const FLAT = [{ kind: "objective-defect", task: "ex-001", item: "depth", probe: 1, reason: "flat" }] as const;
const ADMITTED: DraftAuditor = async () => ({
  verdict: "defects",
  findings: [...FLAT],
  summary: "",
  probes: [],
});

type Seed = Awaited<ReturnType<typeof seedCampaign>>;

async function seedCampaign(opts?: {
  readonly name?: string;
  readonly revise?: boolean;
  readonly attended?: boolean;
  readonly reviewer?: string;
  readonly budget?: { readonly dollars: number; readonly reserve: number };
}) {
  const name = opts?.name ?? "camp-a";
  const dir = join(tempDir("ana-rev-camp-"), name);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, LOG_FILE);
  append(log, OPENED, {
    project: "demo",
    budget: opts?.budget ?? { dollars: 50, reserve: 3 },
    patience: 6,
    seats: {
      builder: { model: OPUS, effort: "high" },
      examiner: { model: OPUS, effort: "high" },
      reviewer: { model: opts?.reviewer ?? CROSS, effort: "high" },
    },
    judged: true,
    ...keysIf(opts?.revise === false, () => ({ revise: false })),
    ...keysIf(opts?.attended === true, () => ({ attended: true })),
    prompt: "Build an even-target exam.",
    solver: { model: SONNET, effort: "high" },
    terms: { level: "0.02", practice: "6" },
  });
  append(log, "campaign.setting", {
    solver: SONNET,
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
  const word = { admitted: new Set<string>(), authored: true, judge: false, freeze: true, despite: "" };
  keepReading(log, staged.read.checker, staged.read.reading, word);
  const { checks, tasks } = staged.read;
  const packages = () =>
    new Map(
      tasks.map((task) => {
        const packaged = packageOf(checks, task);
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
  const runner = (auditor: DraftAuditor | null, reader = READER) =>
    revisionRunner({ log, parentBundle: join(dirname(checks), "bundle"), packages, reader, auditor });
  const version0 = [...packages().keys()][0] ?? "";
  return { dir, log, checks, tasks, packages, runner, version0 };
}

function witness(
  log: string,
  solve: string,
  given: { n: number; note: string; blocking: string[]; ruling: string; check?: string },
) {
  const files = keepAnswerFiles(log, textFiles([{ path: NOTE_FILE, text: given.note }]));
  append(log, "solve.started", { solve, comparison: "g-1" });
  append(log, "verdict", {
    solve,
    task: "ex-001",
    answer: { n: given.n, score: 5, detail: 5 },
    files: files.map((f) => ({ ...f })),
    kind: "fail",
    blocking: given.blocking,
  });
  append(log, "referee.finding", {
    solve,
    task: "ex-001",
    ruling: given.ruling,
    ...keyIfDefined("check", given.check),
    reason: `${given.ruling} ruling`,
  });
}

function recordWitnesses(seed: Seed, opts: { readonly report: boolean }) {
  append(seed.log, STARTED, { session: "g-1", old: "starter", fresh: "h1", starter: "starter" });
  witness(seed.log, "s-earned-strict", { n: 8, note: "bad", blocking: ["check-strict"], ruling: "earned" });
  const even = { n: 11, note: "exact:10", blocking: ["check-even", "check-strict"], ruling: "earned" };
  witness(seed.log, "s-earned-even", { ...even, check: "check-even" });
  const defect = { n: 10, note: "exact: 10\n", blocking: ["check-strict"], ruling: "check-defect" };
  witness(seed.log, "s-defect-strict", { ...defect, check: "check-strict" });
  witness(seed.log, "s-earned-format", { n: 10, note: "exact:10", blocking: [], ruling: "earned" });
  if (opts.report) report(seed.log, "g-1", { old: "starter", fresh: "h1", reading: "no-step" });
}

function report(log: string, session: string, how: { old: string; fresh: string; reading: string }) {
  append(log, "comparison.reported", {
    session,
    ...how,
    starter: "starter",
    level: 0.05,
    scored: { differences: [1, 1, 1, 1, 1, 1] },
    valid: { old: [6, 0, 0], fresh: [0, 0, 6], informative: { old: 6, fresh: 6 } },
    aside: [],
  });
}

const tryRevise = async (seed: Seed, repair?: string, auditor: DraftAuditor | null = ADMITTED) =>
  await seed.runner(auditor)({
    session: "x-1",
    why: "w",
    repair,
    candidate: repair === undefined ? TUNE : GOOD_REPAIR,
    home: undefined,
  });

describe("revision faults, refusals, and the log lock", () => {
  it("keeps inherited checks and makes a repair touch only its check program", () => {
    const [even, strict] = KEPT_CHECKS;
    if (even === undefined || strict === undefined) throw new Error("missing fixture checks");
    const cases: readonly [string, Draft, string | undefined, string][] = [
      ["no-op", candidateDraft(PARENT_DRAFT, { why: "w" }), undefined, "makes no change"],
      [
        "dropped",
        candidateDraft(PARENT_DRAFT, { why: "w", checks: [even] }),
        undefined,
        "check-strict must stay",
      ],
      [
        "assertion",
        candidateDraft(PARENT_DRAFT, { why: "w", checks: [even, { ...strict, assertion: "weaker" }] }),
        undefined,
        "check-strict must stay",
      ],
      [
        "rule",
        candidateDraft(PARENT_DRAFT, { why: "w", checks: [even, { ...strict, rule: "R1" }] }),
        undefined,
        "enforcing R2",
      ],
      ["repair reweights", TUNE, "check-strict", "is a tune"],
      [
        "repair adds a check",
        candidateDraft(PARENT_DRAFT, {
          why: "w",
          checks: [...KEPT_CHECKS, { id: "check-extra", rule: "R1", assertion: "extra" }],
        }),
        "check-strict",
        "is a tune",
      ],
    ];
    for (const [label, candidate, repair, fault] of cases) {
      const faults = revisionFaults(PARENT_DRAFT, candidate, repair, "judged");
      expect([label, faults.some((one) => one.includes(fault))]).toEqual([label, true]);
    }
    expect(revisionFaults(PARENT_DRAFT, TUNE, undefined, "judged")).toEqual([]);
    expect(revisionFaults(PARENT_DRAFT, GOOD_REPAIR, "check-strict", "judged")).toEqual([]);
    const judged = candidateDraft(PARENT_DRAFT, {
      why: "w",
      ...rubric(codeItem("accuracy", 1), {
        id: "clarity",
        weight: 1,
        kind: "judge",
        criterion: "Reports methodology and assumptions clearly.",
      }),
    });
    expect(revisionFaults(PARENT_DRAFT, judged, undefined, "code-only").join("\n")).toContain("first-party");
    expect(revisionFaults(PARENT_DRAFT, judged, undefined, "judged")).toEqual([]);
    const tools = (given: string[]) =>
      candidateDraft(PARENT_DRAFT, { why: "w", objective: { ...rubric().objective, tools: given } })
        .objectiveTools;
    expect([tools([]), tools(["helper"])]).toEqual([undefined, ["helper"]]);
  });

  it("refuses at unsettled boundaries and admits a repair while starter confirmation is owed", async () => {
    const seed = await seedCampaign();
    recordWitnesses(seed, { report: false });
    expect((await tryRevise(seed)).message).toContain("Refused: a comparison is still open");
    report(seed.log, "g-1", { old: "starter", fresh: "h1", reading: "step" });
    expect((await tryRevise(seed)).message).toContain("Refused: a promotion is pending");
    append(seed.log, "harness.promoted", { harness: "h1", from: "starter" });
    expect((await tryRevise(seed)).message).toContain(
      "Refused: the reference has not confirmed against the starter",
    );
    expect((await tryRevise(seed, "check-strict")).message).toContain("Revision failed adversarial audit");
    expect((await tryRevise(seed, "check-even")).message).toContain(
      "Refused: no standing check-defect ruling names check-even",
    );

    const revert = await seedCampaign({ name: "camp-revert" });
    append(revert.log, "harness.promoted", { harness: "h1", from: "starter" });
    append(revert.log, STARTED, {
      session: "g-rev",
      old: "h1",
      fresh: "starter",
      starter: "starter",
    });
    report(revert.log, "g-rev", { old: "h1", fresh: "starter", reading: "step" });
    expect((await tryRevise(revert)).message).toContain(
      "Refused: the reference has not confirmed against the starter",
    );

    const exact = await seedCampaign({ budget: { dollars: 3, reserve: 3 } });
    expect((await tryRevise(exact)).message).toContain("Revision failed adversarial audit");
    append(exact.log, "solve.started", { solve: "s-practice" });
    append(exact.log, "verdict", {
      solve: "s-practice",
      task: "ex-001",
      answer: { n: 10, score: 9, detail: 8 },
      kind: "fail",
      blocking: ["check-strict"],
    });
    append(exact.log, "referee.finding", {
      solve: "s-practice",
      task: "ex-001",
      ruling: "check-defect",
      reason: "r",
    });
    expect((await tryRevise(exact, "check-strict")).message).toContain(
      "Refused: no standing check-defect ruling names check-strict",
    );
    append(exact.log, REVISED, { kind: "tune", why: "done" });
    await expect(tryRevise(exact, undefined, SOUND_AUDIT)).rejects.toThrow(
      "no exam.revised after exam.revised",
    );

    const bare = join(tempDir("ana-rev-bare-"), LOG_FILE);
    append(bare, OPENED, { project: "demo" });
    const runner = revisionRunner({ log: bare, parentBundle: bare, packages: () => new Map(), reader: null });
    const empty = { session: "x-1", why: "w", repair: undefined, candidate: TUNE, home: undefined };
    expect((await runner(empty)).message).toContain("Refused: the exam is not drafted and frozen");
  });

  it("serialises exam.revised against comparison.started under the log lock", () => {
    const dir = tempDir("ana-rev-lock-");
    const open = join(dir, "open.jsonl");
    append(open, STARTED, { session: "g-1", old: "a", fresh: "b" });
    expect(() => append(open, REVISED, { kind: "tune", why: "race" })).toThrow("while a comparison is open");
    append(open, STARTED, { session: "g-l", old: "a", fresh: "b", ladder: true });
    append(open, "comparison.reported", { session: "g-1" });
    append(open, REVISED, { kind: "tune", why: "settled" });
    for (const kind of [REVISED, STARTED] as const) {
      expect(() => append(open, kind, { session: "g-2" })).toThrow(`no ${kind} after exam.revised`);
    }
  });

  it("schedules a check-defects examine only while revision is possible, and ends on revise", () => {
    const at = "2026-11-27T00:00:00Z";
    const base: LogEvent[] = [
      { at, kind: "checker.read", data: { contract: "c", checks: "k", faults: [] } },
      { at, kind: "task.proposed", data: { version: "v1" } },
      { at, kind: "task.gate", data: { version: "v1", gate: 1, outcome: "passed" } },
      { at, kind: "build.checkpoint", data: { session: "b-1", harness: "h1" } },
      { at, kind: STARTED, data: { session: "g-1", old: "s", fresh: "h1", starter: "s" } },
      {
        at,
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
    const finished = (session: string, ended: string, held: string[]): LogEvent => ({
      at,
      kind: "exam.finished",
      data: { session, ended, held },
    });
    const twoRepairs = [
      finished("x-0", "finished", ["v1"]),
      ...base,
      finished("x-int", "crashed", []),
      finished("x-2", "finished", ["v2"]),
    ];
    const cases: readonly [readonly LogEvent[], boolean, string][] = [
      [base, true, "examine"],
      [base, false, "end"],
      [twoRepairs, true, "examine"],
      [[...twoRepairs, finished("x-3", "finished", ["v3"])], true, "end"],
    ];
    for (const [events, canRevise, move] of cases) {
      expect(nextAction(events, { ...plan, canRevise })).toMatchObject({ code: "bound", move });
    }
    const revised: LogEvent = { at, kind: REVISED, data: { kind: "tune", why: "handoff" } };
    expect(nextAction([revised], { ...plan, prompted: true })).toMatchObject({
      code: "revised",
      move: "end",
      ending: "revise",
    });
  });
});

describe("historical witnesses and the adversarial audit", () => {
  it("refuses weakened or shifted checks and unfixed repairs, and accepts a clearing repair with a flip note", async () => {
    const seed = await seedCampaign();
    recordWitnesses(seed, { report: true });
    const run = seed.runner(SOUND_AUDIT);
    const attempt = async (candidate: Draft, repair?: string) =>
      (await run({ session: "x-1", why: "w", repair, candidate, home: undefined })).message;
    const permissive = STRICT.replace(
      'artifact.n === hidden.target && note === "exact:" + String(hidden.target)',
      '(artifact.n === hidden.target && note === "exact:" + String(hidden.target)) || note === "bad"',
    );
    const weakened = candidateDraft(PARENT_DRAFT, { why: "w", evaluator: evaluatorWith(permissive) });
    expect(await attempt(weakened)).toContain(
      "earned witness on ex-001 is no longer refused by check-strict (pass)",
    );
    const shifted = candidateDraft(PARENT_DRAFT, {
      why: "w",
      checks: [...KEPT_CHECKS, { id: "check-no-bad", rule: "R2", assertion: "note is not bad" }],
      evaluator: evaluatorWith(
        permissive,
        `\n  "check-no-bad": ({ files }) => (files.find((f) => f.path === "${NOTE_FILE}")?.text ?? "") !== "bad",`,
      ),
      reject_controls: [{ ...answer(10, "bad"), check: "check-no-bad" }],
    });
    expect(await attempt(shifted)).toContain(
      "earned witness on ex-001 is no longer refused by check-strict (fail)",
    );

    const repair = await seedCampaign({ name: "camp-repair" });
    recordWitnesses(repair, { report: true });
    const multi = {
      n: 13,
      note: "exact: 10\n",
      blocking: ["check-even", "check-strict"],
      ruling: "check-defect",
    };
    witness(repair.log, "s-defect-multi", { ...multi, check: "check-strict" });
    const flip = { n: 10, note: "exact:10", blocking: ["check-strict"], ruling: "earned" };
    witness(repair.log, "s-earned-flip", { ...flip, check: "check-strict" });
    const notes: string[] = [];
    const noting = repair.runner(async (reader, target) => {
      notes.push(...target.notes);
      return await SOUND_AUDIT(reader, target);
    });
    const repairWith = async (candidate: Draft) =>
      await noting({
        session: "x-1",
        why: "fix whitespace",
        repair: "check-strict",
        candidate,
        home: undefined,
      });
    const unfixed = candidateDraft(PARENT_DRAFT, {
      why: "restate the note rule",
      repair: "check-strict",
      evaluator: evaluatorWith(
        STRICT.replace('"exact:" + String(hidden.target)', "`exact:${String(hidden.target)}`"),
      ),
    });
    expect((await repairWith(unfixed)).message).toContain(
      "check-defect witnesses on check-strict refused or unloaded (ex-001)",
    );
    expect(await repairWith(GOOD_REPAIR)).toEqual({
      accepted: true,
      message: "The exam revision stands; a successor campaign continues under it.",
    });
    expect(
      notes.filter((note) => note.includes("solely on repaired check check-strict now pass")),
    ).toHaveLength(1);
    const revised = eventsOf(read(repair.log), REVISED).at(-1)?.event.data;
    const frozen = eventsOf(read(repair.log), "contract.frozen").at(-1)?.event.data.checks;
    expect(revised).toMatchObject({ kind: "repair", check: "check-strict", parent: { checks: frozen } });
  });

  it("requires a sound audit, caps defect passes, replays prior probes first, and re-checks after the audit", async () => {
    const seed = await seedCampaign({ name: "camp-audit" });
    const skipped: DraftAuditor = async () => ({
      verdict: "skipped",
      findings: [],
      summary: "",
      probes: [],
      error: "503",
    });
    expect((await tryRevise(seed, undefined, skipped)).message).toContain("audit recorded no verdict");
    expect((await seed.runner(SOUND_AUDIT, null)(TUNE_INPUT)).message).toContain("needs a reviewer");
    const passes: number[] = [];
    const defects = auditing("defects", [...FLAT]);
    const counting: DraftAuditor = async (reader, target) => {
      passes.push(target.pass ?? -1);
      return await defects(reader, target);
    };
    const messages: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      messages.push((await seed.runner(counting)(TUNE_INPUT)).message);
    }
    expect(passes).toEqual([1, 2, 3]);
    expect(messages.every((message) => message.startsWith("Revision failed adversarial audit"))).toBe(true);
    expect(messages.at(-1)).toContain("could not be verified fixed after the audit cap");
    expect(eventsOf(read(seed.log), REVISED)).toHaveLength(0);

    const probed = async (name: string, path: string, defectPasses: readonly number[]) => {
      const one = await seedCampaign({ name });
      const checks = eventsOf(read(one.log), "contract.frozen").at(-1)?.event.data.checks ?? "";
      for (const pass of defectPasses) {
        append(one.log, "referee.draft", {
          session: "x-0",
          pass,
          revision: checks,
          verdict: "defects",
          findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "still passes" }],
          summary: "probe defect",
          probeRows: [
            {
              id: 1,
              task: "ex-001",
              changes: [{ path, value: "9", edit: null }],
              original: { kind: "pass" },
              changed: { kind: "pass" },
            },
          ],
        });
      }
      return await one.runner(recording)(TUNE_INPUT);
    };
    const calls: { pass: number | undefined; fixed: number }[] = [];
    const recording: DraftAuditor = async (reader, target) => {
      calls.push({ pass: target.pass, fixed: target.verifiedFixed?.length ?? 0 });
      return await SOUND_AUDIT(reader, target);
    };
    const replays = [
      await probed("camp-fixed-once", "$.n", [1]),
      await probed("camp-fixed-at-cap", "$.n", [1, 2]),
      await probed("camp-broken", "$.score", [1]),
    ];
    expect(replays.map(({ accepted }) => accepted)).toEqual([true, true, false]);
    expect(replays[2]?.message).toContain("prior probe still reproduces on this revision");
    expect(calls).toEqual([{ pass: 2, fixed: 1 }]);

    const race = await seedCampaign({ name: "camp-race" });
    const raced = race.runner(async (reader, target) => {
      append(race.log, STARTED, { session: "g-race", old: "starter", fresh: "h1" });
      return await SOUND_AUDIT(reader, target);
    })(TUNE_INPUT);
    await expect(raced).rejects.toThrow("cannot revise the exam while a comparison is open");
    expect(eventsOf(read(race.log), REVISED)).toHaveLength(0);
  });
});

describe("successor campaign", () => {
  it("stages an audited revision for the operator under --hitl and freezes it only on their word", async () => {
    const seed = await seedCampaign({ name: "hitl-a", attended: true });
    const staged = await seed.runner(SOUND_AUDIT)(TUNE_INPUT);
    const short = hashJsonValue(TUNE).slice(0, 16);
    expect(staged).toEqual({
      accepted: false,
      message: `The revision passed validation and audit and awaits operator approval under --hitl: bun tools/campaign/revise.ts --name hitl-a --candidate ${short} --freeze`,
    });
    expect(eventsOf(read(seed.log), REVISED)).toHaveLength(0);
    await expect(freezeCandidate(seed.log, "0".repeat(16), seed.packages)).rejects.toThrow(
      "no staged revision candidate",
    );
    append(seed.log, STARTED, { session: "g-open", old: "starter", fresh: "h1" });
    await expect(freezeCandidate(seed.log, short, seed.packages)).rejects.toThrow(
      "a comparison is still open",
    );
    report(seed.log, "g-open", { old: "starter", fresh: "h1", reading: "no-step" });
    const next = await freezeCandidate(seed.log, short, seed.packages);
    expect(next.name).toBe("hitl-a-rev2");
    expect(eventsOf(read(seed.log), REVISED).map(({ event: { data } }) => data.draftHash)).toEqual([
      hashJsonValue(TUNE),
    ]);
  });

  it("freezes a judged revision only where the campaign seats a first-party judging reviewer", async () => {
    const judged = candidateDraft(PARENT_DRAFT, {
      why: "judge clarity",
      ...rubric(codeItem("accuracy", 1), {
        id: "clarity",
        weight: 1,
        kind: "judge",
        criterion: "Reports methodology and assumptions clearly.",
      }),
    });
    const short = hashJsonValue(judged).slice(0, 16);
    const frozenUnder = async (reviewer: string) => {
      const seed = await seedCampaign({ name: `judged-${reviewer.length}`, attended: true, reviewer });
      await seed.runner(SOUND_AUDIT)({ ...TUNE_INPUT, candidate: judged });
      return await freezeCandidate(seed.log, short, seed.packages).then(
        () => eventsOf(read(seed.log), REVISED).length,
        (error: unknown) => errorMessage(error),
      );
    };
    expect(await frozenUnder("acme/judge-1")).toContain("seats no first-party judging reviewer");
    expect(await frozenUnder(CROSS)).toBe(1);
  });

  it("names successors and rewrites launch flags", () => {
    expect(["a", "a-rev2", "a-rev9"].map(successorName)).toEqual(["a-rev2", "a-rev3", "a-rev10"]);
    const cases: readonly [string[], string, string, string[]][] = [
      [["--name", "a", "--budget", "50"], "--name", "b", ["--name", "b", "--budget", "50"]],
      [["--name=a", "--budget=50"], "--name", "b", ["--name=b", "--budget=50"]],
      [["--name", "a"], "--moves", "2", ["--name", "a", "--moves", "2"]],
      [["--moves=3"], "--moves", "0", ["--moves=0"]],
    ];
    for (const [flags, flag, value, expected] of cases) {
      expect(withFlag(flags, flag, value)).toEqual(expected);
    }
  });

  it("opens B once under racing openers, carries lineage, and allows one tune per epoch", async () => {
    const seed = await seedCampaign({ name: "lin-a" });
    const written = {
      taskId: "x-1-001",
      family: "f1",
      publicInput: { prompt: "sixteen" },
      hidden: { target: 16, ideal: 10 },
    };
    const writtenVersion = taskVersion(packageOf(seed.checks, written));
    append(seed.log, "task.proposed", {
      version: writtenVersion,
      taskId: "x-1-001",
      session: "x-1",
      task: written,
    });
    append(seed.log, "task.gate", { version: writtenVersion, gate: 1, outcome: "passed" });
    append(seed.log, "build.finished", {
      session: "b-1",
      harness: "h-carried",
      changed: true,
      ended: "finished",
      billed: 12.5,
    });
    append(seed.log, STARTED, {
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
    const home = join(seed.dir, "examiner-home");
    mkdirSync(join(home, ".toolchain", "bin"), { recursive: true });
    writeFileSync(join(home, ".toolchain", "bin", "my-helper"), "#!/bin/sh\necho ok\n");
    chmodSync(join(home, ".toolchain", "bin", "my-helper"), 0o755);
    const tune = candidateDraft(PARENT_DRAFT, {
      why: "add range check and reweight",
      checks: [
        ...KEPT_CHECKS,
        { id: "check-positive", rule: "R1", assertion: "n is strictly positive", tools: ["my-helper"] },
      ],
      evaluator: evaluatorWith(
        STRICT,
        `\n  "check-positive": async ({ artifact }, runtime) => (await runtime.tools.run({ toolId: "my-helper", args: [] })).exitCode === 0 && artifact.n > 0,`,
      ),
      ...rubric(codeItem("accuracy", 1.5), codeItem("depth", 1)),
      reject_controls: [{ ...answer(-2, "exact:10"), check: "check-positive" }],
    });
    const parentEvaluator = readFileSync(join(seed.checks, "evaluator.ts"), "utf8");
    const accepted = await seed.runner(SOUND_AUDIT)({
      session: "x-1",
      why: "tune",
      repair: undefined,
      candidate: tune,
      home,
    });
    expect(accepted.accepted).toBe(true);
    expect(readFileSync(join(seed.checks, "evaluator.ts"), "utf8")).toBe(parentEvaluator);

    const [next, again] = await Promise.all([openSuccessor(seed.log), openSuccessor(seed.log)]);
    expect(await openSuccessor(seed.log)).toEqual(next);
    expect(again).toEqual(next);
    expect(readdirSync(seed.dir).filter((file) => file.startsWith("successor-"))).toEqual([]);
    expect(next.name).toBe("lin-a-rev2");
    const eventsA = read(seed.log);
    expect(
      eventsOf(eventsA, "campaign.ended").map(({ event: { data } }) => [data.ending, data.successor]),
    ).toEqual([["revise", "lin-a-rev2"]]);
    const eventsB = read(next.log);
    const once = ["campaign.opened", "campaign.setting", "exam.drafted", "contract.frozen"] as const;
    expect(once.map((kind) => eventsOf(eventsB, kind).length)).toEqual([1, 1, 1, 1]);
    const parent = openingOf(eventsB)?.parent;
    expect(parent).toMatchObject({
      campaign: "lin-a",
      kind: "tune",
      carried: { sinceStep: 1, attempts: 1, tunedThisEpoch: true },
    });
    expect(parent?.carried.spent).toBeCloseTo(12.5, 4);
    expect(parent?.lineageTasks).toContain(contentOf(written));
    expect(budgetLeft(eventsB)?.dollars).toBeCloseTo(37.5, 4);
    expect(stopRule(eventsB).sinceStep).toBe(1);
    expect(riskLines(eventsB).join("\n")).toContain("Carried from parent lineage");
    expect([latestBuilt(eventsB) !== null, promoted(eventsB)]).toEqual([true, null]);
    expect(draftOf(eventsB)?.checks.map(({ id }) => id)).toContain("check-positive");
    for (const kept of [join("memory", "MEMORY.md"), join("examiner-home", "gen.py")]) {
      expect(existsSync(join(dirname(next.log), kept))).toBe(true);
    }
    expect(lastLaunch(next.log)?.flags).toEqual([
      "--name",
      "lin-a-rev2",
      "--budget",
      "50",
      "--project",
      "demo",
    ]);
    expect(ungated({ tasks: seed.tasks, pack: (task) => packageOf(seed.checks, task) }, eventsB)).toEqual([]);
    await expect(openSuccessor(next.log)).rejects.toThrow("no valid exam.revised");
    expect(
      triggerOf({ live: false, promotions: 0, compared: 1, allTied: false, ending: "revise", hours: 1 }),
    ).toBeNull();
    const examCall = (tool: string, second: number): LogEvent => ({
      at: `2026-11-26T00:00:0${String(second)}.000Z`,
      kind: "exam.call",
      data: { session: "x-1", tool, args: {} },
    });
    expect(
      gamingRows([...eventsA, examCall("read_reviews", 0), examCall("revise_exam", 1)]).join("\n"),
    ).toContain("read_reviews 1, revise_exam 1, revised (tune)");

    const b = {
      runner: (auditor: DraftAuditor) =>
        revisionRunner({
          log: next.log,
          parentBundle: next.log,
          packages: () => new Map(),
          reader: READER,
          auditor,
        }),
    };
    const tuneB = async () => (await b.runner(ADMITTED)(TUNE_INPUT)).message;
    expect(await tuneB()).toContain("Refused: this epoch opened from a tune");
    append(next.log, "harness.promoted", { harness: "h-b1", from: "starter" });
    append(next.log, STARTED, {
      session: "g-s",
      old: "h-b1",
      fresh: "starter",
      starter: "starter",
    });
    append(next.log, "comparison.reported", {
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
    expect(stopRule(read(next.log)).sinceStep).toBe(0);
    expect(await tuneB()).toContain("Revision failed adversarial audit");

    const hijack = await seedCampaign({ name: "camp-hijack" });
    expect((await tryRevise(hijack, undefined, SOUND_AUDIT)).accepted).toBe(true);
    const foreign = join(dirname(hijack.dir), "camp-hijack-rev2");
    mkdirSync(foreign, { recursive: true });
    append(join(foreign, LOG_FILE), OPENED, {
      prompt: "unrelated campaign",
      parent: { campaign: "someone-else", revised: "0".repeat(64), kind: "tune" },
    });
    await expect(openSuccessor(hijack.log)).rejects.toThrow("refusing to adopt existing campaign");
  });
});

describe("revision in the Examiner session and the campaign loop", () => {
  it("exposes read_exam and revise_exam in writing sessions and ends the session once a revision stands", async () => {
    const dupTask = { family: "fixture", public_input: { base: 7 }, hidden: { seed: 1 } };
    const dupHash = contentOf({ family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } });
    const weights = { ...rubric(codeItem("accuracy", 2), codeItem("depth", 1)) };
    const s = seat("write", [
      call("propose_tasks", { tasks: [dupTask] }),
      call("read_exam", {}),
      call("revise_exam", { why: "noop rejected by faults" }),
      call("revise_exam", { why: "first try refused by runner", ...weights }),
      call("revise_exam", { why: "adjust item weights", ...weights }),
      finish,
    ]);
    append(s.request.log, OPENED, {
      project: "demo",
      seats: { builder: null, examiner: null, reviewer: { model: CROSS, effort: "high" } },
      solver: { model: SONNET, effort: "high" },
      parent: {
        campaign: "parent-a",
        revised: "deadbeef",
        kind: "tune",
        carried: { spent: 0, sinceStep: 0, attempts: 0 },
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
      revise: async ({ repair, why }) => {
        runnerCalls.push(`${repair ?? "tune"}:${why}`);
        return why.startsWith("first try")
          ? { accepted: false, message: "Refused: try again." }
          : { accepted: true, message: "Revision accepted." };
      },
    });
    expect([result.ended, result.held]).toEqual(["stands", []]);
    expect(runnerCalls).toEqual(["tune:first try refused by runner", "tune:adjust item weights"]);
    expect(systemPrompt(undefined, "fixed")).not.toContain("revise_exam");
    expect(systemPrompt(undefined, "revisable")).toContain("revise_exam");
  });

  it("repairs on check-defects and hands A to B in harnessBuilder; --no-revise and a missing reviewer revise nothing", async () => {
    const campRoot = join(REPO, ".ana", "d2");
    const opened = async (name: string, extra: JsonObject) => {
      const dir = join(campRoot, name);
      ROOTS.push(dir);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const log = join(dir, LOG_FILE);
      append(log, OPENED, {
        project: "demo",
        budget: { dollars: 50, reserve: 1 },
        patience: 6,
        seats: {
          builder: { model: OPUS, effort: "high" },
          examiner: { model: OPUS, effort: "high" },
          reviewer: { model: CROSS, effort: "high" },
        },
        solver: { model: SONNET, effort: "high" },
        prompt: "test domain",
        terms: { level: "0.05", practice: "0" },
        ...extra,
      });
      const setting = {
        solver: { model: SONNET, effort: "high" },
        minutes: 10,
        modelTurns: 10,
        target: 8,
        solves: 1,
      };
      append(log, "campaign.setting", setting);
      append(log, "exam.drafted", {
        session: "d-1",
        draft: parseJsonAs<JsonObject>(capturedJsonStringify(PARENT_DRAFT)),
      });
      const { faults, read: seen } = await draftReading(dir, PARENT_DRAFT, 4);
      if (seen === undefined) throw new Error(`expected draft reading: ${faults.join("; ")}`);
      const word = { admitted: new Set<string>(), authored: true, judge: false, freeze: true, despite: "" };
      keepReading(log, seen.checker, seen.reading, word);
      return { log, seen };
    };
    const name = `test-rev-hb-${String(runtimeProcess.pid)}`;
    const nextName = successorName(name);
    ROOTS.push(join(campRoot, nextName));
    rmSync(join(campRoot, nextName), { recursive: true, force: true });
    const { log, seen } = await opened(name, {});
    const task0 = PARENT_DRAFT.tasks[0];
    if (task0 === undefined) throw new Error("expected parent task");
    const numbered = { taskId: "ex-001", ...task0 };
    const v0 = taskVersion(packageOf(seen.checks, numbered));
    append(log, "task.proposed", { version: v0, taskId: "ex-001", session: "x-0", task: numbered });
    append(log, "task.gate", { version: v0, gate: 1, outcome: "passed" });
    append(log, "build.checkpoint", { session: "b-1", harness: "h1" });
    append(log, STARTED, { session: "g-1", old: "starter", fresh: "h1", starter: "starter" });
    const defect = { n: 10, note: "exact: 10\n", blocking: ["check-strict"], ruling: "check-defect" };
    witness(log, "s-defect-strict", { ...defect, check: "check-strict" });
    witness(log, "s-earned-even", { n: 11, note: "exact:10", blocking: ["check-even"], ruling: "earned" });
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
    const repairSession = seat("write", [
      call("read_exam", {}),
      call("revise_exam", {
        why: "allow whitespace after colon",
        repair: "check-strict",
        evaluator: FIXED_EVALUATOR,
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
    expect(ended).toMatchObject({ move: "end", ending: "revise" });
    expect([examineCalls, existsSync(join(handoverDir, "REPORT.md"))]).toEqual([1, true]);
    expect(eventsOf(eventsA, "exam.finished").at(-1)?.event.data.crash).toBeNull();
    expect((["build.started", REVISED] as const).map((kind) => eventsOf(eventsA, kind).length)).toEqual([
      0, 1,
    ]);
    expect(endedOf(eventsA)?.ending).toBe("revise");
    const eventsB = read(join(campRoot, nextName, LOG_FILE));
    expect(openingOf(eventsB)?.parent).toMatchObject({
      campaign: name,
      kind: "repair",
      carried: { tunedThisEpoch: false },
    });
    expect(eventsOf(eventsB, "contract.frozen")).toHaveLength(1);

    const noRevise = `test-no-revise-flag-${String(runtimeProcess.pid)}`;
    await opened(noRevise, { revise: false });
    const sawRevise: boolean[] = [];
    const quiet = seat("write", [finish]);
    const builder = seat("write", [finish]);
    await harnessBuilder(["--name", noRevise, "--moves", "2", "--practice", "0"], {
      seated: () => ({
        builder: { model: builder.request.model, models: builder.request.models },
        setting: "scripted",
        solve: async () => {
          throw new Error("unexpected solve");
        },
      }),
      examine: async (request, wall) => {
        sawRevise.push(request.revise !== undefined);
        return await examine({ ...request, model: quiet.request.model, models: quiet.request.models }, wall);
      },
    });
    expect(sawRevise).toEqual([false]);

    const unreviewed = `test-rev-audit-guard-${String(runtimeProcess.pid)}`;
    const guarded = await opened(unreviewed, {
      seats: {
        builder: { model: OPUS, effort: "high" },
        examiner: { model: OPUS, effort: "high" },
        reviewer: null,
      },
    });
    const guardSeat = seat("write", [
      call("revise_exam", {
        why: "attempt without reviewer",
        ...rubric(codeItem("accuracy", 2), codeItem("depth", 1)),
      }),
      finish,
      finish,
    ]);
    await examineCommand(["--name", unreviewed, "--session", "x-1", "--examiner", OPUS], (request, wall) =>
      examine({ ...request, model: guardSeat.request.model, models: guardSeat.request.models }, wall),
    );
    expect(eventsOf(read(guarded.log), REVISED)).toHaveLength(0);
  });
});

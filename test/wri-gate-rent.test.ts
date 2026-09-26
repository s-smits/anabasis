import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type {
  BuilderCustomToolCall,
  BuilderCustomToolSemantic,
} from "../src/author/builder-custom-tool-call.ts";
import { builderExecutionEvidenceWriter } from "../src/author/builder-execution-writer.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { executionRecord } from "./helpers/session-execution-record.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  DELIBERATELY_UNLEDGERED,
  GATE_LEDGER,
  LOOP_LEDGER,
  QUALIFIERS,
  REFUSAL_BAR,
  clearsBar,
  componentOf,
  holdComponent,
  terminalComponent,
} from "../.claude/skills/whole-run-investigation/scripts/gate-ledger.mjs";
import {
  buildGateRent,
  renderGateRent,
} from "../.claude/skills/whole-run-investigation/scripts/gate-rent.mjs";

type Call = Partial<BuilderCustomToolCall>;
type LedgerRow = {
  code: string;
  form: string;
  pRight: number | null;
  pStall: number | null;
  codes: string[];
  retired: string[];
};
/** What a gate receipt records beyond its outcome. `codes` are `<stage>:<code>`; `condition` is the
 *  full submission condition, and `stagesRun` the stages the check ran. */
type Receipt = { candidate?: string; condition?: string; codes?: string[]; stagesRun?: string[] };
type Report = ReturnType<typeof buildGateRent>;

const LEDGER: LedgerRow[] = GATE_LEDGER;
const FULL = ["bundle", "validation", "conformance", "gates"];

afterAll(cleanupScratch);

const edit = (): Call => ({ tool: "edit", action: "edit" });
const shell = (): Call => ({ tool: "bash", action: "run" });

/** A `correctness_check` receipt as the current tool writes it: refused with `codes`, or clear. */
function check({ candidate, condition, codes = [], stagesRun }: Receipt, atMin = 0): Call {
  const semantic: BuilderCustomToolSemantic = {
    outcome: codes.length > 0 ? "findings" : "clear",
    ...keyIfDefined("candidateId", candidate),
    ...keyIfDefined("conditionId", condition),
  };
  const stage = codes.at(-1)?.split(":")[0];
  if (stage !== undefined) {
    semantic.stage = stage;
    semantic.reason = `refused-${stage}`;
    semantic.findingCodes = codes.map((entry) => entry.slice(entry.indexOf(":") + 1));
  }
  if (stagesRun !== undefined) {
    semantic.stagesRun = stagesRun;
    semantic.stagedCodes = codes;
  }
  return { tool: "correctness_check", action: "run", startedAtMs: atMin * 60_000, semantic };
}

/** An older receipt: the stage and the codes, with no stage per code and no condition. */
function oldCheck(candidate: string, codes: string[], stage: string): Call {
  return {
    tool: "correctness_check",
    action: "run",
    semantic:
      codes.length === 0
        ? { outcome: "clear", candidateId: candidate }
        : {
            outcome: "findings",
            stage,
            reason: `refused-${stage}`,
            candidateId: candidate,
            findingCodes: codes,
          },
  };
}

const accepted = (candidate: string): Call => ({
  tool: "submit",
  action: "submit",
  semantic: { outcome: "accepted", candidateId: candidate },
});

const held = (): Call => ({
  tool: "submit",
  action: "submit",
  durationMs: 120_000,
  semantic: { outcome: "blocked", reason: "review-unread" },
});

/** A refused receipt under a condition named after its candidate, having run every stage. */
const refusal = (candidate: string, ...codes: string[]): Call =>
  check({ candidate, condition: `${candidate}-e1`, codes, stagesRun: FULL });
const clear = (candidate: string): Call => check({ candidate, condition: `${candidate}-e1` });

/** A campaign whose one epoch recorded each list of calls as one Builder session, through the
 *  writer the Builder session uses. */
function campaign(sessions: Call[][]): string {
  const dir = join(scratchDir("wri-gate-rent-"), "campaigns", "slug");
  const epoch = join(dir, "epoch-aaaaaaaaaaaa");
  mkdirSync(epoch, { recursive: true });
  for (const customCalls of sessions) {
    builderExecutionEvidenceWriter(epoch)(executionRecord({ customCalls }));
  }
  return dir;
}

const triggerNames = (report: Report) => report.triggers.map((row: { name: string }) => row.name);
const episodeOf = (report: Report, component: string) =>
  report.episodes.find((row: { component: string }) => row.component === component);

describe("gate-ledger", () => {
  it("names every finding code in at most one row, current or retired, with priors in range", () => {
    const codes = LEDGER.flatMap((entry) => [...entry.codes, ...entry.retired]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of [...LEDGER, ...LOOP_LEDGER]) {
      for (const prior of [entry.pRight, entry.pStall]) {
        expect(prior === null || (prior >= 0 && prior <= 1)).toBe(true);
      }
    }
    // A retired code still names its row, so runs recorded before the audit read the same.
    expect(componentOf("ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT")?.code).toBe("F2-3");
  });

  it("reads a component's bar from its prior, and gives an unpriored one no verdict", () => {
    expect(REFUSAL_BAR).toBe(0.98);
    expect(clearsBar(componentOf("EXTERNAL_VERDICT_UNGROUNDED"))).toBe(true);
    expect(clearsBar(componentOf("tool-timeout"))).toBe(false);
    expect(clearsBar(componentOf("experiment-change-unmoved"))).toBeNull();
    expect(componentOf("no-such-code")).toBeNull();
  });

  it("maps a terminal reason to its loop ceiling by leading code, and the off-aim stop by its text", () => {
    expect(terminalComponent("build-failed: three rounds")?.code).toBe("LP-1");
    expect(terminalComponent("candidate-held: held twice")?.code).toBe("LP-8");
    expect(terminalComponent("stopped: Stopped at the configured off-aim allowance of 3")?.code).toBe("DF-6");
    // A stop for any other reason is the operator's, not the deleted allowance's.
    expect(terminalComponent("stopped: operator asked")).toBeNull();
    expect(terminalComponent("completed: settled")).toBeNull();
    expect(terminalComponent(null)).toBeNull();
    expect(holdComponent("review-unread")?.code).toBe("LP-6");
    expect(holdComponent("clear")).toBeNull();
  });
});

describe("gate-ledger against the source", () => {
  const root = join(import.meta.dir, "..");
  const sources = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".ts"))
    .map((rel) => ({ rel: `src/${rel}`, text: readFileSync(join(root, "src", rel), "utf8") }));
  const escape = (code: string) => code.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const emitted = (code: string) =>
    sources.some(({ text }) => new RegExp(`["'\`]${escape(code)}(?![\\w-])`).test(text));

  it("holds every current code to an emitter and every retired code to none", () => {
    expect(LEDGER.flatMap((entry) => entry.codes).filter((code) => !emitted(code))).toEqual([]);
    expect(LEDGER.flatMap((entry) => entry.retired).filter(emitted)).toEqual([]);
    const auxiliary = [...QUALIFIERS.keys(), ...DELIBERATELY_UNLEDGERED.keys()];
    expect(auxiliary.filter((code) => !emitted(code))).toEqual([]);
    // A row whose emitter survives is live whatever the audit decided, so a deleted row names none.
    expect(LEDGER.filter((entry) => entry.form === "deleted" && entry.codes.length > 0)).toEqual([]);
  });

  it("names every code the gate trees construct in a row, a qualifier or the unscored list", () => {
    const owners = new Set([
      "src/author/candidate-check.ts",
      "src/builder/author-feedback.ts",
      "src/run/census-gate.ts",
    ]);
    const gateFiles = sources.filter(({ rel }) => /^src\/(truth|gate)\//.test(rel) || owners.has(rel));
    const known = new Set([
      ...LEDGER.flatMap((entry) => entry.codes),
      ...QUALIFIERS.keys(),
      ...DELIBERATELY_UNLEDGERED.keys(),
    ]);
    const constructed = new Set(
      gateFiles.flatMap(({ text }) =>
        [...text.matchAll(/(?:\bcode:\s*|\b[fF]inding\(\s*)"([A-Za-z][\w-]*)"(?!\s+in\b)/g)].map(
          (match) => match[1] ?? "",
        ),
      ),
    );
    expect(constructed.size).toBeGreaterThan(50);
    // Two refusals that recorded runs show firing and no audit has scored: printed as unledgered
    // until one does, so lane 27 names them rather than this list hiding them.
    const unscoredButFiring = ["brief-join-check-ownership-invalid", "gate-unvalidated"];
    expect([...constructed].filter((code) => !known.has(code)).sort()).toEqual(unscoredButFiring);
  });

  it("gives every qualifier the components it details and every unscored code a reason", () => {
    for (const [code, { beside, reason }] of QUALIFIERS) {
      expect(beside.length, code).toBeGreaterThan(0);
      expect(beside.every((component: string) => LEDGER.some((entry) => entry.code === component))).toBe(
        true,
      );
      expect(reason.length).toBeGreaterThan(0);
    }
    for (const reason of DELIBERATELY_UNLEDGERED.values()) expect(reason.length).toBeGreaterThan(0);
  });
});

describe("gate-rent episodes", () => {
  it("reads a refusal answered by new bytes as repaired, with the edits between", () => {
    const report = buildGateRent({
      campaign: campaign([
        [
          check(
            { candidate: "c1", condition: "c1-e1", codes: ["gates:solvability-failed"], stagesRun: FULL },
            0,
          ),
          edit(),
          edit(),
          check({ candidate: "c2", condition: "c2-e1" }, 12),
          accepted("c2"),
        ],
      ]),
    });
    expect(report.state).toBe("recorded");
    expect(report.episodes).toEqual([
      expect.objectContaining({ component: "F2-1", answer: "repaired", carried: 1, edits: 2, minutes: 12 }),
    ]);
    expect(report.components[0]).toMatchObject({ component: "F2-1", episodes: 1, receipts: 1, stalls: 0 });
    expect(triggerNames(report)).not.toContain("GATE STALL (lane 27)");
  });

  it("counts a component's several codes on one receipt as one firing", () => {
    const taskRules = ["tasks-shape", "tasks-duplicate-id", "tasks-check-family-unbound"];
    const report = buildGateRent({
      campaign: campaign([[refusal("c1", ...taskRules.map((code) => `bundle:${code}`)), clear("c2")]]),
    });
    expect(report.episodes).toHaveLength(1);
    expect(report.components[0]).toMatchObject({
      component: "SH-2",
      episodes: 1,
      receipts: 1,
      codes: taskRules.toSorted(),
    });
  });

  it("folds a qualifier into the component it details, and counts it alone elsewhere", () => {
    const beside = buildGateRent({
      campaign: campaign([
        [refusal("c1", "gates:SOLVABILITY_CENSUS_BLOCKED", "gates:solvability-failed"), clear("c2")],
      ]),
    });
    expect(beside.episodes.map((row: { component: string }) => row.component)).toEqual(["F2-1"]);
    expect(beside.episodes[0].codes).toEqual(["solvability-failed"]);

    // Beside a plan code it details nothing, so it is still the F2 census refusing.
    const elsewhere = buildGateRent({
      campaign: campaign([
        [
          refusal("c1", "validation:experiment-proposal-shape", "gates:SOLVABILITY_CENSUS_BLOCKED"),
          clear("c2"),
        ],
      ]),
    });
    expect(episodeOf(elsewhere, "F2-1")).toMatchObject({ codes: ["SOLVABILITY_CENSUS_BLOCKED"] });
  });

  it("reads the same bytes cleared under a changed tool condition as a tool repair, not a clear without edit", () => {
    const report = buildGateRent({
      campaign: campaign([
        [
          check({
            candidate: "snap",
            condition: "snap-dadc",
            codes: ["gates:solvability-failed"],
            stagesRun: FULL,
          }),
          shell(),
          shell(),
          check({ candidate: "snap", condition: "snap-775d" }),
          accepted("snap"),
        ],
      ]),
    });
    expect(report.episodes[0]).toMatchObject({ answer: "repaired-tool-condition", toolWork: 2, edits: 0 });
    expect(triggerNames(report)).not.toContain("GATE CLEARED WITHOUT EDIT (lane 27)");
  });

  it("reads the same whole condition cleared as a clear without edit, and flags it", () => {
    const report = buildGateRent({
      campaign: campaign([[refusal("c1", "gates:tool-timeout"), clear("c1"), accepted("c1")]]),
    });
    expect(report.episodes[0]).toMatchObject({ component: "CT-3", answer: "cleared-without-edit", edits: 0 });
    expect(triggerNames(report)).toContain("GATE CLEARED WITHOUT EDIT (lane 27)");
  });

  it("never calls a plan refusal cleared without edit, because the condition does not cover the plan", () => {
    const report = buildGateRent({
      campaign: campaign([[refusal("c1", "validation:experiment-proposal-shape"), edit(), clear("c1")]]),
    });
    expect(report.episodes[0]).toMatchObject({ answer: "cleared-plan-unrecorded", edits: 1 });
    expect(triggerNames(report)).not.toContain("GATE CLEARED WITHOUT EDIT (lane 27)");
  });

  it("says the tool condition is unknown where the receipts recorded the bytes alone", () => {
    const report = buildGateRent({
      campaign: campaign([
        [oldCheck("c1", ["tool-timeout"], "gates"), oldCheck("c1", [], "gates"), accepted("c1")],
      ]),
    });
    expect(report.episodes[0]).toMatchObject({ answer: "bundle-unchanged-condition-unknown" });
    expect(triggerNames(report)).not.toContain("GATE CLEARED WITHOUT EDIT (lane 27)");
  });

  it("never lets a refusal that stopped before the reference solve answer an F2 code", () => {
    const report = buildGateRent({
      campaign: campaign([
        [
          refusal("c1", "validation:experiment-proposal-shape", "gates:SOLVABILITY_CENSUS_BLOCKED"),
          check({
            candidate: "c2",
            condition: "c2-e1",
            codes: ["conformance:task-worker-binding-drift"],
            stagesRun: ["bundle", "validation", "conformance", "census"],
          }),
        ],
      ]),
    });
    expect(episodeOf(report, "F2-1")).toMatchObject({ answer: "unanswered" });
    // The validation stage did run again and named nothing, so the plan refusal is answered.
    expect(episodeOf(report, "SH-7")).toMatchObject({ answer: "repaired" });
  });

  it("lets an older refused receipt, which never said what it ran, answer nothing", () => {
    const report = buildGateRent({
      campaign: campaign([
        [oldCheck("c1", ["solvability-failed"], "gates"), oldCheck("c2", ["tasks-shape"], "gates")],
      ]),
    });
    expect(episodeOf(report, "F2-1")).toMatchObject({ answer: "unanswered" });
  });

  it("calls a code carried across three receipts, or left unanswered in a session that never submitted, a stall", () => {
    const code = "gates:DISCRIMINATION_ACCEPT_REJECTED";
    const carried = buildGateRent({
      campaign: campaign([[refusal("c1", code), refusal("c2", code), refusal("c3", code), clear("c4")]]),
    });
    expect(carried.episodes[0]).toMatchObject({ carried: 3, answer: "repaired" });
    expect(triggerNames(carried)).toContain("GATE STALL (lane 27)");

    const abandoned = buildGateRent({ campaign: campaign([[refusal("c1", code)]]) });
    expect(abandoned.episodes[0]).toMatchObject({ answer: "unanswered", sessionAccepted: false });
    expect(triggerNames(abandoned)).toContain("GATE STALL (lane 27)");

    // The same unanswered code in a session that went on to an accepted submit held nothing up.
    const submitted = buildGateRent({ campaign: campaign([[refusal("c1", code), accepted("c1")]]) });
    expect(triggerNames(submitted)).not.toContain("GATE STALL (lane 27)");
  });

  it("flags a live component under the bar when it fires, and never a deleted one", () => {
    const live = buildGateRent({ campaign: campaign([[refusal("c1", "gates:tool-timeout")]]) });
    expect(live.triggers).toContainEqual(
      expect.objectContaining({
        name: "BELOW-BAR GATE FIRED (lane 27)",
        examples: [expect.stringMatching(/^CT-3 /)],
      }),
    );

    const deleted = buildGateRent({
      campaign: campaign([
        [
          oldCheck("c1", ["brief-constant-uncited"], "validation"),
          oldCheck("c2", [], "gates"),
          accepted("c2"),
        ],
      ]),
    });
    expect(deleted.components[0]).toMatchObject({ component: "BR-5", form: "deleted", clearsBar: false });
    expect(triggerNames(deleted)).not.toContain("BELOW-BAR GATE FIRED (lane 27)");
  });

  it("names a code no row carries as unledgered, an unscored validator as unscored, and a codeless refusal by its stage", () => {
    const unscoredCode = [...DELIBERATELY_UNLEDGERED.keys()][0];
    const report = buildGateRent({
      campaign: campaign([
        [oldCheck("c1", ["brand-new-refusal", unscoredCode], "validation"), oldCheck("c2", [], "gates")],
      ]),
    });
    expect(report.components).toContainEqual(
      expect.objectContaining({ component: null, unscored: null, codes: ["brand-new-refusal"] }),
    );
    expect(report.components).toContainEqual(
      expect.objectContaining({ form: "unscored", codes: [unscoredCode] }),
    );
    expect(report.triggers).toContainEqual(
      expect.objectContaining({ name: "UNLEDGERED REFUSAL CODE (lane 27)", rows: 1 }),
    );

    const codeless: Call = {
      tool: "correctness_check",
      action: "run",
      semantic: { outcome: "findings", stage: "conformance" },
    };
    const unnamed = buildGateRent({ campaign: campaign([[codeless, oldCheck("c2", [], "gates")]]) });
    expect(unnamed.episodes[0]).toMatchObject({
      codes: ["stage:conformance"],
      answer: "answered-identity-unrecorded",
    });
  });

  it("reads two held submits in a row as a hold chain, and one as none", () => {
    const chain = buildGateRent({ campaign: campaign([[held(), held(), accepted("c1")]]) });
    expect(chain.holds).toEqual([expect.objectContaining({ holds: 2, waitMs: 240_000 })]);
    expect(triggerNames(chain)).toContain("REVIEW HOLD CHAIN (lane 27)");

    const single = buildGateRent({ campaign: campaign([[held(), accepted("c1")]]) });
    expect(triggerNames(single)).not.toContain("REVIEW HOLD CHAIN (lane 27)");
  });

  it("renders its counts in the singular and the plural", () => {
    const text = renderGateRent(
      buildGateRent({ campaign: campaign([[refusal("c1", "gates:tool-timeout")]]) }),
    );
    expect(text).toContain("1 Builder session, 1 gate receipt, 1 refused");
    expect(text).toContain("1 episode over 1 refused receipt;");
    expect(text).not.toContain("(s)");
  });

  it("reports a campaign with no Builder record as unavailable rather than as a quiet gate", () => {
    const dir = join(scratchDir("wri-gate-rent-empty-"), "campaign");
    mkdirSync(dir, { recursive: true });
    const report = buildGateRent({ campaign: dir });
    expect(report.state).toBe("unavailable");
    expect(report.triggers).toEqual([]);
    expect(renderGateRent(report)).toContain("recorded no Builder execution record");
  });
});

describe("gate-rent corrections", () => {
  const TASKS = [
    { taskId: "t1", family: "f", publicInput: { n: 1 }, hidden: [{ checkId: "k", expectation: 1 }] },
    { taskId: "t2", family: "f", publicInput: { n: 2 }, hidden: [{ checkId: "k", expectation: 2 }] },
  ];

  type Battery = { operation?: string; passed?: number; createdAt?: string; files?: Record<string, string> };

  /** One recorded battery under `versions/<runId>`, with its bundle snapshot and, when `createdAt`
   *  is given, the claim that dates it. */
  function battery(
    dir: string,
    runId: string,
    { operation = "harness-intervention", passed = 0, createdAt, files = {} }: Battery,
  ): void {
    const version = join(dir, "versions", runId);
    const snapshot = join(version, ".bundle-snapshots", `snap-${runId}`);
    const bundle = {
      "correctness-model/brief.json": "{}",
      "correctness-model/evaluator.ts": "export const checks = {};",
      "correctness-model/controls.json": "[]",
      "correctness-model/tasks.json": JSON.stringify(TASKS),
      "agent/BUILT_AGENTS.md": "guide",
      ...files,
    };
    for (const [rel, text] of Object.entries(bundle)) {
      mkdirSync(dirname(join(snapshot, rel)), { recursive: true });
      writeFileSync(join(snapshot, rel), text);
    }
    const log = new EvidenceLog(join(version, "runs", runId));
    log.write("battery.json", {
      runId,
      bundleSnapshot: { id: `snap-${runId}`, agentHash: "a", correctnessModelHash: "b", taskSetHash: "c" },
      experimentAuthoring: { operation: { operation } },
      cases: TASKS.map((task, index) => ({
        taskId: task.taskId,
        truthOk: index < passed,
        pass: index < passed,
      })),
    });
    log.record();
    if (createdAt !== undefined) {
      mkdirSync(join(dir, "claims"), { recursive: true });
      writeFileSync(join(dir, "claims", `${runId}.json`), JSON.stringify({ createdAt }));
    }
  }

  const withSession = () => campaign([[clear("c1"), accepted("c1")]]);

  it("finds a correction measured last from its battery, with no later round's decision to name it", () => {
    const dir = withSession();
    battery(dir, "run-a", { createdAt: "2026-09-19T01:00:00.000Z" });
    const corrected = TASKS.map((task) =>
      task.taskId === "t1" ? { ...task, hidden: [{ checkId: "k", expectation: 9 }] } : task,
    );
    battery(dir, "run-b", {
      operation: "evaluation-correction",
      passed: 2,
      createdAt: "2026-09-19T02:00:00.000Z",
      files: { "correctness-model/tasks.json": JSON.stringify(corrected) },
    });
    const report = buildGateRent({ campaign: dir });
    expect(report.corrections).toEqual([
      expect.objectContaining({
        runId: "run-b",
        before: "run-a",
        passedBefore: "0/2",
        passedAfter: "2/2",
        moved: { grading: ["correctness-model/tasks.json"], other: [], hiddenTasks: 1, publicTasks: 0 },
        regrade: `bun run replay -- ${dir}/run-a --under ${dir}/run-b`,
      }),
    ]);
    expect(triggerNames(report)).toContain("EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)");
    expect(renderGateRent(report)).toContain(`regrade: bun run replay -- ${dir}/run-a --under ${dir}/run-b`);
  });

  it("names a correction that moved no grading file, and offers no regrade for it", () => {
    const dir = withSession();
    battery(dir, "run-a", { createdAt: "2026-09-19T01:00:00.000Z" });
    battery(dir, "run-b", {
      operation: "evaluation-correction",
      createdAt: "2026-09-19T02:00:00.000Z",
      files: { "correctness-model/controls.json": "[{}]" },
    });
    const report = buildGateRent({ campaign: dir });
    expect(report.corrections[0]).toMatchObject({ runId: "run-b", regrade: null });
    expect(report.corrections[0].note).toContain("correctness-model/controls.json");
    expect(triggerNames(report)).not.toContain("EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)");
  });
});

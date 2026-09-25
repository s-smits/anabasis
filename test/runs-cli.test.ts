import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { CASE_RECORD_SCHEMA } from "../src/claim/case-record.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "../src/run/difficulty-decision.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { serviceManager } from "../.claude/skills/launch-run/scripts/service.ts";
import {
  latestRun,
  parseWorktreeList,
  readLaunchRecord,
  recordedRuns,
  resolveRunSelector,
  type RunLocation,
} from "../tools/runs/discover.ts";
import {
  lastRecordedWrite,
  readCaseCounts,
  readDifficultyDecisions,
  readRunEvidence,
} from "../tools/runs/evidence.ts";
import { runLiveness, type QueryResult } from "../tools/runs/state.ts";
import { collectDetail, collectRows, splitSlug } from "../tools/runs/rows.ts";
import { recordedCondition, resumePlan } from "../tools/runs/resume.ts";
import { duration, renderList, renderShow } from "../tools/runs/format.ts";
import { stopPlanOf } from "../tools/runs/cli.ts";
import { required } from "./helpers/doubles.ts";

/** The one opening time every closed fixture records. */
const OPENED_AT = "2026-09-19T00:00:00.000Z";

/** What one recorded launch may differ in; `extra` is the argv only some launches set. */
interface LaunchOptions {
  budget?: string;
  project?: string;
  preset?: string | null;
  extra?: string[];
  tag?: string;
}

const scratch: string[] = [];
const OPUS = { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" };

type Outcome = "pass" | "unaccepted" | "non-result";

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A checkout whose parent holds the run worktrees, as the launcher lays them out. */
function checkout(): string {
  const parent = mkdtempSync(join(tmpdir(), "ana-runs-cli-"));
  scratch.push(parent);
  const root = join(parent, "harness-builder-v4");
  mkdirSync(join(root, "campaigns"), { recursive: true });
  return root;
}

function writeJson(path: string, value: JsonObject): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function writeOpening(root: string, slug: string, runId: string, writtenAt: string): string {
  const campaignDir = join(root, "campaigns", slug);
  writeJson(join(campaignDir, "controller", runId, "opening.json"), {
    writtenAt,
    source: { commit: "a".repeat(40), sourceDigest: "b".repeat(64), dirty: false },
    project: { id: slug },
    epoch: { key: "epoch-1" },
    modelSlots: { builder: OPUS, built: OPUS, review: { ...OPUS, enabled: true } },
    providerResourceBudget: { cap: 1320, used: 0 },
  });
  return campaignDir;
}

function writeTerminal(campaignDir: string, runId: string, writtenAt: string, used: number): void {
  writeJson(join(campaignDir, "controller", runId, "terminal.json"), {
    writtenAt,
    outcome: "aborted",
    abortClause: "signal-terminated",
    terminalReason: "signal-terminated: fullrun received SIGTERM",
    iterations: [{ runId, measured: true }],
    providerResourceBudget: { cap: 1320, used, byRole: { builder: 1, built: 8, review: 8 } },
  });
}

function caseLine(seq: number, runId: string, outcome: Outcome): string {
  const row = {
    schema: CASE_RECORD_SCHEMA,
    runId,
    builderId: "builder-1",
    slug: "slug",
    buildInputsHash: "h",
    backendPin: "claude/claude-opus-5",
    taskId: `task-${seq}`,
    family: "family-a",
    acceptedSubmit: outcome === "pass",
    truthOk: outcome === "pass" ? true : null,
    pass: outcome === "pass" ? true : outcome === "unaccepted" ? false : null,
    runtimeNonResult: outcome === "non-result" ? "provider refused" : null,
    runtimeNonResultKind: outcome === "non-result" ? "provider" : null,
    isolation: null,
    condition: null,
    traces: [],
  };
  return `${JSON.stringify({ seq, row })}\n`;
}

function writeCases(campaignDir: string, lines: string[]): void {
  writeFileSync(join(campaignDir, "case-record.jsonl"), lines.join(""));
}

/** `--expected-tasks` is on every recorded launch. */
function writeLaunch(root: string, runId: string, prompt: string, launch: LaunchOptions = {}): string {
  const { budget = "1320", project = "slug", preset = "truss", extra = [], tag = "" } = launch;
  const dir = join(root, "..", `ana-run-${runId}${tag}`);
  mkdirSync(join(dir, ".scratch", "quick-run"), { recursive: true });
  writeFileSync(
    join(dir, ".scratch", "quick-run", "launch.json"),
    JSON.stringify({
      runId,
      dir,
      service: `gui/501/ana.fullrun.${runId}${tag}`,
      log: join(dir, ".scratch", "quick-run", "fullrun.log"),
      preset,
      condition: "opus",
      budget,
      project,
      argv: [
        "bun",
        "run",
        "fullrun",
        "--prompt",
        prompt,
        "--provider-turn-budget",
        budget,
        "--expected-tasks",
        "25",
        ...extra,
      ],
    }),
  );
  return dir;
}

/** The one run a fixture recorded; a fixture that recorded none is a broken test, not an absence. */
function onlyRun(root: string): RunLocation {
  const run = recordedRuns(root)[0];
  if (run === undefined) throw new Error("the fixture recorded no run");
  return run;
}

const manager = serviceManager("darwin");
const label = (runId: string) => `ana.fullrun.${runId}`;
const launchdRunning = (dir: string, runId: string) =>
  `path = ${join(dir, ".launchd", `${label(runId)}.plist`)}\n\tpid = 4242\n\tstate = running`;
const answer = (out: string, code = 0): QueryResult => ({ code, out });
/** What the service manager answers about a run it holds no record of. */
const noService = (): QueryResult => answer("Could not find service", 1);

describe("runs list", () => {
  it("separates a closed run, an orphaned one and a live one, and counts each run's own cases", () => {
    const root = checkout();
    const closedDir = writeOpening(root, "slug-aaaaaaaa-1", "closed-run", OPENED_AT);
    writeTerminal(closedDir, "closed-run", "2026-09-19T02:00:00.000Z", 102);
    writeCases(closedDir, [
      caseLine(1, "closed-run", "pass"),
      caseLine(2, "closed-run", "unaccepted"),
      caseLine(3, "closed-run", "non-result"),
      caseLine(4, "another-run", "pass"),
    ]);
    writeOpening(root, "slug-bbbbbbbb-2", "orphan-run", "2026-09-18T00:00:00.000Z");
    writeOpening(root, "slug-cccccccc-3", "live-run", "2026-09-20T00:00:00.000Z");
    const liveDir = writeLaunch(root, "live-run", "designs steel roof trusses to Eurocode 3", {
      project: "slug-cccccccc-3",
    });

    const rows = collectRows(root, {
      closedLimit: 8,
      manager,
      now: Date.parse("2026-09-20T03:00:00.000Z"),
      query: (argv) =>
        argv.includes(`gui/501/ana.fullrun.live-run`)
          ? answer(launchdRunning(liveDir, "live-run"))
          : noService(),
    });

    expect(rows.map((row) => [row.runId, row.liveness.state])).toEqual([
      ["live-run", "live"],
      ["orphan-run", "orphaned"],
      ["closed-run", "closed"],
    ]);
    const live = rows[0];
    const closed = rows[2];
    expect(live?.liveness.pid).toBe(4242);
    expect(live?.worktree).toBe(liveDir);
    expect(live?.domain).toBe("slug");
    expect(live?.project).toBe("cccccccc-3");
    // A live run's turn counter lives only in the ledger its owner holds open, so it stays unknown.
    expect(live?.turnsUsedKnown).toBe(false);
    expect(live?.turnsUsed).toBeNull();
    expect(live?.cap).toBe(1320);
    expect(closed?.turnsUsed).toBe(102);
    expect(closed?.cases.tally).toMatchObject({ verified: 1, unaccepted: 1, nonResults: 1 });
    expect(closed?.cases.batteries.map((battery) => battery.runId)).toEqual(["closed-run"]);
    expect(closed?.cases.batteries[0]?.tally).toMatchObject({ verified: 1, unaccepted: 1, nonResults: 1 });
    const text = renderList(rows);
    expect(text).toContain("unknown/1320");
    expect(text).toContain("1v 1u 1n");
    expect(text).toContain("2 open, 1 closed shown");
    // The detail derives the closed run's counts from its measured iteration's case rows alone.
    const detail = collectDetail(root, "closed-run", {
      closedLimit: 8,
      manager,
      now: Date.parse("2026-09-20T03:00:00.000Z"),
      query: () => answer("Could not find service", 1),
    });
    if (detail.detail === undefined) throw new Error(detail.refusal);
    expect(renderShow(detail.detail, [])).toContain(
      "denominator: 3 cases — 1 verified, 1 unaccepted, 1 non-result",
    );
  });

  it("keeps the newest closed runs only, and lists every open one", () => {
    const root = checkout();
    for (let index = 0; index < 4; index += 1) {
      const runId = `closed-${index}`;
      const dir = writeOpening(root, `slug-aaaaaaaa-${index}`, runId, `2026-09-1${index}T00:00:00.000Z`);
      writeTerminal(dir, runId, `2026-09-1${index}T01:00:00.000Z`, 10);
    }
    const rows = collectRows(root, {
      closedLimit: 2,
      manager,
      query: noService,
    });
    expect(rows.map((row) => row.runId)).toEqual(["closed-3", "closed-2"]);
  });

  it("names damaged evidence instead of dropping the run, and ignores a directory with no opening", () => {
    const root = checkout();
    const campaignDir = join(root, "campaigns", "slug-aaaaaaaa-1");
    mkdirSync(join(campaignDir, "controller", "broken-run"), { recursive: true });
    writeFileSync(join(campaignDir, "controller", "broken-run", "opening.json"), "{not json");
    mkdirSync(join(campaignDir, "controller", "no-opening"), { recursive: true });

    expect(recordedRuns(root).map((run) => run.runId)).toEqual(["broken-run"]);
    const rows = collectRows(root, {
      closedLimit: 8,
      manager,
      query: noService,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.damaged[0]).toContain("opening.json unreadable");
    expect(rows[0]?.cap).toBeNull();
    expect(renderList(rows)).toContain("opening.json unreadable");
  });

  it("reads a run's last recorded write from its own evidence, never a file timestamp", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    mkdirSync(join(campaignDir, "observability"), { recursive: true });
    writeFileSync(
      join(campaignDir, "observability", "run-1.jsonl"),
      `${JSON.stringify({ at: "2026-09-19T05:00:00.000Z", phase: "measure-on", type: "prompt-ingested", subjectId: "bracket-b" })}\n`,
    );
    writeJson(join(campaignDir, "epoch-1", "builder-execution.json"), {
      writtenAt: "2026-09-19T03:00:00.000Z",
      turns: 7,
    });

    const evidence = readRunEvidence(onlyRun(root));
    expect(lastRecordedWrite(evidence)).toEqual({ at: "2026-09-19T05:00:00.000Z", source: "observability" });
    expect(evidence.authoring).toEqual({ writtenAt: "2026-09-19T03:00:00.000Z", turns: 7 });
    const detail = collectDetail(root, "run-1", {
      closedLimit: 8,
      manager,
      now: Date.parse("2026-09-19T06:00:00.000Z"),
      query: noService,
    });
    if (detail.detail === undefined) throw new Error(detail.refusal);
    expect(detail.detail.row.position).toBe("measure-on bracket-b");
    expect(detail.detail.row.gapMs).toBe(3_600_000);
    expect(renderShow(detail.detail, [])).toContain("1h 0m ago");
  });

  it("refuses a selector that names two runs and takes a project name over a partial id", () => {
    const root = checkout();
    // The launcher names a run <preset>-<condition>-<stamp>-<hex>, so every run of one project
    // shares a long head. An abbreviation is the normal way to type one, and `runs stop` sends a
    // signal while `runs resume --yes` spends provider turns reproducing the run it chose.
    writeOpening(root, "truss", "truss-opus-20260919T192747000Z-d18bef", OPENED_AT);
    writeOpening(root, "truss", "truss-opus-20260920T081500000Z-4ac221", "2026-09-20T00:00:00.000Z");
    const options = { closedLimit: 8, manager, query: noService };

    const ambiguous = collectDetail(root, "truss-opus", options);
    expect(ambiguous.detail).toBeUndefined();
    expect(ambiguous.refusal).toContain("names 2 recorded runs");
    expect(ambiguous.refusal).toContain("d18bef");
    expect(ambiguous.refusal).toContain("4ac221");

    // "truss" is the project and also the head of both run ids. The project answer is the one
    // the operator asked for, and it is still one run short of an answer.
    expect(collectDetail(root, "truss", options).refusal).toContain("names 2 recorded runs");
    expect(collectDetail(root, "nothing-like-this", options).refusal).toContain("no recorded run matches");
    expect(collectDetail(root, "truss-opus-20260920T081500000Z-4ac221", options).detail?.row.runId).toBe(
      "truss-opus-20260920T081500000Z-4ac221",
    );
    expect(collectDetail(root, "truss-opus-20260920T", options).detail?.row.runId).toBe(
      "truss-opus-20260920T081500000Z-4ac221",
    );
  });

  it("joins each campaign's row to its own receipt, and refuses to choose between the two runs", () => {
    const root = checkout();
    // A run id is admitted inside one campaign, not across them: `fullrun --run <id>` under a
    // second `--project` records the same id twice. The receipts were keyed by id alone, so both
    // rows took the first one walked and `stop --yes` signalled that service while printing the
    // other campaign's row.
    const runId = "truss-opus-20260920T081500000Z-4ac221";
    writeOpening(root, "truss-aaaaaaaa-1", runId, "2026-09-20T00:00:00.000Z");
    writeOpening(root, "truss-bbbbbbbb-2", runId, "2026-09-20T01:00:00.000Z");
    writeLaunch(root, runId, "designs steel roof trusses to Eurocode 3", {
      project: "truss-aaaaaaaa-1",
      tag: "-first",
    });
    writeLaunch(root, runId, "designs steel roof trusses to Eurocode 3", {
      project: "truss-bbbbbbbb-2",
      tag: "-second",
    });
    const options = { closedLimit: 8, manager, query: noService };

    const worktrees = new Map(collectRows(root, options).map((row) => [row.slug, row.worktree ?? ""]));
    expect(worktrees.get("truss-aaaaaaaa-1")).toContain("-first");
    expect(worktrees.get("truss-bbbbbbbb-2")).toContain("-second");

    // The selector still has two answers to one question, and only the operator can say which.
    const chosen = collectDetail(root, runId, options);
    expect(chosen.detail).toBeUndefined();
    expect(chosen.refusal).toContain("truss-aaaaaaaa-1");
    expect(chosen.refusal).toContain("truss-bbbbbbbb-2");
  });
});

describe("the receipt a stop may act on", () => {
  const runId = "truss-opus-20260920T081500000Z-4ac221";
  const prompt = "designs steel roof trusses to Eurocode 3";
  const options = { closedLimit: 8, manager, query: noService };

  it("never lends one campaign's receipt to another, even when it is the only one left", () => {
    // Campaigns A and B share a run id and A's launch worktree was pruned. The single receipt used
    // to join A as it stood, and `runs stop A --yes` would have signalled B's service.
    const root = checkout();
    writeOpening(root, "truss-aaaaaaaa-1", runId, "2026-09-20T00:00:00.000Z");
    writeOpening(root, "truss-bbbbbbbb-2", runId, "2026-09-20T01:00:00.000Z");
    writeLaunch(root, runId, prompt, { project: "truss-bbbbbbbb-2" });
    const chosen = required(collectDetail(root, "truss-aaaaaaaa-1", options).detail, "campaign A");
    expect(chosen.launch).toBeNull();
    expect(stopPlanOf(chosen, 1000).refusal).toContain("no launcher receipt");
    const own = required(collectDetail(root, "truss-bbbbbbbb-2", options).detail, "campaign B");
    expect(own.launch?.project).toBe("truss-bbbbbbbb-2");
  });

  it("shows a receipt that names no campaign but refuses to stop through it", () => {
    const root = checkout();
    writeOpening(root, "truss-aaaaaaaa-1", runId, "2026-09-20T00:00:00.000Z");
    const dir = writeLaunch(root, runId, prompt, { project: "truss-aaaaaaaa-1" });
    const receipt = join(dir, ".scratch", "quick-run", "launch.json");
    const bound = required(collectDetail(root, runId, options).detail, "bound run");
    expect(stopPlanOf(bound, 1000).plan?.service).toContain(runId);
    const legacy: JsonObject = { ...required(readLaunchRecord(dir), "receipt"), argv: [] };
    delete legacy.project;
    writeFileSync(receipt, JSON.stringify(legacy));
    const unbound = required(collectDetail(root, runId, options).detail, "unbound run");
    expect(unbound.launch?.dir).toBe(dir);
    expect(stopPlanOf(unbound, 1000).refusal).toContain("does not name campaign truss-aaaaaaaa-1");
  });
});

describe("run liveness", () => {
  const base = {
    runId: "run-1",
    campaignDir: "/nowhere",
    terminalRecorded: false,
    service: "gui/501/ana.fullrun.run-1",
    worktree: "/tmp/owned-run",
    unfinishedInCampaign: 1,
  };

  it("reports the state the service manager proves, and refuses a service bound elsewhere", () => {
    expect(runLiveness(base, () => answer(launchdRunning("/tmp/owned-run", "run-1")), manager)).toEqual({
      state: "live",
      pid: 4242,
      detail: "launchd reports gui/501/ana.fullrun.run-1 running",
    });
    expect(
      runLiveness(
        base,
        () => answer(`path = /tmp/owned-run/.launchd/${label("run-1")}.plist\n\tstate = not running`),
        manager,
      ),
    ).toMatchObject({ state: "service-stopped", pid: null });
    expect(
      runLiveness(base, () => answer("path = /tmp/foreign/.launchd/other.plist\n\tstate = running"), manager),
    ).toMatchObject({
      state: "unknown",
      detail: "launchd bound gui/501/ana.fullrun.run-1 to another worktree",
    });
    expect(runLiveness(base, () => answer("permission denied", 1), manager)).toMatchObject({
      state: "unknown",
    });
  });

  it("closes on recorded terminal evidence and orphans a run no signal claims", () => {
    expect(
      runLiveness(
        { ...base, terminalRecorded: true },
        () => answer(launchdRunning("/tmp/owned-run", "run-1")),
        manager,
      ),
    ).toEqual({
      state: "closed",
      pid: null,
      detail: "terminal evidence recorded",
    });
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    // No service and no lock: the process is gone and nothing recorded a terminal.
    expect(runLiveness({ ...base, campaignDir, service: null }, () => answer("", 1), manager)).toEqual({
      state: "orphaned",
      pid: null,
      detail: "no service, no campaign lock",
    });
  });

  it("attributes a held campaign lock to one run only while one opening is unfinished", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeJson(join(campaignDir, ".controller.lock"), {
      pid: process.pid,
      startTime: null,
      hostname: null,
      startedAt: OPENED_AT,
      token: "t",
    });
    const held = runLiveness({ ...base, campaignDir, service: null }, () => answer("", 1), manager);
    expect(held).toMatchObject({
      state: "live",
      pid: process.pid,
      detail: "campaign lock held by a live holder",
    });
    const shared = runLiveness(
      { ...base, campaignDir, service: null, unfinishedInCampaign: 2 },
      () => answer("", 1),
      manager,
    );
    expect(shared).toMatchObject({
      state: "unknown",
      detail: "campaign lock held, 2 unfinished openings share it",
    });
  });
});

describe("resume", () => {
  it("rebuilds the continuation from the run's own opening and launcher receipt", () => {
    const root = checkout();
    writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    const dir = writeLaunch(root, "run-1", "designs steel roof trusses to Eurocode 3", {
      project: "slug-aaaaaaaa-1",
    });
    const evidence = readRunEvidence(onlyRun(root));
    const plan = resumePlan(evidence.opening, readLaunchRecord(dir));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.command).toEqual([
      "bun",
      ".claude/skills/launch-run/scripts/launch.ts",
      "custom",
      "--model",
      "opus",
      "--budget",
      "1320",
      "--project",
      "slug-aaaaaaaa-1",
      "--prompt",
      "designs steel roof trusses to Eurocode 3",
      "--tasks",
      "25",
    ]);
    expect(plan.plan.warnings).toEqual([]);
    expect(recordedCondition(evidence.opening?.slots ?? [])).toBe("opus");
  });

  it("refuses rather than inventing a prompt, and warns when the receipt and the opening disagree", () => {
    const root = checkout();
    writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    const evidence = readRunEvidence(onlyRun(root));
    const missing = resumePlan(evidence.opening, null);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.missing.join(" ")).toContain("launch.json");
    expect(resumePlan(null, null).ok).toBe(false);

    const dir = writeLaunch(root, "run-1", "designs steel roof trusses to Eurocode 3", {
      budget: "40",
      project: "slug-aaaaaaaa-1",
    });
    const differing = resumePlan(evidence.opening, readLaunchRecord(dir));
    expect(differing.ok).toBe(true);
    if (!differing.ok) return;
    expect(differing.plan.warnings[0]).toContain("the opening's count is used");
    expect(differing.plan.command).toContain("1320");
  });

  it("continues a custom run from the recorded prompt when the receipt names no preset", () => {
    const root = checkout();
    writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    const evidence = readRunEvidence(onlyRun(root));
    // The prompt is the whole input, so a receipt without a preset name withholds nothing a
    // continuation needs. `presetOf` returning null already says the launcher is told `custom`.
    const dir = writeLaunch(root, "run-1", "writes shell completions for a CLI", {
      project: "slug-aaaaaaaa-1",
      preset: null,
    });
    const plan = resumePlan(evidence.opening, readLaunchRecord(dir));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.command.slice(0, 3)).toEqual([
      "bun",
      ".claude/skills/launch-run/scripts/launch.ts",
      "custom",
    ]);
    expect(plan.plan.command.slice(-4)).toEqual([
      "--prompt",
      "writes shell completions for a CLI",
      "--tasks",
      "25",
    ]);
    expect(plan.plan.provenance[0]).toContain("passed verbatim");
  });

  it("carries the battery size and the boundary the stopped run was launched under", () => {
    const root = checkout();
    writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    // The launcher defaults `--tasks` to 25 and neither boundary at all, so a continuation of a
    // 60-task run stopped at a soft wall used to launch an unbounded 25-task one under the word
    // "resume" — a changed measurement condition the printed command did not show.
    const dir = writeLaunch(root, "run-1", "designs steel roof trusses to Eurocode 3", {
      project: "slug-aaaaaaaa-1",
      extra: ["--max-iterations", "6", "--stop-after-ms", "43200000"],
    });
    const bounded = readLaunchRecord(dir);
    if (bounded === null) throw new Error("the fixture wrote no launcher receipt");
    bounded.argv[bounded.argv.indexOf("--expected-tasks") + 1] = "60";
    const plan = resumePlan(readRunEvidence(onlyRun(root)).opening, bounded);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.command.slice(-6)).toEqual([
      "--tasks",
      "60",
      "--max-iterations",
      "6",
      "--stop-after-ms",
      "43200000",
    ]);
    expect(plan.plan.provenance.at(-1)).toBe(
      "battery and boundary: --tasks 60, --max-iterations 6, --stop-after-ms 43200000",
    );
  });
});

describe("run selection", () => {
  it("takes a campaign's latest run by the instant its opening recorded, not by directory name", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-10", "2026-09-19T00:00:00.000Z");
    writeOpening(root, "slug-aaaaaaaa-1", "run-9", "2026-09-18T00:00:00.000Z");
    writeOpening(root, "slug-aaaaaaaa-1", "run-9b", "2026-09-17T00:00:00.000Z");
    // By name `run-9b` is last and `run-10` first; a reader taking the last name opened the oldest.
    expect(latestRun(campaignDir)?.runId).toBe("run-10");
    expect(resolveRunSelector(campaignDir)).toEqual({
      campaign: campaignDir,
      runId: "run-10",
      chosen: "latest of 3 runs by opening writtenAt",
    });
    expect(resolveRunSelector(join(campaignDir, "controller", "run-9"))).toMatchObject({ runId: "run-9" });
    expect(() => resolveRunSelector(join(campaignDir, "controller", "run-9"), "run-10")).toThrow(
      "folder names run run-9 but --run says run-10",
    );
  });

  it("leaves an undated opening out of the order rather than guessing where it goes", () => {
    const root = checkout();
    const campaignDir = join(root, "campaigns", "slug-aaaaaaaa-1");
    writeJson(join(campaignDir, "controller", "undated", "opening.json"), { runId: "undated" });
    expect(latestRun(campaignDir)).toBeNull();
    expect(() => resolveRunSelector(campaignDir)).toThrow("no run with a dated opening.json");
  });

  it("parses every worktree's path, head and branch from one porcelain listing", () => {
    const listing = [
      "worktree /repo",
      "HEAD " + "a".repeat(40),
      "branch refs/heads/main",
      "",
      "worktree /repo-run",
      "HEAD " + "b".repeat(40),
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreeList(listing)).toEqual([
      { path: "/repo", head: "a".repeat(40), branch: "refs/heads/main" },
      { path: "/repo-run", head: "b".repeat(40), branch: null },
    ]);
  });
});

describe("row and column helpers", () => {
  it("splits a campaign slug into the domain and the project on it", () => {
    expect(splitSlug("design-lightweight-steel-trusses-3fd52f9e-15")).toEqual({
      domain: "design-lightweight-steel-trusses",
      project: "3fd52f9e-15",
    });
    expect(splitSlug("no-digest")).toEqual({ domain: "no-digest", project: "no-digest" });
  });

  it("renders a duration in its two largest informative units and says unknown for none", () => {
    expect(duration(null)).toBe("unknown");
    expect(duration(0)).toBe("0s");
    expect(duration(90_000)).toBe("1m 30s");
    expect(duration(3 * 86_400_000 + 4 * 3_600_000 + 61_000)).toBe("3d 4h");
  });

  it("counts a battery's own rows and only its own", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeCases(campaignDir, [
      caseLine(1, "run-1", "pass"),
      caseLine(2, "run-1-i02", "pass"),
      caseLine(3, "run-2", "pass"),
      caseLine(4, "run-1-b", "pass"),
      caseLine(5, "run-1-i2", "pass"),
    ]);
    const counts = readCaseCounts(onlyRun(root));
    // A relaunch suffix (`run-1-b`) and an unpadded round (`run-1-i2`) share the prefix but are not
    // iterations the controller writes; the old prefix test counted both as this run's.
    expect(counts.tally).toMatchObject({ verified: 2, unaccepted: 0, nonResults: 0 });
    expect(counts.batteries.map((battery) => battery.runId)).toEqual(["run-1", "run-1-i02"]);
  });

  it("reports an unreadable case record as unknown rather than zero", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeFileSync(join(campaignDir, "case-record.jsonl"), "{not a row}\n");
    const rows = collectRows(root, {
      closedLimit: 8,
      manager,
      query: noService,
    });
    expect(rows[0]?.cases.tally).toBeNull();
    expect(renderList(rows)).toContain("unreadable");
  });
});

/**
 * The climb-readout wording is part of the measured condition: a Builder told different sentences
 * about the band was answering a different question, so two batteries rendered from different
 * frames are two conditions however alike their counts look. A `difficulty-decisions/` record is
 * the only place that wording is witnessed — the record keeps the counts and the identities the
 * decision was read over, never the sentences it produced.
 */
describe("the climb wording batteries were authored under", () => {
  const FRAME_A = "68b53b674476ae7a9db1d27e7668812fbd4cd574a047e9b7ab84b3cdfee6c431";
  const FRAME_B = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const CURRENT_SCHEMA = DIFFICULTY_DECISION_SCHEMA;
  const RETIRED_SCHEMA = "difficulty-decision/v3";

  /** One `difficulty-decisions/` record in the shape `recordDifficultyDecision` writes. A null
   *  frame omits the field, which under the current schema is an incomplete record rather than an
   *  older one. The schema is a parameter because a recorded corpus holds more than one, and the
   *  record's body cannot say which. */
  function writeDecision(
    campaignDir: string,
    runId: string,
    frame: string | null,
    schema: string = CURRENT_SCHEMA,
  ): void {
    writeJson(join(campaignDir, "difficulty-decisions", `${runId}.json`), {
      schema,
      runId,
      slug: "slug",
      digest: `${runId}-digest`,
      ...keyIfNotNull("frame", frame),
      difficulty: {
        admitted: 1,
        decision: {
          rationale: `${runId} placed on the band`,
          evidence: [{ runId, batterySha256: "c".repeat(64) }],
          placement: { passes: 9, n: 25, zone: "on-aim" },
        },
      },
    });
  }

  /** A run with two recorded batteries, each with its own decision. */
  function twoBatteries(first: string | null, second: string | null): string {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeCases(campaignDir, [caseLine(1, "run-1-i02", "pass"), caseLine(2, "run-1-i03", "pass")]);
    writeDecision(campaignDir, "run-1-i02", first);
    writeDecision(campaignDir, "run-1-i03", second);
    const chosen = collectDetail(root, "run-1", {
      closedLimit: 8,
      manager,
      query: noService,
    });
    return renderShow(required(chosen.detail, "run-1"), []);
  }

  it("reads the current schema and refuses every other, rather than reading both as one set", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeDecision(campaignDir, "run-1-i02", FRAME_A, RETIRED_SCHEMA);
    writeDecision(campaignDir, "run-1-i03", FRAME_B, CURRENT_SCHEMA);
    const decisions = readDifficultyDecisions(onlyRun(root));
    // Both records say `placed`, so nothing in the row separates the retired selector's word from
    // the band owner's. The reader takes the one it can account for and names the other as refused.
    expect(decisions.rows.map((row) => row.frame)).toEqual([FRAME_B]);
    expect(decisions.refused).toEqual([RETIRED_SCHEMA]);
  });

  it("refuses a current-schema record missing a mandatory field instead of reading it as null", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeDecision(campaignDir, "run-1-i02", null, CURRENT_SCHEMA);
    const decisions = readDifficultyDecisions(onlyRun(root));
    // v5 declares `frame` mandatory, so a record without one is damaged rather than older. Admitting
    // it as a row with a null frame is what would put the nullability back into every reader above.
    expect(decisions.rows).toEqual([]);
    expect(decisions.refused).toEqual([`${CURRENT_SCHEMA} incomplete`]);
  });

  it("reads each decision's placement and evidence, in round order past two padded digits", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeDecision(campaignDir, "run-1-i100", FRAME_A);
    writeDecision(campaignDir, "run-1-i99", FRAME_A);
    const decisions = readDifficultyDecisions(onlyRun(root));
    expect(decisions.rows.map((row) => [row.runId, row.placement, row.admitted, row.evidenceRunIds])).toEqual(
      [
        ["run-1-i99", { passes: 9, n: 25, zone: "on-aim" }, 1, ["run-1-i99"]],
        ["run-1-i100", { passes: 9, n: 25, zone: "on-aim" }, 1, ["run-1-i100"]],
      ],
    );
  });

  it("names one frame for the run's batteries, since a run is one process", () => {
    const shown = twoBatteries(FRAME_A, FRAME_A);
    expect(shown).toContain(`Climb wording: ${FRAME_A.slice(0, 12)}`);
    expect(shown).not.toContain("Climb records refused");
  });

  it("says how many records it refused and under which versions, rather than omitting them", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeCases(campaignDir, [caseLine(1, "run-1-i02", "pass"), caseLine(2, "run-1-i03", "pass")]);
    writeDecision(campaignDir, "run-1-i02", FRAME_A, RETIRED_SCHEMA);
    writeDecision(campaignDir, "run-1-i03", FRAME_B, CURRENT_SCHEMA);
    const shown = renderShow(
      required(collectDetail(root, "run-1", { closedLimit: 8, manager, query: noService }).detail, "run-1"),
      [],
    );
    // A battery whose record this reader will not open must not read like a battery that never ran.
    expect(shown).toContain(`Climb records refused: 1 (${RETIRED_SCHEMA})`);
    expect(shown).toContain(`not ${CURRENT_SCHEMA}`);
    expect(shown).toContain(`Climb wording: ${FRAME_B.slice(0, 12)}`);
  });

  it("says nothing about wording when the run recorded no decision at all", () => {
    const root = checkout();
    const campaignDir = writeOpening(root, "slug-aaaaaaaa-1", "run-1", OPENED_AT);
    writeCases(campaignDir, [caseLine(1, "run-1-i02", "pass")]);
    const chosen = collectDetail(root, "run-1", {
      closedLimit: 8,
      manager,
      query: noService,
    });
    expect(renderShow(required(chosen.detail, "run-1"), [])).not.toContain("Climb wording");
  });
});

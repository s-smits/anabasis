import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  freezePrediction,
  ledgerPath,
} from "../.claude/skills/run-improvement-campaign/scripts/prediction.mjs";
import {
  batteryCounts,
  caseKind,
  harnessMetrics,
  newestWriteMs,
  openCases,
  processAlive,
  readBuilderSession,
  readCampaignsStatus,
  readRunStatus,
  renderStatus,
  runTmpRoot,
  safeguardCounts,
  sessionWriteMs,
} from "../.claude/skills/run-improvement-campaign/scripts/status.mjs";

function caseLine(runId, taskId, fields) {
  return `${JSON.stringify({ seq: 1, row: { schema: "case-record/v1", runId, taskId, acceptedSubmit: true, truthOk: true, pass: true, runtimeNonResult: null, ...fields } })}\n`;
}

/** One `difficulty-decisions/` record in the shape the controller writes (`difficulty-decision/v4`,
 *  campaign design-lightweight-steel-trusses-3fd52f9e-28, 2026-09-17). */
function decisionRecord(battery, action, { passes = 24, zone = "too-easy" } = {}) {
  const placement = { passes, n: 25, lo: 0.8, hi: 0.99, zone, aim: [5, 12], toAim: -12 };
  return JSON.stringify({
    schema: "difficulty-decision/v4",
    runId: battery,
    difficulty: {
      decision: { action, rationale: "…", evidence: [], findings: [], placement },
      saturatedClimbs: 1,
      band: [0.2, 0.5],
    },
  });
}

/** @param {{ terminal?: Record<string, unknown> | null, lockPid?: number | null, cases?: string,
 *            safeguards?: string | null, decisions?: [string, string][],
 *            battery?: { runId: string, open: string[], wall?: number } | null }} [written] */
function campaign(
  root,
  slug,
  runId,
  {
    terminal = null,
    lockPid = null,
    cases = "",
    safeguards = null,
    decisions = [],
    battery = null,
    batteries = [],
  } = {},
) {
  const dir = join(root, slug);
  mkdirSync(join(dir, "controller", runId), { recursive: true });
  writeFileSync(
    join(dir, "controller", runId, "opening.json"),
    JSON.stringify({
      runId,
      source: { commit: "a".repeat(40), dirty: false },
      modelSlots: {
        slug,
        builder: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        built: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" },
        review: { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "medium" },
      },
      providerResourceBudget: { cap: 1320, used: 0 },
    }),
  );
  if (terminal !== null) {
    writeFileSync(join(dir, "controller", runId, "terminal.json"), JSON.stringify(terminal));
  }
  if (lockPid !== null) writeFileSync(join(dir, ".controller.lock"), JSON.stringify({ pid: lockPid }));
  if (cases.length > 0) writeFileSync(join(dir, "case-record.jsonl"), cases);
  if (safeguards !== null) {
    mkdirSync(join(dir, "safeguards", runId), { recursive: true });
    writeFileSync(join(dir, "safeguards", runId, "SAFEGUARDS_LOG.txt"), safeguards);
  }
  for (const [name, record] of decisions) {
    mkdirSync(join(dir, "difficulty-decisions"), { recursive: true });
    writeFileSync(join(dir, "difficulty-decisions", name), record);
  }
  for (const extra of battery === null ? batteries : [battery, ...batteries]) {
    // The shape a retained version writes: one directory per case the battery opened, beside the
    // `backends.json` that binds the battery to this run's source and slots.
    const slots = { kind: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" };
    const runDir = join(dir, "versions", runId, "runs", extra.runId);
    for (const taskId of extra.open) mkdirSync(join(runDir, "cases", taskId), { recursive: true });
    writeFileSync(
      join(runDir, "backends.json"),
      JSON.stringify({
        slug,
        source: { commit: "a".repeat(40), dirty: false },
        builder: slots,
        built: slots,
        review: { ...slots, reasoningEffort: "medium" },
      }),
    );
    mkdirSync(join(dir, "versions", runId, "agent"), { recursive: true });
    writeFileSync(
      join(dir, "versions", runId, "agent", "config.yaml"),
      `solver:\n  solve_minutes: ${extra.wall ?? 120}\n  max_turns: 24\n`,
    );
  }
  mkdirSync(join(dir, "epoch-abc"), { recursive: true });
  return dir;
}

describe("case partition", () => {
  it("retains the legacy status partition, including null verdicts without a typed cause", () => {
    expect(caseKind({ acceptedSubmit: true, truthOk: false, pass: false, runtimeNonResult: null })).toBe(
      "verified",
    );
    expect(caseKind({ acceptedSubmit: false, truthOk: null, pass: false, runtimeNonResult: null })).toBe(
      "unaccepted",
    );
    expect(
      caseKind({ acceptedSubmit: false, truthOk: null, pass: null, runtimeNonResult: { kind: "provider" } }),
    ).toBe("nonResult");
    expect(caseKind({ acceptedSubmit: false, truthOk: null, pass: null, runtimeNonResult: null })).toBe(
      "nonResult",
    );
  });

  it("counts per battery and never reads an unaccepted pass:false as a verified failure", () => {
    const text =
      caseLine("r1-on", "t1", {}) +
      caseLine("r1-on", "t2", { truthOk: false, pass: false }) +
      caseLine("r1-on", "t3", { acceptedSubmit: false, truthOk: null, pass: false }) +
      caseLine("r1-off", "t1", {
        acceptedSubmit: false,
        truthOk: null,
        pass: null,
        runtimeNonResult: { kind: "provider" },
      }) +
      "not json\n";
    /** @param {string | null} [why] the recorded non-result kind, absent on a scored case */
    const seen = (taskId, kind, pass, why = null) => ({ taskId, family: null, kind, pass, why });
    expect(batteryCounts(text)).toEqual([
      {
        runId: "r1-on",
        verified: 2,
        passed: 1,
        unaccepted: 1,
        nonResult: 0,
        cases: [seen("t1", "verified", true), seen("t2", "verified", false), seen("t3", "unaccepted", false)],
      },
      {
        runId: "r1-off",
        verified: 0,
        passed: 0,
        unaccepted: 0,
        nonResult: 1,
        cases: [seen("t1", "nonResult", false, "provider")],
      },
    ]);
  });
});

describe("Builder session", () => {
  it("counts refused runs, repeated findings, checks and environment previews in the newest epoch, restarting at acceptance", () => {
    const dir = campaign(mkdtempSync(join(tmpdir(), "builder-session-")), "truss", "run1");
    expect(readBuilderSession(dir)).toMatchObject({
      epoch: "epoch-abc",
      submits: 0,
      refusedInARow: 0,
      checksWithoutAccept: 0,
      environmentInARow: 0,
    });
    const refused = (atMs, findingsDigest) => ({ atMs, outcome: "refused", findingsDigest });
    writeFileSync(
      join(dir, "epoch-abc", "builder-execution.json"),
      JSON.stringify({
        durationMs: 30 * 60000,
        toolCalls: { byName: { mcp__harness__correctness_check: 7 } },
        submits: [refused(1, "a"), { atMs: 2, outcome: "accepted" }, refused(3, "b")],
      }),
    );
    writeFileSync(
      join(dir, "epoch-abc", "builder-execution-2.json"),
      JSON.stringify({
        durationMs: 10 * 60000,
        toolCalls: { byName: { correctness_check: 6 } },
        submits: [refused(5, "c"), refused(4, "c")],
      }),
    );
    for (const [name, nonResult] of [
      ["t1", true],
      ["t2", false],
      ["t3", true],
      ["t4", true],
    ]) {
      mkdirSync(join(dir, "epoch-abc", "trials", name), { recursive: true });
      if (nonResult === true) {
        writeFileSync(
          join(dir, "epoch-abc", "trials", name, "environment-non-result.json"),
          JSON.stringify({ kind: "census-wall-exceeded" }),
        );
      }
      utimesSync(join(dir, "epoch-abc", "trials", name), 1000 + Number(name[1]), 1000 + Number(name[1]));
    }
    expect(readBuilderSession(dir)).toEqual({
      epoch: "epoch-abc",
      submits: 5,
      refusedInARow: 3,
      sameFindingsInARow: 2,
      checksWithoutAccept: 0,
      environmentInARow: 2,
      environmentKind: "census-wall-exceeded",
      minutes: 40,
    });
    writeFileSync(
      join(dir, "epoch-abc", "builder-execution.json"),
      JSON.stringify({
        toolCalls: { byName: { mcp__harness__correctness_check: 7 } },
        submits: [refused(1, "a")],
      }),
    );
    expect(readBuilderSession(dir)).toMatchObject({ checksWithoutAccept: 13, refusedInARow: 3 });
  });
});

describe("safeguards and liveness", () => {
  it("counts fired names and malformed lines", () => {
    const log =
      "2026-09-02T01:24:55Z | 8-provider-stop-fired | battery x\n2026-09-02T01:25:00Z | 8-provider-stop-fired | battery y\nbroken line\n";
    expect(safeguardCounts(log)).toEqual({ names: [["8-provider-stop-fired", 2]], malformed: 1 });
  });

  it("reads this process as alive and a bad pid as dead", () => {
    expect(processAlive(Number(process.pid))).toBe(true);
    expect(processAlive(-1)).toBe(false);
    expect(processAlive(null)).toBe(false);
  });
});

describe("session store sampling", () => {
  it("observes source-bound Built sessions before case rows, without inventing outcomes", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-built-status-"));
    const dir = campaign(join(root, "campaigns"), "widget", "run");
    const roots = { home: join(root, "home"), tmpParent: join(root, "tmp") };
    const opening = JSON.parse(readFileSync(join(dir, "controller/run/opening.json"), "utf8"));
    const makeRun = (id, commit) => {
      const battery = join(root, "domains/widget/runs", id);
      mkdirSync(join(battery, "cases/task"), { recursive: true });
      writeFileSync(
        join(battery, "backends.json"),
        JSON.stringify({ ...opening.modelSlots, source: { commit, dirty: false } }),
      );
      writeFileSync(join(battery, "cases/task/trace.json"), "{}");
      return battery;
    };
    makeRun("other-run", opening.source.commit);
    makeRun("run-other", opening.source.commit);
    const battery = makeRun("run", "b".repeat(40));
    expect(sessionWriteMs(dir, "run", roots)).toBeNull();
    writeFileSync(
      join(battery, "backends.json"),
      JSON.stringify({ ...opening.modelSlots, source: opening.source }),
    );
    const status = readRunStatus(dir, "run", Date.now() + 1000, roots);
    expect(status.sessionWriteAgeMinutes).toBe(0);
    expect(status.batteries).toEqual([]);
    expect(status.used).toBeNull();
    expect(renderStatus({ groups: [{ source: status.source, runs: [status] }] })).toContain(
      "session wrote 0 min ago",
    );
    writeFileSync(
      join(battery, "backends.json"),
      JSON.stringify({
        ...opening.modelSlots,
        source: opening.source,
        built: { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" },
      }),
    );
    expect(sessionWriteMs(dir, "run", roots)).toBeNull();
    makeRun("run-i02", opening.source.commit);
    expect(sessionWriteMs(dir, "run", roots)).toBeGreaterThan(0);
  });

  it("observes a battery kept under the campaign's retained version", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-built-version-"));
    const dir = campaign(join(root, "campaigns"), "widget", "run");
    const roots = { home: join(root, "home"), tmpParent: join(root, "tmp") };
    const opening = JSON.parse(readFileSync(join(dir, "controller/run/opening.json"), "utf8"));
    expect(sessionWriteMs(dir, "run", roots)).toBeNull();
    const battery = join(dir, "versions/run/runs/run");
    mkdirSync(join(battery, "cases/task"), { recursive: true });
    writeFileSync(
      join(battery, "backends.json"),
      JSON.stringify({ ...opening.modelSlots, slug: "widget", source: opening.source }),
    );
    writeFileSync(join(battery, "cases/task/trace.json"), "{}");
    expect(sessionWriteMs(dir, "run", roots)).toBeGreaterThan(0);
  });

  it("reads the newest write across the Builder transcripts and the Claude CLI stores, and null with neither", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-session-store-"));
    const campaignDir = join(root, "campaigns", "widget-1");
    mkdirSync(join(campaignDir, "epoch-abc", "workspace"), { recursive: true });
    const roots = { tmpParent: join(root, "var-tmp") };
    // Files that are neither store move nothing, nor does a transcript outside an epoch.
    writeFileSync(join(campaignDir, "epoch-abc", "builder-transcript.json"), "{}\n");
    writeFileSync(join(campaignDir, "builder-events-stray.jsonl"), "{}\n");
    mkdirSync(join(runTmpRoot("run-x", roots.tmpParent), "ana-codex-app-server"), { recursive: true });
    expect(sessionWriteMs(campaignDir, "run-x", roots)).toBeNull();
    writeFileSync(join(campaignDir, "epoch-abc", "builder-events-pi-1.jsonl"), "{}\n");
    expect(sessionWriteMs(campaignDir, "run-x", roots)).toBeGreaterThan(0);
    // The CLI's transcript sits three levels under its config directory and is the newest write.
    const cliStore = join(runTmpRoot("run-x", roots.tmpParent), "ana-claude-cli-a1", "projects", "-ws");
    mkdirSync(cliStore, { recursive: true });
    const later = new Date(Date.now() + 120_000);
    writeFileSync(join(cliStore, "session.jsonl"), "{}\n");
    utimesSync(join(cliStore, "session.jsonl"), later, later);
    expect(sessionWriteMs(campaignDir, "run-x", roots)).toBeGreaterThanOrEqual(later.getTime() - 1000);
    expect(newestWriteMs(join(root, "absent"))).toBeNull();
  });
});

describe("run and campaigns status", () => {
  it("counts settled authoring iterations as activity, but ignores workspace writes", () => {
    const root = mkdtempSync(join(tmpdir(), "status-authoring-"));
    const dir = campaign(root, "slug", "run");
    const now = Date.now();
    const old = new Date(now - 180 * 60_000);
    const recent = new Date(now - 2 * 60_000);
    utimesSync(join(dir, "controller/run/opening.json"), old, old);
    const epoch = join(dir, "epoch-abc");
    mkdirSync(join(epoch, "workspace"));
    writeFileSync(join(epoch, "workspace/iteration.json"), "{}");
    const roots = { home: join(root, "home"), tmpParent: join(root, "tmp") };
    expect(readRunStatus(dir, "run", now, roots).evidenceAgeMinutes).toBe(180);
    mkdirSync(join(epoch, "13-slug"));
    const record = join(epoch, "13-slug/iteration.json");
    writeFileSync(record, JSON.stringify({ ordinal: 13, stage: "tests", outcome: "build-failed" }));
    utimesSync(record, recent, recent);
    expect(readRunStatus(dir, "run", now, roots).evidenceAgeMinutes).toBe(2);
  });

  it("reads this run's climb decisions in round order, and no other run's", () => {
    const root = mkdtempSync(join(tmpdir(), "status-climb-"));
    // The file names sort the other way round, so the order comes from the battery id, not the listing.
    const dir = campaign(root, "slug", "run", {
      decisions: [
        ["a-third.json", decisionRecord("run-i03", "hold-limit", { passes: 9, zone: "on-aim" })],
        ["b-second.json", decisionRecord("run-i02", "climb")],
        ["c-elsewhere.json", decisionRecord("other-run-i02", "ease")],
        ["d-not-json.txt", "{}"],
      ],
    });
    const rows = readRunStatus(dir, "run", Date.now(), {
      home: join(root, "home"),
      tmpParent: join(root, "tmp"),
    }).difficulty;
    expect(rows.map((row) => `${row.battery} ${row.action} ${row.placement}`)).toEqual([
      "run-i02 climb 24/25 too-easy",
      "run-i03 hold-limit 9/25 on-aim",
    ]);
    // The zone the streak counter reads, carried beside the sentence rather than parsed back out of it.
    expect(rows.map((row) => row.zone)).toEqual(["too-easy", "on-aim"]);
    // A campaign that has decided nothing yet is an empty list, not a missing field.
    expect(
      readRunStatus(campaign(root, "fresh", "run"), "run", Date.now(), {
        home: join(root, "home"),
        tmpParent: join(root, "tmp"),
      }).difficulty,
    ).toEqual([]);
  });

  it("reports a live run with partial batteries and open predictions, grouped by source", () => {
    const root = mkdtempSync(join(tmpdir(), "status-"));
    // The ledger the documented freeze command writes is the ledger status reads.
    const predictions = mkdtempSync(join(tmpdir(), "predictions-"));
    freezePrediction(
      ledgerPath("run1", predictions),
      { claim: "c", movedVariable: "m", direction: "up", falsifier: "f", source: "a".repeat(9), run: "run1" },
      "2026-09-18T00:00:00Z",
    );
    freezePrediction(
      ledgerPath("run2", predictions),
      {
        claim: "elsewhere",
        movedVariable: "m",
        direction: "up",
        falsifier: "f",
        source: "a".repeat(9),
        run: "run2",
      },
      "2026-09-18T00:00:00Z",
    );
    campaign(root, "slug-a", "run1", {
      lockPid: Number(process.pid),
      cases: caseLine("run1-i02", "t1", {}) + caseLine("run1-other", "t2", {}),
      safeguards: "t | 25-firing-ledger-external-only | x\n",
    });
    campaign(root, "slug-b", "run2", {
      terminal: {
        outcome: "completed",
        abortClause: null,
        terminalReason: "candidate-held",
        denominator: { total: 1, verified: 1, unaccepted: 0, nonResults: 0 },
        providerResourceBudget: { cap: 1320, used: 40 },
      },
    });
    const status = readCampaignsStatus(root, Date.now(), { predictions });
    expect(status.groups).toHaveLength(1);
    expect(status.groups[0].source).toBe("a".repeat(40));
    const live = status.runs.find((run) => run.runId === "run1");
    expect(live.lockAlive).toBe(true);
    expect(live.terminal).toBeNull();
    expect(live.batteries).toEqual([
      {
        runId: "run1-i02",
        verified: 1,
        passed: 1,
        unaccepted: 0,
        nonResult: 0,
        cases: [{ taskId: "t1", family: null, kind: "verified", pass: true, why: null }],
      },
    ]);
    // The live run reports no provider spend: the controller writes it at the terminal only. A watch
    // row keyed on `used` could never fire, which is why watch.mjs no longer carries one.
    expect(live.used).toBeNull();
    expect(live.predictions).toEqual({ frozen: 1, open: 1 });
    // Another run's ledger is another file; it never counts against this one.
    expect(status.runs.find((run) => run.runId === "run2").predictions).toEqual({ frozen: 1, open: 1 });
    expect(live.safeguards.names).toEqual([["25-firing-ledger-external-only", 1]]);
    const text = renderStatus(status);
    expect(text).toContain(`live pid ${process.pid}`);
    expect(text).toContain("1 rows, partial");
    expect(text).toContain("closed completed, used 40/1320");
    expect(text).toContain("recorded denominator: verified 1");
  });

  it("names a dead lock and an unrecorded denominator without inventing numbers", () => {
    const root = mkdtempSync(join(tmpdir(), "status-dead-"));
    const dir = campaign(root, "slug-c", "run3", {
      lockPid: 2 ** 22 - 1,
      terminal: {
        outcome: "aborted",
        abortClause: "controller-unclassified",
        denominator: { state: "unrecorded" },
      },
    });
    const run = readRunStatus(dir, "run3");
    expect(run.lockAlive).toBe(false);
    const text = renderStatus({ groups: [{ source: run.source, runs: [run] }], runs: [run] });
    expect(text).toContain("closed aborted (controller-unclassified)");
    expect(text).not.toContain("undefined");
    expect(renderStatus(readCampaignsStatus(join(root, "nowhere")))).toContain("no campaign");
  });
});

describe("cases a battery has open", () => {
  it("counts the cases a battery opened and no record has settled, with the harness's own solve wall", () => {
    const root = mkdtempSync(join(tmpdir(), "open-cases-"));
    const dir = campaign(root, "truss", "run", {
      lockPid: processAlive(process.pid) ? process.pid : 1,
      cases: caseLine("run-i02", "canopy-01", {}),
      battery: { runId: "run-i02", open: ["canopy-01", "canopy-02", "gantry-01"], wall: 90 },
    });
    // canopy-01 settled in `case-record.jsonl`; the other two are still solving.
    const open = openCases(dir, "run", Date.now(), new Map([["run-i02", new Set(["canopy-01"])]]));
    expect(open).toMatchObject({ count: 2, wallMinutes: 90 });
    expect(open.oldestMinutes).toBe(0);
    // A battery whose every case settled is no longer evidence of work.
    expect(
      openCases(
        dir,
        "run",
        Date.now(),
        new Map([["run-i02", new Set(["canopy-01", "canopy-02", "gantry-01"])]]),
      ),
    ).toMatchObject({ count: 0, oldestMinutes: null });
    // Another run's battery under the same campaign never counts as this run's work.
    expect(openCases(dir, "other", Date.now(), new Map())).toMatchObject({ count: 0, wallMinutes: 120 });
    expect(readRunStatus(dir, "run").open.count).toBe(2);
  });

  it("keeps each battery's settled cases to itself, because task ids repeat between batteries", () => {
    const root = mkdtempSync(join(tmpdir(), "open-cases-repeat-"));
    // The same three task ids in two batteries of one run: the first settled canopy-01, the second
    // has it open. A settled set flattened across the run hid the second one and read the battery
    // as idle while it was solving.
    const dir = campaign(root, "truss", "run", {
      lockPid: processAlive(process.pid) ? process.pid : 1,
      cases: caseLine("run-i02", "canopy-01", {}),
      batteries: [
        { runId: "run-i02", open: ["canopy-01"], wall: 90 },
        { runId: "run-i03", open: ["canopy-01"], wall: 90 },
      ],
    });
    const settled = new Map([["run-i02", new Set(["canopy-01"])]]);
    expect(openCases(dir, "run", Date.now(), settled)).toMatchObject({ count: 1 });
    expect(readRunStatus(dir, "run").open.count).toBe(1);
  });
});

describe("harness metrics", () => {
  it("measures the frozen bundle the gate accepted, and reports nothing for a run with no version", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-metrics-"));
    const dir = campaign(root, "truss", "run");
    expect(harnessMetrics(dir, "run")).toBe(null);
    // Before the gate freezes anything, the live epoch workspace is what there is to read, and an
    // epoch that has written no bundle file yet still reports nothing rather than an empty bundle.
    mkdirSync(join(dir, "epoch-abc", "workspace", "agent"), { recursive: true });
    expect(harnessMetrics(dir, "run", "epoch-abc")).toBe(null);
    writeFileSync(join(dir, "epoch-abc", "workspace", "agent", "tools.ts"), "export function write() {}\n");
    expect(harnessMetrics(dir, "run", "epoch-abc")).toMatchObject({
      lines: 1,
      files: [{ path: "agent/tools.ts", lines: 1, functions: 1 }],
    });
    const version = join(dir, "versions", "run");
    mkdirSync(join(version, "agent"), { recursive: true });
    mkdirSync(join(version, "correctness-model"), { recursive: true });
    // Installed and archived bytes sit beside the bundle and are not what the Builder wrote.
    mkdirSync(join(version, ".toolchain", "bin"), { recursive: true });
    writeFileSync(join(version, ".toolchain", "bin", "solver.ts"), "export function solve() { return 1; }\n");
    writeFileSync(
      join(version, "agent", "tools.ts"),
      "export function write() {}\n\nconst helper = (n: number) => n + 1;\n",
    );
    writeFileSync(
      join(version, "agent", "tools-spec.json"),
      JSON.stringify({ presets: ["shell"], tools: [{ name: "record" }, { name: "measure" }] }),
    );
    writeFileSync(
      join(version, "correctness-model", "tasks.json"),
      JSON.stringify([
        { taskId: "a", family: "mast" },
        { taskId: "b", family: "mast" },
        { taskId: "c", family: "canopy" },
      ]),
    );
    writeFileSync(
      join(version, "correctness-model", "controls.json"),
      JSON.stringify({ accept: [{}, {}], reject: [{}, {}, {}] }),
    );
    writeFileSync(
      join(version, "correctness-model", "brief.json"),
      JSON.stringify({ truthChecks: [{ id: "one" }, { id: "two" }] }),
    );
    // The host commits at tool boundaries; the Builder never does. One rehearsal, one submit
    // attempt and one repair round, in the reflog spelling `git commit` writes.
    mkdirSync(join(dir, "epoch-abc", "workspace", ".git", "logs"), { recursive: true });
    const reflog = (message) =>
      `${"0".repeat(40)} ${"1".repeat(40)} anaBuilder <builder@ana.local> 1789695606 +0200\t${message}\n`;
    writeFileSync(
      join(dir, "epoch-abc", "workspace", ".git", "logs", "HEAD"),
      reflog("commit (initial): starter: domain workspace skeleton") +
        reflog("commit: correctness_check: trial of the candidate (truss)") +
        reflog("commit: submit: candidate for validation (truss)") +
        reflog("commit: 04-truss: failed at tests (repair tests)"),
    );
    expect(harnessMetrics(dir, "run", "epoch-abc")).toMatchObject({
      commits: 4,
      rehearsals: 1,
      submits: 1,
      repairs: 1,
    });
    // A run whose opening names no epoch counts nothing rather than guessing a workspace.
    expect(harnessMetrics(dir, "run")).toMatchObject({ commits: 0, rehearsals: 0, submits: 0, repairs: 0 });
    const metrics = harnessMetrics(dir, "run");
    expect(metrics).toMatchObject({
      functions: 2,
      tasks: 3,
      families: 2,
      checks: 2,
      accepts: 2,
      rejects: 3,
      tools: 2,
      presets: ["shell"],
    });
    // The bundle the Builder wrote, longest first; `.toolchain/bin/solver.ts` is installed bytes.
    expect(metrics.files.map((file) => file.path).sort()).toEqual([
      "agent/tools-spec.json",
      "agent/tools.ts",
      "correctness-model/brief.json",
      "correctness-model/controls.json",
      "correctness-model/tasks.json",
    ]);
    expect(metrics.files[0].path).toBe("agent/tools.ts");
  });
});

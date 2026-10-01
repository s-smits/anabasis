import { describe, expect, it } from "bun:test";
import {
  advisories,
  deviations,
  readStatus,
  renderRows,
  renderStatus,
  type RunStatus,
  type WatchState,
  watchPass,
} from "../.claude/skills/run-improvement-campaign/scripts/campaign.ts";
import {
  freezePrediction,
  ledgerPath,
} from "../.claude/skills/run-improvement-campaign/scripts/prediction.ts";
import { readEpochRecord } from "../src/author/campaign-epoch.ts";
import type { Denominator } from "../src/run/controller-denominator.ts";
import { BUILDER_EXECUTION_SCHEMA, type BuilderSubmitAttempt } from "../src/author/builder-execution.ts";
import type {
  BuilderCustomToolCall,
  BuilderCustomToolSemantic,
} from "../src/author/builder-custom-tool-call.ts";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { bindProductMeasurement } from "../src/run/product-versions.ts";
import { executionRecord } from "./helpers/builder-execution-record.ts";
import { caseRecordRow, writeCaseRecord } from "./helpers/case-record-row.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { publishProduct, recordDigestBattery, solveRow } from "./helpers/digest-battery.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { recordedController } from "./helpers/recorded-controller.ts";
import { writeSettledReview } from "./helpers/review-fixtures.ts";
import { fence } from "./helpers/starter-contracts.ts";

const RUN = "fullrun-20260923-a";
const SCRIPTS = join(import.meta.dir, "../.claude/skills/run-improvement-campaign/scripts");
const BATTERY = `${RUN}-i02`;
const NON_RESULT = {
  acceptedSubmit: false,
  truthOk: null,
  pass: null,
  runtimeNonResult: "503",
  runtimeNonResultKind: "provider" as const,
};

interface Fixture {
  repo: string;
  campaign: string;
  epochDir: string;
  notes: string;
}

/** One run as a controller leaves it: a real opening, and a terminal unless the run is live. A live
 *  run holds the lock, and a dead one has no terminal and no holder. */
function fixture(state: "closed" | "live" | "dead"): Fixture {
  const repo = mkdtempSync(join(tmpdir(), "campaign-"));
  const { campaign, controllerDir } = recordedController({
    repo,
    projectId: "truss",
    runId: RUN,
    openedAt: "2026-09-23T00:00:00.000Z",
  });
  if (state !== "closed") unlinkSync(join(controllerDir, "terminal.json"));
  if (state === "live") writeFileSync(join(campaign, ".controller.lock"), JSON.stringify({ token: "live" }));
  const epoch = readEpochRecord(campaign)?.current;
  if (epoch === undefined) throw new Error("the recorded controller selects an epoch");
  const notes = join(repo, "notes");
  mkdirSync(notes, { recursive: true });
  return { repo, campaign, epochDir: join(campaign, epoch), notes };
}

const status = (f: Fixture): RunStatus =>
  readStatus(f.repo, RUN, Date.now(), { predictions: f.notes, tmpParent: f.repo });

/** The bundle the gate froze for the run's second round, as the starter's own contracts spell it. */
function bundle(f: Fixture, tasks = fence("## Task battery contract", "json")): void {
  const dir = join(f.campaign, "versions", BATTERY);
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(join(dir, "correctness-model/brief.json"), fence("## The worked domain", "json"));
  writeFileSync(join(dir, "correctness-model/tasks.json"), tasks);
  writeFileSync(join(dir, "correctness-model/controls.json"), fence("## Control corpus contract", "json"));
  writeFileSync(join(dir, "agent/tools-spec.json"), fence("## Agent tool list contract", "json"));
  writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
}

/** One returned custom call, placed in minutes from its session's start. */
function receipt(
  sequence: number,
  tool: string,
  [startMinute, minutes]: [number, number],
  semantic: BuilderCustomToolSemantic = { outcome: "completed" },
): BuilderCustomToolCall {
  return {
    sequence,
    turn: sequence,
    tool,
    action: tool,
    target: {},
    startedAtMs: startMinute * 60_000,
    durationMs: minutes * 60_000,
    dispatchOutcome: "returned",
    semantic,
  };
}

/** The epoch's execution record: `submits` over the writer's defaults, `checks` correctness_check
 *  calls, and a session of `minutes` holding `customCalls`. */
function execution(
  f: Fixture,
  submits: Partial<BuilderSubmitAttempt>[],
  checks = 0,
  [customCalls, minutes]: [BuilderCustomToolCall[], number] = [[], 1],
): string {
  const byName = { correctness_check: checks };
  const toolCalls = { total: checks, failed: 0, byName, custom: checks, native: 0 };
  const record = executionRecord(submits, checks, { customCalls, toolCalls, durationMs: minutes * 60_000 });
  writeFileSync(join(f.epochDir, "builder-execution.json"), record);
  return record;
}

describe("status", () => {
  it("counts a recorded bare-array tasks.json, the shape the gate writes", () => {
    const f = fixture("live");
    bundle(f);
    const read = status(f);
    // SAFETY: the starter's task battery contract is a JSON array; the count below reads its length.
    const expected = (JSON.parse(fence("## Task battery contract", "json")) as unknown[]).length;
    expect(read.bundle?.tasks).toBe(expected);
    expect(read.bundle?.tasks).toBeGreaterThan(0);
    expect(read.bundle?.findings).toEqual([]);
    expect(renderStatus(read, "files")).toContain(`${expected} tasks`);
  });

  it("reports a wrapped tasks file as the validator's refusal, never as zero tasks", () => {
    const f = fixture("live");
    bundle(f, JSON.stringify({ tasks: JSON.parse(fence("## Task battery contract", "json")) }));
    const read = status(f);
    expect(read.bundle?.tasks).toBeNull();
    expect(read.bundle?.findings).toContain("tasks-shape");
    const text = renderStatus(read, "summary");
    expect(text).toContain("? tasks");
    expect(text).toContain("bundle validator refused: tasks-shape");
  });

  it("refuses an older execution record by name in text and JSON, rather than reading zero submits", () => {
    const f = fixture("live");
    const older = execution(f, [{ outcome: "refused" }], 3).replace(
      BUILDER_EXECUTION_SCHEMA,
      "builder-execution/v4",
    );
    writeFileSync(join(f.epochDir, "builder-execution.json"), older);
    const read = status(f);
    expect(read.authoring?.session).toBeNull();
    expect(read.authoring?.unreadable).toContain("recorded as builder-execution/v4 by another source");
    expect(renderStatus(read, "summary")).toContain("rehearsals and submits unknown:");
    expect(
      deviations(null, read)
        .map((row) => row.detail)
        .join("\n"),
    ).toContain("Builder execution record refused");
    const args = ["--campaigns", join(f.repo, "campaigns"), "--run", RUN, "--json"];
    const out = execTextSync("bun", [join(SCRIPTS, "campaign.ts"), ...args]);
    // SAFETY: `--json` prints the status array, and only the authoring fields below are read.
    const [json] = JSON.parse(out) as Array<{ authoring: { session: null; unreadable: string } }>;
    expect(json?.authoring.session).toBeNull();
    expect(json?.authoring.unreadable).toContain("by another source");
  });

  it("counts a current record's submits and rehearsals, restarting the refused streak at acceptance", () => {
    const f = fixture("live");
    const refused = { outcome: "refused" } as const;
    execution(f, [refused, {}, refused, { ...refused, repeatedFindings: true }], 4);
    expect(status(f).authoring?.session).toEqual({
      rehearsals: 4,
      submits: 4,
      refusedInARow: 2,
      sameFindingsInARow: 2,
      checksWithoutAccept: 0,
      quietMinutes: 1,
    });
  });

  it("counts quiet minutes from the last submit or rehearsal to return, a held submit included", () => {
    const f = fixture("live");
    const held = { outcome: "blocked" as const, reason: "review-unread" };
    const progress = [receipt(1, "submit", [100, 1], held), receipt(2, "harness_trial", [101, 40])];
    execution(f, [], 0, [progress, 150]);
    const read = status(f);
    expect(read.authoring?.session).toMatchObject({ submits: 0, quietMinutes: 9 });
    expect(deviations(null, read).some((row) => row.detail.includes("Builder minutes"))).toBe(false);
    const busy = [receipt(1, "bash", [0, 90]), receipt(2, "correctness_check", [90, 20])];
    execution(f, [], 1, [busy, 150]);
    expect(deviations(null, status(f)).map((row) => row.detail)).toContainEqual(
      expect.stringContaining("150 Builder minutes since its last submit or harness_trial returned"),
    );
  });

  it("partitions this run's batteries through the controller's classifier and names an unreadable record", () => {
    const f = fixture("live");
    writeCaseRecord(f.campaign, [
      caseRecordRow("t1", "mast", { runId: BATTERY }),
      caseRecordRow("t2", "mast", { runId: BATTERY, acceptedSubmit: false, truthOk: null, pass: false }),
      caseRecordRow("t3", "mast", { runId: BATTERY, ...NON_RESULT }),
      caseRecordRow("t1", "mast", { runId: "other-run" }),
    ]);
    const [battery] = status(f).batteries;
    expect(battery).toMatchObject({ runId: BATTERY, passed: 1, verified: 1, unaccepted: 1, nonResults: 1 });
    writeFileSync(join(f.campaign, "case-record.jsonl"), "not json\n");
    const torn = status(f);
    expect(torn.batteries).toEqual([]);
    expect(torn.caseRecordError).toContain("case-record");
  });

  it("holds a closure on an open prediction and reads a closed run's terminal", () => {
    const f = fixture("closed");
    freezePrediction(
      ledgerPath(RUN, f.notes),
      { claim: "c", movedVariable: "m", direction: "up", falsifier: "x", source: "abcdef1", run: RUN },
      "t",
    );
    const read = status(f);
    expect(read.terminal?.outcome).toBe("completed");
    expect(read.live).toBe(false);
    expect(advisories(read).map((a) => [a.code, a.level])).toContainEqual(["predictions-open", "hold"]);
  });
});

describe("watch", () => {
  it("fires once on a terminal, and on a dead controller with no terminal", () => {
    const closed = status(fixture("closed"));
    expect(deviations(null, closed)).toEqual([
      { runId: RUN, level: "stop", act: null, detail: "terminal: completed" },
    ]);
    expect(deviations(closed, closed)).toEqual([]);
    const dead = deviations(null, status(fixture("dead")));
    expect(dead.map((row) => row.detail)).toContain("controller not alive and no terminal written");
  });

  it("names each new case once, and stops scheduling after five trailing non-results", () => {
    const f = fixture("live");
    writeCaseRecord(f.campaign, [caseRecordRow("t1", "mast", { runId: BATTERY })]);
    const before = status(f);
    expect(deviations(null, before).map((row) => row.detail)).toContain(`battery ${BATTERY} started`);
    writeCaseRecord(f.campaign, [
      caseRecordRow("t1", "mast", { runId: BATTERY }),
      ...["t2", "t3", "t4", "t5", "t6"].map((t) =>
        caseRecordRow(t, "mast", { runId: BATTERY, ...NON_RESULT }),
      ),
    ]);
    const after = status(f);
    const rows = deviations(before, after);
    expect(rows.filter((row) => row.detail.includes("non-result (provider)"))).toHaveLength(5);
    expect(rows).toContainEqual(
      expect.objectContaining({ act: "overhaul", detail: expect.stringContaining("5 cases in a row") }),
    );
    expect(deviations(after, after).filter((row) => row.level === "stop")).toEqual([]);
  });

  it("names a Builder limit once as it is crossed", () => {
    const f = fixture("live");
    const base = status(f);
    execution(
      f,
      Array.from({ length: 5 }, () => ({ outcome: "refused" as const })),
      12,
      [[], 300],
    );
    const crossed = status(f);
    const details = deviations(base, crossed).map((row) => row.detail);
    expect(details.some((d) => d.includes("5 submits refused in a row"))).toBe(true);
    expect(details.some((d) => d.includes("correctness_check calls"))).toBe(true);
    expect(details.some((d) => d.includes("300 Builder minutes since its last submit"))).toBe(true);
    expect(deviations(crossed, crossed).filter((row) => row.level === "stop")).toEqual([]);
  });

  it("reads silence under an open case's own wall as work, and past the threshold as a stall", () => {
    const base = { ...status(fixture("live")), evidenceAgeMinutes: 0 };
    const quiet = { ...base, evidenceAgeMinutes: 60, sessionAgeMinutes: 60 };
    const solving = { ...quiet, open: { count: 1, oldestMinutes: 30, wallMinutes: 120 } };
    expect(deviations(base, solving).filter((row) => row.level === "stop")).toEqual([]);
    const stall = deviations(base, quiet).find((row) => row.level === "stop");
    expect(stall?.detail).toContain("no new evidence for 60 min");
    expect(deviations(quiet, quiet).filter((row) => row.level === "stop")).toEqual([]);
  });

  it("reads a rehearsal still solving as work, and silence once graded or past its wall as a stall", () => {
    const f = fixture("live");
    const rehearsal = join(f.epochDir, "rehearsals", "rehearsal-1");
    mkdirSync(join(rehearsal, "cases", "t1"), { recursive: true });
    writeFileSync(join(rehearsal, "cases", "t1", "public-task.json"), "{}");
    const quiet = (read: RunStatus): RunStatus => ({
      ...read,
      evidenceAgeMinutes: 60,
      sessionAgeMinutes: 60,
    });
    const base = { ...status(f), evidenceAgeMinutes: 0 };
    const stops = (read: RunStatus) => deviations(base, quiet(read)).filter((row) => row.level === "stop");
    expect(status(f).rehearsing).toBe(true);
    expect(stops(status(f))).toEqual([]);
    const late = readStatus(f.repo, RUN, Date.now() + 121 * 60_000, {
      predictions: f.notes,
      tmpParent: f.repo,
    });
    expect(late.rehearsing).toBe(false);
    expect(stops(late)[0]?.detail).toContain("no new evidence for 60 min");
    writeFileSync(join(rehearsal, "checks.json"), "{}");
    expect(status(f).rehearsing).toBe(false);
    expect(stops(status(f))[0]?.detail).toContain("no new evidence for 60 min");
  });

  it("samples the session store in the run's own ana-quick-run TMPDIR and no other run's", () => {
    const f = fixture("live");
    const store = (tmp: string, runId: string): void => {
      const project = join(f.repo, tmp, "ana-claude-cli-1", "projects", `-Users-ana-run-${runId}`);
      mkdirSync(project, { recursive: true });
      writeFileSync(join(project, "session.jsonl"), "{}\n");
    };
    expect(status(f).sessionAgeMinutes).toBeNull();
    store("ana-quick-run-other", "fullrun-20260923-b");
    expect(status(f).sessionAgeMinutes).toBeNull();
    store("ana-quick-run-own", RUN);
    expect(status(f).sessionAgeMinutes).toBe(0);
  });

  it("holds info rows unattended until a stop carries them, and fires the disk row once until recovery", () => {
    const f = fixture("live");
    const fresh = (): RunStatus => ({ ...status(f), evidenceAgeMinutes: 0 });
    const read = fresh();
    const state: WatchState = { runs: {}, pending: [], diskLow: false };
    const options = {
      attended: false,
      completionOnly: false,
      stallMinutes: 45,
      freeGib: 100,
      diskMinGib: 20,
    };
    writeCaseRecord(f.campaign, [caseRecordRow("t1", "mast", { runId: BATTERY })]);
    const quiet = watchPass(new Map([[RUN, fresh()]]), state, options);
    expect(quiet.rows).toEqual([]);
    expect(state.pending.length).toBeGreaterThan(0);
    const low = watchPass(new Map([[RUN, read]]), state, { ...options, freeGib: 5 });
    expect(low.rows.map((row) => row.runId)).toContain("host");
    expect(low.rows.some((row) => row.detail.startsWith(`battery ${BATTERY} started`))).toBe(true);
    expect(watchPass(new Map([[RUN, read]]), state, { ...options, freeGib: 5 }).rows).toEqual([]);
    const missing = watchPass(new Map([["gone", { refused: "no controller opening" }]]), state, options);
    expect(missing.rows).toEqual([
      { runId: "gone", level: "stop", act: "reserved", detail: "no controller opening" },
    ]);
    expect(missing.allClosed).toBe(false);
    expect(renderRows(missing.rows, new Date("2026-09-23T10:00:00.123Z"))).toBe(
      "2026-09-23T10:00:00Z stop [reserved] gone: no controller opening",
    );
  });
});

describe("watch rows over one reading", () => {
  const AIM: [number, number] = [5, 12];
  /** A decision filed under the round it opens, placing the battery before it. */
  const decision = (runId: string, zone: "too-easy" | "too-hard" | "on-aim" | null, conflict = false) => ({
    runId,
    rationale: "",
    placement: zone === null ? null : { passes: 1, n: 25, zone, aim: AIM, toAim: 4 },
    repeated: false,
    conflict,
    admitted: 1,
    excluded: 0,
    evidenceRunIds: [`${runId.slice(0, -1)}${Number(runId.slice(-1)) - 1}`],
    rows: [],
    frame: "f",
  });

  it("reads the newest climb decision alone on a first pass, each new one by its move, under the battery it placed", () => {
    const base = { ...status(fixture("live")), evidenceAgeMinutes: 0 };
    const first = {
      ...base,
      difficulty: {
        rows: [decision("b1", "on-aim"), decision("b2", "too-easy", true)],
        refused: [],
      },
    };
    expect(deviations(null, first).filter((row) => row.detail.startsWith("battery b"))).toEqual([
      { runId: RUN, level: "stop", act: "surgical", detail: "battery b1: 1/25 too-easy, family conflict" },
    ]);
    const next = {
      ...first,
      difficulty: {
        rows: [...first.difficulty.rows, decision("b3", "too-hard")],
        refused: [{ file: "x.json", reason: "x" }],
      },
    };
    const rows = deviations(first, next);
    expect(rows).toContainEqual({
      runId: RUN,
      level: "stop",
      act: "reserved",
      detail: "battery b2: 1/25 too-hard",
    });
    expect(rows.map((row) => row.detail)).toContain(
      "1 climb decision(s) recorded under a schema this reader does not open",
    );
  });

  it("stops on a safeguard's first firing and reads its repeats as progress", () => {
    const base = { ...status(fixture("live")), evidenceAgeMinutes: 0 };
    const once = { ...base, safeguards: { counts: { "wall-hit": 1 }, malformed: 0 } };
    const twice = { ...base, safeguards: { counts: { "wall-hit": 3 }, malformed: 0 } };
    expect(deviations(base, once).find((row) => row.detail.startsWith("safeguard"))?.act).toBe("surgical");
    expect(deviations(once, twice).find((row) => row.detail.startsWith("safeguard"))?.level).toBe("info");
  });

  it("names a bundle file on the pass that wrote it, never on a first reading", () => {
    const f = fixture("live");
    bundle(f);
    const before = { ...status(f), evidenceAgeMinutes: 0 };
    expect(deviations(null, before).some((row) => row.detail.startsWith("wrote "))).toBe(false);
    const written: [number, number] = [40, 1];
    const files = { ...before.bundle?.files, "agent/tools.ts": written };
    const after = { ...before, bundle: before.bundle === null ? null : { ...before.bundle, files } };
    expect(deviations(before, after).map((row) => row.detail)).toContain(
      "wrote agent/tools.ts, 40 lines (new)",
    );
  });

  it("completion-only fires once per exited run, and nothing for progress", () => {
    const live = { ...status(fixture("live")), evidenceAgeMinutes: 999 };
    const closed = status(fixture("closed"));
    const state: WatchState = { runs: {}, pending: [], diskLow: false };
    const options = {
      attended: false,
      completionOnly: true,
      stallMinutes: 45,
      freeGib: null,
      diskMinGib: 20,
    };
    expect(watchPass(new Map([[RUN, live]]), state, options).rows).toEqual([]);
    const exited = watchPass(new Map([[RUN, closed]]), state, options);
    expect(exited.rows.map((row) => row.detail)).toEqual(["terminal: completed; controller exited"]);
    expect(exited.allClosed).toBe(true);
    expect(watchPass(new Map([[RUN, closed]]), state, options).rows).toEqual([]);
  });
});

describe("closure advisories", () => {
  it("advises on zero verified cases, refused claims, held promotions and a heavy review share", () => {
    const closed = status(fixture("closed"));
    if (closed.terminal === null) throw new Error("the closed fixture records a terminal");
    const denominator = { state: "recorded" as const, total: 3, verified: 0, unaccepted: 3, nonResults: 0 };
    const run: RunStatus = {
      ...closed,
      terminal: { ...closed.terminal, denominator },
      claims: { total: 2, ok: 0, refusedClauses: ["witness"] },
      promotions: { total: 1, held: 1, heldClauses: ["candidate-zero-verified"] },
      budget: { used: 100, cap: 200, review: 50 },
    };
    expect(advisories(run).map((advisory) => advisory.code)).toEqual([
      "zero-verified",
      "claims-refused",
      "promotion-held",
      "review-share",
    ]);
    expect(
      advisories({ ...run, budget: { used: 100, cap: 200, review: 30 } }).map((a) => a.code),
    ).not.toContain("review-share");
    const unreadable: Denominator = { state: "invalid", error: "case-record unreadable" };
    const invalid = { ...run, terminal: { ...closed.terminal, denominator: unreadable } };
    expect(advisories(invalid)).toContainEqual({
      code: "denominators",
      level: "hold",
      text: "case denominator invalid: case-record unreadable",
    });
  });
});

describe("scoreboard", () => {
  // One run whose three claimed batteries each measured the product it published, as the controller
  // publishes and binds one, with its own agent, recorded battery and case rows. The second carries
  // `b` unchanged and passes it under a new agent, and drops `c`; nothing follows the third, whose
  // completed review held `g` and settled `h` against its only check.
  it("reads each run's wall share and follows its earned fails into the next battery", () => {
    const f = fixture("closed");
    const [third, START] = [`${RUN}-i03`, "2026-09-23T00:00:00.000Z"];
    // Each battery's minutes per task against the product's 60-minute wall, and the tasks that failed.
    const batteries: [string, Record<string, number>, string[]][] = [
      [RUN, { a: 3, b: 9, c: 30 }, ["b", "c"]],
      [BATTERY, { a: 6, b: 18 }, []],
      [third, { d: 30, g: 30, h: 30 }, ["g", "h"]],
    ];
    const rows: ReturnType<typeof caseRecordRow>[] = [];
    mkdirSync(join(f.campaign, "claims"));
    for (const [hour, [battery, minutes, fails]] of batteries.entries()) {
      const tasks = Object.keys(minutes).map((taskId) => ({ taskId, family: "family", publicInput: {} }));
      const acceptedSnapshot = join(f.repo, "accepted", battery);
      const source = { repoRoot: f.repo, slug: "truss", id: battery, acceptedSnapshot };
      const product = publishProduct(source, {
        "agent/config.yaml": "solver:\n  solve_minutes: 60\n",
        "agent/AGENTS.md": battery,
        "correctness-model/evaluator.ts": "export const rule = 1;\n",
        "correctness-model/brief.json": "{}",
        "correctness-model/tasks.json": JSON.stringify(tasks),
      });
      bindProductMeasurement(f.repo, "truss", battery, product);
      const solved = tasks.map(({ taskId }) => solveRow({ taskId }, battery, !fails.includes(taskId)));
      recordDigestBattery(product, [battery], { [battery]: solved });
      const createdAt = `2026-09-23T0${hour + 1}:00:00.000Z`;
      writeFileSync(join(f.campaign, "claims", `${battery}.json`), JSON.stringify({ createdAt }));
      for (const [taskId, spent] of Object.entries(minutes)) {
        const pass = !fails.includes(taskId);
        const solverEndedAt = new Date(Date.parse(START) + spent * 60_000).toISOString();
        const row = { runId: battery, truthOk: pass, pass, solverStartedAt: START, solverEndedAt };
        rows.push(caseRecordRow(taskId, "family", row));
      }
    }
    writeCaseRecord(f.campaign, rows);
    writeSettledReview(join(f.campaign, "analysis"), third, [
      { taskId: "g", disposition: "check-stands" },
      { taskId: "h" },
    ]);
    const board = (...flags: string[]) =>
      execTextSync("bun", [join(SCRIPTS, "scoreboard.ts"), "--repo", f.repo, ...flags]);
    const [first8, followUp] = [
      { signal: 2, batteries: 3 },
      { earned: 3, last: 1, carried: 1, passed: 1, answered: 1 },
    ];
    // The signal batteries are the first, whose `b` and `c` no review settled, and the third at 1/2.
    // The batteries' median case shares are 0.15, 0.2 and 0.5 of each product's wall, so the run's
    // median is the second battery's, neither the first share nor the latest.
    expect(JSON.parse(board("--json"))).toEqual({
      runs: [
        expect.objectContaining({
          first8,
          fails: { held: 1, against: 1, unsettled: 2 },
          wall: { median: 0.2, latest: 0.5, batteries: 3 },
          followUp,
        }),
      ],
      groups: [expect.objectContaining({ first8, wall: { median: 0.2, runs: 1 }, followUp })],
    });
    expect(board()).toContain(
      "first-8 signal 2/3  wall 20.0% (n 1 runs)  earned fails 3, 1 carried unchanged, 1 answered",
    );
  });
});

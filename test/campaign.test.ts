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
import {
  BUILDER_EXECUTION_SCHEMA,
  submitProjection,
  type BuilderSubmitAttempt,
} from "../src/author/builder-execution.ts";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { recordedController } from "./helpers/recorded-controller.ts";
import { fence } from "./helpers/starter-contracts.ts";

const RUN = "fullrun-20260923-a";
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

function cases(f: Fixture, rows: ReturnType<typeof caseRecordRow>[]): void {
  writeFileSync(
    join(f.campaign, "case-record.jsonl"),
    rows.map((row, i) => `${JSON.stringify({ seq: i + 1, row })}\n`).join(""),
  );
}

function submit(
  ordinal: number,
  outcome: "accepted" | "refused",
  repeatedFindings = false,
): BuilderSubmitAttempt {
  const first = ordinal === 1;
  return {
    kind: "candidate",
    ordinal,
    turn: ordinal,
    atMs: ordinal * 100,
    outcome,
    stage: outcome === "accepted" ? null : "validation",
    commit: `commit-${ordinal}`,
    findingsDigest: outcome === "accepted" ? null : `digest-${ordinal}`,
    findingCodes: [],
    repeatedFindings: first ? null : repeatedFindings,
    findingsDelta: first ? null : { carried: 0, resolved: 0, introduced: 0 },
    workspaceChanged: first ? null : true,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
  };
}

function execution(f: Fixture, schema: string, submits: BuilderSubmitAttempt[], checks = 0): void {
  const byName = { correctness_check: checks };
  const record = {
    schema,
    backend: "codex",
    runtimeIdentity: null,
    turns: 1,
    durationMs: 60_000,
    toolCalls: { total: checks, failed: 0, byName, custom: checks, native: 0 },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 1, estimatedTurns: 0 },
    firstToolMs: null,
    submits,
    ...submitProjection(submits),
    partialTurn: null,
    turnRetries: [],
    authoringReviews: [],
    failedCalls: [],
    failedCallsOmitted: 0,
    failedByName: {},
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-09-23T10:00:00.000Z",
  };
  writeFileSync(join(f.epochDir, "builder-execution.json"), JSON.stringify(record));
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

  it("refuses an older execution record by name in text and JSON, rather than reading zero submits", async () => {
    const f = fixture("live");
    execution(f, "builder-execution/v4", [submit(1, "refused")], 3);
    const read = status(f);
    expect(read.authoring?.session).toBeNull();
    expect(read.authoring?.unreadable).toContain('unknown schema "builder-execution/v4"');
    expect(renderStatus(read, "summary")).toContain("rehearsals and submits unknown:");
    expect(
      deviations(null, read)
        .map((row) => row.detail)
        .join("\n"),
    ).toContain("Builder execution record refused");
    const cli = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../.claude/skills/run-improvement-campaign/scripts/campaign.ts"),
        "--campaigns",
        join(f.repo, "campaigns"),
        "--run",
        RUN,
        "--json",
      ],
      { stdout: "pipe", stderr: "pipe", cwd: runtimeProcess.cwd() },
    );
    const [out, code] = [await new Response(cli.stdout).text(), await cli.exited];
    expect(code).toBe(0);
    // SAFETY: `--json` prints the status array, and only the authoring fields below are read.
    const [json] = JSON.parse(out) as Array<{ authoring: { session: null; unreadable: string } }>;
    expect(json?.authoring.session).toBeNull();
    expect(json?.authoring.unreadable).toContain("unknown schema");
  });

  it("counts a current record's submits and rehearsals, restarting the refused streak at acceptance", () => {
    const f = fixture("live");
    execution(
      f,
      BUILDER_EXECUTION_SCHEMA,
      [submit(1, "refused"), submit(2, "accepted"), submit(3, "refused"), submit(4, "refused", true)],
      4,
    );
    expect(status(f).authoring?.session).toEqual({
      rehearsals: 4,
      submits: 4,
      refusedInARow: 2,
      sameFindingsInARow: 2,
      checksWithoutAccept: 0,
      minutes: 1,
    });
  });

  it("partitions this run's batteries through the controller's classifier and names an unreadable record", () => {
    const f = fixture("live");
    cases(f, [
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
    cases(f, [caseRecordRow("t1", "mast", { runId: BATTERY })]);
    const before = status(f);
    expect(deviations(null, before).map((row) => row.detail)).toContain(`battery ${BATTERY} started`);
    cases(f, [
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

  it("names a Builder limit once as it is crossed, and the time limit only before any submit", () => {
    const base = status(fixture("live"));
    const session = {
      rehearsals: 12,
      submits: 5,
      refusedInARow: 5,
      sameFindingsInARow: 0,
      checksWithoutAccept: 12,
      minutes: 300,
    };
    const authoring = {
      epoch: "e",
      commits: 1,
      session,
      unreadable: null,
      environmentInARow: 0,
      environmentKind: null,
    };
    const crossed = { ...base, authoring };
    const details = deviations(base, crossed).map((row) => row.detail);
    expect(details.some((d) => d.includes("5 submits refused in a row"))).toBe(true);
    expect(details.some((d) => d.includes("correctness_check calls"))).toBe(true);
    expect(details.some((d) => d.includes("Builder minutes"))).toBe(false);
    expect(deviations(crossed, crossed).filter((row) => row.level === "stop")).toEqual([]);
    const idle = {
      ...base,
      authoring: { ...authoring, session: { ...session, submits: 0, refusedInARow: 0 } },
    };
    expect(
      deviations(base, idle).some((row) => row.detail.includes("300 Builder minutes without a submit")),
    ).toBe(true);
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
    cases(f, [caseRecordRow("t1", "mast", { runId: BATTERY })]);
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
  const decision = (runId: string, zone: "too-easy" | "too-hard" | "on-aim" | null, conflict = false) => ({
    runId,
    rationale: "",
    placement: zone === null ? null : { passes: 1, n: 25, zone },
    repeated: false,
    conflict,
    admitted: 1,
    evidenceRunIds: [runId],
    frame: "f",
  });

  it("reads the newest climb decision alone on a first pass, and each new one by its move", () => {
    const base = { ...status(fixture("live")), evidenceAgeMinutes: 0 };
    const first = {
      ...base,
      difficulty: {
        rows: [decision("b1", "on-aim"), decision("b2", "too-easy", true)],
        refused: [],
      },
    };
    expect(deviations(null, first).filter((row) => row.detail.startsWith("battery b"))).toEqual([
      { runId: RUN, level: "stop", act: "surgical", detail: "battery b2: 1/25 too-easy, family conflict" },
    ]);
    const next = {
      ...first,
      difficulty: { rows: [...first.difficulty.rows, decision("b3", "too-hard")], refused: ["x"] },
    };
    const rows = deviations(first, next);
    expect(rows).toContainEqual({
      runId: RUN,
      level: "stop",
      act: "reserved",
      detail: "battery b3: 1/25 too-hard",
    });
    expect(rows.map((row) => row.detail)).toContain(
      "1 climb decision(s) recorded under a schema this reader does not open",
    );
    expect(deviations(next, { ...next, climb: { stop: "three batteries above the aim" } })).toContainEqual({
      runId: RUN,
      level: "stop",
      act: "overhaul",
      detail: "three batteries above the aim",
    });
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

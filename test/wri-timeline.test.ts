import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { recordedController } from "./helpers/recorded-controller.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { executionRecord, trialCall } from "./helpers/builder-execution-record.ts";
import { buildTimeline, renderTimeline } from "../.claude/skills/whole-run-investigation/scripts/timeline.ts";

const RUN = "run-20260919T000000000Z-aaaaaa";
/** The second round's own run id, which is the only battery that round may bind. */
const BATTERY = RUN + "-i02";

afterAll(cleanupScratch);

function row(seq: number, at: string, fields: Record<string, string | number>, runId = RUN) {
  return JSON.stringify({ schema: "ana-observation/v2", id: runId + ":" + seq, runId, seq, at, ...fields });
}

/** A campaign holding one run stream plus, when a battery is given, the battery stream its
 *  recorded terminal binds to it. */
function campaign(rows: string[], battery: string[] | null = null): string {
  const repo = scratchDir("ana-timeline-");
  const dir =
    battery === null
      ? campaignDir(repo, "project")
      : recordedController({
          repo,
          projectId: "project",
          runId: RUN,
          openedAt: "2026-09-19T10:00:00.000Z",
          bindBattery: true,
        }).campaign;
  mkdirSync(join(dir, "observability"), { recursive: true });
  writeFileSync(join(dir, "observability", RUN + ".jsonl"), rows.join("\n") + "\n");
  if (battery !== null) {
    writeFileSync(join(dir, "observability", BATTERY + ".jsonl"), battery.join("\n") + "\n");
  }
  return dir;
}

const RECORDED = [
  row(1, "2026-09-19T10:00:00.000Z", {
    type: "phase-transition",
    phase: "build",
    state: "opening",
    summary: "opening recorded",
  }),
  row(2, "2026-09-19T10:10:00.000Z", {
    type: "prompt-ingested",
    phase: "build",
    contract: "builder",
    role: "builder",
    chars: 100,
  }),
  row(3, "2026-09-19T10:40:00.000Z", {
    type: "hook-activated",
    phase: "measure-on",
    hookType: "follow-up",
    label: "unaccepted-submit",
    state: "activated",
  }),
  row(4, "2026-09-19T10:45:00.000Z", {
    type: "steering-ingested",
    phase: "measure-on",
    authority: "controller",
    owner: "controller",
    chars: 20,
  }),
  row(5, "2026-09-19T11:00:00.000Z", {
    type: "iteration-settled",
    phase: "measure-on",
    ordinal: 1,
    outcome: "measured",
  }),
];

describe("run timeline", () => {
  it("reads both bound streams and attributes each interval to the phase it was held in", () => {
    const dir = campaign(RECORDED, [
      row(
        1,
        "2026-09-19T11:30:00.000Z",
        { type: "prompt-ingested", phase: "measure-on", contract: "built", role: "built-solver", chars: 400 },
        BATTERY,
      ),
    ]);
    const timeline = buildTimeline({ campaign: dir, runId: RUN });
    expect(timeline.state).toBe("recorded");
    expect(timeline.scope).toBe("terminal-exact");
    expect(timeline.inputs.map((input) => input.runId)).toEqual([RUN, BATTERY]);
    expect(timeline.inputs.every((input) => input.sha256 !== null)).toBe(true);
    expect(timeline.rows).toBe(6);
    expect(timeline.window?.elapsedMinutes).toBe(90);
    expect(timeline.phases).toEqual([
      {
        phase: "measure-on",
        rows: 4,
        elapsedMinutes: 50,
        states: { activated: 1 },
        firstAt: "2026-09-19T10:40:00.000Z",
        lastAt: "2026-09-19T11:30:00.000Z",
      },
      {
        phase: "build",
        rows: 2,
        elapsedMinutes: 40,
        states: { opening: 1 },
        firstAt: "2026-09-19T10:00:00.000Z",
        lastAt: "2026-09-19T10:10:00.000Z",
      },
    ]);
    expect(timeline.stalls?.map((stall) => [stall.minutes, stall.phase, stall.after])).toEqual([
      [30, "build", "prompt-ingested"],
      [30, "measure-on", "iteration-settled"],
      [15, "measure-on", "steering-ingested"],
      [10, "build", "opening recorded"],
      [5, "measure-on", "hook-activated"],
    ]);
    expect(timeline.stalls?.map((stall) => stall.cause)).toEqual(Array(5).fill("unattributed"));
  });

  // An authoring review runs inside the build span, so once it settles the Builder's authoring time
  // is build again; a run-level analysis span, parented by nothing, keeps holding analyse.
  it("returns to the build phase when a review nested in the build span settles", () => {
    const span = (seq: number, at: string, phase: string, state: string, parentId: string | null) =>
      JSON.stringify({
        schema: "ana-observation/v2",
        id: RUN + ":" + seq,
        runId: RUN,
        seq,
        at,
        parentId,
        type: "phase-transition",
        phase,
        state,
        summary: phase + " " + state,
      });
    const rows = (parent: string | null) => [
      span(1, "2026-09-19T10:00:00.000Z", "build", "started", null),
      span(2, "2026-09-19T10:10:00.000Z", "analyse", "started", parent),
      span(3, "2026-09-19T10:20:00.000Z", "analyse", "completed", parent),
      row(4, "2026-09-19T11:20:00.000Z", { type: "iteration-settled", ordinal: 1, outcome: "accepted" }),
      span(5, "2026-09-19T11:30:00.000Z", "build", "completed", null),
    ];
    const held = (parent: string | null) =>
      Object.fromEntries(
        (buildTimeline({ campaign: campaign(rows(parent)), runId: RUN }).phases ?? []).map((entry) => [
          entry.phase,
          [entry.elapsedMinutes, entry.states],
        ]),
      );
    expect(held(RUN + ":1")).toEqual({
      build: [80, { started: 1, completed: 1 }],
      analyse: [10, { started: 1, completed: 1 }],
    });
    expect(held(null)).toEqual({
      analyse: [80, { started: 1, completed: 1 }],
      build: [10, { started: 1, completed: 1 }],
    });
  });

  /** One Builder session in epoch-aa, 10:00 to 10:50, holding these retries and calls. */
  function epoch(extra: Parameters<typeof executionRecord>[2]): string {
    const dir = campaign(RECORDED);
    mkdirSync(join(dir, "epoch-aa"), { recursive: true });
    writeFileSync(
      join(dir, "epoch-aa", "builder-execution.json"),
      executionRecord([], 0, { durationMs: 50 * 60_000, writtenAt: "2026-09-19T10:50:00.000Z", ...extra }),
    );
    return dir;
  }
  const at = (minute: number) => minute * 60_000;

  // The epochs sit beside the observation stream, so the reader must open them under the campaign
  // and not under whatever directory the lane was started from.
  it("attributes a gap to the allowance wait an epoch's Builder record holds when the wait covers it", () => {
    const dir = epoch({
      turnRetries: [
        {
          role: "builder",
          turn: 2,
          attempt: 1,
          of: 3,
          status: "failed",
          reason:
            "Claude Code returned an error result: You've hit your limit · resets 9:10pm (Europe/Amsterdam)",
          waitMs: 12 * 60_000,
        },
      ],
    });
    const allowance = "explicit allowance wait of 12 min recorded in epoch-aa session 1";
    expect(
      buildTimeline({ campaign: dir, runId: RUN }).stalls?.map((stall) => [stall.minutes, stall.cause]),
    ).toEqual([
      [30, "unattributed"],
      [15, allowance],
      [10, allowance],
      [5, allowance],
    ]);
  });

  // buffer-opushmm-20261008T004146905Z: a 69-minute gap was labelled with a rehearsal that covered
  // six minutes of it, while two of the Builder's own optimiser calls covered 59. A gap is held by
  // what was in flight across it, so the calls that cover most of it are named, each with its share.
  it("names the calls that held most of a gap with their shares, not a short rehearsal overlapping it", () => {
    // A shell call as the recorder writes one: an empty target and no semantic; sequences run from 1.
    const shell = (sequence: number, start: number, minutes: number) => ({
      sequence,
      turn: 1,
      tool: "bash",
      action: "execute",
      target: {},
      startedAtMs: at(start),
      durationMs: at(minutes),
      dispatchOutcome: "returned" as const,
    });
    const dir = epoch({
      customCalls: [
        shell(1, 11, 27),
        { ...trialCall(2, "t1", "c1", "pass"), startedAtMs: at(38), durationMs: at(4) },
        shell(3, 46, 6),
        shell(4, 52, 5),
      ],
    });
    // An authoring review timed inside a gap records an instant and no span, so it covers no share.
    mkdirSync(join(dir, "analysis"), { recursive: true });
    writeFileSync(
      join(dir, "analysis", "authoring-01a0b920-58e0-7000-8000-000000000000-epoch-review.json"),
      "{}",
    );
    expect(
      buildTimeline({ campaign: dir, runId: RUN }).stalls?.map((stall) => [stall.minutes, stall.cause]),
    ).toEqual([
      [30, "bash seq 1, 27 min (90%, epoch-aa session 1)"],
      [15, "bash 2 calls, 11 min (73%; longest bash seq 3, 6 min; epoch-aa session 1)"],
      // Nothing in flight, and a rehearsal that covers 40% of the five minutes, hold no majority.
      [10, "unattributed"],
      [5, "unattributed"],
    ]);
  });

  // truss-opushmm-20261008T004146905Z: the operator's stop fell inside a rehearsal, which the record
  // settled around with no duration. It held the Builder from its start to the record's end.
  it("places a call still in flight when the record settled from its start to the record's end", () => {
    const dir = epoch({
      customCalls: [
        {
          ...trialCall(1, "t1", "c1", "pass"),
          startedAtMs: at(12),
          durationMs: null,
          dispatchOutcome: "in-flight",
        },
      ],
    });
    expect(
      buildTimeline({ campaign: dir, runId: RUN }).stalls?.map((stall) => [stall.minutes, stall.cause]),
    ).toEqual([
      [30, "harness_trial seq 1, 28 min (93%, epoch-aa session 1)"],
      // The record ends at 10:50, five minutes into the fifteen-minute gap.
      [15, "unattributed"],
      [10, "unattributed"],
      [5, "harness_trial seq 1, 5 min (100%, epoch-aa session 1)"],
    ]);
  });

  it("counts the minutes two calls of one tool ran across together once, not twice", () => {
    const shell = (sequence: number) => ({
      sequence,
      turn: 1,
      tool: "bash",
      action: "execute",
      target: {},
      startedAtMs: at(11),
      durationMs: at(27),
      dispatchOutcome: "returned" as const,
    });
    const dir = epoch({ customCalls: [shell(1), shell(2)] });
    expect(buildTimeline({ campaign: dir, runId: RUN }).stalls?.[0]?.cause).toBe(
      "bash 2 calls, 27 min (90%; longest bash seq 1, 27 min; epoch-aa session 1)",
    );
  });

  it("tallies prompts, hooks, steering and settled iterations from the rows alone", () => {
    const dir = campaign([
      ...RECORDED,
      row(6, "2026-09-19T11:05:00.000Z", {
        type: "prompt-ingested",
        phase: "measure-on",
        contract: "builder",
        role: "builder",
        chars: 250,
      }),
    ]);
    const timeline = buildTimeline({ campaign: dir, runId: RUN });
    expect(timeline.scope).toBe("live-root-only; controller evidence absent");
    expect(timeline.prompts).toEqual([{ contract: "builder", role: "builder", count: 2, chars: 350 }]);
    expect(timeline.hooks).toEqual([
      {
        hookType: "follow-up",
        label: "unaccepted-submit",
        state: "activated",
        reason: null,
        count: 1,
        chars: 0,
      },
    ]);
    expect(timeline.steering).toEqual([
      { authority: "controller", owner: "controller", count: 1, chars: 20 },
    ]);
    expect(timeline.iterations).toEqual([
      { ordinal: 1, outcome: "measured", at: "2026-09-19T11:00:00.000Z" },
    ]);
    const text: string = renderTimeline(timeline);
    expect(text).toContain("follow-up unaccepted-submit activated x1");
    expect(text).toContain("controller: 1");
    expect(text).not.toContain("to null");
  });

  it("binds no battery from a terminal the strict reader refuses, and says why", () => {
    const dir = campaign(RECORDED);
    mkdirSync(join(dir, "controller", RUN), { recursive: true });
    writeFileSync(
      join(dir, "controller", RUN, "terminal.json"),
      JSON.stringify({ iterations: [{ runId: BATTERY, measured: true }] }),
    );
    writeFileSync(join(dir, "observability", BATTERY + ".jsonl"), "");
    const timeline = buildTimeline({ campaign: dir, runId: RUN });
    expect(timeline.inputs.map((input) => input.runId)).toEqual([RUN]);
    expect(timeline.scope).toStartWith("live-root-only; controller evidence refused: ");
  });

  it("states that no row is recorded rather than reporting an empty run, and refuses an unsafe selector", () => {
    const timeline = buildTimeline({
      campaign: scratchDir("ana-timeline-"),
      runId: RUN,
    });
    expect(timeline.state).toBe("unavailable");
    expect(timeline.rows).toBe(0);
    expect(timeline.inputs).toEqual([{ runId: RUN, sha256: null, issue: null }]);
    expect(renderTimeline(timeline)).toContain("no observation row is recorded");
    expect(() => buildTimeline({ campaign: "/tmp", runId: "../escape" })).toThrow("invalid run selector");
  });
});

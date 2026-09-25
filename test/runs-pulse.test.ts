import { describe, expect, it } from "bun:test";
import type { Observation } from "../tools/runs/evidence.ts";
import {
  offAimStreak,
  pulseEvents,
  pulseLabel,
  statusLine,
  type PulseBattery,
  type PulseReading,
  type PulseRound,
} from "../tools/runs/pulse.ts";

const SLUG = "design-lightweight-steel-trusses-3fd52f9e-4";
const RUN_ID = "truss-opus-20260925T042950810Z-371f8f";
const OPENED = Date.parse("2026-09-25T04:30:00.000Z");
const MINUTE = 60_000;

function at(minutes: number): string {
  return new Date(OPENED + minutes * MINUTE).toISOString();
}

function transition(
  minutes: number,
  phase: string,
  state: string,
  extra: Partial<Observation> = {},
): Observation {
  return {
    at: at(minutes),
    phase,
    type: "phase-transition",
    state,
    subjectId: null,
    level: "default",
    summary: null,
    parentId: null,
    evidence: [],
    ...extra,
  };
}

function round(extra: Partial<PulseRound> = {}): PulseRound {
  return {
    number: 1,
    epoch: "epoch-a",
    checkpointAt: null,
    toolCalls: 10,
    failedCalls: 0,
    previews: 0,
    clearPreviews: 0,
    firstClearMs: null,
    accepted: 0,
    refused: 0,
    refusalCodes: [],
    rehearsals: [],
    plan: null,
    headline: null,
    unread: [],
    ...extra,
  };
}

function battery(passed: number, verified: number, zone: PulseBattery["zone"]): PulseBattery {
  return { passed, verified, unaccepted: 0, nonResults: 0, zone, recorded: true };
}

const OPENING = [
  transition(0, "input", "completed"),
  transition(1, "build", "started", { summary: "Build step started (build)" }),
];

function reading(minutes: number, extra: Partial<PulseReading> = {}): PulseReading {
  return {
    runId: RUN_ID,
    label: pulseLabel(RUN_ID),
    state: "live",
    now: OPENED + minutes * MINUTE,
    startedAt: at(0),
    observations: OPENING,
    round: round({ checkpointAt: at(minutes) }),
    batteries: [],
    safeguards: [],
    terminal: null,
    ...extra,
  };
}

function texts(before: PulseReading | undefined, after: PulseReading): string[] {
  return pulseEvents(before, after, SLUG).map((event) => `${event.mark} ${event.text}`);
}

describe("runs pulse", () => {
  it("drops the launch instant from the label and keeps what tells runs apart", () => {
    expect(pulseLabel(RUN_ID)).toBe("truss-opus-371f8f");
  });

  it("says nothing on the first look and nothing when no recorded byte moved", () => {
    const first = reading(10);
    expect(texts(undefined, first)).toEqual([]);
    expect(texts(first, { ...first, now: first.now + MINUTE })).toEqual([]);
  });

  it("names a recorded battery with its placement and the streak that would stop the campaign", () => {
    const before = reading(60, { batteries: [battery(6, 6, "too-easy")] });
    const claim = transition(61, "claim", "completed", {
      summary: "battery recorded — claim 7/7 truth",
      evidence: [`campaigns/${SLUG}/claims/${RUN_ID}-i02.json`],
    });
    const after = {
      ...before,
      now: before.now + MINUTE,
      observations: [...before.observations, claim],
      batteries: [battery(6, 6, "too-easy"), battery(7, 7, "too-easy")],
    };
    const [event, ...rest] = pulseEvents(before, after, SLUG);
    expect(rest).toEqual([]);
    expect(event?.text).toBe(
      "battery recorded: 7/7 pass of verified, too-easy, above the aim 2 of 3 in a row; one more above the aim stops the campaign",
    );
    expect(event?.look).toEqual(["claims/<run>-i02.json"]);
  });

  it("counts a streak on one side only, and an on-aim battery ends it", () => {
    expect(
      offAimStreak([battery(1, 5, "too-hard"), battery(6, 6, "too-easy"), battery(7, 7, "over-aim")]),
    ).toEqual({
      side: "above",
      rounds: 2,
    });
    expect(offAimStreak([battery(6, 6, "too-easy"), battery(3, 7, "on-aim")])).toBeNull();
    expect(offAimStreak([battery(0, 0, null)])).toBeNull();
  });

  it("numbers a new round and carries the last battery into its line", () => {
    const before = reading(90, { batteries: [battery(7, 7, "too-easy")] });
    const rebuild = transition(91, "build", "started", { summary: "Build step started (rebuild)" });
    const after = {
      ...before,
      observations: [...before.observations, rebuild],
      round: round({ number: 2, epoch: "epoch-b", checkpointAt: at(91) }),
    };
    expect(texts(before, after)).toEqual([
      "◆ round 2 opened, a rebuild; last battery 7/7 pass of verified, too-easy, above the aim 1 of 3 in a row",
    ]);
  });

  it("raises a controller error row whatever its phase", () => {
    const before = reading(20);
    const error = transition(21, "grade", "failed", {
      level: "error",
      type: "verifier",
      summary: "host wall refused",
    });
    const after = { ...before, observations: [...before.observations, error] };
    expect(texts(before, after)).toEqual(["⚠ grade:failed host wall refused"]);
  });

  it("marks a rehearsal that lands against its prediction and one that could not run", () => {
    const before = reading(30);
    const after = {
      ...before,
      round: round({
        checkpointAt: at(30),
        rehearsals: [
          { taskId: "t1", verdict: "pass", predicted: 0.05 },
          { taskId: "t2", verdict: "not-run", predicted: 0.5 },
          { taskId: "t3", verdict: "fail", predicted: 0.4 },
        ],
      }),
    };
    expect(texts(before, after)).toEqual([
      "◆ r1 rehearsal 1 t1: pass, predicted 0.05, against its prediction",
      "⚠ r1 rehearsal 2 t2: not-run, predicted 0.5",
      "· r1 rehearsal 3 t3: fail, predicted 0.4",
    ]);
  });

  it("flags a plan whose predictions sit on the wrong side of its own target, in either direction", () => {
    const before = reading(30);
    const atMost = { comparator: "at-most" as const, verifiedPasses: 2, expected: 4, predictions: 6 };
    const atLeast = { comparator: "at-least" as const, verifiedPasses: 2, expected: 4, predictions: 6 };
    const flagged = texts(before, { ...before, round: round({ checkpointAt: at(30), plan: atMost }) });
    expect(flagged).toEqual([
      "⚠ r1 plan ≤2, predictions expect 4 of 6; its predictions sit 2 on the wrong side of its own target",
    ]);
    expect(texts(before, { ...before, round: round({ checkpointAt: at(30), plan: atLeast }) })).toEqual([
      "· r1 plan ≥2, predictions expect 4 of 6",
    ]);
  });

  it("says a quiet Builder once when the silence starts and once when it ends", () => {
    const quietFrom = reading(40, { round: round({ checkpointAt: at(15) }) });
    const stillQuiet = { ...quietFrom, now: quietFrom.now + 5 * MINUTE };
    const fresh = reading(46);
    const started = texts(reading(34, { round: round({ checkpointAt: at(15) }) }), quietFrom);
    expect(started).toEqual(["⚠ no Builder checkpoint for 25m 0s in round 1"]);
    expect(texts(quietFrom, stillQuiet)).toEqual([]);
    expect(texts(stillQuiet, fresh)).toEqual(["· Builder checkpoints again"]);
  });

  it("is not a quiet Builder while the run is measuring", () => {
    const measuring = [...OPENING, transition(5, "solve", "started")];
    const before = reading(30, { observations: measuring, round: round({ checkpointAt: at(4) }) });
    expect(texts(reading(4, { observations: measuring }), before)).toEqual([]);
  });

  it("names each safeguard that fired since the last look once, with how many times", () => {
    const before = reading(50, { safeguards: ["54-rebuild-seed-tool-tree-copied"] });
    const after = {
      ...before,
      safeguards: [
        ...before.safeguards,
        "12-dcg-refused",
        "12-dcg-refused",
        "54-rebuild-seed-tool-tree-copied",
      ],
    };
    expect(texts(before, after)).toEqual([
      "· safeguard 12-dcg-refused ×2",
      "· safeguard 54-rebuild-seed-tool-tree-copied",
    ]);
  });

  it("ends with the terminal and nothing else after it", () => {
    const before = reading(700);
    const after = { ...before, state: "closed" as const, terminal: "completed" };
    expect(texts(before, after)).toEqual(["◆ ended: completed"]);
    expect(statusLine(after, 10)).toContain("ended: completed");
  });

  it("states a build round by its counts and names what this tree could not read", () => {
    const line = statusLine(
      reading(45, {
        round: round({
          checkpointAt: at(44),
          previews: 2,
          clearPreviews: 1,
          rehearsals: [{ taskId: "t1", verdict: "pass", predicted: null }],
          headline: "Running design 5 rehearsal",
          unread: ["experiment-evidence.json (experiment-evidence/v2)"],
        }),
      }),
      18,
    );
    expect(line).toContain("r1 build 44m 0s · previews 2 (1 clear) · rehearsals 1/1 pass");
    expect(line).toContain('"Running design 5 rehearsal"');
    expect(line).toContain("not read by this tree: experiment-evidence.json (experiment-evidence/v2)");
  });
});

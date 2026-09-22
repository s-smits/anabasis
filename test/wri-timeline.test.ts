import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildTimeline, renderTimeline } from "../.claude/skills/whole-run-investigation/scripts/timeline.mjs";

interface Phase {
  phase: string;
  rows: number;
  elapsedMinutes: number;
  states: Record<string, number>;
  firstAt: string;
  lastAt: string;
}
interface Stall {
  minutes: number;
  phase: string | null;
  after: string;
}
interface Tallied {
  count: number;
  chars: number;
}
interface Timeline {
  state: string;
  scope: string;
  rows: number;
  reason?: string;
  inputs: { runId: string; sha256: string | null; issue: string | null }[];
  window: { elapsedMinutes: number };
  phases: Phase[];
  stalls: Stall[];
  prompts: (Tallied & { contract: string | null; role: string | null })[];
  hooks: (Tallied & {
    hookType: string;
    label: string | null;
    state: string | null;
    reason: string | null;
  })[];
  steering: (Tallied & { authority: string | null; owner: string | null })[];
  iterations: { ordinal: number | null; outcome: string | null; at: string }[];
}

const RUN = "run-20260919T000000000Z-aaaaaa";
const BATTERY = "battery-20260919T010000000Z-bbbbbb";

function row(seq: number, at: string, fields: Record<string, string | number>, runId = RUN) {
  return JSON.stringify({ schema: "ana-observation/v2", id: runId + ":" + seq, runId, seq, at, ...fields });
}

/** A campaign holding one run stream plus the battery stream its terminal binds to it. */
function campaign(rows: string[], battery: string[] | null = null): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-timeline-"));
  mkdirSync(join(dir, "observability"), { recursive: true });
  writeFileSync(join(dir, "observability", RUN + ".jsonl"), rows.join("\n") + "\n");
  if (battery !== null) {
    mkdirSync(join(dir, "controller", RUN), { recursive: true });
    writeFileSync(
      join(dir, "controller", RUN, "terminal.json"),
      JSON.stringify({ iterations: [{ batteryRunIds: [BATTERY] }] }),
    );
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
    const timeline: Timeline = buildTimeline({ campaign: dir, runId: RUN });
    expect(timeline.state).toBe("recorded");
    expect(timeline.scope).toBe("terminal-exact");
    expect(timeline.inputs.map((input) => input.runId)).toEqual([RUN, BATTERY]);
    expect(timeline.inputs.every((input) => input.sha256 !== null)).toBe(true);
    expect(timeline.rows).toBe(6);
    expect(timeline.window.elapsedMinutes).toBe(90);
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
    expect(timeline.stalls.map((stall) => [stall.minutes, stall.phase, stall.after])).toEqual([
      [30, "build", "prompt-ingested"],
      [30, "measure-on", "iteration-settled"],
      [15, "measure-on", "steering-ingested"],
      [10, "build", "opening recorded"],
      [5, "measure-on", "hook-activated"],
    ]);
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
    const timeline: Timeline = buildTimeline({ campaign: dir, runId: RUN });
    expect(timeline.scope).toBe("live-root-only; battery binding unavailable");
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
    expect(timeline.steering).toEqual([{ authority: "controller", owner: "controller", count: 1, chars: 20 }]);
    expect(timeline.iterations).toEqual([
      { ordinal: 1, outcome: "measured", at: "2026-09-19T11:00:00.000Z" },
    ]);
    const text: string = renderTimeline(timeline);
    expect(text).toContain("follow-up unaccepted-submit activated x1");
    expect(text).toContain("controller: 1");
    expect(text).not.toContain("to null");
  });

  it("states that no row is recorded rather than reporting an empty run, and refuses an unsafe selector", () => {
    const timeline: Timeline = buildTimeline({
      campaign: mkdtempSync(join(tmpdir(), "ana-timeline-")),
      runId: RUN,
    });
    expect(timeline.state).toBe("unavailable");
    expect(timeline.rows).toBe(0);
    expect(timeline.inputs).toEqual([{ runId: RUN, sha256: null, issue: null }]);
    expect(renderTimeline(timeline)).toContain("no observation row is recorded");
    expect(() => buildTimeline({ campaign: "/tmp", runId: "../escape" })).toThrow("invalid run selector");
  });
});

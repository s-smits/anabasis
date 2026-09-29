import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { Observation } from "../tools/runs/evidence.ts";
import { busyUnder, elapsedMs, loadMemory, parseProcessTable, saveMemory } from "../tools/runs/pulse-host.ts";
import { isPulseReading, offAimStreak, pulseEvents, selected, statusLine } from "../tools/runs/pulse.ts";
import {
  pulseLabel,
  readInFlight,
  type PulseBattery,
  type PulseReading,
  type PulseRound,
} from "../tools/runs/pulse-read.ts";

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
    inFlight: null,
    plan: null,
    planAdvice: null,
    headline: null,
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
    busy: null,
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

  it("names a recorded battery with its placement and its off-aim streak", () => {
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
    expect(event?.text).toBe("battery recorded: 7/7 pass of verified, too-easy, above the aim 2 in a row");
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
      "◆ round 2 opened, a rebuild; last battery 7/7 pass of verified, too-easy, above the aim 1 in a row",
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

  it("says each rehearsal's verdict, and marks one that could not run", () => {
    const before = reading(30);
    const after = {
      ...before,
      round: round({
        checkpointAt: at(30),
        rehearsals: [
          { taskId: "t1", verdict: "pass", submitted: true },
          { taskId: "t2", verdict: "not-run", submitted: null },
          { taskId: "t3", verdict: "fail", submitted: false },
        ],
      }),
    };
    expect(texts(before, after)).toEqual([
      "· r1 rehearsal 1 t1: pass",
      "⚠ r1 rehearsal 2 t2: not-run",
      "· r1 rehearsal 3 t3: fail (nothing submitted)",
    ]);
  });

  it("says a changed plan by its families, and raises no target or hold alert on passing rehearsals", () => {
    const plan = { families: 2 };
    const pass = (taskId: string) => ({ taskId, verdict: "pass", submitted: true });
    const before = reading(30);
    expect(texts(before, { ...before, round: round({ checkpointAt: at(30), plan }) })).toEqual([
      "· r1 plan, 2 families changed",
    ]);
    const held = round({ checkpointAt: at(31), plan, rehearsals: [pass("t1"), pass("t2"), pass("t3")] });
    const passed = texts(
      reading(30, { round: round({ checkpointAt: at(30), plan }) }),
      reading(31, { round: held }),
    );
    expect(passed).toEqual([
      "· r1 rehearsal 1 t1: pass",
      "· r1 rehearsal 2 t2: pass",
      "· r1 rehearsal 3 t3: pass",
    ]);
    expect(statusLine(reading(31, { round: held }), 10)).toContain("plan, 2 families changed");
    expect(statusLine(reading(31, { round: held }), 10)).not.toMatch(/passed past|predictions expect|hold/);
  });

  it("reads each battery's Epoch Review once", () => {
    const review = {
      status: "completed",
      findings: 2,
      blocking: 1,
      file: `analysis/${RUN_ID}-i02-epoch-review.json`,
    };
    const before = reading(60, { batteries: [{ ...battery(6, 6, "too-easy"), review: null }] });
    const reviewed = { ...before, batteries: [{ ...battery(6, 6, "too-easy"), review }] };
    expect(pulseEvents(before, reviewed, SLUG)[0]?.look).toEqual(["analysis/<run>-i02-epoch-review.json"]);
    expect(texts(before, reviewed)).toEqual(["◆ review of battery 1 completed: 2 finding(s), 1 blocking"]);
    expect(texts(reviewed, reviewed)).toEqual([]);
    const kept = reading(60, { batteries: [battery(6, 6, "too-easy")] });
    expect(texts(kept, reviewed)).toEqual([]);
  });

  it("says a quiet Builder once when the silence starts and once when it ends", () => {
    const quietFrom = reading(40, { round: round({ checkpointAt: at(15) }) });
    const stillQuiet = { ...quietFrom, now: quietFrom.now + 5 * MINUTE };
    const fresh = reading(46);
    const started = texts(reading(34, { round: round({ checkpointAt: at(15) }) }), quietFrom);
    expect(started).toEqual([
      "⚠ no Builder checkpoint for 25m 0s in round 1; no command running, so the model turn itself is long",
    ]);
    const compiling = { ...quietFrom, busy: { command: "sh -lc pio run", forMs: 12 * MINUTE } };
    expect(texts(reading(34, { round: round({ checkpointAt: at(15) }) }), compiling)).toEqual([
      "⚠ no Builder checkpoint for 25m 0s in round 1; running 12m 0s: sh -lc pio run",
    ]);
    expect(texts(quietFrom, stillQuiet)).toEqual([]);
    expect(texts(stillQuiet, fresh)).toEqual(["· Builder checkpoints again"]);
  });

  it("names the rehearsal a quiet Builder is inside, and how long it has run", () => {
    const rehearsing = reading(40, {
      round: round({
        checkpointAt: at(15),
        inFlight: { taskId: "truss-5", stage: "solving", startedAt: at(16) },
      }),
    });
    expect(texts(reading(34, { round: round({ checkpointAt: at(15) }) }), rehearsing)).toEqual([
      "⚠ no Builder checkpoint for 25m 0s in round 1; rehearsing truss-5 for 24m 0s",
    ]);
    expect(statusLine(rehearsing, 18)).toContain("checkpoint 25m 0s ago · rehearsing truss-5 for 24m 0s");
  });

  it("reads the newest rehearsal still running, and not one an earlier session left unfinished", () => {
    const epoch = mkdtempSync(join(tmpdir(), "pulse-inflight-"));
    const started = (ordinal: number, minutes: number) => {
      const task = join(epoch, "rehearsals", `rehearsal-${String(ordinal)}`, "cases", "truss-5");
      mkdirSync(task, { recursive: true });
      writeFileSync(join(task, "public-task.json"), "{}");
      utimesSync(join(task, "public-task.json"), new Date(at(minutes)), new Date(at(minutes)));
      return task;
    };
    expect(readInFlight(epoch, null)).toBeNull();
    started(2, 10);
    // Interrupted before its checks were written, and older than the last checkpoint.
    expect(readInFlight(epoch, at(12))).toBeNull();
    const task = started(10, 20);
    expect(readInFlight(epoch, at(12))).toEqual({ taskId: "truss-5", stage: "solving", startedAt: at(20) });
    writeFileSync(join(task, "trace.json"), "{}");
    expect(readInFlight(epoch, at(12))?.stage).toBe("grading");
    writeFileSync(join(epoch, "rehearsals", "rehearsal-10", "checks.json"), "{}");
    expect(readInFlight(epoch, at(12))).toBeNull();
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

  it("states a round in its gate by the gate's phase, not the previous battery's solves", () => {
    const earlier = [...OPENING, transition(5, "solve", "started"), transition(6, "measure-on", "started")];
    const gating = [...earlier, transition(40, "build", "started"), transition(90, "controls", "started")];
    expect(statusLine(reading(93, { observations: gating }), 10)).toContain("gating: controls 3m 0s");
    const solving = [...gating, transition(95, "solve", "started"), transition(96, "measure-on", "started")];
    expect(statusLine(reading(97, { observations: solving }), 10)).toContain(
      "measuring: 0 submitted, 1 solving, 2m 0s",
    );
  });

  it("states a remeasure round in its gate, and a gate no build row opened", () => {
    // A `measure` move opens its round with no `build:started`, only these two rows.
    const measured = [...OPENING, transition(5, "solve", "started"), transition(20, "claim", "completed")];
    const remeasure = [
      ...measured,
      transition(30, "next", "completed"),
      transition(31, "build", "completed", { summary: "Current adopted harness reused" }),
      transition(31, "adopt", "completed", { summary: "Current domain tree already adopted" }),
      transition(32, "controls", "started"),
    ];
    expect(statusLine(reading(35, { observations: remeasure }), 10)).toContain("gating: controls 3m 0s");
    const unopened = [transition(0, "input", "completed"), transition(2, "controls", "started")];
    expect(statusLine(reading(5, { observations: unopened }), 10)).toContain("gating: controls 3m 0s");
  });

  it("states a build round by its counts and the plan's own advice", () => {
    const line = statusLine(
      reading(45, {
        round: round({
          checkpointAt: at(44),
          previews: 2,
          clearPreviews: 1,
          rehearsals: [{ taskId: "t1", verdict: "pass", submitted: true }],
          headline: "Running design 5 rehearsal",
          planAdvice: "Advice: no EXPERIMENT.json yet.",
        }),
      }),
      18,
    );
    expect(line).toContain("r1 build 44m 0s · previews 2 (1 clear) · rehearsals 1/1 pass");
    expect(line).toContain('"Running design 5 rehearsal"');
    expect(line).toContain("Advice: no EXPERIMENT.json yet.");
  });
});

describe("pulse host reads", () => {
  it("reads ps elapsed times with and without hours and days", () => {
    expect(elapsedMs("05:07")).toBe((5 * 60 + 7) * 1000);
    expect(elapsedMs("02:05:07")).toBe(((2 * 60 + 5) * 60 + 7) * 1000);
    expect(elapsedMs("1-00:00:01")).toBe((24 * 3600 + 1) * 1000);
  });

  it("names the oldest command under the controller, not Bun, the model CLI or another run", () => {
    const table = parseProcessTable(
      [
        "  100     1 02:00:00 bun src/run/fullrun.ts",
        "  101   100 01:00:00 node /x/claude-agent-sdk/cli.js",
        "  102   100    10:00 sh -lc pio run -e esp32",
        "  103   102    09:59 /home/.platformio/xtensa-gcc main.c",
        "  104   100    00:30 sh -lc ls",
        "  105   100 01:30:00 <defunct>",
        "  200     1 03:00:00 bun src/run/fullrun.ts",
        "  201   200 02:00:00 sh -lc sleep 9999",
        "garbage",
      ].join("\n"),
    );
    expect(table).toHaveLength(8);
    expect(busyUnder(table, 100)).toEqual({ command: "sh -lc pio run -e esp32", forMs: 10 * MINUTE });
    expect(busyUnder(table, 300)).toBeNull();
    const piped = parseProcessTable(
      [
        "  401   400 05:25 /bin/sh -lc .toolchain/bun gen.ts 2>&1 | tail -3",
        "  402   401 05:24 .toolchain/bun gen.ts",
        "  403   401 05:24 tail -3",
      ].join("\n"),
    );
    expect(busyUnder(piped, 400)?.command).toBe("/bin/sh -lc .toolchain/bun gen.ts 2>&1 | tail -3");
    const reaped = parseProcessTable(
      String.raw`  101   100 00:40 /bin/sh -c trap 'd(){ for c in $(pgrep -P "$1"); do d "$c"; done; }' EXIT\012(\012python3 - <<'PY'\012print(1)\012PY\012)`,
    );
    expect(busyUnder(reaped, 100)?.command).toBe("python3 - <<'PY' ⏎ print(1) ⏎ PY");
    expect(busyUnder(table, null)).toBeNull();
  });

  it("keeps readings across looks, and reads a missing or broken file as a first look", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-memory-"));
    const path = join(dir, "nested", "pulse.json");
    expect(loadMemory(path, isPulseReading)).toEqual({ freeGiB: null, readings: {} });
    expect(saveMemory(path, { freeGiB: 12, readings: { [RUN_ID]: reading(5) } })).toBeNull();
    expect(loadMemory(path, isPulseReading).readings[RUN_ID]).toEqual(reading(5));
    // A kept round holding a plan is kept too, so the next look reports what moved since.
    const planned = reading(6, { round: round({ plan: { families: null } }) });
    expect(saveMemory(path, { freeGiB: null, readings: { [RUN_ID]: planned } })).toBeNull();
    expect(loadMemory(path, isPulseReading).readings[RUN_ID]).toEqual(planned);
    writeFileSync(path, "{");
    expect(loadMemory(path, isPulseReading)).toEqual({ freeGiB: null, readings: {} });
    writeFileSync(path, JSON.stringify({ runs: { A: { seq: 1 } } }));
    expect(loadMemory(path, isPulseReading)).toEqual({ freeGiB: null, readings: {} });
    expect(saveMemory(join(path, "under-a-file.json"), { freeGiB: null, readings: {} })).toContain(
      "could not keep this look",
    );
  });

  it("reads a kept reading the delta reader cannot use as no reading, and replaces it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pulse-memory-")), "pulse.json");
    const { round: _round, ...roundless } = reading(5);
    const broken = { [RUN_ID]: {}, b: roundless, c: { ...reading(5), observations: [null] }, d: reading(5) };
    writeFileSync(path, JSON.stringify({ freeGiB: 3, readings: broken }));
    const memory = loadMemory(path, isPulseReading);
    expect(memory).toEqual({ freeGiB: 3, readings: { d: reading(5) } });
    // A first look again: status lines and no events, then this look's reading is what is kept.
    expect(texts(memory.readings[RUN_ID], reading(6))).toEqual([]);
    memory.readings[RUN_ID] = reading(6);
    expect(saveMemory(path, memory)).toBeNull();
    expect(loadMemory(path, isPulseReading).readings[RUN_ID]).toEqual(reading(6));
  });

  it("reads only the runs a look names, whatever an earlier look kept", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pulse-memory-")), "pulse.json");
    const run = (runId: string, state: PulseReading["state"]) => ({ runId, slug: SLUG, liveness: { state } });
    const first = run("alpha-20260925T042950810Z-aaaaaa", "live");
    const second = run("beta-20260925T042950810Z-bbbbbb", "live");
    // `runs pulse aaaaaa --once` keeps alpha's reading; `runs pulse bbbbbb --once` then reads beta alone.
    expect([first, second].filter((row) => selected(row, ["aaaaaa"], new Set()))).toEqual([first]);
    saveMemory(path, { freeGiB: null, readings: { [first.runId]: reading(5, { runId: first.runId }) } });
    const watched = new Set(Object.keys(loadMemory(path, isPulseReading).readings));
    expect([first, second].filter((row) => selected(row, ["bbbbbb"], watched))).toEqual([second]);
    // An all-runs look reads both open runs, and a selector after it narrows again.
    watched.add(second.runId);
    expect([first, second].filter((row) => selected(row, [], watched))).toEqual([first, second]);
    expect([first, second].filter((row) => selected(row, ["aaaaaa"], watched))).toEqual([first]);
  });

  it("says a kept run's ending once in the all-runs look, then stops reading it", () => {
    const ended = { runId: RUN_ID, slug: SLUG, liveness: { state: "closed" as const } };
    const before = reading(30);
    const after = { ...reading(31), state: "closed" as const, terminal: "completed" };
    expect(selected(ended, [], new Set([RUN_ID]))).toBe(true);
    expect(texts(before, after)).toEqual(["◆ ended: completed"]);
    // The look drops an ended run's reading, so the next all-runs look passes over it.
    expect(selected(ended, [], new Set())).toBe(false);
  });
});

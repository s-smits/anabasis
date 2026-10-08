// The ladder's folds over hand-built logs: which harness a campaign stands on, how a task stands
// against a harness, what binds the climb, and what an Examiner is told of earlier tasks. No solve
// runs here; `round.test.ts` and `examiner.test.ts` hold the parts that act on these readings.
import { describe, expect, it } from "bun:test";
import { measured } from "../src/examiner/record.ts";
import { binding } from "../src/kernel/binding.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { frontierOf, ladder, type Stand, standing } from "../src/kernel/ladder.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { Counted } from "../src/kernel/solve.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { reachOf } from "../tools/d2/campaign.ts";

const at = "2026-10-08T00:00:00.000Z";
const RULE = { solves: 3, fails: 2 };
const P: Counted = { outcome: "pass" };
const F: Counted = { outcome: "fail", kind: "rejected" };
const W: Counted = { outcome: "fail", kind: "wall-ended" };
const BROKEN: Counted = { outcome: "fail", kind: "broken-harness", reason: "no tools" };
const GATE = "task.gate";
const PROPOSED = "task.proposed";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });

const condition = (task: string, harness: string, side: Condition["side"]): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: {
    wallSeconds: 600,
    turns: 12,
    shellDefaultSeconds: 30,
    shellMaxSeconds: 60,
    concurrency: 1,
    diskBytes: 1024,
  },
  host: "h",
  side,
});

/** Where the fixture's solver stands on `harness`. */
const on = (harness: string, side: Condition["side"] = "test"): Stand => ({
  harness,
  setting: settingId(condition("any", harness, side)),
});

let solves = 0;
/** The events of solves of `task` under `harness`, one an ending, on the test side unless told. */
function solved(
  task: string,
  harness: string,
  endings: readonly Counted[],
  side: Condition["side"] = "test",
) {
  const ran = condition(task, harness, side);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...endings.flatMap((ending) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id }),
        ...(ending.outcome === "fail" && ending.kind === "rejected"
          ? [event("verdict", { solve, task, kind: "fail", blocking: ["check-a"] })]
          : []),
        event("solve.finished", { solve, ending: { ...ending } }),
      ];
    }),
  ];
}

/** A task through its four gates. `session` makes it one an Examiner session wrote. */
function feasible(version: string, session?: string) {
  const written = { session: session ?? "", task: { taskId: version, family: "fixture" } };
  return [
    event(
      PROPOSED,
      session === undefined ? { version, taskId: version } : { version, taskId: version, ...written },
    ),
    ...[1, 2, 3, 4].map((gate) => event(GATE, { version, gate, outcome: "passed", controls: "d" })),
  ];
}
const state = (version: string, to: string) => event("task.state", { version, state: to });
const reported = (session: string, reading: string, fresh: string | null) =>
  event("comparison.reported", { session, reading, fresh });

describe("the frontier", () => {
  it("is the harness the last step left, and null before any", () => {
    expect(frontierOf([])).toBeNull();
    expect(frontierOf([reported("b-1", "no-step", "h2")])).toBeNull();
    const stepped = [reported("b-1", "step", "h2")];
    expect(frontierOf(stepped)).toBe("h2");
    // A round that read no step leaves the campaign where it stood, and a later step moves it.
    expect(frontierOf([...stepped, reported("b-2", "no-step", "h3")])).toBe("h2");
    expect(frontierOf([...stepped, reported("b-2", "anchor-not-tested", "h3")])).toBe("h2");
    expect(frontierOf([...stepped, reported("b-2", "no-step", "h3"), reported("b-3", "step", "h4")])).toBe(
      "h4",
    );
  });

  it("reads a round by its last report, so a person's settling moves it either way", () => {
    // Settled away: the round's own report read a step, and the labels left none.
    expect(frontierOf([reported("b-1", "step", "h2"), reported("b-1", "no-step", "h2")])).toBeNull();
    // Settled in: the round claimed neither reading, and the labels left a step.
    expect(frontierOf([reported("b-1", "flags-decide", "h2"), reported("b-1", "step", "h2")])).toBe("h2");
    // The order is the order of the last reports: b-1's settling came after b-2's step.
    expect(
      frontierOf([
        reported("b-1", "flags-decide", "h2"),
        reported("b-2", "step", "h3"),
        reported("b-1", "step", "h2"),
      ]),
    ).toBe("h2");
    expect(frontierOf([reported("b-1", "step", null)])).toBeNull();
  });
});

describe("a task's standing against a harness", () => {
  it("is read on the latest solves the rule asks for", () => {
    expect(standing([], RULE)).toBe("unknown");
    expect(standing([P, P], RULE)).toBe("unknown");
    expect(standing([P, P, P], RULE)).toBe("clears");
    expect(standing([F, P, P], RULE)).toBe("clears");
    // Two fails stop the harness before the third solve is made.
    expect(standing([F, F], RULE)).toBe("stops");
    expect(standing([F, F, P, P, P], RULE)).toBe("clears");
    expect(standing([P, P, P, F, F], RULE)).toBe("stops");
  });

  it("keeps fails that all ended at the wall apart, and reads no task on a broken harness", () => {
    expect(standing([W, W], RULE)).toBe("walled");
    expect(standing([W, F], RULE)).toBe("stops");
    expect(standing([BROKEN, BROKEN, P], RULE)).toBe("unknown");
    expect(standing([BROKEN, P, P, P], RULE)).toBe("clears");
  });
});

/** t1 stops h, t2 it clears, t3 nobody placed, t4 and t5 are practice, r1 has no witness, a1 is the
 *  anchor's. */
const CAMPAIGN = [
  ...["t1", "t2", "t3", "t4", "t5", "a1"].flatMap((version) => feasible(version)),
  event(PROPOSED, { version: "r1", taskId: "r1" }),
  event(GATE, { version: "r1", gate: 1, outcome: "passed" }),
  event(GATE, { version: "r1", gate: 2, outcome: "too-hard" }),
  state("r1", "too-hard"),
  event("anchor.drawn", { tasks: ["a1"] }),
  state("t2", "admitted"),
  state("t4", "released"),
  state("t5", "released"),
  ...solved("t1", "h", [F, F]),
  ...solved("t2", "h", [P, P, P]),
  ...solved("t4", "h", [F, F]),
  ...solved("t5", "h", [P, P, P]),
  ...solved("a1", "h", [F, F]),
  // Another harness's solves and the stronger solver's place nothing against h.
  ...solved("t3", "other", [F, F]),
  ...solved("t3", "h", [F, F], "strong"),
];

describe("the ladder", () => {
  it("places the pool by standing, and names the reach tasks and the practice still worth having", () => {
    expect(ladder(CAMPAIGN, on("h"), RULE)).toEqual({
      pool: { stops: ["t1"], clears: ["t2"], walled: [], unknown: ["t3"] },
      reach: ["r1"],
      practice: ["t4"],
    });
    // The same harness under another setting is another solver: its solves place nothing here.
    const other = { ...on("h"), setting: settingId({ ...condition("any", "h", "test"), effort: "high" }) };
    expect(ladder(CAMPAIGN, other, RULE).pool).toEqual({
      stops: [],
      clears: [],
      walled: [],
      unknown: ["t1", "t2", "t3"],
    });
    // Against a harness with no solve on record every task is unplaced, and all practice counts.
    expect(ladder(CAMPAIGN, on("new"), RULE)).toMatchObject({
      pool: { stops: [], clears: [], unknown: ["t1", "t2", "t3"] },
      practice: ["t4", "t5"],
    });
  });
});

describe("the reach tasks a session tries again", () => {
  /** The solve a `solve.started` event names. */
  const named = (started: LogEvent | undefined) => (isString(started?.data.solve) ? started.data.solve : "");
  /** A task a session wrote that a stronger solve under `harness` did not pass. */
  const unwitnessed = (version: string, harness: string) => {
    const [recorded, started, , finished] = solved(version, harness, [F], "strong");
    return [
      event(PROPOSED, {
        version,
        taskId: version,
        session: "x-1",
        task: { taskId: version, family: "fixture", publicInput: { base: 1 }, hidden: null },
      }),
      event(GATE, { version, gate: 1, outcome: "passed" }),
      ...(recorded && started && finished ? [recorded, started, finished] : []),
      event(GATE, { version, gate: 2, outcome: "too-hard", solve: named(started) }),
      state(version, "too-hard"),
    ];
  };

  it("are the tasks no stronger solve of which ran where the session's stronger solver stands", () => {
    const log = [
      ...unwitnessed("r1", "h1"),
      ...unwitnessed("r2", "h1"),
      // A pack's task holds no instance in the log, so no session can be handed it.
      event(PROPOSED, { version: "pack-1", taskId: "pack-1" }),
      event(GATE, { version: "pack-1", gate: 1, outcome: "passed" }),
      event(GATE, { version: "pack-1", gate: 2, outcome: "too-hard" }),
      state("pack-1", "too-hard"),
    ];
    // Under the harness that solve ran under, a second try would be paid for nothing new.
    expect(reachOf(log, on("h1", "strong"))).toEqual([]);
    expect(reachOf(log, on("h2", "strong")).map(({ taskId }) => taskId)).toEqual(["r1", "r2"]);
    // r1 was tried again under h2 and still has no witness: it waits for a third harness.
    const [recorded, started, , finished] = solved("r1", "h2", [F], "strong");
    const again = [
      ...log,
      ...(recorded && started && finished ? [recorded, started, finished] : []),
      event(GATE, { version: "r1", gate: 2, outcome: "too-hard", solve: named(started) }),
    ];
    expect(reachOf(again, on("h2", "strong")).map(({ taskId }) => taskId)).toEqual(["r2"]);
    expect(reachOf(again, on("h3", "strong")).map(({ taskId }) => taskId)).toEqual(["r1", "r2"]);
    // Back where its first solve ran, as after a host edit made and undone or a step settled away,
    // r1 is not paid for a second time there.
    expect(reachOf(again, on("h1", "strong"))).toEqual([]);
  });
});

describe("what binds a climb", () => {
  const exam = (session: string, standsOn?: string) =>
    event("exam.started", standsOn === undefined ? { session } : { session, standsOn });
  const word = (session: string, version: string, told: string) =>
    event("exam.word", { session, version, word: told });
  const given = { rule: RULE, least: 4 };

  it("is the harness while the pool can be scored", () => {
    expect(binding(CAMPAIGN, on("h"), { rule: RULE, least: 2 })).toMatchObject({
      binds: "harness",
      stops: 1,
      unplaced: 1,
      reach: 1,
      sessions: 0,
    });
  });

  it("is the tasks when no session has written against the harness, or what it wrote is too little", () => {
    const none = binding(CAMPAIGN, on("h"), given);
    expect(none.binds).toBe("tasks");
    expect(none.why).toBe(
      "2 of the pool can be scored and a step takes 4: no Examiner session has written against this harness",
    );
    const some = binding([...CAMPAIGN, exam("x-1", "h"), word("x-1", "t1", "scored")], on("h"), given);
    expect(some).toMatchObject({ binds: "tasks", sessions: 1, words: { scored: 1 } });
    expect(some.why).toContain("what was written against this harness is in the pool, and is too little");
  });

  it("names the witness, the limits or the checks by what the sessions on this harness were told", () => {
    const told = (...words: readonly string[]) => [
      ...CAMPAIGN,
      exam("x-1", "h"),
      ...words.map((each, index) => word("x-1", `n${String(index)}`, each)),
    ];
    expect(binding(told("too hard", "too hard", "too easy"), on("h"), given)).toMatchObject({
      binds: "witness",
      words: { "too hard": 2, "too easy": 1 },
    });
    expect(binding(told("wall-bound", "wall-bound", "too hard"), on("h"), given).binds).toBe("limits");
    // A refusal is the author's unless a check could not run or did not repeat.
    expect(binding(told("refused", "refused", "too hard"), on("h"), given).binds).toBe("tasks");
    const unsound = [
      ...told("refused", "refused", "too hard"),
      event(PROPOSED, { version: "n0", taskId: "n0" }),
      event(GATE, { version: "n0", gate: 1, outcome: "passed" }),
      event(GATE, { version: "n0", gate: 2, outcome: "passed" }),
      event(GATE, { version: "n0", gate: 3, outcome: "refused" }),
      event(PROPOSED, { version: "n1", taskId: "n1" }),
      event(GATE, { version: "n1", gate: 1, outcome: "passed" }),
      event(GATE, { version: "n1", gate: 2, outcome: "refused" }),
    ];
    expect(binding(unsound, on("h"), given)).toMatchObject({ binds: "checks" });
    // The last word of a task stands: one told too hard and later scored is no longer short.
    expect(binding([...told("too hard"), word("x-1", "n0", "scored")], on("h"), given).words).toEqual({
      scored: 1,
    });
  });

  it("reads tasks the solver passes as the author's on a first session, and as the checks' span from the second", () => {
    const first = [
      ...CAMPAIGN,
      exam("x-1", "h"),
      word("x-1", "n1", "too easy"),
      word("x-1", "n2", "too easy"),
    ];
    expect(binding(first, on("h"), given)).toMatchObject({ binds: "tasks", sessions: 1 });
    const second = [...first, exam("x-2", "h"), word("x-2", "n3", "too easy")];
    const spent = binding(second, on("h"), given);
    expect(spent).toMatchObject({ binds: "correctness-model", sessions: 2, words: { "too easy": 3 } });
    expect(spent.why).toContain(
      "3 of the 3 tasks written against this harness are passed by the measured solver",
    );
  });

  it("counts a session by the harness it stood on, and an unnamed one as the campaign's first", () => {
    // Sessions against another harness say nothing of this one.
    const elsewhere = [...CAMPAIGN, exam("x-1", "other"), word("x-1", "n1", "too hard")];
    expect(binding(elsewhere, on("h"), given)).toMatchObject({ sessions: 0, words: {} });
    // A log from before sessions named their harness: read against the first one while no step moved it.
    const unnamed = [...CAMPAIGN, exam("x-1"), word("x-1", "n1", "too hard")];
    expect(binding(unnamed, on("h"), given)).toMatchObject({ sessions: 1, binds: "witness" });
    expect(binding([...unnamed, reported("b-1", "step", "h2")], on("h2"), given)).toMatchObject({
      sessions: 0,
    });
  });
});

describe("what an Examiner is told of earlier tasks", () => {
  it("is one measured line a task, read against the harness the campaign stands on", () => {
    const log = [
      ...["w1", "w2", "w3", "w4", "w5", "w6"].flatMap((version) => feasible(version, "x-1")),
      ...feasible("pack-1"),
      event(PROPOSED, {
        version: "w7",
        taskId: "w7",
        session: "x-1",
        task: { taskId: "w7", family: "fixture" },
      }),
      event(GATE, { version: "w7", gate: 1, outcome: "passed" }),
      event(GATE, { version: "w7", gate: 2, outcome: "too-hard" }),
      state("w7", "too-hard"),
      event(PROPOSED, {
        version: "w8",
        taskId: "w8",
        session: "x-1",
        task: { taskId: "w8", family: "fixture" },
      }),
      event(GATE, { version: "w8", gate: 1, outcome: "refused" }),
      state("w8", "refused"),
      event("anchor.drawn", { tasks: ["pack-1"] }),
      state("w5", "released"),
      // Under the first harness w1 failed twice. Under the one the campaign stands on now it passes.
      ...solved("w1", "h1", [F, F]),
      ...solved("w1", "h2", [P, P, P]),
      ...solved("w2", "h2", [F, P, F]),
      ...solved("w3", "h2", [W, W]),
      ...solved("w6", "h2", [P, P, P]),
      state("w6", "admitted"),
      state("w6", "too-easy"),
    ];
    expect(measured(log, on("h2"), RULE)).toEqual([
      "w1 (family fixture): too easy: 0 of 3 solves failed",
      "w2 (family fixture): scored: 2 of 3 solves failed, refused by check-a (2)",
      "w3 (family fixture): wall-bound: 2 of 2 solves failed, ran to the wall (2)",
      "w4 (family fixture): not yet measured",
      "w5 (family fixture): in use as practice, and so never scored",
      "w6 (family fixture): too easy: the solver passes it",
      "w7 (family fixture): too hard for now: no stronger solve of it has passed",
    ]);
    // Against the first harness the same task reads as it did then.
    expect(measured(log, on("h1"), RULE)[0]).toBe(
      "w1 (family fixture): scored: 2 of 2 solves failed, refused by check-a (2)",
    );
  });
});

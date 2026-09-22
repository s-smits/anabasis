import { describe, expect, it } from "bun:test";
import { DEFAULT_DISK_MIN_GIB } from "../.claude/skills/launch-run/scripts/options.ts";
import {
  deviations,
  renderDeviations,
  snapshotOf,
  watchPass,
} from "../.claude/skills/run-improvement-campaign/scripts/watch.mjs";

// A battery carries its ordered cases, because that is what a live pass reads: the rows it has not
// seen yet, not a total it must diff in its head.
function battery(verified, passed, tail = []) {
  const cases = Array.from({ length: verified }, (_, index) => ({
    taskId: `t${index + 1}`,
    family: "mast",
    kind: "verified",
    pass: index < passed,
    why: null,
  }));
  return {
    runId: "run99-sol-0903-i02",
    verified,
    passed,
    unaccepted: tail.filter((row) => row.kind === "unaccepted").length,
    nonResult: tail.filter((row) => row.kind === "nonResult").length,
    cases: [...cases, ...tail],
  };
}

function nonResult(taskId, why = "provider") {
  return { taskId, family: "mast", kind: "nonResult", pass: false, why };
}

function decision(round, action, overrides = {}) {
  return {
    battery: `run99-sol-0903-i0${round}`,
    action,
    placement: "24/25 too-easy",
    zone: "too-easy",
    ...overrides,
  };
}

function runStatus(overrides = {}) {
  return {
    runId: "run99-sol-0903",
    terminal: null,
    lockAlive: true,
    batteries: [battery(10, 8)],
    claims: { total: 0, ok: 0 },
    promotions: 0,
    epochs: 1,
    safeguards: { names: [], malformed: 0 },
    open: { count: 0, oldestMinutes: null, wallMinutes: 120 },
    evidenceAgeMinutes: 3,
    ...overrides,
  };
}

function harness(files, counts = {}) {
  return {
    commits: 4,
    rehearsals: 2,
    submits: 1,
    repairs: 0,
    ...counts,
    files: files.map(([path, lines, ms]) => ({ path, lines, ms })),
  };
}

describe("deviations", () => {
  it("reports only the cases a pass has not seen, one named row each, and never restates a total", () => {
    const before = snapshotOf(runStatus());
    const after = snapshotOf(runStatus({ batteries: [battery(14, 11)] }));
    const rows = deviations(before, after);
    expect(rows.map((row) => row.level)).toEqual(["info", "info", "info", "info"]);
    expect(rows.map((row) => row.detail)).toEqual([
      "run99-sol-0903-i02 t11 (mast): verified pass",
      "run99-sol-0903-i02 t12 (mast): verified fail",
      "run99-sol-0903-i02 t13 (mast): verified fail",
      "run99-sol-0903-i02 t14 (mast): verified fail",
    ]);
    // The same pass a second time has nothing new to say.
    expect(deviations(after, snapshotOf(runStatus({ batteries: [battery(14, 11)] })))).toEqual([]);
  });

  it("names a bundle file only on the tick that wrote it, and never on a first reading", () => {
    const first = snapshotOf(
      runStatus({
        harness: harness([
          ["agent/tools.ts", 220, 1000],
          ["correctness-model/evaluator.ts", 140, 1000],
        ]),
      }),
    );
    // Everything present at the first reading is older than the watch, so it names none of it.
    expect(deviations(null, first).filter((row) => row.detail.startsWith("wrote"))).toEqual([]);
    // A state file from before this reader knows nothing about bundle files, and must not report the
    // whole bundle as written in the tick that upgraded the watch.
    const stale = structuredClone(first);
    delete stale.harness;
    expect(deviations(stale, first).filter((row) => row.detail.startsWith("wrote"))).toEqual([]);
    const second = snapshotOf(
      runStatus({
        harness: harness(
          [
            ["agent/tools.ts", 224, 2000],
            ["correctness-model/evaluator.ts", 140, 1000],
            ["agent/sizer.ts", 106, 2000],
          ],
          { commits: 5, rehearsals: 3 },
        ),
      }),
    );
    expect(deviations(first, second).map((row) => row.detail)).toEqual([
      "authoring 4 -> 5 commits: 3 rehearsal(s), 1 submit attempt(s), 0 repair round(s)",
      "wrote agent/tools.ts, 224 lines (was 220)",
      "wrote agent/sizer.ts, 106 lines (new)",
    ]);
    // A frozen accepted bundle moves nothing, so the next tick is silent about it.
    expect(
      deviations(
        second,
        snapshotOf(
          runStatus({
            harness: harness(
              [
                ["agent/tools.ts", 224, 2000],
                ["correctness-model/evaluator.ts", 140, 1000],
                ["agent/sizer.ts", 106, 2000],
              ],
              { commits: 5, rehearsals: 3 },
            ),
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("names an unaccepted case and a non-result case by task, and a first battery by id", () => {
    const started = deviations(
      snapshotOf(runStatus({ batteries: [] })),
      snapshotOf(
        runStatus({
          batteries: [
            battery(0, 0, [{ taskId: "t1", family: "mast", kind: "unaccepted", pass: false, why: null }]),
          ],
        }),
      ),
    );
    expect(started.map((row) => row.detail)).toEqual([
      "battery run99-sol-0903-i02 started",
      "run99-sol-0903-i02 t1 (mast): unaccepted, the agent produced no accepted submission",
    ]);
    const typed = deviations(
      snapshotOf(runStatus({ batteries: [battery(1, 1)] })),
      snapshotOf(runStatus({ batteries: [battery(1, 1, [nonResult("t2", "sandbox")])] })),
    );
    expect(typed.map((row) => `${row.level} ${row.detail}`)).toEqual([
      "info run99-sol-0903-i02 t2 (mast): non-result (sandbox)",
      "stop battery run99-sol-0903-i02 non-results 0 -> 1",
    ]);
    expect(typed[1].act).toBe("reserved");
  });

  it("calls five typed non-results in a row an overhaul, once, because rule 6 stops scheduling there", () => {
    const four = snapshotOf(
      runStatus({
        batteries: [battery(2, 2, [nonResult("t3"), nonResult("t4"), nonResult("t5"), nonResult("t6")])],
      }),
    );
    const five = snapshotOf(
      runStatus({
        batteries: [
          battery(2, 2, [
            nonResult("t3"),
            nonResult("t4"),
            nonResult("t5"),
            nonResult("t6"),
            nonResult("t7"),
          ]),
        ],
      }),
    );
    const rows = deviations(four, five).filter((row) => row.level === "stop");
    expect(rows.map((row) => row.act)).toEqual(["reserved", "overhaul"]);
    expect(rows[1].detail).toContain("5 cases in a row as typed non-results");
    // A run that already crossed the line does not re-announce it.
    const six = snapshotOf(
      runStatus({
        batteries: [
          battery(2, 2, [
            nonResult("t3"),
            nonResult("t4"),
            nonResult("t5"),
            nonResult("t6"),
            nonResult("t7"),
            nonResult("t8"),
          ]),
        ],
      }),
    );
    expect(
      deviations(five, six)
        .filter((row) => row.level === "stop")
        .map((row) => row.act),
    ).toEqual(["reserved"]);
    // A verified case between them breaks the run, so the trailing count starts again.
    const broken = snapshotOf(
      runStatus({
        batteries: [
          battery(2, 2, [
            nonResult("t3"),
            nonResult("t4"),
            { taskId: "t5", family: "mast", kind: "verified", pass: true, why: null },
            nonResult("t6"),
            nonResult("t7"),
          ]),
        ],
      }),
    );
    expect(deviations(four, broken).filter((row) => row.act === "overhaul")).toEqual([]);
  });

  it("reads the climb decision, not just the score, and calls a third climb in a row an overhaul", () => {
    const after = (before, difficulty) =>
      deviations(snapshotOf(runStatus({ difficulty: before })), snapshotOf(runStatus({ difficulty })));
    const banded = (round, passes) => decision(round, "climb", { placement: `${passes}/25 too-easy` });
    // A first climb is the mechanism working: the battery was easy and the next one asks for more.
    expect(after([], [banded(2, 24)]).map((row) => `${row.level} ${row.detail}`)).toEqual([
      "info battery run99-sol-0903-i02: climb, 24/25 too-easy",
    ]);
    // Three in a row say the ladder moved and no battery found the limit, and name the scores.
    const third = after([banded(2, 24), banded(3, 22)], [banded(2, 24), banded(3, 22), banded(4, 25)]);
    expect(third.map((row) => row.act)).toEqual(["overhaul"]);
    expect(third[0].detail).toContain(
      "3 too-easy batteries in a row (24/25 too-easy, 22/25 too-easy, 25/25 too-easy)",
    );
    // An ease between them breaks the run, so the count starts again.
    const tooHard = decision(3, "ease", { zone: "too-hard", placement: "1/25 too-hard" });
    const eased = after([banded(2, 24), tooHard], [banded(2, 24), tooHard, banded(4, 25)]);
    expect(eased.map((row) => row.act)).toEqual([null]);
    // A record written before the placement field still names its action.
    expect(after([], [decision(2, "climb", { placement: null })])[0].detail).toBe(
      "battery run99-sol-0903-i02: climb",
    );
  });

  it("names the other climb actions by the move each needs, and reserves an action word it does not know", () => {
    const move = (difficulty) =>
      deviations(snapshotOf(runStatus({ difficulty: [] })), snapshotOf(runStatus({ difficulty })));
    expect(move([decision(2, "no-difficulty-evidence")])[0].act).toBe("overhaul");
    expect(move([decision(2, "ease")])[0].act).toBe("reserved");
    expect(move([decision(2, "family-conflict")])[0].act).toBe("surgical");
    expect(move([decision(2, "repeated-failure-set")])[0].act).toBe("surgical");
    expect(move([decision(2, "hold-limit")])[0].level).toBe("info");
    // `climb` is `placed` on the open stack. Both read as the mechanism working, and a third name
    // nobody has written yet is reserved rather than silent.
    expect(move([decision(2, "placed")])[0].level).toBe("info");
    expect(move([decision(2, "repair-difficulty")])[0].act).toBe("reserved");
  });

  it("reserves a battery that overshot the band, in both spellings of the same placement", () => {
    const move = (difficulty) =>
      deviations(snapshotOf(runStatus({ difficulty: [] })), snapshotOf(runStatus({ difficulty })));
    const overshot = (action) =>
      move([decision(2, action, { zone: "too-hard", placement: "1/25 too-hard" })]);
    // `ease` carried this alarm until the open stack stopped writing it. Read by action alone the
    // replacement spelling mapped to null, so an overshooting battery printed as ordinary progress.
    for (const action of ["ease", "placed"]) {
      expect(overshot(action).map((row) => `${row.level} ${row.act}`)).toEqual(["stop reserved"]);
    }
    // The other four zones are the band reading its own score, and all of them arrive as `placed`.
    const zoned = (zone) => move([decision(2, "placed", { zone, placement: `9/25 ${zone}` })]);
    expect(["too-easy", "under-aim", "on-aim", "over-aim"].map((zone) => zoned(zone)[0].act)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    // A decision that places no battery and names no move this reader knows is worth a look.
    expect(move([decision(2, "some-new-kind", { zone: null, placement: null })])[0].act).toBe("reserved");
  });

  it("counts the too-easy streak from the recorded zone, so renaming the action cannot silence it", () => {
    const streak = (action) =>
      deviations(
        null,
        snapshotOf(
          runStatus({
            batteries: [],
            difficulty: [decision(2, action), decision(3, action), decision(4, action)],
          }),
        ),
      );
    for (const action of ["climb", "placed"]) {
      const rows = streak(action);
      expect(rows.map((row) => `${row.level} ${row.act}`)).toEqual(["stop overhaul"]);
      expect(rows[0].detail).toContain("3 too-easy batteries in a row");
    }
    // A battery the band placed on the aim ends the streak whatever the action says.
    const broken = deviations(
      null,
      snapshotOf(
        runStatus({
          batteries: [],
          difficulty: [
            decision(2, "climb"),
            decision(3, "climb"),
            decision(4, "climb", { zone: "on-aim", placement: "9/25 on-aim" }),
          ],
        }),
      ),
    );
    expect(broken.map((row) => row.level)).toEqual(["info"]);
  });

  it("counts the streak in batteries, because one battery decided twice writes two records", () => {
    // `difficulty-decisions/` names its files `<iteration>-<evidence digest>`. A `--run <runId>`
    // continuation restarts the round counter at 1 and decides the same iteration id again against
    // a longer history, landing a second record beside the first. Counted as rows, two readings of
    // one battery were two steps of a streak whose whole sentence is that the level moved.
    const rows = (difficulty) => deviations(null, snapshotOf(runStatus({ batteries: [], difficulty })));
    const again = decision(3, "climb", { placement: "23/25 too-easy" });
    expect(rows([decision(2, "climb"), decision(3, "climb"), again]).map((row) => row.level)).toEqual([
      "info",
    ]);
    // Three batteries still fire, and the battery decided twice names its score once.
    const three = rows([
      decision(2, "climb"),
      decision(3, "climb"),
      again,
      decision(4, "climb", { placement: "25/25 too-easy" }),
    ]);
    expect(three.map((row) => row.act)).toEqual(["overhaul"]);
    expect(three[0].detail).toContain(
      "3 too-easy batteries in a row (24/25 too-easy, 23/25 too-easy, 25/25 too-easy)",
    );
  });

  it("on a first pass reads the newest climb decision alone, not the whole ladder history", () => {
    const rows = deviations(
      null,
      snapshotOf(
        runStatus({
          batteries: [],
          difficulty: [
            decision(2, "climb"),
            decision(3, "climb"),
            decision(4, "ease", { zone: "too-hard", placement: "1/25 too-hard" }),
          ],
        }),
      ),
    );
    expect(rows.map((row) => row.detail)).toEqual(["battery run99-sol-0903-i04: ease, 1/25 too-hard"]);
    // A state file written before the watch read climb decisions carries no `difficulty` at all;
    // a restarted watch over that file reads the run, it does not throw.
    const stale = snapshotOf(runStatus({ batteries: [] }));
    delete stale.difficulty;
    const resumed = deviations(
      stale,
      snapshotOf(runStatus({ batteries: [], difficulty: [decision(2, "climb")] })),
    );
    expect(resumed.map((row) => row.detail)).toEqual(["battery run99-sol-0903-i02: climb, 24/25 too-easy"]);
  });

  it("reads a battery mid-solve as work, and names the silence once a case outlived its own wall", () => {
    // Run c1d2a7 held three cases open for 36 minutes on 2026-09-18 while every write it could
    // sample stayed frozen at the second they started; the old rule would have stopped it at 120.
    const solving = {
      batteries: [],
      evidenceAgeMinutes: 200,
      sessionWriteAgeMinutes: 200,
      open: { count: 3, oldestMinutes: 36, wallMinutes: 120 },
    };
    const opened = deviations(
      snapshotOf(runStatus({ batteries: [], open: { count: 0, oldestMinutes: null, wallMinutes: 120 } })),
      snapshotOf(runStatus(solving)),
    );
    expect(opened.map((row) => `${row.level} ${row.detail}`)).toEqual([
      "info 3 case(s) open, oldest 36 of 120 min",
    ]);
    // The same three cases, one minute past the wall the harness set itself.
    const past = deviations(
      snapshotOf(runStatus(solving)),
      snapshotOf(runStatus({ ...solving, open: { count: 3, oldestMinutes: 121, wallMinutes: 120 } })),
    );
    expect(past.filter((row) => row.level === "stop").map((row) => row.act)).toEqual(["reserved"]);
    expect(past[0].detail).toContain("no new evidence for 200 min");
    // A battery with nothing open is read by the evidence age alone, as before.
    expect(
      deviations(
        snapshotOf(runStatus({ batteries: [] })),
        snapshotOf(runStatus({ batteries: [], evidenceAgeMinutes: 200, sessionWriteAgeMinutes: 200 })),
      ).length,
    ).toBe(1);
  });

  it("hands every stop row the move it implies, so a fired watch carries a choice", () => {
    const move = (status) =>
      deviations(snapshotOf(runStatus()), snapshotOf(runStatus(status)))
        .filter((row) => row.level === "stop")
        .map((row) => row.act);
    expect(move({ terminal: { outcome: "build-failed", abortClause: null } })).toEqual(["surgical"]);
    expect(move({ terminal: { outcome: "measurement-stalled", abortClause: null } })).toEqual(["overhaul"]);
    expect(move({ terminal: { outcome: "environment-blocked", abortClause: null } })).toEqual(["reserved"]);
    expect(move({ claims: { total: 1, ok: 0 } })).toEqual(["surgical"]);
    // The shapes the controller actually records. `outcome` has two values and the code is one of
    // nine: of the 62 terminals recorded by 2026-09-20, `completed` carries four different codes in
    // `terminalReason` and `aborted` carries three in `abortClause`. Routing on the outcome word
    // told a build-failed and a candidate-held run that they implied no move at all.
    expect(
      move({
        terminal: {
          outcome: "completed",
          abortClause: null,
          reason: "build-failed: the final iteration built nothing",
        },
      }),
    ).toEqual(["surgical"]);
    expect(
      move({
        terminal: {
          outcome: "completed",
          abortClause: null,
          reason: "candidate-held: the climb candidate verified nothing",
        },
      }),
    ).toEqual(["surgical"]);
    expect(
      move({
        terminal: {
          outcome: "aborted",
          abortClause: "environment-blocked",
          reason: "aborted: environment-blocked",
        },
      }),
    ).toEqual(["reserved"]);
    expect(
      move({
        terminal: { outcome: "aborted", abortClause: "budget-limited", reason: "aborted: budget-limited" },
      }),
    ).toEqual(["reserved"]);
    // An operator's own interruption is a decision taken outside the evidence, so it asks nothing.
    expect(
      move({
        terminal: { outcome: "completed", abortClause: null, reason: "operator-interrupted: time boundary" },
      }),
    ).toEqual([null]);
    // A timed kill records a code outside the closed nine; an unknown code reserves.
    expect(
      move({
        terminal: {
          outcome: "aborted",
          abortClause: "signal-terminated",
          reason: "signal-terminated: fullrun received SIGTERM",
        },
      }),
    ).toEqual(["reserved"]);
    expect(move({ lockAlive: false })).toEqual(["reserved"]);
    // A battery that scored nothing is no-difficulty-evidence: there is nothing inside it to patch.
    expect(
      move({
        terminal: { outcome: "completed", abortClause: null },
        batteries: [
          battery(0, 0, [{ taskId: "t1", family: "mast", kind: "unaccepted", pass: false, why: null }]),
        ],
      }),
    ).toEqual(["overhaul"]);
    // A completed run that verified cases carries no move at all.
    const done = deviations(
      snapshotOf(runStatus()),
      snapshotOf(runStatus({ terminal: { outcome: "completed", abortClause: null } })),
    );
    expect(done.map((row) => row.act)).toEqual([null]);
    expect(renderDeviations(done, new Date("2026-09-03T00:00:00.000Z"))).toBe(
      "2026-09-03T00:00:00Z stop run99-sol-0903: terminal: completed",
    );
  });

  it("fires on a terminal, a dead controller, a stall, a spent budget, a non-result, a safeguard and a refused claim, naming each", () => {
    const before = snapshotOf(runStatus());
    const cases = [
      [runStatus({ terminal: { outcome: "completed", abortClause: null } }), "terminal: completed"],
      [runStatus({ lockAlive: false }), "controller not alive"],
      [runStatus({ evidenceAgeMinutes: 46 }), "no new evidence for 46 min"],
      [
        runStatus({ batteries: [battery(10, 8, [nonResult("t11"), nonResult("t12")])] }),
        "non-results 0 -> 2",
      ],
      [
        runStatus({ safeguards: { names: [["8-provider-stop-fired", 1]], malformed: 0 } }),
        "safeguard 8-provider-stop-fired fired 1 more time(s)",
      ],
      [runStatus({ claims: { total: 1, ok: 0 } }), "1 claim(s) written without ok"],
    ];
    for (const [status, expected] of cases) {
      const stops = deviations(before, snapshotOf(status)).filter((row) => row.level === "stop");
      expect(stops.length).toBe(1);
      expect(stops[0].detail).toContain(expected);
    }
  });

  it("on the first pass fires only absolute conditions and reports a terminal once", () => {
    const dead = snapshotOf(
      runStatus({
        lockAlive: false,
        safeguards: { names: [["27-toolchain-unreferenced", 1]], malformed: 0 },
      }),
    );
    const first = deviations(null, dead);
    expect(first.filter((row) => row.level === "stop").map((row) => row.detail)).toEqual([
      "controller not alive and no terminal written",
      "safeguard 27-toolchain-unreferenced fired 1 more time(s), 1 total",
    ]);
    const closed = snapshotOf(
      runStatus({ terminal: { outcome: "aborted", abortClause: "signal-terminated" } }),
    );
    expect(deviations(closed, closed)).toEqual([]);
    expect(deviations(null, closed)[0].detail).toBe("terminal: aborted (signal-terminated)");
  });

  it("a safeguard name that already fired is progress, not a stop", () => {
    const once = snapshotOf(
      runStatus({ safeguards: { names: [["27-toolchain-unreferenced", 1]], malformed: 0 } }),
    );
    const twice = snapshotOf(
      runStatus({ safeguards: { names: [["27-toolchain-unreferenced", 2]], malformed: 0 } }),
    );
    expect(deviations(once, twice).map((row) => row.level)).toEqual(["info"]);
    const other = snapshotOf(
      runStatus({
        safeguards: {
          names: [
            ["27-toolchain-unreferenced", 2],
            ["8-provider-stop-fired", 1],
          ],
          malformed: 0,
        },
      }),
    );
    expect(deviations(twice, other).map((row) => row.level)).toEqual(["stop"]);
  });

  it("a quiet campaign with a writing session store is one info row, and a stall only when both are quiet", () => {
    const fresh = snapshotOf(runStatus({ evidenceAgeMinutes: 10, sessionWriteAgeMinutes: 1 }));
    const working = snapshotOf(runStatus({ evidenceAgeMinutes: 90, sessionWriteAgeMinutes: 2 }));
    const rows = deviations(fresh, working);
    expect(rows.map((row) => row.level)).toEqual(["info"]);
    expect(rows[0].detail).toContain("the session store wrote 2 min ago");
    expect(
      deviations(working, snapshotOf(runStatus({ evidenceAgeMinutes: 95, sessionWriteAgeMinutes: 3 }))),
    ).toEqual([]);
    const quiet = snapshotOf(runStatus({ evidenceAgeMinutes: 140, sessionWriteAgeMinutes: 50 }));
    const stops = deviations(working, quiet).filter((row) => row.level === "stop");
    expect(stops.length).toBe(1);
    expect(stops[0].detail).toContain("the session store last wrote 50 min ago");
    expect(
      deviations(quiet, snapshotOf(runStatus({ evidenceAgeMinutes: 145, sessionWriteAgeMinutes: 55 }))),
    ).toEqual([]);
  });

  it("names a Builder session past each limit once, and again only in a new epoch", () => {
    const session = (fields) => ({
      epoch: "epoch-a",
      submits: 1,
      refusedInARow: 0,
      sameFindingsInARow: 0,
      checksWithoutAccept: 0,
      environmentInARow: 0,
      environmentKind: null,
      minutes: 10,
      ...fields,
    });
    const healthy = snapshotOf(
      runStatus({
        batteries: [],
        builder: session({
          refusedInARow: 4,
          sameFindingsInARow: 1,
          checksWithoutAccept: 11,
          environmentInARow: 1,
          minutes: 119,
          submits: 0,
        }),
      }),
    );
    expect(deviations(null, healthy)).toEqual([]);
    const cases = [
      [{ refusedInARow: 5 }, "5 submits refused in a row"],
      [{ sameFindingsInARow: 2 }, "2 refused submits in a row returned the same findings"],
      [{ checksWithoutAccept: 12 }, "12 correctness_check calls without an accepted submit"],
      [
        { environmentInARow: 2, environmentKind: "census-wall-exceeded" },
        "2 previews in a row ended as environment non-results (census-wall-exceeded)",
      ],
      [{ submits: 0, minutes: 120 }, "120 Builder minutes without a submit"],
    ];
    for (const [fields, expected] of cases) {
      const blocked = snapshotOf(runStatus({ batteries: [], builder: session(fields) }));
      const rows = deviations(healthy, blocked);
      expect(rows.map((row) => row.level)).toEqual(["stop"]);
      expect(rows[0].detail).toContain(expected);
      expect(
        deviations(
          blocked,
          snapshotOf(runStatus({ batteries: [], builder: session({ ...fields, minutes: 130 }) })),
        ),
      ).toEqual([]);
    }
    expect(
      deviations(
        snapshotOf(runStatus({ batteries: [], builder: session({ minutes: 200 }) })),
        snapshotOf(runStatus({ batteries: [], builder: session({ minutes: 200, submits: 0 }) })),
      ).length,
    ).toBe(1);
    const again = deviations(
      snapshotOf(runStatus({ batteries: [], builder: session({ refusedInARow: 6 }) })),
      snapshotOf(runStatus({ batteries: [], builder: session({ epoch: "epoch-b", refusedInARow: 5 }) })),
    );
    expect(again[0].detail).toContain("epoch epoch-b");
  });

  it("a stall fires once, when the age crosses the threshold", () => {
    const stalled = snapshotOf(runStatus({ evidenceAgeMinutes: 50 }));
    expect(deviations(snapshotOf(runStatus({ evidenceAgeMinutes: 48 })), stalled)).toEqual([]);
    expect(
      deviations(snapshotOf(runStatus({ evidenceAgeMinutes: 10 })), stalled, { stallMinutes: 30 }).length,
    ).toBe(1);
  });
});

describe("watchPass", () => {
  it("completion-only fires once per exited run, never for progress or a still-live terminal", () => {
    const ids = ["sol", "opus"];
    const state = { runs: {}, pending: [{ runId: "sol", level: "info", detail: "old progress" }] };
    const options = { completionOnly: true, freeGib: 1 };
    const sol = runStatus({ runId: "sol", evidenceAgeMinutes: 180 });
    const opus = runStatus({
      runId: "opus",
      terminal: { outcome: "aborted", abortClause: "budget-limited" },
    });
    const pass = () => watchPass({ runs: [sol, opus] }, ids, state, options);
    expect(pass()).toEqual({ rows: [], allClosed: false });
    expect(state.pending).toEqual([]);
    opus.lockAlive = false;
    expect(pass().rows.map((row) => row.runId)).toEqual(["opus"]);
    expect(pass()).toEqual({ rows: [], allClosed: false });
    sol.lockAlive = false;
    expect(pass().rows).toEqual([]); // No terminal is not a completed run.
    sol.terminal = { outcome: "completed", abortClause: null };
    const done = pass();
    expect(done.rows.map((row) => row.runId)).toEqual(["sol"]);
    expect(done.allClosed).toBe(true);
    expect(pass()).toEqual({ rows: [], allClosed: true });
    expect(watchPass({ runs: [] }, ["missing"], state, options)).toEqual({ rows: [], allClosed: false });
  });

  it("prints nothing on a quiet pass, keeps the progress rows pending, and prints them with the next stop row", () => {
    const state = { runs: {}, pending: [] };
    const status = { runs: [runStatus(), runStatus({ runId: "truss-run11-sol-0903", batteries: [] })] };
    const first = watchPass(status, ["run99-sol-0903", "truss-run11-sol-0903"], state);
    expect(first.rows).toEqual([]);
    expect(first.allClosed).toBe(false);
    const progressed = { runs: [runStatus({ batteries: [battery(12, 9)] }), status.runs[1]] };
    expect(watchPass(progressed, ["run99-sol-0903", "truss-run11-sol-0903"], state).rows).toEqual([]);
    // One started row from the first pass, then one row per case the second pass learned.
    expect(state.pending.map((row) => row.detail)).toEqual([
      "battery run99-sol-0903-i02 started",
      "run99-sol-0903-i02 t11 (mast): verified fail",
      "run99-sol-0903-i02 t12 (mast): verified fail",
    ]);
    const closed = {
      runs: [
        progressed.runs[0],
        runStatus({
          runId: "truss-run11-sol-0903",
          batteries: [],
          terminal: { outcome: "completed", abortClause: null },
        }),
      ],
    };
    const fired = watchPass(closed, ["run99-sol-0903", "truss-run11-sol-0903"], state);
    expect(fired.rows.map((row) => `${row.level} ${row.runId}`)).toEqual([
      "info run99-sol-0903",
      "info run99-sol-0903",
      "info run99-sol-0903",
      "stop truss-run11-sol-0903",
    ]);
    expect(state.pending).toEqual([]);
    expect(fired.allClosed).toBe(false);
  });

  it("fires one host row when free space falls under the minimum and again only after it recovered", () => {
    const state = { runs: {}, pending: [] };
    const status = { runs: [runStatus()] };
    expect(watchPass(status, ["run99-sol-0903"], state, { freeGib: 120 }).rows).toEqual([]);
    const low = watchPass(status, ["run99-sol-0903"], state, { freeGib: 8 });
    expect(low.rows.map((row) => `${row.level} ${row.runId}`)).toEqual(["info run99-sol-0903", "stop host"]);
    expect(low.rows[1].detail).toContain(
      `free space 8 GiB on the campaigns volume is under ${DEFAULT_DISK_MIN_GIB} GiB`,
    );
    // The launch options own the floor; the watch reports against that one value.
    expect(DEFAULT_DISK_MIN_GIB).toBe(20);
    expect(watchPass(status, ["run99-sol-0903"], state, { freeGib: 7 }).rows).toEqual([]);
    expect(watchPass(status, ["run99-sol-0903"], state, { freeGib: 40 }).rows).toEqual([]);
    expect(watchPass(status, ["run99-sol-0903"], state, { freeGib: 20, diskMinGib: 25 }).rows.length).toBe(1);
    expect(watchPass(status, ["run99-sol-0903"], state, { freeGib: null }).rows).toEqual([]);
  });

  it("names a run with no opening as a stop row and reports all-closed only when every named run has a terminal", () => {
    const state = { runs: {}, pending: [] };
    const missing = watchPass({ runs: [] }, ["ghost"], state);
    expect(missing.rows[0].detail).toContain("no controller opening");
    expect(missing.allClosed).toBe(false);
    const closed = { runs: [runStatus({ terminal: { outcome: "completed", abortClause: null } })] };
    const done = watchPass(closed, ["run99-sol-0903"], { runs: {}, pending: [] });
    expect(done.allClosed).toBe(true);
    expect(renderDeviations(done.rows, new Date("2026-09-03T00:00:00.000Z"))).toBe(
      "2026-09-03T00:00:00Z stop run99-sol-0903: terminal: completed",
    );
  });
});

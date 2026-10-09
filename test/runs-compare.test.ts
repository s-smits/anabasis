// The runs comparison reads rounds from their logs alone: what each was given, its solves by set and
// by harness with non-results apart, and for two rounds whether what they were given differently is
// one variable. These rounds are small enough to count by hand: one practice task, and four scored
// tasks solved once under the reference harness and once under the one the session left.
import { describe, expect, it } from "bun:test";
import { signP } from "../src/kernel/compare.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { compared, roundOf } from "../tools/runs/compare.ts";

const START = Date.parse("2026-10-09T12:00:00Z");
const ENDINGS = new Map<string, JsonObject>([
  ["p", { outcome: "pass" }],
  ["f", { outcome: "fail", kind: "rejected" }],
  ["n", { outcome: "non-result", kind: "killed", reason: "the host ended it" }],
]);
const STARTER = "h-base";
const COUNTED = "pf";

interface Given {
  readonly builder: string;
  readonly solver: string;
  /** The harness the session started from, and the one its child was compared with. */
  readonly parent: string;
  readonly reference: string;
  readonly fresh: string;
  readonly contract: string;
  readonly tasks: readonly string[];
  /** Each scored task's one solve under the reference harness: p a valid answer, f a rejected
   *  one, n a non-result, and any other letter a solve with no ending. */
  readonly old: string;
  /** The same under the fresh harness. */
  readonly made: string;
  /** The same under the starter, where the comparison read a step and solved it. */
  readonly base?: string;
}

const OPUS: Given = {
  builder: "p/opus",
  solver: "p/opus",
  parent: "h-parent",
  reference: "h-parent",
  fresh: "h-a",
  contract: "c1",
  tasks: ["a1", "a2", "a3", "a4"],
  old: "pppf",
  made: "ppff",
};
const SOL: Given = { ...OPUS, builder: "q/sol", solver: "q/sol", fresh: "h-s", old: "pppp", made: "ffff" };

/** What a test adds to a round's log: events, and solves of a task under a harness. */
interface Added {
  readonly record: (kind: EventKind, data: JsonObject) => void;
  readonly solve: (task: string, harness: string, ending: string) => void;
}

/** The log of one round given `given`: its tasks' gates, a Builder session with one practice solve,
 *  the comparison's start, each scored task's solves and the comparison's report. A round after
 *  `before` in the same log proposes nothing: its tasks are the log's. `later` adds to what
 *  follows its report. */
function round(
  session: string,
  given: Given,
  before: readonly LogEvent[] = [],
  later?: (to: Added) => void,
): LogEvent[] {
  const events = [...before];
  const record = (kind: EventKind, data: JsonObject) => {
    events.push({ at: new Date(START + events.length * 1_000).toISOString(), kind, data });
  };
  const under = (task: string, harness: string): Condition => ({
    contract: given.contract,
    harness,
    task,
    model: given.solver,
    effort: "medium",
    prices: { [given.solver]: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    runtime: {},
    compaction: "off",
    solverTools: `tools-of-${harness}`,
    verifierTools: "v1",
    sandbox: "x1",
    limits: {
      wallSeconds: 100,
      turns: 8,
      shellDefaultSeconds: 10,
      shellMaxSeconds: 20,
      concurrency: 1,
      diskBytes: 1,
    },
    host: "host-1",
    side: "test",
  });
  /** The comparison a solve is made for: none in the session, the round's own after its start. */
  let comparison: string | null = null;
  const solve = (task: string, harness: string, ending: string) => {
    const ran = under(task, harness);
    const id = `${session}-${String(events.length)}`;
    record("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    record("solve.started", {
      solve: id,
      condition: conditionId(ran),
      ...keyIfNotNull("comparison", comparison),
    });
    const ended = ENDINGS.get(ending);
    if (ended !== undefined) record("solve.finished", { solve: id, ending: ended });
  };
  for (const version of before.length === 0 ? ["p1", ...given.tasks] : []) {
    record("task.proposed", { version });
    record("task.gate", { version, gate: 1, outcome: "passed" });
  }
  if (before.length === 0) record("task.state", { version: "p1", state: "released" });
  record("build.started", {
    session,
    parent: given.parent,
    tasks: ["p1"],
    model: given.builder,
    effort: "high",
    limits: { wallSeconds: 1800, turns: 40, practiceSolves: 1 },
  });
  solve("p1", "h-draft", "p");
  record("build.finished", { session, ended: "wall", harness: given.fresh, changed: true });
  comparison = session;
  const terms = {
    session,
    old: given.reference,
    fresh: given.fresh,
    starter: STARTER,
    setting: settingId(under("any", "any")),
    solves: 1,
    level: 0.1,
  };
  record("comparison.started", { ...terms, tasks: [...given.tasks] });
  for (const [index, task] of given.tasks.entries()) {
    solve(task, given.reference, given.old.charAt(index));
    solve(task, given.fresh, given.made.charAt(index));
  }
  for (const [index, task] of (given.base === undefined ? [] : given.tasks).entries()) {
    solve(task, STARTER, given.base?.charAt(index) ?? "");
  }
  // The comparison's own arithmetic, by hand: a task with a counted solve a side is tallied, and
  // won by the side whose answer alone was valid.
  const ends = given.tasks.map((task, index) => ({
    task,
    old: given.old.charAt(index),
    made: given.made.charAt(index),
    base: given.base?.charAt(index) ?? "",
  }));
  const whole = ends.filter(({ old, made }) => COUNTED.includes(old) && COUNTED.includes(made));
  const tested = (other: "old" | "base") => {
    const wins = whole.filter((each) => each.made === "p" && each[other] === "f").length;
    const losses = whole.filter((each) => each.made === "f" && each[other] === "p").length;
    return { wins, losses, ties: whole.length - wins - losses, p: signP(wins, losses) };
  };
  record("comparison.reported", {
    ...terms,
    tasks: given.tasks.length,
    reading: "no-step",
    scored: tested("old"),
    against: given.base === undefined ? null : tested("base"),
    versions: whole.map(({ task }) => task),
    short: ends.flatMap((each) => (whole.includes(each) ? [] : [each.task])),
    aside: [],
  });
  comparison = "a-later-comparison";
  later?.({ record, solve });
  return events;
}

const writes = () => ["reader", "artifact-writer"];
const read = (name: string, given: Given) => roundOf(name, round(`${name}-1`, given), `${name}-1`, writes);

describe("the runs comparison", () => {
  it("says a round as its log holds it, each set's solves by harness and non-results apart", () => {
    const log = round("b-1", { ...OPUS, old: "ppfn", made: "pf-p" });
    expect(roundOf("b", log, "b-1", writes).said).toEqual([
      "contract c1 · source host-1 · scored set of 4: a1 a2 a3 a4",
      "Builder p/opus, high (wall 1800s, turns 40, practice solves 1), ended at wall",
      "solver p/opus, medium, off",
      "harness h-parent > h-a, which declares an artifact-writer, compared with h-parent",
      "not read against the starter",
      // Two tasks have a counted solve a side; a3 and a4 are short of theirs.
      "reported no-step, for 4 tasks asked for: scored 0 won, 1 lost, 1 tied on 2 tasks, p 1",
      "practice h-draft: 1 pass",
      "scored reference: 2 pass, 1 fail rejected, 1 non-result killed",
      "scored fresh: 2 pass, 1 fail rejected, 1 unfinished",
    ]);
  });

  it("says the starter's test and its solves where the comparison solved it", () => {
    const said = roundOf(
      "b",
      round("b-1", { ...OPUS, old: "ffff", made: "pppp", base: "ffpp" }),
      "b-1",
      writes,
    ).said;
    expect(said).toContain("against the starter h-base: 2 won, 0 lost, 2 tied");
    // A round compared with the starter itself, as every round is until a promotion.
    expect(roundOf("b", round("b-1", { ...OPUS, reference: STARTER }), "b-1", writes).said).toContain(
      "the reference harness is the starter",
    );
    expect(said.slice(-3)).toEqual([
      "scored reference: 4 fail rejected",
      "scored fresh: 4 pass",
      "scored starter: 2 pass, 2 fail rejected",
    ]);
  });

  it("counts a round's own solves alone, whatever was solved after its report", () => {
    // After the report a later comparison solves a1 again under the harness the round left.
    const log = round("b-1", OPUS, [], (to) => {
      to.solve("a1", OPUS.fresh, "f");
      to.solve("a1", OPUS.fresh, "f");
    });
    expect(roundOf("b", log, "b-1", writes).said.slice(-2)).toEqual([
      "scored reference: 3 pass, 1 fail rejected",
      "scored fresh: 2 pass, 2 fail rejected",
    ]);
    // A second round of the same log goes on from the harness the first left, and is compared
    // with the same reference harness, which each comparison solved afresh.
    const two = round("b-2", { ...OPUS, parent: OPUS.fresh, fresh: "h-b", old: "pfpf", made: "pppp" }, log);
    expect(compared(roundOf("r:b-1", two, "b-1", writes), roundOf("r:b-2", two, "b-2", writes))).toEqual([
      "r:b-1 against r:b-2, given differently: parent harness",
      "  reference h-parent against reference h-parent: replicas, which differ by solve noise",
      "    tasks both scored: both fail 1, both pass 2, r:b-1 ahead 1",
      "  fresh h-a against fresh h-b: comparable in parent harness, beside solve noise and what each Builder session made",
      "    tasks both scored: both pass 2, r:b-2 ahead 2",
    ]);
  });

  it("says when a log's solves name no comparison, as none did before 2026-10-09", () => {
    const older = round("b-1", OPUS).map((event) => {
      const { comparison: _comparison, ...data } = event.data;
      return event.kind === "solve.started" ? { ...event, data } : event;
    });
    const said = roundOf("b", older, "b-1", writes).said;
    expect(said).toContain(
      "its solves name no comparison, as none did before 2026-10-09: its tasks cannot be read pair by pair, and each reads unresolved below",
    );
    // Its solves are still counted, from the round's own window of the log.
    expect(said.slice(-2)).toEqual([
      "scored reference: 3 pass, 1 fail rejected",
      "scored fresh: 2 pass, 2 fail rejected",
    ]);
    expect(roundOf("b", round("b-1", OPUS), "b-1", writes).said.join("\n")).not.toContain(
      "name no comparison",
    );
  });

  it("says a harness that declares no artifact-writer, and a report that tallied no task", () => {
    const log = round("a-1", OPUS).map((event) =>
      event.kind === "comparison.reported"
        ? { ...event, data: { ...event.data, reading: "not-scored", versions: [], aside: [...OPUS.tasks] } }
        : event,
    );
    const said = roundOf("a", log, "a-1", () => ["reader"]).said;
    expect(said).toContain(
      "harness h-parent > h-a, which declares no artifact-writer, so no solve under it can prepare an answer to submit, compared with h-parent",
    );
    expect(said.find((line) => line.startsWith("reported"))).toBe(
      "reported not-scored, for 4 tasks asked for: scored 0 won, 1 lost, 3 tied on no task, so the round could not step",
    );
    // The tasks it set aside are its scored set still, and their solves are counted.
    expect(said[0]).toBe("contract c1 · source host-1 · scored set of 4: a1 a2 a3 a4");
    expect(roundOf("a", log, "a-1", () => null).said).toContain(
      "harness h-parent > h-a, whose tool spec is not on disk, compared with h-parent",
    );
  });

  it("reads a round whose Builder is still at work, and refuses a log with no round in it", () => {
    const log = round("a-1", OPUS);
    const building = log.slice(
      0,
      log.findIndex(({ kind }) => kind === "build.finished"),
    );
    expect(roundOf("a", building, "a-1", writes).said.slice(1)).toEqual([
      "Builder p/opus, high (wall 1800s, turns 40, practice solves 1), still building",
      "solver p/opus, medium, off",
      "harness h-parent > none kept, compared with h-parent",
      "not read against the starter",
      "not reported yet",
      "practice h-draft: 1 pass",
    ]);
    expect(() => roundOf("a", log, "a-2", writes)).toThrow("a holds no Builder session a-2");
  });

  it("pairs a harness one round kept with the round that was compared with it", () => {
    // The operator promoted h-a: the next round starts from it and is compared with it, under
    // another solver.
    const next = {
      ...OPUS,
      parent: "h-a",
      reference: "h-a",
      solver: "q/sol",
      fresh: "h-x",
      old: "ppfp",
      made: "pppp",
    };
    const log = round("x-1", next, round("a-1", OPUS));
    const [first, cross] = [roundOf("a:a-1", log, "a-1", writes), roundOf("a:x-1", log, "x-1", writes)];
    expect(cross.said.slice(-2)).toEqual([
      "scored reference: 3 pass, 1 fail rejected",
      "scored fresh: 4 pass",
    ]);
    expect(compared(first, cross)).toEqual([
      "a:a-1 against a:x-1, given differently: parent harness, reference harness, solver",
      "  reference h-parent against reference h-a: not comparable in one variable: reference harness, solver moved together",
      "    tasks both scored: a:a-1 ahead 1, a:x-1 ahead 1, both pass 2",
      "  fresh h-a against fresh h-x: not comparable in one variable: parent harness, solver moved together",
      "    tasks both scored: a:x-1 ahead 2, both pass 2",
      "  fresh h-a against reference h-a: comparable in solver, beside solve noise",
      "    tasks both scored: a:x-1 ahead 1, both fail 1, both pass 2",
    ]);
  });

  it("reads two rounds given the same as replicas, and a task one of them did not tally as unresolved", () => {
    const b = read("b", { ...OPUS, fresh: "h-b", old: "ppfn", made: "pf-p" });
    expect(compared(read("a", OPUS), b)).toEqual([
      "a against b, given differently: nothing",
      "  reference h-parent against reference h-parent: replicas, which differ by solve noise",
      "    tasks both scored: both pass 2, unresolved 2",
      "  fresh h-a against fresh h-b: replicas, which differ by solve noise and what each Builder session made",
      "    tasks both scored: a ahead 1, both pass 1, unresolved 2",
    ]);
  });

  it("is comparable in the solver on the reference harness alone when the Builder moved with it", () => {
    expect(compared(read("a", OPUS), read("s", SOL))).toEqual([
      "a against s, given differently: Builder, solver",
      "  reference h-parent against reference h-parent: comparable in solver, beside solve noise",
      "    tasks both scored: both pass 3, s ahead 1",
      "  fresh h-a against fresh h-s: not comparable in one variable: Builder, solver moved together",
      "    tasks both scored: a ahead 2, both fail 2",
    ]);
  });

  it("refuses rounds whose contract differs, or that scored no task in common", () => {
    expect(compared(read("a", OPUS), read("d", { ...OPUS, contract: "c2" }))).toEqual([
      "a against d: not-comparable. They differ in the contract, so they did not solve under the same rules and checks",
    ]);
    expect(compared(read("a", OPUS), read("e", { ...OPUS, tasks: ["b1", "b2", "b3", "b4"] }))).toEqual([
      "a against e: not-comparable. They scored no task in common",
    ]);
  });
});

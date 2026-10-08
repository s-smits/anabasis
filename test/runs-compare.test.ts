// The runs comparison reads rounds from their logs alone: what each was given, its solves by set and
// by harness with non-results apart, and for two rounds whether what they were given differently is
// one variable. These rounds are small enough to count by hand: one practice task, one task screened
// and scored, and an anchor of four solved once a side.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { compared, roundOf } from "../tools/runs/compare.ts";

const START = Date.parse("2026-10-08T12:00:00Z");
const ENDINGS = new Map<string, JsonObject>([
  ["p", { outcome: "pass" }],
  ["f", { outcome: "fail", kind: "rejected" }],
  ["n", { outcome: "non-result", kind: "killed", reason: "the host ended it" }],
]);

interface Given {
  readonly builder: string;
  readonly solver: string;
  readonly parent: string;
  readonly fresh: string;
  readonly contract: string;
  readonly anchor: readonly string[];
  /** Each anchor task's one solve under the old harness: p a pass, f a fail, n a non-result, and
   *  any other letter a solve with no ending. */
  readonly old: string;
  /** The same under the fresh harness. */
  readonly made: string;
}

const OPUS: Given = {
  builder: "p/opus",
  solver: "p/opus",
  parent: "h-parent",
  fresh: "h-a",
  contract: "c1",
  anchor: ["a1", "a2", "a3", "a4"],
  old: "pppf",
  made: "ppff",
};
const SOL: Given = { ...OPUS, builder: "q/sol", solver: "q/sol", fresh: "h-s", old: "pppp", made: "ffff" };

/** The log of one round given `given`: its tasks' gates, the anchor's draw, a Builder session with
 *  one practice solve, a task screened and scored, the anchor's solves and the round's report. A
 *  round after `before` in the same log proposes and screens nothing: its tasks are the log's. */
function round(session: string, given: Given, before: readonly LogEvent[] = []): LogEvent[] {
  const events = [...before];
  const first = before.length === 0;
  const record = (kind: EventKind, data: JsonObject) => {
    events.push({ at: new Date(START + events.length * 1_000).toISOString(), kind, data });
  };
  const solve = (task: string, harness: string, ending: string) => {
    const under: Condition = {
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
    };
    const id = `${session}-${String(events.length)}`;
    record("condition.recorded", { id: conditionId(under), condition: requireJsonValue(under) });
    record("solve.started", { solve: id, condition: conditionId(under) });
    const ended = ENDINGS.get(ending);
    if (ended !== undefined) record("solve.finished", { solve: id, ending: ended });
  };
  for (const version of first ? ["p1", "t1", ...given.anchor] : []) {
    record("task.proposed", { version });
    for (const gate of [1, 2, 3, 4]) record("task.gate", { version, gate, outcome: "passed", controls: "d" });
  }
  if (first) {
    record("anchor.drawn", { tasks: [...given.anchor] });
    record("task.state", { version: "p1", state: "released" });
  }
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
  if (first) {
    solve("t1", given.parent, "f");
    record("task.state", { version: "t1", state: "admitted", session });
  }
  solve("t1", given.parent, "f");
  solve("t1", given.fresh, "p");
  for (const [index, task] of given.anchor.entries()) {
    solve(task, given.parent, given.old.charAt(index));
    solve(task, given.fresh, given.made.charAt(index));
  }
  record("anchor.scored", {
    session,
    reading: "held",
    wins: 0,
    losses: 1,
    ties: 3,
    informative: 1,
    floor: 1,
    solves: 1,
  });
  record("comparison.reported", {
    session,
    reading: "step",
    scored: { wins: 1, losses: 0, ties: 0, p: 0.5 },
    versions: ["t1"],
  });
  return events;
}

const writes = () => ["reader", "artifact-writer"];
const read = (name: string, given: Given) => roundOf(name, round(`${name}-1`, given), `${name}-1`, writes);

describe("the runs comparison", () => {
  it("says a round as its log holds it, each set's solves by harness and non-results apart", () => {
    const log = round("b-1", { ...OPUS, old: "ppfn", made: "pf-p" });
    expect(roundOf("b", log, "b-1", writes).said).toEqual([
      "contract c1 · source host-1 · anchor of 4: a1 a2 a3 a4",
      "Builder p/opus, high (wall 1800s, turns 40, practice solves 1), ended at wall",
      "solver p/opus, medium, off",
      "harness h-parent > h-a, which declares an artifact-writer",
      "anchor held: 0 won, 1 lost, 3 tied (informative 1, floor 1, solves a side 1)",
      "reported step, for a target its log does not hold: scored 1 won, 0 lost, 0 tied on 1 task, p 0.5",
      "practice h-draft: 1 pass",
      "screened old: 1 fail rejected",
      "scored old: 1 fail rejected",
      "scored fresh: 1 pass",
      "anchor old: 2 pass, 1 fail rejected, 1 non-result killed",
      "anchor fresh: 2 pass, 1 fail rejected, 1 unfinished",
    ]);
  });

  it("says a harness that declares no artifact-writer, and a report that scored no task", () => {
    const log = round("a-1", OPUS).map((event) =>
      event.kind === "comparison.reported"
        ? { ...event, data: { ...event.data, reading: "no-step", versions: [] } }
        : event,
    );
    const said = roundOf("a", log, "a-1", () => ["reader"]).said;
    expect(said).toContain(
      "harness h-parent > h-a, which declares no artifact-writer, so no solve under it can prepare an answer to submit",
    );
    expect(said.find((line) => line.startsWith("reported"))).toBe(
      "reported no-step, for a target its log does not hold: scored 1 won, 0 lost, 0 tied on no task, so the round could not step",
    );
    const asked = log.map((event) =>
      event.kind === "comparison.reported" ? { ...event, data: { ...event.data, target: 0 } } : event,
    );
    expect(roundOf("a", asked, "a-1", writes).said.find((line) => line.startsWith("reported"))).toStartWith(
      "reported no-step, for a target of 0: scored",
    );
    expect(roundOf("a", log, "a-1", () => null).said).toContain(
      "harness h-parent > h-a, whose tool spec is not on disk",
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
      "harness h-parent > none kept",
      "anchor not scored yet",
      "not reported yet",
      "practice h-draft: 1 pass",
    ]);
    expect(() => roundOf("a", log, "a-2", writes)).toThrow("a holds no Builder session a-2");
  });

  it("counts each round of a log on its own solves, and pairs a kept harness with the round started from it", () => {
    const next = { ...OPUS, parent: "h-a", solver: "q/sol", fresh: "h-x", old: "ppfp", made: "pppp" };
    const log = round("x-1", next, round("a-1", OPUS));
    const [first, cross] = [roundOf("a:a-1", log, "a-1", writes), roundOf("a:x-1", log, "x-1", writes)];
    const counted = ({ said }: typeof first) =>
      said.filter((line) => /^(screened|scored|anchor) /.test(line));
    expect(counted(first).slice(1)).toEqual([
      "screened old: 1 fail rejected",
      "scored old: 1 fail rejected",
      "scored fresh: 1 pass",
      "anchor old: 3 pass, 1 fail rejected",
      "anchor fresh: 2 pass, 2 fail rejected",
    ]);
    expect(counted(cross).slice(1)).toEqual([
      "scored old: 1 fail rejected",
      "scored fresh: 1 pass",
      "anchor old: 3 pass, 1 fail rejected",
      "anchor fresh: 4 pass",
    ]);
    expect(compared(first, cross)).toEqual([
      "a:a-1 against a:x-1, given differently: parent harness, solver",
      "  old h-parent against old h-a: not comparable in one variable: parent harness, solver moved together",
      "    anchor tasks: a:a-1 ahead 1, a:x-1 ahead 1, both pass 2",
      "  fresh h-a against fresh h-x: not comparable in one variable: parent harness, solver moved together",
      "    anchor tasks: a:x-1 ahead 2, both pass 2",
      "  fresh h-a against old h-a: comparable in solver, beside solve noise",
      "    anchor tasks: a:x-1 ahead 1, both fail 1, both pass 2",
    ]);
  });

  it("reads two rounds given the same as replicas, and a task one of them did not decide as unresolved", () => {
    const b = read("b", { ...OPUS, fresh: "h-b", old: "ppfn", made: "pf-p" });
    expect(compared(read("a", OPUS), b)).toEqual([
      "a against b, given differently: nothing",
      "  old h-parent against old h-parent: replicas, which differ by solve noise",
      "    anchor tasks: a ahead 1, both pass 2, unresolved 1",
      "  fresh h-a against fresh h-b: replicas, which differ by solve noise and what each Builder session made",
      "    anchor tasks: a ahead 1, b ahead 1, both pass 1, unresolved 1",
    ]);
  });

  it("is comparable in the solver on the old harness alone when the Builder moved with it", () => {
    expect(compared(read("a", OPUS), read("s", SOL))).toEqual([
      "a against s, given differently: Builder, solver",
      "  old h-parent against old h-parent: comparable in solver, beside solve noise",
      "    anchor tasks: both pass 3, s ahead 1",
      "  fresh h-a against fresh h-s: not comparable in one variable: Builder, solver moved together",
      "    anchor tasks: a ahead 2, both fail 2",
    ]);
  });

  it("refuses rounds whose contract or anchor set differs", () => {
    const other = read("d", { ...OPUS, contract: "c2", anchor: ["a1", "a2", "a3", "a9"] });
    expect(compared(read("a", OPUS), other)).toEqual([
      "a against d: not-comparable. They differ in the anchor set and the contract, so they did not solve the same tasks under the same checks",
    ]);
  });
});

// The practice table over one invented Builder session: a probe of the starter, a practice call that
// erred and started no solve, a shell write that moved the state with no edit call, a frozen
// checkpoint practised before and after a promotion in the middle of the session, and a solve whose
// condition names no harness. The solves come from `practiceOf`, never from the call's text, which
// here names a solve that never ran.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { hashJsonValue, requireJsonValue } from "../src/meta/stable-json.ts";
import { practiceRows } from "../tools/wri/practice.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const events: LogEvent[] = [];
const put = (kind: EventKind, data: JsonObject) => {
  events.push({ at: new Date(Date.UTC(2026, 10, 5) + events.length * 1000).toISOString(), kind, data });
};
function solve(id: string, task: string, harness: string | null, outcome: "pass" | "fail") {
  const { harness: _named, ...unnamed } = conditionOf(task, harness ?? "");
  const condition = requireJsonValue(harness === null ? unnamed : { ...unnamed, harness });
  const named = hashJsonValue(condition);
  put("condition.recorded", { id: named, condition });
  put("solve.started", { solve: id, condition: named, limits: { wallSeconds: 100 } });
  put("solve.finished", {
    solve: id,
    ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
    seconds: 5,
  });
}
const call = (turn: number, tool: string, args: JsonObject, isError = false) =>
  put("build.call", { session: "b-1", turn, tool, args, isError, text: "practice solves: s-ghost" });

for (const version of ["t1", "t2", "v1"]) {
  put("task.proposed", { version, taskId: `id-${version}` });
  put("task.gate", { version, gate: 1, outcome: "passed" });
}
for (const version of ["t1", "t2"]) put("task.state", { version, state: "released" });
put("build.started", { session: "b-1", parent: "hstarter", tasks: ["t1", "t2"] });
solve("s1", "t1", "hstarter", "fail");
call(1, "practice", { task: "t1" });
call(2, "practice", { task: "nothing" }, true);
call(3, "bash", { command: "printf 'x' > .toolchain/bin/fit" });
solve("s2", "t1", "hshell", "pass");
call(4, "practice", { task: "t1" });
put("build.checkpoint", { session: "b-1", harness: "hfrozen" });
put("comparison.started", {
  session: "g-1",
  old: "hstarter",
  fresh: "hfrozen",
  starter: "hstarter",
  tasks: ["v1"],
});
put("comparison.reported", {
  session: "g-1",
  old: "hstarter",
  fresh: "hfrozen",
  reading: "step",
  scored: {},
});
solve("s3", "t2", "hfrozen", "pass");
call(5, "practice", { task: "t2" });
put("harness.promoted", { harness: "hfrozen", from: "hstarter", rests: ["g-1"] });
solve("s4", "t2", "hfrozen", "fail");
call(6, "practice", { task: "t2" });
call(7, "edit", { path: "agent/BUILT_AGENTS.md" });
solve("s5", "t2", null, "pass");
call(8, "practice", { task: "t2" });
put("build.finished", { session: "b-1", ended: "finished", harness: "hfrozen", changed: true });

const rows = practiceRows(events);
const rowOf = (id: string) => rows.find((row) => row.split("\t")[2] === id)?.split("\t") ?? [];

describe("the practice table", () => {
  it("takes its solves from the log, not from the call's text", () => {
    expect(rows.filter((row) => row.startsWith("b-1\t"))).toHaveLength(5);
    expect(rows.join("\n")).not.toContain("s-ghost");
  });

  it("reads each solve's role as it stood when the solve started, across a promotion in the session", () => {
    expect(rowOf("s1")[5]).toBe("starter");
    expect(rowOf("s2")[5]).toBe("practised-only");
    expect(rowOf("s3")[5]).toBe("compared g-1 (step)");
    expect(rowOf("s4")[5]).toBe("reference");
  });

  it("names the turn of the practice call that returned each solve, and counts the call that started none", () => {
    expect(rowOf("s1")[1]).toBe("1");
    expect(rowOf("s2")[1]).toBe("4");
    expect(rows).toContain("practice calls that started no solve: 1");
  });

  it("reads a state moved by a shell write from the digests, with the shell call beside it", () => {
    expect(rowOf("s2")[8]).toBe("state moved from hstarter; 0 file-tool, 1 shell naming the harness");
    expect(rowOf("s4")[8]).toStartWith("same state");
  });

  it("says when a solve's condition names no harness and the reading rests on the edit calls", () => {
    expect(rowOf("s5")[8]).toBe(
      "state not recorded; rests on edit calls alone: 1 file-tool, 0 shell naming the harness",
    );
    expect(rowOf("s5")[5]).toBe("not recorded");
  });

  it("totals the solves by role", () => {
    expect(rows.find((row) => row.startsWith("totals:"))).toContain("5 practice solves");
  });
});

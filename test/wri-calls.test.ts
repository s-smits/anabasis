// Which program a solve's call ran, through the wrappers a solver puts around one, and the table,
// list and sequences over an invented comparison: two harnesses holding the same program path, a cut
// solve, a non-result, a practice solve and a call whose result says the command exited non-zero.
import { describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { callRows, listRows, sequenceRows } from "../tools/wri/calls.ts";
import { programsOf } from "../tools/wri/programs.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const events: LogEvent[] = [];
const PASS = { outcome: "pass" };
const ALL = { harness: null, program: null, command: null, output: null };
const shell = (command: string) => programsOf({ tool: "bash", args: { command } });

describe("which program a call ran", () => {
  it("names each stage of a list and a pipe, and no directory change", () => {
    expect(shell("cd x && .toolchain/bin/fit a | tee out")).toEqual({
      programs: ["fit", "tee"],
      unattributed: 0,
    });
  });

  it("counts a program run through a shell's -c once, under the program", () => {
    expect(shell(`bash -lc "fit a --deep"`)).toEqual({ programs: ["fit"], unattributed: 0 });
  });

  it("reads an interpreter's script and a prefix's program", () => {
    expect(shell("python3 -B .toolchain/lib/fit.py a").programs).toEqual(["fit.py"]);
    expect(shell("timeout 30 fit a").programs).toEqual(["fit"]);
    expect(shell("FOO=1 env -i fit a").programs).toEqual(["fit"]);
  });

  it("counts a segment whose program the text does not name as not attributed", () => {
    expect(shell("$RUN x; fit")).toEqual({ programs: ["fit"], unattributed: 1 });
  });

  it("names no program out of a word that cannot be one, and keeps one that can", () => {
    expect(shell("for i in 1 2; do n=$((i+1)); done; ..; -v")).toEqual({ programs: [], unattributed: 3 });
    expect(shell("g++ a.cc && python3 ./..")).toEqual({ programs: ["g++", "python3"], unattributed: 0 });
  });

  it("reads no program out of a redirection or a heredoc's body", () => {
    expect(shell("fit a 2>&1 > log.txt").programs).toEqual(["fit"]);
    expect(shell("cat <<'EOF' > in.json\nrm -rf x | danger\nEOF\nfit in.json").programs).toEqual([
      "cat",
      "fit",
    ]);
  });

  it("names a tool other than bash by its own name", () => {
    expect(programsOf({ tool: "submit", args: {} })).toEqual({ programs: ["submit"], unattributed: 0 });
  });
});

const put = (kind: EventKind, data: JsonObject) => {
  events.push({ at: new Date(Date.UTC(2026, 10, 5) + events.length * 1000).toISOString(), kind, data });
};
let count = 0;
/** A solve of `task` under `harness`, ending as `ending` says, that ran `commands` and submitted. */
function solve(
  task: string,
  harness: string,
  comparison: string | null,
  ending: JsonObject,
  commands: readonly string[],
) {
  const id = `s${String((count += 1))}`;
  const condition = conditionOf(task, harness);
  put("condition.recorded", { id: conditionId(condition), condition: requireJsonValue(condition) });
  put("solve.started", {
    solve: id,
    condition: conditionId(condition),
    limits: { wallSeconds: 100 },
    ...keyIfNotNull("comparison", comparison),
  });
  for (const [turn, command] of commands.entries()) {
    const failed = command.includes("--bad");
    put("solve.call", {
      solve: id,
      turn,
      tool: "bash",
      args: { command },
      isError: false,
      text: failed ? "boom\nCommand exited with code 2" : "SECRET-OUTPUT /tmp/shared",
    });
  }
  put("solve.call", { solve: id, turn: commands.length, tool: "submit", args: {}, isError: false, text: "" });
  put("solve.finished", { solve: id, ending, seconds: 10 * count });
  return id;
}

for (const version of ["t1", "v1"]) {
  put("task.proposed", { version, taskId: `id-${version}`, family: "rota" });
  put("task.gate", { version, gate: 1, outcome: "passed" });
}
put("task.state", { version: "t1", state: "released" });
put("build.started", { session: "b-1", parent: "hold0000", tasks: ["t1"] });
solve("t1", "hnew0000", null, PASS, ["fit a"]);
put("build.finished", { session: "b-1", ended: "finished", harness: "hnew0000" });
put("comparison.started", {
  session: "g-1",
  old: "hold0000",
  fresh: "hnew0000",
  starter: "hold0000",
  tasks: ["v1"],
});
solve("v1", "hold0000", "g-1", PASS, [".toolchain/bin/fit a", ".toolchain/bin/fit b", "check x"]);
solve("v1", "hold0000", "g-1", { outcome: "fail", kind: "wall-ended" }, [
  ".toolchain/bin/fit --bad",
  "cat /tmp/shared/x",
]);
solve("v1", "hnew0000", "g-1", PASS, [".toolchain/bin/fit a", ".toolchain/bin/fit b", "check x"]);
solve("v1", "hnew0000", "g-1", { outcome: "provider" }, ["fit a"]);

const rowOf = (rows: readonly string[], harness: string, side: string, program: string) =>
  rows
    .find((row) => row.startsWith(`${harness}\t${side}\t`) && row.split("\t")[3] === program)
    ?.split("\t") ?? [];

describe("the calls table", () => {
  const rows = callRows(events, ALL);

  it("keys one program path apart under each harness digest and side", () => {
    expect(rowOf(rows, "hold0000", "reference", "fit").slice(2)).toEqual([
      "2",
      "fit",
      "2",
      "3",
      "0",
      "1",
      "1/1/0",
    ]);
    expect(rowOf(rows, "hnew0000", "candidate", "fit").slice(2)).toEqual([
      "2",
      "fit",
      "2",
      "3",
      "0",
      "0",
      "1/0/1",
    ]);
    expect(rowOf(rows, "hnew0000", "practice", "fit").slice(2, 6)).toEqual(["1", "fit", "1", "1"]);
  });

  it("reads a cut solve as its side's fail and a provider ending as a non-result, never as a program's error", () => {
    const fit = rowOf(rows, "hold0000", "reference", "fit");
    expect(fit[6]).toBe("0");
    expect(fit[8]).toBe("1/1/0");
    expect(rowOf(rows, "hnew0000", "candidate", "fit")[8]).toBe("1/0/1");
  });

  it("counts only the named program under --program", () => {
    const only = callRows(events, { ...ALL, program: "check" });
    expect(only.filter((row) => row.split("\t")[3] === "fit")).toHaveLength(0);
    expect(rowOf(only, "hnew0000", "candidate", "check")[5]).toBe("1");
  });
});

describe("the list of matching calls", () => {
  it("prints one row a call and never its command or result", () => {
    const rows = listRows(events, { ...ALL, command: /\/tmp\//u });
    expect(rows.slice(2)).toEqual(["s3\treference\thold0000\tbash\tok\tcat"]);
    expect(rows.join("\n")).not.toContain("/tmp/shared");
    expect(rows.join("\n")).not.toContain("SECRET-OUTPUT");
  });
});

describe("the sequences of passes", () => {
  it("collapses a run of one program and gives the commonest sequence's share", () => {
    const rows = sequenceRows(events, ALL);
    const old = rows.find((row) => row.startsWith("rota\thold0000"))?.split("\t") ?? [];
    expect(old.slice(2)).toEqual(["1", "1", "100%", "20", "fit*2 > check > submit"]);
    const fresh = rows.find((row) => row.startsWith("rota\thnew0000"))?.split("\t") ?? [];
    expect(fresh.slice(2, 5)).toEqual(["2", "2", "50%"]);
  });
});

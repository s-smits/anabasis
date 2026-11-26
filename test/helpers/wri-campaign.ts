// A synthetic campaign for the investigation's tests: every prompt, statement, hidden value, answer,
// check failure text, note, ruling reason and seat's prose, call and result is `secret(tag)`, so two
// secrets give two logs differing only in what may never be quoted. Round one reads no step over a
// ruled check defect and two answers cut at the wall; round two a promoted step beside an unclear
// ruling, a provider non-result and a check fault.
import { conditionId, settingId } from "../../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../../src/kernel/log.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { requireJsonValue } from "../../src/meta/stable-json.ts";
import { conditionOf } from "./logged-round.ts";

const START = Date.parse("2026-10-09T12:00:00Z");
const TASKS = ["v1", "v2", "v3", "v4"];
type Outcome = "pass" | "rejected" | "late" | "provider" | "faulty";

/** How a solve of each outcome ends, and the verdict its answer drew, given the check's failure text. */
const ENDINGS: Record<Outcome, (failure: string) => JsonObject> = {
  pass: () => ({ outcome: "pass" }),
  rejected: () => ({ outcome: "fail", kind: "rejected" }),
  late: () => ({ outcome: "fail", kind: "wall-ended" }),
  provider: () => ({ outcome: "non-result", kind: "provider", reason: "rate limited" }),
  faulty: (failure) => ({ outcome: "non-result", kind: "check", reason: `check-a: ${failure}` }),
};
const VERDICTS: Record<Outcome, (failure: string) => JsonObject | null> = {
  pass: () => ({ kind: "pass" }),
  rejected: (failure) => ({ kind: "fail", blocking: ["check-a"], reasons: { "check-a": failure } }),
  late: () => null,
  provider: () => null,
  faulty: (failure) => ({ kind: "faulty", check: "check-a", reason: failure }),
};

export function wriCampaign(secret: (tag: string) => string): LogEvent[] {
  const log: LogEvent[] = [];
  const put = (kind: EventKind, data: JsonObject) => {
    log.push({ at: new Date(START + log.length * 1000).toISOString(), kind, data });
  };
  const condition = (task: string, harness: string) =>
    conditionOf(task, harness, { wallSeconds: 100, turns: 8 });
  const setting = settingId(condition("any", "any"));
  let count = 0;
  const solve = (task: string, harness: string, outcome: Outcome, comparison?: string) => {
    const ran = condition(task, harness);
    const id = `s${String((count += 1))}`;
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put("solve.started", {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100 },
      ...keyIfDefined("comparison", comparison),
    });
    put("solve.turn", { solve: id, turn: 1, text: secret(`solver ${id}`), usage: { cost: { total: 0.01 } } });
    const command = `python3 agent/solve.py --value ${secret(`argument ${id}`)}`;
    const output = secret(`output ${id}`);
    put("solve.call", {
      solve: id,
      turn: 1,
      tool: "bash",
      args: { command },
      text: output,
      isError: false,
      ms: 5,
    });
    const answer = secret(`answer ${id}`);
    put("solve.call", {
      solve: id,
      turn: 2,
      tool: "submit",
      args: { answer },
      text: "ok",
      isError: false,
      ms: 1,
    });
    const failure = secret(`check failure ${id}`);
    const ending = ENDINGS[outcome](failure);
    put("solve.finished", { solve: id, ending, seconds: 50, responseModels: ["m-1"], billed: 1 });
    const verdict = VERDICTS[outcome](failure);
    if (verdict !== null) put("verdict", { solve: id, task, answer: { value: answer }, ...verdict });
    return id;
  };
  const ruling = (id: string, task: string, reader: string, ruled: string) =>
    put("referee.finding", {
      solve: id,
      task,
      reader,
      ruling: ruled,
      check: "check-a",
      rule: null,
      field: null,
      reason: secret(`reason ${id}`),
      probes: [],
    });
  const build = (session: string, parent: string, harness: string, practice: string) => {
    put("build.started", { session, parent, tasks: ["t1"] });
    put("build.turn", {
      session,
      turn: 1,
      text: secret(`builder ${session}`),
      usage: { cost: { total: 0.3 } },
    });
    const content = secret(`file ${session}`);
    const file = { path: "agent/tools.mjs", content };
    put("build.call", {
      session,
      turn: 1,
      tool: "write_file",
      args: file,
      text: "written",
      isError: false,
      ms: 1,
    });
    const result = secret(`practice ${session}`);
    put("build.call", {
      session,
      turn: 2,
      tool: "practice",
      args: { task: "t1" },
      text: result,
      isError: false,
      ms: 1,
    });
    solve("t1", practice, "rejected");
    put("build.finished", {
      session,
      ended: "finished",
      harness,
      changed: true,
      billed: 2,
      note: secret(`builder note ${session}`),
    });
  };
  const report = (
    round: JsonObject,
    scored: JsonObject,
    reading: string,
    versions: string[],
    aside: string[],
  ) =>
    put("comparison.reported", {
      ...round,
      tasks: 4,
      scored,
      versions,
      aside,
      short: [],
      capped: false,
      reading,
    });

  put("campaign.opened", { prompt: secret("campaign prompt"), domain: "buffers" });
  put("exam.started", { session: "x-1", examples: [], prompt: secret("examiner prompt") });
  put("exam.turn", { session: "x-1", turn: 1, text: secret("examiner"), usage: { cost: { total: 0.2 } } });
  const proposal = { note: secret("examiner args") };
  put("exam.call", {
    session: "x-1",
    turn: 1,
    tool: "propose_tasks",
    args: proposal,
    text: secret("examiner result"),
    isError: false,
    ms: 2,
  });
  for (const [place, version] of ["t1", ...TASKS].entries()) {
    const taskId = `x-1-00${String(place + 1)}`;
    const hidden = { target: secret(`hidden ${taskId}`) };
    const publicInput = { volume_L: 1, systems: ["Tris"], statement: secret(`statement ${taskId}`) };
    const task = { taskId, family: "buffers", publicInput, hidden };
    put("task.proposed", {
      version,
      taskId,
      session: "x-1",
      task,
      claim: { stops: secret(`claim ${taskId}`) },
    });
    put("task.gate", { version, gate: 1, outcome: "passed" });
    put("task.feasible", { version, session: "x-1", answer: secret(`author answer ${taskId}`) });
  }
  put("exam.finished", { session: "x-1", ended: "supplied", note: secret("examiner note") });
  put("task.state", { version: "t1", state: "released" });

  build("b-1", "hp", "hc", "hb");
  const first = { session: "b-1", old: "hp", fresh: "hc", starter: "hbase", setting, solves: 1, level: 0.1 };
  put("comparison.started", { ...first, tasks: TASKS, retained: [] });
  const defect = solve("v1", "hp", "rejected", "b-1");
  solve("v1", "hc", "pass", "b-1");
  const earned = solve("v2", "hp", "rejected", "b-1");
  solve("v2", "hc", "pass", "b-1");
  for (const version of ["v3", "v4"]) {
    solve(version, "hp", "late", "b-1");
    solve(version, "hc", "pass", "b-1");
  }
  put("referee.turn", { reader: "r-1", turn: 1, text: secret("referee"), usage: { cost: { total: 0.1 } } });
  const probe = { changes: [{ path: "value", value: secret("probe value") }] };
  put("referee.call", {
    reader: "r-1",
    turn: 1,
    tool: "probe",
    args: probe,
    text: secret("probe result"),
    isError: false,
    ms: 3,
  });
  put("referee.refused", {
    solve: defect,
    task: "v1",
    asked: { ruling: "earned", check: "check-a", reason: secret(`refused reason ${defect}`), probes: [] },
    why: secret(`refused why ${defect}`),
  });
  ruling(defect, "v1", "r-1", "check-defect");
  ruling(earned, "v2", "r-2", "earned");
  report(first, { wins: 2, losses: 0, ties: 0, p: 0.25, unsolved: 0 }, "no-step", ["v3", "v4"], ["v1"]);

  build("b-2", "hp", "hd", "hc");
  const second = { session: "b-2", old: "hp", fresh: "hd", starter: "hbase", setting, solves: 1, level: 0.1 };
  put("comparison.started", { ...second, tasks: TASKS, retained: [] });
  const unclear = solve("v1", "hp", "rejected", "b-2");
  solve("v1", "hd", "provider", "b-2");
  solve("v1", "hd", "faulty", "b-2");
  solve("v1", "hd", "pass", "b-2");
  for (const version of ["v2", "v3", "v4"]) {
    solve(version, "hp", "late", "b-2");
    solve(version, "hd", "pass", "b-2");
  }
  ruling(unclear, "v1", "r-3", "unclear");
  report(second, { wins: 3, losses: 0, ties: 0, p: 0.0625, unsolved: 0 }, "step", ["v2", "v3", "v4"], ["v1"]);
  put("harness.promoted", { harness: "hd", from: "hp" });
  put("campaign.ended", { reason: "stop", why: "the stop rule" });
  return log;
}

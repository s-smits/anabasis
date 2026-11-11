// The public view of a campaign's exam is blind: whatever the log and the staged exam hold beside
// it, no evaluator source, check id, assertion, hidden value, control answer, Referee probe, held-out
// task's input or answer a comparison or an Examiner asked for reaches its output. Every such field
// below carries a canary, and the view must print none of them while it prints what crosses.
import { afterAll, describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { Draft } from "../src/examiner/draft.ts";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { stagedExamOf, stageExam } from "../tools/d2/exam.ts";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { publicExam } from "../tools/wri/public-exam.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const folders: string[] = [];
const CANARIES = {
  evaluator: "canary-evaluator-source-5521",
  check: "canary-check-id-8830",
  assertion: "canary-assertion-1207",
  hidden: "canary-hidden-value-4406",
  accept: "canary-control-accept-9913",
  reject: "canary-control-reject-3348",
  unmeasured: "canary-unmeasured-7781",
  heldInput: "canary-held-out-input-6092",
  scored: "canary-scored-answer-2264",
  examiner: "canary-examiner-answer-1185",
  probe: "canary-probe-value-5057",
  reason: "canary-referee-reason-3390",
} as const;

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-public-exam-")));
  folders.push(folder);
  return folder;
}

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-10T00:00:00.000Z",
  kind,
  data,
});

const draft: Draft = {
  domain: "invented",
  scope: "public-scope-words",
  conventions: "public-convention-words",
  rules: [{ id: "R1", statement: "public-rule-statement", source: "public-rule-source" }],
  answerFormat: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
  checks: [{ id: CANARIES.check, rule: "R1", assertion: CANARIES.assertion }],
  evaluator: `export const checks = { "${CANARIES.check}": () => "${CANARIES.evaluator}" };`,
  unmeasured: CANARIES.unmeasured,
  tasks: [{ family: "f", publicInput: { ask: "example-public-input" }, hidden: { secret: CANARIES.hidden } }],
  accept: [{ task: 0, answer: { value: CANARIES.accept } }],
  reject: [{ task: 0, answer: { value: CANARIES.reject }, check: CANARIES.check }],
};

/** A task proposed with its public input and a canary hidden value, admitted, and released or held. */
function task(version: string, taskId: string, input: string, released: boolean): LogEvent[] {
  return [
    event("task.proposed", {
      version,
      taskId,
      session: "x-1",
      task: { taskId, family: "f", publicInput: { ask: input }, hidden: { secret: CANARIES.hidden } },
    }),
    event("task.gate", { version, gate: 1, outcome: "passed" }),
    ...(released ? [event("task.state", { version, state: "released" })] : []),
  ];
}

/** One solve of `version` that passed with `value`, asked for by `comparison` or by nobody. */
function solve(id: string, version: string, value: string, comparison?: string): LogEvent[] {
  const condition = conditionOf(version, "h-1");
  const cid = conditionId(condition);
  return [
    event("condition.recorded", { id: cid, condition: requireJsonValue(condition) }),
    event("solve.started", {
      solve: id,
      condition: cid,
      ...keyIfDefined("comparison", comparison),
    }),
    event("solve.finished", { solve: id, ending: { outcome: "pass" } }),
    event("verdict", { solve: id, task: version, kind: "pass", answer: { value } }),
  ];
}

function campaign(): { log: string; events: LogEvent[] } {
  const dir = scratch();
  const events = [
    event("exam.started", { session: "x-1" }),
    event("exam.drafted", { session: "x-1", draft: requireJsonValue(draft) }),
    event("checker.read", { checks: "c1", rows: [{ id: CANARIES.check, named: 1, caught: 1 }] }),
    ...task("v-released", "t-released", "released-public-input", true),
    ...task("v-held", "t-held", CANARIES.heldInput, false),
    // A practice pass, which crosses; a scored pass and an Examiner rehearsal on the same released
    // task, which do not; a scored solve on the held-out task.
    ...solve("p-1", "v-released", "practice-pass-answer"),
    ...solve("s-1", "v-released", CANARIES.scored, "c-1"),
    ...solve("s-2", "v-held", CANARIES.scored, "c-1"),
    ...solve("e-1", "v-released", CANARIES.examiner, "x-1"),
    event("referee.finding", {
      solve: "s-2",
      ruling: "earned",
      check: CANARIES.check,
      reason: CANARIES.reason,
      probeRows: [{ id: 1, changes: [{ path: "$.value", value: CANARIES.probe }] }],
    }),
  ];
  const log = join(dir, "log.jsonl");
  writeFileSync(log, events.map((each) => `${JSON.stringify(each)}\n`).join(""));
  stageExam(dir, draft);
  return { log, events };
}

describe("publicExam", () => {
  const { log, events } = campaign();
  const staged = stagedExamOf(log);
  const out = staged === null ? "" : publicExam(events, staged.bundle).join("\n");

  it("prints what crosses: the rules, scope, conventions, format, the released input and its practice pass", () => {
    for (const shown of [
      "R1: public-rule-statement",
      "public-scope-words",
      "public-convention-words",
      '"required":["value"]',
      "released-public-input",
      "practice-pass-answer",
      "held out: 1 task",
    ]) {
      expect(out).toContain(shown);
    }
  });

  it("prints no canary, whatever the log and the staged exam hold beside the public part", () => {
    expect(out.length).toBeGreaterThan(0);
    for (const [field, canary] of Object.entries(CANARIES)) {
      expect({ field, leaked: out.includes(canary) }).toEqual({ field, leaked: false });
    }
  });

  it("passes the lane guard as a lane runs it", () => {
    expect(refusalOf("Bash", { command: `bun tools/wri/public-exam.ts ${log}` })).toBeNull();
  });
});

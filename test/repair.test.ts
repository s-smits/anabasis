// The Examiner's repair mode (`src/examiner/repair.ts`): what a session that repairs its check
// program or its controls is shown of the campaign, and what not; how the controls it puts join
// the ones it leaves; and the shape a repair is held to before the host's reading. The session
// itself is `examine`'s, held with the other modes in `test/examiner.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import type { Repair } from "../src/examiner/repair.ts";
import { examine } from "../src/examiner/session.ts";
import type { Control } from "../src/kernel/acceptance.ts";
import { conditionId } from "../src/kernel/condition.ts";
import { append } from "../src/kernel/log.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { call, CONTROLS, condition, finish, MENDED, repaired, seat, sweep } from "./helpers/examiner-seat.ts";

const SECRET = "the solver's own words, which no repair session reads";

setDefaultTimeout(120_000);
afterAll(sweep);

/**
 * A campaign's log after one comparison: three answers to t-1 the planted check refused, one the
 * Referee ruled a check defect, one it ruled so and a person labelled earned, and one nobody read;
 * and t-2 flagged as malformed once under the new harness and once in practice.
 */
function seed(log: string): void {
  append(log, "comparison.started", {
    session: "c-1",
    old: "h-old",
    fresh: "h-new",
    starter: "h-0",
    setting: "s",
    solves: 1,
    level: 0.02,
    trigger: 0.25,
  });
  const ran = (harness: string) => condition("v-t", harness);
  for (const harness of ["h-old", "h-new"]) {
    append(log, "condition.recorded", {
      id: conditionId(ran(harness)),
      condition: requireJsonValue(ran(harness)),
    });
  }
  const solve = (id: string, task: string, harness: string, ending: JsonObject, comparison?: string) => {
    append(log, "solve.started", {
      solve: id,
      task,
      condition: conditionId(ran(harness)),
      ...keyIfDefined("comparison", comparison),
    });
    append(log, "solve.finished", { solve: id, ending });
  };
  for (const id of ["s-1", "s-2", "s-3"]) {
    solve(id, "t-1", "h-old", { outcome: "fail", kind: "rejected" }, "c-1");
    append(log, "verdict", {
      solve: id,
      task: "t-1",
      answer: { answer: "12", unit: "N" },
      kind: "fail",
      blocking: ["check-product"],
    });
  }
  for (const id of ["s-1", "s-2"]) {
    append(log, "referee.finding", {
      solve: id,
      ruling: "check-defect",
      check: "check-product",
      reason: "the check multiplies by seven where R1 says six",
    });
  }
  solve("s-4", "t-2", "h-new", { outcome: "flagged", reason: SECRET }, "c-1");
  solve("s-5", "t-2", "h-old", { outcome: "flagged", reason: SECRET });
  append(log, "comparison.reported", {
    session: "c-1",
    settled: { labelled: 1, defects: 0, disputed: [], restored: [], labels: { "s-2": "earned" }, passes: {} },
  });
  append(log, "checker.read", { faults: ["the accept control of t-1 did not pass: fail check-product"] });
}

/** One session that puts each of `puts` in turn to a reading that finds a fault in every one, so
 *  that none ends it: what reached that reading, and what the session was told of each put. */
async function put(puts: readonly JsonObject[]) {
  const s = seat("repair", [...puts.map((given) => call("repair_check", given)), finish]);
  const reached: Repair[] = [];
  await examine({
    ...s.request,
    reading: async (repair: Repair) => {
      reached.push(repair);
      return ["read by the host"];
    },
  });
  const told = s.of("repair.call").map(({ text }) => (isString(text) ? text.split("\n").slice(1, -1) : []));
  return { reached, told: told.slice(0, puts.length) };
}

describe("a session that repairs a check", () => {
  it("is shown the rules, the read rejections with their tasks' hidden values, the last reading and the flags by side, and no solver's words", async () => {
    const s = seat("repair", [repaired(MENDED)]);
    seed(s.log);
    expect(await examine(s.request)).toEqual({
      ended: "stands",
      puts: 1,
      held: [],
      refused: [],
      repair: MENDED,
    });
    const told = s.sent[0] ?? "";
    for (const shown of [
      "R1: The answer is the base times six.",
      "check-product, citing R1, runs no engine",
      "s-1, refused by check-product: check-defect, by the Referee's ruling naming check-product: the check multiplies by seven where R1 says six",
      // A person's label stands over the Referee's ruling of the same answer.
      "s-2, refused by check-product: earned, by a person's label",
      "seed-2",
      "1 more refused answers were read by nobody",
      "the accept control of t-1 did not pass: fail check-product",
      "t-2: 0 under the reference harness, 1 under the new harness, 1 in practice",
      // It reads the program it repairs, as the Referee does.
      '{"name":"read_check_program"',
    ]) {
      expect(told).toContain(shown);
    }
    expect(told).not.toContain(SECRET);
    expect(told).not.toContain("h-new");
    expect(told).not.toContain('{"name":"try_answer"');
  });

  it("leaves the controls a repair does not put as they were, and replaces a kind it puts whole", async () => {
    const { reached } = await put([
      { files: [], accept_controls: [{ task: "t-2", answer: { answer: "18", unit: "N" } }] },
      { files: MENDED.files, reject_controls: [] },
      { files: MENDED.files },
    ]);
    expect(reached.map(({ controls }) => controls)).toEqual([
      [{ taskId: "t-2", answer: { answer: "18", unit: "N" }, refusedBy: null }, ...CONTROLS.slice(1)],
      CONTROLS.slice(0, 1),
      CONTROLS,
    ]);
    expect(reached.map(({ files }) => files)).toEqual([[], MENDED.files, MENDED.files]);
  });
});

describe("the shape of a repair, read before the host's reading", () => {
  it("refuses the declaration of the checks, the battery, a path outside the program and a repair of nothing", async () => {
    const files = ["brief.json", "controls.json", "../evaluator.ts", "/etc/evaluator.ts", "a//b.ts"].map(
      (path) => ({ path, content: "" }),
    );
    const { reached, told } = await put([{ files }, { files: [] }]);
    expect(reached).toEqual([]);
    expect(told).toEqual([
      [
        "- brief.json declares the public rules and each check, and no repair changes it: a check repaired is the same check, and its rule the same rule",
        "- controls.json holds the controls, which a repair puts as accept_controls and reject_controls",
        "- ../evaluator.ts is no path inside the check program: name a file as check-program/ holds it",
        "- /etc/evaluator.ts is no path inside the check program: name a file as check-program/ holds it",
        "- a//b.ts is no path inside the check program: name a file as check-program/ holds it",
      ],
      ["- the repair changes no file and no control"],
    ]);
  });

  it("refuses a control on a task the campaign does not hold, for a check it does not declare, or outside the format", async () => {
    const stray = (controls: readonly Control[]) => ({
      files: [],
      accept_controls: controls.flatMap(({ taskId, answer, refusedBy }) =>
        refusedBy === null ? [{ task: taskId, answer }] : [],
      ),
      reject_controls: controls.flatMap(({ taskId, answer, refusedBy }) =>
        refusedBy === null ? [] : [{ task: taskId, answer, check: refusedBy }],
      ),
    });
    const { reached, told } = await put([
      stray([
        { taskId: "t-9", answer: { answer: "1", unit: "N" }, refusedBy: null },
        { taskId: "t-1", answer: { answer: "1", unit: "N" }, refusedBy: "check-other" },
      ]),
      stray([{ taskId: "t-1", answer: { answer: 12 }, refusedBy: null }]),
    ]);
    expect(reached).toEqual([]);
    expect(told[0]).toEqual([
      "- an accept control of t-9 names a task the campaign does not hold",
      "- a reject control of t-1 for check-other names a check the program does not declare",
    ]);
    expect(told[1]?.[0]).toStartWith("- an accept control of t-1 does not follow the answer format (");
  });

  it("holds a repair of a file, or of a control alone, to nothing, and hands it to the host's reading", async () => {
    const { reached, told } = await put([{ files: MENDED.files }, { files: [], reject_controls: [] }]);
    expect(reached).toEqual([MENDED, { files: [], controls: CONTROLS.slice(0, 1) }]);
    expect(told).toEqual([["- read by the host"], ["- read by the host"]]);
  });
});

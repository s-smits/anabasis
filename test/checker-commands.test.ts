// Phase C's four commands, run as the operator runs them over a sweep laid out as v1's left one: a
// pack of two tasks and one check, three stored solves, and the pack's controls. The verifier runs
// behind its wall, so the suite is skipped where the host has none. No model is called: the
// Referee's reading stops at its guard. The tests run in order: the second freezes what the first
// read, and the last regrades what the third logged.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskStates } from "../src/kernel/task.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";

const REPO = resolve(import.meta.dir, "..");
const NAME = `test-check-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-checker-")));
const bundle = join(root, "bundle");
const model = join(bundle, "correctness-model");
const campaign = join(REPO, ".ana", "d2", NAME);
/** The campaign the checker is accepted and frozen under, apart from the one its rejections are
 *  logged in. */
const ACCEPTED = `${NAME}-accepted`;
const accepted = join(REPO, ".ana", "d2", ACCEPTED);
/** The campaign of the repaired checker, which the old one's written tasks are carried into. */
const CARRIED = `${NAME}-carried`;
const carried = join(REPO, ".ana", "d2", CARRIED);
/** Two campaigns over a pack with something wrong: a tool no path holds, and controls gone stale. */
const LOST = `${NAME}-lost`;
const STALE = `${NAME}-stale`;
const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const EVALUATOR = `export const checks = {
  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),
};
`;
/** The check repaired: an answer within six in a hundred of the product stands. */
const REPAIRED = `export const checks = {
  "check-product": (req) => {
    const product = req.publicTask.publicInput.base * 6;
    return Math.abs(Number(req.artifact.answer) - product) <= product * 0.06;
  },
};
`;

setDefaultTimeout(180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(campaign, { recursive: true, force: true });
  rmSync(accepted, { recursive: true, force: true });
  rmSync(carried, { recursive: true, force: true });
  for (const name of [LOST, STALE]) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

/** One stored solve as v1 left it: its result, its trace, its answer and what its record tool took. */
function solve(cycle: string, taskId: string, answer: string): void {
  const dir = join(root, "runs", "s", cycle, taskId);
  const caseDir = join(dir, "harness", "cases", taskId);
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(join(dir, "work"));
  const stored = {
    provider: "claude",
    model: "claude-opus-5",
    timedOut: false,
    answerPresent: true,
    answerParses: true,
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify(stored));
  writeFileSync(join(dir, "work", "answer.json"), JSON.stringify({ answer }));
  const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
  writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
  writeFileSync(
    join(caseDir, "built-runtime.json"),
    JSON.stringify({
      modelWorker: { modelSelection: { effort: "medium" } },
      contractCondition: { tools: [{ description: "Role: artifact-writer. Records.", parameters: FORMAT }] },
    }),
  );
}

/** A pack's controls: both tasks' accepted answers, and one reject control of t-1 whose edit is
 *  `answer`. `second` is t-2's accepted answer, which a stale pack no longer has right. */
function controls(answer: string, at = model, second = "18"): void {
  writeFileSync(
    join(at, "controls.json"),
    JSON.stringify({
      accept: [
        { taskId: "t-1", artifact: { answer: "12" } },
        { taskId: "t-2", artifact: { answer: second } },
      ],
      reject: [{ taskId: "t-1", artifact: { answer }, expectedCheckId: "check-product" }],
    }),
  );
}

function layOut(): void {
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  const grades = [
    ["cycle", "taskId", "kind", "blockingChecks"],
    ["1", "t-1", "verified-pass", ""],
    ["2", "t-1", "verified-fail", "check-product"],
    ["2", "t-2", "verified-fail", "check-product"],
  ];
  writeFileSync(
    join(root, "grades", "s", "grades.tsv"),
    `${grades.map((row) => row.join("\t")).join("\n")}\n`,
  );
  solve("c01", "t-1", "12");
  solve("c02", "t-1", "11");
  solve("c02", "t-2", "17");
  mkdirSync(model, { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(model, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      domain: "Fixture",
      ruleDecisions: [{ id: "R1", statement: "The answer is the base times six.", visibility: "public" }],
      truthChecks: [{ id: "check-product", assertion: "Six times.", citedDecisionIds: ["R1"], execution }],
      artifactSchema: [],
      designRuleConstants: [],
    }),
  );
  writeFileSync(join(model, "evaluator.ts"), EVALUATOR);
  const task = (taskId: string, base: number) => ({
    taskId,
    family: "fixture",
    publicInput: { base },
    hidden: null,
  });
  writeFileSync(join(model, "tasks.json"), JSON.stringify([task("t-1", 2), task("t-2", 3)]));
  controls("13");
}

/** A command as the operator runs it: its exit code and everything it printed. `bare` are flags
 *  that take no value. */
function command(file: string, flags: Record<string, string>, ...bare: string[]) {
  const args = Object.entries(flags).flatMap(([flag, value]) => [`--${flag}`, value]);
  const ran = Bun.spawnSync({ cmd: [capturedExecPath, file, ...args, ...bare], cwd: REPO });
  return { code: ran.exitCode, said: `${ran.stdout.toString()}${ran.stderr.toString()}` };
}

/** A command over the stored sweep and its pack. */
const run = (file: string, flags: Record<string, string>, ...bare: string[]) =>
  command(file, { root, sweep: "s", bundle, ...flags }, ...bare);
const accept = (...bare: string[]) => run("tools/c/accept.ts", { name: ACCEPTED }, ...bare);
/** What the accepted campaign's log holds of one kind. */
const held = (kind: string) =>
  read(join(accepted, "log.jsonl")).flatMap((event) => (event.kind === kind ? [event.data] : []));

// Laid out at load, as `verify.test.ts` writes its tree.
layOut();

describe.skipIf(!osIsolationSupport().ok)("Phase C's commands over a stored pack", () => {
  it("records a checker's reading, and names the control that does not get its label", () => {
    const sound = accept();
    // Three controls and three stored verdicts: the check let three answers pass and refused three.
    expect(sound.said).toContain("3 controls twice, 3 stored verdicts");
    expect(sound.said).toContain("check-product\tauthored\t3\t3\t1 of 1");
    expect(sound.said).toContain("no fault");
    expect(sound.code).toBe(0);
    const [reading] = held("checker.read");
    expect(reading).toMatchObject({ controls: 3, stored: 3, faults: [] });

    // A reject control whose edit is still a right answer: the check it names lets it pass, and the
    // operator's word does not freeze a checker read so.
    controls("12");
    const mislabelled = accept("--freeze");
    const fault = "a reject control of t-1 names check-product, which did not refuse it: pass";
    expect(mislabelled.said).toContain(`fault: ${fault}`);
    expect(mislabelled.said).toContain("not frozen");
    expect(mislabelled.code).toBe(1);
    expect(held("checker.read").at(-1)?.faults).toContain(fault);
    expect(held("contract.frozen")).toEqual([]);
    controls("13");
  });

  it("freezes the checker on the operator's word, and opens no campaign under another", () => {
    expect(accept("--freeze").said).toContain("frozen: contract ");
    // Given twice, the word is in the log once, under the hashes the readings were made at.
    expect(accept("--freeze").code).toBe(0);
    const [frozen, ...more] = held("contract.frozen");
    expect(more).toEqual([]);
    expect(Object.keys(frozen ?? {})).toEqual(["contract", "checks"]);
    expect(held("checker.read").at(-1)).toMatchObject(frozen ?? {});

    // A check repaired in the campaign's own copy is another checker.
    const evaluator = join(accepted, "checks", "evaluator.ts");
    writeFileSync(evaluator, EVALUATOR.replace("* 6", "* 7"));
    const repaired = accept();
    expect(repaired.said).toContain(
      "the log froze another check program; a changed checker takes a campaign of its own",
    );
    expect(repaired.code).not.toBe(0);
    writeFileSync(evaluator, EVALUATOR);
    expect(accept().code).toBe(0);
  });

  it("names a missing tool before any control runs, and freezes over a named fault on the operator's word", () => {
    // A pack whose one check names a tool no path holds: the verifier could decide nothing with it.
    const tooled = join(root, "tooled");
    cpSync(bundle, tooled, { recursive: true });
    const brief = join(tooled, "correctness-model", "brief.json");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(
        '"evidence":{"kind":"authored"}',
        '"evidence":{"kind":"external","requiredToolIds":["no-such-tool"]}',
      ),
    );
    const lost = command("tools/c/accept.ts", { root, sweep: "s", bundle: tooled, name: LOST });
    expect(lost.said).toContain(
      "fault: check-product names no-such-tool, which is not on the verifier's tool path",
    );
    expect(lost.said).toContain("no control was run");
    expect(lost.code).toBe(1);

    // A pack whose accept control of t-2 has gone stale, while its check is as sound as before.
    const stale = (...bare: string[]) => run("tools/c/accept.ts", { name: STALE }, ...bare);
    const frozen = () =>
      read(join(REPO, ".ana", "d2", STALE, "log.jsonl")).flatMap((event) =>
        event.kind === "contract.frozen" ? [event.data] : [],
      );
    controls("13", model, "19");
    try {
      const refused = stale("--freeze");
      expect(refused.said).toContain("fault: the accept control of t-2 did not pass: fail check-product");
      expect(refused.said).toContain("not frozen: the reading holds a fault");
      expect(refused.code).toBe(1);
      expect(frozen()).toEqual([]);
      const given = stale("--freeze", "--despite", "the accept control of t-2 is stale");
      expect(given.said).toContain("frozen despite 1 fault: contract ");
      expect(given.code).toBe(0);
      expect(frozen()).toMatchObject([{ despite: "the accept control of t-2 is stale", faults: 1 }]);

      // The stale control is no refused answer: the reading of the rejections leaves it out. And a
      // fail on record under another check than this verifier names is told apart, though both fail.
      const grades = join(root, "grades", "s", "grades.tsv");
      const recorded = readFileSync(grades, "utf8");
      writeFileSync(
        grades,
        recorded.replace("2\tt-1\tverified-fail\tcheck-product", "2\tt-1\tverified-fail\tcheck-old"),
      );
      try {
        const logged = run("tools/c/rejections.ts", { name: STALE });
        expect(logged.said).toContain(
          "apart: s-control-t-2: the pack's accept control does not pass (fail check-product), so it is not logged",
        );
        expect(logged.said).toContain("apart: s-c02-t-1: on record fail check-old, now fail check-product");
        expect(logged.code).toBe(0);
      } finally {
        writeFileSync(grades, recorded);
      }
      const solves = read(join(REPO, ".ana", "d2", STALE, "log.jsonl")).flatMap(({ kind, data }) =>
        kind === "verdict" && isString(data.solve) ? [data.solve] : [],
      );
      expect(solves.sort((a, b) => a.localeCompare(b))).toEqual(["s-c01-t-1", "s-c02-t-1", "s-c02-t-2"]);
    } finally {
      controls("13");
    }
  });

  it("logs the stored rejections, draws the fails to label, and holds the Referee until they are", () => {
    const logged = run("tools/c/rejections.ts", { name: NAME });
    expect(logged.code).toBe(0);
    const verdicts = read(join(campaign, "log.jsonl")).filter((event) => event.kind === "verdict");
    // Both rejections as this verifier grades them, t-1's stored pass, and t-2's accept control,
    // since no stored solve of t-2 passed.
    expect(Object.fromEntries(verdicts.map(({ data }) => [data.solve, data.kind]))).toEqual({
      "s-c01-t-1": "pass",
      "s-c02-t-1": "fail",
      "s-c02-t-2": "fail",
      "s-control-t-2": "pass",
    });
    expect(logged.said).toContain('"unruled": [');

    // Run again, nothing is logged twice.
    expect(run("tools/c/rejections.ts", { name: NAME }).code).toBe(0);
    expect(read(join(campaign, "log.jsonl")).filter((event) => event.kind === "verdict")).toHaveLength(4);

    expect(run("tools/c/rejections.ts", { name: NAME, draw: "1" }).code).toBe(0);
    const labels = parseJsonAs<Record<string, string>>(readFileSync(join(campaign, "labels.json"), "utf8"));
    const [drawn = ""] = Object.keys(labels);
    expect(Object.values(labels)).toEqual([""]);
    expect(existsSync(join(campaign, "label", `${drawn}.json`))).toBe(true);
    // A second draw would replace labels a person may have begun.
    expect(run("tools/c/rejections.ts", { name: NAME, draw: "1" }).said).toContain("holds a draw already");

    const early = run("tools/c/rejections.ts", { name: NAME, referee: "claude/claude-opus-5" });
    expect(early.said).toContain("the Referee reads nothing before the drawn fails are labelled");
    expect(early.code).not.toBe(0);
    expect(read(join(campaign, "log.jsonl")).some((event) => event.kind === "referee.finding")).toBe(false);
  });

  it("shows which of the logged verdicts a repaired checker moves, and writes nothing", () => {
    const repaired = join(root, "repaired");
    cpSync(bundle, repaired, { recursive: true });
    writeFileSync(join(repaired, "correctness-model", "evaluator.ts"), REPAIRED);
    const log = join(campaign, "log.jsonl");
    // A task an Examiner session wrote is in the log and in no pack, and its verdicts are read too.
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 4 }, hidden: null };
    append(log, "task.proposed", { version: "vx", taskId: "x-1-001", session: "x-1", task: written });
    append(log, "verdict", { solve: "x-solve", task: "x-1-001", answer: { answer: "24" }, kind: "pass" });
    const before = readFileSync(log, "utf8");
    const { code, said } = command("tools/c/repaired.ts", { log, bundle: repaired });
    // Of the two refused answers, 17 for 18 is within the repaired check's margin and 11 for 12
    // is not; the three accepted answers stand, the written task's among them.
    expect(said).toContain("5 logged verdicts, 1 moved");
    expect(said).not.toContain("no task");
    expect(said).toContain("s-c02-t-2\tt-2\tfail check-product\tpass");
    expect(said).not.toContain("s-c02-t-1\t");
    expect(said).toContain("tasks with a moved verdict: t-2");
    expect(said).toContain("check program: the log froze none, this one is ");
    // Nobody ruled on the answer the repair lets through, so the repair does not stand on it.
    expect(said).toContain('"unread": [\n      "s-c02-t-2"');
    expect(said).toContain("1 finding against the repair");
    expect(code).toBe(1);
    // Labelled a check defect by a person, it is what a repair is for, and the pack's controls hold.
    const labels = join(root, "repair-labels.json");
    writeFileSync(labels, JSON.stringify({ "s-c02-t-2": "check-defect" }));
    const stands = command("tools/c/repaired.ts", { log, bundle: repaired, labels });
    expect(stands.said).toContain("the repair stands on what was read");
    expect(stands.code).toBe(0);
    // A control that held under neither checker is stale, and says nothing of the repair.
    const repairedModel = join(repaired, "correctness-model");
    controls("13", repairedModel, "25");
    const stale = command("tools/c/repaired.ts", { log, bundle: repaired, labels });
    expect(stale.said).toContain(
      "1 control did not hold under the old checker either, and says nothing of the repair",
    );
    expect(stale.said).toContain("the repair stands on what was read");
    expect(stale.code).toBe(0);
    // One the old checker refused and the repaired one lets through is the repair's own fault.
    controls("12.5", repairedModel);
    const broke = command("tools/c/repaired.ts", { log, bundle: repaired, labels });
    expect(broke.said).toContain(
      "fault: a reject control of t-1 names check-product, which did not refuse it: pass",
    );
    expect(broke.said).toContain("1 finding against the repair");
    expect(broke.code).toBe(1);
    controls("13", repairedModel);
    expect(readFileSync(log, "utf8")).toBe(before);
  });

  it("carries a session's tasks into the repaired checker's campaign on their shape alone, once", () => {
    // An old campaign's log, written by hand: three tasks a session wrote. The first is held out
    // there, the second names no inputs, which the gate here refuses, and the third was disputed.
    const old = join(root, "old.jsonl");
    for (const [id, version, publicInput] of [
      ["x-1-001", "o1", { base: 4 }],
      ["x-1-002", "o2", null],
      ["x-1-003", "o3", { base: 6 }],
    ] as const) {
      const task = { taskId: id, family: "fixture", publicInput, hidden: null };
      append(old, "task.proposed", { version, taskId: id, session: "x-1", task });
      append(old, "task.gate", { version, gate: 1, outcome: "passed" });
    }
    append(old, "task.state", { version: "o3", state: "disputed" });
    // A pack's own task is in the old log by its id alone, and enters a campaign through prepare.ts.
    append(old, "task.proposed", { version: "o4", taskId: "t-1" });
    const carry = () =>
      command("tools/c/carry.ts", {
        from: old,
        root,
        sweep: "s",
        cycle: "c01",
        bundle: join(root, "repaired"),
        name: CARRIED,
      });
    const first = carry();
    expect(first.said).toContain("2 tasks a session wrote: 1 held out here, 1 refused, 0 already there");
    expect(first.said).toContain("x-1-002\trefused: no inputs");
    expect(first.code).toBe(0);
    const events = read(join(carried, "log.jsonl"));
    expect([...taskStates(events).values()].sort()).toEqual(["held", "refused"]);
    // Each is proposed whole under its own id, with the version it had, and put to the one gate.
    expect(events.filter(({ kind }) => kind === "task.proposed").map(({ data }) => data)).toMatchObject([
      { taskId: "x-1-001", carried: "o1", task: { taskId: "x-1-001", publicInput: { base: 4 } } },
      { taskId: "x-1-002", carried: "o2" },
    ]);
    expect(events.flatMap(({ kind, data }) => (kind === "task.gate" ? [data.gate] : []))).toEqual([1, 1]);
    // No solve and no verdict comes with a task: a new campaign's solves are its own.
    expect(events.filter(({ kind }) => kind === "verdict" || kind === "solve.started")).toEqual([]);
    // Run again, nothing is taken twice.
    expect(carry().said).toContain("0 held out here, 0 refused, 2 already there");
    expect(read(join(carried, "log.jsonl"))).toHaveLength(events.length);
  });
});

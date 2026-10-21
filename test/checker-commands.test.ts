// Phase C's four commands, run as the operator runs them over a sweep laid out as v1's left one: a
// pack of two tasks and one check, three stored solves, and the pack's controls. The verifier runs
// behind its wall, so the suite is skipped where the host has none. No model is called: the
// Referee's reading stops at its guard. The tests run in order: the second freezes what the first
// read, and the last regrades what the third logged.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskSets, taskStates } from "../src/kernel/task.ts";
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
/** A campaign's log, by its name in the campaign's folder. */
const LOG = "log.jsonl";
/** The fixture's one check is its author's own computation, which stands on the operator's word. */
const ADMIT = { admit: "check-product" };
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
/** The campaign whose tasks are set up for a first round. */
const PREPARED = `${NAME}-prepared`;
const prepared = join(REPO, ".ana", "d2", PREPARED);
/** The campaign a rehearsal is seeded from, and the seed it walks. */
const SOURCE = `${NAME}-source`;
const SEED = `sim-${NAME}`;
/** Two campaigns over a pack with something wrong: a tool no path holds, and controls gone stale. */
const LOST = `${NAME}-lost`;
const STALE = `${NAME}-stale`;
/** A campaign whose answer format holds a pattern the smallest value its schema yields misses. */
const UNFORMED = `${NAME}-unformed`;
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
  rmSync(prepared, { recursive: true, force: true });
  for (const name of [SOURCE, SEED, LOST, STALE, UNFORMED]) {
    rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
  }
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
const accept = (...bare: string[]) => run("tools/c/accept.ts", { name: ACCEPTED, ...ADMIT }, ...bare);
/** What the accepted campaign's log holds of one kind. */
const held = (kind: string) =>
  read(join(accepted, LOG)).flatMap((event) => (event.kind === kind ? [event.data] : []));

// Laid out at load, as `verify.test.ts` writes its tree.
layOut();

describe.skipIf(!osIsolationSupport().ok)("Phase C's commands over a stored pack", () => {
  it("records a checker's reading, and names the control that does not get its label", () => {
    const sound = accept();
    // Fresh controls and historical verdicts have separate counts.
    expect(sound.said).toContain("3 controls twice, 3 stored verdicts");
    expect(sound.said).toContain("Fresh controls:");
    expect(sound.said).toContain("check-product\tauthor\t2\t1\t1 of 1");
    expect(sound.said).toContain("Historical verdicts (not rerun):");
    expect(sound.said).toContain("check-product\tauthor\t1\t2\t0 of 0");
    // The smallest answer the format allows is put to both tasks, and the check rejects it on each.
    expect(sound.said).toContain('the do-nothing answer {"answer":""}: rejected on 2 of 2 tasks');
    expect(sound.said).toContain("no fault");
    expect(sound.code).toBe(0);
    const [reading] = held("checker.read");
    expect(reading).toMatchObject({
      controls: 3,
      stored: 3,
      rows: [expect.objectContaining({ passed: 2, refused: 1 })],
      historicalRows: [expect.objectContaining({ passed: 1, refused: 2 })],
      doNothing: { answer: { answer: "" }, tasks: 2, rejected: 2 },
      admitted: ["check-product"],
      faults: [],
    });

    // Without the operator's word the same check is a fault, and a check nobody wrote is no word.
    const unadmitted = run("tools/c/accept.ts", { name: ACCEPTED, cycle: "c01" });
    expect(unadmitted.said).toContain(
      "fault: check-product is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit check-product)",
    );
    expect(unadmitted.code).toBe(1);
    // A campaign without `--hitl` gives that word for every check its author decides (16 October).
    const unattended = run("tools/c/accept.ts", { name: ACCEPTED, cycle: "c01" }, "--admit-authored");
    expect(unattended.said).toContain("no fault");
    expect(held("checker.read").at(-1)).toMatchObject({ admitted: ["check-product"], faults: [] });
    expect(run("tools/c/accept.ts", { name: ACCEPTED, admit: "check-nobody" }).said).toContain(
      "--admit names check-nobody, and the check program holds no such check",
    );

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
    expect(Object.keys(frozen ?? {})).toEqual(["contract", "checks", "admitted"]);
    expect(frozen?.admitted).toEqual(["check-product"]);
    expect(held("checker.read").at(-1)).toMatchObject({ contract: frozen?.contract, checks: frozen?.checks });

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
    const stale = (...bare: string[]) => run("tools/c/accept.ts", { name: STALE, ...ADMIT }, ...bare);
    const frozen = () =>
      read(join(REPO, ".ana", "d2", STALE, LOG)).flatMap((event) =>
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
      const solves = read(join(REPO, ".ana", "d2", STALE, LOG)).flatMap(({ kind, data }) =>
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
    const verdicts = read(join(campaign, LOG)).filter((event) => event.kind === "verdict");
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
    expect(read(join(campaign, LOG)).filter((event) => event.kind === "verdict")).toHaveLength(4);

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
    expect(read(join(campaign, LOG)).some((event) => event.kind === "referee.finding")).toBe(false);
  });

  it("shows which of the logged verdicts a repaired checker moves, and writes nothing", () => {
    const repaired = join(root, "repaired");
    cpSync(bundle, repaired, { recursive: true });
    writeFileSync(join(repaired, "correctness-model", "evaluator.ts"), REPAIRED);
    const log = join(campaign, LOG);
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

  it("carries an old campaign's tasks into the repaired checker's campaign on their shape alone, every release kept, once", () => {
    // An old campaign's log, written by hand: five tasks a session wrote. The first is held out
    // there, the second names no inputs, which the gate here refuses, the third was disputed, the
    // fourth was released to a Builder as practice, and the fifth was released and then disputed.
    const old = join(root, "old.jsonl");
    for (const [id, version, publicInput] of [
      ["x-1-001", "o1", { base: 4 }],
      ["x-1-002", "o2", null],
      ["x-1-003", "o3", { base: 6 }],
      ["x-1-004", "o5", { base: 8 }],
      ["x-1-005", "o7", { base: 9 }],
    ] as const) {
      const task = { taskId: id, family: "fixture", publicInput, hidden: null };
      append(old, "task.proposed", { version, taskId: id, session: "x-1", task });
      append(old, "task.gate", { version, gate: 1, outcome: "passed" });
    }
    append(old, "task.state", { version: "o3", state: "disputed" });
    append(old, "task.state", { version: "o5", state: "released" });
    append(old, "task.state", { version: "o7", state: "released" });
    append(old, "task.state", { version: "o7", state: "disputed" });
    // A pack's own tasks are in the old log by their ids alone: t-1 held out, t-2 released.
    append(old, "task.proposed", { version: "o4", taskId: "t-1" });
    append(old, "task.proposed", { version: "o6", taskId: "t-2" });
    append(old, "task.gate", { version: "o6", gate: 1, outcome: "passed" });
    append(old, "task.state", { version: "o6", state: "released" });
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
    expect(first.said).toContain(
      "7 tasks of the old campaign: 3 held out here, 3 released for practice as they were, 1 refused, 0 already there",
    );
    expect(first.said).toContain("x-1-002\trefused: no inputs");
    expect(first.code).toBe(0);
    const events = read(join(carried, LOG));
    // A task a Builder has practised on stays practice here, the pack's and the disputed one too:
    // a harness it built may be compared. A disputed task never practised is read again.
    const states = taskStates(events);
    const proposed = events.filter(({ kind }) => kind === "task.proposed").map(({ data }) => data);
    expect(
      proposed.map(({ taskId, version }) => [taskId, states.get(isString(version) ? version : "")]),
    ).toEqual([
      ["x-1-001", "held"],
      ["x-1-002", "refused"],
      ["x-1-003", "held"],
      ["x-1-004", "released"],
      ["x-1-005", "released"],
      ["t-1", "held"],
      ["t-2", "released"],
    ]);
    // Each is proposed under its own id, with the version it had, a session's whole and a pack's by
    // its id alone, and put to the one gate.
    expect(proposed).toMatchObject([
      { taskId: "x-1-001", carried: "o1", task: { taskId: "x-1-001", publicInput: { base: 4 } } },
      { taskId: "x-1-002", carried: "o2" },
      { taskId: "x-1-003", carried: "o3" },
      { taskId: "x-1-004", carried: "o5" },
      { taskId: "x-1-005", carried: "o7" },
      { taskId: "t-1", carried: "o4" },
      { taskId: "t-2", carried: "o6" },
    ]);
    expect(proposed.filter((data) => data.task === undefined).map(({ taskId }) => taskId)).toEqual([
      "t-1",
      "t-2",
    ]);
    expect(events.flatMap(({ kind, data }) => (kind === "task.gate" ? [data.gate] : []))).toEqual(
      Array.from({ length: 7 }, () => 1),
    );
    // No solve and no verdict comes with a task: a new campaign's solves are its own.
    expect(events.filter(({ kind }) => kind === "verdict" || kind === "solve.started")).toEqual([]);
    // Run again, nothing is taken twice.
    expect(carry().said).toContain("0 refused, 7 already there");
    expect(read(join(carried, LOG))).toHaveLength(events.length);
  });
  it("records a stored answer that still passes today's verifier once, and releases practice by the draw", () => {
    const prepare = (practice: string) =>
      run("tools/d2/prepare.ts", { cycle: "c01", name: PREPARED, practice, target: "2" });
    // The stored sweep accepted an answer to t-1, which still passes, and none to t-2.
    const both = prepare("0");
    expect(both.said).toContain("t-1: a stored accepted answer passes today's verifier");
    expect(both.code).toBe(0);
    const sets = taskSets(read(join(prepared, LOG)));
    expect([sets.held.length, sets.released.length]).toEqual([2, 0]);
    expect(prepare("1").code).toBe(0);
    expect(prepare("1").code).toBe(0);
    const released = taskSets(read(join(prepared, LOG)));
    expect([released.held.length, released.released.length]).toEqual([1, 1]);
    // The proof is recorded once however often preparation runs (`task.feasible`).
    const events = read(join(prepared, LOG));
    expect([...new Set(events.map(({ kind }) => kind))].sort()).toEqual([
      "task.feasible",
      "task.gate",
      "task.proposed",
      "task.state",
    ]);
    expect(events.filter(({ kind }) => kind === "task.feasible")).toHaveLength(1);
  });

  it("names a do-nothing answer the format refuses as a fault, and freezes nothing over it", () => {
    // The same sweep, its stored solves started under a format whose one string holds digits only.
    const digits = join(root, "digits");
    for (const part of ["runs", "grades"]) cpSync(join(root, part), join(digits, part), { recursive: true });
    const started = new Bun.Glob("runs/**/built-runtime.json").scanSync({ cwd: digits, absolute: true });
    for (const file of started) {
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace('"type":"string"', '"type":"string","pattern":"^[0-9]+$"'),
      );
    }
    const flags = { root: digits, sweep: "s", bundle, name: UNFORMED, ...ADMIT };
    const unformed = command("tools/c/accept.ts", flags, "--freeze");
    expect(unformed.said).toContain(
      'fault: the do-nothing answer {"answer":""} does not follow the answer format (',
    );
    expect(unformed.said).toContain("not frozen: the reading holds a fault");
    expect(unformed.code).toBe(1);
    const log = read(join(REPO, ".ana", "d2", UNFORMED, LOG));
    expect(log.flatMap((event) => (event.kind === "checker.read" ? [event.data.faults] : []))).toEqual([
      [expect.stringMatching(/^the do-nothing answer /)],
    ]);
  });

  // The plan's checkpoint as its commands walk it (`7f0add79:docs/plan.md`, Phase 5): two Builder sessions,
  // each with no comparison after it, and then one comparison of what the second left. A script
  // sits in every seat. Until 2026-10-09 a session ran only inside a round.
  it("rehearses two sessions and then one checkpoint over a seed", () => {
    const source = join(REPO, ".ana", "d2", SOURCE);
    const seeded = join(REPO, ".ana", "d2", SEED);
    // One of the pack's two tasks is released for practice, by the contract's draw, and one held out.
    const taken = run("tools/d2/prepare.ts", { cycle: "c01", name: SOURCE, practice: "1" });
    expect(taken.said).toContain("1 held out, 1 released for practice");
    const cli = (...args: string[]) => {
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/runs/cli.ts", ...args], cwd: REPO });
      return { code: ran.exitCode, said: `${ran.stdout.toString()}${ran.stderr.toString()}` };
    };
    expect(cli("seed", "--from", source, "--name", SEED).code).toBe(0);
    const flags = ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", SEED];
    const rehearse = (...more: string[]) => cli("rehearse", ...flags, ...more);
    const of = (kind: string) =>
      read(join(seeded, LOG)).flatMap((event) => (event.kind === kind ? [event.data] : []));

    // Fix row F44: a round refused on its own terms leaves the log as it was. Until 2026-10-09 it
    // had recorded the campaign's setting first, a mistyped flag with it, and the corrected
    // command was then refused as another setting.
    const lines = () => read(join(seeded, LOG)).length;
    const before = lines();
    expect(rehearse("--session", "b-0", "--target", "0").said).toContain(
      "--target 0: the tasks to score are a whole number of at least one",
    );
    expect(lines()).toBe(before);
    expect(of("campaign.setting")).toEqual([]);

    const first = rehearse("--no-comparison", "--session", "b-1");
    expect(first.said).toContain("the rehearsal went as scripted");
    expect(first.said).toContain("tools/d2/checkpoint.ts --new latest compares it");
    const second = rehearse("--no-comparison", "--session", "b-2");
    expect(second.said).toContain("the rehearsal went as scripted");
    // Two sessions are on record, the second from what the first left, and nothing is compared.
    const [one, two] = of("build.finished");
    expect(of("build.started")).toMatchObject([{ session: "b-1" }, { session: "b-2", parent: one?.harness }]);
    expect([one?.changed, two?.changed]).toEqual([true, true]);
    expect(two?.harness).not.toBe(one?.harness);
    expect(of("comparison.started")).toEqual([]);
    expect(of("solve.started")).toEqual([]);
    // The first command of the campaign recorded its setting, and the second ran under the record.
    expect(of("campaign.setting")).toHaveLength(1);

    // Then the one comparison: the harness the last session left against the reference harness,
    // which is the starter. One held-out task reads no step; what is proven is the join.
    const compared = rehearse("--id", "g-1", "--new", "latest");
    expect(compared.said).toContain("the rehearsal went as scripted");
    expect(of("comparison.reported")).toMatchObject([
      { session: "g-1", fresh: two?.harness, reading: "no-step", scored: { wins: 1, losses: 0, ties: 0 } },
    ]);
    // A session that ended says what it left when it is asked for again, and runs nothing.
    const again = rehearse("--no-comparison", "--session", "b-2");
    expect(again.said).toContain(`session b-2 left harness ${isString(two?.harness) ? two.harness : ""}:`);
    expect(of("build.started")).toHaveLength(2);

    // The campaign's view prints each step's handover. Fix row F7: of the moves, it names the
    // table's alone. It takes the campaign command's flags and no other: a launch's, which it
    // parsed until 11 October, went with the launcher (`7f0add79:docs/simplify.md`, D2).
    const viewed = cli("view", SEED, "--level", "0.02").said;
    expect(
      viewed.split("\n").filter((line) => line.includes("Builder session, finished: from")),
    ).toHaveLength(2);
    // Four solves a side since 12 October, and the level 0.02, where nothing names another (`SIZE`).
    expect(viewed).toContain(
      "on 1 task, 4 solves a side at 0.02: 1 won, 0 lost, 0 tied, which reads no-step",
    );
    expect(viewed).not.toContain("  a round");
    expect(cli("view", SEED, "--cap", "100").said).toContain("Unknown option '--cap'");
    // Fix row F26: the view's last line is the one move the decision table names, and the
    // campaign's own command, rehearsed and asked what it would do next, names the same.
    const tabled = viewed.slice(viewed.indexOf("the table's move\n") + "the table's move\n".length).trim();
    expect(tabled).toContain(": ");
    // At 0.02 the default patience holds the bound an opening may risk (`openingLines`).
    const terms = ["--project", "fixture", "--level", "0.02"];
    expect(rehearse("--campaign", ...terms, "--dry-run").said).toContain(`next · ${tabled}`);
  });
});

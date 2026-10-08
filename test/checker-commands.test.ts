// Phase C's commands, run as the operator runs them over a sweep laid out as v1's left one: a pack
// of two tasks and one check, three stored solves, and the pack's controls. The verifier runs
// behind its wall, so the suite is skipped where the host has none. No model is called: the
// Referee's reading stops at its guard. The tests run in order: the second freezes what the first
// read, and the last two read a repaired pack against a frozen campaign and adopt it.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { epochsOf, unfinished } from "../src/kernel/epoch.ts";
import { append, read } from "../src/kernel/log.ts";
import { taskStates, taskVersion } from "../src/kernel/task.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-check-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-checker-")));
const bundle = join(root, "bundle");
const model = join(bundle, "correctness-model");
const campaign = join(REPO, ".ana", "d2", NAME);
/** The campaign the checker is accepted and frozen under, apart from the one its rejections are
 *  logged in. */
const ACCEPTED = `${NAME}-accepted`;
const accepted = join(REPO, ".ana", "d2", ACCEPTED);
/** The campaign that adopts a repaired checker in its own log. */
const ADOPTED = `${NAME}-adopted`;
const adopted = join(REPO, ".ana", "d2", ADOPTED);
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
  rmSync(adopted, { recursive: true, force: true });
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

/** The same controls with three reject controls of t-1, as a task's gate 4 takes them. */
function rejects(answers: readonly string[], at = model): void {
  writeFileSync(
    join(at, "controls.json"),
    JSON.stringify({
      accept: [
        { taskId: "t-1", artifact: { answer: "12" } },
        { taskId: "t-2", artifact: { answer: "18" } },
      ],
      reject: answers.map((answer) => ({
        taskId: "t-1",
        artifact: { answer },
        expectedCheckId: "check-product",
      })),
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
      "the log froze another check program; a changed checker is adopted into the campaign by the operator (tools/c/accept.ts --freeze)",
    );
    expect(repaired.code).not.toBe(0);
    writeFileSync(evaluator, EVALUATOR);
    expect(accept().code).toBe(0);

    // Nor does the frozen log take tasks gated under another pack's checks.
    const other = join(root, "other");
    cpSync(bundle, other, { recursive: true });
    writeFileSync(join(other, "correctness-model", "evaluator.ts"), REPAIRED);
    const log = join(accepted, "log.jsonl");
    const before = readFileSync(log, "utf8");
    const admitted = command("tools/m1/admit-sweep.ts", {
      root,
      sweep: "s",
      bundle: other,
      stronger: "c01",
      log,
    });
    expect(admitted.said).toContain("the log froze another check program");
    expect(admitted.code).not.toBe(0);
    expect(readFileSync(log, "utf8")).toBe(before);
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

  it("reads a repaired pack against a frozen campaign: what it moves, what counts against it, and writes nothing", () => {
    // The campaign: the checker frozen, the stored verdicts logged, the pack's tasks through their
    // gates, and two tasks as a session leaves them, written here by hand. The pack is given the
    // three reject controls a task's gate 4 takes.
    rejects(["13", "0", "1"]);
    const over = (pack: string, ...bare: string[]) =>
      command("tools/c/accept.ts", { root, sweep: "s", bundle: pack, name: ADOPTED }, ...bare);
    expect(over(bundle, "--freeze").said).toContain("frozen: contract ");
    expect(run("tools/c/rejections.ts", { name: ADOPTED }).code).toBe(0);
    const log = join(adopted, "log.jsonl");
    const admitted = run("tools/m1/admit-sweep.ts", { stronger: "c01", log }, "--feasible");
    expect(admitted.said).toContain("t-1\theld\tfeasible, left held");
    const checks = join(adopted, "checks");
    const set = ["0", "1", "100"].map((answer) => ({ answer: { answer }, expectedCheckId: "check-product" }));
    for (const [id, answer] of [
      ["x-1-001", "24"],
      ["x-1-002", "23"],
    ] as const) {
      const task = { taskId: id, family: "fixture", publicInput: { base: 4 }, hidden: null };
      const version = taskVersion({ ...task, ruleIds: ["R1"], checks });
      append(log, "task.proposed", { version, taskId: id, session: "x-1", task });
      append(log, "task.gate", { version, gate: 1, outcome: "passed" });
      // The second task's stronger solve was a hair off, and the frozen check refused it.
      const passed = answer === "24";
      const verdict = passed ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] };
      append(log, "verdict", { solve: `s-${id}`, task: id, answer: { answer }, ...verdict });
      if (!passed) {
        append(log, "task.gate", {
          version,
          gate: 2,
          outcome: "too-hard",
          solve: `s-${id}`,
          kind: "rejected",
        });
        append(log, "task.state", { version, state: "too-hard" });
        continue;
      }
      append(log, "task.gate", { version, gate: 2, outcome: "passed", solve: `s-${id}` });
      append(log, "task.gate", { version, gate: 3, outcome: "passed" });
      append(log, "task.gate", { version, gate: 4, outcome: "passed", controls: "d", set });
    }
    const before = readFileSync(log, "utf8");

    const repaired = join(root, "repaired");
    cpSync(bundle, repaired, { recursive: true });
    const repairedModel = join(repaired, "correctness-model");
    writeFileSync(join(repairedModel, "evaluator.ts"), REPAIRED);
    const reading = over(repaired);
    // Of the refused answers, 17 for 18 and 23 for 24 are within the repaired check's margin and
    // 11 for 12 is not; the accepted answers stand.
    expect(reading.said).toContain("which would be epoch 2");
    expect(reading.said).toContain("6 logged verdicts, 2 moved");
    expect(reading.said).toContain("s-c02-t-2\tt-2\tfail check-product\tpass");
    expect(reading.said).toContain("s-x-1-002\tx-1-002\tfail check-product\tpass");
    expect(reading.said).not.toContain("s-c02-t-1\t");
    expect(reading.said).toContain("a solver is asked the same thing");
    // The task that waited for a witness has one now, in the answer the frozen check refused.
    expect(reading.said).toContain(
      "3 live tasks: 2 feasible under the pack's checks, 0 to wait for a witness, 1 to wait for controls",
    );
    expect(reading.said).toContain("x-1-002\twaiting\tits controls are not on record");
    // Nobody ruled on the two answers the repair lets through, so it does not stand on them.
    expect(reading.said).toContain(
      "against: 2 answers refused before and read by nobody would pass: s-c02-t-2, s-x-1-002",
    );
    expect(reading.said).toContain("1 finding against the pack, 0 refusals");
    expect(reading.code).toBe(1);
    expect(over(repaired, "--freeze").said).toContain(
      "not adopted: 1 finding against the pack. It is yours to adopt all the same: say why with --despite",
    );
    // Labelled check defects by a person, they are what a repair is for.
    const labels = join(root, "repair-labels.json");
    writeFileSync(labels, JSON.stringify({ "s-c02-t-2": "check-defect", "s-x-1-002": "check-defect" }));
    const stands = over(repaired, "--labels", labels);
    expect(stands.said).toContain("nothing counts against the pack: --freeze adopts it");
    expect(stands.code).toBe(0);
    // A control that held under neither checker is stale, and says nothing of the repair.
    controls("13", repairedModel, "25");
    const stale = over(repaired, "--labels", labels);
    expect(stale.said).toContain(
      "standing fault, shared with the checker the log froze: the accept control of t-2 did not pass: fail check-product",
    );
    expect(stale.code).toBe(0);
    // One the frozen checker refused and the repaired one lets through is the repair's own fault.
    rejects(["12.5", "0", "1"], repairedModel);
    const broke = over(repaired, "--labels", labels);
    expect(broke.said).toContain(
      "fault: a reject control of t-1 names check-product, which did not refuse it: pass",
    );
    expect(broke.code).toBe(1);
    rejects(["13", "0", "1"], repairedModel);
    // Nothing was written, and the pack's check program is staged nowhere in the campaign.
    expect(readFileSync(log, "utf8")).toBe(before);
    const epochs = join(adopted, "epochs");
    expect(existsSync(epochs) ? readdirSync(epochs) : []).toEqual([]);
  });

  it("adopts the repaired pack into the campaign's own log, finishes an adoption cut short, and goes on under it", () => {
    const repaired = join(root, "repaired");
    const log = join(adopted, "log.jsonl");
    const labels = join(root, "repair-labels.json");
    const before = read(log);
    const flags = { root, sweep: "s", bundle: repaired, name: ADOPTED };
    const adopt = () => command("tools/c/accept.ts", { ...flags, labels }, "--freeze");
    const first = adopt();
    expect(first.said).toContain("adopted: epoch 2, contract ");
    expect(first.said).toContain("name this pack as --bundle from here on");
    expect(first.code).toBe(0);
    const whole = read(log);
    // One log: what was there stays, and the checker is the last one frozen.
    expect(whole.slice(0, before.length)).toEqual(before);
    const [, epoch] = epochsOf(whole);
    expect(epoch).toMatchObject({ asked: "same", despite: null });
    expect(epoch?.adopted).toMatchObject({
      epoch: 2,
      tasks: { feasible: 2, waiting: 1, reach: 0 },
      waiting: ["x-1-002"],
      recovered: ["x-1-002"],
      moved: 2,
      withdrawn: { "check-defect": 2, earned: 0, unread: 0 },
      against: 0,
    });
    // Both check programs stand on disk: the old versions and their verdicts name the first.
    expect(existsSync(join(adopted, "checks", "evaluator.ts"))).toBe(true);
    expect(
      readFileSync(join(adopted, "epochs", epoch?.checker.checks.slice(0, 16) ?? "", "evaluator.ts"), "utf8"),
    ).toBe(REPAIRED);
    // Each live task has a new version and the old one is stale; the pack's second task never had
    // a witness in the sweep's first cycle, was no part of the exam, and stays as it was.
    const states = [...taskStates(whole).values()].sort();
    expect(states).toEqual(["held", "held", "held", "held", "stale", "stale", "stale"]);
    // The feasible ones passed all four gates here, their controls kept whole for the next change.
    const sets = whole
      .slice(before.length)
      .flatMap(({ kind, data }) => (kind === "task.gate" && data.gate === 4 ? [data.set] : []));
    expect(sets).toHaveLength(2);
    // The stored verdicts are no solves of the campaign's: none ran under a recorded condition,
    // so none stands for a version, and the two that moved are logged as moved.
    const regraded = whole.flatMap(({ kind, data }) =>
      kind === "verdict.regraded" ? [[data.solve, data.version ?? null, data.kind]] : [],
    );
    expect(regraded).toEqual([
      ["s-c02-t-2", null, "pass"],
      ["s-x-1-002", null, "pass"],
    ]);

    // The pack the campaign stood on before is no longer its pack, for any command.
    const old = command("tools/d2/prepare.ts", { root, sweep: "s", cycle: "c01", bundle, name: ADOPTED });
    expect(old.said).toContain("holds another check program than the one the log froze");
    expect(old.code).not.toBe(0);
    const again = command("tools/c/accept.ts", { root, sweep: "s", bundle, name: ADOPTED }, "--freeze");
    expect(again.said).toContain("refused: the log froze this check program before");
    expect(again.said).toContain("not adopted: what is refused is not the operator's to overrule here");
    expect(again.code).toBe(1);
    expect(read(log)).toHaveLength(whole.length);

    // An adoption a crash cut short: the freeze and three events after it are in the log.
    const lines = readFileSync(log, "utf8").split("\n");
    writeFileSync(log, `${lines.slice(0, before.length + 5).join("\n")}\n`);
    expect(unfinished(read(log))).not.toBeNull();
    const prepare = () =>
      command("tools/d2/prepare.ts", { ...flags, cycle: "c01", anchor: "0", practice: "0" });
    expect(prepare().said).toContain("was cut short; run it again (tools/c/accept.ts --freeze)");
    // Read with other labels it would count otherwise, and is not finished on that reading.
    const unlabelled = command("tools/c/accept.ts", flags, "--freeze");
    expect(unlabelled.said).toContain("froze the pack over 0 findings and this reading counts 1");
    expect(unlabelled.code).not.toBe(0);
    const finished = adopt();
    expect(finished.said).toContain("adopted: the adoption that was cut short is finished");
    expect(finished.code).toBe(0);
    const strip = (events: ReturnType<typeof read>) => events.map(({ kind, data }) => ({ kind, data }));
    expect(strip(read(log))).toEqual(strip(whole));

    // The campaign goes on under the adopted pack with no flag about the epoch.
    cpSync(FIXTURE, join(root, "hb-bundles", "s-c01"), { recursive: true });
    const prepared = prepare();
    expect(prepared.said).toContain("2 feasible: 0 anchor, 0 released for practice");
    expect(prepared.code).toBe(0);
  });
});

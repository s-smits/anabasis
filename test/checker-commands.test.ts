// Phase C's three commands, run as the operator runs them over a sweep laid out as v1's left one: a
// pack of two tasks and one check, three stored solves, and the pack's controls. The verifier runs
// behind its wall, so the suite is skipped where the host has none. No model is called: the
// Referee's reading stops at its guard. The tests run in order: the second freezes what the first
// read, and the last regrades what the third logged.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { read } from "../src/kernel/log.ts";
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

/** The pack's controls: both tasks' accepted answers, and one reject control of t-1 whose edit is
 *  `answer`. */
function controls(answer: string): void {
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({
      accept: [
        { taskId: "t-1", artifact: { answer: "12" } },
        { taskId: "t-2", artifact: { answer: "18" } },
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
    const before = readFileSync(log, "utf8");
    const { code, said } = command("tools/c/repaired.ts", { log, bundle: repaired });
    // Of the two refused answers, 17 for 18 is within the repaired check's margin and 11 for 12
    // is not; both accepted answers stand.
    expect(said).toContain("4 logged verdicts, 1 moved");
    expect(said).toContain("s-c02-t-2\tt-2\tfail check-product\tpass");
    expect(said).not.toContain("s-c02-t-1\t");
    expect(said).toContain("tasks with a moved verdict: t-2");
    expect(said).toContain("check program: the log froze none, this one is ");
    expect(code).toBe(0);
    expect(readFileSync(log, "utf8")).toBe(before);
  });
});

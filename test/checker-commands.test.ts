// Phase C's commands, run as the operator runs them over a sweep laid out as v1's left one: a
// pack of two tasks and one check, three stored solves, and the pack's controls. The verifier runs
// behind its wall, so those suites are skipped where the host has none. Carrying runs no solve.
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskSets, taskStates } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";

const REPO = resolve(import.meta.dir, "..");
/** A campaign's log, by its name in the campaign's folder. */
const LOG = "log.jsonl";
/** The fixture's one check is its author's own computation, which stands on the operator's word. */
const ADMIT = { admit: "check-product" };
const NAME = `test-check-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-checker-")));
const bundle = join(root, "bundle");
const model = join(bundle, "correctness-model");
/** The campaign whose checker reading is recorded. */
const ACCEPTED = `${NAME}-accepted`;
const accepted = join(REPO, ".ana", "d2", ACCEPTED);
/** The campaign receiving tasks under a repaired checker. */
const CARRIED = `${NAME}-carried`;
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

const suite = describe.skipIf(!osIsolationSupport().ok);

setDefaultTimeout(180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(accepted, { recursive: true, force: true });
  rmSync(prepared, { recursive: true, force: true });
  for (const name of [SOURCE, SEED, LOST, STALE, UNFORMED, CARRIED]) {
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

beforeAll(() => {
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
});

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

suite("acceptance and freezing over a stored pack", () => {
  it("records a checker's reading, and names the control that does not get its label", () => {
    const sound = accept();
    // Fresh controls and historical verdicts have separate counts.
    expect(sound.said).toMatch(/3 controls.*3 stored verdicts/u);
    expect(sound.said).toContain("Fresh controls:");
    expect(sound.said).toContain("check-product\tauthor\t2\t1\t1 of 1");
    expect(sound.said).toContain("Historical verdicts (not rerun):");
    expect(sound.said).toContain("check-product\tauthor\t1\t2\t0 of 0");
    // The smallest answer the format allows is put to both tasks, and the check rejects it on each.
    expect(sound.said).toMatch(/\{"answer":""\}.*rejected.*2 of 2/u);
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
    expect(unadmitted.said).toMatch(/fault: check-product.*--admit check-product/u);
    expect(unadmitted.code).toBe(1);
    // A campaign without `--hitl` gives that word for every check its author decides (16 October).
    const unattended = run("tools/c/accept.ts", { name: ACCEPTED, cycle: "c01" }, "--admit-authored");
    expect(unattended.code).toBe(0);
    expect(held("checker.read").at(-1)).toMatchObject({ admitted: ["check-product"], faults: [] });
    expect(run("tools/c/accept.ts", { name: ACCEPTED, admit: "check-nobody" }).said).toMatch(
      /--admit.*check-nobody.*no such check/u,
    );

    // A reject control whose edit is still a right answer: the check it names lets it pass, and the
    // operator's word does not freeze a checker read so.
    controls("12");
    const mislabelled = accept("--freeze");
    const fault = /reject control.*t-1.*check-product.*pass/u;
    expect(mislabelled.said).toMatch(fault);
    expect(mislabelled.said).toContain("not frozen");
    expect(mislabelled.code).toBe(1);
    expect(held("checker.read").at(-1)?.faults).toContainEqual(expect.stringMatching(fault));
    expect(held("contract.frozen")).toEqual([]);
    controls("13");
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
    expect(lost.said).toMatch(/fault: check-product.*no-such-tool.*tool path/u);
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
      expect(refused.said).toMatch(/fault:.*accept control.*t-2.*fail check-product/u);
      expect(refused.code).toBe(1);
      expect(frozen()).toEqual([]);
      const given = stale("--freeze", "--despite", "the accept control of t-2 is stale");
      expect(given.said).toMatch(/frozen.*1 fault.*contract/u);
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
        expect(logged.said).toMatch(/apart: s-control-t-2:.*fail check-product.*not logged/u);
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
});

describe("carrying tasks into a repaired checker's campaign", () => {
  it("gates carried tasks, preserves every practice release after disputes, and takes nothing twice", () => {
    const repaired = join(root, "carry-repaired");
    cpSync(bundle, repaired, { recursive: true });
    writeFileSync(
      join(repaired, "correctness-model", "evaluator.ts"),
      EVALUATOR.replace(
        "req.artifact.answer === String(req.publicTask.publicInput.base * 6)",
        "Math.abs(Number(req.artifact.answer) / (req.publicTask.publicInput.base * 6) - 1) < 0.06",
      ),
    );
    const old = join(root, "carry-old.jsonl");
    for (const [version, publicInput, states] of [
      ["held", { base: 4 }, []],
      ["invalid", null, []],
      ["disputed", { base: 6 }, ["disputed"]],
      ["practice", { base: 8 }, ["released"]],
      ["practice-disputed", { base: 9 }, ["released", "disputed"]],
    ] as const) {
      const task = { taskId: version, family: "fixture", publicInput, hidden: null };
      append(old, "task.proposed", { version, taskId: version, task });
      append(old, "task.gate", { version, gate: 1, outcome: "passed" });
      for (const state of states) append(old, "task.state", { version, state });
    }
    append(old, "task.proposed", { version: "pack", taskId: "t-2" });
    append(old, "task.gate", { version: "pack", gate: 1, outcome: "passed" });
    append(old, "task.state", { version: "pack", state: "released" });
    append(old, "verdict", { solve: "old-solve", task: "held", kind: "pass", answer: { answer: "24" } });
    const carry = () =>
      command("tools/c/carry.ts", {
        from: old,
        root,
        sweep: "s",
        cycle: "c01",
        bundle: repaired,
        name: CARRIED,
      });
    expect(carry().code).toBe(0);
    const log = join(REPO, ".ana", "d2", CARRIED, LOG);
    const events = read(log);
    const states = taskStates(events);
    expect(
      events.flatMap(({ kind, data }) =>
        kind === "task.proposed"
          ? [[data.taskId, states.get(isString(data.version) ? data.version : "")]]
          : [],
      ),
    ).toEqual([
      ["held", "held"],
      ["invalid", "refused"],
      ["disputed", "held"],
      ["practice", "released"],
      ["practice-disputed", "released"],
      ["t-2", "released"],
    ]);
    expect(events.filter(({ kind }) => kind === "task.gate")).toHaveLength(6);
    expect(events.filter(({ kind }) => kind === "verdict" || kind === "solve.started")).toEqual([]);
    expect(carry().code).toBe(0);
    expect(read(log)).toEqual(events);
  });
});

suite("preparation and rehearsal over a stored pack", () => {
  it("records a stored answer that still passes today's verifier once, and releases practice by the draw", () => {
    const prepare = (practice: string) =>
      run("tools/d2/prepare.ts", { cycle: "c01", name: PREPARED, practice, target: "2" });
    // The stored sweep accepted an answer to t-1, which still passes, and none to t-2.
    const both = prepare("0");
    expect(both.said).toMatch(/t-1:.*stored.*passes/u);
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
    expect(unformed.said).toMatch(/fault:.*do-nothing.*\{"answer":""\}.*answer format/u);
    expect(unformed.said).toContain("not frozen");
    expect(unformed.code).toBe(1);
    const log = read(join(REPO, ".ana", "d2", UNFORMED, LOG));
    expect(log.filter(({ kind }) => kind === "contract.frozen")).toEqual([]);
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
    expect(taken.code).toBe(0);
    expect(taskSets(read(join(source, LOG)))).toMatchObject({
      held: [expect.any(String)],
      released: [expect.any(String)],
    });
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
    expect(rehearse("--session", "b-0", "--target", "0").said).toMatch(/--target 0.*at least one/u);
    expect(lines()).toBe(before);
    expect(of("campaign.setting")).toEqual([]);

    for (const session of ["b-1", "b-2"]) {
      expect(rehearse("--no-comparison", "--session", session).code).toBe(0);
    }
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
    expect(compared.code).toBe(0);
    expect(of("comparison.reported")).toMatchObject([
      { session: "g-1", fresh: two?.harness, reading: "no-step", scored: { wins: 1, losses: 0, ties: 0 } },
    ]);
    // A session that ended says what it left when it is asked for again, and runs nothing.
    const again = rehearse("--no-comparison", "--session", "b-2");
    expect(again.code).toBe(0);
    expect(again.said).toContain("b-2");
    expect(again.said).toContain(isString(two?.harness) ? two.harness : "missing harness");
    expect(of("build.started")).toHaveLength(2);

    // The campaign's view prints each step's handover. Fix row F7: of the moves, it names the
    // table's alone. It takes the campaign command's flags and no other: a launch's, which it
    // parsed until 11 October, went with the launcher (`7f0add79:docs/simplify.md`, D2).
    const viewed = cli("view", SEED, "--level", "0.02").said;
    expect(
      viewed.split("\n").filter((line) => line.includes("Builder session, finished: from")),
    ).toHaveLength(2);
    // Four solves a side since 12 October, and the level 0.02, where nothing names another (`SIZE`).
    expect(viewed).toMatch(/1 task.*4 solves.*0\.02.*1 won.*0 lost.*0 tied.*no-step/u);
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

// `tools/c/rule-author.ts` over a sweep laid out as v1's left one, as far as it goes without a model:
// it says what binds the campaign's climb and starts a session only while that is the correctness
// model, or when told to all the same. The session's seat holds a script. The last test puts one
// addition through the verifier behind its wall and is skipped where the host has none, as
// `checker-commands.test.ts` is.
import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { taskVersion } from "../src/kernel/task.ts";
import { checkProgramVersion } from "../src/kernel/verify.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { additive, modelOf } from "../src/rules/candidate.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { ruleCommand, type Seated } from "../tools/c/rule-author.ts";
import { openCampaign } from "../tools/d2/campaign.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-rule-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-rule-command-")));
const bundle = join(root, "bundle");
const folder = join(REPO, ".ana", "d2", NAME);
const log = join(folder, "log.jsonl");
const ARGS = { root, sweep: "s", cycle: "c01", bundle, name: NAME };
const FORMAT = {
  type: "object",
  properties: { answer: { type: "string" }, note: { type: "string" } },
  required: ["answer", "note"],
};
const WRITTEN = { taskId: "x-1-001", family: "fixture", publicInput: { base: 7 }, hidden: null };
const STARTED: EventKind = "rule.started";
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const finish = call("finish", { note: "The note rule." });
const noted = (label: "accept" | "reject", note: string) => ({
  task: WRITTEN.taskId,
  expect: label,
  change: { path: "$.note", value: JSON.stringify(note) },
});
const propose = call("propose_rule", {
  rule: { id: "R2", statement: "The note is the word base, a space and the task's base in decimal digits." },
  check: {
    id: "check-note",
    assertion: "The note names the task's base.",
    answer_paths: ["$.note"],
    public_input_paths: ["$.base"],
  },
  code: "export const check = ({ artifact, publicTask }) => artifact.note === `base ${publicTask.publicInput.base}`;\n",
  controls: [noted("reject", "base 8"), noted("reject", "7"), noted("reject", "Base 7")],
});

setDefaultTimeout(180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

/** The sweep, its one graded pass, the cycle's harness state and a pack of two tasks, one check and
 *  two controls, as v1 lays them out. */
function layOut(): void {
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  writeFileSync(join(root, "grades", "s", "grades.tsv"), "cycle\ttaskId\tkind\n1\tt-1\tverified-pass\n");
  const solve = join(root, "runs", "s", "c01", "t-1");
  const caseDir = join(solve, "harness", "cases", "t-1");
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(join(solve, "work"));
  writeFileSync(
    join(solve, "result.json"),
    JSON.stringify({
      provider: "claude",
      model: "claude-opus-5-5",
      timedOut: false,
      answerPresent: true,
      answerParses: true,
    }),
  );
  writeFileSync(join(solve, "work", "answer.json"), JSON.stringify({ answer: "12", note: "base 2" }));
  const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
  writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
  writeFileSync(
    join(caseDir, "built-runtime.json"),
    JSON.stringify({
      modelWorker: { modelSelection: { effort: "medium" } },
      contractCondition: { tools: [{ description: "Role: artifact-writer. Records.", parameters: FORMAT }] },
    }),
  );
  cpSync(FIXTURE, join(root, "hb-bundles", "s-c01"), { recursive: true });
  const model = join(bundle, "correctness-model");
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
  writeFileSync(
    join(model, "evaluator.ts"),
    'export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n',
  );
  const task = (taskId: string, base: number) => ({
    taskId,
    family: "fixture",
    publicInput: { base },
    hidden: null,
  });
  writeFileSync(join(model, "tasks.json"), JSON.stringify([task("t-1", 2), task("t-2", 3)]));
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({
      accept: [{ taskId: "t-1", artifact: { answer: "12", note: "two" } }],
      reject: [{ taskId: "t-1", artifact: { answer: "13", note: "two" }, expectedCheckId: "check-product" }],
    }),
  );
}

/** The command with a script in its one model seat: its exit code and the lines it printed. */
async function seated(responses: FauxResponseStep[], flags: Record<string, string>, ...bare: string[]) {
  const faux = fauxProvider({
    models: [
      {
        id: "faux-rule-author",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const seat: Seated = () => ({ model: faux.getModel(), models: () => models });
  const said: string[] = [];
  const printed = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    said.push(parts.join(" "));
  });
  try {
    const args = Object.entries({ ...ARGS, ...flags }).flatMap(([flag, value]) => [`--${flag}`, value]);
    return { code: await ruleCommand([...args, ...bare], seat), said };
  } finally {
    printed.mockRestore();
  }
}

/** What the campaign's log holds of one kind. */
const held = (kind: EventKind) => read(log).flatMap((event) => (event.kind === kind ? [event.data] : []));

// Laid out at load, as `checker-commands.test.ts` writes its tree.
layOut();

describe("the Rule Author's command", () => {
  const TASKS =
    "what binds: tasks. 0 of the pool can be scored and a step takes 4: no Examiner session has written against this harness";

  it("says what binds the climb and starts no session while that is not the correctness model", () => {
    // As the operator runs it, with no model named: none is asked for before the reading.
    const flags = Object.entries({ ...ARGS, session: "r-1" }).flatMap(([flag, value]) => [
      `--${flag}`,
      value,
    ]);
    const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/c/rule-author.ts", ...flags], cwd: REPO });
    expect(`${ran.stdout.toString()}${ran.stderr.toString()}`.trim()).toBe(
      [
        TASKS,
        "not started: a Rule Author session waits for correctness-model. A requirement added to an exam the harness still fails makes it harder to tell what a step did. --anyway starts it all the same.",
      ].join("\n"),
    );
    expect(ran.exitCode).toBe(1);
    expect(held(STARTED)).toEqual([]);
    expect(existsSync(join(folder, "candidates"))).toBe(false);
  });

  it("starts all the same when told to, and its record keeps what the reading was", async () => {
    const { code, said } = await seated([finish], { session: "r-1" }, "--anyway");
    expect(code).toBe(0);
    expect(said).toEqual([
      TASKS,
      "the session ended finished, after 0 of its tries at the gates",
      "no candidate was left: the campaign's pack and its checker are as they were",
    ]);
    const campaign = await openCampaign(ARGS);
    expect(held(STARTED)).toMatchObject([
      {
        session: "r-1",
        binding: { binds: "tasks" },
        base: campaign.checker,
        checks: ["check-product"],
        tasks: ["t-1", "t-2"],
        witnessed: [],
        // The pack's accept control and the stored sweep's pass: the host's to read, at the end.
        stored: { control: 1, sweep: 1 },
      },
    ]);
    expect(held("rule.finished")).toMatchObject([{ session: "r-1", ended: "finished", candidate: null }]);
  });

  it("starts when a second Examiner session against the harness still wrote tasks the solver passes", async () => {
    append(log, "exam.started", { session: "x-1" });
    append(log, "exam.started", { session: "x-2" });
    append(log, "exam.word", { session: "x-2", version: "v-easy", taskId: "x-2-001", word: "too easy" });
    const { code, said } = await seated([finish], { session: "r-2" });
    expect(code).toBe(0);
    expect(said[0]).toBe(
      "what binds: correctness-model. 0 of the pool can be scored and a step takes 4: 1 of the 1 tasks written against this harness are passed by the measured solver, in a session told what the one before measured",
    );
    expect(held(STARTED).at(-1)).toMatchObject({
      session: "r-2",
      binding: { binds: "correctness-model" },
    });
  });
});

describe.skipIf(!osIsolationSupport().ok)("the Rule Author's command behind the verifier's wall", () => {
  it("leaves a candidate pack, adopts nothing, and says what the operator would do next", async () => {
    // One task a session wrote, feasible on a stronger solve's answer: the witness the controls
    // are edits of.
    const campaign = await openCampaign(ARGS);
    const version = taskVersion(campaign.pack(WRITTEN));
    const before = checkProgramVersion(modelOf(bundle));
    append(log, "task.proposed", { version, taskId: WRITTEN.taskId, session: "x-2", task: WRITTEN });
    append(log, "task.gate", { version, gate: 1, outcome: "passed" });
    append(log, "verdict", {
      solve: "strong-1",
      task: WRITTEN.taskId,
      answer: { answer: "42", note: "base 7" },
      kind: "pass",
    });
    append(log, "task.gate", { version, gate: 2, outcome: "passed", solve: "strong-1" });
    append(log, "task.gate", { version, gate: 3, outcome: "passed" });
    append(log, "task.gate", { version, gate: 4, outcome: "passed", controls: "d" });
    const { code, said } = await seated([propose, finish], { session: "r-3" }, "--anyway");
    expect(code).toBe(0);
    const dir = join(folder, "candidates", "r-3");
    expect(held("rule.gate").map(({ gate, outcome, over }) => [gate, outcome, over ?? null])).toEqual([
      ["shape", "passed", null],
      ["controls", "passed", null],
      ["determinism", "passed", null],
      ["interference", "reported", "witnesses"],
      ["interference", "reported", "record"],
    ]);
    expect(held("rule.candidate")).toMatchObject([
      { session: "r-3", dir: "candidates/r-3", rule: { id: "R2" }, check: { id: "check-note" } },
    ]);
    // The candidate is the pack with one addition and its tool tree, and the pack is as it was.
    expect(additive(bundle, dir, "with-tools")).toMatchObject({ rule: { id: "R2" } });
    expect(checkProgramVersion(modelOf(bundle))).toEqual(before);
    // The campaign opens under the checker it had.
    expect((await openCampaign(ARGS)).checker).toEqual(campaign.checker);
    expect(said.at(-1)).toBe(
      `Nothing is adopted: the campaign still runs under contract ${campaign.checker.contract} and check program ${campaign.checker.checks}. The next step is the operator's: read the candidate, and if the exam is to take it, give ${dir} as the pack to the command that adopts a changed pack into this campaign; otherwise leave or delete it.`,
    );
  });
});

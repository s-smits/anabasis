/**
 * An issue's absence says something only when the family was asked the same question again, and
 * `issue-condition.ts` is where that question is written down: the tasks a family ran, the checks
 * that graded them, the tools those checks launched and the Built condition the solver ran under.
 * These cases hold the condition itself, apart from what the register does with it. The two
 * comparisons are pure functions of two conditions, so they are put under their own cases instead
 * of through a register that has to be driven to the same answer; each reading of a battery is put
 * under a recorded tree or a recorded battery, with the half that vouches for it and the half that
 * does not.
 *
 * The cases that decide what an unmeasured issue is called, counted or shown live with the register
 * in test/issue-register.test.ts, and the packet that carries these values in test/rebuild-advice.test.ts.
 */
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double, required } from "./helpers/doubles.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { verifierEnvironmentHashOfTools } from "../src/correctness-bundle/verifier-environment.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { taskSetDigest } from "../src/claim/fingerprint.ts";
import {
  type ConditionGap,
  type IssueCondition,
  batteryCondition,
  conditionGaps,
  measuredConditionDigest,
  publicRulesMoved,
} from "../src/author/issue-condition.ts";
import { MEASURED_UNDER } from "./helpers/review-fixtures.ts";

afterEach(cleanupScratch);

const other = (digit: string) => digit.repeat(64);

/** The fixture condition with `moved` changed, which is how a test says which part moved. */
const under = (moved: Partial<IssueCondition> = {}): IssueCondition => ({ ...MEASURED_UNDER, ...moved });

describe("what moved between two conditions", () => {
  it("is empty for the same condition, and for the same checks under reworded public rules", () => {
    expect(conditionGaps(under(), under())).toEqual([]);
    // A reworded brief moves the scoring hash, which reads every byte of it, and the publication hash,
    // and no verdict: the verdict closure leaves out the text and the constants.
    const reworded = under({ scoringHash: other("8"), publicationHash: other("7") });
    expect(conditionGaps(under(), reworded)).toEqual([]);
  });

  it("names each part that moved, in the order the register reports it", () => {
    const moved: Record<ConditionGap, Partial<IssueCondition>> = {
      "task-inputs": { taskInputs: other("9") },
      scoring: { scoringHash: other("8"), verdictClosureHash: other("9") },
      "check-tools": { checkTools: other("6") },
      "built-condition": { measuredCondition: other("7") },
    };
    for (const gap of ["task-inputs", "scoring", "check-tools", "built-condition"] as const) {
      expect(conditionGaps(under(), under(moved[gap]))).toEqual([gap]);
    }
    expect(conditionGaps(under(), under(Object.assign({}, ...Object.values(moved))))).toEqual([
      "task-inputs",
      "scoring",
      "check-tools",
      "built-condition",
    ]);
  });

  it("compares what could not be vouched for with nothing, on either side", () => {
    // Tasks, tools and the closure each read null when the evidence behind them failed its check.
    expect(conditionGaps(under({ taskInputs: null }), under({ taskInputs: null }))).toEqual(["task-inputs"]);
    expect(conditionGaps(under(), under({ taskInputs: null }))).toEqual(["task-inputs"]);
    expect(conditionGaps(under({ checkTools: null }), under({ checkTools: null }))).toEqual(["check-tools"]);
    expect(conditionGaps(under(), under({ checkTools: null }))).toEqual(["check-tools"]);
    const reworded = { scoringHash: other("8") };
    expect(conditionGaps(under({ verdictClosureHash: null }), under(reworded))).toEqual(["scoring"]);
    expect(conditionGaps(under(), under({ ...reworded, verdictClosureHash: null }))).toEqual(["scoring"]);
    // The same scoring bytes need no closure to be the same checks.
    expect(conditionGaps(under({ verdictClosureHash: null }), under({ verdictClosureHash: null }))).toEqual(
      [],
    );
  });

  it("says the public rules moved only when the brief's bytes did and the rules cannot be shown the same", () => {
    expect(publicRulesMoved(under(), under())).toBe(false);
    // A private row or a decision moves the scoring hash and publishes nothing.
    expect(publicRulesMoved(under(), under({ scoringHash: other("8") }))).toBe(false);
    expect(publicRulesMoved(under(), under({ scoringHash: other("8"), publicationHash: other("7") }))).toBe(
      true,
    );
    // Rules that could not be vouched for cannot show identical instructions, on either side.
    expect(publicRulesMoved(under(), under({ scoringHash: other("8"), publicationHash: null }))).toBe(true);
    expect(publicRulesMoved(under({ publicationHash: null }), under({ scoringHash: other("8") }))).toBe(true);
  });
});

describe("measuredConditionDigest", () => {
  const facts = {
    runId: "r1",
    builtPin: "codex:built-model:high",
    builtEffort: "high",
    isolationStrength: "physical",
    runCondition: { variant: "shipping", advisorsRemoved: [], builtProcedure: "p" },
  };

  it("moves with the Built model, its effort, the isolation and the run condition", () => {
    const base = measuredConditionDigest(facts);
    for (const moved of [
      { ...facts, builtPin: "codex:built-model:low" },
      { ...facts, builtEffort: "low" },
      { ...facts, isolationStrength: "UNPROVEN" },
      { ...facts, runCondition: { ...facts.runCondition, advisorsRemoved: ["hint"] } },
      { ...facts, runCondition: { ...facts.runCondition, builtProcedure: "q" } },
    ]) {
      expect(measuredConditionDigest(moved)).not.toBe(base);
    }
    // Another battery under the same recorded effort is the same condition; an unrecorded effort is
    // unknown, so it matches no other battery.
    expect(measuredConditionDigest({ ...facts, runId: "r2" })).toBe(base);
    const unrecorded = { ...facts, builtEffort: null };
    expect(measuredConditionDigest({ ...unrecorded, runId: "r2" })).not.toBe(
      measuredConditionDigest(unrecorded),
    );
    // A condition recorded before the host's share of the prompt was is unknown in the same way.
    const { builtProcedure: _recorded, ...older } = facts.runCondition;
    const olderFacts = { ...facts, runCondition: older };
    expect(measuredConditionDigest({ ...olderFacts, runId: "r2" })).not.toBe(
      measuredConditionDigest(olderFacts),
    );
  });

  // agent/config.yaml is harness bytes the Builder owns: raising solve_seconds for a family that kept
  // timing out is a fix, and a digest that moved with it would call that fix unmeasured forever.
  it("leaves out the walls agent/config.yaml declares, which a fix may change", () => {
    const tree = scratchDir("ana-condition-");
    mkdirSync(join(tree, "agent"), { recursive: true });
    writeFileSync(
      join(tree, "agent", "config.yaml"),
      "solver:\n  shell_command_seconds: 1800\n  solve_seconds: 14400\n",
    );
    const recorded = double<Parameters<typeof batteryCondition>[0]>({
      runId: "run-walls",
      cases: [],
      identities: {
        backendPin: facts.builtPin,
        isolationStrength: facts.isolationStrength,
        bundleSnapshot: { scoringHash: "s" },
      },
      battery: { condition: facts.runCondition },
    });
    const before = batteryCondition(recorded, tree).measuredCondition;
    writeFileSync(
      join(tree, "agent", "config.yaml"),
      "solver:\n  shell_command_seconds: 900\n  solve_seconds: 7200\n",
    );
    expect(batteryCondition(recorded, tree).measuredCondition).toBe(before);
  });
});

describe("the tasks a family ran", () => {
  const tasks = (limit: number) => [
    { taskId: "t1", family: "beams", publicInput: { span: 4 }, hidden: [{ limit }] },
    { taskId: "t2", family: "joints", publicInput: { span: 5 }, hidden: [{ limit: 2 }] },
    { taskId: "t3", family: "beams", publicInput: { span: 6 }, hidden: [{ limit: 2 }] },
  ];
  /** A tree whose tasks.json holds `tasks(limit)`, and a battery that ran t3 and t1 of beams and t2 of
   *  joints, read against the task-set hash `taskSetHash` says. */
  function read(tree: string, taskSetHash: string | null) {
    return batteryCondition(
      double<Parameters<typeof batteryCondition>[0]>({
        runId: "run-tasks",
        cases: [
          { taskId: "t3", family: "beams" },
          { taskId: "t1", family: "beams" },
          { taskId: "t2", family: "joints" },
        ],
        identities: {
          backendPin: "codex:built-model:high",
          isolationStrength: "physical",
          bundleSnapshot: { scoringHash: "s", taskSetHash },
        },
        battery: { condition: { variant: "shipping", advisorsRemoved: [] } },
      }),
      tree,
    ).familyTasks;
  }
  const treeWith = (limit: number) => {
    const tree = scratchDir("ana-family-tasks-");
    mkdirSync(join(tree, "correctness-model"), { recursive: true });
    writeFileSync(join(tree, "correctness-model", "tasks.json"), JSON.stringify(tasks(limit)));
    return tree;
  };

  // A probe that moves only a hidden limit asks the verifier another question while the solver reads
  // the same bytes, so the family's digest has to move with it, and only that family's.
  it("a probe that moves only a hidden operand is another question, and an unvouched tree is unknown", () => {
    const tree = treeWith(1);
    const recorded = taskSetDigest(tree);
    const before = read(tree, recorded);
    writeFileSync(join(tree, "correctness-model", "tasks.json"), JSON.stringify(tasks(3)));
    const after = read(tree, taskSetDigest(tree));
    expect(before.get("beams")?.taskInputs).toMatch(/^[0-9a-f]{64}$/);
    expect(after.get("beams")?.taskInputs).not.toBe(before.get("beams")?.taskInputs);
    expect(after.get("joints")?.taskInputs).toBe(before.get("joints")?.taskInputs);
    // The tree no longer hashes to the task set the battery recorded, so nothing is vouched for.
    expect([...read(tree, recorded).values()].map((row) => row.taskInputs)).toEqual([null, null]);
  });

  // The ids are what lets a later battery see these tasks run under another family's name, so they
  // come from the cases the battery ran and need no tree to vouch for them.
  it("names the tasks each family ran, sorted, whether or not the tree can be vouched for", () => {
    const tree = treeWith(1);
    for (const vouched of [taskSetDigest(tree), null]) {
      const families = read(tree, vouched);
      expect(families.get("beams")?.taskIds).toEqual(["t1", "t3"]);
      expect(families.get("joints")?.taskIds).toEqual(["t2"]);
    }
  });
});

describe("the tools a battery's checks ran", () => {
  const script = {
    digest: "a".repeat(64),
    kind: "script",
    interpreter: "sh",
    interpreterDigest: "b".repeat(64),
  };
  // A workspace tool is recorded with its portable digest, the file with the tree's path taken out.
  const analyser = { ...script, source: "workspace-toolchain", portableDigest: "9".repeat(64) };

  /** One measured battery whose checks ran `tool` out of a tool tree with digest `tree`, or off the
   *  host PATH when `tree` is null, recorded the way a battery closes: the tool map and its
   *  environment hash under `execution`, the file named by the run's manifest. `execution`
   *  overrides what the record says. */
  function recordBattery(
    tool: Omit<typeof script, "interpreter" | "interpreterDigest"> & {
      source: string;
      interpreter: string | null;
      interpreterDigest?: string;
      portableDigest?: string;
    },
    tree: string | null,
    execution?: { verifierEnvironmentHash: string },
  ) {
    const measuredDir = scratchDir("ana-check-tools-");
    const tools = { "truss-analyze": tree === null ? tool : { ...tool, treeDigest: tree } };
    const environment = verifierEnvironmentHashOfTools(tools);
    const log = new EvidenceLog(join(measuredDir, "runs", "r2"));
    log.write("battery.json", {
      runId: "r2",
      cases: [],
      execution: { executed: [], verifierEnvironmentHash: environment, tools, ...execution },
    });
    log.record();
    const recorded = double<Parameters<typeof batteryCondition>[0]>({
      runId: "r2",
      cases: [],
      identities: {
        backendPin: "codex:built-model:high",
        isolationStrength: "physical",
        bundleSnapshot: { scoringHash: MEASURED_UNDER.scoringHash },
      },
      battery: { condition: { variant: "shipping", advisorsRemoved: [] } },
    });
    return { measuredDir, environment, checkTools: batteryCondition(recorded, measuredDir).checkTools };
  }

  /** What moved for an issue whose checks ran the tools `was` records, when a later battery ran `now`. */
  const gapsBetween = (was: string | null, now: string | null) =>
    conditionGaps(under({ checkTools: was }), under({ checkTools: now }));

  /** A `truss-analyze` wrapper installed in `workspace`'s tool tree, naming the tree by its absolute
   *  path and exec'ing the script beside it, whose body is `cli`; resolved the way a battery's
   *  verifier resolves it and recorded as that battery's one check tool. */
  function installedIn(workspace: string, cli: string) {
    const tree = join(workspace, ".toolchain");
    const wrapper = join(tree, "bin", "truss-analyze");
    mkdirSync(join(tree, "bin"), { recursive: true });
    mkdirSync(join(tree, "lib"), { recursive: true });
    writeFileSync(wrapper, `#!/bin/sh\nexec "${realpathSync.native(tree)}/lib/truss_cli.sh" "$@"\n`);
    writeFileSync(join(tree, "lib", "truss_cli.sh"), cli);
    chmodSync(wrapper, 0o755);
    const found = resolveToolInventory({ toolIds: ["truss-analyze"], toolTree: tree, pathDirs: [] });
    const entry = required(found.inventory["truss-analyze"], "installed wrapper");
    const recorded = {
      digest: entry.digest,
      source: entry.source,
      kind: entry.kind,
      interpreter: entry.interpreter,
      ...keyIfDefined("interpreterDigest", entry.interpreterDigest),
      ...keyIfDefined("portableDigest", entry.portableDigest),
    };
    return { entry, battery: recordBattery(recorded, required(entry.treeDigest, "tree digest")) };
  }

  it("moves when the tree behind an unchanged check tool moved", () => {
    // The wrapper's own bytes and its interpreter are fixed while the tree it was installed in
    // moved. The record cannot say whether the change was the script the wrapper execs or a solver
    // tool beside it, so the checks count as changed.
    const was = recordBattery(analyser, "5".repeat(64));
    const treeMoved = recordBattery(analyser, "6".repeat(64));
    expect(treeMoved.checkTools).toMatch(/^[0-9a-f]{64}$/);
    expect(treeMoved.checkTools).not.toBe(was.checkTools);
    expect(gapsBetween(was.checkTools, treeMoved.checkTools)).toEqual(["check-tools"]);
  });

  it("moves when a script was rewritten behind a byte-identical wrapper", () => {
    const was = installedIn(scratchDir("ana-workspace-"), "#!/bin/sh\necho pass\n");
    const rewritten = installedIn(scratchDir("ana-rewritten-workspace-"), "#!/bin/sh\necho fail\n");
    expect(rewritten.entry.portableDigest).toBe(required(was.entry.portableDigest, "portable digest"));
    expect(rewritten.entry.interpreterDigest).toBe(was.entry.interpreterDigest);
    expect(rewritten.battery.checkTools).toMatch(/^[0-9a-f]{64}$/);
    expect(gapsBetween(was.battery.checkTools, rewritten.battery.checkTools)).toEqual(["check-tools"]);
  });

  it("holds when a reseed only moved the tree a wrapper names", () => {
    // A wrapper that names its tree by absolute path has other raw bytes in every workspace the
    // tree is copied into, while the file and the tree with that path taken out are the same.
    const cli = "#!/bin/sh\necho pass\n";
    const was = installedIn(scratchDir("ana-workspace-"), cli);
    const reseeded = installedIn(scratchDir("ana-reseeded-workspace-"), cli);
    expect(reseeded.entry.digest).not.toBe(was.entry.digest);
    expect(reseeded.entry.treeDigest).toBe(required(was.entry.treeDigest, "tree digest"));
    expect(reseeded.battery.checkTools).toMatch(/^[0-9a-f]{64}$/);
    expect(reseeded.battery.checkTools).toBe(was.battery.checkTools);
    expect(gapsBetween(was.battery.checkTools, reseeded.battery.checkTools)).toEqual([]);
  });

  it("moves when a check tool's own bytes or its interpreter moved", () => {
    const was = recordBattery(analyser, "5".repeat(64));
    for (const moved of [
      recordBattery({ ...analyser, portableDigest: "c".repeat(64) }, "5".repeat(64)),
      recordBattery({ ...analyser, interpreterDigest: "d".repeat(64) }, "5".repeat(64)),
      recordBattery({ ...script, source: "host" }, null),
    ]) {
      expect(moved.checkTools).toMatch(/^[0-9a-f]{64}$/);
      expect(moved.checkTools).not.toBe(was.checkTools);
      expect(gapsBetween(was.checkTools, moved.checkTools)).toEqual(["check-tools"]);
    }
  });

  it("compares a battery record it cannot vouch for with nothing", () => {
    const was = recordBattery(analyser, "5".repeat(64));
    expect(was.checkTools).toMatch(/^[0-9a-f]{64}$/);
    // An environment hash the tool map does not recompute is a record no reader can trust.
    expect(
      recordBattery(analyser, "5".repeat(64), { verifierEnvironmentHash: "e".repeat(64) }).checkTools,
    ).toBeNull();
    // A workspace tool recorded without its portable digest is an older record.
    expect(recordBattery({ ...script, source: "workspace-toolchain" }, "5".repeat(64)).checkTools).toBeNull();
    // Bytes that moved after the manifest recorded them are damaged evidence.
    const damaged = recordBattery(analyser, "5".repeat(64));
    writeFileSync(join(damaged.measuredDir, "runs", "r2", "battery.json"), "{}");
    const reread = double<Parameters<typeof batteryCondition>[0]>({
      runId: "r2",
      cases: [],
      identities: { backendPin: "p", isolationStrength: "physical", bundleSnapshot: { scoringHash: "s" } },
      battery: { condition: { variant: "shipping", advisorsRemoved: [] } },
    });
    expect(batteryCondition(reread, damaged.measuredDir).checkTools).toBeNull();
    expect(gapsBetween(was.checkTools, null)).toEqual(["check-tools"]);
    expect(gapsBetween(null, was.checkTools)).toEqual(["check-tools"]);
  });
});

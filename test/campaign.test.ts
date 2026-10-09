// A campaign over a sweep laid out as v1's left one, as far as it goes without a model or a wall: it
// opens, `prepare.ts`, run as the operator runs it, takes the pack's tasks in, releases the practice
// tasks once and takes a person's label of a task, a task a session wrote stands beside the pack's
// own, and the campaign keeps its harnesses by name: the one it started with, the starter
// and the latest a session left.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { taskSets, taskVersion } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { openHarness } from "../src/solve/harness.ts";
import { starter, keptAs, LIMITS, openCampaign } from "../tools/d2/campaign.ts";
import { SETTING_OPTIONS, settingNamed } from "../tools/d2/setting.ts";
import { budgetsNamed, capNamed, ROUND_OPTIONS, roundCommand, validLines } from "../tools/d2/round.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-campaign-")));
const bundle = join(root, "bundle");
const ARGS = { root, sweep: "s", cycle: "c01", bundle, name: NAME };
const ASKED = { solves: 2, level: 0.1 };
const TASKS = Array.from({ length: 7 }, (_, index) => ({
  taskId: `t-${String(index + 1)}`,
  family: "fixture",
  publicInput: { base: index + 2 },
  hidden: null,
}));

// A test here runs a campaign's commands as the operator does, and each start reads the host's
// source tree whole: over a second, so three of them pass Bun's own five.
setDefaultTimeout(60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(REPO, ".ana", "d2", NAME), { recursive: true, force: true });
});

/** The sweep, its one graded solve, the cycle's harness state and the pack, as v1 lays them out. */
function layOut(): void {
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  writeFileSync(join(root, "grades", "s", "grades.tsv"), "cycle\ttaskId\tkind\n1\tt-1\tverified-pass\n");
  const solve = join(root, "runs", "s", "c01", "t-1");
  const caseDir = join(solve, "harness", "cases", "t-1");
  mkdirSync(caseDir, { recursive: true });
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
  const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
  writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
  const format = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  writeFileSync(
    join(caseDir, "built-runtime.json"),
    JSON.stringify({
      modelWorker: { modelSelection: { effort: "medium" } },
      contractCondition: { tools: [{ description: "Role: artifact-writer. Records.", parameters: format }] },
    }),
  );
  cpSync(FIXTURE, join(root, "hb-bundles", "s-c01"), { recursive: true });
  mkdirSync(join(bundle, "correctness-model"), { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(bundle, "correctness-model", "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      domain: "Fixture",
      ruleDecisions: [{ id: "R1", statement: "The answer is the base times six.", visibility: "public" }],
      truthChecks: [{ id: "check-product", assertion: "Six times.", citedDecisionIds: ["R1"], execution }],
      artifactSchema: [],
      designRuleConstants: [],
    }),
  );
  writeFileSync(join(bundle, "correctness-model", "evaluator.ts"), "export const checks = {};\n");
  writeFileSync(join(bundle, "correctness-model", "tasks.json"), JSON.stringify(TASKS));
}

describe("a campaign", () => {
  /** `prepare.ts` as the operator runs it, with whatever flags `more` adds, and what it printed. */
  const prepare = (...more: string[]) => {
    const flags = Object.entries({ ...ARGS, practice: "2" }).flatMap(([flag, value]) => [`--${flag}`, value]);
    const cmd = [capturedExecPath, "tools/d2/prepare.ts", ...flags, ...more];
    const ran = Bun.spawnSync({ cmd, cwd: REPO });
    return `${ran.stdout.toString()}${ran.stderr.toString()}`.trim();
  };

  it("opens over a stored sweep, takes the pack's tasks in at their gate, and releases practice once", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    expect(campaign.contract.rules).toMatchObject([
      { id: "R1", statement: "The answer is the base times six." },
    ]);
    expect(campaign.test).toMatchObject({ effort: "medium", side: "test" });
    expect(campaign.test.model.id).toBe("claude-opus-5-5");
    // The log, the staged check program and the states are inside the repository, which every wall denies.
    expect(campaign.log.startsWith(join(REPO, ".ana", "d2", NAME))).toBe(true);
    expect(read(campaign.log)).toEqual([]);

    // One task as an Examiner session leaves it: its instance whole in its proposal, its gate passed.
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 40 }, hidden: { seed: 1 } };
    const extra = taskVersion(campaign.pack(written));
    append(campaign.log, "task.proposed", {
      version: extra,
      taskId: written.taskId,
      session: "x-1",
      task: written,
    });
    append(campaign.log, "task.gate", { version: extra, gate: 1, outcome: "passed" });

    // The pack's seven tasks are proposed and put to their one gate, with no solve and no stored
    // answer. Two of the eight held out are then released for practice, by the contract's draw.
    const versions = TASKS.map((task) => taskVersion(campaign.pack(task)));
    const summary = ["6 held out, 2 released for practice", ...sizeLines(6, ASKED)].join("\n");
    // Each release is said by its task: a release cannot be taken back.
    const [proposed, ...said] = prepare().split("\n");
    expect(proposed).toBe("7 of the pack's tasks proposed: 7 held out, 0 refused");
    expect(said.slice(0, 2).every((line) => line.endsWith(": released for practice, and never scored"))).toBe(
      true,
    );
    expect(said.slice(2).join("\n")).toBe(summary);
    const sets = taskSets(read(campaign.log));
    expect([sets.held.length, sets.released.length]).toEqual([6, 2]);
    expect([...sets.held, ...sets.released].toSorted()).toEqual([...versions, extra].toSorted());
    expect(read(campaign.log).filter(({ kind }) => kind === "anchor.drawn")).toEqual([]);
    const packages = campaign.packages();
    expect(packages.get(extra)).toMatchObject({ taskId: "x-1-001", hidden: { seed: 1 }, ruleIds: ["R1"] });
    expect(versions.every((version) => packages.has(version))).toBe(true);
    // A second run proposes and releases nothing.
    const events = read(campaign.log).length;
    expect(prepare()).toBe(summary);
    expect(read(campaign.log)).toHaveLength(events);
    // Asked for no more practice than there is, it says what a comparison of the size asked for can show.
    expect(prepare("--target", "3")).toBe(
      ["6 held out, 2 released for practice", ...sizeLines(3, ASKED)].join("\n"),
    );
  });

  it("takes a person's label of a held-out task: kept in the scored set, or refused as infeasible", async () => {
    const campaign = await openCampaign(ARGS);
    const packages = campaign.packages();
    const [kept = "", gone = ""] = taskSets(read(campaign.log)).held;
    const idOf = (version: string) => packages.get(version)?.taskId ?? "";
    const said = prepare("--keep", idOf(kept), "--infeasible", idOf(gone), "--note", "no member carries it");
    expect(said).toStartWith(
      `${idOf(kept)}: kept in the scored set\n${idOf(gone)}: refused as infeasible\n5 held out, 2 released`,
    );
    const sets = taskSets(read(campaign.log));
    expect(sets.held).toContain(kept);
    expect(sets.states.get(gone)).toBe("refused");
    expect(
      read(campaign.log).filter(({ kind, data }) => kind === "task.state" && "reason" in data),
    ).toMatchObject([
      {
        data: {
          version: kept,
          state: "held",
          reason: "a person read the task as feasible: no member carries it",
        },
      },
      {
        data: {
          version: gone,
          state: "refused",
          reason: "a person read the task as infeasible: no member carries it",
        },
      },
    ]);
    // A run that labels releases nothing, whatever --practice it carries: a release cannot be
    // taken back, and a person labelling one task has not asked for another to leave the set.
    expect(prepare("--practice", "4", "--keep", idOf(kept))).toContain("5 held out, 2 released");
    expect(taskSets(read(campaign.log)).released).toHaveLength(2);
    // Only a held-out task is labelled: not a refused one, a practice task or a name no task has.
    expect(prepare("--keep", idOf(gone))).toContain("is no held-out task of this campaign");
    expect(prepare("--infeasible", idOf(sets.released[0] ?? ""))).toContain("is no held-out task");
    expect(prepare("--keep", "t-99")).toContain("t-99 is no held-out task of this campaign");
  });

  it("starts from the Starter Built Harness, and keeps it and the latest a session left, each by name", async () => {
    const campaign = await openCampaign(ARGS);
    // The starter is a harness like any other: it opens, with pi's four coding tools selected and
    // no guide and no tool of its own, and it is kept under its digest among the campaign's states.
    const least = await starter(campaign);
    const opened = await openHarness(least.dir);
    expect(least).toEqual({ dir: join(campaign.states, opened.digest), digest: opened.digest });
    expect(opened.guide).toBeNull();
    expect(opened.presets).toEqual(["read", "bash", "edit", "write"]);
    expect(opened.kinds.size).toBe(0);
    expect(opened.toolTree).toBeNull();
    expect(await starter(campaign)).toEqual(least);
    expect(readdirSync(campaign.states)).toEqual([least.digest]);
    // It is the reference harness, and until a session has left a harness it is the latest too:
    // the first Builder session forks it.
    expect(await keptAs(campaign, "--reference", "starter")).toEqual(least);
    expect(await keptAs(campaign, "--parent", "latest")).toEqual(least);
    expect(ROUND_OPTIONS.reference.default).toBe("starter");
    expect(ROUND_OPTIONS.parent.default).toBe("latest");
    // The stored cycle's own harness is none the campaign keeps: it comes from v1's runs.
    await expect(keptAs(campaign, "--reference", "start")).rejects.toThrow(
      "--reference start is no harness this campaign keeps",
    );

    // A session leaves a harness under its digest, and the Builder goes on from it whether or not
    // its comparison read a step. The reference harness stays the starter: no reading moves it,
    // and promotion is the operator's, by naming another.
    const child = join(root, "child");
    cpSync(least.dir, child, { recursive: true });
    writeFileSync(join(child, "agent", "BUILT_AGENTS.md"), "Multiply first.\n");
    const { digest } = await openHarness(child);
    cpSync(child, join(campaign.states, digest), { recursive: true });
    append(campaign.log, "build.finished", {
      session: "b-1",
      harness: digest,
      changed: true,
      ended: "finished",
    });
    append(campaign.log, "comparison.reported", { session: "b-1", reading: "step", fresh: digest });
    const built = { dir: join(campaign.states, digest), digest };
    expect(await keptAs(campaign, "--parent", "latest")).toEqual(built);
    expect(await keptAs(campaign, "--reference", "starter")).toEqual(least);
    expect(await keptAs(campaign, "--reference", digest)).toEqual(built);
    // The starter is named by its digest too, as any kept harness is.
    expect(await keptAs(campaign, "--parent", least.digest)).toEqual(least);
    // A kept state that has changed is no longer the harness its name says, and is refused before
    // a solve is paid for under that name.
    writeFileSync(join(built.dir, "agent", "BUILT_AGENTS.md"), "Add first.\n");
    await expect(keptAs(campaign, "--parent", "latest")).rejects.toThrow(
      `${built.dir} no longer opens as the harness it is kept as`,
    );
  });

  it("says which harnesses a campaign keeps when --parent names none of them", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    const digest = "ab".repeat(32);
    mkdirSync(join(campaign.states, digest), { recursive: true });
    // The round as the operator runs it. It is refused before a seat is taken or a session starts.
    const round = (parent: string) => {
      const given = { ...ARGS, session: "b-9", builder: "faux/none", cap: "100", parent };
      const flags = Object.entries(given).flatMap(([flag, value]) => [`--${flag}`, value]);
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/d2/round.ts", ...flags], cwd: REPO });
      return `${ran.stdout.toString()}${ran.stderr.toString()}`;
    };
    // A digest cut short, as every reader prints one: the whole one is named beside it.
    const short = round(digest.slice(0, 8));
    expect(short).toContain("--parent abababab is no harness this campaign keeps");
    expect(short).toContain(
      `whole: ${readdirSync(campaign.states).sort().join(", ")}. abababab begins ${digest}.`,
    );
    // Nor is another folder of the campaign a harness, wherever the name leads.
    expect(round("../checks")).toContain("--parent ../checks is no harness this campaign keeps");
    expect(read(campaign.log).filter(({ kind }) => kind === "build.started")).toEqual([]);
  });

  it("holds every solve to the limits a command names, through one owner, and to the sweep's when it names none", async () => {
    const plain = await openCampaign(ARGS);
    expect(plain.limits).toEqual(LIMITS);
    // The two flags' defaults are the sweep's limits, so a command that names neither runs under
    // the setting every campaign ran under before the flags existed.
    const defaults = {
      "solver-effort": SETTING_OPTIONS["solver-effort"].default,
      "solve-minutes": SETTING_OPTIONS["solve-minutes"].default,
      "solve-turns": SETTING_OPTIONS["solve-turns"].default,
    };
    // With no --solver the effort flag names nothing: the stored cycle's model solves at its effort.
    expect(settingNamed(defaults)).toEqual({ solver: undefined, limits: LIMITS });
    const unnamed = await openCampaign({ ...ARGS, ...settingNamed(defaults) });
    expect(unnamed.setting(unnamed.test)).toBe(plain.setting(plain.test));
    // A longer wall or more turns is another setting.
    const named = settingNamed({ ...defaults, "solve-minutes": "240", "solve-turns": "48" }).limits;
    expect(named).toEqual({ ...LIMITS, wallSeconds: 14_400, turns: 48 });
    const longer = await openCampaign({ ...ARGS, limits: named });
    expect(longer.limits).toEqual(named);
    // Another solver is another setting too, and every command that names it stands where a round
    // that named it stood.
    const other = settingNamed({
      ...defaults,
      solver: "anthropic/claude-sonnet-5-5",
      "solver-effort": "low",
    });
    expect(other.solver).toEqual({ model: "anthropic/claude-sonnet-5-5", effort: "low" });
    expect(longer.setting(longer.test)).not.toBe(plain.setting(plain.test));
    for (const [minutes, turns] of [
      ["0", "24"],
      ["1.5", "24"],
      ["120", "0"],
      ["two hours", "24"],
    ] as const) {
      expect(() => settingNamed({ ...defaults, "solve-minutes": minutes, "solve-turns": turns })).toThrow(
        "a solve's wall and its turns are whole numbers of at least one",
      );
    }

    // A round takes the owner's four flags as they are, and a rehearsal is a round with other seats.
    for (const flag of ["solver", "solver-effort", "solve-minutes", "solve-turns"] as const) {
      expect(ROUND_OPTIONS[flag]).toBe(SETTING_OPTIONS[flag]);
    }
    // Every command reads them through the owner: a wall it refuses is refused by each of them
    // before a campaign is opened or a model is asked for.
    const refused = "--solve-minutes 0 --solve-turns 24: a solve's wall and its turns are whole numbers";
    const flags = [
      ...Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]),
      "--solve-minutes",
      "0",
    ];
    const session = ["--session", "z-9"];
    const capped = ["--cap", "100"];
    await expect(roundCommand([...flags, ...session, ...capped])).rejects.toThrow(refused);
    for (const command of [["tools/d2/checkpoint.ts", "--id", "z-9", ...capped]]) {
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, ...command, ...flags], cwd: REPO });
      expect(ran.exitCode).not.toBe(0);
      expect(ran.stderr.toString()).toContain(refused);
    }
    expect(read(plain.log).some(({ data }) => data.session === "z-9")).toBe(false);
  });

  it("starts no paid comparison without a dollar cap, and reads its budgets before anything starts", async () => {
    const flags = Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]);
    await expect(roundCommand([...flags, "--session", "z-8", "--builder", "faux/none"])).rejects.toThrow(
      "name --cap, the billed dollars this comparison may hold",
    );
    const ran = Bun.spawnSync({
      cmd: [capturedExecPath, "tools/d2/checkpoint.ts", "--id", "z-8", ...flags],
      cwd: REPO,
    });
    expect(ran.stderr.toString()).toContain("name --cap");
    expect(capNamed({ cap: "375", reserve: "10" }, "paid")).toEqual({ dollars: 375, reserve: 10 });
    // A simulation's seats are scripts, which are paid nothing, and may name none.
    expect(capNamed({ reserve: "10" }, "scripted")).toBeUndefined();
    expect(capNamed({ cap: "40", reserve: "5" }, "scripted")).toEqual({ dollars: 40, reserve: 5 });
    // A budget names any of the four units, and each flag is one budget to read the comparison at.
    expect(budgetsNamed(["turns=40", "prompts=8,cpu=600", "seconds=1800"])).toEqual([
      { turns: 40 },
      { prompts: 8, cpu: 600 },
      { seconds: 1800 },
    ]);
    expect(budgetsNamed()).toEqual([]);
    // What a report says of each harness by itself is printed in words: the tasks by how many of
    // their solves were valid, at the full limit and at each budget. For the first round the
    // reference harness is the starter, and these lines are what its gate reads.
    const tested = { wins: 0, losses: 0, ties: 0, p: 1 };
    expect(
      validLines({
        valid: { old: [2, 1, 5], fresh: [0, 1, 7] },
        budgets: [
          { prompts: 12, ...tested, valid: { old: [4, 2, 2], fresh: [1, 3, 4] } },
          { turns: 40, cpu: 600, ...tested, valid: { old: [6, 2, 0], fresh: [3, 3, 2] } },
        ],
      }),
    ).toEqual([
      "each harness by itself, as the tasks with 0, 1, 2 valid answers in 2 solves:",
      "  at its limits: reference 2/1/5, new 0/1/7",
      "  at prompts=12: reference 4/2/2, new 1/3/4",
      "  at turns=40,cpu=600: reference 6/2/0, new 3/3/2",
    ]);
    expect(validLines({ valid: null, budgets: [] })).toEqual([]);
    for (const flag of ["turns", "turns=0", "tokens=5", "turns=4=5", ""]) {
      expect(() => budgetsNamed([flag])).toThrow("a budget names turns, prompts, cpu or seconds");
    }
    const campaign = await openCampaign(ARGS);
    expect(read(campaign.log).some(({ data }) => data.session === "z-8")).toBe(false);
  });
  it("refuses a labels file with an entry that is no label, and a --target that is no count", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]);
    const run = (...cmd: string[]) => Bun.spawnSync({ cmd: [capturedExecPath, ...cmd, ...flags], cwd: REPO });
    // A mistyped label is not read as no label: the file is refused by the entry, before anything
    // is settled. An empty entry is one still to be labelled.
    const dir = join(campaign.log, "..", "settle-z-7");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "labels.json"), JSON.stringify({ "s-1": "earnd", "s-2": "", "s-3": "earned" }));
    const settled = run("tools/d2/settle.ts", "--session", "z-7");
    expect(settled.exitCode).not.toBe(0);
    expect(settled.stderr.toString()).toContain(
      'holds what is no label (earned, check-defect or unclear) for 1 rejection: s-1: "earnd"',
    );
    // No number would draw no task, and a negative one all but the last.
    for (const target of ["twelve", "-1", "0", "2.5"]) {
      const ran = run("tools/d2/checkpoint.ts", "--id", "z-6", "--cap", "40", `--target=${target}`);
      expect(ran.stderr.toString()).toContain(
        `--target ${target}: the tasks to score are a whole number of at least one`,
      );
    }
    expect(read(campaign.log).some(({ data }) => data.session === "z-6")).toBe(false);
  });
});

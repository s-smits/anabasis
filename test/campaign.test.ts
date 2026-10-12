// A campaign over a sweep laid out as v1's left one, as far as it goes without a model or a wall: it
// opens, `prepare.ts`, run as the operator runs it, takes the pack's tasks in, releases the practice
// tasks once and takes a person's label of a task, a task a session wrote stands beside the pack's
// own, and the campaign keeps its harnesses by name: the one it started with, the starter
// and the latest a session left.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import { append, read } from "../src/kernel/log.ts";
import { priceKey } from "../src/kernel/meter.ts";
import { latestBuilt, promoted } from "../src/kernel/reports.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { taskSets, taskVersion } from "../src/kernel/task.ts";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { openHarness } from "../src/solve/harness.ts";
import { codeOf, starter, keptAs, LIMITS, openCampaign, packNamed } from "../tools/d2/campaign.ts";
import { importCommand } from "../tools/d2/import.ts";
import { settingNamed } from "../tools/d2/setting.ts";
import { capNamed, ROUND_OPTIONS, roundCommand, reportLines } from "../tools/d2/round.ts";
import { sessionCommand } from "../tools/d2/session.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-campaign-")));
const bundle = join(root, "bundle");
const ARGS = { root, sweep: "s", cycle: "c01", bundle, name: NAME };
/** A campaign whose solves were made before any setting was recorded. */
const EARLIER = `${NAME}-earlier`;
/** A Builder a backend serves, for a command that is to get as far as its admission: a model no
 *  backend serves is refused with the command's other flags, before the log is asked anything. */
const SERVED = "claude/claude-opus-5-5";
/** A campaign whose recorded setting names the tasks to score. */
const RECORDED = `${NAME}-recorded`;
/** A campaign opened and given a harness before it keeps any. */
const FRESH = `${NAME}-fresh`;
const ASKED = { solves: 2, level: 0.02, trigger: 0.25 };
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
  for (const name of [NAME, EARLIER, RECORDED, FRESH]) {
    rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
  }
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

describe("the code a solve's condition records", () => {
  // The stack review at 658a933b (finding 6): the host was `src` and `vendor` alone, and `typebox`,
  // which builds the solver's bash schema, could change under one setting id.
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "ana-code-of-")));
  afterAll(() => rmSync(tree, { recursive: true, force: true }));
  const pinned = { typebox: "1.3.27", "cross-spawn": "7.0.6" };
  const lock = {
    workspaces: { "": { name: "a", dependencies: pinned, devDependencies: { oxlint: "1.0.0" } } },
    packages: {
      typebox: ["typebox@1.3.27", "", {}, "sha512-a"],
      "cross-spawn": ["cross-spawn@7.0.6", "", { dependencies: { which: "^2.0.1" } }, "sha512-b"],
      // The production tree's copy sits under its parent's key; the hoisted one is a dev tool's.
      "cross-spawn/which": ["which@2.0.2", "", {}, "sha512-c"],
      oxlint: ["oxlint@1.0.0", "", { dependencies: { which: "^1.0.0" } }, "sha512-d"],
      which: ["which@1.3.1", "", {}, "sha512-e"],
    },
  };
  for (const part of ["src", "vendor"]) mkdirSync(join(tree, part));
  writeFileSync(join(tree, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(tree, "package.json"), JSON.stringify({ dependencies: pinned }));
  const hostWith = (packages: Record<string, readonly (string | JsonObject)[]>) => {
    writeFileSync(
      join(tree, "bun.lock"),
      JSON.stringify({ ...lock, packages: { ...lock.packages, ...packages } }),
    );
    return codeOf(tree).host;
  };

  it("moves with a production package the lockfile resolves, and not with a dev tool's or a document", () => {
    const host = hostWith({});
    expect(hostWith({ typebox: ["typebox@1.3.28", "", {}, "sha512-f"] })).not.toBe(host);
    expect(hostWith({ "cross-spawn/which": ["which@2.0.3", "", {}, "sha512-g"] })).not.toBe(host);
    expect(
      hostWith({ oxlint: ["oxlint@1.0.1", "", { dependencies: { which: "^1.0.0" } }, "sha512-h"] }),
    ).toBe(host);
    expect(hostWith({ which: ["which@1.3.2", "", {}, "sha512-i"] })).toBe(host);
    hostWith({});
    mkdirSync(join(tree, "docs"));
    writeFileSync(join(tree, "docs", "plan.md"), "a row\n");
    expect(codeOf(tree).host).toBe(host);
  });
});

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
    // Where a Node program of a kept tree ends its walk for its module type, short of the
    // checkout's manifest (`commandReadAllows`, `test/solve-sandbox.test.ts`).
    expect(readFileSync(join(dirname(campaign.log), "package.json"), "utf8")).toBe("{}\n");

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

  it("names its pack by four flags together, or by none where its own log drafted its exam", () => {
    expect(packNamed(ARGS)).toEqual(ARGS);
    // Three of the four name no pack, and a command says what else it needs.
    expect(() => packNamed({ ...ARGS, cycle: undefined }, " and --session")).toThrow(
      "name --root, --sweep, --cycle, --bundle, --name and --session",
    );
    expect(() => packNamed({ root, sweep: "s", cycle: "c01", bundle })).toThrow("--name");
    // By its name alone a campaign opens over the exam its log holds, and this one's holds none.
    expect(() => packNamed({ name: NAME })).toThrow(
      `campaign ${NAME} holds no exam of its own, which only a campaign that opened from a prompt drafts`,
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
    // A comparison is made against the campaign's reference harness, which is the starter until
    // the operator promotes another.
    expect(ROUND_OPTIONS.reference.default).toBe("promoted");
    expect(await keptAs(campaign, "--reference", "promoted")).toEqual(least);
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

  it("keeps a harness's control: the starter with that harness's installed programs alone", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    const least = await starter(campaign);
    // A harness as a session keeps one: a guide, and its tool tree by a link to the copy beside it.
    const tree = join(campaign.states, "tree-one");
    mkdirSync(join(tree, "bin"), { recursive: true });
    writeFileSync(join(tree, "bin", "engine"), "#!/bin/sh\necho engine\n", { mode: 0o755 });
    const made = join(root, "made");
    cpSync(least.dir, made, { recursive: true });
    writeFileSync(join(made, "agent", "BUILT_AGENTS.md"), "Run engine first.\n");
    const place = async (from: string) => {
      const { digest } = await openHarness(from);
      const dir = join(campaign.states, digest);
      cpSync(from, dir, { recursive: true, verbatimSymlinks: true });
      return { dir, digest };
    };
    // The link is made where the states are, since it names the tree relatively.
    const staged = join(campaign.states, "staged");
    cpSync(made, staged, { recursive: true });
    symlinkSync(join("..", "tree-one"), join(staged, ".toolchain"));
    const built = await place(staged);
    rmSync(staged, { recursive: true });

    const control = await keptAs(campaign, "--new", `programs-of:${built.digest}`);
    const opened = await openHarness(control.dir);
    // The programs and nothing else: no guide, no tool, and so neither the starter nor the harness.
    expect(opened.guide).toBeNull();
    expect(opened.kinds.size).toBe(0);
    expect(opened.toolTree).toBe(join(control.dir, ".toolchain"));
    expect(readFileSync(join(control.dir, ".toolchain", "bin", "engine"), "utf8")).toContain("echo engine");
    expect(new Set([control.digest, built.digest, least.digest]).size).toBe(3);
    expect(control.dir).toBe(join(campaign.states, control.digest));
    // Asked for again it is the same harness, and nothing half-made is left among the states.
    expect(await keptAs(campaign, "--reference", `programs-of:${built.digest}`)).toEqual(control);
    const kept = readdirSync(campaign.states);
    expect(kept).toContain(control.digest);
    expect(kept.filter((name) => name.startsWith("control-"))).toEqual([]);
    // A harness that installed nothing has no control but the starter.
    await expect(keptAs(campaign, "--new", "programs-of:starter")).rejects.toThrow(
      `${least.digest} installed no program, so the control for its programs is the starter itself`,
    );
  });

  it("imports a harness built elsewhere, kept as a session keeps one, and records where it came from", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    const least = await starter(campaign);
    // A harness as a campaign hands one over (`close.ts`): a folder that stands by itself, with
    // its programs under `.toolchain` as files and no link.
    const handed = join(root, "handed", "harness");
    cpSync(least.dir, handed, { recursive: true });
    writeFileSync(join(handed, "agent", "BUILT_AGENTS.md"), "Imported: run the engine, then record.\n");
    mkdirSync(join(handed, ".toolchain", "bin"), { recursive: true });
    writeFileSync(join(handed, ".toolchain", "bin", "engine"), "#!/bin/sh\necho engine\n", { mode: 0o755 });
    const { digest } = await openHarness(handed);
    const flags = ["--name", NAME, "--harness", handed];
    const was = { latest: latestBuilt(read(campaign.log)), promoted: promoted(read(campaign.log)) };
    const trees = () => readdirSync(campaign.states).filter((name) => name.startsWith("tree-")).length;
    const treesBefore = trees();
    const imported = await importCommand([...flags, "--note", "epoch 0: the engine harness"]);
    expect(imported).toEqual({ digest, dir: join(campaign.states, digest) });
    // Kept under its digest with its programs in a tree beside it, named by a link, as `snapshot`
    // keeps a session's state; and every flag that names a kept harness opens it.
    expect(lstatSync(join(imported.dir, ".toolchain")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(imported.dir, ".toolchain", "bin", "engine"), "utf8")).toContain("echo engine");
    expect(await keptAs(campaign, "--parent", digest)).toEqual(imported);
    expect(await keptAs(campaign, "--reference", `programs-of:${digest}`)).not.toEqual(imported);
    // The record says where it came from. The import is no session: `latest` is unmoved, and so
    // is the reference, which `promote.ts` alone moves.
    const events = read(campaign.log).filter(({ kind }) => kind === "harness.imported");
    // The origin by its last two segments, since the closing report prints it and leaves the host.
    expect(events.map(({ data }) => data)).toEqual([
      { harness: digest, from: join("handed", "harness"), note: "epoch 0: the engine harness" },
    ]);
    expect({ latest: latestBuilt(read(campaign.log)), promoted: promoted(read(campaign.log)) }).toEqual(was);
    // Imported again it is the same harness, and nothing is recorded or left half-made.
    expect(await importCommand(flags)).toEqual(imported);
    expect(read(campaign.log).filter(({ kind }) => kind === "harness.imported")).toHaveLength(1);
    // A folder that is no harness is refused, and nothing of it is left among the states.
    const stray = join(root, "stray");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "note.txt"), "not a harness\n");
    await expect(importCommand(["--name", NAME, "--harness", stray])).rejects.toThrow();
    expect(readdirSync(campaign.states).filter((name) => name.startsWith("importing-"))).toEqual([]);
    // One tree for the one import, whatever a session or a control kept beside it.
    expect(trees()).toBe(treesBefore + 1);
    expect(importCommand(["--name", "never-opened", "--harness", handed])).rejects.toThrow(
      "has no folder yet",
    );
  });

  it("imports a harness with programs into a campaign that keeps nothing yet", async () => {
    // Until 11 October the copy of its programs was made before the campaign had a folder of states.
    layOut();
    await openCampaign({ ...ARGS, name: FRESH });
    const handed = join(root, "fresh", "harness");
    const engine = join(".toolchain", "bin", "engine");
    cpSync(FIXTURE, handed, { recursive: true });
    mkdirSync(dirname(join(handed, engine)), { recursive: true });
    writeFileSync(join(handed, engine), "#!/bin/sh\necho engine\n", { mode: 0o755 });
    const imported = await importCommand(["--name", FRESH, "--harness", handed]);
    expect(readFileSync(join(imported.dir, engine), "utf8")).toContain("echo engine");
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

  it("starts no paid comparison without a dollar cap, and prints each harness by itself in words", async () => {
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
    // Fix row F43: a cap that is no number above nothing held nothing, and is refused wherever a
    // cap is read: by a round, a checkpoint, a session by itself and the launcher.
    for (const [cap, reserve] of [
      ["$40", "10"],
      ["0", "10"],
      ["40", "-1"],
      ["forty", "10"],
    ] as const) {
      expect(() => capNamed({ cap, reserve }, "scripted")).toThrow(
        `--cap ${cap} --reserve ${reserve}: a cap and its reserve are dollars as plain numbers, each above nothing`,
      );
    }
    await expect(
      sessionCommand([...flags, "--session", "z-8", "--builder", "faux/none", "--cap", "$40"]),
    ).rejects.toThrow("--cap $40 --reserve 10: a cap and its reserve are dollars as plain numbers");
    // A simulation's seats are scripts, which are paid nothing, and may name none.
    expect(capNamed({ reserve: "10" }, "scripted")).toBeUndefined();
    expect(capNamed({ cap: "40", reserve: "5" }, "scripted")).toEqual({ dollars: 40, reserve: 5 });
    // What a report says of each harness by itself is printed in words: the tasks by how many of
    // their solves were valid. For the first round the reference harness is the starter, and
    // these lines are what its gate reads. Until 2026-10-11 the same solves were also read at
    // each shorter `--budget`, and a report held a row for each; the flag is refused since.
    expect(
      reportLines({ valid: { old: [2, 1, 5], fresh: [0, 1, 7] }, objective: null, frontier: null }),
    ).toEqual([
      "each harness by itself, as how many tasks had 0, 1, 2 valid answers in 2 solves (a count of tasks a column, not a share):",
      "  at its limits: reference 2/1/5, new 0/1/7",
    ]);
    expect(reportLines({ valid: null, objective: null, frontier: null })).toEqual([]);
    // Every reading says how many of the frontier's tasks were untied and the least share of them it
    // detects four times in five, or none where they are fewer than the least sweep.
    const frontier = {
      tasks: ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"],
      aside: [],
      wins: 4,
      losses: 0,
      ties: 4,
      p: 0.0625,
      differences: [2, 2, 2, 2, 0, 0, 0, 0],
      detectable: 0.95,
      falseRate: 0.01953125,
    };
    const valid = { old: [8, 0, 0], fresh: [4, 0, 4] };
    expect(reportLines({ valid, objective: null, frontier }).slice(0, 2)).toEqual([
      "the step is read on 8 frontier tasks, 4 of them untied: one reading at the comparison's level detects four times in five a harness that wins 95% of them",
      // Beside the level, the rule's own rate: four untied tasks a stage promote equal harnesses 2%.
      "an attempt at these margins, this reading and a repeat alike, promotes between equal harnesses 2% of the time: the level is one reading's, and this the rule's",
    ]);
    expect(
      reportLines({ valid, objective: null, frontier: { ...frontier, detectable: null } }).at(0),
    ).toEndWith("detects four times in five no share of them");
    expect(ROUND_OPTIONS).not.toHaveProperty("budget");
    // Where the comparison fixed an objective, how many tallied tasks it decided is said beside.
    expect(
      reportLines({
        valid: { old: [0, 0, 2], fresh: [0, 0, 2] },
        frontier: null,
        objective: { direction: "lower", margin: 0.01, decided: 1 },
      }).at(-1),
    ).toBe("the objective (lower is better, margin 0.01) decided 1 task that validity alone would have tied");
    const campaign = await openCampaign(ARGS);
    expect(read(campaign.log).some(({ data }) => data.session === "z-8")).toBe(false);
  });
  it("refuses a paid comparison started by hand where a launch of it would be refused", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [
      ...Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]),
      // From the starter: an earlier case left the latest kept state one that no longer opens.
      "--cap",
      "100",
      "--parent",
      "starter",
    ];
    // The campaign's checker has never been read, which only the launcher refused until 2026-10-09.
    const unread = "the campaign's checker has never been read: run tools/c/accept.ts";
    await expect(roundCommand([...flags, "--session", "z-5", "--builder", SERVED])).rejects.toThrow(unread);
    const ran = Bun.spawnSync({
      cmd: [
        capturedExecPath,
        "tools/d2/checkpoint.ts",
        "--id",
        "z-5",
        "--new",
        "starter",
        ...flags.slice(0, -2),
      ],
      cwd: REPO,
    });
    expect(ran.exitCode).not.toBe(0);
    expect(ran.stderr.toString()).toContain(unread);
    // A rehearsal's seats are scripts, and it is exempt: it gets as far as its Builder's seat.
    await expect(
      roundCommand([...flags, "--session", "z-5"], () => ({
        builder: null,
        setting: "s",
        solve: () => Promise.reject(new Error("no solve is asked for")),
      })),
    ).rejects.toThrow("name --builder");
    expect(read(campaign.log).some(({ data }) => data.session === "z-5")).toBe(false);
  });

  it("runs a Builder session by itself under a cap, and refuses one by hand as a launch would", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [
      ...Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]),
      "--parent",
      "starter",
      "--session",
      "z-6",
    ];
    await expect(sessionCommand([...flags, "--builder", "faux/none"])).rejects.toThrow(
      "name --cap, the billed dollars",
    );
    // A comparison's flags are none of a session's: it scores nothing and is read against nothing.
    await expect(sessionCommand([...flags, "--cap", "100", "--solves", "2"])).rejects.toThrow("--solves");
    // On a checker nobody has read its practice solves would be judged by checks nobody has seen.
    await expect(sessionCommand([...flags, "--cap", "100", "--builder", SERVED])).rejects.toThrow(
      "the campaign's checker has never been read: run tools/c/accept.ts",
    );
    // A rehearsal's seats are scripts: it is exempt, and is seated against the campaign's
    // reference harness, which is the starter until a promotion.
    const against: string[] = [];
    const seats = (opened: { readonly log: string }, given: { readonly reference: string }) => {
      expect(opened.log).toBe(campaign.log);
      against.push(given.reference);
      return { builder: null, setting: "s", solve: () => Promise.reject(new Error("no solve is asked for")) };
    };
    await expect(sessionCommand(flags, seats)).rejects.toThrow("name --builder");
    expect(against).toEqual([(await starter(campaign)).dir]);
    expect(read(campaign.log).some(({ data }) => data.session === "z-6")).toBe(false);
  });

  it("refuses a labels file with an entry that is no label, and a --target that is no count", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]);
    const run = (...cmd: string[]) => Bun.spawnSync({ cmd: [capturedExecPath, ...cmd, ...flags], cwd: REPO });
    // A mistyped label is not read as no label: the file is refused by the entry, before anything
    // is settled. An empty entry is one still to be labelled.
    const dir = join(campaign.log, "..", "settle-z-7");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "labels.json"),
      JSON.stringify({ rejections: { "s-1": "earnd", "s-2": "", "s-3": "earned" }, passes: {} }),
    );
    const settled = run("tools/d2/settle.ts", "--session", "z-7");
    expect(settled.exitCode).not.toBe(0);
    expect(settled.stderr.toString()).toContain(
      'holds what is no label (earned, check-defect, unclear) for 1 answer: s-1: "earnd"',
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

  it("records a promotion on the operator's word, and compares against the promoted harness from then on", async () => {
    const campaign = await openCampaign(ARGS);
    const least = await starter(campaign);
    // A harness a session could have frozen: the starter with a guide of its own.
    const made = join(root, "made");
    cpSync(least.dir, made, { recursive: true });
    writeFileSync(join(made, "agent", "BUILT_AGENTS.md"), "Multiply the base by six.\n");
    const { digest } = await openHarness(made);
    cpSync(made, join(campaign.states, digest), { recursive: true });
    const promote = (...more: string[]) => {
      const cmd = [capturedExecPath, "tools/d2/promote.ts", "--name", NAME, ...more];
      const ran = Bun.spawnSync({ cmd, cwd: REPO });
      return `${ran.stdout.toString()}${ran.stderr.toString()}`;
    };
    const promotions = () =>
      read(campaign.log).flatMap(({ kind, data }) => (kind === "harness.promoted" ? [data] : []));
    // Asked without the operator's word, it says what the log holds and records nothing.
    const asked = promote("--harness", digest);
    expect(asked).toContain("the reference harness is the starter");
    expect(asked).toContain(`no comparison on record measured ${digest}`);
    expect(asked).toContain("nothing is recorded without --yes");
    expect(promotions()).toEqual([]);
    expect(promote("--harness", digest.slice(0, 8))).toContain("is no harness this campaign keeps");
    // Fix row F28: the plan promotes a step that was read again and did not lose at the full
    // limit, and a harness no comparison measured is refused the word alone.
    const refused = promote("--harness", digest, "--yes");
    expect(refused).toContain(
      `the plan would not promote it now: harness ${digest.slice(0, 8)} has not read a step and its repeat against the reference harness`,
    );
    expect(refused).toContain("not promoted: a step is promoted once it was read again");
    expect(promotions()).toEqual([]);
    // The choice stays the operator's, with a reason: the promotion is an event that keeps it,
    // and the reference harness is read from it.
    const despite = "the record is under test";
    expect(promote("--harness", digest, "--yes", "--despite", despite)).toContain(
      "is the reference harness from here on",
    );
    expect(promotions()).toEqual([{ harness: digest, from: least.digest, rests: [], despite }]);
    expect((await keptAs(campaign, "--reference", "promoted")).digest).toBe(digest);
    expect(promote("--harness", digest, "--yes")).toContain("is the campaign's reference harness already");
    expect(promotions()).toHaveLength(1);
    // A round that names no --reference is made against it, where it was made against the starter.
    const against: string[] = [];
    const flags = [
      ...Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]),
      "--cap",
      "100",
      "--parent",
      "starter",
      "--session",
      "z-3",
    ];
    const seats = (opened: { readonly log: string }, given: { readonly reference: string }) => {
      expect(opened.log).toBe(campaign.log);
      against.push(given.reference);
      return { builder: null, setting: "s", solve: () => Promise.reject(new Error("no solve is asked for")) };
    };
    await expect(roundCommand(flags, seats)).rejects.toThrow("name --builder");
    await expect(roundCommand([...flags, "--reference", "starter"], seats)).rejects.toThrow("name --builder");
    expect(against).toEqual([join(campaign.states, digest), least.dir]);
    // The starter named again returns the campaign to it.
    promote("--harness", "starter", "--yes");
    expect(await keptAs(campaign, "--reference", "promoted")).toEqual(least);
  });

  it("opens under the limits and the solver a setting names, each another setting of its own", async () => {
    const plain = await openCampaign(ARGS);
    expect(plain.limits).toEqual(LIMITS);
    // A command that names nothing runs under the setting every campaign ran under before the flags existed.
    const unnamed = await openCampaign({ ...ARGS, ...settingNamed({}) });
    expect(unnamed.setting(unnamed.test)).toBe(plain.setting(plain.test));
    const longer = await openCampaign({
      ...ARGS,
      ...settingNamed({ "solve-minutes": "240" }),
    });
    expect(longer.limits).toEqual({ ...LIMITS, wallSeconds: 14_400 });
    expect(longer.setting(longer.test)).not.toBe(plain.setting(plain.test));
    const turned = await openCampaign({ ...ARGS, ...settingNamed({ "solve-model-turns": "40" }) });
    expect(turned.setting(turned.test)).not.toBe(plain.setting(plain.test));
  });

  it("runs every command under the campaign's recorded setting, and refuses one that names another", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [
      ...Object.entries(ARGS).flatMap(([flag, value]) => [`--${flag}`, value]),
      "--cap",
      "100",
      "--parent",
      "starter",
      "--session",
      "z-4",
    ];
    // A wall the owner refuses is refused by each command before a campaign is opened.
    const refused = "--solve-minutes 0: a solve's wall is a whole number of minutes";
    await expect(roundCommand([...flags, "--solve-minutes", "0"])).rejects.toThrow(refused);
    const checkpoint = (...more: string[]) =>
      Bun.spawnSync({
        cmd: [capturedExecPath, "tools/d2/checkpoint.ts", "--id", "z-4", ...flags.slice(0, -4), ...more],
        cwd: REPO,
      });
    expect(checkpoint("--solve-minutes", "0").stderr.toString()).toContain(refused);
    // The setting an earlier command recorded: an eight-minute wall and forty model turns.
    append(campaign.log, "campaign.setting", {
      solver: null,
      minutes: 8,
      turns: 24,
      modelTurns: 40,
      tasks: null,
      target: 12,
    });
    // A rehearsal's seats see the campaign the command opened: with no flag, it is the recorded one.
    const seen: number[] = [];
    const seats = (opened: Awaited<ReturnType<typeof openCampaign>>) => {
      seen.push(opened.limits.wallSeconds, opened.limits.modelTurns ?? 0);
      return { builder: null, setting: "s", solve: () => Promise.reject(new Error("no solve is asked for")) };
    };
    await expect(roundCommand(flags, seats)).rejects.toThrow("name --builder");
    expect(seen).toEqual([480, 40]);
    // A flag that names another is refused by every command, before anything is opened or logged.
    const other =
      "--solve-minutes 5 names another setting than the campaign's, which was recorded as --solve-minutes 8";
    await expect(roundCommand([...flags, "--solve-minutes", "5"], seats)).rejects.toThrow(other);
    expect(checkpoint("--solve-minutes", "5").stderr.toString()).toContain(other);
    // No word changes it: `--new-setting` is no flag since 2026-10-11, and another setting is
    // another campaign.
    await expect(roundCommand([...flags, "--solve-minutes", "5", "--new-setting"], seats)).rejects.toThrow(
      "--new-setting",
    );
    expect(seen).toEqual([480, 40]);
    const kept = read(campaign.log).filter(({ kind }) => kind === "campaign.setting");
    expect(kept.map(({ data }) => data.minutes)).toEqual([8]);
    expect(read(campaign.log).some(({ data }) => data.session === "z-4")).toBe(false);
  });

  // Fix row F47: `prepare.ts` read the recorded target and not the recorded tasks, so its draw
  // could release for practice a task the campaign's setting names to score, for good.
  it("releases for practice no task the campaign's recorded setting names to score", async () => {
    const campaign = await openCampaign({ ...ARGS, name: RECORDED });
    const prepared = (practice: string) => {
      const flags = Object.entries({ ...ARGS, name: RECORDED, practice }).flatMap(([flag, value]) => [
        `--${flag}`,
        value,
      ]);
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/d2/prepare.ts", ...flags], cwd: REPO });
      return `${ran.stdout.toString()}${ran.stderr.toString()}`;
    };
    expect(prepared("0")).toContain("7 held out, 0 released for practice");
    const scored = ["t-1", "t-2", "t-3", "t-4"];
    append(campaign.log, "campaign.setting", {
      solver: null,
      minutes: 120,
      turns: 24,
      modelTurns: null,
      tasks: scored,
      target: 12,
    });
    // Three are asked for, and half of the three tasks the record does not name is one.
    expect(prepared("3")).toContain(
      "practice is 2 short of 3: a release takes at most half of the 3 held out and not named to score",
    );
    const packages = campaign.packages();
    const released = taskSets(read(campaign.log)).released.map((version) => packages.get(version)?.taskId);
    expect(released).toHaveLength(1);
    expect(released.filter((taskId) => scored.includes(taskId ?? ""))).toEqual([]);
  });

  // Recode ran on 9 October with its solver held to 15 of its own turns, and its log holds no
  // record of a setting: the first command of this source there has to name what it ran under.
  it("holds the first record of a campaign that already holds solves to what they ran under", async () => {
    const campaign = await openCampaign({ ...ARGS, name: EARLIER });
    const { model, effort } = campaign.test;
    // One test-side solve by the cycle's own solver, under an eight-minute wall and 15 model turns.
    const condition: Condition = {
      contract: "c1",
      harness: "h1",
      task: "v1",
      model: priceKey(model),
      effort,
      prices: { [priceKey(model)]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      runtime: {},
      compaction: "off",
      solverTools: "h1",
      verifierTools: "t1",
      sandbox: "p1",
      limits: { ...LIMITS, wallSeconds: 480, modelTurns: 15 },
      host: "h",
      side: "test",
    };
    append(campaign.log, "solve.started", {
      solve: "s-1",
      condition: recordCondition(campaign.log, condition),
    });
    const flags = [
      ...Object.entries({ ...ARGS, name: EARLIER }).flatMap(([flag, value]) => [`--${flag}`, value]),
      "--cap",
      "100",
      "--parent",
      "starter",
      "--builder",
      SERVED,
    ];
    const refusal = "the campaign's log records no setting yet, and this command names another";
    const was = `which was --solver ${priceKey(model)} --solver-effort ${effort} --solve-minutes 8 --solve-model-turns 15`;
    /** What a command refused with, or nothing where it ran. */
    const refused = (ran: Promise<unknown>) => ran.then(() => "", errorMessage);
    // A round and a session by itself, each started by hand with the setting left out.
    const round = await refused(roundCommand([...flags, "--session", "z-1"]));
    expect(round).toContain(refusal);
    expect(round).toContain(was);
    expect(await refused(sessionCommand([...flags, "--session", "z-2"]))).toContain(was);
    // Named as its solves ran, the setting is free to be recorded; what still refuses is the rest.
    const named = [...flags, "--solve-minutes", "8", "--solve-model-turns", "15"];
    const rest = await refused(roundCommand([...named, "--session", "z-1"]));
    expect(rest).toContain("the log holds no held-out task to score");
    expect(rest).not.toContain(refusal);
    expect(read(campaign.log).some(({ kind }) => kind === "campaign.setting")).toBe(false);
  });
});

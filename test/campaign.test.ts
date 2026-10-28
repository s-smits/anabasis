// A campaign over a sweep laid out as v1's left one, as far as it goes without a model or a wall: it
// opens, `prepare.ts`, run in this process as the operator runs it, takes the pack's tasks in, releases the practice
// tasks once and takes a person's label of a task, a task a session wrote stands beside the pack's
// own, and the campaign keeps its harnesses by name: the one it started with, the starter
// and the latest a session left.
import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { latestBuilt, PATIENCE, promoted } from "../src/kernel/reports.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { taskSets, taskVersion } from "../src/kernel/task.ts";
import { TOOL_TREE_DIR } from "../src/meta/bundle-layout.ts";
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
import { runtimeProcess } from "../src/meta/process.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { openHarness } from "../src/harness/open.ts";
import { codeOf, starter, keptAs, openCampaign } from "../tools/d2/campaign.ts";
import { checkpointCommand } from "../tools/d2/checkpoint.ts";
import { importCommand } from "../tools/d2/import.ts";
import { prepareCommand } from "../tools/d2/prepare.ts";
import { promoteCommand } from "../tools/d2/promote.ts";
import {
  capNamed,
  packaged,
  refereeNamed,
  ROUND_OPTIONS,
  roundCommand,
  reportLines,
} from "../tools/d2/round.ts";
import { sessionCommand } from "../tools/d2/session.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-campaign-")));
const bundle = join(root, "bundle");
const ARGS = { root, sweep: "s", cycle: "c01", bundle, name: NAME };
/** A Builder a backend serves, for a command that is to get as far as its admission: a model no
 *  backend serves is refused with the command's other flags, before the log is asked anything. */
const SERVED = "claude/claude-opus-5-5";
/** A campaign opened and given a harness before it keeps any. */
const FRESH = `${NAME}-fresh`;
/** Campaigns whose checks pass, and reject, the stored sweep's accepted answer. */
const PROVEN = `${NAME}-proven`;
const UNPROVEN = `${NAME}-unproven`;
const ASKED = { level: 0.02, patience: PATIENCE };
const TASKS = Array.from({ length: 7 }, (_, index) => ({
  taskId: `t-${String(index + 1)}`,
  family: "fixture",
  publicInput: { base: index + 2 },
  hidden: null,
}));
/** The flags that name the campaign and its pack, as a command line carries them. */
const flagsOf = (named: Record<string, string>) =>
  Object.entries(named).flatMap(([flag, value]) => [`--${flag}`, value]);
const PACK = flagsOf(ARGS);

// A test here runs a campaign's commands as the operator does, in this process, and each start
// reads the host's source tree whole: over a second, so three of them pass Bun's own five.
setDefaultTimeout(60_000);

/** What a command printed, and the message it refused with where it did. */
async function said(command: (args: readonly string[]) => Promise<number>, args: readonly string[]) {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  try {
    await command(args);
  } catch (error) {
    lines.push(errorMessage(error));
  } finally {
    log.mockRestore();
  }
  return lines.join("\n");
}

/** A rehearsal's seats, which get as far as the Builder's seat and note what the command opened. */
const rehearsal =
  (seen: (opened: Awaited<ReturnType<typeof openCampaign>>, given: { readonly reference: string }) => void) =>
  (opened: Awaited<ReturnType<typeof openCampaign>>, given: { readonly reference: string }) => {
    seen(opened, given);
    return { builder: null, setting: "s", solve: () => Promise.reject(new Error("no solve is asked for")) };
  };

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of [NAME, FRESH, PROVEN, UNPROVEN]) {
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
  mkdirSync(join(bundle, TOOL_TREE_DIR, "bin"), { recursive: true });
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

  it("moves when command code that executes a campaign changes, and not for a reader's or a development tool's", () => {
    for (const [part, moves] of [
      ["tools/d2", true],
      ["tools/c", true],
      ["tools/d1b", true],
      ["tools/runs", false],
      ["tools/wri", false],
      ["tools/oxlint", false],
      ["tools/loc", false],
      ["tools/runtime", false],
    ] as const) {
      mkdirSync(join(tree, part), { recursive: true });
      const file = join(tree, part, "command.ts");
      writeFileSync(file, "export const a = 1;\n");
      const host = codeOf(tree).host;
      writeFileSync(file, "export const a = 2;\n");
      expect(codeOf(tree).host !== host).toBe(moves);
    }
  });
});

describe("a campaign", () => {
  /** `prepare.ts` as the operator runs it, with whatever flags `more` adds, and what it printed. */
  const prepare = async (...more: string[]) =>
    await said(prepareCommand, [...PACK, "--practice", "2", ...more]);

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

    // A session's lookup, read before the Examiner beside it writes (`packaged`).
    const packageOf = packaged(campaign);
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
    const [proposed, ...lines] = (await prepare()).split("\n");
    expect(proposed).toBe("7 of the pack's tasks proposed: 7 held out, 0 refused");
    expect(
      lines.slice(0, 2).every((line) => line.endsWith(": released for practice, and never scored")),
    ).toBe(true);
    expect(lines.slice(2).join("\n")).toBe(summary);
    const sets = taskSets(read(campaign.log));
    expect([sets.held.length, sets.released.length]).toEqual([6, 2]);
    expect([...sets.held, ...sets.released].toSorted()).toEqual([...versions, extra].toSorted());
    expect(read(campaign.log).filter(({ kind }) => kind === "anchor.drawn")).toEqual([]);
    const packages = campaign.packages();
    expect(packages.get(extra)).toMatchObject({ taskId: "x-1-001", hidden: { seed: 1 }, ruleIds: ["R1"] });
    expect(versions.every((version) => packages.has(version))).toBe(true);
    // Until 18 October the lookup held the map of its start, and a practice solve of this task ended
    // the Builder's conversation crashed in three campaigns on 17 October.
    expect(packageOf(extra)).toMatchObject({ taskId: "x-1-001" });
    // A second run proposes and releases nothing.
    const events = read(campaign.log).length;
    expect(await prepare()).toBe(summary);
    expect(read(campaign.log)).toHaveLength(events);
    // Asked for no more practice than there is, it says what a comparison of the size asked for can show.
    expect(await prepare("--target", "3")).toBe(
      ["6 held out, 2 released for practice", ...sizeLines(3, ASKED)].join("\n"),
    );
  });

  it("takes a person's label of a held-out task: kept in the scored set, or refused as infeasible", async () => {
    const campaign = await openCampaign(ARGS);
    const packages = campaign.packages();
    const [kept = "", gone = ""] = taskSets(read(campaign.log)).held;
    const idOf = (version: string) => packages.get(version)?.taskId ?? "";
    const told = await prepare(
      "--keep",
      idOf(kept),
      "--infeasible",
      idOf(gone),
      "--note",
      "no member carries it",
    );
    expect(told).toStartWith(
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
    expect(await prepare("--practice", "4", "--keep", idOf(kept))).toContain("5 held out, 2 released");
    expect(taskSets(read(campaign.log)).released).toHaveLength(2);
    // Only a held-out task is labelled: not a refused one, a practice task or a name no task has.
    expect(await prepare("--keep", idOf(gone))).toContain("is no held-out task of this campaign");
    expect(await prepare("--infeasible", idOf(sets.released[0] ?? ""))).toContain("is no held-out task");
    expect(await prepare("--keep", "t-99")).toContain("t-99 is no held-out task of this campaign");
  });

  it("starts from the Starter Built Harness, and keeps it and the latest a session left, each by name", async () => {
    const campaign = await openCampaign(ARGS);
    // The starter is a harness like any other: it opens, with pi's four coding tools selected, the
    // starter instructions as its guide and no tool of its own, and it is kept under its digest
    // among the campaign's states.
    const least = await starter(campaign);
    const opened = await openHarness(least.dir);
    expect(least).toEqual({ dir: join(campaign.states, opened.digest), digest: opened.digest });
    expect(opened.guide).toContain("# Operating Guide");
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
    // The letter the view prints names the one digest the log gave it (`namesOf`): b-1's harness is
    // B, the second the log names. A letter the log gave nothing is refused as any other name is.
    expect(await keptAs(campaign, "--harness", "B")).toEqual(built);
    await expect(keptAs(campaign, "--harness", "C")).rejects.toThrow(
      "--harness C is no harness this campaign keeps",
    );
    // A tool tree kept beside the states (`tree-*`) is no harness, so a refusal lists only digests.
    mkdirSync(join(campaign.states, "tree-x"));
    await expect(keptAs(campaign, "--harness", "C")).rejects.toThrow(
      `whole: ${[digest, least.digest].sort().join(", ")}.`,
    );
    await expect(keptAs(campaign, "--parent", "tree-x")).rejects.toThrow("is no harness this campaign keeps");
    // A kept state that has changed is no longer the harness its name says, and is refused before
    // a solve is paid for under that name.
    writeFileSync(join(built.dir, "agent", "BUILT_AGENTS.md"), "Add first.\n");
    await expect(keptAs(campaign, "--parent", "latest")).rejects.toThrow(
      `${built.dir} no longer opens as the harness it is kept as`,
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
    mkdirSync(join(handed, TOOL_TREE_DIR, "bin"), { recursive: true });
    writeFileSync(join(handed, TOOL_TREE_DIR, "bin", "engine"), "#!/bin/sh\necho engine\n", { mode: 0o755 });
    const { digest } = await openHarness(handed);
    const flags = ["--name", NAME, "--harness", handed];
    const was = { latest: latestBuilt(read(campaign.log)), promoted: promoted(read(campaign.log)) };
    const trees = () => readdirSync(campaign.states).filter((name) => name.startsWith("tree-")).length;
    const treesBefore = trees();
    const imported = await importCommand([...flags, "--note", "epoch 0: the engine harness"]);
    expect(imported).toEqual({ digest, dir: join(campaign.states, digest) });
    // Kept under its digest with its programs in a tree beside it, named by a link, as `snapshot`
    // keeps a session's state; and every flag that names a kept harness opens it.
    expect(lstatSync(join(imported.dir, TOOL_TREE_DIR)).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(imported.dir, TOOL_TREE_DIR, "bin", "engine"), "utf8")).toContain("echo engine");
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
    await expect(importCommand(["--name", "never-opened", "--harness", handed])).rejects.toThrow(
      "has no folder yet",
    );
  });

  it("refuses a harness whose programs link outside the folder it lies in", async () => {
    // The import copies the programs from where the link resolves, as the host and outside every
    // wall; a link to the operator's home would hand that home to the next Builder.
    layOut();
    await openCampaign({ ...ARGS, name: FRESH });
    const handed = join(root, "linked", "harness");
    cpSync(FIXTURE, handed, { recursive: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(elsewhere, "bin"), { recursive: true });
    // A program of its own, so the harness is none the campaign keeps already.
    writeFileSync(join(elsewhere, "bin", "engine"), "#!/bin/sh\necho elsewhere\n", { mode: 0o755 });
    symlinkSync(elsewhere, join(handed, TOOL_TREE_DIR));
    await expect(importCommand(["--name", FRESH, "--harness", handed])).rejects.toThrow("outside");
    // A kept state's link to the tree beside it, as another campaign keeps one, is imported.
    const states = join(root, "other-states");
    const kept = join(states, "kept");
    cpSync(FIXTURE, kept, { recursive: true });
    cpSync(elsewhere, join(states, "tree-1"), { recursive: true });
    symlinkSync(join("..", "tree-1"), join(kept, TOOL_TREE_DIR));
    const imported = await importCommand(["--name", FRESH, "--harness", kept]);
    expect(readFileSync(join(imported.dir, TOOL_TREE_DIR, "bin", "engine"), "utf8")).toContain(
      "echo elsewhere",
    );
  });

  it("starts no paid comparison without a dollar cap or a Referee", async () => {
    const flags = PACK;
    await expect(roundCommand([...flags, "--session", "z-8", "--builder", "faux/none"])).rejects.toThrow(
      "name --cap, the billed dollars this comparison may hold",
    );
    await expect(checkpointCommand(["--id", "z-8", ...flags])).rejects.toThrow("name --cap");
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
    // Nor does a paid comparison start without a Referee, whose ruling a rejection waits for; a
    // simulation may name none.
    await expect(
      roundCommand([...flags, "--session", "z-8", "--builder", "faux/none", "--cap", "40"]),
    ).rejects.toThrow("name --reviewer, the Referee that rules each rejection");
    await expect(checkpointCommand(["--id", "z-8", "--cap", "40", ...flags])).rejects.toThrow(
      "name --reviewer",
    );
    expect(() => refereeNamed({ reviewer: SERVED }, "paid")).not.toThrow();
    expect(() => refereeNamed({}, "scripted")).not.toThrow();
    // Until 2026-10-11 the same solves were also read at each shorter `--budget`; the flag is
    // refused since.
    expect(ROUND_OPTIONS).not.toHaveProperty("budget");
    const campaign = await openCampaign(ARGS);
    expect(read(campaign.log).some(({ data }) => data.session === "z-8")).toBe(false);
  });

  it("prints in a report's lines the counts, shares and points it holds, and what each test is read on", () => {
    // Each harness by itself: the tasks by how many of their solves were valid. For the first round
    // the reference harness is the starter, and these are what its gate reads.
    const alone = reportLines({
      valid: { old: [2, 1, 5], fresh: [0, 1, 7], informative: { old: 0, fresh: 0 } },
      objective: null,
      frontier: null,
      noise: null,
    }).join("\n");
    expect(alone).toContain("in 2 solves");
    expect(alone).toMatch(/reference 2\/1\/5\b.*new 0\/1\/7\b/su);
    expect(reportLines({ valid: null, objective: null, frontier: null, noise: null })).toEqual([]);
    // The turns of a valid answer are said over the tasks both harnesses answered, and in no test.
    const turns = { s1: { old: null, fresh: 3 }, s2: { old: 12, fresh: 4 }, s3: { old: 10, fresh: 6 } };
    const took = reportLines({
      valid: { old: [0, 0, 3], fresh: [0, 0, 3], informative: { old: 0, fresh: 0 } },
      objective: null,
      frontier: null,
      noise: null,
      turns,
    }).at(-1);
    expect(took).toMatch(/\b2 tasks\b.*reference 11, new 5\b.*in no test/u);
    // Every reading says how many of its tallied tasks, frontier and retained together, were untied,
    // the least share of them it detects four times in five, its false rate, and, since 26 October,
    // the same tasks' tally without the bill, which a step clears as well. The share and the rate
    // are the full-score test's, an upper bound for the rule that needs both.
    const scored = {
      unsolved: 0,
      wins: 4,
      losses: 0,
      ties: 4,
      p: 0.0625,
      differences: [2, 2, 2, 2, 0, 0, 0, 0],
      unbilled: [-2, -2, -2, -2, 0, 0, 0, 0],
      detectable: 0.95,
      falseRate: 0.01953125,
    };
    const valid = { old: [8, 0, 0], fresh: [4, 0, 4], informative: { old: 0, fresh: 0 } };
    const frontier = { ...scored, tasks: ["v1", "v2", "v3", "v4", "v5", "v6", "v7"], aside: [] };
    const [size, rate, , bill] = reportLines({ valid, objective: null, scored, frontier, noise: null });
    for (const fact of ["full score", "8 tallied", "4 of them untied", "95%"]) expect(size).toContain(fact);
    for (const fact of ["full score", "2%", "upper bound"]) expect(rate).toContain(fact);
    expect(bill).toContain("0-4-4, p 1");
    // A report written before 20 October read its step, and these, on its frontier alone.
    expect(reportLines({ valid, objective: null, frontier, noise: null }).at(0)).toContain("8 tallied");
    const none = reportLines({
      valid,
      objective: null,
      scored: { ...scored, detectable: null },
      frontier,
      noise: null,
    }).at(0);
    expect(none).toContain("no share");
    expect(none).not.toMatch(/\d%/u);
    // The p beside it is the test's, which weighs margins; where every untied task is won it is the
    // count's alone (the plan's 7.5).
    const two = { ...scored, wins: 2, ties: 0, p: 0.25, differences: [4, 1], unbilled: [4, 1] };
    const p = reportLines({ valid, objective: null, scored: two, frontier: null, noise: null }).at(2);
    expect(p).toMatch(/p is 0\.25\b.*\b2 won read 0\.25\b/u);
    // The A/A beside every reading that carries one: its tie share, flip rate and least detectable
    // shift, and what the tally drew, by what became of each task (the plan's 7.2 and 7.3).
    const aa = { wins: 1, losses: 1, ties: 6, p: 0.75, differences: [1, -1, 0, 0, 0, 0, 0, 0], flips: 0.125 };
    const lines = (detectable: number | null) =>
      reportLines({
        valid,
        objective: null,
        frontier: null,
        noise: { ...aa, detectable },
        versions: ["v1", "v2", "v3", "v4", "v5", "v6"],
        aside: ["v7"],
        short: [],
        disputed: ["v8"],
        withdrawn: [],
      }).slice(0, 5);
    const [count, ties, flips, shift, drew] = lines(null);
    for (const fact of ["8 tallied", "2 of them untied"]) expect(count).toContain(fact);
    expect(ties).toContain("75%");
    expect(flips).toContain("13%");
    expect(shift).toMatch(/full score alone: none\b/u);
    expect(lines(0.9)[3]).toContain("90%");
    for (const fact of ["8 tasks", "6 were tallied", "1 set aside", "1 disputed"]) {
      expect(drew).toContain(fact);
    }
    // Where the report carries points, the weights and the points each measure gave are said beside.
    const [points, objective] = reportLines({
      valid: { old: [0, 0, 2], fresh: [0, 0, 2], informative: { old: 0, fresh: 0 } },
      frontier: null,
      objective: { direction: "lower" },
      points: { validity: -150, objective: 225, bill: 75 },
      noise: null,
    }).slice(-2);
    expect(points).toMatch(/validity 0\.6\b.*objective 0\.3\b.*bill 0\.1\b.*-150, \+225 and \+75\b/u);
    expect(objective).toContain("lower");
  });

  it("refuses a paid comparison started by hand where a launch of it would be refused", async () => {
    const campaign = await openCampaign(ARGS);
    // From the starter: an earlier case left the latest kept state one that no longer opens.
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter"];
    // The campaign's checker has never been read, which only the launcher refused until 2026-10-09.
    const unread = "the campaign's checker has never been read: run tools/c/accept.ts";
    await expect(roundCommand([...flags, "--session", "z-5", "--builder", SERVED])).rejects.toThrow(unread);
    await expect(
      checkpointCommand(["--id", "z-5", "--new", "starter", ...flags.slice(0, -2)]),
    ).rejects.toThrow(unread);
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
    const flags = [...PACK, "--parent", "starter", "--session", "z-6"];
    await expect(sessionCommand([...flags, "--builder", "faux/none"])).rejects.toThrow(
      "name --cap, the billed dollars",
    );
    await expect(sessionCommand([...flags, "--builder", "faux/none", "--cap", "100"])).rejects.toThrow(
      "name --reviewer",
    );
    // A comparison's flags are none of a session's: it scores nothing and is read against nothing.
    await expect(
      sessionCommand([...flags, "--cap", "100", "--reviewer", SERVED, "--solves", "2"]),
    ).rejects.toThrow("--solves");
    // On a checker nobody has read its practice solves would be judged by checks nobody has seen.
    await expect(
      sessionCommand([...flags, "--cap", "100", "--reviewer", SERVED, "--builder", SERVED]),
    ).rejects.toThrow("the campaign's checker has never been read: run tools/c/accept.ts");
    // A rehearsal's seats are scripts: it is exempt, and is seated against the campaign's
    // reference harness, which is the starter until a promotion.
    const against: string[] = [];
    const seats = rehearsal((opened, given) => {
      expect(opened.log).toBe(campaign.log);
      against.push(given.reference);
    });
    await expect(sessionCommand(flags, seats)).rejects.toThrow("name --builder");
    expect(against).toEqual([(await starter(campaign)).dir]);
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
    const promote = async (...more: string[]) => await said(promoteCommand, ["--name", NAME, ...more]);
    const promotions = () =>
      read(campaign.log).flatMap(({ kind, data }) => (kind === "harness.promoted" ? [data] : []));
    // Asked without the operator's word, it says what the log holds and records nothing.
    const asked = await promote("--harness", digest);
    expect(asked).toContain("the reference harness is the starter");
    // A harness the log has not named yet is said by its digest alone (`namesOf`).
    expect(asked).toContain(`no comparison on record measured harness ${digest}`);
    expect(asked).toContain("nothing is recorded without --yes");
    expect(promotions()).toEqual([]);
    expect(await promote("--harness", digest.slice(0, 8))).toContain("is no harness this campaign keeps");
    // Fix row F28: the plan promotes a harness a comparison against the reference read as a step,
    // and a harness no comparison measured is refused the word alone.
    const refused = await promote("--harness", digest, "--yes");
    expect(refused).toContain(
      `the plan would not promote it now: harness ${digest.slice(0, 8)} has no comparison that read a step against the reference harness`,
    );
    expect(refused).toContain(
      "not promoted: a harness is promoted where a comparison against the reference read a step",
    );
    expect(promotions()).toEqual([]);
    // The choice stays the operator's, with a reason: the promotion is an event that keeps it,
    // and the reference harness is read from it.
    const despite = "the record is under test";
    expect(await promote("--harness", digest, "--yes", "--despite", despite)).toContain(
      "is the reference harness from here on",
    );
    expect(promotions()).toEqual([{ harness: digest, from: least.digest, rests: [], despite }]);
    expect((await keptAs(campaign, "--reference", "promoted")).digest).toBe(digest);
    // The promotion named it, and from then on it is said by its letter beside its digest; the
    // suite's cases share one log, so which letter is theirs to say.
    expect(await promote("--harness", digest, "--yes")).toMatch(
      new RegExp(`^[A-Z]+ ${digest} is the campaign's reference harness already`, "mu"),
    );
    expect(promotions()).toHaveLength(1);
    // A round that names no --reference is made against it, where it was made against the starter.
    const against: string[] = [];
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter", "--session", "z-3"];
    const seats = rehearsal((opened, given) => {
      expect(opened.log).toBe(campaign.log);
      against.push(given.reference);
    });
    await expect(roundCommand(flags, seats)).rejects.toThrow("name --builder");
    await expect(roundCommand([...flags, "--reference", "starter"], seats)).rejects.toThrow("name --builder");
    expect(against).toEqual([join(campaign.states, digest), least.dir]);
    // The starter named again returns the campaign to it.
    await promote("--harness", "starter", "--yes");
    expect(await keptAs(campaign, "--reference", "promoted")).toEqual(least);
  });

  it("runs every command under the campaign's recorded setting, and refuses one that names another", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter", "--session", "z-4"];
    // A wall the owner refuses is refused by each command before a campaign is opened.
    const refused = "--solve-minutes 0: a solve's wall is a whole number of minutes";
    await expect(roundCommand([...flags, "--solve-minutes", "0"])).rejects.toThrow(refused);
    const checkpoint = async (...more: string[]) =>
      await checkpointCommand(["--id", "z-4", ...flags.slice(0, -4), ...more]);
    await expect(checkpoint("--solve-minutes", "0")).rejects.toThrow(refused);
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
    const seats = rehearsal((opened) => {
      seen.push(opened.limits.wallSeconds, opened.limits.modelTurns ?? 0);
    });
    await expect(roundCommand(flags, seats)).rejects.toThrow("name --builder");
    expect(seen).toEqual([480, 40]);
    // A flag that names another is refused by every command, before anything is opened or logged.
    const other =
      "--solve-minutes 5 names another setting than the campaign's, which was recorded as --solve-minutes 8";
    await expect(roundCommand([...flags, "--solve-minutes", "5"], seats)).rejects.toThrow(other);
    await expect(checkpoint("--solve-minutes", "5")).rejects.toThrow(other);
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
  // Plan item 5.3 (14 October): a pack's stored accepted answer said nothing of a task's
  // feasibility, so a task only a stored solve had answered could go to a person as infeasible.
  it("logs a held-out task feasible where a stored accepted answer passes today's checks, and no other", async () => {
    const work = join(root, "runs", "s", "c01", "t-1", "work");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "answer.json"), JSON.stringify({ answer: "12" }));
    const preparedUnder = async (name: string, check: string) => {
      const under = join(root, `bundle-${name}`);
      cpSync(bundle, under, { recursive: true });
      writeFileSync(
        join(under, "correctness-model", "evaluator.ts"),
        `export const checks = { "check-product": ${check} };\n`,
      );
      const args = { ...ARGS, bundle: under, name };
      const flags = flagsOf({ ...args, practice: "0" });
      const campaign = await openCampaign(args);
      const first = await said(prepareCommand, flags);
      return { first, again: await said(prepareCommand, flags), campaign };
    };
    const right = "(req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6)";
    const passed = await preparedUnder(PROVEN, right);
    const [version = ""] = TASKS.slice(0, 1).map((task) => taskVersion(passed.campaign.pack(task)));
    expect(passed.first).toContain(
      "t-1: a stored accepted answer passes today's verifier, so a valid answer to it is on record",
    );
    // Once on record it is not rechecked.
    expect(passed.again).not.toContain("t-1:");
    const feasible = read(passed.campaign.log).filter(({ kind }) => kind === "task.feasible");
    expect(feasible.map(({ data }) => data)).toEqual([{ version, sweep: "s" }]);
    // A recheck the checks reject establishes nothing, and says nothing.
    const rejected = await preparedUnder(UNPROVEN, "() => false");
    expect(rejected.first).not.toContain("t-1:");
    expect(read(rejected.campaign.log).filter(({ kind }) => kind === "task.feasible")).toEqual([]);
  });
});

// A campaign over the exam its log drafted, as far as it goes without a model or a wall: it opens,
// `prepare.ts`, run in this process as the operator runs it, takes the draft's tasks in, releases the
// practice tasks once and takes a person's label of a task, a task a session wrote stands beside the
// draft's own, and the campaign keeps its harnesses by name: the starter and the latest a session left.
import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { latestBuilt, PATIENCE, promoted } from "../src/kernel/reports.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { taskSets, taskVersion } from "../src/kernel/task.ts";
import { TOOL_TREE_DIR } from "../src/meta/bundle-layout.ts";
import { fixtureDraft, fixtureTasks, layOutDraft, layOutPack } from "./helpers/fixture-pack.ts";
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
import { Refused } from "../src/campaign/admission.ts";
import { codeOf, FOLLOWED, LIMITS, starter, keptAs, openCampaign, treeFault } from "../tools/d2/campaign.ts";
import { gitText } from "../src/meta/git.ts";
import { checkpointCommand } from "../tools/d2/checkpoint.ts";
import { importCommand } from "../tools/d2/import.ts";
import { prepareCommand, ungated } from "../tools/d2/prepare.ts";
import { promoteCommand } from "../tools/d2/promote.ts";
import { COMPARISON_OPTIONS, capNamed, packaged, refereeNamed, SESSION_OPTIONS } from "../tools/d2/round.ts";
import { sessionCommand } from "../tools/d2/session.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-campaign-")));
const ARGS = { name: NAME };
const SERVED = "claude/claude-opus-5-5";
const FRESH = `${NAME}-fresh`;
const PROVEN = `${NAME}-proven`;
const UNPROVEN = `${NAME}-unproven`;
const UNRECORDED = `${NAME}-unrecorded`;
const ASKED = { level: 0.02, patience: PATIENCE };
const TASKS = fixtureTasks(7);
const PACK = ["--name", NAME];
const folderOf = (name: string) => join(REPO, ".ana", "d2", name);
for (const name of [NAME, FRESH, UNRECORDED]) layOutPack(folderOf(name), TASKS, 1);

// Each start reads the host's source tree whole, over a second, so three pass Bun's own five.
setDefaultTimeout(60_000);

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

const rehearsal =
  (seen: (opened: Awaited<ReturnType<typeof openCampaign>>, given: { readonly reference: string }) => void) =>
  (opened: Awaited<ReturnType<typeof openCampaign>>, given: { readonly reference: string }) => {
    seen(opened, given);
    return { builder: null, setting: "s", solve: () => Promise.reject(new Error("no solve is asked for")) };
  };

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of [NAME, FRESH, PROVEN, UNPROVEN, UNRECORDED]) {
    rmSync(folderOf(name), { recursive: true, force: true });
  }
});

describe("the code a solve's condition records", () => {
  // `typebox`, which builds the solver's bash schema, must not change under one setting id.
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "ana-code-of-")));
  afterAll(() => rmSync(tree, { recursive: true, force: true }));
  const pinned = { typebox: "1.3.27", "cross-spawn": "7.0.6" };
  const lock = {
    workspaces: { "": { name: "a", dependencies: pinned, devDependencies: { oxlint: "1.0.0" } } },
    packages: {
      typebox: ["typebox@1.3.27", "", {}, "sha512-a"],
      "cross-spawn": ["cross-spawn@7.0.6", "", { dependencies: { which: "^2.0.1" } }, "sha512-b"],
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

describe("the trees a paid seat refuses", () => {
  // A live solve must not run from the main checkout, which a job keeps at the stack's top.
  const trees = realpathSync(mkdtempSync(join(tmpdir(), "ana-tree-fault-")));
  afterAll(() => rmSync(trees, { recursive: true, force: true }));
  const main = join(trees, "main");
  const own = join(trees, "own");
  const followed = join(trees, "followed");
  const loose = join(trees, "loose");
  mkdirSync(main);
  mkdirSync(loose);
  gitText(main, "init", "-q");
  gitText(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c");
  for (const tree of [own, followed]) gitText(main, "worktree", "add", "-q", "--detach", tree, "HEAD");
  writeFileSync(join(gitText(followed, "rev-parse", "--path-format=absolute", "--git-dir"), FOLLOWED), "");

  it("refuses a main worktree and a marked one, and runs in a worktree of its own or outside git", () => {
    expect(treeFault(main)).toContain("main worktree");
    expect(treeFault(followed)).toContain(FOLLOWED);
    expect(treeFault(own)).toBeNull();
    expect(treeFault(loose)).toBeNull();
  });
});

describe("a campaign", () => {
  const prepare = async (...more: string[]) => said(prepareCommand, [...PACK, "--practice", "2", ...more]);

  it("opens over its drafted exam, takes the draft's tasks in at their gate, and releases practice once", async () => {
    const campaign = await openCampaign(ARGS);
    expect(campaign.contract.rules).toMatchObject([
      { id: "R1", statement: "The answer is the base times six." },
    ]);
    expect(campaign.test).toMatchObject({ effort: "medium", side: "test" });
    expect(campaign.test.model.id).toBe("claude-opus-5-5");
    expect(campaign.log.startsWith(join(REPO, ".ana", "d2", NAME))).toBe(true);
    expect(read(campaign.log).map(({ kind }) => kind)).toEqual(["campaign.opened", "exam.drafted"]);
    expect(readFileSync(join(dirname(campaign.log), "package.json"), "utf8")).toBe("{}\n");

    const packageOf = packaged(campaign);
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 40 }, hidden: { seed: 1 } };
    const extra = taskVersion(campaign.pack(written));
    append(campaign.log, "task.proposed", {
      version: extra,
      taskId: written.taskId,
      session: "x-1",
      task: written,
    });
    append(campaign.log, "task.gate", { version: extra, gate: 1, outcome: "passed" });

    const versions = TASKS.map((task) => taskVersion(campaign.pack(task)));
    // Killed between its two appends, a task is still owed the gate, or it would never be held out.
    for (const cut of TASKS.slice(3, 4)) {
      const { taskId, family } = cut;
      append(campaign.log, "task.proposed", { version: taskVersion(campaign.pack(cut)), taskId, family });
    }
    expect(ungated(campaign, read(campaign.log)).map((task) => task.taskId)).toEqual(
      TASKS.map((task) => task.taskId),
    );
    const summary = ["6 held out, 2 released for practice", ...sizeLines(6, ASKED.level)].join("\n");
    const [proposed, ...lines] = (await prepare()).split("\n");
    expect(proposed).toBe("7 of the pack's tasks proposed: 7 held out, 0 refused");
    expect(lines[0]).toBe(
      `${TASKS[0]?.taskId ?? ""}: an accepted answer passes today's verifier, so a valid answer to it is on record`,
    );
    expect(
      lines.slice(1, 3).every((line) => line.endsWith(": released for practice, and never scored")),
    ).toBe(true);
    expect(lines.slice(3).join("\n")).toBe(summary);
    const sets = taskSets(read(campaign.log));
    expect([sets.held.length, sets.released.length]).toEqual([6, 2]);
    expect([...sets.held, ...sets.released].toSorted()).toEqual([...versions, extra].toSorted());
    const packages = campaign.packages();
    expect(packages.get(extra)).toMatchObject({ taskId: "x-1-001", hidden: { seed: 1 }, ruleIds: ["R1"] });
    expect(versions.every((version) => packages.has(version))).toBe(true);
    // The lookup does not hold the map of its start, or a practice solve of this task would crash the
    // Builder.
    expect(packageOf(extra)).toMatchObject({ taskId: "x-1-001" });
    const events = read(campaign.log).length;
    expect(await prepare()).toBe(summary);
    expect(read(campaign.log)).toHaveLength(events);
    expect(await prepare("--target", "3")).toBe(
      ["6 held out, 2 released for practice", ...sizeLines(3, ASKED.level)].join("\n"),
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
    // A run that labels releases nothing, whatever --practice it carries: a release cannot be taken back.
    expect(await prepare("--practice", "4", "--keep", idOf(kept))).toContain("5 held out, 2 released");
    expect(taskSets(read(campaign.log)).released).toHaveLength(2);
    expect(await prepare("--keep", idOf(gone))).toContain("is no held-out task of this campaign");
    expect(await prepare("--infeasible", idOf(sets.released[0] ?? ""))).toContain("is no held-out task");
    expect(await prepare("--keep", "t-99")).toContain("t-99 is no held-out task of this campaign");
  });

  it("starts from the Starter Built Harness, and keeps it and the latest a session left, each by name", async () => {
    const campaign = await openCampaign(ARGS);
    const least = await starter(campaign);
    const opened = await openHarness(least.dir);
    expect(least).toEqual({ dir: join(campaign.states, opened.digest), digest: opened.digest });
    expect(opened.guide).toContain("# Operating Guide");
    expect(opened.presets).toEqual(["read", "bash", "edit", "write"]);
    expect(opened.toolTree).toBeNull();
    expect(await starter(campaign)).toEqual(least);
    expect(readdirSync(campaign.states)).toEqual([least.digest]);
    expect(await keptAs(campaign, "--reference", "starter")).toEqual(least);
    expect(await keptAs(campaign, "--parent", "latest")).toEqual(least);
    expect(COMPARISON_OPTIONS.reference.default).toBe("promoted");
    expect(await keptAs(campaign, "--reference", "promoted")).toEqual(least);
    expect(SESSION_OPTIONS.parent.default).toBe("latest");
    await expect(keptAs(campaign, "--reference", "start")).rejects.toThrow(
      "--reference start is no harness this campaign keeps",
    );

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
    expect(await keptAs(campaign, "--parent", least.digest)).toEqual(least);
    expect(await keptAs(campaign, "--harness", "B")).toEqual(built);
    await expect(keptAs(campaign, "--harness", "C")).rejects.toThrow(
      "--harness C is no harness this campaign keeps",
    );
    mkdirSync(join(campaign.states, "tree-x"));
    await expect(keptAs(campaign, "--harness", "C")).rejects.toThrow(
      `whole: ${[digest, least.digest].toSorted().join(", ")}.`,
    );
    await expect(keptAs(campaign, "--parent", "tree-x")).rejects.toThrow("is no harness this campaign keeps");
    writeFileSync(join(built.dir, "agent", "BUILT_AGENTS.md"), "Add first.\n");
    await expect(keptAs(campaign, "--parent", "latest")).rejects.toThrow(
      `${built.dir} no longer opens as the harness it is kept as`,
    );
  });

  it("imports a harness built elsewhere, kept as a session keeps one, and records where it came from", async () => {
    const campaign = await openCampaign(ARGS);
    const least = await starter(campaign);
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
    expect(lstatSync(join(imported.dir, TOOL_TREE_DIR)).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(imported.dir, TOOL_TREE_DIR, "bin", "engine"), "utf8")).toContain("echo engine");
    expect(await keptAs(campaign, "--parent", digest)).toEqual(imported);
    expect(await keptAs(campaign, "--reference", `programs-of:${digest}`)).not.toEqual(imported);
    const events = read(campaign.log).filter(({ kind }) => kind === "harness.imported");
    expect(events.map(({ data }) => data)).toEqual([
      { harness: digest, from: join("handed", "harness"), note: "epoch 0: the engine harness" },
    ]);
    expect({ latest: latestBuilt(read(campaign.log)), promoted: promoted(read(campaign.log)) }).toEqual(was);
    expect(await importCommand(flags)).toEqual(imported);
    expect(read(campaign.log).filter(({ kind }) => kind === "harness.imported")).toHaveLength(1);
    const stray = join(root, "stray");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "note.txt"), "not a harness\n");
    await expect(importCommand(["--name", NAME, "--harness", stray])).rejects.toThrow();
    expect(readdirSync(campaign.states).filter((name) => name.startsWith("importing-"))).toEqual([]);
    expect(trees()).toBe(treesBefore + 1);
    await expect(importCommand(["--name", "never-opened", "--harness", handed])).rejects.toThrow(
      "has no folder yet",
    );
  });

  it("refuses a harness whose programs link outside the folder it lies in", async () => {
    // The import copies a link's target outside every wall: a link to the operator's home hands it over.
    await openCampaign({ ...ARGS, name: FRESH });
    const handed = join(root, "linked", "harness");
    cpSync(FIXTURE, handed, { recursive: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(elsewhere, "bin"), { recursive: true });
    writeFileSync(join(elsewhere, "bin", "engine"), "#!/bin/sh\necho elsewhere\n", { mode: 0o755 });
    symlinkSync(elsewhere, join(handed, TOOL_TREE_DIR));
    await expect(importCommand(["--name", FRESH, "--harness", handed])).rejects.toThrow("outside");
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
    await expect(checkpointCommand(["--id", "z-8", ...flags])).rejects.toThrow(
      "name --cap, the billed dollars this comparison may hold",
    );
    expect(capNamed({ cap: "375", reserve: "10" }, "paid")).toEqual({ dollars: 375, reserve: 10 });
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
    ).rejects.toThrow("--cap $40 --reserve 3: a cap and its reserve are dollars as plain numbers");
    expect(capNamed({ reserve: "10" }, "scripted")).toBeUndefined();
    expect(capNamed({ cap: "40", reserve: "5" }, "scripted")).toEqual({ dollars: 40, reserve: 5 });
    await expect(checkpointCommand(["--id", "z-8", "--cap", "40", ...flags])).rejects.toThrow(
      "name --reviewer, the Referee that rules each rejection",
    );
    expect(() => refereeNamed({ reviewer: SERVED }, "paid")).not.toThrow();
    expect(() => refereeNamed({}, "scripted")).not.toThrow();
    expect({ ...SESSION_OPTIONS, ...COMPARISON_OPTIONS }).not.toHaveProperty("budget");
    const campaign = await openCampaign(ARGS);
    expect(read(campaign.log).some(({ data }) => data.session === "z-8")).toBe(false);
  });

  it("refuses a paid comparison started by hand where a launch of it would be refused", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter"];
    const unread = "the campaign's checker has never been read: run tools/c/accept.ts";
    await expect(
      checkpointCommand(["--id", "z-5", "--new", "starter", ...flags.slice(0, -2)]),
    ).rejects.toThrow(unread);
    await expect(
      checkpointCommand(
        ["--id", "z-5", "--new", "starter", ...flags.slice(0, -2)],
        rehearsal(() => undefined),
      ),
    ).rejects.toThrow("there is nothing to compare");
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
    await expect(
      sessionCommand([...flags, "--cap", "100", "--reviewer", SERVED, "--level", "0.02"]),
    ).rejects.toThrow("--level");
    await expect(
      sessionCommand([...flags, "--cap", "100", "--reviewer", SERVED, "--builder", SERVED]),
    ).rejects.toThrow("the campaign's checker has never been read: run tools/c/accept.ts");
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
    const made = join(root, "made");
    cpSync(least.dir, made, { recursive: true });
    writeFileSync(join(made, "agent", "BUILT_AGENTS.md"), "Multiply the base by six.\n");
    const { digest } = await openHarness(made);
    cpSync(made, join(campaign.states, digest), { recursive: true });
    const promote = async (...more: string[]) => said(promoteCommand, ["--name", NAME, ...more]);
    const promotions = () =>
      read(campaign.log).flatMap(({ kind, data }) => (kind === "harness.promoted" ? [data] : []));
    const asked = await promote("--harness", digest);
    expect(asked).toContain("the reference harness is the starter");
    expect(asked).toContain(`no comparison on record measured harness ${digest}`);
    expect(asked).toContain("nothing is recorded without --yes");
    expect(promotions()).toEqual([]);
    expect(await promote("--harness", digest.slice(0, 8))).toContain("is no harness this campaign keeps");
    const refused = await promote("--harness", digest, "--yes");
    expect(refused).toContain(
      `the plan would not promote it now: harness ${digest.slice(0, 8)} has no comparison that read a step against the reference harness`,
    );
    expect(refused).toContain(
      "not promoted: a harness is promoted where a comparison against the reference read a step",
    );
    expect(promotions()).toEqual([]);
    const despite = "the record is under test";
    expect(await promote("--harness", digest, "--yes", "--despite", despite)).toContain(
      "is the reference harness from here on",
    );
    expect(promotions()).toEqual([{ harness: digest, from: least.digest, rests: [], despite }]);
    expect((await keptAs(campaign, "--reference", "promoted")).digest).toBe(digest);
    expect(await promote("--harness", digest, "--yes")).toMatch(
      new RegExp(`^[A-Z]+ ${digest} is the campaign's reference harness already`, "mu"),
    );
    expect(promotions()).toHaveLength(1);
    const against: string[] = [];
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter", "--session", "z-3"];
    const seats = rehearsal((opened, given) => {
      expect(opened.log).toBe(campaign.log);
      against.push(given.reference);
    });
    await expect(sessionCommand(flags, seats)).rejects.toThrow("name --builder");
    const named = ["--id", "z-3", "--reference", "starter", "--new", "starter", ...flags.slice(0, -4)];
    await expect(checkpointCommand(named, seats)).rejects.toThrow("there is nothing to compare");
    expect(against).toEqual([join(campaign.states, digest), least.dir]);
    await promote("--harness", "starter", "--yes");
    expect(await keptAs(campaign, "--reference", "promoted")).toEqual(least);
  });

  it("runs every command under the campaign's recorded setting, and refuses one that names another", async () => {
    const campaign = await openCampaign(ARGS);
    const flags = [...PACK, "--cap", "100", "--reviewer", SERVED, "--parent", "starter", "--session", "z-4"];
    const refused = "--solve-minutes 0: a solve's wall is a whole number of minutes";
    await expect(sessionCommand([...flags, "--solve-minutes", "0"])).rejects.toThrow(refused);
    const checkpoint = async (...more: string[]) =>
      checkpointCommand(["--id", "z-4", ...flags.slice(0, -4), ...more]);
    await expect(checkpoint("--solve-minutes", "0")).rejects.toThrow(refused);
    append(campaign.log, "campaign.setting", {
      solver: null,
      minutes: 8,
      turns: 24,
      modelTurns: 40,
      tasks: null,
      target: 12,
    });
    const seen: number[] = [];
    const seats = rehearsal((opened) => {
      seen.push(opened.limits.wallSeconds, opened.limits.modelTurns ?? 0);
    });
    await expect(sessionCommand(flags, seats)).rejects.toThrow("name --builder");
    expect(seen).toEqual([480, 40]);
    const other =
      "--solve-minutes 5 names another setting than the campaign's, which was recorded as --solve-minutes 8";
    await expect(sessionCommand([...flags, "--solve-minutes", "5"], seats)).rejects.toThrow(other);
    await expect(checkpoint("--solve-minutes", "5")).rejects.toThrow(other);
    // No word changes it: `--new-setting` is no flag, and another setting is another campaign.
    await expect(sessionCommand([...flags, "--solve-minutes", "5", "--new-setting"], seats)).rejects.toThrow(
      "--new-setting",
    );
    expect(seen).toEqual([480, 40]);
    const kept = read(campaign.log).filter(({ kind }) => kind === "campaign.setting");
    expect(kept.map(({ data }) => data.minutes)).toEqual([8]);
    expect(read(campaign.log).some(({ data }) => data.session === "z-4")).toBe(false);
  });

  it("refuses a paid command's first record of another setting as it opens the campaign, and no rehearsal's", async () => {
    const campaign = await openCampaign({ ...ARGS, name: UNRECORDED });
    const condition = { side: "test", model: SERVED, effort: "high", limits: { ...LIMITS, modelTurns: 15 } };
    append(campaign.log, "condition.recorded", { id: "c-1", condition });
    append(campaign.log, "solve.started", { condition: "c-1" });
    const before = read(campaign.log).length;
    const flags = ["--name", UNRECORDED, "--cap", "100", "--reviewer", SERVED];
    const refusal = await sessionCommand([...flags, "--session", "u-1", "--builder", SERVED]).catch(
      (error: unknown) => (error instanceof Refused ? "the admission's" : errorMessage(error)),
    );
    expect(refusal).toContain("records no setting yet, and this command names another");
    expect(refusal).toContain("--solve-model-turns 15");
    await expect(checkpointCommand(["--id", "u-2", ...flags])).rejects.toThrow("records no setting yet");
    expect(read(campaign.log)).toHaveLength(before);
    await expect(
      sessionCommand(
        [...flags, "--session", "u-1"],
        rehearsal(() => undefined),
      ),
    ).rejects.toThrow("name --builder");
  });
  it("logs a held-out task feasible where its accepted answer passes today's checks, and no other", async () => {
    const preparedUnder = async (name: string, check: string) => {
      layOutDraft(folderOf(name), {
        ...fixtureDraft(TASKS, 1),
        evaluator: `export const checks = { "check-product": ${check} };\n`,
      });
      const flags = ["--name", name, "--practice", "0"];
      const campaign = await openCampaign({ name });
      const first = await said(prepareCommand, flags);
      return { first, again: await said(prepareCommand, flags), campaign };
    };
    const right = "(req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6)";
    const passed = await preparedUnder(PROVEN, right);
    const [first] = TASKS;
    expect(passed.first).toContain(
      `${first?.taskId ?? ""}: an accepted answer passes today's verifier, so a valid answer to it is on record`,
    );
    expect(passed.again).not.toContain(`${first?.taskId ?? ""}:`);
    const feasible = read(passed.campaign.log).filter(({ kind }) => kind === "task.feasible");
    expect(feasible.map(({ data }) => data.version)).toEqual(
      TASKS.slice(0, 1).map((task) => taskVersion(passed.campaign.pack(task))),
    );
    const rejected = await preparedUnder(UNPROVEN, "() => false");
    expect(rejected.first).not.toContain(`${first?.taskId ?? ""}:`);
    expect(read(rejected.campaign.log).filter(({ kind }) => kind === "task.feasible")).toEqual([]);
  });
});

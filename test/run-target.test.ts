/**
 * Which run a folder names, and which checkout's readers read it.
 *
 * A run's records are read by the source that wrote them: the checkout at the opening's
 * `source.commit`, clean, with its own dependencies installed. `resolveSourceCheckout` finds that
 * checkout without changing any tree it finds, and `wri.ts read` then runs every lane that reads the
 * run's records as that checkout's own script.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { resolveSourceCheckout } from "../.claude/skills/main/run.ts";
import { resolveRunSelector } from "../tools/runs/discover.ts";
import { STUB_RUN, stubSource } from "./helpers/measured-source.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const COMMIT = "511312ce8f2926355a957f90dd33fb010078bb8b";
const RUN = "custom-sol-20260929T234004288Z-5cc42c";
const OTHER = "0".repeat(40);
const WRI = resolve(import.meta.dirname, "../.claude/skills/whole-run-investigation/scripts/wri.ts");

interface Tree {
  head: string;
  dirty?: boolean;
  /** Dependencies its manifest declares, and which of them are installed. */
  declares?: string[];
  installed?: string[];
  linkedModules?: boolean;
  /** The run whose launch receipt the checkout holds, as a run worktree does. */
  receipt?: string;
}

/** A checkout of the commit whose readers can run: its one declared dependency is installed. */
const USABLE: Tree = { head: COMMIT, declares: ["typebox"], installed: ["typebox"] };

afterAll(cleanupScratch);

function campaignWith(runs: Record<string, string | null>): string {
  const campaign = scratchDir("ana-run-target-");
  for (const [runId, writtenAt] of Object.entries(runs)) {
    mkdirSync(join(campaign, "controller", runId), { recursive: true });
    if (writtenAt !== null) {
      writeFileSync(
        join(campaign, "controller", runId, "opening.json"),
        JSON.stringify({ runId, writtenAt }),
      );
    }
  }
  return campaign;
}

describe("run target resolution", () => {
  it("names the latest run of a campaign folder and accepts the run folder itself", () => {
    const campaign = campaignWith({
      "run-a": "2026-09-10T10:00:00.000Z",
      "run-b": "2026-09-12T10:00:00.000Z",
      "run-c": null,
    });
    expect(resolveRunSelector(campaign)).toEqual({
      campaign,
      runId: "run-b",
      chosen: "latest of 2 runs by opening writtenAt",
    });
    expect(resolveRunSelector(join(campaign, "controller"))).toMatchObject({ runId: "run-b" });
    expect(resolveRunSelector(join(campaign, "controller", "run-a"))).toEqual({
      campaign,
      runId: "run-a",
      chosen: "folder",
    });
    expect(resolveRunSelector(campaign, "run-a")).toEqual({ campaign, runId: "run-a", chosen: "--run" });
    expect(() => resolveRunSelector(join(campaign, "controller", "run-a"), "run-b")).toThrow(
      "folder names run run-a but --run says run-b",
    );
  });

  it("refuses a folder without any opened run", () => {
    const campaign = campaignWith({ "run-c": null });
    expect(() => resolveRunSelector(campaign)).toThrow("no run with a dated opening.json");
    expect(() => resolveRunSelector(join(campaign, "missing"))).toThrow("no such folder");
  });
});

/** Real checkout directories for the dependency check, and a scripted git over them that logs
 *  every command: HEAD and status per directory, the worktree list, and the commit objects the
 *  repository holds. `worktree add` creates the directory it names at the commit. */
function checkouts(trees: Record<string, Tree>, { objects = [COMMIT] } = {}) {
  const root = scratchDir("ana-source-checkouts-");
  const heads = new Map<string, Tree>();
  const place = (dir: string, tree: Tree) => {
    mkdirSync(dir, { recursive: true });
    const declares = tree.declares ?? [];
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: Object.fromEntries(declares.map((name) => [name, "1.0.0"])) }),
    );
    const modules = join(dir, "node_modules");
    if (tree.linkedModules === true) symlinkSync(root, modules);
    for (const name of tree.installed ?? []) {
      mkdirSync(join(modules, name), { recursive: true });
      writeFileSync(join(modules, name, "package.json"), "{}");
    }
    if (tree.receipt !== undefined) {
      mkdirSync(join(dir, ".scratch/quick-run"), { recursive: true });
      writeFileSync(join(dir, ".scratch/quick-run/launch.json"), JSON.stringify({ runId: tree.receipt }));
    }
    heads.set(dir, tree);
  };
  for (const [name, tree] of Object.entries(trees)) place(join(root, name), tree);
  const calls: string[] = [];
  const git = (cmd: readonly string[], cwd: string): string => {
    calls.push(`${cwd}: ${cmd.join(" ")}`);
    const args = cmd.slice(1).filter((arg) => arg !== "--no-optional-locks");
    const tree = heads.get(cwd);
    if (args[0] === "rev-parse") {
      if (tree === undefined) throw new Error("not a git repository");
      return tree.head;
    }
    if (args[0] === "status") return tree?.dirty === true ? " M src/x.ts" : "";
    if (args[0] === "worktree" && args[1] === "list") {
      return [...heads].map(([dir, row]) => `worktree ${dir}\nHEAD ${row.head}\n`).join("\n");
    }
    if (args[0] === "cat-file" && !objects.some((sha) => args.at(-1)?.startsWith(sha) === true)) {
      throw new Error("fatal: Not a valid object name");
    }
    if (args[0] === "worktree" && args[1] === "add") place(String(args.at(-2)), { head: COMMIT });
    if (cmd[0]?.endsWith("worktree.sh") === true) {
      place(String(cmd[2]), { head: COMMIT, installed: ["typebox"] });
    }
    return "";
  };
  const at = (name: string) => join(root, name);
  return { git, calls, at, main: at("main") };
}

const edits = (calls: readonly string[]) =>
  calls.filter((line) => /worktree\.sh|worktree add|fetch|install/.test(line));

describe("the checkout whose readers read a run", () => {
  it("reads through --repo when it is clean at the commit with its dependencies installed", () => {
    const { git, calls, at, main } = checkouts({
      main: { head: OTHER },
      given: USABLE,
    });
    expect(resolveSourceCheckout(COMMIT, { repo: at("given"), skillRepo: main, git })).toEqual({
      state: "resolved",
      repo: at("given"),
      chosen: "--repo",
      passed: [],
    });
    expect(edits(calls)).toEqual([]);
  });

  it("passes over an unusable --repo and every unusable checkout for one it can read, changing none", () => {
    const { git, calls, at, main } = checkouts({
      main: { head: OTHER },
      [`ana-run-${RUN}`]: USABLE,
      given: { head: COMMIT, declares: ["typebox"] },
      elsewhere: { ...USABLE, head: OTHER },
      dirty: { ...USABLE, dirty: true },
      linked: { head: COMMIT, declares: ["typebox"], linkedModules: true },
      spare: USABLE,
    });
    // The run's own worktree is listed before the spare but read only when no other checkout can be.
    expect(resolveSourceCheckout(COMMIT, { repo: at("given"), runId: RUN, skillRepo: main, git })).toEqual({
      state: "resolved",
      repo: at("spare"),
      chosen: "existing checkout",
      passed: [
        `--repo ${at("given")}: dependencies not installed: typebox`,
        `existing checkout ${at("dirty")}: tracked files differ from the commit`,
        `existing checkout ${at("linked")}: node_modules is a link to another tree`,
      ],
    });
    // A checkout that was found is read as it is: nothing prepares, installs into or fetches for it.
    expect(edits(calls)).toEqual([]);
  });

  it("prefers the read's own review worktree of the commit to any other usable checkout", () => {
    const { git, at, main } = checkouts({
      main: { head: OTHER },
      spare: USABLE,
      "ana-wri-511312ce": USABLE,
    });
    expect(resolveSourceCheckout(COMMIT, { skillRepo: main, git })).toMatchObject({
      repo: at("ana-wri-511312ce"),
      chosen: "existing checkout",
    });
  });

  it("reads through the run's own worktree before a sibling run's at the same commit, and never the sibling's", () => {
    // Two runs launched from one commit: another run's worktree, by name or by its launch receipt,
    // is that run's evidence tree, and a read of this run never runs its readers there.
    const siblings = {
      main: { head: OTHER },
      "ana-run-custom-opus-20260930T002000000Z-887c16": USABLE,
      "renamed-run": { ...USABLE, receipt: "custom-sol-20260929T233947888Z-3af96d" },
    };
    const own = checkouts({ ...siblings, [`ana-run-${RUN}`]: USABLE });
    expect(resolveSourceCheckout(COMMIT, { runId: RUN, skillRepo: own.main, git: own.git })).toMatchObject({
      repo: own.at(`ana-run-${RUN}`),
      chosen: "existing checkout",
    });
    const none = checkouts(siblings);
    expect(resolveSourceCheckout(COMMIT, { runId: RUN, skillRepo: none.main, git: none.git })).toMatchObject({
      repo: none.at("ana-wri-511312ce"),
      chosen: "prepared review worktree",
    });
  });

  it("creates a detached review worktree beside the main checkout and prepares it from its own lock", () => {
    const { git, calls, at, main } = checkouts({ main: { head: OTHER } });
    const created = at("ana-wri-511312ce");
    expect(resolveSourceCheckout(COMMIT, { skillRepo: main, git })).toEqual({
      state: "resolved",
      repo: created,
      chosen: "prepared review worktree",
      passed: [],
    });
    expect(edits(calls)).toEqual([
      `${main}: git worktree add --detach ${created} ${COMMIT}`,
      `${main}: ${main}/scripts/worktree.sh setup ${created}`,
    ]);
  });

  it("prepares its own review worktree of the commit when an earlier read left it without dependencies", () => {
    const { git, calls, at, main } = checkouts({
      main: { head: OTHER },
      "ana-wri-511312ce": { head: COMMIT, declares: ["typebox"] },
    });
    expect(resolveSourceCheckout(COMMIT, { skillRepo: main, git })).toEqual({
      state: "resolved",
      repo: at("ana-wri-511312ce"),
      chosen: "prepared review worktree",
      passed: [`existing checkout ${at("ana-wri-511312ce")}: dependencies not installed: typebox`],
    });
    expect(edits(calls)).toEqual([`${main}: ${main}/scripts/worktree.sh setup ${at("ana-wri-511312ce")}`]);
  });

  it("returns source-unresolved when the commit object is missing, and neither fetches nor creates", () => {
    const { git, calls, at, main } = checkouts(
      { main: { head: OTHER }, given: { head: OTHER } },
      { objects: [] },
    );
    expect(resolveSourceCheckout(COMMIT, { repo: at("given"), skillRepo: main, git })).toEqual({
      state: "source-unresolved",
      commit: COMMIT,
      passed: [
        `--repo ${at("given")}: HEAD is ${OTHER.slice(0, 12)}, not ${COMMIT.slice(0, 12)}`,
        `commit object ${COMMIT} is not in ${main}`,
      ],
    });
    expect(edits(calls)).toEqual([]);
    expect(() => resolveSourceCheckout("abc", { git })).toThrow("not a full sha");
  });
});

/** One `wri.ts read` from this checkout. */
function read(...args: string[]) {
  const run = Bun.spawnSync({
    cmd: [runtimeProcess.execPath, WRI, "read", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

describe("a read through the measured source", () => {
  it("runs every lane that reads the run as the measured checkout's own script, sized by that source", () => {
    const { repo, campaign } = stubSource();
    const review = scratchDir("ana-measured-read-");
    const { code, stdout } = read(campaign, "--repo", repo, "--out", review, "--all");
    expect(code).toBe(0);
    const capture = (lane: string) => readFileSync(join(review, `${lane}.txt`), "utf8");
    for (const lane of [
      "snapshot",
      "challenge",
      "delta",
      "climb",
      "yield",
      "posture",
      "timeline",
      "walls",
      "handoff",
      "gates",
      "target",
    ]) {
      expect(capture(lane)).toContain(`${lane} read by the stub source with `);
    }
    // Each in-process lane is asked exactly what its own subcommand takes in a review.
    expect(capture("walls")).toContain(
      `with ${campaign} --run ${STUB_RUN} --out ${join(review, "walls.json")}`,
    );
    expect(capture("timeline")).toContain("--classify");
    expect(capture("delta")).toContain(`--repo ${repo}`);
    expect(capture("snapshot")).toContain(`--repo ${repo} --out ${join(review, "snapshot")} --all`);
    const state = parseJsonAs<{ repo: string; chosen: string; scope: { why: string } }>(
      readFileSync(join(review, "wri-review.json"), "utf8"),
    );
    expect(state).toMatchObject({ repo, chosen: "--repo", scope: { why: "sized by the stub source" } });
    expect(stdout).toContain("scope: probe — sized by the stub source");
    expect(stdout).toContain(`readers ${repo} (--repo)`);
  }, 60_000);

  it("refuses a run whose measured source it cannot resolve, as source-unresolved, before any lane", () => {
    const { repo, campaign, commit } = stubSource({ manifest: { dependencies: { typebox: "1.3.30" } } });
    const review = scratchDir("ana-measured-read-");
    const { code, stderr } = read(campaign, "--repo", repo, "--out", review, "--lanes", "walls");
    expect(code).toBe(2);
    expect(stderr).toContain(`source-unresolved: ${commit}`);
    expect(stderr).toContain(`--repo ${repo}: dependencies not installed: typebox`);
    expect(stderr).toContain(`commit object ${commit} is not in `);
    expect(existsSync(join(review, "walls.txt"))).toBe(false);
  }, 60_000);
});

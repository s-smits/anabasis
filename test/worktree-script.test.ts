import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { dependencyIdentity } from "../tools/dependency-identity.ts";

import { describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
const NODE_MODULES = "node_modules";
const MANIFEST = "package.json";

const scriptPath = join(import.meta.dir, "..", "scripts", "worktree.sh");

describe("the Bun-owned worktree launcher", () => {
  it("changes dependency identity only for lock or install-relevant manifest changes", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "ana-dependency-identity-"));
    try {
      writeFileSync(join(fixture, "bun.lock"), "one\n");
      writeFileSync(
        join(fixture, MANIFEST),
        `${JSON.stringify({ scripts: { test: "bun test" }, dependencies: { a: "1" } })}\n`,
      );
      const initial = await dependencyIdentity(fixture);
      writeFileSync(
        join(fixture, MANIFEST),
        `${JSON.stringify({ scripts: { test: "bun test --watch" }, dependencies: { a: "1" } })}\n`,
      );
      expect(await dependencyIdentity(fixture)).toBe(initial);
      writeFileSync(
        join(fixture, MANIFEST),
        `${JSON.stringify({ scripts: { test: "bun test --watch" }, dependencies: { a: "2" } })}\n`,
      );
      expect(await dependencyIdentity(fixture)).not.toBe(initial);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("prepares once, clones from any matching worktree and refuses dependencies it cannot vouch for", async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), "ana-worktree-setup-")));
    const source = join(fixture, "source");
    const target = join(fixture, "target");
    const sibling = join(fixture, "sibling");
    const marker = join(NODE_MODULES, ".ana-dependency-identity");
    const git = (...args: string[]): string => execTextSync("git", args, { cwd: source }).trim();
    const helper = (cwd: string, ...args: string[]) => {
      const result = spawnTextSync("bash", [scriptPath, ...args], {
        cwd,
        env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      });
      return { ...result, output: `${result.stdout}${result.stderr}` };
    };
    const setup = (dir: string, cwd = source) => {
      const result = helper(cwd, "setup", dir);
      if (result.status !== 0) throw new Error(`setup ${dir} failed:\n${result.output}`);
      return result.output;
    };

    mkdirSync(source);
    try {
      git("init", "-q");
      git("config", "user.email", "fixture@localhost");
      git("config", "user.name", "fixture");
      writeFileSync(join(source, ".bun-version"), `${Bun.version}\n`);
      // One file: dependency, so Bun writes a lock a frozen install accepts without the network;
      // a manifest with no dependencies gets no lock at all, and a hand-written one is refused.
      mkdirSync(join(source, "local"));
      writeFileSync(join(source, "local", MANIFEST), '{ "name": "local", "version": "1.0.0" }\n');
      const manifest = (scripts: Record<string, string>, dependencies: Record<string, string> = {}) =>
        `${JSON.stringify({ name: "fixture", private: true, scripts, dependencies: { local: "file:./local", ...dependencies } }, null, 2)}\n`;
      writeFileSync(join(source, MANIFEST), manifest({ check: "bun --version" }));
      writeFileSync(join(source, ".gitignore"), "node_modules\n.scratch/\n");
      execTextSync("bun", ["install", "--no-env-file"], { cwd: source });
      // A package under `packages/` is outside the root workspaces and installs its own tree; the
      // root install never reaches it, and a gate step that reads it needs it just the same.
      const thing = join(source, "packages", "thing");
      mkdirSync(thing, { recursive: true });
      writeFileSync(
        join(thing, "package.json"),
        '{ "name": "thing", "private": true, "dependencies": { "local": "file:../../local" } }\n',
      );
      execTextSync("bun", ["install", "--no-env-file"], { cwd: thing });
      git("add", "-A");
      git("commit", "-qm", "fixture");
      git("worktree", "add", "-q", "--detach", target, "HEAD");
      git("worktree", "add", "-q", "--detach", sibling, "HEAD");

      // The source's own install is unmarked, so nothing can vouch for a clone: install and mark.
      expect(setup(target)).toContain("no worktree is prepared");
      expect(readFileSync(join(target, marker), "utf8")).toBe(`${await dependencyIdentity(target)}\n`);
      expect(existsSync(join(target, "packages", "thing", "node_modules"))).toBe(true);

      // A current tree is left alone rather than cloned or installed again.
      writeFileSync(join(target, NODE_MODULES, "sentinel"), "kept\n");
      expect(setup(target)).toContain("already prepared");
      expect(existsSync(join(target, NODE_MODULES, "sentinel"))).toBe(true);

      // Any worktree with a matching marker is a clone source, whichever checkout the caller stands in.
      expect(setup(sibling, sibling)).toContain(`cloned from ${target}`);
      expect(existsSync(join(sibling, "packages", "thing", "node_modules"))).toBe(true);

      // The root marker says nothing about a package's own modules, so a tree that lost them has
      // them prepared again rather than skipped as already current.
      rmSync(join(sibling, "packages", "thing", "node_modules"), { recursive: true, force: true });
      setup(sibling, sibling);
      expect(existsSync(join(sibling, "packages", "thing", "node_modules"))).toBe(true);

      // A marker for other dependencies is repaired rather than refused. The identity is read from
      // the tree's own lock, so preparing it is exactly what the refusal used to ask for by hand.
      writeFileSync(join(target, marker), "stale\n");
      const staleRun = helper(source, "run", target, "touch", join(fixture, "ran"));
      expect(staleRun.status).toBe(0);
      expect(staleRun.stderr).toContain(`cloned from ${sibling}`);
      expect(existsSync(join(fixture, "ran"))).toBe(true);
      rmSync(join(fixture, "ran"));

      // Nothing vouches for a clone once no tree carries the identity.
      rmSync(join(sibling, NODE_MODULES), { recursive: true, force: true });
      rmSync(join(target, NODE_MODULES), { recursive: true, force: true });
      expect(setup(sibling)).toContain("no worktree is prepared");

      // A link is replaced by a real tree rather than trusted, and the tree it pointed at is kept.
      symlinkSync(join(sibling, NODE_MODULES), join(target, NODE_MODULES));
      const linkedRun = helper(source, "run", target, "touch", join(fixture, "ran"));
      expect(linkedRun.status).toBe(0);
      expect(realpathSync(join(target, NODE_MODULES))).toBe(join(target, NODE_MODULES));
      expect(existsSync(join(sibling, marker))).toBe(true);
      expect(existsSync(join(fixture, "ran"))).toBe(true);
      rmSync(join(fixture, "ran"));

      // `run` prepares absent dependencies itself and leaves stdout to the command.
      rmSync(join(target, NODE_MODULES), { recursive: true, force: true });
      const absentRun = helper(
        source,
        "run",
        target,
        "bun",
        "--no-env-file",
        "-e",
        "console.log('command output')",
      );
      expect(absentRun.status).toBe(0);
      expect(absentRun.stdout).toBe("command output\n");
      expect(absentRun.stderr).toContain(`cloned from ${sibling}`);

      // A script-only manifest edit keeps the identity; a dependency edit finds no source and the frozen install refuses.
      rmSync(join(target, NODE_MODULES), { recursive: true, force: true });
      writeFileSync(join(target, MANIFEST), manifest({ check: "bun -e '1'" }));
      expect(setup(target)).toContain("cloned from");
      rmSync(join(target, NODE_MODULES), { recursive: true, force: true });
      writeFileSync(join(target, MANIFEST), manifest({}, { missing: "1.0.0" }));
      const dependencyChange = helper(source, "setup", target);
      expect(dependencyChange.status).not.toBe(0);
      expect(dependencyChange.output).toContain("no worktree is prepared");

      // Bad paths and another Bun release are refused before anything executes.
      expect(helper(source, "run", "relative/dir", "true").output).toContain(
        "worktree directory must be absolute",
      );
      writeFileSync(join(sibling, ".bun-version"), "0.0.1\n");
      const wrongBun = helper(source, "run", sibling, "touch", join(fixture, "ran"));
      expect(wrongBun.output).toContain(".bun-version asks for 0.0.1");
      expect(existsSync(join(fixture, "ran"))).toBe(false);
    } finally {
      for (const tree of [target, sibling]) {
        if (existsSync(tree)) spawnTextSync("git", ["worktree", "remove", "--force", tree], { cwd: source });
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("scopes the preparation, reports what every tree holds and refuses to drop evidence", async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), "ana-worktree-scope-")));
    const source = join(fixture, "source");
    const target = join(fixture, "target");
    const evidence = join(fixture, "ana-run-evidence");
    const marker = join(NODE_MODULES, ".ana-dependency-identity");
    const git = (...args: string[]): string => execTextSync("git", args, { cwd: source }).trim();
    const helper = (cwd: string, ...args: string[]) => {
      const result = spawnTextSync("bash", [scriptPath, ...args], {
        cwd,
        env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      });
      return { ...result, output: `${result.stdout}${result.stderr}` };
    };

    mkdirSync(source);
    try {
      git("init", "-q");
      git("config", "user.email", "fixture@localhost");
      git("config", "user.name", "fixture");
      writeFileSync(join(source, ".bun-version"), `${Bun.version}\n`);
      writeFileSync(join(source, MANIFEST), '{ "name": "fixture", "private": true }\n');
      writeFileSync(join(source, "bun.lock"), "{}\n");
      writeFileSync(
        join(source, ".gitignore"),
        "node_modules\n.scratch/\n.toolchain/\ncampaigns/\n.env\ntest/.test-timings.json\n",
      );
      git("add", "-A");
      git("commit", "-qm", "fixture");
      // No install: a marked node_modules is a clone source, which is what the scopes select between.
      mkdirSync(join(source, NODE_MODULES));
      writeFileSync(join(source, marker), `${await dependencyIdentity(source)}\n`);
      mkdirSync(join(source, ".toolchain"));
      writeFileSync(join(source, ".toolchain", "installed"), "a real tool\n");
      mkdirSync(join(source, "test"));
      writeFileSync(join(source, "test", ".test-timings.json"), "{}\n");
      mkdirSync(join(source, "campaigns"));
      writeFileSync(join(source, "campaigns", "recorded.json"), "{}\n");
      writeFileSync(join(source, ".env"), "SECRET=1\n");
      git("worktree", "add", "-q", "--detach", target, "HEAD");
      git("worktree", "add", "-q", "--detach", evidence, "HEAD");

      // minimal is the whole preparation a documentation-only change needs: the Git worktree alone.
      const minimal = helper(source, "setup", target, "--scope", "minimal");
      expect(minimal.status).toBe(0);
      expect(minimal.output).toContain("scope minimal");
      expect(existsSync(join(target, NODE_MODULES))).toBe(false);

      // maximum adds the ignored local state worth inheriting, and names what it left behind.
      const maximum = helper(source, "setup", target, "--scope=maximum");
      expect(maximum.status).toBe(0);
      expect(maximum.output).toContain(`cloned from ${source}`);
      expect(existsSync(join(target, ".toolchain", "installed"))).toBe(true);
      expect(existsSync(join(target, "test", ".test-timings.json"))).toBe(true);
      expect(existsSync(join(target, "campaigns"))).toBe(false);
      expect(existsSync(join(target, ".env"))).toBe(false);
      expect(maximum.output).toContain("left behind");
      expect(maximum.output).toContain("campaigns (");
      expect(maximum.output).toContain(".env (");

      // `run` reads no flags of its own, so a command keeps its.
      const passthrough = helper(source, "run", target, "echo", "--scope", "minimal");
      expect(passthrough.status).toBe(0);
      expect(passthrough.stdout).toBe("--scope minimal\n");

      expect(helper(source, "setup", target, "--scope", "sideways").output).toContain(
        "--scope must be minimal, medium or maximum",
      );

      // list says which trees can run a command now, without running one in each.
      const listed = helper(source, "list");
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain(`deps ready  (detached)  ${target}`);
      expect(listed.stdout).toContain(`deps absent  (detached)  ${evidence}`);
      expect(listed.stdout).toContain("[run evidence: never remove]");
      // The footer answers the two questions a session otherwise asks with df and a marker read.
      expect(listed.stderr).toMatch(
        /\d+ worktrees: \d+ ready, \d+ stale or linked, \d+ absent, \d+ in use; \d+ GiB free/,
      );

      // A tree some command is standing in is named, and its dependencies are left alone: that
      // running command is the one reader a marker mismatch cannot speak for.
      writeFileSync(join(target, marker), "other-dependencies\n");
      // The exec leaves a bare `sleep 20` with no command line naming the tree, which is what bash
      // 5.1 and later, and zsh, make of `cd <tree> && <command>` by themselves; only its working
      // directory places it.
      const standing = Bun.spawn(["bash", "-c", `cd ${target} && exec sleep 20`], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      try {
        await Bun.sleep(200);
        expect(helper(source, "list").stdout).toContain(`${target}  0 changed [in use]`);
        const held = helper(source, "run", target, "true");
        expect(held.status).not.toBe(0);
        expect(held.output).toContain("is in use by a running command");
      } finally {
        standing.kill();
        await standing.exited;
      }
      // A shell merely standing in the tree, as a parked terminal does, opens no modules itself.
      const parked = Bun.spawn(["bash", "-c", "read -r -t 20 line"], {
        cwd: target,
        stdio: ["pipe", "ignore", "ignore"],
      });
      try {
        await Bun.sleep(200);
        expect(helper(source, "list").stdout).not.toContain(`${target}  0 changed [in use]`);
      } finally {
        parked.kill();
        await parked.exited;
      }

      // drop keeps recorded evidence and unfinished work, and removes a clean disposable tree.
      expect(helper(source, "drop", evidence).output).toContain("holds the recorded evidence of a run");
      expect(existsSync(evidence)).toBe(true);
      // An ignored campaigns/ tree is evidence under any name: a clean status does not see it.
      mkdirSync(join(target, "campaigns"), { recursive: true });
      const holding = helper(source, "drop", target);
      expect(holding.status).not.toBe(0);
      expect(holding.output).toContain("campaigns/ holds recorded evidence");
      expect(existsSync(target)).toBe(true);
      rmSync(join(target, "campaigns"), { recursive: true });
      writeFileSync(join(target, "unfinished.txt"), "work\n");
      const dirty = helper(source, "drop", target);
      expect(dirty.status).not.toBe(0);
      expect(dirty.output).toContain("uncommitted or untracked path(s)");
      expect(existsSync(target)).toBe(true);
      expect(helper(source, "drop", target, "--force").status).toBe(0);
      expect(existsSync(target)).toBe(false);
      expect(helper(source, "drop", source).output).toContain("refusing to remove the checkout itself");
      expect(helper(source, "pr", "not-a-number", join(fixture, "pr")).output).toContain(
        "pull request number must be digits",
      );
    } finally {
      for (const tree of [target, evidence]) {
        if (existsSync(tree)) spawnTextSync("git", ["worktree", "remove", "--force", tree], { cwd: source });
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("holds a tree for the command it exec'd into, which no process scan can see", async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), "ana-worktree-hold-")));
    const source = join(fixture, "source");
    const target = join(fixture, "target");
    const marker = join(NODE_MODULES, ".ana-dependency-identity");
    const git = (...args: string[]): string => execTextSync("git", args, { cwd: source }).trim();
    const helper = (...args: string[]) => {
      const result = spawnTextSync("bash", [scriptPath, ...args], {
        cwd: source,
        env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      });
      return { ...result, output: `${result.stdout}${result.stderr}` };
    };
    const commandOf = (pid: number): string =>
      spawnTextSync("ps", ["-p", String(pid), "-o", "command="], {}).stdout.trim();

    mkdirSync(source);
    let held: ReturnType<typeof Bun.spawn> | null = null;
    let second: ReturnType<typeof Bun.spawn> | null = null;
    try {
      git("init", "-q");
      git("config", "user.email", "fixture@localhost");
      git("config", "user.name", "fixture");
      writeFileSync(join(source, ".bun-version"), `${Bun.version}\n`);
      mkdirSync(join(source, "local"));
      writeFileSync(join(source, "local", MANIFEST), '{ "name": "local", "version": "1.0.0" }\n');
      writeFileSync(
        join(source, MANIFEST),
        `${JSON.stringify({ name: "fixture", private: true, dependencies: { local: "file:./local" } }, null, 2)}\n`,
      );
      writeFileSync(join(source, ".gitignore"), "node_modules\n");
      execTextSync("bun", ["install", "--no-env-file"], { cwd: source });
      git("add", "-A");
      git("commit", "-qm", "fixture");
      git("worktree", "add", "-q", "--detach", target, "HEAD");

      const prepared = helper("setup", target);
      expect(prepared.output).toContain("no worktree is prepared");
      writeFileSync(join(target, NODE_MODULES, "sentinel"), "kept\n");

      // Commands long enough to still be running when a later caller asks about the tree. Two
      // start together: a single ledger every caller rewrote could keep only one of them.
      const hold = () =>
        Bun.spawn(["bash", scriptPath, "run", target, "sleep", "45"], {
          cwd: source,
          stdout: "ignore",
          stderr: "ignore",
        });
      held = hold();
      second = hold();
      // The pre-exec argv names the script and the tree and ends in the command, so waiting for
      // the word "sleep" would read the parent and never the exec'd process. What changes at the
      // exec is that the script's own name leaves the argv, so that is what this waits for.
      const execd = async (pid: number): Promise<string> => {
        let command = `bash ${scriptPath}`;
        for (let i = 0; i < 100 && command.includes(scriptPath); i += 1) {
          await Bun.sleep(100);
          command = commandOf(pid);
        }
        return command;
      };
      const command = await execd(held.pid);
      await execd(second.pid);
      // The exec left nothing in the argv to recognise: no script name, no worktree path. This is
      // why the hold exists — the process scan reads this tree as free.
      expect(command).toContain("sleep 45");
      expect(command).not.toContain(target);

      // With the marker stale, preparing the tree would remove the modules the command is running
      // against. The pid the tree holds is what refuses it.
      writeFileSync(join(target, marker), "stale\n");
      const refused = helper("run", target, "true");
      expect(refused.status).not.toBe(0);
      expect(refused.output).toContain("in use by a running command");
      expect(existsSync(join(target, NODE_MODULES, "sentinel"))).toBe(true);

      // One holder ending leaves the tree held by the other.
      held.kill();
      await held.exited;
      held = null;
      expect(helper("run", target, "true").output).toContain("in use by a running command");
      expect(existsSync(join(target, NODE_MODULES, "sentinel"))).toBe(true);

      // Once the last command ends its pid names nothing, and the next caller prepares the tree.
      second.kill();
      await second.exited;
      second = null;
      const after = helper("run", target, "touch", join(fixture, "ran"));
      expect(after.status).toBe(0);
      expect(after.stderr).toContain("node_modules");
      expect(existsSync(join(fixture, "ran"))).toBe(true);
    } finally {
      held?.kill();
      second?.kill();
      if (existsSync(target)) {
        spawnTextSync("git", ["worktree", "remove", "--force", target], { cwd: source });
      }
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 120_000);
});

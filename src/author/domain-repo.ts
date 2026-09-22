/**
 * The controller's Git operations on a domain workspace: one repository per campaign epoch, with
 * harness history as a sequence of commits. The repository is initialised over the seeded starter
 * files and reused on restart. The content fingerprint, not Git, identifies the measured bundle.
 */
import {
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { relocateToolLauncher } from "./toolchain-relocation.ts";
import { type SafeguardContext, safeguardTriggered } from "../meta/safeguard.ts";
import { hostTool } from "../meta/host-tool.ts";
import { runtimeProcess } from "../meta/process.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../meta/subprocess.ts";
import { dirname, isAbsolute, join, relative, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";
import { CANDIDATE_INTERFACE, STARTER_MEMORY_FILES, candidatePathAllowed } from "./builder-memory.ts";
import { linkWorkspaceToolTree } from "../claim/bundle-snapshot.ts";

/** Pinned committer identity: workspace history must not depend on the host's git config. */
const GIT_IDENTITY = [
  "-c",
  "user.name=anaBuilder",
  "-c",
  "user.email=builder@ana.local",
  "-c",
  "commit.gpgsign=false",
] as const;

/**
 * Where the workspace exposes the controller's own Bun runtime, as the starter's test command names
 * it. A bare `bun` would depend on a login profile the isolation denies. The link is untracked
 * scratch.
 */
export const WORKSPACE_BUN_LINK = `${WORKSPACE_TOOL_TREE}/bun`;

const PI_STARTER_PACK = new URL("../../starters/pi-built-harness", import.meta.url);
const COMMIT_ID = /^[0-9a-f]{40}$/;

/** The head before and after a commit, and the paths it changed; empty when nothing changed. */
export type WorkspaceChange = {
  baseCommit: string;
  commit: string;
  changedPaths: string[];
  deletedPaths: string[];
};

/** The harness surface `resetWorkspaceToStarter` returns to the starter seed. */
type StarterResetScope = "agent" | "correctness-model" | "all";

function git(dir: string, args: string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-C", dir, ...GIT_IDENTITY, ...args], {
    maxBuffer: CAPTURE_MAX_BYTES,
  }).trim();
}

/**
 * Git tracks exactly the candidate contract; every other path, starter reference included, is
 * scratch. The rules live in `.git/info/exclude`, which is controller-owned and never tracked, so
 * scratch cannot enter any candidate commit and `workspaceStatus` reports only candidate work.
 */
const EXCLUDE = `${["/*", ...CANDIDATE_INTERFACE.map((entry) => `!/${entry}`), "node_modules/", ".bundle-snapshots/"].join("\n")}\n`;
/** Starter reference files, refreshed from the pack on every resume. */
const STARTER_REFERENCES = [
  "STARTER.md",
  "starter-pack/contract.md",
  "starter-pack/examples.md",
  "starter-pack/add-ons.json",
  "starter-pack/difficulty-ladder.md",
] as const;

/** Points the workspace runtime link at this controller's resolved interpreter, since a version
 *  manager's shim may not outlive the session. A linked (inherited, read-only) tool tree is left
 *  alone. */
function linkWorkspaceRuntime(dir: string): void {
  const link = join(dir, WORKSPACE_BUN_LINK);
  if (lstatSync(dirname(link), { throwIfNoEntry: false })?.isSymbolicLink() === true) return;
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(realpathSync.native(runtimeProcess.execPath), link);
}

/** Links the repository's packages into the workspace `node_modules`, so generated package imports
 *  resolve without walking up past the workspace. Controller-owned scratch, re-created each call. */
function linkWorkspacePackageScopes(dir: string): void {
  const modules = join(dir, "node_modules");
  const repositoryModules = realpathSync(new URL("../../node_modules", import.meta.url));
  rmSync(modules, { recursive: true, force: true });
  mkdirSync(modules, { recursive: true });
  for (const name of new Bun.Glob("*").scanSync({ cwd: repositoryModules, onlyFiles: false })) {
    symlinkSync(join(repositoryModules, name), join(modules, name));
  }
  // Under preserve-symlinks, @ana barrel-relative imports resolve lexically, so mirror the source
  // directories with links and give them a lexical node_modules parent. Isolation still admits
  // only the contract files at each physical target.
  const source = join(modules, "src");
  mkdirSync(source, { recursive: true });
  const repositorySource = realpathSync(new URL("../../src", import.meta.url));
  for (const name of new Bun.Glob("*/").scanSync({ cwd: repositorySource, onlyFiles: false })) {
    symlinkSync(join(repositorySource, name), join(source, name));
  }
  symlinkSync("..", join(source, "node_modules"));
}

export function writeExcludeRules(dir: string): void {
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".git", "info", "exclude"), EXCLUDE);
}

/** Replaces the linked, read-only seed tool tree with a writable copy the repair owns. The copy is
 *  made before the link is replaced, so a failed copy leaves the seed for a retry. */
function copySeedToolTree(dir: string, safeguard?: SafeguardContext): void {
  const path = join(dir, WORKSPACE_TOOL_TREE);
  if (!lstatSync(path).isSymbolicLink()) return;
  // Safeguard: a host kill during an earlier copy leaves a partial tree beside the link.
  const leftover = readdirSync(dir).filter((name) => name.startsWith(`${WORKSPACE_TOOL_TREE}-`));
  if (leftover.length > 0) {
    safeguardTriggered(
      "53-rebuild-seed-copy-leftover",
      `count=${String(leftover.length)} first=${leftover.slice(0, 3).join(",")}`,
      safeguard,
    );
  }
  const copy = join(dir, `${WORKSPACE_TOOL_TREE}-${crypto.randomUUID()}`);
  const started = performance.now();
  const counts = { files: 0, relinked: 0, rewritten: 0, singleQuoted: 0, installNames: 0 };
  const dropped: string[] = [];
  try {
    const source = realpathSync(path);
    cpSync(source, copy, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    // Relative links already point inside the copy. Absolute links into the seed are retargeted;
    // external links keep their targets. Linked directories are not followed.
    for (const name of new Bun.Glob("**/*").scanSync({
      cwd: copy,
      dot: true,
      onlyFiles: false,
      followSymlinks: false,
    })) {
      const link = join(copy, name);
      if (!lstatSync(link).isSymbolicLink()) {
        counts.files += 1;
        const relocated = relocateToolLauncher(link, source, path, name);
        // A file that still embeds the adopted path is dropped rather than ending the run, so
        // nothing in the copy resolves into the adopted tree; the Builder can reinstall it.
        if (relocated === "retains-adopted-path") {
          rmSync(link);
          dropped.push(name);
          continue;
        }
        if (relocated === "install-name") counts.installNames += 1;
        else if (relocated !== null) counts.rewritten += 1;
        if (relocated === "rewritten-single-quoted") counts.singleQuoted += 1;
        continue;
      }
      const target = readlinkSync(link);
      if (!isAbsolute(target)) continue;
      // Resolve directory aliases while retaining an unfinished install's missing tail.
      let ancestor = dirname(target);
      while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
      const absolute = resolve(realpathSync(ancestor), relative(ancestor, target));
      if (!containsPath(absolute, source)) continue;
      rmSync(link);
      symlinkSync(relative(dirname(link), join(copy, relative(source, absolute))) || ".", link);
      counts.relinked += 1;
    }
    rmSync(path);
    renameSync(copy, path);
    // Safeguard: record that relocation ran, with its counts.
    safeguardTriggered(
      "54-rebuild-seed-tool-tree-copied",
      `files=${String(counts.files)} relinked=${String(counts.relinked)} launchersRewritten=${String(counts.rewritten)} singleQuoted=${String(counts.singleQuoted)} installNames=${String(counts.installNames)} dropped=${String(dropped.length)}${dropped.length > 0 ? ` droppedFirst=${dropped.slice(0, 3).join(",")}` : ""} ms=${String(Math.round(performance.now() - started))}`,
      safeguard,
    );
    // Safeguard: relocation rewrites launchers only, so a copied venv's `home =` in pyvenv.cfg may
    // still point into the adopted tree.
    const homed = [
      ...new Bun.Glob("**/pyvenv.cfg").scanSync({ cwd: path, dot: true, followSymlinks: false }),
    ].filter((name) => readFileSync(join(path, name), "utf8").includes(`${source}/`));
    if (homed.length > 0) {
      safeguardTriggered(
        "55-rebuild-seed-venv-home-in-adopted-tree",
        `count=${String(homed.length)} first=${homed.slice(0, 3).join(",")}`,
        safeguard,
      );
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/**
 * Ensures `dir` is the domain workspace repo. A new workspace is seeded from the starter (or an
 * adopted bundle) and recorded in a root commit; an existing one keeps its history and has its
 * starter references refreshed.
 */
export function initWorkspace(
  dir: string,
  seedFrom?: string,
  writableSeedTools = false,
  safeguard?: SafeguardContext,
) {
  mkdirSync(dir, { recursive: true });
  linkWorkspaceRuntime(dir);
  linkWorkspacePackageScopes(dir);
  const created = !existsSync(join(dir, ".git"));
  if (created) {
    cpSync(PI_STARTER_PACK, dir, { recursive: true });
    // Seed before `git init`, so a failed copy leaves the workspace uninitialised and retryable.
    if (seedFrom !== undefined) {
      materialiseAdoptedCandidate(seedFrom, dir, safeguard);
      if (writableSeedTools) copySeedToolTree(dir, safeguard);
      linkWorkspaceRuntime(dir);
    }
    for (const [name, content] of STARTER_MEMORY_FILES) {
      const path = join(dir, name);
      if (!existsSync(path)) writeFileSync(path, content);
    }
    git(dir, ["init", "-q"]);
    writeExcludeRules(dir);
    git(dir, ["add", "-A"]);
    git(dir, [
      "commit",
      "-q",
      "-m",
      seedFrom === undefined
        ? "starter: domain workspace skeleton"
        : "controller: seed evaluation from adopted bundle",
    ]);
  } else {
    for (const path of STARTER_REFERENCES) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      cpSync(new URL(`${PI_STARTER_PACK.href}/${path}`), join(dir, path));
    }
    settleTrackedInterface(dir);
    // Safeguard: a resumed repair keeps its in-flight edits; record how many it carried.
    const { dirtyPaths } = workspaceStatus(dir);
    if (seedFrom !== undefined && dirtyPaths.length > 0) {
      safeguardTriggered(
        "56-rebuild-workspace-resumed-dirty",
        `paths=${String(dirtyPaths.length)} first=${dirtyPaths.slice(0, 3).join(",")}`,
        safeguard,
      );
    }
  }
  return { created, head: workspaceHead(dir) };
}

/**
 * Rewrites the exclude rules and untracks every path outside the candidate contract, in its own
 * commit, so the next `changedPaths` carries authoring alone. Files stay on disk. Idempotent.
 */
function settleTrackedInterface(dir: string): void {
  // A staged index belongs to an interrupted pass; `beginIteration` salvages it first.
  if (git(dir, ["diff", "--name-only", "--cached"]) !== "") return;
  writeExcludeRules(dir);
  const outside = git(dir, ["ls-files"])
    .split("\n")
    .filter((path) => path !== "" && !candidatePathAllowed(path));
  if (outside.length === 0) return;
  git(dir, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...outside]);
  if (git(dir, ["diff", "--name-only", "--cached"]) === "") return;
  git(dir, ["commit", "-q", "-m", "workspace: only the candidate contract stays tracked"]);
}

/** HEAD read from the ref files, avoiding a git process on the most frequent call. Handles a direct
 *  commit id or one symbolic ref; anything else returns null and git answers instead. */
function headFromRefFiles(dir: string): string | null {
  try {
    const head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim();
    if (COMMIT_ID.test(head)) return head;
    const ref = /^ref: (refs\/[^\s]+)$/.exec(head)?.[1];
    if (ref === undefined) return null;
    const target = readFileSync(join(dir, ".git", ref), "utf8").trim();
    return COMMIT_ID.test(target) ? target : null;
  } catch {
    return null;
  }
}

export function workspaceHead(dir: string): string {
  return headFromRefFiles(dir) ?? git(dir, ["rev-parse", "HEAD"]);
}

/** A content identity for a candidate that failed validation: the committed tree objects of the two
 *  contract roots. Note files at the workspace root cannot change it. */
export function candidateTreeIdentity(dir: string, commit: string): string {
  const tree = (path: string): string => {
    try {
      return git(dir, ["rev-parse", `${commit}:${path}`]);
    } catch {
      return `absent-${path}`;
    }
  };
  return `candidate-tree-${tree("agent")}-${tree("correctness-model")}`;
}

/** Working-tree cleanliness and dirty paths. `-uall` lists untracked files rather than their
 *  directories. */
export function workspaceStatus(dir: string) {
  const porcelain = git(dir, ["status", "--porcelain", "-uall"]);
  if (porcelain === "") return { clean: true, dirtyPaths: [] };
  // Output is trimmed, so the first row may have lost its leading blank (" M path").
  const dirtyPaths = porcelain.split("\n").map((line) => {
    const path = line.replace(/^[ MADRCU?!]{1,2} /, "");
    const renamed = path.split(" -> ")[1];
    return renamed ?? path;
  });
  return { clean: false, dirtyPaths };
}

/** Changed and deleted paths from one `--name-status` reading; a rename names its destination. */
function changedAndDeleted(value: string) {
  const changedPaths: string[] = [];
  const deletedPaths: string[] = [];
  for (const line of value === "" ? [] : value.split("\n")) {
    const fields = line.split("\t");
    const path = fields.at(-1) ?? "";
    if (fields.length < 2 || path === "") continue;
    changedPaths.push(path);
    if (fields[0]?.startsWith("D") === true) deletedPaths.push(path);
  }
  return { changedPaths, deletedPaths };
}

/** Changes over an exact commit range, so a salvage commit and the later authoring commit read as
 *  one iteration diff. */
export function workspaceChangeBetween(dir: string, baseCommit: string, commit: string): WorkspaceChange {
  if (baseCommit === commit) return { baseCommit, commit, changedPaths: [], deletedPaths: [] };
  return {
    baseCommit,
    commit,
    ...changedAndDeleted(git(dir, ["diff", "--name-status", baseCommit, commit])),
  };
}

/** Stages everything and commits. One `--cached` diff answers both whether to commit and what
 *  changed; an empty stage leaves HEAD where it was. */
export function commitAll(dir: string, message: string): WorkspaceChange {
  const baseCommit = workspaceHead(dir);
  git(dir, ["add", "-A"]);
  const staged = changedAndDeleted(git(dir, ["diff", "--name-status", "--cached"]));
  if (staged.changedPaths.length === 0) return { baseCommit, commit: baseCommit, ...staged };
  git(dir, ["commit", "-q", "-m", message]);
  return { baseCommit, commit: workspaceHead(dir), ...staged };
}

/** Opens an iteration by committing any uncommitted tree left by an interrupted invocation, so
 *  unsettled work is never lost. */
export function beginIteration(dir: string, label: string): WorkspaceChange | null {
  return workspaceStatus(dir).clean ? null : commitAll(dir, `salvage: unsettled tree before ${label}`);
}

/** Returns one harness surface to the starter seed in one commit keyed on `resetKey` and scope, so
 *  a resumed round never repeats the reset over its own work. False when the key already landed. */
export function resetWorkspaceToStarter(
  dir: string,
  resetKey: string,
  scope: StarterResetScope = "all",
): boolean {
  const marker = `reset-key ${resetKey} scope ${scope}`;
  if (git(dir, ["log", "--fixed-strings", `--grep=${marker}`, "-n", "1", "--format=%H"]) !== "") return false;
  // Salvage first, so the reset commit carries only the controller's wipe and re-seed.
  beginIteration(dir, "rebuild reset");
  const surfaces = scope === "all" ? ["agent", "correctness-model"] : [scope];
  git(dir, ["rm", "-r", "-q", "--ignore-unmatch", "--", ...surfaces]);
  for (const surface of surfaces) {
    cpSync(new URL(`${PI_STARTER_PACK.href}/${surface}`), join(dir, surface), { recursive: true });
  }
  if (commitAll(dir, `rebuild: ${scope} reset to starter (${marker})`).changedPaths.length > 0) return true;
  // The key must land in history even when nothing changed, or a later resume would wipe new work.
  git(dir, ["commit", "-q", "--allow-empty", "-m", `rebuild: ${scope} already at starter (${marker})`]);
  return true;
}

/** A new authoring copy is editable; its retained source keeps its own permissions. */
function makeAuthoringCopyWritable(path: string): void {
  const stat = lstatSync(path);
  if (stat.isFile() && stat.nlink === 1) chmodSync(path, stat.mode | 0o200);
  else if (stat.isDirectory()) {
    chmodSync(path, stat.mode | 0o700);
    for (const entry of readdirSync(path)) makeAuthoringCopyWritable(join(path, entry));
  } else throw new Error(`${path}: authoring copy contains an indirect or unsupported entry`);
}

/** Copies agent/ and correctness-model/ byte-identical from the adopted tree and links its tool
 *  tree. */
function materialiseAdoptedCandidate(seedFrom: string, slugDir: string, safeguard?: SafeguardContext): void {
  for (const bundle of ["agent", "correctness-model"] as const) {
    rmSync(join(slugDir, bundle), { recursive: true, force: true });
    cpSync(join(seedFrom, bundle), join(slugDir, bundle), { recursive: true });
    makeAuthoringCopyWritable(join(slugDir, bundle));
  }
  linkWorkspaceToolTree(seedFrom, slugDir);
  // Safeguard: the version's tool tree is a link into the adopted epoch; when its target is gone
  // the workspace gets no tool tree, which would otherwise surface only as tool-missing findings.
  const seedTree = join(seedFrom, WORKSPACE_TOOL_TREE);
  if (lstatSync(seedTree, { throwIfNoEntry: false })?.isSymbolicLink() === true && !existsSync(seedTree)) {
    safeguardTriggered(
      "52-rebuild-seed-tool-tree-unresolved",
      `version=${seedFrom} target=${readlinkSync(seedTree)}`,
      safeguard,
    );
  }
}

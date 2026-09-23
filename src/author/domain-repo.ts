/**
 * The controller's Git operations on a domain workspace: one repository per campaign epoch, with
 * harness history as a sequence of commits in one workspace rather than a set of sibling snapshot
 * directories (operator direction 2026-07-26: "use git for each harness iteration"). The Builder's
 * own notes live in the two Markdown files builder-memory.ts manages.
 *
 * The repository is initialised over the seeded starter files rather than copied from an existing
 * `.git`, and on restart the repository already present is reused, so the workspace keeps its
 * history across invocations. None of this identifies a measured bundle: the content fingerprint
 * does that, and Git is the Builder's memory.
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
 * Where the workspace exposes the controller's own Bun runtime, and the name the starter's test
 * command uses. A bare `bun` would resolve through whatever environment the controller was launched
 * with, and `/bin/sh -lc` cannot repair that, because the profile exporting a version manager's
 * shim sits in the home directory this isolation denies. One link answers it on every host. The
 * link stays workspace scratch, since the exclude rules track the candidate interface only.
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

/** The harness surface `resetWorkspaceToStarter` returns to the starter seed, which is the
 *  Builder's `harness_reset` scope (operator decision 2026-09-07). */
type StarterResetScope = "agent" | "correctness-model" | "all";

function git(dir: string, args: string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-C", dir, ...GIT_IDENTITY, ...args], {
    maxBuffer: CAPTURE_MAX_BYTES,
  }).trim();
}

/**
 * Git tracks exactly the candidate contract; every other path, starter reference included, is
 * workspace scratch. The rules live in `.git/info/exclude` — controller-owned, never tracked,
 * invisible to the Builder's diff — so drift cannot enter a candidate commit at any commit point,
 * whether authoring, salvage or either campaign loop. Run 53's climb stalled on the older shape: a
 * tracked `.gitignore`, then two root helpers, blocked two passes with the task bytes unchanged,
 * and the model answered "delete the helpers" by adding more.
 *
 * Untracked scratch is also what keeps `workspaceStatus` meaning "the Builder left candidate work
 * unsettled". `.bundle-snapshots/`, which is measurement's own recorded sidecar, once made every
 * iteration open with a salvage commit of bundle-snapshot bytes: epoch-3cafcd9e3cfc's `de6545f`
 * carried 11,721 insertions under that label.
 */
const EXCLUDE = `${["/*", ...CANDIDATE_INTERFACE.map((entry) => `!/${entry}`), "node_modules/", ".bundle-snapshots/"].join("\n")}\n`;
/** The workspace contract as the pack ships it, refreshed from the pack on every resume so the
 *  bytes a session reads are fixed by the recorded source commit rather than by whatever an earlier
 *  session left behind. It stays on disk for reading and out of tracking. */
const STARTER_REFERENCES = [
  "STARTER.md",
  "starter-pack/contract.md",
  "starter-pack/examples.md",
  "starter-pack/add-ons.json",
  "starter-pack/difficulty-ladder.md",
] as const;

/** Point the workspace's runtime link at this controller's interpreter, resolved rather than as
 *  named: a version manager's `bun` may be a per-shell shim that outlives no session, while the
 *  install behind it stays put. Only an owned tree is refreshed — a climb or an evaluation repair
 *  inherits the adopted tool tree read-only, and resuming must never rewrite that earlier epoch's
 *  runtime. */
function linkWorkspaceRuntime(dir: string): void {
  const link = join(dir, WORKSPACE_BUN_LINK);
  if (lstatSync(dirname(link), { throwIfNoEntry: false })?.isSymbolicLink() === true) return;
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(realpathSync.native(runtimeProcess.execPath), link);
}

/** Generated package imports resolve by a node_modules walk-up, which in run w29 climbed past the
 *  measured tree; a `campaigns/` symlink broke it entirely and run 52's workspace shim shadowed it.
 *  Bun stops at the workspace `node_modules` that carries the `@ana` link, so both admitted scopes
 *  are linked explicitly here. They are controller-owned scratch and re-created on every call. */
function linkWorkspacePackageScopes(dir: string): void {
  const modules = join(dir, "node_modules");
  const repositoryModules = realpathSync(new URL("../../node_modules", import.meta.url));
  rmSync(modules, { recursive: true, force: true });
  mkdirSync(modules, { recursive: true });
  for (const name of new Bun.Glob("*").scanSync({ cwd: repositoryModules, onlyFiles: false })) {
    symlinkSync(join(repositoryModules, name), join(modules, name));
  }
  // With Bun's preserve-symlinks mode, @ana barrel-relative imports resolve lexically beneath the
  // workspace node_modules tree. So mirror only the source directory structure with links, and
  // then give those modules a lexical node_modules parent. The isolation policy is unaffected: it
  // still admits only the derived contract files at each physical target.
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

/** A repair owns its own tool installs and HOME caches, while the adopted tree it was seeded from
 *  stays read-only, so the linked seed tree is replaced by a writable copy. The copy is made before
 *  the link is replaced, which means a failed copy leaves the seed in place for a retry rather than
 *  leaving the repair with neither. */
function copySeedToolTree(dir: string, safeguard?: SafeguardContext): void {
  const path = join(dir, WORKSPACE_TOOL_TREE);
  if (!lstatSync(path).isSymbolicLink()) return;
  // Safeguard 53: a host kill inside the copy below skips its cleanup and leaves the partial tree
  // beside the link, where it is excluded from Git and otherwise invisible. Simulation 2026-09-15.
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
    // Relative links already name the copied packages. Absolute internal links must move too,
    // while external runtime links keep their targets. A linked directory is never walked, because
    // walking one would lead straight back into the seed.
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
        // A file the copy cannot make stand alone is left out of the copy, not treated as a reason
        // to end the run. The refusal this replaces told its reader to recreate the installation in
        // the repair workspace and then made that impossible: on 2026-09-20 it ended firmware run
        // 4c67fc at round 2 over `acli/tmp/b1/Blink.ino.elf`, a test sketch the Builder had
        // compiled inside the tool's own scratch directory, whose debug strings carry the path of
        // the source it was built from. Dropping the file keeps the whole property the refusal
        // defended — nothing in the repair tree resolves into the adopted one — and leaves the
        // Builder a missing file to reinstall instead of no run to reinstall it in.
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
    // Safeguard 54: the relocation branch (b7dc474ed) had no evidence writer at all; these counts
    // are what say it ran.
    safeguardTriggered(
      "54-rebuild-seed-tool-tree-copied",
      `files=${String(counts.files)} relinked=${String(counts.relinked)} launchersRewritten=${String(counts.rewritten)} singleQuoted=${String(counts.singleQuoted)} installNames=${String(counts.installNames)} dropped=${String(dropped.length)}${dropped.length > 0 ? ` droppedFirst=${dropped.slice(0, 3).join(",")}` : ""} ms=${String(Math.round(performance.now() - started))}`,
      safeguard,
    );
    // Safeguard 55: relocation rewrites launchers only. A copied venv keeps its `home =` line in
    // pyvenv.cfg, so its stdlib still resolves through the adopted tree — which showed up as
    // sys.base_prefix in the simulation.
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
 * Ensure `dir` is the domain workspace repo: seed or refresh the controller-owned STARTER.md,
 * `git init` when no `.git` exists, and record the starter or adopted seed in the root commit. A
 * resumed campaign reuses the repository it created rather than starting a second one, which is
 * what keeps history continuous across invocations.
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
    // Seed before Git marks this workspace initialised, so a failed copy stays retryable; an
    // existing repository keeps its in-flight correction when the same pass resumes.
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
    // Safeguard 56: a resumed repair keeps its in-flight edits by design. Name how many it carried,
    // because accepted bytes decide attribution and a partial pass is otherwise indistinguishable
    // from a fresh one.
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
 * A repository born under wider rules keeps tracking paths the contract excludes — a legacy
 * `.gitignore`, swept-in bundle-snapshot bytes, starter reference, drift from an earlier pass.
 * Bring the exclude rules forward and untrack everything outside the contract, as its own commit,
 * so the migration is attributable and the next iteration's `changedPaths` carries authoring alone.
 * Idempotent: a repository already current stages nothing and commits nothing. History keeps the
 * bytes it recorded and the working tree keeps the files; only tracking ends.
 */
function settleTrackedInterface(dir: string): void {
  // A staged index at campaign start belongs to an interrupted pass. Committing it under this
  // label would repeat the mislabelling the migration exists to end, so `beginIteration` salvages
  // it first and the next campaign start migrates.
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

/** HEAD read from the ref files instead of through a `git rev-parse` process. This module creates
 *  every workspace repository, so HEAD is either a direct commit id or one symbolic ref under
 *  `.git/refs/`. Anything else — a packed ref, a chained symref, a `.git` file, a repository this
 *  owner did not create — reads as unknown and the answer comes from git, which stays the
 *  authority. It is worth the special case because this is the most frequent call here: each commit
 *  path asks twice, and a repository with a hundred iterations spends more time starting git than
 *  reading its own head. */
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

/** A content identity for a candidate that failed validation, taken from the committed tree objects
 *  of the two contract roots. The workspace-root note files sit outside both roots, so note churn
 *  between two otherwise identical resubmits does not create a new identity — which is the same
 *  exclusion the bundle snapshot id applies after a successful validation, so a refused candidate
 *  and an accepted one agree about what counts as the same bytes. */
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

/** Working-tree cleanliness and the dirty paths, which is the candidate-check fact: a submission is
 *  the tree at a commit. `-uall` lists untracked files individually instead of collapsing them to
 *  their directory, because a caller that names paths cannot name a directory. */
export function workspaceStatus(dir: string) {
  const porcelain = git(dir, ["status", "--porcelain", "-uall"]);
  if (porcelain === "") return { clean: true, dirtyPaths: [] };
  // The git helper trims stdout, which also drops the leading blank of an unstaged first row
  // (" M path"), so the status-letter prefix is matched with a flexible width rather than two.
  const dirtyPaths = porcelain.split("\n").map((line) => {
    const path = line.replace(/^[ MADRCU?!]{1,2} /, "");
    const renamed = path.split(" -> ")[1];
    return renamed ?? path;
  });
  return { clean: false, dirtyPaths };
}

/** Changed and deleted paths from one `--name-status` reading. A rename names its destination, the
 *  spelling `--name-only` already returned, and the `D` lines are the deletions a second pass used
 *  to ask git for separately. */
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

/** Changes over an exact commit range. This is what joins an interrupted-work recovery commit to
 *  the later authoring commit without hiding the first half of the iteration diff. An empty span —
 *  the commit that never happened — is answered without asking git at all. */
export function workspaceChangeBetween(dir: string, baseCommit: string, commit: string): WorkspaceChange {
  if (baseCommit === commit) return { baseCommit, commit, changedPaths: [], deletedPaths: [] };
  return {
    baseCommit,
    commit,
    ...changedAndDeleted(git(dir, ["diff", "--name-status", baseCommit, commit])),
  };
}

/** Stage everything and commit, returning the resulting head and the paths this commit changed. A
 *  clean tree commits nothing and returns the current head with `changedPaths: []`, because "no
 *  change" is a first-class answer rather than an error: it is how a repair pass proves the
 *  untouched layers really stayed untouched. The staged span is the same span the commit will
 *  carry, so one `--cached` diff answers both "is there anything to commit" and "what changed" —
 *  asking git twice cost a second process on every settled commit. */
export function commitAll(dir: string, message: string): WorkspaceChange {
  const baseCommit = workspaceHead(dir);
  git(dir, ["add", "-A"]);
  const staged = changedAndDeleted(git(dir, ["diff", "--name-status", "--cached"]));
  if (staged.changedPaths.length === 0) return { baseCommit, commit: baseCommit, ...staged };
  git(dir, ["commit", "-q", "-m", message]);
  return { baseCommit, commit: workspaceHead(dir), ...staged };
}

/** Open an iteration by salvaging any uncommitted tree an interrupted invocation left behind, under
 *  its own attributed label. Unsettled Builder work is memory, so it is committed rather than
 *  silently lost or rolled into whatever the next commit is for. */
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
  // Salvage first: unsettled Builder work gets its own attributed commit, so the reset commit
  // below carries only the controller's wipe and re-seed and nothing of the Builder's is filed
  // under the controller's label.
  beginIteration(dir, "rebuild reset");
  const surfaces = scope === "all" ? ["agent", "correctness-model"] : [scope];
  git(dir, ["rm", "-r", "-q", "--ignore-unmatch", "--", ...surfaces]);
  for (const surface of surfaces) {
    cpSync(new URL(`${PI_STARTER_PACK.href}/${surface}`), join(dir, surface), { recursive: true });
  }
  if (commitAll(dir, `rebuild: ${scope} reset to starter (${marker})`).changedPaths.length > 0) return true;
  // A workspace already at the starter wipes nothing, but the key must still land in history:
  // otherwise a session that authors after this no-op and then dies would be wiped by its own
  // resume, which would read the key as never having been applied.
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

/** Rebuild agent/ and correctness-model/ byte-identical from the adopted tree, and link that tree's
 *  installed tools: truss-run9-sol lost every control to a missing `.toolchain`, because a bundle
 *  without its tools is a bundle whose checks cannot run. */
function materialiseAdoptedCandidate(seedFrom: string, slugDir: string, safeguard?: SafeguardContext): void {
  for (const bundle of ["agent", "correctness-model"] as const) {
    rmSync(join(slugDir, bundle), { recursive: true, force: true });
    cpSync(join(seedFrom, bundle), join(slugDir, bundle), { recursive: true });
    makeAuthoringCopyWritable(join(slugDir, bundle));
  }
  linkWorkspaceToolTree(seedFrom, slugDir);
  // Safeguard 52: the retained version keeps its tool tree as a link into the adopted epoch. When
  // that target is gone — archives moved, say — the link above is skipped and the seeded workspace
  // has only the runtime link. That loss surfaced later as tool-missing findings with no stated
  // cause, which is the shape a sensor is for.
  const seedTree = join(seedFrom, WORKSPACE_TOOL_TREE);
  if (lstatSync(seedTree, { throwIfNoEntry: false })?.isSymbolicLink() === true && !existsSync(seedTree)) {
    safeguardTriggered(
      "52-rebuild-seed-tool-tree-unresolved",
      `version=${seedFrom} target=${readlinkSync(seedTree)}`,
      safeguard,
    );
  }
}

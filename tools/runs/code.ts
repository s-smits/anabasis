/**
 * Remote and local checkout preparation for fresh campaigns, transfers, and continuations. Remote
 * launch verbs execute from a detached controller worktree pinned to the requested published commit
 * rather than whatever revision the host's main checkout holds, leaving live runs and the configured
 * tree undisturbed. Cold controllers fetch, verify remote publication, and run a frozen dependency
 * install; launch preparation re-verifies the exact commit, while routine read requests reuse a
 * cached controller after confirming its working tree is clean.
 */
import { existsSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree } from "#src/meta/git.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { capturedExecPath, warn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextOrThrow, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, configuredRuntime } from "./host-config.ts";
import { quoted, shellPath, sshScript, treeBun } from "./host-command.ts";

/** Preparation mode: reuse an existing cached controller or force a fresh verification and install. */
type Mode = "cached" | "install";

/** Subdirectory under the shared Git directory holding one controller worktree per commit. `PRUNE`
 *  retains the three most recent controllers; `runs retire` leaves this directory to `PRUNE`. */
const CONTROLLERS = "ana-code";
/** Timeout for remote preparation, accommodating cold frozen installs on Linux hosts. */
const PREPARE_MS = 300_000;
const warned = new Set<string>();
/** Deduplicates concurrent controller preparations per `(host, commit)` within a process so parallel
 *  remote calls do not contend on `git fetch` ref locks or the preparation lock directory. */
const preparing = new Map<string, Promise<Host | null>>();

/** Shell helper deciding whether lock directory `$1` is stale (matching `holder.ts`): returns true
 *  when the recorded PID is no longer alive, or when no PID was written (killed mid-creation) and
 *  the directory is older than `PREPARE_MS`. PID reuse is tolerated conservatively. Taking over a
 *  stale lock prevents crashed preparations from permanently blocking pruning; active holders are
 *  waited on because concurrent `git fetch` calls race on refs and cold installs can exceed `PREPARE_MS`. */
const STALE = `stale() {
  holder="$(cat "$1/pid" 2>/dev/null || true)"
  case "$holder" in ''|*[!0-9]*) ;; *) ! kill -0 "$holder" 2>/dev/null; return;; esac
  stamp="$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1")"
  test "$(($(date +%s) - stamp))" -gt ${String(PREPARE_MS / 1000)}
}`;

/** Prunes old, idle controller worktrees beyond the newest three. Preserves all controllers if
 *  process inspection fails. Uses `running` rather than `commands` because `zsh` reserves `commands`. */
const PRUNE = `
if running="$(ps -axww -o args=)"; then
  if command -v lsof >/dev/null 2>&1; then
    cwds="$(lsof -a -d cwd -Fn 2>/dev/null)" || cwds=unknown
  elif test -d /proc/self; then
    cwds="$(for cwd in /proc/[0-9]*/cwd; do readlink "$cwd" 2>/dev/null || true; done)"
  else cwds=unknown; fi
  if test "$cwds" != unknown; then
    count=0
    ls -t "$root"/*.ready | while IFS= read -r marker; do
      count=$((count + 1))
      test "$count" -gt 3 || continue
      candidate="\${marker%.ready}"
      test "$candidate" != "$tree" || continue
      if test -d "$candidate.lock" && ! stale "$candidate.lock"; then continue; fi
      case "$running
$cwds" in *"$candidate"*) continue;; esac
      if git worktree remove "$candidate"; then rm -rf "$marker" "$candidate.lock"; fi
    done
  fi
fi`;

/** Returns the controller directory inside the shared Git directory of `repo`. */
export const controllersOf = (repo: string) =>
  join(gitText(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), CONTROLLERS);

/** Resolves the nearest published ancestor of `HEAD` so remote reads work from unpublished branches. */
function readCommit(): string {
  const repo = import.meta.dir;
  const head = gitText(repo, "rev-parse", "HEAD");
  const tips = gitText(repo, "for-each-ref", "--format=%(objectname)", "refs/remotes")
    .split("\n")
    .filter((tip) => tip !== "");
  if (tips.length === 0) throw new Error("no remote branch holds a controller revision");
  const commit = gitText(repo, "merge-base", head, ...tips);
  if (commit !== head && !warned.has(head)) {
    warn(`remote reads use published ancestor ${commit.slice(0, 9)} of HEAD ${head.slice(0, 9)}`);
    warned.add(head);
  }
  return commit;
}

/** Fetches `origin`, resolves `revision` to a commit SHA, and verifies that it is reachable from a
 *  remote branch or remote ref (such as a pushed run tag after branch rewrites). */
export function publishedAt(tree: string, revision: string): string {
  gitText(tree, "fetch", "-q", "origin");
  const commit = gitText(tree, "rev-parse", "--verify", `${revision}^{commit}`);
  const named = () =>
    gitText(tree, "ls-remote", "origin")
      .split("\n")
      .some((ref) => ref.startsWith(`${commit}\t`));
  if (gitText(tree, "branch", "-r", "--contains", commit) === "" && !named()) {
    throw new Error(`${commit.slice(0, 9)} is on no remote branch or tag`);
  }
  return commit;
}

/** Checks out `commit` in a clean campaign worktree `tree` and installs frozen dependencies. */
export function installAt(tree: string, commit: string): void {
  if (gitText(tree, "status", "--porcelain") !== "") {
    throw new Error(`${tree} holds a change no commit names`);
  }
  if (gitText(tree, "rev-parse", "HEAD") !== commit) {
    gitText(tree, "checkout", "-q", "--detach", commit);
  }
  runTextSyncOrThrow(["nice", "-n", "10", capturedExecPath, "install", "--frozen-lockfile"], { cwd: tree });
}

/** Returns the sibling worktree path where `treeAt` checks out `commit`. */
export const atCommit = (repo: string, commit: string) =>
  join(dirname(mainTree(repo)), `anabasis-at-${commit.slice(0, 9)}`);

/** Ensures a detached worktree at `commit` with installed dependencies exists for readers or seeds
 *  requiring historical code; returns null if `commit` is absent from the repository. */
export function treeAt(repo: string, commit: string): string | null {
  if (gitMaybe(repo, "cat-file", "-e", `${commit}^{commit}`) === null) return null;
  const tree = atCommit(repo, commit);
  if (!existsSync(tree)) gitText(repo, "worktree", "add", "-q", "--detach", tree, commit);
  if (!existsSync(join(tree, "node_modules"))) installAt(tree, commit);
  return tree;
}

/** Generates the remote shell script shared by one-shot launch preparation and cached read requests.
 *  Successful frozen installs are cached by commit outside the checkout and re-verified on launch. */
function preparation(host: Host, commit: string, mode: Mode): string {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("host preparation needs a whole commit id");
  return `set -eu
${STALE}
cd ${shellPath(host.tree)}
root="$(git rev-parse --path-format=absolute --git-common-dir)/${CONTROLLERS}"
tree="$root/${commit}"
unready() { ! test -f "$root/${commit}.ready" || ! test -d "$tree/node_modules"; }
if ${mode === "install" ? "true" : "unready"}; then
mkdir -p "$root"
lock="$root/${commit}.lock"
until mkdir "$lock" 2>/dev/null; do
  if stale "$lock"; then mv "$lock" "$lock.stale.$$" && rm -rf "$lock.stale.$$"; else sleep 1; fi
done
echo "$$" > "$lock/pid"
trap 'rm -f "$lock/pid"; rmdir "$lock"' EXIT
git fetch -q origin
git cat-file -e ${quoted(`${commit}^{commit}`)} 2>/dev/null || git fetch -q origin ${quoted(commit)}
test "$(git rev-parse --verify ${quoted(`${commit}^{commit}`)})" = ${quoted(commit)}
test -n "$(git branch -r --contains ${quoted(commit)})" || git ls-remote origin | grep -q ${quoted(`^${commit}	`)} || { echo 'commit is on no remote branch or tag' >&2; exit 1; }
if unready; then
rm -f "$root/${commit}.ready"
if ! test -e "$tree"; then git worktree add -q --detach "$tree" ${quoted(commit)}; fi
cd "$tree"
test "$(git rev-parse HEAD)" = ${quoted(commit)}
test -z "$(git status --porcelain)" || { echo 'control tree has uncommitted changes' >&2; exit 1; }
${treeBun(configuredRuntime(host).bun)} install --frozen-lockfile >&2
touch "$root/${commit}.ready"
${PRUNE}
fi
rm -f "$lock/pid"
rmdir "$lock"
trap - EXIT
fi
cd "$tree"
test "$(git rev-parse HEAD)" = ${quoted(commit)}
test -z "$(git status --porcelain)" || { echo 'control tree has uncommitted changes' >&2; exit 1; }`;
}

/** Prepares a remote controller directly over SSH without relying on an older remote CLI to update itself. */
export async function preparedHost(host: Host, commit: string, mode: Mode = "install"): Promise<Host> {
  const script = `${preparation(host, commit, mode)}\nprintf '%s\\n' "$tree"`;
  const tree = (await runTextOrThrow(sshScript(host, script), { timeout: PREPARE_MS })).trim();
  if (!isAbsolute(tree) || tree.includes("\n")) throw new Error(`${host.name}: no prepared control tree`);
  return { ...host, ...configuredRuntime(host), tree, prepared: true };
}

/** Prepares cached controllers on `hosts` in parallel before short-timeout read requests begin. */
export async function readControllers(hosts: readonly Host[]): Promise<(Host | null)[]> {
  if (hosts.length === 0) return [];
  const commit = readCommit();
  return await Promise.all(
    hosts.map((host) => {
      const key = `${host.name} ${commit}`;
      const prepared =
        preparing.get(key) ?? readController(host, commit).finally(() => preparing.delete(key));
      preparing.set(key, prepared);
      return prepared;
    }),
  );
}

async function readController(host: Host, commit: string): Promise<Host | null> {
  const started = performance.now();
  try {
    return await preparedHost(host, commit, "cached");
  } catch (error) {
    console.error(
      `${host.name}: ${errorMessage(error)} after ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    return null;
  }
}

/**
 * Remote and local checkout preparation for fresh campaigns, transfers and continuations. Remote
 * verbs run from a detached controller worktree pinned to the requested published commit, not
 * whatever the host's main checkout holds.
 */
import { existsSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree } from "#src/meta/git.ts";
import { dirname, isAbsolute, join } from "#src/meta/path.ts";
import { capturedExecPath, warn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextOrThrow, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, configuredRuntime } from "./host-config.ts";
import { quoted, shellPath, sshScript, treeBun } from "./host-command.ts";

type Mode = "cached" | "install";

/** One controller worktree per commit under the shared Git directory; `PRUNE` keeps the newest
 *  three, and `runs retire` leaves this directory to it. */
const CONTROLLERS = "ana-code";
/** Timeout for remote preparation, long enough for cold frozen installs on Linux hosts. */
const PREPARE_MS = 300_000;
/** How long a verified read controller stays cached in-process before re-checking clean state. */
const CONTROLLER_TTL_MS = 60_000;
const warned = new Set<string>();
/** Deduplicates read controller checks per `(host, commit)` in one process. */
const preparing = new Map<string, { until: number; promise: Promise<Host | null> }>();

/** Whether lock directory `$1` is stale (as `holder.ts` reads one): its recorded PID is dead, or
 *  none was written and it is older than `PREPARE_MS`. A stale lock is taken over so a crashed
 *  preparation never blocks pruning; live holders are waited on, since concurrent `git fetch` calls
 *  race on refs. */
const STALE = `stale() {
  holder="$(cat "$1/pid" 2>/dev/null || true)"
  case "$holder" in ''|*[!0-9]*) ;; *) ! kill -0 "$holder" 2>/dev/null; return;; esac
  stamp="$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1")"
  test "$(($(date +%s) - stamp))" -gt ${String(PREPARE_MS / 1000)}
}`;

/** Prunes idle controller worktrees beyond the newest three, keeping all if process inspection
 *  fails. The variable is `running` because `zsh` reserves `commands`. */
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

export const controllersOf = (repo: string) =>
  join(gitText(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), CONTROLLERS);

/** The nearest published ancestor of `HEAD`, so remote reads work from unpublished branches. */
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

/** Fetches `origin`, resolves `revision`, and checks it is reachable from a remote branch or ref
 *  (such as a pushed run tag after branch rewrites). */
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

export const atCommit = (repo: string, commit: string) =>
  join(dirname(mainTree(repo)), `anabasis-at-${commit.slice(0, 9)}`);

/** A detached worktree at `commit` with installed dependencies, for readers or seeds that need
 *  historical code; null where the repository lacks `commit`. */
export function treeAt(repo: string, commit: string): string | null {
  if (gitMaybe(repo, "cat-file", "-e", `${commit}^{commit}`) === null) return null;
  const tree = atCommit(repo, commit);
  if (!existsSync(tree)) gitText(repo, "worktree", "add", "-q", "--detach", tree, commit);
  if (!existsSync(join(tree, "node_modules"))) installAt(tree, commit);
  return tree;
}

/** The remote shell script shared by launch preparation and cached read requests. Frozen installs
 *  are cached by commit outside the checkout and re-verified on launch. */
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

/** Prepares a remote controller directly over SSH, without relying on an older remote CLI to update
 *  itself. */
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
  const now = Date.now();
  return await Promise.all(
    hosts.map((host) => {
      const key = `${host.name} ${commit}`;
      const cached = preparing.get(key);
      if (cached !== undefined && cached.until > now) return cached.promise;
      const promise = readController(host, commit).then((ready) => {
        if (ready === null) preparing.delete(key);
        else preparing.set(key, { until: Date.now() + CONTROLLER_TTL_MS, promise });
        return ready;
      });
      preparing.set(key, { until: now + PREPARE_MS, promise });
      return promise;
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

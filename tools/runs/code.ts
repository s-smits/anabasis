/**
 * Code preparation for a fresh campaign, a transfer and a continuation (22 October 2026).
 * A remote verb used to run whatever source its configured checkout held, leaving the scheduled
 * fork to update that checkout by hand. Remote launch verbs now run from a detached control
 * worktree at the requested published commit. The configured tree and its live runs stay put.
 * Cold controllers fetch, check publication and install frozen dependencies. Launch preparation
 * checks its exact commit again. Ordinary requests reuse a successful install while checking its clean source.
 */
import { gitText } from "#src/meta/git.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, configuredRuntime } from "./host-config.ts";
import { quoted, remoteEnd, remoteText, shellPath, sshScript, treeBun } from "./host-command.ts";

/** The folder in the common Git directory that holds one controller a commit. `PRUNE` keeps the
 *  newest three, and `runs retire` leaves every tree in it to that. */
const CONTROLLERS = "ana-code";
/** A cold Linux controller can need several minutes for its frozen install. */
const PREPARE_MS = 300_000;
const warned = new Set<string>();

/** The shell function that says whether the lock folder `$1` is stale: older than a preparation
 *  may take, or held by a process that is gone. A preparation takes a stale lock of its own commit
 *  over, and `PRUNE` removes a controller behind one: on 22 October a preparation on the M1 left
 *  `c5e16d7f.lock`, which kept that controller from pruning for good. */
const STALE = `stale() {
  stamp="$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1")"
  test "$(($(date +%s) - stamp))" -le ${String(PREPARE_MS / 1000)} || return 0
  holder="$(cat "$1/pid" 2>/dev/null || true)"
  case "$holder" in ''|*[!0-9]*) return 1;; esac
  ! kill -0 "$holder" 2>/dev/null
}`;

/** Only old, idle controllers are disposable. Failure to inspect processes preserves them.
 *  The process list is `running`: zsh, a macOS login shell, reserves `commands` (22 October). */
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

/** Where the repository `repo` lies in keeps its controllers. */
export const controllersOf = (repo: string) =>
  join(gitText(repo, "rev-parse", "--path-format=absolute", "--git-common-dir"), CONTROLLERS);

/** Read at the nearest published ancestor, even from an unpublished caller worktree. */
function readCommit(): string {
  const repo = import.meta.dir;
  const head = gitText(repo, "rev-parse", "HEAD");
  const tips = gitText(repo, "for-each-ref", "--format=%(objectname)", "refs/remotes")
    .split("\n")
    .filter((tip) => tip !== "");
  if (tips.length === 0) throw new Error("no remote branch holds a controller revision");
  const commit = gitText(repo, "merge-base", head, ...tips);
  if (commit !== head && !warned.has(head)) {
    console.error(`remote reads use published ancestor ${commit.slice(0, 9)} of HEAD ${head.slice(0, 9)}`);
    warned.add(head);
  }
  return commit;
}

/** Resolve a requested revision after fetching, and refuse a commit no remote branch holds and no
 *  remote ref names. A campaign's commit may be held by its pushed run tag alone: on 23 October a
 *  move was refused for one whose branch had been rewritten. */
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

/** Install a clean campaign tree at a published commit, after the caller checks its log. */
export function installAt(tree: string, commit: string): void {
  if (gitText(tree, "status", "--porcelain") !== "") {
    throw new Error(`${tree} holds a change no commit names`);
  }
  if (gitText(tree, "rev-parse", "HEAD") !== commit) {
    gitText(tree, "checkout", "-q", "--detach", commit);
  }
  runTextSyncOrThrow(["nice", "-n", "10", capturedExecPath, "install", "--frozen-lockfile"], { cwd: tree });
}

/** Shell text shared by one-shot preparation and ordinary host requests. A successful frozen
 *  install is cached by commit outside the tree. It is checked again before a launch. */
function preparation(host: Host, commit: string, mode: "cached" | "install"): string {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("host preparation needs a whole commit id");
  return `set -eu
${STALE}
cd ${shellPath(host.tree)}
root="$(git rev-parse --path-format=absolute --git-common-dir)/${CONTROLLERS}"
tree="$root/${commit}"
if ${mode === "install" ? "true" : `! test -f "$root/${commit}.ready" || ! test -d "$tree/node_modules"`}; then
git fetch -q origin
git cat-file -e ${quoted(`${commit}^{commit}`)} 2>/dev/null || git fetch -q origin ${quoted(commit)}
test "$(git rev-parse --verify ${quoted(`${commit}^{commit}`)})" = ${quoted(commit)}
test -n "$(git branch -r --contains ${quoted(commit)})" || git ls-remote origin | grep -q ${quoted(`^${commit}	`)} || { echo 'commit is on no remote branch or tag' >&2; exit 1; }
fi
if ! test -f "$root/${commit}.ready" || ! test -d "$tree/node_modules"; then
mkdir -p "$root"
lock="$root/${commit}.lock"
if test -d "$lock" && stale "$lock"; then
  mv "$lock" "$lock.stale.$$"
  rm -rf "$lock.stale.$$"
fi
mkdir "$lock" || { echo 'code preparation is already in progress' >&2; exit 1; }
echo "$$" > "$lock/pid"
trap 'rm -f "$lock/pid"; rmdir "$lock"' EXIT
rm -f "$root/${commit}.ready"
if ! test -e "$tree"; then git worktree add -q --detach "$tree" ${quoted(commit)}; fi
cd "$tree"
test "$(git rev-parse HEAD)" = ${quoted(commit)}
test -z "$(git status --porcelain)" || { echo 'control tree has uncommitted changes' >&2; exit 1; }
${treeBun(configuredRuntime(host).bun)} install --frozen-lockfile >&2
touch "$root/${commit}.ready"
${PRUNE}
rm -f "$lock/pid"
rmdir "$lock"
trap - EXIT
fi
cd "$tree"
test "$(git rev-parse HEAD)" = ${quoted(commit)}
test -z "$(git status --porcelain)" || { echo 'control tree has uncommitted changes' >&2; exit 1; }`;
}

/** Prepare the remote controller without asking its possibly older CLI to update itself. */
export function preparedHost(host: Host, commit: string): Host {
  const script = `${preparation(host, commit, "install")}\nprintf '%s\\n' "$tree"`;
  const tree = remoteText(host, script, { timeout: PREPARE_MS }).trim();
  if (!isAbsolute(tree) || tree.includes("\n")) throw new Error(`${host.name}: no prepared control tree`);
  return { ...host, ...configuredRuntime(host), tree, prepared: true };
}

/** Finish cold preparation before starting any request's short response deadline. */
export async function readControllers(hosts: readonly Host[]): Promise<(Host | null)[]> {
  if (hosts.length === 0) return [];
  const commit = readCommit();
  return await Promise.all(
    hosts.map(async (host) => {
      const started = performance.now();
      try {
        const script = `${preparation(host, commit, "cached")}\nprintf '%s\\n' "$tree"`;
        const child = capturedSpawn(sshScript(host, script), {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: PREPARE_MS,
        });
        const [said, errors, exited] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const tree = said.trim();
        const { code, stderr } = remoteEnd(exited, errors);
        if (code !== 0 || !isAbsolute(tree) || tree.includes("\n")) {
          throw new Error(`controller preparation failed (${String(code)}): ${stderr.trim()}`);
        }
        return { ...host, ...configuredRuntime(host), tree, prepared: true } as const;
      } catch (error) {
        console.error(
          `${host.name}: ${errorMessage(error)} after ${((performance.now() - started) / 1000).toFixed(1)} s`,
        );
        return null;
      }
    }),
  );
}

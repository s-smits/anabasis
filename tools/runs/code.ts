/**
 * Code preparation for a fresh campaign, a transfer and a continuation (22 October 2026).
 * A remote verb used to run whatever source its configured checkout held, leaving the scheduled
 * fork to update that checkout by hand. Remote launch verbs now run from a detached control
 * worktree at the requested published commit. The configured tree and its live runs stay put.
 * Cold controllers fetch, check publication and install frozen dependencies. Launch preparation
 * checks its exact commit again. Ordinary requests reuse a successful install while checking its clean source.
 */
import { gitText } from "#src/meta/git.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { type Host, configuredRuntime } from "./host-config.ts";
import { quoted, shellPath, sshScript } from "./host-command.ts";

/** A cold Linux controller can need several minutes for its frozen install. */
const PREPARE_MS = 300_000;
const warned = new Set<string>();

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
      test ! -d "$candidate.lock" || continue
      case "$running
$cwds" in *"$candidate"*) continue;; esac
      if git worktree remove "$candidate"; then rm -f "$marker"; fi
    done
  fi
fi`;

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

/** Resolve a requested revision after fetching, and refuse a commit on no remote branch. */
export function publishedAt(tree: string, revision: string): string {
  gitText(tree, "fetch", "-q", "origin");
  const commit = gitText(tree, "rev-parse", "--verify", `${revision}^{commit}`);
  if (gitText(tree, "branch", "-r", "--contains", commit) === "") {
    throw new Error(`${commit.slice(0, 9)} is on no remote branch`);
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
cd ${shellPath(host.tree)}
root="$(git rev-parse --path-format=absolute --git-common-dir)/ana-code"
tree="$root/${commit}"
if ${mode === "install" ? "true" : `! test -f "$root/${commit}.ready" || ! test -d "$tree/node_modules"`}; then
git fetch -q origin
test "$(git rev-parse --verify ${quoted(`${commit}^{commit}`)})" = ${quoted(commit)}
test -n "$(git branch -r --contains ${quoted(commit)})" || { echo 'commit is on no remote branch' >&2; exit 1; }
fi
if ! test -f "$root/${commit}.ready" || ! test -d "$tree/node_modules"; then
mkdir -p "$root"
lock="$root/${commit}.lock"
if test -d "$lock"; then
  stamp="$(stat -c %Y "$lock" 2>/dev/null || stat -f %m "$lock")"
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  stale=no
  test "$(($(date +%s) - stamp))" -le ${String(PREPARE_MS / 1000)} || stale=yes
  case "$pid" in ''|*[!0-9]*) ;; *) kill -0 "$pid" 2>/dev/null || stale=yes;; esac
  if test "$stale" = yes; then
    mv "$lock" "$lock.stale.$$"
    rm -rf "$lock.stale.$$"
  fi
fi
mkdir "$lock" || { echo 'code preparation is already in progress' >&2; exit 1; }
echo "$$" > "$lock/pid"
trap 'rm -f "$lock/pid"; rmdir "$lock"' EXIT
rm -f "$root/${commit}.ready"
if ! test -e "$tree"; then git worktree add -q --detach "$tree" ${quoted(commit)}; fi
cd "$tree"
test "$(git rev-parse HEAD)" = ${quoted(commit)}
test -z "$(git status --porcelain)" || { echo 'control tree has uncommitted changes' >&2; exit 1; }
${shellPath(configuredRuntime(host).bun)} install --frozen-lockfile >&2
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
  const tree = runTextSyncOrThrow(sshScript(host, script), { timeout: PREPARE_MS }).trim();
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
        const [said, errors, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const tree = said.trim();
        if (code !== 0 || !isAbsolute(tree) || tree.includes("\n")) {
          throw new Error(`controller preparation failed (${String(code)}): ${errors.trim()}`);
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

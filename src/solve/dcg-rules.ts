/**
 * Shell rules the two model-visible surfaces carry: the Harness Builder's system prompt and the
 * Built shell's tool description. Both shells run behind the same destructive-command guard, so a
 * refusal quotes a line from the list its own agent was shown.
 *
 * The lists differ because the shells do. The Builder edits one workspace under git; the Built
 * shell runs each command in a fresh folder with no repository and no `.toolchain`, so its list has
 * no git-revert or installed-tool line and names a literal `/tmp` child where the Builder names
 * `scratch/.trash/`. Neither names `$TMPDIR` as a move destination, because dcg refuses a move to a
 * variable-rooted path and a refusal quoting that spelling would be refused in turn.
 *
 * Each list holds at most eight short rules, because it is paid on every turn of both agents.
 */
export const DCG_RULES: readonly string[] = [
  "Refused: rm -r outside the workspace, find -delete, git clean, git reset --hard.",
  "Delete a workspace tree with rm -rf <relative path>; for anything else move a tree into scratch/.trash/ instead.",
  "Revert a file with git checkout -- <path> or git restore <path>; keep a cp copy of what has no commit.",
  "Write only under the workspace, $HOME, $TMPDIR and /tmp, with > to a literal path, $HOME/<name> or $TMPDIR/<name>; a redirect to any other $VAR/… is refused; make temp dirs with mktemp -d.",
  "Run from the workspace root with relative paths; do not cd or scan the filesystem.",
  "A command has minutes by default; pass timeout for a long build, never for a search.",
  "Reuse tool data the harness installed in .toolchain; point new config, data and caches at $HOME.",
  "A refused command runs nothing: change the spelling and run it again.",
];
/** Each Built command starts in a fresh folder that is removed afterwards (built-bash.ts), so there
 *  is no workspace root to name, and its time walls come from agent/config.yaml. The guard caller
 *  admits a redirect to `$HOME` (command-guard.ts `privateScratchRedirect`); `$TMPDIR` is left out
 *  because the Built shell makes it fresh for each command and never reads it back. */
export const BUILT_SHELL_RULES: readonly string[] = [
  "Refused: rm -r outside the command's own folder, find -delete, git clean, git reset --hard.",
  "Delete a tree with rm -rf <relative path> or ~/<path>, also after cd ~; /tmp is shared with other solves, so keep your trees in $HOME.",
  "Write with > to $HOME/<name>, ~/<name>, a relative name or a literal /tmp/<name>; a redirect to any other $VAR/… is refused; make temp dirs with mktemp -d.",
  "Keep scripts and results in $HOME; do not scan the filesystem.",
  "A command has a default time limit; pass timeout for a long build, never for a search.",
  "A refused command runs nothing: change the spelling and run it again.",
];

/** The rule line stating the accepted spelling for a dcg rule id, which a refusal quotes so the fix
 *  arrives with it. Lines match on their opening words rather than position, so the two lists can
 *  hold different rules. */
const ACCEPTED_BY_RULE: ReadonlyArray<[RegExp, RegExp]> = [
  [/^core\.filesystem:(rm-|find-)/, /^Delete a /],
  // Only the ids whose fix the revert line states; a push or stash refusal quotes nothing.
  [/^core\.git:(checkout|restore|reset|clean)/, /^Revert a file/],
  [/^core\.filesystem:redirect-/, /^Write /],
];

export function acceptedSpelling(ruleId: string, rules: readonly string[]): string | null {
  const hit = ACCEPTED_BY_RULE.find(([pattern]) => pattern.test(ruleId));
  return hit === undefined ? null : (rules.find((line) => hit[1].test(line)) ?? null);
}

/**
 * Shell rules the two model-visible surfaces carry: the Harness Builder's system prompt, and the
 * Built shell's own tool description. Both shells run behind the same destructive-command guard —
 * built-bash.ts asks it too, passing `BUILT_SHELL_RULES` — so a refusal quotes a line from the list
 * its own agent was shown rather than from the other agent's.
 *
 * The lists are separate because the shells are. The Builder edits one workspace under git; the
 * Built shell runs each command in a fresh folder that is removed afterwards, with no repository and
 * no `.toolchain` directory, only its programs on PATH, which its tool description names — a rule
 * naming that directory sends every case looking for something that is not there. So the Built
 * list drops the git-revert line and the installed-tool line, and names a literal `/tmp` child where
 * the Builder names `scratch/.trash/`, whose contents would come back as draft files. Neither may
 * name `$TMPDIR` as a move destination: dcg refuses a move to a variable-rooted path
 * (`core.filesystem:mv-dynamic-path`, "shell variables ... may resolve to /"), so a refusal quoting
 * that spelling would itself be refused.
 *
 * Each line answers a failure the recorded traces actually carry rather than one reasoned out from
 * the guard's rule set. On the Builder side: a `cd .toolchain` that moved every later relative path,
 * `rm -rf` and `mv node_modules` refused by the guard, tool config directories aimed at the
 * operator's home, reads of the closed controller tree. On the Built side: `mkdir /tmp/x` and
 * `mktemp -d` outside the granted directories, timeouts on `find /` scans, and
 * `arduino-cli: command not found` for a tool the Builder had installed. The redirect line names a
 * literal target because `cat > $W/file` is the commonest refused shape after `rm -rf`.
 *
 * At most eight rules and about fifteen tokens each (operator decision), because the list is paid on
 * every turn of both agents.
 *
 * Both lists say a refused command runs nothing, and neither says the turn is lost, because it is
 * not: a session can take a refusal on its second call, make dozens more in the same turn and submit
 * an accepted candidate. That there is no allow-once is already the last clause of every refusal the
 * guard returns (`BUILDER_REFUSAL_CLOSE`).
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
/** Each Built command starts in a fresh folder that is removed afterwards (built-bash.ts), so the
 *  Builder's "workspace root" line would point the solver at nothing, and the time walls come from
 *  the harness's own agent/config.yaml, so the shared line names no number. dcg on its own refuses a
 *  redirect to `$HOME/x` and to `$TMPDIR/…`, which costs a solver turn after turn until it finds a
 *  spelling that passes. The guard caller admits both before dcg sees them (command-guard.ts
 *  `privateScratchRedirect`), which is why the write line names `$HOME` beside `~`.
 *  It leaves out `$TMPDIR`, which the Built shell makes fresh for each command and never reads back,
 *  so a rule naming it would offer the solver a place its next command cannot revisit. */
export const BUILT_SHELL_RULES: readonly string[] = [
  "Refused: rm -r outside the command's own folder, find -delete, git clean, git reset --hard.",
  "Delete a tree with rm -rf <relative path> or ~/<path>, also after cd ~; /tmp is shared with other solves, so keep your trees in $HOME.",
  "Write with > to $HOME/<name>, ~/<name>, a relative name or a literal /tmp/<name>; a redirect to any other $VAR/… is refused; make temp dirs with mktemp -d.",
  "Keep scripts and results in $HOME; do not scan the filesystem.",
  "A command has a default time limit; pass timeout for a long build, never for a search.",
  "A refused command runs nothing: change the spelling and run it again.",
];

/** The rule line that states the accepted spelling for a dcg rule id, which the refusal itself names
 *  as `Rule: core.git:reset-hard`. The refusal quotes that line, so the fix arrives with the refusal
 *  instead of sitting only in a prompt line the session may have compacted away: the list the prompt
 *  shows and the line the refusal quotes are one table. Matched on the line's own opening words
 *  rather than its position, so the two lists can hold different rules — the Built shell runs each
 *  command in a fresh folder with no repository, where a git-revert line would quote a remedy for a
 *  tree it does not have. */
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

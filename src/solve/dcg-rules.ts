/**
 * Shell rules the two model-visible surfaces carry: the Harness Builder's system prompt, and the
 * Built shell's own tool description. Since 2026-09-06 both shells run behind the same
 * destructive-command guard (built-bash.ts asks it too), so a refusal quotes a line from the list
 * its own agent was shown.
 *
 * The lists are separate because the shells are. The Builder edits one workspace under git; the
 * Built shell runs each command in a fresh folder that is removed afterwards, with no repository
 * and no `.toolchain` directory, only its programs on PATH, which its tool description names — a
 * rule naming the directory sent every case of truss run 298967 (2026-09-15) looking for it. So the
 * Built list drops the git-revert line and the installed-tool line, and names a literal `/tmp`
 * child where the Builder names `scratch/.trash/`, whose contents would come back as draft files.
 * Neither may name `$TMPDIR` as a move destination: dcg 0.14.0 refuses a move to a variable-rooted
 * path (`core.filesystem:mv-dynamic-path`, "shell variables ... may resolve to /", measured
 * 2026-09-06), so a refusal quoting that spelling would be refused in turn.
 *
 * Mined from the recorded traces of 2026-08-27 to 2026-09-02. Builder sessions (38 records, 66 failed
 * calls): a `cd .toolchain` that moved every later relative path, `rm -rf` and `mv node_modules`
 * refused by the destructive-command guard, tool config directories aimed at the operator's home,
 * reads of the closed controller tree. Built Harness cases (57 runs, 1,057 failed shell calls):
 * `mkdir /tmp/x` and `mktemp -d` outside the granted directories, 316 timeouts mostly on `find /`
 * scans, and `arduino-cli: command not found` for a tool the Builder had installed. The literal
 * redirect target was added on 2026-09-03: of the eleven guard refusals recorded for the Opus
 * Builders of runs 47, 50 and 52, `cat > $W/file` was the shape after `rm -rf`, and the same
 * shape was 41% of the operator's own blocked calls.
 *
 * At most eight rules and about fifteen tokens each (operator decision 2026-09-02): the list is
 * paid on every turn of both agents.
 *
 * Both lists say a refusal runs nothing. The Builder's line said it lost the turn until
 * 2026-09-18, when the recorded traces refused it: truss run c1d2a7's first authoring session took
 * a dcg refusal at its second call (`core.interpreter:launcher-unverified`) and went on to make
 * 70 calls in that same turn and submit an accepted candidate. Its remaining unique content, that
 * there is no allow-once, is already the last clause of every refusal the guard returns.
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
 *  Builder's "workspace root" line would point the solver at nothing. Its walls come from the
 *  harness's agent/config.yaml, so this shared line names none. dcg 0.14.0 refuses a redirect to
 *  `$HOME/x`; Built cases of 2026-09-13 to 2026-09-15 lost 18 turns to it and 51 to `$TMPDIR/…`.
 *  Since 2026-09-16 the guard caller admits both (command-guard.ts `privateScratchRedirect`), so
 *  the write line names `$HOME` beside `~`. It leaves out `$TMPDIR`, which the Built shell makes
 *  fresh for each command and never reads back. */
export const BUILT_SHELL_RULES: readonly string[] = [
  "Refused: rm -r outside the command's own folder, find -delete, git clean, git reset --hard.",
  "Delete a tree with rm -rf <relative path> or ~/<path>, also after cd ~; /tmp is shared with other solves, so keep your trees in $HOME.",
  "Write with > to $HOME/<name>, ~/<name>, a relative name or a literal /tmp/<name>; a redirect to any other $VAR/… is refused; make temp dirs with mktemp -d.",
  "Keep scripts and results in $HOME; do not scan the filesystem.",
  "A command has a default time limit; pass timeout for a long build, never for a search.",
  "A refused command runs nothing: change the spelling and run it again.",
];

/** The rule line that states the accepted spelling for a dcg rule id (`Rule: core.git:reset-hard`
 *  in its refusal). A refusal quotes that line, so the fix arrives with the refusal instead of only
 *  in a prompt line the session may have compacted away; the list the prompt shows and the line the
 *  refusal quotes are one table. Matched on the line's own opening words rather than its position,
 *  so the two lists can hold different rules: the Built shell runs each command in a fresh folder
 *  with no repository, and a git-revert line there quoted a remedy for a tree it does not have. */
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

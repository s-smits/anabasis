/**
 * Shared destructive-command checks for host-dispatched shell tools, asked by both the Builder's
 * shell and the Built Harness's.
 *
 * The file wall confines writes to the session workspace and the OS scratch trees. This guard
 * answers a different question before a command runs: whether the command's own shape is obviously
 * destructive. `dcg` (destructive_command_guard) is the tool for that class, and it reads the
 * command rather than the path — recursive removes, hard resets, discarding checkouts, truncating
 * redirects — which is what keeps it from becoming a second wall with a second list that drifts
 * against the first.
 *
 * The controller asks the guard itself because an isolated session inherits none of the operator's
 * hooks: Codex runs against a separate `CODEX_HOME` with an empty `config.toml` and Claude sets
 * `settingSources: []`, which is what keeps operator settings out of the measured condition, and
 * which also removes any guard installed through personal hooks. Calling it from here restores the
 * check without importing the rest of someone's configuration into the run. Installing a Codex
 * hook instead was tried and did not work: codex-cli 0.147.0 reached through app-server never
 * invoked a `hooks.json` placed in the temporary `CODEX_HOME`, and two trials on 2026-08-20, one
 * with a `Bash` matcher and one catch-all, logged zero calls although the file named the guard's
 * absolute path.
 *
 * The same segment showed what a guard of this shape can and cannot do. Asked to remove a
 * toolchain it had installed, the session had two recursive-delete spellings refused and then
 * removed both trees through a spelling the policy allowed. A command guard raises the cost of the
 * obvious destructive spelling; it does not remove the capability, and it must not be written
 * about as though it did.
 */
import { readFileSync, statSync } from "../meta/filesystem.ts";
import { isRegularFile } from "../verify/exact-read-attestation.ts";
import { delimiter, isAbsolute, join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { DCG_RULES, acceptedSpelling } from "../solve/dcg-rules.ts";
import { type SafeguardContext, safeguardTriggered } from "../meta/safeguard.ts";

/** The guard binaries, in the order `dcg install` lays them down. `dcg-guard` is the companion
 *  check placed beside `dcg`, and a host may have either, both or neither, so each one present is
 *  asked rather than the first one found. */
const GUARD_COMMANDS = ["dcg", "dcg-guard"] as const;

/** A guard is a safety net rather than a measurement, so a broken binary may cost a few seconds
 *  but must never hang a turn behind it. */
const GUARD_TIMEOUT_MS = 5_000;
const textEncoder = new TextEncoder();

interface BuilderCommandGuardFileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}
interface BuilderCommandGuardProbe {
  answered: boolean;
  refusal: string | null;
}

/**
 * dcg writes its refusal for an operator sitting at a terminal: a `Tip:` line quoting the command
 * back, a multi-paragraph `Explanation:`, and two closing sentences handing the decision to "the
 * user" with a `dcg allow-once` code. A session has no user and cannot run dcg, so the eleven
 * refusals recorded across three Opus sessions on 2026-09-02 and 2026-09-03 each spent about 500
 * tokens on text whose only actionable lines were the reason and the rule. The refusal therefore
 * keeps those two lines and replaces the hand-over with the one fact a session can act on. Both
 * guards the installer lays down write this layout, since `dcg-guard` forwards dcg's own answer,
 * and the empty-reason default below is spelled to pass the same filter; a guard writing some
 * other layout keeps its own text, bounded, so the session still reads a reason rather than the
 * closing line alone.
 *
 * "Change the spelling" on its own left the session hunting for the accepted spelling in its
 * prompt, so the refusal also quotes the shell rule that states it, taken from the same list the
 * caller's own prompt shows (`rules`): the Builder's list names `scratch/.trash/` and the Built
 * Harness's a literal `/tmp/<name>`.
 */
export const BUILDER_REFUSAL_CLOSE =
  "No user is present to approve it and there is no allow-once: change the spelling.";
const ACTIONABLE_LINE = /^(?:BLOCKED by |Reason: |Rule: )/;
const RULE_ID = /^Rule: (\S+)/;
const UNKNOWN_LAYOUT_LINES = 8;
const UNKNOWN_LAYOUT_CHARS = 1000;

/**
 * Refusals the session may override, because the wall already bounds what they could destroy
 * (operator decision 2026-09-14, "give more freedom").
 *
 * Of the 127 guard refusals recorded across 414 Builder execution records, most were
 * `rm -rf <relative tree>` and `git checkout -- <file>` inside the session's own workspace. That
 * is the cost of judging the shape rather than the path: the guard refused deletes the wall
 * confines to the workspace anyway, and each refusal spent a turn. So a recursive remove whose
 * every operand is a plain relative path with no `..` segment and not the tree's own root, in a
 * command whose every `cd` stays in its own tree, is admitted, as is such a path under the
 * shell's own `~` or `$HOME` in a
 * command that leaves HOME alone. A discarding checkout or restore is admitted because it can lose
 * only the session's own uncommitted edits. Removing the root or the home itself, `reset --hard`,
 * `clean` and `find -delete` keep their refusal, because none of those is bounded by the wall.
 */
const WORKSPACE_ALLOWED_GIT = /^core\.git:(checkout-discard|restore-worktree)$/;
const RM_RF = /^core\.filesystem:rm-rf-(?:general|root-home)$/;
const HOME_CHILD = /^(["']?)(?:~|\$HOME|\$\{HOME\})\//;
/** A quoted heredoc body is text the command writes rather than shell it runs, so it is dropped
 *  while its opening line stays. Reading it cost a turn in rehearsal 805bcc, where a wrapper's
 *  `CDPATH= cd --` line inside a heredoc refused the relative remove beside it. An unquoted body
 *  is a different matter, because it expands `$(...)`, so that one is still read. */
const QUOTED_HEREDOC_BODY = /(<<-?[\t ]*(['"])(\w+)\2[^\n]*\n)(?:[\s\S]*?\n)?[\t ]*\3[\t ]*(?=\n|$)/g;

/**
 * A redirect into the shell's own `$HOME` or `$TMPDIR` is admitted (operator decision 2026-09-16,
 * "make more lenient"). Both shells already point those at private trees inside their own wall —
 * `.toolchain/home` for the Builder, the case home for the Built solver, and a TMPDIR made for
 * that command — so such a write cannot reach a file the session does not own. dcg 0.14.0 refuses
 * it only because the target expands at run time, and Built cases between 2026-09-13 and
 * 2026-09-15 lost 69 turns to that, with its `root-home` twin refusing two more writes into case-
 * home children in run 08c0f2. The admission is kept narrow: every dynamic target must start with
 * `~/` or one of the two variables, carry no `..` and no second expansion, and the command must
 * not reassign either variable, since a command that sets HOME first is no longer talking about
 * the tree the wall bounded.
 */
const DYNAMIC_REDIRECT = /^core\.filesystem:redirect-truncate-(?:dynamic-path|root-home)$/;
const REDIRECT_TARGET = /(?:^|[^<>&])(?:\d?>>?|&>>?)\|?[\t ]*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g;
const SCRATCH_TARGET = /^"?(?:~|\$\{(?:HOME|TMPDIR)\}|\$(?:HOME|TMPDIR)\b)\/[^"$`]*"?$/;
const SCRATCH_PROBE = "/tmp/ana-guard/scratch";
const SCRATCH_REASSIGNED =
  /(?:^|[\s;&|(])(?:export\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?(?:HOME|TMPDIR)=|\b(?:unset|read|for|getopts)\b[^\n;&|]*\b(?:HOME|TMPDIR)\b/;

/** An admitted segment carries no expansion that could run a second command inside it. */
const EXPANSION = /\$\(|`|<\(|>\(/;
const SEGMENTS = /(\s*(?:\|\||&&|;|\||\n)\s*)/;

/** What full-run launch records about the selected command guard. */
export type BuilderCommandGuardResult = {
  state: "existing" | "skipped";
  /** Absolute regular-file path when one was present; null for a launch-level skip. */
  path: string | null;
  dcgVersion: string | null;
  binarySha256: string | null;
  skippedReason:
    | "existing-unresponsive"
    | "existing-not-refusing"
    | "not-installed"
    | "explicit-off"
    | "codex-builder"
    | "not-requested"
    | null;
};

const UNRESPONSIVE_GUARDS = new Map<string, BuilderCommandGuardFileIdentity>();

function runGuard(
  guard: string,
  args: string[],
  env: OptionalEnvValues,
  stdin = new Uint8Array(),
  timeoutMs = GUARD_TIMEOUT_MS,
) {
  try {
    return Bun.spawnSync({
      cmd: [guard, ...args],
      env,
      stdin,
      timeout: timeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return null;
  }
}
/**
 * Where a guard binary sits on this host. `PATH` comes first, because that is what the operator's
 * own shell resolves and what an upgrade moves. The installer's default target, `~/.local/bin`, is
 * checked after it, so a controller started from a launch agent with a minimal `PATH` still finds
 * an installed guard: that is the same inherited-`PATH` gap that once had a Builder told
 * `arduino-cli` was absent when it was installed.
 */
function resolveGuards(command: string, env: OptionalEnvValues): string[] {
  const fromPath = (env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "" && isAbsolute(dir))
    .map((dir) => join(dir, command))
    .filter((path) => isRegularFile(path) && !builderCommandGuardIsUnresponsive(path));
  const home = env.HOME;
  const fallback =
    home === undefined || home === "" || !isAbsolute(home) ? null : join(home, ".local", "bin", command);
  return [
    ...new Set([
      ...fromPath,
      ...(fallback !== null && isRegularFile(fallback) && !builderCommandGuardIsUnresponsive(fallback)
        ? [fallback]
        : []),
    ]),
  ];
}

/** The identity of the file a guard path actually runs, read through any link exactly as
 *  `isRegularFile` reads it above. Fingerprinting the link instead would survive a rebuild of what
 *  it points at, so a guard that timed out once would stay marked unresponsive for the rest of the
 *  controller run with no way back, even after the binary underneath it was replaced. */
function builderCommandGuardFileIdentity(path: string): BuilderCommandGuardFileIdentity | null {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) return null;
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
  } catch {
    return null;
  }
}

function sameBuilderCommandGuardFile(
  left: BuilderCommandGuardFileIdentity | null,
  right: BuilderCommandGuardFileIdentity | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * The guards installed on this host, most general first.
 *
 * An empty list means no guard is installed and the run proceeds anyway, because the guard
 * protects the operator's own machine and is not a condition of what the run measures; refusing to
 * start would trade a real measurement for a safety net that is missing either way. It returns the
 * list rather than a boolean so a caller can name the guard that answered, and the full-run launch
 * records that selected identity separately from this decision.
 */
export function builderCommandGuards(env: OptionalEnvValues = Bun.env): string[] {
  return GUARD_COMMANDS.flatMap((command) => resolveGuards(command, env));
}

function workspaceRelativeOperand(operand: string): boolean {
  const bare = operand.replace(/^["']|["']$/g, "");
  if (bare === "" || bare === "." || bare === "./" || bare === "*" || bare === "./*") return false;
  if (/^[/~$]/.test(bare)) return false;
  return !bare.split("/").includes("..");
}

/** Whether every `cd` stays in a tree the session owns — the private `$HOME` both shells set,
 *  reached as a bare `cd`, `~` or `$HOME`, or a relative child, with no `..` and no other
 *  expansion — because that is what makes a relative remove after it stay inside the tree too.
 *  Without this, Built cases of run 08c0f2 (2026-09-22) lost turns to `cd ~ && rm -rf build`. */
function ownDirectories(shell: string): boolean {
  // The target ends where the word does, so `cd "$HOME"/..` is read whole rather than as `"$HOME"`.
  const targets = [
    ...shell.matchAll(/(?:^|[\s;&|(])(?:cd|pushd)(?=[\s;&|)]|$)[\t ]*("[^"]*"|[^\s;&|()]*)(?=[\s;&|)]|$)/g),
  ];
  const home = (target: string) =>
    target.replace(/^"(.*)"$/, "$1").replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)|^$/, "home");
  if (targets.length > 0 && (SCRATCH_REASSIGNED.test(shell) || /\bCDPATH=/.test(shell))) return false;
  return targets.every(
    ([, target = ""]) => !/[$`"'\\]|^-/.test(home(target)) && workspaceRelativeOperand(home(target)),
  );
}

export function privateScratchRedirect(command: string): boolean {
  return scratchRedirectResidual(command) !== null;
}

/** The command with every private scratch redirect target replaced by a literal `/tmp` path, or null
 *  when a dynamic target is not one of them. */
function scratchRedirectResidual(command: string): string | null {
  const shell = command.replace(QUOTED_HEREDOC_BODY, "$1");
  if (SCRATCH_REASSIGNED.test(shell)) return null;
  const dynamic: string[] = [];
  // The rewriter records each dynamic target rather than judging it, so what makes a target
  // foreign is stated once, at the decision below, instead of being spread through the rewrite.
  const residual = shell.replace(REDIRECT_TARGET, (match: string, target: string) => {
    if (!/^~|[$`]/.test(target)) return match;
    dynamic.push(target);
    return `${match.slice(0, match.length - target.length)}${SCRATCH_PROBE}`;
  });
  const foreign = (target: string): boolean =>
    !SCRATCH_TARGET.test(target) || target.split("/").includes("..");
  return dynamic.length === 0 || dynamic.some(foreign) ? null : residual;
}

/**
 * The command with each segment the refused rule admits replaced by `true`, or null when the rule
 * admits nothing. The guard names one rule per answer, so the caller asks again about this
 * residual: `rm -rf build; git reset --hard` must still meet the reset refusal behind the remove.
 */
export function workspaceResidual(command: string, ruleId: string | null): string | null {
  if (ruleId === null) return null;
  if (DYNAMIC_REDIRECT.test(ruleId)) return scratchRedirectResidual(command);
  const git = WORKSPACE_ALLOWED_GIT.test(ruleId);
  if (!git && !RM_RF.test(ruleId)) return null;
  if (!git && !ownDirectories(command.replace(QUOTED_HEREDOC_BODY, "$1"))) return null;
  let admitted = 0;
  const parts = command.split(SEGMENTS).map((part, index) => {
    if (index % 2 === 1 || EXPANSION.test(part)) return part;
    const words = part.trim().split(/\s+/);
    const own = git
      ? words[0] === "git" && (words[1] === "checkout" || words[1] === "restore")
      : words[0] === "rm";
    if (!own) return part;
    if (!git) {
      const operands = words.slice(1).filter((word) => !word.startsWith("-"));
      const bare = operands.map((word) => word.replace(HOME_CHILD, "$1"));
      if (bare.join() !== operands.join() && SCRATCH_REASSIGNED.test(command)) return null;
      if (operands.length === 0 || !bare.every(workspaceRelativeOperand)) return null;
    }
    admitted += 1;
    return "true";
  });
  return admitted === 0 || parts.includes(null) ? null : parts.join("");
}

export function builderRefusal(reason: string, rules: readonly string[] = DCG_RULES): string {
  const lines = reason.split(/\r?\n/);
  const kept = lines.filter((line) => ACTIONABLE_LINE.test(line));
  const shown =
    kept.length > 0 ? kept : lines.filter((line) => line.trim() !== "").slice(0, UNKNOWN_LAYOUT_LINES);
  const ruleId = kept.map((line) => RULE_ID.exec(line)?.[1] ?? null).find((id) => id !== null) ?? null;
  const accepted = ruleId === null ? null : acceptedSpelling(ruleId, rules);
  // One character cap over whichever branch was shown: a guard may write a long line in either layout.
  return [
    shown.join("\n").slice(0, UNKNOWN_LAYOUT_CHARS),
    ...(accepted === null ? [] : [`Accepted: ${accepted}`]),
    BUILDER_REFUSAL_CLOSE,
  ].join("\n");
}

/**
 * The guard's answer: a deny carrying the reason to show, an allow (`refusal: null`), or `null`
 * for stdout that states no decision at all.
 *
 * The last two are different facts and were one until 2026-09-06, when a guard writing something
 * that was not its own protocol read as an allow. That let a broken guard pass commands through
 * while safeguard 32, whose whole job is to count guards that answered nothing, stayed silent.
 * Silence on stdout is a separate case and stays an allow, because it is the hook protocol's own
 * way of saying so.
 */
function guardDecision(
  stdout: string,
  command: string,
  rules: readonly string[],
): { refusal: string | null; residual?: string } | null {
  if (stdout.trim() === "") return { refusal: null };
  let parsed: unknown;
  try {
    parsed = parseJsonAs<unknown>(stdout);
  } catch {
    return null;
  }
  const specific = asRecord(asRecord(parsed)?.hookSpecificOutput);
  if (specific === null) return null;
  if (specific.permissionDecision !== "deny") return { refusal: null };
  const reason =
    isString(specific.permissionDecisionReason) && specific.permissionDecisionReason.trim() !== ""
      ? specific.permissionDecisionReason
      : "BLOCKED by the destructive-command guard";
  const ruleId =
    reason
      .split(/\r?\n/)
      .map((line) => RULE_ID.exec(line)?.[1] ?? null)
      .find((id) => id !== null) ?? null;
  const residual = workspaceResidual(command, ruleId);
  // A residual equal to the command made no progress, so the refusal stands.
  return residual === null || residual === command
    ? { refusal: builderRefusal(reason, rules) }
    : { refusal: null, residual };
}

/** Asks one guard about a command, distinguishing an allow from no answer at all. */
export function inspectBuilderCommandGuard(
  guard: string,
  command: string,
  env: OptionalEnvValues = Bun.env,
  timeoutMs = GUARD_TIMEOUT_MS,
  rules: readonly string[] = DCG_RULES,
): BuilderCommandGuardProbe {
  const before = builderCommandGuardFileIdentity(guard);
  if (before === null) return { answered: false, refusal: null };
  const payload = capturedJsonStringify({ tool_name: "Bash", tool_input: { command } });
  const run = runGuard(
    guard,
    [],
    { PATH: env.PATH ?? "", HOME: env.HOME ?? "" },
    textEncoder.encode(payload),
    timeoutMs,
  );
  if (run === null || run.exitedDueToTimeout === true || run.exitedDueToMaxBuffer === true) {
    const after = builderCommandGuardFileIdentity(guard);
    if (sameBuilderCommandGuardFile(before, after)) UNRESPONSIVE_GUARDS.set(guard, before);
    else UNRESPONSIVE_GUARDS.delete(guard);
    return { answered: false, refusal: null };
  }
  if (!sameBuilderCommandGuardFile(before, builderCommandGuardFileIdentity(guard))) {
    UNRESPONSIVE_GUARDS.delete(guard);
    return { answered: false, refusal: null };
  }
  // A later probe may be looking at new bytes published at the same path, so a process-local
  // timeout cache must not suppress that replacement for the rest of the controller run.
  UNRESPONSIVE_GUARDS.delete(guard);
  const decision = guardDecision(run.stdout.toString(), command, rules);
  if (decision === null) return { answered: false, refusal: null };
  // A guard that crashed away from its own protocol has allowed nothing, whatever its stdout held.
  if (decision.refusal === null && !run.success) return { answered: false, refusal: null };
  // Each residual replaces at least one more segment or redirect target, so this ends.
  if (decision.residual !== undefined) {
    return inspectBuilderCommandGuard(guard, decision.residual, env, timeoutMs, rules);
  }
  return { answered: true, refusal: decision.refusal };
}

function builderCommandGuardIsUnresponsive(path: string): boolean {
  const cached = UNRESPONSIVE_GUARDS.get(path);
  if (cached === undefined) return false;
  if (sameBuilderCommandGuardFile(cached, builderCommandGuardFileIdentity(path))) return true;
  UNRESPONSIVE_GUARDS.delete(path);
  return false;
}

/** Read a guard's self-reported version without running a path that is not a regular file. */
function builderCommandVersion(guard: string, env: OptionalEnvValues = Bun.env): string | null {
  if (!isRegularFile(guard)) return null;
  const run = runGuard(guard, ["--version"], { PATH: env.PATH ?? "", HOME: env.HOME ?? "" });
  if (run === null || run.exitedDueToTimeout === true || !run.success) return null;
  const value = `${run.stdout.toString()}${run.stderr.toString()}`.trim();
  return value === "" ? null : (value.split(/\r?\n/, 1)[0] ?? null);
}

/**
 * The shared in-process check: ask every installed guard about one command and return the first
 * refusal, or `null` when all of them allow it.
 *
 * A guard that cannot answer — missing, crashed, timed out, or writing something that is not its
 * own JSON — is not a refusal. Failing closed here would turn a broken safety net into a Builder
 * that cannot run a command at all, which is a worse outcome than the accident the guard exists to
 * catch, and the run would then report it as the Builder's failure rather than the host's.
 */
export function refuseDestructiveCommand(
  command: string,
  env: OptionalEnvValues = Bun.env,
  /** The asking session's run, named by the unanswered-guard safeguard. */
  context?: SafeguardContext,
  /** The shell rules the asking agent's prompt shows; the refusal quotes the accepted one. */
  rules: readonly string[] = DCG_RULES,
): string | null {
  const guards = builderCommandGuards(env);
  let answered = 0;
  for (const guard of guards) {
    const probe = inspectBuilderCommandGuard(guard, command, env, GUARD_TIMEOUT_MS, rules);
    if (probe.answered) answered += 1;
    if (probe.refusal !== null) return probe.refusal;
  }
  // Safeguard 32: the launch check records the guard state once, at the start. A guard that stops
  // answering partway through a run then lets every later command through, for the reason the
  // paragraph above gives, and this line is the only trace that it happened.
  if (guards.length > 0 && answered === 0) {
    safeguardTriggered(
      "32-command-guard-unanswered",
      `${String(guards.length)} installed guard(s) answered nothing about a "${command.split(/\s+/, 1)[0] ?? ""}" command, which then ran unguarded: ${guards.join(", ")}`,
      context,
    );
  }
  return null;
}

/** The probe every candidate guard must refuse before the launch names it as the guard. */
const PROBE = ["git", "reset", "--hard", "HEAD~1"].join(" ");

function describeGuard(path: string, env: OptionalEnvValues, timeoutMs?: number): BuilderCommandGuardResult {
  let binarySha256: string | null;
  try {
    binarySha256 = sha256(readFileSync(path));
  } catch {
    binarySha256 = null;
  }
  const probe = inspectBuilderCommandGuard(path, PROBE, env, timeoutMs);
  if (!probe.answered) {
    return { state: "skipped", path, dcgVersion: null, binarySha256, skippedReason: "existing-unresponsive" };
  }
  const dcgVersion = builderCommandVersion(path, env);
  if (probe.refusal === null) {
    return { state: "skipped", path, dcgVersion, binarySha256, skippedReason: "existing-not-refusing" };
  }
  return { state: "existing", path, dcgVersion, binarySha256, skippedReason: null };
}

/**
 * Names the guard a Builder session will run under, or says why none will. Nothing here installs
 * one: the README names the install command, and a host without a guard runs unguarded, because
 * the guard is a safety net for the operator's machine rather than a condition of what the run
 * measures.
 */
export function ensureBuilderCommandGuard(
  env: OptionalEnvValues = Bun.env,
  probeTimeoutMs?: number,
): BuilderCommandGuardResult {
  const inspected = builderCommandGuards(env).map((path) => describeGuard(path, env, probeTimeoutMs));
  return (
    inspected.find((result) => result.state === "existing") ??
    inspected[0] ?? {
      state: "skipped",
      path: null,
      dcgVersion: null,
      binarySha256: null,
      skippedReason: "not-installed",
    }
  );
}

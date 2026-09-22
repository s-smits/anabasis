/**
 * Destructive-command checks for host-dispatched shell tools, used by the Builder and the Built
 * Harness shells.
 *
 * `dcg` (destructive_command_guard) judges the command's shape (recursive removes, hard resets,
 * discarding checkouts, truncating redirects), not its paths, so it complements the file wall
 * rather than duplicating it. Isolated sessions do not inherit the operator's hooks, so the
 * controller calls the installed guards itself. A command guard raises the cost of an obvious
 * destructive spelling; it does not remove the capability.
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

/** The guard binaries; each one installed on the host runs. */
const GUARD_COMMANDS = ["dcg", "dcg-guard"] as const;

/** Bounds a broken guard binary so it cannot hang a turn. */
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
 * dcg writes its refusal for an operator at a terminal. A session has no user and cannot run
 * `dcg allow-once`, so the refusal keeps only the reason and rule lines, quotes the accepted
 * spelling from the caller's shell rules, and closes with this line. A guard writing another
 * layout keeps its text, bounded.
 */
export const BUILDER_REFUSAL_CLOSE =
  "No user is present to approve it and there is no allow-once: change the spelling.";
const ACTIONABLE_LINE = /^(?:BLOCKED by |Reason: |Rule: )/;
const RULE_ID = /^Rule: (\S+)/;
const UNKNOWN_LAYOUT_LINES = 8;
const UNKNOWN_LAYOUT_CHARS = 1000;

/**
 * Refusals admitted because the wall already bounds them. A recursive remove whose every operand
 * is a plain relative path without `..` (or such a path under the shell's own `~`/`$HOME`), in a
 * command whose every `cd` stays in its own tree, stays inside the session's tree. A discarding
 * checkout or restore loses only the session's own edits. Removing the root or home itself,
 * `reset --hard`, `clean` and `find -delete` stay refused.
 */
const WORKSPACE_ALLOWED_GIT = /^core\.git:(checkout-discard|restore-worktree)$/;
const RM_RF = /^core\.filesystem:rm-rf-(?:general|root-home)$/;
const HOME_CHILD = /^(["']?)(?:~|\$HOME|\$\{HOME\})\//;
/** A quoted heredoc body is text the command writes, not shell it runs, so it is dropped; its
 *  opening line stays. An unquoted body expands `$(...)`, so it is still read. */
const QUOTED_HEREDOC_BODY = /(<<-?[\t ]*(['"])(\w+)\2[^\n]*\n)(?:[\s\S]*?\n)?[\t ]*\3[\t ]*(?=\n|$)/g;

/**
 * A redirect into the shell's own `$HOME` or `$TMPDIR` is admitted: both shells point them at
 * private trees inside their wall. Every dynamic target must start with `~/` or one of the two
 * variables, carry no `..` and no second expansion, and the command must not reassign either.
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
 * Where a guard binary sits on this host: `PATH` first, then the installer's default
 * `~/.local/bin`, so a controller launched with a minimal `PATH` still finds it.
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

/** The identity of the file a guard path runs (through any link), so a republished binary is not
 *  still held as unresponsive. */
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
 * The guards installed on this host, most general first. An empty list lets the run proceed
 * unguarded: the guard protects the operator's machine and is not a measured condition.
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

/** Whether every `cd` stays in a tree the session owns (its private `$HOME` or a relative child,
 *  with no `..` and no other expansion), so a relative remove after it does too. */
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
 * The guard's answer: a deny with the reason to show, an allow (`refusal: null`), or `null` for
 * stdout outside the hook protocol, which counts as no answer. Empty stdout is the protocol's allow.
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
  // It answered, so any earlier timeout no longer applies.
  UNRESPONSIVE_GUARDS.delete(guard);
  const decision = guardDecision(run.stdout.toString(), command, rules);
  if (decision === null) return { answered: false, refusal: null };
  // A crashed guard has allowed nothing, whatever its stdout held.
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
 * Asks every installed guard about one command and returns the first refusal, or `null`.
 *
 * A guard that cannot answer is not a refusal: failing closed would turn a broken safety net into
 * a Builder that cannot run commands, reported as the Builder's failure rather than the host's.
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
  // Installed guards that all stopped answering let the command through; this is its only trace.
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
 * Names the guard a Builder session will run under, or why none will. Nothing is installed here;
 * a host without a guard runs unguarded.
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

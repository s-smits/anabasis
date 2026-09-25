import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";

import {
  BUILDER_REFUSAL_CLOSE,
  builderRefusal,
  builderCommandGuards,
  ensureBuilderCommandGuard,
  inspectBuilderCommandGuard,
  refuseDestructiveCommand,
  privateScratchRedirect,
  workspaceResidual,
} from "../src/builder/command-guard.ts";
import { BUILT_SHELL_RULES, DCG_RULES, acceptedSpelling } from "../src/solve/dcg-rules.ts";
import { SAFEGUARDS_LOG_FILE, createSafeguardContext } from "../src/meta/safeguard.ts";
const LOCAL = ".local";

const dirs: string[] = [];

/** `workspaceResidual` hands back the rewritten command or `null`; most cases ask only which. */
function workspaceAllows(command: string, ruleId: string | null): boolean {
  return workspaceResidual(command, ruleId) !== null;
}

/** Assembled rather than written out, so this file's own bytes do not trip an installed guard when
 *  a tool reads or rewrites it — which happened while the file was being written. */
const DESTRUCTIVE_SAMPLE = ["rm", "-rf", "/Users/nobody/work"].join(" ");
const RESET_SAMPLE = ["git", "reset", "--hard", "HEAD~1"].join(" ");

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in for `dcg` that answers in its protocol: Claude Code's PreToolUse JSON on stdout, exit
 * 0 either way. The real binary is not a test dependency — a host without it must still run this
 * suite. The fixture reproduces the protocol dcg answers in hook mode and refuses
 * the destructive remove, checkout and reset commands exercised below.
 *
 * `/bin/sh` by absolute path, and no interpreter lookup: the guard is handed `PATH` and `HOME` and
 * nothing else, so a `#!/usr/bin/env node` fixture cannot find its own interpreter. The real guard
 * is a static binary and needs neither.
 */
function writeFakeGuard(path: string, name: string): void {
  writeFileSync(
    path,
    `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf '%s\n' '9.9.9'; exit 0; fi
command=$(/bin/cat)
case "$command" in
  *"rm -rf"*|*"git checkout --"*|*"git reset --hard"*)
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by ${name}"}}'
    ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  chmodSync(path, 0o700);
}

function fakeGuard(name: string): string {
  const bin = temp("ana-guard-");
  writeFakeGuard(join(bin, name), name);
  return bin;
}

describe("the Builder's destructive-command guard", () => {
  // A recursive remove of the session's own relative tree and a discarding checkout or restore of
  // its own file are allowed over the guard's refusal; anything
  // rooted outside the workspace, climbing out of it, or following a `cd` out of the session's own
  // tree keeps the refusal.
  it.concurrent("allows workspace-bound removes and reverts over the guard's refusal", () => {
    const rm = "core.filesystem:rm-rf-general";
    expect(workspaceAllows("rm -rf build/out", rm)).toBe(true);
    expect(workspaceAllows("rm -rf node_modules dist && bun install", rm)).toBe(true);
    expect(workspaceAllows('rm -rf "agent/tmp dir"', rm)).toBe(true);
    expect(workspaceAllows(DESTRUCTIVE_SAMPLE, rm)).toBe(false);
    expect(workspaceAllows("rm -rf ../sibling", rm)).toBe(false);
    expect(workspaceAllows("rm -rf build/../../x", rm)).toBe(false);
    expect(workspaceAllows("rm -rf .", rm)).toBe(false);
    expect(workspaceAllows("rm -rf *", rm)).toBe(false);
    expect(workspaceAllows("rm -rf", rm)).toBe(false);
    expect(workspaceAllows("cd / && rm -rf usr", rm)).toBe(false);
    // A cd into the private home or a relative child keeps the remove inside.
    const home = ["$", "HOME"].join("");
    expect(workspaceAllows("cd ~ && rm -rf build && ls", rm)).toBe(true);
    expect(workspaceAllows(`cd ${home} && rm -rf work && mkdir -p work/fw && cd work/fw`, rm)).toBe(true);
    expect(workspaceAllows(`cd "${home}/fw"; rm -rf build`, rm)).toBe(true);
    for (const escape of [
      "(cd / && rm -rf usr)",
      "true;cd /tmp; rm -rf x",
      "cd - && rm -rf x",
      "pushd / && rm -rf usr",
    ]) {
      expect(workspaceAllows(escape, rm)).toBe(false);
    }
    for (const target of ["~/..", `${home}/..`, '"$(pwd)"', "$OLDPWD", "~root", ".."]) {
      expect(workspaceAllows(`cd ${target} && rm -rf build`, rm)).toBe(false);
    }
    expect(workspaceAllows(`HOME=/ && cd ${home} && rm -rf usr`, rm)).toBe(false);
    // A child of the private home is removed directly, under either rule dcg names.
    for (const rule of [rm, "core.filesystem:rm-rf-root-home"]) {
      expect(workspaceAllows("rm -rf ~/ws && mkdir -p ~/ws/fw", rule)).toBe(true);
      expect(workspaceAllows(`rm -rf "${home}/b" build`, rule)).toBe(true);
      for (const target of ["~", home, "~/", `${home}/..`, "~/x/../..", "~/*", "~root/x", `~/${home}`]) {
        expect(workspaceAllows(`rm -rf ${target}`, rule)).toBe(false);
      }
      expect(workspaceAllows(`HOME=/usr; rm -rf ${home}/lib`, rule)).toBe(false);
    }
    // A quoted heredoc writing a wrapper that cds is text, not a cd of this command.
    const wrapper = (quote: string, after = "") =>
      `rm -rf .toolchain/py312 && cat > .toolchain/bin/py <<${quote}EOF${quote}${after}\n#!/bin/sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nEOF\nchmod +x .toolchain/bin/py`;
    expect(workspaceAllows(wrapper("'"), rm)).toBe(true);
    expect(workspaceAllows(wrapper('"'), rm)).toBe(true);
    // An unquoted body runs its $(...), and a cd on the opening line or after the body is the command's.
    expect(workspaceAllows(wrapper(""), rm)).toBe(false);
    expect(workspaceAllows(wrapper("'", " && cd /"), rm)).toBe(false);
    expect(workspaceAllows(`${wrapper("'")}\ncd / && rm -rf usr`, rm)).toBe(false);
    expect(workspaceAllows("git checkout -- src/app.ts", "core.git:checkout-discard")).toBe(true);
    // A redirect into the shell's own private HOME or TMPDIR passes;
    // any other expanded target, a climb out, or a reassigned HOME or TMPDIR keeps the refusal.
    const redirect = "core.filesystem:redirect-truncate-dynamic-path";
    const v = (name: string) => ["$", name].join("");
    for (const allowed of [
      `cat > ${v("HOME")}/run.py`,
      `python3 run.py > "${v("TMPDIR")}/out.json" 2>&1`,
      `echo x >> ${v("{HOME}")}/log && cat > ${v("TMPDIR")}/a/b.txt <<'EOF'
> ${v("OUT")}
EOF`,
    ]) {
      expect(privateScratchRedirect(allowed)).toBe(true);
      expect(workspaceAllows(allowed, redirect)).toBe(true);
    }
    for (const refused of [
      `cat > ${v("OUT")}/run.py`,
      `cat > ${v("HOME")}/../x`,
      `cat > ${v("HOMEDIR")}/x`,
      `cat > ${v("HOME")}/${v("NAME")}`,
      `HOME=/etc; cat > ${v("HOME")}/passwd`,
      `export TMPDIR=/etc && echo > ${v("TMPDIR")}/x`,
      `cat > ${v("HOME")}`,
      `cat > ${v("HOME")}/a > ${v("(pwd)")}/b`,
      "cat > run.py",
    ]) {
      expect(workspaceAllows(refused, redirect)).toBe(false);
    }
    expect(workspaceAllows(`cat > ${v("HOME")}/run.py`, "core.filesystem:mv-dynamic-path")).toBe(false);
    const rootHome = "core.filesystem:redirect-truncate-root-home";
    expect(workspaceAllows(`mkdir -p ~/ws2/fw && printf x > ~/ws2/fw/a.h`, rootHome)).toBe(true);
    expect(workspaceAllows(`printf x > ${v("HOME")}/m/mini/mini.ino`, rootHome)).toBe(true);
    for (const refused of ["printf x > ~", "printf x > ~/../x", "printf x > ~root/x", "printf x > /etc/x"]) {
      expect(workspaceAllows(refused, rootHome)).toBe(false);
    }
    expect(workspaceAllows("git restore src/app.ts", "core.git:restore-worktree")).toBe(true);
    expect(workspaceAllows(RESET_SAMPLE, "core.git:reset-hard")).toBe(false);
    expect(workspaceAllows("rm -rf ~", "core.filesystem:rm-rf-root-home")).toBe(false);
    expect(workspaceAllows("rm -rf build", null)).toBe(false);
  });

  it.concurrent("lets a rule-naming refusal through only for the workspace-bound shapes", () => {
    const bin = temp("ana-guard-rule-");
    writeFileSync(
      join(bin, "dcg"),
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--version" ]; then printf "%s\\n" 9.9.9; exit 0; fi',
        "command=$(/bin/cat)",
        'case "$command" in',
        `  *'> $HOME'*) printf "%s" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by dcg\\nRule: core.filesystem:redirect-truncate-dynamic-path"}}' ;;`,
        `  *"rm -rf"*) printf "%s" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by dcg\\nRule: core.filesystem:rm-rf-general"}}' ;;`,
        `  *"git checkout --"*) printf "%s" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by dcg\\nRule: core.git:checkout-discard"}}' ;;`,
        `  *"reset --hard"*) printf "%s" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by dcg\\nRule: core.git:reset-hard"}}' ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    chmodSync(join(bin, "dcg"), 0o700);
    const env = { PATH: bin, HOME: temp("ana-home-") };
    expect(refuseDestructiveCommand("rm -rf build/out", env)).toBeNull();
    expect(refuseDestructiveCommand("git checkout -- src/app.ts", env)).toBeNull();
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, env)).toContain(
      "Rule: core.filesystem:rm-rf-general",
    );
    expect(refuseDestructiveCommand("rm -rf ../sibling", env)).toContain(
      `Accepted: ${acceptedSpelling("core.filesystem:rm-rf-general", DCG_RULES)}`,
    );
    // The guard names one rule per answer: an admitted segment must not carry a refused one past it.
    expect(refuseDestructiveCommand("rm -rf build && git checkout -- a.ts", env)).toBeNull();
    expect(refuseDestructiveCommand(`rm -rf build; ${RESET_SAMPLE}`, env)).toContain(
      "Rule: core.git:reset-hard",
    );
    expect(refuseDestructiveCommand(`git checkout -- a.ts && ${RESET_SAMPLE}`, env)).toContain(
      "Rule: core.git:reset-hard",
    );
    expect(refuseDestructiveCommand("rm -rf build$(true)", env)).toContain(
      "Rule: core.filesystem:rm-rf-general",
    );
    const home = ["$", "HOME"].join("");
    expect(refuseDestructiveCommand(`echo x > ${home}/notes.txt`, env)).toBeNull();
    expect(refuseDestructiveCommand(`echo x > ${home}/notes.txt; ${DESTRUCTIVE_SAMPLE}`, env)).toContain(
      "Rule: core.filesystem:rm-rf-general",
    );
    expect(
      workspaceResidual(
        `echo x > ${home}/a && cat b > ${home}/c`,
        "core.filesystem:redirect-truncate-dynamic-path",
      ),
    ).toBe("echo x > /tmp/ana-guard/scratch && cat b > /tmp/ana-guard/scratch");
  });

  it.concurrent("replaces only the admitted segments in the residual it asks about again", () => {
    const rm = "core.filesystem:rm-rf-general";
    expect(workspaceResidual(`rm -rf build; ${RESET_SAMPLE}`, rm)).toBe(`true; ${RESET_SAMPLE}`);
    expect(workspaceResidual("git restore a.ts && git status", "core.git:restore-worktree")).toBe(
      "true && git status",
    );
    expect(workspaceResidual("rm -rf build && rm -rf out`x`", rm)).toBe("true && rm -rf out`x`");
    expect(workspaceResidual("rm -rf out$(x)", rm)).toBeNull();
    expect(workspaceResidual("rm -rf build", "core.git:reset-hard")).toBeNull();
  });

  it.concurrent("refuses the destructive shapes and lets ordinary work through", () => {
    const env = { PATH: fakeGuard("dcg"), HOME: temp("ana-home-") };
    // Start with a checkout that discards uncommitted work, as in the manual guard check.
    // Its familiar command name must not exempt it from the refusal.
    expect(refuseDestructiveCommand("git checkout -- src/app.ts", env)).toContain("BLOCKED by dcg");
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, env)).toContain("BLOCKED by dcg");
    // What a Builder actually needs to do, and what a guard that refused it would make useless.
    expect(refuseDestructiveCommand("ls -la /tmp", env)).toBeNull();
    expect(refuseDestructiveCommand("curl -fsSL https://sh.rustup.rs -o r.sh && sh r.sh -y", env)).toBeNull();
    expect(refuseDestructiveCommand("cargo build --release", env)).toBeNull();
  });

  it.concurrent("keeps the reason and the rule of dcg's refusal and drops the hand-over to a user", () => {
    // dcg's hook-mode reason for `rm -rf build/vendor`, explanation shortened.
    const measured = [
      "BLOCKED by dcg",
      "",
      'Tip: dcg explain "rm -rf build/vendor"',
      "",
      "Reason: rm -rf is destructive and requires human approval. Explain what you want to delete and why, then ask the user to run the command manually.",
      "",
      "Explanation: rm -rf recursively removes files and directories without confirmation prompts.",
      "             - mv <path> /tmp/delete-me-<literal-timestamp>: Move the tree aside",
      "",
      "Rule: core.filesystem:rm-rf-general",
      "",
      "If this operation is truly needed, ask the user for explicit permission and have them run the command manually.",
      "",
      "To permit this single command once, the user can approve it with: dcg allow-once 397850",
    ].join("\n");
    // The accepted spelling is quoted from the same rule list the Builder's prompt shows.
    expect(builderRefusal(measured)).toBe(
      [
        "BLOCKED by dcg",
        "Reason: rm -rf is destructive and requires human approval. Explain what you want to delete and why, then ask the user to run the command manually.",
        "Rule: core.filesystem:rm-rf-general",
        `Accepted: ${acceptedSpelling("core.filesystem:rm-rf-general", DCG_RULES)}`,
        BUILDER_REFUSAL_CLOSE,
      ].join("\n"),
    );
    for (const ruleId of ["core.git:reset-hard", "core.filesystem:redirect-truncate-dynamic-path"]) {
      expect(builderRefusal(`Rule: ${ruleId}`)).toContain(`Accepted: ${acceptedSpelling(ruleId, DCG_RULES)}`);
    }
    // An unknown rule, and a git rule id whose fix no line states, quote nothing rather than the cp line.
    expect(builderRefusal("Rule: some.pack:unknown")).not.toContain("Accepted:");
    expect(builderRefusal("Rule: core.git:push-force-short")).not.toContain("Accepted:");
  });

  // A refusal that quotes a spelling the same guard refuses costs a second turn and then quotes
  // nothing, because the second rule id maps to no line. dcg 0.14.0 refuses a move whose path is
  // a shell variable (`core.filesystem:mv-dynamic-path`: "Shell variables ... may resolve to /"),
  // so no accepted line may propose one.
  it.concurrent("quotes no move into a shell-variable destination", () => {
    const movesToVariable = new RegExp(
      [String.raw`\b(mv|move)\b[^;.]*`, String.raw`\$`, "[A-Za-z_]"].join(""),
    );
    const shared = [
      "core.filesystem:rm-rf-general",
      "core.filesystem:find-delete-general",
      "core.filesystem:redirect-truncate-dynamic-path",
    ];
    // The Built shell has no repository, so its list states no git remedy and a git refusal there
    // quotes nothing rather than a spelling for a tree the command cannot see.
    for (const [rules, quotable] of [
      [DCG_RULES, [...shared, "core.git:reset-hard"]],
      [BUILT_SHELL_RULES, shared],
    ] as const) {
      for (const ruleId of quotable) {
        const accepted = acceptedSpelling(ruleId, rules);
        expect(accepted).not.toBeNull();
        expect(accepted ?? "").not.toMatch(movesToVariable);
      }
    }
    expect(acceptedSpelling("core.git:reset-hard", BUILT_SHELL_RULES)).toBeNull();
    // The trash line names a destination each shell can write and the guard admits: a literal
    // relative directory for the Builder, the case home for the Built shell, whose /tmp other
    // solves share. The place line names each
    // shell's own folder. The write line names targets each shell keeps: the Built shell's TMPDIR
    // is fresh for each command, so it names only $HOME and ~. The Built list carries no git line and no
    // installed-tool line: its shell has neither a repository nor a .toolchain directory, and its
    // own tool description lists the programs on PATH.
    expect(acceptedSpelling("core.filesystem:rm-rf-general", DCG_RULES)).toContain("scratch/.trash/");
    expect(acceptedSpelling("core.filesystem:rm-rf-general", BUILT_SHELL_RULES)).toContain("or ~/<path>");
    expect(acceptedSpelling("core.filesystem:rm-rf-general", BUILT_SHELL_RULES)).not.toContain("/tmp/<name>");
    expect(BUILT_SHELL_RULES.length).toBeLessThan(DCG_RULES.length);
    expect(BUILT_SHELL_RULES.join(" ")).not.toContain("git checkout");
    expect(BUILT_SHELL_RULES.join(" ")).not.toContain(".toolchain");
    expect(BUILT_SHELL_RULES.join(" ")).not.toContain("workspace root");
    const builtWrite =
      acceptedSpelling("core.filesystem:redirect-truncate-dynamic-path", BUILT_SHELL_RULES) ?? "";
    expect(builtWrite).toContain("> to $HOME/<name>, ~/<name>");
    expect(builtWrite).not.toContain("$TMPDIR");
    expect(acceptedSpelling("core.filesystem:redirect-truncate-dynamic-path", DCG_RULES)).toContain(
      "$TMPDIR/<name>",
    );
    // The walls are each harness's own settings, so the shared lines name no number.
    expect(BUILT_SHELL_RULES.join(" ")).not.toMatch(/\d+ s\b/);
  });

  // Without a fallback, a guard with another layout would leave the session with the closing line
  // alone and no reason to act on.
  it.concurrent("keeps a bounded reason when the guard writes a layout without actionable lines", () => {
    const other = [
      "denied: rm is not allowed here",
      "",
      "see the policy file",
      ...Array.from({ length: 20 }, (_, i) => `detail ${String(i)}`),
    ].join("\n");
    const shown = builderRefusal(other).split("\n");
    expect(shown[0]).toBe("denied: rm is not allowed here");
    expect(shown[1]).toBe("see the policy file");
    expect(shown).toHaveLength(9);
    expect(shown[8]).toBe(BUILDER_REFUSAL_CLOSE);
    // The byte cap holds in both layouts: one actionable line of 3,008 bytes is cut and marked too.
    const longReason = builderRefusal(`Reason: ${"x".repeat(3000)}`).split("\n");
    expect(longReason).toHaveLength(2);
    expect(longReason[0]).toBe(`Reason: ${"x".repeat(992)} […2008 bytes omitted]`);
    expect(longReason[1]).toBe(BUILDER_REFUSAL_CLOSE);
  });

  it.concurrent("treats a host with no guard, and a guard that cannot answer, as no refusal", () => {
    const bare = { PATH: temp("ana-empty-"), HOME: temp("ana-home-") };
    expect(builderCommandGuards(bare)).toEqual([]);
    // Failing closed here would turn a broken safety net into a Builder that cannot run a command.
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, bare)).toBeNull();
  });

  it.concurrent("finds an installed guard when the controller's PATH does not name its directory", () => {
    // The launch-agent case: a minimal PATH, and the guard sitting where the installer puts it.
    // This is the same inherited-PATH gap that once had a Builder told `arduino-cli` was absent.
    const home = temp("ana-home-");
    mkdirSync(join(home, LOCAL, "bin"), { recursive: true });
    const installed = join(home, LOCAL, "bin", "dcg");
    writeFileSync(installed, readFileSync(join(fakeGuard("dcg"), "dcg"), "utf8"), { mode: 0o700 });
    chmodSync(installed, 0o700);
    const minimal = { PATH: "/nonexistent-ana", HOME: home };
    expect(builderCommandGuards(minimal)).toEqual([installed]);
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, minimal)).toContain("BLOCKED");
  });

  it.concurrent("still asks the fallback when an unrelated PATH binary shadows its name", () => {
    const bin = temp("ana-guard-");
    writeFileSync(join(bin, "dcg"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const home = temp("ana-home-");
    mkdirSync(join(home, LOCAL, "bin"), { recursive: true });
    writeFakeGuard(join(home, LOCAL, "bin", "dcg"), "fallback-dcg");
    const env = { PATH: bin, HOME: home };
    expect(builderCommandGuards(env)).toEqual([join(bin, "dcg"), join(home, LOCAL, "bin", "dcg")]);
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, env)).toContain("fallback-dcg");
  });
});

describe("the fullrun dcg presence check", () => {
  it.concurrent("names an existing protocol-compatible guard with its version and digest", () => {
    const bin = fakeGuard("dcg");
    const result = ensureBuilderCommandGuard({ PATH: bin, HOME: temp("ana-home-") });
    expect(result).toEqual({
      state: "existing",
      path: join(bin, "dcg"),
      dcgVersion: "9.9.9",
      binarySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      skippedReason: null,
    });
  });

  it.concurrent("reports a host with no guard as not installed and installs nothing", () => {
    const home = temp("ana-home-");
    const result = ensureBuilderCommandGuard({ PATH: temp("ana-empty-"), HOME: home });
    expect(result).toEqual({
      state: "skipped",
      path: null,
      dcgVersion: null,
      binarySha256: null,
      skippedReason: "not-installed",
    });
    expect(existsSync(join(home, LOCAL))).toBe(false);
  });

  it.concurrent("does not block or overwrite a stale or allowlisted existing guard", () => {
    for (const [contents, skippedReason] of [
      ["", "existing-unresponsive"],
      ["#!/bin/sh\nexit 0\n", "existing-not-refusing"],
    ] as const) {
      const bin = temp("ana-guard-");
      const guard = join(bin, "dcg");
      writeFileSync(guard, contents, { mode: 0o700 });
      const result = ensureBuilderCommandGuard({ PATH: bin, HOME: temp("ana-home-") });
      expect(result).toMatchObject({ state: "skipped", path: guard, skippedReason });
      expect(readFileSync(guard, "utf8")).toBe(contents);
    }
  });

  it.concurrent("reports a guard whose bytes change while its protocol is probed as unable to answer", () => {
    const bin = temp("ana-guard-");
    const guard = join(bin, "dcg");
    writeFileSync(
      guard,
      `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf '%s\n' 'before'; exit 0; fi
/bin/cat >/dev/null
/usr/bin/printf '#!/bin/sh\nexit 0\n' > "$0"
/bin/chmod 700 "$0"
printf '%s' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"old bytes"}}'
`,
      { mode: 0o700 },
    );
    const result = ensureBuilderCommandGuard({ PATH: bin, HOME: temp("ana-home-") });
    expect(result).toMatchObject({ state: "skipped", path: guard, skippedReason: "existing-unresponsive" });
  });

  // Safeguard 32: a guard that is installed but cannot answer lets the command run, by design;
  // the launch check saw a different state, so the run-local log is the only trace.
  it.concurrent("names an installed guard that answered nothing, since the command then ran unguarded", () => {
    const bin = temp("ana-guard-");
    const guard = join(bin, "dcg");
    writeFileSync(
      guard,
      [
        "#!/bin/sh",
        "/bin/cat >/dev/null",
        String.raw`/usr/bin/printf '#!/bin/sh\nexit 0\n' > "$0"`,
        '/bin/chmod 700 "$0"',
        'printf \'%s\' \'{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"old bytes"}}\'',
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    const logDir = temp("ana-safeguards-");
    const env = { PATH: bin, HOME: temp("ana-home-") };
    expect(refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, env, createSafeguardContext(logDir))).toBeNull();
    const log = readFileSync(join(logDir, SAFEGUARDS_LOG_FILE), "utf8");
    expect(log).toContain(
      `| 32-command-guard-unanswered | 1 installed guard(s) answered nothing about a "rm" command, which then ran unguarded: ${guard}`,
    );
    // A guard that answers, allowing or refusing, leaves no line.
    const answering = temp("ana-guard-");
    writeFakeGuard(join(answering, "dcg"), "answering");
    const quiet = temp("ana-safeguards-");
    const context = createSafeguardContext(quiet);
    expect(refuseDestructiveCommand("ls -la", { PATH: answering, HOME: env.HOME }, context)).toBeNull();
    expect(
      refuseDestructiveCommand(DESTRUCTIVE_SAMPLE, { PATH: answering, HOME: env.HOME }, context),
    ).toContain("BLOCKED by answering");
    expect(existsSync(join(quiet, SAFEGUARDS_LOG_FILE))).toBe(false);
  });

  // The classification defect behind safeguard 32's silence: a completed process was read as having
  // answered whatever it wrote, so a guard that had broken counted as one that allowed the command.
  it.concurrent("separates the hook protocol's silent allow from a guard that stated no decision", () => {
    const home = temp("ana-home-");
    const write = (name: string, body: string[]): string => {
      const bin = temp("ana-guard-");
      writeFileSync(join(bin, name), ["#!/bin/sh", "/bin/cat >/dev/null", ...body, ""].join("\n"), {
        mode: 0o700,
      });
      chmodSync(join(bin, name), 0o700);
      return join(bin, name);
    };
    const env = { PATH: "/usr/bin:/bin", HOME: home };
    // dcg's own allow: nothing on stdout, exit 0.
    expect(inspectBuilderCommandGuard(write("dcg", ["exit 0"]), "ls -la", env)).toEqual({
      answered: true,
      refusal: null,
    });
    // Its terminal layout instead of its hook JSON, and a crash with nothing to say: no decision.
    expect(
      inspectBuilderCommandGuard(
        write("dcg", ["printf '%s' 'dcg: internal error'", "exit 0"]),
        "ls -la",
        env,
      ),
    ).toEqual({
      answered: false,
      refusal: null,
    });
    expect(inspectBuilderCommandGuard(write("dcg", ["exit 1"]), "ls -la", env)).toEqual({
      answered: false,
      refusal: null,
    });
  });

  it.concurrent("ignores a non-regular PATH shadow and names the working fallback guard", () => {
    const shadowBin = temp("ana-shadow-");
    mkdirSync(join(shadowBin, "dcg"));
    const home = temp("ana-home-");
    const fallback = join(home, LOCAL, "bin", "dcg");
    mkdirSync(join(home, LOCAL, "bin"), { recursive: true });
    writeFakeGuard(fallback, "fallback-guard");
    const result = ensureBuilderCommandGuard({ PATH: shadowBin, HOME: home });
    expect(result).toMatchObject({ state: "existing", path: fallback, skippedReason: null });
  });

  /**
   * Both guards spelled this predicate with `lstat`, which answers `false` for every symbolic
   * link. A packaged binary is normally installed as one — every Homebrew executable in
   * `/opt/homebrew/bin` links into `../Cellar` — so on such a host no guard resolved, nothing was
   * asked about a destructive command, and the allow was silent, because a guard that cannot
   * answer is deliberately not a refusal. The case below keeps the other half: a link to a
   * directory is still not a regular file.
   */
  it.concurrent("finds a guard installed as a link to a real binary", () => {
    const real = temp("ana-real-");
    const target = join(real, "dcg-9.9.9");
    writeFakeGuard(target, "linked-guard");
    const home = temp("ana-home-");
    const bin = join(home, LOCAL, "bin");
    mkdirSync(bin, { recursive: true });
    const linked = join(bin, "dcg");
    symlinkSync(target, linked);
    const env = { PATH: "/usr/bin:/bin", HOME: home };
    expect(ensureBuilderCommandGuard(env)).toMatchObject({
      state: "existing",
      path: linked,
      skippedReason: null,
    });
    expect(builderCommandGuards(env)).toEqual([linked]);
  });

  it.concurrent("skips a fallback directory or link to one and times out an unresponsive file", () => {
    const home = temp("ana-home-");
    const bin = join(home, LOCAL, "bin");
    mkdirSync(bin, { recursive: true });
    const foreign = temp("ana-foreign-");
    const destination = join(bin, "dcg");
    symlinkSync(foreign, destination);
    const env = { PATH: "/usr/bin:/bin", HOME: home };
    expect(ensureBuilderCommandGuard(env).skippedReason).toBe("not-installed");
    unlinkSync(destination);
    mkdirSync(destination);
    expect(ensureBuilderCommandGuard(env).skippedReason).toBe("not-installed");
    rmSync(destination, { recursive: true });
    writeFileSync(destination, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
    const unresponsive = ensureBuilderCommandGuard(env, 100);
    expect(unresponsive).toMatchObject({
      state: "skipped",
      path: destination,
      skippedReason: "existing-unresponsive",
    });
    expect(builderCommandGuards({ PATH: bin, HOME: home })).toEqual([]);
  }, 20_000);

  it.concurrent("re-admits new responsive bytes published at a path that previously timed out", () => {
    const home = temp("ana-home-");
    const destination = join(home, LOCAL, "bin", "dcg");
    mkdirSync(join(home, LOCAL, "bin"), { recursive: true });
    writeFileSync(destination, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
    expect(ensureBuilderCommandGuard({ PATH: "/usr/bin:/bin", HOME: home }, 100).skippedReason).toBe(
      "existing-unresponsive",
    );
    expect(builderCommandGuards({ PATH: join(home, LOCAL, "bin"), HOME: home })).toEqual([]);
    writeFakeGuard(destination, "replacement-guard");
    expect(builderCommandGuards({ PATH: join(home, LOCAL, "bin"), HOME: home })).toContain(destination);
    expect(
      inspectBuilderCommandGuard(destination, RESET_SAMPLE, { PATH: "/usr/bin:/bin", HOME: home }),
    ).toMatchObject({ answered: true, refusal: expect.stringContaining("BLOCKED") });
    expect(builderCommandGuards({ PATH: join(home, LOCAL, "bin"), HOME: home })).toContain(destination);
  });
});

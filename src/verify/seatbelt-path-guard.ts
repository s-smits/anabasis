/**
 * A Seatbelt denial names a path string. This file handles two ways that string can fail to
 * protect the intended bytes:
 *
 * 1. Path form. `/var/folders/...` and `/private/var/folders/...` are the same directory, and the kernel
 *    matches the canonical one. A denial naming only the symlink form can miss the protected
 *    read. `canonicalForms` returns both.
 * 2. Location. A confined process that can rename an ancestor of a denied path moves the protected
 *    bytes to a path no rule mentions. `moveBlockingRules` denies those renames.
 *
 * The rename rules are copied, with the two departures named below, from `generateMoveBlockingRules`
 * in anthropic-experimental/sandbox-runtime, `src/sandbox/macos-sandbox-utils.ts`, Apache-2.0,
 * pinned at 295f0e1af832131efe40db22f2c65a57f461d849 (@anthropic-ai/sandbox-runtime 0.0.67).
 *
 * Why the rules exist. `(deny file-read* (subpath P))` names P as a string, so a confined process
 * that can rename an ancestor of P relocates the protected bytes to a path no rule mentions and
 * reads them there. This was measured on 2026-07-27 against the profile `solve-sandbox.ts` emitted
 * before this file existed: a direct read of the canary was refused, renaming the denied directory
 * itself was refused, and renaming its parent succeeded and returned the canary at exit 0. Adding
 * these rules refused that same rename.
 *
 * The hole belongs to the allow-by-default posture this solve isolation needs in order to let a
 * verified session reach its provider. The verifier isolation never had it: `darwin-seatbelt.ts` is
 * deny-by-default and allows writes only under its private workdir, so a rename elsewhere has no
 * allow to match and needs no rule of this kind.
 *
 * Two deliberate departures from upstream:
 * - No `(with message ...)` log tag. Upstream tags its rules so a log stream can attribute
 *   violations, and the tag carries a per-session random suffix. This profile's bytes are hashed
 *   into the isolation check result, so a random tag would give every run a different policy digest
 *   and break the `profileDigest === policyHash` comparison that binds probe evidence to the
 *   session policy.
 * - Literal paths only. Every path reaching this isolation is an already-canonicalised absolute
 *   root, so upstream's glob branch would be dead code here, carrying its own escaping risk for a
 *   spelling nothing emits.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { join, resolve } from "../meta/path.ts";
import { posixContainsPath } from "../meta/path-containment.ts";
import { ancestorDirectories } from "./wall-policy.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const MOVE_GUARD_CANARY = "ANA-MOVE-GUARD-CANARY-DO-NOT-TRUST";

/** One timeout for every probe feeding `HostSolveIsolationEvidence`. The move guard below and the
 *  read deny in `solve-sandbox.ts` both spawn through `runIsolationProbe`, and their results join in
 *  one evidence object (`moveGuardRefused` beside `deniedReadRefused`), so they are given the same
 *  bound here rather than two 20s constants maintained independently. */
const HOST_ISOLATION_PROBE_TIMEOUT_MS = 20_000;

export interface MoveGuardCheck {
  /** The rename was refused under a profile carrying these rules. */
  refused: boolean;
  /** The same rename succeeded once the rules were removed, so the refusal is attributable to them
   *  rather than to a filesystem that would have failed the rename anyway. */
  liftedSucceeded: boolean;
  detail: string;
}

/** Both path forms of a root: a deny that names only the symlink form leaves the real one open,
 *  which on Darwin is the difference between `/var` and `/private/var`. Every caller constructing a
 *  denial needs both forms, so this returns both rather than picking one. */
export function canonicalForms(path: string): string[] {
  const abs = resolve(path);
  try {
    const real = realpathSync.native(abs);
    return real === abs ? [abs] : [abs, real];
  } catch {
    return [abs];
  }
}

/** Whether a deny rooted at `root` reaches `target`. Used to lift exactly the rules covering one
 *  concrete path for the probe's discrimination check. SBPL paths are always "/"-separated. */
export function covers(root: string, target: string): boolean {
  return posixContainsPath(target, root);
}

/** One SBPL rule block: a verb and its path filters, or nothing when no path applies. Every profile
 *  in this family emits through here, so the solve and verifier isolations cannot drift apart on
 *  quoting or on what an empty path list means. */
export function sbRule(verb: string, form: "subpath" | "literal", paths: readonly string[]): string[] {
  return paths.length === 0
    ? []
    : [`(${verb}`, ...paths.map((path) => `  (${form} ${capturedJsonStringify(path)})`), ")"];
}

/** Upstream's pair. `file-write-unlink` covers the rename's source and `file-write-create` its
 *  destination, so neither moving a protected path away nor putting a symlink in its place is
 *  available. */
const MOVE_OPS = ["file-write-unlink", "file-write-create"] as const;

/** One process-result shape for every live isolation probe. The caller owns policy construction;
 *  this owner keeps the empty environment, the bounded wait and stdout/stderr collection identical
 *  across the ordinary read and both ancestor-rename controls, so a difference in their outcomes is
 *  a difference in the policy rather than in how they were run. */
export function runIsolationProbe(mechanismPath: string, args: readonly string[], cwd: string) {
  try {
    const result = Bun.spawnSync({
      cmd: [mechanismPath, ...args],
      cwd,
      env: {},
      timeout: HOST_ISOLATION_PROBE_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
    });
    const error =
      result.exitedDueToTimeout === true ? `timed out after ${HOST_ISOLATION_PROBE_TIMEOUT_MS}ms` : undefined;
    return {
      combined: `${result.stdout.toString()}${result.stderr.toString()}`,
      status: result.exitCode,
      ...keyIfDefined("error", error),
    };
  } catch (error) {
    return { combined: "", status: null, error: errorMessage(error) };
  }
}

/** Every directory a rename could relocate a protected root through. `/` is dropped: it is not
 *  renameable and naming it would deny the root inode itself. */
export function guardedAncestors(protectedRoots: readonly string[]): string[] {
  const ancestors = protectedRoots.flatMap((root) => ancestorDirectories(root));
  return [...new Set(ancestors)].filter((path) => path !== "/").sort();
}

/**
 * Deny rules that keep `protectedRoots` reachable only at the paths the read denies name. Sorted
 * and de-duplicated because these lines are part of the hashed profile: two runs with the same
 * roots must emit the same bytes.
 */
export function moveBlockingRules(protectedRoots: readonly string[]): string[] {
  const roots = [...new Set(protectedRoots)].sort();
  if (roots.length === 0) return [];
  const ancestors = guardedAncestors(roots);
  return MOVE_OPS.flatMap((op) => [
    `(deny ${op}`,
    ...roots.map((path) => `  (subpath ${capturedJsonStringify(path)})`),
    ...ancestors.map((path) => `  (literal ${capturedJsonStringify(path)})`),
    ")",
  ]);
}

/**
 * Execute the rename bypass against these rules, and do it on scratch paths: the check exists to
 * find out whether the rule form actually refuses a rename on this host and mechanism, and a failure
 * against a real protected ancestor would move the operator's home. That leaves the live probe
 * proving the rule form and `test/solve-sandbox.test.ts` proving, over the emitted profile text,
 * that the session's own roots carry those rules.
 */
export function probeMoveGuardCheck(mechanismPath: string): MoveGuardCheck {
  let workRoot: string | null = null;
  try {
    const parent = join(tmpdir(), "ana-move-guard-probe");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    workRoot = mkdtempSync(join(parent, "run-"));
    // Seatbelt matches the canonical path, and `tmpdir()` hands back the `/var/folders/...` symlink
    // form on Darwin. Rules written against the symlink form match nothing, which the first run of
    // this check reported as a permitted rename: the guard was working and its own probe paths were
    // not.
    const real = realpathSync.native(workRoot);
    const guarded = renameUnderRules(real, "guarded", mechanismPath);
    const lifted = renameUnderRules(real, "lifted", mechanismPath);
    if (guarded.error !== undefined || lifted.error !== undefined) {
      return {
        refused: false,
        liftedSucceeded: false,
        detail: `move guard mechanism could not execute: ${guarded.error ?? lifted.error}`,
      };
    }
    const refused =
      guarded.status !== 0 && /operation not permitted|not permitted|denied/i.test(guarded.combined);
    const liftedSucceeded = lifted.status === 0;
    const attributable = liftedSucceeded
      ? "ancestor rename refused under the guard rules and permitted without them"
      : "ancestor rename refused, but the lifted control also failed — refusal not attributable";
    return {
      refused,
      liftedSucceeded,
      detail: refused
        ? attributable
        : "ancestor rename was PERMITTED under the guard rules — the read denies are relocatable",
    };
  } catch (error) {
    return {
      refused: false,
      liftedSucceeded: false,
      detail: `move guard probe error: ${errorMessage(error)}`,
    };
  } finally {
    if (workRoot !== null) {
      try {
        rmSync(workRoot, { recursive: true, force: true });
      } catch {
        // cleanup of a root that may already be gone
      }
    }
  }
}

/** One check: build a protected root two levels down, then try to rename its parent. The parent is
 *  the path a read deny naming the root would never mention, so it is where the bypass lives. The
 *  guarded and lifted steps differ only in whether the move rules are present, which is what makes a
 *  refusal attributable to them. */
function renameUnderRules(
  workRoot: string,
  stepName: "guarded" | "lifted",
  mechanismPath: string,
): { combined: string; status: number | null; error?: string } {
  const home = join(workRoot, stepName, "home");
  const secret = join(home, "secret");
  mkdirSync(secret, { recursive: true, mode: 0o700 });
  writeFileSync(join(secret, "canary.txt"), `${MOVE_GUARD_CANARY}\n`, { mode: 0o600 });
  const profile = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath ${capturedJsonStringify(secret)}))`,
    ...(stepName === "guarded" ? moveBlockingRules([secret]) : []),
    "",
  ].join("\n");
  return runIsolationProbe(
    mechanismPath,
    ["-p", profile, "/bin/mv", home, join(workRoot, stepName, "moved")],
    workRoot,
  );
}

/** Candidate-owned inputs for the correctness-model workshop, narrowed before execution. */
import { existsSync, mkdirSync, realpathSync } from "../meta/filesystem.ts";
import { join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import type { VerifierWorkshopAction } from "./verifier-workshop-evidence.ts";
import { keysIf } from "../meta/optional-key.ts";
import { hostToolchainEnv, toolchainPathDirs } from "../verify/wall-policy.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { runtimeProcess } from "../meta/process.ts";

export type VerifierWorkshopRequest =
  | { url: string }
  | { path: string; destination: string }
  // `exactOptionalPropertyTypes` is on, so the explicit `| undefined` is what lets a caller pass a
  // read request whose offset and limit were not supplied. Without it this needs a second, narrower
  // `{ path: string }` variant saying the same thing.
  | { path: string; offset?: number | undefined; limit?: number | undefined }
  | { path: string; contentBytes: number; contentSha256: string }
  | { command: string; cwd: string; stdinBytes: number | null; stdinSha256: string | null };

export class VerifierWorkshopRequestRefusal extends Error {}

function refuse(message: string): never {
  throw new VerifierWorkshopRequestRefusal(message);
}

/** The request digest of one completed workshop action. The writer and the reader share this shape. */
export function actionRequestDigest(
  action: VerifierWorkshopAction,
  request: VerifierWorkshopRequest,
): string {
  return hashJsonBytes({ action, request });
}

export function workshopPath(root: string, requested = "."): string {
  const target = resolve(root, requested);
  if (!containsPath(target, root)) refuse("correctness-model workshop path must stay inside campaign .oss");
  return target;
}

export function existingWorkshopPath(root: string, requested = "."): string {
  const target = workshopPath(root, requested);
  let physicalTarget: string;
  try {
    physicalTarget = realpathSync.native(target);
  } catch {
    refuse("correctness-model workshop path does not exist");
  }
  if (!containsPath(physicalTarget, root)) {
    refuse("correctness-model workshop physical path must stay inside campaign .oss");
  }
  return physicalTarget;
}

export function workshopEnvironment(root: string): OptionalEnvValues {
  const safeDir = (name: string) => {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    const physical = realpathSync.native(path);
    if (!containsPath(physical, root)) {
      throw new Error(`correctness-model workshop ${name} directory escapes its cell`);
    }
    return physical;
  };
  const home = safeDir(".home");
  const cache = safeDir(".cache");
  const tmp = safeDir(".tmp");
  const commandLineTools = "/Library/Developer/CommandLineTools";
  const directDarwinToolchain =
    runtimeProcess.platform === "darwin" && existsSync(join(commandLineTools, "SDKs", "MacOSX.sdk"));
  return {
    // Resolve Darwin's compiler and SDK directly. The /usr/bin shim uses xcrun's ambient
    // per-user cache, which is deliberately outside the workshop's authority, so the
    // CommandLineTools directory stays ahead of everything else.
    //
    // The rest is `toolchainPathDirs`, the same search path the Built Harness shell uses and the
    // same install roots the read grant covers. A hardcoded literal here is what made the removed
    // runtime-fact probe lie: it resolved `pio`, `arduino-cli` and `node` off the harness PATH and
    // reported them available, while this cell answered `command not found` for all three, because
    // /opt/zerobrew/bin was on one list and not the other. That probe is gone, so this cell and the
    // Builder's own shell are now the only places a Builder learns what the host carries: one whose
    // PATH is short concludes no compiler exists and writes a substitute for one. Run w39-sol did
    // that and shipped a parser as its compiler.
    PATH: (directDarwinToolchain
      ? [`${commandLineTools}/usr/bin`, ...toolchainPathDirs()]
      : toolchainPathDirs()
    ).join(":"),
    ...keysIf(directDarwinToolchain, () => ({ SDKROOT: join(commandLineTools, "SDKs", "MacOSX.sdk") })),
    // The names a toolchain uses to find its own installation, which moving HOME into the cell
    // otherwise hides. The Built Harness shell has carried these since the wall was written; the
    // Builder cell did not, which left `cargo --version` answering "rustup could not choose a
    // version" with `~/.rustup` readable on disk (measured 2026-08-19 by the install probe). The
    // roots stay read-only; anything a toolchain writes goes to the cell's own cache below.
    ...hostToolchainEnv(),
    LANG: "C",
    LC_ALL: "C",
    CI: "1",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: cache,
    TMPDIR: tmp,
    npm_config_cache: join(cache, "npm"),
    UV_CACHE_DIR: join(cache, "uv"),
    // Cargo reads its toolchain through RUSTUP_HOME above and writes its registry cache here, so
    // the host installation stays untouched while a crate build still has somewhere to work.
    CARGO_HOME: join(cache, "cargo"),
    // Node aborts at startup when an inherited OPENSSL_CONF points at an unreadable file;
    // run w11 lost 5 workshop actions to it. The same neutral pin the other runtimes use.
    OPENSSL_CONF: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function verifierWorkshopCommand(value: string, max: number): string {
  if (value.trim() === "") refuse("run command must not be empty");
  // Newlines stay: both cells hand the text to one shell (`sh -c` locally, single-quoted over
  // ssh), and truss run 406cca spent a refused call and a script file on the old one-line rule.
  if (value.includes("\0")) refuse("run command must be text with no NUL bytes");
  if (value.length > max) refuse(`run command exceeds ${max} bytes`);
  return value;
}

export function verifierWorkshopContent(value: string, max: number, subject = "write content"): string {
  if (value.includes("\0")) refuse(`${subject} must be text with no NUL bytes`);
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > max) refuse(`${subject} is ${bytes} bytes and exceeds the ${max} byte limit`);
  return value;
}

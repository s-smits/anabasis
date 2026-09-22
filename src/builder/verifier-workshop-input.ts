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
  // `| undefined` lets a caller pass unsupplied offset and limit under `exactOptionalPropertyTypes`.
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
    // Darwin's CommandLineTools come first: the /usr/bin shim uses xcrun's per-user cache, which
    // lies outside the workshop. The rest is `toolchainPathDirs`, the same search path the Built
    // Harness shell uses, so the cell sees every compiler the host carries.
    PATH: (directDarwinToolchain
      ? [`${commandLineTools}/usr/bin`, ...toolchainPathDirs()]
      : toolchainPathDirs()
    ).join(":"),
    ...keysIf(directDarwinToolchain, () => ({ SDKROOT: join(commandLineTools, "SDKs", "MacOSX.sdk") })),
    // The variables a toolchain uses to find its installation, which moving HOME would hide. The
    // roots stay read-only; toolchain writes go to the cell's own cache below.
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
    // Node aborts at startup when an inherited OPENSSL_CONF points at an unreadable file.
    OPENSSL_CONF: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function verifierWorkshopCommand(value: string, max: number): string {
  if (value.trim() === "") refuse("run command must not be empty");
  // Newlines are allowed: both cells hand the text to one shell.
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

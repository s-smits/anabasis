/**
 * Resolve Apple developer tools to their executable paths. On Darwin, `/usr/bin/git` and
 * `/usr/bin/otool` are xcrun shims: each invocation resolves the active developer directory
 * before starting the tool. That lookup can exceed the work of a short command. On macOS 15
 * (2026-08-23, `--version`, 40 runs each), git took 9.7 ms through the shim and 3.1 ms directly;
 * otool took 28.0 ms and 6.2 ms. A campaign starts thousands of git processes, mostly for
 * domain-workspace operations. The shim accounted for a fifth of the suite's git time and
 * most of its otool time in that measurement.
 *
 * Search PATH first, preserving a Homebrew installation, custom build or test executable found
 * before the Apple shim. Only an exact `/usr/bin/<tool>` match is replaced with the binary under
 * the directory reported by `xcode-select -p`, and only when that binary exists: Command Line
 * Tools keep every tool in `usr/bin`, while a full Xcode keeps `git` there and `otool` and
 * `install_name_tool` in its default toolchain. A developer directory holding neither keeps the
 * shim. On a GitHub macOS runner, which selects a full Xcode, the unchecked `usr/bin/otool` did not
 * exist, so every runtime-closure attestation failed as a sandbox non-result.
 * Both that developer directory and each tool's resolved path are cached for this process;
 * later environment or developer-directory changes do not refresh them. If PATH contains no
 * matching entry, return the bare name and leave resolution or failure to process creation.
 * This helper selects host-command paths. Verifier tool identity is separately recorded by
 * the verifier's executable hashing and attestation path.
 */
import { existsSync } from "./filesystem.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";

const resolvedTools = new Map<string, string>();
let developerDir: string | null | undefined;

function activeDeveloperDir(): string | null {
  if (developerDir !== undefined) return developerDir;
  developerDir = null;
  if (runtimeProcess.platform !== "darwin") return developerDir;
  try {
    const found = Bun.spawnSync({ cmd: ["xcode-select", "-p"], stdout: "pipe", stderr: "pipe" });
    const directory = found.success ? found.stdout.toString().trim() : "";
    if (directory !== "") developerDir = directory;
  } catch {
    // No xcode-select on this host: the bare name is the answer and PATH resolves it.
  }
  return developerDir;
}

/** The tool's own binary in the active developer directory, or null when it holds none. */
function developerTool(name: string): string | null {
  const directory = activeDeveloperDir();
  if (directory === null) return null;
  for (const bin of [
    join(directory, "usr", "bin"),
    join(directory, "Toolchains", "XcodeDefault.xctoolchain", "usr", "bin"),
  ]) {
    if (existsSync(join(bin, name))) return join(bin, name);
  }
  return null;
}

/** The first existing `<dir>/<name>` across PATH, or null when PATH holds no such tool. */
function firstPathResolution(name: string): string | null {
  for (const dir of (Bun.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The direct path to a developer tool, or the bare name when this host resolves it through PATH. */
export function hostTool(name: string): string {
  const remembered = resolvedTools.get(name);
  if (remembered !== undefined) return remembered;
  const fromPath = firstPathResolution(name);
  const direct = fromPath === join("/usr/bin", name) ? developerTool(name) : null;
  const answer = direct ?? fromPath ?? name;
  resolvedTools.set(name, answer);
  return answer;
}

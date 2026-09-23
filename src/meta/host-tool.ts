/**
 * Resolve Apple developer tools to their executable paths. On Darwin, `/usr/bin/git` and
 * `/usr/bin/otool` are xcrun shims: each invocation resolves the active developer directory before
 * starting the tool, and that lookup can cost more than the command itself. Measured on macOS 15
 * (2026-08-23, `--version`, 40 runs each), git took 9.7 ms through the shim and 3.1 ms directly, and
 * otool 28.0 ms against 6.2 ms. A campaign starts thousands of git processes, mostly for
 * domain-workspace operations, so the shim accounted for a fifth of the suite's git time and most of
 * its otool time.
 *
 * PATH is searched first, which preserves a Homebrew installation, a custom build or a test
 * executable found ahead of the Apple shim. Only an exact `/usr/bin/<tool>` match is replaced, with
 * the binary under the directory `xcode-select -p` reports, and only when that binary exists:
 * Command Line Tools keep every tool in `usr/bin`, while a full Xcode keeps `git` there and `otool`
 * and `install_name_tool` in its default toolchain. A developer directory holding neither keeps the
 * shim — on a GitHub macOS runner, which selects a full Xcode, the unchecked `usr/bin/otool` did not
 * exist and every runtime-closure attestation failed as a sandbox non-result.
 *
 * The developer directory and each tool's resolved path are cached for the life of the process, so a
 * later environment or developer-directory change does not refresh them. With no PATH match the bare
 * name is returned and resolution, or failure, is left to process creation. This helper selects host
 * command paths only; verifier tool identity is recorded separately, by the verifier's own
 * executable hashing and attestation path.
 */
import { existsSync } from "./filesystem.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";

const resolvedTools = new Map<string, string>();
let developerBinDirs: string[] | undefined;

function activeDeveloperBinDirs(): string[] {
  if (developerBinDirs !== undefined) return developerBinDirs;
  developerBinDirs = [];
  if (runtimeProcess.platform !== "darwin") return developerBinDirs;
  try {
    const found = Bun.spawnSync({ cmd: ["xcode-select", "-p"], stdout: "pipe", stderr: "pipe" });
    const directory = found.success ? found.stdout.toString().trim() : "";
    if (directory !== "") {
      developerBinDirs = [
        join(directory, "usr", "bin"),
        join(directory, "Toolchains", "XcodeDefault.xctoolchain", "usr", "bin"),
      ];
    }
  } catch {
    // No xcode-select on this host: the bare name is the answer and PATH resolves it.
  }
  return developerBinDirs;
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
  const direct =
    fromPath === join("/usr/bin", name)
      ? activeDeveloperBinDirs()
          .map((dir) => join(dir, name))
          .find((path) => existsSync(path))
      : undefined;
  const answer = direct ?? fromPath ?? name;
  resolvedTools.set(name, answer);
  return answer;
}

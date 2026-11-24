/**
 * Resolve Apple developer tools to their executable paths. On Darwin, `/usr/bin/git` and
 * `/usr/bin/otool` are xcrun shims: each invocation resolves the active developer directory before
 * starting the tool, and that lookup can cost more than the command itself. Measured on macOS 15
 * over 40 `--version` runs each, git takes 9.7 ms through the shim against 3.1 ms directly, and
 * otool 28.0 ms against 6.2 ms. A campaign starts thousands of git processes, mostly for
 * domain-workspace operations, so the shim accounts for a fifth of the suite's git time and most of
 * its otool time.
 */
import { existsSync } from "./filesystem.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";

const resolvedTools = new Map<string, string>();
let developerBinDirs: string[] | undefined;

/** Where the active developer directory keeps its tools, and none off Darwin: `usr/bin`, and a full
 *  Xcode's default toolchain, which holds its compilers. */
export function activeDeveloperBinDirs(): string[] {
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

/** The direct path to a developer tool, or the bare name when this host resolves it through PATH. */
export function hostTool(name: string): string {
  const remembered = resolvedTools.get(name);
  if (remembered !== undefined) return remembered;
  const fromPath = (Bun.env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map((dir) => join(dir, name))
    .find(existsSync);
  const direct =
    fromPath === join("/usr/bin", name)
      ? activeDeveloperBinDirs()
          .map((dir) => join(dir, name))
          .find(existsSync)
      : undefined;
  const answer = direct ?? fromPath ?? name;
  resolvedTools.set(name, answer);
  return answer;
}

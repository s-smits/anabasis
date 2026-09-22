/**
 * Resolve Apple developer tools to their executable paths. On Darwin, `/usr/bin/git` and
 * `/usr/bin/otool` are xcrun shims that resolve the developer directory on every call, which costs
 * several times a short command's own work, and a campaign starts thousands of git processes.
 *
 * PATH is searched first, so a Homebrew, custom or test executable ahead of the shim wins. Only an
 * exact `/usr/bin/<tool>` match is replaced, with the binary under `xcode-select -p` when it
 * exists: Command Line Tools keep every tool in `usr/bin`, a full Xcode keeps `otool` and
 * `install_name_tool` in its default toolchain. Results are cached for this process. With no PATH
 * match the bare name is returned. Verifier tool identity is recorded separately by the verifier.
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

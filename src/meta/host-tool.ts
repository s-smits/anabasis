import { existsSync } from "./filesystem.ts";
import { join } from "./path.ts";
import { runtimeProcess } from "./process.ts";

const resolvedTools = new Map<string, string>();
let developerBinDirs: string[] | undefined;

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

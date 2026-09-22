/**
 * The exact non-system Mach-O images an executable needs before it can run under a deny-default
 * Seatbelt profile, shared by the generated-tool worker and the verifier host so neither grants
 * package-wide reads.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { realpathSync } from "../meta/filesystem.ts";
import { hostTool } from "../meta/host-tool.ts";
import { dirname, isAbsolute, join, resolve } from "../meta/path.ts";
import { isRegularFile } from "./exact-read-attestation.ts";
import { snapshotReadRootPath } from "./read-root-attestation.ts";

const MAX_RUNTIME_IMAGES = 256;

/**
 * Load commands per image, since `otool` is a process each time. The key carries the file's
 * metadata, so a rebuilt or replaced image at the same path is inspected again.
 */
const loadCommandsByImage = new Map<
  string,
  { dependencies: readonly string[]; runpaths: readonly string[] }
>();

function canonicalFile(path: string, source: string): string {
  if (!isAbsolute(path) || !isRegularFile(path)) {
    throw new Error(`${source} names unavailable runtime file ${capturedJsonStringify(path)}`);
  }
  return realpathSync.native(path);
}

function inspectMachO(image: string) {
  // Keyed by complete metadata: an unprivileged writer can restore size and mtime, not ctime, and a
  // replacement has a new inode.
  const key = capturedJsonStringify(snapshotReadRootPath(image));
  const remembered = loadCommandsByImage.get(key);
  if (remembered !== undefined) return remembered;
  const found = readMachOLoadCommands(image);
  loadCommandsByImage.set(key, found);
  return found;
}

function readMachOLoadCommands(image: string) {
  // Resolved past the xcrun shim, which otherwise dominates the cost of each call.
  const otool = hostTool("otool");
  const inspected = Bun.spawnSync({
    cmd: [otool, "-l", image],
    env: {},
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!inspected.success || inspected.exitedDueToTimeout === true) {
    const found = inspected.stderr.toString().trim() || `exit ${inspected.exitCode}`;
    throw new Error(
      `${otool} could not inspect runtime image ${capturedJsonStringify(image)}: ${found}; a Darwin sandbox runtime must expose readable Mach-O load commands`,
    );
  }
  const stdout = inspected.stdout.toString();
  const dependencies: string[] = [];
  const runpaths: string[] = [];
  let pending: "dependency" | "runpath" | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (/^cmd LC_(?:LOAD|LOAD_WEAK|REEXPORT|LAZY_LOAD)_DYLIB$/.test(trimmed)) {
      pending = "dependency";
      continue;
    }
    if (trimmed === "cmd LC_RPATH") {
      pending = "runpath";
      continue;
    }
    const value = pending === "dependency" ? /^name (.+) \(offset \d+\)$/.exec(trimmed) : null;
    const path = pending === "runpath" ? /^path (.+) \(offset \d+\)$/.exec(trimmed) : null;
    if (value?.[1] !== undefined) {
      dependencies.push(value[1]);
      pending = null;
    } else if (path?.[1] !== undefined) {
      runpaths.push(path[1]);
      pending = null;
    }
  }
  return { dependencies, runpaths };
}

function expandLoaderToken(value: string, image: string, executable: string): string {
  if (value === "@loader_path" || value.startsWith("@loader_path/")) {
    return resolve(dirname(image), value.slice("@loader_path".length).replace(/^\//, ""));
  }
  if (value === "@executable_path" || value.startsWith("@executable_path/")) {
    return resolve(dirname(executable), value.slice("@executable_path".length).replace(/^\//, ""));
  }
  return value;
}

function isSystemLibrary(path: string): boolean {
  return path.startsWith("/System/") || path.startsWith("/usr/lib/");
}

function resolveDependency(
  loadPath: string,
  image: string,
  executable: string,
  runpaths: readonly string[],
): string {
  const candidates = loadPath.startsWith("@rpath/")
    ? runpaths.map((runpath) =>
        join(expandLoaderToken(runpath, image, executable), loadPath.slice("@rpath/".length)),
      )
    : [expandLoaderToken(loadPath, image, executable)];
  const resolved = candidates.find((candidate) => isAbsolute(candidate) && isRegularFile(candidate));
  if (resolved === undefined) {
    throw new Error(
      `Mach-O dependency ${capturedJsonStringify(loadPath)} from ${capturedJsonStringify(image)} ` +
        `resolved to [${candidates.join(", ")}]; one exact regular file is required`,
    );
  }
  return resolved;
}

/**
 * Every non-system dynamic image needed to start `executable`, as regular files. System libraries
 * belong to the imported, hashed system.sb files; the policy snapshot expands symbolic links.
 */

export function darwinRuntimeReadPaths(executablePath: string): string[] {
  const executable = canonicalFile(executablePath, "Darwin sandbox runtime");
  const runtimePaths = new Set<string>([executablePath]);
  const visited = new Set<string>();
  const pending: Array<{ image: string; inheritedRunpaths: string[] }> = [
    { image: executable, inheritedRunpaths: [] },
  ];
  while (pending.length > 0) {
    const next = pending.shift();
    if (next === undefined) break;
    const image = canonicalFile(next.image, "Darwin sandbox runtime closure");
    if (visited.has(image)) continue;
    if (visited.size >= MAX_RUNTIME_IMAGES) {
      throw new Error(
        `Darwin runtime closure exceeded ${MAX_RUNTIME_IMAGES} images; a bounded exact closure is required`,
      );
    }
    visited.add(image);
    const inspected = inspectMachO(image);
    const runpaths = [
      ...inspected.runpaths.map((path) => expandLoaderToken(path, image, executable)),
      ...next.inheritedRunpaths,
    ];
    for (const dependency of inspected.dependencies) {
      if (isSystemLibrary(dependency)) continue;
      const resolved = resolveDependency(dependency, image, executable, runpaths);
      if (isSystemLibrary(resolved)) continue;
      runtimePaths.add(resolved);
      const canonical = canonicalFile(resolved, "Darwin runtime dependency");
      pending.push({ image: canonical, inheritedRunpaths: runpaths });
    }
  }
  return [...runtimePaths].sort();
}

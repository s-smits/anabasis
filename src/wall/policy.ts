import type { OptionalEnvValues } from "../agent/backends/scrub-env.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "../meta/filesystem.ts";
import { activeDeveloperBinDirs } from "../meta/host-tool.ts";
import { dirname, isAbsolute, join, resolve } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { homedir, tmpdir } from "../meta/os.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { claim } from "./seat-root.ts";

export interface WallSupport {
  ok: boolean;
  reason: string | null;
  mechanismPath: string;
  mechanismDigest: string | null;
}

const darwinAnswers = new Map<string, string | undefined>();

export const BUILT_COMMAND_SCRATCH_ROOT = join(tmpdir(), "ana-built-bash");

const HOST_SCRATCH_ROOT = join(tmpdir(), "ana-host");

export const SCRATCH_ROOTS: readonly string[] = [BUILT_COMMAND_SCRATCH_ROOT, HOST_SCRATCH_ROOT];

export const SUITE_SCRATCH_ROOT = join(tmpdir(), "ana-test-suite");

export const TOOLCHAIN_HOME_ROOTS = [
  ".bun",
  ".cargo",
  ".deno",
  ".espressif",
  ".local",
  ".nvm",
  ".platformio",
  ".pyenv",
  ".rustup",
  "Library/Arduino15",
  "go",
];

export function hostRoots(): string[] {
  return SCRATCH_ROOTS.flatMap(canonicalForms).toSorted(compareCodeUnits);
}

export function hostScratch(prefix: string): string {
  mkdirSync(HOST_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
  const folder = mkdtempSync(join(HOST_SCRATCH_ROOT, prefix));
  claim(folder);
  return folder;
}

export function canonicalForms(path: string): string[] {
  const abs = resolve(path);
  try {
    const real = realpathSync.native(abs);
    return real === abs ? [abs] : [abs, real];
  } catch {
    return [abs];
  }
}

export function canonicalRoots(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap(canonicalForms))].toSorted();
}

export function darwinToolchainInstallRoots(): string[] {
  const home = closedHome();
  return ["/usr/local", ...(home === undefined ? [] : TOOLCHAIN_HOME_ROOTS.map((rel) => join(home, rel)))]
    .filter(existsSync)
    .toSorted(compareCodeUnits);
}

function darwinAnswer(...command: string[]): string | undefined {
  if (runtimeProcess.platform !== "darwin") return undefined;
  const asked = command.join(" ");
  if (!darwinAnswers.has(asked)) {
    const probe = Bun.spawnSync(command, { stdout: "pipe", stderr: "ignore" });
    const found = probe.exitCode === 0 ? probe.stdout.toString().trim() : "";
    darwinAnswers.set(asked, found === "" ? undefined : found);
  }
  return darwinAnswers.get(asked);
}

export function userTempRules() {
  const confstr = darwinAnswer("/usr/bin/getconf", "DARWIN_USER_TEMP_DIR")?.replace(/\/$/, "");
  const roots = confstr === undefined ? [] : canonicalForms(confstr);
  const made = `([^/]+[.]${"[A-Za-z0-9]".repeat(10)}|tmp${"[a-z0-9_]".repeat(8)})`;
  const rules = roots.flatMap((root) => {
    const under = `(regex-quote ${capturedJsonStringify(root)})`;
    return [
      `(allow file-read* file-read-metadata file-write* (require-all (regex (string-append #"^" ${under} #"/[^/]+$")) (vnode-type REGULAR-FILE)))`,
      `(allow file-read* file-read-metadata file-write* (regex (string-append #"^" ${under} #"/${made}(/.*)?$")))`,
      `(allow file-read-metadata (literal ${capturedJsonStringify(root)}))`,
    ];
  });
  return { roots, rules };
}

export function toolchainPathDirs(): string[] {
  const user = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/zerobrew/bin"];
  const installed = darwinToolchainInstallRoots().flatMap((root) => [join(root, "bin"), join(root, "shims")]);
  const system = [...activeDeveloperBinDirs(), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const scan = { onlyFiles: false, absolute: true, followSymlinks: true };
  const glob = (cwd: string) => [...new Bun.Glob("opt/python*/libexec/bin").scanSync({ ...scan, cwd })];
  const brewed = user.map(dirname).filter(existsSync).flatMap(glob).toSorted(compareCodeUnits);
  const home = closedHome();
  const pinned = home === undefined ? [] : [pinnedPythonDir(home)];
  return [...new Set([...pinned, ...user, ...brewed.toReversed(), ...installed, ...system])].filter(
    existsSync,
  );
}

export function closedHome(): string | undefined {
  const home = homedir();
  return isAbsolute(home) ? home : undefined;
}

export function pinnedPythonDir(home: string): string {
  return join(home, ".local", "share", "ana-python", "bin");
}

export function hostToolchainEnv() {
  const [sdk, home] = [darwinAnswer("/usr/bin/xcrun", "--show-sdk-path"), closedHome()];
  const rustup = home === undefined ? undefined : join(home, ".rustup");
  return {
    ...keyIfDefined("SDKROOT", sdk),
    ...keyIfDefined("RUSTUP_HOME", rustup !== undefined && existsSync(rustup) ? rustup : undefined),
  };
}

export function ancestorDirectories(path: string): string[] {
  const ancestors: string[] = [];
  for (let current = dirname(path), parent = dirname(current); current !== "/" && current !== "."; ) {
    ancestors.push(current);
    if (parent === current) break;
    [current, parent] = [parent, dirname(parent)];
  }
  return ancestors.toReversed();
}

export function traversalMetadataRules(paths: string[]): string[] {
  const ancestors = [...new Set(paths.flatMap(ancestorDirectories))]
    .filter((path) => path !== "/")
    .toSorted(compareCodeUnits);
  return ancestors.map((path) => `(allow file-read-metadata (literal ${capturedJsonStringify(path)}))`);
}

export function surroundingSandbox(env: OptionalEnvValues): boolean {
  return Object.hasOwn(env, "CODEX_SANDBOX") || Object.hasOwn(env, "HARNESS_INNER_UNSANDBOXED");
}

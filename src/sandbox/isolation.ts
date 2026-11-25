import { existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { containsPath } from "../meta/path-containment.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { capturedExecPath } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { TOOL_TREE_LIB } from "../meta/bundle-layout.ts";
import { LINUX_BWRAP_ID, bwrapCommandArgs, nodeRuntimeReadRoots } from "./linux-bwrap.ts";
import type { EnvValues } from "../agent/backends/scrub-env.ts";
import { covers, moveBlockingRules, sbRule } from "./seatbelt-path-guard.ts";
import { seatbeltBaseRules } from "./seatbelt-base.ts";
import type { SolveIsolationPolicy } from "./base.ts";
import {
  ancestorDirectories,
  canonicalForms,
  canonicalRoots,
  darwinToolchainInstallRoots,
  hostToolchainEnv,
  toolchainPathDirs,
  traversalMetadataRules,
  hostRoots,
  userTempRules,
} from "./policy.ts";

interface CommandIsolationEnvironment extends EnvValues {
  PATH: string;
  HOME: string;
  TMPDIR: string;
  LANG: string;
}

const TOOL_TREE_BIN_DIRS = new Set(["bin", "shims", "sbin"]);
const TOOL_TREE_MAX_DEPTH = 5;
const TOOL_TREE_MAX_DIRS = 4000;

interface CommandIsolationPolicy {
  profile: string | null;
  mechanismPath: string;
  network: boolean;
  scratchRoots: string[];
  keptRoots: string[];
  readAllowRoots: string[];
  readDenies: string[];
  environment: CommandIsolationEnvironment;
}

interface CommandDirectories {
  root: string;
  kept: string;
  home: string;
  temp: string;
  toolTree?: string | null;
}

export function toolTreeSearchDirs(toolTree: string): string[] {
  if (!existsSync(toolTree)) return [];
  const found: string[] = [join(toolTree, "bin")].filter(existsSync);
  const queue: { dir: string; depth: number }[] = [{ dir: toolTree, depth: 0 }];
  for (let visited = 0; visited < TOOL_TREE_MAX_DIRS && visited < queue.length; visited += 1) {
    const next = queue[visited];
    if (next === undefined) break;
    const { dir, depth } = next;
    if (TOOL_TREE_BIN_DIRS.has(basename(dir)) && !found.includes(dir)) found.push(dir);
    if (depth >= TOOL_TREE_MAX_DEPTH) continue;
    try {
      const children = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== "node_modules")
        .map((entry) => join(dir, entry.name));
      for (const child of children.toSorted(compareCodeUnits)) queue.push({ dir: child, depth: depth + 1 });
    } catch {
      // Skip unreadable directories.
    }
  }
  return found;
}

export function toolTreeImports(toolTree: string | null): string | undefined {
  const lib = toolTree === null ? undefined : join(toolTree, TOOL_TREE_LIB);
  return lib !== undefined && existsSync(lib) ? lib : undefined;
}

function commandSearchPath(
  toolTree: string | null,
  executable: string = capturedExecPath,
  fallback: readonly string[] = toolchainPathDirs(),
): string {
  const own = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  return [...new Set([...own, dirname(realpathSync.native(executable)), ...fallback])].join(":");
}

function commandIsolationEnvironment(dirs: CommandDirectories): CommandIsolationEnvironment {
  return {
    ...hostToolchainEnv(),
    PATH: commandSearchPath(dirs.toolTree ?? null),
    HOME: dirs.home,
    TMPDIR: dirs.temp,
    LANG: "en_US.UTF-8",
    PIP_BREAK_SYSTEM_PACKAGES: "1",
    UV_VENV_RELOCATABLE: "1",
  };
}

function commandReadAllows(
  base: SolveIsolationPolicy,
  readDenies: readonly string[],
  dirs: Pick<CommandDirectories, "root" | "toolTree">,
  extraDenies: readonly string[] = [],
) {
  const coveredDenies = [...readDenies, ...extraDenies];
  const covered = canonicalRoots([
    ...base.allowedReadRoots,
    ...nodeRuntimeReadRoots(),
    ...darwinToolchainInstallRoots(),
  ]).filter((path) => coveredDenies.some((root) => covers(root, path)));
  const toolTree = dirs.toolTree ?? null;
  const tree = toolTree === null || !existsSync(toolTree) ? null : resolve(toolTree);
  const seated = tree !== null && canonicalForms(dirs.root).some((root) => containsPath(tree, root));
  const escapes = seated && !containsPath(realpathSync(tree), realpathSync(dirs.root));
  const own = tree === null || escapes ? [] : canonicalForms(tree);
  const inside = (dir: string) => readDenies.some((root) => dir !== root && covers(root, dir));
  const manifests = own.flatMap((path) => ancestorDirectories(path).filter(inside));
  return {
    roots: [...new Set([...covered, ...own])].toSorted(),
    manifests: [...new Set(manifests)].toSorted().map((dir) => join(dir, "package.json")),
  };
}

function darwinCommandProfile(
  base: SolveIsolationPolicy,
  scratchRoots: string[],
  keptRoots: string[],
  dirs: Pick<CommandDirectories, "root" | "toolTree">,
) {
  const closed = hostRoots();
  const userTemp = userTempRules();
  const sharedTmp = canonicalRoots(["/tmp", "/var/tmp", ...userTemp.roots]);
  const readDenies = [...new Set([...base.deniedReadRoots, ...closed])].toSorted();
  const { roots: readAllows, manifests } = commandReadAllows(base, readDenies, dirs, sharedTmp);
  const profile = [
    ...seatbeltBaseRules(base),
    "(deny process-info* (target others))",
    '(deny process-exec* (literal "/bin/launchctl"))',
    "(allow file-read*)",
    ...(base.network
      ? [
          "(allow network*)",
          '(deny network-outbound (remote unix-socket (path-regex #"^/")))',
          '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
        ]
      : []),
    ...scratchRoots.flatMap((root) => [
      `(allow network-bind (local unix-socket (subpath ${capturedJsonStringify(root)})))`,
      `(allow network-outbound (remote unix-socket (subpath ${capturedJsonStringify(root)})))`,
    ]),
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", sharedTmp),
    ...userTemp.rules,
    `(allow file-read* file-read-metadata file-write* (require-all (regex #"^/private/tmp/diff[.]${"[A-Za-z0-9]".repeat(8)}$") (vnode-type REGULAR-FILE)))`,
    ...sbRule("allow file-read-metadata", "literal", ["/tmp", "/private/tmp"]),
    ...sbRule("deny file-read*", "subpath", readDenies),
    ...traversalMetadataRules(readAllows),
    ...sbRule("allow file-read* file-read-metadata", "subpath", readAllows),
    ...sbRule("allow file-read* file-read-metadata", "literal", manifests),
    ...sbRule("deny file-read* file-read-metadata file-write*", "subpath", closed),
    ...sbRule("allow file-read* file-read-metadata", "subpath", scratchRoots),
    ...sbRule("allow file-write*", "subpath", scratchRoots),
    ...sbRule("deny file-write*", "subpath", keptRoots),
    ...traversalMetadataRules(scratchRoots),
    ...sbRule("allow file-write*", "literal", [
      "/dev/stdout",
      "/dev/stderr",
      "/dev/null",
      "/dev/tty",
      "/dev/dtracehelper",
      "/dev/autofs_nowait",
    ]),
    String.raw`(allow file-write* (regex #"^/dev/fd/[0-9]+$"))`,
    ...moveBlockingRules(base.deniedReadRoots),
    "",
  ].join("\n");
  return { profile, readAllows };
}

export function commandIsolationPolicy(
  base: SolveIsolationPolicy,
  dirs: CommandDirectories,
): CommandIsolationPolicy {
  const shared = {
    mechanismPath: base.mechanismPath,
    network: base.network,
    scratchRoots: canonicalRoots([dirs.root]),
    keptRoots: canonicalRoots([dirs.kept]),
    environment: commandIsolationEnvironment(dirs),
  };
  if (base.mechanismId !== LINUX_BWRAP_ID) {
    const { profile, readAllows } = darwinCommandProfile(base, shared.scratchRoots, shared.keptRoots, dirs);
    return { ...shared, profile, readAllowRoots: readAllows, readDenies: [] };
  }
  const readDenies = [...new Set([...base.deniedReadRoots, tmpdir(), "/tmp", "/var/tmp"])].toSorted();
  return {
    ...shared,
    profile: null,
    readAllowRoots: commandReadAllows(base, readDenies, dirs).roots,
    readDenies,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

export function stageCommandIsolation(
  policy: CommandIsolationPolicy,
  profileFile: string,
  command: string,
): string {
  return `exec ${isolatedArgv(policy, profileFile, ["/bin/bash", "-c", command]).map(shellQuote).join(" ")}`;
}

export function isolatedArgv(
  policy: CommandIsolationPolicy,
  profileFile: string,
  argv: readonly string[],
): string[] {
  if (policy.profile === null) {
    const remounts = [
      "/",
      ...policy.readDenies.filter((deny) => !policy.scratchRoots.some((root) => covers(deny, root))),
    ];
    return [policy.mechanismPath, ...bwrapCommandArgs({ ...policy, remounts }), ...argv];
  }
  rmSync(profileFile, { force: true });
  writeFileSync(profileFile, `${policy.profile}\n`, { mode: 0o400 });
  return [policy.mechanismPath, "-f", profileFile, ...argv];
}

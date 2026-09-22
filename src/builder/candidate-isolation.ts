/**
 * The Builder's candidate workspace access policy, separate from the Built Harness's solve
 * isolation. This module derives the policy and checks requested paths; the profile module
 * renders it for Seatbelt and the runtime module executes operations under it. The in-process
 * guard gives typed refusals, and the OS (Seatbelt or Bubblewrap) enforces the same policy in a
 * child process. Without an isolation mechanism, execution is refused; there is no override.
 */
import { selectedProductDir } from "../run/product-versions.ts";
import { existsSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { dirname, isAbsolute, join, relative, resolve, sep } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { keysIf } from "../meta/optional-key.ts";
import { BUILDER_SESSION_EVIDENCE_FILE } from "./session-evidence.ts";
import { BUILDER_SCRATCH_ROOTS, WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";
import { WORKSPACE_DIR } from "../author/builder-memory.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
  bundleSnapshotToolTree,
} from "../claim/bundle-snapshot.ts";
import { parseGeneratedSource, specifiersIn } from "../claim/bundle-validation.ts";
import * as ts from "typescript5";
// Platform-independent despite its module; the Built command isolation reads the same derivation.
import { nodeRuntimeReadRoots } from "../verify/linux-bwrap.ts";
/**
 * Repository-relative credential paths the guard refuses. `.git/config` is absent because the
 * guard denies `.git` as a whole.
 */
export const BUILDER_SECRET_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)auth\.json$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/,
  /(^|\/)\.codex(\/|$)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
];

/**
 * Names the OS walls deny for reading and writing, matched by exact name: files another program
 * later reads as configuration or credentials (an `.npmrc` redirects the next install).
 *
 * Narrower than the guard's patterns because the OS profiles match every path, and a suffix such
 * as `.pem` would also block public material such as the host trust store. Agent directories
 * (`.codex`, `.claude`) are not denied; their `auth.json` is denied by name. A `.codex/hooks`
 * directory written into a candidate tree would still run if a later host process honoured it.
 */
export const BUILDER_CONFIG_DENY_GLOB_STEMS: readonly string[] = [
  ".env",
  ".env.*",
  CODEX_AUTH_FILE,
  ".npmrc",
  ".netrc",
];

/**
 * Private-key names, denied for reading only: a cell may write key-shaped bytes of its own, but
 * must not read someone else's, since the home roots are not denied wholesale. The cell's own
 * tree is granted back after them. `.pem` and `.key` are absent because public trust material
 * uses them.
 */
export const BUILDER_PRIVATE_KEY_DENY_GLOB_STEMS: readonly string[] = [
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "*.p12",
  "*.pfx",
];

export const CANDIDATE_ISOLATION_GUARD_ID = "candidate-isolation/guardPath@v1";
export const CANDIDATE_ISOLATION_SCHEMA = "candidate-isolation/v1" as const;

/** Host scratch roots an authoring session may write (the OS temp trees); every backend's grant
 *  uses this one list. */
export { BUILDER_SCRATCH_ROOTS as HOST_SCRATCH_ROOTS } from "../verify/wall-policy.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";
import { CODEX_AUTH_FILE } from "../backends/login-state.ts";
import { CENSUS_FILE } from "../run/census-gate.ts";
import { BACKENDS_FILE } from "../run/model-preflight.ts";
import { ITERATION_FILE } from "./campaign-iterations.ts";

export type IsolationMode = "read" | "write" | "exec";
type IsolationPurpose = "author" | "workshop";

export interface CandidateIsolationBinding {
  repoRoot: string;
  slug: string;
  /** campaigns/<slug>/<epoch> */
  epochDir: string;
  /** campaigns/<slug>/<epoch>/<NN>-<slug> */
  iterationDir: string;
  /** <epochDir>/.oss */
  ossRoot: string;
  /** A microvm guest's virtiofs share. When set, `ossRoot` may sit under it instead of `epochDir`,
   *  since the guest sees only that share. Unset, the policy digest omits it. */
  sharedCellRoot?: string;
}

export interface IsolationRule {
  kind: "subpath" | "literal";
  path: string;
  id: string;
}

/**
 * What a session may read, write, execute and reach, as the OS enforces it. Every Builder file and
 * command tool applies it, including measured-evidence denies for files created after start.
 * `schema` is part of recorded digests, so its spelling is fixed.
 */
export interface CandidateAccessPolicy {
  readonly schema: typeof CANDIDATE_ISOLATION_SCHEMA;
  readonly repoRoot: string;
  readonly epochDir: string;
  readonly allow: {
    read: readonly IsolationRule[];
    write: readonly IsolationRule[];
    exec: readonly IsolationRule[];
  };
  readonly measuredNamePrefixes: readonly string[];
  /** Authoring may install over the network; the workshop cell stays offline so a verifier's
   *  build replays from the bytes it was handed. */
  readonly network: "deny" | "allow";
  /** Authoring keeps the established candidate profile; untrusted setup gets deny-default. */
  readonly profile: "candidate" | "isolated-workshop";
  /** Host scratch is an authoring convenience, never ambient workshop authority. */
  readonly scratchWriteRoots: readonly string[];
  /** These roots stay denied after broader read grants have been emitted. */
  readonly readDenyRoots: readonly string[];
  /** These roots stay denied after broader write grants have been emitted. */
  readonly writeDenyRoots: readonly string[];
  /**
   * The cell's private HOME, cache and TMPDIR, exempt from the config-name denies: nothing
   * outside the cell reads them, and ordinary setup (`npm config set`) writes config there.
   */
  readonly cellRuntimeRoots: readonly string[];
  readonly digest: string;
}

/** Measured-evidence names denied under the epoch dir, matched against every path segment. The
 *  Builder reads what it authored; measurements reach it only through projected feedback. */
const MEASURED_EVIDENCE_NAME_PREFIXES: readonly string[] = [
  CENSUS_FILE,
  CONFORMANCE_FILE,
  ITERATION_FILE,
  "solvability",
  "discrimination",
  "evidence",
  "case-",
  "builder-path-record",
  "verifier-workshop",
  "verifier-proposal",
  "verifier-admission",
  "verifier-non-result",
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
];

/** Workspace directories where an `@ana` shim would shadow the vendor modules for generated
 *  imports; the Builder may not write under them. */
const WORKSPACE_SHADOW_ROOTS: readonly string[] = [
  "node_modules",
  "agent/node_modules",
  "correctness-model/node_modules",
];

/**
 * The vendor entry modules the Builder imports, each with the roots its imports may reach.
 * Prefixes are per barrel, so a barrel re-exporting protected source (such as `src/verify/`) is
 * refused.
 */
const AUTHORING_BARRELS: ReadonlyArray<{
  name: string;
  prefixes: readonly string[];
  /** Also admit the barrel's type edges. Only agent-bundle sets it: the correctness barrels' type
   *  edges reach controller internals. */
  readTypeEdges?: true;
  /** Exact public declarations an author must read; their own type imports stay closed. */
  typeDeclarations?: readonly string[];
}> = [
  { name: "agent-bundle", prefixes: ["src/solve/", "src/meta/", "vendor/"], readTypeEdges: true },
  {
    name: "correctness-model-bundle",
    prefixes: ["src/meta/", "vendor/"],
    typeDeclarations: ["../../src/truth/correctness-model-contract.ts"],
  },
  {
    name: "correctness-model-prims",
    prefixes: ["vendor/"],
    typeDeclarations: ["../../src/verify/verifier-port.ts"],
  },
];

/** The `src/` directories of the agent-bundle barrel, granted whole as the Builder's authoring
 *  interface. Derived from the barrel so the two cannot drift; `vendor/` has its own grant. */
const AGENT_AUTHORING_INTERFACE = AUTHORING_BARRELS.filter(({ name }) => name === "agent-bundle")
  .flatMap(({ prefixes }) => prefixes)
  .values()
  .filter((prefix) => prefix.startsWith("src/"))
  .map((prefix) => (prefix.endsWith("/") ? prefix.slice(0, -1) : prefix))
  .toArray();

/** The read policy as path lists for the native Claude sandbox. Every rule projects as an allow:
 *  the SDK matches each path by its deepest root, so ungranted siblings stay closed. */
export interface ProjectedReadGrant {
  allow: string[];
}

type GuardDecision =
  | { decision: "allow"; resolved: string; reason: string }
  | { decision: "deny"; resolved: string | null; reason: string; message: string };

/**
 * The repository modules a generated bundle may read, derived from the vendor barrels' imports.
 * It holds every first-level edge of `@ana/agent-bundle` (type edges included) and every
 * transitive runtime import of all three barrels, plus their named public type declarations.
 * An import outside a barrel's declared prefixes throws.
 */
export function deriveBundleContract(repoRoot: string): string[] {
  const contract = new Set<string>();
  const admit = (from: string, specifier: string, prefixes: readonly string[]): string => {
    const resolved = resolve(dirname(from), specifier);
    const rel = relative(repoRoot, resolved).split(sep).join("/");
    if (!prefixes.some((prefix) => rel.startsWith(prefix))) {
      throw new Error(`${relative(repoRoot, from)} re-exports a protected module: ${rel}`);
    }
    return resolved;
  };

  for (const { name, prefixes, readTypeEdges, typeDeclarations } of AUTHORING_BARRELS) {
    const barrel = join(repoRoot, "vendor", name, "index.ts");
    const queue = [barrel];
    const visited = new Set<string>();
    /** Admits one edge and queues it when it runs at load. Type-only edges below the barrel erase
     *  at load, so they are neither admitted nor followed. */
    const follow = (file: string, specifier: string, typeOnly: boolean): void => {
      const readable = readTypeEdges === true && file === barrel;
      if (typeOnly && !readable) {
        if (file === barrel && typeDeclarations?.includes(specifier) === true) {
          contract.add(resolve(dirname(file), specifier));
        }
        return;
      }
      const resolved = admit(file, specifier, prefixes);
      if (readable) contract.add(resolved);
      if (!typeOnly) queue.push(resolved);
    };
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      contract.add(file);
      // Parse statements, not lines: a formatted specifier list can span several lines.
      for (const load of specifiersIn(parseGeneratedSource(readFileSync(file, "utf8"), file)).loads) {
        if (!load.text.startsWith(".")) continue;
        const statement = load.parent;
        // Only a whole-statement `import type`/`export type` erases at load.
        const typeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
          : ts.isExportDeclaration(statement) && statement.isTypeOnly;
        follow(file, load.text, typeOnly);
      }
    }
  }
  return [...contract].sort();
}

/** Checks the binding's nesting both lexically and physically, and returns the physical roots.
 *  A declared shared cell root may hold `ossRoot` instead of the epoch. */
function nestedBindingRoots(binding: CandidateIsolationBinding) {
  const lexicalRepo = resolve(binding.repoRoot);
  const repoRoot = realpathSync.native(binding.repoRoot);
  const lexicalEpoch = resolve(lexicalRepo, binding.epochDir);
  const lexicalIteration = resolve(lexicalRepo, binding.iterationDir);
  const lexicalOss = resolve(lexicalRepo, binding.ossRoot);
  const lexicalShared = binding.sharedCellRoot === undefined ? null : resolve(binding.sharedCellRoot);
  const ossNested = (oss: string, epoch: string, shared: string | null) =>
    containsPath(oss, epoch) || (shared !== null && containsPath(oss, shared));
  if (
    !containsPath(lexicalEpoch, lexicalRepo) ||
    !containsPath(lexicalIteration, lexicalEpoch) ||
    !ossNested(lexicalOss, lexicalEpoch, lexicalShared)
  ) {
    throw new Error(
      "candidate workspace access rules binding is not nested repoRoot ⊇ epochDir ⊇ iterationDir/ossRoot",
    );
  }
  // Campaigns may be a symlink, so bind to the physical roots guardPath compares against.
  const epochDir = resolveRequested(repoRoot, binding.epochDir);
  const iterationDir = resolveRequested(repoRoot, binding.iterationDir);
  const ossRoot = resolveRequested(repoRoot, binding.ossRoot);
  const sharedCellRoot = lexicalShared === null ? null : realpathSync.native(lexicalShared);
  if (!containsPath(iterationDir, epochDir) || !ossNested(ossRoot, epochDir, sharedCellRoot)) {
    throw new Error("candidate workspace physical roots are not nested epochDir ⊇ iterationDir/ossRoot");
  }
  return { repoRoot, epochDir, iterationDir, ossRoot, sharedCellRoot };
}

/** Read grants for the adopted tool trees: the adopted domain's, and the workspace's own
 *  `.toolchain` when it links outside this epoch. Each must be `epoch-<key>/workspace/.toolchain`
 *  of this campaign, so a re-pointed link reaches no further than a sibling epoch's tools. */
function adoptedToolReadRules(
  repoRoot: string,
  slug: string,
  epochDir: string,
  iterationDir: string,
): IsolationRule[] {
  const inCampaign = (path: string) => {
    const parts = relative(dirname(epochDir), path).split(sep);
    return (
      parts.length === 3 &&
      parts[0]?.startsWith("epoch-") === true &&
      parts[1] === WORKSPACE_DIR &&
      parts[2] === WORKSPACE_TOOL_TREE
    );
  };
  const adopted = bundleSnapshotToolTree(selectedProductDir(repoRoot, slug));
  const own = bundleSnapshotToolTree(iterationDir);
  // The workspace's own tree is already inside the candidate-tree grant unless it is a link out.
  const trees = [adopted, own === null || containsPath(own, epochDir) ? null : own].filter(
    (path): path is string => path !== null && inCampaign(path),
  );
  return [...new Set(trees)].map((path) => ({ kind: "subpath", path, id: "adopted-toolchain" }));
}

export function deriveCandidateIsolation(
  binding: CandidateIsolationBinding,
  purpose: IsolationPurpose,
): CandidateAccessPolicy {
  const { repoRoot, epochDir, iterationDir, ossRoot, sharedCellRoot } = nestedBindingRoots(binding);
  const sub = (path: string, id: string): IsolationRule => ({ kind: "subpath", path, id });
  const lit = (path: string, id: string): IsolationRule => ({ kind: "literal", path, id });
  const author = purpose === "author";
  const bundleContract = author ? deriveBundleContract(repoRoot) : [];
  const read: IsolationRule[] = author
    ? [
        sub(iterationDir, "candidate-tree"),
        lit(join(epochDir, BACKENDS_FILE), "session-contract"),
        lit(join(epochDir, BUILDER_SESSION_EVIDENCE_FILE), "session-contract"),
        ...adoptedToolReadRules(repoRoot, binding.slug, epochDir, iterationDir),
        ...AUTHORING_BARRELS.map(({ name }) => sub(join(repoRoot, "vendor", name), "vendor-bundle")),
        ...bundleContract.map((path) => lit(path, "bundle-contract")),
        ...AGENT_AUTHORING_INTERFACE.map((path) => sub(join(repoRoot, path), "agent-authoring-interface")),
        sub(join(repoRoot, "starters"), "starters"),
        sub(join(repoRoot, "node_modules"), "toolchain"),
        // The node runtime's own prefix, which may sit under the otherwise denied home directory.
        ...nodeRuntimeReadRoots().map((root) => sub(root, "node-runtime")),
        lit(join(repoRoot, "package.json"), "toolchain"),
        lit(join(repoRoot, "bun.lock"), "toolchain"),
        lit(join(repoRoot, ".bun-version"), "toolchain"),
        lit(join(repoRoot, "biome.json"), "toolchain"),
        lit(join(repoRoot, "README.md"), "docs"),
        lit(join(repoRoot, "AGENTS.md"), "docs"),
        lit(join(repoRoot, "CLAUDE.md"), "docs"),
      ]
    : [sub(ossRoot, "verifier-workshop")];
  const write: IsolationRule[] = author
    ? [sub(iterationDir, "iteration-write")]
    : [sub(ossRoot, "verifier-workshop")];
  const hostScratchRoots = BUILDER_SCRATCH_ROOTS;
  const identity = {
    schema: CANDIDATE_ISOLATION_SCHEMA,
    repoRoot,
    epochDir,
    // Present only when set, so bindings without a shared cell keep their digest.
    ...keysIf(sharedCellRoot !== null, () => ({
      sharedCellRoot: /* SAFETY: keysIf evaluates only when the null check held. */ sharedCellRoot as string,
    })),
    allow: { read, write, exec: write },
    measuredNamePrefixes: MEASURED_EVIDENCE_NAME_PREFIXES,
    network: author ? ("allow" as const) : ("deny" as const),
    profile: author ? ("candidate" as const) : ("isolated-workshop" as const),
    // Both cells write host scratch: authoring downloads a toolchain there and the offline
    // workshop unpacks it, which is the Builder's only install route.
    scratchWriteRoots: author ? hostScratchRoots : [join(ossRoot, ".tmp"), ...hostScratchRoots],
    readDenyRoots: author ? [ossRoot] : [],
    writeDenyRoots: author ? WORKSPACE_SHADOW_ROOTS.map((root) => join(iterationDir, root)) : [],
    // Must match the HOME, cache and TMPDIR names `workshopEnvironment` creates; drift fails closed.
    cellRuntimeRoots: author ? [] : [".home", ".cache", ".tmp"].map((name) => join(ossRoot, name)),
  };
  return { ...identity, digest: hashJsonBytes(identity) };
}

export function policyReadGrant(policy: CandidateAccessPolicy): ProjectedReadGrant {
  return { allow: policy.allow.read.map((rule) => rule.path) };
}

/** The physical path: the deepest existing ancestor resolved, then the rest appended, so a planted
 *  symlink is judged at its target. */
function resolveRequested(repoRoot: string, requested: string): string {
  if (requested.includes("\0")) throw new Error("path contains a NUL byte");
  const lexical = isAbsolute(requested) ? resolve(requested) : resolve(repoRoot, requested);
  let probe = lexical;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  return resolve(realpathSync.native(probe), relative(probe, lexical));
}

/** The in-process path check every capability runs before the OS enforces the same policy. */
export function guardPath(
  policy: CandidateAccessPolicy,
  capability: string,
  mode: IsolationMode,
  requested: string,
): GuardDecision {
  let resolved: string;
  try {
    resolved = resolveRequested(policy.repoRoot, requested);
  } catch (error) {
    const detail = errorMessage(error);
    return {
      decision: "deny",
      resolved: null,
      reason: "deny/unresolvable",
      message: `${capability} refused: ${detail}`,
    };
  }
  const deny = (reason: string, message: string): GuardDecision => ({
    decision: "deny",
    resolved,
    reason,
    message,
  });
  if (mode !== "write" && policy.readDenyRoots.some((root) => containsPath(resolved, root))) {
    return deny(
      "deny/purpose-isolation",
      `${capability} refused: ${requested} belongs to another capability's isolated cell`,
    );
  }
  if (mode === "write" && policy.writeDenyRoots.some((root) => containsPath(resolved, root))) {
    return deny(
      "deny/module-shadow",
      `${capability} refused: ${requested} would shadow the vendor @ana modules inside the workspace`,
    );
  }
  const rel = relative(policy.repoRoot, resolved);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    const posix = rel.split(sep).join("/");
    if (BUILDER_SECRET_PATH_PATTERNS.some((pattern) => pattern.test(posix))) {
      return deny("deny/secret", `${capability} refused: ${posix} is secret or credential material`);
    }
    if (posix === ".git" || posix.startsWith(".git/")) {
      return deny("deny/git-history", `${capability} refused: repository history is not a build input`);
    }
  }
  if (containsPath(resolved, policy.epochDir)) {
    const measuredSegment = relative(policy.epochDir, resolved)
      .split(sep)
      .find((segment) => policy.measuredNamePrefixes.some((p) => segment.startsWith(p)));
    if (measuredSegment !== undefined) {
      return deny(
        "deny/measured",
        `${capability} refused: ${measuredSegment} is a measured evidence; measurement reaches the Builder only through projected feedback, never by file read`,
      );
    }
  }
  for (const rule of policy.allow[mode]) {
    if (rule.kind === "literal" ? resolved === rule.path : containsPath(resolved, rule.path)) {
      return { decision: "allow", resolved, reason: `allow/${rule.id}` };
    }
  }
  const roots = [...new Set(policy.allow[mode].map((rule) => rule.id))].join(", ");
  return deny(
    "deny/outside-allow",
    `${capability} (${mode}) refused: ${requested} is outside the candidate workspace access rules; allowed interfaces: ${roots}`,
  );
}

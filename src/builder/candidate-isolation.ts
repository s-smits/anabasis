/**
 * Candidate workspace access rules for the Builder, separate from the Built Harness's solve
 * isolation. This module derives the path policy for a campaign and checks requested paths.
 * candidate-isolation-profile.ts expresses the policy for Seatbelt; candidate-isolation-runtime.ts
 * executes operations and records each call. Both the in-process guard and the operating-system
 * sandbox use the same policy. The guard produces typed refusals; the OS enforces access
 * independently in a child process for each filesystem operation, using Seatbelt on Darwin
 * or Bubblewrap on Linux. Denial rules cover protected paths, while grants name the
 * candidate's allowed paths. A sibling created during the session remains denied without
 * rebuilding a snapshot of existing files. If the isolation mechanism is unavailable,
 * execution is refused. This API has no environment-variable override or exception for a
 * process already inside another sandbox. Nested execution must still establish its own
 * required isolation.
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
// Named for the mechanism that needed it first; the derivation is platform-independent and the
// Built command isolation already reads it, so the Builder reads the same one rather than a copy.
import { nodeRuntimeReadRoots } from "../verify/linux-bwrap.ts";
/**
 * Secret/credential rel-path patterns — file contents that must never enter a build agent's
 * context. Re-homed from the deleted v3-era builder-sandbox.ts: this file is now the one
 * owner of the secret set; the guard consumes the regex form and the SBPL emitter (plus the
 * verifier's process sandbox) derive their dialects from the glob stems below. `.git/config`
 * is deliberately absent — git metadata is handled by the isolation's own `.git` top-level deny.
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
 * The names the OS walls deny by suffix or filename, in both directions.
 *
 * This is deliberately narrower than the pattern set above, because the two lists answer different
 * questions. The guard applies its patterns to repository-relative paths, where a match really is
 * the user's credential. The OS profiles apply theirs to every path, and there location has already
 * decided: both home roots and the repository are denied wholesale by subpath, above and
 * independent of any suffix. What a credential-shaped suffix still catches is therefore only public
 * material and the cell's own bytes, and it cost both of those. On 2026-08-18 a session installing
 * Homebrew could not extract `homebrew-1.pem` — Homebrew's own public verification key — which
 * closed the signed-API install path and silently stripped three public CA bundles out of a Ruby
 * bottle; on the authoring profile, the one with network, `*.pem` was the last matching rule for
 * `/private/etc/ssl/cert.pem`, so the session that installs over TLS could not read the host trust
 * store at all. Any source tree carrying test certificates fails the same way.
 *
 * What remains are names another program later reads as configuration or credentials, matched by
 * exact name rather than by shape: an `.npmrc` dropped beside a build redirects the next install to
 * a registry the agent chose.
 *
 * Agent directories are deliberately absent. `.codex/**` was denied here for its hook scripts, and
 * the same argument would add `.claude/**`, but both hold material an agent has a legitimate reason
 * to read, and the credential inside them — `auth.json` — is denied by name in its own right while
 * the real ones under the home roots are denied by location (operator decision 2026-08-18). The
 * residual risk is narrow and worth naming: a `.codex/hooks` directory written into a candidate
 * tree would run outside this wall if a later host process honoured it.
 */
export const BUILDER_CONFIG_DENY_GLOB_STEMS: readonly string[] = [
  ".env",
  ".env.*",
  CODEX_AUTH_FILE,
  ".npmrc",
  ".netrc",
];

/**
 * Private-key names, denied on the read side only.
 *
 * These carry the part of the argument above that location used to carry. That paragraph rests on
 * "both home roots and the repository are denied wholesale by subpath", and on 2026-08-19 the home
 * roots stopped being denied wholesale, so a cell could read `id_rsa` or `x.p12` out of any
 * directory in the operator's home. The secret census caught it the same day.
 *
 * They are separate from the config stems because the two lists answer different questions. A
 * config name is denied in both directions, since the danger is a cell *writing* an `.npmrc` that
 * redirects the next install. A private key is the opposite: a cell writes key-shaped bytes of its
 * own legitimately, and what must not happen is reading someone else's. So these are read-only
 * denies, and the cell's own tree is granted back after them like every other name.
 *
 * `.pem` and `.key` stay absent for the reason the paragraph gives — the host trust store,
 * Homebrew's own verification key and any source tree's test certificates are all `.pem`, and
 * denying the suffix closed the signed install path. These have no such public use.
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

/** Host scratch roots an authoring session may write: the OS temp trees on darwin and Linux.
 *  One owner for every backend grant — the native Claude sandbox takes the same list, so a
 *  toolchain that writes its own bookkeeping under the OS temp dir (the Claude SDK's Bash
 *  cwd markers, `$TMPDIR` scripts) is not refused by a wall the workshop policy already opens. */
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
  /** The one authorized exception to the epoch-nested cell: a microvm guest's virtiofs share.
   *  When set, `ossRoot` may sit under this root instead of `epochDir`, because the guest can see
   *  only that share and the cell holds nothing but public sources and workshop scratch. Unset,
   *  the nesting rule and every existing policy digest stay exactly as before. */
  sharedCellRoot?: string;
}

export interface IsolationRule {
  kind: "subpath" | "literal";
  path: string;
  id: string;
}

/**
 * What a session may read, write, execute and reach — the access policy the operating system
 * enforces, through Darwin Seatbelt or Linux Bubblewrap.
 *
 * The backend roster decides which tools the model is offered. Every Builder file and command
 * tool then enforces this policy, including the measured-evidence denies that must still apply
 * when a file appears after session startup. Backend native filesystem tools do not receive
 * the workspace grant.
 *
 * The `schema` value keeps its recorded `candidate-isolation/v1` spelling; it is an identity inside
 * recorded digests, not a name to tidy.
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
  /** The authoring session may install toolchains over the network (operator decision
   *  2026-08-16); the deny-default workshop cell stays offline so a proposed verifier's build
   *  replays from the bytes it was handed. */
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
   * The cell's own private runtime directories, exempt from the config-name denies.
   *
   * `workshopEnvironment` points `HOME`, `TMPDIR` and every cache it declares at directories inside
   * the cell, so a toolchain that writes its own configuration writes it here. The config-name
   * denies exist to stop a name a later host process obeys from landing in the candidate tree, and
   * these three directories are not that tree — nothing outside the cell reads them. Denying the
   * names here therefore only broke ordinary setup: `npm config set` writes `$HOME/.npmrc`, and it
   * was refused. The exemption is stated as exact paths rather than by widening the deny, so the
   * candidate tree keeps the rule.
   */
  readonly cellRuntimeRoots: readonly string[];
  readonly digest: string;
}

/** Measured-evidence names denied anywhere under the epoch dir, matched against every path
 *  segment — a new file inside an evidence directory is as protected as the directory name
 *  itself. The distinction is authorship: the Builder may read what it authored (its candidate
 *  bundles across iterations, its own scratch, its own run condition), never what was measured
 *  about what it authored — measurement reaches an author only through the projected feedback
 *  channel (projectFindingForAuthor), never by file read. */
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

/** Run 52: a workspace @ana shim under any of these roots shadows the vendor modules for every
 *  generated import. Generated code lives in agent/ and correctness-model/, so these are the only workspace
 *  directories Node resolution can step through before it leaves the tree. The census gate records
 *  an existing shadow as an environment non-result; the isolations stop the Builder creating one. */
const WORKSPACE_SHADOW_ROOTS: readonly string[] = [
  "node_modules",
  "agent/node_modules",
  "correctness-model/node_modules",
];

/**
 * The vendor entry modules the Builder imports, each with the roots its contract may reach.
 * The prefixes stay per-barrel rather than pooled: agent-bundle reaches `src/solve` and
 * `src/meta`, which are the Builder's own authoring interface. The correctness runtime lives
 * under `vendor/`; its projection also reuses the already-public `src/meta` shape primitives.
 * A correctness barrel that re-exported `src/verify/host.ts` would be refused here, so protected
 * engine source cannot enter through the barrel that sits nearest to it.
 *
 * The runtime half moved into `vendor/` on 2026-09-02. Until then `src/truth/truth-checks.ts` was
 * granted as one file inside a denied directory, and Bun lists a directory before opening a file
 * in it, so the Builder's own `bun test` could not load the barrel under the native wall
 * (run50-opus: "Cannot find module", then a hand-written stand-in the census refused).
 */
const AUTHORING_BARRELS: ReadonlyArray<{
  name: string;
  prefixes: readonly string[];
  /** Admit the barrel's type edges too, not only its runtime closure. Agent-bundle alone carries
   *  this: the Builder codes `agent/tools.ts` against those declarations, and it is the grant this
   *  derivation already made. Extending it to the correctnessModel barrels would admit their type edges into
   *  controller internals — `src/truth/contracts.ts` is one — that no workspace execution opens. */
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

/** The agent-bundle half of the contract, granted whole. The Builder codes `agent/tools.ts`
 *  against these declarations and AUTHORING_BARRELS admits both directories to that barrel, so
 *  they are its own authoring interface rather than protected material: reading and listing them
 *  is the point. The protected `src/truth/` and `src/verify/` trees keep exact-file exceptions for
 *  their public declarations. Derived from the agent-bundle barrel rather than
 *  repeated, so the two cannot drift; `vendor/` is dropped because each barrel already carries its
 *  own narrower `vendor-bundle` grant and the vendor root is not the Builder's interface. */
const AGENT_AUTHORING_INTERFACE = AUTHORING_BARRELS.filter(({ name }) => name === "agent-bundle")
  .flatMap(({ prefixes }) => prefixes)
  .values()
  .filter((prefix) => prefix.startsWith("src/"))
  .map((prefix) => (prefix.endsWith("/") ? prefix.slice(0, -1) : prefix))
  .toArray();

/** The read closure expressed for the native Claude sandbox, whose grant vocabulary is path
 *  lists rather than rules. Every rule projects as an allow: the SDK resolves each path by its
 *  deepest matching root (measured live 2026-08-27), so a granted file or directory inside the
 *  denied checkout opens and its ungranted siblings stay closed. No rule needs a deny of its own
 *  since the contract's runtime closure moved beside its barrels (2026-09-02): the earlier
 *  directory-deny projection had left Bun unable to list `src/truth` and load the granted file
 *  inside it, and its predecessor, one deny per ungranted entry, had failed every Bash spawn with
 *  E2BIG. */
export interface ProjectedReadGrant {
  allow: string[];
}

type GuardDecision =
  | { decision: "allow"; resolved: string; reason: string }
  | { decision: "deny"; resolved: string | null; reason: string; message: string };

/**
 * The contract modules a generated bundle imports, derived from the vendor barrels' import
 * specifiers instead of a second hand-maintained list: candidate validation owns what a bundle may
 * import, and each barrel owns what its `@ana/*` name resolves to. Two layers, both fail-closed
 * on an import leaving that entry module's declared prefixes:
 *
 * - every first-level edge of `@ana/agent-bundle`, type edges included, so the Builder can read
 *   the solve-side contracts it codes against (the original shape of this function);
 * - every transitive runtime import of all three authoring barrels, so workspace code — the
 *   starter's correctness-model/*.test.ts seeds under `bun test` — can execute against them under the
 *   bash sandbox. Only the named public type declarations are also readable; other type edges
 *   erase at load and stay closed, including controller internals such as src/truth/contracts.ts.
 *
 * External package imports are owned by the root lockfile instead of copied into this contract.
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
    /**
     * One declared edge, admitted into the contract and queued when it still runs at load.
     *
     * A type-only edge erases at load. Below the barrel it is neither admitted nor followed:
     * src/solve/built-starter.ts declares against src/truth/task-split.ts, a file no workspace
     * execution opens, so validating it would refuse a contract that is already correct.
     */
    const follow = (file: string, specifier: string, typeOnly: boolean): void => {
      const readable = readTypeEdges === true && file === barrel;
      if (typeOnly && !readable) {
        // Type erasure removes execution, not the Builder's need to read its public API.
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
      // Read the statement rather than the line. `specifiersIn` is the reader
      // src/claim/bundle-validation.ts already owns for "what does this file import", and it
      // resolves the question a line scan cannot: `biome format` breaks a long specifier list
      // over several lines, which leaves `from` on a line carrying no `import type`, so a
      // type-only re-export read as a runtime edge and `admit` refused the contract outright.
      for (const load of specifiersIn(parseGeneratedSource(readFileSync(file, "utf8"), file)).loads) {
        if (!load.text.startsWith(".")) continue;
        const statement = load.parent;
        // A whole-statement `import type`/`export type` erases at load. A single type specifier
        // inside a runtime statement does not, and the loader reads it the same way.
        const typeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
          : ts.isExportDeclaration(statement) && statement.isTypeOnly;
        follow(file, load.text, typeOnly);
      }
    }
  }
  return [...contract].sort();
}

/** Both nesting checks — the lexical spelling and the physical roots guardPath will later see.
 *  The one exception is a declared shared cell root (a microvm guest's share), which may hold
 *  `ossRoot` instead of the epoch. */
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
  // Controller output may be shared into an isolated source worktree through a campaigns
  // symlink. Bind the isolation to the physical controller roots that guardPath will later see;
  // retaining their lexical spelling makes every legitimate access look like an escape.
  const epochDir = resolveRequested(repoRoot, binding.epochDir);
  const iterationDir = resolveRequested(repoRoot, binding.iterationDir);
  const ossRoot = resolveRequested(repoRoot, binding.ossRoot);
  const sharedCellRoot = lexicalShared === null ? null : realpathSync.native(lexicalShared);
  if (!containsPath(iterationDir, epochDir) || !ossNested(ossRoot, epochDir, sharedCellRoot)) {
    throw new Error("candidate workspace physical roots are not nested epochDir ⊇ iterationDir/ossRoot");
  }
  return { repoRoot, epochDir, iterationDir, ossRoot, sharedCellRoot };
}

/** The adopted tool trees this session runs: the controller's adopted domain link, and the
 * workspace's own `.toolchain` link when it points outside this epoch. Both are controller-written
 * (`linkWorkspaceToolTree`); an evaluation correction keeps the tree it was seeded with while a
 * later adoption moves the domain link, and granting the domain alone left the correction's own
 * `.toolchain/bun` behind a sibling deny (truss-sol sessions 03 and 04, 2026-09-05). Each resolved
 * tree must be `epoch-<key>/workspace/.toolchain` of this campaign, so a re-pointed link can widen
 * nothing beyond a sibling epoch's tools: the earlier evaluator, evidence and all writes stay
 * outside the grant. */
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
        // The Builder runs `node` to test what it authored, and this profile denies the home
        // directory where fnm, nvm and volta install it. The grant is the runtime's own prefix —
        // bin, lib and its bundled modules — never the home directory that encloses it.
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
    // Declared only when set, so every binding without a shared cell keeps its exact digest.
    ...keysIf(sharedCellRoot !== null, () => ({
      sharedCellRoot: /* SAFETY: keysIf evaluates only when the null check held. */ sharedCellRoot as string,
    })),
    allow: { read, write, exec: write },
    measuredNamePrefixes: MEASURED_EVIDENCE_NAME_PREFIXES,
    network: author ? ("allow" as const) : ("deny" as const),
    profile: author ? ("candidate" as const) : ("isolated-workshop" as const),
    // Both cells write the host scratch trees. The authoring session downloads a toolchain there
    // and the offline workshop unpacks it, which is the only route a Builder has to install
    // anything: measured 2026-08-18, all three install sessions found this route unaided, and
    // measured 2026-08-19, a Builder asked to install a scientific library used it to put 71MB of
    // unpacked wheels where its verifier could read them. It was opt-in behind `--workshop-tmp`
    // until the flag was removed, which meant the default run could not install at all.
    scratchWriteRoots: author ? hostScratchRoots : [join(ossRoot, ".tmp"), ...hostScratchRoots],
    readDenyRoots: author ? [ossRoot] : [],
    writeDenyRoots: author ? WORKSPACE_SHADOW_ROOTS.map((root) => join(iterationDir, root)) : [],
    // The same three names `workshopEnvironment` creates and exports as HOME, the cache root and
    // TMPDIR. One owner would be better than two; until that lands, a drift here shows up as the
    // cell being unable to write its own config, not as a silent widening.
    cellRuntimeRoots: author ? [] : [".home", ".cache", ".tmp"].map((name) => join(ossRoot, name)),
  };
  return { ...identity, digest: hashJsonBytes(identity) };
}

export function policyReadGrant(policy: CandidateAccessPolicy): ProjectedReadGrant {
  return { allow: policy.allow.read.map((rule) => rule.path) };
}

/** Resolve the physical location (resolve the deepest existing ancestor, then append the remaining path) so a
 *  symlink planted inside the candidate tree is judged at its target, never at its name. */
function resolveRequested(repoRoot: string, requested: string): string {
  if (requested.includes("\0")) throw new Error("path contains a NUL byte");
  const lexical = isAbsolute(requested) ? resolve(requested) : resolve(repoRoot, requested);
  let probe = lexical;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  return resolve(realpathSync.native(probe), relative(probe, lexical));
}

/** Shared path guard. Capabilities check paths here before the OS enforces the operation's policy. */
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

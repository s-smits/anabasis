/**
 * The Builder's candidate workspace access policy, not the Built Harness's solve isolation. This
 * module derives the policy for one campaign and answers "may this capability touch this path";
 * candidate-isolation-profile.ts expresses it as a Seatbelt profile, and
 * candidate-isolation-runtime.ts runs operations under it and records a row per decided path.
 *
 * Two layers apply one derivation rather than two policies. The in-process guard runs first,
 * because it alone can say which rule refused and which interfaces are open, and a session told
 * that corrects itself where a bare EACCES leaves it guessing. Seatbelt on Darwin or Bubblewrap on
 * Linux then enforces the same policy independently, because a guard living in the same process as
 * the code it constrains is a convention and not a wall. Nothing snapshots the tree at startup, so
 * a file appearing mid-session is decided by the same rules as one that was always there. When the
 * mechanism is unavailable the runtime refuses — no override, and no exception for a process
 * already inside someone else's sandbox, because a run recorded as confined but actually
 * unconfined is worse evidence than no run at all.
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
// The module is named for the mechanism that needed it first, but the derivation reads the running
// executable's own installation prefix and is platform-independent. The Built command isolation
// already imports it, so the Builder imports the same function rather than keeping a second copy.
import { nodeRuntimeReadRoots } from "../verify/linux-bwrap.ts";
/**
 * Repository-relative paths whose contents must never enter an authoring session's context. The
 * guard matches these against the path relative to the repository root, where a match really is
 * the operator's credential rather than something merely credential-shaped, which is why this list
 * can afford suffixes such as `.pem` and `.key` that the OS stem lists below cannot.
 *
 * This file is the one owner of the secret set: the guard consumes the regex form directly, the
 * Bubblewrap planner reuses the same patterns to decide which nodes inside a bound repository root
 * must be hidden, and the Seatbelt emitter derives its dialect from the glob stems below.
 * `.git/config` is absent by intent, because guardPath denies `.git` and everything under it by
 * name further down.
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
 * The names the Seatbelt profile denies by exact filename, in both directions.
 *
 * Narrower than the patterns above, because the profile applies to every path on the host rather
 * than to repository-relative ones, and it has already denied both home roots and the whole
 * repository by subpath before it reaches these names. What a credential-shaped suffix would still
 * catch at that point is public material: a `*.pem` deny costs a session Homebrew's public
 * verification key and with it the signed-API install path, the CA bundles inside a Ruby bottle,
 * and — as the last rule matching `/private/etc/ssl/cert.pem` — the host trust store the networked
 * authoring profile needs to install over TLS. Any source tree carrying test certificates fails
 * the same way.
 *
 * What remains is the set of names some later program reads as configuration or credentials,
 * matched by exact name rather than by shape, because the danger is a file landing where another
 * process will obey it: an `.npmrc` dropped beside a build redirects the next install to whatever
 * registry the agent chose. Agent directories are absent on purpose: `.codex/**` and `.claude/**`
 * hold hook scripts, but also material an agent has a legitimate reason to read, while the
 * credential inside them — `auth.json` — is denied by name in its own right and the real ones
 * under the home roots are denied by location (operator decision). The residual risk is a
 * `.codex/hooks` directory written into a candidate tree, which would run outside this wall if a
 * later host process honoured it.
 */
export const BUILDER_CONFIG_DENY_GLOB_STEMS: readonly string[] = [
  ".env",
  ".env.*",
  CODEX_AUTH_FILE,
  ".npmrc",
  ".netrc",
];

/**
 * Private-key names, denied on the read side only — the opposite question to the config stems
 * above. A config name is denied in both directions, since the danger is a cell *writing* an
 * `.npmrc` that redirects the next install. A cell writing key-shaped bytes of its own is ordinary
 * setup; what must not happen is it reading someone else's. The cell's own tree is granted back
 * after these by the later allows.
 *
 * They are needed because the profile opens from `(allow default)` and then carves out the home
 * roots and the repository by subpath, so a key on a mounted volume or a network share stays open
 * unless closed by name. `.pem` and `.key` are absent for the reason the config stems give: the
 * host trust store, Homebrew's verification key and any test certificate are all `.pem`, and
 * denying that suffix closed the signed install path. The names here have no such public use.
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

/** The host scratch roots an authoring session may write: the OS temp trees. Re-exported under the
 *  isolation's own name so a reader of this policy need not know the list is kept beside the
 *  solve-side wall policy; both walls reach it through `scratchWriteRoots` below, so there is one
 *  list and not a Darwin copy and a Linux copy. */
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
  /** The one authorised exception to the rule that the cell nests inside the epoch: a microvm
   *  guest's virtiofs share. When set, `ossRoot` may sit under it instead of under `epochDir`,
   *  because the guest sees only that share and the cell holds nothing but public sources and
   *  workshop scratch. When unset the nesting rule is unchanged and the field is left out of the
   *  digest, so every binding without a shared cell keeps the policy digest it already had. */
  sharedCellRoot?: string;
}

export interface IsolationRule {
  kind: "subpath" | "literal";
  path: string;
  id: string;
}

/**
 * What a session may read, write, execute and reach: the access policy the operating system goes
 * on to enforce, through Darwin Seatbelt or Linux Bubblewrap.
 *
 * The backend roster decides which tools the model is offered, but every Builder file and command
 * tool then enforces this one policy, including the measured-evidence denies, which have to keep
 * applying to a file that only appears after the session started.
 *
 * `schema` keeps its recorded `candidate-isolation/v1` spelling because it is an identity inside
 * recorded digests: rewriting it would change every policy's digest and make old evidence
 * unjoinable to new. */
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
  /** The authoring session may install toolchains over the network (operator decision), since
   *  discovering and installing the domain's real tools is its job. The workshop cell stays
   *  offline, so a proposed verifier's build replays from the bytes it was handed rather than
   *  fetching something the evidence does not name. */
  readonly network: "deny" | "allow";
  /** Authoring keeps the established candidate profile; untrusted setup gets deny-default. */
  readonly profile: "candidate" | "isolated-workshop";
  /** Host scratch is an authoring convenience, never ambient workshop authority. */
  readonly scratchWriteRoots: readonly string[];
  /** These roots stay denied after the broader read grants have been emitted. Seatbelt takes the
   *  last matching rule, so a deny appearing before a grant containing it is overwritten: position
   *  is as much of the policy as presence. */
  readonly readDenyRoots: readonly string[];
  /** These roots stay denied after the broader write grants have been emitted, for the same
   *  last-matching-rule reason as the read denies above. */
  readonly writeDenyRoots: readonly string[];
  /**
   * The cell's own private runtime directories, exempt from the config-name denies.
   * `workshopEnvironment` points HOME, the cache root and TMPDIR inside the cell, so a toolchain
   * that writes configuration writes it here. The config-name denies exist to stop a name a later
   * host process obeys from landing in the candidate tree, and these three directories are not
   * that tree, because nothing outside the cell reads them. Denying the names here bought nothing
   * and broke ordinary setup: `npm config set` writes `$HOME/.npmrc`, and it was refused. The
   * exemption is spelled as exact paths rather than by widening the deny, so the candidate tree
   * keeps the rule it needs.
   */
  readonly cellRuntimeRoots: readonly string[];
  readonly digest: string;
}

/** Measured-evidence names denied anywhere under the epoch directory, matched against every path
 *  segment rather than only the leaf, so a new file inside an evidence directory is as protected as
 *  the directory name. The distinction is authorship: the Builder may read what it authored — its
 *  candidate bundles, its own scratch, its own run condition — but never what was measured about
 *  them, because measurement reaches an author only through the projected feedback channel, where
 *  protected verifier detail has already been stripped. A file read would route around it. */
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

/** The workspace directories where an `@ana` shim would shadow the vendor modules for every
 *  generated import. Generated code lives in `agent/` and `correctness-model/`, so these are the
 *  only directories Node resolution steps through before it leaves the workspace, and a
 *  `node_modules` planted in any of them intercepts the barrel before the controller's own vendor
 *  bytes are reached. The census gate catches a shadow that already exists and returns it as a
 *  blocking finding the next authoring turn can act on; these write denies are the other half,
 *  stopping the Builder from creating one. */
const WORKSPACE_SHADOW_ROOTS: readonly string[] = [
  "node_modules",
  "agent/node_modules",
  "correctness-model/node_modules",
];

/**
 * The vendor entry modules the Builder imports, each with the roots its own imports may reach.
 *
 * The prefixes stay per barrel rather than pooled into one set, because the barrels sit at
 * different distances from protected source. `agent-bundle` reaches `src/solve` and `src/meta`,
 * the Builder's own authoring interface; the correctness runtime lives under `vendor/` and reuses
 * only the already-public `src/meta` shape primitives. Keeping the lists apart is what lets
 * `admit` refuse a correctness barrel that re-exported, say, `src/verify/host.ts`, so protected
 * engine source cannot enter through the barrel that sits nearest to it. That runtime lives under
 * `vendor/` rather than as a granted file inside the otherwise denied `src/truth/`, because Bun
 * lists a directory before it opens a file in it, so the Builder's own `bun test` could not load
 * such a barrel at all. The public type declarations named below are still exact-file exceptions
 * of that kind, which is why `follow` admits them without queueing them: read, never loaded.
 */
const AUTHORING_BARRELS: ReadonlyArray<{
  name: string;
  prefixes: readonly string[];
  /** Admit the barrel's type edges as well as its runtime closure. Only `agent-bundle` carries
   *  this, because the Builder writes `agent/tools.ts` against those declarations. Extending it to
   *  the correctness barrels would admit their type edges into controller internals —
   *  `src/truth/contracts.ts` among them — that no workspace execution ever opens. */
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

/** The `src/` directories of the agent-bundle barrel, granted whole. The Builder writes
 *  `agent/tools.ts` against these declarations and the barrel above already admits both
 *  directories to it, so they are its authoring interface rather than protected material; the
 *  protected `src/truth/` and `src/verify/` trees keep exact-file exceptions for their public
 *  declarations instead. Derived from the barrel rather than repeated, so the two lists cannot
 *  drift apart. `vendor/` is filtered out because each barrel already carries its own narrower
 *  `vendor-bundle` grant, and the vendor root as a whole is not the Builder's interface. */
const AGENT_AUTHORING_INTERFACE = AUTHORING_BARRELS.filter(({ name }) => name === "agent-bundle")
  .flatMap(({ prefixes }) => prefixes)
  .values()
  .filter((prefix) => prefix.startsWith("src/"))
  .map((prefix) => (prefix.endsWith("/") ? prefix.slice(0, -1) : prefix))
  .toArray();

/** The read half of the policy flattened to a path list, for consumers whose vocabulary is paths
 *  rather than rules. Every rule projects as an allow and none needs a matching deny, because a
 *  grant names a file or a directory and says nothing about its siblings, which stay closed by
 *  being unnamed. The one consumer is `builderShellWall`, which sorts the list and hashes it into
 *  the session's recorded wall digest, so a later reader can see which paths a session was opened
 *  with. */
export interface ProjectedReadGrant {
  allow: string[];
}

type GuardDecision =
  | { decision: "allow"; resolved: string; reason: string }
  | { decision: "deny"; resolved: string | null; reason: string; message: string };

/**
 * The repository modules a generated bundle may read, derived from the vendor barrels' own import
 * specifiers rather than from a second hand-maintained list. Candidate validation owns what a
 * bundle may import and each barrel owns what its `@ana/*` name resolves to, so deriving the grant
 * keeps those two facts in one place instead of three, and both layers fail closed: an import
 * leaving its entry module's declared prefixes throws rather than widening the grant.
 *
 * Two things end up in the contract for two different reasons. Every first-level edge of
 * `@ana/agent-bundle`, type edges included, is there so the Builder can read the solve-side
 * contracts it codes against. Every transitive runtime import of all three barrels is there so
 * workspace code can execute against them under the bash sandbox — the starter seeds
 * `correctness-model/*.test.ts` files the Builder runs with `bun test`, and those load the whole
 * runtime closure. Only the named public type declarations are added on top; other type edges
 * erase at load and stay closed, controller internals such as `src/truth/contracts.ts` included.
 * External package imports are left out entirely, because the root lockfile already owns which
 * version of them a bundle gets.
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
     * One declared edge, admitted into the contract and queued for following when it still runs at
     * load. A type-only edge erases at load, and below the barrel it is therefore neither admitted
     * nor followed: `src/solve/built-starter.ts` declares against `src/truth/task-split.ts`, a
     * file no workspace execution ever opens, so following it would make `admit` refuse a contract
     * that is already correct.
     */
    const follow = (file: string, specifier: string, typeOnly: boolean): void => {
      const readable = readTypeEdges === true && file === barrel;
      if (typeOnly && !readable) {
        // Type erasure removes the execution, not the Builder's need to read the public API it is
        // coding against, so a named declaration at the barrel is admitted without being queued.
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
      // Read the statement, not the line. `specifiersIn` is the reader src/claim/bundle-validation.ts
      // already owns for "what does this file import", and it settles what a line scan cannot:
      // `biome format` breaks a long specifier list over several lines, leaving `from` on a line
      // carrying no `import type`, so a type-only re-export reads as a runtime edge and `admit`
      // refuses a contract that was correct.
      for (const load of specifiersIn(parseGeneratedSource(readFileSync(file, "utf8"), file)).loads) {
        if (!load.text.startsWith(".")) continue;
        const statement = load.parent;
        // Only a whole-statement `import type` or `export type` erases at load. A single type
        // specifier inside an otherwise runtime statement does not, and the loader reads it the
        // same way this does.
        const typeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
          : ts.isExportDeclaration(statement) && statement.isTypeOnly;
        follow(file, load.text, typeOnly);
      }
    }
  }
  return [...contract].sort();
}

/** Checks the binding's nesting twice, once as it is spelled and once as the physical roots
 *  guardPath will later compare against, and returns the physical ones. Both are needed because
 *  they catch different mistakes: the lexical one a binding written wrong, the physical one a
 *  binding whose spelling is fine but whose links land somewhere else. The one exception to the
 *  nesting is a declared shared cell root, a microvm guest's share, which may hold `ossRoot` in
 *  place of the epoch. */
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
  // Controller output may be shared into an isolated source worktree through a `campaigns`
  // symlink, so the isolation binds to the physical roots guardPath will later see. The lexical
  // spelling would make every legitimate access to the shared tree resolve outside the grant and
  // look like an escape attempt.
  const epochDir = resolveRequested(repoRoot, binding.epochDir);
  const iterationDir = resolveRequested(repoRoot, binding.iterationDir);
  const ossRoot = resolveRequested(repoRoot, binding.ossRoot);
  const sharedCellRoot = lexicalShared === null ? null : realpathSync.native(lexicalShared);
  if (!containsPath(iterationDir, epochDir) || !ossNested(ossRoot, epochDir, sharedCellRoot)) {
    throw new Error("candidate workspace physical roots are not nested epochDir ⊇ iterationDir/ossRoot");
  }
  return { repoRoot, epochDir, iterationDir, ossRoot, sharedCellRoot };
}

/** Read grants for the adopted tool trees this session runs: the controller's adopted domain link,
 *  and the workspace's own `.toolchain` when it points outside this epoch. Both are written by the
 *  controller through `linkWorkspaceToolTree`, and both are needed because they can disagree — an
 *  evaluation correction keeps the tree it was seeded with while a later adoption moves the domain
 *  link, so granting the adopted domain alone leaves the correction's own `.toolchain/bun` behind a
 *  sibling deny. Each resolved tree must be `epoch-<key>/workspace/.toolchain` of this campaign, so
 *  a re-pointed link buys at worst a sibling epoch's tools, never its evaluator, its evidence or
 *  any write path. */
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
        // its bin, lib and bundled modules — and never the home directory that encloses it.
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
    // Declared only when it is set, so every binding without a shared cell keeps the exact digest
    // it had before the field existed.
    ...keysIf(sharedCellRoot !== null, () => ({
      sharedCellRoot: /* SAFETY: keysIf evaluates only when the null check held. */ sharedCellRoot as string,
    })),
    allow: { read, write, exec: write },
    measuredNamePrefixes: MEASURED_EVIDENCE_NAME_PREFIXES,
    network: author ? ("allow" as const) : ("deny" as const),
    profile: author ? ("candidate" as const) : ("isolated-workshop" as const),
    // Both cells write the host scratch trees, because that is the only route a Builder has to
    // install anything: the authoring session downloads a toolchain there and the offline workshop
    // unpacks it, which is how tens of megabytes of a scientific library land where the verifier
    // can read them. Gating the workshop's share of it behind a flag left the default run unable
    // to install at all.
    scratchWriteRoots: author ? hostScratchRoots : [join(ossRoot, ".tmp"), ...hostScratchRoots],
    readDenyRoots: author ? [ossRoot] : [],
    writeDenyRoots: author ? WORKSPACE_SHADOW_ROOTS.map((root) => join(iterationDir, root)) : [],
    // The same three names `workshopEnvironment` creates and exports as HOME, the cache root and
    // TMPDIR. One owner would be better than two, but the failure mode of drift is the cell being
    // unable to write its own configuration, not a silent widening of the wall.
    cellRuntimeRoots: author ? [] : [".home", ".cache", ".tmp"].map((name) => join(ossRoot, name)),
  };
  return { ...identity, digest: hashJsonBytes(identity) };
}

export function policyReadGrant(policy: CandidateAccessPolicy): ProjectedReadGrant {
  return { allow: policy.allow.read.map((rule) => rule.path) };
}

/** The physical location of a requested path: resolve the deepest ancestor that exists, then
 *  append whatever is left. Resolving the whole path would fail for a file about to be created,
 *  and resolving nothing would judge a symlink planted inside the candidate tree at its name
 *  instead of at its target, which is the way out of the grant. */
function resolveRequested(repoRoot: string, requested: string): string {
  if (requested.includes("\0")) throw new Error("path contains a NUL byte");
  const lexical = isAbsolute(requested) ? resolve(requested) : resolve(repoRoot, requested);
  let probe = lexical;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  return resolve(realpathSync.native(probe), relative(probe, lexical));
}

/** The in-process path check every capability runs before the OS enforces the same policy. The
 *  order of the checks is the policy: the cross-cell and module-shadow denies come first because
 *  they must survive the grants, then the credential and `.git` names, then measured evidence, and
 *  only then the allow rules. A deny running after the allows would never be reached for a path
 *  inside a granted subtree, which is exactly where the dangerous ones sit. */
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

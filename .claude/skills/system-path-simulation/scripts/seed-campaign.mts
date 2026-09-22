/**
 * Seed one recorded campaign into an owned condition, the way four simulation campaigns each
 * did by hand between 7 and 10 September: a clone, a bespoke byte and symlink check, a fabricated
 * product pointer, hand-copied runs and claims, a hand-written admission, and the absolute-path
 * relocation one steward forgot, which invalidated a whole condition. This is that work once,
 * through the production writers, with the audit every copy needs.
 *
 * Two modes, both refusing an existing destination and never writing into the source:
 *
 *   clone      --from-root /abs/run-root --slug <slug> --into-root /abs/fresh-tree-root
 *              The stage-run mode: `campaigns/<slug>` and `domains/<slug>` copied under the same
 *              slug into another tree, the live `.controller.lock` removed, the selected product
 *              re-read through `readProductVersion`.
 *   republish  --from-root /abs/run-root --slug <slug> --as-slug <new-slug> [--into-root /abs/tree]
 *              The seeded-step mode: the selected product's bytes and tool tree copied into an
 *              owned seed under the new campaign, published as a fresh retained product through
 *              `publishProductVersion` and `selectInitialProduct`, with every recorded run, claim,
 *              analysis file and the latest admission carried so the real selector reads the same
 *              history. `--into-root` defaults to the tree this script was read from.
 *
 * A clone first drops each epoch workspace's `node_modules`: production re-creates that link farm
 * from its own tree on every call (`linkWorkspacePackageScopes`), and copied, its per-package links
 * resolve into the source tree's `node_modules`. The manifest lists what was dropped.
 *
 * The audit after either copy lists every symlink that resolves into the source root and every
 * text file whose bytes name the source root. A run root whose `campaigns/` is a symlink records
 * its campaign under the link's real path, so that real directory is audited as an alias of the
 * copied campaign. An escape always refuses (exit 1); an absolute reference refuses unless
 * `--allow-absolute-refs` is passed. `--relocate` rewrites the text references to the destination
 * root, and an alias to the copied directory: only in mutable
 * files for a clone, because a retained product version is immutable and its ledger digest binds
 * its bytes; in the owned seed before publication for a republish, so the new version's fingerprint
 * is taken over the relocated bytes and the manifest records both. The one link a clone must keep
 * is the retained product's own `.toolchain`, whose realpath the immutable manifest pins; it is
 * reported under `toolTreeLinks`, not as an escape.
 *
 * `seed.json` (schema `simulation-seed/v1`) lands inside the destination campaign.
 */
import {
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { dirname, isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { fingerprintSlug, type FingerprintEvidence } from "#src/claim/fingerprint.ts";
import { bundleSnapshotToolTree } from "#src/claim/bundle-snapshot.ts";
import { claimsDirFor } from "#src/run/claim-write.ts";
import { readClimbBatteries } from "#src/run/climb-history.ts";
import { ControllerLedger, controllerLedgerExists } from "#src/run/controller-ledger.ts";
import { CONTROLLER_LOCK_FILE } from "#src/run/campaign-lock.ts";
import {
  productHistoryDirs,
  publishProductVersion,
  readProductVersion,
  selectInitialProduct,
  selectedProductDir,
} from "#src/run/product-versions.ts";
import { absoluteOption, type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";
import { CONFORMANCE_FILE } from "#src/claim/conformance-evidence.ts";

const die: ExitWith = exitWith("seed-campaign");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");
const TEXT_SCAN_LIMIT = 4 * 1024 * 1024;

export interface SymlinkRow {
  path: string;
  target: string;
  resolved: string;
}
export interface AbsoluteRefRow {
  path: string;
  count: number;
  sha256Before: string;
  sha256After: string | null;
  immutable: boolean;
}
/** One source path and the copy path that now stands for it. */
export interface SeedAlias {
  from: string;
  to: string;
}
export interface SeedAudit {
  sourceRoot: string;
  /** Real directories the source records name for the copied ones, when `campaigns/` or `domains/` is a symlink. */
  aliases: SeedAlias[];
  /** Links resolving into the source root; a refusal unless allowed. */
  escapes: SymlinkRow[];
  /** The retained product's pinned tool tree, kept because the immutable manifest names it. */
  toolTreeLinks: SymlinkRow[];
  /** Links resolving outside both trees (runtime paths); reported, never a refusal. */
  external: SymlinkRow[];
  absoluteRefs: AbsoluteRefRow[];
  relocated: boolean;
}
export interface SeedOptions {
  allowAbsoluteRefs?: boolean;
  relocate?: boolean;
  productId?: string;
}
export interface SeedManifest {
  schema: "simulation-seed/v1";
  mode: "clone" | "republish";
  fromRoot: string;
  slug: string;
  asSlug: string | null;
  intoRoot: string;
  campaign: string;
  selectedProductId: string | null;
  fingerprintBefore: FingerprintEvidence | null;
  fingerprintAfter: FingerprintEvidence | null;
  files: number;
  bytesSha256: string;
  lockRemoved: boolean;
  /** Campaign-relative scratch directories removed from the clone before the audit. */
  droppedScratch: string[];
  audit: SeedAudit;
  carried: {
    historyRuns: number;
    sourceHistoryRuns: number;
    claims: number;
    analysisFiles: number;
    admission: boolean;
  };
}

export class SeedRefusal extends Error {}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** Every entry under `root`, links unfollowed. */
function entries(root: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: root, dot: true, onlyFiles: false, followSymlinks: false })]
    .map((name) => join(root, name))
    .sort();
}

/** Resolve a link target through its nearest existing ancestor, keeping an unfinished tail. */
function resolvedLinkTarget(link: string) {
  const target = readlinkSync(link);
  const targetPath = isAbsolute(target) ? target : resolve(dirname(link), target);
  let ancestor = targetPath;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  return { target, resolved: resolve(realpathSync(ancestor), relative(ancestor, targetPath)) };
}

function textOf(path: string): string | null {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > TEXT_SCAN_LIMIT) return null;
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/** Audit one copied tree against the source root it was taken from. `immutableRoots` name the
 *  retained versions whose bytes must not move; `pinnedToolTrees` their manifest tool paths. */
export function auditSeed(
  copyRoot: string,
  sourceRoot: string,
  immutableRoots: readonly string[],
  pinnedToolTrees: readonly string[],
  aliases: readonly SeedAlias[] = [],
): SeedAudit {
  const source = realpathSync(sourceRoot);
  const copy = realpathSync(copyRoot);
  const audit: SeedAudit = {
    sourceRoot: source,
    aliases: [...aliases],
    escapes: [],
    toolTreeLinks: [],
    external: [],
    absoluteRefs: [],
    relocated: false,
  };
  const roots = [...new Set([source, sourceRoot, ...aliases.map((alias) => alias.from)])];
  for (const path of entries(copy)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const { target, resolved } = resolvedLinkTarget(path);
      const row = { path, target, resolved };
      if (inside(copy, resolved)) continue;
      if (pinnedToolTrees.includes(resolved)) audit.toolTreeLinks.push(row);
      else if (roots.some((root) => inside(root, resolved))) audit.escapes.push(row);
      else audit.external.push(row);
      continue;
    }
    if (!stat.isFile()) continue;
    const text = textOf(path);
    if (text === null) continue;
    // The manifest's own tool-tree path is the pinned link reported above, not a stray reference;
    // only a pinned tree under the source root or an alias is part of the count at all.
    const pinnedCount = pinnedToolTrees
      .filter((tree) => roots.some((root) => inside(root, tree)))
      .reduce((sum, tree) => sum + countOccurrences(text, tree), 0);
    const count = roots.reduce((sum, root) => sum + countOccurrences(text, root), 0) - pinnedCount;
    if (count === 0) continue;
    audit.absoluteRefs.push({
      path,
      count,
      sha256Before: sha256(readFileSync(path)),
      sha256After: null,
      immutable: immutableRoots.some((root) => inside(root, path)),
    });
  }
  return audit;
}

/** Rewrite the source root to the destination root, and each alias to its copy, in every mutable listed file. */
function relocateRefs(audit: SeedAudit, sourceRoot: string, destinationRoot: string): void {
  for (const row of audit.absoluteRefs) {
    if (row.immutable) continue;
    const text = textOf(row.path);
    if (text === null) continue;
    let rewritten = text;
    for (const alias of audit.aliases) rewritten = rewritten.replaceAll(alias.from, alias.to);
    rewritten = rewritten
      .replaceAll(audit.sourceRoot, destinationRoot)
      .replaceAll(sourceRoot, destinationRoot);
    // A staged product copy keeps the retained version's read-only modes; this copy is ours to edit.
    chmodSync(row.path, statSync(row.path).mode | 0o200);
    writeFileSync(row.path, rewritten);
    row.sha256After = sha256(readFileSync(row.path));
  }
  audit.relocated = true;
}

function refuseOnAudit(audit: SeedAudit, options: SeedOptions): void {
  const open = audit.absoluteRefs.filter((row) => row.sha256After === null);
  if (audit.escapes.length === 0 && (open.length === 0 || options.allowAbsoluteRefs === true)) return;
  const rows = [
    ...audit.escapes.map((row) => `symlink escape ${row.path} -> ${row.target} (${row.resolved})`),
    ...open.map(
      (row) =>
        `absolute reference ${row.path} x${row.count}${row.immutable ? " [immutable product bytes]" : ""}`,
    ),
  ];
  throw new SeedRefusal(`seed audit refused:\n${rows.join("\n")}`);
}

function digestTree(root: string) {
  const rows: string[] = [];
  for (const path of entries(root)) {
    const stat = lstatSync(path);
    if (stat.isFile()) rows.push(`${relative(root, path)}\0${sha256(readFileSync(path))}`);
  }
  return { files: rows.length, bytesSha256: sha256(rows.join("\n")) };
}

function clone(from: string, to: string): void {
  cpSync(from, to, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
}

/** The real directory a run root's `campaigns/` or `domains/` link points at, when it is one. */
function aliasOf(sourceDir: string, copyDir: string): SeedAlias[] {
  const real = realpathSync(sourceDir);
  return inside(realpathSync(dirname(dirname(sourceDir))), real) ? [] : [{ from: real, to: copyDir }];
}

/** Remove each epoch workspace's controller-owned `node_modules` link farm from a cloned campaign. */
function dropWorkspaceScratch(campaign: string): string[] {
  const dropped: string[] = [];
  for (const name of new Bun.Glob("epoch-*/workspace/node_modules").scanSync({
    cwd: campaign,
    onlyFiles: false,
  })) {
    rmSync(join(campaign, name), { recursive: true, force: true });
    dropped.push(name);
  }
  return dropped.sort();
}

function readAdmissionPayload(campaign: string): string | null {
  if (!controllerLedgerExists(campaign)) return null;
  using ledger = ControllerLedger.open(campaign);
  return ledger.readAdmission();
}

function selectedProductId(campaign: string): string | null {
  if (!controllerLedgerExists(campaign)) return null;
  using ledger = ControllerLedger.open(campaign);
  return ledger.selectedProduct();
}

function historyRows(repoRoot: string, slug: string): number {
  const product = selectedProductDir(repoRoot, slug);
  return existsSync(product)
    ? readClimbBatteries(product, null, claimsDirFor(repoRoot, slug)).history.length
    : 0;
}

function countFiles(dir: string): number {
  return existsSync(dir) ? entries(dir).filter((path) => lstatSync(path).isFile()).length : 0;
}

function fingerprintOf(dir: string, slug: string): FingerprintEvidence | null {
  if (!existsSync(dir)) return null;
  const result = fingerprintSlug(dir, { slug });
  return result.ok ? result : null;
}

function requireAbsent(path: string): void {
  if (existsSync(path)) throw new SeedRefusal(`${path} already exists; one fresh destination per condition`);
}

function writeManifest(manifest: SeedManifest): string {
  const path = join(manifest.campaign, "seed.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

/** Clone `campaigns/<slug>` and `domains/<slug>` under the same slug into `intoRoot`. */
export function seedCampaignInto(
  fromRoot: string,
  slug: string,
  intoRoot: string,
  options: SeedOptions = {},
): SeedManifest {
  const sourceCampaign = campaignDir(fromRoot, slug);
  if (!existsSync(sourceCampaign)) throw new SeedRefusal(`${sourceCampaign} does not exist`);
  const campaign = campaignDir(intoRoot, slug);
  const sourceDomain = join(fromRoot, "domains", slug);
  const domain = join(intoRoot, "domains", slug);
  requireAbsent(campaign);
  if (existsSync(sourceDomain)) requireAbsent(domain);
  mkdirSync(dirname(campaign), { recursive: true });
  clone(sourceCampaign, campaign);
  const droppedScratch = dropWorkspaceScratch(campaign);
  if (existsSync(sourceDomain)) {
    mkdirSync(dirname(domain), { recursive: true });
    clone(sourceDomain, domain);
  }
  const lock = join(campaign, CONTROLLER_LOCK_FILE);
  const lockRemoved = existsSync(lock);
  if (lockRemoved) {
    rmSync(lock);
    console.error(`seed-campaign: removed ${lock} (named the live run's pid)`);
  }
  const productId = selectedProductId(campaign);
  const versions = join(campaign, "versions");
  const immutable = existsSync(versions) ? readdirSync(versions).map((id) => join(versions, id)) : [];
  const pinned = immutable
    .map((dir) => bundleSnapshotToolTree(dir))
    .filter((path): path is string => path !== null);
  const aliases = [
    ...aliasOf(sourceCampaign, campaign),
    ...(existsSync(sourceDomain) ? aliasOf(sourceDomain, domain) : []),
  ];
  const audit = auditSeed(campaign, fromRoot, immutable, pinned, aliases);
  if (existsSync(domain)) {
    const domainAudit = auditSeed(domain, fromRoot, [], pinned, aliases);
    audit.escapes.push(...domainAudit.escapes);
    audit.toolTreeLinks.push(...domainAudit.toolTreeLinks);
    audit.external.push(...domainAudit.external);
    audit.absoluteRefs.push(...domainAudit.absoluteRefs);
  }
  if (options.relocate === true) relocateRefs(audit, fromRoot, intoRoot);
  refuseOnAudit(audit, options);
  const product = selectedProductDir(intoRoot, slug);
  const manifest: SeedManifest = {
    schema: "simulation-seed/v1",
    mode: "clone",
    fromRoot,
    slug,
    asSlug: null,
    intoRoot,
    campaign,
    selectedProductId: productId,
    fingerprintBefore: fingerprintOf(selectedProductDir(fromRoot, slug), slug),
    fingerprintAfter: fingerprintOf(product, slug),
    ...digestTree(campaign),
    lockRemoved,
    droppedScratch,
    audit,
    carried: {
      historyRuns: historyRows(intoRoot, slug),
      sourceHistoryRuns: historyRows(fromRoot, slug),
      claims: countFiles(claimsDirFor(intoRoot, slug)),
      analysisFiles: countFiles(join(campaign, "analysis")),
      admission: readAdmissionPayload(campaign) === readAdmissionPayload(sourceCampaign),
    },
  };
  writeManifest(manifest);
  return manifest;
}

/** Copy the selected product's bytes and tool tree into an owned seed, relinking tool links that
 *  pointed inside the source tool tree so the copy is self-contained. */
function stageSeed(sourceProduct: string, seed: string): void {
  mkdirSync(seed, { recursive: true });
  for (const part of ["agent", "correctness-model"]) clone(join(sourceProduct, part), join(seed, part));
  const conformance = join(sourceProduct, CONFORMANCE_FILE);
  if (existsSync(conformance)) cpSync(conformance, join(seed, CONFORMANCE_FILE));
  const toolTree = bundleSnapshotToolTree(sourceProduct);
  if (toolTree === null) return;
  const copy = join(seed, ".toolchain");
  clone(toolTree, copy);
  for (const path of entries(copy)) {
    if (!lstatSync(path).isSymbolicLink()) continue;
    const { target, resolved } = resolvedLinkTarget(path);
    if (!isAbsolute(target) || !inside(toolTree, resolved)) continue;
    rmSync(path);
    symlinkSync(relative(dirname(path), join(copy, relative(toolTree, resolved))) || ".", path);
  }
}

function carryHistory(
  fromRoot: string,
  slug: string,
  intoRoot: string,
  asSlug: string,
  version: string,
): SeedManifest["carried"] {
  const sourceProduct = selectedProductDir(fromRoot, slug);
  for (const dir of productHistoryDirs(sourceProduct)) {
    const runs = join(dir, "runs");
    if (!existsSync(runs)) continue;
    for (const runId of readdirSync(runs).sort()) {
      const destination = join(version, "runs", runId);
      if (!existsSync(destination)) clone(join(runs, runId), destination);
    }
  }
  const claims = claimsDirFor(fromRoot, slug);
  if (existsSync(claims)) clone(claims, claimsDirFor(intoRoot, asSlug));
  const analysis = join(campaignDir(fromRoot, slug), "analysis");
  if (existsSync(analysis)) clone(analysis, join(campaignDir(intoRoot, asSlug), "analysis"));
  const admission = readAdmissionPayload(campaignDir(fromRoot, slug));
  if (admission !== null) {
    using ledger = ControllerLedger.open(campaignDir(intoRoot, asSlug));
    ledger.writeAdmission(admission);
  }
  return {
    historyRuns: historyRows(intoRoot, asSlug),
    sourceHistoryRuns: historyRows(fromRoot, slug),
    claims: countFiles(claimsDirFor(intoRoot, asSlug)),
    analysisFiles: countFiles(join(campaignDir(intoRoot, asSlug), "analysis")),
    admission: admission === readAdmissionPayload(campaignDir(intoRoot, asSlug)),
  };
}

/** Republish the selected product of `campaigns/<slug>` as a fresh product under `asSlug`. */
export function republishAsSlug(
  fromRoot: string,
  slug: string,
  asSlug: string,
  intoRoot: string,
  options: SeedOptions = {},
): SeedManifest {
  const sourceProduct = selectedProductDir(fromRoot, slug);
  if (!existsSync(sourceProduct)) throw new SeedRefusal(`${sourceProduct} does not exist`);
  const campaign = campaignDir(intoRoot, asSlug);
  requireAbsent(campaign);
  const productId = options.productId ?? `seed-${selectedProductId(campaignDir(fromRoot, slug)) ?? "domain"}`;
  const seed = join(campaign, "seed");
  stageSeed(sourceProduct, seed);
  const audit = auditSeed(seed, fromRoot, [], []);
  if (options.relocate === true) relocateRefs(audit, fromRoot, intoRoot);
  try {
    refuseOnAudit(audit, options);
  } catch (error) {
    // Nothing is published or registered yet, and the destination was absent before staging.
    rmSync(campaign, { recursive: true, force: true });
    throw error;
  }
  const fingerprint = fingerprintSlug(seed, { slug: asSlug });
  if (!fingerprint.ok) {
    throw new SeedRefusal(`owned seed has no fingerprint: ${JSON.stringify(fingerprint.findings)}`);
  }
  const conformance = join(seed, CONFORMANCE_FILE);
  const version = publishProductVersion({
    repoRoot: intoRoot,
    slug: asSlug,
    id: productId,
    acceptedSnapshot: seed,
    fingerprint,
    ...keysIf(existsSync(conformance), () => ({ conformancePath: conformance })),
  });
  selectInitialProduct(intoRoot, asSlug, productId);
  const carried = carryHistory(fromRoot, slug, intoRoot, asSlug, version);
  readProductVersion(intoRoot, asSlug, productId);
  const after = auditSeed(campaign, fromRoot, [version], []);
  if (after.escapes.length > 0) {
    throw new SeedRefusal(
      `carried history escapes into the source: ${after.escapes.map((row) => row.path).join(", ")}`,
    );
  }
  const manifest: SeedManifest = {
    schema: "simulation-seed/v1",
    mode: "republish",
    fromRoot,
    slug,
    asSlug,
    intoRoot,
    campaign,
    selectedProductId: productId,
    fingerprintBefore: fingerprintOf(sourceProduct, slug),
    fingerprintAfter: fingerprint,
    ...digestTree(campaign),
    lockRemoved: false,
    droppedScratch: [],
    audit: {
      ...audit,
      external: after.external,
      absoluteRefs: [...audit.absoluteRefs, ...after.absoluteRefs.filter((row) => !inside(seed, row.path))],
    },
    carried,
  };
  writeManifest(manifest);
  return manifest;
}

const absolute = absoluteOption(die);

function main(argv: readonly string[]): void {
  const parsed = parseOrDie(
    die,
    {
      values: ["from-root", "slug", "into-root", "as-slug", "product-id"],
      flags: ["allow-absolute-refs", "relocate", "json"],
    },
    argv,
  );
  const { single, flags } = parsed;
  const fromRoot = absolute("from-root", single.get("from-root") ?? die("--from-root is required"));
  const slug = single.get("slug") ?? die("--slug is required");
  const asSlug = single.get("as-slug");
  const intoRootFlag = single.get("into-root");
  if (intoRootFlag === undefined && asSlug === undefined) {
    die("--into-root (clone) or --as-slug (republish) is required");
  }
  const intoRoot = intoRootFlag === undefined ? REPO_ROOT : absolute("into-root", intoRootFlag);
  const options: SeedOptions = {
    allowAbsoluteRefs: flags.has("allow-absolute-refs"),
    relocate: flags.has("relocate"),
    ...keyIfDefined("productId", single.get("product-id")),
  };
  let manifest: SeedManifest;
  try {
    manifest =
      asSlug === undefined
        ? seedCampaignInto(fromRoot, slug, intoRoot, options)
        : republishAsSlug(fromRoot, slug, asSlug, intoRoot, options);
  } catch (error) {
    if (!(error instanceof SeedRefusal)) throw error;
    die(error.message, 1);
  }
  if (flags.has("json")) console.log(JSON.stringify(manifest, null, 2));
  else {
    console.log(
      `seeded ${manifest.mode} ${manifest.slug}${manifest.asSlug === null ? "" : ` as ${manifest.asSlug}`} into ${manifest.campaign}: ` +
        `${manifest.files} files, product ${manifest.selectedProductId ?? "none"}, history ${manifest.carried.historyRuns}/${manifest.carried.sourceHistoryRuns}, ` +
        `escapes ${manifest.audit.escapes.length}, absolute refs ${manifest.audit.absoluteRefs.length}${manifest.audit.relocated ? " (relocated)" : ""}`,
    );
  }
}

if (import.meta.main) main(Bun.argv.slice(2));

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
 *              The fresh-tree mode: `campaigns/<slug>` and `domains/<slug>` copied under the same
 *              slug into another tree, the live `.controller.lock` removed, the selected product
 *              found through the ledger and checked against its registered digest.
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
 * root, and an alias to the copied directory, and relinks an escaping link whose target lies inside
 * the copied campaign or domain (a venv's absolute interpreter link, a uv cache entry) to the same
 * place in the copy, relative, so the copy stays self-contained: text only in mutable
 * files for a clone, because a retained product version is immutable and its ledger digest binds
 * its bytes; in the owned seed before publication for a republish, so the new version's fingerprint
 * is taken over the relocated bytes and the manifest records both. The one link a clone must keep
 * is the retained product's own `.toolchain`, whose realpath the immutable manifest pins; it is
 * reported under `toolTreeLinks`, not as an escape.
 *
 * A republish relocates the owned seed's `.toolchain` by rule, flag or not: that tree sits outside
 * the fingerprint, and a firmware seed on 2026-09-30 refused on 3,466 references, every one inside
 * the arduino build cache under `.toolchain/home/.cache`, and cost a second five-minute run with
 * `--relocate`. The source tool tree, under either spelling, becomes the seed's own tool tree, the
 * spelling production's workspace copy then moves; other references move to the new campaign or
 * the destination root. A file whose first 8 KiB hold no NUL is searched whole up to 64 MiB (that
 * seed's 105 linker maps, 19 MB each, went unaudited under the old 4 MiB limit); a larger one is
 * listed under `unscanned`. A refusal with more than twenty files lists directories with counts.
 * `--as-slug a,b,c` seeds one arm per slug from the same recorded position. A recorded tool tree
 * that is gone is said beside the summary; `--tool-tree /abs/tree` stages another in its place
 * (tool-tree.mts lists the family's), as two truss conditions on 2026-09-30 would have needed.
 *
 * `seed.json` (schema `simulation-seed/v1`) lands inside the destination campaign. Its `bytesSha256`
 * covers every file outside a `.toolchain`; each tool tree is listed by path and size instead.
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
import { campaignDir, defaultProductDir } from "#src/meta/campaign-root.ts";
import { fingerprintSlug, type FingerprintEvidence } from "#src/claim/fingerprint.ts";
import { bundleSnapshotToolTree } from "#src/claim/bundle-snapshot.ts";
import { claimsDirFor } from "#src/run/claim-write.ts";
import { ControllerLedger, controllerLedgerExists } from "#src/run/controller-ledger.ts";
import { CONTROLLER_LOCK_FILE } from "#src/run/campaign-lock.ts";
import {
  PRODUCT_VERSION_FILE,
  productVersionDir,
  publishProductVersion,
  readProductVersion,
  selectInitialProduct,
} from "#src/run/product-versions.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { absoluteOption, type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { CONFORMANCE_FILE } from "#src/claim/conformance-evidence.ts";
import { readEpochRecord } from "#src/author/campaign-epoch.ts";
import { HANDOVER_FILES } from "#src/author/builder-execution.ts";
import { WORKSPACE_DIR } from "#src/author/builder-memory.ts";
import { productToolTree, SEED_MANIFEST, usableToolTree } from "./tool-tree.mts";
import { readHead } from "./file-head.mts";

const die: ExitWith = exitWith("seed-campaign");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");
const HEAD_BYTES = 8192;
/** A file with no NUL in its head is searched whole up to this size and listed as unscanned above it. */
const TEXT_SCAN_LIMIT = 64 * 1024 * 1024;
/** A refusal naming more files than this lists directories instead. */
const LISTED_REFUSAL_ROWS = 20;
const TOOL_TREE = ".toolchain";

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
export interface UnscannedRow {
  path: string;
  bytes: number;
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
  /** Links resolving into the source root; always a refusal. */
  escapes: SymlinkRow[];
  /** Escapes into a copied tree that `--relocate` pointed at the copy instead; `resolved` is the new target. */
  relinked: SymlinkRow[];
  /** The retained product's pinned tool tree, kept because the immutable manifest names it. */
  toolTreeLinks: SymlinkRow[];
  /** Links resolving outside both trees (runtime paths); reported, never a refusal. */
  external: SymlinkRow[];
  absoluteRefs: AbsoluteRefRow[];
  /** Files that read as text but exceed `TEXT_SCAN_LIMIT`, so no reference in them was counted. */
  unscanned: UnscannedRow[];
  /** Whether `--relocate` was passed; a row relocated by rule has its `sha256After` without it. */
  relocated: boolean;
}
export interface SeedOptions {
  allowAbsoluteRefs?: boolean;
  relocate?: boolean;
  productId?: string;
  /** Republish only: stage this tool tree instead of the source product's, for a swept one. */
  toolTree?: string;
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
  /** Files under a `.toolchain`, outside `bytesSha256`: listed by relative path and size. */
  toolTrees: { files: number; bytes: number; listingSha256: string };
  lockRemoved: boolean;
  /** Campaign-relative scratch directories removed from the clone before the audit. */
  droppedScratch: string[];
  audit: SeedAudit;
  /** Republish only: the source product's tool tree as its link names it, and whether it still
   *  resolved. A swept tree seeds nothing, and the Builder meets an empty `.toolchain`. */
  toolTreeSource: { recorded: string | null; present: boolean; staged: string | null } | null;
  /** Republish only: the source's current epoch notes, which a fresh campaign does not inherit. */
  notesNotCarried: { epoch: string; files: { file: string; bytes: number }[] } | null;
  carried: {
    historyRuns: number;
    sourceHistoryRuns: number;
    claims: number;
    analysisFiles: number;
    admission: boolean;
  };
}

interface Occurrence {
  at: number;
  needle: string;
}

export class SeedRefusal extends Error {}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** Every entry under `root`, links unfollowed, without walking the top-level names in `skip`. */
function entries(root: string, skip: readonly string[] = []): string[] {
  return readdirSync(root)
    .filter((name) => !skip.includes(name))
    .flatMap((name) => {
      const path = join(root, name);
      if (!lstatSync(path).isDirectory()) return [path];
      const nested = new Bun.Glob("**/*").scanSync({
        cwd: path,
        dot: true,
        onlyFiles: false,
        followSymlinks: false,
      });
      return [path, ...[...nested].map((child) => join(path, child))];
    })
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

/** A file's bytes when it reads as text. The head is sniffed before the rest is read, so a
 *  binary costs 8 KiB rather than its size. */
function textBytes(path: string, size: number): Buffer | "binary" | "unscanned" {
  if (readHead(path, Math.min(HEAD_BYTES, size)).includes(0)) return "binary";
  return size > TEXT_SCAN_LIMIT ? "unscanned" : readFileSync(path);
}

/** Non-overlapping occurrences of any needle, earliest first and the longest where two start at
 *  one offset, so a path spelled under two roots (`/tmp` and `/private/tmp`) counts once. */
function occurrences(bytes: Buffer, needles: readonly string[]): Occurrence[] {
  const found: Occurrence[] = [];
  const next = needles.map((needle) => bytes.indexOf(needle));
  for (let start = 0; ; ) {
    let best: Occurrence | null = null;
    for (const [index, needle] of needles.entries()) {
      let at = next[index] ?? -1;
      if (at !== -1 && at < start) {
        at = bytes.indexOf(needle, start);
        next[index] = at;
      }
      if (at === -1) continue;
      if (best === null || at < best.at || (at === best.at && needle.length > best.needle.length)) {
        best = { at, needle };
      }
    }
    if (best === null) return found;
    found.push(best);
    start = best.at + Buffer.byteLength(best.needle);
  }
}

/** Replace each `from` with its `to` in one pass, so a destination that contains a source spelling
 *  is never rewritten twice. */
function rewriteBytes(bytes: Buffer, rewrites: readonly SeedAlias[]): Buffer {
  const parts: Buffer[] = [];
  let start = 0;
  for (const { at, needle } of occurrences(
    bytes,
    rewrites.map((pair) => pair.from),
  )) {
    const to = rewrites.find((pair) => pair.from === needle)?.to ?? needle;
    parts.push(bytes.subarray(start, at), Buffer.from(to));
    start = at + Buffer.byteLength(needle);
  }
  parts.push(bytes.subarray(start));
  return Buffer.concat(parts);
}

/** Audit one copied tree against the source root it was taken from. `immutableRoots` name the
 *  retained versions whose bytes must not move; `pinnedToolTrees` their manifest tool paths; `skip`
 *  top-level names already audited. */
export function auditSeed(
  copyRoot: string,
  sourceRoot: string,
  immutableRoots: readonly string[],
  pinnedToolTrees: readonly string[],
  { aliases = [], skip = [] }: { aliases?: readonly SeedAlias[]; skip?: readonly string[] } = {},
): SeedAudit {
  const source = realpathSync(sourceRoot);
  const copy = realpathSync(copyRoot);
  const audit: SeedAudit = {
    sourceRoot: source,
    aliases: [...aliases],
    escapes: [],
    relinked: [],
    toolTreeLinks: [],
    external: [],
    absoluteRefs: [],
    unscanned: [],
    relocated: false,
  };
  const roots = [...new Set([source, sourceRoot, ...aliases.map((alias) => alias.from)])];
  // The manifest's own tool-tree path is the pinned link reported below, not a stray reference;
  // only a pinned tree under the source root or an alias is part of the count at all.
  const pinned = pinnedToolTrees.filter((tree) => roots.some((root) => inside(root, tree)));
  for (const path of entries(copy, skip)) {
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
    const bytes = textBytes(path, stat.size);
    if (bytes === "binary") continue;
    if (bytes === "unscanned") {
      audit.unscanned.push({ path, bytes: stat.size });
      continue;
    }
    const count = occurrences(bytes, [...roots, ...pinned]).filter(
      ({ needle }) => !pinned.includes(needle),
    ).length;
    if (count === 0) continue;
    audit.absoluteRefs.push({
      path,
      count,
      sha256Before: sha256(bytes),
      sha256After: null,
      immutable: immutableRoots.some((root) => inside(root, path)),
    });
  }
  return audit;
}

/** Rewrite each listed mutable file that `relocates` admits, most specific spelling first. */
function relocateRefs(
  audit: SeedAudit,
  rewrites: readonly SeedAlias[],
  relocates: (row: AbsoluteRefRow) => boolean = () => true,
): void {
  for (const row of audit.absoluteRefs) {
    if (row.immutable || !relocates(row)) continue;
    const bytes = rewriteBytes(readFileSync(row.path), rewrites);
    // A staged product copy keeps the retained version's read-only modes; this copy is ours to edit.
    chmodSync(row.path, statSync(row.path).mode | 0o200);
    writeFileSync(row.path, bytes);
    row.sha256After = sha256(bytes);
  }
}

/** The source root and each alias, as the rewrites a clone applies. */
function rootRewrites(audit: SeedAudit, sourceRoot: string, destinationRoot: string): SeedAlias[] {
  return [
    ...audit.aliases,
    { from: audit.sourceRoot, to: destinationRoot },
    { from: sourceRoot, to: destinationRoot },
  ];
}

/** Point each escape whose target lies inside a tree this seed copied at the same place in the copy. */
function relinkIntoCopies(audit: SeedAudit, copies: readonly SeedAlias[]): void {
  const escapes: SymlinkRow[] = [];
  for (const row of audit.escapes) {
    const copy = copies.find((pair) => inside(pair.from, row.resolved));
    if (copy === undefined) {
      escapes.push(row);
      continue;
    }
    const resolved = join(copy.to, relative(copy.from, row.resolved));
    rmSync(row.path);
    symlinkSync(relative(dirname(row.path), resolved) || ".", row.path);
    audit.relinked.push({ path: row.path, target: row.target, resolved });
  }
  audit.escapes = escapes;
}

/** One line per open reference, or per directory once there are too many to read. */
function referenceLines(open: readonly AbsoluteRefRow[]): string[] {
  const mark = (immutable: boolean) => (immutable ? " [immutable product bytes]" : "");
  if (open.length <= LISTED_REFUSAL_ROWS) {
    return open.map((row) => `absolute reference ${row.path} x${row.count}${mark(row.immutable)}`);
  }
  let keys = open.map((row) => dirname(row.path));
  while (new Set(keys).size > LISTED_REFUSAL_ROWS) keys = keys.map((key) => dirname(key));
  const groups = new Map<string, { files: number; refs: number; immutable: boolean }>();
  for (const [index, row] of open.entries()) {
    const key = keys[index] ?? dirname(row.path);
    const group = groups.get(key) ?? { files: 0, refs: 0, immutable: false };
    groups.set(key, {
      files: group.files + 1,
      refs: group.refs + row.count,
      immutable: group.immutable || row.immutable,
    });
  }
  const total = open.reduce((sum, row) => sum + row.count, 0);
  return [
    `absolute references in ${open.length} files (${total} occurrences), by directory:`,
    ...[...groups].map(
      ([key, group]) => `  ${key}/ files ${group.files} refs ${group.refs}${mark(group.immutable)}`,
    ),
  ];
}

function refuseOnAudit(audit: SeedAudit, options: SeedOptions): void {
  const open = audit.absoluteRefs.filter((row) => row.sha256After === null);
  if (audit.escapes.length === 0 && (open.length === 0 || options.allowAbsoluteRefs === true)) return;
  const rows = [
    ...audit.escapes.map((row) => `symlink escape ${row.path} -> ${row.target} (${row.resolved})`),
    ...(options.allowAbsoluteRefs === true ? [] : referenceLines(open)),
  ];
  const remedy =
    open.length === 0 || options.allowAbsoluteRefs === true
      ? []
      : [
          options.relocate === true
            ? "the references left are in immutable product bytes, which --relocate never rewrites"
            : "--relocate rewrites the mutable references to the destination; --allow-absolute-refs seeds with them as they are",
        ];
  throw new SeedRefusal(`seed audit refused:\n${[...rows, ...remedy].join("\n")}`);
}

/** Every file's bytes outside a `.toolchain`, and each tool tree's files by path and size: a tool
 *  tree is outside the fingerprint and gigabytes large, and its relocated files carry their own
 *  digests under `absoluteRefs`. */
function digestTree(root: string) {
  const rows: string[] = [];
  const tools: string[] = [];
  let toolBytes = 0;
  for (const path of entries(root)) {
    const stat = lstatSync(path);
    if (!stat.isFile()) continue;
    const name = relative(root, path);
    if (name.split("/").includes(TOOL_TREE)) {
      tools.push(`${name}\0${stat.size}`);
      toolBytes += stat.size;
    } else rows.push(`${name}\0${sha256(readFileSync(path))}`);
  }
  return {
    files: rows.length + tools.length,
    bytesSha256: sha256(rows.join("\n")),
    toolTrees: { files: tools.length, bytes: toolBytes, listingSha256: sha256(tools.join("\n")) },
  };
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

/** The selected product and every product directory the campaign's history reads, found through
 *  the ledger and checked against each version's registered digest rather than read through
 *  `readProductVersion`. A seed's source may be a campaign an earlier source recorded, whose
 *  manifests this head refuses to continue; carrying its bytes into a condition, or republishing
 *  them as a fresh product, is what that refusal asks for, so the seed must reach them. */
function recordedProducts(root: string, slug: string) {
  const campaign = campaignDir(root, slug);
  const fallback = defaultProductDir(root, slug);
  if (!controllerLedgerExists(campaign)) return { selected: fallback, history: [fallback] };
  using ledger = ControllerLedger.open(campaign);
  const registered = (id: string): string => {
    const dir = productVersionDir(root, slug, id);
    const manifest = parseJsonAs<JsonValue>(readFileSync(join(dir, PRODUCT_VERSION_FILE), "utf8"));
    if (ledger.productDigest(id) !== hashJsonValue(manifest)) {
      throw new SeedRefusal(`${dir}: version manifest does not match its ledger registration`);
    }
    return dir;
  };
  const selected = ledger.selectedProduct();
  const ids = new Set([...ledger.recordedProducts(), ...(selected === null ? [] : [selected])]);
  return {
    selected: selected === null ? fallback : registered(selected),
    history: [fallback, ...[...ids].map(registered)],
  };
}

/** Distinct recorded runs across the campaign's product history. */
function historyRows(root: string, slug: string): number {
  const runs = new Set<string>();
  for (const dir of recordedProducts(root, slug).history) {
    if (existsSync(join(dir, "runs"))) for (const runId of readdirSync(join(dir, "runs"))) runs.add(runId);
  }
  return runs.size;
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
  const path = join(manifest.campaign, SEED_MANIFEST);
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
  const sourceDomain = defaultProductDir(fromRoot, slug);
  const domain = defaultProductDir(intoRoot, slug);
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
  const audit = auditSeed(campaign, fromRoot, immutable, pinned, { aliases });
  if (existsSync(domain)) {
    const domainAudit = auditSeed(domain, fromRoot, [], pinned, { aliases });
    audit.escapes.push(...domainAudit.escapes);
    audit.toolTreeLinks.push(...domainAudit.toolTreeLinks);
    audit.external.push(...domainAudit.external);
    audit.absoluteRefs.push(...domainAudit.absoluteRefs);
    audit.unscanned.push(...domainAudit.unscanned);
  }
  if (options.relocate === true) {
    relocateRefs(audit, rootRewrites(audit, fromRoot, intoRoot));
    audit.relocated = true;
    relinkIntoCopies(audit, [
      { from: realpathSync(sourceCampaign), to: realpathSync(campaign) },
      ...(existsSync(domain) ? [{ from: realpathSync(sourceDomain), to: realpathSync(domain) }] : []),
    ]);
  }
  refuseOnAudit(audit, options);
  const product = recordedProducts(intoRoot, slug).selected;
  const manifest: SeedManifest = {
    schema: "simulation-seed/v1",
    mode: "clone",
    fromRoot,
    slug,
    asSlug: null,
    intoRoot,
    campaign,
    selectedProductId: productId,
    fingerprintBefore: fingerprintOf(recordedProducts(fromRoot, slug).selected, slug),
    fingerprintAfter: fingerprintOf(product, slug),
    ...digestTree(campaign),
    lockRemoved,
    droppedScratch,
    audit,
    toolTreeSource: null,
    notesNotCarried: null,
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
 *  pointed inside the source tool tree so the copy is self-contained. Returns the source tool tree. */
function stageSeed(sourceProduct: string, seed: string, toolTree: string | null): string | null {
  mkdirSync(seed, { recursive: true });
  for (const part of ["agent", "correctness-model"]) clone(join(sourceProduct, part), join(seed, part));
  const conformance = join(sourceProduct, CONFORMANCE_FILE);
  if (existsSync(conformance)) cpSync(conformance, join(seed, CONFORMANCE_FILE));
  if (toolTree === null) return null;
  const copy = join(seed, TOOL_TREE);
  clone(toolTree, copy);
  for (const path of entries(copy)) {
    if (!lstatSync(path).isSymbolicLink()) continue;
    const { target, resolved } = resolvedLinkTarget(path);
    if (!isAbsolute(target) || !inside(toolTree, resolved)) continue;
    rmSync(path);
    symlinkSync(relative(dirname(path), join(copy, relative(toolTree, resolved))) || ".", path);
  }
  return toolTree;
}

/** The rewrites a republish applies, most specific first: the source tool tree under each spelling
 *  (the manifest's, its real path, and the run root's when `campaigns/` is a link) becomes the seed's
 *  own tool tree, the spelling production's workspace copy moves next; the source campaign under
 *  either spelling becomes the new campaign; the source root becomes the destination root. */
function republishRewrites(
  toolTree: string | null,
  sourceCampaign: string,
  campaign: string,
  audit: SeedAudit,
  { fromRoot, intoRoot }: { fromRoot: string; intoRoot: string },
): SeedAlias[] {
  const realCampaign = realpathSync(sourceCampaign);
  const tools: SeedAlias[] = [];
  if (toolTree !== null && existsSync(toolTree)) {
    const to = realpathSync(join(campaign, "seed", TOOL_TREE));
    const real = realpathSync(toolTree);
    const spellings = new Set([toolTree, real]);
    if (inside(realCampaign, real)) spellings.add(join(sourceCampaign, relative(realCampaign, real)));
    tools.push(...[...spellings].map((from) => ({ from, to })));
  }
  return [
    ...tools,
    { from: realCampaign, to: campaign },
    { from: sourceCampaign, to: campaign },
    ...rootRewrites({ ...audit, aliases: [] }, fromRoot, intoRoot),
  ];
}

function carryHistory(
  fromRoot: string,
  slug: string,
  intoRoot: string,
  asSlug: string,
  version: string,
): SeedManifest["carried"] {
  for (const dir of recordedProducts(fromRoot, slug).history) {
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

/** The source's current epoch notes. A republished campaign opens its first epoch with nothing to
 *  supersede, so production's `carryMemoryForward` has no predecessor to carry from; carrying the
 *  controller's epoch record by hand would let a pass-less build on the same ask land in a copied
 *  epoch with no workspace. The seed reports the delta instead. */
function currentNotes(sourceCampaign: string): SeedManifest["notesNotCarried"] {
  const epoch = readEpochRecord(sourceCampaign)?.current;
  if (epoch === undefined) return null;
  const files = HANDOVER_FILES.flatMap((file) => {
    const size = statSync(join(sourceCampaign, epoch, WORKSPACE_DIR, file), { throwIfNoEntry: false })?.size;
    return size === undefined ? [] : [{ file, bytes: size }];
  });
  return { epoch, files };
}

/** Republish the selected product of `campaigns/<slug>` as a fresh product under `asSlug`. */
export function republishAsSlug(
  fromRoot: string,
  slug: string,
  asSlug: string,
  intoRoot: string,
  options: SeedOptions = {},
): SeedManifest {
  const sourceProduct = recordedProducts(fromRoot, slug).selected;
  if (!existsSync(sourceProduct)) throw new SeedRefusal(`${sourceProduct} does not exist`);
  const campaign = campaignDir(intoRoot, asSlug);
  requireAbsent(campaign);
  const productId = options.productId ?? `seed-${selectedProductId(campaignDir(fromRoot, slug)) ?? "domain"}`;
  const seed = join(campaign, "seed");
  const sourceCampaign = campaignDir(fromRoot, slug);
  const sourceTools = productToolTree(sourceProduct);
  const recordedTree = usableToolTree(sourceTools);
  const toolTree = stageSeed(
    sourceProduct,
    seed,
    options.toolTree === undefined ? recordedTree : realpathSync(options.toolTree),
  );
  const aliases = aliasOf(sourceCampaign, campaign);
  const audit = auditSeed(seed, fromRoot, [], [], { aliases });
  // The owned tool tree moves by rule: it is outside the fingerprint, and a build cache there names
  // the source by the thousand. The product's own bytes move only on request.
  const ownTools = join(realpathSync(seed), TOOL_TREE);
  relocateRefs(
    audit,
    republishRewrites(toolTree, sourceCampaign, campaign, audit, { fromRoot, intoRoot }),
    (row) => options.relocate === true || inside(ownTools, row.path),
  );
  audit.relocated = options.relocate === true;
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
  // The seed was audited above; the rest of the campaign is what publication and history added.
  const after = auditSeed(campaign, fromRoot, [version], [], { aliases, skip: ["seed"] });
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
      external: [...audit.external, ...after.external],
      absoluteRefs: [...audit.absoluteRefs, ...after.absoluteRefs],
      unscanned: [...audit.unscanned, ...after.unscanned],
    },
    toolTreeSource: {
      recorded: sourceTools.recorded ?? sourceTools.link,
      present: recordedTree !== null,
      staged: toolTree,
    },
    notesNotCarried: currentNotes(sourceCampaign),
    carried,
  };
  writeManifest(manifest);
  return manifest;
}

const absolute = absoluteOption(die);

/** What a republish could not seed, said beside the summary rather than left in seed.json. */
function warnings(manifest: SeedManifest): string[] {
  const lines: string[] = [];
  const tools = manifest.toolTreeSource;
  if (tools !== null && !tools.present) {
    lines.push(
      tools.staged === null
        ? `warning: the recorded tool tree ${tools.recorded ?? "(none)"} is gone, so the seed has none; tool-tree.mts lists the family's trees, and --tool-tree <tree> seeds one of them`
        : `note: the recorded tool tree ${tools.recorded ?? "(none)"} is gone; seeded ${tools.staged} instead`,
    );
  }
  const notes = manifest.notesNotCarried;
  if (notes !== null && notes.files.length > 0) {
    const files = notes.files.map(({ file, bytes }) => `${file} ${bytes} B`).join(", ");
    lines.push(`note: ${notes.epoch}'s ${files} are not carried; the Builder opens on the starters`);
  }
  if (manifest.audit.unscanned.length > 0) {
    lines.push(
      `warning: ${manifest.audit.unscanned.length} text files above 64 MiB were not scanned (audit.unscanned)`,
    );
  }
  return lines;
}

function summary(manifest: SeedManifest): string {
  const { audit } = manifest;
  const moved = audit.absoluteRefs.filter((row) => row.sha256After !== null).length;
  return (
    `seeded ${manifest.mode} ${manifest.slug}${manifest.asSlug === null ? "" : ` as ${manifest.asSlug}`} into ${manifest.campaign}: ` +
    `${manifest.files} files, product ${manifest.selectedProductId ?? "none"}, history ${manifest.carried.historyRuns}/${manifest.carried.sourceHistoryRuns}, ` +
    `escapes ${audit.escapes.length}, relinked ${audit.relinked.length}, absolute refs ${audit.absoluteRefs.length} (${moved} relocated)` +
    `${audit.relocated ? " --relocate" : ""}, unscanned ${audit.unscanned.length}`
  );
}

/** `--tool-tree`: an existing absolute tree, and only for a republish, which is what stages one. */
function toolTreeOption(value: string | undefined, mode: SeedManifest["mode"]): string | undefined {
  if (value === undefined) return undefined;
  if (mode === "clone") die("--tool-tree needs --as-slug: a clone copies the campaign's own trees");
  const tree = absolute("tool-tree", value);
  if (!existsSync(tree)) die(`--tool-tree ${tree} does not exist`);
  return tree;
}

function main(argv: readonly string[]): void {
  const parsed = parseOrDie(
    die,
    {
      values: ["from-root", "slug", "into-root", "as-slug", "product-id", "tool-tree"],
      flags: ["allow-absolute-refs", "relocate", "json"],
    },
    argv,
  );
  const { single, flags } = parsed;
  const fromRoot = absolute("from-root", single.get("from-root") ?? die("--from-root is required"));
  const slug = single.get("slug") ?? die("--slug is required");
  const asSlugs = single
    .get("as-slug")
    ?.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const intoRootFlag = single.get("into-root");
  if (intoRootFlag === undefined && asSlugs === undefined) {
    die("--into-root (clone) or --as-slug (republish) is required");
  }
  if (asSlugs?.length === 0) die("--as-slug names no slug");
  const intoRoot = intoRootFlag === undefined ? REPO_ROOT : absolute("into-root", intoRootFlag);
  const options: SeedOptions = {
    allowAbsoluteRefs: flags.has("allow-absolute-refs"),
    relocate: flags.has("relocate"),
    ...keyIfDefined("productId", single.get("product-id")),
    ...keyIfDefined(
      "toolTree",
      toolTreeOption(single.get("tool-tree"), asSlugs === undefined ? "clone" : "republish"),
    ),
  };
  const manifests: SeedManifest[] = [];
  try {
    // One arm per slug from the same recorded position; an arm that refuses stops the rest, and
    // the arms already seeded stay as they are.
    for (const asSlug of asSlugs ?? [null]) {
      const manifest =
        asSlug === null
          ? seedCampaignInto(fromRoot, slug, intoRoot, options)
          : republishAsSlug(fromRoot, slug, asSlug, intoRoot, options);
      manifests.push(manifest);
      if (!flags.has("json")) console.log([summary(manifest), ...warnings(manifest)].join("\n"));
    }
  } catch (error) {
    if (!(error instanceof SeedRefusal)) throw error;
    die(error.message, 1);
  }
  if (flags.has("json")) {
    console.log(JSON.stringify(manifests.length === 1 ? manifests[0] : manifests, null, 2));
  }
}

if (import.meta.main) main(Bun.argv.slice(2));

/** Product files stay at one retained address. SQLite owns which complete version is selected. */
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { campaignDir, defaultProductDir } from "../meta/campaign-root.ts";
import { basename, dirname, join, normalize, relative } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { isRecord, type JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { bundleSnapshotToolTree, linkWorkspaceToolTree } from "../claim/bundle-snapshot.ts";
import { verifyTree } from "../claim/bundle-snapshot-verify.ts";
import { type FingerprintEvidence } from "../claim/fingerprint.ts";
import { CLAIM_STAGES_FILE, advanceClaimStage } from "./claim-stages.ts";
import { ControllerLedger, controllerLedgerExists, fsyncPath } from "./controller-ledger.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";
import { portableToolTreeDigest } from "../verify/tool-inventory.ts";

export const PRODUCT_VERSION_SCHEMA = "product-version/v2";
/** The manifest at the root of each retained version directory, registered in the ledger by digest. */
export const PRODUCT_VERSION_FILE = "version.json";

type ProductManifest = {
  schema: typeof PRODUCT_VERSION_SCHEMA;
  id: string;
  fingerprint: FingerprintEvidence;
  /** Where the version's `.toolchain` link resolved at publication, or null. */
  toolTree: string | null;
  /** `portableToolTreeDigest` of that tree at publication, or null. The link reaches an epoch
   *  workspace, so the path alone cannot say whether the bytes behind it are still these. */
  treeDigest: string | null;
};

/** Campaign collections may be operator links; campaign children must be direct directories. */
function directDestination(path: string, campaign: string): void {
  let current = normalize(path);
  const boundary = normalize(dirname(campaign));
  while (current !== boundary) {
    try {
      if (!lstatSync(current).isDirectory()) {
        throw new Error(`${current}: product storage requires a direct directory`);
      }
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`${path}: product path is outside its campaign`);
    current = parent;
  }
}

/** Where a version's bytes live. A climb or rebuild generation is built and measured here before
 * the promotion decision; callers never invent a second candidate location. */
export function productVersionDir(repoRoot: string, slug: string, id: string): string {
  if (!isSafePathSegment(slug) || !isSafePathSegment(id)) {
    throw new Error("product version requires safe campaign and version identities");
  }
  const campaign = campaignDir(repoRoot, slug);
  const path = join(campaign, "versions", id);
  directDestination(path, campaign);
  return path;
}

/** Sync every product file before the reference can commit. The tool tree is not among them: the
 * manifest binds its path and digest, not a frozen copy of it. */
function durableProductTree(path: string): void {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) durableProductTree(join(path, entry));
    fsyncPath(path);
  } else if (stat.isFile() && stat.nlink === 1) {
    chmodSync(path, 0o444);
    fsyncPath(path);
  } else throw new Error(`${path}: product files must be direct regular files or directories`);
}

function manifestAt(dir: string): ProductManifest {
  const file = join(dir, PRODUCT_VERSION_FILE);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) {
    throw new Error(`${file}: version manifest must be a direct regular file`);
  }
  return parseJsonAs<ProductManifest>(readFileSync(file, "utf8"));
}

/** A retained version another source recorded, intact and registered but in a manifest shape this
 *  source keeps no reader for. It is typed so the controller can stop the run with its own clause
 *  before any round, instead of the version reading as missing or altered. */
export class ProductVersionFromAnotherSource extends Error {
  readonly kind = "product-version-from-another-source" as const;

  constructor(dir: string, recorded: JsonValue) {
    super(
      `${dir}: recorded as ${capturedJsonStringify(recorded)} by another source; this source reads ${PRODUCT_VERSION_SCHEMA} only, so this project cannot continue here: start a fresh project`,
    );
    this.name = "ProductVersionFromAnotherSource";
  }
}

export function readProductVersion(repoRoot: string, slug: string, id: string): string {
  const dir = productVersionDir(repoRoot, slug, id);
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  const manifest = manifestAt(dir);
  // Only bytes the ledger registered were recorded by some source. A manifest in another schema
  // that the ledger does not name is damage like any other edit, and is refused as damage.
  const registered = ledger.productDigest(id) === hashJsonValue(manifest);
  if (registered && manifest.schema !== PRODUCT_VERSION_SCHEMA) {
    throw new ProductVersionFromAnotherSource(dir, manifest.schema);
  }
  if (!registered || manifest.id !== id || manifest.fingerprint.slug !== slug) {
    throw new Error(`${dir}: product version is missing, altered, or unregistered`);
  }
  for (const part of ["agent", "correctness-model"]) {
    directDestination(join(dir, part), campaignDir(repoRoot, slug));
  }
  verifyTree(dir, manifest.fingerprint, "retained product version");
  // A retained version links its tool tree into an epoch workspace, and those bytes sit outside
  // the fingerprint by design, at hundreds of megabytes an epoch. An operator reclaiming that
  // space leaves the link unresolvable, and the equality below then refused every retained version
  // of the campaign, history and selection alike, though the product's own bytes are untouched and
  // verifyTree above proves it. So a tree that resolves nowhere reads as null here, and a tree that
  // resolves somewhere else is still a changed reference and refused. Whether the tree still holds
  // its published bytes is `bindProductMeasurement`'s question, asked where a battery runs them.
  const toolTree = bundleSnapshotToolTree(dir);
  if (toolTree !== null && toolTree !== manifest.toolTree) {
    throw new Error(`${dir}: product tool-tree reference changed`);
  }
  return dir;
}

/** `portableToolTreeDigest` of the tool tree `dir` resolves, or null where none resolves. */
function toolTreeDigestAt(dir: string): string | null {
  const tree = bundleSnapshotToolTree(dir);
  return tree === null ? null : portableToolTreeDigest(tree);
}

/** Publish immutable product bytes before registering their manifest. Unreferenced output from
 * an interrupted publication stays available for inspection; adoption never cleans it up. */
export function publishProductVersion(input: {
  repoRoot: string;
  slug: string;
  id: string;
  acceptedSnapshot: string;
  fingerprint: FingerprintEvidence;
  conformancePath?: string;
}): string {
  const { repoRoot, slug, id, acceptedSnapshot, fingerprint } = input;
  const dir = productVersionDir(repoRoot, slug, id);
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  if (ledger.productDigest(id) !== null) {
    const existing = readProductVersion(repoRoot, slug, id);
    verifyTree(existing, fingerprint, "replayed accepted product");
    if (bundleSnapshotToolTree(acceptedSnapshot) !== bundleSnapshotToolTree(existing)) {
      throw new Error(`${dir}: replay names a different tool tree`);
    }
    return existing;
  }
  if (existsSync(dir)) throw new Error(`${dir}: unregistered publication retained for review`);
  verifyTree(acceptedSnapshot, fingerprint, "accepted product");
  const versions = dirname(dir);
  mkdirSync(versions, { recursive: true });
  const staging = join(versions, `.incoming-${crypto.randomUUID()}`);
  mkdirSync(staging);
  for (const part of ["agent", "correctness-model"]) {
    cpSync(join(acceptedSnapshot, part), join(staging, part), { recursive: true });
    durableProductTree(join(staging, part));
  }
  verifyTree(staging, fingerprint, "published product");
  linkWorkspaceToolTree(acceptedSnapshot, staging);
  if (input.conformancePath !== undefined) cpSync(input.conformancePath, join(staging, CONFORMANCE_FILE));
  advanceClaimStage(
    staging,
    "build-admissible",
    relative(repoRoot, input.conformancePath ?? acceptedSnapshot),
    slug,
  );
  const manifest: ProductManifest = {
    schema: PRODUCT_VERSION_SCHEMA,
    id,
    fingerprint,
    toolTree: bundleSnapshotToolTree(staging),
    treeDigest: toolTreeDigestAt(staging),
  };
  writeFileSync(join(staging, PRODUCT_VERSION_FILE), capturedJsonStringify(manifest));
  for (const file of [
    PRODUCT_VERSION_FILE,
    CLAIM_STAGES_FILE,
    ...(input.conformancePath === undefined ? [] : [CONFORMANCE_FILE]),
  ]) {
    fsyncPath(join(staging, file));
  }
  fsyncPath(staging);
  renameSync(staging, dir);
  fsyncPath(versions);
  fsyncPath(dirname(versions));
  ledger.registerProduct(id, hashJsonValue(manifest));
  return dir;
}

/** Historical domain layouts stay readable. New controller publication selects a retained
 * version explicitly, and any corrupt selected reference refuses instead of falling back. */
export function selectedProductDir(repoRoot: string, slug: string): string {
  const campaign = campaignDir(repoRoot, slug);
  if (controllerLedgerExists(campaign)) {
    using ledger = ControllerLedger.open(campaign);
    const id = ledger.selectedProduct();
    if (id !== null) return readProductVersion(repoRoot, slug, id);
  }
  return defaultProductDir(repoRoot, slug);
}

/** Whether the battery `runId` measured the version `selectedProductDir` resolves to. The ledger
 *  binds each measured battery to its product version, and a `reused` round binds a later runId to
 *  the same selected version, so the question is the ledger's and never `runId === versionId`.
 *  Null where the answer is unknown rather than "no": a campaign the controller never opened has
 *  no ledger, a campaign before its first selection has no row, and a battery the ledger never
 *  bound has no version. Each leaves the comparison unmade instead of reporting a difference. */
export function measuredSelectedProduct(repoRoot: string, slug: string, runId: string): boolean | null {
  const campaign = campaignDir(repoRoot, slug);
  if (!controllerLedgerExists(campaign)) return null;
  using ledger = ControllerLedger.open(campaign);
  const selected = ledger.selectedProduct();
  const measured = ledger.measuredProduct(runId);
  return selected === null || measured === null ? null : measured === selected;
}

export function selectInitialProduct(repoRoot: string, slug: string, id: string): void {
  readProductVersion(repoRoot, slug, id);
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  if (ledger.selectedProduct() !== null) return;
  ledger.recordProductDecision({
    id: `initial-${id}`,
    version: id,
    previous: null,
    adopt: true,
    evidence: capturedJsonStringify({ schema: "initial-product/v1", id }),
    admission: null,
  });
}

/** Retained versions supply history without copying old runs into each new product. Held versions
 *  are in it too: their batteries were measured, and whether a measured battery is difficulty
 *  evidence is `admitBattery`'s decision, not this reader's. So is `domainDir` itself: its
 *  decision row lands at promotion, after the review of its own battery has read this history. */
export function productHistoryDirs(domainDir: string): string[] {
  if (basename(dirname(domainDir)) !== "versions") return [domainDir];
  const campaign = dirname(dirname(domainDir));
  const slug = basename(campaign);
  const repoRoot = dirname(dirname(campaign));
  using ledger = ControllerLedger.open(campaign);
  return [
    defaultProductDir(repoRoot, slug),
    ...[...new Set([...ledger.recordedProducts(), basename(domainDir)])].map((id) =>
      readProductVersion(repoRoot, slug, id),
    ),
  ];
}

/** The id of the retained version `dir` is, once `dir` is proved to be that version's exact path
 *  (refused with `refusal` otherwise) and its registered bytes are read back intact. */
export function readRetainedVersion(repoRoot: string, slug: string, dir: string, refusal: string): string {
  const id = basename(dir);
  if (normalize(dir) !== normalize(productVersionDir(repoRoot, slug, id))) throw new Error(refusal);
  readProductVersion(repoRoot, slug, id);
  return id;
}

/** Bind battery `runId` to the retained version at `dir`, once its tool tree is proved to hold the
 *  bytes it was published with. The version reaches that tree through a link into an epoch
 *  workspace, and the verifier host checks a tree only against the digest this battery resolves, so
 *  a tree edited or reclaimed since publication would be measured, and attributed to this version,
 *  with nothing comparing it to the tree the version was published with. Reading history needs no
 *  such proof; a battery does, and this is where one starts. */
export function bindProductMeasurement(repoRoot: string, slug: string, runId: string, dir: string): void {
  const id = readRetainedVersion(
    repoRoot,
    slug,
    dir,
    "measurement requires an exact retained product version",
  );
  if (toolTreeDigestAt(dir) !== manifestAt(dir).treeDigest) {
    throw new Error(
      `${dir}: product tool tree changed since publication; a battery would measure other tools`,
    );
  }
  using ledger = ControllerLedger.open(campaignDir(repoRoot, slug));
  ledger.bindMeasurement(runId, id);
}

/** Which retained version a recorded battery measured, in the same namespace as
 *  `selectedProductId`, for a caller that must say whether some battery measured the tree it is
 *  looking at. Null where the answer is unknown rather than "no": a campaign the controller never
 *  opened has no ledger, and a battery the ledger never bound has no row. */
export function measuredProductId(repoRoot: string, slug: string, runId: string): string | null {
  const campaign = campaignDir(repoRoot, slug);
  if (!controllerLedgerExists(campaign)) return null;
  using ledger = ControllerLedger.open(campaign);
  return ledger.measuredProduct(runId);
}

export function measuredProductDir(repoRoot: string, slug: string, runId: string): string | null {
  const id = measuredProductId(repoRoot, slug, runId);
  return id === null ? null : readProductVersion(repoRoot, slug, id);
}

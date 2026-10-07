/**
 * Where a campaign's selected product keeps its tool tree, whether that tree still resolves, and
 * which trees in the same campaign family could stand in for it, so a steward learns before the
 * live call that the Builder would open on an empty `.toolchain`.
 *
 * On 2026-09-30 truss campaign -29's recorded tree had been swept at 01:38, so its versions record a
 * `toolTree` in `version.json` that no longer exists and carry no `.toolchain` link; the one truss
 * tree left on the machine was an epoch of campaign -30. A condition seeded from -29 had no tools,
 * and the steward found that out from the Builder reinstalling them.
 *
 *   bun .claude/skills/system-path-simulation/scripts/tool-tree.mts --campaign /abs/campaigns/<slug> \
 *     [--search /abs/campaigns]... [--digest] [--json]
 *
 * Reads only. The family is the slug without its `-<n>` run number (a republished condition's is its
 * `seed.json` source's); it is searched in `--search` directories, or by default in every
 * `<dir>/campaigns` beside the campaign's checkout, once per real path. A candidate is an existing
 * epoch workspace tree, a seed tree or a version's recorded tree. `--digest` reads every byte of
 * each candidate for its portable digest, and only a candidate whose digest matches the product's
 * recorded `treeDigest` lets a battery bind after it is copied back to the recorded path; any other
 * seeds a republish through `seed-campaign.mts --tool-tree <tree>`.
 */
import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "#src/meta/filesystem.ts";
import { basename, dirname, isAbsolute, join } from "#src/meta/path.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { bundleSnapshotToolTree } from "#src/claim/bundle-snapshot.ts";
import { PRODUCT_VERSION_FILE, selectedProductDir } from "#src/run/product-versions.ts";
import { campaignRoot } from "#src/meta/campaign-root.ts";
import { portableToolTreeDigest } from "#src/verify/tool-inventory.ts";
import { runCommand } from "#skills/main/cli.ts";
import { mainCheckout } from "#tools/runs/discover.ts";
import { collectRows } from "#tools/runs/rows.ts";

const TOOL_TREE = ".toolchain";
/** The manifest `seed-campaign.mts` writes into each campaign it seeds. */
export const SEED_MANIFEST = "seed.json";
const RUN_NUMBER = /-[0-9]+$/;

/** A product's tool tree as its publication recorded it and as its link resolves now. */
export interface ProductToolTree {
  product: string;
  /** `version.json`'s `toolTree`: where the link resolved at publication. */
  recorded: string | null;
  /** `version.json`'s `treeDigest`: the portable digest a battery re-checks before it binds. */
  treeDigest: string | null;
  /** The `.toolchain` link's own text, or null where the link is gone. */
  link: string | null;
  /** Where the link resolves now, or null where it resolves nowhere. */
  resolved: string | null;
}

/** The fields this script reads from a `version.json` or a `seed.json`, unchecked until read. */
interface RecordedFields {
  toolTree?: unknown;
  treeDigest?: unknown;
  slug?: unknown;
}

export interface ToolTreeReport {
  campaign: string;
  family: string;
  selected: (ProductToolTree & { present: boolean; bytes: number | null }) | null;
  candidates: FamilyTree[];
}

export interface FamilyTree {
  path: string;
  campaign: string;
  modified: string;
  bytes: number | null;
  /** Whether a run that is not closed holds this tree's campaign; null where that is unknown. */
  live: boolean | null;
  /** Set only under `--digest`: whether the portable digest equals the product's recorded one. */
  digestMatches?: boolean;
}

function readRecord(path: string): RecordedFields {
  return asRecord(readJsonFileOrNull(path)) ?? {};
}

/** The tool tree `product` recorded at publication and the one its link reaches now. */
export function productToolTree(product: string): ProductToolTree {
  const { toolTree, treeDigest } = readRecord(join(product, PRODUCT_VERSION_FILE));
  const link = join(product, TOOL_TREE);
  return {
    product,
    recorded: isString(toolTree) ? toolTree : null,
    treeDigest: isString(treeDigest) ? treeDigest : null,
    link: lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true ? readlinkSync(link) : null,
    resolved: bundleSnapshotToolTree(product),
  };
}

/** The tree a copy of `product` can take: the one its link reaches, else the recorded one where it
 *  still exists though the link is gone; null when neither is there. */
export function usableToolTree(tree: ProductToolTree): string | null {
  if (tree.resolved !== null) return tree.resolved;
  return tree.recorded !== null && isDirectory(tree.recorded) ? realpathSync(tree.recorded) : null;
}

/** The campaign family a slug belongs to: the source's slug for a seeded condition, without the
 *  `-<n>` run number a launch appends. */
export function familyOf(campaign: string): string {
  const { slug } = readRecord(join(campaign, SEED_MANIFEST));
  return (isString(slug) ? slug : basename(campaign)).replace(RUN_NUMBER, "");
}

function childDirs(dir: string): string[] {
  try {
    return readdirSync(dir).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The campaign root of `root` and of every directory beside it, once per real path, `root`'s first.
 *  A plain file beside it is skipped first: a stat through `notes.md/campaigns` throws ENOTDIR,
 *  which `throwIfNoEntry` does not cover. */
export function siblingCampaignRoots(root: string): string[] {
  const roots = [root, ...childDirs(dirname(root)).filter(isDirectory)].flatMap((dir) => {
    const campaigns = campaignRoot(dir);
    return isDirectory(campaigns) ? [realpathSync(campaigns)] : [];
  });
  return [...new Set(roots)];
}

/** Every existing tool tree a campaign holds: its epochs' workspace trees, its seed tree and the
 *  trees its versions recorded. */
function campaignTrees(campaign: string): string[] {
  const trees = [
    ...childDirs(campaign).flatMap((dir) =>
      basename(dir).startsWith("epoch-") ? [join(dir, "workspace", TOOL_TREE)] : [],
    ),
    join(campaign, "seed", TOOL_TREE),
    ...childDirs(join(campaign, "versions")).flatMap((version) => productToolTree(version).recorded ?? []),
  ];
  return trees.flatMap((tree) => (isDirectory(tree) ? [realpathSync(tree)] : []));
}

/** Apparent size in bytes, from `du`, or null where it cannot say. */
function treeBytes(path: string): number | null {
  const result = runSync(["du", "-sk", path], { env: Bun.env });
  const kib = Number.parseInt(decodeOutput(result.stdout).split("\t")[0] ?? "", 10);
  return result.exitCode === 0 && Number.isFinite(kib) ? kib * 1024 : null;
}

/** The slugs an open run holds in `root`'s checkout, or null where `root` is not in one. */
export function openSlugs(root: string): Set<string> | null {
  try {
    const rows = collectRows(mainCheckout(root), { closedLimit: 0 });
    return new Set(rows.filter((row) => row.liveness.state !== "closed").map((row) => row.slug));
  } catch {
    return null;
  }
}

/** The family's existing trees across `roots`, newest first, once per real path. */
export function familyTrees(
  family: string,
  roots: readonly string[],
  live: ReadonlySet<string> | null,
  recordedDigest: string | null = null,
): FamilyTree[] {
  const seen = new Map<string, FamilyTree>();
  for (const campaign of roots.flatMap(childDirs)) {
    const slug = basename(campaign);
    if (slug.replace(RUN_NUMBER, "") !== family) continue;
    for (const path of campaignTrees(campaign)) {
      if (seen.has(path)) continue;
      const tree: FamilyTree = {
        path,
        campaign,
        modified: statSync(path).mtime.toISOString(),
        bytes: treeBytes(path),
        live: live === null ? null : live.has(slug),
      };
      if (recordedDigest !== null) tree.digestMatches = portableToolTreeDigest(path) === recordedDigest;
      seen.set(path, tree);
    }
  }
  return [...seen.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

/** The selected product's tree with its size, or null where the campaign has no selected product. */
function selectedTree(campaign: string): ToolTreeReport["selected"] {
  try {
    const tree = productToolTree(selectedProductDir(dirname(dirname(campaign)), basename(campaign)));
    const usable = usableToolTree(tree);
    return { ...tree, present: usable !== null, bytes: usable === null ? null : treeBytes(usable) };
  } catch {
    return null;
  }
}

export function toolTreeReport(
  campaign: string,
  roots: readonly string[],
  live: ReadonlySet<string> | null,
  { digest }: { digest: boolean },
): ToolTreeReport {
  const selected = selectedTree(campaign);
  const family = familyOf(campaign);
  const recordedDigest = digest ? (selected?.treeDigest ?? null) : null;
  return { campaign, family, selected, candidates: familyTrees(family, roots, live, recordedDigest) };
}

const mib = (bytes: number | null) => (bytes === null ? "?" : `${(bytes / 2 ** 20).toFixed(0)} MiB`);

function candidateLine(tree: FamilyTree): string {
  const marks = [
    tree.live === true ? "live run" : null,
    tree.digestMatches === undefined ? null : tree.digestMatches ? "digest matches" : "digest differs",
  ].filter(isString);
  return `  ${tree.path}  ${tree.modified.slice(0, 16)}  ${mib(tree.bytes)}${marks.length > 0 ? `  [${marks.join(", ")}]` : ""}`;
}

function selectedLines(selected: ToolTreeReport["selected"]): string[] {
  if (selected === null) return ["product    none selected"];
  return [
    `product    ${selected.product}`,
    `recorded   ${selected.recorded ?? "(none)"}${selected.treeDigest === null ? "" : `  digest ${selected.treeDigest.slice(0, 12)}`}`,
    `link       ${selected.link === null ? "(gone)" : `${TOOL_TREE} -> ${selected.link}`}`,
    `tool tree  ${selected.present ? `present, ${mib(selected.bytes)}` : "GONE: the Builder opens on an empty .toolchain"}`,
  ];
}

/** What to run next with the newest candidate no open run is writing into. */
function nextLines(report: ToolTreeReport): string[] {
  const pick = report.candidates.find((tree) => tree.live !== true) ?? report.candidates[0];
  if (report.selected?.present !== false || pick === undefined) return [];
  const lines = [`next: seed-campaign.mts ... --as-slug <arm> --tool-tree ${pick.path}`];
  if (report.selected.recorded !== null && pick.digestMatches === true) {
    lines.push(`      or restore in place: cp -c -R ${pick.path} ${report.selected.recorded}`);
  }
  return lines;
}

export function renderToolTreeReport(report: ToolTreeReport): string {
  return [
    `campaign   ${report.campaign}`,
    ...selectedLines(report.selected),
    `family     ${report.family}: ${report.candidates.length} existing trees`,
    ...report.candidates.map(candidateLine),
    ...nextLines(report),
  ].join("\n");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "tool-tree",
      usage:
        "usage: tool-tree.mts --campaign /abs/campaigns/<slug> [--search /abs/campaigns]... [--digest] [--json]",
      options: { campaign: "abs", search: "list", digest: "flag", json: "flag" },
    },
    (args) => {
      const campaign = args.required("campaign");
      if (!isDirectory(campaign)) args.die(`--campaign ${campaign} does not exist`);
      const repoRoot = dirname(dirname(campaign));
      const search = args.list("search");
      for (const dir of search) if (!isAbsolute(dir)) args.die(`--search must be an absolute path: ${dir}`);
      const roots = search.length > 0 ? search : siblingCampaignRoots(repoRoot);
      const report = toolTreeReport(campaign, roots, openSlugs(repoRoot), { digest: args.flag("digest") });
      console.log(args.flag("json") ? JSON.stringify(report, null, 2) : renderToolTreeReport(report));
    },
  );
}

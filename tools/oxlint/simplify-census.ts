// The simplify census: the whole-tree scans of `tree-findings.ts`, the shapes `/simplify` kept
// finding that relate two files and so no per-file rule can see, grouped by shape and largest
// first, each argument printed once above its sites. Nothing here gates: a person reads a group,
// decides it as a group, and fixes it in one go.
//
// Every per-file shape the census once staged now gates from `.oxlintrc.json` (since 20 September),
// so the oxlint pass it ran under an empty rule set went on 27 October with the scans' rewrite.

import { runtimeProcess } from "../../src/meta/process.ts";
import { TREE_FINDING_ARGUMENTS, TREE_REGISTER_KINDS, treeFindings, type TreeSite } from "./tree-findings.ts";

/** Sites listed under each shape before the rest are counted, unless `--all` is passed. */
const DEFAULT_SITES = 8;
const WRAP = 96;

/** A message broken at spaces to the terminal width, each line indented. */
function wrapped(text: string): string {
  const lines = [""];
  for (const word of text.split(/\s+/u)) {
    const last = lines.at(-1) ?? "";
    if (last !== "" && last.length + word.length + 1 > WRAP) lines.push(word);
    else lines[lines.length - 1] = last === "" ? word : `${last} ${word}`;
  }
  return lines.map((line) => `    ${line}`).join("\n");
}

/** One section per shape: its argument once, then its sites, the tail counted past `limit`. */
function section(kind: TreeSite["kind"], sites: readonly TreeSite[], limit: number): string {
  const shown = sites.slice(0, limit).map((site) => {
    const at = site.line === 0 ? site.path : `${site.path}:${site.line}`;
    return `    ${at}  ${site.detail} [${site.id}]`;
  });
  const rest = sites.length > limit ? [`    … and ${sites.length - limit} more`] : [];
  const count = `${sites.length} ${sites.length === 1 ? "site" : "sites"}`;
  return ["", `tree/${kind}  (${count})`, wrapped(TREE_FINDING_ARGUMENTS[kind]), "", ...shown, ...rest].join(
    "\n",
  );
}

/** One row per shape: its count and the root directories its sites sit in. */
function summaryRow(kind: string, sites: readonly TreeSite[]): string {
  const roots = Map.groupBy(sites, (site) =>
    /(?:^|\/)test\/|\.test\./u.test(site.path) ? "test" : site.path.split("/")[0],
  );
  const where = [...roots]
    .map(([root, under]) => `${root} ${under.length}`)
    .toSorted()
    .join(", ");
  return `${String(sites.length).padStart(6)}  ${where.padEnd(24)}  tree/${kind}`;
}

const argv = runtimeProcess.argv.slice(2);
const only = argv.find((argument) => !argument.startsWith("--"));
const limit = argv.includes("--all") ? Number.MAX_SAFE_INTEGER : DEFAULT_SITES;
const sites = treeFindings()
  .filter((site) => only === undefined || site.kind.includes(only))
  .toSorted((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
const groups = [...Map.groupBy(sites, (site) => site.kind)].toSorted(
  ([a, left], [b, right]) => right.length - left.length || (a < b ? -1 : 1),
);
const listed = groups.filter(([kind]) => !TREE_REGISTER_KINDS.includes(kind));
const registers = groups.filter(([kind]) => TREE_REGISTER_KINDS.includes(kind));
const total = listed.reduce((count, [, under]) => count + under.length, 0);

// `Bun.write` resolves once stdout has taken the whole string, where a stream's `write` returned
// before the bytes left and the exit cut the tail of `--all`.
await Bun.write(
  Bun.stdout,
  [
    "",
    `Simplify census: ${total} ${total === 1 ? "finding" : "findings"} across ${listed.length} shapes`,
    only === undefined ? "" : `filtered to shapes matching "${only}"`,
    "",
    `${"count".padStart(6)}  ${"where".padEnd(24)}  shape`,
    ...listed.map(([kind, under]) => summaryRow(kind, under)),
    ...listed.map(([kind, under]) => section(kind, under, limit)),
    ...(registers.length === 0
      ? []
      : [
          "",
          "Standing registers, not counted above: each row is a current count, and its rule is about",
          "the change proposed against it, so the list does not empty.",
          ...registers.map(([kind, under]) => section(kind, under, limit)),
        ]),
    "",
    limit === DEFAULT_SITES
      ? "Every site: bun run simplify -- --all. One kind: bun run simplify -- <name>."
      : "Every site is listed.",
    "Nothing here gates. Read a group, decide it as a group, then fix.",
    "",
  ].join("\n"),
);

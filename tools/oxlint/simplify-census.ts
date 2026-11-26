import { runtimeProcess } from "../../src/meta/process.ts";
import { ledgerOnDisk, staleLedgerProblems, TREE_RULE_PREFIX } from "./not-slop-ledger.ts";
import { TREE_FINDING_ARGUMENTS, type TreeSite, treeSites } from "./tree-findings.ts";

const DEFAULT_SITES = 8;
const WRAP = 96;

function wrapped(text: string): string {
  const lines = [""];
  for (const word of text.split(/\s+/u)) {
    const last = lines.at(-1) ?? "";
    if (last !== "" && last.length + word.length + 1 > WRAP) lines.push(word);
    else lines[lines.length - 1] = last === "" ? word : `${last} ${word}`;
  }
  return lines.map((line) => `    ${line}`).join("\n");
}

function section(kind: TreeSite["kind"], sites: readonly TreeSite[], limit: number): string {
  const shown = sites.slice(0, limit).map((site) => {
    const at = site.line === 0 ? site.path : `${site.path}:${String(site.line)}`;
    return `    ${at}  ${site.detail} [${site.id}]`;
  });
  const rest = sites.length > limit ? [`    … and ${String(sites.length - limit)} more`] : [];
  const count = `${String(sites.length)} ${sites.length === 1 ? "site" : "sites"}`;
  return ["", `tree/${kind}  (${count})`, wrapped(TREE_FINDING_ARGUMENTS[kind]), "", ...shown, ...rest].join(
    "\n",
  );
}

function summaryRow(kind: string, sites: readonly TreeSite[]): string {
  const roots = Map.groupBy(sites, (site) =>
    /(?:^|\/)test\/|\.test\./u.test(site.path) ? "test" : site.path.split("/")[0],
  );
  const where = [...roots]
    .map(([root, under]) => `${root} ${String(under.length)}`)
    .toSorted()
    .join(", ");
  return `${String(sites.length).padStart(6)}  ${where.padEnd(24)}  tree/${kind}`;
}

const argv = runtimeProcess.argv.slice(2);
const only = argv.find((argument) => !argument.startsWith("--"));
const limit = argv.includes("--all") ? Number.MAX_SAFE_INTEGER : DEFAULT_SITES;
const [allSites, ledger] = [treeSites(), await ledgerOnDisk()];
const answered = new Set(ledger.answers.map((answer) => answer.id));
const seen = new Set(allSites.map((site) => site.id));
const problems = staleLedgerProblems(ledger, seen, (answer) => answer.rule.startsWith(TREE_RULE_PREFIX));
const sites = allSites
  .filter((site) => !answered.has(site.id) && (only === undefined || site.kind.includes(only)))
  .toSorted((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
const groups = [...Map.groupBy(sites, (site) => site.kind)].toSorted(
  ([a, left], [b, right]) => right.length - left.length || (a < b ? -1 : 1),
);
const total = groups.reduce((count, [, under]) => count + under.length, 0);

await Bun.write(
  Bun.stdout,
  [
    "",
    `Simplify census: ${String(total)} ${total === 1 ? "finding" : "findings"} across ${String(groups.length)} shapes`,
    only === undefined ? "" : `filtered to shapes matching "${only}"`,
    ...(groups.length === 0
      ? []
      : [
          "",
          `${"count".padStart(6)}  ${"where".padEnd(24)}  shape`,
          ...groups.map(([kind, under]) => summaryRow(kind, under)),
          ...groups.map(([kind, under]) => section(kind, under, limit)),
        ]),
    ...(problems.length === 0 ? [] : ["", ...problems]),
    "",
    limit === DEFAULT_SITES
      ? "Every site: bun run simplify -- --all. One kind: bun run simplify -- <name>."
      : "Every site is listed.",
    "The gate fails while a site above stands. Read a group, decide it as a group, then fix or answer it.",
    "",
  ].join("\n"),
);
if (argv.includes("--gate") && (total > 0 || problems.length > 0)) runtimeProcess.exitCode = 1;

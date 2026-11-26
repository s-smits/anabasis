/**
 * `bun run not-slop`: answer a slop finding no, and keep the ledger to findings that still exist.
 * With no command it prints every row and each one no finding bears out; `-- answer <id> <reason…>`
 * answers a site lint, simplify or the pre-commit report printed; `-- prune` removes every row no
 * finding bears out, the failure `bun run lint` (plugin rows) and `bun run simplify -- --gate`
 * (tree rows) also enforce.
 */
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { type LintSite, oxlintDiagnostics, sitesCachePath, withSites } from "../runtime/lint.ts";
import {
  type Answer,
  formatLedger,
  type Ledger,
  ledgerOnDisk,
  NOT_SLOP_LEDGER,
  readLedger,
  TREE_RULE_PREFIX,
} from "./not-slop-ledger.ts";
import { type TreeSite, treeSites } from "./tree-findings.ts";

const COMMANDS = new Map<string, (rest: readonly string[]) => Promise<number>>([
  ["", status],
  ["answer", writeAnswer],
  ["prune", prune],
]);

const isTree = (row: Pick<Answer, "rule">): boolean => row.rule.startsWith(TREE_RULE_PREFIX);

function refuse(message: string): number {
  console.error(`not-slop: ${message}`);
  return 1;
}

function treeSite(site: TreeSite): Pick<Answer, "id" | "rule" | "path" | "excerpt"> {
  const paths = [...new Set((site.places ?? [site]).map((place) => place.path))].toSorted();
  return {
    id: site.id,
    rule: `${TREE_RULE_PREFIX}${site.kind}`,
    path: paths.join(","),
    excerpt: site.excerpt,
  };
}

async function lastLintSites(): Promise<LintSite[]> {
  const path = sitesCachePath();
  const file = path === null ? null : Bun.file(path);
  return file !== null && (await file.exists()) ? parseJsonAs<LintSite[]>(await file.text()) : [];
}

/** A tree row is judged against a fresh scan and a lint row against a fresh lint of its file; a
 *  file that is gone bears out nothing. */
async function staleAnswers(answers: readonly Answer[]): Promise<Answer[]> {
  const trees = answers.some(isTree) ? treeSites().map((site) => site.id) : [];
  const files = [...new Set(answers.flatMap((row) => (isTree(row) ? [] : [row.path])))];
  const present = await Promise.all(
    files.map(async (path) => ((await Bun.file(path).exists()) ? [path] : [])),
  );
  const linted = present.flat();
  const found =
    linted.length === 0
      ? []
      : await withSites((await oxlintDiagnostics(["--type-aware", ...linted])).diagnostics);
  const live = new Set([...trees, ...found.flatMap(({ site }) => (site === null ? [] : [site.id]))]);
  return answers.filter((row) => !live.has(row.id));
}

/** A row the ledger cannot read would be dropped by the rewrite. */
function unwritable(ledger: Ledger): string | null {
  if (ledger.unread.length === 0) return null;
  return [`${NOT_SLOP_LEDGER} has rows it cannot read; fix them first:`, ...ledger.unread].join("\n  ");
}

async function writeAnswer([id = "", ...words]: readonly string[]): Promise<number> {
  const cached = (await lastLintSites()).find((one) => one.id === id);
  const site =
    cached ??
    treeSites()
      .map(treeSite)
      .find((one) => one.id === id);
  if (site === undefined) {
    return refuse(
      `no current finding has the id "${id}": run bun run lint or bun run simplify, and answer an id it printed`,
    );
  }
  const row: Answer = {
    id,
    rule: site.rule,
    path: site.path,
    answered: new Date().toISOString().slice(0, 10),
    reason: words.join(" "),
    excerpt: site.excerpt,
  };
  const [problem] = readLedger(formatLedger([row])).unread;
  if (problem !== undefined) return refuse(problem.replace(/^line \d+: /u, ""));
  const ledger = await ledgerOnDisk();
  const blocked = unwritable(ledger);
  if (blocked !== null) return refuse(blocked);
  await Bun.write(NOT_SLOP_LEDGER, formatLedger([...ledger.answers, row]));
  console.log(`answered ${id} (${row.rule}, ${row.path}) in ${NOT_SLOP_LEDGER}`);
  return 0;
}

async function prune(): Promise<number> {
  const ledger = await ledgerOnDisk();
  const blocked = unwritable(ledger);
  if (blocked !== null) return refuse(blocked);
  const stale = new Set((await staleAnswers(ledger.answers)).map((row) => row.id));
  await Bun.write(NOT_SLOP_LEDGER, formatLedger(ledger.answers.filter((row) => !stale.has(row.id))));
  console.log(`removed ${stale.size} of ${ledger.answers.length} rows from ${NOT_SLOP_LEDGER}`);
  return 0;
}

async function status(): Promise<number> {
  const ledger = await ledgerOnDisk();
  const stale = await staleAnswers(ledger.answers);
  const trees = ledger.answers.filter(isTree).length;
  console.log(
    [
      `${ledger.answers.length} rows in ${NOT_SLOP_LEDGER}: ${trees} whole-tree, ${ledger.answers.length - trees} lint`,
      ...stale.map((row) => `  stale: ${row.id} ${row.rule} ${row.path}`),
      ...ledger.unread.map((problem) => `  unread: ${problem}`),
      ...(stale.length === 0 ? [] : ["bun run not-slop -- prune removes the stale rows."]),
    ].join("\n"),
  );
  return stale.length + ledger.unread.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const [command = "", ...rest] = runtimeProcess.argv.slice(2);
  const run = COMMANDS.get(command);
  if (run === undefined) return refuse("usage: bun run not-slop [-- answer <id> <reason…> | -- prune]");
  return run(rest);
}

if (import.meta.main) runtimeProcess.exit(await main());

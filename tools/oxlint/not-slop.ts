/**
 * `bun run not-slop`: answer a slop finding no, and keep the ledger to findings that still exist.
 *
 *     bun run not-slop                            every row, and each one no finding bears out
 *     bun run not-slop -- answer <id> <reason…>   answer a site lint, simplify or the pre-commit
 *                                                 report printed, in a reviewer's sentence
 *     bun run not-slop -- prune                   remove every row no finding bears out
 *
 * `answer` looks the id up among the last lint run's sites and the whole-tree scans, and writes
 * the row: the rule, the paths, the date, the reason and the text the id hashed. It refuses an id
 * no current finding has, a finding from a rule with a fixer or from a register, and a reason a
 * reviewer could not check. Rows were once pasted by hand from a line the report printed, and a
 * pasted row names whatever the paster typed.
 *
 * `prune` judges a tree row against a fresh scan and a lint row against a fresh lint of its file,
 * which `bun run lint` also does and fails on; this is the one command that answers that failure.
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
import { TREE_REGISTER_KINDS, type TreeSite, treeSites } from "./tree-findings.ts";

/** Each command, by the word that names it; none is the status. */
const COMMANDS = new Map<string, (rest: readonly string[]) => Promise<number>>([
  ["", status],
  ["answer", writeAnswer],
  ["prune", prune],
]);

const isTree = (row: Pick<Answer, "rule">): boolean => row.rule.startsWith(TREE_RULE_PREFIX);

/** Print why the command did nothing, and fail. */
function refuse(message: string): number {
  console.error(`not-slop: ${message}`);
  return 1;
}

/** A whole-tree site as a row names it: every file it spans. */
function treeSite(site: TreeSite): Pick<Answer, "id" | "rule" | "path" | "excerpt"> {
  const paths = [...new Set((site.places ?? [site]).map((place) => place.path))].toSorted();
  return {
    id: site.id,
    rule: `${TREE_RULE_PREFIX}${site.kind}`,
    path: paths.join(","),
    excerpt: site.excerpt,
  };
}

/** The sites the last `bun run lint` in this worktree printed, or none before the first. */
async function lastLintSites(): Promise<LintSite[]> {
  const path = sitesCachePath();
  const file = path === null ? null : Bun.file(path);
  return file !== null && (await file.exists()) ? parseJsonAs<LintSite[]>(await file.text()) : [];
}

/** The rows no current finding bears out: a tree row against a fresh scan, a lint row against a
 *  fresh lint of its file. A file that is gone bears out nothing. */
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

/** Why the ledger cannot be rewritten: a row it cannot read would be dropped by the rewrite. */
function unwritable(ledger: Ledger): string | null {
  if (ledger.unread.length === 0) return null;
  return [`${NOT_SLOP_LEDGER} has rows it cannot read; fix them first:`, ...ledger.unread].join("\n  ");
}

async function writeAnswer([id = "", ...words]: readonly string[]): Promise<number> {
  const tree = treeSites();
  const register = tree.find((site) => site.id === id && TREE_REGISTER_KINDS.includes(site.kind));
  if (register !== undefined) {
    return refuse(`${id} is a ${register.kind} row: a current count, with nothing to answer`);
  }
  const site = [...(await lastLintSites()), ...tree.map(treeSite)].find((one) => one.id === id);
  if (site === undefined) {
    return refuse(`no current finding has the id "${id}": run bun run lint, and answer an id it printed`);
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

/**
 * The test files a commit can break, found through the import graph rather than by running all of
 * them. The pre-push hook runs these over every earlier commit in a push, beside the static steps,
 * and leaves the whole suite to the tip.
 *
 * A test is selected when it reaches a changed file through at most `depth` imports. Distance is
 * what bounds the cost: a module near the root of the graph is reached by nearly every test through
 * some long chain, so the unbounded closure of a wide commit is most of the suite. A changed file no
 * module imports
 * — a fixture, a script, a seed read at runtime — is reached instead by any test whose source names
 * its path or its file name.
 *
 * `--cost <range>` prints, for every commit in a revision range, the share of the suite each depth
 * selects, then the mean, p50 and p90 over the range. That is cost; nothing here measures how many
 * bugs a depth catches, and the tip still runs the whole suite. The default of 3 is the operator's
 * choice (2026-09-24).
 *
 *   bun tools/runtime/affected-tests.ts [--base <rev>] [--depth <n>]
 *   bun tools/runtime/affected-tests.ts --cost <range>
 */
import { existsSync, readFileSync, realpathSync } from "../../src/meta/filesystem.ts";
import { dirname, join, relative } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

const DEFAULT_DEPTH = 3;
const COST_DEPTHS = [1, 2, 3, 4, 5, Number.POSITIVE_INFINITY];
const MODULE = /\.[cm]?[jt]sx?$/;
const TEST = /^test\/[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;

interface Graph {
  /** Repository-relative module path → the modules that import it. */
  importers: Map<string, Set<string>>;
  tests: string[];
  /** Test path → its source text, for the by-name reach of a file no module imports. */
  testSource: Map<string, string>;
}

function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);

function loaderFor(file: string): "ts" | "tsx" | "js" | "jsx" {
  if (file.endsWith("x")) return file.endsWith(".tsx") ? "tsx" : "jsx";
  return /\.[cm]?ts$/.test(file) ? "ts" : "js";
}

/** Every tracked module's imports, resolved the way Bun resolves them, kept inside the tree. */
function readGraph(tree: string): Graph {
  // Bun resolves to real paths, so a root reached through a symlink (macOS `/var`) must be one too.
  const root = realpathSync(tree);
  const files = lines(git(root, ["ls-files"])).filter((file) => MODULE.test(file));
  const importers = new Map<string, Set<string>>();
  const testSource = new Map<string, string>();
  const scanners = new Map<string, Bun.Transpiler>();
  for (const file of files) {
    const absolute = join(root, file);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    if (TEST.test(file)) testSource.set(file, text);
    const loader = loaderFor(file);
    const scanner = scanners.get(loader) ?? new Bun.Transpiler({ loader });
    scanners.set(loader, scanner);
    let imports: ReturnType<Bun.Transpiler["scanImports"]>;
    try {
      imports = scanner.scanImports(text);
    } catch {
      continue;
    }
    for (const { path: specifier } of imports) {
      let target: string;
      try {
        target = Bun.resolveSync(specifier, dirname(absolute));
      } catch {
        continue;
      }
      const inside = relative(root, target);
      if (inside.startsWith("..") || inside.includes("node_modules/")) continue;
      const set = importers.get(inside) ?? new Set<string>();
      set.add(file);
      importers.set(inside, set);
    }
  }
  return { importers, tests: [...testSource.keys()], testSource };
}

/** Test path → the fewest imports between it and any changed file; absent when none reaches it. */
function distances(graph: Graph, changed: readonly string[]): Map<string, number> {
  const seen = new Map<string, number>();
  let frontier: string[] = [];
  for (const file of changed) {
    seen.set(file, 0);
    frontier.push(file);
  }
  for (let hop = 1; frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const importer of graph.importers.get(file) ?? []) {
        if (seen.has(importer)) continue;
        seen.set(importer, hop);
        next.push(importer);
      }
    }
    frontier = next;
  }
  const reached = new Map<string, number>();
  for (const [file, hop] of seen) if (TEST.test(file)) reached.set(file, hop);
  // A file outside the graph is read by path at runtime; a test naming it is one hop away.
  for (const file of changed) {
    if (MODULE.test(file) && graph.importers.has(file)) continue;
    const name = file.slice(file.lastIndexOf("/") + 1);
    for (const [test, text] of graph.testSource) {
      if (!reached.has(test) && (text.includes(file) || text.includes(name))) reached.set(test, 1);
    }
  }
  return reached;
}

function changedFiles(root: string, base: string, head: string): string[] {
  return lines(git(root, ["diff", "--name-only", "--no-renames", base, head]));
}

/** Each commit's selection at every depth in `COST_DEPTHS`, as a share of the suite. The graph is
 *  the current tree's, which is close enough over one pull request and one read instead of one per
 *  commit. */
function cost(root: string, range: string): void {
  const graph = readGraph(root);
  const suite = graph.tests.length;
  const percent = (share: number): string => `${(share * 100).toFixed(0).padStart(3)}%`;
  const columns = COST_DEPTHS.map((depth) => (Number.isFinite(depth) ? `  d${String(depth)}` : " all"));
  console.log(`commit     files ${columns.join(" ")}`);
  const shares: number[][] = COST_DEPTHS.map(() => []);
  for (const commit of lines(git(root, ["rev-list", "--reverse", "--no-merges", range]))) {
    const files = changedFiles(root, `${commit}^1`, commit);
    const hops = [...distances(graph, files).values()];
    const row = COST_DEPTHS.map((depth, index) => {
      const share = hops.filter((hop) => hop <= depth).length / suite;
      shares[index]?.push(share);
      return percent(share);
    });
    console.log(`${commit.slice(0, 9)} ${String(files.length).padStart(6)} ${row.join(" ")}`);
  }
  const summary = (pick: (sorted: number[]) => number): string =>
    shares.map((column) => percent(pick([...column].sort((a, b) => a - b)))).join(" ");
  console.log(
    `mean             ${summary((sorted) => sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length))}`,
  );
  console.log(`p50              ${summary((sorted) => sorted[Math.floor(sorted.length * 0.5)] ?? 0)}`);
  console.log(`p90              ${summary((sorted) => sorted[Math.floor(sorted.length * 0.9)] ?? 0)}`);
}

function main(argv: readonly string[]): void {
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const option = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const range = option("--cost");
  if (range !== undefined) {
    cost(root, range);
    return;
  }
  const given = option("--depth") ?? Bun.env.ANA_AFFECTED_DEPTH ?? String(DEFAULT_DEPTH);
  const depth = Number(given);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(`--depth takes a whole number, not ${given}`);
  }
  const reached = distances(readGraph(root), changedFiles(root, option("--base") ?? "HEAD^1", "HEAD"));
  for (const test of [...reached].flatMap(([path, hop]) => (hop <= depth ? [path] : [])).sort()) {
    console.log(test);
  }
}

if (import.meta.main) main(Bun.argv.slice(2));

export { distances, readGraph };

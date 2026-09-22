/**
 * `bun run lint`, without a Node binary underneath it, and with the not-slop ledger applied.
 *
 * `.oxlintrc.json` sets `options.typeAware`, so oxlint has always run the type-aware rules here.
 * It runs them in a child process, `tsgolint`, which it looks for at
 * `node_modules/.bin/tsgolint` — and that entry is a `#!/usr/bin/env node` shim. So the lint step,
 * and therefore every push, depended on a Node binary being on PATH. The machine this was written
 * on had one through a shell-scoped version manager; a detached `env -i` launch does not, and
 * there the whole gate stops on `env: node: No such file or directory` followed by
 * `Error running tsgolint: "exit status: exit status: 127"`.
 *
 * `OXLINT_TSGOLINT_PATH` skips the shim. The real linter is a native executable shipped in a
 * per-platform package, so pointing at it directly removes the dependency rather than documenting
 * it. An absent package is reported here, where the missing name is known, instead of arriving as
 * `exit status: 127` from a child two processes away.
 *
 * oxlint has no store for an answered finding but the inline `oxlint-disable` comment, so this
 * reads its JSON report and applies `tools/oxlint/not-slop.tsv` (`not-slop-ledger.ts` says why a
 * ledger). A finding the ledger answers is dropped; the rest print in oxlint's own one-line
 * spelling, which the pre-push hook reads, each heuristic one with the id that answers it. A row
 * that no longer names a finding fails the run, as an unused disable comment does: an answer that
 * outlives its site is debt, and a later site with the same text would inherit it unread.
 *
 * The two repository plugins are optional. `anti-slop` and `ana`, whose rules are the `/simplify`
 * catchers, run every time, but their findings and the ledger that answers them fail the run only
 * under `--strict` or `ANA_LINT_STRICT=1`. Without it a contributor is held to oxlint's own rules
 * and told how many optional findings there are. A clone that sets `git config ana.lintStrict true`
 * is strict by default: the key lives in that clone's `.git/config`, which its worktrees share and
 * no push publishes, so a maintainer's checkout keeps the gate a fresh clone does not have.
 */
import { existsSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { runSync } from "../../src/meta/subprocess.ts";
import {
  type Ledger,
  ledgerOnDisk,
  NOT_SLOP_LEDGER,
  siteExcerpt,
  siteId,
  TREE_RULE_PREFIX,
  unanswerable,
} from "../oxlint/not-slop-ledger.ts";
import { TREE_REGISTER_KINDS, treeSites } from "../oxlint/tree-findings.ts";

const ROOTS = ["src", "tools", "vendor", "starters", "test", "packages", ".claude"];

/** The repository root, which oxlint runs from and every path it reports is relative to. */
const ROOT = new URL("../..", import.meta.url).pathname;

/** The linter itself, relative to the repository root every caller spawns it from. */
export const OXLINT_BINARY = "node_modules/oxlint/bin/oxlint";

/** The plugins whose findings gate only a strict run. */
const OPTIONAL_PLUGINS = new Set(["anti-slop", "ana"]);
/** The rule list of a disable comment, up to its `--` description or the end of the comment. */
const DISABLE_RULES = /(?:oxlint|eslint)-disable(?:-next-line|-line)?\b(.*?)(?:--|\*\/|$)/su;

/** Where the last run's answerable sites are kept for `bun run not-slop -- answer`, per worktree. */
const SITES_CACHE = "ana/lint-sites.json";

/** What oxlint's `-f json` emits for one finding, as much of it as the readers here use. */
export interface Diagnostic {
  message: string;
  /** `ana(no-deep-nesting)`; absent on an unused disable comment. */
  code?: string;
  severity: string;
  help?: string;
  filename: string;
  /** The span in UTF-8 bytes, and its 1-based line and column. */
  labels?: { span: { offset: number; length: number; line: number; column: number } }[];
}

/** A finding the ledger can answer, as the ledger and `bun run not-slop` name it. */
export interface LintSite {
  id: string;
  rule: string;
  path: string;
  line: number;
  excerpt: string;
}

/** The native `tsgolint`, resolved past the `node` shim. Throws naming the package that is absent. */
export function tsgolintPath(): string {
  const platform = `${runtimeProcess.platform}-${runtimeProcess.arch}`;
  const specifier = `@oxlint-tsgolint/${platform}/tsgolint`;
  try {
    return Bun.resolveSync(specifier, import.meta.dir);
  } catch {
    throw new Error(
      `the type-aware rules need ${specifier}, which this install does not carry. ` +
        `Add the platform package for ${platform} or run one frozen install.`,
    );
  }
}

/**
 * oxlint's whole JSON report for `args`, read from the root to the end of its output.
 *
 * Read as a stream to its end. `Bun.spawnSync` with a pipe returned 547,240 of a 547,506-byte
 * report once — enough to look like a complete document and fail on the last string.
 */
export async function oxlintDiagnostics(
  args: readonly string[],
): Promise<{ diagnostics: Diagnostic[]; exitCode: number }> {
  const child = Bun.spawn({
    cmd: [runtimeProcess.execPath, OXLINT_BINARY, "-f", "json", ...args],
    cwd: ROOT,
    env: { ...Bun.env, OXLINT_TSGOLINT_PATH: tsgolintPath() },
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (!text.startsWith("{")) throw new Error(`oxlint produced no json (exit ${exitCode})`);
  return { diagnostics: parseJsonAs<{ diagnostics: Diagnostic[] }>(text).diagnostics, exitCode };
}

/** `ana(no-deep-nesting)` as oxlint spells it becomes `ana/no-deep-nesting`. */
export function ruleOf(diagnostic: Diagnostic): string {
  const match = /^([\w-]+)\(([\w-]+)\)$/u.exec(diagnostic.code ?? "");
  return match === null ? (diagnostic.code ?? "") : `${match[1]}/${match[2]}`;
}

/**
 * The site a heuristic finding reports, or null for a finding the ledger cannot answer.
 *
 * The site is the line the span starts on and the span's own first line. A span can be a whole
 * function, and hashing all of it would bring the answer back at every edit to the body; the line
 * a report points at is what the reader judged, and the span's head keeps two reports on one line
 * apart.
 */
export function lintSite(diagnostic: Diagnostic, bytes: Uint8Array): LintSite | null {
  const rule = ruleOf(diagnostic);
  if (unanswerable(rule) !== null) return null;
  const span = diagnostic.labels?.[0]?.span;
  const decoder = new TextDecoder();
  const line = span === undefined ? "" : (decoder.decode(bytes).split("\n")[span.line - 1] ?? "");
  const head =
    span === undefined
      ? ""
      : (decoder.decode(bytes.subarray(span.offset, span.offset + span.length)).split("\n")[0] ?? "");
  const path = diagnostic.filename;
  return {
    id: siteId(rule, [{ path, text: `${line}\n${head}` }]),
    rule,
    path,
    line: span?.line ?? 0,
    excerpt: siteExcerpt([{ path, text: line }]),
  };
}

/** Every finding in `diagnostics` with the site it reports and whether an optional plugin owns it,
 *  each file read once. */
export async function withSites(
  diagnostics: readonly Diagnostic[],
): Promise<{ diagnostic: Diagnostic; site: LintSite | null; optional: boolean }[]> {
  const files = new Map<string, Promise<Uint8Array>>();
  return Promise.all(
    diagnostics.map(async (diagnostic) => {
      const bytes = files.get(diagnostic.filename) ?? Bun.file(`${ROOT}/${diagnostic.filename}`).bytes();
      files.set(diagnostic.filename, bytes);
      const text = await bytes;
      return { diagnostic, site: lintSite(diagnostic, text), optional: optionalFinding(diagnostic, text) };
    }),
  );
}

/**
 * True for a finding of an optional plugin.
 *
 * An unused disable comment carries no code, and its message names no rule when the whole comment
 * went unused. Its span does: the whole comment then, whose rules must all be optional ones, or the
 * one rule name that went unused when the rest of the comment still suppresses something.
 */
export function optionalFinding(diagnostic: Diagnostic, bytes: Uint8Array): boolean {
  const plugin = /^([\w-]+)\(/u.exec(diagnostic.code ?? "")?.[1];
  if (plugin !== undefined) return OPTIONAL_PLUGINS.has(plugin);
  const span = diagnostic.labels?.[0]?.span;
  if (span === undefined) return false;
  const text = new TextDecoder().decode(bytes.subarray(span.offset, span.offset + span.length));
  const rules = (DISABLE_RULES.exec(text)?.[1] ?? text).split(/[\s,]+/u).filter((rule) => rule !== "");
  return rules.length > 0 && rules.every((rule) => OPTIONAL_PLUGINS.has(rule.split("/")[0] ?? ""));
}

/** One finding in oxlint's own one-line spelling, which `.githooks/pre-push` reads. */
function rendered(diagnostic: Diagnostic, site: LintSite | null): string {
  const span = diagnostic.labels?.[0]?.span;
  const at = `${diagnostic.filename}:${span?.line ?? 0}:${span?.column ?? 0}`;
  const what =
    diagnostic.code === undefined ? `${diagnostic.severity}:` : `${diagnostic.severity} ${diagnostic.code}:`;
  const help = diagnostic.help === undefined ? "" : ` help: ${diagnostic.help}`;
  return `${at}: ${what} ${diagnostic.message}${help}${site === null ? "" : ` [not-slop ${site.id}]`}`;
}

/** True when the clone at `cwd` sets `ana.lintStrict`, git's own boolean spellings included. */
export function strictByConfig(cwd: string): boolean {
  const run = runSync(["git", "config", "--type=bool", "--get", "ana.lintStrict"], { cwd });
  return run.exitCode === 0 && new TextDecoder().decode(run.stdout).trim() === "true";
}

/** A run the optional plugins gate: asked for, or the clone's own default. */
function strictRun(args: readonly string[]): boolean {
  return args.includes("--strict") || Bun.env.ANA_LINT_STRICT === "1" || strictByConfig(ROOT);
}

/** Where this worktree keeps the last run's sites, or null outside a git checkout. */
export function sitesCachePath(): string | null {
  const run = runSync(["git", "rev-parse", "--path-format=absolute", "--git-path", SITES_CACHE], {
    cwd: ROOT,
  });
  return run.exitCode === 0 ? new TextDecoder().decode(run.stdout).trim() : null;
}

/**
 * The ledger's own failures: rows it could not read, rows no finding in this run bears out, and
 * rows naming a register.
 *
 * A lint row is judged where its file was linted under the ordinary rules — not under a one-rule
 * config, where every other row would read as stale. A tree row is judged only after a whole-tree
 * run, which also scans the tree.
 */
function ledgerProblems(
  ledger: Ledger,
  seen: ReadonlySet<string>,
  linted: (path: string) => boolean,
  wholeTree: boolean,
): string[] {
  const trees = wholeTree ? new Set(treeSites().map((site) => site.id)) : null;
  const registers = new Set(TREE_REGISTER_KINDS.map((kind) => `${TREE_RULE_PREFIX}${kind}`));
  const unread = ledger.unread.map((problem) => `${NOT_SLOP_LEDGER}: ${problem}`);
  return [
    ...unread,
    ...ledger.answers.flatMap((answer) => {
      const where = `${NOT_SLOP_LEDGER}: ${answer.id} ${answer.rule} ${answer.path}`;
      if (registers.has(answer.rule)) {
        return [`${where}: a register row is a current count, with nothing to answer`];
      }
      const tree = answer.rule.startsWith(TREE_RULE_PREFIX);
      const judged = tree ? trees !== null : linted(answer.path);
      const present = tree ? trees?.has(answer.id) === true : seen.has(answer.id);
      return judged && !present
        ? [`${where}: no finding has this id any more; bun run not-slop -- prune`]
        : [];
    }),
  ];
}

/** The roots a whole-tree run of the checkout at `root` lints. `packages/ui` keeps its own lock
 *  and node_modules; without its React types the type-aware rules report findings that are not
 *  there and hide real ones, so it waits until `bun run ui:deps`, which `bun run gate` runs first. */
export function lintRoots(root: string): readonly string[] {
  return existsSync(`${root}/packages/ui/node_modules`)
    ? ROOTS
    : ROOTS.filter((entry) => entry !== "packages");
}

async function main(): Promise<number> {
  const roots = lintRoots(ROOT);
  if (roots.length < ROOTS.length) {
    console.error(
      "lint: packages/ui has no node_modules, so a whole-tree run leaves it out. bun run ui:deps",
    );
  }
  // `ANA_LINT_PATHS` replaces the roots with an explicit list, one path per line. The pre-commit
  // hook sets it to the staged files so a commit is linted while it is still cheap to fix; every
  // other caller leaves it unset and lints the whole tree.
  const explicit = Bun.env.ANA_LINT_PATHS?.split("\n").filter((line) => line !== "") ?? [];
  const args = Bun.argv.slice(2);
  const strict = strictRun(args);
  const extra = args.filter((argument) => argument !== "--strict");
  const flags = [
    // `.oxlintrc.json` sets this too, so for the ordinary run the flag changes nothing. It is
    // here for `bun run lint -c <one-rule-config>`, the recipe `tools/oxlint/SHAPE-RULESET.md`
    // gives for measuring a single rule: a scratch config that omits the option reports zero for
    // every type-aware rule and says nothing about why. A silent zero is worse than a flag
    // repeated once.
    "--type-aware",
    "--deny-warnings",
    "--report-unused-disable-directives",
    ...(explicit.length > 0 ? explicit : roots),
  ];
  // A caller naming its own format reads oxlint's output directly, ledger unapplied.
  if (extra.some((argument) => argument === "-f" || argument.startsWith("--format"))) {
    const cmd = [runtimeProcess.execPath, OXLINT_BINARY, ...flags, ...extra];
    const env = { ...Bun.env, OXLINT_TSGOLINT_PATH: tsgolintPath() };
    return Bun.spawnSync({ cmd, cwd: ROOT, env, stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
  }

  const { diagnostics, exitCode } = await oxlintDiagnostics([...flags, ...extra]);
  const ledger = await ledgerOnDisk(ROOT);
  const answered = new Set(ledger.answers.map((answer) => answer.id));
  const found = await withSites(diagnostics);
  const unanswered = found.filter(({ site }) => site === null || !answered.has(site.id));
  const shown = strict ? unanswered : unanswered.filter(({ optional }) => !optional);
  const optional = unanswered.length - shown.length;
  const linted = (path: string): boolean =>
    extra.length === 0 &&
    (explicit.length > 0 ? explicit.includes(path) : roots.some((root) => path.startsWith(`${root}/`)));
  const seen = new Set(found.flatMap(({ site }) => (site === null ? [] : [site.id])));
  const wholeTree = extra.length === 0 && explicit.length === 0;
  // The ledger answers the optional plugins alone, so only a run they gate reads it.
  const problems = strict ? ledgerProblems(ledger, seen, linted, wholeTree) : [];

  const cache = sitesCachePath();
  const sites = unanswered.flatMap(({ site }) => (site === null ? [] : [site]));
  if (cache !== null) await Bun.write(cache, JSON.stringify(sites));
  const errors = shown.filter(({ diagnostic }) => diagnostic.severity === "error").length;
  const lines = [
    ...shown.map(({ diagnostic, site }) => rendered(diagnostic, site)),
    ...problems,
    ...(shown.length === 0 ? [] : [`Found ${shown.length - errors} warnings and ${errors} errors.`]),
    ...(found.length === unanswered.length
      ? []
      : [`${found.length - unanswered.length} answered in ${NOT_SLOP_LEDGER}.`]),
    ...(optional === 0
      ? []
      : [
          `${optional} optional anti-slop and simplify findings not shown; bun run lint -- --strict lists them.`,
        ]),
    ...(!strict || sites.length === 0
      ? []
      : [
          'A heuristic finding that is not slop: bun run not-slop -- answer <id> "<why, checkable against the code>".',
        ]),
  ];
  if (lines.length > 0) console.log(lines.join("\n"));
  // oxlint failing with nothing to report failed on its own account: a config it could not read.
  if (diagnostics.length === 0 && exitCode !== 0) return exitCode;
  return shown.length + problems.length === 0 ? 0 : 1;
}

if (import.meta.main) runtimeProcess.exit(await main());

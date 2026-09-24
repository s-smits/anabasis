/**
 * Drive a lint fixer to a tree the compiler, the linter and the size policy all accept.
 *
 * A fixer proposes from a lint report, and a report is a parse: it names the syntax the verdict
 * is about, but nothing in it says what the edit disturbs. The oracle for that is the gate this
 * repository already runs, so the loop borrows it. Each round starts from the same clean tree and
 * the same report, applies every site not held, lets the formatter and the linter's own fixer
 * finish the job, then reads `tsc`, `oxlint` and `tools/loc/source-policy.ts`. Every line they
 * name is mapped back to the line it came from, held, and the tree is reverted whole before the
 * next round. Offsets never go stale because every round re-reads the same bytes, and the held
 * set only grows, so the loop terminates.
 *
 * Two kinds of held line, and their difference is the argument for a loop rather than a cleverer
 * fixer: one is an edit that was wrong, the other is an edit that was right about its own line
 * and wrong about a line ten below it. Neither is visible to the parse that proposed it. On
 * `strict-boolean-expressions` the second kind was `(n ?? 0) !== 0` — exactly the original test,
 * but it does not narrow `n`, so an unguarded use further down stops compiling.
 *
 * A file the size policy refuses is held differently again. It is not a bad edit, so the line is
 * not held; the file is **constrained**, and the fixer is told it may not grow that file. What to
 * do about that is the fixer's business: `strict-boolean-fix.ts` writes its predicate out inline
 * rather than importing it, which is what a reader did by hand in the same two files. A fixer
 * that only ever removes code never reads the flag. A file still over its size once constrained
 * is skipped whole on the round after, because the loop asked for the smaller form and got a file
 * that does not fit either way — that is the one case where the tree is better off untouched.
 *
 * Exit zero means the tree the loop leaves behind is one all three of those accept, and nothing
 * less. Reaching a fixed point is not the same claim: the loop stops as soon as a round holds
 * nothing new, and a finding it cannot remove — a compiler error it never caused, a site the
 * fixer declined — is held once and then quiet. That is `stopped … with N finding(s) left`, and
 * it exits one. A step whose only correct exit is zero, the fixer and the formatter, throws
 * rather than being read as a round that found nothing.
 *
 * The loop knows nothing about any rule. It speaks the two-argument fixer CLI this directory
 * already uses — `<report.json> <tree>` plus flags — so anything that reads an oxlint JSON report
 * and writes `<report>.journal.json` can be driven by it.
 *
 * Usage:
 *   oxlint --type-aware --format=json … > report.json
 *   bun tools/oxlint/fix-loop.ts --fixer=tools/oxlint/strict-boolean-fix.ts \
 *     --report=/abs/report.json --tree=/abs/worktree [--rounds=8] \
 *     -- --predicate=hasText:textOr:src/meta/text.ts
 */
import { boundText } from "../../src/meta/bounded-text.ts";
import { existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { CAPTURE_MAX_BYTES, decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { OXLINT_BINARY } from "../runtime/lint.ts";
import { journalPath } from "./fixer-source.ts";

interface JournalEdit {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
}

/** What a command printed on both streams, and whether it ended badly. */
interface Ran {
  readonly text: string;
  readonly failed: boolean;
}

/** What the size policy said: the files it names as over, and what it made of the tree. */
interface Sized {
  readonly fat: Set<string>;
  readonly policy: "accepted" | "refused";
}

interface Finding {
  readonly path: string;
  readonly line: number;
  readonly source: string;
  readonly message: string;
}

const UTF8 = "utf8";
/** Both are written to yield path, line, producer, message in that order. */
const TSC = /^(\S.*?)\((\d+),\d+\): (error TS\d+): (.*)$/;
const OXLINT = /^(\S+?):(\d+):\d+: error (\S+): (.*)$/;
const SIZE = /^file-size: (\S+?): \d+ nonblank lines exceeds/;
/** The two sentences `tools/loc/source-policy.ts` ends on; anything else is a run that did not. */
const POLICY_SETTLED = /^source-policy: (all checks passed|FAILED)/mu;
/** Formatter reflow moves a line a little; a rewrite that broke it is rarely further than this. */
const SNAP_LINES = 6;

const ARGUMENTS = runtimeProcess.argv.slice(2);
const SEPARATOR = ARGUMENTS.indexOf("--");
const OWN = SEPARATOR < 0 ? ARGUMENTS : ARGUMENTS.slice(0, SEPARATOR);
const EXTRA = SEPARATOR < 0 ? [] : ARGUMENTS.slice(SEPARATOR + 1);
// tsgolint shells out to `node`, so a subprocess without the caller's PATH reports nothing at all
// and the whole oracle goes quietly silent. Inherit the environment and only flatten the colour.
const ENV = { ...runtimeProcess.env, FORCE_COLOR: "0", NO_COLOR: "1", CLICOLOR_FORCE: "" };

function option(name: string, fallback: string): string {
  const found = OWN.find((one) => one.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const FIXER = option("fixer", "");
const REPORT = option("report", "");
const TREE = option("tree", "");
const ROUNDS = Number(option("rounds", "8"));
const BUN = option("bun", runtimeProcess.execPath);
const LINT_PATHS = option("lint-paths", "src,tools,vendor,starters,test,packages,.claude").split(",");
const HOLD_FILE = `${REPORT}.hold.txt`;
const JOURNAL_FILE = journalPath(REPORT);

function runIn(cmd: readonly string[]): Ran {
  const result = runSync(cmd, { cwd: TREE, env: ENV, maxBuffer: CAPTURE_MAX_BYTES });
  // A truncated lint report reads as a tree with fewer findings, which is the one wrong answer
  // this loop must not give.
  if (result.cappedAt !== null) {
    throw new Error(`${cmd[0] ?? ""} filled the ${result.cappedAt}-byte capture`);
  }
  return { text: decodeOutput(result.stdout) + decodeOutput(result.stderr), failed: result.exitCode !== 0 };
}

function linesOf(path: string): string[] {
  const full = join(TREE, path);
  return existsSync(full) ? readFileSync(full, UTF8).split("\n") : [];
}

/**
 * For each line of `after` (1-based), the line of `before` it came from.
 *
 * A longest-common-subsequence table, which is the expensive way to do this and costs nothing
 * here: only files that produced a finding are ever mapped, and in practice that is a handful per
 * round out of a census of a hundred and twenty.
 */
export function mapBack(before: readonly string[], after: readonly string[]): number[] {
  const columns = after.length + 1;
  const table = new Uint32Array((before.length + 1) * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const same = before[i] === after[j];
      const grown = (table[(i + 1) * columns + j + 1] ?? 0) + 1;
      const kept = Math.max(table[(i + 1) * columns + j] ?? 0, table[i * columns + j + 1] ?? 0);
      table[i * columns + j] = same ? grown : kept;
    }
  }
  const mapped = [0];
  let i = 0;
  for (let j = 0; j < after.length; ) {
    if (i < before.length && before[i] === after[j]) {
      mapped.push(i + 1);
      i += 1;
      j += 1;
      continue;
    }
    const dropping = i < before.length ? (table[(i + 1) * columns + j] ?? 0) : -1;
    const inserting = table[i * columns + j + 1] ?? 0;
    if (dropping >= inserting && i < before.length) {
      i += 1;
      continue;
    }
    mapped.push(Math.max(1, i));
    j += 1;
  }
  return mapped;
}

function findingsIn(text: string, pattern: RegExp): Finding[] {
  const out: Finding[] = [];
  for (const row of text.split("\n")) {
    const found = pattern.exec(row);
    if (found === null) continue;
    out.push({
      path: found[1] ?? "",
      line: Number(found[2]),
      source: found[3] ?? "",
      message: boundText(found[4] ?? "", 100).shown,
    });
  }
  return out;
}

/**
 * One oracle step, refusing the answer it cannot tell from a clean tree.
 *
 * Both steps report by printing lines this loop parses, and both exit non-zero when they have
 * something to say. A step that fails and names nothing did not run: a missing binary, a bad
 * path, a crash inside the checker. Zero findings is exactly what convergence is, so reading
 * that as a clean tree ends the loop with the tree in whatever state the last round left it.
 */
function findingsFrom(cmd: readonly string[], pattern: RegExp): Finding[] {
  const { text, failed } = runIn(cmd);
  const found = findingsIn(text, pattern);
  if (failed && found.length === 0) {
    throw new Error(
      `${cmd.join(" ")} failed without naming a finding:\n${boundText(text, 2000, "tail").shown}`,
    );
  }
  return found;
}

/**
 * The third oracle step: which files the size policy calls over, and whether it accepted the tree.
 *
 * Its exit status cannot be read the way the other two are, because a finding of any kind is a
 * non-zero exit and `file-size` is only one of six checks. The settling sentence is the signal
 * instead: printing neither of them is a run that never reached its own verdict. The `policy`
 * field carries the other five checks, so a function this loop grew past 80 lines is not silence.
 */
function sizePolicy(): Sized {
  const { text } = runIn([BUN, "tools/loc/source-policy.ts"]);
  if (!POLICY_SETTLED.test(text)) {
    throw new Error(
      `source-policy failed without reaching a verdict:\n${boundText(text, 2000, "tail").shown}`,
    );
  }
  const fat = new Set<string>();
  for (const row of text.split("\n")) {
    const found = SIZE.exec(row);
    if (found !== null) fat.add(found[1] ?? "");
  }
  const accepted = text.includes("source-policy: all checks passed");
  return { fat, policy: accepted ? "accepted" : "refused" };
}

/**
 * What a fixed point is worth: the line to print and the status to exit with.
 *
 * Its own function because this is the decision the whole loop exists to reach, and the loop is
 * not reachable from a test — it drives git, a fixer, the formatter and three checkers over a
 * real tree. Two claims used to share one return: that no further round would change anything,
 * and that the tree left behind is one the compiler, the linter and the size policy accept. Only
 * the second is worth an exit of zero.
 */
export function verdict(round: number, findings: number, policy: Sized["policy"], held: number) {
  if (findings === 0 && policy === "accepted") {
    return { line: `converged after ${String(round)} round(s), ${String(held)} held`, code: 0 };
  }
  const refusing = policy === "accepted" ? "" : " and the size policy refusing";
  return {
    line: `stopped after ${String(round)} round(s) with ${String(findings)} finding(s) left${refusing}: no further automatic progress`,
    code: 1,
  };
}

/** One step whose only correct exit is zero: the fixer itself, and the formatter it hands to. */
function mustRun(cmd: readonly string[]): Ran {
  const ran = runIn(cmd);
  if (ran.failed) {
    throw new Error(`${cmd.join(" ")} exited non-zero:\n${boundText(ran.text, 2000, "tail").shown}`);
  }
  return ran;
}

/**
 * The site a finding belongs to: its own line mapped back through the round's edits, then snapped
 * to the nearest thing the fixer actually wrote. Holding the reported line alone did not converge
 * — three findings were caused by an edit on a neighbouring line, so each round held a line no
 * edit owned and the next round made the same mistake. Import lines are excluded because every
 * finding in a file sits below the one the fixer added at the top.
 */
function siteOf(row: Finding, before: readonly string[], journal: readonly JournalEdit[]): number {
  const mapped = before.length === 0 ? row.line : (mapBack(before, linesOf(row.path))[row.line] ?? row.line);
  const near = journal.filter(
    (one) => one.path === row.path && one.kind !== "import" && Math.abs(one.line - mapped) <= SNAP_LINES,
  );
  const closest = near.reduce<JournalEdit | undefined>(
    (best, one) =>
      best === undefined || Math.abs(one.line - mapped) < Math.abs(best.line - mapped) ? one : best,
    undefined,
  );
  return closest?.line ?? mapped;
}

function main(): number {
  if (FIXER === "" || REPORT === "" || TREE === "") {
    runtimeProcess.stderr.write(
      "usage: --fixer <path> --report <report.json> --tree <dir> [-- <fixer flags>]\n",
    );
    return 2;
  }
  const raw = readFileSync(REPORT, UTF8);
  const parsed = parseJsonAs<{ diagnostics: readonly { filename: string }[] }>(raw.slice(raw.indexOf("{")));
  const census = [...new Set(parsed.diagnostics.map((one) => one.filename))].sort();
  const held = new Set<string>();
  const constrained = new Set<string>();
  const skipped = new Set<string>();
  // Every round reverts the whole working tree, so the loop owns it outright, and round one's
  // revert cannot tell the operator's uncommitted work from its own. Saying so at the door is the
  // only place that distinction still exists. Untracked files are left out because `git apply -R`
  // of the unstaged diff never touches them.
  const dirty = runIn(["git", "status", "--porcelain", "--untracked-files=no"]).text.trim();
  if (dirty !== "") {
    runtimeProcess.stderr.write(
      `${TREE} has uncommitted tracked changes and this loop reverts the tree whole each round:\n${dirty}\n`,
    );
    return 2;
  }
  for (let round = 1; round <= ROUNDS; round += 1) {
    const captured = runSync(["git", "diff"], { cwd: TREE, env: ENV, maxBuffer: CAPTURE_MAX_BYTES });
    // Reverting half a diff is worse than not reverting it.
    if (captured.cappedAt !== null) {
      throw new Error(`git diff filled the ${captured.cappedAt}-byte capture`);
    }
    const diff = decodeOutput(captured.stdout);
    if (diff.trim() !== "") runSync(["git", "apply", "-R", "-"], { cwd: TREE, env: ENV, input: diff });
    const before = new Map(census.map((path) => [path, linesOf(path)]));
    writeFileSync(HOLD_FILE, `${[...held].sort().join("\n")}\n`);
    const applied = mustRun([
      BUN,
      FIXER,
      REPORT,
      TREE,
      `--hold=${HOLD_FILE}`,
      ...[...constrained].sort().map((one) => `--constrained=${one}`),
      ...[...skipped].sort().map((one) => `--skip=${one}`),
      ...EXTRA,
    ]);
    console.log(`--- round ${String(round)}`);
    console.log(applied.text.trimEnd());
    mustRun([BUN, "run", "format"]);
    // The only step here whose non-zero exit is ordinary: `--fix` leaves whatever it cannot fix
    // and reports it, which is the same status a broken run would give.
    runIn([BUN, OXLINT_BINARY, "--fix", ...LINT_PATHS]);
    mustRun([BUN, "run", "format"]);
    const { fat, policy } = sizePolicy();
    const grown = new Set([...fat].filter((one) => !constrained.has(one)));
    const stubborn = new Set([...fat].filter((one) => constrained.has(one) && !skipped.has(one)));
    const lint = [BUN, OXLINT_BINARY, "--deny-warnings", "--report-unused-disable-directives", ...LINT_PATHS];
    const rows = [...findingsFrom([BUN, "run", "typecheck"], TSC), ...findingsFrom(lint, OXLINT)];
    const journal = existsSync(JOURNAL_FILE)
      ? parseJsonAs<JournalEdit[]>(readFileSync(JOURNAL_FILE, UTF8))
      : [];
    const fresh = new Set<string>();
    for (const row of rows) {
      const site = siteOf(row, before.get(row.path) ?? [], journal);
      const key = `${row.path}:${String(site)}`;
      if (!held.has(key)) fresh.add(key);
      console.log(`    ${row.source} ${row.path}:${String(row.line)} -> ${String(site)}  ${row.message}`);
    }
    console.log(
      `    ${String(rows.length)} findings, ${String(fresh.size)} new holds, ` +
        `${String(grown.size)} constrained, ${String(stubborn.size)} skipped`,
    );
    for (const one of [...grown].sort()) {
      console.log(`    source-policy ${one} may not grow; constraining it`);
    }
    for (const one of [...stubborn].sort()) {
      console.log(`    source-policy ${one} is over even so; skipping it`);
    }
    for (const one of grown) constrained.add(one);
    for (const one of stubborn) skipped.add(one);
    for (const one of fresh) held.add(one);
    if (fresh.size > 0 || grown.size > 0 || stubborn.size > 0) continue;
    // A round that held nothing new is a fixed point: the next one reads the same report against
    // the same bytes and writes the same tree. Whether that tree is the one this loop was asked
    // for is a separate question, and the oracle has just answered it. Asking only about new
    // holds conflated the two — a finding the fixer cannot remove is held on the round it appears
    // and adds no hold on the round after, so a compiler error the loop never touched used to
    // reach `converged` and exit zero with that error still in the tree.
    const settled = verdict(round, rows.length, policy, held.size);
    console.log(settled.line);
    return settled.code;
  }
  console.log("did not converge");
  return 1;
}

if (import.meta.main) runtimeProcess.exitCode = main();

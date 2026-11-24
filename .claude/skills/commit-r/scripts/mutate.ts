#!/usr/bin/env bun
/**
 * Mutation oracle for a commit-r pass (step 8): generates syntactic mutants of high-importance
 * owner files, verifies every named suite passes on the unmutated copy first, executes each mutant
 * against the suites, and records which suites kill it.
 *
 * `list` counts the mutants of each file. `run` appends one JSON line per mutant to `--out` and
 * skips mutants already recorded, allowing an interrupted run to resume; each worker mutates its own
 * worktree clone (`<out>.clone-<k>`) and runs `bun test --bail`. A run that outputs no pass, fail,
 * or bail count, or that `--timeout` ends, records `null` rather than a kill: under parallel mutants
 * a slow suite reaches the timeout unmutated, and a mutant that hangs fails on the suite's own
 * per-test timeout. `report` tabulates per-file kills across `--old` and the remaining suites (or
 * solo `killed / survived / unread` counts when `--old` is omitted), with `unread` for rows a
 * missing verdict leaves undecided, and `--survivors` prints `O-` IDs (comparative) or surviving
 * mutant IDs (solo), then unread IDs, which a rerun must bring to a verdict.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { appendFileSync, cpSync, existsSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import * as ts from "typescript5";

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Result {
  readonly id: string;
  readonly file: string;
  readonly killed: Record<string, boolean | null>;
}

const SWAPS = new Map([
  ["<", "<="],
  ["<=", "<"],
  [">", ">="],
  [">=", ">"],
  ["===", "!=="],
  ["!==", "==="],
  ["&&", "||"],
  ["||", "&&"],
  ["+", "-"],
  ["-", "+"],
  ["??", "&&"],
]);

/** A node no mutant touches: types, imports and template text, where a swap would not compile. */
const inert = (node: ts.Node) =>
  ts.isTypeNode(node) ||
  ts.isImportDeclaration(node) ||
  ts.isTemplateExpression(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node);

/** Each replacement one node offers: an operator, a negation, a literal, an `if`, a `?:`, or a row of a table of `code` rows. */
function edits(node: ts.Node, tree: ts.SourceFile): [number, number, string, string][] {
  const at = (one: ts.Node) => one.getStart(tree);
  const text = (one: ts.Node) => one.getText(tree);
  if (ts.isBinaryExpression(node)) {
    const op = text(node.operatorToken);
    const to = SWAPS.get(op);
    return to === undefined
      ? []
      : [[at(node.operatorToken), node.operatorToken.getEnd(), to, `${op} -> ${to}`]];
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return [[at(node), at(node.operand), "", "drop !"]];
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    const to = String(node.kind !== ts.SyntaxKind.TrueKeyword);
    return [[at(node), node.getEnd(), to, `${text(node)} -> ${to}`]];
  }
  if (ts.isNumericLiteral(node) && Number.isFinite(Number(node.text.replaceAll("_", "")))) {
    const to = String(Number(node.text.replaceAll("_", "")) + 1);
    return [[at(node), node.getEnd(), `(${to})`, `${node.text} -> ${to}`]];
  }
  if (ts.isIfStatement(node)) return [[at(node), node.getEnd(), ";", "delete if"]];
  if (ts.isConditionalExpression(node)) {
    const swapped = `(${text(node.condition)}) ? (${text(node.whenFalse)}) : (${text(node.whenTrue)})`;
    return [[at(node), node.getEnd(), swapped, "swap ?:"]];
  }
  const rows = ts.isArrayLiteralExpression(node) ? node.elements : [];
  const row = (one: ts.Expression) =>
    ts.isObjectLiteralExpression(one) && one.properties.some((each) => each.name?.getText(tree) === "code");
  if (rows.length < 3 || !rows.every(row)) return [];
  return rows.flatMap((one, index): [number, number, string, string][] => {
    const next = rows[index + 1];
    const deleted: [number, number, string, string] = [
      at(one),
      one.getEnd(),
      '{ code: "deleted", move: () => null }',
      `delete row ${String(index)}`,
    ];
    if (next === undefined) return [deleted];
    return [
      deleted,
      [
        at(one),
        next.getEnd(),
        `${text(next)}, ${text(one)}`,
        `swap rows ${String(index)},${String(index + 1)}`,
      ],
    ];
  });
}

function mutantsOf(root: string, file: string): Mutant[] {
  const tree = ts.createSourceFile(
    file,
    readFileSync(join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: Mutant[] = [];
  const visit = (node: ts.Node): void => {
    if (inert(node)) return;
    for (const [start, end, text, label] of edits(node, tree)) {
      const line = tree.getLineAndCharacterOfPosition(start).line + 1;
      found.push({ id: `${file}:${String(start)}:${label}`, file, line, label, start, end, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const linesOf = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];

/** One suite over one mutated copy: true where it failed, false where it passed, null where the runner gave no verdict. */
async function verdict(clone: string, paths: readonly string[], seconds: number): Promise<boolean | null> {
  const run = Bun.spawn(["bun", "test", "--bail", "--max-concurrency=4", ...paths], {
    cwd: clone,
    env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
  });
  const said = (await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])).join(
    "",
  );
  const code = await run.exited;
  if (run.signalCode !== null) return null;
  // A full run ends on its pass and fail counts; a run `--bail` stopped ends on the line saying so
  // and prints no counts (Bun 1.4).
  return /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/.test(said) ? code !== 0 : null;
}

async function runMutants(args: CommandArgs, root: string, files: readonly string[]): Promise<void> {
  const out = args.required("out");
  const suites = new Map(
    // SAFETY: the suites file is the caller's own map of a suite's name to its test paths.
    Object.entries(JSON.parse(readFileSync(args.required("suites"), "utf8")) as Record<string, string[]>),
  );
  const only = args.value("only");
  const wanted = only === null ? null : new Set(linesOf(only));
  // SAFETY: every line of `out` is one this script appended, a `Result`.
  const done = new Set(linesOf(out).map((line) => (JSON.parse(line) as Result).id));
  const todo = files
    .flatMap((file) => mutantsOf(root, file))
    .filter(({ id }) => !done.has(id) && (wanted?.has(id) ?? true));
  const originals = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));
  const free = Array.from({ length: args.int("jobs") ?? 4 }, (_, index) => `${out}.clone-${String(index)}`);
  for (const clone of free) {
    if (!existsSync(clone)) cpSync(root, clone, { recursive: true });
    // A run stopped mid-mutant leaves that mutant in its copy.
    for (const [file, text] of originals) writeFileSync(join(clone, file), text);
  }
  const seconds = args.int("timeout") ?? 300;
  const probe = free[0];
  if (probe !== undefined && todo.length > 0) {
    for (const [name, paths] of suites) {
      const baseline = await verdict(probe, paths, seconds);
      if (baseline === false) continue;
      args.die(
        `baseline suite "${name}" did not pass unmutated (${baseline === true ? "failed" : "no verdict"})`,
      );
    }
  }
  await pooled(todo, free.length, async (mutant) => {
    const clone = free.pop() ?? "";
    const original = originals.get(mutant.file) ?? "";
    writeFileSync(
      join(clone, mutant.file),
      original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end),
    );
    const killed: Record<string, boolean | null> = {};
    for (const [name, paths] of suites) {
      killed[name] =
        args.flag("stop-at-kill") && Object.values(killed).some(Boolean)
          ? null
          : await verdict(clone, paths, seconds);
    }
    writeFileSync(join(clone, mutant.file), original);
    free.push(clone);
    appendFileSync(
      out,
      `${JSON.stringify({ id: mutant.id, file: mutant.file, line: mutant.line, label: mutant.label, killed })}\n`,
    );
  });
  console.log(`${String(todo.length)} mutants run, ${String(done.size)} held before`);
}

function report(args: CommandArgs, results: readonly string[]): void {
  const old = args.value("old");
  // SAFETY: every line is one `run` appended, a `Result`.
  const rows = results.flatMap(linesOf).map((line) => JSON.parse(line) as Result);
  const classify =
    old === null
      ? ({ killed }: Result) => {
          const verdicts = Object.values(killed);
          if (verdicts.includes(true)) return "killed";
          return verdicts.includes(false) ? "survived" : "unread";
        }
      : ({ killed }: Result) => {
          const others = new Set(
            Object.entries(killed).flatMap(([name, kill]) => (name === old ? [] : [kill])),
          );
          const kept = others.has(true);
          if (!kept && (killed[old] == null || others.has(null))) return "unread";
          return `${killed[old] === true ? "O" : "-"}${kept ? "N" : "-"}`;
        };
  const survivorKind = old === null ? "survived" : "O-";
  if (args.flag("survivors")) {
    for (const row of rows) if ([survivorKind, "unread"].includes(classify(row))) console.log(row.id);
    return;
  }
  const columns = old === null ? ["killed", "survived", "unread"] : ["ON", "O-", "-N", "--", "unread"];
  console.log(["file", ...columns].join("  "));
  for (const [file, group] of Map.groupBy(rows, (row) => row.file)) {
    const counts = columns.map((kind) => String(group.filter((row) => classify(row) === kind).length));
    console.log([file, ...counts].join("  "));
  }
}

if (import.meta.main) {
  const usage = [
    "usage: mutate.ts list <worktree> <file>...",
    "       mutate.ts run <worktree> <file>... --out <jsonl> --suites <json> [--jobs N] [--only <ids>] [--stop-at-kill] [--timeout s]",
    "       mutate.ts report <jsonl>... [--old <suite>] [--survivors]",
  ].join("\n");
  await runCommand(
    {
      name: "mutate",
      usage,
      options: {
        out: "text",
        suites: "text",
        jobs: "int",
        only: "text",
        "stop-at-kill": "flag",
        timeout: "int",
        old: "text",
        survivors: "flag",
      },
      positionals: [2, Number.POSITIVE_INFINITY],
    },
    async (args: CommandArgs) => {
      const [mode = "", first = "", ...rest] = args.positionals;
      if (mode === "report") return report(args, [first, ...rest]);
      if (mode === "run") return runMutants(args, first, rest);
      if (mode !== "list") return args.die(usage);
      for (const [file, list] of Map.groupBy(
        rest.flatMap((path) => mutantsOf(first, path)),
        (one) => one.file,
      )) {
        console.log(`${file}  ${String(list.length)}`);
      }
    },
  );
}

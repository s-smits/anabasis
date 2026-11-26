#!/usr/bin/env bun
/**
 * Mutation oracle for a commit-r pass (step 8): syntactic mutants of high-importance owner files,
 * run against named suites that must first pass unmutated, recording which suites kill each. `list`
 * counts mutants per file. `run` appends one JSON line per mutant to `--out`, skipping recorded
 * ones so an interrupted run resumes; mutants spread over the check places (`checkPlaces`,
 * `tools/runs/host-config.ts`), one worker a slot on its own copy of the tree (`<out>.clone-<k>`,
 * or `--clones <prefix>`), running `bun test --bail` under `--timeout`, or at the one place
 * `ANA_CHECK_HOST` names (this machine for `here`) or this machine where no host is listed;
 * `--fleet` spreads over every listed host whatever `ANA_CHECK_HOST` says (`fleetPlaces`). `--jobs N` caps workers; a place that gives no
 * verdict hands its mutant back and takes no more; `--until` stops taking mutants at that time. A
 * run with no pass, fail or bail count, or one `--timeout` ends, records `null` rather than a kill.
 * `report` tabulates per-file kills across `--old` and the other suites (or solo `killed / survived
 * / unread` counts), and `--survivors` prints surviving IDs, then the unread ones a rerun must
 * bring to a verdict.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { availableParallelism, tmpdir } from "#src/meta/os.ts";
import { basename, dirname, isAbsolute, join, relative } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  checkHost,
  checkPlaces,
  fleetPlaces,
  NO_VERDICT,
  namedPlaces,
  type Place,
  placeEnv,
  spread,
} from "#tools/runs/host-config.ts";
import { PER_TEST_WALL_MS } from "#tools/runtime/test-suite.ts";
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

const isConsoleCall = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "console";

/** A node no mutant touches: types, imports, template text, and console logging (arid nodes). */
const inert = (node: ts.Node) =>
  ts.isTypeNode(node) ||
  ts.isImportDeclaration(node) ||
  ts.isTemplateExpression(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  isConsoleCall(node);

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

export function mutantsOf(root: string, file: string): Mutant[] {
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

interface Worker {
  readonly place: Place;
  readonly clone: string;
  readonly local: boolean;
}

const BATCH_FILE = "test/.ana-mutate-batch.test.ts";
const BATCH_MARKER = "__ANA_MUTANT_ROW__";
const STAMP_FILE = ".ana-clone-stamp";
const VERDICT_RE = /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/;

const routed = ({ remote }: Place): boolean =>
  remote !== undefined || !["", "here"].includes(checkHost()?.trim() ?? "");

const isAway = (worker: Worker): boolean => !worker.local && routed(worker.place);

async function verdict(worker: Worker, paths: readonly string[], seconds: number) {
  const away = isAway(worker);
  const wall = `--timeout=${String(PER_TEST_WALL_MS)}`;
  const bin = away ? "bun" : capturedExecPath;
  const run = Bun.spawn([bin, "test", "--bail", "--max-concurrency=4", wall, ...paths], {
    cwd: worker.clone,
    env: away
      ? { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(seconds) }
      : { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
    stdout: "pipe",
    stderr: "pipe",
    ...keysIf(!away, () => ({ timeout: seconds * 1000 })),
  });
  const said = (await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])).join(
    "",
  );
  const code = await run.exited;
  if (away && NO_VERDICT.has(code)) return "elsewhere";
  if (run.signalCode !== null) return null;
  // A full run ends on its pass and fail counts; a run `--bail` stopped ends on the line saying so
  // and prints no counts (Bun 1.4).
  return VERDICT_RE.test(said) ? code !== 0 : null;
}

function parseUncovered(root: string, lcov: string, targets: ReadonlySet<string>): Map<string, Set<number>> {
  const zero = new Map<string, Set<number>>();
  let current: string | null = null;
  for (const row of lcov.split("\n")) {
    if (row.startsWith("SF:")) {
      const raw = row.slice(3).trim();
      const norm = isAbsolute(raw) ? relative(root, raw) : raw;
      current = targets.has(norm) ? norm : null;
    } else if (current !== null && row.startsWith("DA:")) {
      const [lineNo = "", hits = ""] = row.slice(3).split(",");
      if (hits === "0") {
        const set = zero.get(current) ?? new Set<number>();
        set.add(Number(lineNo));
        zero.set(current, set);
      }
    } else if (row === "end_of_record") {
      current = null;
    }
  }
  return zero;
}

async function coveragePrune(
  root: string,
  files: readonly string[],
  suites: ReadonlyMap<string, readonly string[]>,
  seconds: number,
): Promise<Map<string, Map<string, Set<number>>>> {
  const dir = mkdtempSync(join(tmpdir(), "ana-cov-"));
  const targets = new Set(files);
  const entries = [...suites.entries()];
  const uncovered = new Map<string, Map<string, Set<number>>>();
  let index = 0;
  const runOne = async (): Promise<void> => {
    for (;;) {
      const current = entries[index];
      index += 1;
      if (current === undefined) return;
      const [name, paths] = current;
      const outDir = join(dir, String(index));
      mkdirSync(outDir, { recursive: true });
      const wall = `--timeout=${String(PER_TEST_WALL_MS)}`;
      const run = Bun.spawn(
        [
          capturedExecPath,
          "test",
          "--bail",
          "--max-concurrency=4",
          wall,
          "--coverage",
          "--coverage-reporter=lcov",
          `--coverage-dir=${outDir}`,
          ...paths,
        ],
        {
          cwd: root,
          env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
          stdout: "pipe",
          stderr: "pipe",
          timeout: seconds * 1000,
        },
      );
      const [said, code] = await Promise.all([
        Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]).then((parts) =>
          parts.join(""),
        ),
        run.exited,
      ]);
      if (run.signalCode !== null || code !== 0 || !VERDICT_RE.test(said)) continue;
      const lcovPath = join(outDir, "lcov.info");
      if (existsSync(lcovPath)) {
        uncovered.set(name, parseUncovered(root, readFileSync(lcovPath, "utf8"), targets));
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(availableParallelism(), entries.length) }, runOne));
    return uncovered;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface BatchPlan {
  readonly mutant: Mutant;
  readonly active: readonly string[];
}

function batchDriverSource(
  plans: readonly BatchPlan[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: { readonly stopAtKill: boolean; readonly seconds: number; readonly deadline: number },
): string {
  const suiteList = [...suites.entries()];
  const payload = JSON.stringify({
    plans,
    suites: suiteList,
    stopAtKill: opts.stopAtKill,
    seconds: opts.seconds,
    deadline: Number.isFinite(opts.deadline) ? opts.deadline : null,
    perTestWall: PER_TEST_WALL_MS,
  });
  const totalMs = Math.min(3_600_000, (opts.seconds * Math.max(1, plans.length) + 60) * 1000);
  return `import { it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
const cfg = ${payload};
const re = ${VERDICT_RE.toString()};
const root = process.cwd();
const originals = new Map();
for (const { mutant } of cfg.plans) {
  if (!originals.has(mutant.file)) originals.set(mutant.file, readFileSync(mutant.file, "utf8"));
}
async function runIn(dir, plan) {
  const { mutant, active } = plan;
  const activeSet = new Set(active);
  const original = originals.get(mutant.file) ?? "";
  writeFileSync(join(dir, mutant.file), original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end));
  const killed = {};
  try {
    for (const [name, paths] of cfg.suites) {
      if (!activeSet.has(name)) {
        killed[name] = false;
        continue;
      }
      if (cfg.stopAtKill && Object.values(killed).some(Boolean)) {
        killed[name] = null;
        continue;
      }
      const run = Bun.spawn(
        [process.execPath, "test", "--bail", "--max-concurrency=4", "--timeout=" + String(cfg.perTestWall), ...paths],
        {
          cwd: dir,
          env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
          stdout: "pipe",
          stderr: "pipe",
          timeout: cfg.seconds * 1000,
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      const said = stdout + stderr;
      killed[name] = run.signalCode !== null ? null : re.test(said) ? code !== 0 : null;
    }
  } finally {
    writeFileSync(join(dir, mutant.file), original);
  }
  const { id, file, line, label } = mutant;
  console.log(${JSON.stringify(BATCH_MARKER)} + JSON.stringify({ id, file, line, label, killed }));
}
it("mutate batch", async () => {
  const lanes = Math.min(2, cfg.plans.length);
  const dirs = [root];
  const tempDirs = [];
  for (let i = 1; i < lanes; i += 1) {
    const copy = mkdtempSync(join(tmpdir(), "ana-m-"));
    cpSync(root, copy, { recursive: true, filter: (p) => basename(p) !== "node_modules" && basename(p) !== ".git" });
    if (existsSync(join(root, "node_modules"))) symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
    if (existsSync(join(root, ".git"))) symlinkSync(join(root, ".git"), join(copy, ".git"));
    dirs.push(copy);
    tempDirs.push(copy);
  }
  let next = 0;
  try {
    await Promise.all(
      dirs.map(async (dir) => {
        for (;;) {
          if (cfg.deadline !== null && Date.now() >= cfg.deadline) return;
          const plan = cfg.plans[next];
          next += 1;
          if (plan === undefined) return;
          await runIn(dir, plan);
        }
      }),
    );
  } finally {
    for (const copy of tempDirs) rmSync(copy, { recursive: true, force: true });
  }
}, ${String(totalMs)});
`;
}

async function runBatch(
  worker: Worker,
  plans: readonly BatchPlan[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: { readonly stopAtKill: boolean; readonly seconds: number; readonly deadline: number },
): Promise<{
  readonly rows: (Result & { readonly line: number; readonly label: string })[];
  readonly dropped: boolean;
}> {
  const driverPath = join(worker.clone, BATCH_FILE);
  mkdirSync(dirname(driverPath), { recursive: true });
  writeFileSync(driverPath, batchDriverSource(plans, suites, opts));
  const batchSeconds = Math.min(3600, opts.seconds * Math.max(1, plans.length) + 60);
  const away = isAway(worker);
  try {
    const run = Bun.spawn([away ? "bun" : capturedExecPath, "test", BATCH_FILE], {
      cwd: worker.clone,
      env: away
        ? { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(batchSeconds) }
        : { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      ...keysIf(!away, () => ({ timeout: batchSeconds * 1000 })),
    });
    const [stdout, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
    const rows = stdout
      .split("\n")
      .filter((line) => line.includes(BATCH_MARKER))
      .map((line) => {
        const text = line.slice(line.indexOf(BATCH_MARKER) + BATCH_MARKER.length);
        // SAFETY: every marked line was emitted by `batchDriverSource` above.
        return JSON.parse(text) as Result & { readonly line: number; readonly label: string };
      });
    return { rows, dropped: away && NO_VERDICT.has(code) };
  } finally {
    rmSync(driverPath, { force: true });
  }
}

async function killsOf(
  seat: Worker,
  plan: BatchPlan,
  opts: {
    readonly originals: ReadonlyMap<string, string>;
    readonly suites: ReadonlyMap<string, readonly string[]>;
    readonly stopAtKill: boolean;
    readonly seconds: number;
  },
): Promise<Record<string, boolean | null> | "elsewhere"> {
  const { mutant, active } = plan;
  const activeSet = new Set(active);
  const original = opts.originals.get(mutant.file) ?? "";
  writeFileSync(
    join(seat.clone, mutant.file),
    original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end),
  );
  try {
    const killed: Record<string, boolean | null> = {};
    for (const [name, paths] of opts.suites) {
      if (!activeSet.has(name)) {
        killed[name] = false;
        continue;
      }
      const stopped = opts.stopAtKill && Object.values(killed).some(Boolean);
      const said = stopped ? null : await verdict(seat, paths, opts.seconds);
      if (said === "elsewhere") return said;
      killed[name] = said;
    }
    return killed;
  } finally {
    writeFileSync(join(seat.clone, mutant.file), original);
  }
}

interface WaveOut {
  readonly rows: Map<string, Record<string, boolean | null>>;
  readonly refused: readonly string[];
  readonly unrun: number;
}

async function dispatchWave(opts: {
  readonly places: readonly Place[];
  readonly workers: readonly Worker[];
  readonly plans: readonly BatchPlan[];
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly originals: ReadonlyMap<string, string>;
  readonly batchCap: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly skipLocalQualify: boolean;
}): Promise<WaveOut> {
  const { places, workers, plans, suites, originals, batchCap, stopAtKill, seconds, deadline } = opts;
  const localOnly =
    places[0] !== undefined && workers[0]?.local === true && plans.length <= places[0].slots
      ? [places[0]]
      : places;
  const activeWorkers = localOnly.length === 1 ? workers.slice(0, localOnly[0]?.slots ?? 0) : workers;
  const activeSuites = new Map(
    [...suites.entries()].filter(([name]) => plans.some((plan) => plan.active.includes(name))),
  );
  const useBatch = batchCap > 1 && activeWorkers.some(isAway);
  const chunkSize = useBatch
    ? Math.max(1, Math.min(batchCap, Math.ceil(plans.length / activeWorkers.length)))
    : 1;
  const chunks: BatchPlan[][] = [];
  for (let at = 0; at < plans.length; at += chunkSize) chunks.push(plans.slice(at, at + chunkSize));
  const rows = new Map<string, Record<string, boolean | null>>();
  const worker = (index: number): Worker => {
    const seat = activeWorkers[index];
    if (seat === undefined) throw new Error(`no copy for seat ${String(index)}`);
    return seat;
  };
  const { unrun, refused } = await spread(localOnly, chunks, {
    qualify: async ({ index }) =>
      opts.skipLocalQualify && !isAway(worker(index)) ? null : unfit(worker(index), activeSuites, seconds),
    halt: () => Date.now() >= deadline,
    run: async (chunk, { index }) => {
      const pending = chunk.filter(({ mutant }) => !rows.has(mutant.id));
      if (pending.length === 0) return "done";
      const seat = worker(index);
      if (useBatch && isAway(seat)) {
        const { rows: got, dropped } = await runBatch(seat, pending, suites, {
          stopAtKill,
          seconds,
          deadline,
        });
        for (const row of got) if (!rows.has(row.id)) rows.set(row.id, row.killed);
        if (dropped) {
          console.error(`${seat.place.remote ?? "here"} gave no verdict, so takes no more mutants`);
          return "elsewhere";
        }
        return "done";
      }
      for (const plan of pending) {
        if (Date.now() >= deadline) break;
        const killed = await killsOf(seat, plan, { originals, suites, stopAtKill, seconds });
        if (killed === "elsewhere") {
          console.error(`${seat.place.remote ?? "here"} gave no verdict, so takes no more mutants`);
          return "elsewhere";
        }
        rows.set(plan.mutant.id, killed);
      }
      return "done";
    },
  });
  const left = unrun.flat().filter(({ mutant }) => !rows.has(mutant.id)).length;
  return { rows, refused, unrun: left };
}

async function planWave(
  root: string,
  files: readonly string[],
  mutants: readonly Mutant[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: { readonly prune: boolean; readonly minForPrune: number; readonly seconds: number },
): Promise<{
  readonly plans: BatchPlan[];
  readonly skipped: Map<string, Record<string, boolean | null>>;
  readonly pruned: boolean;
}> {
  const names = [...suites.keys()];
  const uncovered =
    opts.prune && mutants.length >= opts.minForPrune
      ? await coveragePrune(root, files, suites, opts.seconds)
      : null;
  const plans: BatchPlan[] = [];
  const skipped = new Map<string, Record<string, boolean | null>>();
  for (const mutant of mutants) {
    const active =
      uncovered === null
        ? names
        : names.filter((name) => uncovered.get(name)?.get(mutant.file)?.has(mutant.line) !== true);
    if (active.length === 0) {
      skipped.set(mutant.id, Object.fromEntries(names.map((name) => [name, false] as const)));
    } else {
      plans.push({ mutant, active });
    }
  }
  return { plans, skipped, pruned: uncovered !== null };
}

const EMPTY_WAVE: WaveOut = { rows: new Map(), refused: [], unrun: 0 };

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
  const seconds = args.int("timeout") ?? 300;
  const until = args.value("until");
  const deadline = until === null ? Number.POSITIVE_INFINITY : Date.parse(until);
  if (Number.isNaN(deadline)) return args.die(`--until ${String(until)} is not a time`);
  const ran = (count: number) =>
    console.log(`${String(count)} mutants run, ${String(done.size - count)} held before`);
  if (todo.length === 0) return ran(0);
  const stopAtKill = args.flag("stop-at-kill");
  const prune = args.flag("prune");
  const batchCap = Math.max(1, args.int("batch") ?? 1);
  const entries = [...suites.entries()];
  const split = prune && stopAtKill && entries.length >= 2 ? Math.ceil(entries.length / 2) : entries.length;
  const firstSuites = new Map(entries.slice(0, split));
  const restSuites = new Map(entries.slice(split));
  const firstPlan = await planWave(root, files, todo, firstSuites, { prune, minForPrune: 5, seconds });
  const pool =
    firstPlan.plans.length > 0 || restSuites.size > 0 ? workersFor(args, root, out, originals) : null;
  let read = 0;
  const record = (mutant: Mutant, killed: Record<string, boolean | null>) => {
    const { id, file, line, label } = mutant;
    appendFileSync(out, `${JSON.stringify({ id, file, line, label, killed })}\n`);
    done.add(id);
    read += 1;
  };
  const firstWave =
    firstPlan.plans.length === 0 || pool === null
      ? EMPTY_WAVE
      : await dispatchWave({
          ...pool,
          plans: firstPlan.plans,
          suites: firstSuites,
          originals,
          batchCap,
          stopAtKill,
          seconds,
          deadline,
          skipLocalQualify: firstPlan.pruned,
        });
  if (pool !== null && firstWave.refused.length === pool.places.length) {
    return args.die(firstWave.refused.join("\n"));
  }
  for (const why of firstWave.refused) console.error(`${why}; it takes no mutants`);
  const firstById = new Map([...firstPlan.skipped, ...firstWave.rows]);
  const survivors: Mutant[] = [];
  for (const mutant of todo) {
    const killed = firstById.get(mutant.id);
    if (killed === undefined) continue;
    if (restSuites.size === 0 || Object.values(killed).some(Boolean)) {
      const restNull = Object.fromEntries([...restSuites.keys()].map((name) => [name, null] as const));
      record(mutant, { ...killed, ...restNull });
    } else {
      survivors.push(mutant);
    }
  }
  let left = firstWave.unrun;
  if (survivors.length > 0 && restSuites.size > 0 && pool !== null) {
    const restPlan = await planWave(root, files, survivors, restSuites, { prune, minForPrune: 3, seconds });
    const restWave =
      restPlan.plans.length === 0
        ? EMPTY_WAVE
        : await dispatchWave({
            ...pool,
            plans: restPlan.plans,
            suites: restSuites,
            originals,
            batchCap,
            stopAtKill,
            seconds,
            deadline,
            skipLocalQualify: restPlan.pruned,
          });
    if (restWave.refused.length === pool.places.length) return args.die(restWave.refused.join("\n"));
    for (const why of restWave.refused) console.error(`${why}; it takes no mutants`);
    const restById = new Map([...restPlan.skipped, ...restWave.rows]);
    for (const mutant of survivors) {
      const part1 = firstById.get(mutant.id);
      const part2 = restById.get(mutant.id);
      if (part1 !== undefined && part2 !== undefined) record(mutant, { ...part1, ...part2 });
    }
    left += restWave.unrun;
  }
  ran(read);
  if (left > 0) {
    const why = Date.now() >= deadline ? ` at ${String(until)}` : ", since no place gave a verdict";
    args.die(`${String(left)} mutants left unrun${why}; run again`);
  }
}

function workersFor(
  args: CommandArgs,
  root: string,
  out: string,
  originals: ReadonlyMap<string, string>,
): { places: readonly Place[]; workers: Worker[] } {
  let places: readonly Place[] = [];
  try {
    places = (args.flag("fleet") ? fleetPlaces : checkPlaces)(root, args.int("jobs") ?? undefined);
  } catch (error) {
    args.die(`${errorMessage(error)}; ANA_CHECK_HOST=here without --fleet runs every suite on this machine`);
  }
  const localSlots = args.int("local") ?? 0;
  const localPlace: Place | null = localSlots > 0 && places.some(routed) ? { slots: localSlots } : null;
  if (localPlace !== null) places = [localPlace, ...places];
  if (places.some((place) => place.remote !== undefined)) {
    console.error(`mutants run on ${namedPlaces(places)} at once`);
  }
  const head = gitMaybe(root, "rev-parse", "HEAD");
  const stamp = head !== null && gitMaybe(root, "status", "--porcelain") === "" ? `${root}\n${head}` : null;
  const workers = places
    .flatMap((place) => Array.from({ length: place.slots }, () => place))
    .map((place, index) => ({
      place,
      clone: `${args.value("clones") ?? out}.clone-${String(index)}`,
      local: place === localPlace || !routed(place),
    }));
  const rootModules = join(root, "node_modules");
  for (const { local, clone } of workers) {
    const stampPath = join(clone, STAMP_FILE);
    const reusable = stamp !== null && existsSync(stampPath) && readFileSync(stampPath, "utf8") === stamp;
    if (!reusable) {
      cpSync(root, clone, {
        recursive: true,
        force: true,
        filter: (path) => basename(path) !== "node_modules",
      });
      if (stamp !== null) writeFileSync(stampPath, stamp);
    }
    const cloneModules = join(clone, "node_modules");
    if (local && existsSync(rootModules) && !existsSync(cloneModules)) {
      symlinkSync(rootModules, cloneModules);
    }
    if (!local && existsSync(cloneModules)) rmSync(cloneModules, { recursive: true, force: true });
    rmSync(join(clone, BATCH_FILE), { force: true });
    for (const [file, text] of originals) writeFileSync(join(clone, file), text);
  }
  return { places, workers };
}

async function unfit(
  worker: Worker,
  suites: ReadonlyMap<string, readonly string[]>,
  seconds: number,
): Promise<string | null> {
  const all = [...new Set([...suites.values()].flat())];
  if (all.length === 0) return "no suites given";
  if (suites.size > 1 && (await verdict(worker, all, seconds)) === false) return null;
  for (const [name, paths] of suites) {
    const said = await verdict(worker, paths, seconds);
    if (said === false) continue;
    const at = worker.place.remote === undefined ? "" : ` on ${worker.place.remote}`;
    return `baseline suite "${name}" did not pass unmutated (${said === true ? "failed" : "no verdict"})${at}`;
  }
  return null;
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
    "       mutate.ts run <worktree> <file>... --out <jsonl> --suites <json> [--fleet] [--jobs N] [--local N] [--batch N] [--prune] [--only <ids>] [--stop-at-kill] [--timeout s] [--until <time>] [--clones <prefix>]",
    "       mutate.ts report <jsonl>... [--old <suite>] [--survivors]",
  ].join("\n");
  await runCommand(
    {
      name: "mutate",
      usage,
      options: {
        out: "text",
        suites: "text",
        fleet: "flag",
        jobs: "int",
        local: "int",
        batch: "int",
        prune: "flag",
        only: "text",
        "stop-at-kill": "flag",
        timeout: "int",
        old: "text",
        survivors: "flag",
        until: "text",
        clones: "text",
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

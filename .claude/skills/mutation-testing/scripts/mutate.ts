#!/usr/bin/env bun
/**
 * Mutation oracle for a commit-r pass (step 8): syntactic mutants of high-importance owner files,
 * run against named suites that must first pass unmutated, recording which suites kill each. `list`
 * counts mutants per file. `run` appends one JSON line per mutant to `--out` (or per-owner outputs
 * in `--plan`), skipping recorded ones so an interrupted run resumes; pure deterministic suites
 * screen via in-process mutant schemata (`mutate-schema.ts`) and remaining work spreads over check
 * places (`mutate-pool.ts`, `tools/runs/host-config.ts`). `report` tabulates per-file kills across
 * `--old` and the other suites (or solo `killed / survived / unread` counts), and `--survivors`
 * prints surviving IDs, then the unread ones a rerun must bring to a verdict.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  appendFileSync,
  cloneFile,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe, gitOutput } from "#src/meta/git.ts";
import { dirname, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { checkPlaces, fleetPlaces, hostsFor, namedPlaces, type Place } from "#tools/runs/host-config.ts";
import * as ts from "typescript5";
import {
  BATCH_FILE,
  type FastWorker,
  isAway,
  measureCoverage,
  routed,
  spawnsSubprocess,
  type VerdictMap,
} from "./mutate-exec.ts";
import { type PoolTask, runFleetPool, UNKNOWN_SUITE_MS } from "./mutate-pool.ts";
import { type SchemaMutant, screenFileWithSchemata } from "./mutate-schema.ts";

type Mutant = SchemaMutant;

interface Result {
  readonly id: string;
  readonly file: string;
  readonly killed: VerdictMap;
}

interface OwnerSpec {
  readonly file: string;
  readonly out: string;
  readonly suites: Record<string, readonly string[]>;
  readonly ids?: readonly string[];
}

interface TargetItem {
  readonly mutant: Mutant;
  readonly out: string;
  readonly suites: readonly string[];
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

const STAMP_FILE = ".ana-clone-stamp";

function cloneGitTree(root: string, dest: string): boolean {
  if (gitMaybe(root, "rev-parse", "--show-prefix") !== "") return false;
  const objects = gitMaybe(root, "rev-parse", "--path-format=absolute", "--git-path", "objects");
  if (objects === null) return false;
  let listed: string;
  try {
    listed = gitOutput(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard");
  } catch {
    return false;
  }
  if (gitMaybe(dest, "init", "-q") === null) return false;
  mkdirSync(join(dest, ".git", "objects", "info"), { recursive: true });
  writeFileSync(join(dest, ".git", "objects", "info", "alternates"), `${objects}\n`);
  const head = gitMaybe(root, "rev-parse", "-q", "--verify", "HEAD^{commit}");
  if (head !== null) writeFileSync(join(dest, ".git", "HEAD"), `${head}\n`);
  const index = gitMaybe(root, "rev-parse", "--path-format=absolute", "--git-path", "index");
  if (index !== null && existsSync(index)) cloneFile(index, join(dest, ".git", "index"));
  const refs = gitMaybe(root, "for-each-ref", "--format=%(objectname) %(refname)");
  if (refs !== null && refs.length > 0) {
    writeFileSync(
      join(dest, ".git", "packed-refs"),
      `# pack-refs with: peeled fully-peeled sorted \n${refs}\n`,
    );
  }
  const common = gitMaybe(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common !== null) {
    const shallow = join(common, "shallow");
    if (existsSync(shallow)) cloneFile(shallow, join(dest, ".git", "shallow"));
  }
  const made = new Set<string>();
  for (const rel of listed.split("\0")) {
    if (rel === "" || rel.startsWith(".ana-mutate") || rel.includes("/.ana-mutate")) continue;
    const src = join(root, rel);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(src);
    } catch {
      continue;
    }
    const dst = join(dest, rel);
    const parent = dirname(dst);
    if (!made.has(parent)) {
      mkdirSync(parent, { recursive: true });
      made.add(parent);
    }
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), dst);
    else if (stat.isFile()) cloneFile(src, dst);
  }
  return true;
}

async function cloneTree(root: string, dest: string): Promise<void> {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  if (cloneGitTree(root, dest)) return;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(root).filter(
    (name) =>
      name !== "node_modules" && !name.startsWith(".ana-wall-probe-") && !name.startsWith(".ana-mutate"),
  );
  if (runtimeProcess.platform === "darwin" && entries.length > 0) {
    const cow = Bun.spawn(["cp", "-cRp", ...entries.map((name) => join(root, name)), dest], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await cow.exited) === 0) return;
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
  }
  for (const name of entries) cpSync(join(root, name), join(dest, name), { recursive: true, force: true });
}

function linkModules(root: string, clone: string, placement: "local" | "remote"): void {
  for (const rel of ["node_modules", join("packages", "ui", "node_modules")]) {
    const src = join(root, rel);
    const dst = join(clone, rel);
    if (placement === "local" && existsSync(src) && existsSync(dirname(dst)) && !existsSync(dst)) {
      symlinkSync(src, dst);
    }
    if (placement === "remote" && existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  }
}

function loadSpecs(args: CommandArgs, files: readonly string[]): readonly OwnerSpec[] {
  const planPath = args.value("plan");
  if (planPath !== null) {
    // SAFETY: `--plan` is the JSON owner list written by `nightly.ts`.
    return JSON.parse(readFileSync(planPath, "utf8")) as OwnerSpec[];
  }
  const out = args.required("out");
  // SAFETY: the suites file is the caller's own map of a suite's name to its test paths.
  const suites = JSON.parse(readFileSync(args.required("suites"), "utf8")) as Record<string, string[]>;
  const only = args.value("only");
  const ids = only === null ? undefined : linesOf(only);
  return files.map((file) => (ids === undefined ? { file, out, suites } : { file, out, suites, ids }));
}

function collectTargets(
  root: string,
  specs: readonly OwnerSpec[],
): {
  readonly originals: Map<string, string>;
  readonly allSuites: Map<string, readonly string[]>;
  readonly todo: TargetItem[];
  readonly heldBefore: number;
} {
  const originals = new Map<string, string>();
  const doneByOut = new Map<string, Set<string>>();
  const allSuites = new Map<string, readonly string[]>();
  const todo: TargetItem[] = [];
  for (const spec of specs) {
    if (!originals.has(spec.file)) originals.set(spec.file, readFileSync(join(root, spec.file), "utf8"));
    let seen = doneByOut.get(spec.out);
    if (seen === undefined) {
      // SAFETY: every line of `spec.out` is one this script appended, a `Result`.
      seen = new Set(linesOf(spec.out).map((line) => (JSON.parse(line) as Result).id));
      doneByOut.set(spec.out, seen);
    }
    const entries = Object.entries(spec.suites);
    const names = entries.map(([name]) => name);
    for (const [name, paths] of entries) allSuites.set(name, paths);
    const wanted =
      spec.ids === undefined ? null : new Set(spec.ids.filter((id) => id.startsWith(`${spec.file}:`)));
    const current = mutantsOf(root, spec.file);
    if (wanted !== null && wanted.size > 0) {
      const currentIds = new Set(current.map((mutant) => mutant.id));
      const stale = [...wanted].filter((id) => !currentIds.has(id)).length;
      if (stale > 0) {
        console.error(
          `stale --only IDs in ${spec.file}: ${String(stale)}/${String(wanted.size)} matched no current mutant (code moved since recorded)`,
        );
      }
    }
    for (const mutant of current) {
      if (!seen.has(mutant.id) && (wanted?.has(mutant.id) ?? true)) {
        todo.push({ mutant, out: spec.out, suites: names });
      }
    }
  }
  const heldBefore = [...doneByOut.values()].reduce((sum, set) => sum + set.size, 0);
  return { originals, allSuites, todo, heldBefore };
}

function workersFor(
  args: CommandArgs,
  root: string,
  clonePrefix: string,
  originals: ReadonlyMap<string, string>,
): {
  places: readonly Place[];
  workers: FastWorker[];
  prepare: (seats: readonly FastWorker[]) => Promise<void>;
} {
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
      clone: `${clonePrefix}.clone-${String(index)}`,
      local: place === localPlace || !routed(place),
    }));
  const ready = new Set<string>();
  const prepareOne = async ({ local, clone }: FastWorker): Promise<void> => {
    if (ready.has(clone)) return;
    ready.add(clone);
    const stampPath = join(clone, STAMP_FILE);
    const reusable = stamp !== null && existsSync(stampPath) && readFileSync(stampPath, "utf8") === stamp;
    if (!reusable) {
      await cloneTree(root, clone);
      if (stamp !== null) writeFileSync(stampPath, stamp);
    }
    linkModules(root, clone, local ? "local" : "remote");
    rmSync(join(clone, BATCH_FILE), { force: true });
    for (const [file, text] of originals) writeFileSync(join(clone, file), text);
  };
  return {
    places,
    workers,
    prepare: async (seats) => {
      await Promise.all(seats.map(prepareOne));
    },
  };
}

type KillMode = "stop-at-kill" | "all";

interface PendingItem {
  readonly item: TargetItem;
  readonly rest: readonly string[];
}

function finalizeRow(
  names: readonly string[],
  prior: ReadonlyMap<string, boolean | null> | undefined,
  raw: Readonly<VerdictMap>,
  mode: KillMode,
): VerdictMap {
  const out = new Map<string, boolean | null>();
  const killed = [...(prior?.values() ?? []), ...Object.values(raw)].some(Boolean);
  for (const name of names) {
    if (name in raw) out.set(name, raw[name] ?? null);
    else if (prior?.has(name) === true) out.set(name, prior.get(name) ?? null);
    else out.set(name, mode === "stop-at-kill" && killed ? null : false);
  }
  return Object.fromEntries(out);
}

async function runSchemataStage(opts: {
  readonly root: string;
  readonly todo: readonly TargetItem[];
  readonly originals: ReadonlyMap<string, string>;
  readonly allSuites: ReadonlyMap<string, readonly string[]>;
  readonly seconds: number;
  readonly stopAtKill: boolean;
  readonly concurrency: number;
}) {
  const priorById = new Map<string, Map<string, boolean | null>>();
  const localQualified = new Set<string>();
  const durations = new Map<string, number>();
  const byFile = Map.groupBy(opts.todo, (item) => item.mutant.file);
  for (const [file, items] of byFile) {
    const suiteOrder = [...new Set(items.flatMap((item) => item.suites))];
    const res = await screenFileWithSchemata({
      root: opts.root,
      file,
      source: opts.originals.get(file) ?? "",
      mutants: items.map((item) => item.mutant),
      suites: opts.allSuites,
      suiteOrder,
      capSeconds: opts.seconds,
      stopAtKill: opts.stopAtKill,
      concurrency: opts.concurrency,
    });
    for (const [name, ms] of res.durations) durations.set(name, ms);
    for (const [id, row] of res.verdicts) priorById.set(id, row);
  }
  return { priorById, localQualified, durations };
}

function splitAfterSchema(
  todo: readonly TargetItem[],
  priorById: ReadonlyMap<string, Map<string, boolean | null>>,
  mode: KillMode,
  record: (item: TargetItem, killed: VerdictMap) => void,
): PendingItem[] {
  const remaining: PendingItem[] = [];
  for (const item of todo) {
    const prior = priorById.get(item.mutant.id);
    if (prior !== undefined && mode === "stop-at-kill" && [...prior.values()].includes(true)) {
      record(item, finalizeRow(item.suites, prior, {}, "stop-at-kill"));
      continue;
    }
    const rest = prior === undefined ? item.suites : item.suites.filter((name) => !prior.has(name));
    if (rest.length === 0) record(item, finalizeRow(item.suites, prior, {}, mode));
    else remaining.push({ item, rest });
  }
  return remaining;
}

function buildPoolTasks(opts: {
  readonly afterSchema: readonly PendingItem[];
  readonly priorById: ReadonlyMap<string, Map<string, boolean | null>>;
  readonly uncovered: ReadonlyMap<string, Map<string, Set<number>>>;
  readonly durations: ReadonlyMap<string, number>;
  readonly runCov: boolean;
  readonly mode: KillMode;
  readonly record: (item: TargetItem, killed: VerdictMap) => void;
}): PoolTask[] {
  const tasks: PoolTask[] = [];
  for (const { item, rest } of opts.afterSchema) {
    const active = opts.runCov
      ? rest.filter((name) => opts.uncovered.get(name)?.get(item.mutant.file)?.has(item.mutant.line) !== true)
      : rest;
    if (active.length === 0) {
      opts.record(item, finalizeRow(item.suites, opts.priorById.get(item.mutant.id), {}, opts.mode));
    } else {
      const [first, ...restSuites] = active;
      const tailFactor = opts.mode === "stop-at-kill" ? 0.25 : 1;
      const weightMs =
        first === undefined
          ? 0
          : (opts.durations.get(first) ?? UNKNOWN_SUITE_MS) +
            restSuites.reduce(
              (sum, name) => sum + (opts.durations.get(name) ?? UNKNOWN_SUITE_MS) * tailFactor,
              0,
            );
      tasks.push({ key: item.mutant.id, plan: { mutant: item.mutant, active }, weightMs });
    }
  }
  return tasks;
}

async function dispatchRemaining(opts: {
  readonly args: CommandArgs;
  readonly root: string;
  readonly pool: ReturnType<typeof workersFor>;
  readonly afterSchema: readonly PendingItem[];
  readonly priorById: ReadonlyMap<string, Map<string, boolean | null>>;
  readonly localQualified: Set<string>;
  readonly durations: Map<string, number>;
  readonly originals: ReadonlyMap<string, string>;
  readonly allSuites: ReadonlyMap<string, readonly string[]>;
  readonly prune: boolean;
  readonly cacheDir: string | null;
  readonly batchCap: number;
  readonly mode: KillMode;
  readonly seconds: number;
  readonly deadline: number;
  readonly record: (item: TargetItem, killed: VerdictMap) => void;
}): Promise<number> {
  const leadNeeded = new Set(
    opts.afterSchema.flatMap(({ rest }) => {
      if (opts.mode !== "stop-at-kill" || rest.length < 2) return rest;
      const keep = Math.min(rest.length - 1, Math.max(1, Math.floor((rest.length * 2) / 3)));
      return rest.slice(0, keep);
    }),
  );
  const covSuites = new Map(
    [...opts.allSuites.entries()].filter(
      ([name, paths]) =>
        leadNeeded.has(name) && !opts.localQualified.has(name) && !spawnsSubprocess(opts.root, paths),
    ),
  );
  const runCov =
    opts.prune && (opts.afterSchema.length >= 5 || (opts.cacheDir !== null && existsSync(opts.cacheDir)));
  const localSlots = opts.pool.workers[0]?.local === true ? (opts.pool.places[0]?.slots ?? 1) : 0;
  const pickWorkers = (scope: "local" | "fleet") => {
    if (scope === "local") return opts.pool.workers.slice(0, localSlots);
    if (opts.batchCap <= 1) return opts.pool.workers;
    const local = opts.pool.workers.filter((seat) => !isAway(seat));
    const remote = [
      ...new Map(
        opts.pool.workers.filter(isAway).map((seat) => [seat.place.remote ?? "remote", seat] as const),
      ).values(),
    ];
    return [...local, ...remote];
  };
  const stayLocal = localSlots > 0 && opts.afterSchema.length <= localSlots;
  const activeWorkers = pickWorkers(stayLocal ? "local" : "fleet");
  const [cov] = await Promise.all([
    runCov
      ? measureCoverage(opts.root, covSuites, [...opts.originals.keys()], {
          seconds: opts.seconds,
          cacheDir: opts.cacheDir,
        })
      : Promise.resolve({
          uncovered: new Map<string, Map<string, Set<number>>>(),
          covered: new Map<string, Map<string, number>>(),
          passed: new Set<string>(),
          durations: new Map<string, number>(),
        }),
    opts.pool.prepare(activeWorkers),
  ]);
  for (const name of cov.passed) opts.localQualified.add(name);
  for (const [name, ms] of cov.durations) opts.durations.set(name, ms);
  const tasks = buildPoolTasks({
    afterSchema: opts.afterSchema,
    priorById: opts.priorById,
    uncovered: cov.uncovered,
    durations: opts.durations,
    runCov,
    mode: opts.mode,
    record: opts.record,
  });
  if (tasks.length === 0) return 0;
  const byId = new Map(opts.afterSchema.map(({ item }) => [item.mutant.id, item] as const));
  const finalStayLocal = localSlots > 0 && tasks.length <= localSlots;
  const finalWorkers = pickWorkers(finalStayLocal ? "local" : "fleet");
  if (!finalStayLocal && stayLocal) await opts.pool.prepare(finalWorkers);
  const { refused, unrun } = await runFleetPool({
    activeWorkers: finalWorkers,
    tasks,
    suites: opts.allSuites,
    originals: opts.originals,
    durations: opts.durations,
    covered: cov.covered,
    localQualified: opts.localQualified,
    batchCap: opts.batchCap,
    stopAtKill: opts.mode === "stop-at-kill",
    seconds: opts.seconds,
    deadline: opts.deadline,
    onResult: (task, raw) => {
      const item = byId.get(task.plan.mutant.id);
      if (item !== undefined) {
        opts.record(item, finalizeRow(item.suites, opts.priorById.get(item.mutant.id), raw, opts.mode));
      }
    },
  });
  if (refused.length >= (finalStayLocal ? 1 : opts.pool.places.length)) opts.args.die(refused.join("\n"));
  for (const why of refused) console.error(`${why}; it takes no mutants`);
  return unrun;
}

async function runMutants(args: CommandArgs, root: string, files: readonly string[]): Promise<void> {
  const specs = loadSpecs(args, files);
  const stopAtKill = args.flag("stop-at-kill");
  const mode: KillMode = stopAtKill ? "stop-at-kill" : "all";
  const prune = args.flag("prune");
  const cacheDir = args.value("cov-cache");
  const batchCap = Math.max(1, args.int("batch") ?? 1);
  const seconds = args.int("timeout") ?? 300;
  const until = args.value("until");
  const deadline = until === null ? Number.POSITIVE_INFINITY : Date.parse(until);
  if (Number.isNaN(deadline)) return args.die(`--until ${String(until)} is not a time`);
  const { originals, allSuites, todo, heldBefore } = collectTargets(root, specs);
  if (todo.length === 0) {
    console.log(`0 mutants run, ${String(heldBefore)} held before`);
    return;
  }
  if ((runtimeProcess.env.ANA_HOSTS ?? "") === "") {
    const known = hostsFor(root);
    if (known.length > 0) runtimeProcess.env.ANA_HOSTS = JSON.stringify(known);
  }
  const pool = workersFor(
    args,
    root,
    args.value("clones") ?? specs[0]?.out ?? join(root, ".ana-mutate"),
    originals,
  );
  let read = 0;
  const record = (item: TargetItem, killed: VerdictMap) => {
    const { id, file, line, label } = item.mutant;
    appendFileSync(item.out, `${JSON.stringify({ id, file, line, label, killed })}\n`);
    read += 1;
  };
  const localCount = pool.workers.filter((seat) => !isAway(seat)).length;
  const useSchemata = prune && stopAtKill && localCount > 0 && Date.now() < deadline;
  const schema = useSchemata
    ? await runSchemataStage({
        root,
        todo,
        originals,
        allSuites,
        seconds,
        stopAtKill,
        concurrency: localCount,
      })
    : {
        priorById: new Map<string, Map<string, boolean | null>>(),
        localQualified: new Set<string>(),
        durations: new Map<string, number>(),
      };
  const afterSchema = splitAfterSchema(todo, schema.priorById, mode, record);
  const left =
    afterSchema.length === 0
      ? 0
      : await dispatchRemaining({
          args,
          root,
          pool,
          afterSchema,
          priorById: schema.priorById,
          localQualified: schema.localQualified,
          durations: schema.durations,
          originals,
          allSuites,
          prune,
          cacheDir,
          batchCap,
          mode,
          seconds,
          deadline,
          record,
        });
  console.log(`${String(read)} mutants run, ${String(heldBefore)} held before`);
  if (left > 0) {
    const why = Date.now() >= deadline ? ` at ${String(until)}` : ", since no place gave a verdict";
    args.die(`${String(left)} mutants left unrun${why}; run again`);
  }
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
          return verdicts.length > 0 && verdicts.every((one) => one === false) ? "survived" : "unread";
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
    "       mutate.ts run <worktree> [<file>...] --out <jsonl> --suites <json> | --plan <json> [--fleet] [--jobs N] [--local N] [--batch N] [--prune] [--cov-cache <dir>] [--only <ids>] [--stop-at-kill] [--timeout s] [--until <time>] [--clones <prefix>]",
    "       mutate.ts report <jsonl>... [--old <suite>] [--survivors]",
  ].join("\n");
  await runCommand(
    {
      name: "mutate",
      usage,
      options: {
        out: "text",
        suites: "text",
        plan: "text",
        fleet: "flag",
        jobs: "int",
        local: "int",
        batch: "int",
        prune: "flag",
        "cov-cache": "text",
        only: "text",
        "stop-at-kill": "flag",
        timeout: "int",
        until: "text",
        clones: "text",
        old: "text",
        survivors: "flag",
      },
      positionals: [1, Number.POSITIVE_INFINITY],
    },
    async (args: CommandArgs) => {
      const [sub, ...rest] = args.positionals;
      if (sub === "list") {
        const [root, ...files] = rest;
        if (root === undefined || files.length === 0) args.die(usage);
        for (const file of files) console.log(`${file}\t${String(mutantsOf(root, file).length)}`);
        return;
      }
      if (sub === "run") {
        const [root, ...files] = rest;
        if (root === undefined || (files.length === 0 && args.value("plan") === null)) args.die(usage);
        await runMutants(args, root, files);
        return;
      }
      if (sub === "report") {
        if (rest.length === 0) args.die(usage);
        report(args, rest);
        return;
      }
      args.die(usage);
    },
  );
}

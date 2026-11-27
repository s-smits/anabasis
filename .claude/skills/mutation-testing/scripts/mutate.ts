#!/usr/bin/env bun
/**
 * Mutation oracle for a commit-r pass (step 8): syntactic mutants of high-importance owner files,
 * run against named suites that must first pass unmutated, recording which suites kill each. `list`
 * counts mutants per file. `run` appends one JSON line per mutant to `--out` (or per-owner outputs
 * in `--plan`), skipping recorded ones so an interrupted run resumes; mutants spread over the check
 * places (`checkPlaces`, `tools/runs/host-config.ts`), one worker a slot on its own copy of the
 * tree (`<out>.clone-<k>`, or `--clones <prefix>`), running `bun test --bail` under `--timeout`, or
 * at the one place `ANA_CHECK_HOST` names (this machine for `here`) or this machine where no host
 * is listed; `--fleet` spreads over every listed host whatever `ANA_CHECK_HOST` says
 * (`fleetPlaces`). `--jobs N` caps workers; a place that gives no verdict hands its mutant back and
 * takes no more; `--until` stops taking mutants at that time. A run with no pass, fail or bail
 * count, or one `--timeout` ends, records `null` rather than a kill. `report` tabulates per-file
 * kills across `--old` and the other suites (or solo `killed / survived / unread` counts), and
 * `--survivors` prints surviving IDs, then the unread ones a rerun must bring to a verdict.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { availableParallelism } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
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
import {
  BATCH_FILE,
  type BatchPlan,
  buildPlans,
  type CoverageHandle,
  cloneTree,
  type FastMutant,
  type FastWorker,
  linkModules,
  mergeWaveRow,
  type PoolTask,
  runContinuousPool,
  startCoverage,
  VERDICT_RE,
  type VerdictMap,
} from "./mutate-fast.ts";

type Mutant = FastMutant;

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
  readonly firstSuites: readonly string[];
  readonly restSuites: readonly string[];
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

const routed = ({ remote }: Place): boolean =>
  remote !== undefined || !["", "here"].includes(checkHost()?.trim() ?? "");

const isAway = (worker: FastWorker): boolean => !worker.local && routed(worker.place);

async function verdict(worker: FastWorker, paths: readonly string[], seconds: number, localConc: number) {
  const away = isAway(worker);
  const wall = `--timeout=${String(PER_TEST_WALL_MS)}`;
  const bin = away ? "bun" : capturedExecPath;
  const conc = `--max-concurrency=${String(away ? 4 : localConc)}`;
  const run = Bun.spawn([bin, "test", "--bail", conc, wall, ...paths], {
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

async function killsOf(
  seat: FastWorker,
  plan: BatchPlan,
  opts: {
    readonly originals: ReadonlyMap<string, string>;
    readonly suites: ReadonlyMap<string, readonly string[]>;
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly localConc: number;
  },
): Promise<Record<string, boolean | null> | "elsewhere"> {
  const { mutant, active } = plan;
  const original = opts.originals.get(mutant.file) ?? "";
  writeFileSync(
    join(seat.clone, mutant.file),
    original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end),
  );
  try {
    const killed: Record<string, boolean | null> = {};
    for (const name of active) {
      const stopped = opts.stopAtKill && Object.values(killed).some(Boolean);
      const said = stopped
        ? null
        : await verdict(seat, opts.suites.get(name) ?? [], opts.seconds, opts.localConc);
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

const EMPTY_WAVE: WaveOut = { rows: new Map(), refused: [], unrun: 0 };

async function runPooledMutants(opts: {
  readonly args: CommandArgs;
  readonly pool: ReturnType<typeof workersFor>;
  readonly todo: readonly TargetItem[];
  readonly firstPlan: ReturnType<typeof buildPlans>;
  readonly firstCov: Awaited<ReturnType<CoverageHandle["waitFor"]>> | null;
  readonly restCovHandle: CoverageHandle | null;
  readonly allSuites: ReadonlyMap<string, readonly string[]>;
  readonly originals: ReadonlyMap<string, string>;
  readonly batchCap: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly record: (item: TargetItem, killed: VerdictMap) => void;
}): Promise<number> {
  const {
    args,
    pool,
    todo,
    firstPlan,
    firstCov,
    restCovHandle,
    allSuites,
    originals,
    batchCap,
    stopAtKill,
    seconds,
    deadline,
    record,
  } = opts;
  const byId = new Map(todo.map((item) => [item.mutant.id, item] as const));
  const firstById = new Map<string, VerdictMap>();
  const neededRest = new Set<string>();
  const durations = new Map<string, number>(firstCov?.durations);
  const weightOf = (active: readonly string[]) =>
    active.reduce((sum, name) => sum + (durations.get(name) ?? 1000), 0);
  let completed = 0;
  let phase1Done = 0;
  let waitingRestCov = 0;
  const initial: PoolTask[] = firstPlan.plans.map((plan) => {
    const item = byId.get(plan.mutant.id);
    const weightMs = weightOf(plan.active);
    const hasRest = (item?.restSuites.length ?? 0) > 0;
    const screenPriority = weightMs < 300 ? 3 : 2;
    const priority = hasRest ? screenPriority : 1;
    return { key: `1:${plan.mutant.id}`, plan, weightMs, priority };
  });
  const enqueueRef = {
    push: (task: PoolTask) => {
      initial.push(task);
    },
  };
  const settlePhase1 = (item: TargetItem, killed1: VerdictMap) => {
    phase1Done += 1;
    firstById.set(item.mutant.id, killed1);
    if (item.restSuites.length === 0 || Object.values(killed1).some(Boolean)) {
      record(item, {
        ...killed1,
        ...Object.fromEntries(item.restSuites.map((name) => [name, null] as const)),
      });
      completed += 1;
    } else {
      for (const name of item.restSuites) neededRest.add(name);
      waitingRestCov += 1;
      const wait =
        restCovHandle === null
          ? Promise.resolve(null)
          : restCovHandle.waitFor(item.restSuites, [item.mutant.file]);
      wait.then(
        (cov) => {
          waitingRestCov -= 1;
          const uncovered = new Map([...(firstCov?.uncovered ?? []), ...(cov?.uncovered ?? [])]);
          if (cov !== null) for (const [name, ms] of cov.durations) durations.set(name, ms);
          const active =
            firstCov === null && cov === null
              ? item.restSuites
              : item.restSuites.filter(
                  (name) => uncovered.get(name)?.get(item.mutant.file)?.has(item.mutant.line) !== true,
                );
          if (active.length === 0) {
            record(item, {
              ...killed1,
              ...Object.fromEntries(item.restSuites.map((name) => [name, false] as const)),
            });
            completed += 1;
          } else {
            enqueueRef.push({
              key: `2:${item.mutant.id}`,
              plan: { mutant: item.mutant, active },
              weightMs: weightOf(active),
              priority: 1,
            });
          }
        },
        () => {
          waitingRestCov -= 1;
        },
      );
    }
    if (phase1Done >= todo.length) restCovHandle?.cancelExcept(neededRest);
  };
  for (const item of todo) {
    const skipped = firstPlan.skipped.get(item.mutant.id);
    if (skipped !== undefined) settlePhase1(item, skipped);
  }
  const firstPlace = pool.places[0];
  const localSlots = pool.workers[0]?.local === true ? (firstPlace?.slots ?? 1) : 0;
  const stayLocal =
    firstPlace !== undefined && localSlots > 0 && todo.length <= localSlots && initial.length <= localSlots;
  const activeWorkers = stayLocal ? pool.workers.slice(0, localSlots) : pool.workers;
  const localConc = Math.min(4, Math.max(1, Math.floor(availableParallelism() / Math.max(1, localSlots))));
  await pool.prepare(activeWorkers);
  const localQualifySuites = new Map(
    [...allSuites.entries()].filter(
      ([name]) =>
        !(firstCov?.passed.has(name) ?? false) &&
        !(restCovHandle?.readyNames().has(name) ?? false) &&
        initial.some((task) => task.plan.active.includes(name)),
    ),
  );
  const { refused } = await runContinuousPool({
    activeWorkers,
    isAway,
    initial,
    suites: allSuites,
    batchCap,
    stopAtKill,
    seconds,
    deadline,
    qualifyLocal: (seat) =>
      localQualifySuites.size === 0
        ? Promise.resolve(null)
        : unfit(seat, localQualifySuites, seconds, localConc),
    runLocal: (seat, plan) =>
      killsOf(seat, plan, { originals, suites: allSuites, stopAtKill, seconds, localConc }),
    remoteQualified: new Map<string, Set<string>>(),
    isDone: () => completed >= todo.length,
    hasWaiting: () => waitingRestCov > 0,
    onResult: (task, raw) => {
      const item = byId.get(task.plan.mutant.id);
      if (item === undefined) return;
      const mode = stopAtKill ? "stop-at-kill" : "all";
      if (task.key.startsWith("1:")) {
        settlePhase1(item, mergeWaveRow(item.firstSuites, raw, mode));
      } else {
        const part1 = firstById.get(item.mutant.id);
        if (part1 !== undefined) {
          record(item, { ...part1, ...mergeWaveRow(item.restSuites, raw, mode) });
          completed += 1;
        }
      }
    },
    enqueueRef,
  });
  if (refused.length >= (stayLocal ? 1 : pool.places.length)) args.die(refused.join("\n"));
  for (const why of refused) console.error(`${why}; it takes no mutants`);
  return todo.length - completed;
}

async function dispatchWave(opts: {
  readonly places: readonly Place[];
  readonly workers: readonly FastWorker[];
  readonly prepare: (seats: readonly FastWorker[]) => Promise<void>;
  readonly plans: readonly BatchPlan[];
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly originals: ReadonlyMap<string, string>;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly localPassed: ReadonlySet<string>;
}): Promise<WaveOut> {
  const { places, workers, plans, suites, originals, stopAtKill, seconds, deadline } = opts;
  const localSlots = workers[0]?.local === true ? (places[0]?.slots ?? 1) : 0;
  const localConc = Math.min(4, Math.max(1, Math.floor(availableParallelism() / Math.max(1, localSlots))));
  await opts.prepare(workers);
  const activeSuites = new Map(
    [...suites.entries()].filter(([name]) => plans.some((plan) => plan.active.includes(name))),
  );
  const localQualifySuites = new Map(
    [...activeSuites.entries()].filter(([name]) => !opts.localPassed.has(name)),
  );
  const rows = new Map<string, VerdictMap>();
  const worker = (index: number): FastWorker => {
    const seat = workers[index];
    if (seat === undefined) throw new Error(`no copy for seat ${String(index)}`);
    return seat;
  };
  const { unrun, refused } = await spread(places, plans, {
    qualify: async ({ index }) => {
      const seat = worker(index);
      if (!isAway(seat)) {
        return localQualifySuites.size === 0 ? null : unfit(seat, localQualifySuites, seconds, localConc);
      }
      return unfit(seat, activeSuites, seconds, localConc);
    },
    halt: () => Date.now() >= deadline,
    run: async (plan, { index }) => {
      if (rows.has(plan.mutant.id)) return "done";
      const seat = worker(index);
      const killed = await killsOf(seat, plan, { originals, suites, stopAtKill, seconds, localConc });
      if (killed === "elsewhere") {
        console.error(`${seat.place.remote ?? "here"} gave no verdict, so takes no more mutants`);
        return "elsewhere";
      }
      rows.set(plan.mutant.id, killed);
      return "done";
    },
  });
  const left = unrun.filter(({ mutant }) => !rows.has(mutant.id)).length;
  return { rows, refused, unrun: left };
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
  waveMode: "waves" | "single",
): {
  readonly originals: Map<string, string>;
  readonly firstSuites: Map<string, readonly string[]>;
  readonly restSuites: Map<string, readonly string[]>;
  readonly todo: TargetItem[];
  readonly heldBefore: number;
} {
  const originals = new Map<string, string>();
  const doneByOut = new Map<string, Set<string>>();
  const firstSuites = new Map<string, readonly string[]>();
  const restSuites = new Map<string, readonly string[]>();
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
    const split =
      waveMode === "waves" && entries.length >= 2 ? Math.ceil(entries.length / 2) : entries.length;
    const firstNames = entries.slice(0, split).map(([name]) => name);
    const restNames = entries.slice(split).map(([name]) => name);
    for (const [name, paths] of entries.slice(0, split)) firstSuites.set(name, paths);
    for (const [name, paths] of entries.slice(split)) restSuites.set(name, paths);
    const wanted = spec.ids === undefined ? null : new Set(spec.ids);
    for (const mutant of mutantsOf(root, spec.file)) {
      if (!seen.has(mutant.id) && (wanted?.has(mutant.id) ?? true)) {
        todo.push({ mutant, out: spec.out, firstSuites: firstNames, restSuites: restNames });
      }
    }
  }
  const heldBefore = [...doneByOut.values()].reduce((sum, set) => sum + set.size, 0);
  return { originals, firstSuites, restSuites, todo, heldBefore };
}

function suiteBytes(root: string, paths: readonly string[]): number {
  return paths.reduce(
    (sum, path) => sum + (existsSync(join(root, path)) ? statSync(join(root, path)).size : 0),
    0,
  );
}

function orderRestSuites(
  root: string,
  todo: readonly TargetItem[],
  firstSuites: ReadonlyMap<string, readonly string[]>,
  restSuites: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const demand = new Map<string, number>();
  for (const item of todo) {
    for (const name of item.restSuites) demand.set(name, (demand.get(name) ?? 0) + 1);
  }
  return new Map(
    [...restSuites.entries()]
      .filter(([name]) => !firstSuites.has(name))
      .toSorted(
        (a, b) =>
          (demand.get(b[0]) ?? 0) - (demand.get(a[0]) ?? 0) ||
          suiteBytes(root, b[1]) - suiteBytes(root, a[1]),
      ),
  );
}

function uniqueHostSeats(workers: readonly FastWorker[]): FastWorker[] {
  return [
    ...workers.filter((seat) => !isAway(seat)),
    ...new Map(workers.filter(isAway).map((seat) => [seat.place.remote ?? "remote", seat] as const)).values(),
  ];
}

async function runMutants(args: CommandArgs, root: string, files: readonly string[]): Promise<void> {
  const specs = loadSpecs(args, files);
  const stopAtKill = args.flag("stop-at-kill");
  const prune = args.flag("prune");
  const cacheDir = args.value("cov-cache");
  const batchCap = Math.max(1, args.int("batch") ?? 1);
  const seconds = args.int("timeout") ?? 300;
  const until = args.value("until");
  const deadline = until === null ? Number.POSITIVE_INFINITY : Date.parse(until);
  if (Number.isNaN(deadline)) return args.die(`--until ${String(until)} is not a time`);
  const targets = collectTargets(root, specs, prune && stopAtKill ? "waves" : "single");
  const { originals, firstSuites: firstSuiteMap, restSuites: restSuiteMap, todo } = targets;
  if (todo.length === 0) {
    console.log(`0 mutants run, ${String(targets.heldBefore)} held before`);
    return;
  }
  const allSuites = new Map([...firstSuiteMap, ...restSuiteMap]);
  const hasCache = cacheDir !== null && existsSync(cacheDir);
  const pool = workersFor(
    args,
    root,
    args.value("clones") ?? specs[0]?.out ?? join(root, ".ana-mutate"),
    originals,
  );
  const orderedFirstSuites = new Map(
    [...firstSuiteMap.entries()].toSorted((a, b) => suiteBytes(root, b[1]) - suiteBytes(root, a[1])),
  );
  const restOnlySuites = orderRestSuites(root, todo, firstSuiteMap, restSuiteMap);
  const covSlots = Math.max(2, Math.floor(availableParallelism() / 3));
  const restCovHandle =
    prune && restOnlySuites.size > 0
      ? startCoverage(root, restOnlySuites, { seconds, cacheDir, maxParallel: 2, concurrency: 2 })
      : null;
  const firstCovHandle =
    prune && (todo.length >= 5 || hasCache)
      ? startCoverage(root, orderedFirstSuites, { seconds, cacheDir, maxParallel: covSlots, concurrency: 4 })
      : null;
  const preparePromise =
    prune && restOnlySuites.size > 0 ? pool.prepare(uniqueHostSeats(pool.workers)) : Promise.resolve();
  let read = 0;
  const record = (item: TargetItem, killed: VerdictMap) => {
    const { id, file, line, label } = item.mutant;
    appendFileSync(item.out, `${JSON.stringify({ id, file, line, label, killed })}\n`);
    read += 1;
  };
  try {
    const [firstCov] = await Promise.all([
      firstCovHandle ? firstCovHandle.waitFor([...firstSuiteMap.keys()], [...originals.keys()]) : null,
      preparePromise,
    ]);
    await firstCovHandle?.cancelAll();
    const firstPlan = buildPlans(todo, (item) => item.firstSuites, firstCov?.uncovered ?? null);
    const usePooled = (batchCap > 1 && pool.workers.some(isAway)) || restOnlySuites.size > 0;
    let left = 0;
    if (usePooled) {
      left = await runPooledMutants({
        args,
        pool,
        todo,
        firstPlan,
        firstCov,
        restCovHandle,
        allSuites,
        originals,
        batchCap,
        stopAtKill,
        seconds,
        deadline,
        record,
      });
    } else {
      const wave =
        firstPlan.plans.length === 0
          ? EMPTY_WAVE
          : await dispatchWave({
              ...pool,
              plans: firstPlan.plans,
              suites: firstSuiteMap,
              originals,
              stopAtKill,
              seconds,
              deadline,
              localPassed: firstCov?.passed ?? new Set<string>(),
            });
      if (wave.refused.length >= pool.places.length) return args.die(wave.refused.join("\n"));
      for (const why of wave.refused) console.error(`${why}; it takes no mutants`);
      for (const item of todo) {
        const raw = wave.rows.get(item.mutant.id);
        const killed =
          firstPlan.skipped.get(item.mutant.id) ??
          (raw === undefined
            ? undefined
            : mergeWaveRow(item.firstSuites, raw, stopAtKill ? "stop-at-kill" : "all"));
        if (killed !== undefined) record(item, killed);
      }
      left = wave.unrun;
    }
    console.log(`${String(read)} mutants run, ${String(targets.heldBefore)} held before`);
    if (left > 0) {
      const why = Date.now() >= deadline ? ` at ${String(until)}` : ", since no place gave a verdict";
      args.die(`${String(left)} mutants left unrun${why}; run again`);
    }
  } finally {
    await restCovHandle?.cancelAll();
  }
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
  const prepare = async (seats: readonly FastWorker[]): Promise<void> => {
    await Promise.all(seats.map(prepareOne));
  };
  return { places, workers, prepare };
}

async function unfit(
  worker: FastWorker,
  suites: ReadonlyMap<string, readonly string[]>,
  seconds: number,
  localConc: number,
): Promise<string | null> {
  const all = [...new Set([...suites.values()].flat())];
  if (all.length === 0) return "no suites given";
  if (suites.size > 1 && (await verdict(worker, all, seconds, localConc)) === false) return null;
  for (const [name, paths] of suites) {
    const said = await verdict(worker, paths, seconds, localConc);
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

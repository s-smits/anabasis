#!/usr/bin/env bun
/**
 * Mutation oracle for a commit-r pass (step 8): syntactic mutants of high-importance owner files,
 * run against named suites that must first pass unmutated, recording which suites kill each. `list`
 * counts mutants per file. `run` appends one JSON line per mutant to `--out`, skipping recorded
 * ones so an interrupted run resumes; mutants spread over the check places (`checkPlaces`,
 * `tools/runs/host-config.ts`), one worker a slot on its own copy of the tree (`<out>.clone-<k>`,
 * or `--clones <prefix>`), running `bun test --bail`, or at the one place `ANA_CHECK_HOST` names
 * (this machine for `here`) or this machine where no host is listed; `--fleet` spreads over every
 * listed host whatever `ANA_CHECK_HOST` says (`fleetPlaces`) and `--local N` adds N slots here.
 * `--jobs N` caps workers. Each place first runs every suite unmutated: a suite that fails there
 * reads `null` there, and a place where none passes takes no mutants; a suite run here that starts
 * no process reads `false`, unrun, for a mutant on a line its coverage shows it never runs. Under
 * `--stop-at-kill` a mutant tries first the suites that killed most per run and per millisecond on
 * its file so far. A place
 * that gives no verdict hands its mutant back and takes no more; `--until` stops taking mutants at that time. A run with
 * no pass, fail or bail count, or one past its wall (`--timeout`, at most ten times the suite's
 * unmutated time plus 30 s), records `null` rather than a kill. `report` tabulates per-file kills
 * across `--old` and the other suites (or solo `killed / survived / unread` counts), and
 * `--survivors` prints surviving IDs, then the unread ones a rerun must bring to a verdict.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { join, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
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
import { within } from "#tools/runtime/gate.ts";
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
  readonly line: number;
  readonly label: string;
  readonly killed: Record<string, boolean | null>;
}

export interface Job {
  readonly file: string;
  readonly out: string;
  readonly suites: Readonly<Record<string, readonly string[]>>;
  readonly ids?: ReadonlySet<string>;
}

export interface Settings {
  readonly fleet: boolean;
  readonly jobs: number | undefined;
  readonly local: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly clones: string;
}

interface Worker {
  readonly place: Place;
  readonly clone: string;
  readonly away: boolean;
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

// SAFETY: every line of a results file is one `runMutants` appended, a `Result`.
export const resultsOf = (path: string) => linesOf(path).map((line) => JSON.parse(line) as Result);

export function verdictOf({ killed }: Result): "killed" | "survived" | "unread" {
  const verdicts = Object.values(killed);
  if (verdicts.includes(true)) return "killed";
  return verdicts.length > 0 && verdicts.every((one) => one === false) ? "survived" : "unread";
}

function cloneTree(root: string, clone: string): void {
  rmSync(clone, { recursive: true, force: true });
  mkdirSync(clone, { recursive: true });
  const listed = gitMaybe(
    root,
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  );
  const ignored = new Set(["node_modules", "node_modules/", ...(listed ?? "").split("\0")]);
  const gitDir = gitMaybe(root, "rev-parse", "--absolute-git-dir");
  for (const name of readdirSync(root)) {
    if (name === ".git" && gitDir !== null) writeFileSync(join(clone, name), `gitdir: ${gitDir}\n`);
    else if (!ignored.has(name) && !ignored.has(`${name}/`)) {
      cpSync(join(root, name), join(clone, name), { recursive: true, verbatimSymlinks: true });
    }
  }
}

function workersFor(root: string, settings: Settings): { places: Place[]; workers: Worker[] } {
  let listed: readonly Place[];
  try {
    listed = (settings.fleet ? fleetPlaces : checkPlaces)(root, settings.jobs);
  } catch (error) {
    throw new Error(
      `${errorMessage(error)}; ANA_CHECK_HOST=here without --fleet runs every suite on this machine`,
      { cause: error },
    );
  }
  const named = !["", "here"].includes(checkHost()?.trim() ?? "");
  const routed = (place: Place) => place.remote !== undefined || named;
  const here: Place[] = settings.local > 0 && listed.some(routed) ? [{ slots: settings.local }] : [];
  const places = [...here, ...listed];
  if (places.some(({ remote }) => remote !== undefined)) {
    console.error(`mutants run on ${namedPlaces(places)} at once`);
  }
  const workers = places
    .flatMap((place) => Array.from({ length: place.slots }, () => place))
    .map((place, index) => {
      const away = !here.includes(place) && routed(place);
      const clone = `${settings.clones}.clone-${String(index)}`;
      cloneTree(root, clone);
      const modules = resolve(root, "node_modules");
      if (!away && existsSync(modules)) symlinkSync(modules, join(clone, "node_modules"));
      return { place, clone, away };
    });
  return { places, workers };
}

const VERDICT = /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/u;
const exact = (path: string) => (/^\.{0,2}\//u.test(path) ? path : `./${path}`);

async function verdict(
  worker: Worker,
  paths: readonly string[],
  seconds: number,
  flags: readonly string[] = [],
) {
  const wall = `--timeout=${String(PER_TEST_WALL_MS)}`;
  const argv = ["bun", "test", "--bail", "--max-concurrency=4", wall, ...flags, ...paths.map(exact)];
  const ran = await runCaptured(argv, {
    cwd: worker.clone,
    env: worker.away
      ? { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(seconds) }
      : { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
    ...keysIf(!worker.away, () => ({ timeout: seconds * 1000 })),
  });
  if (worker.away && NO_VERDICT.has(ran.exitCode ?? 0)) return "elsewhere";
  if (ran.exitCode === null) return null;
  return VERDICT.test(ran.stdout + ran.stderr) ? ran.exitCode !== 0 : null;
}

const SPAWNS =
  /\b(?:Bun\.spawn|Bun\.spawnSync|spawnSync|spawnTextSync|execTextSync|execFileSync|capturedSpawn|runSync|runCaptured|runTextSync|capturedExecPath|child_process)\b/u;

const spawns = (root: string, paths: readonly string[]) =>
  paths
    .flatMap((path) => [
      path,
      ...[...within(root, path, Number.POSITIVE_INFINITY)].filter((file) => file.startsWith("test/")),
    ])
    .some((file) => existsSync(join(root, file)) && SPAWNS.test(readFileSync(join(root, file), "utf8")));

function idleLines(lcov: string): Map<string, Set<number>> {
  const idle = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  for (const row of lcov.split("\n")) {
    if (row.startsWith("SF:")) idle.set(row.slice(3), (lines = new Set()));
    else if (row.startsWith("DA:") && row.endsWith(",0")) lines?.add(Number(row.slice(3, row.indexOf(","))));
  }
  return idle;
}

async function baseline(
  seats: readonly Worker[],
  suites: ReadonlyMap<string, readonly string[]>,
  seconds: number,
  idle: Map<string, Map<string, Set<number>>>,
) {
  const queue = [...suites];
  const times = new Map<string, number | null>();
  const failed: string[] = [];
  await Promise.all(
    seats.map(async (seat) => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const [name, paths] = next;
        const covered = !seat.away && !idle.has(name) && !spawns(seat.clone, paths);
        const dir = `${seat.clone}.coverage`;
        const flags = covered ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`] : [];
        rmSync(dir, { recursive: true, force: true });
        const began = Date.now();
        const said = await verdict(seat, paths, seconds, flags);
        times.set(name, said === false ? Date.now() - began : null);
        if (said === false && covered && existsSync(join(dir, "lcov.info"))) {
          idle.set(name, idleLines(readFileSync(join(dir, "lcov.info"), "utf8")));
        }
        if (said === false) continue;
        const at = seat.place.remote === undefined ? "" : ` on ${seat.place.remote}`;
        failed.push(
          `baseline suite "${name}" did not pass unmutated (${said === true ? "failed" : "no verdict"})${at}`,
        );
      }
    }),
  );
  return { times, failed };
}

export async function runMutants(root: string, jobs: readonly Job[], settings: Settings) {
  const done = new Map(jobs.map(({ out }) => [out, new Set(resultsOf(out).map(({ id }) => id))]));
  const held = [...done.values()].reduce((sum, ids) => sum + ids.size, 0);
  const tasks = jobs.flatMap((job) => {
    const mutants = mutantsOf(root, job.file);
    const wanted = [...(job.ids ?? [])].filter((id) => id.startsWith(`${job.file}:`));
    const current = new Set(mutants.map(({ id }) => id));
    const stale = wanted.filter((id) => !current.has(id)).length;
    if (stale > 0) {
      console.error(
        `stale --only IDs in ${job.file}: ${String(stale)}/${String(wanted.length)} matched no current mutant (code moved since recorded)`,
      );
    }
    return mutants
      .filter(({ id }) => done.get(job.out)?.has(id) !== true && (job.ids?.has(id) ?? true))
      .map((mutant) => ({ mutant, job }));
  });
  if (tasks.length === 0) return { read: 0, held, unrun: 0 };
  const { places, workers } = workersFor(root, settings);
  const originals = new Map(jobs.map(({ file }) => [file, readFileSync(join(root, file), "utf8")]));
  const suites = new Map(jobs.flatMap((job) => Object.entries(job.suites)));
  const took = new Map<Place, ReadonlyMap<string, number | null>>();
  const idle = new Map<string, Map<string, Set<number>>>();
  const yields = new Map<string, { readonly runs: number; readonly kills: number }>();
  let read = 0;
  const { unrun, refused } = await spread(places, tasks, {
    qualify: async ({ place }) => {
      const seats = workers.filter((one) => one.place === place);
      const { times, failed } = await baseline(seats, suites, settings.seconds, idle);
      took.set(place, times);
      if (failed.length === suites.size) return failed[0] ?? null;
      for (const why of failed) console.error(`${why}; ${place.remote ?? "here"} skips it`);
      return null;
    },
    halt: () => Date.now() >= settings.deadline,
    run: async ({ mutant, job }, { place, index }) => {
      const worker = workers[index];
      if (worker === undefined) throw new Error(`no copy for seat ${String(index)}`);
      const path = join(worker.clone, mutant.file);
      const original = originals.get(mutant.file) ?? "";
      writeFileSync(path, original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end));
      const killed: Record<string, boolean | null> = Object.fromEntries(
        Object.keys(job.suites).map((name) => [name, null]),
      );
      const yieldOf = (name: string) => yields.get(`${mutant.file}\0${name}`) ?? { runs: 0, kills: 0 };
      const odds = (name: string) => {
        const { runs, kills } = yieldOf(name);
        return (kills + 0.1) / ((runs + 1) * Math.max(50, took.get(place)?.get(name) ?? 0));
      };
      const order = Object.entries(job.suites).toSorted(([a], [b]) =>
        settings.stopAtKill ? odds(b) - odds(a) : 0,
      );
      try {
        for (const [name, paths] of order) {
          const ms = took.get(place)?.get(name) ?? null;
          const stopped = ms === null || (settings.stopAtKill && Object.values(killed).includes(true));
          const wall = Math.min(settings.seconds, 30 + Math.ceil((ms ?? 0) / 100));
          const unreached = idle.get(name)?.get(mutant.file)?.has(mutant.line) === true;
          const said = stopped ? null : unreached ? false : await verdict(worker, paths, wall);
          if (said === "elsewhere") {
            console.error(`${place.remote ?? "here"} gave no verdict, so takes no more mutants`);
            return "elsewhere";
          }
          killed[name] = said;
          if (said === null || unreached) continue;
          const { runs, kills } = yieldOf(name);
          yields.set(`${mutant.file}\0${name}`, { runs: runs + 1, kills: kills + Number(said) });
        }
      } finally {
        writeFileSync(path, original);
      }
      const { id, file, line, label } = mutant;
      appendFileSync(job.out, `${JSON.stringify({ id, file, line, label, killed })}\n`);
      read += 1;
      return "done";
    },
  });
  if (refused.length === places.length) throw new Error(refused.join("\n"));
  for (const why of refused) console.error(`${why}; it takes no mutants`);
  return { read, held, unrun: unrun.length };
}

async function run(args: CommandArgs, root: string, files: readonly string[]): Promise<void> {
  const out = args.required("out");
  // SAFETY: the suites file is the caller's own map of a suite's name to its test paths.
  const suites = JSON.parse(readFileSync(args.required("suites"), "utf8")) as Record<string, string[]>;
  const only = args.value("only");
  const ids = only === null ? undefined : new Set(linesOf(only));
  const deadline = args.time("until") ?? Number.POSITIVE_INFINITY;
  let ran: Awaited<ReturnType<typeof runMutants>>;
  try {
    ran = await runMutants(
      root,
      files.map((file) => ({ file, out, suites, ...keyIfDefined("ids", ids) })),
      {
        fleet: args.flag("fleet"),
        jobs: args.int("jobs") ?? undefined,
        local: args.int("local") ?? 0,
        stopAtKill: args.flag("stop-at-kill"),
        seconds: args.int("timeout") ?? 300,
        deadline,
        clones: args.value("clones") ?? out,
      },
    );
  } catch (error) {
    return args.die(errorMessage(error));
  }
  console.log(`${String(ran.read)} mutants run, ${String(ran.held)} held before`);
  if (ran.unrun > 0) {
    const why =
      Date.now() >= deadline ? ` at ${new Date(deadline).toISOString()}` : ", since no place gave a verdict";
    args.die(`${String(ran.unrun)} mutants left unrun${why}; run again`);
  }
}

function report(args: CommandArgs, results: readonly string[]): void {
  const old = args.value("old");
  const rows = results.flatMap(resultsOf);
  const classify =
    old === null
      ? verdictOf
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
    "       mutate.ts run <worktree> <file>... --out <jsonl> --suites <json> [--fleet] [--jobs N] [--local N] [--only <ids>] [--stop-at-kill] [--timeout s] [--until <time>] [--clones <prefix>]",
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
        only: "text",
        "stop-at-kill": "flag",
        timeout: "int",
        until: "time",
        clones: "text",
        old: "text",
        survivors: "flag",
      },
      positionals: [2, Number.POSITIVE_INFINITY],
    },
    async (args: CommandArgs) => {
      const [sub = "", first = "", ...rest] = args.positionals;
      if (sub === "report") return report(args, [first, ...rest]);
      if (rest.length === 0) return args.die(usage);
      if (sub === "run") return run(args, first, rest);
      if (sub !== "list") return args.die(usage);
      for (const file of rest) console.log(`${file}\t${String(mutantsOf(first, file).length)}`);
    },
  );
}

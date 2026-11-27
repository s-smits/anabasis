import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { availableParallelism, tmpdir } from "#src/meta/os.ts";
import { isAbsolute, join, relative } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { checkHost, NO_VERDICT, type Place, placeEnv } from "#tools/runs/host-config.ts";
import { PER_TEST_WALL_MS } from "#tools/runtime/test-suite.ts";
import { buildTraceSource, type SchemaMutant, testHelpersOf } from "./mutate-schema.ts";

export const VERDICT_RE = /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/;
export const testWallMs = (seconds: number): number => Math.max(PER_TEST_WALL_MS, seconds * 1000 + 5000);
const SUBPROCESS_RE =
  /\b(?:Bun\.spawn|Bun\.spawnSync|spawnSync|spawnTextSync|execTextSync|execFileSync|capturedSpawn|runSync|runCaptured|runTextSync|capturedExecPath|child_process)\b|bun-spawn-sync/u;

export type ActiveProc = Parameters<typeof killProcessGroup>[0];
export type VerdictMap = Record<string, boolean | null>;

export interface BatchPlan {
  readonly mutant: SchemaMutant;
  readonly active: readonly string[];
}

export interface FastWorker {
  readonly place: Place;
  readonly clone: string;
  readonly local: boolean;
}

export const routed = ({ remote }: Place): boolean =>
  remote !== undefined || !["", "here"].includes(checkHost()?.trim() ?? "");

export const isAway = (worker: FastWorker): boolean => !worker.local && routed(worker.place);

export const explicitPath = (path: string): string =>
  isAbsolute(path) || path.startsWith("./") || path.startsWith("../") ? path : `./${path}`;

export function suiteTimeoutSeconds(capSeconds: number, durationMs: number | undefined): number {
  if (durationMs === undefined) return capSeconds;
  return Math.min(capSeconds, Math.max(20, Math.ceil((durationMs / 1000) * 12) + 10));
}

function combinedTimeoutSeconds(
  capSeconds: number,
  names: readonly string[],
  durations: ReadonlyMap<string, number>,
): number {
  let totalMs = 0;
  for (const name of names) {
    const ms = durations.get(name);
    if (ms === undefined) return capSeconds;
    totalMs += ms;
  }
  return Math.min(capSeconds, Math.max(25, Math.ceil((totalMs / 1000) * 10) + 15));
}

function chunkSuites(
  names: readonly string[],
  durations: ReadonlyMap<string, number>,
  capSeconds: number,
): string[][] {
  const budgetMs = Math.max(10_000, Math.floor((capSeconds * 1000) / 3));
  const chunks: string[][] = [];
  let cur: string[] = [];
  let ms = 0;
  for (const name of names) {
    const dur = durations.get(name) ?? 4000;
    if (cur.length > 0 && (ms + dur > budgetMs || cur.length >= 10)) {
      chunks.push(cur);
      cur = [];
      ms = 0;
    }
    cur.push(name);
    ms += dur;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function canCombineSuites(
  active: readonly string[],
  suites: ReadonlyMap<string, readonly string[]>,
  stopAtKill: boolean,
): boolean {
  if (!stopAtKill || active.length <= 1) return false;
  const seen = new Set<string>();
  for (const name of active) {
    const paths = suites.get(name);
    if (paths?.length !== 1) return false;
    const only = paths[0];
    if (only === undefined || seen.has(only)) return false;
    seen.add(only);
  }
  return true;
}

function findLastSuiteHeader(
  active: readonly string[],
  suites: ReadonlyMap<string, readonly string[]>,
  normalized: string,
): { readonly positions: readonly number[]; readonly lastIdx: number; readonly lastPos: number } {
  const positions = active.map((name) => {
    const path = suites.get(name)?.[0];
    return path === undefined ? -1 : normalized.lastIndexOf(`\n${path}:`);
  });
  let lastIdx = -1;
  let lastPos = -1;
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i] ?? -1;
    if (pos > lastPos) {
      lastPos = pos;
      lastIdx = i;
    }
  }
  return { positions, lastIdx, lastPos };
}

function parseMultiFileBail(
  active: readonly string[],
  suites: ReadonlyMap<string, readonly string[]>,
  outcome: { readonly said: string; readonly code: number; readonly signalled: boolean },
): VerdictMap {
  const { said, code, signalled } = outcome;
  const hasVerdict = !signalled && VERDICT_RE.test(said);
  if (hasVerdict && code === 0) return Object.fromEntries(active.map((name) => [name, false] as const));
  const { positions, lastIdx, lastPos } = findLastSuiteHeader(active, suites, `\n${said}`);
  const blamedIdx = lastIdx === -1 ? 0 : lastIdx;
  const failIdx = hasVerdict && code !== 0 ? blamedIdx : -1;
  const out = new Map<string, boolean | null>();
  for (let i = 0; i < active.length; i += 1) {
    const name = active[i];
    if (name === undefined) continue;
    const pos = positions[i] ?? -1;
    const killed = i === failIdx ? true : pos !== -1 && pos < lastPos ? false : null;
    out.set(name, killed);
  }
  return Object.fromEntries(out);
}

async function drainProcess(
  run: ActiveProc & {
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly exited: Promise<number>;
    readonly signalCode: string | number | null;
  },
  seconds: number,
  activeProcs?: Set<ActiveProc>,
): Promise<{ readonly said: string; readonly code: number; readonly signalled: boolean }> {
  activeProcs?.add(run);
  let timedOut = false;
  const timer =
    seconds > 0 && Number.isFinite(seconds)
      ? setTimeout(() => {
          timedOut = true;
          killProcessGroup(run, "SIGKILL");
        }, seconds * 1000)
      : null;
  try {
    const drain = Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]).then(
      (parts) => parts.join(""),
    );
    const code = await run.exited;
    const said = await Promise.race([drain, Bun.sleep(200).then(() => "")]);
    return { said, code, signalled: timedOut || run.signalCode !== null };
  } finally {
    if (timer !== null) clearTimeout(timer);
    activeProcs?.delete(run);
  }
}

async function spawnVerdict(
  worker: FastWorker,
  paths: readonly string[],
  seconds: number,
  localConc: number,
  activeProcs?: Set<ActiveProc>,
) {
  const away = isAway(worker);
  const run = Bun.spawn(
    [
      away ? "bun" : capturedExecPath,
      "test",
      "--bail",
      `--max-concurrency=${String(localConc)}`,
      `--timeout=${String(testWallMs(seconds))}`,
      ...paths.map(explicitPath),
    ],
    {
      cwd: worker.clone,
      env: away
        ? { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(seconds) }
        : { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      detached: !away,
    },
  );
  return {
    away,
    ...(await drainProcess(run, away ? Number.POSITIVE_INFINITY : seconds, away ? undefined : activeProcs)),
  };
}

async function verdict(
  worker: FastWorker,
  paths: readonly string[],
  seconds: number,
  localConc: number,
  activeProcs?: Set<ActiveProc>,
) {
  const { away, said, code, signalled } = await spawnVerdict(worker, paths, seconds, localConc, activeProcs);
  if (away && NO_VERDICT.has(code)) return "elsewhere";
  if (signalled) return null;
  return VERDICT_RE.test(said) ? code !== 0 : null;
}

type KillOutcome =
  | { readonly kind: "ok"; readonly killed: VerdictMap }
  | { readonly kind: "elsewhere" }
  | { readonly kind: "refused"; readonly why: string; readonly suite?: string };

async function runSoloRest(
  seat: FastWorker,
  rest: readonly string[],
  seed: VerdictMap,
  opts: {
    readonly suites: ReadonlyMap<string, readonly string[]>;
    readonly durations: ReadonlyMap<string, number>;
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly localConc: number;
    readonly activeProcs?: Set<ActiveProc>;
    readonly beforeSuite?: ((name: string) => Promise<string | null>) | undefined;
    readonly shouldStop?: (() => boolean) | undefined;
  },
): Promise<KillOutcome> {
  const out: VerdictMap = { ...seed };
  for (const name of rest) {
    if (opts.shouldStop?.() === true) break;
    if (opts.stopAtKill && Object.values(out).some(Boolean)) {
      if (!(name in out)) out[name] = null;
      continue;
    }
    if (out[name] === false || out[name] === true) continue;
    if (opts.beforeSuite !== undefined) {
      const why = await opts.beforeSuite(name);
      if (why !== null) return { kind: "refused", why, suite: name };
    }
    const timeoutSec = suiteTimeoutSeconds(opts.seconds, opts.durations.get(name));
    const said = await verdict(
      seat,
      opts.suites.get(name) ?? [],
      timeoutSec,
      opts.localConc,
      opts.activeProcs,
    );
    if (said === "elsewhere") return { kind: "elsewhere" };
    out[name] = said;
  }
  return { kind: "ok", killed: out };
}

async function runCombinedWaves(
  seat: FastWorker,
  rest: readonly string[],
  opts: {
    readonly suites: ReadonlyMap<string, readonly string[]>;
    readonly durations: ReadonlyMap<string, number>;
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly localConc: number;
    readonly activeProcs?: Set<ActiveProc>;
    readonly shouldStop?: (() => boolean) | undefined;
  },
): Promise<KillOutcome> {
  const out: VerdictMap = {};
  const fillNull = () => {
    for (const name of rest) if (!(name in out)) out[name] = null;
  };
  for (const wave of chunkSuites(rest, opts.durations, opts.seconds)) {
    if (opts.shouldStop?.() === true) break;
    if (wave.length === 1) {
      const solo = await runSoloRest(seat, wave, {}, opts);
      if (solo.kind !== "ok") return solo;
      Object.assign(out, solo.killed);
      if (Object.values(solo.killed).some(Boolean)) break;
      continue;
    }
    const paths = wave.flatMap((name) => opts.suites.get(name) ?? []);
    const batch = parseMultiFileBail(
      wave,
      opts.suites,
      await spawnVerdict(
        seat,
        paths,
        combinedTimeoutSeconds(opts.seconds, wave, opts.durations),
        opts.localConc,
        opts.activeProcs,
      ),
    );
    const blamed = wave.find((name) => batch[name] === true);
    if (blamed !== undefined) {
      const solo = await verdict(
        seat,
        opts.suites.get(blamed) ?? [],
        suiteTimeoutSeconds(opts.seconds, opts.durations.get(blamed)),
        opts.localConc,
        opts.activeProcs,
      );
      if (solo === "elsewhere") return { kind: "elsewhere" };
      if (solo === true) {
        Object.assign(out, batch);
        break;
      }
      const fallback = await runSoloRest(seat, wave, { [blamed]: solo }, opts);
      if (fallback.kind !== "ok") return fallback;
      Object.assign(out, fallback.killed);
      if (Object.values(fallback.killed).some(Boolean)) break;
      continue;
    }
    if (wave.some((name) => batch[name] === null)) {
      const fallback = await runSoloRest(seat, wave, batch, opts);
      if (fallback.kind !== "ok") return fallback;
      Object.assign(out, fallback.killed);
      if (Object.values(fallback.killed).some(Boolean)) break;
      continue;
    }
    Object.assign(out, batch);
  }
  fillNull();
  return { kind: "ok", killed: out };
}

export async function killsOf(
  seat: FastWorker,
  plan: BatchPlan,
  opts: {
    readonly originals: ReadonlyMap<string, string>;
    readonly suites: ReadonlyMap<string, readonly string[]>;
    readonly durations: ReadonlyMap<string, number>;
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly localConc: number;
    readonly activeProcs?: Set<ActiveProc>;
    readonly beforeSuite?: ((name: string) => Promise<string | null>) | undefined;
    readonly shouldStop?: (() => boolean) | undefined;
  },
): Promise<KillOutcome> {
  const { mutant, active } = plan;
  const original = opts.originals.get(mutant.file) ?? "";
  const writeMutant = () =>
    writeFileSync(
      join(seat.clone, mutant.file),
      original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end),
    );
  const restore = () => writeFileSync(join(seat.clone, mutant.file), original);
  const qualifyClean = async (
    names: readonly string[],
  ): Promise<{ readonly suite: string; readonly why: string } | null> => {
    if (opts.beforeSuite === undefined) return null;
    restore();
    for (const name of names) {
      const why = await opts.beforeSuite(name);
      if (why !== null) return { suite: name, why };
    }
    writeMutant();
    return null;
  };
  writeMutant();
  try {
    const [lead, ...rest] = active;
    if (!isAway(seat) && lead !== undefined && canCombineSuites(rest, opts.suites, opts.stopAtKill)) {
      const leadFail = await qualifyClean([lead]);
      if (leadFail !== null) return { kind: "refused", why: leadFail.why, suite: leadFail.suite };
      const leadSaid = await verdict(
        seat,
        opts.suites.get(lead) ?? [],
        suiteTimeoutSeconds(opts.seconds, opts.durations.get(lead)),
        opts.localConc,
        opts.activeProcs,
      );
      if (leadSaid === "elsewhere") return { kind: "elsewhere" };
      if (leadSaid === true) {
        return {
          kind: "ok",
          killed: { [lead]: true, ...Object.fromEntries(rest.map((name) => [name, null] as const)) },
        };
      }
      const restFail = await qualifyClean(rest);
      if (restFail !== null) return { kind: "refused", why: restFail.why, suite: restFail.suite };
      const waves = await runCombinedWaves(seat, rest, opts);
      return waves.kind === "ok" ? { kind: "ok", killed: { [lead]: leadSaid, ...waves.killed } } : waves;
    }
    return await runSoloRest(
      seat,
      active,
      {},
      {
        ...opts,
        beforeSuite:
          opts.beforeSuite === undefined
            ? undefined
            : (name) => qualifyClean([name]).then((fail) => fail?.why ?? null),
      },
    );
  } finally {
    restore();
  }
}

export async function unfit(
  worker: FastWorker,
  suites: ReadonlyMap<string, readonly string[]>,
  seconds: number,
  localConc: number,
): Promise<string | null> {
  const all = [...new Set([...suites.values()].flat())];
  if (all.length === 0) return "no suites given";
  const batchSec = Math.min(600, Math.max(seconds, Math.ceil(all.length / Math.max(1, localConc)) * 30));
  if (suites.size > 1 && (await verdict(worker, all, batchSec, localConc)) === false) return null;
  for (const [name, paths] of suites) {
    const said = await verdict(worker, paths, seconds, localConc);
    if (said === false) continue;
    const at = worker.place.remote === undefined ? "" : ` on ${worker.place.remote}`;
    return `baseline suite "${name}" did not pass unmutated (${said === true ? "failed" : "no verdict"})${at}`;
  }
  return null;
}

function spawnsSubprocess(root: string, paths: readonly string[]): boolean {
  const hasSub = (rel: string) => {
    const full = join(root, rel);
    return existsSync(full) && SUBPROCESS_RE.test(readFileSync(full, "utf8"));
  };
  return paths.some((path) => hasSub(path) || testHelpersOf(root, path).some(hasSub));
}

const TRACE_PLACEHOLDER = "__ANA_MUTATE_TRACE_PATH__";

interface TraceTemplate {
  readonly file: string;
  readonly source: string;
  readonly encoded: ReadonlyMap<number, SchemaMutant>;
}

function collectTraceResults(
  targets: readonly { readonly tpl: TraceTemplate; readonly tracePath: string }[],
) {
  const suiteUnreached = new Map<string, Set<string>>();
  const suiteCovered = new Map<string, number>();
  for (const { tpl, tracePath } of targets) {
    const raw = existsSync(tracePath) ? readFileSync(tracePath, "utf8").split("\n") : [];
    const hits = new Set(
      raw
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number),
    );
    const missed = new Set<string>();
    let reached = 0;
    for (const [k, mutant] of tpl.encoded) {
      if (hits.has(k)) reached += 1;
      else missed.add(mutant.id);
    }
    if (missed.size > 0) suiteUnreached.set(tpl.file, missed);
    if (reached > 0) suiteCovered.set(tpl.file, reached);
  }
  return { suiteUnreached, suiteCovered };
}

async function runSubprocessTrace(
  suiteEntries: readonly (readonly [string, readonly string[]])[],
  opts: {
    readonly dir: string;
    readonly seconds: number;
    readonly cacheDir: string | null;
    readonly originals: ReadonlyMap<string, string>;
    readonly mutantsByFile: ReadonlyMap<string, readonly SchemaMutant[]>;
    readonly prepareClone: (dest: string) => Promise<void>;
    readonly passed: Set<string>;
    readonly durations: Map<string, number>;
    readonly covered: Map<string, Map<string, number>>;
    readonly unreached: Map<string, Map<string, Set<string>>>;
  },
): Promise<void> {
  const templates: TraceTemplate[] = [];
  for (const [file, mutants] of opts.mutantsByFile) {
    const orig = opts.originals.get(file);
    if (orig === undefined || mutants.length === 0) continue;
    const built = buildTraceSource(file, orig, mutants, TRACE_PLACEHOLDER);
    if (built.source !== null && built.encoded.size > 0) {
      templates.push({ file, source: built.source, encoded: built.encoded });
    }
  }
  if (templates.length === 0) return;
  const todo: (readonly [string, readonly string[]])[] = [];
  for (const entry of suiteEntries) {
    const [name] = entry;
    const key = cacheKey(name);
    const okPath = opts.cacheDir === null ? null : join(opts.cacheDir, `${key}.ok`);
    const traceCache = opts.cacheDir === null ? null : join(opts.cacheDir, `${key}.unreached.json`);
    if (okPath !== null && traceCache !== null && existsSync(okPath) && existsSync(traceCache)) {
      const ms = Number(readFileSync(okPath, "utf8").trim());
      opts.passed.add(name);
      opts.durations.set(name, Number.isFinite(ms) && ms > 0 ? ms : 500);
      // SAFETY: written as `{ unreached: Record<string, string[]>, covered: Record<string, number> }` below.
      const saved = JSON.parse(readFileSync(traceCache, "utf8")) as {
        readonly unreached: Record<string, readonly string[]>;
        readonly covered: Record<string, number>;
      };
      opts.unreached.set(name, new Map(Object.entries(saved.unreached).map(([f, ids]) => [f, new Set(ids)])));
      opts.covered.set(name, new Map(Object.entries(saved.covered)));
      continue;
    }
    todo.push(entry);
  }
  if (todo.length === 0) return;
  const slots = Math.min(Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))), todo.length);
  let seq = 0;
  await Promise.all(
    Array.from({ length: slots }, async (_, slotIdx) => {
      const cloneDir = join(opts.dir, `trace-clone-${String(slotIdx)}`);
      await opts.prepareClone(cloneDir);
      for (let next = todo.shift(); next !== undefined; next = todo.shift()) {
        const [name, paths] = next;
        seq += 1;
        const outDir = join(opts.dir, `trace-${String(seq)}`);
        mkdirSync(outDir, { recursive: true });
        const targets = templates.map((tpl, idx) => {
          const tracePath = join(outDir, `${String(idx)}.txt`);
          const dst = join(cloneDir, tpl.file);
          rmSync(dst, { force: true });
          writeFileSync(
            dst,
            tpl.source.replace(JSON.stringify(TRACE_PLACEHOLDER), JSON.stringify(tracePath)),
          );
          return { tpl, tracePath };
        });
        const started = Date.now();
        const run = Bun.spawn(
          [
            capturedExecPath,
            "test",
            "--bail",
            "--max-concurrency=2",
            `--timeout=${String(PER_TEST_WALL_MS)}`,
            ...paths.map(explicitPath),
          ],
          {
            cwd: cloneDir,
            env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
            stdout: "pipe",
            stderr: "pipe",
            detached: true,
          },
        );
        const { said, code, signalled } = await drainProcess(run, opts.seconds);
        const ms = Math.max(1, Date.now() - started);
        if (signalled || code !== 0 || !VERDICT_RE.test(said)) continue;
        opts.passed.add(name);
        opts.durations.set(name, ms);
        const { suiteUnreached, suiteCovered } = collectTraceResults(targets);
        opts.unreached.set(name, suiteUnreached);
        opts.covered.set(name, suiteCovered);
        if (opts.cacheDir !== null) {
          const key = cacheKey(name);
          writeFileSync(
            join(opts.cacheDir, `${key}.unreached.json`),
            JSON.stringify({
              unreached: Object.fromEntries([...suiteUnreached.entries()].map(([f, s]) => [f, [...s]])),
              covered: Object.fromEntries(suiteCovered),
            }),
          );
          writeFileSync(join(opts.cacheDir, `${key}.ok`), `${String(ms)}\n`);
        }
      }
    }),
  );
}

function parseCoverage(root: string, lcov: string, files: ReadonlySet<string>) {
  const uncovered = new Map<string, Set<number>>();
  const covered = new Map<string, number>();
  let current: string | null = null;
  for (const row of lcov.split("\n")) {
    if (row.startsWith("SF:")) {
      const raw = row.slice(3).trim();
      const norm = isAbsolute(raw) ? relative(root, raw) : raw;
      current = files.has(norm) ? norm : null;
    } else if (current !== null && row.startsWith("DA:")) {
      const [lineNo = "", hits = ""] = row.slice(3).split(",");
      if (hits === "0") {
        const set = uncovered.get(current) ?? new Set<number>();
        set.add(Number(lineNo));
        uncovered.set(current, set);
      } else if (Number(hits) > 0) {
        covered.set(current, (covered.get(current) ?? 0) + 1);
      }
    } else if (row === "end_of_record") {
      current = null;
    }
  }
  return { uncovered, covered };
}

const cacheKey = (name: string) => name.replaceAll(/[^A-Za-z0-9._-]/gu, "_");

export async function measureCoverage(
  root: string,
  suites: ReadonlyMap<string, readonly string[]>,
  files: readonly string[],
  opts: {
    readonly seconds: number;
    readonly cacheDir: string | null;
    readonly originals?: ReadonlyMap<string, string>;
    readonly mutantsByFile?: ReadonlyMap<string, readonly SchemaMutant[]>;
    readonly prepareClone?: (dest: string) => Promise<void>;
  },
) {
  const uncovered = new Map<string, Map<string, Set<number>>>();
  const unreached = new Map<string, Map<string, Set<string>>>();
  const covered = new Map<string, Map<string, number>>();
  const passed = new Set<string>();
  const durations = new Map<string, number>();
  if (suites.size === 0) return { uncovered, unreached, covered, passed, durations };
  const fileSet = new Set(files);
  const dir = mkdtempSync(join(tmpdir(), "ana-cov-"));
  const cache = opts.cacheDir;
  if (cache !== null) mkdirSync(cache, { recursive: true });
  const lcovQueue: (readonly [string, readonly string[]])[] = [];
  const subQueue: (readonly [string, readonly string[]])[] = [];
  for (const entry of suites.entries()) {
    if (spawnsSubprocess(root, entry[1])) subQueue.push(entry);
    else lcovQueue.push(entry);
  }
  const maxConc = 2;
  let seq = 0;
  const runOne = async ([name, paths]: readonly [string, readonly string[]]) => {
    const key = cacheKey(name);
    if (cache !== null && existsSync(join(cache, `${key}.ok`))) {
      const ms = Number(readFileSync(join(cache, `${key}.ok`), "utf8").trim());
      passed.add(name);
      durations.set(name, Number.isFinite(ms) && ms > 0 ? ms : 500);
      const lcovPath = join(cache, `${key}.lcov`);
      if (existsSync(lcovPath)) {
        const parsed = parseCoverage(root, readFileSync(lcovPath, "utf8"), fileSet);
        uncovered.set(name, parsed.uncovered);
        covered.set(name, parsed.covered);
      }
      return;
    }
    seq += 1;
    const outDir = join(dir, String(seq));
    mkdirSync(outDir, { recursive: true });
    const started = Date.now();
    const run = Bun.spawn(
      [
        capturedExecPath,
        "test",
        "--bail",
        `--max-concurrency=${String(maxConc)}`,
        `--timeout=${String(PER_TEST_WALL_MS)}`,
        "--coverage",
        "--coverage-reporter=lcov",
        `--coverage-dir=${outDir}`,
        ...paths.map(explicitPath),
      ],
      {
        cwd: root,
        env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      },
    );
    const { said, code, signalled } = await drainProcess(run, opts.seconds);
    const ms = Math.max(1, Date.now() - started);
    if (signalled || code !== 0 || !VERDICT_RE.test(said)) return;
    passed.add(name);
    durations.set(name, ms);
    const lcovFile = join(outDir, "lcov.info");
    const lcov = existsSync(lcovFile) ? readFileSync(lcovFile, "utf8") : null;
    if (cache !== null) {
      if (lcov !== null) writeFileSync(join(cache, `${key}.lcov`), lcov);
      writeFileSync(join(cache, `${key}.ok`), `${String(ms)}\n`);
    }
    if (lcov !== null) {
      const parsed = parseCoverage(root, lcov, fileSet);
      uncovered.set(name, parsed.uncovered);
      covered.set(name, parsed.covered);
    }
  };
  try {
    const slots = Math.min(Math.max(2, Math.floor(availableParallelism() / 2)), lcovQueue.length);
    const runLcov = Promise.all(
      Array.from({ length: slots }, async () => {
        for (let next = lcovQueue.shift(); next !== undefined; next = lcovQueue.shift()) await runOne(next);
      }),
    );
    const runTrace =
      subQueue.length > 0 &&
      opts.originals !== undefined &&
      opts.mutantsByFile !== undefined &&
      opts.prepareClone !== undefined
        ? runSubprocessTrace(subQueue, {
            dir,
            seconds: opts.seconds,
            cacheDir: cache,
            originals: opts.originals,
            mutantsByFile: opts.mutantsByFile,
            prepareClone: opts.prepareClone,
            passed,
            durations,
            covered,
            unreached,
          })
        : Promise.resolve();
    await Promise.all([runLcov, runTrace]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { uncovered, unreached, covered, passed, durations };
}

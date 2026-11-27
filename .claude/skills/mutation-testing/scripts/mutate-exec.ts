import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { availableParallelism, tmpdir } from "#src/meta/os.ts";
import { dirname, isAbsolute, join, relative } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { checkHost, NO_VERDICT, type Place, placeEnv } from "#tools/runs/host-config.ts";
import { PER_TEST_WALL_MS } from "#tools/runtime/test-suite.ts";
import { type SchemaMutant, testHelpersOf } from "./mutate-schema.ts";

export const BATCH_FILE = "test/.ana-mutate-batch.test.ts";
const BATCH_MARKER = "__ANA_MUTANT_ROW__";
const QUALIFY_OK_MARKER = "__ANA_QUALIFY_OK__";
const QUALIFY_FAIL_MARKER = "__ANA_QUALIFY_FAIL__";
const VERDICT_RE = /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/;
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

interface BatchRow {
  readonly id: string;
  readonly killed: VerdictMap;
}

export const routed = ({ remote }: Place): boolean =>
  remote !== undefined || !["", "here"].includes(checkHost()?.trim() ?? "");

export const isAway = (worker: FastWorker): boolean => !worker.local && routed(worker.place);

function suiteTimeoutSeconds(capSeconds: number, durationMs: number | undefined): number {
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
      `--max-concurrency=${String(away ? 4 : localConc)}`,
      `--timeout=${String(PER_TEST_WALL_MS)}`,
      ...paths,
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
  | { readonly kind: "refused"; readonly why: string };

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
      if (why !== null) return { kind: "refused", why };
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
  const qualifyClean = async (names: readonly string[]): Promise<string | null> => {
    if (opts.beforeSuite === undefined) return null;
    restore();
    for (const name of names) {
      const why = await opts.beforeSuite(name);
      if (why !== null) return why;
    }
    writeMutant();
    return null;
  };
  writeMutant();
  try {
    const [lead, ...rest] = active;
    if (!isAway(seat) && lead !== undefined && canCombineSuites(rest, opts.suites, opts.stopAtKill)) {
      const leadWhy = await qualifyClean([lead]);
      if (leadWhy !== null) return { kind: "refused", why: leadWhy };
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
      const restWhy = await qualifyClean(rest);
      if (restWhy !== null) return { kind: "refused", why: restWhy };
      const paths = rest.flatMap((name) => opts.suites.get(name) ?? []);
      const batch = parseMultiFileBail(
        rest,
        opts.suites,
        await spawnVerdict(
          seat,
          paths,
          combinedTimeoutSeconds(opts.seconds, rest, opts.durations),
          opts.localConc,
          opts.activeProcs,
        ),
      );
      const blamed = rest.find((name) => batch[name] === true);
      if (blamed !== undefined) {
        const solo = await verdict(
          seat,
          opts.suites.get(blamed) ?? [],
          suiteTimeoutSeconds(opts.seconds, opts.durations.get(blamed)),
          opts.localConc,
          opts.activeProcs,
        );
        if (solo === "elsewhere") return { kind: "elsewhere" };
        if (solo === true) return { kind: "ok", killed: { [lead]: leadSaid, ...batch } };
        const fallback = await runSoloRest(
          seat,
          rest,
          { [blamed]: solo },
          { ...opts, beforeSuite: undefined },
        );
        return fallback.kind === "ok"
          ? { kind: "ok", killed: { [lead]: leadSaid, ...fallback.killed } }
          : fallback;
      }
      if (rest.some((name) => batch[name] === null)) {
        const fallback = await runSoloRest(seat, rest, batch, { ...opts, beforeSuite: undefined });
        return fallback.kind === "ok"
          ? { kind: "ok", killed: { [lead]: leadSaid, ...fallback.killed } }
          : fallback;
      }
      return { kind: "ok", killed: { [lead]: leadSaid, ...batch } };
    }
    return await runSoloRest(
      seat,
      active,
      {},
      {
        ...opts,
        beforeSuite: opts.beforeSuite === undefined ? undefined : (name) => qualifyClean([name]),
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
  if (suites.size > 1 && (await verdict(worker, all, seconds, localConc)) === false) return null;
  for (const [name, paths] of suites) {
    const said = await verdict(worker, paths, seconds, localConc);
    if (said === false) continue;
    const at = worker.place.remote === undefined ? "" : ` on ${worker.place.remote}`;
    return `baseline suite "${name}" did not pass unmutated (${said === true ? "failed" : "no verdict"})${at}`;
  }
  return null;
}

const BATCH_DRIVER_BODY = `import { it } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd();
const originals = new Map();
for (const { mutant } of cfg.plans) {
  if (!originals.has(mutant.file)) originals.set(mutant.file, readFileSync(mutant.file, "utf8"));
}
async function spawnTest(dir, paths, conc, timeoutSec) {
  const run = Bun.spawn(
    [process.execPath, "test", "--bail", "--max-concurrency=" + String(conc), "--timeout=" + String(cfg.perTestWall), ...paths],
    {
      cwd: dir,
      env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutSec * 1000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  return { said: stdout + stderr, code, signalled: run.signalCode !== null };
}
async function runPaths(dir, paths, conc, timeoutSec) {
  const res = await spawnTest(dir, paths, conc, timeoutSec);
  return res.signalled ? null : re.test(res.said) ? res.code !== 0 : null;
}
function timeoutFor(name) { return cfg.suiteTimeouts[name] ?? cfg.seconds; }
function combinedTimeout(active) {
  let ms = 0;
  for (const name of active) {
    const dur = cfg.durations[name];
    if (dur === undefined) return cfg.seconds;
    ms += dur;
  }
  return Math.min(cfg.seconds, Math.max(35, Math.ceil((ms / 1000) * 10) + 15));
}
function canCombine(active) {
  if (!cfg.stopAtKill || active.length <= 1) return false;
  const seen = new Set();
  for (const name of active) {
    const paths = cfg.suites[name];
    if (!paths || paths.length !== 1 || seen.has(paths[0])) return false;
    seen.add(paths[0]);
  }
  return true;
}
function parseBail(active, res) {
  const killed = {};
  const ok = !res.signalled && re.test(res.said);
  if (ok && res.code === 0) { for (const name of active) killed[name] = false; return killed; }
  const norm = "\\n" + res.said;
  const positions = active.map((name) => {
    const path = (cfg.suites[name] ?? [])[0];
    return path ? norm.lastIndexOf("\\n" + path + ":") : -1;
  });
  let lastIdx = -1;
  let lastPos = -1;
  for (let i = 0; i < positions.length; i += 1) {
    if (positions[i] > lastPos) { lastPos = positions[i]; lastIdx = i; }
  }
  const failIdx = ok && res.code !== 0 ? (lastIdx === -1 ? 0 : lastIdx) : -1;
  for (let i = 0; i < active.length; i += 1) {
    killed[active[i]] = i === failIdx ? true : positions[i] !== -1 && positions[i] < lastPos ? false : null;
  }
  return killed;
}
async function qualify() {
  if (cfg.qualifySuites.length === 0) return true;
  const all = [...new Set(cfg.qualifySuites.flatMap((name) => cfg.suites[name] ?? []))];
  if (all.length === 0) return true;
  const qConc = Math.min(4, Math.max(2, availableParallelism()));
  if (cfg.qualifySuites.length > 1 && (await runPaths(root, all, qConc, cfg.seconds)) === false) {
    console.log(QUALIFY_OK);
    return true;
  }
  for (const name of cfg.qualifySuites) {
    const said = await runPaths(root, cfg.suites[name] ?? [], qConc, cfg.seconds);
    if (said === false) continue;
    const at = cfg.remoteLabel === "" ? "" : " on " + cfg.remoteLabel;
    console.log(QUALIFY_FAIL + 'baseline suite "' + name + '" did not pass unmutated (' + (said === true ? "failed" : "no verdict") + ')' + at);
    return false;
  }
  console.log(QUALIFY_OK);
  return true;
}
const copyRoots = new Set([
  "src", "tools", "test", ".claude", "studies",
  ...cfg.plans.map((p) => p.mutant.file.split("/")[0]),
  ...Object.values(cfg.suites).flat().map((p) => p.split("/")[0]),
]);
async function cloneLane(dest) {
  const toCopy = [];
  for (const name of readdirSync(root)) {
    if (copyRoots.has(name)) toCopy.push(name);
    else symlinkSync(join(root, name), join(dest, name));
  }
  if (toCopy.length === 0) return;
  const flag = process.platform === "darwin" ? "-cRp" : "-al";
  const fast = Bun.spawn(["cp", flag, ...toCopy.map((name) => join(root, name)), dest], { stdout: "ignore", stderr: "ignore" });
  if ((await fast.exited) === 0) return;
  for (const name of toCopy) cpSync(join(root, name), join(dest, name), { recursive: true, force: true });
}
async function runSolo(dir, rest, seed) {
  const out = { ...seed };
  for (const name of rest) {
    if (cfg.stopAtKill && Object.values(out).some(Boolean)) { if (!(name in out)) out[name] = null; continue; }
    if (out[name] === false || out[name] === true) continue;
    out[name] = await runPaths(dir, cfg.suites[name] ?? [], 1, timeoutFor(name));
  }
  return out;
}
async function runIn(dir, plan) {
  const { mutant, active } = plan;
  const original = originals.get(mutant.file) ?? "";
  const target = join(dir, mutant.file);
  rmSync(target, { force: true });
  writeFileSync(target, original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end));
  let killed = {};
  try {
    const [lead, ...rest] = active;
    if (lead !== undefined && canCombine(rest)) {
      const leadKill = await runPaths(dir, cfg.suites[lead] ?? [], 1, timeoutFor(lead));
      killed[lead] = leadKill;
      if (leadKill === true) {
        for (const name of rest) killed[name] = null;
      } else {
        const paths = rest.map((name) => cfg.suites[name][0]);
        const batch = parseBail(rest, await spawnTest(dir, paths, 1, combinedTimeout(rest)));
        const blamed = rest.find((name) => batch[name] === true);
        if (blamed !== undefined) {
          const solo = await runPaths(dir, cfg.suites[blamed] ?? [], 1, timeoutFor(blamed));
          Object.assign(killed, solo === true ? batch : await runSolo(dir, rest, { [blamed]: solo }));
        } else {
          Object.assign(killed, rest.some((name) => batch[name] === null) ? await runSolo(dir, rest, batch) : batch);
        }
      }
    } else {
      killed = await runSolo(dir, active, {});
    }
  } finally {
    rmSync(target, { force: true });
    writeFileSync(target, original);
  }
  console.log(BATCH_ROW + JSON.stringify({ id: mutant.id, killed }));
}
it("mutate batch", async () => {
  const lanes = Math.min(Math.min(8, Math.max(2, availableParallelism())), cfg.plans.length);
  const dirs = Array.from({ length: lanes }, () => mkdtempSync(join(tmpdir(), "ana-m-")));
  const cloneAll = Promise.all(dirs.map((copy) => cloneLane(copy)));
  const deadline = cfg.remainingMs === null ? null : Date.now() + cfg.remainingMs;
  let next = 0;
  try {
    const [ok] = await Promise.all([qualify(), cloneAll]);
    if (!ok) return;
    await Promise.all(dirs.map(async (dir) => {
      for (;;) {
        if (deadline !== null && Date.now() >= deadline) return;
        const plan = cfg.plans[next];
        next += 1;
        if (plan === undefined) return;
        await runIn(dir, plan);
      }
    }));
  } finally {
    await Promise.all(dirs.map((copy) => Bun.spawn(["rm", "-rf", copy], { stdout: "ignore", stderr: "ignore" }).exited));
  }
}, TOTAL_MS);
`;

export async function runBatch(
  worker: FastWorker,
  plans: readonly BatchPlan[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: {
    readonly qualifySuites: readonly string[];
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly durations: ReadonlyMap<string, number>;
    readonly deadline: number;
    readonly activeProcs: Set<ActiveProc>;
    readonly onRow: (row: BatchRow) => void;
  },
): Promise<{
  readonly rows: BatchRow[];
  readonly qualified: boolean;
  readonly refused: string | null;
  readonly dropped: boolean;
}> {
  const driverPath = join(worker.clone, BATCH_FILE);
  mkdirSync(dirname(driverPath), { recursive: true });
  const suiteTimeouts = Object.fromEntries(
    [...suites.keys()].map((name) => [name, suiteTimeoutSeconds(opts.seconds, opts.durations.get(name))]),
  );
  const payload = JSON.stringify({
    plans,
    suites: Object.fromEntries(suites),
    qualifySuites: opts.qualifySuites,
    remoteLabel: worker.place.remote ?? "",
    stopAtKill: opts.stopAtKill,
    seconds: opts.seconds,
    suiteTimeouts,
    durations: Object.fromEntries(opts.durations),
    remainingMs: Number.isFinite(opts.deadline) ? Math.max(0, opts.deadline - Date.now()) : null,
    perTestWall: PER_TEST_WALL_MS,
  });
  const totalMs = Math.min(3_600_000, (opts.seconds * Math.max(1, plans.length) + 60) * 1000);
  const source = [
    `const cfg = ${payload};`,
    `const re = ${VERDICT_RE.toString()};`,
    `const BATCH_ROW = ${JSON.stringify(BATCH_MARKER)};`,
    `const QUALIFY_OK = ${JSON.stringify(QUALIFY_OK_MARKER)};`,
    `const QUALIFY_FAIL = ${JSON.stringify(QUALIFY_FAIL_MARKER)};`,
    `const TOTAL_MS = ${String(totalMs)};`,
    BATCH_DRIVER_BODY,
  ].join("\n");
  writeFileSync(driverPath, source);
  const batchSeconds = Math.min(3600, opts.seconds * Math.max(1, plans.length) + 60);
  try {
    const run = Bun.spawn(["bun", "test", BATCH_FILE], {
      cwd: worker.clone,
      env: { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(batchSeconds) },
      stdout: "pipe",
      stderr: "ignore",
      detached: true,
    });
    opts.activeProcs.add(run);
    const rows: BatchRow[] = [];
    let qualified = false;
    let refused: string | null = null;
    const decoder = new TextDecoder();
    let buf = "";
    const handleLine = (line: string) => {
      if (line.includes(QUALIFY_OK_MARKER)) qualified = true;
      const failAt = line.indexOf(QUALIFY_FAIL_MARKER);
      if (failAt !== -1) refused = line.slice(failAt + QUALIFY_FAIL_MARKER.length).trim();
      const rowAt = line.indexOf(BATCH_MARKER);
      if (rowAt !== -1) {
        // SAFETY: every marked line was emitted by `BATCH_DRIVER_BODY` above.
        const row = JSON.parse(line.slice(rowAt + BATCH_MARKER.length)) as BatchRow;
        rows.push(row);
        opts.onRow(row);
      }
    };
    const [code] = await Promise.all([
      run.exited,
      (async () => {
        for await (const chunk of run.stdout) {
          buf += decoder.decode(chunk, { stream: true });
          for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
            handleLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        }
        buf += decoder.decode();
        if (buf.length > 0) handleLine(buf);
      })(),
    ]);
    opts.activeProcs.delete(run);
    return { rows, qualified, refused, dropped: NO_VERDICT.has(code) };
  } finally {
    if (existsSync(driverPath)) rmSync(driverPath, { force: true });
  }
}

export async function cloneTree(root: string, dest: string): Promise<void> {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(root).filter(
    (name) => name !== "node_modules" && !name.startsWith(".ana-wall-probe-"),
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

export function linkModules(root: string, clone: string, placement: "local" | "remote"): void {
  const rootModules = join(root, "node_modules");
  const cloneModules = join(clone, "node_modules");
  if (placement === "local" && existsSync(rootModules) && !existsSync(cloneModules)) {
    symlinkSync(rootModules, cloneModules);
  }
  if (placement === "remote" && existsSync(cloneModules)) {
    rmSync(cloneModules, { recursive: true, force: true });
  }
}

function spawnsSubprocess(root: string, paths: readonly string[]): boolean {
  const hasSub = (rel: string) => {
    const full = join(root, rel);
    return existsSync(full) && SUBPROCESS_RE.test(readFileSync(full, "utf8"));
  };
  return paths.some((path) => hasSub(path) || testHelpersOf(root, path).some(hasSub));
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
  opts: { readonly seconds: number; readonly cacheDir: string | null },
) {
  const uncovered = new Map<string, Map<string, Set<number>>>();
  const covered = new Map<string, Map<string, number>>();
  const passed = new Set<string>();
  const durations = new Map<string, number>();
  if (suites.size === 0) return { uncovered, covered, passed, durations };
  const fileSet = new Set(files);
  const dir = mkdtempSync(join(tmpdir(), "ana-cov-"));
  const cache = opts.cacheDir;
  if (cache !== null) mkdirSync(cache, { recursive: true });
  const queue = [...suites.entries()];
  const maxConc = Math.min(4, Math.max(2, Math.floor(availableParallelism() / 3)));
  let seq = 0;
  const runOne = async ([name, paths]: readonly [string, readonly string[]]) => {
    const key = cacheKey(name);
    const sub = spawnsSubprocess(root, paths);
    if (cache !== null && existsSync(join(cache, `${key}.ok`))) {
      const ms = Number(readFileSync(join(cache, `${key}.ok`), "utf8").trim());
      passed.add(name);
      durations.set(name, Number.isFinite(ms) && ms > 0 ? ms : 500);
      const lcovPath = join(cache, `${key}.lcov`);
      if (!sub && existsSync(lcovPath)) {
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
    const covArgs = sub ? [] : ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${outDir}`];
    const run = Bun.spawn(
      [
        capturedExecPath,
        "test",
        "--bail",
        `--max-concurrency=${String(maxConc)}`,
        `--timeout=${String(PER_TEST_WALL_MS)}`,
        ...covArgs,
        ...paths,
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
    const lcov = !sub && existsSync(lcovFile) ? readFileSync(lcovFile, "utf8") : null;
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
    const slots = Math.min(Math.max(2, Math.floor(availableParallelism() / 3)), queue.length);
    await Promise.all(
      Array.from({ length: slots }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) await runOne(next);
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { uncovered, covered, passed, durations };
}

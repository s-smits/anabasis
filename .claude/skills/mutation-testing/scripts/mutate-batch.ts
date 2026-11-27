import { existsSync, mkdirSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { NO_VERDICT, placeEnv } from "#tools/runs/host-config.ts";
import { PER_TEST_WALL_MS } from "#tools/runtime/test-suite.ts";
import {
  type ActiveProc,
  type BatchPlan,
  explicitPath,
  type FastWorker,
  suiteTimeoutSeconds,
  testWallMs,
  VERDICT_RE,
  type VerdictMap,
} from "./mutate-exec.ts";

export const BATCH_FILE = "test/.ana-mutate-batch.test.ts";
const BATCH_MARKER = "__ANA_MUTANT_ROW__";
const QUALIFY_OK_MARKER = "__ANA_QUALIFY_OK__";
const QUALIFY_FAIL_MARKER = "__ANA_QUALIFY_FAIL__";

interface BatchRow {
  readonly id: string;
  readonly killed: VerdictMap;
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
    [process.execPath, "test", "--bail", "--max-concurrency=" + String(conc), "--timeout=" + String(testWallMs(timeoutSec)), ...paths.map((p) => (p.startsWith("/") || p.startsWith("./") || p.startsWith("../") ? p : "./" + p))],
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
function chunkWaves(names) {
  const budgetMs = Math.max(10000, Math.floor((cfg.seconds * 1000) / 3));
  const chunks = [];
  let cur = [], ms = 0;
  for (const name of names) {
    const dur = cfg.durations[name] ?? 4000;
    if (cur.length > 0 && (ms + dur > budgetMs || cur.length >= 10)) { chunks.push(cur); cur = []; ms = 0; }
    cur.push(name);
    ms += dur;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}
async function qualify() {
  if (cfg.qualifySuites.length === 0) return true;
  const qConc = Math.min(4, Math.max(1, Math.floor(availableParallelism() / (2 * cfg.slots))));
  const pathsFor = (names) => [...new Set(names.flatMap((name) => cfg.suites[name] ?? []))];
  const qTimeout = (count) => Math.min(600, Math.max(cfg.seconds, Math.ceil(count / qConc) * 30));
  const findBad = async (names) => {
    const paths = pathsFor(names);
    if (paths.length === 0) return null;
    const said = await runPaths(root, paths, qConc, qTimeout(paths.length));
    if (said === false) return null;
    if (names.length === 1) return { suite: names[0], said };
    const mid = Math.floor(names.length / 2);
    return (await findBad(names.slice(0, mid))) ?? (await findBad(names.slice(mid)));
  };
  const bad = await findBad(cfg.qualifySuites);
  if (bad === null) { console.log(QUALIFY_OK); return true; }
  const at = cfg.remoteLabel === "" ? "" : " on " + cfg.remoteLabel;
  const why = 'baseline suite "' + bad.suite + '" did not pass unmutated (' + (bad.said === true ? "failed" : "no verdict") + ')' + at;
  console.log(QUALIFY_FAIL + JSON.stringify({ suite: bad.suite, why }));
  return false;
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
        for (const wave of chunkWaves(rest)) {
          if (wave.length === 1) {
            killed[wave[0]] = await runPaths(dir, cfg.suites[wave[0]] ?? [], 1, timeoutFor(wave[0]));
            if (killed[wave[0]] === true) break;
            continue;
          }
          const paths = wave.map((name) => cfg.suites[name][0]);
          const batch = parseBail(wave, await spawnTest(dir, paths, 1, combinedTimeout(wave)));
          const blamed = wave.find((name) => batch[name] === true);
          if (blamed !== undefined) {
            const solo = await runPaths(dir, cfg.suites[blamed] ?? [], 1, timeoutFor(blamed));
            const res = solo === true ? batch : await runSolo(dir, wave, { [blamed]: solo });
            Object.assign(killed, res);
            if (Object.values(res).some(Boolean)) break;
          } else if (wave.some((name) => batch[name] === null)) {
            const res = await runSolo(dir, wave, batch);
            Object.assign(killed, res);
            if (Object.values(res).some(Boolean)) break;
          } else {
            Object.assign(killed, batch);
          }
        }
        for (const name of rest) if (!(name in killed)) killed[name] = null;
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
  const lanes = Math.min(6, Math.max(1, Math.floor(availableParallelism() / (2 * cfg.slots))), cfg.plans.length);
  const dirs = Array.from({ length: lanes }, () => mkdtempSync(join(tmpdir(), "ana-m-")));
  const cloneAll = Promise.all(dirs.map((copy) => cloneLane(copy)));
  const deadline = cfg.remainingMs === null ? null : Date.now() + cfg.remainingMs;
  const hb = setInterval(() => console.log("__ANA_HEARTBEAT__"), 20000);
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
    clearInterval(hb);
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
  readonly refused: { readonly suite: string; readonly why: string } | null;
  readonly dropped: boolean;
  readonly stderr: string;
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
    slots: worker.place.slots,
    stopAtKill: opts.stopAtKill,
    seconds: opts.seconds,
    suiteTimeouts,
    durations: Object.fromEntries(opts.durations),
    remainingMs: Number.isFinite(opts.deadline) ? Math.max(0, opts.deadline - Date.now()) : null,
  });
  const totalMs = Math.min(3_600_000, (opts.seconds * Math.max(1, plans.length) + 60) * 1000);
  const source = [
    `const cfg = ${payload};`,
    `const re = ${VERDICT_RE.toString()};`,
    `const PER_TEST_WALL_MS = ${String(PER_TEST_WALL_MS)};`,
    `const testWallMs = ${testWallMs.toString()};`,
    `const BATCH_ROW = ${JSON.stringify(BATCH_MARKER)};`,
    `const QUALIFY_OK = ${JSON.stringify(QUALIFY_OK_MARKER)};`,
    `const QUALIFY_FAIL = ${JSON.stringify(QUALIFY_FAIL_MARKER)};`,
    `const TOTAL_MS = ${String(totalMs)};`,
    BATCH_DRIVER_BODY,
  ].join("\n");
  writeFileSync(driverPath, source);
  const batchSeconds = Math.min(3600, opts.seconds * Math.max(1, plans.length) + 60);
  try {
    const run = Bun.spawn(["bun", "test", explicitPath(BATCH_FILE)], {
      cwd: worker.clone,
      env: { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(batchSeconds) },
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    opts.activeProcs.add(run);
    const rows: BatchRow[] = [];
    let qualified = false;
    let refused: { readonly suite: string; readonly why: string } | null = null;
    const decoder = new TextDecoder();
    let buf = "";
    const handleLine = (line: string) => {
      if (line.includes(QUALIFY_OK_MARKER)) qualified = true;
      const failAt = line.indexOf(QUALIFY_FAIL_MARKER);
      if (failAt !== -1) {
        // SAFETY: emitted as JSON `{ suite, why }` by `BATCH_DRIVER_BODY` above.
        refused = JSON.parse(line.slice(failAt + QUALIFY_FAIL_MARKER.length)) as {
          readonly suite: string;
          readonly why: string;
        };
      }
      const rowAt = line.indexOf(BATCH_MARKER);
      if (rowAt !== -1) {
        // SAFETY: every marked line was emitted by `BATCH_DRIVER_BODY` above.
        const row = JSON.parse(line.slice(rowAt + BATCH_MARKER.length)) as BatchRow;
        rows.push(row);
        opts.onRow(row);
      }
    };
    const [code, , stderr] = await Promise.all([
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
      new Response(run.stderr).text(),
    ]);
    opts.activeProcs.delete(run);
    return { rows, qualified, refused, dropped: NO_VERDICT.has(code), stderr: stderr.trim() };
  } finally {
    if (existsSync(driverPath)) rmSync(driverPath, { force: true });
  }
}

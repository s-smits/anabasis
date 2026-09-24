// Run every test suite on its own, under coverage, and save one report per suite.
//
// Why one report per suite: a single whole-suite report cannot say WHICH test file reached a
// line. Isolated reports make "does anyone else cover this line?" computable.
//
// Practical notes:
//   - lists .test.ts files directly under test/ and the named starter directory; other extensions
//     and nested files are not included
//   - a file that exceeds the per-file wall (third argument, seconds) is killed, so one
//     hanging suite cannot stall the run
//   - runs.json lands last: if it exists, the harvest is complete. Coverage directories are
//     flattened with `__` in place of `/`.
//
// Usage:
//   REPO=/abs/worktree bun coverage-harvest.mjs /abs/out [concurrency] [timeoutSec]

import { boundText } from "#src/meta/bounded-text.ts";
import { mkdir, readdir } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";
import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { spawnCollected } from "#src/builder/candidate-isolation-runtime.ts";

const repo = Bun.env.REPO ?? runtimeProcess.cwd();
const [outArg, concurrencyArg, timeoutArg] = parseOrDie(exitWith("coverage-harvest"), {
  positionals: [0, 3],
}).positionals;
const out = path.resolve(outArg ?? "test-impact");
const concurrency = Number(concurrencyArg ?? 5);
const timeoutMs = Number(timeoutArg ?? 180) * 1000;

const DIRS = ["test", "starters/pi-built-harness/correctness-model"];

async function listTests(dir) {
  try {
    return (await readdir(path.join(repo, dir)))
      .filter((f) => f.endsWith(".test.ts"))
      .sort()
      .map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

const files = (await Promise.all(DIRS.map(listTests))).flat();
await mkdir(path.join(out, "cov"), { recursive: true });

async function run(relFile, index) {
  const covDir = path.join(out, "cov", relFile.replaceAll("/", "__"));
  await mkdir(covDir, { recursive: true });
  const started = Date.now();
  // The wall belongs to the launch owner: a hanging suite's own children are in the child's
  // group, and a kill sent here would reach the suite process and leave them running.
  const outcome = await spawnCollected(
    Bun.argv[0],
    ["--no-env-file", "test", relFile, "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${covDir}`],
    repo,
    Bun.env,
    undefined,
    timeoutMs,
  );
  const ms = Date.now() - started;
  const ran = /\bRan (\d+) tests?\b/.exec(`${outcome.stdout}${outcome.stderr}`);
  const tests = ran ? Number(ran[1]) : null;
  // A child ended by a signal has no exit code; record it as non-zero so a killed run is never
  // read as a clean one.
  const code = outcome.status ?? 1;
  console.error(
    `[${index + 1}/${files.length}] ${relFile} exit=${code} ${ms}ms tests=${tests ?? "?"}${outcome.timedOut ? " TIMEOUT" : ""}`,
  );
  return {
    file: relFile,
    exit: code,
    ms,
    timedOut: outcome.timedOut,
    tests,
    err: outcome.timedOut ? "" : boundText(outcome.stderr, 2000, "tail").shown,
  };
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const i = cursor++;
    results.push(await run(files[i], i));
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

// runs.json is written last, so its presence means every report is complete.
// Reading the reports before this file exists yields silent empty coverage sets.
await Bun.write(path.join(out, "runs.json"), JSON.stringify(results, null, 2));
const red = results.filter((r) => r.exit !== 0);
console.error(
  `done: ${results.length} files, ${red.length} non-zero, ${results.filter((r) => r.timedOut).length} timeouts`,
);
for (const r of red) console.error(`  non-zero: ${r.file}`);

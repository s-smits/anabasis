// Decide whether a shortlisted test file may be removed.
//
// Coverage overlap says another test file executes the same lines. It does not say
// another test file asserts the same behaviour. Mutation asks the question directly:
// plant a fault on a line the candidate covers, then see who turns red.
//
//   candidate red, peers red   duplicated      that behaviour is pinned twice
//   candidate red, peers green ONLY-CANDIDATE  the candidate is load-bearing; keep it
//   candidate green            uninformative   says nothing about the candidate
//
// A candidate is REDUNDANT only when no planted fault was caught by it alone.
//
// Mutation runs against a mirror, never the worktree, so an interrupted run cannot
// leave a fault in tracked source.
//
// Usage:
//   REPO=/abs/worktree bun mutation-adjudicate.mjs /abs/out <candidate>...
//   REPO=... MIRROR=/abs/mirror2 bun mutation-adjudicate.mjs /abs/out-b <candidate>...
//
// Shard across several MIRROR copies to run candidates in parallel; one mirror
// cannot host two shards, because they would overwrite each other's faults.
import { mkdir, readdir, realpathSync, rm } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { classifyBunTestProcess } from "./mutation-run-result.mjs";
import { spawnCollected } from "#src/builder/candidate-isolation-runtime.ts";

const REPO = realpathSync(Bun.env.REPO ?? runtimeProcess.cwd());
const OUT = path.resolve(Bun.argv[2]);
const CANDIDATES = Bun.argv.slice(3);
const MAX_MUTANTS = Number(Bun.env.MAX_MUTANTS ?? 10);
const MAX_PEERS = Number(Bun.env.MAX_PEERS ?? 8);
const RUN_TIMEOUT_MS = Number(Bun.env.RUN_TIMEOUT_SEC ?? 120) * 1000;
const COV = Bun.env.COV ?? path.join(OUT, "..", "harvest", "cov");

// The mirror owns a real dependency directory. A node_modules symlink resolves
// @ana through the source tree and makes vendor mutations test the wrong bytes.
const mirrorInput = Bun.env.MIRROR ?? path.join(OUT, "mirror");
// ---- reach map, so peers can be picked per source file ----
const reach = new Map();
// These textual substitutions aim to keep syntax valid. They are not parser-aware and can
// still break syntax or alter strings. Inspect each mutant; a parse/setup failure is not
// evidence that every test detected the intended behavioural fault.
const OPS = [
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ && /g, " || "],
  [/ \|\| /g, " && "],
  [/ >= /g, " > "],
  [/ <= /g, " < "],
  [/ > /g, " >= "],
  [/ < /g, " <= "],
  [/\btrue\b/g, "false"],
  [/\bfalse\b/g, "true"],
  [/ \+ /g, " - "],
  [/ - /g, " + "],
  [/ \* /g, " / "],
  [/\?\?/g, "||"],
];

const report = [];
await mkdir(OUT, { recursive: true });
await mkdir(mirrorInput, { recursive: true });
const MIRROR = realpathSync(mirrorInput);
const rsync = Bun.spawn(
  ["rsync", "-a", "--delete", "--exclude", "node_modules", "--exclude", ".git", `${REPO}/`, `${MIRROR}/`],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
const rsyncExit = await rsync.exited;
if (rsyncExit !== 0) throw new Error(`rsync exit ${rsyncExit}`);
await copyDependencies();

async function spawnAwait(cmd, args) {
  return await Bun.spawn([cmd, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;
}

async function copyDependencies() {
  const source = path.join(REPO, "node_modules");
  const target = path.join(MIRROR, "node_modules");
  try {
    await readdir(source);
  } catch {
    throw new Error(`${REPO} has no node_modules; prepare it with scripts/worktree.sh`);
  }
  await rm(target, { recursive: true, force: true });
  let copied = await spawnAwait("cp", ["-Rc", source, target]);
  if (copied !== 0) {
    await rm(target, { recursive: true, force: true });
    copied = await spawnAwait("cp", ["-R", source, target]);
  }
  if (copied !== 0) throw new Error(`could not copy dependencies into ${MIRROR}`);

  const manifest = await Bun.file(path.join(REPO, "package.json")).json();
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const names = Object.keys(declared).filter((name) => name.startsWith("@ana/"));
  await mkdir(path.join(target, "@ana"), { recursive: true });
  for (const name of names) {
    const packageName = name.slice("@ana/".length);
    const link = path.join(target, "@ana", packageName);
    await rm(link, { recursive: true, force: true });
    if ((await spawnAwait("ln", ["-s", `../../vendor/${packageName}`, link])) !== 0) {
      throw new Error(`could not repoint ${name} inside ${MIRROR}`);
    }
    const resolved = Bun.resolveSync(name, MIRROR);
    if (!resolved.startsWith(`${MIRROR}/`)) {
      throw new Error(`${name} resolves outside ${MIRROR}: ${resolved}`);
    }
  }
}

for (const raw of (await readdir(COV)).sort()) {
  const t = raw.replaceAll("__", "/");
  const m = new Map();
  try {
    const lcov = await Bun.file(path.join(COV, raw, "lcov.info")).text();
    let source = null;
    for (const line of lcov.split("\n")) {
      if (line.startsWith("SF:")) {
        source = path.relative(REPO, line.slice(3));
        continue;
      }
      if (line === "end_of_record") {
        source = null;
        continue;
      }
      if (source === null || !/^(src|tools|vendor|starters)\//.test(source)) continue;
      if (!line.startsWith("DA:")) continue;
      const [lineNumber, count] = line.slice(3).split(",").map(Number);
      if (!(count > 0)) continue;
      const lines = m.get(source) ?? new Set();
      lines.add(lineNumber);
      m.set(source, lines);
    }
  } catch {
    // a test file that cannot be read has no reach; the empty map says so
  }
  reach.set(t, m);
}

function mutantsFor(text, lines) {
  const rows = text.split("\n");
  const out = [];
  for (const ln of [...lines].sort((a, b) => a - b)) {
    const row = rows[ln - 1];
    if (row === undefined) continue;
    if (/^\s*(\*|\/\/|import|export type)/.test(row)) continue;
    const code = row.replace(/\/\/.*$/, "");
    for (const [re, rep] of OPS) {
      re.lastIndex = 0;
      if (!re.test(code)) continue;
      const mutated = row.replace(re, rep);
      if (mutated === row) continue;
      const copy = rows.slice();
      copy[ln - 1] = mutated;
      out.push({ line: ln, from: row.trim(), to: mutated.trim(), text: copy.join("\n") });
      break; // one fault per line keeps the run cheap and the attribution clear
    }
  }
  return out;
}

/** What the planted faults say about the candidate test: a run that never completed decides
 *  nothing, faults nobody caught say the test is not load-bearing, and faults its peers also
 *  caught say it duplicates them. */
function adjudicate(runErrors, informative, exclusive) {
  if (runErrors > 0) return "run-error";
  if (informative === 0) return "no-fault-caught";
  if (exclusive === 0) return "REDUNDANT-IN-SCOPE";
  return "LOAD-BEARING";
}

async function runBunTests(files) {
  const failed = new Set();
  for (const file of files) {
    // The wall belongs to the launch owner: a planted fault can hang a suite, and the group
    // kill reaches the children a signal to this process alone would orphan.
    const run = await spawnCollected(
      Bun.argv[0],
      ["--no-env-file", "test", file],
      MIRROR,
      Bun.env,
      undefined,
      RUN_TIMEOUT_MS,
    );
    const output = `${run.stdout}\n${run.stderr}`;
    // A signalled child has no exit code; a run that did not finish is a run error either way.
    const outcome = classifyBunTestProcess(run.status ?? 1, output);
    if (outcome === "run-error") {
      return { completed: false, failed, diagnostic: `${file}: ${output.trim().slice(-2_000)}` };
    }
    if (outcome === "failed") failed.add(file);
  }
  return { completed: true, failed, diagnostic: null };
}

for (const raw of CANDIDATES) {
  const named = raw.endsWith(".test.ts") ? raw : `${raw}.test.ts`;
  const C = named.includes("/") ? named : `test/${named}`;
  const mine = reach.get(C);
  if (!mine?.size) {
    // No covered first-party lines were found. The cause may be a subprocess, configuration,
    // a document, a type check or missing coverage. Read the test before classifying it.
    report.push({ candidate: C, verdict: "coverage-blind-read-it", results: [] });
    console.error(`${C}: coverage-blind, judge by reading`);
    continue;
  }

  const planted = [];
  for (const [srcRel, lines] of [...mine.entries()].sort((a, b) => b[1].size - a[1].size)) {
    if (planted.length >= MAX_MUTANTS) break;
    const abs = path.join(MIRROR, srcRel);
    let text;
    try {
      text = await Bun.file(abs).text();
    } catch {
      continue;
    }
    for (const m of mutantsFor(text, lines)) {
      if (planted.length >= MAX_MUTANTS) break;
      planted.push({ srcRel, abs, original: text, ...m });
    }
  }

  const subjectEntries = [...mine.entries()].sort((a, b) => b[1].size - a[1].size);
  const subjectTotal = subjectEntries.reduce((sum, [, lines]) => sum + lines.size, 0);
  const subjects = [];
  let subjectLines = 0;
  for (const [srcRel] of subjectEntries) {
    subjects.push(srcRel);
    subjectLines += mine.get(srcRel).size;
    if (subjectLines >= subjectTotal * 0.5) break;
  }

  const peerScore = new Map();
  for (const [t, m] of reach) {
    if (t === C) continue;
    const peerReach = [...m.values()].reduce((sum, lines) => sum + lines.size, 0);
    if (peerReach > 5_000) continue;
    let shared = 0;
    for (const srcRel of subjects) shared += m.get(srcRel)?.intersection(mine.get(srcRel)).size ?? 0;
    if (shared > 0) peerScore.set(t, shared);
  }
  const peers = [...peerScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PEERS)
    .map(([t]) => t);

  const baseline = await runBunTests([C, ...peers]);
  if (!baseline.completed || baseline.failed.size > 0) {
    const red = [...baseline.failed];
    report.push({
      candidate: C,
      verdict: "BASELINE-RED",
      subjects,
      peers,
      red,
      diagnostic: baseline.diagnostic,
    });
    console.error(
      `${C}: BASELINE-RED — skipping mutation; red before faults: ${red.join(", ") || baseline.diagnostic}`,
    );
    continue;
  }

  const results = [];
  for (const m of planted) {
    await Bun.write(m.abs, m.text);
    try {
      const run = await runBunTests([C, ...peers]);
      const row = { src: m.srcRel, line: m.line, from: m.from, to: m.to };
      if (!run.completed) {
        results.push({ ...row, status: "run-error", diagnostic: run.diagnostic });
        continue;
      }
      const failed = run.failed;
      const byCandidate = failed.has(C);
      const byPeers = [...failed].filter((f) => f !== C);
      const caught = byPeers.length > 0 ? "DUPLICATED-IN-SCOPE" : "ONLY-CANDIDATE";
      results.push({ ...row, byCandidate, byPeers, status: byCandidate ? caught : "uninformative" });
    } finally {
      await Bun.write(m.abs, m.original); // restore even if the run throws
    }
  }

  const informative = results.filter((r) => r.byCandidate);
  const exclusive = informative.filter((r) => r.status === "ONLY-CANDIDATE");
  const runErrors = results.filter((r) => r.status === "run-error");
  const verdict = adjudicate(runErrors.length, informative.length, exclusive.length);
  console.error(
    `${C}: ${verdict}  peers=${peers.length} planted=${results.length} caught=${informative.length} exclusive=${exclusive.length}`,
  );
  report.push({ candidate: C, verdict, subjects, peers, results });
  await Bun.write(path.join(OUT, "mutation.json"), JSON.stringify(report, null, 2));
}

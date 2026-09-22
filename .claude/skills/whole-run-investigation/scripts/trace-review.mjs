#!/usr/bin/env bun
// Recorded evidence before interpretation: run the selected deterministic views and write
// the output to a snapshot directory. The reviewer reads this BEFORE launching sessions, and every
// number a session reports is reconciled against it afterwards. A disagreement with the default
// view needs investigation of both the session total and the reader.
//
// The outcome CLI takes an ABSOLUTE campaign path, so this reads a live peer run without
// executing anything inside that run's worktree. Run it from a quiet worktree.
//
// usage:
//   bun trace-review.mjs --campaign <absolute campaign dir> --run <runId> [--out <dir>]
//                        [--repo <worktree with tools/outcome>] [--cases <n>]
//
// The run selector is singular and mandatory. Every view is read-only.

import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { resolveRunTarget, resolveSourceCheckout } from "./run-target.mjs";
import { buildDigest } from "./trace-digest.mjs";
import { buildTimeline } from "./timeline.mjs";
import { buildReviewYield, renderReviewYield } from "./review-yield/index.mjs";
import { runtimeProcess } from "#src/meta/process.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { buildHarnessEvolution } from "../../final-harness-audit/scripts/harness-versions.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isBoolean, isString } from "#src/meta/json-shape.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const GIT_SHA = /^[0-9a-f]{40}$/;
const SOURCE_DIGEST = /^[0-9a-f]{64}$/;
const EXECUTABLE_ROOTS = [
  "src",
  "starters",
  "tools",
  "vendor",
  "package.json",
  "bun.lock",
  ".bun-version",
  "thresholds.frozen.yaml",
  "tsconfig.json",
];
// Bun on PATH runs the review; the pin file is hashed as committed because the opening did so.
const PIN_FILE = ".bun-version";
/** One view's output file, and the line a captured failure prints. Each is written, recorded in
 *  the view row and read back by name, so the spellings have to agree. */
const DIGEST_FILE = "digest.md";
const YIELD_FILE = "review-yield.json";
const EVOLUTION_FILE = "harness-evolution.json";
const FAILED_LINE = "FAILED (captured)";
const USAGE = `usage: bun run review:collect -- <campaign dir | campaign/controller/<runId>> [--run <runId>] [--repo <measured checkout>] [--out <snapshot dir>] [--cases <n>] [--all] [--diagnostics]

Point at one folder. The run is the folder's own run, or the campaign's latest opening (--run
selects another). The measured checkout is the current directory or any worktree of this
repository when clean at the run's source commit, otherwise a detached worktree prepared once under
~/.cache/hb4/wri-source. The snapshot lands under ~/.cache/hb4/wri/<runId> unless --out says otherwise.
Collect all standard deterministic views for ONE source-bound run (the default; --all is explicit).
Includes digest, category/hook census, review yield, harness evolution, Builder/tool usage,
outcomes, scan, scorecard, warning observations, all four case partitions and sampled dossiers.
No model calls or automatic product changes. Source-specific missing views remain unavailable.
The private angle-15 challenge and optional prose/reference probes keep their own admission.
--diagnostics also prepares two native lane prompts under <snapshot>/diagnostic-lanes.
For a larger review, build-manifest.mjs --auto N --diagnostics adds these two lanes.`;

const VALUED_OPTIONS = new Set(["--campaign", "--run", "--repo", "--out", "--cases"]);
const positional = [];
const views = [];
if (Bun.argv.includes("--help")) {
  console.log(USAGE);
  runtimeProcess.exit(0);
}

/** @param {string | null} [fallback] */
function arg(name, fallback = null) {
  const i = Bun.argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= Bun.argv.length ? fallback : Bun.argv[i + 1];
}

function gitText(repoPath, ...args) {
  return runTextSyncOrThrow(["git", "-C", repoPath, ...args]).trim();
}

function sourceDigest(repoPath) {
  const listed = gitText(
    repoPath,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...EXECUTABLE_ROOTS,
  );
  const paths = [...new Set(listed.split("\0").filter(Boolean))].sort();
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of paths) {
    hash.update(`\0${path}\0`);
    try {
      hash.update(
        path === PIN_FILE
          ? runTextSyncOrThrow(["git", "-C", repoPath, "show", `HEAD:${path}`])
          : readFileSync(join(repoPath, path)),
      );
    } catch {
      hash.update("<absent>");
    }
  }
  return hash.digest("hex");
}

for (let index = 2; index < Bun.argv.length; index += 1) {
  if (VALUED_OPTIONS.has(Bun.argv[index])) index += 1;
  else if (!Bun.argv[index].startsWith("--")) positional.push(Bun.argv[index]);
}
const folder = positional[0] ?? arg("campaign");
if (folder === null || positional.length > 1 || Bun.argv.filter((value) => value === "--run").length > 1) {
  console.error(USAGE);
  runtimeProcess.exit(2);
}
let target;
try {
  target = resolveRunTarget(folder, arg("run"));
} catch (error) {
  console.error(error.message);
  runtimeProcess.exit(2);
}
// One run per snapshot: a builder-only or multi-run snapshot is not ground truth.
const { campaign, runId } = target;
console.error(`run ${runId} (${target.chosen}) in ${campaign}`);
const caseLimit = arg("cases", "40");
const out = resolve(arg("out", join(homedir(), ".cache", "hb4", "wri", runId)));
const openingPath = join(resolve(campaign), "controller", runId, "opening.json");
if (!existsSync(openingPath)) {
  console.error(`no opening.json for the requested run: ${openingPath}`);
  runtimeProcess.exit(2);
}
let opening;
try {
  opening = readJsonFile(openingPath);
} catch (error) {
  console.error(`cannot read ${openingPath}: ${error.message}`);
  runtimeProcess.exit(2);
}
const openingSource = opening?.source;
if (opening?.runId !== runId) {
  console.error(`opening runId ${opening?.runId ?? "missing"} differs from requested run ${runId}`);
  runtimeProcess.exit(2);
}
if (
  !GIT_SHA.test(String(openingSource?.commit ?? "")) ||
  !SOURCE_DIGEST.test(String(openingSource?.sourceDigest ?? "")) ||
  !isBoolean(openingSource?.dirty)
) {
  console.error(`opening source identity is not concrete at ${openingPath}`);
  runtimeProcess.exit(2);
}
let checkout;
try {
  checkout = resolveSourceCheckout(openingSource.commit, { repo: arg("repo"), cwd: runtimeProcess.cwd() });
} catch (error) {
  console.error(`cannot prepare a checkout at ${openingSource.commit}: ${error.message}`);
  runtimeProcess.exit(2);
}
const repo = checkout.repo;
console.error(`measured checkout ${repo} (${checkout.chosen})`);
const cli = join(repo, "tools", "outcome", "cli.ts");
if (!existsSync(cli)) {
  console.error(`missing tools/outcome/cli.ts under ${repo}`);
  runtimeProcess.exit(2);
}
let repoHead;
let observedSourceDigest;
let observedDirty;
try {
  repoHead = gitText(repo, "rev-parse", "HEAD");
  observedSourceDigest = sourceDigest(repo);
  observedDirty =
    gitText(repo, "status", "--porcelain", "--untracked-files=no", "--", ".", `:!${PIN_FILE}`).length > 0;
} catch (error) {
  console.error(`cannot resolve worktree HEAD under ${repo}: ${error.message}`);
  runtimeProcess.exit(2);
}
if (!GIT_SHA.test(repoHead) || repoHead !== openingSource.commit) {
  console.error(`run source commit ${openingSource.commit} does not match worktree HEAD ${repoHead}`);
  runtimeProcess.exit(2);
}
if (observedSourceDigest !== openingSource.sourceDigest) {
  console.error(
    `run source digest ${openingSource.sourceDigest} does not match the recaptured worktree digest ${observedSourceDigest}`,
  );
  runtimeProcess.exit(2);
}
if (observedDirty !== openingSource.dirty) {
  console.error(
    `run source dirty flag ${openingSource.dirty} does not match the recaptured worktree state ${observedDirty}`,
  );
  runtimeProcess.exit(2);
}
const openingBytes = readFileSync(openingPath);
const openingDigest = new Bun.CryptoHasher("sha256").update(openingBytes).digest("hex");
const terminalPath = join(resolve(campaign), "controller", runId, "terminal.json");
let terminal = null;
if (existsSync(terminalPath)) {
  try {
    terminal = readJsonFile(terminalPath);
  } catch (error) {
    console.error(
      `terminal evidence is unreadable; terminal accounting will remain explicit: ${error.message}`,
    );
  }
}

/**
 * One parent identity as a single line. `manifest-inputs.mjs` renders each parent with `String()`,
 * so the projection stays a string here rather than reaching the prompt as `[object Object]`.
 */
function parentLabel(parent) {
  if (parent === null || typeof parent !== "object") return null;
  const commit = isString(parent.commit) ? parent.commit.slice(0, 12) : "unknown-commit";
  const epoch = isString(parent.epoch) ? parent.epoch : "unknown-epoch";
  return `${commit} (epoch ${epoch}, submit #${parent.ordinal ?? "?"}, written ${parent.writtenAt ?? "?"})`;
}

/**
 * The run's own scorecard resolves the last candidate and last accepted submit from the Builder
 * execution records, ordered by recorded iteration time. Four recorded runs published nulls here
 * while their records held five to forty-nine real submits, so the value is read rather than
 * written. An older run source whose scorecard carries no `reach.parents` stays honestly absent.
 */
function scorecardParents(text) {
  if (text === null) return null;
  try {
    return capturedJsonParse(text)?.reach?.parents ?? null;
  } catch {
    return null;
  }
}

function terminalFacts(openingEvidence, terminalEvidence, parents) {
  const openingBudget = openingEvidence?.budget ?? {};
  const terminalBudget = terminalEvidence?.budget ?? {};
  const openingUsed = Number.isInteger(openingBudget.turnsUsed) ? openingBudget.turnsUsed : null;
  const terminalUsed = Number.isInteger(terminalBudget.turnsUsed) ? terminalBudget.turnsUsed : null;
  const denominator = terminalEvidence?.denominator;
  const iterations = Array.isArray(terminalEvidence?.iterations) ? terminalEvidence.iterations : [];
  const reason = isString(terminalEvidence?.terminalReason) ? terminalEvidence.terminalReason : "";
  const cap = reason.match(/round cap (\d+)/)?.[1];
  return {
    terminalAccounting: {
      // --max-iterations is intentionally not copied into the opening command digest. A cap is
      // therefore named only when the recorded terminal itself says it fired; otherwise sessions see
      // an honest "uncapped or not recorded" value instead of a guessed six-round limit.
      outerCap: cap === undefined ? null : Number(cap),
      completedRounds: iterations.length,
      authorCalls: {
        budget: Number.isInteger(terminalBudget.turnBudget) ? terminalBudget.turnBudget : "uncapped",
        opening: openingUsed,
        terminal: terminalUsed,
        delta: openingUsed !== null && terminalUsed !== null ? terminalUsed - openingUsed : null,
        unit: "completed authoring/session-call attempts",
      },
      // These are case-denominator counts, deliberately labelled here so they cannot be mistaken
      // for candidate or controller-event counts. The raw event stream stays unavailable until the
      // builder trace/digest has supplied it; the parent identities below are read.
      counts: {
        raw: Number.isInteger(denominator?.total) ? denominator.total : null,
        real:
          Number.isInteger(denominator?.verified) && Number.isInteger(denominator?.unaccepted)
            ? denominator.verified + denominator.unaccepted
            : null,
        controller: iterations.length,
        semantics: "raw/real are recorded case counts; controller is completed iteration count",
      },
      parents: {
        lastCandidate: parentLabel(parents?.lastCandidate ?? null),
        // No reader supplies an adopted parent: adoption is not a submit row. It stays absent
        // rather than borrowing the last candidate, which is a different identity.
        adopted: null,
        accepted: parentLabel(parents?.accepted ?? null),
        source:
          parents === null || parents === undefined
            ? "unavailable: this run's scorecard view carried no reach.parents"
            : "outcome --scorecard reach.parents, from the builder execution records",
        lastControllerIteration: isString(terminalEvidence?.lastIteration)
          ? terminalEvidence.lastIteration
          : null,
      },
    },
  };
}
mkdirSync(out, { recursive: true });

const runner = [Bun.argv[0], "--no-env-file"];
const byteLength = (text) => new TextEncoder().encode(text).byteLength;

function exec(args) {
  return runTextSyncOrThrow([...runner, cli, ...args], {
    cwd: repo,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function view(label, args, ext = "txt", required = true) {
  console.write(`${label} ... `);
  let text;
  let ok = true;
  try {
    text = exec(args);
  } catch (error) {
    ok = false;
    text = `COMMAND FAILED: outcome ${args.join(" ")}\n\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`;
  }
  // A view that exits cleanly with no output is not a collected fact. Saying so keeps an empty
  // snapshot from reading as "the run had nothing to report".
  if (ok && text.trim() === "") ok = false;
  const status = ok ? "ok" : text.trim() === "" ? "empty" : "failed";
  const file = `${label}.${ext}`;
  writeFileSync(join(out, file), text);
  // The digest makes each captured view reconcilable byte-for-byte (session 30 reads it against
  // the file it names) instead of trusting a length.
  views.push({
    label,
    file,
    args,
    status,
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: runner.join(" "),
    required,
  });
  console.log(ok ? `${text.length} bytes` : status === "empty" ? "EMPTY (no output)" : FAILED_LINE);
  return ok ? text : null;
}

console.log(`campaign: ${campaign}`);
console.log(`snapshot: ${out}\n`);

// Elapsed time by phase, the longest gaps and the recorded hook, steering and prompt rows. The
// observation stream is optional on historical sources: an absent file is an unsupported view.
let timeline;
let timelineStatus = "ok";
try {
  timeline = buildTimeline({ campaign: resolve(campaign), runId });
  if (timeline.state !== "recorded") timelineStatus = "unsupported";
} catch {
  timelineStatus = "failed";
  timeline = {
    schema: "wri-run-timeline/v1",
    state: "failed",
    reason: "The observation stream is unreadable or carries a misshapen row; no timing supplied.",
  };
}
const timelineText = `${JSON.stringify(timeline, null, 2)}\n`;
writeFileSync(join(out, "timeline.json"), timelineText);
views.push({
  label: "timeline",
  file: "timeline.json",
  args: ["timeline.mjs"],
  status: timelineStatus,
  bytes: byteLength(timelineText),
  sha256: new Bun.CryptoHasher("sha256").update(timelineText).digest("hex"),
  runner: "in-process",
  required: false,
});
console.log(`timeline ... ${timelineStatus}`);

// The selector is explicit and singular. Never silently broaden a review to the first or every
// run in a campaign: a digest for another run is a different evidence identity. Campaign-wide
// Builder, review-yield and evolution views below retain their broader scope.
const runIds = [runId];

// The deterministic digest joins recorded bytes the CLI views do not join (declared checks against
// shipping rejections, refusal ledger, condition symmetry, integrity probes). Same completeness gate as
// every other view; it reads JSON directly and executes nothing.
console.write("digest ... ");
try {
  const text = buildDigest({
    campaign,
    domainsRoot: join(dirname(resolve(campaign)), "..", "domains"),
    runIds,
  });
  writeFileSync(join(out, DIGEST_FILE), text);
  views.push({
    label: "digest",
    file: DIGEST_FILE,
    args: ["trace-digest.mjs"],
    status: text.trim() === "" ? "empty" : "ok",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
  });
  console.log(`${text.length} bytes`);
} catch (error) {
  const text = `DIGEST FAILED\n\n${error.stack ?? error.message}`;
  writeFileSync(join(out, DIGEST_FILE), text);
  views.push({
    label: "digest",
    file: DIGEST_FILE,
    args: ["trace-digest.mjs"],
    status: "failed",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
  });
  console.log(FAILED_LINE);
}

// Review-component yield is its own deterministic view: it joins the advisory components' recorded
// outputs (judges, progress guard, contest, promotion, prompt maintenance, epoch review, admission)
// to the controller decision each one may have changed. Counts, ids and owners only; no protected
// text crosses. Rows B, 3, 9 and 26 read it before any prose about a component's usefulness.
console.write("review-yield ... ");
try {
  const report = buildReviewYield(resolve(campaign));
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(out, YIELD_FILE), text);
  writeFileSync(join(out, "review-yield.md"), renderReviewYield(report));
  views.push({
    label: "review-yield",
    file: YIELD_FILE,
    args: ["review-yield/index.mjs", "--json"],
    status: report.complete ? "ok" : "failed",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
    required: true,
  });
  console.log(report.complete ? `${text.length} bytes` : "FAILED (component row invalid; captured)");
} catch (error) {
  const text = `${JSON.stringify({ schema: "wri-review-yield-report/v1", state: "failed", reason: errorMessage(error) }, null, 2)}\n`;
  writeFileSync(join(out, YIELD_FILE), text);
  views.push({
    label: "review-yield",
    file: YIELD_FILE,
    args: ["review-yield/index.mjs", "--json"],
    status: "failed",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
    required: true,
  });
  console.log(FAILED_LINE);
}

// Product evolution is a separate deterministic view because it has a different evidence owner
// from case outcomes. It reads the Builder's workspace history, joins recorded versions to every
// adopted or candidate battery (plus the contest battery of a campaign measured before
// 2026-09-04), and compares public task inputs only. Size and similarity are
// diagnostic facts: they do not score quality or expose protected verifier detail.
console.write("harness-evolution ... ");
try {
  const audit = buildHarnessEvolution({
    repoRoot: repo,
    slug: basename(resolve(campaign)),
    campaignDir: resolve(campaign),
  });
  const text = `${JSON.stringify(audit, null, 2)}\n`;
  writeFileSync(join(out, EVOLUTION_FILE), text);
  views.push({
    label: "harness-evolution",
    file: EVOLUTION_FILE,
    args: ["harness-versions.mjs", "--json"],
    status: "ok",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
    required: true,
  });
  console.log(`${text.length} bytes`);
} catch (error) {
  const text = `${JSON.stringify(
    {
      schema: "harness-evolution/v1",
      state: "failed",
      reason: errorMessage(error),
    },
    null,
    2,
  )}\n`;
  writeFileSync(join(out, EVOLUTION_FILE), text);
  views.push({
    label: "harness-evolution",
    file: EVOLUTION_FILE,
    args: ["harness-versions.mjs", "--json"],
    status: "failed",
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: "in-process",
    required: true,
  });
  console.log(FAILED_LINE);
}

view("builder", [campaign, "--builder"]);

// Run posture: the pinned local embedding in classifier/prose-classify.mjs labels every captured
// prose row on both sides of the run — the Builder's own sidecar (Codex reasoning summaries and
// messages; Claude messages only, since its thinking blocks arrive with empty text) and the Built
// solver's redacted turn previews from each digest-verified case trace — then joins the labels to
// each submit's outcome and each case's kind. It calls no provider, runs from the review checkout
// like the digest, and its output carries counts, labels and identities, never row text.
// Required, not optional: a run whose prose is absent or too thin to read records that verdict, and
// only an integrity failure or a failed command leaves the snapshot incomplete. The view was
// deleted twice (2026-08-25, 2026-09-06) for having no invoker; this call is the invoker.
console.write("prose-posture ... ");
{
  const classifier = join(import.meta.dirname, "..", "classifier", "prose-classify.mjs");
  // The selected run's sessions only: a campaign-wide view would let a later run change this
  // snapshot's posture rows and submit summaries.
  const args = [resolve(campaign), "--run", runId, "--json"];
  let text;
  let status;
  let note;
  try {
    text = runTextSyncOrThrow([...runner, classifier, ...args], {
      cwd: import.meta.dirname,
      maxBuffer: 64 * 1024 * 1024,
    });
    const result = JSON.parse(text);
    status = result.state === "integrity-failure" ? "failed" : "ok";
    note =
      result.state === "classified"
        ? `Builder ${result.evidence.builder.grade}/${result.evidence.builder.rows} rows, solver ${result.evidence.solver.grade}/${result.evidence.solver.rows} rows`
        : result.state;
  } catch (error) {
    status = "failed";
    note = "command failed";
    text = `COMMAND FAILED: prose-classify.mjs ${args.join(" ")}\n\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`;
  }
  writeFileSync(join(out, "prose-posture.json"), text);
  views.push({
    label: "prose-posture",
    file: "prose-posture.json",
    args: ["classifier/prose-classify.mjs", ...args],
    status,
    bytes: byteLength(text),
    sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    runner: runner.join(" "),
    required: true,
  });
  console.log(status === "ok" ? `${text.length} bytes (${note})` : `FAILED (${note}, captured)`);
}

// Filled from the run's own scorecard view below, and read once by the manifest's facts block.
let measuredParents = null;

for (const id of runIds) {
  console.log(`\nrun ${id}`);
  const metrics = view(`${id}-default`, [campaign, id]);
  // The `--climb-economy` CLI view was removed on 2026-08-14; requesting it made every snapshot
  // incomplete. Session 30 now reconciles only a recorded `climb-economy.json` an older run carries in
  // its own campaign; current climb evidence is read from the author-facing ledger rows.
  view(`${id}-scan`, [campaign, id, "--scan"]);
  measuredParents ??= scorecardParents(view(`${id}-scorecard`, [campaign, id, "--scorecard"]));
  view(`${id}-observations-warning`, [campaign, id, "--observations", "--level", "warning", "--limit", "60"]);
  const caseViews = [];
  for (const result of ["fail", "unaccepted", "non-result", "pass"]) {
    caseViews.push(
      view(`${id}-cases-${result}`, [campaign, id, "--cases", "--result", result, "--limit", caseLimit]),
    );
  }
  // Up to two dossiers and traces: enough to check that per-case reading is possible at
  // all, which is what tells a "no telemetry" claim apart from "nobody looked". The case-index
  // views feed the id set too, so a failed default view no longer skips every dossier.
  const taskSource = [metrics, ...caseViews].filter((value) => value !== null).join("\n");
  const taskIds = [...new Set([...taskSource.matchAll(/"taskId":\s*"([^"]+)"/g)].map((m) => m[1]))];
  for (const taskId of taskIds.slice(0, 2)) {
    view(`${id}-case-${taskId}`, [campaign, id, "--case", taskId]);
    view(`${id}-trace-${taskId}`, [campaign, id, "--trace", taskId]);
  }
  if (taskIds.length === 0) {
    console.log("  (no taskId found in the default or case-index views; per-case dossiers skipped)");
  }
}

console.log(`\nsnapshot written to ${out}`);
console.log("Reconcile every session-reported total against these files before acting on it.");

// The snapshot's own evidence: which views ran, under which runner and runtime, and whether the
// selected set is complete. A complete manifest proves collection, not reader correctness; runtime
// identity is recorded here for reconciliation instead of enforced by refusal.
const manifest = {
  schema: "outcome-snapshot-status/v2",
  capturedAt: new Date().toISOString(),
  campaign: resolve(campaign),
  repo,
  runIds,
  source: {
    ...openingSource,
    openingDigest,
    observed: { commit: repoHead, sourceDigest: observedSourceDigest, dirty: observedDirty },
  },
  opening: { path: openingPath, sha256: openingDigest },
  worktree: { path: repo, head: repoHead, dirty: observedDirty },
  facts: terminalFacts(opening, terminal, measuredParents),
  runtime: { version: Bun.version, executable: Bun.argv[0] },
  complete: views.every((entry) => entry.status === "ok" || entry.required === false),
  views,
};
writeJsonFile(join(out, "snapshot-status.json"), manifest);

if (Bun.argv.includes("--diagnostics")) {
  try {
    console.write(
      runTextSyncOrThrow([
        ...runner,
        join(import.meta.dirname, "build-manifest.mjs"),
        "--snapshot",
        out,
        "--worktree",
        repo,
        "--out",
        join(out, "diagnostic-lanes"),
        "--diagnostics",
        "--transport",
        "native",
      ]),
    );
  } catch (error) {
    console.error(`Diagnostic lane preparation failed; snapshot retained: ${error.message}`);
    runtimeProcess.exitCode = 1;
  }
}

if (!manifest.complete) {
  const failed = views.flatMap((entry) =>
    entry.status !== "ok" && entry.required !== false ? [`${entry.label}:${entry.status}`] : [],
  );
  console.error(`SNAPSHOT INCOMPLETE: ${failed.join(", ")}`);
  runtimeProcess.exitCode = 1;
}

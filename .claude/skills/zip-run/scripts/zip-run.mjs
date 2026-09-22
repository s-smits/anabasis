#!/usr/bin/env bun
// Zip one recorded Harness Builder run at one of three levels.
//
//   bun zip-run.mjs <run-dir | campaign-dir> --light|--medium|--verbose [--out <zip>] [--max-mb N]
//
// The run directory is the launched worktree (holds `.scratch/quick-run/launch.json`); a campaign
// directory is `<run-dir>/campaigns/<slug>`. Either is accepted. The zip carries a README.md and a
// MANIFEST.json naming the level, the run identity, every included file with its size, and the
// groups left out. The README ends with the level's preset guidelines from `../readme/<level>.md`.
// Levels are cumulative: medium contains light, verbose contains medium.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

export const LEVELS = ["light", "medium", "verbose"];
const PRESET_DIR = resolve(import.meta.dirname, "..", "readme");
const LIGHT_TARGET_MB = 2;

// Files any level refuses: installed binaries, dependency trees and provider credentials.
const ALWAYS_EXCLUDED_DIRS = new Set([
  ".toolchain",
  "node_modules",
  ".git",
  "downloads",
  "build",
  ".cache",
  ".tmp",
  ".bundle-snapshots",
]);
const ALWAYS_EXCLUDED_FILES = new Set(["auth.json", ".DS_Store"]);
const VERBOSE_MAX_FILE_BYTES = 8 * 1024 * 1024;

const EPOCH_LIGHT = [
  "builder-prose.jsonl",
  "builder-execution.json",
  "builder-session.json",
  "backends.json",
  "campaign.json",
];
const EPOCH_MEDIUM = ["builder-path-record.jsonl", "verifier-workshop.jsonl"];
const CASE_LIGHT = ["case-result.json"];
const CASE_MEDIUM = [
  "trace.json",
  "trace-pointer.json",
  "verifier.json",
  "judge.json",
  "public-task.json",
  "final-submission.json",
  "artifact.json",
];
const MODEL_LIGHT = ["brief.json", "evaluator.ts"];
const QUICK_RUN_LIGHT = ["launch.json", "stop.json", "probe.json", "fullrun.log"];
const SCRATCH_ROOT = ".scratch/quick-run";
/** The controller opening, whose presence is what makes a directory a recorded run. */
const OPENING = "opening.json";
const CAMPAIGN_LIGHT_FILES = ["epochs.json", "budget.json", "case-record.jsonl"];
const CAMPAIGN_LIGHT_DIRS = ["claims", "difficulty-decisions", "analysis", "promotions", "safeguards"];

function usage(message) {
  console.error(message);
  console.error(
    "usage: bun zip-run.mjs <run-dir | campaign-dir> --light|--medium|--verbose [--out <zip>] [--max-mb N]",
  );
  process.exit(2);
}

export function parseArgs(argv) {
  /** @type {{ target: string | null, level: string | null, out: string | null, maxMb: number | null }} */
  const args = { target: null, level: null, out: null, maxMb: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--light" || arg === "--medium" || arg === "--verbose") {
      if (args.level !== null) usage("choose one level");
      args.level = arg.slice(2);
    } else if (arg === "--out") args.out = argv[++i] ?? usage("--out needs a path");
    else if (arg === "--max-mb") args.maxMb = Number(argv[++i]);
    else if (arg.startsWith("--")) usage(`unknown flag ${arg}`);
    else if (args.target === null) args.target = arg;
    else usage("one target only");
  }
  if (args.target === null) usage("name the run or campaign directory");
  if (args.level === null) usage("choose --light, --medium or --verbose");
  if (args.maxMb !== null && !(args.maxMb > 0)) usage("--max-mb needs a positive number");
  return args;
}

function listDir(path) {
  return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path).sort() : [];
}

function walk(dir, visit, level = 0) {
  for (const name of listDir(dir)) {
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (ALWAYS_EXCLUDED_DIRS.has(name)) visit.skipDir?.(path, name);
      else walk(path, visit, level + 1);
    } else if (stat.isFile() && !ALWAYS_EXCLUDED_FILES.has(name)) visit.file(path, stat.size);
  }
}

// Resolve the run identity from either accepted directory shape.
export function resolveRun(target) {
  const abs = resolve(target);
  if (!existsSync(abs)) usage(`${abs} does not exist`);
  const launch = asRecord(readJsonFileOrNull(join(abs, SCRATCH_ROOT, "launch.json")));
  if (launch !== null) {
    // A run worktree: its campaigns/ tree also carries copied campaigns from other runs, so the
    // launched runId selects the campaign.
    const runId = isString(launch.runId) ? launch.runId : usage(`${abs}: launch.json names no runId`);
    for (const slug of listDir(join(abs, "campaigns"))) {
      const campaignDir = join(abs, "campaigns", slug);
      if (existsSync(join(campaignDir, "controller", runId, OPENING))) {
        return { runId, campaignDir, runDir: abs };
      }
    }
    usage(`${abs}: no campaign holds controller/${runId}/opening.json`);
  }
  const runIds = listDir(join(abs, "controller")).filter((id) =>
    existsSync(join(abs, "controller", id, OPENING)),
  );
  if (runIds.length === 0) usage(`${abs} holds no controller/<runId>/opening.json`);
  if (runIds.length > 1) {
    usage(`${abs} holds ${runIds.length} controller runs; name the run worktree instead`);
  }
  // The run worktree is the campaign tree's grandparent, and its launch receipt is what says so.
  const parent = dirname(dirname(abs));
  const runDir = existsSync(join(parent, SCRATCH_ROOT, "launch.json")) ? parent : null;
  return { runId: runIds[0], campaignDir: abs, runDir };
}

// Every epoch workspace may have a Claude Code transcript directory keyed by its encoded path.
function claudeTranscriptDirs(campaignDir) {
  const out = [];
  const projects = join(homedir(), ".claude", "projects");
  for (const epoch of listDir(campaignDir).filter((n) => n.startsWith("epoch-"))) {
    const workspace = join(campaignDir, epoch, "workspace");
    const encoded = workspace.replaceAll("/", "-");
    const dir = join(projects, encoded);
    if (existsSync(dir)) out.push({ epoch, dir });
  }
  return out;
}

export function selectFiles(run, level) {
  const rank = LEVELS.indexOf(level);
  const atLeast = (name) => rank >= LEVELS.indexOf(name);
  const files = new Map(); // archive path -> { source, bytes, group }
  const excluded = new Map(); // group -> reason
  const add = (source, archivePath, group) => {
    const stat = statSync(source, { throwIfNoEntry: false });
    if (stat?.isFile() !== true) return;
    if (ALWAYS_EXCLUDED_FILES.has(basename(source))) return;
    if (level === "verbose" && stat.size > VERBOSE_MAX_FILE_BYTES && group !== "observability") {
      excluded.set(
        `oversize:${archivePath}`,
        `${stat.size} bytes exceeds the ${VERBOSE_MAX_FILE_BYTES}-byte per-file ceiling`,
      );
      return;
    }
    files.set(archivePath, { source, bytes: stat.size, group });
  };
  /** Every case directory of one battery run: whole trees at verbose, named files below it. */
  const addCases = (batteryDir, archiveRoot) => {
    for (const caseId of listDir(join(batteryDir, "cases"))) {
      const dir = join(batteryDir, "cases", caseId);
      if (atLeast("verbose")) {
        addTree(dir, join(archiveRoot, "cases", caseId), "cases");
        continue;
      }
      const names = atLeast("medium") ? [...CASE_LIGHT, ...CASE_MEDIUM] : CASE_LIGHT;
      for (const name of names) add(join(dir, name), join(archiveRoot, "cases", caseId, name), "cases");
    }
  };
  const addTree = (dir, archiveRoot, group, filter = () => true) => {
    walk(dir, {
      file: (path) => {
        if (filter(path)) add(path, join(archiveRoot, relative(dir, path)), group);
      },
      skipDir: (path, name) =>
        excluded.set(
          `${group}:${name}`,
          `${relative(dir, path)} is binaries, dependencies, scratch or candidate snapshots already recorded under versions/`,
        ),
    });
  };

  const { runId, campaignDir, runDir } = run;
  const C = campaignDir;

  // Launch, stop and log: how the run started and ended.
  if (runDir) {
    for (const name of QUICK_RUN_LIGHT) add(join(runDir, SCRATCH_ROOT, name), join("launch", name), "launch");
    if (atLeast("verbose")) {
      addTree(join(runDir, SCRATCH_ROOT, "codex", "sessions"), "transcripts/codex-sessions", "transcripts");
    }
  }

  // Controller opening and terminal; verifier lifetime rows only at verbose.
  const controller = join(C, "controller", runId);
  add(join(controller, OPENING), "controller/opening.json", "controller");
  add(join(controller, "terminal.json"), "controller/terminal.json", "controller");
  if (atLeast("verbose")) {
    addTree(join(controller, "verifier-lifetime"), "controller/verifier-lifetime", "verifier-lifetime");
  } else {
    excluded.set(
      "verifier-lifetime",
      "per-process spawn/intent/settlement receipts (tens of thousands of small files); --verbose",
    );
  }

  // Campaign ledgers, claims, decisions and advice.
  for (const name of CAMPAIGN_LIGHT_FILES) add(join(C, name), name, "campaign");
  for (const name of listDir(C).filter((n) => n.startsWith("isolation-probe-") && n.endsWith(".json"))) {
    add(join(C, name), join("isolation", name), "campaign");
  }
  for (const dir of CAMPAIGN_LIGHT_DIRS) addTree(join(C, dir), dir, dir);
  if (atLeast("verbose")) {
    add(join(C, "controller.sqlite"), "controller.sqlite", "campaign");
    addTree(join(C, "observability"), "observability", "observability");
  } else {
    excluded.set(
      "observability",
      "full model-visible prompt stream (every Builder, Built and Judge start prompt); --verbose",
    );
  }

  // Per epoch: Builder reasoning and execution record, then path record and trials, then the workspace.
  for (const epoch of listDir(C).filter((n) => n.startsWith("epoch-"))) {
    const E = join(C, epoch);
    for (const name of EPOCH_LIGHT) add(join(E, name), join("epochs", epoch, name), "builder");
    if (atLeast("medium")) {
      for (const name of EPOCH_MEDIUM) add(join(E, name), join("epochs", epoch, name), "builder");
      addTree(join(E, "trials"), join("epochs", epoch, "trials"), "builder");
      for (const domain of listDir(E).filter((n) => /^\d{2}-/.test(n))) {
        addTree(join(E, domain), join("epochs", epoch, domain), "builder");
      }
    }
    if (atLeast("verbose")) {
      addTree(join(E, "workspace"), join("epochs", epoch, "workspace"), "workspace");
      addTree(join(E, ".oss"), join("epochs", epoch, ".oss"), "workspace");
    } else {
      excluded.set(
        "workspace",
        "Builder authoring workspace and .oss tool installs; the accepted bytes are under versions/; --verbose",
      );
    }
  }

  // Per version: agent, correctness model, then battery cases at increasing depth.
  for (const version of listDir(join(C, "versions"))) {
    const V = join(C, "versions", version);
    for (const name of ["version.json", "conformance.json", "claim-stages.json"]) {
      add(join(V, name), join("versions", version, name), "versions");
    }
    addTree(join(V, "agent"), join("versions", version, "agent"), "versions");
    const model = join(V, "correctness-model");
    if (atLeast("medium")) addTree(model, join("versions", version, "correctness-model"), "versions");
    else {
      for (const name of MODEL_LIGHT) {
        add(join(model, name), join("versions", version, "correctness-model", name), "versions");
      }
    }
    for (const runName of listDir(join(V, "runs"))) {
      const R = join(V, "runs", runName);
      const root = join("versions", version, "runs", runName);
      for (const name of ["battery.json", "run-manifest.json", "backends.json"]) {
        add(join(R, name), join(root, name), "battery");
      }
      if (atLeast("medium")) addTree(join(R, "judge"), join(root, "judge"), "judge");
      addCases(R, root);
    }
  }
  if (!atLeast("medium")) {
    excluded.set(
      "cases",
      "per-case trace.json, verifier.json, judge.json, artifacts and public tasks; --medium",
    );
    excluded.set(
      "correctness-model",
      "tasks.json (hidden expectations), controls.json and reference/; --medium",
    );
    excluded.set("judge", "Judge census samples, bait corpus and standing; --medium");
  } else if (!atLeast("verbose")) {
    excluded.set(
      "cases-runtime",
      "built-runtime.json, built-registration.json and draft-checkpoints.json per case; --verbose",
    );
  }

  // Full model transcripts with complete tool outputs, when the backend left them on disk.
  if (atLeast("verbose")) {
    for (const { epoch, dir } of claudeTranscriptDirs(C)) {
      addTree(dir, join("transcripts", "claude", epoch), "transcripts");
    }
  } else {
    excluded.set(
      "transcripts",
      "Claude Code or Codex session transcripts with full tool outputs, when present; --verbose",
    );
  }

  return { files, excluded };
}

function groupTotals(files) {
  const totals = new Map();
  for (const { bytes, group } of files.values()) totals.set(group, (totals.get(group) ?? 0) + bytes);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function mb(bytes) {
  return (bytes / 1e6).toFixed(2);
}

function readme(run, level, files, excluded, opening) {
  const source = opening?.source?.commit ?? opening?.sourceCommit ?? "unknown";
  const lines = [
    `# Run bundle: ${run.runId} (${level})`,
    "",
    `Campaign: \`${basename(run.campaignDir)}\`. Source commit: \`${source}\`.`,
    `Files: ${files.size}. Uncompressed: ${mb([...files.values()].reduce((a, f) => a + f.bytes, 0))} MB.`,
    "",
    "## Levels",
    "",
    "- light: launch/stop/log, opening and terminal, ledgers, claims, decisions, advice packets, Builder reasoning per epoch, agent and evaluator per version, one verdict file per case. Aimed at 2 MB.",
    "- medium: light plus per-case trace, verifier, Judge and artifact files, the whole correctness model, Judge census files, Builder path records and trials.",
    "- verbose: medium plus the observability prompt stream, verifier lifetime receipts, every case file, the Builder workspaces (binaries excluded) and any session transcripts on disk.",
    "",
    "## Groups in this bundle",
    "",
    ...groupTotals(files).map(([group, bytes]) => `- ${group}: ${mb(bytes)} MB`),
    "",
    "## Left out at this level",
    "",
    ...(excluded.size > 0
      ? [...excluded.entries()].map(([k, v]) => `- ${k}: ${v}`)
      : ["- nothing beyond binaries, dependencies and credentials"]),
    "",
    "Binaries under `.toolchain`, `.oss/downloads`, `.oss/build`, `node_modules` and provider `auth.json` are never included.",
    "MANIFEST.json lists every file with its byte size.",
    "",
    readFileSync(join(PRESET_DIR, `${level}.md`), "utf8").trimEnd(),
    "",
  ];
  return lines.join("\n");
}

export function buildBundle(args) {
  const run = resolveRun(args.target);
  const { files, excluded } = selectFiles(run, args.level);
  const opening = readJsonFileOrNull(join(run.campaignDir, "controller", run.runId, OPENING));
  const stage = join(tmpdir(), `zip-run-${run.runId}-${args.level}-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  const root = join(stage, `${run.runId}-${args.level}`);
  mkdirSync(root, { recursive: true });
  for (const [archivePath, { source }] of files) {
    const dest = join(root, archivePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(source));
  }
  const manifest = {
    schema: "zip-run/v1",
    level: args.level,
    runId: run.runId,
    campaignDir: run.campaignDir,
    runDir: run.runDir,
    sourceCommit: opening?.source?.commit ?? null,
    writtenAt: new Date().toISOString(),
    files: [...files.entries()].map(([path, { bytes, group }]) => ({ path, bytes, group })),
    excluded: Object.fromEntries(excluded),
  };
  writeFileSync(join(root, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(root, "README.md"), readme(run, args.level, files, excluded, opening));
  const out = resolve(args.out ?? `${run.runId}-${args.level}.zip`);
  rmSync(out, { force: true });
  const zip = spawnSync("zip", ["-qr", "-X", out, basename(root)], {
    cwd: stage,
    stdio: ["ignore", "inherit", "inherit"],
  });
  rmSync(stage, { recursive: true, force: true });
  if (zip.status !== 0) throw new Error(`zip exited ${zip.status}`);
  const bytes = statSync(out).size;
  return { out, bytes, files: files.size, groups: groupTotals(files), excluded, run };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildBundle(args);
  console.log(result.out);
  console.log(
    `${mb(result.bytes)} MB zipped, ${result.files} files, level ${args.level}, run ${result.run.runId}`,
  );
  for (const [group, bytes] of result.groups) console.log(`  ${group}: ${mb(bytes)} MB uncompressed`);
  const cap = args.maxMb ?? (args.level === "light" ? LIGHT_TARGET_MB : null);
  if (cap !== null && result.bytes > cap * 1e6) {
    console.error(`over the ${cap} MB cap: drop the largest group above or pick a lighter level`);
    process.exit(1);
  }
}

#!/usr/bin/env bun
/**
 * Zip one recorded Harness Builder run at one of three cumulative depths, `--light`, `--medium` or
 * `--verbose`, with a README.md and a MANIFEST.json inside. Archive paths mirror the campaign tree,
 * so `controller/<runId>/opening.json` in the zip is the file of that name in the campaign.
 *
 * Where the run's evidence lives is asked of the layout's owners rather than listed here. The
 * batteries are the ones `batteryRunDirs` matches by canonical iteration id under every trace root,
 * which keeps out a sibling run whose id merely starts with this one; a product tree enters when it
 * holds one of those batteries or is named after one of the run's iterations; epochs and their
 * iterations come in the order `campaignEpochs` records; and the safeguard log is this run's own.
 * The strict controller reading is not what selects the batteries, because it refuses exactly the
 * unfinished and damaged runs a handover is most often wanted for; the manifest records its state.
 */
import { CommandFailure, type ExitWith, runCommand } from "#skills/main/cli.ts";
import { emitReport } from "#skills/main/output.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import { campaignEpochs, campaignIterations } from "#src/author/campaign-epoch.ts";
import { batteryRunDirs, campaignTraceRoots } from "#src/claim/trace-read.ts";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { homedir, tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, relative, resolve } from "#src/meta/path.ts";
import { safeguardLogDir } from "#src/meta/safeguard.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import { controllerEvidenceDir, OPENING_FILE, TERMINAL_FILE } from "#src/run/controller-lineage.ts";
import { findRun, readLaunchRecord } from "#tools/runs/discover.ts";

const LEVELS = ["light", "medium", "verbose"] as const;
type Level = (typeof LEVELS)[number];
const LIGHT_CAP_MB = 2;
const VERBOSE_MAX_FILE_BYTES = 8 * 1024 * 1024;
const SCRATCH_ROOT = ".scratch/quick-run";

/** Never zipped at any depth: installed binaries, dependency trees, scratch, candidate snapshots
 *  (the accepted ones are under versions/) and provider credentials. */
const NEVER_DIRS = new Set([
  ".toolchain",
  "node_modules",
  ".git",
  "downloads",
  "build",
  ".cache",
  ".tmp",
  ".bundle-snapshots",
]);
const NEVER_FILES = new Set(["auth.json", ".DS_Store"]);

const QUICK_RUN_LIGHT = ["launch.json", "stop.json", "probe.json", "fullrun.log"];
const CAMPAIGN_LIGHT_FILES = ["epochs.json", "budget.json", "case-record.jsonl"];
const CAMPAIGN_LIGHT_DIRS = ["claims", "difficulty-decisions", "analysis", "promotions"];
const EPOCH_LIGHT = [
  "builder-prose.jsonl",
  "builder-execution.json",
  "builder-session.json",
  "backends.json",
  "campaign.json",
];
const EPOCH_MEDIUM = ["builder-path-record.jsonl", "verifier-workshop.jsonl"];
const PRODUCT_LIGHT = ["version.json", "conformance.json", "claim-stages.json"];
const MODEL_LIGHT = ["brief.json", "evaluator.ts"];
const BATTERY_LIGHT = ["battery.json", "run-manifest.json", "backends.json"];
const CASE_LIGHT = ["case-result.json"];
const CASE_MEDIUM = [
  "trace.json",
  "verifier.json",
  "judge.json",
  "public-task.json",
  "final-submission.json",
  "artifact.json",
];

/** What a lighter depth leaves out, and the depth that brings it in. */
const WITHHELD: ReadonlyArray<readonly [group: string, what: string, arrives: Level]> = [
  ["cases", "per-case trace.json, verifier.json, judge.json, artifacts and public tasks", "medium"],
  ["correctness-model", "tasks.json (hidden expectations), controls.json and reference/", "medium"],
  ["judge", "Judge census samples, bait corpus and standing", "medium"],
  ["cases-runtime", "built-runtime.json, built-registration.json and draft-checkpoints.json", "verbose"],
  ["verifier-lifetime", "per-process spawn, intent and settlement receipts", "verbose"],
  ["observability", "the full model-visible prompt stream of every Builder, Built and Judge", "verbose"],
  ["workspace", "Builder authoring workspaces and .oss tool installs", "verbose"],
  ["transcripts", "Claude Code or Codex session transcripts with full tool outputs", "verbose"],
];

interface Entry {
  source: string;
  bytes: number;
  group: string;
}

interface Selection {
  files: Map<string, Entry>;
  excluded: Map<string, string>;
  batteries: string[];
}

interface Bundle {
  zip: string;
  bytes: number;
  files: number;
  level: Level;
  runId: string;
  groups: Array<[string, number]>;
}

function children(dir: string): string[] {
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true ? readdirSync(dir).sort() : [];
}

/** Every file one depth takes from one run, keyed by its path inside the archive. */
function selectFiles(campaign: string, runId: string, runDir: string | null, level: Level): Selection {
  const at = (depth: Level): boolean => LEVELS.indexOf(level) >= LEVELS.indexOf(depth);
  const files = new Map<string, Entry>();
  const excluded = new Map<string, string>(
    WITHHELD.flatMap(([group, what, arrives]) =>
      at(arrives) ? [] : [[group, `${what}; --${arrives}`] as const],
    ),
  );
  // A product tree outside the campaign is the default `domains/<slug>`, archived under that name.
  const inArchive = (path: string): string => {
    const inside = relative(campaign, path);
    return inside.startsWith("..") ? relative(dirname(dirname(campaign)), path) : inside;
  };
  const add = (source: string, group: string, into = inArchive(source)): void => {
    const stat = statSync(source, { throwIfNoEntry: false });
    if (stat?.isFile() !== true || NEVER_FILES.has(basename(source))) return;
    if (level === "verbose" && stat.size > VERBOSE_MAX_FILE_BYTES && group !== "observability") {
      excluded.set(
        `oversize:${into}`,
        `${stat.size} bytes is over the ${VERBOSE_MAX_FILE_BYTES}-byte ceiling`,
      );
      return;
    }
    files.set(into, { source, bytes: stat.size, group });
  };
  const each = (dir: string, names: readonly string[], group: string): void => {
    for (const name of names) add(join(dir, name), group);
  };
  const tree = (dir: string, group: string, into = inArchive(dir)): void => {
    for (const name of children(dir)) {
      const path = join(dir, name);
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
        add(path, group, join(into, name));
      } else if (NEVER_DIRS.has(name)) {
        excluded.set(`${group}:${name}`, `${join(into, name)} is binaries, dependencies or scratch`);
      } else {
        tree(path, group, join(into, name));
      }
    }
  };

  if (runDir !== null) {
    const scratch = join(runDir, SCRATCH_ROOT);
    for (const name of QUICK_RUN_LIGHT) add(join(scratch, name), "launch", join("launch", name));
    if (at("verbose")) tree(join(scratch, "codex", "sessions"), "transcripts", "transcripts/codex-sessions");
  }
  const controller = controllerEvidenceDir(campaign, runId);
  each(controller, [OPENING_FILE, TERMINAL_FILE], "controller");
  each(campaign, CAMPAIGN_LIGHT_FILES, "campaign");
  each(
    campaign,
    children(campaign).filter((name) => name.startsWith("isolation-probe-") && name.endsWith(".json")),
    "campaign",
  );
  for (const dir of CAMPAIGN_LIGHT_DIRS) tree(join(campaign, dir), dir);
  tree(safeguardLogDir(campaign, runId), "safeguards");
  if (at("verbose")) {
    tree(join(controller, "verifier-lifetime"), "verifier-lifetime");
    add(join(campaign, "controller.sqlite"), "campaign");
    tree(join(campaign, "observability"), "observability");
  }

  for (const epoch of campaignEpochs(campaign)) {
    const dir = join(campaign, epoch);
    each(dir, EPOCH_LIGHT, "builder");
    if (at("medium")) {
      each(dir, EPOCH_MEDIUM, "builder");
      tree(join(dir, "trials"), "builder");
    }
    if (at("verbose")) {
      tree(join(dir, "workspace"), "workspace");
      tree(join(dir, ".oss"), "workspace");
      // Claude Code keys a session's transcripts by its working directory, `/` spelled `-`.
      const transcripts = join(dir, "workspace").replaceAll("/", "-");
      tree(
        join(homedir(), ".claude", "projects", transcripts),
        "transcripts",
        join("transcripts/claude", epoch),
      );
    }
  }
  if (at("medium")) for (const iteration of campaignIterations(campaign)) tree(iteration.dir, "builder");

  const batteries = batteryRunDirs(campaign, runId);
  const holders = new Set(batteries.map((battery) => dirname(dirname(battery))));
  for (const root of campaignTraceRoots(campaign)) {
    if (!holders.has(root) && !isControllerBatteryRunId(runId, basename(root))) continue;
    each(root, PRODUCT_LIGHT, "versions");
    tree(join(root, "agent"), "versions");
    if (at("medium")) tree(join(root, "correctness-model"), "versions");
    else each(join(root, "correctness-model"), MODEL_LIGHT, "versions");
  }
  for (const battery of batteries) {
    each(battery, BATTERY_LIGHT, "battery");
    if (at("medium")) tree(join(battery, "judge"), "judge");
    for (const caseId of children(join(battery, "cases"))) {
      const dir = join(battery, "cases", caseId);
      if (at("verbose")) tree(dir, "cases");
      else each(dir, at("medium") ? [...CASE_LIGHT, ...CASE_MEDIUM] : CASE_LIGHT, "cases");
    }
  }
  return { files, excluded, batteries: batteries.map((battery) => inArchive(battery)) };
}

function groupTotals(files: ReadonlyMap<string, Entry>): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const { bytes, group } of files.values()) totals.set(group, (totals.get(group) ?? 0) + bytes);
  return [...totals.entries()].sort((left, right) => right[1] - left[1]);
}

function mb(bytes: number): string {
  return (bytes / 1e6).toFixed(2);
}

function readme(runId: string, campaign: string, commit: string, level: Level, selection: Selection): string {
  const { files, excluded } = selection;
  const total = [...files.values()].reduce((sum, file) => sum + file.bytes, 0);
  return [
    `# Run bundle: ${runId} (${level})`,
    "",
    `Campaign: \`${basename(campaign)}\`. Source commit: \`${commit}\`.`,
    `Files: ${files.size}. Uncompressed: ${mb(total)} MB. Paths mirror the campaign tree.`,
    "",
    "## Levels",
    "",
    "- light: launch/stop/log, opening and terminal, ledgers, claims, decisions, advice packets, this run's safeguard log, Builder reasoning per epoch, agent and evaluator per product this run built or measured, one verdict file per case of this run's batteries. Aimed at 2 MB.",
    "- medium: light plus per-case trace, verifier, Judge and artifact files, the whole correctness model, Judge census files, Builder path records, trials and iteration receipts.",
    "- verbose: medium plus the observability prompt stream, verifier lifetime receipts, every case file, the Builder workspaces (binaries excluded) and any session transcripts on disk.",
    "",
    "## Groups in this bundle",
    "",
    ...groupTotals(files).map(([group, bytes]) => `- ${group}: ${mb(bytes)} MB`),
    "",
    "## Left out at this level",
    "",
    ...(excluded.size > 0
      ? [...excluded.entries()].map(([key, why]) => `- ${key}: ${why}`)
      : ["- nothing beyond binaries, dependencies and credentials"]),
    "",
    "Binaries under `.toolchain`, `.oss/downloads`, `.oss/build`, `node_modules` and provider `auth.json` are never included.",
    "MANIFEST.json lists every file with its byte size.",
    "",
    readFileSync(join(import.meta.dirname, "..", "readme", `${level}.md`), "utf8").trimEnd(),
    "",
  ].join("\n");
}

/** The run a launched worktree or a campaign folder names, zipped at one depth. */
function buildBundle(target: string, level: Level, run: string | null, out: string | null): Bundle {
  const dir = resolve(target);
  const launched = readLaunchRecord(dir)?.runId ?? null;
  if (launched !== null && run !== null && run !== launched) {
    throw new Error(`${dir} launched ${launched}, not --run ${run}`);
  }
  // A run worktree's campaigns/ also carries campaigns copied from other runs; the launched id picks.
  const campaigns = launched === null ? [dir] : findRun(dir, launched).map((found) => found.campaignDir);
  const [only] = campaigns;
  if (only === undefined || campaigns.length > 1) {
    throw new Error(`${dir}: ${campaigns.length} campaigns hold controller/${launched}/${OPENING_FILE}`);
  }
  const recorded = openRecordedRun(only, launched ?? run);
  const { campaign, runId } = recorded;
  const home = dirname(dirname(campaign));
  const runDir = readLaunchRecord(home)?.runId === runId ? home : null;
  const selection = selectFiles(campaign, runId, runDir, level);
  const name = `${runId}-${level}`;
  const stage = mkdtempSync(join(tmpdir(), "zip-run-"));
  const zip = resolve(out ?? `${name}.zip`);
  try {
    const root = join(stage, name);
    mkdirSync(root);
    for (const [path, { source }] of selection.files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(source, join(root, path));
    }
    const manifest = {
      schema: "zip-run/v2",
      level,
      runId,
      chosen: recorded.chosen,
      campaignDir: campaign,
      runDir,
      sourceCommit: recorded.source.commit,
      controller: recorded.controller?.state ?? null,
      controllerError: recorded.controllerError,
      batteries: selection.batteries,
      writtenAt: new Date().toISOString(),
      files: [...selection.files].map(([path, { bytes, group }]) => ({ path, bytes, group })),
      excluded: Object.fromEntries(selection.excluded),
    };
    writeFileSync(join(root, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(root, "README.md"), readme(runId, campaign, recorded.source.commit, level, selection));
    rmSync(zip, { force: true });
    runTextSyncOrThrow(["zip", "-qr", "-X", zip, name], { cwd: stage });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  const groups = groupTotals(selection.files);
  return { zip, bytes: statSync(zip).size, files: selection.files.size, level, runId, groups };
}

function render(bundle: Bundle): string {
  return [
    bundle.zip,
    `${mb(bundle.bytes)} MB zipped, ${bundle.files} files, level ${bundle.level}, run ${bundle.runId}`,
    ...bundle.groups.map(([group, bytes]) => `  ${group}: ${mb(bytes)} MB uncompressed`),
  ].join("\n");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "zip-run",
      usage:
        "usage: bun zip-run.ts <run-dir | campaign-dir> --light|--medium|--verbose [--run <runId>] [--out <zip>] [--max-mb N] [--json]",
      options: {
        light: "flag",
        medium: "flag",
        verbose: "flag",
        run: "text",
        out: "text",
        "max-mb": "text",
        json: "flag",
      },
      positionals: 1,
    },
    (args) => {
      const die: ExitWith = args.die;
      const [level, ...more] = LEVELS.filter((depth) => args.flag(depth));
      if (level === undefined || more.length > 0) die("choose one of --light, --medium or --verbose");
      const maxMb = args.value("max-mb");
      const defaultCap = level === "light" ? LIGHT_CAP_MB : null;
      const cap = maxMb === null ? defaultCap : Number(maxMb);
      if (cap !== null && !(cap > 0)) die("--max-mb needs a positive number");
      const bundle = buildBundle(args.positionals[0] ?? "", level, args.value("run"), args.value("out"));
      emitReport(bundle, { json: args.flag("json"), out: null, render });
      if (cap !== null && bundle.bytes > cap * 1e6) {
        throw new CommandFailure(
          `over the ${cap} MB cap: drop the largest group above or pick a lighter level`,
        );
      }
    },
  );
}

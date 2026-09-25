#!/usr/bin/env bun
// One entry point for a whole-run investigation. Each subcommand runs the deterministic readers
// and records what it did in `<review>/wri-review.json`.
//
//   bun wri.mjs lanes
//   bun wri.mjs scope  <target> [--json]
//   bun wri.mjs read   <campaign | controller/<runId> | runId> --out <abs review dir>
//                      [--all | --lanes 1,3,5 | --lanes climb,yield] [--run <runId>] [--repo <abs>]
//   bun wri.mjs brief  --out <abs review dir>
//   bun wri.mjs review  <target> --out <abs review dir> [launch options]
//   bun wri.mjs collect <target> --out <abs review dir>
//   bun wri.mjs launch  --out <abs review dir> [--lanes <count> | --sessions <spec>] [--effort max] [--title <t>] [--notes <f>] [--context <f>]
//   bun wri.mjs finish  --out <abs review dir>
//   bun wri.mjs delta | climb | yield | timeline | walls | handoff  <target> [--run <runId>] [--json] [--out <abs file>]
//              delta [--repo <abs>] [--previous <commit | abs campaign dir>]; timeline [--classify];
//              walls [--battery <runId>]
//
// `lanes` prints the deterministic catalogue and `scope` sizes one run. `read` runs the lanes named
// by rank or by name, and with none named it sizes the run first and reads what that size earns
// (brief.mjs owns both the sizing and the digest). Every lane's output is captured to
// `<review>/<lane>.txt` and the command prints one bounded brief instead, because the whole read is
// the size of a paid lane's context. The six lanes that read in-process are also subcommands of
// their own, which print one lane's view, its JSON under `--json`, and record the JSON at `--out`.
// `review` reads every lane, prints the brief and then launches the semantic lanes the run's tier
// names; the ordinary path is `read`, then `launch --sessions` with the lanes the brief argues for,
// each a number from the 26-lane catalogue. `brief` re-renders that digest from a finished review
// directory. Use `collect` and `launch` separately only to edit `shared-instructions.json` between
// them. `finish` validates the lane reports, scaffolds the archive from recorded bytes and
// `verdicts.json`, then runs the archive validator; the investigation itself ends in one adjudicated
// note the primary writes by hand.
//
// A target is one folder — a campaign, its `controller` directory or one `controller/<runId>`
// folder — or a bare run id, looked up in the main checkout's campaign tree, which every run
// worktree links to. The measured checkout comes from the run's own opening unless `--repo` names one, and
// only when a selected lane reads it.

import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { scaffoldArchive } from "./archive-scaffold.mjs";
import { renderBrief, renderScope, runScope, SEMANTIC_LANES } from "./brief.mjs";
import { ANGLE_COUNT } from "./catalogue-shape.mjs";
import { buildOverview } from "./run-overview.mjs";
import { openRecordedRun, resolveSourceCheckout } from "#skills/main/run.ts";
import { buildSharedInstructions } from "./shared-instructions.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";
import { emitReport } from "#skills/main/output.ts";
import { findRun, mainCheckout, resolveRunSelector } from "#tools/runs/discover.ts";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const CHECKOUT = resolve(SCRIPT_DIR, "../../../..");
const BUN = Bun.argv[0];
/** Where the primary writes the adjudicated note that ends an investigation; the tree ignores it. */
const NOTE_PATH = "notes/investigation-YYYYMMDD-<topic>.md";

/**
 * The deterministic readers, in the order a review reads them. `collect` runs the four the paid
 * lanes consume; the rest answer one question each and cost nothing but local compute. A lane
 * whose input this target does not carry is skipped with the reason, never silently. `repo` marks
 * the lanes that open the measured checkout, which is the one expensive thing a read can do.
 * A lane with `read` runs in-process and returns its report and rendered view; it imports its
 * module only when it runs, because the classifier behind two of them loads an embedding runtime.
 * `options` and `flags` are what its own subcommand takes beyond the target.
 */
export const LANES = [
  {
    name: "snapshot",
    label: "cases and traces",
    collect: true,
    fatal: true,
    repo: true,
    cmd: (c) => [
      BUN,
      "--no-env-file",
      script("trace-review.mjs"),
      ...c.runArgs,
      "--repo",
      c.repo,
      "--out",
      c.snapshot,
      "--all",
    ],
  },
  {
    name: "challenge",
    label: "trace challenge",
    collect: true,
    cmd: (c) => [
      BUN,
      "--no-env-file",
      script("trace-challenge.ts"),
      ...c.runArgs,
      "--out",
      join(c.snapshot, "trace-challenge"),
    ],
  },
  {
    name: "delta",
    label: "source delta",
    collect: true,
    repo: true,
    options: ["repo", "previous"],
    read: async (c) => {
      const { buildSourceDelta, renderSourceDelta } = await import("./source-delta.mjs");
      return shown(buildSourceDelta(c), renderSourceDelta);
    },
  },
  {
    name: "overview",
    label: "shared brief",
    collect: true,
    needs: (c) =>
      existsSync(c.snapshot) ? null : `no snapshot under ${c.snapshot}; run the snapshot lane first`,
    write: (c) => writeOverview(c),
  },
  {
    name: "climb",
    label: "climb velocity",
    needs: (c) => (existsSync(join(c.campaign, "versions")) ? null : "no adopted version, so no battery yet"),
    // The JSON drops each battery's family vectors, which only the verdict reads.
    read: async (c) => {
      const { readCampaign, render, velocityOf } = await import("./climb-velocity.mjs");
      const report = await readCampaign(c.campaign);
      const batteries = report.batteries.map((battery) => ({
        ...battery,
        reading: { ...battery.reading, familyVectors: undefined },
      }));
      return { report: { ...report, batteries, velocity: velocityOf(report) }, text: render(report) };
    },
  },
  {
    name: "yield",
    label: "review yield",
    read: async (c) => {
      const { buildReviewYield, renderReviewYield } = await import("./review-yield.mjs");
      return shown(buildReviewYield(c.campaign), renderReviewYield);
    },
  },
  {
    name: "posture",
    label: "builder posture",
    cmd: (c) => [
      BUN,
      "--no-env-file",
      join(SCRIPT_DIR, "..", "classifier", "prose-classify.mjs"),
      c.campaign,
      "--run",
      c.runId,
    ],
  },
  {
    name: "timeline",
    label: "run timeline",
    flags: ["classify"],
    read: async (c) => {
      const { buildTimeline, classifyTimeline, renderTimeline } = await import("./timeline.mjs");
      const recorded = buildTimeline(c);
      return shown(c.classify ? await classifyTimeline(recorded, c) : recorded, renderTimeline);
    },
  },
  {
    name: "walls",
    label: "solve budget",
    options: ["battery"],
    read: async (c) => {
      const { buildWalls, renderWalls } = await import("./walls.mjs");
      return shown(buildWalls({ campaign: c.campaign, runId: c.battery }), renderWalls);
    },
  },
  {
    name: "handoff",
    label: "round hand-offs",
    read: async (c) => {
      const { buildHandoffs, renderHandoffs } = await import("./handoffs.mjs");
      return shown(buildHandoffs({ campaign: c.campaign, runId: c.runId }), renderHandoffs);
    },
  },
  {
    name: "archive",
    label: "archive validity",
    needs: (c) =>
      c.archive === null ? "no archive for this run under notes/runs; `finish` writes one" : null,
    cmd: (c) => [BUN, "--no-env-file", script("validate-archive.mjs"), "--archive", c.archive],
  },
];

const TARGET = ["out", "campaign", "run", "repo"];
const LAUNCH = ["out", "lanes", "sessions", "effort", "title", "notes", "context"];
/** Each subcommand's own options, so one a subcommand does not take is refused there. */
const COMMANDS = {
  lanes: {},
  read: { values: [...TARGET, "lanes"], flags: ["all"], positionals: [0, 1] },
  brief: { values: ["out"] },
  review: { values: [...new Set([...TARGET, ...LAUNCH])], flags: ["live"], positionals: [0, 1] },
  collect: { values: TARGET, positionals: [0, 1] },
  launch: { values: LAUNCH, flags: ["live"] },
  finish: { values: ["out"] },
  scope: { values: ["campaign", "run"], flags: ["json"], positionals: [0, 1] },
  ...Object.fromEntries(
    LANES.flatMap((lane) =>
      lane.read === undefined
        ? []
        : [
            [
              lane.name,
              {
                values: ["out", "campaign", "run", ...(lane.options ?? [])],
                flags: ["json", ...(lane.flags ?? [])],
                positionals: [0, 1],
              },
            ],
          ],
    ),
  ),
};

/** A report and the view a reader sees of it. */
function shown(report, render) {
  return { report, text: render(report) };
}

function absolute(args, name) {
  const value = args.value(name);
  if (!value) throw new Error(`--${name} is required`);
  if (!isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
  return resolve(value);
}

function script(name) {
  return join(SCRIPT_DIR, name);
}

/** The campaign holding `controller/<runId>/opening.json`, so a bare run id names its own folder.
 *  The main checkout owns the one campaign tree every run worktree links to. A run id is unique
 *  inside one campaign only, so two campaigns holding it is a question for the operator, not a
 *  directory-order guess. */
function findCampaign(runId) {
  const root = mainCheckout(CHECKOUT);
  const runs = findRun(root, runId);
  if (runs.length === 0) throw new Error(`no campaign under ${root} recorded an opening for ${runId}`);
  if (runs.length > 1) {
    throw new Error(`${runId} names a run in ${runs.length} campaigns; pass the campaign folder instead`);
  }
  return runs[0].campaignDir;
}

/** Campaign and run from one folder, one run id, or the explicit options. */
function resolveTarget(args, positional) {
  const folder = positional ?? args.value("campaign");
  if (folder === null) throw new Error("name a campaign folder, a controller/<runId> folder or a run id");
  const known = existsSync(folder) || existsSync(resolve(folder));
  return known
    ? resolveRunSelector(folder, args.value("run"))
    : { ...resolveRunSelector(findCampaign(folder), folder), chosen: "run id" };
}

/** The archive `finish` already wrote for this run, or null while none carries its `review.json`. */
function archiveFor(runId) {
  const root = join(CHECKOUT, "notes", "runs");
  if (!existsSync(root)) return null;
  for (const hit of new Bun.Glob(`*${runId}*/review.json`).scanSync({ cwd: root })) {
    return join(root, dirname(hit));
  }
  return null;
}

function context(state) {
  return {
    campaign: state.campaign,
    runId: state.runId,
    repo: state.repo,
    reviewDir: state.reviewDir,
    runArgs: ["--campaign", state.campaign, "--run", state.runId],
    snapshot: join(state.reviewDir, "snapshot"),
    archive: archiveFor(state.runId),
    previous: null,
    classify: true,
    battery: null,
  };
}

/** Run one step, capturing its output to a file or streaming it, recording it in the review state.
 *  A lane always captures: the brief is what a reader opens, and the file is what a paid lane and
 *  a later question read. Only `launch`, whose output is the launcher's own progress, streams.
 *  @param {{ fatal?: boolean, cwd?: string, capture?: string | null }} [how] */
function step(state, label, cmd, { fatal = true, cwd = CHECKOUT, capture = null } = {}) {
  if (capture === null) console.log(`   ${label}`);
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdin: "ignore",
    stdout: capture === null ? "inherit" : "pipe",
    stderr: "inherit",
  });
  if (capture !== null) writeFileSync(capture, result.stdout.toString());
  const ok = result.exitCode === 0;
  record(state, { label, ok, exitCode: result.exitCode });
  if (!ok && fatal) throw new Error(`${label} failed with exit ${result.exitCode}`);
  if (!ok) console.log(`   (${label} failed; recorded, continuing)`);
  return ok;
}

/** An in-process lane's view, captured like a spawned one's stdout. A lane that throws records the
 *  error as its capture and fails alone, as a spawned lane's non-zero exit does. */
async function readLane(lane, ctx) {
  try {
    return { ok: true, text: (await lane.read(ctx)).text };
  } catch (error) {
    console.log(`   (${lane.name} failed; recorded, continuing)`);
    return { ok: false, text: `${lane.name} failed: ${errorMessage(error)}` };
  }
}

function record(state, row) {
  state.steps.push({ ...row, at: new Date().toISOString() });
  saveState(state);
}

async function runLane(state, lane, ctx) {
  const missing = lane.needs === undefined ? null : lane.needs(ctx);
  if (missing !== null) {
    console.log(`   ${lane.name}: skipped, ${missing}`);
    return record(state, { label: lane.name, ok: null, skipped: missing });
  }
  console.log(`   ${lane.name}`);
  if (lane.write !== undefined) {
    return record(state, { label: lane.name, ok: true, exitCode: 0, wrote: lane.write(ctx) });
  }
  if (lane.read !== undefined) {
    const { ok, text } = await readLane(lane, ctx);
    writeFileSync(join(ctx.reviewDir, `${lane.name}.txt`), text.endsWith("\n") ? text : `${text}\n`);
    return record(state, { label: lane.name, ok, exitCode: ok ? 0 : 1 });
  }
  step(state, lane.name, lane.cmd(ctx), {
    fatal: lane.fatal === true,
    capture: join(ctx.reviewDir, `${lane.name}.txt`),
  });
}

function writeOverview(ctx) {
  const overview = buildOverview(ctx.snapshot);
  writeJsonFile(join(ctx.reviewDir, "overview.json"), overview);
  writeJsonFile(join(ctx.reviewDir, "shared-instructions.json"), buildSharedInstructions(overview));
  return `overview.json and shared-instructions.json, from ${ctx.snapshot}`;
}

export function renderLanes() {
  const rows = LANES.map(
    (lane, index) =>
      `  ${String(index + 1).padStart(2)}  ${lane.name.padEnd(12)}${lane.label}${lane.collect === true ? "  (also run by collect)" : ""}`,
  );
  return ["deterministic lanes — `--lanes` takes ranks or names, `--all` runs every one", ...rows].join("\n");
}

/** The selected lanes, or null when the caller named none and wants the catalogue. */
export function selectLanes(args) {
  if (args.flag("all")) return LANES;
  const spec = args.value("lanes");
  if (spec === null) return null;
  return spec
    .split(",")
    .map((token) => token.trim())
    .map((token) => {
      const rank = Number(token);
      const lane =
        token !== "" && Number.isInteger(rank) ? LANES[rank - 1] : LANES.find((row) => row.name === token);
      if (lane === undefined) throw new Error(`no lane ${token}; run \`wri.mjs lanes\` for the catalogue`);
      return lane;
    });
}

function statePath(reviewDir) {
  return join(reviewDir, "wri-review.json");
}

function saveState(state) {
  writeJsonFile(statePath(state.reviewDir), state);
}

function loadState(reviewDir) {
  const path = statePath(reviewDir);
  if (!existsSync(path)) throw new Error(`no wri-review.json under ${reviewDir}; run collect first`);
  return readJsonFile(path);
}

/** The lanes this run's own size earns, when the reader named none. `brief.mjs` owns the sizing;
 *  a tier that names no lane list means every lane. */
export function lanesForScope(scope) {
  return scope.lanes === null ? LANES : LANES.filter((lane) => scope.lanes.includes(lane.name));
}

/**
 * Size the run, choose the lanes, read them, then print one brief. `select` receives the scope, so
 * `read` can defer to the tier while `collect` and `review` keep their fixed sets.
 */
/** The measured checkout, prepared only when a selected lane reads the measured source, so a read
 *  of recorded campaign bytes alone never provokes a worktree and an install. */
function measuredRepo(args, target, lanes) {
  if (!lanes.some((lane) => lane.repo === true)) return null;
  const named = args.value("repo");
  if (named !== null) return resolve(named);
  const { commit } = openRecordedRun(target.campaign, target.runId).source;
  return resolve(resolveSourceCheckout(commit, { cwd: runtimeProcess.cwd() }).repo);
}

async function runRead(args, positional, select) {
  const reviewDir = absolute(args, "out");
  const target = resolveTarget(args, positional);
  const scope = runScope(target.campaign, target.runId);
  const lanes = select(scope);
  const repo = measuredRepo(args, target, lanes);
  const state = {
    schema: "wri-review/v1",
    reviewDir,
    campaign: target.campaign,
    runId: target.runId,
    repo,
    reviewCheckout: CHECKOUT,
    tier: scope.tier,
    semanticLanes: scope.semanticLanes,
    steps: [],
  };
  mkdirSync(reviewDir, { recursive: true });
  saveState(state);
  console.log(
    `run ${state.runId} (${target.chosen}), ${scope.tier} tier\n  measured checkout ${repo ?? "not needed by the selected lanes"}\n  reading ${lanes.length} lane(s):`,
  );
  const ctx = context(state);
  for (const lane of lanes) await runLane(state, lane, ctx);
  console.log(`\n${renderBrief(reviewDir)}\n\nrecorded: ${statePath(reviewDir)}`);
  return state;
}

/** One in-process lane as its own command: the view, or the JSON under `--json`, and the JSON
 *  recorded at `--out`. */
async function laneCommand(lane, args, positional) {
  const target = resolveTarget(args, positional);
  const out = args.value("out") === null ? null : absolute(args, "out");
  const { report, text } = await lane.read({
    campaign: target.campaign,
    runId: target.runId,
    repo: measuredRepo(args, target, [lane]),
    previous: args.value("previous"),
    classify: args.flag("classify"),
    battery: args.value("battery"),
  });
  emitReport(report, { json: args.flag("json"), out, render: () => text });
}

async function collect(args, positional) {
  const state = await runRead(args, positional, () => LANES.filter((lane) => lane.collect === true));
  console.log(
    `\nshared instructions: ${join(state.reviewDir, "shared-instructions.json")}\n  edit its values, template lines, \`orientation\` and \`movedVariable\` before \`launch\` when the lanes need direction.`,
  );
  return state;
}

function launch(args, state = loadState(absolute(args, "out"))) {
  const lanesDir = join(state.reviewDir, "lanes");
  if (existsSync(join(lanesDir, "luna-output", "launch.json"))) {
    throw new Error(`${lanesDir} already holds a launch; use a fresh --out or trash the lanes directory`);
  }
  // `--sessions` names lanes from the catalogue; `--lanes` asks the manifest to pick that many, and
  // with neither the count is the one the run's tier named when it was read.
  const sessions = args.value("sessions");
  const count = args.value("lanes") ?? String(state.semanticLanes);
  if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > ANGLE_COUNT) {
    throw new Error(
      `--lanes must be a count from 1 to ${ANGLE_COUNT}; the tiers ask ${SEMANTIC_LANES.probe} (probe), ${SEMANTIC_LANES.standard} (standard) or ${SEMANTIC_LANES.deep} (deep)`,
    );
  }
  const select = sessions ? ["--sessions", sessions] : ["--auto", count];
  const cmd = [
    BUN,
    "--no-env-file",
    script("build-manifest.mjs"),
    "--snapshot",
    join(state.reviewDir, "snapshot"),
    "--worktree",
    state.repo,
    ...select,
    "--out",
    lanesDir,
    "--transport",
    "luna",
    "--effort",
    args.value("effort", "max"),
    "--shared-instructions",
    join(state.reviewDir, "shared-instructions.json"),
    "--launch",
    "--detach",
  ];
  for (const name of ["title", "notes", "context"]) {
    if (args.value(name)) cmd.push(`--${name}`, args.value(name));
  }
  if (args.flag("live")) cmd.push("--live");
  step(state, "launch", cmd);
  console.log(
    `\nlanes: ${lanesDir}\n  progress: ${join(lanesDir, "luna-output")}/<name>.md as each lane finishes; summary.json marks completion.\n  then: bun ${script("wri.mjs")} finish --out ${state.reviewDir}`,
  );
}

function finish(args) {
  const state = loadState(absolute(args, "out"));
  const lanesDir = join(state.reviewDir, "lanes");
  const summary = join(lanesDir, "luna-output", "summary.json");
  if (!existsSync(summary)) {
    throw new Error(
      `${summary} is absent: the lanes have not finished (see ${join(lanesDir, "launcher.log")})`,
    );
  }
  step(
    state,
    "validate-reports",
    [
      BUN,
      "--no-env-file",
      script("validate-reports.mjs"),
      "--tasks",
      join(lanesDir, "tasks.json"),
      "--summary",
      summary,
      "--out",
      join(state.reviewDir, "wri-report-validation.json"),
    ],
    { fatal: false },
  );
  const scaffold = scaffoldArchive(state.reviewDir);
  console.log(`\n== archive scaffold\n${JSON.stringify(scaffold, null, 2)}`);
  if (scaffold.fresh) {
    console.log(
      `\nverdicts template written: ${scaffold.verdictsPath}\n  record states and reasons there, write ${join(scaffold.archiveDir, "main_synthesis.md")}, then run finish again.`,
    );
    return;
  }
  const ok = step(
    state,
    "validate-archive",
    [BUN, "--no-env-file", script("validate-archive.mjs"), "--archive", scaffold.archiveDir],
    { fatal: false },
  );
  console.log(
    ok
      ? `\narchive valid: ${scaffold.archiveDir}\n  then: write the adjudicated note at ${join(CHECKOUT, NOTE_PATH)}`
      : "\narchive not yet valid; fix the issues above (verdicts.json states, main_synthesis.md headings) and run finish again.",
  );
  if (!ok) runtimeProcess.exit(1);
}

async function main() {
  const parsed = parseCommandOrDie(exitWith("wri"), COMMANDS);
  const { command } = parsed;
  const positional = parsed.positionals[0] ?? null;
  // The parsed options, in the `{flag, value}` shape the subcommands read.
  const args = {
    flag: (name) => parsed.flags.has(name),
    /** @param {string | null} [fallback] */
    value: (name, fallback = null) => parsed.single.get(name) ?? fallback,
  };
  const lane = LANES.find((row) => row.name === command && row.read !== undefined);
  if (lane !== undefined) return laneCommand(lane, args, positional);
  switch (command) {
    case "lanes":
      return console.log(renderLanes());
    case "scope": {
      const target = resolveTarget(args, positional);
      const scope = runScope(target.campaign, target.runId);
      return console.log(args.flag("json") ? JSON.stringify(scope, null, 2) : renderScope(scope));
    }
    case "read": {
      const named = selectLanes(args);
      return void (await runRead(args, positional, (scope) => named ?? lanesForScope(scope)));
    }
    case "brief":
      return console.log(renderBrief(absolute(args, "out")));
    case "review":
      return launch(args, await runRead(args, positional, () => LANES));
    case "collect":
      return void (await collect(args, positional));
    case "launch":
      return launch(args);
    case "finish":
      return finish(args);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`wri: ${errorMessage(error)}`);
    runtimeProcess.exit(1);
  }
}

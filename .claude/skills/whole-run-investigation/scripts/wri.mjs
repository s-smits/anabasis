#!/usr/bin/env bun
// One entry point for a whole-run investigation. Each subcommand runs the existing scripts behind
// the scenes and records what it did in `<review>/wri-review.json`.
//
//   bun wri.mjs lanes
//   bun wri.mjs read   <campaign | controller/<runId> | runId> --out <abs review dir>
//                      [--all | --lanes 1,3,5 | --lanes climb,yield] [--run <runId>] [--repo <abs>]
//   bun wri.mjs brief  --out <abs review dir>
//   bun wri.mjs review  <target> --out <abs review dir> [launch options]
//   bun wri.mjs collect <target> --out <abs review dir>
//   bun wri.mjs launch  --out <abs review dir> [--lanes 36 | --sessions <spec>] [--effort max] [--title <t>] [--notes <f>] [--context <f>]
//   bun wri.mjs finish  --out <abs review dir>
//
// `lanes` prints the deterministic catalogue; `read` runs the lanes named by rank or by name, and
// with none named it sizes the run first and reads what that size earns (brief.mjs owns both the
// sizing and the digest). Every lane's output is captured to `<review>/<lane>.txt` and the command
// prints one bounded brief instead, because the whole read is the size of a paid lane's context.
// `review` reads every lane, prints the brief and then launches the full sweep, which is the "all"
// path; the ordinary path is `read`, then `launch --sessions` with the lanes the brief argues for.
// `brief` re-renders that digest from a finished review directory. Use `collect` and `launch`
// separately only to edit `shared-instructions.json` between them. `finish` validates the lane
// reports, scaffolds the archive from recorded bytes and `verdicts.json`, then runs the archive
// validator.
//
// A target is one folder — a campaign, its `controller` directory or one `controller/<runId>`
// folder — or a bare run id, looked up in the `campaigns` tree of every worktree beside this
// checkout. The measured checkout comes from the run's own opening unless `--repo` names one, and
// only when a selected lane reads it.

import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { scaffoldArchive } from "./archive-scaffold.mjs";
import { renderBrief, runScope } from "./brief.mjs";
import { buildOverview } from "./run-overview.mjs";
import { resolveRunTarget, resolveSourceCheckout } from "./run-target.mjs";
import { buildSharedInstructions } from "./shared-instructions.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const CHECKOUT = resolve(SCRIPT_DIR, "../../../..");
const BUN = Bun.argv[0];
const NATIVE_LANE_CAP = 15;

/**
 * The deterministic readers, in the order a review reads them. `collect` runs the four the paid
 * lanes consume; the rest answer one question each and cost nothing but local compute. A lane
 * whose input this target does not carry is skipped with the reason, never silently. `repo` marks
 * the lanes that open the measured checkout, which is the one expensive thing a read can do.
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
      "--diagnostics",
    ],
  },
  {
    name: "challenge",
    label: "trace challenge",
    collect: true,
    cmd: (c) => [
      BUN,
      "--no-env-file",
      script("trace-challenge.mjs"),
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
    cmd: (c) => [
      BUN,
      "--no-env-file",
      script("source-delta.mjs"),
      ...c.runArgs,
      "--repo",
      c.repo,
      "--out",
      join(c.reviewDir, "source-delta.md"),
    ],
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
    cmd: (c) => [BUN, "--no-env-file", script("climb-velocity.mjs"), c.campaign],
  },
  {
    name: "yield",
    label: "review yield",
    cmd: (c) => [BUN, "--no-env-file", script("review-yield/index.mjs"), "--campaign", c.campaign],
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
    cmd: (c) => [BUN, "--no-env-file", script("timeline.mjs"), c.campaign, "--run", c.runId, "--classify"],
  },
  {
    name: "walls",
    label: "solve budget",
    cmd: (c) => [BUN, "--no-env-file", script("walls.mjs"), c.campaign],
  },
  {
    name: "recurrence",
    label: "finding recurrence",
    needs: (c) =>
      c.archive === null ? "no archive for this run under notes/runs; `finish` writes one" : null,
    cmd: (c) => [
      BUN,
      "--no-env-file",
      script("finding-recurrence.mjs"),
      "--current",
      c.archive,
      "--archives",
      dirname(c.archive),
    ],
  },
  {
    name: "archive",
    label: "archive validity",
    needs: (c) =>
      c.archive === null ? "no archive for this run under notes/runs; `finish` writes one" : null,
    cmd: (c) => [BUN, "--no-env-file", script("validate-archive.mjs"), "--archive", c.archive],
  },
];

function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new Error(`unexpected argument: ${name}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags.add(name.slice(2));
    else {
      values.set(name.slice(2), next);
      index += 1;
    }
  }
  return {
    flag: (name) => flags.has(name),
    /** @param {string | null} [fallback] */
    value: (name, fallback = null) => values.get(name) ?? fallback,
  };
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

/**
 * The campaign holding `controller/<runId>/opening.json`, so a bare run id names its own folder.
 * Every worktree beside this checkout is searched, and a run worktree's `campaigns` is a symlink to
 * the one shared tree, so the first hit and the last read the same bytes.
 */
function findCampaign(runId) {
  const scope = dirname(CHECKOUT);
  const glob = new Bun.Glob(`*/campaigns/*/controller/${runId}/opening.json`);
  for (const hit of glob.scanSync({ cwd: scope, followSymlinks: true })) {
    return resolve(scope, hit, "..", "..", "..");
  }
  throw new Error(`no worktree under ${scope} holds campaigns/*/controller/${runId}/opening.json`);
}

function openingCommit(campaign, runId) {
  const path = join(campaign, "controller", runId, "opening.json");
  if (!existsSync(path)) throw new Error(`no opening.json at ${path}`);
  const commit = readJsonFile(path)?.source?.commit;
  if (!isString(commit)) throw new Error(`no source commit in ${path}`);
  return commit;
}

/** Campaign and run from one folder, one run id, or the explicit options. */
function resolveTarget(args, positional) {
  const folder = positional ?? args.value("campaign");
  if (folder === null) throw new Error("name a campaign folder, a controller/<runId> folder or a run id");
  const known = existsSync(folder) || existsSync(resolve(folder));
  return known
    ? resolveRunTarget(folder, args.value("run"))
    : { ...resolveRunTarget(findCampaign(folder), folder), chosen: "run id" };
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
  };
}

/** Run one step, capturing its output to a file or streaming it, recording it in the review state.
 *  A lane always captures: the brief is what a reader opens, and the file is what a paid lane and
 *  a later question read. Only `launch`, whose output is the launcher's own progress, streams.
 *  @param {{ fatal?: boolean, cwd?: string, capture?: string | null }} [how] */
function step(state, label, cmd, { fatal = true, cwd = CHECKOUT, capture = null } = {}) {
  console.log(`   ${label}`);
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdin: "ignore",
    stdout: capture === null ? "inherit" : "pipe",
    stderr: "inherit",
  });
  if (capture !== null) writeFileSync(capture, result.stdout.toString());
  const ok = result.exitCode === 0;
  state.steps.push({ label, ok, exitCode: result.exitCode, at: new Date().toISOString() });
  saveState(state);
  if (!ok && fatal) throw new Error(`${label} failed with exit ${result.exitCode}`);
  if (!ok) console.log(`   (${label} failed; recorded, continuing)`);
  return ok;
}

function runLane(state, lane, ctx) {
  const missing = lane.needs === undefined ? null : lane.needs(ctx);
  if (missing !== null) {
    console.log(`   ${lane.name}: skipped, ${missing}`);
    state.steps.push({ label: lane.name, ok: null, skipped: missing, at: new Date().toISOString() });
    saveState(state);
    return;
  }
  if (lane.write !== undefined) {
    console.log(`   ${lane.name}`);
    state.steps.push({
      label: lane.name,
      ok: true,
      exitCode: 0,
      wrote: lane.write(ctx),
      at: new Date().toISOString(),
    });
    saveState(state);
    return;
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
function runRead(args, positional, select) {
  const reviewDir = absolute(args, "out");
  const target = resolveTarget(args, positional);
  const scope = runScope(target.campaign, target.runId);
  const lanes = select(scope);
  // The measured checkout, prepared only when a selected lane reads the measured source, so a read
  // of recorded campaign bytes alone never provokes a worktree and an install.
  const repo = lanes.some((lane) => lane.repo === true)
    ? resolve(
        args.value("repo") ??
          resolveSourceCheckout(openingCommit(target.campaign, target.runId), { cwd: runtimeProcess.cwd() })
            .repo,
      )
    : null;
  const state = {
    schema: "wri-review/v1",
    reviewDir,
    campaign: target.campaign,
    runId: target.runId,
    repo,
    reviewCheckout: CHECKOUT,
    tier: scope.tier,
    steps: [],
  };
  mkdirSync(reviewDir, { recursive: true });
  saveState(state);
  console.log(
    `run ${state.runId} (${target.chosen}), ${scope.tier} tier\n  measured checkout ${repo ?? "not needed by the selected lanes"}\n  reading ${lanes.length} lane(s):`,
  );
  const ctx = context(state);
  for (const lane of lanes) runLane(state, lane, ctx);
  console.log(`\n${renderBrief(reviewDir)}\n\nrecorded: ${statePath(reviewDir)}`);
  return state;
}

function collect(args, positional) {
  const state = runRead(args, positional, () => LANES.filter((lane) => lane.collect === true));
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
  const sessions = args.value("sessions");
  const lanes = sessions ? sessions.split(",").length : Number(args.value("lanes", "36"));
  const select = sessions ? ["--sessions", sessions] : ["--auto", String(lanes)];
  const cmd = [
    BUN,
    "--no-env-file",
    script("build-manifest.mjs"),
    "--snapshot",
    join(state.reviewDir, "snapshot"),
    "--worktree",
    state.repo,
    ...select,
    "--diagnostics",
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
  if (lanes + 2 > NATIVE_LANE_CAP) cmd.push("--stress");
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
      ? `\narchive valid: ${scaffold.archiveDir}`
      : "\narchive not yet valid; fix the issues above (verdicts.json states, main_synthesis.md headings) and run finish again.",
  );
  if (!ok) runtimeProcess.exit(1);
}

function main() {
  const [command, ...rest] = Bun.argv.slice(2);
  const positional = rest[0] !== undefined && !rest[0].startsWith("--") ? rest.shift() : null;
  const args = parseArgs(rest);
  switch (command) {
    case "lanes":
      return console.log(renderLanes());
    case "read": {
      const named = selectLanes(args);
      return void runRead(args, positional, (scope) => named ?? lanesForScope(scope));
    }
    case "brief":
      return console.log(renderBrief(absolute(args, "out")));
    case "review":
      return launch(
        args,
        runRead(args, positional, () => LANES),
      );
    case "collect":
      return void collect(args, positional);
    case "launch":
      return launch(args);
    case "finish":
      return finish(args);
    default:
      console.error(
        "usage: wri.mjs lanes|read|brief|review|collect|launch|finish ... (see the header of this file)",
      );
      runtimeProcess.exit(2);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`wri: ${errorMessage(error)}`);
    runtimeProcess.exit(1);
  }
}

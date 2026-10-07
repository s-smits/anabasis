#!/usr/bin/env bun
// One entry point for a whole-run investigation. Each subcommand runs the deterministic readers
// and records what it did in `<review>/wri-review.json`.
//
//   bun wri.ts start  <run> [<run> ...] --out <abs dir> [--preset <name | file>]
//                     [--all | --lanes 1,3,5 | --lanes climb,yield] [--repo <abs>] [--reference <abs>]
//   bun wri.ts lanes  --out <abs dir> [--lanes 1-4,7 | --tier] [--agents <n> | --components <k>]
//                     [--readings per-run,cross-run,multi-run] [--remote-host <host>] [--prior <abs file>]
//   bun wri.ts collect   --out <abs dir>
//   bun wri.ts synthesis --out <abs dir> [--template <abs file>]
//   bun wri.ts launch --out <abs dir> [--run <runId>] [--auto <count> | --sessions <spec>] [--effort max]
//                     [--title <t>] [--notes <f>] [--max-active <n>] [--live]
//   bun wri.ts finish --out <abs dir> [--run <runId>]
//   bun wri.ts readers
//   bun wri.ts scope  <target> [--json]
//   bun wri.ts read   <target> --out <abs review dir> [--all | --lanes 1,3,5 | --lanes climb,yield]
//                     [--run <runId>] [--repo <abs>]
//   bun wri.ts brief  --out <abs review dir>
//   bun wri.ts census [--root <campaign tree>] [--json] [--out <abs file>]
//   bun wri.ts delta | climb | yield | timeline | walls | handoff | gates | target  <target> [--run <runId>] [--json] [--out <abs file>]
//              delta [--repo <abs>] [--previous <commit | abs campaign dir>]; timeline [--classify];
//              walls [--battery <runId>]; target [--reference <abs dir>]
//
// An investigation is `start`, an edit of `<dir>/shared-instructions.md`, `lanes`, one subagent per
// `<dir>/launch.md` entry, `collect`, and `synthesis` (investigation.ts holds those four).
// `start` reads each run into `<dir>/<runId>/` as `read` does and writes the shared instructions from
// the preset with the run table filled in. `launch` is the Luna route instead of `lanes`: it starts
// one run's lanes as Codex sessions. `finish` validates one run's per-run lane reports and scaffolds
// its archive.
//
// `readers` prints the deterministic catalogue and `scope` sizes one run. `read` resolves the run's
// measured checkout (`resolveSourceCheckout` in main/run.ts; exit 2 when no checkout can read it)
// and runs every lane that reads the run's records as that checkout's own script, sized by its own
// `scope`, because a newer tree's readers refuse an older run's records; only the overview and the
// archive check run here. It runs the lanes named by rank or by name, and with none named what the
// run's size earns (brief.ts owns the sizing and the digest). Every lane's output is captured to
// `<review>/<lane>.txt`, an in-process lane's report to `<review>/<lane>.json`, whose `triggers` the
// brief reads, and the command prints one bounded brief instead, because the whole read is the size
// of a paid lane's context. A snapshot view that fails heads the brief and stops no other lane; the
// read exits 1 once every lane has run. `brief` re-renders that digest from a finished review
// directory. The investigation itself ends in one adjudicated note.
//
// A target is one folder — a campaign, its `controller` directory or one `controller/<runId>`
// folder — or a bare run id, looked up in the main checkout's campaign tree, which every run
// worktree links to.

import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { scaffoldArchive } from "./archive-scaffold.ts";
import { MAIN, REVIEW } from "./archive-shape.ts";
import { renderBrief, renderScope, type RunScope, runScope, SEMANTIC_LANES, snapshotGaps } from "./brief.ts";
import { ANGLE_COUNT, NATIVE_OUTPUT } from "./catalogue-shape.ts";
import {
  buildLanes,
  collectReports,
  agentPrompt,
  investigationRun,
  type LanesOptions,
  modelCheck,
  refuseRestart,
  renderSynthesis,
  writeStart,
} from "./investigation.ts";
import {
  buildOverview,
  laneTriggers,
  OVERVIEW_FILE,
  readJsonAs,
  REVIEW_STATE_FILE,
  SNAPSHOT_STATUS_FILE,
} from "./run-overview.ts";
import { openRecordedRun, resolveSourceCheckout, sourceUnresolved } from "#skills/main/run.ts";
import { RUN_OVERVIEW_FILE, renderRunOverview, SHARED_INSTRUCTIONS_FILE } from "./shared-instructions.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { CommandFailure, exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { writeJsonFile } from "#src/meta/completed-json.ts";
import { LAUNCH_FILE, SUMMARY_FILE } from "#skills/codex-luna-swarm/scripts/luna-receipts.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { emitReport } from "#skills/main/output.ts";
import {
  chooseRun,
  mainCheckout,
  recordedRuns,
  resolveRunSelector,
  type RunSelection,
} from "#tools/runs/discover.ts";
import { campaignRoot } from "#src/meta/campaign-root.ts";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
/** This file, as the next command each step prints names it. */
const WRI_SCRIPT = join(SCRIPT_DIR, "wri.ts");
const CHECKOUT = resolve(SCRIPT_DIR, "../../../..");
/** This skill's directory inside any checkout, so a lane runs the measured checkout's own copy. */
const SKILL = ".claude/skills/whole-run-investigation";
// Bun always names its own executable first.
const BUN = Bun.argv[0] ?? "";
/** Where the primary writes the adjudicated note that ends an investigation; the tree ignores it. */
const NOTE_PATH = "notes/investigation-YYYYMMDD-<topic>.md";

/** What an in-process lane reads: the run, and the options its own subcommand takes. */
export interface ReadContext {
  campaign: string;
  runId: string;
  repo: string | null;
  previous: string | null;
  classify: boolean;
  battery: string | null;
  reference: string | null;
}

/** What a lane inside a review reads: the run, the measured checkout whose scripts read it, and
 *  the review's own paths. */
export interface LaneContext extends ReadContext {
  repo: string;
  reviewDir: string;
  runArgs: string[];
  snapshot: string;
  archive: string | null;
}

/** A report and the view a reader sees of it. */
export interface LaneReading {
  report: unknown;
  text: string;
}

/** An option an in-process lane's subcommand takes beyond the target, by its context field. */
type LaneOption = "repo" | "previous" | "battery" | "reference";

export interface Lane {
  name: string;
  label: string;
  collect?: boolean;
  options?: readonly LaneOption[];
  flags?: readonly "classify"[];
  cmd?: (c: LaneContext) => string[];
  read?: (c: ReadContext) => Promise<LaneReading>;
  needs?: (c: LaneContext) => string | null;
  write?: (c: LaneContext) => string;
}

/** A lane that reads its report in-process. */
type ReadingLane = Lane & { read: NonNullable<Lane["read"]> };

/** One recorded step of a review. */
export interface StepRow {
  label: string;
  ok: boolean | null;
  exitCode?: number | null;
  skipped?: string;
  wrote?: string;
  at: string;
}

/** The review state `wri-review.json` records. */
export interface WriReviewState {
  schema: "wri-review/v2";
  reviewDir: string;
  campaign: string;
  runId: string;
  /** The checkout whose readers read the run, how it was chosen, and every one passed over. */
  repo: string;
  chosen: string;
  passed: string[];
  reviewCheckout: string;
  /** The run's size as its own source's `scope` read it. */
  scope: RunScope;
  steps: StepRow[];
}

/** The options a subcommand reads, in the `{flag, value}` shape. */
export interface WriArgs {
  flag(name: string): boolean;
  value(name: string): string | null;
}

/**
 * The deterministic readers, in the order a review reads them. Five are the ones the paid lanes
 * consume, `climb` before the `overview` that carries its trigger; the rest answer one
 * question each and cost nothing but local compute. A lane whose input this target does not carry
 * is skipped with the reason, never silently. A lane with `cmd` is a script of its own; one with
 * `read` runs in-process as its own subcommand, which a review asks of the measured checkout's copy
 * of this file, and imports its module only when it runs, because the classifier behind two of them
 * loads an embedding runtime. `options` and `flags` are what that subcommand takes beyond the target.
 */
export const LANES: readonly Lane[] = [
  {
    name: "snapshot",
    label: "cases and traces",
    collect: true,
    cmd: (c) => [
      BUN,
      "--no-env-file",
      sourceScript(c, "scripts/trace-review.ts"),
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
      sourceScript(c, "scripts/trace-challenge.ts"),
      ...c.runArgs,
      "--out",
      join(c.snapshot, "trace-challenge"),
    ],
  },
  {
    name: "delta",
    label: "source delta",
    collect: true,
    options: ["repo", "previous"],
    read: async (c) => {
      const { buildSourceDelta, renderSourceDelta } = await import("./source-delta.ts");
      return shown(buildSourceDelta(c), renderSourceDelta);
    },
  },
  {
    name: "climb",
    label: "climb velocity",
    collect: true,
    needs: (c) => (existsSync(join(c.campaign, "versions")) ? null : "no adopted version, so no battery yet"),
    // The JSON drops each battery's family vectors, which only the verdict reads.
    read: async (c) => {
      const { flatTriggers, lineOf, readCampaign, render } = await import("./climb-velocity.ts");
      const report = await readCampaign(c.campaign);
      const batteries = report.batteries.map((battery) => ({
        ...battery,
        reading: { ...battery.reading, familyVectors: undefined },
      }));
      const line = lineOf(report);
      return { report: { ...report, batteries, line, triggers: flatTriggers(line) }, text: render(report) };
    },
  },
  {
    name: "overview",
    label: "shared brief",
    collect: true,
    needs: (c) =>
      existsSync(join(c.snapshot, SNAPSHOT_STATUS_FILE))
        ? null
        : `no ${SNAPSHOT_STATUS_FILE} under ${c.snapshot}; the snapshot lane recorded none`,
    write: (c) => writeOverview(c),
  },
  {
    name: "yield",
    label: "review yield",
    read: async (c) => {
      const { buildReviewYield, renderReviewYield } = await import("./review-yield.ts");
      return shown(buildReviewYield(c.campaign), renderReviewYield);
    },
  },
  {
    name: "posture",
    label: "builder posture",
    cmd: (c) => [
      BUN,
      "--no-env-file",
      sourceScript(c, "classifier/prose-classify.ts"),
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
      const { buildTimeline, classifyTimeline, renderTimeline } = await import("./timeline.ts");
      const recorded = buildTimeline(c);
      return shown(c.classify ? await classifyTimeline(recorded, c) : recorded, renderTimeline);
    },
  },
  {
    name: "walls",
    label: "solve budget",
    options: ["battery"],
    read: async (c) => {
      const { buildWalls, renderWalls } = await import("./walls.ts");
      return shown(buildWalls({ campaign: c.campaign, runId: c.battery }), renderWalls);
    },
  },
  {
    name: "handoff",
    label: "round hand-offs",
    read: async (c) => {
      const { buildHandoffs, renderHandoffs } = await import("./handoffs.ts");
      return shown(buildHandoffs({ campaign: c.campaign, runId: c.runId }), renderHandoffs);
    },
  },
  {
    name: "gates",
    label: "gate rent",
    read: async (c) => {
      const { buildGateRent, renderGateRent } = await import("./gate-rent.ts");
      return shown(buildGateRent({ campaign: c.campaign, runId: c.runId }), renderGateRent);
    },
  },
  {
    name: "target",
    label: "hardware target",
    options: ["reference"],
    read: async (c) => {
      const { buildHardwareTarget, renderHardwareTarget } = await import("./hardware-target.ts");
      return shown(
        buildHardwareTarget({ campaign: c.campaign, runId: c.runId, reference: c.reference }),
        renderHardwareTarget,
      );
    },
  },
  {
    name: "archive",
    label: "archive validity",
    needs: (c) =>
      c.archive === null ? "no archive for this run under notes/runs; `finish` writes one" : null,
    cmd: (c) => [BUN, "--no-env-file", script("validate-archive.ts"), "--archive", String(c.archive)],
  },
];

const TARGET = ["out", "campaign", "run", "repo", "reference"];
/** Each subcommand's own options, so one a subcommand does not take is refused there. */
const COMMANDS: Record<
  string,
  { values?: readonly string[]; flags?: readonly string[]; positionals?: readonly [number, number] }
> = {
  start: { values: ["out", "preset", "lanes", "repo", "reference"], flags: ["all"], positionals: [1, 64] },
  lanes: {
    values: ["out", "lanes", "agents", "components", "readings", "remote-host", "prior"],
    flags: ["tier"],
  },
  collect: { values: ["out"] },
  synthesis: { values: ["out", "template"] },
  launch: {
    values: ["out", "run", "auto", "sessions", "effort", "title", "notes", "max-active"],
    flags: ["live"],
  },
  finish: { values: ["out", "run"] },
  readers: {},
  read: { values: [...TARGET, "lanes"], flags: ["all"], positionals: [0, 1] },
  brief: { values: ["out"] },
  census: { values: ["root", "out"], flags: ["json"] },
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
                positionals: [0, 1] as const,
              },
            ],
          ],
    ),
  ),
};

/** A report and the view a reader sees of it. */
function shown<T>(report: T, render: (report: T) => string): LaneReading {
  return { report, text: render(report) };
}

function absolute(args: WriArgs, name: string): string {
  const value = args.value(name);
  if (value === null || value === "") throw new Error(`--${name} is required`);
  if (!isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
  return resolve(value);
}

function script(name: string): string {
  return join(SCRIPT_DIR, name);
}

/** A file of this skill in the measured checkout, whose copy reads the run. */
function sourceScript(c: Pick<LaneContext, "repo">, path: string): string {
  return join(c.repo, SKILL, path);
}

/** Campaign and run from one folder, the explicit options, or a run selector read the way `bun run
 *  runs show` reads it (id, project, or the head or hex tail of an id) over the main checkout's
 *  campaign tree, which every run worktree links to. */
function resolveTarget(args: WriArgs, positional: string | null): RunSelection {
  const folder = positional ?? args.value("campaign");
  if (folder === null) throw new Error("name a campaign folder, a controller/<runId> folder or a run id");
  if (existsSync(folder) || existsSync(resolve(folder))) return resolveRunSelector(folder, args.value("run"));
  const { location, refusal } = chooseRun(recordedRuns(mainCheckout(CHECKOUT)), folder);
  if (location === undefined) throw new Error(refusal);
  return { ...resolveRunSelector(location.campaignDir, location.runId), chosen: "run id" };
}

/** The archive `finish` already wrote for this run, or null while none carries its `review.json`. */
function archiveFor(runId: string): string | null {
  const root = join(CHECKOUT, "notes", "runs");
  if (!existsSync(root)) return null;
  for (const hit of new Bun.Glob(`*${runId}*/${REVIEW}`).scanSync({ cwd: root })) {
    return join(root, dirname(hit));
  }
  return null;
}

function context(state: WriReviewState, reference: string | null): LaneContext {
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
    reference,
  };
}

/** Run one step, capturing its output to a file or streaming it, recording it in the review state.
 *  A lane always captures its stdout, and its stderr too when it fails, so the brief says why: the
 *  brief is what a reader opens, and the file is what a paid lane and a later question read. Only
 *  `launch`, whose output is the launcher's own progress, streams. */
function step(
  state: WriReviewState,
  label: string,
  cmd: string[],
  {
    fatal = true,
    cwd = CHECKOUT,
    capture = null,
  }: { fatal?: boolean; cwd?: string; capture?: string | null } = {},
): boolean {
  if (capture === null) console.log(`   ${label}`);
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdin: "ignore",
    stdout: capture === null ? "inherit" : "pipe",
    stderr: capture === null ? "inherit" : "pipe",
  });
  const ok = result.exitCode === 0;
  if (capture !== null) {
    writeFileSync(
      capture,
      `${result.stdout?.toString() ?? ""}${ok ? "" : (result.stderr?.toString() ?? "")}`,
    );
  }
  record(state, { label, ok, exitCode: result.exitCode });
  if (!ok && fatal) throw new Error(`${label} failed with exit ${result.exitCode}`);
  if (!ok) console.log(`   (${label} failed; recorded, continuing)`);
  return ok;
}

const isReadingLane = (lane: Lane): lane is ReadingLane => lane.read !== undefined;

function record(state: WriReviewState, row: Omit<StepRow, "at">): void {
  state.steps.push({ ...row, at: new Date().toISOString() });
  saveState(state);
}

/** A lane as the measured checkout runs it: its own script, or for an in-process lane this file's
 *  subcommand in that checkout, with the options the review supplies and its report at
 *  `<review>/<lane>.json`. */
function laneCommand(lane: Lane, c: LaneContext): string[] {
  if (lane.cmd !== undefined) return lane.cmd(c);
  const values = (lane.options ?? []).flatMap((name) => {
    const value = c[name];
    return value === null ? [] : [`--${name}`, value];
  });
  const flags = (lane.flags ?? []).filter((name) => c[name]).map((name) => `--${name}`);
  return [
    BUN,
    "--no-env-file",
    sourceScript(c, "scripts/wri.ts"),
    lane.name,
    c.campaign,
    "--run",
    c.runId,
    "--out",
    join(c.reviewDir, `${lane.name}.json`),
    ...values,
    ...flags,
  ];
}

function runLane(state: WriReviewState, lane: Lane, ctx: LaneContext): void {
  const missing = lane.needs === undefined ? null : lane.needs(ctx);
  if (missing !== null) {
    console.log(`   ${lane.name}: skipped, ${missing}`);
    return record(state, { label: lane.name, ok: null, skipped: missing });
  }
  console.log(`   ${lane.name}`);
  if (lane.write !== undefined) {
    let wrote: string;
    try {
      wrote = lane.write(ctx);
    } catch (error) {
      writeFileSync(join(ctx.reviewDir, `${lane.name}.txt`), `${errorMessage(error)}\n`);
      console.log(`   (${lane.name} failed; recorded, continuing)`);
      return record(state, { label: lane.name, ok: false, exitCode: null });
    }
    return record(state, { label: lane.name, ok: true, exitCode: 0, wrote });
  }
  step(state, lane.name, laneCommand(lane, ctx), {
    fatal: false,
    cwd: ctx.repo,
    capture: join(ctx.reviewDir, `${lane.name}.txt`),
  });
}

function writeOverview(ctx: LaneContext): string {
  const overview = buildOverview(ctx.snapshot);
  writeJsonFile(join(ctx.reviewDir, OVERVIEW_FILE), overview);
  const lanes = laneTriggers(ctx.reviewDir, loadState(ctx.reviewDir).steps);
  writeFileSync(join(ctx.reviewDir, RUN_OVERVIEW_FILE), `${renderRunOverview(overview, lanes)}\n`);
  return `${OVERVIEW_FILE} and ${RUN_OVERVIEW_FILE}, from ${ctx.snapshot}`;
}

export function renderReaders(): string {
  const rows = LANES.map(
    (lane, index) =>
      `  ${String(index + 1).padStart(2)}  ${lane.name.padEnd(12)}${lane.label}${lane.collect === true ? "  (feeds the lane prompts)" : ""}`,
  );
  return ["deterministic lanes — `--lanes` takes ranks or names, `--all` runs every one", ...rows].join("\n");
}

/** The selected lanes, or null when the caller named none and wants the catalogue. */
export function selectLanes(args: WriArgs): readonly Lane[] | null {
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
      if (lane === undefined) throw new Error(`no lane ${token}; run \`wri.ts readers\` for the catalogue`);
      return lane;
    });
}

function statePath(reviewDir: string): string {
  return join(reviewDir, REVIEW_STATE_FILE);
}

function saveState(state: WriReviewState): void {
  writeJsonFile(statePath(state.reviewDir), state);
}

function loadState(reviewDir: string): WriReviewState {
  const path = statePath(reviewDir);
  if (!existsSync(path)) throw new Error(`no ${REVIEW_STATE_FILE} under ${reviewDir}; read the run first`);
  return readJsonAs<WriReviewState>(path);
}

/** The lanes this run's own size earns, when the reader named none. `brief.ts` owns the sizing;
 *  a tier that names no lane list means every lane. */
export function lanesForScope(scope: { readonly lanes: readonly string[] | null }): readonly Lane[] {
  const { lanes } = scope;
  return lanes === null ? LANES : LANES.filter((lane) => lanes.includes(lane.name));
}

/** The checkout whose readers read this run: `--repo` when it can, else the one the resolver
 *  finds or prepares. None is a refusal with every reason, before anything is read. */
function sourceCheckout(
  args: WriArgs,
  target: RunSelection,
): { repo: string; chosen: string; passed: string[] } {
  const { source } = openRecordedRun(target.campaign, target.runId);
  const found = resolveSourceCheckout(source.commit, { repo: args.value("repo"), runId: target.runId });
  if (found.state === "source-unresolved") throw new CommandFailure(sourceUnresolved(found), 2);
  return found;
}

/** The run's size as the measured checkout's own `scope` reads it. */
function sourceScope(repo: string, target: RunSelection): RunScope {
  const cmd = [BUN, "--no-env-file", sourceScript({ repo }, "scripts/wri.ts"), "scope", target.campaign];
  const result = Bun.spawnSync({
    cmd: [...cmd, "--run", target.runId, "--json"],
    cwd: repo,
    stdin: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error(`the measured checkout's scope refused the run: ${result.stderr.toString().trim()}`);
  }
  return parseJsonAs<RunScope>(result.stdout.toString());
}

/**
 * Resolve the measured checkout, size the run by it, choose the lanes, read them into `reviewDir`,
 * then print one brief. `select` receives the scope, so a read with no lanes named defers to the
 * tier. A read into a review that already recorded one of the same run keeps the earlier lanes'
 * rows, so a narrower second read adds to the review rather than replacing it; a lane read again
 * replaces only its own row. A review of another run starts empty.
 */
async function runRead(
  args: WriArgs,
  target: RunSelection,
  reviewDir: string,
  select: (scope: RunScope) => readonly Lane[],
): Promise<WriReviewState> {
  const reference = args.value("reference") === null ? null : absolute(args, "reference");
  const { repo, chosen, passed } = sourceCheckout(args, target);
  const scope = sourceScope(repo, target);
  const lanes = select(scope);
  const earlier = existsSync(statePath(reviewDir)) ? loadState(reviewDir) : null;
  const reread = new Set(lanes.map((lane) => lane.name));
  const state: WriReviewState = {
    schema: "wri-review/v2",
    reviewDir,
    campaign: target.campaign,
    runId: target.runId,
    repo,
    chosen,
    passed,
    reviewCheckout: CHECKOUT,
    scope,
    steps:
      earlier?.campaign === target.campaign && earlier.runId === target.runId
        ? earlier.steps.filter((row) => !reread.has(row.label))
        : [],
  };
  mkdirSync(reviewDir, { recursive: true });
  saveState(state);
  console.log(
    [
      `run ${state.runId} (${target.chosen}), ${scope.tier} tier`,
      `  readers ${repo} (${chosen})`,
      ...passed.map((reason) => `    passed over ${reason}`),
      `  reading ${lanes.length} lane(s):`,
    ].join("\n"),
  );
  const ctx = context(state, reference);
  for (const lane of lanes) runLane(state, lane, ctx);
  console.log(`\n${renderBrief(reviewDir)}\n\nrecorded: ${statePath(reviewDir)}`);
  // Only once every lane has run, and only over this read's own snapshot, so nothing builds lanes
  // on a partial read that its caller could take for a whole one.
  const gaps = lanes.some((lane) => lane.name === "snapshot") ? snapshotGaps(reviewDir, state.steps) : [];
  if (gaps.length > 0) {
    const named = gaps.map((gap) => `${gap.label}: ${gap.status}`).join(", ");
    throw new CommandFailure(`snapshot incomplete: ${named}; every other lane was read`, 1);
  }
  return state;
}

/** One in-process lane as its own command: the view, or the JSON under `--json`, and the JSON
 *  recorded at `--out`. Only `delta` reads a checkout, `--repo` or the run's own measured one. */
async function readOneLane(args: WriArgs, positional: string | null, lane: ReadingLane): Promise<void> {
  const target = resolveTarget(args, positional);
  const out = args.value("out") === null ? null : absolute(args, "out");
  const named = args.value("repo");
  const repo = lane.options?.includes("repo") === true ? (named ?? sourceCheckout(args, target).repo) : null;
  const { report, text } = await lane.read({
    campaign: target.campaign,
    runId: target.runId,
    repo: repo === null ? null : resolve(repo),
    previous: args.value("previous"),
    classify: args.flag("classify"),
    battery: args.value("battery"),
    reference: args.value("reference") === null ? null : absolute(args, "reference"),
  });
  emitReport(report, { json: args.flag("json"), out, render: () => text });
}

/** Read every named run into the investigation and write its shared instructions from the
 *  preset. A run whose snapshot came out incomplete is still in the run table; `start` names it and
 *  exits 1 once every run is read. */
async function start(args: WriArgs, positionals: readonly string[]): Promise<void> {
  const out = absolute(args, "out");
  refuseRestart(out);
  const named = selectLanes(args);
  const states: WriReviewState[] = [];
  const incomplete: string[] = [];
  for (const positional of positionals) {
    const target = resolveTarget(args, positional);
    const reviewDir = join(out, target.runId);
    try {
      states.push(await runRead(args, target, reviewDir, (scope) => named ?? lanesForScope(scope)));
    } catch (error) {
      if (!(error instanceof CommandFailure) || error.code !== 1) throw error;
      console.error(`wri: ${target.runId}: ${errorMessage(error)}`);
      incomplete.push(target.runId);
      states.push(loadState(reviewDir));
    }
  }
  const shared = writeStart(out, states, args.value("preset"));
  console.log(
    `\nshared instructions: ${shared}\n  fill its marked sections (and edit any other line every lane should read), then:\n  bun ${WRI_SCRIPT} lanes --out ${out}`,
  );
  if (incomplete.length > 0) {
    throw new CommandFailure(
      `snapshot incomplete for ${incomplete.join(", ")}; their lanes cannot be built`,
      1,
    );
  }
}

function count(args: WriArgs, name: string): number | null {
  const raw = args.value(name);
  if (raw === null) return null;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`--${name} takes a positive count, got "${raw}"`);
  return Number(raw);
}

function lanesOptions(args: WriArgs): LanesOptions {
  const agents = count(args, "agents");
  const components = count(args, "components");
  if (agents !== null && components !== null) throw new Error("pass --agents or --components, not both");
  if (args.flag("tier") && args.value("lanes") !== null) throw new Error("pass --lanes or --tier, not both");
  return {
    lanes: args.value("lanes"),
    tier: args.flag("tier") ? "tier" : "all",
    size: components === null ? { agents: agents ?? 10 } : { components },
    readings: args.value("readings"),
    remoteHost: args.value("remote-host"),
    prior: args.value("prior") === null ? null : absolute(args, "prior"),
  };
}

function buildLaneCommand(args: WriArgs): void {
  const out = absolute(args, "out");
  const { launch: launchPath, notes } = buildLanes(out, lanesOptions(args));
  for (const note of notes) console.log(`   ${note}`);
  console.log(
    `\nlaunch: ${launchPath}\n  launch one subagent per entry, then: bun ${WRI_SCRIPT} collect --out ${out}`,
  );
}

function collect(args: WriArgs): void {
  const out = absolute(args, "out");
  const { index, readings } = collectReports(out);
  for (const row of readings) {
    console.log(`${row.reading.padEnd(10)} ${row.ok}/${row.of} ok${row.ok === row.of ? ", complete" : ""}`);
  }
  console.log(`\nindex: ${index}`);
  const perRun = readings.find((row) => row.reading === "per-run");
  const done = readings.every((row) => row.ok === row.of);
  if (
    perRun !== undefined &&
    perRun.ok === perRun.of &&
    !readings.some((row) => row.reading === "cross-run")
  ) {
    console.log(
      `  per-run is complete; for the cross-run reading: bun ${WRI_SCRIPT} lanes --out ${out} --readings cross-run`,
    );
  }
  if (done) console.log(`  then: bun ${WRI_SCRIPT} synthesis --out ${out}`);
  else runtimeProcess.exit(1);
}

function synthesis(args: WriArgs): void {
  const out = absolute(args, "out");
  const template = args.value("template") === null ? null : absolute(args, "template");
  const { prompt, incomplete } = renderSynthesis(out, template);
  for (const row of incomplete) console.log(`   incomplete: ${row}; the synthesis names the gaps`);
  console.log(
    `\nsynthesis prompt: ${prompt}\n  launch one subagent with: ${agentPrompt(prompt)}\n  model check: ${modelCheck(prompt)}`,
  );
}

/** The Luna route: one run's lanes, launched as Codex sessions from the same shared instructions. */
function launch(args: WriArgs): void {
  const out = absolute(args, "out");
  const state = loadState(investigationRun(out, args.value("run")));
  const lanesDir = join(state.reviewDir, "lanes");
  if (existsSync(join(lanesDir, "luna-output", LAUNCH_FILE))) {
    throw new Error(`${lanesDir} already holds a launch; use a fresh --out or trash the lanes directory`);
  }
  // `--sessions` names lanes from the catalogue; `--auto` asks the manifest to group every lane into
  // that many sessions, and with neither the count is the one the run's tier named when it was read.
  const sessions = args.value("sessions");
  const auto = args.value("auto") ?? String(state.scope.semanticLanes);
  if (!/^\d+$/.test(auto) || Number(auto) < 1 || Number(auto) > ANGLE_COUNT) {
    throw new Error(
      `--auto must be a count from 1 to ${ANGLE_COUNT}; the tiers ask ${SEMANTIC_LANES.probe} (probe), ${SEMANTIC_LANES.standard} (standard) or ${SEMANTIC_LANES.deep} (deep)`,
    );
  }
  const select = sessions !== null && sessions !== "" ? ["--sessions", sessions] : ["--auto", auto];
  const cmd = [
    BUN,
    "--no-env-file",
    script("build-manifest.ts"),
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
    args.value("effort") ?? "max",
    "--shared-instructions",
    join(out, SHARED_INSTRUCTIONS_FILE),
    "--run-overview",
    join(state.reviewDir, RUN_OVERVIEW_FILE),
    "--launch",
    "--detach",
  ];
  for (const name of ["title", "notes", "max-active"]) {
    const given = args.value(name);
    if (given !== null && given !== "") cmd.push(`--${name}`, given);
  }
  if (args.flag("live")) cmd.push("--live");
  step(state, "launch", cmd);
  console.log(
    `\nlanes: ${lanesDir}\n  progress: ${join(lanesDir, "luna-output")}/<name>.md as each lane finishes; summary.json marks completion.\n  then: bun ${WRI_SCRIPT} finish --out ${out} --run ${state.runId}`,
  );
}

/** The Luna summary `finish` validates, or null for a review whose lanes all ran natively. A Luna
 *  launch without its summary is still running, and a review neither transport has reported to
 *  has nothing to validate. */
function lunaSummary(lanesDir: string): string | null {
  const summary = join(lanesDir, "luna-output", SUMMARY_FILE);
  if (existsSync(summary)) return summary;
  if (existsSync(join(lanesDir, "luna-output", LAUNCH_FILE))) {
    throw new Error(
      `${summary} is absent: the Luna lanes have not finished (see ${join(lanesDir, "launcher.log")})`,
    );
  }
  if (!existsSync(join(lanesDir, NATIVE_OUTPUT))) {
    throw new Error(
      `no lane has reported: neither ${summary} nor a native report under ${join(lanesDir, NATIVE_OUTPUT)} exists`,
    );
  }
  return null;
}

/** Validate one run's per-run lane reports and scaffold its archive. The archive records `lanes/`
 *  only: the isolated lanes' reports under `lanes-isolated/` and the cross-run and multi-run
 *  readings are not in it, and are carried by the synthesis instead. */
function finish(args: WriArgs): void {
  const out = absolute(args, "out");
  const state = loadState(investigationRun(out, args.value("run")));
  console.log(
    `finish archives ${state.runId}'s lanes/ only; lanes-isolated/, cross-run/ and multi-run/ are not in the archive`,
  );
  const lanesDir = join(state.reviewDir, "lanes");
  const summary = lunaSummary(lanesDir);
  step(
    state,
    "validate-reports",
    [
      BUN,
      "--no-env-file",
      script("validate-reports.ts"),
      "--tasks",
      join(lanesDir, "tasks.json"),
      ...(summary === null ? [] : ["--summary", summary]),
      "--out",
      join(state.reviewDir, "wri-report-validation.json"),
    ],
    { fatal: false },
  );
  const scaffold = scaffoldArchive(state.reviewDir);
  console.log(`\n== archive scaffold\n${JSON.stringify(scaffold, null, 2)}`);
  if (scaffold.fresh) {
    console.log(
      `\nverdicts template written: ${scaffold.verdictsPath}\n  record states and reasons there, write ${join(scaffold.archiveDir, MAIN)}, then run finish again.`,
    );
    return;
  }
  const ok = step(
    state,
    "validate-archive",
    [BUN, "--no-env-file", script("validate-archive.ts"), "--archive", scaffold.archiveDir],
    { fatal: false },
  );
  console.log(
    ok
      ? `\narchive valid: ${scaffold.archiveDir}\n  then: write the adjudicated note at ${join(CHECKOUT, NOTE_PATH)}`
      : "\narchive not yet valid; fix the issues above (verdicts.json states, main_synthesis.md headings) and run finish again.",
  );
  if (!ok) runtimeProcess.exit(1);
}

async function main(): Promise<void> {
  const parsed = parseCommandOrDie(exitWith("wri"), COMMANDS);
  const { command } = parsed;
  const positional = parsed.positionals[0] ?? null;
  // The parsed options, in the `{flag, value}` shape the subcommands read.
  const args: WriArgs = {
    flag: (name) => parsed.flags.has(name),
    value: (name) => parsed.single.get(name) ?? null,
  };
  const lane = LANES.filter(isReadingLane).find((row) => row.name === command);
  if (lane !== undefined) return readOneLane(args, positional, lane);
  switch (command) {
    case "start":
      return start(args, parsed.positionals);
    case "lanes":
      return buildLaneCommand(args);
    case "collect":
      return collect(args);
    case "synthesis":
      return synthesis(args);
    case "readers":
      return console.log(renderReaders());
    case "scope": {
      const target = resolveTarget(args, positional);
      const scope = runScope(target.campaign, target.runId);
      return console.log(args.flag("json") ? JSON.stringify(scope, null, 2) : renderScope(scope));
    }
    case "read": {
      const named = selectLanes(args);
      const target = resolveTarget(args, positional);
      return void (await runRead(
        args,
        target,
        absolute(args, "out"),
        (scope) => named ?? lanesForScope(scope),
      ));
    }
    case "brief":
      return console.log(renderBrief(absolute(args, "out")));
    case "launch":
      return launch(args);
    case "finish":
      return finish(args);
    case "census": {
      const { buildGateCensus, renderGateCensus } = await import("./gate-census.ts");
      const root = args.value("root") ?? campaignRoot(mainCheckout(CHECKOUT));
      const out = args.value("out");
      return emitReport(buildGateCensus({ root }), {
        json: args.flag("json"),
        out,
        render: renderGateCensus,
      });
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`wri: ${errorMessage(error)}`);
    runtimeProcess.exit(error instanceof CommandFailure ? error.code : 1);
  }
}

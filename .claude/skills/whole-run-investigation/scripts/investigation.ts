// One investigation of one or more runs, as `wri.ts start`, `lanes`, `collect` and `synthesis` drive
// it. The investigation directory holds:
//
//   wri-investigation.json      the runs, in the order `start` named them, and the preset it used
//   shared-instructions.md      the editable shared instructions every open lane prompt carries
//   <runId>/                    each run's review, as `wri.ts read` writes one; `lanes` adds
//     lanes/                    the open lanes' single-lane prompts, and groups/ composed from them
//     lanes-isolated/           the fired isolated lanes', built on their own and blind to the rest
//   cross-run/, multi-run/      the readings across runs: groups.json, one prompt per group, and
//                               native-output/<group>.md, the report each group's agent writes
//   launch.md                   one entry per agent `lanes` composed: its one-line prompt and model check
//   reports.md                  `collect`'s index of every expected report: ok, missing or invalid
//   synthesis-prompt.md         `synthesis`'s prompt for the one session that writes synthesis.md
//
// A per-run lane writes `<review>/<lanes dir>/native-output/lane_NN.md`, one report per lane, which
// `validate-reports.ts` checks against that run's tasks.json; a group across runs writes one report
// for all its lanes, checked against its groups.json.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import { writeJsonFile } from "#src/meta/completed-json.ts";
import { laneSuggestions } from "./brief.ts";
import { ANGLE_COUNT, ISOLATED_ANGLES, NATIVE_OUTPUT } from "./catalogue-shape.ts";
import {
  type AcrossRuns,
  checkComposed,
  type ComposedGroup,
  composeLanes,
  composeRuns,
  type GroupSize,
  availableLanes,
  loadLaneGroups,
  planGroups,
  readRun,
  runsPreamble,
  sessionName,
  writeGroups,
} from "./compose-groups.ts";
import { INSTRUCTIONS_FILE } from "./manifest-compose.ts";
import { isolatedLaneGate, loadSnapshot } from "./manifest-inputs.ts";
import {
  type DigestTrigger,
  laneTriggers,
  OVERVIEW_FILE,
  readJsonAs,
  REVIEW_STATE_FILE,
  SNAPSHOT_STATUS_FILE,
} from "./run-overview.ts";
import {
  presetPath,
  readSharedInstructions,
  renderPreset,
  RUN_OVERVIEW_FILE,
  type RunRow,
  SHARED_INSTRUCTIONS_FILE,
} from "./shared-instructions.ts";
import { validate, validateGroups, type ReportRow } from "./validate-reports.ts";
import type { WriReviewState } from "./wri.ts";

export const READINGS = ["per-run", "cross-run", "multi-run"] as const;
export type Reading = (typeof READINGS)[number];

interface Investigation {
  schema: string;
  preset: string;
  runs: { runId: string; review: string }[];
}

/** One agent to launch: the prompt it reads and the report(s) it writes. */
interface AgentRow {
  reading: Reading;
  run: string | null;
  name: string;
  lanes: number[];
  prompt: string;
  reports: string[];
}

interface IndexRow extends AgentRow {
  status: "ok" | "missing" | "invalid";
  issues: string[];
}

export interface LanesOptions {
  lanes: string | null;
  tier: "tier" | "all";
  size: GroupSize;
  /** The `--readings` list as given; null reads the default for the investigation's run count. */
  readings: string | null;
  remoteHost: string | null;
  prior: string | null;
}

const INVESTIGATION_FILE = "wri-investigation.json";
const INVESTIGATION_SCHEMA = "wri-investigation/v1";
/** Where a run's open and isolated lanes are built, and where each composes its groups. */
const LANE_DIRS = ["lanes", "lanes-isolated"] as const;
const GROUPS_DIR = "groups";
const GROUPS_FILE = "groups.json";
const SCRIPTS = import.meta.dir;
const SYNTHESIS_TEMPLATE = join(dirname(SCRIPTS), "references", "synthesis.template.md");
const BUN = Bun.argv[0] ?? "";

// ---- start ----------------------------------------------------------------------------------

/** Refuse before any run is read when the investigation already has its shared instructions. */
export function refuseRestart(out: string): void {
  const path = join(out, SHARED_INSTRUCTIONS_FILE);
  if (existsSync(path)) {
    throw new Error(`${path} exists: edit it, or move the investigation directory aside to start over`);
  }
}

function runRow(state: WriReviewState): RunRow {
  const { scope } = state;
  const cases = scope.cases;
  return {
    runId: state.runId,
    tier: scope.tier,
    campaign: state.campaign,
    review: state.reviewDir,
    commit: openRecordedRun(state.campaign, state.runId).source.commit,
    checkout: state.repo,
    terminal: scope.terminal === null ? "none recorded" : `\`${scope.terminal.outcome}\``,
    batteries: scope.batteries.length,
    cases: `${cases.verified} verified, ${cases.unaccepted} unaccepted, ${cases.nonResult} non-results`,
  };
}

/** Write the investigation record and its shared instructions from the preset; the path written. */
export function writeStart(out: string, states: readonly WriReviewState[], preset: string | null): string {
  const template = presetPath(preset);
  const path = join(out, SHARED_INSTRUCTIONS_FILE);
  writeFileSync(path, renderPreset(template, states.map(runRow)));
  const record: Investigation = {
    schema: INVESTIGATION_SCHEMA,
    preset: template,
    runs: states.map((state) => ({ runId: state.runId, review: state.reviewDir })),
  };
  writeJsonFile(join(out, INVESTIGATION_FILE), record);
  return path;
}

function loadInvestigation(out: string): Investigation {
  const path = join(out, INVESTIGATION_FILE);
  if (!existsSync(path)) throw new Error(`no ${INVESTIGATION_FILE} under ${out}; \`wri.ts start\` writes it`);
  const record = readJsonAs<Investigation>(path);
  if (record.schema !== INVESTIGATION_SCHEMA) {
    throw new Error(`${path} is not a ${INVESTIGATION_SCHEMA} record`);
  }
  return record;
}

/** One run's review directory: the one `--run` names, or the only run. */
export function investigationRun(out: string, runId: string | null): string {
  const { runs } = loadInvestigation(out);
  const [only] = runs;
  if (runId === null && runs.length === 1 && only !== undefined) return only.review;
  const found = runs.find((run) => run.runId === runId);
  if (found === undefined) {
    throw new Error(`name one run with --run: ${runs.map((run) => run.runId).join(", ")}`);
  }
  return found.review;
}

// ---- lanes ----------------------------------------------------------------------------------

/** The lane numbers a spec such as `1-4,7,12` names. */
export function laneList(spec: string): number[] {
  const lanes = spec.split(",").flatMap((token) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
    const from = Number(match?.[1]);
    const to = Number(match?.[2] ?? match?.[1]);
    if (match === null || from < 1 || to > ANGLE_COUNT || from > to) {
      throw new Error(`--lanes takes lane numbers 1-${ANGLE_COUNT} and ranges such as 1-4,7; got "${token}"`);
    }
    return Array.from({ length: to - from + 1 }, (_, at) => from + at);
  });
  return [...new Set(lanes)].sort((a, b) => a - b);
}

/** The readings `--readings` names, or the default: per-run alone for one run, per-run and
 *  multi-run for several. */
function readingList(spec: string | null, runs: number): Reading[] {
  if (spec === null) return runs > 1 ? ["per-run", "multi-run"] : ["per-run"];
  return spec.split(",").map((name) => {
    const reading = READINGS.find((row) => row === name.trim());
    if (reading === undefined) throw new Error(`--readings takes ${READINGS.join(", ")}; got "${name}"`);
    if (reading !== "per-run" && runs < 2) {
      throw new Error(`${reading} reads several runs; this investigation has one`);
    }
    return reading;
  });
}

/** The lanes one run reads: those named, those its tier and triggers suggest, or every lane. */
function selectedLanes(state: WriReviewState, options: LanesOptions): number[] {
  if (options.lanes !== null) return laneList(options.lanes);
  if (options.tier === "all") return Array.from({ length: ANGLE_COUNT }, (_, at) => at + 1);
  const overview = readJsonAs<{ digestTriggers?: DigestTrigger[] }>(join(state.reviewDir, OVERVIEW_FILE));
  const triggers = [...(overview.digestTriggers ?? []), ...laneTriggers(state.reviewDir, state.steps)];
  return laneList(laneSuggestions(triggers, state.scope.tier).sessions);
}

function buildManifest(
  state: WriReviewState,
  lanes: readonly number[],
  lanesDir: string,
  shared: string,
): void {
  const result = Bun.spawnSync({
    cmd: [
      BUN,
      "--no-env-file",
      join(SCRIPTS, "build-manifest.ts"),
      "--snapshot",
      join(state.reviewDir, "snapshot"),
      "--worktree",
      state.repo,
      "--out",
      lanesDir,
      "--sessions",
      lanes.join(","),
      "--transport",
      "native",
      "--shared-instructions",
      shared,
      "--run-overview",
      join(state.reviewDir, RUN_OVERVIEW_FILE),
    ],
    stdin: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error(`build-manifest refused ${lanesDir}:\n${result.stderr.toString().trim()}`);
  }
}

/** Build one run's single-lane prompts: the open lanes in `lanes/`, the fired isolated lanes alone
 *  in `lanes-isolated/`. An isolated lane whose trigger did not fire is dropped with its reason. */
function buildRunPrompts(state: WriReviewState, options: LanesOptions, shared: string): string[] {
  if (!existsSync(join(state.reviewDir, RUN_OVERVIEW_FILE))) {
    throw new Error(
      `${state.runId}: no ${RUN_OVERVIEW_FILE}; read the run again so its overview lane writes one`,
    );
  }
  const gate = isolatedLaneGate(loadSnapshot(join(state.reviewDir, "snapshot"), state.repo));
  const lanes = selectedLanes(state, options);
  const isolated = lanes.filter((lane) => gate.get(lane)?.fired === true);
  const notes = lanes.flatMap((lane) => {
    const row = gate.get(lane);
    return row === undefined || row.fired ? [] : [`${state.runId}: lane ${lane} dropped, ${row.reason}`];
  });
  const open = lanes.filter((lane) => !ISOLATED_ANGLES.has(lane));
  for (const [dir, set] of [
    ["lanes", open],
    ["lanes-isolated", isolated],
  ] as const) {
    const lanesDir = join(state.reviewDir, dir);
    // What an earlier build wrote goes; every report under `native-output/` stays.
    for (const name of ["prompts", GROUPS_DIR, "tasks.json", INSTRUCTIONS_FILE]) {
      rmSync(join(lanesDir, name), { recursive: true, force: true });
    }
    if (set.length > 0) buildManifest(state, set, lanesDir, shared);
  }
  return notes;
}

/** Compose one run's groups over its open and isolated prompts together, each group from the
 *  directory that holds its lanes, and write them under that directory's `groups/`. */
function composeRunGroups(state: WriReviewState, options: LanesOptions, shared: string): ComposedGroup[] {
  const dirs = LANE_DIRS.map((dir) => join(state.reviewDir, dir)).map((dir) => ({
    dir,
    available: availableLanes(join(dir, "prompts")),
  }));
  const plan = planGroups(loadLaneGroups(), new Set(dirs.flatMap((row) => [...row.available])), options.size);
  const out: ComposedGroup[] = [];
  for (const { dir, available } of dirs) {
    const composed = plan
      .filter((group) => group.lanes.every((lane) => available.has(lane)))
      .map((group) => {
        const { name, text, blind } = composeLanes(dir, group.lanes, options.remoteHost);
        const problems = checkComposed(text, group.lanes, { blind, shared });
        return {
          ...group,
          name,
          text,
          problems: problems.map((problem) => `${state.runId} ${name}: ${problem}`),
        };
      });
    if (composed.length > 0) writeGroups(join(dir, GROUPS_DIR), composed);
    out.push(...composed);
  }
  return out;
}

/** Remove a reading's earlier groups and their prompts, keeping any report already written. */
function clearReading(outDir: string): void {
  const groupsPath = join(outDir, GROUPS_FILE);
  if (!existsSync(groupsPath)) return;
  for (const row of readJsonAs<{ session: string }[]>(groupsPath)) {
    rmSync(join(outDir, `${row.session}.md`), { force: true });
  }
  rmSync(groupsPath);
}

function composeAcross(
  out: string,
  reading: AcrossRuns,
  options: LanesOptions,
  shared: string,
): ComposedGroup[] {
  const record = loadInvestigation(out);
  const runs = record.runs.map((run) => readRun(run.review));
  if (reading === "cross-run") {
    const unread = runs.filter((run) => run.snapshot && run.reports.size === 0).map((run) => run.id);
    if (unread.length > 0) {
      throw new Error(`cross-run reads the per-run reports as leads, and ${unread.join(", ")} has none yet`);
    }
  }
  const groups = loadLaneGroups();
  const available = new Set(
    runs.flatMap((run) => [...run.available]).filter((lane) => !groups.alone.has(lane)),
  );
  const size: GroupSize =
    "components" in options.size
      ? { components: Math.floor(options.size.components / Math.max(1, runs.length)) }
      : options.size;
  const outDir = join(out, reading);
  clearReading(outDir);
  // The multi-run reading is independent of every other reading, so it reconciles with no prior one.
  const prior = reading === "cross-run" && options.prior !== null ? [options.prior] : [];
  const preamble = runsPreamble(runs, prior, reading);
  const composed = planGroups(groups, available, size).map((group) => {
    const composedRun = composeRuns(runs, group.lanes, {
      outDir,
      preamble,
      remoteHost: options.remoteHost,
      reading,
    });
    const problems = checkComposed(composedRun.text, group.lanes, { shared });
    return {
      ...group,
      ...composedRun,
      problems: problems.map((problem) => `${reading} ${composedRun.name}: ${problem}`),
    };
  });
  writeGroups(
    outDir,
    composed,
    runs.map((run) => run.id),
  );
  return composed;
}

/**
 * Build every snapshot run's lane prompts, compose the readings asked for, refuse when any group
 * lost the shared instructions, and write `launch.md`. Per-run and multi-run build the per-run
 * prompts first; cross-run composes over the per-run reports already written and builds none.
 */
export function buildLanes(out: string, options: LanesOptions) {
  const record = loadInvestigation(out);
  const sharedPath = join(out, SHARED_INSTRUCTIONS_FILE);
  const shared = readSharedInstructions(sharedPath);
  const launchPath = join(out, "launch.md");
  rmSync(launchPath, { force: true });
  const readings = readingList(options.readings, record.runs.length);
  const states = record.runs.map((run) => readJsonAs<WriReviewState>(join(run.review, REVIEW_STATE_FILE)));
  const notes: string[] = [];
  const composed: ComposedGroup[] = [];
  if (readings.some((reading) => reading !== "cross-run")) {
    for (const state of states) {
      if (!existsSync(join(state.reviewDir, "snapshot", SNAPSHOT_STATUS_FILE))) {
        notes.push(`${state.runId}: no snapshot (${state.scope.tier} tier), so no per-run lanes`);
        continue;
      }
      // The per-run groups are composed whenever their prompts are rebuilt, so `collect` always
      // indexes the per-run reports against the prompts on disk; launch.md lists only the readings asked.
      notes.push(...buildRunPrompts(state, options, sharedPath));
      composed.push(...composeRunGroups(state, options, shared));
    }
  }
  for (const reading of ["cross-run", "multi-run"] as const) {
    if (readings.includes(reading)) composed.push(...composeAcross(out, reading, options, shared));
  }
  const problems = composed.flatMap((group) => group.problems);
  if (problems.length > 0) throw new Error(`refused, no launch.md written:\n${problems.join("\n")}`);
  writeFileSync(launchPath, renderLaunch(out, agentRows(out, readings)));
  return { launch: launchPath, notes };
}

// ---- launch.md and collect ------------------------------------------------------------------

function groupsAt(path: string): { session: string; lanes: number[] }[] {
  return existsSync(path) ? readJsonAs<{ session: string; lanes: number[] }[]>(path) : [];
}

/** Every agent the composed readings on disk expect, in reading order. */
function agentRows(out: string, readings: readonly Reading[]): AgentRow[] {
  const record = loadInvestigation(out);
  const perRun = record.runs.flatMap((run) =>
    LANE_DIRS.map((sub) => join(run.review, sub)).flatMap((dir) =>
      groupsAt(join(dir, GROUPS_DIR, GROUPS_FILE)).map(
        (group): AgentRow => ({
          reading: "per-run",
          run: run.runId,
          name: group.session,
          lanes: group.lanes,
          prompt: join(dir, GROUPS_DIR, `${group.session}.md`),
          reports: group.lanes.map((lane) => join(dir, NATIVE_OUTPUT, `${sessionName([lane])}.md`)),
        }),
      ),
    ),
  );
  const rows: AgentRow[] = readings.includes("per-run") ? perRun : [];
  for (const reading of ["cross-run", "multi-run"] as const) {
    if (!readings.includes(reading)) continue;
    const dir = join(out, reading);
    for (const group of groupsAt(join(dir, GROUPS_FILE))) {
      rows.push({
        reading,
        run: null,
        name: group.session,
        lanes: group.lanes,
        prompt: join(dir, `${group.session}.md`),
        reports: [join(dir, NATIVE_OUTPUT, `${group.session}.md`)],
      });
    }
  }
  return rows;
}

/** The exact one-line prompt an agent is launched with: no quote or backslash, so its transcript
 *  records it byte for byte and the model check below finds it. */
export function agentPrompt(prompt: string): string {
  return `Read ${prompt} whole and do exactly what it says; it is your whole task.`;
}

/** The command that prints the model each transcript holding this prompt ran on. */
export function modelCheck(prompt: string): string {
  return `grep -lF '"content":"${agentPrompt(prompt)}"' ~/.claude*/projects/*/*/subagents/agent-*.jsonl | xargs -r grep -ho '"model":"[^"]*"' | sort | uniq -c`;
}

function renderLaunch(out: string, rows: readonly AgentRow[]): string {
  const lines = [
    `# Launch: ${out}`,
    "",
    `${rows.length} agents. Launch one subagent per entry, on the model the operator chose, giving it exactly`,
    "its one-line prompt. When it finishes, run its model check: it prints the model its transcript",
    `recorded. Then run \`bun ${join(SCRIPTS, "wri.ts")} collect --out ${out}\`.`,
  ];
  rows.forEach((row, index) => {
    lines.push(
      "",
      `## ${index + 1}. ${row.reading}${row.run === null ? "" : ` ${row.run}`}: ${row.name} (lanes ${row.lanes.join(", ")})`,
      "",
      `- prompt: \`${row.prompt}\``,
      ...row.reports.map((report) => `- report: \`${report}\``),
      "",
      "```text",
      agentPrompt(row.prompt),
      "```",
      "",
      "```sh",
      modelCheck(row.prompt),
      "```",
    );
  });
  return `${lines.join("\n")}\n`;
}

/** Each agent's reports as the validator judges them: a per-run agent's lanes against its run's
 *  tasks.json, rolled up to the agent, and a group across runs against its groups.json. Each file
 *  is validated once. */
function indexRows(rows: readonly AgentRow[]): IndexRow[] {
  const checked = new Map<string, Map<string, ReportRow>>();
  return rows.map((row) => {
    const perRun = row.reading === "per-run";
    const path = perRun
      ? join(dirname(dirname(row.prompt)), "tasks.json")
      : join(dirname(row.prompt), GROUPS_FILE);
    let reports = checked.get(path);
    try {
      if (reports === undefined) {
        const validated = perRun
          ? validate({ tasksPath: path, summaryPath: null, outPath: "" })
          : validateGroups(path);
        reports = new Map(validated.rows.map((report) => [report.name, report]));
        checked.set(path, reports);
      }
    } catch (error) {
      return { ...row, status: "invalid", issues: [`${path}: ${errorMessage(error)}`] };
    }
    const names = perRun ? row.lanes.map((lane) => sessionName([lane])) : [row.name];
    const own = names.flatMap((name) => reports.get(name) ?? []);
    const issues = own.flatMap((report) => report.issues.map((issue) => `${report.name}: ${issue}`));
    let status: IndexRow["status"] = "invalid";
    if (own.length === names.length && issues.length === 0) status = "ok";
    else if (own.every((report) => report.reportPath === null)) status = "missing";
    return { ...row, status, issues };
  });
}

function renderIndex(out: string, rows: readonly IndexRow[]): string {
  const lines = [`# Reports: ${out}`, ""];
  for (const reading of READINGS) {
    const own = rows.filter((row) => row.reading === reading);
    if (own.length === 0) continue;
    lines.push(
      `## ${reading}`,
      "",
      "| agent | run | lanes | status | report |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const row of own) {
      const reports = row.reports.map((path) => `\`${path.replaceAll("|", String.raw`\|`)}\``).join("<br>");
      lines.push(
        `| ${row.name} | ${row.run ?? "all"} | ${row.lanes.join(", ")} | ${row.status} | ${reports} |`,
      );
    }
    const flawed = own.filter((row) => row.status === "invalid");
    if (flawed.length > 0) {
      lines.push(
        "",
        "Invalid:",
        ...flawed.flatMap((row) => row.issues.map((issue) => `- ${row.name}: ${issue}`)),
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Validate every report the composed readings expect and write `reports.md`; per reading, how
 *  many agents reported ok, and whether it is complete. */
export function collectReports(out: string) {
  const indexed = indexRows(agentRows(out, READINGS));
  const index = join(out, "reports.md");
  writeFileSync(index, renderIndex(out, indexed));
  const readings = READINGS.flatMap((reading) => {
    const own = indexed.filter((row) => row.reading === reading);
    return own.length === 0
      ? []
      : [{ reading, ok: own.filter((row) => row.status === "ok").length, of: own.length }];
  });
  return { index, readings };
}

// ---- synthesis ------------------------------------------------------------------------------

/** Render the synthesis prompt from the template, the shared instructions and a fresh index. */
export function renderSynthesis(out: string, template: string | null) {
  const { index, readings } = collectReports(out);
  const path = template ?? SYNTHESIS_TEMPLATE;
  if (!existsSync(path)) throw new Error(`no synthesis template at ${path}`);
  const values = new Map([
    ["out", out],
    ["synthesis", join(out, "synthesis.md")],
    [
      "reports",
      readFileSync(index, "utf8")
        .replace(/^# .*\n+/, "")
        .trim(),
    ],
    ["sharedInstructions", readSharedInstructions(join(out, SHARED_INSTRUCTIONS_FILE))],
  ]);
  const text = readFileSync(path, "utf8")
    .replaceAll(/<!--[\s\S]*?-->\n?/g, "")
    .replaceAll(
      /\{(out|synthesis|reports|sharedInstructions)\}/g,
      (_, name: string) => values.get(name) ?? "",
    );
  const prompt = join(out, "synthesis-prompt.md");
  mkdirSync(out, { recursive: true });
  writeFileSync(prompt, `${text.trim()}\n`);
  return {
    prompt,
    incomplete: readings
      .filter((row) => row.ok < row.of)
      .map((row) => `${row.reading} ${row.ok}/${row.of} ok`),
  };
}

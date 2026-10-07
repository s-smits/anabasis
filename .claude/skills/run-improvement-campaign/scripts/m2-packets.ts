#!/usr/bin/env bun

/**
 * M2's packet step: one blind evidence packet per verified fail of the named batteries, the cases
 * the outcome join (`climb-outcome.ts`) reads, for the tool-less reader in `m2-read.ts` to label as
 * a limit, a check defect, an under-specified task, a wall-ended solve or unclassified.
 *
 * A packet is the case as a practitioner would need it and nothing that says whose run it was: the
 * public task with its published validity rules, the domain's public resources, the accepted
 * answer, every applicable check with its published assertion, and, for each check that did not
 * pass, the tool runs under it with their provenance, exit code and stderr tail, or `"none"` where
 * no side has any, and how the solve ended (whether the solver handed the answer in itself, and the
 * wall it ended on). The recorded rows
 * are the primary evidence. The replay corroborates them: the case's own program, recovered by
 * recomputing its fingerprint rather than trusted by path, is copied outside `campaigns/` and the
 * answer is graded again through the replay core (`tools/replay/cli.ts`), so no Builder-written
 * check ever runs inside a campaign. Run ids, campaign slugs, source shas, model names, absolute
 * paths and timestamps are removed, so two arms' packets for the same case are the same bytes.
 *
 * The reader labels every case that has a packet, `wall-ended` included: whether a wall's draft
 * failed because the time ran out or because it is wrong is a judgement the solve-end facts inform
 * and do not decide. The record decides one label alone: a case no packet can be built for (no
 * program, task or answer) is `unclassified`, so a reader counting labels sees it rather than
 * losing it.
 *
 * Each case is keyed by `caseKey` over the real campaign directory, the battery run id and the task
 * id, the key the outcome join reads, so this file never needs the key back from the reader. The
 * campaign's `KEEP-RUN-DATA` marker, which holds the host's retention sweep off its tool trees and
 * snapshots, stays: a replay may have to run again, so the marker goes once the comparison is read.
 *
 *   bun m2-packets.ts --battery <abs campaign dir>/<runId> [--battery …] --out <abs dir> [--stage <abs dir>]
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { gitOutput } from "../../main/git.ts";
import { buildWalls } from "../../whole-run-investigation/scripts/walls.ts";
import { caseKey } from "./climb-outcome.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { stableJson } from "#src/meta/stable-json.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { IrregularBundleEntryError, hashBundle } from "#src/claim/bundle-hash.ts";
import { BATTERY_FILES, batteryHash } from "#src/claim/fingerprint.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
  bundleSnapshotIdOf,
} from "#src/claim/bundle-snapshot.ts";
import { classifyCaseOutcome } from "#src/claim/case-record.ts";
import { recordedEvidence, verifyRunDir } from "#src/claim/evidence-log.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { readRecordedBatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import { type Brief, applicableTruthChecks } from "#src/correctness-bundle/brief.ts";
import { briefPublicResources, judgePublicTaskOf } from "#src/correctness-bundle/public-resources.ts";
import type { BuildTask } from "#src/correctness-bundle/tasks.ts";
import type { FinalSubmission } from "#src/solve/final-submission.ts";
import type { CheckRun, CorrectnessModelResult } from "#src/verify/correctness-model-result.ts";
import { type ReplayToolRun, loadContract, replayCases } from "#tools/replay/cli.ts";

/** Where a case's program may be: a directory holding `agent/` and `correctness-model/` (a bundle
 *  snapshot or a retained version), or a workspace's own git store, optionally narrowed to commits. */
export type ProgramSource =
  | { kind: "dir"; dir: string }
  | { kind: "git"; gitDir: string; commits?: readonly string[] };

type CheckOutcome = CheckRun["outcome"];

/** The per-check result the record holds: an outcome per check id, or null when the case recorded
 *  none, and the tool runs under the checks. */
export interface RecordedChecks {
  outcomes: Readonly<Record<string, CheckOutcome>> | null;
  toolRuns: readonly ReplayToolRun[];
}

/** How the solve of a verified fail ended, as far as the record says. */
export interface SolveEnd {
  /** Whether the solver called `submit` itself; null when no trace could be read. */
  solverSubmitted: boolean | null;
  /** The walls reader's bound for the case (`time-bound`, `submitted`, …); null when unread. */
  wallBound: string | null;
  wallShare: number | null;
}

/** Everything one case's packet and key are built from. The identity strings are here only so the
 *  packet can be scrubbed of them; none is rendered. */
export interface M2Case {
  campaignDir: string;
  /** The battery run id, or for a calibration rehearsal its locator under the campaign. */
  locator: string;
  taskId: string;
  programId: string;
  programSources: readonly ProgramSource[];
  final: FinalSubmission | null;
  publicTaskDigest: string | null;
  recorded: RecordedChecks;
  solveEnd: SolveEnd;
  identity: readonly string[];
}

/** The replayed side of one case. */
export interface CaseReplay {
  verdict: "pass" | "fail" | "non-result";
  nonResultKind: string | null;
  checkRuns: readonly CheckRun[];
  toolRuns: readonly ReplayToolRun[];
  missingTools: readonly string[];
}

export interface PacketInput {
  brief: Brief;
  task: BuildTask;
  answer: JsonValue | null;
  recorded: RecordedChecks;
  replay: CaseReplay | null;
  solveEnd: SolveEnd;
  identity: readonly string[];
}

/** One row of `m2-cases.jsonl`: the case's key and where its packet is, null when none could be
 *  built, which labels the case `unclassified`. No reader sees this row. */
export interface CaseRow {
  caseKey: string;
  packet: string | null;
  why: string;
  replay: { verdict: CaseReplay["verdict"]; nonResultKind: string | null; missingTools: number } | null;
}

/** One case's row, its packet, and the replay behind both. */
export interface CaseResult {
  row: CaseRow;
  packet: string | null;
  replay: CaseReplay | null;
}

export const PACKET_SCHEMA = "m2-packet/v1";
const SUBMIT_TOOL = "submit";
const REDACTED = "<id>";
/** Model and arm names, in the spellings runs, worktrees and campaign slugs use. */
const MODEL_NAME =
  /\b(?:claude|gpt|codex|gemini)-[\w.-]+|\b(?:opus|sonnet|haiku|fable|astra|luna|sol)(?:hmm|xhh|[-\d.]+\w*)?\b/gi;
const ABSOLUTE_PATH = /(?<![\w.@+-])(?:\/[\w.@+-]+)+\/(?=[\w.@+-])/g;
const TIMESTAMP = /\b\d{4}-?\d{2}-?\d{2}T\d{2}:?\d{2}:?\d{2}(?:[.:]?\d+)?Z?\b/g;
const LONG_HEX = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi;
/** The parts of a run id that name a source commit or a launch time. */
const RUN_ID_PART = /^(?:[0-9a-f]{6,}|\d{8}T\d+Z)$/;

const USAGE = `usage: m2-packets.ts --battery <abs campaign dir>/<runId> [--battery …] --out <abs dir> [--stage <abs dir>]

Builds one blind packet per verified fail of each battery, replays each answer
under its own program staged outside campaigns/, writes <out>/packets/<caseKey>.json and
<out>/m2-cases.jsonl.`;

// --- Program recovery ---------------------------------------------------------------------------

/** The bundle snapshot id a directory's bytes fingerprint to, or null when it is no clean bundle. */
export function programIdOf(dir: string): string | null {
  const [agentDir, modelDir] = [join(dir, "agent"), join(dir, "correctness-model")];
  if (!existsSync(agentDir) || !existsSync(modelDir)) return null;
  try {
    return bundleSnapshotIdOf({
      agentHash: hashBundle(agentDir).hash,
      correctnessModelHash: hashBundle(modelDir, { excludeTop: [...BATTERY_FILES] }).hash,
      taskSetHash: batteryHash(modelDir),
    });
  } catch (error) {
    if (error instanceof IrregularBundleEntryError) return null;
    throw error;
  }
}

/** Copy one commit's two bundles out of a git store into `into`, with git run from `stageRoot`. */
function archiveCommit(gitDir: string, commit: string, stageRoot: string, into: string): void {
  const tar = join(stageRoot, `${commit}.tar`);
  gitOutput(
    stageRoot,
    `--git-dir=${gitDir}`,
    "archive",
    "--format=tar",
    "-o",
    tar,
    commit,
    "agent",
    "correctness-model",
  );
  mkdirSync(into, { recursive: true });
  runTextSyncOrThrow([hostTool("tar"), "-xf", tar, "-C", into]);
  rmSync(tar, { force: true });
}

/** Commits of a git store, newest first, keeping one per distinct pair of bundle trees. */
function distinctCommits(stageRoot: string, gitDir: string): string[] {
  const git = (...args: string[]) => gitOutput(stageRoot, `--git-dir=${gitDir}`, ...args);
  const seen = new Map<string, string>();
  for (const commit of git("rev-list", "--all").split("\n")) {
    const trees = commit === "" ? "" : git("ls-tree", commit, "agent", "correctness-model").trim();
    if (trees !== "" && !seen.has(trees)) seen.set(trees, commit);
  }
  return [...seen.values()];
}

function stageFromSource(
  source: ProgramSource,
  programId: string,
  stageRoot: string,
  staged: string,
): boolean {
  if (source.kind === "dir") {
    if (programIdOf(source.dir) !== programId) return false;
    for (const part of ["agent", "correctness-model"]) {
      cpSync(join(source.dir, part), join(staged, part), { recursive: true, verbatimSymlinks: true });
    }
    return programIdOf(staged) === programId;
  }
  for (const commit of source.commits ?? distinctCommits(stageRoot, source.gitDir)) {
    const trial = mkdtempSync(join(stageRoot, "commit-"));
    try {
      archiveCommit(source.gitDir, commit, stageRoot, trial);
    } catch {
      rmSync(trial, { recursive: true, force: true });
      continue;
    }
    if (programIdOf(trial) === programId) {
      renameSync(trial, staged);
      return true;
    }
    rmSync(trial, { recursive: true, force: true });
  }
  return false;
}

/** Stage the program `programId` names under `stageRoot`, from the first source whose bytes
 *  fingerprint to it, and return the staged directory, or null when no source holds those bytes.
 *  The staged copy is fingerprinted again, so what grades is exactly what was recorded. */
export function stageProgram(
  programId: string,
  sources: readonly ProgramSource[],
  stageRoot: string,
): string | null {
  const staged = join(stageRoot, programId);
  if (programIdOf(staged) === programId) return staged;
  mkdirSync(stageRoot, { recursive: true });
  for (const source of sources) {
    rmSync(staged, { recursive: true, force: true });
    if (stageFromSource(source, programId, stageRoot, staged)) return staged;
  }
  rmSync(staged, { recursive: true, force: true });
  return null;
}

// --- Replay -------------------------------------------------------------------------------------

/** Grade the case's accepted answer again under its staged program; null without an answer. */
export async function replayStaged(staged: string, one: M2Case): Promise<CaseReplay | null> {
  if (one.final === null || one.publicTaskDigest === null) return null;
  const replayed = await replayCases({ candidateDir: staged, runId: "m2-replay" }, [
    { taskId: one.taskId, publicTaskDigest: one.publicTaskDigest, finalSubmission: one.final },
  ]);
  const row = replayed.rows[0];
  if (row === undefined) return null;
  const verdict = row.truthOk === null ? "non-result" : row.pass === true ? "pass" : "fail";
  return {
    verdict,
    nonResultKind: row.nonResultKind,
    checkRuns: row.checkRuns ?? [],
    toolRuns: row.toolRuns ?? [],
    missingTools: replayed.missingTools,
  };
}

// --- Packet -------------------------------------------------------------------------------------

/** Remove what could name a run, an arm or a source from one piece of tool output. */
export function redactText(text: string): string {
  return text
    .replaceAll(ABSOLUTE_PATH, "…/")
    .replaceAll(TIMESTAMP, "<time>")
    .replaceAll(LONG_HEX, "<hex>")
    .replaceAll(MODEL_NAME, "<model>");
}

function provenanceOf(run: ReplayToolRun): string {
  if (run.toolSource === "cell") return "a program built from the answer inside this check";
  if (run.toolSource === "host") return "a tool installed on the grading host";
  if (run.toolSource !== "workspace-toolchain") return "no tool resolved";
  return run.toolKind === "script"
    ? "a script the harness author wrote into its own tool tree (a stand-in)"
    : "a tool the harness author installed";
}

/** How a replayed tool's bytes compare with the recorded runs of the same tool. */
function instrumentOf(run: ReplayToolRun, recorded: readonly ReplayToolRun[]): string | undefined {
  const sameTool = recorded.filter((other) => other.toolId === run.toolId && other.toolDigest !== null);
  if (run.toolDigest === null) return undefined;
  if (sameTool.length === 0) return "no recorded run of this tool";
  return sameTool.some((other) => other.toolDigest === run.toolDigest)
    ? "the same bytes as the recorded run"
    : "different bytes from the recorded run";
}

function toolRow(graded: "recorded" | "replayed", run: ReplayToolRun, recorded: readonly ReplayToolRun[]) {
  const instrument = graded === "recorded" ? undefined : instrumentOf(run, recorded);
  return {
    graded,
    tool: run.toolId,
    provenance: provenanceOf(run),
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    outcome: run.outcome,
    stderrTail: redactText(run.stderrTail),
    ...keyIfDefined("instrument", instrument),
  };
}

/** A check's recorded and replayed outcome, and whether it passed: a side never recorded,
 *  replayed or run says nothing, and every other side must pass. */
function sidesOf(checkId: string, { recorded, replay }: PacketInput) {
  const replayed = replay?.checkRuns.find((run) => run.checkId === checkId)?.outcome ?? "no result";
  const sides = {
    recorded: recorded.outcomes === null ? null : (recorded.outcomes[checkId] ?? "no result"),
    replayed: replay === null ? null : replayed,
  };
  const present = Object.values(sides).filter((side) => side !== null && side !== "not-run");
  return {
    recorded: sides.recorded ?? "unrecorded",
    replayed: sides.replayed ?? "not replayed",
    passed: present.length > 0 && present.every((side) => side === "pass"),
  };
}

/** One check's row: its published assertion, the recorded and replayed outcome, and the tool runs
 *  of a check that did not pass on both sides, `"none"` when no side has one. */
function checkRow(check: Brief["truthChecks"][number], input: PacketInput) {
  const { passed, ...outcomes } = sidesOf(check.id, input);
  const row = { checkId: check.id, assertion: check.assertion, ...outcomes };
  if (passed) return { ...row, toolRuns: [] };
  const own = (runs: readonly ReplayToolRun[]) => runs.filter((run) => run.checkId === check.id);
  const recordedRuns = own(input.recorded.toolRuns);
  const toolRuns = [
    ...recordedRuns.map((run) => toolRow("recorded", run, recordedRuns)),
    ...own(input.replay?.toolRuns ?? []).map((run) => toolRow("replayed", run, recordedRuns)),
  ];
  return { ...row, toolRuns: toolRuns.length === 0 ? "none" : toolRuns };
}

/** The packet's bytes: stable JSON with every identity string replaced. */
export function buildPacket(input: PacketInput): string {
  const { brief, task, answer, replay, solveEnd } = input;
  const { taskId: _taskId, ...publicTask } = judgePublicTaskOf(brief, task);
  const packet = {
    schema: PACKET_SCHEMA,
    domain: {
      domain: brief.domain,
      publicResources: briefPublicResources(brief)
        .filter(({ name }) => name !== "public-validity-rules")
        .map(({ name, content }) => ({ name, content })),
    },
    task: publicTask,
    answer,
    checks: applicableTruthChecks(brief, task).map((check) => checkRow(check, input)),
    replay:
      replay === null
        ? null
        : {
            verdict: replay.verdict,
            nonResultKind: replay.nonResultKind,
            missingTools: [...replay.missingTools],
          },
    solveEnd,
  };
  // Every literal identity string goes, longest first, wherever in the packet it surfaced.
  const literals = input.identity
    .filter((value) => value.length >= 4)
    .toSorted((a, b) => b.length - a.length);
  return `${literals.reduce((text, value) => text.replaceAll(value, REDACTED), stableJson(packet))}\n`;
}

// --- Reading a battery --------------------------------------------------------------------------

function recordedJson<T>(runDir: string, rel: string, violations: ReturnType<typeof verifyRunDir>): T | null {
  const read = recordedEvidence(runDir, rel, violations);
  return read.ok ? parseJsonAs<T>(read.bytes) : null;
}

/** Per-check outcomes from a verifier record: its check rows, or its receipts where it has none. */
export function outcomesOf(result: (Partial<CorrectnessModelResult> & { checkRuns?: CheckRun[] }) | null) {
  if (result === null) return null;
  if (Array.isArray(result.checkRuns) && result.checkRuns.length > 0) {
    return Object.fromEntries(result.checkRuns.map((run) => [run.checkId, run.outcome]));
  }
  if (!Array.isArray(result.checkReceipts) || result.checkReceipts.length === 0) return null;
  return Object.fromEntries(
    result.checkReceipts.map((receipt): [string, CheckOutcome] => [
      receipt.checkId,
      receipt.passed ? "pass" : "fail",
    ]),
  );
}

/** Whether the solver called `submit` itself, from a trace's tool calls; null when unreadable. */
export function solverSubmittedOf(
  trace: { toolCalls?: Array<{ toolName?: string }> } | null,
): boolean | null {
  if (trace === null || !Array.isArray(trace.toolCalls)) return null;
  return trace.toolCalls.some((call) => call.toolName === SUBMIT_TOOL);
}

/** The literal strings that name this case's campaign, run, version and source. */
export function identityOf(realCampaign: string, runId: string, ...more: string[]): string[] {
  const slug = basename(realCampaign);
  return [
    slug,
    slug.replace(/-\d+$/, ""),
    runId,
    ...more,
    ...runId.split("-").filter((part) => RUN_ID_PART.test(part)),
  ];
}

/** Where a battery's program may still be: its bundle snapshot under any trace root, then the
 *  retained version that holds the run. */
function batterySources(campaignDir: string, runDir: string, programId: string): ProgramSource[] {
  const snapshots = campaignTraceRoots(campaignDir).flatMap((root) =>
    [BUNDLE_SNAPSHOT_DIRECTORY, EARLIER_BUNDLE_SNAPSHOT_DIRECTORY].map(
      (directory): ProgramSource => ({ kind: "dir", dir: join(root, directory, programId) }),
    ),
  );
  return [...snapshots, { kind: "dir", dir: dirname(dirname(runDir)) }];
}

/** Every verified fail of one battery, read from its recorded evidence. */
export function batteryCases(campaignDir: string, runId: string): M2Case[] {
  const realCampaign = realpathSync(campaignDir);
  const runDir = campaignTraceRoots(realCampaign)
    .map((root) => join(root, "runs", runId))
    .find((dir) => existsSync(join(dir, "battery.json")));
  if (runDir === undefined) throw new Error(`no recorded battery ${runId} under ${realCampaign}`);
  const battery = readRecordedBatteryRecord(runDir, runId);
  const violations = verifyRunDir(runDir);
  const walls = new Map(
    buildWalls({ campaign: realCampaign, runId }).batteries.flatMap((one) =>
      one.rows.map((row) => [row.taskId, row]),
    ),
  );
  const programId = battery.bundleSnapshot.id;
  const identity = identityOf(realCampaign, runId, basename(dirname(dirname(runDir))));
  return battery.cases.flatMap((row): M2Case[] => {
    if (classifyCaseOutcome(row) !== "fail") return [];
    const prefix = `cases/${row.taskId}`;
    const final = recordedJson<FinalSubmission>(runDir, `${prefix}/final-submission.json`, violations);
    const wall = walls.get(row.taskId);
    return [
      {
        campaignDir: realCampaign,
        locator: runId,
        taskId: row.taskId,
        programId,
        programSources: batterySources(realCampaign, runDir, programId),
        final: final?.accepted === true ? final : null,
        publicTaskDigest:
          recordedJson<{ publicTaskDigest: string }>(runDir, `${prefix}/public-task.json`, violations)
            ?.publicTaskDigest ?? null,
        recorded: {
          outcomes: outcomesOf(recordedJson(runDir, `${prefix}/verifier.json`, violations)),
          toolRuns: battery.executionEvidence.filter((run) => run.subjectId === row.taskId),
        },
        solveEnd: {
          solverSubmitted: solverSubmittedOf(recordedJson(runDir, `${prefix}/trace.json`, violations)),
          wallBound: wall?.bound ?? null,
          wallShare: wall?.timeShare ?? null,
        },
        identity,
      },
    ];
  });
}

// --- One case, end to end -----------------------------------------------------------------------

/** Stage, replay and render one case; the packet is null when the program could not be recovered. */
export async function packetFor(one: M2Case, stageRoot: string): Promise<CaseResult> {
  const staged = stageProgram(one.programId, one.programSources, stageRoot);
  if (staged !== null) return packetFromStaged(one, staged);
  return { row: rowOf(one, null, "program not recoverable", null), packet: null, replay: null };
}

/** The second half of {@link packetFor}, for a caller that adapted the staged copy first. */
export async function packetFromStaged(one: M2Case, staged: string): Promise<CaseResult> {
  const replay = await replayStaged(staged, one);
  const { brief, tasks } = loadContract(staged);
  const task = tasks.find((candidate) => candidate.taskId === one.taskId);
  const artifactJson = one.final?.artifactJson;
  if (task === undefined || artifactJson == null) {
    return { row: rowOf(one, null, "no task or answer to read", replay), packet: null, replay };
  }
  const packet = buildPacket({
    brief,
    task,
    answer: capturedJsonParse(artifactJson),
    recorded: one.recorded,
    replay,
    solveEnd: one.solveEnd,
    identity: one.identity,
  });
  return { row: rowOf(one, `packets/${caseKeyOf(one)}.json`, "read", replay), packet, replay };
}

const caseKeyOf = (one: M2Case) => caseKey(one.campaignDir, one.locator, one.taskId);

function rowOf(one: M2Case, packet: string | null, why: string, replay: CaseReplay | null): CaseRow {
  const summary =
    replay === null
      ? null
      : {
          verdict: replay.verdict,
          nonResultKind: replay.nonResultKind,
          missingTools: replay.missingTools.length,
        };
  return { caseKey: caseKeyOf(one), packet, why, replay: summary };
}

/** Write each case's packet and the case rows, and return the rows. */
export function writePackets(out: string, results: readonly CaseResult[]): CaseRow[] {
  mkdirSync(join(out, "packets"), { recursive: true });
  for (const { row, packet } of results) {
    if (packet !== null && row.packet !== null) writeFileSync(join(out, row.packet), packet);
  }
  const rows = results.map(({ row }) => row);
  writeFileSync(join(out, "m2-cases.jsonl"), rows.map((row) => `${stableJson(row)}\n`).join(""));
  return rows;
}

async function main(args: CommandArgs): Promise<void> {
  const out = args.required("out");
  const stageRoot = args.value("stage") ?? join(out, "stage");
  const byCampaign = Map.groupBy(args.list("battery"), (selector) => dirname(selector));
  if (byCampaign.size === 0) args.die("name at least one --battery");
  const results: CaseResult[] = [];
  for (const [campaignDir, selectors] of byCampaign) {
    for (const selector of selectors) {
      for (const one of batteryCases(campaignDir, basename(selector))) {
        results.push(await packetFor(one, stageRoot));
      }
    }
  }
  const rows = writePackets(out, results);
  const read = rows.filter((row) => row.packet !== null).length;
  console.log(`to read ${read}, unclassified without a packet ${rows.length - read}`);
}

if (import.meta.main) {
  await runCommand(
    { name: "m2-packets.ts", usage: USAGE, options: { battery: "list", out: "abs", stage: "abs" } },
    main,
  );
}

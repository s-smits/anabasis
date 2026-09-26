#!/usr/bin/env bun
// Scaffold the four-file WRI archive from recorded bytes plus one small primary-authored
// `verdicts.json`. Everything a script can derive (identities, digests, terminal accounting, lane
// session rows, safeguard census and firing counts, prediction hashes, pointers) is derived here;
// the primary writes only states, reasons and prose. `main_synthesis.md` is written once as a
// skeleton and never overwritten. Re-running is idempotent for the generated files. `wri.ts`
// calls `scaffoldArchive` with the review dir it laid out: wri-review.json, snapshot/,
// lanes/tasks.json, lanes/luna-output/{launch.json,summary.json,<name>.md}, verdicts.json, archive/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue, OpenRecord } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { canonicalJson, compareCodeUnits } from "#src/meta/stable-json.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { sha256, sha256OfFile } from "#src/meta/digest.ts";
import { gitText } from "#skills/main/git.ts";
import { writeJsonFile } from "#src/meta/completed-json.ts";
import { SAFEGUARD_STDERR_PREFIX, parseSafeguardLog, safeguardLogFile } from "#src/meta/safeguard.ts";
import {
  ADJUDICATED_ROUTES,
  ANCHOR,
  ARCHIVE_SCHEMA,
  DIGEST,
  headingSlug,
  LUNA,
  MAIN,
  MAIN_HEADINGS,
  predictionFrozenHash,
  FROZEN_PREDICTION_FIELDS,
  REVIEW,
  sourceSafeguardCallers,
} from "./archive-shape.ts";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROW_TITLES,
  DETERMINISTIC_ROWS,
  DIGEST_VERDICTS,
} from "./catalogue-shape.ts";

/** A runtime safeguard's retirement record, which an independent review may settle. */
interface Retirement {
  retired: boolean;
  eligibleIterations: number;
  backtrackPreserved: boolean;
  backtrackPointers: Pointer[];
  independentReview?: { reviewed: boolean; reason: string; evidencePointers: Pointer[] };
}

/** The inputs of one runtime safeguard row. */
interface RuntimeSafeguardInput {
  id: string;
  file: string;
  fileSha: string;
  stderrOnly: boolean;
  log: ChannelCounts;
  stderr: ChannelCounts;
  coverage: Coverage;
  independentReview: IndependentReview | undefined;
  route: JsonValue | undefined;
  ptr: Ptr;
  shortIdentity: ShortIdentity;
}

/** Effect evidence per prediction status, in the states `validate-archive.ts` accepts. */
const EFFECT_STATES = new Map([
  ["sufficed", "observed"],
  ["refuted", "not-observed"],
  ["partial", "partial"],
]);
const LANE_STATES = new Map([
  ["completed", "complete"],
  ["failed", "failed"],
  ["not-launched", "inactive"],
]);
/** The primary's verdicts file. A file of another schema is refused, never read around. */
const VERDICTS_SCHEMA = "wri-verdicts/v1";

/** `wri-review.json`, as `wri.ts` lays it out. */
interface ReviewFile {
  campaign: string;
  runId: string;
  repo: string;
  reviewCheckout: string;
}
interface TerminalDenominator {
  state?: string;
  total?: number;
  verified?: number;
  unaccepted?: number;
  nonResults?: number;
  error?: string;
}
/** The controller terminal trace-review read through the strict reader. */
interface RecordedTerminal {
  state?: string;
  epoch?: string;
  outcome?: string;
  reason?: string;
  denominator?: TerminalDenominator;
}
interface TerminalFacts {
  completedRounds?: number;
  outerCap?: number;
  authorCalls?: { budget?: number | "uncapped"; opening?: number; terminal?: number; delta?: number };
  counts?: { raw?: number | null; real?: number | null; controller?: number };
  parents?: { lastCandidate?: JsonValue; adopted?: JsonValue; accepted?: JsonValue };
}
/** `snapshot/snapshot-status.json`, as the collect step writes it. */
interface SnapshotStatus {
  opening: { path: string };
  source: { commit: string; sourceDigest: string };
  facts?: { terminal?: RecordedTerminal; terminalAccounting?: TerminalFacts };
}
interface Evolution {
  versions?: { epoch?: string }[];
  current?: { bundleSnapshotId?: string };
}
interface LaneTask {
  name: string;
  task: string;
  admission?: { mode?: string };
}
interface LaunchFile {
  model?: string;
  reasoningEffort?: string;
  sessions?: { name: string; promptSha256?: string }[];
}
interface SummaryFile {
  sessions?: {
    name: string;
    status?: string;
    failureKind?: string | null;
    threadId?: string | null;
    durationMs?: number | null;
  }[];
}
interface AngleVerdict {
  state?: string;
  reason?: string;
  anchor?: string;
  denominator?: string;
}
interface ExtraSession {
  [key: string]: JsonValue | undefined;
  anchor?: string;
}
interface PredictionVerdict {
  [key: string]: JsonValue | undefined;
  status?: string;
  advisoryReason?: string;
  reason?: string;
  dependencyWalk?: JsonObject;
}
interface IndependentReview {
  reviewed?: boolean;
  reason?: string;
  anchor?: string;
}
interface Reconciliation {
  reason?: string;
  evidence?: JsonValue;
  t0?: boolean;
  t1?: boolean;
}
interface ProposalVerdict {
  [key: string]: JsonValue | undefined;
  disposition?: string;
  anchor?: string;
}
/** `verdicts.json`: the primary's decisions, every field optional until the primary writes it. */
interface Verdicts {
  schema?: string;
  runId?: string;
  identity?: { epoch?: string | null; taskSet?: string | null; bundle?: string | null };
  deterministicRows?: Record<string, string>;
  digestVerdicts?: Record<string, string>;
  angles?: Record<string, AngleVerdict>;
  extraSessions?: ExtraSession[];
  predictions?: PredictionVerdict[];
  safeguards?: {
    stderrLog?: string | null;
    stderrOnlyIds?: string[];
    reconciliation?: Reconciliation | null;
    independentReviews?: Record<string, IndependentReview>;
    routes?: Record<string, JsonValue>;
  };
  terminal?: { reason?: string; capabilityResult?: string };
  terminalAccounting?: {
    completedRounds?: number;
    candidateSubmits?: number | null;
    recordedSubmitRows?: number | null;
    controllerTerminalRows?: number | null;
  };
  primaryReview?: { assertion?: string; protectedEvidenceChecked?: boolean };
  learningHandoff?: {
    hypotheses?: JsonValue[];
    rivalSets?: JsonValue[];
    experimentProposals?: ProposalVerdict[];
  };
  launchIdentityReason?: string;
}
type Inputs = ReturnType<typeof loadInputs>;
type LaneRow = ReturnType<typeof laneRows>[number];
type Identity = ReturnType<typeof identityOf>;
type ShortIdentity = Pick<Identity, "runId" | "sourceRevision" | "epoch" | "bundle" | "taskSet">;
/** One evidence pointer into an archive file. */
interface Pointer {
  path: string;
  anchor: JsonValue;
  sha256: string | undefined;
}
type Ptr = (anchor: JsonValue, path?: string) => Pointer;
interface Coverage {
  complete: boolean;
  t0: boolean;
  t1: boolean;
}
/** What one channel of safeguard log text counted. */
interface ChannelCounts {
  path: string | null;
  sha256: string | null;
  counts: ReadonlyMap<string, number>;
  malformed: number;
}
/** What `scaffoldArchive` wrote. */
export interface ScaffoldResult {
  archiveDir: string;
  verdictsPath: string;
  fresh: boolean;
  lanes: number;
  mainSkeleton: boolean;
}

/** A JSON file one of this review's own steps wrote, read under the contract it is written with;
 *  null when absent. A parse failure names the path, as `readJsonFile` does. */
function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  try {
    return parseJsonAs<T>(text);
  } catch (error) {
    throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
  }
}
/** The verdicts template: every state starts inconclusive so validation fails until the primary decides. */
function verdictsTemplate(runId: string, laneNames: readonly string[]): Verdicts {
  const angles: Record<string, AngleVerdict> = {};
  for (const name of laneNames) {
    if (/^lane_\d{2}$/.test(name)) {
      angles[Number(name.slice(5))] = {
        state: "inconclusive",
        reason: "lane report not yet adjudicated",
        anchor: "#findings",
      };
    }
  }
  return {
    schema: VERDICTS_SCHEMA,
    runId,
    identity: { epoch: null, taskSet: null, bundle: null },
    deterministicRows: Object.fromEntries(DETERMINISTIC_ROWS.map((id) => [id, "inconclusive"])),
    digestVerdicts: Object.fromEntries(DIGEST_VERDICTS.map((id) => [id, "inconclusive"])),
    angles,
    extraSessions: [],
    predictions: [],
    safeguards: { stderrLog: null, stderrOnlyIds: [], reconciliation: null, independentReviews: {} },
    terminal: { reason: "", capabilityResult: "inconclusive" },
    terminalAccounting: { candidateSubmits: null, recordedSubmitRows: null, controllerTerminalRows: null },
    primaryReview: { assertion: "", protectedEvidenceChecked: false },
    learningHandoff: { hypotheses: [], rivalSets: [], experimentProposals: [] },
    launchIdentityReason:
      "Ordinary launcher log plus recorded opening and terminal are joined; no canonical ticket or receipt chain exists for this launch and none was invented.",
  };
}

function loadInputs(reviewDir: string) {
  const review = readJson<ReviewFile>(join(reviewDir, "wri-review.json"));
  if (review === null) throw new Error(`no wri-review.json under ${reviewDir}`);
  const snapshotDir = join(reviewDir, "snapshot");
  const status = readJson<SnapshotStatus>(join(snapshotDir, "snapshot-status.json"));
  if (status === null) throw new Error("snapshot-status.json is missing; run collect first");
  const controllerDir = dirname(status.opening.path);
  const lanesDir = join(reviewDir, "lanes");
  const outputDir = join(lanesDir, "luna-output");
  return {
    reviewDir,
    snapshotDir,
    controllerDir,
    lanesDir,
    outputDir,
    campaign: review.campaign,
    runId: review.runId,
    repo: review.repo,
    reviewCheckout: review.reviewCheckout,
    status,
    // trace-review read the terminal through the controller's strict reader; a run it could not
    // stand behind is live or refused, and the archive records no terminal for it.
    terminal: status.facts?.terminal?.state === "recorded" ? status.facts.terminal : null,
    evolution: readJson<Evolution>(join(snapshotDir, "harness-evolution.json")),
    overview: readJson<JsonValue>(join(reviewDir, "overview.json")),
    tasks: readJson<LaneTask[]>(join(lanesDir, "tasks.json")) ?? [],
    launch: readJson<LaunchFile>(join(outputDir, "launch.json")),
    summary: readJson<SummaryFile>(join(outputDir, "summary.json")),
  };
}

function laneRows(inputs: Inputs) {
  const results = new Map((inputs.summary?.sessions ?? []).map((row) => [row.name, row]));
  const prompts = new Map((inputs.launch?.sessions ?? []).map((row) => [row.name, row.promptSha256]));
  return inputs.tasks.map((task) => {
    const result = results.get(task.name) ?? null;
    const reportPath = join(inputs.outputDir, `${task.name}.md`);
    const angles = (/^assignedLanes:\s*(.+)$/m.exec(task.task)?.[1] ?? "").split(",").flatMap((value) => {
      const trimmed = value.trim();
      return trimmed === "" ? [] : [trimmed];
    });
    return {
      name: task.name,
      angles,
      mode: task.admission?.mode ?? "targeted",
      status: result?.status ?? "not-launched",
      failureKind: result?.failureKind ?? null,
      threadId: result?.threadId ?? null,
      durationMs: result?.durationMs ?? null,
      promptSha256: prompts.get(task.name) ?? null,
      reportSha256: existsSync(reportPath) ? sha256OfFile(reportPath) : null,
      reportPath,
    };
  });
}

function collectionTable(lanes: readonly LaneRow[], inputs: Inputs): string[] {
  const lines = [
    "## Collection",
    "",
    `Launch: \`${inputs.launch ? join(inputs.outputDir, "launch.json") : "absent"}\`; model ${inputs.launch?.model ?? "unknown"} at ${inputs.launch?.reasoningEffort ?? "unknown"}; tasks \`${join(inputs.lanesDir, "tasks.json")}\`.`,
    "",
    "| session | angles | status | thread | duration s | report sha256 |",
    "|---|---|---|---|---|---|",
  ];
  for (const lane of lanes) {
    lines.push(
      `| ${lane.name} | ${lane.angles.join(", ") || "-"} | ${lane.status}${lane.failureKind !== null && lane.failureKind !== "" ? ` (${lane.failureKind})` : ""} | ${lane.threadId ?? "-"} | ${lane.durationMs === null ? "-" : Math.round(lane.durationMs / 1000)} | ${lane.reportSha256 ?? "-"} |`,
    );
  }
  return lines;
}

/** luna_syntheses.md: the collection table, then every lane report verbatim under its own heading. */
function lunaSyntheses(lanes: readonly LaneRow[], inputs: Inputs): string {
  const lines = [
    `# Luna syntheses — ${inputs.runId}`,
    "",
    ...collectionTable(lanes, inputs),
    "",
    "## Reports",
    "",
  ];
  for (const lane of lanes) {
    lines.push(`## ${lane.name}`, "");
    if (!existsSync(lane.reportPath)) {
      lines.push(`No report was written (status ${lane.status}).`, "");
      continue;
    }
    const body = readFileSync(lane.reportPath, "utf8")
      .trim()
      .replace(/^#{1,6}\s+(.*)$/gm, (line: string, text: string) =>
        line.startsWith("## ") && text.trim() === lane.name ? "" : `### ${text}`,
      );
    // Lane reports carry Markdown line-break spaces; the archive copy drops them so the documentation diff check accepts it.
    lines.push(body.trim().replace(/[ \t]+$/gm, ""), "");
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function mainSkeleton(inputs: Inputs): string {
  const short = String(inputs.status.source.commit).slice(0, 9);
  const lines = [
    `# Whole-run investigation — ${inputs.runId}`,
    "",
    `Measured source ${inputs.status.source.commit} (${short}). Fill every section; the archive validator reads these headings.`,
    "",
  ];
  for (const heading of MAIN_HEADINGS) lines.push(heading, "", "TODO", "");
  return lines.join("\n");
}

function identityOf(inputs: Inputs, verdicts: Verdicts) {
  const source = inputs.status.source;
  const versions = Array.isArray(inputs.evolution?.versions) ? inputs.evolution.versions : [];
  const epoch = verdicts.identity?.epoch ?? versions.at(-1)?.epoch ?? inputs.terminal?.epoch ?? "unresolved";
  const bundle = verdicts.identity?.bundle ?? inputs.evolution?.current?.bundleSnapshotId ?? "unresolved";
  const taskSet = verdicts.identity?.taskSet ?? "unresolved";
  return {
    runId: inputs.runId,
    sourceRevision: source.commit,
    runGitHash: source.commit,
    sourceDigest: source.sourceDigest,
    worktree: inputs.repo,
    epoch,
    bundle,
    taskSet,
  };
}

function terminalRows(inputs: Inputs, verdicts: Verdicts, ptr: Ptr, identity: Identity) {
  const terminal: RecordedTerminal = inputs.terminal ?? {};
  const facts: TerminalFacts = inputs.status.facts?.terminalAccounting ?? {};
  const d: TerminalDenominator = terminal.denominator ?? {};
  // controller-denominator.ts writes absent, recorded or invalid, and controller-evidence.ts writes
  // outcome completed or aborted; an invalid denominator is shown as such, never folded into absent.
  const recorded = d.state === "recorded";
  const invalid = d.state === "invalid";
  const outcome =
    terminal.outcome !== undefined && ["completed", "aborted"].includes(terminal.outcome)
      ? terminal.outcome
      : "incomplete";
  const parent = (value: JsonValue | undefined): string => (isString(value) ? value : identity.bundle);
  // A live review has no controller terminal, so the snapshot carries no completed-round fact;
  // the primary records the count it read from the iteration records in verdicts.json.
  const completed = facts.completedRounds ?? verdicts.terminalAccounting?.completedRounds ?? 0;
  return {
    terminal: {
      outcome,
      capabilityResult:
        verdicts.terminal?.capabilityResult ??
        (invalid ? "inconclusive" : recorded && (d.verified ?? 0) > 0 ? "recorded" : "absent"),
      reason:
        [verdicts.terminal?.reason, terminal.reason].find((value) => value !== undefined && value !== "") ??
        "no terminal reason recorded",
      evidencePointers: [ptr(ANCHOR.terminal), ptr("#findings")],
    },
    terminalAccounting: {
      state: recorded ? "recorded" : "incomplete",
      denominator: recorded
        ? {
            state: "recorded",
            total: d.total,
            verified: d.verified,
            unaccepted: d.unaccepted,
            nonResult: d.nonResults,
          }
        : invalid
          ? { state: "invalid", reason: d.error }
          : { state: "absent" },
      reason: recorded
        ? undefined
        : invalid
          ? `controller denominator invalid — ${d.error}`
          : "controller denominator is not recorded",
      evidencePointer: ptr(ANCHOR.terminal),
      outerCap: facts.outerCap ?? null,
      completedRounds: completed,
      authorCalls: {
        budget: facts.authorCalls?.budget ?? "uncapped",
        opening: facts.authorCalls?.opening ?? 0,
        terminal: facts.authorCalls?.terminal ?? 0,
        delta: facts.authorCalls?.delta ?? 0,
      },
      counts: {
        raw: facts.counts?.raw ?? null,
        real: facts.counts?.real ?? null,
        controller: facts.counts?.controller ?? completed,
      },
      realAuthoringIterations: facts.completedRounds ?? verdicts.terminalAccounting?.completedRounds ?? null,
      candidateSubmits: verdicts.terminalAccounting?.candidateSubmits ?? null,
      controllerTerminalRows: verdicts.terminalAccounting?.controllerTerminalRows ?? null,
      recordedSubmitRows: verdicts.terminalAccounting?.recordedSubmitRows ?? null,
      parents: {
        lastCandidate: parent(facts.parents?.lastCandidate),
        adopted: parent(facts.parents?.adopted),
        accepted: parent(facts.parents?.accepted),
      },
    },
  };
}

function angleRows(lanes: readonly LaneRow[], verdicts: Verdicts, ptr: Ptr, shortIdentity: ShortIdentity) {
  const byAngle = new Map<number, LaneRow>();
  for (const lane of lanes) for (const angle of lane.angles) byAngle.set(Number(angle), lane);
  return Array.from({ length: ANGLE_COUNT }, (_, index) => {
    const angle = index + 1;
    const lane = byAngle.get(angle);
    const verdict = verdicts.angles?.[String(angle)];
    const anchor = verdict?.anchor ?? "#findings";
    if (verdict) {
      return {
        angle,
        state: verdict.state,
        session: lane?.name ?? "primary-deterministic",
        mode: lane?.mode ?? "targeted",
        identity: shortIdentity,
        denominator: {
          state: verdict.denominator ?? "recorded",
          reason: verdict.reason,
          evidencePointers: [ptr(anchor)],
        },
        reason: verdict.reason,
        evidencePointers: [ptr(anchor)],
      };
    }
    if (lane) {
      return {
        angle,
        state: "inconclusive",
        session: lane.name,
        mode: lane.mode,
        identity: shortIdentity,
        denominator: {
          state: "inconclusive",
          reason: "lane report not yet adjudicated by the primary",
          evidencePointers: [ptr(`#${lane.name}`, LUNA)],
        },
        reason: `Session ${lane.name} ${lane.status}; the primary has not recorded a verdict in verdicts.json.`,
        evidencePointers: [ptr(`#${lane.name}`, LUNA)],
      };
    }
    return {
      angle,
      state: "unobservable",
      session: "not-launched",
      mode: "targeted",
      identity: shortIdentity,
      denominator: {
        state: "absent",
        reason: "No semantic session admitted for this angle; not a pass.",
        evidencePointers: [ptr(ANCHOR.reviews)],
      },
      reason: "Not independently reviewed: no session was admitted for this angle.",
      evidencePointers: [ptr(ANCHOR.reviews)],
    };
  });
}

/** One session row per launched lane, keyed by the lane's session name, plus any extra session
 *  the primary recorded in verdicts.json. */
function sessionRows(lanes: readonly LaneRow[], inputs: Inputs, verdicts: Verdicts, ptr: Ptr): OpenRecord[] {
  const rows: OpenRecord[] = lanes.map((lane) => ({
    id: lane.name,
    state: LANE_STATES.get(lane.status) ?? "partial",
    evidencePointers: [ptr("#collection", LUNA), ptr(`#${lane.name}`, LUNA)],
    model: inputs.launch?.model ?? null,
    effort: inputs.launch?.reasoningEffort ?? null,
    transport: "luna-sessions",
    threadId: lane.threadId,
    reportSha256: lane.reportSha256,
    promptSha256: lane.promptSha256,
    assignedLanes: lane.angles,
  }));
  for (const extra of verdicts.extraSessions ?? []) {
    rows.push({ ...extra, evidencePointers: [ptr(extra.anchor ?? ANCHOR.reviews)] });
  }
  return rows;
}

function predictionRows(verdicts: Verdicts, ptr: Ptr, identity: Identity, denominator: OpenRecord) {
  const identityFields: Readonly<Record<string, string>> = identity;
  return (verdicts.predictions ?? []).map((row) => {
    const frozen = Object.fromEntries(
      FROZEN_PREDICTION_FIELDS.map((key) => [key, row[key] ?? identityFields[key]]),
    );
    const status = row.status ?? "inconclusive";
    return {
      ...frozen,
      frozenHash: predictionFrozenHash(frozen),
      status,
      eligible: false,
      advisoryReason:
        row.advisoryReason ??
        "The prediction was recorded in launch prose before launch; no canonical campaign receipt exists, so the row is advisory.",
      closureState: "not-campaign-closure",
      backtrackEvent: status === "refuted" ? "refutation-recorded" : "none-no-refutation",
      decidingEvidence: [ptr(ANCHOR.ledger)],
      successor: [],
      dependsOn: [],
      consumedBy: [],
      eligibility: {
        state: "ineligible",
        nextEligibleRunId: "unassigned-until-canonical-protocol-is-used",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      opportunity: {
        state: status === "untriggered" ? "absent" : "present",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      triggerEvidence: {
        state: status === "untriggered" ? "not-triggered" : "triggered",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      effectEvidence: {
        state: EFFECT_STATES.get(status) ?? "unknown",
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
      denominator: { ...denominator, evidencePointers: [ptr(ANCHOR.terminal)] },
      reason: row.reason ?? "",
      // A refuted row needs the primary's walk (verdicts.predictions[].dependencyWalk); the
      // validator refuses a refutation whose walk is not closed, so the default alone cannot record one.
      dependencyWalk: {
        walked: false,
        closed: false,
        casualties: [],
        survivors: [],
        dependents: [],
        ...row.dependencyWalk,
        evidencePointers: [ptr(ANCHOR.ledger)],
      },
    };
  });
}

/** Count only the logger's own framing. An unavailable log has no count, not an observed zero. */
function safeguardCounts(path: string | null | undefined, stderr = false): ChannelCounts {
  let bytes: string | null;
  try {
    bytes = path !== null && path !== undefined && path !== "" ? readFileSync(path, "utf8") : null;
  } catch {
    bytes = null;
  }
  if (bytes === null || path === null || path === undefined) {
    return { path: null, sha256: null, counts: new Map<string, number>(), malformed: 0 };
  }
  const { counts, malformed } = parseSafeguardLog(bytes, stderr ? SAFEGUARD_STDERR_PREFIX : "");
  return { path, sha256: sha256(bytes), counts, malformed };
}

function receipt(seen: "fired" | "silent", digest: string | null, ptr: Ptr): OpenRecord {
  return seen === "fired" && digest !== null && digest !== ""
    ? { state: "present", complete: true, sha256: digest, evidencePointers: [ptr(ANCHOR.safeguardsT1)] }
    : { state: "inconclusive", complete: false, evidencePointers: [ptr(ANCHOR.safeguardsT1)] };
}

/** A route is the primary's adjudication in `verdicts.safeguards.routes[<id>]`, with a state and a
 *  reason, under a complete reconciliation. A count proves a firing, not that the owner received
 *  it, so without that record the route stays inconclusive. */
function safeguardRoute(
  file: string,
  route: JsonValue | undefined,
  coverage: Coverage,
  ptr: Ptr,
): OpenRecord {
  const row = asRecord(route);
  const state = row?.state;
  const reason = row?.reason;
  return coverage.complete &&
    row !== null &&
    isString(state) &&
    ADJUDICATED_ROUTES.has(state) &&
    isString(reason) &&
    reason.trim() !== ""
    ? {
        state,
        owner: file,
        reason,
        evidencePointers: [ptr(row.anchor ?? ANCHOR.safeguards)],
      }
    : { state: "inconclusive", owner: file };
}

/** One runtime safeguard row. The count sums every channel that was read, so a firing the logger
 *  reached only through stderr still counts for an id the primary did not list; an id the primary
 *  declared stderr-only stays unresolved until that capture is supplied. No channel read means no
 *  count, and `not-fired` also needs the primary's byte-bound reconciliation (T1). */
function runtimeSafeguardRow({
  id,
  file,
  fileSha,
  stderrOnly,
  log,
  stderr,
  coverage,
  independentReview,
  route,
  ptr,
  shortIdentity,
}: RuntimeSafeguardInput): OpenRecord {
  const channels = [log.sha256 === null ? null : "run-log", stderr.sha256 === null ? null : "stderr"].filter(
    Boolean,
  );
  const unresolved = channels.length === 0 || (stderrOnly && stderr.sha256 === null);
  const count = unresolved ? null : (log.counts.get(id) ?? 0) + (stderr.counts.get(id) ?? 0);
  const fired = count !== null && count > 0;
  const status = fired ? "fired" : count === 0 && coverage.t1 ? "not-fired" : "inconclusive";
  const retirement: Retirement = {
    retired: false,
    eligibleIterations: 0,
    backtrackPreserved: false,
    backtrackPointers: [],
  };
  if (
    coverage.complete &&
    independentReview?.reviewed === true &&
    isString(independentReview.reason) &&
    independentReview.reason.trim() !== ""
  ) {
    retirement.independentReview = {
      reviewed: true,
      reason: independentReview.reason,
      evidencePointers: [ptr(independentReview.anchor ?? ANCHOR.safeguards)],
    };
  }
  return {
    id,
    kind: "runtime-log-only",
    status,
    owner: file,
    version: "source-callers-v1",
    sensor: "src/meta/safeguard.ts:safeguardTriggered",
    definitionSha256: fileSha,
    evidencePointers: [ptr(ANCHOR.safeguards)],
    evidenceBinding: shortIdentity,
    opportunity: { state: fired ? "present" : "unknown", evidencePointers: [ptr(ANCHOR.safeguardsT0)] },
    firing: { state: status, evidencePointers: [ptr(ANCHOR.safeguardsT1)] },
    logReceipt: receipt((log.counts.get(id) ?? 0) > 0 ? "fired" : "silent", log.sha256, ptr),
    stderrReceipt: receipt((stderr.counts.get(id) ?? 0) > 0 ? "fired" : "silent", stderr.sha256, ptr),
    // A controller terminal does not establish a process receipt for this particular firing.
    processReceipt: receipt("silent", null, ptr),
    action: { state: "diagnostic-only", owner: file, evidencePointers: [ptr(ANCHOR.safeguards)] },
    backtrack: { state: fired ? "required" : "inconclusive", evidencePointers: [ptr(ANCHOR.safeguards)] },
    coverage,
    route: safeguardRoute(file, route, coverage, ptr),
    retirement,
    count,
    countSource: unresolved ? null : channels.join("+"),
  };
}

function safeguardRows(
  inputs: Inputs,
  verdicts: Verdicts,
  ptr: Ptr,
  identity: Identity,
  shortIdentity: ShortIdentity,
) {
  const callers = sourceSafeguardCallers(inputs.repo);
  const log = safeguardCounts(safeguardLogFile(inputs.campaign, inputs.runId));
  const stderr = safeguardCounts(verdicts.safeguards?.stderrLog, true);
  const stderrOnly = new Set(verdicts.safeguards?.stderrOnlyIds ?? []);
  const callerFiles = [...callers.keys()].sort(compareCodeUnits).map((file) => ({
    relativeFile: file,
    sha256: sha256(readFileSync(join(inputs.repo, file), "utf8")),
    ids: [...(callers.get(file) ?? [])].sort(compareCodeUnits),
  }));
  const evidence = {
    ...shortIdentity,
    sourceDigest: identity.sourceDigest,
    callersSha256: sha256(canonicalJson(callerFiles)),
    logSha256: log.sha256,
    stderrSha256: stderr.sha256,
    stderrOnlyIds: [...stderrOnly].sort(compareCodeUnits),
  };
  // The primary records its reconciliation against these exact bytes in verdicts.json. A later
  // log, source or input-selection change invalidates that adjudication, rather than copying true.
  const reviewed = verdicts.safeguards?.reconciliation;
  const bytesVerified =
    reviewed !== null &&
    reviewed !== undefined &&
    isString(reviewed.reason) &&
    reviewed.reason.trim() !== "" &&
    canonicalJson(reviewed.evidence) === canonicalJson(evidence);
  const t0 = bytesVerified && reviewed.t0 === true;
  const t1 = bytesVerified && reviewed.t1 === true && log.malformed === 0 && stderr.malformed === 0;
  const coverage = { complete: t0 && t1, t0, t1 };
  // Every safeguard row is derived from a source caller and its receipts. This loop once also
  // pushed five constant "S1".."S5" rows for campaign sentinels no file has ever defined, so every
  // archive carried the same five inconclusive placeholders and no reader could learn from them.
  const rows: OpenRecord[] = [];
  for (const caller of callerFiles) {
    for (const id of caller.ids) {
      rows.push(
        runtimeSafeguardRow({
          id,
          file: caller.relativeFile,
          fileSha: caller.sha256,
          stderrOnly: stderrOnly.has(id),
          log,
          stderr,
          coverage,
          independentReview: verdicts.safeguards?.independentReviews?.[id],
          route: verdicts.safeguards?.routes?.[id],
          ptr,
          shortIdentity,
        }),
      );
    }
  }
  const census = {
    complete: true,
    availability: callerFiles.length > 0 ? "observable" : "absent",
    sourceRevision: identity.sourceRevision,
    sourceDigest: identity.sourceDigest,
    definitionFile: "src/meta/safeguard.ts",
    derivation: "source-callers-v1",
    callerFiles,
    ids: [...new Set(callerFiles.flatMap((row) => row.ids))].sort(compareCodeUnits),
    evidencePointers: [ptr(ANCHOR.safeguards)],
  };
  return {
    safeguards: rows,
    safeguardCensus: census,
    safeguardLog: log.path,
    evidence,
    bytesVerified,
    coverage,
  };
}

function procedureIdentity(inputs: Inputs, ptr: Ptr): OpenRecord {
  const checkout = inputs.reviewCheckout;
  const skillPath = join(checkout, ".claude/skills/whole-run-investigation/SKILL.md");
  const digest = sha256OfFile(skillPath);
  const revision = gitText(checkout, "rev-parse", "HEAD");
  return {
    name: "whole-run-investigation",
    version: "wri/skill-md",
    sourceRevision: revision,
    sourceDigest: digest,
    sha256: digest,
    worktree: checkout,
    sameTree: checkout === inputs.repo,
    state: "unbound",
    pointer: ptr("#identity-and-evidence"),
  };
}

function buildReview(inputs: Inputs, verdicts: Verdicts, lanes: readonly LaneRow[], archiveDir: string) {
  const digests: Readonly<Record<string, string>> = Object.fromEntries(
    [MAIN, LUNA, DIGEST].map((name) => [name, sha256OfFile(join(archiveDir, name))]),
  );
  const ptr: Ptr = (anchor, path = MAIN) => ({ path, anchor, sha256: digests[path] });
  const identity = identityOf(inputs, verdicts);
  const shortIdentity = {
    runId: identity.runId,
    sourceRevision: identity.sourceRevision,
    epoch: identity.epoch,
    bundle: identity.bundle,
    taskSet: identity.taskSet,
  };
  const digestAnchor = `#${headingSlug(/^#{1,6}\s+(.+)$/m.exec(readFileSync(join(archiveDir, DIGEST), "utf8"))?.[1] ?? "")}`;
  const rows = terminalRows(inputs, verdicts, ptr, identity);
  const safeguards = safeguardRows(inputs, verdicts, ptr, identity, shortIdentity);
  const handoff: NonNullable<Verdicts["learningHandoff"]> = verdicts.learningHandoff ?? {};
  return {
    schema: ARCHIVE_SCHEMA,
    authority: "advisory",
    status: "investigation-complete",
    identity,
    lifecycle: { stage: inputs.terminal ? "terminal" : "live" },
    procedureIdentity: procedureIdentity(inputs, ptr),
    ledgerProjection: {
      schema: "superloop-ledger-projection/v1",
      authority: "projection-only",
      mutable: false,
      sourceRevision: identity.sourceRevision,
      sha256: digests[MAIN],
      pointer: ptr(ANCHOR.ledger),
    },
    launchIdentity: { state: "incomplete", reason: verdicts.launchIdentityReason },
    digests: {
      snapshot: {
        sha256: digests[DIGEST],
        pointer: ptr(digestAnchor, DIGEST),
      },
      manifest: { sha256: digests[LUNA], pointer: ptr("#collection", LUNA) },
      sessions: { sha256: digests[LUNA], pointer: ptr("#collection", LUNA) },
      reports: { sha256: digests[LUNA], pointer: ptr("#reports", LUNA) },
    },
    ...rows,
    deterministicRows: Object.entries(DETERMINISTIC_ROW_TITLES).map(([id, title]) => ({
      id,
      title,
      state: verdicts.deterministicRows?.[id] ?? "inconclusive",
      evidencePointers: [ptr("#deterministic-rows")],
    })),
    digestVerdicts: DIGEST_VERDICTS.map((id) => ({
      id,
      state: verdicts.digestVerdicts?.[id] ?? "inconclusive",
      evidencePointers: [ptr("#deterministic-rows"), ptr(digestAnchor, DIGEST)],
    })),
    angleStates: angleRows(lanes, verdicts, ptr, shortIdentity),
    sessionStates: sessionRows(lanes, inputs, verdicts, ptr),
    predictions: predictionRows(
      verdicts,
      ptr,
      identity,
      rows.terminalAccounting.denominator.state === "recorded"
        ? { state: "recorded", counts: { ...rows.terminalAccounting.denominator, state: undefined } }
        : { state: rows.terminalAccounting.denominator.state === "invalid" ? "unknown" : "absent" },
    ),
    safeguards: safeguards.safeguards,
    safeguardCensus: safeguards.safeguardCensus,
    safeguardEvidence: safeguards.evidence,
    safeguardReconciliation: {
      bytesVerified: safeguards.bytesVerified,
      t0: ptr(ANCHOR.safeguardsT0),
      t1: ptr(ANCHOR.safeguardsT1),
      t0Identity: { complete: safeguards.coverage.t0, ...identity },
      t1Identity: { complete: safeguards.coverage.t1, ...identity },
    },
    primaryReview: {
      assertion: verdicts.primaryReview?.assertion ?? "",
      protectedEvidenceChecked: verdicts.primaryReview?.protectedEvidenceChecked === true,
      evidencePointers: [ptr(ANCHOR.reviews)],
    },
    metaReview: {
      state: "not-used",
      authority: "advisory",
      reason: "No disputed horizon or campaign policy change was made; the decision rests on recorded bytes.",
      evidencePointers: [ptr("#source-proof-and-replacement-decision")],
    },
    conditionManifest: {
      state: "not-used",
      authority: "advisory",
      reason:
        "The exact opening and launch command are recorded; no separate canonical condition ticket is claimed.",
      evidencePointers: [ptr("#identity-and-evidence")],
    },
    learningHandoff: {
      authority: "advisory",
      hypotheses: handoff.hypotheses ?? [],
      rivalSets: handoff.rivalSets ?? [],
      experimentProposals: (handoff.experimentProposals ?? []).map((row) => ({
        ...row,
        disposition: row.disposition ?? "propose",
        evidencePointers: [ptr(row.anchor ?? "#what-to-do-next")],
        anchor: undefined,
      })),
      evidencePointers: [ptr("#what-to-do-next")],
    },
    sectionPointers: {
      predictionLedger: ptr(ANCHOR.ledger),
      safeguards: ptr(ANCHOR.safeguards),
      terminalAccounting: ptr(ANCHOR.terminal),
    },
  };
}

/** Write the archive files. Returns the verdicts path when the template was just created. */
export function scaffoldArchive(reviewDir: string): ScaffoldResult {
  const inputs = loadInputs(reviewDir);
  const lanes = laneRows(inputs);
  const archiveDir = join(reviewDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  const verdictsPath = join(reviewDir, "verdicts.json");
  const fresh = !existsSync(verdictsPath);
  if (fresh) {
    writeJsonFile(
      verdictsPath,
      verdictsTemplate(
        inputs.runId,
        lanes.map((lane) => lane.name),
      ),
    );
  }
  const verdicts = readJson<Verdicts>(verdictsPath);
  if (verdicts?.schema !== VERDICTS_SCHEMA) {
    throw new Error(`${verdictsPath} is not a ${VERDICTS_SCHEMA} file; trash it and run finish again`);
  }
  writeFileSync(join(archiveDir, LUNA), lunaSyntheses(lanes, inputs));
  const digestPath = join(inputs.snapshotDir, DIGEST);
  // The digest prints padded tables; the archive copy drops trailing spaces so the documentation diff check accepts it.
  writeFileSync(
    join(archiveDir, DIGEST),
    existsSync(digestPath)
      ? readFileSync(digestPath, "utf8").replace(/[ \t]+$/gm, "")
      : "# deterministic digest\n\nThe snapshot carried no digest.md.\n",
  );
  const mainPath = join(archiveDir, MAIN);
  if (!existsSync(mainPath)) writeFileSync(mainPath, mainSkeleton(inputs));
  writeJsonFile(join(archiveDir, REVIEW), buildReview(inputs, verdicts, lanes, archiveDir));
  return {
    archiveDir,
    verdictsPath,
    fresh,
    lanes: lanes.length,
    mainSkeleton: readFileSync(mainPath, "utf8").includes("\nTODO\n"),
  };
}

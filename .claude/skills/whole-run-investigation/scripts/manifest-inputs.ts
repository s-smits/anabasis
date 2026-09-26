import { boundText } from "#src/meta/bounded-text.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readFileSync, realpathSync } from "#src/meta/filesystem.ts";
import { asRecord, isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type ExitWith, exitWith } from "#skills/main/cli.ts";
import { gitText } from "#skills/main/git.ts";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROW_TITLES,
  DETERMINISTIC_ROWS,
  GIT_SHA,
  ISOLATED_ANGLES,
  TRACE_CHALLENGE_LANE,
  SHA256 as SHA_256,
} from "./catalogue-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { jsonText, readJsonAs } from "./run-overview.ts";

export const ORIENTATION_HEADING = "orientation";
/** Maximum nonblank lines in the shared reviewer orientation. */
const ORIENTATION_MAX_LINES = 20;
/** A lane heading in the catalogue and in the session index: `**N. Title.**` at line start. */
const ANGLE_HEADING = /^\*\*(\d+)\.\s+(.+?)\*\*/;
/** A deterministic row heading in both files: `**A. Title.**` at line start. */
const DETERMINISTIC_ROW_HEADING = /^\*\*([A-I])\.\s+(.+?)\*\*/;
/** The one paragraph of a lane body that names its deterministic trigger. */
const TRIGGER_PARAGRAPH = /^Starts from\b/;
const REQUIRED_SHARED_VIEWS = ["digest", "review-yield", "builder"];
const REQUIRED_RUN_VIEWS = [
  "default",
  "scan",
  "scorecard",
  "observations-warning",
  "cases-fail",
  "cases-unaccepted",
  "cases-non-result",
  "cases-pass",
];

export const manifestFail: ExitWith = exitWith("build-manifest");
/** Row titles keyed by letter, so a heading's letter looks its title up without widening the table. */
const ROW_TITLES = new Map(Object.entries(DETERMINISTIC_ROW_TITLES));

/** One lane the catalogue declares; the session index carries the same rows without a trigger. */
export interface AngleSession {
  name: string;
  number: number;
  title: string;
  trigger: string | null;
  body: string;
}

/** Whether an isolated lane's deterministic trigger fired, and the recorded reason either way. */
export interface LaneGate {
  fired: boolean;
  reason: string;
}

/** One lane selected into a session. */
export interface SessionMember {
  name: string;
  session: AngleSession;
}

/** One session: a contiguous lane range, or one isolated lane alone. */
export interface SessionGroup {
  name: string;
  members: SessionMember[];
}

export interface SessionSpec {
  groups: SessionGroup[];
  problems: string[];
}

/** One snapshot view as `snapshot-status.json` records it. */
export interface RecordedView {
  label?: string;
  file?: string;
  bytes?: number;
  sha256?: string;
  status?: string;
}

/** A view whose capture failed, with the first informative line of its captured output. */
export type FailedView = RecordedView & { error: string };

/** A recorded scalar fact; nested values never reach a fact line. */
type Scalar = string | number | boolean | null | undefined;

/** The terminal accounting trace-review projects into the snapshot status. */
interface TerminalAccounting {
  controller?: { state?: string; error?: Scalar };
  outerCap?: Scalar;
  completedRounds?: Scalar;
  authorCalls?: { budget?: Scalar; opening?: Scalar; terminal?: Scalar; delta?: Scalar; unit?: Scalar };
  counts?: { raw?: Scalar; real?: Scalar; controller?: Scalar };
  parents?: { lastCandidate?: Scalar; adopted?: Scalar; accepted?: Scalar };
}

/** `snapshot-status.json` as trace-review writes it, before `loadSnapshot` proves its shape. */
interface RecordedStatus {
  schema?: string;
  campaign?: string;
  capturedAt?: string;
  repo?: string;
  runIds?: string[];
  runtime?: { version?: string; executable?: string };
  worktree?: { path?: string; head?: string; dirty?: boolean };
  source?: { commit?: string; sourceDigest?: string; dirty?: boolean };
  views?: RecordedView[];
  facts?: { terminalAccounting?: TerminalAccounting };
}

/** The status once `verifyWorktree` has proved its worktree and source identities. */
type VerifiedStatus = RecordedStatus & {
  worktree: { path: string; head: string; dirty: boolean };
  source: { commit: string; sourceDigest: string; dirty: boolean };
};

export type SnapshotStatus = VerifiedStatus & { views: RecordedView[] };

interface BatteryCases {
  verified?: number;
  passed?: number;
  failed?: number;
  unaccepted?: number;
  nonResults?: { total?: number; byKind?: Record<string, number> };
}

/** One battery of the default outcome view, as far as the facts block reads it. */
interface BatteryView {
  cases?: BatteryCases;
  passRate?: { rate?: number | null; n?: number; wilson?: { lower: number; upper: number } | null };
  families?: Record<string, { passed?: number; verified?: number }>;
  identity?: {
    backendPins?: string[];
    variants?: string[];
    slugs?: string[];
    isolationUnproven?: number;
  };
  telemetry?: { recorded?: number; meanTurns?: number | null; meanToolCalls?: number | null };
  tools?: { neverCalled?: string[] };
}

/** One recorded outcome view (default, scan or scorecard), as far as this reader reads it. */
export interface OutcomeView {
  batteries?: Record<string, BatteryView>;
  controller?: {
    state?: string;
    terminalReason?: string;
    abortClause?: string | null;
    denominator?: {
      state?: string;
      total?: number;
      verified?: number;
      unaccepted?: number;
      nonResults?: number;
    };
  };
  caseRecord?: string;
  promotions?: {
    runId?: string;
    decision?: string;
    experiment?: string | null;
    clauses?: string[];
  }[];
  bundle?: {
    files?: number;
    nonBlankLines?: number;
    functions?: number;
    worstFunction?: { name?: string; lines?: number; file?: string };
  };
  findings?: { rule?: string; battery?: string | null; statement?: string }[];
  reach?: {
    lastAuthoring?: {
      ordinal?: number;
      epoch?: string;
      outcome?: string;
      workspaceCommit?: string | null;
    } | null;
  };
}

/** The verified snapshot every manifest reader works from. */
export interface Snapshot {
  dir: string;
  status: SnapshotStatus;
  runId: string | null;
  bunPin: string;
  view: (mode: string) => OutcomeView | null;
  failedViews: FailedView[];
}

export interface NotesOrientation {
  custom: boolean;
  text: string;
}

export interface SessionNote {
  name: string;
  custom: boolean;
  note: string;
}

/** The notes file: its orientation blocks and every other `## heading` block. */
export interface ParsedNotes {
  orientations: NotesOrientation[];
  notes: SessionNote[];
}

interface CatalogueStart {
  index: number;
  number: number;
  title: string;
}

interface CatalogueRow {
  index: number;
  letter: string;
}

interface GroupPlan {
  cost: number;
  sizes: number[];
}

interface NotesBlock {
  name: string;
  custom: boolean;
  lines: string[];
}

export function laneName(number: number | string): string {
  return `lane_${String(number).padStart(2, "0")}`;
}

function unwrap(text: string): string {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => block.replace(/\s*\n\s*/g, " ").trim() || [])
    .join("\n\n");
}

function angleStartsAndBoundaries(lines: readonly string[]) {
  const starts: CatalogueStart[] = [];
  const deterministic: CatalogueRow[] = [];
  const boundaries: number[] = [];
  lines.forEach((line, index) => {
    const match = ANGLE_HEADING.exec(line);
    if (match) {
      starts.push({ index, number: Number(match[1]), title: (match[2] ?? "").replace(/\.$/, "") });
      boundaries.push(index);
      return;
    }
    const row = DETERMINISTIC_ROW_HEADING.exec(line);
    if (row) {
      deterministic.push({ index, letter: row[1] ?? "" });
      boundaries.push(index);
    } else if (/^##\s/.test(line)) boundaries.push(index);
  });
  return { starts, deterministic, boundaries };
}

/** The catalogue and the session index share one shape; each names its own refusal clause. */
function validateCatalogueRows(
  starts: readonly CatalogueStart[],
  deterministic: readonly CatalogueRow[],
  index: boolean,
): void {
  const clause = index
    ? "session-index-drift: session index"
    : "catalogue-lane-count: review-angle catalogue";
  const expectedRows = [...DETERMINISTIC_ROWS];
  const actualRows = deterministic.map((row) => row.letter);
  if (
    actualRows.length !== expectedRows.length ||
    actualRows.some((letter, position) => letter !== expectedRows[position])
  ) {
    manifestFail(
      `${clause} must declare deterministic rows ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} exactly once and in order; found ${actualRows.join(", ") || "none"}`,
    );
  }
  const expected = Array.from({ length: ANGLE_COUNT }, (_, position) => position + 1);
  const actual = starts.map((start) => start.number);
  if (actual.length !== expected.length || actual.some((number, position) => number !== expected[position])) {
    manifestFail(
      `${clause} must declare lanes 1-${ANGLE_COUNT} exactly once and in order; found ${actual.join(", ") || "none"}`,
    );
  }
  // Both counts were proved above, so the last row and the first lane exist.
  const lastRow = deterministic.at(-1);
  const firstLane = starts[0];
  if (lastRow && firstLane && lastRow.index > firstLane.index) {
    manifestFail(
      `${clause} must keep deterministic rows ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} before lane 1`,
    );
  }
}

/** The one `Starts from` paragraph of a lane body, which the manifest carries as its trigger. */
function laneTrigger(rawBody: string, number: number): string {
  const paragraphs = rawBody
    .split(/\n{2,}/)
    .map((block) =>
      block
        .replace(ANGLE_HEADING, "")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
    )
    .filter((block) => TRIGGER_PARAGRAPH.test(block));
  if (paragraphs.length !== 1) {
    manifestFail(
      `lane-without-trigger: lane ${number} must carry exactly one paragraph beginning \`Starts from\`; found ${paragraphs.length}`,
    );
  }
  return paragraphs[0] ?? "";
}

/** Every lane the catalogue declares, keyed by `lane_NN`, after the shape is proved. The session
 *  index is parsed with the same reader (`index` true): its rows carry one sentence and no trigger. */
export function angleSessions(text: string, index = false): Map<string, AngleSession> {
  const lines = text.split("\n");
  const { starts, deterministic, boundaries } = angleStartsAndBoundaries(lines);
  validateCatalogueRows(starts, deterministic, index);
  const sessions = new Map<string, AngleSession>();
  for (const start of starts) {
    const end = boundaries.find((boundary) => boundary > start.index) ?? lines.length;
    const rawBody = lines.slice(start.index, end).join("\n");
    sessions.set(laneName(start.number), {
      name: laneName(start.number),
      number: start.number,
      title: `${start.number}. ${start.title}`,
      trigger: index ? null : laneTrigger(rawBody, start.number),
      body: unwrap(rawBody),
    });
  }
  return sessions;
}

// The session index carries one sentence per row and lane so a reviewer can select sessions
// without loading the whole catalogue. It is only useful while it names the same rows, so a drift
// refuses the build.
export function assertIndexMatchesCatalogue(index: string, angles: string): Map<string, AngleSession> {
  const declared = angleSessions(angles);
  const indexed = angleSessions(index, true);
  for (const [name, session] of declared) {
    const row = indexed.get(name);
    if (row?.title !== session.title) {
      manifestFail(
        `session-index-drift: session index title for ${name} is "${row?.title}" but the catalogue says "${session.title}"`,
      );
    }
  }
  return declared;
}

/** Which isolated lanes the recorded evidence lets a launch include. Both need at least one
 *  verified case in the default view; the trace-challenge lane also needs a complete packet, which
 *  the composer verifies byte by byte once the lane is assigned. */
export function isolatedLaneGate(snapshot: Snapshot): Map<number, LaneGate> {
  const report = snapshot.view("default");
  const verified = report
    ? Object.values(report.batteries ?? {}).reduce((sum, battery) => sum + (battery.cases?.verified ?? 0), 0)
    : null;
  const gate = new Map<number, LaneGate>();
  for (const number of ISOLATED_ANGLES.keys()) {
    if (verified === null) {
      gate.set(number, {
        fired: false,
        reason: "the default view is unavailable, so no verified case is recorded",
      });
      continue;
    }
    if (verified === 0) {
      gate.set(number, { fired: false, reason: "no battery recorded a verified case" });
      continue;
    }
    if (
      number === TRACE_CHALLENGE_LANE &&
      !existsSync(join(snapshot.dir, "trace-challenge", "trace-challenge-status.json"))
    ) {
      gate.set(number, { fired: false, reason: "the snapshot carries no trace-challenge packet" });
      continue;
    }
    gate.set(number, { fired: true, reason: `${verified} verified case(s) recorded` });
  }
  return gate;
}

function contiguousGroupSizes(
  total: number,
  count: number,
  requiredCutAfter: ReadonlySet<number>,
): number[] | null {
  const memo = new Map<string, GroupPlan | null>();
  function best(start: number, groups: number): GroupPlan | null {
    const key = `${start}:${groups}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: GroupPlan | null = null;
    if (groups === 1) {
      const valid = !Array.from({ length: total - start - 1 }, (_, i) => start + i).some((gap) =>
        requiredCutAfter.has(gap),
      );
      if (valid) result = { cost: (total - start) ** 2, sizes: [total - start] };
    } else {
      for (let len = 1; len <= total - start - groups + 1; len += 1) {
        const innerCut = Array.from({ length: len - 1 }, (_, i) => start + i).some((gap) =>
          requiredCutAfter.has(gap),
        );
        if (innerCut) continue;
        const rest = best(start + len, groups - 1);
        if (!rest) continue;
        const cost = len ** 2 + rest.cost;
        if (!result || cost < result.cost) result = { cost, sizes: [len, ...rest.sizes] };
      }
    }
    memo.set(key, result);
    return result;
  }
  return best(0, count)?.sizes ?? null;
}

/** Split the launchable lanes into `count` contiguous sessions of balanced size, each isolated lane
 *  alone. `lanes` is already the launchable set: an unfired isolated lane never reaches it. */
export function partitionAngles<Lane extends { number: number }>(
  lanes: readonly Lane[],
  count: number,
): Lane[][] {
  if (count > lanes.length) {
    manifestFail(
      `--auto ${count} asks for more sessions than the ${lanes.length} launchable lanes; at most one lane per session`,
    );
  }
  const cuts = new Set<number>();
  lanes.forEach((lane, index) => {
    if (!ISOLATED_ANGLES.has(lane.number)) return;
    if (index > 0) cuts.add(index - 1);
    if (index < lanes.length - 1) cuts.add(index);
  });
  const sizes = contiguousGroupSizes(lanes.length, count, cuts);
  if (!sizes) {
    manifestFail(`--auto ${count} cannot seat each isolated lane alone; ask for at least ${cuts.size + 1}`);
  }
  const groups: Lane[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    groups.push(lanes.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

function sessionMembers(token: string, problems: string[]): string[] {
  const one = /^(?:lane_)?(\d{1,2})$/;
  const range = /^(?:lane_)?(\d{1,2})\s*-\s*(?:lane_)?(\d{1,2})$/.exec(token);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) {
      problems.push(`session range \`${token}\` runs backwards; write it low to high`);
      return [];
    }
    return Array.from({ length: to - from + 1 }, (_, offset) => laneName(from + offset));
  }
  const single = one.exec(token);
  return [single ? laneName(Number(single[1])) : token];
}

export function sessionGroupName(members: readonly SessionMember[]): string {
  const [first] = members;
  if (members.length === 1 && first) return first.name;
  const numbers = members.map((member) => String(member.session.number).padStart(2, "0"));
  return `lanes_${numbers[0]}_${numbers.at(-1)}`;
}

function validateSessionGroup(members: readonly SessionMember[], problems: string[]): boolean {
  const isolated = members.find((member) => ISOLATED_ANGLES.has(member.session.number));
  if (members.length > 1 && isolated) {
    problems.push(
      `lane ${isolated.session.number} ${ISOLATED_ANGLES.get(isolated.session.number)} and must be its own session`,
    );
    return false;
  }
  const contiguous = members.every((member, index) => {
    const previous = members[index - 1];
    return previous === undefined || member.session.number === previous.session.number + 1;
  });
  if (!contiguous) {
    problems.push(`\`${members.map((member) => member.name).join(",")}\` is not a contiguous lane range`);
    return false;
  }
  return true;
}

// `--sessions 1-4,7`: commas separate sessions and `-` is a contiguous lane range inside one session.
export function parseSessionSpec(spec: string, declared: ReadonlyMap<string, AngleSession>): SessionSpec {
  const problems: string[] = [];
  const groups: SessionGroup[] = [];
  const claimed = new Map<string, string>();
  for (const entry of spec.split(",").flatMap((value) => value.trim() || [])) {
    const members: SessionMember[] = [];
    for (const name of sessionMembers(entry, problems)) {
      const session = declared.get(name);
      if (!session) {
        problems.push(`unknown lane \`${name}\` in \`${entry}\` — run with --list to see the declared names`);
        continue;
      }
      if (claimed.has(name)) {
        problems.push(`\`${name}\` is selected twice, in \`${claimed.get(name)}\` and \`${entry}\``);
      }
      claimed.set(name, entry);
      members.push({ name, session });
    }
    if (members.length === 0) continue;
    if (!validateSessionGroup(members, problems)) continue;
    groups.push({ name: sessionGroupName(members), members });
  }
  if (groups.length === 0 && problems.length === 0) problems.push(`--sessions "${spec}" selected no lane`);
  return { groups, problems };
}

/** The refusal a notes heading earns when it names a deterministic row rather than a lane. */
export function deterministicRowProblem(name: string): string | null {
  const row = /^(?:row|lane)_([a-i])$/i.exec(name);
  if (!row) return null;
  const letter = (row[1] ?? "").toUpperCase();
  return `row ${letter} (${ROW_TITLES.get(letter)}) is settled by the primary reviewer's deterministic preflight, not by a lane`;
}

function snapshotLabels(runIds: readonly string[]): string[] {
  return [
    ...REQUIRED_SHARED_VIEWS,
    ...runIds.flatMap((runId) => REQUIRED_RUN_VIEWS.map((mode) => `${runId}-${mode}`)),
  ];
}

function snapshotViewFile(dir: string, view: RecordedView): string {
  if (!isString(view.file) || view.file.length === 0 || /[/\\]/.test(view.file)) {
    manifestFail(`snapshot view ${view.label ?? "<unnamed>"} has an invalid file name`);
  }
  if (
    !isNumber(view.bytes) ||
    !Number.isInteger(view.bytes) ||
    view.bytes < 0 ||
    !SHA_256.test(view.sha256 ?? "")
  ) {
    manifestFail(`snapshot view ${view.label} has no valid byte count and sha256`);
  }
  const path = join(dir, view.file);
  if (!existsSync(path)) manifestFail(`snapshot view ${view.label} names a missing file: ${path}`);
  const bytes = readFileSync(path);
  const actualBytes = bytes.byteLength;
  const actualSha256 = sha256(bytes);
  if (actualBytes !== view.bytes) {
    manifestFail(
      `snapshot view ${view.label} byte count drifted: expected ${view.bytes}, received ${actualBytes}`,
    );
  }
  if (actualSha256 !== view.sha256) {
    manifestFail(
      `snapshot view ${view.label} digest drifted: expected ${view.sha256}, received ${actualSha256}`,
    );
  }
  if (view.status === "ok" && bytes.byteLength === 0) {
    manifestFail(`snapshot view ${view.label} is empty but marked ok`);
  }
  return path;
}

/** The first informative line of a captured view failure, bounded for an instruction packet. */
function capturedErrorHead(path: string): string {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const head =
    lines.find((line) => /^error[: ]/i.test(line)) ??
    lines.find((line) => /exited \d+/.test(line)) ??
    lines.at(-1) ??
    "no captured output";
  return boundText(head, 240).shown;
}

function verifyWorktree(
  status: RecordedStatus,
  expectedWorktree: string | null = null,
): asserts status is VerifiedStatus {
  if (!isString(status.worktree?.path) || !isAbsolute(status.worktree.path)) {
    manifestFail("snapshot worktree must name an absolute path");
  }
  if (!GIT_SHA.test(String(status.worktree.head ?? ""))) {
    manifestFail("snapshot worktree must carry one concrete 40-character HEAD");
  }
  if (!GIT_SHA.test(String(status.source?.commit ?? ""))) {
    manifestFail("snapshot source must carry one concrete 40-character commit");
  }
  if (!SHA_256.test(String(status.source?.sourceDigest ?? ""))) {
    manifestFail("snapshot source must carry a concrete 64-character source digest");
  }
  if (!isBoolean(status.source?.dirty)) manifestFail("snapshot source must disclose dirty as boolean");
  if (!isBoolean(status.worktree.dirty)) manifestFail("snapshot worktree must disclose dirty as boolean");
  if (status.repo !== status.worktree.path) manifestFail("snapshot repository and worktree paths differ");
  if (status.source.commit !== status.worktree.head) {
    manifestFail(
      `snapshot source commit ${status.source.commit} differs from worktree HEAD ${status.worktree.head}`,
    );
  }
  if (!existsSync(status.worktree.path)) {
    manifestFail(`snapshot worktree does not exist: ${status.worktree.path}`);
  }
  if (expectedWorktree !== null) {
    if (!existsSync(expectedWorktree)) {
      manifestFail(`requested --worktree does not exist: ${expectedWorktree}`);
    }
    if (realpathSync(expectedWorktree) !== realpathSync(status.worktree.path)) {
      manifestFail("requested --worktree differs from the snapshot worktree, even though its HEAD may match");
    }
  }
  if (status.source.dirty || status.worktree.dirty) {
    manifestFail("snapshot refuses a dirty measured worktree; recapture from a clean source");
  }
  let head: string;
  try {
    head = gitText(status.worktree.path, "rev-parse", "HEAD");
  } catch (error) {
    manifestFail(`could not resolve snapshot worktree HEAD: ${errorMessage(error)}`);
  }
  if (head !== status.worktree.head) {
    manifestFail(`worktree HEAD drifted: expected ${status.worktree.head}, received ${head}`);
  }
  const dirty = gitText(status.worktree.path, "status", "--porcelain", "--untracked-files=no").length > 0;
  if (dirty !== status.worktree.dirty) {
    manifestFail(
      `snapshot worktree dirty flag drifted: expected ${status.worktree.dirty}, received ${dirty}`,
    );
  }
  if (dirty) manifestFail("snapshot refuses a dirty measured worktree; recapture from a clean source");
}

/** The Bun release the measured worktree pins in package.json `engines.bun`. Reading the pin from
 *  the tree keeps a Bun upgrade to one edit; a snapshot taken with another Bun ran the outcome
 *  readers on a runtime the run never used. */
function measuredBunPin(worktreePath: unknown): string {
  if (!isString(worktreePath)) manifestFail("snapshot worktree path must be a string");
  const manifestPath = join(worktreePath, "package.json");
  if (!existsSync(manifestPath)) manifestFail(`measured worktree has no package.json at ${manifestPath}`);
  const pin = asRecord(asRecord(readJsonFile(manifestPath))?.engines)?.bun;
  if (!isString(pin) || !/^\d+\.\d+\.\d+$/.test(pin)) {
    manifestFail(
      `measured worktree package.json must pin engines.bun as x.y.z; received ${jsonText(pin ?? "missing")}`,
    );
  }
  return pin;
}

/** Load and prove the snapshot. `expectedWorktree` is the --worktree the operator named, which
 *  must be the one the snapshot measured. */
export function loadSnapshot(dir: string, expectedWorktree: string | null = null): Snapshot {
  const statusPath = join(dir, "snapshot-status.json");
  if (!existsSync(statusPath)) {
    manifestFail(`no snapshot-status.json under ${dir}; run trace-review.ts first`);
  }
  const status = readJsonAs<RecordedStatus>(statusPath);
  if (status.schema !== "outcome-snapshot-status/v2") {
    manifestFail(
      `snapshot schema must be outcome-snapshot-status/v2; received ${status.schema ?? "missing"}`,
    );
  }
  const bunPin = measuredBunPin(status.worktree?.path);
  if (status.runtime?.version !== bunPin || !String(status.runtime.executable ?? "").startsWith("/")) {
    manifestFail(
      `snapshot runtime must name an absolute Bun ${bunPin} executable (the measured worktree pins it in package.json); ` +
        `received ${status.runtime?.version ?? "missing"} at ${status.runtime?.executable ?? "missing"}`,
    );
  }
  if (
    !Array.isArray(status.runIds) ||
    status.runIds.length !== 1 ||
    new Set(status.runIds).size !== 1 ||
    !isString(status.runIds[0]) ||
    status.runIds[0].length === 0
  ) {
    manifestFail("snapshot must name exactly one concrete runId");
  }
  verifyWorktree(status, expectedWorktree);
  if (!Array.isArray(status.views)) manifestFail("snapshot views must be an array");
  const views = status.views;
  const labels = views.map((view) => view.label);
  if (labels.some((label) => !isString(label)) || new Set(labels).size !== labels.length) {
    manifestFail("snapshot view labels must be unique strings");
  }
  const missing = snapshotLabels(status.runIds).filter((label) => !labels.includes(label));
  if (missing.length > 0) manifestFail(`snapshot is missing required views: ${missing.join(", ")}`);
  // A failed view is not a collected fact, and it is not a reason to skip the review either: the
  // captured error's first line goes into the instructions so every session knows which view is
  // missing and why (2026-09-07: three outcome views refused a signal-terminated run and the whole
  // manifest was refused, so the reviewer hand-wrote the instruction packet instead).
  const failedViews: FailedView[] = [];
  const byLabel = new Map<string | undefined, string>();
  for (const view of views) {
    const path = snapshotViewFile(dir, view);
    if (view.status === "ok") byLabel.set(view.label, path);
    else failedViews.push({ ...view, error: capturedErrorHead(path) });
  }
  const runId = status.runIds[0] ?? null;
  const view = (mode: string): OutcomeView | null => {
    const label = runId === null ? mode : `${runId}-${mode}`;
    const path = byLabel.get(label);
    return path === undefined ? null : readJsonAs<OutcomeView>(path);
  };
  return {
    dir,
    status: { ...status, views },
    runId,
    bunPin,
    view,
    failedViews,
  };
}

const percent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "unknown" : `${(value * 100).toFixed(1)}%`;

function batteryFactLines(runId: string, battery: BatteryView): string[] {
  const lines: string[] = [];
  const cases = battery.cases ?? {};
  const kinds = Object.entries(cases.nonResults?.byKind ?? {})
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  lines.push(
    `- Battery \`${runId}\`: ${cases.verified ?? "?"} verified, ${cases.passed ?? "?"} passed, ` +
      `${cases.failed ?? "?"} failed, ${cases.unaccepted ?? "?"} unaccepted, ` +
      `${cases.nonResults?.total ?? "?"} non-results${kinds ? ` (${kinds})` : ""}. ` +
      `Pass rate ${percent(battery.passRate?.rate)} on n=${battery.passRate?.n ?? "?"}` +
      (battery.passRate?.wilson
        ? `, Wilson [${battery.passRate.wilson.lower.toFixed(3)}, ${battery.passRate.wilson.upper.toFixed(3)}].`
        : ", Wilson unavailable."),
  );
  const families = Object.entries(battery.families ?? {});
  if (families.length > 0) {
    lines.push(
      `  - Per family (passed/verified): ${families.map(([name, row]) => `${name} ${row.passed ?? "?"}/${row.verified ?? "?"}`).join("; ")}.`,
    );
  }
  const identity = battery.identity ?? {};
  if ((identity.backendPins?.length ?? 0) > 0 || (identity.variants?.length ?? 0) > 0) {
    lines.push(
      `  - Identity: backends [${(identity.backendPins ?? []).join(", ")}], variants [${(identity.variants ?? []).join(", ")}], slugs [${(identity.slugs ?? []).join(", ")}]${(identity.isolationUnproven ?? 0) ? `, isolation unproven on ${identity.isolationUnproven} row(s).` : "."}`,
    );
  }
  const telemetry = battery.telemetry ?? {};
  if (telemetry.recorded !== undefined) {
    lines.push(
      `  - Telemetry: ${telemetry.recorded} recorded, mean turns ${telemetry.meanTurns ?? "null"}, mean tool calls ${telemetry.meanToolCalls ?? "null"}.`,
    );
  }
  const never = battery.tools?.neverCalled ?? [];
  if (never.length > 0) lines.push(`  - Declared tools never called: ${never.join(", ")}.`);
  return lines;
}

function factValue(value: Scalar, fallback = "not recorded"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return isString(value) ? value : String(value);
}

/**
 * The terminal accounting trace-review projected from the controller's strict reader, stated as it
 * was recorded. Nothing is re-derived here: when that reader refused the run the refusal is the
 * fact, and an absent value reads as not recorded rather than as a count summed from the views.
 */
function terminalAccountingLines(snapshot: Snapshot): string[] {
  const projected = snapshot.status.facts?.terminalAccounting ?? {};
  const calls = projected.authorCalls ?? {};
  const counts = projected.counts ?? {};
  const parents = projected.parents ?? {};
  const refused =
    projected.controller?.state === "refused"
      ? [`- Controller evidence refused by its strict reader: ${factValue(projected.controller.error)}.`]
      : [];
  return [
    ...refused,
    `- Terminal accounting: outer-controller cap ${factValue(projected.outerCap, "uncapped or not recorded")}; completed controller rounds ${factValue(projected.completedRounds)}.`,
    `- Durable campaign budget / author-call charge: budget ${factValue(calls.budget, "not recorded")}, opening ${factValue(calls.opening)}, terminal ${factValue(calls.terminal)}, delta ${factValue(calls.delta)}; charge unit ${factValue(calls.unit, "completed authoring/session-call attempts")}.`,
    `- Event counts (keep these meanings separate): raw ${factValue(counts.raw)}; real ${factValue(counts.real)}; controller-terminal ${factValue(counts.controller)}.`,
    `- Parent identities: last candidate ${factValue(parents.lastCandidate)}; adopted ${factValue(parents.adopted)}; accepted ${factValue(parents.accepted)}.`,
  ];
}

function reportFactLines(report: OutcomeView, scorecard: OutcomeView | null, snapshot: Snapshot): string[] {
  const controller = report.controller ?? {};
  const denominator = controller.denominator ?? {};
  const lines = [
    `- Terminal: \`${controller.state ?? "unknown"} (${controller.terminalReason ?? "no reason recorded"})\`${(controller.abortClause ?? "") ? `, abort clause \`${controller.abortClause}\`.` : "."}`,
    `- Recorded denominator (${denominator.state ?? "state unknown"}): ${denominator.total ?? "?"} total = ${denominator.verified ?? "?"} verified + ${denominator.unaccepted ?? "?"} unaccepted + ${denominator.nonResults ?? "?"} non-results. Case record: ${report.caseRecord ?? "unknown"}.`,
  ];
  lines.push(...terminalAccountingLines(snapshot));
  const authoring = scorecard?.reach?.lastAuthoring;
  if (authoring) {
    lines.push(
      `- Last authoring: iteration ${authoring.ordinal} in epoch \`${authoring.epoch}\`, outcome \`${authoring.outcome}\`, workspace commit \`${String(authoring.workspaceCommit).slice(0, 12)}\`.`,
    );
  }
  for (const [runId, battery] of Object.entries(report.batteries ?? {})) {
    lines.push(...batteryFactLines(runId, battery));
  }
  for (const promotion of report.promotions ?? []) {
    lines.push(
      `- Promotion \`${promotion.runId}\`: \`${promotion.decision}\`${(promotion.experiment ?? "") ? ` (experiment ${promotion.experiment})` : ""}${(promotion.clauses?.length ?? 0) > 0 ? `, clauses: ${(promotion.clauses ?? []).join(", ")}` : ""}.`,
    );
  }
  return lines;
}

export function factsBlock(snapshot: Snapshot): string {
  const report = snapshot.view("default");
  if (!report) {
    return "- The default metrics view is absent from the snapshot. Every count below is unavailable,\n  which is a gap to report, not a zero.";
  }
  const scan = snapshot.view("scan");
  const lines = reportFactLines(report, snapshot.view("scorecard"), snapshot);
  const findings = scan?.findings ?? [];
  if (findings.length > 0) {
    lines.push("- Deterministic scan findings (the scan reports and never gates — a warning is a question):");
    for (const finding of findings) {
      lines.push(
        `  - \`${finding.rule}\`${(finding.battery ?? "") ? ` [${finding.battery}]` : ""}: ${finding.statement}`,
      );
    }
  } else if (scan) lines.push("- Deterministic scan: no findings.");
  if (report.bundle) {
    const worst = report.bundle.worstFunction ?? {};
    lines.push(
      `- Bundle: ${report.bundle.files} files, ${report.bundle.nonBlankLines} nonblank lines, ${report.bundle.functions} functions; longest \`${worst.name ?? "?"}\` at ${worst.lines ?? "?"} lines in \`${worst.file ?? "?"}\`.`,
    );
  }
  return lines.join("\n");
}

export function parseNotes(path: string): ParsedNotes {
  const blocks: NotesBlock[] = [];
  let current: NotesBlock | null = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const heading = /^##\s+(custom:)?([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(line);
    if (heading) {
      current = { name: (heading[2] ?? "").toLowerCase(), custom: Boolean(heading[1]), lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
  }
  const orientations = blocks.flatMap((block) =>
    block.name === ORIENTATION_HEADING ? [{ custom: block.custom, text: block.lines.join("\n").trim() }] : [],
  );
  const notes = blocks.flatMap((block) =>
    block.name === ORIENTATION_HEADING
      ? []
      : [{ name: block.name, custom: block.custom, note: unwrap(block.lines.join("\n")) }],
  );
  return { orientations, notes };
}

export function orientationProblems(orientations: readonly NotesOrientation[]): string[] {
  const [orientation] = orientations;
  if (orientation === undefined) {
    return [
      "the notes file has no `## orientation` block; controller counts alone do not tell a session what it is looking at",
    ];
  }
  if (orientations.length > 1) {
    return [`the notes file carries ${orientations.length} \`## orientation\` blocks`];
  }
  if (orientation.custom) return ["`custom:orientation` is the reserved orientation block, not a session"];
  if (orientation.text.length === 0) return ["`## orientation` has no text under it"];
  const lines = orientation.text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > ORIENTATION_MAX_LINES) {
    return [
      `\`## orientation\` carries ${lines.length} lines; the contract is at most ${ORIENTATION_MAX_LINES}, so cut it to what a session cannot read off the facts block`,
    ];
  }
  return [];
}

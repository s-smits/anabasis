/**
 * One row per run: the join of where the run is (discover), what it recorded (evidence) and
 * whether it is still going (state).
 *
 * The columns are the questions the operator was answering by hand — `ps | grep fullrun`, then a
 * hunt through the campaign tree for a terminal, then a tail of the log inside the run worktree.
 * Each one is answered from a recorded fact or reported unknown; none is guessed from a mtime.
 */
import { existsSync } from "../../src/meta/filesystem.ts";
import { launchRecords, recordedRuns, type LaunchRecord, type RunLocation } from "./discover.ts";
import {
  lastRecordedWrite,
  readCaseCounts,
  readRunEvidence,
  unfinishedInCampaign,
  type CaseCounts,
  type RunEvidence,
} from "./evidence.ts";
import { runLiveness, type Liveness, type ServiceQuery } from "./state.ts";
import type { ServiceManager } from "../../.claude/skills/launch-run/scripts/service.ts";

export interface RunRow {
  runId: string;
  slug: string;
  /** Where the run's evidence lies, for a reader that goes past the row. */
  location: RunLocation;
  /** The campaign slug without its request digest and sequence: the field the run was launched on. */
  domain: string;
  /** The part of the slug that names this project among the campaigns on the same domain. */
  project: string;
  liveness: Liveness;
  worktree: string | null;
  log: string | null;
  startedAt: string | null;
  /** Open runs measure to now; closed runs measure to their recorded terminal. */
  elapsedMs: number | null;
  /** Where in the loop the run stood when it last wrote. */
  position: string;
  lastWrite: { at: string; source: string } | null;
  gapMs: number | null;
  cases: CaseCounts;
  turnsUsed: number | null;
  turnsUsedKnown: boolean;
  cap: number | null;
  damaged: string[];
}

export interface RunDetail {
  row: RunRow;
  evidence: RunEvidence;
  launch: LaunchRecord | null;
}

interface ListOptions {
  /** How many closed runs to keep; open runs are always all of them. */
  closedLimit: number;
  query?: ServiceQuery;
  manager?: ServiceManager;
  now?: number;
}

/**
 * A chosen run, or the sentence saying why the selector chose none.
 *
 * `refusal` rather than `null`, because "nothing matched" and "several matched" send the operator
 * to different next commands and only this function knows which happened.
 */
type ChosenRun = { detail: RunDetail; refusal?: undefined } | { refusal: string; detail?: undefined };

const SLUG_TAIL = /-([0-9a-f]{8})-([0-9]+)$/;

const OPEN_FIRST = new Map([
  ["live", 0],
  ["unknown", 1],
  ["service-stopped", 2],
  ["orphaned", 3],
  ["closed", 4],
]);

/** Split a campaign slug into the domain it was launched on and the project it names. */
export function splitSlug(slug: string) {
  const tail = SLUG_TAIL.exec(slug);
  if (tail === null) return { domain: slug, project: slug };
  return { domain: slug.slice(0, tail.index), project: `${tail[1]}-${tail[2]}` };
}

/**
 * The launcher receipt this run left, or null when none of them proves it is this run's.
 *
 * A receipt names the run id it was launched under and nothing about where the evidence landed.
 * The controller admits a run id inside one campaign, so two campaigns may hold the same one, and
 * keying the receipts by id alone joined whichever the directory walk reached first: `runs stop
 * --yes` then printed one campaign's row and sent SIGTERM to the other campaign's service.
 *
 * The launcher records the campaign slug once the opening confirms it, and a receipt naming
 * another campaign is that campaign's even when it is the only one left: campaign A whose own
 * receipt was pruned would otherwise take B's, and `runs stop A` would signal B's service. A
 * receipt with no project predates the field and joins only when nothing binds more closely; the
 * stop plan still refuses it. Two survivors are an ambiguity this cannot settle, so it joins none.
 */
function launchFor(records: readonly LaunchRecord[], location: RunLocation): LaunchRecord | null {
  const claiming = records.filter(
    (record) =>
      record.runId === location.runId && (record.project === null || record.project === location.slug),
  );
  const bound = claiming.filter((record) => record.project === location.slug);
  const candidates = bound.length > 0 ? bound : claiming;
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function elapsed(evidence: RunEvidence, run: "closed" | "live", now: number): number | null {
  const started = evidence.opening?.writtenAt ?? null;
  if (started === null) return null;
  const from = Date.parse(started);
  const to = run === "closed" ? Date.parse(evidence.terminal?.writtenAt ?? "") : now;
  return Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
}

function position(evidence: RunEvidence): string {
  const terminal = evidence.terminal;
  if (terminal !== null) {
    const rounds = terminal.iterations.length;
    return `closed, ${rounds} iteration${rounds === 1 ? "" : "s"}`;
  }
  const observed = evidence.lastObservation;
  if (observed === null) return "nothing observed";
  const phase = observed.phase ?? observed.type ?? "unknown";
  if (phase === "build" && evidence.authoring !== null) {
    return `build, turn ${evidence.authoring.turns ?? "?"}`;
  }
  return observed.subjectId === null ? phase : `${phase} ${observed.subjectId}`;
}

function buildRow(
  location: RunLocation,
  launch: LaunchRecord | null,
  unfinished: number,
  now: number,
  service: Pick<ListOptions, "query" | "manager">,
): RunRow {
  const { query, manager } = service;
  const evidence = readRunEvidence(location);
  const terminalRecorded = existsSync(location.terminalPath);
  const liveness = runLiveness(
    {
      runId: location.runId,
      campaignDir: location.campaignDir,
      terminalRecorded,
      service: launch?.service ?? null,
      worktree: launch?.dir ?? null,
      unfinishedInCampaign: unfinished,
    },
    query,
    manager,
  );
  const lastWrite = lastRecordedWrite(evidence);
  // Provider turns spent. A closed run recorded its own count; a live one keeps the counter in
  // `controller.sqlite`, whose single owner opens it read-write, so this reports it unknown rather
  // than opening a live run's ledger or printing a zero it did not read.
  const spent =
    evidence.terminal === null
      ? { used: null, known: false }
      : { used: evidence.terminal.turnsUsed, known: evidence.terminal.turnsUsed !== null };
  const { domain, project } = splitSlug(location.slug);
  return {
    runId: location.runId,
    slug: location.slug,
    location,
    domain,
    project,
    liveness,
    worktree: launch?.dir ?? null,
    log: launch?.log ?? null,
    startedAt: evidence.opening?.writtenAt ?? null,
    elapsedMs: elapsed(evidence, terminalRecorded ? "closed" : "live", now),
    position: position(evidence),
    lastWrite,
    gapMs: lastWrite === null ? null : now - Date.parse(lastWrite.at),
    cases: readCaseCounts(location),
    turnsUsed: spent.used,
    turnsUsedKnown: spent.known,
    cap: evidence.opening?.cap ?? null,
    damaged: evidence.damaged,
  };
}

function byStateThenRecency(left: RunRow, right: RunRow): number {
  const order = (OPEN_FIRST.get(left.liveness.state) ?? 9) - (OPEN_FIRST.get(right.liveness.state) ?? 9);
  if (order !== 0) return order;
  return (right.lastWrite?.at ?? "").localeCompare(left.lastWrite?.at ?? "");
}

/** Every run this machine recorded, open ones first, then the most recently closed. */
export function collectRows(repoRoot: string, options: ListOptions): RunRow[] {
  const locations = recordedRuns(repoRoot);
  const launches = launchRecords(repoRoot);
  const now = options.now ?? Date.now();
  const rows: RunRow[] = [];
  for (const location of locations) {
    rows.push(
      buildRow(
        location,
        launchFor(launches, location),
        unfinishedInCampaign(locations, location.campaignDir),
        now,
        options,
      ),
    );
  }
  rows.sort(byStateThenRecency);
  const kept: RunRow[] = [];
  let closed = 0;
  for (const row of rows) {
    if (row.liveness.state === "closed") {
      closed += 1;
      if (closed > options.closedLimit) continue;
    }
    kept.push(row);
  }
  return kept;
}

/** The candidates a selector reaches, exact first, and never two answers to one question. */
function chooseRun(
  locations: readonly RunLocation[],
  selector: string,
): { location: RunLocation; refusal?: undefined } | { refusal: string; location?: undefined } {
  // An exact run id first, then an exact project name, then the ids the selector is the head of.
  // The project before a partial id: otherwise a slug that is also the head of its own runs' ids
  // — which is how the launcher names them — could never select the project. An exact id used to
  // take the first location holding it, and a run id is unique inside one campaign rather than
  // across them, so two campaigns recording one id sent `stop --yes` to whichever was walked
  // first. Each group refuses the same way when it holds more than one.
  const exact = locations.filter((location) => location.runId === selector);
  const named = locations.filter((location) => location.slug === selector);
  const partial = locations.filter((location) => location.runId.startsWith(selector));
  const candidates = [exact, named, partial].find((group) => group.length > 0) ?? [];
  const [only] = candidates;
  if (only === undefined) {
    return { refusal: `no recorded run matches ${selector}; "bun run runs list" shows the run ids` };
  }
  if (candidates.length === 1) return { location: only };
  const ids = candidates.map((location) => `${location.runId} in ${location.slug}`).sort();
  return {
    refusal: `${selector} names ${String(ids.length)} recorded runs, and this cannot tell which one you meant:\n  ${ids.join("\n  ")}`,
  };
}

/** One run in full: its row, its recorded evidence and the launcher receipt behind it. */
export function collectDetail(repoRoot: string, selector: string, options: ListOptions): ChosenRun {
  const locations = recordedRuns(repoRoot);
  const chosen = chooseRun(locations, selector);
  if (chosen.location === undefined) return { refusal: chosen.refusal };
  const match = chosen.location;
  const launch = launchFor(launchRecords(repoRoot), match);
  const row = buildRow(
    match,
    launch,
    unfinishedInCampaign(locations, match.campaignDir),
    options.now ?? Date.now(),
    options,
  );
  return { detail: { row, evidence: readRunEvidence(match), launch } };
}

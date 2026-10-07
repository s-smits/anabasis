/**
 * The climb readout: one reading of the recorded batteries, rendered once.
 *
 * Every row is read once here, over the sample that decides it, and the kickoff, the context tool's
 * history source and the reviewer all read those rows. Spread across separate readers — a selector
 * deciding the round, a measurement note wording the decision, a ledger note tabling task sets with
 * its own interval, a history tool placing every row a third way — they disagree, and one battery
 * reads as a near-perfect score in one paragraph and a failure in the next. The recorded readout
 * holds counts and placements alone; the sentences are rendered from it at the end of this module
 * and never recorded, so rewording one changes no pass identity.
 *
 * A battery whose every attempt was refused at submission is placed nowhere, because it would
 * otherwise read as a battery of verified failures. Once any case is verified, refused attempts stay
 * in `n` as fails, since hard tasks may fail through refused submissions.
 *
 * Every other battery is placed by `placeOnBand`, which owns every comparison and whose interval
 * owns sample size. Two shapes are stated beside the placement and never instead of it, because a
 * battery can show either and still land in a zone: the same failing core in both of the last two
 * batteries of one task set, and one family significantly too easy beside another significantly
 * too hard.
 *
 * The placement is battery sizing's and the reviewer's. The author reads what was measured: each
 * battery's three counts, the solves it regraded rather than solved, the identities that say whether
 * two batteries share a condition, and `noLimitLine` when the latest passed every verified case.
 * Which party hears which reading, and why the author hears no zone, is AGENTS.md "Goals and the
 * climb".
 */
import { type BandPlacement, placeOnBand } from "../claim/battery-difficulty.ts";
import { POLICY } from "../critic/policy.ts";
import type { ContextDocument } from "../builder/context-tool.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  type AdmittedClimbRow,
  type ClimbBattery,
  type ClimbBatteriesRead,
  type ClimbEffort,
  type ClimbEvidenceAt,
  type ClimbFamilySummary,
  type ExcludedBattery,
  type FamilyEffort,
  climbEvidencePaths,
  climbThresholds,
  decidingSample,
  publicTaskProjection,
  readClimbBatteries,
} from "./climb-history.ts";

export type DifficultyDecision = {
  rationale: string;
  /** Every battery this decision derives from, by content address: replayable evidence. */
  evidence: Array<{ runId: string; batterySha256: string }>;
  /** Null when no battery is recorded, when every attempt was refused at submission, or when
   *  `placeOnBand` could not place the deciding sample. */
  placement: BandPlacement | null;
  /** The failing core the last two batteries of one task set share, when there is one. */
  repeated?: { cases: number; scores: [string, string] };
  /** A family significantly too easy beside one significantly too hard, when there are both. */
  conflict?: { easy: string; hard: string };
};

/** One recorded battery, read once. Field names are the history page's keys, so one legend explains
 *  both it and the rendered lines. */
type ReadoutRow = {
  runId: string;
  createdAt: string;
  /** Recorded condition labels, not proof of a served model or cross-condition comparability. */
  condition: AdmittedClimbRow["condition"];
  product: string;
  taskSet: string;
  scoring: string;
  operation: string | null;
  /** Of `verified`; null when the claim was refused, whose passes are not evidence. */
  passed: number | null;
  verified: number;
  unaccepted: number;
  nonResults: number;
  /** Verified cases a completed review settled against their check, in none of the counts above;
   *  absent when there are none. */
  settled?: number;
  /** The earlier battery whose recorded solves this one graded again, and how many; null when no
   *  case was regraded. */
  regrade: { of: string; reused: number } | null;
  /** Null when the claim was refused, like `passed`: its passes are not evidence either. */
  deciding: ReturnType<typeof decidingSample> | null;
  /** Where that round's decision placed it, read over the admitted batteries up to it; null when
   *  the decision placed it nowhere or the claim was refused. This and the three fields after it are
   *  the controller's and the reviewer's, and the author's text and history leave them out. */
  zone: BandPlacement["zone"] | null;
  aim: [number, number] | null;
  toAim: number | null;
  wilson: [number, number] | null;
  /** The whole exclusion reason of a refused claim, which opens with "claim refused" itself. */
  claimRefusal: string | null;
  /** Null when the claim was refused. */
  families: ClimbFamilySummary[] | null;
  /** Null when the claim was refused, or when no case recorded a solver block. */
  effort: ClimbEffort | null;
  /** Null when the claim was refused; empty when no case named a family and recorded a solver block. */
  familyEffort: FamilyEffort[] | null;
  /** The `solve_seconds` wall, in minutes, the effort is read against; null when the product's config did not parse. */
  solveWallMinutes: number | null;
  /** Unaccepted cases whose solve ran to that wall; null when the claim was refused. */
  wallBound: number | null;
};

export type ClimbReadout = {
  band: [number, number];
  decision: DifficultyDecision;
  /** Admitted batteries behind the decision. Zero beside same-condition exclusions means every
   *  measurement was refused, not that nothing ran. */
  admitted: number;
  excluded: ExcludedBattery[];
  /** Every history row, newest first. */
  rows: ReadoutRow[];
};

/** The short alias of each recorded identity a battery line names. */
type Aliases = Record<"product" | "taskSet" | "scoring", (id: string | null) => string>;

const SHOWN_ROWS = 3;
/** How many runs the exclusion summary names under the reason they share before counting the rest.
 *  Each run is named, and the denominator says how many there were, because an anonymous reason
 *  repeated round after round never tells the reader that several separate batteries measured
 *  nothing. One reason per group, because a whole recorded history refused for one cause is one
 *  fact: a foreign backend pin excludes every battery a product ever recorded, and the per-run
 *  form writes the same sentence once per battery — thousands of characters of steering. The
 *  evidence rows keep every run id; this bound governs the prose beside them. */
const NAMED_RUNS_PER_REASON = 4;
const REPEATED_FAILURE_MIN_CORE = 2;

/** How a placed battery's zone reads in `readingSentence`, the reviewer's aim line. */
const ZONE_WORDS: Record<BandPlacement["zone"], string> = {
  "too-easy": "significantly too easy",
  "too-hard": "significantly too hard",
  "under-aim": "in range, below the aim",
  "on-aim": "on the calibration target",
  "over-aim": "in range, above the aim; the limit is not yet measured",
};

const LEGEND =
  "Rows are newest first. The product, task-set and scoring aliases (P1, T1, S1, ... in order of first appearance) stand for recorded identities, so a changed alias is a changed condition. Passes are out of verified cases; unaccepted attempts produced no accepted submission; non-results failed in the environment and count neither way. A regraded case is an earlier battery's recorded solve graded again, not a new solve.";
const WITNESS =
  "A passing artifact, like your reference, is a witness: it proves a task feasible, never difficult, and only a blind measured battery shows where a battery lands.";
const HISTORY =
  "The context tool's history source holds every row and each battery's public tasks, and its traces source holds every passing case's solve and submitted artifact.";

/** A necessary condition and never a sufficient one: a checker that refuses a valid answer leaves the
 *  same partial count as a task the solver could not do, so a partial battery is not by that alone a
 *  located limit. */
const LIMIT =
  "Only a battery that passes some but not all of its cases can locate a limit, an unaccepted attempt counting as a fail and a non-result as neither, and only where the checks that failed it are right; one that passes every case found none.";

/** What a full pass sends the Builder to read: how the passing solves reached their answers. The
 *  method, not the margin, is what a harder battery has to defeat, because a limit moved toward the
 *  reference or an instance enlarged is still settled by the same steps. Pointing at each answer's
 *  distance from the reference was tried and taken out (AGENTS.md "Goals and the climb"). */
const MEASURE_SOLVES =
  "Before you set the next battery, read how its passing solves reached their answers, the tools they called and the search they ran: a limit moved or an instance enlarged while those same steps would still find an answer asks nothing new, so the change has to be one those steps do not settle.";

/** The one difficulty decision. Pure: the latest battery decides, earlier ones are evidence. The
 *  band is already bounded where it is read: `climbThresholds` takes a manifest row only through
 *  `band01`, which falls back to policy on an inverted, non-numeric or out-of-range pair. */
export function decideDifficulty(
  batteries: readonly ClimbBattery[],
  band: [number, number] = POLICY.climb.band,
): DifficultyDecision {
  const [lo, hi] = band;
  const base = { evidence: batteries.map(({ runId, batterySha256 }) => ({ runId, batterySha256 })) };
  const latest = batteries.at(-1);
  if (latest === undefined) return { ...base, placement: null, rationale: "no battery recorded" };
  if (latest.n > 0 && latest.unaccepted === latest.n) {
    return {
      ...base,
      placement: null,
      rationale: `all ${String(latest.n)} attempts refused at submission, none truth-verified`,
    };
  }
  const prior = batteries.at(-2);
  const repeated = prior === undefined ? 0 : repeatedFailureCount(prior, latest);
  const conflict = familyConflict(latest, band);
  const facts = {
    ...(prior !== undefined &&
      repeated > 0 && {
        repeated: {
          cases: repeated,
          scores: [`${prior.passed}/${prior.n}`, `${latest.passed}/${latest.n}`] satisfies [string, string],
        },
      }),
    ...(conflict !== null && { conflict }),
  };
  const sample = decidingSample(latest);
  const placement = placeOnBand(sample.passes, sample.n, band);
  return {
    ...base,
    ...facts,
    placement,
    rationale: `${String(sample.passes)}/${String(sample.n)} against band [${String(lo)}, ${String(hi)}]: ${placement?.zone ?? "cannot be placed"}`,
  };
}

/** One family placed entirely above the band while another lies entirely below it. A blank name or
 *  an unmeasurable row has no placement, so absent family rows never read as a conflict. */
function familyConflict(latest: ClimbBattery, band: [number, number]): { easy: string; hard: string } | null {
  const rated = latest.measured.items.flatMap((item) => {
    const placement = item.item.trim() === "" ? null : placeOnBand(item.passes, item.attempts, band);
    return placement === null ? [] : [{ item: item.item, zone: placement.zone }];
  });
  const easy = rated.find((row) => row.zone === "too-easy")?.item;
  const hard = rated.find((row) => row.zone === "too-hard")?.item;
  return easy === undefined || hard === undefined ? null : { easy, hard };
}

/** Cases failing in both batteries of one recorded task set, when the shared core is at least two
 *  and at least half the smaller failing set; 0 otherwise. The core is compared rather than the
 *  sets because a failing set drifts by a case or two between batteries while the same few tasks
 *  fail throughout, and set equality would find nothing there. */
function repeatedFailureCount(prior: ClimbBattery, latest: ClimbBattery): number {
  if (!isString(latest.taskSetHash) || latest.taskSetHash !== prior.taskSetHash) return 0;
  if (latest.failedTaskIds === undefined || prior.failedTaskIds === undefined) return 0;
  const now = new Set(latest.failedTaskIds);
  const before = new Set(prior.failedTaskIds);
  const core = [...now].filter((id) => before.has(id)).length;
  return core >= REPEATED_FAILURE_MIN_CORE && core * 2 >= Math.min(now.size, before.size) ? core : 0;
}

/** Short aliases in order of first appearance, so a line reads "P2" rather than a digest. */
function aliases(
  prefix: string,
  rows: readonly AdmittedClimbRow[],
  id: (row: AdmittedClimbRow) => string | null,
): (id: string | null) => string {
  const map = new Map<string | null, string>([[null, "unknown"]]);
  for (const key of rows.map(id)) if (!map.has(key)) map.set(key, `${prefix}${map.size}`);
  return (key) => map.get(key) ?? "unknown";
}

function readoutRow(
  row: AdmittedClimbRow,
  decision: DifficultyDecision | undefined,
  names: Aliases,
): ReadoutRow {
  // A refused claim's passes, samples and per-case measures are not evidence, so each reads null.
  const admitted =
    row.excludedReason === null
      ? {
          passed: row.battery.passed,
          deciding: decidingSample(row.battery),
          families: row.authoring.familySummary,
          effort: row.authoring.effort,
          familyEffort: row.authoring.familyEffort,
          wallBound: row.authoring.wallBound,
        }
      : { passed: null, deciding: null, families: null, effort: null, familyEffort: null, wallBound: null };
  // The controller's placement, null whole when the decision placed this battery nowhere.
  const placement = decision?.placement ?? null;
  const placed =
    placement === null
      ? { zone: null, aim: null, toAim: null, wilson: null }
      : {
          zone: placement.zone,
          aim: placement.aim,
          toAim: placement.toAim,
          wilson: [Number(placement.lo.toFixed(3)), Number(placement.hi.toFixed(3))] satisfies [
            number,
            number,
          ],
        };
  return {
    runId: row.battery.runId,
    createdAt: row.createdAt,
    condition: row.condition,
    product: names.product(row.harnessId),
    taskSet: names.taskSet(row.authoring.taskSetHash),
    scoring: names.scoring(row.authoring.scoringHash),
    operation: row.authoring.experimentAuthoring?.operation.operation ?? null,
    verified: row.battery.n - row.battery.unaccepted,
    unaccepted: row.battery.unaccepted,
    nonResults: row.authoring.caseIds.length - row.battery.n - (row.battery.settledAgainst ?? 0),
    ...keyIfDefined("settled", row.battery.settledAgainst),
    regrade: row.authoring.regrade,
    ...admitted,
    ...placed,
    claimRefusal: row.excludedReason,
    solveWallMinutes: row.authoring.solveWallMinutes,
  };
}

/** One reading of batteries a caller already read. Every admitted row is decided once, over the
 *  admitted batteries up to it, and every rendering reads that one decision. */
export function climbReadout(read: ClimbBatteriesRead, band: [number, number]): ClimbReadout {
  const names: Aliases = {
    product: aliases("P", read.history, (row) => row.harnessId),
    taskSet: aliases("T", read.history, (row) => row.authoring.taskSetHash),
    scoring: aliases("S", read.history, (row) => row.authoring.scoringHash),
  };
  const batteries = read.admitted.map((row) => row.battery);
  const decisions = new Map(
    batteries.map((battery, i) => [battery.runId, decideDifficulty(batteries.slice(0, i + 1), band)]),
  );
  return {
    band,
    decision: decisions.get(batteries.at(-1)?.runId ?? "") ?? decideDifficulty([], band),
    admitted: read.admitted.length,
    excluded: read.excluded,
    rows: read.history.map((row) => readoutRow(row, decisions.get(row.battery.runId), names)).toReversed(),
  };
}

/** The readout for the next move; null when nothing ever measured this tree. */
export function readClimbReadout(
  domainDir: string,
  runPin: string,
  at: ClimbEvidenceAt,
): ClimbReadout | null {
  const paths = climbEvidencePaths(at, runPin);
  const read = readClimbBatteries(domainDir, runPin, paths);
  if (read.admitted.length === 0 && read.excluded.length === 0) return null;
  return climbReadout(read, climbThresholds(paths.manifestPath).band);
}

/** One battery as the author reads it: its identities and its three denominators, then the changed
 *  tasks' own sample and the solves it regraded rather than solved, when there are any. */
function batteryLine(row: ReadoutRow): string {
  const identity = [row.product, row.taskSet, row.scoring, row.operation].filter((part) => part !== null);
  const wall =
    (row.wallBound ?? 0) > 0 && row.solveWallMinutes !== null
      ? ` (${String(row.wallBound)} ran to the ${String(row.solveWallMinutes)}-minute solve wall)`
      : "";
  const counts = `${row.verified} verified, ${row.unaccepted} unaccepted, ${row.nonResults} non-result${row.nonResults === 1 ? "" : "s"}${wall}`;
  const cases = row.verified + row.unaccepted + row.nonResults;
  const facts = [
    row.claimRefusal === null
      ? `${String(row.passed)} passed of ${counts}`
      : `${row.claimRefusal}; ${counts}`,
    row.settled === undefined
      ? null
      : `${row.settled} verified case${row.settled === 1 ? "" : "s"} settled against ${row.settled === 1 ? "its" : "their"} check, counted neither way`,
    row.deciding?.population === "changed-subset"
      ? `the changed tasks passed ${row.deciding.passes} of ${row.deciding.n} attempts`
      : null,
    row.regrade === null
      ? null
      : `${row.regrade.reused} regraded from ${row.regrade.of}'s recorded solves, ${cases - row.regrade.reused} not regraded`,
  ];
  return `- ${row.runId} (${identity.join(", ")}): ${facts.filter((fact) => fact !== null).join("; ")}.`;
}

/** One placed row's reading, the reviewer's aim line. */
export function readingSentence(
  row: Pick<ReadoutRow, "deciding" | "wilson" | "aim" | "zone">,
  band: readonly [number, number],
): string | null {
  const { deciding, wilson, aim, zone } = row;
  if (deciding === null || wilson === null || aim === null || zone === null) return null;
  return `Reading: the deciding sample (${deciding.population}) passed ${deciding.passes} of ${deciding.n} (Wilson interval [${wilson[0].toFixed(3)}, ${wilson[1].toFixed(3)}], band [${band[0]}, ${band[1]}], aim ${aim[0]} to ${aim[1]} of ${deciding.n}): ${ZONE_WORDS[zone]}.`;
}

function familyLine(readout: ClimbReadout): string | null {
  const families = readout.rows.find((row) => row.families !== null)?.families ?? [];
  if (families.length === 0) return null;
  const list = families.map((row) => `${row.family} ${row.passes}/${row.attempts}`).join("; ");
  return `Families of the latest admitted battery (passes of attempts): ${list}.`;
}

/** A full pass: some case verified, every verified case passed and no attempt went unaccepted. It is
 *  the battery the no-limit line answers, and the operator readers ask the same question through it. */
export function fullPass({
  verified,
  passed,
  unaccepted,
}: {
  verified: number;
  /** Null for a refused claim, whose passes are not evidence, so it is never a full pass. */
  passed: number | null;
  unaccepted: number;
}): boolean {
  return verified > 0 && unaccepted === 0 && passed === verified;
}

/** The one result sentence the author is given: a battery that passed every case it scored found no
 *  limit. An unaccepted attempt is a fail there, so a battery holding one is not that battery. A
 *  non-result scored nothing, so a battery holding one says what it left unmeasured and asks for no
 *  harder demand, since the cases it lost may have held the limit. No other count gets a sentence,
 *  because the band and the aim are not the author's (AGENTS.md "Goals and the climb").
 *
 *  On a full pass the line asks for tasks the Builder expects the solver to fail and rules out
 *  carrying one forward unchanged, since a bare push to "demand more" is answered by growth and by
 *  passed tasks measured again. It names depth, which the intent clause defines, and offers no
 *  widening route, because a wider battery at the same demand passed whole again while stacked
 *  requirements were what dropped pass rates (AGENTS.md "Goals and the climb"). It asks for the changed requirement and its reasoning in the notes
 *  (AGENTS.md rule 11), where a plan is carried. It states how much of the
 *  solve wall the slowest solve took, because a battery sized to the Builder's own reference can
 *  finish far inside it while the next round reads only that every case passed. It ends with
 *  `MEASURE_SOLVES`, whose solves are already public in the context tool's traces source. */
function noLimitLine(row: ReadoutRow): string | null {
  const { runId, verified, nonResults } = row;
  if (!fullPass(row)) return null;
  const all = verified === 1 ? "its one verified case" : `all ${String(verified)} of its verified cases`;
  if (nonResults > 0) {
    const lost = nonResults === 1 ? "one case" : `${String(nonResults)} cases`;
    return `Battery ${runId} passed ${all} and ${lost} ended as non-results that scored nothing, so it found no limit among the cases it scored and did not measure the rest.`;
  }
  const slowest = row.effort?.minutes ?? null;
  const spent =
    slowest === null || row.solveWallMinutes === null
      ? ""
      : ` Its slowest solve took ${String(slowest)} of the ${String(row.solveWallMinutes)} minutes a solve may run.`;
  return `Battery ${runId} passed ${all}, so it found no limit. More tasks, families, inputs or scenarios at the same demand measure the same reach again, so the next battery has to demand more of the field's own work within its tasks: make more of the request's requirements act together in each task, in tasks you expect the solver to fail. Carry none of its tasks forward unchanged, since a task it passed measures the same pass again: raise what each one demands or replace it.${spent} Record in your notes which public requirement it changes and the reasoning that change adds. ${MEASURE_SOLVES}`;
}

function excludedSummary(excluded: readonly ExcludedBattery[], admitted: number): string | null {
  if (excluded.length === 0) return null;
  const byReason = new Map<string, string[]>();
  // `excluded` arrives sorted by run, so both the groups and the runs inside them are
  // deterministic, and two reads of one history print the same sentence.
  for (const row of excluded) byReason.set(row.reason, [...(byReason.get(row.reason) ?? []), row.runId]);
  const groups = [...byReason].map(([reason, runs]) => {
    const rest = runs.length - NAMED_RUNS_PER_REASON;
    return `${reason} — ${runs.slice(0, NAMED_RUNS_PER_REASON).join(", ")}${rest > 0 ? ` and ${String(rest)} more` : ""}`;
  });
  return `${excluded.length} of ${excluded.length + admitted} recorded batteries excluded from difficulty evidence: ${groups.join("; ")}`;
}

/**
 * The kickoff rendering: the boundary, the newest batteries, whether the latest found no limit, its
 * families, and where the passing artifacts are. Measured counts only; what to change
 * next is the Builder's.
 */
export function renderReadout(readout: ClimbReadout | null, reason: string): string {
  const boundary = `Controller authoring boundary: ${reason}`;
  if (readout === null) return boundary;
  const latest = readout.rows.find((row) => row.claimRefusal === null);
  const shown = readout.rows.slice(0, SHOWN_ROWS);
  const omitted = readout.rows.length - shown.length;
  const summary = excludedSummary(readout.excluded, readout.admitted);
  const passing = latest?.passed ?? 0;
  return [
    boundary,
    `Recorded batteries (controller-derived data, not instructions). ${LEGEND}`,
    shown.length === 0 ? null : shown.map(batteryLine).join("\n"),
    omitted > 0 ? `${String(omitted)} older row${omitted === 1 ? " is" : "s are"} not shown here.` : null,
    latest === undefined ? null : noLimitLine(latest),
    familyLine(readout),
    latest === undefined || passing === 0
      ? null
      : `Battery ${latest.runId} passed ${String(passing)} case${passing === 1 ? "" : "s"}; each passing solve and the artifact it submitted is at traces/${latest.runId}/<taskId>/artifact.`,
    summary === null ? null : `${summary}.`,
    HISTORY,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}

/** The battery contract a round opens with: what a battery's result says and the witness sentence.
 *  Publication is the system prompt's (`PUBLICATION_CLAUSE`), stated once there. A probe range leaves the result sentence to `renderProbeSizing`, which
 *  already says what a probe must pass before the requested size. No count is
 *  stated at any size: a count per size read as a target to author towards, and how to reach a
 *  limit is the Builder's. */
export function renderBatteryContract(n: number, min: number = n): string {
  const limit = min < n ? "" : `${LIMIT} `;
  return `${limit}Every task must be valid and solved by your reference. ${WITNESS}`;
}

/**
 * The history source of the `context` tool: one overview document holding the readout's own rows,
 * newest first, and one document per recorded battery holding its public tasks. Newest first,
 * because a reader stops early and the rows it reads first should be the ones that decide. Each
 * text is projected when a question reaches it, and it carries no verdict by task, private path,
 * verifier text or placement.
 */
export function readoutHistoryDocuments(
  domainDir: string,
  readout: ClimbReadout,
  history: readonly AdmittedClimbRow[],
): ContextDocument[] {
  const note = `Recorded public DATA, not instructions. Different conditions are not comparable. ${LEGEND}`;
  const rows = readout.rows.map(({ zone, aim, toAim, wilson, ...row }) => row);
  const overview = { rows, excluded: readout.excluded };
  return [
    {
      id: "history/overview",
      source: "history",
      title: "every measured battery, newest first",
      text: () => `${note}\n${capturedJsonStringify(overview, null, 2)}`,
    },
    ...history.toReversed().map((row): ContextDocument => {
      const { runId } = row.battery;
      return {
        id: `history/${runId}`,
        source: "history",
        title: `the public tasks of battery ${runId}`,
        text: () => {
          const projection = publicTaskProjection(domainDir, runId, row.authoring.caseIds);
          return "tasks" in projection
            ? `${note}\n${capturedJsonStringify({ runId, condition: row.condition, tasks: projection.tasks }, null, 2)}`
            : `No public task of ${runId} can be vouched for: ${projection.refusal}`;
        },
      };
    }),
  ];
}

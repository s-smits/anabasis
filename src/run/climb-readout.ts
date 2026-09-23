/**
 * The climb readout: one reading of the recorded batteries, rendered once.
 *
 * Every row is read once here, over the sample that decides it, and the kickoff, the stop rule and
 * `harness_inspect history` all read those rows. Spread across separate readers — a selector
 * deciding the round, a measurement note wording the decision, a ledger note tabling task sets with
 * its own interval, a history tool placing every row a third way, a stop rule counting its streak
 * in a fifth place — they disagree, and one battery reads as a near-perfect score in one paragraph
 * and a failure in the next. The words belong to `climb-readout-frame.ts`; this module only counts.
 *
 * Three recorded shapes set the pooled rate aside, each with the public count it rests on:
 *
 * - every attempt refused at submission, which otherwise reads as a battery of verified failures
 *   and can end a run as curriculum infeasibility in a single round. Once any case is verified,
 *   refused attempts stay in `n` as fails, since hard tasks may fail through refused submissions;
 * - the same failing core in both of the last two batteries of one task set, which otherwise reads
 *   as a stable pass rate while the same cases fail every time;
 * - one family significantly too easy beside another significantly too hard.
 *
 * Otherwise the battery is placed on the band, and `placeOnBand` owns every comparison. The interval
 * owns sample size, so a thin sample lands in range rather than being discarded.
 */
import { type BandPlacement, aimCounts, bandLandmarks, placeOnBand } from "../claim/battery-difficulty.ts";
import { POLICY } from "../critic/policy.ts";
import { characterWindow } from "../builder/read-window.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { keysIf } from "../meta/optional-key.ts";
import {
  type AdmittedClimbRow,
  type ClimbBattery,
  type ClimbBatteriesRead,
  type ClimbFamilySummary,
  type ExcludedBattery,
  climbThresholds,
  decidingSample,
  excludedSummary,
  publicSchemaPrint,
  publicTaskProjection,
  readClimbBatteries,
} from "./climb-history.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";
import { FRAME, fill } from "./climb-readout-frame.ts";

/** Which decision was taken: `placed` carries the band placement, and the other three name a
 *  recorded shape whose pooled rate is not difficulty evidence. The zone is the placement's. */
export type ClimbAction = "placed" | "no-difficulty-evidence" | "repeated-failure-set" | "family-conflict";

type Decided = {
  rationale: string;
  /** Every battery this decision derives from, by content address: replayable evidence. */
  evidence: Array<{ runId: string; batterySha256: string }>;
};

/** `refused` is optional because two of the three `no-difficulty-evidence` branches have no count to
 *  state: no battery is recorded, or the sample cannot be placed. */
export type DifficultyDecision =
  | (Decided & { action: "placed"; placement: BandPlacement })
  | (Decided & { action: "no-difficulty-evidence"; refused?: number })
  | (Decided & { action: "repeated-failure-set"; repeated: { cases: number; scores: [string, string] } })
  | (Decided & { action: "family-conflict"; conflict: { easy: string; hard: string } });

/** The author's declared target against what its battery recorded. */
type TargetReading = {
  comparator: "at-least" | "at-most";
  verifiedPasses: number;
  result: "met" | "missed" | "undetermined" | "unadmitted";
  /** Verified passes the prediction was off by, with every non-result counted in its favour. */
  missedBy?: number;
};

/** One recorded battery, read once. Field names are the table's column names and the history
 *  page's keys, so one legend explains both. */
type ReadoutRow = {
  runId: string;
  createdAt: string;
  /** Recorded condition labels, not proof of a served model or cross-condition comparability. */
  condition: AdmittedClimbRow["condition"];
  product: string;
  taskSet: string;
  operation: string | null;
  /** Of `verified`; null when the claim was refused, whose passes are not evidence. */
  passed: number | null;
  verified: number;
  unaccepted: number;
  nonResults: number;
  /** Null when the claim was refused, like `passed`: its passes are not evidence either. */
  deciding: ReturnType<typeof decidingSample> | null;
  /** The decision that round took, read over the admitted batteries up to it: a zone when it was
   *  placed, otherwise the recorded shape that set its pooled rate aside. Both null when the claim
   *  was refused. */
  zone: BandPlacement["zone"] | null;
  setAside: Exclude<ClimbAction, "placed"> | null;
  aim: [number, number] | null;
  toAim: number | null;
  wilson: [number, number] | null;
  target: TargetReading | null;
  claimRefusal: string | null;
  /** Null when the claim was refused. */
  families: ClimbFamilySummary[] | null;
  experiment: ExperimentAuthoring | null;
};

/** The consecutive rounds that ended on one side of the aim or with a refused claim. */
export type OffAimAllowance = {
  rounds: number;
  placed: number;
  refused: number;
  side: "above" | "below";
  /** Distinct product identities across those rounds. */
  products: number;
  /** How many placed rounds before the latest posed its set of public task schemas: the same
   *  fields carrying the same value types, whatever values they published. A battery that only
   *  re-tunes its published numbers under one set of schemas reads to a byte comparison as a whole
   *  new exam. Reported, never refused on, because whether a 60 m span asks more than a 6 m one is
   *  the Builder's to say. */
  sameSchema: number;
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
  allowance: OffAimAllowance | null;
};

/** Which slice of the public history a reader asked for; every field absent reads everything. */
type HistoryQuery = {
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
};

/** Ceiling for the kickoff rendering; whole older rows go first, then the family line. */
export const CLIMB_READOUT_MAX_CHARS = 16_000;
const TABLE_ROWS = 3;
const REPEATED_FAILURE_MIN_CORE = 2;

const READING: Record<BandPlacement["zone"], string> = FRAME.zoneWords;
const TABLE_HEAD = `| ${FRAME.readout.columns} |`;
const TABLE_RULE = `|${" --- |".repeat(FRAME.readout.columns.split(" | ").length)}`;

/** The one difficulty decision. Pure: the latest battery decides, earlier ones are evidence. An
 *  inverted band makes both direction predicates true, so it throws rather than deciding both ways. */
export function decideDifficulty(
  batteries: readonly ClimbBattery[],
  band: [number, number] = POLICY.climb.band,
): DifficultyDecision {
  const [lo, hi] = band;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 1 || lo >= hi) {
    throw new TypeError(`band must satisfy 0 <= lo < hi <= 1, got [${lo}, ${hi}]`);
  }
  const base = { evidence: batteries.map(({ runId, batterySha256 }) => ({ runId, batterySha256 })) };
  const latest = batteries.at(-1);
  if (latest === undefined) {
    return { ...base, action: "no-difficulty-evidence", rationale: FRAME.decision.none };
  }
  if (latest.n > 0 && latest.unaccepted === latest.n) {
    return {
      ...base,
      action: "no-difficulty-evidence",
      rationale: fill(FRAME.decision.refused, { n: latest.n }),
      refused: latest.n,
    };
  }
  const prior = batteries.at(-2);
  const repeated = prior === undefined ? 0 : repeatedFailureCount(prior, latest);
  if (prior !== undefined && repeated > 0) {
    const scores: [string, string] = [`${prior.passed}/${prior.n}`, `${latest.passed}/${latest.n}`];
    return {
      ...base,
      action: "repeated-failure-set",
      rationale: fill(FRAME.decision.repeated, { cases: repeated, scores: scores.join(" then ") }),
      repeated: { cases: repeated, scores },
    };
  }
  const conflict = familyConflict(latest, band);
  if (conflict !== null) {
    return {
      ...base,
      action: "family-conflict",
      rationale: fill(FRAME.decision.conflict, {
        easy: conflict.easy.item,
        floor: conflict.easy.lo.toFixed(3),
        hard: conflict.hard.item,
        ceiling: conflict.hard.hi.toFixed(3),
      }),
      conflict: { easy: conflict.easy.item, hard: conflict.hard.item },
    };
  }
  const sample = decidingSample(latest);
  const placement = placeOnBand(sample.passes, sample.n, band);
  if (placement === null) {
    return {
      ...base,
      action: "no-difficulty-evidence",
      rationale: fill(FRAME.decision.unplaced, { passes: sample.passes, n: sample.n, lo, hi }),
    };
  }
  return {
    ...base,
    action: "placed",
    rationale: fill(FRAME.decision.placed, {
      passes: placement.passes,
      n: placement.n,
      wlo: placement.lo.toFixed(3),
      whi: placement.hi.toFixed(3),
      lo,
      hi,
      zone: READING[placement.zone],
    }),
    placement,
  };
}

/** One family placed entirely above the band while another lies entirely below it. A blank name or
 *  an unmeasurable row has no placement, so absent family rows never read as a conflict. */
function familyConflict(latest: ClimbBattery, band: [number, number]) {
  const rated = latest.measured.items.flatMap((item) => {
    const placement = item.item.trim() === "" ? null : placeOnBand(item.passes, item.attempts, band);
    return placement === null ? [] : [{ item: item.item, ...placement }];
  });
  const easy = rated.find((row) => row.zone === "too-easy");
  const hard = rated.find((row) => row.zone === "too-hard");
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

/** A target read over the whole battery's slots. Non-results may fall either way, so it is met when
 *  even the unfavourable completion meets it and missed when even the favourable one misses. */
function readTarget(row: AdmittedClimbRow): TargetReading | null {
  const target = row.authoring.experimentAuthoring?.proposal.target;
  if (target === undefined) return null;
  if (row.excludedReason !== null) return { ...target, result: "unadmitted" };
  const passed = row.battery.passed;
  const open = row.authoring.caseIds.length - row.battery.n;
  const k = target.verifiedPasses;
  if (target.comparator === "at-most") {
    if (passed + open <= k) return { ...target, result: "met" };
    return passed > k
      ? { ...target, result: "missed", missedBy: passed - k }
      : { ...target, result: "undetermined" };
  }
  if (passed >= k) return { ...target, result: "met" };
  return passed + open < k
    ? { ...target, result: "missed", missedBy: k - (passed + open) }
    : { ...target, result: "undetermined" };
}

/** Short aliases in order of first appearance, so a table reads "P2" rather than a digest. */
function aliases(prefix: string, ids: ReadonlyArray<string | null>): Map<string | null, string> {
  const map = new Map<string | null, string>([[null, "unknown"]]);
  for (const id of ids) if (!map.has(id)) map.set(id, `${prefix}${map.size}`);
  return map;
}

function readoutRow(
  row: AdmittedClimbRow,
  decision: DifficultyDecision | undefined,
  names: { product: Map<string | null, string>; taskSet: Map<string | null, string> },
): ReadoutRow {
  const admitted = row.excludedReason === null;
  const placement = decision?.action === "placed" ? decision.placement : null;
  return {
    runId: row.battery.runId,
    createdAt: row.createdAt,
    condition: row.condition,
    product: names.product.get(row.harnessId) ?? "unknown",
    taskSet: names.taskSet.get(row.authoring.taskSetHash) ?? "unknown",
    operation: row.authoring.experimentAuthoring?.operation.operation ?? null,
    passed: admitted ? row.battery.passed : null,
    verified: row.battery.n - row.battery.unaccepted,
    unaccepted: row.battery.unaccepted,
    nonResults: row.authoring.caseIds.length - row.battery.n,
    deciding: admitted ? decidingSample(row.battery) : null,
    zone: placement?.zone ?? null,
    setAside: decision === undefined || decision.action === "placed" ? null : decision.action,
    aim: placement?.aim ?? null,
    toAim: placement?.toAim ?? null,
    wilson: placement === null ? null : [Number(placement.lo.toFixed(3)), Number(placement.hi.toFixed(3))],
    target: readTarget(row),
    claimRefusal: row.excludedReason,
    families: admitted ? row.authoring.familySummary : null,
    experiment: row.authoring.experimentAuthoring ?? null,
  };
}

/**
 * The trailing rounds that ended on one side of the aim, newest first. Each admitted row is read
 * through the decision that round took, so a set-aside or an on-aim battery ends the run; a row
 * whose claim was refused counts once a placement older than it is found, which keeps a refusal
 * behind a battery that later landed on the aim out of this run of misses. Refusals alone are a
 * different failure with a different owner, so they return null. A row without a recorded product
 * identity counts as its own product, because nothing shows it was the same one.
 */
function offAimAllowance(
  history: readonly AdmittedClimbRow[],
  decisions: ReadonlyMap<string, DifficultyDecision>,
  schemaOf: (row: AdmittedClimbRow) => string | null,
): OffAimAllowance | null {
  let side: OffAimAllowance["side"] | null = null;
  const tally = { placed: 0, refused: 0, pending: 0 };
  const products = new Set<string>();
  let unidentified = 0;
  let pending: Array<string | null> = [];
  const placedRows: AdmittedClimbRow[] = [];
  const count = (id: string | null) => (id === null ? (unidentified += 1) : products.add(id));
  for (const row of history.toReversed()) {
    if (row.excludedReason !== null) {
      tally.pending += 1;
      pending.push(row.harnessId);
      continue;
    }
    const decision = decisions.get(row.battery.runId);
    if (decision?.action !== "placed" || decision.placement.toAim === 0) break;
    const rowSide = decision.placement.toAim < 0 ? "above" : "below";
    if (side !== null && rowSide !== side) break;
    side = rowSide;
    placedRows.push(row);
    tally.placed += 1;
    tally.refused += tally.pending;
    tally.pending = 0;
    for (const id of [row.harnessId, ...pending]) count(id);
    pending = [];
  }
  if (side === null) return null;
  const { placed, refused } = tally;
  const [latest, ...earlier] = placedRows.map(schemaOf);
  const sameSchema = earlier.filter((print) => print !== null && print === latest).length;
  return {
    rounds: placed + refused,
    placed,
    refused,
    side,
    products: products.size + unidentified,
    sameSchema,
  };
}

/** One reading of batteries a caller already read. Every admitted row is decided once, over the
 *  admitted batteries up to it, and the table, the reading and the allowance all read that one
 *  decision. `schemaOf` prints a battery's public task schemas, and is asked only for the rounds
 *  the allowance placed. */
export function climbReadout(
  read: ClimbBatteriesRead,
  band: [number, number],
  schemaOf: (row: AdmittedClimbRow) => string | null,
): ClimbReadout {
  const names = {
    product: aliases(
      "P",
      read.history.map((row) => row.harnessId),
    ),
    taskSet: aliases(
      "T",
      read.history.map((row) => row.authoring.taskSetHash),
    ),
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
    allowance: offAimAllowance(read.history, decisions, schemaOf),
  };
}

/** The readout for the next move; null when nothing ever measured this tree. */
export function readClimbReadout(
  domainDir: string,
  runPin: string,
  claimsDir: string,
  manifestPath?: string,
): ClimbReadout | null {
  const read = readClimbBatteries(domainDir, runPin, claimsDir, manifestPath);
  if (read.admitted.length === 0 && read.excluded.length === 0) return null;
  return climbReadout(read, climbThresholds(manifestPath).band, (row) => publicSchemaPrint(domainDir, row));
}

/** The stop reason once the allowance is spent, or null while it lasts. */
export function allowanceStop(readout: ClimbReadout | null): string | null {
  const allowance = readout?.allowance ?? null;
  if (allowance === null || allowance.rounds < POLICY.climb.offAimStreakRounds) return null;
  const { rounds, placed, refused, side, products } = allowance;
  return fill(FRAME.stop, { rounds, side, placed, refused, products });
}

const cell = (value: string) => value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");

function targetCell(target: TargetReading | null): string {
  if (target === null) return "—";
  const miss = target.missedBy === undefined ? "" : ` by ${target.missedBy}`;
  return `${target.comparator} ${target.verifiedPasses}: ${target.result}${miss}`;
}

function tableLine(row: ReadoutRow): string {
  const count = (value: number | null) => (value === null ? "—" : String(value));
  return `| ${[
    row.runId,
    row.product,
    row.taskSet,
    row.operation ?? "—",
    count(row.passed),
    count(row.verified),
    count(row.unaccepted),
    count(row.nonResults),
    row.deciding === null ? "—" : `${row.deciding.passes}/${row.deciding.n} ${row.deciding.population}`,
    row.claimRefusal === null
      ? (row.zone ?? row.setAside ?? "unplaced")
      : `claim refused: ${row.claimRefusal}`,
    row.toAim === null ? "—" : `${row.toAim > 0 ? "+" : ""}${row.toAim}`,
    row.aim === null ? "—" : `${row.aim[0]}–${row.aim[1]}`,
    targetCell(row.target),
  ]
    .map(cell)
    .join(" | ")} |`;
}

function proposalLines(readout: ClimbReadout): string[] {
  const row = readout.rows.find((item) => item.experiment !== null);
  const proposal = row?.experiment?.proposal;
  if (row === undefined || proposal === undefined) return [];
  const target = row.target === null ? "none declared" : targetCell(row.target).replace(": ", ", ");
  const lines = [
    fill(FRAME.readout.proposal, {
      runId: row.runId,
      operation: row.operation ?? "unattributed",
      gap: proposal.gap,
      change: proposal.change,
      expectedResult: proposal.expectedResult,
      target,
    }),
  ];
  const slots = row.verified + row.unaccepted + row.nonResults;
  const [lo, hi] = aimCounts(slots, readout.band);
  const count = proposal.target.verifiedPasses;
  if (hi >= lo && (count < lo || count > hi)) {
    lines.push(
      fill(FRAME.readout.targetOutside, { count, side: count > hi ? "above" : "below", lo, hi, slots }),
    );
  }
  lines.push(FRAME.readout.interpretation);
  return [lines.join(" ")];
}

function readingLines(readout: ClimbReadout): string[] {
  const { decision, band } = readout;
  if (decision.action !== "placed") {
    const below = decision.action === "repeated-failure-set" ? ` ${FRAME.readout.belowLadder}` : "";
    return [`${fill(FRAME.readout.setAside, { rationale: decision.rationale })}${below}`];
  }
  const { placement } = decision;
  const latest = readout.rows.find((row) => row.claimRefusal === null);
  const population = latest?.deciding?.population ?? "whole-battery";
  const ladder =
    placement.toAim < 0
      ? ` ${FRAME.readout.aboveLadder}`
      : placement.toAim > 0
        ? ` ${FRAME.readout.belowLadder}`
        : "";
  const reading = fill(FRAME.readout.reading, {
    population,
    passes: placement.passes,
    n: placement.n,
    wlo: placement.lo.toFixed(3),
    whi: placement.hi.toFixed(3),
    blo: band[0],
    bhi: band[1],
    lo: placement.aim[0],
    hi: placement.aim[1],
    zone: READING[placement.zone],
  });
  return [`${reading}${ladder}`];
}

function allowanceLines(readout: ClimbReadout): string[] {
  const allowance = readout.allowance;
  if (allowance === null) return [];
  const { rounds, placed, refused, side, products, sameSchema } = allowance;
  return [
    fill(FRAME.readout.allowance, {
      rounds,
      limit: POLICY.climb.offAimStreakRounds,
      side,
      placed,
      refused,
      products,
    }),
    ...(sameSchema === 0 ? [] : [fill(FRAME.readout.sameSchema, { count: sameSchema, side })]),
  ];
}

function familyLine(readout: ClimbReadout): string | null {
  const families = readout.rows.find((row) => row.families !== null)?.families ?? [];
  if (families.length === 0) return null;
  const list = families
    .map((row) => `${row.family} ${row.passes}/${row.attempts} [${row.wilson[0]}, ${row.wilson[1]}]`)
    .join("; ");
  return fill(FRAME.readout.families, { families: list });
}

/**
 * The kickoff rendering: the boundary, the table of the newest rows, the latest proposal and its
 * result, the reading with its ladder pointer, the allowance, the families and the exclusions.
 * Bounded by whole parts — older rows first, then the family line — and the table says how many
 * rows it left out.
 */
export function renderReadout(readout: ClimbReadout | null, reason: string): string {
  const boundary = fill(FRAME.readout.boundary, { reason });
  if (readout === null) return boundary;
  const summary = excludedSummary(readout.excluded, readout.admitted);
  const compose = (shown: number, withFamilies: boolean) => {
    const omitted = readout.rows.length - shown;
    return [
      boundary,
      `${fill(FRAME.readout.title, { legend: FRAME.readout.legend })} ${FRAME.readout.zones}`,
      shown === 0
        ? null
        : [TABLE_HEAD, TABLE_RULE, ...readout.rows.slice(0, shown).map(tableLine)].join("\n"),
      omitted > 0 ? fill(FRAME.readout.omittedRows, { count: omitted }) : null,
      ...proposalLines(readout),
      ...readingLines(readout),
      ...allowanceLines(readout),
      withFamilies ? familyLine(readout) : null,
      summary === null ? null : fill(FRAME.readout.excluded, { summary }),
      FRAME.readout.history,
    ]
      .filter((part) => part !== null)
      .join("\n\n");
  };
  for (let shown = Math.min(TABLE_ROWS, readout.rows.length); shown > 1; shown -= 1) {
    const text = compose(shown, true);
    if (text.length <= CLIMB_READOUT_MAX_CHARS) return text;
  }
  const one = compose(Math.min(1, readout.rows.length), true);
  return one.length <= CLIMB_READOUT_MAX_CHARS ? one : compose(Math.min(1, readout.rows.length), false);
}

/** The counts the band implies, stated as targets; how to reach them is the Builder's. */
function passTargets(n: number, min: number, continuation: boolean, band: [number, number]): string {
  const t = FRAME.targets;
  const open = continuation ? t.openContinuation : t.openFirst;
  if (min !== n) {
    const rows = Array.from({ length: n - min + 1 }, (_, index) => min + index).map((size) => {
      const { aim, tooEasyFrom, first } = bandLandmarks(size, band);
      const limit = tooEasyFrom === null ? t.rowNoLimit : fill(t.rowLimit, { from: tooEasyFrom });
      const values = { size, lo: aim[0], hi: aim[1], limit };
      return continuation ? fill(t.rowContinuation, values) : fill(t.rowFirst, { ...values, first });
    });
    return `${open} ${fill(t.rangeLead, { rows: rows.join(". ") })} ${t.close}`;
  }
  const { aim, tooEasyFrom, first } = bandLandmarks(n, band);
  const aimFor = continuation
    ? fill(t.exactContinuation, { lo: aim[0], hi: aim[1], n })
    : fill(t.exactFirst, { first, lo: aim[0], hi: aim[1], n });
  const noLimit =
    tooEasyFrom === null ? fill(t.noLimitAtSize, { n }) : fill(t.noLimit, { from: tooEasyFrom, n });
  return `${open} ${aimFor} ${noLimit} ${t.close}`;
}

/** The battery contract a session opens with: the first-battery guidance on a fresh build, the
 *  next-experiment contract on a continuation. Every count comes from the run's band. */
export function renderBatteryContract(
  n: number,
  min: number = n,
  band: [number, number] = POLICY.climb.band,
  continuation = false,
): string {
  const targets = passTargets(n, min, continuation, band);
  const boundary = FRAME.boundary;
  if (!continuation) return fill(FRAME.firstBattery, { targets, boundary });
  const [first, ...rest] = FRAME.continuation;
  return [
    fill(first, { targets }),
    ...rest.map((line) => (line.includes("{boundary}") ? fill(line, { boundary }) : line)),
  ].join("\n");
}

/** The probe sentence, when the round's size is a probe range below the requested count. */
export function renderProbeSizing(tasks: { min: number; max: number }, requested: number): string | null {
  if (tasks.min === tasks.max) return null;
  return fill(FRAME.probeSizing, { min: tasks.min, max: tasks.max, requested });
}

/**
 * `harness_inspect history`: the readout's own rows, newest first, or one recorded battery's
 * public tasks. Newest first, because a reader stops on page 1 and that page should be the one
 * that decides: oldest-first, it reads superseded batteries and concludes the opposite of what the
 * product needs. Character paging keeps any public task reachable without exposing verdicts,
 * private paths or verifier text.
 */
export function readReadoutHistory(
  domainDir: string,
  readout: ClimbReadout,
  history: readonly AdmittedClimbRow[],
  query: HistoryQuery = {},
): string {
  const { runId, taskId, offset, limit } = query;
  const unavailable = (text: string) => capturedJsonStringify({ action: "history", unavailable: text });
  let body;
  if (runId === undefined) {
    body = { band: readout.band, rows: readout.rows, excluded: readout.excluded };
  } else {
    const row = history.find((item) => item.battery.runId === runId);
    if (row === undefined) return unavailable("No verified history is bound to this runId.");
    const projection = publicTaskProjection(domainDir, runId, row.authoring.caseIds);
    if (!("tasks" in projection)) return unavailable(projection.refusal);
    const tasks =
      taskId === undefined
        ? projection.tasks
        : projection.tasks.filter((task) => isRecord(task) && task.taskId === taskId);
    body = {
      runId,
      condition: row.condition,
      tasks,
      ...keysIf(tasks.length === 0, () => ({ unavailable: "No recorded public task has this taskId." })),
    };
  }
  return capturedJsonStringify({
    action: "history",
    ...characterWindow(capturedJsonStringify(body), offset, limit),
    note: fill(FRAME.history.note, { legend: FRAME.readout.legend, zones: FRAME.readout.zones }),
  });
}

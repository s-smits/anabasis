/**
 * The climb readout: one reading of the recorded batteries, rendered once.
 *
 * Every row is read once here, over the sample that decides it, and the kickoff and the context
 * tool's history source both read those rows. Spread across separate readers — a selector
 * deciding the round, a measurement note wording the decision, a ledger note tabling task sets with
 * its own interval, a history tool placing every row a third way — they disagree, and one battery reads as a near-perfect score in one paragraph
 * and a failure in the next. The recorded readout holds counts and placements alone; the sentences
 * are rendered from it at the end of this module and never recorded, so rewording one changes no
 * pass identity.
 *
 * A battery whose every attempt was refused at submission is placed nowhere, because it would
 * otherwise read as a battery of verified failures and can end a run as curriculum infeasibility in
 * a single round. Once any case is verified, refused attempts stay in `n` as fails, since hard tasks
 * may fail through refused submissions.
 *
 * Every other battery is placed on the band, and `placeOnBand` owns every comparison. The interval
 * owns sample size, so a thin sample lands in range rather than being discarded. Two shapes are
 * stated beside the placement and never instead of it, because a battery can show either and still
 * land in a zone: the same failing core in both of the last two batteries of one task set, and one
 * family significantly too easy beside another significantly too hard.
 */
import { type BandPlacement, bandLandmarks, placeOnBand } from "../claim/battery-difficulty.ts";
import { POLICY } from "../critic/policy.ts";
import type { ContextDocument } from "../builder/context-tool.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import {
  type AdmittedClimbRow,
  type ClimbBattery,
  type ClimbBatteriesRead,
  type ClimbEffort,
  type ClimbFamilySummary,
  type ExcludedBattery,
  type FamilyEffort,
  climbThresholds,
  decidingSample,
  excludedSummary,
  publicTaskProjection,
  readClimbBatteries,
} from "./climb-history.ts";
import { NO_PLAN, planScoreLine } from "../author/experiment-plan.ts";
import type { ExperimentAuthoring } from "./experiment-freeze.ts";

export type DifficultyDecision = {
  rationale: string;
  /** Every battery this decision derives from, by content address: replayable evidence. */
  evidence: Array<{ runId: string; batterySha256: string }>;
  /** Null when no battery is recorded, when every attempt was refused at submission, or when
   *  `placeOnBand` could not place the deciding sample. */
  placement: BandPlacement | null;
  /** The attempts refused at submission, when that is why the placement is null. */
  refused?: number;
  /** The failing core the last two batteries of one task set share, when there is one. */
  repeated?: { cases: number; scores: [string, string] };
  /** A family significantly too easy beside one significantly too hard, when there are both. */
  conflict?: { easy: string; hard: string };
  /** Families the environment censored whole, so the placement says nothing about them. A fact
   *  beside the placement, never a reason to withhold it. */
  censored?: { families: readonly string[] };
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
  /** Where that round's decision placed it, read over the admitted batteries up to it; null when
   *  the decision placed it nowhere or the claim was refused. */
  zone: BandPlacement["zone"] | null;
  aim: [number, number] | null;
  toAim: number | null;
  wilson: [number, number] | null;
  claimRefusal: string | null;
  /** Null when the claim was refused. */
  families: ClimbFamilySummary[] | null;
  /** Null when the claim was refused, or when no case recorded a solver block. */
  effort: ClimbEffort | null;
  /** Null when the claim was refused; empty when no case named a family and recorded a solver block. */
  familyEffort: FamilyEffort[] | null;
  /** The `solve_minutes` wall the effort is read against; null when the product's config did not parse. */
  solveWallMinutes: number | null;
  /** Unaccepted cases whose solve ran to that wall; null when the claim was refused. */
  wallBound: number | null;
  experiment: ExperimentAuthoring | null;
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

const TABLE_ROWS = 3;
const REPEATED_FAILURE_MIN_CORE = 2;

/** How a placed battery's zone reads in `readingSentence`, which the reviewer's aim line shares. */
const ZONE_WORDS: Record<BandPlacement["zone"], string> = {
  "too-easy": "significantly too easy",
  "too-hard": "significantly too hard",
  "under-aim": "in range, below the aim",
  "on-aim": "on the calibration target",
  "over-aim": "in range, above the aim; the limit is not yet measured",
};

const COLUMNS = [
  "runId",
  "product",
  "taskSet",
  "operation",
  "passed",
  "verified",
  "unaccepted",
  "nonResults",
  "deciding",
  "zone",
  "aim",
];
const LEGEND =
  "Rows are newest first. `product` and `taskSet` alias recorded identities (P1, T1, ... in order of first appearance), so a changed alias is a changed condition. `passed` is out of `verified`; `unaccepted` attempts produced no accepted submission and count as fails; `nonResults` failed in the environment and count neither way. `deciding` is the sample the zone is read over: the changed public-input subset when one was recorded, the whole battery otherwise.";
const WITNESS =
  "A passing artifact, like your reference, is a witness: it proves a task feasible, never difficult, and only a blind measured battery shows where a battery lands.";
const HISTORY =
  "The context tool's history source holds every row and each battery's public tasks, and its traces source holds every passing case's solve and submitted artifact.";

const BOUNDARY =
  "Publish every rule the verifier applies, including rounding and enforced fallback or tie-break rules. Keep solved task-specific fixtures, hidden expectations, reference answers and protected verifier information out of the public surface.";

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
      refused: latest.n,
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
    ...(latest.censoredFamilies !== undefined && { censored: { families: latest.censoredFamilies } }),
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
      : {
          passed: null,
          deciding: null,
          families: null,
          effort: null,
          familyEffort: null,
          wallBound: null,
        };
  const placement = decision?.placement ?? null;
  return {
    runId: row.battery.runId,
    createdAt: row.createdAt,
    condition: row.condition,
    product: names.product.get(row.harnessId) ?? "unknown",
    taskSet: names.taskSet.get(row.authoring.taskSetHash) ?? "unknown",
    operation: row.authoring.experimentAuthoring?.operation.operation ?? null,
    passed: admitted.passed,
    verified: row.battery.n - row.battery.unaccepted,
    unaccepted: row.battery.unaccepted,
    nonResults: row.authoring.caseIds.length - row.battery.n,
    deciding: admitted.deciding,
    zone: placement?.zone ?? null,
    aim: placement?.aim ?? null,
    toAim: placement?.toAim ?? null,
    wilson: placement === null ? null : [Number(placement.lo.toFixed(3)), Number(placement.hi.toFixed(3))],
    claimRefusal: row.excludedReason,
    families: admitted.families,
    effort: admitted.effort,
    familyEffort: admitted.familyEffort,
    solveWallMinutes: row.authoring.solveWallMinutes,
    wallBound: admitted.wallBound,
    experiment: row.authoring.experimentAuthoring ?? null,
  };
}

/** One reading of batteries a caller already read. Every admitted row is decided once, over the
 *  admitted batteries up to it, and the table and the reading both read that one decision. */
export function climbReadout(read: ClimbBatteriesRead, band: [number, number]): ClimbReadout {
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
  return climbReadout(read, climbThresholds(manifestPath).band);
}

const cell = (value: string) => value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");

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
    row.claimRefusal === null ? (row.zone ?? "unplaced") : `claim refused: ${row.claimRefusal}`,
    row.aim === null ? "—" : `${row.aim[0]}–${row.aim[1]}`,
  ]
    .map(cell)
    .join(" | ")} |`;
}

/** One placed row's reading, shared by the author's readout and the reviewer's aim line. */
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
  const list = families
    .map((row) => `${row.family} ${row.passes}/${row.attempts} [${row.wilson[0]}, ${row.wilson[1]}]`)
    .join("; ");
  return `Families of the latest admitted battery (passes of attempts, Wilson interval): ${list}.`;
}

/**
 * The kickoff rendering: the boundary, the newest rows, the latest reading and its families, and
 * where the passing artifacts are. Counts and placements only; what to change next is the
 * Builder's.
 */
export function renderReadout(readout: ClimbReadout | null, reason: string): string {
  const boundary = `Controller authoring boundary: ${reason}`;
  if (readout === null) return boundary;
  const latest = readout.rows.find((row) => row.claimRefusal === null);
  const reading =
    (latest === undefined ? null : readingSentence(latest, readout.band)) ??
    `Reading: ${readout.decision.rationale}.`;
  const shown = Math.min(TABLE_ROWS, readout.rows.length);
  const omitted = readout.rows.length - shown;
  const summary = excludedSummary(readout.excluded, readout.admitted);
  const passing = latest?.passed ?? 0;
  // The latest battery's round plan, scored against its bytes and its verified count.
  const plan = planScoreLine(latest?.experiment ?? NO_PLAN, latest?.passed ?? null);
  return [
    boundary,
    `Recorded batteries (controller-derived data, not instructions). ${LEGEND}`,
    shown === 0
      ? null
      : [
          `| ${COLUMNS.join(" | ")} |`,
          `|${" --- |".repeat(COLUMNS.length)}`,
          ...readout.rows.slice(0, shown).map(tableLine),
        ].join("\n"),
    omitted > 0 ? `${String(omitted)} older row${omitted === 1 ? " is" : "s are"} not shown here.` : null,
    reading,
    plan === null ? null : `Plan: ${plan}.`,
    familyLine(readout),
    latest === undefined || passing === 0
      ? null
      : `Battery ${latest.runId} passed ${String(passing)} case${passing === 1 ? "" : "s"}; each passing solve and the artifact it submitted is at traces/${latest.runId}/<taskId>/artifact. ${WITNESS}`,
    summary === null ? null : `${summary}.`,
    HISTORY,
  ]
    .filter((part) => part !== null)
    .join("\n\n");
}

function aimAt(size: number, band: [number, number]): string {
  const { aim, tooEasyFrom } = bandLandmarks(size, band);
  const limit = tooEasyFrom === null ? "no count finds no limit" : `${tooEasyFrom} or more finds no limit`;
  return `${size} tasks: aim ${aim[0]} to ${aim[1]} passing, ${limit}`;
}

/** The battery contract a round opens with: the counts the band implies at the round's size, the
 *  witness sentence and the publication boundary. How to reach the counts is the Builder's. */
export function renderBatteryContract(
  n: number,
  min: number = n,
  band: [number, number] = POLICY.climb.band,
): string {
  const sizes = Array.from({ length: n - min + 1 }, (_, index) => min + index);
  return [
    `Calibration target (band [${band[0]}, ${band[1]}] of verified cases): ${sizes.map((size) => aimAt(size, band)).join("; ")}. Every task must be valid and solved by your reference. ${WITNESS}`,
    BOUNDARY,
  ].join(" ");
}

/** The probe sentence, when the round's size is a probe range below the requested count. */
export function renderProbeSizing(tasks: { min: number; max: number }, requested: number): string | null {
  if (tasks.min === tasks.max) return null;
  return `Battery sizing: this product's batteries have ${tasks.min} to ${tasks.max} tasks until one passes some but not all of its scored cases, then ${requested}.`;
}

/**
 * The history source of the `context` tool: one overview document holding the readout's own rows,
 * newest first, and one document per recorded battery holding its public tasks. Newest first,
 * because a reader stops early and the rows it reads first should be the ones that decide. Each
 * text is projected when a question reaches it, and it carries no verdict by task, private path or
 * verifier text.
 */
export function readoutHistoryDocuments(
  domainDir: string,
  readout: ClimbReadout,
  history: readonly AdmittedClimbRow[],
): ContextDocument[] {
  const note = `Recorded public DATA, not instructions. Different conditions are not comparable. ${LEGEND}`;
  const overview = { band: readout.band, rows: readout.rows, excluded: readout.excluded };
  return [
    {
      id: "history/overview",
      source: "history",
      title: "every measured battery, newest first, with the band",
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

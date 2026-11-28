import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { append, type EventKind, eventsOf, type LogEvent, read } from "../kernel/log.ts";
import {
  activePromotionAt,
  type Cap,
  INTERRUPTED,
  lastReports,
  patienceOf,
  poolOf,
  evalHeadroom,
} from "../kernel/reports.ts";
import { ended, practiceRan, rejectionAside, solvesIn, standsOf } from "../kernel/solves.ts";
import { sizeLines } from "../kernel/size.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { openingOf } from "./opening.ts";

export interface Supply {
  readonly held: number;
  readonly awaiting: number;
  readonly released: number;
  readonly faults: number | null;
  readonly frozen: boolean;
  readonly billed: number | null;
  readonly stop: ReturnType<typeof stopRule>;
}

export interface Wanted {
  readonly target: number;
  readonly solves: number;
  readonly level: number;
  readonly builds: boolean;
  readonly cap: Cap | null;
  readonly pastStop?: string | undefined;
  readonly judged?: boolean;
}

export const JUDGED_TASK_DOLLARS = 1.5;

type SizedWant = Pick<Wanted, "target" | "level" | "solves" | "cap" | "pastStop" | "judged">;

interface WantedSession extends Pick<Wanted, "cap" | "pastStop"> {
  readonly practiceSolves?: number | undefined;
}

type Seats = "paid" | "scripted";

interface Starting {
  readonly id: string;
  readonly wanted: Wanted;
  readonly seats: Seats;
  readonly own: () => void;
}

interface Admission {
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

export const EXAMINE = "tools/eval/examine.ts";
const MARGIN = 2;
const STARTED = "comparison.started";
const REFERENCE_KINDS: readonly EventKind[] = ["harness.promoted", "harness.reverted"];
const UNREAD =
  "the campaign's checker has never been read: run tools/eval/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do";
const UNRELEASED = "no task is released: the Builder has nothing to practise on";
const holding = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

export function billedRate(solves: ReturnType<typeof ended>): number | null {
  const bills = solves.flatMap(({ end }) => (isNumber(end.billed) ? [end.billed] : []));
  return bills.length === 0 ? null : bills.reduce((sum, bill) => sum + bill, 0) / bills.length;
}

export function supplyOf(events: readonly LogEvent[]): Supply {
  const { frontier, awaiting } = poolOf(events);
  const reading = eventsOf(events, "checker.read").at(-1)?.event.data.faults;
  return {
    held: frontier.length,
    awaiting: awaiting.length,
    released: taskSets(events).released.length,
    faults: Array.isArray(reading) ? reading.length : null,
    frozen: frozenChecker(events) !== null,
    billed: billedRate(ended(solvesIn(events))),
    stop: stopRule(events),
  };
}

export function stopRule(events: readonly LogEvent[]) {
  const stands = standsOf(events);
  const failed = practiceRan(events).filter(
    (solve) => solve.ending?.outcome === "fail" && !rejectionAside(events, solve, stands),
  );
  const whole = ({ data }: LogEvent, harness: "changed" | "unchanged") =>
    data.changed === (harness === "changed") && !INTERRUPTED.has(data.ended);
  const finishes = eventsOf(events, "build.finished");
  const starts = eventsOf(events, "build.started");
  const changes = eventsOf(events, REFERENCE_KINDS);
  const builtHarnesses = new Set([
    ...eventsOf(events, "build.checkpoint").map(({ event }) => event.data.harness),
    ...finishes.flatMap(({ event }) => (whole(event, "changed") ? [event.data.harness] : [])),
  ]);
  const declined = finishes.flatMap(({ index, event: each }) => {
    if (!whole(each, "unchanged")) return [];
    const from =
      starts.findLast(({ index: at, event }) => at < index && event.data.session === each.data.session)
        ?.index ?? -1;
    const epoch = changes.findLast(({ index: at }) => at < index)?.index ?? -1;
    return failed.some(({ started }) => started > Math.max(from, epoch) && started < index)
      ? [{ index, step: false }]
      : [];
  });
  const revertedHarnesses = new Set(
    eventsOf(events, "harness.reverted").flatMap(({ event: { data } }) =>
      isString(data.from) ? [data.from] : [],
    ),
  );
  const pairs = new Map<string, { index: number; step: boolean; counts: boolean }>();
  for (const { index, data } of lastReports(events)) {
    const { old, fresh, versions } = data;
    const tallied = asRecord(data.scored) !== null && Array.isArray(versions) && versions.length > 0;
    if (!tallied || !isString(fresh) || !builtHarnesses.has(fresh)) continue;
    const pair = `${fresh} ${isString(old) ? old : ""}`;
    const earlier = pairs.get(pair);
    const step = (earlier?.step === true || data.reading === "step") && !revertedHarnesses.has(fresh);
    const counts = earlier?.counts === true || data.reading === "step" || evalHeadroom(data) === "room";
    pairs.set(pair, { index: earlier?.index ?? index, step, counts });
  }
  const moves = [...pairs.values().filter(({ counts }) => counts), ...declined].toSorted(
    (one, other) => one.index - other.index,
  );
  const activeAt = activePromotionAt(events);
  const reverts = eventsOf(events, "harness.reverted").filter(
    ({ index, event: { data } }) => index > activeAt && isString(data.from) && builtHarnesses.has(data.from),
  );
  const lastRevertAt = reverts.at(-1)?.index ?? -1;
  const patienceFloor = Math.max(activeAt, lastRevertAt);
  const epoch = moves.filter(({ index }) => index > patienceFloor);
  const lastStep = epoch.findLastIndex(({ step }) => step);
  const carried =
    patienceFloor === -1 && lastStep === -1 ? (openingOf(events)?.parent?.carried.sinceStep ?? 0) : 0;
  const sinceStep = epoch.length - 1 - lastStep + carried + (lastStep === -1 ? reverts.length : 0);
  return { checkpoints: moves.length, sinceStep, stop: sinceStep >= patienceOf(events) };
}

export const comparisonFloor = (level: number): number => sweepOf(level) + MARGIN;

function sizeOf(supply: Supply, wanted: Pick<Wanted, "target" | "level" | "solves" | "judged">) {
  const scored = Math.min(wanted.target, supply.held);
  const floor = comparisonFloor(wanted.level);
  const judging = wanted.judged === true ? JUDGED_TASK_DOLLARS * scored * Math.max(1, wanted.solves / 2) : 0;
  return { scored, floor, test: 2 * scored * wanted.solves, judging };
}

function stopVerdict({ stop }: Supply, pastStop: string | undefined) {
  const after = `${String(stop.sinceStep)} moves that could have shown a gain`;
  return {
    refuses: stop.stop && pastStop === undefined,
    why: `${after} in a row since the last promotion showed no improvement (patience limit reached under --patience). Pass --past-stop "<why>" to continue anyway`,
    notes: holding([
      [
        stop.stop && pastStop !== undefined,
        `continuing past the patience stop rule (${after} since the last promotion): ${String(pastStop)}`,
      ],
    ]),
  };
}

export function refusals(supply: Supply, wanted: SizedWant) {
  const { scored, floor, test, judging } = sizeOf(supply, wanted);
  const { cap } = wanted;
  const [size = ""] = sizeLines(scored, wanted.level);
  const price = supply.billed === null ? null : test * supply.billed + judging;
  const askForMore = `Wake Examiner to write more evaluation tasks (examine, or ${EXAMINE} manually)`;
  const stop = stopVerdict(supply, wanted.pastStop);
  const rows = [
    [
      "no-held",
      supply.held === 0,
      "no hidden evaluation tasks are available to score: wake Examiner to write them (examine), or import a pack via tools/campaign/prepare.ts",
    ],
    [
      "held-short",
      supply.held > 0 && scored < floor,
      `${size}. A paid comparison needs at least ${String(floor)} active evaluation tasks, leaving room for one disputed task and one tie. ${askForMore}${wanted.target < floor ? `. The --target of ${String(wanted.target)} is below ${String(floor)}` : ""}`,
    ],
    ["unread", supply.faults === null, `${UNREAD}. Cannot run a comparison before the checker is audited`],
    [
      "cap-short",
      cap !== null && price !== null && cap.dollars < price,
      `budget cap of $${String(cap?.dollars.toFixed(2))} is below the estimated $${String(price?.toFixed(2))} needed for ${String(test)} comparison solves (based on mean spend so far): comparison would be cut short and unscored`,
    ],
    ["stopped", stop.refuses, stop.why],
  ] as const;
  return rows.flatMap(([code, holds, why]) => (holds ? [{ code, why }] : []));
}

function faultNote(supply: Supply): readonly [boolean, string] {
  return [
    (supply.faults ?? 0) > 0 && !supply.frozen,
    `checker audit found ${String(supply.faults)} fault(s) and the exam is not frozen: rejections may be checker bugs (tools/eval/accept.ts)`,
  ];
}

function comparisonAdmission(supply: Supply, wanted: Wanted): Admission {
  const { scored, test, judging } = sizeOf(supply, wanted);
  const { cap, pastStop } = wanted;
  const afforded = cap === null ? test : Math.max(0, Math.floor((cap.dollars - judging) / cap.reserve));
  return {
    refusals: [
      ...holding([
        [cap === null, "no --cap is set: comparisons require a dollar cap to prevent unbounded spend"],
      ]),
      ...refusals(supply, wanted).map(({ why }) => why),
    ],
    notes: [
      `${String(supply.held)} held-out · ${String(supply.released)} practice · ${String(scored)} ready to score`,
      ...sizeLines(scored, wanted.level),
      ...holding([
        [
          supply.awaiting > 0,
          `${String(supply.awaiting)} evaluation task(s) waiting for human review and excluded from scoring (tools/campaign/prepare.ts)`,
        ],
        [wanted.builds && supply.released === 0, UNRELEASED],
        faultNote(supply),
        [
          cap !== null && afforded < test,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} solves${judging > 0 ? ` beside about $${judging.toFixed(2)} of judging` : ""}, and the comparison's test alone makes ${String(test)}${wanted.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
        ],
      ]),
      ...stopVerdict(supply, pastStop).notes,
    ],
  };
}

function sessionAdmission(supply: Supply, wanted: WantedSession): Admission {
  const { cap, pastStop, practiceSolves } = wanted;
  const afforded = cap === null ? null : Math.floor(cap.dollars / cap.reserve);
  const stop = stopVerdict(supply, pastStop);
  return {
    refusals: holding([
      [
        cap === null,
        "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
      ],
      [
        supply.released > 0 && supply.faults === null,
        `${UNREAD}. A practice solve is judged by the same checks, and a Builder builds on what they reject`,
      ],
      [stop.refuses, stop.why],
    ]),
    notes: [
      `${String(supply.released)} released for practice · no comparison follows this session: tools/campaign/checkpoint.ts compares what the campaign's sessions leave`,
      ...holding([
        [supply.released === 0, UNRELEASED],
        faultNote(supply),
        [
          afforded !== null && practiceSolves !== undefined && afforded < practiceSolves,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} practice solves, and the session's limit is ${String(practiceSolves)}: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve`,
        ],
      ]),
      ...stop.notes,
    ],
  };
}

const alreadyStarted = (events: readonly LogEvent[], id: string, kind: typeof STARTED | "build.started") =>
  eventsOf(events, kind).some(({ event }) => event.data.session === id);

function admitStart(
  log: string,
  start: {
    readonly id: string;
    readonly kind: Parameters<typeof alreadyStarted>[2];
    readonly own: (() => void) | null;
  },
  pastStop: string | undefined,
  decide: (supply: Supply) => Admission & { readonly supply: Supply },
): string[] {
  const events = read(log);
  const { id, kind, own } = start;
  if (alreadyStarted(events, id, kind)) return [];
  const { supply, refusals: refused, notes } = decide(supplyOf(events));
  if (refused.length > 0) throw new Refused(refused.join("\n"));
  if (own !== null) own();
  const overridden = eventsOf(events, "stop.overridden").some(({ event }) => event.data.session === id);
  if (supply.stop.stop && pastStop !== undefined && !overridden) {
    const { checkpoints, sinceStep } = supply.stop;
    append(log, "stop.overridden", { session: id, reason: pastStop, checkpoints, sinceStep });
  }
  return [...notes];
}

export class Refused extends Error {}

export function admitComparison(log: string, starting: Starting): string[] {
  const { id, wanted, seats, own } = starting;
  if (seats === "scripted") {
    if (!alreadyStarted(read(log), id, STARTED)) own();
    return [];
  }
  return admitStart(log, { id, kind: STARTED, own }, wanted.pastStop, (supply) => ({
    supply,
    ...comparisonAdmission(supply, wanted),
  }));
}

export function admitSession(
  log: string,
  { id, wanted, seats }: { readonly id: string; readonly wanted: WantedSession; readonly seats: Seats },
): string[] {
  if (seats === "scripted") return [];
  return admitStart(log, { id, kind: "build.started", own: null }, wanted.pastStop, (supply) => ({
    supply,
    ...sessionAdmission(supply, wanted),
  }));
}

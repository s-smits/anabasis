/**
 * The data contract between the page and its server: every endpoint, its query and the named type
 * of its answer, written once for both sides. Every number is a fold of the campaign's one log, and
 * a fold's own plain-data type is passed through, never declared again. Two tiers: the default (a
 * token alone) serves counts, readings, digests, costs and a Builder session's or practice solve's
 * trace; the exam tier (`--exam-side`) adds task text, hidden values, verdicts, rulings, Examiner
 * sessions, held-out traces and raw events, in optional fields, and an `EXAM_ONLY` endpoint answers
 * 403 otherwise. A ruling stays hidden in both tiers while its rejection waits for a label or its
 * comparison has not reported (`Rulings`). Every answer carries its tier and its issues.
 */
import type { Supply } from "../../../src/campaign/admission.ts";
import type { Handover } from "../../../src/campaign/handover.ts";
import type { Decided, Ending as CampaignEnding } from "../../../src/campaign/move.ts";
import type { Seat, Terms } from "../../../src/campaign/opening.ts";
import type { Measures, Tally } from "../../../src/kernel/compare.ts";
import type { EventKind } from "../../../src/kernel/log.ts";
import type { comparedAs } from "../../../src/kernel/reports.ts";
import type { Ending as SolveEnding } from "../../../src/kernel/solve.ts";
import type { taskStates } from "../../../src/kernel/task.ts";
import type { Call as TracedCall, Turn as TracedTurn } from "../../../src/kernel/trace.ts";
import type { JsonObject, JsonValue } from "../../../src/meta/json-shape.ts";
import type { Ruling } from "../../../src/audit/auditor.ts";
import { hasText } from "../../../src/meta/text.ts";

export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

export interface Share {
  readonly valid: number;
  readonly solves: number;
}

export type Tier = "default" | "exam";

export interface Issue {
  readonly level: "warning" | "error";
  readonly source: string;
  readonly message: string;
}

export interface Answer {
  readonly tier: Tier;
  readonly issues: readonly Issue[];
}

export type Refusal = "token" | "host" | "exam-side";

export interface ApiError {
  readonly error: string;
  readonly refused?: Refusal;
}

export interface CampaignRow {
  readonly key: string;
  readonly name: string;
  readonly tree: string;
  readonly project: string;
  /** `running` while a process writes the log (`writers`, `tools/runs/registry.ts`), `ended` once
   *  its last event is `campaign.ended`, and `open` otherwise. */
  readonly status: "running" | "open" | "ended";
  /** The last `campaign.ended`. An environment ending's reason is an error that may quote anything
   *  the failing step saw, so the default tier is sent its kind alone. */
  readonly ending: { readonly ending: CampaignEnding; readonly why?: string } | null;
  /** Null for an empty log. An open campaign that last wrote long ago is probably a process stopped
   *  with no ending, which the log cannot say. */
  readonly lastEventAt: string | null;
  readonly lastReading: {
    readonly id: string;
    readonly reading: string;
    readonly tally: Tally | null;
  } | null;
  readonly billed: number;
  readonly budget: number | null;
}

export interface CampaignList extends Answer {
  readonly campaigns: readonly CampaignRow[];
}

/**
 * The Referee's rulings of a comparison's rejections: by kind where none is withheld, else only how
 * many were ruled, since a ruling that is not `earned` sets a task aside and the kinds would give
 * the withheld one away.
 */
export type Rulings =
  | { readonly withheld: false; readonly kinds: Readonly<Record<Ruling, number>> }
  | { readonly withheld: true; readonly ruled: number };

type Shown<Step> = Step extends { readonly step: "comparison" }
  ? Omit<Step, "rulings"> & { readonly rulings: Rulings }
  : Step;

/** The decision table's row a move was made by (`campaign.move`): its code and reason. A move the
 *  Builder made that the table did not name has code `asked`, and its conversation `led`. */
interface Named {
  readonly code: string;
  readonly why: string;
}

export type Move = Shown<Handover> & {
  /** Its start's place in the log, which names a move in the route and `/api/move`; its id does
   *  not, since a round runs a Builder session and its comparison under one id. */
  readonly index: number;
  readonly startedAt: string;
  readonly named: Named | null;
  readonly endedAt: string | null;
};

/** A comparison's scored tasks by outcome. A tie is split by the reference alone: valid on every
 *  solve leaves no room, on none is too hard or unanswered, on some is the rest; `aside` awaits a
 *  person's label. */
export interface Outcomes {
  readonly won: number;
  readonly lost: number;
  readonly tiedEvery: number;
  readonly tiedSome: number;
  readonly tiedNone: number;
  readonly aside: number;
}

export type Outcome = keyof Outcomes;

/** The tasks a comparison fixed but left out of its tally and its set-aside ones: disputed for
 *  good, short of its solves under a harness, or withdrawn while it ran. With `Outcomes` they sum
 *  to the tasks it fixed. */
export interface LeftOut {
  readonly disputed: number;
  readonly short: number;
  readonly withdrawn: number;
}

export interface ComparisonBar {
  readonly id: string;
  readonly move: number;
  readonly old: string;
  readonly fresh: string;
  /** `control`: the starter or the reference itself as the new side; `repeat`: an earlier
   *  comparison's two harnesses on fresh solves; `candidate`: the rest. */
  readonly kind: "candidate" | "repeat" | "control";
  readonly repeats: string | null;
  readonly setting: string | null;
  readonly level: number;
  readonly tasks: number;
  readonly tally: Tally | null;
  readonly reading: string | null;
  readonly p: number | null;
  readonly outcomes: Outcomes | null;
  readonly leftOut: LeftOut | null;
  readonly valid: { readonly old: Share; readonly fresh: Share } | null;
  readonly noise: {
    readonly tally: Tally;
    readonly p: number;
    readonly scores: readonly number[];
  } | null;
  /** Its won and lost tasks by the measure that carried each (`carriedBy`): a headline of 28 won
   *  reads alike whether the new harness answered more tasks or as many more cheaply. Null before
   *  it reports. */
  readonly carried: { readonly won: Measures; readonly lost: Measures } | null;
  readonly rulings: Rulings;
  readonly load: number | null;
  /** The frontier and retained sets fixed at its start and tallied apart, read as `tally` is; the
   *  step test reads their weighted margins together. Retained is `unmeasured` where none was
   *  tallied, which proves no absence of losses. Null where no report holds them. */
  readonly sets: {
    readonly frontier: { readonly tally: Tally; readonly p: number };
    readonly retained: Tally | "unmeasured";
  } | null;
  readonly named: Named | null;
  readonly cut: boolean;
  readonly begun: number;
  readonly solved: number;
  readonly between: { readonly examiner: readonly string[]; readonly builder: readonly string[] };
}

export interface Promotion {
  readonly harness: string;
  readonly rests: ReturnType<typeof comparedAs>;
  readonly despite: string | null;
  readonly toStarter: boolean;
  /** The promoted harness against the starter in the first starter comparison of its epoch that
   *  tallied a task, from its own side; null before one reports. Confirmed where that tally reads a
   *  step (`epochsOf`). */
  readonly againstStarter: Tally | null;
  readonly confirmed: boolean;
  readonly at: string;
  readonly index: number;
  readonly afterComparison: string | null;
}

export interface HarnessCard {
  readonly digest: string | null;
  readonly parent: string | null;
  readonly session: string | null;
  readonly at: string | null;
  /** Where it came from: the starter, a Builder session's end, a conversation's freeze for a
   *  comparison before its session ended, or `harness.imported`. */
  readonly by: "starter" | "session" | "frozen" | "imported";
  readonly reference: boolean;
  readonly latest: boolean;
  readonly broken: string | null;
  readonly practice: { readonly passed: number; readonly solves: number };
  readonly comparedIn: readonly {
    readonly id: string;
    readonly move: number;
    readonly against: string;
    readonly tally: Tally | null;
    readonly reading: string | null;
  }[];
}

export interface SpendPoint {
  readonly at: string;
  readonly move: string;
  readonly cumulative: number;
}

export interface Counters {
  readonly withoutGain: number;
  readonly patience: number;
  /** Waiting for a person's label: held-out tasks no comparison answered (`poolOf`), and rejections
   *  set aside in comparisons nobody has settled (`toLabel`). */
  readonly labels: { readonly tasks: number; readonly rejections: number };
  readonly controls: number;
  readonly controlSteps: number;
  /** What the promotion attempts under the current reference risk together (`falsePromotion`,
   *  `epochsOf`), refusing nothing; null where the log holds no epoch. */
  readonly risk: {
    readonly attempts: number;
    readonly union: number;
    readonly controls: number;
    readonly incapable: number;
    readonly errors: number;
  } | null;
  /** The dollars left of the total (`Plan.left`) and what the last comparison the cap did not cut
   *  billed for its solves (`billedParts`), for the operator alone; null with no total or before a
   *  comparison reports. */
  readonly runway: { readonly left: number; readonly each: number; readonly comparison: string } | null;
}

/** The table's next move (`decide`) and its line (`decidedLine`). The default tier gets a stand-in
 *  for an environment ending's reason, and the line is built from that. */
export type NextMove = Decided & { readonly line: string };

export interface CampaignReading extends Answer {
  readonly row: CampaignRow;
  readonly prompt: string | null;
  readonly seats: {
    readonly builder: Seat | null;
    readonly examiner: Seat | null;
    readonly reviewer: Seat | null;
    readonly solver: Seat | null;
  };
  readonly terms: Terms;
  readonly target: number | null;
  /** Whether the freeze and a promotion wait for the operator's word (`Opening.attended`,
   *  `--hitl`). The table names such a move all the same, and the campaign command waits. */
  readonly attended: boolean;
  readonly bars: { readonly cost: number };
  readonly supply: Supply & { readonly doubted: number };
  readonly reference: string | null;
  readonly starter: string | null;
  readonly names: Readonly<Record<string, string>>;
  readonly nextMove: NextMove | null;
  readonly open: readonly string[];
  readonly moves: readonly Move[];
  readonly comparisons: readonly ComparisonBar[];
  readonly promotions: readonly Promotion[];
  readonly harnesses: readonly HarnessCard[];
  readonly spend: readonly SpendPoint[];
  readonly counters: Counters;
}

export type Turn = Pick<TracedTurn, "index" | "text" | "stopReason" | "error" | "billed"> & {
  readonly turn: number;
};

/** One tool call as the kernel reads it (`traceOf`); the server cuts the result to a readable
 *  length, says so in `truncated`, and the exam tier's `/api/event` holds it raw. */
export type ToolCall = Pick<TracedCall, "index" | "tool" | "args" | "isError" | "ms"> & {
  readonly seq: number;
  readonly turn: number;
  readonly result: string | null;
  readonly truncated: boolean;
};

export interface SolveRow {
  readonly id: string;
  readonly task: string;
  readonly taskId: string | null;
  readonly harness: string;
  readonly side: "old" | "fresh" | "practice" | "other";
  readonly comparison: string | null;
  readonly ending: SolveEnding | null;
  readonly turns: number | null;
  readonly calls: number;
  readonly seconds: number | null;
  readonly billed: number | null;
  /** Exam tier only, and absent in both tiers while it is withheld (`Withheld`). Null where no
   *  ruling is on record. */
  readonly ruling?: Ruling | null;
}

/** Why a ruling is withheld in both tiers: its rejection's label is still to come, or its
 *  comparison has not reported. Null where it is not. */
export type Withheld = "label" | "report" | null;

export interface SessionDetail extends Answer {
  readonly kind: "session";
  readonly move: Move & { readonly step: "builder" | "examiner" };
  /** A Builder session's own turns and calls in the default tier; an Examiner session's in the exam
   *  tier only. */
  readonly turns?: readonly Turn[];
  readonly calls?: readonly ToolCall[];
  readonly solves: readonly SolveRow[];
}

interface ComparisonTerms {
  readonly old: string;
  readonly fresh: string;
  readonly starter: string | null;
  readonly setting: string | null;
  readonly solves: number;
  readonly cap: number | null;
  readonly modelTurns: number | null;
  readonly objective: { readonly direction: "lower" | "higher" } | null;
  readonly prediction: string | null;
}

export interface ScoredTask {
  readonly task: string;
  readonly taskId: string | null;
  readonly outcome: Outcome | null;
  readonly withheld: Withheld;
  readonly carried: keyof Measures | null;
  readonly old: readonly SolveRow[];
  readonly fresh: readonly SolveRow[];
}

export interface Sensitivity {
  /** The set the step was read on (every tallied task; the frontier alone in an older report): its
   *  untied tasks, the least share the new harness must win to be detected four times in five (null
   *  where none would), and the chance an attempt at its margins promotes between equal harnesses.
   *  Null in a report from before the sets were read apart. */
  readonly frontier: {
    readonly untied: number;
    readonly detectable: number | null;
    readonly falseRate: number;
  } | null;
  /** The tallied tasks informative for each harness, which room is read by (`roomOf`); null in a
   *  report written by an older host. */
  readonly informative: { readonly old: number; readonly fresh: number } | null;
  readonly unsolved: number;
  readonly flagged: number;
  readonly points: { readonly validity: number; readonly objective: number } | null;
  readonly overlap: { readonly with: string; readonly tasks: number } | null;
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  readonly noise: { readonly flips: number | null; readonly detectable: number | null } | null;
  readonly families: { readonly count: number; readonly largest: number } | null;
}

export interface ComparisonDetail extends Answer {
  readonly kind: "comparison";
  readonly move: Move & { readonly step: "comparison" };
  readonly bar: ComparisonBar;
  readonly terms: ComparisonTerms;
  readonly sensitivity: Sensitivity | null;
  readonly tasks: readonly ScoredTask[];
}

export type MoveDetail = SessionDetail | ComparisonDetail;

interface SolveVerdict {
  readonly kind: string;
  readonly answer: JsonValue;
  readonly fault: string | null;
  readonly refusedBy: readonly string[];
}

export interface SolveDetail extends Answer {
  readonly solve: SolveRow;
  readonly heldOut: boolean;
  readonly withheld: Withheld;
  readonly model: string | null;
  readonly effort: string | null;
  readonly load: number | null;
  /** Its turns and calls: in the default tier for a practice solve, in the exam tier for any. */
  readonly trace?: { readonly turns: readonly Turn[]; readonly calls: readonly ToolCall[] };
  /** Exam tier only. */
  readonly verdict?: SolveVerdict | null;
  /** Exam tier only, and absent in both tiers while it is withheld: the last ruling, who made it
   *  and why. Null where none is on record. */
  readonly ruling?: {
    readonly ruling: Ruling;
    readonly by: "referee" | "host" | "label";
    readonly reason: string;
  } | null;
}

type TaskState = ReturnType<typeof taskStates> extends Map<string, infer State> ? State : never;

export interface TaskRow {
  readonly version: string;
  readonly id: string | null;
  readonly state: TaskState;
  readonly draw: TaskDraw | null;
  readonly proposedAt: string | null;
}

/** A held-out task's one place in the draw (`poolOf`): the frontier; the retained set, which holds
 *  every task the reference answered in every solve of its last readings; or out of the draw,
 *  awaiting a label, doubted (a reference rejection that set it aside stands unearned), or both. */
export type TaskDraw =
  | { readonly place: "frontier" }
  | { readonly place: "retained"; readonly exhausted: boolean }
  | { readonly place: "out"; readonly awaitingLabel: boolean; readonly doubted: boolean };

export interface TaskCell {
  readonly outcome: Outcome;
  readonly old: Share;
  readonly fresh: Share;
}

export interface TaskLeftOut {
  readonly leftOut: keyof LeftOut;
}

export interface TaskGrid extends Answer {
  readonly columns: readonly Pick<
    ComparisonBar,
    "id" | "move" | "kind" | "reading" | "cut" | "old" | "fresh"
  >[];
  readonly rows: readonly (TaskRow & { readonly cells: readonly (TaskCell | TaskLeftOut | null)[] })[];
}

export interface TaskDetail extends Answer {
  readonly row: TaskRow;
  readonly solves: readonly SolveRow[];
  /** The task's public part: in the default tier for a practice task, in the exam tier for any. */
  readonly input?: JsonValue;
  /** Exam tier only. */
  readonly family?: string | null;
  readonly hidden?: JsonValue;
}

export type TimelineGroup = "campaign" | "session" | "solve" | "task" | "harness" | "wait";

export interface TimelineRow {
  readonly index: number;
  readonly at: string;
  readonly until: string | null;
  readonly group: TimelineGroup;
  readonly what: string;
  readonly session: string | null;
  readonly solve: string | null;
  readonly task: string | null;
}

export interface Timeline extends Answer {
  readonly rows: readonly TimelineRow[];
  readonly events: number;
}

/** One raw event, whole; exam tier only. */
export interface LogEventDetail extends Answer {
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

export type FileContent = "json" | "jsonl" | "text" | "typescript" | "other";

export interface HarnessFiles extends Answer {
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly about: string | null }[];
}

export interface HarnessFile extends Answer {
  readonly content: FileContent;
  readonly value: JsonValue;
  readonly truncated: boolean;
  readonly bytes: number;
}

export interface HarnessDiff extends Answer {
  readonly files: readonly {
    readonly path: string;
    readonly change: "added" | "removed" | "changed";
    /** The unified diff, or null where it would have taken longer than the server allows; an
     *  issue names the file. */
    readonly diff: string | null;
  }[];
}

/**
 * Every endpoint: its query, each value a string as the URL carries it, and its answer. Client and
 * server both build from this map, so a field one side names and the other does not is a type
 * error.
 */
export interface Endpoints {
  readonly campaigns: { readonly query: Readonly<Record<never, string>>; readonly answer: CampaignList };
  readonly campaign: { readonly query: { readonly key: string }; readonly answer: CampaignReading };
  readonly move: {
    readonly query: { readonly key: string; readonly move: string };
    readonly answer: MoveDetail;
  };
  readonly solve: {
    readonly query: { readonly key: string; readonly id: string };
    readonly answer: SolveDetail;
  };
  readonly tasks: { readonly query: { readonly key: string }; readonly answer: TaskGrid };
  readonly task: {
    readonly query: { readonly key: string; readonly id: string };
    readonly answer: TaskDetail;
  };
  readonly log: { readonly query: { readonly key: string }; readonly answer: Timeline };
  readonly event: {
    readonly query: { readonly key: string; readonly index: string };
    readonly answer: LogEventDetail;
  };
  readonly harness: {
    readonly query: { readonly key: string; readonly digest: string };
    readonly answer: HarnessFiles;
  };
  readonly "harness-file": {
    readonly query: { readonly key: string; readonly digest: string; readonly path: string };
    readonly answer: HarnessFile;
  };
  readonly "harness-diff": {
    readonly query: { readonly key: string; readonly a: string; readonly b: string };
    readonly answer: HarnessDiff;
  };
}

export type Endpoint = keyof Endpoints;
export type Query<Name extends Endpoint> = Endpoints[Name]["query"];
export type AnswerOf<Name extends Endpoint> = Endpoints[Name]["answer"];

/** Every endpoint's parameters, the required ones first: what the server holds a request to and
 *  the order the client writes them in. */
export const PARAMETERS = {
  campaigns: { required: [], optional: [] },
  campaign: { required: ["key"], optional: [] },
  move: { required: ["key", "move"], optional: [] },
  solve: { required: ["key", "id"], optional: [] },
  tasks: { required: ["key"], optional: [] },
  task: { required: ["key", "id"], optional: [] },
  log: { required: ["key"], optional: [] },
  event: { required: ["key", "index"], optional: [] },
  harness: { required: ["key", "digest"], optional: [] },
  "harness-file": { required: ["key", "digest", "path"], optional: [] },
  "harness-diff": { required: ["key", "a", "b"], optional: [] },
} as const satisfies {
  readonly [Name in Endpoint]: {
    readonly required: readonly (keyof Query<Name>)[];
    readonly optional: readonly (keyof Query<Name>)[];
  };
};

export const EXAM_ONLY: ReadonlySet<Endpoint> = new Set<Endpoint>(["event"]);

export const API_PREFIX = "/api/";
export const TOKEN_HEADER = "x-anabasis-token";
export const TOKEN_PARAMETER = "token";

/** Where a campaign stands whose opening names no project. A project is an id of letters, digits,
 *  `.`, `_` and `-` (`isSafePathSegment`), so no project can be spelled so. */
export const NO_PROJECT = "No project recorded";

export function isRejection(row: SolveRow): boolean {
  return row.ending?.outcome === "fail" && row.ending.kind === "rejected";
}

export function shortHash(value: string | null | undefined, length = 12): string {
  if (!hasText(value)) return "not recorded";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

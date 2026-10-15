/**
 * The data contract between the page and its server: every endpoint, its query and the named type
 * of its answer, written once for both sides so that neither can drift from the other.
 *
 * v2 keeps one log a campaign, and every number here is a fold of it (`AGENTS.md`, section 5). Where
 * a fold's own type is plain data it is imported from the repository and passed through, never
 * declared again: a handover is `Handover` (`src/builder/handover.ts`), the set-up is `Supply`, a
 * tally is `Tally`, the reader's rows and triggers are `Row` and `Trigger`. A field the page needs
 * and no fold returns names, in its comment, the fold it is computed from.
 *
 * Two tiers (the brief of 11 October, section 8). The default tier, a token alone, serves counts,
 * tallies, readings, digests, costs, task ids and states, a Builder session's own turns and calls, a
 * practice solve's trace and a kept harness's `agent/` files. The exam tier, a server started with
 * `--exam-side`, adds task text, hidden values, answers, verdicts, rulings and their reasons, an
 * Examiner session's turns and calls, a held-out solve's trace and a raw event. Every field the
 * exam tier alone carries is optional and says so; an endpoint the exam tier alone answers is in
 * `EXAM_ONLY` and answers 403 otherwise. A ruling stays hidden in both tiers while its rejection
 * waits for a person's label (`poolOf`, `src/kernel/reports.ts`) and while its comparison has
 * not reported; and while any ruling of a comparison is hidden, so are its rulings by kind, since
 * only a ruling that is not `earned` sets a task aside and the counts would give the hidden one
 * away (`Rulings`).
 *
 * Every answer carries its tier and its issues: a refused or unreadable path is an issue the page
 * shows, never a silent empty list.
 */
import type { Supply } from "../../../src/builder/admission.ts";
import type { regressionOf, Share, Worth } from "../../../src/builder/climb.ts";
import type { Handover } from "../../../src/builder/handover.ts";
import type { Decided, Ending as CampaignEnding } from "../../../src/builder/move.ts";
import type { Seat, Terms } from "../../../src/builder/opening.ts";
import type { Tally } from "../../../src/kernel/compare.ts";

export type { Tally };
import type { EventKind } from "../../../src/kernel/log.ts";
import type { comparedAs } from "../../../src/kernel/reports.ts";
import type { Ending as SolveEnding } from "../../../src/kernel/solve.ts";
import type { taskStates } from "../../../src/kernel/task.ts";
import type { JsonObject, JsonValue } from "../../../src/meta/json-shape.ts";
import type { Ruling } from "../../../src/review/referee.ts";
import type { Trigger } from "../../../tools/wri/folds.ts";
import type { Row } from "../../../tools/wri/read.ts";
import { hasText } from "../../../src/meta/text.ts";

export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

/** Which tier the server answers in: `--exam-side` makes it `exam`. */
export type Tier = "default" | "exam";

/** Something the server could not read, or refused to: shown, never swallowed. */
export interface Issue {
  readonly level: "warning" | "error";
  /** What it was reading: a log's path relative to its worktree, a harness file, an endpoint. */
  readonly source: string;
  readonly message: string;
}

/** What every answer carries. */
export interface Answer {
  readonly tier: Tier;
  readonly issues: readonly Issue[];
}

/** Why a request was refused before any reading: no or a wrong token, a `Host` that is not the
 *  loopback, or an exam-side endpoint on a server without `--exam-side`. */
export type Refusal = "token" | "host" | "exam-side";

/** The body of every failed request. */
export interface ApiError {
  readonly error: string;
  readonly refused?: Refusal;
}

// ---------------------------------------------------------------------------------------------
// GET /api/campaigns

/** One campaign as the sidebar lists it. */
export interface CampaignRow {
  /** Opaque and stable: the server forms it from the worktree and the name, which repeat apart. */
  readonly key: string;
  readonly name: string;
  /** The worktree's folder name, the small label beside the name. */
  readonly tree: string;
  /** The project the campaign's opening names (`--project`, `Opening.project`), or `NO_PROJECT`
   *  for a campaign whose opening names none: one opened before 12 October, or run by the hand
   *  commands alone, which write no opening. */
  readonly project: string;
  /** `running` while a process writes the log (`writers`, `tools/runs/registry.ts`), `ended` once its
   *  last event is `campaign.ended`, and `open` otherwise: stopped with no ending, or between
   *  commands. */
  readonly status: "running" | "open" | "ended";
  /** The last `campaign.ended`, where the campaign ended. Its reason is free text, and an
   *  environment's is the error that ended the campaign (`errorMessage`, `tools/d2/harness-builder.ts`),
   *  which may quote anything the failing step saw: the default tier sends the reason of an ending
   *  the controller words itself, and the kind alone of an environment's. */
  readonly ending: { readonly ending: CampaignEnding; readonly why?: string } | null;
  /** The last event's time; null for an empty log. An open campaign that last wrote long ago is
   *  probably a process stopped with no ending, which the log cannot say. */
  readonly lastEventAt: string | null;
  /** The last comparison that reported (`lastReports`). */
  readonly lastReading: {
    readonly id: string;
    readonly reading: string;
    readonly tally: Tally | null;
  } | null;
  /** Dollars billed over the whole log (`billedAll`), and the opening's total, null where none. */
  readonly billed: number;
  readonly budget: number | null;
  /** A copy of another campaign made to rehearse on (`Run.seed`, `tools/runs/registry.ts`). */
  readonly seed: boolean;
}

export interface CampaignList extends Answer {
  /** Newest first, by the time of each log's first event. */
  readonly campaigns: readonly CampaignRow[];
}

// ---------------------------------------------------------------------------------------------
// GET /api/campaign?key=

/**
 * The Referee's rulings of a comparison's rejections. By kind where none of them is withheld; where
 * one is, how many rejections were ruled and no kind, in both tiers: only a ruling that is not
 * `earned` sets a task aside, so the kinds beside the outcome split would give the withheld ruling
 * away.
 */
export type Rulings =
  | { readonly withheld: false; readonly kinds: Readonly<Record<Ruling, number>> }
  | { readonly withheld: true; readonly ruled: number };

/** A handover as the page receives it: a comparison's rulings as `Rulings`, never by kind while one
 *  is withheld. */
type Shown<Step> = Step extends { readonly step: "comparison" }
  ? Omit<Step, "rulings"> & { readonly rulings: Rulings }
  : Step;

/** The decision table's row a move was made by, as the move records it (`campaign.move`): the
 *  row's code and its reason. Where a Builder leads its campaign, a move it made that the table did
 *  not name carries `asked` and what the table named, and its conversation carries `led`. */
export interface Named {
  readonly code: string;
  readonly why: string;
}

/** A step of the campaign, as `campaignOf` hands it over, with when it ran. */
export type Move = Shown<Handover> & {
  /** The place of its start in the log: what names a move, in the route and to `/api/move`. Its id
   *  does not, since a round runs a Builder session and the comparison after it under one id
   *  (`tools/d2/round.ts`). */
  readonly index: number;
  readonly startedAt: string;
  /** The table's row the move was made by; null where no move of the campaign's command records
   *  one: a step run by hand, or a campaign from before a move kept its code. */
  readonly named: Named | null;
  /** Its end, or a comparison's first report; null while open or where it was cut. */
  readonly endedAt: string | null;
};

/** One scored task of a comparison, by what it came to. A tie is split by the reference harness
 *  (the old side) alone: valid on every solve leaves no room, valid on none is too hard or
 *  unanswered, valid on some is the rest. `aside` is a task set aside for a person's label. The
 *  tasks a comparison left out of its tally otherwise are `LeftOut`. */
export interface Outcomes {
  readonly won: number;
  readonly lost: number;
  readonly tiedEvery: number;
  readonly tiedSome: number;
  readonly tiedNone: number;
  readonly aside: number;
}

export type Outcome = keyof Outcomes;

/** The tasks a comparison fixed and left out of its tally and of its set-aside ones, as its report
 *  names them: disputed for good, short of its solves a side under a harness, and withdrawn from the
 *  held-out set while it ran. With `Outcomes` they sum to the tasks it fixed. */
export interface LeftOut {
  readonly disputed: number;
  readonly short: number;
  readonly withdrawn: number;
}

/** One comparison as the main chart draws it, in the order the comparisons first reported, a
 *  comparison with no report where it began. */
export interface ComparisonBar {
  readonly id: string;
  /** Its move's place in the log (`Move.index`), by which a bar opens its comparison. */
  readonly move: number;
  readonly old: string;
  readonly fresh: string;
  /** `control`: the starter against the reference, or a harness against itself; `repeat`: the same
   *  two harnesses as an earlier comparison, on fresh solves; `candidate`: the rest. */
  readonly kind: "candidate" | "repeat" | "control";
  /** The earlier comparison of the same two harnesses that a repeat repeats; null for the rest. */
  readonly repeats: string | null;
  /** The setting id its start names; a change between two bars is drawn as a break. */
  readonly setting: string | null;
  readonly level: number;
  /** Its scored tasks, as its start fixed them. */
  readonly tasks: number;
  readonly tally: Tally | null;
  readonly reading: string | null;
  /** The test of the tally (`flipP`), null without one. */
  readonly p: number | null;
  /** Its scored tasks by outcome, computed from `pairsReported` and the report's `aside`, and the
   *  rest of the tasks it fixed by why they were left out; the two sum to `tasks`. Null before it
   *  reports. */
  readonly outcomes: Outcomes | null;
  readonly leftOut: LeftOut | null;
  /** Each side's valid answers over its counted solves on the tallied tasks (the handover's `valid`
   *  read as a share). Null before it reports. */
  readonly valid: { readonly old: Share; readonly fresh: Share } | null;
  /** The reference against itself beside the test, where the comparison solved four a side. */
  readonly noise: {
    readonly tally: Tally;
    readonly p: number;
    readonly differences: readonly number[];
  } | null;
  /** The Referee's last ruling of each of its rejections, as the handover counts them, by kind only
   *  while none is withheld. */
  readonly rulings: Rulings;
  /** The host's one-minute load when it began (`campaign.move`), null where not recorded. */
  readonly load: number | null;
  /** The two sets the comparison's start fixed, as its report tallied them: the frontier, where the
   *  step is read, with its p; and the retained tasks, where a step may not lose more than it
   *  wins, `unmeasured` where none was tallied, which is never no loss. Null where no report holds
   *  them: a comparison with no report yet, or one from before the sets were read apart. */
  readonly sets: {
    readonly frontier: { readonly tally: Tally; readonly p: number };
    readonly retained: Tally | "unmeasured";
  } | null;
  /** The table's row the comparison was made by (`Move.named`). */
  readonly named: Named | null;
  /** The handover's three: cut before a report, and its solves begun and ended. */
  readonly cut: boolean;
  readonly begun: number;
  readonly solved: number;
  /** The sessions that started after the comparison before it began and before this one: the
   *  small marks between bars. */
  readonly between: { readonly examiner: readonly string[]; readonly builder: readonly string[] };
}

/** A promotion as `harness.promoted` records it: a divider between bars. */
export interface Promotion {
  /** The harness promoted. */
  readonly harness: string;
  /** The comparisons it rests on, as `comparedAs` gave them to the operator. */
  readonly rests: ReturnType<typeof comparedAs>;
  /** The operator's reason where the rule would not have promoted it. */
  readonly despite: string | null;
  /** It names the starter: the campaign returned to it. */
  readonly toStarter: boolean;
  readonly at: string;
  readonly index: number;
  /** The last comparison that began before it, where the divider stands; null before any. */
  readonly afterComparison: string | null;
}

/** One harness version in the lineage strip, starter first. */
export interface HarnessCard {
  /** Null for the starter alone, before any comparison named its digest. */
  readonly digest: string | null;
  readonly parent: string | null;
  /** The Builder session that left it; null for the starter and an imported harness. */
  readonly session: string | null;
  /** When it was kept: its session's end, or its import. Null for the starter. */
  readonly at: string | null;
  /** Each may hold together: the latest can be the reference. */
  readonly starter: boolean;
  readonly reference: boolean;
  readonly latest: boolean;
  /** Kept by `harness.imported`, not by a session. */
  readonly imported: boolean;
  /** Why it does not open, as its session's end says (`build.finished.broken`). */
  readonly broken: string | null;
  /** Its practice solves (`practiceRan`): the valid ones and all that ended with a pass or a fail. */
  readonly practice: { readonly passed: number; readonly solves: number };
  /** Each comparison it was the new harness of, its move's place in the log, what it was read
   *  against and how. */
  readonly comparedIn: readonly {
    readonly id: string;
    readonly move: number;
    readonly against: string;
    readonly tally: Tally | null;
    readonly reading: string | null;
  }[];
}

/** Dollars billed, cumulative, at the end of each move in log order (`billedParts`). */
export interface SpendPoint {
  readonly at: string;
  readonly move: string;
  readonly cumulative: number;
}

export interface Counters {
  /** Moves without a gain since the last step, and the patience they are held to (`stopRule`). */
  readonly withoutGain: number;
  readonly patience: number;
  /** Two things wait for a person's label: held-out tasks no comparison answered (`poolOf`,
   *  as the supply counts them), and the rejections set aside in comparisons nobody has settled
   *  (`toLabel`). */
  readonly labels: { readonly tasks: number; readonly rejections: number };
  /** A/A readings on record (a report's `noise`), and how many of them read a step, by the
   *  whole-run reader's rule: either side winning is a false step. */
  readonly controls: number;
  readonly controlSteps: number;
  /** What the promotion attempts under the current reference risk together (`falsePromotion`,
   *  `epochsOf`), and the share past which the table holds the next attempt for an A/A (`RISK`).
   *  Null only where the log holds no epoch. */
  readonly risk: {
    readonly attempts: number;
    readonly union: number;
    readonly bound: number;
    readonly pairs: number;
    readonly errors: number;
    readonly indicative: boolean;
    readonly hold: number;
  } | null;
  /** The dollars left of the campaign's total (`Plan.left`), and what the last comparison the cap
   *  did not cut billed for its solves (`billedParts`), which the table prices the next one by
   *  (`unafforded`). Null for a campaign with no total, or before a comparison has reported. */
  readonly runway: { readonly left: number; readonly each: number; readonly comparison: string } | null;
}

/** The table's next move (`decide`), and its line as the view prints it (`decidedLine`). The
 *  default tier is sent an environment ending's reason as a campaign's row sends it, not at all:
 *  the move carries a stand-in, and its line is built from that. */
export type NextMove = Decided & { readonly line: string };

export interface CampaignReading extends Answer {
  readonly row: CampaignRow;
  /** The operator's prompt the campaign opened from (`Opening.prompt`); null for one over a pack. */
  readonly prompt: string | null;
  /** Who sits in each model seat, and who solves: the setting's solver, else the opening's. */
  readonly seats: {
    readonly builder: Seat | null;
    readonly examiner: Seat | null;
    readonly reviewer: Seat | null;
    readonly solver: Seat | null;
  };
  /** The terms of the campaign's moves as its opening keeps them (`Opening.terms`). */
  readonly terms: Terms;
  /** Whether the freeze and a promotion wait for the operator's word (`Opening.attended`,
   *  `--attended`). The table names such a move all the same, and the campaign command waits. */
  readonly attended: boolean;
  /** Whether the campaign's Builder leads it (`Opening.led`, `--builder-led`): past the exam's
   *  set-up one Builder conversation makes the moves, and the table's next move is its advice.
   *  False where the host makes every move the table names. */
  readonly led: boolean;
  /** The bar a promotion's cost is read against, as the opening sets it or by default
   *  (`barsOf`, `src/builder/climb.ts`): read and printed, gating nothing. */
  readonly bars: Worth["bars"];
  readonly supply: Supply;
  /** Digests: the harness last promoted, and the starter as the comparisons name it. Null where the
   *  log names none. */
  readonly reference: string | null;
  readonly starter: string | null;
  /** Each harness the log names, by digest, with its letter: the Starter A, the rest B on in the
   *  order the log first names them (`namesOf`, `src/builder/names.ts`). */
  readonly names: Readonly<Record<string, string>>;
  /** Null where the table could not be asked; an issue says why. */
  readonly nextMove: NextMove | null;
  /** Steps open at the log's end (`openSteps`). */
  readonly open: readonly string[];
  /** Every step in the order it started. */
  readonly moves: readonly Move[];
  readonly comparisons: readonly ComparisonBar[];
  readonly promotions: readonly Promotion[];
  readonly harnesses: readonly HarnessCard[];
  readonly spend: readonly SpendPoint[];
  readonly counters: Counters;
  /** The newest candidate read against the one before it (`regressionOf`), one line beside the
   *  counters; null where the log holds no two candidates read against one reference. */
  readonly regression: ReturnType<typeof regressionOf>;
  /** The whole-run reader's rows and triggers (`overview`, `tools/wri/read.ts`), and how many of its
   *  triggers the default tier withholds: those of the exam side's lanes, which name checks and
   *  what they refused. */
  readonly reader: {
    readonly rows: readonly Row[];
    readonly triggers: readonly Trigger[];
    readonly withheld: number;
  };
}

// ---------------------------------------------------------------------------------------------
// GET /api/move?key=&move=, /api/solve?key=&id=

/** One model turn of a solve or a session (`<seat>.turn`). */
export interface Turn {
  readonly index: number;
  readonly turn: number;
  readonly text: string;
  readonly stopReason: string | null;
  readonly error: string | null;
  /** The turn's metered dollars (`usage.cost.total`), null where it carries none. */
  readonly billed: number | null;
}

/** One tool call of a solve or a session (`<seat>.call`). The result is cut by the server to a
 *  readable length; `truncated` says so, and the raw event is the exam tier's `/api/event`. */
export interface ToolCall {
  readonly index: number;
  /** Its number among the calls of its solve or session, from one. */
  readonly seq: number;
  readonly turn: number;
  readonly tool: string;
  readonly args: JsonValue;
  readonly isError: boolean;
  readonly result: string | null;
  readonly truncated: boolean;
  readonly ms: number | null;
}

/** One solve as a list row shows it. */
export interface SolveRow {
  readonly id: string;
  readonly task: string;
  /** The task's own id, which a default-tier page may show; null where the log names none. */
  readonly taskId: string | null;
  readonly harness: string;
  /** Where it stood: a side of a comparison, practice, or a comparison's further arm (the
   *  reference against itself). */
  readonly side: "old" | "fresh" | "practice" | "other";
  readonly comparison: string | null;
  /** Null while it has not ended. */
  readonly ending: SolveEnding | null;
  readonly turns: number | null;
  readonly calls: number;
  readonly seconds: number | null;
  readonly billed: number | null;
  /** Exam tier only, and absent in both tiers while it is withheld (`Withheld`). Null where no
   *  ruling is on record. */
  readonly ruling?: Ruling | null;
}

/** Why a ruling is withheld in both tiers: a person's label of its rejection is still to come, or
 *  its comparison has not reported, so nothing has said yet what a person will be asked to label.
 *  Null where it is not withheld. */
export type Withheld = "label" | "report" | null;

/** A Builder or Examiner session's detail. */
export interface SessionDetail extends Answer {
  readonly kind: "session";
  readonly move: Move & { readonly step: "builder" | "examiner" };
  /** A Builder session's own turns and calls in the default tier; an Examiner session's in the exam
   *  tier only. */
  readonly turns?: readonly Turn[];
  readonly calls?: readonly ToolCall[];
  /** A Builder session's practice solves; empty for an Examiner session. */
  readonly solves: readonly SolveRow[];
}

/** The terms a comparison fixed before its first solve (`comparison.started`). */
interface ComparisonTerms {
  readonly old: string;
  readonly fresh: string;
  readonly starter: string | null;
  readonly setting: string | null;
  readonly solves: number;
  readonly cap: number | null;
  /** The model's turns its solves were told (`Compared.modelTurns`). */
  readonly modelTurns: number | null;
  /** The objective rule, where the check program declares one. */
  readonly objective: { readonly direction: "lower" | "higher"; readonly margin: number } | null;
  readonly prediction: string | null;
}

/** One task of a comparison, with each side's solves. */
export interface ScoredTask {
  readonly task: string;
  readonly taskId: string | null;
  /** What it came to; null for a task of a comparison that has not reported, which lists the tasks
   *  its start fixed and their solves so far. */
  readonly outcome: Outcome | null;
  /** Why the rulings of its rejections are withheld in both tiers, where they are
   *  (`rulingWithheld`, `server/trace.ts`). */
  readonly withheld: Withheld;
  readonly old: readonly SolveRow[];
  readonly fresh: readonly SolveRow[];
}

/** What a comparison's report says beside its test of what the test could see (`reported`). */
export interface Sensitivity {
  /** The step's own set: its untied tasks, the least share of them the new harness has to win for
   *  one reading to detect a step four times in five, null where none would; and the chance that an
   *  attempt at its margins promotes between equal harnesses (`falseRate`). Null in a report
   *  written before the sets were read apart. */
  readonly frontier: {
    readonly untied: number;
    readonly detectable: number | null;
    readonly falseRate: number;
  } | null;
  /** The tallied tasks informative for each harness, which room is read by (`roomOf`); null in a
   *  report written before 9 October. */
  readonly informative: { readonly old: number; readonly fresh: number } | null;
  /** The tied tasks no counted solve answered validly, the tallied tasks with a solve a solver
   *  flagged, and the tallied tasks the objective decided (null where it fixed none). */
  readonly unsolved: number;
  readonly flagged: number;
  readonly decided: number | null;
  /** The comparison of the same two harnesses before this one, and the tasks both scored. */
  readonly overlap: { readonly with: string; readonly tasks: number } | null;
  /** The mean billed dollars of a counted solve under each harness. */
  readonly billed: { readonly old: number | null; readonly fresh: number | null } | null;
  /** The reference against itself: how often two of its solves of a task disagree, and the least
   *  share of its untied tasks one half has to win to be detected four times in five. */
  readonly noise: { readonly flips: number | null; readonly detectable: number | null } | null;
  /** The families the frontier's untied tasks fall in, and how many of them the largest holds:
   *  concentration, which a count of tasks hides. Null where the report holds no families. */
  readonly families: { readonly count: number; readonly largest: number } | null;
}

export interface ComparisonDetail extends Answer {
  readonly kind: "comparison";
  readonly move: Move & { readonly step: "comparison" };
  readonly bar: ComparisonBar;
  readonly terms: ComparisonTerms;
  /** Null before it reports, and for a report that compared nothing. */
  readonly sensitivity: Sensitivity | null;
  readonly tasks: readonly ScoredTask[];
  /** The reader's triggers of the comparison lanes, shown collapsed. */
  readonly triggers: readonly Trigger[];
}

export type MoveDetail = SessionDetail | ComparisonDetail;

/** A solve's verdict (`verdictsOf`): what was judged and which checks refused it. */
interface SolveVerdict {
  readonly kind: string;
  readonly answer: JsonValue;
  readonly fault: string | null;
  readonly refusedBy: readonly string[];
}

export interface SolveDetail extends Answer {
  readonly solve: SolveRow;
  /** Whether its task was held out when the solve started; a practice task's solve is not. */
  readonly heldOut: boolean;
  /** Why its rejection's ruling is withheld in both tiers, where it is a rejection and it is. */
  readonly withheld: Withheld;
  readonly model: string | null;
  readonly effort: string | null;
  /** The host's one-minute load at its start (`solve.started.load`). */
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

// ---------------------------------------------------------------------------------------------
// GET /api/tasks?key=, /api/task?key=&id=

/** A task version's state as the fold holds it (`taskStates`). */
type TaskState = ReturnType<typeof taskStates> extends Map<string, infer State> ? State : never;

export interface TaskRow {
  /** The task version, and the task's own id. */
  readonly version: string;
  readonly id: string | null;
  readonly state: TaskState;
  /** Two readings beside the state: waiting for a person's label (`poolOf`), and answered
   *  by the reference in every solve of two comparisons (`poolOf`). */
  readonly awaitingLabel: boolean;
  readonly exhausted: boolean;
  /** Whether it is one of the spent tasks the draw keeps (`poolOf`, retained): a comparison scores
   *  it in its retained set, where a step may not lose more than it wins. A task is exhausted or
   *  retained, never both. */
  readonly retained: boolean;
  readonly proposedAt: string | null;
}

/** What a comparison came to on one task, with each side's valid answers over its solves. */
export interface TaskCell {
  readonly outcome: Outcome;
  readonly old: Share;
  readonly fresh: Share;
}

export interface TaskGrid extends Answer {
  /** The comparisons in the order of the main chart. */
  readonly columns: readonly Pick<
    ComparisonBar,
    "id" | "move" | "kind" | "reading" | "cut" | "old" | "fresh"
  >[];
  /** One a task version, in the order proposed; `cells` is aligned with `columns`, null where the
   *  comparison did not score the task. */
  readonly rows: readonly (TaskRow & { readonly cells: readonly (TaskCell | null)[] })[];
}

export interface TaskDetail extends Answer {
  readonly row: TaskRow;
  /** Its solves across comparisons and practice, in the order they started. */
  readonly solves: readonly SolveRow[];
  /** The task's public part: in the default tier for a practice task, in the exam tier for any. */
  readonly input?: JsonValue;
  /** Exam tier only. */
  readonly family?: string | null;
  readonly hidden?: JsonValue;
}

// ---------------------------------------------------------------------------------------------
// GET /api/log?key=&offset=&kind=&session=, /api/event?key=&index=

export const LOG_PAGE_SIZE = 100;

export interface LogRow {
  readonly index: number;
  readonly at: string;
  readonly kind: EventKind;
  readonly session: string | null;
  readonly solve: string | null;
}

/** A page of the log, the filters applied before paging, as v1's evidence list was. */
export interface LogPage extends Answer {
  readonly events: readonly LogRow[];
  readonly offset: number;
  /** Events that match the filters, of which this page is `LOG_PAGE_SIZE` at most. */
  readonly matching: number;
  readonly hasMore: boolean;
  /** What the filters can choose from: the kinds and the sessions the whole log holds. */
  readonly kinds: readonly EventKind[];
  readonly sessions: readonly string[];
}

/** One raw event, whole. The exam tier alone answers it. */
export interface LogEventDetail extends Answer {
  readonly at: string;
  readonly kind: EventKind;
  readonly data: JsonObject;
}

// ---------------------------------------------------------------------------------------------
// GET /api/harness?key=&digest=, /api/harness-file?key=&digest=&path=, /api/harness-diff?key=&a=&b=

/** How the inspector renders a file. */
export type FileContent = "json" | "jsonl" | "text" | "typescript" | "other";

/** The files of `states/<digest>/agent`, and nothing of the harness beside it. */
export interface HarnessFiles extends Answer {
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
}

/** One file of a harness's `agent/`, cut to a readable size. */
export interface HarnessFile extends Answer {
  readonly content: FileContent;
  /** The text, or the parsed value of a JSON file. */
  readonly value: JsonValue;
  readonly truncated: boolean;
  readonly bytes: number;
}

/** Two harnesses' `agent/` files compared, one unified diff a changed file. */
export interface HarnessDiff extends Answer {
  readonly files: readonly {
    readonly path: string;
    readonly change: "added" | "removed" | "changed";
    /** The unified diff, or null where it would have taken longer than the server allows; an
     *  issue names the file. */
    readonly diff: string | null;
  }[];
}

// ---------------------------------------------------------------------------------------------
// The endpoints

/**
 * Every endpoint: its query, each value a string as the URL carries it, and its answer. The client
 * builds a request from this map and the server routes by it, so a field or a parameter that one
 * side names and the other does not is a type error.
 */
export interface Endpoints {
  readonly campaigns: { readonly query: Readonly<Record<never, string>>; readonly answer: CampaignList };
  readonly campaign: { readonly query: { readonly key: string }; readonly answer: CampaignReading };
  /** `move` is a move's place in the log, or an id that names exactly one move. */
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
  readonly log: {
    readonly query: {
      readonly key: string;
      readonly offset?: string;
      readonly kind?: string;
      readonly session?: string;
    };
    readonly answer: LogPage;
  };
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
  log: { required: ["key"], optional: ["offset", "kind", "session"] },
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

/** The endpoints only the exam tier answers. */
export const EXAM_ONLY: ReadonlySet<Endpoint> = new Set<Endpoint>(["event"]);

/** Where every endpoint is served, and the header and URL parameter that carry the token. */
export const API_PREFIX = "/api/";
export const TOKEN_HEADER = "x-anabasis-token";
export const TOKEN_PARAMETER = "token";

/** Where a campaign stands whose opening names no project. A project is an id of letters, digits,
 *  `.`, `_` and `-` (`isSafePathSegment`), so no project can be spelled so. */
export const NO_PROJECT = "No project recorded";

export function shortHash(value: string | null | undefined, length = 12): string {
  if (!hasText(value)) return "not recorded";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

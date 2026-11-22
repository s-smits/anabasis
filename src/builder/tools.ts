/**
 * The Builder's tools. It is a coding agent on a harness's files, so it has what a solver has: pi's
 * own `read`, `bash`, `edit` and `write` on the command wall (`src/tools/coding.ts`), in one
 * working directory, its home. On top of them are the tools that are a Builder's alone. Two ask
 * the host about `harness/` as it stands and run on the same wall: `check_harness` and
 * `preview_harness`. Four are the host's: `practice`, `read_trace`, `read_opening` and `finish`.
 */
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { checkCouldNotRun, type Ending } from "../kernel/solve.ts";
import { limitsIn } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { callList, callText, closingOf, traceOf } from "../kernel/trace.ts";
import { billedParts } from "../kernel/meter.ts";
import {
  ended,
  passed,
  practiceRan,
  rejected,
  rejectionAside,
  solvesIn,
  verdictsOf,
} from "../kernel/solves.ts";
import { objectiveOf } from "../kernel/verify.ts";
import { GAP_FLOOR, gainOver, type ObjectiveRule } from "../kernel/compare.ts";
import { poolOf } from "../kernel/reports.ts";
import { taskStates } from "../kernel/task.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isFunction, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { ending as endSession, openDesk, text, tool } from "../tools/answer.ts";
import { CODING_TOOLS, codingTools, selectedCodingTools } from "../tools/coding.ts";
import { type CommandWall, type NetworkReach, networkReach } from "../tools/command.ts";
import type { Harness } from "../harness/open.ts";
import { installedPrograms } from "../harness/programs.ts";
import { homeHolds, systemPrompt } from "../solver/prompt.ts";
import { clockText, solverTools } from "../solver/run.ts";
import { STARTED as COMPARISON_STARTED } from "../campaign/comparison.ts";
import { budgetLeft } from "../campaign/opening.ts";
import { type Freezing, frozen, harnessNow, type HarnessSnapshot, snapshot } from "./kept.ts";
import { type Listed, measuredClause, type Said, shellWalls } from "./prompt.ts";
import type { BuildRequest, PracticeTask } from "./session.ts";

/** What a session's tools share. */
export interface Bench extends Freezing {
  readonly request: BuildRequest;
  /** The texts of this session that differ by who makes its campaign's moves (`SAID`). */
  readonly said: Said;
  /** Released tasks and the reference, refreshed by campaign tools while the conversation stays open.
   *  The reference is the one the session was handed, held opened, which every record names from
   *  the first session on; the log names none until a comparison reports (`referenceOf`). */
  tasks: readonly PracticeTask[];
  reference: HarnessSnapshot;
  /** The digest of the harness the session started from. */
  readonly parent: string;
  /** Practice solves spent. */
  spent: number;
  /** Task versions whose own check could not run on a practice answer. */
  readonly faulty: Set<string>;
  /** Reviewer failures, kept for the host: their text may name a check, so the Builder is not shown it. */
  readonly faults: string[];
  /** Aborted when the host stops the session at a bound or a campaign action fails. */
  readonly halt: AbortController;
  /** Run a campaign action without charging its elapsed time to the session's deadline, so that a
   *  led Builder is not left minutes to build and cut off before reading the comparison it bought. */
  readonly within: <T>(action: () => Promise<T>) => Promise<T>;
  /** What that practice solve threw; the session throws it again once its record is written. */
  fatal: Error | null;
  /** `finish`'s note; null until it is called. */
  note: string | null;
  /** What `finish` has told the Builder for each notice kind, keyed by the state it applied to
   *  (`finishNotice`), so editing `harness/` or promoting a new reference re-arms the notice. */
  readonly told: Map<"broken" | "untried" | "unread", string>;
}

/** What a Builder that leads its campaign is told at `finish` where no comparison has read harness
 *  `digest` against the reference, or null (`BuildRequest.campaign`). */
type Unmeasured = (digest: string) => Promise<string | null>;

/** What a task's valid answers are told against: the objective, and the author's answer on record. */
interface Against {
  readonly rule: ObjectiveRule;
  readonly author: number;
}

/** What a preview names the solve's home, which only a solve has. */
const SOLVE_HOME = "(the solve's own home directory)";
/** Where a band of the gain over the author's answer begins, after the tie floor. */
const BAND_EDGES = [GAP_FLOOR, 0.1, 0.5, 0.9] as const;
const percent = (share: number): string => String(Math.round(share * 100));

/**
 * A valid practice answer as the Builder is told it under an objective: the band of the gain a
 * comparison would read between it and the task author's answer on record (`gainOver`), never
 * either number. A measure may depend on the task's hidden values, and four digits of a few answers
 * to one task let a Builder solve for them: one jobstat Builder wrote such a solver and kept "solve
 * for the truth" in its memory. A band says whether a change closed on the author's answer and
 * roughly by how much, about three bits an answer where four digits gave thirteen. Two crafted
 * answers straddling one band's edge could still bracket a hidden value, at a solve each and only
 * through a harness that names the task. The log keeps every digit.
 */
function bandOf({ rule, author }: Against, measure: number): string {
  const gain = gainOver(rule, measure, author);
  const at = BAND_EDGES.findLastIndex((edge) => Math.abs(gain) >= edge);
  return at === -1 ? "level" : `${bandSize(at)} ${gain > 0 ? "better" : "worse"}`;
}

/** The size of the band that begins at `BAND_EDGES[at]`. */
function bandSize(at: number): string {
  const [lower, upper] = [BAND_EDGES[at] ?? GAP_FLOOR, BAND_EDGES[at + 1]];
  return upper === undefined ? `${percent(lower)}% or more` : `${percent(lower)} to ${percent(upper)}%`;
}

/** The bands as the practice tool's description states them once. */
const BANDS_TOLD = `level (within ${percent(GAP_FLOOR)}%), or better or worse by ${BAND_EDGES.map((_, at) => bandSize(at)).join(", ")}, each a share of the larger of the two measures, as a comparison reads a gap`;

/** For each task, what its valid answers are told against (`poolOf`), or nothing where the contract
 *  has no objective or the task no author's answer on record. */
function againstOf(events: readonly LogEvent[], contract: Contract): (version: string) => Against | null {
  const rule = contract.objective;
  if (rule === undefined) return () => null;
  const { bests } = poolOf(events);
  return (version) => {
    const author = bests.get(version);
    return author === undefined ? null : { rule, author };
  };
}

/** An ending as the Builder is shown it: the outcome and its kind. A non-result's reason can name a
 *  check, so only a broken harness's reason, which is the harness's own, is shown. */
function endingText(ending: Ending): string {
  if (ending.outcome === "pass") return "pass";
  if (ending.outcome === "non-result") return `no result (${ending.kind})`;
  if (ending.outcome === "flagged") return "flagged (the solver judged the task malformed)";
  return ending.kind === "broken-harness"
    ? `fail (broken harness: ${ending.reason})`
    : `fail (${ending.kind})`;
}

/** Where a valid practice answer stands against the author's answer (`bandOf`), which the Builder
 *  reads of its own practice only; `name` gives the quantity in full once a result, in brackets
 *  after "the objective", since a contract's quantity can run to a sentence, then "the objective". */
function measuredText(
  events: readonly LogEvent[],
  solve: string,
  against: Against | null,
  name: () => string,
) {
  const measure = objectiveOf(verdictsOf(events).get(solve)?.checker);
  return against !== null && measure !== null
    ? ` Measured ${name()} against the author's answer on record: ${bandOf(against, measure)}.`
    : "";
}

/** A task version's counted practice solves under one harness, by the log's condition records,
 *  in the order they ended. A solve a comparison made of the task is none (`practiceRan`). */
export function record(events: readonly LogEvent[], version: string, harness: string) {
  const mine = practiceRan(events).filter(({ under }) => under.task === version && under.harness === harness);
  const counted = ended(mine).flatMap((solve) => {
    if (rejectionAside(events, solve)) return [];
    const pass = passed(solve);
    return pass === null ? [] : [{ solve: solve.id, pass }];
  });
  return { solves: counted.map(({ solve }) => solve), passed: counted.filter(({ pass }) => pass).length };
}

/** Counted practice on an offered task under this exact digest, whether passed or failed. */
export function hasPractice(
  bench: Pick<Bench, "tasks">,
  events: readonly LogEvent[],
  harness: string,
): boolean {
  return bench.tasks.some(({ version }) => record(events, version, harness).solves.length > 0);
}

/** How much of its limits a finished solve used, as a sentence after its ending: the seconds from
 *  its start to its end, the verifier's among them, of its time limit, the model's own turns, and
 *  the tokens the model read and wrote over them. Empty where the log holds no end for the solve.
 *  A Builder that is not told this cannot tell a harness that passes with a minute to spare from
 *  one that passes at the limit. The tokens are the one measure of what a tool or a program costs a
 *  solve that the Builder can act on, since most of a short solve's tokens are its prompt read
 *  again each turn. */
function usedText(events: readonly LogEvent[], solve: string): string {
  const { start, end } = solvesIn(events).find(({ id }) => id === solve) ?? {};
  const limits = limitsIn(start?.limits);
  if (!isNumber(end?.seconds) || !isNumber(end.turns) || limits === null) return "";
  const given = limits.modelTurns === undefined ? "" : ` of ${String(limits.modelTurns)}`;
  const tokens = asRecord(end.tokens);
  const count = (value: JsonValue | undefined) => (isNumber(value) ? value : 0);
  const readTokens = count(tokens?.input) + count(tokens?.cacheRead) + count(tokens?.cacheWrite);
  const counted =
    tokens === null
      ? ""
      : `, and read ${String(readTokens)} tokens and wrote ${String(count(tokens.output))}`;
  return ` It took ${clockText(end.seconds)} of ${clockText(limits.wallSeconds)} and ${plural(end.turns, "model turn")}${given}${counted}.`;
}

/** One practice solve and what the Referee read of its fail. Throws only what the solve itself
 *  threw: a Referee that fails is noted for the host and leaves the rejection set aside. */
async function practise(bench: Bench, task: PracticeTask, kept: HarnessSnapshot, kill: AbortSignal) {
  const { request } = bench;
  const { solve, ending } = await request.practise(task, kept.dir, kept.harness.digest, kill);
  const lines: string[] = [];
  if (checkCouldNotRun(ending)) {
    bench.faulty.add(task.version);
    lines.push("The task's own check could not run on this answer: the task leaves this session's practice.");
  }
  // Only a rejected answer has anything to recompute: a solve its limits ended, or one that gave no
  // answer, is not valid with no ruling (`src/campaign/round.ts`), and the Referee is not asked of
  // it.
  if (rejected(ending) && request.referee !== undefined) {
    try {
      const finding = await request.referee(solve, task, kill);
      // The log holds the dispute, as a comparison's does (`dispute`, `src/campaign/round.ts`), so
      // every reader of the practice set sees it, and the campaign owes another practice task in
      // its place rather than leaving the next session to pay to learn it again.
      if (finding.ruling === "check-defect") {
        if (taskStates(read(request.log)).get(task.version) === "released") {
          append(request.log, "task.state", {
            version: task.version,
            state: "disputed",
            session: request.id,
            solve,
          });
        }
        lines.push("The task leaves practice.");
      }
    } catch (error) {
      bench.faults.push(`${solve}: ${errorMessage(error)}`);
    }
  }
  return { task, solve, ending, lines };
}

/**
 * The practice solves a session may still start. A Builder that leads its campaign has as many as
 * what is left of the campaign's total holds a reserve for, and no count of its own, since a fixed
 * count can run out with most of the budget left. A session by hand keeps
 * its count, and no more than its own part of the log leaves its cap a reserve for (`billedParts`).
 * The Builder is told a count and never a sum.
 */
export function practiceLeft({ request, spent }: Bench, events: readonly LogEvent[]): number {
  const left = request.campaign === undefined ? null : budgetLeft(events);
  if (left !== null) return Math.max(0, Math.floor(left.dollars / left.reserve));
  const counted = request.limits.practiceSolves - spent;
  if (request.cap === undefined) return counted;
  const afforded = Math.floor(
    (request.cap.dollars - billedParts(events, request.id).session) / request.cap.reserve,
  );
  return Math.max(0, Math.min(counted, afforded));
}

/** The band of each of `solves`'s valid answers against the author's answer on record (`bandOf`). */
function measuresOf(
  verdicts: ReturnType<typeof verdictsOf>,
  solves: readonly string[],
  against: Against | null,
): string[] {
  return against === null
    ? []
    : solves
        .flatMap((id) => objectiveOf(verdicts.get(id)?.checker) ?? [])
        .map((measure) => bandOf(against, measure));
}

/** Practice tasks with their counted records under `parent` and, when distinct and solved, under the
 *  `reference` harness, each valid answer as its band against the author's answer. */
export function listedPractice(
  events: readonly LogEvent[],
  tasks: readonly PracticeTask[],
  { parent, reference }: { readonly parent: string; readonly reference: string },
  contract: Contract,
): Listed[] {
  const states = taskStates(events);
  const verdicts = verdictsOf(events);
  const againstFor = againstOf(events, contract);
  return tasks.map(({ version, task }) => {
    const kept = record(events, version, parent);
    const against = againstFor(version);
    const measures = measuresOf(verdicts, kept.solves, against);
    const ref = reference === parent ? null : record(events, version, reference);
    return {
      taskId: task.taskId,
      family: task.family,
      left: states.get(version) === "disputed",
      ...kept,
      ...keyIfDefined("measures", measures.length > 0 ? measures : undefined),
      ...keyIfDefined(
        "reference",
        ref !== null && ref.solves.length > 0
          ? { digest: reference, ...ref, measures: measuresOf(verdicts, ref.solves, against) }
          : undefined,
      ),
    };
  });
}

/** A task's practice record under each harness `roles` names, each digest once with all its roles,
 *  and under an objective each valid answer's band against the author's answer (`task.feasible`),
 *  so that a pass that costs more than the author's still reads as room to gain. A solve under
 *  harness/ also names the record under the reference, which a promotion moves off the parent.
 *  Only practice solves of released tasks are read (`record`). */
function recordText(
  events: readonly LogEvent[],
  version: string,
  roles: readonly (readonly [string | null, string])[],
  against: Against | null,
  name: () => string,
) {
  const named = new Map<string, string[]>();
  for (const [digest, role] of roles) {
    if (digest !== null) named.set(digest, [...(named.get(digest) ?? []), role]);
  }
  const verdicts = verdictsOf(events);
  return [...named]
    .map(([digest, [role, ...also]], index) => {
      const kept = record(events, version, digest);
      const which = `${role ?? ""}${also.length > 0 ? `, which is also ${also.join(" and ")}` : ""}`;
      const measured = measuredClause(name, measuresOf(verdicts, kept.solves, against));
      return `${index === 0 ? "Record under" : "Under"} ${which}: ${index === 0 ? "passed " : ""}${String(kept.passed)} of ${String(kept.solves.length)}${measured}.`;
    })
    .join(" ");
}

export function practiceTool(bench: Bench): SeatTool {
  const { request } = bench;
  return tool({
    name: "practice",
    description: `Solve practice tasks with the harness as it stands in harness/, by the solver it is measured with, under the host's limits: a practice solve takes as long as any solve. Each named task is solved once; name a task twice to solve it twice. For each solve it returns the ending, what the solve used of its limits and the tokens it read and wrote, the task's record of practice solves under each harness the result names, the reference harness among them, the solve's id for read_trace and, for a rejection the Referee set aside, that it was set aside; never which check refused an answer. Under an objective a valid answer's measure is given as a band against the task author's answer on record: ${BANDS_TOLD}; a task with no author's answer on record shows none. A harness that does not open spends no solve. \`under: "reference"\` costs the same solves and shows what your change is measured against.`,
    parameters: Type.Object({
      tasks: Type.Array(Type.String(), {
        minItems: 1,
        description: "Practice task ids, as the opening message lists them.",
      }),
      under: Type.Optional(
        Type.Union([Type.Literal("harness"), Type.Literal("reference")], {
          description:
            "Which harness solves: harness/ as it stands (the default), or the reference harness yours is compared with.",
        }),
      ),
    }),
    execute: async (args, _api, context) => {
      const offered = new Map(bench.tasks.map((task) => [task.task.taskId, task]));
      const unknown = args.tasks.find((id) => !offered.has(id));
      if (unknown !== undefined) {
        throw new Error(
          `${unknown} is not one of this session's practice tasks: ${[...offered.keys()].join(", ")}`,
        );
      }
      const chosen = args.tasks.flatMap((id) => offered.get(id) ?? []);
      const asked = read(request.log);
      const states = taskStates(asked);
      const closed = chosen.find(
        ({ version }) => states.get(version) !== "released" || bench.faulty.has(version),
      );
      if (closed !== undefined) throw new Error(`${closed.task.taskId} is no longer a practice task`);
      const left = practiceLeft(bench, asked);
      if (chosen.length > left) {
        throw new Error(
          `only ${plural(left, "practice solve")} left, and this asks for ${String(chosen.length)}`,
        );
      }
      // Stop sibling solves on a host fault, then let this tool record its refusal before the
      // session ends through `over`. Aborting the seat here loses durable's unfinished call.
      const failed = new AbortController();
      const kill = AbortSignal.any([context.abortSignal ?? bench.halt.signal, failed.signal]);
      // Under the reference the solve runs the harness the session's is compared with, and harness/
      // as it stands need not open. What the reference does on a task is the Builder's to buy with
      // its own solve, and each result's record names what such solves found. There is no
      // `under: "parent"`, since Builders hardly ever named it.
      const ran = args.under === "reference" ? bench.reference : await snapshot(bench);
      if (kill.aborted) throw new Error("The session has ended.");
      bench.spent += chosen.length;
      let unstarted = 0;
      const solved = await pooled(chosen, request.limits.concurrency, async (task) => {
        if (bench.fatal !== null) return [];
        try {
          return [await practise(bench, task, ran, kill)];
        } catch (error) {
          // The session's end reaches a solve still waiting in the solve queue: no fault of anyone's.
          if (kill.aborted && error === kill.reason) {
            unstarted += 1;
            return [];
          }
          bench.fatal ??= asError(error);
          failed.abort();
          return [];
        }
      });
      if (bench.fatal !== null) {
        throw new Error(
          "A practice solve could not be run, which is the host's fault and not the harness's. The session ends here.",
        );
      }
      if (unstarted > 0) {
        bench.spent -= unstarted;
        throw new Error("The session has ended.");
      }
      const events = read(request.log);
      const under = args.under ?? "harness";
      const roles = [
        [under === "reference" ? null : ran.harness.digest, "this harness"],
        [bench.reference.harness.digest, "the reference harness"],
        [under === "reference" ? (bench.opened?.harness.digest ?? null) : null, "harness/ as last practised"],
        [bench.parent, "the harness you started from"],
      ] as const;
      const names = [`the objective (${request.contract.objective?.quantity ?? ""})`];
      const name = () => names.shift() ?? "the objective";
      const againstFor = againstOf(events, request.contract);
      // A task's record is read once all its solves finished, so it follows its last solve alone.
      const flat = solved.flat();
      const last = new Map(flat.map(({ task }, at) => [task.version, at]));
      const said = flat.map(({ task, solve, ending, lines }, at) => {
        const shown = rejectionAside(events, { id: solve, ending })
          ? "rejection set aside"
          : endingText(ending);
        const against = againstFor(task.version);
        return [
          `${task.task.taskId}${under === "reference" ? " under the reference harness" : ""}: ${shown}. Solve ${solve}.${usedText(events, solve)}${measuredText(events, solve, against, name)}`,
          ...(last.get(task.version) === at ? [recordText(events, task.version, roles, against, name)] : []),
          ...lines,
        ].join("\n");
      });
      const after = practiceLeft(bench, events);
      return text(
        `${said.join("\n\n")}\n\n${
          after > 0
            ? `${plural(after, "practice solve")} left.`
            : "No practice solve is left: what you change from here on is measured without a solve having run it."
        }`,
      );
    },
  });
}

/** The trace of a practice solve. Which task version a solve ran is read from its logged
 *  condition, so a solve of any other task is refused whatever id is asked for. */
export function traceTool(bench: Bench): SeatTool {
  return tool({
    name: "read_trace",
    description:
      "Read a solve of one of your practice tasks: the ones the opening message lists and the ones practice returns. With no call, return its ending, the answer it submitted, its closing text and every tool call by number, each with its size and its arguments on one line. With a call number, return that call whole: its arguments and its result.",
    parameters: Type.Object({
      solve: Type.String({ description: "A solve's id." }),
      call: Type.Optional(Type.Number({ minimum: 1, description: "A call's number, from the list." })),
    }),
    execute: async (args) => {
      const versions = new Set(bench.tasks.map(({ version }) => version));
      const events = read(bench.request.log);
      const ran = practiceRan(events).find(({ id }) => id === args.solve);
      // A practice task disputed after a check defect leaves `bench.tasks` on refresh, yet its
      // prior practice solves remain on the build side (`firstMessage` promises `read_trace` opens them).
      const released =
        ran !== undefined &&
        (versions.has(ran.under.task) ||
          events.some(
            ({ kind, data }) =>
              kind === "task.state" && data.state === "released" && data.version === ran.under.task,
          ));
      if (ran === undefined || !released) {
        throw new Error(`${args.solve} is not a solve of one of this session's practice tasks`);
      }
      const { turns, calls } = traceOf(events, "solve", args.solve);
      if (args.call !== undefined) return text(callText(calls, args.call));
      const answer = verdictsOf(events).get(args.solve)?.answer;
      return text(
        [
          `ending: ${rejectionAside(events, ran) ? "rejection set aside" : isString(ran.ending?.outcome) ? `${ran.ending.outcome}${isString(ran.ending.kind) ? ` (${ran.ending.kind})` : ""}` : "not recorded"}`,
          answer === undefined
            ? "no answer was submitted"
            : `submitted answer: ${capturedJsonStringify(answer)}`,
          `closing text: ${closingOf(turns) ?? "(none recorded)"}`,
          callList(calls),
        ].join("\n"),
      );
    },
  });
}

/**
 * What a Builder about to finish is told of `harness/` as it stands, once each: that it does not
 * open, or that it has changed since the session's last practice solve while solves are left. Null
 * where there is nothing to say, and where it has been said.
 *
 * These are finish notices. v1's submit refused a round that then measured nothing, 13 firmware
 * rounds by its own count, and a session here is frozen whatever it holds (`session.ts`). A Builder that
 * finishes is the one reader who can still act. A harness can go to the comparison with no
 * practice solve run on it, the solves spent on earlier versions, which is why `practice` says when
 * the last one is gone. A session that never
 * practised chose so and is told nothing here. A second `finish` ends the session as it is.
 */
async function finishNotice(bench: Bench, unmeasured?: Unmeasured): Promise<string | null> {
  const { request, told } = bench;
  const again = "or call finish again to end the session as it is";
  const now = await harnessNow(bench);
  if (!isString(now)) {
    const why = errorMessage(now);
    if (told.get("broken") === why) return null;
    told.set("broken", why);
    const { unpractised, practised } = bench.said.broken;
    return `${why}. Left so, ${bench.opened === null ? unpractised : practised}. Mend it and call finish again, ${again}.`;
  }
  const events = read(request.log);
  const left = practiceLeft(bench, events);
  // Practised under this exact digest, or run by a comparison as either of its harnesses.
  const tried =
    bench.opened === null ||
    now === bench.parent ||
    hasPractice(bench, events, now) ||
    events.some(({ kind, data }) => kind === COMPARISON_STARTED && (data.old === now || data.fresh === now));
  const untried = !tried && left > 0 && told.get("untried") !== now;
  const unreadKey = `${now}@${bench.reference.harness.digest}`;
  const unread = told.get("unread") === unreadKey ? null : ((await unmeasured?.(now)) ?? null);
  if (unread !== null) told.set("unread", unreadKey);
  if (untried) {
    told.set("untried", now);
    return `harness/ has changed since your last practice solve, so no solve has run it as it stands. ${plural(left, "practice solve")} ${left === 1 ? "is" : "are"} left. Practise it, ${again} ${bench.said.untried}.${unread === null ? "" : ` ${unread}`}`;
  }
  return unread === null ? null : `${unread} Call finish again to end the conversation as it is.`;
}

/**
 * Public opening facts, supplied as a fixed message or rebuilt on each read. A session whose
 * conversation was compacted, or lost with its process, has the public rules, practice tasks,
 * failed practice solves and comparisons in no other place: the host builds them from the log,
 * and the Builder's own notes are its prose about them. A campaign's conversation rebuilds them; a session
 * by hand keeps the original message. An Examiner's opening holds the record of every task and
 * serves it again, since Examiner sessions compact and a summary keeps only what the model chose
 * of that record.
 */
export function openingTool(opening: string | (() => string), description: string): SeatTool {
  return tool({
    name: "read_opening",
    description,
    parameters: Type.Object({}),
    execute: async () => text(isFunction(opening) ? opening() : opening),
  });
}

/**
 * `wait`: the next word of work running beside a session, as a call, for a seat whose results come
 * later: an Examiner's task admission, or the Examiner session beside a Builder's conversation.
 * Without one a sleep in the shell is the only call that waits, on the seat's own clock and often
 * long past the result it waits for.
 */
export function waitTool(description: string, next: () => Promise<string>): SeatTool {
  return tool({
    name: "wait",
    description,
    parameters: Type.Object({}),
    execute: async () => text(await next()),
  });
}

/** A Builder's tool with a line of the host's, given the call's id, as the last of whatever it
 *  returns, a result or an error, where the line is not empty: what the session has used of its
 *  limits (`usedLine`, `prompt.ts`). */
export function endingWith(each: SeatTool, line: (id: string) => string): SeatTool {
  return {
    ...each,
    execute: async (args, api, context) => {
      try {
        const result = await each.execute(args, api, context);
        const said = line(api.callId);
        if (said === "") return result;
        const output = result.output ?? [{ type: "text" as const, text: api.retainedOutput().text }];
        return { ...result, output: [...output, { type: "text", text: said }] };
      } catch (error) {
        const said = line(api.callId);
        throw new Error(said === "" ? errorMessage(error) : `${errorMessage(error)}\n\n${said}`, {
          cause: error,
        });
      }
    },
  };
}

export function finishTool(bench: Bench, unmeasured?: Unmeasured): SeatTool {
  return tool({
    name: "finish",
    description: bench.said.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    execute: async (args) => {
      // `finish` ends the session at this turn, so a finish notice on the next turn would reach nobody:
      // the call itself carries it, as v1's submit did (`3f93d06:src/gate/submit-tool.ts`).
      const stands = await finishNotice(bench, unmeasured);
      if (stands !== null) throw new Error(`Not finished. ${stands}`);
      bench.note = args.note.trim();
      return endSession(text("Finished."));
    },
  });
}

/** What a harness that opens gives a solver, a line for each of its three parts, and a note where
 *  one part makes another unreachable: programs under a solver with no shell. */
function opens(harness: Harness): string {
  const presets = selectedCodingTools(harness.presets);
  const programs = installedPrograms(harness.toolTree);
  return [
    "The harness opens.",
    `pi's tools: ${presets.join(", ") || "none"}.`,
    `Programs: ${programs.join(", ") || "none"}.`,
    `Guide: ${String(harness.guide?.length ?? 0)} characters.`,
    ...(programs.length > 0 && !presets.includes("bash")
      ? ["The solver has no shell, so it can run none of the programs itself."]
      : []),
  ].join("\n");
}

/** Open the harness and list what a solver gets from it, with no model call: a harness that does
 *  not open fails every task, and this finds that before a practice solve is spent on it. */
function checkTool(bench: Bench): SeatTool {
  return tool({
    name: "check_harness",
    description:
      "Open harness/ as a solve would. Reports pi's tools it selects, its programs by name and the guide's length, or the error a solve would stop on. Spends no practice solve.",
    parameters: Type.Object({}),
    execute: async () => await frozen(bench, ({ harness }) => text(opens(harness))),
  });
}

/**
 * What a solver would read under `harness/` as it stands, for the session's first practice task:
 * its system prompt whole and its tools as they are declared to it. A Builder wrote a guide and a
 * tool list without seeing where either lands; the solver's prompt has sections, and the guide is
 * one of them. The solve's own home is not known here, so the prompt names it by a placeholder.
 */
function previewTool(bench: Bench, wall: CommandWall): SeatTool {
  const { request } = bench;
  return tool({
    name: "preview_harness",
    description:
      "Show what a solver would read under harness/ as it stands, for one practice task: its system prompt whole, with your guide where the solver finds it and your programs' names, and each of its tools by name and description. Spends no practice solve.",
    parameters: Type.Object({}),
    execute: async () => {
      const [sample] = bench.tasks;
      if (sample === undefined) return text("This session has no practice task to preview a solve of.");
      return await frozen(bench, async ({ harness }) => {
        const tools = solverTools(request, harness, { ...wall, toolTree: harness.toolTree }, openDesk());
        const prompt = systemPrompt({
          tools,
          home: SOLVE_HOME,
          guide: harness.guide,
          wallSeconds: request.solve.wallSeconds,
          limits: request.solve,
          ...homeHolds(sample.task, request.resources),
          programs: installedPrograms(harness.toolTree),
          network: await networkReach({ ...wall, toolTree: harness.toolTree }),
        });
        const declared = tools.map(({ name, description }) => `- ${name}: ${description}`).join("\n");
        return text(
          `The system prompt a solver of ${sample.task.taskId} would read:\n\n${prompt}\n\nIts tools, as they are declared to it:\n${declared}`,
        );
      });
    },
  });
}

/** The tools that run on the command wall: pi's four, with what the Builder's shell is told of its
 *  wall, and the two that ask the host about `harness/`. */
export function walledTools(bench: Bench, wall: CommandWall, network: NetworkReach): SeatTool[] {
  return [
    ...codingTools(wall, CODING_TOOLS).map((each) =>
      each.name === "bash" ? { ...each, description: `${each.description}${shellWalls(network)}` } : each,
    ),
    checkTool(bench),
    previewTool(bench, wall),
  ];
}

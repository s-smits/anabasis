/**
 * The campaign's moves as a live Builder makes them: the tools its conversation is given beside
 * its own, and the advice their results end with. This module is the whole of what a campaign
 * led by its Builder adds to one the host runs (`--builder-led`, `harness-builder.ts`); the flags
 * and terms both run by are `campaign-terms.ts`.
 *
 * The Builder keeps one conversation and one working copy while it asks a separate Examiner for
 * tasks (`examine`), has the host release practice tasks (`release_practice`), freezes its harness
 * and has it compared (`compare`), and has an eligible harness made the reference (`promote`).
 * The decision table says which move follows from the log (`decide`, `src/campaign/decide.ts`), and
 * the Builder is told it as advice, with the campaign's public counts (`campaign_status`, and under
 * each action's result). It may choose another. What it cannot do is go past a condition of the
 * host's: each action runs the command an operator would run, with that command's admission and
 * refusals, under what is left of the campaign's total, behind the operator's words, and on the
 * exam's side of the wall. A tool returns counts and tallies and nothing of a held-out task.
 *
 * **A move is on record as it begins** (`campaign.move`, the overhaul plan's P9), for the two
 * actions that run a session or solve: with the code of the table's row where the Builder made the
 * move the table named and its reason, and with `asked` and what the table named where it made
 * another. A release and a promotion are the host's own acts of a moment, which their commands may
 * refuse, and a refusal is no move: they are recorded once made.
 *
 * An action that threw after it began ends the campaign on its environment
 * (`CampaignContext.failed`), unless what it threw was a provider's limit with a reset the
 * campaign waits out (`waitOut`, `src/solver/run.ts`): the Builder is then told to call the tool again.
 */
import { Type } from "typebox";
import type { SeatTool } from "#src/agent/session.ts";
import { Refused, supplyOf } from "#src/campaign/admission.ts";
import { CRASHES, decide, epochReleased, heldAfter, practiceOwed, unpromoted } from "#src/campaign/decide.ts";
import { comparisonsOf, crashedRun } from "#src/campaign/ground.ts";
import { campaignOf } from "#src/campaign/handover.ts";
import { type Decided, short } from "#src/campaign/move.ts";
import type { Opening } from "#src/campaign/opening.ts";
import { comparisonsTold } from "#src/builder/past.ts";
import { type BuildRequest, layPractice } from "#src/builder/session.ts";
import { type Bench, endingWith, snapshot, waitTool } from "#src/builder/tools.ts";
import { pendingWords } from "#src/campaign/word.ts";
import { examine } from "#src/examiner/session.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { latestBuilt, patienceOf, promoted as lastPromoted, stopRule } from "#src/kernel/reports.ts";
import { billedParts } from "#src/kernel/trace.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { plural } from "#src/meta/text.ts";
import { text, tool } from "#src/tools/answer.ts";
import { publicView } from "#src/solver/prompt.ts";
import { waitOut } from "#src/solver/run.ts";
import { examineCommand } from "../d1b/examine.ts";
import { keptAs, openCampaign, PROMOTED, packNamed } from "./campaign.ts";
import {
  comparisonOf,
  examinerRun,
  flag,
  idleOf,
  MOVED,
  nextId,
  opened,
  packOf,
  type Seats,
  type Turn,
  turnOf,
  type Values,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { waitCrashed } from "./host.ts";
import { PRACTICE, prepareCommand } from "./prepare.ts";
import { promoteCommand } from "./promote.ts";
import { type Campaign, type Seated, solved } from "./round.ts";

/** The four moves a live Builder makes by a tool, each under the tool's name. */
type ActionMove = "examine" | typeof RELEASE | "compare" | "promote";

type Compare = Extract<Decided, { move: "compare" }>;

/** What a campaign tool did, as the Builder reads it, or why it did nothing. */
type Outcome = { readonly said: string } | { readonly refused: string };

type ActionRun = (
  turn: Turn,
  decided: Decided,
  begin: (named: JsonObject) => void,
  signal: AbortSignal | undefined,
) => Promise<Outcome>;

/** What a live Builder's campaign tools are made with, and what they leave the command to read. */
export interface CampaignContext {
  readonly log: string;
  readonly values: Values;
  /** What the campaign runs by; a total the operator left as a word replaces it at an action. */
  opening: Opening;
  readonly seats: Seats;
  /** Who solves, each solve held in the solve queue (`queued`, `host.ts`). */
  readonly held: Seated;
  /** The campaign as last opened: an Examiner session and a promotion open it again. */
  campaign: Campaign;
  readonly paid: "paid" | "scripted";
  /** The moves this run of the command may make (`--moves`), and those it has made. */
  readonly maxMoves: number;
  used: number;
  /** The action that threw after it began, with what it threw: the environment's ending. */
  failed: { readonly move: string; readonly why: string } | null;
  /** The Examiner session writing beside the conversation, which settles and never throws, and the
   *  next practice release the host makes while it writes (`releaseOwed`). */
  examining?: {
    readonly session: string;
    readonly done: Promise<void>;
    readonly released: () => Promise<void>;
  } | null;
}

/** The code a move carries where the Builder made another than the table named. */
const ASKED = "asked";
const RELEASE = "release_practice";
/** How an Examiner session ended, as the Builder is told it: `supplied` is the host having the
 *  tasks it asked for, which is a whole session as `finished` is. */
const EXAMINED = new Map([
  ["finished", "ended whole"],
  ["supplied", "ended whole"],
  ["crashed", "crashed"],
  ["killed", "was stopped"],
]);

/** The released tasks as the Builder's workspace holds them, after a release or new tasks: the
 *  session's list, which `practice` and `read_trace` read, and the files under `practice/`. */
function refreshPractice(bench: Bench, campaign: Campaign): void {
  const packages = campaign.packages();
  const tasks = taskSets(read(campaign.log)).released.flatMap((version) => {
    const task = packages.get(version);
    return task === undefined ? [] : [{ version, task: publicView(task) }];
  });
  bench.tasks = tasks;
  layPractice(bench.home, tasks);
}

/** The campaign opened again, as an action left it: its tasks, its practice and its reference. */
async function refreshCampaign(context: CampaignContext, bench: Bench): Promise<void> {
  const campaign = await openCampaign(packNamed(context.values));
  context.campaign = campaign;
  refreshPractice(bench, campaign);
  bench.reference = (await keptAs(campaign, "--reference", PROMOTED)).dir;
}

/** The turn an action is made in and the move the table names for it. A total the operator left
 *  as a word is what the campaign runs by from here on, as at a move's boundary. */
function actionTurn(context: CampaignContext) {
  const words = pendingWords(read(context.log)).filter(({ word }) => word === "budget");
  if (words.length > 0) context.opening = opened(context.log, context.values, context.paid, words);
  const turn = turnOf(context);
  return { turn, decided: decide(turn.events, turn.plan) };
}

/** The tool that makes the table's move: a release for practice is `release_practice`. */
function toolOf(decided: Decided): string {
  return decided.move === "prepare" ? RELEASE : decided.move;
}

/**
 * One campaign tool. Before anything runs: the run's moves, the host's stop, an ending the table
 * names, and the operator's word for other tasks. A lack of room ends the campaign here as between
 * conversations: until 22 October it was advice while a conversation lived, and the job campaign of
 * 22 October started a seventh empty Examiner session after its supply patience of six (x-9, $3.03).
 * A comparison that began goes on under its own cap whatever is left of the total: the budget's
 * ending is the table's, read above.
 * `run` is handed `begin`, which writes the move's event (`campaign.move`): the table's code and
 * reason where the Builder made the move it named, and `asked` with what the table named otherwise.
 */
function actionTool(context: CampaignContext, bench: Bench, move: ActionMove, run: ActionRun): SeatTool {
  return tool({
    name: move,
    description: {
      examine:
        "Ask a separate Examiner to write tasks under the fixed exam. It returns at once and the Examiner writes beside you; the campaign's facts say what it has held out. A comparison is won on tasks the reference fails in some solve, or where the objective tells two valid answers apart.",
      release_practice: "Release the host's draw of public practice tasks into this workspace.",
      compare:
        "Freeze harness/ and compare it with the current reference on fresh held-out solves. Where a comparison began and has not reported, it goes on under its original terms. A comparison that reads a step against the reference promotes the harness it froze.",
      promote:
        "Make the harness whose comparison read a step against the reference the campaign's reference, where the host has not already done so as the comparison reported. Nothing else is promoted, and this measures nothing.",
    }[move],
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_args, _api, execution) => runAction(context, bench, move, run, execution.abortSignal),
  });
}

/** The same admission for a model's call and the Examiner session the host starts for it. */
async function runAction(
  context: CampaignContext,
  bench: Bench,
  move: ActionMove,
  run: ActionRun,
  signal: AbortSignal | undefined,
): Promise<ReturnType<typeof text>> {
  const label = move.replaceAll("_", " ");
  const halt = (message: string) => {
    bench.halt.abort();
    return text(message);
  };
  if (context.used >= context.maxMoves) {
    return halt("The campaign move limit has been reached; the host will stop this conversation.");
  }
  if (signal?.aborted === true) return text("The campaign has been stopped by the host.");
  // An Examiner session writes beside the conversation, and a comparison or a promotion waits
  // for it, on the host's time: two actions never spend from the total at once. A release
  // spends nothing and goes on beside it: until 19 October it waited too, and in each of three
  // replicates of 19 October the Builder's first release waited 1.6 to 2.6 hours, with no
  // practice task released meanwhile.
  const writing = context.examining;
  if (writing != null) {
    if (move === "examine") return text(`Examiner session ${writing.session} is still writing.`);
    if (move !== RELEASE) await bench.within(() => writing.done);
  }
  if (context.failed !== null) return text("The campaign has been stopped by the host.");
  const { turn, decided } = actionTurn(context);
  if (decided.move === "end") {
    return halt(`The campaign is at its ${decided.ending} gate; no action may start.`);
  }
  // A word is the operator's and reaches no seat: the Builder is told what the campaign waits for.
  if (move !== "examine" && pendingWords(turn.events).some(({ word }) => word === "tasks")) {
    return text("Other tasks are to be written before another action: examine does that.");
  }
  const named = toolOf(decided) === move;
  // Where the log stood as the move began: an action that threw with nothing written after its
  // move never started, which is a refusal the Builder may answer with another action.
  let begun: number | null = null;
  const begin = (made: JsonObject) => {
    begun = read(context.log).length + 1;
    context.used += 1;
    append(context.log, MOVED, {
      move: move === RELEASE ? "prepare" : move,
      code: named ? decided.code : ASKED,
      why: named ? decided.why : `the Builder asked for it, where the table named ${toolOf(decided)}`,
      ...made,
    });
  };
  const { host } = context.seats;
  // The conversation's deadline clock stops while the action runs, a wait for the provider included.
  return await bench.within(async () => {
    try {
      const outcome = await run(turn, decided, begin, signal);
      if ("refused" in outcome) return text(outcome.refused);
      // A session of the action's that the provider's limit ended is waited out here, as after
      // each move of a campaign before the Builder made them.
      await waitCrashed(context.log, host);
      return text(outcome.said);
    } catch (error) {
      // Asked before the throw is read as a refusal, as the host's loop asks it: a limit that
      // ended a session before its first event is no refusal, and asked for again at once the
      // action would meet the same limit.
      if (await waitOut(context.log, error, host?.sleep)) {
        return text(
          `The provider's limit ended the ${label} action, and the host has waited it out: call ${move} again.`,
        );
      }
      // The admission's own words, which name no task: until 14 October a fixed sentence stood
      // in for them, and the Builder could not tell a want of tasks from a stop. Any other
      // refusal may name a held-out task, and keeps the fixed sentence.
      if (begun === null || read(context.log).length <= begun) {
        return text(
          error instanceof Refused
            ? `The host refused the ${label} action: ${error.message}`
            : `The host refused the ${label} action; choose another action.`,
        );
      }
      context.failed = { move: move === RELEASE ? "prepare" : move, why: errorMessage(error) };
      bench.halt.abort();
      return text(`The host could not complete the ${label} action. The campaign has been stopped.`);
    }
  });
}

const examineAction =
  (context: CampaignContext, bench: Bench): ActionRun =>
  async (turn, decided, begin) => {
    const { seats } = context;
    if (seats.seated !== solved && seats.examine === undefined) {
      return { refused: "This campaign has no Examiner seat, so the host cannot write more tasks." };
    }
    const session = nextId(turn.events, "x");
    const { args, tasks, roomSolves } = examinerRun(turn, session, seats.examine, "write");
    begin({
      session,
      ...keyIfDefined(
        "answers",
        decided.move === "examine" && decided.answers ? [...decided.answers] : undefined,
      ),
    });
    // The action returns once the session is on record: a throw before that is the action's.
    const { promise: onRecord, resolve } = Promise.withResolvers<void>();
    const sitting = seats.examine ?? examine;
    // As task admission holds out each task the host releases what the epoch is owed, one release at a time,
    // and each release settles `next`, on which `wait` returns. A throw is the environment's ending.
    let releasing = Promise.resolve();
    let next = Promise.withResolvers<void>();
    const held = () => {
      releasing = releasing
        .then(async () => {
          if (!(await releaseOwed(context, bench, session))) return;
          next.resolve();
          next = Promise.withResolvers<void>();
        })
        .catch((error: unknown) => {
          context.failed = { move: "prepare", why: errorMessage(error) };
          bench.halt.abort();
        });
    };
    const work = examineCommand(
      args,
      (request, wall) => sitting({ ...request, opened: resolve, held }, wall),
      roomSolves,
      // The host's halt, on its bounds or an ending, and the run's kill stop it; the
      // conversation's own end is neither.
      AbortSignal.any([bench.halt.signal, ...(bench.request.kill === undefined ? [] : [bench.request.kill])]),
    ).then(() => refreshCampaign(context, bench));
    await Promise.race([work, onRecord]);
    // The session writes beside the conversation, and on past its end, which waits for it
    // (`closing`): a Builder's finish or its deadline does not stop it, while the host's halt and the
    // run's kill do, and it then ends on record as killed. A limit it met is waited out, and a
    // throw after it began is the environment's ending, as an action's is (`actionTool`).
    const done = work
      .then(() => waitCrashed(context.log, context.seats.host))
      .then(() => releasing)
      .then(() => releaseOwed(context, bench))
      .catch(async (error: unknown) => {
        if (await waitOut(context.log, error, context.seats.host?.sleep)) return;
        context.failed = { move: "examine", why: errorMessage(error) };
        bench.halt.abort();
      })
      .then(() => {
        context.examining = null;
      });
    context.examining = { session, done, released: () => next.promise };
    return {
      said: `Examiner session ${session} is writing ${tasks === undefined ? "tasks" : plural(Number(tasks), "task")} beside this conversation: edit, release practice and practise meanwhile. As it holds tasks the host releases the practice the epoch is owed. A comparison or a promotion waits for it to end, wait returns when it ends or the host releases practice, and campaign_status says how many it has held out.`,
    };
  };

const releaseTool = (context: CampaignContext, bench: Bench): SeatTool =>
  actionTool(context, bench, RELEASE, async (turn, decided, begin) => {
    // Where the table names no release, the practice named is brought up for this epoch alone, as
    // far as the epoch's room for practice goes (`practiceOwed`).
    const before = taskSets(read(context.log)).released.length;
    const practice =
      (decided.move === "prepare" ? decided.practice : undefined) ?? before + owedOf(context, turn);
    const released = await releaseTo(context, bench, practice);
    // A release that took nothing is no move (AGENTS.md, section 4): until 20 October it was
    // recorded and counted, and a conversation of such calls never read as idle.
    if (released === before) {
      return { refused: `No practice task can be released now: ${String(released)} tasks available.` };
    }
    begin({});
    return { said: `Practice release completed: ${String(released)} tasks available.` };
  });

/** The practice the campaign names that its epoch is still owed (`practiceOwed`). */
const owedOf = ({ values }: CampaignContext, { events, plan }: Turn): number =>
  practiceOwed(events, Number(values.practice ?? PRACTICE), plan.wanted.level);

/** Brings the released tasks up to `practice` through the release command, refreshes the
 *  Builder's workspace, and returns how many are released. */
async function releaseTo(context: CampaignContext, bench: Bench, practice: number): Promise<number> {
  const result = await prepareCommand([
    ...packOf(context.values),
    "--practice",
    String(practice),
    // The campaign's terms, so what it prints of a comparison's size is the campaign's.
    ...(["solves", "level"] as const).flatMap((name) => flag(name, context.values[name])),
  ]);
  if (result !== 0) throw new Error("the practice release was refused");
  await refreshCampaign(context, bench);
  return taskSets(read(context.log)).released.length;
}

/**
 * The practice an epoch is owed, released by the host as an Examiner session beside the
 * conversation ends, as the command releases it before a Builder session between conversations
 * (`toPractise`, `SETUP`). One conversation spans epochs, and until 21 October only the Builder's
 * own `release_practice` released practice inside one: in seven buffer campaigns, 14 of 23
 * Examiner sessions after a promotion ended with the epoch still owed 1 to 6 practice tasks, and
 * one Opus campaign practised on 2 tasks over three epochs. It is the host's own move, on record
 * with the hold's code, and `--moves` bounds it as any move.
 *
 * It is also made as task admission holds out each task: until 25 October it waited for the
 * session's end, so a Builder in `wait` could not practise on tasks released only then. The
 * comparison's target adds no bound: after a promotion the default ask fills that target alone,
 * and a bound on it delays practice until the unbounded release at the session's end. The sweep
 * at the level still stays held (`practiceOwed`). Returns whether it released a task.
 */
async function releaseOwed(context: CampaignContext, bench: Bench, session?: string): Promise<boolean> {
  if (context.failed !== null || bench.halt.signal.aborted || context.used >= context.maxMoves) return false;
  const { turn } = actionTurn(context);
  const before = taskSets(turn.events).released.length;
  const owed = owedOf(context, turn);
  if (owed <= 0 || (await releaseTo(context, bench, before + owed)) === before) return false;
  context.used += 1;
  append(context.log, MOVED, {
    move: "prepare",
    code: "practice",
    why: `${String(epochReleased(turn.events).epoch)} practice tasks were released since the reference harness was last promoted, and ${session === undefined ? "an Examiner session beside the conversation ended" : `Examiner session ${session} beside the conversation held a task out`}: the host releases the epoch's practice`,
  });
  return true;
}

/**
 * The two harnesses a `compare` reads, and what the Builder is told of the choice. A comparison
 * that began goes on; until 19 October so did the repeat of a reading under the trigger, of the
 * harness that reading froze. Otherwise the working copy is frozen and compared, unless it is
 * the reference harness, where the table's own comparison is made (the starter comparison, or the latest
 * harness on tasks written since), or one a comparison has read with nothing changed since, which
 * would be a second draw of one pair that no row of the table names.
 */
async function comparedOf(
  context: CampaignContext,
  bench: Bench,
  { events }: Turn,
  decided: Decided,
): Promise<{ readonly move: Compare; readonly froze?: string; readonly note: string } | { refused: string }> {
  const latest = latestBuilt(events);
  if (decided.move === "compare" && decided.id !== undefined) return { move: decided, note: "" };
  let working: string;
  try {
    working = (await snapshot(bench)).harness.digest;
  } catch {
    return { refused: "harness/ does not open, so it cannot be compared: check_harness says why." };
  }
  const reference = (await keptAs(context.campaign, "--reference", PROMOTED)).digest;
  if (working === reference) {
    return decided.move === "compare"
      ? {
          move: decided,
          note: `harness/ is the reference harness, so the ${decided.fresh} harness was read against it.`,
        }
      : { refused: "harness/ is the reference harness: there is nothing to compare until it changes." };
  }
  // The working copy that is the latest harness, where the table names the latest, is the table's
  // own comparison and keeps its code: until 28 October it was logged `asked`, and three of the
  // seventeen `asked` comparisons of buffer-fresh-opus-v072 and esp32-fresh-opus-terra read the
  // very pair the table named.
  if (decided.move === "compare" && decided.fresh === "latest" && working === latest) {
    return { move: decided, note: "" };
  }
  if (readAgainst(events, working, reference) && decided.move !== "compare") {
    return {
      refused: `harness/ is harness ${short(working)}, which a comparison has read against the reference, and nothing in it has changed since: there is nothing new to compare.`,
    };
  }
  // Another comparison than the table's is the Builder's own, on record as `asked` with what the
  // table named: until 19 October it kept the table's code and reason, and r3's g-3 and g-6 read as
  // starter comparisons while each measured a changed harness snapshot.
  const table = decided.move === "compare" ? `a comparison of the ${decided.fresh} harness` : toolOf(decided);
  return {
    move: {
      move: "compare",
      code: ASKED,
      fresh: working,
      reference: "promoted",
      why: `the Builder asked for it, where the table named ${table}`,
    },
    note: "",
    ...keyIfDefined("froze", working === latest ? undefined : working),
  };
}

/** Whether a comparison has read harness `fresh` against harness `reference`: what `compare`
 *  refuses on, and what a led Builder's `finish` is told of where none has. */
const readAgainst = (events: readonly LogEvent[], fresh: string, reference: string): boolean =>
  comparisonsOf(events).some((each) => each.fresh === fresh && each.old === reference);

const compareTool = (context: CampaignContext, bench: Bench): SeatTool =>
  actionTool(context, bench, "compare", async (turn, decided, begin, signal) => {
    const named = await comparedOf(context, bench, turn, decided);
    if ("refused" in named) return named;
    const { session, args } = comparisonOf(named.move, turn);
    // The working copy as it is frozen for this comparison, kept inside the live conversation: a
    // conversation cut later leaves it the latest harness all the same (`latestBuilt`).
    if (named.froze !== undefined) {
      append(context.log, "build.checkpoint", { session: bench.request.id, harness: named.froze });
    }
    // The comparison's own flags beside the pack's, so the log says what command the move ran
    // (11 October: the trigger had been left off, and no record could show it). The move is on
    // record once the comparison is admitted: until 14 October it was written first, and a
    // comparison the admission refused left a move that never began.
    await checkpointCommand(args, context.held, signal, () =>
      begin({
        session,
        args: args.slice(packOf(context.values).length),
        ...keysIf(named.move !== decided, () => ({ code: named.move.code, why: named.move.why })),
      }),
    );
    const events = read(context.log);
    const step = campaignOf(events).steps.findLast(
      (each) => each.step === "comparison" && each.id === session,
    );
    const tally = comparisonsTold(step === undefined ? [] : [step])[0] ?? "The comparison has no tally yet.";
    const scored = events.findLast(
      ({ kind, data }) => kind === "comparison.reported" && data.session === session,
    )?.data.versions;
    const size = Array.isArray(scored) ? [sizeLine(turn, scored.length)] : [];
    const promoted = await promoteOwed(context, bench);
    return {
      said: [tally, ...size, ...(named.note === "" ? [] : [named.note]), ...promoted].join("\n"),
    };
  });

/**
 * The promotion the rule names, made by the host as the comparison that clears it reports, as the
 * command makes it between conversations (`SETUP`, `harness-builder.ts`). Until 14 October a led
 * campaign promoted only where its Builder called `promote`: buffer-149's g-2 cleared the rule, and
 * the promotion waited on the Builder's next call. It is the host's own move, on record with the
 * table's code; `--hitl` leaves it to the operator, and `--moves` bounds it as any move.
 */
async function promoteOwed(context: CampaignContext, bench: Bench): Promise<string[]> {
  const { decided } = actionTurn(context);
  if (decided.move !== "promote" || context.opening.attended || context.used >= context.maxMoves) return [];
  context.used += 1;
  append(context.log, MOVED, {
    move: "promote",
    code: decided.code,
    why: decided.why,
    harness: decided.harness,
  });
  await promoteCommand(["--name", context.values.name ?? "", "--harness", decided.harness, "--yes"]);
  await refreshCampaign(context, bench);
  return [
    `Harness ${short(decided.harness)} read a step against the reference, and the host has made it the campaign's reference.`,
  ];
}

const promoteTool = (context: CampaignContext, bench: Bench): SeatTool =>
  actionTool(context, bench, "promote", async (turn, decided, begin) => {
    // The harness the rule names, which is not always the last one frozen (`stepped`, `decide.ts`).
    const candidate = decided.move === "promote" ? decided.harness : latestBuilt(turn.events);
    const name = context.values.name ?? "";
    if (candidate === null) {
      return { refused: "No comparison has frozen a harness, so there is none to promote." };
    }
    if (context.opening.attended) {
      if (decided.move === "promote") {
        console.log(
          `under --hitl a promotion is the operator's word: bun tools/d2/promote.ts --name ${name} --harness ${candidate} --yes, or run this command with --no-hitl`,
        );
      }
      return { refused: "Promotion awaits the operator under --hitl." };
    }
    // The rule's own reason, before anything is on record: until 14 October a fixed sentence.
    const why = unpromoted(turn.events, turn.plan, candidate);
    if (why !== null) return { refused: `Nothing was promoted: ${why}.` };
    const before = read(context.log).length;
    await promoteCommand(["--name", name, "--harness", candidate, "--yes"]);
    const promoted = read(context.log)
      .slice(before)
      .some(({ kind }) => kind === "harness.promoted");
    if (!promoted) {
      return {
        refused:
          "Nothing was promoted: no harness other than the reference has a comparison that read a step against it.",
      };
    }
    begin({ harness: candidate });
    await refreshCampaign(context, bench);
    return { said: `Harness ${short(candidate)} is now the campaign's reference.` };
  });

/** What a comparison of `scored` tasks can read, as the operator reads it before one (`sizeLines`):
 *  until 13 October the Builder was not told, and a led Builder bought one of six scored tasks,
 *  which reads a step at 6-0 at the least. */
function sizeLine({ events, plan }: Turn, scored = Math.min(plan.wanted.target, supplyOf(events).held)) {
  return `Comparison size: ${sizeLines(scored, plan.wanted)[0] ?? ""}.`;
}

/** The campaign's last Examiner session: writing, stopped with the run that began it, or how it
 *  ended, and what it held out. Until 14 October a conversation read only the sessions it began,
 *  so one opened after a session crashed was not told of it. */
function examinedLines(events: readonly LogEvent[], writing: string | undefined): string[] {
  const begun = events.findLast(
    ({ kind, data }) => kind === MOVED && data.move === "examine" && isString(data.session),
  )?.data.session;
  if (!isString(begun)) return [];
  const ended = events.findLast(({ kind, data }) => kind === "exam.finished" && data.session === begun)?.data;
  if (begun === writing || ended === undefined) {
    const started = events.findIndex(({ kind, data }) => kind === "exam.started" && data.session === begun);
    const held = plural(started === -1 ? 0 : heldAfter(events, started), "task");
    return [
      begun === writing
        ? `Examiner session ${begun} is writing beside this conversation, ${minutesFrom(events[started]?.at)}, and has held out ${held} so far; a comparison or a promotion waits for it.`
        : `Examiner session ${begun} stopped with the run of the campaign that began it, and held out ${held}.`,
    ];
  }
  const said = EXAMINED.get(isString(ended.ended) ? ended.ended : "") ?? "ended at its limits";
  return [
    `Examiner session ${begun} ${said}, and held out ${plural(Array.isArray(ended.held) ? ended.held.length : 0, "task")}.`,
  ];
}

/** Whole minutes from `from` to `to`, or to now, as a status says them. */
/** Where the log last holds the start or end of a solve of comparison `id`, or the comparison's
 *  start where none has. */
function lastSolveOf(events: readonly LogEvent[], id: string): number {
  const own = solvesIn(events).filter(({ start }) => start.comparison === id);
  const at = Math.max(-1, ...own.map(({ started, finished }) => finished ?? started));
  return at === -1
    ? events.findIndex(({ kind, data }) => kind === "comparison.started" && data.session === id)
    : at;
}

function minutesFrom(from: string | undefined, to = new Date().toISOString()): string {
  const minutes =
    from === undefined ? 0 : Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  return plural(minutes, "minute");
}

/**
 * What the host has spent and counted, as a led Builder reads it where it acts or asks: the last
 * comparison's minutes and dollars, the moves without a gain against the
 * improvement patience, and the sessions the provider failed in a row. Until 14 October a Builder bought a
 * comparison of hours knowing of the last one its tally alone. None of it names a task (rule 3).
 */
function spentLines({ events }: Turn): string[] {
  const last = comparisonsOf(events).at(-1);
  const { sinceStep } = stopRule(events);
  const { count } = crashedRun(events);
  return [
    ...(last === undefined
      ? []
      : [
          // One not reported is read to its last solve's event, not to now: a led Builder sees one only
          // after a kill, and the time since would count the downtime (14 October).
          `Comparison ${last.id} ${last.reported === null ? "has run" : "took"} ${minutesFrom(events[last.at]?.at, events[last.reported ?? lastSolveOf(events, last.id)]?.at)} and billed ${billedParts(events, last.id).comparison.toFixed(2)} dollars.`,
        ]),
    `Moves without a gain since the last step: ${String(sinceStep)} of the patience's ${String(patienceOf(events))}.`,
    ...(count === 0
      ? []
      : [
          `Sessions the provider failed in a row: ${String(count)} of the ${String(CRASHES)} that end the campaign.`,
        ]),
  ];
}

/** What the action the table names would do, as the status says it under the suggestion: for a
 *  comparison or more tasks, what a comparison of the tasks held can read. */
function namedLine(decided: Decided, size: string): string {
  if (decided.move === "build") return "Edit and practise the harness.";
  if (decided.move === "promote") return `promote makes harness ${short(decided.harness)} the reference.`;
  if (decided.move === "examine") return size;
  if (decided.move !== "compare") return `Choose the ${toolOf(decided)} action.`;
  if (decided.id !== undefined) {
    return `compare goes on with comparison ${decided.id}, which began and has not reported.`;
  }
  return decided.fresh === "starter"
    ? "While harness/ is the reference harness, compare reads the starter against it on the tasks held out since."
    : size;
}

/** The campaign's turn as `decide` reads it, halting the Builder's conversation where the campaign
 *  has ended on a bound or spent its moves. */
function halted(context: CampaignContext, bench: Bench) {
  const reading = actionTurn(context);
  const { decided } = reading;
  if (context.used >= context.maxMoves || decided.move === "end") bench.halt.abort();
  return reading;
}

/**
 * What the Builder is told of its campaign, where it can have moved (a campaign tool's result):
 * what was written and released, what is left of the total, the last tally, and the table's
 * action. Reading it is also where the host looks at its bounds: the run's moves spent, or an
 * ending the table names, stops the conversation (`Bench.halt`).
 */
function campaignStatus(context: CampaignContext, bench: Bench): string {
  const { turn, decided } = halted(context, bench);
  // The counts are of what was written and released, which no outcome of a held-out task moves:
  // the scorable, exhausted and waiting counts follow which tasks were answered (rule 3).
  const sets = taskSets(turn.events);
  const tallies = comparisonsTold(campaignOf(turn.events).steps);
  const writing = context.examining?.session;
  // The conversation under way ends the run `idleOf` counts until it makes a move.
  const idle = idleOf(turn.events) - 1;
  return [
    `Campaign facts: ${plural(sets.held.length, "held-out task")}, ${plural(sets.released.length, "practice task")}.`,
    ...(turn.plan.left == null
      ? []
      : [
          `Campaign budget: ${turn.plan.left.dollars.toFixed(2)} dollars left; ${String(turn.plan.left.reserve)} reserved for a solve.`,
        ]),
    // The last tally stands here; `read_opening` holds every one.
    tallies.length === 0
      ? "No comparison has a tally yet."
      : `${plural(tallies.length, "comparison")} with a tally; the last:\n${tallies.at(-1) ?? ""}`,
    ...examinedLines(turn.events, writing),
    ...spentLines(turn),
    ...(idle < 1
      ? []
      : [
          idle === 1
            ? "The conversation before this one made no campaign move."
            : `The ${String(idle)} conversations before this one made no campaign move.`,
        ]),
    ...(writing === undefined
      ? [`Suggested action: ${toolOf(decided)}.`, namedLine(decided, sizeLine(turn))]
      : []),
  ].join("\n");
}

/**
 * The campaign's tools and advice for one Builder conversation (`BuildRequest.campaign`). Where
 * `opens`, the host starts the Examiner session the table names as the conversation opens, as the
 * Builder's `examine` would: until 14 October a led campaign that opened short of tasks waited for
 * its Builder to ask, and until 16 October every later session did (`hostOwed`,
 * `tools/d2/harness-builder.ts`).
 */
export function campaignTools(
  context: CampaignContext,
  opens = false,
): NonNullable<BuildRequest["campaign"]> {
  return (bench) => {
    const examineRun = examineAction(context, bench);
    const examining = actionTool(context, bench, "examine", examineRun);
    // An action that promoted is followed by the Examiner session the table then names, started by
    // the host as at a conversation's opening: on 19 October r1's Builder compared six minutes after
    // its promotion where the table named one, on 1 task of 25 informative for its new reference.
    const promoting = (made: SeatTool): SeatTool => ({
      ...made,
      execute: async (args, api, execution) => {
        const before = lastPromoted(read(context.log));
        const result = await made.execute(args, api, execution);
        if (lastPromoted(read(context.log)) === before || context.examining != null) return result;
        if (toolOf(actionTurn(context).decided) !== "examine") return result;
        const started = await examining.execute({}, api, execution);
        return { ...result, output: [...(result.output ?? []), ...(started.output ?? [])] };
      },
    });
    return {
      start: async () =>
        opens
          ? ((await runAction(context, bench, "examine", examineRun, undefined)).output ?? [])
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n")
          : "",
      tools: [
        ...[
          examining,
          ...[releaseTool, compareTool, promoteTool].map((made) => promoting(made(context, bench))),
        ].map((made) => endingWith(made, () => campaignStatus(context, bench))),
        // On the host's time, as a comparison's wait for the same session is.
        waitTool(
          "Wait for the Examiner session writing beside this conversation to end, or for the host to release practice tasks while it writes, on the host's time, and return the campaign's facts; at once where none is writing.",
          async () => {
            const writing = context.examining;
            if (writing == null) return campaignStatus(context, bench);
            await bench.within(() => Promise.race([writing.done, writing.released()]));
            return campaignStatus(context, bench);
          },
        ),
        tool({
          name: "campaign_status",
          description: "Read campaign counts and current host advice.",
          parameters: Type.Object({}),
          executionMode: "sequential",
          execute: async () => text(campaignStatus(context, bench)),
        }),
      ],
      hook: () => campaignStatus(context, bench),
      halts: () => {
        halted(context, bench);
      },
      closing: async () => {
        await context.examining?.done;
      },
      unmeasured: async (digest) => {
        const reference = (await keptAs(context.campaign, "--reference", PROMOTED)).digest;
        if (digest === reference) {
          // On 14 October buffer-149's Builder finished on the harness just promoted, a third of
          // its total spent, and the climb stopped at one step while the table named a move: it is
          // told that move, which the next conversation takes up. One that never left the starter
          // is told nothing: no run showed that finish.
          const next = toolOf(actionTurn(context).decided);
          if (next === "end" || lastPromoted(read(context.log)) !== digest) return null;
          return next === "build"
            ? "harness/ is the harness last promoted, and no step past it has been tried."
            : `harness/ is the harness last promoted, and the table names ${next} as the next move.`;
        }
        if (readAgainst(read(context.log), digest, reference)) return null;
        const writing = context.examining?.session;
        return `No comparison has read harness/ as it stands against the reference, and finish leaves it unmeasured.${writing === undefined ? "" : ` Examiner session ${writing} is still writing tasks beside this conversation, and compare waits for it to end.`}`;
      },
    };
  };
}

/**
 * The campaign tools of a live Builder conversation (`examine`, `compare`, `campaign_status`,
 * `wait`), and the host's own practice release and promotion.
 */
import { Type } from "typebox";
import { type AgentTool, textsOf } from "#src/agent/session.ts";
import { comparisonFloor, Refused, stopRule } from "#src/campaign/admission.ts";
import { CRASHES_IN_A_ROW, decide, practiceDue, supplyRun } from "#src/campaign/decide.ts";
import { comparisonsOf, crashedRun } from "#src/campaign/ground.ts";
import { campaignOf } from "#src/campaign/handover.ts";
import { type Decided, short } from "#src/campaign/move.ts";
import type { Opening } from "#src/campaign/opening.ts";
import { frontierOverlap, OVERLAP_LIMIT } from "#src/campaign/round.ts";
import { formatComparisonHistory } from "#src/builder/past.ts";
import { seedSavedHarnesses, snapshot } from "#src/builder/kept.ts";
import { type BuildRequest, layPractice } from "#src/builder/session.ts";
import { type Bench, endingWith, waitTool } from "#src/builder/tools.ts";
import { pendingWords } from "#src/campaign/word.ts";
import { conversing, type Examined, examine } from "#src/examiner/session.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { append, CALL_KINDS, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { latestBuilt, patienceOf, promoted as lastPromoted } from "#src/kernel/reports.ts";
import { billedParts } from "#src/kernel/meter.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { solvesIn } from "#src/kernel/solves.ts";
import { heldAtGate, taskSets } from "#src/kernel/task.ts";
import { isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { plural } from "#src/meta/text.ts";
import { text, tool } from "#src/tools/answer.ts";
import { publicView } from "#src/solver/prompt.ts";
import { waitOut } from "#src/solver/run.ts";
import { examineCommand } from "../d1b/examine.ts";
import { openHarness } from "#src/harness/open.ts";
import { keptAs, openCampaign, PROMOTED, packNamed } from "./campaign.ts";
import {
  comparisonOf,
  examinerRun,
  idleOf,
  MOVED,
  moved,
  nextId,
  opened,
  packOf,
  prepared,
  promoteMade,
  revertMade,
  type Seats,
  type Turn,
  turnOf,
  type Values,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { waitCrashed, waitPaused } from "./host.ts";
import { type Campaign, type Seated, solved } from "./round.ts";

type ActionMove = "examine" | "compare";

type Compare = Extract<Decided, { move: "compare" }>;

type Outcome = { readonly said: string } | { readonly refused: string };

type ActionRun = (
  turn: Turn,
  decided: Decided,
  begin: (named: JsonObject) => void,
  signal: AbortSignal | undefined,
  unlock: () => void,
) => Promise<Outcome>;

export interface CampaignContext {
  readonly log: string;
  readonly values: Values;
  opening: Opening;
  readonly seats: Seats;
  readonly held: Seated;
  campaign: Campaign;
  readonly paid: "paid" | "scripted";
  readonly maxMoves: number;
  used: number;
  readonly began?: number;
  failed: { readonly move: string; readonly why: string } | null;
  examining?: { readonly session: string; readonly done: Promise<void> } | null;
  releasing?: Promise<boolean>;
  examiner?: ReturnType<typeof conversing>;
}

const LED = "led";
const CHOSE = "the Builder's own move in its campaign conversation";
const EXAMINED = new Map(
  Object.entries({
    stands: "ended whole",
    finished: "ended whole",
    supplied: "ended whole",
    crashed: "crashed",
    killed: "was stopped",
    stopped: "was stopped",
    wall: "ended at its limits",
    turns: "ended at its limits",
  } satisfies Record<Examined["ended"], string>),
);

export const awaitsOperator = (name: string, harness: string): string =>
  `under --hitl a promotion is the operator's word: bun tools/d2/promote.ts --name ${name} --harness ${harness} --yes, or run this command with --no-hitl`;

function refreshPractice(bench: Bench, campaign: Campaign): void {
  const packages = campaign.packages();
  const tasks = taskSets(read(campaign.log, TRACE_KINDS)).released.flatMap((version) => {
    const task = packages.get(version);
    return task === undefined ? [] : [{ version, task: publicView(task) }];
  });
  bench.tasks = tasks;
  layPractice(bench.home, tasks);
}

async function refreshCampaign(context: CampaignContext, bench: Bench): Promise<void> {
  const campaign = await openCampaign(packNamed(context.values));
  context.campaign = campaign;
  refreshPractice(bench, campaign);
  const { dir } = await keptAs(campaign, "--reference", PROMOTED);
  bench.reference = { dir, harness: await openHarness(dir) };
  seedSavedHarnesses(bench.home, bench.request.states, read(campaign.log, TRACE_KINDS), bench.parent);
}

function actionTurn(context: CampaignContext) {
  let turn = turnOf(context);
  const words = pendingWords(turn.events).filter(({ word }) => word === "budget");
  if (words.length > 0) {
    context.opening = opened(context.log, context.values, context.paid, words);
    turn = turnOf(context);
  }
  return { turn, decided: decide(turn.events, turn.plan) };
}

/**
 * A lack of room ends the campaign before anything runs, else a Builder could start another empty
 * Examiner session past its supply patience.
 */
function actionTool(context: CampaignContext, bench: Bench, move: ActionMove, run: ActionRun): AgentTool {
  return tool({
    name: move,
    description: {
      examine:
        "Ask a separate Examiner to write tasks under the fixed exam. It returns at once and the Examiner writes beside you; the campaign's facts say how many of its tasks the gate has admitted. A comparison is won on tasks the reference fails in some solve, or where the objective tells two valid answers apart.",
      compare:
        "Freeze harness/ and compare it with the current reference on fresh held-out solves, also while an Examiner session writes: tasks it holds out later join the next comparison. Where a comparison began and has not reported, it goes on under its original terms. Where the host owes the starter comparison that follows a promotion, this call runs that instead and harness/ is compared at the next one. A comparison that reads a step against the reference promotes the harness it froze. After a promotion, it first waits for the Examiner session writing for the new reference to end.",
    }[move],
    parameters: Type.Object({}),
    execute: async (_args, _api, execution) => runAction(context, bench, move, run, execution.abortSignal),
  });
}

const promotedSince = (events: readonly LogEvent[]) =>
  events.findLastIndex(({ kind }) => kind === "harness.promoted") >
  events.findLastIndex(({ kind }) => kind === "comparison.started");

async function holdWhilePaused(
  context: CampaignContext,
  bench: Bench,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  await waitPaused(context.log, context.began ?? 0, context.campaign.limits.wallSeconds, {
    host: context.seats.host,
    signal,
    within: (work) => bench.within(work),
  });
  return signal?.aborted === true;
}

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
  const spent = "The campaign move limit has been reached; the host will stop this conversation.";
  if (context.used >= context.maxMoves) return halt(spent);
  if (signal?.aborted === true) return text("The campaign has been stopped by the host.");
  const writing = context.examining;
  if (move === "examine" && writing != null) {
    return text(`Examiner session ${writing.session} is still writing.`);
  }
  if (move === "compare" && writing != null && promotedSince(read(context.log, TRACE_KINDS))) {
    await bench.within(() => writing.done);
  }
  // A comparison's read, freeze and run wait behind any in-flight practice release and hold later
  // releases until it ends, so `actionTurn`, `begin` and `comparedOf` read the post-release log and no
  // release takes a task between checkpoint, draw and start.
  let unlock = () => {};
  if (move === "compare") {
    const done = Promise.withResolvers<boolean>();
    const previous = context.releasing;
    context.releasing = done.promise;
    unlock = () => done.resolve(false);
    if (previous !== undefined) await bench.within(() => previous);
  }
  try {
    if (context.used >= context.maxMoves) return halt(spent);
    if (context.failed !== null) return text("The campaign has been stopped by the host.");
    if (await holdWhilePaused(context, bench, signal)) {
      return text("The campaign has been stopped by the host.");
    }
    const { host } = context.seats;
    const { turn, decided } = actionTurn(context);
    if (decided.move === "end") {
      return halt(`The campaign is at its ${decided.ending} gate; no action may start.`);
    }
    if (move !== "examine" && pendingWords(turn.events).some(({ word }) => word === "tasks")) {
      return text("Other tasks are to be written before another action: examine does that.");
    }
    const named = decided.move === move;
    // An action that threw with nothing written after its move never started: a refusal the Builder may
    // answer with another action.
    let begun: number | null = null;
    const begin = (made: JsonObject) => {
      begun = read(context.log).length + 1;
      context.used += 1;
      moved(context.log, { move, code: named ? decided.code : LED, why: named ? decided.why : CHOSE }, made);
    };
    return await bench.within(async () => {
      try {
        const outcome = await run(turn, decided, begin, signal, unlock);
        if ("refused" in outcome) return text(outcome.refused);
        await waitCrashed(context.log, host);
        return text(outcome.said);
      } catch (error) {
        // Asked before the throw is read as a refusal: a limit that ended a session before its first
        // event is no refusal, and asked again at once the action would meet the same limit.
        if (await waitOut(context.log, error, host?.sleep)) {
          return text(
            `The provider's limit ended the ${label} action, and the host has waited it out: call ${move} again.`,
          );
        }
        // The admission's own words name no task, so the Builder can tell a want of tasks from a stop;
        // any other refusal may name a held-out task and keeps the fixed sentence.
        if (begun === null || read(context.log).length <= begun) {
          return text(
            error instanceof Refused
              ? `The host refused the ${label} action: ${error.message}`
              : `The host refused the ${label} action; choose another action.`,
          );
        }
        context.failed = { move, why: errorMessage(error) };
        bench.halt.abort();
        return text(`The host could not complete the ${label} action. The campaign has been stopped.`);
      }
    });
  } finally {
    unlock();
  }
}

const examineAction =
  (context: CampaignContext, bench: Bench): ActionRun =>
  async (turn, decided, begin) => {
    const { seats } = context;
    if (seats.seated !== solved && seats.examine === undefined) {
      return { refused: "This campaign has no Examiner seat, so the host cannot write more tasks." };
    }
    const session = nextId(turn.events, "x");
    const { args, tasks } = examinerRun(turn, session, "write");
    begin({
      session,
      ...keyIfDefined(
        "answers",
        decided.move === "examine" && decided.answers ? [...decided.answers] : undefined,
      ),
    });
    const { promise: onRecord, resolve } = Promise.withResolvers<void>();
    const examiner = context.examiner ?? conversing(seats.examine ?? examine);
    context.examiner = examiner;
    const work = examineCommand(
      args,
      (request, wall) => examiner.session({ ...request, opened: resolve }, wall),
      AbortSignal.any([bench.halt.signal, ...(bench.request.kill === undefined ? [] : [bench.request.kill])]),
    ).then(() => refreshCampaign(context, bench));
    await Promise.race([work, onRecord]);
    const done = work
      .then(() => waitCrashed(context.log, context.seats.host))
      .then(() =>
        releasePendingPractice(context, `Examiner session ${session} beside the conversation ended`, bench),
      )
      .catch(async (error: unknown) => {
        if (await waitOut(context.log, error, context.seats.host?.sleep)) return;
        context.failed = { move: "examine", why: errorMessage(error) };
        bench.halt.abort();
      })
      .then(() => {
        context.examining = null;
      });
    context.examining = { session, done };
    return {
      said: `Examiner session ${session} is writing tasks beside this conversation${tasks === undefined ? "" : `, and stops once it holds ${plural(Number(tasks), "task")}`}${promotedSince(turn.events) ? "; a compare waits for this session to end" : ""}. Once it ends the host releases any practice owed since the last reading.`,
    };
  };

export function releasePendingPractice(
  context: CampaignContext,
  cause: string,
  bench?: Bench,
): Promise<boolean> {
  const release = Promise.resolve(context.releasing).then(() => releaseOnce(context, cause, bench));
  context.releasing = release.catch(() => false);
  return release;
}

async function releaseOnce(context: CampaignContext, cause: string, bench?: Bench): Promise<boolean> {
  if (context.failed !== null || bench?.halt.signal.aborted === true || context.used >= context.maxMoves) {
    return false;
  }
  const { turn, decided } = actionTurn(context);
  if (decided.move === "promote" || decided.move === "end") return false;
  const comparing = (events: readonly LogEvent[]) =>
    comparisonsOf(events).some(({ reported }) => reported === null);
  if (comparing(turn.events)) return false;
  const before = taskSets(turn.events).released.length;
  const due = practiceDue(turn.events, turn.plan.practice, turn.plan.wanted.level);
  if (due === null) return false;
  if ((await prepared(context, String(due.to), comparing)) !== 0) {
    throw new Error("the practice release was refused");
  }
  if (bench !== undefined) await refreshCampaign(context, bench);
  if (taskSets(read(context.log, TRACE_KINDS)).released.length === before) return false;
  context.used += 1;
  const why = `${due.said}, and ${cause}: the host releases the practice owed`;
  moved(context.log, { move: "prepare", code: "practice", why });
  return true;
}

async function comparedOf(
  context: CampaignContext,
  bench: Bench,
  { events, plan }: Turn,
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
  if (decided.move === "compare" && decided.fresh === "starter") {
    return {
      move: decided,
      note: "The table's comparison of the starter ran first: compare reads harness/ next.",
    };
  }
  if (decided.move === "compare" && decided.fresh === "latest" && working === latest) {
    return { move: decided, note: "" };
  }
  if (readAgainst(events, working, reference)) {
    return {
      refused: `harness/ is harness ${short(working)}, which a comparison has read against the reference, and nothing in it has changed since: there is nothing new to compare. Between equal harnesses one comparison reads a step as often as its level, and a harness changed in little draws that chance again.`,
    };
  }
  // Against comparison fishing on an unchanged pool, while the Examiner can still supply fresh tasks.
  const canExamine =
    (context.seats.seated === solved || context.seats.examine !== undefined) &&
    supplyRun(events, plan) < plan.patience;
  if (canExamine) {
    const repeat = frontierOverlap(
      events,
      plan.wanted.target,
      contractHash(context.campaign.contract),
      reference,
    );
    if (repeat !== null && repeat.ratio >= OVERLAP_LIMIT) {
      const nextStep =
        context.examining == null
          ? "Call examine to hold out fresh tasks before comparing another candidate."
          : `Examiner session ${context.examining.session} is already writing tasks; call wait before comparing another candidate.`;
      return {
        refused: `This comparison would draw ${String(repeat.overlap)} of ${String(repeat.total)} frontier tasks (${String(Math.round(repeat.ratio * 100))}%) already scored in comparison ${repeat.priorSession}. ${nextStep}`,
      };
    }
  }
  return {
    move: { move: "compare", code: LED, fresh: working, reference: "promoted", why: CHOSE },
    note: "",
    ...keyIfDefined("froze", working === latest ? undefined : working),
  };
}

const readAgainst = (events: readonly LogEvent[], fresh: string, reference: string): boolean =>
  comparisonsOf(events).some((each) => each.fresh === fresh && each.old === reference);

const compareTool = (context: CampaignContext, bench: Bench): AgentTool =>
  actionTool(context, bench, "compare", async (turn, decided, begin, signal, unlock) => {
    const named = await comparedOf(context, bench, turn, decided);
    if ("refused" in named) return named;
    const { note } = named;
    const built = comparisonOf(named.move, turn);
    const { session } = built;
    // Written before admission, so after a refusal the table names it as not yet compared.
    if (named.froze !== undefined) {
      append(context.log, "build.checkpoint", { session: bench.request.id, harness: named.froze });
    }
    await checkpointCommand(built.args, context.held, signal, () =>
      begin({
        session,
        args: built.args.slice(packOf(context.values).length),
        ...keysIf(named.move !== decided, () => ({ code: named.move.code, why: named.move.why })),
      }),
    );
    unlock();
    const events = read(context.log, CALL_KINDS);
    const step = campaignOf(events).steps.findLast(
      (each) => each.step === "comparison" && each.id === session,
    );
    const tallied = formatComparisonHistory(step === undefined ? [] : [step]).length > 0;
    const scored = events.findLast(
      ({ kind, data }) => kind === "comparison.reported" && data.session === session,
    )?.data.versions;
    const size = Array.isArray(scored)
      ? [`Comparison size: ${sizeLines(scored.length, turn.plan.wanted.level)[0] ?? ""}.`]
      : [];
    const promoted = await applyPendingPromotions(context, bench);
    if (promoted.length === 0) await releasePendingPractice(context, `comparison ${session} reported`, bench);
    return {
      said: [
        ...(tallied ? [] : ["The comparison has no tally yet."]),
        ...size,
        ...(note === "" ? [] : [note]),
        ...promoted,
      ].join("\n"),
    };
  });

/**
 * Made by the host as the clearing comparison reports, since Builders almost never call a `promote`
 * tool; `--hitl` leaves it to the operator.
 */
async function applyPendingPromotions(context: CampaignContext, bench: Bench): Promise<string[]> {
  const { decided } = actionTurn(context);
  if ((decided.move !== "promote" && decided.move !== "revert") || context.used >= context.maxMoves) {
    return [];
  }
  if (decided.move === "promote" && context.opening.attended) {
    console.log(awaitsOperator(context.values.name ?? "", decided.harness));
    return [];
  }
  // A session writing as the step reports aims at the old reference, so the reference change waits for
  // it.
  await context.examining?.done;
  const owed = actionTurn(context).decided;
  if ((owed.move !== "promote" && owed.move !== "revert") || context.used >= context.maxMoves) return [];
  context.used += 1;
  if (owed.move === "revert") {
    revertMade(context.log, owed);
    await refreshCampaign(context, bench);
    return [
      `The starter comparison did not confirm the promoted reference, so the host reverted the campaign's reference to ${short(owed.harness)}.`,
    ];
  }
  await promoteMade(context.log, context.values.name, owed);
  await refreshCampaign(context, bench);
  return [
    `Harness ${short(owed.harness)} read a step against the reference, and the host has made it the campaign's reference.`,
  ];
}

function examinedLines(events: readonly LogEvent[], writing: string | undefined): string[] {
  const begun = events.findLast(
    ({ kind, data }) => kind === MOVED && data.move === "examine" && isString(data.session),
  )?.data.session;
  if (!isString(begun)) return [];
  const ended = events.findLast(({ kind, data }) => kind === "exam.finished" && data.session === begun)?.data;
  if (begun === writing || ended === undefined) {
    const started = events.findIndex(({ kind, data }) => kind === "exam.started" && data.session === begun);
    const admitted = events.filter(
      ({ kind, data }, index) => index > started && kind === "task.gate" && heldAtGate(data.outcome),
    );
    const held = plural(started === -1 ? 0 : admitted.length, "task");
    return [
      begun === writing
        ? `Examiner session ${begun} is writing beside this conversation, ${minutesFrom(events[started]?.at)}, and has had ${held} admitted so far.`
        : `Examiner session ${begun} stopped with the run of the campaign that began it, and had ${held} admitted.`,
    ];
  }
  const said = EXAMINED.get(isString(ended.ended) ? ended.ended : "") ?? "ended at its limits";
  return [
    `Examiner session ${begun} ${said}, and had ${plural(Array.isArray(ended.held) ? ended.held.length : 0, "task")} admitted.`,
  ];
}

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

function spentLines({ events }: Turn): string[] {
  const last = comparisonsOf(events).at(-1);
  const { sinceStep } = stopRule(events);
  const { count } = crashedRun(events);
  return [
    ...(last === undefined
      ? []
      : [
          `Comparison ${last.id} ${last.reported === null ? "has run" : "took"} ${minutesFrom(events[last.at]?.at, events[last.reported ?? lastSolveOf(events, last.id)]?.at)} and billed ${billedParts(events, last.id).comparison.toFixed(2)} dollars.`,
        ]),
    `Moves without a gain since the last step: ${String(sinceStep)} of the patience's ${String(patienceOf(events))}. A move here is a changed harness compared with room to gain, or a conversation that leaves harness/ unchanged after a practice solve of its own failed.`,
    ...(count === 0
      ? []
      : [
          `Sessions the provider failed in a row: ${String(count)} of the ${String(CRASHES_IN_A_ROW)} that end the campaign.`,
        ]),
  ];
}

function halted(context: CampaignContext, bench: Bench) {
  const reading = actionTurn(context);
  const { decided } = reading;
  const waits = decided.move === "promote" && context.opening.attended;
  if (context.used >= context.maxMoves || decided.move === "end" || waits) bench.halt.abort();
  return reading;
}

function firstFacts({ practice, wanted }: Turn["plan"], held: number, released: number): string {
  const [size = ""] = sizeLines(Math.min(wanted.target, held), wanted.level);
  if (practice === null) return `${size}.`;
  const more =
    released > 0 && released < practice
      ? `, and another only while more than ${String(comparisonFloor(wanted.level))} tasks stay held out`
      : "";
  return `Released for practice: ${String(released)} of the ${plural(practice, "task")} the campaign names${more}. ${size}.`;
}

function campaignStatus(context: CampaignContext, bench: Bench): string {
  const { turn } = halted(context, bench);
  const sets = taskSets(turn.events);
  const tallies = formatComparisonHistory(campaignOf(turn.events).steps);
  const writing = context.examining?.session;
  const idle = idleOf(turn.events) - 1;
  return [
    `Campaign facts: ${plural(sets.held.length, "held-out task")}, ${plural(sets.released.length, "practice task")}.`,
    ...(turn.plan.left == null
      ? []
      : [
          `Campaign budget: ${turn.plan.left.dollars.toFixed(2)} dollars left; ${String(turn.plan.left.reserve)} reserved for a solve.`,
        ]),
    tallies.length === 0
      ? `No comparison has a tally yet. ${firstFacts(turn.plan, sets.held.length, sets.released.length)}`
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
  ].join("\n");
}

export function campaignTools(
  context: CampaignContext,
  opening: "starts-examiner" | "starts-nothing" = "starts-nothing",
): NonNullable<BuildRequest["campaign"]> {
  return (bench) => {
    const examineRun = examineAction(context, bench);
    const examining = actionTool(context, bench, "examine", examineRun);
    // After a promotion the host starts the Examiner session the table names, since a Builder left to it
    // can compare minutes after its promotion on almost no task informative for the new reference.
    const promoting = (made: AgentTool): AgentTool => ({
      ...made,
      execute: async (args, api, execution) => {
        const before = lastPromoted(read(context.log, TRACE_KINDS));
        const result = await made.execute(args, api, execution);
        if (lastPromoted(read(context.log, TRACE_KINDS)) === before || context.examining != null) {
          return result;
        }
        if (actionTurn(context).decided.move !== "examine") return result;
        const started = await examining.execute({}, api, execution);
        return { ...result, output: [...(result.output ?? []), ...(started.output ?? [])] };
      },
    });
    return {
      start: async () =>
        opening === "starts-examiner"
          ? textsOf((await runAction(context, bench, "examine", examineRun, undefined)).output ?? []).join(
              "\n",
            )
          : "",
      tools: [
        ...[examining, promoting(compareTool(context, bench))].map((made) =>
          endingWith(made, () => campaignStatus(context, bench)),
        ),
        waitTool(
          "Wait for the Examiner session writing beside this conversation to end, on the host's time, and return the campaign's facts; at once where none is writing.",
          async () => {
            const writing = context.examining;
            if (writing == null) return campaignStatus(context, bench);
            await bench.within(() => writing.done);
            return campaignStatus(context, bench);
          },
        ),
        tool({
          name: "campaign_status",
          description: "Read the campaign's counts.",
          parameters: Type.Object({}),
          execute: async () => text(campaignStatus(context, bench)),
        }),
      ],
      hook: () => campaignStatus(context, bench),
      halts: () => {
        halted(context, bench);
      },
      closing: async () => {
        await context.examining?.done;
        await context.examiner?.close();
      },
      unmeasured: async (digest) => {
        const reference = (await keptAs(context.campaign, "--reference", PROMOTED)).digest;
        if (digest === reference) {
          // A Builder that finishes on the harness just promoted would stop the climb at one step, so
          // it is told so.
          if (
            actionTurn(context).decided.move === "end" ||
            lastPromoted(read(context.log, TRACE_KINDS)) !== digest
          ) {
            return null;
          }
          return "harness/ is the harness last promoted, and no step past it has been tried.";
        }
        if (readAgainst(read(context.log, TRACE_KINDS), digest, reference)) return null;
        const writing = context.examining?.session;
        return `No comparison has read harness/ as it stands against the reference, and finish leaves it unmeasured.${writing === undefined ? "" : ` Examiner session ${writing} is still writing tasks beside this conversation, and finish waits for it to end.`}`;
      },
    };
  };
}

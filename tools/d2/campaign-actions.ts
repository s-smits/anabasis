/**
 * The campaign's moves as a live Builder makes them: the tools its conversation is given beside
 * its own, and the advice their results end with. This module is the whole of what a campaign
 * led by its Builder adds to one the host runs (`--builder-led`, `harness-builder.ts`); the flags
 * and terms both run by are `campaign-terms.ts`.
 *
 * The Builder keeps one conversation and one working copy while it asks a separate Examiner for
 * tasks (`examine`), has the host release practice tasks (`release_practice`), freezes its harness
 * and has it compared (`compare`), and has an eligible harness made the reference (`promote`).
 * The decision table says which move follows from the log (`decide`, `src/builder/decide.ts`), and
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
 * campaign waits out (`waitOut`, `host.ts`): the Builder is then told to call the tool again.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { supplyOf } from "#src/builder/admission.ts";
import { decide } from "#src/builder/decide.ts";
import { comparisonsOf, crashedRun } from "#src/builder/ground.ts";
import { campaignOf } from "#src/builder/handover.ts";
import { type Decided, short } from "#src/builder/move.ts";
import { type Opening } from "#src/builder/opening.ts";
import { comparisonsTold } from "#src/builder/past.ts";
import type { BuildRequest } from "#src/builder/session.ts";
import { type Bench, endingWith, snapshot } from "#src/builder/tools.ts";
import { pendingWords } from "#src/builder/word.ts";
import { examine } from "#src/examiner/session.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { latestBuilt } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { taskSets } from "#src/kernel/task.ts";
import { mkdirSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { plural } from "#src/meta/text.ts";
import { text, tool } from "#src/solve/answer.ts";
import { publicView } from "#src/solve/prompt.ts";
import { examineCommand } from "../d1b/examine.ts";
import { keptAs, openCampaign, PROMOTED, packNamed } from "./campaign.ts";
import {
  comparisonOf,
  DEFAULTS,
  examTasks,
  flag,
  MOVED,
  nextId,
  opened,
  packOf,
  SCRIPTED,
  type Seats,
  sharedOf,
  startOf,
  type Turn,
  turnOf,
  type Values,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { waitOut } from "./host.ts";
import { PRACTICE, prepareCommand } from "./prepare.ts";
import { promoteCommand } from "./promote.ts";
import { type Campaign, type Seated, solved } from "./round.ts";

/** The four moves a live Builder makes by a tool, each under the tool's name. */
type ActionMove = "examine" | typeof RELEASE | "compare" | "promote";

type Compare = Extract<Decided, { move: "compare" }>;

/** What a campaign tool did, as the Builder reads it, or why it did nothing. */
type Outcome = { readonly said: string } | { readonly refused: string };

/** What a live Builder's campaign tools are made with, and what they leave the command to read. */
export interface CampaignContext {
  readonly log: string;
  readonly values: Values;
  /** What the campaign runs by; a total the operator left as a word replaces it at an action. */
  opening: Opening;
  readonly seats: Seats;
  /** Who solves, each solve held at the host's gate (`gated`, `host.ts`). */
  readonly held: Seated;
  /** The campaign as last opened: an Examiner session and a promotion open it again. */
  campaign: Campaign;
  readonly paid: "paid" | "scripted";
  /** The moves this run of the command may make (`--moves`), and those it has made. */
  readonly maxMoves: number;
  used: number;
  /** The action that threw after it began, with what it threw: the environment's ending. */
  failed: { readonly move: string; readonly why: string } | null;
  /** The Examiner session writing beside the conversation, which settles and never throws. */
  examining?: { readonly session: string; readonly done: Promise<void> } | null;
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
  const folder = join(bench.home, "practice");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  for (const { task } of tasks) {
    writeFileSync(
      join(folder, `${task.taskId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`),
      `${capturedJsonStringify(task, null, 2)}\n`,
    );
  }
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

/** The tool that makes the table's move: a release for practice is `release_practice`, and a
 *  lack of room is advice to ask the Examiner while the conversation lives. */
function toolOf(decided: Decided): string {
  if (decided.move === "end") return decided.ending === "no-room" ? "examine" : "end";
  return decided.move === "prepare" ? RELEASE : decided.move;
}

/**
 * One campaign tool. Before anything runs: the run's moves, the host's stop, an ending the table
 * names (a lack of room excepted, which is advice here), and the operator's word for other tasks.
 * A comparison that began goes on under its own cap whatever is left of the total, as the table
 * has it (`unafforded`, `src/builder/decide.ts`): the budget's ending is the table's, read above.
 * `run` is handed `begin`, which writes the move's event (`campaign.move`): the table's code and
 * reason where the Builder made the move it named, and `asked` with what the table named otherwise.
 */
function actionTool(
  context: CampaignContext,
  bench: Bench,
  move: ActionMove,
  run: (
    turn: Turn,
    decided: Decided,
    begin: (named: JsonObject) => void,
    signal: AbortSignal | undefined,
  ) => Promise<Outcome>,
): AgentTool {
  const label = move.replaceAll("_", " ");
  return tool({
    name: move,
    label,
    description: {
      examine:
        "Ask a separate Examiner to write tasks under the fixed exam. It returns at once and the Examiner writes beside you; the campaign's facts say what it has held out.",
      release_practice: "Release the host's draw of public practice tasks into this workspace.",
      compare:
        "Freeze harness/ and compare it with the current reference on fresh held-out solves. Where a comparison began and has not reported, it goes on under its original terms. Where the last one read a step, this is its repeat, of the harness as it was frozen then, on the tasks held, those the step did not score first.",
      promote:
        "Make the harness that read a step and its repeat the campaign's reference. Nothing else is promoted, and this measures nothing.",
    }[move],
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_id, _args, signal) => {
      const halt = (message: string) => {
        bench.halt.abort();
        return text(message);
      };
      if (context.used >= context.maxMoves) {
        return halt("The campaign move limit has been reached; the host will stop this conversation.");
      }
      if (signal?.aborted === true) return text("The campaign has been stopped by the host.");
      // An Examiner session writes beside the conversation, and any other action waits for it, on
      // the host's time: two actions never spend from the total at once.
      const writing = context.examining;
      if (writing != null) {
        if (move === "examine") return text(`Examiner session ${writing.session} is still writing.`);
        await bench.within(() => writing.done);
      }
      const { turn, decided } = actionTurn(context);
      if (decided.move === "end" && decided.ending !== "no-room") {
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
      const sleep = context.seats.host?.sleep;
      // The conversation's wall stops while the action runs, a wait for the provider included.
      return await bench.within(async () => {
        try {
          const outcome = await run(turn, decided, begin, signal);
          if ("refused" in outcome) return text(outcome.refused);
          // A session of the action's that the provider's limit ended is waited out here, as after
          // each move of a campaign before the Builder made them.
          await waitOut(context.log, crashedRun(read(context.log)).crash, sleep);
          return text(outcome.said);
        } catch (error) {
          // Asked before the throw is read as a refusal, as the host's loop asks it: a limit that
          // ended a session before its first event is no refusal, and asked for again at once the
          // action would meet the same limit.
          if (await waitOut(context.log, errorMessage(error), sleep)) {
            return text(
              `The provider's limit ended the ${label} action, and the host has waited it out: call ${move} again.`,
            );
          }
          if (begun === null || read(context.log).length <= begun) {
            return text(`The host refused the ${label} action; choose another action.`);
          }
          context.failed = { move: move === RELEASE ? "prepare" : move, why: errorMessage(error) };
          bench.halt.abort();
          return text(`The host could not complete the ${label} action. The campaign has been stopped.`);
        }
      });
    },
  });
}

const examineTool = (context: CampaignContext, bench: Bench): AgentTool =>
  actionTool(context, bench, "examine", async (turn, decided, begin, signal) => {
    const { seats, values } = context;
    if (seats.seated !== solved && seats.examine === undefined) {
      return { refused: "This campaign has no Examiner seat, so the host cannot write more tasks." };
    }
    const { examiner } = turn.opening.seats;
    if (seats.seated === solved && examiner === null) {
      throw new Error("name --examiner: the campaign needs an Examiner");
    }
    const session = nextId(turn.events, "x");
    begin({
      ...startOf("examine", seats),
      session,
      ...keyIfDefined(
        "answers",
        decided.move === "examine" && decided.answers ? [...decided.answers] : undefined,
      ),
    });
    // The action returns once the session is on record: a throw before that is the action's.
    const { promise: onRecord, resolve } = Promise.withResolvers<void>();
    const sitting = seats.examine ?? examine;
    const work = examineCommand(
      [
        ...packOf(values),
        "--session",
        session,
        "--examiner",
        examiner?.model ?? SCRIPTED,
        "--examiner-effort",
        examiner?.effort ?? DEFAULTS.effort,
        ...flag("tasks", values["exam-tasks"] ?? examTasks(turn)),
        // The campaign's setting before one is recorded: the Examiner's budget, and `try_task`'s.
        ...sharedOf(turn).setting,
        ...flag("proposals", values["exam-proposals"]),
        ...flag("minutes", values["exam-minutes"]),
        ...flag("turns", values["exam-turns"]),
      ],
      (request, wall) => sitting({ ...request, opened: resolve }, wall),
      seats.examine === undefined ? solved : null,
      signal,
    ).then(() => refreshCampaign(context, bench));
    await Promise.race([work, onRecord]);
    // The session writes beside the conversation: a limit it met is waited out, and a throw after
    // it began is the environment's ending, as an action's is (`actionTool`).
    const done = work
      .then(() => waitOut(context.log, crashedRun(read(context.log)).crash, context.seats.host?.sleep))
      .catch(async (error: unknown) => {
        if (await waitOut(context.log, errorMessage(error), context.seats.host?.sleep)) return;
        context.failed = { move: "examine", why: errorMessage(error) };
        bench.halt.abort();
      })
      .then(() => {
        context.examining = null;
      });
    context.examining = { session, done };
    return {
      said: `Examiner session ${session} is writing beside this conversation: edit and practise meanwhile. Any other campaign action waits for it to end, and campaign_status says what it held out.`,
    };
  });

const releaseTool = (context: CampaignContext, bench: Bench): AgentTool =>
  actionTool(context, bench, RELEASE, async (_turn, decided, begin) => {
    const { values } = context;
    const practice =
      (decided.move === "prepare" ? decided.practice : undefined) ?? values.practice ?? PRACTICE;
    const began = startOf("prepare", context.seats);
    const result = await prepareCommand([
      ...packOf(values),
      "--practice",
      String(practice),
      // The campaign's terms, so what it prints of a comparison's size is the campaign's.
      ...(["solves", "level", "trigger"] as const).flatMap((name) => flag(name, values[name])),
    ]);
    if (result !== 0) throw new Error("the practice release was refused");
    begin(began);
    await refreshCampaign(context, bench);
    return {
      said: `Practice release completed: ${String(taskSets(read(context.log)).released.length)} tasks available.`,
    };
  });

/**
 * The two harnesses a `compare` reads, and what the Builder is told of the choice. A comparison
 * that began goes on, and the repeat of a reading under the trigger is of the harness that reading
 * froze: an edit made between the two would otherwise be measured in the repeat's place, and the
 * step would never be read twice. Otherwise the working copy is frozen and compared, unless it is
 * the reference harness, where the table's own comparison is made (the control, or the latest
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
  // A repeat the table would write tasks for first runs on the tasks held where the Builder asks.
  if (
    (decided.move === "compare" || decided.move === "examine") &&
    decided.repeats !== undefined &&
    latest !== null
  ) {
    const { repeats } = decided;
    return {
      move:
        decided.move === "compare"
          ? { ...decided, fresh: latest }
          : {
              move: "compare",
              code: ASKED,
              fresh: latest,
              reference: "promoted",
              repeats,
              why: "the Builder asked for the repeat",
            },
      note: `This comparison repeated harness ${short(latest)} as comparison ${decided.repeats} froze it: changes made to harness/ since are not in it.`,
    };
  }
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
  const measured = comparisonsOf(events).some(({ fresh, old }) => fresh === working && old === reference);
  if (measured && decided.move !== "compare") {
    return {
      refused: `harness/ is harness ${short(working)}, which a comparison has read against the reference, and nothing in it has changed since: there is nothing new to compare.`,
    };
  }
  return {
    move: {
      move: "compare",
      code: decided.move === "compare" ? decided.code : ASKED,
      fresh: working,
      reference: "promoted",
      why: "the Builder asked for a comparison",
    },
    note: "",
    ...keyIfDefined("froze", working === latest ? undefined : working),
  };
}

const compareTool = (context: CampaignContext, bench: Bench): AgentTool =>
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
    // (11 October: the trigger had been left off, and no record could show it).
    begin({
      ...startOf("compare", context.seats),
      session,
      args: args.slice(packOf(context.values).length),
    });
    await checkpointCommand(args, context.held, signal);
    const events = read(context.log);
    const step = campaignOf(events).steps.findLast(
      (each) => each.step === "comparison" && each.id === session,
    );
    const tally = comparisonsTold(step === undefined ? [] : [step])[0] ?? "The comparison has no tally yet.";
    const scored = events.findLast(
      ({ kind, data }) => kind === "comparison.reported" && data.session === session,
    )?.data.versions;
    const size = Array.isArray(scored) ? [sizeLine(turn, scored.length)] : [];
    return { said: [tally, ...size, ...(named.note === "" ? [] : [named.note])].join("\n") };
  });

const promoteTool = (context: CampaignContext, bench: Bench): AgentTool =>
  actionTool(context, bench, "promote", async (turn, decided, begin) => {
    // The harness the rule names, which is not always the last one frozen (`twice`, `decide.ts`).
    const candidate = decided.move === "promote" ? decided.harness : latestBuilt(turn.events);
    const name = context.values.name ?? "";
    if (candidate === null) {
      return { refused: "No comparison has frozen a harness, so there is none to promote." };
    }
    if (context.opening.attended) {
      if (decided.move === "promote") {
        console.log(
          `under --attended a promotion is the operator's word: bun tools/d2/promote.ts --name ${name} --harness ${candidate} --yes, or run this command with --no-attended`,
        );
      }
      return { refused: "Promotion awaits the operator under --attended." };
    }
    const before = read(context.log).length;
    const began = startOf("promote", context.seats);
    await promoteCommand(["--name", name, "--harness", candidate, "--yes"]);
    const promoted = read(context.log)
      .slice(before)
      .some(({ kind }) => kind === "harness.promoted");
    if (!promoted) {
      return {
        refused:
          "Nothing was promoted: no harness other than the reference has read a step and its repeat against it.",
      };
    }
    begin({ ...began, harness: candidate });
    await refreshCampaign(context, bench);
    return { said: `Harness ${short(candidate)} is now the campaign's reference.` };
  });

/** What a comparison of `scored` tasks can read, as the operator reads it before one (`sizeLines`):
 *  until 13 October the Builder was not told, and a led Builder bought one of six scored tasks,
 *  whose step and repeat together clear at 6-0 at the least. */
function sizeLine({ events, plan }: Turn, scored = Math.min(plan.wanted.target, supplyOf(events).held)) {
  return `Comparison size: ${sizeLines(scored, { ...plan.wanted, patience: plan.patience })[0] ?? ""}.`;
}

/** The last Examiner session of this conversation: writing, or how it ended and what it held out. */
function examinedLines(events: readonly LogEvent[], writing: string | undefined): string[] {
  const since = events.findLastIndex(({ kind }) => kind === "build.started");
  const begun = events.findLast(
    ({ kind, data }, at) => at > since && kind === MOVED && data.move === "examine" && isString(data.session),
  )?.data.session;
  if (!isString(begun)) return [];
  const ended = events.findLast(({ kind, data }) => kind === "exam.finished" && data.session === begun)?.data;
  if (begun === writing || ended === undefined) {
    return [
      `Examiner session ${begun} is writing beside this conversation; any other campaign action waits for it.`,
    ];
  }
  const said = EXAMINED.get(isString(ended.ended) ? ended.ended : "") ?? "ended at its limits";
  return [
    `Examiner session ${begun} ${said}, and held out ${plural(Array.isArray(ended.held) ? ended.held.length : 0, "task")}.`,
  ];
}

/** What the action the table names would do, as the status says it under the suggestion: for a
 *  comparison or more tasks, what a comparison of the tasks held can read. */
function namedLine(decided: Decided, latest: string | null, size: string): string {
  if (decided.move === "build") return "Edit and practise the harness.";
  if (decided.move === "promote") return `promote makes harness ${short(decided.harness)} the reference.`;
  if (decided.move === "examine") {
    // The tasks a repeat waits on are advice: compare runs it on the tasks held (`comparedOf`).
    return decided.repeats === undefined || latest === null
      ? size
      : `${size}\ncompare repeats harness ${short(latest)} as comparison ${decided.repeats} froze it now, on the tasks held.`;
  }
  if (decided.move !== "compare") return `Choose the ${toolOf(decided)} action.`;
  if (decided.id !== undefined) {
    return `compare goes on with comparison ${decided.id}, which began and has not reported.`;
  }
  if (decided.repeats !== undefined && latest !== null) {
    return `compare repeats harness ${short(latest)} as comparison ${decided.repeats} froze it: changes made to harness/ since are not in it.`;
  }
  return decided.fresh === "starter"
    ? "While harness/ is the reference harness, compare reads the starter against it on the tasks held out since."
    : size;
}

/**
 * What the Builder is told of its campaign, where it can have moved (a campaign tool's result):
 * what was written and released, what is left of the total, the last tally, and the table's
 * action. Reading it is also where the host looks at its bounds: the run's moves spent, or an
 * ending the table names, stops the conversation (`Bench.halt`).
 */
function campaignStatus(context: CampaignContext, bench: Bench): string {
  const { turn, decided } = actionTurn(context);
  if (
    context.used >= context.maxMoves ||
    (decided.move === "end" && decided.ending !== "no-room" && decided.ending !== "finished")
  ) {
    bench.halt.abort();
  }
  const noRoom = decided.move === "end" && decided.ending === "no-room";
  // The counts are of what was written and released, which no outcome of a held-out task moves:
  // the scorable, exhausted and waiting counts follow which tasks were answered (rule 3).
  const sets = taskSets(turn.events);
  const tallies = comparisonsTold(campaignOf(turn.events).steps);
  const writing = context.examining?.session;
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
    ...(writing === undefined
      ? [
          `Suggested action: ${toolOf(decided)}.`,
          noRoom
            ? "Ask the Examiner for more tasks if the current supply is not useful."
            : namedLine(decided, latestBuilt(turn.events), sizeLine(turn)),
        ]
      : []),
  ].join("\n");
}

/** The campaign's tools and advice for one Builder conversation (`BuildRequest.campaign`). */
export function campaignTools(context: CampaignContext): NonNullable<BuildRequest["campaign"]> {
  return (bench) => ({
    tools: [
      ...[examineTool, releaseTool, compareTool, promoteTool].map((made) =>
        endingWith(made(context, bench), () => campaignStatus(context, bench)),
      ),
      tool({
        name: "campaign_status",
        label: "Campaign Status",
        description: "Read campaign counts and current host advice.",
        parameters: Type.Object({}),
        executionMode: "sequential",
        execute: async () => text(campaignStatus(context, bench)),
      }),
    ],
    hook: () => campaignStatus(context, bench),
  });
}

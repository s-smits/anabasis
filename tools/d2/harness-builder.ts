/**
 * The Harness Builder's controller: one campaign run by its log, move after move.
 *
 *   bun tools/d2/harness-builder.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss \
 *     --budget 400 --builder claude/claude-opus-5-5 --examiner claude/claude-opus-5-5 \
 *     --reviewer claude/claude-opus-5-5 --solve-model-turns 40 [--moves 1] [--dry-run] [--hitl]
 *
 *   bun tools/d2/harness-builder.ts --name queues --prompt "<the domain, in the operator's words>" \
 *     --solver claude/claude-sonnet-5-5 --budget 60 --builder ... --examiner ... --reviewer ...
 *
 * A campaign is a loop of moves over one log (`7f0add79:docs/plan.md`, "The process"). Until 2026-10-09 a
 * session carried each one by hand: it read the view, chose a move by a skill's walk, and typed
 * the command with its flags. This command does that. It reads the log, asks move 7 for the one
 * move that follows (`decide`, `src/builder/decide.ts`), prints it with its reason, makes it by
 * the command an operator would run, and reads the log again, until the campaign ends or `--moves`
 * are made. It chooses nothing of its own: the table chooses, and every refusal is the command's.
 *
 * **Who makes the moves after set-up** is the campaign's own term, kept by its opening
 * (`--builder-led`, on for a campaign that opens now; `--no-builder-led` gives the other). Led by
 * its Builder, the host still drafts and reads the exam and sets the tasks apart, and from there
 * one live Builder conversation makes the moves through its campaign tools: an Examiner session,
 * a release, a comparison, a promotion (`campaign-actions.ts`). The table's move is its advice,
 * and every condition above stays the host's at each action. A conversation that ends at its own
 * limits is followed by another on the Builder's notes, and so is one the Builder ends with
 * `finish`, until three in a row have made no campaign move (`finished`). A lack
 * of room is advice to ask the Examiner while a conversation lives, and the campaign's ending
 * once one has ended with the table still naming it. Without the term the command makes every
 * move itself, a Builder session among them, as it did before 13 October, and nothing a Builder
 * reads differs from then (`SAID`, `src/builder/prompt.ts`). A campaign on record without the
 * term runs so.
 *
 * **A campaign opens over a stored pack, which four flags name, or from a prompt** (row F53).
 * The prompt and who solves are then part of what it runs by, its first move is the Examiner's
 * draft of the exam, and from there every command opens the campaign by its name alone, over the
 * exam its log holds. Every check of a drafted exam is its author's own computation, and the
 * launch is the operator's word for each (16 October): the exam is read with every check its author
 * decides admitted, the objective among them, in a drafted exam or a stored pack
 * (`--admit-authored`), and frozen where nothing else is at fault. Under `--hitl` they wait for
 * `--admit`.
 *
 * What it runs each move as:
 *
 *   draft the exam      tools/d1b/draft.ts, under `d-N`, for a campaign that opened from a prompt
 *   read the exam       tools/c/accept.ts, with `--freeze --admit-authored` unless `--hitl`, and
 *                       the checks a reading under `--hitl` left unadmitted (`planOf`, `opening.ts`)
 *   set the tasks apart tools/d2/prepare.ts
 *   an Examiner session tools/d1b/examine.ts, under the next free id `x-N`
 *   a Builder session   tools/d2/session.ts, under `b-N`
 *   a comparison        tools/d2/checkpoint.ts, under `g-N`; one that began goes on under its id
 *                       and its own terms
 *   a promotion         tools/d2/promote.ts `--yes`
 *
 * **What it runs by** is recorded once, as `campaign.opened`: its project (`--project`, required at
 * the opening: `projectOf`, `campaign.ts`), the total budget in dollars and the
 * reserve one solve is held at (`--budget`, `--reserve`), the full limit of a solve in the model's
 * turns (`--solve-model-turns`), the Builder sessions before a comparison (`--sessions`), the
 * campaign's patience (`--patience`: the moves without a gain, and the readings that left nothing
 * to gain, it bears in a row before it ends, six by default while the system is
 * built, since every campaign of 9 and 10 October ended on the plan's three before its tasks were
 * measured), who sits in each seat, and the terms of its moves as a command last named them
 * (`TERMS`, `src/builder/opening.ts`): a session's limits, a comparison's size, the practice tasks.
 * A later run that names nothing runs by the record, and one that names another records it again:
 * these are the operator's conditions, and a comparison logs its own terms at its start. The
 * setting is the log's own record (`campaign.setting`), and every command refuses another.
 *
 * **The budget is one total** (`7f0add79:docs/plan.md`, row F49). Each move's cap is what is left of it:
 * the total less every billed dollar the log holds, and where less is left than one solve is held
 * at, the campaign ends on its budget. **What it risks** is said as it opens: what one reading of
 * its target can show and its per-comparison rate (`sizeLines`, `src/kernel/size.ts`), and a paid
 * campaign whose target is too small for a step at its level is refused there.
 *
 * **A campaign runs unattended** (row F29; the operator, 12 and 16 October): it admits every check
 * its author's own computation decides, a drafted exam's objective among them, freezes an exam whose reading holds no fault and promotes a harness a comparison
 * against the reference read as a step (until 19 October, a step read twice). Under `--hitl`, the operator in the loop, kept by the opening until
 * `--no-hitl`, all three wait for the operator's word and a promotion stops the command. Going on past the stop rule takes `--past-stop "<why>"` either way.
 *
 * **A word the operator leaves** (`word.ts`, row F50) is read at each move's boundary: a stop
 * ends the campaign there, other tasks are written first, and another total is what the campaign
 * runs by from that move on. A word changes nothing in the move that was running when it came.
 *
 * **Endings.** A campaign ends on its budget, on the stop rule, on an exam that was not accepted,
 * on tasks that could not be made to leave room, on its environment, on the operator's word or, led
 * by its Builder, once three of its conversations in a row made no campaign move (`idleOf`), and
 * its log's last event says which (`campaign.ended`). With `--handover <dir>` it then writes what
 * it hands over there: the reference harness as a directory that stands by itself, the public rules
 * and the closing report (`close.ts`, row F51). A move that threw after it had begun is the
 * environment's ending, and run again the command goes on from the log; one whose session is on
 * record as crashed is the provider's failure, which the campaign goes on from (`goesOn`). A
 * session a stopped run left open is ended on record as killed before the next run's first move
 * (`endCut`), keeping its last practised harness where the saved state opens. A move refused before
 * it began is no ending: the refusal is printed, nothing kept.
 *
 * A move is recorded as it begins (`campaign.move`), with the code of the table's row that chose it and its
 * reason, so the log holds what was decided before what was done. Each run of the command keeps a receipt beside the
 * log, `launch-run-<n>.json`: its flags, the commit it stands at and the load it started under
 * (`keepReceipt`, `tools/runs/receipt.ts`).
 *
 * **A solve waits for the host.** Each solve of a Builder session or a comparison starts once the
 * host's one-minute load is at or under its cores, and a wait is on record (`gated`, `host.ts`).
 * `--loaded` starts them all the same.
 *
 * `--dry-run` prints the next move and makes none. Under a rehearsal's seats (`tools/runs/`) the
 * same loop runs with a script in each model seat, no budget and no model.
 *
 * Not run here: see `campaign.ts`.
 */
import { decide } from "#src/builder/decide.ts";
import { sessionEnded } from "#src/builder/ground.ts";
import { type Decided, decidedLine } from "#src/builder/move.ts";
import { pendingWords } from "#src/builder/word.ts";
import { keepPractised } from "#src/builder/session.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { sweepOf } from "#src/kernel/compare.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { cutSessions, latestBuilt, promoted } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { existsSync, mkdirSync } from "#src/meta/filesystem.ts";
import { isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { acceptCommand } from "../c/accept.ts";
import { draftCommand } from "../d1b/draft.ts";
import { examineCommand } from "../d1b/examine.ts";
import { nextRun, writeReceipt } from "../runs/receipt.ts";
import { standing } from "../runs/registry.ts";
import { campaignLog, openCampaign, packNamed, REPO } from "./campaign.ts";
import { type CampaignContext, campaignTools } from "./campaign-actions.ts";
import {
  comparisonOf,
  DEFAULTS,
  examTasks,
  flag,
  flagsOf,
  IDLE,
  idleOf,
  MOVED,
  nextId,
  opened,
  packed,
  packOf,
  SCRIPTED,
  type Seats,
  sharedOf,
  type Turn,
  turnOf,
  type Values,
  flagsHelp,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { closeCommand } from "./close.ts";
import { gated, HOST, waitCrashed, waitOut } from "./host.ts";
import { prepareCommand } from "./prepare.ts";
import { promoteCommand } from "./promote.ts";
import { solved } from "./round.ts";
import { sessionCommand } from "./session.ts";
import { recordedSetting, settingAsked } from "./setting.ts";

const ENDED = "campaign.ended";
/** The moves the host makes itself whoever leads the campaign: the exam's draft and reading, the
 *  tasks set apart, and the promotion the rule names (14 October; inside a conversation the compare
 *  tool makes it, `promoteOwed`), which `--hitl` leaves to the operator. */
const SETUP: ReadonlySet<Decided["move"]> = new Set(["draft", "accept", "prepare", "promote"]);
/** How a Builder's campaign conversation ended where the campaign goes on with another: at its
 *  own limits, or crashed, which the table's crash rule bounds (`crashedRun`). */
const AGAIN: ReadonlySet<unknown> = new Set(["wall", "turns", "crashed"]);

/**
 * Whether the table names a move that measures what a conversation left and asks no Builder for
 * anything: any comparison, or a promotion. Until 14 October a Builder's `finish` ended the
 * campaign whatever was owed: buffer-159-opus's Builder finished a minute after a 9-0-1 step
 * bought a repeat, and the campaign ended as its Examiner session settled two and a half hours
 * later, the repeat never run; until 19 October the tasks a repeat waited for were owed too.
 * Until 15 October an ordinary
 * comparison was the Builder's alone, so three conversations that each changed the harness and
 * finished ended the campaign with the table naming its comparison (truss-151-m1 b-1,
 * buffer-151-haiku b-1 and buffer-pr169-opus b-1 finished on a harness no comparison read). The
 * host makes a comparison that began under other code as its first move, and its terms refuse it
 * with the campaign's environment ending (`begin`, `src/builder/round.ts`), where the Builder's
 * tool was refused it again and again (main0_5_1, three times at 8e0371c58). Every other Examiner
 * session the table names starts as the next conversation opens, beside it (`campaignTools`).
 * Until 16 October only the campaign's first did, and tasks for want of room were the host's once
 * IDLE conversations in a row made no campaign move: buffer-159-opus's first promotion waited
 * 5.9 hours for its next Examiner session and its second 2.1 hours, seven conversations that made
 * no move, and a campaign short of tasks could end `finished` with the table naming them. A
 * session that holds out nothing counts towards the table's own ending for want of room
 * (`roomless`).
 */
function hostOwed(decided: Decided): boolean {
  return decided.move === "promote" || decided.move === "compare";
}

/**
 * Whether the campaign goes on from a move that threw, which began where the log held `from`
 * events: a provider's limit with a reset is waited out, and so is a session on record as
 * crashed. A Builder's session that crashed is refused where it is read back (`spent`,
 * `src/builder/session.ts`), so its move throws, and until 13 October that throw was the
 * environment's ending: a provider's failure on the Builder's own turn ended the campaign, and led
 * by its Builder that turn is most of the campaign. It is the provider's failure as an Examiner's
 * crashed session is, which the campaign goes on from and the table's crash rule bounds
 * (`crashedRun`).
 */
async function goesOn(log: string, from: number, error: unknown, host: Seats["host"]): Promise<boolean> {
  if (await waitOut(log, error, host)) return true;
  const events = read(log);
  const crashed = events.slice(from).some((event) => sessionEnded(event) && event.data.ended === "crashed");
  if (crashed) await waitCrashed(log, host);
  return crashed;
}

/** Make one decided move by the command an operator would run, after `begin` is given what names
 *  it in the log: a session's or a comparison's id, a harness, the checks admitted, or nothing. */
async function make(
  decided: Exclude<Decided, { move: "end" }>,
  turn: Turn,
  begin: (named: JsonObject) => void,
): Promise<void> {
  const { events, opening, values, seats } = turn;
  const pack = packOf(values);
  const { builder, examiner } = opening.seats;
  if (decided.move === "accept") {
    const admits = turn.plan.admits.length === 0 ? undefined : turn.plan.admits;
    begin(keyIfDefined("admitted", admits && [...admits]));
    await acceptCommand([
      ...pack,
      ...flag("admit", admits?.join(",")),
      ...(opening.attended ? [] : ["--freeze", "--admit-authored"]),
    ]);
    return;
  }
  if (decided.move === "prepare") {
    const practice = decided.practice === undefined ? values.practice : String(decided.practice);
    // The campaign's terms, so what it prints of a comparison's size is the campaign's.
    begin({});
    await prepareCommand([
      ...pack,
      ...flag("practice", practice),
      ...flag("solves", values.solves),
      ...flag("level", values.level),
    ]);
    return;
  }
  if (decided.move === "promote") {
    begin({ harness: decided.harness });
    await promoteCommand([...flag("name", values.name), "--harness", decided.harness, "--yes"]);
    return;
  }
  if (decided.move === "compare") {
    const { session, args } = comparisonOf(decided, turn);
    // The comparison's own flags beside the pack's, so the log says what command the move ran
    // (11 October: the trigger had been left off, and no record could show it).
    begin({ session, args: args.slice(pack.length) });
    await checkpointCommand(args, turn.held);
    return;
  }
  if (decided.move === "draft" || decided.move === "examine") {
    const stand = decided.move === "draft" ? seats.draft : seats.examine;
    if (seats.seated === solved && examiner === null) {
      throw new Error(`name --examiner: ${decided.why}, and an Examiner session does that`);
    }
    if (seats.seated !== solved && stand === undefined) {
      throw new Error(`a rehearsal seats no Examiner, and the campaign needs one: ${decided.why}`);
    }
    const session = nextId(events, decided.move === "draft" ? "d" : "x");
    const seat = [
      "--session",
      session,
      "--examiner",
      examiner?.model ?? SCRIPTED,
      "--examiner-effort",
      examiner?.effort ?? DEFAULTS.effort,
    ];
    begin({ session });
    if (decided.move === "draft") {
      await draftCommand([...flag("name", values.name), ...seat], seats.draft);
      return;
    }
    await examineCommand(
      [
        ...pack,
        ...seat,
        ...flag("tasks", values["exam-tasks"] ?? examTasks(turn)),
        // The campaign's setting before one is recorded: the Examiner's budget, and `try_task`'s.
        ...sharedOf(turn).setting,
        ...sharedOf(turn).reviewer,
        ...flag("proposals", values["exam-proposals"]),
        ...flag("minutes", values["exam-minutes"]),
        ...flag("turns", values["exam-turns"]),
        ...flag("reference-home", values["exam-reference"]),
        ...flag("results", values["exam-results"]),
      ],
      seats.examine,
      // The campaign's own seat, so the tries wait on the load and share the reserve (14 October).
      seats.probe ?? (seats.examine === undefined ? turn.held : null),
    );
    return;
  }
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const session = nextId(events, "b");
  begin({ session });
  await sessionCommand(
    [
      ...pack,
      ...setting,
      "--session",
      session,
      ...(builder === null ? [] : ["--builder", builder.model, "--builder-effort", builder.effort]),
      ...flag("minutes", values.minutes),
      ...flag("turns", values.turns),
      ...flag("practice-solves", values["practice-solves"]),
      ...cap,
      ...reviewer,
      ...pastStop,
    ],
    turn.held,
  );
}
/**
 * What an operator reads where a campaign ends on its exam: the faults of the checker's last
 * reading, where this run did not just print them, and the command that admits the checks which
 * stand on the operator's word alone. An exam drafted from a prompt always holds such checks,
 * since no engine of the field is installed for it, so a campaign from a prompt under `--hitl`
 * waits here once, for that word. A reading made in this run printed its faults a line each as it was made
 * (`accept.ts`), and until 10 October they were printed here a second time; a run that ends on a
 * reading an earlier run made is the one that has them to print.
 */
function examLines(
  events: readonly LogEvent[],
  values: Values,
  ending: string,
  faults: "printed" | "unprinted",
): string[] {
  if (ending !== "exam") return [];
  const faulted = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  const found = Array.isArray(faulted) ? faulted.filter(isString) : [];
  const authored = unadmitted(events);
  return [
    ...(faults === "printed" ? [] : found.map((fault) => `fault: ${fault}`)),
    ...(authored.length === 0
      ? []
      : [
          // With the flags that name the campaign's pack, where it has one: until 2026-10-09 the
          // line named the campaign alone, and run so over a stored pack the command threw.
          `to admit the checks their author's own computation decides, which is the operator's word for each: bun tools/d2/harness-builder.ts ${packOf(values).join(" ")} --admit ${authored.join(",")}`,
        ]),
  ];
}

/**
 * Keep this run of the command on record: `launch-run-<n>.json` beside the log, with the flags,
 * the commit and the load it started under (`Receipt`, `tools/runs/receipt.ts`). The
 * log holds the host's code by content and no commit, and the opening keeps the terms and not the
 * flag line, so until 10 October a run under this command was on no record: the flag line of the
 * run that recorded the setting of the second campaign from a prompt on the test host (120 minutes
 * and 12 tasks where its flag file named 8 and 6) could not be traced. A rehearsal keeps none,
 * since its seats are scripts and it runs where it is told.
 */
function keepReceipt(log: string, args: readonly string[]): void {
  mkdirSync(dirname(log), { recursive: true });
  writeReceipt(log, nextRun(log), {
    at: new Date().toISOString(),
    pid: runtimeProcess.pid,
    flags: [...args],
    envFile: null,
    ...standing(REPO),
    load: HOST.load(),
    cores: HOST.cores,
    bun: runtimeProcess.versions.bun,
    ...keyIfDefined("login", runtimeProcess.env.ANA_LOGIN),
  });
}

/**
 * End on record, as killed, each Builder and Examiner session a stopped run of the command left
 * open, with what the log holds of it. Until 13 October a reopened campaign started new sessions
 * beside them, and readers metered each only to its last turn and counted it open (x-1 and x-2 of
 * two campaigns stopped and reopened). Killed is no crash, so the crash rule counts none of them.
 */
export async function endCut(log: string): Promise<void> {
  for (const { of, session, ...spent } of cutSessions(read(log))) {
    if (of === "build") await keepPractised(log, session, join(dirname(log), "states"));
    append(log, `${of}.finished`, { session, ended: "killed", crash: null, ...spent });
  }
}

/** Record how the campaign ended, as its last event, unless that is what its last event says. */
function ended(log: string, events: readonly LogEvent[], decided: Extract<Decided, { move: "end" }>): void {
  const last = events.at(-1);
  // An ending on a word the operator just left is a new one, whatever the last event says.
  if (decided.answers === undefined && last?.kind === ENDED && last.data.ending === decided.ending) return;
  append(log, ENDED, {
    ending: decided.ending,
    why: decided.why,
    reference: promoted(events) ?? "starter",
    latest: latestBuilt(events),
    ...keyIfDefined("answers", decided.answers === undefined ? undefined : [...decided.answers]),
  });
}

/** What writes a move's event as it begins (the overhaul plan's P9): the move, the code of the row that chose
 *  it, its reason and start, and what `make` names it by, so a move that throws is on record with
 *  the reason it was made for. Until 12 October it was written when the move ended. */
function beginning(log: string, decided: Exclude<Decided, { move: "end" }>) {
  return (named: JsonObject) =>
    append(log, MOVED, {
      move: decided.move,
      code: decided.code,
      why: decided.why,
      ...named,
      ...keyIfDefined(
        "answers",
        decided.move === "examine" && decided.answers ? [...decided.answers] : undefined,
      ),
    });
}

/**
 * One Builder conversation that makes the campaign's moves itself (`campaignTools`), for a
 * campaign its Builder leads, and what it left: null where the campaign goes on, the campaign's
 * ending where the conversation brought one, and otherwise the table's next move, which ends this
 * run of the command with nothing ended. The conversation is a Builder session by the command an
 * operator would run, and is on record as it begins, as every move is. Its own tool calls count
 * against `--moves`, and it does not.
 */
async function converse(context: CampaignContext, named: Decided): Promise<Decided | null> {
  const { log, values, seats } = context;
  const turn = turnOf(context);
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const session = nextId(turn.events, "b");
  const { builder } = turn.opening.seats;
  append(log, MOVED, {
    move: "build",
    code: "led",
    why: `the Builder's campaign conversation, where the table named ${named.move === "end" ? named.ending : named.move}`,
    session,
  });
  try {
    await sessionCommand(
      [
        ...packOf(values),
        ...setting,
        "--session",
        session,
        ...(builder === null ? [] : ["--builder", builder.model, "--builder-effort", builder.effort]),
        ...flag("minutes", values.minutes),
        ...flag("turns", values.turns),
        ...flag("practice-solves", values["practice-solves"]),
        ...cap,
        ...reviewer,
        ...pastStop,
      ],
      context.held,
      // An Examiner session the table names is the host's to start as the conversation opens.
      campaignTools(context, named.move === "examine"),
    );
  } catch (error) {
    // A provider's limit or a crashed conversation is waited out, and the campaign goes on;
    // anything else a conversation threw is the environment's ending, as for every move that began.
    if (context.failed === null && (await goesOn(log, turn.events.length, error, seats.host))) return null;
    append(log, ENDED, { ending: "environment", why: errorMessage(error), move: "build" });
    throw error;
  }
  const after = read(log);
  const how = after.findLast(({ kind, data }) => kind === "build.finished" && data.session === session)?.data
    .ended;
  if (context.failed !== null) {
    const { move, why } = context.failed;
    append(log, ENDED, { ending: "environment", why, move });
    return { move: "end", ending: "environment", code: "failed", why };
  }
  // A conversation that ends whole, by finish or at its limits, is followed by another on the
  // Builder's notes until IDLE in a row have made no campaign move (`idleOf`). Until 14 October every
  // finish ended the campaign: five of five led campaigns ended so, with $22 to $122 of $300 spent,
  // and the two that promoted finished within seconds of the promotion.
  const idle = how === "finished" || how === "wall" || how === "turns" ? idleOf(after) : 0;
  const table = decide(after, turnOf(context).plan);
  // A measurement the conversations bought, and a promotion, are the host's to make first (`hostOwed`), which moves the campaign, and an ending the table names stands.
  if (idle < IDLE || hostOwed(table)) {
    return how === "finished" || (AGAIN.has(how) && context.used < context.maxMoves) ? null : table;
  }
  if (table.move === "end") return table;
  const why = `${String(idle)} Builder conversations in a row made no campaign move, the last ${session}`;
  return { move: "end", ending: "finished", code: "finished", why };
}

/**
 * One conversation of a campaign its Builder leads (`converse`), and what the command does with
 * what it left: a provider's limit waited out where the campaign goes on, and otherwise the line
 * of what comes next, with the ending on record and the campaign handed over where it ended.
 */
async function lead(context: CampaignContext, named: Decided): Promise<Decided | null> {
  const { log, values, seats } = context;
  const left = await converse(context, named);
  if (left === null) {
    await waitCrashed(log, seats.host);
    return null;
  }
  console.log(`\nnext · ${decidedLine(left)}`);
  // Every ending goes on record once (`ended`). Until 14 October an environment's was taken to be
  // there already, and the crash rule's, read after the host halted a live Builder, never was.
  if (left.move === "end") ended(log, read(log), left);
  // An environment's ending hands nothing over.
  if (left.move === "end" && left.ending !== "environment" && values.handover !== undefined) {
    await closeCommand([...packOf(values), "--to", values.handover]);
  }
  return left;
}

/** Whether a conversation that began where the log held `from` events ended other than crashed:
 *  one the provider failed has not answered a lack of room, and the next one may. */
function closed(log: string, from: number): boolean {
  return read(log)
    .slice(from)
    .some(({ kind, data }) => kind === "build.finished" && data.ended !== "crashed");
}

/**
 * Refuses a flag that names another setting than the campaign's, with both, as every command
 * refuses it. Until 11 October the record's
 * model turns stood in for the flag (`7f0add79:docs/simplify.md`, A1), so another number ran at the record's.
 */
function settingHeld(log: string, given: Values): void {
  const recorded = recordedSetting(read(log));
  if (recorded === null) return;
  settingAsked(
    {
      solver: given.solver,
      "solver-effort": given["solver-effort"],
      "solver-window": given["solver-window"],
      "solve-minutes": given["solve-minutes"],
      "solve-model-turns": given["solve-model-turns"],
      target: given.target,
    },
    recorded,
  );
}

/**
 * `bun tools/d2/harness-builder.ts`, and under a rehearsal's seats the same loop with a script in
 * each model seat. It returns the last thing move 7 said: the campaign's ending, or the move that
 * would be made next.
 */
export async function harnessBuilder(
  args: readonly string[],
  seats: Seats = { seated: solved },
): Promise<Decided> {
  const given = flagsOf(args);
  const { name } = given;
  if (name === undefined) throw new Error("name --name, the campaign");
  const most = given.moves === undefined ? Number.POSITIVE_INFINITY : Number(given.moves);
  if (Number.isNaN(most) || most < 0) {
    throw new Error(`--moves ${String(given.moves)}: the moves to make are a number`);
  }
  const log = campaignLog(name);
  // Opening a campaign stages its check program, and refuses one the log froze otherwise. One that
  // opens from a prompt has no exam to open over until its first draft stands.
  let campaign = packed(given) ? await openCampaign(packNamed(given)) : null;
  const paid = seats.seated === solved ? "paid" : "scripted";
  settingHeld(log, given);
  let opening = opened(log, given, paid);
  if (paid === "paid" && !given["dry-run"]) keepReceipt(log, args);
  if (!given["dry-run"] && existsSync(log)) await endCut(log);
  // Every move is made with the terms the opening keeps: this command's, and the record's for
  // each it does not name.
  const values: Values = { ...given, ...opening.terms };
  const held = gated({ ...seats, loaded: values.loaded }, log);
  /** The move this run made last: an exam read here printed its faults as it was read. */
  let last: Decided["move"] | null = null;
  /** Whether a Builder conversation of this run has ended: a lack of room is its advice before
   *  one, and the campaign's ending after. */
  let talked = false;
  for (let made = 0; ; ) {
    // A total the operator left as a word rules from this move on: the newest stands, and the record
    // answers every one (until 11 October the newest alone, and an older one applied at the next move).
    const totals = pendingWords(read(log)).filter(({ word }) => word === "budget");
    if (totals.length > 0 && !values["dry-run"]) opening = opened(log, values, paid, totals);
    const events = existsSync(log) ? read(log) : [];
    campaign ??= draftOf(events) === null ? null : await openCampaign(packNamed(values));
    const turn = turnOf({ log, values, opening, seats, held, campaign });
    const { plan } = turn;
    if (made === 0) {
      const size = sizeLines(plan.wanted.target, plan.wanted);
      for (const line of size) console.log(line);
      // A paid campaign that could never read a step is refused before it is paid for (rule 14):
      // until 20 October it ran, and the table sent for tasks no target that small could use.
      const sweep = sweepOf(plan.wanted.level);
      if (paid === "paid" && plan.wanted.target < sweep) {
        throw new Error(`${size[0] ?? ""}: name a --target of at least ${String(sweep)}`);
      }
    }
    const decided = decide(events, plan);
    // Led by its Builder, every move but set-up and what the host owes (`hostOwed`) is the
    // conversation's, and so is a lack of room until one conversation of this run has ended on it.
    const led =
      opening.led &&
      !SETUP.has(decided.move) &&
      !hostOwed(decided) &&
      (decided.move !== "end" || (decided.ending === "no-room" && !talked));
    console.log(
      `\n${made < most && !values["dry-run"] ? `move ${String(made + 1)}` : "next"} · ${decidedLine(decided)}`,
    );
    if (led) {
      if (values["dry-run"] || made >= most) return decided;
      campaign ??= await openCampaign(packNamed(values));
      const turns = { maxMoves: most, used: made, failed: null };
      const context: CampaignContext = { log, values, opening, seats, held, campaign, paid, ...turns };
      const left = await lead(context, decided);
      const answered: boolean = talked || left !== null || closed(log, events.length);
      [made, talked, { opening }] = [context.used, answered, context];
      if (left !== null) return left;
      continue;
    }
    if (decided.move === "end") {
      const faults = examLines(events, values, decided.ending, last === "accept" ? "printed" : "unprinted");
      for (const line of faults) console.log(line);
      if (!values["dry-run"]) ended(log, events, decided);
      // What the campaign hands over, once it has an exam to open over (`close.ts`).
      if (!values["dry-run"] && values.handover !== undefined && campaign !== null) {
        await closeCommand([...packOf(values), "--to", values.handover]);
      }
      return decided;
    }
    if (values["dry-run"] || made >= most) return decided;
    if (decided.move === "promote" && opening.attended) {
      console.log(
        `under --hitl a promotion is the operator's word: bun tools/d2/promote.ts --name ${name} --harness ${decided.harness} --yes, or run this command with --no-hitl`,
      );
      return decided;
    }
    const begin = beginning(log, decided);
    try {
      await make(decided, turn, begin);
      // Inside the `try`, so a move that changed nothing ends the campaign as any other move that
      // threw does: until 20 October the process exited here with no ending on record.
      if (read(log).length <= events.length + 1) {
        throw new Error(`the move changed nothing in ${log}: made again it would change nothing again`);
      }
    } catch (error) {
      // A move the provider's limit ended, or whose session crashed, is waited out and the campaign
      // goes on: it counts against `--moves` as the move it was, since it is on record as one, and
      // the table's crash rule ends the campaign where sessions crash in a row.
      if (await goesOn(log, events.length, error, seats.host)) {
        made += 1;
        continue;
      }
      // Any other move that began and threw is the environment's ending, and the campaign goes on
      // from its log when it is run again. One refused before it began leaves the log alone.
      if (read(log).length > events.length) {
        append(log, ENDED, { ending: "environment", why: errorMessage(error), move: decided.move });
      }
      throw error;
    }
    last = decided.move;
    made += 1;
    await waitCrashed(log, seats.host);
  }
}

if (import.meta.main) {
  if (Bun.argv.includes("--help")) {
    console.log(`bun tools/d2/harness-builder.ts --name <name> ...\n${flagsHelp()}`);
  } else {
    await harnessBuilder(Bun.argv.slice(2));
  }
}

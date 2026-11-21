/**
 * The Harness Builder's controller: one campaign run by its log, move after move.
 * Launches, dry runs and continuations require the executing Bun to match this tree's exact
 * packageManager pin and engines.bun, before opening a campaign, keeping a receipt or recovery.
 *
 *   bun tools/d2/harness-builder.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss \
 *     --budget 400 --builder claude/claude-opus-5-5 --examiner claude/claude-opus-5-5 \
 *     --reviewer claude/claude-opus-5-5 --solve-model-turns 40 [--moves 1] [--dry-run] [--hitl]
 *
 *   bun tools/d2/harness-builder.ts --name queues --prompt "<the domain, in the operator's words>" \
 *     --solver claude/claude-sonnet-5-5 --budget 60 --builder ... --examiner ... --reviewer ...
 *
 * A campaign is a loop of moves over one log. Rather than a session carrying each one by hand,
 * reading the view, choosing a move by a skill's walk and typing the command with its flags, this
 * command does that. It reads the log, asks move 7 for the one
 * move that follows (`decide`, `src/campaign/decide.ts`), prints it with its reason, makes it by
 * the command an operator would run, and reads the log again, until the campaign ends or `--moves`
 * are made. It chooses nothing of its own: the table chooses, and every refusal is the command's.
 *
 * **The Builder makes the moves after set-up.** The host drafts and reads the exam, sets the tasks
 * apart, makes the promotion the rule names and the comparison it owes (`converse`), and from there
 * one live Builder conversation makes the moves through its campaign tools: an Examiner session
 * and a comparison (`campaign-actions.ts`). The host releases the practice owed and makes the
 * promotion a step names, and every condition above stays the host's at each action. A conversation that ends at its own
 * limits is followed by another on the Builder's notes, and so is one the Builder ends with
 * `finish`, until three in a row have made no campaign move (`finished`). Every ending the table
 * names ends a live conversation too, a lack of room among them, since as advice a Builder could
 * buy an Examiner session past its supply patience. An older log whose host made every move
 * (`--no-builder-led`) runs led like any other.
 *
 * **A campaign opens over a stored pack, which four flags name, or from a prompt.**
 * The prompt and who solves are then part of what it runs by, its first move is the Examiner's
 * draft of the exam, and from there every command opens the campaign by its name alone, over the
 * exam its log holds. Every check of a drafted exam is its author's own computation, and the
 * launch is the operator's word for each: the exam is read with every check its author
 * decides admitted, the objective among them, in a drafted exam or a stored pack
 * (`--admit-authored`), and frozen where nothing else is at fault. Under `--hitl` they wait for
 * `--admit`.
 *
 * What it runs each move as:
 *
 *   draft the exam      tools/d1b/draft.ts, under `d-N`, for a campaign that opened from a prompt;
 *                       a draft that stands keeps its reading, and is frozen unless `--hitl`
 *   read the exam       tools/c/accept.ts, with `--freeze --admit-authored` unless `--hitl`, over
 *                       a stored pack, and for the checks a reading under `--hitl` left
 *                       unadmitted (`planOf`, `opening.ts`)
 *   set the tasks apart tools/d2/prepare.ts
 *   a conversation      tools/d2/session.ts with the campaign's tools, under `b-N`, where the
 *                       table names a Builder or an Examiner session (`converse`)
 *   a comparison        tools/d2/checkpoint.ts, under `g-N`; one that began goes on under its id
 *                       and its own terms
 *   a promotion         tools/d2/promote.ts `--yes`
 *
 * **What it runs by** is recorded once, as `campaign.opened`: its project (`--project`, required at
 * the opening: `projectOf`, `campaign.ts`), the total budget in dollars and the
 * reserve one solve is held at (`--budget`, `--reserve`), the
 * campaign's improvement patience and supply patience (`--patience`: moves without a gain, and
 * readings that left nothing to gain, it bears in a row before it ends, six by default while the system is
 * built, since a patience of three ends campaigns before their tasks are measured), who sits in
 * each seat, and the terms of its moves as a command last named them
 * (`TERMS`, `src/campaign/opening.ts`): a session's limits, a comparison's size, the practice tasks.
 * A later run that names nothing runs by the record, and one that names another records it again:
 * these are the operator's conditions, and a comparison logs its own terms at its start. The
 * setting (who solves, a solve's deadline and model turns, the scored tasks and the solves a side)
 * is recorded once, as the first run that is no dry run starts (`campaign.setting`, `settingOf`),
 * and every command refuses another.
 *
 * **The budget is one total.** Each move's cap is what is left of it:
 * the total less every billed dollar the log holds, and where less is left than one solve is held
 * at, the campaign ends on its budget. **What it risks** is said as it opens: what one reading of
 * its target can show and its per-comparison rate (`sizeLines`, `src/kernel/size.ts`), and a paid
 * campaign whose target is too small for a step at its level is refused there.
 *
 * **A campaign runs unattended** (the operator's choice): it admits every check
 * its author's own computation decides, a drafted exam's objective among them, freezes an exam whose reading holds no fault and promotes a harness a comparison
 * against the reference read as a step. Under `--hitl`, the operator in the loop, kept by the opening until
 * `--no-hitl`, all three wait for the operator's word and a promotion stops the command. Going on past the stop rule takes `--past-stop "<why>"` either way.
 *
 * **A word the operator leaves** (`word.ts`) is read at each move's boundary: a stop
 * ends the campaign there, other tasks are written first, and another total is what the campaign
 * runs by from that move on. A word changes nothing in the move that was running when it came.
 *
 * **Endings.** A campaign ends on its budget, on the stop rule, on an exam that was not accepted,
 * on tasks that could not be made to leave room, on its environment, on the operator's word, or
 * once three of its Builder's conversations in a row made no campaign move (`idleOf`), and
 * its log's last event says which (`campaign.ended`). With `--handover <dir>` it then writes what
 * it hands over there: the reference harness as a directory that stands by itself, the public rules
 * and the closing report (`close.ts`). A move that threw after it had begun is the
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
 * host's one-minute load is at or under its cores, and a wait is on record (`queued`, `host.ts`).
 * `--loaded` starts them all the same.
 *
 * `--dry-run` prints the next move and makes none. Under a rehearsal's seats (`tools/runs/`) the
 * same loop runs with a script in each model seat, no budget and no model.
 *
 * Not run here: see `campaign.ts`.
 */
import { backends } from "#src/agent/backends/models.ts";
import { decide } from "#src/campaign/decide.ts";
import { sessionEnded } from "#src/campaign/ground.ts";
import { type Decided, decidedLine } from "#src/campaign/move.ts";
import { type Opening, openingOf, SEATS } from "#src/campaign/opening.ts";
import { pendingWords } from "#src/campaign/word.ts";
import { keepCutNotes, keepPractised } from "#src/builder/session.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { comparisonFloor } from "#src/campaign/admission.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { endedOf, latestBuilt, promoted } from "#src/kernel/reports.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { cutSessions } from "#src/kernel/trace.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { existsSync, mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { waitOut } from "#src/solver/run.ts";
import { acceptCommand } from "../c/accept.ts";
import { modelNamed, sweepOptions } from "../m0/stored-sweep.ts";
import { draftCommand } from "../d1b/draft.ts";
import { hostPython, nextRun, writeReceipt } from "../runs/receipt.ts";
import { standing } from "../runs/registry.ts";
import { campaignLog, openCampaign, packNamed, REPO, treeFault } from "./campaign.ts";
import { awaitsOperator, type CampaignContext, campaignTools, releaseOwed } from "./campaign-actions.ts";
import {
  comparisonOf,
  examinerRun,
  flag,
  flagsOf,
  IDLE,
  idleOf,
  moved,
  nextId,
  opened,
  packed,
  packOf,
  prepared,
  promoteMade,
  type Seats,
  sharedOf,
  type Turn,
  turnOf,
  type Values,
  flagsHelp,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { closeCommand } from "./close.ts";
import { gated as queued, HOST, waitCrashed } from "./host.ts";
import { solved } from "./round.ts";
import { sessionCommand } from "./session.ts";
import { type AskedSetting, firstRecord, keepSetting, recordedSetting, settingAsked } from "./setting.ts";

const ENDED = "campaign.ended";
/** How a Builder's campaign conversation ended whole, by its finish or at its own limits: the
 *  conversations `idleOf` counts towards `finished`. One cut (`INTERRUPTED`) or stopped counts none. */
const WHOLE: ReadonlySet<unknown> = new Set(["finished", "wall", "turns"]);
/** How a Builder's campaign conversation ended where the campaign goes on with another: at its
 *  own limits, or crashed, which the table's crash rule bounds (`crashedRun`). */
const AGAIN: ReadonlySet<unknown> = new Set(["wall", "turns", "crashed"]);

/** The moves the host makes itself, by the command an operator would run: the exam's draft and
 *  reading, the tasks set apart, a comparison and a promotion. Every other is a conversation's. */
type Made = Extract<Decided, { move: "draft" | "accept" | "prepare" | "compare" | "promote" }>;

/**
 * Whether the campaign goes on from a move that threw, which began where the log held `from`
 * events: a provider's limit with a reset is waited out, and so is a session on record as
 * crashed. A Builder's session that crashed is refused where it is read back (`spent`,
 * `src/builder/session.ts`), so its move throws. That throw is no environment's ending, which would
 * let a provider's failure on the Builder's own turn end the campaign, and led by its Builder that
 * turn is most of the campaign. It is the provider's failure as an Examiner's
 * crashed session is, which the campaign goes on from and the table's crash rule bounds
 * (`crashedRun`).
 */
async function goesOn(log: string, from: number, error: unknown, host: Seats["host"]): Promise<boolean> {
  if (await waitOut(log, error, host?.sleep)) return true;
  const events = read(log);
  const crashed = events.slice(from).some((event) => sessionEnded(event) && event.data.ended === "crashed");
  if (crashed) await waitCrashed(log, host);
  return crashed;
}

/** Make one decided move by the command an operator would run, on record as it begins (`moved`) with
 *  what names it: a session's or a comparison's id, a harness, the checks admitted, or nothing. */
async function make(decided: Made, turn: Turn, log: string): Promise<void> {
  const { events, opening, values, seats } = turn;
  const pack = packOf(values);
  const begin = (named: JsonObject) => moved(log, decided, named);
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
    begin({});
    await prepared(turn, values.practice);
    return;
  }
  if (decided.move === "promote") {
    await promoteMade(log, values.name, decided);
    return;
  }
  if (decided.move === "draft") {
    if (seats.seated !== solved && seats.draft === undefined) {
      throw new Error(`a rehearsal seats no Examiner, and the campaign needs one: ${decided.why}`);
    }
    const session = nextId(events, "d");
    begin({ session });
    await draftCommand(examinerRun(turn, session, "draft").args, seats.draft);
    return;
  }
  const { session, args } = comparisonOf(decided, turn);
  // The comparison's own flags beside the pack's, so the log says what command the move ran
  // (a flag left off would otherwise show on no record).
  begin({ session, args: args.slice(pack.length) });
  await checkpointCommand(args, turn.held);
}
/**
 * What an operator reads where a campaign ends on its exam: the faults of the checker's last
 * reading, where this run did not just print them, and the command that admits the checks which
 * stand on the operator's word alone. An exam drafted from a prompt always holds such checks,
 * since no engine of the field is installed for it, so a campaign from a prompt under `--hitl`
 * waits here once, for that word. A reading made in this run printed its faults a line each as it was made
 * (`accept.ts`), so they are not printed here a second time; a run that ends on a reading an
 * earlier run made is the one that has them to print.
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
          // With the flags that name the campaign's pack, where it has one: a line that named the
          // campaign alone would throw, run over a stored pack.
          `to admit the checks their author's own computation decides, which is the operator's word for each: bun tools/d2/harness-builder.ts ${packOf(values).join(" ")} --admit ${authored.join(",")}`,
        ]),
  ];
}

/**
 * Keep this run of the command on record: `launch-run-<n>.json` beside the log, with the flags,
 * the commit and the load it started under (`Receipt`, `tools/runs/receipt.ts`). The
 * log holds the host's code by content and no commit, and the opening keeps the terms and not the
 * flag line, so without the receipt a run under this command would be on no record, and a setting
 * that differed from its flag file could not be traced. A rehearsal keeps none,
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
    python: hostPython(),
  });
}

/**
 * End on record, as killed, each Builder, Examiner and drafting session a stopped run of the command
 * left open, with what the log holds of it, and a Builder's notes where its home still stands, since
 * a reopened campaign starting new sessions beside them would leave readers metering each only to
 * its last turn and counting it open. Killed is no crash, so the crash rule counts none of them. A
 * draft is ended too, since a pause waits for no draft to be open, and a campaign restarted inside
 * one could otherwise never pause cleanly.
 */
export async function endCut(log: string): Promise<void> {
  for (const { of, session, ...spent } of cutSessions(read(log))) {
    if (of === "build") {
      keepCutNotes(log, session);
      await keepPractised(log, session, join(dirname(log), "states"));
    }
    append(log, `${of}.finished`, { session, ended: "killed", crash: null, ...spent });
  }
}

/** Record how the campaign ended, as its last event, unless that is what its last event says. */
function ended(log: string, events: readonly LogEvent[], decided: Extract<Decided, { move: "end" }>): void {
  // An ending on a word the operator just left is a new one, whatever the last event says.
  if (decided.answers === undefined && endedOf(events)?.ending === decided.ending) return;
  append(log, ENDED, {
    ending: decided.ending,
    why: decided.why,
    reference: promoted(events) ?? "starter",
    latest: latestBuilt(events),
    ...keyIfDefined("answers", decided.answers === undefined ? undefined : [...decided.answers]),
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
async function converse(
  context: CampaignContext,
  named: Exclude<Decided, { move: "end" }>,
): Promise<Decided | null> {
  const { log, values, seats } = context;
  const turn = turnOf(context);
  const { cap, reviewer, pastStop } = sharedOf(turn);
  const session = nextId(turn.events, "b");
  const { builder } = turn.opening.seats;
  // The practice owed since the last reading, a comparison or a promotion the host made between
  // conversations among them, is in the workspace the conversation opens on.
  await releaseOwed(context, "a Builder conversation opens");
  const led = `the Builder's campaign conversation, where the table named ${named.move}`;
  moved(log, { move: "build", code: "led", why: led }, { session });
  try {
    await sessionCommand(
      [
        ...packOf(values),
        "--session",
        session,
        ...(builder === null ? [] : ["--builder", builder.model, "--builder-effort", builder.effort]),
        ...flag("minutes", values.minutes),
        ...flag("turns", values.turns),
        ...cap,
        ...reviewer,
        ...pastStop,
      ],
      context.held,
      // An Examiner session the table names is the host's to start as the conversation opens.
      campaignTools(context, named.move === "examine" ? "starts-examiner" : "starts-nothing"),
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
  // Builder's notes until IDLE in a row have made no campaign move (`idleOf`), since a finish that
  // ended the campaign would end it with most of its budget unspent, often seconds after a promotion.
  const idle = WHOLE.has(how) ? idleOf(after) : 0;
  const table = decide(after, turnOf(context).plan);
  // A comparison, any of them, and a promotion measure what a conversation left and ask no Builder for
  // anything, so the host makes them first, and an ending the table names stands: a Builder's
  // `finish` does not end the campaign while a comparison is owed, which a harness changed and then
  // finished on would otherwise never have read. The host makes a comparison that began under other
  // code as its first move, and its terms refuse it with the campaign's environment ending (`begin`,
  // `src/campaign/round.ts`), where the Builder's tool would be refused it again and again. Every
  // Examiner session the table names starts as the next conversation opens, beside it
  // (`campaignTools`), rather than waiting for IDLE conversations in a row to make no move, which
  // left promotions hours from their next tasks. A session that holds out nothing counts towards the
  // table's own ending for want of room (`roomless`).
  if (idle < IDLE || table.move === "promote" || table.move === "compare") {
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
async function lead(
  context: CampaignContext,
  named: Exclude<Decided, { move: "end" }>,
): Promise<Decided | null> {
  const { log, values, seats } = context;
  const left = await converse(context, named);
  if (left === null) {
    await waitCrashed(log, seats.host);
    return null;
  }
  console.log(`\nnext · ${decidedLine(left)}`);
  // Every ending goes on record once (`ended`), an environment's and the crash rule's among them,
  // which read after the host halted a live Builder would otherwise never be.
  if (left.move === "end") ended(log, read(log), left);
  // An environment's ending hands nothing over.
  if (left.move === "end" && left.ending !== "environment" && values.handover !== undefined) {
    await closeCommand([...packOf(values), "--to", values.handover]);
  }
  return left;
}

/**
 * The setting the campaign runs under: the log's record, where a flag that names another is
 * refused with both, as every command refuses it; or, where the log holds none, what the flags
 * name, with the opening's solver for a campaign from a prompt, to be recorded as the command
 * starts (`keepSetting`). The opening keeps no copy of the deadline, the scored tasks, the solves
 * or the model turns, which would be two records of one fact.
 */
function settingOf(log: string, given: Values): AskedSetting {
  const events = existsSync(log) ? read(log) : [];
  const recorded = recordedSetting(events);
  const solver = recorded === null ? openingOf(events)?.solver : undefined;
  const asked = settingAsked(
    {
      solver: given.solver ?? solver?.model,
      "solver-effort": given["solver-effort"] ?? solver?.effort,
      "solver-window": given["solver-window"],
      "solve-minutes": given["solve-minutes"],
      "solve-model-turns": given["solve-model-turns"],
      target: given.target,
      solves: given.solves,
    },
    recorded,
  );
  const unrecorded = firstRecord(asked, asked.named, solverLast(events));
  if (unrecorded !== undefined) throw new Error(unrecorded);
  return asked;
}

/**
 * The opening of a paid campaign, refused where a seat's provider holds no credential here, before
 * anything is paid for (rule 14), and so also under `--dry-run`, which every launch runs first.
 * Every call of such a seat ends a provider non-result, while the seats that are served go on
 * billing for nothing.
 */
async function served(opening: Opening, paid: "paid" | "scripted", named?: string): Promise<Opening> {
  if (paid === "scripted") return opening;
  const { seats, solver } = opening;
  const models = backends(sweepOptions());
  // A stored pack's opening keeps no solver: its `--solver` solves, or its cycle's own model.
  const roles = [
    ...SEATS.map((name) => [name, seats[name]?.model] as const),
    ["solver", named ?? solver?.model] as const,
  ];
  for (const [role, model] of roles) {
    if (model !== undefined && (await models.getAuth(modelNamed(model))) === undefined) {
      throw new Error(
        `the ${role}'s ${model}: its provider holds no credential in this environment, so every call would end a provider non-result; set its key in the process environment, or in a file named with bun --env-file=<file>, since Bun loads none by itself here`,
      );
    }
  }
  return opening;
}

/** What is wrong with a manifest's Bun pins for the executing `version`, or null where
 *  `packageManager` and `engines.bun` both pin it exactly. A missing, ranged or other manager's pin
 *  differs as a wrong one does. */
function pinFault(manifest: JsonValue, version: string): string | null {
  const record = asRecord(manifest);
  const pins = { packageManager: record?.packageManager, "engines.bun": asRecord(record?.engines)?.bun };
  return pins.packageManager === `bun@${version}` && pins["engines.bun"] === version
    ? null
    : `${capturedJsonStringify(pins)} must pin the executing Bun ${version}`;
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
  // Runtime drift, and a tree checked out again under paid seats, are refused before any opening,
  // receipt or recovery can write to the campaign. A dry run seats none, so it goes on and says so:
  // otherwise a dry run could pass in a main clone whose real run is then refused.
  const manifest = join(REPO, "package.json");
  const fault = pinFault(capturedJsonParse(readFileSync(manifest, "utf8")), Bun.version);
  if (fault !== null) throw new Error(`${manifest}: ${fault}`);
  const given = flagsOf(args);
  const paid = seats.seated === solved ? "paid" : "scripted";
  const refusedTree = paid === "paid" ? treeFault(REPO) : null;
  if (refusedTree !== null && given["dry-run"]) console.error(`a real run here is refused: ${refusedTree}`);
  else if (refusedTree !== null) throw new Error(refusedTree);
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
  const setting = settingOf(log, given);
  let opening = await served(opened(log, given, paid), paid, given.solver);
  if (paid === "paid" && !given["dry-run"]) keepReceipt(log, args);
  if (!given["dry-run"] && existsSync(log)) await endCut(log);
  // Every move is made with the terms the opening keeps: this command's, and the record's for
  // each it does not name.
  const values: Values = { ...given, ...opening.terms };
  const held = queued({ ...seats, loaded: values.loaded }, log);
  /** The move this run made last: an exam read here printed its faults as it was read. */
  let last: Decided["move"] | null = null;
  for (let made = 0; ; ) {
    // A total the operator left as a word rules from this move on: the newest stands, and the record
    // answers every one, so that no older one applies at the next move.
    const totals = pendingWords(read(log)).filter(({ word }) => word === "budget");
    if (totals.length > 0) opening = opened(log, values, paid, totals);
    const events = existsSync(log) ? read(log) : [];
    campaign ??= draftOf(events) === null ? null : await openCampaign(packNamed(values));
    const turn = turnOf({ log, values, opening, seats, held, campaign });
    const { plan } = turn;
    if (made === 0) {
      const size = sizeLines(plan.wanted.target, plan.wanted.level);
      for (const line of size) console.log(line);
      // A paid campaign that could never read a step is refused before it is paid for (rule 14):
      // run, the table would send for tasks no target that small could use.
      const floor = comparisonFloor(plan.wanted.level);
      if (paid === "paid" && plan.wanted.target < floor) {
        throw new Error(`${size[0] ?? ""}: name a --target of at least ${String(floor)}`);
      }
      if (!values["dry-run"]) keepSetting(log, setting);
    }
    // Where the log stands as the move begins: the setting a first run just kept is no part of it.
    const from = existsSync(log) ? read(log).length : 0;
    const decided = decide(events, plan);
    console.log(
      `\n${made < most && !values["dry-run"] ? `move ${String(made + 1)}` : "next"} · ${decidedLine(decided)}`,
    );
    // A Builder or an Examiner session the table names is the conversation's to make.
    if (decided.move === "build" || decided.move === "examine") {
      if (values["dry-run"] || made >= most) return decided;
      campaign ??= await openCampaign(packNamed(values));
      const turns = { maxMoves: most, used: made, failed: null };
      const context: CampaignContext = { log, values, opening, seats, held, campaign, paid, ...turns };
      const left = await lead(context, decided);
      [made, { opening }] = [context.used, context];
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
      console.log(awaitsOperator(name, decided.harness));
      return decided;
    }
    try {
      await make(decided, turn, log);
      // Inside the `try`, so a move that changed nothing ends the campaign as any other move that
      // threw does, rather than the process exiting here with no ending on record.
      if (read(log).length <= from + 1) {
        throw new Error(`the move changed nothing in ${log}: made again it would change nothing again`);
      }
    } catch (error) {
      // A move the provider's limit ended, or whose session crashed, is waited out and the campaign
      // goes on: it counts against `--moves` as the move it was, since it is on record as one, and
      // the table's crash rule ends the campaign where sessions crash in a row.
      if (await goesOn(log, from, error, seats.host)) {
        made += 1;
        continue;
      }
      // Any other move that began and threw is the environment's ending, and the campaign goes on
      // from its log when it is run again. One refused before it began leaves the log alone.
      if (read(log).length > from) {
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

/**
 * The campaign controller: drives a campaign from its append-only log until an ending (`budget`,
 * `stop`, `exam`, `no-room`, `environment`, `operator`, or `finished` after `IDLE` Builder
 * conversations in a row without a campaign move) or `--moves`. The executing Bun must match
 * `packageManager` and `engines.bun`.
 *
 *   bun tools/campaign/harness-builder.ts --name queues --prompt "<the domain, in the operator's words>" \
 *     --solver claude/claude-sonnet-5-5 --budget 60 --builder claude/claude-opus-5-5 \
 *     --examiner claude/claude-opus-5-5 --reviewer claude/claude-opus-5-5 [--moves 1] [--dry-run] [--hitl]
 */
import { backends } from "#src/agent/backends/models.ts";
import { nextAction } from "#src/campaign/scheduler.ts";
import { sessionEnded } from "#src/campaign/state.ts";
import { type ScheduledAction, decidedLine } from "#src/campaign/move.ts";
import { type Opening, openingOf, SEATS } from "#src/campaign/opening.ts";
import { boundedPause, pendingSignals } from "#src/campaign/signal.ts";
import { keepCutNotes, keepPractised } from "#src/builder/session.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { comparisonFloor } from "#src/campaign/admission.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { endedData, endedOf } from "#src/kernel/reports.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { cutSessions } from "#src/kernel/trace.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { mkdirSync, openSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { asError, errorMessage } from "#src/meta/runtime-values.ts";
import { waitOut } from "#src/solver/run.ts";
import { acceptCommand } from "../eval/accept.ts";
import { modelNamed, sweepOptions } from "../m0/stored-sweep.ts";
import { draftCommand } from "../eval/draft.ts";
import { examineCommand } from "../eval/examine.ts";
import { hostPython, nextRun, writeReceipt } from "../runs/receipt.ts";
import { BUILDER, campaignOf, keepers, processes, standing, writers } from "../runs/registry.ts";
import { campaignLog, LIMITS, openCampaign, packNamed, REPO, treeFault } from "./campaign.ts";
import { type CampaignContext, campaignTools, releasePendingPractice } from "./campaign-actions.ts";
import {
  awaitsOperator,
  comparisonOf,
  examinerRun,
  flag,
  flagsOf,
  IDLE,
  idleOf,
  moved,
  nextId,
  opened,
  packOf,
  prepared,
  promoteMade,
  revertMade,
  type Seats,
  sharedOf,
  type Turn,
  turnOf,
  type Values,
  flagsHelp,
} from "./campaign-terms.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { closeCommand } from "./close.ts";
import { gated as queued, HOST, waitCrashed, waitPaused } from "./host.ts";
import { type Campaign, solved } from "./round.ts";
import { sessionCommand } from "./session.ts";
import { type AskedSetting, firstRecord, keepSetting, recordedSetting, settingAsked } from "./setting.ts";
import { openSuccessor, withFlag } from "./revise.ts";

const ENDED = "campaign.ended";
/** A conversation that ended whole, by its finish or at its own limits: what `idleOf` counts
 *  towards `finished`. One cut (`INTERRUPTED`) or stopped counts none. */
const WHOLE: ReadonlySet<unknown> = new Set(["finished", "wall", "turns"]);
const AGAIN: ReadonlySet<unknown> = new Set(["wall", "turns", "crashed"]);

type Made = Extract<
  ScheduledAction,
  { move: "draft" | "accept" | "prepare" | "examine" | "compare" | "promote" | "revert" }
>;

/**
 * A crashed Builder session's move throws where it is read back (`spent`); that is a provider's
 * failure the campaign goes on from, bounded by the crash rule (`crashedRun`), not an environment's
 * ending.
 */
async function goesOn(log: string, from: number, error: Error, host: Seats["host"]): Promise<boolean> {
  if (await waitOut(log, error, host?.sleep)) return true;
  const events = read(log);
  const crashed = events.slice(from).some((event) => sessionEnded(event) && event.data.ended === "crashed");
  if (crashed) await waitCrashed(log, host);
  return crashed;
}

async function make(decided: Made, turn: Turn, log: string): Promise<void> {
  const { events, opening, values, seats } = turn;
  const pack = packOf(values);
  const begin = (named: JsonObject) => moved(log, decided, named);
  if (decided.move === "accept") {
    const admits = turn.plan.admits.length === 0 ? undefined : turn.plan.admits;
    begin(keyIfDefined("admitted", admits && [...admits]));
    await acceptCommand([
      ...pack,
      ...flag("admit", values.admit),
      ...(opening.attended ? [] : ["--freeze", "--admit-authored"]),
      ...(opening.judged ? ["--admit-judge"] : []),
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
  if (decided.move === "revert") {
    revertMade(log, decided);
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
  if (decided.move === "examine") {
    if (seats.seated !== solved && seats.examine === undefined) {
      throw new Error(`a rehearsal seats no Examiner, and the campaign needs one: ${decided.why}`);
    }
    const session = nextId(events, "x");
    begin({ session });
    await examineCommand(examinerRun(turn, session, "write").args, seats.examine, undefined, seats.audit);
    return;
  }
  const { session, args } = comparisonOf(decided, turn);
  begin({ session, args: args.slice(pack.length) });
  await checkpointCommand(args, turn.held);
}
function examLines(
  events: readonly LogEvent[],
  values: Values,
  ending: string,
  faults: "printed" | "unprinted",
): string[] {
  if (ending !== "exam") return [];
  const faulted = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  const found = Array.isArray(faulted) ? faulted.filter(isString) : [];
  const authored = unadmitted(events, undefined, "author");
  const judged = unadmitted(events, undefined, "judge");
  return [
    ...(faults === "printed" ? [] : found.map((fault) => `fault: ${fault}`)),
    ...(authored.length === 0
      ? []
      : [
          `to admit the checks their author's own computation decides, which is the operator's word for each: bun tools/campaign/harness-builder.ts ${packOf(values).join(" ")} --admit ${authored.join(",")}`,
        ]),
    ...(judged.length === 0
      ? []
      : [
          `to admit the judged rubric items (${judged.join(", ")}), resume unattended with a cross-family --reviewer, or freeze under --hitl: bun tools/eval/accept.ts ${packOf(values).join(" ")} --admit-judge --freeze`,
        ]),
  ];
}

/**
 * The log holds the code by content and no commit, so the launch receipt keeps the flags, commit
 * and load (`tools/runs/receipt.ts`).
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

export async function endCut(log: string): Promise<void> {
  for (const { of, session, ...spent } of cutSessions(read(log))) {
    if (of === "build") {
      keepCutNotes(log, session);
      await keepPractised(log, session, join(dirname(log), "states"));
    }
    append(log, `${of}.finished`, { session, ended: "killed", crash: null, ...spent });
  }
}

function ended(
  log: string,
  events: readonly LogEvent[],
  decided: Extract<ScheduledAction, { move: "end" }>,
): void {
  // An ending on a word the operator just left is a new one, whatever the last event says.
  if (decided.answers === undefined && endedOf(events)?.ending === decided.ending) return;
  append(
    log,
    ENDED,
    endedData(events, {
      ending: decided.ending,
      why: decided.why,
      ...keyIfDefined("answers", decided.answers),
    }),
  );
}

async function converse(
  context: CampaignContext,
  named: Exclude<ScheduledAction, { move: "end" }>,
): Promise<ScheduledAction | null> {
  const { log, values, seats } = context;
  const turn = turnOf(context);
  const { cap, reviewer, pastStop } = sharedOf(turn);
  const session = nextId(turn.events, "b");
  const { builder } = turn.opening.seats;
  await releasePendingPractice(context, "a Builder conversation opens");
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
      campaignTools(context, named.move === "examine" ? "starts-examiner" : "starts-nothing"),
    );
  } catch (error) {
    if (context.failed === null && (await goesOn(log, turn.events.length, asError(error), seats.host))) {
      return null;
    }
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
  // A finish that ended the campaign would often leave most of its budget unspent seconds after a
  // promotion, so another conversation follows until `IDLE` in a row made no move.
  const idle = WHOLE.has(how) ? idleOf(after) : 0;
  const table = nextAction(after, turnOf(context).plan);
  // A Builder's `finish` does not end the campaign while a comparison is owed, and the Examiner session
  // the table names starts beside the next conversation rather than after `IDLE` idle ones.
  if (idle < IDLE || table.move === "promote" || table.move === "compare") {
    return how === "finished" || (AGAIN.has(how) && context.used < context.maxMoves) ? null : table;
  }
  if (table.move === "end") return table;
  const why = `${String(idle)} Builder conversations in a row made no campaign move, the last ${session}`;
  return { move: "end", ending: "finished", code: "finished", why };
}

async function lead(
  context: CampaignContext,
  named: Exclude<ScheduledAction, { move: "end" }>,
): Promise<ScheduledAction | null> {
  const { log, values, seats, campaign } = context;
  const left = await converse(context, named);
  if (left === null) {
    await waitCrashed(log, seats.host);
    return null;
  }
  console.log(`\nnext · ${decidedLine(left)}`);
  if (left.move === "end" && left.ending !== "revise") await closeOut(log, values, campaign, left);
  return left;
}

async function closeOut(
  log: string,
  values: Values,
  campaign: Campaign | null,
  decided: Extract<ScheduledAction, { move: "end" }>,
): Promise<void> {
  ended(log, read(log), decided);
  if (values.handover !== undefined && campaign !== null) {
    await closeCommand([...packOf(values), "--to", values.handover]);
  }
}

async function handoffRevision(
  log: string,
  args: readonly string[],
  values: Values,
  decided: Extract<ScheduledAction, { move: "end" }>,
  how: {
    readonly paid: "paid" | "scripted";
    readonly remaining: number;
    readonly seats: Seats;
    readonly opened: boolean;
  },
): Promise<ScheduledAction> {
  const name = values.name ?? "";
  const next = await openSuccessor(log, how.remaining);
  console.log(`${name}: opened successor campaign ${next.name} at ${next.log}`);
  if (values.handover !== undefined && how.opened) {
    await closeCommand([...packOf(values), "--to", values.handover]);
  }
  if (how.remaining <= 0) return decided;
  const nextArgs = withFlag(withFlag(args, "--name", next.name), "--moves", String(how.remaining));
  if (how.paid === "scripted") return await harnessBuilder(nextArgs, how.seats);
  const others = [
    ...writers(campaignOf(REPO, next.name), processes()),
    ...keepers(name),
    ...keepers(next.name),
  ];
  if (others.length > 0) {
    console.log(`${name}: successor ${next.name} goes on under its live writer or keeper`);
    return decided;
  }
  const out = join(dirname(next.log), `launch-${nextRun(next.log)}`);
  const child = capturedSpawn([capturedExecPath, join(REPO, BUILDER), ...nextArgs], {
    cwd: REPO,
    env: runtimeProcess.env,
    detached: true,
    stdin: "ignore",
    stdout: openSync(`${out}.out`, "a"),
    stderr: openSync(`${out}.err`, "a"),
  });
  child.unref();
  console.log(`${name}: handed off to successor ${next.name} (pid ${String(child.pid)})`);
  return decided;
}

function settingOf(log: string, given: Values): AskedSetting {
  const events = read(log);
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
 * Refused also under `--dry-run`: every call of a seat without a credential would end a provider
 * non-result while the served seats go on billing (rule 14).
 */
async function served(opening: Opening, paid: "paid" | "scripted", named?: string): Promise<Opening> {
  if (paid === "scripted") return opening;
  const { seats, solver } = opening;
  const models = backends(sweepOptions());
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

function checkBunPin(): void {
  const manifest = join(REPO, "package.json");
  const record = asRecord(capturedJsonParse(readFileSync(manifest, "utf8")));
  const pins = { packageManager: record?.packageManager, "engines.bun": asRecord(record?.engines)?.bun };
  if (pins.packageManager !== `bun@${Bun.version}` || pins["engines.bun"] !== Bun.version) {
    throw new Error(`${manifest}: ${capturedJsonStringify(pins)} must pin the executing Bun ${Bun.version}`);
  }
}

async function runMade(decided: Made, turn: Turn, log: string, from: number): Promise<boolean> {
  try {
    await make(decided, turn, log);
    // Inside the `try`, so a move that changed nothing ends the campaign rather than exiting with no
    // ending on record.
    if (read(log).length <= from + 1) {
      throw new Error(`the move changed nothing in ${log}: made again it would change nothing again`);
    }
    return true;
  } catch (error) {
    if (await goesOn(log, from, asError(error), turn.seats.host)) return false;
    if (read(log).length > from) {
      append(log, ENDED, { ending: "environment", why: errorMessage(error), move: decided.move });
    }
    throw error;
  }
}

export async function harnessBuilder(
  args: readonly string[],
  seats: Seats = { seated: solved },
): Promise<ScheduledAction> {
  // A dry run only reports the drift, else it could pass in a main clone whose real run is then
  // refused.
  checkBunPin();
  const given = flagsOf(args);
  const paid = seats.seated === solved ? "paid" : "scripted";
  const refusedTree = paid === "paid" ? treeFault(REPO) : null;
  if (refusedTree !== null) {
    if (given["dry-run"]) console.error(`a real run here is refused: ${refusedTree}`);
    else throw new Error(refusedTree);
  }
  const { name } = given;
  if (name === undefined) throw new Error("name --name, the campaign");
  const most = given.moves === undefined ? Number.POSITIVE_INFINITY : Number(given.moves);
  if (Number.isNaN(most) || most < 0) {
    throw new Error(`--moves ${String(given.moves)}: the moves to make are a number`);
  }
  const log = campaignLog(name);
  let campaign: Campaign | null = null;
  const setting = settingOf(log, given);
  let opening = await served(opened(log, given, paid), paid, given.solver);
  // Read before the launch receipt, so a pre-armed `runs pause` that waits for this launch's receipt
  // lands after `began` for both the outer loop and `queued`.
  const began = read(log).length;
  if (paid === "paid" && !given["dry-run"]) keepReceipt(log, args);
  if (!given["dry-run"]) await endCut(log);
  const values: Values = { ...given, ...opening.terms };
  const held = queued({ ...seats, loaded: values.loaded }, log, began);
  let last: ScheduledAction["move"] | null = null;
  for (let made = 0; ; ) {
    let events = read(log);
    const totals = pendingSignals(events).filter(({ word }) => word === "budget");
    if (totals.length > 0) {
      opening = opened(log, values, paid, totals);
      events = read(log);
    }
    campaign ??= draftOf(events) === null ? null : await openCampaign(packNamed(values));
    const turn = turnOf({ log, values, opening, seats, held, campaign });
    const { plan } = turn;
    if (made === 0) {
      const size = sizeLines(plan.wanted.target, plan.wanted.level);
      for (const line of size) console.log(line);
      // A paid campaign that could never read a step is refused before it is paid for (rule 14).
      const floor = comparisonFloor(plan.wanted.level);
      if (paid === "paid" && plan.wanted.target < floor) {
        throw new Error(`${size[0] ?? ""}: name a --target of at least ${String(floor)}`);
      }
      if (!values["dry-run"]) keepSetting(log, setting);
    }
    const from = made === 0 && !values["dry-run"] ? read(log).length : events.length;
    const decided = nextAction(events, plan);
    console.log(
      `\n${made < most && !values["dry-run"] ? `move ${String(made + 1)}` : "next"} · ${decidedLine(decided)}`,
    );
    if (decided.move === "end") {
      const faults = examLines(events, values, decided.ending, last === "accept" ? "printed" : "unprinted");
      for (const line of faults) console.log(line);
      if (values["dry-run"]) return decided;
      if (decided.ending === "revise") {
        return await handoffRevision(log, args, values, decided, {
          paid,
          remaining: most - made,
          seats,
          opened: campaign !== null,
        });
      }
      await closeOut(log, values, campaign, decided);
      return decided;
    }
    if (values["dry-run"] || made >= most) return decided;
    // Promotions and reverts still land, so the reference settles before `runs pause` stops the run.
    if (decided.move !== "promote" && decided.move !== "revert") {
      const waited = await waitPaused(log, began, campaign?.limits.wallSeconds ?? LIMITS.wallSeconds, {
        host: seats.host,
      });
      if (boundedPause(waited ? read(log) : events, began)) return decided;
      if (waited) continue;
    }
    if (decided.move === "build" || (decided.move === "examine" && decided.code !== "bound")) {
      campaign ??= await openCampaign(packNamed(values));
      const turns = { maxMoves: most, used: made, failed: null, began };
      const context: CampaignContext = { log, values, opening, seats, held, campaign, paid, ...turns };
      const left = await lead(context, decided);
      [made, { opening }] = [context.used, context];
      if (left !== null && !(left.move === "end" && left.ending === "revise")) return left;
      continue;
    }
    if (decided.move === "promote" && opening.attended) {
      console.log(awaitsOperator(name, decided.harness));
      return decided;
    }
    const completed = await runMade(decided, turn, log, from);
    made += 1;
    if (!completed) continue;
    last = decided.move;
    await waitCrashed(log, seats.host);
  }
}

if (import.meta.main) {
  if (Bun.argv.includes("--help")) {
    console.log(`bun tools/campaign/harness-builder.ts --name <name> ...\n${flagsHelp()}`);
  } else {
    await harnessBuilder(Bun.argv.slice(2));
  }
}

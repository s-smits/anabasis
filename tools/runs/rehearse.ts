/**
 * `bun run runs rehearse <the flags of tools/d2/round.ts that name no model> [--held none:pass] [--starter none]`
 *
 * A round over a seeded campaign (`seed.ts`) with a script in each model seat and no model called.
 * The plan's first round is walked this way before it is paid for (`docs/plan.md`, Phase 0): the
 * scripted Builder forks the Starter Built Harness, and the harness it leaves is compared with the
 * starter. Flags that hold `--id` are a checkpoint's, as a launch reads them, and rehearse one
 * comparison with no Builder session (`tools/d2/checkpoint.ts`). With `--no-comparison` the flags
 * are a session's, and rehearse one Builder session with no comparison after it
 * (`tools/d2/session.ts`): the plan's checkpoint is walked as two of those and then a checkpoint.
 * With `--campaign` the flags are the Harness Builder's (`tools/d2/harness-builder.ts`), and the
 * whole loop is rehearsed: every move the decision table names, until the campaign ends or
 * `--moves` are made. No script sits in the Examiner's seat, so a rehearsal that comes to need
 * tasks written stops there and says so.
 * Everything under the seats is a paid round's: the campaign's log and sets, the Builder's tools on
 * the command wall and its freeze, each solve's wall and disk cap, the answer file and `submit`,
 * the verifier, the comparison and the report. It is `roundCommand` with other
 * seats, so its flags and defaults are the round's, but that it needs no `--cap`: a script is paid
 * nothing. The three flags that name a model are refused. The answers the script writes are a
 * stored pack's graded passes and controls where `--root --sweep --bundle` name one, and otherwise
 * the drafted exam's controls and every answer the seed's source campaign passed (`draftedGraded`).
 *
 * The Builder's script adds one line to the harness's guide through its walled shell and finishes.
 * A solve's script ends one of three ways. For `pass` it writes an answer on record that the checks
 * accepted into the answer file, through the harness's own `write` or its `bash`, and submits it.
 * For `fail` it does the same with one a check rejected. For `none` it submits with no answer
 * written, as a solve that reached its limits has none: not valid, and nothing for anyone to rule on. `--held` says how a solve of a
 * held-out task ends under the two harnesses of the comparison, the reference harness and the new
 * one, as `old:new`. The reference harness is the starter unless `--reference` names another. For
 * a round the defaults, `none:pass`, script a step. `--starter` says how a solve ends under the
 * starter where it is neither of the two: after a promotion it is solved only when the comparison
 * reads a step, to hold the step to it.
 *
 * No reviewer reads a rehearsal, so a scripted `fail` is a rejection nobody ruled on: it sets its
 * task aside, as a paid comparison's would with no reviewer, the report's `counted` holds the
 * tally were it to stand, and `tools/d2/settle.ts` settles it on labels. That is the path a
 * rehearsal of rejections walks to its end.
 *
 * It proves the joins and nothing of a model: that each command takes what the one before it left,
 * and that the readings come out as the script was written to make them. A scripted solve that
 * ends otherwise than scripted is named at the end, with exit code 1. Whether the script or the
 * path under it is at fault is then the finding to make.
 */
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { Control } from "#src/kernel/acceptance.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { verdictsOf } from "#src/kernel/solves.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { ANSWER_FILE } from "#src/solve/answer.ts";
import { selectedCodingTools } from "#src/solve/coding-tools.ts";
import { openHarness } from "#src/solve/harness.ts";
import { shellQuote } from "#src/verify/solve-command-isolation.ts";
import { campaignLog, starter } from "../d2/campaign.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { checkpointCommand } from "../d2/checkpoint.ts";
import { harnessBuilder } from "../d2/harness-builder.ts";
import { roundCommand, type Seated } from "../d2/round.ts";
import { sessionCommand } from "../d2/session.ts";
import { packControls, storedAnswer, sweepRows } from "../m0/stored-sweep.ts";
import { passedOn } from "./launch.ts";
import { SEED_FILE } from "./pulse.ts";

/** How a scripted solve ends: a valid answer, one a check rejects, or none at all. */
const ENDS = ["pass", "fail", "none"] as const;
type End = (typeof ENDS)[number];
/** How a scripted solve ends under the reference harness and under the new one. */
interface Sides {
  readonly old: End;
  readonly fresh: End;
}
/** The script of a rehearsal's solves: under the reference harness and the new, and under the
 *  starter where it is neither. */
interface Script {
  readonly held: Sides;
  readonly starter: End;
}

const OWN = new Set(["held", "starter", "no-comparison", "campaign"]);
/** The flags that name a stored pack together (`packNamed`). */
const PACK_FLAGS = 3;
const TOOL_USE = { stopReason: "toolUse" } as const;
/** A list price for the scripted model, which the meter refuses to run without: what a rehearsal
 *  meters is the script's own words at this price, and is no cost. */
const PRICE = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
/** The guide a scripted Builder writes on, from its home. */
const GUIDE = "harness/agent/BUILT_AGENTS.md";

/** `old:new` as a pair of endings. */
export function sidesOf(flag: string): Sides {
  const [old, fresh, ...more] = flag.split(":").map(endOf);
  if (old === undefined || fresh === undefined || more.length > 0) {
    throw new Error(
      `${flag}: say how a solve ends under the reference harness and the new, each pass, fail or none, as none:pass`,
    );
  }
  return { old, fresh };
}

/** An ending by its name, or undefined for a word that names none. */
function endOf(word: string): End | undefined {
  return ENDS.find((end) => end === word);
}

/**
 * The answers on record for each task, by its id: the first the checks accepted and the first a
 * check rejected. `graded` are the pack's, the accepted ones first: a stored solve the sweep graded
 * a pass comes before the pack's own accept control, which can be stale. On the truss pack every
 * accept control of four tasks was rejected by four to seven checks (2026-10-08). The log answers
 * for the tasks no pack holds: every answer a verdict of it accepted or rejected, so a task a
 * session wrote can be scripted once some solve has answered it.
 */
export function answersOf(graded: readonly Control[], events: readonly LogEvent[]) {
  const solved = [...verdictsOf(events).values()].flatMap(({ task, answer, checker }) =>
    task === null || answer === undefined || checker === null || checker.kind === "faulty"
      ? []
      : [{ taskId: task, answer, refusedBy: checker.kind === "pass" ? null : "a check" }],
  );
  const known = new Map<string, Partial<Record<"pass" | "fail", JsonValue>>>();
  for (const { taskId, answer, refusedBy } of [...graded, ...solved]) {
    const end = refusedBy === null ? "pass" : "fail";
    known.set(taskId, { [end]: answer, ...known.get(taskId) });
  }
  return known;
}

/** A model that makes `calls` in order, a turn each, and then says nothing more however often it is
 *  asked: a script that ran out would be the provider's failure, and the solve would be run again. */
function scripted(calls: readonly (readonly [string, JsonObject])[], asked: number) {
  const faux = fauxProvider({
    models: [{ id: "script", contextWindow: 200_000, cost: PRICE }],
  });
  faux.setResponses([
    ...calls.map(([name, args]) => fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE)),
    ...Array.from({ length: asked }, () => fauxAssistantMessage("The script holds no further call.")),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models };
}

/** The seats of a rehearsal. `strayed` takes each solve that ended otherwise than scripted. */
export function scriptedSeats(script: Script, graded: readonly Control[], strayed: string[]): Seated {
  return (campaign, { reference }) => {
    const folder = dirname(campaign.log);
    if (!existsSync(join(folder, SEED_FILE))) {
      throw new Error(
        `${folder} is no seed: a rehearsal writes scripted solves, which a campaign's next round would count. Copy it first with bun run runs seed`,
      );
    }
    const answers = answersOf(graded, read(campaign.log));
    const least = starter(campaign);
    /** How a script puts a file in the solver's home under each harness, by the harness's folder:
     *  with pi's `write` where the harness selects it, and through its shell where it does not. */
    const writers = new Map<string, Promise<readonly string[]>>();
    const selectedOf = (dir: string) => {
      const known = writers.get(dir) ?? openHarness(dir).then(({ presets }) => selectedCodingTools(presets));
      writers.set(dir, known);
      return known;
    };
    /** Which of the three a solve's harness is, as a strayed solve is named: a side of the
     *  comparison first, so the starter is scripted as the reference harness where it is that. */
    const sideOf = async (dir: string) =>
      dir === reference ? "old" : dir === (await least).dir ? "starter" : "new";
    return {
      builder: scripted(
        [
          ["bash", { command: `printf '\\nA rehearsal added this line.\\n' >> "$HOME/${GUIDE}"` }],
          ["finish", { note: "A rehearsal: one line added to the guide." }],
        ],
        0,
      ),
      // Every scripted solver is the same model at the same price, so one names the setting of all.
      setting: campaign.setting({ ...campaign.test, ...scripted([], 0) }),
      solve: async (task, harness, kill, comparison) => {
        const side = await sideOf(harness.dir);
        const wanted = { old: script.held.old, new: script.held.fresh, starter: script.starter }[side];
        // A solve scripted to give no answer submits with none written, and needs none on record.
        // One scripted to answer a task with no answer on record gives none and is named at the
        // end as strayed: until 10 October it ended the campaign, and a rehearsal of the control
        // after a promotion (`onReference`) fell at the first task no solve had ever answered.
        const answer = wanted === "none" ? null : asRecord(answers.get(task.taskId)?.[wanted]);
        const missing = wanted !== "none" && answer === null;
        if (missing) {
          strayed.push(
            `${task.taskId} has no answer on record that the checks ${wanted === "pass" ? "accepted" : "rejected"}, so the script gave none`,
          );
        }
        const content = JSON.stringify(answer);
        const written: readonly [string, JsonObject] = (await selectedOf(harness.dir)).includes("write")
          ? ["write", { path: ANSWER_FILE, content }]
          : ["bash", { command: `printf %s ${shellQuote(content)} > ${ANSWER_FILE}` }];
        const by = scripted(
          [...(answer === null ? [] : [written]), ["submit", {}]],
          campaign.limits.turns + 1,
        );
        const done = await campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill, comparison);
        const { ending } = done;
        const failed = { pass: null, fail: "rejected", none: "no-answer" }[wanted];
        const held =
          failed === null ? ending.outcome === "pass" : ending.outcome === "fail" && ending.kind === failed;
        if (!held && !missing) {
          strayed.push(
            `${done.solve}: ${task.taskId} under the ${side === "starter" ? "starter" : `${side === "old" ? "reference" : "new"} harness`} was scripted to ${wanted === "none" ? "give no answer" : wanted} and ended ${JSON.stringify(ending)}`,
          );
        }
        return done;
      },
    };
  };
}

/** The answers a stored sweep graded as passes, for the script to write. */
function storedPasses(root: string, sweep: string): Control[] {
  return sweepRows(root, sweep).flatMap((row) => {
    const answer = row.ending.outcome === "pass" ? storedAnswer(row) : undefined;
    return answer === undefined ? [] : [{ taskId: row.taskId, answer, refusedBy: null }];
  });
}

/**
 * The answers a seed of a campaign that drafted its exam gives the script: the draft's controls,
 * from where the campaign staged them, and every answer the source campaign's checks passed, which
 * a seed cut before those solves no longer holds. Until 10 October a rehearsal took a stored pack
 * only, and no campaign run on the Linux host has one: every one of them drafted its exam.
 */
function draftedGraded(name: string): Control[] {
  const log = campaignLog(name);
  const staged = stagedExamOf(log);
  if (staged === null) {
    throw new Error(
      `name --root, --sweep and --bundle: campaign ${name} holds no exam of its own, and a rehearsal scripts answers from a stored pack or a drafted exam`,
    );
  }
  const seed = asRecord(capturedJsonParse(readFileSync(join(dirname(log), SEED_FILE), "utf8")));
  const source = isString(seed?.from) ? join(seed.from, LOG_FILE) : log;
  const passes = [...verdictsOf(read(source)).values()].flatMap(({ task, answer, checker }) =>
    task !== null && answer !== undefined && checker?.kind === "pass"
      ? [{ taskId: task, answer, refusedBy: null }]
      : [],
  );
  return [...packControls(staged.bundle), ...passes];
}

/** `bun run runs rehearse`. */
export async function rehearse(args: readonly string[]): Promise<void> {
  const { values, tokens } = parseArgs({
    args: [...args],
    strict: false,
    tokens: true,
    options: {
      held: { type: "string", default: "none:pass" },
      starter: { type: "string", default: "none" },
      "no-comparison": { type: "boolean", default: false },
      campaign: { type: "boolean", default: false },
      id: { type: "string" },
      root: { type: "string" },
      sweep: { type: "string" },
      bundle: { type: "string" },
      name: { type: "string" },
      builder: { type: "string" },
      solver: { type: "string" },
      reviewer: { type: "string" },
    },
  });
  const { held, root, sweep, bundle } = values;
  const least = isString(values.starter) ? endOf(values.starter) : undefined;
  const seated = (["builder", "solver", "reviewer"] as const).filter((seat) => values[seat] !== undefined);
  if (seated.length > 0) {
    // A reviewer named here would be a live one, reading scripted fails for money.
    throw new Error(`a rehearsal seats no model: drop --${seated.join(", --")}`);
  }
  const stored = [root, sweep, bundle].filter(isString).length;
  if (
    !isString(held) ||
    least === undefined ||
    (stored !== 0 && stored !== PACK_FLAGS) ||
    !isString(values.name)
  ) {
    throw new Error(
      "usage: bun run runs rehearse <the flags of tools/d2/round.ts, of tools/d2/checkpoint.ts, of tools/d2/session.ts with --no-comparison, or of tools/d2/harness-builder.ts with --campaign, that name no model> [--held old:new] [--starter pass|fail|none]",
    );
  }
  const graded =
    isString(root) && isString(sweep) && isString(bundle)
      ? [...storedPasses(root, sweep), ...packControls(bundle)]
      : draftedGraded(values.name);
  const strayed: string[] = [];
  const seats = scriptedSeats({ held: sidesOf(held), starter: least }, graded, strayed);
  const flags = passedOn(args, tokens, OWN);
  // A checkpoint is named by its `--id` and runs no session, so no Builder's script can stray, and
  // a campaign's sessions are its own to count.
  if (values.campaign === true) await harnessBuilder(flags, { seated: seats });
  else if (isString(values.id)) await checkpointCommand(flags, seats);
  else if (
    values["no-comparison"] === true
      ? (await sessionCommand(flags, seats)) === null
      : (await roundCommand(flags, seats)).fresh === null
  ) {
    strayed.push("the Builder's script left the harness as it was");
  }
  if (strayed.length === 0) {
    console.log("the rehearsal went as scripted");
    return;
  }
  for (const each of strayed) console.error(`⚠ ${each}`);
  console.error("the rehearsal did not go as scripted: read each named solve's trace in the log");
  runtimeProcess.exitCode = 1;
}

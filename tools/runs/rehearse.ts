/**
 * `bun run runs rehearse <the flags of tools/d2/round.ts that name no model> [--held none:pass] [--baseline none]`
 *
 * A round over a seeded campaign (`seed.ts`) with a script in each model seat and no model called.
 * Flags that hold `--id` are a checkpoint's, as a launch reads them, and rehearse one comparison
 * with no Builder session (`tools/d2/checkpoint.ts`): the plan's first experiment can be walked on
 * a seed this way before it is paid for, with `--held` scripting the reference harness and the
 * new one and `--baseline` the minimal baseline wherever it sits.
 * Everything under the seats is a paid round's: the campaign's log and sets, the Builder's tools on
 * the command wall and its freeze, each solve's wall and disk cap, the harness's own
 * artifact-writer, the verifier, the comparison and the report. It is `roundCommand` with other
 * seats, so its flags and defaults are the round's, but that it needs no `--cap`: a script is paid
 * nothing. The three flags that name a model are refused.
 *
 * The Builder's script adds one line to the harness's guide through its walled shell and finishes.
 * A solve's script ends one of three ways. For `pass` it hands the harness's artifact-writer an
 * answer on record that the checks accepted, and submits it. For `fail` it does the same with one
 * a check rejected. For `none` it submits with no answer prepared, as a solve that reached its
 * limits has none: not valid, and nothing for anyone to rule on. `--held` says how a solve of a
 * held-out task ends under the reference harness and under the new one, as `old:new`, and
 * `--baseline` how one ends under the minimal baseline, which is solved only when the comparison
 * reads a step. The defaults, `none:pass` and `none`, script a step.
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
import { type LogEvent, read } from "#src/kernel/log.ts";
import { verdictsOf } from "#src/kernel/solves.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { openHarness } from "#src/solve/harness.ts";
import { baseline } from "../d2/campaign.ts";
import { checkpointCommand } from "../d2/checkpoint.ts";
import { roundCommand, type Seated } from "../d2/round.ts";
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
/** The script of a rehearsal's solves: under the reference harness and the new, and under the baseline. */
interface Script {
  readonly held: Sides;
  readonly baseline: End;
}

const OWN = new Set(["held", "baseline"]);
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
export function endOf(word: string): End | undefined {
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
    const least = baseline(campaign);
    /** Each harness's artifact-writer by the harness's folder: the baseline's is not the cycle's. */
    const writers = new Map<string, Promise<string | undefined>>();
    const writerOf = (dir: string) => {
      const known =
        writers.get(dir) ??
        openHarness(dir).then(({ kinds }) => [...kinds].find(([, kind]) => kind === "artifact-writer")?.[0]);
      writers.set(dir, known);
      return known;
    };
    /** Which of the three a solve's harness is, as a strayed solve is named. */
    const sideOf = async (dir: string) =>
      dir === reference ? "old" : dir === (await least).dir ? "baseline" : "new";
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
      solve: async (task, harness, kill) => {
        const side = await sideOf(harness.dir);
        const wanted = { old: script.held.old, new: script.held.fresh, baseline: script.baseline }[side];
        // A solve scripted to give no answer submits with none prepared, and needs none on record.
        const answer = wanted === "none" ? null : asRecord(answers.get(task.taskId)?.[wanted]);
        const tool = await writerOf(harness.dir);
        if (wanted !== "none" && (answer === null || tool === undefined)) {
          throw new Error(
            `${task.taskId} has no answer on record that the checks ${wanted === "pass" ? "accepted" : "rejected"}, so no script can ${wanted} it`,
          );
        }
        const calls: (readonly [string, JsonObject])[] =
          answer === null || tool === undefined ? [] : [[tool, answer]];
        const by = scripted([...calls, ["submit", {}]], campaign.limits.turns + 1);
        const done = await campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill);
        const { ending } = done;
        const failed = { pass: null, fail: "rejected", none: "no-answer" }[wanted];
        const held =
          failed === null ? ending.outcome === "pass" : ending.outcome === "fail" && ending.kind === failed;
        if (!held) {
          strayed.push(
            `${done.solve}: ${task.taskId} under the ${side === "baseline" ? "baseline" : `${side === "old" ? "reference" : "new"} harness`} was scripted to ${wanted === "none" ? "give no answer" : wanted} and ended ${JSON.stringify(ending)}`,
          );
        }
        return done;
      },
    };
  };
}

/** `bun run runs rehearse`. */
export async function rehearse(args: readonly string[]): Promise<void> {
  const { values, tokens } = parseArgs({
    args: [...args],
    strict: false,
    tokens: true,
    options: {
      held: { type: "string", default: "none:pass" },
      baseline: { type: "string", default: "none" },
      id: { type: "string" },
      root: { type: "string" },
      sweep: { type: "string" },
      bundle: { type: "string" },
      builder: { type: "string" },
      solver: { type: "string" },
      reviewer: { type: "string" },
    },
  });
  const { held, root, sweep, bundle } = values;
  const least = isString(values.baseline) ? endOf(values.baseline) : undefined;
  const seated = (["builder", "solver", "reviewer"] as const).filter((seat) => values[seat] !== undefined);
  if (seated.length > 0) {
    // A reviewer named here would be a live one, reading scripted fails for money.
    throw new Error(`a rehearsal seats no model: drop --${seated.join(", --")}`);
  }
  if (!isString(held) || least === undefined || !isString(root) || !isString(sweep) || !isString(bundle)) {
    throw new Error(
      "usage: bun run runs rehearse <the flags of tools/d2/round.ts or of tools/d2/checkpoint.ts that name no model> [--held old:new] [--baseline pass|fail|none]",
    );
  }
  const passes = sweepRows(root, sweep).flatMap((row) => {
    const answer = row.ending.outcome === "pass" ? storedAnswer(row) : undefined;
    return answer === undefined ? [] : [{ taskId: row.taskId, answer, refusedBy: null }];
  });
  const strayed: string[] = [];
  const seats = scriptedSeats(
    { held: sidesOf(held), baseline: least },
    [...passes, ...packControls(bundle)],
    strayed,
  );
  const flags = passedOn(args, tokens, OWN);
  // A checkpoint is named by its `--id` and runs no session, so no Builder's script can stray.
  if (isString(values.id)) await checkpointCommand(flags, seats);
  else if ((await roundCommand(flags, seats)).fresh === null) {
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

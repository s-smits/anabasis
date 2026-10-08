/**
 * `bun run runs rehearse <the flags of tools/d2/round.ts that name no model> [--held fail:pass] [--anchor pass:pass]`
 *
 * A round over a seeded campaign (`seed.ts`) with a script in each model seat and no model called.
 * Everything under the seats is a paid round's: the campaign's log and sets, the Builder's tools on
 * the command wall and its freeze, each solve's wall and disk cap, the harness's own
 * artifact-writer, the verifier, the screening rule, the comparison and the report. It is
 * `roundCommand` with other seats, so its flags and defaults are the round's. The three flags that
 * name a model are refused: no reviewer reads a rehearsal's fails.
 *
 * The Builder's script adds one line to the harness's guide through its walled shell and finishes.
 * A solve's script hands the harness's artifact-writer an answer on record for the task and submits
 * it: an answer the checks accepted for a pass (the pack's accept control, or the answer a session's
 * stronger solve was accepted on), the task's first reject control for a fail. `--held` says how a
 * solve of a task outside the anchor ends under the old harness and under the new one, as
 * `old:new`, and `--anchor` the same for the anchor's tasks. The defaults script a step.
 *
 * It proves the joins and nothing of a model: that each command takes what the one before it left,
 * and that the readings come out as the script was written to make them. A scripted solve that
 * ends otherwise than scripted is named at the end, with exit code 1. Whether the script or the
 * path under it is at fault is then the finding to make.
 */
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { Control } from "#src/kernel/acceptance.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { taskVersion } from "#src/kernel/task.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { openHarness } from "#src/solve/harness.ts";
import { carriable, LIMITS, setsOf } from "../d2/campaign.ts";
import { roundCommand, type Seated } from "../d2/round.ts";
import { packControls, storedAnswer, sweepRows } from "../m0/stored-sweep.ts";
import { passedOn } from "./launch.ts";
import { SEED_FILE } from "./pulse.ts";

type End = "pass" | "fail";
/** How a scripted solve ends under the old harness and under the new one. */
interface Sides {
  readonly old: End;
  readonly fresh: End;
}
/** The script of a rehearsal's solves: of the tasks outside the anchor, and of the anchor's. */
interface Script {
  readonly held: Sides;
  readonly anchor: Sides;
}

const OWN = new Set(["held", "anchor"]);
const TOOL_USE = { stopReason: "toolUse" } as const;
/** A list price for the scripted model, which the meter refuses to run without: what a rehearsal
 *  meters is the script's own words at this price, and is no cost. */
const PRICE = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
/** The guide a scripted Builder writes on, from its home. */
const GUIDE = "harness/agent/BUILT_AGENTS.md";

/** `old:new` as a pair of endings. */
export function sidesOf(flag: string): Sides {
  const [old, fresh, ...more] = flag.split(":");
  if ((old !== "pass" && old !== "fail") || (fresh !== "pass" && fresh !== "fail") || more.length > 0) {
    throw new Error(`${flag}: say how a solve ends under the old harness and the new, as pass:fail`);
  }
  return { old, fresh };
}

/**
 * The answers on record for each task, by its id: the first the checks accepted and the first a
 * check refused. `graded` are the pack's, the accepted ones first: a stored solve the sweep graded
 * a pass comes before the pack's own accept control, which can be stale. On the truss pack every
 * accept control of the anchor's four tasks was refused by four to seven checks (2026-10-08). A
 * session's log answers for the tasks it wrote: the answer its stronger solve was accepted on, and
 * the controls gate 4 passed.
 */
export function answersOf(graded: readonly Control[], events: readonly LogEvent[]) {
  const written = carriable(events).feasible.flatMap(({ task, accepted, controls: set }) => [
    { taskId: task.taskId, answer: accepted, refusedBy: null },
    ...set.map(({ answer, expectedCheckId }) => ({
      taskId: task.taskId,
      answer,
      refusedBy: expectedCheckId,
    })),
  ]);
  const known = new Map<string, Partial<Record<End, JsonValue>>>();
  for (const { taskId, answer, refusedBy } of [...graded, ...written]) {
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
  return (campaign, { parent }) => {
    const folder = dirname(campaign.log);
    if (!existsSync(join(folder, SEED_FILE))) {
      throw new Error(
        `${folder} is no seed: a rehearsal writes scripted solves, which a campaign's next round would count. Copy it first with bun run runs seed`,
      );
    }
    const events = read(campaign.log);
    const anchor = new Set(setsOf(events).anchor);
    const answers = answersOf(graded, events);
    let writer: Promise<string | undefined> | undefined;
    return {
      builder: scripted(
        [
          ["bash", { command: `printf '\\nA rehearsal added this line.\\n' >> "$HOME/${GUIDE}"` }],
          ["finish", { note: "A rehearsal: one line added to the guide." }],
        ],
        0,
      ),
      solve: async (task, harness, kill) => {
        const sides = anchor.has(taskVersion(task)) ? script.anchor : script.held;
        const wanted = harness.dir === parent ? sides.old : sides.fresh;
        const answer = asRecord(answers.get(task.taskId)?.[wanted]);
        writer ??= openHarness(parent).then(
          ({ kinds }) => [...kinds].find(([, kind]) => kind === "artifact-writer")?.[0],
        );
        const tool = await writer;
        if (answer === null || tool === undefined) {
          throw new Error(
            `${task.taskId} has no answer on record that the checks ${wanted === "pass" ? "accepted" : "refused"}, so no script can ${wanted} it`,
          );
        }
        const by = scripted(
          [
            [tool, answer],
            ["submit", {}],
          ],
          LIMITS.turns + 1,
        );
        const done = await campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill);
        const { ending } = done;
        const held =
          wanted === "pass"
            ? ending.outcome === "pass"
            : ending.outcome === "fail" && ending.kind === "rejected";
        if (!held) {
          strayed.push(
            `${done.solve}: ${task.taskId} under the ${harness.dir === parent ? "old" : "new"} harness was scripted to ${wanted} and ended ${JSON.stringify(ending)}`,
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
      held: { type: "string", default: "fail:pass" },
      anchor: { type: "string", default: "pass:pass" },
      root: { type: "string" },
      sweep: { type: "string" },
      bundle: { type: "string" },
      builder: { type: "string" },
      solver: { type: "string" },
      reviewer: { type: "string" },
    },
  });
  const { held, anchor, root, sweep, bundle } = values;
  const seated = (["builder", "solver", "reviewer"] as const).filter((seat) => values[seat] !== undefined);
  if (seated.length > 0) {
    // A reviewer named here would be a live one, reading scripted fails for money.
    throw new Error(`a rehearsal seats no model: drop --${seated.join(", --")}`);
  }
  if (!isString(held) || !isString(anchor) || !isString(root) || !isString(sweep) || !isString(bundle)) {
    throw new Error(
      "usage: bun run runs rehearse <the flags of tools/d2/round.ts that name no model> [--held old:new] [--anchor old:new]",
    );
  }
  const passes = sweepRows(root, sweep).flatMap((row) => {
    const answer = row.ending.outcome === "pass" ? storedAnswer(row) : undefined;
    return answer === undefined ? [] : [{ taskId: row.taskId, answer, refusedBy: null }];
  });
  const strayed: string[] = [];
  const report = await roundCommand(
    passedOn(args, tokens, OWN),
    scriptedSeats(
      { held: sidesOf(held), anchor: sidesOf(anchor) },
      [...passes, ...packControls(bundle)],
      strayed,
    ),
  );
  if (report.fresh === null) strayed.push("the Builder's script left the harness as it was");
  if (strayed.length === 0) {
    console.log("the rehearsal went as scripted");
    return;
  }
  for (const each of strayed) console.error(`⚠ ${each}`);
  console.error("the rehearsal did not go as scripted: read each named solve's trace in the log");
  runtimeProcess.exitCode = 1;
}

/**
 * The tasks an old campaign's log holds, taken into another campaign, without a model.
 *
 *   bun tools/c/carry.ts --from .ana/d2/truss/log.jsonl --root ../anabasis-cycles-4c67fc \
 *     --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-repaired --name truss-2
 *
 * A changed contract starts a new campaign, and so does a repaired check program
 * (`accept.ts --freeze`): a task's version holds its check program, and a condition its contract.
 * A task an Examiner wrote is in no pack: it is in the old campaign's log, whole, and this takes it
 * from there. A pack's own task is in the old log by its id alone, and is taken from this
 * campaign's pack under the same id.
 *
 * Each task the old log does not hold as refused is proposed here under its own id and put to the
 * gate, the shape of its package under this campaign's contract and checks (`src/kernel/task.ts`).
 * A task that passes is a held-out task here, unless the old campaign ever released it for
 * practice: a Builder has seen it, and a harness it built may be compared here, so it is released
 * here as well and never scored, though the old campaign disputed it afterwards. A task the old
 * campaign disputed and never released is held out here: a dispute is a check found at fault on an
 * answer to it, which is what a repaired checker answers, so its answers are read again. Until
 * 12 October a pack's own task entered only through `prepare.ts`, which holds out every task its
 * log does not hold, so a pack's task released in the old campaign could be held out in the new
 * one (the overhaul plan's P10: every practice release preserved); and a disputed task was not
 * taken. Until 2026-10-09 a carried task also needed the answer its stronger solve was accepted on
 * and its three controls, both from the old log; neither exists now, so a task carries on its shape
 * alone.
 *
 * Nothing else is taken: no solve, no verdict, no comparison and no promotion. Run again, it takes
 * nothing twice. It needs the pack on disk.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import type { Contract } from "#src/kernel/contract.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { packageGate, type TaskPackage, taskStates, taskVersion } from "#src/kernel/task.ts";
import type { Task } from "#src/kernel/verify.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { openCampaign } from "../d2/campaign.ts";

/** What a campaign is to take tasks: its log, its contract, its pack's tasks and how a task is
 *  packaged under its check program (`openCampaign`). */
interface Taking {
  readonly log: string;
  readonly contract: Contract;
  readonly tasks: readonly Task[];
  readonly pack: (task: Task) => TaskPackage;
}

/** How each task of `source` went into `campaign`: held out, released, refused at the gate, or
 *  already there, one word a task, in the order the old log proposed them. */
function carryTasks(source: readonly LogEvent[], campaign: Taking): string[] {
  const { log, contract } = campaign;
  const was = taskStates(source);
  const practised = new Set(
    source.flatMap(({ kind, data }) =>
      kind === "task.state" && data.state === "released" && isString(data.version) ? [data.version] : [],
    ),
  );
  const own = new Map(campaign.tasks.map((task) => [task.taskId, task]));
  const known = taskStates(read(log));
  return proposalsOf(source).flatMap(({ version, taskId, task }) => {
    const whole = task ?? own.get(taskId ?? "");
    if (whole === undefined || was.get(version) === "refused") return [];
    const packaged = campaign.pack(whole);
    const carried = taskVersion(packaged);
    if (known.has(carried)) return ["already there"];
    const { family, publicInput, hidden } = whole;
    append(log, "task.proposed", {
      version: carried,
      taskId: whole.taskId,
      carried: version,
      // A pack's task is proposed by its id alone, as `prepare.ts` proposes it.
      ...keyIfDefined(
        "task",
        task === null ? undefined : { taskId: whole.taskId, family, publicInput, hidden },
      ),
    });
    known.set(carried, "held");
    const gated = packageGate(contract, packaged);
    append(log, "task.gate", { version: carried, gate: 1, ...gated });
    if (gated.outcome === "passed") {
      if (!practised.has(version)) return ["held out"];
      append(log, "task.state", { version: carried, state: "released" });
      return ["released"];
    }
    append(log, "task.state", { version: carried, state: "refused" });
    console.log(`  ${whole.taskId}\trefused: ${gated.reason}`);
    return ["refused"];
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      root: { type: "string" },
      sweep: { type: "string" },
      cycle: { type: "string" },
      bundle: { type: "string" },
      name: { type: "string" },
    },
  });
  const { from, root, sweep, cycle, bundle, name } = values;
  if (
    from === undefined ||
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined
  ) {
    throw new Error("name --from, --root, --sweep, --cycle, --bundle and --name");
  }
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const words = carryTasks(read(from), campaign);
  const counts = countBy(words, (word) => word);
  console.log(
    `${String(words.length)} tasks of the old campaign: ${String(counts["held out"] ?? 0)} held out here, ${String(counts.released ?? 0)} released for practice as they were, ${String(counts.refused ?? 0)} refused, ${String(counts["already there"] ?? 0)} already there`,
  );
}

if (import.meta.main) await main();

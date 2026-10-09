/**
 * The tasks an old campaign's sessions wrote, taken into another campaign, without a model.
 *
 *   bun tools/c/carry.ts --from .ana/d2/truss/log.jsonl --root ../anabasis-cycles-4c67fc \
 *     --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-repaired --name truss-2
 *
 * A changed contract starts a new campaign, and so does a repaired check program
 * (`accept.ts --freeze`): a task's version holds its check program, and a condition its contract.
 * The pack's own tasks enter the new campaign through `prepare.ts`. A task an Examiner wrote is in
 * no pack: it is in the old campaign's log, whole, and this takes it from there.
 *
 * Each task a session wrote that the old log does not hold as refused or disputed is proposed
 * here under its own id and put to the gate, the shape of its package under this campaign's
 * contract and checks (`src/kernel/task.ts`). A task that passes is a held-out task here. Until
 * 2026-10-09 a carried task also needed the answer its stronger solve was accepted on and its
 * three controls, both from the old log; neither exists now, so a task carries on its shape alone.
 *
 * Run again, it takes nothing twice. It needs the pack on disk.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import { append, read } from "#src/kernel/log.ts";
import { packageGate, taskStates, taskVersion } from "#src/kernel/task.ts";
import { parseArgs } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { openCampaign } from "../d2/campaign.ts";

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

async function main(): Promise<void> {
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
  const { log, contract } = campaign;
  const source = read(from);
  const was = taskStates(source);
  const known = taskStates(read(log));
  const words = proposalsOf(source).flatMap(({ version, task }) => {
    const state = was.get(version);
    if (task === null || state === "refused" || state === "disputed") return [];
    const packaged = campaign.pack(task);
    const carried = taskVersion(packaged);
    if (known.has(carried)) return ["already there"];
    const { taskId, family, publicInput, hidden } = task;
    append(log, "task.proposed", {
      version: carried,
      taskId,
      carried: version,
      task: { taskId, family, publicInput, hidden },
    });
    known.set(carried, "held");
    const gated = packageGate(contract, packaged);
    append(log, "task.gate", { version: carried, gate: 1, ...gated });
    if (gated.outcome === "passed") return ["held out"];
    append(log, "task.state", { version: carried, state: "refused" });
    console.log(`  ${taskId}\trefused: ${gated.reason}`);
    return ["refused"];
  });
  const counts = countBy(words, (word) => word);
  console.log(
    `${String(words.length)} tasks a session wrote: ${String(counts["held out"] ?? 0)} held out here, ${String(counts.refused ?? 0)} refused, ${String(counts["already there"] ?? 0)} already there`,
  );
}

await main();

/**
 * Set a campaign's tasks apart before any round: draw the anchor, then release the practice tasks.
 *
 *   bun tools/d2/prepare.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --anchor 24 --practice 6
 *
 * The order is the kernel's: the anchor is drawn first, from every feasible task still held, and a
 * task is released only after it and never out of it (`src/kernel/task.ts`). Both draws are seeded
 * by the contract's hash, which is fixed before the pool exists, so neither can be searched for and
 * both replay from the log. What is left held outside the anchor is what a round screens.
 *
 * Run it once the pack's tasks are in the log (`admit-sweep.ts --log ... --feasible`) and after any
 * Examiner session whose tasks should stand a chance of the anchor. Run again, it draws nothing:
 * an anchor already drawn is kept and only the releases still missing are made.
 *
 * Not run here: see `campaign.ts`.
 */
import { draw } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { append, read } from "#src/kernel/log.ts";
import { parseArgs } from "#src/meta/process.ts";
import { openCampaign, setsOf } from "./campaign.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    anchor: { type: "string", default: "24" },
    practice: { type: "string", default: "6" },
  },
});

async function main(): Promise<void> {
  const { root, sweep, cycle, bundle, name } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle and --name");
  }
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const seed = contractHash(campaign.contract);
  const before = setsOf(read(campaign.log));
  if (before.anchor.length === 0) {
    const tasks = draw(before.candidates, Number(values.anchor), `${seed}:anchor`);
    append(campaign.log, "anchor.drawn", { tasks, seed: `${seed}:anchor`, from: before.candidates.length });
  }
  const drawn = setsOf(read(campaign.log));
  const missing = Math.max(0, Number(values.practice) - drawn.released.length);
  for (const version of draw(drawn.candidates, missing, `${seed}:practice`)) {
    append(campaign.log, "task.state", { version, state: "released" });
  }
  const after = setsOf(read(campaign.log));
  console.log(
    `${String(after.feasible.length)} feasible: ${String(after.anchor.length)} anchor, ${String(after.released.length)} released for practice, ${String(after.candidates.length)} held for screening, ${String(after.admitted.length)} admitted`,
  );
}

await main();

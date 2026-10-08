/**
 * Set a campaign's tasks apart for its next round: draw the anchor, and release the practice tasks.
 *
 *   bun tools/d2/prepare.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --anchor 24 --practice 6
 *
 * Run it before each round. Both sets follow the campaign, as the scored set does
 * (`src/kernel/ladder.ts`), and what it finds already in place it leaves.
 *
 * The anchor is the set no screening chose. `--anchor` is the size it is brought to: what is
 * missing is drawn by the contract's hash from the feasible tasks held outside it, whatever any
 * solve showed of them. Tasks an Examiner wrote since the last draw therefore stand a chance of
 * it, and an anchor every task of which the campaign has got past is not left to read
 * `not-tested` for good. One draw takes at most half of what is held, so that a round is left
 * something to screen: on 2026-10-08 an anchor drawn over nearly the whole pack left eight rounds
 * no task to score. The order is the kernel's: a task is released only after the anchor is drawn
 * and never out of it (`src/kernel/task.ts`).
 *
 * Practice is what the Builder learns from, and a task its parent already passes teaches it
 * nothing. `--practice` is the number of released tasks the frontier is not known to clear. What
 * is missing is released from the pool: first from the tasks the frontier's solves on record
 * stop, at most half of them, since a released task is never scored again, and then from tasks no
 * solve has placed. Which are taken is drawn by the contract's hash. Before any solve nothing is
 * placed, and the draw is the blind one it always was.
 *
 * It ends by printing the ladder against the frontier and which compartment binds the climb now:
 * the harness, the tasks, the witness, the checks, the limits or the correctness model
 * (`src/kernel/binding.ts`). That is a reading for whoever chooses the next command.
 *
 * Not run here: see `campaign.ts`.
 */
import { binding } from "#src/kernel/binding.ts";
import { draw, sweepOf } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { ladder } from "#src/kernel/ladder.ts";
import { append, read } from "#src/kernel/log.ts";
import { parseArgs } from "#src/meta/process.ts";
import { frontier, openCampaign, SCREENING_OPTIONS, screeningRule, setsOf } from "./campaign.ts";
import { ROUND_OPTIONS } from "./round.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    anchor: { type: "string", default: "24" },
    practice: { type: "string", default: "6" },
    ...SCREENING_OPTIONS,
    level: ROUND_OPTIONS.level,
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
  const { log } = campaign;
  const seed = contractHash(campaign.contract);
  const rule = screeningRule(values);
  const kept = await frontier(campaign);
  const stands = { harness: kept.digest, setting: campaign.setting(campaign.test) };

  const before = setsOf(read(log));
  const wanted = Math.max(0, Number(values.anchor) - before.anchor.length);
  const drawn = Math.min(wanted, Math.floor(before.candidates.length / 2));
  if (drawn > 0) {
    append(log, "anchor.drawn", {
      tasks: draw(before.candidates, drawn, `${seed}:anchor`),
      seed: `${seed}:anchor`,
      from: before.candidates.length,
    });
  }
  if (drawn < wanted) {
    console.log(
      `the anchor is ${String(wanted - drawn)} short of ${values.anchor}: a draw takes at most half of the ${String(before.candidates.length)} held, so that a round has tasks to screen`,
    );
  }

  const placed = ladder(read(log), stands, rule);
  const missing = Math.max(0, Number(values.practice) - placed.practice.length);
  const stopping = draw(
    placed.pool.stops,
    Math.min(missing, Math.floor(placed.pool.stops.length / 2)),
    `${seed}:practice`,
  );
  const unread = draw(
    placed.pool.unknown,
    Math.min(missing - stopping.length, placed.pool.unknown.length),
    `${seed}:practice`,
  );
  for (const version of [...stopping, ...unread]) {
    append(log, "task.state", { version, state: "released" });
  }

  const sets = setsOf(read(log));
  const now = ladder(read(log), stands, rule);
  console.log(
    `${String(sets.feasible.length)} feasible: ${String(sets.anchor.length)} anchor, ${String(sets.released.length)} released for practice (${String(now.practice.length)} the frontier is not known to clear), ${String(sets.candidates.length + sets.admitted.length)} in the pool`,
  );
  console.log(
    `against the frontier ${stands.harness.slice(0, 8)}: ${String(now.pool.stops.length)} stop it, ${String(now.pool.clears.length)} it clears, ${String(now.pool.walled.length)} ended at the wall, ${String(now.pool.unknown.length)} no solve has placed; ${String(now.reach.length)} wait for a witness`,
  );
  // Which compartment is short, for whoever chooses the next command (`src/kernel/binding.ts`).
  const short = binding(read(log), stands, { rule, least: sweepOf(Number(values.level)) });
  console.log(`what binds: ${short.binds}. ${short.why}`);
}

await main();

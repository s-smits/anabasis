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
 * Name the `--solver`, `--solver-effort`, `--solve-minutes` and `--solve-turns` the next round
 * will run under (`setting.ts`): the ladder is read where that solver stands, and a campaign run
 * under two solvers has two sets of standings. Named otherwise than the round, this reads another
 * solver's: on 2026-10-08, when it took no such flag, it read seven tasks `no solve has placed`
 * after a round under another solver had placed all seven. It says so when the log's last
 * test-side solves ran as another solver or under other limits than the ones named here.
 *
 * Before either draw, it returns to the pool each task a round set aside as `wall-bound` under a
 * shorter wall than the one named here: the verdict was that the solver ran out of time, under
 * those limits, and it holds under no roomier ones (`src/kernel/limits.ts`). Under the defaults
 * nothing returns.
 *
 * It ends by printing the ladder against the frontier and four readings for whoever chooses the
 * next command. Whether the wall binds: what it has marked, and the share of it the solver's
 * passes and fails used (`src/kernel/wall.ts`). What a round of `--target`, `--solves` and
 * `--level` can show at this pool, before it runs, and what the rounds that fell short show
 * together (`src/kernel/size.ts`). And which compartment binds the climb now: the harness, the
 * measurement, the tasks, the witness, the checks, the limits or the correctness model
 * (`src/kernel/binding.ts`). None of them recommends a number, and none decides.
 *
 * Not run here: see `campaign.ts`.
 */
import { shortOfAStep } from "#src/builder/short.ts";
import { binding } from "#src/kernel/binding.ts";
import { draw, sweepOf } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { ladder } from "#src/kernel/ladder.ts";
import { append, read } from "#src/kernel/log.ts";
import { roundSize, shortLines, sizeLines } from "#src/kernel/size.ts";
import { priceKey } from "#src/kernel/meter.ts";
import { returning, solverLast, wallLine, wallReading } from "#src/kernel/wall.ts";
import { parseArgs } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { frontier, openCampaign, SCREENING_OPTIONS, screeningRule, setsOf } from "./campaign.ts";
import { ROUND_OPTIONS } from "./round.ts";
import { restarts, SETTING_OPTIONS, settingNamed } from "./setting.ts";

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
    ...SETTING_OPTIONS,
    level: ROUND_OPTIONS.level,
    target: ROUND_OPTIONS.target,
    solves: ROUND_OPTIONS.solves,
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
  const setting = settingNamed(values);
  const { limits } = setting;
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name, ...setting });
  const { log } = campaign;
  const seed = contractHash(campaign.contract);
  const rule = screeningRule(values);
  const kept = await frontier(campaign);
  const stands = { harness: kept.digest, setting: campaign.setting(campaign.test) };

  const back = returning(read(log), limits);
  for (const version of back) {
    append(log, "task.state", { version, state: "held", setting: stands.setting, limits });
  }
  if (back.length > 0) {
    console.log(
      `${plural(back.length, "wall-bound task")} returned to the pool: the wall named here is longer than the one that bound them, and no other limit is tighter`,
    );
  }

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
  // Whose standings those are, when the log's last solves were another solver's (`setting.ts`).
  const solver = { model: priceKey(campaign.test.model), effort: campaign.test.effort };
  for (const line of restarts({ solver, limits }, solverLast(read(log)))) console.log(line);
  const [level, target] = [Number(values.level), Number(values.target)];
  console.log(wallLine(wallReading(read(log), stands, { rule, limits }), limits));
  const size = roundSize(
    {
      stops: now.pool.stops.length,
      unplaced: now.pool.unknown.length,
      rest: now.pool.clears.length + now.pool.walled.length,
    },
    { target, solves: Number(values.solves), level },
  );
  const fell = shortOfAStep(read(log), level);
  for (const line of [...sizeLines(size), ...shortLines(fell.together, fell.bought)]) console.log(line);
  // Which compartment is short, for whoever chooses the next command (`src/kernel/binding.ts`).
  const short = binding(read(log), stands, { rule, least: sweepOf(level), target, limits });
  console.log(`what binds: ${short.binds}. ${short.why}`);
}

await main();

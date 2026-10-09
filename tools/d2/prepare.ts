/**
 * Set a campaign's tasks apart for its next comparison: hold the pack's tasks out, and release the
 * practice tasks.
 *
 *   bun tools/d2/prepare.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --practice 6
 *
 * Run it before a comparison. What it finds already in place it leaves.
 *
 * Each task of the pack that the log does not hold is proposed and put to its one gate, the shape
 * of its package (`src/kernel/task.ts`). A task that passes is a held-out task. No solve and no
 * stored answer has a say: until 2026-10-09 a pack's task entered a log through four gates, on a
 * stored cycle's answer and v1's controls for it (`tools/m1/admit-sweep.ts`, removed).
 *
 * Practice is what the Builder learns from, and a practice task is never scored. `--practice` is
 * the number of released tasks the campaign is brought to. What is missing is released from the
 * held-out tasks by the contract's draw, and no solve chooses which. One release takes at most
 * half of what is held, so that a comparison is left tasks to score: on 2026-10-08 an anchor drawn
 * over nearly the whole pack left eight rounds no task to score. Each release is said by its task.
 * A run that labels a task (below) releases none: a release cannot be taken back, and a person
 * labelling one task has not asked for another to leave the held-out set.
 *
 * It is also where a person labels a task that went to them as possibly infeasible: one no harness
 * answered validly in two comparisons in a row, which is left out of the scored set until it is
 * labelled (`src/kernel/reports.ts`, `awaitingLabel`). `--keep <task id>` returns it to the set,
 * and it is read again after two more comparisons without a valid answer. `--infeasible <task id>`
 * refuses it for good. Each may be given more than once, and each label is logged with the person's
 * `--note`.
 *
 * It ends by saying what a comparison of `--target` tasks, at `--solves` a side and `--level`, can
 * show at this supply, before it runs (`src/kernel/size.ts`), and which held-out tasks wait for a
 * label (`campaign.ts`, `awaitingLines`). It recommends no number and decides nothing.
 *
 * Not run here: see `campaign.ts`.
 */
import { draw } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { append, read } from "#src/kernel/log.ts";
import { awaitingLabel } from "#src/kernel/reports.ts";
import { sizeLines } from "#src/kernel/size.ts";
import { packageGate, taskSets, taskStates, taskVersion } from "#src/kernel/task.ts";
import { parseArgs } from "#src/meta/process.ts";
import { awaitingLines, openCampaign } from "./campaign.ts";
import { ROUND_OPTIONS, targetNamed } from "./round.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    practice: { type: "string", default: "6" },
    level: ROUND_OPTIONS.level,
    target: ROUND_OPTIONS.target,
    solves: ROUND_OPTIONS.solves,
    keep: { type: "string", multiple: true },
    infeasible: { type: "string", multiple: true },
    note: { type: "string" },
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
  const { log, contract } = campaign;

  const known = taskStates(read(log));
  const fresh = campaign.tasks.map(campaign.pack).filter((task) => !known.has(taskVersion(task)));
  let refused = 0;
  for (const task of fresh) {
    const version = taskVersion(task);
    append(log, "task.proposed", { version, taskId: task.taskId });
    const packaged = packageGate(contract, task);
    append(log, "task.gate", { version, gate: 1, ...packaged });
    if (packaged.outcome === "refused") {
      refused += 1;
      append(log, "task.state", { version, state: "refused" });
      console.log(`${task.taskId}: refused: ${packaged.reason}`);
    }
  }
  if (fresh.length > 0) {
    console.log(
      `${String(fresh.length)} of the pack's tasks proposed: ${String(fresh.length - refused)} held out, ${String(refused)} refused`,
    );
  }

  const packages = campaign.packages();
  const labels = [
    ...(values.keep ?? []).map((taskId) => ({ taskId, state: "held" })),
    ...(values.infeasible ?? []).map((taskId) => ({ taskId, state: "refused" })),
  ];
  const target = targetNamed(values.target);
  const practice = Number(values.practice);
  if (!Number.isInteger(practice) || practice < 0) {
    throw new Error(`--practice ${values.practice}: the practice tasks are a whole number`);
  }
  const before = taskSets(read(log));
  const missing = labels.length > 0 ? 0 : Math.max(0, practice - before.released.length);
  const released = Math.min(missing, Math.floor(before.held.length / 2));
  const seed = `${contractHash(contract)}:practice`;
  for (const version of draw(before.held, released, seed)) {
    append(log, "task.state", { version, state: "released" });
    console.log(`${packages.get(version)?.taskId ?? version}: released for practice, and never scored`);
  }
  if (released < missing) {
    console.log(
      `practice is ${String(missing - released)} short of ${values.practice}: a release takes at most half of the ${String(before.held.length)} held out, so that a comparison has tasks to score`,
    );
  }

  // A person's labels of the tasks that went to them. Only a held-out task is labelled: a label
  // on any other would return to the set, or refuse, a task no comparison has left out.
  for (const { taskId, state } of labels) {
    const version = [...packages].find(([, task]) => task.taskId === taskId)?.[0];
    if (version === undefined || !taskSets(read(log)).held.includes(version)) {
      throw new Error(`${taskId} is no held-out task of this campaign, and only one is labelled`);
    }
    append(log, "task.state", {
      version,
      state,
      reason: `a person read the task as ${state === "held" ? "feasible" : "infeasible"}${values.note === undefined ? "" : `: ${values.note}`}`,
    });
    console.log(`${taskId}: ${state === "held" ? "kept in the scored set" : "refused as infeasible"}`);
  }

  const events = read(log);
  const sets = taskSets(events);
  const awaiting = awaitingLabel(events).filter((version) => sets.held.includes(version));
  console.log(`${String(sets.held.length)} held out, ${String(sets.released.length)} released for practice`);
  const scored = Math.min(target, sets.held.length - awaiting.length);
  const asked = { solves: Number(values.solves), level: Number(values.level) };
  for (const line of [...sizeLines(scored, asked), ...awaitingLines(campaign)]) console.log(line);
}

await main();

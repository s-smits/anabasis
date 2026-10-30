/**
 * Set a campaign's tasks apart for its next comparison: hold the pack's tasks out, release the
 * practice tasks, and report the size of the scored draw.
 *
 *   bun tools/d2/prepare.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --practice 6
 *
 * Run it before a comparison. What it finds already in place it leaves. It is the plan's set-up of
 * the first round (`7f0add79:docs/plan.md`, Phase 0).
 *
 * Each task of the pack that the log does not hold is proposed and put to the shape check
 * of its package (`src/kernel/task.ts`). A task that passes is a held-out task. No solve and no
 * stored answer has a say: until 2026-10-09 a pack's task entered a log through four admission checks, on a
 * stored cycle's answer and v1's control answers for it (`tools/m1/admit-sweep.ts`, removed).
 *
 * A stored answer does say whether a task has a known valid answer. Each held-out task the
 * stored sweep accepted an answer to is rechecked under today's checks, until one passes, and a
 * pass is logged as `task.feasible`, as an author's answer is: such a task is never read as
 * possibly infeasible (`poolOf`). A recheck that fails establishes nothing and is said nowhere.
 * Until 14 October a pack's task had no answer on record until a solve of a comparison gave one.
 *
 * Practice is what the Builder learns from, and a practice task is never scored. `--practice` is
 * the number of released tasks the campaign is brought to. What is missing is released from the
 * held-out tasks by the contract's draw, and no solve chooses which. One release takes at most
 * half of what is held, so that a comparison is left tasks to score: on 2026-10-08 an anchor drawn
 * over nearly the whole pack left eight rounds no task to score. Each release is said by its task.
 * A task that a comparison scored before its release keeps that comparison's solves on the exam
 * side: a Builder is shown its practice solves only (`practiceRan`, `src/kernel/solves.ts`).
 * A run that labels a task (below) releases none: a release cannot be taken back, and a person
 * labelling one task has not asked for another to leave the held-out set.
 *
 * It is also where a person labels a task awaiting task review as possibly infeasible: one with no
 * valid answer on record after two comparisons that cut no solve of it at a limit, which is left
 * out of the scored set until it is labelled (`src/kernel/reports.ts`, `poolOf`). `--keep <task id>` returns it to the set,
 * and it is read again after two more comparisons without a valid answer. `--infeasible <task id>`
 * refuses it for good. Each may be given more than once, and each label is logged with the person's
 * `--note`.
 *
 * It ends by saying what a comparison of `--target` tasks, at the setting's solves a side and
 * `--level`, can show at this supply, before it runs (`src/kernel/size.ts`), and which held-out
 * tasks wait for a label (`campaign.ts`, `awaitingLines`). It recommends no number and decides
 * nothing.
 *
 * Not run here: see `campaign.ts`.
 */
import { contractHash } from "#src/kernel/contract.ts";
import { append, read } from "#src/kernel/log.ts";
import { poolOf, releaseOrder } from "#src/kernel/reports.ts";
import { SIZE, sizeLines } from "#src/kernel/size.ts";
import { packageGate, taskSets, taskStates, taskVersion } from "#src/kernel/task.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { storedAnswer, sweepRows } from "../m0/stored-sweep.ts";
import { awaitingLines, openCampaign, packNamed } from "./campaign.ts";
import { ROUND_OPTIONS } from "./round.ts";
import { recordedSetting, targetNamed } from "./setting.ts";

/** The practice tasks a campaign is brought to where no command names a count. */
export const PRACTICE = 6;
const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  practice: { type: "string", default: String(PRACTICE) },
  level: ROUND_OPTIONS.level,
  target: ROUND_OPTIONS.target,
  keep: { type: "string", multiple: true },
  infeasible: { type: "string", multiple: true },
  note: { type: "string" },
} as const;

/** `bun tools/d2/prepare.ts`. */
export async function prepareCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { root, sweep } = values;
  const campaign = await openCampaign(packNamed(values));
  const { log, contract } = campaign;

  const known = taskStates(read(log));
  const fresh = campaign.tasks.map(campaign.pack).filter((task) => !known.has(taskVersion(task)));
  let refused = 0;
  for (const task of fresh) {
    const version = taskVersion(task);
    append(log, "task.proposed", { version, taskId: task.taskId, family: task.family });
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
  // Each held-out task an answer the stored sweep accepted is rechecked for, under today's checks.
  const accepted = new Map<string, JsonValue[]>();
  // An exam drafted from a prompt has no stored sweep behind it, and so no stored answer.
  for (const row of root === undefined || sweep === undefined ? [] : sweepRows(root, sweep)) {
    const answer = row.ending.outcome === "pass" ? storedAnswer(row) : undefined;
    if (answer !== undefined) accepted.set(row.taskId, [...(accepted.get(row.taskId) ?? []), answer]);
  }
  const knownValid = poolOf(read(log)).feasible;
  for (const version of taskSets(read(log)).held) {
    const task = packages.get(version);
    if (task === undefined) continue;
    const { taskId } = task;
    if (knownValid.has(version) || !accepted.has(taskId)) continue;
    for (const answer of accepted.get(taskId) ?? []) {
      if ((await campaign.verify(task, answer)).kind !== "pass") continue;
      append(log, "task.feasible", { version, ...keyIfDefined("sweep", sweep) });
      console.log(
        `${taskId}: a stored accepted answer passes today's verifier, so a valid answer to it is on record`,
      );
      break;
    }
  }

  const labels = [
    ...(values.keep ?? []).map((taskId) => ({ taskId, state: "held" })),
    ...(values.infeasible ?? []).map((taskId) => ({ taskId, state: "refused" })),
  ];
  // The size it speaks of is the campaign's recorded one, where the command names none.
  const recorded = recordedSetting(read(campaign.log));
  const target = targetNamed(values.target ?? String(recorded?.target ?? SIZE.tasks));
  const practice = Number(values.practice);
  if (!Number.isInteger(practice) || practice < 0) {
    throw new Error(`--practice ${values.practice}: the practice tasks are a whole number`);
  }
  const before = taskSets(read(log));
  const pool = before.held;
  const missing = labels.length > 0 ? 0 : Math.max(0, practice - before.released.length);
  const released = Math.min(missing, Math.floor(pool.length / 2));
  for (const [version, why] of releaseOrder(
    read(log),
    pool,
    released,
    `${contractHash(contract)}:practice`,
  )) {
    append(log, "task.state", { version, state: "released" });
    console.log(`${packages.get(version)?.taskId ?? version}${why} released for practice, and never scored`);
  }
  if (released < missing) {
    console.log(
      `practice is ${String(missing - released)} short of ${values.practice}: a release takes at most half of the ${String(pool.length)} held out, so that a comparison has tasks to score`,
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
  console.log(`${String(sets.held.length)} held out, ${String(sets.released.length)} released for practice`);
  // What a comparison would score: the tasks the draw can take (`scoredSet`).
  const scored = Math.min(target, poolOf(events).scorable.length);
  const asked = { level: Number(values.level) };
  for (const line of [...sizeLines(scored, asked), ...awaitingLines(campaign)]) console.log(line);
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await prepareCommand(Bun.argv.slice(2));

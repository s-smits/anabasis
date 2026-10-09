/**
 * Set a campaign's tasks apart for its next comparison: hold the pack's tasks out, release the
 * practice tasks, and confirm the tasks the operator means to score.
 *
 *   bun tools/d2/prepare.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --practice 6 \
 *     --tasks <eight task ids>
 *
 * Run it before a comparison. What it finds already in place it leaves. It is the plan's set-up of
 * the first round (`docs/plan.md`, Phase 0).
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
 * `--tasks` names the tasks the next comparison is to score, by id, as `round.ts --tasks` then
 * takes them. A named task is never released here, and nor is one the campaign's recorded setting
 * names to score where this command names none: a release cannot be taken back. A task is held out on the shape of its package
 * alone, so each named task is first confirmed against today's verifier: an answer the stored
 * sweep accepted for it must still pass, so that a rejection of it means something. On 2026-10-08
 * all 35 accept controls of the truss pack failed (`docs/transfer.md`). It says of each task
 * whether a stored accepted answer passes, is rejected and by which checks, or does not exist, and
 * exits 1 unless every one passes. It writes none of this to the log and decides nothing: the
 * operator names other tasks, or has the check program read (`tools/c/accept.ts`). The verifier
 * runs behind its wall, so this part needs the host's sandbox.
 *
 * It is also where a person labels a task that went to them as possibly infeasible: one with no
 * valid answer on record after two comparisons that cut no solve of it at a limit, which is left
 * out of the scored set until it is labelled (`src/kernel/reports.ts`, `awaitingLabel`). `--keep <task id>` returns it to the set,
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
import type { JsonValue } from "#src/meta/json-shape.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { storedAnswer, sweepRows } from "../m0/stored-sweep.ts";
import { awaitingLines, openCampaign, packNamed } from "./campaign.ts";
import { type Campaign, ROUND_OPTIONS, scoredNamed } from "./round.ts";
import { recordedSetting, targetNamed } from "./setting.ts";

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  practice: { type: "string", default: "6" },
  level: ROUND_OPTIONS.level,
  target: ROUND_OPTIONS.target,
  solves: ROUND_OPTIONS.solves,
  tasks: ROUND_OPTIONS.tasks,
  keep: { type: "string", multiple: true },
  infeasible: { type: "string", multiple: true },
  note: { type: "string" },
} as const;

/**
 * What today's verifier says of the answers the stored sweep accepted for task `version`, in one
 * line, and whether one of them still passes. The first that passes confirms the task.
 */
async function confirmed(campaign: Campaign, version: string, accepted: ReadonlyMap<string, JsonValue[]>) {
  const task = campaign.packages().get(version);
  const answers = accepted.get(task?.taskId ?? "") ?? [];
  if (task === undefined || answers.length === 0) {
    return {
      passes: false,
      line: `${task?.taskId ?? version}: the stored sweep accepted no answer to it, so nothing confirms its checks`,
    };
  }
  const said: string[] = [];
  for (const answer of answers) {
    const verdict = await campaign.verify(task, answer);
    if (verdict.kind === "pass") {
      return { passes: true, line: `${task.taskId}: a stored accepted answer passes today's verifier` };
    }
    said.push(
      verdict.kind === "fail"
        ? `rejected by ${verdict.blocking.join(", ")}`
        : `not decided: ${verdict.kind === "faulty" ? `${verdict.check} is faulty, ${verdict.reason}` : verdict.reason}`,
    );
  }
  return {
    passes: false,
    line: `${task.taskId}: no stored accepted answer passes today's verifier (${[...new Set(said)].join("; ")}): a rejection of an answer to it would say nothing of the answer`,
  };
}

/** `bun tools/d2/prepare.ts`. It returns the command's exit code: 1 where a task named to score
 *  has no stored accepted answer that passes today's verifier. */
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
  // The size it speaks of is the campaign's recorded one, where the command names none.
  const recorded = recordedSetting(read(campaign.log));
  const target = targetNamed(values.target ?? String(recorded?.target ?? 12));
  const practice = Number(values.practice);
  if (!Number.isInteger(practice) || practice < 0) {
    throw new Error(`--practice ${values.practice}: the practice tasks are a whole number`);
  }
  const before = taskSets(read(log));
  // The tasks the operator names to score, each a held-out task, are no practice.
  const named = values.tasks === undefined ? [] : scoredNamed(campaign, values.tasks, target);
  const stray = named.find((version) => !before.held.includes(version));
  if (stray !== undefined) {
    throw new Error(
      `--tasks ${packages.get(stray)?.taskId ?? stray}: the task is ${before.states.get(stray) ?? "not proposed"}, and only a held-out task is scored`,
    );
  }
  const kept = values.tasks === undefined ? recorded?.tasks?.join(",") : undefined;
  const spoken = kept === undefined ? named : scoredNamed(campaign, kept, target);
  const pool = before.held.filter((version) => !spoken.includes(version));
  const missing = labels.length > 0 ? 0 : Math.max(0, practice - before.released.length);
  const released = Math.min(missing, Math.floor(pool.length / 2));
  const seed = `${contractHash(contract)}:practice`;
  for (const version of draw(pool, released, seed)) {
    append(log, "task.state", { version, state: "released" });
    console.log(`${packages.get(version)?.taskId ?? version}: released for practice, and never scored`);
  }
  if (released < missing) {
    console.log(
      `practice is ${String(missing - released)} short of ${values.practice}: a release takes at most half of the ${String(pool.length)} held out${spoken.length === 0 ? "" : " and not named to score"}, so that a comparison has tasks to score`,
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
  const scored = named.length > 0 ? named.length : Math.min(target, sets.held.length - awaiting.length);
  const asked = { solves: Number(values.solves), level: Number(values.level) };
  for (const line of [...sizeLines(scored, asked), ...awaitingLines(campaign)]) console.log(line);
  if (named.length === 0) return 0;

  // Each named task against today's verifier, on the answers the stored sweep accepted for it.
  const accepted = new Map<string, JsonValue[]>();
  // An exam drafted from a prompt has no stored sweep behind it, and so no stored answer.
  for (const row of root === undefined || sweep === undefined ? [] : sweepRows(root, sweep)) {
    const answer = row.ending.outcome === "pass" ? storedAnswer(row) : undefined;
    if (answer !== undefined) accepted.set(row.taskId, [...(accepted.get(row.taskId) ?? []), answer]);
  }
  let open = 0;
  for (const version of named) {
    const { passes, line } = await confirmed(campaign, version, accepted);
    console.log(line);
    open += passes ? 0 : 1;
  }
  console.log(
    open === 0
      ? `each of the ${String(named.length)} tasks named to score has a stored accepted answer that passes today's verifier`
      : `${String(open)} of the ${String(named.length)} tasks named to score have no stored accepted answer that passes today's verifier: name others, or have the check program read (tools/c/accept.ts)`,
  );
  return open > 0 ? 1 : 0;
}

if (import.meta.main) runtimeProcess.exitCode = await prepareCommand(Bun.argv.slice(2));

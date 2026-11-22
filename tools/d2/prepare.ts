/**
 * Set a campaign's tasks apart for its next comparison: hold the pack's tasks out, release the
 * practice tasks, and report the size of the scored draw.
 *
 *   bun tools/d2/prepare.ts --name <campaign> --practice 6
 *
 * It is also where a person labels a task awaiting task review as possibly infeasible: one with no
 * valid answer on record after two comparisons that cut no solve of it at a limit, which is left
 * out of the scored set until it is labelled (`src/kernel/reports.ts`, `poolOf`). `--keep <task id>` returns it to the set,
 * and it is read again after two more comparisons without a valid answer. `--infeasible <task id>`
 * refuses it for good. Each may be given more than once, and each label is logged with the person's
 * `--note`.
 */
import { contractHash } from "#src/kernel/contract.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { poolOf, releaseOrder } from "#src/kernel/reports.ts";
import { SIZE, sizeLines } from "#src/kernel/size.ts";
import { admissionsOf, packageGate, taskSets, taskStates, taskVersion } from "#src/kernel/task.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { feasibleOf } from "#src/examiner/write.ts";
import { textFiles } from "#src/kernel/answer-files.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { awaitingLines, openCampaign, PACK_OPTIONS, packNamed } from "./campaign.ts";
import { exampleId } from "./exam.ts";
import { type Campaign, COMPARISON_OPTIONS } from "./round.ts";
import { recordedSetting, targetNamed } from "./setting.ts";

/** The practice tasks a campaign is brought to where no command names a count. */
export const PRACTICE = 6;
const OPTIONS = {
  ...PACK_OPTIONS,
  practice: { type: "string", default: String(PRACTICE) },
  level: COMPARISON_OPTIONS.level,
  target: COMPARISON_OPTIONS.target,
  keep: { type: "string", multiple: true },
  infeasible: { type: "string", multiple: true },
  note: { type: "string" },
} as const;

/** The pack's tasks no gate has read: those the log does not hold, and one a killed command proposed
 *  and left before its gate, which the task states hold from its proposal on. */
export function ungated(campaign: Pick<Campaign, "tasks" | "pack">, events: readonly LogEvent[]) {
  const gated = admissionsOf(events);
  return campaign.tasks.map(campaign.pack).filter((task) => !gated.has(taskVersion(task)));
}

/**
 * `bun tools/d2/prepare.ts`. `heldBack`, the host's own release (`releaseOwed`), is read on the events
 * the release takes its tasks from, with no wait between that read and its appends: read before
 * this awaited the campaign's opening, a comparison that started meanwhile could lose a task it had
 * just drawn, after its terms were fixed (rule 4).
 */
export async function prepareCommand(
  args: readonly string[],
  heldBack: (events: readonly LogEvent[]) => boolean = () => false,
): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const campaign = await openCampaign(packNamed(values));
  const { log, contract } = campaign;

  const opened = read(log);
  const known = taskStates(opened);
  const fresh = ungated(campaign, opened);
  let refused = 0;
  for (const task of fresh) {
    const version = taskVersion(task);
    if (!known.has(version)) {
      append(log, "task.proposed", { version, taskId: task.taskId, family: task.family });
    }
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
  // Each held-out task an accept control of the drafted exam answers is rechecked for, under
  // today's checks.
  const accepted = Map.groupBy(
    (draftOf(opened)?.accept ?? []).map(({ task, answer, files }) => ({
      taskId: exampleId(task),
      answer,
      files: textFiles(files ?? []),
    })),
    ({ taskId }) => taskId,
  );
  const knownValid = poolOf(read(log)).feasible;
  for (const version of taskSets(read(log)).held) {
    const task = packages.get(version);
    if (task === undefined) continue;
    const { taskId } = task;
    if (knownValid.has(version) || !accepted.has(taskId)) continue;
    for (const { answer, files } of accepted.get(taskId) ?? []) {
      const verdict = await campaign.verify(task, answer, undefined, files);
      if (verdict.kind !== "pass") continue;
      append(log, "task.feasible", { version, ...feasibleOf(log, contract, verdict, answer, files) });
      console.log(
        `${taskId}: an accepted answer passes today's verifier, so a valid answer to it is on record`,
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
  const now = read(log);
  const before = taskSets(now);
  const pool = poolOf(now).practicePool;
  const missing = labels.length > 0 || heldBack(now) ? 0 : Math.max(0, practice - before.released.length);
  const released = Math.min(missing, Math.floor(pool.length / 2));
  for (const [version, why] of releaseOrder(now, pool, released, `${contractHash(contract)}:practice`)) {
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
  for (const line of [...sizeLines(scored, Number(values.level)), ...awaitingLines(campaign)]) {
    console.log(line);
  }
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await prepareCommand(Bun.argv.slice(2));

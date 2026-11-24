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
import { draftOf } from "#src/examiner/draft.ts";
import { feasibleOf } from "#src/examiner/write.ts";
import { textFiles } from "#src/kernel/answer-files.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { append, type EventKind, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { poolOf, releaseOrder } from "#src/kernel/reports.ts";
import { SIZE, sizeLines } from "#src/kernel/size.ts";
import { admissionsOf, packageGate, taskSets, taskStates, taskVersion } from "#src/kernel/task.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { awaitingLines, openCampaign, PACK_OPTIONS, packNamed } from "./campaign.ts";
import { exampleId } from "./exam.ts";
import { type Campaign, COMPARISON_OPTIONS } from "./round.ts";
import { recordedSetting, targetNamed } from "./setting.ts";

type Recorder = (kind: EventKind, data: Parameters<typeof append>[2]) => void;
type Packages = ReadonlyMap<string, ReturnType<Campaign["pack"]>>;
type LabelEntry = readonly [string, "held" | "refused", string, string];

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

function proposeUngated(campaign: Campaign, events: readonly LogEvent[], record: Recorder): void {
  const [known, fresh] = [taskStates(events), ungated(campaign, events)];
  let refused = 0;
  for (const task of fresh) {
    const version = taskVersion(task);
    if (!known.has(version)) record("task.proposed", { version, taskId: task.taskId, family: task.family });
    const packaged = packageGate(campaign.contract, task);
    record("task.gate", { version, gate: 1, ...packaged });
    if (packaged.outcome === "refused") {
      refused += 1;
      record("task.state", { version, state: "refused" });
      console.log(`${task.taskId}: refused: ${packaged.reason}`);
    }
  }
  if (fresh.length > 0) {
    console.log(
      `${String(fresh.length)} of the pack's tasks proposed: ${String(fresh.length - refused)} held out, ${String(refused)} refused`,
    );
  }
}

async function verifyAccepted(
  campaign: Campaign,
  events: readonly LogEvent[],
  packages: Packages,
  record: Recorder,
): Promise<boolean> {
  const accepted = Map.groupBy(
    (draftOf(events)?.accept ?? []).map(({ task, answer, files }) => ({
      taskId: exampleId(task),
      answer,
      files: textFiles(files ?? []),
    })),
    ({ taskId }) => taskId,
  );
  const [before, currentPool] = [taskSets(events), poolOf(events)];
  let awaited = false;
  for (const version of before.held) {
    const task = packages.get(version);
    if (task === undefined || currentPool.feasible.has(version) || !accepted.has(task.taskId)) continue;
    for (const { answer, files } of accepted.get(task.taskId) ?? []) {
      awaited = true;
      const verdict = await campaign.verify(task, answer, undefined, files);
      if (verdict.kind !== "pass") continue;
      record("task.feasible", {
        version,
        ...feasibleOf(campaign.log, campaign.contract, verdict, answer, files),
      });
      console.log(
        `${task.taskId}: an accepted answer passes today's verifier, so a valid answer to it is on record`,
      );
      break;
    }
  }
  return awaited;
}

function applyLabels(
  packages: Packages,
  events: readonly LogEvent[],
  input: {
    readonly labels: readonly LabelEntry[];
    readonly note: string | undefined;
    readonly record: Recorder;
  },
): void {
  if (input.labels.length === 0) return;
  const versionById = new Map<string, string>();
  for (const [version, task] of packages) {
    if (!versionById.has(task.taskId)) versionById.set(task.taskId, version);
  }
  const held = new Set(taskSets(events).held);
  for (const [taskId, state, verdict, said] of input.labels) {
    const version = versionById.get(taskId);
    if (version === undefined || !held.has(version)) {
      throw new Error(`${taskId} is no held-out task of this campaign, and only one is labelled`);
    }
    input.record("task.state", {
      version,
      state,
      reason: `a person read the task as ${verdict}${input.note === undefined ? "" : `: ${input.note}`}`,
    });
    if (state === "refused") held.delete(version);
    console.log(`${taskId}: ${said}`);
  }
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
  const practice = Number(values.practice);
  if (!Number.isInteger(practice) || practice < 0) {
    throw new Error(`--practice ${values.practice}: the practice tasks are a whole number`);
  }
  const campaign = await openCampaign(packNamed(values));
  const { log, contract } = campaign;
  let events = read(log, TRACE_KINDS);
  const record: Recorder = (kind, data) => {
    events.push(append(log, kind, data));
  };
  proposeUngated(campaign, events, record);

  const packages = campaign.packages();
  if (await verifyAccepted(campaign, events, packages, record)) events = read(log, TRACE_KINDS);
  const [before, currentPool] = [taskSets(events), poolOf(events)];

  const labels: LabelEntry[] = [
    ...(values.keep ?? []).map((taskId) => [taskId, "held", "feasible", "kept in the scored set"] as const),
    ...(values.infeasible ?? []).map(
      (taskId) => [taskId, "refused", "infeasible", "refused as infeasible"] as const,
    ),
  ];
  const target = targetNamed(values.target ?? String(recordedSetting(events)?.target ?? SIZE.tasks));
  const pool = currentPool.practicePool;
  const missing = labels.length > 0 || heldBack(events) ? 0 : Math.max(0, practice - before.released.length);
  const released = Math.min(missing, Math.floor(pool.length / 2));
  for (const [version, why] of releaseOrder(events, pool, released, `${contractHash(contract)}:practice`)) {
    record("task.state", { version, state: "released" });
    console.log(`${packages.get(version)?.taskId ?? version}${why} released for practice, and never scored`);
  }
  if (released < missing) {
    console.log(
      `practice is ${String(missing - released)} short of ${values.practice}: a release takes at most half of the ${String(pool.length)} held out, so that a comparison has tasks to score`,
    );
  }

  applyLabels(packages, events, { labels, note: values.note, record });
  const sets = taskSets(events);
  console.log(`${String(sets.held.length)} held out, ${String(sets.released.length)} released for practice`);
  const scored = Math.min(target, poolOf(events).scorable.length);
  for (const line of [...sizeLines(scored, Number(values.level)), ...awaitingLines(campaign)]) {
    console.log(line);
  }
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await prepareCommand(Bun.argv.slice(2));

/**
 * One Examiner session over a campaign:
 *
 *   bun tools/d1b/examine.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session x-1 \
 *     --examiner claude/claude-opus-5-5
 *
 * The Examiner writes task instances against the pack's contract and check program. Each is put to
 * the one gate, the shape of its package, and since 12 October to the reference harness's solves:
 * `TRIED` fresh solves of it under the campaign's setting, and it is a held-out task where some of
 * them gave a valid answer and not all (`try_task`, `src/examiner/write.ts`). The session is shown every task the campaign holds, the pack's own
 * and the ones earlier sessions wrote, and the opening message says one outcome of each: how the
 * reference harness did on it in the last comparison that scored it, disputed, or no longer
 * scored, and whether a valid answer to it is on record, with those tasks counted by family beside
 * the lines (`src/examiner/record.ts`, 11 October). The home the
 * last session computed in, and what it said at its finish, are carried into this one, and its
 * shell runs the engines the pack's checks run (12 October).
 *
 * The solves are the reference harness's alone, through the launcher a comparison uses, under the
 * setting it records where the log holds none (`--solver`, `--solve-minutes` and the rest, as every
 * command that solves takes them). Each solve's start names the session, so no comparison counts
 * it and no Builder is shown it, and the gate's event carries what the task's solves billed. The
 * Examiner hears how many of them were valid and nothing else of them.
 * Since 14 October a submitted rejection is ruled by the campaign's Referee before the gate counts
 * it. An unclear, defective or unruled rejection leaves the draft unmeasured; other endings keep
 * their meaning. Neither the answer nor the ruling reaches the Examiner.
 * From 9 to 12 October no solve ran here, and a task was held out on its shape; until 9 October each
 * instance was put to a stronger solver and to the measured one, and the second live session spent $48.45 that way,
 * $2.01 of it on the Examiner.
 *
 * The session stops at `--tasks` held-out tasks, at `--proposals` instances put to the gate, at
 * its minutes and turns, or when the Examiner calls `finish`, which it may at any count: on
 * 10 October every session held out two to four tasks and finished of its own accord. `--tasks` is
 * the host's and is never told to the Examiner. The campaign command names it from what the
 * campaign is short of (`examTasks`, `tools/d2/campaign-terms.ts`); run by hand it defaults to a
 * scored set's size, 12. Asking for many at once is what v1 found dilutes them, a probe grown to
 * 25 tasks in 10 of 13 cases (`docs/plan.md`).
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { examine, type Session } from "#src/examiner/session.ts";
import { openingOf } from "#src/builder/opening.ts";
import { read } from "#src/kernel/log.ts";
import { taskSets, taskStates } from "#src/kernel/task.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { solverLast } from "#src/kernel/solves.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { campaignLog, keptAs, openCampaign, packNamed, PROMOTED, REPO, stayAwake } from "../d2/campaign.ts";
import {
  type Campaign,
  COMPARISON_OPTIONS,
  reviewersNamed,
  type Seated,
  solved,
  solvingAs,
} from "../d2/round.ts";
import {
  type AskedSetting,
  firstRecord,
  keepSetting,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
} from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

/** An Examiner session's flags and their defaults. */
const EXAMINE_OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": COMPARISON_OPTIONS["reviewer-effort"],
  tasks: { type: "string", default: "12" },
  proposals: { type: "string", default: "36" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "200" },
  /** The campaign's setting, as every command that solves takes it: the solver and the limits the
   *  reference harness's solves of a draft task run under (`try_task`), and the budget fact the
   *  Examiner is told, where no setting is on record yet. `--tasks` is this command's own, so the
   *  scored set is named by `--target` alone. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** The solve launcher a comparison of the campaign uses, called for an Examiner session: one fresh
 *  solve of a draft task by the reference harness, under the campaign's setting and wall, its start
 *  naming the session where a comparison's names the comparison (`solved`, `tools/d2/round.ts`).
 *  The setting is held to the log's solves and recorded where none is, as a session's is. */
async function probing(
  campaign: Campaign,
  seated: Seated,
  setting: AskedSetting,
  values: Parameters<typeof reviewersNamed>[1],
) {
  const unrecorded = firstRecord(setting, solvingAs(campaign, setting.named), solverLast(read(campaign.log)));
  if (unrecorded !== undefined) throw new Error(unrecorded);
  keepSetting(campaign.log, setting);
  const reference = await keptAs(campaign, "--reference", PROMOTED);
  const seats = seated(campaign, { builder: undefined, reference: reference.dir });
  const reviewers = reviewersNamed(campaign, values);
  return async (task: TaskPackage, session: string, kill: AbortSignal) => {
    const { solve, ending } = await seats.solve(task, reference, kill, session);
    if (ending.outcome !== "fail" || ending.kind !== "rejected") return ending;
    const finding = await reviewers?.referee(solve, task, kill);
    return finding?.ruling === "earned"
      ? ending
      : ({
          outcome: "non-result",
          kind: "check",
          reason: "the admission rejection is not ruled earned",
        } as const);
  };
}

/** `bun tools/d1b/examine.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it to read what the command would have asked of one. `seated` solves
 *  a draft task under `try_task`; a caller that stands in for the session seats no solver unless it
 *  names one. `kill`
 *  stops the session, and one stopped before it began opens nothing. */
export async function examineCommand(
  args: readonly string[],
  session: Session<"write"> = examine,
  seated: Seated | null = session === examine ? solved : null,
  kill?: AbortSignal,
): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: EXAMINE_OPTIONS });
  const { session: id, examiner } = values;
  if (id === undefined || examiner === undefined) throw new Error("name --session and --examiner");
  if (kill?.aborted === true) throw new Error(`session ${id} was stopped before it began`);
  const pack = packNamed(values, ", --session and --examiner");
  // The campaign's setting is its log's, as a comparison reads it: the reference harness's solves
  // of a draft task run under it and record it where none is on record (`setting.ts`). `--tasks`
  // is the held-out tasks this session is to stop at, and names no scored set.
  const setting = settingAsked(
    { ...values, tasks: undefined },
    recordedSetting(read(campaignLog(pack.name))),
  );
  const campaign = await openCampaign({ ...pack, ...setting.named });
  // The brief's rows in the verifier's reading and in the pack's are the same rows in the same order.
  const declared = readBrief(campaign.checks).truthChecks;
  const sofar = read(campaign.log);
  const before = taskStates(sofar);
  const probe = seated === null ? null : await probing(campaign, seated, setting, values);
  stayAwake();
  const examined = await session(
    {
      id,
      mode: "write",
      verify: campaign.verify,
      probe,
      // The budget every solve is held to now: the recorded setting's turns and minutes, or before
      // a setting is recorded the opening's full limit and the wall the command names
      // (`--solve-minutes`, which the campaign command gives from the campaign's terms), and the
      // campaign's default wall where nothing names one. Until 11 October the minutes were the
      // default wall whatever the setting or the terms said: the buffer sessions of that day were
      // told 120 minutes where every solve ran under 8.
      budget: {
        modelTurns: recordedSetting(sofar)?.modelTurns ?? openingOf(sofar)?.limit ?? null,
        minutes:
          recordedSetting(sofar)?.minutes ??
          (values["solve-minutes"] === undefined
            ? Math.round(campaign.limits.wallSeconds / 60)
            : Number(values["solve-minutes"])),
      },
      contract: campaign.contract,
      checks: declared.map((check, index) => ({
        id: check.id,
        assertion: campaign.brief.truthChecks[index]?.assertion ?? "",
        families: check.execution.families,
      })),
      // Every task the campaign holds, the pack's and the ones earlier sessions wrote: the opening
      // message says the outcome of each. One the log refused is no task of the exam.
      tasks: [...campaign.packages()].flatMap(([version, task]) =>
        before.get(version) === "refused" ? [] : [task],
      ),
      pack: campaign.pack,
      model: modelNamed(examiner),
      // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
      effort: values["examiner-effort"] as ThinkingLevel,
      limits: {
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        puts: Number(values.proposals),
      },
      wanted: Number(values.tasks),
      models: campaign.examiner,
      log: campaign.log,
      ...keyIfDefined("kill", kill),
    },
    {
      repoRoot: REPO,
      otherTrees: campaign.trees,
      packRoots: campaign.packRoots,
      diskBytes: campaign.limits.diskBytes,
      // The engines the campaign's checks run, installed in the Examiner's shell from the tree the
      // verifier runs them from (`pinnedEngines`, `src/examiner/shell.ts`).
      engines: { checks: campaign.checks, tools: join(campaign.bundle, ".toolchain") },
      // The home the last session left, carried whole into this one, beside the log.
      keep: join(dirname(campaign.log), "examiner-home"),
    },
  );
  const sets = taskSets(read(campaign.log));
  console.log(
    JSON.stringify(
      {
        ended: examined.ended,
        held: examined.held.length,
        refused: examined.refused.length,
        campaign: { held: sets.held.length, released: sets.released.length },
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) await examineCommand(Bun.argv.slice(2));

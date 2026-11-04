/**
 * One Examiner session over a campaign:
 *
 *   bun tools/d1b/examine.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session x-1 \
 *     --examiner claude/claude-opus-5-5
 *
 * The Examiner writes task instances against the pack's contract and check program. Each is put to
 * the gate, which holds it out on its package's shape check (`propose_tasks`,
 * `src/examiner/write.ts`). The session is shown every task the campaign holds, the pack's own
 * and the ones earlier sessions wrote, and the opening message groups them under how the reference
 * harness did on each in the last comparison that scored it, with who won it and on which measure,
 * what the reference's valid answers measured, whether a valid answer to it is on record, and any
 * check a ruling found at fault on an answer to it (`src/examiner/record.ts`). The home the last session
 * computed in is carried into this one, and its shell runs the engines the pack's checks run
 * (12 October).
 *
 * The gate solves nothing. From 12 October to 1 November it also put each draft to up to three
 * room solves by the reference harness, through the launcher a comparison uses and with each
 * rejection ruled by the Referee, and held it only where they left the reference room; the gate
 * ablation of 31 October found the campaign without them promoting as soon and as far, an
 * indication from one campaign an arm. Since 4 November the author may put an instance to that
 * launcher itself, at most `--proposals` solves with a result a session (`try_reference`,
 * `probing`): no Referee rules their rejections, since they decide nothing, and no comparison counts
 * them, since their start names the session. From 9 to 12 October a task was held out on its shape check
 * as now; until 9 October each instance was put to a stronger solver and to the measured one, and
 * the second live session spent $48.45 that way, $2.01 of it on the Examiner.
 *
 * The session stops at `--tasks` held-out tasks, at `--proposals` instances put to the gate, at
 * its deadline and model turn limit, or when the Examiner calls `finish`, which it may at any count: on
 * 10 October every session held out two to four tasks and finished of its own accord. `--tasks` is
 * the host's and is never told to the Examiner. The campaign command names it from what the
 * campaign is short of, at least a sweep (`examTasks`, `tools/d2/campaign-terms.ts`); run by hand it defaults to 12,
 * a scored set's size until 12 October (`SIZE.tasks` is 24 since). Asking for many at once is what v1 found dilutes them, a probe grown to
 * 25 tasks in 10 of 13 cases (`7f0add79:docs/plan.md`).
 *
 * A copy of the reference harness is laid in the home afresh each session.
 * After a promotion the Examiner wrote drafts the reference's programs answered
 * every time, 0 of 49 held in esp32-fresh-opus, and never saw those programs. The term was off
 * unless named until 19 October, when a supply ablation on the buffer domain after its second
 * promotion, one Examiner session an arm, held 1 of 8 drafts blind for $9.22 and 4 of 8 with the
 * copy for $14.41: $9.22 a held draft against $3.60. On esp32, with no room left, both arms held
 * none (20 drafts blind, 6 with the copy). One session an arm and three room solves a draft; the
 * operator turned it on on that word. Its switch, and the one that hid who won each task, were
 * removed on 28 October: no campaign on record had set either off.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { taskSets, taskStates } from "#src/kernel/task.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { solverLast } from "#src/kernel/solves.ts";
import type { Task } from "#src/kernel/verify.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { campaignLog, keptAs, openCampaign, packNamed, PROMOTED, REPO, stayAwake } from "../d2/campaign.ts";
import { type Campaign, type Seated, solved, solvingAs } from "../d2/round.ts";
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
  tasks: { type: "string", default: "12" },
  proposals: { type: "string", default: "36" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "200" },
  /** The campaign's setting, as every command that solves takes it: the campaign it opens, and the
   *  budget the Examiner is told where no setting is on record, as by hand. `--tasks` is this command's
   *  own, so the scored set is named by `--target` alone. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** The solve launcher a comparison of the campaign uses, called for an Examiner session: one fresh
 *  solve of an instance by the reference harness in force, under the campaign's setting and deadline,
 *  its start naming the session where a comparison's names the comparison (`solved`,
 *  `tools/d2/round.ts`). The setting is held to the log's solves and recorded where none is, as a
 *  comparison's is. A solve the kill stops before it starts is a killed non-result with no id. */
async function probing(campaign: Campaign, seated: Seated, setting: AskedSetting, session: string) {
  const unrecorded = firstRecord(setting, solvingAs(campaign, setting.named), solverLast(read(campaign.log)));
  if (unrecorded !== undefined) throw new Error(unrecorded);
  const reference = await keptAs(campaign, "--reference", PROMOTED);
  const seats = seated(campaign, { builder: undefined, reference: reference.dir });
  // Kept at the first try rather than here, past the session's own refusals (`examine`), so that a
  // refused session leaves the record alone (`keepSetting`).
  let unkept: AskedSetting | null = setting;
  return async (task: Task, kill: AbortSignal) => {
    if (unkept !== null) keepSetting(campaign.log, unkept);
    unkept = null;
    return seats.solve(campaign.pack(task), reference, kill, session).catch((error: unknown) => {
      if (!kill.aborted || error !== kill.reason) throw error;
      return {
        solve: null,
        ending: { outcome: "non-result", kind: "killed", reason: errorMessage(error) },
      } as const;
    });
  };
}

/** `bun tools/d1b/examine.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it to read what the command would have asked of one. `seated` solves
 *  the instances it puts to the reference harness (`try_reference`), each held in the solve queue
 *  when the campaign command passes its own; null gives the session no tries. `kill` stops the
 *  session, and one stopped before it began opens nothing. */
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
  // The campaign's setting is its log's, as a comparison reads it (`setting.ts`).
  const setting = settingAsked(values, recordedSetting(read(campaignLog(pack.name))));
  const campaign = await openCampaign({ ...pack, ...setting.named });
  // The brief's rows in the verifier's reading and in the pack's are the same rows in the same order.
  const declared = readBrief(campaign.checks).truthChecks;
  const sofar = read(campaign.log);
  const before = taskStates(sofar);
  const tries = Number(values.proposals);
  const probe = seated === null ? null : { tries, solve: await probing(campaign, seated, setting, id) };
  stayAwake();
  const examined = await session(
    {
      id,
      mode: "write",
      verify: campaign.verify,
      // The budget every solve is held to, as the drafting session is told it (`draft.ts`). Until
      // 5 November a log with no setting yet read the opening's limit here, which repeated it.
      budget: {
        modelTurns: setting.named.limits.modelTurns ?? null,
        minutes: setting.named.limits.wallSeconds / 60,
        solves: setting.solves,
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
        puts: tries,
      },
      wanted: Number(values.tasks),
      models: campaign.examiner,
      log: campaign.log,
      probe,
      ...keyIfDefined("kill", kill),
    },
    {
      repoRoot: REPO,
      otherTrees: campaign.trees,
      packRoots: campaign.packRoots,
      // The engines the campaign's checks run, installed in the Examiner's shell from the tree the
      // verifier runs them from (`pinnedEngines`, `src/examiner/shell.ts`).
      engines: { checks: campaign.checks, tools: join(campaign.bundle, ".toolchain") },
      // The home the last session left, carried whole into this one, beside the log.
      keep: join(dirname(campaign.log), "examiner-home"),
      // The reference harness, laid in the home to read and run.
      reference: (await keptAs(campaign, "--reference", PROMOTED)).dir,
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

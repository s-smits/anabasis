/**
 * One session in which an Examiner drafts a campaign's exam from the operator's prompt:
 *
 *   bun tools/d1b/draft.ts --name queues --session d-1 --examiner claude/claude-opus-5-5
 *
 * The campaign opened from a prompt (`tools/d2/harness-builder.ts --prompt`), and its opening
 * holds that prompt. The Examiner drafts the public rules with a source for each, the answer
 * format, one check a rule, example tasks and controls (`src/examiner/draft.ts`). Each draft it
 * puts is read without a model (`draftReading`, `tools/d2/exam.ts`): its shape, every control
 * through the checks twice, and the do-nothing answer on every example. A draft with no fault
 * stands and is the campaign's exam from then on (`exam.drafted`), and the session ends.
 *
 * A draft with no fault is then measured before it stands: the reference harness, the starter
 * until a campaign promotes one, solves each example afresh through the launcher the gate of
 * `try_task` uses (`probing`, `examine.ts`), up to `TRIED` times and stopping at the first reading
 * that leaves it room (`measured`, `src/examiner/write.ts`), under the campaign's setting, which
 * the first such solve records (`--solver` and the rest, as every command that solves takes them).
 * A rejection is ruled by the Referee before it counts (`--reviewer`). The Examiner is told how many
 * solves were valid and the turns each valid one took, and the same draft put again stands. Each
 * solve's start names the session, so it is the Examiner's: never scored and on no task's record
 * (`examinerSessions`, `src/kernel/solves.ts`). On 22 October the drafted exams of two fresh
 * campaigns were measured only afterwards: one campaign's reference answered 965 of 971 solves
 * validly, at a median of 3 of 20 turns, and the other's gate found 36 of the 49 drafts it read
 * whole answered in all three solves.
 *
 * The session stops at a draft that stands, at `--tries` drafts put to the reading, or at its
 * minutes and turns. A measure its wall or a kill cuts short lets the draft stand, as the last put
 * does. The Examiner has a shell in a walled home of its own (`examine`, with a wall), under the
 * disk cap of a campaign's solves, closed to this repository and its other worktrees. A caller
 * that stands in for the session with a script seats no solver, and its drafts stand unmeasured.
 *
 * What stands is not frozen. Its checks are their author's own computation, which the acceptance
 * reading lists as faults until the operator admits each by name (`tools/c/accept.ts --admit`).
 *
 * Not run here: see `../d2/campaign.ts`. It needs the verifier's wall, the command wall and a model
 * login.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { openingOf } from "#src/campaign/opening.ts";
import type { Draft, Measured } from "#src/examiner/draft.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { measured } from "#src/examiner/write.ts";
import { read } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, examinerSession, openCampaign, REPO, stayAwake, worktreesOf } from "../d2/campaign.ts";
import { draftReading } from "../d2/exam.ts";
import { COMPARISON_OPTIONS, refereeNamed, type Seated, solved } from "../d2/round.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { budgetOf, probing } from "./examine.ts";

const OPTIONS = {
  name: { type: "string" },
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  tries: { type: "string", default: "3" },
  minutes: { type: "string", default: "60" },
  turns: { type: "string", default: "40" },
  jobs: { type: "string", default: "4" },
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": COMPARISON_OPTIONS["reviewer-effort"],
  /** The campaign's setting, which the examples' solves run under and the first of them records. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** `bun tools/d1b/draft.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it. `seated` solves a draft's examples; a caller that stands in for
 *  the session seats no solver unless it names one. */
export async function draftCommand(
  args: readonly string[],
  session: Session<"draft"> = examine,
  seated: Seated | null = session === examine ? solved : null,
): Promise<Examined> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, session: id, examiner } = values;
  if (name === undefined || id === undefined || examiner === undefined) {
    throw new Error("name --name, --session and --examiner");
  }
  refereeNamed(values, session === examine && seated !== null ? "paid" : "scripted");
  const log = campaignLog(name);
  const prompt = openingOf(read(log))?.prompt ?? null;
  if (prompt === null) {
    throw new Error(
      `campaign ${name} did not open from a prompt, so there is nothing to draft its exam from: open it with tools/d2/harness-builder.ts --prompt`,
    );
  }
  // The examples of a draft with no fault, each put to the gate's reference solves as a draft task
  // is, with no answer of the author's read: its controls passed the reading already.
  const measuring =
    (by: Seated) =>
    async (draft: Draft, stop: AbortSignal): Promise<Measured | null> => {
      const setting = settingAsked(values, recordedSetting(read(log)));
      const campaign = await openCampaign({ name, draft, ...setting.named });
      const probe = await probing(campaign, by, setting, values);
      const gate = { contract: campaign.contract, log, id, probe, planted: new Set<string>() };
      const examples = await Promise.all(
        campaign.tasks.map(async (task) => {
          const { reason, said } = await measured(gate, campaign.pack(task), stop, () =>
            Promise.resolve(null),
          );
          return said === "" ? (reason ?? "not measured") : said;
        }),
      );
      return stop.aborted ? null : { budget: budgetOf(read(log), campaign, values), examples };
    };
  stayAwake();
  const drafted = await session(
    {
      id,
      mode: "draft",
      prompt,
      reading: (draft) => draftReading(dirname(log), draft, Number(values.jobs)),
      ...keyIfDefined("measure", seated === null ? undefined : measuring(seated)),
      model: modelNamed(examiner),
      // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
      effort: values["examiner-effort"] as ThinkingLevel,
      limits: {
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        puts: Number(values.tries),
      },
      models: examinerSession,
      log,
    },
    { repoRoot: REPO, otherTrees: worktreesOf(REPO) },
  );
  console.log(JSON.stringify(drafted, null, 2));
  return drafted;
}

if (import.meta.main) await draftCommand(Bun.argv.slice(2));

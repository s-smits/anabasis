/**
 * One session in which an Examiner drafts a campaign's exam from the operator's prompt:
 *
 *   bun tools/d1b/draft.ts --name queues --session d-1 --examiner claude/claude-opus-5-5
 *
 * The campaign opened from a prompt (`tools/d2/harness-builder.ts --prompt`), and its opening
 * holds that prompt. The Examiner drafts the public rules with a source for each, the answer
 * format, one check a rule, example tasks and control answers (`src/examiner/draft.ts`). Each draft it
 * puts is read without a model (`draftReading`, `tools/d2/exam.ts`): its shape, every control answer
 * through the checks twice, and the do-nothing answer on every example. A draft that stands is the
 * campaign's exam from then on (`exam.drafted`), and the session ends.
 *
 * From 22 October to 1 November, and again on 3 and 4 November (#585), a draft with no
 * fault was then solved before it stood: the Starter Built Harness solved each example, and the
 * Examiner was told, or refused, where it answered them all. No solve runs here now; why, with
 * the record: `src/examiner/draft.ts`.
 *
 * The session stops at a draft that stands, at `--tries` drafts put to the reading, or at its
 * deadline and model turn limit; a session that ends with no draft standing leaves the campaign to
 * draft again, or to end on its exam once its drafts are spent (`drafting`, `src/campaign/decide.ts`).
 * The Examiner has a shell in a walled home of its own (`examine`,
 * with a wall), under the disk cap of a campaign's solves, closed to this repository and its other
 * worktrees.
 *
 * What stands is not frozen. Its checks are their author's own computation, which the acceptance
 * reading lists as faults until the operator admits each by name (`tools/c/accept.ts --admit`).
 *
 * Not run here: see `../d2/campaign.ts`. It needs the verifier's wall, the command wall and a model
 * login.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { openingOf } from "#src/campaign/opening.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, examinerSession, REPO, stayAwake, worktreesOf } from "../d2/campaign.ts";
import { draftReading } from "../d2/exam.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

const OPTIONS = {
  name: { type: "string" },
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  tries: { type: "string", default: "3" },
  minutes: { type: "string", default: "60" },
  turns: { type: "string", default: "40" },
  jobs: { type: "string", default: "4" },
  /** The campaign's setting, as the campaign command passes it before one is recorded: the budget
   *  the drafting Examiner is told. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** `bun tools/d1b/draft.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it. */
export async function draftCommand(
  args: readonly string[],
  session: Session<"draft"> = examine,
): Promise<Examined> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, session: id, examiner } = values;
  if (name === undefined || id === undefined || examiner === undefined) {
    throw new Error("name --name, --session and --examiner");
  }
  const log = campaignLog(name);
  const events = read(log);
  const prompt = openingOf(events)?.prompt;
  if (!isString(prompt)) {
    throw new Error(
      `campaign ${name} did not open from a prompt, so there is nothing to draft its exam from: open it with tools/d2/harness-builder.ts --prompt`,
    );
  }
  const setting = settingAsked(values, recordedSetting(events));
  const { wallSeconds, modelTurns } = setting.named.limits;
  stayAwake();
  const drafted = await session(
    {
      id,
      mode: "draft",
      prompt,
      budget: { modelTurns: modelTurns ?? null, minutes: wallSeconds / 60, solves: setting.solves },
      reading: async (draft) => await draftReading(dirname(log), draft, Number(values.jobs)),
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
    // The home is kept beside the log, as a writing session's is, so the first writing session opens
    // on the generators and environment the draft was built with (5 November, overhaul report 16).
    { repoRoot: REPO, otherTrees: worktreesOf(REPO), keep: join(dirname(log), "examiner-home") },
  );
  console.log(JSON.stringify(drafted, null, 2));
  return drafted;
}

if (import.meta.main) await draftCommand(Bun.argv.slice(2));

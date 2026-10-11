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
 * The session stops at a draft that stands, at `--tries` drafts put to the reading, or at its
 * minutes and turns. No solve runs, so it takes no flag for a solver and costs the Examiner's
 * own turns. The Examiner has a shell in a walled home of its own (`draftWalled`), under the disk
 * cap of a campaign's solves, closed to this repository and its other worktrees.
 *
 * What stands is not frozen. Its checks are their author's own computation, which the acceptance
 * reading lists as faults until the operator admits each by name (`tools/c/accept.ts --admit`).
 *
 * Not run here: see `../d2/campaign.ts`. It needs the verifier's wall, the command wall and a model
 * login.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { openingOf } from "#src/builder/opening.ts";
import { type Drafted, draftWalled } from "#src/examiner/draft.ts";
import { read } from "#src/kernel/log.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, examinerSession, LIMITS, REPO, stayAwake, worktreesOf } from "../d2/campaign.ts";
import { draftReading } from "../d2/exam.ts";
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
} as const;

/** `bun tools/d1b/draft.ts`. `session` runs the Examiner's session: `draftWalled`, unless a caller
 *  with no model stands in for it. */
export async function draftCommand(args: readonly string[], session = draftWalled): Promise<Drafted> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, session: id, examiner } = values;
  if (name === undefined || id === undefined || examiner === undefined) {
    throw new Error("name --name, --session and --examiner");
  }
  const log = campaignLog(name);
  const prompt = openingOf(read(log))?.prompt ?? null;
  if (prompt === null) {
    throw new Error(
      `campaign ${name} did not open from a prompt, so there is nothing to draft its exam from: open it with tools/d2/harness-builder.ts --prompt`,
    );
  }
  stayAwake();
  const drafted = await session({
    id,
    repoRoot: REPO,
    otherTrees: worktreesOf(REPO),
    diskBytes: LIMITS.diskBytes,
    prompt,
    reading: (draft) => draftReading(dirname(log), draft, Number(values.jobs)),
    model: modelNamed(examiner),
    // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
    effort: values["examiner-effort"] as ThinkingLevel,
    limits: {
      wallSeconds: Number(values.minutes) * 60,
      turns: Number(values.turns),
      tries: Number(values.tries),
    },
    models: examinerSession,
    log,
  });
  console.log(JSON.stringify(drafted, null, 2));
  return drafted;
}

if (import.meta.main) await draftCommand(Bun.argv.slice(2));

/**
 * One Examiner session over a campaign:
 *
 *   bun tools/d1b/examine.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session x-1 \
 *     --examiner claude/claude-opus-5-5
 *
 * The Examiner writes task instances against the pack's contract and check program. Each is put to
 * the one gate, the shape of its package, and is a held-out task when it passes
 * (`src/examiner/session.ts`). The session is shown every task the campaign holds, the pack's own
 * and the ones earlier sessions wrote, and the opening message says one outcome of each: one
 * harness won it, a tie between valid answers, no valid answer yet, or disputed.
 *
 * No solve runs, so the session takes no flag for a solver, its limits or a reviewer, and costs
 * the Examiner's own turns. Until 2026-10-09 it put each instance to a stronger solver and to the
 * measured one; the second live session spent $48.45 that way, $2.01 of it on the Examiner.
 *
 * The session stops at `--tasks` held-out tasks, at `--proposals` instances put to the gate, at
 * its minutes and turns, or when the Examiner calls `finish`, which it may at any count: on
 * 10 October every session held out two to four tasks and finished of its own accord. `--tasks` is the host's and is never told to the Examiner. It defaults to
 * the scored set's size: asking for many at once is what v1 found dilutes them, a probe grown to
 * 25 tasks in 10 of 13 cases (`docs/plan.md`).
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { examineWalled } from "#src/examiner/session.ts";
import { openingOf } from "#src/builder/opening.ts";
import { read } from "#src/kernel/log.ts";
import { taskSets, taskStates } from "#src/kernel/task.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { parseArgs } from "#src/meta/process.ts";
import { openCampaign, packNamed, REPO, stayAwake } from "../d2/campaign.ts";
import { recordedSetting } from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

/** An Examiner session's flags and their defaults. A launch parses its flags by the same table
 *  first (`tools/runs/launch.ts`, `flagsRefused`). */
export const EXAMINE_OPTIONS = {
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
} as const;

/** `bun tools/d1b/examine.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it to read what the command would have asked of one. */
export async function examineCommand(args: readonly string[], session = examineWalled): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: EXAMINE_OPTIONS });
  const { session: id, examiner } = values;
  if (id === undefined || examiner === undefined) throw new Error("name --session and --examiner");
  const campaign = await openCampaign(packNamed(values, ", --session and --examiner"));
  // The brief's rows in the verifier's reading and in the pack's are the same rows in the same order.
  const declared = readBrief(campaign.checks).truthChecks;
  const sofar = read(campaign.log);
  const before = taskStates(sofar);
  stayAwake();
  const examined = await session({
    id,
    repoRoot: REPO,
    otherTrees: campaign.trees,
    diskBytes: campaign.limits.diskBytes,
    verify: campaign.verify,
    // The budget every solve is held to now: the recorded setting's turns, or the opening's full
    // limit before a setting is recorded, and the campaign's wall.
    budget: {
      modelTurns: recordedSetting(sofar)?.modelTurns ?? openingOf(sofar)?.limit ?? null,
      minutes: Math.round(campaign.limits.wallSeconds / 60),
    },
    contract: campaign.contract,
    checks: declared.map((check, index) => ({
      id: check.id,
      assertion: campaign.brief.truthChecks[index]?.assertion ?? "",
      families: check.execution.families,
    })),
    // Every task the campaign holds, the pack's and the ones earlier sessions wrote: the opening
    // message says the outcome of each. One the log refused is no task of the exam.
    examples: [...campaign.packages()].flatMap(([version, task]) =>
      before.get(version) === "refused" ? [] : [task],
    ),
    pack: campaign.pack,
    model: modelNamed(examiner),
    // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
    effort: values["examiner-effort"] as ThinkingLevel,
    limits: {
      wallSeconds: Number(values.minutes) * 60,
      turns: Number(values.turns),
      proposals: Number(values.proposals),
      tasks: Number(values.tasks),
    },
    models: campaign.examiner,
    log: campaign.log,
  });
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

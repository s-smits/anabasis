/**
 * Runs a single Examiner task-writing session for a campaign:
 *
 *   bun tools/d1b/examine.ts --name truss --session x-1 --examiner claude/claude-opus-5-5
 *
 * The Examiner authors task instances against the pack's contract and check program. Each proposal
 * passes through a structural gate (`propose_tasks`, `src/examiner/write.ts`) that admits valid
 * packages to the held-out set without running any solver. The session receives all existing
 * campaign tasks (both pack tasks and previously authored tasks), grouped in the opening message by
 * the reference harness's outcome in the most recent scored comparison, together with the winning
 * side and deciding measure, objective values of valid reference answers, whether any valid answer
 * is on record, and any check previously ruled defective on that task (`src/examiner/record.ts`).
 * The home directory persists across sessions and exposes the check engines in its shell. Inside a
 * campaign, subsequent asks resume the same Examiner conversation rather than starting fresh
 * (`conversing`, `tools/d2/campaign-actions.ts`).
 *
 * The admission gate performs structural validation only, without requiring reference-solve
 * headroom (ablations showed no advantage in promotion speed or count from gating on reference
 * solves, and testing every proposal with a stronger solver multiplies session cost). The Examiner
 * reads how the reference fared on its earlier tasks in the record (`heard`) rather than solving
 * instances itself: 93% of the reference solves it once asked for came back valid, at up to a
 * seventh of a verifiable campaign's spend.
 *
 * The session ends upon reaching `--tasks` held-out tasks, `--proposals` gate submissions, the
 * wall-clock or turn limit, or when the Examiner calls `finish`. `--tasks` is a host cap and is
 * never disclosed to the Examiner. Automated campaigns derive it from the current supply deficit
 * (`examinerRun`, `tools/d2/campaign-terms.ts`); manual invocations default to 12 (half of
 * `SIZE.tasks`), as larger batches tend to dilute task quality.
 *
 * The Examiner home intentionally contains no copy of the reference harness, so that tasks do not
 * target specific harness programs in ways that distort post-promotion Starter confirmation
 * comparisons.
 *
 * Requires the verifier sandbox, command sandbox, and a model login (see `campaign.ts`).
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { taskSets, taskStates } from "#src/kernel/task.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, openCampaign, PACK_OPTIONS, packNamed, REPO, stayAwake } from "../d2/campaign.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

/** CLI flags and defaults for an Examiner task-writing session. */
const EXAMINE_OPTIONS = {
  ...PACK_OPTIONS,
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  tasks: { type: "string", default: "12" },
  proposals: { type: "string", default: "36" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "200" },
  /** Campaign setting flags used to open the campaign and supply the solve budget when no setting
   *  is yet recorded. `--tasks` belongs to this command, so comparison set size uses `--target`. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** CLI entry point for `bun tools/d1b/examine.ts`. `session` defaults to `examine` and may be
 *  stubbed in tests. `kill` aborts the session; if already aborted, the session does not open. */
export async function examineCommand(
  args: readonly string[],
  session: Session<"write"> = examine,
  kill?: AbortSignal,
): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: EXAMINE_OPTIONS });
  const { session: id, examiner } = values;
  if (id === undefined || examiner === undefined) throw new Error("name --session and --examiner");
  if (kill?.aborted === true) throw new Error(`session ${id} was stopped before it began`);
  const pack = packNamed(values, ", --session and --examiner");
  // Resolve the campaign setting from the log and CLI flags (`setting.ts`).
  const setting = settingAsked(values, recordedSetting(read(campaignLog(pack.name))));
  const campaign = await openCampaign({ ...pack, ...setting.named });
  // Verifier brief rows and pack brief rows share identical ordering.
  const declared = readBrief(campaign.checks).truthChecks;
  const sofar = read(campaign.log);
  const before = taskStates(sofar);
  stayAwake();
  const examined = await session(
    {
      id,
      mode: "write",
      verify: campaign.verify,
      // Solve budget exposed to the Examiner, matching what drafting sessions receive (`draft.ts`).
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
      // Pass all non-refused campaign tasks (pack and previously authored) so the opening summary
      // can report each task's history.
      tasks: [...campaign.packages()].flatMap(([version, task]) =>
        before.get(version) === "refused" ? [] : [task],
      ),
      pack: campaign.pack,
      model: modelNamed(examiner),
      // SAFETY: effort is a pi thinking level; unsupported values are rejected by the backend.
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
      // Expose the check engines in the Examiner shell from the same toolchain tree used by the
      // verifier (`pinnedEngines`, `src/examiner/shell.ts`).
      engines: { checks: campaign.checks, tools: join(campaign.bundle, ".toolchain") },
      // Persist the Examiner home beside the campaign log across sessions.
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

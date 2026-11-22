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
 * solves, and testing every proposal with a stronger solver multiplies session cost). Instead, the
 * Examiner may probe the current reference harness directly via `try_reference` (`probing`) up to
 * `--proposals` completed solves per session; probe rejections are not sent to the Referee and are
 * excluded from comparison scoring because their start events are attributed to the session.
 *
 * The session ends upon reaching `--tasks` held-out tasks, `--proposals` gate submissions, the
 * wall-clock or turn limit, or when the Examiner calls `finish`. `--tasks` is a host cap and is
 * never disclosed to the Examiner. Automated campaigns derive it from the current supply deficit
 * (`examinerRun`, `tools/d2/campaign-terms.ts`); manual invocations default to 12 (half of
 * `SIZE.tasks`), as larger batches tend to dilute task quality.
 *
 * The Examiner home intentionally contains no copy of the reference harness; the reference is
 * exposed only as a black box via `try_reference` so that tasks do not target specific harness
 * programs in ways that distort post-promotion Starter confirmation comparisons.
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
import { solverLast } from "#src/kernel/solves.ts";
import type { Task } from "#src/kernel/verify.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  campaignLog,
  keptAs,
  openCampaign,
  PACK_OPTIONS,
  packNamed,
  PROMOTED,
  REPO,
  stayAwake,
} from "../d2/campaign.ts";
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

/** Creates the reference-probing solve launcher for an Examiner session. Each call runs one fresh
 *  solve under the current reference harness and campaign setting, tagging the solve with the
 *  session ID instead of a comparison ID (`solved`, `tools/d2/round.ts`). Validates the setting
 *  against logged solves and records it on first use. Returns a `killed` non-result if aborted
 *  before launch. */
async function probing(campaign: Campaign, seated: Seated, setting: AskedSetting, session: string) {
  const unrecorded = firstRecord(setting, solvingAs(campaign, setting.named), solverLast(read(campaign.log)));
  if (unrecorded !== undefined) throw new Error(unrecorded);
  const reference = await keptAs(campaign, "--reference", PROMOTED);
  const seats = seated(campaign, { builder: undefined, reference: reference.dir });
  // Persist the setting on the first probe rather than at setup so that a session refused before
  // starting leaves the campaign log unchanged (`keepSetting`).
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

/** CLI entry point for `bun tools/d1b/examine.ts`. `session` defaults to `examine` and may be
 *  stubbed in tests. `seated` launches reference probes (`try_reference`) and may be `null` to
 *  disable probing. `kill` aborts the session; if already aborted, the session does not open. */
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
  // Resolve the campaign setting from the log and CLI flags (`setting.ts`).
  const setting = settingAsked(values, recordedSetting(read(campaignLog(pack.name))));
  const campaign = await openCampaign({ ...pack, ...setting.named });
  // Verifier brief rows and pack brief rows share identical ordering.
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

/**
 * One Examiner task-writing session. Proposals pass a structural gate only (`propose_tasks`,
 * `src/examiner/write.ts`), with no solver run; the Examiner reads how the reference fared on
 * earlier tasks from the record (`heard`, `src/examiner/record.ts`) instead. The session ends at
 * `--tasks` held-out tasks (a host cap the Examiner never sees; default 12, half of `SIZE.tasks`;
 * campaigns derive it in `examinerRun`), `--proposals` gate submissions, the wall-clock or turn
 * limit, or `finish`. The home holds no copy of the reference harness, so tasks do not target its
 * programs.
 *
 *   bun tools/eval/examine.ts --name truss --session x-1 --examiner claude/claude-opus-5-5
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { CLAUDE_SESSIONS_DIR } from "#src/agent/backends/claude-transcript.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { taskSets, taskStates } from "#src/kernel/task.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import {
  campaignLog,
  hostSession,
  openCampaign,
  PACK_OPTIONS,
  packNamed,
  REPO,
  stayAwake,
} from "../campaign/campaign.ts";
import { type RevisionAuditor, revisionRunner } from "../campaign/revise.ts";
import { FORK_OPTIONS, seatForkPlan } from "../campaign/seat-fork.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../campaign/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

const EXAMINE_OPTIONS = {
  ...PACK_OPTIONS,
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string" },
  revise: { type: "boolean" },
  tasks: { type: "string", default: "12" },
  proposals: { type: "string", default: "36" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "200" },
  /** The setting flags, read when the log records no setting yet. `--tasks` belongs to this
   *  command, so comparison set size uses `--target`. */
  ...SETTING_OPTIONS,
  ...FORK_OPTIONS,
  target: { type: "string" },
} as const;

/** `session` may be stubbed in tests; an already aborted `kill` refuses to open the session. */
export async function examineCommand(
  args: readonly string[],
  session: Session<"write"> = examine,
  kill?: AbortSignal,
  audit?: RevisionAuditor | null,
): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: EXAMINE_OPTIONS, allowNegative: true });
  const { session: id, examiner } = values;
  if (id === undefined || examiner === undefined) throw new Error("name --session and --examiner");
  if (kill?.aborted === true) throw new Error(`session ${id} was stopped before it began`);
  const pack = packNamed(values, ", --session and --examiner");
  const setting = settingAsked(values, recordedSetting(read(campaignLog(pack.name))));
  const campaign = await openCampaign({ ...pack, ...setting.named });
  // Verifier brief rows and pack brief rows share one order.
  const declared = readBrief(campaign.checks).truthChecks;
  const sofar = read(campaign.log);
  const opening = openingOf(sofar);
  const before = taskStates(sofar);
  const model = modelNamed(examiner);
  const forkPlan = seatForkPlan(campaign.log, "exam", model, values);
  const canRevise = values.revise ?? opening?.revise ?? true;
  const revise = canRevise
    ? revisionRunner({
        log: campaign.log,
        parentBundle: campaign.bundle,
        packages: campaign.packages,
        reviewer: { model: values.reviewer, effort: values["reviewer-effort"] },
        auditor: audit,
        kill,
      })
    : undefined;
  const models =
    forkPlan.fork === undefined
      ? campaign.examiner
      : hostSession({
          webSearch: false,
          cacheTtl: "1h",
          persistDir: join(dirname(campaign.log), CLAUDE_SESSIONS_DIR),
          fork: forkPlan.fork,
        });
  stayAwake();
  const examined = await session(
    {
      id,
      mode: "write",
      verify: campaign.verify,
      // The same budget drafting sessions receive (`draft.ts`).
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
      // Every non-refused task, pack and authored, so the opening can report each one's history.
      tasks: [...campaign.packages()].flatMap(([version, task]) =>
        before.get(version) === "refused" ? [] : [task],
      ),
      pack: campaign.pack,
      model,
      // SAFETY: effort is a pi thinking level; unsupported values are rejected by the backend.
      effort: values["examiner-effort"] as ThinkingLevel,
      limits: {
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        puts: Number(values.proposals),
      },
      wanted: Number(values.tasks),
      models,
      log: campaign.log,
      ...keyIfDefined("revise", revise),
      ...keyIfDefined("continuation", forkPlan.continuation),
      ...keyIfDefined("kill", kill),
    },
    {
      repoRoot: REPO,
      otherTrees: campaign.trees,
      // The check engines come from the verifier's own toolchain tree (`pinnedEngines`,
      // `src/examiner/shell.ts`).
      engines: { checks: campaign.checks, tools: join(campaign.bundle, ".toolchain") },
      // Persists beside the campaign log across sessions.
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

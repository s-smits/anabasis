/**
 * Runs one Examiner drafting session (`bun tools/d1b/draft.ts`), validates each draft offline
 * (`draftReading`), runs up to two bounded Adversarial Judge Referee audits (`reviewDraft`) on
 * mechanically clean drafts when a reviewer is configured, and records `checker.read` / `contract.frozen`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { openingOf } from "#src/campaign/opening.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { type DraftAuditCase, type DraftAuditFinding, reviewDraft } from "#src/referee/draft-audit.ts";
import type { Reader } from "#src/referee/referee.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, examinerSession, REPO, stayAwake, worktreesOf } from "../d2/campaign.ts";
import { keepReading } from "../c/accept.ts";
import { draftReading } from "../d2/exam.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../d2/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

/** Optional adversarial audit over a mechanically clean draft (`reviewDraft`). */
type DraftAuditor = (reader: Reader, target: DraftAuditCase) => Promise<DraftAuditFinding>;

/** Maximum adversarial draft audits per drafting session (initial audit + verify-after-fix pass). */
const MAX_DRAFT_AUDITS = 2;

const OPTIONS = {
  name: { type: "string" },
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  tries: { type: "string", default: "4" },
  minutes: { type: "string", default: "60" },
  turns: { type: "string", default: "40" },
  jobs: { type: "string", default: "4" },
  /** Campaign setting flags used when none is yet recorded in the log, supplying the solve budget
   *  reported to the drafting Examiner. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** CLI entry point for `bun tools/d1b/draft.ts`. Accepts a `session` runner (defaulting to
 *  `examine`) and optional `audit` runner so tests can substitute model-free stubs. */
export async function draftCommand(
  args: readonly string[],
  session: Session<"draft"> = examine,
  audit?: DraftAuditor | null,
): Promise<Examined> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, session: id, examiner } = values;
  if (name === undefined || id === undefined || examiner === undefined) {
    throw new Error("name --name, --session and --examiner");
  }
  const log = campaignLog(name);
  const events = read(log);
  const opening = openingOf(events);
  const prompt = opening?.prompt;
  if (!isString(prompt)) {
    throw new Error(
      `campaign ${name} did not open from a prompt, so there is nothing to draft its exam from: open it with tools/d2/harness-builder.ts --prompt`,
    );
  }
  const reviewer = opening?.seats.reviewer ?? null;
  const defaultAuditor: DraftAuditor | null = session === examine ? reviewDraft : null;
  const auditor: DraftAuditor | null = audit === undefined ? defaultAuditor : audit;
  const auditReader: Reader | null =
    reviewer === null
      ? null
      : {
          model: modelNamed(reviewer.model),
          // SAFETY: `reviewer.effort` is the pi thinking level recorded on `campaign.opened`.
          effort: reviewer.effort as ThinkingLevel,
          models: examinerSession,
        };
  const setting = settingAsked(values, recordedSetting(events));
  const { wallSeconds, modelTurns } = setting.named.limits;
  /** Validation readings for each draft submitted in this session; the final entry corresponds to
   *  the accepted draft. */
  const readings: (Awaited<ReturnType<typeof draftReading>>["read"] | undefined)[] = [];
  let audits = 0;
  let priorFindings: readonly string[] = [];
  stayAwake();
  const drafted = await session(
    {
      id,
      mode: "draft",
      prompt,
      budget: { modelTurns: modelTurns ?? null, minutes: wallSeconds / 60, solves: setting.solves },
      reading: async (draft) => {
        const { faults, read: seen } = await draftReading(dirname(log), draft, Number(values.jobs));
        readings.push(seen);
        if (
          faults.length > 0 ||
          seen === undefined ||
          audits >= MAX_DRAFT_AUDITS ||
          auditor === null ||
          auditReader === null
        ) {
          return faults;
        }
        // Run up to two bounded Adversarial Judge passes (initial audit + verify-after-fix),
        // letting any subsequent clean draft stand unconditionally so supply can never stall.
        audits += 1;
        const review = await auditor(auditReader, {
          session: id,
          pass: audits,
          prompt,
          contract: seen.contract,
          checks: seen.checks,
          verify: seen.verify,
          tasks: seen.tasks,
          controls: seen.controls,
          notes: seen.reading.notes,
          priorFindings,
          log,
        });
        if (review.verdict !== "defects" || review.findings.length === 0) return [];
        priorFindings = review.findings.map(
          ({ kind, task, probe, reason }) =>
            `independent check audit (${kind} on ${task}, probe #${String(probe)}): ${reason}`,
        );
        return priorFindings;
      },
      model: modelNamed(examiner),
      // SAFETY: effort is a pi thinking level; unsupported values are rejected by the backend.
      effort: values["examiner-effort"] as ThinkingLevel,
      limits: {
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        puts: Number(values.tries),
      },
      models: examinerSession,
      log,
    },
    // Persist the Examiner home beside the log so subsequent task-writing sessions inherit the
    // generators and environment created during drafting.
    { repoRoot: REPO, otherTrees: worktreesOf(REPO), keep: join(dirname(log), "examiner-home") },
  );
  // Record the acceptance reading for an accepted draft (`keepReading`). In unattended runs (without
  // `--hitl`), admit author-computed checks and freeze the contract immediately to avoid repeating
  // the same offline acceptance pass.
  const after = read(log);
  const stood = after.some(({ kind, data }) => kind === "exam.drafted" && data.session === id);
  const last = readings.at(-1);
  if (stood && last !== undefined) {
    const unattended = openingOf(after)?.attended !== true;
    keepReading(log, last.checker, last.reading, {
      admitted: new Set(),
      authored: unattended,
      freeze: unattended,
      despite: "",
    });
  }
  console.log(JSON.stringify(drafted, null, 2));
  return drafted;
}

if (import.meta.main) await draftCommand(Bun.argv.slice(2));

/**
 * One Examiner drafting session (`bun tools/eval/draft.ts`): each draft is read offline
 * (`draftReading`), a mechanically clean one gets up to `MAX_DRAFT_AUDITS` Adversarial Judge audits
 * (`reviewDraft`) when a reviewer is named, and an accepted draft records `checker.read` /
 * `contract.frozen`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { unaudited } from "#src/campaign/scheduler.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { read, TRACE_KINDS } from "#src/kernel/log.ts";
import { nonRetryableProvider } from "#src/kernel/solve.ts";
import {
  type DraftAuditCase,
  type DraftAuditFinding,
  formatDraftFinding,
  gatedDraftAudit,
  reviewDraft,
} from "#src/audit/draft-audit.ts";
import type { Reader } from "#src/audit/auditor.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import {
  campaignLog,
  REPO,
  reviewerOf,
  reviewerReader,
  seatSession,
  stayAwake,
  worktreesOf,
} from "../campaign/campaign.ts";
import { FORK_OPTIONS, seatForkPlan } from "../campaign/seat-fork.ts";
import { rubricLaneOf } from "../campaign/round.ts";
import { keepReading } from "../eval/accept.ts";
import { draftReading } from "../campaign/exam.ts";
import { recordedSetting, SETTING_OPTIONS, settingAsked } from "../campaign/setting.ts";
import { modelNamed } from "../m0/stored-sweep.ts";

type DraftAuditor = (reader: Reader, target: DraftAuditCase) => Promise<DraftAuditFinding>;

/** The initial audit and one verify-after-fix pass. */
const MAX_DRAFT_AUDITS = 2;

const OPTIONS = {
  name: { type: "string" },
  session: { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string", default: "high" },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string" },
  tries: { type: "string", default: "8" },
  minutes: { type: "string", default: "90" },
  turns: { type: "string", default: "80" },
  jobs: { type: "string", default: "4" },
  /** The setting flags, read when the log records no setting yet, for the solve budget shown to the
   *  drafting Examiner. */
  ...SETTING_OPTIONS,
  ...FORK_OPTIONS,
  target: { type: "string" },
} as const;

type DraftSeen = NonNullable<Awaited<ReturnType<typeof draftReading>>["read"]>;

/** A draft audited without a seated reviewer stands on its offline reading alone. */
const UNAUDITED: DraftAuditFinding = { verdict: "sound", findings: [], summary: "no reviewer", probes: [] };

async function auditDraft(
  given: {
    readonly session: string;
    readonly prompt: string;
    readonly log: string;
    readonly auditor: DraftAuditor | null;
    readonly reader: Reader | null;
  },
  seen: DraftSeen,
): Promise<readonly string[]> {
  const { auditor, reader } = given;
  const gate = await gatedDraftAudit(
    read(given.log, TRACE_KINDS),
    { session: given.session, prompt: given.prompt, log: given.log, notes: seen.reading.notes },
    seen,
    (unverified) => (unverified > 0 ? MAX_DRAFT_AUDITS + 1 : MAX_DRAFT_AUDITS),
    async (target) => (auditor === null || reader === null ? UNAUDITED : await auditor(reader, target)),
  );
  if (gate.kind === "broken") return gate.faults;
  if (gate.kind === "capped") {
    return gate.unverified.map(
      (finding) => `${finding} (prior defect probe could not be verified fixed after the audit cap)`,
    );
  }
  const { review } = gate;
  if (review.verdict === "skipped" && review.error === undefined) {
    return [
      `independent check audit recorded no verdict (${review.summary}); submit the draft again to retry`,
    ];
  }
  return review.verdict === "defects" ? review.findings.map(formatDraftFinding) : [];
}

/** `session` and `audit` are injectable so tests can pass model-free stubs. */
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
      `campaign ${name} did not open from a prompt, so there is nothing to draft its exam from: open it with tools/campaign/harness-builder.ts --prompt`,
    );
  }
  const defaultAuditor: DraftAuditor | null = session === examine ? reviewDraft : null;
  const auditor: DraftAuditor | null = audit === undefined ? defaultAuditor : audit;
  const reviewer = reviewerOf(values, opening);
  const lane = rubricLaneOf(reviewer?.model, opening?.solver?.model);
  const setting = settingAsked(values, recordedSetting(events));
  const { wallSeconds, modelTurns } = setting.named.limits;
  /** The last entry is the accepted draft's reading. */
  const readings: (DraftSeen | undefined)[] = [];
  const gate = {
    session: id,
    prompt,
    log,
    auditor,
    reader: reviewer === null ? null : reviewerReader(reviewer),
  };
  const model = modelNamed(examiner);
  const forkPlan = seatForkPlan(log, "draft", model, values);
  const models = seatSession(log, "examiner", forkPlan.fork);
  stayAwake();
  const drafted = await session(
    {
      id,
      mode: "draft",
      prompt,
      lane,
      budget: { modelTurns: modelTurns ?? null, minutes: wallSeconds / 60, solves: setting.solves },
      reading: async (draft, home) => {
        const { faults, read: seen } = await draftReading(dirname(log), draft, Number(values.jobs), home);
        readings.push(seen);
        return faults.length > 0 || seen === undefined ? faults : await auditDraft(gate, seen);
      },
      model,
      // SAFETY: effort is a pi thinking level; unsupported values are rejected by the backend.
      effort: values["examiner-effort"] as ThinkingLevel,
      limits: {
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        puts: Number(values.tries),
      },
      models,
      log,
      ...keyIfDefined("continuation", forkPlan.continuation),
    },
    // Kept beside the log so later task-writing sessions inherit the generators and environment made
    // while drafting.
    { repoRoot: REPO, otherTrees: worktreesOf(REPO), keep: join(dirname(log), "examiner-home") },
  );
  // Unattended runs (without `--hitl`) admit author-computed checks and freeze at once, so the same
  // offline acceptance pass is not repeated.
  const after = read(log);
  const stood = after.some(({ kind, data }) => kind === "exam.drafted" && data.session === id);
  const error = stood ? unaudited(after) : null;
  if (error !== null && !nonRetryableProvider(error)) {
    throw new Error(
      `the reviewer's audit of the drafted exam ended on an error, so it is not frozen: ${error}`,
    );
  }
  const last = readings.at(-1);
  if (stood && error === null && last !== undefined) {
    const unattended = openingOf(after)?.attended !== true;
    keepReading(log, last.checker, last.reading, {
      admitted: new Set(),
      authored: unattended,
      judge: openingOf(after)?.judged === true,
      freeze: unattended,
      despite: "",
    });
  }
  console.log(JSON.stringify(drafted, null, 2));
  return drafted;
}

if (import.meta.main) await draftCommand(Bun.argv.slice(2));

/**
 * Runs a single Examiner drafting session to build a campaign exam from the operator's prompt:
 *
 *   bun tools/d1b/draft.ts --name queues --session d-1 --examiner claude/claude-opus-5-5
 *
 * The campaign must have been opened with `tools/d2/harness-builder.ts --prompt`, whose prompt is
 * stored in the opening event. The Examiner drafts public rules (each with a source), the answer
 * format, one check per rule, example tasks, and control answers (`src/examiner/draft.ts`). Each
 * candidate draft is validated offline (`draftReading`, `tools/d2/exam.ts`): structural shape,
 * every control run twice through the checks, and the minimal do-nothing answer tested on every
 * example task. An accepted draft becomes the campaign's exam (`exam.drafted`), and its validation
 * reading is stored as `checker.read`.
 *
 * No solver rollouts run during drafting; a fault-free draft is accepted without first testing it
 * against the Starter Built Harness (see `src/examiner/draft.ts` for rationale).
 *
 * The session ends once a draft is accepted, after `--tries` submissions, or when its wall-clock
 * or turn limit is reached. If no draft is accepted, the campaign may retry drafting or terminate
 * once its drafting allowance is exhausted (`drafting`, `src/campaign/decide.ts`). The Examiner
 * runs inside a sandboxed home directory under the campaign's solve disk cap, isolated from this
 * repository and its other worktrees.
 *
 * Author-computed checks appear as faults in acceptance readings until admitted by the operator.
 * Unattended campaigns (without `--hitl`) admit these checks and freeze the accepted draft here;
 * `--hitl` campaigns wait for `tools/c/accept.ts --admit`.
 *
 * Requires the verifier sandbox, command sandbox, and a model login (see `../d2/campaign.ts`).
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { openingOf } from "#src/campaign/opening.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { read } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, examinerSession, REPO, stayAwake, worktreesOf } from "../d2/campaign.ts";
import { keepReading } from "../c/accept.ts";
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
  /** Campaign setting flags used when none is yet recorded in the log, supplying the solve budget
   *  reported to the drafting Examiner. */
  ...SETTING_OPTIONS,
  target: { type: "string" },
} as const;

/** CLI entry point for `bun tools/d1b/draft.ts`. Accepts a `session` runner (defaulting to
 *  `examine`) so tests can substitute a model-free stub. */
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
  /** Validation readings for each draft submitted in this session; the final entry corresponds to
   *  the accepted draft. */
  const readings: (Awaited<ReturnType<typeof draftReading>>["read"] | undefined)[] = [];
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
        return faults;
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

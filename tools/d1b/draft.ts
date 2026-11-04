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
 * A draft with no fault there is then solved before it stands (`starterFaults`): the Starter Built
 * Harness solves each example as many times as a comparison solves a task, all at once, under the
 * campaign's setting, which the first draft so solved records, through the solve launcher a comparison
 * uses. Each solve's start names the session, so it is the Examiner's: never scored and on no
 * task's record (`examinerSessions`, `src/kernel/solves.ts`). A non-result is solved once more, as
 * a comparison's is, and a second is counted nowhere. Where no example leaves the starter room as a
 * comparison reads it (`informative`, `src/kernel/compare.ts`), the session's first such draft does
 * not stand, and its author is told, an example a line, how many solves were valid and the turns
 * each took; a later draft with no other fault stands with that reading as a note. An example
 * with no counted solve, or with a solve that is not valid, leaves room: a rejection counts as
 * room whether or not it would be ruled earned, so no Referee is seated here. Its draft's accept
 * control is the valid answer on record that makes an example no solve answered informative.
 * A caller that stands in for the session with a script and names no solver measures nothing,
 * and its drafts stand on the reading alone.
 *
 * Why, and the record of the same solves from 22 October to 1 November: `src/examiner/draft.ts`.
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
import type { Draft } from "#src/examiner/draft.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { informative } from "#src/kernel/compare.ts";
import { read } from "#src/kernel/log.ts";
import { passed, solverLast, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import {
  campaignLog,
  examinerSession,
  openCampaign,
  REPO,
  starter,
  stayAwake,
  worktreesOf,
} from "../d2/campaign.ts";
import { draftReading, exampleId } from "../d2/exam.ts";
import { type Seated, solved, solvingAs } from "../d2/round.ts";
import {
  type AskedSetting,
  firstRecord,
  keepSetting,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
} from "../d2/setting.ts";
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

/** What `starterFaults` solves a draft under: the campaign, the drafting session the solves are
 *  the Examiner's by, the setting and who solves. */
interface Measuring {
  readonly name: string;
  readonly session: string;
  readonly setting: AskedSetting;
  readonly seated: Seated;
}

/**
 * The fault of a draft whose every example the Starter Built Harness answered, or none: each
 * example solved `setting.solves` times afresh, all at once, under the campaign's setting, a
 * non-result once more. An example leaves room as a comparison reads a task (`informative`), with
 * its accept control as the valid answer on record. `stop` is the session's: a session that ends
 * while the starter solves throws here, and its draft does not stand unmeasured.
 */
async function starterFaults(at: Measuring, draft: Draft, stop: AbortSignal): Promise<string[]> {
  const { session, setting } = at;
  const campaign = await openCampaign({ name: at.name, draft, ...setting.named });
  // The first draft measured records the setting; a later one in the session finds it recorded.
  const before = read(campaign.log);
  if (recordedSetting(before) === null) {
    const unrecorded = firstRecord(setting, solvingAs(campaign, setting.named), solverLast(before));
    if (unrecorded !== undefined) throw new Error(unrecorded);
    keepSetting(campaign.log, setting);
  }
  const harness = await starter(campaign);
  const seats = at.seated(campaign, { builder: undefined, reference: harness.dir });
  const once = async (task: TaskPackage, tries: number): Promise<string | null> => {
    const { solve, ending } = await seats.solve(task, harness, stop, session);
    if (ending.outcome !== "non-result") return solve;
    return tries > 1 && !stop.aborted ? await once(task, tries - 1) : null;
  };
  const solves = await Promise.all(
    campaign.tasks.map((task) =>
      Promise.all(Array.from({ length: setting.solves }, () => once(campaign.pack(task), 2))),
    ),
  );
  if (stop.aborted) {
    throw new Error("the session ended while the starter harness solved the draft's examples");
  }
  const events = read(campaign.log);
  const ran = new Map(solvesIn(events).map((each) => [each.id, each]));
  const verdicts = verdictsOf(events);
  const examples = solves.map((ids, index) => {
    const counted = ids.flatMap((id) => {
      const solve = ran.get(id ?? "");
      const valid = solve === undefined ? null : passed(solve);
      const measure = verdicts.get(id ?? "")?.checker;
      return valid === null
        ? []
        : [
            {
              valid,
              turns: isNumber(solve?.end?.turns) ? solve.end.turns : null,
              measure: measure?.kind === "pass" ? (measure.objective ?? null) : null,
            },
          ];
    });
    const task = exampleId(index);
    const room = informative(
      {
        task,
        old: counted.map(({ valid }) => valid),
        fresh: [],
        ...keyIfDefined(
          "objective",
          draft.objective && {
            direction: draft.objective.direction,
            old: counted.map(({ measure }) => measure),
            fresh: [],
          },
        ),
      },
      "old",
      new Set([task]),
    );
    const took = counted.flatMap(({ turns }) => (turns === null ? [] : [String(turns)]));
    const valid = counted.filter((each) => each.valid).length;
    return {
      room,
      line: `example ${String(index)}: ${String(valid)} of ${plural(counted.length, "solve")} valid${took.length === 0 ? "" : `, taking ${took.join(", ")} model turns`}`,
    };
  });
  if (examples.some(({ room }) => room)) return [];
  const bettered =
    draft.objective === undefined ? "" : ", and no valid answer bettered another by the objective";
  return [
    [
      `the Starter Built Harness, the harness every campaign starts from, answered every example validly on every solve it finished under the campaign's budget${bettered}`,
      ...examples.map(({ line }) => `  - ${line}`),
    ].join("\n"),
  ];
}

/** `bun tools/d1b/draft.ts`. `session` runs the Examiner's session: `examine`, unless a caller
 *  with no model stands in for it. `seated` solves a draft's examples under the starter
 *  (`starterFaults`); a caller that stands in for the session seats no solver unless it names one. */
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
  // The starter's reading refuses one draft a session; a later one stands with it as a note.
  const desk = { refused: false };
  const drafted = await session(
    {
      id,
      mode: "draft",
      prompt,
      budget: { modelTurns: modelTurns ?? null, minutes: wallSeconds / 60, solves: setting.solves },
      reading: async (draft, stop) => {
        const reading = await draftReading(dirname(log), draft, Number(values.jobs));
        if (reading.faults.length > 0 || seated === null) return reading;
        const starterRead = await starterFaults({ name, session: id, setting, seated }, draft, stop);
        if (desk.refused) return { ...reading, notes: [...reading.notes, ...starterRead] };
        desk.refused = starterRead.length > 0;
        return {
          ...reading,
          faults: starterRead.map(
            (fault) =>
              `${fault}\n  This reading refuses one draft a session: the next draft with no other fault stands, with this reading as a note.`,
          ),
        };
      },
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

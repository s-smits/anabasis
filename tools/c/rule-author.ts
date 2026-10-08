/**
 * One Rule Author session over a campaign: one addition to its correctness model, a public rule
 * with a check of its own, left as a candidate pack and adopted by nobody here.
 *
 *   bun tools/c/rule-author.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session r-1 \
 *     --author claude/claude-opus-5-5
 *
 * It first says what binds the campaign's climb (`src/kernel/binding.ts`), read as `prepare.ts`
 * reads it, and starts only while that is `correctness-model`: the tasks a second Examiner
 * session wrote against the harness the campaign stands on, told what the first measured, are
 * still mostly passed. While anything else binds, the exam has room the checks already give, and
 * a requirement added to an exam the harness still fails makes it harder to tell what a step did.
 * `--anyway` starts it all the same, and the session's record keeps what the reading was.
 *
 * The session (`src/rules/session.ts`) is given the pack's contract and checks, its check
 * program's source, the pack's tasks and the ones sessions wrote, the answers stronger solves were
 * accepted on, and what was measured of the campaign's tasks. Its addition meets four gates:
 * shape, with the proof that nothing existing moved, its controls, a repeat of them, and the
 * interference reading. `--tries` is how many additions it may put to them, and `--jobs` the
 * verifier runs in flight at once.
 *
 * The interference grades every accepted answer on record under the candidate: each answer the
 * log holds a pass for, the pack's accept controls, and the stored sweep's passes. While the
 * session runs its check is put only to the stronger solves' witnesses, which it may read, and it
 * is told what the check makes of those. The others are graded when the session is over.
 *
 * What it leaves is `.ana/d2/<name>/candidates/<session>/`, a pack laid out as `--bundle` is,
 * and `rule.candidate` in the log. The campaign goes on under the checker it had. Taking a
 * candidate into a running campaign is another command's work, and the operator's decision.
 *
 * Not run here: see `../d2/campaign.ts`. It needs the pack, its tool tree, the Mac's verifier wall
 * and a model login.
 */
import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { binding } from "#src/kernel/binding.ts";
import { sweepOf } from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { openVerifier, type Task } from "#src/kernel/verify.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import type { Stored } from "#src/rules/gates.ts";
import { authorRule } from "#src/rules/session.ts";
import {
  frontier,
  LIMITS,
  openCampaign,
  SCREENING_OPTIONS,
  screeningRule,
  stayAwake,
  writtenTasks,
} from "../d2/campaign.ts";
import { ROUND_OPTIONS } from "../d2/round.ts";
import {
  checkProgram,
  modelNamed,
  packControls,
  storedAnswer,
  sweepRows,
  toolOnPath,
} from "../m0/stored-sweep.ts";

type Campaign = Awaited<ReturnType<typeof openCampaign>>;

/** Who sits in the session's one model seat. A simulation gives a script. */
export type Seated = (
  campaign: Campaign,
  author: string | undefined,
) => { readonly model: Model<Api>; readonly models: (home: string) => Models };

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
  author: { type: "string" },
  "author-effort": { type: "string", default: "high" },
  anyway: { type: "boolean", default: false },
  tries: { type: "string", default: "4" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "120" },
  jobs: { type: "string", default: String(LIMITS.concurrency) },
  ...SCREENING_OPTIONS,
  level: ROUND_OPTIONS.level,
} as const;

/** The binding a Rule Author session waits for. */
const SPENT = "correctness-model";

/** This host's backends, as an Examiner's: the author works from what it is shown, and a search
 *  of its own would be read by nobody. */
const hosted: Seated = (campaign, author) => {
  if (author === undefined) throw new Error("name --author");
  return { model: modelNamed(author), models: campaign.examiner };
};

/**
 * Every accepted answer a log holds, each as a witness or as another solve's: the last verdict of
 * each solve, where it is a pass, of a task still known. A witness is the answer of the solve a
 * task's gate 2 passed on, which a stronger solver made and an Examiner was shown; every other
 * pass is a measured solver's or a practice solve's, and no author is shown one. The witnesses
 * come first, so that an answer two solves share is read as the witness it is.
 */
export function storedIn(events: readonly LogEvent[], tasks: readonly Task[]): Stored[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const witnessing = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "task.gate" && data.gate === 2 && data.outcome === "passed" && isString(data.solve)
        ? [data.solve]
        : [],
    ),
  );
  const last = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "verdict" && isString(data.solve) ? [[data.solve, data]] : [],
    ),
  );
  const passes = [...last].flatMap(([solve, data]): Stored[] => {
    const task = byId.get(isString(data.task) ? data.task : "");
    return task === undefined || data.kind !== "pass" || data.answer === undefined
      ? []
      : [{ task, answer: data.answer, from: witnessing.has(solve) ? "witness" : "solve" }];
  });
  return [
    ...passes.filter(({ from }) => from === "witness"),
    ...passes.filter(({ from }) => from !== "witness"),
  ];
}

/** `bun tools/c/rule-author.ts`: the exit code, 1 when the session was not started. */
export async function ruleCommand(args: readonly string[], seated: Seated = hosted): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { root, sweep, cycle, bundle, name, session } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined ||
    session === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle, --name and --session");
  }
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const events = read(campaign.log);
  const harness = await frontier(campaign);
  const standsOn = { harness: harness.digest, setting: campaign.setting(campaign.test) };
  const screening = screeningRule(values);
  const short = binding(events, standsOn, { rule: screening, least: sweepOf(Number(values.level)) });
  console.log(`what binds: ${short.binds}. ${short.why}`);
  if (short.binds !== SPENT && !values.anyway) {
    console.log(
      `not started: a Rule Author session waits for ${SPENT}. A requirement added to an exam the harness still fails makes it harder to tell what a step did. --anyway starts it all the same.`,
    );
    return 1;
  }
  const seat = seated(campaign, values.author);
  const tasks = [...campaign.tasks, ...writtenTasks(events)];
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  // The accepted answers the pack and the stored sweep hold beside the log's: host-only readings.
  const kept = [
    ...packControls(bundle).flatMap(({ taskId, answer, refusedBy }) =>
      refusedBy === null ? [{ taskId, answer, from: "control" as const }] : [],
    ),
    ...sweepRows(root, sweep).flatMap((row) => {
      const answer = row.expected?.kind === "pass" ? storedAnswer(row) : undefined;
      return answer === undefined ? [] : [{ taskId: row.taskId, answer, from: "sweep" as const }];
    }),
  ].flatMap(({ taskId, answer, from }): Stored[] => {
    const task = byId.get(taskId);
    return task === undefined ? [] : [{ task, answer, from }];
  });
  stayAwake();
  const authored = await authorRule({
    id: session,
    contract: campaign.contract,
    base: campaign.checker,
    pack: bundle,
    candidates: join(dirname(campaign.log), "candidates"),
    tasks,
    stored: [...storedIn(events, tasks), ...kept],
    standsOn,
    screening,
    binding: short,
    stage: checkProgram,
    verifier: (checks) => openVerifier({ checks, tools: join(bundle, ".toolchain") }),
    found: toolOnPath(bundle),
    ...seat,
    // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
    effort: values["author-effort"] as ThinkingLevel,
    limits: {
      wallSeconds: Number(values.minutes) * 60,
      turns: Number(values.turns),
      concurrency: Number(values.jobs),
      tries: Number(values.tries),
    },
    log: campaign.log,
  });
  const { candidate } = authored;
  console.log(
    `the session ended ${authored.ended}, after ${String(authored.tries)} of its tries at the gates`,
  );
  if (candidate === null) {
    console.log("no candidate was left: the campaign's pack and its checker are as they were");
    return 0;
  }
  const { interference: found } = candidate;
  console.log(
    `candidate: ${candidate.dir}, the campaign's pack with rule ${candidate.rule} and check ${candidate.check} added; contract ${candidate.checker.contract}, check program ${candidate.checker.checks}`,
  );
  console.log(
    `interference: of ${String(found.applied)} accepted answers on record that ${candidate.check} applies to, it refuses ${String(found.refused)} and could not run on ${String(found.unrunnable)}; ${String(found.stale)} more the existing checks no longer accept`,
  );
  for (const task of found.tasks) {
    console.log(
      `  ${task.taskId}\trefused ${String(task.refused)}\tcould not run on ${String(task.unrunnable)}\tstill accepted ${String(task.kept)}`,
    );
  }
  console.log(`reading: ${found.reading}${found.suspect ? ", suspect" : ""}: ${found.note}`);
  console.log(
    `Nothing is adopted: the campaign still runs under contract ${campaign.checker.contract} and check program ${campaign.checker.checks}. The next step is the operator's: read the candidate, and if the exam is to take it, give ${candidate.dir} as the pack to the command that adopts a changed pack into this campaign; otherwise leave or delete it.`,
  );
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await ruleCommand(Bun.argv.slice(2));

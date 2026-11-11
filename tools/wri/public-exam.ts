/**
 * The public side of a campaign's exam, for lane 4 to write its alternatives from before it reads
 * anything that could lead it: the contract as the Builder is given it (`contractOf`, the stand-in
 * `openCampaign` builds its seats' contract with), and each released task's public input with the
 * answers its practice solves passed with, which a Builder reads in their traces.
 *
 *   bun tools/wri/public-exam.ts <log | campaign folder | name> [--bundle <pack>]
 *
 * Between 3 and 10 November all 7 lane 4 sessions pulled the released tasks and their practice
 * passes out of the log by hand, about 70 calls, and `exam.drafted`, the one event that holds the
 * public rules whole, holds the evaluator's source beside them, which a session reading it to stay
 * blind had to strip by hand.
 *
 * It prints only what crosses the wall (`AGENTS.md`, section 1): each rule's id and statement, the
 * conventions, the scope, the objective and the answer format; each released task's public input;
 * and the answers of practice solves (`practiceRan`), never a comparison's or an Examiner's. It
 * reads no check, evaluator, control answer, hidden value, Referee finding or held-out task's input,
 * so none can reach its output, and a held-out task is counted only. A stored pack's answer format
 * is its sweep's, which the log does not hold, and the view says so.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { objectiveLine } from "#src/kernel/contract.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { practiceRan, verdictsOf } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { stagedExamOf } from "#tools/d2/exam.ts";
import { contractOf, readPack } from "#tools/m0/stored-sweep.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { NO_TRACES } from "./folds.ts";
import { proposedTasks } from "./tasks.ts";

const USAGE = "usage: bun tools/wri/public-exam.ts <log | campaign folder | name> [--bundle <pack>]";

/** The released tasks, each with its public input and the distinct answers its practice solves
 *  passed with, by digest, with how many solves gave each. */
function releasedLines(events: readonly LogEvent[], bundle: string): string[] {
  const { held, released } = taskSets(events);
  const packed = new Map(readPack(bundle).tasks.map((task) => [task.taskId, task.publicInput] as const));
  const proposals = new Map(proposedTasks(events).map((proposal) => [proposal.version, proposal] as const));
  const verdicts = verdictsOf(events);
  const passes = Map.groupBy(
    practiceRan(events).filter(({ id }) => verdicts.get(id)?.kind === "pass"),
    ({ under }) => under.task,
  );
  const lines = released.flatMap((version) => {
    const proposal = proposals.get(version);
    const taskId = proposal?.taskId ?? null;
    const input = proposal?.input?.publicInput ?? packed.get(taskId ?? "");
    const answers = new Map<string, { answer: string; solves: number }>();
    for (const { id } of passes.get(version) ?? []) {
      const answer = verdicts.get(id)?.answer;
      if (answer === undefined) continue;
      const digest = hashJsonValue(answer).slice(0, 8);
      const seen = answers.get(digest);
      answers.set(digest, { answer: capturedJsonStringify(answer), solves: (seen?.solves ?? 0) + 1 });
    }
    return [
      `${taskId ?? "no id"}  family ${proposal?.family ?? "none"}  version ${version.slice(0, 8)}`,
      `  public: ${input === undefined ? "not in the log or the pack" : capturedJsonStringify(input)}`,
      ...(answers.size === 0
        ? ["  no practice solve passed it"]
        : [...answers].map(
            ([digest, { answer, solves }]) =>
              `  practice pass ${digest} (${plural(solves, "solve")}): ${answer}`,
          )),
    ];
  });
  return [
    `released: ${plural(released.length, "task")}`,
    ...lines,
    `held out: ${plural(held.length, "task")}, whose public input this view does not print`,
  ];
}

/** The public exam as lines, from the log and the pack the exam is staged as. */
export function publicExam(events: readonly LogEvent[], bundle: string): string[] {
  const format = draftOf(events)?.answerFormat;
  const contract = contractOf(readPack(bundle).brief, format ?? null);
  return [
    "public exam: what crosses to the Builder of this campaign's exam, and its released tasks with their practice passes",
    "rules:",
    ...contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`),
    `conventions: ${contract.conventions || "none"}`,
    `scope: ${contract.scope}`,
    `objective: ${contract.objective === undefined ? "none declared" : objectiveLine(contract.objective)}`,
    `answer format: ${format === undefined ? "not in the log (a stored pack's is its sweep's)" : capturedJsonStringify(format)}`,
    ...releasedLines(events, bundle),
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const log = await logAcross(args.positionals[0] ?? args.required("log"), "record");
  const bundle = args.value("bundle") ?? stagedExamOf(log)?.bundle;
  if (bundle === undefined) {
    throw new Error("name --bundle: the campaign drafted no exam, so its pack is a stored one");
  }
  console.log(publicExam(read(log, NO_TRACES), bundle).join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand(
    { name: "public-exam", usage: USAGE, options: { log: "text", bundle: "text" }, positionals: [0, 1] },
    main,
  );
}

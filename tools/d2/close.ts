/**
 * What a campaign hands over: its reference harness as a directory that stands by itself, and a
 * closing report.
 *
 *   bun tools/d2/close.ts --name queues --to ~/handover/queues
 *   bun tools/d2/close.ts --root ... --sweep ... --cycle c01 --bundle ... --name truss --to ../truss-handover
 *
 * Until 2026-10-09 a campaign handed nothing over: a kept harness stayed a folder among the
 * campaign's states, with its programs behind a link into a tree beside it, and what the campaign
 * had read stood in its log alone (`docs/plan.md`, row F51). This writes, under `--to`:
 *
 *   harness/     the reference harness as it then stands, the starter where no step was promoted,
 *                copied whole with its programs. It is opened there before the command returns,
 *                and has to open as the harness it was kept as.
 *   RULES.md     the domain's public contract: its scope, conventions, rules and answer format.
 *   REPORT.md    the closing report: how the campaign ended, each promotion and the comparisons
 *                behind it, every comparison's tally and reading, what the Referee ruled and what
 *                a person's labels settled, and what was billed.
 *
 * The report is a view of the log, written once, and nothing reads it back. It names no task and
 * holds no check, hidden value or answer, so the folder can leave the exam side: `--to` lies
 * outside the repository, which holds the logs.
 *
 * The campaign command writes it at an ending where `--handover <dir>` names the place
 * (`harness-builder.ts`), and this command writes it at any time, of an ended campaign or not.
 *
 * With `--solve <task id>` it then solves that task of the campaign under the harness as handed
 * over, from the folder it was written to: row F51's criterion that the harness runs by itself.
 * The solve is the campaign's solver's, under the campaign's checks, and is recorded in a log of
 * its own under the campaign's folder (`handover/log.jsonl`), which no reading of the campaign
 * counts; the command prints how it ended. A released task is the one to name: a held-out task
 * is solved for nothing a Builder could learn from, but its answer then lies in that log.
 */
import { campaignOf, type Handover } from "#src/builder/handover.ts";
import { openingOf } from "#src/builder/opening.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { billedAll, promoted } from "#src/kernel/reports.ts";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { DIAGNOSIS_LABELS, diagnosesAgreement } from "#src/review/agreement.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openHarness } from "#src/solve/harness.ts";
import { keptAs, openCampaign, PROMOTED, packNamed } from "./campaign.ts";
import { type Seated, solved } from "./round.ts";
import { recordedSetting } from "./setting.ts";

type Campaign = Awaited<ReturnType<typeof openCampaign>>;
type Compared = Extract<Handover, { step: "comparison" }>;

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  to: { type: "string" },
  solve: { type: "string" },
} as const;

const short = (digest: string): string => digest.slice(0, 8);
const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

/** A comparison as one row: its two harnesses, the turns its solves were held to, its reading and
 *  tally, and each harness's valid solves. */
function comparisonRow(step: Compared): string {
  const share = (counts: readonly number[] | undefined) => {
    if (counts === undefined) return "";
    const valid = counts.reduce((sum, tasks, solves) => sum + tasks * solves, 0);
    return `${String(valid)} of ${String(counts.reduce((sum, tasks) => sum + tasks, 0) * (counts.length - 1))}`;
  };
  const { tally } = step;
  return row([
    step.id,
    short(step.fresh),
    short(step.old),
    step.modelTurns === null ? "not limited" : String(step.modelTurns),
    step.reading ?? "not reported",
    tally === null ? "" : `${String(tally.wins)}-${String(tally.losses)}-${String(tally.ties)}`,
    share(step.valid?.fresh),
    share(step.valid?.old),
    step.billed.toFixed(2),
  ]);
}

/** The closing report of a campaign, from its log: Markdown, a view and no record. */
function closingReport(name: string, events: readonly LogEvent[], handed: string): string {
  const { steps, supply } = campaignOf(events);
  const comparisons = steps.filter((step): step is Compared => step.step === "comparison");
  const ended = events.at(-1)?.kind === "campaign.ended" ? events.at(-1)?.data : undefined;
  const opening = openingOf(events);
  const setting = recordedSetting(events);
  const reference = promoted(events);
  // A step is named with the budget it was read at, and the reading at the full limit beside
  // it: a step at a shortened budget says the harness answers within that budget what the
  // reference does not, which a harness that saves a solver its set-up reads as, and the full
  // limit says whether it holds where the solver has the time (`AGENTS.md`, section 9).
  const promotions = events.flatMap(({ kind, at, data }) => {
    if (kind !== "harness.promoted" || !isString(data.harness)) return [];
    const stepped = comparisons.filter((each) => each.fresh === data.harness && each.reading === "step");
    const budgets = [...new Set(stepped.map(({ modelTurns }) => modelTurns))];
    const atBudget = budgets
      .map((turns) => (turns === null ? "the full limit" : plural(turns, "turn")))
      .join(" and ");
    const full = comparisons.findLast(
      (each) =>
        each.fresh === data.harness && each.modelTurns === (opening?.limit ?? null) && each.tally !== null,
    );
    const held =
      full?.tally === null || full === undefined
        ? ". No comparison of it at the full limit tallied a task"
        : `. At the full limit (${full.id}) it won ${String(full.tally.wins)}, lost ${String(full.tally.losses)} and tied ${String(full.tally.ties)}`;
    return [
      `- ${at.slice(0, 10)}: harness ${short(data.harness)}, read by ${stepped.map((each) => each.id).join(" and ") || "no comparison on record"}${stepped.length === 0 ? "" : ` at ${atBudget}`}${held}${isString(data.despite) ? `. Promoted on the operator's reason, where the rule did not name it: ${data.despite}` : ""}`,
    ];
  });
  const ruled = comparisons.reduce(
    (sum, { rulings }) => ({
      earned: sum.earned + rulings.earned,
      defect: sum.defect + rulings["check-defect"],
      unclear: sum.unclear + rulings.unclear,
    }),
    { earned: 0, defect: 0, unclear: 0 },
  );
  const settled = events.filter(
    ({ kind, data }) => kind === "comparison.reported" && data.settled != null,
  ).length;
  // What a person read of the answers that passed, one record a comparison (`settle.ts --passes`).
  const passes = { comparisons: 0, read: 0, of: 0, sound: 0, wrong: 0, unclear: 0 };
  for (const { kind, data } of events) {
    if (kind !== "pass.labelled") continue;
    passes.comparisons += 1;
    passes.of += isNumber(data.of) ? data.of : 0;
    for (const label of Object.values(asRecord(data.labels) ?? {})) {
      if (label !== "sound" && label !== "wrong" && label !== "unclear") continue;
      passes[label] += 1;
      passes.read += 1;
    }
  }
  const sessions = steps.filter((step) => step.step === "builder").length;
  const budget = opening?.budget ?? null;
  return [
    `# ${name}: closing report`,
    ended === undefined
      ? `The campaign has not ended: the last event of its log is \`${events.at(-1)?.kind ?? "none"}\`.`
      : `The campaign ended on its ${isString(ended.ending) ? ended.ending : "?"}: ${isString(ended.why) ? ended.why : ""}.`,
    `It hands over harness ${short(handed)}, in \`harness/\`: ${
      reference === null
        ? "the Starter Built Harness, since no step was promoted"
        : "the reference harness, promoted as below"
    }.`,
    ...(isString(opening?.prompt)
      ? [`It opened from this prompt:\n\n> ${opening.prompt.replaceAll("\n", "\n> ")}`]
      : []),
    setting === null
      ? "No comparison began, so no setting is on record."
      : `Its setting: ${setting.solver === null ? "the stored cycle's solver" : `${setting.solver.model} at ${setting.solver.effort}`}, ${String(setting.minutes)} minutes a solve, ${setting.modelTurns === null ? "the solver's turns not limited" : `${plural(setting.modelTurns, "turn")} of the solver's own`}.`,
    "## Promotions",
    promotions.join("\n") || "None.",
    "## Every comparison",
    [
      row([
        "id",
        "new",
        "against",
        "turns told",
        "reading",
        "won-lost-tied",
        "new valid",
        "reference valid",
        "billed $",
      ]),
      row(Array.from({ length: 9 }, () => "---")),
      ...comparisons.map(comparisonRow),
    ].join("\n"),
    "A reading is of one setting. Tallies under different limits, or against different harnesses, are not one series.",
    "## What was audited, and what was not",
    [
      `- The exam: its checker ${supply.faults === null ? "was never read" : `was read, with ${plural(supply.faults, "fault")} in its last reading`}, and ${frozenChecker(events) === null ? "nobody froze it" : "the operator froze it"}.`,
      `- Rejected answers: the Referee ruled ${String(ruled.earned)} earned, ${String(ruled.defect)} a check defect and ${String(ruled.unclear)} unclear. A ruling is a model's reading and is not measured against a person's labels here.`,
      `- A person's labels settled ${plural(settled, "comparison")}. ${plural(supply.awaiting, "held-out task")} ${supply.awaiting === 1 ? "waits" : "wait"} for a person to say whether a valid answer exists.`,
      passes.comparisons === 0
        ? "- No answer that passed was read by anyone: a pass is the checks' word alone."
        : `- Answers that passed: a person read ${String(passes.read)} of the ${String(passes.of)} in ${plural(passes.comparisons, "comparison")}, drawn by each comparison's id: ${String(passes.sound)} sound, ${String(passes.wrong)} wrong, ${String(passes.unclear)} unclear. A wrong pass is a check's fault, and changes no tally.`,
      diagnosesLine(events),
    ].join("\n"),
    "## Work and spend",
    `${plural(sessions, "Builder session")}, ${plural(steps.filter((step) => step.step === "examiner").length, "Examiner session")} and ${plural(comparisons.length, "comparison")}. Billed $${billedAll(events).toFixed(2)}${budget === null ? "" : ` of a budget of $${String(budget.dollars)}`}.`,
    "",
  ].join("\n\n");
}

/** What the Diagnoser said of the campaign's practice fails, and what a person's blind labels of
 *  them say of its lean (`settle.ts --diagnoses`). A diagnosis enters no verdict. */
function diagnosesLine(events: readonly LogEvent[]): string {
  const labelled = events.findLast(({ kind }) => kind === "diagnosis.labelled")?.data.labels;
  const labels = new Map(
    Object.entries(asRecord(labelled) ?? {}).flatMap(([solve, label]) => {
      const known = DIAGNOSIS_LABELS.find((each) => each === label);
      return known === undefined ? [] : [[solve, known] as const];
    }),
  );
  const found = diagnosesAgreement(events, labels);
  if (found.recorded === 0) return "- No practice fail was diagnosed.";
  const lean = `the Diagnoser named the solver in ${String(found.solver)} of ${String(found.recorded)} ${found.recorded === 1 ? "diagnosis" : "diagnoses"}`;
  return found.labelled === 0
    ? `- Diagnoses: ${lean}; no person has labelled one, so its lean is unmeasured.`
    : `- Diagnoses: ${lean}; a person labelled ${String(found.labelled)} blind and agreed with ${String(found.agreed)}. A diagnosis is the Builder's lead and enters no verdict.`;
}

/** The public contract as a solver reads it, for whoever takes the harness over. */
function rulesOf({ contract }: Pick<Campaign, "contract">): string {
  return [
    "# Public rules",
    `Scope: ${contract.scope}`,
    ...(contract.conventions === "" ? [] : [`Conventions: ${contract.conventions}`]),
    contract.rules.map((rule) => `- ${rule.id}: ${rule.statement}`).join("\n"),
    `An answer is one JSON value that follows this schema:\n\n\`\`\`json\n${capturedJsonStringify(contract.answerFormat, null, 2)}\n\`\`\``,
    "",
  ].join("\n\n");
}

/** `bun tools/d2/close.ts`. Returns where the handover was written and the harness it holds. */
export async function closeCommand(args: readonly string[], seated: Seated = solved) {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  if (values.to === undefined) throw new Error("name --to, the folder the handover is written to");
  const to = resolve(values.to);
  const pack = packNamed(values, " and --to");
  const campaign = await openCampaign(pack);
  if (containsPath(to, campaign.repo)) {
    throw new Error(
      `--to ${to} lies inside the repository, which holds the campaign's logs: a handover leaves it`,
    );
  }
  if (existsSync(to) && readdirSync(to).length > 0) {
    throw new Error(`--to ${to} holds something already: a handover is written to a folder of its own`);
  }
  const kept = await keptAs(campaign, "--reference", PROMOTED);
  const harness = join(to, "harness");
  mkdirSync(to, { recursive: true });
  // Whole, with what its links name: a kept harness's programs stand in a tree beside it.
  cpSync(kept.dir, harness, { recursive: true, dereference: true });
  const opened = await openHarness(harness);
  if (opened.digest !== kept.digest) {
    throw new Error(
      `${harness} opens as harness ${short(opened.digest)}, and the campaign keeps ${short(kept.digest)}: the copy is not the harness, and is not handed over as it`,
    );
  }
  const events = read(campaign.log);
  writeFileSync(join(to, "RULES.md"), rulesOf(campaign));
  writeFileSync(join(to, "REPORT.md"), closingReport(pack.name, events, kept.digest));
  console.log(`handed over harness ${short(kept.digest)} with its report: ${to}`);
  if (values.solve === undefined) return { to, harness: kept.digest, solved: null };
  // The tasks an Examiner session wrote are in the log and in no pack.
  const task = [...writtenTasks(events), ...campaign.tasks].find(({ taskId }) => taskId === values.solve);
  if (task === undefined) throw new Error(`--solve ${values.solve}: the campaign holds no task by that id`);
  const trialLog = join(campaign.log, "..", "handover", LOG_FILE);
  mkdirSync(join(campaign.log, "..", "handover"), { recursive: true });
  const trial = await openCampaign({ ...pack, trial: trialLog });
  const { solve } = seated(trial, { builder: undefined, reference: PROMOTED });
  const trialled = await solve(trial.pack(task), { dir: harness, digest: opened.digest }, undefined);
  console.log(
    `solved task ${task.taskId} under harness ${short(opened.digest)} from ${harness}: ${trialled.ending.outcome}${"kind" in trialled.ending ? ` (${trialled.ending.kind})` : ""}, recorded in ${trialLog}`,
  );
  return { to, harness: kept.digest, solved: trialled.ending.outcome };
}

if (import.meta.main) {
  await closeCommand(Bun.argv.slice(2));
  runtimeProcess.exitCode = 0;
}

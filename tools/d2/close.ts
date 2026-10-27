/**
 * What a campaign hands over: its reference harness as a directory that stands by itself, and a
 * closing report.
 *
 *   bun tools/d2/close.ts --name queues --to ~/handover/queues
 *   bun tools/d2/close.ts --root ... --sweep ... --cycle c01 --bundle ... --name truss --to ../truss-handover
 *
 * Until 2026-10-09 a campaign handed nothing over: a kept harness stayed a folder among the
 * campaign's states, with its programs behind a link into a tree beside it, and what the campaign
 * had read stood in its log alone (`7f0add79:docs/plan.md`, row F51). This writes, under `--to`:
 *
 *   harness/     the reference harness as it then stands, the starter where no step was promoted,
 *                copied whole with its programs. It is opened there before the command returns,
 *                and has to open as the harness it was kept as; where it does not, nothing is left
 *                under `--to`. Its links are copied as links: until 11 October they were followed,
 *                and a link in its programs to a host file came out as that file's bytes, in a
 *                folder written to leave the host.
 *   RULES.md     the domain's public contract: its scope, conventions, rules and answer format.
 *   REPORT.md    the closing report: how the campaign ended, each promotion and the comparisons
 *                behind it, every comparison's tally and reading, the chance of a false promotion
 *                over the whole campaign (`riskLines`), which checks their author's own computation
 *                decides (`unadmitted`), what the Referee ruled and what a person's labels
 *                settled, and what was billed. It names each harness by its letter beside its
 *                digest's head (`namesOf`, `src/campaign/names.ts`).
 *                Calculated spend stays the economy numerator; backend totals carry coverage and
 *                a residual on matching closed records, with open backend costs unknown.
 *                Comparison unit costs count scored versions in the last report; a report with
 *                none retains its bill without a unit price.
 *
 * Until 20 October the report said the checker was read and frozen, and not what decides it: in
 * buffer-fresh-opus-forkedPR223_v0_5_4-r3 every one of the 7 checks, the objective among them, was
 * its author's own computation, and a reader of the report could not tell.
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
import { promotionsWorth, riskLines, worthLine } from "#src/campaign/climb.ts";
import { UNSETTLED } from "#src/campaign/comparison.ts";
import { campaignOf, type Handover } from "#src/campaign/handover.ts";
import { short } from "#src/campaign/move.ts";
import { type Called, calledBy, namesOf } from "#src/campaign/names.ts";
import { copyHarness } from "#src/builder/kept.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { frozenChecker, unadmitted } from "#src/kernel/acceptance.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { comparisonsOf } from "#src/campaign/ground.ts";
import { promoted } from "#src/kernel/reports.ts";
import { billedAll, billedParts, costLine } from "#src/kernel/trace.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openHarness } from "#src/harness/open.ts";
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

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

/** A comparison as one row: its two harnesses as `called`, the turns its solves were held to, its
 *  reading and tally, and each harness's valid solves. */
function comparisonRow(step: Compared, called: Called): string {
  const share = (counts: readonly number[] | undefined) => {
    if (counts === undefined) return "";
    const valid = counts.reduce((sum, tasks, solves) => sum + tasks * solves, 0);
    return `${String(valid)} of ${String(counts.reduce((sum, tasks) => sum + tasks, 0) * (counts.length - 1))}`;
  };
  const { tally } = step;
  return row([
    step.id,
    called(step.fresh),
    called(step.old),
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
  const called = calledBy(namesOf(events));
  const promotions = promotionLines(events, comparisons, called);
  const ruled = comparisons.reduce(
    (sum, { rulings }) => ({
      earned: sum.earned + rulings.earned,
      defect: sum.defect + rulings["check-defect"],
      unclear: sum.unclear + rulings.unclear,
    }),
    { earned: 0, defect: 0, unclear: 0 },
  );
  // Each comparison's last word on its packet (`settle.ts`): unsettled, or what settled it.
  const packets = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "comparison.reported" ? [[data.session, data.settled] as const] : [],
    ),
  );
  const settled = packets
    .values()
    .map((each) => asRecord(each))
    .filter((each) => each !== null)
    .toArray();
  const unsettled = packets
    .values()
    .filter((each) => each === UNSETTLED)
    .toArray().length;
  // What a person read of the answers that passed, drawn in each settled packet.
  const passes = { comparisons: 0, read: 0, sound: 0, wrong: 0, unclear: 0 };
  for (const labels of settled.map((each) => Object.values(asRecord(each.passes) ?? {}))) {
    passes.comparisons += labels.length === 0 ? 0 : 1;
    for (const label of labels) {
      if (label !== "sound" && label !== "wrong" && label !== "unclear") continue;
      passes[label] += 1;
      passes.read += 1;
    }
  }
  const sessions = steps.filter((step) => step.step === "builder").length;
  // The checks of the last reading that no installed instrument decides, the objective among them.
  const authored = unadmitted(events, []);
  const budget = opening?.budget ?? null;
  return [
    `# ${name}: closing report`,
    ended === undefined
      ? `The campaign has not ended: the last event of its log is \`${events.at(-1)?.kind ?? "none"}\`.`
      : `The campaign ended on its ${isString(ended.ending) ? ended.ending : "?"}: ${isString(ended.why) ? ended.why : ""}.`,
    `It hands over harness ${called(handed)}, in \`harness/\`: ${
      reference === null
        ? "the Starter Built Harness, since no step was promoted"
        : "the reference harness, promoted as below"
    }. A harness is named by a letter in the order the log first names it, the Starter A, with its digest's first eight characters beside it: a later letter is a later harness, not a better one.`,
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
      ...comparisons.map((step) => comparisonRow(step, called)),
    ].join("\n"),
    "A reading is of one setting. Tallies under different limits, or against different harnesses, are not one series.",
    "## The chance of a false promotion",
    riskLines(events).join("\n"),
    "## What was audited, and what was not",
    [
      `- The exam: its checker ${supply.faults === null ? "was never read" : `was read, with ${plural(supply.faults, "fault")} in its last reading`}, and ${frozenChecker(events) === null ? "nobody froze it" : "the operator froze it"}.`,
      ...(authored.length === 0
        ? []
        : [
            `- What decides a pass: ${plural(authored.length, "check")} of the checker's last reading ${authored.length === 1 ? "is" : "are"} decided by ${authored.length === 1 ? "its" : "their"} author's own computation and no installed instrument; the operator admitted ${String(authored.length - unadmitted(events).length)}. Such a check agrees with its author by construction: nothing outside the exam confirms what it lets pass.`,
          ]),
      `- Rejected answers: the Referee ruled ${String(ruled.earned)} earned, ${String(ruled.defect)} a check defect and ${String(ruled.unclear)} unclear. A ruling is a model's reading and is not measured against a person's labels here.`,
      `- A person's labels settled ${plural(settled.length, "comparison")}, and ${plural(unsettled, "comparison")} ${unsettled === 1 ? "is" : "are"} unsettled: ${unsettled === 1 ? "its packet waits" : "their packets wait"} for a person (settle.ts), and no promotion waited for one. ${plural(supply.awaiting, "held-out task")} ${supply.awaiting === 1 ? "waits" : "wait"} for a person to say whether a valid answer exists.`,
      passes.comparisons === 0
        ? "- No answer that passed was read by anyone: a pass is the checks' word alone."
        : `- Answers that passed: a person read ${String(passes.read)} in ${plural(passes.comparisons, "comparison")}, drawn uniformly by each comparison's id: ${String(passes.sound)} sound, ${String(passes.wrong)} wrong, ${String(passes.unclear)} unclear. A wrong pass is a check's fault, and its side's fail once settled.`,
    ].join("\n"),
    "## Work and spend",
    `${plural(sessions, "Builder session")}, ${plural(steps.filter((step) => step.step === "examiner").length, "Examiner session")} and ${plural(comparisons.length, "comparison")}. Calculated spend $${billedAll(events).toFixed(2)}${budget === null ? "" : ` of a total of $${String(budget.dollars)}`}; ${costLine(events)}.`,
    economyLines(events, steps).join("\n"),
    "",
  ].join("\n\n");
}

/**
 * What each measured thing cost, from the log alone: the Examiner's dollars a task it held out,
 * its own turns and its admission solves together; a comparison's a task it scored; and how many of the
 * comparisons that began reported, since one cut before its report bought nothing it can show.
 */
function economyLines(events: readonly LogEvent[], steps: readonly Handover[]): string[] {
  const per = (dollars: number, count: number, what: string) =>
    count > 0 ? `$${(dollars / count).toFixed(2)} a ${what} (${String(count)})` : `no ${what}`;
  // The handover's Examiner steps, an open or cut session's by its gated proposals: until 25 October
  // only ended sessions were read here, and buffer-141 said 2 tasks held out where it held out 7.
  const exams = steps.flatMap((step) => (step.step === "examiner" ? [step] : []));
  const examined = exams.reduce((sum, { billed }) => sum + billed, 0);
  const held = exams.reduce((sum, step) => sum + step.held, 0);
  const all = comparisonsOf(events);
  const reported = all.filter(({ report }) => report !== null);
  const compared = reported.reduce((sum, { id }) => sum + billedParts(events, id).comparison, 0);
  const scored = reported.reduce(
    (sum, { report }) => sum + (Array.isArray(report?.versions) ? report.versions.length : 0),
    0,
  );
  // The climb's velocity first: what a promotion cost in dollars and in hours of the log. The
  // total is a bound, and the operator reads a campaign by how fast it climbs under it (14 October).
  const promotions = events.filter(({ kind }) => kind === "harness.promoted").length;
  const hours = (Date.parse(events.at(-1)?.at ?? "") - Date.parse(events[0]?.at ?? "")) / 3_600_000;
  const spent = billedAll(events);
  return [
    promotions > 0
      ? `- The climb: calculated $${(spent / promotions).toFixed(2)} and ${(hours / promotions).toFixed(1)} hours a promotion (${String(promotions)}).`
      : `- The climb: no promotion over calculated $${spent.toFixed(2)} and ${hours.toFixed(1)} hours.`,
    `- The Examiner: calculated ${per(examined, held, "task held out")}.`,
    `- Comparisons: calculated ${per(compared, scored, "task scored")}; ${String(reported.length)} of the ${plural(all.length, "comparison")} that began reported.`,
  ];
}

/** A promotion a line: the comparisons that read its step, its last tally and score against the
 *  reference it was promoted over, and whether it is set-up (epoch 0) or a rung of the climb. */
function promotionLines(
  events: readonly LogEvent[],
  comparisons: readonly Compared[],
  called: Called,
): string[] {
  /** Where an imported harness came from, by its digest (`tools/d2/import.ts`). */
  const imported = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "harness.imported" && isString(data.harness) && isString(data.from)
        ? [[data.harness, data.from]]
        : [],
    ),
  );
  const worths = promotionsWorth(events);
  return events.flatMap(({ kind, at, data }, index) => {
    if (kind !== "harness.promoted" || !isString(data.harness)) return [];
    // The first over the Starter is set-up, epoch 0, and the climb counts from it.
    const nth = events.slice(0, index).filter((each) => each.kind === "harness.promoted").length;
    const worth = worths.get(data.harness);
    const rung = nth === 0 ? "set-up (epoch 0)" : `rung ${String(nth)} of the climb`;
    const from = imported.get(data.harness);
    const origin = from === undefined ? "" : `. Imported from ${from}, built by no session of this campaign`;
    const stepped = comparisons.filter((each) => each.fresh === data.harness && each.reading === "step");
    // Read against the reference it was promoted over: a reading it owed after is not its step.
    const last = comparisons.findLast(
      (each): each is Compared & { readonly tally: NonNullable<Compared["tally"]> } =>
        each.fresh === data.harness && each.old === data.from && each.tally !== null,
    );
    const held =
      last === undefined
        ? ". No comparison of it tallied a task"
        : `. In ${last.id} it won ${String(last.tally.wins)}, lost ${String(last.tally.losses)} and tied ${String(last.tally.ties)}${last.points === null ? "" : `, the score giving it ${String(last.points.validity)} points by validity, ${String(last.points.objective)} by the objective and ${String(last.points.bill)} by the bill`}`;
    return [
      `- ${at.slice(0, 10)}: harness ${called(data.harness)}, ${rung}, read by ${stepped.map((each) => each.id).join(" and ") || "no comparison on record"}${held}${isString(data.despite) ? `. Promoted on the operator's reason, where the rule did not name it: ${data.despite}` : ""}${origin}${worth === undefined ? "" : `. Its ${worthLine(worth)}`}`,
    ];
  });
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
  const events = read(campaign.log);
  mkdirSync(to, { recursive: true });
  try {
    // Links as they are, but for `.toolchain`, which names the tree kept beside the state and is
    // replaced by a copy of that tree, as a Builder's `kept/` is laid.
    copyHarness(kept.dir, harness);
    const opened = await openHarness(harness);
    if (opened.digest !== kept.digest) {
      throw new Error(
        `${harness} opens as harness ${short(opened.digest)}, and the campaign keeps ${short(kept.digest)}: the copy is not the harness, and is not handed over as it`,
      );
    }
    writeFileSync(join(to, "RULES.md"), rulesOf(campaign));
    writeFileSync(join(to, "REPORT.md"), closingReport(pack.name, events, kept.digest));
  } catch (error) {
    // `to` was empty or absent, so everything under it is this command's, and none of it is a
    // handover.
    for (const name of readdirSync(to)) rmSync(join(to, name), { recursive: true, force: true });
    throw error;
  }
  console.log(`handed over harness ${short(kept.digest)} with its report: ${to}`);
  if (values.solve === undefined) return { to, harness: kept.digest, solved: null };
  // The tasks an Examiner session wrote are in the log and in no pack.
  const task = [...writtenTasks(events), ...campaign.tasks].find(({ taskId }) => taskId === values.solve);
  if (task === undefined) throw new Error(`--solve ${values.solve}: the campaign holds no task by that id`);
  const trialLog = join(campaign.log, "..", "handover", LOG_FILE);
  mkdirSync(join(campaign.log, "..", "handover"), { recursive: true });
  const trial = await openCampaign({ ...pack, trial: trialLog });
  const { solve } = seated(trial, { builder: undefined, reference: PROMOTED });
  const trialled = await solve(trial.pack(task), { dir: harness, digest: kept.digest }, undefined);
  console.log(
    `solved task ${task.taskId} under harness ${short(kept.digest)} from ${harness}: ${trialled.ending.outcome}${"kind" in trialled.ending ? ` (${trialled.ending.kind})` : ""}, recorded in ${trialLog}`,
  );
  return { to, harness: kept.digest, solved: trialled.ending.outcome };
}

if (import.meta.main) {
  await closeCommand(Bun.argv.slice(2));
  runtimeProcess.exitCode = 0;
}

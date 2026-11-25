/**
 * What a campaign hands over. `harness/` is the reference harness copied whole with its links as
 * links, so a link to a host file never leaves as its bytes; under `data/harnesses/` a tool tree
 * over 100 MB is copied once to `.trees/<campaign>/` and linked to (`copyHarness`), and a copy that
 * does not open as the kept digest leaves nothing under `--to`. `RULES.md` is the public contract;
 * `REPORT.md` is the closing report: the ending, promotions, every comparison's tally and reading,
 * the bars (`barLines`), false-promotion risk (`riskLines`), unadmitted checks (`unadmitted`),
 * rulings, labels and spend.
 *
 *   bun tools/campaign/close.ts --name queues --to ~/handover/queues [--harness <letter|digest>]
 *     [--solve <task id>[,<task id>...] [--solver <model> --solver-effort <level> ...]]
 */
import { barLines, promotionsWorth, riskLines, starterIn, worthLine } from "#src/campaign/climb.ts";
import { UNSETTLED } from "#src/campaign/comparison.ts";
import { campaignOf, type Handover } from "#src/campaign/summary.ts";
import { short } from "#src/campaign/move.ts";
import { type Called, calledBy, namesOf } from "#src/campaign/names.ts";
import { copyHarness } from "#src/builder/store.ts";
import { harnessesOf } from "../runs/registry.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { frozenChecker, unadmitted } from "#src/kernel/acceptance.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { comparisonsOf } from "#src/campaign/state.ts";
import { endedOf, lastReports, promoted } from "#src/kernel/reports.ts";
import { billedAll, billedParts, costLine, spendOf } from "#src/kernel/meter.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { openHarness } from "#src/harness/open.ts";
import {
  campaignLog,
  resolveCheckpoint,
  openCampaign,
  PACK_OPTIONS,
  PROMOTED,
  packNamed,
} from "./campaign.ts";
import { type Seated, solved } from "./round.ts";
import { recordedSetting, SETTING_OPTIONS, settingNamed } from "./setting.ts";

type Campaign = Awaited<ReturnType<typeof openCampaign>>;
type Compared = Extract<Handover, { step: "comparison" }>;

const OPTIONS = {
  ...PACK_OPTIONS,
  to: { type: "string" },
  harness: { type: "string" },
  solve: { type: "string" },
  ...SETTING_OPTIONS,
} as const;

const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

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

function closingReport(name: string, events: readonly LogEvent[], handed: string, asked?: string): string {
  const { steps, supply } = campaignOf(events);
  const comparisons = steps.filter((step): step is Compared => step.step === "comparison");
  const ended = endedOf(events);
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
  const packets = lastReports(events, "all").map(({ data }) => data.settled);
  const settled = packets.map((each) => asRecord(each)).filter((each) => each !== null);
  const unsettled = packets.filter((each) => each === UNSETTLED).length;
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
  // The checks of the last reading no installed instrument decides, the objective among them.
  const authored = unadmitted(events, []);
  const budget = opening?.budget ?? null;
  const defaulted =
    reference === null
      ? "the Starter Built Harness, since no step was promoted"
      : "the reference harness, promoted as below";
  return [
    `# ${name}: closing report`,
    ended === null
      ? `The campaign's log names no ending: its last event is \`${events.at(-1)?.kind ?? "none"}\`.`
      : `The campaign ended on its ${ended.ending}: ${ended.why}.`,
    `It hands over harness ${called(handed)}, in \`harness/\`: ${
      asked === undefined
        ? defaulted
        : `the harness \`--harness ${asked}\` named, ${handed === (reference ?? "") ? "the reference harness" : "which is not the reference harness"}`
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
    "## The campaign against its bars",
    barLines(events).join("\n"),
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

/** The scored tasks summed over the comparisons, those the reference did not answer validly in
 *  every solve (its room), and candidate steps with points and those that won a point by validity;
 *  a step whose new side is the Starter is none of the climb's. Read by the climb line here,
 *  `ambition.ts`, `.claude/skills/main/runs.ts` and `tools/wri/climb.ts`. */
export function validityOf(
  steps: readonly {
    readonly step?: string;
    readonly fresh?: string;
    readonly reading?: string | null;
    readonly valid?: { readonly old: readonly number[] } | null;
    readonly points?: { readonly validity: number } | null;
  }[],
  events: readonly LogEvent[],
) {
  const shares = steps.flatMap(({ valid }) => (valid == null ? [] : [valid.old]));
  const scored = shares.reduce((sum, old) => sum + old.reduce((a, b) => a + b, 0), 0);
  const starter = starterIn(events);
  const stepped = steps.flatMap(({ fresh, reading, points }) =>
    reading === "step" && fresh !== starter && points != null ? [points] : [],
  );
  return {
    scored,
    room: scored - shares.reduce((sum, old) => sum + (old.at(-1) ?? 0), 0),
    onValidity: stepped.filter(({ validity }) => validity > 0).length,
    stepped: stepped.length,
  };
}

/** What each measured thing cost, from the log alone: the Examiner's as `spendOf` bills it, Referee aside. */
function economyLines(events: readonly LogEvent[], steps: readonly Handover[]): string[] {
  const per = (dollars: number, count: number, what: string) =>
    count > 0 ? `$${(dollars / count).toFixed(2)} a ${what} (${String(count)})` : `no ${what}`;
  const held = steps.reduce((sum, step) => sum + (step.step === "examiner" ? step.held : 0), 0);
  const [, examined = 0] = spendOf(events).find(([role]) => role === "examiner") ?? [];
  const all = comparisonsOf(events);
  const reported = all.filter(({ report }) => report !== null);
  const compared = reported.reduce((sum, { id }) => sum + billedParts(events, id).comparison, 0);
  const scored = reported.reduce(
    (sum, { report }) => sum + (Array.isArray(report?.versions) ? report.versions.length : 0),
    0,
  );
  // The climb's velocity first: what a promotion cost in dollars and in hours of the log, since the
  // operator reads a campaign by how fast it climbs under its bound.
  const promotions = events.filter(({ kind }) => kind === "harness.promoted").length;
  const hours = (Date.parse(events.at(-1)?.at ?? "") - Date.parse(events[0]?.at ?? "")) / 3_600_000;
  const spent = billedAll(events);
  const { onValidity, stepped } = validityOf(steps, events);
  const carried =
    stepped === 0
      ? ""
      : ` ${String(onValidity)} of the ${plural(stepped, "step")} read won points by validity, and the rest by the objective.`;
  return [
    promotions > 0
      ? `- The climb: calculated $${(spent / promotions).toFixed(2)} and ${(hours / promotions).toFixed(1)} hours a promotion (${String(promotions)}).${carried}`
      : `- The climb: no promotion over calculated $${spent.toFixed(2)} and ${hours.toFixed(1)} hours.`,
    `- The Examiner: calculated ${per(examined, held, "task held out")}.`,
    `- Comparisons: calculated ${per(compared, scored, "task scored")}; ${String(reported.length)} of the ${plural(all.length, "comparison")} that began reported.`,
  ];
}

/** One line per promotion: the comparisons that read its step, its last tally and score against the
 *  reference it beat, and whether it is set-up (epoch 0) or a rung of the climb. */
function promotionLines(
  events: readonly LogEvent[],
  comparisons: readonly Compared[],
  called: Called,
): string[] {
  /** Where an imported harness came from, by its digest (`tools/campaign/import.ts`). */
  const imported = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "harness.imported" && isString(data.harness) && isString(data.from)
        ? [[data.harness, data.from]]
        : [],
    ),
  );
  const worths = promotionsWorth(events);
  // The first over the Starter is set-up, epoch 0, and the climb counts from it.
  const promotions = events.filter(({ kind }) => kind === "harness.promoted");
  return promotions.flatMap(({ at, data }, nth) => {
    if (!isString(data.harness)) return [];
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
        : `. In ${last.id} it won ${String(last.tally.wins)}, lost ${String(last.tally.losses)} and tied ${String(last.tally.ties)}${last.points === null ? "" : `, the score giving it ${String(last.points.validity)} points by validity and ${String(last.points.objective)} by the objective`}`;
    return [
      `- ${at.slice(0, 10)}: harness ${called(data.harness)}, ${rung}, decided by ${stepped.map((each) => each.id).join(" and ") || "no recorded comparison"}${held}${isString(data.despite) ? `. Promoted manually by operator override: ${data.despite}` : ""}${origin}${worth === undefined ? "" : `. ${worthLine(worth)}`}`,
    ];
  });
}

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

export async function closeCommand(args: readonly string[], seated: Seated = solved) {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  if (values.to === undefined) throw new Error("name --to, the folder the handover is written to");
  const to = resolve(values.to);
  const pack = packNamed(values, " and --to");
  const trialLog = join(campaignLog(pack.name), "..", "handover", LOG_FILE);
  const trial = values.solve === undefined ? {} : { trial: trialLog, ...settingNamed(values) };
  const campaign = await openCampaign({ ...pack, ...trial });
  if (containsPath(to, campaign.repo) && !containsPath(to, harnessesOf(campaign.repo))) {
    throw new Error(
      `--to ${to} lies inside the repository, which holds the campaign's logs: a handover leaves it, or goes under ${harnessesOf(campaign.repo)}`,
    );
  }
  // A campaign hands over at each ending, a pause's among them, so a handover replaces an earlier one.
  const before = existsSync(to) ? readdirSync(to) : [];
  if (before.some((one) => !["harness", "RULES.md", "REPORT.md"].includes(one))) {
    throw new Error(
      `--to ${to} holds something besides a handover: a handover is written to a folder of its own`,
    );
  }
  const kept = await resolveCheckpoint(campaign, "--harness", values.harness ?? PROMOTED);
  for (const one of before) rmSync(join(to, one), { recursive: true, force: true });
  const harness = join(to, "harness");
  const events = read(campaign.log);
  mkdirSync(to, { recursive: true });
  try {
    const shared = containsPath(to, harnessesOf(campaign.repo));
    copyHarness(kept.dir, harness, shared ? harnessesOf(campaign.repo, ".trees", pack.name) : undefined);
    const opened = await openHarness(harness);
    if (opened.digest !== kept.digest) {
      throw new Error(
        `${harness} opens as harness ${short(opened.digest)}, and the campaign keeps ${short(kept.digest)}: the copy is not the harness, and is not handed over as it`,
      );
    }
    writeFileSync(join(to, "RULES.md"), rulesOf(campaign));
    writeFileSync(join(to, "REPORT.md"), closingReport(pack.name, events, kept.digest, values.harness));
  } catch (error) {
    // `to` held at most an earlier handover, removed above, so everything under it is this command's.
    for (const name of readdirSync(to)) rmSync(join(to, name), { recursive: true, force: true });
    throw error;
  }
  console.log(`handed over harness ${short(kept.digest)} with its report: ${to}`);
  if (values.solve === undefined) return { to, harness: kept.digest, solved: null };
  // The tasks an Examiner session wrote are in the log and in no pack.
  const tasks = [...writtenTasks(events), ...campaign.tasks];
  const asked = values.solve.split(",").map((id) => {
    const task = tasks.find(({ taskId }) => taskId === id);
    if (task === undefined) throw new Error(`--solve ${id}: the campaign holds no task by that id`);
    return task;
  });
  mkdirSync(join(trialLog, ".."), { recursive: true });
  const { solve } = seated(campaign, { builder: undefined, reference: PROMOTED });
  const outcomes: string[] = [];
  for (const task of asked) {
    const { ending } = await solve(campaign.pack(task), { dir: harness, digest: kept.digest }, undefined);
    outcomes.push(ending.outcome);
    console.log(
      `solved task ${task.taskId} under harness ${short(kept.digest)} from ${harness}: ${ending.outcome}${"kind" in ending ? ` (${ending.kind})` : ""}, recorded in ${trialLog}`,
    );
  }
  return { to, harness: kept.digest, solved: outcomes };
}

if (import.meta.main) {
  await closeCommand(Bun.argv.slice(2));
  // A backend's pooled connections outlive the last solve and would hold the process open.
  runtimeProcess.exit(0);
}

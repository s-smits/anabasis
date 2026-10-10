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
 */
import { campaignOf, type Handover } from "#src/builder/handover.ts";
import { openingOf } from "#src/builder/opening.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { billedAll, promoted } from "#src/kernel/reports.ts";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { passesRead } from "#src/review/passes.ts";
import { openHarness } from "#src/solve/harness.ts";
import { keptAs, openCampaign, PROMOTED, packNamed } from "./campaign.ts";
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
  const promotions = events.flatMap(({ kind, at, data }) =>
    kind === "harness.promoted" && isString(data.harness)
      ? [
          `- ${at.slice(0, 10)}: harness ${short(data.harness)}, read by ${
            comparisons
              .filter((each) => each.fresh === data.harness && each.reading === "step")
              .map((each) => each.id)
              .join(" and ") || "no comparison on record"
          }${isString(data.despite) ? `. Promoted on the operator's reason, where the rule did not name it: ${data.despite}` : ""}`,
        ]
      : [],
  );
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
      passesLine(events),
    ].join("\n"),
    "## Work and spend",
    `${plural(sessions, "Builder session")}, ${plural(steps.filter((step) => step.step === "examiner").length, "Examiner session")} and ${plural(comparisons.length, "comparison")}. Billed $${billedAll(events).toFixed(2)}${budget === null ? "" : ` of a budget of $${String(budget.dollars)}`}.`,
    "",
  ].join("\n\n");
}

/** What a person read of the answers that passed, or that nobody did (`src/review/passes.ts`). */
function passesLine(events: readonly LogEvent[]): string {
  const passes = passesRead(events);
  if (passes.comparisons === 0) {
    return "- No answer that passed was read by anyone: a pass is the checks' word alone.";
  }
  const { sound, wrong, unclear } = passes.labels;
  return `- Answers that passed: a person read ${String(passes.read)} of the ${String(passes.of)} in ${plural(passes.comparisons, "comparison")}, drawn by each comparison's id: ${String(sound)} sound, ${String(wrong)} wrong, ${String(unclear)} unclear. A wrong pass is a check's fault, and changes no tally.`;
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
export async function closeCommand(args: readonly string[]): Promise<{ to: string; harness: string }> {
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
  return { to, harness: kept.digest };
}

if (import.meta.main) {
  await closeCommand(Bun.argv.slice(2));
  runtimeProcess.exitCode = 0;
}

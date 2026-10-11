/**
 * `bun run runs view <name> [--level N] [--trigger N] [--target N] [--practice N] [--past-stop "<why>"]`
 *
 * A campaign as its log reads: the set-up, what each step handed over, the climb, and the move
 * that comes next. It is the one reading of `src/builder/handover.ts`, printed whole for the
 * campaign's owner. Nothing here reads the log for itself, and nothing is launched.
 *
 * Its last line is the one move the plan's decision table names on this log (`decide`,
 * `src/builder/decide.ts`), with its reason: what `tools/d2/harness-builder.ts` would make next.
 * The table is asked with the five flags of the campaign command that bear on it, and with the
 * terms its opening keeps for those it does not name (`campaign.opened`, `src/builder/opening.ts`),
 * so that the view and `tools/d2/harness-builder.ts` name one move on one log. Until 11 October
 * the view also listed every move a launch would be admitted for, and that list named a promotion
 * on one step where the table waits for its repeat; the table's move is the one it prints. The
 * launcher went the same day (`docs/simplify.md`, D2), and the view parses no flag of its own.
 * The view opens no campaign, so of a log that holds no task it says what holds for a campaign
 * over a pack: that the pack's tasks are taken in first.
 *
 * A step's line holds counts, digests, a tally, a reading and a cost. It names no task, and it is
 * for the operator and the session that stands in for the campaign's owner: what a Builder is told
 * of the same rows is `src/builder/past.ts`.
 */
import { epochLine, epochsOf, regressionLine, regressionOf } from "#src/builder/climb.ts";
import { decide } from "#src/builder/decide.ts";
import { decidedLine } from "#src/builder/move.ts";
import { openingOf, planOf } from "#src/builder/opening.ts";
import { type Campaign, campaignOf, type Handover } from "#src/builder/handover.ts";
import { shortDigest } from "#src/builder/past.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { PRACTICE } from "../d2/prepare.ts";
import { COMPARISON_OPTIONS } from "../d2/round.ts";
import { logEvents, runs } from "./pulse.ts";

/** The flags the table is asked with: the campaign command's, with the same names. */
const VIEW_OPTIONS = {
  level: { type: "string" },
  trigger: { type: "string" },
  target: { type: "string" },
  practice: { type: "string" },
  "past-stop": { type: "string" },
} as const;

const STANDINGS = [
  ["open", "open"],
  ["passed-once", "passed once"],
  ["repaired", "repaired"],
  ["failing-again", "failing again"],
] as const;

const dollars = (billed: number) => `$${billed.toFixed(2)}`;
const row = (id: string, said: string) => `  ${id.padEnd(11)} ${said}`;

/** One step's handover as a line. */
function stepLine(step: Handover): string {
  const ended = step.step === "comparison" ? "" : (step.ended ?? "running, or cut before its end");
  if (step.step === "examiner") {
    return row(
      step.id,
      `Examiner session, ${ended}: ${String(step.proposed)} proposed, ${String(step.held)} held out, ${String(step.refused)} refused · ${dollars(step.billed)}`,
    );
  }
  if (step.step === "builder") {
    const left =
      step.changed && step.harness !== null
        ? `it left ${shortDigest(step.harness)}`
        : "it left the harness as it was";
    return row(
      step.id,
      `Builder session, ${ended}: from ${shortDigest(step.parent ?? "")} ${left}, ${plural(step.practiceSolves, "practice solve")} · ${dollars(step.billed)}`,
    );
  }
  const { tally, valid, rulings } = step;
  const read =
    step.reading === null
      ? "no report yet"
      : `${tally === null ? "no task tallied" : `${String(tally.wins)} won, ${String(tally.losses)} lost, ${String(tally.ties)} tied`}, which reads ${step.reading}`;
  const ruled = [
    ...(rulings.earned > 0 ? [`${plural(rulings.earned, "rejection")} ruled earned`] : []),
    ...(rulings["check-defect"] > 0 ? [`${String(rulings["check-defect"])} ruled a check defect`] : []),
    ...(rulings.unclear > 0 ? [`${String(rulings.unclear)} ruled unclear`] : []),
  ];
  return row(
    step.id,
    [
      `comparison of ${shortDigest(step.fresh)} with ${shortDigest(step.old)} on ${plural(step.tasks, "task")}, ${String(step.solves)} solves a side at ${String(step.level)}: ${read}`,
      ...(valid === null
        ? []
        : [
            `tasks with ${valid.old.map((_, index) => String(index)).join(", ")} valid answers: reference ${valid.old.join("/")}, new ${valid.fresh.join("/")}`,
          ]),
      ...(step.decided === null ? [] : [`${plural(step.decided, "task")} decided by the objective`]),
      ...(step.aside > 0 ? [`${plural(step.aside, "task")} set aside for a person's labels`] : []),
      ...(ruled.length === 0 ? [] : [ruled.join(", ")]),
      dollars(step.billed),
    ].join(" · "),
  );
}

/** A campaign's reading, a line each. */
export function viewLines(name: string, campaign: Campaign): string[] {
  const { supply, fails } = campaign;
  const checker =
    supply.faults === null
      ? "checker never read"
      : `checker read, ${plural(supply.faults, "fault")}, ${supply.frozen ? "frozen" : "not frozen"}`;
  const standing = STANDINGS.flatMap(([state, said]) => {
    const found = fails.filter((fail) => fail.standing === state).length;
    return found === 0 ? [] : [`${String(found)} ${said}`];
  });
  return [
    name,
    row(
      "set-up",
      `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(supply.awaiting)} wait for a label · ${String(supply.exhausted)} exhausted · ${checker} · reference: ${campaign.reference === null ? "the starter" : shortDigest(campaign.reference)}`,
    ),
    ...campaign.steps.map(stepLine),
    ...(fails.length === 0
      ? []
      : [row("practice", `${plural(fails.length, "failed practice solve")}: ${standing.join(", ")}`)]),
  ];
}

/** `bun run runs view`. */
export function view(args: readonly string[]): void {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: VIEW_OPTIONS,
  });
  const [name] = positionals;
  const tree = runtimeProcess.cwd();
  const run = runs().find((found) => found.tree === tree && found.name === name);
  if (name === undefined || run === undefined) {
    throw new Error(
      `usage: bun run runs view <name> [--level N] [--trigger N] [--target N] [--practice N] [--past-stop "<why>"]: ${name === undefined ? "name a campaign" : `this worktree holds no campaign ${name}`}`,
    );
  }
  const events = logEvents(run.path);
  const opening = openingOf(events);
  // Each term as this view is asked it, then as the opening keeps it, then the tree's default: the
  // scored tasks are the record's where it names them (`planOf`).
  const term = (flag: "level" | "trigger" | "target" | "practice", fallback?: string) =>
    values[flag] ?? opening?.terms[flag] ?? fallback;
  const target = term("target");
  const lines = viewLines(name, campaignOf(events));
  const decided = decide(
    events,
    planOf(
      events,
      {
        unprepared: !events.some(({ kind }) => kind === "task.proposed"),
        level: Number(term("level", COMPARISON_OPTIONS.level.default)),
        trigger: Number(term("trigger", COMPARISON_OPTIONS.trigger.default)),
        target: target === undefined ? undefined : Number(target),
        pastStop: values["past-stop"],
        // The practice tasks the campaign is brought to, as the command passes them: without a
        // count the table releases nothing, and the view said `build` where the command made
        // `prepare` (found by review, 11 October).
        practice: Number(term("practice", String(PRACTICE))),
      },
      opening,
    ),
  );
  const climb = epochsOf(events).map((epoch) => `  ${epochLine(epoch)}`);
  const regression = regressionOf(events);
  const beside = regression === null ? [] : [`  ${regressionLine(regression)}`];
  for (const line of [
    ...lines,
    "the climb",
    ...climb,
    ...beside,
    "the table's move",
    `  ${decidedLine(decided)}`,
  ]) {
    console.log(line);
  }
}

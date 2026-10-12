/**
 * Settle a comparison's reading by hand: the plan's person in the loop, with a record.
 *
 *   bun tools/d2/settle.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session g0
 *
 * After every comparison a person answers one packet, the operator's one standing duty (the
 * overhaul plan's M3, 12 October). Until it is answered the comparison's report says `unsettled`,
 * and no promotion waits for it: a campaign runs unattended (the operator, 12 October). A rejected
 * answer one the Referee ruled a check defect or unclear, and one nobody ruled on, sets its task
 * aside, out of every tally of the comparison (`src/builder/round.ts`), and the packet is how a
 * person decides those. `--session` is the comparison's id: a round's session, or a checkpoint's
 * `--id`.
 *
 * Run once, it draws the packet: up to ten of the comparison's rejected answers, under any of its
 * harnesses and the ones ruled a true fail among them, and up to three of its answers that passed,
 * each drawn uniformly by the comparison's id, so the draw stands before any is read and comes back
 * the same whenever it is asked for. It writes `labels.json` under `.ana/d2/<name>/settle-<session>/`,
 * one empty entry a drawn answer under `rejections` and under `passes`, and a packet each beside
 * it: the task with its hidden values, the public rules and the answer, and for a rejection the
 * checks that refused it. A packet holds no ruling and names no harness, so a label is made blind to
 * both. A ruling of earned is drawn like any other, though since 12 October it rests on a probe
 * that moved a check: a probe shows a difference, not which side is right, and in one audit 51 of
 * 77 such differences stayed undecidable (research 06).
 *
 * A person writes `earned`, `check-defect` or `unclear` into each rejection's entry, and `sound`,
 * `wrong` or `unclear` into each pass's. Run again with every entry filled, it settles
 * (`settleReading`): a person's label stands over the Referee's ruling of the same rejection, and
 * the report is written once more, as the comparison's last, with the labels. A task whose
 * rejections then all stand as earned is restored to the tally; one labelled a check defect
 * disputes its task, which leaves this comparison and every later one; one labelled unclear, or set
 * aside on a rejection the packet did not draw, stays out of this comparison. A pass's label
 * changes no tally and no reading: a wrong pass is a check's fault, for the check program's owner,
 * and the closing report names it. An entry that is neither empty nor a known label is refused by
 * name, so a mistyped label is not read as no label; an empty one is still to be read, and nothing
 * is recorded until none is. A comparison is settled once: run again with the same file it says
 * what it said, and with other labels it is refused. A packet with nothing in it settles at once.
 *
 * Until 12 October the command drew every rejection that set a task aside, and read the passes
 * apart. Until 11 October it read a Diagnoser's accounts of practice fails; the seat went
 * (`docs/simplify.md`, E1), and a log of before keeps its `diagnosis.*` events.
 *
 * Where a task itself looks infeasible, say so with `prepare.ts --infeasible <task id> --note`,
 * which refuses the task and logs the note. A task disputed here on a check's fault is a repair
 * owed to the check program's owner, and the labels file is what `tools/c/repaired.ts --labels`
 * takes. Labels made beside a log that holds the Referee's rulings measure the Referee only as far
 * as a packet keeps them from the person: its bar is cleared on labels drawn before it reads
 * (`tools/c/rejections.ts`).
 *
 * It starts no solve and calls no model. Not run here: see `campaign.ts`.
 */
import { PASS_LABELS, passesIn, toLabel, UNSETTLED } from "#src/builder/comparison.ts";
import { settleReading } from "#src/builder/round.ts";
import { draw } from "#src/kernel/compare.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { refusedBy, verdictsOf } from "#src/kernel/solves.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { RULINGS } from "#src/review/agreement.ts";
import { labelled } from "#src/review/rejections.ts";
import { openCampaign, packNamed } from "./campaign.ts";
import { type Campaign, reportLines } from "./round.ts";

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
} as const;
/** The most of each kind a packet draws: about ten minutes of a person's reading a comparison. */
const PACKET = { rejections: 10, passes: 3 } as const;

/**
 * Draw comparison `session`'s packet into `dir`, a packet a drawn answer and `labels.json` with an
 * empty entry each, and say what was drawn. Each kind is drawn uniformly by the comparison's id
 * from what the comparison holds of it, so the same draw comes back whenever it is asked for.
 */
function drawPacket(campaign: Campaign, events: readonly LogEvent[], session: string, dir: string) {
  const { aside, others } = toLabel(events, session);
  const of = (pool: readonly string[], most: number, kind: string) =>
    draw(pool, Math.min(most, pool.length), `${kind}:${session}`);
  const rejections = of([...aside, ...others], PACKET.rejections, "rejections");
  const passes = of(passesIn(events, session), PACKET.passes, "passes");
  if (rejections.length + passes.length === 0) return { rejections, passes };
  // The tasks an Examiner session wrote are in the log and in no pack.
  const tasks = [...writtenTasks(events), ...campaign.tasks];
  const verdicts = verdictsOf(events);
  mkdirSync(dir, { recursive: true });
  for (const solve of [...rejections, ...passes]) {
    const verdict = verdicts.get(solve);
    const packet = {
      solve,
      task: tasks.find((task) => task.taskId === verdict?.task) ?? null,
      rules: campaign.contract.rules,
      answer: verdict?.answer ?? null,
      // None where the answer passed.
      refusedBy: refusedBy(verdict),
    };
    writeFileSync(join(dir, `${solve}.json`), `${capturedJsonStringify(packet, null, 2)}\n`);
  }
  const empty = (solves: readonly string[]) => Object.fromEntries(solves.map((solve) => [solve, ""]));
  const file = { rejections: empty(rejections), passes: empty(passes) };
  writeFileSync(join(dir, "labels.json"), `${capturedJsonStringify(file, null, 2)}\n`);
  return { rejections, passes };
}

/** The labels one kind of a packet's file holds: refused where an entry is neither empty nor a
 *  known word, and null where one is still empty, since nothing is recorded until none is. */
function labelsIn<Word extends string>(
  file: string,
  entries: JsonValue | undefined,
  known: readonly Word[],
): ReadonlyMap<string, Word> | null {
  const kind = asRecord(entries) ?? {};
  const { labels, open } = labelled(kind, known);
  const mistyped = open.filter((solve) => kind[solve] !== "");
  if (mistyped.length > 0) {
    throw new Error(
      `${file} holds what is no label (${known.join(", ")}) for ${plural(mistyped.length, "answer")}: ${mistyped.map((solve) => `${solve}: ${JSON.stringify(kind[solve])}`).join(", ")}`,
    );
  }
  return open.length > 0 ? null : labels;
}

export async function settleCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { session } = values;
  if (session === undefined) throw new Error("name --session, the comparison whose packet is settled");
  const campaign = await openCampaign(packNamed(values, " and --session"));
  const events = read(campaign.log);
  const dir = join(dirname(campaign.log), `settle-${session}`);
  const file = join(dir, "labels.json");
  const answered = existsSync(file) ? (asRecord(capturedJsonParse(readFileSync(file, "utf8"))) ?? {}) : null;
  if (answered === null) {
    const drawn = drawPacket(campaign, events, session, dir);
    if (drawn.rejections.length + drawn.passes.length > 0) {
      console.log(
        `${plural(drawn.rejections.length, "rejected answer")} and ${plural(drawn.passes.length, "answer")} that passed to label in ${file}, a packet each beside it: comparison ${session} reads ${UNSETTLED} until they are, and no promotion waits for them`,
      );
      return 0;
    }
  }
  // A packet with nothing in it is answered as it is drawn.
  const rejections = answered === null ? new Map() : labelsIn(file, answered.rejections, RULINGS);
  const passes = answered === null ? new Map() : labelsIn(file, answered.passes, PASS_LABELS);
  if (rejections === null || passes === null) {
    console.log(`answers still to read in ${file}; nothing is recorded until none is`);
    return 0;
  }
  const settled = events.findLast(
    ({ kind, data }) => kind === "comparison.reported" && data.session === session,
  );
  if (asRecord(settled?.data.settled) !== null) {
    console.log(`comparison ${session} is settled already, and this is the report it was settled as`);
  }
  const report = settleReading(campaign.log, session, rejections, passes);
  console.log(capturedJsonStringify(report, null, 2));
  console.log(capturedJsonStringify(stopRule(read(campaign.log)), null, 2));
  for (const line of reportLines(report)) console.log(line);
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await settleCommand(Bun.argv.slice(2));

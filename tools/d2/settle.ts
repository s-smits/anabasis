/**
 * Settle a comparison's reading by hand: a person in the loop, with a record.
 *
 *   bun tools/d2/settle.ts --name truss --session g-1
 */
import { passesIn, reported, swapped, toLabel, UNSETTLED } from "#src/campaign/comparison.ts";
import { settleReading } from "#src/campaign/settle.ts";
import { draw } from "#src/kernel/compare.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { shownFiles } from "#src/kernel/answer-files.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { stopRule } from "#src/campaign/admission.ts";
import { verdictsOf } from "#src/kernel/solves.ts";
import { blockingOf } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import {
  agreement,
  clears,
  labelled,
  PASS_LABELS,
  passAgreement,
  RULINGS,
  settledLabels,
  settledPassLabels,
  unclearReport,
  VERDICT_BAR,
} from "#src/referee/agreement.ts";
import { openCampaign, PACK_OPTIONS, packNamed } from "./campaign.ts";
import { type Campaign, reportLines } from "./round.ts";

const OPTIONS = {
  ...PACK_OPTIONS,
  session: { type: "string" },
} as const;
/** The most a packet draws of the rejections ruled earned, and of the answers that passed. */
const SAMPLED = 3;

/**
 * What comparison `session`'s packet holds: every rejection that set its task aside, and three
 * rejections ruled earned and three passes, each drawn uniformly by the comparison's id from what
 * the comparison holds of it, so the same draw comes back whenever it is asked for.
 */
export function packetOf(
  { aside, others }: ReturnType<typeof toLabel>,
  passed: readonly string[],
  session: string,
) {
  const of = (pool: readonly string[], kind: string) =>
    draw(pool, Math.min(SAMPLED, pool.length), `${kind}:${session}`);
  return { rejections: [...aside, ...of(others, "earned")], passes: of(passed, "passes") };
}

/** Draw comparison `session`'s packet into `dir`, a packet a drawn answer and `labels.json` with an
 *  empty entry each, and say what was drawn (`packetOf`). */
function drawPacket(campaign: Campaign, events: readonly LogEvent[], session: string, dir: string) {
  const { rejections, passes } = packetOf(toLabel(events, session), passesIn(events, session), session);
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
      // The whole public contract: a label read on the rules alone misses a convention.
      contract: campaign.contract,
      answer: verdict?.answer ?? null,
      ...keyIfDefined("files", verdict?.files && shownFiles(campaign.log, verdict.files)),
      // None where the answer passed.
      refusedBy: blockingOf(verdict?.checker),
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

/** What a campaign's settled packets say: the Referee's agreement with their labels, and each
 *  settled comparison's decision read again with the verdicts its labels overturned swapped in. */
export function labelLines(events: readonly LogEvent[]): string[] {
  const labels = settledLabels(events);
  const measured = agreement(events, labels);
  const passed = passAgreement(settledPassLabels(events));
  const rate = (value: number | null) => (value === null ? "none" : value.toFixed(2));
  const each = RULINGS.map((kind) => `${kind} ${rate(measured.specific[kind])}`).join(", ");
  const unclear = unclearReport(measured);
  const passLine =
    passed.total === 0
      ? null
      : `${passed.total === 1 ? "1 labelled pass" : `${String(passed.total)} labelled passes`}: sound ${String(passed.counts.sound)}, wrong ${String(passed.counts.wrong)}, unclear ${String(passed.counts.unclear)}; wrong rate ${rate(passed.wrongRate)} (${String(passed.counts.wrong)}/${String(passed.decided)} decided)`;
  return [
    `the Referee against ${plural(labels.size, "labelled rejection")}, ${String(measured.unruled.length)} of them unruled: agreement of each kind ${each}; over all three ${rate(measured.observed)}, PABAK ${rate(measured.pabak)} beside kappa ${rate(measured.kappa)}${labels.size === 0 ? "" : `; bar ${clears(measured, VERDICT_BAR) ? "cleared" : "open"}`}`,
    ...(passLine === null ? [] : [passLine]),
    ...(unclear === null ? [] : [unclear]),
    ...lastReports(events, "all").flatMap(({ session: id }) => {
      const again = swapped(events, id);
      if (again === null) return [];
      const { wins, losses, ties } = again.scored;
      const flips =
        again.swapped === again.unlabelled ? "it holds" : "it flips, so its packet was too small to stand on";
      const rule =
        again.unlabelled === again.decided
          ? ""
          : `, and ${again.unlabelled} by this tree's rule without them`;
      return [
        `${id}: decided ${again.decided}${rule}, and ${again.swapped} at ${String(wins)}-${String(losses)}-${String(ties)} with its labels in place of the verdicts they overturn: ${flips}`,
      ];
    }),
  ];
}

export async function settleCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { session } = values;
  if (session === undefined) throw new Error("name --session, the comparison whose packet is settled");
  const campaign = await openCampaign(packNamed(values, " and --session"));
  const events = read(campaign.log, TRACE_KINDS);
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
  if (asRecord(reported(events, session)?.settled) !== null) {
    console.log(`comparison ${session} is settled already, and this is the report it was settled as`);
  }
  const report = settleReading(campaign.log, session, rejections, passes);
  const after = read(campaign.log, TRACE_KINDS);
  console.log(capturedJsonStringify(report, null, 2));
  console.log(capturedJsonStringify(stopRule(after), null, 2));
  for (const line of [...reportLines(report), ...labelLines(after)]) console.log(line);
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await settleCommand(Bun.argv.slice(2));

/**
 * Settle a comparison's reading by hand: the plan's person in the loop, with a record.
 *
 *   bun tools/d2/settle.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session g0 [--all]
 *   bun tools/d2/settle.ts ... --name truss --session g0 --passes 3
 *
 * A rejected answer counts in a comparison only once its rejection is ruled a true fail. One the
 * Referee ruled a check defect or unclear, and one nobody ruled on, sets its task aside, out of
 * every tally of the comparison (`src/builder/round.ts`). This command is how a person decides
 * those. `--session` is the comparison's id: a round's session, or a checkpoint's `--id`. A
 * comparison run with no reviewer is read this way throughout, which is how the plan's first
 * round is read before there is a Judge (`docs/plan.md`, Phase 0). A hand label is one person's
 * verdict on one rejected answer, written before any ruling of it is seen, and it stands over a
 * ruling. Where the task itself looks infeasible, say so with `prepare.ts --infeasible <task id>
 * --note`, which refuses the task and logs the note.
 *
 * Run once, it writes `labels.json` under `.ana/d2/<name>/settle-<session>/`, one empty entry a
 * rejection, and one packet a rejection beside it: the task with its hidden values, the public
 * rules, the answer and the checks that rejected it. A packet holds no ruling. The rejections are
 * those that set a task aside; with `--all`, every answer of the comparison that some check
 * rejected, under any of its harnesses, the ones ruled a true fail included. A person writes
 * `earned`, `check-defect` or `unclear` into each entry, and a person's label stands over the
 * Referee's ruling of the same rejection.
 *
 * Run again, it settles (`settleReading`): every rejection that set a task aside must carry a
 * label. A task whose rejections are then all earned is restored to the tally. One labelled a check
 * defect disputes its task, which leaves this comparison and every later one. One labelled unclear
 * leaves its task out of this comparison. The report is written once more, as the comparison's
 * last, with the reading the labels leave, what was settled and the labels themselves. Its own
 * report stays in the log. An entry that is neither empty nor one of the three labels is refused
 * by name, so a mistyped label is not read as no label. A comparison is settled once: run again
 * with the same file it says what it said, and with other labels it is refused.
 *
 * A settling makes no solve. Where the reference harness is a promoted one and the labels leave a
 * test that clears its level, the starter was not solved for it and the reading is
 * `starter-unread`: compare the new harness with the starter in a comparison of its own
 * (`checkpoint.ts --reference starter --new <digest>`). A comparison against the starter itself,
 * as the first round is, has nothing more to solve.
 *
 * Labels made beside a log that holds the Referee's rulings are not blind and measure nothing of
 * the Referee: its bar is cleared on labels drawn before it reads (`tools/c/rejections.ts`). A task
 * disputed here on a check's fault is a repair owed to the check program's owner, and the labels
 * file is what `tools/c/repaired.ts --labels` takes.
 *
 * With `--passes N` it is the other half of the person's reading, of the answers that passed
 * (`src/review/passes.ts`, the plan's row F25 until there is a Judge). Run once, it draws N of the
 * comparison's passes by the comparison's id, so the draw stands before any is read, and writes
 * `passes/passes.json` under the same folder, one empty entry a drawn solve, with a packet each
 * beside it: the task with its hidden values, the public rules, the harness and the answer. A
 * person writes `sound`, `wrong` or `unclear` into each entry. Run again with every entry filled,
 * it records the labels once (`pass.labelled`), which changes no tally and no reading: a wrong
 * pass is a check's fault, for the check program's owner, and the closing report names it. An
 * entry that is neither empty nor one of the three is refused by name; an empty one is still to
 * be read, and nothing is recorded until none is.
 *
 * It starts no solve and calls no model. Not run here: see `campaign.ts`.
 */
import { settleReading, toLabel } from "#src/builder/round.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { refusedBy, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import type { Task } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import {
  PASS_LABELLED,
  PASS_LABELS,
  passesLabelled,
  passesOf,
  passLabels,
  toRead,
} from "#src/review/passes.ts";
import { labelled } from "#src/review/rejections.ts";
import { openCampaign, packNamed } from "./campaign.ts";
import { type Campaign, validLines } from "./round.ts";

const OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
  all: { type: "boolean", default: false },
  passes: { type: "string" },
} as const;

/** A person's reading of comparison `session`'s passes: the draw on the first run, the record
 *  on the next, once every drawn answer carries a label. */
function readPasses(campaign: Campaign, events: readonly LogEvent[], session: string, asked: string): number {
  const count = Number(asked);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--passes ${asked}: the answers to read are a whole number of at least one`);
  }
  const dir = join(dirname(campaign.log), `settle-${session}`, "passes");
  const file = join(dir, "passes.json");
  if (existsSync(file)) {
    const { labels, empty, mistyped } = passLabels(capturedJsonParse(readFileSync(file, "utf8")));
    if (mistyped.length > 0) {
      throw new Error(
        `${file} holds what is no label (${PASS_LABELS.join(", ")}) for ${plural(mistyped.length, "answer")}: ${mistyped.join(", ")}`,
      );
    }
    if (empty.length > 0) {
      console.log(
        `${plural(empty.length, "answer")} still to read in ${file}; nothing is recorded until none is`,
      );
      return 0;
    }
    const was = passesLabelled(events, session);
    const record = was?.data ?? {
      session,
      of: passesOf(events, session).length,
      labels: Object.fromEntries(labels),
    };
    if (was === null) append(campaign.log, PASS_LABELLED, record);
    console.log(
      `${was === null ? "recorded" : `the passes of comparison ${session} are labelled already, and this is the record`}: ${capturedJsonStringify(record)}`,
    );
    return 0;
  }
  const drawn = toRead(events, session, count);
  if (drawn.length === 0) {
    console.log(`comparison ${session} has no answer that passed`);
    return 0;
  }
  // The tasks an Examiner session wrote are in the log and in no pack.
  const tasks: readonly Task[] = [...writtenTasks(events), ...campaign.tasks];
  const verdicts = verdictsOf(events);
  const harnesses = new Map(solvesIn(events).map((solve) => [solve.id, solve.end?.harness]));
  mkdirSync(dir, { recursive: true });
  for (const solve of drawn) {
    const verdict = verdicts.get(solve);
    const packet = {
      solve,
      harness: harnesses.get(solve) ?? null,
      task: tasks.find((task) => task.taskId === verdict?.task) ?? null,
      rules: campaign.contract.rules,
      answer: verdict?.answer ?? null,
    };
    writeFileSync(join(dir, `${solve}.json`), `${capturedJsonStringify(packet, null, 2)}\n`);
  }
  writeFileSync(
    file,
    `${capturedJsonStringify(Object.fromEntries(drawn.map((solve) => [solve, ""])), null, 2)}\n`,
  );
  console.log(
    `${String(drawn.length)} of the ${plural(passesOf(events, session).length, "answer")} that passed in comparison ${session} to read in ${file}, a packet each beside it`,
  );
  return 0;
}

export async function settleCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { session } = values;
  if (session === undefined) throw new Error("name --session, the comparison whose rejections are settled");
  const campaign = await openCampaign(packNamed(values, " and --session"));
  const events = read(campaign.log);
  if (values.passes !== undefined) return readPasses(campaign, events, session, values.passes);
  const dir = join(dirname(campaign.log), `settle-${session}`);
  const labelFile = join(dir, "labels.json");
  if (existsSync(labelFile)) {
    const file = capturedJsonParse(readFileSync(labelFile, "utf8"));
    const { labels, open } = labelled(file);
    const entries = asRecord(file) ?? {};
    const mistyped = open.filter((solve) => entries[solve] !== "");
    if (mistyped.length > 0) {
      throw new Error(
        `${labelFile} holds what is no label (earned, check-defect or unclear) for ${plural(mistyped.length, "rejection")}: ${mistyped.map((solve) => `${solve}: ${JSON.stringify(entries[solve])}`).join(", ")}`,
      );
    }
    const settled = events.findLast(
      ({ kind, data }) => kind === "comparison.reported" && data.session === session,
    );
    if (asRecord(settled?.data.settled) !== null) {
      console.log(`comparison ${session} is settled already, and this is the report it was settled as`);
    }
    const report = settleReading(campaign.log, session, labels);
    console.log(capturedJsonStringify(report, null, 2));
    console.log(capturedJsonStringify(stopRule(read(campaign.log)), null, 2));
    for (const line of validLines(report)) console.log(line);
    return 0;
  }
  const { aside, others } = toLabel(events, session);
  const solves = values.all ? [...aside, ...others] : aside;
  if (solves.length === 0) {
    console.log(
      `comparison ${session} has no rejection to label: ${plural(aside.length, "rejection")} set a task aside, and ${plural(others.length, "other rejected answer")} ${others.length === 1 ? "is" : "are"} ruled a true fail${values.all ? "" : ", which --all draws"}`,
    );
    return 0;
  }
  // The tasks an Examiner session wrote are in the log and in no pack.
  const tasks = [...writtenTasks(events), ...campaign.tasks];
  mkdirSync(dir, { recursive: true });
  const verdicts = verdictsOf(events);
  for (const solve of solves) {
    const verdict = verdicts.get(solve);
    const packet = {
      solve,
      task: tasks.find((task) => task.taskId === verdict?.task) ?? null,
      rules: campaign.contract.rules,
      answer: verdict?.answer ?? null,
      refusedBy: refusedBy(verdict),
    };
    writeFileSync(join(dir, `${solve}.json`), `${capturedJsonStringify(packet, null, 2)}\n`);
  }
  writeFileSync(
    labelFile,
    `${capturedJsonStringify(Object.fromEntries(solves.map((solve) => [solve, ""])), null, 2)}\n`,
  );
  console.log(
    `${plural(solves.length, "rejection")} to label in ${labelFile}, ${String(aside.length)} of them setting a task aside, a packet each beside it`,
  );
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await settleCommand(Bun.argv.slice(2));

/**
 * Settle a comparison's reading by hand: the plan's person in the loop, with a record.
 *
 *   bun tools/d2/settle.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session g0 [--all]
 *
 * A rejected answer counts in a comparison only once its rejection is ruled a true fail. One the
 * Referee ruled a check defect or unclear, and one nobody ruled on, sets its task aside, out of
 * every tally of the comparison (`src/builder/round.ts`). This command is how a person decides
 * those. `--session` is the comparison's id: a round's session, or a checkpoint's `--id`. A
 * comparison run with no reviewer is read this way throughout, which is how the plan's first
 * experiment is read before there is a Judge (`docs/plan.md`, Phase 0).
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
 * last, with the reading the labels leave and what was settled. Its own report stays in the log.
 *
 * A settling makes no solve. Where the labels leave a test that clears its level and the baseline
 * was not solved for it, the reading is `baseline-unread`: compare the new harness with the
 * baseline in a comparison of its own (`checkpoint.ts --reference baseline --new <digest>`).
 *
 * Labels made beside a log that holds the Referee's rulings are not blind and measure nothing of
 * the Referee: its bar is cleared on labels drawn before it reads (`tools/c/rejections.ts`). A task
 * disputed here on a check's fault is a repair owed to the check program's owner, and the labels
 * file is what `tools/c/repaired.ts --labels` takes.
 *
 * It starts no solve and calls no model. Not run here: see `campaign.ts`.
 */
import { settleReading, toLabel } from "#src/builder/round.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { refusedBy, verdictsOf } from "#src/kernel/solves.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { labelled } from "#src/review/rejections.ts";
import { openCampaign } from "./campaign.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    session: { type: "string" },
    all: { type: "boolean", default: false },
  },
});

async function main(): Promise<number> {
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
  const dir = join(dirname(campaign.log), `settle-${session}`);
  const labelFile = join(dir, "labels.json");
  if (existsSync(labelFile)) {
    const { labels } = labelled(capturedJsonParse(readFileSync(labelFile, "utf8")));
    console.log(capturedJsonStringify(settleReading(campaign.log, session, labels), null, 2));
    console.log(capturedJsonStringify(stopRule(read(campaign.log)), null, 2));
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

runtimeProcess.exitCode = await main();

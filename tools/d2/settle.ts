/**
 * Settle a round's reading by hand: the plan's gate while the Referee advises, with a record.
 *
 *   bun tools/d2/settle.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-1 [--all]
 *
 * A round whose reading differs with and without the tasks its Referee flagged reads `flags-decide`
 * and claims neither (`src/builder/round.ts`). This command is how a person decides it.
 *
 * Run once, it writes `labels.json` under `.ana/d2/<name>/settle-<session>/`, one empty entry a
 * fail, and one packet a fail beside it: the task with its hidden values, the public rules, the
 * answer and the checks that refused it. A packet holds no ruling. The fails are those the Referee
 * ruled a check defect, on tasks the report counts; with `--all`, every answer of the comparison
 * that some check refused, which is the plan's hand reading in full. A person writes `earned`,
 * `check-defect` or `unclear` into each entry.
 *
 * Run again, it settles (`settleReading`): every flagged fail must be labelled `earned` or `check-defect`.
 * A fail labelled a check defect disputes its task, which leaves this comparison and every later
 * one; a flagged fail labelled earned stands. The round's report is written once more, as its last,
 * with the reading the labels leave and what was settled. The round's own report stays in the log.
 *
 * These labels are made beside a log that holds the Referee's rulings, so they are not blind and
 * measure nothing of the Referee: its bar is cleared on labels drawn before it reads
 * (`tools/c/rejections.ts`). A task disputed here on a check's fault is a repair owed to the
 * checker's owner, and the labels file is what `tools/c/repaired.ts --labels` takes.
 *
 * It starts no solve and calls no model. Not run here: see `campaign.ts`.
 */
import { settleReading, stopRule, toLabel } from "#src/builder/round.ts";
import { read } from "#src/kernel/log.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { labelled } from "#src/review/rejections.ts";
import { openCampaign, writtenTasks } from "./campaign.ts";

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
  const { flagged, others } = toLabel(events, session);
  const solves = values.all ? [...flagged, ...others] : flagged;
  if (solves.length === 0) {
    console.log(
      `session ${session} has no fail to label: ${plural(flagged.length, "flagged fail")}, ${plural(others.length, "other refused answer")}${values.all ? "" : ", which --all draws"}`,
    );
    return 0;
  }
  // The tasks an Examiner session wrote are in the log and in no pack.
  const tasks = [...writtenTasks(events), ...campaign.tasks];
  mkdirSync(dir, { recursive: true });
  for (const solve of solves) {
    const verdict = events.findLast(({ kind, data }) => kind === "verdict" && data.solve === solve)?.data;
    const packet = {
      solve,
      task: tasks.find((task) => task.taskId === verdict?.task) ?? null,
      rules: campaign.contract.rules,
      answer: verdict?.answer ?? null,
      refusedBy: verdict?.blocking ?? [],
    };
    writeFileSync(join(dir, `${solve}.json`), `${capturedJsonStringify(packet, null, 2)}\n`);
  }
  writeFileSync(
    labelFile,
    `${capturedJsonStringify(Object.fromEntries(solves.map((solve) => [solve, ""])), null, 2)}\n`,
  );
  console.log(
    `${plural(solves.length, "fail")} to label in ${labelFile}, ${String(flagged.length)} of them flagged, a packet each beside it`,
  );
  return 0;
}

runtimeProcess.exitCode = await main();

/**
 * Phase C's reading of the answers a stored pack's checker refused, by a person and by the Referee.
 *
 *   bun tools/c/rejections.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss-check
 *
 * Run so, with no model, it puts each of the sweep's rejected answers into the campaign's log as the
 * verdict this verifier gives it today, beside one answer the checks accept for the same task (a
 * stored pass, or the pack's accept control), and prints the reading so far
 * (`src/review/rejections.ts`). Then, in this order:
 *
 *   ... --draw 20                            a sample for a person to label, blind
 *   ... --referee claude/claude-opus-5-5     the Referee's ruling of every refused answer
 *
 * `--draw` writes `labels.json` beside the log, one empty entry a drawn solve, and one packet a
 * solve under `label/`: the task with its hidden values, the public contract (scope, conventions,
 * rules, answer format and objective), the answer and the checks that refused it. A person writes
 * `earned`, `check-defect` or `unclear` into each entry. `--referee` starts no reading while an
 * entry is empty, since the log shows a ruling to whoever opens it. Run again it goes on with the
 * fails not yet ruled.
 *
 * With the labels in, the reading sets the Referee's rulings beside them (`agreement.ts`) and says
 * whether they clear the bar: `--caught` and `--voided`, by default the plan's proposal for its
 * decision 33 of three in four of the labelled check defects voided, by any ruling but earned, and
 * at most one in ten of the labelled earned fails voided, read on no fewer than thirty labelled
 * fails (`clears`). The bar is the operator's to set before the first label is written.
 *
 * The campaign is one of `tools/d2/campaign.ts`, under a name of its own, so its log is not a
 * round's. Not run here: it needs the pack, the sweep and the Mac's verifier wall, and `--referee`
 * a model login.
 */
import { contractHash } from "#src/kernel/contract.ts";
import { append, read } from "#src/kernel/log.ts";
import { refusedBy, verdictsOf } from "#src/kernel/solves.ts";
import { decided, spelled, type Task } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { parseArgs } from "#src/meta/process.ts";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { agreement, clears, RULINGS } from "#src/review/agreement.ts";
import { drawn, labelled, rejections } from "#src/review/rejections.ts";
import { openCampaign, stayAwake } from "../d2/campaign.ts";
import type { Campaign } from "../d2/round.ts";
import { modelNamed, packControls, type Row, storedAnswer, sweepRows } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    jobs: { type: "string", default: "4" },
    draw: { type: "string" },
    referee: { type: "string" },
    "referee-effort": { type: "string", default: "high" },
    caught: { type: "string", default: "0.75" },
    voided: { type: "string", default: "0.1" },
  },
});

/** What grading the sweep's stored answers takes: the campaign, the sweep's rows, the pack the
 *  accept controls are read from, how many grade at once, and the pack's task by id. */
interface StoredAnswers {
  readonly campaign: Pick<Campaign, "log" | "verify">;
  readonly rows: readonly Row[];
  readonly sweep: string;
  readonly bundle: string;
  readonly jobs: number;
  readonly taskOf: (taskId: string) => Task;
}

/**
 * The stored rejections, and for each task that has one an answer the checks accept, which the
 * Referee is shown beside the refused one: the first stored answer v1 passed, or failing that the
 * pack's own accept control. Each is logged as this verifier grades it now, so that a check's
 * replay is held to this verifier's own verdict and not to v1's. One line an answer that is
 * graded otherwise than v1's record says, or could not be graded, and null where the two agree.
 */
async function gradedStored({ campaign, rows, sweep, bundle, jobs, taskOf }: StoredAnswers) {
  const { log } = campaign;
  const solveId = (row: Row) => `${row.sweep}-${row.cycle}-${row.taskId}`;
  const stored = (row: Row) => ({
    solve: solveId(row),
    taskId: row.taskId,
    answer: storedAnswer(row),
    expected: row.expected === null ? "" : spelled(row.expected),
    control: false,
  });
  const rejected = rows.filter((row) => row.expected?.kind === "fail");
  const controls = packControls(bundle).filter((control) => control.refusedBy === null);
  const accepted = [...new Set(rejected.map((row) => row.taskId))].flatMap((taskId) => {
    const passed = rows.find((row) => row.taskId === taskId && row.expected?.kind === "pass");
    if (passed !== undefined) return [stored(passed)];
    const control = controls.find((each) => each.taskId === taskId);
    return control === undefined
      ? []
      : [
          {
            solve: `${sweep}-control-${taskId}`,
            taskId,
            answer: control.answer,
            expected: "pass",
            control: true,
          },
        ];
  });
  const held = verdictsOf(read(log));
  return await pooled(
    [...accepted, ...rejected.map(stored)].filter(({ solve }) => !held.has(solve)),
    jobs,
    async ({ solve, taskId, answer, expected, control }) => {
      if (answer === undefined) return `${solve}: no answer on disk`;
      const verdict = await decided(campaign.verify, taskOf(taskId), answer);
      // An accept control the checks refuse is no answer a solver gave and no accepted answer to
      // set beside one: it is a fault of the pack's controls, which `accept.ts` names. Logged, it
      // stood among the refused answers and was read and counted as one: on the truss pack, 10 of
      // the 74 the Referee ruled on 8 October were such controls.
      if (control && verdict.kind !== "pass") {
        return `${solve}: the pack's accept control does not pass (${spelled(verdict)}), so it is not logged`;
      }
      const fields =
        verdict.kind === "fail"
          ? { kind: verdict.kind, blocking: [...verdict.blocking] }
          : verdict.kind === "faulty"
            ? { kind: verdict.kind, check: verdict.check, reason: verdict.reason }
            : { kind: verdict.kind };
      append(log, "verdict", { solve, task: taskId, answer, ...fields });
      // The whole verdict is compared, the refusing checks with it: a fail that names other checks
      // than v1's record is a verifier that differs, though both say fail.
      const now = spelled(verdict);
      return now === expected ? null : `${solve}: on record ${expected}, now ${now}`;
    },
  );
}

async function main(): Promise<void> {
  const { root, sweep, bundle, name } = values;
  if (root === undefined || sweep === undefined || bundle === undefined || name === undefined) {
    throw new Error("name --root, --sweep, --bundle and --name");
  }
  const rows = sweepRows(root, sweep);
  const [first] = rows;
  if (first === undefined) throw new Error(`${sweep} graded no solve`);
  const campaign = await openCampaign({ root, sweep, cycle: first.cycle, bundle, name });
  const { log, contract } = campaign;
  const tasks = new Map(campaign.tasks.map((task) => [task.taskId, task]));
  const taskOf = (taskId: string) => {
    const task = tasks.get(taskId);
    if (task === undefined) throw new Error(`the pack holds no task ${taskId}`);
    return task;
  };
  const jobs = Number(values.jobs);
  const apart = await gradedStored({ campaign, rows, sweep, bundle, jobs, taskOf });
  for (const line of apart) if (line !== null) console.log(`apart: ${line}`);

  const dir = dirname(log);
  const labelFile = join(dir, "labels.json");
  const verdictOf = (solve: string) => verdictsOf(read(log)).get(solve);
  const taskIn = (solve: string) => {
    const task = verdictOf(solve)?.task ?? null;
    if (task === null) throw new Error(`the verdict of ${solve} names no task`);
    return taskOf(task);
  };
  if (values.draw !== undefined) {
    if (existsSync(labelFile)) throw new Error(`${labelFile} holds a draw already`);
    const solves = drawn(read(log), Number(values.draw), contractHash(contract));
    mkdirSync(join(dir, "label"), { recursive: true });
    for (const solve of solves) {
      const verdict = verdictOf(solve);
      const packet = {
        solve,
        task: taskIn(solve),
        // The whole public contract: a label read on the rules alone misses a convention or the format.
        contract,
        answer: verdict?.answer ?? null,
        refusedBy: refusedBy(verdict),
      };
      writeFileSync(join(dir, "label", `${solve}.json`), `${capturedJsonStringify(packet, null, 2)}\n`);
    }
    const empty = Object.fromEntries(solves.map((solve) => [solve, ""]));
    writeFileSync(labelFile, `${capturedJsonStringify(empty, null, 2)}\n`);
    console.log(
      `${String(solves.length)} fails to label in ${labelFile}, a packet each under ${join(dir, "label")}`,
    );
  }
  const { labels, open } = labelled(
    existsSync(labelFile) ? capturedJsonParse(readFileSync(labelFile, "utf8")) : {},
    RULINGS,
  );

  if (values.referee !== undefined) {
    if (!existsSync(labelFile) || open.length > 0) {
      throw new Error(
        `the Referee reads nothing before the drawn fails are labelled: ${existsSync(labelFile) ? `${String(open.length)} entries of ${labelFile} are empty` : "run --draw first"}`,
      );
    }
    // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
    const effort = values["referee-effort"] as ThinkingLevel;
    const { referee } = campaign.reviewers(campaign.reader(modelNamed(values.referee), effort));
    const kill = new AbortController();
    stayAwake();
    await pooled(rejections(read(log)).unruled, jobs, (solve) =>
      referee(solve, campaign.pack(taskIn(solve)), kill.signal),
    );
  }

  const reading = rejections(read(log));
  console.log(capturedJsonStringify(reading, null, 2));
  if (labels.size > 0 && open.length === 0) {
    const measured = agreement(read(log), labels);
    const bar = { caught: Number(values.caught), voided: Number(values.voided) };
    console.log(capturedJsonStringify({ ...measured, bar, clears: clears(measured, bar) }, null, 2));
  }
}

await main();

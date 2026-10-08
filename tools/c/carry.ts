/**
 * Phase C, after a repair is adopted and without a model: the tasks an old campaign's sessions
 * wrote, taken into the campaign of the repaired checker.
 *
 *   bun tools/c/carry.ts --from .ana/d2/truss/log.jsonl --root ../anabasis-cycles-4c67fc \
 *     --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-repaired --name truss-2
 *
 * A repaired checker takes a campaign of its own (`accept.ts --freeze`), and a task's version holds
 * its check program, so every task goes through the gates again there. The pack's own tasks do so
 * from the stored sweep (`admit-sweep.ts`). A task an Examiner wrote had no way in but a new
 * session and a new stronger solve, which is what made a repair dear enough to put off.
 *
 * Nothing of a task needs a model the second time. Its stronger solve's answer is in the old log,
 * and so are its controls; the repaired checks are put to both. Gate 2 passes when they accept the
 * answer the old checks accepted, as `admit-sweep.ts` passes it on a stored solve's answer, and the
 * task is refused when they do not: its witness is gone. Gates 3 and 4 run as they always do. A
 * carried task is left held and feasible, for `prepare.ts` and a round.
 *
 * Also counted, and not carried: a task the old checker closed as too hard whose refused answer the
 * repaired checks accept. It was never given controls, and only a session writes those.
 *
 * Run again, it takes nothing twice. It needs the repaired pack and the Mac's verifier wall.
 */
import { append, type EventKind, read } from "#src/kernel/log.ts";
import { controlsGate, determinismGate, packageGate, taskStates, taskVersion } from "#src/kernel/task.ts";
import { decided, spelled } from "#src/kernel/verify.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { pooled } from "#src/meta/pool.ts";
import { parseArgs } from "#src/meta/process.ts";
import { type Carriable, carriable, openCampaign } from "../d2/campaign.ts";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    bundle: { type: "string" },
    name: { type: "string" },
    jobs: { type: "string", default: "4" },
  },
});

async function main(): Promise<void> {
  const { from, root, sweep, cycle, bundle, name } = values;
  if (
    from === undefined ||
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined
  ) {
    throw new Error("name --from, --root, --sweep, --cycle, --bundle and --name");
  }
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const { log, contract, verify } = campaign;
  const { feasible, recovered, bare } = carriable(read(from));
  const known = taskStates(read(log));
  /** One task through the four gates under this campaign's checker: the word of how it ended. */
  const carry = async ({ task, solve, accepted, controls }: Carriable): Promise<string> => {
    const packaged = campaign.pack(task);
    const version = taskVersion(packaged);
    if (known.has(version)) return "already there";
    const record = (kind: EventKind, data: JsonObject) => append(log, kind, { version, ...data });
    const refused = (gate: number, reason: string) => {
      record("task.gate", { gate, outcome: "refused", reason });
      record("task.state", { state: "refused" });
      return `refused at gate ${String(gate)}`;
    };
    const { taskId, family, publicInput, hidden } = task;
    record("task.proposed", { taskId, carried: solve, task: { taskId, family, publicInput, hidden } });
    const shaped = packageGate(contract, packaged);
    if (shaped.outcome === "refused") return refused(1, shaped.reason);
    record("task.gate", { gate: 1, outcome: "passed" });
    const verdict = await decided(verify, packaged, accepted);
    if (verdict.kind !== "pass") {
      return refused(2, `the repaired checks do not accept its stronger solve's answer: ${spelled(verdict)}`);
    }
    // The accepted answer under this checker, where a reviewer looks for one beside a fail.
    append(log, "verdict", { solve: `carried-${solve}`, task: taskId, answer: accepted, kind: "pass" });
    record("task.gate", { gate: 2, outcome: "passed", solve: `carried-${solve}` });
    const repeated = await determinismGate(verify, packaged, accepted);
    if (repeated.outcome === "refused") return refused(3, repeated.reason);
    record("task.gate", { gate: 3, outcome: "passed" });
    const held = await controlsGate(contract, verify, packaged, accepted, controls);
    if (held.outcome === "refused") return refused(4, held.reason);
    record("task.gate", { gate: 4, ...held, set: controls.map((control) => ({ ...control })) });
    return "feasible";
  };
  const words = await pooled(feasible, Number(values.jobs), carry);
  const count = (word: string) => words.filter((each) => each.startsWith(word)).length;
  const lifted = await pooled(recovered, Number(values.jobs), async ({ task, accepted }) =>
    (await decided(verify, campaign.pack(task), accepted)).kind === "pass" ? [task.taskId] : [],
  );
  console.log(
    `${String(feasible.length)} tasks with their controls on record: ${String(count("feasible"))} feasible here, ${String(count("refused"))} refused, ${String(count("already"))} already there`,
  );
  for (const [index, word] of words.entries()) {
    if (word.startsWith("refused")) console.log(`  ${feasible[index]?.task.taskId ?? ""}\t${word}`);
  }
  console.log(
    `${String(lifted.flat().length)} of ${String(recovered.length)} tasks closed as too hard on a refused answer are accepted by these checks, and need controls: ${lifted.flat().join(", ") || "none"}`,
  );
  if (bare > 0) {
    console.log(`${String(bare)} feasible tasks whose controls the old log does not hold were left`);
  }
}

await main();

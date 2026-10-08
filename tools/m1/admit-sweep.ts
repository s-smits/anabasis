/**
 * M1 on a stored sweep: each task of the sweep's pack through the five gates and into a state, its
 * history appended to a log and the states read back from that log. The stored solves stand in for
 * fresh ones, so no model session runs; the verifier does, for gates 3 and 4.
 *
 *   bun tools/m1/admit-sweep.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --stronger c05
 *
 * The first cycle is the old harness and the last the new. Gate 3 reruns the check on the stronger
 * solve's stored answer. A verifier non-result stops the run, as it would a live one.
 *
 * With `--log` the history is appended to that log and kept, and a task the log already holds goes
 * on from the gate it reached: a run the verifier stopped part way strands no task half gated. With `--feasible` a task stops after gate 4 and stays held: that is how a pack's
 * tasks enter a campaign's log (`tools/d2/campaign.ts`), where a round screens them under its own
 * two harnesses and a stored cycle's solves choose nothing.
 *
 * The sweep predates the plan, so four parts are stood in for:
 * - The pair is the model pair, but the sweep ran one solver, so `--stronger` names the cycle whose
 *   solve stands in for the stronger condition's.
 * - The contract is the check program's brief: its public rule decisions are the rules. Its answer
 *   format is the schema the sweep's record tool took, as the first decided solve recorded it, since
 *   the brief's own `artifactSchema` is prose that v1 compiled.
 * - A task's rule ids are those its family's checks cite.
 * - Gate 4's controls are the first three v1 wrote for the task, edited from the author's accepted
 *   answer rather than from the stronger solve's, each with the check v1 named for it to fail. A
 *   task v1 gave fewer than three is refused.
 * - The check program is the bundle's, copied once without its battery (`checkProgram`).
 */
import { departure } from "#src/kernel/acceptance.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { append, type EventKind, read } from "#src/kernel/log.ts";
import {
  type RejectControl,
  controlsGate,
  determinismGate,
  packageGate,
  screen,
  type TaskPackage,
  type TaskState,
  taskStates,
  taskVersion,
} from "#src/kernel/task.ts";
import { checkProgramVersion, openVerifier } from "#src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync } from "#src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import {
  checkProgram,
  contractOf,
  packageOf,
  packControls,
  packSet,
  readPack,
  recordedAnswerFormat,
  storedAnswer,
  sweepRows,
} from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    stronger: { type: "string" },
    jobs: { type: "string", default: "4" },
    log: { type: "string" },
    feasible: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const { root, sweep, bundle, stronger } = values;
  if (root === undefined || sweep === undefined || bundle === undefined || stronger === undefined) {
    throw new Error("name --root, --sweep, --bundle and --stronger");
  }
  const { brief, tasks } = readPack(bundle);
  const controls = packControls(bundle);
  const dir = mkdtempSync(join(tmpdir(), "ana-admit-"));
  const checks = checkProgram(bundle, join(dir, "checks"));
  const verify = openVerifier({ checks, tools: join(bundle, ".toolchain") });

  const rows = sweepRows(root, sweep);
  const [first] = rows;
  if (first === undefined) throw new Error(`${sweep} has no decided solve`);
  const contract = contractOf(brief, recordedAnswerFormat(first));
  const cycles = [...new Set(rows.map((row) => row.cycle))].sort();
  const [old = "", fresh = ""] = [cycles[0], cycles.at(-1)];
  // A non-result is no solve at all, so a task whose only solve in a cycle is one stays unscreened.
  const stored = new Map(
    rows.flatMap((row) =>
      row.ending.outcome === "non-result"
        ? []
        : [[`${row.taskId} ${row.cycle}`, { ...row, ending: row.ending }]],
    ),
  );
  const solveIn = (taskId: string, cycle: string) => stored.get(`${taskId} ${cycle}`);
  console.log(`old ${old}, new ${fresh}, stronger ${stronger}`);

  const v1Controls = (taskId: string): [JsonValue, RejectControl[]] => {
    const own = packSet(controls, taskId);
    return own === null ? [null, []] : [own.accepted, own.set];
  };

  const log = values.log ?? join(dir, "log.jsonl");
  mkdirSync(dirname(log), { recursive: true });
  // What the log already holds of each task, so a run a verifier stopped part way goes on from the
  // gate it reached and a task is never proposed twice.
  const logged = read(log);
  // A campaign's log whose checker the operator froze takes no task under another: the tasks would
  // carry versions no solve of that campaign can be asked for (`tools/c/accept.ts --freeze`).
  const moved = departure(logged, {
    contract: contractHash(contract),
    checks: hashJsonValue(checkProgramVersion(checks)),
  });
  if (moved !== null) throw new Error(`${log}: ${moved}`);
  const known = taskStates(logged);
  const gatesOf = (version: string) =>
    logged.flatMap(({ kind, data }) => (kind === "task.gate" && data.version === version ? [data] : []));
  /** One task through the gates, each step appended to the log. Returns why it stopped where it did. */
  const admit = async (task: TaskPackage, version: string): Promise<string> => {
    const record = (kind: EventKind, data: JsonObject) => append(log, kind, { version, ...data });
    const settle = (state: TaskState, why = "") => {
      record("task.state", { state });
      return why;
    };
    const state = known.get(version);
    const earlier = gatesOf(version);
    if (state !== undefined && state !== "held") return `already ${state}`;
    // A gate an earlier run logged as not passed, with the state that follows it never written.
    const ended = earlier.find((gate) => gate.outcome !== "passed");
    if (ended !== undefined) return settle(ended.outcome === "too-hard" ? "too-hard" : "refused", "settled");
    const reached = earlier.length;
    const gated = (gate: number, result: JsonObject) => {
      if (gate > reached) record("task.gate", { gate, ...result });
    };
    if (state === undefined) record("task.proposed", { taskId: task.taskId });
    const packaged = packageGate(contract, task);
    gated(1, packaged);
    if (packaged.outcome === "refused") return settle("refused", `gate 1: ${packaged.reason}`);
    const strong = solveIn(task.taskId, stronger);
    if (strong === undefined) return `no counted solve in ${stronger}`;
    if (strong.ending.outcome !== "pass") {
      gated(2, { outcome: "too-hard" });
      return settle("too-hard", strong.ending.kind);
    }
    gated(2, { outcome: "passed" });
    const accepted = storedAnswer(strong);
    if (accepted === undefined) return `the ${stronger} pass left no answer`;
    const gates = [
      [3, () => determinismGate(verify, task, accepted)],
      [4, () => controlsGate(contract, verify, task, ...v1Controls(task.taskId))],
    ] as const;
    for (const [number, run] of gates) {
      if (number <= reached) continue;
      const result = await run();
      gated(number, result);
      if (result.outcome === "refused") return settle("refused", `gate ${number}: ${result.reason}`);
    }
    if (values.feasible) return "feasible, left held";
    const [before, after] = [old, fresh].map((cycle) => solveIn(task.taskId, cycle));
    if (before === undefined || after === undefined) return "feasible, unscreened";
    return settle(screen([[before.ending], [after.ending]], 1));
  };

  try {
    const packages = tasks.map((task) => packageOf(checks, task));
    const versions = new Map(packages.map((task) => [task.taskId, taskVersion(task)]));
    const why = new Map<string, string>();
    const queue = [...packages];
    const work = async (): Promise<void> => {
      for (let task = queue.shift(); task !== undefined; task = queue.shift()) {
        why.set(task.taskId, await admit(task, versions.get(task.taskId) ?? ""));
      }
    };
    await Promise.all(Array.from({ length: Number(values.jobs) }, work));
    const states = taskStates(read(log));
    for (const [taskId, version] of [...versions].sort(([left], [right]) => left.localeCompare(right))) {
      console.log(`  ${taskId}\t${states.get(version) ?? "?"}\t${why.get(taskId) ?? ""}`);
    }
    const counts = countBy([...states.values()], (state) => state);
    console.log(
      Object.entries(counts)
        .map(([state, count]) => `${count} ${state}`)
        .join(", "),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();

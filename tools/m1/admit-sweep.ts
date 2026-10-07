/**
 * M1 on a stored sweep: each task of the sweep's pack through the five gates and into a state, its
 * history appended to a log and the states read back from that log. The stored solves stand in for
 * fresh ones, so no model session runs; the verifier does, for gates 3 and 4.
 *
 *   bun tools/m1/admit-sweep.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --stronger c05
 *
 * The first cycle is the old harness and the last the new, and `--stronger` names the cycle whose
 * solve is gate 2's. The pair is the budget pair, with B and C set from the sweep's passes and the
 * dollars as this meter reads them. Gate 3 reruns the check on the stronger solve's stored answer.
 *
 * The sweep predates the plan, so three parts are stood in for:
 * - The contract is the check program's brief: its public rule decisions are the rules and its
 *   artifact schema the answer format.
 * - A task's statement is its id under the brief's domain, since v1's tasks carry none, and its rule
 *   ids are those its family's checks cite.
 * - Gate 4's controls are the first three v1 wrote for the task, edited from the author's accepted
 *   answer rather than from the stronger solve's. A task v1 gave fewer than three is refused.
 */
import { calibrate, type Pair, screen, strongerPasses } from "#src/kernel/bracket.ts";
import type { Contract } from "#src/kernel/contract.ts";
import { append, type EventKind, read } from "#src/kernel/log.ts";
import {
  CONTROLS,
  controlsGate,
  determinismGate,
  packageGate,
  type TaskPackage,
  type TaskState,
  taskStates,
  taskVersion,
} from "#src/kernel/task.ts";
import { applicableTruthChecks, openVerifier, readBrief, type Task } from "#src/kernel/verify.ts";
import { mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { type Priced, pricedRows, solveOf, storedAnswer, sweepRows } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    bundle: { type: "string" },
    stronger: { type: "string" },
    jobs: { type: "string", default: "4" },
  },
});

/** The parts of v1's `brief.json` the stand-in contract is made from. */
interface PackBrief {
  readonly domain: string;
  readonly artifactSchema: JsonValue;
  readonly ruleDecisions: readonly { id: string; visibility: string; statement: string }[];
}

/** v1's `controls.json`: answers the check must accept, and edits of them it must reject. */
interface PackControls {
  readonly accept: readonly { taskId: string; artifact: JsonValue }[];
  readonly reject: readonly { taskId: string; artifact: JsonValue }[];
}

function contractOf(brief: PackBrief): Contract {
  return {
    answerFormat: brief.artifactSchema,
    tools: [],
    install: "",
    conventions: "",
    rules: brief.ruleDecisions.filter((rule) => rule.visibility === "public"),
    scope: brief.domain,
  };
}

async function main(): Promise<void> {
  const { root, sweep, bundle, stronger } = values;
  if (root === undefined || sweep === undefined || bundle === undefined || stronger === undefined) {
    throw new Error("name --root, --sweep, --bundle and --stronger");
  }
  const checks = join(bundle, "correctness-model");
  const brief = parseJsonAs<PackBrief>(readFileSync(join(checks, "brief.json"), "utf8"));
  const controls = parseJsonAs<PackControls>(readFileSync(join(checks, "controls.json"), "utf8"));
  const tasks = parseJsonAs<Task[]>(readFileSync(join(checks, "tasks.json"), "utf8"));
  const contract = contractOf(brief);
  const verify = openVerifier({ checks, tools: join(bundle, ".toolchain") });

  const { rows } = sweepRows(root, sweep);
  const { priced } = pricedRows(rows);
  const pair: Pair = { kind: "budget", budget: calibrate(priced.map((solve) => solveOf(solve, "meter"))) };
  const cycles = [...new Set(rows.map((row) => row.cycle))].sort();
  const [old = "", fresh = ""] = [cycles[0], cycles.at(-1)];
  const stored = new Map(priced.map((solve) => [`${solve.row.taskId} ${solve.row.cycle}`, solve]));
  const solveIn = (taskId: string, cycle: string): Priced | undefined => stored.get(`${taskId} ${cycle}`);
  console.log(
    `B $${pair.budget.dollars.toFixed(2)}, C ${pair.budget.cpuSeconds.toFixed(0)} CPU s; ` +
      `old ${old}, new ${fresh}, stronger ${stronger}`,
  );

  const v1Controls = (taskId: string): [JsonValue, JsonValue[]] => {
    const accepted = controls.accept.find((control) => control.taskId === taskId)?.artifact ?? null;
    const rejects = controls.reject.filter((control) => control.taskId === taskId);
    return [accepted, rejects.slice(0, CONTROLS).map((control) => control.artifact)];
  };

  const dir = mkdtempSync(join(tmpdir(), "ana-admit-"));
  const log = join(dir, "log.jsonl");
  /** One task through the gates, each step appended to the log. Returns why it stopped where it did. */
  const admit = async (task: TaskPackage, version: string): Promise<string> => {
    const record = (kind: EventKind, data: JsonObject) => append(log, kind, { version, ...data });
    const gated = (gate: number, result: JsonObject) => record("task.gate", { gate, ...result });
    const settle = (state: TaskState, why = "") => {
      record("task.state", { state });
      return why;
    };
    record("task.proposed", { taskId: task.taskId });
    const packaged = packageGate(contract, task);
    gated(1, packaged);
    if (packaged.outcome === "refused") return settle("refused", `gate 1: ${packaged.reason}`);
    const strong = solveIn(task.taskId, stronger);
    if (strong === undefined) return `no priced solve in ${stronger}`;
    if (!strongerPasses(pair, solveOf(strong, "meter"))) {
      gated(2, { outcome: "too-hard" });
      return settle("too-hard");
    }
    gated(2, { outcome: "passed" });
    const accepted = storedAnswer(strong.row);
    if (accepted === undefined) return `the ${stronger} pass left no answer`;
    const gates = [
      [3, () => determinismGate(verify, task, accepted)],
      [4, () => controlsGate(verify, task, ...v1Controls(task.taskId))],
    ] as const;
    for (const [number, run] of gates) {
      const result = await run();
      gated(number, result);
      if (result.outcome === "refused") return settle("refused", `gate ${number}: ${result.reason}`);
      if (result.outcome === "non-result") return `gate ${number}: ${result.reason}`;
    }
    const [before, after] = [old, fresh].map((cycle) => solveIn(task.taskId, cycle));
    if (before === undefined || after === undefined) return "feasible, unscreened";
    return settle(screen(pair, [solveOf(before, "meter"), solveOf(after, "meter")]));
  };

  try {
    const packages = tasks.map((task): TaskPackage => {
      const cited = applicableTruthChecks(readBrief(checks), task).flatMap((check) => check.citedDecisionIds);
      return { ...task, statement: `${brief.domain}: ${task.taskId}`, ruleIds: [...new Set(cited)], checks };
    });
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

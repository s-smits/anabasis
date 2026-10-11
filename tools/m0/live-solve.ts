/**
 * One task of a stored sweep, solved again through this host's runner, for M0's exit tests 2 and 3,
 * the pilot's smoke solves and Phase 2's live parity tasks:
 *
 *   bun tools/m0/live-solve.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c07 \
 *     --task forbidden-volumes-01 --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace
 *
 * Without `--live` no model is called. The condition is built and printed, and then what the solver
 * would read: its system prompt whole and its tools by name, built on a mounted wall as a solve
 * builds them. Until 2026-10-09 both were held to what the stored solve read, row by row, which was
 * milestone 0's parity with v1's sweep. A v2 solver is pi's coding agent and no longer v1's Built
 * shell (`src/solve/coding-tools.ts`, `src/solve/prompt.ts`), so its tools and its prompt part from
 * the sweep's by design, and only what still is v1's is held to it: the first turn's template, the
 * nudge and the turn cap, against the digests and `maxTurns` v1 recorded. With `--live` the solve runs, and
 * its log is read back: the ending, the meter's billed dollars against Claude Code's reported cost
 * (exit test 2 asks within 1%), and the events the solve wrote (exit test 3). A live solve on a Mac
 * runs under `caffeinate -s`.
 *
 * The solve is the stored one's: its harness state is `hb-bundles/<sweep>-<cycle>`, its model and
 * effort are those it recorded, and its contract, task and resources are the bundle's, as
 * `tools/d2/campaign.ts` reads them. `--harness` solves under another state instead, such as a Builder's
 * kept one, and the read-back sets its ending beside the stored solve's: the pilot's informal reading
 * of old against new until M2. `--solver` and `--solver-effort` solve on another model in its place. The limits are the sweep's `config.yaml` and `maxTurns`, but for the
 * disk cap, which the sweep did not have.
 * The harness's digest binds its tool tree, so it is the condition's `solverTools` too. The condition's `sandbox` stands in for the policy's digest with its profile, platform and cap,
 * since the policy names each solve's own directories.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { backends, compactionMode } from "#src/backends/models.ts";
import { type Condition, conditionId, type Limits, recordCondition } from "#src/kernel/condition.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { ended, solvesIn } from "#src/kernel/solves.ts";
import { freezePrices, priceKey } from "#src/kernel/meter.ts";
import { taskVersion } from "#src/kernel/task.ts";
import { openVerifier } from "#src/kernel/verify.ts";
import { sha256 } from "#src/meta/digest.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { join, resolve } from "#src/meta/path.ts";
import { capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { openDesk } from "#src/solve/answer.ts";
import { networkReach, solveDirs, walledBase } from "#src/solve/command.ts";
import { type Harness, openHarness, treeContent } from "#src/solve/harness.ts";
import { firstTurn, installedPrograms, NUDGE, seedHome, systemPrompt } from "#src/solve/prompt.ts";
import { type SolveRequest, solve, solverTools } from "#src/solve/run.ts";
import { mountDiskCap } from "#src/verify/disk-cap.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "#src/verify/solve-sandbox.ts";
import { worktreesOf } from "../d2/campaign.ts";
import {
  checkProgram,
  contractOf,
  packageOf,
  readPack,
  recordedAnswerFormat,
  modelNamed,
  rowModel,
  sweepOptions,
  type StoredRuntime,
  storedRuntime,
  sweepResources,
  sweepRows,
} from "./stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
    cycle: { type: "string" },
    task: { type: "string" },
    bundle: { type: "string" },
    harness: { type: "string" },
    solver: { type: "string" },
    "solver-effort": { type: "string", default: "high" },
    live: { type: "boolean", default: false },
  },
});

/** The sweep's `config.yaml`: 120 minutes, shell 300 s by default and 900 at most, one solve at a
 *  time; and its solves' `maxTurns`, 24 prompts. */
const LIMITS: Limits = {
  wallSeconds: 7200,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 1,
  diskBytes: 2 * 1024 ** 3,
};
const REPO = resolve(import.meta.dir, "..", "..");
/** The agent runtime's packages, pinned in `package.json`; the SDK pins the Claude Code binary. */
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];

async function main(): Promise<number> {
  const { root, sweep, cycle, task: taskId, bundle, harness: state, live } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    taskId === undefined ||
    bundle === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --task and --bundle");
  }
  const row = sweepRows(root, sweep).find((each) => each.cycle === cycle && each.taskId === taskId);
  if (row === undefined) throw new Error(`${sweep} graded no ${taskId} in ${cycle}`);
  const stored = storedRuntime(row);
  const { brief, tasks } = readPack(bundle);
  const task = tasks.find((each) => each.taskId === taskId);
  if (task === undefined) throw new Error(`${bundle} has no task ${taskId}`);

  // The check program is staged inside the repository, which a solve's sandbox denies, as v1 kept
  // it: a copy in the temp folder would be open to the solver's shell.
  const scratch = join(REPO, ".ana", "live");
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "checks-"));
  try {
    const checks = checkProgram(bundle, join(dir, "checks"));
    const contract = contractOf(brief, recordedAnswerFormat(row));
    const resources = sweepResources(brief);
    const harnessDir = state ?? join(root, "hb-bundles", `${sweep}-${row.cycle}`);
    const harness = await openHarness(harnessDir);
    const model = values.solver === undefined ? rowModel(row) : modelNamed(values.solver);
    const effort =
      values.solver === undefined
        ? stored.modelWorker.modelSelection.effort
        : // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
          (values["solver-effort"] as ThinkingLevel);
    const pins = parseJsonAs<{ dependencies: Record<string, string> }>(
      readFileSync(join(REPO, "package.json"), "utf8"),
    ).dependencies;
    const condition: Condition = {
      contract: contractHash(contract),
      harness: harness.digest,
      task: taskVersion(packageOf(checks, task)),
      model: priceKey(model),
      effort,
      prices: freezePrices([model]),
      runtime: Object.fromEntries(RUNTIME.map((name) => [name, pins[name] ?? "unpinned"])),
      compaction: compactionMode(model, sweepOptions()),
      solverTools: harness.digest,
      verifierTools: hashJsonValue(treeContent(join(bundle, ".toolchain"))),
      sandbox: hashJsonValue({
        profile: HOST_SOLVE_ISOLATION_PROFILE_ID,
        platform: runtimeProcess.platform,
        diskBytes: LIMITS.diskBytes,
      }),
      limits: LIMITS,
      // The files as they stand, not the commit: a commit to tests or tools runs no other solve, and
      // an uncommitted change to the runner does.
      host: hashJsonValue(["src", "vendor"].map((part) => treeContent(join(REPO, part)))),
      side: "test",
    };
    const id = conditionId(condition);
    console.log(JSON.stringify({ id, ...condition, prices: undefined }, null, 2));

    console.log(await shown({ task, contract, resources }, harness));
    const turns = turnParity(stored);
    console.log(turns);
    if (!live) return turns.startsWith("same") ? 0 : 1;
    // The plan runs every solve under `caffeinate -s`, so the Mac cannot sleep inside the wall; it
    // exits with this process, and unreferenced it does not hold this one open.
    if (runtimeProcess.platform === "darwin") {
      capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
    }

    // The model and the state's digest in the name, so a solve under another keeps the stored one's log.
    const name = `${row.taskId}-${row.cycle}-${model.id}-${harness.digest.slice(0, 8)}`;
    const log = join(scratch, `${name}.jsonl`);
    recordCondition(log, condition);
    const ending = await solve({
      id: name,
      condition: id,
      task,
      contract,
      harness: harnessDir,
      resources,
      model,
      effort,
      limits: LIMITS,
      models: (home) => backends(sweepOptions(home)),
      verify: openVerifier({
        checks,
        tools: join(bundle, ".toolchain"),
        otherTrees: worktreesOf(REPO),
        packRoots: [root, bundle],
      }),
      log,
      repoRoot: REPO,
      otherTrees: worktreesOf(REPO),
      packRoots: [root, bundle],
    });
    return readBack(log, ending.outcome, row.ending.outcome);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What a solver of this request would read before its first call: its system prompt, then its tools
 * by name. Both are built as `play` builds them, on a mounted wall with the home seeded, so the
 * prompt names the solve's own working directory, its resource files and its installed programs.
 */
async function shown(
  request: Pick<SolveRequest, "task" | "contract" | "resources">,
  harness: Harness,
): Promise<string> {
  const dirs = solveDirs(`dry-${String(runtimeProcess.pid)}-${String(Date.now())}`);
  const cap = { root: dirs.root, bytes: LIMITS.diskBytes };
  const release = await mountDiskCap(cap);
  try {
    const base = await walledBase(
      dirs,
      { repoRoot: REPO, otherTrees: worktreesOf(REPO), diskBytes: cap.bytes },
      "a solve",
    );
    const files = seedHome(dirs.home, request.task, request.resources, request.contract.answerFormat);
    const wall = { base, dirs, toolTree: harness.toolTree, limits: LIMITS };
    const tools = await solverTools(request, harness, wall, openDesk());
    const prompt = systemPrompt({
      tools,
      home: dirs.home,
      guide: harness.guide,
      wallSeconds: LIMITS.wallSeconds,
      limits: LIMITS,
      resources: files,
      programs: installedPrograms(harness.toolTree),
      network: await networkReach(wall),
    });
    return `${prompt}\n\ntools: ${tools.map(({ name }) => name).join(", ")}`;
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}

/** The first turn's template and the nudge against the digests v1 recorded of its own constants
 *  (pi-built.ts:482-483), and the turn cap against its `maxTurns`. The template is recovered from
 *  `firstTurn` by rendering its placeholders as themselves. */
function turnParity(stored: StoredRuntime): string {
  const { firstTurnTemplateDigest, nudgeDigest, maxTurns } = stored.contractCondition;
  const input = "{publicInput}";
  const template = firstTurn({ taskId: "{taskId}", family: "{family}", publicInput: input }).replace(
    JSON.stringify(input),
    input,
  );
  const apart = [
    ...(sha256(template) === firstTurnTemplateDigest ? [] : [`first turn ${JSON.stringify(template)}`]),
    ...(sha256(NUDGE) === nudgeDigest ? [] : [`nudge ${JSON.stringify(NUDGE)}`]),
    ...(LIMITS.turns === maxTurns ? [] : [`turn cap ${String(LIMITS.turns)}, stored ${String(maxTurns)}`]),
  ];
  return apart.length === 0
    ? `same first turn, nudge and turn cap (${String(maxTurns)} prompts)`
    : `turns apart: ${apart.join("; ")}`;
}

/** Exit tests 2 and 3, read from the log alone. */
function readBack(log: string, outcome: string, storedOutcome: string): number {
  const events = read(log);
  console.log(`log: ${JSON.stringify(countBy(events, (event) => event.kind))}`);
  const finished = ended(solvesIn(events)).at(-1)?.end;
  const billed = Number(finished?.billed);
  const reported = finished?.reportedCost;
  console.log(`${outcome}, stored ${storedOutcome}`);
  // Claude Code reports its cost only in the result that ends a query, which a submit ends before.
  if (!isNumber(reported)) {
    console.log(`billed $${billed.toFixed(4)}, none reported: the solve ended before Claude Code's result`);
    return 1;
  }
  const apart = Math.abs(billed - reported) / reported;
  console.log(
    `billed $${billed.toFixed(4)}, reported $${reported.toFixed(4)}: ${(apart * 100).toFixed(2)}% apart`,
  );
  return apart <= 0.01 ? 0 : 1;
}

runtimeProcess.exitCode = await main();

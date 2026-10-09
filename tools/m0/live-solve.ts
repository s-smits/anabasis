/**
 * One task of a stored sweep, solved again through this host's runner, for M0's exit tests 2 and 3,
 * the pilot's smoke solves and Phase 2's live parity tasks:
 *
 *   bun tools/m0/live-solve.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c07 \
 *     --task forbidden-volumes-01 --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace
 *
 * Without `--live` no model is called. The condition is built and printed, and what the solver would
 * read is held against what the stored solve read: the tools, built on a mounted wall as a solve
 * builds them, row by row in order (name, label, description, parameters, execution mode); the
 * system prompt's roster line and guide, since its general paragraph and the guide's preamble are
 * this host's own (`prompt.ts`) and a live solve is not under the sweep's prompt; the first turn's
 * template, the nudge and the turn cap, against the digests and `maxTurns` v1 recorded; and the
 * public resources, against the head of the stored `read_public_resources` result, the part of it
 * v1's trace kept. With `--live` the solve runs, and
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
import type { AgentTool } from "@earendil-works/pi-agent-core";
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
import { canonicalJson, hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { openDesk } from "#src/solve/answer.ts";
import { solveDirs } from "#src/solve/command.ts";
import { type Harness, openHarness, treeContent } from "#src/solve/harness.ts";
import { firstTurn, NUDGE, seedHome, systemPrompt } from "#src/solve/prompt.ts";
import { type SolveRequest, solve, solverTools } from "#src/solve/run.ts";
import { mountDiskCap } from "#src/verify/disk-cap.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID, solveIsolationPolicy } from "#src/verify/solve-sandbox.ts";
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
  type StoredTool,
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
/** The four sentences of v1's command guard that `shell.ts` leaves out, as there is no guard here
 *  (src/solve/dcg-rules.ts:54-56 and 59 at 7af7315). */
const GUARD = [
  "Refused: rm -r outside the command's own folder, find -delete, git clean, git reset --hard.",
  "Delete a tree with rm -rf <relative path>; for anything else move a tree into a literal /tmp/<name> instead.",
  "Write with > to $HOME/<name>, ~/<name>, a relative name or a literal /tmp/<name>; a redirect to any other $VAR/… is refused; make temp dirs with mktemp -d.",
  "A refused command runs nothing: change the spelling and run it again.",
];
const REPO = resolve(import.meta.dir, "..", "..");
/** The agent runtime's packages, pinned in `package.json`; the SDK pins the Claude Code binary. */
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];

/** The head of what the stored solve's first `read_public_resources` call returned. */
interface StoredTrace {
  readonly toolCalls: readonly { toolName: string; resultPreview: string }[];
}

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
  const caseDir = join(row.solve, "harness", "cases", row.taskId);
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

    const tools = await walledTools({ task, contract, resources }, harness);
    const parity = [
      toolParity(stored.contractCondition.tools, tools),
      promptParity(stored, tools, harness.guide),
      turnParity(stored),
      resourceParity(join(caseDir, "trace.json"), JSON.stringify({ resources }, null, 2)),
    ];
    for (const line of parity) console.log(line);
    if (!live) return parity.every((line) => line.startsWith("same")) ? 0 : 1;
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
      verify: openVerifier({ checks, tools: join(bundle, ".toolchain") }),
      log,
      repoRoot: REPO,
    });
    return readBack(log, ending.outcome, row.ending.outcome);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The tools a solve of this request would be given, built as `play` builds them: on a mounted wall,
 * with the home seeded, so the bash description counts the files and programs it names.
 */
async function walledTools(
  request: Pick<SolveRequest, "task" | "contract" | "resources">,
  harness: Harness,
): Promise<AgentTool[]> {
  const dirs = solveDirs(`dry-${String(runtimeProcess.pid)}-${String(Date.now())}`);
  const cap = { root: dirs.root, bytes: LIMITS.diskBytes };
  const release = await mountDiskCap(cap);
  try {
    for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
    const base = solveIsolationPolicy({ repoRoot: REPO, cap });
    if ("unsupported" in base) throw new Error(`this host cannot wall a solve: ${base.unsupported}`);
    const files = seedHome(dirs.home, request.task, request.resources);
    const cpu = { seconds: 0, unmeasured: 0 };
    const wall = { base, dirs, toolTree: harness.toolTree, limits: LIMITS, cpu };
    return await solverTools(request, harness, wall, openDesk(), files);
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}

/** This host's tools against the stored rows, in order, field by field; parameters compare as
 *  canonical JSON, and a description apart shows where it parts. */
function toolParity(storedTools: readonly StoredTool[], tools: readonly AgentTool[]): string {
  const stored = storedTools.map((tool) =>
    tool.name === "bash"
      ? { ...tool, description: GUARD.reduce((text, rule) => text.replace(` ${rule}`, ""), tool.description) }
      : tool,
  );
  const row = (tool: StoredTool | AgentTool | undefined) =>
    tool === undefined
      ? null
      : {
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: canonicalJson(JSON.parse(JSON.stringify(tool.parameters))),
          executionMode: tool.executionMode ?? null,
        };
  const apart: string[] = [];
  for (let index = 0; index < Math.max(stored.length, tools.length); index++) {
    const before = row(stored[index]);
    const after = row(tools[index]);
    if (before === null || after === null) {
      apart.push(`#${String(index)}: stored ${before?.name ?? "none"}, here ${after?.name ?? "none"}`);
      continue;
    }
    const afterFields = new Map(Object.entries(after));
    for (const [key, value] of Object.entries(before)) {
      const [was, is] = [String(value), String(afterFields.get(key))];
      if (was === is) continue;
      let at = 0;
      while (was[at] === is[at]) at++;
      apart.push(
        `${before.name}.${key} parts at ${String(at)}:\n  stored ${was.slice(at, at + 160)}\n  here   ${is.slice(at, at + 160)}`,
      );
    }
  }
  return apart.length === 0
    ? `same tools: ${String(tools.length)} rows, in order, by name, label, description, parameters and execution mode, but for the bash guard's sentences`
    : `tools apart:\n${apart.join("\n")}`;
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

/** The stored system prompt against this host's, given this host's tool names. Both are the general
 *  paragraph, the roster line, then the guide's preamble and the guide. The general paragraph and the
 *  preamble are this host's own (`prompt.ts`), so they are named and not compared; the roster line
 *  and the guide are held to the stored ones. */
function promptParity(stored: StoredRuntime, tools: readonly AgentTool[], guide: string | null): string {
  const parts = (text: string) => {
    const paragraphs = text.split("\n\n");
    return { roster: paragraphs[1] ?? "", guide: paragraphs.slice(3).join("\n\n") };
  };
  const before = parts(stored.contractCondition.systemPrompt);
  const after = parts(
    systemPrompt(
      LIMITS.wallSeconds,
      tools.map((tool) => tool.name),
      guide,
    ),
  );
  const apart = [
    ...(before.roster === after.roster
      ? []
      : [`roster\n  stored ${before.roster}\n  here   ${after.roster}`]),
    ...(before.guide === after.guide ? [] : ["the guide"]),
  ];
  return apart.length === 0
    ? "same roster line and guide; the general paragraph and the guide's preamble are this host's own"
    : `prompt apart beyond the general paragraph and the guide's preamble: ${apart.join("; ")}`;
}

/** This host's resources against the head of the stored result, with whitespace runs folded. */
function resourceParity(trace: string, text: string): string {
  const { toolCalls } = parseJsonAs<StoredTrace>(readFileSync(trace, "utf8"));
  const head = toolCalls.find((call) => call.toolName === "read_public_resources")?.resultPreview;
  if (head === undefined) return "same resources: the stored solve never read them";
  const folded = text.replace(/\s+/g, " ");
  return folded.startsWith(head)
    ? `same resources, over the ${String(head.length)} characters the trace kept`
    : `resources apart:\n  stored ${head}\n  here   ${folded.slice(0, head.length)}`;
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

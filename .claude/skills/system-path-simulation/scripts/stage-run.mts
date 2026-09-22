/**
 * Historical fullrun staging helper. Its configuration-linking and copied-lock handling predate
 * current repository rules; use launch-run for new authorised launches.
 *
 * Five hand-staged conditions on 2026-08-23 used five different scripts; one died before its first turn
 * because the copy had no `.env` and no `domains/`, and the skill already records a condition that
 * inherited `gpt-5.6-luna`/`xhigh` from the calling shell and created a superseding epoch. Each of
 * those is a refusal or a written fact here:
 *
 *   1. a detached worktree at the exact `--source` revision, under a fresh `--dir`;
 *   2. a real `node_modules` prepared once by `scripts/worktree.sh setup` from `--modules-from`,
 *      refused when that tree's `node_modules` is a symlink or lacks `@ana`;
 *   3. `.env` linked from the run repository, `domains/` and `campaigns/` present, the per-project
 *      `.harness/backends/<project>.json` naming all three backend kinds;
 *   4. with `--seed-campaign`, the run's `campaigns/<slug>` and `domains/<slug>` cloned in and the
 *      live run's `.controller.lock` removed from the copy;
 *   5. `launch.sh` carrying the exact six slot pins of the named condition (AGENTS.md: Sol
 *      high/high/medium, Opus 5 medium/medium/medium), the verbatim prompt from a file, and the
 *      run's own `bun src/run/full-run.ts` entry — never a custom driver;
 *   6. `condition.json` beside it: clean source commit/digest, condition, pins, project, explicit run
 *      id, prompt/request digests, expected task count and the product command digest, so the
 *      opening can be checked against the exact request rather than whichever directory happens
 *      to sort last. Prediction/event and condition selection authority stays with the SuperLoop; this
 *      simulation only prepares advisory evidence and never launches.
 *
 *   bun .claude/skills/system-path-simulation/scripts/stage-run.mts \
 *     --source c5efe614f --dir /abs/ana-run-esp32-x --modules-from /abs/worktree-with-node_modules \
 *     --condition sol --project esp32-sol-x --run condition-01 --prompt-file /abs/one-liner.txt \
 *     --expected-tasks 25 --provider-turn-budget 120 [--task-set-digest <64-hex>|none] \
 *     [--max-iterations 1] [--session-cap-ms 10800000] \
 *     [--seed-campaign /abs/run-root --slug esp32-sol]
 *
 *   bun .claude/skills/system-path-simulation/scripts/stage-run.mts --opening --dir /abs/ana-run-esp32-x
 *
 * `--opening` reads only `controller/<run>/opening.json` named in `condition.json` and compares the
 * source, project, run, request, command and slot identities the product actually writes. A
 * missing or mismatched product field is a hold, not an assumed match, and exits non-zero before
 * anyone reads its battery.
 *
 * There is no operator verifier registry: external truth checks run installed tools the host
 * resolves under the candidate `.toolchain` tree and hashes at run time (2026-09-03).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { OPENING_FILE } from "#src/run/controller-lineage.ts";
import { OPERATOR_BACKENDS_DIR } from "#src/backends/operator-selection.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { dependencyIdentityFromBytes, WORKTREE_SCRIPT } from "#tools/dependency-identity.ts";
import { absoluteOption, exitWith, type ExitWith, parseOrDie, requiredOption } from "./cli-args.mts";
import { SeedRefusal, seedCampaignInto } from "./seed-campaign.mts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const die: ExitWith = exitWith("stage-run");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");

/** The named conditions supported by this helper; check current AGENTS.md before reuse. */
type Condition = { kind: string; pins: Record<string, string> };

export const CONDITIONS = new Map<string, Condition>([
  [
    "sol",
    {
      kind: "codex",
      pins: {
        CODEX_BUILDER_MODEL: "gpt-5.6-sol",
        CODEX_BUILT_MODEL: "gpt-5.6-sol",
        CODEX_REVIEW_MODEL: "gpt-5.6-sol",
        CODEX_BUILDER_REASONING_EFFORT: "high",
        CODEX_BUILT_REASONING_EFFORT: "high",
        CODEX_REVIEW_REASONING_EFFORT: "medium",
      },
    },
  ],
  [
    "opus",
    {
      kind: "claude",
      pins: {
        CLAUDE_BUILDER_MODEL: "claude-opus-5",
        CLAUDE_BUILT_MODEL: "claude-opus-5",
        CLAUDE_REVIEW_MODEL: "claude-opus-5",
        CLAUDE_BUILDER_REASONING_EFFORT: "medium",
        CLAUDE_BUILT_REASONING_EFFORT: "medium",
        CLAUDE_REVIEW_REASONING_EFFORT: "medium",
      },
    },
  ],
  [
    "fable",
    {
      kind: "claude",
      pins: {
        CLAUDE_BUILDER_MODEL: "claude-fable-5-1",
        CLAUDE_BUILT_MODEL: "claude-fable-5-1",
        CLAUDE_REVIEW_MODEL: "claude-fable-5-1",
        CLAUDE_BUILDER_REASONING_EFFORT: "medium",
        CLAUDE_BUILT_REASONING_EFFORT: "medium",
        CLAUDE_REVIEW_REASONING_EFFORT: "medium",
      },
    },
  ],
]);

const parsed = parseOrDie(die, {
  values: [
    "source",
    "dir",
    "modules-from",
    "condition",
    "project",
    "run",
    "prompt-file",
    "env-from",
    "max-iterations",
    "max-builder-turns",
    "expected-tasks",
    "iteration-budget",
    "task-set-digest",
    "provider-turn-budget",
    "session-cap-ms",
    "seed-campaign",
    "slug",
  ],
  flags: ["launch", "opening", "allow-absolute-refs", "relocate"],
});
const single = parsed.single;

type ProductIdentity = {
  commit: string;
  dirty: boolean;
  sourceDigest: string;
  requestDigest: string;
  commandDigest: string;
};

interface StageOptions {
  source: string;
  modulesFrom: string;
  modules: string;
  conditionName: string;
  condition: Condition;
  project: string;
  runId: string;
  prompt: string;
  promptBytes: Uint8Array;
  promptDigest: string;
  expectedTasks: number;
  taskSetDigest: string | null;
  maxIterations: string | undefined;
  maxBuilderTurns: string | undefined;
  providerTurnBudget: string;
  iterationBudget: string | undefined;
  sessionCapMs: string | undefined;
  envFrom: string;
  seedCampaign: string | undefined;
  slug: string | undefined;
}

if (parsed.flags.has("launch")) {
  die(
    "--launch is disabled: system-path-simulation only prepares and checks a condition; the SuperLoop launch envelope owns authority",
  );
}

const required = requiredOption(die, single);

const absolute = absoluteOption(die);

function sh(args: string[], cwd: string) {
  const result = runSync(args, { cwd, env: Bun.env });
  return {
    ok: result.exitCode === 0,
    out: decodeOutput(result.stdout).trim(),
    err: decodeOutput(result.stderr).trim(),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function dependencyIdentity(modulesFrom: string, commit: string): string {
  const packageAtCommit = runSync([hostTool("git"), "show", `${commit}:package.json`], { cwd: REPO_ROOT });
  const lockAtCommit = runSync([hostTool("git"), "show", `${commit}:bun.lock`], { cwd: REPO_ROOT });
  if (packageAtCommit.exitCode !== 0 || lockAtCommit.exitCode !== 0) {
    die(`source ${commit.slice(0, 9)} has no readable package.json and bun.lock`);
  }
  const realisedPackage = readFileSync(join(modulesFrom, "package.json"), "utf8");
  const realisedLock = readFileSync(join(modulesFrom, "bun.lock"));
  const expectedPackage = decodeOutput(packageAtCommit.stdout);
  const expected = dependencyIdentityFromBytes(lockAtCommit.stdout, expectedPackage);
  if (dependencyIdentityFromBytes(realisedLock, realisedPackage) !== expected) {
    die(`dependency identity in ${modulesFrom} differs from source ${commit.slice(0, 9)}`);
  }
  return expected;
}

function targetJson(worktree: string, script: string, payload: JsonValue): JsonObject {
  const result = runSync([runtimeProcess.execPath, "--no-env-file", "-e", script, JSON.stringify(payload)], {
    cwd: worktree,
    env: Bun.env,
  });
  const stdout = decodeOutput(result.stdout).trim();
  const stderr = decodeOutput(result.stderr).trim();
  if (result.exitCode !== 0) die(stderr || stdout || "the staged product could not compute its identity");
  try {
    const value = asRecord(JSON.parse(stdout));
    if (value === null) throw new Error("not an object");
    return value;
  } catch (error) {
    die(`the staged product identity was not JSON: ${errorMessage(error)}`);
  }
}

/** Read the source-owned identity from the exact detached checkout, not this skill checkout. */
function targetSourceIdentity(worktree: string): Pick<ProductIdentity, "commit" | "dirty" | "sourceDigest"> {
  const sourceUrl = Bun.pathToFileURL(join(worktree, "src/run/source-identity.ts")).href;
  const script = `
    const source = await import(${JSON.stringify(sourceUrl)});
    console.log(JSON.stringify(source.SOURCE_IDENTITY));
  `;
  const value = targetJson(worktree, script, {});
  const commit = isString(value.commit) ? value.commit : "";
  const dirty = isBoolean(value.dirty) ? value.dirty : null;
  const sourceDigest = isString(value.sourceDigest) ? value.sourceDigest : "";
  if (!/^[0-9a-f]{40}$/.test(commit) || dirty === null || !/^[0-9a-f]{64}$/.test(sourceDigest)) {
    die("the staged product has no complete source identity");
  }
  return { commit, dirty, sourceDigest };
}

/** Parse and hash the launch through the measured checkout's own canonical product semantics. */
function targetProductIdentity(
  worktree: string,
  argv: string[],
): Pick<ProductIdentity, "requestDigest" | "commandDigest"> {
  const argsUrl = Bun.pathToFileURL(join(worktree, "src/run/launch-arguments.ts")).href;
  // A checkout from before the launch file was split still owns the parser; this script stages
  // whatever vintage the measured tree is, so it asks the current owner first.
  const launchUrl = Bun.pathToFileURL(join(worktree, "src/run/full-run-launch.ts")).href;
  const jsonUrl = Bun.pathToFileURL(join(worktree, "src/meta/json-runtime.ts")).href;
  const stableUrl = Bun.pathToFileURL(join(worktree, "src/meta/stable-json.ts")).href;
  const script = `
    const input = JSON.parse(Bun.argv[1]);
    const launch = await import(${JSON.stringify(argsUrl)}).catch(() => import(${JSON.stringify(launchUrl)}));
    const json = await import(${JSON.stringify(jsonUrl)});
    const stable = await import(${JSON.stringify(stableUrl)});
    const args = launch.parseFullRunArgs(input.argv);
    const requestDigest = json.hashJsonBytes({ prompt: args.prompt, contextDigest: input.contextDigest });
    const commandDigest = stable.hashJsonValue({ ...args, prompt: null, contextPaths: null, requestDigest });
    console.log(JSON.stringify({ requestDigest, commandDigest }));
  `;
  const value = targetJson(worktree, script, { argv, contextDigest: sha256("[]") });
  const requestDigest = isString(value.requestDigest) ? value.requestDigest : "";
  const commandDigest = isString(value.commandDigest) ? value.commandDigest : "";
  if (!/^[0-9a-f]{64}$/.test(requestDigest) || !/^[0-9a-f]{64}$/.test(commandDigest)) {
    die("the staged product returned an invalid request or command identity");
  }
  return { requestDigest, commandDigest };
}

const dir = absolute("dir", required("dir"));

if (parsed.flags.has("opening")) {
  checkOpening(dir);
} else {
  stage(dir);
}

function readJsonObject(path: string): JsonObject {
  const value = asRecord(readJsonFile(path));
  if (value === null) die(`${path} is not a JSON object`);
  return value;
}

function nestedString(value: JsonValue, ...keys: string[]): string | null {
  let current: JsonValue | undefined = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (record === null) return null;
    current = record[key];
  }
  return isString(current) ? current : null;
}

/** One recorded value as a problem line prints it: JSON, so an object never reads `[object Object]`. */
function show(value: JsonValue | undefined): string {
  return isString(value) ? value : JSON.stringify(value ?? null);
}

function checkOpening(conditionDir: string): void {
  const conditionPath = join(conditionDir, "condition.json");
  if (!existsSync(conditionPath)) die(`${conditionPath} is missing — was this condition staged here?`);
  const staged = readJsonObject(conditionPath);
  const project = isString(staged.project) ? staged.project : die("condition.json has no project");
  const runId = isString(staged.runId)
    ? staged.runId
    : die("condition.json has no runId — stage with an explicit --run");
  const controller = join(conditionDir, "campaigns", project, "controller");
  if (!existsSync(controller)) die(`no controller directory yet under campaigns/${project}`);
  const openingPath = join(controller, runId, OPENING_FILE);
  if (!existsSync(openingPath)) die(`no opening.json for staged run ${runId}`);
  const opening = readJsonObject(openingPath);
  const source = asRecord(opening.source);
  const slots = asRecord(opening.modelSlots);
  const epoch = asRecord(opening.epoch);
  const problems: string[] = [];
  const expectedSource = isString(staged.sourceCommit) ? staged.sourceCommit : "";
  const expectedSourceDigest = isString(staged.sourceDigest) ? staged.sourceDigest : "";
  if (source?.commit !== expectedSource) {
    problems.push(`source ${show(source?.commit)} ≠ staged ${expectedSource}`);
  }
  if (source?.sourceDigest !== expectedSourceDigest) {
    problems.push(`source digest ${show(source?.sourceDigest)} ≠ staged ${expectedSourceDigest}`);
  }
  if (source?.dirty !== false) problems.push(`source dirty must be false, observed ${show(source?.dirty)}`);
  if (opening.runId !== runId) problems.push(`run ${show(opening.runId)} ≠ staged ${runId}`);
  if (nestedString(opening, "project", "id") !== project) {
    problems.push(`project ${show(nestedString(opening, "project", "id"))} ≠ staged ${project}`);
  }
  const requestDigest = isString(staged.requestDigest) ? staged.requestDigest : "";
  if (nestedString(opening, "project", "requestDigest") !== requestDigest) {
    problems.push(
      `request digest ${show(nestedString(opening, "project", "requestDigest"))} ≠ staged ${requestDigest}`,
    );
  }
  const commandDigest = isString(staged.commandDigest) ? staged.commandDigest : null;
  const seenCommandDigest = nestedString(opening, "command", "digest");
  if (commandDigest === null || seenCommandDigest !== commandDigest) {
    problems.push(`command digest ${show(seenCommandDigest)} ≠ staged ${show(commandDigest)}`);
  }
  if (isString(staged.taskSetDigest)) {
    problems.push(
      "task-set identity is unobservable in opening.json; adjudicate it from recorded battery evidence",
    );
  }
  const selectedCondition = CONDITIONS.get(isString(staged.condition) ? staged.condition : "");
  if (selectedCondition === undefined) die("condition.json names an unknown condition");
  const prefix = selectedCondition.kind === "codex" ? "CODEX" : "CLAUDE";
  for (const slot of ["builder", "built", "review"]) {
    const seen = asRecord(slots?.[slot]);
    const model = selectedCondition.pins[`${prefix}_${slot.toUpperCase()}_MODEL`];
    const effort = selectedCondition.pins[`${prefix}_${slot.toUpperCase()}_REASONING_EFFORT`];
    if (seen?.kind !== selectedCondition.kind || seen.model !== model || seen.reasoningEffort !== effort) {
      problems.push(
        `${slot} slot ${JSON.stringify(seen ?? null)} ≠ ${selectedCondition.kind}/${model}/${effort}`,
      );
    }
  }
  console.log(
    `run ${runId}: source ${show(source?.commit).slice(0, 9)} epoch ${show(epoch?.key)} supersedes ${show(epoch?.supersedes)}`,
  );
  if (problems.length === 0) {
    console.log("opening matches the staged condition");
    return;
  }
  for (const problem of problems) console.error(`stage-run: ${problem}`);
  runtimeProcess.exit(1);
}

function positiveIntegerOption(name: string): string | undefined {
  const value = single.get(name);
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    die(`--${name} must be a canonical positive integer`);
  }
  return value;
}

/** The same option where the launch cannot be staged without it. */
function requiredPositiveInteger(name: string): string {
  return positiveIntegerOption(name) ?? die(`--${name} is required`);
}

function readPrompt(promptFile: string) {
  const bytes = readFileSync(promptFile);
  let prompt: string;
  try {
    prompt = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    die(
      "the prompt file is not valid UTF-8; the product receives a string, so byte identity cannot be established",
    );
  }
  if (prompt.includes("\0")) {
    die("the prompt file contains NUL; an operating-system argument cannot carry it byte-for-byte");
  }
  if (prompt.trim() === "") die("the prompt file is empty or whitespace-only");
  return { prompt, bytes };
}

function fullRunArgv(options: StageOptions, commit: string, sourceDigest: string): string[] {
  const argv = [
    "--prompt",
    options.prompt,
    "--project",
    options.project,
    "--run",
    options.runId,
    "--expected-source",
    `${commit}:${sourceDigest}`,
    "--builder-backend",
    options.condition.kind,
    "--built-backend",
    options.condition.kind,
    "--review-backend",
    options.condition.kind,
  ];
  if (options.maxIterations !== undefined) argv.push("--max-iterations", options.maxIterations);
  if (options.maxBuilderTurns !== undefined) argv.push("--max-builder-turns", options.maxBuilderTurns);
  argv.push("--provider-turn-budget", options.providerTurnBudget);
  argv.push("--expected-tasks", String(options.expectedTasks));
  if (options.iterationBudget !== undefined) argv.push("--iteration-budget", options.iterationBudget);
  return argv;
}

/** Checks the known option and dependency-path faults before creating the condition directory. */
function stageOptions(conditionDir: string): StageOptions {
  const source = required("source");
  const modulesFrom = absolute("modules-from", required("modules-from"));
  const conditionName = required("condition");
  const condition = CONDITIONS.get(conditionName);
  if (condition === undefined) die(`--condition must be one of ${[...CONDITIONS.keys()].join(", ")}`);
  const project = required("project");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) die("--project must be a lowercase slug");
  const runId = required("run");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) die("--run must be one safe path segment");
  const promptFile = absolute("prompt-file", required("prompt-file"));
  const { prompt, bytes: promptBytes } = readPrompt(promptFile);
  const expectedTasksText = requiredPositiveInteger("expected-tasks");
  const expectedTasks = Number(expectedTasksText);
  const taskSetDigest = single.get("task-set-digest") ?? "none";
  if (taskSetDigest !== "none" && !/^[0-9a-f]{64}$/.test(taskSetDigest)) {
    die("--task-set-digest must be `none` or a lowercase SHA-256");
  }
  const maxIterations = positiveIntegerOption("max-iterations");
  const maxBuilderTurns = positiveIntegerOption("max-builder-turns");
  const providerTurnBudget = requiredPositiveInteger("provider-turn-budget");
  const iterationBudget = single.get("iteration-budget");
  if (iterationBudget !== undefined && iterationBudget !== "none" && !/^[1-9]\d*$/.test(iterationBudget)) {
    die("--iteration-budget must be `none` or a canonical positive integer");
  }
  const sessionCapMs = positiveIntegerOption("session-cap-ms");
  const envFrom = absolute("env-from", single.get("env-from") ?? join(modulesFrom, ".env"));
  if (!existsSync(envFrom)) {
    die(`${envFrom} does not exist — a condition without .env dies on its first provider call`);
  }
  if (existsSync(conditionDir)) {
    die(`${conditionDir} already exists — every condition gets its own fresh copy`);
  }
  const modules = join(modulesFrom, "node_modules");
  if (!existsSync(modules)) die(`${modules} is missing`);
  if (lstatSync(modules).isSymbolicLink()) {
    die(`${modules} is a symlink — it would resolve @ana/* into another tree's vendor`);
  }
  if (!existsSync(join(modules, "@ana"))) die(`${modules} has no @ana scope — not a real install`);
  const seedCampaign = single.get("seed-campaign");
  const slug = single.get("slug");
  if ((seedCampaign === undefined) !== (slug === undefined)) die("--seed-campaign and --slug go together");
  if (iterationBudget === "none" && seedCampaign !== undefined) {
    die("--iteration-budget none clears the campaign budget and is valid only for a fresh condition");
  }
  return {
    source,
    modulesFrom,
    modules,
    conditionName,
    condition,
    project,
    runId,
    prompt,
    promptBytes,
    promptDigest: sha256(prompt),
    expectedTasks,
    taskSetDigest: taskSetDigest === "none" ? null : taskSetDigest,
    maxIterations,
    maxBuilderTurns,
    providerTurnBudget,
    iterationBudget,
    sessionCapMs,
    envFrom,
    seedCampaign,
    slug,
  };
}

function stage(conditionDir: string): void {
  const {
    source,
    modulesFrom,
    modules,
    conditionName,
    condition,
    project,
    runId,
    prompt,
    promptBytes,
    promptDigest,
    expectedTasks,
    taskSetDigest,
    maxIterations,
    maxBuilderTurns,
    providerTurnBudget,
    iterationBudget,
    sessionCapMs,
    envFrom,
    seedCampaign,
    slug,
  } = stageOptions(conditionDir);

  const resolved = sh(["git", "rev-parse", "--verify", `${source}^{commit}`], REPO_ROOT);
  if (!resolved.ok) die(`cannot resolve ${source} in ${REPO_ROOT}: ${resolved.err}`);
  const commit = resolved.out;
  const dependencies = dependencyIdentity(modulesFrom, commit);
  const added = sh(["git", "worktree", "add", "--detach", conditionDir, commit], REPO_ROOT);
  if (!added.ok) die(`git worktree add failed: ${added.err}`);
  const prepared = sh(["bash", join(REPO_ROOT, WORKTREE_SCRIPT), "setup", conditionDir], modulesFrom);
  if (!prepared.ok) die(`worktree dependency setup failed: ${prepared.err || prepared.out}`);
  symlinkSync(envFrom, join(conditionDir, ".env"));
  mkdirSync(join(conditionDir, "domains"), { recursive: true });
  mkdirSync(join(conditionDir, "campaigns"), { recursive: true });
  mkdirSync(join(conditionDir, OPERATOR_BACKENDS_DIR), { recursive: true });
  const backends = {
    builder: { kind: condition.kind },
    built: { kind: condition.kind },
    review: { kind: condition.kind },
  };
  writeJsonFile(join(conditionDir, OPERATOR_BACKENDS_DIR, `${project}.json`), backends);

  let seeded: string | null = null;
  if (seedCampaign !== undefined && slug !== undefined) {
    const runRoot = absolute("seed-campaign", seedCampaign);
    try {
      seedCampaignInto(runRoot, slug, conditionDir, {
        allowAbsoluteRefs: parsed.flags.has("allow-absolute-refs"),
        relocate: parsed.flags.has("relocate"),
      });
    } catch (error) {
      if (error instanceof SeedRefusal) die(error.message);
      throw error;
    }
    seeded = campaignDir(runRoot, slug);
  }

  const check = sh(["bun", "tools/runtime/check.ts"], conditionDir);
  if (!check.ok) die(`runtime check failed in the staged tree: ${check.err || check.out}`);

  const targetSource = targetSourceIdentity(conditionDir);
  if (targetSource.commit !== commit || targetSource.dirty !== false) {
    die(
      `the staged product source is not the requested clean revision (${targetSource.commit}, dirty=${String(targetSource.dirty)})`,
    );
  }
  const options = {
    source,
    modulesFrom,
    modules,
    conditionName,
    condition,
    project,
    runId,
    prompt,
    promptBytes,
    promptDigest,
    expectedTasks,
    taskSetDigest,
    maxIterations,
    maxBuilderTurns,
    iterationBudget,
    providerTurnBudget,
    sessionCapMs,
    envFrom,
    seedCampaign,
    slug,
  } satisfies StageOptions;
  const argv = fullRunArgv(options, commit, targetSource.sourceDigest);
  const product = targetProductIdentity(conditionDir, argv);

  const scratch = join(conditionDir, ".scratch", "condition");
  mkdirSync(scratch, { recursive: true });
  const promptPath = join(scratch, "prompt.txt");
  writeFileSync(promptPath, promptBytes);
  const flags: string[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? "";
    const value = argv[index + 1] ?? "";
    if (flag !== "--prompt") flags.push(`${flag} ${shellQuote(value)}`);
  }
  const pins = { ...condition.pins, ...keyIfDefined("HARNESS_BUILDER_SESSION_CAP_MS", sessionCapMs) };
  const launch = [
    "#!/bin/zsh",
    `# prepared by stage-run.mts: ${conditionName} condition on ${commit.slice(0, 9)}; every pin explicit, none inherited.`,
    `cd ${shellQuote(conditionDir)} || exit 2`,
    ...Object.entries(pins).map(([name, value]) => `export ${name}=${shellQuote(value)}`),
    `IFS= read -r -d '' __ana_prompt < ${shellQuote(promptPath)}`,
    `exec bun src/run/full-run.ts ${flags.join(" ")} --prompt "$__ana_prompt"`,
    "",
  ].join("\n");
  const launchPath = join(conditionDir, "launch.sh");
  writeFileSync(launchPath, launch, { mode: 0o755 });
  const conditionRecord = {
    schema: "simulation-condition/v1",
    stagedAt: new Date().toISOString(),
    source: source,
    sourceCommit: commit,
    sourceDigest: targetSource.sourceDigest,
    condition: conditionName,
    kind: condition.kind,
    pins,
    project,
    runId,
    promptDigest,
    requestDigest: product.requestDigest,
    expectedTasks,
    taskSetDigest,
    providerTurnBudget: Number(providerTurnBudget),
    commandDigest: product.commandDigest,
    promptFile: promptPath,
    flags,
    modulesFrom,
    dependencyDigest: dependencies,
    envFrom,
    seeded,
    launch: launchPath,
    log: join(scratch, "fullrun.log"),
    pid: null,
  };
  writeJsonFile(join(conditionDir, "condition.json"), conditionRecord);
  console.log(
    `staged ${conditionDir} at ${commit.slice(0, 9)} (${conditionName}); prepared launch: ${launchPath}`,
  );
}

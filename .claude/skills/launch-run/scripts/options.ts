/**
 * What a launch request means, before anything is spent: the presets and model conditions, the
 * parsed options, one plan per run, the argument lists handed to the controller and to the probe,
 * and the opening check that says the controller started what was planned.
 *
 * `tools/runs` reads `CONDITIONS`, `PRESETS`, `SLOTS` and `DEFAULT_DISK_MIN_GIB` from here, and every
 * launched tree runs its own copy of this file through `probe.ts`, so the probe's argument list
 * keeps the spelling every version of this file accepts.
 */
import { CliArgumentError, type ExitWith, parseCliArgs } from "#skills/main/cli.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";

export const PRESETS = {
  truss:
    "Design lightweight 3D steel trusses around irregular supports and forbidden volumes, choosing joint positions, connectivity and catalogue sections within strict mass limits.\nMeet strength, buckling and deflection requirements under self-weight, reversing wind and asymmetric live loads, including geometric nonlinearity and specified single-member-loss scenarios.",
  buffer:
    "Design aqueous buffer formulations from a published reagent catalogue, choosing components and concentrations within strict ionic-strength, osmolality and cost limits.\nMeet pH, buffer-capacity and precipitation-free requirements across temperature shifts, tenfold dilution and CO2 uptake, including activity corrections and specified single-reagent-substitution scenarios.",
};
const PRESET_PROMPTS: ReadonlyMap<string, string> = new Map(Object.entries(PRESETS));
/**
 * What a run launched from `--prompt` is called, in its id and receipt. `--prompt` alone asks for one;
 * naming it again asks for replicas. Launches before 2026-09-30 called it `custom`, which still parses.
 */
export const STANDARD = "standard";
export const SLOTS = ["builder", "built", "review"] as const;
/**
 * The model one `--model` name selects, and its effort on each slot in `SLOTS` order. A variant of a
 * model's standard row is named for its efforts, one letter per slot (l, m, h, x for low to xhigh):
 * `opushmm` is Opus 5.5 with only the Builder at high, and the Builder at xhigh would be `opusxmm`.
 */
export const CONDITIONS = {
  sol: { kind: "codex", model: "gpt-6.1-sol", efforts: ["high", "high", "medium"] },
  luna: { kind: "codex", model: "gpt-5.6-luna", efforts: ["max", "max", "max"] },
  astra: { kind: "codex", model: "gpt-6-astra", efforts: ["medium", "low", "low"] },
  opus: { kind: "claude", model: "claude-opus-5-5", efforts: ["medium", "medium", "medium"] },
  fable: { kind: "claude", model: "claude-fable-5-1", efforts: ["medium", "medium", "medium"] },
  opushmm: { kind: "claude", model: "claude-opus-5-5", efforts: ["high", "medium", "medium"] },
} as const;
export const DEFAULT_DISK_MIN_GIB = 20;
/** The operator's launch pace, whose yield figures are AGENTS.md "Open gaps", blocker 4: no batch
 *  starts above this one-minute load or past this many live controller runs, unless `--over-capacity`. */
export const MAX_LAUNCH_LOAD = 25;
export const MAX_LIVE_RUNS = 6;
/** Where a launch keeps its receipts, logs and frozen environment, relative to the run tree. */
export const SCRATCH = ".scratch/quick-run";
/**
 * Whether the launch runs `bun run gate` first. `auto` skips it when the pre-push hook recorded a
 * whole-gate pass of the exact commit; `run` always gates and `skip` never does.
 */
export const GATES = ["auto", "run", "skip"] as const;
export type Condition = keyof typeof CONDITIONS;
export type Backend = (typeof CONDITIONS)[Condition]["kind"];
export type Gate = (typeof GATES)[number];
export interface SourceIdentity {
  commit: string;
  sourceDigest: string;
  dirty: boolean;
}
export interface RequestIdentity {
  requestDigest: string;
  commandDigest: string;
}
export interface RunPlan {
  runId: string;
  dir: string;
  preset: string;
  condition: Condition;
  prompt: string;
  branch: string;
  label: string;
  log: string;
  /** An existing project this run continues; absent for a fresh one. */
  project?: string;
}
export interface OpeningPlan extends RunPlan, RequestIdentity {
  source: SourceIdentity;
  budget: string;
  service: string;
}

const PROMPT_REFUSAL = "--prompt must be one or two non-empty lines without CR or NUL";
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
/** The options that name one run, each id's safe shape, and the refusal when a batch would share it. */
const ONE_RUN_IDS = [
  [
    "run",
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,85}$/,
    "--run requires one preset, one condition and a safe id of at most 86 characters",
  ],
  [
    "project",
    /^[a-z0-9][a-z0-9-]*$/,
    "--project requires one preset, one condition and an existing project id",
  ],
] as const;

/** The options the controller receives as given, and the probe with it, so both digest one command. */
const CARRIED = ["max-iterations", "stop-after-ms", "project"] as const;
/** The options that stay absent unless the operator passes them. */
const OPTIONAL_VALUES = [
  ...CARRIED,
  "kill-after-ms",
  "run",
  "prompt",
  "env-file",
  "codex-home",
  "output-dir",
  "over-capacity",
] as const;

/** The launcher's arguments, parsed by `.claude/skills/main/cli.ts`, so a misspelled flag refuses
 *  and a value may be passed once. `--condition` is the legacy alias of `--model`. */
export const LAUNCH_ARGUMENTS = {
  values: ["model", "condition", "source", "budget", "tasks", "gate", ...OPTIONAL_VALUES],
  flags: ["help", "list", "dry-run"],
  positionals: [0, Number.MAX_SAFE_INTEGER],
} as const;

export type LaunchOptions = Partial<Record<(typeof OPTIONAL_VALUES)[number], string>> & {
  condition: string;
  source: string;
  budget: string;
  tasks: string;
  gate: Gate;
  help: boolean;
  list: boolean;
  "dry-run": boolean;
  names: readonly string[];
  conditions: Condition[];
};

const PRESET_NAMES = [...PRESET_PROMPTS.keys(), STANDARD].join("|");
export const HELP = `Usage: bun .claude/skills/launch-run/scripts/launch.ts [${PRESET_NAMES}]... [options]
  --model sol,luna,astra,opus,fable,opushmm Model presets; default opus (legacy alias: --condition)
  --source <ref|sha|pr:number>     Default current origin/main
  --budget N --tasks N            Defaults 1320 provider turns and 25 tasks per run
  --gate auto|run|skip            Default auto: skip bun run gate when the pre-push hook recorded a
                                  whole-gate pass of the resolved commit, run it otherwise
  --max-iterations N              Optional controller round cap
  --stop-after-ms N               Optional time boundary: the controller stops after the first completed round past N ms
  --kill-after-ms N               Operator SIGTERM at N ms after launch begins; 30 s grace then service removal
  --run ID                       One preset and condition only
  --project ID                   Continue this existing project; one preset and condition only
  --prompt TEXT                  Verbatim prompt of one or two lines; its runs are named standard
  --env-file /path                Claude token; default main checkout/.env
  --codex-home /path              Codex auth; default current CODEX_HOME or ~/.codex
  --output-dir /path              Parent of fresh worktrees; default beside main checkout
  --over-capacity REASON          Launch past the one-minute load ${MAX_LAUNCH_LOAD} or ${MAX_LIVE_RUNS} live runs; each receipt keeps the reason
  --dry-run                      Plan only: no setup, secrets or launch
  --list                         Exact preset prompts
  --help                         This help
Repeat a preset for independent replicas, for example truss truss --model sol,astra.
One Bun command prepares and probes the batch, gates its source at most once, then launches it.`;

function conditionName(value: string, refuse: ExitWith): Condition {
  if (!Object.hasOwn(CONDITIONS, value)) {
    refuse(`unknown condition ${value}; choose ${Object.keys(CONDITIONS).join(", ")}`);
  }
  // SAFETY: `Object.hasOwn` has just proved the string is one of the keys `Condition` is built from.
  return value as Condition;
}

/** What the parser cannot see for itself: the option values that must be numbers, paths, a prompt or
 *  an id naming exactly one run. */
function refuseValues(options: LaunchOptions, refuse: ExitWith): void {
  for (const key of ["budget", "tasks", "max-iterations", "stop-after-ms", "kill-after-ms"] as const) {
    const value = options[key];
    if (value !== undefined && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      refuse(`--${key} must be a positive integer`);
    }
  }
  for (const key of ["env-file", "codex-home", "output-dir"] as const) {
    const value = options[key];
    if (value !== undefined && !isAbsolute(value)) refuse(`--${key} must be absolute`);
  }
  if (options["over-capacity"]?.trim() === "") refuse("--over-capacity needs the reason, in words");
  const lines = options.prompt?.split("\n") ?? [];
  if (/[\r\0]/.test(options.prompt ?? "") || lines.length > 2 || lines.some((line) => !line.trim())) {
    refuse(PROMPT_REFUSAL);
  }
  const oneRun = options.names.length === 1 && options.conditions.length === 1;
  for (const [key, pattern, refusal] of ONE_RUN_IDS) {
    const value = options[key];
    if (value !== undefined && (!oneRun || !pattern.test(value))) refuse(refusal);
  }
}

/**
 * The launch options a parse admits, refusing through `refuse` what the parser cannot see: an
 * undeclared condition, preset or gate, `--model` beside `--condition`, and every value
 * `refuseValues` checks.
 */
export function launchOptions(parsed: ReturnType<typeof parseCliArgs>, refuse: ExitWith): LaunchOptions {
  const { single, flags, positionals } = parsed;
  if (single.has("model") && single.has("condition")) refuse("--model and --condition are one option");
  const condition = single.get("model") ?? single.get("condition") ?? "opus";
  const names = positionals.map((name) => (name === "custom" ? STANDARD : name));
  if (names.length === 0 && single.has("prompt")) names.push(STANDARD);
  const gate = single.get("gate") ?? "auto";
  const options: LaunchOptions = {
    ...Object.fromEntries(
      OPTIONAL_VALUES.flatMap((key) => (single.has(key) ? [[key, single.get(key)]] : [])),
    ),
    condition,
    source: single.get("source") ?? "origin/main",
    budget: single.get("budget") ?? "1320",
    tasks: single.get("tasks") ?? "25",
    gate: GATES.find((name) => name === gate) ?? refuse(`--gate must be one of ${GATES.join(", ")}`),
    help: flags.has("help"),
    list: flags.has("list"),
    "dry-run": flags.has("dry-run"),
    names,
    conditions: condition.split(",").map((name) => conditionName(name, refuse)),
  };
  if (options.help || options.list) return options;
  if (names.length === 0) refuse(`give --prompt or name a preset: ${PRESET_NAMES.replaceAll("|", ", ")}`);
  for (const name of names) {
    if (!PRESET_PROMPTS.has(name) && name !== STANDARD) refuse(`unknown preset ${name}; use --list`);
  }
  if (new Set(options.conditions).size !== options.conditions.length) refuse("name each condition once");
  if (names.includes(STANDARD) !== (options.prompt !== undefined)) {
    refuse(`${STANDARD} runs the --prompt text, so each needs the other`);
  }
  refuseValues(options, refuse);
  return options;
}

const throwArgument: ExitWith = (message) => {
  throw new CliArgumentError(message);
};

/** `launchOptions` over an argument list, throwing `CliArgumentError` where the CLI exits 2. */
export function parseOptions(argv: readonly string[]): LaunchOptions {
  return launchOptions(parseCliArgs(argv, LAUNCH_ARGUMENTS), throwArgument);
}

/** One plan per preset and condition. A preset named twice is a replica, and each gets an `-rN`. */
export function planRuns(options: LaunchOptions, parent: string, suffix: string): RunPlan[] {
  const { names } = options;
  return names.flatMap((name, index) =>
    options.conditions.map((condition) => {
      const replica =
        names.indexOf(name) === names.lastIndexOf(name)
          ? ""
          : `-r${names.slice(0, index + 1).filter((item) => item === name).length}`;
      const runId = options.run ?? `${name}-${condition}${replica}-${suffix}`;
      const dir = join(parent, `ana-run-${runId}`);
      const prompt = name === STANDARD ? options.prompt : PRESET_PROMPTS.get(name);
      if (prompt === undefined) throw new Error(`missing prompt for ${name}`);
      return {
        runId,
        dir,
        preset: name,
        condition,
        prompt,
        branch: `codex/run-${runId}`,
        label: `ana.fullrun.${runId}`,
        log: join(dir, SCRATCH, "fullrun.log"),
        ...keyIfDefined("project", options.project),
      };
    }),
  );
}

/** Each slot's effort under one condition, keyed by slot rather than by position in `SLOTS`. */
function slotEfforts(name: Condition): Record<(typeof SLOTS)[number], string> {
  const [builder, built, review] = CONDITIONS[name].efforts;
  return { builder, built, review };
}

export function slotEnvironment(name: Condition): Record<string, string> {
  const { kind, model } = CONDITIONS[name];
  const prefix = kind.toUpperCase();
  const efforts = slotEfforts(name);
  return Object.fromEntries(
    SLOTS.flatMap((slot) => [
      [`${prefix}_${slot.toUpperCase()}_MODEL`, model],
      [`${prefix}_${slot.toUpperCase()}_REASONING_EFFORT`, efforts[slot]],
    ]),
  );
}

function carried(options: LaunchOptions): string[] {
  return CARRIED.flatMap((key) => {
    const value = options[key];
    return value === undefined ? [] : [`--${key}`, value];
  });
}

export function fullrunArgs(plan: RunPlan, options: LaunchOptions, source: SourceIdentity): string[] {
  return [
    "--run",
    plan.runId,
    "--prompt",
    plan.prompt,
    "--provider-turn-budget",
    options.budget,
    "--expected-tasks",
    options.tasks,
    "--expected-source",
    `${source.commit}:${source.sourceDigest}`,
    ...SLOTS.flatMap((slot) => [`--${slot}-backend`, CONDITIONS[plan.condition].kind]),
    ...carried(options),
  ];
}

/**
 * The arguments `launch.ts` hands the launched tree's `probe.ts`. That probe is the launched
 * revision's own, however old, so this list keeps the spelling every version parses: `custom` with
 * the prompt verbatim, the legacy `--condition`, and nothing a later launcher added.
 */
export function probeArgs(plan: RunPlan, options: LaunchOptions): string[] {
  return [
    "custom",
    "--prompt",
    plan.prompt,
    "--run",
    plan.runId,
    "--condition",
    // A variant probes as its model's standard row: the probe reads each slot's effort from the
    // frozen env, and an older tree's table has no variants.
    Object.entries(CONDITIONS).find(
      ([base, row]) => plan.condition.startsWith(base) && row.model === CONDITIONS[plan.condition].model,
    )?.[0] ?? plan.condition,
    "--budget",
    options.budget,
    "--tasks",
    options.tasks,
    ...carried(options),
  ];
}

/** A recorded JSON row read as a dictionary, with an absent or wrongly shaped value reading as
 *  empty. The callers report what a row fails to say, so a missing row and an empty one are one
 *  finding. */
export function record(value: unknown): JsonObject {
  return asRecord(value) ?? {};
}
const hex = (value: JsonValue | undefined, pattern: RegExp): value is string =>
  isString(value) && pattern.test(value);

export function sourceIdentity(value: unknown): SourceIdentity {
  const { commit, sourceDigest, dirty } = record(value);
  if (!hex(commit, COMMIT) || !hex(sourceDigest, DIGEST) || !isBoolean(dirty)) {
    throw new Error("target returned an incomplete source identity");
  }
  return { commit, sourceDigest, dirty };
}
export function requestIdentity(value: unknown): RequestIdentity {
  const { requestDigest, commandDigest } = record(value);
  if (!hex(requestDigest, DIGEST) || !hex(commandDigest, DIGEST)) {
    throw new Error("target returned incomplete request and command identities");
  }
  return { requestDigest, commandDigest };
}

/** Every way an opening fails to record the planned run, as short names; none when it matches. */
export function openingProblems(value: unknown, plan: OpeningPlan): string[] {
  const opening = record(value),
    project = record(opening.project),
    source = record(opening.source),
    slots = record(opening.modelSlots);
  const problems: string[] = [];
  if (opening.runId !== plan.runId) problems.push("run id");
  if (plan.project !== undefined) {
    if (project.origin !== "operator" || project.id !== plan.project) problems.push("continued project");
  } else if (
    project.origin !== "created" ||
    !isString(project.id) ||
    !/^[a-z0-9][a-z0-9-]*$/.test(project.id)
  ) {
    problems.push("fresh project");
  }
  for (const key of ["commit", "sourceDigest"] as const) {
    if (source[key] !== plan.source[key]) problems.push(`source ${key}`);
  }
  if (source.dirty !== false) problems.push("dirty source");
  if (project.requestDigest !== plan.requestDigest) problems.push("prompt/request digest");
  if (record(opening.command).digest !== plan.commandDigest) problems.push("command digest");
  if (record(opening.providerResourceBudget).cap !== Number(plan.budget)) problems.push("provider budget");
  const { kind, model } = CONDITIONS[plan.condition];
  const efforts = slotEfforts(plan.condition);
  for (const slot of SLOTS) {
    const seen = record(slots[slot]);
    if (seen.kind !== kind || seen.model !== model || seen.reasoningEffort !== efforts[slot]) {
      problems.push(`${slot} model slot`);
    }
  }
  if (record(slots.review).enabled !== true) problems.push("review enabled");
  return problems;
}

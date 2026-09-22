import { isAbsolute, join } from "node:path";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "node:util";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";

export const PRESETS = {
  truss:
    "Design lightweight 3D steel trusses around irregular supports and forbidden volumes, choosing joint positions, connectivity and catalogue sections within strict mass limits.\nMeet strength, buckling and deflection requirements under self-weight, reversing wind and asymmetric live loads, including geometric nonlinearity and specified single-member-loss scenarios.",
};
const PRESET_NAMES = Object.keys(PRESETS).join("|");
export const SLOTS = ["builder", "built", "review"] as const;
export const CONDITIONS = {
  sol: { kind: "codex", model: "gpt-5.6-sol", efforts: ["high", "high", "medium"] },
  luna: { kind: "codex", model: "gpt-5.6-luna", efforts: ["max", "max", "max"] },
  astra: { kind: "codex", model: "gpt-6-astra", efforts: ["medium", "low", "low"] },
  opus: { kind: "claude", model: "claude-opus-5", efforts: ["medium", "medium", "medium"] },
  fable: { kind: "claude", model: "claude-fable-5-1", efforts: ["medium", "medium", "medium"] },
} as const;
export const DEFAULT_DISK_MIN_GIB = 20;
export type Condition = keyof typeof CONDITIONS;
export type Backend = (typeof CONDITIONS)[Condition]["kind"];
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
  runtimeTemp?: string;
  /** An existing project this run continues; absent for a fresh one. */
  project?: string;
}
export interface OpeningPlan extends RunPlan, RequestIdentity {
  source: SourceIdentity;
  budget: string;
  service: string;
}

/** What `parseArgs` hands back for `ARGUMENTS`: every declared option, each a string or a flag,
 *  and absent when the operator did not pass it. */
type OptionValues = Partial<Record<keyof typeof ARGUMENTS, string | boolean>>;

const ARGUMENTS = {
  model: { type: "string" },
  condition: { type: "string", default: "opus" },
  source: { type: "string", default: "origin/main" },
  budget: { type: "string", default: "1320" },
  tasks: { type: "string", default: "25" },
  "max-iterations": { type: "string" },
  "stop-after-ms": { type: "string" },
  "kill-after-ms": { type: "string" },
  run: { type: "string" },
  prompt: { type: "string" },
  project: { type: "string" },
  "env-file": { type: "string" },
  "codex-home": { type: "string" },
  "output-dir": { type: "string" },
  help: { type: "boolean" },
  list: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

export const HELP = `Usage: bun .claude/skills/launch-run/scripts/launch.ts <${PRESET_NAMES}|custom>... [options]
  --model sol,luna,astra,opus,fable Standard model presets; default opus (legacy alias: --condition)
  --source <ref|sha|pr:number>     Default current origin/main
  --budget N --tasks N            Defaults 1320 provider turns and 25 tasks per run
  --max-iterations N              Optional controller round cap
  --stop-after-ms N               Optional time boundary: the controller stops after the first completed round past N ms
  --kill-after-ms N               Operator SIGTERM at N ms after launch begins; 30 s grace then service removal
  --run ID                       One preset and condition only
  --project ID                   Continue this existing project; one preset and condition only
  --prompt TEXT                  Verbatim prompt of one or two lines, with custom only
  --env-file /path                Claude token; default main checkout/.env
  --codex-home /path              Codex auth; default current CODEX_HOME or ~/.codex
  --output-dir /path              Parent of fresh worktrees; default beside main checkout
  --dry-run                      Plan only: no setup, secrets or launch
  --list                         Exact preset prompts
  --help                         This help
Repeat a preset for independent replicas, for example truss truss --model sol,astra.
One Bun command prepares and probes the batch, gates its source once, then launches it.`;

export type LaunchOptions = ReturnType<typeof parseOptions>;

function conditionName(value: string): Condition {
  if (!Object.hasOwn(CONDITIONS, value)) {
    throw new Error(`unknown condition ${value}; choose ${Object.keys(CONDITIONS).join(", ")}`);
  }
  // SAFETY: `Object.hasOwn` has just proved the string is one of the keys `Condition` is built from.
  return value as Condition;
}

function validateOptionValues(values: OptionValues): void {
  for (const key of ["budget", "tasks", "max-iterations", "stop-after-ms", "kill-after-ms"] as const) {
    const value = values[key];
    if (
      value !== undefined &&
      (!isString(value) || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    ) {
      throw new Error(`--${key} must be a positive integer`);
    }
  }
  for (const key of ["env-file", "codex-home", "output-dir"] as const) {
    const value = values[key];
    if (value !== undefined && (!isString(value) || !isAbsolute(value))) {
      throw new Error(`--${key} must be absolute`);
    }
  }
}

export function parseOptions(argv: string[]) {
  const {
    values,
    positionals: names,
    tokens,
  } = parseArgs({ args: argv, options: ARGUMENTS, allowPositionals: true, tokens: true });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    const name = token.name === "model" ? "condition" : token.name;
    if (seen.has(name)) throw new Error(`duplicate --${token.name}`);
    seen.add(name);
  }
  values.condition = values.model ?? values.condition;
  const conditions = values.condition.split(",").map(conditionName);
  const options = { ...values, names, conditions };
  if (values.help === true || values.list === true) return options;
  if (names.length === 0) throw new Error(`name a preset: ${PRESET_NAMES.replaceAll("|", ", ")} or custom`);
  for (const name of names) {
    if (!Object.hasOwn(PRESETS, name) && name !== "custom") {
      throw new Error(`unknown preset ${name}; use --list`);
    }
  }
  if (new Set(conditions).size !== conditions.length) throw new Error("name each condition once");
  if (names.includes("custom") !== (values.prompt !== undefined)) {
    throw new Error("custom and --prompt must be supplied together");
  }
  if (
    values.prompt !== undefined &&
    (/[\r\0]/.test(values.prompt) ||
      values.prompt.split("\n").length > 2 ||
      values.prompt.split("\n").some((line) => !line.trim()))
  ) {
    throw new Error("--prompt must be one or two non-empty lines without CR or NUL");
  }
  validateOptionValues(values);
  if (
    values.run !== undefined &&
    (names.length !== 1 || conditions.length !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,85}$/.test(values.run))
  ) {
    throw new Error("--run requires one preset, one condition and a safe id of at most 86 characters");
  }
  if (
    values.project !== undefined &&
    (names.length !== 1 || conditions.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(values.project))
  ) {
    throw new Error("--project requires one preset, one condition and an existing project id");
  }
  return options;
}
export function planRuns(options: LaunchOptions, parent: string, suffix: string): RunPlan[] {
  return options.names.flatMap((name, index) =>
    options.conditions.map((condition) => {
      const replica =
        options.names.indexOf(name) === options.names.lastIndexOf(name)
          ? ""
          : `-r${options.names.slice(0, index + 1).filter((item) => item === name).length}`;
      const runId = options.run ?? `${name}-${condition}${replica}-${suffix}`;
      const dir = join(parent, `ana-run-${runId}`);
      const prompt =
        name === "custom" ? options.prompt : Object.entries(PRESETS).find(([preset]) => preset === name)?.[1];
      if (prompt === undefined) throw new Error(`missing prompt for ${name}`);
      return {
        runId,
        dir,
        preset: name,
        condition,
        prompt,
        branch: `codex/run-${runId}`,
        label: `ana.fullrun.${runId}`,
        log: join(dir, ".scratch/quick-run/fullrun.log"),
        ...keyIfDefined("project", options.project),
      };
    }),
  );
}

export function slotEnvironment(name: Condition): Record<string, string> {
  const condition = CONDITIONS[name];
  const prefix = condition.kind.toUpperCase();
  return Object.fromEntries(
    SLOTS.flatMap((slot, i) => [
      [`${prefix}_${slot.toUpperCase()}_MODEL`, condition.model],
      [`${prefix}_${slot.toUpperCase()}_REASONING_EFFORT`, condition.efforts[i]!],
    ]),
  );
}

export function fullrunArgs(plan: RunPlan, options: LaunchOptions, source: SourceIdentity): string[] {
  const args = [
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
  ];
  for (const key of ["max-iterations", "stop-after-ms", "project"] as const) {
    if (options[key] !== undefined) args.push(`--${key}`, options[key]);
  }
  return args;
}

/** A recorded JSON row read as a dictionary, with an absent or wrongly shaped value reading as
 *  empty. The callers report what a row fails to say, so a missing row and an empty one are one
 *  finding. */
export function record(value: unknown): JsonObject {
  return asRecord(value) ?? {};
}
export function sourceIdentity(value: unknown): SourceIdentity {
  const row = record(value);
  if (
    !isString(row.commit) ||
    !/^[0-9a-f]{40}$/.test(row.commit) ||
    !isString(row.sourceDigest) ||
    !/^[0-9a-f]{64}$/.test(row.sourceDigest) ||
    !isBoolean(row.dirty)
  ) {
    throw new Error("target returned an incomplete source identity");
  }
  return { commit: row.commit, sourceDigest: row.sourceDigest, dirty: row.dirty };
}
export function requestIdentity(value: unknown): RequestIdentity {
  const row = record(value);
  if (
    !isString(row.requestDigest) ||
    !/^[0-9a-f]{64}$/.test(row.requestDigest) ||
    !isString(row.commandDigest) ||
    !/^[0-9a-f]{64}$/.test(row.commandDigest)
  ) {
    throw new Error("target returned incomplete request and command identities");
  }
  return { requestDigest: row.requestDigest, commandDigest: row.commandDigest };
}

export function openingProblems(value: unknown, plan: OpeningPlan): string[] {
  const opening = record(value),
    project = record(opening.project),
    source = record(opening.source);
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
  const condition = CONDITIONS[plan.condition],
    slots = record(opening.modelSlots);
  for (const [i, slot] of SLOTS.entries()) {
    const seen = record(slots[slot]);
    if (
      seen.kind !== condition.kind ||
      seen.model !== condition.model ||
      seen.reasoningEffort !== condition.efforts[i]
    ) {
      problems.push(`${slot} model slot`);
    }
  }
  if (record(slots.review).enabled !== true) problems.push("review enabled");
  return problems;
}

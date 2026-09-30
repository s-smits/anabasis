/**
 * The parts of Harbor's task configuration that `harbor task init` writes: `TaskConfig` and the
 * models it holds, `model_dump_toml`, and the package-name check (https://github.com/harbor-framework/harbor
 * at 7b022f7, `src/harbor/models/task/config.py` and `src/harbor/constants.py`), ported to TypeScript
 * with their names, defaults, field order, descriptions and messages.
 *
 * Rewritten because TypeScript has no pydantic: a model is a function from the fields given to its
 * whole `model_dump(mode="json")` record, fields inherited first, so `_without_none` and
 * `model_dump_toml` read what Harbor's read. Left out, since a default record never reaches them:
 * every validator and migration except the package name's, network policies beyond their defaults,
 * and the models only a non-default field holds (healthcheck, TPU, MCP server, artifact, collect
 * hook, step), so such a field takes its default alone. `$` in `ORG_NAME_PATTERN` does not also
 * match before a final newline, as Python's does.
 */
import { dumps, type TomlTable, type TomlValue } from "./toml-encoder.ts";

// src/harbor/constants.py
const ORG_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const known_sections = new Set(["task", "steps", "metadata", "verifier", "agent", "environment", "solution"]);

/** Author information for a package or dataset. */
type Author = {
  /** Author name */
  name: string;
  /** Author email address */
  email: string | null;
};

/** Package metadata for the [task] section of task.toml.
 *
 *  This section identifies the package in the registry with a unique name. */
export type PackageInfo = {
  /** Package name in org/name format (e.g., 'harbor/hello-world') */
  name: string;
  /** Task package version. Usually semantic, but any non-empty string is accepted. */
  version: string | null;
  /** Human-readable description of the task */
  description: string;
  /** List of package authors */
  authors: Author[];
  /** Keywords for search and categorization */
  keywords: string[];
};

type SolutionConfig = { env: Record<string, string> };

/** Network policy fields for [agent] and [verifier] phase overrides. */
type PhaseNetworkPolicyConfig = {
  /** Network access policy. [agent] and [verifier] use this only as an explicit phase override when set. */
  network_mode: null;
  /** Hostnames, IP address literals/CIDR ranges, or leading wildcard patterns reachable when network_mode='allowlist'. */
  allowed_hosts: null;
};

export type AgentConfig = PhaseNetworkPolicyConfig & {
  timeout_sec: number | null;
  /** Username or UID to run the agent as. None uses the environment's default USER (e.g., root). */
  user: string | bigint | null;
};

/** Network policy fields for environment baselines. */
type BaselineNetworkPolicyConfig = {
  /** Network access policy for this environment. Defaults to public. */
  network_mode: "public";
  /** Hostnames, IP address literals/CIDR ranges, or leading wildcard patterns reachable when network_mode='allowlist'. */
  allowed_hosts: null;
};

type EnvironmentConfig = BaselineNetworkPolicyConfig & {
  build_timeout_sec: number;
  /** A pre-built Docker image to use for the environment. When set, environment/Dockerfile is optional for supported environment types. */
  docker_image: string | null;
  /** Target operating system for the task's container. Defaults to 'linux' for back-compat. */
  os: "linux" | "windows";
  cpus: bigint | null;
  memory_mb: bigint | null;
  storage_mb: bigint | null;
  gpus: bigint | null;
  /** List of acceptable GPU types (e.g., ['H100', 'A100', 'T4']). None means any GPU type is acceptable. */
  gpu_types: string[] | null;
  /** TPU slice specification (type + topology). */
  tpu: null;
  mcp_servers: never[];
  /** Environment variables required for the task and resolved from the host at runtime. Supports ${VAR} and ${VAR:-default} template syntax. */
  env: Record<string, string>;
  /** Path to skills directory in the environment. Contents are copied to the agent's skills config directory. */
  skills_dir: string | null;
  /** Healthcheck to run after environment start to verify readiness. Mirrors Docker HEALTHCHECK semantics. */
  healthcheck: null;
  /** Default working directory for command execution. Overrides the container's WORKDIR when set. */
  workdir: string | null;
};

type VerifierConfig = PhaseNetworkPolicyConfig & {
  timeout_sec: number;
  env: Record<string, string>;
  /** Username or UID to run the verifier as. None uses the environment's default USER (e.g., root). */
  user: string | bigint | null;
  /** Whether the verifier runs in the agent's environment ('shared') or in a dedicated container ('separate'). */
  environment_mode: "shared" | "separate" | null;
  /** Environment definition for the separate verifier container. */
  environment: null;
  /** Commands run in compose services after the agent phase ends and before artifact collection. */
  collect: never[];
};

type TaskConfig = {
  schema_version: string;
  /** Package information for the task, parsed from the [task] section of task.toml. */
  task: PackageInfo | null;
  metadata: TomlTable;
  verifier: VerifierConfig;
  agent: AgentConfig;
  environment: EnvironmentConfig;
  solution: SolutionConfig;
  source: string | null;
  /** How to derive the trial-level reward from per-step verifier results in a multi-step task. */
  multi_step_reward_strategy: null;
  steps: null;
  artifacts: never[];
};

/** The sections a caller may set, each with the fields this port carries. */
export type TaskConfigInput = {
  task?: PackageInfo | null;
  metadata?: TomlTable;
  verifier?: Partial<Pick<VerifierConfig, "timeout_sec" | "env" | "user" | "environment_mode">>;
  agent?: Partial<Pick<AgentConfig, "timeout_sec" | "user">>;
  environment?: Partial<
    Omit<EnvironmentConfig, keyof BaselineNetworkPolicyConfig | "tpu" | "mcp_servers" | "healthcheck">
  >;
  solution?: Partial<SolutionConfig>;
};

/** Validate that name follows org/name format. */
function validate_name_format(v: string): string {
  if (!ORG_NAME_PATTERN.test(v) || v.includes("..")) {
    throw new Error(
      `Package name must be in 'org/name' format with alphanumeric characters, ` +
        `hyphens, underscores, and dots. Cannot start with a dot or contain '..'. Got: ${v}`,
    );
  }
  return v;
}

export function PackageInfo(data: Pick<PackageInfo, "name"> & Partial<PackageInfo>): PackageInfo {
  return {
    name: validate_name_format(data.name),
    version: data.version ?? null,
    description: data.description ?? "",
    authors: data.authors ?? [],
    keywords: data.keywords ?? [],
  };
}

export function TaskConfig(data: TaskConfigInput): TaskConfig {
  const phase: PhaseNetworkPolicyConfig = { network_mode: null, allowed_hosts: null };
  const env = data.environment ?? {};
  return {
    schema_version: "1.4",
    task: data.task ?? null,
    metadata: data.metadata ?? {},
    verifier: {
      ...phase,
      timeout_sec: 600.0,
      env: {},
      user: null,
      environment_mode: null,
      environment: null,
      collect: [],
      ...data.verifier,
    },
    agent: { ...phase, timeout_sec: null, user: null, ...data.agent },
    environment: {
      network_mode: "public",
      allowed_hosts: null,
      build_timeout_sec: env.build_timeout_sec ?? 600.0, // 10 minutes default
      docker_image: env.docker_image ?? null,
      os: env.os ?? "linux",
      cpus: env.cpus ?? null,
      memory_mb: env.memory_mb ?? null,
      storage_mb: env.storage_mb ?? null,
      gpus: env.gpus ?? null,
      gpu_types: env.gpu_types ?? null,
      tpu: null,
      mcp_servers: [],
      env: env.env ?? {},
      skills_dir: env.skills_dir ?? null,
      healthcheck: null,
      workdir: env.workdir ?? null,
    },
    solution: { env: {}, ...data.solution },
    source: null,
    multi_step_reward_strategy: null,
    steps: null,
    artifacts: [],
  };
}

function _is_toml_table_like(value: TomlValue | undefined): boolean {
  const isDict = (v: TomlValue | undefined) => typeof v === "object" && v !== null && !Array.isArray(v);
  return isDict(value) || (Array.isArray(value) && value.some((item) => isDict(item)));
}

function _without_none(value: TomlValue): TomlValue {
  if (Array.isArray(value)) return value.map((item) => _without_none(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => (item === null ? [] : [[key, _without_none(item)]])),
    );
  }
  return value;
}

export function model_dump_toml(config: TaskConfig): string {
  const dumped = _without_none(config);
  const data: TomlTable =
    typeof dumped === "object" && dumped !== null && !Array.isArray(dumped) ? dumped : {};

  const parts: string[] = [];
  const emitted = new Set<string>();
  const leading_root_fields = ["schema_version", "source", "multi_step_reward_strategy"];
  const trailing_root_fields = ["artifacts"];
  const isDict = (v: TomlValue | undefined) => typeof v === "object" && v !== null && !Array.isArray(v);
  const root_data: TomlTable = {};
  for (const field of leading_root_fields) {
    const value = data[field];
    if (value !== undefined && !isDict(value)) root_data[field] = value;
  }
  for (const [field, value] of Object.entries(data)) {
    if (
      leading_root_fields.includes(field) ||
      trailing_root_fields.includes(field) ||
      known_sections.has(field)
    ) {
      continue;
    }
    if (!_is_toml_table_like(value)) root_data[field] = value;
  }
  for (const field of trailing_root_fields) {
    const value = data[field];
    if (value !== undefined && !isDict(value)) root_data[field] = value;
  }
  if (Object.keys(root_data).length > 0) {
    parts.push(dumps(root_data));
    for (const field of Object.keys(root_data)) emitted.add(field);
  }

  for (const section of ["task", "steps", "metadata", "verifier", "agent", "environment", "solution"]) {
    const value = data[section];
    if (value !== undefined) {
      parts.push(dumps({ [section]: value }));
      emitted.add(section);
    }
  }

  for (const [field, value] of Object.entries(data)) {
    if (!emitted.has(field)) {
      parts.push(dumps({ [field]: value }));
      emitted.add(field);
    }
  }

  return `${parts.flatMap((part) => (part.trim() ? [part.trim()] : [])).join("\n\n")}\n`;
}

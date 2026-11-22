// Environment-map types shared across OS isolation boundaries. Although this file retains its v1
// name, no scrubbing occurs here because child environments are constructed from explicit
// allow-lists (`policy.environment`, `claudeEnv`).

/** Environment variable map with string values; keys depend on the host and tool posture. */
export type EnvValues = Record<string, string>;

/** Environment variable map as supplied by the host process, where declared keys may be `undefined`. */
export type OptionalEnvValues = Record<string, string | undefined>;

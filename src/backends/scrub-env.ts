// The environment block types the OS isolation passes around. v1's file also scrubbed likely
// secrets out of a child's environment; v2 builds every child's environment from an allowlist
// (the wall's `policy.environment`, `claudeEnv`), so nothing called the scrub and it is gone.

/** An environment block. The names come from the host, so the key set cannot be written down here;
 *  the value type can, and that is what callers of these functions actually need to know. */
export interface EnvValues {
  [name: string]: string;
}

/** An environment block as the host hands it over, where a declared name may still hold nothing. */
export interface OptionalEnvValues {
  [name: string]: string | undefined;
}

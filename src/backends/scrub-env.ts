// The environment block types the OS isolation passes around. The file keeps v1's name; nothing
// scrubs an environment here, since every child's is built from an allowlist (the wall's
// `policy.environment`, `claudeEnv`).

/** An environment block. The names come from the host, so the key set cannot be written down here;
 *  the value type can, and that is what callers of these functions actually need to know. */
export interface EnvValues {
  [name: string]: string;
}

/** An environment block as the host hands it over, where a declared name may still hold nothing. */
export interface OptionalEnvValues {
  [name: string]: string | undefined;
}

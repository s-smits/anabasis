/**
 * Take the operator session's own variables out of a simulation script's environment before it opens
 * a model, keeping every `CLAUDE*` name the product reads.
 *
 * On 2026-09-30 three stewards ran their conditions from inside a Claude Code session and each
 * unset `CLAUDE_EFFORT`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_*` by hand before the live call. The
 * product builds the Claude CLI's environment from this process's own minus secret-shaped names
 * (`claudeCliEnv` in src/backends/pi-providers.ts), so without that step `CLAUDECODE`, `CLAUDE_PID`,
 * `CLAUDE_EFFORT` and the parent's socket path reach the actor's CLI. A paid launch never has them:
 * launchd and systemd start the controller through `env -i` with an explicit map
 * (tools/fullrun-launchd.zsh, tools/fullrun-systemd.sh). The runners call this first thing, so a
 * condition started from a terminal and one started from an agent session open the same child.
 */
import type { OptionalEnvValues } from "#src/backends/scrub-env.ts";

/** The `CLAUDE*` names the product reads: the credential, the compaction mode and the model and
 *  effort pins `src/backends/resolve.ts` resolves. Every other one belongs to the calling session. */
const PRODUCT_NAMES =
  /^CLAUDE_(?:CODE_OAUTH_TOKEN|COMPACTION|MODEL|(?:BUILDER|BUILT|REVIEW)_(?:MODEL|REASONING_EFFORT))$/;
const SESSION_NAMES = /^CLAUDE/;

/** Remove the calling session's `CLAUDE*` variables from `env` in place and return their names,
 *  sorted. Names only: a value is never read, printed or returned. */
export function scrubSessionEnv(env: OptionalEnvValues = Bun.env): string[] {
  const stripped = Object.keys(env)
    .filter((name) => SESSION_NAMES.test(name) && !PRODUCT_NAMES.test(name))
    .sort();
  for (const name of stripped) Reflect.deleteProperty(env, name);
  return stripped;
}

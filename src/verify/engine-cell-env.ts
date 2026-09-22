/** The environment an engine cell starts with: the one owner of the fresh HOME and TMPDIR rule. */
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { commandSearchPath } from "./solve-command-isolation.ts";

/** The toolchain environment plus the candidate's search path, with TMPDIR and HOME inside the
 *  request workdir so no verdict depends on state an earlier evaluation left. The parent environment
 *  contributes nothing, so an inherited variable such as PATH cannot select an unrecorded tool or
 *  interpreter. */

export function engineCellEnv(input: {
  toolchainEnv: OptionalEnvValues;
  toolTree: string | null;
  workdir: string;
  requireOsSandbox: boolean;
}): OptionalEnvValues {
  const env: OptionalEnvValues = { ...input.toolchainEnv };
  // A toolchain-owned PATH stands; otherwise the cell searches exactly where the Builder shell did.
  env.PATH ??= commandSearchPath(input.toolTree);
  const homeDir = join(input.workdir, "home");
  mkdirSync(homeDir, { recursive: true });
  Object.assign(
    env,
    { TMPDIR: input.workdir, HOME: homeDir },
    input.requireOsSandbox ? { OPENSSL_CONF: "/dev/null" } : {},
  );
  return env;
}

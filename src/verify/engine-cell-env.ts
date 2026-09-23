/**
 * The environment an engine cell starts with. Split out of host.ts so that the fresh HOME and TMPDIR
 * rule has one owner rather than being restated wherever a cell is built.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { commandSearchPath } from "./solve-command-isolation.ts";

/** The toolchain environment plus the candidate's search path. TMPDIR selects a private tool
 *  scratch space, and HOME is a child of the request workdir, writable under both OS policies and
 *  removed once process cleanup is confirmed; tools can therefore start without making a later
 *  verdict depend on mutable state an earlier evaluation left behind. The parent environment
 *  contributes nothing at all, because the recorded toolchain must not be replaced by an unrecorded
 *  installation selected through an inherited variable — and PATH is precisely the variable that
 *  selects a script tool's interpreter. */
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

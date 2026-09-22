/**
 * The environment an engine cell starts with. Split from host.ts so the fresh HOME and TMPDIR rule
 * has one owner.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { commandSearchPath } from "./solve-command-isolation.ts";

/** The toolchain environment plus the candidate's search path; TMPDIR selects private tool scratch
 * space. HOME is a child of the request workdir, writable under both OS policies and removed after
 * process cleanup is confirmed. Tools can start without making later verdicts depend on mutable
 * state from earlier evaluations. The parent environment contributes nothing: the recorded
 * toolchain must not be replaced by an unrecorded installation selected through an inherited
 * variable, and PATH is the variable that selects a script tool's interpreter. */
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

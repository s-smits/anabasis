// Copied from v1 (github.com/s-smits/anabasis, 3f93d06b): src/verify/engine-cell-env.ts, only
// `cellCacheDir` and `engineCellEnv`, verbatim, with the imports they read. The rest of that file
// carries a tool's cache from one cell to the next and types v1's correctness-model tool runs, which
// did not come over; without it every cell's cache starts empty.

import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { commandSearchPath } from "./solve-command-isolation.ts";

/** Where a tool looks for its user cache under HOME: what Go's `os.UserCacheDir` answers and what
 *  XDG_CACHE_HOME is pointed at, so a tool asking either way writes the directory the host keeps. */
function cellCacheDir(workdir: string): string {
  const home = join(workdir, "home");
  return runtimeProcess.platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache");
}

/** The toolchain environment plus the candidate's search path. TMPDIR selects a private tool
 *  scratch space, and HOME is a child of the request workdir, writable under both OS policies and
 *  removed once process cleanup is confirmed; the cache under HOME holds only what the host
 *  restored into it. The parent environment contributes nothing at all, because the recorded
 *  toolchain must not be replaced by an unrecorded installation selected through an inherited
 *  variable — and PATH is precisely the variable that selects a script tool's interpreter. */
export function engineCellEnv(input: {
  toolchainEnv: OptionalEnvValues;
  toolTree: string | null;
  workdir: string;
  requireOsSandbox: boolean;
}): OptionalEnvValues {
  const env: OptionalEnvValues = { ...input.toolchainEnv };
  // A toolchain-owned PATH stands; otherwise the cell searches exactly where the Builder shell did.
  env.PATH ??= commandSearchPath(input.toolTree);
  const cacheDir = cellCacheDir(input.workdir);
  mkdirSync(cacheDir, { recursive: true });
  Object.assign(
    env,
    { TMPDIR: input.workdir, HOME: join(input.workdir, "home"), XDG_CACHE_HOME: cacheDir },
    input.requireOsSandbox ? { OPENSSL_CONF: "/dev/null" } : {},
  );
  return env;
}

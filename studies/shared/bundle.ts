/**
 * What a benchmark's container is given of an Anabasis arm: one folder, bind-mounted read-only,
 * holding the container solver compiled to one executable and the harness it solves inside.
 *
 * The solver is `pi-solve.ts` compiled with Bun's runtime into one file for the container's
 * platform, so the container needs no Bun of its own and runs the same source the study's commit
 * holds. The harness is copied whole by the owner that copies a kept harness into a Builder's home
 * (`copyHarness`, `src/builder/kept.ts`), its programs as files, or written as the Starter Built
 * Harness by the starter's own writer (`writeStarter`). It is then opened by the host's reader
 * (`openHarness`), so a harness the container solver would refuse is refused here, and the digest
 * the folder records is the one a campaign names the harness by.
 *
 * Harness²'s Codex runner mounts its staged Codex the same way (`environment_override.mounts`).
 */
import { copyHarness } from "#src/builder/kept.ts";
import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { openHarness } from "#src/solve/harness.ts";
import { writeStarter } from "#src/solve/starter.ts";

/** The solver's executable, the harness and the record, as the Harbor agent names them inside the
 *  mount (`harbor/pi_agent.py`). */
export const SOLVER_FILE = "pi-solve";
export const HARNESS_DIR = "harness";
export const MOUNT_RECORD = "mount.json";

/** Bun's name for the container's platform. The baseline build runs on any x86-64 processor. */
const TARGET = "bun-linux-x64-baseline";

const SOLVER = join(import.meta.dir, "pi-solve.ts");

/** The folder `into`, holding the solver and `harness`, a kept harness's folder or `starter`.
 *  Returns the harness's digest. */
export async function bundleArm(into: string, harness: string): Promise<string> {
  if (existsSync(into)) throw new Error(`${into} is there already; an arm's mount is made once`);
  mkdirSync(into, { recursive: true });
  const dir = join(into, HARNESS_DIR);
  if (harness === "starter") writeStarter(dir);
  else copyHarness(harness, dir);
  const opened = await openHarness(dir);
  if (opened.kinds.size > 0) {
    throw new Error(`${harness} declares tools of its own, which the container solver does not serve`);
  }
  runTextSyncOrThrow([
    capturedExecPath,
    "build",
    "--compile",
    `--target=${TARGET}`,
    SOLVER,
    "--outfile",
    join(into, SOLVER_FILE),
  ]);
  const record = { harness: opened.digest, from: harness === "starter" ? "starter" : "kept", target: TARGET };
  writeFileSync(join(into, MOUNT_RECORD), `${capturedJsonStringify(record, null, 2)}\n`);
  return opened.digest;
}

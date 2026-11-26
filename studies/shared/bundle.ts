/**
 * What a benchmark's container is given of an Anabasis arm: one folder, bind-mounted read-only,
 * holding the container solver compiled to one executable and the harness it solves inside. The arm
 * is the Starter or a harness a campaign kept, found and copied with the owners the campaign's own
 * handover uses (`closeCommand`): `logAcross` finds the log on any host, `resolveCheckpoint` names the kept
 * state (`promoted` by default) and refuses one that no longer opens as its digest, `copyHarness`
 * copies it, and the copy must open as the same digest. The mount also records how the campaign
 * ended and whether the harness's epoch was confirmed (`epochsOf`), so a score is tied to a
 * campaign and a digest. A campaign that has not ended can still promote, so its reference is taken
 * only when named by digest or letter; `programs-of:` builds the starter-guide + `.toolchain`
 * control directly in the staging directory so nothing is written under a campaign's folder. The
 * solver is `pi-solve.ts` compiled with Bun's runtime for the container's platform, so the container
 * needs no Bun of its own.
 */
import { copyHarness, writeProgramsControl } from "#src/builder/store.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { read } from "#src/kernel/log.ts";
import { latestBuilt, promoted } from "#src/kernel/reports.ts";
import { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, relative } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { openHarness } from "#src/harness/open.ts";
import { foreignPrograms, placeOf } from "#src/harness/place.ts";
import { writeBare, writeStarter } from "#src/harness/starter.ts";
import { toolTreeEnv, toolTreeSearchDirs } from "#src/sandbox/isolation.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { PROGRAMS_OF, resolveCheckpoint, PROMOTED } from "#tools/campaign/campaign.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { packageFolders } from "./foreign-python.ts";

/** The names the Harbor agent gives these inside the mount (`harbor/pi_agent.py`). */
export const SOLVER_FILE = "pi-solve";
export const HARNESS_DIR = "harness";
export const MOUNT_RECORD = "mount.json";

/** The baseline build runs on any x86-64 processor. */
const TARGET = "bun-linux-x64-baseline";

const SOLVER = join(import.meta.dir, "pi-solve.ts");
const IMPORTS = `import importlib, pkgutil, sys
names = sorted({m.name for m in pkgutil.iter_modules(sys.argv[1:]) if not m.name.startswith("_")})
bad = []
for name in names:
    try: importlib.import_module(name)
    except BaseException: bad.append(name)
print("IMPORTS", sys.version.split()[0], len(names) - len(bad), len(names), *bad[:5])`;

export const HERE = placeOf(
  `${runtimeProcess.platform}-${runtimeProcess.arch}`,
  `this machine (${runtimeProcess.platform} ${runtimeProcess.arch})`,
);

interface Origin {
  readonly campaign: string | null;
  readonly ending: string | null;
  /** False until a starter comparison of it tallied a task, null where it led no epoch
   *  (`confirmed`, `src/campaign/climb.ts`). */
  readonly confirmed: boolean | null;
  readonly programsOf?: string;
}

interface Source {
  readonly campaign: string;
  readonly harness?: string;
}

export function sourceNamed(from: string, harness: string | undefined): "base" | "starter" | Source {
  if (from !== "starter" && from !== "base") {
    return harness === undefined ? { campaign: from } : { campaign: from, harness };
  }
  if (harness === undefined) return from;
  throw new Error(`--harness names a campaign's kept harness; ${from} is one harness`);
}

export async function placeHarness(dir: string, source: "base" | "starter" | Source): Promise<Origin> {
  if (source === "base" || source === "starter") {
    if (source === "base") writeBare(dir);
    else writeStarter(dir);
    return { campaign: null, ending: null, confirmed: null };
  }
  const asked = source.harness ?? PROMOTED;
  const ablation = asked.startsWith(PROGRAMS_OF);
  const target = ablation ? asked.slice(PROGRAMS_OF.length) : asked;
  if (ablation && target.startsWith(PROGRAMS_OF)) {
    throw new Error(`${asked}: nested ${PROGRAMS_OF} is not supported`);
  }
  const log = await logAcross(source.campaign);
  const events = read(log);
  const last = events.at(-1);
  const ending = last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null;
  if (ending === null && (target === PROMOTED || target === "latest")) {
    throw new Error(
      `${source.campaign} has not ended, so its ${target} harness may still move: name it by digest or letter`,
    );
  }
  const campaign = basename(dirname(log));
  // The starter, asked for or still the reference, is written as itself: `resolveCheckpoint` would keep a copy of
  // it among the campaign's states.
  const resolvesToStarter =
    target === "starter" ||
    (target === PROMOTED && promoted(events) === null) ||
    (target === "latest" && latestBuilt(events) === null);
  if (resolvesToStarter) {
    if (ablation) {
      throw new Error(`starter installed no program, so the control for its programs is the starter itself`);
    }
    writeStarter(dir);
    return { campaign, ending, confirmed: null };
  }
  const kept = await resolveCheckpoint({ log, states: join(dirname(log), "states") }, "--harness", target);
  if (ablation) {
    writeProgramsControl(dir, kept.dir, kept.digest);
    await openHarness(dir);
    return { campaign, ending, confirmed: null, programsOf: kept.digest };
  }
  copyHarness(kept.dir, dir);
  const { digest } = await openHarness(dir);
  if (digest !== kept.digest) {
    throw new Error(
      `the copy of ${kept.digest} opens as ${digest}: a score of it would be another harness's`,
    );
  }
  const led = epochsOf(events).findLast(({ reference }) => reference === digest);
  return { campaign, ending, confirmed: led?.confirmed ?? null };
}

export async function bundleArm(
  into: string,
  source: "base" | "starter" | Source,
): Promise<{ digest: string; origin: Origin }> {
  if (existsSync(into)) throw new Error(`${into} is there already; an arm's mount is made once`);
  // Built beside its place and renamed into it whole, so a failure leaves no half-made mount that would
  // refuse every later one.
  const part = `${into}.part-${String(process.pid)}-${String(Date.now())}`;
  mkdirSync(part, { recursive: true });
  const origin = await placeHarness(join(part, HARNESS_DIR), source);
  await foreignPrograms(join(part, HARNESS_DIR, TOOL_TREE_DIR));
  const opened = await openHarness(join(part, HARNESS_DIR));
  runTextSyncOrThrow([
    capturedExecPath,
    "build",
    "--compile",
    `--target=${TARGET}`,
    SOLVER,
    "--outfile",
    join(part, SOLVER_FILE),
  ]);
  const record = { harness: opened.digest, ...origin, target: TARGET };
  writeFileSync(join(part, MOUNT_RECORD), `${capturedJsonStringify(record, null, 2)}\n`);
  renameSync(part, into);
  return { digest: opened.digest, origin };
}

export async function ownPython(tree: string, env: Readonly<Record<string, string>>): Promise<string | null> {
  const toolchain = join(tree, HARNESS_DIR, TOOL_TREE_DIR);
  const dirs = toolTreeSearchDirs(toolchain);
  const python = dirs
    .map((dir) => join(dir, "python3"))
    .find((path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined);
  if (python === undefined) return null;
  const envScript = toolTreeEnv(toolchain);
  const run = (words: readonly string[]) => {
    const argv =
      envScript === undefined
        ? [python, "-c", ...words]
        : ["/bin/bash", "-c", 'exec "$1" -c "${@:2}"', "_", python, ...words];
    const ran = runSync(argv, {
      cwd: tmpdir(),
      env: { ...env, PATH: [...dirs, env.PATH ?? ""].join(":"), ...keyIfDefined("BASH_ENV", envScript) },
      timeout: 300_000,
    });
    return {
      out: decodeOutput(ran.stdout),
      why: `exit ${String(ran.exitCode)}: ${decodeOutput(ran.stderr).trim().split("\n").at(-1) ?? ""}`,
      ok: ran.exitCode === 0,
    };
  };
  const started = run(["pass"]);
  if (!started.ok) throw new Error(`${relative(tree, python)} cannot start here (${started.why})`);
  const sites = (await packageFolders(toolchain)).map(({ site }) => join(toolchain, site));
  const counted = run([IMPORTS, ...sites]);
  const [, version, ok, of, ...bad] = /^IMPORTS .*$/mu.exec(counted.out)?.[0].split(" ") ?? [];
  if (of === undefined) return `its python3 starts, and the count of its modules ended (${counted.why})`;
  return `its python3 is ${String(version)} and imports ${String(ok)} of ${of} of its modules${bad.length === 0 ? "" : `, not ${bad.join(", ")}`}`;
}

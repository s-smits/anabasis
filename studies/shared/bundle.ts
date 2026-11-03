/**
 * What a benchmark's container is given of an Anabasis arm: one folder, bind-mounted read-only,
 * holding the container solver compiled to one executable, the harness it solves inside, and the
 * harness's tools module as `openHarness` bundles it here, which the compiled solver cannot: it holds
 * none of the host's source to bundle over (`MODULE_FILE`).
 *
 * An arm is the Starter Built Harness or a harness a campaign kept, named by the campaign alone.
 * The study finds and copies it with the owners the campaign's own handover uses
 * (`closeCommand`, `tools/d2/close.ts`), so it carries no rule of its own about which files a
 * harness is: `logAcross` finds the campaign's log on any host, bringing its folder whole; `keptAs`
 * names the kept state (`promoted` by default, the reference at the log's end, or `latest`, a
 * letter the view prints or a digest) and refuses one that no longer opens as its digest;
 * `copyHarness` copies it with its programs as files and its correctness model left out; and the
 * copy must open as the same digest. The mount also records how the campaign ended and whether the
 * epoch the harness led was confirmed against the starter (`epochsOf`, `src/campaign/climb.ts`), so
 * a score is read beside what the campaign itself measured. Until 2 November an arm was any folder
 * named on the command line, and nothing tied a score to a campaign or a digest.
 *
 * A campaign that has not ended can still promote, so its reference is taken only when named by
 * digest or letter. `programs-of:` is refused: `keptAs` makes that control among the campaign's
 * states, and the study writes nothing under a campaign's folder.
 *
 * The solver is `pi-solve.ts` compiled with Bun's runtime into one file for the container's
 * platform, so the container needs no Bun of its own and runs the source the study's commit holds.
 * Harness²'s Codex runner mounts its staged Codex the same way (`environment_override.mounts`).
 */
import { copyHarness } from "#src/builder/kept.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { read } from "#src/kernel/log.ts";
import { promoted } from "#src/kernel/reports.ts";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { openHarness } from "#src/harness/open.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { keptAs, PROMOTED } from "#tools/d2/campaign.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** The solver's executable, the harness, the record and the harness's tools module, as the Harbor
 *  agent names them inside the mount (`harbor/pi_agent.py`). */
export const SOLVER_FILE = "pi-solve";
export const HARNESS_DIR = "harness";
export const MOUNT_RECORD = "mount.json";
export const MODULE_FILE = "tools.mjs";

/** Bun's name for the container's platform. The baseline build runs on any x86-64 processor. */
const TARGET = "bun-linux-x64-baseline";

const SOLVER = join(import.meta.dir, "pi-solve.ts");

/** Where a program's interpreter may sit to exist in a benchmark's container as on a host. */
const CONTAINER_ROOTS = ["/usr/", "/bin/"];

/** ELF's machine number for x86-64. */
const X86_64 = 62;

/** Where an arm's harness came from, as its mount records it. */
interface Origin {
  /** The campaign's folder name; null for the starter named alone. */
  readonly campaign: string | null;
  /** The campaign's ending, or null where its log does not end on one. */
  readonly ending: string | null;
  /** Whether the epoch this harness led as reference is confirmed against the starter (`confirmed`,
   *  `src/campaign/climb.ts`): false until a starter comparison of it tallied a task, null where it
   *  led no epoch. */
  readonly confirmed: boolean | null;
}

/** What an arm is made from: `starter`, or a campaign's name or log and the harness it kept. */
interface Source {
  readonly campaign: string;
  /** As `keptAs` takes it; `promoted` where unnamed. */
  readonly harness?: string;
}

/** The harness folder `dir`, written from `source`. Returns what the mount records of it. */
export async function placeHarness(dir: string, source: "starter" | Source): Promise<Origin> {
  if (source === "starter") {
    writeStarter(dir);
    return { campaign: null, ending: null, confirmed: null };
  }
  const asked = source.harness ?? PROMOTED;
  if (asked.startsWith("programs-of:")) {
    throw new Error(
      `${asked}: that control is made among the campaign's states, which the study does not write`,
    );
  }
  const log = await logAcross(source.campaign);
  const events = read(log);
  const last = events.at(-1);
  const ending = last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null;
  if (ending === null && (asked === PROMOTED || asked === "latest")) {
    throw new Error(
      `${source.campaign} has not ended, so its ${asked} harness may still move: name it by digest or letter`,
    );
  }
  const campaign = basename(dirname(log));
  // The starter, asked for or still the reference, is written as itself: `keptAs` would keep a
  // copy of it among the campaign's states.
  if (asked === "starter" || (asked === PROMOTED && promoted(events) === null)) {
    writeStarter(dir);
    return { campaign, ending, confirmed: null };
  }
  const kept = await keptAs({ log, states: join(dirname(log), "states") }, "--harness", asked);
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

/** The folder `into`, holding the solver and the harness `source` names. Returns the digest the
 *  harness opens as and where it came from. */
export async function bundleArm(
  into: string,
  source: "starter" | Source,
): Promise<{ digest: string; origin: Origin }> {
  if (existsSync(into)) throw new Error(`${into} is there already; an arm's mount is made once`);
  // Built beside its place and renamed into it whole, so a failure leaves no half-made mount that
  // would refuse every later one.
  const part = `${into}.part-${String(process.pid)}-${String(Date.now())}`;
  mkdirSync(part, { recursive: true });
  const origin = await placeHarness(join(part, HARNESS_DIR), source);
  await foreignPrograms(join(part, HARNESS_DIR, TOOL_TREE_DIR));
  const opened = await openHarness(join(part, HARNESS_DIR));
  writeFileSync(join(part, MODULE_FILE), opened.module);
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

/** Refuses a tool tree holding a program the Linux x86-64 container cannot run: a Mach-O binary,
 *  an ELF binary for another processor, or a script whose interpreter is a host path, as a Python
 *  venv's entry points are. A campaign on a Mac keeps such programs, and `command -v` in the
 *  container's dry run finds them all the same. */
export async function foreignPrograms(tree: string): Promise<void> {
  if (!existsSync(tree)) return;
  const foreign: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: tree, onlyFiles: true, dot: true })) {
    const why = foreignHead(Buffer.from(await Bun.file(join(tree, path)).slice(0, 128).bytes()));
    if (why !== null) foreign.push(`${path} (${why})`);
  }
  if (foreign.length > 0) {
    throw new Error(
      `the harness's ${TOOL_TREE_DIR} holds programs a Linux x86-64 container cannot run: ${foreign.sort().join(", ")}`,
    );
  }
}

/** Why the opening bytes of a file name a program foreign to the container, or null. */
export function foreignHead(head: Buffer): string | null {
  const magic = head.length >= 4 ? head.readUInt32BE(0) : 0;
  if ([0xfe_ed_fa_ce, 0xfe_ed_fa_cf, 0xce_fa_ed_fe, 0xcf_fa_ed_fe, 0xca_fe_ba_be].includes(magic)) {
    return "a Mach-O binary";
  }
  if (magic === 0x7f_45_4c_46 && head.length >= 20 && head.readUInt16LE(18) !== X86_64) {
    return `an ELF binary for machine ${String(head.readUInt16LE(18))}`;
  }
  const text = head.toString("latin1");
  if (!text.startsWith("#!")) return null;
  const interpreter = text.slice(2).trimStart().split(/\s/u, 1)[0] ?? "";
  return CONTAINER_ROOTS.some((root) => interpreter.startsWith(root))
    ? null
    : `its interpreter ${interpreter} is a host path`;
}

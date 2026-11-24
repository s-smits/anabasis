/**
 * `bun run runs bench <run> [--bench <name>] [--as <label>] [--harness <kept>] [--baseline base|starter] [--login N] [--wait] [--yes]`
 * `bun run runs bench [--bench <name>] [--store <dir>] [--host <name>]`
 */
import { UNAME_PLACES } from "#src/harness/place.ts";
import { promoted } from "#src/kernel/reports.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { readControllers } from "./code.ts";
import { quoted, shellOn, shellPath, treeBun } from "./host-command.ts";
import { type Bench, benchesOf, type Host, hostNamed } from "./host-config.ts";
import { scoreDone } from "./bench-scores.ts";
import { holders, namedIn, verbOn } from "./hosts.ts";
import { roomFor } from "./keep.ts";
import { allowedLogins, asGathered, type Env, liveEverywhere } from "./logins.ts";
import { logEvents, Misused, packOf, readNamed, runs } from "./registry.ts";

/** A single stage of a benchmark evaluation: its human-readable description and argv. */
interface Step {
  readonly says: string;
  readonly command: readonly string[];
}

/** Fully resolved benchmark evaluation plan. An `undefined` host refers to the local machine. */
export interface Plan {
  readonly run: string;
  readonly label: string;
  /** Kept harness identifier, either a single letter or a 64-character digest. */
  readonly harness: string;
  readonly login: string;
  /** Host holding the campaign, along with the checkout path and Bun executable used for export. */
  readonly holder: Host | undefined;
  readonly tree: string;
  readonly bun: string;
  /** Benchmark name, runner host, and shell-escaped store path and sitting command on that host. */
  readonly bench: string;
  readonly runner: Host | undefined;
  readonly store: string;
  readonly sitting: string;
  /** Target platform token passed to `score.ts tree --for`. */
  readonly place: string;
  /** Minor version of the `python3` interpreter on the runner host, reported by `<sitting> python`. */
  readonly python: string;
  /** Digest of the harness already stored under `label`, or null if not yet exported. */
  readonly held: string | null;
  /** Whether to wait for the runner host to become idle rather than failing immediately if busy. */
  readonly wait: boolean;
  /** Baseline arm paired beside the built harness on native `pi-durable`: `base` (bareSolver) or `starter` (baseStarter). */
  readonly baseline: "base" | "starter";
}

/** Options governing duplicate-export detection in `heldAs`. */
interface HeldAsOptions {
  readonly as?: string | undefined;
  readonly modes?: ReadonlyMap<string, "claude" | "pi"> | undefined;
}

/** Shell expression selecting `sha256sum` (coreutils) when present, falling back to `shasum -a 256`
 *  so checksum output matches across Linux hosts without Perl and macOS hosts. */
const SUMS = "$(command -v sha256sum || echo shasum -a 256)";

/** Returns configured benchmarks (`EVAL_RUNNER`) applicable to `run`, or the single benchmark named
 *  by `named`. A configured pack matches both itself and hyphenated variants (for example `jobstat`
 *  matches `jobstat-v2`). */
function benchesFor(run: string, env: Env, named?: string): Bench[] {
  const pack = packOf(run);
  const reads = ({ name, packs }: Bench) =>
    named === undefined ? packs.some((one) => pack === one || pack.startsWith(`${one}-`)) : name === named;
  return benchesOf(env).filter(reads);
}

/** Resolves the unique benchmark configuration for `run`, throwing if zero or multiple benchmarks match. */
export function settingsOf(
  run: string,
  env: Env,
  named?: string,
): Pick<Plan, "bench" | "runner" | "store" | "sitting"> {
  const benches = benchesFor(run, env, named);
  const [only] = benches;
  if (benches.length > 1) {
    throw new Error(`${run}: ${benches.map(({ name }) => name).join(", ")} read it; name one with --bench`);
  }
  if (only === undefined) {
    const which = named === undefined ? `reads pack ${packOf(run)}` : `is named ${named}`;
    throw new Error(`${run}: no benchmark ${which} (EVAL_RUNNER, .env.runs.example)`);
  }
  return {
    bench: only.name,
    runner: only.host,
    store: shellPath(only.store),
    sitting: shellPath(only.sitting),
  };
}

/** Sender-side shell command for streaming an exported tree: computes SHA-256 checksums for all
 *  files (needed because `bsdtar` does not verify gzip CRCs on extraction), then tars the tree,
 *  build record, and checksums to stdout while stripping macOS extended attributes and `.DS_Store`. */
export const sealed = (from: string, label: string) =>
  `cd ${from} && find ${quoted(label)} ${quoted(`${label}.build.json`)} -type f ! -name .DS_Store -exec ${SUMS} {} + > ${quoted(`${label}.sha256`)} && COPYFILE_DISABLE=1 tar -czf - --no-xattrs --exclude .DS_Store ${quoted(label)} ${quoted(`${label}.build.json`)} ${quoted(`${label}.sha256`)}`;

/** Receiver-side shell command on the benchmark host: extracts into a staging directory, verifies
 *  every SHA-256 checksum, rejects symlinks pointing to absolute paths on the build machine, and
 *  moves the tree into place atomically without overwriting an existing label. */
export function opened(trees: string, label: string): string {
  const tree = `${trees}/${quoted(label)}`;
  const part = `${trees}/${quoted(`.part-${label}`)}`;
  return `test ! -e ${tree} && mkdir -p ${trees} && rm -rf ${part} && mkdir ${part} && tar -xzf - -C ${part} && (cd ${part} && ${SUMS} -c --quiet ${quoted(`${label}.sha256`)}) && links=$(find ${part} -type l -lname '/*') && { test -z "$links" || { echo "links to absolute paths: $links" >&2; false; }; } && rm ${part}/${quoted(`${label}.sha256`)} && mv ${part}/${quoted(label)} ${tree} && mv ${part}/${quoted(`${label}.build.json`)} ${trees}/ && rmdir ${part}`;
}

function baselineAsked(asked: string | undefined): "base" | "starter" {
  if (asked === undefined) return "base";
  if (asked !== "base" && asked !== "starter") throw new Misused("--baseline takes base or starter");
  return asked;
}

/** Builds the ordered shell steps for `plan`. Ensures the runner host is idle before loading it and
 *  completes both dry runs before spending compute on rollouts. */
export function stepsOf(plan: Plan): Step[] {
  const { run, label, login, holder, runner, sitting, baseline } = plan;
  const baselineLabel = `${baseline}-${label}`;
  const stage = `"\${TMPDIR:-/tmp}"/${quoted(`ana-outside-read-${label}`)}`;
  const on = (says: string, script: string): Step => ({ says, command: shellOn(runner, script) });
  const piped = (host: Host | undefined, script: string) => shellOn(host, script).map(quoted).join(" ");
  const reference = `${sitting} run ${quoted(login)} ${quoted(label)} --arm ${quoted(`pi:${run}`)} --harness ${quoted(plan.harness)}`;
  const bare = `${sitting} run ${quoted(login)} ${quoted(baselineLabel)} --arm ${quoted(`pi:${baseline}`)}`;
  const idle = `${sitting} status | head -n 1 | grep -qx idle`;
  const rolled = `${plan.store}/rolled-${label}.log`;
  const exported: Step[] = [
    {
      says: `export ${label} for ${plan.place} on ${holder?.name ?? "this machine"}`,
      command: shellOn(
        holder,
        `rm -rf ${stage} && cd ${shellPath(plan.tree)} && ${plan.bun} studies/harness2/score.ts tree --arm ${quoted(`pi:${run}`)} --harness ${quoted(plan.harness)} --name ${quoted(label)} --out ${stage} --for ${quoted(plan.place)} --python ${quoted(plan.python)}`,
      ),
    },
    {
      says: `carry ${label} into the store on ${runner?.name ?? "this machine"}`,
      command: [
        "bash",
        "-c",
        `set -o pipefail; ${piped(holder, sealed(`${stage}/trees`, label))} | ${piped(runner, opened(`${plan.store}/trees`, label))}`,
      ],
    },
    { says: "clear the export's stage", command: shellOn(holder, `rm -rf ${stage}`) },
  ];
  return [
    plan.wait
      ? on("wait until the benchmark's machine is idle", `until ${idle}; do sleep 300; done`)
      : on(
          "the benchmark's machine is idle",
          `${idle} || { echo 'an arm holds the machine: the read waits for it'; exit 1; }`,
        ),
    ...(plan.held === null ? exported : []),
    on(`dry run of ${label}`, `${reference} --dry-run`),
    on(`dry run of ${baselineLabel}`, `${bare} --dry-run`),
    on(
      `roll ${label}, then ${baselineLabel}, on login ${login}`,
      `nohup sh -c ${quoted(`${reference} --yes && ${bare} --yes`)} >> ${rolled} 2>&1 < /dev/null & echo "rolling in process $!, which writes ${rolled}; the sitting's status names the arm"`,
    ),
  ];
}

/** Remote probe script executed before planning: reports platform (`uname -sm`), the sitting's
 *  Python minor version, and existing exported harness digests in `store`. Exits immediately if
 *  `uname` or `<sitting> python` fails so missing interpreter output cannot be misread; an empty
 *  store without trees is allowed. */
export const probed = ({ sitting, store }: Pick<Plan, "sitting" | "store">): string =>
  `uname -sm && ${sitting} python || exit; grep -EH '"(harness|mode)"' ${store}/trees/*/export.json; true`;

/** Executes `steps` sequentially via `spawn`, printing each description and throwing on the first non-zero exit. */
export async function walk(
  steps: readonly Step[],
  spawn: (command: readonly string[]) => Promise<number>,
): Promise<void> {
  for (const [at, { says, command }] of steps.entries()) {
    console.log(`── ${says}`);
    const code = await spawn(command);
    if (code !== 0) {
      throw new Error(
        `${says}: exit ${String(code)}; none of the ${String(steps.length - at - 1)} steps after it ran`,
      );
    }
  }
}

/** Checks `store` for existing exports matching `label` or `harness`. Throws if `label` already
 *  binds a different 64-character digest or a legacy Claude Code export; returns other native `pi`
 *  labels holding `harness` (`again`) and any legacy Claude Code labels (`legacy`) unless `--as`
 *  explicitly requested a new label. */
export function heldAs(
  store: ReadonlyMap<string, string>,
  harness: string,
  label: string,
  { as, modes }: HeldAsOptions = {},
): { again: string[]; held: string | null; legacy: string[] } {
  const held = store.get(label) ?? null;
  if (held !== null && harness.length === 64 && held !== harness) {
    throw new Error(
      `${label}: the store holds that label for ${held.slice(0, 8)}; a label binds one tree, so name another`,
    );
  }
  const isPi = (one: string) => (modes?.get(one) ?? "claude") === "pi";
  if (held !== null && !isPi(label)) {
    throw new Error(
      `${label}: the store holds that label as a legacy claude export; name another label for native pi`,
    );
  }
  const sameHarness =
    as === undefined ? [...store].filter(([one, of]) => of === harness && one !== label) : [];
  const again = sameHarness.filter(([one]) => isPi(one)).map(([one]) => one);
  const legacy = sameHarness.filter(([one]) => !isPi(one)).map(([one]) => one);
  return { again, held, legacy };
}

/** Strips `--eval` from `pause` arguments and computes the follow-up `bench --wait` commands owed
 *  once the pause completes. Resolved upfront so missing or misconfigured benchmarks fail before
 *  the pause hook runs. */
export function evalOf(
  args: readonly string[],
  env: Env = runtimeProcess.env,
): { passed: string[]; reads: string[][] } {
  const passed = args.filter((arg) => arg !== "--eval");
  if (passed.length === args.length) return { passed, reads: [] };
  const [run] = namedIn("pause", passed);
  if (run === undefined) throw new Misused("pause --eval names no run before a `--`, so it would read none");
  const benches = benchesFor(run, env);
  if (benches.length === 0) {
    console.log(`${run}: no benchmark reads pack ${packOf(run)}; the pause goes on alone`);
  }
  const yes = args.includes("--yes") ? ["--yes"] : [];
  return { passed, reads: benches.map(({ name }) => [run, "--bench", name, "--wait", ...yes]) };
}

/** Runs each deferred benchmark evaluation from `evalOf` after a pause completes. Dry-run plans
 *  print inline; live `--yes` invocations spawn detached processes so waiting for an idle benchmark
 *  host does not keep the pause process alive and block a subsequent `continue`. */
export async function readEach(reads: readonly (readonly string[])[]): Promise<void> {
  for (const words of reads) {
    if (!words.includes("--yes")) {
      await bench(words);
      continue;
    }
    const command = [capturedExecPath, join(import.meta.dir, "cli.ts"), "bench", ...words];
    const child = capturedSpawn(command, {
      detached: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    child.unref();
    console.log(`${words.join(" ")}: goes on in process ${String(child.pid)}`);
  }
}

/** Locates the host, checkout path, and Bun executable from which to export `run`. */
async function exporterOf(run: string): Promise<Pick<Plan, "holder" | "tree" | "bun">> {
  const here = new Set(runs().map(({ name }) => name));
  if (here.has(run)) return { holder: undefined, tree: runtimeProcess.cwd(), bun: "bun" };
  const holder = (await holders([run], here)).get(run);
  if (holder === undefined) {
    throw new Error(`${run}: no worktree here or on a host holds a campaign of that name`);
  }
  const [controller] = await readControllers([holder]);
  if (controller === null || controller === undefined) {
    throw new Error(`${holder.name}: no controller there to export from`);
  }
  return { holder, tree: controller.tree, bun: treeBun(controller.bun) };
}

/** Resolves a complete `Plan` for `run`, or returns null if the harness is already evaluated under another label. */
async function planOf(
  run: string,
  values: {
    as?: string;
    baseline?: string;
    bench?: string;
    harness?: string;
    login?: string;
    wait: boolean;
  },
): Promise<Plan | null> {
  const baseline = baselineAsked(values.baseline);
  const env = runtimeProcess.env;
  const settings = settingsOf(run, env, values.bench);
  const harness = values.harness ?? promoted(logEvents(readNamed(run).path));
  if (harness === null) throw new Error(`${run} has promoted no harness: there is nothing to read outside`);
  // Single-letter harness identifiers are only meaningful alongside `view`, so require an explicit `--as` label.
  const defaultLabel = harness.length === 64 ? `pi-${harness.slice(0, 8)}` : "";
  const label = values.as ?? defaultLabel;
  if (!isSafePathSegment(label)) throw new Misused();
  const said = await runTextOrThrow(shellOn(settings.runner, probed(settings)));
  const [named = "", python = ""] = said.split("\n");
  const place = UNAME_PLACES.get(named);
  if (place === undefined) {
    throw new Error(`the benchmark's machine is '${named}', which no export is written for`);
  }
  const rows = said.matchAll(/\/trees\/([^/\n]+)\/export\.json:\s*"harness":\s*"([^"]*)"/gu);
  const modeRows = said.matchAll(/\/trees\/([^/\n]+)\/export\.json:\s*"mode":\s*"(pi|claude)"/gu);
  const modes = new Map(
    [...modeRows].map(([, one = "", mode = "claude"]) => [one, mode === "pi" ? "pi" : "claude"] as const),
  );
  const { again, held, legacy } = heldAs(
    new Map([...rows].map(([, one = "", of = ""]) => [one, of])),
    harness,
    label,
    { as: values.as, modes },
  );
  if (again.length > 0) {
    console.log(`${run}: ${harness.slice(0, 8)} is read already as ${again.join(", ")}; --as reads it again`);
    return null;
  }
  if (legacy.length > 0) {
    console.log(
      `${run}: ${harness.slice(0, 8)} was read before under legacy claude as ${legacy.join(", ")}; reading natively on pi-durable`,
    );
  }
  const { logins, why } =
    values.login === undefined
      ? await roomFor(allowedLogins(env), new Set(), asGathered(await liveEverywhere("configured")))
      : { logins: [values.login], why: "" };
  const [login] = logins;
  if (login === undefined) {
    throw new Error(`no login has room${why === "" ? "" : ` (${why})`}; the read stays owed`);
  }
  const exporter = held === null ? await exporterOf(run) : { holder: undefined, tree: "", bun: "" };
  return {
    run,
    label,
    harness,
    login,
    ...exporter,
    ...settings,
    place,
    python,
    held,
    wait: values.wait,
    baseline,
  };
}

export async function bench(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      as: { type: "string" },
      baseline: { type: "string" },
      bench: { type: "string" },
      host: { type: "string" },
      store: { type: "string" },
      harness: { type: "string" },
      login: { type: "string" },
      wait: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [run, ...rest] = positionals;
  if (run === undefined && values.host !== undefined) {
    const passed = args.filter((word, at) => word !== "--host" && args[at - 1] !== "--host");
    runtimeProcess.exitCode = await verbOn(hostNamed(values.host), ["bench", ...passed]);
    return;
  }
  if (run === undefined) return await scoreDone(values);
  if (rest.length > 0 || !isSafePathSegment(run) || values.host !== undefined || values.store !== undefined) {
    throw new Misused();
  }
  const plan = await planOf(run, values);
  if (plan === null) return;
  const { label, held, baseline } = plan;
  console.log(
    `${run} read outside on ${plan.bench} as ${label} and ${baseline}-${label}, on login ${plan.login}, for ${plan.place} (python3 ${plan.python})${held === null ? "" : `; the store holds ${label} already, rolled as it stands`}`,
  );
  const steps = stepsOf(plan);
  if (!values.yes) {
    for (const { says } of steps) console.log(`  ${says}`);
    console.log("nothing started: write the prediction file from this plan, then pass --yes");
    return;
  }
  const io = { stdin: "ignore", stdout: "inherit", stderr: "inherit" } as const;
  await walk(steps, async (command) => await capturedSpawn([...command], io).exited);
}

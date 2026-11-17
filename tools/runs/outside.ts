/**
 * `bun run runs outside <run> --as <label> [--harness <kept>] [--login N] [--yes]`
 *
 * One command for a run's outside read (run-improvement-campaign, "The outside aim"): the run's
 * reference, or the kept harness `--harness` names by its letter or whole digest, is written for
 * the machine that rolls the benchmark, carried into the score store there, proved by a dry run of
 * each arm, and rolled with a fresh Starter queued behind it. Until 17 November 2026 these were
 * some ten commands on three machines, and a read took most of an hour to start.
 *
 * It owns no step: it runs the commands that do, in order, and stops at the first that fails.
 *
 * - **The export** is `studies/harness2/score.ts tree`, run on the host that holds the run, since a
 *   harness's programs are rebuilt from the campaign's own tree. Where that host is the benchmark's
 *   machine it writes straight into the store.
 * - **The carry** is one compressed stream through this machine, since two peers need not reach
 *   each other. It lands beside the store's trees and is moved in only once the stream ended well:
 *   `score.ts` takes a tree it finds under a label as it is, so half of one would be rolled.
 * - **The sitting** is the command `BENCH_SITTING` names on the machine `ABLATION_HOST` names, the
 *   operator's own, which owns the lock, the login and the judge. It is called as
 *   `<command> run|start <login> <label> <score.ts options>`, and its `status` answers `idle` on its
 *   first line while no arm holds the machine. A read is refused while one does, so that nothing
 *   loads a machine whose rollouts are read against each other.
 *
 * A label binds one exported tree for good, so a label the store already holds is rolled as it
 * stands, neither exported nor carried again, which is also how a read cut after its carry goes on.
 * `--as <label>` names the reference's arm and `starter-<label>` the Starter's. A run that has not
 * ended, one at rest at a pause included, names its harness with `--harness`, by the letter the
 * view prints or its digest: the export refuses to guess a reference that may still move. Without `--login`
 * the login is the one a keeper would move a run to (`roomFor`). Without `--yes` it prints the plan
 * and starts nothing; the prediction file is written from that plan, before `--yes`.
 */
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured, runTextOrThrow } from "#src/meta/subprocess.ts";
import { readControllers } from "./code.ts";
import { quoted, shellOn, shellPath, treeBun } from "./host-command.ts";
import { type Host, hostNamed } from "./host-config.ts";
import { holders } from "./hosts.ts";
import { roomFor } from "./keep.ts";
import { allowedLogins, asGathered, type Env, liveEverywhere } from "./logins.ts";
import { HERE, Misused, runs } from "./registry.ts";

/** One command of a read: what it is for, and the words that run it from this machine. */
export interface Step {
  readonly says: string;
  readonly command: readonly string[];
}

/** A read, settled before anything runs. A machine left undefined is this one. */
export interface Plan {
  readonly run: string;
  readonly label: string;
  readonly harness?: string;
  readonly login: string;
  /** The machine that holds the campaign, and the tree and Bun its export runs from. */
  readonly holder: Host | undefined;
  readonly tree: string;
  readonly bun: string;
  /** The machine that rolls the benchmark, its store and its sitting command, as shell words there. */
  readonly bench: Host | undefined;
  readonly store: string;
  readonly sitting: string;
  /** The benchmark's machine as `score.ts tree --for` names it. */
  readonly place: string;
  /** The harness the store already holds under the label, where it holds one. */
  readonly held: string | null;
}

/** `uname -sm` as `placeOf` (`studies/shared/bundle.ts`) names a machine. */
const PLACES = new Map([
  ["Linux x86_64", "linux-x64"],
  ["Linux aarch64", "linux-arm64"],
  ["Darwin arm64", "darwin-arm64"],
  ["Darwin x86_64", "darwin-x64"],
]);

/** A configured folder or command as one shell word, from the home folder where it is relative. */
const homeWord = (path: string) =>
  shellPath(path.startsWith("/") || path.startsWith("~/") ? path : `~/${path}`);

/** What the environment says of the benchmark's machine, or a refusal naming what it lacks. */
export function settingsOf(env: Env): Pick<Plan, "bench" | "store" | "sitting"> {
  const { ABLATION_HOST: name = "", BENCH_STORE: store = "", BENCH_SITTING: sitting = "" } = env;
  const missing = Object.entries({ BENCH_STORE: store, BENCH_SITTING: sitting }).flatMap(([key, value]) =>
    value === "" ? [key] : [],
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} unset: the store and the sitting command on the benchmark's machine (.env.runs.example)`,
    );
  }
  return {
    bench: name === "" || name === HERE ? undefined : hostNamed(name),
    store: homeWord(store),
    sitting: homeWord(sitting),
  };
}

/** The commands of `plan`, in order: nothing is spent before both dry runs, and nothing loads the
 *  benchmark's machine before its sitting command says it is idle. */
export function stepsOf(plan: Plan): Step[] {
  const { run, label, login, holder, bench, store, sitting } = plan;
  const starter = `starter-${label}`;
  const same = holder?.name === bench?.name;
  const stage = `"\${TMPDIR:-/tmp}"/${quoted(`ana-outside-read-${label}`)}`;
  const trees = `${store}/trees`;
  const tree = `${trees}/${quoted(label)}`;
  const part = `${trees}/${quoted(`.part-${label}`)}`;
  const reference = [
    quoted(label),
    "--arm",
    quoted(run),
    ...(plan.harness === undefined ? [] : ["--harness", quoted(plan.harness)]),
  ];
  const arm = (verb: string, words: readonly string[], last: string) =>
    `${sitting} ${verb} ${quoted(login)} ${words.join(" ")} ${last}`;
  const queued = arm("start", [quoted(starter), "--arm", "starter"], "--yes");
  const piped = (host: Host | undefined, script: string) => shellOn(host, script).map(quoted).join(" ");
  const on = (says: string, script: string): Step => ({ says, command: shellOn(bench, script) });
  const exported: Step[] =
    plan.held === null
      ? [
          {
            says: `export ${label} for ${plan.place} on ${holder?.name ?? "this machine"}`,
            command: shellOn(
              holder,
              // A stage a cut read left would be taken as the tree, so each export starts without one.
              `${same ? "" : `rm -rf ${stage} && `}cd ${shellPath(plan.tree)} && ${plan.bun} studies/harness2/score.ts tree --arm ${quoted(run)}${plan.harness === undefined ? "" : ` --harness ${quoted(plan.harness)}`} --name ${quoted(label)} --out ${same ? store : stage} --for ${quoted(plan.place)}`,
            ),
          },
          ...(same
            ? []
            : [
                {
                  says: `carry ${label} into the store on ${bench?.name ?? "this machine"}`,
                  command: [
                    "bash",
                    "-c",
                    `set -o pipefail; ${piped(holder, `COPYFILE_DISABLE=1 tar -czf - -C ${stage}/trees ${quoted(label)} ${quoted(`${label}.build.json`)}`)} | ${piped(bench, `test ! -e ${tree} && mkdir -p ${trees} && rm -rf ${part} && mkdir ${part} && tar -xzf - -C ${part} && mv ${part}/${quoted(label)} ${tree} && mv ${part}/${quoted(`${label}.build.json`)} ${trees}/ && rmdir ${part}`)}`,
                  ],
                },
                { says: "clear the export's stage", command: shellOn(holder, `rm -rf ${stage}`) },
              ]),
        ]
      : [];
  return [
    on(
      "the benchmark's machine is idle",
      `${sitting} status | head -n 1 | grep -qx idle || { echo 'an arm holds the machine: the read waits for it'; exit 1; }`,
    ),
    ...exported,
    // A reference whose own launcher starts an interpreter the machine lacks rolls without its
    // method (17 November 2026: exit 127), which no dry run sees. It is said, and refuses nothing.
    on(
      `the tree's own python3 on ${bench?.name ?? "this machine"}`,
      `p=${tree}/$(sed -n 's/.*"toolchain": *"\\([^"]*\\)".*/\\1/p' ${tree}/export.json)/bin/python3; if test -e "$p" || test -L "$p"; then "$p" -c pass; echo "the tree's own python3 exits $?"; fi`,
    ),
    on(`dry run of ${label}`, arm("run", reference, "--dry-run")),
    on(`dry run of ${starter}`, arm("run", [quoted(starter), "--arm", "starter"], "--dry-run")),
    on(`start ${label} on login ${login}`, arm("start", reference, "--yes")),
    // A waiter has no place behind an arm that does not hold the machine yet, so the Starter is
    // started once the reference does; where it never does, the reference may be rolling alone.
    on(
      `queue ${starter} behind it`,
      `n=0; while ${sitting} status | head -n 1 | grep -qx idle; do n=$((n + 1)); test "$n" -lt 30 || { echo ${quoted(`the reference did not take the machine in a minute; the Starter is queued by: ${queued}`)}; exit 1; }; sleep 2; done; ${queued}`,
    ),
  ];
}

/** Run `steps` in order with `spawn`, saying each, and refuse at the first that does not exit 0. */
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

/** The harness the store on `bench` holds under `label`, or null where it holds none. */
async function heldIn(bench: Host | undefined, store: string, label: string): Promise<string | null> {
  const { stdout, exitCode } = await runCaptured(
    shellOn(bench, `cat ${store}/trees/${quoted(label)}/export.json`),
  );
  if (exitCode !== 0) return null;
  const harness = asRecord(capturedJsonParse(stdout))?.harness;
  return isString(harness) ? harness : "";
}

/** `bun run runs outside`. */
export async function outside(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      as: { type: "string" },
      harness: { type: "string" },
      login: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const [run, ...rest] = positionals;
  const label = values.as;
  if (run === undefined || rest.length > 0 || label === undefined) throw new Misused();
  if (!isSafePathSegment(run) || !isSafePathSegment(label)) throw new Misused();
  const env = runtimeProcess.env;
  const settings = settingsOf(env);
  const here = new Set(runs().map(({ name }) => name));
  const holder = here.has(run) ? undefined : (await holders([run], here)).get(run);
  if (holder === undefined && !here.has(run)) {
    throw new Error(`${run}: no worktree here or on a host holds a campaign of that name`);
  }
  const [controller] = holder === undefined ? [] : await readControllers([holder]);
  if (holder !== undefined && (controller === null || controller === undefined)) {
    throw new Error(`${holder.name}: no controller there to export from`);
  }
  const named = (await runTextOrThrow(shellOn(settings.bench, "uname -sm"))).trim();
  const place = PLACES.get(named);
  if (place === undefined) {
    throw new Error(`the benchmark's machine is '${named}', which no export is written for`);
  }
  const held = await heldIn(settings.bench, settings.store, label);
  if (held !== null && values.harness?.length === 64 && held !== values.harness) {
    throw new Error(
      `${label}: the store holds that label for ${held.slice(0, 8)}; a label binds one tree, so name another`,
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
  const plan: Plan = {
    run,
    label,
    ...keyIfDefined("harness", values.harness),
    login,
    holder,
    tree: controller?.tree ?? runtimeProcess.cwd(),
    bun: controller === null || controller === undefined ? "bun" : treeBun(controller.bun),
    ...settings,
    place,
    held,
  };
  const steps = stepsOf(plan);
  console.log(
    `${run} read outside as ${label} and starter-${label}, on login ${login}, for ${place}${held === null ? "" : `; the store already holds ${label} (${held.slice(0, 8)}), rolled as it stands`}`,
  );
  if (!values.yes) {
    for (const { says } of steps) console.log(`  ${says}`);
    if (held === null && values.harness === undefined) {
      console.log("no --harness: the export takes the run's reference, and refuses a run that has not ended");
    }
    console.log("nothing started: write the prediction file from this plan, then pass --yes");
    return;
  }
  const io = { stdin: "ignore", stdout: "inherit", stderr: "inherit" } as const;
  await walk(steps, async (command) => await capturedSpawn([...command], io).exited);
}

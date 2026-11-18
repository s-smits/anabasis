/**
 * `bun run runs outside <run> [--bench <name>] [--as <label>] [--harness <kept>] [--login N] [--wait] [--yes]`
 *
 * One command for a run's outside read (run-improvement-campaign, "The outside aim"): the run's
 * newest promoted harness, or the kept harness `--harness` names by its letter or whole digest, is
 * written for the machine that rolls the benchmark, carried into the score store there, proved by a
 * dry run of each arm, and rolled with a fresh Starter queued behind it. Until 17 November 2026 these
 * were some ten commands on three machines, and a read took most of an hour to start.
 * `runs pause <run> --after <word> --eval` is the pause and then this read with `--wait`, once for
 * each benchmark that reads the run.
 *
 * **The benchmarks** are the list `EVAL_RUNNER` holds (`benchesOf`, `.env.runs.example`): each its
 * name, the machine that rolls it, its score store and sitting command there, and the packs whose
 * runs it reads. A run is read on the one whose packs hold its own (`packOf`), or on the one
 * `--bench` names where several do. So a second benchmark is one more entry, and its store is
 * gathered into `data/bench/<name>` (`fetchBenches`) and kept clear by `retire`.
 *
 * It owns no step: it runs the commands that do, in order, and stops at the first that fails.
 *
 * - **The export** is `studies/harness2/score.ts tree`, run on the host that holds the run, since a
 *   harness's programs are rebuilt from the campaign's own tree. Where that host is the benchmark's
 *   machine it writes straight into the store.
 * - **The carry** is one compressed stream through this machine, since two peers need not reach
 *   each other. It lands beside the store's trees and is moved in only once the stream ended well:
 *   `score.ts` takes a tree it finds under a label as it is, so half of one would be rolled.
 * - **The sitting** is the benchmark's command on its machine, the operator's own, which owns the
 *   lock, the login and the judge. It is called
 *   as `<command> run|start <login> <label> <score.ts options>`, and its `status` answers `idle` on
 *   its first line while no arm holds the machine. A read is refused while one does, so that nothing
 *   loads a machine whose rollouts are read against each other; with `--wait` it looks again every
 *   five minutes instead.
 *
 * A label binds one exported tree for good, so a label the store already holds is rolled as it
 * stands, neither exported nor carried again, which is also how a read cut after its carry goes on.
 * `--as <label>` names the reference's arm, by default the first eight characters of the harness's
 * digest, and `starter-<label>` the Starter's. Without `--harness` the harness is the one the run's
 * log, here or as last gathered, last promoted: a run at rest at a pause has not ended, and the
 * export refuses to guess a reference that may still move, so it is named by its digest. A letter
 * takes `--as`. Without `--login` the login is the one a keeper would move a run to (`roomFor`).
 * Without `--yes` it prints the plan and starts nothing; the prediction file is written from that
 * plan, before `--yes` or, behind `--eval`, before the first task is judged.
 */
import { promoted } from "#src/kernel/reports.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured, runTextOrThrow } from "#src/meta/subprocess.ts";
import { readControllers } from "./code.ts";
import { quoted, shellOn, shellPath, treeBun } from "./host-command.ts";
import { type Bench, benchesOf, type Host } from "./host-config.ts";
import { holders } from "./hosts.ts";
import { roomFor } from "./keep.ts";
import { allowedLogins, asGathered, type Env, liveEverywhere } from "./logins.ts";
import { logEvents, Misused, packOf, readNamed, runs } from "./registry.ts";

/** One command of a read: what it is for, and the words that run it from this machine. */
export interface Step {
  readonly says: string;
  readonly command: readonly string[];
}

/** A read, settled before anything runs. A machine left undefined is this one. */
export interface Plan {
  readonly run: string;
  readonly label: string;
  /** The kept harness, by its letter or digest. */
  readonly harness: string;
  readonly login: string;
  /** The machine that holds the campaign, and the tree and Bun its export runs from. */
  readonly holder: Host | undefined;
  readonly tree: string;
  readonly bun: string;
  /** The benchmark, the machine that rolls it, and its store and sitting command as shell words there. */
  readonly bench: string;
  readonly runner: Host | undefined;
  readonly store: string;
  readonly sitting: string;
  /** The benchmark's machine as `score.ts tree --for` names it. */
  readonly place: string;
  /** The harness the store already holds under the label, where it holds one. */
  readonly held: string | null;
  /** Whether the read waits for the machine to be idle instead of refusing while an arm holds it. */
  readonly wait: boolean;
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

/** The benchmarks that read `run` (`EVAL_RUNNER`), or the one `named` names. A pack listed reads
 *  itself and every pack named from it, as `jobstat` reads `jobstat-v2`. */
function benchesFor(run: string, env: Env, named?: string): Bench[] {
  const pack = packOf(run);
  const reads = ({ name, packs }: Bench) =>
    named === undefined ? packs.some((one) => pack === one || pack.startsWith(`${one}-`)) : name === named;
  return benchesOf(env).filter(reads);
}

/** The one benchmark a read of `run` rolls, as the plan holds it, or a refusal naming the choice. */
export function settingsOf(
  run: string,
  env: Env,
  named?: string,
): Pick<Plan, "bench" | "runner" | "store" | "sitting"> {
  const benches = benchesFor(run, env, named);
  const [bench] = benches;
  if (benches.length > 1) {
    throw new Error(`${run}: ${benches.map(({ name }) => name).join(", ")} read it; name one with --bench`);
  }
  if (bench === undefined) {
    const which = named === undefined ? `reads pack ${packOf(run)}` : `is named ${named}`;
    throw new Error(`${run}: no benchmark ${which} (EVAL_RUNNER, .env.runs.example)`);
  }
  return {
    bench: bench.name,
    runner: bench.host,
    store: homeWord(bench.store),
    sitting: homeWord(bench.sitting),
  };
}

/** The harness `run` last promoted, by its digest, from its log here or the gathered copy of it. */
function newestPromoted(run: string): string {
  const harness = promoted(logEvents(readNamed(run).path));
  if (harness === null) throw new Error(`${run} has promoted no harness: there is nothing to read outside`);
  return harness;
}

/** The commands of `plan`, in order: nothing is spent before both dry runs, and nothing loads the
 *  benchmark's machine before its sitting command says it is idle. */
export function stepsOf(plan: Plan): Step[] {
  const { run, label, login, holder, runner, store, sitting } = plan;
  const starter = `starter-${label}`;
  const same = holder?.name === runner?.name;
  const stage = `"\${TMPDIR:-/tmp}"/${quoted(`ana-outside-read-${label}`)}`;
  const trees = `${store}/trees`;
  const tree = `${trees}/${quoted(label)}`;
  const part = `${trees}/${quoted(`.part-${label}`)}`;
  const reference = [quoted(label), "--arm", quoted(run), "--harness", quoted(plan.harness)];
  const arm = (verb: string, words: readonly string[], last: string) =>
    `${sitting} ${verb} ${quoted(login)} ${words.join(" ")} ${last}`;
  const bare = [quoted(starter), "--arm", "starter"];
  const queued = arm("start", bare, "--yes");
  const piped = (host: Host | undefined, script: string) => shellOn(host, script).map(quoted).join(" ");
  const on = (says: string, script: string): Step => ({ says, command: shellOn(runner, script) });
  const exported: Step[] =
    plan.held === null
      ? [
          {
            says: `export ${label} for ${plan.place} on ${holder?.name ?? "this machine"}`,
            command: shellOn(
              holder,
              // A stage a cut read left would be taken as the tree, so each export starts without one.
              `${same ? "" : `rm -rf ${stage} && `}cd ${shellPath(plan.tree)} && ${plan.bun} studies/harness2/score.ts tree --arm ${quoted(run)} --harness ${quoted(plan.harness)} --name ${quoted(label)} --out ${same ? store : stage} --for ${quoted(plan.place)}`,
            ),
          },
          ...(same
            ? []
            : [
                {
                  says: `carry ${label} into the store on ${runner?.name ?? "this machine"}`,
                  command: [
                    "bash",
                    "-c",
                    `set -o pipefail; ${piped(holder, `COPYFILE_DISABLE=1 tar -czf - -C ${stage}/trees ${quoted(label)} ${quoted(`${label}.build.json`)}`)} | ${piped(runner, `test ! -e ${tree} && mkdir -p ${trees} && rm -rf ${part} && mkdir ${part} && tar -xzf - -C ${part} && mv ${part}/${quoted(label)} ${tree} && mv ${part}/${quoted(`${label}.build.json`)} ${trees}/ && rmdir ${part}`)}`,
                  ],
                },
                { says: "clear the export's stage", command: shellOn(holder, `rm -rf ${stage}`) },
              ]),
        ]
      : [];
  const idle = `${sitting} status | head -n 1 | grep -qx idle`;
  return [
    plan.wait
      ? on("wait until the benchmark's machine is idle", `until ${idle}; do sleep 300; done`)
      : on(
          "the benchmark's machine is idle",
          `${idle} || { echo 'an arm holds the machine: the read waits for it'; exit 1; }`,
        ),
    ...exported,
    // A reference whose own launcher starts an interpreter the machine lacks rolls without its
    // method (17 November 2026: exit 127), which no dry run sees. It is said, and refuses nothing.
    on(
      `the tree's own python3 on ${runner?.name ?? "this machine"}`,
      `p=${tree}/$(sed -n 's/.*"toolchain": *"\\([^"]*\\)".*/\\1/p' ${tree}/export.json)/bin/python3; if test -e "$p" || test -L "$p"; then "$p" -c pass; echo "the tree's own python3 exits $?"; fi`,
    ),
    on(`dry run of ${label}`, arm("run", reference, "--dry-run")),
    on(`dry run of ${starter}`, arm("run", bare, "--dry-run")),
    on(`start ${label} on login ${login}`, arm("start", reference, "--yes")),
    // A waiter has no place behind an arm that does not hold the machine yet, so the Starter is
    // started once the reference does; where it never does, the reference may be rolling alone.
    on(
      `queue ${starter} behind it`,
      `n=0; while ${idle}; do n=$((n + 1)); test "$n" -lt 30 || { echo ${quoted(`the reference did not take the machine in a minute; the Starter is queued by: ${queued}`)}; exit 1; }; sleep 2; done; ${queued}`,
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

/** Each label the store on `bench` holds a tree under, with the harness its export names. */
async function heldIn(bench: Host | undefined, store: string): Promise<Map<string, string>> {
  const { stdout } = await runCaptured(shellOn(bench, `grep -H '"harness"' ${store}/trees/*/export.json`));
  const rows = [...stdout.matchAll(/\/trees\/([^/\n]+)\/export\.json:\s*"harness":\s*"([^"]*)"/gu)];
  return new Map(rows.map(([, label = "", harness = ""]) => [label, harness]));
}

/** The other labels the store holds `harness` under, where `--as` named none and `label` is the one
 *  defaulted from its digest: a harness is read once unless `--as` names another read of it. */
export function readAs(held: ReadonlyMap<string, string>, harness: string, label: string, as?: string) {
  if (as !== undefined) return [];
  return [...held].filter(([one, of]) => of === harness && one !== label).map(([one]) => one);
}

/** The benchmarks `pause --eval` reads `run` on, named as the verb is armed, so that a setting that
 *  refuses does so while the pause-at-two hook still reads the verb's end, not hours later. */
export function readsArmed(run: string, env = runtimeProcess.env): string[] {
  const names = benchesFor(run, env).map(({ name }) => name);
  if (names.length === 0) {
    console.log(`${run}: no benchmark reads pack ${packOf(run)}; the pause goes on alone`);
  }
  return names;
}

/** `pause --eval` once the pause landed: each read with `--wait`, its plan alone without `--yes`.
 *  Started, each read is a process of its own, since one that waits for an idle machine would
 *  otherwise keep the pause alive, and a living pause is the run's one waiter (`waiters`), which
 *  refuses the next `continue`. */
export async function readAfterPause(
  run: string,
  benches: readonly string[],
  mode: "plan" | "start",
): Promise<void> {
  for (const bench of benches) {
    const words = [run, "--bench", bench, "--wait"];
    if (mode === "plan") {
      await outside(words);
      continue;
    }
    const command = [capturedExecPath, join(import.meta.dir, "cli.ts"), "outside", ...words, "--yes"];
    const child = capturedSpawn(command, {
      detached: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    child.unref();
    console.log(`${run}: its read on ${bench} goes on in process ${String(child.pid)}`);
  }
}

/** `bun run runs outside`. */
export async function outside(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      as: { type: "string" },
      bench: { type: "string" },
      harness: { type: "string" },
      login: { type: "string" },
      wait: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [run, ...rest] = positionals;
  if (run === undefined || rest.length > 0 || !isSafePathSegment(run)) throw new Misused();
  const env = runtimeProcess.env;
  const settings = settingsOf(run, env, values.bench);
  // A letter names a harness only beside the view that prints it, so it takes a label of its own.
  const harness = values.harness ?? newestPromoted(run);
  const digest = harness.length === 64;
  const label = values.as ?? (digest ? harness.slice(0, 8) : undefined);
  if (label === undefined || !isSafePathSegment(label)) throw new Misused();
  const here = new Set(runs().map(({ name }) => name));
  const holder = here.has(run) ? undefined : (await holders([run], here)).get(run);
  if (holder === undefined && !here.has(run)) {
    throw new Error(`${run}: no worktree here or on a host holds a campaign of that name`);
  }
  const [controller] = holder === undefined ? [] : await readControllers([holder]);
  if (holder !== undefined && (controller === null || controller === undefined)) {
    throw new Error(`${holder.name}: no controller there to export from`);
  }
  const named = (await runTextOrThrow(shellOn(settings.runner, "uname -sm"))).trim();
  const place = PLACES.get(named);
  if (place === undefined) {
    throw new Error(`the benchmark's machine is '${named}', which no export is written for`);
  }
  const trees = await heldIn(settings.runner, settings.store);
  const before = readAs(trees, harness, label, values.as);
  if (before.length > 0) {
    console.log(
      `${run}: ${harness.slice(0, 8)} is read already as ${before.join(", ")}; --as reads it again`,
    );
    return;
  }
  const held = trees.get(label) ?? null;
  if (held !== null && digest && held !== harness) {
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
    harness,
    login,
    holder,
    tree: controller?.tree ?? runtimeProcess.cwd(),
    bun: controller === null || controller === undefined ? "bun" : treeBun(controller.bun),
    ...settings,
    place,
    held,
    wait: values.wait,
  };
  const steps = stepsOf(plan);
  console.log(
    `${run} read outside on ${plan.bench} as ${label} and starter-${label}, on login ${login}, for ${place}${held === null ? "" : `; the store already holds ${label} (${held.slice(0, 8)}), rolled as it stands`}`,
  );
  if (!values.yes) {
    for (const { says } of steps) console.log(`  ${says}`);
    console.log("nothing started: write the prediction file from this plan, then pass --yes");
    return;
  }
  const io = { stdin: "ignore", stdout: "inherit", stderr: "inherit" } as const;
  await walk(steps, async (command) => await capturedSpawn([...command], io).exited);
}

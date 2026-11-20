/**
 * `bun run runs outside <run> [--bench <name>] [--as <label>] [--harness <kept>] [--login N] [--wait] [--yes]`
 *
 * One command for a run's outside read (run-improvement-campaign, "The outside aim"): the run's
 * newest promoted harness, or the kept harness `--harness` names by its letter or whole digest, is
 * written for the machine that rolls the benchmark, carried into the score store there, proved by a
 * dry run of each arm, and rolled with a fresh Starter behind it. `runs pause <run> --after <word>
 * --eval` is the pause and then this read with `--wait`, once for each benchmark that reads the run.
 *
 * **The benchmarks** are the list `EVAL_RUNNER` holds (`benchesOf`, `.env.runs.example`): each its
 * name, the machine that rolls it, its score store and sitting command there, and the packs whose
 * runs it reads. A run is read on the one whose packs hold its own, or on the one `--bench` names
 * where several do.
 *
 * It owns no step: it runs the commands that do, in order, and stops at the first that fails.
 *
 * - **The export** is `studies/harness2/score.ts tree`, run on the machine that holds the campaign,
 *   since a harness's programs are rebuilt from the campaign's own tree.
 * - **The carry** is one compressed stream through this machine, since two peers need not reach
 *   each other (`sealed`, `opened`).
 * - **The sitting** is the benchmark's command on its machine, the operator's own, which owns the
 *   lock, the login and the judge. It is called as `<command> run <login> <label> <score.ts
 *   options>`; `status` answers `idle` on its first line while no arm holds the machine, and
 *   `python` the minor of the `python3` a rollout there finds first. A read is refused while an arm
 *   holds the machine, so that nothing loads one whose rollouts are read against each other; with
 *   `--wait` it looks again every five minutes instead. The dry runs refuse a tree whose own
 *   `python3` cannot start there (`ownPython`).
 *
 * A label binds one exported tree for good, so a label the store already holds is rolled as it
 * stands, neither exported nor carried again, which is also how a read cut after its carry goes on.
 * `--as <label>` names the reference's arm, by default the first eight characters of the harness's
 * digest, and `starter-<label>` the Starter's; a letter takes `--as`. Without `--harness` the harness
 * is the one the run's log, here or as last gathered, last promoted. Without `--login` the login is
 * the one a keeper would move a run to (`roomFor`). Without `--yes` it prints the plan and starts
 * nothing; the prediction file is written from that plan.
 */
import { promoted } from "#src/kernel/reports.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runTextOrThrow } from "#src/meta/subprocess.ts";
import { readControllers } from "./code.ts";
import { homeWord, quoted, shellOn, shellPath, sittingIdle, treeBun } from "./host-command.ts";
import { type Bench, benchesOf, type Host } from "./host-config.ts";
import { holders, namedIn } from "./hosts.ts";
import { roomFor } from "./keep.ts";
import { allowedLogins, asGathered, type Env, liveEverywhere } from "./logins.ts";
import { logEvents, Misused, packOf, readNamed, runs } from "./registry.ts";

/** One command of a read: what it is for, and the words that run it from this machine. */
interface Step {
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
  /** The minor of the `python3` a rollout there finds first, as its sitting's `python` says it. */
  readonly python: string;
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

/** The program that writes and checks SHA-256 sums, in one format: coreutils' where a machine has
 *  it, as a Linux one without Perl has no other, and Perl's elsewhere. */
const SUMS = "$(command -v sha256sum || echo shasum -a 256)";

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

/** The holder's half of the carry, from the export's `trees` folder: each file's SHA-256, then the tree,
 *  its build record and the sums as one stream, without a Mac's extended attributes or Finder files.
 *  The sums are the check, since bsdtar extracts a gzip stream without reading its CRC. */
export const sealed = (from: string, label: string) =>
  `cd ${from} && find ${quoted(label)} ${quoted(`${label}.build.json`)} -type f ! -name .DS_Store -exec ${SUMS} {} + > ${quoted(`${label}.sha256`)} && COPYFILE_DISABLE=1 tar -czf - --no-xattrs --exclude .DS_Store ${quoted(label)} ${quoted(`${label}.build.json`)} ${quoted(`${label}.sha256`)}`;

/** The benchmark machine's half: the stream lands beside the store's trees and is moved in only once
 *  every file matches its sum and no link points at an absolute path, which on another machine
 *  names the build machine's files; never over a tree in place, since `score.ts` takes a tree it
 *  finds under a label as it is. */
export function opened(trees: string, label: string): string {
  const tree = `${trees}/${quoted(label)}`;
  const part = `${trees}/${quoted(`.part-${label}`)}`;
  return `test ! -e ${tree} && mkdir -p ${trees} && rm -rf ${part} && mkdir ${part} && tar -xzf - -C ${part} && (cd ${part} && ${SUMS} -c --quiet ${quoted(`${label}.sha256`)}) && links=$(find ${part} -type l -lname '/*') && { test -z "$links" || { echo "links to absolute paths: $links" >&2; false; }; } && rm ${part}/${quoted(`${label}.sha256`)} && mv ${part}/${quoted(label)} ${tree} && mv ${part}/${quoted(`${label}.build.json`)} ${trees}/ && rmdir ${part}`;
}

/** The commands of `plan`, in order: nothing is spent before both dry runs, and nothing loads the
 *  benchmark's machine before its sitting command says it is idle. */
export function stepsOf(plan: Plan): Step[] {
  const { run, label, login, holder, runner, sitting } = plan;
  const starter = `starter-${label}`;
  const stage = `"\${TMPDIR:-/tmp}"/${quoted(`ana-outside-read-${label}`)}`;
  const on = (says: string, script: string): Step => ({ says, command: shellOn(runner, script) });
  const piped = (host: Host | undefined, script: string) => shellOn(host, script).map(quoted).join(" ");
  const reference = `${sitting} run ${quoted(login)} ${quoted(label)} --arm ${quoted(run)} --harness ${quoted(plan.harness)}`;
  const bare = `${sitting} run ${quoted(login)} ${quoted(starter)} --arm starter`;
  const idle = sittingIdle(sitting);
  const rolled = `${plan.store}/rolled-${label}.log`;
  const exported: Step[] = [
    {
      says: `export ${label} for ${plan.place} on ${holder?.name ?? "this machine"}`,
      // A stage a cut read left would be taken as the tree, so each export starts without one.
      command: shellOn(
        holder,
        `rm -rf ${stage} && cd ${shellPath(plan.tree)} && ${plan.bun} studies/harness2/score.ts tree --arm ${quoted(run)} --harness ${quoted(plan.harness)} --name ${quoted(label)} --out ${stage} --for ${quoted(plan.place)} --python ${quoted(plan.python)}`,
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
    on(`dry run of ${starter}`, `${bare} --dry-run`),
    // One process of their own rolls the arms in turn, so the Starter waits behind the reference on
    // the sitting's lock and the read waits for neither. What they print is kept beside the store's
    // records: until 19 November 2026 it went nowhere, and an arm that never started said nothing.
    on(
      `roll ${label}, then ${starter}, on login ${login}`,
      `nohup sh -c ${quoted(`${reference} --yes; ${bare} --yes`)} >> ${rolled} 2>&1 < /dev/null & echo "rolling in process $!, which writes ${rolled}; the sitting's status names the arm"`,
    ),
  ];
}

/** What the benchmark's machine says of itself before a plan: its platform, the minor of the
 *  sitting's interpreter, then each tree's harness. A machine or a sitting that does not answer ends
 *  the probe with its own exit: until 19 November 2026 a closing `true` passed that silence on, and
 *  the next line stood in for the minor an export builds for. A store with no tree yet is no fault. */
export const probed = ({ sitting, store }: Pick<Plan, "sitting" | "store">): string =>
  `uname -sm && ${sitting} python || exit; grep -H '"harness"' ${store}/trees/*/export.json; true`;

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

/** What the store holds of this read: the labels it read `harness` under already, where `--as`
 *  names no other read, and the harness `label` binds. A label binds one tree, so one the store holds
 *  for another digest refuses; a letter is no digest to set against it. */
export function heldAs(
  store: ReadonlyMap<string, string>,
  harness: string,
  label: string,
  as?: string,
): { again: string[]; held: string | null } {
  const held = store.get(label) ?? null;
  if (held !== null && harness.length === 64 && held !== harness) {
    throw new Error(
      `${label}: the store holds that label for ${held.slice(0, 8)}; a label binds one tree, so name another`,
    );
  }
  const again = as === undefined ? [...store].filter(([one, of]) => of === harness && one !== label) : [];
  return { again: again.map(([one]) => one), held };
}

/** `pause ... --eval`: the words the pause runs on, and the reads it owes once it lands, one a
 *  benchmark of the run, each waiting for its machine. They are named as the verb is armed, so that
 *  a list that refuses does so while the pause-at-two hook still reads the verb's end. */
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

/** Each read `evalOf` owed, once the pause landed. A plan is printed here; a read started is a
 *  process of its own, since one that waits for an idle machine would otherwise keep the pause
 *  alive, and a living pause is the run's one waiter (`waiters`), which refuses the next `continue`. */
export async function readEach(reads: readonly (readonly string[])[]): Promise<void> {
  for (const words of reads) {
    if (!words.includes("--yes")) {
      await outside(words);
      continue;
    }
    const command = [capturedExecPath, join(import.meta.dir, "cli.ts"), "outside", ...words];
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

/** Where `run`'s export runs: the machine that holds the campaign, and the tree and Bun there. */
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

/** The read `values` ask of `run`, or null where the store has read its harness under another label. */
async function planOf(
  run: string,
  values: { as?: string; bench?: string; harness?: string; login?: string; wait: boolean },
): Promise<Plan | null> {
  const env = runtimeProcess.env;
  const settings = settingsOf(run, env, values.bench);
  const harness = values.harness ?? promoted(logEvents(readNamed(run).path));
  if (harness === null) throw new Error(`${run} has promoted no harness: there is nothing to read outside`);
  // A letter names a harness only beside the view that prints it, so it takes a label of its own.
  const label = values.as ?? (harness.length === 64 ? harness.slice(0, 8) : "");
  if (!isSafePathSegment(label)) throw new Misused();
  const said = await runTextOrThrow(shellOn(settings.runner, probed(settings)));
  const [named = "", python = ""] = said.split("\n");
  const place = PLACES.get(named);
  if (place === undefined) {
    throw new Error(`the benchmark's machine is '${named}', which no export is written for`);
  }
  const rows = said.matchAll(/\/trees\/([^/\n]+)\/export\.json:\s*"harness":\s*"([^"]*)"/gu);
  const { again, held } = heldAs(
    new Map([...rows].map(([, one = "", of = ""]) => [one, of])),
    harness,
    label,
    values.as,
  );
  if (again.length > 0) {
    console.log(`${run}: ${harness.slice(0, 8)} is read already as ${again.join(", ")}; --as reads it again`);
    return null;
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
  return { run, label, harness, login, ...exporter, ...settings, place, python, held, wait: values.wait };
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
  const plan = await planOf(run, values);
  if (plan === null) return;
  const { label, held } = plan;
  console.log(
    `${run} read outside on ${plan.bench} as ${label} and starter-${label}, on login ${plan.login}, for ${plan.place} (python3 ${plan.python})${held === null ? "" : `; the store holds ${label} already, rolled as it stands`}`,
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

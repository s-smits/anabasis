/**
 * What a run keeps of its start beside the campaign's log, `launch-<session>.json`: flags, commit,
 * whether the tree was dirty, load, Bun, login and Python. The log names the host's code by
 * content, not commit, so this is where a run's commit is on record, and its flags are what
 * `bun run runs continue` runs again on. The campaign command keeps one a run as `launch-run-<n>.json`
 * (`keepReceipt`, `tools/d2/harness-builder.ts`); an older campaign may hold one per round or
 * session. `nextRun` numbers the next run.
 *
 *   bun run runs source <name> [--holds <commit>]... [--has <text>]...
 *   bun run runs source (--holds <commit> | --has <text>)...
 *
 * `source` says each run's commit, whether its tree was clean, its load, where the commit is
 * published and whether it holds a named fix; it prints no flag or path a receipt holds. Without a
 * name it lists every campaign whose every launch carries what is asked (`ranWith`), as `runs
 * replay` does. A fix is asked for by its commit (`--holds`) or by text its code holds (`--has`, in
 * `src`, `tools` and `packages`), which survives a restack that rewrites the fix's commits. More
 * than one name is refused, since the first would silently discard the others.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { compareCodeUnits, hashJsonValue } from "#src/meta/stable-json.ts";
import { parseArgs } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { toolchainPathDirs } from "#src/wall/policy.ts";
import { isCampaign, Misused, type Run } from "./registry.ts";
import { readAcross, readableAcross } from "./snapshots.ts";

interface Asked {
  readonly holds: readonly string[];
  readonly has: readonly string[];
}

export interface Receipt {
  readonly at: string;
  readonly pid: number;
  readonly flags: readonly string[];
  /** The env file's path, which an older launcher kept; null now. */
  readonly envFile: string | null;
  readonly commit: string;
  readonly dirty: boolean;
  readonly load: number;
  readonly cores: number;
  /** The Bun that ran it, absent in older receipts, so that a global Bun under another pin shows. */
  readonly bun?: string;
  /** The login it ran as (`runs launch --login`), absent in older receipts and where none was named. */
  readonly login?: string;
  /** What `python3` a solve would find (`hostPython`), absent in older receipts and null where no
   *  `python3` on the wall's path answered. */
  readonly python?: HostPython | null;
}

export interface HostPython {
  readonly version: string;
  readonly packages: readonly string[];
}

const RECEIPT = /^launch-(.+)\.json$/;
/** How many refs `source` names for one commit before it counts the rest. */
const SHOWN = 3;
/** A flag value longer than this is a sentence, such as a prompt, and `source` only names it. */
const SHOWN_CHARS = 40;

/** Where `--has` looks: the code a run executes, not the documents that name a mechanism before it
 *  is built. */
const CODE = ["src", "tools", "packages"];
/**
 * Prints a Python's version and packages. Run with `-I`: a solve's home is its own, so the user's
 * site packages and `PYTHONPATH` of the shell that launched a run are none of what a solve finds.
 * Each name appears once, and where stale `dist-info` folders give it several versions, the version is
 * the imported module's own, since a receipt that named a package twice, at a version an import does
 * not find, would give requirements that cannot be satisfied.
 * Only a name with several folders is imported, since an import runs that package's code.
 */
export const PYTHON_PROBE = `import importlib, importlib.metadata as m, json, re, sys
found = {}
for d in m.distributions():
    try: name, version = d.metadata["Name"], d.version
    except Exception: continue
    if name: found.setdefault(re.sub("[-_.]+", "-", name).lower(), []).append((name, version))
def named(many):
    name, version = many[0]
    if len(many) > 1:
        try: version = importlib.import_module(name.replace("-", "_")).__version__
        except Exception: pass
    return name + "==" + version
print(json.dumps([sys.version.split()[0], [named(many) for many in found.values()]]))`;
const PYTHON_SECONDS = 10;
const runOf = (session: string) => Number(/^run-(\d+)$/.exec(session)?.[1] ?? 0);

/** What the first `python3` among `dirs` is and holds, or null where none answers. A launch goes on
 *  either way: this is a fact for reading. */
export function hostPython(dirs: readonly string[] = toolchainPathDirs()): HostPython | null {
  const path = dirs.map((dir) => join(dir, "python3")).find((file) => existsSync(file));
  if (path === undefined) return null;
  const { exitCode, stdout } = runSync([path, "-I", "-c", PYTHON_PROBE], {
    timeout: PYTHON_SECONDS * 1000,
  });
  return exitCode === 0 ? pythonIn(decodeOutput(stdout)) : null;
}

/** What `PYTHON_PROBE` printed, or null, since a program named python3 may print something else. */
export function pythonIn(said: string): HostPython | null {
  try {
    const [version, packages] = parseJsonAs<[string, string[]]>(said);
    return { version, packages: packages.toSorted(compareCodeUnits) };
  } catch {
    return null;
  }
}

function flagsOf({ flags }: Receipt): Map<string, string | true> {
  const named = new Map<string, string | true>();
  for (const [at, word] of flags.entries()) {
    if (!word.startsWith("-")) continue;
    const [name = word, inline] = word.split(/=(.*)/su);
    const next = flags[at + 1];
    named.set(name, inline ?? (next === undefined || next.startsWith("-") ? true : next));
  }
  return named;
}

/** A flag's value as `source` may print it: never a path, an env file's name, a login or a text
 *  longer than a word or two. */
function shown(name: string, value: string | true): string {
  if (value === true) return "";
  const hidden = /env|login/u.test(name) || /[/~\\\s]|^\./u.test(value) || value.length > SHOWN_CHARS;
  return hidden ? " (not shown)" : ` ${value}`;
}

/**
 * The line `source` prints of how a launch's flags and login differ from the launch before, or the
 * first launch's flag names.
 */
function flagLines(launch: Receipt, before: Receipt | undefined): string[] {
  const now = flagsOf(launch);
  if (before === undefined) return [`  flags ${[...now.keys()].join(" ") || "none"}`];
  const was = flagsOf(before);
  const moved = [
    ...[...now].flatMap(([name, value]) => {
      if (!was.has(name)) return [`added ${name}${shown(name, value)}`];
      return was.get(name) === value ? [] : [`${name}${shown(name, value) || " now bare"} (changed)`];
    }),
    ...[...was.keys()].filter((name) => !now.has(name)).map((name) => `dropped ${name}`),
  ];
  const login = launch.login === before.login ? "same login" : "login changed";
  return [`  ${login}; flags ${moved.length === 0 ? "as before" : moved.join(", ")}`];
}

/** The line `source` prints of a launch's Python: its packages by count and short digest, enough to
 *  tell two launches apart. */
function pythonLines({ python }: Receipt): string[] {
  if (python === undefined) return [];
  if (python === null) return ["  no python3 answered on the wall's path"];
  const { version, packages } = python;
  return [`  python ${version}, ${String(packages.length)} packages ${hashJsonValue(packages).slice(0, 8)}`];
}

export function writeReceipt(log: string, session: string, receipt: Receipt): void {
  writeFileSync(join(dirname(log), `launch-${session}.json`), `${capturedJsonStringify(receipt, null, 2)}\n`);
}

/** Every receipt beside `log`, oldest first, with its session; none for a campaign started by hand
 *  or not yet started. Two runs started in one millisecond are ordered by the number `nextRun` gave
 *  them. */
export function receipts(log: string): (Receipt & { readonly session: string })[] {
  const folder = dirname(log);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .flatMap((file) => {
      const session = RECEIPT.exec(file)?.[1];
      if (session === undefined) return [];
      return [{ ...parseJsonAs<Receipt>(readFileSync(join(folder, file), "utf8")), session }];
    })
    .toSorted(
      (one, other) => compareCodeUnits(one.at, other.at) || runOf(one.session) - runOf(other.session),
    );
}

export const lastLaunch = (log: string) =>
  receipts(log).findLast(({ session }) => session.startsWith("run-"));

/** Whether `run` is a seed no launch went on from: a rehearsal's copy, whose record is its
 *  source's. A seed copies no receipt (`seed.ts`), so one a launch continued is a run like any
 *  other. */
export const unlaunchedSeed = (run: Pick<Run, "path" | "seed">): boolean =>
  run.seed === true && lastLaunch(run.path) === undefined;

export function nextRun(log: string): string {
  const kept = receipts(log).filter(({ session }) => session.startsWith("run-")).length;
  return `run-${String(kept + 1)}`;
}

export function sources(log: string, repo: string, fixes: readonly string[]): string[] {
  const launches = receipts(log);
  if (launches.length === 0) {
    return ["no launch receipt: every round here was started by hand, and its commit is on no record"];
  }
  return launches.flatMap((launch, at) => {
    // The remote branches and tags that hold the commit: where an outside reader can open it, and a
    // run's tag keeps it after its branch is rewritten.
    const refs = ["--format=%(refname:lstrip=2)", "refs/remotes", "refs/tags"];
    const branches = (gitMaybe(repo, "for-each-ref", "--contains", launch.commit, ...refs) ?? "")
      .split("\n")
      .filter((line) => line !== "" && !line.endsWith("/HEAD"));
    const more = branches.length > SHOWN ? ` and ${String(branches.length - SHOWN)} more` : "";
    const published =
      branches.length === 0 ? "on no remote branch" : `on ${branches.slice(0, SHOWN).join(", ")}${more}`;
    return [
      `${launch.session}  ${launch.at}  ${launch.commit.slice(0, 9)}  ${launch.dirty ? "with uncommitted changes" : "clean"}  load ${launch.load.toFixed(1)} on ${String(launch.cores)} cores  bun ${launch.bun ?? "unknown"}`,
      `  published ${published}`,
      ...flagLines(launch, launches[at - 1]),
      ...pythonLines(launch),
      // Whether the commit holds the fix among its ancestors: false where either commit is unknown
      // here, which is why a restacked fix is asked for by its replayed commit.
      ...fixes.map(
        (fix) =>
          `  ${gitMaybe(repo, "merge-base", "--is-ancestor", fix, launch.commit) === null ? "does not hold" : "holds"} ${fix.slice(0, 9)}`,
      ),
    ];
  });
}

/** Whether every launch of the campaign at `log` ran with what `asked` names: false for a campaign
 *  with no receipt and for a commit unknown here. */
export function ranWith(log: string, repo: string, asked: Asked): boolean {
  const launches = receipts(log);
  return (
    launches.length > 0 &&
    launches.every(
      ({ commit }) =>
        asked.holds.every((fix) => gitMaybe(repo, "merge-base", "--is-ancestor", fix, commit) !== null) &&
        asked.has.every(
          (text) => gitMaybe(repo, "grep", "-q", "-F", "-e", text, commit, "--", ...CODE) !== null,
        ),
    )
  );
}

/** The `--holds` and `--has` flags `source` and `replay` read, with their other arguments. */
export function askedIn(args: readonly string[]): { asked: Asked; names: string[] } {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      holds: { type: "string", multiple: true, default: [] },
      has: { type: "string", multiple: true, default: [] },
    },
  });
  return { asked: values, names: positionals };
}

export async function source(args: readonly string[]): Promise<void> {
  const { asked, names } = askedIn(args);
  if (names.length > 1) throw new Error("source takes at most one run name");
  const asks = asked.holds.length + asked.has.length > 0;
  const [name] = names;
  if (name !== undefined) {
    const run = await readAcross(name);
    if (!asks || ranWith(run.path, run.tree, asked)) {
      console.log(sources(run.path, run.tree, asked.holds).join("\n"));
    }
    return;
  }
  if (!asks) throw new Misused();
  for (const run of (await readableAcross()).filter(
    (one) => isCampaign(one) && ranWith(one.path, one.tree, asked),
  )) {
    console.log(run.name);
  }
}

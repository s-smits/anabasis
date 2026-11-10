/**
 * A zip of recorded runs for handover: v1's zip-run skill, on v2's records. A run is its log, so every
 * level holds each chosen run's whole log, and a level adds what the log names by digest only.
 *
 *   bun run runs zip [<name> ...] --light|--medium|--verbose [--out FILE] [--max-mb N] [--note FILE]
 *                    [--from HOST] [--latest N] [--minPromotions N] [--minTime 2h]
 *                    [--since WHEN] [--until WHEN]
 *
 *   light    the log and each launch's receipt and output, each harness a session kept
 *            (`states/<digest>/`) and the brief
 *   medium   and the checker (`checks/`, and the copy a harness holds when its Builder was given
 *            one) and the toolchain's own files (`states/tree-*`)
 *   verbose  and whatever else the run's folder holds, and the source each worktree ran at its commit
 *
 * With no names, every run log in the repository's worktrees, as the pulse finds them. In the zip a
 * run sits under `<worktree>/<name>/`, beside a README.md of what the level holds, a GUIDE.md of how
 * to read it (`zip-guide.md`), `--note` as NOTES.md and a MANIFEST.json of every file with its size
 * and group, the commit each run's starts ran at (its receipts, `receipt.ts`) beside the one its
 * worktree stands at when zipped, its last reading and its ending, and what was left where it was.
 * Until 10 October the README gave the worktree's commit as the run's, and the last comparison's
 * reading as its ending: the five test-host campaigns zipped on 9 October ran at four commits and
 * were all given one. Light is refused over
 * 2 MB a run, any level over `--max-mb`. Unnamed, the zip is `<names>-<level>.zip` where the command
 * runs.
 *
 * `--latest N`, `--minPromotions N` and `--minTime 2h` choose the runs instead of naming them
 * (`newest`): campaigns on any host, seeds and live solves left out, with at least that many
 * `harness.promoted` events and at least that long from the first event to the last (`s`, `m`, `h`
 * or `d`), the N whose last event is newest. `--since` and `--until` keep the campaigns whose record
 * overlaps that window, so a run live during it counts although it began earlier; a time is a date
 * (`2026-11-06`, UTC), a date with a time and a zone (`2026-11-06T12:00Z`) or how long ago (`36h`).
 * Names given beside them narrow the candidates. The choice is made on each campaign's record and
 * only the chosen come whole (`pickedAcross`).
 *
 * Never held: installed packages, caches and built bundles, a link out of the run's folder, a file
 * named like a secret. A relative link inside it is held as a link, in the group of what it names:
 * a kept state's `.toolchain` names its `../tree-*`, and on 19 October a medium zip of r3 lost all
 * eight, so two investigation lanes matched each harness to its programs by digest by hand.
 *
 * A log is held to its last whole line, since a live run's may end in the append it is writing. An
 * exam a campaign drafted is its brief and its checker as `checks/` is a stored pack's: until
 * 19 October the groups named `checks/` alone, and a drafted exam's `exams/<digest>/` went to
 * verbose's rest. `--from` makes the zip on a host `ANA_HOSTS` names, by that host's reading of its
 * own runs, and brings the zip back to `--out`: on 19 October three live campaigns on two other
 * hosts were wanted here for an investigation, and the files a level holds are chosen in one place.
 */
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { gitText } from "#src/meta/git.ts";
import { parseArgs } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { receipts } from "./receipt.ts";
import { hostNamed } from "./host-config.ts";
import { rsync, sideOf, sshScript } from "./host-command.ts";
import { verbOn } from "./hosts.ts";
import { HERE, isCampaign, logEvents, readable, type Run, standing, wholeLines } from "./registry.ts";
import { readableAcross, syncRuns } from "./snapshots.ts";

const LEVELS = ["light", "medium", "verbose"] as const;
const CAMPAIGN_ENDED = "campaign.ended";
const PROMOTED = "harness.promoted";
const CHOOSING = ["latest", "minPromotions", "minTime", "since", "until"] as const;
const MOMENT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const AGO = /^\d+(?:\.\d+)?[smhd]$/;
const SECONDS = new Map([
  ["s", 1],
  ["m", 60],
  ["h", 3600],
  ["d", 86_400],
]);
type Level = (typeof LEVELS)[number];

/** What `--latest`, `--minPromotions`, `--minTime`, `--since` and `--until` ask of a run. */
interface Choice {
  /** At most this many, the newest first; null for every run that passes. */
  readonly latest: number | null;
  /** At least this many `harness.promoted` events in its log. */
  readonly promotions: number;
  /** At least this long from its first event to its last, in seconds. */
  readonly seconds: number;
  /** Its last event is no earlier than this, in milliseconds since the epoch. */
  readonly since: number;
  /** Its first event is no later than this, in milliseconds since the epoch. */
  readonly until: number;
}

/** A run folder's groups, the first match first, each with the level that starts to hold it. A
 *  harness's `correctness-model/` is the checker wherever it lies: six of the twenty runs zipped on
 *  2026-10-08 kept one, and it was 5.4 of the 6.3 MB their harnesses came to. */
const GROUPS: readonly (readonly [name: string, holds: string, level: Level, paths: RegExp])[] = [
  [
    "log",
    "the run's whole record, one event a line, and how each session was launched",
    "light",
    /^([^/]+\.jsonl|launch-[^/]+)$/,
  ],
  ["brief", "the brief the tasks answer", "light", /^(exams\/[^/]+\/)?checks\/brief\.json$/],
  [
    "harness",
    "each harness a session kept: guide, tools, tool spec, memory",
    "light",
    /^states\/[0-9a-f]{64}\/(?!correctness-model\/)/,
  ],
  [
    "checker",
    "the checks, their tests and their reference, an exam the campaign drafted, and a harness's own copy of them",
    "medium",
    /^(checks|exams\/[^/]+|states\/[0-9a-f]{64}\/correctness-model)\//,
  ],
  ["toolchain", "what a harness installed, less the packages", "medium", /^states\/tree-[^/]+\//],
  ["memory", "the notes and helper files each Builder session left the next", "light", /^memory\//],
  ["source", "the tracked src, tools and docs of the worktree at its commit", "verbose", /^source\//],
  ["rest", "anything else in the run's folder", "verbose", /^/],
];

/** Folders of installed packages, caches and built bundles, by name; a pip target is known by its
 *  `.dist-info`. A harness's `.bundle-snapshots` were 30 of the 38 MB its states held on 2026-10-08. */
const DERIVED = new Set([
  "node_modules",
  ".bundle-snapshots",
  "__pycache__",
  ".git",
  ".cache",
  ".cargo",
  ".local",
  ".matplotlib",
  "Library",
]);
const SECRET = /^(auth\.json|.*\.env|\.DS_Store)$/;
const LIGHT_MAX = 2 * 1024 * 1024;
const SOURCE = ["src", "tools", "docs", "package.json"];

interface Held {
  readonly path: string;
  readonly bytes: number;
  readonly group: string;
}

interface Left {
  readonly path: string;
  readonly why: string;
}

/** The path from `root` that the link at `path` names, where it is relative and stays in `root`. */
function linkedIn(root: string, path: string): string | null {
  const target = readlinkSync(path);
  const named = relative(root, resolve(dirname(path), target));
  return isAbsolute(target) || named.startsWith("..") ? null : named;
}

/** Why a zip never holds `path` in `root`, or null when it may. */
function unfit(root: string, path: string): string | null {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return linkedIn(root, path) === null ? "a link out of its folder" : null;
  if (SECRET.test(basename(path))) return "a secret's name";
  const installed =
    stat.isDirectory() &&
    (DERIVED.has(basename(path)) || readdirSync(path).some((name) => name.endsWith(".dist-info")));
  return installed ? "installed, cached or built" : null;
}

/** Every file a zip may hold of `names` in `root`, or of all of it, by its path from there, and
 *  what stays where it is. */
export function fit(root: string, names: readonly string[] = readdirSync(root).toSorted()) {
  const held: Held[] = [];
  const left: Left[] = [];
  const visit = (path: string): void => {
    const full = join(root, path);
    const why = unfit(root, full);
    if (why !== null) {
      left.push({ path, why });
    } else if (lstatSync(full).isDirectory()) {
      for (const name of readdirSync(full).toSorted()) visit(join(path, name));
    } else {
      // A link is grouped with what it names, as a folder: a `.toolchain` with its `tree-*`.
      const named = lstatSync(full).isSymbolicLink() ? `${linkedIn(root, full) ?? path}/` : path;
      const group = GROUPS.find((entry) => entry[3].test(named))?.[0] ?? "rest";
      held.push({ path, bytes: lstatSync(full).size, group });
    }
  };
  for (const name of names) visit(name);
  return { held, left };
}

const holds = (level: Level, group: string) =>
  LEVELS.indexOf(GROUPS.find(([name]) => name === group)?.[2] ?? "verbose") <= LEVELS.indexOf(level);

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** What a zip at `level` holds of each group, as its README and the command say it. */
const sizes = (level: Level, files: readonly Held[]) =>
  GROUPS.map(([name, what, from]) => {
    const own = files.filter((file) => file.group === name);
    const bytes = own.reduce((sum, file) => sum + file.bytes, 0);
    const here = holds(level, name)
      ? `${plural(own.length, "file")}, ${kilobytes(bytes)}`
      : "not at this level";
    return { name, what, from, here };
  });

/** The README a zip opens with: its runs, its groups and what was left. */
function readme({ level, made, runs: ran, files, left }: ReturnType<typeof gather>): string {
  const reasons = Object.entries(countBy(left, ({ why }) => why));
  return [
    `# Runs, ${level}`,
    "",
    `${plural(ran.length, "run")}, zipped ${made}. GUIDE.md says how to read them and what not to conclude, and MANIFEST.json lists every file with its size and group.`,
    "",
    "| log | ran at | worktree now | events | last reading | ended |",
    "| --- | --- | --- | --- | --- | --- |",
    ...ran.map(
      ({ log, ranAt, commit, dirty, events, reading, ended }) =>
        `| ${log} | ${ranAt.map((at) => at.slice(0, 9)).join(", ") || "no receipt"} | ${commit.slice(0, 9)}${dirty ? ", with uncommitted changes" : ""} | ${String(events)} | ${reading ?? "none"} | ${ended ?? "no ending in the log"} |`,
    ),
    "",
    "| group | holds | from level | here |",
    "| --- | --- | --- | --- |",
    ...sizes(level, files).map(({ name, what, from, here }) => `| ${name} | ${what} | ${from} | ${here} |`),
    "",
    `Left where it was, at every level: ${reasons.map(([why, n]) => `${String(n)} × ${why}`).join(", ") || "nothing"}. MANIFEST.json names each under \`left\`.`,
    "",
  ].join("\n");
}

/** Copy what `level` holds of `chosen` under `stage`, and say what the zip then is. */
function gather(chosen: readonly Run[], level: Level, stage: string) {
  const files: Held[] = [];
  const left: Left[] = [];
  const keep = (from: string, under: string, found: ReturnType<typeof fit>) => {
    for (const { path, bytes, group } of found.held.filter((file) => holds(level, file.group))) {
      cpSync(join(from, path), join(stage, under, path), { verbatimSymlinks: true });
      // A live run's log may end in the line it is writing, which every reader would refuse.
      const whole = path.endsWith(".jsonl") ? wholeLines(join(from, path)) : null;
      if (whole !== null) writeFileSync(join(stage, under, path), whole);
      files.push({
        path: join(under, path),
        bytes: whole === null ? bytes : Buffer.byteLength(whole),
        group,
      });
    }
    left.push(...found.left.map(({ path, why }) => ({ path: join(under, path), why })));
  };
  for (const tree of holds(level, "source") ? new Set(chosen.map((run) => run.tree)) : []) {
    const scratch = mkdtempSync(join(tmpdir(), "ana-runs-source-"));
    const tar = join(scratch, "source.tar");
    gitText(tree, "archive", "--prefix=source/", "-o", tar, "HEAD", ...SOURCE);
    runTextSyncOrThrow(["tar", "-xf", tar, "-C", scratch]);
    keep(scratch, basename(tree), fit(scratch, ["source"]));
    rmSync(scratch, { recursive: true });
  }
  const told = chosen.map((run) => {
    // A round's folder is its own; a live solve's log lies among the other solves'.
    const [folder, found] = isCampaign(run)
      ? [run.name, fit(dirname(run.path))]
      : ["live", fit(dirname(run.path), [basename(run.path)])];
    const under = join(basename(run.tree), folder);
    keep(dirname(run.path), under, found);
    const log = logEvents(run.path);
    const ranAt = [...new Set(receipts(run.path).map(({ commit }) => commit))];
    const now = standing(run.tree);
    const last = log.findLast(({ kind }) => kind === run.end)?.data;
    const reading = last?.reading ?? asRecord(last?.ending)?.outcome;
    // A campaign's ending is its log's last event: one that goes on after an ending has none.
    const ended = log.at(-1)?.kind === CAMPAIGN_ENDED ? log.at(-1)?.data.ending : undefined;
    return {
      name: run.name,
      log: join(basename(run.tree), folder, basename(run.path)),
      worktree: run.tree,
      // The commit of each launch beside the log, oldest first, which is the source each ran; the
      // worktree's own commit is where it stands when zipped, which can differ from every one.
      ranAt,
      ...now,
      events: log.length,
      reading: isString(reading) ? reading : null,
      ended: isString(ended) ? ended : null,
    };
  });
  return { schema: "runs-zip/v1", level, made: new Date().toISOString(), runs: told, files, left };
}

/** Zip `chosen` at `level` to `out`, and return what it holds. Refuses a zip over `maxBytes`. */
export function zip(
  chosen: readonly Run[],
  level: Level,
  to: { readonly out: string; readonly maxBytes: number | null; readonly note: string | null },
) {
  if (chosen.length === 0) throw new Error("no run to zip");
  const stage = mkdtempSync(join(tmpdir(), "ana-runs-zip-"));
  try {
    const name = basename(to.out, ".zip");
    const manifest = gather(chosen, level, join(stage, name));
    cpSync(join(import.meta.dir, "zip-guide.md"), join(stage, name, "GUIDE.md"));
    if (to.note !== null) cpSync(to.note, join(stage, name, "NOTES.md"));
    writeFileSync(join(stage, name, "README.md"), readme(manifest));
    writeFileSync(join(stage, name, "MANIFEST.json"), `${capturedJsonStringify(manifest, null, 2)}\n`);
    // `zip` adds to an archive that is already there.
    rmSync(to.out, { force: true });
    // `-y` stores a link as the link, which `fit` holds only where it stays in the run's folder.
    runTextSyncOrThrow(["zip", "-qry", "-X", resolve(to.out), name], { cwd: stage });
    const bytes = lstatSync(to.out).size;
    const max = to.maxBytes ?? (level === "light" ? LIGHT_MAX * chosen.length : null);
    if (max !== null && bytes > max) {
      rmSync(to.out);
      throw new Error(
        `${to.out} would be ${kilobytes(bytes)}, over its ${kilobytes(max)}: name fewer runs or raise --max-mb`,
      );
    }
    return { ...manifest, out: to.out, bytes };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** `2h`, `90m`, `45s` or `1.5d` as seconds. */
export function secondsOf(text: string): number {
  const found = /^(\d+(?:\.\d+)?)([smhd])$/.exec(text);
  const per = SECONDS.get(found?.[2] ?? "");
  if (found === null || per === undefined) {
    throw new Error(`--minTime takes a number and one of s, m, h or d (2h, 90m), not "${text}"`);
  }
  return Number(found[1]) * per;
}

const countOf = (flag: string, text: string, least: number) => {
  const count = Number(text);
  if (!Number.isInteger(count) || count < least) {
    throw new Error(`${flag} takes a whole number of at least ${String(least)}, not "${text}"`);
  }
  return count;
};

/** A date, a date with a time and a zone, or how long ago (`36h`), as milliseconds since the epoch. */
export function momentOf(flag: string, text: string, now = Date.now()): number {
  if (AGO.test(text)) return now - secondsOf(text) * 1000;
  const at = MOMENT.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(at)) {
    throw new TypeError(
      `${flag} takes a date (2026-11-06), a time with a zone (2026-11-06T12:00Z) or how long ago (36h), not "${text}"`,
    );
  }
  return at;
}

const timeOf = (event: LogEvent | undefined) => (event === undefined ? Number.NaN : Date.parse(event.at));

/** The campaigns of `runs` that pass `choice`, the newest last event first. A seed or a live solve
 *  is no campaign, and a log with no event passes nothing. Reading every archived log whole takes
 *  4 seconds (251 logs, 2.1 GB, 8 November 2026). */
export function newest(runs: readonly Run[], choice: Choice): Run[] {
  const read = runs
    .filter((run) => isCampaign(run) && run.seed !== true)
    .map((run) => {
      const events = logEvents(run.path);
      const last = timeOf(events.at(-1));
      const first = timeOf(events.at(0));
      return {
        run,
        first,
        last,
        promotions: events.filter(({ kind }) => kind === PROMOTED).length,
        seconds: (last - first) / 1000,
      };
    });
  return read
    .filter(
      (one) =>
        one.promotions >= choice.promotions &&
        one.seconds >= choice.seconds &&
        one.last >= choice.since &&
        one.first <= choice.until,
    )
    .toSorted((a, b) => b.last - a.last)
    .slice(0, choice.latest ?? undefined)
    .map((one) => one.run);
}

/** The flags that choose runs, as the host is sent them, and as the `Choice` they make (null when
 *  none is given). */
function choiceOf(values: Partial<Record<(typeof CHOOSING)[number], string>>) {
  const forwarded = CHOOSING.flatMap((flag) => {
    const value = values[flag];
    return value === undefined ? [] : [`--${flag}`, value];
  });
  const choice: Choice | null =
    forwarded.length === 0
      ? null
      : {
          latest: values.latest === undefined ? null : countOf("--latest", values.latest, 1),
          promotions:
            values.minPromotions === undefined ? 0 : countOf("--minPromotions", values.minPromotions, 0),
          seconds: values.minTime === undefined ? 0 : secondsOf(values.minTime),
          since: values.since === undefined ? -Infinity : momentOf("--since", values.since),
          until: values.until === undefined ? Infinity : momentOf("--until", values.until),
        };
  return { choice, forwarded };
}

/** The runs `choice` names among those `names` match on every host. Each record is read to choose,
 *  and only the chosen come whole, by exact name: asking for none would bring every campaign. */
async function pickedAcross(names: readonly string[], choice: Choice): Promise<Run[]> {
  const chosen = newest(await readableAcross(names), choice).map((run) => run.name);
  if (chosen.length === 0) throw new Error("no campaign passes the flags that choose runs");
  const refreshed = await syncRuns(chosen, { match: "exact", depth: "whole" });
  const held = new Map(
    readable()
      .filter((run) => run.archived === undefined || run.archived === HERE || refreshed.includes(run.path))
      .map((run) => [run.name, run]),
  );
  return chosen.flatMap((name) => held.get(name) ?? []);
}

/** `bun run runs zip`. */
export async function zipRuns(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      light: { type: "boolean", default: false },
      medium: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      out: { type: "string" },
      "max-mb": { type: "string" },
      note: { type: "string" },
      from: { type: "string" },
      latest: { type: "string" },
      minPromotions: { type: "string" },
      minTime: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
    },
  });
  const levels = LEVELS.filter((level) => values[level]);
  const [level] = levels;
  if (level === undefined || levels.length > 1) {
    throw new Error(
      "usage: bun run runs zip [<name> ...] --light|--medium|--verbose [--out FILE] [--max-mb N] [--note FILE] [--from HOST] [--latest N] [--minPromotions N] [--minTime 2h] [--since WHEN] [--until WHEN]",
    );
  }
  const megabytes = values["max-mb"];
  const { choice, forwarded } = choiceOf(values);
  const stem = [
    ...names,
    ...(choice === null ? [] : [choice.latest === null ? "picked" : `latest${String(choice.latest)}`]),
  ];
  const out = values.out ?? `${stem.join("-") || "runs"}-${level}.zip`;
  if (values.from !== undefined) {
    if (values.note !== undefined) {
      throw new Error("--note is added where the zip is made: zip here, or leave it out");
    }
    // The host makes the zip by its own reading of its runs, and only the zip comes back.
    const host = hostNamed(values.from);
    // The zip's folder inside is named for its file, so the host's copy takes `--out`'s name.
    const scratch = `/tmp/ana-runs-zip-${String(Date.now())}`;
    const there = `${scratch}/${basename(out)}`;
    const mb = megabytes === undefined ? [] : ["--max-mb", megabytes];
    runTextSyncOrThrow(sshScript(host, `mkdir ${scratch}`));
    try {
      if ((await verbOn(host, ["zip", ...names, `--${level}`, "--out", there, ...mb, ...forwarded])) !== 0) {
        throw new Error(`the zip was not made on ${host.name}`);
      }
      await rsync(sideOf(host, there), out);
    } finally {
      runTextSyncOrThrow(sshScript(host, `rm -rf ${scratch}`));
    }
    console.log(`${out}  from ${host.name}`);
    return;
  }
  const made = zip(
    choice === null ? await readableAcross(names, "whole") : await pickedAcross(names, choice),
    level,
    {
      out,
      maxBytes: megabytes === undefined ? null : Number(megabytes) * 1024 * 1024,
      note: values.note ?? null,
    },
  );
  console.log(`${made.out}  ${kilobytes(made.bytes)} · ${plural(made.runs.length, "run")} · ${level}`);
  for (const { name, here } of sizes(level, made.files)) console.log(`  ${name.padEnd(10)} ${here}`);
  console.log(`  left where it was: ${String(made.left.length)} (MANIFEST.json, \`left\`)`);
}

/**
 * Command-line dispatcher for `bun run runs <verb>`, operating across all campaign logs in the
 * repository's worktrees (`registry.ts`). `GROUPS` lists one-line summaries displayed by a bare
 * `bun run runs`, followed by universal flags (`EVERY`). Detailed usage has a single authoritative
 * owner, the file header comment of each verb's module, parsed by `bun run runs <verb> --help`
 * (`usageOf`); `help <verb> ...` prints multiple verbs and `help all` prints all of them. Verbs
 * targeting a campaign held on another host are forwarded to that host (`routed`), discovered via
 * `holds`.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { hasText } from "#src/meta/text.ts";
import type { Host } from "./host-config.ts";
import { preparedHost, publishedAt } from "./code.ts";
import { alerts } from "./alerts.ts";
import { fresh } from "./fresh.ts";
import { holds, NAMING, on, routed, verbOn } from "./hosts.ts";
import { hostsHealth } from "./health.ts";
import { keep } from "./keep.ts";
import { HERE, KEEPING, Misused, ownArgs } from "./registry.ts";
import { loadwatch } from "./loadwatch.ts";
import { netwatch } from "./netwatch.ts";
import { active, logins } from "./logins.ts";
import { continueRun, launch, pause } from "./manage.ts";
import { copy, fetch, move } from "./move.ts";
import { bench, evalOf, readEach } from "./bench.ts";
import { runsStatus, watch } from "./pulse.ts";
import { source } from "./receipt.ts";
import { rehearse } from "./rehearse.ts";
import { retire } from "./retire.ts";
import { replay } from "./replay.ts";
import { seed } from "./seed.ts";
import { stop } from "./stop.ts";
import { view } from "./view.ts";
import { zipRuns } from "./zip.ts";
import { catalogue } from "./snapshots.ts";
import { search } from "./search.ts";
import { sync } from "./sync.ts";

interface Verb {
  readonly run: (args: readonly string[]) => Promise<void> | void;
  readonly file: string;
  readonly says: string;
}

/** Verbs whose own option parser handles `--here` beyond merely suppressing remote queries. */
const READS_HERE: ReadonlySet<string | undefined> = new Set(["active", "hosts", "keep", "pulse"]);
/** Tokens that trigger the verb list or per-verb help output. */
const HELP: ReadonlySet<string> = new Set(["", "help", "--help", "-h"]);
/** Universal flags and conventions displayed beneath the verb groups. */
const EVERY = [
  ["<verb> --help", "its usage; `help <verb> ...` prints several, and `help all` every verb's"],
  [
    KEEPING,
    `this machine alone, asking no other host, as \`on ${HERE} <verb>\`; ${[...READS_HERE].join(", ")} read it for themselves`,
  ],
  ["--yes", "a verb that takes it says what it would do, and does it only with this"],
  ["<name>", `${[...NAMING].join(", ")} act on the host that holds the run they name`],
] as const;

const verbOf = (run: Verb["run"], file: string, says: string): Verb => ({ run, file, says });

/** Registry of all CLI verbs grouped for the bare `bun run runs` summary, with their handler,
 *  usage-owning file, and one-line description. */
const GROUPS = {
  "a run's life": {
    fresh: verbOf(
      fresh,
      "fresh.ts",
      "start a measured campaign from a blank project, in a worktree of its own",
    ),
    launch: verbOf(launch, "manage.ts", "start the campaign command under a new name, in this worktree"),
    continue: verbOf(
      continueRun,
      "manage.ts",
      "run a stopped campaign again from its log, on its kept flags",
    ),
    keep: verbOf(
      keep,
      "keep.ts",
      "attach a keeper, which a run on a numbered login gets by itself, to go on across logins",
    ),
    pause: verbOf(pause, "manage.ts", "stop a campaign at the next clean point after an event"),
    move: verbOf(move, "move.ts", "pause a campaign, take it to another machine and go on there"),
    copy: verbOf(copy, "move.ts", "copy a stopped campaign whole to another worktree"),
    stop: verbOf(stop, "stop.ts", "end the process writing each log, and its keeper"),
    retire: verbOf(
      retire,
      "retire.ts",
      "archive idle campaigns and delete unused worktrees, here and on every host",
    ),
  },
  reading: {
    status: verbOf(
      runsStatus,
      "pulse.ts",
      "one row a run on every host: tree, commit, login, comparisons, ending",
    ),
    pulse: verbOf(watch, "pulse.ts", "what each run gained since the last look"),
    alerts: verbOf(
      alerts,
      "alerts.ts",
      "for cron: one line for each promotion, starter read, ending and stall new since the last look",
    ),
    view: verbOf(view, "view.ts", "one campaign as its log reads, and the move the table names next"),
    source: verbOf(
      source,
      "receipt.ts",
      "the commit each run ran, where it is published, whether it holds a fix",
    ),
    replay: verbOf(replay, "replay.ts", "put every campaign log through this tree's readers"),
    search: verbOf(search, "search.ts", "find text across campaign records and notes on every host"),
  },
  "logins and hosts": {
    usage: verbOf(logins, "logins.ts", "each login's five-hour and weekly use, and its live runs"),
    active: verbOf(active, "logins.ts", "the runs and seats live on each login, by name"),
    hosts: verbOf(
      hostsHealth,
      "hosts.ts",
      "each other host's runs, or with `--health` each machine's load, disk and busiest processes",
    ),
    on: verbOf(on, "hosts.ts", "run any verb on another host"),
    sync: verbOf(
      sync,
      "sync.ts",
      "bring every host to this machine's Python, table of tools and check runner, or say what differs",
    ),
    holds: verbOf(holds, "hosts.ts", "the names among these a worktree here holds"),
    catalogue: verbOf(catalogue, "snapshots.ts", "this machine's original campaigns, for the other hosts"),
    fetch: verbOf(
      fetch,
      "move.ts",
      "copy a campaign another machine holds into the archive, or the record of every one (--whole: the folders too)",
    ),
    loadwatch: verbOf(loadwatch, "loadwatch.ts", "each machine's CPU and load, live"),
    netwatch: verbOf(
      netwatch,
      "netwatch.ts",
      "the traffic between the machines over Tailscale and its total, live",
    ),
  },
  "handover and simulation": {
    zip: verbOf(zipRuns, "zip.ts", "bundle runs for handover"),
    seed: verbOf(seed, "seed.ts", "copy a campaign under another name, cut where a question starts"),
    rehearse: verbOf(rehearse, "rehearse.ts", "run a round over a seed with a script in each model seat"),
    bench: verbOf(
      bench,
      "bench.ts",
      "roll a run's reference beside a Starter on its outside benchmark, or score each finished read",
    ),
  },
} satisfies Record<string, Record<string, Verb>>;
const VERBS: Record<string, Verb> = Object.fromEntries(
  Object.values(GROUPS).flatMap((verbs) => Object.entries(verbs)),
);
const WIDTH = Math.max(...[...Object.keys(VERBS), ...EVERY.map(([name]) => name)].map((name) => name.length));

/** Looks up a verb by exact own key so inherited `Object.prototype` names such as `toString` never match. */
const verbNamed = (word: string | undefined): Verb | undefined =>
  Object.entries(VERBS).find(([name]) => name === word)?.[1];

/** Formats two-column aligned rows with the name column padded to `WIDTH`. */
const columns = (lines: readonly (readonly [string, string])[]): string =>
  lines.map(([name, says]) => `  ${name.padEnd(WIDTH)}  ${says}`).join("\n");

/** A remote continuation at another revision runs that revision's launcher too. Flags after `--`
 *  belong to the campaign, and cannot request a controller checkout or grant launch authority. */
async function continueOn(host: Host, args: readonly string[]): Promise<number> {
  const own = ownArgs(args);
  const at = own.flatMap((arg, index) => (arg === "--at" || arg.startsWith("--at=") ? [index] : []));
  const [index] = at;
  if (index === undefined) return await verbOn(host, args);
  if (at.length !== 1) throw new Error("name --at once");
  const joined = own[index]?.startsWith("--at=") === true;
  const revision = joined ? own[index]?.slice(5) : own[index + 1];
  if (!hasText(revision) || revision.startsWith("--")) {
    throw new Error("name --at <commit>");
  }
  const commit = publishedAt(runtimeProcess.cwd(), revision);
  const forwarded = own.filter((_, n) => n !== index && (joined || n !== index + 1));
  const command = [...forwarded, "--at", commit, ...args.slice(own.length)];
  console.log(`${host.name}: prepare a detached controller at ${commit.slice(0, 9)} before continuing`);
  return await verbOn(own.includes("--yes") ? await preparedHost(host, commit) : host, command);
}

/** Renders the full grouped verb listing and universal options. */
function list(): string {
  const groups = Object.entries(GROUPS).map(
    ([group, verbs]) =>
      `${group}:\n${columns(Object.entries(verbs).map(([name, { says }]) => [name, says] as const))}`,
  );
  return `usage: bun run runs <verb> [<args>]\n\n${groups.join("\n\n")}\n\nevery verb:\n${columns(EVERY)}`;
}

/** Computes Levenshtein edit distance between `from` and `to` using single-row dynamic programming. */
function edits(from: string, to: string): number {
  let row = Array.from({ length: to.length + 1 }, (_, at) => at);
  for (const [i, letter] of from.split("").entries()) {
    let [diagonal, before] = [i, i + 1];
    row = [
      before,
      ...row.slice(1).map((above, j) => {
        before = Math.min(diagonal + Number(letter !== to[j]), above + 1, before + 1);
        diagonal = above;
        return before;
      }),
    ];
  }
  return row.at(-1) ?? 0;
}

/** Formats suggestions for an unrecognised verb: prefix matches first, otherwise verbs within edit
 *  distance 2 (or 1 for words of four characters or fewer), falling back to the full list. */
function unknown(word: string): string {
  const verbs = Object.entries(VERBS).map(([name, { says }]) => [name, says] as const);
  const begun = verbs.filter(([name]) => word !== "" && name.startsWith(word));
  const within = word.length > 4 ? 2 : 1;
  const near = begun.length > 0 ? begun : verbs.filter(([name]) => edits(word, name) <= within);
  if (near.length === 0) return `no verb \`${word}\`\n\n${list()}`;
  return `no verb \`${word}\`; the nearest:\n${columns(near)}\n\`bun run runs\` lists every verb`;
}

/** Extracts usage lines for `verb` from its owning file's leading docblock: indented `runs <verb>`
 *  blocks (with continuation lines) and backticked `bun run runs <verb> ...` or `runs <verb> <args>`
 *  examples. Keeps the file header as the single source of truth for `--help` and misuse output. */
function usageOf(verb: string, file: string): string[] {
  const text = readFileSync(join(import.meta.dir, file), "utf8");
  const head = text.slice(0, text.indexOf("*/")).replaceAll(/^\s*(\/\*\*|\*)/gmu, "");
  const indented = new RegExp(String.raw`^ {3}(\S.*\bruns ${verb}\b.*(?:\n {5,}\S.*)*)`, "gmu");
  const quoted = new RegExp(
    String.raw`\x60(bun run runs ${verb}(?: [^\x60]*)?|runs ${verb} [^\x60]+)\x60`,
    "gu",
  );
  const lines = [...head.matchAll(indented), ...head.matchAll(quoted)].map((match) =>
    (match[1] ?? "").replaceAll(/\s+/gu, " "),
  );
  // Drop shorter quoted prefixes that are already subsumed by a fuller usage line.
  return [...new Set(lines)].filter(
    (line) => !lines.some((other) => other !== line && other.startsWith(line)),
  );
}

/** Formats `--help` output for a single verb, citing the file header where options are documented. */
const helpOf = (verb: string, { file, says }: Verb): string =>
  [
    `${verb}: ${says}`,
    ...usageOf(verb, file).map((line) => `  ${line}`),
    `  why, and what each option does: the head of tools/runs/${file}`,
  ].join("\n");

/** Returns true for argument or flag errors (`Misused` or Node/Bun `parseArgs` errors). */
const misuse = (error: Error): boolean => {
  const code = asRecord(error)?.code;
  return error instanceof Misused || (isString(code) && code.startsWith("ERR_PARSE_ARGS"));
};

/** Distinguishes expected operator refusals (plain `Error` or `Misused`) from internal defects. */
const refusal = (error: unknown): error is Error =>
  error instanceof Error && (error.constructor === Error || misuse(error));

// Treat `on here <verb>` as a local-only invocation with `ANA_HOP=1`, matching remote peer calls.
const argv = Bun.argv.slice(2);
const onHere = argv[0] === "on" && argv[1] === HERE;
if (onHere) runtimeProcess.env.ANA_HOP = "1";
const [verb = "", ...given] = onHere ? argv.slice(2) : argv;
const chosen = verbNamed(verb);
const own = ownArgs(given);
const stripped = !READS_HERE.has(verb) && own.includes(KEEPING);
if (stripped) runtimeProcess.env.ANA_HOP = "1";
const args = stripped ? [...own.filter((word) => word !== KEEPING), ...given.slice(own.length)] : given;
if (HELP.has(verb)) {
  // Bare invocation or `help` lists all verbs; named verbs or `all` print detailed usage.
  const asked = (given[0] === "all" ? Object.keys(VERBS) : given).map(
    (name) => [name, verbNamed(name)] as const,
  );
  const stray = asked.find(([, known]) => known === undefined)?.[0];
  if (stray === undefined) {
    const helps = asked.flatMap(([name, known]) => (known === undefined ? [] : [helpOf(name, known)]));
    console.log(helps.length === 0 ? list() : helps.join("\n\n"));
  } else {
    console.error(unknown(stray));
    runtimeProcess.exitCode = 1;
  }
} else if (chosen === undefined) {
  // Unrecognised verb: suggest nearest matches or print the full listing.
  console.error(unknown(verb));
  runtimeProcess.exitCode = 1;
} else if (own.includes("--help") || own.includes("-h")) {
  console.log(helpOf(verb, chosen));
} else {
  try {
    // Evaluate `pause --eval` locally where `.env.runs` defines benchmarks; a remote host holding
    // the campaign only executes the pause.
    const { passed, reads } = verb === "pause" ? evalOf(args) : { passed: args, reads: [] };
    const { here, away } = await routed(verb, passed);
    for (const [host, words] of away) {
      const code = await (verb === "continue" ? continueOn(host, words) : verbOn(host, words));
      if (code !== 0) runtimeProcess.exitCode = code;
    }
    if (here !== null) await chosen.run(here);
    if ((runtimeProcess.exitCode ?? 0) === 0) await readEach(reads);
  } catch (error) {
    if (!refusal(error)) throw error;
    // Append the verb's usage lines beneath any misuse error message.
    const usage = misuse(error) ? usageOf(verb, chosen.file).map((line) => `usage: ${line}`) : [];
    console.error([error.message, ...usage].filter((line) => line !== "").join("\n"));
    runtimeProcess.exitCode = 1;
  }
}
// Exit explicitly with whatever `exitCode` was set so refused verbs never return 0.
runtimeProcess.exit();

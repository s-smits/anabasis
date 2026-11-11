/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees (`registry.ts`). `GROUPS`
 * says what each verb does, in one line, and a bare `bun run runs` prints it grouped, with what
 * holds of every verb under it (`EVERY`). The usage has one owner, the head of the verb's file,
 * which `bun run runs <verb> --help` reads (`usageOf`); `help <verb> ...` prints several and
 * `help all` every verb's. Until 30 October this head restated each verb in a paragraph only a reader
 * of the source saw, and the bare command printed the names alone and exited 1 (operator: "give the
 * agents insights of everything we can do"). A verb that names a run no worktree here holds runs on
 * the host that holds it (`routed`), and `holds` is what that host is asked.
 *
 * A verb given words it cannot act on (`Misused`, or a flag or an argument `parseArgs` did not take)
 * is answered with that usage, so the refusal is the correction; a word that names no verb is
 * answered with the verbs nearest it (`unknown`). Until 11 November each verb threw a usage line of
 * its own beside the head's, `--help` left out 20 options that the parsers of six verbs take, and
 * an unknown flag said only its name (operator: "make more exhaustive", "and make more smart").
 * `test/runs-cli.test.ts` holds each parser's options to the help of its file's verbs.
 *
 * `here` always names this machine, whichever verb hears it: `--here` is accepted by every verb, and a
 * verb with no use of its own for it reaches no other host for that one call, as a verb another host
 * sent here does (`ANA_HOP`, `hostsOf`). With no hosts it changes nothing, since an empty list is
 * already this machine alone. A refusal prints its one line and exits 1; until 5 November each of
 * about 25 ordinary refusals printed a Bun frame and a stack trace. An error of another kind keeps
 * its trace, since that is a defect and not an answer.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { alerts, watchRuns } from "./alerts.ts";
import { fresh } from "./fresh.ts";
import { holds, NAMING, on, routed, verbOn } from "./hosts.ts";
import { hostsHealth } from "./health.ts";
import { keep } from "./keep.ts";
import { HERE, KEEPING, Misused, ownArgs } from "./registry.ts";
import { loadwatch } from "./loadwatch.ts";
import { active, logins } from "./logins.ts";
import { continueRun, launch, pause } from "./manage.ts";
import { copy, fetch, move } from "./move.ts";
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
import { continueOn } from "./continuation.ts";
import { search } from "./search.ts";
import { sync } from "./sync.ts";

interface Verb {
  readonly run: (args: readonly string[]) => Promise<void> | void;
  readonly file: string;
  readonly says: string;
}

/** The verbs whose own parser reads `--here`, each with more to it than reaching no other host. */
const READS_HERE: ReadonlySet<string | undefined> = new Set(["active", "hosts", "keep", "pulse"]);

/** Each verb: its function, the file whose head states its usage, and what it does, in the groups
 *  the bare command prints. */
const GROUPS = {
  "a run's life": {
    fresh: {
      run: fresh,
      file: "fresh.ts",
      says: "start a measured campaign from a blank project, in a worktree of its own",
    },
    launch: {
      run: launch,
      file: "manage.ts",
      says: "start the campaign command under a new name, in this worktree",
    },
    continue: {
      run: continueRun,
      file: "manage.ts",
      says: "run a stopped campaign again from its log, on its kept flags",
    },
    keep: {
      run: keep,
      file: "keep.ts",
      says: "attach a keeper, which a run on a numbered login gets by itself, to go on across logins",
    },
    pause: {
      run: pause,
      file: "manage.ts",
      says: "stop a campaign at the next clean point after an event",
    },
    move: {
      run: move,
      file: "move.ts",
      says: "pause a campaign, take it to another machine and go on there",
    },
    copy: {
      run: copy,
      file: "move.ts",
      says: "copy a stopped campaign whole to another worktree",
    },
    stop: {
      run: stop,
      file: "stop.ts",
      says: "end the process writing each log, and its keeper",
    },
    retire: {
      run: retire,
      file: "retire.ts",
      says: "archive idle campaigns and delete unused worktrees, here and on every host",
    },
  },
  reading: {
    status: {
      run: runsStatus,
      file: "pulse.ts",
      says: "one row a run on every host: tree, commit, login, comparisons, ending",
    },
    pulse: {
      run: watch,
      file: "pulse.ts",
      says: "what each run gained since the last look",
    },
    alerts: {
      run: alerts,
      file: "alerts.ts",
      says: "for cron: one line for each promotion, starter read, ending and stall new since the last look",
    },
    watch: {
      run: watchRuns,
      file: "alerts.ts",
      says: "wait until a named run owes a step (two promotions, an ending, a stall), say it and end",
    },
    view: {
      run: view,
      file: "view.ts",
      says: "one campaign as its log reads, and the move the table names next",
    },
    source: {
      run: source,
      file: "receipt.ts",
      says: "the commit each run ran, where it is published, whether it holds a fix",
    },
    replay: {
      run: replay,
      file: "replay.ts",
      says: "put every campaign log through this tree's readers",
    },
    search: {
      run: search,
      file: "search.ts",
      says: "find text across campaign records and notes on every host",
    },
  },
  "logins and hosts": {
    usage: {
      run: logins,
      file: "logins.ts",
      says: "each login's five-hour and weekly use, and its live runs",
    },
    active: {
      run: active,
      file: "logins.ts",
      says: "the runs and seats live on each login, by name",
    },
    hosts: {
      run: hostsHealth,
      file: "hosts.ts",
      says: "each other host's runs, or with `--health` each machine's load, disk and busiest processes",
    },
    on: { run: on, file: "hosts.ts", says: "run any verb on another host" },
    sync: {
      run: sync,
      file: "sync.ts",
      says: "bring every host to this machine's Python, table of tools and check runner, or say what differs",
    },
    holds: {
      run: holds,
      file: "hosts.ts",
      says: "the names among these a worktree here holds",
    },
    catalogue: {
      run: catalogue,
      file: "snapshots.ts",
      says: "this machine's original campaigns, for the other hosts",
    },
    fetch: {
      run: fetch,
      file: "move.ts",
      says: "copy a campaign another machine holds into the archive, or the record of every one (--whole: the folders too)",
    },
    loadwatch: {
      run: loadwatch,
      file: "loadwatch.ts",
      says: "each machine's CPU and load, live",
    },
  },
  "handover and simulation": {
    zip: {
      run: zipRuns,
      file: "zip.ts",
      says: "bundle runs for handover",
    },
    seed: {
      run: seed,
      file: "seed.ts",
      says: "copy a campaign under another name, cut where a question starts",
    },
    rehearse: {
      run: rehearse,
      file: "rehearse.ts",
      says: "run a round over a seed with a script in each model seat",
    },
  },
} satisfies Record<string, Record<string, Verb>>;
const VERBS: Record<string, Verb> = Object.fromEntries(
  Object.values(GROUPS).flatMap((verbs) => Object.entries(verbs)),
);
/** The words that ask for the list, or for the usage of the verbs named after them. */
const HELP: ReadonlySet<string | undefined> = new Set([undefined, "help", "--help", "-h"]);
/** What holds of every verb, said under the list. */
const EVERY = [
  ["<verb> --help", "its usage; `help <verb> ...` prints several, and `help all` every verb's"],
  [
    KEEPING,
    `this machine alone, asking no other host, as \`on ${HERE} <verb>\`; ${[...READS_HERE].join(", ")} read it for themselves`,
  ],
  ["--yes", "a verb that takes it says what it would do, and does it only with this"],
  ["<name>", `${[...NAMING].join(", ")} act on the host that holds the run they name`],
] as const;
const WIDTH = Math.max(...[...Object.keys(VERBS), ...EVERY.map(([name]) => name)].map((name) => name.length));

/** The verb a word names, if any: by its own entry, so that `toString` names none. */
const verbNamed = (word: string | undefined): Verb | undefined =>
  Object.entries(VERBS).find(([name]) => name === word)?.[1];

/** Names in one column and what each is in the next. */
const columns = (lines: readonly (readonly [string, string])[]): string =>
  lines.map(([name, says]) => `  ${name.padEnd(WIDTH)}  ${says}`).join("\n");

/** Every verb, grouped, with what it does, and what holds of them all. */
function list(): string {
  const groups = Object.entries(GROUPS).map(
    ([group, verbs]) =>
      `${group}:\n${columns(Object.entries(verbs).map(([name, { says }]) => [name, says] as const))}`,
  );
  return `usage: bun run runs <verb> [<args>]\n\n${groups.join("\n\n")}\n\nevery verb:\n${columns(EVERY)}`;
}

/** The edits that turn one word into another (Levenshtein), a row of the table at a time. */
function edits(from: string, to: string): number {
  let row = Array.from({ length: to.length + 1 }, (_, at) => at);
  for (let i = 0; i < from.length; i += 1) {
    const next = [i + 1];
    for (let j = 0; j < to.length; j += 1) {
      const swapped = (row[j] ?? 0) + (from[i] === to[j] ? 0 : 1);
      next.push(Math.min(swapped, (row[j + 1] ?? 0) + 1, (next[j] ?? 0) + 1));
    }
    row = next;
  }
  return row.at(-1) ?? 0;
}

/** What a word that names no verb is answered: the verbs it begins, or else those two edits away at
 *  most (one, for a word of four letters or fewer), and the whole list where none is near. It runs
 *  none of them: `st` begins both `status` and `stop`. */
function unknown(word: string): string {
  const verbs = Object.entries(VERBS).map(([name, { says }]) => [name, says] as const);
  const begun = verbs.filter(([name]) => word !== "" && name.startsWith(word));
  const within = word.length > 4 ? 2 : 1;
  const near = begun.length > 0 ? begun : verbs.filter(([name]) => edits(word, name) <= within);
  if (near.length === 0) return `no verb \`${word}\`\n\n${list()}`;
  return `no verb \`${word}\`; the nearest:\n${columns(near)}\n\`bun run runs\` lists every verb`;
}

/** A verb's usage, as the head of its file states it: each line indented in the head that names
 *  `runs <verb>`, with the lines indented further that continue it, and each quoted command
 *  `bun run runs <verb> ...` or `runs <verb> <args>`. The head stays the one owner of the options:
 *  `--help` prints these lines, and so does a verb given words it cannot act on (`misuse`). */
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
  // A quoted command that only begins a longer usage line says nothing more.
  return [...new Set(lines)].filter(
    (line) => !lines.some((other) => other !== line && other.startsWith(line)),
  );
}

/** What `--help` prints of a verb: what it does, its usage, and where each option is explained. */
const helpOf = (verb: string, { file, says }: Verb): string =>
  [
    `${verb}: ${says}`,
    ...usageOf(verb, file).map((line) => `  ${line}`),
    `  why, and what each option does: the head of tools/runs/${file}`,
  ].join("\n");

/** Words a verb cannot act on: its own `Misused`, or a flag or an argument `parseArgs` did not take. */
const misuse = (error: Error): boolean => {
  const code = asRecord(error)?.code;
  return error instanceof Misused || (isString(code) && code.startsWith("ERR_PARSE_ARGS"));
};

/** What a verb refused, as opposed to a defect: a plain `Error`, or a misuse. */
const refusal = (error: unknown): error is Error =>
  error instanceof Error && (error.constructor === Error || misuse(error));

// `on here <verb>` is that verb here, reaching no further host, as one sent to a peer does.
const argv = Bun.argv.slice(2);
const onHere = argv[0] === "on" && argv[1] === HERE;
if (onHere) runtimeProcess.env.ANA_HOP = "1";
const [verb, ...given] = onHere ? argv.slice(2) : argv;
const chosen = verbNamed(verb);
const own = ownArgs(given);
const stripped = !READS_HERE.has(verb) && own.includes(KEEPING);
if (stripped) runtimeProcess.env.ANA_HOP = "1";
const args = stripped ? [...own.filter((word) => word !== KEEPING), ...given.slice(own.length)] : given;
if (HELP.has(verb)) {
  // A bare command or `help` alone asks for the list; verbs after it, or `all`, for their usage.
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
  // Any other word is a mistake, answered with the nearest verbs or the list.
  console.error(unknown(verb ?? ""));
  runtimeProcess.exitCode = 1;
} else if (own.includes("--help") || own.includes("-h")) {
  console.log(helpOf(verb ?? "", chosen));
} else {
  try {
    const { here, away } = await routed(verb ?? "", args);
    for (const [host, words] of away) {
      const code = await (verb === "continue" ? continueOn(host, words) : verbOn(host, words));
      if (code !== 0) runtimeProcess.exitCode = code;
    }
    if (here !== null) await chosen.run(here);
  } catch (error) {
    if (!refusal(error)) throw error;
    // A misuse is answered with the verb's usage, under what was wrong where the verb says it.
    const usage = misuse(error) ? usageOf(verb ?? "", chosen.file).map((line) => `usage: ${line}`) : [];
    console.error([error.message, ...usage].filter((line) => line !== "").join("\n"));
    runtimeProcess.exitCode = 1;
  }
}
// With the code a verb set: a verb that refused is not a success.
runtimeProcess.exit();

/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees (`registry.ts`). `GROUPS`
 * says what each verb does, in one line, and a bare `bun run runs` prints it grouped. The usage has
 * one owner, the head of the verb's file, which `bun run runs <verb> --help` reads (`usageOf`).
 * Until 30 October this head restated each verb in a paragraph only a reader of the source saw, and
 * the bare command printed the names alone and exited 1 (operator: "give the agents insights of
 * everything we can do"). A verb that names a run no worktree here holds runs on the host that holds
 * it (`routed`), and `holds` is what that host is asked.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { fresh } from "./fresh.ts";
import { holds, on, routed, verbOn } from "./hosts.ts";
import { hostsHealth } from "./health.ts";
import { keep } from "./keep.ts";
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

interface Verb {
  readonly run: (args: readonly string[]) => Promise<void> | void;
  readonly file: string;
  readonly says: string;
}

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
      says: "keep a campaign going across logins until it ends on its own terms",
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
      says: "copy a campaign another machine holds into the archive, or every one",
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

/** Every verb, grouped, with what it does. */
function list(): string {
  const width = Math.max(...Object.keys(VERBS).map((name) => name.length));
  const groups = Object.entries(GROUPS).map(
    ([group, verbs]) =>
      `${group}:\n${Object.entries(verbs)
        .map(([name, { says }]) => `  ${name.padEnd(width)}  ${says}`)
        .join("\n")}`,
  );
  return `usage: bun run runs <verb> [<args>]; bun run runs <verb> --help prints its usage\n\n${groups.join("\n\n")}`;
}

/** A verb's usage, as the head of its file states it: each line indented in the head that names
 *  `runs <verb>`, with the lines indented further that continue it, and each quoted command
 *  `bun run runs <verb> ...` or `runs <verb> <args>`. The head stays the one owner of the options. */
function usageOf(verb: string, { file, says }: Verb): string {
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
  const usage = [...new Set(lines)].filter(
    (line) => !lines.some((other) => other !== line && other.startsWith(line)),
  );
  return `${verb}: ${says}\n\n${usage.map((line) => `  ${line}`).join("\n")}\n\nWhy, and what each option does: the head of tools/runs/${file}.`;
}

const [verb, ...args] = Bun.argv.slice(2);
const chosen = Object.entries(VERBS).find(([name]) => name === verb)?.[1];
const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
if (chosen === undefined) {
  // A bare command or `help` asks for the list; any other word is a mistake that still gets it.
  const asked = verb === undefined || verb === "help" || verb === "--help" || verb === "-h";
  (asked ? console.log : console.error)(list());
  if (!asked) runtimeProcess.exitCode = 1;
} else if (own.includes("--help") || own.includes("-h")) {
  console.log(usageOf(verb ?? "", chosen));
} else {
  const { here, away } = await routed(verb ?? "", args);
  for (const [host, words] of away) {
    const code = await (verb === "continue" ? continueOn(host, words) : verbOn(host, words));
    if (code !== 0) runtimeProcess.exitCode = code;
  }
  if (here !== null) await chosen.run(here);
}
// With the code a verb set: a verb that refused is not a success.
runtimeProcess.exit();

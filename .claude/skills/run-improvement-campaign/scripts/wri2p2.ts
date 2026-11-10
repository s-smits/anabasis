#!/usr/bin/env bun
/**
 * WRI2P2, the iteration of the skill's "The iteration", read as one step at a time from what is on
 * disk, so a session or a timer runs one line and takes the step it prints. It writes nothing but an
 * investigation's own files, through `wri.ts`, and the marker `open` leaves; it stops, launches and
 * merges nothing.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...] [--promotions 2] [--hours 12] [--days 2]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due [<part> ...] [--days 2]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>...] [--out <dir>]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts ledger <dir>
 *
 * - With no verb it reads every campaign this machine reads whose log moved in the last `--days`
 *   (`readable`: the worktrees' and the copies the central host's ten-minute gather keeps of every
 *   peer's, live ones included, each with the liveness its host last reported) and prints one row a
 *   run and its step: `run` while no trigger fired, `open` once one did, or the investigation's next
 *   step once one reads it. The trigger is whichever comes first (operator, 4 November): the
 *   promotions, the hours since the opening, a scored comparison that left no task untied ("they
 *   likely won't promote so that's a bit ironic that we need to wait"), or an ending.
 * - `due` is the same reading as a timer takes it (`dueLines`): a head line with the count of steps
 *   owed and the oldest's hours, one line a step, and for each live run the count of files of the
 *   code a solve runs (`codeOf`, `tools/d2/campaign.ts`) that differ at the commit the command runs
 *   from, which it does not measure.
 * - `open` starts the investigation of one run, or of several as equals, under `.ana/wri/` of the
 *   main checkout, reading a frozen copy of each live one (`wri.ts start --snapshot`), and marks the
 *   folder an iteration (`iteration.json`): a run is never stopped for its iteration, since stopping
 *   one is the operator's.
 * - `next` reads an investigation's folder and prints the one step left, as a list of gates in the
 *   iteration's order (`gatesOf`). Every folder passes the shared instructions, the lanes, the lane
 *   reports, the synthesis, the vetting, the plan, the pull request (`Pull request: #N` in
 *   `plan.md`) and the fresh runs at its head (`runs fresh --as forkedPR<N>`), which are launched
 *   without asking. An iteration's folder also passes the isolated lanes' decision, each run's
 *   ledgers (`predictions-<run>.md` resolved id by id in `outcomes-<run>.md`, and for a fork what it
 *   carries from the iteration that made it), the vetting of every prediction, the read across
 *   domains (`cross-domain.md`), a plan that answers both and says under "Intentionally opposed"
 *   what it leaves out on purpose, and each fork's ledger.
 * - `ledger` prints the views derived from those files and never written by hand: the cycle view,
 *   every prediction of the folder's runs with its outcome, and each run's still-missing view, what
 *   it did not hold beside its plan's `## Not done` and `## Intentionally opposed`.
 *
 * Every gate is a default, never a wall (operator, 7 November: "to-be-deviated-from each time"): a
 * row `| <step> | <reason> |` in the folder's `deviations.md` passes it, and `next` prints the
 * deviation with the step it reaches, so a session's judgment is kept on the record beside the rule
 * it set aside. An audit of the same day found the loop open where a file only had to exist: a fork
 * carried nothing from its parent, `#60` read the runs of `#600` as its own, and a ledger was picked
 * by the order a folder happened to list.
 *
 * Until 4 November `cycle.ts` read a release cycle's named runs by asking each host to run it in its
 * own tree, printed `stop` at the threshold, and investigated only once no run was live; an
 * iteration there waited on the operator's stop of a run that would never promote, and the step
 * after `investigate` was read by hand from the folder.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe, mainTree } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runSync } from "#src/meta/subprocess.ts";
import { stillRunning } from "#tools/runs/diagnosis.ts";
import { CODE_TREES } from "#tools/d2/campaign.ts";
import { lastLaunch } from "#tools/runs/receipt.ts";
import {
  type Run,
  type Running,
  HERE,
  isCampaign,
  logEvents,
  processes,
  readable,
  readNamed,
} from "#tools/runs/registry.ts";
import { catalogueText, lanesOf } from "#tools/wri/catalogue.ts";
import { INVESTIGATION, SHARED, SYNTHESIS, VETTING } from "#tools/wri/index.ts";
import { blankSections, reportPath } from "#tools/wri/investigation.ts";
import {
  carryOf,
  COUNTED_LINE,
  countedOf,
  cycleViewOf,
  forkOf,
  idsOf,
  ledgerFiles,
  ledgerOf,
  names,
  OUTCOMES,
  outcomesOf,
  pullOf,
  rowsOf,
  sectionOf,
  staleOf,
  stillMissingOf,
} from "#tools/wri/ledger.ts";
import type { LogEvent } from "#src/kernel/log.ts";

/** The read across domains that the plan rests on beside the vetting. */
const ACROSS = "cross-domain.md";
/** The record `open` writes before the investigation: the folder is an iteration's, so its own gates apply. */
const MARKER = "iteration.json";
const PLAN = "plan.md";
/** The gates a session passed on purpose, each with its reason. */
const DEVIATIONS = "deviations.md";
const LEVERS = join(import.meta.dir, "..", "references", "levers.md");
const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/wri2p2.ts";
const USAGE = `usage: bun ${SCRIPT} [due] [<part> ...] [--promotions 2] [--hours 12] [--days 2] | open <name>[,<name>] [--out <dir>] | next <dir> | ledger <dir>`;
const OPTIONS = { promotions: "int", hours: "int", days: "int", out: "abs" } as const;
const HOUR_MS = 3_600_000;
const WRI = "tools/wri/wri.ts";
/** The first line of a step as `nextOf` prints it: its gate, then what the gate owes. */
const STEP = /^step: (?<name>[a-z]+)(?: · (?<rest>.*))?$/u;
const OPPOSED =
  '"## Intentionally opposed" with at least one line ("none" counts): what stays missing on purpose, each as a trade-off, what leaving it out buys, what it costs and why (a trade-off of AGENTS.md section 1, a principle or the operator\'s word)';

/** The trigger's defaults, which name an investigation and stop nothing: two promotions or twelve hours. */
const LIMITS = { promotions: 2, hours: 12 } as const;

/** One run as its log reads. */
interface Row {
  readonly name: string;
  readonly host: string;
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  /** Whether a scored comparison reported every task tied. */
  readonly allTied: boolean;
  readonly ending: string | null;
  readonly hours: number;
}

type Kind = "iteration" | "investigation";

/** One run as the driver reads it: its row, the commit its last launch's receipt names, the
 *  investigation that reads it and the lines of its step. */
interface Standing {
  readonly row: Row;
  /** When its log's last event was written. */
  readonly last: number;
  readonly commit: string | null;
  readonly dir: string | null;
  readonly step: readonly string[];
}

/** One gate: its step, the run it reads or null, and the lines it prints while it is owed. */
type Gate = readonly [step: string, run: string | null, owed: () => string[] | null];

/** Where a run's ledgers are read: the cycles' folders under `root`, and the investigation `dir`;
 *  and how long each run's log is now, or null where this machine cannot read it. */
interface Ledgers {
  readonly root: string;
  readonly dir: string;
  readonly lengthOf: (run: string) => number | null;
}

/** The row of the run `seen` whose log holds `events`, read at `now`. */
export function rowOf(
  seen: { readonly name: string; readonly host: string; readonly live: boolean },
  events: readonly LogEvent[],
  now: number,
): Row {
  const { live } = seen;
  const last = events.at(-1);
  const opened = Date.parse(events[0]?.at ?? "");
  const reported = events.filter(({ kind }) => kind === "comparison.reported");
  return {
    ...seen,
    promotions: events.filter(({ kind }) => kind === "harness.promoted").length,
    compared: reported.length,
    // A comparison that scored nothing tested nothing, so its empty tally is no tie.
    allTied: reported.some(({ data }) => {
      const scored = asRecord(data.scored);
      return data.reading !== "not-scored" && scored?.wins === 0 && scored.losses === 0;
    }),
    ending: last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null,
    // A live run is timed to now: one in a long wait writes nothing, and its clock still runs.
    hours: Number.isNaN(opened) ? 0 : ((live ? now : Date.parse(last?.at ?? "")) - opened) / HOUR_MS,
  };
}

/** Why the iteration opens on `row` now, or null while it runs on. */
export function triggerOf(row: Row, limits: { promotions: number; hours: number } = LIMITS): string | null {
  if (row.promotions >= limits.promotions) return `${String(row.promotions)} promotions`;
  if (row.allTied) return "a comparison left no task untied";
  if (row.hours >= limits.hours) return `${row.hours.toFixed(1)} h since its opening`;
  // A run that ended before any comparison measured nothing an iteration could read.
  if (!row.live && row.compared > 0) return `closed${row.ending === null ? "" : ` (${row.ending})`}`;
  return null;
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** Which gates the folder `dir` takes, read from its one record of that, `iteration.json`. */
const kindOf = (dir: string): Kind => (existsSync(join(dir, MARKER)) ? "iteration" : "investigation");

/** The campaigns the investigation `dir` reads, by name. */
function runsOf(dir: string): string[] {
  // Before 21 October an investigation read one log, named `log`.
  const { logs, log } = parseJsonAs<{ logs?: string[]; log?: string }>(read(join(dir, INVESTIGATION)));
  return (logs ?? (log === undefined ? [] : [log])).map((each) => basename(dirname(each)));
}

/** Each investigation folder under `root`: iterations first, then the newest first by when it started. */
function investigations(root: string): { dir: string; names: string[] }[] {
  if (!existsSync(root)) return [];
  // Folders are named `2026-11-07-…` and `20261101-…` alike, so a name's order is not its age, and
  // a lane's own investigation never takes a run's step from the iteration that reads it.
  return readdirSync(root)
    .filter((entry) => existsSync(join(root, entry, INVESTIGATION)))
    .map((entry) => join(root, entry))
    .map((dir) => ({
      dir,
      iteration: Number(kindOf(dir) === "iteration"),
      at: statSync(join(dir, INVESTIGATION)).mtimeMs,
    }))
    .toSorted((one, other) => other.iteration - one.iteration || other.at - one.at)
    .map(({ dir }) => ({ dir, names: runsOf(dir) }));
}

/** The manifests `wri.ts lanes` wrote in `dir`. */
const manifests = (dir: string) => readdirSync(dir).filter((file) => /^launch(-\d+)*\.json$/u.test(file));
/** The lanes that run alone, as the catalogue says, so a renumbering moves the gate with it. */
const LONE = lanesOf(catalogueText())
  .filter(({ isolated }) => isolated)
  .map(({ number }) => number);

/** The lane sessions the manifests of `dir` launched. */
const sessionsIn = (dir: string) =>
  manifests(dir).flatMap(
    (file) =>
      parseJsonAs<{ sessions: { name: string; task: string; ownedPaths?: string[] }[] }>(
        read(join(dir, file)),
      ).sessions,
  );

/** The lane sessions a manifest of `dir` launched whose reports are not all written. */
function owing(dir: string): { name: string; task: string }[] {
  return sessionsIn(dir).filter(
    // A session that names no report it owns can never be seen to finish, so it owes until a
    // deviation says it ran.
    ({ ownedPaths = [] }) => ownedPaths.length === 0 || ownedPaths.some((path) => !existsSync(path)),
  );
}

/** `name`'s two ledgers as the investigation `dir` reads them; "" for each it has not got, and for
 *  both where its predictions are in two folders, which its own predictions gate names. */
function ledgersOf(root: string, dir: string, name: string) {
  const path = ledgerOf(root, dir, `predictions-${name}.md`);
  const outcomes = path === null ? "" : read(join(dirname(path), `outcomes-${name}.md`));
  return { name, predictions: read(path ?? ""), outcomes };
}

/**
 * What a fork owes the iteration that made it: in its `## Carried` section, each id the parent
 * iteration's runs did not hold, as `<run>:<id>`. A run that is no fork, or whose parent wrote no
 * plan, owes nothing.
 */
function carryOwed(where: Ledgers, run: string, predictions: string): string[] | null {
  const pull = forkOf(run);
  if (pull === null) return null;
  const parents = investigations(where.root)
    .filter(({ dir }) => pullOf(read(join(dir, PLAN))) === pull)
    .flatMap(({ dir, names: runs }) => runs.map((name) => ledgersOf(where.root, dir, name)));
  const { missing: absent } = carryOf(read(predictions), parents);
  return absent.length === 0
    ? null
    : [
        `step: carry · the "## Carried" section of ${predictions} names ${absent.join(", ")}: each id the iteration that made this fork did not hold`,
      ];
}

/** The gates of `run`'s ledgers: its predictions, their outcomes and what it carries. */
function runGates(where: Ledgers, run: string): Gate[] {
  const file = `predictions-${run}.md`;
  const predictions = () => ledgerOf(where.root, where.dir, file) ?? "";
  const beside = (kind: string) => join(dirname(predictions()), `${kind}-${run}.md`);
  // Two copies of the ledger hold every gate of the run, so none reads a copy by listing order and a
  // deviation passes the conflict only at the gate it names.
  const gate = (step: string, owed: () => string[] | null): Gate => [
    step,
    run,
    () => {
      const found = ledgerFiles(where.root, where.dir, file);
      return found.length > 1 ? [`step: ${step} · ${file} is in ${found.join(" and ")}: keep one`] : owed();
    },
  ];
  return [
    gate("predictions", () => {
      if (predictions() === "") {
        return [
          `step: predictions · ${run} has no ${file}: write it in its cycle's folder under ${where.root}, marked as written after its launch`,
        ];
      }
      return idsOf(read(predictions())).length > 0
        ? null
        : [`step: predictions · ${predictions()} holds no table whose first column is "id"`];
    }),
    gate("outcomes", () => {
      const predicted = idsOf(read(predictions()));
      const text = read(beside("outcomes"));
      const outcomes = outcomesOf(text);
      const known: readonly string[] = OUTCOMES;
      const unsettled = predicted.filter((id) => !known.includes(outcomes.get(id) ?? ""));
      const stray = [...outcomes.keys()].filter((id) => !predicted.includes(id));
      const events = where.lengthOf(run);
      // A row left unreached or pending reopens once the log of a run that has stopped grows past
      // the count it was read at, since a run continued after its trigger may yet reach it.
      const stale = staleOf(text, events);
      const counted = countedOf(text);
      const record =
        events === null ? "" : `, and record "${COUNTED_LINE} ${String(events)}" on its own line`;
      const parts = [
        unsettled.length > 0
          ? `resolve ${unsettled.join(", ")} from the log as ${OUTCOMES.join(", ")} (pending only while its event has not come), each with its count or event and the time${record}`
          : "",
        stale.length > 0
          ? `${stale.join(", ")} read unreached or pending at ${counted === null ? "no recorded count" : `${String(counted)} events`} and the log holds ${String(events)} now: resolve them again${record}`
          : "",
        stray.length > 0 ? `${stray.join(", ")} predicted nowhere in ${predictions()}` : "",
      ].filter((part) => part !== "");
      return parts.length === 0 ? null : [`step: outcomes · ${beside("outcomes")}: ${parts.join("; ")}`];
    }),
    gate("carry", () => carryOwed(where, run, predictions())),
  ];
}

/** The rows of the folder `dir`'s `deviations.md`, each step with its reason. */
function deviationsOf(dir: string): Map<string, string> {
  return new Map(
    rowsOf(read(join(dir, DEVIATIONS)), "step")
      .map(([step = "", reason = ""]) => [step, reason] as const)
      .filter(([, reason]) => reason !== ""),
  );
}

/** The first gate owed and not deviated from, as its lines, with each deviation passed on the way. */
function firstOwed(
  gates: readonly Gate[],
  deviated: ReadonlyMap<string, string>,
  passed: string[],
): string[] | null {
  for (const [step, run, owed] of gates) {
    const lines = owed();
    if (lines === null) continue;
    const key = run === null ? step : `${step}:${run}`;
    const reason = step === "done" ? undefined : (deviated.get(key) ?? deviated.get(step));
    if (reason === undefined) return lines;
    passed.push(`deviated: ${key} · ${reason}`);
  }
  return null;
}

/** The iteration's gates for the folder `dir`, in order; an unmarked folder takes the common ones. */
function gatesOf(where: Ledgers, launchedAt: (pull: number) => string[], passed: string[]): Gate[] {
  const { root, dir } = where;
  const at = (file: string) => join(dir, file);
  const wri = (verb: string, more = "") => `  bun ${WRI} ${verb} --out ${dir}${more}`;
  const runs = runsOf(dir);
  const pull = () => pullOf(read(at(PLAN))) ?? 0;
  const kind = kindOf(dir);
  const only = (gates: Gate[]): Gate[] => (kind === "iteration" ? gates : []);
  return [
    [
      "instruct",
      null,
      () => {
        const blank = blankSections(read(at(SHARED)));
        return blank.length === 0
          ? null
          : [`step: instruct · write ${blank.map((heading) => `"${heading}"`).join(", ")} in ${at(SHARED)}`];
      },
    ],
    ["lanes", null, () => (manifests(dir).length > 0 ? null : ["step: lanes", wri("lanes", " --agents 4")])],
    [
      "reports",
      null,
      () => {
        const owed = owing(dir);
        return owed.length === 0
          ? null
          : [
              `step: reports · ${String(owed.length)} lane session(s) owe a report; hand each its line to a wri-lane agent, all in one message`,
              ...owed.map(({ name, task }) => `  ${name}: ${task}`),
            ];
      },
    ],
    ...only([
      [
        "isolated",
        null,
        () =>
          // A lane by the report its session owns, at the path `wri.ts lanes` gave it, whatever its
          // manifest is named: until 9 November the gate read lane numbers from file names, and a
          // lone lane built in the first manifest, `launch.json`, was owed for good.
          sessionsIn(dir).some(({ ownedPaths = [] }) =>
            ownedPaths.some((path) => LONE.some((lane) => path === reportPath(dir, lane))),
          )
            ? null
            : [
                `step: isolated · lanes ${LONE.join(" and ")} run alone, after the reports they wait on: build each whose trigger fired (\`wri.ts lanes\` named it) with${wri("lanes", " --lanes <n>").slice(1)} and launch it alone, or record why not in ${at(DEVIATIONS)} as "| isolated | <reason> |"`,
              ],
      ],
    ]),
    [
      "synthesise",
      null,
      () =>
        existsSync(at(SYNTHESIS))
          ? null
          : [
              "step: synthesise · collect, render the prompt, and hand it to one session that writes synthesis.md",
              `${wri("collect")} && bun ${WRI} synthesis --out ${dir}`,
            ],
    ],
    ...only(runs.flatMap((run) => runGates(where, run))),
    ["vet", null, () => vetOwed(dir, root, runs, kind)],
    ...only([
      [
        "across",
        null,
        () =>
          existsSync(at(ACROSS))
            ? null
            : [
                `step: across · one read-only wri-lane session reads the vetted investigations of the other domains (the newest 5 to 10, none from before the previous minor release) beside ${at(VETTING)}, and writes ${at(ACROSS)}: for each confirmed problem, whether those domains show it and whether an earlier investigation's fix for it should have held here; for each candidate fix, what it changes there and how to keep that intact`,
              ],
      ],
    ]),
    ["plan", null, () => planOwed(where, runs, kind)],
    [
      "implement",
      null,
      () =>
        pull() === 0
          ? [
              `step: implement · one pull request on the top of the stack, then name it in plan.md as "Pull request: #N"`,
            ]
          : null,
    ],
    [
      "launch",
      null,
      () =>
        launchedAt(pull()).length > 0
          ? null
          : [
              `step: launch · take each run's name from the dry run, write its predictions-<run>.md in the cycle's folder (a "## Carried" section for what this iteration did not hold), then fork at #${String(pull())}'s head on the host and login with room`,
              `  bun run runs fresh <pack> --at <#${String(pull())} head> --as forkedPR${String(pull())} --yes`,
            ],
    ],
    ...only([
      [
        "forks",
        null,
        () =>
          firstOwed(
            launchedAt(pull()).flatMap((fork) =>
              runGates(where, fork).filter(([step]) => step === "predictions" || step === "carry"),
            ),
            deviationsOf(dir),
            passed,
          ),
      ],
    ]),
    ["done", null, () => [`step: done · #${String(pull())} is measured by ${launchedAt(pull()).join(", ")}`]],
  ];
}

/**
 * The vetting's step: it exists, and in an iteration it has a row for each run's predictions. An id
 * two runs share must be named as `<run>:<id>`, since one bare mention cannot backtrack both.
 */
function vetOwed(dir: string, root: string, runs: readonly string[], kind: Kind): string[] | null {
  const path = join(dir, VETTING);
  if (!existsSync(path)) {
    return [`step: vet · recount each finding of ${join(dir, SYNTHESIS)} into ${path}, predictions first`];
  }
  if (kind === "investigation") return null;
  const text = read(path);
  const ids = runs.map(
    (run) => [run, idsOf(read(ledgerOf(root, dir, `predictions-${run}.md`) ?? ""))] as const,
  );
  const shared = (id: string) => ids.filter(([, theirs]) => theirs.includes(id)).length > 1;
  const absent = ids.flatMap(([run, theirs]) =>
    theirs
      .filter((id) => !names(text, `${run}:${id}`) && (shared(id) || !names(text, id)))
      .map((id) => `${run}:${id}`),
  );
  return absent.length === 0
    ? null
    : [
        `step: vet · ${path} has no row for ${absent.join(", ")}: backtrack every prediction first, an id two runs share as <run>:<id>`,
      ];
}

/**
 * The plan's step: it exists, and in an iteration it answers the vetting and the read across domains:
 * each confirmed vetting row named as `vet-<n>`, `cross-domain.md` named, and three levers of
 * `references/levers.md` by id (its rule: a plan with repairs only names the three that came closest);
 * and it says what it leaves out on purpose, the one owner of that fact for each run it read. An
 * iteration whose every run kept the section in a `still-missing-<run>.md`, as runs did until
 * 8 November, has said it there.
 */
function planOwed({ root, dir }: Ledgers, runs: readonly string[], kind: Kind): string[] | null {
  const path = join(dir, PLAN);
  if (!existsSync(path)) {
    return [
      `step: plan · repairs and tunings in ${path}, each lever of references/levers.md the run selects a row`,
    ];
  }
  if (kind === "investigation") return null;
  const text = read(path);
  const confirmed = rowsOf(read(join(dir, VETTING)), "#")
    .filter((cells) => cells.some((cell) => cell.toLowerCase().startsWith("confirmed")))
    .map(([row = ""]) => `vet-${row}`);
  const levers = rowsOf(read(LEVERS), "#")
    .map(([id = ""]) => id)
    .filter((id) => names(text, id));
  const absent = [...confirmed, ACROSS].filter((token) => !names(text, token));
  const opposed = (of: string) => (sectionOf(of, "Intentionally opposed") ?? []).length > 0;
  const kept =
    opposed(text) ||
    (runs.length > 0 &&
      runs.every((run) => opposed(read(ledgerOf(root, dir, `still-missing-${run}.md`) ?? ""))));
  if (absent.length === 0 && levers.length >= 3 && kept) return null;
  const parts = [
    absent.length > 0 ? `name ${absent.join(", ")}` : "",
    levers.length < 3 ? `name at least three levers by id (${String(levers.length)} named)` : "",
    kept ? "" : `add ${OPPOSED}`,
  ].filter((part) => part !== "");
  return [`step: plan · ${path}: ${parts.join("; ")}`];
}

/** The step left in the investigation `dir`, as lines, given the runs launched at a pull request. */
export function nextOf(
  dir: string,
  launchedAt: (pull: number) => string[],
  root = dirname(dir),
  lengthOf: Ledgers["lengthOf"] = () => null,
): string[] {
  if (!existsSync(join(dir, INVESTIGATION))) return [`step: open · no investigation in ${dir}`];
  const passed: string[] = [];
  const owed =
    firstOwed(gatesOf({ root, dir, lengthOf }, launchedAt, passed), deviationsOf(dir), passed) ?? [];
  return [...owed, ...passed];
}

/** Each campaign `among` holds that forks `pull`: `forkedPR60` is never a fork of #600. */
const launchedFrom = (among: readonly Run[]) => (pull: number) =>
  among.filter((run) => isCampaign(run) && forkOf(run.name) === pull).map(({ name }) => name);

/** How long each campaign `among` holds by a name is now, read once a name; null for one it does not
 *  hold or that may still write its log (`stillRunning`), whose log grows on every look and so would
 *  reopen its unreached and pending rows at each `next` (review of v0.10.2). */
export function lengthsIn(
  among: readonly Run[],
  running: () => readonly Running[] = processes,
): Ledgers["lengthOf"] {
  const lengths = new Map<string, number | null>();
  let looked: readonly Running[] | undefined;
  return (name) => {
    if (!lengths.has(name)) {
      const run = among.find((each) => isCampaign(each) && each.name === name);
      looked ??= running();
      lengths.set(name, run === undefined || stillRunning(run, looked) ? null : logEvents(run.path).length);
    }
    return lengths.get(name) ?? null;
  };
}

/** The folder every iteration's ledgers are read under: `.ana/wri/` of the main checkout. */
const wriRoot = (repo: string) => join(mainTree(repo), ".ana", "wri");

/** Where every campaign that moved in the last `--days` stands, and how many closed comparing nothing. */
function standings(args: CommandArgs, repo: string, known: readonly Run[], parts = args.positionals) {
  const now = Date.now();
  const days = args.int("days") ?? 2;
  const limits = {
    promotions: args.int("promotions") ?? LIMITS.promotions,
    hours: args.int("hours") ?? LIMITS.hours,
  };
  const running = processes();
  const root = wriRoot(repo);
  const folders = investigations(root);
  const chosen = known.filter(
    (run) =>
      isCampaign(run) &&
      run.seed !== true &&
      (parts.length === 0 || parts.some((part) => run.name.includes(part))) &&
      now - statSync(run.path).mtimeMs < days * 24 * HOUR_MS,
  );
  const all = chosen.map((run): Standing => {
    const events = logEvents(run.path);
    const row = rowOf(
      { name: run.name, host: run.archived ?? HERE, live: stillRunning(run, running) },
      events,
      now,
    );
    const folder = folders.find(({ names: seen }) => seen.includes(row.name));
    const trigger = triggerOf(row, limits);
    const opening =
      trigger === null ? ["step: run"] : [`step: open · ${trigger}`, `  bun ${SCRIPT} open ${row.name}`];
    return {
      row,
      last: Date.parse(events.at(-1)?.at ?? ""),
      commit: lastLaunch(run.path)?.commit ?? null,
      dir: folder?.dir ?? null,
      step: folder === undefined ? opening : nextOf(folder.dir, launchedFrom(known), root, lengthsIn(known)),
    };
  });
  const shown = all.filter(({ row }) => row.live || row.compared > 0);
  return { shown, silent: all.length - shown.length, moved: chosen.length, days, now };
}

/** The view with no verb: one row a run, each with its step. */
function rows(args: CommandArgs, repo: string, known: readonly Run[]): number {
  const { shown, silent, moved, days } = standings(args, repo, known);
  for (const { row, step } of shown) {
    const state = row.live ? "live" : `closed${row.ending === null ? "" : ` (${row.ending})`}`;
    console.log(
      `${row.name} · ${row.host} · ${state} · ${String(row.promotions)} promoted in ${String(row.compared)} compared · ${row.hours.toFixed(1)} h`,
    );
    for (const line of step) console.log(`  ${line}`);
  }
  if (silent > 0) console.log(`and ${String(silent)} closed run(s) that compared nothing`);
  if (moved === 0) console.log(`no campaign moved in the last ${String(days)} day(s)`);
  return 0;
}

/**
 * The short view a timer reads instead of walking the folders: a head line, then one line for each
 * step that is owed, a live run's unread trigger first and then the longest-standing, with the
 * command that prints the step whole. Runs that share a folder's step share its line. A step is
 * timed from the last write under its folder (`writtenAt`), a closed run's unread trigger from its
 * last event, and one that has stood for `days` or more is only counted, since nobody is taking it:
 * until 10 November the view with no verb listed such a folder's every owed lane at each look, and
 * fourteen iterations stood at `plan` unseen.
 */
export function dueLines(
  standing: readonly Pick<Standing, "row" | "last" | "dir" | "step">[],
  writtenAt: (dir: string) => number,
  now: number,
  days = 2,
): string[] {
  const owed = new Map<
    string,
    { name: string; rest: string; dir: string | null; since: number | null; runs: string[] }
  >();
  for (const { row, last, dir, step } of standing) {
    const { name = "", rest = "" } = step.map((line) => STEP.exec(line)?.groups).find(Boolean) ?? {};
    if (name === "" || name === "run" || name === "done") continue;
    const key = `${dir ?? row.name} ${name}`;
    const unread = row.live ? null : last;
    const since = dir === null ? unread : writtenAt(dir);
    owed.set(key, { name, rest, dir, since, runs: [...(owed.get(key)?.runs ?? []), row.name] });
  }
  const timed = [...owed.values()].map((each) => ({
    ...each,
    hours: each.since === null ? null : (now - each.since) / HOUR_MS,
  }));
  const left = timed.filter(({ hours }) => hours !== null && hours >= days * 24);
  const taken = timed
    .filter((each) => !left.includes(each))
    .toSorted((one, other) => (other.hours ?? Infinity) - (one.hours ?? Infinity));
  const oldest = Math.max(0, ...taken.map(({ hours }) => hours ?? 0));
  const listed = taken.length === 0 ? "" : `, the oldest listed for ${oldest.toFixed(1)} h`;
  const live = standing.filter(({ row }) => row.live).length;
  return [
    `due at ${new Date(now).toISOString().slice(0, 16)}Z · ${
      timed.length === 0 ? "nothing owed" : `${String(timed.length)} step(s) owed${listed}`
    } · ${String(live)} run(s) live`,
    ...taken.map(({ name, rest, dir, runs: [first = "", ...others], hours }) => {
      const more = others.length > 0 ? ` and ${String(others.length)} more` : "";
      const where = dir === null ? `${rest} · bun ${SCRIPT} open ${first}` : `bun ${SCRIPT} next ${dir}`;
      return `${name} · ${hours === null ? "new" : `${hours.toFixed(1)} h`} · ${first}${more} · ${where}`;
    }),
    ...(left.length === 0
      ? []
      : [
          `and ${String(left.length)} of them owed for ${String(days)} day(s) or more: take each or pass it with a row in its deviations.md`,
        ]),
  ];
}

/** When anything under the investigation `dir` or its lanes was last written; an entry that cannot
 *  be read, such as a broken link, is passed over. */
function changedAt(dir: string): number {
  const entries = (folder: string) =>
    existsSync(folder) ? readdirSync(folder).map((entry) => join(folder, entry)) : [];
  return Math.max(
    ...[dir, ...entries(dir), ...entries(join(dir, "lanes"))].flatMap((path) => {
      try {
        return [statSync(path).mtimeMs];
      } catch {
        return [];
      }
    }),
  );
}

/** What stands between a live run and the commit `head` of the tree `repo`: the files of the code a
 *  solve runs (`codeOf`'s trees, `package.json` and `bun.lock`) that differ there, which no run has
 *  yet measured. The run's commit is its last launch's receipt, which a gathered copy carries beside
 *  its log. */
export function unmeasured(repo: string, head: string, { row, commit }: Standing): string {
  if (commit === null) return `measures · ${row.name} · no launch receipt names its commit`;
  // Files and not commits: a landing beneath replays a pull request onto new commits of one tree.
  const paths = [...CODE_TREES, "package.json", "bun.lock"];
  const moved = gitMaybe(repo, "diff", "--name-only", commit, head, "--", ...paths);
  const files = moved?.split("\n").filter(Boolean).length ?? 0;
  const reading =
    moved === null
      ? `its diff against ${head.slice(0, 9)} could not be read`
      : files === 0
        ? `${head.slice(0, 9)}, the commit this command runs from, changes nothing it runs`
        : `${String(files)} file(s) of the code a solve runs differ at ${head.slice(0, 9)}, the commit this command runs from, measured by no run until one is forked there`;
  return `measures · ${row.name} · ${commit.slice(0, 9)} · ${reading}`;
}

function due(args: CommandArgs, repo: string, known: readonly Run[]): number {
  const { shown, days, now } = standings(args, repo, known, args.positionals.slice(1));
  const head = gitMaybe(repo, "rev-parse", "HEAD") ?? "HEAD";
  for (const line of dueLines(shown, changedAt, now, days)) console.log(line);
  for (const each of shown.filter(({ row }) => row.live)) console.log(unmeasured(repo, head, each));
  return 0;
}

function open(args: CommandArgs, repo: string): number {
  const runs = (args.positionals[1] ?? "").split(",").filter((name) => name !== "");
  if (runs.length === 0) args.die(USAGE);
  const logs = runs.map((name) => readNamed(name, repo).path);
  const day = new Date().toISOString().slice(0, 10);
  const out = resolve(args.value("out") ?? join(wriRoot(repo), `${day}-${runs.join("+")}`));
  // The record first, so a crash before the start reads `step: open` (until 9 November it came after,
  // and a crash between left an iteration read as a plain investigation, skipping its own gates).
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, MARKER),
    `${JSON.stringify({ opened: new Date().toISOString(), runs }, null, 2)}\n`,
  );
  const started = runSync(
    [capturedExecPath, WRI, "start", "--log", logs.join(","), "--out", out, "--snapshot"],
    {
      cwd: repo,
    },
  );
  runtimeProcess.stdout.write(started.stdout);
  runtimeProcess.stderr.write(started.stderr);
  if (started.exitCode !== 0) return started.exitCode ?? 1;
  for (const line of nextOf(out, () => [], wriRoot(repo))) console.log(line);
  return 0;
}

/**
 * The views derived from the ledgers of `dir`, an investigation's folder or a cycle's: the cycle view
 * of every run it holds, then each run's still-missing view beside the plan of the iteration that
 * read it (`dir`'s own, or the latest that names the run).
 */
export function ledgerViews(dir: string, root: string, lengthOf: Ledgers["lengthOf"]): string[] {
  const runs = existsSync(join(dir, INVESTIGATION))
    ? runsOf(dir)
    : readdirSync(dir).flatMap((file) => /^predictions-(.+)\.md$/u.exec(file)?.[1] ?? []);
  const readers = investigations(root);
  const ledgers = runs.map((name) => {
    const iteration = existsSync(join(dir, INVESTIGATION))
      ? dir
      : readers.find(({ names: theirs }) => theirs.includes(name))?.dir;
    const plan = iteration === undefined ? "" : read(join(iteration, PLAN));
    const older = read(ledgerOf(root, dir, `still-missing-${name}.md`) ?? "");
    return { ...ledgersOf(root, dir, name), plan, older, events: lengthOf(name) };
  });
  return [
    `# Ledger views of ${dir}`,
    "",
    "Derived from each run's predictions and outcomes and its iteration's plan: never write them by hand.",
    "",
    ...cycleViewOf(ledgers),
    ...ledgers.flatMap((run) => ["", ...stillMissingOf(run)]),
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const repo = runtimeProcess.cwd();
  const [verb] = args.positionals;
  if (verb === "open") return open(args, repo);
  if (verb === "next") {
    const dir = args.positionals[1];
    if (dir === undefined) args.die(USAGE);
    const known = readable(repo);
    const lines = nextOf(resolve(dir), launchedFrom(known), wriRoot(repo), lengthsIn(known));
    for (const line of lines) console.log(line);
    return 0;
  }
  if (verb === "ledger") {
    const dir = args.positionals[1];
    if (dir === undefined) args.die(USAGE);
    for (const line of ledgerViews(resolve(dir), wriRoot(repo), lengthsIn(readable(repo)))) {
      console.log(line);
    }
    return 0;
  }
  return verb === "due" ? due(args, repo, readable(repo)) : rows(args, repo, readable(repo));
}

if (import.meta.main) {
  await runCommand({ name: "wri2p2", usage: USAGE, options: OPTIONS, positionals: [0, 64] }, main);
}

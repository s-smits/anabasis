#!/usr/bin/env bun
/**
 * WRI2P2, the iteration of the skill's "The iteration", read as one step at a time from what is on
 * disk, so a session or a timer runs one line and takes the step it prints. It writes nothing but an
 * investigation's own files, through `wri.ts`, and the marker `open` leaves; it stops, launches and
 * merges nothing.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...] [--days 2]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due [<part> ...] [--days 2]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>...] [--out <dir>]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts ledger <dir>
 *
 * - With no verb it reads every campaign this machine reads that is live or whose last event lies in
 *   the last `--days` (`readable`: the worktrees' and the copies the central host's ten-minute gather
 *   keeps of every peer's, live ones included, each with the liveness its host last reported) and
 *   prints one row a run and its step: `run` while no trigger fired, `pause` once one did on a live
 *   run, `open` once the run has stopped, or the investigation's next step once one reads it. The
 *   trigger is whichever comes first (operator, 4 November; `triggerOf`): the promotions, the hours
 *   since the opening, a scored comparison that left no task untied ("they likely won't promote so
 *   that's a bit ironic that we need to wait"), or an ending. At a live run's trigger the step is a
 *   pause at the first clean point after its next comparison (`runs pause --after reported`, which
 *   waits for no session to be open), and the investigation opens once the run has stopped, so its
 *   synthesis reads that comparison (operator, 10 November: "pause it after next comparison (ensure
 *   the comparison pause actually includes the synthesis of this)", "not directly after solves").
 *   Until then a live run was investigated on a frozen copy taken at the trigger, and the proof run
 *   of v0.11.0 promoted once more and read two comparisons its synthesis never saw.
 * - `due` is the same reading as a timer takes it (`dueLines`): a head line with the count of steps
 *   owed and the oldest's hours, one line a step, and for each live run the count of files of the
 *   code a solve runs (`codeOf`, `tools/d2/campaign.ts`) that differ at the commit the command runs
 *   from, which it does not measure.
 * - `open` starts the investigation of one run, or of several as equals, under `.ana/wri/` of the
 *   main checkout, reading a frozen copy of any one still live (`wri.ts start --snapshot`), and marks
 *   the folder an iteration (`iteration.json`). Opening a live run is a deviation from the `pause`
 *   step, kept for a run the operator leaves running.
 * - `next` reads an investigation's folder and prints the one step left, the first owed of a list of
 *   gates in the iteration's order (`gatesOf`). Every folder passes the shared instructions, the
 *   lanes, the lane reports, the synthesis, the vetting, the plan, the pull request
 *   (`Pull request: #N` in `plan.md`) and the fresh runs at its head (`runs fresh --as forkedPR<N>`),
 *   which are launched without asking. An iteration's folder also passes the isolated lanes'
 *   decision, each run's ledgers (`predictions-<run>.md` resolved id by id in `outcomes-<run>.md`,
 *   and for a fork what it carries from the iteration that made it), the vetting of every
 *   prediction, the read across domains (`cross-domain.md`), a plan that answers both and says under
 *   "Intentionally opposed" what it leaves out on purpose, each fork's ledger, and the plan's own
 *   predictions carried into a fork's (`planOwed`); a jobstat run's also passes its row in
 *   `outside-reads.md` (`outsideGate`).
 * - `ledger` prints the views derived from those files and never written by hand: the cycle view,
 *   every prediction of the folder's runs with its outcome; the dropped view, each unreached or
 *   falsified id that no `## Carried` and no plan's `## Not done` names; and each run's still-missing
 *   view, what it did not hold beside its plan's `## Not done` and `## Intentionally opposed`.
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
 * after `investigate` was read by hand from the folder. Until 13 November the trigger's promotions
 * and hours were options no recorded invocation passed, and the views parsed every log whose file
 * had moved in the days (130 logs for 12 runs that day) to find those whose last event lay in them.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { lastAt } from "#skills/main/logs.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
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
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runSync } from "#src/meta/subprocess.ts";
import { CODE_TREES } from "#tools/d2/campaign.ts";
import { stillRunning } from "#tools/runs/diagnosis.ts";
import { lastLaunch } from "#tools/runs/receipt.ts";
import {
  HERE,
  isCampaign,
  logEvents,
  processes,
  type Run,
  type Running,
  readable,
  readNamed,
  waiters,
  wholeLines,
} from "#tools/runs/registry.ts";
import { DRIVER, openingCommand, type Progress, progressOf, triggerOf } from "#tools/runs/said.ts";
import { catalogueText, lanesOf } from "#tools/wri/catalogue.ts";
import { INVESTIGATION, SHARED, SYNTHESIS, VETTING } from "#tools/wri/index.ts";
import { blankSections, reportPath } from "#tools/wri/investigation.ts";
import {
  COUNTED_LINE,
  carriedIn,
  carryOf,
  countedOf,
  cycleViewOf,
  droppedOf,
  idsOf,
  launchForks,
  ledgerFiles,
  ledgerOf,
  madeBy,
  names,
  notDoneOf,
  OUTCOMES,
  outcomesOf,
  pullOf,
  rowsOf,
  sectionOf,
  staleOf,
  stillMissingOf,
} from "#tools/wri/ledger.ts";

/** The read across domains that the plan rests on beside the vetting. */
const ACROSS = "cross-domain.md";
/** The record `open` writes before the investigation: the folder is an iteration's, so its own gates apply. */
const MARKER = "iteration.json";
const PLAN = "plan.md";
/** The gates a session passed on purpose, each with its reason. */
const DEVIATIONS = "deviations.md";
/** One row a stopped jobstat run, in a cycle's folder: its reference's read on the outside benchmark. */
const OUTSIDE = "outside-reads.md";
/** The row of `deviations.md` that passes every gate of the forks' ledgers at once. */
const FORKS = "forks";
const LEVERS = join(import.meta.dir, "..", "references", "levers.md");
const USAGE = `usage: bun ${DRIVER} [due] [<part> ...] [--days 2] | open <name>[,<name>] [--out <dir>] | next <dir> | ledger <dir>`;
const OPTIONS = { days: "int", out: "abs" } as const;
const WRI = "tools/wri/wri.ts";
/** The first line of a step as `nextOf` prints it: its gate, then what the gate owes. */
const STEP = /^step: (?<name>[a-z]+)(?: · (?<rest>.*))?$/u;
/** The steps that owe nobody anything: a run that runs on, waits for its pause or is measured. */
const QUIET = new Set(["", "run", "waits", "done"]);
const OPPOSED =
  '"## Intentionally opposed" with at least one line ("none" counts): what stays missing on purpose, each as a trade-off, what leaving it out buys, what it costs and why (a trade-off of AGENTS.md section 1, a principle or the operator\'s word)';

/** One run as its log reads. */
type Row = Progress & { readonly name: string; readonly host: string };

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

/** One gate of the iteration. */
interface Gate {
  readonly step: string;
  /** The rows of `deviations.md` that pass it, the one it is printed under first: its own
   *  (`<step>:<run>` for a gate of one run's ledgers), its step's, then its group's. None passes `done`. */
  readonly keys: readonly string[];
  /** Null once it is met; else what follows `step: <step> · `, then any lines after that one. */
  readonly owed: () => readonly string[] | null;
}

/** What a step is read from beside its folder: the folder that holds the cycles' (`.ana/wri/`), the
 *  names of the campaigns this machine reads, among which a pull request's forks are found, and how
 *  long each run's log is now, or null where this machine cannot read it. */
interface Known {
  readonly root?: string;
  readonly campaigns?: readonly string[];
  readonly lengthOf?: (run: string) => number | null;
}
type Where = Required<Known> & { readonly dir: string };

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** Whether the folder `dir` takes an iteration's gates, read from its one record of that. */
const marked = (dir: string) => existsSync(join(dir, MARKER));

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
    .map((dir) => ({ dir, iteration: Number(marked(dir)), at: statSync(join(dir, INVESTIGATION)).mtimeMs }))
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

/** `name`'s two ledgers as the investigation `dir` reads them; "" for each it has not got, and for
 *  both where its predictions are in two folders, which its own predictions gate names. */
function ledgersOf(root: string, dir: string, name: string) {
  const path = ledgerOf(root, dir, `predictions-${name}.md`);
  const outcomes = path === null ? "" : read(join(dirname(path), `outcomes-${name}.md`));
  return { name, predictions: read(path ?? ""), outcomes };
}

/** What the outcomes ledger of `run`, beside its predictions at `path`, has left to resolve. */
function outcomesOwed({ lengthOf }: Where, run: string, path: string): string[] | null {
  const beside = path === "" ? "" : join(dirname(path), `outcomes-${run}.md`);
  const predicted = idsOf(read(path));
  const text = read(beside);
  const outcomes = outcomesOf(text);
  const known: readonly string[] = OUTCOMES;
  const unsettled = predicted.filter((id) => !known.includes(outcomes.get(id) ?? ""));
  const stray = [...outcomes.keys()].filter((id) => !predicted.includes(id));
  const events = lengthOf(run);
  // A row left unreached or pending reopens once the log of a run that has stopped grows past the
  // count it was read at, since a run continued after its trigger may yet reach it.
  const stale = staleOf(text, events);
  const counted = countedOf(text);
  const record = events === null ? "" : `, and record "${COUNTED_LINE} ${String(events)}" on its own line`;
  const parts = [
    unsettled.length > 0
      ? `resolve ${unsettled.join(", ")} from the log as ${OUTCOMES.join(", ")} (pending only while its event has not come), each with its count or event and the time${record}`
      : "",
    stale.length > 0
      ? `${stale.join(", ")} read unreached or pending at ${counted === null ? "no recorded count" : `${String(counted)} events`} and the log holds ${String(events)} now: resolve them again${record}`
      : "",
    stray.length > 0 ? `${stray.join(", ")} predicted nowhere in ${path}` : "",
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : [`${beside}: ${parts.join("; ")}`];
}

/**
 * What `run`, whose predictions are at `path`, owes the iterations that made it (`madeBy`): in its
 * `## Carried` section, each id their runs did not hold, as `<run>:<id>`. A run no iteration made
 * owes nothing.
 */
function carryOwed({ root }: Where, run: string, path: string): string[] | null {
  const parents = investigations(root)
    .filter(({ dir }) => madeBy(read(join(dir, PLAN)), read(join(dir, DEVIATIONS)), run))
    .flatMap(({ dir, names: runs }) => runs.map((name) => ledgersOf(root, dir, name)));
  const { missing } = carryOf(read(path), parents);
  return missing.length === 0
    ? null
    : [
        `the "## Carried" section of ${path} names ${missing.join(", ")}: each id the iteration that made this fork did not hold`,
      ];
}

/**
 * What an iteration's `plan` owes the predictions it writes itself: each id of its own `id` tables
 * named in a fork's `predictions-<run>.md` or under its `## Not done`. Until 13 November 2026 such a
 * row had no owner that carried it into a run's file, so no outcomes file read it.
 */
function planOwed({ root, dir }: Where, plan: string, forks: readonly string[]): string[] | null {
  const taken = [
    ...forks.map((fork) => read(ledgerOf(root, dir, `predictions-${fork}.md`) ?? "")),
    ...notDoneOf(plan),
  ].join("\n");
  const absent = idsOf(plan).filter((id) => !names(taken, id));
  return absent.length === 0
    ? null
    : [
        `${join(dir, PLAN)} predicts ${absent.join(", ")}, which no fork's predictions file names: write each into a fork's predictions-<run>.md, or under the plan's "## Not done" with why no run reads it`,
      ];
}

/** The gates of `run`'s ledgers: its predictions, their outcomes and what it carries. */
function runGates(where: Where, run: string, group: readonly string[] = []): Gate[] {
  const file = `predictions-${run}.md`;
  // Two copies of the ledger hold every gate of the run, so none reads a copy by listing order and a
  // deviation passes the conflict only at the gate it names.
  const gate = (step: string, owed: (predictions: string) => readonly string[] | null): Gate => ({
    step,
    keys: [`${step}:${run}`, step, ...group],
    owed: () => {
      const found = ledgerFiles(where.root, where.dir, file);
      return found.length > 1 ? [`${file} is in ${found.join(" and ")}: keep one`] : owed(found[0] ?? "");
    },
  });
  return [
    gate("predictions", (path) => {
      const absent = `${run} has no ${file}: write it in its cycle's folder under ${where.root}, marked as written after its launch`;
      const empty = `${path} holds no table whose first column is "id"`;
      return path !== "" && idsOf(read(path)).length > 0 ? null : [path === "" ? absent : empty];
    }),
    gate("outcomes", (path) => outcomesOwed(where, run, path)),
    gate("carry", (path) => carryOwed(where, run, path)),
  ];
}

/**
 * The outside read a jobstat run owes once it has stopped (run-improvement-campaign, "The outside
 * aim"): a row that names it in a cycle's `outside-reads.md`, scored, skipped or still owed. Four
 * jobstat runs were investigated from 10 to 12 November 2026 with two promotions each and none was
 * read, since only prose asked for it. A run of another domain owes none.
 */
function outsideGate({ root, dir }: Where, run: string): Gate[] {
  if (!run.startsWith("jobstat")) return [];
  const named = () =>
    ledgerFiles(root, dir, OUTSIDE).some((path) => rowsOf(read(path), "run").some(([name]) => name === run));
  const owed = `${run} has no row in ${OUTSIDE} of its cycle's folder under ${root}: read its newest promoted reference on the eight tasks beside a fresh Starter (run-improvement-campaign, "A reference's read"), then add the row whose first cell is the run's name, with its scores, "skipped" with lane 27's grade or no promotion, or "owed" with what the read waits for`;
  return [{ step: "outside", keys: [`outside:${run}`, "outside"], owed: () => (named() ? null : [owed]) }];
}

/** An iteration's vetting has a row for each prediction of its runs. An id two runs share must be
 *  named as `<run>:<id>`, since one bare mention cannot backtrack both. */
function unvetted({ root, dir }: Where, runs: readonly string[]): string[] | null {
  const text = read(join(dir, VETTING));
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
        `${join(dir, VETTING)} has no row for ${absent.join(", ")}: backtrack every prediction first, an id two runs share as <run>:<id>`,
      ];
}

/**
 * An iteration's plan answers the vetting and the read across domains: each confirmed vetting row
 * named as `vet-<n>`, `cross-domain.md` named, and three levers of `references/levers.md` by id (its
 * rule: a plan with repairs only names the three that came closest); and it says what it leaves out
 * on purpose, the one owner of that fact for each run it read. An iteration whose every run kept the
 * section in a `still-missing-<run>.md`, as runs did until 8 November, has said it there.
 */
function unanswered({ root, dir }: Where, runs: readonly string[]): string[] | null {
  const text = read(join(dir, PLAN));
  const confirmed = rowsOf(read(join(dir, VETTING)), "#")
    .filter((cells) => cells.some((cell) => cell.toLowerCase().startsWith("confirmed")))
    .map(([row = ""]) => `vet-${row}`);
  const levers = rowsOf(read(LEVERS), "#").filter(([id = ""]) => names(text, id)).length;
  const absent = [...confirmed, ACROSS].filter((token) => !names(text, token));
  const opposed = (of: string) => (sectionOf(of, "Intentionally opposed") ?? []).length > 0;
  const kept =
    opposed(text) ||
    (runs.length > 0 &&
      runs.every((run) => opposed(read(ledgerOf(root, dir, `still-missing-${run}.md`) ?? ""))));
  const parts = [
    absent.length > 0 ? `name ${absent.join(", ")}` : "",
    levers < 3 ? `name at least three levers by id (${String(levers)} named)` : "",
    kept ? "" : `add ${OPPOSED}`,
  ].filter((part) => part !== "");
  return parts.length === 0 ? null : [`${join(dir, PLAN)}: ${parts.join("; ")}`];
}

/** The iteration's gates for the folder `where.dir`, in order; an unmarked folder takes the shared
 *  ones, as the sequence it was started under had them. */
function gatesOf(where: Where): Gate[] {
  const { dir } = where;
  const at = (file: string) => join(dir, file);
  const wri = (verb: string, more = "") => `  bun ${WRI} ${verb} --out ${dir}${more}`;
  const gate = (step: string, owed: Gate["owed"]): Gate => ({ step, keys: [step], owed });
  const present = (step: string, file: string, ...owed: string[]) =>
    gate(step, () => (existsSync(at(file)) ? null : owed));
  const only = (gates: Gate[]): Gate[] => (marked(dir) ? gates : []);
  const runs = runsOf(dir);
  const plan = read(at(PLAN));
  const deviations = read(at(DEVIATIONS));
  const pull = String(pullOf(plan) ?? 0);
  // The forks of this iteration: each campaign read here that forks its plan's pull request, and
  // each its `launch` deviation names, which this machine need not read.
  const forks = [...new Set([...where.campaigns, ...launchForks(deviations)])].filter((name) =>
    madeBy(plan, deviations, name),
  );
  return [
    gate("instruct", () => {
      const blank = blankSections(read(at(SHARED)));
      return blank.length === 0
        ? null
        : [`write ${blank.map((heading) => `"${heading}"`).join(", ")} in ${at(SHARED)}`];
    }),
    gate("lanes", () => (manifests(dir).length > 0 ? null : ["", wri("lanes", " --agents 4")])),
    gate("reports", () => {
      // A session that names no report it owns can never be seen to finish, so it owes until a
      // deviation says it ran.
      const owed = sessionsIn(dir).filter(
        ({ ownedPaths = [] }) => ownedPaths.length === 0 || ownedPaths.some((path) => !existsSync(path)),
      );
      return owed.length === 0
        ? null
        : [
            `${String(owed.length)} lane session(s) owe a report; hand each its line to a wri-lane agent, all in one message`,
            ...owed.map(({ name, task }) => `  ${name}: ${task}`),
          ];
    }),
    ...only([
      gate("isolated", () =>
        // A lane by the report its session owns, at the path `wri.ts lanes` gave it, whatever its
        // manifest is named: until 9 November the gate read lane numbers from file names, and a
        // lone lane built in the first manifest, `launch.json`, was owed for good.
        sessionsIn(dir).some(({ ownedPaths = [] }) =>
          ownedPaths.some((path) => LONE.some((lane) => path === reportPath(dir, lane))),
        )
          ? null
          : [
              `lanes ${LONE.join(" and ")} run alone, after the reports they wait on: build each whose trigger fired (\`wri.ts lanes\` named it) with${wri("lanes", " --lanes <n>").slice(1)} and launch it alone, or record why not in ${at(DEVIATIONS)} as "| isolated | <reason> |"`,
            ],
      ),
    ]),
    present(
      "synthesise",
      SYNTHESIS,
      "collect, render the prompt, and hand it to one session that writes synthesis.md",
      `${wri("collect")} && bun ${WRI} synthesis --out ${dir}`,
    ),
    ...only(runs.flatMap((run) => [...runGates(where, run), ...outsideGate(where, run)])),
    present(
      "vet",
      VETTING,
      `recount each finding of ${at(SYNTHESIS)} into ${at(VETTING)}, predictions first`,
    ),
    ...only([
      gate("vet", () => unvetted(where, runs)),
      present(
        "across",
        ACROSS,
        `one read-only wri-lane session reads the vetted investigations of the other domains (the newest 5 to 10, none from before the previous minor release) beside ${at(VETTING)}, and writes ${at(ACROSS)}: for each confirmed problem, whether those domains show it and whether an earlier investigation's fix for it should have held here; for each candidate fix, what it changes there and how to keep that intact`,
      ),
    ]),
    present(
      "plan",
      PLAN,
      `repairs and tunings in ${at(PLAN)}, each lever of references/levers.md the run selects a row`,
    ),
    ...only([gate("plan", () => unanswered(where, runs))]),
    gate("implement", () =>
      pull === "0"
        ? [`one pull request on the top of the stack, then name it in plan.md as "Pull request: #N"`]
        : null,
    ),
    gate("launch", () =>
      forks.length > 0
        ? null
        : [
            `take each run's name from the dry run, write its predictions-<run>.md in the cycle's folder (a "## Carried" section for what this iteration did not hold), then fork at #${pull}'s head on the host and login with room`,
            `  bun run runs fresh <pack> --at <#${pull} head> --as forkedPR${pull} --yes`,
          ],
    ),
    // A fork owes its own predictions and what it carries; its outcomes are its own iteration's.
    ...only(
      forks.flatMap((fork) => runGates(where, fork, [FORKS]).filter(({ step }) => step !== "outcomes")),
    ),
    // The plan's own predictions are carried as its runs' are, and only a reason of their own passes it.
    ...only([{ step: "carry", keys: ["carry:plan"], owed: () => planOwed(where, plan, forks) }]),
    { step: "done", keys: [], owed: () => [`#${pull} is measured by ${forks.join(", ")}`] },
  ];
}

/** The step left in the investigation `dir`, as lines: the first gate owed that no row of its
 *  `deviations.md` passes, then each deviation passed on the way, with its reason. */
export function nextOf(dir: string, known: Known = {}): string[] {
  if (!existsSync(join(dir, INVESTIGATION))) return [`step: open · no investigation in ${dir}`];
  const { root = dirname(dir), campaigns = [], lengthOf = () => null } = known;
  const deviated = new Map(
    rowsOf(read(join(dir, DEVIATIONS)), "step").map(([step = "", reason = ""]) => [step, reason] as const),
  );
  const passed = new Set<string>();
  for (const { step, keys, owed } of gatesOf({ root, campaigns, lengthOf, dir })) {
    const lines = owed();
    if (lines === null) continue;
    // A row with no reason records no judgment, so it passes nothing.
    const key = keys.find((each) => (deviated.get(each) ?? "") !== "");
    if (key === undefined) {
      const [rest = "", ...more] = lines;
      return [`step: ${step}${rest === "" ? "" : ` · ${rest}`}`, ...more, ...passed];
    }
    passed.add(`deviated: ${key === step ? (keys[0] ?? key) : key} · ${deviated.get(key) ?? ""}`);
  }
  return [...passed];
}

/** How long each campaign `among` holds by a name is now, read once a name; null for one it does not
 *  hold or that may still write its log (`stillRunning`), whose log grows on every look and so would
 *  reopen its unreached and pending rows at each `next` (review of v0.10.2). */
export function lengthsIn(
  among: readonly Run[],
  running: () => readonly Running[] = processes,
): Where["lengthOf"] {
  const lengths = new Map<string, number | null>();
  let looked: readonly Running[] | undefined;
  return (name) => {
    if (!lengths.has(name)) {
      const run = among.find((each) => isCampaign(each) && each.name === name);
      looked ??= running();
      // Its whole lines counted, which is its events without parsing each.
      const events = () => wholeLines(run?.path ?? "").split("\n").length - 1;
      lengths.set(name, run === undefined || stillRunning(run, looked) ? null : events());
    }
    return lengths.get(name) ?? null;
  };
}

/** The folder every iteration's ledgers are read under: `.ana/wri/` of the main checkout. */
const wriRoot = (repo: string) => join(mainTree(repo), ".ana", "wri");

/** What every step one command prints is read from, beside its folder. */
const knownIn = (repo: string, known: readonly Run[], running: () => readonly Running[] = processes) => ({
  root: wriRoot(repo),
  campaigns: known.filter(isCampaign).map(({ name }) => name),
  lengthOf: lengthsIn(known, running),
});

/** The campaigns of `known` that are live or whose log's last event lies in the last `days`, each
 *  with whether it is live, and only those whose name holds one of `parts` where any is given. A
 *  log's last event is read from its tail (`lastAt`), so a view opens only the logs it shows. Its
 *  file's time says nothing: a fetch writes a run's copy again, and on 10 November 113 of the 119
 *  archived logs written in two days held no event of those days, so 18 steps read as owed. */
export const movedIn = (
  known: readonly Run[],
  running: readonly Running[],
  now: number,
  days: number,
  parts: readonly string[] = [],
) =>
  known
    .filter((run) => isCampaign(run) && run.seed !== true)
    .filter((run) => parts.length === 0 || parts.some((part) => run.name.includes(part)))
    .map((run) => ({ run, live: stillRunning(run, running) }))
    .filter(({ run, live }) => live || now - Date.parse(lastAt(run.path)) < days * 24 * HOUR_MS);

/** The step of a run no investigation reads yet: `run` before its trigger; at the trigger of a live
 *  run, a pause after its next comparison, or `waits` once a pause of it is armed here; and `open` once
 *  it has stopped, so the investigation reads the comparison the pause waited for. */
export function openingOf(
  row: { readonly name: string; readonly host: string; readonly live: boolean },
  trigger: string | null,
  running: readonly Running[],
): string[] {
  if (trigger === null) return ["step: run"];
  const command = `  ${openingCommand(row.name, row.live, row.host === HERE ? "" : `on ${row.host} `)}`;
  if (!row.live) return [`step: open · ${trigger}`, command];
  if (waiters(row.name, running).length > 0) {
    return [`step: waits · ${trigger}; its pause after the next comparison is armed`];
  }
  return [
    `step: pause · ${trigger}; the investigation opens once the run stops after its next comparison`,
    command,
  ];
}

/** Where every campaign that moved in the last `--days` stands, and how many closed comparing nothing. */
function standings(args: CommandArgs, repo: string, known: readonly Run[], parts = args.positionals) {
  const now = Date.now();
  const days = args.int("days") ?? 2;
  const running = processes();
  const iteration = knownIn(repo, known, () => running);
  const folders = investigations(iteration.root);
  const all = movedIn(known, running, now, days, parts).map(({ run, live }): Standing => {
    const events = logEvents(run.path);
    const row = progressOf({ name: run.name, host: run.archived ?? HERE, live }, events, now);
    const folder = folders.find(({ names: seen }) => seen.includes(row.name));
    return {
      row,
      last: Date.parse(events.at(-1)?.at ?? ""),
      commit: lastLaunch(run.path)?.commit ?? null,
      dir: folder?.dir ?? null,
      step: folder === undefined ? openingOf(row, triggerOf(row), running) : nextOf(folder.dir, iteration),
    };
  });
  const shown = all.filter(({ row }) => row.live || row.compared > 0);
  return { shown, silent: all.length - shown.length, moved: all.length, days, now };
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
  const owed = new Map<string, { name: string; where: string; hours: number; runs: string[] }>();
  for (const { row, last, dir, step } of standing) {
    const { name = "", rest = "" } = step.map((line) => STEP.exec(line)?.groups).find(Boolean) ?? {};
    if (QUIET.has(name)) continue;
    const command = step.find((line) => line.startsWith("  "))?.trim() ?? `bun ${DRIVER} open ${row.name}`;
    // A live run's trigger has stood for no time a clock here reads, so it is new: listed first,
    // and never among those left standing.
    const unread = row.live ? Number.NEGATIVE_INFINITY : last;
    const [since, where] =
      dir === null ? [unread, `${rest} · ${command}`] : [writtenAt(dir), `bun ${DRIVER} next ${dir}`];
    const key = `${dir ?? row.name} ${name}`;
    const runs = [...(owed.get(key)?.runs ?? []), row.name];
    owed.set(key, { name, where, hours: (now - since) / HOUR_MS, runs });
  }
  const stood = ({ hours }: { hours: number }) => Number.isFinite(hours) && hours >= days * 24;
  const taken = [...owed.values()]
    .filter((each) => !stood(each))
    .toSorted((one, other) => other.hours - one.hours);
  const left = owed.size - taken.length;
  const oldest = Math.max(0, ...taken.map(({ hours }) => hours).filter(Number.isFinite));
  const listed = taken.length === 0 ? "" : `, the oldest listed for ${oldest.toFixed(1)} h`;
  const live = standing.filter(({ row }) => row.live).length;
  return [
    `due at ${new Date(now).toISOString().slice(0, 16)}Z · ${
      owed.size === 0 ? "nothing owed" : `${String(owed.size)} step(s) owed${listed}`
    } · ${String(live)} run(s) live`,
    ...taken.map(({ name, where, runs: [run = "", ...others], hours }) => {
      const more = others.length > 0 ? ` and ${String(others.length)} more` : "";
      return `${name} · ${Number.isFinite(hours) ? `${hours.toFixed(1)} h` : "new"} · ${run}${more} · ${where}`;
    }),
    ...(left === 0
      ? []
      : [
          `and ${String(left)} of them owed for ${String(days)} day(s) or more: take each or pass it with a row in its deviations.md`,
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
export function unmeasured(repo: string, head: string, { row, commit }: Pick<Standing, "row" | "commit">) {
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
    { cwd: repo },
  );
  runtimeProcess.stdout.write(started.stdout);
  runtimeProcess.stderr.write(started.stderr);
  if (started.exitCode !== 0) return started.exitCode ?? 1;
  for (const line of nextOf(out, { root: wriRoot(repo) })) console.log(line);
  return 0;
}

/**
 * The views derived from the ledgers of `dir`, an investigation's folder or a cycle's: the cycle view
 * of every run it holds, the rows among them that nothing took up (`droppedOf`), then each run's
 * still-missing view beside the plan of the iteration that read it (`dir`'s own, or the latest that
 * names the run).
 */
export function ledgerViews(dir: string, root: string, lengthOf: Where["lengthOf"]): string[] {
  const own = existsSync(join(dir, INVESTIGATION));
  const runs = own
    ? runsOf(dir)
    : readdirSync(dir).flatMap((file) => /^predictions-(.+)\.md$/u.exec(file)?.[1] ?? []);
  const readers = own ? [] : investigations(root);
  const ledgers = runs.map((name) => {
    const iteration = own ? dir : readers.find(({ names: theirs }) => theirs.includes(name))?.dir;
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
    "",
    ...droppedOf(ledgers, carriedIn(root, dir)),
    ...ledgers.flatMap((run) => ["", ...stillMissingOf(run)]),
  ];
}

function main(args: CommandArgs): number {
  const repo = runtimeProcess.cwd();
  const [verb, dir] = args.positionals;
  if (verb === "open") return open(args, repo);
  const known = readable(repo);
  if (verb === "due") return due(args, repo, known);
  if (verb !== "next" && verb !== "ledger") return rows(args, repo, known);
  if (dir === undefined) args.die(USAGE);
  const iteration = knownIn(repo, known);
  const lines =
    verb === "next"
      ? nextOf(resolve(dir), iteration)
      : ledgerViews(resolve(dir), iteration.root, iteration.lengthOf);
  for (const line of lines) console.log(line);
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "wri2p2", usage: USAGE, options: OPTIONS, positionals: [0, 64] }, main);
}

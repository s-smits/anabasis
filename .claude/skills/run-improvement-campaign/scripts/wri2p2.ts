#!/usr/bin/env bun
/**
 * WRI2P2 iteration driver (`run-improvement-campaign/SKILL.md`): reads campaign logs and
 * investigation ledgers and prints one actionable step at a time; it never pauses, launches or
 * merges. With no verb or `due [<part>...] [--days 2]`, per-promotion checkpoints (`decide` at 1–4,
 * the `pause` ceiling at 5, non-promotion triggers at 0), honouring `pause:<run>` rows of cycle and
 * investigation `deviations.md` (`deferredBy`); `open <name>[,<name>...] [--out <dir>]` opens
 * campaigns as equals (`iteration.json`); `next <dir>` prints the first owed gate, skipping
 * untriggered isolated lanes and accepting `Pull request: none — <reason>`; `ledger <dir>` prints
 * the derived views (`tools/wri/ledger.ts`).
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
import { CODE_TREES } from "#tools/campaign/campaign.ts";
import { stillRunning } from "#tools/runs/diagnosis.ts";
import { envRunsFile } from "#tools/runs/host-config.ts";
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
import {
  clockTurns,
  DRIVER,
  openingCommand,
  type Progress,
  progressOf,
  TRIGGER_AT,
  triggerOf,
} from "#tools/runs/summary.ts";
import { catalogueText, lanesOf } from "#tools/wri/catalogue.ts";
import { confirmedIn, vettingFaults } from "#tools/wri/findings.ts";
import { INVESTIGATION, OVERVIEW, REPORTS, SHARED, SYNTHESIS, VETTING, WRI } from "#tools/wri/index.ts";
import { blankSections, reportPath } from "#tools/wri/investigation.ts";
import {
  carriedIn,
  carryOf,
  cycleViewOf,
  droppedOf,
  idsOf,
  launchForks,
  ledgerFiles,
  ledgerOf,
  madeBy,
  names,
  notDoneOf,
  OUTSIDE,
  outsideOf,
  pendingOutsideReads,
  pullOf,
  rowsOf,
  sectionOf,
  stillMissingOf,
  unresolvedOf,
} from "#tools/wri/ledger.ts";
import { missingRecordSections, RECORD, recordStep } from "#tools/wri/record.ts";

const ACROSS = "cross-domain.md";
const MARKER = "iteration.json";
const PLAN = "plan.md";
const PROTOCOL = 2;
const DEVIATIONS = "deviations.md";
/** The row of `deviations.md` that passes every gate of the forks' ledgers at once. */
const FORKS = "forks";
const LEVERS = join(import.meta.dir, "..", "references", "levers.md");
const USAGE = `usage: bun ${DRIVER} [due] [<part> ...] [--days 2] | open <name>[,<name>] [--out <dir>] | next <dir> | ledger <dir>`;
const OPTIONS = { days: "int", out: "abs" } as const;
const STEP = /^step: (?<name>[a-z]+)(?: · (?<rest>.*))?$/u;
const QUIET = new Set(["", "run", "kept", "waits", "done"]);
const OPPOSED =
  '"## Intentionally opposed" with at least one line ("none" counts): what stays missing on purpose, each as a trade-off, what leaving it out buys, what it costs and why (a trade-off of AGENTS.md section 1, a principle or the operator\'s word)';
/** A plan that explicitly closes with no code repair (`Pull request: none — <reason>`). */
const NO_PULL = /^Pull request:\s*none\b.*\S/mu;

type Row = Progress & { readonly name: string; readonly host: string };

interface Standing {
  readonly row: Row;
  readonly last: number;
  readonly commit: string | null;
  readonly dir: string | null;
  readonly step: readonly string[];
}

interface Gate {
  readonly step: string;
  /** The one it is printed under first: its own (`<step>:<run>` for a gate of one run's ledgers),
   *  its step's, then its group's. None passes `done`. */
  readonly keys: readonly string[];
  /** Null once it is met; else what follows `step: <step> · `, then any lines after that one. */
  readonly owed: () => readonly string[] | null;
}

/** The cycles' folder (`.ana/wri/`), the campaigns this machine reads, among which a pull request's
 *  forks are found, and each run's log length, or null where this machine cannot read it. */
interface Known {
  readonly root?: string;
  readonly campaigns?: readonly string[];
  readonly lengthOf?: (run: string) => number | null;
}
type Where = Required<Known> & { readonly dir: string };

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const marked = (dir: string) => existsSync(join(dir, MARKER));
const fixed = (dir: string) =>
  marked(dir) && (parseJsonAs<{ protocol?: number }>(read(join(dir, MARKER))).protocol ?? 1) >= PROTOCOL;

function runsOf(dir: string): string[] {
  const { logs, log } = parseJsonAs<{ logs?: string[]; log?: string }>(read(join(dir, INVESTIGATION)));
  return (logs ?? (log === undefined ? [] : [log])).map((each) => basename(dirname(each)));
}

function investigations(root: string): { dir: string; names: string[] }[] {
  if (!existsSync(root)) return [];
  // Folders are named `2026-11-07-…` and `20261101-…` alike, so a name's order is not its age, and a
  // lane's own investigation never takes a run's step from the iteration that reads it.
  return readdirSync(root)
    .filter((entry) => existsSync(join(root, entry, INVESTIGATION)))
    .map((entry) => join(root, entry))
    .map((dir) => ({ dir, iteration: Number(marked(dir)), at: statSync(join(dir, INVESTIGATION)).mtimeMs }))
    .toSorted((one, other) => other.iteration - one.iteration || other.at - one.at)
    .map(({ dir }) => ({ dir, names: runsOf(dir) }));
}

const manifests = (dir: string) => readdirSync(dir).filter((file) => /^launch(-\d+)*\.json$/u.test(file));
/** The lanes that run alone, from the catalogue, so a renumbering moves the gate with it. */
const LONE_LANES = lanesOf(catalogueText()).filter(({ isolated }) => isolated);

/** Isolated lanes triggered in `overview.md` (or every isolated lane where it is absent) that no
 *  manifest session in `dir` has claimed yet. */
function missingIsolated(dir: string): readonly number[] {
  const overview = read(join(dir, OVERVIEW));
  const needed =
    overview === ""
      ? LONE_LANES.map(({ number }) => number)
      : LONE_LANES.filter(({ number, triggers }) =>
          triggers.some((name) => overview.includes(`${name} (lane ${String(number)}):`)),
        ).map(({ number }) => number);
  if (needed.length === 0) return [];
  const ran = new Set(sessionsIn(dir).flatMap(({ ownedPaths = [] }) => ownedPaths));
  return needed.filter((lane) => !ran.has(reportPath(dir, lane)));
}

const sessionsIn = (dir: string) =>
  manifests(dir).flatMap(
    (file) =>
      parseJsonAs<{ sessions: { name: string; task: string; ownedPaths?: string[] }[] }>(
        read(join(dir, file)),
      ).sessions,
  );

/** "" for each it has not got, and for both where its predictions are in two folders, which its own
 *  predictions gate names. */
function ledgersOf(root: string, dir: string, name: string) {
  const path = ledgerOf(root, dir, `predictions-${name}.md`);
  const outcomes = path === null ? "" : read(join(dirname(path), `outcomes-${name}.md`));
  return { name, predictions: read(path ?? ""), outcomes };
}

/** What the outcomes ledger of `run` has left to resolve (`unresolvedOf`), with its rows of the
 *  group `outside` against the run's row in `outside-reads.md`. */
function outcomesOwed({ root, dir, lengthOf }: Where, run: string, path: string): string[] | null {
  const beside = path === "" ? "" : join(dirname(path), `outcomes-${run}.md`);
  const ledgers = { predictions: read(path), outcomes: read(beside), events: lengthOf(run) };
  const parts = unresolvedOf(ledgers, outsideOf(root, dir).get(run), path);
  return parts.length === 0 ? null : [`${beside}: ${parts.join("; ")}`];
}

/**
 * In its `## Carried` section, each id the iterations that made it (`madeBy`) did not hold, as
 * `<run>:<id>`. A run no iteration made owes nothing.
 */
function carryOwed({ root }: Where, run: string, path: string): string[] | null {
  const parents = investigations(root)
    .filter(({ dir }) => madeBy(read(join(dir, PLAN)), read(join(dir, DEVIATIONS)), run))
    .flatMap(({ dir, names: runs }) => {
      const plan = read(join(dir, PLAN));
      return runs.map((name) => ({ ...ledgersOf(root, dir, name), plan }));
    });
  const { missing } = carryOf(read(path), parents);
  return missing.length === 0
    ? null
    : [
        `the "## Carried" section of ${path} names ${missing.join(", ")}: each id the iteration that made this fork did not hold or retire under "## Intentionally opposed"`,
      ];
}

/** What an iteration's plan owes the predictions it writes itself: each id of its own `id` tables
 *  named in a fork's `predictions-<run>.md` or under its `## Not done`. */
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

/** The outside read a jobstat run owes once it has stopped: a row naming it in a cycle's
 *  `outside-reads.md`, scored, skipped or still owed. */
function outsideGate({ root, dir }: Where, run: string): Gate[] {
  if (!run.startsWith("jobstat")) return [];
  const owed = `${run} has no row in ${OUTSIDE} of its cycle's folder under ${root}: read its newest promoted reference on the eight tasks beside a fresh Starter (run-improvement-campaign/references/outside.md), then add the row whose first cell is the run's name, with its scores, "skipped" with lane 8's grade or no promotion, or "owed" with what the read waits for`;
  return [
    {
      step: "outside",
      keys: [`outside:${run}`, "outside"],
      owed: () => (outsideOf(root, dir).has(run) ? null : [owed]),
    },
  ];
}

/** An id two runs share must be named as `<run>:<id>`, since one bare mention cannot backtrack both. */
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
 * Each confirmed vetting row named as `vet-<n>`, `cross-domain.md` named, three levers of
 * `references/levers.md` by id, and what it leaves out on purpose for each run it read. An
 * iteration whose every run kept that section in an older `still-missing-<run>.md` has said it
 * there.
 */
function unanswered({ root, dir }: Where, runs: readonly string[]): string[] | null {
  const text = read(join(dir, PLAN));
  const confirmed = confirmedIn(read(join(dir, VETTING)));
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
  const noPull = pull === "0" && NO_PULL.test(plan);
  const forks = [...new Set([...where.campaigns, ...launchForks(deviations)])].filter((name) =>
    madeBy(plan, deviations, name),
  );
  const owing = marked(dir) && (fixed(dir) || !existsSync(at(SYNTHESIS)));
  const record = recordStep(owing ? missingRecordSections(read(at(RECORD)), runs).length : 0, dir);
  const unread = () => pendingOutsideReads(outsideOf(where.root, dir), [...runs, ...forks]);
  return [
    gate("instruct", () => {
      const blank = blankSections(read(at(SHARED)));
      return blank.length === 0
        ? null
        : [`write ${blank.map((heading) => `"${heading}"`).join(", ")} in ${at(SHARED)}`];
    }),
    gate("lanes", () => (manifests(dir).length > 0 ? null : ["", wri("lanes", " --agents 4")])),
    gate("reports", () => {
      const owed = sessionsIn(dir).filter(
        ({ ownedPaths = [] }) => ownedPaths.length === 0 || ownedPaths.some((path) => !existsSync(path)),
      );
      return owed.length === 0
        ? null
        : [
            `${String(owed.length)} lane session(s) owe a report; hand each its line to a wri-lane agent, all in one message`,
            ...owed.map(({ name, task }) => `  ${name}: ${task}`),
            ...record,
          ];
    }),
    gate("record", () => (record.length === 0 ? null : record)),
    ...only([
      gate("isolated", () => {
        const missing = missingIsolated(dir);
        return missing.length === 0
          ? null
          : [
              `triggered isolated lane(s) (${missing.join(", ")}) run alone after the reports they wait on: build each where its \`Starts from\` paragraph opens it (isolated lane 20 only where lane 17 left a check undecided) with${wri("lanes", ` --lanes ${missing.join(",")}`).slice(1)} and launch it alone, or record why not in ${at(DEVIATIONS)} as "| isolated | <reason> |"`,
            ];
      }),
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
      gate("vet", () => {
        const faults = fixed(dir) ? vettingFaults(read(at(VETTING)), read(at(REPORTS))) : [];
        return faults.length === 0 ? null : [`${at(VETTING)}: ${faults.join("; ")}`];
      }),
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
      pull !== "0" || noPull
        ? null
        : [
            `one pull request on the top of the stack, then name it in plan.md as "Pull request: #N" (or "Pull request: none — <reason>" when vetting leaves no code repair)`,
          ],
    ),
    ...(noPull
      ? []
      : [
          gate("launch", () =>
            forks.length > 0
              ? null
              : [
                  `take each run's name from the dry run, write its predictions-<run>.md in the cycle's folder (a "## Carried" section for what this iteration did not hold), then fork at #${pull}'s head on the host and login with room`,
                  `  bun run runs fresh <pack> --at <#${pull} head> --as forkedPR${pull} --yes`,
                ],
          ),
          ...only(
            forks.flatMap((fork) => runGates(where, fork, [FORKS]).filter(({ step }) => step !== "outcomes")),
          ),
          ...only([{ step: "carry", keys: ["carry:plan"], owed: () => planOwed(where, plan, forks) }]),
        ]),
    {
      step: "done",
      keys: [],
      owed: () => [
        noPull ? "no code change (see plan.md)" : `#${pull} is measured by ${forks.join(", ")}`,
        ...unread(),
      ],
    },
  ];
}

/** The first gate owed that no row of its `deviations.md` passes, then each deviation passed on the
 *  way, with its reason. */
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

/** How long each campaign `among` holds by a name is now, or null for one it does not hold or that
 *  may still write its log (`stillRunning`), whose log grows on every look and would reopen its
 *  unreached and pending rows at each `next`. */
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
      const events = () => wholeLines(run?.path ?? "").split("\n").length - 1;
      lengths.set(name, run === undefined || stillRunning(run, looked) ? null : events());
    }
    return lengths.get(name) ?? null;
  };
}

const wriRoot = (repo: string) => join(mainTree(repo), ".ana", "wri");

const knownIn = (repo: string, known: readonly Run[], running: () => readonly Running[] = processes) => {
  let looked: readonly Running[] | undefined;
  const once = () => (looked ??= running());
  return {
    root: wriRoot(repo),
    campaigns: known.filter(isCampaign).map(({ name }) => name),
    lengthOf: lengthsIn(known, once),
    liveOf: (name: string) =>
      known.some((run) => isCampaign(run) && run.name === name && stillRunning(run, once())),
  };
};

/** What `reader` says of the log at `path`, or null where the log has gone since the registry
 *  listed it, as a test suite's campaigns do within seconds. A log that is there and cannot be read
 *  throws. */
function held<T>(path: string, reader: (path: string) => T): T | null {
  try {
    return reader(path);
  } catch (cause) {
    if (existsSync(path)) throw cause;
    return null;
  }
}

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
    .flatMap((run) => {
      const last = held(run.path, lastAt);
      const live = stillRunning(run, running);
      const moved = last !== null && (live || now - Date.parse(last) < days * 24 * HOUR_MS);
      return moved ? [{ run, live }] : [];
    });

export const deferredBy = (
  deviations: readonly string[],
  name: string,
  trigger: string,
  promotions = 0,
): string | null =>
  deviations
    .flatMap((text) => rowsOf(text, "step"))
    .find(
      ([step, reason = ""]) =>
        step === `pause:${name}` && reason !== "" && (promotions === 0 || reason.includes(trigger)),
    )?.[1] ?? null;

/** `run`, `decide` (promotions 1–4), `pause` (ceiling 5 or non-promotion), `waits`, `kept`, or
 *  `open` once stopped. */
export function openingOf(
  row: { readonly name: string; readonly host: string; readonly live: boolean; readonly promotions?: number },
  trigger: string | null,
  running: readonly Running[],
  kept: string | null = null,
  turns: string | null = null,
): string[] {
  if (trigger === null) {
    return [row.live && turns !== null ? `step: run · its clock trigger turns at ${turns}` : "step: run"];
  }
  const command = `  ${openingCommand(row, row.host === HERE ? "" : `on ${row.host} `)}`;
  if (!row.live) return [`step: open · ${trigger}`, command];
  const waiting = waiters(row.name, running);
  const holders = running.filter(({ pid }) => waiting.includes(pid));
  if (holders.some(({ args }) => args.includes("pause"))) {
    return [`step: waits · ${trigger}; its pause after the next comparison is armed`];
  }
  if (kept !== null) return [`step: kept · ${trigger}`, `deviated: pause:${row.name} · ${kept}`];
  const [moving] = holders;
  const promos = row.promotions ?? 0;
  const ceiling = TRIGGER_AT.ceilingPromotions;
  if (moving !== undefined) {
    return [
      `step: pause · ${trigger}; a continue --after of it waits in process ${String(moving.pid)} and starts it again, so no pause is armed and one is refused while it waits`,
      command,
    ];
  }
  if (promos >= TRIGGER_AT.firstPromotion && promos < ceiling) {
    return [
      `step: decide · ${trigger}; backtrack predictions — pause after the next comparison if enough evidence, or log pause:${row.name} naming "${trigger}" in deviations.md to continue (up to ${String(ceiling)})`,
      command,
    ];
  }
  const note =
    promos >= ceiling
      ? `ceiling reached (${String(ceiling)} promotions) — the investigation opens once the run stops after its next comparison`
      : "the investigation opens once the run stops after its next comparison";
  return [`step: pause · ${trigger}; ${note}`, command];
}

function standings(args: CommandArgs, repo: string, known: readonly Run[], parts = args.positionals) {
  const now = Date.now();
  const days = args.int("days") ?? 2;
  const running = processes();
  const iteration = knownIn(repo, known, () => running);
  const folders = investigations(iteration.root);
  const deviationPaths = new Set([
    ...folders.map(({ dir }) => join(dir, DEVIATIONS)),
    ...ledgerFiles(iteration.root, iteration.root, DEVIATIONS),
  ]);
  const deviations = [...deviationPaths].map((path) => read(path));
  const all = movedIn(known, running, now, days, parts).flatMap(({ run, live }): Standing[] => {
    // A log can also go between the look at its tail and this read of it.
    const events = held(run.path, logEvents);
    if (events === null) return [];
    const row = progressOf({ name: run.name, host: run.archived ?? HERE, live }, events, now);
    const folder = folders.find(({ names: seen }) => seen.includes(row.name));
    const trigger = triggerOf(row);
    const step =
      folder === undefined
        ? openingOf(
            row,
            trigger,
            running,
            deferredBy(deviations, row.name, trigger ?? "", row.promotions),
            clockTurns(row, now),
          )
        : nextOf(folder.dir, iteration);
    const commit = lastLaunch(run.path)?.commit ?? null;
    return [{ row, last: Date.parse(events.at(-1)?.at ?? ""), commit, dir: folder?.dir ?? null, step }];
  });
  const shown = all.filter(({ row }) => row.live || row.compared > 0);
  return { shown, silent: all.length - shown.length, moved: all.length, days, now, root: iteration.root };
}

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
 * A head line, then one line a step owed, a live run's unread trigger first and then the
 * longest-standing, with the command that prints it whole; last, one line a live run still before
 * its trigger with the second its clock turns. Runs sharing a folder's step share its line. A step
 * is timed from the last write under its folder, a closed run's unread trigger from its last event,
 * and one standing `days` or more is only counted.
 */
export function dueLines(
  standing: readonly Pick<Standing, "row" | "last" | "dir" | "step">[],
  writtenAt: (dir: string) => number,
  now: number,
  days = 2,
): string[] {
  const owed = new Map<string, { name: string; where: string; hours: number; runs: string[] }>();
  const turning: string[] = [];
  for (const { row, last, dir, step } of standing) {
    const { name = "", rest = "" } = step.map((line) => STEP.exec(line)?.groups).find(Boolean) ?? {};
    if (row.live && name === "run" && rest !== "") turning.push(`run · ${row.name} · ${rest}`);
    if (QUIET.has(name)) continue;
    const command = step.find((line) => line.startsWith("  "))?.trim() ?? `bun ${DRIVER} open ${row.name}`;
    // A live run's trigger has stood for no time a clock here reads, so it is new: listed first, and
    // never among those left standing.
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
    ...turning,
  ];
}

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

/** The files of the code a solve runs (`CODE_TREES`, `package.json`, `bun.lock`) that differ at
 *  `head`, which no run has yet measured. The run's commit is its last launch's receipt, which a
 *  gathered copy carries beside its log. */
export function unmeasured(repo: string, head: string, { row, commit }: Pick<Standing, "row" | "commit">) {
  if (commit === null) return `measures · ${row.name} · no launch receipt names its commit`;
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
  const { shown, days, now, root } = standings(args, repo, known, args.positionals.slice(1));
  const head = gitMaybe(repo, "rev-parse", "HEAD") ?? "HEAD";
  for (const line of dueLines(shown, changedAt, now, days)) console.log(line);
  for (const line of pendingOutsideReads(outsideOf(root))) console.log(line);
  for (const each of shown.filter(({ row }) => row.live)) console.log(unmeasured(repo, head, each));
  return 0;
}

function open(args: CommandArgs, repo: string): number {
  const runs = (args.positionals[1] ?? "").split(",").filter((name) => name !== "");
  if (runs.length === 0) args.die(USAGE);
  // Each name is refused here if unknown, then handed to `wri.ts start` by name, not path, so a peer's
  // campaign is fetched whole, states included (`logAcross`); the ten-minute gather copies its record
  // alone, from which a reference reads as not kept.
  for (const name of runs) readNamed(name, repo);
  const root = wriRoot(repo);
  const hosts = envRunsFile(repo);
  const day = new Date().toISOString().slice(0, 10);
  const out = resolve(args.value("out") ?? join(root, `${day}-${runs.join("+")}`));
  // The record first, so a crash before the start reads `step: open`, never a plain investigation.
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, MARKER),
    `${JSON.stringify({ opened: new Date().toISOString(), runs, protocol: PROTOCOL }, null, 2)}\n`,
  );
  const start = [WRI, "start", "--log", runs.join(","), "--out", out, "--snapshot"];
  const env = existsSync(hosts) ? [`--env-file=${hosts}`] : [];
  const started = runSync([capturedExecPath, ...env, ...start], { cwd: repo });
  runtimeProcess.stdout.write(started.stdout);
  runtimeProcess.stderr.write(started.stderr);
  if (started.exitCode !== 0) return started.exitCode ?? 1;
  for (const line of nextOf(out, { root })) console.log(line);
  return 0;
}

/**
 * The cycle view of every run, the rows nothing took up (`droppedOf`), then each run's
 * still-missing view beside the plan of the iteration that read it. `liveOf` says which runs may
 * still write their logs, whose rows no plan is late for.
 */
export function ledgerViews(
  dir: string,
  root: string,
  lengthOf: Where["lengthOf"],
  liveOf: (run: string) => boolean = () => false,
): string[] {
  const own = existsSync(join(dir, INVESTIGATION));
  const runs = own
    ? runsOf(dir)
    : readdirSync(dir).flatMap((file) => /^predictions-(.+)\.md$/u.exec(file)?.[1] ?? []);
  const readers = own ? [] : investigations(root);
  const ledgers = runs.map((name) => {
    const iteration = own ? dir : readers.find(({ names: theirs }) => theirs.includes(name))?.dir;
    const plan = iteration === undefined ? "" : read(join(iteration, PLAN));
    const older = read(ledgerOf(root, dir, `still-missing-${name}.md`) ?? "");
    const awaited = iteration !== undefined || liveOf(name);
    return { ...ledgersOf(root, dir, name), plan, awaited, older, events: lengthOf(name) };
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
      : ledgerViews(resolve(dir), iteration.root, iteration.lengthOf, iteration.liveOf);
  for (const line of lines) console.log(line);
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "wri2p2", usage: USAGE, options: OPTIONS, positionals: [0, 64] }, main);
}

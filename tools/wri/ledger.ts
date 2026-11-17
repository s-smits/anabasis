/**
 * The per-run ledgers of an iteration, read one way for every reader: `predictions-<run>.md` and
 * `outcomes-<run>.md` in a cycle's folder, and the tables of an investigation's own files, so a loop
 * of iterations can be read whole. Each fact has one hand-written owner: a prediction its
 * `predictions-<run>.md`, its outcome its `outcomes-<run>.md`, and what stays undone or opposed the
 * `plan.md` of the iteration that read the run (an older run's `still-missing-<run>.md` is still
 * read). The cycle, dropped and still-missing views are derived here and never written by hand.
 *
 * A table counts only where its header's first cell names it (`id` for a ledger), so a second
 * table, a heading or prose is never read as a prediction; comments and code fences are skipped,
 * so a heading inside an example does not count as the section.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";

/** One parent run's name and its two ledgers' text, for what a fork of it carries. */
export interface Parent {
  readonly name: string;
  readonly predictions: string;
  readonly outcomes: string;
}

/** One predictions ledger's `## Carried` section and the run whose ledger it is. */
interface Carried {
  readonly run: string;
  readonly text: string;
}

/** One run's ledgers for the derived views: its two hand-written files and its iteration's plan. */
interface RunLedgers extends Parent {
  /** The `plan.md` of the iteration that read the run, or "" before one is written. */
  readonly plan: string;
  /** Whether a plan of its own can still place the run's rows: an investigation names it, or it is
   *  live, and a live run's investigation opens at its trigger. */
  readonly awaited: boolean;
  /** The run's `still-missing-<run>.md` written before 8 November, or "": read where the plan has no
   *  `## Intentionally opposed`, so an older run's trade-offs are shown rather than "none". */
  readonly older: string;
  /** The run's log length now, or null where it cannot be read. */
  readonly events: number | null;
}

/** A run's two ledgers and its log's length, as the readers of its outcomes take them. */
type Resolved = Pick<RunLedgers, "predictions" | "outcomes" | "events">;

/** The outcomes a prediction can have; `pending` only while its event has not come. */
export const OUTCOMES = ["held", "falsified", "unreached", "pending"] as const;

/** The line an outcomes ledger records the run's log length on when its rows were resolved. */
const COUNTED_LINE = "Log events at resolution:";
const COUNTED = /^Log events at resolution: (\d+)\.?$/mu;

/** One row a stopped jobstat run, in a cycle's folder: its reference's read on the outside benchmark. */
export const OUTSIDE = "outside-reads.md";
/** The group of a prediction that a count of the run's outside read settles, and no event of its log. */
const OUTSIDE_GROUP = "outside";

/** `text` without HTML comments and fenced code blocks. */
const stripped = (text: string) =>
  text.replaceAll(/<!--[\s\S]*?-->/gu, "").replaceAll(/^```[\s\S]*?^```/gmu, "");

/** The cells of a Markdown table line, cut at each pipe no backslash escapes, or null for any other line. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());
}

/** Whether a table line is a rule, as under a header: hyphens in every cell, with a colon or a
 *  second hyphen, so a row of lone hyphens for "none" stays a row. */
const ruled = (cells: readonly string[] | null | undefined) =>
  cells?.every((cell) => /^(?=..):?-+:?$/u.test(cell)) === true;

const bare = (cell: string) => cell.replaceAll("`", "");

/**
 * Every Markdown table of `text` outside its comments and code fences: the header's cells,
 * lower-cased and without backticks, and the rows, each cell as written. A table is a run of table
 * lines whose first is its header; a later line that a rule follows opens the next table, so two
 * tables with no line between them are two; and a rule is never a row. This is the one reader of a
 * table: `rowsOf` is its view for a reader that knows the header's first cell, and one that does
 * not reads a table by a column's name.
 */
export function tablesOf(text: string): { header: string[]; rows: string[][] }[] {
  const lines = stripped(text).split("\n").map(cellsOf);
  const tables: { header: string[]; rows: string[][] }[] = [];
  let open: string[][] | null = null;
  for (const [at, cells] of lines.entries()) {
    if (cells === null) {
      open = null;
    } else if (open === null || ruled(lines[at + 1])) {
      open = [];
      if (!ruled(cells)) tables.push({ header: cells.map((cell) => bare(cell).toLowerCase()), rows: open });
    } else if (!ruled(cells)) {
      open.push(cells);
    }
  }
  return tables;
}

/** The rows of every table in `text` whose header's first cell is `head`: each cell without
 *  backticks, and no row whose first cell is empty. */
export const rowsOf = (text: string, head: string): string[][] =>
  tablesOf(text)
    .filter(({ header }) => header[0] === head)
    .flatMap(({ rows }) => rows.map((cells) => cells.map(bare)))
    .filter(([first]) => first !== "");

/** The ids of a ledger's `id` tables. */
export const idsOf = (text: string): string[] => rowsOf(text, "id").map(([id = ""]) => id);

/** Each id of an outcomes ledger with the first word of its outcome, lower-cased: `**Held**, 4 of 4` reads `held`. */
export const outcomesOf = (text: string): Map<string, string> =>
  new Map(
    rowsOf(text, "id").map(([id = "", outcome = ""]) => [
      id,
      /[a-z]+/u.exec(outcome.toLowerCase())?.[0] ?? "",
    ]),
  );

/** The ids a predictions ledger owes one outcome each in its outcomes ledger: those of its `id`
 *  tables, and each `<run>:<id>` its `## Carried` section names, resolved under that whole name. */
export const owedOf = (predictions: string): string[] => [
  ...new Set([
    ...idsOf(predictions),
    ...((sectionOf(predictions, "Carried") ?? []).join("\n").match(/(?<![\w.-])[a-z][\w.-]*:[A-Z]\w*/gu) ??
      []),
  ]),
];

/** The ids among `ids` whose outcome in the outcomes ledger is not `held`. */
function unheldOf(ids: readonly string[], outcomes: string): string[] {
  const outcome = outcomesOf(outcomes);
  return ids.filter((id) => outcome.get(id) !== "held");
}

/** The log's event count an outcomes ledger was resolved at, or null where it records none. */
function countedOf(outcomes: string): number | null {
  const counted = COUNTED.exec(stripped(outcomes))?.[1];
  return counted === undefined ? null : Number(counted);
}

/** The ids of a predictions ledger whose `group` cell reads `outside`. */
const outsideIds = (predictions: string): string[] =>
  tablesOf(predictions).flatMap(({ header, rows }) => {
    const group = header.indexOf("group");
    const marked = rows.filter((row) => row[group]?.toLowerCase() === OUTSIDE_GROUP);
    return header[0] === "id" ? marked.map(([id = ""]) => bare(id)) : [];
  });

/**
 * The ids an outcomes ledger left `unreached` or `pending` while the run's log has grown past the
 * count they were resolved at, so each is open again: a run continued after its trigger may yet
 * reach them. A ledger that records no count was resolved at none. With `events` null, where the
 * log cannot be read, nothing is called stale, and neither is a row of the group `outside`, which
 * no event of the log settles.
 */
function staleOf({ predictions, outcomes, events }: Resolved): string[] {
  if (events === null || events <= (countedOf(outcomes) ?? 0)) return [];
  const outside = outsideIds(predictions);
  return [...outcomesOf(outcomes)]
    .filter(([id, outcome]) => (outcome === "unreached" || outcome === "pending") && !outside.includes(id))
    .map(([id]) => id);
}

/**
 * What the outcomes ledger `outcomes` has left to resolve against its `predictions`, as phrases:
 * each id without one of the four outcomes; each left `unreached` or `pending` at a count the log
 * has since passed (`staleOf`); each outcome of an id predicted nowhere in `from`; and the rows of
 * the group `outside`, which the run's log never settles. Such a row stays `pending` while the
 * run's row in `outside-reads.md` (`read`, its kind) is neither scored nor skipped, and is owed its
 * outcome once it is, so a benchmark result that arrives reopens it where the log's growth does not.
 */
export function unresolvedOf(ledgers: Resolved, read: string | undefined, from: string): string[] {
  const { predictions, outcomes, events } = ledgers;
  const predicted = owedOf(predictions);
  const outcome = outcomesOf(outcomes);
  const unsettled = predicted.filter((id) => !OUTCOMES.some((word) => word === outcome.get(id)));
  const outside = outsideIds(predictions).filter((id) => !unsettled.includes(id));
  const stale = staleOf(ledgers);
  const stray = [...outcome.keys()].filter((id) => !predicted.includes(id));
  const arrived = read === "scored" || read === "skipped";
  const waiting = outside.filter((id) => (outcome.get(id) === "pending") === arrived);
  const counted = countedOf(outcomes);
  const record = events === null ? "" : `, and record "${COUNTED_LINE} ${String(events)}" on its own line`;
  return [
    unsettled.length > 0
      ? `resolve ${unsettled.join(", ")} from the log as ${OUTCOMES.join(", ")} (pending only while its event has not come), each with its count or event and the time${record}`
      : "",
    stale.length > 0
      ? `${stale.join(", ")} read unreached or pending at ${counted === null ? "no recorded count" : `${String(counted)} events`} and the log holds ${String(events)} now: resolve them again${record}`
      : "",
    waiting.length === 0
      ? ""
      : arrived
        ? `${waiting.join(", ")} read pending and the run's row in ${OUTSIDE} is ${read ?? ""}: resolve each from that read's counts`
        : `the run's outside read settles ${waiting.join(", ")}, and ${OUTSIDE} does not hold it as scored or skipped: each stays pending until it does`,
    stray.length > 0 ? `${stray.join(", ")} predicted nowhere in ${from}` : "",
  ].filter((part) => part !== "");
}

/** The non-blank lines under every `## Not done` heading of a plan, whatever follows the words. */
export function notDoneOf(plan: string): string[] {
  return stripped(plan)
    .split("\n")
    .filter((line) => /^## Not done\b/u.test(line))
    .flatMap((line) => sectionOf(plan, line.slice(3).trim()) ?? []);
}

/** A prediction's outcome as the views print it: unresolved, stale, or its own word. */
function shownOutcome(run: RunLedgers, id: string): string {
  const outcome = outcomesOf(run.outcomes).get(id) ?? "";
  if (!OUTCOMES.some((word) => word === outcome)) return "unresolved";
  return staleOf(run).includes(id) ? `${outcome}, stale` : outcome;
}

/** The cycle view: every prediction of every run with its outcome, as one table. */
export function cycleViewOf(runs: readonly RunLedgers[]): string[] {
  return [
    "| run | id | outcome |",
    "| --- | --- | --- |",
    ...runs.flatMap((run) =>
      owedOf(run.predictions).map((id) => `| ${run.name} | ${id} | ${shownOutcome(run, id)} |`),
    ),
  ];
}

/**
 * The dropped view: each prediction a run left `unreached` or `falsified` that nothing took up, named
 * neither as `<run>:<id>` in another run's `## Carried` section (`carried`) nor under the
 * `## Intentionally opposed` of the plan that read its run; a `## Not done` line takes up nothing.
 * A run whose plan is not yet written has dropped nothing. A run that is neither live nor named by an
 * investigation has no plan to come, so its rows are listed apart as unread, where only a carry takes
 * them.
 */
export function droppedOf(runs: readonly RunLedgers[], carried: readonly Carried[]): string[] {
  const linesOf = (among: readonly RunLedgers[]) =>
    among.flatMap((run) => {
      const outcome = outcomesOf(run.outcomes);
      const opposed = (sectionOf(run.plan, "Intentionally opposed") ?? []).join("\n");
      const others = carried
        .filter((each) => each.run !== run.name)
        .map(({ text }) => text)
        .join("\n");
      const left = owedOf(run.predictions)
        .map((id) => ({ id, read: outcome.get(id) ?? "" }))
        .filter(({ read }) => read === "unreached" || read === "falsified")
        .filter(
          ({ id }) => !names(others, id.includes(":") ? id : `${run.name}:${id}`) && !names(opposed, id),
        );
      return left.length === 0
        ? []
        : [`- ${run.name}: ${left.map(({ id, read }) => `${id} (${read})`).join(", ")}`];
    });
  const dropped = linesOf(runs.filter(({ plan }) => plan !== ""));
  const unread = linesOf(runs.filter(({ awaited }) => !awaited));
  return [
    "# Dropped: unreached or falsified, carried by no run and opposed by no plan",
    "",
    ...(dropped.length === 0 ? ["- none"] : dropped),
    ...(unread.length === 0
      ? []
      : [
          "",
          "# Unread: unreached or falsified in a run at rest no investigation names, carried by no run",
          "",
          ...unread,
        ]),
  ];
}

/**
 * The still-missing view of one run: each prediction it did not hold, with its outcome, then what
 * its iteration's plan leaves undone (`## Not done`) and leaves out on purpose
 * (`## Intentionally opposed`).
 */
export function stillMissingOf(run: RunLedgers): string[] {
  const listed = (lines: readonly string[]) => (lines.length === 0 ? ["- none"] : lines);
  const unheld = unheldOf(owedOf(run.predictions), run.outcomes);
  return [
    `# Still missing: ${run.name}`,
    "",
    "## Not held",
    "",
    ...listed(unheld.map((id) => `- ${id}: ${shownOutcome(run, id)}`)),
    "",
    "## Not done",
    "",
    ...(run.plan === "" ? ["- no plan yet"] : listed(notDoneOf(run.plan))),
    "",
    "## Intentionally opposed",
    "",
    ...listed(
      sectionOf(run.plan, "Intentionally opposed") ?? sectionOf(run.older, "Intentionally opposed") ?? [],
    ),
  ];
}

/**
 * What a fork's `predictions` owes its parents in its `## Carried` section, and what that section
 * leaves out: each id a parent did not hold, as `<parent>:<id>`. Matched as whole words, so `r:P2`
 * is not carried by `r:P20`. What a parent leaves out on purpose is its iteration's plan's, which
 * the still-missing view reads, so the section owes no file.
 */
export function carryOf(
  predictions: string,
  parents: readonly Parent[],
): { owed: string[]; missing: string[] } {
  const owed = parents.flatMap(({ name, predictions: theirs, outcomes }) =>
    unheldOf(idsOf(theirs), outcomes).map((id) => `${name}:${id}`),
  );
  const carried = (sectionOf(predictions, "Carried") ?? []).join("\n");
  return { owed, missing: owed.filter((token) => !names(carried, token)) };
}

/** The pull request a plan names as its iteration's (`Pull request: #N`), or null. */
export function pullOf(plan: string): number | null {
  const named = /^Pull request: #(\d+)/mu.exec(plan)?.[1];
  return named === undefined ? null : Number(named);
}

/** The non-blank lines of `text`'s section `## <heading>`, up to the next `##`, or null without one. */
export function sectionOf(text: string, heading: string): string[] | null {
  const lines = stripped(text).split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line.trim() !== "");
}

/** Whether `text` names `token` as a word of its own. */
export const names = (text: string, token: string): boolean =>
  new RegExp(
    `(?:^|[^\\w-])${token.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}(?:[^\\w-]|$)`,
    "mu",
  ).test(stripped(text));

/**
 * The folders that hold `file`: the investigation `dir` itself and each cycle's folder under `root`
 * (`<date>-cycle-<release>`), and no other, so an investigation's or a lane's folder never stands in
 * for a cycle. More than one is a conflict the reader names, never a choice by listing order.
 */
export function ledgerFiles(root: string, dir: string, file: string): string[] {
  return ledgerFolders(root, dir)
    .map((folder) => join(folder, file))
    .filter((path) => existsSync(path));
}

/** The folders a ledger is read in: the investigation `dir` and each cycle's folder under `root`. */
function ledgerFolders(root: string, dir: string): string[] {
  const cycles = existsSync(root)
    ? readdirSync(root)
        .filter((entry) => /-cycle-/u.test(entry))
        .map((entry) => join(root, entry))
    : [];
  return [...new Set([dir, ...cycles])];
}

/** Every `## Carried` section of the predictions ledgers in those folders, each with its run's name.
 *  A file under `root` whose name holds `-cycle-` is no folder and holds none. */
export const carriedIn = (root: string, dir: string): Carried[] =>
  ledgerFolders(root, dir)
    .filter((folder) => existsSync(folder) && statSync(folder).isDirectory())
    .flatMap((folder) =>
      readdirSync(folder)
        .filter((file) => /^predictions-.+\.md$/u.test(file))
        .map((file) => ({
          run: file.slice("predictions-".length, -".md".length),
          text: (sectionOf(readFileSync(join(folder, file), "utf8"), "Carried") ?? []).join("\n"),
        })),
    );

/** The one path `ledgerFiles` finds, or null where it finds none or several (a conflict to name). */
export function ledgerOf(root: string, dir: string, file: string): string | null {
  const found = ledgerFiles(root, dir, file);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * The kind of each run's row in the `outside-reads.md` of the cycles under `root` (and of `dir`):
 * the first word of the row's last cell, `scored`, `skipped` or `owed` (run-improvement-campaign,
 * "The outside aim"). The last row that names a run is its kind.
 */
export const outsideOf = (root: string, dir = root): Map<string, string> =>
  new Map(
    ledgerFiles(root, dir, OUTSIDE).flatMap((path) =>
      rowsOf(readFileSync(path, "utf8"), "run").map(
        (cells) => [cells[0] ?? "", /[a-z]+/u.exec((cells.at(-1) ?? "").toLowerCase())?.[0] ?? ""] as const,
      ),
    ),
  );

/**
 * One line for each run whose row still reads `owed`, among `runs` where given: the debt an
 * iteration's `outside` gate lets pass, since an investigation must not wait on a paid read, said
 * again wherever a step is read until the row is scored or skipped.
 */
export const outsideOwed = (outside: ReadonlyMap<string, string>, runs?: readonly string[]): string[] =>
  [...outside]
    .filter(([run, kind]) => kind === "owed" && runs?.includes(run) !== false)
    .map(
      ([run]) =>
        `outside · ${run} · read still owed in ${OUTSIDE}: roll it in the first sitting a login has room, then write its row scored or skipped`,
    );

/** The forks the `launch` row of an iteration's `deviations` names, as one launched at a child of
 *  the plan's pull request carries the child's number. A bare `forkedPR<N>` names no run. */
export const launchForks = (deviations: string): string[] =>
  rowsOf(deviations, "step")
    .filter(([step]) => step === "launch")
    .flatMap(([, reason = ""]) => reason.match(/[\w.-]+-forkedPR\d+(?:-\w+)*/gu) ?? []);

/** The pull request a fork measures, from `forkedPR<N>` in its name, or null. */
export function forkOf(name: string): number | null {
  const pull = /forkedPR(\d+)(?!\d)/u.exec(name)?.[1];
  return pull === undefined ? null : Number(pull);
}

/** Whether the iteration whose `plan` and `deviations` these are made the run `name`: it forks the
 *  plan's pull request, by the whole number, or the `launch` deviation names it. A plan that names
 *  no pull request makes no run by its name. */
export function madeBy(plan: string, deviations: string, name: string): boolean {
  const pull = pullOf(plan);
  return (pull !== null && forkOf(name) === pull) || launchForks(deviations).includes(name);
}

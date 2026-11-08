/**
 * The per-run ledgers of an iteration, read one way for every reader: `predictions-<run>.md` and
 * `outcomes-<run>.md` in a cycle's folder, and the tables of an investigation's own files. The
 * operator asked on 7 November for each run's predictions and their outcomes as a linked pair, with
 * what the run still lacks and what it lacks on purpose ("Intentionally opposed") beside them, so a
 * loop of iterations can be read whole. Before that, a cycle kept one `Predictions.md` and nothing
 * showed whether a given run's rows were resolved.
 *
 * Each fact has one hand-written owner: a prediction its `predictions-<run>.md`, its outcome its
 * `outcomes-<run>.md`, and what stays undone or opposed the `plan.md` of the iteration that read the
 * run. The cycle view and each run's still-missing view are derived here (`cycleViewOf`,
 * `stillMissingOf`) and never written by hand. Until 8 November a cycle's `Predictions.md` kept
 * resolutions beside the per-run outcomes, and `still-missing-<run>.md` restated the plan's
 * `## Not done`, so each fact had two owners (`AGENTS.md` rule 12); a file of either kind written
 * before then is still read, and none is rewritten.
 *
 * A table counts only where its header's first cell names it (`id` for a ledger), so a second
 * table, a heading or prose is never read as a prediction; comments and code fences are skipped,
 * so a heading inside an example does not count as the section.
 */
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";

/** One parent run's name and its two ledgers' text, for what a fork of it carries. */
export interface Parent {
  readonly name: string;
  readonly predictions: string;
  readonly outcomes: string;
}

/** One run's ledgers for the derived views: its two hand-written files and its iteration's plan. */
interface RunLedgers extends Parent {
  /** The `plan.md` of the iteration that read the run, or "" before one is written. */
  readonly plan: string;
  /** The run's `still-missing-<run>.md` written before 8 November, or "": read where the plan has no
   *  `## Intentionally opposed`, so an older run's trade-offs are shown rather than "none". */
  readonly older: string;
  /** The run's log length now, or null where it cannot be read. */
  readonly events: number | null;
}

/** The outcomes a prediction can have; `pending` only while its event has not come. */
export const OUTCOMES = ["held", "falsified", "unreached", "pending"] as const;

/** The line an outcomes ledger records the run's log length on when its rows were resolved. */
export const COUNTED_LINE = "Log events at resolution:";
const COUNTED = /^Log events at resolution: (\d+)\.?$/mu;

/** `text` without HTML comments and fenced code blocks. */
const stripped = (text: string) =>
  text.replaceAll(/<!--[\s\S]*?-->/gu, "").replaceAll(/^```[\s\S]*?^```/gmu, "");

/** The cells of a Markdown table line, or null for any other line. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim().replaceAll("`", ""));
}

/** The rows of every table in `text` whose header's first cell is `head`, past each header's rule. */
export function rowsOf(text: string, head: string): string[][] {
  const rows: string[][] = [];
  let inside = false;
  for (const line of stripped(text).split("\n")) {
    const cells = cellsOf(line);
    if (cells === null) {
      inside = false;
    } else if (cells[0]?.toLowerCase() === head) {
      inside = true;
    } else if (inside && cells[0] !== "" && !cells.every((cell) => /^:?-+:?$/u.test(cell))) {
      rows.push(cells);
    }
  }
  return rows;
}

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

/** The ids of a predictions ledger whose outcome in the outcomes ledger is not `held`. */
function unheldOf(predictions: string, outcomes: string): string[] {
  const outcome = outcomesOf(outcomes);
  return idsOf(predictions).filter((id) => outcome.get(id) !== "held");
}

/** The log's event count an outcomes ledger was resolved at, or null where it records none. */
export function countedOf(outcomes: string): number | null {
  const counted = COUNTED.exec(stripped(outcomes))?.[1];
  return counted === undefined ? null : Number(counted);
}

/**
 * The ids an outcomes ledger left `unreached` or `pending` while the run's log has grown past the
 * count they were resolved at, so each is open again: a run continued after its trigger may yet
 * reach them. A ledger that records no count was resolved at none. With `events` null, where the
 * log cannot be read, nothing is called stale.
 */
export function staleOf(outcomes: string, events: number | null): string[] {
  if (events === null || events <= (countedOf(outcomes) ?? 0)) return [];
  return [...outcomesOf(outcomes)]
    .filter(([, outcome]) => outcome === "unreached" || outcome === "pending")
    .map(([id]) => id);
}

/** The non-blank lines under every `## Not done` heading of a plan, whatever follows the words. */
function notDoneOf(plan: string): string[] {
  return stripped(plan)
    .split("\n")
    .filter((line) => /^## Not done\b/u.test(line))
    .flatMap((line) => sectionOf(plan, line.slice(3).trim()) ?? []);
}

/** A prediction's outcome as the views print it: unresolved, stale, or its own word. */
function shownOutcome(run: RunLedgers, id: string): string {
  const outcome = outcomesOf(run.outcomes).get(id) ?? "";
  if (!OUTCOMES.some((word) => word === outcome)) return "unresolved";
  return staleOf(run.outcomes, run.events).includes(id) ? `${outcome}, stale` : outcome;
}

/** The cycle view: every prediction of every run with its outcome, as one table. */
export function cycleViewOf(runs: readonly RunLedgers[]): string[] {
  return [
    "| run | id | outcome |",
    "| --- | --- | --- |",
    ...runs.flatMap((run) =>
      idsOf(run.predictions).map((id) => `| ${run.name} | ${id} | ${shownOutcome(run, id)} |`),
    ),
  ];
}

/**
 * The still-missing view of one run: each prediction it did not hold, with its outcome, then what
 * its iteration's plan leaves undone (`## Not done`) and leaves out on purpose
 * (`## Intentionally opposed`).
 */
export function stillMissingOf(run: RunLedgers): string[] {
  const listed = (lines: readonly string[]) => (lines.length === 0 ? ["- none"] : lines);
  const unheld = unheldOf(run.predictions, run.outcomes);
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
    unheldOf(theirs, outcomes).map((id) => `${name}:${id}`),
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
  const cycles = existsSync(root)
    ? readdirSync(root)
        .filter((entry) => /-cycle-/u.test(entry))
        .map((entry) => join(root, entry))
    : [];
  return [...new Set([dir, ...cycles])]
    .map((folder) => join(folder, file))
    .filter((path) => existsSync(path));
}

/** The one path `ledgerFiles` finds, or null where it finds none or several (a conflict to name). */
export function ledgerOf(root: string, dir: string, file: string): string | null {
  const found = ledgerFiles(root, dir, file);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The pull request a fork measures, from `forkedPR<N>` in its name, or null. */
export function forkOf(name: string): number | null {
  const pull = /forkedPR(\d+)(?!\d)/u.exec(name)?.[1];
  return pull === undefined ? null : Number(pull);
}

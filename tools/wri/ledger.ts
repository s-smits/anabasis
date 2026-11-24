/**
 * Per-run prediction and outcome ledgers for an improvement cycle: `predictions-<run>.md`,
 * `outcomes-<run>.md`, and iteration `plan.md` files (with fallback to legacy
 * `still-missing-<run>.md` files). Each fact has a single authored source; cycle, dropped, and
 * still-missing views are derived purely from these files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";

/** Parent run ledgers and optional iteration plan used to determine carried predictions on a fork. */
interface Parent {
  readonly name: string;
  readonly predictions: string;
  readonly outcomes: string;
  /** Parent iteration's `plan.md`; prediction ids listed under `## Intentionally opposed` are
   *  deliberately retired and excluded from child forks' required carry list. */
  readonly plan?: string;
}

/** Carried prediction tokens extracted from one run's `## Carried` section. */
interface Carried {
  readonly run: string;
  readonly tokens: ReadonlySet<string>;
}

/** One run's hand-written ledgers and plan for derived cycle views. */
interface RunLedgers extends Parent {
  /** Iteration `plan.md` covering this run, or `""` before a plan exists. */
  readonly plan: string;
  /** True when the run is live or already linked to an investigation that will produce a plan. */
  readonly awaited: boolean;
  /** Legacy `still-missing-<run>.md` text, read when `plan` has no `## Intentionally opposed`. */
  readonly older: string;
  /** Current log event count for the run, or `null` when the log is unavailable. */
  readonly events: number | null;
}

/** Subset of run ledgers needed to check whether outcomes are complete and up to date. */
type Resolved = Pick<RunLedgers, "predictions" | "outcomes" | "events">;

/** Canonical prediction outcomes; `pending` applies only until the deciding event arrives. */
export const OUTCOMES = ["confirmed", "refuted", "not-observed", "pending"] as const;
type Outcome = (typeof OUTCOMES)[number];

/** Accepted outcome synonyms mapped to canonical labels for authored Markdown ledgers. */
const OUTCOME_SYNONYMS = new Map<string, Outcome>([
  ["held", "confirmed"],
  ["falsified", "refuted"],
  ["unreached", "not-observed"],
  ["not observed", "not-observed"],
]);

/** Line in an outcomes ledger recording the log event count at resolution time. */
const COUNTED_LINE = "Log events at resolution:";
const COUNTED = /^Log events at resolution: (\d+)\.?$/mu;

/** Cycle-level record of external benchmark evaluations for stopped runs. */
export const OUTSIDE = "outside-reads.md";
/** Prediction group settled by an external benchmark row rather than campaign log events. */
const OUTSIDE_GROUP = "outside";
/** Heading in `plan.md` listing deliberate trade-offs and retired predictions. */
const OPPOSED = "Intentionally opposed";

/** Remove HTML comments and fenced code blocks before scanning Markdown tables or headings. */
const stripNonProse = (text: string) =>
  text.replaceAll(/<!--[\s\S]*?-->/gu, "").replaceAll(/^```[\s\S]*?^```/gmu, "");

/** Split a Markdown table row at unescaped pipes, or return `null` for non-table lines. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());
}

/** True when every cell is a Markdown separator rule (`---`, `:---:`, etc.), preserving lone `-` placeholders. */
const isSeparatorRow = (cells: readonly string[] | null | undefined) =>
  cells?.every((cell) => /^(?=..):?-+:?$/u.test(cell)) === true;

const stripTicks = (cell: string) => cell.replaceAll("`", "");

/** Normalize a raw outcome cell into a canonical outcome label. */
export function normalizeOutcome(raw: string): string {
  const cleaned = raw.replaceAll(/[*_`]/gu, "").trim().toLowerCase();
  const token = /^(?:not[- ]observed|[a-z]+(?:-[a-z]+)*)/u.exec(cleaned)?.[0] ?? "";
  return OUTCOME_SYNONYMS.get(token) ?? token;
}

/**
 * Parse every Markdown table outside comments and code fences. Headers are lower-cased with
 * backticks removed; body cells retain their text. A new separator row starts a distinct table even
 * without a blank line between adjacent tables.
 */
export function tablesOf(text: string): { header: string[]; rows: string[][] }[] {
  const lines = stripNonProse(text).split("\n").map(cellsOf);
  const tables: { header: string[]; rows: string[][] }[] = [];
  let open: string[][] | null = null;
  for (const [at, cells] of lines.entries()) {
    if (cells === null) {
      open = null;
    } else if (open === null || isSeparatorRow(lines[at + 1])) {
      open = [];
      if (!isSeparatorRow(cells)) {
        tables.push({ header: cells.map((cell) => stripTicks(cell).toLowerCase()), rows: open });
      }
    } else if (!isSeparatorRow(cells)) {
      open.push(cells);
    }
  }
  return tables;
}

/** Return rows from every table whose first header cell equals `head`, stripping backticks and empty keys. */
export const rowsOf = (text: string, head: string): string[][] =>
  tablesOf(text)
    .filter(({ header }) => header[0] === head)
    .flatMap(({ rows }) => rows.map((cells) => cells.map(stripTicks)))
    .filter(([first]) => first !== "");

/** Extract prediction ids from tables headed by `id`. */
export const idsOf = (text: string): string[] => rowsOf(text, "id").map(([id = ""]) => id);

/** Map each prediction id in an outcomes ledger to its normalized outcome token (`**Confirmed**, 4/4` -> `confirmed`). */
export const outcomesOf = (text: string): Map<string, string> =>
  new Map(rowsOf(text, "id").map(([id = "", outcome = ""]) => [id, normalizeOutcome(outcome)]));

/**
 * Extract `<run>:<id>` tokens from a predictions ledger's `## Carried` section (supporting
 * hyphenated ids such as `TR-1` and nested `<parent>:<run>:<id>` references).
 */
const carriedOf = (predictions: string): ReadonlySet<string> =>
  new Set(
    (sectionOf(predictions, "Carried") ?? [])
      .join("\n")
      .matchAll(/(?<![\w.-])[a-z][\w.-]*:[A-Za-z]\w*(?:-\w+)*(?![\w:]|-\w)/gu)
      .map(([token]) => token),
  );

/** Format a parent prediction id for carry-forward (`<run>:<id>`, preserving already-scoped ids). */
const carriedName = (run: string, id: string): string => (id.includes(":") ? id : `${run}:${id}`);

/** All prediction ids that must be resolved in a run's outcomes ledger: its own ids plus carried tokens. */
export const requiredIds = (predictions: string): string[] => [
  ...new Set([...idsOf(predictions), ...carriedOf(predictions)]),
];

/** Filter `ids` to those whose recorded outcome is not `confirmed`. */
function unconfirmedIds(ids: readonly string[], outcomes: string): string[] {
  const outcome = outcomesOf(outcomes);
  return ids.filter((id) => outcome.get(id) !== "confirmed");
}

/** Extract the log event count recorded at resolution time, or `null` if absent. */
function resolvedEventCount(outcomes: string): number | null {
  const counted = COUNTED.exec(stripNonProse(outcomes))?.[1];
  return counted === undefined ? null : Number(counted);
}

/** Return prediction ids whose `group` column equals `outside`. */
const outsideIds = (predictions: string): string[] =>
  tablesOf(predictions).flatMap(({ header, rows }) => {
    const group = header.indexOf("group");
    const marked = rows.filter((row) => row[group]?.toLowerCase() === OUTSIDE_GROUP);
    return header[0] === "id" ? marked.map(([id = ""]) => stripTicks(id)) : [];
  });

/**
 * Return non-`outside` prediction ids marked `not-observed` or `pending` when the campaign log has
 * grown past the event count recorded at resolution time, reopening them for re-evaluation.
 */
function staleOf({ predictions, outcomes, events }: Resolved): string[] {
  if (events === null || events <= (resolvedEventCount(outcomes) ?? 0)) return [];
  const outside = outsideIds(predictions);
  return [...outcomesOf(outcomes)]
    .filter(([id, outcome]) => (outcome === "not-observed" || outcome === "pending") && !outside.includes(id))
    .map(([id]) => id);
}

/**
 * List remaining discrepancies between `outcomes` and `predictions`: missing or invalid outcome
 * tokens, stale `not-observed`/`pending` entries after log growth, external-benchmark rows whose
 * status disagrees with `outside-reads.md`, and stray ids absent from `predictions`.
 */
export function unresolvedOf(ledgers: Resolved, read: string | undefined, from: string): string[] {
  const { predictions, outcomes, events } = ledgers;
  const predicted = requiredIds(predictions);
  const outcome = outcomesOf(outcomes);
  const unsettled = predicted.filter((id) => !OUTCOMES.some((word) => word === outcome.get(id)));
  const outside = outsideIds(predictions).filter((id) => !unsettled.includes(id));
  const stale = staleOf(ledgers);
  const stray = [...outcome.keys()].filter((id) => !predicted.includes(id));
  const arrived = read === "scored" || read === "skipped";
  const waiting = outside.filter((id) => (outcome.get(id) === "pending") === arrived);
  const counted = resolvedEventCount(outcomes);
  const record = events === null ? "" : `, and record "${COUNTED_LINE} ${String(events)}" on its own line`;
  return [
    unsettled.length > 0
      ? `resolve ${unsettled.join(", ")} from the log as ${OUTCOMES.join(", ")} (use pending only until the deciding event occurs), citing the count or event and UTC timestamp${record}`
      : "",
    stale.length > 0
      ? `${stale.join(", ")} were resolved as not-observed or pending at ${counted === null ? "no recorded event count" : `${String(counted)} events`}, and the log now has ${String(events)} events: re-resolve them${record}`
      : "",
    waiting.length === 0
      ? ""
      : arrived
        ? `${waiting.join(", ")} remain pending while ${OUTSIDE} marks this run as ${read ?? ""}: resolve each from those benchmark counts`
        : `${waiting.join(", ")} depend on an external evaluation, and ${OUTSIDE} does not yet mark this run as scored or skipped: keep them pending until it does`,
    stray.length > 0 ? `${stray.join(", ")} are not predicted in ${from}` : "",
  ].filter((part) => part !== "");
}

/** Extract non-blank lines under every `## Not done` heading in a plan. */
export function notDoneOf(plan: string): string[] {
  return stripNonProse(plan)
    .split("\n")
    .filter((line) => /^## Not done\b/u.test(line))
    .flatMap((line) => sectionOf(plan, line.slice(3).trim()) ?? []);
}

/** Format a prediction's outcome for derived tables (`unresolved`, `<outcome>, stale`, or `<outcome>`). */
function formatOutcome(run: RunLedgers, id: string): string {
  const outcome = outcomesOf(run.outcomes).get(id) ?? "";
  if (!OUTCOMES.some((word) => word === outcome)) return "unresolved";
  return staleOf(run).includes(id) ? `${outcome}, stale` : outcome;
}

/** Render the cycle-wide Markdown table of every prediction and its current outcome. */
export function cycleViewOf(runs: readonly RunLedgers[]): string[] {
  return [
    "| run | id | outcome |",
    "| --- | --- | --- |",
    ...runs.flatMap((run) =>
      requiredIds(run.predictions).map((id) => `| ${run.name} | ${id} | ${formatOutcome(run, id)} |`),
    ),
  ];
}

/**
 * Render predictions that ended `refuted` or `not-observed` without being carried into another
 * run's `## Carried` section or explicitly retired under `## Intentionally opposed` in the run's
 * plan. Stopped runs without an investigation are grouped separately as unaudited.
 */
export function droppedOf(runs: readonly RunLedgers[], carried: readonly Carried[]): string[] {
  const linesOf = (among: readonly RunLedgers[]) =>
    among.flatMap((run) => {
      const outcome = outcomesOf(run.outcomes);
      const opposed = (sectionOf(run.plan, OPPOSED) ?? []).join("\n");
      const others = new Set(
        carried.filter((each) => each.run !== run.name).flatMap(({ tokens }) => [...tokens]),
      );
      const left = requiredIds(run.predictions)
        .map((id) => ({ id, status: outcome.get(id) ?? "" }))
        .filter(({ status }) => status === "not-observed" || status === "refuted")
        .filter(({ id }) => !others.has(carriedName(run.name, id)) && !names(opposed, id));
      return left.length === 0
        ? []
        : [`- ${run.name}: ${left.map(({ id, status }) => `${id} (${status})`).join(", ")}`];
    });
  const dropped = linesOf(runs.filter(({ plan }) => plan !== ""));
  const unaudited = linesOf(runs.filter(({ awaited }) => !awaited));
  return [
    "# Dropped predictions: refuted or not observed, uncarried by any fork and not retired",
    "",
    ...(dropped.length === 0 ? ["- none"] : dropped),
    ...(unaudited.length === 0
      ? []
      : [
          "",
          "# Unaudited runs: refuted or not observed in a stopped run without an investigation, uncarried by any fork",
          "",
          ...unaudited,
        ]),
  ];
}

/** Render the per-run summary of unconfirmed predictions, deferred work (`## Not done`), and deliberate trade-offs. */
export function stillMissingOf(run: RunLedgers): string[] {
  const listed = (lines: readonly string[]) => (lines.length === 0 ? ["- none"] : lines);
  const unconfirmed = unconfirmedIds(requiredIds(run.predictions), run.outcomes);
  return [
    `# Still missing: ${run.name}`,
    "",
    "## Unconfirmed",
    "",
    ...listed(unconfirmed.map((id) => `- ${id}: ${formatOutcome(run, id)}`)),
    "",
    "## Not done",
    "",
    ...(run.plan === "" ? ["- no plan yet"] : listed(notDoneOf(run.plan))),
    "",
    "## Intentionally opposed",
    "",
    ...listed(sectionOf(run.plan, OPPOSED) ?? sectionOf(run.older, OPPOSED) ?? []),
  ];
}

/**
 * Determine which unconfirmed parent predictions a fork must carry in its `## Carried` section
 * (excluding ids retired under the parent plan's `## Intentionally opposed`), and report any
 * missing carry tokens.
 */
export function carryOf(
  predictions: string,
  parents: readonly Parent[],
): { owed: string[]; missing: string[] } {
  const required = parents.flatMap(({ name, predictions: theirs, outcomes, plan = "" }) => {
    const opposed = (sectionOf(plan, OPPOSED) ?? []).join("\n");
    return unconfirmedIds(idsOf(theirs), outcomes)
      .filter((id) => !names(opposed, id))
      .map((id) => carriedName(name, id));
  });
  const carried = carriedOf(predictions);
  return { owed: required, missing: required.filter((token) => !carried.has(token)) };
}

/** Extract the PR number named by `Pull request: #N` in a plan, or `null`. */
export function pullOf(plan: string): number | null {
  const named = /^Pull request: #(\d+)/mu.exec(plan)?.[1];
  return named === undefined ? null : Number(named);
}

/** Extract non-blank lines under `## <heading>` up to the next `##` heading, or `null` if absent. */
export function sectionOf(text: string, heading: string): string[] | null {
  const lines = stripNonProse(text).split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line.trim() !== "");
}

/** True when `text` contains `token` as a standalone word (delimited by non-word, non-hyphen characters). */
export const names = (text: string, token: string): boolean =>
  new RegExp(
    `(?:^|[^\\w-])${token.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}(?:[^\\w-]|$)`,
    "mu",
  ).test(stripNonProse(text));

/** Locate all copies of `file` inside `dir` and every `<date>-cycle-<release>` folder under `root`. */
export function ledgerFiles(root: string, dir: string, file: string): string[] {
  return ledgerFolders(root, dir)
    .map((folder) => join(folder, file))
    .filter((path) => existsSync(path));
}

/** Folders searched for cycle ledgers: `dir` plus every `-cycle-` folder under `root`. */
function ledgerFolders(root: string, dir: string): string[] {
  const cycles = existsSync(root)
    ? readdirSync(root)
        .filter((entry) => /-cycle-/u.test(entry))
        .map((entry) => join(root, entry))
    : [];
  return [...new Set([dir, ...cycles])];
}

/** Collect every `## Carried` section across predictions ledgers in `dir` and cycle folders under `root`. */
export const carriedIn = (root: string, dir: string): Carried[] =>
  ledgerFolders(root, dir)
    .filter((folder) => existsSync(folder) && statSync(folder).isDirectory())
    .flatMap((folder) =>
      readdirSync(folder)
        .filter((file) => /^predictions-.+\.md$/u.test(file))
        .map((file) => ({
          run: file.slice("predictions-".length, -".md".length),
          tokens: carriedOf(readFileSync(join(folder, file), "utf8")),
        })),
    );

/** Return the single matching ledger path from `ledgerFiles`, or `null` if absent or ambiguous. */
export function ledgerOf(root: string, dir: string, file: string): string | null {
  const found = ledgerFiles(root, dir, file);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Read each run's status (`scored`, `skipped`, or `owed`) from `outside-reads.md` files under `root`
 * and `dir`. When a run appears multiple times, the last row wins.
 */
export const outsideOf = (root: string, dir = root): Map<string, string> =>
  new Map(
    ledgerFiles(root, dir, OUTSIDE).flatMap((path) =>
      rowsOf(readFileSync(path, "utf8"), "run").map(
        (cells) => [cells[0] ?? "", /[a-z]+/u.exec((cells.at(-1) ?? "").toLowerCase())?.[0] ?? ""] as const,
      ),
    ),
  );

/** Format reminder lines for runs whose external benchmark evaluation is still marked `owed` in `outside-reads.md`. */
export const pendingOutsideReads = (
  outside: ReadonlyMap<string, string>,
  runs?: readonly string[],
): string[] =>
  [...outside]
    .filter(([run, kind]) => kind === "owed" && runs?.includes(run) !== false)
    .map(
      ([run]) =>
        `outside · ${run} · external benchmark pending in ${OUTSIDE}: run it when login capacity opens, then mark the row scored or skipped`,
    );

/** Extract fork run names referenced in the `launch` row of a `deviations.md` file. */
export const launchForks = (deviations: string): string[] =>
  rowsOf(deviations, "step")
    .filter(([step]) => step === "launch")
    .flatMap(([, reason = ""]) => reason.match(/[\w.-]+-forkedPR\d+(?:-\w+)*/gu) ?? []);

/** Extract the target PR number from a `forkedPR<N>` run name, or `null`. */
export function forkOf(name: string): number | null {
  const pull = /forkedPR(\d+)(?!\d)/u.exec(name)?.[1];
  return pull === undefined ? null : Number(pull);
}

/** True when an iteration's plan PR or `launch` deviation row produced run `name`. */
export function madeBy(plan: string, deviations: string, name: string): boolean {
  const pull = pullOf(plan);
  return (pull !== null && forkOf(name) === pull) || launchForks(deviations).includes(name);
}

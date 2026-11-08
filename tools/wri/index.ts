/**
 * One page over every whole-run investigation, `wri.ts index`. By 3 November `.ana/wri/` held 57
 * folders, 26 with a synthesis and 20 with a vetting, and nothing listed them together: the
 * recurring constraint of a domain was read by opening each synthesis in turn. This reads every
 * folder as it stands and renders one row a folder, newest first, then each campaign group's
 * investigations in time order, so a domain's binding constraints show side by side.
 *
 * The page is a view over the folders, written whole each time and never edited, so it is no second
 * store (`AGENTS.md` section 5, habit 1). The files it reads hold hidden values, so it quotes only
 * the first sentence of each binding constraint, cut at about 300 characters, and counts, and it
 * belongs under `.ana/` beside them. It copies no lane prose.
 *
 * Reading is lenient because the folders span every shape the procedure has had since 19 October:
 * `investigation.json` named one `log` and its `peers` before it named `logs`, a synthesis written
 * before the template has no section 2 or no findings table, an A/B synthesis or a review stands in
 * for one in older folders, some folders hold collected lanes and no synthesis, and some hold notes
 * alone. A part that is missing reads as none and the row says so; nothing here throws on a folder.
 *
 * The operator asked on 3 November to "backtrack the older runs ... from last 2 weeks to centralize
 * the summaries", so two more sections follow the investigations. One lists each cycle folder and
 * prediction ledger, under `.ana/wri/` and in the main checkout's `notes/`, with its predictions
 * counted by resolution. The other lists every campaign whose log moved in the last fourteen days,
 * from the run registry's local worktrees and archive, with its ending, its promotions through
 * `epochsOf`, and the investigations and ledgers that name it, so a run nobody investigated or
 * predicted shows as such.
 *
 * From 7 November each run keeps its own ledgers in a cycle folder (`predictions-<run>.md` and
 * `outcomes-<run>.md`, read by `tools/wri/ledger.ts`, and until 8 November a hand-written
 * `still-missing-<run>.md`; from then the plan says what is left out on purpose), and an
 * investigation's `plan.md` names its pull request as `Pull request: #N`, measured by the forks
 * named `...forkedPR<N>`. Until then nothing recorded across iterations whether each fix held, so a
 * last section rows each pull request with its forks, their outcomes, the predictions still
 * unresolved, what each fork leaves out on purpose, and whether each fork carried the ids its
 * parent's runs did not hold. A fork from before the per-run files reads as "no per-run files".
 */
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural, textOr } from "#src/meta/text.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { isCampaign, logEvents, type Run } from "../runs/registry.ts";
import {
  forkOf,
  idsOf,
  ledgerFiles,
  carryOf,
  OUTCOMES,
  outcomesOf,
  pullOf,
  sectionOf as linesUnder,
} from "./ledger.ts";

type Counts = Readonly<Record<string, number>>;

/** How much of a folder's synthesis and vetting was read: every part, some, none of what it holds,
 *  it holds neither file, or it holds collected lanes alone. */
type Parsed = "whole" | "part" | "unread" | "absent" | "lanes";

interface Lanes {
  readonly found: number;
  readonly none: number;
  readonly unread: number;
  readonly other: number;
}

interface Ledger {
  readonly folder: string;
  readonly words: ReadonlySet<string>;
  readonly row: readonly string[];
}

interface Entry {
  readonly folder: string;
  readonly date: string | null;
  readonly campaigns: readonly string[];
  /** The file that summarises the folder: its synthesis, or what stands in for one. */
  readonly summary: string | null;
  readonly constraint: string | null;
  readonly findings: Counts | null;
  readonly vetting: Counts | null;
  readonly lanes: Lanes | null;
  readonly files: readonly string[];
  readonly parsed: Parsed;
  /** The pull request its `plan.md` names, or null. */
  readonly pull: number | null;
}

/** A run's per-run ledgers by kind, as far as it holds them, and each one two folders hold. */
interface PerRun {
  readonly name: string;
  readonly files: Partial<Record<(typeof PER_RUN)[number], string>>;
  readonly conflicts: readonly string[];
}

/** Where the index reads beyond the investigations: the main checkout's `notes/`, the runs the
 *  registry finds, and the clock that dates the last fourteen days. */
export interface Beyond {
  readonly notes: string;
  readonly runs: readonly Run[];
  readonly now: number;
}

export const SYNTHESIS = "synthesis.md";
/** What stands in for a synthesis in folders older than the template, best first. */
const STAND_INS = [/^ab-synthesis\.md$/u, /^review.*\.md$/u];
/** A cycle folder's or a ledger's files, by their lower-cased names. */
const LEDGERS: ReadonlySet<string> = new Set(["cycle.md", "predictions.md"]);
export const VETTING = "vetting.md";
export const REPORTS = "reports.md";
/** What `start` writes: the logs an investigation reads, and the instructions every lane carries. */
export const INVESTIGATION = "investigation.json";
export const SHARED = "shared-instructions.md";
const INDEX = "INDEX.md";
/** The quoted sentence's length, so a constraint is named and no hidden value is carried whole. */
const QUOTE = 300;
const NAMES_SHOWN = 3;
const VERDICTS = ["confirmed", "plausible", "refuted"] as const;
const PREDICTIONS = ["held", "falsified", "unreached"] as const;
const WORDS = new RegExp(`\\b(${[...VERDICTS, ...PREDICTIONS].join("|")})\\b`, "u");
const PREDICTED = new RegExp(`\\b(${PREDICTIONS.join("|")})\\b`, "u");
/** A ledger's column that resolves its predictions: `held, falsified or unreached` and its kin. */
const RESOLVED = /^(verdict|resolution|outcome|held, falsified)/u;
const RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
const DATE = /(\d{4})-?(\d{2})-?(\d{2})/u;
/** The per-run ledgers of a cycle folder, `<kind>-<run>.md`. */
const PER_RUN = ["predictions", "outcomes", "still-missing"] as const;
const PER_RUN_FILE = new RegExp(`^(?:${PER_RUN.join("|")})-(.+)\\.md$`, "u");
const NO_FILES = "no per-run files";
const PARSED_WORDS = {
  whole: "read whole",
  part: "read in part",
  unread: "held, not read",
  absent: "no synthesis or vetting",
  lanes: "lanes collected, not synthesised",
} as const satisfies Record<Parsed, string>;

const textAt = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);

/** The text under the first `## ` heading `test` accepts, up to the next, comments dropped. */
function sectionOf(markdown: string, test: (heading: string) => boolean): string | null {
  const lines = markdown.replaceAll(/<!--[\s\S]*?-->/gu, "").split("\n");
  const from = lines.findIndex((line) => line.startsWith("## ") && test(line.slice(3)));
  if (from === -1) return null;
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());

/** Every Markdown table in `text`: its header cells, lower-cased, and its data rows. */
function tablesOf(text: string): { header: string[]; rows: string[][] }[] {
  const lines = text.split("\n");
  return lines.flatMap((line, at) => {
    const head = lines[at - 1];
    if (!/^\|\s*:?-{3,}/u.test(line) || head?.trim().startsWith("|") !== true) return [];
    const rows = [];
    for (const each of lines.slice(at + 1)) {
      if (!each.trim().startsWith("|")) break;
      rows.push(cellsOf(each));
    }
    return [{ header: cellsOf(head).map((cell) => cell.toLowerCase()), rows }];
  });
}

/** The first sentence of the section's first paragraph, on one line and cut at `QUOTE`. */
function firstSentence(section: string): string | null {
  const paragraph = section
    .split(/\n\s*\n/u)
    .map((each) => each.trim())
    .find((each) => each !== "" && !/^(#|\||```|>)/u.test(each));
  if (paragraph === undefined) return null;
  const line = paragraph.replaceAll(/\s+/gu, " ");
  // A sentence ends at its stop and any closing marks after it: `**Supply held.** Next` ends at `**`.
  const sentence = /^.*?[.!?][*`"')\]]*(?=\s+[A-Z(`*"[]|$)/u.exec(line)?.[0] ?? line;
  const cut = sentence.length > QUOTE ? `${sentence.slice(0, QUOTE).trimEnd()}…` : sentence;
  return cut.replaceAll("|", String.raw`\|`);
}

/** The campaigns a folder read: `investigation.json`'s `logs`, or its older `log` and `peers`, else
 *  the campaign headings of a several-campaign `overview.md`. */
function campaignsOf(dir: string): string[] {
  const json = textAt(join(dir, INVESTIGATION));
  const read = asRecord(json === null ? null : capturedJsonParse(json));
  const listed = [read?.logs, read?.peers].flatMap((each) => (Array.isArray(each) ? each : []));
  const logs = [read?.log, ...listed].filter(isString);
  if (logs.length > 0) return [...new Set(logs.map((log) => basename(dirname(log))))];
  const overview = textAt(join(dir, "overview.md")) ?? "";
  return [...overview.matchAll(/^## (\S+)$/gmu)].flatMap(([, name]) => name ?? []);
}

/** A campaign's pack, from its name: what stands before `-fresh-`, else its first word. */
const groupOf = (name: string): string =>
  name.includes("-fresh-") ? name.slice(0, name.indexOf("-fresh-")) : (name.split("-")[0] ?? name);

/** The merged findings by outcome: section 3's first table with an `outcome` column, by the first
 *  word of each row's outcome. */
function findingsOf(synthesis: string): Counts | null {
  const section = sectionOf(synthesis, (heading) => heading.startsWith("3.")) ?? "";
  const table = tablesOf(section).find(({ header }) => header.includes("outcome"));
  if (table === undefined) return null;
  const column = table.header.indexOf("outcome");
  return countBy(table.rows, (row) => /[a-z-]+/u.exec((row[column] ?? "").toLowerCase())?.[0] ?? "blank");
}

/** Each row by the first of `words` its column names, over every table whose header has a column
 *  `header` accepts; a row whose cell names none of them is left out. A vetting is read by its
 *  `verdict` or `resolution` column, a ledger by `RESOLVED`. */
function markedOf(text: string, header: RegExp, words: RegExp): string[] {
  return tablesOf(text).flatMap(({ header: cells, rows }) => {
    const column = cells.findIndex((cell) => header.test(cell));
    if (column === -1) return [];
    return rows.flatMap((row) => words.exec((row[column] ?? "").toLowerCase())?.[1] ?? []);
  });
}

const tallied = (words: readonly string[]): Counts | null =>
  words.length === 0 ? null : countBy(words, (word) => word);

/** The lanes `collect` listed (`reportIndex`): with findings, read with none, left unread (omitted,
 *  or not read, with no finding), and every other state. Until 9 November an unread lane counted as
 *  one read with none. */
function lanesOf(reports: string): Lanes | null {
  const lines = reports.split("\n").filter((line) => line.startsWith("- lane "));
  if (lines.length === 0) return null;
  const count = (verdict: RegExp) => lines.filter((line) => verdict.test(line)).length;
  const found = count(/: ok, [a-z ]+, [1-9]\d* findings?,/u);
  const none = count(/: ok, no finding, 0 findings,/u);
  const unread = count(/: ok, (omitted|could not read)[a-z ]*, 0 findings,/u);
  return { found, none, unread, other: lines.length - found - none - unread };
}

function parsedOf(parts: readonly (boolean | null)[]): Parsed {
  const held = parts.filter((part) => part !== null);
  if (held.length === 0) return "absent";
  const read = held.filter(Boolean).length;
  if (read === held.length) return "whole";
  return read === 0 ? "unread" : "part";
}

const dateOf = (name: string): string | null => {
  const [, year, month, day] = DATE.exec(name) ?? [];
  return year === undefined ? null : `${year}-${month ?? ""}-${day ?? ""}`;
};

const isDirectory = (path: string): boolean => statSync(path).isDirectory();

/** A folder's row. A subfolder other than `lanes` is counted and never read: a labels folder's
 *  hold hidden values. */
function entryOf(root: string, folder: string): Entry {
  const dir = join(root, folder);
  // Newest stand-in first: `review-v2.md` before `review.md`.
  const names = readdirSync(dir).toSorted((one, other) =>
    compareCodeUnits(basename(other, ".md"), basename(one, ".md")),
  );
  const summary = [/^synthesis\.md$/u, ...STAND_INS].flatMap(
    (test) => names.find((name) => test.test(name)) ?? [],
  )[0];
  const [synthesis = null, vetting = null, reports = null] = [summary, VETTING, REPORTS].map((file) =>
    file === undefined ? null : textAt(join(dir, file)),
  );
  const section =
    synthesis === null ? null : sectionOf(synthesis, (heading) => /binding constraint/iu.test(heading));
  const title = summary === SYNTHESIS ? undefined : /^# (.+)$/mu.exec(synthesis ?? "")?.[1];
  const standIn = title === undefined ? null : `title: ${firstSentence(title) ?? ""}`;
  const constraint = section === null ? standIn : firstSentence(section);
  const findings = synthesis === null ? null : findingsOf(synthesis);
  const read = vetting === null ? null : tallied(markedOf(vetting, /^(verdict|resolution)\b/u, WORDS));
  const lanes = reports === null ? null : lanesOf(reports);
  const lanesDir = join(dir, "lanes");
  const reportFiles = existsSync(lanesDir)
    ? readdirSync(lanesDir).filter((file) => file.endsWith("-report.md")).length
    : 0;
  const laneCount = lanes === null ? reportFiles : lanes.found + lanes.none + lanes.unread + lanes.other;
  const subfolders = names.filter((name) => name !== "lanes" && isDirectory(join(dir, name))).length;
  return {
    folder,
    date: dateOf(folder),
    campaigns: campaignsOf(dir),
    summary: summary ?? null,
    constraint,
    findings,
    vetting: read,
    lanes,
    files: [
      ...(summary === undefined ? [] : [basename(summary, ".md")]),
      ...(vetting === null ? [] : ["vetting"]),
      ...(reports === null ? [] : ["reports"]),
      ...(laneCount === 0 ? [] : [plural(laneCount, "lane")]),
      ...(subfolders === 0 ? [] : [plural(subfolders, "other subfolder")]),
    ],
    parsed:
      synthesis === null && vetting === null && reports !== null
        ? "lanes"
        : parsedOf([
            synthesis === null ? null : constraint !== null,
            synthesis === null ? null : findings !== null,
            vetting === null ? null : read !== null,
          ]),
    pull: pullOf(textAt(join(dir, "plan.md")) ?? ""),
  };
}

/** Counts as `name n`, largest first, or `none`. */
function counted(counts: Counts | null, names?: readonly string[]): string {
  const rows = Object.entries(counts ?? {}).filter(([name]) => names?.includes(name) ?? true);
  if (rows.length === 0) return "none";
  return rows
    .toSorted(([one, a], [other, b]) => b - a || compareCodeUnits(one, other))
    .map(([name, count]) => `${name} ${String(count)}`)
    .join(", ");
}

function campaignsText(campaigns: readonly string[]): string {
  if (campaigns.length === 0) return "none named";
  const groups = Object.groupBy(campaigns, groupOf);
  return Object.entries(groups)
    .map(([group, names = []]) => {
      const shown = names.slice(0, NAMES_SHOWN).map((name) => `\`${name}\``);
      const more = names.length > NAMES_SHOWN ? ` +${String(names.length - NAMES_SHOWN)}` : "";
      return `${group}: ${shown.join(", ")}${more}`;
    })
    .join("; ");
}

function constraintText({ constraint, summary }: Entry): string {
  if (constraint !== null) return constraint;
  return summary === null ? "no synthesis" : "no binding constraint section";
}

function rowOf(entry: Entry): string {
  const vetted =
    entry.vetting === null
      ? "none"
      : `${counted(entry.vetting, VERDICTS)}; predictions ${counted(entry.vetting, PREDICTIONS)}`;
  const cells = [
    entry.date ?? "undated",
    `\`${entry.folder}\``,
    campaignsText(entry.campaigns),
    constraintText(entry),
    counted(entry.findings),
    vetted,
    `${textOr(entry.files.join(", "), "notes only")}; ${PARSED_WORDS[entry.parsed]}`,
  ];
  return `| ${cells.join(" | ")} |`;
}

/** Each campaign group's investigations, oldest first, with their constraints and lane counts. */
function groupsText(entries: readonly Entry[]): string {
  const byGroup = new Map<string, Entry[]>();
  for (const entry of entries.toReversed()) {
    for (const group of new Set(entry.campaigns.map(groupOf))) {
      byGroup.set(group, [...(byGroup.get(group) ?? []), entry]);
    }
  }
  return [...byGroup.entries()]
    .toSorted(([one], [other]) => compareCodeUnits(one, other))
    .map(([group, held]) => {
      const lines = held.map((entry) => {
        const { lanes } = entry;
        const unread = (lanes?.unread ?? 0) > 0 ? `, ${String(lanes?.unread)} unread` : "";
        const other = (lanes?.other ?? 0) > 0 ? `, ${String(lanes?.other)} missing or invalid` : "";
        const read =
          lanes === null
            ? "no lane index"
            : `lanes: ${String(lanes.found)} with findings, ${String(lanes.none)} with none${unread}${other}`;
        return `- ${entry.date ?? "undated"} \`${entry.folder}\`: ${constraintText(entry)} (${read})`;
      });
      return `### ${group} (${plural(held.length, "investigation")})\n\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

/** Folders under `dir` that hold a cycle file or a prediction ledger, each with its predictions
 *  counted by resolution, `where` naming the place in a row, and the words its files hold, so a
 *  campaign the ledger names finds it whole and never by a longer name it begins. */
function ledgersIn(dir: string, where: string): Ledger[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((folder) => {
    const path = join(dir, folder);
    const files = isDirectory(path)
      ? readdirSync(path)
          .filter((name) => LEDGERS.has(name.toLowerCase()))
          .toSorted(compareCodeUnits)
      : [];
    if (files.length === 0) return [];
    const texts = files.map((file) => readFileSync(join(path, file), "utf8"));
    const marks = texts.flatMap((text) => markedOf(text, RESOLVED, PREDICTED));
    return [
      {
        folder,
        // A name may hold a dot (`DeepSeek-V4.1`); a sentence's stop after one is no part of it.
        words: new Set(
          texts.flatMap((text) => text.split(/[^\w.-]+/u).map((word) => word.replace(/\.+$/u, ""))),
        ),
        row: [dateOf(folder) ?? "undated", `\`${folder}\``, where, files.join(", "), counted(tallied(marks))],
      },
    ];
  });
}

/** Up to `NAMES_SHOWN` folders in backticks and how many more, or `none`. */
function folderList(folders: readonly string[]): string {
  const shown = folders.slice(0, NAMES_SHOWN).map((folder) => `\`${folder}\``);
  const more = folders.length > NAMES_SHOWN ? [`+${String(folders.length - NAMES_SHOWN)}`] : [];
  return textOr([...shown, ...more].join(", "), "none");
}

/** The campaigns whose log took an event in the `RECENT_DAYS` before `now`, newest first: a log's
 *  file time sorts them out first, since a gathered copy can be newer than its last event. A log
 *  that will not read is shown so. A campaign's ending is its log's last event, as every reader
 *  takes it: one that went on after an ending has none. */
function movedRows(
  runs: readonly Run[],
  entries: readonly Entry[],
  ledgers: readonly Ledger[],
  now: number,
): string[][] {
  const since = now - RECENT_DAYS * DAY_MS;
  const rows = runs.flatMap((run) => {
    const moved = statSync(run.path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (!isCampaign(run) || run.seed === true || moved < since) return [];
    const where =
      run.archived === undefined ? `worktree \`${basename(run.tree)}\`` : `archive, ${run.archived}`;
    const head = [`\`${run.name}\``, where];
    const tail = [
      folderList(entries.filter(({ campaigns }) => campaigns.includes(run.name)).map(({ folder }) => folder)),
      folderList(ledgers.filter(({ words }) => words.has(run.name)).map(({ folder }) => folder)),
    ];
    let events;
    try {
      events = logEvents(run.path);
    } catch {
      return [["unreadable", ...head, "unreadable log", "unknown", ...tail]];
    }
    const last = events.at(-1);
    if (last === undefined || Date.parse(last.at) < since) return [];
    const epochs = epochsOf(events);
    const promoted = epochs.filter(({ promoted: harness }) => harness !== null).length;
    const confirmed = epochs.filter(({ confirmed: read }) => read === true).length;
    const ending =
      last.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : "no ending";
    return [
      [last.at.slice(0, 10), ...head, ending, `${String(promoted)}, ${String(confirmed)} confirmed`, ...tail],
    ];
  });
  return rows.toSorted(
    ([one = "", a = ""], [other = "", b = ""]) => compareCodeUnits(other, one) || compareCodeUnits(a, b),
  );
}

const tableOf = (header: readonly string[], rows: readonly (readonly string[])[]): string[] => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.join(" | ")} |`),
];

/** `run`'s per-run ledgers, from the cycle folders under `root` and each of `dirs`. */
function perRunOf(root: string, dirs: readonly string[], run: string): PerRun {
  const files: PerRun["files"] = {};
  const conflicts: string[] = [];
  for (const kind of PER_RUN) {
    const file = `${kind}-${run}.md`;
    const held = [...new Set(dirs.flatMap((dir) => ledgerFiles(root, dir, file)))];
    if (held.length > 1) conflicts.push(`${file} in ${String(held.length)} folders`);
    else if (held[0] !== undefined) files[kind] = readFileSync(held[0], "utf8");
  }
  return { name: run, files, conflicts };
}

/** The items of a plan's or an old still-missing file's `## Intentionally opposed`: its list items, else its lines,
 *  the line `none` counting as no item; null without the section. */
function opposedOf(text: string): number | null {
  const lines = linesUnder(text, "Intentionally opposed")?.filter((line) => /^\S/u.test(line));
  if (lines === undefined) return null;
  const items = lines.filter((line) => /^(?:[-*]|\d+\.)\s/u.test(line));
  return items.length > 0
    ? items.length
    : lines.filter((line) => line.trim().toLowerCase() !== "none").length;
}

/** Whether `fork`'s `## Carried` names what its parents owe it, read as `wri2p2.ts next` reads it. */
function carriedOf(fork: PerRun, parents: readonly PerRun[]): string {
  if (parents.every(({ files }) => files.predictions === undefined)) return "parents: no per-run files";
  const { owed, missing } = carryOf(
    fork.files.predictions ?? "",
    parents.map(({ name, files }) => ({
      name,
      predictions: files.predictions ?? "",
      outcomes: files.outcomes ?? "",
    })),
  );
  if (linesUnder(fork.files.predictions ?? "", "Carried") === null) {
    return `no Carried section, ${plural(owed.length, "owed item")}`;
  }
  const named = `${String(owed.length - missing.length)} of ${String(owed.length)} carried`;
  return missing.length === 0 ? named : `${named}, missing ${missing.join(", ")}`;
}

/** One row a pull request that a plan names or a fork's name carries, newest first: its forks, their
 *  outcomes counted, the predictions no outcome resolves, the items left out on purpose, and whether
 *  each fork carried what its parent investigation's runs did not hold. */
function pullRows(root: string, entries: readonly Entry[], known: readonly string[]): string[][] {
  const pulls = [
    ...new Set([
      ...entries.flatMap(({ pull }) => pull ?? []),
      ...known.flatMap((name) => forkOf(name) ?? []),
    ]),
  ];
  return pulls
    .toSorted((one, other) => other - one)
    .map((pull) => {
      const planned = entries.filter((entry) => entry.pull === pull);
      const dirs = [root, ...planned.map(({ folder }) => join(root, folder))];
      const parents = planned.flatMap(({ folder, campaigns }) =>
        campaigns.map((run) => perRunOf(root, [root, join(root, folder)], run)),
      );
      const forks = [...new Set(known.filter((name) => forkOf(name) === pull))]
        .toSorted(compareCodeUnits)
        .map((name) => perRunOf(root, dirs, name));
      const held = forks.filter(({ files, conflicts }) => Object.keys(files).length + conflicts.length > 0);
      const forkCell = forks.map(({ name, files, conflicts }) => {
        const note = Object.keys(files).length + conflicts.length === 0 ? ` (${NO_FILES})` : "";
        return `\`${name}\`${note}${conflicts.map((each) => ` (${each})`).join("")}`;
      });
      const head = [
        `#${String(pull)}`,
        folderList(planned.map(({ folder }) => folder)),
        textOr(forkCell.join(", "), "none"),
      ];
      if (held.length === 0) return [...head, NO_FILES, NO_FILES, NO_FILES, NO_FILES];
      const outcomes = held.flatMap(({ files }) => [...outcomesOf(files.outcomes ?? "").values()]);
      // What a fork leaves out on purpose is the plan's of the iteration that read it; a
      // `still-missing-<run>.md` written before 8 November held it instead.
      const opposed = held.map(({ name, files }) => {
        const plan = entries
          .filter(({ campaigns }) => campaigns.includes(name))
          .map(({ folder }) => textAt(join(root, folder, "plan.md")) ?? "")
          .find((text) => linesUnder(text, "Intentionally opposed") !== null);
        const text = files["still-missing"] ?? plan;
        return text === undefined ? null : opposedOf(text);
      });
      const unwritten = opposed.filter((count) => count === null).length;
      return [
        ...head,
        OUTCOMES.map((word) => `${word} ${String(outcomes.filter((each) => each === word).length)}`).join(
          ", ",
        ),
        textOr(
          held
            .flatMap(({ name, files: { predictions = "", outcomes: resolved = "" } }) => {
              const outcome = outcomesOf(resolved);
              return idsOf(predictions)
                .filter((id) => !outcome.has(id))
                .map((id) => `${name}:${id}`);
            })
            .join(", "),
          "none",
        ),
        `${String(opposed.reduce<number>((sum, count) => sum + (count ?? 0), 0))}${unwritten > 0 ? `; ${String(unwritten)} without the section` : ""}`,
        held.map((fork) => `${fork.name}: ${carriedOf(fork, parents)}`).join("; "),
      ];
    });
}

/** The index of every investigation under `root`, every ledger there and in `notes`, and every
 *  campaign of `runs` that moved lately; with how many folders were read whole, in part, not at all,
 *  or hold no synthesis or vetting, and each section's row count. */
export function investigationIndex(root: string, { notes, runs, now }: Beyond) {
  const names = readdirSync(root).filter((name) => name !== INDEX);
  const folders = names.filter((name) => isDirectory(join(root, name)));
  const loose = names.filter((name) => !folders.includes(name));
  const entries = folders
    .map((folder) => entryOf(root, folder))
    .toSorted(
      (one, other) =>
        compareCodeUnits(other.date ?? "", one.date ?? "") || compareCodeUnits(other.folder, one.folder),
    );
  const parsed = countBy(entries, ({ parsed: each }) => PARSED_WORDS[each]);
  const ledgers = [...ledgersIn(root, "`.ana/wri`"), ...ledgersIn(notes, "`notes`")].toSorted(
    ({ row: [one = ""] }, { row: [other = ""] }) => compareCodeUnits(other, one),
  );
  const moved = movedRows(runs, entries, ledgers, now);
  const known = [
    ...runs.filter(isCampaign).map(({ name }) => name),
    ...entries.flatMap(({ campaigns }) => campaigns),
    // Each run a cycle folder keeps a per-run ledger for.
    ...readdirSync(root)
      .filter((entry) => /-cycle-/u.test(entry) && isDirectory(join(root, entry)))
      .flatMap((entry) =>
        readdirSync(join(root, entry)).flatMap((file) => PER_RUN_FILE.exec(file)?.[1] ?? []),
      ),
  ];
  const pulls = pullRows(root, entries, known);
  const text = [
    "# Whole-run investigations",
    "",
    `Written by \`bun tools/wri/wri.ts index\` over \`${root}\`, whole each time: never edit it. It quotes each synthesis's binding constraint and so holds hidden values: keep it under \`.ana/\`, out of prompts and pull requests.`,
    "",
    `${plural(entries.length, "folder")}: ${counted(parsed)}.${loose.length > 0 ? ` Files at the root: ${loose.map((name) => `\`${name}\``).join(", ")}.` : ""}`,
    "",
    "| date | folder | campaigns | binding constraint | findings by outcome | vetting | files |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...entries.map(rowOf),
    "",
    "## By campaign group",
    "",
    groupsText(entries),
    "",
    "## Cycles and ledgers",
    "",
    `${plural(ledgers.length, "folder")} under \`${root}\` and \`${notes}\` hold a cycle file or a prediction ledger. Predictions are counted from a table column headed verdict, resolution, outcome or "held, falsified or unreached".`,
    "",
    ...tableOf(
      ["date", "folder", "where", "files", "predictions"],
      ledgers.map(({ row }) => row),
    ),
    "",
    `## Runs of the last ${String(RECENT_DAYS)} days`,
    "",
    `${plural(moved.length, "campaign")} took an event in the ${String(RECENT_DAYS)} days to ${new Date(now).toISOString().slice(0, 10)}. Read from this machine's worktrees and its archive alone, with no network: a peer's campaign shows as far as the last gather copied it. Seeds are left out. Promotions and their confirmations come from \`epochsOf\`; a ledger is listed where its files name the campaign whole.`,
    "",
    ...tableOf(
      ["last event", "campaign", "where", "ending", "promotions", "investigations", "ledgers"],
      moved,
    ),
    "",
    "## Pull requests and their forks",
    "",
    `${plural(pulls.length, "pull request")} named by an investigation's \`plan.md\` (\`Pull request: #N\`) or by a fork's name (\`forkedPR<N>\`). Each fork's \`predictions-<run>.md\`, \`outcomes-<run>.md\` and \`still-missing-<run>.md\` are read from the cycle folders and the investigation that names the pull request; a fork from before them reads "${NO_FILES}". Carried compares a fork's \`## Carried\` with the ids its parent investigation's runs did not hold, as \`<run>:<id>\`.`,
    "",
    ...tableOf(
      [
        "pull request",
        "investigations",
        "forks",
        "outcomes",
        "unresolved predictions",
        "intentionally opposed",
        "carried",
      ],
      pulls,
    ),
    "",
  ].join("\n");
  return {
    text,
    parsed,
    rows: {
      investigations: entries.length,
      ledgers: ledgers.length,
      runs: moved.length,
      pulls: pulls.length,
    },
  };
}

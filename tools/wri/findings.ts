/**
 * The vetted findings of the investigations, read one way for every reader: a `vetting.md`'s findings
 * tables, each a table with a `verdict` column whatever its other headers, a row a finding. An
 * iteration's plan gate reads which rows are confirmed (`wri2p2.ts`), its vet gate what the fixed
 * columns still owe (`vettingFaults`), and `wri.ts findings` folds every investigation under one root
 * into one ledger (`findingsLedger`): each standing finding by the investigations that hold it, the
 * confirmed rows by importance and by what became of them, and each lane by the rows it fed, the
 * newest window beside the one before it.
 *
 * Until 17 November the plan gate read a findings table only where its first header cell was `#` and
 * a row as confirmed only where a cell began with the bare word: it read every confirmed row in 4 of
 * the 15 iterations of 10 to 16 November and none in 10, whose tables were headed `id`, `vet` or
 * `row`, or wrote the verdict in bold.
 *
 * The ledger prints counts, keys of the register, lane numbers and folder dates, never a finding's
 * text: a vetting row can quote a task.
 */
import { DAY_MS } from "#src/meta/clock.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { REFERENCES } from "./catalogue.ts";
import { rowsOf, tablesOf } from "./ledger.ts";

export const VERDICTS = ["confirmed", "plausible", "refuted"] as const;
type Verdict = (typeof VERDICTS)[number];

/** What becomes of a confirmed finding: a row of this plan, a row owed to a later plan, a decision
 *  put to the operator, or nothing, with the reason. */
const FATES = ["repair", "carry", "operator", "none"] as const;
/** The columns a vetting's findings table has from 17 November, in any order, beside any other. */
const COLUMNS = ["id", "finding", "lanes", "standing", "owner", "importance", "verdict", "fate"] as const;
const IMPORTANCE = /^I[0-3]$/u;
/** A row that the register does not hold yet. */
const NEW = "new";
/** A row the primary found in its own reading, which no lane reported. */
const PRIMARY = "primary";
const VETTING = "vetting.md";
/** The register: one row a finding that investigations keep meeting, with the decision on record. */
const REGISTER = join(REFERENCES, "standing-findings.md");
const DATED = /^(\d{4}-\d{2}-\d{2})-/u;

/** One row of a findings table. A column its table lacks reads as "". */
export interface Finding {
  /** `vet-<n>`, however the row wrote it (`3`, `vet-3`, in bold or in backticks). */
  readonly id: string;
  readonly verdict: Verdict;
  /** The lanes it rests on, each `<lane>` or `<lane>.<its finding>`, or `primary`. */
  readonly lanes: readonly string[];
  readonly standing: string;
  readonly owner: string;
  readonly importance: string;
  /** The first word of its `fate` cell. */
  readonly fate: string;
}

/** One investigation's findings, with the date its folder is named by. */
interface Vetted {
  readonly day: number;
  readonly keyed: boolean;
  readonly findings: readonly Finding[];
}

/** The lane of a reference to it or to one of its findings: `12` of `12.3`. */
const laneOf = (reference: string) => reference.split(".")[0] ?? reference;
const plain = (cell = "") => cell.replaceAll(/[*`]/gu, "").trim();
const firstWord = (cell: string) => /^[a-z]+/u.exec(cell.toLowerCase())?.[0] ?? "";

/** The findings of `vetting`: each row of each table with a `verdict` column whose verdict begins
 *  with one of `VERDICTS`. A prediction's row, resolved as held or falsified, is no finding. */
export function findingsIn(vetting: string): Finding[] {
  return tablesOf(vetting).flatMap(({ header, rows }) => {
    const columns = header.map((cell) => plain(cell));
    const at = (name: string) => columns.indexOf(name);
    if (at("verdict") === -1) return [];
    const cell = (row: readonly string[], name: string) => (at(name) === -1 ? "" : plain(row[at(name)]));
    return rows.flatMap((row) => {
      const verdict = VERDICTS.find((word) => firstWord(cell(row, "verdict")) === word);
      const id = plain(row[0]).replace(/^vet-/iu, "");
      if (verdict === undefined || id === "") return [];
      return [
        {
          id: `vet-${id}`,
          verdict,
          lanes:
            cell(row, "lanes")
              .toLowerCase()
              .match(/\d+(?:\.\d+)?|primary/gu) ?? [],
          standing: cell(row, "standing"),
          owner: cell(row, "owner"),
          importance: cell(row, "importance"),
          fate: firstWord(cell(row, "fate")),
        },
      ];
    });
  });
}

/** The keys of the register of standing findings, the first cell of each row of its `key` table. */
export const standingKeys = (register = readFileSync(REGISTER, "utf8")): string[] =>
  rowsOf(register, "key").map(([key = ""]) => key);

/**
 * What the fixed columns of `vetting` still owe, as one line a fault: a findings table with every
 * column of `COLUMNS`; a verdict in every row; a key of the register or `new` in `standing`; an
 * importance and a fate in every confirmed row; and a row for every lane that wrote a finding in
 * `reports` (`collect`'s list), by the lane's number or by each of its findings as `<lane>.<n>`.
 */
export function vettingFaults(vetting: string, reports: string, keys = standingKeys()): string[] {
  const tables = tablesOf(vetting)
    .map(({ header, rows }) => ({ columns: header.map((cell) => plain(cell)), rows }))
    .filter(({ columns }) => columns.includes("verdict"));
  const missing = COLUMNS.filter((name) => !tables.some(({ columns }) => columns.includes(name)));
  if (tables.length === 0 || missing.length > 0) {
    return [`no findings table with the columns ${COLUMNS.join(", ")} (missing: ${missing.join(", ")})`];
  }
  const found = findingsIn(vetting);
  const rows = tables.reduce((sum, table) => sum + table.rows.length, 0);
  const named = new Set(found.flatMap(({ lanes }) => lanes));
  // The findings each lane wrote, from the list `collect` writes (`reportIndex`).
  const written = reports.matchAll(/^- lane (\d+): ok, [a-z ]+, (\d+) findings?,/gmu);
  const unnamed = [...written].flatMap(([, lane = "", count]) => {
    if (named.has(lane)) return [];
    const each = Array.from({ length: Number(count) }, (_, index) => `${lane}.${String(index + 1)}`);
    return each.filter((one) => !named.has(one));
  });
  const ids = found.map(({ id }) => id);
  const owes = (finding: Finding) => [
    ...(finding.standing === NEW || keys.includes(finding.standing)
      ? []
      : [`standing "${finding.standing}" is neither a key of the register nor "${NEW}"`]),
    ...(finding.lanes.length === 0 ? [`no lane, nor "${PRIMARY}"`] : []),
    ...(finding.verdict !== "confirmed" || IMPORTANCE.test(finding.importance)
      ? []
      : ["no importance (I0 to I3)"]),
    ...(finding.verdict !== "confirmed" || FATES.some((fate) => fate === finding.fate)
      ? []
      : [`no fate (${FATES.join(", ")})`]),
  ];
  return [
    ...(rows === found.length
      ? []
      : [`${String(rows - found.length)} row(s) with no id or no verdict of ${VERDICTS.join(", ")}`]),
    ...ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `${id} is written twice`),
    ...found.flatMap((finding) => owes(finding).map((fault) => `${finding.id}: ${fault}`)),
    ...(unnamed.length === 0 ? [] : [`no row names the lane findings ${unnamed.join(", ")}`]),
  ];
}

/** The window's count beside the one before it, each over its own denominator. */
const beside = (counts: readonly (readonly [number, number])[]) =>
  counts.map(([count, of]) => `${String(count)} of ${String(of)}`).join(" | ");

function vettedUnder(root: string): Vetted[] {
  return readdirSync(root).flatMap((folder) => {
    const day = DATED.exec(folder)?.[1];
    const path = join(root, folder, VETTING);
    if (day === undefined || !existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
    const keyed = tablesOf(text).some(({ header }) => header.map((cell) => plain(cell)).includes("standing"));
    return [{ day: Date.parse(`${day}T00:00:00Z`), keyed, findings: findingsIn(text) }];
  });
}

/**
 * The ledger of the vetted findings under `root`, as lines: the investigations dated in the `days`
 * up to `until` beside those of the `days` before, every count over its own denominator. A standing
 * finding, an importance, a fate and a lane are counted only over the investigations whose table has
 * the fixed columns, and the first line of each block says how many those are. A difference between
 * the two windows is a count beside a count: it says where to look, never that the system improved.
 */
export function findingsLedger(root: string, until: number, days: number): string[] {
  const all = vettedUnder(root);
  const windows = [0, 1].map((back) =>
    all.filter(({ day }) => day <= until - back * days * DAY_MS && day > until - (back + 1) * days * DAY_MS),
  );
  const span = (back: number) =>
    [back + 1, back].map((edge, at) =>
      new Date(until - edge * days * DAY_MS + (1 - at) * DAY_MS).toISOString().slice(0, 10),
    );
  const keyed = windows.map((window) => window.filter((each) => each.keyed));
  const rowsIn = (window: readonly Vetted[]) => window.flatMap(({ findings }) => findings);
  const share = (
    test: (finding: Finding) => boolean,
    among: readonly (readonly Vetted[])[],
    base = (_: Finding) => true,
  ) =>
    beside(
      among.map((window) => [
        rowsIn(window).filter((each) => base(each) && test(each)).length,
        rowsIn(window).filter(base).length,
      ]),
    );
  const holding = (test: (finding: Finding) => boolean) =>
    beside(
      keyed.map((window) => [window.filter(({ findings }) => findings.some(test)).length, window.length]),
    );
  const confirmed = (finding: Finding) => finding.verdict === "confirmed";
  const values = (pick: (finding: Finding) => readonly string[]) =>
    [...new Set(keyed.flatMap((window) => rowsIn(window).flatMap(pick)))]
      .filter((value) => value !== "")
      .toSorted();
  const keys = values(({ standing }) => [standing]).filter((key) => key !== NEW);
  const lanes = values((finding) => finding.lanes.map(laneOf));
  const unrepaired = keys.filter((key) => {
    const [newest = []] = keyed;
    const held = newest.filter(({ findings }) => findings.some(({ standing }) => standing === key));
    return (
      held.length > 1 && !rowsIn(held).some(({ standing, fate }) => standing === key && fate === "repair")
    );
  });
  return [
    `# Vetted findings: ${span(0).join(" to ")} | ${span(1).join(" to ")}`,
    "",
    `investigations with a vetting: ${windows.map((window) => String(window.length)).join(" | ")}, of which with the fixed columns ${keyed.map((window) => String(window.length)).join(" | ")}`,
    ...VERDICTS.map((verdict) => `${verdict}: ${share((finding) => finding.verdict === verdict, windows)}`),
    "",
    "## Standing findings, by the investigations with the fixed columns that hold each",
    "",
    ...keys.map((key) => `- ${key}: ${holding(({ standing }) => standing === key)}`),
    `- ${NEW}: ${share(({ standing }) => standing === NEW, keyed)} rows`,
    ...(unrepaired.length === 0
      ? []
      : [
          "",
          `held more than once in the newest window with no row that repairs it: ${unrepaired.join(", ")}`,
        ]),
    "",
    "## Confirmed rows, by importance and by fate",
    "",
    ...["I0", "I1", "I2", "I3"].map(
      (level) => `- ${level}: ${share(({ importance }) => importance === level, keyed, confirmed)}`,
    ),
    ...FATES.map((fate) => `- ${fate}: ${share((finding) => finding.fate === fate, keyed, confirmed)}`),
    "",
    "## Lanes, by the rows each fed: all | refuted | shared with another lane, newest window",
    "",
    ...lanes.map((lane) => {
      const fed = rowsIn(keyed[0] ?? []).filter((finding) => finding.lanes.map(laneOf).includes(lane));
      const refuted = fed.filter(({ verdict }) => verdict === "refuted").length;
      const shared = fed.filter((finding) => new Set(finding.lanes.map(laneOf)).size > 1).length;
      return `- ${lane}: ${String(fed.length)} | ${String(refuted)} | ${String(shared)}`;
    }),
  ];
}

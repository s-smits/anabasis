/**
 * The vetted findings of the investigations: each `vetting.md` findings table (one with a `verdict`
 * column, whatever its other headers), a row a finding. `wri2p2.ts` reads which rows are confirmed
 * and what the fixed columns still owe; `wri.ts findings` folds every investigation under one root
 * into one ledger.
 */
import { DAY_MS } from "#src/meta/clock.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { REFERENCES } from "./catalogue.ts";
import { rowsOf, tablesOf } from "./ledger.ts";

export const VERDICTS = ["confirmed", "plausible", "refuted"] as const;
type Verdict = (typeof VERDICTS)[number];

/** What becomes of a confirmed finding: a row of this plan, a row owed to a later plan, an operator
 *  decision, or nothing. */
const FATES = ["repair", "carry", "operator", "none"] as const;
/** The columns a vetting's findings table has, in any order, beside any other. */
const COLUMNS = ["id", "finding", "lanes", "standing", "owner", "importance", "verdict", "fate"] as const;
const IMPORTANCE = /^I[0-3]$/u;
const NEW = "new";
const PRIMARY = "primary";
const VETTING = "vetting.md";
const REGISTER = join(REFERENCES, "standing-findings.md");
const DATED = /^(\d{4}-\d{2}-\d{2})-/u;

interface Finding {
  /** `vet-<n>`, however the row wrote it (`3`, `vet-3`, in bold or in backticks). */
  readonly id: string;
  readonly verdict: Verdict;
  readonly lanes: readonly string[];
  readonly standing: string;
  readonly owner: string;
  readonly importance: string;
  readonly fate: string;
}

interface Vetted {
  readonly day: number;
  readonly keyed: boolean;
  readonly findings: readonly Finding[];
}

const laneOf = (reference: string) => reference.split(".")[0] ?? reference;
export const plain = (cell = "") => cell.replaceAll(/[*`]/gu, "").trim();
export const firstWord = (cell: string) => /^[a-z]+/u.exec(cell.toLowerCase())?.[0] ?? "";

export const confirmedIn = (vetting: string): string[] =>
  findingsIn(vetting)
    .filter(({ verdict }) => verdict === "confirmed")
    .map(({ id }) => id);

/** The findings of `vetting`: each row of each table with a `verdict` column whose verdict begins
 *  with one of `VERDICTS`. A prediction's row, resolved as confirmed, refuted, or not-observed, is not a finding. */
function findingsIn(vetting: string): Finding[] {
  return tablesOf(vetting).flatMap(({ header, rows }) => {
    const columns = header.map((cell) => plain(cell));
    const at = (name: string) => columns.indexOf(name);
    if (at("verdict") === -1) return [];
    const cell = (row: readonly string[], name: string) => (at(name) === -1 ? "" : plain(row[at(name)]));
    return rows.flatMap((row) => {
      const verdict = VERDICTS.find((word) => firstWord(cell(row, "verdict")) === word);
      const id = plain(row[Math.max(at("id"), 0)]).replace(/^vet-/iu, "");
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

/** A lane is given none of the register, since a lane told what to find finds it. */
export const standingLines = (register = readFileSync(REGISTER, "utf8")): string =>
  rowsOf(register, "key")
    .map(([key = "", finding = ""]) => `- \`${key}\`: ${finding}`)
    .join("\n");

export function vettingFaults(
  vetting: string,
  reports: string,
  keys = rowsOf(readFileSync(REGISTER, "utf8"), "key").map(([key = ""]) => key),
): string[] {
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
 * The ledger of the vetted findings under `root`: the `days` up to `until` beside the `days`
 * before, every count over its own denominator. A difference between the windows says where to look,
 * never that the system improved.
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

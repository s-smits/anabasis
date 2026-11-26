/**
 * The not-slop ledger: every slop finding a reader looked at and answered no, with the reason. The
 * slop cleaner is heuristic, so a site is answered once and every reader of the findings (`bun run
 * lint`, `bun run simplify`, the pre-commit slop report) drops what the ledger lists. One ledger
 * answers both the per-file rules and the whole-tree scans, whose copied blocks span two files; an
 * inline `oxlint-disable` would survive an edit to the line it excuses. Tab-separated with one
 * sorted row per answer, so `.gitattributes` merges it by union; `bun run not-slop` writes and
 * prunes it.
 */
import { boundText } from "../../src/meta/bounded-text.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { compareCodeUnits } from "../../src/meta/stable-json.ts";
import { PLUGINS } from "./plugins.ts";

export const NOT_SLOP_LEDGER = "tools/oxlint/not-slop.tsv";

const COLUMNS = ["id", "rule", "path", "answered", "reason", "excerpt"] as const;

export const TREE_RULE_PREFIX = "tree/";

/** Words a reason needs before it is one: "fine" and "not slop" say nothing a reviewer can check. */
const REASON_WORDS = 3;

const EXCERPT_BYTES = 100;

const ID = /^[0-9a-f]{12}$/u;

/** The rule that keeps this ledger the only store for a slop answer: answering it here would
 *  reopen the other store. */
const INLINE_ANSWER_RULE = "ana/no-inline-slop-answer";
const NO_COMMENTS_RULE = "ana/no-comments";

export interface Answer {
  id: string;
  rule: string;
  path: string;
  answered: string;
  reason: string;
  excerpt: string;
}

export interface Place {
  path: string;
  text: string;
}

export interface Ledger {
  answers: Answer[];
  unread: string[];
}

const collapsed = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

/** One order whatever order a scan found the places in and whatever the host's locale, so an id is
 *  the same on every host. */
const ordered = (places: readonly Place[]): Place[] =>
  places.toSorted(
    (left, right) => compareCodeUnits(left.path, right.path) || compareCodeUnits(left.text, right.text),
  );

export function siteId(rule: string, places: readonly Place[]): string {
  const parts = ordered(places).flatMap((place) => [place.path, collapsed(place.text)]);
  return sha256([rule, ...parts].join("\0")).slice(0, 12);
}

export function siteExcerpt(places: readonly Place[]): string {
  const text = collapsed(
    ordered(places)
      .map((place) => place.text)
      .join(" "),
  );
  return boundText(text, EXCERPT_BYTES).shown;
}

export function unanswerable(rule: string): string | null {
  if (rule.startsWith(TREE_RULE_PREFIX)) return null;
  if (rule === INLINE_ANSWER_RULE) {
    return `${rule} keeps the ledger the only store for an answer; move the comment's answer into a row instead`;
  }
  if (rule === NO_COMMENTS_RULE) {
    return `${rule} is governed by tools/oxlint/comment-ratchet.tsv instead of not-slop.tsv; delete the comment, file an excuse, or move the decision to docs/adr/`;
  }
  const [plugin = "", name = ""] = rule.split("/");
  const rules = PLUGINS.get(plugin)?.rules;
  if (rules === undefined) {
    return `${rule} is a core rule, not a heuristic: its exception is a fact about the code, written beside it as an oxlint-disable comment with the reason`;
  }
  const found = rules[name];
  if (found === undefined) return `${rule} is not a rule either plugin registers`;
  if (found.meta?.fixable !== undefined) {
    return `${rule} carries a fixer, and \`--fix\` rewrites the site whatever the ledger says: a wrong report from it is a defect in the rule (tools/oxlint/FIXER-DECISIONS.md)`;
  }
  return null;
}

function rowProblem(cells: readonly string[]): string | null {
  const [id = "", rule = "", path = "", answered = "", reason = ""] = cells;
  if (cells.length !== COLUMNS.length) return `${cells.length} columns, not ${COLUMNS.length}`;
  if (!ID.test(id)) return `"${id}" is not a twelve-character id`;
  if (path === "") return "no path";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(answered)) return `"${answered}" is not a date`;
  if (reason.split(" ").filter(Boolean).length < REASON_WORDS) {
    return `the reason "${reason}" is under ${REASON_WORDS} words, which says nothing a reviewer can check`;
  }
  return unanswerable(rule);
}

export function readLedger(text: string): Ledger {
  const [header, ...rows] = text.split("\n");
  const ledger: Ledger = { answers: [], unread: [] };
  if (header !== undefined && header !== "" && header !== COLUMNS.join("\t")) {
    ledger.unread.push(`line 1: the header is not "${COLUMNS.join(" ")}"`);
  }
  for (const [index, row] of rows.entries()) {
    if (row.trim() === "") continue;
    const cells = row.split("\t");
    const problem = rowProblem(cells);
    if (problem !== null) {
      ledger.unread.push(`line ${index + 2}: ${problem}`);
      continue;
    }
    const [id = "", rule = "", path = "", answered = "", reason = "", excerpt = ""] = cells;
    ledger.answers.push({ id, rule, path, answered, reason, excerpt });
  }
  return ledger;
}

export function formatLedger(answers: readonly Answer[]): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const rows = [...byId.values()]
    .toSorted(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.rule.localeCompare(right.rule) ||
        left.id.localeCompare(right.id),
    )
    .map((answer) => COLUMNS.map((column) => collapsed(answer[column])).join("\t"));
  return `${[COLUMNS.join("\t"), ...rows].join("\n")}\n`;
}

export async function ledgerOnDisk(root = "."): Promise<Ledger> {
  const file = Bun.file(`${root}/${NOT_SLOP_LEDGER}`);
  return readLedger((await file.exists()) ? await file.text() : "");
}

export function staleLedgerProblems(
  ledger: Ledger,
  seen: ReadonlySet<string>,
  include: (answer: Answer) => boolean,
): string[] {
  return [
    ...ledger.unread.map((problem) => `${NOT_SLOP_LEDGER}: ${problem}`),
    ...ledger.answers.flatMap((answer) =>
      include(answer) && !seen.has(answer.id)
        ? [
            `${NOT_SLOP_LEDGER}: ${answer.id} ${answer.rule} ${answer.path}: no finding has this id any more; bun run not-slop -- prune`,
          ]
        : [],
    ),
  ];
}

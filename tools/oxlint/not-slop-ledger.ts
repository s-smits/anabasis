/**
 * The not-slop ledger: every slop finding a reader looked at and answered no, with the reason.
 *
 * The slop cleaner is heuristic. Its best measured scan was right at 51 of 71 sites; a report that
 * reprints the other twenty at every commit teaches its reader to stop reading it. So a site can be
 * answered once, and every reader of the findings — `bun run lint`, `bun run simplify` and the
 * pre-commit slop report — drops what the ledger lists.
 *
 * One ledger holds the answers to both halves of the cleaner. The whole-tree scans have no other
 * place for one: a copied block spans two files, and a comment in either would answer only half
 * of it. The per-file rules had inline `oxlint-disable` comments, and those were the weaker store:
 * a comment survives an edit to the line it excuses, so an answer about one expression kept
 * excusing whatever was later written there, and a comment without a reason — thirty-one of
 * the forty in the tree on 2026-09-21 had none — records that someone was silenced, not why.
 *
 * A row is keyed by what the site is rather than where it sits. The id hashes the rule, the paths
 * and the text of every place the site spans, whitespace collapsed: lines moving above it keep the
 * id, and an edit to any place gives a new one and brings the site back for a fresh answer. The
 * vocabulary is SARIF's external suppression — a fingerprint, the rule, the location and a
 * justification — with the date it was given and an excerpt of the hashed text, so a reviewer can
 * read a row without opening the file and see what it answers.
 *
 * Only a finding with no repair can be answered. A rule with a fixer states a fact — `--fix`
 * rewrites the site, and the ledger does not stop it — so a wrong report from one is a defect in
 * the rule (`FIXER-DECISIONS.md`). A core oxlint rule is a correctness rule, not a heuristic, and
 * its exception is a fact about the code that belongs beside it: an inline comment with a reason.
 *
 * The file is tab-separated, one sorted row per line under a header, so it renders as a table,
 * diffs one row per answer, and `.gitattributes` merges it by union: two branches answering two
 * sites never conflict. `bun run not-slop` writes and prunes it; nothing reads it but the code here.
 */
import { sha256 } from "../../src/meta/digest.ts";
import anaPlugin from "./ana/index.ts";
import antiSlopPlugin from "./anti-slop/index.ts";

/** The ledger, relative to the repository root every reader runs from. */
export const NOT_SLOP_LEDGER = "tools/oxlint/not-slop.tsv";

/** The columns, in order; the first line of the file spells them. */
const COLUMNS = ["id", "rule", "path", "answered", "reason", "excerpt"] as const;

/** The whole-tree scans answer under this prefix, as `bun run simplify` already spells them. */
export const TREE_RULE_PREFIX = "tree/";

/** Words a reason needs before it is one: "fine" and "not slop" say nothing a reviewer can check. */
const REASON_WORDS = 3;

/** Characters of the hashed text a row carries, which is enough to recognise the site. */
const EXCERPT_LENGTH = 100;

const ID = /^[0-9a-f]{12}$/u;

const RULE_PLUGINS = new Map([
  ["ana", anaPlugin.rules],
  ["anti-slop", antiSlopPlugin.rules],
]);

/** The rule that keeps this ledger the only store for a slop answer: answering it here would
 *  reopen the other store. */
const INLINE_ANSWER_RULE = "ana/no-inline-slop-answer";

/** One answered site. */
export interface Answer {
  id: string;
  /** `ana/no-deep-nesting`, `anti-slop/no-runtime-typeof` or `tree/copied-block`. */
  rule: string;
  /** Every file the site spans, comma-separated, in the order the fingerprint read them. */
  path: string;
  /** The day the answer was given, `YYYY-MM-DD`. */
  answered: string;
  reason: string;
  excerpt: string;
}

/** The text of one place a site spans. */
export interface Place {
  path: string;
  text: string;
}

/** What the ledger holds, and each row it could not read with why. */
export interface Ledger {
  answers: Answer[];
  unread: string[];
}

const collapsed = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** The places in one order whatever order a scan found them in. */
const ordered = (places: readonly Place[]): Place[] =>
  places.toSorted(
    (left, right) => left.path.localeCompare(right.path) || left.text.localeCompare(right.text),
  );

/**
 * The id of a site: its rule, and the path and collapsed text of every place it spans.
 *
 * Every place, not the first: a copied block answered as two copies kept apart on purpose is a
 * different site once its second copy changes, and hashing only the first let the edited copy
 * keep the old answer.
 */
export function siteId(rule: string, places: readonly Place[]): string {
  const parts = ordered(places).flatMap((place) => [place.path, collapsed(place.text)]);
  return sha256([rule, ...parts].join("\0")).slice(0, 12);
}

/** The start of the hashed text, which a row carries so a reviewer can see what it answers. */
export function siteExcerpt(places: readonly Place[]): string {
  const text = collapsed(
    ordered(places)
      .map((place) => place.text)
      .join(" "),
  );
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

/**
 * Why a lint rule's findings cannot be answered in the ledger, or null when they can.
 *
 * The whole-tree scans are the census's to judge, so this reads only plugin rules; a `tree/` rule
 * is answerable here and its register kinds are refused where the scans are known.
 */
export function unanswerable(rule: string): string | null {
  if (rule.startsWith(TREE_RULE_PREFIX)) return null;
  if (rule === INLINE_ANSWER_RULE) {
    return `${rule} keeps the ledger the only store for an answer; move the comment's answer into a row instead`;
  }
  const [plugin = "", name = ""] = rule.split("/");
  const rules = RULE_PLUGINS.get(plugin);
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

/** Why a row cannot be read, or null when it can. */
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

/** The ledger's rows, and every line it refused with the reason: a refused row answers nothing. */
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

/**
 * The ledger's text: one row per id, sorted by path, rule and id, under the header.
 *
 * The same id twice is two branches answering one site, which a union merge keeps both of; the
 * later row stands.
 */
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

/** The ledger on disk, or an empty one where the file is absent. */
export async function ledgerOnDisk(root = "."): Promise<Ledger> {
  const file = Bun.file(`${root}/${NOT_SLOP_LEDGER}`);
  return readLedger((await file.exists()) ? await file.text() : "");
}

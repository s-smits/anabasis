/**
 * The whole-run investigation's catalogue, read from the one file that holds it:
 * `.claude/skills/whole-run-investigation/references/lanes.md`. A lane is its number, its title, the
 * triggers that start it, its label, its importance and its body. Whether it is standing or runs alone is read from its own
 * `Starts from` paragraph, and the owners a finding may name from the catalogue's owner table, so
 * nothing here repeats what the catalogue says. `test/wri-catalogue.test.ts` holds this file's
 * reading to `TRIGGERS` (`tools/wri/folds.ts`): every trigger the reader can print starts the lane
 * it names.
 *
 * The catalogue has been renumbered twice. A report, a ledger or a comment cites the numbers of its
 * day; read an old number through these maps, old number first.
 *
 * On 7 November 2026 seven lanes were removed on the operator's word, from 34 to 27, after twenty
 * investigations of the week before: lane 3 (its triggers fired in none; now lane 1's), 6 (fired in
 * none; lane 3's), 10 (built twice; lane 9's), 18 (standing, 17 of 19 reports found nothing; row D
 * and lane 12 hold its question, and `SHELL COMMANDS`, which only opened it, went), 22 (built six
 * times, no finding confirmed; lane 5's), 30 (10 of 17 reports found nothing, none confirmed; lane
 * 24's) and 33 (fired in none; lane 26's). Old to new: 1–2 to 1–2, 4–5 to 3–4, 7–9 to 5–7, 11–17 to 8–14, 19–21 to 15–17,
 * 23–29 to 18–24, 31–32 to 25–26, 34 to 27.
 *
 * Before then, when lanes 6, 15 and 17 were folded into lanes 3, 13 and 16 and the rest put in
 * label order: 1–5 to 1–5, 6 to 3, 7 to 9, 8 to 10, 9 to 11, 10 to 12, 11 to 13, 12 to 14, 13 to 15,
 * 14 to 16, 15 to 15, 16 and 17 to 17, 18 and 19 to 18 and 19, 20–24 to 21–25, 25 to 26, 26 to 29,
 * 27 to 30, 28 to 31, 29 to 6, 30 to 7, 31 to 27, 32 to 28, 33 to 20, 34 to 8, 35 to 32, 36 to 33.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";

export interface Lane {
  readonly number: number;
  readonly title: string;
  /** The paragraph that names the reader's triggers. */
  readonly startsFrom: string;
  /** The triggers that paragraph names for this lane. */
  readonly triggers: readonly string[];
  /** Opens on every campaign that holds a report, triggered or not. */
  readonly standing: boolean;
  /** Runs alone, on its trigger, and reads no other report. */
  readonly isolated: boolean;
  /** Grades blind to outcomes, so a session that holds it reads it before any other lane. */
  readonly blind: boolean;
  /** Is given every campaign under review side by side, in lane 22's columns. */
  readonly sideBySide: boolean;
  /** The area label of the pull requests that change what the lane reads. */
  readonly label: string;
  /** How much the lane weighs when lanes are packed into sessions, from 0 to 1. */
  readonly importance: number;
  /** The lane whole, as a session is given it. */
  readonly body: string;
}

const SKILL = resolve(import.meta.dir, "..", "..", ".claude", "skills", "whole-run-investigation");
export const REFERENCES = join(SKILL, "references");

const HEADING = /^\*\*(\d+)\. (.+)\.\*\*$/;
const TRIGGER = /`([A-Z][A-Z0-9 ,'-]+) \(lane (\d+)\)`/g;
const OWNER_ROW = /^\| (`[^|]+) \|/;
const LABEL = /^Label: `([a-z]+)`\.$/;
const IMPORTANCE = /^Importance: (0(?:\.\d+)?|1)\.$/;

export function catalogueText(): string {
  return readFileSync(join(REFERENCES, "lanes.md"), "utf8");
}

/** The text under one `## ` heading, up to the next. */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const from = lines.indexOf(`## ${heading}`);
  if (from === -1) return "";
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** The lanes, in the catalogue's order, each with its own label and importance. A lane with no
 *  `Starts from` paragraph, no label or no importance is a fault of the catalogue and is named. The
 *  label and importance lines are left out of the body a session is given. */
export function lanesOf(markdown: string): Lane[] {
  const blocks: string[][] = [];
  for (const line of markdown.split("\n")) {
    if (HEADING.test(line)) blocks.push([line]);
    else if (line.startsWith("#")) blocks.push([]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.flatMap(([heading = "", ...rest]) => {
    if (!HEADING.test(heading)) return [];
    const [, number = "", title = ""] = HEADING.exec(heading) ?? [];
    const [, label] = rest.map((line) => LABEL.exec(line)).find((match) => match !== null) ?? [];
    const [, weight] = rest.map((line) => IMPORTANCE.exec(line)).find((match) => match !== null) ?? [];
    if (label === undefined || weight === undefined) {
      throw new Error(`lane ${number} has no label or no importance line`);
    }
    const body = rest
      .filter((line) => !IMPORTANCE.test(line) && !LABEL.test(line))
      .join("\n")
      .trim();
    const paragraph = body.split("\n\n").find((each) => each.startsWith("Starts from"));
    if (paragraph === undefined) throw new Error(`lane ${number} has no paragraph beginning "Starts from"`);
    // Read as one line, so a reflow cannot move a lane's standing: one split "It runs alone" over
    // two lines and lane 19 read as not isolated (2026-10-10).
    const startsFrom = paragraph.replaceAll("\n", " ");
    const named = [...startsFrom.matchAll(TRIGGER)];
    return {
      number: Number(number),
      title,
      startsFrom,
      triggers: named.flatMap(([, name = "", lane]) => (lane === number ? [name] : [])),
      standing: startsFrom.includes("standing"),
      isolated: startsFrom.includes("It runs alone"),
      blind: startsFrom.includes("It grades blind"),
      sideBySide: startsFrom.includes("side by side"),
      label,
      importance: Number(weight),
      body,
    };
  });
}

/** The owners a finding may name: the first column of the catalogue's owner table. */
export function ownersOf(markdown: string): string[] {
  return markdown.split("\n").flatMap((line) => {
    const [, cell] = OWNER_ROW.exec(line) ?? [];
    return cell === undefined ? [] : [...cell.matchAll(/`([^`]+)`/g)].flatMap(([, owner]) => owner ?? []);
  });
}

/**
 * The whole-run investigation's catalogue, read from the one file that holds it:
 * `.claude/skills/whole-run-investigation/references/lanes.md`. A lane is its number, its title, the
 * triggers that start it, its label, its importance, its marks and its body. Whether it is
 * standing, runs alone, grades blind or reads the campaigns side by side is read from its `Marks:`
 * line, never from its prose, and the owners a finding may name from the catalogue's owner table,
 * so nothing here repeats what the catalogue says. `test/wri-readers.test.ts` holds this file's
 * reading to `TRIGGERS` (`tools/wri/folds.ts`): every trigger the reader can print starts the lane
 * it names.
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
  /** Is given every campaign under review side by side, in lane 18's columns. */
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
const MARKS = /^Marks: (none|`[a-z-]+`(?:, `[a-z-]+`)*)\.$/;
/** The marks a `Marks:` line may carry, each setting one of `Lane`'s booleans. */
const MARK_NAMES = new Set(["standing", "alone", "blind", "side-by-side"]);

/** The marks of one `Marks:` line; a name outside `MARK_NAMES` is a fault of the catalogue. */
function marksOf(number: string, line: string): Set<string> {
  const marks = new Set([...line.matchAll(/`([a-z-]+)`/g)].map(([, mark = ""]) => mark));
  const unknown = [...marks].filter((mark) => !MARK_NAMES.has(mark));
  if (unknown.length > 0) throw new Error(`lane ${number} carries unknown marks: ${unknown.join(", ")}`);
  return marks;
}

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

/** The lanes, in the catalogue's order, each with its own label, importance and marks. A lane with
 *  no `Starts from` paragraph, no label, no importance or no marks line is a fault of the catalogue
 *  and is named. The label, importance and marks lines are left out of the body a session is given. */
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
    const [, marked] = rest.map((line) => MARKS.exec(line)).find((match) => match !== null) ?? [];
    if (marked === undefined) throw new Error(`lane ${number} has no marks line`);
    const marks = marksOf(number, marked);
    const body = rest
      .filter((line) => !IMPORTANCE.test(line) && !LABEL.test(line) && !MARKS.test(line))
      .join("\n")
      .trim();
    const paragraph = body.split("\n\n").find((each) => each.startsWith("Starts from"));
    if (paragraph === undefined) throw new Error(`lane ${number} has no paragraph beginning "Starts from"`);
    const startsFrom = paragraph.replaceAll("\n", " ");
    const named = [...startsFrom.matchAll(TRIGGER)];
    return {
      number: Number(number),
      title,
      startsFrom,
      triggers: named.flatMap(([, name = "", lane]) => (lane === number ? [name] : [])),
      standing: marks.has("standing"),
      isolated: marks.has("alone"),
      blind: marks.has("blind"),
      sideBySide: marks.has("side-by-side"),
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

/**
 * The whole-run investigation's catalogue, read from the one file that holds it:
 * `.claude/skills/whole-run-investigation/references/lanes.md`. A lane is its number, its title, the
 * triggers that start it and its body. Whether it is standing or runs alone is read from its own
 * `Starts from` paragraph, and the owners a finding may name from the catalogue's owner table, so
 * nothing here repeats what the catalogue says. `test/wri-catalogue.test.ts` holds this file's
 * reading to `tools/wri/read.ts`: every trigger the reader can print starts the lane it names.
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
  /** The lane whole, as a session is given it. */
  readonly body: string;
}

const SKILL = resolve(import.meta.dir, "..", "..", ".claude", "skills", "whole-run-investigation");
export const REFERENCES = join(SKILL, "references");

const HEADING = /^\*\*(\d+)\. (.+)\.\*\*$/;
const TRIGGER = /`([A-Z][A-Z ,'-]+) \(lane (\d+)\)`/g;
const OWNER_ROW = /^\| (`[^|]+) \|/;

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

/** The lanes, in the catalogue's order. A lane with no `Starts from` paragraph is a fault of the
 *  catalogue and is named. */
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
    const body = rest.join("\n").trim();
    const startsFrom = body.split("\n\n").find((paragraph) => paragraph.startsWith("Starts from"));
    if (startsFrom === undefined) throw new Error(`lane ${number} has no paragraph beginning "Starts from"`);
    const named = [...startsFrom.replaceAll("\n", " ").matchAll(TRIGGER)];
    return {
      number: Number(number),
      title,
      startsFrom,
      triggers: named.flatMap(([, name = "", lane]) => (lane === number ? [name] : [])),
      standing: startsFrom.includes("standing"),
      isolated: startsFrom.includes("It runs alone"),
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

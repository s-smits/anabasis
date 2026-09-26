/**
 * One reader for the fenced contracts inside the text the Builder reads. They are the shapes the
 * Builder authors against and the fixtures the validators are proven against, so one reader keeps
 * both sides on the same bytes.
 */
import { readFileSync } from "../../src/meta/filesystem.ts";
import type { Brief } from "../../src/correctness-bundle/brief.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";

export const STARTER_ENTRY = readFileSync(
  new URL("../../starters/pi-built-harness/STARTER.md", import.meta.url),
  "utf8",
);

/** The graded corpus the entry links to. Its four tiers are the scale
 *  `.claude/skills/whole-run-investigation/classifier/query-complexity.mjs` later classifies a
 *  measured battery against, so the Builder authors against the scale its own tasks are read on. */
export const STARTER_LADDER = readFileSync(
  new URL("../../starters/pi-built-harness/starter-pack/difficulty-ladder.md", import.meta.url),
  "utf8",
);

export const STARTER_DOC = ["contract.md", "examples.md"]
  .map((name) =>
    readFileSync(new URL(`../../starters/pi-built-harness/starter-pack/${name}`, import.meta.url), "utf8"),
  )
  .join("\n");

/** The fence of that language under `heading`, bounded by the next heading. */
export function fence(heading: string, language: "json" | "ts"): string {
  const section = STARTER_DOC.split(`\n${heading}\n`)[1]?.split(/\n#{2,3} /)[0];
  const block =
    section === undefined ? null : new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``).exec(section);
  if (block === null) throw new Error(`STARTER.md lost the "${heading}" ${language} contract`);
  return block[1] ?? "";
}

export const brief = (heading: string): Brief => parseJsonAs<Brief>(fence(heading, "json"));

/** How a file-map domain is verified at all: the submitted files are run, never compared. Two
 * suites read it, so the heading is written once. */
export const fileMapBrief = (): Brief => brief("### The file-map brief contract");

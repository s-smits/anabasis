/**
 * The four improver prompts Harness² writes for JobBench on Claude Code at k=1: the INVARIANT and
 * DOMAIN proposers, the aggregator and the experience writer. `prompts.txt` holds them as Harness²'s
 * own Python rendered them with each benchmark text field left as a `{{slot}}` (its header names
 * the source, commits and licence), so the prose here is never retyped. The fields come from one
 * sections file, the shared-prompt `sections.json` the pilot read through `HARNESS2_JB_SHARED`.
 *
 * Python leaves out the lens and yardstick blocks when their field is blank; every field is
 * required here instead, since the pilot's sections file fills all five.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { pyStrip } from "./py.ts";

/** The benchmark text fields a sections file supplies. */
type Field = "work" | "inv_levers" | "dom_levers" | "yardstick" | "domain_guidance";
export type Sections = Readonly<Record<Field, string>>;
export type Job = "propose INV" | "propose DOM" | "aggregate" | "experience";

const TEMPLATES = new Map(
  readFileSync(new URL("prompts.txt", import.meta.url), "utf8")
    .split(/^=== (.+)\n/mu)
    .slice(1)
    .flatMap((part, index, parts) => (index % 2 === 0 ? [[part, parts[index + 1] ?? ""] as const] : [])),
);

/** The five fields of a sections file, each stripped as Python strips it, or a thrown reason. */
export function readSections(path: string): Sections {
  const doc = capturedJsonParse(readFileSync(path, "utf8"));
  const field = (name: Field): string => {
    const value = isRecord(doc) ? doc[name] : undefined;
    if (!isString(value) || pyStrip(value) === "") throw new Error(`${path} needs a non-empty "${name}"`);
    return pyStrip(value);
  };
  return {
    work: field("work"),
    inv_levers: field("inv_levers"),
    dom_levers: field("dom_levers"),
    yardstick: field("yardstick"),
    domain_guidance: field("domain_guidance"),
  };
}

/** One prompt, filled from the sections and tidied as `_tidy` tidies it. */
export function prompt(job: Job, sections: Sections): string {
  const fills = new Map([
    ...Object.entries(sections),
    ["surface", (TEMPLATES.get("surface") ?? "").slice(0, -1)],
  ]);
  const text = (TEMPLATES.get(job) ?? "").replaceAll(
    /\{\{(\w+)\}\}/gu,
    (slot, name: string) => fills.get(name) ?? slot,
  );
  return `${pyStrip(text.replaceAll(/\n{3,}/gu, "\n\n"))}\n`;
}

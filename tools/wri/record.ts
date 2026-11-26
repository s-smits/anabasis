/**
 * The record across runs that the primary reads while lane sessions work: the deterministic reads
 * no lane makes, each run as a command and written under its own heading in `<dir>/record.md`, so
 * vetting recounts against one file. `wri.ts record --out <dir>` writes it, and `wri2p2.ts`'s
 * `record` gate requires every read `missingRecordSections` names.
 */
import { domainOf, packOf } from "../runs/registry.ts";
import { WRI } from "./index.ts";

interface Ran {
  readonly exitCode: number | null;
  readonly text: string;
}

export const RECORD = "record.md";
export const RECORD_VERB = `${WRI} record`;
const TUNER = ".claude/skills/promotion-tuner/scripts";
const READING = ".claude/skills/comparison-reading/scripts";

export function checkedStepsOf(names: readonly string[]): string[][] {
  const packs = [...new Set(names.map((name) => packOf(name)))];
  const domains = [...new Set(names.map((name) => domainOf(name)))];
  return [
    ...domains.map((domain) => [WRI, "backtrack", "--domain", domain]),
    ...packs.flatMap((pack) => [
      [`${TUNER}/trend.ts`, "--pack", pack],
      [`${TUNER}/table.ts`, "--name", pack, "--rows", "promotions"],
      [`${READING}/starter-reads.ts`, "--all", "--name", pack],
    ]),
    ...names.map((name) => [`${TUNER}/replay.ts`, "--name", name, "--totals"]),
    [WRI, "findings"],
  ];
}

/** A read counts once a heading names its words and the line under it says it ended with exit 0. */
export function missingRecordSections(record: string, names: readonly string[]): string[][] {
  const sections = record.split(/^## /mu).slice(1);
  return checkedStepsOf(names).filter((words) => {
    const made = sections.filter((section) => (section.split("\n")[0] ?? "").includes(words.join(" ")));
    return !made.some((section) => /^read at .*, exit 0$/mu.test(section));
  });
}

export const recordStep = (owed: number, dir: string): string[] =>
  owed === 0
    ? []
    : [
        `${String(owed)} read(s) of the record across runs are owed, which the primary makes while the lane sessions work: bun ${RECORD_VERB} --out ${dir}`,
      ];

export function recordWith(
  record: string,
  names: readonly string[],
  stand: () => string,
  run: (words: readonly string[]) => Ran,
): { text: string; failed: string[] } {
  const sections = missingRecordSections(record, names).map((words) => {
    const { exitCode, text } = run(words);
    const head = `read at ${stand()}, exit ${exitCode === null ? "none" : String(exitCode)}`;
    const body = ["```text", text.trimEnd(), "```"].join("\n");
    return { words, failed: exitCode !== 0, text: `## \`bun ${words.join(" ")}\`\n\n${head}\n\n${body}` };
  });
  const start = record.trim() === "" ? "# The record across runs" : record.trimEnd();
  return {
    text: `${[start, ...sections.map(({ text }) => text)].join("\n\n")}\n`,
    failed: sections.filter(({ failed }) => failed).map(({ words }) => words.join(" ")),
  };
}

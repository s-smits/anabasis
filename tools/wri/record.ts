/**
 * The record across runs, which the primary reads itself while an investigation's lane sessions
 * work: the deterministic reads no lane makes and no model is needed for, each run as a command and
 * written under a heading of its own in `<dir>/record.md`, so the vetting recounts against one file
 * instead of beginning with those reads. `wri.ts record --out <dir>` writes it, and an iteration's
 * `record` gate requires every read `missingRecordSections` still names (`wri2p2.ts`).
 */
import { domainOf, packOf } from "../runs/registry.ts";
import { WRI } from "./index.ts";

/** One command's ending and what it printed. */
interface Ran {
  readonly exitCode: number | null;
  readonly text: string;
}

export const RECORD = "record.md";
/** The command that writes it, as the words after `bun` and before `--out <dir>`. */
export const RECORD_VERB = `${WRI} record`;
const TUNER = ".claude/skills/promotion-tuner/scripts";
const READING = ".claude/skills/comparison-reading/scripts";

/**
 * The reads an investigation of the campaigns `names` owes, each as the words after `bun`: a pack's
 * weeks against the weeks before, its promotions with what each cost and whether they held on the
 * tasks written since; a run's promotions under the tree's rule; and the ledger of every
 * investigation's vetted findings, where a finding this one meets again is already counted.
 */
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

/** The reads of `names` that `record` does not hold yet: one counts once a heading names its words
 *  and the line under it says it ended with exit 0. */
export function missingRecordSections(record: string, names: readonly string[]): string[][] {
  const sections = record.split(/^## /mu).slice(1);
  return checkedStepsOf(names).filter((words) => {
    const made = sections.filter((section) => (section.split("\n")[0] ?? "").includes(words.join(" ")));
    return !made.some((section) => /^read at .*, exit 0$/mu.test(section));
  });
}

/** What an iteration's step says while `owed` reads of the folder `dir` are owed: who makes them and
 *  when, and the one command; nothing once none is. */
export const recordStep = (owed: number, dir: string): string[] =>
  owed === 0
    ? []
    : [
        `${String(owed)} read(s) of the record across runs are owed, which the primary makes while the lane sessions work: bun ${RECORD_VERB} --out ${dir}`,
      ];

/**
 * `record` with each read of `names` it still owes run through `run` and written under it: the
 * command as its heading, then when it ran, how many lane reports stood written (`stand`) and its
 * exit code, then what it printed. A read already made is kept as it stands, so a second call after
 * the lanes return leaves the first call's lines and times. `failed` holds the reads that ended
 * otherwise than with exit 0, which stay owed.
 */
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

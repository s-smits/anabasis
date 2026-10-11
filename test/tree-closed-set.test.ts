/**
 * `tree/unproduced-set-member` (`tools/oxlint/tree-closed-set.ts`): a member of a literal union
 * that no production file spells outside its declaration, and the reader it was wrong about on
 * 10 October: a member a dollar sign keeps out of the word index, produced by another file on a
 * line above the declaration's own line number.
 */
import { describe, expect, it } from "bun:test";
import { unproducedSetMembers } from "../tools/oxlint/tree-closed-set.ts";

/** A union declared low in its file, so a producer in another file sits above its line number. */
const DECLARING = [
  ...Array.from({ length: 20 }, () => ""),
  "export function stage(",
  '  leader: "$$" | "$PPID",',
  '  mode: "fast" | "slow",',
  "): string {",
  "  return `${leader} ${mode}`;",
  "}",
  "",
].join("\n");

const details = (producer: string): string[] =>
  unproducedSetMembers(
    new Map([["src/declaring.ts", DECLARING]]),
    new Map([
      ["src/declaring.ts", DECLARING],
      ["src/producer.ts", producer],
    ]),
  ).map((row) => row.detail);

describe("tree/unproduced-set-member", () => {
  it("reports a member no production file spells, and says that no test spells it either", () => {
    expect(details('stage("$$", "fast");\n')).toStrictEqual([
      "`$PPID`, a member of `leader`, is produced by no production file; no test spells it either",
      "`slow`, a member of `mode`, is produced by no production file; no test spells it either",
    ]);
  });

  it("sees a producer on a line above the declaration's line number in another file", () => {
    expect(details('stage("$$", "fast");\nstage("$PPID", "slow");\n')).toStrictEqual([]);
  });
});

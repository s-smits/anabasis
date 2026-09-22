/**
 * The rule that reads a call whose arguments are the callee's own parameter names, crossed.
 *
 * The fixture holds the defect and every neighbour that is not one, because the whole value of
 * this rule is that it never guesses. A single argument carrying another parameter's name is a
 * coincidence; two crossed is the mistake stated twice. A pair whose declared types differ does
 * not compile and needs no rule. A callee this file does not declare has no parameter list in
 * view, and an argument that is not a plain identifier carries no name to compare.
 *
 * It reports zero sites on this tree, out of 530 argument pairs it examines — the callee in view,
 * both parameters declaring one type, both arguments bare identifiers. That is the same standing
 * as `ana/no-property-read-on-function`: the rule is registered for the shape it refuses to let
 * in, and this file is the only thing that proves it still reports at all.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const CALLS = `
export function writeRound(campaignId: string, runId: string): string {
  return campaignId + runId;
}
export function crossed(campaignId: string, runId: string): string {
  return writeRound(runId, campaignId); // REPORT both names are the callee's, in the other order
}
export function straight(campaignId: string, runId: string): string {
  return writeRound(campaignId, runId); // ADMITTED this is the order the callee declares
}
export function oneName(campaignId: string, runId: string): string {
  return writeRound(runId, runId); // ADMITTED one name out of place is a coincidence, not a swap
}
export function copyFile(source: string, destination: number): string {
  return source + String(destination);
}
export function differentTypes(source: string, destination: number): string {
  return copyFile(String(destination), Number(source)); // ADMITTED a swap of two types does not compile
}
const rename = (from: string, to: string): string => from + to;
export function throughArrow(from: string, to: string): string {
  return rename(to, from); // REPORT a const-arrow declares parameters too
}
export function notIdentifiers(from: string, to: string): string {
  return rename(to.trim(), from.trim()); // ADMITTED an expression carries no name to compare
}
export function spread(parts: readonly string[]): string {
  return rename(...(parts as [string, string])); // ADMITTED there are no positional names at all
}
export function fromElsewhere(campaignId: string, runId: string): string {
  return String(Number(runId)) + campaignId; // ADMITTED the callee is not declared in this file
}
export function threeAcross(first: string, second: string, third: string): string {
  return threeAcross(third, second, first); // REPORT the outer pair is crossed across a fixed middle
}
`.trimStart();

describe("ana/no-transposed-argument", () => {
  const reports = (at: string): number[] => reportedLines("ana", "no-transposed-argument", CALLS, at);

  it("reports a crossed pair and nothing that merely resembles one", () => {
    const expected = expectedLines(CALLS);
    expect(expected).toHaveLength(3);
    expect(reports("src/example.ts")).toStrictEqual(expected);
  });
});

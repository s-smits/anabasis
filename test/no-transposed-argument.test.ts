/**
 * The rule that reads a call whose arguments are the callee's own parameter names, crossed.
 *
 * The fixture holds the defect and every neighbour that is not one, because the whole value of
 * this rule is that it never guesses. A single argument carrying another parameter's name is a
 * coincidence; two crossed is the mistake stated twice. A pair whose declared types differ is
 * reported all the same, since it compiles only where they are assignable either way. A callee
 * this file does not declare has no parameter list in view, and an argument that is a call or other expression carries no name to compare.
 *
 * The wider spellings sit beside their nearest neighbour that is not a swap: a member read whose
 * property is the other parameter's name, a word-level match (`sourcePath` for `source`), a
 * method reached through `this` or an object literal, and a pair whose declared types differ but
 * compile either way. It reports zero sites on this tree and on seven trees from 12 October to 5
 * November, so the rule is registered for the shape it refuses to let in, and this file is the
 * only thing that proves it still reports at all.
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
export function throughMembers(edge: { from: string; to: string }): string {
  return rename(edge.to, edge.from); // REPORT a member read carries the property's name
}
export function membersInOrder(edge: { from: string; to: string }): string {
  return rename(edge.from, edge.to); // ADMITTED the properties are in the declared order
}
export function oneMember(edge: { from: string; to: string }, other: string): string {
  return rename(edge.to, other); // ADMITTED one name out of place is a coincidence, not a swap
}
function copyTree(source: string, destination: string): string {
  return source + destination;
}
export function byWords(sourcePath: string, destinationPath: string): string {
  return copyTree(destinationPath, sourcePath); // REPORT the words of each name are the other parameter's
}
export function wordsInOrder(sourcePath: string, destinationPath: string): string {
  return copyTree(sourcePath, destinationPath); // ADMITTED each name begins with its own parameter's words
}
function joinPath(path: string, basePath: string): string {
  return basePath + path;
}
export function nestedNames(path: string, basePath: string): string {
  return joinPath(basePath, path); // ADMITTED one parameter's name is inside the other's, so neither name decides
}
function measure(text: string, items: readonly string[] | string): number {
  return text.length + items.length;
}
export function differentButAssignable(text: string, items: string): number {
  return measure(items, text); // REPORT the declared types differ and both still take a string
}
export class Ledger {
  move(from: string, to: string): string {
    return from + to;
  }
  undo(from: string, to: string): string {
    return this.move(to, from); // REPORT a method reached through this declares parameters too
  }
  redo(from: string, to: string): string {
    return this.move(from, to); // ADMITTED this is the order the method declares
  }
}
const paths = {
  relative(base: string, target: string): string {
    return target.slice(base.length);
  },
};
export function throughObject(base: string, target: string): string {
  return paths.relative(target, base); // REPORT a method of an object literal declares parameters too
}
export function objectInOrder(base: string, target: string): string {
  return paths.relative(base, target); // ADMITTED this is the order the object's method declares
}
export function decided(check: (task: string, answer: string) => string, task: string, answer: string): string {
  return check(task, answer); // ADMITTED a parameter's function is not the function declaring the parameter
}
export function outerOrder(task: string, answer: string, check: (a: string, b: string) => string): string {
  return decided(check, answer, task); // REPORT the outer function's own parameters, crossed
}
`.trimStart();

describe("ana/no-transposed-argument", () => {
  const reports = (at: string): Promise<number[]> =>
    reportedLines("ana", "no-transposed-argument", CALLS, at);

  it("reports a crossed pair and nothing that merely resembles one", async () => {
    const expected = expectedLines(CALLS);
    expect(expected).toHaveLength(9);
    expect(await reports("src/example.ts")).toStrictEqual(expected);
  });
});

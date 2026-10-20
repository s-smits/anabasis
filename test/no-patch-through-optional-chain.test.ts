/**
 * The rule that reports a one-line guard writing through `?.` into a value built elsewhere: the
 * shape of a fold patched from the side, as the WRI's practice reading was on 20 October.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const SITES = `
declare const builds: { practice: Set<string>; calls: string[] }[];
declare const kind: string;
declare const state: string;
declare const version: string;
declare const seen: Map<string, string> | undefined;
const own = new Set<string>();
export function fold() {
  if (kind === "task.state" && state === "released") builds.at(-1)?.practice.add(version); // REPORT the shape of 20 October
  if (kind === "build.call") { builds.at(-1)?.calls.push(version); } // REPORT one literal guard, in a block
  if (kind === "solve.started") seen?.set(version, kind); // REPORT any optional receiver
  if (kind === "task.state") own.add(version); // ADMITTED a value this scope holds, without ?.
  if (state === version) builds.at(-1)?.practice.add(version); // ADMITTED no literal in the guard
  if (kind === "task.state") builds.at(-1)?.practice.has(version); // ADMITTED a read, not a write
  if (kind === "task.state") builds.at(-1)?.practice.add(version); else own.add(version); // ADMITTED an else is a choice of two
}
`.trimStart();

describe("ana/no-patch-through-optional-chain", () => {
  it("reports a guarded write through ?. and leaves reads, local writes and two-armed choices", async () => {
    const expected = expectedLines(SITES);
    expect(expected).toHaveLength(3);
    expect(await reportedLines("ana", "no-patch-through-optional-chain", SITES)).toStrictEqual(expected);
  });
});

/**
 * The fixer for an argument the callee already holds.
 *
 * The report boundary is pinned with the other simplify catchers in `simplify-catchers-shape`.
 * What is pinned here is the edit, because it is three edits that have to land together — the
 * parameter, every call, and the body's reads — and a fixer that landed two of them would leave a
 * file that does not compile.
 */
import { describe, expect, it } from "bun:test";
import { fixedSource } from "./helpers/oxlint-rule-fixture.ts";

const SWEPT = `
declare const pack: { findings: string[]; name: string };
declare const other: { findings: string[]; name: string };

function toolsView(bundle: typeof pack, findings: string[]): number {
  return findings.length + bundle.name.length;
}
export const first = toolsView(pack, pack.findings);
export const second = toolsView(other, other.findings);
`.trimStart();

describe("ana/no-argument-already-carried", () => {
  it("drops the parameter, the argument at every call and rewrites the body's reads together", async () => {
    expect(await fixedSource("ana", "no-argument-already-carried", SWEPT, "src/example.ts")).toBe(
      [
        "declare const pack: { findings: string[]; name: string };",
        "declare const other: { findings: string[]; name: string };",
        "",
        "function toolsView(bundle: typeof pack): number {",
        "  return bundle.findings.length + bundle.name.length;",
        "}",
        "export const first = toolsView(pack);",
        "export const second = toolsView(other);",
        "",
      ].join("\n"),
    );
  });
});

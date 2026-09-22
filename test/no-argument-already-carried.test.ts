/**
 * The fixer for an argument the callee already holds, and the shapes it withdraws from.
 *
 * The report boundary is pinned with the other simplify catchers in `simplify-catchers-shape`.
 * What is pinned here is the edit, because it is three edits that have to land together — the
 * parameter, every call, and the body's reads — and a fixer that landed two of them would leave a
 * file that does not compile.
 *
 * The five admitted shapes are each a decision the edit would otherwise make on its own: a callee
 * another file can call, a name handed on rather than called, a read in shorthand position that
 * cannot take a dotted path, a parameter the body writes to, and a call too short to be reported,
 * whose unset optional parameter the fix would silently read off the whole. All five still report,
 * so the swept source holds them unchanged and the finding survives the sweep.
 *
 * Two more are about when the value is read rather than about what it is. The argument is
 * evaluated at the call and the rewritten read happens inside the callee, so anything that runs
 * between those two moments — the callee's own first statements, or an argument standing to the
 * right of the dropped one — can hand the read a different value. Neither shows up at a line the
 * compiler looks at, which is why both withdraw the fix.
 */
import { describe, expect, it } from "bun:test";
import { fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const SWEPT = `
declare const pack: { findings: string[]; name: string };
declare const other: { findings: string[]; name: string };

function toolsView(bundle: typeof pack, findings: string[]): number {
  return findings.length + bundle.name.length;
}
export const first = toolsView(pack, pack.findings);
export const second = toolsView(other, other.findings);
`.trimStart();

const WITHDRAWN = `
declare const pack: { findings: string[]; name: string };

export function exportedView(bundle: typeof pack, findings: string[]): number {
  return findings.length + bundle.name.length;
}
function handedOn(bundle: typeof pack, findings: string[]): number {
  return findings.length + bundle.name.length;
}
function shorthandView(bundle: typeof pack, findings: string[]): { findings: string[]; name: string } {
  return { findings, name: bundle.name };
}
function writtenView(bundle: typeof pack, findings: string[]): number {
  findings = [...findings, bundle.name];
  return findings.length;
}
function optionalView(bundle: typeof pack, findings?: string[]): number {
  return (findings ?? []).length + bundle.name.length;
}
export const alias = handedOn;
export const unset = optionalView(pack);
export const set = optionalView(pack, pack.findings);
export const shown = exportedView(pack, pack.findings);
export const handed = handedOn(pack, pack.findings);
export const kept = shorthandView(pack, pack.findings);
export const written = writtenView(pack, pack.findings);
`.trimStart();

const COMMENTED = `
declare const pack: { findings: string[]; name: string };

function countView(bundle: typeof pack, findings: string[]): number {
  return findings.length + bundle.name.length;
}
export const counted = countView(
  pack,
  // the findings the census counted, which the bundle already carries
  pack.findings,
);
`.trimStart();

const MOVED = `
declare const pack: { findings: string[]; name: string };
declare function bump(one: typeof pack): number;

function resetView(bundle: typeof pack, findings: string[]): number {
  bundle.findings = [];
  return findings.length + bundle.name.length;
}
function orderView(bundle: typeof pack, findings: string[], extra: number): number {
  return findings.length + bundle.name.length + extra;
}
function twiceView(bundle: typeof pack, findings: string[]): number {
  return findings.length + findings.length;
}
function laterView(bundle: typeof pack, findings: string[]): number {
  return bundle.name.length + findings.length;
}
export const reset = resetView(pack, pack.findings);
export const twice = twiceView(pack, pack.findings);
export const later = laterView(pack, pack.findings);
export const ordered = orderView(pack, pack.findings, bump(pack));
`.trimStart();

describe("ana/no-argument-already-carried", () => {
  it("drops the parameter, the argument at every call and rewrites the body's reads together", () => {
    expect(fixedSource("ana", "no-argument-already-carried", SWEPT, "src/example.ts")).toBe(
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

  it("leaves a call whose comma it could not take without the sentence beside it", () => {
    expect(fixedSource("ana", "no-argument-already-carried", COMMENTED, "src/example.ts")).toBe(COMMENTED);
    expect(reportedLines("ana", "no-argument-already-carried", COMMENTED, "src/example.ts")).toHaveLength(1);
  });

  it("withdraws from a callee this file cannot close, and keeps reporting all five", () => {
    expect(fixedSource("ana", "no-argument-already-carried", WITHDRAWN, "src/example.ts")).toBe(WITHDRAWN);
    expect(reportedLines("ana", "no-argument-already-carried", WITHDRAWN, "src/example.ts")).toHaveLength(5);
  });

  /**
   * `resetView` empties `bundle.findings` and then reads the parameter, so the caller's array
   * length becomes zero the moment the read moves inside. `orderView` is passed `bump(pack)`
   * after the argument being dropped, so the read moves from before that call to after it. Both
   * compile either way and both return a different number, which is the one failure a fixer may
   * not have.
   */
  it("withdraws where the value the read sees moves, and keeps reporting each", () => {
    // `twiceView` would evaluate `pack.findings` twice where the call evaluated it once, and
    // `laterView` after a property read a getter could be ordered against.
    expect(fixedSource("ana", "no-argument-already-carried", MOVED, "src/example.ts")).toBe(MOVED);
    expect(reportedLines("ana", "no-argument-already-carried", MOVED, "src/example.ts")).toHaveLength(4);
  });
});

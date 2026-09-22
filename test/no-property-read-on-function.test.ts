/**
 * The rule that reads a property off a function the same file declares.
 *
 * The fixture is the defect as it was found on 2026-09-20 and every neighbour of it that is a
 * real read. Two of the admitted cases carry the rule's whole precision: a name shadowed inside
 * a nested scope is a different variable, which is why the rule was silent on the commit before
 * the rename that broke `archive-shape.mjs`; and a module that assigns to a property of its own
 * function is using it as a namespace, so every read of that one is deliberate.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const READS = `
const KEYS = ["t0", "t1"];
export function identity(tier: string): string {
  return tier.toUpperCase();
}
export function reconcile(): string | null {
  for (const key of KEYS) if (typeof identity[key] !== "string") return key; // REPORT the rename left this behind
  return null;
}
export function dotted(): unknown {
  return identity.tier; // REPORT a dotted read is undefined too
}
const render = (row: string): string => row.trim();
export function fromArrow(): unknown {
  return render.row; // REPORT a const-arrow is a function as well
}
export function ownProperties(): string {
  return identity.name + String(identity.length) + identity.bind(null)("x") + identity.call(null, "y"); // ADMITTED every function has these
}
export function shadowed(rows: Record<string, string>): string | null {
  const identity = rows;
  for (const key of KEYS) if (typeof identity[key] !== "string") return key; // ADMITTED the inner binding is a different variable
  return null;
}
export function passed(rows: string[]): string[] {
  return rows.map(identity); // ADMITTED a function read as a value is not a property read
}
export function handler(): void {}
handler.schema = { kind: "row" };
export function namespaced(): unknown {
  return handler.schema; // ADMITTED the module attaches this property itself
}
const table: Record<string, string> = { t0: "a" };
export function fromObject(): unknown {
  return table.t0; // ADMITTED it is not a function
}
`.trimStart();

const SCRIPT = `
const KEYS = ["t0", "t1"];
export function identity(tier) {
  return tier.toUpperCase();
}
export function reconcile() {
  for (const key of KEYS) if (typeof identity[key] !== "string") return key; // REPORT the rename left this behind
  return null;
}
export function shadowed(rows) {
  const identity = rows;
  for (const key of KEYS) if (typeof identity[key] !== "string") return key; // ADMITTED the inner binding is a different variable
  return null;
}
`.trimStart();

describe("ana/no-property-read-on-function", () => {
  const reports = (at: string): number[] => reportedLines("ana", "no-property-read-on-function", READS, at);

  it("reports every read off a locally declared function and leaves each real read alone", () => {
    const expected = expectedLines(READS);
    expect(expected).toHaveLength(3);
    expect(reports("src/example.ts")).toStrictEqual(expected);
  });

  it("reads untyped skill scripts, which is the file kind the defect was found in", () => {
    const at = ".claude/skills/whole-run-investigation/scripts/archive-shape.mjs";
    expect(reportedLines("ana", "no-property-read-on-function", SCRIPT, at)).toStrictEqual(
      expectedLines(SCRIPT),
    );
  });
});

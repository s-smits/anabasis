/**
 * The rule that reads a `let` the next `if` decides, and the one of its two shapes it rewrites.
 *
 * With both arms written out there is nothing to choose: the condition and both values are on
 * the page, so the rewrite is the same program. With a default there is — `c ? b : a` and
 * `a ?? b` part company the moment the default is falsy — so that shape keeps its two
 * statements and its report. What is pinned below is that split, and the annotation travelling
 * with the binding so the arms stay contextually typed. The report boundary is pinned with the
 * other simplify catchers in `simplify-catchers-shape`.
 */
import { describe, expect, it } from "bun:test";
import { fixedSource } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-const-conditional";
const DECIDED = `declare function seatbelt(reads: string[]): string;
declare const LINUX: string;

export function profileFor(platform: string, reads: string[]): string {
  let profile: string; // REPORT both arms, so the condition is the whole decision
  if (platform === "linux") {
    profile = LINUX;
  } else {
    profile = seatbelt(reads);
  }
  return profile;
}

export function widthOf(options: { width?: number }): number {
  let width = 80; // REPORT a default and one arm, which is a report and no more
  if (options.width !== undefined) width = options.width;
  return width;
}

export function handlerFor(wanted: boolean): (one: string) => void {
  let handler: (one: string) => void; // REPORT the annotation has to travel with it
  if (wanted) handler = (one) => console.log(one);
  else handler = () => undefined;
  return handler;
}

export function statusOf(accepted: boolean, failed: boolean): string {
  let status = "pending"; // ADMITTED a later statement writes it again, so it is a cascade
  if (accepted) status = "accepted";
  if (failed) status = "failed";
  return status;
}

export function trimmed(text: string, cap: number): string {
  let head = text.slice(0, cap); // ADMITTED the arm reads the name, so it refines rather than decides
  if (head.endsWith("\\uD800")) head = head.slice(0, -1);
  return head;
}
`;

describe("ana/prefer-const-conditional", () => {
  it("rewrites the two-arm shape, annotation and all, and leaves the default to its author", async () => {
    const fixed = await fixedSource("ana", RULE, DECIDED);
    expect(fixed).toContain('const profile: string = platform === "linux" ? LINUX : seatbelt(reads);');
    expect(fixed).toContain(
      "const handler: (one: string) => void = wanted ? (one) => console.log(one) : () => undefined;",
    );
    expect(fixed).toContain("let width = 80;");
    expect(fixed).toContain("if (options.width !== undefined) width = options.width;");
  });
});

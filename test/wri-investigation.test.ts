// What an investigation builds from the catalogue and one log's overview: which lanes open, the
// prompt each session is given, and whether a report has the shape the synthesis reads.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import {
  blankSections,
  filled,
  lanePrompt,
  numbersOf,
  reportOf,
  selected,
} from "../tools/wri/investigation.ts";
import type { Overview } from "../tools/wri/read.ts";

const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
const lane = (number: number): Lane => {
  const found = lanes.find((each) => each.number === number);
  if (found === undefined) throw new Error(`no lane ${String(number)}`);
  return found;
};
const numbers = (some: readonly Lane[]) => some.map((each) => each.number);
const fired = (...started: number[]) =>
  started.map((number) => ({ lane: number, name: "CHAIN" as const, detail: "" }));

describe("an investigation's lanes", () => {
  it("opens the triggered and the standing lanes, and leaves an isolated lane waiting", () => {
    const { open, isolated, waiting } = selected(lanes, fired(4, 5, 26), null);
    expect(numbers(open)).toEqual([1, 4, 15, 18, 22, 26]);
    expect(isolated).toEqual([]);
    expect(numbers(waiting)).toEqual([5]);
  });

  it("builds a named isolated lane only on its trigger", () => {
    expect(numbers(selected(lanes, fired(5), numbersOf("3-4,5")).isolated)).toEqual([5]);
    expect(() => selected(lanes, fired(4), [19])).toThrow("runs only on its trigger");
    expect(() => selected(lanes, [], [31])).toThrow("no lane 31");
  });

  it("refuses shared instructions with a section left blank", () => {
    expect(blankSections("## Orientation\n\n<!-- AUTHOR: write it -->\n\n## Hard rules\n\n- one\n")).toEqual([
      "Orientation",
    ]);
  });

  const seen: Overview = {
    rows: [{ id: "A", title: "campaign and log", lines: ["3 events"] }],
    triggers: [
      { lane: 4, name: "REFUSED UNREAD", detail: "2 of 2" },
      { lane: 5, name: "FAILS ON ONE CHECK", detail: "check-a refused 2 of 2" },
    ],
  };
  const shared =
    "## Orientation\n\nWhy the step.\n\n## Campaign under review\n\nthe row\n\n## Hard rules\n\n- quote nothing\n";

  it("gives an open lane the shared instructions and every trigger", () => {
    const prompt = lanePrompt({
      lane: lane(4),
      shared,
      overview: seen,
      catalogue,
      owners,
      report: "/r/04.md",
    });
    expect(prompt).toContain("Why the step.");
    expect(prompt).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(prompt).toContain("**4. False rejection among fails.**");
    expect(prompt).toContain("Write your report to `/r/04.md`");
  });

  it("gives an isolated lane the hard rules and its own trigger, and not the operator's question", () => {
    const prompt = lanePrompt({
      lane: lane(5),
      shared,
      overview: seen,
      catalogue,
      owners,
      report: "/r/05.md",
    });
    expect(prompt).toContain("- quote nothing");
    expect(prompt).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(prompt).not.toContain("Why the step.");
    expect(prompt).not.toContain("REFUSED UNREAD");
  });

  it("holds a report to its shape", () => {
    const good = [
      "# Lane 4: False rejection among fails",
      "Verdict: finding, one check refuses a valid rounding.",
      "## Findings",
      "### The tolerance",
      "Observation: verdict, 40 of 55 name check-a",
      "Cause: the tolerance is tighter than the published rounding",
      "Owner: pack/evaluator",
      "Reverses if: a refused answer is shown invalid by the rule",
      "Decision: whether a repair is owed",
    ].join("\n");
    expect(reportOf(lane(4), good, owners)).toMatchObject({ state: "ok", verdict: "finding", findings: 1 });
    expect(reportOf(lane(4), null, owners).state).toBe("missing");
    expect(reportOf(lane(4), good.replace("pack/evaluator", "the checker"), owners).faults).toEqual([
      "1 of 1 owners are not in the owner table",
    ]);
    expect(reportOf(lane(4), "# Lane 4: x\nVerdict: finding\n", owners).faults).toEqual([
      "the verdict is a finding and none is written",
    ]);
  });

  it("fills a template's slots and names one it cannot fill", () => {
    expect(filled("<!-- note -->\nto {out}\n", { out: "/d" })).toBe("to /d\n");
    expect(() => filled("{reports}", {})).toThrow("which nothing fills");
  });
});

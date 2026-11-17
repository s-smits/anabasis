// A Markdown table of a ledger, a vetting or a register is read by one reader (`tablesOf`,
// tools/wri/ledger.ts), and `rowsOf` is its view by a header's first cell. Every gate of an
// iteration reads its rows through these two, so a row read twice or a cell cut in two is a step
// owed or passed wrongly.
import { describe, expect, it } from "bun:test";
import { rowsOf, tablesOf } from "#tools/wri/ledger.ts";

const RULE = "| --- | --- |";
const lines = (...each: string[]) => `${each.join("\n")}\n`;

describe("the one reader of a Markdown table", () => {
  it("reads a table by its header, lower-cased, and its rows as written, and never its rule line", () => {
    const text = lines(
      "# Ledger",
      "",
      "| ID | Claim |",
      RULE,
      "| `P1` | **held** |",
      "| P2 | x |",
      "",
      "prose",
    );
    expect(tablesOf(text)).toEqual([
      {
        header: ["id", "claim"],
        rows: [
          ["`P1`", "**held**"],
          ["P2", "x"],
        ],
      },
    ]);
    // The view takes the tables under one first header cell, without backticks, and no row whose
    // first cell is empty.
    expect(rowsOf(lines("| ID | Claim |", RULE, "| `P1` | a |", "| | b |"), "id")).toEqual([["P1", "a"]]);
    expect(rowsOf(text, "claim")).toEqual([]);
  });

  it("ends a table at the next header, so each of two adjacent tables is read once", () => {
    const text = lines("| id | claim |", RULE, "| P1 | a |", "| step | reason |", RULE, "| launch | b |");
    expect(tablesOf(text).map(({ header: [first], rows }) => [first, rows.length])).toEqual([
      ["id", 1],
      ["step", 1],
    ]);
    expect(rowsOf(text, "id")).toEqual([["P1", "a"]]);
    expect(rowsOf(text, "step")).toEqual([["launch", "b"]]);
    // Two tables of one header still read as one list of rows.
    const twice = lines("| id | x |", RULE, "| P1 | a |", "| id | x |", RULE, "| P2 | b |");
    expect(rowsOf(twice, "id").map(([id]) => id)).toEqual(["P1", "P2"]);
  });

  it("keeps an escaped pipe inside its cell in both views", () => {
    const text = lines("| step | reason |", RULE, String.raw`| launch | a \| b |`);
    expect(tablesOf(text)[0]?.rows).toEqual([["launch", String.raw`a \| b`]]);
    expect(rowsOf(text, "step")).toEqual([["launch", String.raw`a \| b`]]);
  });

  it("reads a row whose first cell is a header's word as a row, and the rows under it as no other table", () => {
    const text = lines("| step | reason |", RULE, "| run | a |", "| launch | b |");
    expect(rowsOf(text, "step").map(([step]) => step)).toEqual(["run", "launch"]);
    expect(rowsOf(text, "run")).toEqual([]);
  });

  it("reads no table inside a comment or a code fence, in either view", () => {
    const text = lines(
      "<!--",
      "| id | x |",
      RULE,
      "| P1 | a |",
      "-->",
      "```text",
      "| id | x |",
      RULE,
      "| P2 | b |",
      "```",
    );
    expect(tablesOf(text)).toEqual([]);
    expect(rowsOf(text, "id")).toEqual([]);
  });

  it("reads a table indented under a list item, a rule with a colon, and a row of lone hyphens as a row", () => {
    const text = lines("- the rows:", "", "  | id | x |", "  | :-- | --: |", "  | P1 | a |", "  | - | - |");
    expect(tablesOf(text)).toEqual([
      {
        header: ["id", "x"],
        rows: [
          ["P1", "a"],
          ["-", "-"],
        ],
      },
    ]);
  });

  it("still reads a table written without its rule line, and ends one at the first line that is no table line", () => {
    const text = lines("| id | x |", "| P1 | a |", "prose", "| P2 | b |");
    expect(rowsOf(text, "id")).toEqual([["P1", "a"]]);
    expect(rowsOf(lines("| id | x |", RULE, "| P1 | a |", "", "| P2 | b |"), "id")).toEqual([["P1", "a"]]);
  });
});

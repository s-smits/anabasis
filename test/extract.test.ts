import { describe, expect, it } from "bun:test";
import { type AnswerFile, textFiles } from "../src/kernel/answer-files.ts";
import { EXTRACT, extract, headOf } from "../src/kernel/extract.ts";

const zipped = (path: string, entries: Record<string, string>): AnswerFile => {
  const [file] = textFiles([
    { path, entries: Object.entries(entries).map(([name, text]) => ({ path: name, text })) },
  ]);
  if (file === undefined) throw new Error("no file");
  return file;
};

const plain = (path: string, text: string): AnswerFile => {
  const [file] = textFiles([{ path, text }]);
  if (file === undefined) throw new Error("no file");
  return file;
};

const cell = (ref: string, inner: string, type?: string) =>
  `<c r="${ref}"${type === undefined ? "" : ` t="${type}"`}>${inner}</c>`;

const workbook = (rows: readonly string[][], shared: readonly string[] = []) =>
  zipped("book.xlsx", {
    "xl/workbook.xml": "<workbook/>",
    "xl/sharedStrings.xml": `<sst>${shared.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows.map((row) => `<row>${row.join("")}</row>`).join("")}</sheetData></worksheet>`,
  });

describe("the offline file extractor", () => {
  it("classifies every formula cell shape: cached, uncached, error, and without a reference", () => {
    const cases: [string, keyof NonNullable<ReturnType<typeof extract>["formulas"]>][] = [
      [cell("A1", "<f>SUM(B1:B3)</f><v>6</v>"), "cachedEvaluated"],
      [cell("A2", "<f>SUM(B1:B3)</f>"), "uncachedFormula"],
      [cell("A3", "<f>1/0</f><v>#DIV/0!</v>", "e"), "formulaError"],
      [cell("A4", "<f>Sheet2!A1</f><v>#REF!</v>", "str"), "formulaError"],
    ];
    for (const [cellXml, counted] of cases) {
      const { formulas, kind } = extract(workbook([[cellXml]]));
      expect(kind).toBe("sheet");
      const nonzero = Object.entries(formulas ?? {})
        .filter(([, count]) => count > 0)
        .map(([name]) => name);
      expect(nonzero.filter((name) => name !== "zeroRefFormulaCount")).toEqual([counted]);
    }
    const constant = extract(workbook([[cell("A1", "<f>ROUND(42.17, 2)</f><v>42.17</v>")]]));
    expect(constant.formulas).toEqual({
      cachedEvaluated: 1,
      uncachedFormula: 0,
      formulaError: 0,
      zeroRefFormulaCount: 1,
    });
  });

  it("reads shared, inline and escaped strings by row, and stops a sheet after its empty-row run", () => {
    const shared = ["Region", "Q1 &amp; Q2"];
    const read = extract(
      workbook(
        [
          [cell("A1", "<v>0</v>", "s"), cell("B1", "<v>1</v>", "s")],
          [cell("A2", "<is><t>North &#x2192; East</t></is>", "inlineStr"), cell("B2", "<v>12.5</v>")],
        ],
        shared,
      ),
    );
    expect(read.text).toBe("## sheet1.xml\nRegion\tQ1 & Q2\nNorth → East\t12.5");
    const blank = Array.from({ length: EXTRACT.emptyRows + 2 }, (_, at) => [
      cell(`A${String(at + 1)}`, "<v></v>"),
    ]);
    const cut = extract(workbook([...blank, [cell("A9999", "<v>late</v>")]]));
    expect(cut.text).not.toContain("late");
  });

  it("reads a document's paragraphs, a deck's slides in order, a notebook's cells and outputs, and plain text", () => {
    const doc = zipped("memo.docx", {
      "word/document.xml":
        '<w:document><w:p><w:r><w:t>First</w:t></w:r><w:r><w:t xml:space="preserve"> line</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:document>',
    });
    expect(extract(doc)).toMatchObject({ kind: "document", text: "First line\nSecond", fault: null });
    const deck = zipped("deck.pptx", {
      "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>",
    });
    expect(extract(deck).text).toBe("## slide 2\nTwo\n\n## slide 10\nTen");
    const notebook = {
      cells: [
        { cell_type: "markdown", source: ["# Title"] },
        { cell_type: "code", source: "print(1)", outputs: [{ text: ["1\n"] }] },
      ],
    };
    expect(extract(plain("work.ipynb", JSON.stringify(notebook))).text).toBe(
      "## markdown\n# Title\n\n## code\nprint(1)\n# output\n1\n",
    );
    expect(extract(plain("notes.md", "words"))).toMatchObject({ kind: "text", text: "words" });
  });

  it("names a fault instead of throwing, and reads a binary file as empty", () => {
    expect(extract(plain("bad.ipynb", "{not json")).fault).toContain("could not read bad.ipynb");
    expect(
      extract({ path: "chart.png", base64: Buffer.from([0x89, 0x50]).toString("base64") }),
    ).toMatchObject({
      kind: "binary",
      text: "",
      fault: null,
    });
    const pdf = extract({ path: "report.pdf", base64: Buffer.from("not a pdf").toString("base64") });
    expect([pdf.kind, pdf.text, pdf.fault === null]).toEqual(["pdf", "", false]);
  });

  it("heads a reading with its size, words and prose-to-numeric ratio, its formulas and any fault", () => {
    expect(headOf(extract(plain("a.md", "the 3 numbers 4 here")))).toEqual([
      "a.md (text, 20 bytes extracted, 5 words, prose to numeric 1.50)",
    ]);
    expect(headOf(extract(plain("b.md", "only words")))[0]).toContain("all prose");
    expect(headOf(extract(workbook([[cell("A1", "<f>B1</f>")]])))[1]).toBe(
      "formulas: 0 evaluated, 1 uncached, 0 errors, 0 without a reference",
    );
    expect(headOf(extract(plain("bad.ipynb", "{")))).toHaveLength(2);
  });
});

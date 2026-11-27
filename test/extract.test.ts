import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type AnswerFile, textFiles } from "../src/kernel/answer-files.ts";
import { answerImages, EXTRACT, extract, headOf } from "../src/kernel/extract.ts";

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

const sqliteBytes = (setup: (db: Database) => void): string => {
  const dir = mkdtempSync(join(tmpdir(), "ana-extract-db-"));
  try {
    const dbPath = join(dir, "sample.db");
    const db = new Database(dbPath);
    setup(db);
    db.close();
    return readFileSync(dbPath).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

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
    const constant = extract(
      workbook([[cell("A1", "<f>ROUND(42.17, 2)</f><v>42.17</v>"), cell("B1", "<f>LOG10(100)</f><v>2</v>")]]),
    );
    expect(constant.formulas).toEqual({
      cachedEvaluated: 2,
      uncachedFormula: 0,
      formulaError: 0,
      zeroRefFormulaCount: 2,
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
        {
          cell_type: "code",
          source: "print(1)",
          outputs: [{ text: ["1\n"] }, { data: { "text/plain": ["42"] } }],
        },
      ],
    };
    expect(extract(plain("work.ipynb", JSON.stringify(notebook))).text).toBe(
      "## markdown\n# Title\n\n## code\nprint(1)\n# output\n1\n42",
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

  it("follows workbook tab order, custom worksheet paths, namespaced shared formulas, and non-ASCII shared-string indices", () => {
    const nsSheet = zipped("ns.xlsx", {
      "xl/workbook.xml":
        '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Summary" sheetId="2" r:id="rId2"/><x:sheet name="Detail" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/data.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>ok</t></si></sst>",
      "xl/worksheets/data.xml":
        '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row><x:c r="A1"><x:f t="shared" si="0"/><x:v>42</x:v></x:c><x:c r="B1" t="s"><x:v>²</x:v></x:c></x:row></x:sheetData></x:worksheet>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    });
    const sheet = extract(nsSheet);
    expect(sheet.fault).toBeNull();
    expect(sheet.text).toBe("## Summary\n42\t²\n\n## Detail\nok");
    expect(sheet.formulas).toEqual({
      cachedEvaluated: 1,
      uncachedFormula: 0,
      formulaError: 0,
      zeroRefFormulaCount: 0,
    });
    expect(extract({ path: nsSheet.path, base64: nsSheet.base64 })).toMatchObject({
      kind: "sheet",
      text: "## Summary\n42\t²\n\n## Detail\nok",
      fault: null,
    });
  });

  it("routes by magic bytes so plain text named .db or .xlsx stays text, and reports single-line faults on corrupt zips", () => {
    expect(extract(plain("notes.db", "plain notes"))).toMatchObject({
      kind: "text",
      text: "plain notes",
      fault: null,
    });
    expect(extract(plain("notes.xlsx", "not a zip"))).toMatchObject({
      kind: "text",
      text: "not a zip",
      fault: null,
    });
    const corrupt = extract({
      path: "broken.xlsx",
      base64: Buffer.from("PK\u0003\u0004not-a-valid-zip").toString("base64"),
    });
    expect(corrupt.kind).toBe("binary");
    expect(corrupt.fault).toContain("could not read broken.xlsx");
    expect(corrupt.fault).not.toContain("\n");
  });

  it("reads SQLite databases safely in memory across WAL headers, BLOBs, invalid UTF-8, and generated-column bombs", () => {
    const base64 = sqliteBytes((db) => {
      db.run("PRAGMA journal_mode=WAL");
      db.run(
        "CREATE TABLE metrics (k TEXT, payload BLOB, big BLOB GENERATED ALWAYS AS (zeroblob(200000000)) VIRTUAL)",
      );
      db.run("INSERT INTO metrics (k, payload) VALUES (CAST(x'ff41' AS TEXT), x'00010203')");
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    });
    const got = extract({ path: "sample.db", base64 });
    expect(got.fault).toBeNull();
    expect(got.kind).toBe("database");
    expect(got.text).toBe("## metrics\nk\tpayload\n\uFFFDA\t<blob 4 bytes>");
  });

  it("refuses zip members above the 16 MB cap", () => {
    const bomb = zipped("bomb.xlsx", {
      "xl/workbook.xml": "<workbook/>",
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>${"A".repeat(17 * 1024 * 1024)}</t></is></c></row></sheetData></worksheet>`,
    });
    const refused = extract({ path: bomb.path, base64: bomb.base64 });
    expect(refused.kind).toBe("binary");
    expect(refused.fault).toContain("exceeds 16777216 byte limit");
    expect(refused.fault).not.toContain("\n");
  });

  it("extracts docx tables and embedded images from Office archives and notebooks", () => {
    const doc = zipped("report.docx", {
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>Summary</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>N</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
      "word/media/image1.png": "x",
      "word/media/vector.svg": "<svg/>",
    });
    expect(extract(doc).text).toBe("Summary\nMetric\tValue\nN\t42");
    expect(answerImages(doc).map(({ path }) => path)).toEqual(["report.docx#word/media/image1.png"]);

    const nb = {
      cells: [{ cell_type: "code", source: "plot()", outputs: [{ data: { "image/png": "AAAA" } }] }],
    };
    const nbFile = plain("diag.ipynb", JSON.stringify(nb));
    expect(answerImages(nbFile).map(({ path }) => path)).toEqual(["diag.ipynb#cell-0-out-0.png"]);
    expect(answerImages({ path: "empty.png", base64: "" })).toEqual([]);
    expect(answerImages({ path: "pic.png", base64: "AAAA" }).map(({ path }) => path)).toEqual(["pic.png"]);
  });
});

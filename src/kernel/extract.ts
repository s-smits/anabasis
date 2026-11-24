import { asRecord, isString } from "../meta/json-shape.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { runSync, decodeOutput } from "../meta/subprocess.ts";
import type { AnswerFile } from "./answer-files.ts";

interface Formulas {
  readonly cachedEvaluated: number;
  readonly uncachedFormula: number;
  readonly formulaError: number;
  readonly zeroRefFormulaCount: number;
}

export interface Extracted {
  readonly path: string;
  readonly kind: "text" | "sheet" | "document" | "slides" | "notebook" | "pdf" | "archive" | "binary";
  readonly text: string;
  readonly formulas: Formulas | null;
  readonly fault: string | null;
}

export const EXTRACT = { cellsPerSheet: 100_000, emptyRows: 500, pdfMs: 15_000 };

const ERRORS = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);
const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const unescaped = (text: string): string =>
  text.replaceAll(
    /&(?:#x([\da-f]+)|#(\d+)|([a-z]+));/giu,
    (whole, hex?: string, decimal?: string, name?: string) => {
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
      return ENTITIES.get(name ?? "") ?? whole;
    },
  );

const runsOf = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "gu"))].map(([, inner = ""]) =>
    unescaped(inner),
  );

const blocksOf = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gu"))].map(
    ([, inner = ""]) => inner,
  );

const numbered = (path: string): number => Number(/(\d+)\.xml$/u.exec(path)?.[1] ?? 0);

function sheetsOf(members: ReadonlyMap<string, string>): Pick<Extracted, "text" | "formulas"> {
  const shared = blocksOf(members.get("xl/sharedStrings.xml") ?? "", "si").map((item) =>
    runsOf(item, "t").join(""),
  );
  const counts = { cachedEvaluated: 0, uncachedFormula: 0, formulaError: 0, zeroRefFormulaCount: 0 };
  const sheets = [...members.keys()]
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(path))
    .toSorted((one, other) => numbered(one) - numbered(other));
  const text = sheets.map((path) => {
    let cells = 0;
    let empty = 0;
    const rows: string[] = [];
    for (const row of blocksOf(members.get(path) ?? "", "row")) {
      if (cells >= EXTRACT.cellsPerSheet || empty >= EXTRACT.emptyRows) break;
      const values = [...row.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)].map(
        ([, attributes = "", inner = ""]) => {
          cells += 1;
          const type = /\bt="([^"]+)"/u.exec(attributes)?.[1];
          const formula = runsOf(inner, "f")[0];
          const value = runsOf(inner, "v")[0];
          const shown =
            type === "s"
              ? (shared[Number(value)] ?? "")
              : type === "inlineStr"
                ? runsOf(inner, "t").join("")
                : (value ?? "");
          if (formula !== undefined) {
            if (type === "e" || ERRORS.has(shown)) counts.formulaError += 1;
            else if (value === undefined) counts.uncachedFormula += 1;
            else counts.cachedEvaluated += 1;
            if (!/\$?[A-Z]{1,3}\$?\d+|[A-Za-z_][\w.]*!/u.test(formula)) counts.zeroRefFormulaCount += 1;
            return value === undefined ? `=${formula}` : shown;
          }
          return shown;
        },
      );
      empty = values.every((value) => value === "") ? empty + 1 : 0;
      rows.push(values.join("\t"));
    }
    return `## ${path.slice("xl/worksheets/".length)}\n${rows.join("\n")}`;
  });
  return { text: text.join("\n\n"), formulas: counts };
}

const paragraphs = (xml: string, paragraph: string, run: string): string =>
  blocksOf(xml, paragraph)
    .map((block) => runsOf(block, run).join(""))
    .filter((line) => line !== "")
    .join("\n");

function notebookOf(text: string): string {
  const cells = asRecord(capturedJsonParse(text))?.cells;
  if (!Array.isArray(cells)) throw new Error("a notebook without cells");
  const joined = (value: unknown): string =>
    Array.isArray(value) ? value.filter(isString).join("") : isString(value) ? value : "";
  return cells
    .map((cell) => {
      const row = asRecord(cell);
      const outputs = Array.isArray(row?.outputs)
        ? row.outputs.map((out) => joined(asRecord(out)?.text)).join("")
        : "";
      return `## ${isString(row?.cell_type) ? row.cell_type : "cell"}\n${joined(row?.source)}${outputs === "" ? "" : `\n# output\n${outputs}`}`;
    })
    .join("\n\n");
}

function pdfOf(base64: string): Pick<Extracted, "text" | "fault"> {
  const ran = runSync(["pdftotext", "-q", "-layout", "fd://0", "-"], {
    input: Buffer.from(base64, "base64"),
    timeout: EXTRACT.pdfMs,
  });
  if (ran.exitCode === 0) return { text: decodeOutput(ran.stdout), fault: null };
  const why =
    ran.exitCode === null && ran.signal === null
      ? "pdftotext is not installed on this host"
      : `pdftotext ${decodeOutput(ran.stderr).trim() || "failed"}`;
  return { text: "", fault: why };
}

export function extract(file: AnswerFile): Extracted {
  const { path } = file;
  const members = new Map((file.entries ?? []).map((entry) => [entry.path, entry.text]));
  const base = { path, formulas: null, fault: null };
  try {
    if (members.has("xl/workbook.xml")) return { ...base, kind: "sheet", ...sheetsOf(members) };
    if (members.has("word/document.xml")) {
      return {
        ...base,
        kind: "document",
        text: paragraphs(members.get("word/document.xml") ?? "", "w:p", "w:t"),
      };
    }
    const slides = [...members.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
    if (slides.length > 0) {
      const text = slides
        .toSorted((one, other) => numbered(one) - numbered(other))
        .map(
          (name) =>
            `## slide ${String(numbered(name))}\n${paragraphs(members.get(name) ?? "", "a:p", "a:t")}`,
        );
      return { ...base, kind: "slides", text: text.join("\n\n") };
    }
    if (members.size > 0) {
      return {
        ...base,
        kind: "archive",
        text: [...members].map(([name, text]) => `## ${name}\n${text}`).join("\n\n"),
      };
    }
    if (path.toLowerCase().endsWith(".pdf")) return { ...base, kind: "pdf", ...pdfOf(file.base64) };
    if (file.text === undefined) return { ...base, kind: "binary", text: "" };
    const notebook = path.toLowerCase().endsWith(".ipynb");
    return {
      ...base,
      kind: notebook ? "notebook" : "text",
      text: notebook ? notebookOf(file.text) : file.text,
    };
  } catch (error) {
    return {
      ...base,
      kind: "binary",
      text: file.text ?? "",
      fault: `could not read ${path}: ${String(error)}`,
    };
  }
}

export function headOf(extracted: Extracted): string[] {
  const bytes = Buffer.byteLength(extracted.text);
  const words = extracted.text.split(/\s+/u).filter((word) => word !== "");
  const numeric = words.filter((word) => /\d/u.test(word)).length;
  const { formulas, fault } = extracted;
  return [
    `${extracted.path} (${extracted.kind}, ${String(bytes)} bytes extracted, ${String(words.length)} words, prose to numeric ${numeric === 0 ? "all prose" : (words.length / numeric - 1).toFixed(2)})`,
    ...(formulas === null
      ? []
      : [
          `formulas: ${String(formulas.cachedEvaluated)} evaluated, ${String(formulas.uncachedFormula)} uncached, ${String(formulas.formulaError)} errors, ${String(formulas.zeroRefFormulaCount)} without a reference`,
        ]),
    ...(fault === null ? [] : [`extraction fault: ${fault}`]),
  ];
}

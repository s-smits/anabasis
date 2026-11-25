import { sha256 } from "../meta/digest.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { capturedJsonParse, parseJsonAs } from "../meta/json-runtime.ts";
import { delimiter } from "../meta/path.ts";
import { decodeOutput, runSync } from "../meta/subprocess.ts";
import { toolchainPathDirs } from "../wall/policy.ts";
import type { AnswerFile } from "./answer-files.ts";
import EXTRACT_PY from "./extract.py" with { type: "text" };

interface Formulas {
  readonly cachedEvaluated: number;
  readonly uncachedFormula: number;
  readonly formulaError: number;
  readonly zeroRefFormulaCount: number;
}

export interface Extracted {
  readonly path: string;
  readonly kind:
    | "text"
    | "sheet"
    | "document"
    | "slides"
    | "notebook"
    | "pdf"
    | "database"
    | "archive"
    | "binary";
  readonly text: string;
  readonly formulas: Formulas | null;
  readonly fault: string | null;
}

export const EXTRACT = { cellsPerSheet: 100_000, emptyRows: 500, pdfMs: 15_000, slice: 750 };
const SQLITE_MAGIC = "SQLite format 3\0";
const PY_MAX_BUFFER = 16 * 1024 * 1024;
let cachedPython: string | undefined;

function pythonBin(): string {
  cachedPython ??= Bun.which("python3", { PATH: toolchainPathDirs().join(delimiter) }) ?? "python3";
  return cachedPython;
}

const isZip = (bytes: Buffer): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);

const isSqlite = (bytes: Buffer): boolean =>
  bytes.length >= 16 && bytes.subarray(0, 16).toString("utf8") === SQLITE_MAGIC;

const lastLine = (text: string): string => text.trim().split(/\r?\n/u).at(-1)?.trim() ?? "";

function pyExtract(
  mode: "xlsx" | "docx" | "pptx" | "sqlite",
  bytes: Buffer,
): Pick<Extracted, "text" | "formulas"> {
  const ran = runSync(
    [pythonBin(), "-I", "-c", EXTRACT_PY, mode, String(EXTRACT.cellsPerSheet), String(EXTRACT.emptyRows)],
    { input: bytes, timeout: EXTRACT.pdfMs, maxBuffer: PY_MAX_BUFFER },
  );
  if (ran.cappedAt !== null) {
    throw new Error(`python3 extractor exceeded ${String(ran.cappedAt)} bytes of output`);
  }
  if (ran.exitCode !== 0) {
    const why =
      ran.exitCode === null && ran.signal === null
        ? "python3 is not installed on this host"
        : ran.signal === null
          ? lastLine(decodeOutput(ran.stderr)) || `python3 extractor exited ${String(ran.exitCode)}`
          : `python3 extractor timed out (${ran.signal})`;
    throw new Error(why);
  }
  return parseJsonAs<Pick<Extracted, "text" | "formulas">>(decodeOutput(ran.stdout));
}

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

function pdfOf(bytes: Buffer): Pick<Extracted, "text" | "fault"> {
  const ran = runSync(["pdftotext", "-q", "-layout", "fd://0", "-"], {
    input: bytes,
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
  const bytes = Buffer.from(file.base64, "base64");
  const lower = path.toLowerCase();
  const zipLike = members.size > 0 || isZip(bytes);
  try {
    if (zipLike && (lower.endsWith(".xlsx") || members.has("xl/workbook.xml"))) {
      return { ...base, kind: "sheet", ...pyExtract("xlsx", bytes) };
    }
    if (zipLike && (lower.endsWith(".docx") || members.has("word/document.xml"))) {
      return { ...base, kind: "document", ...pyExtract("docx", bytes) };
    }
    if (
      zipLike &&
      (lower.endsWith(".pptx") ||
        [...members.keys()].some((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)))
    ) {
      return { ...base, kind: "slides", ...pyExtract("pptx", bytes) };
    }
    if (members.size > 0) {
      return {
        ...base,
        kind: "archive",
        text: [...members].map(([name, text]) => `## ${name}\n${text}`).join("\n\n"),
      };
    }
    if (lower.endsWith(".pdf")) return { ...base, kind: "pdf", ...pdfOf(bytes) };
    if (isSqlite(bytes)) return { ...base, kind: "database", ...pyExtract("sqlite", bytes) };
    if (file.text === undefined) return { ...base, kind: "binary", text: "" };
    const notebook = lower.endsWith(".ipynb");
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

const sliceAt = (bytes: Buffer, from: number): string => {
  let start = Math.max(0, Math.min(from, bytes.length));
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  let end = Math.min(start + EXTRACT.slice, bytes.length);
  while (end > start && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(start, end).toString("utf8");
};

export function dossierOf(extracted: Extracted, seed: string): string {
  const bytes = Buffer.from(extracted.text);
  const room = Math.max(1, bytes.length - 3 * EXTRACT.slice);
  const middle = [0, 1]
    .map((at) => EXTRACT.slice + (Number.parseInt(sha256(`${seed}:${String(at)}`).slice(0, 8), 16) % room))
    .toSorted((one, other) => one - other);
  const parts =
    bytes.length <= 4 * EXTRACT.slice
      ? [extracted.text]
      : [0, ...middle, bytes.length - EXTRACT.slice].map((at) => sliceAt(bytes, at));
  return [...headOf(extracted), parts.join("\n[…]\n")].join("\n");
}

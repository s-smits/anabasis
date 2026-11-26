import { sha256 } from "../meta/digest.ts";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { boundText } from "../meta/bounded-text.ts";
import { storedZip, zipTexts } from "../meta/zip.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";

export interface AnswerFile {
  readonly path: string;
  readonly base64: string;
  readonly text?: string;
  readonly entries?: readonly TextFile[];
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to `JsonObject`, and an interface has no implicit index signature
type TextFile = { readonly path: string; readonly text: string };

export type ControlFile =
  | TextFile
  | { readonly path: string; readonly base64: string }
  | { readonly path: string; readonly entries: readonly TextFile[] };

export interface FileManifest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

const SHOWN_BYTES = 4096;

export const DELIVERABLES = { folder: "deliverables", count: 64, bytes: 16 * 1024 * 1024 };

function filing(): (path: string, bytes: Buffer) => AnswerFile {
  let left = DELIVERABLES.bytes;
  return (path, bytes) => {
    let text: string | undefined;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      /* Binary files have no text field. */
    }
    const { members, used } = zipTexts(bytes, left);
    left -= used;
    return {
      path,
      base64: bytes.toString("base64"),
      ...keyIfDefined("text", text),
      ...keyIfDefined("entries", members.length > 0 ? members : undefined),
    };
  };
}

function safePaths(paths: readonly string[]): boolean {
  return (
    new Set(paths).size === paths.length &&
    paths.every(
      (path) =>
        path.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
        !path.includes("\\") &&
        !path.includes("\0"),
    )
  );
}

export function manifestOf(value: JsonValue | undefined): FileManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("invalid answer file manifest");
  const manifest = value.map((entry) => {
    const row = asRecord(entry);
    if (
      row === null ||
      !isString(row.path) ||
      !isNumber(row.bytes) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0 ||
      !isString(row.sha256) ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    ) {
      throw new Error("invalid answer file manifest entry");
    }
    return { path: row.path, bytes: row.bytes, sha256: row.sha256 };
  });
  if (!safePaths(manifest.map((file) => file.path))) throw new Error("invalid answer file path");
  return manifest;
}

export function capturedFiles(value: JsonValue | undefined): AnswerFile[] {
  if (!Array.isArray(value)) throw new Error("invalid answer file capture");
  let total = 0;
  const filed = filing();
  const files = value.map((entry) => {
    const row = asRecord(entry);
    if (!isString(row?.path) || !isString(row.base64)) throw new Error("invalid captured file");
    const bytes = Buffer.from(row.base64, "base64");
    if (bytes.toString("base64") !== row.base64) throw new Error("invalid file base64");
    total += bytes.length;
    return filed(row.path, bytes);
  });
  if (files.length > DELIVERABLES.count || total > DELIVERABLES.bytes) {
    throw new Error("answer files exceed the capture's bounds");
  }
  if (!safePaths(files.map((file) => file.path))) throw new Error("invalid answer file path");
  return files;
}

export function decodeBase64(raw: string): Buffer | null {
  const bytes = Buffer.from(raw, "base64");
  return bytes.toString("base64") === raw ? bytes : null;
}

export function textFiles(rows: readonly ControlFile[]): AnswerFile[] {
  const archived = rows.flatMap((row) => ("entries" in row ? [row.entries.map(({ path }) => path)] : []));
  if (![rows.map(({ path }) => path), ...archived].every(safePaths)) {
    throw new Error("invalid answer file path");
  }
  const filed = filing();
  return rows.map((row) => {
    const bytes =
      "text" in row
        ? Buffer.from(row.text)
        : "base64" in row
          ? decodeBase64(row.base64)
          : storedZip(row.entries);
    if (bytes === null) throw new Error("invalid file base64");
    return filed(row.path, bytes);
  });
}

const storeOf = (log: string) => join(dirname(log), "states", DELIVERABLES.folder);

export function keepAnswerFiles(log: string, files: readonly AnswerFile[]): FileManifest[] {
  const store = storeOf(log);
  if (files.length === 0) return [];
  mkdirSync(store, { recursive: true });
  return files.map((file) => {
    const bytes = Buffer.from(file.base64, "base64");
    const digest = sha256(bytes);
    const scratch = join(store, `in-${crypto.randomUUID()}`);
    writeFileSync(scratch, bytes, { flush: true });
    renameSync(scratch, join(store, digest));
    return { path: file.path, bytes: bytes.length, sha256: digest };
  });
}

export function readAnswerFiles(log: string, manifest: readonly FileManifest[]): AnswerFile[] {
  const filed = filing();
  return manifest.map((file) => {
    const at = join(storeOf(log), file.sha256);
    let bytes: Buffer;
    try {
      bytes = readFileSync(at);
    } catch (error) {
      throw new Error(`answer file ${file.path} is not in the campaign's store (${at})`, { cause: error });
    }
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`answer file ${file.path} does not match its manifest`);
    }
    return filed(file.path, bytes);
  });
}

export function shownFiles(
  log: string,
  manifest: readonly FileManifest[],
  files: readonly AnswerFile[] = readAnswerFiles(log, manifest),
): JsonValue[] {
  let left = DELIVERABLES.count * SHOWN_BYTES;
  const shown = (text: string) => boundText(text, SHOWN_BYTES).shown;
  const texts = files.map(({ text }) => (text === undefined ? undefined : shown(text)));
  for (const text of texts) left -= Buffer.byteLength(text ?? "");
  return files.map(({ path, entries = [] }, at) => {
    const listed = entries.flatMap((member) => {
      if (left < 0) return [];
      const item = { path: member.path, text: shown(member.text) };
      left -= Buffer.byteLength(capturedJsonStringify(item)) + 1;
      return left < 0 ? [] : [item];
    });
    return {
      ...manifest[at],
      path,
      ...keyIfDefined("text", texts[at]),
      ...keyIfDefined("entries", listed.length > 0 ? listed : undefined),
      ...keyIfDefined(
        "unlisted",
        entries.length > listed.length ? entries.length - listed.length : undefined,
      ),
    };
  });
}

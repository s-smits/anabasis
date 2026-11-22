/** Content-addressed storage and manifest validation for submitted deliverable files (`states/deliverables/`). */
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
  /** The text members of a zip archive, such as a workbook or a document (`zipTexts`). */
  readonly entries?: readonly TextFile[];
}

/** A file given as its text alone. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to `JsonObject`, and an interface has no implicit index signature
type TextFile = { readonly path: string; readonly text: string };

/** A file as a draft's control or a try gives one: its text, or an archive's text members in place
 *  of its bytes, since a seat writes no archive (`storedZip` then gives it bytes). */
export type ControlFile = TextFile | { readonly path: string; readonly entries: readonly TextFile[] };

export interface FileManifest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** 4 KB of each file's text keep 64 files inside a reader's prompt; a check that reads further is
 *  probed, and the whole bytes stay in the store by digest. */
const SHOWN_BYTES = 4096;

/** 64 work products and 16 MiB allow reports and workbooks while bounding capture and cell input. */
export const DELIVERABLES = { folder: "deliverables", count: 64, bytes: 16 * 1024 * 1024 };

/** A reader of one set of files as a check receives each: its bytes, its text where they are
 *  UTF-8, and an archive's text members, within the inflated bytes the whole set may take. */
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

/** Whether each path is relative, stays inside the folder and names one file once. */
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

/** Old verdict events omit the manifest and retain precisely their previous meaning. The fold
 *  checks shape alone: the bounds are the capture's, so a later bound leaves every log readable. */
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

/** Validate the walled capture too: a malformed transport cannot introduce a path or unbounded data. */
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

/** Files as a control carries them, in the form a check receives: an archive as the stored bytes of
 *  its members, so that it is kept and read back whole as a solver's is. */
export function textFiles(rows: readonly ControlFile[]): AnswerFile[] {
  const archived = rows.flatMap((row) => ("text" in row ? [] : [row.entries.map(({ path }) => path)]));
  if (![rows.map(({ path }) => path), ...archived].every(safePaths)) {
    throw new Error("invalid answer file path");
  }
  const filed = filing();
  return rows.map((row) => filed(row.path, "text" in row ? Buffer.from(row.text) : storedZip(row.entries)));
}

/** Where a campaign keeps submitted bytes, by digest beside its states. */
const storeOf = (log: string) => join(dirname(log), "states", DELIVERABLES.folder);

/** Publish whole, flushed bytes by digest: a rename puts them in place whole, and two submits of
 *  one content put the same bytes under the same name. */
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

/** One byte reader for the verifier, Referee and reports; damaged or missing content never grades. */
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

/** What a ruling or a label is shown of the files: each one's path, size and digest, with its text
 *  bounded where it is UTF-8, never its bytes, then archive members, each bounded alike and charged
 *  its whole listing in bytes, while the set stays within what 64 text files take; the rest are
 *  counted. A reader that has read the files passes them. */
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

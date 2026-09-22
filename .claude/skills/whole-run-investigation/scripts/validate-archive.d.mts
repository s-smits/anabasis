import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";

export const ARCHIVE_FILES: string[];
export class ArchiveValidationError extends Error {
  issues: string[];
}
export function predictionFrozenHash(row: JsonObject): string;
export function validateArchiveDirectory(path: string): {
  schema: string;
  valid: boolean;
  archiveDir: string;
  files: { name: string; bytes: number }[];
  runId: string;
  sourceRevision: string;
  predictionCount: number;
  safeguardCount: number;
};
export function writeArchive(input: JsonObject): {
  valid: boolean;
  archiveDir: string;
  [key: string]: JsonValue;
};

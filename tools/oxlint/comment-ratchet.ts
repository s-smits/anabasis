import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { compareCodeUnits } from "../../src/meta/stable-json.ts";

export const COMMENT_RATCHET_FILE = "tools/oxlint/comment-ratchet.tsv";

const HEADER = "path\tcount";
const SAFETY_MARKER = /(?:^|[^\p{L}\p{N}_])SAFETY\s*:\s*\S/u;
const DIRECTIVE_PREFIX = /^\s*(?:oxlint-disable|eslint-disable|biome-ignore|@ts-)/u;
const RULE_SOURCE_PATH = /^tools\/oxlint\/[^/]+\/rules\/[^/]+\.ts$/u;
const NO_FIX_NOTE = /\bno fix\b/iu;

interface CommentMeta {
  readonly value: string;
  readonly placement: "shebang" | "empty-catch" | "normal";
  readonly fileRole: "rule" | "other";
}

interface RatchetRead {
  readonly entries: Map<string, number>;
  readonly unread: string[];
}

export function isRuleSourcePath(relativePath: string): boolean {
  return RULE_SOURCE_PATH.test(relativePath);
}

export function isExemptComment({ value, placement, fileRole }: CommentMeta): boolean {
  if (placement !== "normal") return true;
  if (SAFETY_MARKER.test(value) || DIRECTIVE_PREFIX.test(value)) return true;
  return fileRole === "rule" && NO_FIX_NOTE.test(value);
}

export function readCommentRatchet(text: string): RatchetRead {
  const [header, ...rows] = text.split("\n");
  const entries = new Map<string, number>();
  const unread: string[] = [];
  if (header !== undefined && header !== "" && header !== HEADER) {
    unread.push(`line 1: expected header "${HEADER}"`);
  }
  for (const [index, row] of rows.entries()) {
    if (row.trim() === "") continue;
    const cells = row.split("\t");
    const [path = "", rawCount = ""] = cells;
    const count = Number(rawCount);
    if (cells.length !== 2 || path === "" || !/^[1-9]\d*$/u.test(rawCount) || !Number.isSafeInteger(count)) {
      unread.push(`line ${String(index + 2)}: invalid ratchet row "${row}"`);
      continue;
    }
    if (entries.has(path)) {
      unread.push(`line ${String(index + 2)}: duplicate ratchet path "${path}"`);
      continue;
    }
    entries.set(path, count);
  }
  return { entries, unread };
}

export function formatCommentRatchet(counts: ReadonlyMap<string, number>): string {
  const lines = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .toSorted(([left], [right]) => compareCodeUnits(left, right))
    .map(([path, count]) => `${path}\t${String(count)}`);
  return `${[HEADER, ...lines].join("\n")}\n`;
}

export function loadCommentRatchet(repoRoot: string): ReadonlyMap<string, number> {
  const path = join(repoRoot, COMMENT_RATCHET_FILE);
  if (!existsSync(path)) return new Map();
  return readCommentRatchet(readFileSync(path, "utf8")).entries;
}

/**
 * A reference in prose to something the tree no longer holds: a backticked repository path that
 * names no file or directory, or an `ANA_*` setting documented for the operator that no code reads.
 *
 * Prose outlives the code it describes. On 5 November 2026, 82 distinct backticked paths in the
 * tracked Markdown named files that did not exist, 60 of them in one measurement ledger, and
 * `.env.runs.example` described the central host's setting as read by a script a day after that
 * script was deleted. A reader who follows such a path finds nothing, or trusts a setting that does nothing.
 *
 * What is read: every Markdown file and every comment line of a TypeScript file, outside the
 * vendored trees and the documents whose subject is v1's record (`AGENTS.md`: `docs/transfer.md`,
 * `docs/v1.md` and `studies/`). A ledger elsewhere cites a gone file as `<sha>:path`, the
 * convention `AGENTS.md` sets, and a commit-qualified path is not checked. A path counts as present
 * where it exists from the repository root or from any directory above the document, which keeps a
 * skill's own relative paths, or where Git ignores it, since a command writes it (`dist`, `.token`).
 * A placeholder or a glob (`<name>`, `*`, `{a,b}`, `$X`, `...`) and a one-letter example name
 * (`src/x.ts`) are not paths. A setting is read when any code or script file spells it, comments
 * included, so the scan fails open; for that reason this file and its examples never spell one
 * whole.
 */
import { existsSync, readdirSync, readFileSync } from "../../src/meta/filesystem.ts";
import { gitMaybe } from "../../src/meta/git.ts";
import { dirname, join } from "../../src/meta/path.ts";
import type { TreeFinding } from "./tree-findings.ts";

/** A path from one of the roots, gone ones (`starters`) included. A path after `:` is qualified by
 *  a revision (`<sha>:path`) and one after `/`, `#` or a word is part of something longer. */
const PATH =
  /(?<![\w./#@:$-])((?:src|tools|test|packages|docs|vendor|studies|starters|\.claude)\/[\w./@+-]*)/gu;
const SPAN = /`([^`\n]+)`/gu;
const PLACEHOLDER_AFTER = /^[<*{[$…]/u;
const ONE_LETTER_STEM = /\/[A-Za-z]\.\w+$/u;
const TRAILING = /[.,;:)]+$/u;

/** Upstream copies and v1's record; `treeSites` drops the other upstream trees' findings. */
const UNREAD = ["vendor/", "studies/", "docs/transfer.md", "docs/v1.md"];
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/u;
const COMMENTED = /\.(?:ts|tsx|mts)$/u;

const SETTING = /\bANA_[A-Z0-9_]*[A-Z0-9]\b/gu;
const ENV_EXAMPLE = /^\.env(?:\.[\w-]+)*\.example$/u;
const SETTING_DOCS = /^AGENTS\.md$|(?:^|\/)SKILL\.md$/u;
const READS_SETTINGS = /\.(?:ts|tsx|mts|mjs|js|cjs|sh|zsh|py|json|yml|yaml|toml)$|^\.githooks\//u;

interface Cited {
  path: string;
  line: number;
  cited: string[];
}

/** The repository paths one line cites inside backticks, as written, before any is resolved. */
function pathsIn(line: string): string[] {
  return [...line.matchAll(SPAN)].flatMap(([, span = ""]) =>
    [...span.matchAll(PATH)].flatMap((match) => {
      const path = (match[1] ?? "").replace(TRAILING, "");
      const after = span.slice(match.index + match[0].length);
      const placeholder = PLACEHOLDER_AFTER.test(after) || path.includes("...") || ONE_LETTER_STEM.test(path);
      return placeholder ? [] : [path];
    }),
  );
}

/** Present from the root or from a directory above the document that cites it. */
function present(document: string, path: string): boolean {
  for (let dir = dirname(document); ; dir = dirname(dir)) {
    if (existsSync(join(dir, path))) return true;
    if (dir === "." || dir === "/" || dir === "") return false;
  }
}

/** The cited paths Git ignores, asked once, each also as a directory. Outside a checkout, none. */
function ignored(paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const asked = paths.flatMap((path) => (path.endsWith("/") ? [path] : [path, `${path}/`]));
  const answer = gitMaybe(".", "check-ignore", "--no-index", ...asked) ?? "";
  return new Set(answer.split("\n").map((path) => path.replace(/\/$/u, "")));
}

function missingPaths(texts: ReadonlyMap<string, string>): TreeFinding[] {
  const cited: Cited[] = [];
  for (const [path, text] of texts) {
    const prose = path.endsWith(".md");
    if (UNREAD.some((root) => path.startsWith(root)) || !(prose || COMMENTED.test(path))) continue;
    for (const [index, line] of text.split("\n").entries()) {
      if (!prose && !COMMENT_LINE.test(line)) continue;
      const gone = pathsIn(line).filter((one) => !present(path, one));
      if (gone.length > 0) cited.push({ path, line: index + 1, cited: gone });
    }
  }
  const skip = ignored([...new Set(cited.flatMap((one) => one.cited))]);
  return cited.flatMap(({ path, line, cited: gone }): TreeFinding[] => {
    const names = [...new Set(gone.filter((one) => !skip.has(one.replace(/\/$/u, ""))))];
    if (names.length === 0) return [];
    const list = names.map((name) => `\`${name}\``).join(", ");
    const detail = `${list} ${names.length === 1 ? "names" : "name"} nothing in this tree`;
    return [{ kind: "no-stale-reference", path, line, detail }];
  });
}

function unreadSettings(texts: ReadonlyMap<string, string>): TreeFinding[] {
  const read = new Set(
    [...texts].flatMap(([path, text]) => (READS_SETTINGS.test(path) ? (text.match(SETTING) ?? []) : [])),
  );
  return [...texts].flatMap(([path, text]): TreeFinding[] =>
    SETTING_DOCS.test(path) || ENV_EXAMPLE.test(path)
      ? text.split("\n").flatMap((line, index): TreeFinding[] => {
          const unread = [...new Set(line.match(SETTING))].filter((name) => !read.has(name));
          if (unread.length === 0) return [];
          const detail = `${unread.map((name) => `\`${name}\``).join(", ")} documented, and no code reads it`;
          return [{ kind: "no-stale-reference", path, line: index + 1, detail }];
        })
      : [],
  );
}

/** The root's `.env*.example` files, which no corpus walks; never `.env` itself. */
export function envExamples(): Map<string, string> {
  const names = readdirSync(".").filter((name) => ENV_EXAMPLE.test(name));
  return new Map(names.map((name) => [name, readFileSync(name, "utf8")]));
}

/** Every stale reference in the given files: a missing path in their prose, and an unread setting. */
export function staleReferences(texts: ReadonlyMap<string, string>): TreeFinding[] {
  return [...missingPaths(texts), ...unreadSettings(texts)];
}

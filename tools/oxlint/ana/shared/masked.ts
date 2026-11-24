/**
 * Source text with its comments and quoted strings blanked out, for a rule that searches a node
 * for a name.
 */

import type { ESTree } from "@oxlint/plugins";

const COMMENT_OR_QUOTED = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu;

/**
 * The words of every template literal blanked, its `${…}` left as source.
 */
function withoutTemplateWords(text: string): string {
  // `split("")` rather than a spread: the scan indexes `text` by code unit, and a spread would
  // give code points, so one astral character would slide every offset after it by one.
  const out = text.split("");
  const open: number[] = [];
  let depth = 0;
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    const words = open.length > 0 && open.at(-1) === depth;
    if (words && character === "\\") {
      out[at] = " ";
      out[at + 1] = " ";
      at += 2;
      continue;
    }
    if (character === "`") {
      if (words) open.pop();
      else open.push(depth);
    } else if (words && character === "$" && text[at + 1] === "{") {
      depth += 1;
      at += 2;
      continue;
    } else if (words) {
      // Inside the words, `${` is the only way out, so a brace here is a character in a sentence
      // and counting it opens a hole: `` `a {b} ${name}` `` stood at depth 1 from the `{`, which
      // is not the depth the literal opened at, so `b` (and everything up to the matching brace)
      // read as code. A rule searching the masked text then found a name inside prose, which
      // is the one thing this module exists to stop.
      if (character !== "\n") out[at] = " ";
    } else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    at += 1;
  }
  return out.join("");
}

/**
 * Whether a span a fix is about to delete carries a comment.
 */
export function holdsProse(comments: readonly ESTree.Span[], from: number, to: number): boolean {
  return comments.some((one) => one.start >= from && one.end <= to);
}

/** The same text, with every comment, quoted string and template word replaced by spaces. */
export function withoutProse(text: string): string {
  return withoutTemplateWords(text.replaceAll(COMMENT_OR_QUOTED, (match) => " ".repeat(match.length)));
}

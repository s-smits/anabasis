/**
 * Source text with its comments and quoted strings blanked out, for a rule that searches a node
 * for a name.
 */

import type { ESTree } from "@oxlint/plugins";

const COMMENT_OR_QUOTED = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu;

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
      // Inside the words, `${` is the only way out, so a brace here is a character in a sentence:
      // counting it in `` `a {b} ${name}` `` would read `b` as code, a name inside prose.
      if (character !== "\n") out[at] = " ";
    } else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    at += 1;
  }
  return out.join("");
}

export function holdsProse(comments: readonly ESTree.Span[], from: number, to: number): boolean {
  return comments.some((one) => one.start >= from && one.end <= to);
}

export function withoutProse(text: string): string {
  return withoutTemplateWords(text.replaceAll(COMMENT_OR_QUOTED, (match) => " ".repeat(match.length)));
}

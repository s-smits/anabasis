/**
 * Source text with its comments and quoted strings blanked out, for a rule that searches a node
 * for a name.
 *
 * `getText` returns source, so a rule looking for a binding by spelling is also reading prose.
 * `ana/prefer-const-conditional`'s one two-arm site, `solve-sandbox.ts`, builds a Seatbelt
 * profile whose array carries the comment *where that bypass is measured against this profile
 * without these lines* — the word `profile` in a sentence, suppressing the finding about the
 * binding called `profile`. `ana/no-renaming-temporary` needs the same answer to place a fix
 * rather than to suppress one, and there the cost of reading prose is an edit inside a string
 * literal.
 *
 * Each match becomes the same number of spaces, so an offset into the masked text is an offset
 * into the source and a fixer can use it directly.
 *
 * A template literal is split rather than taken whole: `${name}` inside one is a real read and
 * its surrounding words are prose exactly as a `"…"` is. Reading the whole literal loses the
 * substitution; blanking the whole literal invites the edit inside a string this module exists
 * to prevent. So the words go and the substitutions stay.
 */

import type { ESTree } from "@oxlint/plugins";

const COMMENT_OR_QUOTED = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu;

/**
 * The words of every template literal blanked, its `${…}` left as source.
 *
 * A one-pass scan rather than a regex, because the two halves nest: a `${…}` may hold another
 * template, which may hold another substitution. The stack records the brace depth each open
 * literal sits at, so "inside the words" is exactly "the innermost literal opened at the depth
 * we are standing on now". Run after the quoted-string pass, which has already removed every
 * backtick and brace that lives inside a comment or a `"…"`.
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
      // is not the depth the literal opened at, so `b` — and everything up to the matching brace
      // — read as code. A rule searching the masked text then found a name inside prose, which
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
 *
 * A fix that replaces or removes more than one node's worth of text takes the prose written
 * inside it away with it. The rewrite compiles and every test passes, so nothing says the
 * sentence has gone, and silence is the disqualifier in `FIXER-DECISIONS.md` condition 2. Where
 * the comment has no place on the answer, the rule reports and leaves the edit to its author.
 */
export function holdsProse(comments: readonly ESTree.Span[], from: number, to: number): boolean {
  return comments.some((one) => one.start >= from && one.end <= to);
}

/** The same text, with every comment, quoted string and template word replaced by spaces. */
export function withoutProse(text: string): string {
  return withoutTemplateWords(text.replaceAll(COMMENT_OR_QUOTED, (match) => " ".repeat(match.length)));
}

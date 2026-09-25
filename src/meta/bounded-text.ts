import { truncateHead, truncateTail } from "./truncate.ts";

/**
 * The one way this repository cuts a text to a size: pi's truncation, in UTF-8 bytes and whole
 * lines, applied to the trimmed text and trimmed again at the cut.
 *
 * Every cut used to be a `.slice` of its own, and a slice ends wherever the count runs out — inside
 * a word, inside a surrogate pair, or on the whitespace between two paragraphs. The last is a
 * defect rather than a blemish wherever a reader holds the text to being trimmed: a prose row whose
 * cut landed on `"\n\n"` was refused by the very reader it was written for. Six different omission
 * markers said the same thing six ways, and some said nothing at all.
 *
 * So a cut here keeps whole lines while any fit, falls back to a code-point-safe cut of the one
 * line that does not, and never leaves whitespace at the cut. `text` is what was kept, for a
 * record that carries its own truncation flag; `shown` adds the one omission marker, for anything a
 * person or a model reads.
 */
interface BoundedText {
  /** The kept text: at most `maxBytes` UTF-8 bytes, trimmed at both ends. */
  readonly text: string;
  /** True when anything of the trimmed input was left out. */
  readonly truncated: boolean;
  /** UTF-8 bytes of the trimmed input. */
  readonly totalBytes: number;
  /** `text`, marked with the bytes left out when the cut removed any. */
  readonly shown: string;
}

const encoder = new TextEncoder();

/** The longest prefix of `line` within `maxBytes`, ending on a whole code point. */
function headOfLine(line: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const point of line) {
    bytes += encoder.encode(point).byteLength;
    if (bytes > maxBytes) break;
    end += point.length;
  }
  return line.slice(0, end);
}

/**
 * Cut `text` to at most `maxBytes` bytes and `maxLines` lines, keeping its head or its tail.
 *
 * `keep: "tail"` is for output whose end is the part that matters — a failing command's stderr,
 * a log — and marks the omission in front instead of behind.
 */
export function boundText(
  text: string,
  maxBytes: number,
  keep: "head" | "tail" = "head",
  maxLines = Number.POSITIVE_INFINITY,
): BoundedText {
  const whole = text.trim();
  const options = { maxBytes, maxLines };
  const cut = keep === "head" ? truncateHead(whole, options) : truncateTail(whole, options);
  const kept = cut.firstLineExceedsLimit ? headOfLine(whole, maxBytes) : cut.content;
  const bounded = keep === "head" ? kept.trimEnd() : kept.trimStart();
  const truncated = bounded.length < whole.length;
  if (!truncated) return { text: bounded, truncated, totalBytes: cut.totalBytes, shown: bounded };
  const left = cut.totalBytes - encoder.encode(bounded).byteLength;
  const omitted = `[…${left} byte${left === 1 ? "" : "s"} omitted]`;
  const shown =
    bounded === "" ? omitted : keep === "head" ? `${bounded} ${omitted}` : `${omitted} ${bounded}`;
  return { text: bounded, truncated, totalBytes: cut.totalBytes, shown };
}
